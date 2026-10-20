// Live mode page: capture → cheap local gate → /api/decide → speak, plus the decision log.
// The gate is what keeps this cheap: a frame pair only leaves the machine when a 64×40 grey thumbnail says
// something moved and then stopped moving.
"use strict";

const $ = (id) => document.getElementById(id);
const STORE_KEY = "screen-narrator-live";
const MAX_LOG_ROWS = 100;
/** "What's new" keeps only the latest mentions; older ones are stale by the time anyone asks. */
const MAX_WHATS_NEW = 20;
/** If the screen is still changing after this many samples (a video, an endless animation), judge it anyway. */
const MAX_SETTLE_SAMPLES = 8;
const SEND_MAX_WIDTH = 1280;
const THUMB_WIDTH = 192;

const state = {
	config: null,
	stream: null,
	timer: 0,
	/** Last frame that was judged (or the first one): { small, jpeg, thumb }. */
	stable: null,
	/** A changed frame waiting to settle: { small, samples }. */
	moving: null,
	inFlight: false,
	/** The AbortController of the /api/narrate call in flight, if any. */
	narration: null,
	whatsNew: [],
	sharingSince: 0,
	totals: { calls: 0, sent: 0, skipped: 0, tokens: 0, cost: 0, costUnknown: false, cancelled: 0, announcements: 0 },
};

// ---- controls & persistence ----

const controls = {
	model: $("model"),
	interval: $("interval"),
	gate: $("gate"),
	announce: $("announce"),
	narrate: $("narrate"),
	mute: $("mute"),
};

function settings() {
	const num = (el, lo, hi, fallback) => {
		const v = Number(el.value);
		return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;
	};
	return {
		model: controls.model.value,
		interval: num(controls.interval, 200, 5000, 500),
		gate: num(controls.gate, 1, 100, 4),
		announce: num(controls.announce, 0, 1, state.config.thresholds.announce),
		narrate: controls.narrate.checked && !controls.narrate.disabled,
		mute: controls.mute.checked,
	};
}

function loadSettings() {
	let saved = {};
	try {
		saved = JSON.parse(localStorage.getItem(STORE_KEY) || "{}") || {};
	} catch {
		saved = {};
	}
	for (const [key, el] of Object.entries(controls)) {
		if (!(key in saved)) continue;
		if (el.type === "checkbox") el.checked = Boolean(saved[key]);
		// A saved model the server no longer offers would blank the <select> (value ""), and every request would
		// then fail validation; keep the server's default instead.
		else if (el.tagName === "SELECT" && ![...el.options].some((o) => o.value === String(saved[key]))) continue;
		else el.value = String(saved[key]);
	}
}

function saveSettings() {
	try {
		const s = settings();
		s.narrate = controls.narrate.checked;
		localStorage.setItem(STORE_KEY, JSON.stringify(s));
	} catch {
		// Private windows can refuse storage; settings then last for this visit only.
	}
}

// ---- speech & live regions ----

function announceToRegion(text, assertive) {
	const region = $(assertive ? "live-assertive" : "live-polite");
	// Clearing first makes screen readers re-announce identical text.
	region.textContent = "";
	setTimeout(() => {
		region.textContent = text;
	}, 50);
}

/** mode: "interrupt" cancels what is being said; "queue" waits for it. */
function speak(text, mode) {
	if (!text) return;
	announceToRegion(text, mode === "interrupt");
	if (settings().mute || !("speechSynthesis" in window)) return;
	if (mode === "interrupt") speechSynthesis.cancel();
	const u = new SpeechSynthesisUtterance(text);
	u.lang = "en";
	speechSynthesis.speak(u);
}

function hush() {
	if ("speechSynthesis" in window) speechSynthesis.cancel();
}

function updateWhatsNew() {
	$("whats-new-count").textContent = `(${state.whatsNew.length})`;
}

function readWhatsNew() {
	const items = state.whatsNew.splice(0);
	updateWhatsNew();
	speak(items.length ? `${items.length} new: ${items.join(". ")}` : "Nothing new", "interrupt");
}

// ---- capture ----

function setStatus(text) {
	$("status").textContent = text;
}

async function startSharing() {
	if (!navigator.mediaDevices?.getDisplayMedia) {
		setStatus("This browser can't share a screen (getDisplayMedia is missing).");
		return;
	}
	let stream;
	try {
		stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
	} catch (err) {
		setStatus(`Sharing was not started: ${err.message || err.name}.`);
		return;
	}
	state.stream = stream;
	const video = $("video");
	video.srcObject = stream;
	await video.play().catch(() => {});
	// The browser's own "Stop sharing" button ends the track without going through this page.
	stream.getVideoTracks()[0]?.addEventListener("ended", stopSharing);
	state.sharingSince = Date.now();
	setSharing(true);
	schedule();
}

function stopSharing() {
	clearInterval(state.timer);
	state.timer = 0;
	for (const t of state.stream?.getTracks() ?? []) t.stop();
	state.stream = null;
	$("video").srcObject = null;
	setSharing(false);
}

/** What starting and stopping a share have in common: a fresh baseline frame, the buttons, the status line. */
function setSharing(on) {
	state.stable = null;
	state.moving = null;
	$("share").disabled = on;
	$("stop").disabled = !on;
	setStatus(on ? "Sharing. Watching for changes." : "Not sharing.");
}

function schedule() {
	clearInterval(state.timer);
	if (state.stream) state.timer = setInterval(tick, settings().interval);
}

const smallCtx = $("small").getContext("2d", { willReadFrequently: true });

/** 64×40 grey thumbnail of the current frame. */
function grabSmall(video) {
	smallCtx.drawImage(video, 0, 0, 64, 40);
	const rgba = smallCtx.getImageData(0, 0, 64, 40).data;
	const grey = new Uint8Array(64 * 40);
	for (let i = 0; i < grey.length; i++) grey[i] = (rgba[i * 4] * 299 + rgba[i * 4 + 1] * 587 + rgba[i * 4 + 2] * 114) / 1000;
	return grey;
}

function meanDiff(a, b) {
	let sum = 0;
	for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
	return sum / a.length;
}

/** JPEG data URL of `source`, at most `maxWidth` wide. */
function toJpeg(source, srcWidth, srcHeight, maxWidth, quality) {
	const scale = Math.min(1, maxWidth / srcWidth);
	const canvas = $("full");
	canvas.width = Math.max(1, Math.round(srcWidth * scale));
	canvas.height = Math.max(1, Math.round(srcHeight * scale));
	canvas.getContext("2d").drawImage(source, 0, 0, canvas.width, canvas.height);
	return canvas.toDataURL("image/jpeg", quality);
}

function grabFrame(video, small) {
	const w = video.videoWidth;
	const h = video.videoHeight;
	return { small, jpeg: toJpeg(video, w, h, SEND_MAX_WIDTH, 0.8), thumb: toJpeg(video, w, h, THUMB_WIDTH, 0.7) };
}

function tick() {
	const video = $("video");
	if (!state.stream || video.readyState < 2 || !video.videoWidth) return;
	// One request at a time. Changes made meanwhile are not lost: once it returns, the current frame is compared
	// with the frame that was just judged.
	if (state.inFlight) return;
	const small = grabSmall(video);
	const s = settings();

	if (!state.stable) {
		state.stable = grabFrame(video, small);
		return;
	}
	if (!state.moving) {
		if (meanDiff(small, state.stable.small) < s.gate) {
			state.totals.skipped++;
			renderTotals();
			return;
		}
		state.moving = { small, samples: 1 };
		return;
	}
	const settled = meanDiff(small, state.moving.small) < s.gate;
	state.moving = { small, samples: state.moving.samples + 1 };
	if (!settled && state.moving.samples < MAX_SETTLE_SAMPLES) return;
	state.moving = null;
	// It may have changed back (a flicker): nothing to judge then.
	if (meanDiff(small, state.stable.small) < s.gate) {
		state.totals.skipped++;
		renderTotals();
		return;
	}
	void judge(state.stable, grabFrame(video, small));
}

// ---- judging ----

async function postJson(url, body, signal) {
	const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
	const data = await res.json().catch((err) => {
		// An abort while the body is read is still an abort, not an unreadable answer.
		if (signal?.aborted) throw err;
		return { error: `HTTP ${res.status}` };
	});
	if (!res.ok) throw Object.assign(new Error(data.error || `HTTP ${res.status}`), { status: res.status, data });
	return data;
}

/** Judge one pair; `after` becomes the new stable frame. Also callable from the console for testing. */
async function judge(before, after) {
	state.inFlight = true;
	// Sharing can stop (and restart on another window) while the call is out; then `after` is not this share's frame.
	const stream = state.stream;
	state.totals.sent++;
	const s = settings();
	const row = { time: new Date(), before: before.thumb, after: after.thumb };
	try {
		const r = await postJson("/api/decide", {
			before: before.jpeg,
			after: after.jpeg,
			model: s.model,
			thresholds: { announce: s.announce },
		});
		Object.assign(row, r);
		addUsage(r.inputTokens, r.costUsd);
		act(r, row);
		// The server's policy says whether a detail sentence is worth it (spoken now or next, and not sensitive).
		if (s.narrate && r.decision.narratable) void narrate(before, after, r.decision, row);
	} catch (err) {
		row.error = err.message;
	} finally {
		// Frames judged from the console have no thumbnail to gate against, so they never replace the capture's.
		if (after.small && stream && state.stream === stream) state.stable = after;
		state.inFlight = false;
		addRow(row);
		renderTotals();
	}
}

function act(r, row) {
	const { action, speech } = r.decision;
	row.spoken = "";
	if (action === "interrupt" || action === "queue") {
		speak(speech, action);
		row.spoken = speech;
		state.totals.announcements++;
	} else if (action === "mention") {
		state.whatsNew.push(speech);
		if (state.whatsNew.length > MAX_WHATS_NEW) state.whatsNew.splice(0, state.whatsNew.length - MAX_WHATS_NEW);
		updateWhatsNew();
		row.spoken = "(added to What's new)";
	}
}

const SUPERSEDED = "superseded by a newer change, not spoken";

async function narrate(before, after, decision, row) {
	// At most one narration in flight: a newer change makes this one's detail stale, so its call is cancelled.
	state.narration?.abort();
	const controller = new AbortController();
	state.narration = controller;
	row.narration = { pending: true };
	try {
		const r = await postJson(
			"/api/narrate",
			{ before: before.jpeg, after: after.jpeg, decision: { speech: decision.speech }, model: settings().model },
			controller.signal,
		);
		addNarrationUsage(r);
		// An answer that arrived just as a newer narration started is paid for (counted above) but never spoken.
		if (state.narration !== controller) row.narration = { error: SUPERSEDED };
		else {
			row.narration = r;
			// The hallucination guard: the server sets `speak` only when the fact-check supports the narration.
			if (r.speak) speak(r.narration, "queue");
		}
	} catch (err) {
		// Aborted before any answer came back, so the browser never learns this call's usage; the server still pays
		// for the Claude call if it had started. Counted, so the total says it is incomplete rather than being silently low.
		if (err.name === "AbortError") {
			row.narration = { error: SUPERSEDED };
			state.totals.cancelled++;
		} else {
			row.narration = { error: err.message };
			// A failed fact-check still cost a Claude call; the server reports its usage on the error.
			if (err.data) addNarrationUsage(err.data);
		}
		if (err.status === 501) {
			controls.narrate.checked = false;
			controls.narrate.disabled = true;
			$("narrate-help").textContent = `Unavailable: ${err.message}`;
		}
	} finally {
		if (state.narration === controller) state.narration = null;
	}
	updateRow(row);
	renderTotals();
}

/** An /api/narrate answer's (or error's) paid calls: Claude's narration, even when refused, then the fact-check if it ran. */
function addNarrationUsage(r) {
	if (r.narratorInputTokens === undefined) return;
	addUsage(r.narratorInputTokens + r.narratorOutputTokens, r.narratorCostUsd);
	if (typeof r.supported === "number") addUsage(r.inputTokens, r.costUsd);
}

function addUsage(tokens, cost) {
	state.totals.calls++;
	state.totals.tokens += tokens || 0;
	if (cost === null || cost === undefined) state.totals.costUnknown = true;
	else state.totals.cost += cost;
}

// ---- rendering ----

const fmtP = (p) => (typeof p === "number" ? p.toFixed(2) : "–");

function el(tag, props = {}, ...children) {
	const node = document.createElement(tag);
	for (const [k, v] of Object.entries(props)) {
		if (k === "class") node.className = v;
		// CSSOM, not the style attribute: the page's CSP forbids inline style attributes.
		else if (k === "style") Object.assign(node.style, v);
		else node[k] = v;
	}
	for (const c of children) if (c !== null && c !== undefined) node.append(c);
	return node;
}

function spokenCell(row) {
	const td = el("td", { class: "spoken" });
	if (row.error) {
		td.append(el("span", { class: "err" }, `Error: ${row.error}`));
		return td;
	}
	td.append(row.spoken || "—");
	const n = row.narration;
	if (!n) return td;
	const p = el("p", { class: "narration" });
	if (n.pending) p.append("Narrating…");
	else if (n.error) p.append(el("span", { class: "err" }, `Narration failed: ${n.error}`));
	else if (!n.narration) p.append(n.refused ? "Narration refused by Claude" : "Narration was empty");
	else if (n.speak) p.append(`Then: "${n.narration}" (supported ${fmtP(n.supported)})`);
	else p.append(el("span", { class: "sr-only" }, "Rejected narration: "), el("del", {}, n.narration), ` (supported ${fmtP(n.supported)}, not spoken)`);
	td.append(p);
	return td;
}

function rowCells(row) {
	const p = row.prediction ?? {};
	const d = row.decision ?? { action: row.error ? "error" : "drop", reason: "" };
	const announce = p.announce;
	const kindP = p.kind ? p.kind.probabilities[p.kind.choice] : undefined;
	const bar = el("span", { class: "bar" }, el("span", { style: { width: `${Math.round((announce ?? 0) * 100)}%` } }));
	bar.setAttribute("aria-hidden", "true");
	const cost = row.costUsd === null ? "n/a" : typeof row.costUsd === "number" ? `$${row.costUsd.toFixed(5)}` : "–";
	return [
		el("td", { class: "num" }, row.time.toLocaleTimeString()),
		el(
			"td",
			{},
			el(
				"div",
				{ class: "thumbs" },
				el("img", { src: row.before, alt: "Before" }),
				el("img", { src: row.after, alt: "After" }),
			),
		),
		el("td", { class: "num" }, bar, fmtP(announce)),
		el("td", {}, p.kind ? `${p.kind.choice} (${fmtP(kindP)})` : "–"),
		el("td", { class: "num" }, p.urgency ? p.urgency.score.toFixed(2) : "–"),
		el("td", { class: "num" }, fmtP(p.sensitive)),
		el("td", {}, el("span", { class: `action action-${d.action}` }, d.action)),
		spokenCell(row),
		el("td", { class: "reason" }, d.reason || ""),
		el("td", { class: "num" }, row.latencyMs !== undefined ? `${row.latencyMs} ms` : "–"),
		el("td", { class: "num" }, row.inputTokens !== undefined ? String(row.inputTokens) : "–"),
		el("td", { class: "num" }, cost),
	];
}

function addRow(row) {
	const body = $("log-body");
	body.querySelector("tr.empty")?.remove();
	row.tr = el("tr", {}, ...rowCells(row));
	body.prepend(row.tr);
	while (body.rows.length > MAX_LOG_ROWS) body.lastElementChild.remove();
}

function updateRow(row) {
	if (row.tr?.isConnected) row.tr.replaceChildren(...rowCells(row));
}

function renderTotals() {
	const t = state.totals;
	$("t-calls").textContent = String(t.calls);
	$("t-sent").textContent = String(t.sent);
	$("t-skipped").textContent = String(t.skipped);
	$("t-tokens").textContent = t.tokens.toLocaleString();
	const unpriced = state.config?.unpricedModels ?? [];
	const cancelled = t.cancelled ? ` + ${t.cancelled} cancelled narration${t.cancelled === 1 ? "" : "s"} (cost not reported)` : "";
	$("t-cost").textContent = `$${t.cost.toFixed(5)}${t.costUnknown ? ` + ${unpriced.length ? unpriced.join(", ") : "some calls"} (price unset)` : ""}${cancelled}`;
	const minutes = state.sharingSince ? (Date.now() - state.sharingSince) / 60000 : 0;
	$("t-rate").textContent = minutes > 0.05 ? (t.announcements / minutes).toFixed(1) : "0.0";
}

async function loadFixtures() {
	const list = $("fixtures");
	try {
		const { fixtures } = await (await fetch("/api/fixtures")).json();
		list.replaceChildren();
		if (!fixtures.length) {
			list.append(el("li", {}, "No fixture apps yet (they live in the project's fixtures/ folder)."));
			return;
		}
		for (const f of fixtures) {
			const name = f.file.replace(/\.html$/, "");
			const li = el("li", {}, el("a", { href: `/fixtures/${encodeURIComponent(f.file)}`, target: "_blank", rel: "noopener" }, `${name} (opens in a new tab)`));
			if (f.triggers.length) li.append(" ", el("span", { class: "triggers" }, `triggers: ${f.triggers.map((t) => `'${t}'`).join(", ")}`));
			list.append(li);
		}
	} catch {
		list.replaceChildren(el("li", {}, "Could not list the fixture apps."));
	}
}

// ---- wiring ----

async function init() {
	try {
		state.config = await (await fetch("/api/config")).json();
	} catch {
		setStatus("Could not reach the live server. Is `pnpm live` running?");
		return;
	}
	for (const m of state.config.models) controls.model.append(el("option", { value: m }, m));
	controls.announce.value = String(state.config.thresholds.announce);
	if (!state.config.narratorAvailable) {
		controls.narrate.disabled = true;
		$("narrate-help").textContent = "Unavailable: the server found no Claude credentials (set ANTHROPIC_API_KEY or run `ant auth login`, then restart).";
	} else {
		$("narrate-help").textContent = `Uses ${state.config.narratorModel}; adds one fact-checked sentence after interrupts and queued announcements.`;
	}
	loadSettings();

	$("controls").addEventListener("change", (e) => {
		saveSettings();
		if (e.target === controls.interval) schedule();
		if (e.target === controls.mute && controls.mute.checked) hush();
	});
	$("controls").addEventListener("submit", (e) => e.preventDefault());
	$("share").addEventListener("click", startSharing);
	$("stop").addEventListener("click", stopSharing);
	$("whats-new").addEventListener("click", readWhatsNew);
	$("hush").addEventListener("click", hush);
	document.addEventListener("keydown", (e) => {
		if (e.key === "Escape") return hush();
		const tag = e.target instanceof Element ? e.target.tagName : "";
		if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
		if (e.altKey && e.shiftKey && e.code === "KeyW") {
			e.preventDefault();
			readWhatsNew();
		}
	});
	setInterval(renderTotals, 5000);
	renderTotals();
	void loadFixtures();
}

/** For testing without a capture: judge two images (data URLs) as if they were a before/after pair. */
window.live = {
	judgeImages: (beforeUrl, afterUrl) =>
		judge({ jpeg: beforeUrl, thumb: beforeUrl, small: null }, { jpeg: afterUrl, thumb: afterUrl, small: null }),
};

init();

// The pair browser: filterable cards (before/after, labels, one compact row per backend) and a detail dialog with
// every backend's full answer. Right/wrong comes from metrics.verdicts; nothing is re-scored here.
"use strict";

const PAGE = 36;
/** Search waits this long after the last keystroke, so typing doesn't re-render every card per character. */
const SEARCH_DEBOUNCE_MS = 150;
const state = { filter: "all", backend: "", q: "", shown: PAGE, list: [], open: -1 };

const verdictsOf = (p) => (state.backend ? [M.verdicts[p.id]?.[state.backend]] : BACKENDS.map((b) => M.verdicts[p.id]?.[b])).filter(Boolean);
const isAmbiguous = (p) => p.labels.announce === AMB || p.labels.kind === AMB || p.labels.urgency === AMB;
const FILTERS = [
	{ key: "all", label: "All", test: () => true },
	{ key: "wrong", label: "Wrong", test: (p) => verdictsOf(p).some((v) => v.wrong) },
	{ key: "confident", label: "Confidently wrong", test: (p) => verdictsOf(p).some((v) => v.confidentlyWrong) },
	{ key: "ambiguous", label: "Ambiguous", test: isAmbiguous },
	{ key: "sessions", label: "Sessions", test: (p) => !!p.session },
];

/** An image, or a placeholder when the file is missing (known at build time, or failing to load). */
function img(pair, which, cls = "") {
	const path = pair[which];
	if (MISSING.has(path)) return placeholder(path);
	return `<img class="${cls}" src="${esc(imageBase + path)}" alt="${esc(`${which} screenshot of ${pair.scenario}`)}" loading="lazy" decoding="async" data-path="${esc(path)}">`;
}
const placeholder = (path) => `<div class="ph" role="img" aria-label="image missing"><span>No image<br><span class="mono">${esc(String(path).split("/").pop())}</span></span></div>`;
// Load errors don't bubble, so listen in the capture phase.
document.addEventListener("error", (e) => {
	const el = e.target;
	if (el instanceof HTMLImageElement && el.dataset.path !== undefined) el.outerHTML = placeholder(el.dataset.path);
}, true);

function labelChips(p) {
	const L = p.labels;
	const chip = (text, amb, extra = "") => `<span class="chip label${amb ? " amb" : ""}${extra}">${text}</span>`;
	return [
		chip(L.announce === AMB ? "announce: ambiguous" : `announce: ${L.announce ? "yes" : "no"}`, L.announce === AMB),
		chip(`kind: ${esc(L.kind)}`, L.kind === AMB),
		chip(L.urgency === AMB ? "urgency: ambiguous" : `urgency: ${L.urgency} ${URGENCY_NAMES[L.urgency]}`, L.urgency === AMB),
		L.sensitive ? chip("sensitive", false, " warn") : "",
	].join("");
}

function variantChips(p) {
	const v = p.variant;
	const bits = [v.theme, `${v.viewport.width}×${v.viewport.height}`, v.density, v.lang];
	if (p.session) bits.push(`${p.session.name} #${p.session.step} · ${(p.session.tMs / 1000).toFixed(0)} s`);
	return bits.map((b) => `<span class="chip">${esc(b)}</span>`).join("");
}

const mark = (ok) => (ok === null || ok === undefined ? '<span class="muted" title="not judged">–</span>' : ok ? '<span class="ok">✓<span class="sr"> right</span></span>' : '<span class="no">✗<span class="sr"> wrong</span></span>');

function backendRow(p, name) {
	const r = resultFor.get(`${p.id}\u0000${name}`);
	const v = M.verdicts[p.id]?.[name];
	const who = `<span class="name" style="--c:var(--c-${cssId(name)})"><span class="swatch" aria-hidden="true"></span>${esc(name)}</span>`;
	if (!r) return `${who}<span class="err muted">no result</span>`;
	if (r.error || !r.prediction) return `${who}<span class="err" title="${esc(r.error)}">error: ${esc(String(r.error).slice(0, 48))}</span>`;
	const pr = r.prediction;
	const kind = pr.kind ? `<span title="kind ${esc(pr.kind.choice)}${v?.kind === false ? " (wrong)" : ""}">${esc(pr.kind.choice)}${v?.kind === false ? '<span class="no" aria-hidden="true">*</span>' : ""}</span>` : '<span class="muted">—</span>';
	const urg = pr.urgency ? `<span title="urgency score ${pr.urgency.score.toFixed(2)}">u${v?.level ?? "?"}${v?.falseInterrupt ? '<span class="no" title="false interrupt">!</span>' : ""}</span>` : '<span class="muted">—</span>';
	const ok = v?.judged ? !v.wrong : null;
	return `${who}<span style="--c:var(--c-${cssId(name)})">${pbar(pr.announce, M.thresholds.announce)}</span>${kind}${urg}${mark(ok)}`;
}

function card(p, index) {
	const names = state.backend ? [state.backend] : BACKENDS;
	return `<article class="card">
		<div class="thumbs"><figure class="thumb">${img(p, "before")}<figcaption>before</figcaption></figure><figure class="thumb">${img(p, "after")}<figcaption>after</figcaption></figure></div>
		<div><h3><button type="button" data-open="${index}">${esc(p.scenario)} <span class="muted small">· ${esc(p.app)}</span></button></h3><div class="id" title="${esc(p.id)}">${esc(p.id)}</div></div>
		<div class="chips">${labelChips(p)}</div>
		<div class="chips">${variantChips(p)}</div>
		<div class="rows" role="list" aria-label="Answers">${names.map((b) => `<div role="listitem" style="display:contents">${backendRow(p, b)}</div>`).join("")}</div>
	</article>`;
}

function applyFilters() {
	const f = FILTERS.find((x) => x.key === state.filter);
	const q = state.q.trim().toLowerCase();
	state.list = run.pairs.filter((p) => f.test(p) && (!q || p.id.toLowerCase().includes(q) || p.scenario.toLowerCase().includes(q) || p.app.toLowerCase().includes(q)));
	renderCards();
	for (const btn of $("filters").querySelectorAll("button")) btn.setAttribute("aria-pressed", String(btn.dataset.filter === state.filter));
}

/** Pairs per filter button. They depend on the backend filter only (never the search text), so only it re-counts. */
function renderFilterCounts() {
	for (const btn of $("filters").querySelectorAll("button")) {
		const fx = FILTERS.find((x) => x.key === btn.dataset.filter);
		btn.querySelector(".n").textContent = run.pairs.filter(fx.test).length;
	}
}

function renderCards() {
	const visible = state.list.slice(0, state.shown);
	$("cards").innerHTML = visible.map((p, i) => card(p, i)).join("") || '<p class="empty">No pairs match.</p>';
	$("pair-count").textContent = `Showing ${visible.length} of ${state.list.length} pairs${state.list.length < run.pairs.length ? ` (${run.pairs.length} in the run)` : ""}.`;
	const more = $("more");
	more.hidden = visible.length >= state.list.length;
	more.textContent = `Show ${Math.min(PAGE, state.list.length - visible.length)} more`;
}

function initBrowser() {
	$("filters").innerHTML = FILTERS.map((f) => `<button type="button" data-filter="${f.key}" aria-pressed="false">${f.label}<span class="n"></span></button>`).join("");
	$("filters").addEventListener("click", (e) => {
		const btn = e.target.closest("button");
		if (!btn) return;
		state.filter = btn.dataset.filter;
		state.shown = PAGE;
		applyFilters();
	});
	$("backend-filter").innerHTML = `<option value="">All backends</option>` + BACKENDS.map((b) => `<option value="${esc(b)}">${esc(b)}</option>`).join("");
	$("backend-filter").addEventListener("change", (e) => {
		state.backend = e.target.value;
		state.shown = PAGE;
		renderFilterCounts();
		applyFilters();
	});
	let searchTimer = 0;
	$("search").addEventListener("input", (e) => {
		clearTimeout(searchTimer);
		searchTimer = setTimeout(() => {
			state.q = e.target.value;
			state.shown = PAGE;
			applyFilters();
		}, SEARCH_DEBOUNCE_MS);
	});
	$("more").addEventListener("click", () => {
		const first = state.shown;
		state.shown += PAGE;
		renderCards();
		$("cards").querySelector(`[data-open="${first}"]`)?.focus();
	});
	$("cards").addEventListener("click", (e) => {
		const btn = e.target.closest("[data-open]");
		if (btn) openDetail(Number(btn.dataset.open));
	});
	$("detail-close").addEventListener("click", () => $("detail").close());
	$("detail-prev").addEventListener("click", () => step(-1));
	$("detail-next").addEventListener("click", () => step(1));
	$("detail").addEventListener("keydown", (e) => {
		if (e.target.matches("input, select")) return;
		if (e.key === "ArrowLeft") step(-1);
		if (e.key === "ArrowRight") step(1);
	});
	// Click on the backdrop (the dialog element itself, outside its content box) closes it.
	$("detail").addEventListener("click", (e) => {
		if (e.target === $("detail")) $("detail").close();
	});
	$("detail").addEventListener("close", () => {
		$("cards").querySelector(`[data-open="${state.open}"]`)?.focus();
	});
	renderFilterCounts();
	applyFilters();
}

// --- detail ------------------------------------------------------------------------------------------------------

function step(d) {
	const next = state.open + d;
	if (next < 0 || next >= state.list.length) return;
	if (next >= state.shown) {
		state.shown = next + 1;
		renderCards();
	}
	openDetail(next);
}

const probRows = (entries, { label, choice } = {}) =>
	`<div class="probs">${entries
		.map(([k, v]) => `<span class="k${k === label ? " is-label" : ""}${k === choice ? " is-choice" : ""}">${esc(k)}</span>${isNum(v) ? `<span class="pbar" style="--p:${v.toFixed(3)}"><i></i></span><span class="v">${v.toFixed(2)}</span>` : `<span></span><span class="v muted">—</span>`}`)
		.join("")}</div>`;

function answerPanel(p, name) {
	const r = resultFor.get(`${p.id}\u0000${name}`);
	const v = M.verdicts[p.id]?.[name];
	const head = `<h3>${backendLabel(name)} ${v?.judged ? mark(!v.wrong) : ""}${v?.confidentlyWrong ? ' <span class="chip warn label">confidently wrong</span>' : ""}</h3>`;
	const c = `style="--c:var(--c-${cssId(name)})"`;
	if (!r) return `<section class="answer" ${c}>${head}<p class="muted">No result for this pair.</p></section>`;
	const meta = `<p class="meta">${fmt.ms(r.latencyMs)} · ${r.inputTokens !== undefined ? `${fmt.int(r.inputTokens)} in / ${fmt.int(r.outputTokens ?? 0)} out tokens · ` : ""}${fmt.usd(r.costUsd)}${r.cached ? " · cached" : ""}</p>`;
	if (r.error || !r.prediction) return `<section class="answer" ${c}>${head}<p class="no">Error</p><p class="mono small">${esc(r.error)}</p>${meta}</section>`;
	const pr = r.prediction;
	const L = p.labels;
	const parts = [head];
	if (v?.action) parts.push(`<p class="say"><b>${esc(v.action)}</b>${v.speech ? `: <q>${esc(v.speech)}</q>` : ""}</p>`);
	if (isNum(pr.announce)) parts.push(`<h4>P(announce) ${mark(v?.announce)}</h4><span style="--c:var(--c-${cssId(name)})">${pbar(pr.announce, M.thresholds.announce)}</span>`);
	if (pr.kind) parts.push(`<h4>Kind ${mark(v?.kind)}</h4>${probRows(KINDS.map((k) => [k, pr.kind.probabilities[k]]), { label: L.kind, choice: pr.kind.choice })}`);
	if (pr.urgency)
		parts.push(`<h4>Urgency: score ${pr.urgency.score.toFixed(2)} ${mark(v?.urgency)}${v?.falseInterrupt ? ' <span class="no">false interrupt</span>' : ""}</h4>${probRows(
			URGENCY_NAMES.map((name, l) => [`${l} ${name}`, pr.urgency.probabilities[l]]),
			{ label: L.urgency === AMB ? null : `${L.urgency} ${URGENCY_NAMES[L.urgency]}` },
		)}`);
	if (isNum(pr.sensitive)) parts.push(`<h4>P(sensitive) <span class="muted">label: ${L.sensitive ? "yes" : "no"}</span></h4>${pbar(pr.sensitive, M.thresholds.sensitive)}`);
	if (pr.primary) parts.push(`<h4>Primary <span class="muted">label: ${esc(L.primary?.answer ?? "—")}</span></h4>${probRows(Object.entries(pr.primary.probabilities), { label: L.primary?.answer, choice: pr.primary.choice })}`);
	if (pr.supported) parts.push(`<h4>P(supported)</h4>${probRows([["true narration", pr.supported.supported], ["invented detail", pr.supported.unsupported]])}`);
	parts.push(meta);
	return `<section class="answer" ${c}>${parts.join("")}</section>`;
}

function openDetail(index) {
	const p = state.list[index];
	if (!p) return;
	state.open = index;
	$("detail-pos").textContent = `Pair ${index + 1} of ${state.list.length}`;
	$("detail-title").textContent = `${p.scenario} · ${p.app}`;
	$("detail-id").textContent = p.id;
	$("detail-prev").disabled = index === 0;
	$("detail-next").disabled = index === state.list.length - 1;
	const L = p.labels;
	const extra = [p.focused ? `Focus: <span class="mono">${esc(p.focused)}</span>` : "", L.narrations ? `Narrations: <q>${esc(L.narrations.supported)}</q> / invented: <q>${esc(L.narrations.unsupported)}</q>` : ""].filter(Boolean).join("<br>");
	$("detail-body").innerHTML = `
		<div class="big"><figure class="thumb">${img(p, "before")}<figcaption>before · images[0]</figcaption></figure><figure class="thumb">${img(p, "after")}<figcaption>after · images[1]</figcaption></figure></div>
		<div class="chips" style="margin-top:12px">${labelChips(p)}${variantChips(p)}</div>
		${extra ? `<p class="note small" style="margin-top:8px">${extra}</p>` : ""}
		<div class="answers">${BACKENDS.map((b) => answerPanel(p, b)).join("")}</div>`;
	const dlg = $("detail");
	if (!dlg.open) dlg.showModal();
	$("detail-body").scrollTop = 0;
	dlg.scrollTop = 0;
}

initBrowser();

// Renders the report from the JSON inlined by src/report.ts (parsed into DATA by charts.js).
// Every number comes from metrics (computed and tested in src/metrics.ts); this file only lays them out.
"use strict";

const { run, metrics: M, imageBase } = DATA;
const MISSING = new Set(DATA.missing || []);
const BACKENDS = run.backends;
const B = (name) => M.backends[name];
const resultFor = new Map(run.results.map((r) => [`${r.pairId}\u0000${r.backend}`, r]));
const $ = (id) => document.getElementById(id);
/** A table() column whose highlighted value and cell come from the same accessor. */
const col = (head, dir, get, format = (v) => v) => ({ head, dir, value: get, cell: (r) => format(get(r)) });

// Colour follows the backend's position in the run, never its rank in a column.
document.head.insertAdjacentHTML(
	"beforeend",
	`<style>:root{${BACKENDS.map((b, i) => `--c-${cssId(b)}:${i < 8 ? `var(--series-${i + 1})` : "var(--muted)"}`).join(";")}}</style>`,
);

// --- header ------------------------------------------------------------------------------------------------------

function renderFacts() {
	const totalCost = BACKENDS.map((b) => B(b).cost.costUsd).filter(isNum);
	const unknown = BACKENDS.filter((b) => !isNum(B(b).cost.costUsd) && B(b).cost.results > 0);
	const amb = M.ambiguous;
	const facts = [
		["Run", `<span class="mono">${esc(run.id)}</span>`],
		["Created", esc(new Date(run.createdAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }))],
		["Backends", BACKENDS.map((b) => backendLabel(b)).join(" ")],
		["Questions", run.questionSet === "all" ? "all six" : "core four"],
		["Pairs", `${M.pairs} <span class="sub-n">${amb.announce} ambiguous · ${M.sessions} session${M.sessions === 1 ? "" : "s"}</span>`],
		["Total cost", `${totalCost.length ? fmt.usd(totalCost.reduce((a, b) => a + b, 0)) : fmt.usd(null)}${unknown.length ? `<span class="sub-n">+ unknown for ${unknown.map(esc).join(", ")}</span>` : ""}`],
	];
	$("facts").innerHTML = facts.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("");
}

// --- headline ----------------------------------------------------------------------------------------------------

function renderHeadline() {
	const labelledPerMin = BACKENDS.map((b) => B(b).noise.total.labelledPerMin).find(isNum);
	const rows = BACKENDS.map((name) => ({ name, m: B(name) }));
	const cols = [
		{ head: "Backend", cell: (r) => backendLabel(r.name, `<span class="sub-n">n ${r.m.announce.n}</span>`) },
		col('Accuracy <span class="dir">↑</span>', "high", (r) => r.m.announce.accuracy, fmt.pct),
		col('Brier <span class="dir">↓</span>', "low", (r) => r.m.announce.brier, fmt.num),
		col('ECE <span class="dir">↓</span>', "low", (r) => r.m.announce.ece, fmt.num),
		{ head: 'False interrupts <span class="dir">↓</span>', dir: "low", value: (r) => r.m.urgency.falseInterrupt.rate, cell: (r) => fmt.rate(r.m.urgency.falseInterrupt) },
		col(
			`Announced / min <span class="dir">labelled ${isNum(labelledPerMin) ? labelledPerMin.toFixed(1) : "—"}</span>`,
			isNum(labelledPerMin) ? (v) => Math.abs(v - labelledPerMin) : undefined,
			(r) => r.m.noise.total.predictedPerMin,
			fmt.perMin,
		),
		col('p50 latency <span class="dir">↓</span>', "low", (r) => r.m.cost.latencyP50, fmt.ms),
		col('Cost / pair <span class="dir">↓</span>', "low", (r) => r.m.cost.costPerPair, fmt.usd),
	];
	$("headline").innerHTML = table(cols, rows, { caption: "announce: per-backend summary" });
}

// --- calibration -------------------------------------------------------------------------------------------------

const CAL_TABS = [
	{ key: "announce", label: "Announce", what: "P(announce)", get: (m) => m.announce },
	{ key: "sensitive", label: "Sensitive", what: "P(sensitive)", get: (m) => m.sensitive },
	{ key: "kind", label: "Kind confidence", what: "top-1 kind probability vs. right", get: (m) => m.kind.confidence },
	{ key: "supported", label: "Supported", what: "P(supported)", get: (m) => m.supported },
];

function renderCalibration() {
	const tabs = CAL_TABS.filter((t) => BACKENDS.some((b) => t.get(B(b)).n > 0));
	$("cal-tabs").innerHTML = tabs
		.map((t, i) => `<button type="button" role="tab" id="tab-${t.key}" aria-controls="panel-${t.key}" aria-selected="${i === 0}" tabindex="${i === 0 ? 0 : -1}">${t.label}</button>`)
		.join("");
	$("cal-panels").innerHTML = tabs
		.map((t, i) => {
			const maxN = Math.max(1, ...BACKENDS.flatMap((b) => t.get(B(b)).bins.map((x) => x.n)));
			const charts = BACKENDS.map((b) => {
				const m = t.get(B(b));
				return m.n ? reliabilityChart(b, m, maxN, t.what) : `<div class="chart off"><div>${backendLabel(b)}<br><span class="small">doesn't answer this</span></div></div>`;
			}).join("");
			return `<div role="tabpanel" id="panel-${t.key}" aria-labelledby="tab-${t.key}" ${i ? "hidden" : ""}><p class="note small">${esc(t.what)}</p><div class="multiples">${charts}</div></div>`;
		})
		.join("");
	const buttons = [...$("cal-tabs").querySelectorAll('[role="tab"]')];
	const select = (btn) => {
		for (const b of buttons) {
			const on = b === btn;
			b.setAttribute("aria-selected", String(on));
			b.tabIndex = on ? 0 : -1;
			$(b.getAttribute("aria-controls")).hidden = !on;
		}
		btn.focus();
	};
	buttons.forEach((btn, i) => {
		btn.addEventListener("click", () => select(btn));
		btn.addEventListener("keydown", (e) => {
			const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
			if (d) select(buttons[(i + d + buttons.length) % buttons.length]);
		});
	});
}

// --- kind, urgency, other questions ------------------------------------------------------------------------------

function renderKind() {
	const answering = BACKENDS.filter((b) => B(b).kind.n > 0);
	if (!answering.length) {
		$("kind-summary").outerHTML = '<p class="empty">No backend answered kind.</p>';
		return;
	}
	const rows = answering.map((name) => ({ name, k: B(name).kind }));
	$("kind-summary").innerHTML = table(
		[
			{ head: "Backend", cell: (r) => backendLabel(r.name, `<span class="sub-n">n ${r.k.n}</span>`) },
			col('Top-1 right <span class="dir">↑</span>', "high", (r) => r.k.accuracy, fmt.pct),
			col('Mean P(label) <span class="dir">↑</span>', "high", (r) => r.k.meanTrueProb, (x) => fmt.num(x, 2)),
			col('Confidence ECE <span class="dir">↓</span>', "low", (r) => r.k.confidence.ece, fmt.num),
		],
		rows,
		{ caption: "kind summary" },
	);
	$("kind-matrices").innerHTML = answering.map((b) => confusionTable(b, B(b).kind)).join("");
}

function renderUrgency() {
	const answering = BACKENDS.filter((b) => B(b).urgency.n > 0);
	if (!answering.length) return ($("urgency").outerHTML = '<p class="empty">No backend answered urgency.</p>');
	$("urgency").innerHTML = table(
		[
			{ head: "Backend", cell: (r) => backendLabel(r.name, `<span class="sub-n">n ${r.u.n}</span>`) },
			col('Mean abs. error <span class="dir">↓ levels</span>', "low", (r) => r.u.mae, (x) => fmt.num(x, 2)),
			col('Exact level <span class="dir">↑</span>', "high", (r) => r.u.levelAccuracy, fmt.pct),
			{ head: 'False interrupts <span class="dir">↓</span>', dir: "low", value: (r) => r.u.falseInterrupt.rate, cell: (r) => fmt.rate(r.u.falseInterrupt) },
			{ head: 'Missed interrupts <span class="dir">↓</span>', dir: "low", value: (r) => r.u.missedInterrupt.rate, cell: (r) => fmt.rate(r.u.missedInterrupt) },
		],
		answering.map((name) => ({ name, u: B(name).urgency })),
		{ caption: "urgency per backend" },
	);
}

function renderOther() {
	const binary = (title, key, blurb) => {
		const answering = BACKENDS.filter((b) => B(b)[key].n > 0);
		if (!answering.length) return `<h3 class="sub">${title}</h3><p class="empty">Not asked in this run${run.questionSet === "core" ? " (question set: core)" : ""}.</p>`;
		return `<h3 class="sub">${title}</h3><p class="note">${blurb}</p><div class="scroll">${table(
			[
				{ head: "Backend", cell: (r) => backendLabel(r.name, `<span class="sub-n">n ${r.m.n} · ${r.m.positives} yes</span>`) },
				col('Accuracy <span class="dir">↑</span>', "high", (r) => r.m.accuracy, fmt.pct),
				{ head: "Precision", cell: (r) => fmt.pct(r.m.precision) },
				{ head: "Recall", cell: (r) => fmt.pct(r.m.recall) },
				col('Brier <span class="dir">↓</span>', "low", (r) => r.m.brier, fmt.num),
				col('ECE <span class="dir">↓</span>', "low", (r) => r.m.ece, fmt.num),
				col('AUROC <span class="dir">↑</span>', "high", (r) => r.m.auroc, (x) => fmt.num(x, 2)),
			],
			answering.map((name) => ({ name, m: B(name)[key] })),
			{ caption: title },
		)}</div>`;
	};
	const primary = BACKENDS.filter((b) => B(b).primary.n > 0);
	const primaryHtml = primary.length
		? `<div class="scroll">${table(
				[
					{ head: "Backend", cell: (r) => backendLabel(r.name, `<span class="sub-n">n ${B(r.name).primary.n}</span>`) },
					col('Right element <span class="dir">↑</span>', "high", (r) => B(r.name).primary.accuracy, fmt.pct),
				],
				primary.map((name) => ({ name })),
				{ caption: "primary" },
			)}</div>`
		: `<p class="empty">Not asked in this run${run.questionSet === "core" ? " (question set: core)" : ""}.</p>`;
	$("other").innerHTML =
		binary("Sensitive", "sensitive", "Does the after screen show passwords, card details, private messages, health or ID documents? Only protects anything when it runs on-device.") +
		`<h3 class="sub">Primary action</h3>${primaryHtml}` +
		binary("Supported narration", "supported", "Both narrations pooled: the true one should get a high P(supported), the one with an invented detail a low one.");
}

// --- noise -------------------------------------------------------------------------------------------------------

const ACTION_MARK = { interrupt: "!", queue: "•", mention: "·", drop: "" };

function renderNoise() {
	const sessions = BACKENDS[0] ? B(BACKENDS[0]).noise.sessions : [];
	if (!sessions.length) return ($("noise").innerHTML = '<p class="empty">This run has no session frames.</p>');
	$("noise").innerHTML = sessions
		.map((s, si) => {
			const rows = BACKENDS.map((name) => ({ name, s: B(name).noise.sessions[si] }));
			const frames = run.pairs.filter((p) => p.session && p.session.name === s.name).sort((a, b) => a.session.tMs - b.session.tMs);
			const strip = (name) =>
				frames
					.map((p) => {
						// The same verdict fields the noise table above counts, so the strip and the numbers can't disagree.
						const v = M.verdicts[p.id][name];
						const a = v.action ?? "drop"; // null on error: silence
						const wrong = v.saidWrongly;
						return `<span class="frame ${a}${wrong ? " wrong" : ""}" title="${esc(`${(p.session.tMs / 1000).toFixed(0)} s · ${p.scenario}: ${a}${wrong ? " (wrong)" : ""}`)}">${ACTION_MARK[a]}</span>`;
					})
					.join("");
			const labelled = frames
				.map((p) => {
					// A labelled announcement without a clear urgency is drawn as decide() would treat it: queued.
					const a = p.labels.announce === true ? URGENCY_NAMES[p.labels.urgency] ?? URGENCY_NAMES[NO_URGENCY_LEVEL] : URGENCY_NAMES[0];
					return `<span class="frame ${a}" title="${esc(`${(p.session.tMs / 1000).toFixed(0)} s · ${p.scenario}: labelled ${a}`)}">${ACTION_MARK[a]}</span>`;
				})
				.join("");
			return `<div class="session"><h3>${esc(s.name)} <span class="muted small">· ${s.frames} frames · ${isNum(s.minutes) ? `${s.minutes.toFixed(1)} min` : "untimed"}</span></h3>
				<div class="scroll">${table(
					[
						{ head: "Backend", cell: (r) => backendLabel(r.name) },
						{ head: `Announced <span class="dir">labelled ${s.labelled} (${fmt.perMin(s.labelledPerMin)})</span>`, dir: (v) => Math.abs(v - s.labelled), value: (r) => r.s.predicted, cell: (r) => `${r.s.predicted} <span class="sub-n">${fmt.perMin(r.s.predictedPerMin)}</span>` },
						col('False <span class="dir">↓</span>', "low", (r) => r.s.falseAnnouncements),
						col('Missed <span class="dir">↓</span>', "low", (r) => r.s.missedAnnouncements),
					],
					rows,
					{ caption: `${s.name}: announcements per backend` },
				)}</div>
				<div class="strip" aria-label="${esc(`${s.name}: what each backend would have said, frame by frame`)}" role="group">
					<span class="who">labelled</span><div class="frames neutral" style="--c:var(--ink-2)">${labelled}</div>
					${BACKENDS.map((b) => `<span class="who">${esc(b)}</span><div class="frames" style="--c:var(--c-${cssId(b)})">${strip(b)}</div>`).join("")}
				</div></div>`;
		})
		.join("") +
		`<div class="legend neutral" aria-label="Legend"><span><span class="frame interrupt" style="--c:var(--ink-2)">!</span> interrupt</span><span><span class="frame queue" style="--c:var(--ink-2)">•</span> queue</span><span><span class="frame mention" style="--c:var(--ink-2)">·</span> mention</span><span><span class="frame"></span> silent</span><span><span class="frame wrong"></span> spoke when it shouldn't, or stayed silent when it should have</span></div>`;
}

// --- cost --------------------------------------------------------------------------------------------------------

function renderCost() {
	$("cost").innerHTML = table(
		[
			{ head: "Backend", cell: (r) => backendLabel(r.name) },
			{ head: "Results", cell: (r) => r.c.results },
			col('Errors <span class="dir">↓</span>', "low", (r) => r.c.errors),
			{ head: "Cached", cell: (r) => r.c.cached },
			col('p50 <span class="dir">↓</span>', "low", (r) => r.c.latencyP50, fmt.ms),
			col('p95 <span class="dir">↓</span>', "low", (r) => r.c.latencyP95, fmt.ms),
			{ head: "Tokens / pair", cell: (r) => fmt.int(r.c.tokensPerPair) },
			{ head: "Tokens total", cell: (r) => fmt.int(r.c.inputTokens + r.c.outputTokens) },
			col('Cost / pair <span class="dir">↓</span>', "low", (r) => r.c.costPerPair, fmt.usd),
			{ head: "Cost total", cell: (r) => `${fmt.usd(r.c.costUsd)}${isNum(r.c.costUsd) && r.c.priced < r.c.results - r.c.errors ? `<span class="sub-n">${r.c.priced} of ${r.c.results - r.c.errors} priced</span>` : ""}` },
		],
		BACKENDS.map((name) => ({ name, c: B(name).cost })),
		{ caption: "cost and latency per backend" },
	);
}

renderFacts();
renderHeadline();
renderCalibration();
renderKind();
renderUrgency();
renderOther();
renderNoise();
renderCost();

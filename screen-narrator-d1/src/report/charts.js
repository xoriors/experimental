// Formatting helpers and hand-written SVG/HTML charts. Everything returns an HTML string; every piece of run data
// goes through esc() because ids, errors and narrations come from files we didn't write by hand.
// The first script on the page, so it also reads the JSON src/report.ts inlined: { run, metrics, constants, imageBase,
// missing }. `constants` is the label vocabulary from types.ts and policy.ts, so no script keeps its own copy.
"use strict";

const DATA = JSON.parse(document.getElementById("report-data").textContent);
const { changeKinds: KINDS, urgencyLevels: URGENCY_NAMES, ambiguous: AMB, noUrgencyLevel: NO_URGENCY_LEVEL } = DATA.constants;

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const NA = '<span class="muted" title="no data">—</span>';
const isNum = (x) => typeof x === "number" && Number.isFinite(x);

const fmt = {
	pct: (x, d = 1) => (isNum(x) ? `${(x * 100).toFixed(d)} %` : NA),
	num: (x, d = 3) => (isNum(x) ? x.toFixed(d) : NA),
	p: (x) => (isNum(x) ? x.toFixed(2) : NA),
	ms: (x) => (!isNum(x) ? NA : x >= 1000 ? `${(x / 1000).toFixed(x >= 10_000 ? 0 : 1)} s` : `${Math.round(x)} ms`),
	int: (x) => (isNum(x) ? Math.round(x).toLocaleString("en") : NA),
	usd: (x) => {
		if (!isNum(x)) return '<span class="muted" title="price unknown">unknown</span>';
		if (x === 0) return "free";
		if (x >= 1) return `$${x.toFixed(2)}`;
		// Two significant figures: per-pair costs are fractions of a cent.
		return `$${x.toPrecision(2).replace(/0+$/, "").replace(/\.$/, "")}`;
	},
	perMin: (x) => (isNum(x) ? `${x.toFixed(1)}/min` : NA),
	rate: (rc) => (rc && rc.of ? `${fmt.pct(rc.rate)} <span class="sub-n">${rc.count} of ${rc.of}</span>` : NA),
};

/** Backend name with its colour swatch; the colour follows the backend's slot in run.backends, never its rank. */
function backendLabel(name, extra = "") {
	return `<span class="backend" style="--c:var(--c-${cssId(name)})"><span class="swatch" aria-hidden="true"></span>${esc(name)}</span>${extra}`;
}
const cssId = (name) => String(name).replace(/[^a-zA-Z0-9_-]/g, "_");

/**
 * A table where some columns get their best value highlighted.
 * cols: [{ head, dir?: "high" | "low" | ((v) => number distance, lower is better), value(row), cell(row) }]
 */
function table(cols, rows, { caption = "" } = {}) {
	// Lower rank is better, whatever the column's direction.
	const rank = (c, v) => (c.dir === "high" ? -v : c.dir === "low" ? v : c.dir(v));
	const best = cols.map((c) => {
		if (!c.dir) return null;
		const vals = rows.map((r) => c.value(r)).filter(isNum);
		if (vals.length < 2) return null;
		return Math.min(...vals.map((v) => rank(c, v)));
	});
	const head = cols.map((c) => `<th scope="col">${c.head}</th>`).join("");
	const body = rows
		.map((r) => {
			const cells = cols
				.map((c, i) => {
					if (i === 0) return `<th scope="row">${c.cell(r)}</th>`;
					const v = c.value ? c.value(r) : null;
					const key = !isNum(v) || best[i] === null ? null : rank(c, v);
					const isBest = key !== null && Math.abs(key - best[i]) < 1e-12;
					const cls = isBest ? "best" : c.value && !isNum(v) ? "na" : "";
					return `<td class="${cls}">${c.cell(r)}${isBest ? '<span class="sr"> (best)</span>' : ""}</td>`;
				})
				.join("");
			return `<tr>${cells}</tr>`;
		})
		.join("");
	return `<table>${caption ? `<caption class="sr">${esc(caption)}</caption>` : ""}<thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

/**
 * Reliability diagram: bins as dots on [0,1]² against the diagonal, plus a strip of bin counts underneath.
 * `maxN` is shared across backends so the strips compare.
 */
function reliabilityChart(name, m, maxN, what) {
	const W = 240, P = 26, S = 200, HIST = 34, GAP = 22;
	const x = (v) => P + v * S;
	const y = (v) => 8 + (1 - v) * S;
	const base = 8 + S + GAP + HIST;
	const filled = m.bins.filter((b) => b.n > 0);
	const r = (n) => 3 + 6 * Math.sqrt(n / Math.max(1, maxN));
	const grid = [0.25, 0.5, 0.75].map((v) => `<line class="gridline" x1="${x(0)}" x2="${x(1)}" y1="${y(v)}" y2="${y(v)}"/><line class="gridline" x1="${x(v)}" x2="${x(v)}" y1="${y(0)}" y2="${y(1)}"/>`).join("");
	const ticks = [0, 0.5, 1].map((v) => `<text x="${x(v)}" y="${base + 13}" text-anchor="middle">${v}</text><text x="${P - 5}" y="${y(v) + 3}" text-anchor="end">${v}</text>`).join("");
	const path = filled.map((b, i) => `${i ? "L" : "M"}${x(b.meanPred).toFixed(1)},${y(b.fracPositive).toFixed(1)}`).join("");
	const dots = filled
		.map((b) => `<circle class="dot" cx="${x(b.meanPred).toFixed(1)}" cy="${y(b.fracPositive).toFixed(1)}" r="${r(b.n).toFixed(1)}"><title>${b.lo.toFixed(1)}–${b.hi.toFixed(1)}: ${b.n} answers, mean p ${b.meanPred.toFixed(2)}, ${(b.fracPositive * 100).toFixed(0)} % yes</title></circle>`)
		.join("");
	const bw = S / m.bins.length;
	const hist = m.bins
		.map((b, i) => {
			const h = b.n ? Math.max(1.5, (b.n / Math.max(1, maxN)) * HIST) : 0;
			return h ? `<rect class="hist" x="${(P + i * bw + 1).toFixed(1)}" y="${(base - h).toFixed(1)}" width="${(bw - 2).toFixed(1)}" height="${h.toFixed(1)}" rx="2"><title>${b.lo.toFixed(1)}–${b.hi.toFixed(1)}: ${b.n}</title></rect>` : "";
		})
		.join("");
	const label = `${name} ${what} reliability: ${m.n} answers, ECE ${isNum(m.ece) ? m.ece.toFixed(3) : "n/a"}. ` +
		filled.map((b) => `${b.lo.toFixed(1)} to ${b.hi.toFixed(1)}: ${b.n} answers, ${(b.fracPositive * 100).toFixed(0)} % yes`).join("; ");
	const svg = `<svg viewBox="0 0 ${W} ${base + 34}" role="img" aria-label="${esc(label)}">
		${grid}
		<line class="ax" x1="${x(0)}" x2="${x(1)}" y1="${y(0)}" y2="${y(0)}"/><line class="ax" x1="${x(0)}" x2="${x(0)}" y1="${y(0)}" y2="${y(1)}"/>
		<line class="diag" x1="${x(0)}" y1="${y(0)}" x2="${x(1)}" y2="${y(1)}"/>
		<path class="curve" d="${path}"/>${dots}
		<line class="ax" x1="${x(0)}" x2="${x(1)}" y1="${base}" y2="${base}"/>${hist}${ticks}
		<text x="${x(0.5)}" y="${base + 30}" text-anchor="middle" class="axis-title">predicted probability</text>
	</svg>`;
	const rows = m.bins.map((b) => `<tr><td>${b.lo.toFixed(1)}–${b.hi.toFixed(1)}</td><td>${b.n}</td><td>${fmt.p(b.meanPred)}</td><td>${fmt.pct(b.fracPositive, 0)}</td></tr>`).join("");
	return `<figure class="chart" style="--c:var(--c-${cssId(name)})">
		<h3>${backendLabel(name)}</h3>
		${svg}
		<p class="stats">ECE <b>${fmt.num(m.ece)}</b> · Brier <b>${fmt.num(m.brier)}</b><br>n ${m.n}${isNum(m.auroc) ? ` · AUROC ${fmt.num(m.auroc, 2)}` : ""}</p>
		<details><summary>Bins as a table</summary><div class="scroll"><table><thead><tr><th scope="col">Bin</th><th scope="col">n</th><th scope="col">Mean p</th><th scope="col">Yes</th></tr></thead><tbody>${rows}</tbody></table></div></details>
	</figure>`;
}

/** kind confusion matrix as a table: rows = label, columns = choice, cells shaded by share of the row. */
function confusionTable(name, k) {
	const rows = k.labels.map((label, i) => {
		const row = k.confusion[i];
		const total = row.reduce((a, b) => a + b, 0);
		const cells = row.map((v, j) => {
			const share = total ? v / total : 0;
			const cls = [i === j ? "diag-cell" : "", v === 0 ? "zero" : "", share > 0.55 ? "hot" : ""].join(" ");
			return `<td class="${cls}" style="--v:${share.toFixed(3)}" title="label ${label}, chose ${k.labels[j]}: ${v}">${v || "·"}</td>`;
		});
		return `<tr><th scope="row">${esc(label)} <span class="muted">(${total})</span></th>${cells.join("")}</tr>`;
	});
	const head = k.labels.map((l) => `<th scope="col">${esc(l)}</th>`).join("");
	return `<div class="matrix"><h3>${backendLabel(name)} <span class="muted small">· ${fmt.pct(k.accuracy)} right of ${k.n}</span></h3>
		<div class="inner"><table><caption class="sr">${esc(name)}: labelled kind (rows) against chosen kind (columns)</caption>
		<thead><tr><th scope="col">label ↓ chose →</th>${head}</tr></thead><tbody>${rows.join("")}</tbody></table></div></div>`;
}

/** A probability bar with the number on it and, optionally, a tick at the decision threshold. */
function pbar(p, threshold) {
	if (!isNum(p)) return NA;
	const thr = isNum(threshold) ? `<span class="thr" style="--t:${threshold}" aria-hidden="true"></span>` : "";
	return `<span class="pbar" style="--p:${p.toFixed(3)}"><i></i>${thr}<b>${p.toFixed(2)}</b></span>`;
}

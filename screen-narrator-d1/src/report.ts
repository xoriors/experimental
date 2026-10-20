// `pnpm report [runId]`: runs/<id>/results.json → runs/<id>/report.html, one self-contained file (CSS, JS, the run
// and its metrics inlined; no network). Without a run id it reports the id in runs/latest.
// `pnpm report --sample` writes runs/sample/report.html from a synthetic run, to see the layout before benchmarking.
import { ROOT, fromRoot } from "./env.ts";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { computeMetrics, type RunMetrics } from "./metrics.ts";
import { sampleRun } from "./report/fixtures.ts";
import { AMBIGUOUS, CHANGE_KINDS, type RunResult, URGENCY_LEVELS } from "./types.ts";
import { errorMessage, isEntryPoint } from "./util.ts";

const REPORT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "report");
// Inlined in this order: helpers first, then the sections, then the pair browser that uses both.
const SCRIPTS = ["charts.js", "app.js", "browser.js"];

/** JSON that is safe inside a <script> element: no `<` survives, so neither `</script>` nor `<!--` can end it early. */
export const scriptSafeJson = (value: unknown): string => JSON.stringify(value).replace(/</g, "\\u003c");

const read = (name: string) => readFileSync(path.join(REPORT_DIR, name), "utf8");

/**
 * The report page for a run. `missing` lists image paths (project-relative) that don't exist, so the page shows a
 * placeholder instead of a broken image; the report lives two levels down (runs/<id>/), hence imageBase.
 */
export function renderReport(run: RunResult, metrics: RunMetrics, missing: string[] = []): string {
	// The page's label vocabulary comes from types.ts, so the scripts never keep their own copy; the thresholds the
	// page draws are already in metrics.thresholds.
	const constants = { changeKinds: CHANGE_KINDS, urgencyLevels: URGENCY_LEVELS, ambiguous: AMBIGUOUS };
	const data = scriptSafeJson({ run, metrics, constants, imageBase: "../../", missing });
	// Function replacers: a string replacement would interpret `$&`, `$'` … inside the data and the scripts.
	return read("template.html")
		.replace("{{TITLE}}", () => `Report ${escapeHtml(run.id)} · screen-narrator-d1`)
		.replace("/*{{STYLE}}*/", () => read("report.css"))
		.replace("{{DATA}}", () => data)
		.replace("/*{{SCRIPT}}*/", () => SCRIPTS.map(read).join("\n"));
}

const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

function missingImages(run: RunResult): string[] {
	const paths = new Set(run.pairs.flatMap((p) => [p.before, p.after]));
	return [...paths].filter((p) => !existsSync(fromRoot(p)));
}

function resolveRunId(arg: string | undefined): string {
	if (arg) return arg;
	const latest = fromRoot("runs", "latest");
	if (!existsSync(latest)) throw new Error("No run id given and runs/latest doesn't exist: run `pnpm bench` first, or try `pnpm report --sample`.");
	const id = readFileSync(latest, "utf8").trim();
	if (!id) throw new Error("runs/latest is empty");
	return id;
}

function main(argv: string[]): void {
	const sample = argv.includes("--sample");
	const arg = argv.find((a) => !a.startsWith("--"));
	let run: RunResult;
	if (sample) run = sampleRun();
	else {
		const id = resolveRunId(arg);
		const file = fromRoot("runs", id, "results.json");
		if (!existsSync(file)) throw new Error(`${path.relative(ROOT, file)} not found`);
		run = JSON.parse(readFileSync(file, "utf8")) as RunResult;
	}
	const outDir = fromRoot("runs", sample ? "sample" : run.id);
	mkdirSync(outDir, { recursive: true });
	const out = path.join(outDir, "report.html");
	const missing = missingImages(run);
	writeFileSync(out, renderReport(run, computeMetrics(run), missing));
	console.log(`Report for run ${run.id}: ${run.pairs.length} pairs × ${run.backends.length} backends${missing.length ? ` (${missing.length} images missing, shown as placeholders)` : ""}`);
	console.log(out);
	console.log(`Open it with: xdg-open ${out}`);
}

if (isEntryPoint(import.meta.url)) {
	try {
		main(process.argv.slice(2));
	} catch (err) {
		console.error(errorMessage(err));
		process.exit(1);
	}
}

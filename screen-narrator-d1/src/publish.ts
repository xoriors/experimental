// `pnpm site [runId]`: builds public/, the static site the README links to (deployed to Vercel with
// `vercel deploy --prod` from this folder; vercel.json + .vercelignore upload public/ only).
// - public/index.html: the run's report, with image paths pointing next to it instead of up to the project root.
// - public/data/pairs/<id>/{before,after}.png: only the screenshots that run uses (synthetic fixture screens).
// - public/results.json: the raw run, for anyone who wants to re-score it.
// Without a run id it publishes the run in runs/latest.
import { fromRoot } from "./env.ts";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { computeMetrics } from "./metrics.ts";
import { missingImages, renderReport, resolveRunId } from "./report.ts";
import type { RunResult } from "./types.ts";
import { errorMessage, isEntryPoint } from "./util.ts";

const OUT = fromRoot("public");

function main(argv: string[]): void {
	const id = resolveRunId(argv.find((a) => !a.startsWith("--")));
	const file = fromRoot("runs", id, "results.json");
	if (!existsSync(file)) throw new Error(`runs/${id}/results.json not found`);
	const run = JSON.parse(readFileSync(file, "utf8")) as RunResult;
	const missing = missingImages(run);
	if (missing.length) throw new Error(`${missing.length} screenshots are missing (e.g. ${missing[0]}): run \`pnpm capture\` first`);

	rmSync(OUT, { recursive: true, force: true });
	let bytes = 0;
	for (const rel of new Set(run.pairs.flatMap((p) => [p.before, p.after]))) {
		const dest = path.join(OUT, rel);
		mkdirSync(path.dirname(dest), { recursive: true });
		copyFileSync(fromRoot(rel), dest);
		bytes += statSync(dest).size;
	}
	writeFileSync(path.join(OUT, "index.html"), renderReport(run, computeMetrics(run), [], ""));
	copyFileSync(file, path.join(OUT, "results.json"));
	console.log(`public/ built from run ${id}: report + ${run.pairs.length} pairs (${(bytes / 1e6).toFixed(1)} MB of screenshots)`);
	console.log("Deploy: vercel deploy --prod --yes   (from screen-narrator-d1/)");
}

if (isEntryPoint(import.meta.url)) {
	try {
		main(process.argv.slice(2));
	} catch (err) {
		console.error(errorMessage(err));
		process.exit(1);
	}
}

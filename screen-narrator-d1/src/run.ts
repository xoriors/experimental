// `pnpm bench`: ask every selected backend about every pair and write runs/<id>/results.json for the report.
// Paid backends go through runs/cache, so re-running after a crash or with one more backend only pays for what's new.
// A failing call is recorded on its PairResult and the run goes on: one bad pair must not cost the other answers.
import "./env.ts";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs as parseArgv } from "node:util";
import { BACKEND_NAMES, backendByName, isBackendName } from "./backends/index.ts";
import type { Backend } from "./backends/types.ts";
import { cacheKeyFor, readCache, writeCache } from "./cache.ts";
import { fromRoot, ROOT } from "./env.ts";
import { pngBytesDataUrl } from "./images.ts";
import { costMetrics } from "./metrics.ts";
import { questionsFor } from "./questions.ts";
import type { Pair, PairResult, QuestionSet, RunResult } from "./types.ts";
import { errorMessage, isEntryPoint, pool } from "./util.ts";

export interface RunOptions {
	backends: string[];
	questions: QuestionSet;
	filter?: string;
	limit?: number;
	concurrency: number;
	cache: boolean;
	index: string;
	dryRun: boolean;
}

const USAGE = `Usage: pnpm bench [options]
  --backends a,b,c   ${BACKEND_NAMES.join(", ")} (default d1-ultra,d1,pixel-diff)
  --questions SET    core | all (default all)
  --filter TEXT      only pairs whose id or scenario contains TEXT
  --limit N          only the first N pairs (after --filter)
  --concurrency N    parallel calls per backend (default 4)
  --no-cache         always call the API (fresh answers still go into the cache)
  --index PATH       pairs index, absolute or relative to the project (default data/pairs/index.json)
  --dry-run          print what would be asked and an estimated cost; no calls`;

const positiveInt = (flag: string, v: string): number => {
	const n = Number(v);
	if (!Number.isInteger(n) || n < 1) throw new Error(`${flag} needs a positive integer, got "${v}"`);
	return n;
};

export function parseArgs(argv: string[]): RunOptions {
	// Strict: an unknown flag, a positional, or a flag missing its value (`--filter --dry-run`) throws.
	const { values: v } = parseArgv({
		args: argv,
		strict: true,
		options: {
			backends: { type: "string" },
			questions: { type: "string" },
			filter: { type: "string" },
			limit: { type: "string" },
			concurrency: { type: "string" },
			index: { type: "string" },
			"no-cache": { type: "boolean" },
			"dry-run": { type: "boolean" },
			help: { type: "boolean", short: "h" },
		},
	});
	if (v.help) {
		console.log(USAGE);
		process.exit(0);
	}
	const o: RunOptions = {
		backends: ["d1-ultra", "d1", "pixel-diff"],
		questions: "all",
		concurrency: 4,
		cache: !v["no-cache"],
		index: v.index ?? "data/pairs/index.json",
		dryRun: v["dry-run"] ?? false,
	};
	if (v.backends !== undefined) {
		o.backends = [...new Set(v.backends.split(",").map((s) => s.trim()).filter(Boolean))];
		const unknown = o.backends.filter((b) => !isBackendName(b));
		if (unknown.length) throw new Error(`Unknown backend ${unknown.join(", ")}. Known: ${BACKEND_NAMES.join(", ")}`);
		if (!o.backends.length) throw new Error("--backends is empty");
	}
	if (v.questions !== undefined) {
		if (v.questions !== "core" && v.questions !== "all") throw new Error(`--questions must be core or all, got "${v.questions}"`);
		o.questions = v.questions;
	}
	if (v.filter !== undefined) o.filter = v.filter;
	if (v.limit !== undefined) o.limit = positiveInt("--limit", v.limit);
	if (v.concurrency !== undefined) o.concurrency = positiveInt("--concurrency", v.concurrency);
	return o;
}

export function selectPairs(pairs: Pair[], o: Pick<RunOptions, "filter" | "limit">): Pair[] {
	const f = o.filter;
	const picked = f ? pairs.filter((p) => p.id.includes(f) || p.scenario.includes(f)) : pairs;
	return o.limit ? picked.slice(0, o.limit) : picked;
}

/** `YYYYMMDD-HHMMSS` in local time: sortable, and readable next to the clock on the wall. */
export function runId(d = new Date()): string {
	const p = (n: number) => String(n).padStart(2, "0");
	return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

const fmtUsd = (x: number | null): string => (x === null ? "n/a" : `$${x < 0.01 ? x.toFixed(5) : x.toFixed(3)}`);
const fmtTokens = (n: number): string => n.toLocaleString("en");

function dryRun(pairs: Pair[], o: RunOptions): void {
	const totalQuestions = pairs.reduce((sum, p) => sum + Object.keys(questionsFor(p, o.questions)).length, 0);
	console.log(`${pairs.length} pairs × ${o.questions} questions = ${totalQuestions} questions per backend (dry run, no calls)\n`);
	for (const backend of o.backends.map(backendByName)) {
		const name = backend.name.padEnd(10);
		if (!backend.estimate) {
			console.log(`${name} no estimate`);
			continue;
		}
		const estimates = pairs.map((p) => backend.estimate!(p, o.questions));
		const inTok = estimates.reduce((s, e) => s + e.inputTokens, 0);
		const outTok = estimates.reduce((s, e) => s + e.outputTokens, 0);
		// One unknown price makes the total unknown.
		const cost = estimates.some((e) => e.costUsd === null) ? null : estimates.reduce((s, e) => s + e.costUsd!, 0);
		if (inTok + outTok === 0 && cost === 0) console.log(`${name} free (local)`);
		else
			console.log(
				`${name} ~${fmtTokens(inTok)} input${outTok ? ` + ~${fmtTokens(outTok)} output` : ""} tokens, ${cost === null ? "cost n/a (unknown price)" : `~${fmtUsd(cost)}`}`,
			);
	}
	console.log("\nCached answers are not subtracted from these estimates.");
}

export async function askOne(backend: Backend, pair: Pair, set: QuestionSet, useCache: boolean): Promise<PairResult> {
	const base = { pairId: pair.id, backend: backend.name };
	const t0 = performance.now();
	try {
		// Read each PNG once: the cache key hashes these bytes and the backend gets them as data URLs.
		const bytes = { before: readFileSync(fromRoot(pair.before)), after: readFileSync(fromRoot(pair.after)) };
		const key = backend.cacheable ? cacheKeyFor(backend.fingerprint, pair, set, bytes) : undefined;
		if (key && useCache) {
			const hit = readCache(key);
			if (hit) return { ...base, ...hit.output, latencyMs: hit.latencyMs, cached: true };
		}
		const images: [string, string] = [pngBytesDataUrl(bytes.before), pngBytesDataUrl(bytes.after)];
		const t1 = performance.now();
		const out = await backend.answer({ pair, questionSet: set, images });
		const latencyMs = Math.round(performance.now() - t1);
		if (key) {
			// The answer is already paid for: a failed cache write (disk full, permissions) must not turn it into an error.
			try {
				writeCache(key, out, latencyMs);
			} catch (err) {
				console.error(`[${backend.name}] ${pair.id}: answer not cached: ${errorMessage(err)}`);
			}
		}
		return { ...base, ...out, latencyMs, cached: false };
	} catch (err) {
		return { ...base, error: errorMessage(err), latencyMs: Math.round(performance.now() - t0) };
	}
}

export function summarize(backends: string[], results: PairResult[]): string {
	const header = ["backend", "answered", "errors", "cached", "fresh p50 ms", "tokens", "cost (this run)"];
	const rows = backends.map((name) => {
		const rs = results.filter((r) => r.backend === name);
		const all = costMetrics(rs);
		// Only fresh calls cost money and time in this run. Like the report, an unpriced answer leaves a partial sum.
		const fresh = costMetrics(rs.filter((r) => !r.cached));
		const freshAnswered = fresh.results - fresh.errors;
		const partial = fresh.costUsd !== null && fresh.priced < freshAnswered ? ` (${fresh.priced} of ${freshAnswered} priced)` : "";
		return [
			name,
			String(all.results - all.errors),
			String(all.errors),
			String(all.cached),
			fresh.latencyP50 === null ? "-" : String(fresh.latencyP50),
			fmtTokens(all.inputTokens + all.outputTokens),
			// Nothing fresh means nothing was spent, even when the cached answers' price is unknown.
			fresh.results === 0 ? fmtUsd(0) : fmtUsd(fresh.costUsd) + partial,
		];
	});
	const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i]!.length)));
	const line = (cells: string[]) => cells.map((c, i) => (i === 0 ? c.padEnd(widths[i]!) : c.padStart(widths[i]!))).join("  ");
	return [line(header), ...rows.map(line)].join("\n");
}

export async function main(argv: string[]): Promise<void> {
	let o: RunOptions;
	try {
		o = parseArgs(argv);
	} catch (err) {
		console.error(USAGE);
		throw err;
	}
	const indexPath = path.resolve(ROOT, o.index);
	if (!existsSync(indexPath)) throw new Error(`No pairs index at ${o.index}. Run \`pnpm capture\` first, or pass --index.`);
	const all = JSON.parse(readFileSync(indexPath, "utf8")) as Pair[];
	const pairs = selectPairs(all, o);
	if (!pairs.length) throw new Error(`No pairs match${o.filter ? ` --filter "${o.filter}"` : ""} in ${o.index} (${all.length} pairs).`);

	if (o.dryRun) return dryRun(pairs, o);

	// Build every backend up front, so a bad setting (e.g. NARRATOR_VLM_EFFORT) fails before any money is spent.
	const backends = o.backends.map(backendByName);
	const id = runId();
	console.log(`Run ${id}: ${pairs.length} pairs × ${backends.map((b) => b.name).join(", ")} (questions: ${o.questions}${o.cache ? "" : ", no cache"})`);

	const results = (
		await Promise.all(
			backends.map(async (backend) => {
				let done = 0;
				let errors = 0;
				const every = Math.max(1, Math.ceil(pairs.length / 10));
				return pool(pairs, o.concurrency, async (pair) => {
					const r = await askOne(backend, pair, o.questions, o.cache);
					done++;
					if (r.error) {
						errors++;
						// The first error per backend in full; the rest only in results.json and the counter.
						if (errors === 1) console.error(`[${backend.name}] ${pair.id}: ${r.error}`);
					}
					if (done % every === 0 || done === pairs.length) console.log(`[${backend.name}] ${done}/${pairs.length}${errors ? ` (${errors} errors)` : ""}`);
					return r;
				});
			}),
		)
	).flat();

	const run: RunResult = { id, createdAt: new Date().toISOString(), backends: backends.map((b) => b.name), questionSet: o.questions, pairs, results };
	const dir = fromRoot("runs", id);
	mkdirSync(dir, { recursive: true });
	writeFileSync(`${dir}/results.json`, JSON.stringify(run, null, 1));
	writeFileSync(fromRoot("runs", "latest"), `${id}\n`);

	console.log(`\n${summarize(run.backends, results)}\n\nWrote runs/${id}/results.json\nNext: pnpm report ${id}`);
}

if (isEntryPoint(import.meta.url)) {
	main(process.argv.slice(2)).catch((err: unknown) => {
		console.error(errorMessage(err));
		process.exit(1);
	});
}

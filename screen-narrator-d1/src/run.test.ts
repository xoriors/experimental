import { describe, expect, it } from "vitest";
import type { Backend } from "./backends/types.ts";
import { askOne, parseArgs, runId, selectPairs, summarize } from "./run.ts";
import type { Pair, PairResult } from "./types.ts";

describe("parseArgs", () => {
	it("has the documented defaults", () => {
		expect(parseArgs([])).toEqual({
			backends: ["d1-ultra", "d1", "pixel-diff"],
			questions: "all",
			concurrency: 4,
			cache: true,
			index: "data/pairs/index.json",
			dryRun: false,
		});
	});

	it("reads every flag, in both --flag value and --flag=value forms", () => {
		expect(
			parseArgs(["--backends", "vlm,pixel-diff,vlm", "--questions=core", "--filter", "toast", "--limit", "3", "--concurrency=2", "--no-cache", "--index", "x.json", "--dry-run"]),
		).toEqual({ backends: ["vlm", "pixel-diff"], questions: "core", filter: "toast", limit: 3, concurrency: 2, cache: false, index: "x.json", dryRun: true });
	});

	it("rejects bad input", () => {
		expect(() => parseArgs(["--backends", "gpt"])).toThrow(/Unknown backend gpt/);
		expect(() => parseArgs(["--questions", "some"])).toThrow(/core or all/);
		expect(() => parseArgs(["--limit", "0"])).toThrow(/positive integer/);
		expect(() => parseArgs(["--limit"])).toThrow(/argument missing/);
		expect(() => parseArgs(["--filter", "--dry-run"])).toThrow(/argument is ambiguous/);
		expect(() => parseArgs(["--frobnicate"])).toThrow(/Unknown option/);
		expect(() => parseArgs(["toast"])).toThrow(/Unexpected argument/);
		expect(() => parseArgs(["--backends", " , "])).toThrow(/empty/);
	});
});

describe("selectPairs", () => {
	const pairs = [
		{ id: "mail-dialog--dark", scenario: "confirm-dialog" },
		{ id: "chat-msg--light", scenario: "new-message" },
		{ id: "shop-toast--dark", scenario: "saved-toast" },
	] as Pair[];

	it("filters on id or scenario, then limits", () => {
		expect(selectPairs(pairs, { filter: "dark" }).map((p) => p.id)).toEqual(["mail-dialog--dark", "shop-toast--dark"]);
		expect(selectPairs(pairs, { filter: "new-message" })).toHaveLength(1);
		expect(selectPairs(pairs, { filter: "dark", limit: 1 })).toHaveLength(1);
		expect(selectPairs(pairs, {})).toHaveLength(3);
	});
});

describe("runId", () => {
	it("is YYYYMMDD-HHMMSS", () => {
		expect(runId(new Date(2026, 9, 5, 7, 8, 9))).toBe("20261005-070809");
	});
});

describe("askOne", () => {
	it("records a failing backend as an error instead of throwing", async () => {
		const failing: Backend = {
			name: "boom",
			cacheable: false,
			fingerprint: "boom",
			answer: async () => {
				throw new Error("kaput");
			},
		};
		// The images don't exist either: the error must still land on the result.
		const r = await askOne(failing, { id: "p", before: "missing/a.png", after: "missing/b.png" } as Pair, "core", true);
		expect(r).toMatchObject({ pairId: "p", backend: "boom" });
		expect(r.error).toMatch(/ENOENT|kaput/);
		expect(r.prediction).toBeUndefined();
	});
});

describe("summarize", () => {
	it("counts answers, errors and cache hits, and only bills fresh calls", () => {
		const results: PairResult[] = [
			{ pairId: "a", backend: "d1-ultra", latencyMs: 500, inputTokens: 1000, costUsd: 0.001, cached: false },
			{ pairId: "b", backend: "d1-ultra", latencyMs: 700, inputTokens: 1000, costUsd: 0.001, cached: true },
			{ pairId: "c", backend: "d1-ultra", latencyMs: 30, error: "x" },
			{ pairId: "a", backend: "d1", latencyMs: 400, inputTokens: 900, costUsd: null, cached: false },
		];
		const lines = summarize(["d1-ultra", "d1"], results).split("\n");
		expect(lines[1]!.split(/\s+/)).toEqual(["d1-ultra", "2", "1", "1", "500", "2,000", "$0.00100"]);
		expect(lines[2]!.split(/\s+/)).toEqual(["d1", "1", "0", "0", "400", "900", "n/a"]);
	});

	it("shows a partial sum, like the report, when only some fresh answers are priced", () => {
		const results: PairResult[] = [
			{ pairId: "a", backend: "vlm", latencyMs: 900, inputTokens: 100, costUsd: 0.002, cached: false },
			{ pairId: "b", backend: "vlm", latencyMs: 1100, inputTokens: 100, costUsd: null, cached: false },
		];
		expect(summarize(["vlm"], results).split("\n")[1]).toMatch(/\$0\.00200 \(1 of 2 priced\)$/);
	});

	it("bills nothing for a backend served entirely from the cache", () => {
		const results: PairResult[] = [{ pairId: "a", backend: "d1", latencyMs: 400, inputTokens: 900, costUsd: null, cached: true }];
		expect(summarize(["d1"], results).split("\n")[1]!.split(/\s+/)).toEqual(["d1", "1", "0", "1", "-", "900", "$0.00000"]);
	});
});

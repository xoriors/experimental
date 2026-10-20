// Keeps docs/decision.mmd honest: every label it quotes is derived here from decide() itself, so a change to the
// policy's words, levels or thresholds fails this test until the diagram is updated (then run `pnpm diagrams`).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { fromRoot } from "./env.ts";
import { DEFAULT_THRESHOLDS, decide, NO_URGENCY_LEVEL, TOP_URGENCY } from "./policy.ts";
import { type Prediction, URGENCY_LEVELS } from "./types.ts";

const mmd = readFileSync(fromRoot("docs", "decision.mmd"), "utf8");
const t = DEFAULT_THRESHOLDS;

const dialog = (kindP: number, sensitive = 0): Prediction => ({
	announce: 1,
	kind: { choice: "dialog", probabilities: { dialog: kindP } },
	urgency: { score: TOP_URGENCY, probabilities: {} },
	sensitive,
});

describe("docs/decision.mmd matches decide()", () => {
	const plain = decide(dialog(1)).speech;

	it("names every urgency level", () => {
		for (const level of URGENCY_LEVELS) expect(mmd).toContain(level);
	});

	it("quotes the confident and the hedged phrase", () => {
		expect(mmd).toContain(`'${plain}'`);
		expect(mmd).toContain(`'${decide(dialog(t.confident / 2)).speech}'`);
	});

	it("quotes the generic phrase used when no kind was answered", () => {
		const { kind: _, ...noKind } = dialog(1);
		expect(mmd).toContain(`'${decide(noKind).speech}'`);
	});

	it("routes a missing urgency answer to the level decide() uses", () => {
		const { urgency: _, ...noUrgency } = dialog(1);
		expect(decide(noUrgency).action).toBe(URGENCY_LEVELS[NO_URGENCY_LEVEL]);
		expect(mmd).toContain(`level ${NO_URGENCY_LEVEL}`);
	});

	it("quotes the sensitive suffix", () => {
		const suffix = decide(dialog(1, 1)).speech.slice(plain.length).replace(/^\W+/, "");
		expect(suffix).not.toBe("");
		expect(mmd).toContain(`'${suffix}'`);
	});

	it("only names thresholds that exist", () => {
		const named = [...mmd.matchAll(/thresholds\.(\w+)/g)].map((m) => m[1]);
		expect(named.length).toBeGreaterThan(0);
		for (const name of named) expect(Object.keys(t)).toContain(name);
	});
});

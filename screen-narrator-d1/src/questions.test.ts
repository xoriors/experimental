import { describe, expect, it } from "vitest";
import { KIND, noulOf, toPrediction, URGENCY } from "./questions.ts";
import { CHANGE_KINDS, URGENCY_LEVELS } from "./types.ts";

describe("question set vs the shared enums", () => {
	it("has one urgency rubric level per URGENCY_LEVELS entry", () => {
		expect(URGENCY.criteria).toHaveLength(URGENCY_LEVELS.length);
	});

	it("offers exactly the CHANGE_KINDS as kind labels, in order", () => {
		expect(Object.keys(KIND.criteria)).toEqual([...CHANGE_KINDS]);
	});
});

describe("toPrediction", () => {
	it("pairs the true and invented narrations, and skips the pair when either is missing or malformed", () => {
		expect(toPrediction({ supportedTrue: { noul: 0.9 }, supportedFalse: { noul: 0.1 } }).supported).toEqual({ supported: 0.9, unsupported: 0.1 });
		expect(toPrediction({ supportedTrue: { noul: 0.9 } }).supported).toBeUndefined();
		expect(toPrediction({ supportedTrue: { noul: 0.9 }, supportedFalse: { noul: "x" } }).supported).toBeUndefined();
	});

	it("leaves a malformed announce / sensitive answer absent rather than scoring it as 0", () => {
		const p = toPrediction({ announce: { noul: null }, sensitive: { noul: Number.NaN } });
		expect(p.announce).toBeUndefined();
		expect(p.sensitive).toBeUndefined();
	});

	it("noulOf reads one yes-probability by key", () => {
		expect(noulOf({ supported: { noul: 0.7 } }, "supported")).toBe(0.7);
		expect(noulOf({ supported: { noul: Number.NaN } }, "supported")).toBeUndefined();
		expect(noulOf({}, "supported")).toBeUndefined();
	});
});

describe("malformed urgency answers", () => {
	it("leave urgency absent, so decide() treats them like a missing answer instead of throwing", async () => {
		const { decide } = await import("./policy.ts");
		const p = toPrediction({ announce: { noul: 0.9 }, urgency: { score: null, probabilities: {} } });
		expect(p.urgency).toBeUndefined();
		expect(decide(p).action).toBe("queue");
		expect(() => decide({ announce: 0.9, urgency: { score: Number.NaN, probabilities: {} } })).not.toThrow();
	});
});

// Checks the variant rotation, and that data/pairs/index.json (when captured) matches the Pair contract.
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SCENARIOS, SESSION } from "../fixtures/scenarios.ts";
import { variantsFor } from "./capture.ts";
import { fromRoot } from "./env.ts";
import { AMBIGUOUS, CHANGE_KINDS, type Pair } from "./types.ts";

describe("variantsFor", () => {
	it.each(SCENARIOS.map((s, i) => [s.id, i] as const))("%s gets every viewport × theme, both densities and Spanish once per theme", (_, i) => {
		const vs = variantsFor(i);
		expect(new Set(vs.map((v) => `${v.viewport.width}x${v.viewport.height}-${v.theme}`)).size).toBe(6);
		expect(vs.filter((v) => v.density === "compact")).toHaveLength(3);
		const es = vs.filter((v) => v.lang === "es");
		expect(es.map((v) => v.theme).sort()).toEqual(["dark", "light"]);
	});
});

const indexPath = fromRoot("data/pairs/index.json");
const pairs: Pair[] = existsSync(indexPath) ? JSON.parse(readFileSync(indexPath, "utf8")) : [];

/** Width and height from a PNG's IHDR chunk. */
function pngSize(path: string): [number, number] {
	const buf = readFileSync(path);
	return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
}

describe.skipIf(pairs.length === 0)("data/pairs/index.json", () => {
	it("has unique, filesystem-safe ids", () => {
		expect(new Set(pairs.map((p) => p.id)).size).toBe(pairs.length);
		for (const p of pairs) expect(p.id).toMatch(/^[a-z0-9-]+$/);
	});

	it("points at viewport-sized PNGs that exist", () => {
		for (const p of pairs) {
			for (const rel of [p.before, p.after]) {
				expect(existsSync(fromRoot(rel)), rel).toBe(true);
				expect(pngSize(fromRoot(rel)), rel).toEqual([p.width, p.height]);
			}
			expect([p.width, p.height]).toEqual([p.variant.viewport.width, p.variant.viewport.height]);
		}
	});

	it("has well-formed labels", () => {
		for (const { id, labels: l } of pairs) {
			expect([true, false, AMBIGUOUS], id).toContain(l.announce);
			expect([...CHANGE_KINDS, AMBIGUOUS], id).toContain(l.kind);
			expect([0, 1, 2, 3, AMBIGUOUS], id).toContain(l.urgency);
			expect(typeof l.sensitive, id).toBe("boolean");
			if (l.primary) {
				expect(Object.keys(l.primary.candidates).length, id).toBeLessThanOrEqual(30);
				expect(Object.keys(l.primary.candidates), id).toContain(l.primary.answer);
			}
			if (l.narrations) {
				expect(l.narrations.supported.length, id).toBeGreaterThan(10);
				expect(l.narrations.unsupported, id).not.toBe(l.narrations.supported);
			}
		}
	});

	it("labels each scenario the way fixtures/scenarios.ts defines it", () => {
		for (const s of SCENARIOS) {
			const mine = pairs.filter((p) => p.scenario === s.id && !p.session);
			expect(mine.length, s.id).toBeLessThanOrEqual(6);
			for (const p of mine) {
				expect(p.labels, p.id).toMatchObject(s.labels);
				expect(!!p.labels.primary, p.id).toBe(!!s.primary);
				expect(!!p.labels.narrations, p.id).toBe(!!s.narrations);
			}
		}
		for (const p of pairs.filter((p) => p.scenario === "password-reveal")) expect(p.focused, p.id).toMatch(/^textbox "/);
	});

	it("has the whole set after a full capture", () => {
		const scenarios = new Set(pairs.filter((p) => !p.session).map((p) => p.scenario));
		if (scenarios.size < SCENARIOS.length) return; // a filtered capture: nothing to count
		expect(pairs.filter((p) => !p.session)).toHaveLength(SCENARIOS.length * 6);
		expect(pairs.filter((p) => p.session)).toHaveLength(SESSION.steps.length);
	});

	it("has a session of consecutive frames, mostly quiet", () => {
		const steps = pairs.filter((p) => p.session?.name === SESSION.name).sort((a, b) => a.session!.step - b.session!.step);
		if (steps.length < SESSION.steps.length) return;
		steps.forEach((p, i) => {
			expect(p.session).toEqual({ name: SESSION.name, step: i + 1, tMs: (i + 1) * SESSION.stepMs });
			// Each frame's BEFORE is the previous frame's AFTER.
			if (i > 0) expect(readFileSync(fromRoot(p.before)).equals(readFileSync(fromRoot(steps[i - 1]!.after))), p.id).toBe(true);
		});
		const events = steps.filter((p) => p.labels.announce === true).length;
		expect(events).toBeGreaterThanOrEqual(5);
		expect(events).toBeLessThanOrEqual(8);
	});
});

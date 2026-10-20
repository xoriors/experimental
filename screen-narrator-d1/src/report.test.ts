import { describe, expect, it } from "vitest";
import { computeMetrics } from "./metrics.ts";
import { renderReport, scriptSafeJson } from "./report.ts";
import { makePair, makeResult, makeRun, sampleRun } from "./report/fixtures.ts";

const dataOf = (html: string) => {
	const m = html.match(/<script type="application\/json" id="report-data">([\s\S]*?)<\/script>/);
	if (!m) throw new Error("no data block");
	return JSON.parse(m[1]!);
};

describe("renderReport", () => {
	it("keeps hostile strings inside the data block and round-trips them", () => {
		const nasty = "</script><script>alert(1)</script> $& $' $` <!--";
		const run = makeRun([makePair("p1", {}, { scenario: nasty })], [makeResult("p1", "m", undefined, { error: nasty })]);
		const html = renderReport(run, computeMetrics(run));
		// Exactly the template's own closing tags: the data can't add one.
		expect(html.match(/<\/script>/g)).toHaveLength(2);
		const data = dataOf(html);
		expect(data.run.pairs[0].scenario).toBe(nasty);
		expect(data.run.results[0].error).toBe(nasty);
		expect(data.imageBase).toBe("../../");
	});

	it("inlines the styles and scripts and leaves no placeholders", () => {
		const run = sampleRun();
		const html = renderReport(run, computeMetrics(run), ["data/sample/x/before.png"]);
		expect(html).not.toMatch(/\{\{[A-Z]+\}\}/);
		expect(html).toContain("--series-1");
		expect(html).toContain("function reliabilityChart");
		expect(html).toContain("function initBrowser");
		expect(html).not.toMatch(/<link|https?:\/\/[^"'\s]*\.(js|css)/);
		expect(dataOf(html).missing).toEqual(["data/sample/x/before.png"]);
	});

	it("escapes every < in JSON", () => {
		expect(scriptSafeJson({ a: "<b>" })).toBe('{"a":"\\u003cb>"}');
	});
});

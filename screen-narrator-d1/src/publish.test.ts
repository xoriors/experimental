import { describe, expect, it } from "vitest";
import { assertPublishable } from "./publish.ts";

describe("assertPublishable", () => {
	it("refuses anything that isn't a PNG inside data/pairs/, before touching the filesystem", () => {
		for (const rel of [".env", "../.env", "data/pairs/../../.env", "data/pairs/x/before.txt", "runs/latest"])
			expect(() => assertPublishable(rel), rel).toThrow(/refusing to publish/);
	});
});

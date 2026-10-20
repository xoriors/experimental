// `pnpm capture [--filter <substring>] [--clean]`: render every scenario × variant (plus the scripted session) in
// headless Chromium and write data/pairs/<id>/{before,after}.png and data/pairs/index.json (Pair[]).
import "./env.ts";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { type Browser, type BrowserContext, chromium, type Locator, type Page } from "playwright";
import { type AppName, SCENARIOS, type Scenario, SESSION, settle } from "../fixtures/scenarios.ts";
import { fromRoot } from "./env.ts";
import { type Pair, type PairLabels, type Variant, variantSlug } from "./types.ts";
import { errorMessage, isEntryPoint, pool } from "./util.ts";

const PAIRS_DIR = "data/pairs";
const VIEWPORTS = [
	{ width: 1280, height: 800 },
	{ width: 1024, height: 768 },
	{ width: 390, height: 844 },
];
// Without these, re-running capture changes a few anti-aliased pixels by 1–20 levels (partial raster and runtime
// Skia optimisations are timing-dependent). With them, repeated runs write byte-identical PNGs.
const DETERMINISTIC_RENDERING = [
	"--disable-gpu",
	"--disable-partial-raster",
	"--disable-skia-runtime-opts",
	"--force-color-profile=srgb",
	"--disable-lcd-text",
	"--font-render-hinting=none",
];
const MAX_CANDIDATES = 30;
const CONCURRENCY = 4;

/**
 * The 6 variants of scenario number `s`: 3 viewports × 2 themes, with density and language rotated so each scenario
 * gets both densities (3 + 3) and Spanish twice (once per theme), on viewports that shift from scenario to scenario.
 */
export function variantsFor(s: number): Variant[] {
	return Array.from({ length: 6 }, (_, i) => ({
		theme: i % 2 === 0 ? "light" : "dark",
		viewport: VIEWPORTS[Math.floor(i / 2)]!,
		density: (i + Math.floor(i / 2) + s) % 2 === 0 ? "comfortable" : "compact",
		lang: (i + s) % 3 === 1 ? "es" : "en",
	}));
}

export const pairId = (app: string, scenario: string, v: Variant) => `${app}-${scenario}--${variantSlug(v)}`;

function fixtureUrl(app: AppName, v: Variant, params: Record<string, string> = {}): string {
	const hash = new URLSearchParams({ theme: v.theme, density: v.density, lang: v.lang, ...params });
	return `${pathToFileURL(fromRoot("fixtures", `${app}.html`)).href}#${hash}`;
}

async function newContext(browser: Browser, v: Variant): Promise<BrowserContext> {
	return browser.newContext({
		viewport: v.viewport,
		deviceScaleFactor: 1,
		colorScheme: v.theme,
		reducedMotion: "reduce",
		locale: v.lang === "es" ? "es-ES" : "en-US",
	});
}

/** Open a fixture and fail on any script error, so a broken fixture never produces a plausible-looking pair. */
async function openFixture(page: Page, app: AppName, v: Variant, params?: Record<string, string>): Promise<string[]> {
	const errors: string[] = [];
	page.on("pageerror", (e) => errors.push(e.message));
	page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
	await page.goto(fixtureUrl(app, v, params));
	await page.waitForFunction(() => (window as unknown as { fixture?: { ready: boolean } }).fixture?.ready === true);
	await page.evaluate(() => document.fonts.ready);
	await settle(page);
	return errors;
}

const shot = (page: Page): Promise<Buffer> => page.screenshot({ animations: "disabled", caret: "hide", scale: "css" });

/** `- button "Delete":` (first line of an aria snapshot) → `button "Delete"`. */
function roleAndName(snapshot: string): string | undefined {
	const m = /^- ([\w-]+)(?: "((?:[^"\\]|\\.)*)")?/.exec(snapshot.split("\n")[0] ?? "");
	if (!m) return undefined;
	return m[2] === undefined ? m[1] : `${m[1]} "${m[2]}"`;
}

/** The focused control on the AFTER screen as the accessibility tree names it; undefined when focus is on body. */
async function focusedControl(page: Page): Promise<string | undefined> {
	const el = page.locator(":focus");
	if ((await el.count()) !== 1) return undefined;
	return roleAndName(await el.ariaSnapshot());
}

/**
 * `primary` candidates from the AFTER screen: every button and link a screen reader could reach and that is on
 * screen. An open modal makes the rest of the page inert, so then only the modal's controls count (Playwright's
 * role queries don't apply `inert` themselves).
 */
async function primaryLabel(page: Page): Promise<NonNullable<PairLabels["primary"]>> {
	const modal = page.locator("dialog:modal, [aria-modal='true']").filter({ visible: true });
	const scope: Page | Locator = (await modal.count()) > 0 ? modal.last() : page;
	const controls = scope.getByRole("button").or(scope.getByRole("link"));
	// One round trip for every control instead of four each. `visible` is Playwright's isVisible() rule.
	const onScreen = await controls.evaluateAll(
		(els, vp) =>
			els.flatMap((e, index) => {
				const r = e.getBoundingClientRect();
				const visible = e.checkVisibility() && getComputedStyle(e).visibility === "visible" && r.width > 0 && r.height > 0;
				if (!visible || r.x + r.width <= 0 || r.y + r.height <= 0 || r.x >= vp.width || r.y >= vp.height) return [];
				return [{ index, primary: e.hasAttribute("data-primary"), inDialog: !!e.closest("dialog, [role='dialog']") }];
			}),
		page.viewportSize()!,
	);
	const snapshots = await Promise.all(onScreen.map((c) => controls.nth(c.index).ariaSnapshot()));
	const found = onScreen.flatMap(({ primary, inDialog }, i) => {
		const desc = roleAndName(snapshots[i]!);
		return desc ? [{ desc, primary, inDialog }] : [];
	});
	if (found.filter((f) => f.primary).length !== 1) {
		throw new Error(`primary: expected exactly one visible [data-primary] button/link, found ${found.filter((f) => f.primary).length}`);
	}
	// Over the cap, keep the primary and dialog controls, then fill with the rest in page order.
	let kept = found;
	if (found.length > MAX_CANDIDATES) {
		const must = new Set(found.filter((f) => f.primary || f.inDialog));
		let room = MAX_CANDIDATES - must.size;
		kept = found.filter((f) => must.has(f) || room-- > 0);
	}
	// Identical names would be indistinguishable to the model, so number the repeats.
	const seen = new Map<string, number>();
	const candidates: Record<string, string> = {};
	let answer = "";
	kept.forEach((f, i) => {
		const n = (seen.get(f.desc) ?? 0) + 1;
		seen.set(f.desc, n);
		candidates[`e${i}`] = n > 1 ? `${f.desc} (${n})` : f.desc;
		if (f.primary) answer = `e${i}`;
	});
	return { candidates, answer };
}

/** Write one pair's screenshots and describe it. The page is on the AFTER screen, which is where `focused` is read. */
async function savePair(
	page: Page,
	shots: { before: Buffer; after: Buffer },
	{ id, scenario, app, variant, session, labels }: Omit<Pair, "before" | "after" | "width" | "height" | "focused">,
): Promise<Pair> {
	const focused = await focusedControl(page);
	const pair: Pair = {
		id,
		scenario,
		app,
		variant,
		before: path.posix.join(PAIRS_DIR, id, "before.png"),
		after: path.posix.join(PAIRS_DIR, id, "after.png"),
		width: variant.viewport.width,
		height: variant.viewport.height,
		...(focused ? { focused } : {}),
		...(session ? { session } : {}),
		labels,
	};
	mkdirSync(fromRoot(PAIRS_DIR, id), { recursive: true });
	writeFileSync(fromRoot(pair.before), shots.before);
	writeFileSync(fromRoot(pair.after), shots.after);
	return pair;
}

/** A transition that should change nothing must change no pixel; anything else must change at least one. */
function checkChange(kind: PairLabels["kind"], before: Buffer, after: Buffer): void {
	const same = before.equals(after);
	if (kind === "none" && !same) throw new Error("labelled 'none' but the screenshots differ: something in the fixture is not deterministic");
	if (kind !== "none" && same) throw new Error(`labelled '${kind}' but before and after are identical: the transition did nothing`);
}

async function capturePair(browser: Browser, scenario: Scenario, v: Variant): Promise<Pair> {
	const ctx = await newContext(browser, v);
	try {
		const page = await ctx.newPage();
		const errors = await openFixture(page, scenario.app, v, scenario.params);
		await scenario.setup?.(page, v);
		await settle(page);
		const before = await shot(page);
		await scenario.run(page, v);
		await settle(page);
		const after = await shot(page);
		if (errors.length) throw new Error(`page errors: ${errors.join(" | ")}`);
		checkChange(scenario.labels.kind, before, after);

		const labels: PairLabels = { ...scenario.labels };
		if (scenario.primary) labels.primary = await primaryLabel(page);
		if (scenario.narrations) {
			labels.narrations = { supported: scenario.narrations.supported[v.lang], unsupported: scenario.narrations.unsupported[v.lang] };
		}
		const id = pairId(scenario.app, scenario.id, v);
		return await savePair(page, { before, after }, { id, scenario: scenario.id, app: scenario.app, variant: v, labels });
	} finally {
		await ctx.close();
	}
}

/** The session is one page and consecutive frames: each step's BEFORE is the previous step's AFTER. */
async function captureSession(browser: Browser, wanted: (id: string) => boolean): Promise<Captured> {
	const v = SESSION.variant;
	const ids = SESSION.steps.map((s, i) => `${SESSION.name}--s${String(i + 1).padStart(2, "0")}-${s.name}--${variantSlug(v)}`);
	if (!ids.some(wanted)) return { pairs: [], failures: [] };
	const ctx = await newContext(browser, v);
	const pairs: Pair[] = [];
	try {
		const page = await ctx.newPage();
		let errors: string[];
		let prev: Buffer;
		try {
			errors = await openFixture(page, SESSION.app, v);
			prev = await shot(page);
		} catch (e) {
			// Reported like any other failed job: throwing here would reject the whole capture pool and skip index.json.
			return { pairs, failures: [{ id: ids[0]!, scenario: SESSION.name, error: errorMessage(e) }] };
		}
		for (const [i, step] of SESSION.steps.entries()) {
			const id = ids[i]!;
			try {
				await step.act(page);
				await settle(page);
				const frame = await shot(page);
				if (errors.length) throw new Error(`page errors: ${errors.join(" | ")}`);
				checkChange(step.labels.kind, prev, frame);
				if (wanted(id)) {
					const session = { name: SESSION.name, step: i + 1, tMs: (i + 1) * SESSION.stepMs };
					const fields = { id, scenario: SESSION.name, app: SESSION.app, variant: v, session, labels: { ...step.labels } };
					pairs.push(await savePair(page, { before: prev, after: frame }, fields));
				}
				prev = frame;
			} catch (e) {
				// Later frames build on this one, so a broken step ends the session.
				return { pairs, failures: [{ id, scenario: SESSION.name, error: errorMessage(e) }] };
			}
		}
	} finally {
		await ctx.close();
	}
	return { pairs, failures: [] };
}

interface Failure {
	id: string;
	scenario: string;
	error: string;
}
interface Captured {
	pairs: Pair[];
	failures: Failure[];
}

async function main(): Promise<void> {
	const { values } = parseArgs({ options: { filter: { type: "string" }, clean: { type: "boolean", default: false } } });
	const wanted = (id: string) => !values.filter || id.includes(values.filter);
	if (values.clean) rmSync(fromRoot(PAIRS_DIR), { recursive: true, force: true });
	mkdirSync(fromRoot(PAIRS_DIR), { recursive: true });

	const jobs = SCENARIOS.flatMap((scenario, s) => variantsFor(s).map((v) => ({ scenario, v, id: pairId(scenario.app, scenario.id, v) }))).filter((j) =>
		wanted(j.id),
	);
	const ids = new Set<string>();
	for (const j of jobs) {
		if (ids.has(j.id)) throw new Error(`duplicate pair id ${j.id}`);
		ids.add(j.id);
	}

	const browser = await chromium.launch({ args: DETERMINISTIC_RENDERING });
	const started = Date.now();
	let results: Captured[];
	try {
		const pairTasks = jobs.map(({ scenario, v, id }) => async (): Promise<Captured> => {
			try {
				return { pairs: [await capturePair(browser, scenario, v)], failures: [] };
			} catch (e) {
				return { pairs: [], failures: [{ id, scenario: scenario.id, error: errorMessage(e) }] };
			}
		});
		// The session is the longest job (40 frames in a row on one page), so it starts first and overlaps the rest.
		const [session, ...rest] = await pool([() => captureSession(browser, wanted), ...pairTasks], CONCURRENCY, async (task) => {
			const r = await task();
			for (const f of r.failures) console.error(`✗ ${f.id}: ${f.error}`);
			return r;
		});
		results = [...rest, session!];
	} finally {
		await browser.close();
	}
	const pairs = results.flatMap((r) => r.pairs);
	const failures = results.flatMap((r) => r.failures);

	// A filtered run updates its pairs in place and keeps everything else already captured.
	const indexPath = fromRoot(PAIRS_DIR, "index.json");
	const previous: Pair[] = values.filter && existsSync(indexPath) ? JSON.parse(readFileSync(indexPath, "utf8")) : [];
	const fresh = new Set(pairs.map((p) => p.id));
	// pool() keeps input order, so this is scenario × variant order with the session steps last.
	const all = [...previous.filter((p) => !fresh.has(p.id)), ...pairs];
	writeFileSync(indexPath, `${JSON.stringify(all, null, "\t")}\n`);

	const byScenario = new Map<string, { ok: number; failed: number }>();
	const tally = (name: string) => byScenario.get(name) ?? byScenario.set(name, { ok: 0, failed: 0 }).get(name)!;
	for (const p of pairs) tally(p.scenario).ok++;
	for (const f of failures) tally(f.scenario).failed++;
	console.log("\nscenario                 pairs  failed");
	for (const [name, c] of byScenario) console.log(`${name.padEnd(24)} ${String(c.ok).padStart(5)}  ${c.failed ? String(c.failed).padStart(6) : ""}`);
	console.log(`\n${pairs.length} pairs captured, ${failures.length} failed, ${all.length} in ${PAIRS_DIR}/index.json (${((Date.now() - started) / 1000).toFixed(1)} s)`);
	if (failures.length) process.exitCode = 1;
}

// Run only as an entry point, so tests can import variantsFor / pairId without launching a browser.
if (isEntryPoint(import.meta.url)) await main();

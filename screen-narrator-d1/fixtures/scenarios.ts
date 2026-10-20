// The transitions that produce the benchmark pairs. Each scenario is labelled by construction: the script that makes
// the change says what the change is. Natural interactions (click, hover, type, scroll) are real Playwright input;
// things the user didn't do (a message arriving, a clock ticking) are `window.fixture.trigger(name)` in the page.
import type { Locator, Page } from "playwright";
import { AMBIGUOUS, type PairLabels, type Variant } from "../src/types.ts";

export const APPS = ["mail", "settings", "chat", "shop", "bank", "news"] as const;
export type AppName = (typeof APPS)[number];
type Lang = Variant["lang"];
type Text = Record<Lang, string>;

/** Labels that don't depend on the screen; `primary`, `narrations` and `focused` are filled in by capture. */
export type StaticLabels = Pick<PairLabels, "announce" | "kind" | "urgency" | "sensitive">;

export interface Scenario {
	id: string;
	app: AppName;
	description: string;
	/** Extra client-only params for the fixture's URL fragment, e.g. `{ view: "checkout" }`. */
	params?: Record<string, string>;
	/** Brings the page to the BEFORE state (selecting rows, scrolling a field into view…). */
	setup?: (page: Page, v: Variant) => Promise<void>;
	/** The transition itself: BEFORE → AFTER. */
	run: (page: Page, v: Variant) => Promise<unknown>;
	labels: StaticLabels;
	/** Build `primary` from the AFTER screen's accessibility tree; the right answer is the `[data-primary]` element. */
	primary?: boolean;
	narrations?: { supported: Text; unsupported: Text };
}

/** Fire a fixture event that the user didn't cause. */
export const trigger = (page: Page, name: string): Promise<unknown> =>
	page.evaluate((n) => (window as unknown as { fixture: { trigger(n: string): unknown } }).fixture.trigger(n), name);

/** Wait until layout and paint have caught up with the last change (two animation frames). */
export const settle = (page: Page): Promise<void> =>
	page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));

/** Scroll with the mouse wheel like a user, then wait for the scroll position to stop moving. */
export async function wheel(page: Page, dy: number, at?: { x: number; y: number }): Promise<void> {
	const vp = page.viewportSize() ?? { width: 1280, height: 800 };
	await page.mouse.move(at?.x ?? vp.width / 2, at?.y ?? vp.height / 2);
	await page.mouse.wheel(0, dy);
	// The wheel scrolls whichever element is under the mouse, so watch every scroll offset on the page.
	const offsets = () => page.evaluate(() => [...document.querySelectorAll("*")].reduce((sum, el) => sum + el.scrollTop, 0));
	let last = await offsets();
	for (let i = 0; i < 40; i++) {
		await settle(page);
		const now = await offsets();
		if (now === last && i > 1) break;
		last = now;
	}
}

/** Move the mouse onto an element without scrolling it into view first, as `locator.hover()` would. */
export async function moveMouseTo(page: Page, target: Locator): Promise<void> {
	const box = await target.boundingBox();
	if (!box) throw new Error("moveMouseTo: target is not visible");
	const vp = page.viewportSize()!;
	await page.mouse.move(box.x + box.width / 2, Math.min(box.y + box.height / 2, vp.height - 10), { steps: 4 });
}

/** Wheel down until the page can't scroll any further (infinite-scroll pages: the loader is now on screen). */
export async function scrollToBottom(page: Page): Promise<void> {
	for (let i = 0; i < 20; i++) {
		const atEnd = await page.evaluate(() => {
			const el = document.scrollingElement!;
			return el.scrollTop + el.clientHeight >= el.scrollHeight - 1;
		});
		if (atEnd) return;
		await wheel(page, 2000);
	}
	throw new Error("scrollToBottom: still not at the end after 20 wheel turns");
}

const cosmetic: StaticLabels = { announce: false, kind: "cosmetic", urgency: 0, sensitive: false };
const ambiguous: StaticLabels = { announce: AMBIGUOUS, kind: AMBIGUOUS, urgency: AMBIGUOUS, sensitive: false };
const unchanged: StaticLabels = { announce: false, kind: "none", urgency: 0, sensitive: false };
const scrolled: StaticLabels = { announce: false, kind: "scroll", urgency: 0, sensitive: false };
/** A change worth announcing. */
const say = (kind: StaticLabels["kind"], urgency: StaticLabels["urgency"], sensitive = false): StaticLabels => ({
	announce: true,
	kind,
	urgency,
	sensitive,
});

/** In the order of the task list; the position also seeds the variant rotation in capture, so don't reorder. */
export const SCENARIOS: Scenario[] = [
	{
		id: "confirm-dialog",
		app: "mail",
		description: "Three messages are selected; clicking Delete opens a 'Delete 3 messages?' confirmation dialog.",
		async setup(page) {
			for (const i of [2, 3, 4]) await page.locator(".row .check").nth(i).click();
		},
		run: (page) => page.locator("#deleteSelected").click(),
		labels: say("dialog", 3),
		primary: true,
		narrations: {
			supported: {
				en: "A dialog asks whether to delete 3 messages, with Cancel and Delete buttons.",
				es: "Un cuadro de diálogo pregunta si eliminar 3 mensajes, con los botones Cancelar y Eliminar.",
			},
			unsupported: {
				en: "A dialog asks whether to delete 5 messages, with Cancel and Delete buttons.",
				es: "Un cuadro de diálogo pregunta si eliminar 5 mensajes, con los botones Cancelar y Eliminar.",
			},
		},
	},
	{
		id: "session-expiry",
		app: "settings",
		description: "While the user is on their profile, a modal warns they'll be signed out in 60 seconds.",
		run: (page) => trigger(page, "session-expiry"),
		labels: say("dialog", 3),
		primary: true,
		narrations: {
			supported: {
				en: "A dialog warns that you'll be signed out in 60 seconds, with Stay signed in and Sign out now buttons.",
				es: "Un cuadro de diálogo avisa de que se cerrará la sesión en 60 segundos, con los botones Seguir conectado y Cerrar sesión ahora.",
			},
			unsupported: {
				en: "A dialog warns that you'll be signed out in 5 minutes, with Stay signed in and Sign out now buttons.",
				es: "Un cuadro de diálogo avisa de que se cerrará la sesión en 5 minutos, con los botones Seguir conectado y Cerrar sesión ahora.",
			},
		},
	},
	{
		id: "validation-error",
		app: "settings",
		description: "The user typed an email without an @ and clicks Save: an inline error appears under the field.",
		async setup(page) {
			await page.locator("#email").click();
			await page.keyboard.press("ControlOrMeta+a");
			await page.keyboard.type("ana.ruiz.example.com");
		},
		run: (page) => page.locator("#save").click(),
		labels: say("error", 3),
		narrations: {
			supported: {
				en: "An error under the Email field says to enter a valid email address.",
				es: "Un error bajo el campo Correo electrónico pide introducir un correo electrónico válido.",
			},
			unsupported: {
				en: "An error under the Phone field says to enter a valid phone number.",
				es: "Un error bajo el campo Teléfono pide introducir un número de teléfono válido.",
			},
		},
	},
	{
		id: "saved-toast",
		app: "settings",
		description: "The user edits their phone number and clicks Save: a small 'Settings saved' toast appears in a corner.",
		async setup(page) {
			await page.locator("#phone").click();
			await page.keyboard.press("ControlOrMeta+a");
			await page.keyboard.type("+1 555 0199");
		},
		run: (page) => page.locator("#save").click(),
		labels: say("notification", 2),
		narrations: {
			supported: { en: "A notification says the settings were saved.", es: "Una notificación dice que se ha guardado la configuración." },
			unsupported: {
				en: "A notification says the settings could not be saved.",
				es: "Una notificación dice que no se ha podido guardar la configuración.",
			},
		},
	},
	{
		id: "new-message",
		app: "chat",
		description: "A private message from Mira arrives in the open conversation: a new bubble, a 'new message' divider and unread badges.",
		run: (page) => trigger(page, "incoming"),
		labels: say("notification", 2, true),
	},
	{
		id: "open-message",
		app: "mail",
		description: "Clicking the Greenleaf Digest newsletter in the inbox opens it in the message view.",
		run: (page) => page.locator(".row .what").first().click(),
		labels: say("navigation", 2),
		narrations: {
			supported: {
				en: "The Greenleaf Digest newsletter “5 plants for shady balconies” is now open.",
				es: "Ahora está abierto el boletín de Greenleaf Digest «5 plantas para balcones con sombra».",
			},
			unsupported: {
				en: "The Greenleaf Digest newsletter “7 plants for shady balconies” is now open.",
				es: "Ahora está abierto el boletín de Greenleaf Digest «7 plantas para balcones con sombra».",
			},
		},
	},
	{
		id: "cookie-banner",
		app: "news",
		description: "A cookie consent banner appears at the bottom of the news front page.",
		run: (page) => trigger(page, "cookie-banner"),
		labels: say("dialog", 2),
		primary: true,
	},
	{
		id: "infinite-scroll",
		app: "news",
		description: "The user has scrolled to the end of the front page; four more stories load in where the spinner was.",
		setup: (page) => scrollToBottom(page),
		run: (page) => trigger(page, "load-more"),
		labels: say("content", 1),
	},
	{
		id: "user-scroll",
		app: "news",
		description: "The user scrolls down an article with the mouse wheel.",
		params: { view: "article" },
		run: (page) => wheel(page, 400),
		labels: scrolled,
	},
	{
		id: "hover-card",
		app: "shop",
		description: "The mouse moves onto the big featured product card: it grows, recolours and casts a large shadow.",
		run: (page) => moveMouseTo(page, page.locator(".featured")),
		labels: cosmetic,
	},
	{
		id: "spinner-frame",
		app: "shop",
		description: "The 'checking stock' spinner under the header advances one frame.",
		run: (page) => trigger(page, "spinner-frame"),
		labels: cosmetic,
	},
	{
		id: "clock-tick",
		app: "bank",
		description: "The header clock on the account dashboard goes from 10:41 to 10:42; balances stay on screen.",
		run: (page) => trigger(page, "clock-tick"),
		labels: { ...cosmetic, sensitive: true },
	},
	{
		id: "rotating-ad",
		app: "news",
		description: "The sidebar advert rotates to a different advertiser.",
		run: (page) => trigger(page, "rotate-ad"),
		labels: ambiguous,
	},
	{
		id: "no-change",
		app: "settings",
		description: "The profile page sits idle for a second: nothing changes.",
		run: (page) => page.waitForTimeout(1000),
		labels: unchanged,
	},
	{
		id: "card-declined",
		app: "shop",
		description: "At checkout with a saved, partly masked card, clicking Pay shows a 'Card declined' error.",
		params: { view: "checkout" },
		setup: (page) => page.locator("#pay").scrollIntoViewIfNeeded(),
		run: (page) => page.locator("#pay").click(),
		labels: say("error", 3, true),
		primary: true,
		narrations: {
			supported: {
				en: "An error says the payment with the card ending in 4821 was declined.",
				es: "Un error indica que se ha rechazado el pago con la tarjeta terminada en 4821.",
			},
			unsupported: {
				en: "An error says the payment with the card ending in 1234 was declined.",
				es: "Un error indica que se ha rechazado el pago con la tarjeta terminada en 1234.",
			},
		},
	},
	{
		id: "password-reveal",
		app: "settings",
		description: "The user types a new password, then clicks 'Show password': the password is now readable in clear text.",
		async setup(page) {
			await page.getByRole("tab").nth(1).click();
			await page.locator("#newPw").click();
			await page.keyboard.type("Lantern-Orbit-42");
		},
		run: (page) => page.locator("#togglePw").click(),
		labels: say("content", 1, true),
	},
	{
		id: "dark-mode-toggle",
		app: "settings",
		description: "The user flips the Dark mode switch: every pixel changes, but only because they asked it to.",
		async setup(page) {
			await page.getByRole("tab").nth(3).click();
		},
		run: (page) => page.locator("#darkSwitch").click(),
		labels: ambiguous,
	},
];

// ── the scripted session (noise metric) ────────────────────────────────────────────────────────────────────

export interface SessionStep {
	name: string;
	act: (page: Page) => Promise<unknown>;
	labels: StaticLabels;
}

const step = (name: string, act: SessionStep["act"], labels = cosmetic): SessionStep => ({ name, act, labels });
const nothing = step("nothing", async () => {}, unchanged);
const spin = step("spinner", (p) => trigger(p, "spinner-frame"));
const tick = step("clock-tick", (p) => trigger(p, "clock-tick"));
const hoverRow = (i: number) => step(`hover-row-${i}`, (p) => p.locator(".row .what").nth(i).hover());
const hover = (name: string, selector: string) => step(name, (p) => p.locator(selector).hover());

/** ~2 minutes of a user reading mail, one frame every 3 s: mostly nothing worth saying, six things that are. */
export const SESSION = {
	name: "mail-2min",
	app: "mail" as AppName,
	stepMs: 3000,
	variant: { theme: "light", viewport: { width: 1280, height: 800 }, density: "comfortable", lang: "en" } satisfies Variant,
	steps: [
		nothing,
		hoverRow(2),
		spin,
		nothing,
		hoverRow(4),
		spin,
		nothing,
		step("new-mail", (p) => trigger(p, "new-mail"), say("notification", 2)),
		spin,
		// The toast going away on its own: nothing to say, and arguably not any one kind of change.
		step("toast-hides", (p) => trigger(p, "toast-hide"), { announce: false, kind: AMBIGUOUS, urgency: 0, sensitive: false }),
		tick,
		nothing,
		hoverRow(1),
		step("open-message", (p) => p.locator(".row .what").nth(1).click(), say("navigation", 2)),
		nothing,
		step("user-scroll", (p) => wheel(p, 360, { x: 760, y: 500 }), scrolled),
		nothing,
		hover("hover-delete", "#deleteOpen"),
		step("delete-dialog", (p) => p.locator("#deleteOpen").click(), say("dialog", 3)),
		nothing,
		hover("hover-cancel", "#confirmCancel"),
		step("dialog-closes", (p) => p.locator("#confirmCancel").click(), say("dialog", 2)),
		nothing,
		spin,
		step("back-to-inbox", (p) => p.locator("#back").click(), say("navigation", 2)),
		hoverRow(5),
		nothing,
		spin,
		nothing,
		step("send-error", (p) => trigger(p, "send-error"), say("error", 3)),
		tick,
		nothing,
		hoverRow(7),
		spin,
		nothing,
		hoverRow(3),
		spin,
		nothing,
		spin,
		nothing,
	] satisfies SessionStep[],
};

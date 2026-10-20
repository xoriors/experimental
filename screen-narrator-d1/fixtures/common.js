// Shared runtime for the fixture apps. A classic script (not a module) because Chromium blocks module scripts on
// file:// URLs. The variant comes from the URL fragment (#theme=dark&density=compact&lang=es): it is client-only, so
// it never belongs in the query string.
(() => {
	const params = new URLSearchParams(location.hash.slice(1));
	const pick = (key, allowed) => (allowed.includes(params.get(key)) ? params.get(key) : allowed[0]);
	const variant = {
		theme: pick("theme", ["light", "dark"]),
		density: pick("density", ["comfortable", "compact"]),
		lang: pick("lang", ["en", "es"]),
	};
	const root = document.documentElement;
	root.dataset.theme = variant.theme;
	root.dataset.density = variant.density;
	root.lang = variant.lang;

	// 24×24 stroke icons, hand-drawn so the fixtures need no icon font or network.
	const ICONS = {
		search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
		trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6"/>',
		archive: '<rect x="3" y="4" width="18" height="4" rx="1"/><path d="M5 8v11h14V8M10 12h4"/>',
		mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
		star: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>',
		inbox: '<path d="M3 13h5l1.5 3h5L16 13h5M5 5h14l2 8v6H3v-6z"/>',
		send: '<path d="M21 3 3 10.5l7 2.5 2.5 7zM10 13 21 3"/>',
		file: '<path d="M14 3H6v18h12V7zM14 3v4h4"/>',
		alert: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5V13M12 16.5v.5"/>',
		menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
		back: '<path d="M15 5l-7 7 7 7"/>',
		chevron: '<path d="m9 5 7 7-7 7"/>',
		refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/>',
		more: '<circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/>',
		"check-circle": '<circle cx="12" cy="12" r="9"/><path d="m8 12.5 3 3 5-6"/>',
		gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1"/>',
		user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4.5-6 8-6s7 2 8 6"/>',
		lock: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
		bell: '<path d="M6 16v-5a6 6 0 0 1 12 0v5l2 2H4zM10 20a2 2 0 0 0 4 0"/>',
		palette: '<circle cx="12" cy="12" r="9"/><circle cx="8" cy="10" r="1.2"/><circle cx="12" cy="7.5" r="1.2"/><circle cx="16" cy="10" r="1.2"/>',
		card: '<rect x="2.5" y="5" width="19" height="14" rx="2"/><path d="M2.5 10h19M6 15h4"/>',
		eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
		cart: '<circle cx="9" cy="20" r="1.5"/><circle cx="18" cy="20" r="1.5"/><path d="M2 3h3l2.5 12h11.5l2-8H6.2"/>',
		heart: '<path d="M12 20s-7.5-4.6-9.2-9.2C1.6 7.3 3.9 4 7.3 4c2 0 3.6 1.2 4.7 2.7C13.1 5.2 14.7 4 16.7 4c3.4 0 5.7 3.3 4.5 6.8C19.5 15.4 12 20 12 20z"/>',
		phone: '<path d="M5 3h4l2 5-2.5 1.5a11 11 0 0 0 6 6L16 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 5a2 2 0 0 1 2-2z"/>',
		video: '<rect x="2" y="6" width="14" height="12" rx="2"/><path d="m16 10 6-3v10l-6-3"/>',
		clip: '<path d="M20 11.5 12 19.5a5 5 0 0 1-7-7l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7L9.7 17.2a1.7 1.7 0 0 1-2.4-2.4L15 7"/>',
		smile: '<circle cx="12" cy="12" r="9"/><path d="M8.5 14.5a4.5 4.5 0 0 0 7 0M9 9.5v.5M15 9.5v.5"/>',
		chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
		transfer: '<path d="M4 8h14l-3-3M20 16H6l3 3"/>',
		shield: '<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/>',
		truck: '<path d="M2 6h12v10H2zM14 10h4l3 3v3h-7"/><circle cx="6" cy="18" r="1.8"/><circle cx="17" cy="18" r="1.8"/>',
		clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
		globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
		edit: '<path d="M4 20h4L19 9l-4-4L4 16zM14 6l4 4"/>',
		plus: '<path d="M12 5v14M5 12h14"/>',
		info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.5v.5"/>',
		logout: '<path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10"/>',
		bookmark: '<path d="M6 3h12v18l-6-4-6 4z"/>',
		share: '<circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="m8.2 10.8 7.6-3.6M8.2 13.2l7.6 3.6"/>',
		cookie: '<path d="M12 3a9 9 0 1 0 9 9 4 4 0 0 1-4-4 4 4 0 0 1-5-5z"/><path d="M8 11v.5M12 16v.5M15.5 13.5v.5M8.5 15.5v.5"/>',
	};
	const icon = (name) =>
		`<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${ICONS[name] ?? ICONS.info}</svg>`;

	let strings = {};
	/** Look up a UI string in the variant's language; `{name}` placeholders are filled from `vars`. */
	const t = (key, vars = {}) => {
		const s = strings[variant.lang]?.[key] ?? strings.en?.[key];
		if (s === undefined) throw new Error(`fixture: missing string "${key}"`);
		return typeof s === "string" ? s.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? `{${k}}`)) : s;
	};

	/** Fill icons and translations inside `scope` (call again after rendering new markup). */
	const hydrate = (scope = document) => {
		for (const el of scope.querySelectorAll("[data-icon]")) {
			el.outerHTML = icon(el.dataset.icon);
		}
		for (const el of scope.querySelectorAll("[data-i18n]")) el.textContent = t(el.dataset.i18n);
		// data-i18n-attr="aria-label=key;placeholder=key2": the accessibility tree must be translated too.
		for (const el of scope.querySelectorAll("[data-i18n-attr]")) {
			for (const pair of el.dataset.i18nAttr.split(";")) {
				const [attr, key] = pair.split("=");
				el.setAttribute(attr.trim(), t(key.trim()));
			}
		}
		for (const el of scope.querySelectorAll(".spinner:empty")) {
			el.innerHTML = Array.from({ length: 8 }, () => "<i></i>").join("");
			setSpinner(el, Number(el.dataset.frame ?? 0));
		}
	};

	// One frame = one of 8 bar positions; the bright head moves clockwise with a fading tail behind it.
	const TAIL = [1, 0.72, 0.5, 0.32, 0.2, 0.2, 0.2, 0.2];
	const setSpinner = (el, frame) => {
		const head = frame % 8;
		el.dataset.frame = String(head);
		[...el.children].forEach((bar, i) => {
			bar.style.transform = `rotate(${i * 45}deg)`;
			bar.style.opacity = String(TAIL[(head - i + 8) % 8]);
		});
	};
	const stepSpinner = (el) => setSpinner(el, Number(el.dataset.frame ?? 0) + 1);

	const handlers = {};
	window.fixture = {
		variant,
		ready: false,
		t,
		hydrate,
		stepSpinner,
		/** Advance an HH:MM clock element by one minute. */
		tickClock(el) {
			const [h, m] = el.textContent.split(":").map(Number);
			const total = h * 60 + m + 1;
			el.textContent = `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
		},
		/** Register a timed event that capture fires with `fixture.trigger(name)`. */
		on(name, fn) {
			handlers[name] = fn;
		},
		trigger(name) {
			const fn = handlers[name];
			if (!fn) throw new Error(`fixture: unknown trigger "${name}" (known: ${Object.keys(handlers).join(", ")})`);
			return fn();
		},
		/** Extra client-only params from the fragment, e.g. `view=checkout`. */
		param: (key) => params.get(key),
		/** Apps call this once: strings first, then their own render, then capture may start. */
		boot({ strings: s, init }) {
			strings = s;
			const start = () => {
				document.title = t("title");
				init?.();
				hydrate();
				window.fixture.ready = true;
			};
			if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
			else start();
		},
	};
	// Shorthands for the app scripts, which are classic scripts too and see these as globals.
	window.$ = (id) => document.getElementById(id);
	window.t = t;
})();

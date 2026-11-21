/**
 * mermaid-actions: run `action:` links declared as `click node href "action:name?key=value"`
 * lines in a Mermaid block. No dependencies, no DOM globals at import time, so a host (the
 * viewer, an Obsidian plugin, a VS Code preview script) only wires it to its own page.
 *
 *   register(name, fn)   add or replace an action; fn(params, node, ctx)
 *   mount(root, opts)    one click handler on `root`; returns { destroy }
 *   run(href, node, ctx) run one `action:` href; returns true when it was one
 *   parseClicks(source)  { nodeId: { href, tooltip } } from the `click` lines of a Mermaid source
 *   nodeIdOf(target)     { id, el } of the diagram node under a DOM element, or null
 *   decorate(root, clicks, cls)  add `cls` to the nodes that have an action
 *
 * `fn` gets the URL's query as URLSearchParams, the node's element (or null) and
 * ctx = { root, doc, toast }.
 *
 * Keep a single `export { … };` statement as the last line: build-hosts.mjs turns this file
 * into the self-contained scripts the Obsidian and VS Code hosts ship.
 */

const registry = new Map();

function register(name, fn) {
  if (!/^[a-z][\w-]*$/i.test(name)) throw new TypeError(`Invalid action name: ${name}`);
  if (typeof fn !== 'function') throw new TypeError(`Action ${name} must be a function`);
  registry.set(name, fn);
}

// The built-in actions are registered like any other, so a host can replace them.
register('copy', (p, node, ctx) => {
  const text = p.get('text') ?? '';
  Promise.resolve()
    .then(() => navigator.clipboard.writeText(text))
    .then(() => ctx.toast(`Copied: ${text}`), () => ctx.toast(`Clipboard blocked here, the text is: ${text}`));
});

register('toggle', (p, node) => {
  const cls = p.get('class');
  if (node && cls) node.classList.toggle(cls);
});

register('show', (p, node, ctx) => {
  const id = p.get('id');
  const t = id && ctx.doc.getElementById(id);
  if (!t) return ctx.toast(`No element #${id}`);
  if ('open' in t) t.open = true;
  t.scrollIntoView({ behavior: 'smooth', block: 'center' });
  t.classList.add('flash');
  setTimeout(() => t.classList.remove('flash'), 1500);
});

function run(href, node, ctx) {
  if (typeof href !== 'string' || !href.startsWith('action:')) return false;
  const u = new URL(href);
  const fn = ctx.actions?.[u.pathname] ?? registry.get(u.pathname);
  if (!fn) { ctx.toast(`Unknown action: ${u.pathname}`); return true; }
  try {
    fn(u.searchParams, node, ctx);
  } catch (err) {
    ctx.toast(`Action ${u.pathname} failed: ${err?.message ?? err}`);
  }
  return true;
}

/**
 * Click handler for `root`. Options (all optional):
 *   toast(msg)              show a message; default logs to the console
 *   actions                 { name: fn } that win over the registered ones, for this mount only
 *   hrefFor(target, event)  the href to run for a click; default is the `href` of the enclosing <a>.
 *                           Hosts whose renderer strips the link (Obsidian) look it up by node id instead.
 *   onLink(href, a, event)  called for every other click that has an href (nav, #heading, ./doc.md)
 *   capture                 listen in the capture phase, to run before the host's own handlers
 */
function mount(root, opts = {}) {
  const ctx = {
    root,
    doc: root.ownerDocument ?? root,
    toast: opts.toast ?? (msg => console.info('[mermaid-actions]', msg)),
    actions: opts.actions,
  };
  const onClick = e => {
    if (!(e.target instanceof Element)) return;
    const a = e.target.closest('a[href], a[*|href]');
    const href = opts.hrefFor ? opts.hrefFor(e.target, e) : (a?.getAttribute('href') ?? a?.getAttribute('xlink:href'));
    if (!href) return;
    if (href.startsWith('action:')) {
      e.preventDefault();
      e.stopPropagation();
      run(href, e.target.closest('[data-id]'), ctx);
    } else {
      opts.onLink?.(href, a, e);
    }
  };
  const capture = !!opts.capture;
  root.addEventListener('click', onClick, capture);
  return { destroy: () => root.removeEventListener('click', onClick, capture) };
}

// `click id [href] "target" ["tooltip"]`, one per line, single quotes not allowed by Mermaid.
const CLICK = /^\s*click\s+([^\s"]+)\s+(?:href\s+)?"([^"]*)"(?:\s+"([^"]*)")?(?:\s+_?\w+)?\s*$/;

/** Only `action:` targets are returned; real URLs and `#heading` links need no help. */
function parseClicks(source) {
  const out = Object.create(null);
  for (const line of String(source).split(/\r?\n/)) {
    const m = CLICK.exec(line);
    if (m && m[2].startsWith('action:')) out[m[1]] = { href: m[2], tooltip: m[3] ?? '' };
  }
  return out;
}

/** Pele puts the Mermaid id in `data-id`; mermaid.js 10 names nodes `flowchart-<id>-<n>`. */
function nodeIdOf(target) {
  for (let el = target; el && el.nodeType === 1; el = el.parentElement) {
    const d = el.getAttribute('data-id');
    if (d) return { id: d, el };
    const m = /^(?:flowchart|state|class|graph)-(.+)-\d+$/.exec(el.id ?? '');
    if (m) return { id: m[1], el };
  }
  return null;
}

function decorate(root, clicks, cls = 'ma-action') {
  for (const el of root.querySelectorAll('[data-id], [id]')) {
    const n = nodeIdOf(el);
    if (n && n.el === el && clicks[n.id]) el.classList.add(cls);
  }
}

export { register, run, mount, parseClicks, nodeIdOf, decorate };

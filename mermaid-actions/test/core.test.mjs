// node --test mermaid-actions/test
import test from 'node:test';
import assert from 'node:assert/strict';
import { register, run, parseClicks, nodeIdOf } from '../mermaid-actions.js';

const ctx = () => { const t = []; return { toasts: t, toast: m => t.push(m), doc: {}, root: {} }; };

test('parseClicks keeps only action: targets, with tooltip, href optional', () => {
  const c = parseClicks([
    'flowchart LR',
    '  click a href "action:copy?text=hi" "Copy it"',
    '  click b "action:toggle?class=checked"',
    '  click c href "https://example.com" "real url"',
    '  click d href "#tests"',
  ].join('\n'));
  assert.deepEqual(Object.keys(c), ['a', 'b']);
  assert.deepEqual(c.a, { href: 'action:copy?text=hi', tooltip: 'Copy it' });
  assert.equal(c.b.tooltip, '');
});

test('run: registered, unknown, throwing and non-action hrefs', () => {
  const seen = [];
  register('probe', (p, node) => seen.push([p.get('k'), node]));
  register('boom', () => { throw new Error('nope'); });
  const c = ctx();
  assert.equal(run('action:probe?k=v', 'N', c), true);
  assert.deepEqual(seen, [['v', 'N']]);
  assert.equal(run('action:missing', null, c), true);
  assert.equal(run('action:boom', null, c), true);
  assert.equal(run('https://x', null, c), false);
  assert.deepEqual(c.toasts, ['Unknown action: missing', 'Action boom failed: nope']);
  assert.throws(() => register('bad name', () => {}), TypeError);
});

test('run: per-mount actions win over registered ones', () => {
  register('dup', () => { throw new Error('registered'); });
  const c = { ...ctx(), actions: { dup: () => c.toast('local') } };
  run('action:dup', null, c);
  assert.deepEqual(c.toasts, ['local']);
});

test('nodeIdOf reads data-id (Pele) and flowchart-<id>-<n> (mermaid.js)', () => {
  const el = (attrs, parent = null) => ({ nodeType: 1, id: attrs.id ?? '', parentElement: parent, getAttribute: k => attrs[k] ?? null });
  const g = el({ 'data-id': 'deploy' });
  assert.equal(nodeIdOf(el({}, g)).id, 'deploy');
  const m = el({ id: 'flowchart-my-node-3' });
  assert.equal(nodeIdOf(el({}, m)).id, 'my-node');
  assert.equal(nodeIdOf(el({})), null);
});

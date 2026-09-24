import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { transfer } from '../src/ledger';
import { binarySearch } from '../src/search';
import * as arb from './arbitraries';

// A differential test only covers the inputs its generators produce. If every random
// transfer were rejected as `InvalidAccount`, thousands of passing runs would prove
// almost nothing, so check that each branch of the code is actually reached.

const samples = 2_000;
const seed = 20260923;

function shares<T>(arbitrary: fc.Arbitrary<T>, classify: (value: T) => string) {
  const counts = new Map<string, number>();
  for (const value of fc.sample(arbitrary, { numRuns: samples, seed })) {
    const label = classify(value);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return (label: string) => (counts.get(label) ?? 0) / samples;
}

describe('generators reach every outcome', () => {
  it('transfer: success and each error, at least 1% of the time', () => {
    const share = shares(arb.transferCase, ({ balances, from, to, amount }) => {
      const r = transfer(balances, from, to, amount);
      return r.ok ? 'ok' : r.error;
    });
    for (const outcome of [
      'ok',
      'InvalidAccount',
      'SameAccount',
      'InvalidAmount',
      'InsufficientFunds',
      'Overflow',
    ]) {
      expect(share(outcome), outcome).toBeGreaterThanOrEqual(0.01);
    }
  });

  it('binarySearch: the target is found and missed, each at least 30% of the time', () => {
    const share = shares(arb.ascendingWithTarget, ([xs, t]) =>
      binarySearch(xs, t) === -1 ? 'missed' : 'found',
    );
    expect(share('found')).toBeGreaterThanOrEqual(0.3);
    expect(share('missed')).toBeGreaterThanOrEqual(0.3);
  });

  it('encode: inputs with long runs are common', () => {
    const share = shares(arb.runny, (xs) =>
      xs.some((x, i) => i >= 2 && xs[i - 1] === x && xs[i - 2] === x) ? 'long' : 'short',
    );
    expect(share('long')).toBeGreaterThanOrEqual(0.3);
  });
});

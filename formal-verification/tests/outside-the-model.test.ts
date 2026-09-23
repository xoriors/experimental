import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { settle, transfer } from '../src/ledger';
import { decode, encode } from '../src/rle';
import { binarySearch } from '../src/search';
import { sort } from '../src/sort';
import * as arb from './arbitraries';

// Behaviour the Lean models cannot speak about, because Lean has no mutable arrays shared
// by reference, no fractional or NaN "integers", and no `undefined`. The proofs say
// nothing here, so these are ordinary tests. Keeping them in their own file makes the
// boundary of what is verified explicit.

describe('inputs are never mutated', () => {
  // Writing to a frozen array throws in strict mode, and ES modules are always strict.
  const frozen = <T>(xs: T[]) => Object.freeze(xs.slice());

  it('sort', () => fc.assert(fc.property(arb.ints, (xs) => void sort(frozen(xs)))));
  it('encode', () => fc.assert(fc.property(arb.runny, (xs) => void encode(frozen(xs)))));
  it('transfer and settle', () =>
    fc.assert(
      fc.property(arb.settleCase, ({ balances, transfers }) => {
        const ledger = frozen(balances);
        settle(ledger, frozen(transfers));
        for (const t of transfers) transfer(ledger, t.from, t.to, t.amount);
      }),
    ));
});

describe('non-integer numbers', () => {
  const odd = [0.5, -0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];

  it('transfer rejects fractional, NaN and infinite amounts', () => {
    for (const amount of odd) {
      expect(transfer([100, 100], 0, 1, amount)).toEqual({ ok: false, error: 'InvalidAmount' });
    }
  });

  it('transfer rejects fractional, NaN and infinite account ids', () => {
    for (const id of odd) {
      expect(transfer([100, 100], id, 1, 10)).toEqual({ ok: false, error: 'InvalidAccount' });
      expect(transfer([100, 100], 0, id, 10)).toEqual({ ok: false, error: 'InvalidAccount' });
    }
  });

  it('binarySearch never finds NaN, and terminates on it', () => {
    expect(binarySearch([1, 2, 3], Number.NaN)).toBe(-1);
  });
});

describe('worked examples', () => {
  it('sort', () => {
    expect(sort([3, -1, 2, -1, 0])).toEqual([-1, -1, 0, 2, 3]);
    expect(sort([])).toEqual([]);
  });

  it('binarySearch', () => {
    expect(binarySearch([1, 3, 7, 9], 7)).toBe(2);
    expect(binarySearch([1, 3, 7, 9], 4)).toBe(-1);
    expect(binarySearch([], 4)).toBe(-1);
  });

  it('encode and decode', () => {
    expect(encode([5, 5, 5, 2, 5])).toEqual([
      [5, 3],
      [2, 1],
      [5, 1],
    ]);
    expect(decode([[5, 3], [2, 0], [2, 1]])).toEqual([5, 5, 5, 2]);
  });

  it('transfer', () => {
    expect(transfer([100, 0], 0, 1, 30)).toEqual({ ok: true, balances: [70, 30] });
    expect(transfer([100, 0], 0, 1, 101)).toEqual({ ok: false, error: 'InsufficientFunds' });
    expect(transfer([100, 0], 1, 1, 0)).toEqual({ ok: false, error: 'SameAccount' });
    expect(transfer([100, Number.MAX_SAFE_INTEGER], 0, 1, 1)).toEqual({
      ok: false,
      error: 'Overflow',
    });
  });

  it('settle skips rejected transfers and carries on', () => {
    const txs = [
      { from: 0, to: 1, amount: 30 },
      { from: 1, to: 0, amount: 99 },
      { from: 1, to: 2, amount: 10 },
    ];
    expect(settle([100, 0, 0], txs)).toEqual([70, 20, 10]);
  });
});

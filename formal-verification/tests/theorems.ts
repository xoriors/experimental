import fc from 'fast-check';
import type { settle as Settle, transfer as Transfer } from '../src/ledger';
import type { decode as Decode, encode as Encode } from '../src/rle';
import type { binarySearch as BinarySearch } from '../src/search';
import type { sort as Sort } from '../src/sort';
import * as arb from './arbitraries';

// Each Lean theorem, restated as a fast-check property of the TypeScript implementation
// and keyed by the theorem's name. Lean proves the statement for the model on every input;
// here it is sampled on the implementation. Every builder takes the implementation as an
// argument so the mutation tests can run the same checks against buggy versions.

export type Properties = Record<string, fc.IProperty<unknown>>;

const total = (bs: readonly number[]) => bs.reduce((s, b) => s + BigInt(b), 0n);
/** `Ledger.Valid`: every balance is a non-negative safe integer. */
const isValid = (bs: readonly number[]) => bs.every((b) => Number.isSafeInteger(b) && b >= 0);
const isAscending = (xs: readonly number[]) => xs.every((x, i) => i === 0 || xs[i - 1] <= x);

function counts(xs: readonly number[]): Map<number, number> {
  const m = new Map<number, number>();
  for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1);
  return m;
}
function sameElements(a: readonly number[], b: readonly number[]): boolean {
  const ca = counts(a);
  const cb = counts(b);
  return ca.size === cb.size && [...ca].every(([x, n]) => cb.get(x) === n);
}
const sameArray = (a: readonly unknown[], b: readonly unknown[]) =>
  a.length === b.length && a.every((x, i) => Object.is(x, b[i]));

export const sortTheorems = (sort: typeof Sort): Properties => ({
  'Sorting.insertionSort_sorted': fc.property(arb.ints, (xs) => isAscending(sort(xs))),
  'Sorting.insertionSort_perm': fc.property(arb.ints, (xs) => sameElements(sort(xs), xs)),
  'Sorting.insertionSort_idem': fc.property(arb.ints, (xs) =>
    sameArray(sort(sort(xs)), sort(xs)),
  ),
});

export const searchTheorems = (
  binarySearch: typeof BinarySearch,
  sort: typeof Sort,
): Properties => ({
  // Holds on every array, sorted or not.
  'BinarySearch.search_sound': fc.property(arb.anyWithTarget, ([xs, t]) => {
    const i = binarySearch(xs, t);
    return i === -1 || (Number.isInteger(i) && i >= 0 && i < xs.length && xs[i] === t);
  }),
  'BinarySearch.search_eq_none_iff': fc.property(
    arb.ascendingWithTarget,
    ([xs, t]) => (binarySearch(xs, t) === -1) === !xs.includes(t),
  ),
  'BinarySearch.search_after_sort': fc.property(
    arb.anyWithTarget,
    ([xs, t]) => (binarySearch(sort(xs), t) !== -1) === xs.includes(t),
  ),
});

export const rleTheorems = (encode: typeof Encode, decode: typeof Decode): Properties => ({
  'RunLength.decode_encode': fc.property(arb.runny, (xs) => sameArray(decode(encode(xs)), xs)),
  'RunLength.encode_canonical': fc.property(arb.runny, (xs) => arb.isCanonical(encode(xs))),
  'RunLength.encode_decode': fc.property(arb.canonicalRuns, (rs) => {
    const back = encode(decode(rs));
    return back.length === rs.length && back.every((r, i) => sameArray(r, rs[i]));
  }),
  'RunLength.encode_length_le': fc.property(arb.runny, (xs) => encode(xs).length <= xs.length),
});

export const transferTheorems = (transfer: typeof Transfer): Properties => ({
  'Ledger.transfer_length': fc.property(arb.transferCase, ({ balances, from, to, amount }) => {
    const r = transfer(balances, from, to, amount);
    return !r.ok || r.balances.length === balances.length;
  }),
  'Ledger.transfer_sum': fc.property(arb.transferCase, ({ balances, from, to, amount }) => {
    const r = transfer(balances, from, to, amount);
    return !r.ok || total(r.balances) === total(balances);
  }),
  'Ledger.transfer_valid': fc.property(arb.transferCase, ({ balances, from, to, amount }) => {
    const r = transfer(balances, from, to, amount);
    return !r.ok || isValid(r.balances);
  }),
});

export const settleTheorems = (settle: typeof Settle): Properties => ({
  'Ledger.settle_length': fc.property(
    arb.settleCase,
    ({ balances, transfers }) => settle(balances, transfers).length === balances.length,
  ),
  'Ledger.settle_sum': fc.property(
    arb.settleCase,
    ({ balances, transfers }) => total(settle(balances, transfers)) === total(balances),
  ),
  'Ledger.settle_valid': fc.property(arb.settleCase, ({ balances, transfers }) =>
    isValid(settle(balances, transfers)),
  ),
});

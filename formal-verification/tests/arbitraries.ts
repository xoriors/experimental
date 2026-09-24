import fc from 'fast-check';
import type { Transfer } from '../src/ledger';
import type { Run } from '../src/rle';

// Input generators, shared by the property and differential tests. They are tuned so the
// interesting cases (duplicates, long runs, every transfer outcome, balances near 2^53)
// come up often. `withCrossShrink` lets a failing case shrink into the first, simplest
// branch, so counterexamples come out small.

/** Mostly small values so duplicates are common, sometimes any 32-bit integer. */
export const int = fc.oneof(
  { withCrossShrink: true },
  fc.integer({ min: -20, max: 20 }),
  fc.integer(),
);
export const ints = fc.array(int, { maxLength: 50 });

export const ascending = ints.map((xs) => [...xs].sort((a, b) => a - b));

/** An array and a target that is one of its elements about half the time. */
function withTarget(arrays: fc.Arbitrary<number[]>) {
  return fc
    .tuple(arrays, fc.boolean(), fc.nat(), int)
    .map(([xs, present, i, other]): [number[], number] => [
      xs,
      present && xs.length > 0 ? xs[i % xs.length] : other,
    ]);
}
export const ascendingWithTarget = withTarget(ascending);
export const anyWithTarget = withTarget(ints);

/** Lists made of runs of 1 to 6 copies over a tiny alphabet, so long runs are common. */
export const runny = fc
  .array(fc.tuple(fc.integer({ min: 0, max: 3 }), fc.integer({ min: 1, max: 6 })), {
    maxLength: 12,
  })
  .map((rs) => rs.flatMap(([v, n]) => Array<number>(n).fill(v)));

/** Arbitrary runs, including empty ones and equal neighbours. */
export const runs = fc.array(
  fc.tuple(fc.integer({ min: -3, max: 3 }), fc.nat({ max: 4 })) as fc.Arbitrary<Run>,
  { maxLength: 12 },
);

export function isCanonical(rs: readonly Run[]): boolean {
  return rs.every(([v, n], i) => n > 0 && (i === 0 || rs[i - 1][0] !== v));
}
export const canonicalRuns = runs.filter(isCanonical);

const MAX = Number.MAX_SAFE_INTEGER;
const nearMax = fc.integer({ min: MAX - 1_000, max: MAX });

/** A valid balance: a non-negative safe integer, often small, sometimes near 2^53. */
export const balance = fc.oneof(
  { withCrossShrink: true },
  { arbitrary: fc.nat({ max: 1_000 }), weight: 3 },
  { arbitrary: nearMax, weight: 1 },
  { arbitrary: fc.maxSafeNat(), weight: 1 },
);
/** Ledgers of 2 to 6 accounts, with the degenerate 0- and 1-account ones now and then. */
export const balances = fc.oneof(
  { arbitrary: fc.array(balance, { minLength: 2, maxLength: 6 }), weight: 5 },
  { arbitrary: fc.array(balance, { maxLength: 1 }), weight: 1 },
);

/**
 * Where a transfer points: an account, as an index reduced modulo the ledger size, or just
 * out of range. Picking the index before the ledger exists (rather than with `chain`)
 * keeps shrinking effective, and `noBias` stops `from === to` from being too common.
 */
type AccountPick = number | 'below' | 'above';
const accountPick: fc.Arbitrary<AccountPick> = fc.oneof(
  { withCrossShrink: true },
  { arbitrary: fc.noBias(fc.nat()), weight: 10 },
  { arbitrary: fc.constantFrom('below' as const, 'above' as const), weight: 1 },
);
const account = (pick: AccountPick, n: number) =>
  pick === 'below' ? -1 : pick === 'above' || n === 0 ? n : pick % n;

/** Amounts: ordinary values, zero and negatives, and values at and past 2^53 - 1. */
export const amount = fc.oneof(
  { withCrossShrink: true },
  { arbitrary: fc.nat({ max: 1_000 }), weight: 4 },
  { arbitrary: fc.integer({ min: -2, max: 0 }), weight: 1 },
  { arbitrary: nearMax, weight: 1 },
  { arbitrary: fc.constantFrom(MAX + 1, 2 ** 60), weight: 1 },
);

interface TransferPick {
  from: AccountPick;
  to: AccountPick;
  amount: number;
}
const transferPick: fc.Arbitrary<TransferPick> = fc.record({
  from: accountPick,
  to: accountPick,
  amount,
});
const resolve = (t: TransferPick, n: number): Transfer => ({
  from: account(t.from, n),
  to: account(t.to, n),
  amount: t.amount,
});

export const transferCase = fc
  .tuple(balances, transferPick)
  .map(([balances, t]) => ({ balances, ...resolve(t, balances.length) }));

export const settleCase = fc
  .tuple(balances, fc.array(transferPick, { maxLength: 10 }))
  .map(([balances, ts]) => ({ balances, transfers: ts.map((t) => resolve(t, balances.length)) }));

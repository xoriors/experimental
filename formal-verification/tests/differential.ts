import fc from 'fast-check';
import { expect } from 'vitest';
import type { settle as Settle, transfer as Transfer } from '../src/ledger';
import type { decode as Decode, encode as Encode } from '../src/rle';
import type { binarySearch as BinarySearch } from '../src/search';
import type { sort as Sort } from '../src/sort';
import * as arb from './arbitraries';
import type { LeanOracle } from './oracle';

// Differential properties: run the TypeScript and the proven Lean model on the same input
// and demand the same answer: the same array, the same index, the same error. This is
// stronger than the restated theorems in `theorems.ts`, which only check what the
// theorems say. The model also fixes everything they leave open, such as which error a
// bad transfer reports.

export type Differential = fc.IAsyncProperty<unknown>;

export const sortAgrees = (oracle: LeanOracle, sort: typeof Sort) =>
  fc.asyncProperty(arb.ints, async (xs) => {
    expect(sort(xs)).toEqual(await oracle.sort(xs));
  }) as Differential;

/** On any array, sorted or not: the model copies the loop, so even the index must match. */
export const searchAgrees = (oracle: LeanOracle, binarySearch: typeof BinarySearch) =>
  fc.asyncProperty(fc.oneof(arb.ascendingWithTarget, arb.anyWithTarget), async ([xs, t]) => {
    expect(binarySearch(xs, t)).toBe(await oracle.binarySearch(xs, t));
  }) as Differential;

export const encodeAgrees = (oracle: LeanOracle, encode: typeof Encode) =>
  fc.asyncProperty(fc.oneof(arb.runny, arb.ints), async (xs) => {
    expect(encode(xs)).toEqual(await oracle.encode(xs));
  }) as Differential;

/** Any runs, not only canonical ones. */
export const decodeAgrees = (oracle: LeanOracle, decode: typeof Decode) =>
  fc.asyncProperty(arb.runs, async (runs) => {
    expect(decode(runs)).toEqual(await oracle.decode(runs));
  }) as Differential;

export const transferAgrees = (oracle: LeanOracle, transfer: typeof Transfer) =>
  fc.asyncProperty(arb.transferCase, async ({ balances, from, to, amount }) => {
    expect(transfer(balances, from, to, amount)).toEqual(
      await oracle.transfer(balances, from, to, amount),
    );
  }) as Differential;

export const settleAgrees = (oracle: LeanOracle, settle: typeof Settle) =>
  fc.asyncProperty(arb.settleCase, async ({ balances, transfers }) => {
    expect(settle(balances, transfers)).toEqual(await oracle.settle(balances, transfers));
  }) as Differential;

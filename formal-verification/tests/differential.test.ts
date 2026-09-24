import fc from 'fast-check';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { settle, transfer } from '../src/ledger';
import { decode, encode } from '../src/rle';
import { binarySearch } from '../src/search';
import { sort } from '../src/sort';
import {
  decodeAgrees,
  encodeAgrees,
  searchAgrees,
  settleAgrees,
  sortAgrees,
  transferAgrees,
} from './differential';
import { LeanOracle } from './oracle';

// The TypeScript implementation against the proven Lean models, on thousands of random
// inputs each. Agreement transfers the Lean theorems to the implementation on those inputs.

let oracle: LeanOracle;
beforeAll(() => {
  oracle = LeanOracle.start();
});
afterAll(() => oracle?.stop());

const numRuns = 2_000;

describe('TypeScript agrees with the Lean model', () => {
  it('sort ≡ Sorting.insertionSort', () => fc.assert(sortAgrees(oracle, sort), { numRuns }));
  it('binarySearch ≡ BinarySearch.search', () =>
    fc.assert(searchAgrees(oracle, binarySearch), { numRuns }));
  it('encode ≡ RunLength.encode', () => fc.assert(encodeAgrees(oracle, encode), { numRuns }));
  it('decode ≡ RunLength.decode', () => fc.assert(decodeAgrees(oracle, decode), { numRuns }));
  it('transfer ≡ Ledger.transfer', () =>
    fc.assert(transferAgrees(oracle, transfer), { numRuns }));
  it('settle ≡ Ledger.settle', () => fc.assert(settleAgrees(oracle, settle), { numRuns }));
});

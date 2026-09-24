import fc from 'fast-check';
import { describe, it } from 'vitest';
import { settle, transfer } from '../src/ledger';
import { decode, encode } from '../src/rle';
import { binarySearch } from '../src/search';
import { sort } from '../src/sort';
import {
  type Properties,
  rleTheorems,
  searchTheorems,
  settleTheorems,
  sortTheorems,
  transferTheorems,
} from './theorems';

// The Lean theorems restated on the TypeScript implementation. These need no Lean
// toolchain; they are the cheapest layer and the easiest to read.

function check(suite: string, properties: Properties) {
  describe(suite, () => {
    for (const [theorem, property] of Object.entries(properties)) {
      it(theorem, () => fc.assert(property, { numRuns: 500 }));
    }
  });
}

check('sort', sortTheorems(sort));
check('binarySearch', searchTheorems(binarySearch, sort));
check('encode / decode', rleTheorems(encode, decode));
check('transfer', transferTheorems(transfer));
check('settle', settleTheorems(settle));

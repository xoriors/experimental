import fc from 'fast-check';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as guardOrder from '../mutants/ledger-guard-order';
import * as noOverflow from '../mutants/ledger-no-overflow';
import * as selfTransfer from '../mutants/ledger-self-transfer';
import * as lastRun from '../mutants/rle-last-run';
import * as closedBound from '../mutants/search-closed-bound';
import * as dropsTail from '../mutants/sort-drops-tail';
import { decode } from '../src/rle';
import { sort } from '../src/sort';
import {
  type Differential,
  encodeAgrees,
  searchAgrees,
  sortAgrees,
  transferAgrees,
} from './differential';
import { LeanOracle, OracleError } from './oracle';
import {
  type Properties,
  rleTheorems,
  searchTheorems,
  sortTheorems,
  transferTheorems,
} from './theorems';

// Tests for the tests. Each file in mutants/ is the real code with one realistic bug. The
// harness is only worth trusting if it notices: every mutant must be killed by the
// differential test against the Lean oracle. For comparison, each case also records which
// restated theorems catch the bug on their own.

interface Mutant {
  name: string;
  differential: (oracle: LeanOracle) => Differential;
  theorems: Properties;
  /** Whether the restated theorems alone should catch it. */
  theoremsCatchIt: boolean;
}

const mutants: Mutant[] = [
  {
    name: 'sort-drops-tail',
    differential: (o) => sortAgrees(o, dropsTail.sort),
    theorems: sortTheorems(dropsTail.sort),
    theoremsCatchIt: true,
  },
  {
    name: 'search-closed-bound',
    differential: (o) => searchAgrees(o, closedBound.binarySearch),
    theorems: searchTheorems(closedBound.binarySearch, sort),
    theoremsCatchIt: true,
  },
  {
    name: 'rle-last-run',
    differential: (o) => encodeAgrees(o, lastRun.encode),
    theorems: rleTheorems(lastRun.encode, decode),
    theoremsCatchIt: true,
  },
  {
    name: 'ledger-self-transfer',
    differential: (o) => transferAgrees(o, selfTransfer.transfer),
    theorems: transferTheorems(selfTransfer.transfer),
    theoremsCatchIt: true,
  },
  {
    name: 'ledger-no-overflow',
    differential: (o) => transferAgrees(o, noOverflow.transfer),
    theorems: transferTheorems(noOverflow.transfer),
    theoremsCatchIt: true,
  },
  {
    name: 'ledger-guard-order',
    differential: (o) => transferAgrees(o, guardOrder.transfer),
    theorems: transferTheorems(guardOrder.transfer),
    theoremsCatchIt: false,
  },
];

let oracle: LeanOracle;
beforeAll(() => {
  oracle = LeanOracle.start();
});
afterAll(() => oracle?.stop());

describe('every mutant is killed by the Lean oracle', () => {
  for (const m of mutants) {
    it(m.name, async () => {
      const run = await fc.check(m.differential(oracle), { numRuns: 10_000 });
      expect(run.failed, `${m.name} survived ${run.numRuns} random inputs`).toBe(true);
      // A crashing oracle would also "fail" the property; make sure it was a real mismatch.
      expect(run.errorInstance).not.toBeInstanceOf(OracleError);

      const caughtBy = Object.entries(m.theorems)
        .filter(([, property]) => fc.check(property, { numRuns: 2_000 }).failed)
        .map(([theorem]) => theorem);
      expect(caughtBy.length > 0, `theorems that caught it: ${caughtBy}`).toBe(
        m.theoremsCatchIt,
      );

      console.log(
        `${m.name}: killed after ${run.numRuns} inputs, ` +
          `shrunk to ${fc.stringify(run.counterexample)}; ` +
          `restated theorems that also catch it: ${caughtBy.join(', ') || 'none'}`,
      );
    });
  }
});

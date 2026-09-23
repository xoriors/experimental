import type { Run } from '../src/rle';

// MUTANT of src/rle.ts. Bug: the classic "current run" encoder that pushes a run when the
// value changes and forgets to push the final run after the loop.
export function encode(xs: readonly number[]): Run[] {
  const runs: Run[] = [];
  if (xs.length === 0) return runs;
  let value = xs[0];
  let count = 1;
  for (let i = 1; i < xs.length; i++) {
    if (xs[i] === value) {
      count++;
    } else {
      runs.push([value, count]);
      value = xs[i];
      count = 1;
    }
  }
  return runs;
}

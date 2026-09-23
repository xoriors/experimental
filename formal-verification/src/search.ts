/**
 * Index of `target` in the ascending array `xs`, or `-1` if it is absent. With
 * duplicates, returns whichever matching index the halving reaches first.
 *
 * Model: `Verified.BinarySearch.search` in `lean/Verified/BinarySearch.lean`, which copies
 * this loop step for step. Proven there: a returned index always holds `target`, even on
 * unsorted input (`search_sound`), and on sorted input `-1` means absent
 * (`search_eq_none_iff`).
 */
export function binarySearch(xs: readonly number[], target: number): number {
  // Half-open window [lo, hi).
  let lo = 0;
  let hi = xs.length;
  while (lo < hi) {
    const mid = lo + Math.floor((hi - lo) / 2);
    if (xs[mid] === target) return mid;
    if (xs[mid] < target) lo = mid + 1;
    else hi = mid;
  }
  return -1;
}

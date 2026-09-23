// MUTANT of src/search.ts. Bug: `hi = mid - 1` belongs to the closed-interval variant
// [lo, hi]; mixed with the half-open loop condition it skips index `mid - 1`.
export function binarySearch(xs: readonly number[], target: number): number {
  let lo = 0;
  let hi = xs.length;
  while (lo < hi) {
    const mid = lo + Math.floor((hi - lo) / 2);
    if (xs[mid] === target) return mid;
    if (xs[mid] < target) lo = mid + 1;
    else hi = mid - 1;
  }
  return -1;
}

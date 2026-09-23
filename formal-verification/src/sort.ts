/**
 * Sort numbers ascending with a bottom-up merge sort. Returns a new array.
 *
 * Model: `Verified.Sorting.insertionSort` in `lean/Verified/Sorting.lean`. That is a
 * different algorithm, on purpose: Lean proves sorted permutations are unique
 * (`sorted_unique`), so any correct sort must match the model element for element.
 */
export function sort(xs: readonly number[]): number[] {
  const n = xs.length;
  let src = xs.slice();
  let dst = new Array<number>(n);
  for (let width = 1; width < n; width *= 2) {
    for (let lo = 0; lo < n; lo += 2 * width) {
      const mid = Math.min(lo + width, n);
      const hi = Math.min(lo + 2 * width, n);
      let i = lo;
      let j = mid;
      let k = lo;
      while (i < mid && j < hi) dst[k++] = src[i] <= src[j] ? src[i++] : src[j++];
      while (i < mid) dst[k++] = src[i++];
      while (j < hi) dst[k++] = src[j++];
    }
    [src, dst] = [dst, src];
  }
  return src;
}

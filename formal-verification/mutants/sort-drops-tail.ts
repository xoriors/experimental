// MUTANT of src/sort.ts. Bug: after the merge loop, only the left half's leftovers are
// copied, so whatever remains of the right half is lost.
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
    }
    [src, dst] = [dst, src];
  }
  return src;
}

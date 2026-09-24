/** `[value, count]`: `count` copies of `value`. */
export type Run = [value: number, count: number];

/**
 * Run-length encode: `[5, 5, 5, 2]` becomes `[[5, 3], [2, 1]]`.
 *
 * Model: `Verified.RunLength.encode` in `lean/Verified/RunLength.lean`. Proven there:
 * `decode(encode(xs))` is `xs` (`decode_encode`), the output never has an empty run or
 * two neighbouring runs of the same value (`encode_canonical`), and it is never longer
 * than the input (`encode_length_le`).
 */
export function encode(xs: readonly number[]): Run[] {
  const runs: Run[] = [];
  for (const x of xs) {
    const last = runs.at(-1);
    if (last !== undefined && last[0] === x) last[1]++;
    else runs.push([x, 1]);
  }
  return runs;
}

/**
 * Expand runs back into values. Accepts any runs, including empty ones and neighbours
 * with the same value; for canonical runs it inverts `encode` (`encode_decode`).
 */
export function decode(runs: readonly (readonly [number, number])[]): number[] {
  const out: number[] = [];
  for (const [value, count] of runs) {
    for (let i = 0; i < count; i++) out.push(value);
  }
  return out;
}

/** Run-length encoding for small-alphabet rasters: [value, count, value, count, ...]. */
export function encodeRle(z: Uint8Array): number[] {
  const out: number[] = [];
  let i = 0;
  while (i < z.length) {
    let j = i;
    while (j < z.length && z[j] === z[i]) j++;
    out.push(z[i], j - i);
    i = j;
  }
  return out;
}

export function decodeRle(rle: number[], into: Uint8Array) {
  let p = 0;
  for (let k = 0; k + 1 < rle.length; k += 2) {
    into.fill(rle[k], p, p + rle[k + 1]);
    p += rle[k + 1];
  }
}

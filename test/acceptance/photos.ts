/**
 * Deterministic photos for the cases that plant an image in `src/assets/` (specification, 14.2).
 * `sharp` comes from the base copy through Astro, so the suite adds no dependency.
 */
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { base } from './harness.ts';

interface Sharp {
  jpeg(options: { quality: number }): Sharp;
  toBuffer(): Promise<Buffer>;
}
type SharpFactory = (input: Uint8Array, options: { raw: { width: number; height: number; channels: 3 } }) => Sharp;

/** xorshift32 with seed 7: the same numbers on every machine. */
function generator(): () => number {
  let seed = 7;
  return () => {
    seed ^= seed << 13;
    seed >>>= 0;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    seed >>>= 0;
    return seed / 2 ** 32;
  };
}

const clamp = (value: number): number => Math.max(0, Math.min(255, Math.round(value)));

/** A JPEG of `width` × `height`: one flat color with the same noise on all three channels. */
export function photo(
  width: number,
  height: number,
  color: [number, number, number] = [120, 140, 150],
): Promise<Buffer> {
  const sharp = createRequire(join(base(), 'node_modules/astro/package.json'))('sharp') as SharpFactory;
  const r = generator();
  const pixels = new Uint8Array(width * height * 3);
  for (let i = 0; i < width * height; i++) {
    const n = (r() + r() + r() - 1.5) * 18;
    pixels[i * 3] = clamp(color[0] + n);
    pixels[i * 3 + 1] = clamp(color[1] + n);
    pixels[i * 3 + 2] = clamp(color[2] + n);
  }
  return sharp(pixels, { raw: { width, height, channels: 3 } })
    .jpeg({ quality: 82 })
    .toBuffer();
}

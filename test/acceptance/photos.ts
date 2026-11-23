/**
 * Deterministic photos (specification, 14.2): for the cases that plant an image in `src/assets/`, and for the photos
 * that the test site commits (`site-assets.ts`). `sharp` comes from an Astro install, so the suite adds no dependency:
 * by default from the base copy, or from the install that `sharpFrom` names.
 */
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { base } from './harness.ts';

interface Sharp {
  jpeg(options: { quality: number }): Sharp;
  toBuffer(): Promise<Buffer>;
}
export type SharpFactory = (
  input: Uint8Array,
  options: { raw: { width: number; height: number; channels: 3 } },
) => Sharp;

export type Rgb = [number, number, number];

/** The amplitude of the noise of 14.2. */
const NOISE = 18;

/** `sharp` of the Astro install whose `package.json` is `astroManifest`. */
export const sharpFrom = (astroManifest: string): SharpFactory => createRequire(astroManifest)('sharp') as SharpFactory;

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

export interface PhotoOptions {
  /** The amplitude of the noise. The default is the one of 14.2. A share image may use less, so it stays small. */
  noise?: number;
  /** The `sharp` that writes the JPEG. The default is the one of the base copy. */
  sharp?: SharpFactory;
}

/**
 * A JPEG of `width` × `height`: one flat color with the same noise on all three channels, written with quality 82.
 * Each photo starts the generator again, so a photo depends only on its size, its color and its noise.
 */
export function photo(
  width: number,
  height: number,
  color: Rgb = [120, 140, 150],
  options: PhotoOptions = {},
): Promise<Buffer> {
  const sharp = options.sharp ?? sharpFrom(join(base(), 'node_modules/astro/package.json'));
  const amplitude = options.noise ?? NOISE;
  const r = generator();
  const pixels = new Uint8Array(width * height * 3);
  for (let i = 0; i < width * height; i++) {
    const n = (r() + r() + r() - 1.5) * amplitude;
    pixels[i * 3] = clamp(color[0] + n);
    pixels[i * 3 + 1] = clamp(color[1] + n);
    pixels[i * 3 + 2] = clamp(color[2] + n);
  }
  return sharp(pixels, { raw: { width, height, channels: 3 } })
    .jpeg({ quality: 82 })
    .toBuffer();
}

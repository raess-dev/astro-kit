import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync, constants, zstdCompressSync } from 'node:zlib';
import { BASE_CSS } from '../../src/config.ts';
import { SPEC, specBlock } from './spec.ts';

/** A file of the kit repository, by its path from the root. */
const kitFile = (path: string): string => fileURLToPath(new URL(`../../${path}`, import.meta.url));

const CSS_PATH = 'css/base.css';
const css = readFileSync(kitFile(CSS_PATH));
const text = css.toString('utf8');

/** The limit of 7.6, in bytes. */
const MAX_COMPRESSED = 2_048;

/** The compressed size of section 8: the larger of zstd level 3 and brotli quality 5. */
function compressedSize(bytes: Uint8Array): number {
  const zstd = zstdCompressSync(bytes, { params: { [constants.ZSTD_c_compressionLevel]: 3 } });
  const brotli = brotliCompressSync(bytes, { params: { [constants.BROTLI_PARAM_QUALITY]: 5 } });
  return Math.max(zstd.byteLength, brotli.byteLength);
}

/** The first text in backticks after a marker text of the specification. Throws when there is none. */
function specValue(marker: string): string {
  const start = SPEC.indexOf(marker);
  const found = start < 0 ? null : /`([^`]+)`/.exec(SPEC.slice(start + marker.length));
  if (found?.[1] === undefined) throw new Error(`docs/spec.md has no value after ${JSON.stringify(marker)}`);
  return found[1];
}

/** The `package.json` of the kit, as far as the test reads it. */
interface Manifest {
  name: string;
  files: string[];
  exports: Record<string, unknown>;
}

function manifest(): Manifest {
  const value: unknown = JSON.parse(readFileSync(kitFile('package.json'), 'utf8'));
  return value as Manifest;
}

test('css/base.css equals the text of 7.6 byte for byte, with one final newline', () => {
  assert.equal(text, `${specBlock('### 7.6 base.css (exact)', 'css')}\n`);
  assert.deepEqual(css, Buffer.from(text, 'utf8'));
  assert.equal(text.includes('\r'), false);
  assert.equal(text.endsWith('}\n'), true);
  assert.equal(text.endsWith('\n\n'), false);
});

test('css/base.css starts with the order statement of 7.1', () => {
  const order = specValue('starts with the order statement:');
  assert.equal(order, '@layer astro, reset, tokens, elements, layout, components, page;');
  assert.equal(text.split('\n')[0], order);
});

test('css/base.css holds the order statement, the reset block, the layout block and the view transition, in this order', () => {
  const parts = ['@layer astro,', '@layer reset {', '@layer layout {', '@view-transition {'];
  const places = parts.map((part) => text.indexOf(part));
  assert.equal(places.includes(-1), false);
  assert.deepEqual(
    places,
    places.toSorted((a, b) => a - b),
  );
  assert.equal(text.split('@layer ').length - 1, 3);
});

test('css/base.css is at most 2,048 B compressed: the larger of zstd level 3 and brotli quality 5', () => {
  const size = compressedSize(css);
  assert.equal(size > 0 && size <= MAX_COMPRESSED, true, `${size} B`);
  // The measure itself can fail: bytes without a pattern do not compress, so they are over the limit.
  let seed = 1;
  const noise = Uint8Array.from({ length: 4_096 }, () => {
    seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
    return Math.floor(seed / 65_536) % 256;
  });
  assert.equal(compressedSize(noise) > MAX_COMPRESSED, true);
});

test('the specifier of step 9 names css/base.css through the export of 3.4', () => {
  const { name, files, exports } = manifest();
  assert.equal(BASE_CSS, `${name}/${CSS_PATH}`);
  assert.equal(exports[`./${CSS_PATH}`], `./${CSS_PATH}`);
  assert.equal(files.includes('css'), true);
});

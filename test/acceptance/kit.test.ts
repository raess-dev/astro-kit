import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { KIT_DIR, standIn } from './harness.ts';

test('the stand-in integration holds the exact texts of the specification', async () => {
  // The stand-in integration is plain JavaScript: `standIn` imports it by its file URL and gives it a type.
  const { modeScript, SPECULATION_HASH, SPECULATION_JSON, sha256 } = await standIn();
  // 6.2: the speculation JSON and its hash.
  assert.equal(SPECULATION_HASH, 'sha256-4255RGsO6JUC8vuukcO69AaAmBKnnolynaWf9b0Q6og=');
  assert.equal(JSON.stringify(JSON.parse(SPECULATION_JSON)), SPECULATION_JSON);
  // 9.3: the test vector of the mode script with all four options and D = auto.
  const script = modeScript({ auto: true, light: true, dark: true, contrast: true });
  assert.equal(Buffer.byteLength(script), 1080);
  assert.equal(sha256(script), 'sha256-tVX7IDqXb4rkmRiqqGfEY8YPs6KvuNlSnmTbTdmGmSs=');
  // 7.6: base.css starts with the order statement.
  const css = readFileSync(join(KIT_DIR, 'base.css'), 'utf8');
  assert.ok(css.startsWith('@layer astro, reset, tokens, elements, layout, components, page;\n'));
});

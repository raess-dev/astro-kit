/**
 * The PDF menu of the test site holds two facts of `site.json`: the price of the evening menu and the phone of the
 * restaurant. `facts-value` reads only pages, so this test keeps the committed PDF equal to the one that
 * `site-assets.ts` makes from the current `site.json`. It needs no `sharp` and no build.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { SITE } from './harness.ts';
import { MENU_FILE, menuPdf } from './site-assets.ts';

test('the committed PDF menu is the one that site-assets.ts makes from site.json', () => {
  const facts = JSON.parse(readFileSync(join(SITE, 'site.json'), 'utf8')) as Parameters<typeof menuPdf>[0];
  const committed = readFileSync(join(SITE, MENU_FILE));
  assert.ok(
    committed.equals(menuPdf(facts)),
    `test/site/${MENU_FILE} differs from site.json: run node test/acceptance/site-assets.ts`,
  );
});

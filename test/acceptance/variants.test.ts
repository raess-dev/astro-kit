/**
 * The variants of 14.2 that milestone M7 adds. The `forms` variant is the site as it is, so its assertions stand in
 * `site.test.ts` on the one build of the site. This file holds the `static` variant: forms off (`toStatic` of
 * `variants.ts`). From M9 a variant runs `check`, `build` and `test` (14.2, Variants). Run:
 * node --test test/acceptance/variants.test.ts
 */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { type KitRun, passedLine, read, run, siteCase } from './harness.ts';
import { toStatic } from './variants.ts';
import { WRANGLER_STATIC } from './wrangler.ts';

/** The last part of a command's output, for the message of a failed assertion. */
const tail = (result: KitRun): string => result.output.slice(-6000);

/** The passed line of a command that ran checks and passed: the last line of stdout, once in the output (6.4). */
const PASSED = { last: true, count: 1 } as const;

test('M7 variant static: forms off passes check and builds a static site with Trusted Types and the static wrangler.jsonc', () => {
  const dir = siteCase('variant-static');
  toStatic(dir);
  // The static text of 10.4 for the host of the site: `WRANGLER_STATIC` names the Worker `example-ch` on `example.ch`.
  assert.equal(
    read(dir, 'wrangler.jsonc'),
    WRANGLER_STATIC.replaceAll('example-ch', 'laerchenwald-example').replaceAll('example.ch', 'laerchenwald.example'),
  );

  const checked = run(dir, 'check');
  assert.equal(checked.status, 0, tail(checked));
  assert.deepEqual(checked.ids, []);
  assert.deepEqual(passedLine(checked), PASSED, tail(checked));

  const built = run(dir, 'build');
  assert.equal(built.status, 0, tail(built));
  assert.deepEqual(built.ids, []);
  assert.deepEqual(passedLine(built), PASSED, tail(built));
  assert.ok(!existsSync(join(dir, 'dist/server')), 'a static build has no dist/server/');
  assert.ok(!existsSync(join(dir, 'dist/client')), 'a static build writes the pages to dist/ itself');
  // Trusted Types are on: no island and no script, so the header policy requires them (6.2).
  const headers = read(dir, 'dist/_headers');
  assert.match(headers, /Content-Security-Policy: [^\n]*require-trusted-types-for 'script'; trusted-types 'none'/);
  assert.ok(!read(dir, 'dist/kontakt/index.html').includes('<form'), 'the contact page holds no form');

  const tested = run(dir, 'test');
  assert.equal(tested.status, 0, tail(tested));
  assert.deepEqual(tested.ids, []);
  assert.deepEqual(passedLine(tested), PASSED, tail(tested));
});

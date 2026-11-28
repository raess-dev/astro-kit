/**
 * The `islands` variant of 14.2 (milestone M8): islands on, and the Solid island `MoreLinks` on the German rooms page
 * (`toIslands` of `variants.ts`). From M9 a variant runs `check`, `build` and `test` (14.2, Variants): `check`
 * compares the ESLint shim and runs `eslint --config eslint.config.mjs --no-inline-config --max-warnings 0 src` on the island. `init --shims` writes the
 * shim from the settings and keeps the other shims (part 9c). The islands pins come from the base copy, installed
 * with `--no-save`.
 * Run: node --test test/acceptance/variants-islands.test.ts
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import type * as IslandsModule from '../../src/islands.ts';
import {
  base,
  browse,
  CLIENT,
  cspMeta,
  edit,
  type KitRun,
  kitModule,
  passedLine,
  plain,
  read,
  run,
  siteCase,
  tree,
  write,
} from './harness.ts';
import { ISLAND_CLASS, ISLAND_PAGE, toIslands } from './variants.ts';

/** The last part of a command's output, for the message of a failed assertion. */
const tail = (result: KitRun): string => result.output.slice(-6000);

/** The passed line of a command that ran checks and passed: the last line of stdout, once in the output (6.4). */
const PASSED = { last: true, count: 1 } as const;

test('M8 variant islands: a Solid island passes check with ESLint, builds and passes test, with no Trusted Types and its browser-only class', async () => {
  const dir = siteCase('variant-islands');
  toIslands(dir);

  // `init --shims` writes the ESLint shim of the enabled islands and keeps every shim that exists. It runs no check,
  // so it prints no passed line (6.4).
  const shims = run(dir, 'init --shims');
  assert.equal(shims.status, 0, tail(shims));
  assert.equal(
    shims.stdout,
    'kept astro.config.mjs\nkept biome.json\nwrote eslint.config.mjs\nkept src/pages/api/forms/[form].ts\nkept tsconfig.json\nNext:\n  npx --no astro-kit check\n',
  );
  assert.deepEqual(passedLine(shims), { last: false, count: 0 });
  const template = join(base(), 'node_modules/@raess/astro-kit/templates/features/islands/eslint.config.mjs');
  assert.equal(read(dir, 'eslint.config.mjs'), readFileSync(template, 'utf8'));

  const checked = run(dir, 'check');
  assert.equal(checked.status, 0, tail(checked));
  assert.deepEqual(checked.ids, []);
  assert.deepEqual(passedLine(checked), PASSED, tail(checked));

  const built = run(dir, 'build');
  assert.equal(built.status, 0, tail(built));
  assert.deepEqual(built.ids, []);
  assert.deepEqual(passedLine(built), PASSED, tail(built));

  const client = join(dir, CLIENT);
  const page = read(client, `${ISLAND_PAGE.slice(1)}index.html`);
  assert.ok(page.includes('<astro-island'), 'the rooms page holds the island');
  // Solid writes HTML through templates, so Trusted Types are off on an islands site (9.2), in the meta and the header.
  for (const file of tree(client).filter((name) => name.endsWith('.html'))) {
    assert.ok(!cspMeta(read(client, file)).includes('trusted-types'), file);
  }
  assert.ok(!read(client, '_headers').includes('trusted-types'), 'the header policy has no Trusted Types');
  // The kit hashes the hydration script of the installed solid-js (13.1 item 11).
  const { solidHydrationHash } = await kitModule<typeof IslandsModule>('islands');
  assert.ok(cspMeta(page).includes(`'${await solidHydrationHash(dir)}'`), 'the CSP meta holds the Solid hash');
  // `css-unused` accepted the class that the island adds in the browser: no page holds it, a bundled file does (7.8).
  const onElement = new RegExp(`\\sclass="[^"]*(?<![\\w-])${ISLAND_CLASS}(?![\\w-])`);
  for (const file of tree(client).filter((name) => name.endsWith('.html'))) {
    assert.ok(!onElement.test(read(client, file)), `no element of ${file} has the class`);
  }
  assert.ok(page.includes(`.${ISLAND_CLASS}`), 'the CSS of the page has the modifier');
  const assets = join(client, '_astro');
  const bundled = readdirSync(assets).filter((file) => file.endsWith('.js'));
  assert.ok(
    bundled.some((file) => new RegExp(`(?<![\\w-])${ISLAND_CLASS}(?![\\w-])`).test(read(assets, file))),
    'a bundled file holds the class',
  );

  // The island hydrates under the CSP of the kit: in the browser it adds its class once it is in view.
  const { server, browser, close } = await browse(join(dir, 'dist'));
  try {
    const context = await browser.newContext();
    const tab = await context.newPage();
    await tab.goto(`${server.origin}${ISLAND_PAGE}`, { waitUntil: 'load' });
    // `astro-island` has `display: contents` and no box, so the page scrolls to its first element.
    await tab.evaluate(() => document.querySelector('astro-island > *')?.scrollIntoView({ behavior: 'instant' }));
    await tab.waitForFunction((name: string) => document.querySelector(`.${name}`) !== null, ISLAND_CLASS, {
      timeout: 15_000,
    });
  } finally {
    await close();
  }

  const tested = run(dir, 'test');
  assert.equal(tested.status, 0, tail(tested));
  assert.deepEqual(tested.ids, []);
  assert.deepEqual(passedLine(tested), PASSED, tail(tested));

  // `check` ran ESLint on the island: props taken apart lose their reactivity, a Solid rule that Biome does not
  // have (9.2). Biome passes the file, so ESLint fails `check`, and `astro check` does not start.
  edit(dir, 'src/components/MoreLinks.tsx', 'MoreLinks(props: Props)', 'MoreLinks({ label, links }: Props)');
  edit(dir, 'src/components/MoreLinks.tsx', '{props.label}', '{label}');
  edit(dir, 'src/components/MoreLinks.tsx', '{props.links}', '{links}');
  const linted = run(dir, 'check');
  assert.equal(linted.status, 1, tail(linted));
  assert.deepEqual(linted.ids, []);
  assert.deepEqual(passedLine(linted), { last: false, count: 0 }, tail(linted));
  assert.match(plain(linted.output), /solid\/no-destructure/, tail(linted));
  assert.doesNotMatch(plain(linted.output), /Getting diagnostics/, tail(linted));

  // ESLint lints the `.ts` helpers of an island too (9.2): a signal read outside a tracking scope in a `.ts` file
  // fails `check` with `solid/reactivity`, which a shim for `.tsx` alone missed.
  edit(dir, 'src/components/MoreLinks.tsx', 'MoreLinks({ label, links }: Props)', 'MoreLinks(props: Props)');
  edit(dir, 'src/components/MoreLinks.tsx', '{label}', '{props.label}');
  edit(dir, 'src/components/MoreLinks.tsx', '{links}', '{props.links}');
  write(dir, {
    'src/lib/count.ts': [
      "import { createSignal } from 'solid-js';",
      '',
      'export function createLabel(start: number) {',
      '  const [count, setCount] = createSignal(start);',
      '  const value = count();',
      '  return { value: () => value, add: () => setCount(count() + 1) };',
      '}',
      '',
    ].join('\n'),
  });
  const helper = run(dir, 'check');
  assert.equal(helper.status, 1, tail(helper));
  assert.deepEqual(helper.ids, []);
  assert.match(plain(helper.output), /src\/lib\/count\.ts[\s\S]*solid\/reactivity/, tail(helper));
  assert.doesNotMatch(plain(helper.output), /Getting diagnostics/, tail(helper));
});

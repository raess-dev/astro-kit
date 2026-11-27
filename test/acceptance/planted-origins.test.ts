/**
 * The `scripts` and `origins` variants and the `origins` set of the planted violations (specification, 14.2;
 * milestone M8). They share one build of one copy of the test site:
 *
 * - The variant: `features.scripts` on and the origin of OpenStreetMap with `load: "gesture"`; a button on the three
 *   getting-here pages and a bundled script that adds the map frame on a click; the processor named on the three
 *   privacy pages (`toOrigins` of `variants.ts`). The build passes. The CSP meta of every page allows the frame of the
 *   host, and no built page holds a frame. `test` passes, `origins-gesture` with it: nothing reaches the host before
 *   a click. Before M9 a variant runs `build` and `test`; `check` and `legal --write` join at M9.
 * - The `scripts` variant is this change without the origin: scripts on and a bundled script. Its extra assertions
 *   (a `<script type="module"`, no `trusted-types`) hold on this build, so it gets no build and no `test` of its own,
 *   which would cost about 4 minutes of `kit / acceptance`.
 * - The set: the variant, then a frame of the map with `title="Map"` planted in the built German home page. One
 *   `test --all` run must report exactly `origins-gesture`, and no passed line.
 *
 * The browser of the kit answers each request to another origin itself, or refuses it (section 8), so neither run
 * reaches OpenStreetMap.
 *
 * `KIT_PLANTED_DROP=origins-gesture` runs the set without its plant: it is the variant, and `test --all` passes. CI does
 * not set it.
 *
 * Run: node --test test/acceptance/planted-origins.test.ts
 */
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import { CLIENT, cspMeta, edit, type KitRun, passedLine, read, run, siteCase, tree } from './harness.ts';
import { MAP_ORIGIN, MAP_URL, toOrigins } from './variants.ts';

/** The ids of the set, sorted. */
const ORIGINS_IDS = ['origins-gesture'];

/** The last part of a command's output, for the message of a failed assertion. */
const tail = (result: KitRun): string => result.output.slice(-6000);

/** The built getting-here pages, which hold the button of the map. */
const MAP_PAGE_FILES = ['anreise/index.html', 'fr/acces/index.html', 'en/getting-here/index.html'];

/** Says whether a CSP holds `frame-src` with the source of the map as a whole token: a longer host does not count. */
const framesMap = (csp: string): boolean =>
  csp
    .split(';')
    .map((directive) => directive.trim().split(/\s+/))
    .some(([name, ...sources]) => name === 'frame-src' && sources.includes(`https://${MAP_ORIGIN.host}`));

/** The passed line of a command that ran checks and passed: the last line of stdout, once in the output (6.4). */
const PASSED = { last: true, count: 1 } as const;

const drop = process.env.KIT_PLANTED_DROP;

let made: { dir: string; build: KitRun } | undefined;

/** The case folder of the variant and its build, made once for both tests of this file. */
function built(): { dir: string; build: KitRun } {
  if (made !== undefined) return made;
  const dir = siteCase(drop === undefined ? 'planted-origins' : `planted-origins-without-${drop}`);
  toOrigins(dir);
  made = { dir, build: run(dir, 'build') };
  return made;
}

test('M8 variants scripts and origins: a map frame behind a bundled click builds, holds no frame, and passes test', () => {
  if (drop !== undefined && !ORIGINS_IDS.includes(drop)) {
    throw new Error(`KIT_PLANTED_DROP: ${drop} is no id of the origins set`);
  }
  const { dir, build } = built();
  assert.equal(build.killed, undefined, tail(build));
  assert.equal(build.status, 0, tail(build));
  assert.deepEqual(build.ids, []);
  assert.deepEqual(passedLine(build), PASSED, tail(build));
  const client = join(dir, CLIENT);
  const pages = tree(client).filter((name) => name.endsWith('.html'));
  assert.ok(pages.length > 20, 'the site has its pages');
  for (const file of pages) {
    const html = read(client, file);
    assert.ok(framesMap(cspMeta(html)), file);
    assert.ok(!/<iframe\b/i.test(html), `${file} holds no frame`);
  }
  for (const file of MAP_PAGE_FILES)
    assert.ok(read(client, file).includes('data-map-button'), `the button is on ${file}`);
  // The `scripts` variant: the bundled script is a module script, and a project script turns Trusted Types off (6.2).
  assert.ok(read(client, 'anreise/index.html').includes('<script type="module"'), 'the bundled script is a module');
  for (const file of pages) assert.ok(!cspMeta(read(client, file)).includes('trusted-types'), file);
  assert.ok(!read(client, '_headers').includes('trusted-types'), 'the header policy has no Trusted Types');

  const tested = run(dir, 'test');
  assert.equal(tested.killed, undefined, tail(tested));
  assert.equal(tested.status, 0, tail(tested));
  assert.deepEqual(tested.ids, []);
  assert.deepEqual(passedLine(tested), PASSED, tail(tested));
});

test('M8 planted: the origins set gives exactly its ids', () => {
  if (drop !== undefined && !ORIGINS_IDS.includes(drop)) {
    throw new Error(`KIT_PLANTED_DROP: ${drop} is no id of the origins set`);
  }
  const { dir, build } = built();
  assert.equal(build.killed, undefined, tail(build));
  assert.equal(build.status, 0, tail(build));
  assert.deepEqual(build.ids, []);
  assert.deepEqual(passedLine(build), PASSED, tail(build));
  if (drop !== 'origins-gesture') {
    // The frame loads with the page, before any gesture: the host gets a request with the visitor's address.
    edit(
      dir,
      `${CLIENT}/index.html`,
      '</main>',
      `<iframe src="${MAP_URL.replaceAll('&', '&amp;')}" title="Map"></iframe></main>`,
    );
  }
  const result = run(dir, ['test', '--all']);
  assert.equal(result.killed, undefined, tail(result));
  const expected = ORIGINS_IDS.filter((id) => id !== drop);
  assert.deepEqual(result.ids, expected, tail(result));
  // With KIT_PLANTED_DROP=origins-gesture the list is empty: the copy is the variant, and `test --all` passes.
  const failing = expected.length > 0;
  assert.equal(result.status, failing ? 1 : 0, tail(result));
  assert.deepEqual(passedLine(result), failing ? { last: false, count: 0 } : PASSED, tail(result));
  // The finding names the host and the frame's URL: `[origins-gesture] /: <message> (1280×800: <origin> got …)`.
  const host = MAP_ORIGIN.host.replaceAll('.', '\\.');
  const finding = new RegExp(`\\[origins-gesture\\] /: .*\\(1280×800: https://${host} got a request before a gesture`);
  assert.equal(finding.test(result.output), failing, tail(result));
  // The plant is on the home page alone, so every finding of the rule is on `/`.
  const places = [...result.output.matchAll(/\[origins-gesture\] (\S+):/g)].map((match) => match[1]);
  assert.deepEqual([...new Set(places)], failing ? ['/'] : [], tail(result));
});

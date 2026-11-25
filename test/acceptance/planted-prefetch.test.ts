/**
 * The `prefetch` set of the planted violations at milestone M6 (specification, 14.2, "Planted-violation sets"). One
 * copy of the test site gets the settings of the `prefetch-astro` variant: the case writes `prefetch.astroPrefetch`
 * true and `prefetch.speculationRules` false into its `astro-kit.json`. The build passes. Then the two plants go into
 * the built `dist/`, each a module script of its own on one page of the sample. One `test --all` run must report
 * exactly the ids of the set, and no passed line.
 *
 * - `perf-bfcache`: an `unload` listener on the German privacy page. Chromium keeps no page with such a listener in
 *   the back/forward cache. It changes nothing for the prefetch.
 * - `perf-prefetch`: on the German jobs page, a script adds a query to the URL of a link when it is clicked, as a
 *   click counter does. The hover prefetches the link's URL, and the click loads another URL. The page itself enters
 *   the back/forward cache as before.
 *
 * `KIT_PLANTED_DROP=<id>` runs the set without the plant of that id, and expects the list without that id. The review
 * runs it once for each id, to prove that each plant gives its id alone. CI does not set it.
 *
 * Run: node --test test/acceptance/planted-prefetch.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { edit, passedLine, read, run, siteCase, write } from './harness.ts';

/** The ids of the set, sorted. */
const PREFETCH_IDS = ['perf-bfcache', 'perf-prefetch'];

/** Adds a module script of its own to `dist/` and links it from the head of one built page. */
function script(dir: string, path: string, name: string, js: string): void {
  write(dir, { [`dist/${name}.js`]: js });
  edit(dir, `dist${path}index.html`, '</head>', `<script type="module" src="/${name}.js"></script></head>`);
}

const PLANTS: readonly { id: string; plant: (dir: string) => void }[] = [
  {
    id: 'perf-bfcache',
    plant: (dir) => script(dir, '/datenschutz/', 'plant-unload', "addEventListener('unload', () => {});\n"),
  },
  {
    id: 'perf-prefetch',
    plant: (dir) =>
      script(
        dir,
        '/jobs/',
        'plant-click',
        [
          "document.addEventListener('click', (event) => {",
          "  const link = event.target instanceof Element ? event.target.closest('a[href]') : null;",
          "  if (link instanceof HTMLAnchorElement) link.search = '?von=jobs';",
          '});',
          '',
        ].join('\n'),
      ),
  },
];

/** The last part of a command's output, for the message of a failed assertion. */
const tail = (output: string): string => output.slice(-6000);

test('every id of the prefetch set has one plant', () => {
  assert.deepEqual(
    PLANTS.map((plant) => plant.id),
    PREFETCH_IDS,
  );
});

test('M6 planted: the prefetch set gives exactly its ids', () => {
  const drop = process.env.KIT_PLANTED_DROP;
  if (drop !== undefined && !PREFETCH_IDS.includes(drop)) {
    throw new Error(`KIT_PLANTED_DROP: ${drop} is no id of the prefetch set`);
  }
  const dir = siteCase(drop === undefined ? 'planted-prefetch' : `planted-prefetch-without-${drop}`, (folder) => {
    const settings = JSON.parse(read(folder, 'astro-kit.json')) as Record<string, unknown>;
    settings.prefetch = { speculationRules: false, astroPrefetch: true };
    write(folder, { 'astro-kit.json': `${JSON.stringify(settings, null, 2)}\n` });
  });
  const built = run(dir, 'build');
  assert.equal(built.status, 0, tail(built.output));
  assert.ok(!read(dir, 'dist/index.html').includes('speculationrules'), 'the speculation block is off');
  for (const plant of PLANTS) if (plant.id !== drop) plant.plant(dir);
  const result = run(dir, ['test', '--all']);
  assert.deepEqual(
    result.ids,
    PREFETCH_IDS.filter((id) => id !== drop),
    tail(result.output),
  );
  assert.equal(result.status, 1, tail(result.output));
  assert.deepEqual(passedLine(result), { last: false, count: 0 }, tail(result.output));
});

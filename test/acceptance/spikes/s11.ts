import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { astro, read, record } from '../harness.ts';
import { page, project } from './project.ts';

/** A dynamic route that builds one page for each value and says which route file built it. */
const dynamic = (who: string, param: string, values: string[]): string =>
  page(
    who,
    `<p id="who">${who}</p>`,
    `export function getStaticPaths() {\n  return ${JSON.stringify(values)}.map((value) => ({ params: { ${param}: value } }));\n}`,
  );

// Two collisions: a static and a dynamic route build `/kontakt/`, and two dynamic routes build `/zimmer/`.
const files = {
  'src/pages/index.astro': page('Home', '<p id="who">home</p>'),
  'src/pages/kontakt.astro': page('Kontakt', '<p id="who">static</p>'),
  'src/pages/[slug].astro': dynamic('slug', 'slug', ['kontakt', 'zimmer']),
  'src/pages/[...rest].astro': dynamic('rest', 'rest', ['zimmer', 'lage']),
};

interface Conflict {
  path: string;
  from: string;
  winner: string;
}

const CONFLICTS: Conflict[] = [
  { path: '/kontakt', from: '/[slug]', winner: '/kontakt' },
  { path: '/zimmer', from: '/[...rest]', winner: '/[slug]' },
];

/** Every conflict that Astro's output names. The same text is the error and the warning. */
const conflicts = (output: string): Conflict[] =>
  [
    ...output.matchAll(/Could not render `([^`]+)` from route `([^`]+)` as it conflicts with higher priority route `([^`]+)`/g),
  ].map((match) => ({ path: match[1] ?? '', from: match[2] ?? '', winner: match[3] ?? '' }));

/** The route file that built a page, or `none` when the page is not in `dist`. */
const who = (dir: string, path: string): string => {
  const file = `dist${path}index.html`;
  return existsSync(join(dir, file)) ? (/<p id="who">([^<]*)/.exec(read(dir, file))?.[1] ?? '') : 'none';
};

test("S11: with prerenderConflictBehavior 'error', a build in which two routes build one path fails", () => {
  const dir = project('s11', files);
  const run = astro(dir);
  assert.notEqual(run.status, 0, 'the build fails');
  assert.ok(run.output.includes('[PrerenderRouteConflict]'), `the error names the conflict:\n${run.output.slice(-2000)}`);
  const found = conflicts(run.output);
  // Astro throws at the first conflict, before it writes any page.
  assert.equal(found.length, 1, 'one conflict stops the build');
  assert.ok(
    CONFLICTS.some((conflict) => JSON.stringify(conflict) === JSON.stringify(found[0])),
    `the message names the path and both routes: ${JSON.stringify(found[0])}`,
  );
  for (const path of ['/', '/kontakt/', '/zimmer/', '/lage/']) assert.equal(who(dir, path), 'none', `${path} is not built`);
  record('S11.error', { status: run.status, conflict: found[0] });
});

test("S11: the default 'warn' builds the same project, warns, and skips the lower-priority route", () => {
  const dir = project('s11-warn', files, "{ config: { prerenderConflictBehavior: 'warn' } }");
  const run = astro(dir);
  assert.equal(run.status, 0, `the build passes:\n${run.output.slice(-2000)}`);
  assert.equal(run.output.includes('[PrerenderRouteConflict]'), false, 'no error');
  assert.deepEqual(conflicts(run.output), CONFLICTS, 'one warning for each conflict, with the path and both routes');
  const built = { '/kontakt/': who(dir, '/kontakt/'), '/zimmer/': who(dir, '/zimmer/'), '/lage/': who(dir, '/lage/') };
  assert.deepEqual(built, { '/kontakt/': 'static', '/zimmer/': 'slug', '/lage/': 'rest' }, 'the higher-priority route wins');
  record('S11.warn', { status: run.status, warnings: conflicts(run.output).length, built });
});

test("S11: a page and a static endpoint that write one file are no conflict for Astro: 'error' does not fail", () => {
  // Astro compares route paths, not output files: `/zimmer` and `/zimmer/index.html` differ, and both write
  // `dist/zimmer/index.html`. So `routes-slug` has an endpoint clause, which fails this endpoint (8).
  const dir = project(
    's11-endpoint',
    {
      'src/pages/index.astro': page('Home', '<p id="who">home</p>'),
      'src/pages/zimmer.astro': page('Zimmer', '<p id="who">page</p>'),
      'src/pages/zimmer/index.html.ts':
        "export const GET = () => new Response('<!doctype html><title>Endpoint</title><p id=\"who\">endpoint</p>');\n",
    },
    "{ onRoutes: (routes, root) => writeFileSync(join(root, 'routes.json'), JSON.stringify(routes.filter((route) => route.origin === 'project').map((route) => [route.pattern, route.type, route.isPrerendered]))) }",
    "import { writeFileSync } from 'node:fs';\nimport { join } from 'node:path';",
  );
  const run = astro(dir);
  assert.equal(run.status, 0, `the build passes:\n${run.output.slice(-2000)}`);
  assert.deepEqual(conflicts(run.output), [], 'Astro names no conflict');
  assert.equal(run.output.match(/\/zimmer\/index\.html/g)?.length, 2, 'the build writes /zimmer/index.html twice');
  const routes = (JSON.parse(read(dir, 'routes.json')) as [string, string, boolean][]).sort();
  assert.deepEqual(
    routes,
    [
      ['/', 'page', true],
      ['/zimmer', 'page', true],
      ['/zimmer/index.html', 'endpoint', true],
    ],
    'astro:routes:resolved lists the endpoint as a prerendered project route of the type endpoint',
  );
  const winner = who(dir, '/zimmer/');
  assert.ok(winner === 'page' || winner === 'endpoint', 'one of the two is in dist');
  record('S11.pageAndEndpointOneFile', { status: run.status, conflicts: 0, winner });
});

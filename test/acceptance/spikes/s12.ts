import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { astro, plain, read, record } from '../harness.ts';
import { project } from './project.ts';

const IMPORTS = "import { readdirSync, writeFileSync } from 'node:fs';\nimport { join } from 'node:path';";

// The stand-in writes what the two hooks see into the case folder, outside dist.
const OPTIONS = `{
  onRoutes: (routes, root) =>
    writeFileSync(join(root, 'routes.json'), JSON.stringify(routes.map((route) => [route.pattern, route.origin]))),
  onDone: ({ dir, assets, root }) =>
    writeFileSync(join(root, 'done.json'), JSON.stringify({ files: readdirSync(dir), assets: assets.size })),
}`;

const WARNING = 'Missing pages directory: src/pages';

interface Measured {
  status: number | null;
  warning: boolean;
  pages: string;
  dist: string[];
  projectRoutes: string[];
  internalRoutes: string[];
}

/** Builds a project with no page. `pages` says what `src/pages` is: nothing, an empty folder, or one `.gitkeep`. */
function zeroPages(name: string, pages: 'none' | 'empty' | 'gitkeep'): Measured {
  const dir = project(name, pages === 'gitkeep' ? { 'src/pages/.gitkeep': '' } : {}, OPTIONS, IMPORTS);
  if (pages === 'empty') mkdirSync(join(dir, 'src/pages'), { recursive: true });
  assert.equal(existsSync(join(dir, 'src/pages')), pages !== 'none');
  const run = astro(dir);
  const output = plain(run.output);
  assert.equal(run.status, 0, `astro build failed with zero pages:\n${output.slice(-3000)}`);
  assert.equal(output.includes('[ERROR]'), false, `the build logs no error:\n${output.slice(-3000)}`);
  // `astro:build:done` runs, with an existing and empty dist folder.
  const done = JSON.parse(read(dir, 'done.json')) as { files: string[]; assets: number };
  assert.deepEqual(done, { files: [], assets: 0 }, 'build:done sees an empty dist and no assets');
  const routes = JSON.parse(read(dir, 'routes.json')) as [string, string][];
  return {
    status: run.status,
    warning: output.includes(WARNING),
    pages: /(\d+) page\(s\) built/.exec(output)?.[1] ?? '',
    dist: existsSync(join(dir, 'dist')) ? readdirSync(join(dir, 'dist')) : ['<no dist>'],
    projectRoutes: routes.filter(([, origin]) => origin === 'project').map(([pattern]) => pattern),
    internalRoutes: routes.filter(([, origin]) => origin !== 'project').map(([pattern]) => pattern),
  };
}

const EXPECTED = { status: 0, pages: '0', dist: [], projectRoutes: [] };

test('S12: a project with no src/pages folder builds, with a warning', () => {
  const { warning, internalRoutes, ...measured } = zeroPages('s12', 'none');
  assert.deepEqual(measured, EXPECTED, 'exit code 0, zero pages, an empty dist folder, no project route');
  assert.equal(warning, true, `Astro warns: ${WARNING}`);
  // Astro's own routes are in `astro:routes:resolved` although no file is built for them: no dist/404.html.
  record('S12.internalRoutes', internalRoutes);
  record('S12.noFolder', 'builds: exit 0, empty dist, one warning text (Missing pages directory)');
});

test('S12: a project with an empty src/pages folder builds, with no warning', () => {
  const { warning, internalRoutes, ...measured } = zeroPages('s12-empty', 'empty');
  assert.deepEqual(measured, EXPECTED, 'exit code 0, zero pages, an empty dist folder, no project route');
  assert.equal(warning, false, 'no warning about the pages folder');
  assert.ok(internalRoutes.length > 0);
  record('S12.emptyFolder', 'builds: exit 0, empty dist, no warning');
});

test('S12: a src/pages folder that holds only .gitkeep builds zero pages', () => {
  const { warning, internalRoutes, ...measured } = zeroPages('s12-gitkeep', 'gitkeep');
  assert.deepEqual(measured, EXPECTED, 'exit code 0, zero pages, an empty dist folder, no project route');
  assert.equal(warning, false, 'no warning about the pages folder');
  assert.ok(internalRoutes.length > 0);
  record('S12.gitkeep', 'builds: exit 0, empty dist, no warning, no route for .gitkeep');
});

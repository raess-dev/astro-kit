/**
 * The files that `init` writes pass the kit's own Biome preset (`config/biome.json`, 12.2), as a site's `check` runs
 * it (`biome ci --error-on-warnings`). The repository's `biome.json` has overrides of its own, so the kit's
 * `npm run check` proves nothing about a client project: this test runs the shipped preset on what init writes.
 * The Biome binary runs as a child process, as in `wrangler-format.test.ts`.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { type Io, main } from '../../src/cli.ts';
import { inTempAsync } from './fixtures.ts';

const PRESET = readFileSync(fileURLToPath(new URL('../../config/biome.json', import.meta.url)), 'utf8');
const BIOME_BIN = join(createRequire(import.meta.url).resolve('@biomejs/biome/package.json'), '..', 'bin/biome');

/** The files that Biome checks in a site: CSS, JSON and the scripts. `biome.json` itself becomes the preset. */
const CHECKED = /\.(css|json|ts|mjs)$/;

/**
 * The two style skeletons of 12.2 hold an empty layer block, which `noEmptyBlock` of the preset refuses. The owner
 * decision to write `@layer tokens;` and `@layer elements;` instead conflicts with `css-layer-file` (each project
 * CSS file is exactly one `@layer <its layer> { … }` block), so it waits for the owner. Until then, these are the
 * only findings of the preset on the files of init.
 */
const KNOWN = [
  'src/styles/elements.css lint/suspicious/noEmptyBlock',
  'src/styles/tokens.css lint/suspicious/noEmptyBlock',
];

test('every CSS, JSON and script file that init writes passes the shipped Biome preset, but the two skeletons', async () => {
  await inTempAsync({}, async (root) => {
    const io: Io = { out: () => undefined, err: () => undefined, env: {} };
    const argv = [
      'init',
      '--site',
      'https://example.ch',
      '--locales',
      'de,fr',
      '--owner',
      '@o',
      '--features',
      'forms,islands,scripts',
    ];
    assert.equal(await main(argv, root, io), 0);
    // The preset as the root config, as the shim that extends it makes it in a project.
    writeFileSync(
      join(root, 'biome.json'),
      JSON.stringify({ ...(JSON.parse(PRESET) as object), $schema: undefined, root: true }),
    );
    const files = readdirSync(root, { recursive: true, encoding: 'utf8' })
      .map((path) => path.split('\\').join('/'))
      .filter((path) => CHECKED.test(path) && path !== 'biome.json')
      .sort();
    assert.equal(files.length >= 14, true, files.join(' '));
    const result = spawnSync(process.execPath, [BIOME_BIN, 'ci', '--colors=off', '--error-on-warnings', ...files], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, NO_COLOR: '1' },
    });
    const output = `${result.stdout}${result.stderr}`;
    // Each diagnostic starts with `<file>:<line>:<column> <category>`; a format problem is `<file> format`.
    const found = [...output.matchAll(/^(\S+?)(?::\d+:\d+)? (format|[a-z]+\/\S+)/gm)]
      .map((match) => `${match[1]} ${match[2]}`)
      .sort();
    assert.deepEqual(found, KNOWN, output);
    // Biome read every file: none was skipped by the preset's includes.
    assert.match(output, new RegExp(`Checked ${files.length} files`), output);
  });
});

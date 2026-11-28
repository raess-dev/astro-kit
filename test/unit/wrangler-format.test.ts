/**
 * The rendering of `wrangler.jsonc` (10.4) is in the format that Biome gives it under the kit preset (12.2), so
 * `biome ci` in `check` passes the protected file unchanged, and the preset needs no override for it. Each case
 * formats the rendering with the Biome of the kit, in a temp folder whose `biome.json` is the kit preset, and asserts
 * no change. The Biome binary runs as a child process: Biome has no API in Node that formats with a config file.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { renderWrangler } from '../../src/hosts/cloudflare.ts';
import type { Options } from '../../src/options.ts';
import { inTemp, optionsOf, SMALLEST } from './fixtures.ts';
import { HOST, SETTINGS, SITE_FORMS, WITH_PROBE } from './forms-fixtures.ts';
import { SPEC } from './spec.ts';

const PRESET_FILE = fileURLToPath(new URL('../../config/biome.json', import.meta.url));
const PRESET = readFileSync(PRESET_FILE, 'utf8');

/** The bin script of the Biome of the kit, which runs the binary of the platform. */
const BIOME_BIN = join(createRequire(import.meta.url).resolve('@biomejs/biome/package.json'), '..', 'bin/biome');

/**
 * The text of `wrangler.jsonc` after `biome format` with the kit preset: a temp root with the preset as its
 * `biome.json` (a root config, as the shim that extends the preset makes it in a project).
 */
function formatted(text: string): string {
  const root = JSON.stringify({ ...(JSON.parse(PRESET) as object), $schema: undefined, root: true });
  return inTemp({ 'biome.json': root, 'wrangler.jsonc': text }, (dir) => {
    const result = spawnSync(process.execPath, [BIOME_BIN, 'format', '--write', 'wrangler.jsonc'], {
      cwd: dir,
      encoding: 'utf8',
      env: { ...process.env, NO_COLOR: '1' },
    });
    if (result.status !== 0) throw new Error(`biome format failed: ${result.stdout}${result.stderr}`);
    return readFileSync(join(dir, 'wrangler.jsonc'), 'utf8');
  });
}

/** Every combination of settings that the tests of the rendering use, and longer names and addresses. */
const CASES: readonly (readonly [string, Options])[] = [
  ['the smallest static site', optionsOf(SMALLEST)],
  ['a static site with www', optionsOf({ ...SMALLEST, site: 'https://www.hotel-laerchenwald.example.com' })],
  [
    'a static site with a worker name of 42 characters and a long host',
    optionsOf({ ...SMALLEST, site: `https://www.${'hotel-laerchenwald-sils-im-engadin-'.repeat(3)}example.com` }),
  ],
  ['the forms site with one destination', SETTINGS],
  ['the forms site with the probe', WITH_PROBE],
  [
    'the forms site with its own recipient for a form',
    optionsOf({
      ...SITE_FORMS,
      contact: { ...SITE_FORMS.contact, probe: `probe@${HOST}` },
      forms: { ...SITE_FORMS.forms, booking: { ...SITE_FORMS.forms.booking, to: `booking@${HOST}` } },
    }),
  ],
  ['a forms site with www', optionsOf({ ...SITE_FORMS, site: `https://www.${HOST}` })],
  [
    'an address with a quote and a backslash',
    optionsOf({ ...SITE_FORMS, contact: { ...SITE_FORMS.contact, probe: 'a"],"x":["b\\c@example.ch' } }),
  ],
  [
    'long addresses that would not fit on one line',
    optionsOf({
      ...SITE_FORMS,
      contact: {
        ...SITE_FORMS.contact,
        to: `reservations-and-requests-of-the-hotel@${HOST}`,
        probe: `the-probe-inbox-of-the-form-endpoint@${HOST}`,
      },
    }),
  ],
];

for (const [name, options] of CASES) {
  test(`biome format with the kit preset leaves the rendering of wrangler.jsonc unchanged: ${name}`, () => {
    const text = renderWrangler(options);
    assert.equal(formatted(text), text);
  });
}

test('the control: biome format changes a rendering that is not in its format', () => {
  const text = renderWrangler(SETTINGS).replace(
    '  "assets": {\n    "directory": "./dist/client",\n    "not_found_handling": "404-page",\n    "html_handling": "auto-trailing-slash",\n    "run_worker_first": ["/api/forms/*"]\n  },',
    '  "assets": { "directory": "./dist/client", "not_found_handling": "404-page", "html_handling": "auto-trailing-slash", "run_worker_first": ["/api/forms/*"] },',
  );
  assert.notEqual(text, renderWrangler(SETTINGS));
  assert.notEqual(formatted(text), text);
});

test('the formatter of the preset skips exactly the files that 12.2 names: src/styles/tokens.css', () => {
  const preset = JSON.parse(PRESET) as {
    overrides: { includes: string[]; formatter?: { enabled?: boolean } }[];
  };
  const off = preset.overrides.filter((override) => override.formatter?.enabled === false);
  assert.deepEqual(
    off.flatMap((override) => override.includes),
    ['**/src/styles/tokens.css'],
  );
  assert.ok(
    SPEC.includes(
      '  - `src/styles/tokens.css` is excluded from the formatter, because the kit renders it (7.7). This is the only file that the formatter skips:',
    ),
  );
});

test('the TS preset names solid-js as the JSX source, as 12.2 says, so an island needs no pragma', () => {
  const preset = JSON.parse(readFileSync(new URL('../../config/tsconfig.json', import.meta.url), 'utf8')) as {
    compilerOptions: Record<string, unknown>;
  };
  assert.equal(preset.compilerOptions.jsx, 'preserve');
  assert.equal(preset.compilerOptions.jsxImportSource, 'solid-js');
  assert.ok(SPEC.includes('and `"jsx": "preserve"` with `"jsxImportSource": "solid-js"`'));
  assert.ok(!SPEC.includes('Its file starts with the pragma `@jsxImportSource solid-js`'));
});

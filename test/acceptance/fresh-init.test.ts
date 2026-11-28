/**
 * The fresh init of 14.2 (part 9c of M9): `init` in an empty folder, then the kit's own commands on what it wrote.
 *
 * 1. `init --site https://example.ch --locales de,fr --owner @example-owner` writes the templates and prints no passed
 *    line. It writes `.github/kit-identity.sh`, `.npmrc` and `.claude/settings.json` (part 9d of M9). Until the kit
 *    renders all seven protected files (part 9e of M9), the case writes `wrangler.jsonc` with `renderWrangler` of the
 *    packed kit, as `init --protected` will. Then `check` fails with exactly `design-format`: the skeleton of
 *    `docs/design.md` has empty tables.
 * 2. With the smallest valid `docs/design.md` and `elements.css` of `fresh-init.ts`, `tokens` writes `tokens.css`, and
 *    `check` passes: Biome and `astro check` accept every file that init wrote. Then `build` fails with exactly
 *    `legal-pages` and `routes-404`, because the site has no page yet.
 * The folder walks up to the packages of the base copy. Run: node --test test/acceptance/fresh-init.test.ts
 */
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import type * as Cloudflare from '../../src/hosts/cloudflare.ts';
import type * as OptionsModule from '../../src/options.ts';
import type * as RegistryModule from '../../src/registry.ts';
import { DESIGN_MD, ELEMENTS_CSS } from './fresh-init.ts';
import { base, type KitRun, kitModule, passedLine, read, run, write } from './harness.ts';

/** The last part of a command's output, for the message of a failed assertion. */
const tail = (result: KitRun): string => result.output.slice(-4000);

const PASSED = { last: true, count: 1 } as const;
const NOT_PASSED = { last: false, count: 0 } as const;

test('M9 fresh init: init writes the templates; check gives design-format, and with a design the build gives legal-pages and routes-404', async () => {
  // The fresh init starts from an empty folder (14.2, Case copies): no package.json, no kit/.
  const dir = join(base(), 'cases', 'fresh-init');
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });

  const init = run(dir, ['init', '--site', 'https://example.ch', '--locales', 'de,fr', '--owner', '@example-owner']);
  assert.equal(init.status, 0, tail(init));
  assert.deepEqual(passedLine(init), NOT_PASSED, tail(init));
  for (const file of ['astro-kit.json', 'package.json', 'AGENTS.md', 'CLAUDE.md', 'docs/design.md', 'site.json']) {
    assert.ok(init.stdout.includes(`wrote ${file}\n`), `init wrote ${file}`);
  }
  assert.ok(init.stdout.includes('\nNext:\n'), tail(init));
  assert.equal(read(dir, 'CLAUDE.md'), '@AGENTS.md\n');
  // Part 9d of M9: the two protected files that depend on no setting, and the SessionStart hook (12.3), as the
  // packed kit holds them. The other protected files come with part 9e (10.6).
  const templates = join(base(), 'node_modules/@raess/astro-kit/templates/site');
  for (const [file, template] of [
    ['.github/kit-identity.sh', '_github/kit-identity.sh'],
    ['.npmrc', '_npmrc'],
    ['.claude/settings.json', '_claude/settings.json'],
  ] as const) {
    assert.ok(init.stdout.includes(`wrote ${file}\n`), `init wrote ${file}`);
    assert.equal(read(dir, file), read(templates, template), file);
  }
  for (const file of ['.github/workflows', '.github/dependabot.yml', '.github/CODEOWNERS', 'wrangler.jsonc'])
    assert.equal(existsSync(join(dir, file)), false, file);

  // The stand-in for `init --protected`: the static `wrangler.jsonc` of 10.4 for the written settings.
  const { loadOptions } = await kitModule<typeof OptionsModule>('options');
  const { Report } = await kitModule<typeof RegistryModule>('registry');
  const { renderWrangler } = await kitModule<typeof Cloudflare>('hosts/cloudflare');
  const report = new Report();
  const options = loadOptions(dir, report);
  assert.deepEqual(report.findings, []);
  assert.ok(options);
  writeFileSync(join(dir, 'wrangler.jsonc'), renderWrangler(options));

  const skeleton = run(dir, 'check');
  assert.equal(skeleton.status, 1, tail(skeleton));
  assert.deepEqual(skeleton.ids, ['design-format'], tail(skeleton));
  assert.deepEqual(passedLine(skeleton), NOT_PASSED, tail(skeleton));

  // The shipped elements.css stays a skeleton: with a design, `design-pairs` needs the body, link and focus rules.
  write(dir, { 'docs/design.md': DESIGN_MD, 'src/styles/elements.css': ELEMENTS_CSS });
  const tokens = run(dir, 'tokens');
  assert.equal(tokens.status, 0, tail(tokens));
  assert.ok(tokens.stdout.includes('astro-kit tokens: wrote src/styles/tokens.css\n'), tail(tokens));
  assert.ok(read(dir, 'src/styles/tokens.css').includes('--color-text: #222222;'), 'tokens.css holds the tokens');

  const checked = run(dir, 'check');
  assert.equal(checked.status, 0, tail(checked));
  assert.deepEqual(checked.ids, []);
  assert.deepEqual(passedLine(checked), PASSED, tail(checked));

  const built = run(dir, 'build');
  assert.equal(built.status, 1, tail(built));
  assert.deepEqual(built.ids, ['legal-pages', 'routes-404'], tail(built));
  assert.deepEqual(passedLine(built), NOT_PASSED, tail(built));
});

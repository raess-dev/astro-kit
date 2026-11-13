import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { LIMITS, type Options } from '../../src/options.ts';
import { preflight } from '../../src/preflight.ts';
import { Report, RULE_BY_ID } from '../../src/registry.ts';
import { SHIMS } from '../../src/shims.ts';

// The project of a case

/** The files of a project: a path from the root, and the text or the bytes of the file. */
type Files = Readonly<Record<string, string | Uint8Array>>;

const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

/** The smallest settings: one locale and no feature. Every other field has a default. */
const SETTINGS = {
  site: 'https://example.ch',
  codeOwner: '@example-owner',
  locales: [{ code: 'de', tag: 'de-CH', name: 'Deutsch' }],
  defaultLocale: 'de',
  legal: { legalNote: { de: '/impressum/' }, privacy: { de: '/datenschutz/' } },
  securityContact: 'mailto:security@example.ch',
};

/** The smallest facts. */
const SITE = { name: 'Example', legalName: 'Example AG', email: 'info@example.ch' };

const SCHEDULE = { openingHours: [], closures: [] };

/**
 * The smallest project that passes preflight with no finding: the settings, the two facts files that must exist,
 * and the three source shims. A later milestone adds the files that its rules need.
 */
const SMALLEST: Files = {
  'astro-kit.json': json(SETTINGS),
  'site.json': json(SITE),
  'schedule.json': json(SCHEDULE),
  ...SHIMS,
};

/** The smallest project with some files added or replaced. */
const withFiles = (files: Files): Files => ({ ...SMALLEST, ...files });

/** The smallest project without one file. */
const withoutFile = (file: string): Files =>
  Object.fromEntries(Object.entries(SMALLEST).filter(([name]) => name !== file));

/** The smallest project with some settings added or replaced. */
const withSettings = (settings: Readonly<Record<string, unknown>>): Files =>
  withFiles({ 'astro-kit.json': json({ ...SETTINGS, ...settings }) });

/** The first 24 bytes of a PNG file: the signature, and the start of the IHDR chunk with the width and the height. */
function png(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

/** Writes the files into a new temp folder, runs `use` on the root, and removes the folder. */
function inProject<Result>(files: Files, use: (root: string) => Result): Result {
  const root = mkdtempSync(join(tmpdir(), 'astro-kit-'));
  try {
    for (const [path, content] of Object.entries(files)) {
      const file = join(root, path);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, content);
    }
    return use(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/** What one run of preflight gave. */
interface Run {
  /** The settings that preflight returned. */
  options: Options | undefined;
  /** The sorted rule ids of the findings that fail. */
  ids: string[];
  /** The rule id of every finding, in the order of the report. */
  rules: string[];
  /** The `where` of every finding, in the order of the report. */
  places: string[];
}

function run(files: Files): Run {
  return inProject(files, (root) => {
    const report = new Report();
    const options = preflight(root, report);
    return {
      options,
      ids: [...report.ids()].sort(),
      rules: report.findings.map((finding) => finding.rule),
      places: report.findings.map((finding) => finding.where),
    };
  });
}

/** A list without the entries that repeat the entry before them. */
const runsOf = (values: readonly string[]): string[] => values.filter((value, index) => value !== values[index - 1]);

/** The file of a place: `site.json: email` and `biome.json:1` give the file name. */
const fileOf = (place: string): string => place.split(':')[0] ?? place;

// The order of the specification

/** The rules that preflight runs at milestone M2, in the order of 6.1, step 2. */
const ORDER: readonly string[] = [
  // 1. options and facts
  'config-options',
  'config-waiver',
  'legal-processing',
  'facts-schedule',
  // 2. shims
  'config-shim',
  // 3. package
  'config-overrides',
  'config-dep-spec',
  'config-dep-allowlist',
  // 4. sources
  'config-suppression',
  'config-imports',
  'config-server',
  // 5. public/
  'config-public-shadow',
  'images-public',
  // 6.
  'images-original',
  // 8.
  'routes-redirects',
];

/** The rule ids that the sub-steps of 6.1, step 2 name, in the order of the document. */
function specOrder(): string[] {
  const spec = readFileSync(fileURLToPath(new URL('../../docs/spec.md', import.meta.url)), 'utf8');
  const passage = spec.slice(spec.indexOf('2. **Preflight.**'), spec.indexOf('3. **Config shape.**'));
  const steps = passage.split('\n').filter((line) => /^ {3}\d+\. /.test(line));
  return steps.flatMap((line) => [...line.matchAll(/`([a-z0-9]+(?:-[a-z0-9]+)+)`/g)].map((match) => match[1] ?? ''));
}

// Cases

const PAGE = 'src/pages/index.astro';

/** A waiver that names a waivable rule and ended long ago. */
const OLD_WAIVER = {
  rule: 'head-title',
  where: '/jobs/',
  reason: 'The client sends the title later.',
  until: '2000-01-01',
};

/** One case: a name, the files of the project, and the exact sorted ids. */
type Case = readonly [name: string, files: Files, ids: readonly string[]];

/** Projects that pass. Each one holds the smallest input that meets the rules which read its files. */
const PASSING: readonly Case[] = [
  ['the smallest project', SMALLEST, []],
  [
    'the smallest project with each optional file that a rule of M2 reads',
    withFiles({
      'glossary.json': json({ de: { banned: { Velo: 'Fahrrad' } } }),
      'redirects.json': json([
        { from: '/alt/', to: '/neu/' },
        { from: '/weg/', gone: true },
      ]),
      'package.json': json({ dependencies: { '@raess/astro-kit': '0.1.0', astro: '7.4.11' } }),
      [PAGE]: '---\nconst title = "Example";\n---\n<h1>{title}</h1>\n',
      'src/assets/photo.png': png(LIMITS.imageMaxPx, 1),
      'public/favicon.ico': 'icon',
      'public/og.png': 'image',
    }),
    [],
  ],
];

/** Projects that fail one rule. Each one changes one thing in the smallest project. */
const FAILING: readonly Case[] = [
  // 1. options and facts
  ['config-options: `site` is not https', withSettings({ site: 'http://example.ch' }), ['config-options']],
  ['config-options: a looser limit', withSettings({ limits: { headBytes: LIMITS.headBytes + 1 } }), ['config-options']],
  [
    'config-options: `site.json` has no `email`',
    withFiles({ 'site.json': json({ name: SITE.name, legalName: SITE.legalName }) }),
    ['config-options'],
  ],
  ['config-options: no `site.json`', withoutFile('site.json'), ['config-options']],
  [
    'config-options: `glossary.json` has a locale without `banned`',
    withFiles({ 'glossary.json': json({ de: {} }) }),
    ['config-options'],
  ],
  ['config-waiver: an old waiver', withSettings({ waivers: [OLD_WAIVER] }), ['config-waiver']],
  ['legal-processing: `previews` is not declared', withSettings({ processing: ['cdn'] }), ['legal-processing']],
  ['facts-schedule: no `schedule.json`', withoutFile('schedule.json'), ['facts-schedule']],
  // 2. shims
  ['config-shim: `biome.json` has another text', withFiles({ 'biome.json': '{}\n' }), ['config-shim']],
  ['config-shim: a second Astro config', withFiles({ 'astro.config.ts': 'export default {};\n' }), ['config-shim']],
  [
    'config-shim: a nested Biome config',
    withFiles({ 'src/biome.json': '{ "root": false, "linter": { "enabled": false } }\n' }),
    ['config-shim'],
  ],
  // 3. package
  ['config-overrides: `overrides`', withFiles({ 'package.json': json({ overrides: {} }) }), ['config-overrides']],
  [
    'config-dep-spec: an allowed package from GitHub',
    withFiles({ 'package.json': json({ dependencies: { astro: 'github:withastro/astro' } }) }),
    ['config-dep-spec'],
  ],
  [
    'config-dep-allowlist: a package that the settings do not allow',
    withFiles({ 'package.json': json({ dependencies: { 'left-pad': '1.3.0' } }) }),
    ['config-dep-allowlist'],
  ],
  // 4. sources
  ['config-suppression: `@ts-ignore`', withFiles({ [PAGE]: '---\n// @ts-ignore\n---\n' }), ['config-suppression']],
  ['config-suppression: `@TS-NOCHECK`', withFiles({ 'src/a.ts': '// @TS-NOCHECK\n' }), ['config-suppression']],
  [
    'config-suppression: a folder that Biome skips',
    withFiles({ 'src/pages/dist/index.astro': '<h1>Example</h1>\n' }),
    ['config-suppression'],
  ],
  [
    'config-imports: `astro:transitions`',
    withFiles({ [PAGE]: "---\nimport { ClientRouter } from 'astro:transitions';\n---\n" }),
    ['config-imports'],
  ],
  ['config-server: a middleware file', withFiles({ 'src/middleware.ts': 'export {};\n' }), ['config-server']],
  // 5. public/
  [
    'config-public-shadow: `public/robots.txt`',
    withFiles({ 'public/robots.txt': 'User-agent: *\n' }),
    ['config-public-shadow'],
  ],
  ['images-public: `public/photo.png`', withFiles({ 'public/photo.png': png(1, 1) }), ['images-public']],
  // 6.
  [
    'images-original: one pixel too wide',
    withFiles({ 'src/assets/photo.png': png(LIMITS.imageMaxPx + 1, 1) }),
    ['images-original'],
  ],
  // 8.
  [
    'images-original: in a folder that Biome skips, with config-suppression for the folder',
    withFiles({ 'src/assets/dist/photo.png': png(LIMITS.imageMaxPx + 1, 1) }),
    ['config-suppression', 'images-original'],
  ],
  [
    'routes-redirects: a `to` that leaves the site',
    withFiles({ 'redirects.json': json([{ from: '/alt/', to: '//example.org/' }]) }),
    ['routes-redirects'],
  ],
  [
    'routes-redirects: `from` without `/`',
    withFiles({ 'redirects.json': json([{ from: 'alt/', to: '/neu/' }]) }),
    ['routes-redirects'],
  ],
];

/** A project that fails every rule of `ORDER` and still has valid settings. */
const EVERY_RULE: Files = {
  ...withSettings({ waivers: [OLD_WAIVER], processing: ['cdn'] }),
  'site.json': json({}),
  'glossary.json': json({ de: {} }),
  'schedule.json': json({}),
  'biome.json': '{}\n',
  'package.json': json({ overrides: {}, dependencies: { astro: 'github:withastro/astro', 'left-pad': '1.3.0' } }),
  [PAGE]: "---\n// @ts-ignore\nimport { ClientRouter } from 'astro:transitions';\n---\n<div server:defer></div>\n",
  'public/robots.txt': 'User-agent: *\n',
  'public/photo.png': png(1, 1),
  'src/assets/photo.png': png(LIMITS.imageMaxPx + 1, 1),
  'redirects.json': json([{ from: 'alt/', to: '/neu/' }]),
};

/** The same project with settings that are not valid. */
const EVERY_RULE_NO_SETTINGS: Files = {
  ...EVERY_RULE,
  'astro-kit.json': json({ ...SETTINGS, site: 'http://example.ch' }),
};

const idsOf = (cases: readonly Case[]): { name: string; ids: readonly string[] }[] =>
  cases.map(([name, files]) => ({ name, ids: run(files).ids }));

const expected = (cases: readonly Case[]): { name: string; ids: readonly string[] }[] =>
  cases.map(([name, , ids]) => ({ name, ids }));

// Tests

test('the smallest project passes preflight, and preflight returns its settings', () => {
  const seen = run(SMALLEST);
  assert.deepEqual(seen.rules, []);
  assert.deepEqual(seen.places, []);
  assert.equal(seen.options?.site, SETTINGS.site);
  assert.equal(seen.options?.defaultLocale, 'de');
  assert.deepEqual(seen.options?.processing, ['cdn', 'previews'], 'the defaults are filled in');
  assert.deepEqual(Object.keys(SMALLEST).sort(), [
    'astro-kit.json',
    'astro.config.mjs',
    'biome.json',
    'schedule.json',
    'site.json',
    'tsconfig.json',
  ]);
});

test('each file of the smallest project is needed: without it, preflight has a finding', () => {
  const seen = Object.keys(SMALLEST).map((file) => ({ file, ids: run(withoutFile(file)).ids }));
  assert.deepEqual(seen, [
    { file: 'astro-kit.json', ids: ['config-options'] },
    { file: 'site.json', ids: ['config-options'] },
    { file: 'schedule.json', ids: ['facts-schedule'] },
    { file: 'astro.config.mjs', ids: ['config-shim'] },
    { file: 'biome.json', ids: ['config-shim'] },
    { file: 'tsconfig.json', ids: ['config-shim'] },
  ]);
});

test('a project that meets every rule gives no id', () => {
  assert.deepEqual(idsOf(PASSING), expected(PASSING));
});

test('one change in the smallest project gives exactly the id of its rule', () => {
  assert.deepEqual(idsOf(FAILING), expected(FAILING));
});

test('every rule of preflight has a failing case, and every one is in the registry', () => {
  const covered = new Set(FAILING.flatMap(([, , ids]) => ids));
  assert.deepEqual([...covered].sort(), [...ORDER].sort());
  assert.deepEqual(
    ORDER.filter((id) => !RULE_BY_ID.has(id)),
    [],
  );
});

test('the order of the rules is that of 6.1, step 2', () => {
  const inSpec = specOrder();
  assert.ok(inSpec.includes('css-sources'), 'the test finds the sub-steps in docs/spec.md');
  assert.deepEqual(
    inSpec.filter((id) => RULE_BY_ID.has(id)),
    ORDER,
  );
});

test('the findings come in the order of 6.1, step 2, each rule in one run', () => {
  const seen = run(EVERY_RULE);
  assert.deepEqual(runsOf(seen.rules), ORDER);
  assert.deepEqual(seen.ids, [...ORDER].sort());
  assert.equal(seen.options?.site, SETTINGS.site, 'the settings are valid, so preflight returns them');
  assert.deepEqual(runsOf(seen.places.filter((_, index) => seen.rules[index] === 'config-options').map(fileOf)), [
    'site.json',
    'glossary.json',
  ]);
});

/** The rules whose checks read the settings (6.1, the settings rule). */
const NEEDS_SETTINGS: readonly string[] = ['config-waiver', 'legal-processing', 'config-dep-allowlist'];

test('without valid settings, every check that reads no setting still runs', () => {
  const seen = run(EVERY_RULE_NO_SETTINGS);
  const others = ORDER.filter((id) => !NEEDS_SETTINGS.includes(id));
  assert.equal(seen.options, undefined);
  assert.deepEqual(runsOf(seen.rules), others);
  assert.deepEqual(seen.ids, [...others].sort());
  assert.deepEqual(runsOf(seen.places.map(fileOf)).slice(0, 5), [
    'astro-kit.json',
    'site.json',
    'glossary.json',
    'schedule.json',
    'biome.json',
  ]);

  // Apart from the finding on the settings, the run gives what the run with valid settings gives.
  const valid = run(EVERY_RULE);
  const rest = (from: Run): string[] =>
    from.rules.map((rule, index) => `${rule} ${from.places[index]}`).filter((line) => !line.includes('astro-kit.json'));
  assert.deepEqual(
    rest(seen),
    rest(valid).filter((line) => !NEEDS_SETTINGS.some((id) => line.startsWith(`${id} `))),
  );
});

test('an empty folder gives the findings of the files that must exist, and no error', () => {
  const seen = run({});
  assert.equal(seen.options, undefined);
  assert.deepEqual(seen.places, [
    'astro-kit.json',
    'site.json',
    'schedule.json',
    'astro.config.mjs',
    'biome.json',
    'tsconfig.json',
  ]);
  assert.deepEqual(seen.ids, ['config-options', 'config-shim', 'facts-schedule']);
});

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { LIMITS, type Options } from '../../src/options.ts';
import {
  allowedDependencies,
  BASE_DEPENDENCIES,
  checkDepAllowlist,
  checkDepSpecs,
  checkImageOriginals,
  checkImports,
  checkOverrides,
  checkPublicImages,
  checkPublicShadow,
  checkServer,
  checkSuppression,
  DEP_ALLOWLIST_SECTIONS,
  DEP_SPEC_SECTIONS,
  FORMS_DEPENDENCIES,
  HEADER_EXTENSIONS,
  IMPORT_EXTENSIONS,
  ISLANDS_DEPENDENCIES,
  imageFileSize,
  imageSize,
  isRaster,
  JPEG_MAX_STEPS,
  KIT_PACKAGE,
  listFiles,
  PACKAGE_FILE,
  PUBLIC_RASTER_ALLOWED,
  PUBLIC_SHADOWS,
  PUBLIC_SITEMAP,
  RASTER_EXTENSIONS,
  REGISTRY_SPEC,
  SOURCE_MAX_BYTES,
  SUPPRESSION_EXTENSIONS,
  UNCHECKED_FOLDERS,
  WALKED_FOLDERS,
  walk,
} from '../../src/project.ts';
import { getRule, Report } from '../../src/registry.ts';

// The temp folder of a case

/** A symbolic link. The target is a path from the root of the case. */
interface Link {
  link: string;
}

/** A file of `size` bytes that starts with `head`. The rest is zero bytes, which take no room on disk. */
interface Padded {
  head: Uint8Array;
  size: number;
}

/** An empty folder. */
interface EmptyFolder {
  folder: true;
}

/** One entry of a case: the text or the bytes of a file, an empty folder, a link, or a padded file. */
type Entry = string | Uint8Array | EmptyFolder | Link | Padded;

/** The files of a case. A key is a path from the root; a key that starts with `../` lies outside the root. */
type Tree = Readonly<Record<string, Entry>>;

const FOLDER: EmptyFolder = { folder: true };
const link = (target: string): Link => ({ link: target });
const padded = (head: Uint8Array, size: number): Padded => ({ head, size });

function writeEntry(root: string, path: string, entry: Entry): void {
  const file = join(root, path);
  mkdirSync(dirname(file), { recursive: true });
  if (typeof entry === 'string' || entry instanceof Uint8Array) writeFileSync(file, entry);
  else if ('folder' in entry) mkdirSync(file, { recursive: true });
  else if ('link' in entry) symlinkSync(join(root, entry.link), file);
  else {
    writeFileSync(file, entry.head);
    truncateSync(file, entry.size);
  }
}

/** Writes the tree into a new temp folder, runs `use` on the root, and removes the folder. */
function inProject<Result>(tree: Tree, use: (root: string) => Result): Result {
  const base = mkdtempSync(join(tmpdir(), 'astro-kit-'));
  try {
    const root = join(base, 'site');
    mkdirSync(root);
    // Links come last, so that each target exists.
    const entries = Object.entries(tree);
    const isLink = (entry: Entry): boolean => typeof entry === 'object' && 'link' in entry;
    for (const [path, entry] of entries) if (!isLink(entry)) writeEntry(root, path, entry);
    for (const [path, entry] of entries) if (isLink(entry)) writeEntry(root, path, entry);
    return use(root);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
}

// Cases

type Check = (root: string, report: Report) => void;

/** One case: a name, the files, and the place of every finding, in the order of the report. */
type Case = readonly [name: string, files: Tree, places: readonly string[]];

interface Seen {
  name: string;
  /** The sorted rule ids of the findings that fail. */
  ids: string[];
  /** The `where` of every finding, in the order of the report. */
  places: readonly string[];
}

/** Runs the check on each case. The test compares `actual` with `expected`. */
function run(rule: string, check: Check, cases: readonly Case[]): { actual: Seen[]; expected: Seen[] } {
  const actual = cases.map(([name, files]) =>
    inProject(files, (root) => {
      const report = new Report();
      check(root, report);
      return { name, ids: [...report.ids()].sort(), places: report.findings.map((finding) => finding.where) };
    }),
  );
  const expected = cases.map(([name, , places]) => ({ name, ids: places.length === 0 ? [] : [rule], places }));
  return { actual, expected };
}

/** The findings of one check on one tree, as `[rule, where, detail]`. */
function findingsOf(check: Check, files: Tree): (string | undefined)[][] {
  return inProject(files, (root) => {
    const report = new Report();
    check(root, report);
    return report.findings.map((finding) => [finding.rule, finding.where, finding.detail]);
  });
}

// The specification

const SPEC = readFileSync(fileURLToPath(new URL('../../docs/spec.md', import.meta.url)), 'utf8');

/** The row of a rule in the tables of section 8. */
const specRow = (rule: string): string => SPEC.split('\n').find((line) => line.startsWith(`| \`${rule}\` |`)) ?? '';

const code = (text: string): string => `\`${text}\``;

test('the fixed values are those of the rule tables of section 8', () => {
  // The table escapes each `|` of the pattern, because `|` ends a table cell.
  assert.ok(specRow('config-dep-spec').includes(code(REGISTRY_SPEC.source.replaceAll('|', '\\|'))));
  assert.ok(specRow('config-dep-spec').includes('in any letter case'));
  assert.equal(REGISTRY_SPEC.flags, 'i');
  assert.ok(specRow('config-dep-spec').includes('in dependencies, devDependencies or optionalDependencies'));
  assert.deepEqual(DEP_SPEC_SECTIONS, ['dependencies', 'devDependencies', 'optionalDependencies']);
  assert.deepEqual(DEP_ALLOWLIST_SECTIONS, [...DEP_SPEC_SECTIONS, 'peerDependencies']);
  assert.equal(PACKAGE_FILE, 'package.json');
  assert.equal(KIT_PACKAGE, '@raess/astro-kit');

  const list = (names: readonly string[]): string => names.map(code).join(', ');
  const allowlist = `Dependencies are only: ${list(BASE_DEPENDENCIES)}; with forms ${list(FORMS_DEPENDENCIES)}; with islands ${list(ISLANDS_DEPENDENCIES)}; plus \`dependencies\`.`;
  assert.ok(specRow('config-dep-allowlist').includes(allowlist));

  const glob = `src/**/*.{${IMPORT_EXTENSIONS.map((extension) => extension.slice(1)).join(',')}}`;
  assert.ok(specRow('config-imports').includes(code(glob)));
  assert.ok(specRow('config-suppression').includes(`(${code(SUPPRESSION_EXTENSIONS.join(' '))})`));
  assert.ok(specRow('images-public').includes(`(${code(RASTER_EXTENSIONS.join(' '))})`));
  assert.ok(specRow('images-public').includes(`except ${list(PUBLIC_RASTER_ALLOWED)}.`));
  assert.ok(specRow('config-public-shadow').includes(`none of ${list([...PUBLIC_SHADOWS, 'sitemap*.xml'])}.`));
  assert.equal(PUBLIC_SITEMAP.source, '^sitemap.*\\.xml$');

  const number = (value: number): string => value.toLocaleString('en-US');
  const limits = `≤ ${number(LIMITS.imageMaxPx)} px on its long edge and ≤ ${number(LIMITS.imageMaxBytes)} B`;
  assert.ok(specRow('images-original').includes(limits));
  assert.ok(specRow('images-original').includes('read from the PNG, GIF, WebP or JPEG header'));
  assert.deepEqual(HEADER_EXTENSIONS, ['.png', '.gif', '.webp', '.jpg', '.jpeg']);
  assert.ok(specRow('images-original').includes(`more than ${number(JPEG_MAX_STEPS)} markers and fill bytes`));

  const suppression = specRow('config-suppression');
  assert.ok(suppression.includes('in any letter case'));
  assert.ok(suppression.includes(`at most ${number(SOURCE_MAX_BYTES)} B`));
  assert.ok(
    suppression.includes(
      `under \`src/\` or \`public/\` is named ${list(UNCHECKED_FOLDERS).replace(/, (?=[^,]*$)/, ' or ')}`,
    ),
  );
  assert.deepEqual(UNCHECKED_FOLDERS, ['node_modules', 'dist', '.astro', '.wrangler']);
  assert.deepEqual(WALKED_FOLDERS, ['src', 'public']);
  assert.equal(SOURCE_MAX_BYTES, 1_048_576);
});

test('each rule of this module is a config rule that no waiver switches off', () => {
  const rules = [
    'config-overrides',
    'config-dep-spec',
    'config-dep-allowlist',
    'config-imports',
    'config-suppression',
    'config-server',
    'config-public-shadow',
    'images-public',
    'images-original',
  ].map((id) => getRule(id));
  assert.deepEqual(
    rules.map((rule) => [rule.stage, rule.level, rule.waivable]),
    rules.map(() => ['config', 'error', false]),
  );
});

// package.json

type Json = Record<string, unknown>;

/** The `package.json` that init writes, with pins. It is the smallest file that meets the three package rules. */
const PACKAGE: Json = {
  name: 'site',
  private: true,
  type: 'module',
  dependencies: { '@raess/astro-kit': '0.1.0', astro: '7.4.11' },
  devDependencies: { wrangler: '4.90.0' },
};

/** The package with some keys replaced. */
const pkg = (edit: Json = {}): Tree => ({ 'package.json': JSON.stringify({ ...PACKAGE, ...edit }) });

/** The package with one section replaced by these dependencies. */
const withSection = (section: string, dependencies: Json): Tree => pkg({ [section]: dependencies });

test('config-overrides: package.json has no overrides and no resolutions', () => {
  const cases: Case[] = [
    ['the package of init', pkg(), []],
    ['overrides', pkg({ overrides: { astro: '7.0.0' } }), ['package.json: overrides']],
    ['resolutions', pkg({ resolutions: { astro: '7.0.0' } }), ['package.json: resolutions']],
    ['both', pkg({ overrides: {}, resolutions: {} }), ['package.json: overrides', 'package.json: resolutions']],
    ['an empty overrides', pkg({ overrides: {} }), ['package.json: overrides']],
    ['overrides inside another key', pkg({ config: { overrides: {} } }), []],
    ['no package.json', {}, []],
    ['a package.json that is not JSON (config-dep-allowlist reports it)', { 'package.json': '{' }, []],
  ];
  const { actual, expected } = run('config-overrides', checkOverrides, cases);
  assert.deepEqual(actual, expected);
});

test('config-dep-spec: a spec names a version of the npm registry', () => {
  const registry = [
    '7.4.11',
    '^7.4.11',
    '~7.4',
    '>=7.4.8 <8',
    '7.x',
    '*',
    'latest',
    '',
    '1.0.0 - 2.0.0',
    '^1 || ^2',
    '1.0.0-beta.1',
    '1.0.0+build.5',
    'next',
    ' 7.4.11 ',
  ];
  const other = [
    'git+https://github.com/user/repo.git',
    'git+ssh://git@github.com/user/repo.git',
    'git://github.com/user/repo.git',
    'http://example.com/astro.tgz',
    'https://example.com/astro.tgz',
    'file:../astro',
    'link:../astro',
    'github:user/repo',
    'user/repo',
    'user/repo#main',
    '../astro',
    './astro-7.4.11.tgz',
    '  github:user/repo',
    // The forms that the earlier pattern of the rule let pass.
    'npm:other@1.0.0',
    'gist:abc123',
    'astro.tgz',
    'astro.tar',
    'ASTRO.TAR.GZ',
    'user/repo#v1@2',
    'user/repo#a b',
    'ssh://git@github.com/user/repo.git',
    'gitlab:user/repo',
    'workspace:*',
    '.hidden',
    'other@1.0.0',
  ];
  const astro = (spec: unknown): Tree => withSection('dependencies', { '@raess/astro-kit': '0.1.0', astro: spec });
  const cases: Case[] = [
    ['the package of init', pkg(), []],
    ...registry.map((spec): Case => [`the spec "${spec}"`, astro(spec), []]),
    ...other.map((spec): Case => [`the spec "${spec}"`, astro(spec), ['package.json: dependencies.astro']]),
    ['a spec that is not a string', astro(7), ['package.json: dependencies.astro']],
    [
      'in devDependencies',
      withSection('devDependencies', { wrangler: 'github:cloudflare/workers-sdk' }),
      ['package.json: devDependencies.wrangler'],
    ],
    [
      'in optionalDependencies',
      withSection('optionalDependencies', { wrangler: 'file:../wrangler' }),
      ['package.json: optionalDependencies.wrangler'],
    ],
    ['in peerDependencies, which the rule does not name', withSection('peerDependencies', { astro: 'user/repo' }), []],
    [
      'the kit from a file',
      withSection('dependencies', { '@raess/astro-kit': 'file:../kit.tgz', astro: '7.4.11' }),
      [],
    ],
    [
      'the kit from a git host',
      withSection('devDependencies', { '@raess/astro-kit': 'github:raess-dev/astro-kit' }),
      [],
    ],
    [
      'two specs',
      withSection('dependencies', { '@raess/astro-kit': '0.1.0', astro: 'user/repo', wrangler: 'file:../w' }),
      ['package.json: dependencies.astro', 'package.json: dependencies.wrangler'],
    ],
    ['a section that is not an object (config-dep-allowlist reports it)', pkg({ dependencies: ['astro'] }), []],
    ['no package.json', {}, []],
    ['a package.json that is not JSON (config-dep-allowlist reports it)', { 'package.json': '{' }, []],
  ];
  const { actual, expected } = run('config-dep-spec', checkDepSpecs, cases);
  assert.deepEqual(actual, expected);
});

test('config-dep-spec: the detail is the spec', () => {
  const files = withSection('dependencies', { astro: 'github:user/repo', wrangler: 4 });
  assert.deepEqual(findingsOf(checkDepSpecs, files), [
    ['config-dep-spec', 'package.json: dependencies.astro', 'github:user/repo'],
    ['config-dep-spec', 'package.json: dependencies.wrangler', 'the version is not a string'],
  ]);
});

type DependencySettings = Pick<Options, 'features' | 'dependencies'>;

const NO_FEATURES: Options['features'] = { forms: false, islands: false, scripts: false, wasm: false, workers: false };

/** The settings of a site with these features on and these extra packages. */
const settings = (features: Partial<Options['features']> = {}, dependencies: string[] = []): DependencySettings => ({
  features: { ...NO_FEATURES, ...features },
  dependencies,
});

const allowlist =
  (options: DependencySettings): Check =>
  (root, report) =>
    checkDepAllowlist(root, options, report);

/** The package of init with one more dependency. */
const plus = (name: string, section = 'dependencies'): Tree => {
  const current = PACKAGE[section];
  return withSection(section, { ...(typeof current === 'object' ? current : {}), [name]: '1.0.0' });
};

test('config-dep-allowlist: the list of every site', () => {
  const cases: Case[] = [
    ['the package of init', pkg(), []],
    ['an empty package', { 'package.json': '{}' }, []],
    ['no package.json', {}, []],
    ['wrangler as a dependency', plus('wrangler'), []],
    ['another package', plus('left-pad'), ['package.json: dependencies.left-pad']],
    ['in devDependencies', plus('left-pad', 'devDependencies'), ['package.json: devDependencies.left-pad']],
    ['in optionalDependencies', plus('sharp', 'optionalDependencies'), ['package.json: optionalDependencies.sharp']],
    ['in peerDependencies', plus('left-pad', 'peerDependencies'), ['package.json: peerDependencies.left-pad']],
    [
      'the forms package without forms',
      plus('@astrojs/cloudflare'),
      ['package.json: dependencies.@astrojs/cloudflare'],
    ],
    ...ISLANDS_DEPENDENCIES.map(
      (name): Case => [
        `the islands package ${name} without islands`,
        plus(name, 'devDependencies'),
        [`package.json: devDependencies.${name}`],
      ],
    ),
    [
      'two packages',
      withSection('dependencies', { astro: '7.4.11', 'left-pad': '1.3.0', lodash: '4.17.21' }),
      ['package.json: dependencies.left-pad', 'package.json: dependencies.lodash'],
    ],
    ['a package.json that is not JSON', { 'package.json': '{' }, ['package.json']],
    ['a package.json that is a list', { 'package.json': '[]' }, ['package.json']],
    ['a section that is not an object', pkg({ dependencies: ['left-pad'] }), ['package.json: dependencies']],
  ];
  const { actual, expected } = run('config-dep-allowlist', allowlist(settings()), cases);
  assert.deepEqual(actual, expected);
});

test('config-dep-allowlist: forms, islands and the dependencies setting add packages', () => {
  const islands = Object.fromEntries(ISLANDS_DEPENDENCIES.map((name) => [name, '1.0.0']));
  const forms: Case[] = [
    ['the forms package', plus('@astrojs/cloudflare'), []],
    ['an islands package', plus('solid-js'), ['package.json: dependencies.solid-js']],
  ];
  const withIslands: Case[] = [
    ['the five islands packages', withSection('devDependencies', islands), []],
    ['the forms package', plus('@astrojs/cloudflare'), ['package.json: dependencies.@astrojs/cloudflare']],
  ];
  const others: Case[] = [
    ['an islands package', plus('solid-js'), ['package.json: dependencies.solid-js']],
    ['the forms package', plus('@astrojs/cloudflare'), ['package.json: dependencies.@astrojs/cloudflare']],
  ];
  const extra: Case[] = [
    ['a package of the setting', plus('sharp'), []],
    ['a scoped package of the setting', plus('@fontsource/inter', 'devDependencies'), []],
    ['another package', plus('left-pad'), ['package.json: dependencies.left-pad']],
  ];
  const all: Case[] = [
    [
      'every allowed package',
      withSection('dependencies', { ...islands, '@astrojs/cloudflare': '14.4.7', astro: '7.4.11', sharp: '1.0.0' }),
      [],
    ],
  ];
  const rule = 'config-dep-allowlist';
  const results = [
    run(rule, allowlist(settings({ forms: true })), forms),
    run(rule, allowlist(settings({ islands: true })), withIslands),
    run(rule, allowlist(settings({ scripts: true, wasm: true, workers: true })), others),
    run(rule, allowlist(settings({}, ['sharp', '@fontsource/inter'])), extra),
    run(rule, allowlist(settings({ forms: true, islands: true }, ['sharp'])), all),
  ];
  assert.deepEqual(
    results.map((result) => result.actual),
    results.map((result) => result.expected),
  );
});

test('config-dep-allowlist: the detail names the feature that allows the package', () => {
  const files = withSection('dependencies', { '@astrojs/cloudflare': '14.4.7', 'solid-js': '1.9.19', 'left-pad': '1' });
  assert.deepEqual(findingsOf(allowlist(settings()), files), [
    ['config-dep-allowlist', 'package.json: dependencies.@astrojs/cloudflare', 'only with features.forms'],
    ['config-dep-allowlist', 'package.json: dependencies.solid-js', 'only with features.islands'],
    ['config-dep-allowlist', 'package.json: dependencies.left-pad', undefined],
  ]);
  assert.deepEqual(allowedDependencies(settings()), ['astro', '@raess/astro-kit', 'wrangler']);
  assert.deepEqual(allowedDependencies(settings({ forms: true, islands: true }, ['sharp'])), [
    'astro',
    '@raess/astro-kit',
    'wrangler',
    '@astrojs/cloudflare',
    '@astrojs/solid-js',
    'solid-js',
    'eslint',
    'eslint-plugin-solid',
    'typescript-eslint',
    'sharp',
  ]);
});

// Sources

/** A page with no finding: the smallest `src/` that meets the three source rules. */
const PAGE = '---\nconst title = "Home";\n---\n<h1>{title}</h1>\n';
const page = (more: Tree = {}): Tree => ({ 'src/pages/index.astro': PAGE, ...more });

test('config-imports: no source imports astro:transitions', () => {
  const named = "---\nimport { ClientRouter } from 'astro:transitions';\n---\n<ClientRouter />\n";
  const client = 'import { navigate } from "astro:transitions/client";\n';
  const spread = "const a = 1;\nimport {\n  navigate,\n} from\n  'astro:transitions/client';\n";
  const cases: Case[] = [
    ['a page with no import', page(), []],
    ['an import in the page', { 'src/pages/index.astro': named }, ['src/pages/index.astro:2']],
    ...IMPORT_EXTENSIONS.map(
      (extension): Case => [
        `a ${extension} file`,
        page({ [`src/lib/nav${extension}`]: client }),
        [`src/lib/nav${extension}:1`],
      ],
    ),
    ['an import for its effect', page({ 'src/a.ts': "import 'astro:transitions/client';\n" }), ['src/a.ts:1']],
    [
      'a dynamic import',
      page({ 'src/a.ts': "\n\nconst m = await import('astro:transitions/client');\n" }),
      ['src/a.ts:3'],
    ],
    ['a re-export', page({ 'src/a.ts': 'export * from "astro:transitions";\n' }), ['src/a.ts:1']],
    [
      'an import without spaces',
      page({ 'src/a.js': 'import{navigate}from"astro:transitions/client";' }),
      ['src/a.js:1'],
    ],
    ['an import over several lines: the line of the module name', page({ 'src/a.ts': spread }), ['src/a.ts:5']],
    ['two imports', page({ 'src/a.ts': `${client}const a = 1;\n${client}` }), ['src/a.ts:1', 'src/a.ts:3']],
    [
      'a block comment inside a dynamic import',
      page({ 'src/a.ts': "const m = await import(/* @vite-ignore */ 'astro:transitions/client');\n" }),
      ['src/a.ts:1'],
    ],
    [
      'a line comment inside a dynamic import: the line of the module name',
      page({ 'src/a.ts': "const m = await import(\n  // no check\n  'astro:transitions/client',\n);\n" }),
      ['src/a.ts:3'],
    ],
    [
      'a comment between from and the module name',
      page({ 'src/a.ts': "import { fade } from /* c */ 'astro:transitions';\n" }),
      ['src/a.ts:1'],
    ],
    [
      'a comment before the bracket of require',
      page({ 'src/a.cjs': "const m = require /* a */ (/* b **/ 'astro:transitions');\n" }),
      ['src/a.cjs:1'],
    ],
    [
      'a module name in a comment between from and another module',
      page({ 'src/a.ts': "import a from /* 'astro:transitions' */ './a.ts';\n" }),
      [],
    ],
    [
      'the name in a comment and in a text',
      page({ 'src/a.ts': "// astro:transitions\nconst no = 'astro:transitions';\n" }),
      [],
    ],
    ['another module with the same start', page({ 'src/a.ts': "import a from 'astro:transitions-kit';\n" }), []],
    ['a .md file, which the rule does not read', page({ 'src/content/a.md': client }), []],
    ['a .css and a .json file', page({ 'src/a.css': client, 'src/a.json': client }), []],
    ['a file outside src/', page({ 'scripts/a.ts': client, 'astro.config.mjs': client }), []],
    ['no src/ folder', {}, []],
  ];
  const { actual, expected } = run('config-imports', checkImports, cases);
  assert.deepEqual(actual, expected);
});

test('config-imports: the detail is the module', () => {
  const text =
    "import { ClientRouter } from 'astro:transitions';\nimport { navigate } from 'astro:transitions/client';\n";
  assert.deepEqual(findingsOf(checkImports, { 'src/a.ts': text }), [
    ['config-imports', 'src/a.ts:1', 'astro:transitions'],
    ['config-imports', 'src/a.ts:2', 'astro:transitions/client'],
  ]);
});

test('config-suppression: src/ holds no comment that switches a check off', () => {
  const words = ['biome-ignore', '@ts-ignore', '@ts-expect-error', '@ts-nocheck'];
  const ignore = '// @ts-ignore\nconst a: number = "1";\n';
  const cases: Case[] = [
    ['a page with no such comment', page(), []],
    ...words.map(
      (word): Case => [`the word ${word}`, page({ 'src/a.ts': `const a = 1;\n// ${word}\n` }), ['src/a.ts:2']],
    ),
    ...SUPPRESSION_EXTENSIONS.map(
      (extension): Case => [
        `a ${extension} file`,
        page({ [`src/lib/a${extension}`]: ignore }),
        [`src/lib/a${extension}:1`],
      ],
    ),
    ['in the page', { 'src/pages/index.astro': `---\n${ignore}---\n<p>Text</p>\n` }, ['src/pages/index.astro:2']],
    [
      'a block comment of Biome',
      page({ 'src/styles/a.css': '/* biome-ignore-all lint: no */\n' }),
      ['src/styles/a.css:1'],
    ],
    [
      'two comments',
      page({ 'src/a.ts': '// @ts-nocheck\nconst a = 1;\n// biome-ignore lint/style/useConst: no\n' }),
      ['src/a.ts:1', 'src/a.ts:3'],
    ],
    ['two files', page({ 'src/b.ts': ignore, 'src/a.ts': ignore }), ['src/a.ts:1', 'src/b.ts:1']],
    ['@ts-nocheck in upper case', page({ 'src/a.ts': '// @TS-NOCHECK\nconst a: number = "1";\n' }), ['src/a.ts:1']],
    ['@ts-nocheck in mixed case', page({ 'src/a.ts': '\n// @Ts-NoCheck\n' }), ['src/a.ts:2']],
    ['a source of the largest size', page({ 'src/a.ts': padded(new Uint8Array(0), SOURCE_MAX_BYTES) }), []],
    [
      'a source that is one byte too large',
      page({ 'src/a.ts': padded(new Uint8Array(0), SOURCE_MAX_BYTES + 1) }),
      ['src/a.ts'],
    ],
    ['a large file of another type', page({ 'src/a.json': padded(new Uint8Array(0), SOURCE_MAX_BYTES + 1) }), []],
    ['a .json, a .txt and a .html file', page({ 'src/a.json': ignore, 'src/a.txt': ignore, 'src/a.html': ignore }), []],
    ['a file outside src/', page({ 'astro.config.mjs': ignore, 'scripts/a.ts': ignore }), []],
    [
      'the folders that Biome skips: each file is read, and each folder is a finding',
      page({
        'src/node_modules/pkg/index.ts': ignore,
        'src/pages/dist/a.ts': ignore,
        'src/.astro/types.d.ts': ignore,
        'src/lib/.wrangler/tmp/a.js': ignore,
      }),
      [
        'src/.astro/types.d.ts:1',
        'src/lib/.wrangler/tmp/a.js:1',
        'src/node_modules/pkg/index.ts:1',
        'src/pages/dist/a.ts:1',
        'src/.astro/',
        'src/lib/.wrangler/',
        'src/node_modules/',
        'src/pages/dist/',
      ],
    ],
    [
      'a folder that Biome skips, with no comment in it',
      page({ 'src/pages/dist/index.astro': PAGE }),
      ['src/pages/dist/'],
    ],
    ['an empty folder that Biome skips', page({ 'src/assets/dist': FOLDER }), ['src/assets/dist/']],
    ['such a folder inside such a folder: the topmost one', page({ 'src/dist/node_modules/a.txt': '' }), ['src/dist/']],
    ['such a folder under public/', page({ 'public/img/dist/photo.txt': '' }), ['public/img/dist/']],
    ['a file with such a name', page({ 'src/dist': '', 'src/lib/node_modules': '' }), []],
    [
      'names that only look alike',
      page({ 'src/dist2/a.ts': '', 'src/my.astro/a.ts': '', 'src/wrangler/a.ts': '' }),
      [],
    ],
    ['such folders outside src/ and public/', page({ 'dist/a.js': ignore, 'node_modules/pkg/a.js': ignore }), []],
    [
      'a link to a folder that Biome skips: the files are read, and the link is a finding',
      page({ 'src/vendor': link('node_modules/pkg'), 'node_modules/pkg/a.ts': ignore }),
      ['src/vendor/a.ts:1', 'src/vendor/'],
    ],
    [
      'a link to a file in a folder that Biome skips',
      page({ 'src/a.ts': link('dist/a.ts'), 'dist/a.ts': ignore }),
      ['src/a.ts:1', 'src/a.ts'],
    ],
    [
      'a link named like such a folder, to another folder of the project',
      page({ 'src/dist': link('shared'), 'shared/a.ts': '' }),
      [],
    ],
    [
      'a link to a file outside the project: the file is not read, and the link is a finding',
      page({ 'src/a.ts': link('../away/a.ts'), '../away/a.ts': ignore }),
      ['src/a.ts'],
    ],
    [
      'a link to a folder outside the project',
      page({ 'src/pages/sub': link('../away'), '../away/a.ts': ignore }),
      ['src/pages/sub'],
    ],
    [
      'links under public/ that lead out of the project',
      page({ 'public/img': link('../away'), 'public/a.txt': link('../away/a.png'), '../away/a.png': '' }),
      ['public/a.txt', 'public/img'],
    ],
    ['src/ is a link out of the project', { src: link('../away'), '../away/a.ts': ignore }, ['src']],
    ['public/ is a link out of the project', page({ public: link('../away'), '../away/a.png': '' }), ['public']],
    ['a link to nothing', page({ 'src/a.ts': link('nothing.ts'), 'public/b': link('../nothing') }), []],
    ['no src/ folder', {}, []],
  ];
  const { actual, expected } = run('config-suppression', checkSuppression, cases);
  assert.deepEqual(actual, expected);
});

test('config-suppression: the detail is the word', () => {
  assert.deepEqual(findingsOf(checkSuppression, { 'src/a.ts': '// @ts-expect-error\n' }), [
    ['config-suppression', 'src/a.ts:1', '@ts-expect-error'],
  ]);
});

test('config-server: no middleware, no actions and no server:defer', () => {
  const island =
    '---\nimport Avatar from "../components/Avatar.astro";\n---\n<main>\n  <Avatar server:defer />\n</main>\n';
  const cases: Case[] = [
    ['a page', page(), []],
    ['src/middleware.ts', page({ 'src/middleware.ts': '' }), ['src/middleware.ts']],
    ['src/middleware.js', page({ 'src/middleware.js': '' }), ['src/middleware.js']],
    ['src/middleware.mjs', page({ 'src/middleware.mjs': '' }), ['src/middleware.mjs']],
    ['src/middleware/ with a file', page({ 'src/middleware/index.ts': '' }), ['src/middleware/']],
    ['an empty src/middleware/', page({ 'src/middleware': FOLDER }), ['src/middleware/']],
    ['src/actions/ with a file', page({ 'src/actions/index.ts': '' }), ['src/actions/']],
    ['an empty src/actions/', page({ 'src/actions': FOLDER }), ['src/actions/']],
    ['src/actions.ts', page({ 'src/actions.ts': '' }), ['src/actions.ts']],
    ['server:defer in a page', { 'src/pages/index.astro': island }, ['src/pages/index.astro:5']],
    [
      'server:defer in a component, twice',
      page({ 'src/components/Box.astro': '<A server:defer />\n<p>Text</p>\n<B server:defer>\n</B>\n' }),
      ['src/components/Box.astro:1', 'src/components/Box.astro:3'],
    ],
    [
      'all three parts',
      { 'src/pages/index.astro': island, 'src/middleware.ts': '', 'src/actions/index.ts': '' },
      ['src/actions/', 'src/middleware.ts', 'src/pages/index.astro:5'],
    ],
    [
      'a link to a middleware file',
      page({ 'src/middleware.ts': link('real.ts'), 'real.ts': '' }),
      ['src/middleware.ts'],
    ],
    [
      'the names below the top of src/',
      page({
        'src/lib/middleware.ts': '',
        'src/lib/actions.ts': '',
        'src/components/actions/Menu.astro': '<menu></menu>\n',
      }),
      [],
    ],
    ['names that only start alike', page({ 'src/middleware-notes.md': '', 'src/actionsheet.ts': '' }), []],
    [
      'a file named actions and a folder named middleware.old',
      page({ 'src/actions': '', 'src/middleware.old': FOLDER }),
      [],
    ],
    ['the names outside src/', page({ 'middleware.ts': '', 'actions/index.ts': '' }), []],
    [
      'server:defer outside a .astro file',
      page({ 'src/content/a.md': '<A server:defer />\n', 'src/a.ts': '// server:defer\n' }),
      [],
    ],
    ['a longer word', page({ 'src/components/Box.astro': '<A server:deferred />\n' }), []],
    ['no src/ folder', {}, []],
  ];
  const { actual, expected } = run('config-server', checkServer, cases);
  assert.deepEqual(actual, expected);
});

// public/

/** The icons of every site: the smallest `public/` that meets the two rules. */
const ICONS: Tree = { 'public/favicon.ico': '', 'public/icon.svg': '<svg/>', 'public/apple-touch-icon.png': '' };
const icons = (more: Tree = {}): Tree => ({ ...ICONS, ...more });

test('config-public-shadow: public/ holds no file that the kit writes', () => {
  const cases: Case[] = [
    ['the icons', icons(), []],
    ['no public/ folder', {}, []],
    ['robots.txt', icons({ 'public/robots.txt': '' }), ['public/robots.txt']],
    ['_headers', icons({ 'public/_headers': '' }), ['public/_headers']],
    ['_redirects', icons({ 'public/_redirects': '' }), ['public/_redirects']],
    ['.well-known/security.txt', icons({ 'public/.well-known/security.txt': '' }), ['public/.well-known/security.txt']],
    ['the folder _kit', icons({ 'public/_kit/routes.txt': '' }), ['public/_kit']],
    ['an empty folder _kit', icons({ 'public/_kit': FOLDER }), ['public/_kit']],
    ['a file named _kit', icons({ 'public/_kit': '' }), ['public/_kit']],
    ['sitemap.xml', icons({ 'public/sitemap.xml': '' }), ['public/sitemap.xml']],
    ['sitemap-index.xml', icons({ 'public/sitemap-index.xml': '' }), ['public/sitemap-index.xml']],
    ['sitemap-0.xml', icons({ 'public/sitemap-0.xml': '' }), ['public/sitemap-0.xml']],
    [
      'all of them',
      icons({
        'public/sitemap-1.xml': '',
        'public/sitemap.xml': '',
        'public/_kit/release.txt': '',
        'public/.well-known/security.txt': '',
        'public/_redirects': '',
        'public/_headers': '',
        'public/robots.txt': '',
      }),
      [
        'public/robots.txt',
        'public/_headers',
        'public/_redirects',
        'public/.well-known/security.txt',
        'public/_kit',
        'public/sitemap-1.xml',
        'public/sitemap.xml',
      ],
    ],
    ['another file in .well-known', icons({ 'public/.well-known/change-password': '' }), []],
    [
      'the names below the top of public/',
      icons({
        'public/docs/robots.txt': '',
        'public/docs/_headers': '',
        'public/docs/sitemap.xml': '',
        'public/docs/_kit/a': '',
      }),
      [],
    ],
    [
      'names that only look alike',
      icons({ 'public/sitemap.txt': '', 'public/my-sitemap.xml': '', 'public/robots.md': '' }),
      [],
    ],
    ['the names outside public/', icons({ 'robots.txt': '', _headers: '', 'src/sitemap.xml': '' }), []],
  ];
  const { actual, expected } = run('config-public-shadow', checkPublicShadow, cases);
  assert.deepEqual(actual, expected);
});

test('images-public: public/ holds no raster file except the four allowed ones', () => {
  const cases: Case[] = [
    ['the icons', icons(), []],
    ['the four allowed files', icons({ 'public/og.png': '', 'public/og.jpg': '' }), []],
    ['no public/ folder', {}, []],
    ...RASTER_EXTENSIONS.map(
      (extension): Case => [
        `a ${extension} file`,
        icons({ [`public/photo${extension}`]: '' }),
        [`public/photo${extension}`],
      ],
    ),
    ['an extension in upper case', icons({ 'public/PHOTO.PNG': '' }), ['public/PHOTO.PNG']],
    ['og with another extension', icons({ 'public/og.jpeg': '' }), ['public/og.jpeg']],
    ['an allowed name below the top of public/', icons({ 'public/img/og.png': '' }), ['public/img/og.png']],
    ['two files', icons({ 'public/b.gif': '', 'public/a/c.webp': '' }), ['public/a/c.webp', 'public/b.gif']],
    [
      'a raster file in a folder that Biome skips',
      icons({ 'public/dist/a.png': '', 'public/node_modules/b.png': '', 'public/img/.astro/c.png': '' }),
      ['public/dist/a.png', 'public/img/.astro/c.png', 'public/node_modules/b.png'],
    ],
    [
      'a link to a raster file outside the root',
      icons({ 'public/photo.png': link('../photo.png'), '../photo.png': '' }),
      ['public/photo.png'],
    ],
    [
      'files that are no raster images',
      icons({ 'public/other.ico': '', 'public/logo.svg': '<svg/>', 'public/guide.pdf': '', 'public/a.woff2': '' }),
      [],
    ],
    ['a raster file outside public/', icons({ 'photo.png': '', 'docs/photo.jpg': '' }), []],
  ];
  const { actual, expected } = run('images-public', checkPublicImages, cases);
  assert.deepEqual(actual, expected);
  assert.deepEqual(['a.png', 'a.JPG', 'a.tiff', 'a.svg', 'a.ico', 'png', 'a.png.txt'].map(isRaster), [
    true,
    true,
    true,
    false,
    false,
    false,
    false,
  ]);
});

// Image originals

const ascii = (text: string): number[] => [...text].map((letter) => letter.charCodeAt(0));
const be16 = (value: number): number[] => [(value >>> 8) & 0xff, value & 0xff];
const be32 = (value: number): number[] => [...be16(value >>> 16), ...be16(value & 0xffff)];
const le16 = (value: number): number[] => [value & 0xff, (value >>> 8) & 0xff];
const le24 = (value: number): number[] => [...le16(value & 0xffff), (value >>> 16) & 0xff];
const le32 = (value: number): number[] => [...le16(value & 0xffff), ...le16(value >>> 16)];

/** A PNG file up to the end of its IHDR chunk. */
const png = (width: number, height: number): Uint8Array =>
  Uint8Array.from([
    0x89,
    ...ascii('PNG\r\n'),
    0x1a,
    0x0a,
    ...be32(13),
    ...ascii('IHDR'),
    ...be32(width),
    ...be32(height),
    8,
    6,
    0,
    0,
    0,
    ...be32(0),
  ]);

/** A GIF file up to the end of its logical screen descriptor. */
const gif = (width: number, height: number, version = 'GIF89a'): Uint8Array =>
  Uint8Array.from([...ascii(version), ...le16(width), ...le16(height), 0, 0, 0]);

/** A RIFF file of the form `form` with one chunk. */
const riff = (chunk: string, data: number[], form = 'WEBP'): Uint8Array =>
  Uint8Array.from([
    ...ascii('RIFF'),
    ...le32(12 + data.length),
    ...ascii(form),
    ...ascii(chunk),
    ...le32(data.length),
    ...data,
  ]);

/** A lossy WebP: the frame tag, the start code, then width and height with two scale bits each. */
const webpLossy = (width: number, height: number, scale = 0): Uint8Array =>
  riff('VP8 ', [
    0x30,
    0x01,
    0x00,
    0x9d,
    0x01,
    0x2a,
    ...le16(width | (scale << 14)),
    ...le16(height | (scale << 14)),
    0,
    0,
  ]);

/** A lossless WebP: the signature byte, then 14 bits of width minus one and 14 bits of height minus one. */
const webpLossless = (width: number, height: number): Uint8Array =>
  riff('VP8L', [0x2f, ...le32((width - 1) | ((height - 1) << 14)), 0, 0, 0, 0, 0]);

/** An extended WebP: the flags, then the canvas width minus one and the canvas height minus one, 24 bits each. */
const webpExtended = (width: number, height: number): Uint8Array =>
  riff('VP8X', [0x10, 0, 0, 0, ...le24(width - 1), ...le24(height - 1)]);

const segment = (marker: number, data: number[]): number[] => [0xff, marker, ...be16(data.length + 2), ...data];

/** A frame header of a JPEG with three components. */
const frame = (marker: number, width: number, height: number): number[] =>
  segment(marker, [8, ...be16(height), ...be16(width), 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);

const SOI = [0xff, 0xd8];
const EOI = [0xff, 0xd9];
const JFIF = segment(0xe0, [...ascii('JFIF'), 0, 1, 2, 0, 0, 1, 0, 1, 0, 0]);
/** An Exif segment that holds a preview image with a frame header of its own. */
const EXIF = segment(0xe1, [...ascii('Exif'), 0, 0, ...SOI, ...frame(0xc0, 9999, 9999), ...EOI]);
const TABLES = [...segment(0xdb, new Array<number>(65).fill(1)), ...segment(0xc4, new Array<number>(20).fill(0))];
const SCAN = [...segment(0xda, [3, 1, 0, 2, 0x11, 3, 0x11, 0, 0x3f, 0]), 0x12, 0x34, ...EOI];

/** A JPEG whose frame header comes after an application segment, an Exif preview and the tables. */
const jpeg = (width: number, height: number, marker = 0xc0): Uint8Array =>
  Uint8Array.from([...SOI, ...JFIF, ...EXIF, ...TABLES, ...frame(marker, width, height), ...SCAN]);

test('imageSize reads the width and the height from the four headers', () => {
  const size = (width: number, height: number): { width: number; height: number } => ({ width, height });
  const cases: [name: string, bytes: Uint8Array, size: { width: number; height: number } | undefined][] = [
    ['PNG', png(800, 600), size(800, 600)],
    ['PNG, more than 16 bits', png(70_000, 1), size(70_000, 1)],
    ['GIF89a', gif(320, 200), size(320, 200)],
    ['GIF87a', gif(1, 2561, 'GIF87a'), size(1, 2561)],
    ['WebP, lossy', webpLossy(640, 480), size(640, 480)],
    ['WebP, lossy, with scale bits', webpLossy(2561, 100, 3), size(2561, 100)],
    ['WebP, lossless', webpLossless(2561, 7), size(2561, 7)],
    ['WebP, lossless, the largest size', webpLossless(16_384, 16_384), size(16_384, 16_384)],
    ['WebP, extended', webpExtended(2560, 1440), size(2560, 1440)],
    ['WebP, extended, more than 16 bits', webpExtended(70_000, 3), size(70_000, 3)],
    ['JPEG, baseline, after other segments and a preview', jpeg(1200, 900), size(1200, 900)],
    ['JPEG, progressive', jpeg(900, 1200, 0xc2), size(900, 1200)],
    [
      'JPEG, with fill bytes before the frame header',
      Uint8Array.from([...SOI, ...JFIF, 0xff, 0xff, ...frame(0xc1, 5, 6)]),
      size(5, 6),
    ],
    ['JPEG, with a marker that has no length', Uint8Array.from([...SOI, 0xff, 0x01, ...frame(0xc0, 5, 6)]), size(5, 6)],
    ['no bytes', new Uint8Array(0), undefined],
    ['a text', Uint8Array.from(ascii('version https://git-lfs.github.com/spec/v1\n')), undefined],
    ['PNG, cut before the height', png(800, 600).subarray(0, 20), undefined],
    [
      'PNG, with another first chunk',
      Uint8Array.from([...png(800, 600).subarray(0, 12), ...ascii('CgBI'), ...be32(800), ...be32(600)]),
      undefined,
    ],
    ['GIF, with an unknown version', gif(320, 200, 'GIF90a'), undefined],
    ['RIFF, but not WebP', riff('VP8X', [0x10, 0, 0, 0, ...le24(9), ...le24(9)], 'WAVE'), undefined],
    ['WebP, with an unknown first chunk', riff('ALPH', new Array<number>(10).fill(0)), undefined],
    ['WebP, lossy, without the start code', riff('VP8 ', new Array<number>(12).fill(0)), undefined],
    ['WebP, lossless, without the signature byte', riff('VP8L', new Array<number>(10).fill(0)), undefined],
    ['JPEG, the start only', Uint8Array.from(SOI), undefined],
    [
      'JPEG, with no frame header before the scan',
      Uint8Array.from([...SOI, ...JFIF, ...EXIF, ...TABLES, ...SCAN]),
      undefined,
    ],
    ['JPEG, with no frame header before the end', Uint8Array.from([...SOI, ...JFIF, ...EOI]), undefined],
    [
      'JPEG, cut inside the frame header',
      jpeg(1200, 900).subarray(0, SOI.length + JFIF.length + EXIF.length + TABLES.length + 6),
      undefined,
    ],
    ['JPEG, with bytes that are no segment', Uint8Array.from([...SOI, 0x00, 0x01, ...frame(0xc0, 5, 6)]), undefined],
  ];
  assert.deepEqual(
    cases.map(([name, bytes]) => [name, imageSize(bytes)]),
    cases.map(([name, , expected]) => [name, expected]),
  );
});

test('imageFileSize reads the same sizes from a file', () => {
  const files: Tree = {
    'a.png': png(800, 600),
    'a.jpg': jpeg(1200, 900),
    'a.webp': webpExtended(70_000, 3),
    'a.txt': 'text',
  };
  const sizes = inProject(files, (root) => Object.keys(files).map((name) => imageFileSize(join(root, name))));
  assert.deepEqual(sizes, [
    { width: 800, height: 600 },
    { width: 1200, height: 900 },
    { width: 70_000, height: 3 },
    undefined,
  ]);
});

test('images-original: an original is at most 2,560 px on its long edge and at most 3,145,728 B', () => {
  const px = LIMITS.imageMaxPx;
  const bytes = LIMITS.imageMaxBytes;
  const hero = (image: Entry, name = 'hero.png'): Tree => page({ [`src/assets/${name}`]: image });
  const formats: [name: string, file: string, make: (width: number, height: number) => Uint8Array][] = [
    ['PNG', 'a.png', png],
    ['GIF', 'a.gif', gif],
    ['WebP, lossy', 'a.webp', webpLossy],
    ['WebP, lossless', 'b.webp', webpLossless],
    ['WebP, extended', 'c.webp', webpExtended],
    ['JPEG, .jpg', 'a.jpg', jpeg],
    ['JPEG, .jpeg', 'a.jpeg', jpeg],
  ];
  const garbage = Uint8Array.from(ascii('not an image header'));
  const cases: Case[] = [
    ['an image at both limits', hero(padded(png(px, px), bytes)), []],
    ['one pixel too wide', hero(png(px + 1, 1440)), ['src/assets/hero.png']],
    ['one pixel too tall', hero(png(1440, px + 1)), ['src/assets/hero.png']],
    ['one byte too large', hero(padded(png(px, 1440), bytes + 1)), ['src/assets/hero.png']],
    [
      'too wide and too large: two findings',
      hero(padded(png(px + 1, 1440), bytes + 1)),
      ['src/assets/hero.png', 'src/assets/hero.png'],
    ],
    ...formats.map(([name, file, make]): Case => [`${name}, at the limit`, hero(make(px, px), file), []]),
    ...formats.map(
      ([name, file, make]): Case => [`${name}, too wide`, hero(make(px + 1, 10), file), [`src/assets/${file}`]],
    ),
    ...formats.map(
      ([name, file, make]): Case => [`${name}, too tall`, hero(make(10, px + 1), file), [`src/assets/${file}`]],
    ),
    ['an extension in upper case', hero(png(px + 1, 10), 'HERO.PNG'), ['src/assets/HERO.PNG']],
    ['an image outside src/assets/', page({ 'src/pages/_hero.jpg': jpeg(px + 1, 10) }), ['src/pages/_hero.jpg']],
    ['two images', page({ 'src/b.png': png(px + 1, 1), 'src/a/c.gif': gif(1, px + 1) }), ['src/a/c.gif', 'src/b.png']],
    ['a PNG header in a .jpg file', hero(png(px + 1, 10), 'a.jpg'), ['src/assets/a.jpg']],
    ['a .png file with no header', hero(garbage), ['src/assets/hero.png']],
    ['an empty .jpg file', hero('', 'a.jpg'), ['src/assets/a.jpg']],
    [
      'AVIF, BMP and TIFF: no header is read',
      page({ 'src/a.avif': garbage, 'src/a.bmp': garbage, 'src/a.tif': garbage, 'src/a.tiff': garbage }),
      [],
    ],
    ['AVIF, one byte too large', hero(padded(garbage, bytes + 1), 'a.avif'), ['src/assets/a.avif']],
    [
      'files that are no raster images',
      page({ 'src/assets/logo.svg': '<svg width="9999"/>', 'src/assets/a.woff2': padded(garbage, bytes + 1) }),
      [],
    ],
    ['a large image outside src/', page({ 'public/og.png': png(px + 1, 10), 'docs/a.png': png(px + 1, 10) }), []],
    [
      'a large image in a folder that Biome skips',
      page({ 'src/node_modules/pkg/a.png': png(px + 1, 10), 'src/assets/dist/b.png': png(px + 1, 10) }),
      ['src/assets/dist/b.png', 'src/node_modules/pkg/a.png'],
    ],
    [
      'a link to a large image outside the project: this check does not read it, and config-suppression fails the link',
      page({ 'src/a.png': link('../a.png'), '../a.png': png(px + 1, 10) }),
      [],
    ],
    [
      'a JPEG with more fill bytes than the reader passes',
      hero(Uint8Array.from([...SOI, ...new Array<number>(JPEG_MAX_STEPS).fill(0xff), ...frame(0xc0, 5, 6)]), 'a.jpg'),
      ['src/assets/a.jpg'],
    ],
    [
      'a JPEG with more empty segments than the reader passes',
      hero(
        Uint8Array.from([
          ...SOI,
          ...new Array<number[]>(JPEG_MAX_STEPS).fill(segment(0xe0, [])).flat(),
          ...frame(0xc0, 5, 6),
        ]),
        'a.jpg',
      ),
      ['src/assets/a.jpg'],
    ],
    [
      'a JPEG with as many fill bytes as the reader passes',
      hero(
        Uint8Array.from([...SOI, ...new Array<number>(JPEG_MAX_STEPS - 1).fill(0xff), ...frame(0xc0, 5, 6)]),
        'a.jpg',
      ),
      [],
    ],
    [
      'a link to a large image inside the root',
      page({ 'src/a.png': link('art/a.png'), 'art/a.png': png(px + 1, 10) }),
      ['src/a.png'],
    ],
    ['no src/ folder', {}, []],
  ];
  const { actual, expected } = run('images-original', (root, report) => checkImageOriginals(root, report), cases);
  assert.deepEqual(actual, expected);
});

test('images-original: the details name the size and the limit, and the limits can be passed', () => {
  const files: Tree = {
    'src/a.png': padded(png(2561, 1440), 3_145_729),
    'src/b.png': 'text',
    'src/c.gif': gif(101, 5),
  };
  assert.deepEqual(
    findingsOf((root, report) => checkImageOriginals(root, report), files),
    [
      ['images-original', 'src/a.png', '3145729 B; the limit is 3145728 B'],
      ['images-original', 'src/a.png', '2561 × 1440 px; the limit is 2560 px on the long edge'],
      ['images-original', 'src/b.png', 'the file has no PNG, GIF, WebP or JPEG header with a size'],
    ],
  );
  const small = { imageMaxPx: 100, imageMaxBytes: 12 };
  assert.deepEqual(
    findingsOf((root, report) => checkImageOriginals(root, report, small), { 'src/c.gif': gif(101, 5) }),
    [
      ['images-original', 'src/c.gif', '13 B; the limit is 12 B'],
      ['images-original', 'src/c.gif', '101 × 5 px; the limit is 100 px on the long edge'],
    ],
  );
});

// The walk

test('listFiles lists the files of one folder, sorted, and skips no folder name', () => {
  const files: Tree = {
    'src/pages/index.astro': PAGE,
    'src/b.ts': '',
    'src/a/z.ts': '',
    'src/a-b/y.ts': '',
    'src/.hidden/a.ts': '',
    'src/empty': FOLDER,
    'src/node_modules/pkg/a.ts': '',
    'src/a/dist/a.ts': '',
    'src/.astro/a.ts': '',
    'src/.wrangler/a.ts': '',
    'public/favicon.ico': '',
    'package.json': '{}',
  };
  const listed = inProject(files, (root) => ({
    src: listFiles(root, 'src').map((file) => [file.path, file.inside, file.file === join(root, file.path)]),
    unchecked: walk(root, 'src').unchecked,
    outside: walk(root, 'src').outside,
    missing: walk(root, 'missing'),
    file: walk(root, 'package.json'),
  }));
  const nothing = { files: [], unchecked: [], outside: [] };
  assert.deepEqual(listed, {
    src: [
      ['src/.astro/a.ts', true, true],
      ['src/.hidden/a.ts', true, true],
      ['src/.wrangler/a.ts', true, true],
      ['src/a-b/y.ts', true, true],
      ['src/a/dist/a.ts', true, true],
      ['src/a/z.ts', true, true],
      ['src/b.ts', true, true],
      ['src/node_modules/pkg/a.ts', true, true],
      ['src/pages/index.astro', true, true],
    ],
    unchecked: ['src/.astro/', 'src/.wrangler/', 'src/a/dist/', 'src/node_modules/'],
    outside: [],
    missing: nothing,
    file: nothing,
  });
});

test('the walk follows a symbolic link only inside the root, and never in a circle', () => {
  const files: Tree = {
    'src/a.ts': '',
    'src/loop': link('src'),
    'src/shared': link('shared'),
    'shared/b.ts': '',
    'shared/back': link('src'),
    'shared/out': link('../away'),
    'src/away': link('../away'),
    '../away/c.ts': '',
    'src/far.ts': link('../away/c.ts'),
    'src/near.ts': link('shared/b.ts'),
    'src/broken.ts': link('nothing.ts'),
    'src/packages': link('node_modules/pkg'),
    'node_modules/pkg/d.ts': '',
    'node_modules/pkg/node_modules/dep/e.ts': '',
  };
  const found = inProject(files, (root) => walk(root, 'src'));
  assert.deepEqual(
    found.files.map((file) => [file.path, file.inside]),
    [
      ['src/a.ts', true],
      ['src/far.ts', false],
      ['src/near.ts', true],
      ['src/packages/d.ts', true],
      ['src/packages/node_modules/dep/e.ts', true],
      ['src/shared/b.ts', true],
    ],
  );
  assert.deepEqual(found.unchecked, ['src/packages/']);
  assert.deepEqual(found.outside, ['src/away', 'src/far.ts', 'src/shared/out']);
});

test('the source checks read a linked folder inside the root, and no file outside the root', () => {
  const ignore = '// @ts-ignore\n';
  const files: Tree = {
    'src/pages/index.astro': PAGE,
    'src/shared': link('shared'),
    'shared/b.ts': ignore,
    'src/away': link('../away'),
    '../away/c.ts': ignore,
    'src/far.ts': link('../away/c.ts'),
  };
  const { actual, expected } = run('config-suppression', checkSuppression, [
    ['links', files, ['src/shared/b.ts:1', 'src/away', 'src/far.ts']],
  ]);
  assert.deepEqual(actual, expected);

  const outside: Tree = {
    src: link('../away'),
    public: link('../away'),
    '../away/a.ts': ignore,
    '../away/a.astro': "---\nimport 'astro:transitions';\n---\n<A server:defer />\n",
    '../away/middleware.ts': '',
    '../away/robots.txt': '',
    '../away/a.png': '',
  };
  const all: Check = (root, report) => {
    checkSuppression(root, report);
    checkImports(root, report);
    checkServer(root, report);
    checkPublicShadow(root, report);
    checkPublicImages(root, report);
    checkImageOriginals(root, report);
  };
  const reason = 'the link leads out of the project, so no check reads its target';
  assert.deepEqual(findingsOf(all, outside), [
    ['config-suppression', 'src', reason],
    ['config-suppression', 'public', reason],
  ]);
});

test('config-suppression: the details name the word as written, the size and the reason', () => {
  const files: Tree = {
    'src/a.ts': '// @TS-NoCheck\n',
    'src/b.ts': padded(new Uint8Array(0), SOURCE_MAX_BYTES + 1),
    'src/dist/c.txt': '',
  };
  assert.deepEqual(findingsOf(checkSuppression, files), [
    ['config-suppression', 'src/a.ts:1', '@TS-NoCheck'],
    ['config-suppression', 'src/b.ts', '1048577 B; Biome checks a file of at most 1048576 B'],
    [
      'config-suppression',
      'src/dist/',
      'Biome skips every folder with one of these names: node_modules, dist, .astro, .wrangler',
    ],
  ]);
});

test('the source checks do not read a source that is too large', () => {
  const head = Uint8Array.from(ascii("// @ts-ignore\nimport 'astro:transitions';\n<A server:defer />\n"));
  const files: Tree = { 'src/pages/a.astro': padded(head, SOURCE_MAX_BYTES + 1) };
  const all: Check = (root, report) => {
    checkSuppression(root, report);
    checkImports(root, report);
    checkServer(root, report);
  };
  assert.deepEqual(
    findingsOf(all, files).map(([rule, place]) => [rule, place]),
    [['config-suppression', 'src/pages/a.astro']],
  );
  const small: Tree = { 'src/pages/a.astro': padded(head, SOURCE_MAX_BYTES) };
  assert.deepEqual(
    findingsOf(all, small).map(([rule, place]) => [rule, place]),
    [
      ['config-suppression', 'src/pages/a.astro:1'],
      ['config-imports', 'src/pages/a.astro:2'],
      ['config-server', 'src/pages/a.astro:3'],
    ],
  );
});

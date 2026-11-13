import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { getRule, Report } from '../../src/registry.ts';
import {
  BIOME_CONFIG_NAMES,
  BIOME_FILE,
  CONFIG_FILE,
  checkShims,
  firstDifference,
  normalize,
  otherBiomeConfigs,
  SHIMS,
} from '../../src/shims.ts';

const RULE = 'config-shim';

/** The specification, so that the fixed texts of the test and of the document cannot differ. */
const SPEC = readFileSync(fileURLToPath(new URL('../../docs/spec.md', import.meta.url)), 'utf8');

const BIOME = 'biome.json';
const TSCONFIG = 'tsconfig.json';

/** The code block that 12.2 gives for a shim, without the indentation of its list item, with a final newline. */
function specBlock(file: string, language: string): string {
  const start = SPEC.indexOf(`  - \`${file}\`:\n\n    \`\`\`${language}\n`);
  const end = SPEC.indexOf('\n    ```\n', start);
  if (start < 0 || end < 0) return '';
  const block = SPEC.slice(SPEC.indexOf('\n', SPEC.indexOf('```', start)) + 1, end);
  return `${block.replace(/^ {4}/gm, '')}\n`;
}

/** A folder is written as a directory. Any other value is the text of a file. */
const FOLDER = Symbol('folder');

type Files = Readonly<Record<string, string | typeof FOLDER>>;

/** The smallest root that meets the rule: the three shims, and nothing else. */
const shims: Files = SHIMS;

/** The root without one file. */
const without = (file: string): Files => Object.fromEntries(Object.entries(shims).filter(([name]) => name !== file));

/** The root with one file changed by `change`. */
const changed = (file: keyof typeof SHIMS, change: (text: string) => string): Files => ({
  ...shims,
  [file]: change(SHIMS[file]),
});

/** One case: a name, the files of the root, and every finding as `<where>: <detail>`, in order. */
type Case = readonly [name: string, files: Files, findings: readonly string[]];

interface Seen {
  name: string;
  /** Every finding as `<where>: <detail>`, in the order of the report. */
  findings: readonly string[];
  /** The sorted rule ids of the findings that fail. */
  ids: string[];
}

/** Writes the files into a new temp folder, runs the check and removes the folder. */
function run(files: Files): { findings: string[]; ids: string[] } {
  const root = mkdtempSync(join(tmpdir(), 'astro-kit-'));
  try {
    for (const [file, content] of Object.entries(files)) {
      const path = join(root, file);
      mkdirSync(content === FOLDER ? path : dirname(path), { recursive: true });
      if (content !== FOLDER) writeFileSync(path, content);
    }
    const report = new Report();
    checkShims(root, report);
    return {
      findings: report.findings.map((finding) => `${finding.where}: ${finding.detail}`),
      ids: [...report.ids()].sort(),
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/** What each case gave. */
const actual = (cases: readonly Case[]): Seen[] => cases.map(([name, files]) => ({ name, ...run(files) }));

/** What each case must give: a case with a finding fails with exactly the id of the rule. */
const expected = (cases: readonly Case[]): Seen[] =>
  cases.map(([name, , findings]) => ({ name, findings, ids: findings.length === 0 ? [] : [RULE] }));

const has = (line: string): string => `the kit shim has \`${line}\` here`;
const ENDS = 'the kit shim ends before this line';
const EMPTY = 'the kit shim has an empty line here';
const MISSING = 'the file is missing';
const OTHER_CONFIG = 'remove this file: `astro.config.mjs` is the only Astro config';
const OTHER_BIOME = 'remove this file: `biome.json` in the root is the only Biome config';

const CONFIG_LINE_1 = '// Managed by @raess/astro-kit. Every option lives in astro-kit.json.';
const CONFIG_LINE_5 = 'export default defineConfig({ integrations: [astroKit()] });';

test('the shim texts are those of 12.2', () => {
  assert.deepEqual(Object.keys(SHIMS), ['astro.config.mjs', BIOME, TSCONFIG]);
  assert.equal(CONFIG_FILE, 'astro.config.mjs');

  assert.notEqual(specBlock(CONFIG_FILE, 'js'), '', '12.2 holds the code block of astro.config.mjs');
  assert.equal(SHIMS[CONFIG_FILE], specBlock(CONFIG_FILE, 'js'));
  assert.equal(SHIMS[BIOME], specBlock(BIOME, 'json'));
  assert.equal(SHIMS[TSCONFIG], specBlock(TSCONFIG, 'json'));

  // The format of the two JSON files is the one that Biome gives them under the kit preset.
  assert.equal(
    SHIMS[BIOME],
    [
      '{',
      '  "$schema": "./node_modules/@biomejs/biome/configuration_schema.json",',
      '  "extends": ["@raess/astro-kit/biome.json"]',
      '}',
      '',
    ].join('\n'),
  );
  assert.equal(
    SHIMS[TSCONFIG],
    [
      '{',
      '  "extends": "@raess/astro-kit/tsconfig.json",',
      '  "include": [".astro/types.d.ts", "**/*"],',
      '  "exclude": ["dist", "node_modules"]',
      '}',
      '',
    ].join('\n'),
  );

  assert.deepEqual(
    Object.values(SHIMS).map((text) => normalize(text)),
    Object.values(SHIMS),
    'each shim is in the compared form',
  );
});

test('config-shim is a config rule that no waiver covers', () => {
  const rule = getRule(RULE);
  assert.equal(rule.group, 'config');
  assert.equal(rule.stage, 'config');
  assert.equal(rule.level, 'error');
  assert.equal(rule.waivable, false);
});

test('normalize: CRLF becomes LF, and the text ends with one newline', () => {
  const cases: readonly (readonly [name: string, text: string, normal: string])[] = [
    ['a text in the compared form', 'a\nb\n', 'a\nb\n'],
    ['CRLF line ends', 'a\r\nb\r\n', 'a\nb\n'],
    ['no final newline', 'a\nb', 'a\nb\n'],
    ['blank lines at the end', 'a\nb\n\n\n', 'a\nb\n'],
    ['spaces and tabs at the end', 'a\nb \t\n', 'a\nb\n'],
    ['an empty text', '', '\n'],
    ['only white space', ' \r\n\t\n', '\n'],
    ['white space at the start stays', '\n  a\n', '\n  a\n'],
    ['white space at the end of an inner line stays', 'a \nb\n', 'a \nb\n'],
    ['a blank line inside stays', 'a\n\nb\n', 'a\n\nb\n'],
    ['a CR without LF stays', 'a\rb\n', 'a\rb\n'],
  ];
  assert.deepEqual(
    cases.map(([name, text]) => [name, normalize(text)]),
    cases.map(([name, , normal]) => [name, normal]),
  );
});

test('firstDifference: the first line that differs, with the text of the kit', () => {
  type Row = readonly [name: string, text: string, kit: string, difference: ReturnType<typeof firstDifference>];
  const cases: readonly Row[] = [
    ['equal texts', 'a\nb\n', 'a\nb\n', undefined],
    ['equal after CRLF and trimEnd', 'a\r\nb', 'a\nb\n', undefined],
    ['two empty texts', '', '\n', undefined],
    ['the first line', 'x\nb\n', 'a\nb\n', { line: 1, expected: 'a' }],
    ['the last line', 'a\nx\n', 'a\nb\n', { line: 2, expected: 'b' }],
    ['only the first difference', 'x\ny\n', 'a\nb\n', { line: 1, expected: 'a' }],
    ['a line too many', 'a\nb\nc\n', 'a\nb\n', { line: 3, expected: undefined }],
    ['a line too few', 'a\n', 'a\nb\n', { line: 2, expected: 'b' }],
    ['a blank line too few', 'a\n', 'a\n\nb\n', { line: 2, expected: '' }],
    ['a blank line too many', 'a\n\nb\n', 'a\nb\n', { line: 2, expected: 'b' }],
    ['an empty text', '', 'a\n', { line: 1, expected: 'a' }],
  ];
  assert.deepEqual(
    cases.map(([name, text, kit]) => [name, firstDifference(text, kit)]),
    cases.map(([name, , , difference]) => [name, difference]),
  );
});

test('config-shim: the three shims pass, also with CRLF or without the final newline', () => {
  const each = (change: (text: string) => string): Files =>
    Object.fromEntries(Object.entries(SHIMS).map(([file, text]) => [file, change(text)]));
  const cases: Case[] = [
    ['the three shims', shims, []],
    ['CRLF line ends', each((text) => text.replaceAll('\n', '\r\n')), []],
    ['no final newline', each((text) => text.trimEnd()), []],
    ['CRLF line ends and no final newline', each((text) => text.trimEnd().replaceAll('\n', '\r\n')), []],
    ['blank lines at the end', each((text) => `${text}\n\n`), []],
    ['spaces and a tab at the end', each((text) => `${text.trimEnd()}  \t\n`), []],
    ['one file with CRLF, the others with LF', changed(BIOME, (text) => text.replaceAll('\n', '\r\n')), []],
    [
      'other project files',
      { ...shims, 'package.json': '{}\n', 'astro-kit.json': '{}\n', 'README.md': '# Site\n', 'astro.json': '{}\n' },
      [],
    ],
    ['an Astro config file below the root', { ...shims, 'src/astro.config.ts': 'export default {};\n' }, []],
    ['a file that only starts like the config', { ...shims, 'astro.configuration.ts': 'export default {};\n' }, []],
  ];
  assert.deepEqual(actual(cases), expected(cases));
});

test('config-shim: one changed character fails, at the first line that differs', () => {
  const cases: Case[] = [
    [
      'astro.config.mjs: a double quote',
      changed(CONFIG_FILE, (text) => text.replace("'astro/config'", '"astro/config"')),
      [`astro.config.mjs:3: ${has("import { defineConfig } from 'astro/config';")}`],
    ],
    [
      'astro.config.mjs: an option',
      changed(CONFIG_FILE, (text) => text.replace('astroKit()', 'astroKit({})')),
      [`astro.config.mjs:5: ${has(CONFIG_LINE_5)}`],
    ],
    [
      'astro.config.mjs: a second integration',
      changed(CONFIG_FILE, (text) => text.replace('[astroKit()]', '[astroKit(), other()]')),
      [`astro.config.mjs:5: ${has(CONFIG_LINE_5)}`],
    ],
    [
      'astro.config.mjs: the comment in upper case',
      changed(CONFIG_FILE, (text) => text.replace('// Managed', '// MANAGED')),
      [`astro.config.mjs:1: ${has(CONFIG_LINE_1)}`],
    ],
    [
      'astro.config.mjs: a line after the last one',
      changed(CONFIG_FILE, (text) => `${text}console.log(1);\n`),
      [`astro.config.mjs:6: ${ENDS}`],
    ],
    [
      'astro.config.mjs: a blank line before the first one',
      changed(CONFIG_FILE, (text) => `\n${text}`),
      [`astro.config.mjs:1: ${has(CONFIG_LINE_1)}`],
    ],
    [
      'astro.config.mjs: a byte order mark',
      changed(CONFIG_FILE, (text) => `﻿${text}`),
      [`astro.config.mjs:1: ${has(CONFIG_LINE_1)}`],
    ],
    [
      'astro.config.mjs: a space at the end of an inner line',
      changed(CONFIG_FILE, (text) => text.replace("'astro/config';", "'astro/config'; ")),
      [`astro.config.mjs:3: ${has("import { defineConfig } from 'astro/config';")}`],
    ],
    [
      'astro.config.mjs: a CR without LF',
      changed(CONFIG_FILE, (text) => text.replace('\n\n', '\n\r')),
      [`astro.config.mjs:4: ${EMPTY}`],
    ],
    [
      'astro.config.mjs: without the last line',
      changed(CONFIG_FILE, (text) => text.replace(`${CONFIG_LINE_5}\n`, '')),
      [`astro.config.mjs:4: ${EMPTY}`],
    ],
    ['astro.config.mjs: an empty file', changed(CONFIG_FILE, () => ''), [`astro.config.mjs:1: ${has(CONFIG_LINE_1)}`]],
    [
      'biome.json: another preset',
      changed(BIOME, (text) => text.replace('astro-kit/biome.json', 'astro-kit/biome.jsonc')),
      [`biome.json:3: ${has('  "extends": ["@raess/astro-kit/biome.json"]')}`],
    ],
    [
      'biome.json: one more key',
      changed(BIOME, (text) => text.replace(']\n', '],\n  "linter": { "enabled": false }\n')),
      [`biome.json:3: ${has('  "extends": ["@raess/astro-kit/biome.json"]')}`],
    ],
    [
      'biome.json: on one line',
      changed(BIOME, (text) => `${JSON.stringify(JSON.parse(text))}\n`),
      [`biome.json:1: ${has('{')}`],
    ],
    [
      'biome.json: every list expanded',
      changed(BIOME, (text) => `${JSON.stringify(JSON.parse(text), null, 2)}\n`),
      [`biome.json:3: ${has('  "extends": ["@raess/astro-kit/biome.json"]')}`],
    ],
    [
      'biome.json: tabs',
      changed(BIOME, (text) => text.replaceAll('  ', '\t')),
      [`biome.json:2: ${has('  "$schema": "./node_modules/@biomejs/biome/configuration_schema.json",')}`],
    ],
    [
      'tsconfig.json: a compiler option',
      changed(TSCONFIG, (text) => text.replace('{\n', '{\n  "compilerOptions": { "strict": false },\n')),
      [`tsconfig.json:2: ${has('  "extends": "@raess/astro-kit/tsconfig.json",')}`],
    ],
    [
      'tsconfig.json: one more exclude',
      changed(TSCONFIG, (text) => text.replace('"node_modules"]', '"node_modules", "src"]')),
      [`tsconfig.json:4: ${has('  "exclude": ["dist", "node_modules"]')}`],
    ],
    [
      'tsconfig.json: a comment at the end',
      changed(TSCONFIG, (text) => `${text}// local\n`),
      [`tsconfig.json:6: ${ENDS}`],
    ],
  ];
  assert.deepEqual(actual(cases), expected(cases));
});

test('config-shim: a missing shim fails', () => {
  const cases: Case[] = [
    ['no astro.config.mjs', without(CONFIG_FILE), [`astro.config.mjs: ${MISSING}`]],
    ['no biome.json', without(BIOME), [`biome.json: ${MISSING}`]],
    ['no tsconfig.json', without(TSCONFIG), [`tsconfig.json: ${MISSING}`]],
    ['a folder in place of biome.json', { ...shims, [BIOME]: FOLDER }, ['biome.json: this is not a file']],
    ['an empty root', {}, [`astro.config.mjs: ${MISSING}`, `biome.json: ${MISSING}`, `tsconfig.json: ${MISSING}`]],
    [
      'the config with another extension only',
      { ...without(CONFIG_FILE), 'astro.config.ts': SHIMS[CONFIG_FILE] },
      [`astro.config.mjs: ${MISSING}`, `astro.config.ts: ${OTHER_CONFIG}`],
    ],
  ];
  assert.deepEqual(actual(cases), expected(cases));
});

test('config-shim: any other astro.config.* file in the root fails', () => {
  const other = (name: string): Case => [name, { ...shims, [name]: SHIMS[CONFIG_FILE] }, [`${name}: ${OTHER_CONFIG}`]];
  const cases: Case[] = [
    other('astro.config.ts'),
    other('astro.config.js'),
    other('astro.config.mts'),
    other('astro.config.cjs'),
    other('astro.config.cts'),
    other('astro.config.mjs.bak'),
    other('astro.config.local.mjs'),
    ['a folder with such a name', { ...shims, 'astro.config.d': FOLDER }, [`astro.config.d: ${OTHER_CONFIG}`]],
    [
      'two other files, in the order of their names',
      { ...shims, 'astro.config.ts': '', 'astro.config.js': '' },
      [`astro.config.js: ${OTHER_CONFIG}`, `astro.config.ts: ${OTHER_CONFIG}`],
    ],
  ];
  assert.deepEqual(actual(cases), expected(cases));
});

test('config-shim: the root biome.json is the only Biome config of the project', () => {
  const off = '{ "root": false, "linter": { "enabled": false } }\n';
  const other = (path: string): Case => [path, { ...shims, [path]: off }, [`${path}: ${OTHER_BIOME}`]];
  const none = (path: string): Case => [path, { ...shims, [path]: off }, []];
  const cases: Case[] = [
    other('src/biome.json'),
    other('src/pages/blog/biome.jsonc'),
    other('src/.biome.json'),
    other('public/.biome.jsonc'),
    other('docs/biome.json'),
    other('.github/biome.json'),
    other('biome.jsonc'),
    other('.biome.json'),
    other('.biome.jsonc'),
    // A file system that ignores letter case gives Biome this file as `biome.json`.
    other('src/Biome.json'),
    [
      'a folder with such a name holds one',
      { ...shims, 'src/biome.jsonc/biome.json': off },
      [`src/biome.jsonc/biome.json: ${OTHER_BIOME}`],
    ],
    [
      'three of them, in the order of their paths',
      { ...shims, 'src/b/biome.json': off, 'biome.jsonc': off, 'src/a/biome.jsonc': '' },
      [`biome.jsonc: ${OTHER_BIOME}`, `src/a/biome.jsonc: ${OTHER_BIOME}`, `src/b/biome.json: ${OTHER_BIOME}`],
    ],
    // Biome checks no file in these folders, and a package may ship its own config.
    none('node_modules/pkg/biome.json'),
    none('dist/biome.json'),
    none('.astro/biome.json'),
    none('.wrangler/tmp/biome.jsonc'),
    none('.git/biome.json'),
    none('src/node_modules/pkg/biome.json'),
    // Names that only look alike.
    none('src/biome.json5'),
    none('src/my-biome.json'),
    none('src/biome.config.json'),
  ];
  assert.deepEqual(actual(cases), expected(cases));
  assert.equal(BIOME_FILE, 'biome.json');
  assert.deepEqual(BIOME_CONFIG_NAMES, ['biome.json', 'biome.jsonc', '.biome.json', '.biome.jsonc']);
  const row = SPEC.split('\n').find((line) => line.startsWith(`| \`${RULE}\` |`)) ?? '';
  const names = BIOME_CONFIG_NAMES.map((name) => `\`${name}\``);
  assert.ok(
    row.includes(`no other file named ${names.slice(0, -1).join(', ')} or ${names.at(-1)} exists in any folder`),
  );
  assert.ok(getRule(RULE).standard.includes(`no other file named ${names.slice(0, -1).join(', ')} or ${names.at(-1)}`));
});

test('otherBiomeConfigs does not follow a symbolic link, and a root that is missing has none', () => {
  const root = mkdtempSync(join(tmpdir(), 'astro-kit-'));
  try {
    mkdirSync(join(root, 'site/src'), { recursive: true });
    mkdirSync(join(root, 'away'));
    writeFileSync(join(root, 'away/biome.json'), '{}\n');
    writeFileSync(join(root, 'site/biome.json'), SHIMS[BIOME_FILE]);
    symlinkSync(join(root, 'away'), join(root, 'site/src/away'));
    symlinkSync(join(root, 'away/biome.json'), join(root, 'site/src/biome.jsonc'));
    assert.deepEqual(otherBiomeConfigs(join(root, 'site')), ['src/biome.jsonc']);
    assert.deepEqual(otherBiomeConfigs(join(root, 'none')), []);
    assert.deepEqual(otherBiomeConfigs(join(root, 'site/biome.json')), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('config-shim: one run reports every file', () => {
  const cases: Case[] = [
    [
      'two changed shims, a missing one and another config',
      {
        [CONFIG_FILE]: SHIMS[CONFIG_FILE].replace('astroKit()', 'astroKit({})'),
        [BIOME]: SHIMS[BIOME].replace('"extends"', '"extend"'),
        'astro.config.ts': 'export default {};\n',
        'src/biome.json': '{ "root": false }\n',
      },
      [
        `astro.config.mjs:5: ${has(CONFIG_LINE_5)}`,
        `biome.json:3: ${has('  "extends": ["@raess/astro-kit/biome.json"]')}`,
        `tsconfig.json: ${MISSING}`,
        `astro.config.ts: ${OTHER_CONFIG}`,
        `src/biome.json: ${OTHER_BIOME}`,
      ],
    ],
  ];
  assert.deepEqual(actual(cases), expected(cases));
});

test('config-shim: a root that does not exist gives three findings and does not throw', () => {
  const root = mkdtempSync(join(tmpdir(), 'astro-kit-'));
  try {
    const report = new Report();
    checkShims(join(root, 'none'), report);
    assert.deepEqual(report.findings, [
      { rule: RULE, where: 'astro.config.mjs', detail: MISSING },
      { rule: RULE, where: 'biome.json', detail: MISSING },
      { rule: RULE, where: 'tsconfig.json', detail: MISSING },
    ]);
    assert.deepEqual([...report.ids()].sort(), [RULE]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a finding reads as one line with the fix and the rule', () => {
  const report = new Report();
  report.add(RULE, 'biome.json', MISSING);
  assert.equal(
    report.format(),
    [
      'astro-kit: 1 finding',
      `✗ [config-shim] biome.json: ${getRule(RULE).message} (the file is missing)`,
      `    fix: ${getRule(RULE).hint}`,
      '    rule: node_modules/@raess/astro-kit/docs/standards.md#config-shim',
    ].join('\n'),
  );
});

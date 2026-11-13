import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  findRedirect,
  isDynamic,
  loadRedirects,
  matchesRedirect,
  parseRedirects,
  QUERY_MESSAGE,
  REDIRECT_LIMITS,
  REDIRECT_STATUS,
  REDIRECTS_FILE,
  type RedirectRow,
  redirectLines,
  redirectRowSchema,
  redirectsSchema,
  sourceMatches,
} from '../../src/redirects.ts';
import { getRule, Report } from '../../src/registry.ts';

const RULE = 'routes-redirects';

/** The specification, so that the fixed texts of the test and of the document cannot differ. */
const SPEC = readFileSync(fileURLToPath(new URL('../../docs/spec.md', import.meta.url)), 'utf8');

/** The row of `routes-redirects` in the rule table of section 8. */
const SPEC_ROW = SPEC.split('\n').find((line) => line.startsWith(`| \`${RULE}\` |`)) ?? '';

/** The smallest file that meets the rule and holds both row shapes. */
const moved: RedirectRow = { from: '/alt/', to: '/neu/' };
const removed: RedirectRow = { from: '/weg/', gone: true };

/** One case: a name, the parsed value of `redirects.json`, and every finding as `<where>: <detail>`, in order. */
type Case = readonly [name: string, value: unknown, findings: readonly string[]];

/** What one case gave, or what it must give. */
interface Seen {
  /** Every finding as `<where>: <detail>`, in the order of the report. */
  findings: readonly string[];
  /** The sorted rule ids of the findings that fail. */
  ids: string[];
  /** True when the loader returned the rows. */
  valid: boolean;
  /** True when `redirectsSchema` accepts the value. It must agree with the loader. */
  schemaValid: boolean;
}

interface Outcome {
  name: string;
  actual: Seen;
  expected: Seen;
}

/** Parses the value of each case. The test compares `actual` with `expected`. */
function outcomes(cases: readonly Case[]): Outcome[] {
  return cases.map(([name, value, findings]) => {
    const report = new Report();
    const rows = parseRedirects(value, report);
    const passes = findings.length === 0;
    return {
      name,
      actual: {
        findings: report.findings.map((finding) => `${finding.where}: ${finding.detail}`),
        ids: [...report.ids()].sort(),
        valid: rows !== undefined,
        schemaValid: redirectsSchema.safeParse(value).success,
      },
      expected: { findings, ids: passes ? [] : [RULE], valid: passes, schemaValid: passes },
    };
  });
}

const at = (path: string, detail: string): string => `${REDIRECTS_FILE}: ${path}: ${detail}`;

/** `count` static rows with a `to`. */
const statics = (count: number): RedirectRow[] =>
  Array.from({ length: count }, (_, index) => ({ from: `/alt-${index}/`, to: '/neu/' }));

/** `count` dynamic rows with a `to`. */
const dynamics = (count: number): RedirectRow[] =>
  Array.from({ length: count }, (_, index) => ({ from: `/blog-${index}/*`, to: '/news/:splat' }));

/** `count` gone rows. */
const gones = (count: number): RedirectRow[] =>
  Array.from({ length: count }, (_, index) => ({ from: `/weg-${index}/`, gone: true }));

/** A static row whose `_redirects` line has exactly `length` characters. */
const rowOfLine = (length: number): RedirectRow => ({
  from: `/${'a'.repeat(length - '/ /b 301'.length)}`,
  to: '/b',
});

test('the fixed values are those of the specification', () => {
  assert.equal(REDIRECTS_FILE, 'redirects.json');
  assert.deepEqual(REDIRECT_LIMITS, { staticRules: 2000, dynamicRules: 100, lineChars: 1000 });
  assert.equal(REDIRECT_STATUS, 301);
  assert.equal(QUERY_MESSAGE, 'query strings cannot be matched; mark it gone or add a zone Single Redirect');

  const limits = 'Limits: 2,000 static, 100 dynamic, 1,000 characters per line.';
  assert.ok(SPEC_ROW.includes(`("${QUERY_MESSAGE}")`), 'the rule table quotes the message');
  assert.ok(SPEC_ROW.includes(limits), 'the rule table holds the limits');
  const shape = `Lines are \`\${from} \${to} ${REDIRECT_STATUS}\` from \`${REDIRECTS_FILE}\``;
  assert.ok(SPEC.includes(shape), '6.3 holds the line shape');

  const rule = getRule(RULE);
  assert.equal(rule.stage, 'config + build');
  assert.equal(rule.waivable, false);
  assert.ok(rule.standard.includes(`("${QUERY_MESSAGE}")`));
  assert.ok(rule.standard.includes(limits));
  const target = '`to` starts with `/`, not with `//` or `/\\`, and has no whitespace';
  assert.ok(SPEC_ROW.includes(target), 'the rule table holds the rule on `to`');
  assert.ok(rule.standard.includes(target));
});

test('routes-redirects: rows are {from, to} or {from, gone: true}', () => {
  const list = 'the file must hold a list of rows: {from, to} or {from, gone: true}';
  const cases: Case[] = [
    ['an empty list', [], []],
    ['a moved URL', [moved], []],
    ['a removed URL', [removed], []],
    ['both row shapes', [moved, removed], []],
    ['an object in place of the list', { from: '/alt/', to: '/neu/' }, [`${REDIRECTS_FILE}: ${list}`]],
    ['a text in place of the list', '/alt/ /neu/ 301', [`${REDIRECTS_FILE}: ${list}`]],
    ['null in place of the list', null, [`${REDIRECTS_FILE}: ${list}`]],
    ['a row that is a text', ['/alt/ /neu/'], [at('[0]', 'Invalid input: expected object, received string')]],
    ['a row that is a list', [['/alt/', '/neu/']], [at('[0]', 'Invalid input: expected object, received array')]],
    ['a row without to and gone', [{ from: '/alt/' }], [at('[0]', 'a row needs to or gone: true')]],
    [
      'a row with to and gone',
      [{ from: '/alt/', to: '/neu/', gone: true }],
      [at('[0]', 'a row has to or gone: true, not both')],
    ],
    [
      'gone: false',
      [{ from: '/weg/', gone: false }],
      [at('[0].gone', 'gone must be true; for a moved URL, remove gone and set to')],
    ],
    [
      'gone as a text',
      [{ from: '/weg/', gone: 'true' }],
      [at('[0].gone', 'gone must be true; for a moved URL, remove gone and set to')],
    ],
    ['an unknown key', [{ ...moved, status: 302 }], [at('[0].status', 'unknown key')]],
    ['no from', [{ to: '/neu/' }], [at('[0].from', 'Invalid input: expected string, received undefined')]],
    [
      'from as a number',
      [{ from: 404, gone: true }],
      [at('[0].from', 'Invalid input: expected string, received number')],
    ],
    ['to as null', [{ from: '/alt/', to: null }], [at('[0].to', 'Invalid input: expected string, received null')]],
    ['the finding names the row', [moved, removed, { from: '/x/' }], [at('[2]', 'a row needs to or gone: true')]],
  ];
  for (const { name, actual, expected } of outcomes(cases)) assert.deepEqual(actual, expected, name);
});

test('routes-redirects: from starts with / and has no whitespace and no ?', () => {
  const cases: Case[] = [
    ['a path with a file name', [{ from: '/alt.html', to: '/neu/' }], []],
    ['a splat', [{ from: '/blog/*', to: '/news/:splat' }], []],
    ['a placeholder', [{ from: '/team/:name/', to: '/ueber-uns/' }], []],
    ['a gone from with a fragment sign', [{ from: '/alt/#teil', gone: true }], []],
    ['no leading slash', [{ from: 'alt/', to: '/neu/' }], [at('[0].from', 'from must start with /')]],
    ['an absolute URL', [{ from: 'https://example.ch/alt/', gone: true }], [at('[0].from', 'from must start with /')]],
    ['an empty from', [{ from: '', gone: true }], [at('[0].from', 'from must start with /')]],
    ['a space', [{ from: '/alte seite/', to: '/neu/' }], [at('[0].from', 'from must not hold whitespace')]],
    ['a tab', [{ from: '/alt\t/', gone: true }], [at('[0].from', 'from must not hold whitespace')]],
    ['a line break', [{ from: '/alt/\n', gone: true }], [at('[0].from', 'from must not hold whitespace')]],
    ['a query string', [{ from: '/alt/?id=3', to: '/neu/' }], [at('[0].from', QUERY_MESSAGE)]],
    ['a query string on a gone row', [{ from: '/suche?q=a', gone: true }], [at('[0].from', QUERY_MESSAGE)]],
    [
      'all three at once',
      [{ from: 'alt seite?id=3', gone: true }],
      [
        at('[0].from', 'from must start with /'),
        at('[0].from', 'from must not hold whitespace'),
        at('[0].from', QUERY_MESSAGE),
      ],
    ],
  ];
  for (const { name, actual, expected } of outcomes(cases)) assert.deepEqual(actual, expected, name);
});

test('routes-redirects: no duplicate from', () => {
  const cases: Case[] = [
    ['two sources', [moved, { from: '/alt-2/', to: '/neu/' }], []],
    [
      '/a and /a/ are two sources',
      [
        { from: '/a', to: '/neu/' },
        { from: '/a/', to: '/neu/' },
      ],
      [],
    ],
    ['the same from twice', [moved, { ...moved }], [at('[1].from', 'duplicate from "/alt/", first in [0]')]],
    [
      'a moved and a gone row with one from',
      [moved, removed, { from: '/alt/', gone: true }],
      [at('[2].from', 'duplicate from "/alt/", first in [0]')],
    ],
    [
      'the same from three times',
      [removed, { ...removed }, { ...removed }],
      [at('[1].from', 'duplicate from "/weg/", first in [0]'), at('[2].from', 'duplicate from "/weg/", first in [0]')],
    ],
  ];
  for (const { name, actual, expected } of outcomes(cases)) assert.deepEqual(actual, expected, name);
});

test('routes-redirects: to starts with /, stays on the site and has no whitespace', () => {
  const leaves = 'to must not start with // or /\\: it would leave the site';
  const space = 'to must not hold whitespace';
  const cases: Case[] = [
    ['the home', [{ from: '/alt/', to: '/' }], []],
    ['a to with a query and a fragment', [{ from: '/alt/', to: '/neu/?von=alt#teil' }], []],
    ['a to with a placeholder', [{ from: '/team/:name/', to: '/ueber-uns/:name/' }], []],
    ['no leading slash', [{ from: '/alt/', to: 'neu/' }], [at('[0].to', 'to must start with /')]],
    ['an absolute URL', [{ from: '/alt/', to: 'https://example.ch/neu/' }], [at('[0].to', 'to must start with /')]],
    ['an empty to', [{ from: '/alt/', to: '' }], [at('[0].to', 'to must start with /')]],
    ['a to with two slashes after the start', [{ from: '/alt/', to: '/a//b/' }], []],
    ['a to with a host and no scheme', [{ from: '/alt/', to: '//evil.example/' }], [at('[0].to', leaves)]],
    ['a to with a host and a splat', [{ from: '/alt/*', to: '//evil.example/:splat' }], [at('[0].to', leaves)]],
    ['a to with a backslash after the slash', [{ from: '/alt/', to: '/\\evil.example/' }], [at('[0].to', leaves)]],
    ['a space', [{ from: '/alt/', to: '/neue seite/' }], [at('[0].to', space)]],
    ['a tab', [{ from: '/alt/', to: '/neu/\t302' }], [at('[0].to', space)]],
    [
      'a line break that would add a line to _redirects',
      [{ from: '/alt', to: '/neu/\n/login https://evil.example/ 302\n/x /y/' }],
      [at('[0].to', space)],
    ],
    ['all three at once', [{ from: '/alt/', to: '//evil.example/ 302' }], [at('[0].to', leaves), at('[0].to', space)]],
  ];
  for (const { name, actual, expected } of outcomes(cases)) assert.deepEqual(actual, expected, name);
});

test('routes-redirects: no chains, no to is a from', () => {
  const cases: Case[] = [
    ['two rows with one to', [moved, { from: '/alt-2/', to: '/neu/' }], []],
    ['/neu is not the source /neu/', [moved, { from: '/neu', to: '/ziel/' }], []],
    [
      'a to that is the from of a later row',
      [moved, { from: '/neu/', to: '/ziel/' }],
      [at('[0].to', 'chain: "/neu/" is the from of [1]')],
    ],
    [
      'a to that is the from of an earlier row',
      [{ from: '/neu/', to: '/ziel/' }, moved],
      [at('[1].to', 'chain: "/neu/" is the from of [0]')],
    ],
    [
      'a to that is a gone from',
      [moved, { from: '/neu/', gone: true }],
      [at('[0].to', 'chain: "/neu/" is the from of [1]')],
    ],
    [
      'a row that points at itself',
      [{ from: '/alt/', to: '/alt/' }],
      [at('[0].to', 'chain: "/alt/" is the from of [0]')],
    ],
    [
      'a loop of two rows',
      [
        { from: '/a/', to: '/b/' },
        { from: '/b/', to: '/a/' },
      ],
      [at('[0].to', 'chain: "/b/" is the from of [1]'), at('[1].to', 'chain: "/a/" is the from of [0]')],
    ],
  ];
  for (const { name, actual, expected } of outcomes(cases)) assert.deepEqual(actual, expected, name);
});

test('routes-redirects: at most 2,000 static and 100 dynamic redirects', () => {
  const tooManyStatics = `${REDIRECTS_FILE}: 2001 static redirects; the limit is 2000`;
  const tooManyDynamics = `${REDIRECTS_FILE}: 101 dynamic redirects; the limit is 100`;
  const cases: Case[] = [
    ['2,000 static rows', statics(2000), []],
    ['2,001 static rows', statics(2001), [tooManyStatics]],
    ['100 dynamic rows', dynamics(100), []],
    ['101 dynamic rows', dynamics(101), [tooManyDynamics]],
    ['both limits are separate: 2,000 static and 100 dynamic rows', [...statics(2000), ...dynamics(100)], []],
    ['both limits fail at once', [...dynamics(101), ...statics(2001)], [tooManyStatics, tooManyDynamics]],
    ['a gone row writes no line: 2,000 static and 2,001 gone rows', [...statics(2000), ...gones(2001)], []],
    ['a dynamic gone row writes no line', [...dynamics(100), { from: '/weg/*', gone: true }], []],
    ['a placeholder is dynamic', [...dynamics(100), { from: '/team/:name/', to: '/neu/' }], [tooManyDynamics]],
  ];
  for (const { name, actual, expected } of outcomes(cases)) assert.deepEqual(actual, expected, name);
});

test('routes-redirects: at most 1,000 characters for a line', () => {
  const longFrom = `/${'a'.repeat(2000)}`;
  const cases: Case[] = [
    ['a line of 1,000 characters', [rowOfLine(1000)], []],
    ['a line of 1,001 characters', [rowOfLine(1001)], [at('[0]', 'the line has 1001 characters; the limit is 1000')]],
    [
      'a long to',
      [{ from: '/alt/', to: `/${'b'.repeat(1000)}` }],
      [at('[0]', 'the line has 1011 characters; the limit is 1000')],
    ],
    ['a gone row writes no line', [{ from: longFrom, gone: true }], []],
    [
      'the finding names the row',
      [moved, rowOfLine(1200)],
      [at('[1]', 'the line has 1200 characters; the limit is 1000')],
    ],
  ];
  assert.deepEqual(
    [redirectLines([rowOfLine(1000)])[0]?.length, redirectLines([rowOfLine(1001)])[0]?.length],
    [1000, 1001],
  );
  for (const { name, actual, expected } of outcomes(cases)) assert.deepEqual(actual, expected, name);
});

test('routes-redirects: one run reports every finding of every row', () => {
  const value = [
    { from: '/a/', to: '/b/' },
    { from: 'c d', to: 'e' },
    { from: '/a/', gone: true, note: 'x' },
    { from: '/b/' },
    { from: '/f/?g=1', to: '/a/' },
    7,
  ];
  const report = new Report();
  assert.equal(parseRedirects(value, report), undefined);
  assert.deepEqual(
    report.findings.map((finding) => `${finding.where}: ${finding.detail}`),
    [
      at('[1].from', 'from must start with /'),
      at('[1].from', 'from must not hold whitespace'),
      at('[1].to', 'to must start with /'),
      at('[2].note', 'unknown key'),
      at('[3]', 'a row needs to or gone: true'),
      at('[4].from', QUERY_MESSAGE),
      at('[5]', 'Invalid input: expected object, received number'),
      at('[2].from', 'duplicate from "/a/", first in [0]'),
      at('[0].to', 'chain: "/b/" is the from of [3]'),
      at('[4].to', 'chain: "/a/" is the from of [0]'),
    ],
  );
  assert.deepEqual([...report.ids()].sort(), [RULE]);
  assert.ok(report.findings.every((finding) => finding.rule === RULE));
});

test('the row schema gives one of the two row shapes', () => {
  assert.deepEqual(redirectRowSchema.parse(moved), { from: '/alt/', to: '/neu/' });
  assert.deepEqual(redirectRowSchema.parse(removed), { from: '/weg/', gone: true });
  assert.deepEqual(redirectsSchema.parse([moved, removed]), [moved, removed]);
  assert.equal(redirectRowSchema.safeParse({ from: '/alt/' }).success, false);
});

test('parseRedirects returns the rows, and names another file when it gets one', () => {
  const good = new Report();
  assert.deepEqual(parseRedirects([moved, removed], good), [moved, removed]);
  assert.deepEqual(good.findings, []);
  assert.deepEqual([...good.ids()].sort(), []);

  const other = new Report();
  assert.equal(parseRedirects([{ from: 'alt/', gone: true }], other, 'origin/main:redirects.json'), undefined);
  assert.deepEqual(other.findings, [
    { rule: RULE, where: 'origin/main:redirects.json: [0].from', detail: 'from must start with /' },
  ]);
});

test('loadRedirects reads redirects.json: a missing file, a broken file, a wrong file and a good file', () => {
  const root = mkdtempSync(join(tmpdir(), 'astro-kit-'));
  try {
    const missing = new Report();
    assert.deepEqual(loadRedirects(root, missing), []);
    assert.deepEqual(missing.findings, []);
    assert.deepEqual([...missing.ids()].sort(), []);

    writeFileSync(join(root, REDIRECTS_FILE), '[{ "from": ');
    const broken = new Report();
    assert.equal(loadRedirects(root, broken), undefined);
    assert.deepEqual(
      broken.findings.map((finding) => [finding.rule, finding.where]),
      [[RULE, REDIRECTS_FILE]],
    );
    assert.match(broken.findings[0]?.detail ?? '', /^the file is not valid JSON: /);
    assert.deepEqual([...broken.ids()].sort(), [RULE]);

    writeFileSync(join(root, REDIRECTS_FILE), JSON.stringify([moved, { from: '/alt/?id=3', to: 'neu/' }]));
    const wrong = new Report();
    assert.equal(loadRedirects(root, wrong), undefined);
    assert.deepEqual(wrong.findings, [
      { rule: RULE, where: 'redirects.json: [1].from', detail: QUERY_MESSAGE },
      { rule: RULE, where: 'redirects.json: [1].to', detail: 'to must start with /' },
    ]);
    assert.deepEqual([...wrong.ids()].sort(), [RULE]);

    writeFileSync(join(root, REDIRECTS_FILE), '[]\n');
    const empty = new Report();
    assert.deepEqual(loadRedirects(root, empty), []);
    assert.deepEqual(empty.findings, []);

    writeFileSync(join(root, REDIRECTS_FILE), `${JSON.stringify([moved, removed], null, 2)}\n`);
    const good = new Report();
    assert.deepEqual(loadRedirects(root, good), [moved, removed]);
    assert.deepEqual(good.findings, []);
    assert.deepEqual([...good.ids()].sort(), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a from with * or : is dynamic', () => {
  const cases: [string, boolean][] = [
    ['/alt/', false],
    ['/alt.html', false],
    ['/', false],
    ['/blog/*', true],
    ['/team/:name/', true],
    ['/a:b', true],
    ['/*/:x', true],
  ];
  for (const [from, expected] of cases) assert.equal(isDynamic(from), expected, from);
});

test('redirectLines: static rules first, then dynamic ones, and no line for a gone row', () => {
  const rows: RedirectRow[] = [
    { from: '/blog/*', to: '/news/:splat' },
    { from: '/b/', to: '/neu/' },
    { from: '/weg/', gone: true },
    { from: '/team/:name/', to: '/ueber-uns/' },
    { from: '/a/', to: '/neu/?von=a' },
    { from: '/alt/*', gone: true },
  ];
  assert.deepEqual(redirectLines(rows), [
    '/b/ /neu/ 301',
    '/a/ /neu/?von=a 301',
    '/blog/* /news/:splat 301',
    '/team/:name/ /ueber-uns/ 301',
  ]);
  assert.deepEqual(redirectLines([]), []);
  assert.deepEqual(redirectLines([removed]), []);
  assert.deepEqual(redirectLines([moved]), ['/alt/ /neu/ 301']);
  assert.deepEqual(rows[0], { from: '/blog/*', to: '/news/:splat' }, 'the rows keep their order');
});

test('sourceMatches compares a static from as written and a dynamic from as a pattern', () => {
  const cases: [from: string, path: string, expected: boolean][] = [
    ['/alt/', '/alt/', true],
    ['/alt/', '/alt', false],
    ['/alt/', '/alt/x/', false],
    ['/a.b/', '/a.b/', true],
    ['/blog/*', '/blog/', true],
    ['/blog/*', '/blog/2024/post/', true],
    ['/blog/*', '/blog', false],
    ['/blog/*', '/blogs/', false],
    ['/team/:name/', '/team/anna/', true],
    ['/team/:name/', '/team/anna/bild/', false],
    ['/team/:name/', '/team//', false],
    ['/a.b/*', '/axb/c', false],
    ['/a+b/*', '/a+b/c', true],
    ['/:lang/alt/*', '/fr/alt/x/y', true],
  ];
  for (const [from, path, expected] of cases) assert.equal(sourceMatches(from, path), expected, `${from} ${path}`);
});

test('findRedirect treats /a, /a/ and /a/index.html as one path, and matches the patterns', () => {
  const rows: RedirectRow[] = [
    { from: '/alt/', to: '/neu/' },
    { from: '/weg', gone: true },
    { from: '/datei.pdf', gone: true },
    { from: '/blog/*', to: '/news/:splat' },
    { from: '/team/:name/', to: '/ueber-uns/' },
  ];
  const cases: [path: string, from: string | undefined][] = [
    ['/alt/', '/alt/'],
    ['/alt', '/alt/'],
    ['/alt/index.html', '/alt/'],
    ['/weg', '/weg'],
    ['/weg/', '/weg'],
    ['/weg/index.html', '/weg'],
    ['/datei.pdf', '/datei.pdf'],
    ['/blog/2024/post/', '/blog/*'],
    ['/blog', '/blog/*'],
    ['/team/anna', '/team/:name/'],
    ['/team/anna/index.html', '/team/:name/'],
    ['/', undefined],
    ['/index.html', undefined],
    ['/alt/x/', undefined],
    ['/alter/', undefined],
    ['/team/', undefined],
    ['/neu/', undefined],
  ];
  for (const [path, from] of cases) {
    assert.equal(findRedirect(rows, path)?.from, from, path);
    assert.equal(matchesRedirect(rows, path), from !== undefined, path);
  }
  assert.equal(findRedirect([{ from: '/' }], '/index.html')?.from, '/');
  assert.equal(matchesRedirect([], '/alt/'), false);
});

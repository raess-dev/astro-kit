import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  applyWaivers,
  DOCS_PATH,
  type Finding,
  FindingError,
  failures,
  formatFindings,
  getRule,
  isWaivable,
  Report,
  RULES,
  type Rule,
  type RuleMap,
  r,
  type Waiver,
  waives,
} from '../../src/registry.ts';

/** Three rules for these tests: one that can be waived, one that cannot, and one warning. */
const title = r(
  'head-title',
  'head',
  'build',
  'A title has 15 to 70 code points.',
  'A title is too short or too long.',
  'Write a title of 15 to 70 code points.',
);
const shim = r(
  'config-shim',
  'config',
  'config',
  'A shim equals the kit text.',
  'A shim differs.',
  'Run `npx --no astro-kit init --shims`.',
);
const soon = r(
  'links-depth',
  'links',
  'build',
  'A page is within 3 clicks of its locale home.',
  'A page is too deep. This becomes an error in 0.2.0.',
  'Link the page from a page nearer to the home.',
  'warn',
);
const rules: RuleMap = new Map<string, Rule>([title, shim, soon].map((rule) => [rule.id, rule]));

test('a registry entry has the eight fields of section 8', () => {
  assert.deepEqual(Object.keys(title).sort(), [
    'group',
    'hint',
    'id',
    'level',
    'message',
    'stage',
    'standard',
    'waivable',
  ]);
  assert.equal(title.level, 'error');
  assert.equal(soon.level, 'warn');
});

test('the registry has unique ids, and each rule carries the waivable mark of section 8', () => {
  assert.equal(new Set(RULES.map((rule) => rule.id)).size, RULES.length);
  for (const rule of RULES) assert.equal(rule.waivable, isWaivable(rule.id), rule.id);
});

test('the waivable list covers exact ids and prefixes, and nothing else', () => {
  const cases: [string, boolean][] = [
    ['head-title', true],
    ['budget-head', true],
    ['budget-document', true],
    ['js-budget', true],
    ['a11y-axe', true],
    ['perf-cls', true],
    ['content-language', true],
    ['media-pdf', true],
    ['headings-h1', true],
    ['legal-statement', true],
    ['head-canonical', false],
    ['head-lang', false],
    ['config-shim', false],
    ['legal-approved', false],
    ['origins-gesture', false],
    ['modes-switch', false],
    ['design-tokens', false],
    ['css-literal', false],
    ['js-script', false],
    ['smoke-status', false],
    ['budget', false],
  ];
  for (const [id, expected] of cases) assert.equal(isWaivable(id), expected, id);
});

test('getRule throws on an id that the registry does not have', () => {
  assert.equal(getRule('head-title', rules), title);
  assert.throws(() => getRule('no-such-rule', rules), /unknown rule id no-such-rule/);
});

test('a failing finding prints three lines under the count', () => {
  const findings: Finding[] = [{ rule: 'head-title', where: '/fr/contact/', detail: '12 code points' }];
  assert.equal(
    formatFindings(findings, rules),
    [
      'astro-kit: 1 finding',
      '✗ [head-title] /fr/contact/: A title is too short or too long. (12 code points)',
      '    fix: Write a title of 15 to 70 code points.',
      `    rule: ${DOCS_PATH}#head-title`,
    ].join('\n'),
  );
  assert.equal(DOCS_PATH, 'node_modules/@raess/astro-kit/docs/standards.md');
});

test('a finding without a detail has no parentheses, and two findings read "2 findings"', () => {
  const text = formatFindings(
    [
      { rule: 'config-shim', where: 'biome.json' },
      { rule: 'head-title', where: '/', detail: '3 code points' },
    ],
    rules,
  );
  const lines = text.split('\n');
  assert.equal(lines[0], 'astro-kit: 2 findings');
  assert.equal(lines[1], '✗ [config-shim] biome.json: A shim differs.');
  assert.deepEqual(
    [...text.matchAll(/✗ \[([a-z0-9-]+)\]/g)].map((match) => match[1]),
    ['config-shim', 'head-title'],
  );
});

test('no finding prints that all checks passed', () => {
  assert.equal(formatFindings([], rules), 'astro-kit: all checks passed.');
});

test('a warn finding has "!", is not counted and fails nothing', () => {
  const findings: Finding[] = [{ rule: 'links-depth', where: '/a/b/c/d/' }];
  assert.equal(
    formatFindings(findings, rules),
    [
      '! [links-depth] /a/b/c/d/: A page is too deep. This becomes an error in 0.2.0.',
      '    fix: Link the page from a page nearer to the home.',
      `    rule: ${DOCS_PATH}#links-depth`,
      'astro-kit: all checks passed.',
    ].join('\n'),
  );
  assert.deepEqual(failures(findings, rules), []);
});

test('a waived finding has "~" on one line, is not counted and fails nothing', () => {
  const waiver: Waiver = {
    rule: 'head-title',
    where: '/jobs/',
    reason: 'The client wants this title',
    until: '2026-12-31',
  };
  const findings = applyWaivers([{ rule: 'head-title', where: '/jobs/', detail: '200 code points' }], [waiver], rules);
  assert.equal(
    formatFindings(findings, rules),
    [
      '~ [head-title] /jobs/: A title is too short or too long. (200 code points) (waived until 2026-12-31: The client wants this title)',
      'astro-kit: all checks passed.',
    ].join('\n'),
  );
  assert.deepEqual(failures(findings, rules), []);
});

test('a waived and a warn finding next to a failing one: only the failing one is counted', () => {
  const waiver: Waiver = { rule: 'head-title', where: '/jobs/', reason: 'Agreed with the client', until: '2026-12-31' };
  const findings = applyWaivers(
    [
      { rule: 'head-title', where: '/jobs/' },
      { rule: 'links-depth', where: '/a/b/c/d/' },
      { rule: 'head-title', where: '/kontakt/' },
    ],
    [waiver],
    rules,
  );
  const lines = formatFindings(findings, rules).split('\n');
  assert.equal(lines[0], 'astro-kit: 1 finding');
  assert.equal(lines.filter((line) => line.startsWith('✗ ')).length, 1);
  assert.equal(lines.filter((line) => line.startsWith('! ')).length, 1);
  assert.equal(lines.filter((line) => line.startsWith('~ ')).length, 1);
  assert.equal(lines.at(-1), `    rule: ${DOCS_PATH}#head-title`);
});

test('a waiver covers a place at a boundary only', () => {
  const page: Waiver = { rule: 'head-title', where: '/jobs/', reason: 'r', until: '2026-12-31' };
  const file: Waiver = {
    rule: 'head-title',
    where: 'src/styles/components/card.css',
    reason: 'r',
    until: '2026-12-31',
  };
  const field: Waiver = { rule: 'head-title', where: 'astro-kit.json', reason: 'r', until: '2026-12-31' };
  const folder: Waiver = { rule: 'head-title', where: '/fr', reason: 'r', until: '2026-12-31' };
  const cases: [Waiver, string, boolean][] = [
    [page, '/jobs/', true],
    [page, '/jobs/offene-stellen/', true],
    [page, '/jobs-archiv/', false],
    [page, '/fr/jobs/', false],
    [file, 'src/styles/components/card.css', true],
    [file, 'src/styles/components/card.css:12', true],
    [file, 'src/styles/components/card.css.bak', false],
    [file, 'src/styles/components/cards.css:3', false],
    [field, 'astro-kit.json: forms.contact', true],
    [field, 'astro-kit.json5', false],
    [folder, '/fr/kontakt/', true],
    [folder, '/fr', true],
    [folder, '/fragen/', false],
  ];
  for (const [waiver, where, expected] of cases) {
    assert.equal(waives(waiver, { rule: 'head-title', where }), expected, `${waiver.where} on ${where}`);
  }
  assert.equal(waives(page, { rule: 'head-description', where: '/jobs/' }), false);
});

test('a waiver never covers a rule that is not waivable', () => {
  const waiver: Waiver = { rule: 'config-shim', where: 'biome.json', reason: 'Not allowed', until: '2026-12-31' };
  const findings = applyWaivers([{ rule: 'config-shim', where: 'biome.json' }], [waiver], rules);
  assert.equal(findings[0]?.waived, undefined);
  assert.equal(failures(findings, rules).length, 1);
});

test('a report collects findings, applies waivers and throws once with all failures', () => {
  const report = new Report({
    rules,
    waivers: [{ rule: 'head-title', where: '/jobs/', reason: 'Agreed with the client', until: '2026-12-31' }],
  });
  assert.equal(report.ok, true);
  report.add('head-title', '/jobs/', '200 code points');
  report.add('links-depth', '/a/b/c/d/');
  assert.equal(report.ok, true);
  assert.doesNotThrow(() => report.throwIfFailed());
  assert.match(report.format(), /^~ \[head-title\] \/jobs\//);
  report.add('config-shim', 'biome.json');
  report.add('head-title', '/kontakt/', '3 code points');
  assert.equal(report.ok, false);
  assert.deepEqual([...report.ids()].sort(), ['config-shim', 'head-title']);
  assert.throws(
    () => report.throwIfFailed(),
    (error: unknown) => {
      assert.ok(error instanceof FindingError);
      assert.equal(error.name, 'AstroKitError');
      assert.equal(error.findings.length, 4);
      assert.match(error.message, /^astro-kit: 2 findings\n/);
      return true;
    },
  );
  assert.throws(() => report.add('no-such-rule', '/'), /unknown rule id/);
});

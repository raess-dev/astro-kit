/**
 * The design rules that read the project CSS (specification, 7.4, 7.7, 7.8 and 8): `design-specs` (both halves),
 * `design-pairs` and the built half of `design-tokens`.
 *
 * Each sentence of a rule row has a passing case and a failing case that changes one thing. Each case asserts the
 * exact sorted list of the ids that these rules give. They run through the runners of `src/css/rules.ts`, so the
 * dependency rule of 6.1 applies. The built strings are what Lightning CSS writes with the targets of 6.1 (13.1 item
 * 40). The drift rows 33, 34 and 35 of 14.1 run here; the freedom rows run in `css-rules-coverage.test.ts`.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Design } from '../../src/context.ts';
import {
  type BuiltCssInput,
  ELEMENTS_FILE,
  runBuiltChecks,
  runSourceChecks,
  type SourceCss,
} from '../../src/css/rules.ts';
import { DESIGN_AUDITS, DESIGN_CHECKS } from '../../src/design/rules.ts';
import { Report } from '../../src/registry.ts';
import {
  BUILT_AUTO,
  BUILT_SWITCH,
  built,
  DESIGN_TEXT,
  designOf,
  ELEMENTS_CSS,
  type ProjectFiles,
  pageHtml,
  project,
  SWITCH,
} from './css-rules-fixtures.ts';

// Helpers. None asserts.

/** The report of the source halves: `design-specs` and `design-pairs`. */
function checked(input: SourceCss, only?: string): Report {
  const report = new Report();
  runSourceChecks(
    input,
    only === undefined ? DESIGN_CHECKS : DESIGN_CHECKS.filter((check) => check.id === only),
    report,
  );
  return report;
}

/** The report of the built halves: `design-tokens` and `design-specs`. */
function audited(input: BuiltCssInput, only?: string): Report {
  const report = new Report();
  runBuiltChecks(
    input,
    only === undefined ? DESIGN_AUDITS : DESIGN_AUDITS.filter((check) => check.id === only),
    report,
  );
  return report;
}

const ids = (report: Report): string[] => [...report.ids()].sort();

/** Each finding as `<id> <where> <detail>`, sorted. */
const findings = (report: Report): string[] =>
  report.findings.map((finding) => `${finding.rule} ${finding.where} ${finding.detail ?? ''}`).sort();

/** The line of the first line of a text that holds the needle, from 1. */
const lineOf = (text: string, needle: string): number => text.slice(0, text.indexOf(needle)).split('\n').length;

/** `DESIGN_TEXT` with a `## Elements` or `## Components` table of these rows (`selector | property | token`). */
function withRows(section: 'Elements' | 'Components', rows: readonly string[], text: string = DESIGN_TEXT): string {
  const lines = rows.map((row) => `| ${row} |`).join('\n');
  return `${text}\n## ${section}\n\n| Selector | Property | Token |\n|---|---|---|\n${lines}\n`;
}

/** The design of a text, with the text for `lineOf`. */
function designWith(text: string): { design: Design; text: string } {
  return { design: designOf(text), text };
}

/** `ELEMENTS_CSS` with more rules at the end of its layer block. */
const elementsWith = (extra: string): string => ELEMENTS_CSS.replace(/}\n$/, `\n  ${extra}\n}\n`);

/** The `elements` layer of `BUILT_AUTO`. */
const ELEMENTS_BUILT =
  '@layer elements{body{color:var(--color-text);background-color:var(--color-page)}a{color:var(--color-link)}:focus-visible{outline-color:var(--color-focus)}}';

/** The global chunk with more minified rules at the end of its `elements` layer. */
const globalWith = (extra: string): string =>
  BUILT_AUTO.replace(ELEMENTS_BUILT, ELEMENTS_BUILT.replace(/}$/, `${extra}}`));

/** A built page: the global chunk, then each chunk on a line of its own, in one `<style>`. */
const page = (body: string, chunks: readonly string[] = [], global: string = BUILT_AUTO): string =>
  pageHtml([[global, ...chunks].join('\n')], body);

const CARD_FILE = 'src/styles/components/card.css';

/** A component file with a root rule, a nested part rule and a nested state. */
const CARD_CSS =
  '@layer components {\n  .card {\n    padding: var(--space-2);\n\n    .card__body {\n      gap: var(--space-2);\n    }\n\n    &:hover {\n      color: var(--color-accent);\n    }\n  }\n}\n';

/** `CARD_CSS` as the minifier writes it: the nested part gets `& `. */
const CARD_BUILT =
  '@layer components{.card{padding:var(--space-2);& .card__body{gap:var(--space-2)}&:hover{color:var(--color-accent)}}}';

const CARD_ROWS = [
  '`.card` | `padding` | `--space-2`',
  '`.card .card__body` | `gap` | `--space-2`',
  '`.card:hover` | `color` | `--color-accent`',
];

// The dependency rule (6.1)

test('the design rules run only when design-format passes: without a design none runs', () => {
  const broken = project({ [ELEMENTS_FILE]: null }, { design: null });
  assert.deepEqual(ids(checked(broken)), []);
  assert.deepEqual(ids(audited(built(broken, { 'index.html': pageHtml([]) }))), []);
});

test('the smallest project gives no id of the design rules, with AUTO and with SWITCH', () => {
  const auto = project();
  assert.deepEqual(ids(checked(auto)), []);
  assert.deepEqual(ids(audited(built(auto, { 'index.html': page('') }))), []);
  const modes = project({}, { options: SWITCH });
  assert.deepEqual(ids(checked(modes)), []);
  assert.deepEqual(ids(audited(built(modes, { 'index.html': page('', [], BUILT_SWITCH) }))), []);
});

// design-specs, source half

test('design-specs passes: an Elements row with its rule in elements.css', () => {
  const { design } = designWith(withRows('Elements', ['`body` | `color` | `--color-text`']));
  assert.deepEqual(ids(checked(project({}, { design }))), []);
});

test('design-specs fails drift 34: an Elements row not implemented, at the row', () => {
  const { design, text } = designWith(withRows('Elements', ['`body` | `color` | `--color-link`']));
  const report = checked(project({}, { design }));
  assert.deepEqual(ids(report), ['design-specs']);
  assert.deepEqual(findings(report), [
    `design-specs docs/design.md:${lineOf(text, '| `body` | `color`')} body { color: var(--color-link) }`,
  ]);
});

test('design-specs compares the normalized selector and the property in ASCII lower case', () => {
  const { design } = designWith(
    withRows('Elements', [
      '`input[type=radio]` | `Accent-Color` | `--color-accent`',
      '`:FOCUS-VISIBLE` | `outline-color` | `--color-focus`',
    ]),
  );
  const elements = elementsWith('input[type="radio"] {\n    accent-color: var(--color-accent);\n  }');
  assert.deepEqual(ids(checked(project({ [ELEMENTS_FILE]: elements }, { design }))), []);
});

test('design-specs: a declaration of a rule with another selector does not implement the row', () => {
  const { design } = designWith(withRows('Elements', ['`a` | `color` | `--color-text`']));
  const elements = elementsWith('a:hover {\n    color: var(--color-text);\n  }');
  assert.deepEqual(ids(checked(project({ [ELEMENTS_FILE]: elements }, { design }))), ['design-specs']);
});

test('design-specs: a row whose selector does not parse, whose token is undeclared, or with no component fails', () => {
  const rows = ['`a[` | `color` | `--color-link`', '`a` | `color` | `--color-nope`'];
  const { design, text } = designWith(
    withRows('Components', ['`.box` | `padding` | `--space-2`'], withRows('Elements', rows)),
  );
  const report = checked(project({}, { design }));
  assert.deepEqual(ids(report), ['design-specs']);
  assert.deepEqual(findings(report), [
    `design-specs docs/design.md:${lineOf(text, '| `a[`')} a[ { color: var(--color-link) }: the selector does not parse`,
    `design-specs docs/design.md:${lineOf(text, '| `a` | `color` | `--color-nope`')} a { color: var(--color-nope) }: --color-nope is no token of docs/design.md`,
    `design-specs docs/design.md:${lineOf(text, '| `.box`')} .box { padding: var(--space-2) }: the selector starts at no component root`,
  ]);
});

test('design-specs: a Components row is implemented in the file of its component, nested rules resolved', () => {
  const { design } = designWith(withRows('Components', CARD_ROWS));
  assert.deepEqual(ids(checked(project({ [CARD_FILE]: CARD_CSS }, { design }))), []);
  const other = designOf(withRows('Components', [...CARD_ROWS, '`.card` | `gap` | `--space-2`']));
  assert.deepEqual(ids(checked(project({ [CARD_FILE]: CARD_CSS }, { design: other }))), ['design-specs']);
  const modifier = designOf(withRows('Components', ['`.card--wide` | `padding` | `--space-2`']));
  const wide = '@layer components {\n  .card--wide {\n    padding: var(--space-2);\n  }\n}\n';
  assert.deepEqual(ids(checked(project({ [CARD_FILE]: wide }, { design: modifier }))), []);
});

test('design-specs: a Components row of a component without its file fails at the row', () => {
  const { design, text } = designWith(withRows('Components', ['`.card` | `padding` | `--space-2`']));
  const report = checked(project({ 'src/components/Card.astro': '<div class="card"></div>\n' }, { design }));
  assert.deepEqual(findings(report), [
    `design-specs docs/design.md:${lineOf(text, '| `.card`')} .card { padding: var(--space-2) }`,
  ]);
});

// design-specs, built half

test('design-specs, built half: an Elements row passes on the built elements layer, and fails without its rule', () => {
  const { design } = designWith(withRows('Elements', ['`h1` | `color` | `--color-text`']));
  const source = project({ [ELEMENTS_FILE]: elementsWith('h1 {\n    color: var(--color-text);\n  }') }, { design });
  assert.deepEqual(ids(checked(source)), []);
  const passing = built(source, { 'index.html': page('<h1>A</h1>', [], globalWith('h1{color:var(--color-text)}')) });
  assert.deepEqual(ids(audited(passing)), []);
  const failing = built(source, { 'index.html': page('<h1>A</h1>') });
  const report = audited(failing);
  assert.deepEqual(ids(report), ['design-specs']);
  assert.deepEqual(findings(report), ['design-specs / h1 { color: var(--color-text) }']);
});

test('design-specs, built half: merged selector lists and :first-child, as the minifier writes them', () => {
  const { design } = designWith(
    withRows('Elements', [
      '`h1` | `color` | `--color-text`',
      '`h2` | `color` | `--color-text`',
      '`p:nth-child(1)` | `color` | `--color-text`',
    ]),
  );
  const elements = elementsWith(
    'h1 {\n    color: var(--color-text);\n  }\n\n  h2 {\n    color: var(--color-text);\n  }\n\n  p:nth-child(1) {\n    color: var(--color-text);\n  }',
  );
  const source = project({ [ELEMENTS_FILE]: elements }, { design });
  assert.deepEqual(ids(checked(source)), []);
  const input = built(source, {
    'index.html': page('', [], globalWith('h1,h2,p:first-child{color:var(--color-text)}')),
  });
  assert.deepEqual(ids(audited(input)), []);
});

test('design-specs, built half: a Components row is checked on each page whose components layer holds its root', () => {
  const { design } = designWith(withRows('Components', CARD_ROWS));
  const source = project({ [CARD_FILE]: CARD_CSS }, { design });
  const passing = built(source, { 'index.html': page('<div class="card"></div>', [CARD_BUILT]), '404.html': page('') });
  assert.deepEqual(ids(audited(passing)), []);
  const lost = CARD_BUILT.replace('&:hover{color:var(--color-accent)}', '');
  const failing = built(source, { 'index.html': page('<div class="card"></div>', [lost]), '404.html': page('') });
  assert.deepEqual(findings(audited(failing)), ['design-specs / .card:hover { color: var(--color-accent) }']);
});

test('design-specs, built half: a page without the elements layer is the business of css-layer-order', () => {
  const { design } = designWith(withRows('Elements', ['`body` | `color` | `--color-text`']));
  const input = built(project({}, { design }), { 'index.html': pageHtml([], '<p>Text</p>') });
  assert.deepEqual(ids(audited(input, 'design-specs')), []);
});

test('design-specs, built half: a row with a problem reports only in the source half', () => {
  const { design } = designWith(withRows('Elements', ['`a[` | `color` | `--color-link`']));
  const source = project({}, { design });
  assert.deepEqual(ids(checked(source)), ['design-specs']);
  assert.deepEqual(ids(audited(built(source, { 'index.html': page('') }))), []);
});

// design-tokens, built half

/** `BUILT_AUTO` with its `tokens` rule changed: the minifier's form of the rendering. */
const tokensBuilt = (from: string, to: string): string => BUILT_AUTO.replace(from, to);

test('design-tokens fails drift 33: a custom property in the built tokens layer that design.md does not hold', () => {
  const css = tokensBuilt('--stack-gap:var(--space-2)}', '--stack-gap:var(--space-2);--brand:#c00}');
  const report = audited(built(project(), { 'index.html': pageHtml([css]), 'zimmer/index.html': pageHtml([css]) }));
  assert.deepEqual(ids(report), ['design-tokens']);
  assert.deepEqual(findings(report), ['design-tokens / extra --brand', 'design-tokens /zimmer/ extra --brand']);
});

test('design-tokens, built half: a name of design.md missing from the tokens layer fails, names only', () => {
  const missing = tokensBuilt('--line-1:.0625rem;', '');
  assert.deepEqual(findings(audited(built(project(), { 'index.html': pageHtml([missing]) }))), [
    'design-tokens / missing --line-1',
  ]);
  const value = tokensBuilt('--line-1:.0625rem;', '--line-1:1px;');
  assert.deepEqual(ids(audited(built(project(), { 'index.html': pageHtml([value]) }))), []);
});

test('design-tokens, built half: a page with no tokens declaration gives one finding; other layers do not count', () => {
  assert.deepEqual(findings(audited(built(project(), { 'index.html': pageHtml([]) }))), [
    'design-tokens / @layer tokens',
  ]);
  const local = page('<div class="card"></div>', [
    '@layer components{.card{--card-pad:var(--space-2);padding:var(--card-pad)}}',
  ]);
  assert.deepEqual(ids(audited(built(project(), { 'index.html': local }), 'design-tokens')), []);
});

// design-pairs

/** The pairs table of `DESIGN_TEXT` with one row replaced (or removed with ''). */
const pairsWith = (row: string, replacement: string): string => {
  if (!DESIGN_TEXT.includes(row)) throw new Error(`no pair row ${row}`);
  return DESIGN_TEXT.replace(row, replacement);
};

const PAIR = {
  accent: '| `--color-accent` | `--color-page` | ui | Accent text |\n',
  body: '| `--color-text` | `--color-page` | text | body |\n',
  link: '| `--color-link` | `--color-page` | ui | link |\n',
  error: '| `--color-error` | `--color-page` | ui | error |\n',
  focusPage: '| `--color-focus` | `--color-page` | non-text | focus |\n',
  focusA: '| `--color-focus` | `--color-a` | non-text | focus |\n',
} as const;

/** A component file with one rule `.card { … }` of these declarations. */
const card = (declarations: string): string => `@layer components {\n  .card {\n    ${declarations}\n  }\n}\n`;

test('design-pairs (a): each pair names two color tokens of ## Color and a known role, else a finding at the pair', () => {
  const token = pairsWith(PAIR.accent, '| `--color-nope` | `--color-page` | ui | Accent text |\n');
  const report = checked(project({}, { design: designOf(token) }), 'design-pairs');
  assert.deepEqual(ids(report), ['design-pairs']);
  assert.deepEqual(findings(report), [
    `design-pairs docs/design.md:${lineOf(token, '| `--color-nope`')} --color-nope is no color token`,
  ]);
  const role = pairsWith(PAIR.accent, '| `--color-accent` | `--color-page` | big | Accent text |\n');
  assert.deepEqual(findings(checked(project({}, { design: designOf(role) }), 'design-pairs')), [
    `design-pairs docs/design.md:${lineOf(role, '| big |')} big is no role`,
  ]);
});

test('design-pairs (b): the mandatory body, link and error pairs exist, with their roles, on the page background', () => {
  const noError = pairsWith(PAIR.error, '');
  assert.deepEqual(findings(checked(project({}, { design: designOf(noError) }), 'design-pairs')), [
    'design-pairs docs/design.md error',
  ]);
  const bodyRole = pairsWith(PAIR.body, '| `--color-text` | `--color-page` | ui | body |\n');
  assert.deepEqual(findings(checked(project({}, { design: designOf(bodyRole) }), 'design-pairs')), [
    'design-pairs docs/design.md body',
  ]);
  const linkOnA = pairsWith(PAIR.link, '| `--color-link` | `--color-a` | ui | link |\n');
  assert.deepEqual(findings(checked(project({}, { design: designOf(linkOnA) }), 'design-pairs')), [
    'design-pairs docs/design.md link',
  ]);
});

test('design-pairs (c): a focus pair on the body background and on each background that project CSS uses', () => {
  const files: ProjectFiles = { [CARD_FILE]: card('background-color: var(--color-a);') };
  assert.deepEqual(ids(checked(project(files), 'design-pairs')), []);
  const noFocusA = pairsWith(PAIR.focusA, '');
  assert.deepEqual(findings(checked(project(files, { design: designOf(noFocusA) }), 'design-pairs')), [
    'design-pairs docs/design.md focus on --color-a',
  ]);
  assert.deepEqual(ids(checked(project({}, { design: designOf(noFocusA) }), 'design-pairs')), []);
  const noFocusPage = pairsWith(PAIR.focusPage, '');
  assert.deepEqual(findings(checked(project({}, { design: designOf(noFocusPage) }), 'design-pairs')), [
    'design-pairs docs/design.md focus on --color-page',
  ]);
});

test('design-pairs (c), freedom 5: the colors of a used gradient count as backgrounds and need focus pairs', () => {
  const files: ProjectFiles = { [CARD_FILE]: card('background-image: var(--gradient-hero);') };
  assert.deepEqual(ids(checked(project(files), 'design-pairs')), []);
  const noFocusA = pairsWith(PAIR.focusA, '');
  assert.deepEqual(findings(checked(project(files, { design: designOf(noFocusA) }), 'design-pairs')), [
    'design-pairs docs/design.md focus on --color-a',
  ]);
});

test('design-pairs (d): elements.css sets the body pair on body, the link color on a, the focus color on :focus-visible', () => {
  const body = ELEMENTS_CSS.replace('color: var(--color-text);', 'color: var(--color-link);');
  assert.deepEqual(findings(checked(project({ [ELEMENTS_FILE]: body }), 'design-pairs')), [
    'design-pairs src/styles/elements.css body',
  ]);
  const link = ELEMENTS_CSS.replace('a {\n    color: var(--color-link);', 'a {\n    color: var(--color-text);');
  assert.deepEqual(findings(checked(project({ [ELEMENTS_FILE]: link }), 'design-pairs')), [
    'design-pairs src/styles/elements.css a',
  ]);
  const focus = ELEMENTS_CSS.replace('outline-color: var(--color-focus);', 'outline-color: var(--color-link);');
  assert.deepEqual(findings(checked(project({ [ELEMENTS_FILE]: focus }), 'design-pairs')), [
    'design-pairs src/styles/elements.css :focus-visible',
  ]);
  assert.deepEqual(findings(checked(project({ [ELEMENTS_FILE]: null }), 'design-pairs')), [
    'design-pairs src/styles/elements.css :focus-visible',
    'design-pairs src/styles/elements.css a',
    'design-pairs src/styles/elements.css body',
  ]);
});

test('design-pairs (e), drift 35: a background color not in a pair, at the var()', () => {
  const report = checked(project({ [CARD_FILE]: card('background-color: var(--color-error);') }), 'design-pairs');
  assert.deepEqual(ids(report), ['design-pairs']);
  assert.deepEqual(findings(report), ['design-pairs src/styles/components/card.css:3 --color-error as background']);
});

test('design-pairs (e): a foreground color not in a pair, also in a shorthand and through a local', () => {
  const border = checked(
    project({ [CARD_FILE]: card('border: var(--line-1) solid var(--color-page);') }),
    'design-pairs',
  );
  assert.deepEqual(findings(border), ['design-pairs src/styles/components/card.css:3 --color-page as foreground']);
  const local = card('--card-fill: var(--color-error);\n    background-color: var(--card-fill);');
  assert.deepEqual(findings(checked(project({ [CARD_FILE]: local }), 'design-pairs')), [
    'design-pairs src/styles/components/card.css:4 --color-error as background',
  ]);
  const paired = card(
    '--card-fill: var(--color-a);\n    background-color: var(--card-fill);\n    color: var(--color-text);',
  );
  assert.deepEqual(ids(checked(project({ [CARD_FILE]: paired }), 'design-pairs')), []);
});

test('design-pairs (e): the colors of a used gradient must be backgrounds of a pair; an unused gradient needs none', () => {
  const text = DESIGN_TEXT.replace('var(--color-a) 0%', 'var(--color-accent) 0%');
  const design = designOf(text);
  const used = checked(
    project({ [CARD_FILE]: card('background-image: var(--gradient-hero);') }, { design }),
    'design-pairs',
  );
  assert.deepEqual(findings(used), ['design-pairs src/styles/components/card.css:3 --color-accent as background']);
  assert.deepEqual(ids(checked(project({}, { design }), 'design-pairs')), []);
});

test('design-pairs (e): a shadow token, a property with no color position and a page file give nothing', () => {
  const files: ProjectFiles = {
    [CARD_FILE]: card(
      'box-shadow: var(--shadow-card);\n    stroke-width: var(--line-1);\n    accent-color: var(--color-page);',
    ),
    'src/styles/pages/index.css': '@layer page {\n  .card {\n    color: var(--color-page);\n  }\n}\n',
  };
  assert.deepEqual(ids(checked(project(files), 'design-pairs')), []);
});

// The review of part 5a: each case fails without its fix

test('design-pairs (c): a gradient that is an alias has the colors of the gradient it names', () => {
  const alias = '| `--gradient-alias` | `var(--gradient-hero)` | The hero again. |\n';
  const text = pairsWith(PAIR.focusA, '').replace('| `--gradient-hero` |', `${alias}| \`--gradient-hero\` |`);
  const files: ProjectFiles = { [CARD_FILE]: card('background-image: var(--gradient-alias);') };
  assert.deepEqual(findings(checked(project(files, { design: designOf(text) }), 'design-pairs')), [
    'design-pairs docs/design.md focus on --color-a',
  ]);
  const paired = DESIGN_TEXT.replace('| `--gradient-hero` |', `${alias}| \`--gradient-hero\` |`);
  assert.deepEqual(ids(checked(project(files, { design: designOf(paired) }), 'design-pairs')), []);
});

test('design-pairs (c): the focus pairs on a used background have the focus color that :focus-visible sets', () => {
  const text = pairsWith(PAIR.focusA, '| `--color-text` | `--color-a` | non-text | focus |\n');
  const files: ProjectFiles = { [CARD_FILE]: card('background-color: var(--color-a);\n    color: var(--color-text);') };
  assert.deepEqual(findings(checked(project(files, { design: designOf(text) }), 'design-pairs')), [
    'design-pairs docs/design.md focus on --color-a',
  ]);
  assert.deepEqual(ids(checked(project(files), 'design-pairs')), []);
});

test('design-pairs (d): the body rule sets the background of the body pair too', () => {
  const other = ELEMENTS_CSS.replace('background-color: var(--color-page);', 'background-color: var(--color-a);');
  assert.deepEqual(findings(checked(project({ [ELEMENTS_FILE]: other }), 'design-pairs')), [
    'design-pairs src/styles/elements.css body',
  ]);
  const none = ELEMENTS_CSS.replace('    background-color: var(--color-page);\n', '');
  assert.deepEqual(findings(checked(project({ [ELEMENTS_FILE]: none }), 'design-pairs')), [
    'design-pairs src/styles/elements.css body',
  ]);
});

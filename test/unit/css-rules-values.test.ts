/**
 * The value rules of the css group and `modes-media` (specification, 7.3, 7.4, 7.5, 7.8, 7.10, 7.12, 8 and 14.1):
 * `css-literal`, `css-token-family`, `css-local-var`, `css-var-undefined`, `css-media` and `modes-media`.
 *
 * Each sentence of a rule row has a passing case and a failing case that changes one thing, for the source half and
 * for the built half. Each case asserts the exact sorted list of the ids that these six rules give. The rules run
 * through the runners of `src/css/rules.ts`, so the dependency rule and the settings rule of 6.1 apply. The built
 * strings are what Lightning CSS writes with the targets of 6.1 (13.1 item 40).
 *
 * The drift rows and the freedom rows of 14.1 run here too: each drift row gives exactly the ids of this group that
 * the row names, and no other drift row and no freedom row gives an id of this group.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Design } from '../../src/context.ts';
import {
  type BuiltCssInput,
  CSS_AUDITS,
  CSS_CHECKS,
  runBuiltChecks,
  runSourceChecks,
  type SourceCss,
} from '../../src/css/rules.ts';
import { renderTokens, TOKENS_FILE } from '../../src/design/tokens.ts';
import type { Options } from '../../src/options.ts';
import { Report } from '../../src/registry.ts';
import {
  BUILT_AUTO,
  BUILT_SWITCH,
  built,
  DESIGN,
  DESIGN_TEXT,
  designOf,
  ELEMENTS_CSS,
  type ProjectFiles,
  pageHtml,
  project,
  SWITCH,
} from './css-rules-fixtures.ts';

// Helpers. None asserts.

/** The rules of this group. */
const VALUE_RULES: ReadonlySet<string> = new Set([
  'css-literal',
  'css-token-family',
  'css-local-var',
  'css-var-undefined',
  'css-media',
  'modes-media',
]);

const CHECKS = CSS_CHECKS.filter((check) => VALUE_RULES.has(check.id));
const AUDITS = CSS_AUDITS.filter((check) => VALUE_RULES.has(check.id));

/** The report of the source halves of this group. */
function checked(input: SourceCss): Report {
  const report = new Report();
  runSourceChecks(input, CHECKS, report);
  return report;
}

/** The report of the built halves of this group. */
function audited(input: BuiltCssInput): Report {
  const report = new Report();
  runBuiltChecks(input, AUDITS, report);
  return report;
}

/** The sorted ids of a report. */
const ids = (report: Report): string[] => [...report.ids()].sort();

/** Each finding as `<id> <where>`, sorted. */
const wheres = (report: Report): string[] => report.findings.map((each) => `${each.rule} ${each.where}`).sort();

/** The details of the findings, sorted. */
const details = (report: Report): string[] => report.findings.map((each) => each.detail ?? '').sort();

/** A component file `src/styles/components/<name>.css` with the rules inside its layer block. */
const component = (name: string, css: string): ProjectFiles => ({
  [`src/styles/components/${name}.css`]: `@layer components {\n${css}\n}\n`,
});

/** `elements.css` of the fixtures with more rules in its layer block. */
const elements = (css: string): ProjectFiles => ({
  'src/styles/elements.css': `${ELEMENTS_CSS.slice(0, -2)}${css}\n}\n`,
});

/** A page file `src/styles/pages/<route>.css` with the rules inside its layer block. */
const pageFile = (route: string, css: string): ProjectFiles => ({
  [`src/styles/pages/${route}.css`]: `@layer page {\n${css}\n}\n`,
});

/** The card component file with a root rule that needs no other rule. */
const CARD = component('card', '.card { padding: var(--space-2); }');

/** A client directory with one page: the global chunk, a line feed, then the minified chunks (7.2). */
const site = (chunk: string, body = ''): Record<string, string> => ({
  'index.html': pageHtml([chunk === '' ? BUILT_AUTO : `${BUILT_AUTO}\n${chunk}`], body),
});

/** The same with the global chunk of `SWITCH`. */
const switchSite = (chunk: string, body = ''): Record<string, string> => ({
  'index.html': pageHtml([chunk === '' ? BUILT_SWITCH : `${BUILT_SWITCH}\n${chunk}`], body),
});

/** One case: project files, settings, and the ids of this group. */
interface SourceCase {
  name: string;
  files: ProjectFiles;
  settings?: { design?: Design | null; options?: Options | null };
  expected: readonly string[];
}

/** One built case: the project files of the source input, the client directory, and the ids of this group. */
interface BuiltCase extends SourceCase {
  dist: Readonly<Record<string, string>>;
}

/** A design with one more shadow, with a spread distance: four lengths. */
const SPREAD = designOf(
  DESIGN_TEXT.replace(
    '| `--shadow-inset` |',
    '| `--shadow-spread` | `0 0 0.25rem 0.125rem var(--color-shadow)` | A glow. |\n| `--shadow-inset` |',
  ),
);

/** A design without the helper parameter `--stack-gap` (drift 10). */
const NO_STACK_GAP = designOf(DESIGN_TEXT.replace('| `--stack-gap` | `var(--space-2)` | The gap of a stack. |\n', ''));

/** A design with one `## Elements` row that no rule implements (drift 34). */
const WITH_ELEMENTS_ROW = designOf(
  DESIGN_TEXT.replace(
    '## Contrast pairs',
    '## Elements\n\n| Selector | Property | Token |\n|---|---|---|\n| `h1` | `color` | `--color-text` |\n\n## Contrast pairs',
  ),
);

// The smallest inputs

test('the smallest project gives no id of this group, with AUTO and with SWITCH (tokens.css is exempt)', () => {
  assert.deepEqual(ids(checked(project())), []);
  assert.deepEqual(ids(checked(project({}, { options: SWITCH }))), []);
  assert.deepEqual(ids(audited(built(project(), site('')))), []);
  assert.deepEqual(ids(audited(built(project({}, { options: SWITCH }), switchSite('')))), []);
});

test('the kit layers of the global chunk are exempt: reset literals, layout parameters, reset [data-mode]', () => {
  // BUILT_AUTO holds `1px` and `!important` in `reset`, `var(--cluster-gap)` (not declared) in `layout`, and
  // `:root:not([data-mode])` in `reset`. None of them is a finding of this group.
  const input = built(project(), site(''));
  assert.ok(BUILT_AUTO.includes('inline-size:1px') && BUILT_AUTO.includes('var(--cluster-gap)'));
  assert.deepEqual(ids(audited(input)), []);
});

// css-literal (7.3)

const LITERAL_SOURCE: readonly SourceCase[] = [
  {
    name: 'tokens and allowlisted literals pass',
    files: component('card', '.card { color: var(--color-text); padding: var(--space-2); rotate: 180deg; order: 2; }'),
    expected: [],
  },
  { name: 'drift 1: a hex color', files: component('card', '.card { color: #c00; }'), expected: ['css-literal'] },
  { name: 'drift 2: a length', files: component('card', '.card { padding: 13px; }'), expected: ['css-literal'] },
  { name: 'drift 3: a named color', files: component('card', '.card { color: red; }'), expected: ['css-literal'] },
  {
    name: 'a color name on a property that takes no color is a keyword',
    files: component('card', '.card { animation-name: red; }'),
    expected: [],
  },
  {
    name: 'drift 4: a var() fallback',
    files: component('card', '.card { margin: var(--space-2, 1rem); }'),
    expected: ['css-literal'],
  },
  {
    name: 'drift 5: a custom property in elements.css',
    files: elements(':root { --brand: var(--color-a); }'),
    expected: ['css-literal'],
  },
  {
    name: 'a custom property in a component file that is no local',
    files: component('card', '.card { --brand: var(--color-a); }'),
    expected: ['css-literal'],
  },
  {
    name: 'a helper parameter re-set on the root is css-local-var’s',
    files: component('card', '.card { --stack-gap: var(--space-4); }'),
    expected: [],
  },
  {
    name: 'a helper parameter set off the root',
    files: component('card', '.card .card__body { --stack-gap: var(--space-4); }'),
    expected: ['css-literal'],
  },
  {
    name: 'a local is css-local-var’s, its value is not scanned',
    files: component('card', '.card { --card-pad: 1rem; padding: var(--card-pad); }'),
    expected: ['css-local-var'],
  },
  {
    name: 'a local defined in elements.css is css-local-var’s',
    files: { ...CARD, ...elements(':root { --card-pad: var(--space-2); }') },
    expected: ['css-local-var'],
  },
  {
    name: 'a system color inside @media (forced-colors: active)',
    files: elements('@media (forced-colors: active) { a { color: Canvas; } }'),
    expected: [],
  },
  {
    name: 'a system color outside forced colors',
    files: elements('a:hover { color: Canvas; }'),
    expected: ['css-literal'],
  },
  {
    name: 'a placement declaration of a page file is read',
    files: pageFile('index', '.card { gap: 13px; }'),
    expected: ['css-literal'],
  },
  {
    name: 'a non-placement declaration of a page file is css-page’s',
    files: pageFile('index', '.card { color: red; }'),
    expected: [],
  },
  {
    name: 'fonts.css and its @font-face rules are exempt',
    files: {
      'src/styles/fonts.css': '@font-face {\n  font-family: Body;\n  src: url(a.woff2);\n  font-weight: 400;\n}\n',
    },
    expected: [],
  },
  {
    name: '@font-face in elements.css is exempt',
    files: elements('@font-face { font-family: Body; font-weight: 400; }'),
    expected: [],
  },
  {
    name: 'a source value in the minifier’s form is no allowed source value',
    files: component('card', '.card { opacity: 1; }'),
    expected: ['css-literal'],
  },
  {
    name: 'the allowed values that the minifier rewrites',
    files: component('card', '.card { opacity: 100%; background-color: transparent; font-weight: bold; }'),
    expected: [],
  },
];

test('css-literal, source half: each sentence passes and fails', () => {
  for (const { name, files, expected } of LITERAL_SOURCE)
    assert.deepEqual(ids(checked(project(files))), expected, name);
});

test('css-literal drift 4: a fallback with a literal gives exactly one finding, at the var()', () => {
  const report = checked(project(component('card', '.card {\n  margin: var(--space-2,\n    1rem);\n}')));
  assert.deepEqual(wheres(report), ['css-literal src/styles/components/card.css:3']);
  assert.deepEqual(details(report), ['margin: var(--space-2, 1rem)']);
});

test('css-literal reports one finding for each line of a declaration, at the file and line', () => {
  const report = checked(project(component('card', '.card {\n  padding: 13px 7px;\n  color: #c00;\n}')));
  assert.deepEqual(wheres(report), [
    'css-literal src/styles/components/card.css:3',
    'css-literal src/styles/components/card.css:4',
  ]);
  const lines = checked(project(component('card', '.card {\n  padding:\n    13px\n    7px;\n}')));
  assert.deepEqual(wheres(lines), [
    'css-literal src/styles/components/card.css:4',
    'css-literal src/styles/components/card.css:5',
  ]);
});

const LITERAL_BUILT: readonly BuiltCase[] = [
  {
    name: 'tokens pass',
    files: CARD,
    dist: site('@layer components{.card{color:var(--color-text);padding:var(--space-2)}}'),
    expected: [],
  },
  { name: 'drift 1', files: CARD, dist: site('@layer components{.card{color:#c00}}'), expected: ['css-literal'] },
  { name: 'drift 2', files: CARD, dist: site('@layer components{.card{padding:13px}}'), expected: ['css-literal'] },
  { name: 'drift 3', files: CARD, dist: site('@layer components{.card{color:red}}'), expected: ['css-literal'] },
  {
    name: 'drift 4',
    files: CARD,
    dist: site('@layer components{.card{margin:var(--space-2,1rem)}}'),
    expected: ['css-literal'],
  },
  {
    name: 'drift 5',
    files: CARD,
    dist: site('@layer elements{:root{--brand:var(--color-a)}}'),
    expected: ['css-literal'],
  },
  {
    name: 'the minifier’s forms of allowed values',
    files: CARD,
    dist: site(
      '@layer components{.card{opacity:1;background-color:#0000;font-weight:700}@media (forced-colors:active){.card{color:canvastext}}}',
    ),
    expected: [],
  },
  {
    name: 'a helper parameter re-set on the root',
    files: CARD,
    dist: site('@layer components{.card{--stack-gap:var(--space-4)}}'),
    expected: [],
  },
  {
    name: 'a custom property on a component root that is no local',
    files: CARD,
    dist: site('@layer components{.card{--brand:var(--color-a)}}'),
    expected: ['css-literal'],
  },
  {
    name: 'a page-layer placement declaration',
    files: CARD,
    dist: site('@layer page{.card{gap:13px}}'),
    expected: ['css-literal'],
  },
  {
    name: 'a page-layer declaration that css-page owns',
    files: CARD,
    dist: site('@layer page{.card{color:red}}'),
    expected: [],
  },
];

test('css-literal, built half: each sentence passes and fails on the minifier’s output', () => {
  for (const { name, files, dist, expected } of LITERAL_BUILT) {
    assert.deepEqual(ids(audited(built(project(files), dist))), expected, name);
  }
});

test('css-literal, built half: a finding stands at the page path, once for each page that holds the sheet', () => {
  const chunk = '@layer components{.card{color:#c00}}';
  const input = built(project(CARD), {
    'index.html': pageHtml([`${BUILT_AUTO}\n${chunk}`]),
    'zimmer/index.html': pageHtml([`${BUILT_AUTO}\n${chunk}`]),
    '404.html': pageHtml([BUILT_AUTO]),
  });
  const report = audited(input);
  assert.deepEqual(wheres(report), ['css-literal /', 'css-literal /zimmer/']);
  assert.deepEqual(details(report), ['color: #c00 in .card', 'color: #c00 in .card']);
});

// css-token-family (7.3, 7.4)

const FAMILY_SOURCE: readonly SourceCase[] = [
  {
    name: 'tokens of the families that the properties accept',
    files: component('card', '.card { padding: var(--space-2); color: var(--color-text); }'),
    expected: [],
  },
  {
    name: 'drift 6: a color token on padding',
    files: component('card', '.card { padding: var(--color-accent); }'),
    expected: ['css-token-family'],
  },
  {
    name: 'a local takes the family of its token: passes',
    files: component('card', '.card { --card-gap: var(--space-2); gap: var(--card-gap); }'),
    expected: [],
  },
  {
    name: 'a local takes the family of its token: fails',
    files: component('card', '.card { --card-gap: var(--color-text); gap: var(--card-gap); }'),
    expected: ['css-token-family'],
  },
  {
    name: 'a local read in another component is no local in scope: no family, the other two rules',
    files: {
      ...component('card', '.card { --card-gap: var(--color-text); color: var(--card-gap); }'),
      ...component('hero', '.hero { gap: var(--card-gap); }'),
    },
    expected: ['css-local-var', 'css-var-undefined'],
  },
  {
    name: 'a helper parameter has its family: passes',
    files: component('card', '.card { gap: var(--stack-gap); }'),
    expected: [],
  },
  {
    name: 'a helper parameter has its family: fails',
    files: component('card', '.card { color: var(--stack-gap); }'),
    expected: ['css-token-family'],
  },
  {
    name: 'an undeclared name is css-var-undefined’s alone',
    files: component('card', '.card { padding: var(--color-nope); }'),
    expected: ['css-var-undefined'],
  },
  {
    name: 'limit 1: a --space- percentage in scroll-margin',
    files: component('card', '.card { scroll-margin-top: var(--space-fluid); }'),
    expected: ['css-token-family'],
  },
  {
    name: 'limit 1: a --space- length in scroll-margin',
    files: component('card', '.card { scroll-margin-top: var(--space-2); scroll-margin: var(--space-4); }'),
    expected: [],
  },
  {
    name: 'limit 1: a --space- percentage elsewhere',
    files: component('card', '.card { padding: var(--space-fluid); }'),
    expected: [],
  },
  {
    name: 'limit 2: an inset shadow in text-shadow',
    files: component('card', '.card { text-shadow: var(--shadow-inset); }'),
    expected: ['css-token-family'],
  },
  {
    name: 'limit 2: an inset shadow in box-shadow',
    files: component('card', '.card { box-shadow: var(--shadow-inset); }'),
    expected: [],
  },
  {
    name: 'limit 2: three lengths in text-shadow',
    files: component('card', '.card { text-shadow: var(--shadow-card); }'),
    expected: [],
  },
  {
    name: 'limit 3: a --size- percentage in contain-intrinsic-size',
    files: component('card', '.card { contain-intrinsic-size: var(--size-half); }'),
    expected: ['css-token-family'],
  },
  {
    name: 'limit 3: a --size- percentage in a longhand',
    files: component('card', '.card { contain-intrinsic-block-size: var(--size-half); }'),
    expected: ['css-token-family'],
  },
  {
    name: 'limit 3: a --size- length in contain-intrinsic-size, a percentage in width',
    files: component('card', '.card { contain-intrinsic-size: var(--size-content); width: var(--size-half); }'),
    expected: [],
  },
  {
    name: 'limit 4: a length in aspect-ratio',
    files: component('card', '.card { aspect-ratio: var(--size-content); }'),
    expected: ['css-token-family'],
  },
  {
    name: 'limit 4: a ratio in width',
    files: component('card', '.card { width: var(--size-wide); }'),
    expected: ['css-token-family'],
  },
  {
    name: 'limit 4: a ratio in a math function of width',
    files: component('card', '.card { width: calc(var(--size-wide) * 2); }'),
    expected: ['css-token-family'],
  },
  {
    name: 'limit 4: a ratio through a local',
    files: component('card', '.card { --card-ratio: var(--size-wide); width: var(--card-ratio); }'),
    expected: ['css-token-family'],
  },
  {
    name: 'limit 4: a ratio through a local in aspect-ratio',
    files: component('card', '.card { --card-ratio: var(--size-wide); aspect-ratio: var(--card-ratio); }'),
    expected: [],
  },
];

test('css-token-family, source half: the family of each var() and the four limits of 7.4', () => {
  for (const { name, files, expected } of FAMILY_SOURCE) assert.deepEqual(ids(checked(project(files))), expected, name);
});

test('css-token-family limit 2: a shadow with four lengths in text-shadow fails, in box-shadow passes', () => {
  const fails = component('card', '.card { text-shadow: var(--shadow-spread); }');
  const passes = component('card', '.card { box-shadow: var(--shadow-spread); }');
  assert.deepEqual(ids(checked(project(fails, { design: SPREAD }))), ['css-token-family']);
  assert.deepEqual(ids(checked(project(passes, { design: SPREAD }))), []);
});

test('css-token-family, both halves, need the tokens: without tokens.css they do not run', () => {
  const files = { ...component('card', '.card { padding: var(--color-accent); }'), [TOKENS_FILE]: null };
  assert.deepEqual(ids(checked(project(files))), []);
  assert.deepEqual(
    ids(audited(built(project(files), site('@layer components{.card{padding:var(--color-accent)}}')))),
    [],
  );
});

test('css-token-family, a family problem and a limit on one var() give one finding, in both halves', () => {
  const report = checked(project(component('card', '.card { padding: var(--size-wide); }')));
  assert.deepEqual(wheres(report), ['css-token-family src/styles/components/card.css:2']);
  assert.deepEqual(details(report), ['padding: var(--size-wide) (--size-wide: a token of the size family)']);
  const builtReport = audited(built(project(CARD), site('@layer components{.card{padding:var(--size-wide)}}')));
  assert.deepEqual(details(builtReport), [
    'padding: var(--size-wide) (--size-wide: a token of the size family) in .card',
  ]);
});

test('css-token-family names the limit in its detail', () => {
  const report = checked(
    project(component('card', '.card {\n  width: var(--size-wide);\n  text-shadow: var(--shadow-inset);\n}')),
  );
  assert.deepEqual(details(report), [
    'text-shadow: var(--shadow-inset) (--shadow-inset: inset or a spread distance)',
    'width: var(--size-wide) (--size-wide: a ratio)',
  ]);
});

const FAMILY_BUILT: readonly BuiltCase[] = [
  {
    name: 'drift 6 passes with a space token',
    files: CARD,
    dist: site('@layer components{.card{padding:var(--space-2)}}'),
    expected: [],
  },
  {
    name: 'drift 6',
    files: CARD,
    dist: site('@layer components{.card{padding:var(--color-accent)}}'),
    expected: ['css-token-family'],
  },
  {
    name: 'limit 2 in text-shadow and in box-shadow',
    files: { ...CARD, ...component('hero', '.hero { box-shadow: var(--shadow-inset); }') },
    dist: site('@layer components{.card{text-shadow:var(--shadow-inset)}.hero{box-shadow:var(--shadow-inset)}}'),
    expected: ['css-token-family'],
  },
  {
    name: 'limit 2 passes in box-shadow',
    files: CARD,
    dist: site('@layer components{.card{box-shadow:var(--shadow-inset)}}'),
    expected: [],
  },
  {
    name: 'limit 4 through a local',
    files: CARD,
    dist: site('@layer components{.card{--card-ratio:var(--size-wide);width:var(--card-ratio)}}'),
    expected: ['css-token-family'],
  },
  {
    name: 'a local takes the family of its token',
    files: CARD,
    dist: site('@layer components{.card{--card-gap:var(--color-text);gap:var(--card-gap)}}'),
    expected: ['css-token-family'],
  },
  {
    name: 'limits 1, 3 and 4 in one rule',
    files: CARD,
    dist: site(
      '@layer components{.card{scroll-margin-top:var(--space-fluid);contain-intrinsic-size:var(--size-half);aspect-ratio:var(--size-content)}}',
    ),
    expected: ['css-token-family'],
  },
];

test('css-token-family, built half: each sentence passes and fails', () => {
  for (const { name, files, dist, expected } of FAMILY_BUILT) {
    assert.deepEqual(ids(audited(built(project(files), dist))), expected, name);
  }
});

test('css-token-family, built half: the facts of one page stay apart by their detail', () => {
  const dist = site(
    '@layer components{.card{scroll-margin-top:var(--space-fluid);contain-intrinsic-size:var(--size-half);aspect-ratio:var(--size-content)}}',
  );
  const report = audited(built(project(CARD), dist));
  assert.equal(report.findings.length, 3);
});

// css-local-var (7.5, 7.8)

const LOCAL_SOURCE: readonly SourceCase[] = [
  {
    name: 'a local on the root, set to a token, read in its file',
    files: component('card', '.card { --card-pad: var(--space-2); padding: var(--card-pad); }'),
    expected: [],
  },
  {
    name: 'a local on the root with a modifier and a state, and in @media inside the root',
    files: component(
      'card',
      '.card.card--wide:hover { --card-pad: var(--space-4); }\n.card { @media (width >= 48rem) { --card-pad: var(--space-2); } }',
    ),
    expected: [],
  },
  {
    name: 'a local defined in elements.css',
    files: { ...CARD, ...elements(':root { --card-pad: var(--space-2); }') },
    expected: ['css-local-var'],
  },
  {
    name: 'a local defined in another component file',
    files: { ...CARD, ...component('hero', '.hero { --card-pad: var(--space-2); }') },
    expected: ['css-local-var'],
  },
  {
    name: 'drift 7: a local defined off the root',
    files: component('card', '.card .card__body { --card-pad: var(--space-2); }'),
    expected: ['css-local-var'],
  },
  {
    name: 'a local set to a literal',
    files: component('card', '.card { --card-pad: 1rem; }'),
    expected: ['css-local-var'],
  },
  {
    name: 'a local set to two tokens',
    files: component('card', '.card { --card-pad: var(--space-2) var(--space-4); }'),
    expected: ['css-local-var'],
  },
  {
    name: 'a local set to another local',
    files: component('card', '.card { --card-pad: var(--space-2); --card-gap: var(--card-pad); }'),
    expected: ['css-local-var'],
  },
  {
    name: 'a local set to an undeclared token: the token is css-var-undefined’s',
    files: component('card', '.card { --card-pad: var(--space-99); }'),
    expected: ['css-var-undefined'],
  },
  {
    name: 'drift 8: a local read in another component',
    files: {
      ...component('card', '.card { --card-pad: var(--space-2); padding: var(--card-pad); }'),
      ...component('hero', '.hero { padding: var(--card-pad); }'),
    },
    expected: ['css-local-var', 'css-var-undefined'],
  },
  {
    name: 'a local read in elements.css',
    files: {
      ...component('card', '.card { --card-pad: var(--space-2); }'),
      ...elements('p { padding: var(--card-pad); }'),
    },
    expected: ['css-local-var', 'css-var-undefined'],
  },
  {
    name: 'a local read in a placement declaration of a page file',
    files: {
      ...component('card', '.card { --card-pad: var(--space-2); }'),
      ...pageFile('index', '.card { gap: var(--card-pad); }'),
    },
    expected: ['css-local-var', 'css-var-undefined'],
  },
  {
    name: 'a helper parameter re-set on the root to a token of its family',
    files: component('card', '.card { --stack-gap: var(--space-4); --grid-min: var(--size-content); }'),
    expected: [],
  },
  {
    name: 'a helper parameter re-set on the root to a token of another family',
    files: component('card', '.card { --stack-gap: var(--size-content); }'),
    expected: ['css-local-var'],
  },
  {
    name: 'a helper parameter re-set on the root to a literal',
    files: component('card', '.card { --stack-gap: 1rem; }'),
    expected: ['css-local-var'],
  },
];

test('css-local-var, source half: place, value and reads of a local; helper parameters on a root', () => {
  for (const { name, files, expected } of LOCAL_SOURCE) assert.deepEqual(ids(checked(project(files))), expected, name);
});

test('css-local-var reports once for each declaration, at its line', () => {
  const report = checked(
    project({
      ...component('card', '.card { --card-pad: var(--space-2); }'),
      ...component('hero', '.hero {\n  --card-pad: var(--card-pad);\n}'),
    }),
  );
  assert.deepEqual(
    wheres(report).filter((each) => each.startsWith('css-local-var')),
    ['css-local-var src/styles/components/hero.css:3'],
  );
});

const LOCAL_BUILT: readonly BuiltCase[] = [
  {
    name: 'a local on the root, read in its component',
    files: CARD,
    dist: site(
      '@layer components{.card{--card-pad:var(--space-2);padding:var(--card-pad);& .card__body{gap:var(--card-pad)}}}',
    ),
    expected: [],
  },
  {
    name: 'drift 7',
    files: CARD,
    dist: site('@layer components{.card .card__body{--card-pad:var(--space-2)}}'),
    expected: ['css-local-var'],
  },
  {
    name: 'drift 8: the minifier merges the two chunks into one layer block',
    files: { ...CARD, ...component('hero', '.hero { padding: var(--card-pad); }') },
    dist: site(
      '@layer components{.card{--card-pad:var(--space-2);padding:var(--card-pad)}.hero{padding:var(--card-pad)}}',
    ),
    expected: ['css-local-var', 'css-var-undefined'],
  },
  {
    name: 'a local defined in the elements layer',
    files: CARD,
    dist: site('@layer elements{:root{--card-pad:var(--space-2)}}'),
    expected: ['css-local-var'],
  },
  {
    name: 'a local set to a literal',
    files: CARD,
    dist: site('@layer components{.card{--card-pad:1rem}}'),
    expected: ['css-local-var'],
  },
  {
    name: 'a helper parameter re-set on the root to a token of its family',
    files: CARD,
    dist: site('@layer components{.card{--stack-gap:var(--space-2)}}'),
    expected: [],
  },
  {
    name: 'a helper parameter re-set on the root to a token of another family',
    files: CARD,
    dist: site('@layer components{.card{--stack-gap:var(--size-content)}}'),
    expected: ['css-local-var'],
  },
  {
    name: 'a local read in :where(.card) and [class~=card], which start at the root as in the source',
    files: CARD,
    dist: site(
      '@layer components{.card{--card-pad:var(--space-2)}:where(.card){padding:var(--card-pad)}[class~=card]{gap:var(--card-pad)}}',
    ),
    expected: [],
  },
  {
    name: 'a local read in a keyframe of its component',
    files: CARD,
    dist: site(
      '@layer components{.card{--card-pad:var(--space-2);animation-name:card-in}@keyframes card-in{0%{translate:0 var(--card-pad)}}}',
    ),
    expected: [],
  },
];

test('css-local-var, built half: the component of a rule comes from its root class', () => {
  for (const { name, files, dist, expected } of LOCAL_BUILT) {
    assert.deepEqual(ids(audited(built(project(files), dist))), expected, name);
  }
});

// css-var-undefined (7.3, 7.5, 7.8)

const UNDEFINED_SOURCE: readonly SourceCase[] = [
  {
    name: 'declared tokens, helper parameters and locals in scope',
    files: component('card', '.card { --card-pad: var(--space-2); padding: var(--card-pad); gap: var(--stack-gap); }'),
    expected: [],
  },
  {
    name: 'drift 9: an undeclared token',
    files: component('card', '.card { padding: var(--space-99); }'),
    expected: ['css-var-undefined'],
  },
  {
    name: 'a helper parameter that the design does not set',
    files: component('card', '.card { gap: var(--grid-gap); }'),
    expected: ['css-var-undefined'],
  },
  { name: 'an empty name', files: component('card', '.card { padding: var(1); }'), expected: ['css-var-undefined'] },
  {
    name: 'a name inside a fallback',
    files: component('card', '.card { margin: var(--space-2, var(--space-99)); }'),
    expected: ['css-literal', 'css-var-undefined'],
  },
  {
    name: 'a name in the value of a local',
    files: component('card', '.card { --card-pad: var(--space-99); padding: var(--card-pad); }'),
    expected: ['css-var-undefined'],
  },
  {
    name: 'a local defined off the root is not in scope where it is read',
    files: component('card', '.card .card__body { --card-pad: var(--space-2); padding: var(--card-pad); }'),
    expected: ['css-local-var', 'css-var-undefined'],
  },
  {
    name: 'a local that its file never defines',
    files: component('card', '.card { padding: var(--card-pad); }'),
    expected: ['css-var-undefined'],
  },
  {
    name: 'a name in elements.css',
    files: elements('p { margin: var(--space-99); }'),
    expected: ['css-var-undefined'],
  },
  {
    name: 'a name in a page file’s placement declaration',
    files: pageFile('index', '.card { gap: var(--space-99); }'),
    expected: ['css-var-undefined'],
  },
];

test('css-var-undefined, source half: every var() is a tokens.css name or a local in scope', () => {
  for (const { name, files, expected } of UNDEFINED_SOURCE) {
    assert.deepEqual(ids(checked(project(files))), expected, name);
  }
});

test('css-var-undefined names the var() in its detail, at its line', () => {
  const report = checked(project(component('card', '.card {\n  padding: var(--space-99) var(--space-98);\n}')));
  assert.deepEqual(wheres(report), [
    'css-var-undefined src/styles/components/card.css:3',
    'css-var-undefined src/styles/components/card.css:3',
  ]);
  assert.deepEqual(details(report), ['--space-98', '--space-99']);
});

const UNDEFINED_BUILT: readonly BuiltCase[] = [
  {
    name: 'declared names',
    files: CARD,
    dist: site('@layer components{.card{padding:var(--space-2);gap:var(--stack-gap)}}'),
    expected: [],
  },
  {
    name: 'drift 9',
    files: CARD,
    dist: site('@layer components{.card{padding:var(--space-99)}}'),
    expected: ['css-var-undefined'],
  },
  {
    name: 'the tokens layer is read',
    files: CARD,
    dist: site('@layer tokens{:root{--color-extra:var(--color-nope)}}'),
    expected: ['css-var-undefined'],
  },
  {
    name: 'the layout layer is not read',
    files: CARD,
    dist: site('@layer layout{.center{padding-inline:var(--center-nope)}}'),
    expected: [],
  },
  {
    name: 'drift 10 passes: .stack with --stack-gap in tokens.css',
    files: CARD,
    dist: site('', '<div class="stack"></div>'),
    expected: [],
  },
  {
    name: 'a page without a helper class needs no parameter',
    files: CARD,
    dist: site('', '<div class="card"></div>'),
    settings: { design: NO_STACK_GAP },
    expected: [],
  },
  {
    name: 'drift 10: .stack used without --stack-gap',
    files: CARD,
    dist: site('', '<div class="stack"></div>'),
    settings: { design: NO_STACK_GAP },
    expected: ['css-var-undefined'],
  },
];

test('css-var-undefined, built half: outside layout, and the parameters of each helper used', () => {
  for (const { name, files, dist, settings, expected } of UNDEFINED_BUILT) {
    assert.deepEqual(ids(audited(built(project(files, settings), dist))), expected, name);
  }
});

test('css-var-undefined drift 10: one finding for each page and parameter, also inside <noscript>', () => {
  const input = built(project(CARD), {
    'index.html': pageHtml([BUILT_AUTO], '<div class="grid"></div><div class="grid"></div>'),
    'zimmer/index.html': pageHtml([BUILT_AUTO], '<noscript><div class="grid"></div></noscript>'),
  });
  const report = audited(input);
  assert.deepEqual(wheres(report), [
    'css-var-undefined /',
    'css-var-undefined /',
    'css-var-undefined /zimmer/',
    'css-var-undefined /zimmer/',
  ]);
  assert.deepEqual([...new Set(details(report))], ['.grid needs --grid-gap', '.grid needs --grid-min']);
});

test('css-var-undefined, both halves, need the tokens', () => {
  const files = { ...component('card', '.card { padding: var(--space-99); }'), [TOKENS_FILE]: null };
  assert.deepEqual(ids(checked(project(files))), []);
  assert.deepEqual(ids(audited(built(project(files), site('', '<div class="grid"></div>')))), []);
});

// css-media (7.10)

const MEDIA_SOURCE: readonly SourceCase[] = [
  {
    name: 'freedom 12: a breakpoint in a component file',
    files: component('card', '@media (width >= 48rem) { .card { gap: var(--space-2); } }'),
    expected: [],
  },
  {
    name: 'drift 17: a length that is no breakpoint',
    files: component('card', '@media (width < 777px) { .card { gap: var(--space-2); } }'),
    expected: ['css-media'],
  },
  {
    name: 'drift 18: var() in a prelude',
    files: component('card', '@media (width < var(--bp)) { .card { gap: var(--space-2); } }'),
    expected: ['css-media'],
  },
  {
    name: 'drift 19: a feature outside 7.10',
    files: component('card', '@media (min-resolution: 2dppx) { .card { gap: var(--space-2); } }'),
    expected: ['css-media'],
  },
  {
    name: 'freedom 13: a breakpoint in @container',
    files: component('card', '@container (inline-size >= 30rem) { .card .card__body { gap: var(--space-2); } }'),
    expected: [],
  },
  {
    name: 'a container name',
    files: component('card', '@container card (inline-size >= 30rem) { .card .card__body { gap: var(--space-2); } }'),
    expected: ['css-media'],
  },
  {
    name: 'a length that is no breakpoint in elements.css',
    files: elements('@media (width >= 40rem) { a { color: var(--color-link); } }'),
    expected: ['css-media'],
  },
  {
    name: 'freedom 24: a breakpoint in a page file',
    files: pageFile('index', '@media (width >= 48rem) { .hero { grid-column: span 2; } }'),
    expected: [],
  },
  {
    name: 'a length that is no breakpoint in a page file',
    files: pageFile('index', '@media (width >= 50rem) { .hero { grid-column: span 2; } }'),
    expected: ['css-media'],
  },
  {
    name: '@supports has no prelude rule',
    files: component('card', '@supports (width: 777px) { .card { gap: var(--space-2); } }'),
    expected: [],
  },
  {
    name: 'a mode feature with AUTO is no problem of css-media',
    files: component('card', '@media (prefers-color-scheme: dark) { .card { color: var(--color-text); } }'),
    expected: [],
  },
  {
    name: 'the preludes of tokens.css are exempt',
    files: { [TOKENS_FILE]: `${renderTokens(DESIGN, SWITCH)}@media (width < 777px) {}\n` },
    expected: [],
  },
];

test('css-media, source half: lengths, var() and features of each prelude', () => {
  for (const { name, files, expected } of MEDIA_SOURCE) assert.deepEqual(ids(checked(project(files))), expected, name);
});

test('css-media drift 17: the finding stands at the length, with the message of media.ts', () => {
  const report = checked(project(component('card', '@media\n  (width < 777px) { .card { gap: var(--space-2); } }')));
  assert.deepEqual(wheres(report), ['css-media src/styles/components/card.css:3']);
  assert.deepEqual(details(report), ['the length `777px` equals no breakpoint width (48rem, 30rem)']);
});

test('css-media, both halves, need the tokens: a design that fails design-format stops them', () => {
  const files = component('card', '@media (width < 777px) { .card { gap: var(--space-2); } }');
  assert.deepEqual(ids(checked(project(files, { design: null }))), []);
  const dist = site('@layer components{@media (width<777px){.card{gap:var(--space-2)}}}');
  assert.deepEqual(ids(audited(built(project(files, { design: null }), dist))), []);
});

const MEDIA_BUILT: readonly BuiltCase[] = [
  {
    name: 'freedom 12',
    files: CARD,
    dist: site('@layer components{@media (width>=48rem){.card{gap:var(--space-2)}}}'),
    expected: [],
  },
  {
    name: 'freedom 13',
    files: CARD,
    dist: site('@layer components{@container (inline-size>=30rem){.card .card__body{gap:var(--space-2)}}}'),
    expected: [],
  },
  {
    name: 'freedom 24',
    files: CARD,
    dist: site('@layer page{@media (width>=48rem){.hero{grid-column:span 2}}}'),
    expected: [],
  },
  {
    name: 'drift 17',
    files: CARD,
    dist: site('@layer components{@media (width<777px){.card{gap:var(--space-2)}}}'),
    expected: ['css-media'],
  },
  {
    name: 'drift 19: the minifier writes (resolution>=2x)',
    files: CARD,
    dist: site('@layer components{@media (resolution>=2x){.card{gap:var(--space-2)}}}'),
    expected: ['css-media'],
  },
  {
    name: 'the preludes of the tokens layer are exempt',
    files: CARD,
    dist: site('@layer tokens{@media (width<777px){:root{--color-page:#fff}}}'),
    expected: [],
  },
];

test('css-media, built half: the preludes of the project layers in the minifier’s form', () => {
  for (const { name, files, dist, expected } of MEDIA_BUILT) {
    assert.deepEqual(ids(audited(built(project(files), dist))), expected, name);
  }
});

// modes-media (7.12)

const MODE_RULE = '@media (prefers-color-scheme: dark) { .card { color: var(--color-text); } }';
const MODE_CHUNK = '@layer components{@media (prefers-color-scheme:dark){.card{color:var(--color-text)}}}';
const PICTURE =
  '<picture><source media="(prefers-color-scheme: dark)" srcset="/a.png"><img src="/b.png" alt=""></picture>';

const MODES_SOURCE: readonly SourceCase[] = [
  {
    name: 'a mode feature in a component file with SWITCH',
    files: component('card', MODE_RULE),
    settings: { options: SWITCH },
    expected: ['modes-media'],
  },
  { name: 'the same with AUTO', files: component('card', MODE_RULE), expected: [] },
  {
    name: 'prefers-contrast in elements.css with SWITCH',
    files: elements('@media (prefers-contrast: more) { a { color: var(--color-link); } }'),
    settings: { options: SWITCH },
    expected: ['modes-media'],
  },
  {
    name: 'forced colors stay allowed with SWITCH',
    files: elements('@media (forced-colors: active) { a { color: LinkText; } }'),
    settings: { options: SWITCH },
    expected: [],
  },
  {
    name: 'a media attribute in markup with SWITCH',
    files: { 'src/components/Hero.astro': `---\nconst x = 1;\n---\n${PICTURE}\n` },
    settings: { options: SWITCH },
    expected: ['modes-media'],
  },
  {
    name: 'the same with AUTO',
    files: { 'src/components/Hero.astro': `---\nconst x = 1;\n---\n${PICTURE}\n` },
    expected: [],
  },
  {
    name: 'a media attribute in a fenced code block or a code span of Markdown is an example',
    files: {
      'src/pages/a.md': `# A\n\n\`\`\`html\n${PICTURE}\n\`\`\`\n`,
      'src/pages/b.mdx': '# B\n\nWrite `<source media="(prefers-color-scheme: dark)">` here.\n',
    },
    settings: { options: SWITCH },
    expected: [],
  },
  {
    name: 'a media attribute in the markup of Markdown',
    files: { 'src/pages/a.md': `# A\n\n${PICTURE}\n` },
    settings: { options: SWITCH },
    expected: ['modes-media'],
  },
  {
    name: 'a media attribute without a mode feature',
    files: { 'src/components/Hero.astro': '<source media="(width >= 48rem)" srcset="/a.png">\n' },
    settings: { options: SWITCH },
    expected: [],
  },
  {
    name: 'a media attribute that is an Astro expression is not read',
    files: { 'src/components/Hero.astro': '<source media={dark ? "(prefers-color-scheme: dark)" : "all"}>\n' },
    settings: { options: SWITCH },
    expected: [],
  },
  {
    name: 'a selector on data-mode, with AUTO too',
    files: elements('[data-mode=dark] a { color: var(--color-link); }'),
    expected: ['modes-media'],
  },
  {
    name: 'a selector on data-mode inside :not()',
    files: component('card', '.card:not([data-mode]) { color: var(--color-text); }'),
    expected: ['modes-media'],
  },
  {
    name: 'data-mode-switch is another attribute',
    files: component('card', '.card [data-mode-switch] { color: var(--color-text); }'),
    expected: [],
  },
  {
    name: 'color-scheme in elements.css',
    files: elements(':root { color-scheme: dark; }'),
    expected: ['modes-media'],
  },
  {
    name: 'color-scheme in a page file is css-page’s',
    files: pageFile('index', '.card { color-scheme: dark; }'),
    expected: [],
  },
  {
    name: 'the mode rules of tokens.css with SWITCH',
    files: {},
    settings: { options: SWITCH },
    expected: [],
  },
];

test('modes-media, source half: mode features with a switch option, data-mode and color-scheme always', () => {
  for (const { name, files, settings, expected } of MODES_SOURCE) {
    assert.deepEqual(ids(checked(project(files, settings))), expected, name);
  }
});

test('modes-media, source half: a media attribute reports at the line of its element', () => {
  const report = checked(
    project({ 'src/components/Hero.astro': `---\nconst x = 1;\n---\n${PICTURE}\n` }, { options: SWITCH }),
  );
  assert.deepEqual(wheres(report), ['modes-media src/components/Hero.astro:4']);
  assert.deepEqual(details(report), ['<source media="(prefers-color-scheme: dark)">']);
});

test('modes-media waits for valid settings, in both halves', () => {
  const files = elements('[data-mode=dark] a { color: var(--color-link); }');
  assert.deepEqual(ids(checked(project(files, { options: null }))), []);
  const dist = site('@layer elements{[data-mode=dark] a{color:var(--color-link)}}');
  assert.deepEqual(ids(audited(built(project(files, { options: null }), dist))), []);
});

const MODES_BUILT: readonly BuiltCase[] = [
  {
    name: 'a mode feature in the components layer with SWITCH',
    files: CARD,
    settings: { options: SWITCH },
    dist: switchSite(MODE_CHUNK),
    expected: ['modes-media'],
  },
  { name: 'the same with AUTO', files: CARD, dist: site(MODE_CHUNK), expected: [] },
  {
    name: 'the tokens layer of SWITCH holds data-mode and color-scheme',
    files: CARD,
    settings: { options: SWITCH },
    dist: switchSite(''),
    expected: [],
  },
  {
    name: 'a media attribute on a built page with SWITCH',
    files: CARD,
    settings: { options: SWITCH },
    dist: switchSite('', PICTURE),
    expected: ['modes-media'],
  },
  { name: 'the same with AUTO', files: CARD, dist: site('', PICTURE), expected: [] },
  {
    name: 'a selector on data-mode in the components layer',
    files: CARD,
    dist: site('@layer components{.card[data-mode=dark]{color:var(--color-text)}}'),
    expected: ['modes-media'],
  },
  {
    name: 'color-scheme in the components layer',
    files: CARD,
    dist: site('@layer components{.card{color-scheme:dark}}'),
    expected: ['modes-media'],
  },
  {
    name: 'color-scheme in the page layer is css-page’s',
    files: CARD,
    dist: site('@layer page{.card{color-scheme:dark}}'),
    expected: [],
  },
  {
    name: 'color-scheme and data-mode in the elements layer',
    files: CARD,
    dist: site('@layer elements{[data-mode=dark] a{color:var(--color-link)}:root{color-scheme:dark}}'),
    expected: ['modes-media'],
  },
];

test('modes-media, built half: by layer, and the media attributes of built HTML', () => {
  for (const { name, files, settings, dist, expected } of MODES_BUILT) {
    assert.deepEqual(ids(audited(built(project(files, settings), dist))), expected, name);
  }
});

// The matrices of 14.1

/** The freedom rows: in a component file unless said, source and built. */
const FREEDOM: readonly BuiltCase[] = [
  {
    name: 'freedom 1',
    files: component('card', '.card { rotate: 180deg; }'),
    dist: site('@layer components{.card{rotate:180deg}}'),
    expected: [],
  },
  {
    name: 'freedom 2',
    files: component('card', '.card:hover { scale: 1.05; }'),
    dist: site('@layer components{.card:hover{scale:1.05}}'),
    expected: [],
  },
  {
    name: 'freedom 3',
    files: component('card', '.card { transform: translateY(var(--space-1)) rotate(-2deg); }'),
    dist: site('@layer components{.card{transform:translateY(var(--space-1)) rotate(-2deg)}}'),
    expected: [],
  },
  {
    name: 'freedom 4',
    files: component('card', '.card { filter: blur(var(--space-1)) grayscale(0.4); }'),
    dist: site('@layer components{.card{filter:blur(var(--space-1)) grayscale(.4)}}'),
    expected: [],
  },
  {
    name: 'freedom 5',
    files: component('card', '.card { background-image: var(--gradient-hero); }'),
    dist: site('@layer components{.card{background-image:var(--gradient-hero)}}'),
    expected: [],
  },
  {
    name: 'freedom 6',
    files: component(
      'card',
      '@keyframes card-in { from { opacity: 0; } 50% { opacity: var(--opacity-half); } to { opacity: 100%; } }\n.card { animation-name: card-in; }',
    ),
    dist: site(
      '@layer components{@keyframes card-in{0%{opacity:0}50%{opacity:var(--opacity-half)}to{opacity:1}}.card{animation-name:card-in}}',
    ),
    expected: [],
  },
  {
    name: 'freedom 7',
    files: component('card', '.card { width: calc(100% - var(--space-4)); }'),
    dist: site('@layer components{.card{width:calc(100% - var(--space-4))}}'),
    expected: [],
  },
  {
    name: 'freedom 8',
    files: component('card', '.card { padding: calc(var(--space-2) * 1.5); }'),
    dist: site('@layer components{.card{padding:calc(var(--space-2) * 1.5)}}'),
    expected: [],
  },
  {
    name: 'freedom 9',
    files: component(
      'card',
      '.card { grid-template-columns: minmax(var(--space-4), 1fr) minmax(0, var(--size-content)) minmax(var(--space-4), 1fr); }',
    ),
    dist: site(
      '@layer components{.card{grid-template-columns:minmax(var(--space-4), 1fr) minmax(0, var(--size-content)) minmax(var(--space-4), 1fr)}}',
    ),
    expected: [],
  },
  {
    name: 'freedom 10',
    files: component('card', '.card { clip-path: polygon(0 0, 100% 0, 100% 85%, 0 100%); }'),
    dist: site('@layer components{.card{clip-path:polygon(0 0,100% 0,100% 85%,0 100%)}}'),
    expected: [],
  },
  {
    name: 'freedom 11',
    files: component('card', '.card { object-position: 30% 20%; }'),
    dist: site('@layer components{.card{object-position:30% 20%}}'),
    expected: [],
  },
  {
    name: 'freedom 12',
    files: component('card', '@media (width >= 48rem) { .card { gap: var(--space-2); } }'),
    dist: site('@layer components{@media (width>=48rem){.card{gap:var(--space-2)}}}'),
    expected: [],
  },
  {
    name: 'freedom 13',
    files: component('card', '@container (inline-size >= 30rem) { .card .card__body { gap: var(--space-2); } }'),
    dist: site('@layer components{@container (inline-size>=30rem){.card .card__body{gap:var(--space-2)}}}'),
    expected: [],
  },
  {
    name: 'freedom 14',
    files: component('card', '.card { @starting-style { opacity: 0; } }'),
    dist: site('@layer components{.card{@starting-style{opacity:0}}}'),
    expected: [],
  },
  {
    name: 'freedom 15',
    files: component('card', '.card { &:hover { color: var(--color-accent); } }'),
    dist: site('@layer components{.card{&:hover{color:var(--color-accent)}}}'),
    expected: [],
  },
  {
    name: 'freedom 16',
    files: component('nav', '.nav .nav__link[aria-current="page"]:hover { color: var(--color-link); }'),
    dist: site('@layer components{.nav .nav__link[aria-current=page]:hover{color:var(--color-link)}}'),
    expected: [],
  },
  {
    name: 'freedom 17',
    files: {
      ...component('card', '.card:has(img) { gap: var(--space-2); }'),
      ...component('list', '.list .list__item:nth-child(2n + 1) { gap: var(--space-2); }'),
    },
    dist: site(
      '@layer components{.card:has(img){gap:var(--space-2)}.list .list__item:nth-child(odd){gap:var(--space-2)}}',
    ),
    expected: [],
  },
  {
    name: 'freedom 18',
    files: component('card', '.card { anchor-name: --menu; position-anchor: --menu; }'),
    dist: site('@layer components{.card{anchor-name:--menu;position-anchor:--menu}}'),
    expected: [],
  },
  {
    name: 'freedom 19',
    files: component('card', '.card { font-variation-settings: "opsz" 32; }'),
    dist: site('@layer components{.card{font-variation-settings:"opsz" 32}}'),
    expected: [],
  },
  {
    name: 'freedom 20',
    files: component('card', '.card { aspect-ratio: var(--size-wide); }'),
    dist: site('@layer components{.card{aspect-ratio:var(--size-wide)}}'),
    expected: [],
  },
  {
    name: 'freedom 21',
    files: component('card', '.card { box-shadow: var(--shadow-card); }'),
    dist: site('@layer components{.card{box-shadow:var(--shadow-card)}}'),
    expected: [],
  },
  {
    name: 'freedom 22',
    files: component('card', '.card { stroke-width: var(--line-1); }'),
    dist: site('@layer components{.card{stroke-width:var(--line-1)}}'),
    expected: [],
  },
  {
    name: 'freedom 23',
    files: component('card', '.card { animation-iteration-count: 3; }'),
    dist: site('@layer components{.card{animation-iteration-count:3}}'),
    expected: [],
  },
  {
    name: 'freedom 24',
    files: {
      ...component('hero', '.hero { gap: var(--space-2); }'),
      ...pageFile('index', '@media (width >= 48rem) { .hero { grid-column: span 2; } }'),
    },
    dist: site(
      '@layer components{.hero{gap:var(--space-2)}}\n@layer page{@media (width>=48rem){.hero{grid-column:span 2}}}',
    ),
    expected: [],
  },
];

test('the freedom rows of 14.1 give no id of this group, in source and built CSS, with AUTO and SWITCH', () => {
  for (const { name, files, dist } of FREEDOM) {
    assert.deepEqual(ids(checked(project(files))), [], `${name}, source`);
    assert.deepEqual(ids(checked(project(files, { options: SWITCH }))), [], `${name}, source, SWITCH`);
    assert.deepEqual(ids(audited(built(project(files), dist))), [], `${name}, built`);
  }
});

/** The drift rows of 14.1 with the ids of this group: the rows of this group give their ids, the others none. */
const DRIFT: readonly SourceCase[] = [
  { name: 'drift 1', files: component('card', '.card { color: #c00; }'), expected: ['css-literal'] },
  { name: 'drift 2', files: component('card', '.card { padding: 13px; }'), expected: ['css-literal'] },
  { name: 'drift 3', files: component('card', '.card { color: red; }'), expected: ['css-literal'] },
  { name: 'drift 4', files: component('card', '.card { margin: var(--space-2, 1rem); }'), expected: ['css-literal'] },
  { name: 'drift 5', files: elements(':root { --brand: var(--color-a); }'), expected: ['css-literal'] },
  {
    name: 'drift 6',
    files: component('card', '.card { padding: var(--color-accent); }'),
    expected: ['css-token-family'],
  },
  {
    name: 'drift 7',
    files: component('card', '.card .card__body { --card-pad: var(--space-2); }'),
    expected: ['css-local-var'],
  },
  {
    name: 'drift 8',
    files: {
      ...component('card', '.card { --card-pad: var(--space-2); padding: var(--card-pad); }'),
      ...component('hero', '.hero { padding: var(--card-pad); }'),
    },
    expected: ['css-local-var', 'css-var-undefined'],
  },
  { name: 'drift 9', files: component('card', '.card { padding: var(--space-99); }'), expected: ['css-var-undefined'] },
  { name: 'drift 11', files: component('card', '#hero { color: var(--color-text); }'), expected: [] },
  { name: 'drift 12', files: elements('.a .b .c .d .e { color: var(--color-text); }'), expected: [] },
  {
    name: 'drift 13',
    files: {
      ...component('card', '.card .button { color: var(--color-text); }'),
      ...component('button', '.button { color: var(--color-text); }'),
    },
    expected: [],
  },
  { name: 'drift 14', files: component('card', 'h2 { color: var(--color-text); }'), expected: [] },
  { name: 'drift 15', files: elements('.card { color: var(--color-text); }'), expected: [] },
  { name: 'drift 16', files: pageFile('index', '.card { color: var(--color-text); }'), expected: [] },
  {
    name: 'drift 17',
    files: component('card', '@media (width < 777px) { .card { gap: var(--space-2); } }'),
    expected: ['css-media'],
  },
  {
    name: 'drift 18',
    files: component('card', '@media (width < var(--bp)) { .card { gap: var(--space-2); } }'),
    expected: ['css-media'],
  },
  {
    name: 'drift 19',
    files: component('card', '@media (min-resolution: 2dppx) { .card { gap: var(--space-2); } }'),
    expected: ['css-media'],
  },
  { name: 'drift 20', files: component('card', '.card { color: var(--color-text) !important; }'), expected: [] },
  {
    name: 'drift 21',
    files: {
      'src/styles/components/card.css':
        '@import url("x.css");\n@layer components {\n.card { gap: var(--space-2); }\n}\n',
    },
    expected: [],
  },
  { name: 'drift 22', files: component('card', '@scope (.card) { p { color: var(--color-text); } }'), expected: [] },
  {
    name: 'drift 23',
    files: { ...CARD, 'src/components/Card.astro': '<div class="card" style="color: red"></div>\n' },
    expected: [],
  },
  { name: 'drift 24', files: component('card', '.card { inline-size: var(--size-screen); }'), expected: [] },
  {
    name: 'drift 25',
    files: { ...CARD, 'src/components/Card.astro': '<div class="card"></div>\n<style>.card { color: red; }</style>\n' },
    expected: [],
  },
  {
    name: 'drift 26',
    files: {
      ...CARD,
      ...component('hero', '.hero { gap: var(--space-2); }'),
      'src/components/Card.astro': '---\nimport \'../styles/components/hero.css\';\n---\n<div class="card"></div>\n',
    },
    expected: [],
  },
  { name: 'drift 27', files: { 'public/x.css': '.x { color: red; }\n' }, expected: [] },
  { name: 'drift 28', files: { 'src/styles/extra.css': '.x { color: red; }\n' }, expected: [] },
  {
    name: 'drift 29',
    files: {
      'src/styles/components/card.css':
        '@layer components {\n.card { gap: var(--space-2); }\n}\n@layer components {\n@layer inner { .card { padding: var(--space-2); } }\n}\n',
    },
    expected: [],
  },
  { name: 'drift 30', files: { 'src/components/Card.astro': '<div class="card"></div>\n' }, expected: [] },
  { name: 'drift 31', files: component('card', '.box { color: var(--color-text); }'), expected: [] },
  {
    name: 'drift 32',
    files: { [TOKENS_FILE]: renderTokens(DESIGN, SWITCH).replace('0.5rem', '0.625rem') },
    settings: { options: SWITCH },
    expected: [],
  },
  { name: 'drift 34', files: {}, settings: { design: WITH_ELEMENTS_ROW }, expected: [] },
  { name: 'drift 35', files: component('card', '.card { background-color: var(--color-accent); }'), expected: [] },
  { name: 'drift 37', files: elements('a.button { color: var(--color-link); }'), expected: [] },
];

test('the drift rows of 14.1, source: each gives exactly the ids of this group that it names', () => {
  for (const { name, files, settings, expected } of DRIFT) {
    assert.deepEqual(ids(checked(project(files, settings))), expected, name);
  }
});

/** The drift rows that a built page shows, with the ids of this group. */
const DRIFT_BUILT: readonly BuiltCase[] = [
  { name: 'drift 1', files: CARD, dist: site('@layer components{.card{color:#c00}}'), expected: ['css-literal'] },
  { name: 'drift 2', files: CARD, dist: site('@layer components{.card{padding:13px}}'), expected: ['css-literal'] },
  { name: 'drift 3', files: CARD, dist: site('@layer components{.card{color:red}}'), expected: ['css-literal'] },
  {
    name: 'drift 4',
    files: CARD,
    dist: site('@layer components{.card{margin:var(--space-2,1rem)}}'),
    expected: ['css-literal'],
  },
  {
    name: 'drift 5',
    files: CARD,
    dist: site('@layer elements{:root{--brand:var(--color-a)}}'),
    expected: ['css-literal'],
  },
  {
    name: 'drift 6',
    files: CARD,
    dist: site('@layer components{.card{padding:var(--color-accent)}}'),
    expected: ['css-token-family'],
  },
  {
    name: 'drift 7',
    files: CARD,
    dist: site('@layer components{.card .card__body{--card-pad:var(--space-2)}}'),
    expected: ['css-local-var'],
  },
  {
    name: 'drift 8',
    files: { ...CARD, ...component('hero', '.hero { padding: var(--card-pad); }') },
    dist: site(
      '@layer components{.card{--card-pad:var(--space-2);padding:var(--card-pad)}.hero{padding:var(--card-pad)}}',
    ),
    expected: ['css-local-var', 'css-var-undefined'],
  },
  {
    name: 'drift 9',
    files: CARD,
    dist: site('@layer components{.card{padding:var(--space-99)}}'),
    expected: ['css-var-undefined'],
  },
  {
    name: 'drift 10',
    files: CARD,
    settings: { design: NO_STACK_GAP },
    dist: site('', '<div class="stack"></div>'),
    expected: ['css-var-undefined'],
  },
  { name: 'drift 11', files: CARD, dist: site('@layer components{#hero{color:var(--color-text)}}'), expected: [] },
  {
    name: 'drift 13',
    files: { ...CARD, ...component('button', '.button { color: var(--color-text); }') },
    dist: site('@layer components{.card .button{color:var(--color-text)}}'),
    expected: [],
  },
  { name: 'drift 16', files: CARD, dist: site('@layer page{.card{color:var(--color-text)}}'), expected: [] },
  {
    name: 'drift 17',
    files: CARD,
    dist: site('@layer components{@media (width<777px){.card{gap:var(--space-2)}}}'),
    expected: ['css-media'],
  },
  {
    name: 'drift 19',
    files: CARD,
    dist: site('@layer components{@media (resolution>=2x){.card{gap:var(--space-2)}}}'),
    expected: ['css-media'],
  },
  {
    name: 'drift 20',
    files: CARD,
    dist: site('@layer components{.card{color:var(--color-text)!important}}'),
    expected: [],
  },
  { name: 'drift 23', files: CARD, dist: site('', '<div class="card" style="color:red"></div>'), expected: [] },
  {
    name: 'drift 24',
    files: CARD,
    dist: site('@layer components{.card{inline-size:var(--size-screen)}}'),
    expected: [],
  },
  { name: 'drift 27', files: CARD, dist: site('', '<link rel="stylesheet" href="/x.css">'), expected: [] },
  {
    name: 'drift 33',
    files: CARD,
    dist: site('@layer tokens{:root{--color-extra:#fff}}'),
    expected: [],
  },
  { name: 'drift 36', files: CARD, dist: site('', '<div class="nope"></div>'), expected: [] },
  { name: 'drift 37', files: CARD, dist: site('@layer components{.card{gap:var(--space-2)}}'), expected: [] },
  { name: 'drift 38', files: CARD, dist: site('', '<table><tr><td>1</td></tr></table>'), expected: [] },
];

test('the drift rows of 14.1, built: each gives exactly the ids of this group that it names', () => {
  for (const { name, files, settings, dist, expected } of DRIFT_BUILT) {
    assert.deepEqual(ids(audited(built(project(files, settings), dist))), expected, name);
  }
});

test('the five agent mistakes of 14.2 give the ids of this group that they name', () => {
  const cases: readonly [string, ReturnType<typeof project>, readonly string[]][] = [
    ['a raw color', project(component('card', '.card { color: #c00; }')), ['css-literal']],
    ['padding: 13px', project(component('card', '.card { padding: 13px; }')), ['css-literal']],
    ['a <style> in an .astro', project({ ...CARD, 'src/components/Card.astro': '<style>.card{}</style>\n' }), []],
    [
      'a 777px media query',
      project(component('card', '@media (width < 777px) { .card { gap: var(--space-2); } }')),
      ['css-media'],
    ],
  ];
  for (const [name, input, expected] of cases) assert.deepEqual(ids(checked(input)), expected, name);
  assert.deepEqual(ids(audited(built(project(CARD), site('', '<div class="nope"></div>')))), [], 'an undeclared class');
});

test('hostile names find nothing in the tables and throw nothing', () => {
  const files = component(
    'card',
    '.card { --constructor: var(--__proto__); color: var(--constructor); padding: var(--toString, var()); }',
  );
  assert.deepEqual(ids(checked(project(files))), ['css-literal', 'css-var-undefined']);
  const dist = site('@layer components{.card{--constructor:var(--__proto__);padding:var(--toString)}}');
  assert.deepEqual(ids(audited(built(project(files), dist))), ['css-literal', 'css-var-undefined']);
});

// The review of part 5a: each case fails without its fix

test('css-token-family: a local re-set on its root to another family or to a token past a limit fails, in both halves', () => {
  const cases: readonly { name: string; css: string; minified: string }[] = [
    {
      name: 'a modifier re-sets a space local to a color',
      css: '.card { --card-c: var(--space-2); } .card.card--wide { --card-c: var(--color-text); } .card .card__body { padding: var(--card-c); }',
      minified:
        '@layer components{.card{--card-c:var(--space-2)}.card.card--wide{--card-c:var(--color-text)}.card .card__body{padding:var(--card-c)}}',
    },
    {
      name: 'a state re-sets it to a color',
      css: '.card { --card-c: var(--space-2); &:hover { --card-c: var(--color-text); } } .card .card__body { padding: var(--card-c); }',
      minified:
        '@layer components{.card{--card-c:var(--space-2);&:hover{--card-c:var(--color-text)}}.card .card__body{padding:var(--card-c)}}',
    },
    {
      name: 'an @media block re-sets a size local to a ratio',
      css: '.card { --card-c: var(--size-content); @media (width >= 48rem) { --card-c: var(--size-wide); } } .card .card__body { width: var(--card-c); }',
      minified:
        '@layer components{.card{--card-c:var(--size-content);@media (width>=48rem){--card-c:var(--size-wide)}}.card .card__body{width:var(--card-c)}}',
    },
    {
      name: 'a modifier re-sets a space local to a percentage, read in scroll-margin-top',
      css: '.card { --card-c: var(--space-2); } .card.card--wide { --card-c: var(--space-fluid); } .card .card__body { scroll-margin-top: var(--card-c); }',
      minified:
        '@layer components{.card{--card-c:var(--space-2)}.card.card--wide{--card-c:var(--space-fluid)}.card .card__body{scroll-margin-top:var(--card-c)}}',
    },
  ];
  for (const { name, css, minified } of cases) {
    const files = component('card', css);
    assert.deepEqual(ids(checked(project(files))), ['css-token-family'], `source: ${name}`);
    assert.deepEqual(ids(audited(built(project(files), site(minified)))), ['css-token-family'], `built: ${name}`);
  }
  const same = component(
    'card',
    '.card { --card-c: var(--space-2); } .card.card--wide { --card-c: var(--space-4); } .card .card__body { padding: var(--card-c); }',
  );
  assert.deepEqual(ids(checked(project(same))), []);
  const sameBuilt =
    '@layer components{.card{--card-c:var(--space-2)}.card.card--wide{--card-c:var(--space-4)}.card .card__body{padding:var(--card-c)}}';
  assert.deepEqual(ids(audited(built(project(same), site(sameBuilt)))), []);
});

test('css-token-family: a --size- helper parameter set to a ratio fails, in design.md and on a component root', () => {
  const ratio = designOf(
    DESIGN_TEXT.replace(
      '| `--stack-gap` | `var(--space-2)` | The gap of a stack. |',
      '| `--stack-gap` | `var(--space-2)` | The gap of a stack. |\n| `--grid-min` | `var(--size-wide)` | The narrowest column. |',
    ),
  );
  const fromDesign = checked(project({}, { design: ratio }));
  assert.deepEqual(ids(fromDesign), ['css-token-family']);
  assert.equal(wheres(fromDesign)[0]?.startsWith('css-token-family docs/design.md:'), true);
  const length = designOf(
    DESIGN_TEXT.replace(
      '| `--stack-gap` | `var(--space-2)` | The gap of a stack. |',
      '| `--stack-gap` | `var(--space-2)` | The gap of a stack. |\n| `--grid-min` | `var(--size-content)` | The narrowest column. |',
    ),
  );
  assert.deepEqual(ids(checked(project({}, { design: length }))), []);
  const reset = component('card', '.card { --center-max: var(--size-wide); }');
  assert.deepEqual(wheres(checked(project(reset))), ['css-token-family src/styles/components/card.css:2']);
  assert.deepEqual(
    ids(audited(built(project(reset), site('@layer components{.card{--center-max:var(--size-wide)}}')))),
    ['css-token-family'],
  );
  const fine = component('card', '.card { --center-max: var(--size-content); }');
  assert.deepEqual(ids(checked(project(fine))), []);
  assert.deepEqual(
    ids(audited(built(project(fine), site('@layer components{.card{--center-max:var(--size-content)}}')))),
    [],
  );
});

test('css-token-family: a percentage inside a function of a token and a math length in a shadow count', () => {
  const design = designOf(
    DESIGN_TEXT.replace(
      '| `--space-fluid` |',
      '| `--space-mixed` | `calc(1rem + 5%)` | A gap that grows. |\n| `--space-fluid` |',
    ).replace(
      '| `--shadow-inset` |',
      '| `--shadow-calc` | `calc(1px) 0 0 0 var(--color-shadow)` | A spread made of a calculation. |\n| `--shadow-inset` |',
    ),
  );
  const settings = { design };
  const margin = component('card', '.card { scroll-margin-top: var(--space-mixed); }');
  assert.deepEqual(ids(checked(project(margin, settings))), ['css-token-family']);
  const shadow = component('card', '.card { text-shadow: var(--shadow-calc); }');
  assert.deepEqual(ids(checked(project(shadow, settings))), ['css-token-family']);
  assert.deepEqual(ids(checked(project(component('card', '.card { box-shadow: var(--shadow-calc); }'), settings))), []);
  assert.deepEqual(ids(checked(project(component('card', '.card { padding: var(--space-mixed); }'), settings))), []);
});

test('css-literal and css-local-var: a helper parameter in a merged list of roots is a root in each selector', () => {
  const files = {
    ...component('card', '.card .card__x { color: var(--color-text); } .card { --stack-gap: var(--space-4); }'),
    ...component('box', '.box { --stack-gap: var(--space-4); }'),
  };
  // Lightning CSS merges the two adjacent root rules into one list.
  const merged = '@layer components{.card .card__x{color:var(--color-text)}.card,.box{--stack-gap:var(--space-4)}}';
  assert.deepEqual(ids(checked(project(files))), []);
  assert.deepEqual(ids(audited(built(project(files), site(merged)))), []);
  const wrong = merged.replace('.card,.box{--stack-gap:var(--space-4)}', '.card,.box{--stack-gap:var(--size-content)}');
  assert.deepEqual(ids(audited(built(project(files), site(wrong)))), ['css-local-var']);
  // A part in the list is no root: Lightning CSS writes this for `.card .card__x` and `.box` with the same parameter.
  const offRoot = '@layer components{.card .card__x,.box{--stack-gap:var(--space-4)}}';
  assert.deepEqual(ids(audited(built(project(files), site(offRoot)))), ['css-literal']);
});

test('the value rules read nothing that an @scope holds: it is part of the banned rule', () => {
  const files = elements('@scope (.a) { p { color: red; padding: var(--color-text); margin: var(--space-99); } }');
  assert.deepEqual(ids(checked(project(files))), []);
  const media = elements('@scope (.a) { @media (width < 777px) { p { gap: var(--space-2); } } }');
  assert.deepEqual(ids(checked(project(media))), []);
  const chunk =
    '@layer components{@scope(.card){p{color:red;padding:var(--color-text)}@media (width<777px){p{gap:0}}}}';
  assert.deepEqual(ids(audited(built(project(CARD), site(chunk)))), []);
  const outside = elements('p { color: red; }');
  assert.deepEqual(ids(checked(project(outside))), ['css-literal']);
});

test('modes-media leaves a mode feature in @container to css-media, with a switch option on', () => {
  const files = component('card', '.card { @container (prefers-color-scheme: dark) { padding: var(--space-2); } }');
  assert.deepEqual(ids(checked(project(files, { options: SWITCH }))), ['css-media']);
  const dist = switchSite('@layer components{.card{@container (prefers-color-scheme:dark){padding:var(--space-2)}}}');
  assert.deepEqual(ids(audited(built(project(files, { options: SWITCH }), dist))), ['css-media']);
  const media = component('card', '.card { @media (prefers-color-scheme: dark) { padding: var(--space-2); } }');
  assert.deepEqual(ids(checked(project(media, { options: SWITCH }))), ['modes-media']);
});

test('modes-media leaves [data-mode] in a page file to css-selector, in both halves', () => {
  const files = pageFile('index', '.card[data-mode] { gap: var(--space-2); }');
  assert.deepEqual(ids(checked(project(files))), []);
  assert.deepEqual(ids(audited(built(project(CARD), site('@layer page{.card[data-mode]{gap:var(--space-2)}}')))), []);
  assert.deepEqual(ids(checked(project(component('card', '.card[data-mode] { gap: var(--space-2); }')))), [
    'modes-media',
  ]);
});

test('modes-media: the tokens layer may read mode features; contrast alone is a switch option', () => {
  const tokens = BUILT_SWITCH.replace(
    ':root[data-mode=dark]{color-scheme:dark}}',
    ':root[data-mode=dark]{color-scheme:dark}@media (prefers-contrast:more){:root{--color-text:#000}}}',
  );
  const page = (global: string, extra = ''): Record<string, string> => ({
    'index.html': pageHtml([extra === '' ? global : `${global}\n${extra}`]),
  });
  assert.deepEqual(ids(audited(built(project(CARD, { options: SWITCH }), page(tokens)))), []);
  const contrastChunk = '@layer components{@media (prefers-contrast:more){.card{padding:var(--space-4)}}}';
  assert.deepEqual(ids(audited(built(project(CARD, { options: SWITCH }), page(BUILT_SWITCH, contrastChunk)))), [
    'modes-media',
  ]);
  const contrast = { ...SWITCH, modes: { auto: true, light: false, dark: false, contrast: true } };
  const files = component('card', '.card { @media (prefers-contrast: more) { padding: var(--space-4); } }');
  assert.deepEqual(ids(checked(project(files, { options: contrast }))), ['modes-media']);
  assert.deepEqual(ids(audited(built(project(files, { options: contrast }), page(BUILT_AUTO, contrastChunk)))), [
    'modes-media',
  ]);
  const auto = { ...SWITCH, modes: { auto: true, light: false, dark: false, contrast: false } };
  assert.deepEqual(ids(checked(project(files, { options: auto }))), []);
});

test('css-media is off when tokens.css does not parse, though design.md does, in both halves', () => {
  const files = {
    ...component('card', '@media (width < 777px) { .card { gap: var(--space-2); } }'),
    [TOKENS_FILE]: '@layer tokens { :root { --a: 1; }',
  };
  assert.deepEqual(ids(checked(project(files))), []);
  const dist = site('@layer components{@media (width<777px){.card{gap:var(--space-2)}}}');
  assert.deepEqual(ids(audited(built(project(files), dist))), []);
  const parsed = component('card', '@media (width < 777px) { .card { gap: var(--space-2); } }');
  assert.deepEqual(ids(checked(project(parsed))), ['css-media']);
});

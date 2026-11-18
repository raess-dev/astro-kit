/**
 * One fact, one id (specification, section 8: "a rule reports a fact once"). Two rules of part 5a could meet one
 * place: the "left to" sentences of their rows say which one reports it. Each case runs all 18 rules of part 5a, the
 * source halves or the built halves, through the runners of `src/css/rules.ts`, and asserts the exact sorted id list.
 * The built strings are what Lightning CSS writes with the targets of 6.1 (13.1 item 40).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  type BuiltCssInput,
  CSS_AUDITS,
  CSS_CHECKS,
  runBuiltChecks,
  runSourceChecks,
  type SourceCss,
} from '../../src/css/rules.ts';
import { DESIGN_AUDITS, DESIGN_CHECKS } from '../../src/design/rules.ts';
import type { Options } from '../../src/options.ts';
import { Report } from '../../src/registry.ts';
import {
  AUTO,
  BUILT_AUTO,
  BUILT_SWITCH,
  built,
  ELEMENTS_CSS,
  type ProjectFiles,
  pageHtml,
  project,
  SWITCH,
} from './css-rules-fixtures.ts';

// Helpers. None asserts.

/** The sorted ids of every source half of part 5a. */
function sourceIds(input: SourceCss): string[] {
  const report = new Report();
  runSourceChecks(input, CSS_CHECKS, report);
  runSourceChecks(input, DESIGN_CHECKS, report);
  return [...report.ids()].sort();
}

/** The sorted ids of every built half of part 5a (the built half of `design-tokens` too). */
function builtIds(input: BuiltCssInput): string[] {
  const report = new Report();
  runBuiltChecks(input, CSS_AUDITS, report);
  runBuiltChecks(input, DESIGN_AUDITS, report);
  return [...report.ids()].sort();
}

/** The component `Card`, which imports its file, the file, and the home route with its page file. */
const CARD: ProjectFiles = {
  'src/components/Card.astro':
    '---\nimport \'../styles/components/card.css\';\n---\n<article class="card"><slot /></article>\n',
  'src/styles/components/card.css': '@layer components {\n  .card {\n    padding: var(--space-2);\n  }\n}\n',
  'src/pages/index.astro':
    "---\nimport Card from '../components/Card.astro';\nimport '../styles/pages/index.css';\n---\n<Card />\n",
  'src/styles/pages/index.css': '@layer page {\n  .card {\n    order: 1;\n  }\n}\n',
};

/** The project with `CARD` and more files. */
const withCard = (files: ProjectFiles = {}, options: Options = AUTO): SourceCss =>
  project({ ...CARD, ...files }, { options });

/** The built home page of the project: the global chunk, then the minified chunk of the case. */
function home(chunk: string, options: Options = AUTO): BuiltCssInput {
  const global = options === SWITCH ? BUILT_SWITCH : BUILT_AUTO;
  return built(withCard({}, options), {
    'index.html': pageHtml(
      [`${global}\n@layer components{.card{padding:var(--space-2)}}\n${chunk}`],
      '<article class="card"></article>',
    ),
  });
}

// The cases

test('the smallest project with Card gives no id in either half', () => {
  assert.deepEqual(sourceIds(withCard()), []);
  assert.deepEqual(builtIds(home('@layer page{.card{order:1}}')), []);
});

test('what an @scope holds is css-banned alone: no value rule and no design rule reads it', () => {
  const elements = ELEMENTS_CSS.replace(
    /}\n$/,
    '\n  @scope (.a) {\n    p {\n      color: red;\n      background-color: var(--color-error);\n    }\n  }\n}\n',
  );
  assert.deepEqual(sourceIds(withCard({ 'src/styles/elements.css': elements })), ['css-banned']);
  assert.deepEqual(
    builtIds(home('@layer components{@scope(.card){p{color:red;background-color:var(--color-error)}}}')),
    ['css-banned'],
  );
});

test('a literal viewport unit is css-literal alone; one that a token brings is css-banned (drift 24)', () => {
  const literal = '@layer components {\n  .card {\n    margin-inline: 100vw;\n  }\n}\n';
  assert.deepEqual(sourceIds(withCard({ 'src/styles/components/card.css': literal })), ['css-literal']);
  assert.deepEqual(builtIds(home('@layer components{.card{margin-inline:100vw}}')), ['css-literal']);
  const token = '@layer components {\n  .card {\n    inline-size: var(--size-screen);\n  }\n}\n';
  assert.deepEqual(sourceIds(withCard({ 'src/styles/components/card.css': token })), ['css-banned']);
  assert.deepEqual(builtIds(home('@layer components{.card{inline-size:var(--size-screen)}}')), ['css-banned']);
});

test('<style is:global> is css-sources alone', () => {
  const markup =
    '---\nimport \'../styles/components/card.css\';\n---\n<article class="card"><slot /></article>\n<style is:global>p{}</style>\n';
  assert.deepEqual(sourceIds(withCard({ 'src/components/Card.astro': markup })), ['css-sources']);
});

test('a non-placement declaration with !important in a page file is css-page alone', () => {
  const page = '@layer page {\n  .card {\n    color: red !important;\n  }\n}\n';
  assert.deepEqual(sourceIds(withCard({ 'src/styles/pages/index.css': page })), ['css-page']);
  assert.deepEqual(builtIds(home('@layer page{.card{color:red!important}}')), ['css-page']);
});

test('[data-mode] in a page file is css-selector alone', () => {
  const page = '@layer page {\n  .card[data-mode] {\n    order: 1;\n  }\n}\n';
  assert.deepEqual(sourceIds(withCard({ 'src/styles/pages/index.css': page })), ['css-selector']);
  assert.deepEqual(builtIds(home('@layer page{.card[data-mode]{order:1}}')), ['css-selector']);
});

test('a mode feature in an @container prelude is css-media alone, with a switch option on', () => {
  const css =
    '@layer components {\n  .card {\n    padding: var(--space-2);\n\n    @container (prefers-color-scheme: dark) {\n      padding: var(--space-4);\n    }\n  }\n}\n';
  assert.deepEqual(sourceIds(withCard({ 'src/styles/components/card.css': css }, SWITCH)), ['css-media']);
  assert.deepEqual(
    builtIds(home('@layer components{.card{@container (prefers-color-scheme:dark){padding:var(--space-4)}}}', SWITCH)),
    ['css-media'],
  );
});

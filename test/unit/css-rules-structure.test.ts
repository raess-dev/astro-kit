/**
 * The structure rules of the css group (specification, 7.1, 7.2, 7.8, 7.9, 7.11 and 8): `css-sources`,
 * `css-layer-file`, `css-layer-order`, `css-component-file`, `css-selector`, `css-page` and `css-banned`.
 *
 * Each case runs every rule of the group, the source halves or the built halves, and asserts the exact sorted id
 * list. So a case also proves that no other rule of the group reports its fact. The cases name the rows of the drift
 * and freedom matrices of 14.1 that they prove (`drift 13`, `freedom 17`). The built cases use the CSS that Lightning
 * CSS writes, with the targets of 6.1 (13.1 item 40).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  auditCssBanned,
  auditCssLayerOrder,
  auditCssPage,
  auditCssSelector,
  auditCssSources,
  type BuiltCssInput,
  checkCssBanned,
  checkCssComponentFile,
  checkCssLayerFile,
  checkCssPage,
  checkCssSelector,
  checkCssSources,
  type SourceCss,
  sourceCss,
} from '../../src/css/rules.ts';
import { renderTokens, TOKENS_FILE } from '../../src/design/tokens.ts';
import { Report } from '../../src/registry.ts';
import {
  AUTO,
  BUILT_AUTO,
  built,
  DESIGN,
  ELEMENTS_CSS,
  type ProjectFiles,
  pageHtml,
  project,
} from './css-rules-fixtures.ts';

// Helpers. None asserts.

const SOURCE_HALVES = [
  checkCssSources,
  checkCssLayerFile,
  checkCssComponentFile,
  checkCssSelector,
  checkCssPage,
  checkCssBanned,
];

const BUILT_HALVES = [auditCssSources, auditCssLayerOrder, auditCssSelector, auditCssPage, auditCssBanned];

/** The report of every source half of the group. */
function checked(input: SourceCss): Report {
  const report = new Report();
  for (const run of SOURCE_HALVES) run(input, report);
  return report;
}

/** The report of every built half of the group. */
function audited(input: BuiltCssInput): Report {
  const report = new Report();
  for (const run of BUILT_HALVES) run(input, report);
  return report;
}

const ids = (report: Report): string[] => [...report.ids()].sort();

/** Each finding as `id where`, sorted. */
const wheres = (report: Report): string[] =>
  report.findings.map((finding) => `${finding.rule} ${finding.where}`).sort();

/** A layer block as a project file writes it. */
const layer = (name: string, body: string): string => `@layer ${name} {\n${body}\n}\n`;

/** A rule with one declaration, indented as inside a layer block. */
const rule = (selector: string, declaration = 'color: var(--color-text);'): string =>
  `  ${selector} {\n    ${declaration}\n  }`;

/** A component `<Name>.astro` that imports its file, and the file with its root rule and `body`. */
function component(name: string, kebab: string, body = '', folder = ''): Record<string, string> {
  const up = '../'.repeat(folder.split('/').filter((part) => part !== '').length + 1);
  return {
    [`src/components/${folder}${name}.astro`]: `---\nimport '${up}styles/components/${kebab}.css';\n---\n<div class="${kebab}"><slot /></div>\n`,
    [`src/styles/components/${kebab}.css`]: layer('components', body === '' ? rule(`.${kebab}`) : body),
  };
}

const CARD_PATH = 'src/components/Card.astro';
const CARD_CSS = 'src/styles/components/card.css';
const CARD_ASTRO = '---\nimport \'../styles/components/card.css\';\n---\n<article class="card"><slot /></article>\n';
const CARD = component('Card', 'card');

/** The project with the component `Card` and more files. */
const withCard = (files: ProjectFiles = {}): SourceCss => project({ ...CARD, ...files });

/** The project with `Card` whose file holds `.card` and `body` in its layer block. */
const card = (body: string, files: ProjectFiles = {}): SourceCss =>
  withCard({ [CARD_CSS]: layer('components', `${rule('.card')}\n${body}`), ...files });

/** A `Card.astro` with another markup and the import of its file. */
const cardMarkup = (markup: string, files: ProjectFiles = {}): SourceCss =>
  withCard({ [CARD_PATH]: `---\nimport '../styles/components/card.css';\n---\n${markup}\n`, ...files });

/** A `Card.astro` with another frontmatter: `lines` stand after the import of its file. */
const cardImports = (lines: string, files: ProjectFiles = {}): SourceCss =>
  withCard({
    [CARD_PATH]: `---\nimport '../styles/components/card.css';\n${lines}\n---\n<article class="card"></article>\n`,
    ...files,
  });

/** The route `src/pages/index.astro` that imports its page file, and the page file with `body`. */
const ROUTE = 'src/pages/index.astro';
const PAGE_CSS = 'src/styles/pages/index.css';
const route = (body: string, files: ProjectFiles = {}): SourceCss =>
  withCard({
    [ROUTE]: "---\nimport Card from '../components/Card.astro';\nimport '../styles/pages/index.css';\n---\n<Card />\n",
    [PAGE_CSS]: layer('page', body),
    ...files,
  });

/** A built home page: `BUILT_AUTO`, then the minified chunk `css` in the same `<style>` (Astro joins them). */
const home = (css = '', body = '', head = ''): string =>
  pageHtml([css === '' ? BUILT_AUTO : `${BUILT_AUTO}\n${css}`], body, head);

/** The built input of one home page for a source input (`Card` by default). */
const builtHome = (css = '', body = '', head = '', source: SourceCss = withCard()): BuiltCssInput =>
  built(source, { 'index.html': home(css, body, head) });

/** The source input of a file list in which `unread` lists the files that were not read (no text). */
function withUnread(files: ProjectFiles, unread: readonly string[]): SourceCss {
  const all: Record<string, string | null> = {
    [TOKENS_FILE]: renderTokens(DESIGN, AUTO),
    'src/styles/elements.css': ELEMENTS_CSS,
    'src/styles/fonts.css': '',
    ...files,
  };
  const list = Object.entries(all).flatMap(([path, text]) => (text === null ? [] : [{ path, text }]));
  return sourceCss([...list, ...unread.map((path) => ({ path, text: undefined }))], DESIGN, AUTO);
}

// The smallest passing input

test('the smallest project passes every source half of the group', () => {
  assert.deepEqual(ids(checked(project())), []);
});

test('a project with a component, a route and a page file passes every source half', () => {
  assert.deepEqual(ids(checked(route(rule('.card', 'grid-column: span 2;')))), []);
});

test('the built global chunk passes every built half of the group', () => {
  assert.deepEqual(ids(audited(builtHome())), []);
});

// css-sources, source half

interface Case {
  name: string;
  input: () => SourceCss;
  ids: string[];
}

const SOURCES: Case[] = [
  // Style files outside the places of 7.1.
  {
    name: 'drift 28: src/styles/extra.css',
    input: () => withCard({ 'src/styles/extra.css': '' }),
    ids: ['css-sources'],
  },
  { name: 'drift 27: public/x.css', input: () => withCard({ 'public/x.css': 'a{}' }), ids: ['css-sources'] },
  {
    name: 'a .scss file in components/',
    input: () => withCard({ 'src/styles/components/card.scss': '' }),
    ids: ['css-sources'],
  },
  {
    name: 'a component file one folder down',
    input: () => withCard({ 'src/styles/components/a/b.css': '' }),
    ids: ['css-sources'],
  },
  { name: 'a .gitkeep passes', input: () => withCard({ 'src/styles/pages/.gitkeep': '' }), ids: [] },
  // No `<style>` in .astro, .md, .mdx, .tsx or .jsx.
  {
    name: 'drift 25: <style> in .astro',
    input: () => cardMarkup('<article class="card"></article>\n<style>.card { color: red; }</style>'),
    ids: ['css-sources'],
  },
  {
    name: 'a <style> inside <svg> in .astro',
    input: () => cardMarkup('<svg class="card"><style>a{}</style></svg>'),
    ids: ['css-sources'],
  },
  {
    name: 'a <style> in .md',
    input: () => withCard({ 'src/pages/about.md': '# About\n\n<style>p{}</style>\n' }),
    ids: ['css-sources'],
  },
  {
    name: 'a <style> in .mdx',
    input: () => withCard({ 'src/content/a.mdx': '# A\n\n<style>{`p{}`}</style>\n' }),
    ids: ['css-sources'],
  },
  {
    name: 'a <style> in .tsx',
    input: () => withCard({ 'src/lib/widget.tsx': 'export const W = () => <style>{"p{}"}</style>;\n' }),
    ids: ['css-sources'],
  },
  {
    name: 'a <style> in .jsx',
    input: () => withCard({ 'src/lib/widget.jsx': 'export const W = () => <style>{"p{}"}</style>;\n' }),
    ids: ['css-sources'],
  },
  {
    name: 'a <style> in a code block of .md passes',
    input: () =>
      withCard({ 'src/pages/about.md': '# About\n\n```html\n<style>p{}</style>\n```\n\nUse `<style>` never.\n' }),
    ids: [],
  },
  {
    name: 'a <style> in a .ts script is no markup',
    input: () => withCard({ 'src/lib/a.ts': 'export const html = "<style>p{}</style>";\n' }),
    ids: [],
  },
  {
    name: 'the word style in a comment passes',
    input: () => cardMarkup('<!-- <style> --><article class="card"></article>'),
    ids: [],
  },
  // No `<link rel="stylesheet">` in source.
  {
    name: 'a <link rel="stylesheet"> in .astro',
    input: () => cardMarkup('<link rel="stylesheet" href="/x.css"><article class="card"></article>'),
    ids: ['css-sources'],
  },
  {
    name: 'a <link rel="Preload STYLESHEET">',
    input: () => cardMarkup('<link rel="Preload STYLESHEET" href="/x.css"><article class="card"></article>'),
    ids: ['css-sources'],
  },
  {
    name: 'a <link rel="stylesheet"> inside <noscript>',
    input: () =>
      cardMarkup('<noscript><link rel="stylesheet" href="/x.css"></noscript><article class="card"></article>'),
    ids: ['css-sources'],
  },
  {
    name: 'a <link rel="preload"> passes',
    input: () => cardMarkup('<link rel="preload" href="/x.woff2"><article class="card"></article>'),
    ids: [],
  },
  // A component imports only its own file.
  {
    name: "drift 26: a component imports another component's CSS",
    input: () => cardImports("import '../styles/components/button.css';", component('Button', 'button')),
    ids: ['css-sources'],
  },
  {
    name: 'a component imports elements.css',
    input: () => cardImports("import '../styles/elements.css';"),
    ids: ['css-sources'],
  },
  {
    name: 'a component imports tokens.css',
    input: () => cardImports("import '../styles/tokens.css';"),
    ids: ['css-sources'],
  },
  {
    name: 'a component imports fonts.css',
    input: () => cardImports("import '../styles/fonts.css';"),
    ids: ['css-sources'],
  },
  {
    name: 'a component imports a bare CSS specifier',
    input: () => cardImports("import 'pkg/theme.css';"),
    ids: ['css-sources'],
  },
  {
    name: 'a component imports its own file with ?url',
    input: () =>
      withCard({
        [CARD_PATH]:
          '---\nimport url from \'../styles/components/card.css?url\';\n---\n<article class="card"></article>\n',
      }),
    ids: [],
  },
  {
    name: 'a component imports its own file by the root path',
    input: () =>
      withCard({
        [CARD_PATH]: '---\nimport \'/src/styles/components/card.css\';\n---\n<article class="card"></article>\n',
      }),
    ids: [],
  },
  {
    name: 'a component imports another file with ?inline',
    input: () => cardImports("import css from '../styles/elements.css?inline';"),
    ids: ['css-sources'],
  },
  {
    name: 'a component imports a CSS module',
    input: () => cardImports("import styles from './card.module.css';", { 'src/components/card.module.css': '' }),
    ids: ['css-sources'],
  },
  {
    name: 'a dynamic import()',
    input: () => cardImports("const css = import('../styles/pages/index.css');"),
    ids: ['css-sources'],
  },
  {
    name: 'a require()',
    input: () => cardImports("const css = require('../styles/pages/index.css');"),
    ids: ['css-sources'],
  },
  {
    name: 'a re-export',
    input: () => cardImports("export { default } from '../styles/pages/index.css';"),
    ids: ['css-sources'],
  },
  {
    name: 'comments between the tokens',
    input: () => cardImports("import /* a */ x // b\n from '../styles/elements.css';"),
    ids: ['css-sources'],
  },
  {
    name: 'a template literal with a part',
    input: () => cardImports(`const name = "x";\nconst css = import(\`../styles/components/\${name}.css\`);`),
    ids: ['css-sources'],
  },
  {
    name: 'a commented import passes',
    input: () => cardImports("// import '../styles/elements.css';\n/* import '../styles/tokens.css'; */"),
    ids: [],
  },
  {
    name: 'an import in a string passes',
    input: () => cardImports('const text = "import \'../styles/elements.css\'";'),
    ids: [],
  },
  { name: 'an import of a script passes', input: () => cardImports("import { x } from '../lib/x.ts';"), ids: [] },
  {
    name: 'an import in a <script> of .astro',
    input: () =>
      cardMarkup('<article class="card"></article>\n<script>\n  import \'../styles/elements.css\';\n</script>'),
    ids: ['css-sources'],
  },
  {
    name: 'the own import in a <script> of .astro passes',
    input: () =>
      withCard({
        [CARD_PATH]:
          '<article class="card"></article>\n<script>\n  import \'../styles/components/card.css\';\n</script>\n',
      }),
    ids: [],
  },
  // A route only its own page file; layouts and anything else none.
  { name: 'a route imports its own page file', input: () => route(rule('.card', 'order: 1;')), ids: [] },
  {
    name: 'a route imports another page file',
    input: () =>
      route(rule('.card', 'order: 1;'), {
        'src/pages/about.astro': "---\nimport '../styles/pages/index.css';\n---\n<p></p>\n",
      }),
    ids: ['css-sources'],
  },
  {
    name: 'a route of a folder imports its page file',
    input: () =>
      withCard({
        'src/pages/en/[...slug].astro': "---\nimport '../../styles/pages/en/[...slug].css';\n---\n<p></p>\n",
        'src/styles/pages/en/[...slug].css': layer('page', rule('.card', 'order: 1;')),
      }),
    ids: [],
  },
  {
    name: 'a layout imports CSS',
    input: () => withCard({ 'src/layouts/Base.astro': "---\nimport '../styles/elements.css';\n---\n<slot />\n" }),
    ids: ['css-sources'],
  },
  {
    name: 'a script imports CSS',
    input: () => withCard({ 'src/scripts/a.ts': "import '../styles/pages/index.css';\n" }),
    ids: ['css-sources'],
  },
  {
    name: 'an .mdx import line imports CSS',
    input: () => withCard({ 'src/content/a.mdx': "---\ntitle: A\n---\nimport '../styles/elements.css';\n\n# A\n" }),
    ids: ['css-sources'],
  },
  {
    name: 'an import in a code block of .mdx passes',
    input: () => withCard({ 'src/content/a.mdx': "# A\n\n```js\nimport '../styles/elements.css';\n```\n" }),
    ids: [],
  },
  {
    name: 'an import in the prose of .mdx passes',
    input: () => withCard({ 'src/content/a.mdx': "# A\n\nWrite import 'x.css' never.\n" }),
    ids: [],
  },
  // The agent mistake of 14.2.
  {
    name: 'mistake: a <style> in an .astro',
    input: () => cardMarkup('<style>.card{}</style><article class="card"></article>'),
    ids: ['css-sources'],
  },
];

for (const item of SOURCES) {
  test(`css-sources: ${item.name}`, () => {
    assert.deepEqual(ids(checked(item.input())), item.ids);
  });
}

test('css-sources: one finding for each place, with its file and line', () => {
  const input = cardImports("import '../styles/elements.css';\nimport '../styles/tokens.css';", { 'public/x.css': '' });
  assert.deepEqual(wheres(checked(input)), [
    'css-sources public/x.css',
    'css-sources src/components/Card.astro:3',
    'css-sources src/components/Card.astro:4',
  ]);
});

test('css-sources: a <style> finding has the line of the element', () => {
  assert.deepEqual(wheres(checked(cardMarkup('<article class="card">\n<style>p{}</style>\n</article>'))), [
    'css-sources src/components/Card.astro:5',
  ]);
});

// css-sources, built half

const BUILT_SOURCES: { name: string; head: string; body: string; ids: string[] }[] = [
  {
    name: 'a <link rel="stylesheet"> in the head',
    head: '<link rel="stylesheet" href="/_astro/x.css">',
    body: '',
    ids: ['css-sources'],
  },
  {
    name: 'a <link rel="stylesheet"> inside <noscript>',
    head: '',
    body: '<noscript><link rel="stylesheet" href="/x.css"></noscript>',
    ids: ['css-sources'],
  },
  { name: 'a <link rel="preload"> passes', head: '<link rel="preload" href="/x.woff2" as="font">', body: '', ids: [] },
];

for (const item of BUILT_SOURCES) {
  test(`css-sources, built: ${item.name}`, () => {
    assert.deepEqual(ids(audited(builtHome('', item.body, item.head))), item.ids);
  });
}

test('css-sources, built: one finding for each page and href', () => {
  const head = '<link rel="stylesheet" href="/a.css"><link rel="stylesheet" href="/b.css">';
  const input = built(withCard(), { 'index.html': home('', '', head), 'zimmer/index.html': home('', '', head) });
  assert.deepEqual(wheres(audited(input)), [
    'css-sources /',
    'css-sources /',
    'css-sources /zimmer/',
    'css-sources /zimmer/',
  ]);
});

// css-layer-file

const LAYER_FILE: Case[] = [
  {
    name: 'drift 29: two top-level layers',
    input: () =>
      withCard({ [CARD_CSS]: layer('components', rule('.card')) + layer('components', rule('.card:hover')) }),
    ids: ['css-layer-file'],
  },
  {
    name: 'drift 29: a nested @layer',
    input: () => withCard({ [CARD_CSS]: layer('components', `  @layer x {\n${rule('.card')}\n  }`) }),
    ids: ['css-layer-file'],
  },
  { name: 'a nested @layer statement', input: () => card('  @layer x;'), ids: ['css-layer-file'] },
  {
    name: 'a rule outside the layer block',
    input: () =>
      withCard({ [CARD_CSS]: `${layer('components', rule('.card'))}.card:hover {\n  color: var(--color-text);\n}\n` }),
    ids: ['css-layer-file'],
  },
  {
    name: 'an @media outside the layer block',
    input: () =>
      withCard({ [CARD_CSS]: `${layer('components', rule('.card'))}@media (width >= 48rem) {\n${rule('.card')}\n}\n` }),
    ids: ['css-layer-file'],
  },
  {
    name: 'a layer statement before the block',
    input: () => withCard({ [CARD_CSS]: `@layer components;\n${layer('components', rule('.card'))}` }),
    ids: ['css-layer-file'],
  },
  {
    name: 'the block of another layer',
    input: () => withCard({ [CARD_CSS]: layer('page', rule('.card')) }),
    ids: ['css-layer-file'],
  },
  {
    name: 'an anonymous layer block',
    input: () => withCard({ [CARD_CSS]: `@layer {\n${rule('.card')}\n}\n` }),
    ids: ['css-layer-file'],
  },
  { name: 'an empty elements.css', input: () => withCard({ 'src/styles/elements.css': '' }), ids: ['css-layer-file'] },
  {
    name: 'a page file in the components layer',
    input: () => route('', { [PAGE_CSS]: layer('components', rule('.card', 'order: 1;')) }),
    ids: ['css-layer-file'],
  },
  {
    name: 'a parse problem: a string that a newline ends',
    input: () => card('  .card:hover {\n    content: "x\n  }'),
    ids: ['css-layer-file'],
  },
  {
    name: 'a parse problem: a block without its }',
    input: () => withCard({ [CARD_CSS]: '@layer components {\n  .card {\n    color: var(--color-text);\n  }\n' }),
    ids: ['css-layer-file'],
  },
  {
    name: 'fonts.css with @font-face passes',
    input: () =>
      withCard({
        'src/styles/fonts.css':
          "@font-face {\n  font-family: Body;\n  src: url('../assets/fonts/body.woff2') format('woff2');\n}\n",
      }),
    ids: [],
  },
  {
    name: 'fonts.css in a layer',
    input: () => withCard({ 'src/styles/fonts.css': layer('elements', '  @font-face {\n    font-family: Body;\n  }') }),
    ids: ['css-layer-file'],
  },
  {
    name: 'fonts.css with a rule',
    input: () => withCard({ 'src/styles/fonts.css': 'body {\n  font-family: Body;\n}\n' }),
    ids: ['css-layer-file'],
  },
  {
    name: 'tokens.css is left to design-tokens',
    input: () => withCard({ [TOKENS_FILE]: ':root {\n  --x: 1px;\n}\n' }),
    ids: [],
  },
  {
    name: "a top-level @import is css-banned's alone (drift 21)",
    input: () => withCard({ [CARD_CSS]: `@import url("x.css");\n${layer('components', rule('.card'))}` }),
    ids: ['css-banned'],
  },
  {
    name: "a top-level @scope is css-banned's alone (drift 22)",
    input: () =>
      withCard({ [CARD_CSS]: `${layer('components', rule('.card'))}@scope (.card) {\n${rule('.card__body')}\n}\n` }),
    ids: ['css-banned'],
  },
];

for (const item of LAYER_FILE) {
  test(`css-layer-file: ${item.name}`, () => {
    assert.deepEqual(ids(checked(item.input())), item.ids);
  });
}

test('css-layer-file: an empty layer file is a finding about the whole file', () => {
  assert.deepEqual(wheres(checked(withCard({ 'src/styles/elements.css': '' }))), [
    'css-layer-file src/styles/elements.css',
  ]);
});

test('css-layer-file: a second block reports at its line', () => {
  const input = withCard({ [CARD_CSS]: layer('components', rule('.card')) + layer('components', rule('.card:hover')) });
  assert.deepEqual(wheres(checked(input)), ['css-layer-file src/styles/components/card.css:6']);
});

// css-layer-order

const LAYER_ORDER_CASES: { name: string; styles: string[]; ids: string[] }[] = [
  { name: 'the kit order passes', styles: [BUILT_AUTO], ids: [] },
  { name: 'a page with no <style> fails', styles: [], ids: ['css-layer-order'] },
  { name: 'another order fails', styles: [`@layer page;${BUILT_AUTO}`], ids: ['css-layer-order'] },
  {
    name: 'astro.images after page belongs to astro',
    styles: [`${BUILT_AUTO}\n@layer astro.images{:where([data-astro-image]){object-fit:cover}}`],
    ids: [],
  },
  {
    name: 'an unknown layer fails',
    styles: [`${BUILT_AUTO}\n@layer extra{.card{color:var(--color-text)}}`],
    ids: ['css-layer-order'],
  },
  {
    name: 'an unlayered rule fails',
    styles: [`${BUILT_AUTO}\n.card{color:var(--color-text)}`],
    ids: ['css-layer-order'],
  },
  {
    name: "Astro's unlayered island style passes",
    styles: [BUILT_AUTO, 'astro-island,astro-slot,astro-static-slot{display:contents}'],
    ids: [],
  },
  {
    name: 'an island style with another declaration fails',
    styles: [BUILT_AUTO, 'astro-island,astro-slot,astro-static-slot{display:contents;color:red}'],
    ids: ['css-layer-order'],
  },
  {
    name: 'an unlayered rule inside @media fails',
    styles: [`${BUILT_AUTO}\n@media (width>=48rem){.card{color:var(--color-text)}}`],
    ids: ['css-layer-order'],
  },
  {
    name: 'unlayered @keyframes fail',
    styles: [`${BUILT_AUTO}\n@keyframes spin{0%{rotate:0deg}to{rotate:180deg}}`],
    ids: ['css-layer-order'],
  },
  {
    name: 'an unlayered @property fails',
    styles: [`${BUILT_AUTO}\n@property --x{syntax:"<length>";inherits:false;initial-value:0}`],
    ids: ['css-layer-order'],
  },
  {
    name: 'an unlayered @font-face passes',
    styles: [`@font-face{font-family:X;src:url(/_astro/x.woff2)format("woff2")}${BUILT_AUTO}`],
    ids: [],
  },
  {
    name: 'a nested layer fails',
    styles: [`${BUILT_AUTO}\n@layer components{@layer x{.card{color:var(--color-text)}}}`],
    ids: ['css-layer-order'],
  },
  {
    name: 'an anonymous layer fails',
    styles: [`${BUILT_AUTO}\n@layer{.card{color:var(--color-text)}}`],
    ids: ['css-layer-order'],
  },
  {
    name: 'a parse problem of built CSS fails',
    styles: [`${BUILT_AUTO}\n@layer components{.card{color:var(--color-text)}}}`],
    ids: ['css-layer-order'],
  },
  {
    name: "an unlayered @import is css-banned's alone (drift 21)",
    styles: [`@import "x.css";${BUILT_AUTO}`],
    ids: ['css-banned'],
  },
];

for (const item of LAYER_ORDER_CASES) {
  test(`css-layer-order: ${item.name}`, () => {
    const input = built(withCard(), { 'index.html': pageHtml(item.styles) });
    assert.deepEqual(ids(audited(input)), item.ids);
  });
}

test('css-layer-order: a shared sheet reports once on each page', () => {
  const css = `${BUILT_AUTO}\n.card{color:var(--color-text)}`;
  const input = built(withCard(), {
    'index.html': pageHtml([css]),
    'zimmer/index.html': pageHtml([css]),
    '404.html': pageHtml([]),
  });
  assert.deepEqual(wheres(audited(input)), [
    'css-layer-order /',
    'css-layer-order /404.html',
    'css-layer-order /zimmer/',
  ]);
});

// css-component-file

const COMPONENT_FILE: Case[] = [
  {
    name: 'a .tsx component with its file passes',
    input: () =>
      project({
        'src/components/Card.tsx':
          'import \'../styles/components/card.css\';\nexport default () => <div class="card" />;\n',
        [CARD_CSS]: CARD[CARD_CSS] ?? '',
      }),
    ids: [],
  },
  {
    name: 'drift 30: Card.astro without card.css',
    input: () => project({ [CARD_PATH]: CARD_ASTRO }),
    ids: ['css-component-file'],
  },
  {
    name: 'drift 31: card.css whose root is .box',
    input: () => withCard({ [CARD_CSS]: layer('components', rule('.box')) }),
    ids: ['css-component-file', 'css-selector'],
  },
  {
    name: 'the root class in a nested rule counts',
    input: () =>
      withCard({
        [CARD_CSS]: layer('components', '  .card {\n    &:hover {\n      color: var(--color-text);\n    }\n  }'),
      }),
    ids: [],
  },
  {
    name: 'the root class only in a later compound',
    input: () => withCard({ [CARD_CSS]: layer('components', rule('div .card')) }),
    ids: ['css-component-file', 'css-selector'],
  },
  {
    name: 'a component without the import of its file',
    input: () => withCard({ [CARD_PATH]: '<article class="card"></article>\n' }),
    ids: ['css-component-file'],
  },
  {
    name: 'a component file without its component',
    input: () => withCard({ 'src/styles/components/ghost.css': layer('components', rule('.ghost')) }),
    ids: ['css-component-file'],
  },
  {
    name: 'a component whose name is not PascalCase',
    input: () => withCard({ 'src/components/card-item.astro': '<div></div>\n' }),
    ids: ['css-component-file'],
  },
  {
    name: 'two components with one name in two folders',
    input: () => withCard(component('Card', 'card', '', 'cards/')),
    ids: ['css-component-file'],
  },
  {
    name: 'SEOHead and SeoHead share a name',
    input: () =>
      project({
        ...component('SEOHead', 'seo-head'),
        'src/components/SeoHead.astro': "---\nimport '../styles/components/seo-head.css';\n---\n<div></div>\n",
      }),
    ids: ['css-component-file'],
  },
  {
    name: 'a component file that is not read still exists',
    input: () => withUnread({ [CARD_PATH]: CARD_ASTRO }, [CARD_CSS]),
    ids: [],
  },
  {
    name: 'a component file that is not read still needs its component',
    input: () => withUnread(CARD, ['src/styles/components/ghost.css']),
    ids: ['css-component-file'],
  },
];

for (const item of COMPONENT_FILE) {
  test(`css-component-file: ${item.name}`, () => {
    assert.deepEqual(ids(checked(item.input())), item.ids);
  });
}

test('css-component-file: each finding at the component or the file', () => {
  const input = project({
    [CARD_PATH]: '<article></article>\n',
    'src/styles/components/ghost.css': layer('components', rule('.ghost')),
    ...component('Box', 'box', '', 'more/'),
    ...component('Box', 'box', rule('.other')),
  });
  assert.deepEqual(
    wheres(checked(input)).filter((line) => line.startsWith('css-component-file')),
    [
      'css-component-file src/components/Card.astro',
      'css-component-file src/components/more/Box.astro',
      'css-component-file src/styles/components/box.css',
      'css-component-file src/styles/components/ghost.css',
    ],
  );
});

// css-selector, source half

const SELECTOR: Case[] = [
  { name: 'drift 11: #hero {}', input: () => card('  #hero {\n  }'), ids: ['css-selector'] },
  {
    name: 'drift 12: .a .b .c .d .e',
    input: () => card(rule('.card .card__a .card__b .card__c .card__d')),
    ids: ['css-selector'],
  },
  { name: 'drift 12: four compounds pass', input: () => card(rule('.card .card__a .card__b .card__c')), ids: [] },
  {
    name: 'drift 13: .card .button in card.css',
    input: () => card(rule('.card .button'), component('Button', 'button')),
    ids: ['css-selector'],
  },
  { name: 'drift 14: a bare h2 in a component file', input: () => card('  h2 {\n  }'), ids: ['css-selector'] },
  {
    name: 'drift 15: .card in elements.css',
    input: () =>
      withCard({
        'src/styles/elements.css': ELEMENTS_CSS.replace(
          '  a {',
          '  .card {\n    color: var(--color-text);\n  }\n\n  a {',
        ),
      }),
    ids: ['css-selector'],
  },
  { name: 'a type in the root compound', input: () => card(rule('div.card')), ids: ['css-selector'] },
  { name: 'a sibling combinator in a component file', input: () => card(rule('.card + .card')), ids: ['css-selector'] },
  { name: 'a sibling inside :has() passes', input: () => card(rule('.card:has(+ .card)')), ids: [] },
  {
    name: 'specificity above (0,3,x)',
    input: () => card(rule('.card .card__body:hover:focus:active:checked')),
    ids: ['css-selector'],
  },
  { name: 'a bare & outside a nested rule', input: () => card(rule('&')), ids: ['css-selector'] },
  {
    name: 'a pseudo-class the kit does not read',
    input: () => card(rule('.card:unknown-state')),
    ids: ['css-selector'],
  },
  { name: 'lead decision: .card:not(div) fails', input: () => card(rule('.card:not(div)')), ids: ['css-selector'] },
  {
    name: 'lead decision: .card:not(.card--wide, section div) fails',
    input: () => card(rule('.card:not(.card--wide, section div)')),
    ids: ['css-selector'],
  },
  {
    name: 'lead decision: a nested &:not(div) fails',
    input: () => card('  .card {\n    &:not(div) {\n      color: var(--color-text);\n    }\n  }'),
    ids: ['css-selector'],
  },
  {
    name: 'lead decision: .card .card__body:not(div) passes',
    input: () => card(rule('.card .card__body:not(div)')),
    ids: [],
  },
  { name: 'lead decision: .card:not(.card--wide) passes', input: () => card(rule('.card:not(.card--wide)')), ids: [] },
  { name: 'lead decision: .card:not(:has(img)) passes', input: () => card(rule('.card:not(:has(img))')), ids: [] },
  {
    name: 'freedom 17: .card:has(img) and .list .list__item:nth-child(2n + 1)',
    input: () =>
      card(
        rule('.card:has(img)'),
        component('List', 'list', `${rule('.list')}\n${rule('.list .list__item:nth-child(2n + 1)')}`),
      ),
    ids: [],
  },
  {
    name: 'freedom 16: .nav .nav__link[aria-current="page"]:hover in nav.css',
    input: () =>
      withCard(component('Nav', 'nav', `${rule('.nav')}\n${rule('.nav .nav__link[aria-current="page"]:hover')}`)),
    ids: [],
  },
  { name: 'freedom 2: scale in a :hover rule', input: () => card(rule('.card:hover', 'scale: 1.05;')), ids: [] },
  {
    name: 'freedom 6: keyframes and their selectors',
    input: () =>
      card(
        '  @keyframes card-in {\n    from { opacity: 0; }\n    50% { opacity: var(--opacity-half); }\n    to { opacity: 100%; }\n  }\n' +
          rule('.card:hover', 'animation-name: card-in;'),
      ),
    ids: [],
  },
  {
    name: 'a keyframe selector above 100%',
    input: () => card('  @keyframes card-in {\n    150% { opacity: 0; }\n  }'),
    ids: ['css-selector'],
  },
  {
    name: 'keyframes without the component name',
    input: () => card('  @keyframes spin {\n    to { rotate: 180deg; }\n  }'),
    ids: ['css-selector'],
  },
  {
    name: 'freedom 12: @media in a component file',
    input: () => card(`  @media (width >= 48rem) {\n${rule('.card', 'gap: var(--space-2);')}\n  }`),
    ids: [],
  },
  {
    name: 'freedom 13: @container',
    input: () =>
      card(`  @container (inline-size >= 30rem) {\n${rule('.card .card__body', 'gap: var(--space-2);')}\n  }`),
    ids: [],
  },
  {
    name: 'freedom 14: @starting-style inside a rule',
    input: () => card('  .card:hover {\n    @starting-style {\n      opacity: 0;\n    }\n  }'),
    ids: [],
  },
  {
    name: 'freedom 15: a nested &:hover',
    input: () => card('  .card:focus {\n    &:hover {\n      color: var(--color-accent);\n    }\n  }'),
    ids: [],
  },
  {
    name: 'an @font-face in a component file',
    input: () => card('  @font-face {\n    font-family: X;\n  }'),
    ids: ['css-selector'],
  },
  {
    name: 'an @property in elements.css',
    input: () =>
      withCard({
        'src/styles/elements.css': ELEMENTS_CSS.replace('  a {', '  @property --x {\n    syntax: "*";\n  }\n\n  a {'),
      }),
    ids: ['css-selector'],
  },
  {
    name: "a rule outside the block is css-layer-file's alone",
    input: () =>
      withCard({ [CARD_CSS]: `${layer('components', rule('.card'))}#hero {\n  color: var(--color-text);\n}\n` }),
    ids: ['css-layer-file'],
  },
  {
    name: "drift 22: what @scope holds is css-banned's alone",
    input: () => card(`  @scope (.card) {\n${rule('.card__body')}\n  }`),
    ids: ['css-banned'],
  },
  { name: 'a page file: a type selector', input: () => route(rule('div', 'order: 1;')), ids: ['css-selector'] },
  {
    name: 'a page file: a sibling combinator',
    input: () => route(rule('.card + .card', 'order: 1;')),
    ids: ['css-selector'],
  },
  {
    name: 'a page file: a class that is no root',
    input: () => route(rule('.card__body', 'order: 1;')),
    ids: ['css-selector'],
  },
  {
    name: 'a page file: @keyframes',
    input: () => route('  @keyframes x {\n    to { order: 1; }\n  }'),
    ids: ['css-selector'],
  },
  {
    name: 'freedom 24: @media in a page file',
    input: () =>
      route(`  @media (width >= 48rem) {\n${rule('.hero', 'grid-column: span 2;')}\n  }`, component('Hero', 'hero')),
    ids: [],
  },
];

for (const item of SELECTOR) {
  test(`css-selector: ${item.name}`, () => {
    assert.deepEqual(ids(checked(item.input())), item.ids);
  });
}

test('css-selector: a finding has the file and line of the selector', () => {
  assert.deepEqual(wheres(checked(card('  #hero {\n  }'))), ['css-selector src/styles/components/card.css:5']);
});

// css-selector, built half

const BUILT_SELECTOR: { name: string; css: string; source?: () => SourceCss; ids: string[] }[] = [
  { name: 'a root rule passes', css: '@layer components{.card{color:var(--color-text)}}', ids: [] },
  { name: 'drift 11: #hero', css: '@layer components{#hero{color:var(--color-text)}}', ids: ['css-selector'] },
  {
    name: 'a selector that starts at no root',
    css: '@layer components{.box{color:var(--color-text)}}',
    ids: ['css-selector'],
  },
  {
    name: 'drift 13: a merged list with .card .button',
    css: '@layer components{.card,.card .button{color:var(--color-text)}}',
    source: () => withCard(component('Button', 'button')),
    ids: ['css-selector'],
  },
  {
    name: 'drift 14: h2 in the components layer',
    css: '@layer components{h2{color:var(--color-text)}}',
    ids: ['css-selector'],
  },
  {
    name: 'drift 15: .card in the elements layer',
    css: '@layer elements{.card{color:var(--color-text)}}',
    ids: ['css-selector'],
  },
  {
    name: 'drift 12: five compounds',
    css: '@layer components{.card .card__a .card__b .card__c .card__d{color:var(--color-text)}}',
    ids: ['css-selector'],
  },
  {
    name: 'lead decision: .card:not(div) fails, .card .card__body:not(div) passes',
    css: '@layer components{.card:not(div),.card .card__body:not(div){color:var(--color-text)}}',
    ids: ['css-selector'],
  },
  {
    name: 'lead decision: .card .card__body:not(div) alone passes',
    css: '@layer components{.card .card__body:not(div){color:var(--color-text)}}',
    ids: [],
  },
  {
    name: 'a modifier without the root fails',
    css: '@layer components{.card--wide .card__body{color:var(--color-text)}}',
    ids: ['css-selector'],
  },
  {
    name: 'freedom 2 and 17: :has(img) and :hover',
    css: '@layer components{.card:has(img){color:var(--color-text)}.card:hover{scale:1.05}}',
    ids: [],
  },
  {
    name: 'freedom 6: built keyframes 0% and to',
    css: '@layer components{@keyframes card-in{0%{opacity:0}50%{opacity:var(--opacity-half)}to{opacity:1}}.card{animation-name:card-in}}',
    ids: [],
  },
  {
    name: 'keyframes of no component',
    css: '@layer components{@keyframes spin{to{rotate:180deg}}}',
    ids: ['css-selector'],
  },
  {
    name: 'freedom 14 and 15: nesting and @starting-style',
    css: '@layer components{.card{&:hover{color:var(--color-accent)}@starting-style{opacity:0}}}',
    ids: [],
  },
  {
    name: 'freedom 12 and 13: @media and @container',
    css: '@layer components{@media (width>=48rem){.card{gap:var(--space-2)}}@container (inline-size>=30rem){.card .card__body{gap:var(--space-2)}}}',
    ids: [],
  },
  {
    name: "freedom 16 and 17: the minifier's [a=b] and odd",
    css: '@layer components{.nav .nav__link[aria-current=page]:hover,.list .list__item:nth-child(odd){color:var(--color-text)}}',
    source: () => project({ ...component('Nav', 'nav'), ...component('List', 'list') }),
    ids: [],
  },
  {
    name: 'freedom 24: @media in the page layer',
    css: '@layer page{@media (width>=48rem){.hero{grid-column:span 2}}}',
    source: () => withCard(component('Hero', 'hero')),
    ids: [],
  },
  { name: 'a type in the page layer', css: '@layer page{div{grid-column:span 2}}', ids: ['css-selector'] },
  {
    name: "what @scope holds is css-banned's alone",
    css: '@layer components{@scope(.card){.card__body{color:var(--color-text)}}}',
    ids: ['css-banned'],
  },
];

for (const item of BUILT_SELECTOR) {
  test(`css-selector, built: ${item.name}`, () => {
    const source = item.source === undefined ? withCard() : item.source();
    assert.deepEqual(ids(audited(builtHome(item.css, '', '', source))), item.ids);
  });
}

test('css-selector, built: one finding for each page and selector', () => {
  const css = `${BUILT_AUTO}\n@layer components{#hero,#hero .card{color:var(--color-text)}}`;
  const input = built(withCard(), { 'index.html': pageHtml([css]), 'zimmer/index.html': pageHtml([css]) });
  assert.deepEqual(wheres(audited(input)), [
    'css-selector /',
    'css-selector /',
    'css-selector /zimmer/',
    'css-selector /zimmer/',
  ]);
});

// css-page

const PAGE: Case[] = [
  {
    name: 'drift 16: color in a page file',
    input: () => route(rule('.card', 'color: var(--color-text);')),
    ids: ['css-page'],
  },
  {
    name: 'a custom property in a page file',
    input: () => route(rule('.card', '--card-pad: var(--space-2);')),
    ids: ['css-page'],
  },
  { name: 'gap from a token passes', input: () => route(rule('.card', 'gap: var(--space-2);')), ids: [] },
  {
    name: 'every placement property passes',
    input: () =>
      route(
        rule(
          '.card',
          'grid-column: 1 / -1;\n    grid-row-start: 2;\n    grid-area: a;\n    order: 1;\n    place-self: center;\n    justify-items: start;\n    align-content: end;\n    row-gap: var(--space-1);',
        ),
      ),
    ids: [],
  },
  {
    name: "a non-placement declaration with url() is css-page's alone",
    input: () => route(rule('.card', 'background-image: url("/a.png");')),
    ids: ['css-page'],
  },
  {
    name: 'freedom 24: placement inside @media',
    input: () =>
      route(`  @media (width >= 48rem) {\n${rule('.hero', 'grid-column: span 2;')}\n  }`, component('Hero', 'hero')),
    ids: [],
  },
];

for (const item of PAGE) {
  test(`css-page: ${item.name}`, () => {
    assert.deepEqual(ids(checked(item.input())), item.ids);
  });
}

const BUILT_PAGE: { name: string; css: string; ids: string[] }[] = [
  { name: 'placement passes', css: '@layer page{.card{grid-column:span 2}}', ids: [] },
  { name: 'drift 16: color fails', css: '@layer page{.card{color:var(--color-text)}}', ids: ['css-page'] },
  {
    name: "the minifier's grid-area and the two gaps pass",
    css: '@layer page{.card{row-gap:var(--space-2);column-gap:var(--space-2);grid-area:1/2}}',
    ids: [],
  },
  {
    name: 'color in the components layer is no page declaration',
    css: '@layer components{.card{color:var(--color-text)}}',
    ids: [],
  },
];

for (const item of BUILT_PAGE) {
  test(`css-page, built: ${item.name}`, () => {
    assert.deepEqual(ids(audited(builtHome(item.css))), item.ids);
  });
}

// css-banned, source half

const BANNED: Case[] = [
  {
    name: 'drift 20: !important in a component',
    input: () => card(rule('.card:hover', 'color: var(--color-text) !important;')),
    ids: ['css-banned'],
  },
  {
    name: '!important in elements.css',
    input: () =>
      withCard({
        'src/styles/elements.css': ELEMENTS_CSS.replace('var(--color-link);', 'var(--color-link) !important;'),
      }),
    ids: ['css-banned'],
  },
  {
    name: '!important on a placement property of a page file',
    input: () => route(rule('.card', 'order: 1 !important;')),
    ids: ['css-banned'],
  },
  { name: 'drift 21: @import inside the block', input: () => card('  @import url("x.css");'), ids: ['css-banned'] },
  {
    name: 'drift 22: @scope',
    input: () => card(`  @scope (.card) {\n${rule('.card__body')}\n  }`),
    ids: ['css-banned'],
  },
  {
    name: 'drift 23: a style attribute',
    input: () => cardMarkup('<article class="card" style="color: red"></article>'),
    ids: ['css-banned'],
  },
  {
    name: 'a style attribute with an expression',
    input: () => cardMarkup('<article class="card" style={css}></article>'),
    ids: ['css-banned'],
  },
  {
    name: "a style attribute in .md is the built half's",
    input: () => withCard({ 'src/pages/about.md': '<p style="color: red">A</p>\n' }),
    ids: [],
  },
  {
    name: 'is:global on an element',
    input: () => cardMarkup('<article class="card" is:global></article>'),
    ids: ['css-banned'],
  },
  {
    name: "<style is:global> is css-sources' alone",
    input: () => cardMarkup('<style is:global>p{}</style><article class="card"></article>'),
    ids: ['css-sources'],
  },
  { name: ':global() in a selector', input: () => card(rule('.card :global(.x)')), ids: ['css-banned'] },
  {
    name: ':global() in a nested selector',
    input: () => card('  .card {\n    & :global(.x) {\n      color: var(--color-text);\n    }\n  }'),
    ids: ['css-banned'],
  },
  {
    name: 'drift 24: inline-size from a 100vw token',
    input: () => card(rule('.card:hover', 'inline-size: var(--size-screen);')),
    ids: ['css-banned'],
  },
  {
    name: 'a viewport unit through a local',
    input: () => card('  .card {\n    --card-w: var(--size-screen);\n    max-width: var(--card-w);\n  }'),
    ids: ['css-banned'],
  },
  {
    name: 'a viewport unit on margin-inline',
    input: () => card(rule('.card:hover', 'margin-inline: var(--size-screen);')),
    ids: ['css-banned'],
  },
  {
    name: "a literal viewport unit is css-literal's (the values tests)",
    input: () => card(rule('.card:hover', 'margin-inline: 10vw;')),
    ids: [],
  },
  {
    name: 'a viewport unit on block-size passes',
    input: () => card(rule('.card:hover', 'block-size: var(--size-screen);')),
    ids: [],
  },
  {
    name: 'forced-color-adjust: none',
    input: () => card(rule('.card:hover', 'forced-color-adjust: none;')),
    ids: ['css-banned'],
  },
  {
    name: 'forced-color-adjust: auto passes',
    input: () => card(rule('.card:hover', 'forced-color-adjust: auto;')),
    ids: [],
  },
  {
    name: 'overflow: hidden on body',
    input: () =>
      withCard({
        'src/styles/elements.css': ELEMENTS_CSS.replace(
          'background-color: var(--color-page);',
          'background-color: var(--color-page);\n    overflow: hidden;',
        ),
      }),
    ids: ['css-banned'],
  },
  {
    name: 'overflow-x: clip on :root',
    input: () =>
      withCard({
        'src/styles/elements.css': ELEMENTS_CSS.replace('  a {', '  :root {\n    overflow-x: clip;\n  }\n\n  a {'),
      }),
    ids: ['css-banned'],
  },
  {
    name: 'overflow-inline: hidden on html',
    input: () =>
      withCard({
        'src/styles/elements.css': ELEMENTS_CSS.replace(
          '  a {',
          '  html {\n    overflow-inline: hidden;\n  }\n\n  a {',
        ),
      }),
    ids: ['css-banned'],
  },
  {
    name: 'overflow: auto on body passes',
    input: () =>
      withCard({
        'src/styles/elements.css': ELEMENTS_CSS.replace(
          'background-color: var(--color-page);',
          'background-color: var(--color-page);\n    overflow: auto;',
        ),
      }),
    ids: [],
  },
  {
    name: 'overflow: hidden on a component passes',
    input: () => card(rule('.card:hover', 'overflow: hidden;')),
    ids: [],
  },
  {
    name: 'url() in a component',
    input: () => card(rule('.card:hover', 'background-image: url("/a.png");')),
    ids: ['css-banned'],
  },
  {
    name: 'a string in image-set() is a URL',
    input: () => card(rule('.card:hover', 'background-image: image-set("/a.avif" 1x);')),
    ids: ['css-banned'],
  },
  {
    name: 'url() in @font-face of fonts.css passes',
    input: () =>
      withCard({
        'src/styles/fonts.css':
          "@font-face {\n  font-family: Body;\n  src: url('../assets/fonts/body.woff2') format('woff2');\n}\n",
      }),
    ids: [],
  },
  {
    name: 'tokens.css is left to design-tokens',
    input: () => withCard({ [TOKENS_FILE]: ':root {\n  --x: url("/a.png") !important;\n}\n' }),
    ids: [],
  },
];

for (const item of BANNED) {
  test(`css-banned: ${item.name}`, () => {
    assert.deepEqual(ids(checked(item.input())), item.ids);
  });
}

test('css-banned: a finding has the file and line of the place', () => {
  assert.deepEqual(wheres(checked(cardMarkup('<article class="card"\n  style="color: red"></article>'))), [
    'css-banned src/components/Card.astro:4',
  ]);
});

// css-banned, built half

const BUILT_BANNED: { name: string; css: string; body?: string; ids: string[] }[] = [
  { name: "the kit's !important in reset passes", css: '', ids: [] },
  {
    name: 'drift 20: !important in components',
    css: '@layer components{.card{color:var(--color-text)!important}}',
    ids: ['css-banned'],
  },
  {
    name: 'drift 21: @import',
    css: '@import "x.css";@layer components{.card{color:var(--color-text)}}',
    ids: ['css-banned'],
  },
  {
    name: 'drift 22: @scope',
    css: '@layer components{@scope(.card){.card__body{color:var(--color-text)}}}',
    ids: ['css-banned'],
  },
  { name: 'drift 23: a style attribute', css: '', body: '<p style="color:red">A</p>', ids: ['css-banned'] },
  {
    name: 'drift 24: inline-size from a 100vw token',
    css: '@layer components{.card{inline-size:var(--size-screen)}}',
    ids: ['css-banned'],
  },
  {
    name: 'a viewport unit through a local',
    css: '@layer components{.card{--card-w:var(--size-screen);inline-size:var(--card-w)}}',
    ids: ['css-banned'],
  },
  { name: 'url() in components', css: '@layer components{.card{background-image:url(/a.png)}}', ids: ['css-banned'] },
  {
    name: 'url() in an unlayered rule',
    css: '.card{background-image:url(/a.png)}',
    ids: ['css-banned', 'css-layer-order'],
  },
  {
    name: 'overflow: hidden on body and forced-color-adjust: none',
    css: '@layer elements{body{overflow:hidden}html{forced-color-adjust:none}}',
    ids: ['css-banned'],
  },
  { name: 'overflow-x: clip on :root', css: '@layer elements{:root{overflow-x:clip}}', ids: ['css-banned'] },
];

for (const item of BUILT_BANNED) {
  test(`css-banned, built: ${item.name}`, () => {
    assert.deepEqual(ids(audited(builtHome(item.css, item.body ?? ''))), item.ids);
  });
}

test('css-banned, built: the facts of a page are distinct findings', () => {
  const css = '@layer elements{body{overflow:hidden}html{forced-color-adjust:none}}';
  assert.deepEqual(wheres(audited(builtHome(css, '<p style="color:red">A</p>'))), [
    'css-banned /',
    'css-banned /',
    'css-banned /',
  ]);
});

test('css-banned, built: an unlayered @font-face with url() passes', () => {
  const css = `@font-face{font-family:X;src:url(/_astro/x.woff2)format("woff2")}${BUILT_AUTO}`;
  assert.deepEqual(ids(audited(built(withCard(), { 'index.html': pageHtml([css]) }))), []);
});

// The rows of the other groups give no id of this group (14.1)

const OTHER_SOURCE: Case[] = [
  { name: 'drift 1: color: #c00', input: () => card(rule('.card:hover', 'color: #c00;')), ids: [] },
  { name: 'drift 2: padding: 13px', input: () => card(rule('.card:hover', 'padding: 13px;')), ids: [] },
  { name: 'drift 3: color: red', input: () => card(rule('.card:hover', 'color: red;')), ids: [] },
  {
    name: 'drift 4: a var() fallback',
    input: () => card(rule('.card:hover', 'margin: var(--space-2, 1rem);')),
    ids: [],
  },
  {
    name: 'drift 5: a custom property in elements.css',
    input: () =>
      withCard({
        'src/styles/elements.css': ELEMENTS_CSS.replace(
          'color: var(--color-link);',
          'color: var(--color-link);\n    --brand: var(--color-a);',
        ),
      }),
    ids: [],
  },
  {
    name: 'drift 6: padding: var(--color-accent)',
    input: () => card(rule('.card:hover', 'padding: var(--color-accent);')),
    ids: [],
  },
  {
    name: 'drift 7: a local off the root',
    input: () => card(rule('.card .card__body', '--card-pad: var(--space-2);')),
    ids: [],
  },
  {
    name: 'drift 8: a local read in another component',
    input: () =>
      card(
        rule('.card:hover', 'padding: var(--card-pad);'),
        component('Box', 'box', rule('.box', 'padding: var(--card-pad);')),
      ),
    ids: [],
  },
  { name: 'drift 9: var(--space-99)', input: () => card(rule('.card:hover', 'padding: var(--space-99);')), ids: [] },
  {
    name: 'drift 17: @media (width < 777px)',
    input: () => card(`  @media (width < 777px) {\n${rule('.card', 'gap: var(--space-2);')}\n  }`),
    ids: [],
  },
  {
    name: 'drift 18: @media (width < var(--bp))',
    input: () => card(`  @media (width < var(--bp)) {\n${rule('.card', 'gap: var(--space-2);')}\n  }`),
    ids: [],
  },
  {
    name: 'drift 19: @media (min-resolution: 2dppx)',
    input: () => card(`  @media (min-resolution: 2dppx) {\n${rule('.card', 'gap: var(--space-2);')}\n  }`),
    ids: [],
  },
  {
    name: 'drift 35: a background color not in a pair',
    input: () => card(rule('.card:hover', 'background-color: var(--color-error);')),
    ids: [],
  },
];

for (const item of OTHER_SOURCE) {
  test(`other groups: ${item.name}`, () => {
    assert.deepEqual(ids(checked(item.input())), item.ids);
  });
}

/** The freedom rows of 14.1 in `card.css` (16 and 17 have their own components above, 24 its page file). */
const FREEDOM: { row: number; css: string }[] = [
  { row: 1, css: rule('.card:hover', 'rotate: 180deg;') },
  { row: 2, css: rule('.card:hover', 'scale: 1.05;') },
  { row: 3, css: rule('.card:hover', 'transform: translateY(var(--space-1)) rotate(-2deg);') },
  { row: 4, css: rule('.card:hover', 'filter: blur(var(--space-1)) grayscale(0.4);') },
  { row: 5, css: rule('.card:hover', 'background-image: var(--gradient-hero);') },
  {
    row: 6,
    css: `  @keyframes card-in {\n    from { opacity: 0; }\n    50% { opacity: var(--opacity-half); }\n    to { opacity: 100%; }\n  }\n${rule('.card:hover', 'animation-name: card-in;')}`,
  },
  { row: 7, css: rule('.card:hover', 'width: calc(100% - var(--space-4));') },
  { row: 8, css: rule('.card:hover', 'padding: calc(var(--space-2) * 1.5);') },
  {
    row: 9,
    css: rule(
      '.card:hover',
      'grid-template-columns: minmax(var(--space-4), 1fr) minmax(0, var(--size-content)) minmax(var(--space-4), 1fr);',
    ),
  },
  { row: 10, css: rule('.card:hover', 'clip-path: polygon(0 0, 100% 0, 100% 85%, 0 100%);') },
  { row: 11, css: rule('.card:hover', 'object-position: 30% 20%;') },
  { row: 12, css: `  @media (width >= 48rem) {\n${rule('.card', 'gap: var(--space-2);')}\n  }` },
  { row: 13, css: `  @container (inline-size >= 30rem) {\n${rule('.card .card__body', 'gap: var(--space-2);')}\n  }` },
  { row: 14, css: '  .card:focus {\n    @starting-style {\n      opacity: 0;\n    }\n  }' },
  { row: 15, css: '  .card:focus {\n    &:hover {\n      color: var(--color-accent);\n    }\n  }' },
  { row: 18, css: rule('.card:hover', 'anchor-name: --menu;\n    position-anchor: --menu;') },
  { row: 19, css: rule('.card:hover', 'font-variation-settings: "opsz" 32;') },
  { row: 20, css: rule('.card:hover', 'aspect-ratio: var(--size-wide);') },
  { row: 21, css: rule('.card:hover', 'box-shadow: var(--shadow-card);') },
  { row: 22, css: rule('.card:hover', 'stroke-width: var(--line-1);') },
  { row: 23, css: rule('.card:hover', 'animation-iteration-count: 3;') },
];

for (const item of FREEDOM) {
  test(`freedom ${item.row}: no id of the group`, () => {
    assert.deepEqual(ids(checked(card(item.css))), []);
  });
}

const OTHER_BUILT: { name: string; css: string; body: string; ids: string[] }[] = [
  { name: 'drift 10: .stack on a page', css: '', body: '<div class="stack"></div>', ids: [] },
  { name: 'drift 36: an undeclared class on a page', css: '', body: '<p class="nope">A</p>', ids: [] },
  { name: 'drift 38: a <table> with no table rule', css: '', body: '<table><tr><td>A</td></tr></table>', ids: [] },
  {
    name: 'drift 1, built: color:#c00',
    css: '@layer components{.card{color:#c00}}',
    body: '<div class="card"></div>',
    ids: [],
  },
  {
    name: 'freedom 5, built: a gradient token',
    css: '@layer components{.card{background-image:var(--gradient-hero)}}',
    body: '<div class="card"></div>',
    ids: [],
  },
];

for (const item of OTHER_BUILT) {
  test(`other groups, built: ${item.name}`, () => {
    assert.deepEqual(ids(audited(builtHome(item.css, item.body))), item.ids);
  });
}

test('other groups, built: drift 33, a custom property in the tokens layer that design.md does not hold', () => {
  const css = BUILT_AUTO.replace('--stack-gap:var(--space-2)}', '--stack-gap:var(--space-2);--extra:1px}');
  assert.deepEqual(ids(audited(built(withCard(), { 'index.html': pageHtml([css]) }))), []);
});

// The five agent mistakes of 14.2

test('mistakes: a raw color, padding: 13px and a 777px media query give no id of the group', () => {
  const css = `${rule('.card:hover', 'color: #c00;\n    padding: 13px;')}\n  @media (width < 777px) {\n${rule('.card', 'gap: var(--space-2);')}\n  }`;
  assert.deepEqual(ids(checked(card(css))), []);
});

test('mistakes: an undeclared class gives no id of the group', () => {
  assert.deepEqual(ids(audited(builtHome('', '<p class="nope">A</p>'))), []);
});

// Hostile input

test('hostile input gives findings, never a throw', () => {
  const deep = `${'('.repeat(200)}${')'.repeat(200)}`;
  const hostile = withCard({
    [CARD_PATH]: `---\nimport \`../styles/${'$'.repeat(50)}{x.css\`;\nconst re = /'/;\nimport('\n---\n<div style`,
    [CARD_CSS]: `@layer components { .card:not(${'div:not('.repeat(60)}a${')'.repeat(60)}) { color: ${deep}; } .__proto__ {} }`,
    'src/lib/a.ts': "require('constructor.css'); import '__proto__.css';\n`${`${`",
    'src/content/a.mdx': '```\nimport "x.css"\n',
  });
  assert.doesNotThrow(() => checked(hostile));
  assert.doesNotThrow(() =>
    audited(
      builtHome('@layer components{@scope{', '<div style><noscript><link rel=stylesheet></noscript>', '', hostile),
    ),
  );
});

// The review of part 5a: each case fails without its fix

test('css-banned: :is() and :where() that name html, body or :root select them, in both halves', () => {
  const root = (selector: string, declaration = 'overflow: hidden;'): SourceCss =>
    withCard({ 'src/styles/elements.css': ELEMENTS_CSS.replace('  a {', `${rule(selector, declaration)}\n\n  a {`) });
  for (const selector of [':is(html, body)', ':where(body)', ':where(:root)', ':is(p, :where(html))']) {
    assert.deepEqual(ids(checked(root(selector))), ['css-banned'], selector);
  }
  assert.deepEqual(ids(checked(root(':is(p, li)'))), []);
  assert.deepEqual(ids(checked(root(':not(body)'))), []);
  for (const css of [
    '@layer elements{:is(html,body){overflow:hidden}}',
    '@layer elements{:where(body){overflow:clip}}',
  ]) {
    assert.deepEqual(ids(audited(builtHome(css))), ['css-banned'], css);
  }
  assert.deepEqual(ids(audited(builtHome('@layer elements{:is(p,li){overflow:hidden}}'))), []);
});

test('css-banned: overflow fails on html or body by its first value, the x axis', () => {
  const body = (value: string): SourceCss =>
    withCard({
      'src/styles/elements.css': ELEMENTS_CSS.replace(
        'background-color: var(--color-page);',
        `background-color: var(--color-page);\n    overflow: ${value};`,
      ),
    });
  assert.deepEqual(ids(checked(body('auto hidden'))), []);
  assert.deepEqual(ids(checked(body('auto clip'))), []);
  assert.deepEqual(ids(checked(body('hidden auto'))), ['css-banned']);
  assert.deepEqual(ids(checked(body('clip'))), ['css-banned']);
  assert.deepEqual(ids(audited(builtHome('@layer elements{body{overflow:auto hidden}}'))), []);
  assert.deepEqual(ids(audited(builtHome('@layer elements{body{overflow:hidden auto}}'))), ['css-banned']);
});

test('css-banned: built :global() fails; the same selector without it passes', () => {
  assert.deepEqual(ids(audited(builtHome('@layer components{.card :global(.x){color:var(--color-text)}}'))), [
    'css-banned',
  ]);
  assert.deepEqual(ids(audited(builtHome('@layer components{.card .card__x{color:var(--color-text)}}'))), []);
});

test('css-banned: !important on a non-placement declaration of a page file is css-page alone, in both halves', () => {
  assert.deepEqual(ids(checked(route(rule('.card', 'color: red !important;')))), ['css-page']);
  assert.deepEqual(ids(checked(route(rule('.card', 'order: 1 !important;')))), ['css-banned']);
  assert.deepEqual(ids(audited(builtHome('@layer page{.card{color:red!important}}'))), ['css-page']);
  assert.deepEqual(ids(audited(builtHome('@layer page{.card{order:1!important}}'))), ['css-banned']);
});

test('css-selector: a type inside :not() of a root compound through :where() or :is() fails, in both halves', () => {
  for (const selector of [
    ':where(.card):not(div)',
    ':where(.card).card--x:not(div)',
    ':where(.card, .card):not(span)',
    ':is(.card, .card):not(span)',
    ':where(.card:not(div))',
    ':is(.card:not(div) .card__body)',
  ]) {
    assert.deepEqual(ids(checked(card(rule(selector)))), ['css-selector'], selector);
  }
  for (const selector of [
    ':where(.card):not(.card--x)',
    ':is(.card .card__body:not(div))',
    ':where(.card) .card__body:not(div)',
  ]) {
    assert.deepEqual(ids(checked(card(rule(selector)))), [], selector);
  }
  assert.deepEqual(ids(audited(builtHome('@layer components{:where(.card):not(div){color:var(--color-text)}}'))), [
    'css-selector',
  ]);
  assert.deepEqual(
    ids(audited(builtHome('@layer components{:where(.card):not(.card--x){color:var(--color-text)}}'))),
    [],
  );
});

test('css-selector: a problem of a nested selector stands at the line of the nested rule', () => {
  const nested = (inner: string): SourceCss =>
    withCard({
      [CARD_CSS]: layer(
        'components',
        `  .card {\n    color: var(--color-text);\n\n    ${inner} {\n      color: var(--color-text);\n    }\n  }`,
      ),
    });
  assert.deepEqual(wheres(checked(nested('& .a .b .c .d'))), [`css-selector ${CARD_CSS}:5`]);
  assert.deepEqual(wheres(checked(nested('+ &'))), [`css-selector ${CARD_CSS}:5`]);
  assert.deepEqual(wheres(checked(nested('& + &'))), [`css-selector ${CARD_CSS}:5`]);
  assert.deepEqual(wheres(checked(card(rule('.card .a .b .c .d')))), [`css-selector ${CARD_CSS}:5`]);
});

test('css-sources: an import() in a template expression of an .astro file fails; prose and strings do not', () => {
  const markup = (body: string): SourceCss => cardMarkup(`<article class="card">\n${body}\n</article>`);
  assert.deepEqual(wheres(checked(markup("{import('../styles/elements.css') && null}"))), [
    'css-sources src/components/Card.astro:5',
  ]);
  assert.deepEqual(ids(checked(markup("<p title={import('../styles/pages/index.css')}>A</p>"))), ['css-sources']);
  assert.deepEqual(ids(checked(markup("{cond && (\n  import('./x.css')\n)}"))), ['css-sources']);
  for (const body of [
    "<p>We import 'x.css' files.</p>",
    '<p title="{import(\'x.css\')}">A</p>',
    '{\'import "x.css"\'}',
    "{/* import('x.css') */}",
    "<!-- {import('x.css')} -->",
    '<script>const a = 1;</script><p>{title}</p>',
  ]) {
    assert.deepEqual(ids(checked(markup(body))), [], body);
  }
  assert.deepEqual(
    ids(
      checked(
        withCard({
          'src/pages/post.mdx': "# Post\n\n{import('../styles/elements.css')}\n\n```\n{import('x.css')}\n```\n",
        }),
      ),
    ),
    ['css-sources'],
  );
});

test('css-sources: the YAML frontmatter of .md and .mdx imports nothing', () => {
  assert.deepEqual(
    ids(checked(withCard({ 'src/pages/blog.md': "---\ntitle: How we import 'tokens.css' files\n---\n# Hi\n" }))),
    [],
  );
  assert.deepEqual(
    ids(checked(withCard({ 'src/pages/post.mdx': "---\ntitle: We import 'x.css' here\n---\n# Hi\n" }))),
    [],
  );
  assert.deepEqual(
    ids(
      checked(withCard({ 'src/pages/post.mdx': "---\ntitle: Post\n---\nimport '../styles/elements.css';\n\n# Hi\n" })),
    ),
    ['css-sources'],
  );
});

test('css-sources, built half: a second layered <style> on a page fails; the island style and @import do not count', () => {
  const second = '@layer components{.card{color:var(--color-text)}}';
  assert.deepEqual(ids(audited(built(withCard(), { 'index.html': pageHtml([BUILT_AUTO, second]) }))), ['css-sources']);
  assert.deepEqual(ids(audited(built(withCard(), { 'index.html': pageHtml([`${BUILT_AUTO}\n${second}`]) }))), []);
  const island = 'astro-island,astro-slot,astro-static-slot{display:contents}';
  assert.deepEqual(ids(audited(built(withCard(), { 'index.html': pageHtml([BUILT_AUTO, island]) }))), []);
  const imported = `@import "https://example.com/x.css";${second}`;
  assert.deepEqual(ids(audited(built(withCard(), { 'index.html': pageHtml([BUILT_AUTO, imported]) }))), ['css-banned']);
});

test('css-layer-order: the island exemption is display: contents alone; a layer below an at-rule fails', () => {
  const island = (css: string): BuiltCssInput => built(withCard(), { 'index.html': pageHtml([BUILT_AUTO, css]) });
  assert.deepEqual(ids(audited(island('astro-island,astro-slot,astro-static-slot{display:block}'))), [
    'css-layer-order',
  ]);
  assert.deepEqual(ids(audited(island('astro-island,astro-slot,astro-static-slot{display:contents!important}'))), [
    'css-layer-order',
  ]);
  assert.deepEqual(ids(audited(builtHome('@media (width>=48rem){@layer page{.card{order:2}}}'))), ['css-layer-order']);
  assert.deepEqual(ids(audited(builtHome('@layer page{@media (width>=48rem){.card{order:2}}}'))), []);
});

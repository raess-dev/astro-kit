/**
 * The coverage rules of the css group (specification, 7.1, 7.5, 7.8 and 8): `css-classes`, `css-unused` and
 * `css-element-coverage`. All three are build rules.
 *
 * Each sentence of a rule row has a passing case and a failing case that changes one thing. Each case asserts the
 * exact sorted list of the ids that these three rules give. They run through the runner of `src/css/rules.ts`. The
 * built strings are what Lightning CSS writes with the targets of 6.1 (13.1 item 40): the global chunk of the
 * fixtures, with the `elements` layer of the case, and a line feed before each chunk of component or page CSS, as
 * Astro joins them.
 *
 * The drift rows 36, 37 and 38 of 14.1 run here. The freedom rows run here through every rule of the coverage group
 * (these three, `design-specs`, `design-pairs` and the built half of `design-tokens`): none gives an id.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { COVERED_ELEMENTS } from '../../src/css/rules/coverage.ts';
import {
  type BuiltCssInput,
  CSS_AUDITS,
  ELEMENTS_FILE,
  runBuiltChecks,
  runSourceChecks,
  type SourceCss,
} from '../../src/css/rules.ts';
import { DESIGN_AUDITS, DESIGN_CHECKS } from '../../src/design/rules.ts';
import { Report } from '../../src/registry.ts';
import { BUILT_AUTO, built, ELEMENTS_CSS, type ProjectFiles, pageHtml, project } from './css-rules-fixtures.ts';

// Helpers. None asserts.

/** The rules of this file. */
const COVERAGE: ReadonlySet<string> = new Set(['css-classes', 'css-unused', 'css-element-coverage']);

const AUDITS = CSS_AUDITS.filter((check) => COVERAGE.has(check.id));

/** The report of the three rules on a built input. */
function audited(input: BuiltCssInput, report: Report = new Report()): Report {
  runBuiltChecks(input, AUDITS, report);
  return report;
}

/** The report of every rule of the coverage group: these three, `design-specs`, `design-pairs`, `design-tokens`. */
function group(source: SourceCss, input: BuiltCssInput): Report {
  const report = new Report();
  runSourceChecks(source, DESIGN_CHECKS, report);
  runBuiltChecks(input, AUDITS, report);
  runBuiltChecks(input, DESIGN_AUDITS, report);
  return report;
}

const ids = (report: Report): string[] => [...report.ids()].sort();

/** Each finding as `<id> <where> <detail>`, sorted. */
const findings = (report: Report): string[] =>
  report.findings.map((finding) => `${finding.rule} ${finding.where} ${finding.detail ?? ''}`).sort();

/** The `elements` layer of `BUILT_AUTO`: the minified `ELEMENTS_CSS`. */
const ELEMENTS_BUILT =
  '@layer elements{body{color:var(--color-text);background-color:var(--color-page)}a{color:var(--color-link)}:focus-visible{outline-color:var(--color-focus)}}';

/** `ELEMENTS_CSS` with more rules at the end of its layer block. */
const elementsWith = (extra: string): string => ELEMENTS_CSS.replace(/}\n$/, `\n  ${extra}\n}\n`);

/** The global chunk with more minified rules at the end of its `elements` layer, as the minifier writes them. */
const globalWith = (extra: string): string =>
  BUILT_AUTO.replace(ELEMENTS_BUILT, ELEMENTS_BUILT.replace(/}$/, `${extra}}`));

/** A built page: the global chunk, then each chunk on a line of its own, in one `<style>`. */
const page = (body: string, chunks: readonly string[] = [], global: string = BUILT_AUTO): string =>
  pageHtml([[global, ...chunks].join('\n')], body);

/** A project and its client directory. */
function site(
  files: ProjectFiles,
  dist: Readonly<Record<string, string>>,
): { source: SourceCss; input: BuiltCssInput } {
  const source = project(files);
  return { source, input: built(source, dist) };
}

// A component file and its built form

const CARD_FILE = 'src/styles/components/card.css';

const CARD_CSS =
  '@layer components {\n  .card {\n    padding: var(--space-2);\n  }\n\n  .card--wide {\n    padding: var(--space-4);\n  }\n\n  .card .card__body {\n    gap: var(--space-2);\n  }\n}\n';

const CARD_BUILT =
  '@layer components{.card{padding:var(--space-2)}.card--wide{padding:var(--space-4)}.card .card__body{gap:var(--space-2)}}';

const CARD_BODY = '<div class="card card--wide"><div class="card__body">Text</div></div>';

// The whole group on the smallest project

test('the smallest project and an empty page give no id of the coverage group', () => {
  const { source, input } = site({}, { 'index.html': page('') });
  assert.deepEqual(ids(group(source, input)), []);
});

test('COVERED_ELEMENTS holds the 37 elements of the css-element-coverage row, and no exempt one', () => {
  assert.equal(COVERED_ELEMENTS.size, 37);
  for (const tag of ['div', 'span', 'section', 'article', 'header', 'nav', 'main', 'aside', 'footer', 'tr', 'img']) {
    assert.equal(COVERED_ELEMENTS.has(tag), false, tag);
  }
});

// css-classes

test('css-classes passes: the classes of base.css, of a component file and the variants of elements.css', () => {
  const elements = elementsWith('a.button {\n    color: var(--color-link);\n  }');
  const { input } = site(
    { [ELEMENTS_FILE]: elements, [CARD_FILE]: CARD_CSS },
    {
      'index.html': page(
        `<div class="stack center"><span class="visually-hidden">Hidden</span><div class="cluster grid"></div></div>${CARD_BODY}<a class="button" href="/">Go</a>`,
        [CARD_BUILT],
        globalWith('a.button{color:var(--color-link)}'),
      ),
    },
  );
  assert.deepEqual(ids(audited(input)), []);
});

test('css-classes fails drift 36 and the agent mistake "an undeclared class": exactly css-classes', () => {
  const { input } = site({}, { 'index.html': page('<div class="box">Text</div>') });
  const report = audited(input);
  assert.deepEqual(ids(report), ['css-classes']);
  assert.deepEqual(findings(report), ['css-classes / .box']);
});

test('css-classes: a class of a component file that is no class of its component is not defined', () => {
  const css = CARD_CSS.replace('.card .card__body', '.card .box');
  const { input } = site(
    { [CARD_FILE]: css },
    {
      'index.html': page('<div class="card card--wide"><div class="box"></div></div>', [
        CARD_BUILT.replace('.card__body', '.box'),
      ]),
    },
  );
  assert.deepEqual(findings(audited(input)), ['css-classes / .box']);
});

test('css-classes: a page file defines no class, it names the roots of components', () => {
  const pageCss = '@layer page {\n  .hero {\n    grid-column: 1 / -1;\n  }\n}\n';
  const { input } = site(
    { 'src/styles/pages/index.css': pageCss },
    { 'index.html': page('<div class="hero"></div>', ['@layer page{.hero{grid-column:1/-1}}']) },
  );
  assert.deepEqual(findings(audited(input)), ['css-classes / .hero']);
});

test('css-classes reports one finding for each page and class, and reads the content of <noscript>', () => {
  const { input } = site(
    {},
    {
      'index.html': page('<div class="box"></div><span class="box"></span>'),
      'zimmer/index.html': page('<noscript><div class="box late"></div></noscript>'),
    },
  );
  assert.deepEqual(findings(audited(input)), [
    'css-classes / .box',
    'css-classes /zimmer/ .box',
    'css-classes /zimmer/ .late',
  ]);
});

// css-unused

test('css-unused passes: each class of a component file is on some page', () => {
  const { input } = site(
    { [CARD_FILE]: CARD_CSS },
    {
      'index.html': page('<div class="card"></div>', [CARD_BUILT]),
      'zimmer/index.html': page('<div class="card card--wide"><div class="card__body"></div></div>', [CARD_BUILT]),
    },
  );
  assert.deepEqual(ids(audited(input)), []);
});

test('css-unused fails drift 37: a defined class that no page uses, at its file and line', () => {
  const { input } = site(
    { [CARD_FILE]: CARD_CSS },
    { 'index.html': page('<div class="card"><div class="card__body"></div></div>', [CARD_BUILT]) },
  );
  const report = audited(input);
  assert.deepEqual(ids(report), ['css-unused']);
  assert.deepEqual(findings(report), ['css-unused src/styles/components/card.css:6 .card--wide']);
});

test('css-unused: a variant of elements.css that no page uses fails; base.css is exempt', () => {
  const elements = elementsWith('a.button {\n    color: var(--color-link);\n  }');
  const global = globalWith('a.button{color:var(--color-link)}');
  const unused = site({ [ELEMENTS_FILE]: elements }, { 'index.html': page('<a href="/">Go</a>', [], global) });
  assert.deepEqual(findings(audited(unused.input)), ['css-unused src/styles/elements.css:15 .button']);
  const used = site(
    { [ELEMENTS_FILE]: elements },
    { 'index.html': page('<a class="button" href="/">Go</a>', [], global) },
  );
  assert.deepEqual(ids(audited(used.input)), []);
  const base = site({}, { 'index.html': page('') });
  assert.deepEqual(ids(audited(base.input)), []);
});

test('css-unused: a class named only inside :not() counts as defined, as the row says', () => {
  const css = '@layer components {\n  .card:not(.card--wide) {\n    padding: var(--space-2);\n  }\n}\n';
  const { input } = site(
    { [CARD_FILE]: css },
    {
      'index.html': page('<div class="card"></div>', [
        '@layer components{.card:not(.card--wide){padding:var(--space-2)}}',
      ]),
    },
  );
  assert.deepEqual(findings(audited(input)), ['css-unused src/styles/components/card.css:2 .card--wide']);
});

const MENU_CSS =
  '@layer components {\n  .menu {\n    padding: var(--space-2);\n  }\n\n  .menu--open {\n    padding: var(--space-4);\n  }\n}\n';

const MENU_BUILT = '@layer components{.menu{padding:var(--space-2)}.menu--open{padding:var(--space-4)}}';

/** A project with the island `Menu` and a built script. */
function island(component: string, script: string, text: string): BuiltCssInput {
  return site(
    { [component]: 'export default function Menu() {}\n', 'src/styles/components/menu.css': MENU_CSS },
    { 'index.html': page('<nav class="menu"></nav>', [MENU_BUILT]), [script]: text },
  ).input;
}

test('css-unused: a class of a .tsx component counts when a built _astro/*.js file holds it as a whole word', () => {
  const pass = island('src/components/Menu.tsx', '_astro/Menu.Bx3k.js', 'e.classList.toggle("menu--open",o)');
  assert.deepEqual(ids(audited(pass)), []);
  const start = island('src/components/Menu.tsx', '_astro/Menu.Bx3k.js', 'menu--open');
  assert.deepEqual(ids(audited(start)), []);
  const partOfWord = island('src/components/Menu.tsx', '_astro/Menu.Bx3k.js', 'e.classList.toggle("menu--opened",o)');
  assert.deepEqual(findings(audited(partOfWord)), ['css-unused src/styles/components/menu.css:6 .menu--open']);
  const prefixed = island('src/components/Menu.tsx', '_astro/Menu.Bx3k.js', 'x-menu--open');
  assert.deepEqual(ids(audited(prefixed)), ['css-unused']);
  const astro = island('src/components/Menu.astro', '_astro/Menu.Bx3k.js', '"menu--open"');
  assert.deepEqual(ids(audited(astro)), ['css-unused']);
  const elsewhere = island('src/components/Menu.tsx', 'scripts/menu.js', '"menu--open"');
  assert.deepEqual(ids(audited(elsewhere)), ['css-unused']);
  const notScript = island('src/components/Menu.tsx', '_astro/Menu.Bx3k.css', '"menu--open"');
  assert.deepEqual(ids(audited(notScript)), ['css-unused']);
});

test('css-unused is waivable: a waiver of the component file covers its classes (section 8, Waivers)', () => {
  const { input } = site({ [CARD_FILE]: CARD_CSS }, { 'index.html': page('<div class="card"></div>', [CARD_BUILT]) });
  const waiver = { rule: 'css-unused', where: CARD_FILE, reason: 'A state of a later release.', until: '2099-01-01' };
  const report = audited(input, new Report({ waivers: [waiver] }));
  assert.deepEqual(ids(report), []);
  assert.equal(report.findings.length, 2);
});

// css-element-coverage

test('css-element-coverage passes: a listed element with a rule, and exempt and unlisted elements', () => {
  const { input } = site(
    {},
    {
      'index.html': page(
        '<main><section><article><header><nav><a href="/">Start</a></nav></header><div><span><img src="/a.png" alt=""></span></div></article></section></main>',
      ),
    },
  );
  assert.deepEqual(ids(audited(input)), []);
});

test('css-element-coverage fails drift 38: a <table> with no table rule, one finding for each page and key', () => {
  const body = '<table><tr><td>1</td></tr></table><table><tr><td>2</td></tr></table>';
  const failing = site({}, { 'index.html': page(body) });
  const report = audited(failing.input);
  assert.deepEqual(ids(report), ['css-element-coverage']);
  assert.deepEqual(findings(report), ['css-element-coverage / table', 'css-element-coverage / td']);
  const elements = elementsWith(
    'table {\n    padding: var(--space-1);\n  }\n\n  td {\n    padding: var(--space-1);\n  }',
  );
  const passing = site(
    { [ELEMENTS_FILE]: elements },
    { 'index.html': page(body, [], globalWith('table,td{padding:var(--space-1)}')) },
  );
  assert.deepEqual(ids(audited(passing.input)), []);
});

test('css-element-coverage reads the subject compound: table td covers td, not table; @media rules count', () => {
  const body = '<table><tr><td>1</td></tr></table>';
  const descendant = site(
    { [ELEMENTS_FILE]: elementsWith('table td {\n    padding: var(--space-1);\n  }') },
    { 'index.html': page(body, [], globalWith('table td{padding:var(--space-1)}')) },
  );
  assert.deepEqual(findings(audited(descendant.input)), ['css-element-coverage / table']);
  const media = site(
    {
      [ELEMENTS_FILE]: elementsWith(
        '@media (width >= 48rem) {\n    table {\n      padding: var(--space-1);\n    }\n  }\n\n  td {\n    padding: var(--space-1);\n  }',
      ),
    },
    {
      'index.html': page(
        body,
        [],
        globalWith('@media (width>=48rem){table{padding:var(--space-1)}}td{padding:var(--space-1)}'),
      ),
    },
  );
  assert.deepEqual(ids(audited(media.input)), []);
});

test('css-element-coverage: the last compound of each :is() or :where() argument is the subject; * covers nothing', () => {
  const where = site(
    { [ELEMENTS_FILE]: elementsWith(':where(h1, h2) {\n    color: var(--color-text);\n  }') },
    { 'index.html': page('<h1>A</h1><h2>B</h2><h3>C</h3>', [], globalWith(':where(h1,h2){color:var(--color-text)}')) },
  );
  assert.deepEqual(findings(audited(where.input)), ['css-element-coverage / h3']);
  const star = site(
    { [ELEMENTS_FILE]: elementsWith('* {\n    padding: 0;\n  }') },
    { 'index.html': page('<p>Text</p>', [], globalWith('*{padding:0}')) },
  );
  assert.deepEqual(findings(audited(star.input)), ['css-element-coverage / p']);
});

test('css-element-coverage: input goes by its type, and a bare input rule covers every input', () => {
  const body = '<label>A <input type="radio" name="a"></label><input type="EMAIL" name="b"><input name="c">';
  const radio = site(
    {
      [ELEMENTS_FILE]: elementsWith(
        'label {\n    color: var(--color-text);\n  }\n\n  input[type="radio"] {\n    accent-color: var(--color-accent);\n  }',
      ),
    },
    {
      'index.html': page(
        body,
        [],
        globalWith('label{color:var(--color-text)}input[type=radio]{accent-color:var(--color-accent)}'),
      ),
    },
  );
  assert.deepEqual(findings(audited(radio.input)), [
    'css-element-coverage / input[type=email]',
    'css-element-coverage / input[type=text]',
  ]);
  const bare = site(
    {
      [ELEMENTS_FILE]: elementsWith(
        'label {\n    color: var(--color-text);\n  }\n\n  input {\n    padding: var(--space-1);\n  }',
      ),
    },
    { 'index.html': page(body, [], globalWith('label{color:var(--color-text)}input{padding:var(--space-1)}')) },
  );
  assert.deepEqual(ids(audited(bare.input)), []);
});

test('css-element-coverage: a hidden input needs no rule (the return input of 9.1); a text input still does', () => {
  const hidden =
    '<form method="post"><input type="hidden" name="return" value="/"><input type="HIDDEN" name="x"></form>';
  const passing = site({}, { 'index.html': page(hidden) });
  assert.deepEqual(ids(audited(passing.input)), []);
  const failing = site({}, { 'index.html': page(`${hidden}<input type="text" name="name">`) });
  assert.deepEqual(findings(audited(failing.input)), ['css-element-coverage / input[type=text]']);
});

test('css-element-coverage: a variant of elements.css on another type needs its own rule (button.button)', () => {
  const body = '<a class="button" href="/">Go</a><button class="button" type="button">Go</button>';
  const elements = elementsWith(
    'button {\n    color: var(--color-text);\n  }\n\n  a.button {\n    color: var(--color-link);\n  }',
  );
  const failing = site(
    { [ELEMENTS_FILE]: elements },
    { 'index.html': page(body, [], globalWith('button{color:var(--color-text)}a.button{color:var(--color-link)}')) },
  );
  const report = audited(failing.input);
  assert.deepEqual(ids(report), ['css-element-coverage']);
  assert.deepEqual(findings(report), ['css-element-coverage / button.button']);
  const passing = site(
    { [ELEMENTS_FILE]: elements.replace('  a.button {', '  a.button,\n  button.button {') },
    {
      'index.html': page(
        body,
        [],
        globalWith('button{color:var(--color-text)}a.button,button.button{color:var(--color-link)}'),
      ),
    },
  );
  assert.deepEqual(ids(audited(passing.input)), []);
});

/** A project whose `elements.css` adds the rule `css` (written as the minifier writes it in `built`), and a page. */
const coverageSite = (css: string, minified: string, body: string): BuiltCssInput =>
  site({ [ELEMENTS_FILE]: elementsWith(css) }, { 'index.html': page(body, [], globalWith(minified)) }).input;

test('css-element-coverage: an input rule with :not() or :is() of a type covers only the types it matches', () => {
  const not = 'input:not([type="checkbox"]):not([type="radio"]) {\n    accent-color: var(--color-accent);\n  }';
  const notBuilt = 'input:not([type=checkbox]):not([type=radio]){accent-color:var(--color-accent)}';
  const boxes = '<input type="checkbox" name="a"><input type="radio" name="b">';
  assert.deepEqual(findings(audited(coverageSite(not, notBuilt, boxes))), [
    'css-element-coverage / input[type=checkbox]',
    'css-element-coverage / input[type=radio]',
  ]);
  const is = 'input:is([type="radio"], [type="checkbox"]) {\n    accent-color: var(--color-accent);\n  }';
  const isBuilt = 'input:is([type=radio],[type=checkbox]){accent-color:var(--color-accent)}';
  assert.deepEqual(ids(audited(coverageSite(is, isBuilt, boxes))), []);
  assert.deepEqual(findings(audited(coverageSite(is, isBuilt, '<input type="email" name="c">'))), [
    'css-element-coverage / input[type=email]',
  ]);
});

test('css-element-coverage: an element matches every :is() and :where() of a compound, so their keys intersect', () => {
  const boxes = '<input type="checkbox" name="a"><input type="radio" name="b">';
  const disabled =
    'input:is([type="radio"], [type="checkbox"]):where(:disabled) {\n    accent-color: var(--color-accent);\n  }';
  const disabledBuilt = 'input:is([type=radio],[type=checkbox]):where(:disabled){accent-color:var(--color-accent)}';
  assert.deepEqual(findings(audited(coverageSite(disabled, disabledBuilt, boxes))), [
    'css-element-coverage / input[type=checkbox]',
    'css-element-coverage / input[type=radio]',
  ]);
  const both = ':is(h1, h2):is(h2, h3) {\n    color: var(--color-text);\n  }';
  const bothBuilt = ':is(h1,h2):is(h2,h3){color:var(--color-text)}';
  assert.deepEqual(findings(audited(coverageSite(both, bothBuilt, '<h1>A</h1><h2>B</h2><h3>C</h3>'))), [
    'css-element-coverage / h1',
    'css-element-coverage / h3',
  ]);
});

test('css-element-coverage: a pseudo-class, a non-type attribute or a pseudo-element covers no element', () => {
  const checkbox = '<input type="checkbox" name="a">';
  for (const [css, minified] of [
    ['input:disabled {\n    opacity: var(--opacity-half);\n  }', 'input:disabled{opacity:var(--opacity-half)}'],
    ['input[name="q"] {\n    opacity: var(--opacity-half);\n  }', 'input[name=q]{opacity:var(--opacity-half)}'],
  ] as const) {
    assert.deepEqual(findings(audited(coverageSite(css, minified, checkbox))), [
      'css-element-coverage / input[type=checkbox]',
    ]);
  }
  const marker = 'summary::marker {\n    color: var(--color-text);\n  }';
  assert.deepEqual(
    findings(audited(coverageSite(marker, 'summary::marker{color:var(--color-text)}', '<summary>A</summary>'))),
    ['css-element-coverage / summary'],
  );
  const plain = 'input {\n    opacity: var(--opacity-half);\n  }';
  assert.deepEqual(ids(audited(coverageSite(plain, 'input{opacity:var(--opacity-half)}', checkbox))), []);
});

test('css-element-coverage: a variant rule covers its variant only, never the plain element', () => {
  const lead = 'h1.lead {\n    color: var(--color-text);\n  }';
  const leadBuilt = 'h1.lead{color:var(--color-text)}';
  assert.deepEqual(findings(audited(coverageSite(lead, leadBuilt, '<h1 class="lead">A</h1><h1>B</h1>'))), [
    'css-element-coverage / h1',
  ]);
  assert.deepEqual(ids(audited(coverageSite(lead, leadBuilt, '<h1 class="lead">A</h1>'))), []);
  const button = 'p {\n    color: var(--color-text);\n  }\n\n  p.lede {\n    color: var(--color-text);\n  }';
  const elements = { [ELEMENTS_FILE]: ELEMENTS_CSS.replace('  a {', '  a.button {') };
  const variantOnly = site(
    { ...elements },
    {
      'index.html': page(
        '<a class="button" href="/">Go</a><a href="/">Plain</a>',
        [],
        BUILT_AUTO.replace('a{color', 'a.button{color'),
      ),
    },
  );
  assert.deepEqual(findings(audited(variantOnly.input)), ['css-element-coverage / a']);
  assert.deepEqual(
    ids(
      audited(
        coverageSite(
          button,
          'p{color:var(--color-text)}p.lede{color:var(--color-text)}',
          '<p class="lede">A</p><p>B</p>',
        ),
      ),
    ),
    [],
  );
});

test('css-element-coverage: a variant of elements.css on any element needs its own rule (span.button)', () => {
  const elements = 'a.button {\n    color: var(--color-link);\n  }';
  const minified = 'a.button{color:var(--color-link)}';
  const body = '<a class="button" href="/">Go</a><span class="button">Go</span><div class="button">Go</div>';
  assert.deepEqual(findings(audited(coverageSite(elements, minified, body))), [
    'css-element-coverage / div.button',
    'css-element-coverage / span.button',
  ]);
  const both = 'a.button,\n  span.button,\n  div.button {\n    color: var(--color-link);\n  }';
  const bothBuilt = 'a.button,span.button,div.button{color:var(--color-link)}';
  assert.deepEqual(ids(audited(coverageSite(both, bothBuilt, body))), []);
});

test('css-classes and css-unused: [class~=x] and [class=x] in elements.css and a component file define .x (7.1)', () => {
  const button = 'a[class~="button"] {\n    color: var(--color-link);\n  }';
  const buttonBuilt = 'a[class~=button]{color:var(--color-link)}';
  assert.deepEqual(ids(audited(coverageSite(button, buttonBuilt, '<a class="button" href="/">Go</a>'))), []);
  const card = '@layer components {\n  .card [class~="card__body"] {\n    gap: var(--space-2);\n  }\n}\n';
  const cardSite = (body: string): BuiltCssInput =>
    site(
      { [CARD_FILE]: card },
      { 'index.html': page(body, ['@layer components{.card [class~=card__body]{gap:var(--space-2)}}']) },
    ).input;
  assert.deepEqual(ids(audited(cardSite('<div class="card"><div class="card__body">A</div></div>'))), []);
  const unused = audited(cardSite('<div class="card">A</div>'));
  assert.deepEqual(findings(unused), [`css-unused ${CARD_FILE}:2 .card__body`]);
  const pair = '@layer components {\n  .card[class="card card--wide"] {\n    gap: var(--space-2);\n  }\n}\n';
  const pairSite = site(
    { [CARD_FILE]: pair },
    {
      'index.html': page('<div class="card">A</div>', [
        '@layer components{.card[class=card\\ card--wide]{gap:var(--space-2)}}',
      ]),
    },
  ).input;
  assert.deepEqual(findings(audited(pairSite)), [`css-unused ${CARD_FILE}:2 .card--wide`]);
});

test('css-element-coverage: a class that no file defines is css-classes alone, and <noscript> content counts', () => {
  const undefinedClass = site({}, { 'index.html': page('<a class="box" href="/">Go</a>') });
  assert.deepEqual(ids(audited(undefinedClass.input)), ['css-classes']);
  const noscript = site({}, { 'index.html': page('<noscript><p>Without script.</p></noscript>') });
  assert.deepEqual(findings(audited(noscript.input)), ['css-element-coverage / p']);
});

test('css-element-coverage is waivable for a page path (section 8, Waivers)', () => {
  const { input } = site({}, { 'zimmer/index.html': page('<table><tr><td>1</td></tr></table>') });
  const waiver = {
    rule: 'css-element-coverage',
    where: '/zimmer/',
    reason: 'A table of a partner.',
    until: '2099-01-01',
  };
  assert.deepEqual(ids(audited(input, new Report({ waivers: [waiver] }))), []);
});

// The freedom rows of 14.1: no rule of the coverage group gives an id.

interface FreedomRow {
  row: number;
  files: ProjectFiles;
  /** The minified chunks of the files, each on a line of its own (Lightning CSS with the targets of 6.1). */
  built: string;
  body: string;
}

const CARD = '<div class="card"></div>';

const inComponents = (body: string): string => `@layer components {\n  ${body}\n}\n`;

const FREEDOM: readonly FreedomRow[] = [
  {
    row: 1,
    files: { [CARD_FILE]: inComponents('.card { rotate: 180deg; }') },
    built: '@layer components{.card{rotate:180deg}}',
    body: CARD,
  },
  {
    row: 2,
    files: { [CARD_FILE]: inComponents('.card:hover { scale: 1.05; }') },
    built: '@layer components{.card:hover{scale:1.05}}',
    body: CARD,
  },
  {
    row: 3,
    files: { [CARD_FILE]: inComponents('.card { transform: translateY(var(--space-1)) rotate(-2deg); }') },
    built: '@layer components{.card{transform:translateY(var(--space-1)) rotate(-2deg)}}',
    body: CARD,
  },
  {
    row: 4,
    files: { [CARD_FILE]: inComponents('.card { filter: blur(var(--space-1)) grayscale(0.4); }') },
    built: '@layer components{.card{filter:blur(var(--space-1)) grayscale(.4)}}',
    body: CARD,
  },
  {
    row: 5,
    files: { [CARD_FILE]: inComponents('.card { background-image: var(--gradient-hero); }') },
    built: '@layer components{.card{background-image:var(--gradient-hero)}}',
    body: CARD,
  },
  {
    row: 6,
    files: {
      [CARD_FILE]: inComponents(
        '@keyframes card-in { from { opacity: 0; } 50% { opacity: var(--opacity-half); } to { opacity: 100%; } }\n  .card { animation-name: card-in; }',
      ),
    },
    built:
      '@layer components{@keyframes card-in{0%{opacity:0}50%{opacity:var(--opacity-half)}to{opacity:1}}.card{animation-name:card-in}}',
    body: CARD,
  },
  {
    row: 7,
    files: { [CARD_FILE]: inComponents('.card { width: calc(100% - var(--space-4)); }') },
    built: '@layer components{.card{width:calc(100% - var(--space-4))}}',
    body: CARD,
  },
  {
    row: 8,
    files: { [CARD_FILE]: inComponents('.card { padding: calc(var(--space-2) * 1.5); }') },
    built: '@layer components{.card{padding:calc(var(--space-2) * 1.5)}}',
    body: CARD,
  },
  {
    row: 9,
    files: {
      [CARD_FILE]: inComponents(
        '.card { grid-template-columns: minmax(var(--space-4), 1fr) minmax(0, var(--size-content)) minmax(var(--space-4), 1fr); }',
      ),
    },
    built:
      '@layer components{.card{grid-template-columns:minmax(var(--space-4), 1fr) minmax(0, var(--size-content)) minmax(var(--space-4), 1fr)}}',
    body: CARD,
  },
  {
    row: 10,
    files: { [CARD_FILE]: inComponents('.card { clip-path: polygon(0 0, 100% 0, 100% 85%, 0 100%); }') },
    built: '@layer components{.card{clip-path:polygon(0 0,100% 0,100% 85%,0 100%)}}',
    body: CARD,
  },
  {
    row: 11,
    files: { [CARD_FILE]: inComponents('.card { object-position: 30% 20%; }') },
    built: '@layer components{.card{object-position:30% 20%}}',
    body: CARD,
  },
  {
    row: 12,
    files: { [CARD_FILE]: inComponents('@media (width >= 48rem) { .card { gap: var(--space-2); } }') },
    built: '@layer components{@media (width>=48rem){.card{gap:var(--space-2)}}}',
    body: CARD,
  },
  {
    row: 13,
    files: {
      [CARD_FILE]: inComponents('@container (inline-size >= 30rem) { .card .card__body { gap: var(--space-2); } }'),
    },
    built: '@layer components{@container (inline-size>=30rem){.card .card__body{gap:var(--space-2)}}}',
    body: '<div class="card"><div class="card__body"></div></div>',
  },
  {
    row: 14,
    files: { [CARD_FILE]: inComponents('.card { @starting-style { opacity: 0; } }') },
    built: '@layer components{.card{@starting-style{opacity:0}}}',
    body: CARD,
  },
  {
    row: 15,
    files: { [CARD_FILE]: inComponents('.card { &:hover { color: var(--color-accent); } }') },
    built: '@layer components{.card{&:hover{color:var(--color-accent)}}}',
    body: CARD,
  },
  {
    row: 16,
    files: {
      'src/styles/components/nav.css': inComponents(
        '.nav .nav__link[aria-current="page"]:hover { text-decoration-thickness: var(--line-1); }',
      ),
    },
    built: '@layer components{.nav .nav__link[aria-current=page]:hover{text-decoration-thickness:var(--line-1)}}',
    body: '<nav class="nav"><a class="nav__link" href="/" aria-current="page">Start</a></nav>',
  },
  {
    row: 17,
    files: {
      [CARD_FILE]: inComponents('.card:has(img) { gap: var(--space-2); }'),
      'src/styles/components/list.css': inComponents(
        '.list .list__item:nth-child(2n + 1) { padding: var(--space-1); }',
      ),
    },
    built:
      '@layer components{.card:has(img){gap:var(--space-2)}}\n@layer components{.list .list__item:nth-child(odd){padding:var(--space-1)}}',
    body: '<div class="card"><img src="/a.png" alt=""></div><div class="list"><div class="list__item">A</div></div>',
  },
  {
    row: 18,
    files: { [CARD_FILE]: inComponents('.card { anchor-name: --menu; position-anchor: --menu; }') },
    built: '@layer components{.card{anchor-name:--menu;position-anchor:--menu}}',
    body: CARD,
  },
  {
    row: 19,
    files: { [CARD_FILE]: inComponents('.card { font-variation-settings: "opsz" 32; }') },
    built: '@layer components{.card{font-variation-settings:"opsz" 32}}',
    body: CARD,
  },
  {
    row: 20,
    files: { [CARD_FILE]: inComponents('.card { aspect-ratio: var(--size-wide); }') },
    built: '@layer components{.card{aspect-ratio:var(--size-wide)}}',
    body: CARD,
  },
  {
    row: 21,
    files: { [CARD_FILE]: inComponents('.card { box-shadow: var(--shadow-card); }') },
    built: '@layer components{.card{box-shadow:var(--shadow-card)}}',
    body: CARD,
  },
  {
    row: 22,
    files: { [CARD_FILE]: inComponents('.card { stroke-width: var(--line-1); }') },
    built: '@layer components{.card{stroke-width:var(--line-1)}}',
    body: CARD,
  },
  {
    row: 23,
    files: { [CARD_FILE]: inComponents('.card { animation-iteration-count: 3; }') },
    built: '@layer components{.card{animation-iteration-count:3}}',
    body: CARD,
  },
  {
    row: 24,
    files: {
      'src/styles/components/hero.css': inComponents('.hero { padding: var(--space-2); }'),
      'src/styles/pages/index.css': '@layer page {\n  @media (width >= 48rem) { .hero { grid-column: span 2; } }\n}\n',
    },
    built:
      '@layer components{.hero{padding:var(--space-2)}}\n@layer page{@media (width>=48rem){.hero{grid-column:span 2}}}',
    body: '<div class="hero"></div>',
  },
];

test('the 24 freedom rows of 14.1 give no id of the coverage group (freedom 5, 6, 15, 21, 22 are this group’s)', () => {
  assert.equal(FREEDOM.length, 24);
  for (const row of FREEDOM) {
    const { source, input } = site(row.files, { 'index.html': page(row.body, [row.built]) });
    assert.deepEqual(ids(group(source, input)), [], `freedom ${row.row}`);
  }
});

/**
 * The shared part of the css rules (specification, 3.2, 6.1, 7.1, 7.2, 7.8 and 8): the places of the project CSS
 * files, the source input, the tokens, the components, the built input of each page, the helpers for findings and the
 * order in which the rules run. The rules themselves have their own tests (`css-rules-*.test.ts`).
 */
import assert from 'node:assert/strict';
import { readFileSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { memoryContext } from '../../src/build.ts';
import { classesOf, type Declaration, parseCss, serialize } from '../../src/css/parse.ts';
import {
  auditCss,
  BASE_CLASSES,
  type BuiltCheck,
  builtCssOf,
  CSS_AUDITS,
  CSS_CHECKS,
  cssPlaceOf,
  declarationText,
  frontmatterOf,
  HELPER_CLASS_PARAMETERS,
  kebabOf,
  kitLayerOf,
  LAYER_ORDER,
  lineAt,
  loadSourceCss,
  meets,
  pageCssOf,
  prefixFamily,
  reportOnce,
  runBuiltChecks,
  runSourceChecks,
  type SourceCheck,
  snippet,
  sourceCss,
  sourceWhere,
} from '../../src/css/rules.ts';
import { HELPER_PARAMETERS } from '../../src/design/parse.ts';
import { DESIGN_AUDITS, DESIGN_CHECKS } from '../../src/design/rules.ts';
import { renderTokens, TOKENS_FILE } from '../../src/design/tokens.ts';
import { SOURCE_MAX_BYTES } from '../../src/project.ts';
import { Report, RULE_BY_ID } from '../../src/registry.ts';
import {
  AUTO,
  BUILT_AUTO,
  BUILT_SWITCH,
  built,
  DESIGN,
  ELEMENTS_CSS,
  pageHtml,
  project,
  SWITCH,
} from './css-rules-fixtures.ts';
import { factsOf, inTemp } from './fixtures.ts';

// Helpers. None asserts.

/** The paths of the project CSS files of an input, each with its kind and its layer. */
const placesOf = (input: ReturnType<typeof project>): string[] =>
  input.files.map((file) => `${file.path} ${file.kind} ${file.layer ?? '-'}`);

/** The ids of a list of checks. */
const idsOf = (checks: readonly (SourceCheck | BuiltCheck)[]): string[] => checks.map((check) => check.id);

/** The rule ids that a sub-step of 6.1, step 2 names, in the order of the document. */
function subStep(number: number): string[] {
  const spec = readFileSync(fileURLToPath(new URL('../../docs/spec.md', import.meta.url)), 'utf8');
  const passage = spec.slice(spec.indexOf('2. **Preflight.**'), spec.indexOf('3. **Config shape.**'));
  const line = passage.split('\n').find((each) => each.startsWith(`   ${number}. `)) ?? '';
  return [...line.matchAll(/`([a-z0-9]+(?:-[a-z0-9]+)+)`/g)].map((match) => match[1] ?? '');
}

/** The declaration of a text with one rule. */
function firstDeclaration(css: string): Declaration | undefined {
  const rule = parseCss(css, 'x.css').nodes[0];
  const child = rule?.type === 'rule' ? rule.children[0] : undefined;
  return child?.type === 'declaration' ? child : undefined;
}

// Places and names (7.1, 7.2, 7.8)

test('kebabOf turns a PascalCase name into a kebab name, and gives none for other names', () => {
  const cases: readonly [string, string | undefined][] = [
    ['Card', 'card'],
    ['FeatureCard', 'feature-card'],
    ['SEOHead', 'seo-head'],
    ['Card2Up', 'card2-up'],
    ['HTMLMain', 'html-main'],
    ['Section2', 'section2'],
    ['A', 'a'],
    ['card', undefined],
    ['Feature-Card', undefined],
    ['Feature_Card', undefined],
    ['Kärtchen', undefined],
    ['', undefined],
  ];
  for (const [name, kebab] of cases) assert.equal(kebabOf(name), kebab, name);
});

test('cssPlaceOf gives the place of 7.1 of a project CSS file, and nothing for any other path', () => {
  const cases: readonly [string, string | undefined][] = [
    ['src/styles/tokens.css', 'tokens tokens - - -'],
    ['src/styles/elements.css', 'elements elements - - elements'],
    ['src/styles/fonts.css', 'fonts - - - -'],
    ['src/styles/components/card.css', 'component components card - component:card'],
    ['src/styles/components/Card.css', 'component components Card - component:Card'],
    ['src/styles/pages/index.css', 'page page - index page'],
    ['src/styles/pages/en/legal-note.css', 'page page - en/legal-note page'],
    ['src/styles/pages/[...slug].css', 'page page - [...slug] page'],
    ['src/styles/components/sub/card.css', undefined],
    ['src/styles/components/.css', undefined],
    ['src/styles/pages/a//b.css', undefined],
    ['src/styles/pages/.css', undefined],
    ['src/styles/extra.css', undefined],
    ['src/styles/elements.scss', undefined],
    ['src/styles/components/card.CSS', undefined],
    ['public/x.css', undefined],
  ];
  for (const [path, expected] of cases) {
    const place = cssPlaceOf(path);
    const text =
      place === undefined
        ? undefined
        : [
            place.kind,
            place.layer ?? '-',
            place.component ?? '-',
            place.route ?? '-',
            place.shape === undefined
              ? '-'
              : place.shape.kind === 'component'
                ? `component:${place.shape.component}`
                : place.shape.kind,
          ].join(' ');
    assert.equal(text, expected, path);
  }
});

test('pageCssOf pairs a route with its page file (7.2)', () => {
  const cases: readonly [string, string | undefined][] = [
    ['src/pages/index.astro', 'src/styles/pages/index.css'],
    ['src/pages/a/b.astro', 'src/styles/pages/a/b.css'],
    ['src/pages/[...slug].astro', 'src/styles/pages/[...slug].css'],
    ['src/pages/en/blog.md', 'src/styles/pages/en/blog.css'],
    ['src/pages/feed.json.ts', 'src/styles/pages/feed.json.css'],
    ['src/pages/README', undefined],
    ['src/components/Card.astro', undefined],
  ];
  for (const [route, file] of cases) assert.equal(pageCssOf(route), file, route);
});

test('frontmatterOf finds the fenced block at the start of a file, and nothing else', () => {
  const cases: readonly [string, string | undefined][] = [
    ['---\nimport A from "./A.astro";\n---\n<A />', 'import A from "./A.astro";\n'],
    ['\n  ---\r\nconst a = 1;\r\n---\r\n<p>x</p>', 'const a = 1;\r\n'],
    ['---\n---\n<p>x</p>', ''],
    ['<p>x</p>\n---\na\n---\n', undefined],
    ['---\nno end\n', undefined],
    ['--- x\na\n---\n', undefined],
    ['', undefined],
  ];
  for (const [text, expected] of cases) assert.equal(frontmatterOf(text)?.text, expected, JSON.stringify(text));
});

// The source input

test('sourceCss sorts the files of a project into project CSS, stray style files, sources and components', () => {
  const input = sourceCss(
    [
      { path: 'src/styles/elements.css', text: '@layer elements {}' },
      { path: 'src/styles/tokens.css', text: renderTokens(DESIGN, AUTO) },
      { path: 'src/styles/fonts.css', text: '' },
      { path: 'src/styles/components/card.css', text: '@layer components { .card {} }' },
      { path: 'src/styles/components/box.css', text: '@layer components { .box {} }' },
      { path: 'src/styles/pages/en/index.css', text: '@layer page {}' },
      { path: 'src/styles/extra.css', text: '' },
      { path: 'src/styles/theme.scss', text: '' },
      { path: 'src/styles/components/sub/x.css', text: '' },
      { path: 'public/print.css', text: undefined },
      { path: 'public/robots.txt', text: undefined },
      { path: 'src/styles/.gitkeep', text: '' },
      { path: 'src/components/Card.astro', text: '---\n---\n<div class="card"></div>' },
      { path: 'src/components/ui/FeatureCard.tsx', text: 'export const X = () => <div class="feature-card" />;' },
      { path: 'src/components/lower.astro', text: '<p></p>' },
      { path: 'src/components/Card.jsx', text: '' },
      { path: 'src/pages/index.md', text: '# Hi' },
      { path: 'src/data/ui.ts', text: 'export const a = 1;' },
      { path: 'src/assets/photo.png', text: undefined },
    ],
    DESIGN,
    AUTO,
  );
  assert.deepEqual(placesOf(input), [
    'src/styles/components/box.css component components',
    'src/styles/components/card.css component components',
    'src/styles/elements.css elements elements',
    'src/styles/fonts.css fonts -',
    'src/styles/pages/en/index.css page page',
    'src/styles/tokens.css tokens tokens',
  ]);
  assert.deepEqual(input.stray, [
    'public/print.css',
    'src/styles/components/sub/x.css',
    'src/styles/extra.css',
    'src/styles/theme.scss',
  ]);
  assert.deepEqual(
    input.sources.map((source) => `${source.path} ${source.kind} ${source.markup === undefined ? '-' : 'markup'}`),
    [
      'src/components/Card.astro astro markup',
      'src/components/Card.jsx jsx markup',
      'src/components/lower.astro astro markup',
      'src/components/ui/FeatureCard.tsx tsx markup',
      'src/data/ui.ts script -',
      'src/pages/index.md md markup',
    ],
  );
  assert.deepEqual(
    input.components.map((item) => [item.path, item.name, item.extension, item.kebab, item.css]),
    [
      ['src/components/Card.astro', 'Card', '.astro', 'card', 'src/styles/components/card.css'],
      ['src/components/lower.astro', 'lower', '.astro', undefined, undefined],
      [
        'src/components/ui/FeatureCard.tsx',
        'FeatureCard',
        '.tsx',
        'feature-card',
        'src/styles/components/feature-card.css',
      ],
    ],
  );
  assert.deepEqual([...input.shape.components].sort(), ['box', 'card', 'feature-card']);
  assert.equal(input.options, AUTO);
  assert.equal(input.design, DESIGN);
  assert.ok(input.tokens !== undefined);
});

test('a project CSS file is parsed once, with its path as the file of the sheet', () => {
  const input = project({ 'src/styles/components/card.css': '@layer components {\n  .card { color: red; }\n}\n' });
  const card = input.files.find((file) => file.path === 'src/styles/components/card.css');
  assert.equal(card?.sheet.file, 'src/styles/components/card.css');
  assert.deepEqual(card?.sheet.problems, []);
  assert.deepEqual(
    classesOf(card?.sheet ?? parseCss('', '')).map((item) => `${item.name} ${item.place.line}`),
    ['card 2'],
  );
});

test('the markup of a source text blanks the frontmatter and keeps the offsets of the text', () => {
  const text = '---\nconst a = "<style>";\n---\n<div style="color: red">\n  <style>a {}</style>\n</div>\n';
  const input = project({ 'src/components/Card.astro': text });
  const source = input.sources.find((item) => item.path === 'src/components/Card.astro');
  const styles = source?.markup?.querySelectorAll('style') ?? [];
  assert.equal(styles.length, 1, 'the <style> of the frontmatter does not count');
  assert.equal(lineAt(text, styles[0]?.range[0] ?? -1), 5);
  assert.equal(source?.markup?.querySelector('div')?.getAttribute('style'), 'color: red');
  assert.equal(source?.frontmatter?.text, 'const a = "<style>";\n');
});

test('the tokens are there only when docs/design.md and tokens.css both parse (6.1, the dependency rule)', () => {
  const cases: readonly [name: string, input: ReturnType<typeof project>, tokens: boolean][] = [
    ['the smallest project', project(), true],
    ['no tokens.css', project({ [TOKENS_FILE]: null }), false],
    ['a tokens.css that does not parse', project({ [TOKENS_FILE]: '@layer tokens { :root { --a: 1; }' }), false],
    ['a tokens.css that differs but parses', project({ [TOKENS_FILE]: '@layer tokens { :root {} }' }), true],
    ['a design that fails design-format', project({}, { design: null }), false],
  ];
  for (const [name, input, tokens] of cases) assert.equal(input.tokens !== undefined, tokens, name);
});

test('the token table holds every token and helper parameter of the design, with its family and its value', () => {
  const tokens = project().tokens;
  const rows = [...(tokens?.values() ?? [])].map(
    (item) => `${item.name} ${item.family} ${item.kind} ${item.text} | ${serialize(item.value)}`,
  );
  assert.deepEqual(rows, [
    '--color-page color token #ffffff | #ffffff',
    '--color-text color token #222222 | #222222',
    '--color-link color token #0b4f9c | #0b4f9c',
    '--color-focus color token #9c4f0b | #9c4f0b',
    '--color-error color token #a1201b | #a1201b',
    '--color-accent color token #7a3d00 | #7a3d00',
    '--color-a color token #f7dfb9 | #f7dfb9',
    '--color-b color token #f1e8d9 | #f1e8d9',
    '--color-shadow color token #00000033 | #00000033',
    '--font-body font token system-ui, sans-serif | system-ui, sans-serif',
    '--text-m text token 1rem | 1rem',
    '--space-1 space token 0.25rem | 0.25rem',
    '--space-2 space token 0.5rem | 0.5rem',
    '--space-4 space token 1rem | 1rem',
    '--space-fluid space token 5% | 5%',
    '--size-content size token 40rem | 40rem',
    '--size-half size token 50% | 50%',
    '--size-wide size token 16 / 9 | 16 / 9',
    '--size-screen size token 100vw | 100vw',
    '--line-1 line token 0.0625rem | 0.0625rem',
    '--shadow-card shadow token 0 0.5rem 1.5rem var(--color-shadow) | 0 0.5rem 1.5rem var(--color-shadow)',
    '--shadow-inset shadow token inset 0 0 0.25rem var(--color-shadow) | inset 0 0 0.25rem var(--color-shadow)',
    '--opacity-half opacity token 0.5 | 0.5',
    '--gradient-hero gradient token linear-gradient(135deg, var(--color-a) 0%, var(--color-b) 60%) | linear-gradient(135deg, var(--color-a) 0%, var(--color-b) 60%)',
    '--stack-gap space helper var(--space-2) | var(--space-2)',
  ]);
});

test('prefixFamily gives the family of a token name by its prefix, declared or not, and of a helper parameter', () => {
  const cases: readonly [string, string | undefined][] = [
    ['--space-99', 'space'],
    ['--color-x', 'color'],
    ['--grid-min', 'size'],
    ['--stack-gap', 'space'],
    ['--card-pad', undefined],
    ['--space-', undefined],
    ['constructor', undefined],
    ['__proto__', undefined],
  ];
  for (const [name, family] of cases) assert.equal(prefixFamily(name), family, name);
});

test('the base classes and the helper parameters are those of css/base.css and 7.5', () => {
  const base = readFileSync(fileURLToPath(new URL('../../css/base.css', import.meta.url)), 'utf8');
  assert.deepEqual(
    classesOf(parseCss(base, 'css/base.css'))
      .map((item) => item.name)
      .sort(),
    [...BASE_CLASSES].sort(),
  );
  assert.deepEqual([...HELPER_CLASS_PARAMETERS.values()].flat().sort(), Object.keys(HELPER_PARAMETERS).sort());
  for (const [helper, parameters] of HELPER_CLASS_PARAMETERS) {
    assert.ok(
      parameters.every((parameter) => base.includes(`var(${parameter})`)),
      `the layout block of css/base.css reads the parameters of .${helper}`,
    );
  }
});

test('loadSourceCss reads the files of src/ and public/ on disk, but not a link out of the project or a large file', () => {
  const base = fileURLToPath(new URL('../../css/base.css', import.meta.url));
  const rows = inTemp(
    {
      'src/styles/components/card.css': '@layer components { .card {} }',
      'src/styles/components/big.css': `/*${'x'.repeat(SOURCE_MAX_BYTES)}*/`,
      'src/components/Card.astro': '<div class="card"></div>',
      'public/a.css': 'a {}',
      'other/far.css': 'a {}',
    },
    (root) => {
      symlinkSync(base, join(root, 'src/styles/elements.css'));
      symlinkSync(base, join(root, 'public/b.css'));
      symlinkSync(join(root, 'other'), join(root, 'src', 'other'));
      const input = loadSourceCss(root, DESIGN, AUTO);
      return {
        files: input.files.map((file) => file.path),
        unread: input.unread,
        stray: input.stray,
        sources: input.sources.map((source) => source.path),
        tokens: input.tokens,
      };
    },
  );
  assert.deepEqual(rows.files, ['src/styles/components/card.css'], 'the link out and the large file are not read');
  assert.deepEqual(rows.unread, ['src/styles/components/big.css', 'src/styles/elements.css']);
  assert.deepEqual(rows.stray, ['public/a.css', 'public/b.css', 'src/other/far.css'], 'a link counts by its name');
  assert.deepEqual(rows.sources, ['src/components/Card.astro']);
  assert.equal(rows.tokens, undefined, 'the project has no tokens.css');
});

// The built input

test('the project of the fixtures holds the rendered tokens.css, ELEMENTS_CSS and an empty fonts.css', () => {
  const input = project();
  assert.deepEqual(
    input.files.map((file) => [file.path, file.text]),
    [
      ['src/styles/elements.css', ELEMENTS_CSS],
      ['src/styles/fonts.css', ''],
      [TOKENS_FILE, renderTokens(DESIGN, AUTO)],
    ],
  );
  assert.deepEqual(
    input.files.flatMap((file) => file.sheet.problems),
    [],
  );
  assert.deepEqual(
    project({ 'src/styles/fonts.css': null }).files.map((file) => file.path),
    ['src/styles/elements.css', TOKENS_FILE],
  );
  assert.equal(
    project({}, { options: SWITCH }).files.find((file) => file.kind === 'tokens')?.text,
    renderTokens(DESIGN, SWITCH),
  );
});

test('the global chunk of the fixtures has the layer order of 7.1 and parses without a problem', () => {
  for (const text of [BUILT_AUTO, BUILT_SWITCH]) {
    const input = built(project(), { 'index.html': pageHtml([text]) });
    const page = input.pages[0];
    assert.deepEqual(page?.layerOrder, [...LAYER_ORDER]);
    assert.deepEqual(
      page?.sheets.flatMap((sheet) => sheet.sheet.problems),
      [],
    );
  }
});

test('builtCss parses each distinct <style> text once and gives each node its layer', () => {
  const chunk = '@layer components{.card{color:var(--color-text);& .card__body{gap:var(--space-2)}}}';
  const input = built(project(), {
    'index.html': pageHtml([`${BUILT_AUTO}\n${chunk}`]),
    'impressum/index.html': pageHtml([`${BUILT_AUTO}\n${chunk}`]),
    'fr/index.html': pageHtml([BUILT_AUTO, '@layer astro.images{img{object-fit:cover}}']),
    '404.html': pageHtml([]),
  });
  assert.deepEqual(
    input.pages.map((page) => [page.path, page.sheets.length]),
    [
      ['/', 1],
      ['/404.html', 0],
      ['/fr/', 2],
      ['/impressum/', 1],
    ],
  );
  const [home, missing, french, legal] = input.pages;
  assert.equal(home?.sheets[0], legal?.sheets[0], 'two pages with the same text share one parsed sheet');
  assert.equal(home?.sheets[0]?.sheet.file, '/');
  assert.deepEqual(missing?.layerOrder, []);
  assert.deepEqual(french?.layerOrder, [...LAYER_ORDER, 'astro.images']);
  const declarations = (home?.sheets ?? []).flatMap((sheet) =>
    sheet.nodes.flatMap((item) =>
      item.node.type === 'declaration' && item.kitLayer === 'components'
        ? [`${item.layer} ${item.rule?.prelude.length ?? 0} ${declarationText(item.node)}`]
        : [],
    ),
  );
  assert.deepEqual(declarations, ['components 2 color: var(--color-text)', 'components 4 gap: var(--space-2)']);
  const images = (french?.sheets[1]?.nodes ?? []).map((item) => `${item.layer} ${item.kitLayer}`);
  assert.deepEqual(images, ['undefined undefined', 'astro.images astro', 'astro.images astro']);
});

test('the elements and the classes of a page include those inside <noscript>', () => {
  const input = built(project(), {
    'index.html': pageHtml(
      [BUILT_AUTO],
      '<div class="card  card--wide\tstack"><svg class="card__icon"></svg></div><noscript><p class="note"></p></noscript>',
      '<noscript><link rel="stylesheet" href="/x.css"></noscript>',
    ),
  });
  const page = input.pages[0];
  assert.deepEqual([...(page?.classes ?? [])].sort(), ['card', 'card--wide', 'card__icon', 'note', 'stack']);
  assert.ok(page?.elements.some((element) => element.rawTagName === 'link'));
  assert.ok(page?.elements.some((element) => element.rawTagName === 'p'));
});

test('kitLayerOf maps a full layer name to a layer of the order statement', () => {
  const cases: readonly [string | undefined, string | undefined][] = [
    ['astro', 'astro'],
    ['astro.images', 'astro'],
    ['components', 'components'],
    ['components.x', 'components'],
    ['page', 'page'],
    ['(anonymous)', undefined],
    ['theme', undefined],
    ['constructor', undefined],
    [undefined, undefined],
  ];
  for (const [layer, kit] of cases) assert.equal(kitLayerOf(layer), kit, String(layer));
});

test('builtCssOf reads a build once, so the css and the design audits share one input', () => {
  const ctx = memoryContext({
    root: '/no/such/folder',
    dist: '/no/such/folder/dist',
    options: AUTO,
    kitVersion: '0.0.0',
    facts: factsOf(),
    redirects: [],
    design: DESIGN,
    report: new Report(),
    files: { 'index.html': pageHtml([BUILT_AUTO]) },
  });
  const first = builtCssOf(ctx);
  assert.equal(builtCssOf(ctx), first);
  assert.deepEqual(first.source.files, [], 'a root with no files gives no project CSS');
  assert.equal(first.pages.length, 1);
});

test('the css audit gives the built half of modes-media the settings of the build (6.1, astro:build:done)', () => {
  const picture =
    '<picture><source media="(prefers-color-scheme: dark)" srcset="/a.png"><img src="/a.png" alt=""></picture>';
  const run = (options: typeof AUTO, global: string): string[] => {
    const ctx = memoryContext({
      root: '/no/such/folder',
      dist: '/no/such/folder/dist',
      options,
      kitVersion: '0.0.0',
      facts: factsOf(),
      redirects: [],
      design: DESIGN,
      report: new Report(),
      files: { 'index.html': pageHtml([global], picture) },
    });
    auditCss(ctx);
    return [...ctx.report.ids()].sort();
  };
  assert.deepEqual(run(SWITCH, BUILT_SWITCH), ['modes-media']);
  assert.deepEqual(run(AUTO, BUILT_AUTO), []);
});

// Findings

test('reportOnce adds a finding with the same id, place and detail once', () => {
  const report = new Report();
  const add = reportOnce(report);
  add('css-literal', '/', 'color: red');
  add('css-literal', '/', 'color: red');
  add('css-literal', '/', 'color: blue');
  add('css-literal', '/zimmer/', 'color: red');
  add('css-banned', '/', 'color: red');
  add('css-banned', '/');
  add('css-banned', '/');
  assert.deepEqual(
    report.findings.map((finding) => [finding.rule, finding.where, finding.detail]),
    [
      ['css-literal', '/', 'color: red'],
      ['css-literal', '/', 'color: blue'],
      ['css-literal', '/zimmer/', 'color: red'],
      ['css-banned', '/', 'color: red'],
      ['css-banned', '/', undefined],
    ],
  );
});

test('the helpers for findings give the place, the line and a short detail', () => {
  assert.equal(sourceWhere('src/styles/components/card.css', { line: 12 }), 'src/styles/components/card.css:12');
  assert.deepEqual(
    [0, 1, 2, 3, 4, 99, -1].map((offset) => lineAt('a\nb\n\nc', offset)),
    [1, 1, 2, 2, 3, 4, 1],
  );
  assert.equal(snippet('  a\n\t b  '), 'a b');
  assert.equal(snippet('x'.repeat(200)).length, 120);
  assert.ok(snippet('x'.repeat(200)).endsWith('…'));
  const important = firstDeclaration('.a { color: #c00 !important }');
  assert.equal(important === undefined ? '' : declarationText(important), 'color: #c00 !important');
  const plain = firstDeclaration('.a { margin: var(--space-2, 1rem) }');
  assert.equal(plain === undefined ? '' : declarationText(plain), 'margin: var(--space-2, 1rem)');
});

// The order of the rules

test('CSS_CHECKS holds the CSS source halves in the order of 6.1, step 2, sub-step 10', () => {
  assert.deepEqual(idsOf(CSS_CHECKS), subStep(10));
});

test('DESIGN_CHECKS holds design-specs and design-pairs, which end sub-step 9', () => {
  assert.deepEqual(idsOf(DESIGN_CHECKS), subStep(9).slice(-2));
  assert.deepEqual(subStep(9), ['design-format', 'modes-themes', 'design-tokens', 'design-specs', 'design-pairs']);
});

test('CSS_AUDITS holds the built halves of the css rules in the order of section 8, then modes-media', () => {
  const css = [...RULE_BY_ID.values()].filter((rule) => rule.group === 'css' && rule.stage !== 'config');
  assert.deepEqual(idsOf(CSS_AUDITS), [...css.map((rule) => rule.id), 'modes-media']);
  assert.deepEqual(idsOf(DESIGN_AUDITS), ['design-tokens', 'design-specs']);
});

test('every check of part 5a is a registry rule of the right stage, and each of the 18 rules has its halves', () => {
  const source = [...CSS_CHECKS, ...DESIGN_CHECKS];
  const builds = [...CSS_AUDITS, ...DESIGN_AUDITS];
  for (const check of source) assert.match(RULE_BY_ID.get(check.id)?.stage ?? '', /^config( \+ build)?$/, check.id);
  for (const check of builds) assert.match(RULE_BY_ID.get(check.id)?.stage ?? '', /^(config \+ )?build$/, check.id);
  const ids = [...new Set([...idsOf(source), ...idsOf(builds)])].sort();
  const rules = [...RULE_BY_ID.values()]
    .filter((rule) => rule.group === 'css' || ['design-specs', 'design-pairs', 'modes-media'].includes(rule.id))
    .map((rule) => rule.id);
  assert.deepEqual(ids, [...rules, 'design-tokens'].sort());
  for (const id of rules) {
    const stage = RULE_BY_ID.get(id)?.stage;
    assert.equal(idsOf(source).includes(id), stage !== 'build', `${id} has a source half when it is a config rule`);
    assert.equal(idsOf(builds).includes(id), stage !== 'config', `${id} has a built half when it is a build rule`);
  }
});

test('the runner applies the dependency rule and the settings rule of 6.1', () => {
  const calls: string[] = [];
  const check = (id: string, needs: SourceCheck['needs']): SourceCheck => ({
    id,
    needs,
    run: () => {
      calls.push(id);
    },
  });
  const checks = [check('a', 'nothing'), check('b', 'settings'), check('c', 'design'), check('d', 'tokens')];
  const cases: readonly [name: string, input: ReturnType<typeof project>, ran: string[]][] = [
    ['everything', project(), ['a', 'b', 'c', 'd']],
    ['no settings', project({}, { options: null }), ['a', 'c', 'd']],
    ['no tokens.css', project({ [TOKENS_FILE]: null }), ['a', 'b', 'c']],
    ['no design', project({}, { design: null }), ['a', 'b']],
  ];
  for (const [name, input, ran] of cases) {
    calls.length = 0;
    assert.deepEqual(runSourceChecks(input, checks, new Report()), ran, name);
    assert.deepEqual(calls, ran, name);
    assert.deepEqual(
      checks.filter((each) => meets(input, each.needs)).map((each) => each.id),
      ran,
      name,
    );
  }
  const audits: BuiltCheck[] = checks.map((each) => ({ id: each.id, needs: each.needs, run: () => undefined }));
  const input = built(project({}, { options: null, design: null }), { 'index.html': pageHtml([BUILT_SWITCH]) });
  assert.deepEqual(runBuiltChecks(input, audits, new Report()), ['a']);
  assert.equal(built(project({}, { options: SWITCH }), {}).ctx.options, SWITCH);
});

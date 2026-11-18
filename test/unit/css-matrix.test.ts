/**
 * The drift matrix and the freedom matrix of 14.1, run through the four CSS analyzers of M4 (specification, 3.2,
 * 7.1 to 7.11). M5 builds the rules on these analyzers. So each drift row here asserts the analyzer fact that its
 * rule will report, and each freedom row asserts that the analyzers find nothing, in the source form and in the
 * built form that Lightning CSS writes (13.1 item 40). Rows whose rule reads files or HTML (25 to 28, 30) assert the
 * fact that the analyzers give for the CSS of the row. Each case names the analyzer function and the fact.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { lengthProblems, preludeOf, requiresForcedColors } from '../../src/css/media.ts';
import {
  type AtRule,
  classesOf,
  type Declaration,
  layerOrder,
  layerTree,
  parseCss,
  type Rule,
  serialize,
  walk,
} from '../../src/css/parse.ts';
import {
  atRuleProblem,
  type ComplexSelector,
  type CssFile,
  classRole,
  compoundCount,
  isRootSelector,
  keyframesOwner,
  localOwner,
  normalizeSelector,
  ownerOf,
  PLACEMENT_PROPERTIES,
  parseSelector,
  SELECTOR_LIMITS,
  type ShapeOptions,
  selectorProblems,
  shapeProblems,
  specificity,
  subject,
} from '../../src/css/selectors.ts';
import {
  acceptsFamily,
  bannedLiterals,
  type CssForm,
  colorPosition,
  dashedIdents,
  exactVar,
  familyProblems,
  helperParameterFamily,
  isCustomProperty,
  keyframeSelectorProblem,
  varsOf,
  viewportWidthUnits,
} from '../../src/css/values.ts';
import { familyOf } from '../../src/design/parse.ts';

// Helpers. None asserts.

/** The components of the project in these rows. */
const OPTIONS: ShapeOptions = { components: new Set(['card', 'nav', 'list', 'hero', 'button']) };
/** The breakpoints of the rows: `48rem` (rows 12 and 24) and `30rem` (row 13). */
const BREAKPOINTS = [{ width: '48rem' }, { width: '30rem' }];

const ELEMENTS: CssFile = { kind: 'elements' };
const PAGE: CssFile = { kind: 'page' };
const component = (name: string): CssFile => ({ kind: 'component', component: name });

/** A place as `line:column`. */
const at = (place: { line: number; column: number }): string => `${place.line}:${place.column}`;

/** Every declaration of a text with its layer, in text order. */
function declarations(css: string): { declaration: Declaration; layer: string | undefined; forced: boolean }[] {
  const out: { declaration: Declaration; layer: string | undefined; forced: boolean }[] = [];
  walk(parseCss(css, 'row.css'), (node, context) => {
    if (node.type === 'declaration') {
      out.push({ declaration: node, layer: context.layer, forced: requiresForcedColors(context.atRules) });
    }
  });
  return out;
}

/** The first declaration of a text. A text without one gives an empty `--none` declaration. */
function first(css: string): Declaration {
  return (
    declarations(css)[0]?.declaration ?? {
      type: 'declaration',
      property: '--none',
      value: [],
      important: false,
      place: { offset: 0, line: 1, column: 1 },
    }
  );
}

/** The literals of every declaration of a text as `<kind> <text>`. */
function literals(css: string, form: CssForm): string[] {
  return declarations(css).flatMap(({ declaration, forced }) =>
    bannedLiterals(declaration, { form, forcedColors: forced }).map((item) => `${item.kind} ${item.text}`),
  );
}

/** Every style rule of a text. */
function rulesOf(css: string): Rule[] {
  const out: Rule[] = [];
  walk(parseCss(css, 'row.css'), (node) => {
    if (node.type === 'rule' && node.kind === 'style') out.push(node);
  });
  return out;
}

/** Every resolved selector of every style rule of a text that parses. */
function selectorsOf(css: string): ComplexSelector[] {
  return rulesOf(css).flatMap((rule) =>
    rule.resolved.flatMap((values) => {
      const { selector } = parseSelector(values);
      return selector === undefined ? [] : [selector];
    }),
  );
}

/** The `selectorProblems` messages of every selector of a text. */
const selectorMessages = (css: string, file: CssFile): string[] =>
  selectorsOf(css).flatMap((selector) => selectorProblems(selector, file, OPTIONS).map((item) => item.message));

/** The `shapeProblems` messages of every selector of a text. */
const shapeMessages = (css: string, file: CssFile): string[] =>
  selectorsOf(css).flatMap((selector) => shapeProblems(selector, file, OPTIONS).map((item) => item.message));

/** Every at-rule of a text with its layer. */
function atRules(css: string): { rule: AtRule; layer: string | undefined }[] {
  const out: { rule: AtRule; layer: string | undefined }[] = [];
  walk(parseCss(css, 'row.css'), (node, context) => {
    if (node.type === 'at-rule') out.push({ rule: node, layer: context.layer });
  });
  return out;
}

/** The prelude problems and the length problems of every `@media` and `@container` of a text. */
function mediaMessages(css: string): string[] {
  return atRules(css).flatMap(({ rule }) => {
    const prelude = preludeOf(rule);
    if (prelude === undefined) return [];
    return [...prelude.problems, ...lengthProblems(prelude, BREAKPOINTS)].map((item) => item.message);
  });
}

/**
 * Every fact of a project CSS text that a css rule of M5 would report, as `<analyzer>: <fact>`: the parse problems,
 * the at-rule shape and the preludes, the selectors, the keyframe selectors, the literals, the families, a `var()`
 * fallback, a custom property, `!important`, and in a page file a property that is no placement property. A
 * freedom row gives none.
 */
function facts(css: string, file: CssFile, form: CssForm): string[] {
  const out: string[] = [];
  const sheet = parseCss(css, 'row.css');
  for (const item of sheet.problems) out.push(`parseCss: ${item.message}`);
  walk(sheet, (node, context) => {
    if (node.type === 'at-rule') {
      if (node.name === 'layer') return;
      const shape = atRuleProblem(node, file);
      if (shape !== undefined) out.push(`atRuleProblem: ${shape.message}`);
      const prelude = preludeOf(node);
      if (prelude === undefined) return;
      for (const item of prelude.problems) out.push(`preludeOf: ${item.message}`);
      for (const item of lengthProblems(prelude, BREAKPOINTS)) out.push(`lengthProblems: ${item.message}`);
    } else if (node.type === 'rule' && node.kind === 'keyframe') {
      for (const values of node.selectors) {
        const item = keyframeSelectorProblem(values, node.place);
        if (item !== undefined) out.push(`keyframeSelectorProblem: ${item.message}`);
      }
    } else if (node.type === 'rule') {
      for (const values of node.resolved) {
        const { selector, problem } = parseSelector(values);
        if (problem !== undefined) out.push(`parseSelector: ${problem.message}`);
        for (const item of selector === undefined ? [] : selectorProblems(selector, file, OPTIONS)) {
          out.push(`selectorProblems: ${item.message}`);
        }
      }
    } else {
      const literalContext = { form, forcedColors: requiresForcedColors(context.atRules) };
      for (const item of bannedLiterals(node, literalContext)) out.push(`bannedLiterals: ${item.kind} ${item.text}`);
      for (const use of familyProblems(node, familyOf)) out.push(`familyProblems: ${use.name}`);
      for (const use of varsOf(node.value)) if (use.fallback !== undefined) out.push(`varsOf: fallback ${use.name}`);
      if (isCustomProperty(node.property)) out.push(`isCustomProperty: ${node.property}`);
      if (node.important) out.push(`important: ${node.property}`);
      if (file.kind === 'page' && !PLACEMENT_PROPERTIES.has(node.property)) {
        out.push(`PLACEMENT_PROPERTIES: no ${node.property}`);
      }
    }
  });
  return out;
}

// The drift matrix: each row gives the fact of its rule.

test('drift row 1 (css-literal): bannedLiterals gives the hex literal `#c00` of `color: #c00`', () => {
  assert.deepEqual(literals('@layer components { .card { color: #c00; } }', 'source'), ['hex #c00']);
  assert.deepEqual(literals('@layer components{.card{color:#c00}}', 'built'), ['hex #c00']);
});

test('drift row 2 (css-literal): bannedLiterals gives the dimension `13px` of `padding: 13px`', () => {
  assert.deepEqual(literals('@layer components { .card { padding: 13px; } }', 'source'), ['dimension 13px']);
  assert.deepEqual(literals('@layer components{.card{padding:13px}}', 'built'), ['dimension 13px']);
});

test('drift row 3 (css-literal): bannedLiterals gives the named color `red` of `color: red`', () => {
  assert.deepEqual(literals('@layer components { .card { color: red; } }', 'source'), ['named-color red']);
  assert.deepEqual(literals('@layer components{.card{color:red}}', 'built'), ['named-color red']);
});

test('drift row 4 (css-literal): varsOf gives the fallback of `var(--space-2, 1rem)`, bannedLiterals its `1rem`', () => {
  for (const css of [
    '@layer components { .card { margin: var(--space-2, 1rem); } }',
    '@layer components{.card{margin:var(--space-2,1rem)}}',
  ]) {
    const uses = varsOf(first(css).value);
    assert.deepEqual(
      uses.map((use) => `${use.name} ${use.fallback === undefined ? '-' : serialize(use.fallback)}`),
      ['--space-2 1rem'],
      css,
    );
    assert.deepEqual(literals(css, 'built'), ['dimension 1rem'], css);
  }
});

test('drift row 5 (css-literal): isCustomProperty and walk give the custom property `--brand` in `elements`', () => {
  for (const css of [
    '@layer elements { :root { --brand: var(--color-a); } }',
    '@layer elements{:root{--brand:var(--color-a)}}',
  ]) {
    const found = declarations(css).map(({ declaration, layer }) =>
      [declaration.property, isCustomProperty(declaration.property), layer, exactVar(declaration.value)].join(' '),
    );
    assert.deepEqual(found, ['--brand true elements --color-a'], css);
    // No component local and no helper parameter: the exceptions of 7.3 do not apply.
    assert.equal(localOwner('--brand', OPTIONS.components), undefined, css);
    assert.equal(helperParameterFamily('--brand'), undefined, css);
  }
});

test('drift row 6 (css-token-family): familyProblems gives `--color-accent` on `padding`', () => {
  for (const css of [
    '@layer components { .card { padding: var(--color-accent); } }',
    '@layer components{.card{padding:var(--color-accent)}}',
  ]) {
    assert.deepEqual(
      familyProblems(first(css), familyOf).map((use) => `${use.name} ${at(use.place)}`),
      [`--color-accent 1:${css.indexOf('var(') + 1}`],
      css,
    );
  }
  assert.equal(acceptsFamily('padding', 'color', { inMath: false, functions: [] }), false);
  assert.equal(acceptsFamily('padding', 'space', { inMath: false, functions: [] }), true);
});

test('drift row 7 (css-local-var): isRootSelector is false for `.card .card__body`, the place of a local', () => {
  for (const css of [
    '@layer components { .card .card__body { --card-pad: var(--space-2); } }',
    '@layer components{.card .card__body{--card-pad:var(--space-2)}}',
  ]) {
    const [selector] = selectorsOf(css);
    assert.ok(selector, css);
    assert.equal(isRootSelector(selector, 'card'), false, css);
    const declaration = first(css);
    assert.equal(localOwner(declaration.property, OPTIONS.components), 'card', css);
    assert.equal(exactVar(declaration.value), '--space-2', css);
  }
  // The same local on the root compound is in its place.
  const [root] = selectorsOf('@layer components { .card { --card-pad: var(--space-2); } }');
  assert.ok(root);
  assert.equal(isRootSelector(root, 'card'), true);
});

test('drift row 8 (css-local-var, css-var-undefined): varsOf reads `--card-pad`, whose localOwner is `card`, in `hero`', () => {
  for (const css of [
    '@layer components { .hero { padding: var(--card-pad); } }',
    '@layer components{.hero{padding:var(--card-pad)}}',
  ]) {
    const names = varsOf(first(css).value).map((use) => use.name);
    assert.deepEqual(names, ['--card-pad'], css);
    assert.deepEqual(
      names.map((name) => localOwner(name, OPTIONS.components)),
      ['card'],
      css,
    );
    // The rule in `hero.css` (or the built rule whose root is `.hero`) reads a local of another component.
    const [selector] = selectorsOf(css);
    assert.ok(selector, css);
    assert.equal(ownerOf(selector.compounds[0]?.classes[0]?.name ?? '', OPTIONS.components), 'hero', css);
  }
});

test('drift row 9 (css-var-undefined): varsOf gives the name `--space-99` with its place', () => {
  for (const css of [
    '@layer components { .card { padding: var(--space-99); } }',
    '@layer components{.card{padding:var(--space-99)}}',
  ]) {
    assert.deepEqual(
      varsOf(first(css).value).map((use) => `${use.name} ${at(use.place)}`),
      [`--space-99 1:${css.indexOf('var(') + 1}`],
      css,
    );
  }
  // Its family is known, so css-token-family is silent: only the name is undefined.
  assert.equal(familyOf('--space-99'), 'space');
  assert.deepEqual(familyProblems(first('.card { padding: var(--space-99); }'), familyOf), []);
});

test('drift row 10 (css-var-undefined): classesOf gives `.stack`, varsOf its parameter `--stack-gap`', () => {
  const css = '@layer layout { .stack { display: flex; flex-direction: column; gap: var(--stack-gap); } }';
  const sheet = parseCss(css, 'base.css');
  assert.deepEqual(
    classesOf(sheet).map((item) => item.name),
    ['stack'],
  );
  const used = declarations(css).flatMap(({ declaration, layer }) =>
    varsOf(declaration.value).map((use) => `${layer} ${use.name} ${helperParameterFamily(use.name)}`),
  );
  assert.deepEqual(used, ['layout --stack-gap space']);
});

test('drift row 11 (css-selector): selectorProblems gives the id of `#hero`, specificity (1,0,0)', () => {
  for (const css of ['@layer elements { #hero { gap: 0; } }', '@layer elements{#hero{gap:0}}']) {
    assert.deepEqual(selectorMessages(css, ELEMENTS), ['the id `#hero`: the kit allows no id selector'], css);
    assert.deepEqual(
      selectorsOf(css).map((selector) => specificity(selector).join(',')),
      ['1,0,0'],
      css,
    );
  }
});

test('drift row 12 (css-selector): compoundCount gives 5 for `.a .b .c .d .e`, above SELECTOR_LIMITS', () => {
  for (const css of ['@layer elements { .a .b .c .d .e { gap: 0; } }', '@layer elements{.a .b .c .d .e{gap:0}}']) {
    const [selector] = selectorsOf(css);
    assert.ok(selector, css);
    assert.equal(compoundCount(selector), 5, css);
    assert.ok(compoundCount(selector) > SELECTOR_LIMITS.compounds, css);
    assert.ok(
      selectorProblems(selector, ELEMENTS, OPTIONS).some((item) => item.message === '5 compounds, more than 4'),
      css,
    );
  }
});

test('drift row 13 (css-selector): shapeProblems gives the foreign class `.button` in `card.css`', () => {
  for (const css of ['@layer components { .card .button { gap: 0; } }', '@layer components{.card .button{gap:0}}']) {
    assert.deepEqual(
      shapeMessages(css, component('card')),
      ['the class `.button` belongs to the component `button`, not to `card`'],
      css,
    );
  }
  assert.equal(ownerOf('button', OPTIONS.components), 'button');
});

test('drift row 14 (css-selector): shapeProblems gives a bare `h2` in a component file', () => {
  for (const css of ['@layer components { h2 { gap: 0; } }', '@layer components{h2{gap:0}}']) {
    assert.deepEqual(
      shapeMessages(css, component('card')),
      ['the selector does not start at the root class `.card`'],
      css,
    );
  }
});

test('drift row 15 (css-selector): shapeProblems gives the component class `.card` in `elements.css`', () => {
  for (const css of ['@layer elements { .card { gap: 0; } }', '@layer elements{.card{gap:0}}']) {
    assert.deepEqual(
      shapeMessages(css, ELEMENTS),
      ['the class `.card` of the component `card` in `elements.css`'],
      css,
    );
  }
});

test('drift row 16 (css-page): PLACEMENT_PROPERTIES has no `color`; the selector `.hero` is in shape', () => {
  for (const css of [
    '@layer page { .hero { color: var(--color-text); } }',
    '@layer page{.hero{color:var(--color-text)}}',
  ]) {
    assert.deepEqual(facts(css, PAGE, 'built'), ['PLACEMENT_PROPERTIES: no color'], css);
  }
  assert.equal(PLACEMENT_PROPERTIES.has('grid-column'), true);
});

test('drift row 17 (css-media): lengthProblems gives `777px`, which equals no breakpoint', () => {
  for (const css of ['@media (width < 777px) { .card { gap: 0; } }', '@media (width<777px){.card{gap:0}}']) {
    assert.deepEqual(mediaMessages(css), ['the length `777px` equals no breakpoint width (48rem, 30rem)'], css);
  }
});

test('drift row 18 (css-media): preludeOf gives the `var()` of `(width < var(--bp))` with its place (S4)', () => {
  const css = '@media (width < var(--bp)) { .card {} }';
  const found = atRules(css).flatMap(({ rule }) =>
    (preludeOf(rule)?.problems ?? []).map((item) => `${at(item.place)} ${item.message}`),
  );
  assert.equal(found.length, 1, found.join('\n'));
  assert.match(found[0] ?? '', /^1:17 .*`var\(\)`/);
});

test('drift row 19 (css-media): preludeOf refuses the feature `min-resolution`, and `resolution` in built CSS', () => {
  for (const css of ['@media (min-resolution: 2dppx) { .card { gap: 0; } }', '@media (resolution>=2x){.card{gap:0}}']) {
    const found = mediaMessages(css);
    assert.equal(found.length, 1, `${css}: ${found.join('; ')}`);
    assert.match(found[0] ?? '', /resolution/, css);
  }
});

test('drift row 20 (css-banned): the declaration is `important` in the layer `components`', () => {
  for (const css of [
    '@layer components { .card { gap: var(--space-2) !important; } }',
    '@layer components{.card{gap:var(--space-2)!important}}',
  ]) {
    assert.deepEqual(
      declarations(css).map(
        ({ declaration, layer }) => `${declaration.important} ${layer} ${serialize(declaration.value)}`,
      ),
      ['true components var(--space-2)'],
      css,
    );
  }
});

test('drift row 21 (css-banned): parseCss gives the at-rule `@import`; atRuleProblem leaves it to css-banned', () => {
  const css = '@import "x.css";\n@layer components { .card {} }';
  const found = atRules(css).map(
    ({ rule }) => `${rule.name} ${at(rule.place)} ${atRuleProblem(rule, component('card'))?.message ?? '-'}`,
  );
  assert.deepEqual(found, ['import 1:1 -', 'layer 2:1 -']);
});

test('drift row 22 (css-banned): parseCss gives the at-rule `@scope`; atRuleProblem leaves it to css-banned', () => {
  for (const css of [
    '@layer components { @scope (.card) { img { gap: 0; } } }',
    '@layer components{@scope(.card){img{gap:0}}}',
  ]) {
    const found = atRules(css)
      .filter(({ rule }) => rule.name !== 'layer')
      .map(({ rule, layer }) => `${rule.name} ${layer} ${atRuleProblem(rule, component('card'))?.message ?? '-'}`);
    assert.deepEqual(found, ['scope components -'], css);
  }
});

test('drift row 23 (css-banned): a `style` attribute is HTML; parseCss reads its declarations inside a rule', () => {
  // css-banned reports the attribute itself. The analyzers read its text only as the block of a rule.
  const attribute = 'color: red; padding: 13px';
  assert.deepEqual(parseCss(attribute, 'style').problems.length > 0, true);
  assert.deepEqual(literals(`x { ${attribute} }`, 'source'), ['named-color red', 'dimension 13px']);
});

test('drift row 24 (css-banned): viewportWidthUnits gives the place of `var(--size-screen)` that brings `100vw`', () => {
  const tokens = new Map(
    declarations('@layer tokens { :root { --size-screen: 100vw; } }').map(({ declaration }) => [
      declaration.property,
      declaration.value,
    ]),
  );
  for (const css of [
    '@layer components { .card { inline-size: var(--size-screen); } }',
    '@layer components{.card{inline-size:var(--size-screen)}}',
  ]) {
    const declaration = first(css);
    assert.deepEqual(
      viewportWidthUnits(declaration, (name) => tokens.get(name)).map(at),
      [`1:${css.indexOf('var(') + 1}`],
      css,
    );
    assert.deepEqual(bannedLiterals(declaration, { form: 'built', forcedColors: false }), [], css);
  }
});

test('drift row 25 (css-sources): walk gives no layer for the rules of a scoped `<style>` of `.astro`', () => {
  // Astro writes a scoped style with `[data-astro-cid-*]` (13.1 item 1), outside every layer.
  const css = '.card[data-astro-cid-abc]{color:red}';
  assert.deepEqual(layerOrder(parseCss(css, 'page.css')), []);
  assert.deepEqual(
    declarations(css).map(({ layer }) => layer ?? 'unlayered'),
    ['unlayered'],
  );
});

test('drift row 26 (css-sources): ownerOf gives two components for the built `components` layer of the page', () => {
  // `Hero` imports `card.css`: a page that shows only the hero gets the rules of `card` too.
  const css = '@layer components{.hero{gap:var(--space-2)}.card{gap:var(--space-2)}}';
  assert.deepEqual(
    selectorsOf(css).map((selector) => ownerOf(selector.compounds[0]?.classes[0]?.name ?? '', OPTIONS.components)),
    ['hero', 'card'],
  );
});

test('drift row 27 (css-sources): a CSS file in `public/` parses, with no layer and its own classes', () => {
  const css = '.promo { color: var(--color-accent); }';
  const sheet = parseCss(css, 'public/x.css');
  assert.deepEqual(sheet.problems, []);
  assert.deepEqual(layerTree(sheet), []);
  assert.deepEqual(
    classesOf(sheet).map((item) => `${item.name} ${at(item.place)}`),
    ['promo 1:1'],
  );
});

test('drift row 28 (css-sources): `src/styles/extra.css` parses; classesOf gives a class that no component owns', () => {
  const css = '@layer components { .extra { gap: var(--space-2); } }';
  const sheet = parseCss(css, 'src/styles/extra.css');
  assert.deepEqual(sheet.problems, []);
  assert.deepEqual(
    classesOf(sheet).map((item) => ownerOf(item.name, OPTIONS.components) ?? `${item.name}: no owner`),
    ['extra: no owner'],
  );
});

test('drift row 29 (css-layer-file): layerTree gives two top-level blocks; walk gives a nested `@layer`', () => {
  const two = parseCss('@layer components { .card {} }\n@layer page { .hero {} }', 'card.css');
  assert.deepEqual(
    layerTree(two).map((entry) => `${entry.kind} ${entry.names.join(',')} ${at(entry.rule.place)}`),
    ['block components 1:1', 'block page 2:1'],
  );
  const nested = '@layer components { @layer inner { .card { gap: 0; } } }';
  assert.deepEqual(
    atRules(nested).map(({ rule, layer }) => `${rule.name} ${layer ?? '-'}`),
    ['layer -', 'layer components'],
  );
  assert.deepEqual(
    declarations(nested).map(({ layer }) => layer),
    ['components.inner'],
  );
});

test('drift row 30 (css-component-file): no class of the CSS has the role `root` of `card`', () => {
  // `Card.astro` has no `card.css`: the classes of the project CSS hold no root of `card`.
  const css = '@layer components { .hero { gap: var(--space-2); } .hero .hero__title { gap: 0; } }';
  const roles = classesOf(parseCss(css, 'hero.css')).map((item) => classRole(item.name, 'card') ?? '-');
  assert.deepEqual(roles, ['-', '-']);
  assert.equal(classRole('card', 'card'), 'root');
});

test('drift row 31 (css-component-file, css-selector): shapeProblems in `card.css` refuses the root `.box`', () => {
  for (const css of ['@layer components { .box { gap: 0; } }', '@layer components{.box{gap:0}}']) {
    assert.deepEqual(
      shapeMessages(css, component('card')),
      ['the selector does not start at the root class `.card`', 'the class `.box` belongs to no part of `card`'],
      css,
    );
  }
});

test('drift row 32 (design-tokens): walk gives the place of the declaration changed by hand in `tokens.css`', () => {
  const rendered = '@layer tokens {\n  :root {\n    --space-2: 0.5rem;\n  }\n}\n';
  const changed = rendered.replace('0.5rem', '0.6rem');
  const text = (css: string): string[] =>
    declarations(css).map(
      ({ declaration, layer }) => `${layer} ${declaration.property} ${serialize(declaration.value)}`,
    );
  assert.deepEqual(text(rendered), ['tokens --space-2 0.5rem']);
  assert.deepEqual(text(changed), ['tokens --space-2 0.6rem']);
  assert.deepEqual(
    declarations(changed).map(({ declaration }) => at(declaration.place)),
    ['3:5'],
  );
});

test('drift row 33 (design-tokens): walk gives the custom properties of the built `tokens` layer', () => {
  const css = '@layer tokens{:root{--space-2:.5rem;--brand:#c00}}';
  const found = declarations(css)
    .filter(({ declaration, layer }) => layer === 'tokens' && isCustomProperty(declaration.property))
    .map(({ declaration }) => `${declaration.property} ${familyOf(declaration.property) ?? 'no family'}`);
  assert.deepEqual(found, ['--space-2 space', '--brand no family']);
});

test('drift row 34 (design-specs): normalizeSelector and exactVar give no rule for the row `h1 color --color-title`', () => {
  const source = '@layer elements { H1 { font-size: var(--text-3xl); } }';
  const built = '@layer elements{h1{font-size:var(--text-3xl)}}';
  const implemented = (css: string): string[] =>
    rulesOf(css).flatMap((rule) => {
      const names = rule.resolved.flatMap((values) => {
        const { selector } = parseSelector(values);
        return selector === undefined ? [] : [normalizeSelector(selector)];
      });
      return rule.children.flatMap((node) =>
        node.type === 'declaration' ? names.map((name) => `${name} ${node.property} ${exactVar(node.value)}`) : [],
      );
    });
  assert.deepEqual(implemented(source), ['h1 font-size --text-3xl']);
  assert.deepEqual(implemented(built), implemented(source));
  assert.equal(implemented(source).includes('h1 color --color-title'), false);
});

test('drift row 35 (design-pairs): colorPosition is `background` for `background-color`; varsOf gives the token', () => {
  for (const css of [
    '@layer components { .card { background-color: var(--color-wash); } }',
    '@layer components{.card{background-color:var(--color-wash)}}',
  ]) {
    const declaration = first(css);
    assert.deepEqual(
      varsOf(declaration.value).map((use) => `${colorPosition(declaration.property)} ${use.name}`),
      ['background --color-wash'],
      css,
    );
  }
  assert.equal(colorPosition('color'), 'foreground');
});

test('drift row 36 (css-classes): classesOf of the CSS holds no class `promo` that a page uses', () => {
  const css = '@layer elements { a.button { gap: 0; } } @layer components { .card { gap: 0; } .card__body {} }';
  const defined = new Set(classesOf(parseCss(css, 'all.css')).map((item) => item.name));
  assert.deepEqual([...defined].sort(), ['button', 'card', 'card__body']);
  assert.equal(defined.has('promo'), false);
});

test('drift row 37 (css-unused): classesOf gives each defined class once, with its place', () => {
  const css = '@layer components {\n  .card { gap: 0; }\n  .card .card__unused { gap: 0; }\n}';
  assert.deepEqual(
    classesOf(parseCss(css, 'card.css')).map((item) => `${item.name} ${at(item.place)}`),
    ['card 2:3', 'card__unused 3:9'],
  );
});

test('drift row 38 (css-element-coverage): subject gives the types of `elements.css`, and no `table`', () => {
  const css = '@layer elements { p, h2 { gap: 0; } ul li { gap: 0; } a.button:hover { gap: 0; } }';
  const types = selectorsOf(css).map((selector) => subject(selector)?.type ?? '-');
  assert.deepEqual(types, ['p', 'h2', 'li', 'a']);
  assert.equal(types.includes('table'), false);
});

// The freedom matrix: each row gives no fact, in source and in built form.

/** One freedom row: its number, its file, its source text and the text that Lightning CSS writes for it. */
interface FreedomRow {
  row: number;
  proves: string;
  file: CssFile;
  source: string;
  built: string;
}

const FREEDOM: readonly FreedomRow[] = [
  {
    row: 1,
    proves: 'an angle',
    file: component('card'),
    source: '@layer components { .card { rotate: 180deg; } }',
    built: '@layer components{.card{rotate:180deg}}',
  },
  {
    row: 2,
    proves: 'a plain number on a geometry property',
    file: component('card'),
    source: '@layer components { .card:hover { scale: 1.05; } }',
    built: '@layer components{.card:hover{scale:1.05}}',
  },
  {
    row: 3,
    proves: 'a length token and an angle in transform functions',
    file: component('card'),
    source: '@layer components { .card { transform: translateY(var(--space-1)) rotate(-2deg); } }',
    built: '@layer components{.card{transform:translateY(var(--space-1)) rotate(-2deg)}}',
  },
  {
    row: 4,
    proves: 'filter functions',
    file: component('card'),
    source: '@layer components { .card { filter: blur(var(--space-1)) grayscale(0.4); } }',
    built: '@layer components{.card{filter:blur(var(--space-1)) grayscale(.4)}}',
  },
  {
    row: 5,
    proves: 'the gradient family',
    file: component('card'),
    source: '@layer components { .card { background-image: var(--gradient-hero); } }',
    built: '@layer components{.card{background-image:var(--gradient-hero)}}',
  },
  {
    row: 6,
    proves: 'keyframes and their percentage selectors',
    file: component('card'),
    source:
      '@layer components { @keyframes card-in { from { opacity: 0; } 50% { opacity: var(--opacity-half); } to { opacity: 100%; } } .card { animation-name: card-in; } }',
    built:
      '@layer components{@keyframes card-in{0%{opacity:0}50%{opacity:var(--opacity-half)}to{opacity:1}}.card{animation-name:card-in}}',
  },
  {
    row: 7,
    proves: 'the length group in a math function',
    file: component('card'),
    source: '@layer components { .card { width: calc(100% - var(--space-4)); } }',
    built: '@layer components{.card{width:calc(100% - var(--space-4))}}',
  },
  {
    row: 8,
    proves: 'a number as a `calc()` factor',
    file: component('card'),
    source: '@layer components { .card { padding: calc(var(--space-2) * 1.5); } }',
    built: '@layer components{.card{padding:calc(var(--space-2) * 1.5)}}',
  },
  {
    row: 9,
    proves: 'the length group in grid tracks',
    file: component('card'),
    source:
      '@layer components { .card { grid-template-columns: minmax(var(--space-4), 1fr) minmax(0, var(--size-content)) minmax(var(--space-4), 1fr); } }',
    built:
      '@layer components{.card{grid-template-columns:minmax(var(--space-4), 1fr) minmax(0, var(--size-content)) minmax(var(--space-4), 1fr)}}',
  },
  {
    row: 10,
    proves: 'percentages in a shape',
    file: component('card'),
    source: '@layer components { .card { clip-path: polygon(0 0, 100% 0, 100% 85%, 0 100%); } }',
    built: '@layer components{.card{clip-path:polygon(0 0,100% 0,100% 85%,0 100%)}}',
  },
  {
    row: 11,
    proves: 'percentages in a position',
    file: component('card'),
    source: '@layer components { .card { object-position: 30% 20%; } }',
    built: '@layer components{.card{object-position:30% 20%}}',
  },
  {
    row: 12,
    proves: '`@media` in a component file',
    file: component('card'),
    source: '@layer components { @media (width >= 48rem) { .card { gap: var(--space-2); } } }',
    built: '@layer components{@media (width>=48rem){.card{gap:var(--space-2)}}}',
  },
  {
    row: 13,
    proves: '`@container`',
    file: component('card'),
    source: '@layer components { @container (inline-size >= 30rem) { .card .card__body { gap: var(--space-2); } } }',
    built: '@layer components{@container (inline-size>=30rem){.card .card__body{gap:var(--space-2)}}}',
  },
  {
    row: 14,
    proves: '`@starting-style` and nesting',
    file: component('card'),
    source: '@layer components { .card { @starting-style { opacity: 0; } } }',
    built: '@layer components{.card{@starting-style{opacity:0}}}',
  },
  {
    row: 15,
    proves: 'a nested rule',
    file: component('card'),
    source: '@layer components { .card { &:hover { color: var(--color-accent); } } }',
    built: '@layer components{.card{&:hover{color:var(--color-accent)}}}',
  },
  {
    row: 16,
    proves: 'the root class is outside the specificity count',
    file: component('nav'),
    source: '@layer components { .nav .nav__link[aria-current="page"]:hover { color: var(--color-accent); } }',
    built: '@layer components{.nav .nav__link[aria-current=page]:hover{color:var(--color-accent)}}',
  },
  {
    row: 17,
    proves: 'functional pseudo-classes in `card.css`',
    file: component('card'),
    source: '@layer components { .card:has(img) { gap: var(--space-2); } }',
    built: '@layer components{.card:has(img){gap:var(--space-2)}}',
  },
  {
    row: 17,
    proves: 'numbers in a selector are no literals, in `list.css`',
    file: component('list'),
    source: '@layer components { .list .list__item:nth-child(2n + 1) { gap: var(--space-2); } }',
    built: '@layer components{.list .list__item:nth-child(odd){gap:var(--space-2)}}',
  },
  {
    row: 18,
    proves: 'a dashed ident is no custom property',
    file: component('card'),
    source: '@layer components { .card { anchor-name: --menu; position-anchor: --menu; } }',
    built: '@layer components{.card{anchor-name:--menu;position-anchor:--menu}}',
  },
  {
    row: 19,
    proves: 'a number after a string tag',
    file: component('card'),
    source: '@layer components { .card { font-variation-settings: "opsz" 32; } }',
    built: '@layer components{.card{font-variation-settings:"opsz" 32}}',
  },
  {
    row: 20,
    proves: 'a ratio token',
    file: component('card'),
    source: '@layer components { .card { aspect-ratio: var(--size-wide); } }',
    built: '@layer components{.card{aspect-ratio:var(--size-wide)}}',
  },
  {
    row: 21,
    proves: 'a color token inside a shadow token',
    file: component('card'),
    source: '@layer components { .card { box-shadow: var(--shadow-card); } }',
    built: '@layer components{.card{box-shadow:var(--shadow-card)}}',
  },
  {
    row: 22,
    proves: 'the line family on SVG strokes',
    file: component('card'),
    source: '@layer components { .card { stroke-width: var(--line-1); } }',
    built: '@layer components{.card{stroke-width:var(--line-1)}}',
  },
  {
    row: 23,
    proves: 'a count',
    file: component('card'),
    source: '@layer components { .card { animation-iteration-count: 3; } }',
    built: '@layer components{.card{animation-iteration-count:3}}',
  },
  {
    row: 24,
    proves: '`@media` in a page file',
    file: PAGE,
    source: '@layer page { @media (width >= 48rem) { .hero { grid-column: span 2; } } }',
    built: '@layer page{@media (width>=48rem){.hero{grid-column:span 2}}}',
  },
];

/** The `tokens.css` of the freedom rows 5, 20 and 21: the token values are exempt from css-literal (7.3). */
const TOKENS =
  '@layer tokens { :root { --gradient-hero: linear-gradient(135deg, var(--color-a) 0%, var(--color-b) 60%); --size-wide: 16 / 9; --shadow-card: 0 0.5rem 1.5rem var(--color-shadow); } }';

for (const { row, proves, file, source, built } of FREEDOM) {
  test(`freedom row ${row} (${proves}): facts of every analyzer are empty, in source and in built form`, () => {
    assert.deepEqual(facts(source, file, 'source'), [], source);
    assert.deepEqual(facts(built, file, 'built'), [], built);
  });
}

test('freedom row 1: bannedLiterals accepts the angle `180deg` of `rotate`', () => {
  assert.deepEqual(literals('.card { rotate: 180deg; }', 'source'), []);
  assert.deepEqual(literals('.card { rotate: 180px; }', 'source'), ['dimension 180px']);
});

test('freedom row 2: bannedLiterals accepts `scale: 1.05`; the `:hover` is a state of the root', () => {
  assert.deepEqual(literals('.card:hover { scale: 1.05; }', 'source'), []);
  assert.deepEqual(literals('.card:hover { opacity: 1.05; }', 'source'), ['number 1.05']);
});

test('freedom row 3: familyProblems accepts `--space-1` in `translateY()`; bannedLiterals the angle', () => {
  const declaration = first('.card { transform: translateY(var(--space-1)) rotate(-2deg); }');
  assert.deepEqual(familyProblems(declaration, familyOf), []);
  assert.deepEqual(
    varsOf(declaration.value).map((use) => `${use.name} ${use.functions.join(',')}`),
    ['--space-1 translatey'],
  );
});

test('freedom row 4: bannedLiterals accepts `grayscale(0.4)`; familyProblems the length token in `blur()`', () => {
  assert.deepEqual(literals('.card { filter: blur(var(--space-1)) grayscale(0.4); }', 'source'), []);
  assert.deepEqual(literals('.card { filter: 0.4; }', 'source'), ['number 0.4']);
  // `filter` has no family: it takes the length group, and a color token in `drop-shadow()` (7.3).
  assert.deepEqual(
    familyProblems(first('.card { filter: drop-shadow(0 0 var(--space-1) var(--color-a)); }'), familyOf),
    [],
  );
  assert.equal(familyProblems(first('.card { filter: blur(var(--color-a)); }'), familyOf).length, 1);
});

test('freedom row 5: familyProblems accepts `--gradient-hero` on `background-image`; the token holds two colors', () => {
  assert.deepEqual(familyProblems(first('.card { background-image: var(--gradient-hero); }'), familyOf), []);
  const token = declarations(TOKENS).find(({ declaration }) => declaration.property === '--gradient-hero');
  assert.ok(token);
  assert.equal(token.layer, 'tokens');
  assert.deepEqual(
    varsOf(token.declaration.value).map((use) => `${use.name} ${use.functions.join(',')}`),
    ['--color-a linear-gradient', '--color-b linear-gradient'],
  );
});

test('freedom row 6: keyframeSelectorProblem accepts `from`, `50%`, `to` and `0%`; keyframesOwner is `card`', () => {
  for (const text of ['from', '50%', 'to', '0%', 'TO']) {
    const css = `@keyframes card-in { ${text} { opacity: 0; } }`;
    const selectors = atRules(css).flatMap(({ rule }) =>
      (rule.block ?? []).flatMap((node) =>
        node.type === 'rule' ? node.selectors.map((values) => ({ values, place: node.place })) : [],
      ),
    );
    assert.deepEqual(
      selectors.map(({ values, place }) => keyframeSelectorProblem(values, place)?.message ?? 'ok'),
      ['ok'],
      text,
    );
  }
  assert.equal(keyframesOwner('card-in', OPTIONS.components), 'card');
  assert.deepEqual(literals('.card { opacity: 100%; }', 'source'), []);
  assert.deepEqual(literals('.card{opacity:1}', 'built'), []);
});

test('freedom row 7: familyProblems accepts `--space-4` in the `calc()` of `width` (the length group)', () => {
  const declaration = first('.card { width: calc(100% - var(--space-4)); }');
  assert.deepEqual(familyProblems(declaration, familyOf), []);
  assert.deepEqual(
    varsOf(declaration.value).map((use) => use.inMath),
    [true],
  );
  assert.deepEqual(familyProblems(first('.card { width: var(--space-4); }'), familyOf).length, 1);
});

test('freedom row 8: bannedLiterals accepts the factor `1.5` in a `calc()` that holds a `var()`', () => {
  assert.deepEqual(literals('.card { padding: calc(var(--space-2) * 1.5); }', 'source'), []);
  assert.deepEqual(literals('.card { padding: calc(var(--space-2) + 1.5); }', 'source'), ['number 1.5']);
});

test('freedom row 9: familyProblems accepts space and size tokens in `minmax()`; bannedLiterals `0` and `1fr`', () => {
  const css =
    '.card { grid-template-columns: minmax(var(--space-4), 1fr) minmax(0, var(--size-content)) minmax(var(--space-4), 1fr); }';
  assert.deepEqual(familyProblems(first(css), familyOf), []);
  assert.deepEqual(literals(css, 'source'), []);
});

test('freedom row 10: bannedLiterals accepts the percentages of `polygon()` on `clip-path`', () => {
  assert.deepEqual(literals('.card { clip-path: polygon(0 0, 100% 0, 100% 85%, 0 100%); }', 'source'), []);
  assert.deepEqual(literals('.card { width: 85%; }', 'source'), ['percentage 85%']);
});

test('freedom row 11: bannedLiterals accepts the percentages of `object-position`', () => {
  assert.deepEqual(literals('.card { object-position: 30% 20%; }', 'source'), []);
});

test('freedom row 12: preludeOf and lengthProblems accept `(width >= 48rem)` with the breakpoint `48rem`', () => {
  assert.deepEqual(mediaMessages('@media (width >= 48rem) { .card { gap: 0; } }'), []);
  assert.deepEqual(mediaMessages('@media (width>=48rem){.card{gap:0}}'), []);
  assert.equal(
    atRuleProblem(parseCss('@media (width >= 48rem) {}', 'x').nodes[0] as AtRule, component('card')),
    undefined,
  );
});

test('freedom row 13: preludeOf and lengthProblems accept `@container (inline-size >= 30rem)`', () => {
  assert.deepEqual(mediaMessages('@container (inline-size >= 30rem) { .card { gap: 0; } }'), []);
  assert.deepEqual(mediaMessages('@container (inline-size>=30rem){.card{gap:0}}'), []);
});

test('freedom row 14: walk puts the declaration of a nested `@starting-style` into the rule `.card`', () => {
  const found: string[] = [];
  walk(parseCss('.card { @starting-style { opacity: 0; } }', 'card.css'), (node, context) => {
    if (node.type === 'declaration') {
      found.push(
        `${node.property} ${context.atRules.map((rule) => rule.name).join(',')} ${context.rule?.resolved.map(serialize).join(',')}`,
      );
    }
  });
  assert.deepEqual(found, ['opacity starting-style .card']);
});

test('freedom row 15: the nested `&:hover` resolves to `.card:hover`, the root compound with a state', () => {
  for (const css of [
    '.card { &:hover { color: var(--color-accent); } }',
    '.card{&:hover{color:var(--color-accent)}}',
  ]) {
    const selectors = selectorsOf(css).map(normalizeSelector);
    assert.deepEqual(selectors, ['.card', '.card:hover'], css);
  }
});

test('freedom row 16: specificity leaves out the root `.nav`: (0,3,0), at the limit', () => {
  for (const css of ['.nav .nav__link[aria-current="page"]:hover {}', '.nav .nav__link[aria-current=page]:hover{}']) {
    assert.deepEqual(
      selectorsOf(css).map(
        (selector) => `${specificity(selector, 'nav').join(',')} ${specificity(selector).join(',')}`,
      ),
      ['0,3,0 0,4,0'],
      css,
    );
  }
});

test('freedom row 17: `:has(img)` and `:nth-child(2n + 1)` are states; the An+B holds no literal', () => {
  assert.deepEqual(shapeMessages('.card:has(img) {}', component('card')), []);
  assert.deepEqual(
    selectorsOf('.list .list__item:nth-child(2n + 1) {}').map(normalizeSelector),
    selectorsOf('.list .list__item:nth-child(odd){}').map(normalizeSelector),
  );
  assert.deepEqual(literals('.list .list__item:nth-child(2n + 1) { gap: 0; }', 'source'), []);
});

test('freedom row 18: dashedIdents gives `--menu` twice; varsOf none; no custom property', () => {
  const css = '.card { anchor-name: --menu; position-anchor: --menu; }';
  const found = declarations(css).map(({ declaration }) =>
    [
      declaration.property,
      isCustomProperty(declaration.property),
      dashedIdents(declaration.value)
        .map((item) => item.value)
        .join(','),
      varsOf(declaration.value).length,
    ].join(' '),
  );
  assert.deepEqual(found, ['anchor-name false --menu 0', 'position-anchor false --menu 0']);
});

test('freedom row 19: bannedLiterals accepts `32` after the string tag of `font-variation-settings`', () => {
  assert.deepEqual(literals('.card { font-variation-settings: "opsz" 32; }', 'source'), []);
  assert.deepEqual(literals('.card { font-size: 32; }', 'source'), ['number 32']);
});

test('freedom row 20: familyProblems accepts the size token `--size-wide` on `aspect-ratio`', () => {
  assert.deepEqual(familyProblems(first('.card { aspect-ratio: var(--size-wide); }'), familyOf), []);
  const token = declarations(TOKENS).find(({ declaration }) => declaration.property === '--size-wide');
  assert.equal(token?.layer, 'tokens');
});

test('freedom row 21: familyProblems accepts `--shadow-card` on `box-shadow`; varsOf finds its color token', () => {
  assert.deepEqual(familyProblems(first('.card { box-shadow: var(--shadow-card); }'), familyOf), []);
  const token = declarations(TOKENS).find(({ declaration }) => declaration.property === '--shadow-card');
  assert.deepEqual(
    varsOf(token?.declaration.value ?? []).map((use) => use.name),
    ['--color-shadow'],
  );
});

test('freedom row 22: familyProblems accepts the line token on `stroke-width`', () => {
  assert.deepEqual(familyProblems(first('.card { stroke-width: var(--line-1); }'), familyOf), []);
  assert.equal(familyProblems(first('.card { stroke-width: var(--space-1); }'), familyOf).length, 1);
});

test('freedom row 23: bannedLiterals accepts the count `3` of `animation-iteration-count`', () => {
  assert.deepEqual(literals('.card { animation-iteration-count: 3; }', 'source'), []);
  assert.deepEqual(literals('.card { z-index: 3; }', 'source'), ['number 3']);
});

test('freedom row 24: in a page file, `.hero` is in shape, `grid-column` places, and `span 2` is no literal', () => {
  const css = '@media (width >= 48rem) { .hero { grid-column: span 2; } }';
  assert.deepEqual(shapeMessages(css, PAGE), []);
  assert.equal(PLACEMENT_PROPERTIES.has(first(css).property), true);
  assert.deepEqual(literals(css, 'source'), []);
  assert.deepEqual(mediaMessages(css), []);
});

/**
 * The design rules that read the project CSS (specification, 7.4, 7.8 and 8): `design-specs`, `design-pairs`, and the
 * built half of `design-tokens`. `design-format` is in `./parse.ts`, the source half of `design-tokens` in
 * `./tokens.ts`.
 *
 * They read the inputs of `../css/rules.ts`. `DESIGN_CHECKS` runs the source halves at the end of 6.1, step 2,
 * sub-step 9, after `design-tokens`; `DESIGN_AUDITS` runs the built halves in the design audit of
 * `astro:build:done`, step 4. The runner applies the dependency rule of 6.1: each rule here runs only when
 * `design-format` passes.
 *
 * This module uses the exports of `../css/rules.ts` only inside its functions, because that module and this one
 * import each other through the css groups.
 */

import type { BuildContext, ContrastPair, Design, DesignSpec } from '../context.ts';
import { DESIGN_FILE } from '../context.ts';
import { asciiLower, type CssNode, type Place, parseValue, type Rule, walk } from '../css/parse.ts';
import {
  type BuiltCheck,
  type BuiltCssInput,
  type BuiltSheet,
  builtCssOf,
  COMPONENT_CSS_FOLDER,
  type CssSourceFile,
  ELEMENTS_FILE,
  reportOnce,
  runBuiltChecks,
  runSourceChecks,
  type SourceCheck,
  type SourceCss,
  sourceWhere,
  tokenTableOf,
} from '../css/rules.ts';
import { normalizeSelector, parseSelector, rootComponentOf } from '../css/selectors.ts';
import { colorPosition, exactVar, isCustomProperty, varsOf } from '../css/values.ts';
import type { Report } from '../registry.ts';
import { familyOf } from './parse.ts';

// design-specs (7.8)

/** One row of `## Elements` or `## Components`, read once for both halves. */
interface SpecRow {
  row: DesignSpec;
  kind: 'elements' | 'components';
  /** The normalized selector of the row (`normalizeSelector`), or `undefined` when the row has a problem. */
  selector: string | undefined;
  /** The property as a declaration holds it: ASCII lower case, a custom property as written. */
  property: string;
  /** The component of a Components row: the owner of a root or modifier class of the first compound. */
  component: string | undefined;
  /** Why the row cannot be implemented: the selector, the token or the component. `undefined` for a valid row. */
  problem: string | undefined;
}

/** The text of a row in a detail: `body { color: var(--color-text) }`. */
const rowText = (row: DesignSpec): string => `${row.selector} { ${row.property}: var(${row.token}) }`;

/** The key of a declaration in the index of implemented rows. */
const declarationKey = (selector: string, property: string, token: string): string =>
  JSON.stringify([selector, property, token]);

/** The property of a declaration, as `parseCss` writes it: a custom property keeps its case. */
const propertyOf = (property: string): string => (isCustomProperty(property) ? property : asciiLower(property));

/**
 * The rows of a design, each with its normalized selector, its target and its problem. `design-format` checks no
 * cell of these tables, so a row whose selector does not parse, whose token is no declared name, or (a Components
 * row) whose first compound holds no class of a component, has a problem.
 */
function specRows(design: Design, components: ReadonlySet<string>): SpecRow[] {
  const names = tokenTableOf(design);
  const rows: SpecRow[] = [];
  const read = (row: DesignSpec, kind: SpecRow['kind']): void => {
    const parsed = parseValue(row.selector);
    const result = parsed.problems.length === 0 && parsed.values.length > 0 ? parseSelector(parsed.values) : undefined;
    const selector = result?.selector;
    // The root as the selector checks read it: `:is(.card)`, `:where(.card)` and `[class~=card]` start at `.card`.
    const component =
      selector !== undefined && kind === 'components' ? rootComponentOf(selector, components) : undefined;
    const problem =
      selector === undefined
        ? 'the selector does not parse'
        : !names.has(row.token)
          ? `${row.token} is no token of docs/design.md`
          : kind === 'components' && component === undefined
            ? 'the selector starts at no component root'
            : undefined;
    rows.push({
      row,
      kind,
      selector: problem === undefined && selector !== undefined ? normalizeSelector(selector) : undefined,
      property: propertyOf(row.property),
      component,
      problem,
    });
  };
  for (const row of design.elements) read(row, 'elements');
  for (const row of design.components) read(row, 'components');
  return rows;
}

/** The normalized resolved selectors of a style rule, each once (`normalizeSelector`). */
function normalizedOf(rule: Rule, cache: Map<Rule, string[]>): string[] {
  const cached = cache.get(rule);
  if (cached !== undefined) return cached;
  const out: string[] = [];
  for (const values of rule.resolved) {
    const { selector } = parseSelector(values);
    if (selector !== undefined) {
      const text = normalizeSelector(selector);
      if (!out.includes(text)) out.push(text);
    }
  }
  cache.set(rule, out);
  return out;
}

/** Adds a declaration of a style rule to an index: one key for each resolved selector of the rule. */
function indexDeclaration(node: CssNode, rule: Rule | undefined, index: Set<string>, cache: Map<Rule, string[]>): void {
  if (node.type !== 'declaration' || rule === undefined || rule.kind !== 'style') return;
  const token = exactVar(node.value);
  if (token === undefined) return;
  for (const selector of normalizedOf(rule, cache)) index.add(declarationKey(selector, node.property, token));
}

/** The declarations `<property>: var(<token>)` of a source file, by the normalized selector of their rule. */
function sourceIndex(file: CssSourceFile): Set<string> {
  const index = new Set<string>();
  const cache = new Map<Rule, string[]>();
  walk(file.sheet, (node, context) => {
    indexDeclaration(node, context.rule, index, cache);
  });
  return index;
}

/** Says whether the source input holds the text of `elements.css`. */
const hasElementsFile = (input: SourceCss): boolean => input.files.some((file) => file.kind === 'elements');

/**
 * `design-specs`, source half: each Elements row has a rule in `elements.css`, and each Components row a rule in the
 * file of its component, whose resolved selector equals the row's selector (normalized) and which declares
 * `<property>: var(<token>)` (7.8). A row with a problem fails too. The finding stands at the row.
 */
export function checkDesignSpecs(input: SourceCss, report: Report): void {
  if (input.design === undefined) return;
  const add = reportOnce(report);
  const indexes = new Map<string, Set<string>>();
  const indexOf = (path: string): Set<string> => {
    let index = indexes.get(path);
    if (index === undefined) {
      const file = input.files.find((each) => each.path === path);
      index = file === undefined ? new Set() : sourceIndex(file);
      indexes.set(path, index);
    }
    return index;
  };
  for (const spec of specRows(input.design, input.shape.components)) {
    const where = `${DESIGN_FILE}:${spec.row.line}`;
    if (spec.problem !== undefined || spec.selector === undefined) {
      add('design-specs', where, `${rowText(spec.row)}: ${spec.problem ?? ''}`);
      continue;
    }
    // A missing `elements.css` is `css-sources`'s, and one that is not read `config-suppression`'s.
    if (spec.kind === 'elements' && !hasElementsFile(input)) continue;
    const path = spec.kind === 'elements' ? ELEMENTS_FILE : `${COMPONENT_CSS_FOLDER}${spec.component ?? ''}.css`;
    if (!indexOf(path).has(declarationKey(spec.selector, spec.property, spec.row.token))) {
      add('design-specs', where, rowText(spec.row));
    }
  }
}

/** What one built sheet holds for `design-specs`. */
interface BuiltSpecs {
  /** The declarations of the `elements` layer and of the `components` layer, by normalized selector. */
  elements: Set<string>;
  components: Set<string>;
  /** True when the sheet holds a node of the `elements` layer. */
  hasElements: boolean;
  /** The components whose root (or a modifier of it) starts a style rule of the `components` layer. */
  roots: Set<string>;
}

function builtSpecsOf(sheet: BuiltSheet, components: ReadonlySet<string>): BuiltSpecs {
  const specs: BuiltSpecs = { elements: new Set(), components: new Set(), hasElements: false, roots: new Set() };
  const cache = new Map<Rule, string[]>();
  for (const { node, rule, kitLayer } of sheet.nodes) {
    if (kitLayer === 'elements') {
      specs.hasElements = true;
      indexDeclaration(node, rule, specs.elements, cache);
    } else if (kitLayer === 'components') {
      indexDeclaration(node, rule, specs.components, cache);
      if (node.type !== 'rule' || node.kind !== 'style') continue;
      for (const values of node.resolved) {
        const { selector } = parseSelector(values);
        const owner = selector === undefined ? undefined : rootComponentOf(selector, components);
        if (owner !== undefined) specs.roots.add(owner);
      }
    }
  }
  return specs;
}

/**
 * `design-specs`, built half: on each page that holds the `elements` layer, every valid Elements row has its rule in
 * that layer; on each page whose `components` layer holds a rule of a component's root, every valid row of that
 * component has its rule there. The minifier keeps a longhand whose value is a `var()`: it merges no such longhand
 * into a shorthand (probed for padding, margin, inset, border, border-radius, gap, outline, column-rule, flex and
 * font with Lightning CSS and the targets of 6.1), so the row's property is compared as written. A row with a problem
 * is the source half's alone.
 */
export function auditDesignSpecs(input: BuiltCssInput, report: Report): void {
  const design = input.source.design;
  if (design === undefined) return;
  const add = reportOnce(report);
  const rows = specRows(design, input.source.shape.components).filter((spec) => spec.problem === undefined);
  if (rows.length === 0) return;
  const bySheet = new Map<BuiltSheet, BuiltSpecs>();
  for (const page of input.pages) {
    const specs = page.sheets.map((sheet) => {
      let found = bySheet.get(sheet);
      if (found === undefined) {
        found = builtSpecsOf(sheet, input.source.shape.components);
        bySheet.set(sheet, found);
      }
      return found;
    });
    const hasElements = specs.some((each) => each.hasElements);
    for (const spec of rows) {
      if (spec.selector === undefined) continue;
      const key = declarationKey(spec.selector, spec.property, spec.row.token);
      if (spec.kind === 'elements') {
        if (hasElements && !specs.some((each) => each.elements.has(key)))
          add('design-specs', page.path, rowText(spec.row));
      } else if (spec.component !== undefined) {
        const component = spec.component;
        const holds = specs.some((each) => each.roots.has(component));
        if (holds && !specs.some((each) => each.components.has(key))) add('design-specs', page.path, rowText(spec.row));
      }
    }
  }
}

// design-pairs (7.4)

/** The roles of a pair (7.4). */
const ROLES: ReadonlySet<string> = new Set(['text', 'ui', 'non-text']);

/** The mandatory pairs and their roles (7.4, "Mandatory pairs"), in the order of the table. */
const MANDATORY: ReadonlyMap<string, string> = new Map([
  ['body', 'text'],
  ['link', 'ui'],
  ['focus', 'non-text'],
  ['error', 'ui'],
]);

/** One use of a color token in project CSS, in a position of 7.4. */
interface ColorUse {
  token: string;
  position: 'foreground' | 'background';
  file: CssSourceFile;
  /** The place of the `var()` that the declaration holds. */
  place: Place;
}

/** The custom properties that a file defines, each with the `var()` names of its values (locals, 7.8). */
function localsOf(file: CssSourceFile): Map<string, string[]> {
  const locals = new Map<string, string[]>();
  walk(file.sheet, (node) => {
    if (node.type !== 'declaration' || !isCustomProperty(node.property) || familyOf(node.property) !== undefined)
      return;
    const names = locals.get(node.property) ?? [];
    for (const use of varsOf(node.value)) if (use.name !== '' && !names.includes(use.name)) names.push(use.name);
    locals.set(node.property, names);
  });
  return locals;
}

/**
 * The token names that a `var()` name stands for: itself for a token, the tokens of a local of the same file,
 * through locals that name locals too. Each name is visited once, so a circle of locals ends.
 */
function tokensOf(name: string, locals: ReadonlyMap<string, string[]>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const queue = [name];
  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index] ?? '';
    if (seen.has(current)) continue;
    seen.add(current);
    if (familyOf(current) !== undefined) out.push(current);
    else for (const next of locals.get(current) ?? []) queue.push(next);
  }
  return out;
}

const isFontFace = (atRules: readonly { name: string }[]): boolean => atRules.some((rule) => rule.name === 'font-face');

/** Says whether a node stands inside `@scope`: what an `@scope` holds is part of the banned rule, `css-banned`'s. */
const isScope = (atRules: readonly { name: string }[]): boolean => atRules.some((rule) => rule.name === 'scope');

/**
 * Every use of a color token in the elements and component files, in a position of 7.4: a `--color-` token (also
 * through a local) on a property of `colorPosition`, and each `--color-` token of a `--gradient-` token (also
 * through a local) on any property, as a background. A shadow token holds no position. Page files are left out:
 * every non-placement declaration there is `css-page`'s, and no placement property takes a color. What an `@scope`
 * holds is left out too: it is part of the banned rule (`css-banned`).
 */
function colorUses(input: SourceCss, gradients: ReadonlyMap<string, string[]>): ColorUse[] {
  const uses: ColorUse[] = [];
  for (const file of input.files) {
    if (file.kind !== 'elements' && file.kind !== 'component') continue;
    const locals = localsOf(file);
    walk(file.sheet, (node, context) => {
      if (node.type !== 'declaration' || isCustomProperty(node.property) || isFontFace(context.atRules)) return;
      if (isScope(context.atRules)) return;
      const position = colorPosition(node.property);
      for (const use of varsOf(node.value)) {
        for (const token of tokensOf(use.name, locals)) {
          const family = familyOf(token);
          if (family === 'color' && position !== undefined) uses.push({ token, position, file, place: use.place });
          if (family === 'gradient') {
            for (const color of gradients.get(token) ?? []) {
              uses.push({ token: color, position: 'background', file, place: use.place });
            }
          }
        }
      }
    });
  }
  return uses;
}

/**
 * The `--color-` names of each `--gradient-` token of the design, in the order of its value. A gradient that is an
 * alias (`var(--gradient-hero)`, 7.4) has the colors of the gradient it names, through any chain of aliases. Each
 * gradient is visited once, so a circle (which `design-format` refuses) ends.
 */
function gradientColors(design: Design): Map<string, string[]> {
  const table = tokenTableOf(design);
  const out = new Map<string, string[]>();
  for (const declared of table.values()) {
    if (declared.family !== 'gradient') continue;
    const colors: string[] = [];
    const seen = new Set<string>();
    const queue = [declared.name];
    for (let index = 0; index < queue.length; index += 1) {
      const current = table.get(queue[index] ?? '');
      if (current === undefined || seen.has(current.name)) continue;
      seen.add(current.name);
      for (const use of varsOf(current.value)) {
        const family = familyOf(use.name);
        if (family === 'color' && !colors.includes(use.name)) colors.push(use.name);
        else if (family === 'gradient') queue.push(use.name);
      }
    }
    out.set(declared.name, colors);
  }
  return out;
}

/** The tokens that the rules of `elements.css` with one normalized selector set on one property. */
function elementsValues(input: SourceCss, selector: string, property: string): Set<string> {
  const out = new Set<string>();
  const file = input.files.find((each) => each.kind === 'elements');
  if (file === undefined) return out;
  const cache = new Map<Rule, string[]>();
  walk(file.sheet, (node, context) => {
    const rule = context.rule;
    if (node.type !== 'declaration' || node.property !== property || rule === undefined || rule.kind !== 'style')
      return;
    if (!normalizedOf(rule, cache).includes(selector)) return;
    const token = exactVar(node.value);
    if (token !== undefined) out.add(token);
  });
  return out;
}

/** A pair's problems (7.4): its tokens are `--color-` names of `## Color`, its role is known. */
function pairProblems(pair: ContrastPair, colors: ReadonlySet<string>): string[] {
  const problems: string[] = [];
  if (!colors.has(pair.foreground)) problems.push(`${pair.foreground || '(empty)'} is no color token`);
  if (!colors.has(pair.background)) problems.push(`${pair.background || '(empty)'} is no color token`);
  if (!ROLES.has(pair.role)) problems.push(`${pair.role || '(empty)'} is no role`);
  return problems;
}

/**
 * `design-pairs` (7.4): (a) each pair names two `--color-` tokens of `## Color` and a known role; (b) the mandatory
 * pairs `body`, `link` and `error` exist with their roles, `link` and `error` on the body background; (c) a `focus`
 * pair of the focus color on the body background and on every background that project CSS uses; (d) `elements.css`
 * sets the `body` pair on `body`, the `link` foreground on `a` and the `focus` foreground on `:focus-visible`. The
 * focus color is that `outline-color`: the ring that a page shows, so (c) asks for its pairs. (e) every color token
 * that project CSS uses as a foreground or a background is in a pair in that position, the colors of a used
 * `--gradient-` token as backgrounds.
 */
export function checkDesignPairs(input: SourceCss, report: Report): void {
  const design = input.design;
  if (design === undefined) return;
  const add = reportOnce(report);
  const colors = new Set(design.colors.map((color) => color.name));
  // (a) The tokens and the role of each pair.
  for (const pair of design.pairs) {
    const problems = pairProblems(pair, colors);
    if (problems.length > 0) add('design-pairs', `${DESIGN_FILE}:${pair.line}`, problems.join('; '));
  }
  // (b) The mandatory pairs, with the role of the table.
  const mandatory = (name: string): ContrastPair[] =>
    design.pairs.filter((pair) => pair.for === name && pair.role === MANDATORY.get(name));
  const body = mandatory('body');
  const page = new Set(body.map((pair) => pair.background));
  const onPage = (name: string): ContrastPair[] =>
    mandatory(name).filter((pair) => page.size === 0 || page.has(pair.background));
  const link = onPage('link');
  const error = onPage('error');
  const focus = mandatory('focus');
  for (const [name, pairs] of [
    ['body', body],
    ['link', link],
    ['focus', focus],
    ['error', error],
  ] as const) {
    if (pairs.length === 0) add('design-pairs', DESIGN_FILE, name);
  }
  // (e) Every color used in a position is in a pair in that position.
  const foregrounds = new Set(design.pairs.map((pair) => pair.foreground));
  const backgrounds = new Set(design.pairs.map((pair) => pair.background));
  const unpaired = new Map<string, string[]>();
  const used = new Set<string>(page);
  for (const use of colorUses(input, gradientColors(design))) {
    const paired = use.position === 'foreground' ? foregrounds.has(use.token) : backgrounds.has(use.token);
    if (paired) {
      if (use.position === 'background') used.add(use.token);
      continue;
    }
    const where = sourceWhere(use.file.path, use.place);
    const list = unpaired.get(where) ?? [];
    const text = `${use.token} as ${use.position}`;
    if (!list.includes(text)) list.push(text);
    unpaired.set(where, list);
  }
  for (const [where, list] of unpaired) add('design-pairs', where, list.join(', '));
  // (c) A focus pair of the focus color on each background that is in a pair (an unpaired one is reported above).
  // The focus color is the `outline-color` of `:focus-visible` that is a focus foreground; without one, (d) reports
  // the rule, and any focus pair counts here.
  const outline = elementsValues(input, ':focus-visible', 'outline-color');
  const rings = focus.filter((pair) => outline.has(pair.foreground)).map((pair) => pair.foreground);
  if (focus.length > 0) {
    const focused = new Set(
      focus.filter((pair) => rings.length === 0 || rings.includes(pair.foreground)).map((pair) => pair.background),
    );
    for (const background of used)
      if (!focused.has(background)) add('design-pairs', DESIGN_FILE, `focus on ${background}`);
  }
  // (d) elements.css uses the body, link and focus pairs. A missing `elements.css` is `css-sources`'s, and one that is
  // not read `config-suppression`'s: (d) needs the text of the file.
  if (!hasElementsFile(input)) return;
  if (body.length > 0) {
    const color = elementsValues(input, 'body', 'color');
    const fill = elementsValues(input, 'body', 'background-color');
    if (!body.some((pair) => color.has(pair.foreground) && fill.has(pair.background)))
      add('design-pairs', ELEMENTS_FILE, 'body');
  }
  if (link.length > 0) {
    const color = elementsValues(input, 'a', 'color');
    if (!link.some((pair) => color.has(pair.foreground))) add('design-pairs', ELEMENTS_FILE, 'a');
  }
  if (focus.length > 0 && rings.length === 0) add('design-pairs', ELEMENTS_FILE, ':focus-visible');
}

// design-tokens, built half (7.7)

/** The custom properties that the `tokens` layer of one built sheet declares. */
function tokenNamesOf(sheet: BuiltSheet): Set<string> {
  const names = new Set<string>();
  for (const { node, kitLayer } of sheet.nodes) {
    if (kitLayer === 'tokens' && node.type === 'declaration' && isCustomProperty(node.property))
      names.add(node.property);
  }
  return names;
}

/**
 * `design-tokens`, built half: on each page, the built `tokens` layer declares every token and helper parameter of
 * `docs/design.md`, and no other custom property. It compares names only, never values (13.1 item 40). A page with no
 * such declaration gives one finding.
 */
export function auditDesignTokens(input: BuiltCssInput, report: Report): void {
  const design = input.source.design;
  if (design === undefined) return;
  const add = reportOnce(report);
  const expected = [...tokenTableOf(design).keys()];
  const bySheet = new Map<BuiltSheet, Set<string>>();
  for (const page of input.pages) {
    const names = new Set<string>();
    for (const sheet of page.sheets) {
      let found = bySheet.get(sheet);
      if (found === undefined) {
        found = tokenNamesOf(sheet);
        bySheet.set(sheet, found);
      }
      for (const name of found) names.add(name);
    }
    if (names.size === 0) {
      add('design-tokens', page.path, '@layer tokens');
      continue;
    }
    for (const name of expected) if (!names.has(name)) add('design-tokens', page.path, `missing ${name}`);
    const known = new Set(expected);
    for (const name of names) if (!known.has(name)) add('design-tokens', page.path, `extra ${name}`);
  }
}

// The order

/** The design source halves of 5a, in the order of 6.1, step 2, sub-step 9. */
export const DESIGN_CHECKS: readonly SourceCheck[] = [
  { id: 'design-specs', needs: 'design', run: checkDesignSpecs },
  { id: 'design-pairs', needs: 'design', run: checkDesignPairs },
];

/** The design built halves, in the order of section 8. */
export const DESIGN_AUDITS: readonly BuiltCheck[] = [
  { id: 'design-tokens', needs: 'design', run: auditDesignTokens },
  { id: 'design-specs', needs: 'design', run: auditDesignSpecs },
];

/** The end of sub-step 9: `design-specs` and `design-pairs`, only when `design-format` passes. */
export function checkDesign(input: SourceCss, report: Report): void {
  runSourceChecks(input, DESIGN_CHECKS, report);
}

/** The design audit of 6.1, `astro:build:done`, step 4. It shares the built input of the css audit. */
export function auditDesign(ctx: BuildContext): void {
  runBuiltChecks(builtCssOf(ctx), DESIGN_AUDITS, ctx.report);
}

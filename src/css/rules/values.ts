/**
 * The value rules of the css group, and `modes-media` (specification, 7.3, 7.4, 7.5, 7.8, 7.10, 7.12 and 8):
 * `css-literal`, `css-token-family`, `css-local-var`, `css-var-undefined`, `css-media` and `modes-media`.
 *
 * A `check…` function is the source half of a rule, an `audit…` function its built half. `../rules.ts` runs them in
 * the order of 6.1 and applies the dependency rule and the settings rule. This module uses the exports of
 * `../rules.ts` only inside its functions (see the head of that module).
 *
 * **What a value rule reads.** In source: every declaration of `elements.css`, of the component files and of the page
 * files, also outside the layer block. It skips the declarations inside `@font-face`, what an `@scope` holds (part of
 * the banned rule, `css-banned`'s), and in a page file every declaration whose property is no placement property of
 * 7.9: `css-page` owns those. It never reads `tokens.css` or `fonts.css` (7.3). In built CSS: every declaration of the
 * project layers, with the same three exemptions. Unlayered nodes are `css-layer-order`'s. `css-var-undefined` and
 * `modes-media` read more; their functions say so.
 *
 * **Where.** A source finding stands at the file and line of the fact. A built finding stands at the page path, and
 * its detail names the selector, so that two facts of one page stay apart (section 8, Where). A rule reports one
 * finding for each place: `reportOnce` drops a repeat.
 *
 * Nothing here throws. Every table is a map or a set, and the work is linear in the size of the input.
 */
import type { HTMLElement } from 'node-html-parser';
import { DESIGN_FILE, type TokenFamily } from '../../context.ts';
import { familyOf } from '../../design/parse.ts';
import { enabledModes } from '../../modes.ts';
import type { Report } from '../../registry.ts';
import { lengthProblems, modeFeatures, parseMediaPrelude, preludeOf, requiresForcedColors } from '../media.ts';
import {
  type AtRule,
  asciiLower,
  type ComponentValue,
  type Declaration,
  isDelim,
  isIdent,
  type Place,
  parseValue,
  type Rule,
  serialize,
  splitCommas,
  trimWhitespace,
  type WalkContext,
  walk,
} from '../parse.ts';
import {
  type BuiltCssInput,
  type BuiltNode,
  type BuiltSheet,
  type CssSourceFile,
  type DeclaredName,
  declarationText,
  HELPER_CLASS_PARAMETERS,
  lineAt,
  type PageCss,
  PROJECT_LAYERS,
  reportOnce,
  type SourceCss,
  snippet,
  sourceWhere,
  type TokenTable,
} from '../rules.ts';
import {
  attributesOf,
  type ComplexSelector,
  classRole,
  isRootSelector,
  keyframesOwner,
  localOwner,
  ownerOf,
  PLACEMENT_PROPERTIES,
  parseSelector,
} from '../selectors.ts';
import {
  bannedLiterals,
  type CssForm,
  exactVar,
  familyProblems,
  helperParameterFamily,
  isCustomProperty,
  substituteVars,
  type VarUse,
  varsOf,
} from '../values.ts';

// Small facts

/** The vendor prefixes that the minifier adds. The four limits of 7.4 compare a property without them. */
const VENDOR_PREFIXES: readonly string[] = ['-webkit-', '-moz-', '-ms-', '-o-'];

/** A property in ASCII lower case and without a vendor prefix (7.3). */
function plainProperty(property: string): string {
  const lower = asciiLower(property);
  for (const prefix of VENDOR_PREFIXES) if (lower.startsWith(prefix)) return lower.slice(prefix.length);
  return lower;
}

/** Says whether a declaration stands inside `@font-face`. Its descriptors are exempt (7.3). */
const inFontFace = (atRules: readonly AtRule[]): boolean => atRules.some((rule) => rule.name === 'font-face');

/** Says whether a node stands inside `@scope`: what an `@scope` holds is part of the banned rule, `css-banned`'s. */
const inScope = (atRules: readonly AtRule[]): boolean => atRules.some((rule) => rule.name === 'scope');

/** Says whether a property is a placement property of 7.9: a page file may declare it. */
const isPlacement = (property: string): boolean => PLACEMENT_PROPERTIES.has(asciiLower(property));

/** The at-rules whose prelude 7.10 rules: `@media` and `@container`. */
const MEDIA_AT_RULES: ReadonlySet<string> = new Set(['media', 'container']);

/** The names of `@keyframes`, with the prefixed form that a browser still reads. */
const KEYFRAMES_AT_RULES: ReadonlySet<string> = new Set(['keyframes', '-webkit-keyframes']);

/** The mode options that the switch offers besides `auto` (7.12): with one of them on, mode features fail. */
const SWITCH_MODES: ReadonlySet<string> = new Set(['light', 'dark', 'contrast']);

/** `scroll-margin` and its longhands: a `--space-` value with a percentage is not for them (7.4). */
const SCROLL_MARGINS: ReadonlySet<string> = new Set(
  [
    '',
    '-top',
    '-right',
    '-bottom',
    '-left',
    '-block',
    '-inline',
    '-block-start',
    '-block-end',
    '-inline-start',
    '-inline-end',
  ].map((side) => `scroll-margin${side}`),
);

/** `contain-intrinsic-size` and its longhands: a `--size-` value with a percentage is not for them (7.4). */
const INTRINSIC_SIZES: ReadonlySet<string> = new Set(
  ['', '-width', '-height', '-block-size', '-inline-size'].map(
    (side) => `contain-intrinsic${side === '' ? '-size' : side}`,
  ),
);

/** The length units of CSS Values 4: a shadow with four of them has a spread distance (7.4). */
const LENGTH_UNITS: ReadonlySet<string> = new Set(
  'em rem ex rex cap rcap ch rch ic ric lh rlh vw vh vi vb vmin vmax svw svh svi svb svmin svmax lvw lvh lvi lvb lvmin lvmax dvw dvh dvi dvb dvmin dvmax cqw cqh cqi cqb cqmin cqmax cm mm q in pt pc px'.split(
    ' ',
  ),
);

/** The math functions of 7.3. In a shadow, one stands for a length. */
const MATH_FUNCTIONS: ReadonlySet<string> = new Set(['calc', 'min', 'max', 'clamp']);

/** Says whether the values hold a percentage at any depth. The recursion follows the tree of `parse.ts`. */
function holdsPercentage(values: readonly ComponentValue[]): boolean {
  return values.some(
    (value) =>
      value.type === 'percentage' ||
      (value.type === 'function' && holdsPercentage(value.args)) ||
      (value.type === 'block' && holdsPercentage(value.values)),
  );
}

/** Says whether a value is a ratio `<number> / <number>` at its top level (7.3, `--size-`). */
function isRatio(values: readonly ComponentValue[]): boolean {
  const words = values.filter((value) => value.type !== 'whitespace');
  const [first, slash, second, ...rest] = words;
  return rest.length === 0 && first?.type === 'number' && isDelim(slash, '/') && second?.type === 'number';
}

/** Says whether a shadow list holds `inset`, or a shadow with four lengths: a spread distance (7.4). */
function isBoxOnlyShadow(values: readonly ComponentValue[]): boolean {
  return splitCommas(values).some((shadow) => {
    let lengths = 0;
    for (const value of trimWhitespace(shadow)) {
      if (isIdent(value) && asciiLower(value.value) === 'inset') return true;
      const length =
        (value.type === 'dimension' && LENGTH_UNITS.has(value.unit)) ||
        (value.type === 'number' && value.value === 0) ||
        (value.type === 'function' && MATH_FUNCTIONS.has(value.name));
      if (length) lengths += 1;
    }
    return lengths >= 4;
  });
}

/**
 * The limit of 7.4 that a token breaks in a property, as a short text, or `undefined` (lead decision of 5a: four of
 * the six sentences, which `css-token-family` checks). `value` is the token value with its `var()`s resolved.
 */
function limitOf(property: string, family: TokenFamily, value: readonly ComponentValue[]): string | undefined {
  const name = plainProperty(property);
  if (family === 'space' && SCROLL_MARGINS.has(name) && holdsPercentage(value)) return 'a percentage';
  if (family === 'shadow' && name === 'text-shadow' && isBoxOnlyShadow(value)) return 'inset or a spread distance';
  if (family === 'size') {
    if (INTRINSIC_SIZES.has(name) && holdsPercentage(value)) return 'a percentage';
    const ratio = isRatio(value);
    if (ratio && name !== 'aspect-ratio') return 'a ratio';
    if (!ratio && name === 'aspect-ratio') return 'no ratio';
  }
  return undefined;
}

/** The places of every value inside the fallback of each `var()` that has one: what `css-literal` skips (drift 4). */
function fallbackOffsets(uses: readonly VarUse[]): Set<number> {
  const offsets = new Set<number>();
  const visit = (values: readonly ComponentValue[]): void => {
    for (const value of values) {
      offsets.add(value.place.offset);
      if (value.type === 'function') visit(value.args);
      else if (value.type === 'block') visit(value.values);
    }
  };
  for (const use of uses) if (use.fallback !== undefined) visit(use.fallback);
  return offsets;
}

// Selectors

const SELECTORS = new WeakMap<Rule, (ComplexSelector | undefined)[]>();

/** The parsed resolved selectors of a style rule, each `undefined` when it does not parse. Parsed once per rule. */
function selectorsOf(rule: Rule): (ComplexSelector | undefined)[] {
  const cached = SELECTORS.get(rule);
  if (cached !== undefined) return cached;
  const parsed = rule.kind === 'style' ? rule.resolved.map((values) => parseSelector(values).selector) : [];
  SELECTORS.set(rule, parsed);
  return parsed;
}

/** Says whether a rule is the root of a component: each resolved selector is the root compound (7.8). */
function onRootOf(rule: Rule | undefined, component: string): boolean {
  if (rule === undefined || rule.kind !== 'style') return false;
  const selectors = selectorsOf(rule);
  return (
    selectors.length > 0 && selectors.every((selector) => selector !== undefined && isRootSelector(selector, component))
  );
}

/**
 * The component of a built selector: the one whose root or modifier class the first compound holds (7.8). Built CSS
 * has no file name, so the class tells the component.
 */
function ownerOfSelector(selector: ComplexSelector, components: ReadonlySet<string>): string | undefined {
  for (const item of selector.compounds[0]?.classes ?? []) {
    const owner = ownerOf(item.name, components);
    const role = owner === undefined ? undefined : classRole(item.name, owner);
    if (role === 'root' || role === 'modifier') return owner;
  }
  return undefined;
}

/** The name of the `@keyframes` that encloses a node, or `undefined`. */
function keyframesNameOf(atRules: readonly AtRule[]): string | undefined {
  const rule = [...atRules].reverse().find((each) => KEYFRAMES_AT_RULES.has(each.name));
  const [only, ...rest] = rule === undefined ? [] : trimWhitespace(rule.prelude);
  if (rest.length > 0) return undefined;
  if (isIdent(only)) return only.value;
  return only?.type === 'string' ? only.value : undefined;
}

/**
 * The components that a node of the built `components` layer belongs to: the owner of each resolved selector of its
 * rule, or the owner of its `@keyframes`. The minifier merges rules of two components into one list, so there can be
 * two. An entry is `undefined` for a selector that starts at no component root (`css-selector` reports it).
 */
function builtOwners(item: BuiltNode, components: ReadonlySet<string>): (string | undefined)[] {
  const { rule } = item;
  if (rule?.kind === 'style') {
    return selectorsOf(rule).map((selector) =>
      selector === undefined ? undefined : ownerOfSelector(selector, components),
    );
  }
  const name = keyframesNameOf(item.atRules);
  return [name === undefined ? undefined : keyframesOwner(name, components)];
}

/**
 * The components whose roots a built rule is: one for each selector, when every selector is the root compound of
 * its own component (7.8); `undefined` when one is not. The minifier merges two adjacent rules with the same
 * declarations into one list (`.card,.box{--stack-gap:…}`), so there can be two.
 */
function builtRootsOf(rule: Rule | undefined, components: ReadonlySet<string>): string[] | undefined {
  if (rule === undefined || rule.kind !== 'style') return undefined;
  const roots: string[] = [];
  for (const selector of selectorsOf(rule)) {
    const owner = selector === undefined ? undefined : ownerOfSelector(selector, components);
    if (owner === undefined || selector === undefined || !isRootSelector(selector, owner)) return undefined;
    roots.push(owner);
  }
  return roots.length === 0 ? undefined : roots;
}

/** The component whose root a built rule is in every selector (7.8), or `undefined` (none, or two). */
function builtRootOf(rule: Rule | undefined, components: ReadonlySet<string>): string | undefined {
  const [first, ...rest] = builtRootsOf(rule, components) ?? [];
  return first !== undefined && rest.every((owner) => owner === first) ? first : undefined;
}

// What the value rules read

/** One declaration of a project CSS file that a value rule reads. */
interface SourceDeclaration {
  file: CssSourceFile;
  declaration: Declaration;
  context: WalkContext;
}

const SOURCE_DECLARATIONS = new WeakMap<SourceCss, SourceDeclaration[]>();

/** The kinds of project CSS file whose declarations the value rules read (7.3: not `tokens.css`, not `fonts.css`). */
const VALUE_FILES: ReadonlySet<string> = new Set(['elements', 'component', 'page']);

/** The declarations that the value rules read in source (see the head of this module), in file and text order. */
function sourceDeclarations(input: SourceCss): SourceDeclaration[] {
  const cached = SOURCE_DECLARATIONS.get(input);
  if (cached !== undefined) return cached;
  const out: SourceDeclaration[] = [];
  for (const file of input.files) {
    if (!VALUE_FILES.has(file.kind)) continue;
    walk(file.sheet, (node, context) => {
      if (node.type !== 'declaration' || inFontFace(context.atRules) || inScope(context.atRules)) return;
      if (file.kind === 'page' && !isPlacement(node.property)) return;
      out.push({ file, declaration: node, context });
    });
  }
  SOURCE_DECLARATIONS.set(input, out);
  return out;
}

/** One declaration of built CSS that a value rule reads. */
interface BuiltDeclaration {
  item: BuiltNode;
  declaration: Declaration;
}

/**
 * The declarations of one built sheet in the given layers, without `@font-face` and without the page-layer
 * declarations that `css-page` owns.
 */
function builtDeclarations(sheet: BuiltSheet, layers: (layer: BuiltNode['kitLayer']) => boolean): BuiltDeclaration[] {
  const out: BuiltDeclaration[] = [];
  for (const item of sheet.nodes) {
    const { node } = item;
    if (node.type !== 'declaration' || !layers(item.kitLayer) || inFontFace(item.atRules) || inScope(item.atRules)) {
      continue;
    }
    if (item.kitLayer === 'page' && !isPlacement(node.property)) continue;
    out.push({ item, declaration: node });
  }
  return out;
}

/** Says whether a built node is in a project layer (7.1). */
function inProjectLayer(layer: BuiltNode['kitLayer']): boolean {
  return layer !== undefined && PROJECT_LAYERS.has(layer);
}

/** The selector text of a built node's rule, or its `@keyframes`, for a detail. */
function builtPlaceText(item: BuiltNode): string {
  const { rule } = item;
  if (rule?.kind === 'style') return rule.resolved.map((values) => serialize(values)).join(', ');
  if (rule?.kind === 'keyframe') return `@keyframes ${keyframesNameOf(item.atRules) ?? ''} ${serialize(rule.prelude)}`;
  return item.atRules.map((each) => `@${each.name}`).join(' ');
}

/** The detail of a built finding: the fact and the selector it stands in. */
function builtDetail(item: BuiltNode, text: string): string {
  const place = builtPlaceText(item);
  return snippet(place === '' ? text : `${text} in ${place}`);
}

/**
 * Computes the facts of each built sheet once, then reports them on every page that holds the sheet (pages share
 * sheets). A fact is a detail; its `where` is the page path.
 */
function reportPerPage(
  input: BuiltCssInput,
  report: Report,
  id: string,
  factsOf: (sheet: BuiltSheet) => readonly string[],
  pageFacts?: (page: PageCss) => readonly string[],
): void {
  const add = reportOnce(report);
  const facts = new Map<BuiltSheet, readonly string[]>();
  for (const page of input.pages) {
    for (const sheet of page.sheets) {
      let list = facts.get(sheet);
      if (list === undefined) {
        list = factsOf(sheet);
        facts.set(sheet, list);
      }
      for (const detail of list) add(id, page.path, detail);
    }
    for (const detail of pageFacts?.(page) ?? []) add(id, page.path, detail);
  }
}

// Locals (7.8)

/**
 * The locals that each component file defines on its root: component → local → the tokens of its definitions
 * (`exactVar`, each once, in text order). A local is re-set on its root by a modifier, a state or an at-rule, so it
 * can hold more than one token; a definition that is no single `var()` adds none (`css-local-var` reports it).
 */
type LocalTable = ReadonlyMap<string, ReadonlyMap<string, readonly string[]>>;

/** Adds one definition of a local to a table. */
function addLocal(table: Map<string, Map<string, string[]>>, component: string, declaration: Declaration): void {
  const locals = table.get(component) ?? new Map<string, string[]>();
  const tokens = locals.get(declaration.property) ?? [];
  const token = exactVar(declaration.value);
  if (token !== undefined && !tokens.includes(token)) tokens.push(token);
  locals.set(declaration.property, tokens);
  table.set(component, locals);
}

const SOURCE_LOCALS = new WeakMap<SourceCss, LocalTable>();

/**
 * The locals of the source: for each component file `components/<c>.css`, the `--<c>-*` properties that a rule on
 * its root defines, each with the tokens of all its definitions there. `css-token-family` checks every one of these
 * tokens where the local is read, and `css-var-undefined` reads the names in scope.
 */
function sourceLocals(input: SourceCss): LocalTable {
  const cached = SOURCE_LOCALS.get(input);
  if (cached !== undefined) return cached;
  const table = new Map<string, Map<string, string[]>>();
  for (const { file, declaration, context } of sourceDeclarations(input)) {
    const component = file.kind === 'component' ? file.component : undefined;
    if (component === undefined || !isCustomProperty(declaration.property)) continue;
    if (localOwner(declaration.property, input.shape.components) !== component) continue;
    if (onRootOf(context.rule, component)) addLocal(table, component, declaration);
  }
  SOURCE_LOCALS.set(input, table);
  return table;
}

/** The locals that one built sheet defines on component roots, as `sourceLocals` gives them for source. */
function builtLocals(sheet: BuiltSheet, components: ReadonlySet<string>): LocalTable {
  const table = new Map<string, Map<string, string[]>>();
  for (const { item, declaration } of builtDeclarations(sheet, (layer) => layer === 'components')) {
    if (!isCustomProperty(declaration.property)) continue;
    const component = builtRootOf(item.rule, components);
    if (component === undefined || localOwner(declaration.property, components) !== component) continue;
    addLocal(table, component, declaration);
  }
  return table;
}

/**
 * The tokens of a local that is in scope where it is read: a local of `c`, defined on the root of `c`, read in `c`
 * (7.8). `component` is the component of the reading file or rule. `undefined` for any other name: it is no local in
 * scope.
 */
function localTokens(
  name: string,
  component: string | undefined,
  locals: LocalTable,
  components: ReadonlySet<string>,
): readonly string[] | undefined {
  if (component === undefined || localOwner(name, components) !== component) return undefined;
  return locals.get(component)?.get(name);
}

/** The component of a source file whose locals are in scope there: the component of a component file. */
const fileComponent = (file: CssSourceFile): string | undefined =>
  file.kind === 'component' ? file.component : undefined;

/** The single component of a built node in the components layer, or `undefined` (none, or two). */
function builtComponent(item: BuiltNode, components: ReadonlySet<string>): string | undefined {
  if (item.kitLayer !== 'components') return undefined;
  const owners = builtOwners(item, components);
  const [first] = owners;
  return first !== undefined && owners.every((owner) => owner === first) ? first : undefined;
}

// css-literal (7.3)

/**
 * The places where `css-literal` fails one declaration, in text order; none when it passes.
 *
 * - A custom property is a definition. A local of any component and a helper parameter on a component root are
 *   `css-local-var`'s, so the rule skips them whole. Every other definition fails at its place, and its value is not
 *   scanned.
 * - Else each `var()` with a fallback fails at its place, once: a literal or a `var()` inside its fallback gives no
 *   second finding (drift 4). Each literal outside a fallback that 7.3 does not allow fails at its place.
 */
function literalPlaces(
  declaration: Declaration,
  context: { atRules: readonly AtRule[]; form: CssForm },
  definition: { local: boolean; helperOnRoot: boolean },
): Place[] {
  if (isCustomProperty(declaration.property)) {
    return definition.local || definition.helperOnRoot ? [] : [declaration.place];
  }
  const uses = varsOf(declaration.value);
  const skipped = fallbackOffsets(uses);
  const fallbacks = uses.filter((use) => use.fallback !== undefined && !skipped.has(use.place.offset));
  const literals = bannedLiterals(declaration, {
    form: context.form,
    forcedColors: requiresForcedColors(context.atRules),
  }).filter((each) => !skipped.has(each.place.offset));
  return [...fallbacks, ...literals].map((each) => each.place).sort((a, b) => a.offset - b.offset);
}

/** `css-literal`, source half: literals outside the 7.3 allowlist, `var()` fallbacks and custom properties. */
export function checkCssLiteral(input: SourceCss, report: Report): void {
  const add = reportOnce(report);
  const components = input.shape.components;
  for (const { file, declaration, context } of sourceDeclarations(input)) {
    const local = localOwner(declaration.property, components) !== undefined;
    const component = fileComponent(file);
    const helperOnRoot =
      component !== undefined &&
      helperParameterFamily(declaration.property) !== undefined &&
      onRootOf(context.rule, component);
    const places = literalPlaces(declaration, { atRules: context.atRules, form: 'source' }, { local, helperOnRoot });
    // One finding for each line: the detail names the declaration, so a second literal on the line adds nothing.
    for (const place of places) add('css-literal', sourceWhere(file.path, place), declarationText(declaration));
  }
}

/** `css-literal`, built half: the same in the project layers of built CSS, with the minifier's forms. */
export function auditCssLiteral(input: BuiltCssInput, report: Report): void {
  const components = input.source.shape.components;
  reportPerPage(input, report, 'css-literal', (sheet) =>
    builtDeclarations(sheet, inProjectLayer).flatMap(({ item, declaration }) => {
      const local = localOwner(declaration.property, components) !== undefined;
      // A merged list of roots (`.card,.box{--stack-gap:…}`) is a root in each selector.
      const helperOnRoot =
        item.kitLayer === 'components' &&
        helperParameterFamily(declaration.property) !== undefined &&
        builtRootsOf(item.rule, components) !== undefined;
      const places = literalPlaces(declaration, { atRules: item.atRules, form: 'built' }, { local, helperOnRoot });
      return places.length === 0 ? [] : [builtDetail(item, declarationText(declaration))];
    }),
  );
}

// css-token-family (7.3, 7.4)

/**
 * The `var()`s of a declaration that break `css-token-family`, each with a short reason: a family that the property
 * does not accept (7.3), or one of the four limits of 7.4 (lead decision of 5a). `declaredOf` gives the declared names
 * that a `var()` stands for: a token, a helper parameter, or each token of a local in scope (a local re-set on its
 * root by a modifier, a state or an at-rule holds each of them). A name it does not know is `css-var-undefined`'s and
 * is skipped. Each `var()` gives at most one fact.
 */
function familyFacts(
  declaration: Declaration,
  declaredOf: (name: string) => readonly DeclaredName[],
  tokens: TokenTable,
): { use: VarUse; reason: string }[] {
  if (isCustomProperty(declaration.property)) return [];
  const uses = varsOf(declaration.value);
  const out: { use: VarUse; reason: string }[] = [];
  const reported = new Set<number>();
  // Round `n` reads the `n`-th token of each local (the last one when it has fewer), so each token is checked once.
  const rounds = uses.reduce((most, use) => Math.max(most, declaredOf(use.name).length), 1);
  for (let round = 0; round < rounds; round += 1) {
    const pick = (name: string): DeclaredName | undefined => {
      const list = declaredOf(name);
      return list[Math.min(round, list.length - 1)];
    };
    for (const use of familyProblems(declaration, (name) => pick(name)?.family)) {
      if (reported.has(use.place.offset)) continue;
      reported.add(use.place.offset);
      out.push({ use, reason: `a token of the ${pick(use.name)?.family ?? ''} family` });
    }
  }
  // A `var()` with a family problem gives no second finding for a limit.
  const resolve = (name: string): readonly ComponentValue[] | undefined => tokens.get(name)?.value;
  for (const use of uses) {
    if (reported.has(use.place.offset) || use.name === '') continue;
    for (const declared of declaredOf(use.name)) {
      const limit = limitOf(declaration.property, declared.family, substituteVars(declared.value, resolve));
      if (limit === undefined) continue;
      reported.add(use.place.offset);
      out.push({ use, reason: limit });
      break;
    }
  }
  return out.sort((a, b) => a.use.place.offset - b.use.place.offset);
}

/**
 * Where the kit's layout helpers read each helper parameter (7.6): the property that its `var()` stands in. A
 * `--size-` parameter is a length there, so a ratio token breaks the limit of 7.4 as it does in `width`.
 */
const HELPER_USES: ReadonlyMap<string, string> = new Map([
  ['--stack-gap', 'gap'],
  ['--cluster-gap', 'gap'],
  ['--grid-gap', 'gap'],
  ['--grid-min', 'grid-template-columns'],
  ['--center-max', 'max-inline-size'],
  ['--center-gutter', 'padding-inline'],
]);

/**
 * The limit of 7.4 that the token of a helper parameter breaks where the helper reads it, as `a ratio in
 * max-inline-size`, or `undefined`. `value` is the parameter's value: a row of `## Layout helpers`, or a re-set on a
 * component root. A value that is no `var()` of a token of the parameter's family is `css-local-var`'s (a re-set) or
 * `design-format`'s (a row), so it is skipped.
 */
function helperLimit(parameter: string, value: readonly ComponentValue[], tokens: TokenTable): string | undefined {
  const use = HELPER_USES.get(parameter);
  const family = helperParameterFamily(parameter);
  const target = exactVar(value);
  if (use === undefined || family === undefined || target === undefined || familyOf(target) !== family) {
    return undefined;
  }
  const resolve = (name: string): readonly ComponentValue[] | undefined => tokens.get(name)?.value;
  const limit = limitOf(use, family, substituteVars(value, resolve));
  return limit === undefined ? undefined : `${limit} in ${use}`;
}

/** The detail of `css-token-family`: the declaration, the name and why: `width: var(--size-wide) (--size-wide: a ratio)`. */
const familyDetail = (declaration: Declaration, use: VarUse, reason: string): string =>
  snippet(`${declarationText(declaration)} (${use.name}: ${reason})`);

/** The declared names that a `var()` stands for: a declared name itself, or each token of a local in scope. */
function declaredLookup(
  tokens: TokenTable,
  component: string | undefined,
  locals: LocalTable,
  components: ReadonlySet<string>,
): (name: string) => readonly DeclaredName[] {
  return (name) => {
    const direct = tokens.get(name);
    if (direct !== undefined) return [direct];
    return (localTokens(name, component, locals, components) ?? []).flatMap((token) => {
      const declared = tokens.get(token);
      return declared === undefined ? [] : [declared];
    });
  };
}

/**
 * `css-token-family`, source half: every `var()` names a family that its property accepts, and the four limits of
 * 7.4. A helper parameter, in `## Layout helpers` or re-set on a component root, keeps the limits where the kit's
 * helpers read it.
 */
export function checkCssTokenFamily(input: SourceCss, report: Report): void {
  const { tokens } = input;
  if (tokens === undefined) return;
  const add = reportOnce(report);
  const locals = sourceLocals(input);
  const components = input.shape.components;
  for (const helper of input.design?.helpers ?? []) {
    const declared = tokens.get(helper.name);
    const limit = declared?.kind === 'helper' ? helperLimit(helper.name, declared.value, tokens) : undefined;
    if (limit !== undefined) {
      add('css-token-family', `${DESIGN_FILE}:${helper.line}`, snippet(`${helper.name}: ${helper.token} (${limit})`));
    }
  }
  for (const { file, declaration, context } of sourceDeclarations(input)) {
    const component = fileComponent(file);
    if (component !== undefined && onRootOf(context.rule, component)) {
      const limit = helperLimit(declaration.property, declaration.value, tokens);
      if (limit !== undefined) {
        add(
          'css-token-family',
          sourceWhere(file.path, declaration.place),
          `${declarationText(declaration)} (${limit})`,
        );
      }
    }
    const declaredOf = declaredLookup(tokens, component, locals, components);
    for (const { use, reason } of familyFacts(declaration, declaredOf, tokens)) {
      add('css-token-family', sourceWhere(file.path, use.place), familyDetail(declaration, use, reason));
    }
  }
}

/** `css-token-family`, built half. */
export function auditCssTokenFamily(input: BuiltCssInput, report: Report): void {
  const { tokens } = input.source;
  if (tokens === undefined) return;
  const components = input.source.shape.components;
  reportPerPage(input, report, 'css-token-family', (sheet) => {
    const locals = builtLocals(sheet, components);
    return builtDeclarations(sheet, inProjectLayer).flatMap(({ item, declaration }) => {
      const onRoot = item.kitLayer === 'components' && builtRootsOf(item.rule, components) !== undefined;
      const limit = onRoot ? helperLimit(declaration.property, declaration.value, tokens) : undefined;
      const helper = limit === undefined ? [] : [builtDetail(item, `${declarationText(declaration)} (${limit})`)];
      const declaredOf = declaredLookup(tokens, builtComponent(item, components), locals, components);
      return [
        ...helper,
        ...familyFacts(declaration, declaredOf, tokens).map(({ use, reason }) =>
          builtDetail(item, familyDetail(declaration, use, reason)),
        ),
      ];
    });
  });
}

// css-local-var (7.5, 7.8)

/** Says whether a local's value is exactly one `var()` of a token name (7.8). Whether it is declared is not asked. */
function isTokenValue(values: readonly ComponentValue[]): boolean {
  const name = exactVar(values);
  return name !== undefined && familyOf(name) !== undefined;
}

/** Says whether a helper parameter is re-set to a token of its own family (7.5). */
function isHelperValue(parameter: string, values: readonly ComponentValue[]): boolean {
  const name = exactVar(values);
  return name !== undefined && familyOf(name) === helperParameterFamily(parameter);
}

/**
 * The facts of `css-local-var` on one declaration: `true` when it breaks the rule.
 *
 * - `here`: the component whose file or rule holds the declaration (`undefined` outside a component).
 * - `root`: the component whose root the declaration's rule is, if any.
 * - `onRoot`: true when the rule is a component root in each selector, also a merged list of two components' roots
 *   in built CSS. A helper parameter set there takes a token of its family.
 */
function breaksLocalVar(
  declaration: Declaration,
  place: { here: string | undefined; root: string | undefined; onRoot: boolean },
  components: ReadonlySet<string>,
): boolean {
  const { property, value } = declaration;
  const { here, root } = place;
  if (isCustomProperty(property)) {
    const owner = localOwner(property, components);
    if (owner !== undefined && (owner !== here || root !== here || !isTokenValue(value))) return true;
    const helper = helperParameterFamily(property) !== undefined;
    if (owner === undefined && helper && place.onRoot && !isHelperValue(property, value)) return true;
  }
  return varsOf(value).some((use) => {
    const owner = use.name === '' ? undefined : localOwner(use.name, components);
    return owner !== undefined && owner !== here;
  });
}

/** `css-local-var`, source half: where a component local is defined, what it is set to, where it is read. */
export function checkCssLocalVar(input: SourceCss, report: Report): void {
  const add = reportOnce(report);
  const components = input.shape.components;
  for (const { file, declaration, context } of sourceDeclarations(input)) {
    const here = fileComponent(file);
    const root = here !== undefined && onRootOf(context.rule, here) ? here : undefined;
    if (!breaksLocalVar(declaration, { here, root, onRoot: root !== undefined }, components)) continue;
    add('css-local-var', sourceWhere(file.path, declaration.place), declarationText(declaration));
  }
}

/** `css-local-var`, built half. */
export function auditCssLocalVar(input: BuiltCssInput, report: Report): void {
  const components = input.source.shape.components;
  reportPerPage(input, report, 'css-local-var', (sheet) =>
    builtDeclarations(sheet, inProjectLayer).flatMap(({ item, declaration }) => {
      const here = builtComponent(item, components);
      const roots = item.kitLayer === 'components' ? builtRootsOf(item.rule, components) : undefined;
      const root = item.kitLayer === 'components' ? builtRootOf(item.rule, components) : undefined;
      return breaksLocalVar(declaration, { here, root, onRoot: roots !== undefined }, components)
        ? [builtDetail(item, declarationText(declaration))]
        : [];
    }),
  );
}

// css-var-undefined (7.3, 7.5, 7.8)

/** The `var()`s of a declaration whose name is no declared name and no local in scope, an empty name included. */
function undefinedVars(
  declaration: Declaration,
  tokens: TokenTable,
  component: string | undefined,
  locals: LocalTable,
  components: ReadonlySet<string>,
): VarUse[] {
  return varsOf(declaration.value).filter(
    (use) =>
      use.name === '' || (!tokens.has(use.name) && localTokens(use.name, component, locals, components) === undefined),
  );
}

/** The name of a `var()` for a detail; an empty name shows the declaration. */
const varText = (use: VarUse, declaration: Declaration): string =>
  use.name === '' ? declarationText(declaration) : use.name;

/** `css-var-undefined`, source half: every `var()` is a `tokens.css` name or an in-scope local. */
export function checkCssVarUndefined(input: SourceCss, report: Report): void {
  const { tokens } = input;
  if (tokens === undefined) return;
  const add = reportOnce(report);
  const locals = sourceLocals(input);
  const components = input.shape.components;
  for (const { file, declaration } of sourceDeclarations(input)) {
    for (const use of undefinedVars(declaration, tokens, fileComponent(file), locals, components)) {
      add('css-var-undefined', sourceWhere(file.path, use.place), varText(use, declaration));
    }
  }
}

/** `css-var-undefined`, built half: the same outside the `layout` layer, and the parameters of each helper used. */
export function auditCssVarUndefined(input: BuiltCssInput, report: Report): void {
  const { tokens } = input.source;
  if (tokens === undefined) return;
  const components = input.source.shape.components;
  // The row reads every layer of the order statement but the kit's `layout` (7.5): the helpers read their
  // parameters there, and the second sentence checks them per page. Unlayered nodes are `css-layer-order`'s.
  const outsideLayout = (layer: BuiltNode['kitLayer']): boolean => layer !== undefined && layer !== 'layout';
  reportPerPage(
    input,
    report,
    'css-var-undefined',
    (sheet) => {
      const locals = builtLocals(sheet, components);
      return builtDeclarations(sheet, outsideLayout).flatMap(({ item, declaration }) =>
        undefinedVars(declaration, tokens, builtComponent(item, components), locals, components).map((use) =>
          builtDetail(item, varText(use, declaration)),
        ),
      );
    },
    (page) => helperFacts(page, tokens),
  );
}

/** The parameters of the helpers that a page uses and that `tokens.css` does not define (7.5, drift 10). */
function helperFacts(page: PageCss, tokens: TokenTable): string[] {
  const out: string[] = [];
  for (const [helper, parameters] of HELPER_CLASS_PARAMETERS) {
    if (!page.classes.has(helper)) continue;
    for (const parameter of parameters) {
      if (tokens.get(parameter)?.kind !== 'helper') out.push(`.${helper} needs ${parameter}`);
    }
  }
  return out;
}

// css-media (7.10)

/** The `@media` and `@container` rules of the source files that `css-media` reads, with their file. */
function sourceMediaRules(input: SourceCss, kinds: ReadonlySet<string>): { file: CssSourceFile; rule: AtRule }[] {
  const out: { file: CssSourceFile; rule: AtRule }[] = [];
  for (const file of input.files) {
    if (!kinds.has(file.kind)) continue;
    walk(file.sheet, (node, context) => {
      if (node.type === 'at-rule' && MEDIA_AT_RULES.has(node.name) && !inScope(context.atRules)) {
        out.push({ file, rule: node });
      }
    });
  }
  return out;
}

/** The problems of a prelude for `css-media`: the grammar and features of 7.10, `var()`, and the lengths. */
function mediaProblems(
  rule: AtRule,
  breakpoints: NonNullable<SourceCss['design']>['breakpoints'],
  form: CssForm,
): { message: string; place: Place }[] {
  const prelude = preludeOf(rule);
  if (prelude === undefined) return [];
  return [...prelude.problems, ...lengthProblems(prelude, breakpoints, form)];
}

/** `css-media`, source half: the preludes of `@media` and `@container` (7.10), `var()` included. */
export function checkCssMedia(input: SourceCss, report: Report): void {
  const { design } = input;
  if (design === undefined) return;
  const add = reportOnce(report);
  for (const { file, rule } of sourceMediaRules(input, VALUE_FILES)) {
    for (const problem of mediaProblems(rule, design.breakpoints, 'source')) {
      add('css-media', sourceWhere(file.path, problem.place), problem.message);
    }
  }
}

/** `css-media`, built half: the preludes in the minifier's form. */
export function auditCssMedia(input: BuiltCssInput, report: Report): void {
  const { design } = input.source;
  if (design === undefined) return;
  reportPerPage(input, report, 'css-media', (sheet) =>
    sheet.nodes.flatMap((item) => {
      const { node } = item;
      if (node.type !== 'at-rule' || !MEDIA_AT_RULES.has(node.name) || !inProjectLayer(item.kitLayer)) return [];
      if (inScope(item.atRules)) return [];
      const prelude = `@${node.name} ${serialize(node.prelude)}`;
      return mediaProblems(node, design.breakpoints, 'built').map((problem) =>
        snippet(`${problem.message} in ${prelude}`),
      );
    }),
  );
}

// modes-media (7.12)

/** Says whether one of the switch options `light`, `dark` or `contrast` is on (7.12). */
function switchOn(input: SourceCss): boolean {
  return input.options !== undefined && enabledModes(input.options).some((mode) => SWITCH_MODES.has(mode));
}

/** The mode features of a prelude, each as a detail: `prefers-color-scheme in @media (…)`. */
function modeFacts(rule: AtRule): { place: Place; detail: string }[] {
  const prelude = preludeOf(rule);
  if (prelude === undefined) return [];
  const text = `@${rule.name} ${serialize(rule.prelude)}`;
  return modeFeatures(prelude).map((feature) => ({
    place: feature.place,
    detail: snippet(`${feature.name} in ${text}`),
  }));
}

/**
 * The value of an HTML `media` attribute that reads a mode feature, or `undefined`. An Astro expression (`{…}`) is
 * not read: its value is known only when the page renders, and the built half reads it then.
 */
function modeMedia(element: HTMLElement): string | undefined {
  const value = element.getAttribute('media');
  if (value === undefined || value.trimStart().startsWith('{')) return undefined;
  const prelude = parseMediaPrelude(parseValue(value).values);
  return modeFeatures(prelude).length > 0 ? value : undefined;
}

/** The detail of a `media` attribute: the element and the attribute. */
const mediaText = (element: HTMLElement, value: string): string =>
  snippet(`<${asciiLower(element.rawTagName)} media="${value}">`);

/** The attribute selectors on `data-mode` of a style rule (7.12), with the selector text. */
function dataModeFacts(rule: Rule): { place: Place; detail: string }[] {
  const out: { place: Place; detail: string }[] = [];
  selectorsOf(rule).forEach((selector, index) => {
    const attribute =
      selector === undefined ? undefined : attributesOf(selector).find((each) => each.name === 'data-mode');
    if (attribute !== undefined)
      out.push({ place: attribute.place, detail: snippet(serialize(rule.resolved[index] ?? [])) });
  });
  return out;
}

/** Says whether a declaration sets `color-scheme` (7.12). */
const setsColorScheme = (declaration: Declaration): boolean => plainProperty(declaration.property) === 'color-scheme';

/**
 * `modes-media`, source half: mode features in `@media`, `data-mode` and `color-scheme` outside `tokens.css`; `media`
 * in markup. Three facts are other rules', so each reports once: a mode feature in an `@container` prelude is no
 * container feature (`css-media`, 7.10); a selector of a page file, `[data-mode]` too, is `css-selector`'s and a
 * non-placement declaration there `css-page`'s (7.9); what an `@scope` holds is `css-banned`'s.
 */
export function checkModesMedia(input: SourceCss, report: Report): void {
  const add = reportOnce(report);
  const on = switchOn(input);
  for (const file of input.files) {
    if (file.kind === 'tokens') continue;
    walk(file.sheet, (node, context) => {
      if (inScope(context.atRules)) return;
      if (node.type === 'at-rule' && on && node.name === 'media') {
        for (const fact of modeFacts(node)) add('modes-media', sourceWhere(file.path, fact.place), fact.detail);
      } else if (node.type === 'rule' && file.kind !== 'page') {
        for (const fact of dataModeFacts(node)) add('modes-media', sourceWhere(file.path, fact.place), fact.detail);
      } else if (node.type === 'declaration' && setsColorScheme(node) && !inFontFace(context.atRules)) {
        if (file.kind !== 'page') add('modes-media', sourceWhere(file.path, node.place), declarationText(node));
      }
    });
  }
  if (!on) return;
  for (const source of input.sources) {
    for (const element of source.markup?.querySelectorAll('*') ?? []) {
      const value = modeMedia(element);
      if (value === undefined) continue;
      add(
        'modes-media',
        sourceWhere(source.path, { line: lineAt(source.text, element.range[0]) }),
        mediaText(element, value),
      );
    }
  }
}

/**
 * `modes-media`, built half: the same by layer in built CSS, and the `media` attributes of built HTML. The `page`
 * layer stands for the page files, and the same three facts are left to other rules.
 */
export function auditModesMedia(input: BuiltCssInput, report: Report): void {
  const on = switchOn(input.source);
  // The scopes of the row: mode features and `color-scheme` outside `tokens`; `data-mode` also outside `reset`
  // and `layout`, which `css/base.css` writes (7.6). The `page` layer's selectors are `css-selector`'s.
  const otherSelectors: ReadonlySet<BuiltNode['kitLayer']> = new Set<BuiltNode['kitLayer']>([
    'tokens',
    'reset',
    'layout',
    'page',
  ]);
  reportPerPage(
    input,
    report,
    'modes-media',
    (sheet) =>
      sheet.nodes.flatMap((item): string[] => {
        const { node } = item;
        if (inScope(item.atRules)) return [];
        if (node.type === 'at-rule') {
          if (!on || node.name !== 'media' || item.kitLayer === 'tokens') return [];
          return modeFacts(node).map((fact) => fact.detail);
        }
        if (node.type === 'rule') {
          return otherSelectors.has(item.kitLayer) ? [] : dataModeFacts(node).map((fact) => fact.detail);
        }
        if (!setsColorScheme(node) || item.kitLayer === 'tokens' || item.kitLayer === 'page') return [];
        return [builtDetail(item, declarationText(node))];
      }),
    (page) =>
      on
        ? page.elements.flatMap((element) => {
            const value = modeMedia(element);
            return value === undefined ? [] : [mediaText(element, value)];
          })
        : [],
  );
}

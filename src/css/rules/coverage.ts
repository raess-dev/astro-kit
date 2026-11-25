/**
 * The coverage rules of the css group (specification, 7.1, 7.5, 7.8 and 8): `css-classes`, `css-unused` and
 * `css-element-coverage`. All three are build rules: they compare built pages with the project CSS.
 *
 * `../rules.ts` runs them in the order of section 8. This module uses the exports of `../rules.ts` only inside its
 * functions (see the head of that module).
 *
 * **Who reports what.** The three rules share one list of defined classes (`definedClasses`):
 *
 * - `css-classes` reports a class on a page that no file defines;
 * - `css-unused` reports a class that a file defines and no page uses;
 * - `css-element-coverage` reports a listed element, or a variant of `elements.css` on an element, with no rule in
 *   `elements.css`. A class that no file defines is `css-classes`'s: it is no variant, so it needs no rule here.
 */
import { readText } from '../../context.ts';
import type { Report } from '../../registry.ts';
import { asciiLower, classesOf, MAX_DEPTH, type Place, walk } from '../parse.ts';
import { BASE_CLASSES, type BuiltCssInput, type CssSourceFile, classNames, reportOnce, sourceWhere } from '../rules.ts';
import {
  type AttributeSelector,
  type ComplexSelector,
  type Compound,
  classRole,
  classNames as compoundClasses,
  ownerOf,
  type PseudoClass,
  parseSelector,
  subject,
} from '../selectors.ts';

// Defined classes (7.1, 7.5, 7.8)

/** One class that a project CSS file defines, at its first place in that file. */
interface DefinedClass {
  name: string;
  file: CssSourceFile;
  place: Place;
}

/** The class names of the `[class~=x]` and `[class=x]` selectors of a selector, at any depth (7.1). */
function attributeClasses(selector: ComplexSelector, out: { name: string; place: Place }[], depth = 0): void {
  if (depth >= MAX_DEPTH) return;
  for (const compound of selector.compounds) {
    const own = new Set(compound.classes);
    for (const item of compoundClasses(compound)) if (!own.has(item)) out.push(item);
    for (const pseudo of compound.pseudoClasses) {
      for (const inner of pseudo.selectors ?? []) attributeClasses(inner, out, depth + 1);
    }
  }
}

/** Every class of a sheet, once each at its first place: `.x`, and the names of `[class~=x]` and `[class=x]` (7.1). */
function sheetClasses(file: CssSourceFile): { name: string; place: Place }[] {
  const out = classesOf(file.sheet);
  const seen = new Set(out.map((item) => item.name));
  walk(file.sheet, (node) => {
    if (node.type !== 'rule' || node.kind !== 'style') return;
    for (const values of node.resolved) {
      const { selector } = parseSelector(values);
      if (selector === undefined) continue;
      const found: { name: string; place: Place }[] = [];
      attributeClasses(selector, found);
      for (const item of found) {
        if (seen.has(item.name)) continue;
        seen.add(item.name);
        out.push(item);
      }
    }
  });
  return out;
}

/**
 * The classes that the project CSS defines (css-classes, css-unused): every class of `elements.css` (its variants),
 * and in each component file `components/<c>.css` every class that is a root, a part or a modifier of `c`. A class
 * written as `[class~=x]` or `[class=x]` counts as `.x` (7.1). A class of a component file that is no class of `c` is
 * `css-selector`'s, so it is not defined. Page files define nothing: they name the roots of components. `base.css`
 * is not here: `BASE_CLASSES` holds its classes.
 */
function definedClasses(input: BuiltCssInput): DefinedClass[] {
  const out: DefinedClass[] = [];
  for (const file of input.source.files) {
    if (file.kind !== 'elements' && file.kind !== 'component') continue;
    const component = file.component ?? '';
    for (const { name, place } of sheetClasses(file)) {
      if (file.kind === 'component' && classRole(name, component) === undefined) continue;
      out.push({ name, file, place });
    }
  }
  return out;
}

// css-classes

/** `css-classes`: every class in built HTML is defined in `elements.css`, `base.css` or a component file. */
export function auditCssClasses(input: BuiltCssInput, report: Report): void {
  const add = reportOnce(report);
  const defined = new Set<string>(BASE_CLASSES);
  for (const { name } of definedClasses(input)) defined.add(name);
  for (const page of input.pages) {
    for (const name of page.classes) if (!defined.has(name)) add('css-classes', page.path, `.${name}`);
  }
}

// css-unused

/** The characters of a word for the whole-word search of `css-unused`: `[\w-]`. */
function isWordChar(char: string): boolean {
  return (
    (char >= 'a' && char <= 'z') ||
    (char >= 'A' && char <= 'Z') ||
    (char >= '0' && char <= '9') ||
    char === '_' ||
    char === '-'
  );
}

/**
 * Says whether a text holds the name as a whole word: `(?<![\w-])<name>(?![\w-])`. It searches with `indexOf` and
 * checks the two neighbours, so no regular expression is built from the name.
 */
function holdsWord(text: string, name: string): boolean {
  if (name === '') return false;
  for (let index = text.indexOf(name); index >= 0; index = text.indexOf(name, index + 1)) {
    const before = index === 0 ? '' : text.charAt(index - 1);
    const after = text.charAt(index + name.length);
    if (!isWordChar(before) && !isWordChar(after)) return true;
  }
  return false;
}

/** The built scripts that an island may add classes from: `_astro/*.js` of the client directory (7.8). */
function islandScripts(input: BuiltCssInput): () => string[] {
  let texts: string[] | undefined;
  return () => {
    if (texts === undefined) {
      texts = [];
      for (const file of input.ctx.files) {
        if (!file.startsWith('_astro/') || !file.endsWith('.js')) continue;
        const text = readText(input.ctx, file);
        if (text !== undefined) texts.push(text);
      }
    }
    return texts;
  };
}

/**
 * `css-unused`: every class defined in project CSS appears on a built page. A class of a component whose source is
 * `.tsx` also counts when a built `_astro/*.js` file holds it as a whole word (7.8). `base.css` is exempt. The
 * finding stands at the class's first place in its file, so a waiver of one file covers its classes (section 8).
 */
export function auditCssUnused(input: BuiltCssInput, report: Report): void {
  const add = reportOnce(report);
  const used = new Set<string>();
  for (const page of input.pages) for (const name of page.classes) used.add(name);
  const tsx = new Set<string>();
  for (const component of input.source.components) {
    if (component.extension === '.tsx' && component.kebab !== undefined) tsx.add(component.kebab);
  }
  const scripts = islandScripts(input);
  for (const { name, file, place } of definedClasses(input)) {
    if (used.has(name) || BASE_CLASSES.has(name)) continue;
    const owner = ownerOf(name, input.source.shape.components);
    if (owner !== undefined && tsx.has(owner) && scripts().some((text) => holdsWord(text, name))) continue;
    add('css-unused', sourceWhere(file.path, place), `.${name}`);
  }
}

// css-element-coverage

/** The elements that need a rule in `elements.css` when a built page holds them (section 8, `css-element-coverage`). */
export const COVERED_ELEMENTS: ReadonlySet<string> = new Set([
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'p',
  'a',
  'strong',
  'em',
  'small',
  'blockquote',
  'ul',
  'ol',
  'li',
  'dl',
  'dt',
  'dd',
  'table',
  'caption',
  'th',
  'td',
  'figure',
  'figcaption',
  'hr',
  'code',
  'pre',
  'button',
  'input',
  'select',
  'textarea',
  'label',
  'fieldset',
  'legend',
  'details',
  'summary',
  'dialog',
]);

/** The key of a bare `input` rule: it covers every input. */
const ANY_INPUT = 'input';

/** The pseudo-classes whose arguments select the element of the compound that holds them (7.1). */
const SAME_ELEMENT: ReadonlySet<string> = new Set(['is', 'where']);

/** What the rules of `elements.css` cover. */
interface Coverage {
  /** `table`, `input` (every input), `input[type=radio]`, `button.button`. */
  keys: Set<string>;
  /** The classes that `elements.css` writes in a compound with a type: the variants (7.1). */
  variants: Set<string>;
}

const namedType = (type: string | undefined): string | undefined =>
  type === undefined || type === '*' ? undefined : type;

/** Says whether an attribute selector names classes (`[class~=x]`, `[class=x]`): `compoundClasses` reads it. */
const isClassAttribute = (attribute: AttributeSelector): boolean =>
  attribute.name === 'class' &&
  attribute.value !== undefined &&
  (attribute.operator === '~=' || attribute.operator === '=');

/** The variants of one compound: each class next to a named type, `[class~=x]` too. */
function addVariants(compound: Compound, coverage: Coverage): void {
  if (namedType(compound.type) === undefined) return;
  for (const item of compoundClasses(compound)) coverage.variants.add(item.name);
}

/** What a compound adds to the compound around it, for `cover`. */
interface Outer {
  type: string | undefined;
  classes: string[];
  /** The attribute selectors that are no class names: only one `[type=x]` of an `input` keeps a key. */
  attributes: AttributeSelector[];
  /** True when the compound narrows its element by a pseudo-class or a pseudo-element: it covers no key. */
  narrowed: boolean;
  /** The `:is()` and `:where()` of the compounds around it that are still to match: the element matches each. */
  pending: readonly PseudoClass[];
}

/**
 * The keys that a subject compound covers (section 8, `css-element-coverage`). A rule covers an element when its
 * subject compound has the element's type and nothing that narrows it to some of these elements:
 *
 * - no pseudo-class and no pseudo-element, and no attribute selector, except one `[type=x]` on `input`, which covers
 *   that type. A bare `input` covers every input; `input:disabled` and `input:not([type=checkbox])` cover none.
 * - a class makes the rule a variant: `a.button` covers the key `a.button`, so an `<a class="button">`, never a
 *   plain `<a>`.
 * - an argument of `:is()` and `:where()` is the same element (7.1), so each argument covers its keys with the type,
 *   the classes and the attributes of the compound around it: `:is(h1, h2)` covers `h1` and `h2`, and
 *   `input:is([type=radio], [type=checkbox])` covers those two types only. With two of them on one compound the
 *   element matches each: an argument of the first is read with the others still pending, so
 *   `:is(h1, h2):is(h2, h3)` covers `h2`, and `input:is([type=radio], [type=checkbox]):where(:disabled)` covers none.
 *
 * A `*` covers nothing. The depth is that of the parsed selector, which the parser bounds.
 */
function cover(compound: Compound, outer: Outer, coverage: Coverage): void {
  const own = namedType(compound.type);
  if (own !== undefined && outer.type !== undefined && own !== outer.type) return;
  const type = own ?? outer.type;
  const classes = [...outer.classes, ...compoundClasses(compound).map((item) => item.name)];
  const attributes = [...outer.attributes, ...compound.attributes.filter((item) => !isClassAttribute(item))];
  const same = compound.pseudoClasses.filter((pseudo) => SAME_ELEMENT.has(pseudo.name));
  const narrowed = outer.narrowed || compound.pseudoElements.length > 0 || compound.pseudoClasses.length > same.length;
  // A class next to a type is a variant, also inside `:is()` (`a:is(.button, .link)`), whatever narrows it.
  if (type !== undefined) for (const name of classes) coverage.variants.add(name);
  const [first, ...pending] = [...outer.pending, ...same];
  if (first !== undefined) {
    // Each argument is the element: the keys come from the arguments, never from the compound alone. The element
    // matches every `:is()` and `:where()`, so the others stay pending for each argument of the first.
    for (const argument of first.selectors ?? []) {
      const last = subject(argument);
      if (last !== undefined) cover(last, { type, classes, attributes, narrowed, pending }, coverage);
    }
    return;
  }
  if (type === undefined || narrowed) return;
  const typed = attributes.filter((attribute) => attribute.name === 'type');
  if (attributes.length > typed.length) return;
  if (classes.length > 0) {
    if (typed.length === 0) for (const name of classes) coverage.keys.add(`${type}.${name}`);
    return;
  }
  if (type !== 'input') {
    if (typed.length === 0) coverage.keys.add(type);
    return;
  }
  const [only, ...rest] = typed;
  if (only === undefined) coverage.keys.add(ANY_INPUT);
  else if (rest.length === 0 && only.operator === '=' && only.value !== undefined) {
    coverage.keys.add(`input[type=${asciiLower(only.value)}]`);
  }
}

/** What one resolved selector of `elements.css` covers: its subject compound, and the variants of each compound. */
function coverSelector(selector: ComplexSelector, coverage: Coverage): void {
  for (const compound of selector.compounds) addVariants(compound, coverage);
  const last = subject(selector);
  if (last !== undefined)
    cover(last, { type: undefined, classes: [], attributes: [], narrowed: false, pending: [] }, coverage);
}

/** What every style rule of `elements.css` (the source) covers. */
function coverageOf(input: BuiltCssInput): Coverage {
  const coverage: Coverage = { keys: new Set(), variants: new Set() };
  for (const file of input.source.files) {
    if (file.kind !== 'elements') continue;
    walk(file.sheet, (node) => {
      if (node.type !== 'rule' || node.kind !== 'style') return;
      for (const values of node.resolved) {
        const { selector } = parseSelector(values);
        if (selector !== undefined) coverSelector(selector, coverage);
      }
    });
  }
  return coverage;
}

/**
 * `css-element-coverage`: each listed element on a built page has a rule in `elements.css` that covers it (`cover`:
 * `input` by its `type`, a bare `input` rule covers all, `input[type=hidden]` needs none), and each variant class of `elements.css` on any element has
 * a rule with its type and that class (`button.button` next to `a.button`, `span.button` on a `span`). An exempt or
 * unlisted element needs no rule of its own. One finding for each page and key.
 */
export function auditCssElementCoverage(input: BuiltCssInput, report: Report): void {
  const add = reportOnce(report);
  const coverage = coverageOf(input);
  for (const page of input.pages) {
    for (const element of page.elements) {
      const tag = asciiLower(element.rawTagName);
      const classes = classNames(element.getAttribute('class'));
      for (const name of classes) {
        const key = `${tag}.${name}`;
        if (coverage.variants.has(name) && !coverage.keys.has(key)) add('css-element-coverage', page.path, key);
      }
      if (!COVERED_ELEMENTS.has(tag)) continue;
      // A variant rule matches an element with its class: `h1.lead` covers `<h1 class="lead">`, not `<h1>`.
      if (classes.some((name) => coverage.keys.has(`${tag}.${name}`))) continue;
      if (tag === 'input') {
        const type = asciiLower(element.getAttribute('type') ?? '') || 'text';
        // A hidden input is never shown, so it needs no rule (the `return` input of 9.1).
        if (type === 'hidden') continue;
        const key = `input[type=${type}]`;
        if (!coverage.keys.has(ANY_INPUT) && !coverage.keys.has(key)) add('css-element-coverage', page.path, key);
      } else if (!coverage.keys.has(tag)) add('css-element-coverage', page.path, tag);
    }
  }
}

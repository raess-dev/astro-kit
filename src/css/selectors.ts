/**
 * The selector analyzer of the kit (specification, 3.2): a selector parser after Selectors Level 4, specificity,
 * compound counts and the layer shapes of 7.1, 7.8, 7.9 and 7.11. The `css-*` rules of M5 read selectors through
 * this module, in source CSS and in built CSS alike.
 *
 * The parser reads the component values of `parse.ts`: one resolved selector of a rule (`Rule.resolved`), or a
 * selector text after `parseValue`. It never throws. A selector that CSS refuses gives a parse problem with a place.
 * The parser is stricter than a browser where that costs a project nothing:
 *
 * - It knows a fixed list of pseudo-classes and pseudo-elements. Each of them is valid in Chromium. A name outside
 *   the list is a problem, as an unknown name is in a browser.
 * - The arguments of `:is()` and `:where()` must all be valid. A browser drops a bad argument and keeps the rest.
 * - A namespace prefix (`svg|a`, `*|a`, `|a`), the column combinator `||` and a pseudo-class or a second
 *   pseudo-element after a pseudo-element are problems.
 * - `:global()` is the one name that a browser refuses and this parser reads: `css-banned` reports it, so that no
 *   rule reports it twice. Its arguments stay as they are.
 * - It reads `:dir()` with `ltr` or `rtl` only, `:lang()` with one name only, no attribute modifier `s`, `of` in
 *   lower case only, and no pseudo-element in the `of` list of `:nth-child()`. Chromium keeps some of these
 *   (`:dir(foo)`, `:nth-child(2n of p::before)`), and CSS defines the others.
 *
 * So a refused selector has one of two kinds (`Refusal`). `invalid`: CSS refuses it too, and a browser drops the
 * whole rule. `unread`: the kit does not read it, but a browser may keep the rule. These are the points of the list
 * above (but `:global()`), and every problem inside the argument of `:is()` or `:where()`, which a browser forgives. The acceptance
 * test `css-oracle.test.ts` holds the parser to this: what it accepts, Chromium accepts, and what it calls
 * `invalid`, Chromium refuses. The shapes of 7.1 are no parse problem: `shapeProblems` reports them.
 *
 * The minifier writes some selectors in another form (13.1 item 40): `:before` for `::before`, `[a=b]` for
 * `[a="b"]`, `odd` for `2n+1`, `.a{&>.b{}}` for `.a{> .b{}}`, `.a.b` for `.a:is(.b)` and `:first-child` for
 * `:nth-child(1)`. The shape checks, the specificity and `normalizeSelector` give the same answer for both forms.
 *
 * The tables of this module are maps and sets. A name from the input never looks up a plain object, so
 * `constructor` and `__proto__` find nothing.
 */
import {
  type AtRule,
  asciiLower,
  type BlockValue,
  type ComponentValue,
  type FunctionValue,
  isDelim,
  isIdent,
  isWhitespace,
  MAX_DEPTH,
  type ParseProblem,
  type Place,
  serialize,
  splitCommas,
  trimWhitespace,
} from './parse.ts';

// The tree

/** A combinator between two compounds: descendant (`' '`), child, next sibling and subsequent sibling. */
export type Combinator = ' ' | '>' | '+' | '~';

/** A class or an id: the name with escapes resolved, in the case it was written. */
export interface NameSelector {
  name: string;
  /** The place of the `.` of a class, or of the `#` of an id. */
  place: Place;
}

/** An attribute selector: `[aria-current="page"]`, `[hidden]`, `[lang|=de i]`. */
export interface AttributeSelector {
  /** The attribute name in ASCII lower case. */
  name: string;
  operator: '=' | '~=' | '|=' | '^=' | '$=' | '*=' | undefined;
  /** The value with escapes resolved. A quoted and an unquoted value give the same text. */
  value: string | undefined;
  /** The case modifier. Chromium refuses `s`, so the parser never gives it (a problem instead). */
  modifier: 'i' | 's' | undefined;
  /** The place of the `[`. */
  place: Place;
}

/** A pseudo-class: `:hover`, `:is(h2, h3)`, `:nth-child(2n+1 of .a)`. */
export interface PseudoClass {
  /** The name in ASCII lower case, without the colon. */
  name: string;
  /** The arguments as written, white space included. `undefined` for a plain pseudo-class (`:hover`). */
  args: ComponentValue[] | undefined;
  /** The selector list of :is(), :where(), :not(), :has() (relative) and the `of S` part of :nth-child()/:nth-last-child(). */
  selectors: ComplexSelector[] | undefined;
  /** The An+B of the :nth-*() family; odd = 2n+1, even = 2n. */
  nth: { a: number; b: number } | undefined;
  /** The place of the colon. */
  place: Place;
}

/** A pseudo-element: `::before`, `::view-transition-group(*)`. */
export interface PseudoElement {
  /** The name in ASCII lower case, without the colons: `before`. */
  name: string;
  /** True for the one-colon form of the minifier: `:before`, `:after`, `:first-line`, `:first-letter`. */
  legacy: boolean;
  args: ComponentValue[] | undefined;
  /** The place of the first colon. */
  place: Place;
}

/** A compound selector: the simple selectors between two combinators. */
export interface Compound {
  /** True when the compound holds a bare `&`. A resolved selector holds one only in a top-level rule. */
  nesting: boolean;
  /** The type selector in ASCII lower case; `'*'` for the universal selector; `undefined` when none. */
  type: string | undefined;
  ids: NameSelector[];
  classes: NameSelector[];
  attributes: AttributeSelector[];
  pseudoClasses: PseudoClass[];
  pseudoElements: PseudoElement[];
  /** The place of the first simple selector. */
  place: Place;
}

/** A complex selector: compounds joined by combinators. */
export interface ComplexSelector {
  /** The combinator before the first compound of a relative selector (`:has(> img)`). */
  leading: Combinator | undefined;
  compounds: Compound[];
  /** `combinators[i]` joins `compounds[i]` and `compounds[i + 1]`. */
  combinators: Combinator[];
  /** The place of the first value: the leading combinator, or the first compound. */
  place: Place;
}

/**
 * Why the parser refuses a selector (see the head of this module):
 * - `invalid`: CSS refuses the selector too. A browser drops the whole rule.
 * - `unread`: the kit does not read the selector, but CSS may keep it: an unknown pseudo-class or pseudo-element
 *   name (a browser may know it), a namespace, `||`, a simple selector after a pseudo-element, the forms of
 *   `:dir()`, `:lang()`, `s` and `of` above, lists nested deeper than the kit reads, and every problem inside the
 *   argument of `:is()` or `:where()`. A browser drops such an argument and keeps the rule.
 */
export type Refusal = 'invalid' | 'unread';

/** The result of `parseSelector`: a selector, or the first problem and its kind. */
export type SelectorResult =
  | { selector: ComplexSelector; problem: undefined; refusal: undefined }
  | { selector: undefined; problem: ParseProblem; refusal: Refusal };

// The tables

/** The pseudo-classes without arguments that the parser knows. Each one is valid in Chromium. */
const PLAIN_PSEUDO_CLASSES: ReadonlySet<string> = new Set([
  'active',
  'active-view-transition',
  'any-link',
  'autofill',
  'checked',
  'default',
  'defined',
  'disabled',
  'empty',
  'enabled',
  'first-child',
  'first-of-type',
  'focus',
  'focus-visible',
  'focus-within',
  'fullscreen',
  'hover',
  'in-range',
  'indeterminate',
  'invalid',
  'last-child',
  'last-of-type',
  'link',
  'modal',
  'only-child',
  'only-of-type',
  'open',
  'optional',
  'out-of-range',
  'placeholder-shown',
  'popover-open',
  'read-only',
  'read-write',
  'required',
  'root',
  'scope',
  'target',
  'user-invalid',
  'user-valid',
  'valid',
  'visited',
]);

/** The pseudo-classes whose argument is a selector list. */
const LIST_PSEUDO_CLASSES: ReadonlySet<string> = new Set(['is', 'where', 'not', 'has']);

/** The :nth-*() pseudo-classes, each with whether it takes `of S`. */
const NTH_PSEUDO_CLASSES: ReadonlyMap<string, boolean> = new Map([
  ['nth-child', true],
  ['nth-last-child', true],
  ['nth-of-type', false],
  ['nth-last-of-type', false],
]);

/** Astro's `:global()`. CSS refuses it; `css-banned` reports it, so this module reads it and leaves it alone. */
const GLOBAL = 'global';

/** The pseudo-elements that CSS also writes with one colon. The minifier does (13.1 item 40). */
const LEGACY_PSEUDO_ELEMENTS: ReadonlySet<string> = new Set(['before', 'after', 'first-line', 'first-letter']);

/** The pseudo-elements without arguments that the parser knows. Each one is valid in Chromium. */
const PLAIN_PSEUDO_ELEMENTS: ReadonlySet<string> = new Set([
  ...LEGACY_PSEUDO_ELEMENTS,
  'backdrop',
  'checkmark',
  'details-content',
  'file-selector-button',
  'grammar-error',
  'marker',
  'picker-icon',
  'placeholder',
  'selection',
  'spelling-error',
  'target-text',
  'view-transition',
]);

/** What the argument of a functional pseudo-element is. */
type ElementArgument = 'name-or-star' | 'name' | 'select';

/** The pseudo-elements with an argument that the parser knows. */
const FUNCTIONAL_PSEUDO_ELEMENTS: ReadonlyMap<string, ElementArgument> = new Map<string, ElementArgument>([
  ['view-transition-group', 'name-or-star'],
  ['view-transition-image-pair', 'name-or-star'],
  ['view-transition-old', 'name-or-star'],
  ['view-transition-new', 'name-or-star'],
  ['highlight', 'name'],
  ['picker', 'select'],
]);

/** The combinators that a delimiter writes. White space is the fourth. */
const COMBINATOR_DELIMS: ReadonlySet<string> = new Set(['>', '+', '~']);

/** The attribute operators that start with a delimiter before `=`. */
const ATTRIBUTE_OPERATORS: ReadonlyMap<string, AttributeSelector['operator']> = new Map<
  string,
  AttributeSelector['operator']
>([
  ['~', '~='],
  ['|', '|='],
  ['^', '^='],
  ['$', '$='],
  ['*', '*='],
]);

/**
 * The deepest nesting of selector lists inside selector lists. A tree of `parse.ts` is at most `MAX_DEPTH` brackets
 * deep, and nesting adds one `:is()` for each level of rules (7.1). So no real selector comes near this.
 */
const MAX_SELECTOR_DEPTH = MAX_DEPTH * 3;

const ORIGIN: Place = { offset: 0, line: 1, column: 1 };

// The parser

/** What the parser knows where it stands. */
interface Context {
  /** The first problem. Parsing stops at it. */
  problem: ParseProblem | undefined;
  /** The depth of selector lists inside pseudo-classes. */
  depth: number;
  /** True inside the argument of :has(): CSS refuses a :has() there. */
  inHas: boolean;
  /** True inside the argument of a pseudo-class: CSS refuses a pseudo-element there. */
  inArgument: boolean;
  /** True inside the argument of `:is()` or `:where()`, at any depth: a browser forgives a problem there. */
  forgiving: boolean;
  /** True directly in the `of` list of `:nth-child()` and `:nth-last-child()`. */
  ofList: boolean;
  /** The kind of the first problem. */
  refusal: Refusal | undefined;
}

/** A context at the top of a selector. */
const topContext = (): Context => ({
  problem: undefined,
  depth: 0,
  inHas: false,
  inArgument: false,
  forgiving: false,
  ofList: false,
  refusal: undefined,
});

/**
 * Records the first problem and gives `undefined`, so that a parse step can `return fail(…)`. The problem is
 * `invalid`, or `unread` inside a forgiving argument.
 */
function fail(context: Context, place: Place, message: string): undefined {
  return refuse(context, place, message, 'invalid');
}

/** Records the first problem as `unread`: CSS may keep the selector, but the kit does not read it. */
function unread(context: Context, place: Place, message: string): undefined {
  return refuse(context, place, message, 'unread');
}

function refuse(context: Context, place: Place, message: string, refusal: Refusal): undefined {
  if (context.problem === undefined) {
    context.problem = { message, place };
    context.refusal = context.forgiving ? 'unread' : refusal;
  }
  return undefined;
}

/** The place of a value. */
const placeOf = (value: ComponentValue | undefined, fallback: Place): Place => value?.place ?? fallback;

/** A short text of a value for a message. */
function textOf(value: ComponentValue): string {
  const text = serialize([value]);
  return text.length > 40 ? `${text.slice(0, 40)}…` : text;
}

/** The index of the next value after `from` that is no white space. */
function skipSpace(values: readonly ComponentValue[], from: number): number {
  let index = from;
  while (index < values.length && isWhitespace(values[index])) index += 1;
  return index;
}

/** The combinator that a value writes, if it is one of `>`, `+` and `~`. */
function combinatorOf(value: ComponentValue | undefined): Combinator | undefined {
  if (value?.type !== 'delim' || !COMBINATOR_DELIMS.has(value.value)) return undefined;
  return value.value === '>' ? '>' : value.value === '+' ? '+' : '~';
}

/** A run of ASCII digits, as the tail of `n-<digits>`. */
function isDigits(text: string): boolean {
  if (text === '') return false;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code < 0x30 || code > 0x39) return false;
  }
  return true;
}

/** Says whether the value is an integer without a sign: the B of `n- 1`. */
const isSignlessInteger = (value: ComponentValue | undefined): boolean =>
  value?.type === 'number' && value.integer && value.sign === '';

/**
 * The B of An+B after its `n`, from `values[from]` to the end (CSS Syntax Level 3, section 6.2): nothing, a signed
 * integer, or `+` or `-` then a signless integer, with white space between.
 */
function bAfterN(values: readonly ComponentValue[], from: number): number | undefined {
  let index = skipSpace(values, from);
  const first = values[index];
  if (first === undefined) return 0;
  let b: number;
  if (first.type === 'number' && first.integer && first.sign !== '') b = first.value;
  else if (isDelim(first, '+') || isDelim(first, '-')) {
    index = skipSpace(values, index + 1);
    const number = values[index];
    if (number?.type !== 'number' || !isSignlessInteger(number)) return undefined;
    b = first.value === '-' ? -number.value : number.value;
  } else return undefined;
  return skipSpace(values, index + 1) === values.length ? b : undefined;
}

/** The B of `n- <digits>`: white space, then a signless integer, then the end. */
function bAfterDash(values: readonly ComponentValue[], from: number): number | undefined {
  const index = skipSpace(values, from);
  const number = values[index];
  if (number?.type !== 'number' || !isSignlessInteger(number)) return undefined;
  return skipSpace(values, index + 1) === values.length ? -number.value : undefined;
}

/** The B of a name that starts with `n`: `n`, `n-`, `n-<digits>`. `undefined` for any other name. */
function bOfName(name: string, values: readonly ComponentValue[], from: number): number | undefined {
  if (name === 'n') return bAfterN(values, from);
  if (name === 'n-') return bAfterDash(values, from);
  if (name.startsWith('n-') && isDigits(name.slice(2))) {
    return skipSpace(values, from) === values.length ? -Number(name.slice(2)) : undefined;
  }
  return undefined;
}

/** Normalizes a zero, so that `-0` never shows in a text. */
const plain = (value: number): number => (value === 0 ? 0 : value);

/**
 * Parses An+B as CSS Syntax Level 3 does (section 6.2), from the tokens that `parse.ts` gives: `2n+1` is a dimension
 * and a signed number, `2n-1` one dimension with the unit `n-1`, `-n+3` an ident and a number, `+n` a delimiter and
 * an ident without white space between. `odd` is 2n+1 and `even` 2n. `undefined` when the values are no An+B.
 */
export function parseAnPlusB(input: readonly ComponentValue[]): { a: number; b: number } | undefined {
  const values = trimWhitespace(input);
  const first = values[0];
  if (first === undefined) return undefined;
  const result = (a: number, b: number | undefined) =>
    b === undefined || !Number.isFinite(a) || !Number.isFinite(b) ? undefined : { a: plain(a), b: plain(b) };
  if (first.type === 'ident') {
    const name = asciiLower(first.value);
    if (values.length === 1 && name === 'odd') return { a: 2, b: 1 };
    if (values.length === 1 && name === 'even') return { a: 2, b: 0 };
    if (name.startsWith('-')) return result(-1, bOfName(name.slice(1), values, 1));
    return result(1, bOfName(name, values, 1));
  }
  if (isDelim(first, '+')) {
    const next = values[1];
    if (next?.type !== 'ident') return undefined;
    const name = asciiLower(next.value);
    return name.startsWith('-') ? undefined : result(1, bOfName(name, values, 2));
  }
  if (first.type === 'number') return values.length === 1 && first.integer ? result(0, first.value) : undefined;
  if (first.type === 'dimension' && first.integer) return result(first.value, bOfName(first.unit, values, 1));
  return undefined;
}

/** Parses the inside of `[…]`. */
function parseAttribute(block: BlockValue, context: Context): AttributeSelector | undefined {
  const values = trimWhitespace(block.values);
  const place = block.place;
  const first = values[0];
  if (first === undefined) return fail(context, place, 'an attribute selector `[]` without a name');
  const namespaced =
    isDelim(first, '|') || isDelim(first, '*') || (isDelim(values[1], '|') && !isDelim(values[2], '='));
  if (namespaced) {
    return unread(context, place, `the namespace in \`${serialize([block])}\`; the kit reads no namespace`);
  }
  if (first.type !== 'ident') return fail(context, place, `\`${serialize([block])}\` has no attribute name`);
  const attribute: AttributeSelector = {
    name: asciiLower(first.value),
    operator: undefined,
    value: undefined,
    modifier: undefined,
    place,
  };
  let index = skipSpace(values, 1);
  if (index === values.length) return attribute;
  const sign = values[index];
  const char = sign?.type === 'delim' ? sign.value : '';
  if (char === '=') {
    attribute.operator = '=';
    index += 1;
  } else if (ATTRIBUTE_OPERATORS.has(char) && isDelim(values[index + 1], '=')) {
    attribute.operator = ATTRIBUTE_OPERATORS.get(char);
    index += 2;
  } else return fail(context, place, `\`${serialize([block])}\` has no valid operator`);
  index = skipSpace(values, index);
  const value = values[index];
  if (value?.type !== 'ident' && value?.type !== 'string') {
    return fail(context, place, `\`${serialize([block])}\` needs a name or a string as its value`);
  }
  attribute.value = value.value;
  index = skipSpace(values, index + 1);
  const modifier = values[index];
  if (modifier !== undefined) {
    if (isIdent(modifier, 's')) {
      // Selectors Level 4 has the modifier `s`; Chromium 153 refuses it.
      return unread(context, place, `\`${serialize([block])}\` has the modifier \`s\`, which Chromium refuses,`);
    }
    if (!isIdent(modifier, 'i')) return fail(context, place, `\`${serialize([block])}\` has a text after the value`);
    attribute.modifier = 'i';
    index = skipSpace(values, index + 1);
  }
  if (index !== values.length) return fail(context, place, `\`${serialize([block])}\` has a text after its end`);
  return attribute;
}

/** Parses a selector list inside a pseudo-class: each part a valid selector, none empty. */
/** Where an argument list stands: what `parseArgumentList` needs to know about it. */
interface ArgumentKind {
  /** The argument of `:has()`: relative selectors. */
  relative: boolean;
  inHas: boolean;
  /** The argument of `:is()` or `:where()`. */
  forgiving: boolean;
  /** The `of` list of `:nth-child()` or `:nth-last-child()`. */
  ofList: boolean;
}

function parseArgumentList(
  values: readonly ComponentValue[],
  context: Context,
  place: Place,
  kind: ArgumentKind,
): ComplexSelector[] | undefined {
  const { relative, inHas, forgiving } = kind;
  if (context.depth >= MAX_SELECTOR_DEPTH) return unread(context, place, 'selector lists nested too deep');
  const inner: Context = {
    problem: undefined,
    depth: context.depth + 1,
    inHas,
    inArgument: true,
    forgiving: context.forgiving || forgiving,
    ofList: kind.ofList,
    refusal: undefined,
  };
  const out: ComplexSelector[] = [];
  for (const part of splitCommas(values)) {
    const selector = parseComplex(part, relative, inner, place);
    if (selector === undefined) {
      if (context.problem === undefined && inner.problem !== undefined) {
        context.problem = inner.problem;
        context.refusal = inner.refusal;
      }
      return undefined;
    }
    out.push(selector);
  }
  return out;
}

/** Parses a functional pseudo-class after its colon. */
function parseFunctionalPseudoClass(fn: FunctionValue, place: Place, context: Context): PseudoClass | undefined {
  const name = fn.name;
  const pseudo: PseudoClass = { name, args: fn.args, selectors: undefined, nth: undefined, place };
  const args = trimWhitespace(fn.args);
  if (name === GLOBAL) return pseudo;
  if (LIST_PSEUDO_CLASSES.has(name)) {
    if (name === 'has' && context.inHas) return fail(context, place, '`:has()` inside `:has()`, which CSS refuses');
    const forgiving = name === 'is' || name === 'where';
    if (args.length === 0) {
      const message = `\`:${name}()\` without a selector`;
      return forgiving ? unread(context, place, message) : fail(context, place, message);
    }
    const selectors = parseArgumentList(args, context, fn.place, {
      relative: name === 'has',
      inHas: context.inHas || name === 'has',
      forgiving,
      ofList: false,
    });
    if (selectors === undefined) return undefined;
    pseudo.selectors = selectors;
    return pseudo;
  }
  const takesOf = NTH_PSEUDO_CLASSES.get(name);
  if (takesOf !== undefined) {
    const of = args.findIndex((value) => isIdent(value, 'of'));
    const keyword = args[of];
    if (keyword?.type === 'ident' && keyword.value !== 'of') {
      // CSS reads `of` in any case, but Chromium 153 reads only `of`.
      return unread(context, keyword.place, `\`${keyword.text}\` in \`:${name}()\`: Chromium reads only \`of\``);
    }
    const nth = parseAnPlusB(of < 0 ? args : args.slice(0, of));
    if (nth === undefined) return fail(context, place, `\`:${name}(${serialize(args)})\` holds no valid An+B`);
    pseudo.nth = nth;
    if (of < 0) return pseudo;
    if (!takesOf) return fail(context, place, `\`:${name}()\` takes no \`of\` selector list`);
    const rest = trimWhitespace(args.slice(of + 1));
    if (rest.length === 0) return fail(context, place, `\`:${name}()\` has \`of\` without a selector`);
    const selectors = parseArgumentList(rest, context, fn.place, {
      relative: false,
      inHas: context.inHas,
      forgiving: false,
      ofList: true,
    });
    if (selectors === undefined) return undefined;
    pseudo.selectors = selectors;
    return pseudo;
  }
  if (name === 'lang') {
    // Selectors Level 4 also takes strings and a list; Chromium 153 does not. The kit reads one name.
    if (args.length !== 1 || args[0]?.type !== 'ident')
      return unread(context, place, '`:lang()` takes one language tag');
    return pseudo;
  }
  if (name === 'dir') {
    const only = args.length === 1 ? args[0] : undefined;
    if (isIdent(only, 'ltr') || isIdent(only, 'rtl')) return pseudo;
    // A browser keeps `:dir()` with any other name; it matches nothing.
    const message = '`:dir()` takes `ltr` or `rtl`';
    return isIdent(only) ? unread(context, place, message) : fail(context, place, message);
  }
  return unread(context, place, `the unknown pseudo-class \`:${fn.text}()\``);
}

/**
 * Says whether the values are the argument of `::view-transition-group()` and its kin (CSS View Transitions Level
 * 2): a name or `*`, then classes `.a.b`, or classes alone, with no white space between.
 */
function isTransitionName(values: readonly ComponentValue[]): boolean {
  const first = values[0];
  let index = first?.type === 'ident' || isDelim(first, '*') ? 1 : 0;
  while (index < values.length) {
    if (!isDelim(values[index], '.') || values[index + 1]?.type !== 'ident') return false;
    index += 2;
  }
  return values.length > 0;
}

/** Parses a pseudo-element after its colons. */
function parsePseudoElement(
  value: ComponentValue | undefined,
  place: Place,
  legacy: boolean,
  context: Context,
): PseudoElement | undefined {
  if (context.inArgument) {
    // Chromium keeps a pseudo-element in the `of` list of `:nth-child()`, although CSS refuses it.
    const message = 'a pseudo-element inside a pseudo-class, which CSS refuses';
    return context.ofList ? unread(context, place, message) : fail(context, place, message);
  }
  if (value?.type === 'ident') {
    const name = asciiLower(value.value);
    if (!PLAIN_PSEUDO_ELEMENTS.has(name)) {
      return unread(context, place, `the unknown pseudo-element \`::${value.text}\``);
    }
    return { name, legacy, args: undefined, place };
  }
  if (value?.type === 'function') {
    const kind = FUNCTIONAL_PSEUDO_ELEMENTS.get(value.name);
    if (kind === undefined) return unread(context, place, `the unknown pseudo-element \`::${value.text}()\``);
    const args = trimWhitespace(value.args);
    const only = args.length === 1 ? args[0] : undefined;
    const valid =
      kind === 'select'
        ? isIdent(only, 'select')
        : kind === 'name-or-star'
          ? isTransitionName(args)
          : only?.type === 'ident';
    const message = `\`::${value.text}(${serialize(args)})\` has an argument that CSS refuses`;
    if (!valid) {
      // Chromium also reads white space between the name and a class (`x .a`), which CSS does not have.
      const spaced = kind === 'name-or-star' && isTransitionName(args.filter((item) => !isWhitespace(item)));
      return spaced ? unread(context, place, message) : fail(context, place, message);
    }
    return { name: value.name, legacy, args: value.args, place };
  }
  return fail(context, place, 'a `::` without a pseudo-element name');
}

/** Says whether a compound holds no simple selector yet. */
const isEmptyCompound = (compound: Compound): boolean =>
  !compound.nesting &&
  compound.type === undefined &&
  compound.ids.length === 0 &&
  compound.classes.length === 0 &&
  compound.attributes.length === 0 &&
  compound.pseudoClasses.length === 0 &&
  compound.pseudoElements.length === 0;

/**
 * Parses one compound from `values[start]`. It stops at white space, at a combinator and at the end, and gives the
 * index where it stopped.
 */
function parseCompound(
  values: readonly ComponentValue[],
  start: number,
  context: Context,
): { compound: Compound; next: number } | undefined {
  const first = values[start];
  const compound: Compound = {
    nesting: false,
    type: undefined,
    ids: [],
    classes: [],
    attributes: [],
    pseudoClasses: [],
    pseudoElements: [],
    place: placeOf(first, ORIGIN),
  };
  let index = start;
  if (first?.type === 'ident' || isDelim(first, '*')) {
    if (isDelim(values[index + 1], '|')) {
      return unread(context, first.place, 'a namespace prefix or the column combinator `||`; the kit reads neither');
    }
    compound.type = first.type === 'ident' ? asciiLower(first.value) : '*';
    index += 1;
  }
  while (index < values.length) {
    const value = values[index];
    if (value === undefined || isWhitespace(value) || combinatorOf(value) !== undefined) break;
    const place = value.place;
    if (compound.pseudoElements.length > 0) {
      return unread(context, place, `\`${textOf(value)}\` after a pseudo-element, which the kit refuses`);
    }
    if (isDelim(value, '.')) {
      const name = values[index + 1];
      if (name?.type !== 'ident') return fail(context, place, 'a `.` without a class name right after it');
      compound.classes.push({ name: name.value, place });
      index += 2;
    } else if (value.type === 'hash') {
      if (!value.id) return fail(context, place, `\`${value.text}\` is no id selector: an id starts like a name`);
      compound.ids.push({ name: value.value, place });
      index += 1;
    } else if (value.type === 'block' && value.open === '[') {
      const attribute = parseAttribute(value, context);
      if (attribute === undefined) return undefined;
      compound.attributes.push(attribute);
      index += 1;
    } else if (value.type === 'colon') {
      const next = values[index + 1];
      if (next?.type === 'colon') {
        const element = parsePseudoElement(values[index + 2], place, false, context);
        if (element === undefined) return undefined;
        compound.pseudoElements.push(element);
        index += 3;
      } else if (next?.type === 'ident') {
        const name = asciiLower(next.value);
        if (LEGACY_PSEUDO_ELEMENTS.has(name)) {
          const element = parsePseudoElement(next, place, true, context);
          if (element === undefined) return undefined;
          compound.pseudoElements.push(element);
        } else if (PLAIN_PSEUDO_CLASSES.has(name)) {
          compound.pseudoClasses.push({ name, args: undefined, selectors: undefined, nth: undefined, place });
        } else return unread(context, place, `the unknown pseudo-class \`:${next.text}\``);
        index += 2;
      } else if (next?.type === 'function') {
        const pseudo = parseFunctionalPseudoClass(next, place, context);
        if (pseudo === undefined) return undefined;
        compound.pseudoClasses.push(pseudo);
        index += 2;
      } else return fail(context, place, 'a `:` without a pseudo-class name right after it');
    } else if (isDelim(value, '&')) {
      compound.nesting = true;
      index += 1;
    } else if (isDelim(value, '|')) {
      return unread(context, place, 'a namespace prefix or the column combinator `||`; the kit reads neither');
    } else if (value.type === 'ident' || isDelim(value, '*')) {
      return fail(context, place, `the type selector \`${textOf(value)}\` after another simple selector`);
    } else if (value.type === 'comma') {
      return unread(context, place, 'a comma inside one selector: a list needs `parseSelectorList`');
    } else return fail(context, place, `\`${textOf(value)}\` in a selector`);
  }
  if (isEmptyCompound(compound)) {
    const value = values[index];
    const what = value === undefined ? 'nothing' : `\`${textOf(value)}\``;
    return fail(context, placeOf(value, compound.place), `${what} where a selector should stand`);
  }
  return { compound, next: index };
}

/** Parses one complex selector. `relative` allows a leading combinator (the argument of `:has()`). */
function parseComplex(
  input: readonly ComponentValue[],
  relative: boolean,
  context: Context,
  fallback: Place,
): ComplexSelector | undefined {
  const values = trimWhitespace(input);
  const first = values[0];
  if (first === undefined) return fail(context, fallback, 'an empty selector');
  let index = 0;
  const leading = combinatorOf(first);
  if (leading !== undefined) {
    if (!relative) return fail(context, first.place, `the combinator \`${leading}\` at the start of a selector`);
    index = skipSpace(values, 1);
    if (index >= values.length) {
      return fail(context, first.place, `the combinator \`${leading}\` without a selector after it`);
    }
  }
  const compounds: Compound[] = [];
  const combinators: Combinator[] = [];
  for (;;) {
    const parsed = parseCompound(values, index, context);
    if (parsed === undefined) return undefined;
    compounds.push(parsed.compound);
    index = parsed.next;
    if (index >= values.length) break;
    let combinator: Combinator = ' ';
    index = skipSpace(values, index);
    const explicit = combinatorOf(values[index]);
    const at = values[index];
    if (explicit !== undefined) {
      combinator = explicit;
      index = skipSpace(values, index + 1);
      if (index >= values.length) {
        return fail(context, placeOf(at, fallback), `the combinator \`${explicit}\` without a selector after it`);
      }
    }
    if (parsed.compound.pseudoElements.length > 0) {
      return fail(context, placeOf(values[index], fallback), 'a selector after a pseudo-element, which CSS refuses');
    }
    combinators.push(combinator);
  }
  return { leading, compounds, combinators, place: first.place };
}

/**
 * Parses one complex selector, e.g. one of `Rule.resolved` (Selectors Level 4). `relative` allows a leading
 * combinator (`> img`), as in the argument of `:has()`. It gives the first problem when CSS refuses the selector
 * (see the head of this module for where the kit is stricter).
 */
export function parseSelector(values: readonly ComponentValue[], options?: { relative: boolean }): SelectorResult {
  const context = topContext();
  const trimmed = trimWhitespace(values);
  const comma = trimmed.find((value) => value.type === 'comma');
  const selector =
    comma === undefined
      ? parseComplex(trimmed, options?.relative ?? false, context, placeOf(trimmed[0], ORIGIN))
      : unread(context, comma.place, 'a comma inside one selector: a list needs `parseSelectorList`');
  if (selector !== undefined) return { selector, problem: undefined, refusal: undefined };
  return {
    selector: undefined,
    problem: context.problem ?? { message: 'a selector that the kit cannot read', place: ORIGIN },
    refusal: context.refusal ?? 'unread',
  };
}

/**
 * Parses a selector list: the values split at their top-level commas. Each part gives a selector or a problem.
 * `refusal` is `invalid` when CSS refuses one part (a browser then drops the whole rule), else `unread` when the kit
 * does not read a part, else `undefined`.
 */
export function parseSelectorList(
  values: readonly ComponentValue[],
  options?: { relative: boolean },
): { selectors: ComplexSelector[]; problems: ParseProblem[]; refusal: Refusal | undefined } {
  const selectors: ComplexSelector[] = [];
  const problems: ParseProblem[] = [];
  let refusal: Refusal | undefined;
  const fallback = placeOf(values[0], ORIGIN);
  for (const part of splitCommas(values)) {
    const context = topContext();
    const selector = parseComplex(part, options?.relative ?? false, context, placeOf(part[0], fallback));
    if (selector !== undefined) selectors.push(selector);
    else {
      problems.push(context.problem ?? { message: 'a selector that the kit cannot read', place: fallback });
      if (refusal !== 'invalid') refusal = context.refusal ?? 'unread';
    }
  }
  return { selectors, problems, refusal };
}

// Specificity (7.11)

/** A specificity: ids; classes, attributes and pseudo-classes; types and pseudo-elements. */
export type Specificity = readonly [ids: number, classes: number, types: number];

/** The limits of 7.11: at most 3 classes, attributes or pseudo-classes, and at most 4 compounds. */
export const SELECTOR_LIMITS: { readonly classes: 3; readonly compounds: 4 } = { classes: 3, compounds: 4 };

const ZERO: Specificity = [0, 0, 0];

const sum = (a: Specificity, b: Specificity): Specificity => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

const greater = (a: Specificity, b: Specificity): boolean =>
  a[0] !== b[0] ? a[0] > b[0] : a[1] !== b[1] ? a[1] > b[1] : a[2] > b[2];

/** The most specific of a list, (0,0,0) for none. */
function most(list: readonly ComplexSelector[], root: string | undefined): Specificity {
  let best = ZERO;
  for (const selector of list) {
    const value = complexSpecificity(selector, root);
    if (greater(value, best)) best = value;
  }
  return best;
}

/** The specificity of one pseudo-class. `root` passes the root exemption into the arguments of `:is()`. */
function pseudoClassSpecificity(pseudo: PseudoClass, root: string | undefined): Specificity {
  const selectors = pseudo.selectors ?? [];
  switch (pseudo.name) {
    case GLOBAL:
    case 'where':
      return ZERO;
    case 'is':
      return most(selectors, root);
    case 'not':
    case 'has':
      return most(selectors, undefined);
    default:
      return sum([0, 1, 0], most(selectors, undefined));
  }
}

/**
 * The specificity of a compound. With `root`, one class `.<root>` is not counted; when the compound holds none, the
 * exemption goes into its `:is()` arguments (a parent list that nesting wrote as `:is()`, 7.1).
 */
function compoundSpecificity(compound: Compound, root: string | undefined): Specificity {
  const direct = root !== undefined && compound.classes.some((item) => item.name === root);
  let value: Specificity = [
    compound.ids.length,
    compound.classes.length - (direct ? 1 : 0) + compound.attributes.length,
    (compound.type !== undefined && compound.type !== '*' ? 1 : 0) + compound.pseudoElements.length,
  ];
  for (const pseudo of compound.pseudoClasses) {
    value = sum(value, pseudoClassSpecificity(pseudo, direct ? undefined : root));
  }
  return value;
}

function complexSpecificity(selector: ComplexSelector, root: string | undefined): Specificity {
  let value = ZERO;
  selector.compounds.forEach((compound, index) => {
    value = sum(value, compoundSpecificity(compound, index === 0 ? root : undefined));
  });
  return value;
}

/**
 * The specificity of 7.11 (Selectors Level 4): ids; classes, attributes and pseudo-classes; types and
 * pseudo-elements (a legacy `:before` too). :is(), :not() and :has() count as their most specific argument, :where()
 * as nothing, :nth-child(An+B of S) as one pseudo-class plus S. A bare `&` counts as nothing: CSS Nesting gives `&`
 * the specificity of the parent list, and a rule that is not nested has none (Chromium agrees, `css-oracle.test.ts`).
 * `:global()` counts as nothing (css-banned reports it). With `root` (the kebab name of a component file), the
 * class `.<root>` in the FIRST compound is not counted.
 */
export function specificity(selector: ComplexSelector, root?: string): Specificity {
  return complexSpecificity(selector, root);
}

/** The deepest list of `:is()` and `:where()` arguments that `compoundCount` reads. Deeper lists count as one. */
const MAX_COUNT_DEPTH = 32;

/**
 * The compounds of one compound of a chain: 1, or the largest count among the arguments of its `:is()` and
 * `:where()`, which describe the same element and what stands before it. `.d :is(.a .b .c)` (nesting writes a
 * parent in this way) is 4 compounds, as `.d .a .b .c` is.
 */
function chainLength(compound: Compound, depth: number): number {
  let longest = 1;
  if (depth >= MAX_COUNT_DEPTH) return longest;
  for (const pseudo of compound.pseudoClasses) {
    if (pseudo.name !== 'is' && pseudo.name !== 'where') continue;
    for (const inner of pseudo.selectors ?? []) longest = Math.max(longest, countOf(inner, depth + 1));
  }
  return longest;
}

function countOf(selector: ComplexSelector, depth: number): number {
  let count = 0;
  for (const compound of selector.compounds) count += chainLength(compound, depth);
  return count;
}

/**
 * The number of compounds (7.11): combinators + 1, where a compound with `:is()` or `:where()` counts as its longest
 * argument (`p :is(ul li a span)` is 5). The arguments of `:not()`, `:has()` and the `:nth-*()` family do not
 * count.
 */
export function compoundCount(selector: ComplexSelector): number {
  return countOf(selector, 0);
}

// The minifier's forms (13.1 item 40)

/** The one compound of a `:is()` with one argument of one compound (`:is(.b)`), else undefined. */
function singleCompound(pseudo: PseudoClass): Compound | undefined {
  const only = pseudo.name === 'is' && pseudo.selectors?.length === 1 ? pseudo.selectors[0] : undefined;
  return only?.leading === undefined && only?.compounds.length === 1 ? only.compounds[0] : undefined;
}

/**
 * The compound with each `:is()` of one compound put into it: the minifier writes `.a:is(.b)` as `.a.b`. Both mean
 * the same and have the same specificity, so the shape checks and `normalizeSelector` read this form, and the source
 * and the built CSS give the same answers. A `:is()` with a second type selector (`a:is(b)`) stays.
 */
function flatten(compound: Compound): Compound {
  if (!compound.pseudoClasses.some((pseudo) => singleCompound(pseudo) !== undefined)) return compound;
  const out: Compound = {
    ...compound,
    ids: [...compound.ids],
    classes: [...compound.classes],
    attributes: [...compound.attributes],
    pseudoClasses: [],
    pseudoElements: [...compound.pseudoElements],
  };
  for (const pseudo of compound.pseudoClasses) {
    const single = singleCompound(pseudo);
    const inner = single === undefined ? undefined : flatten(single);
    const named = (type: string | undefined): boolean => type !== undefined && type !== '*';
    if (inner === undefined || (named(inner.type) && named(out.type))) {
      out.pseudoClasses.push(pseudo);
      continue;
    }
    if (out.type === undefined || (out.type === '*' && named(inner.type))) out.type = inner.type;
    out.nesting ||= inner.nesting;
    out.ids.push(...inner.ids);
    out.classes.push(...inner.classes);
    out.attributes.push(...inner.attributes);
    out.pseudoClasses.push(...inner.pseudoClasses);
  }
  return out;
}

// Components (7.8)

/** The kind of a project CSS file (7.1). For built CSS, M5 derives it from the layer. */
export type CssFile = { kind: 'elements' } | { kind: 'component'; component: string } | { kind: 'page' };

export interface ShapeOptions {
  /** The kebab names of every component of the project (7.8): what a component class is, and the roots of 7.9. */
  components: ReadonlySet<string>;
}

/** Says whether a text is `[a-z0-9]+(-[a-z0-9]+)*`: a part or modifier name of 7.8. */
function isKebabTail(text: string): boolean {
  if (text === '' || text.startsWith('-') || text.endsWith('-') || text.includes('--')) return false;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    const ok = (code >= 0x61 && code <= 0x7a) || (code >= 0x30 && code <= 0x39) || code === 0x2d;
    if (!ok) return false;
  }
  return true;
}

/**
 * What a class is to a component (7.8): `.<kebab>` the root, `.<kebab>__<part>` a part, `.<kebab>--<mod>` a
 * modifier, with part and mod `[a-z0-9]+(-[a-z0-9]+)*`. `undefined` for any other class.
 */
export function classRole(name: string, component: string): 'root' | 'part' | 'modifier' | undefined {
  if (component === '') return undefined;
  if (name === component) return 'root';
  if (!name.startsWith(component)) return undefined;
  const rest = name.slice(component.length);
  if (rest.startsWith('__') && isKebabTail(rest.slice(2))) return 'part';
  if (rest.startsWith('--') && isKebabTail(rest.slice(2))) return 'modifier';
  return undefined;
}

/** The component that owns a class: the longest component name for which `classRole` is defined (7.8). */
export function ownerOf(name: string, components: ReadonlySet<string>): string | undefined {
  let owner: string | undefined;
  for (const component of components) {
    if (classRole(name, component) !== undefined && (owner === undefined || component.length > owner.length)) {
      owner = component;
    }
  }
  return owner;
}

/**
 * The component whose keyframes a name is: the longest component name `c` for which the name is `<c>-<name>`, with
 * name `[a-z0-9]+(-[a-z0-9]+)*` (7.8). For built CSS, where the `components` layer holds the keyframes of every
 * component.
 */
export function keyframesOwner(name: string, components: ReadonlySet<string>): string | undefined {
  let owner: string | undefined;
  for (const component of components) {
    const fits = name.startsWith(`${component}-`) && isKebabTail(name.slice(component.length + 1));
    if (fits && (owner === undefined || component.length > owner.length)) owner = component;
  }
  return owner;
}

/**
 * The component that owns a local, a custom property `--<kebab>-<name>` (7.8, css-local-var): the longest
 * component name that fits, as for `keyframesOwner`. Any other property, a token such as `--space-2` too when no
 * component has that name, has none.
 */
export function localOwner(property: string, components: ReadonlySet<string>): string | undefined {
  return property.startsWith('--') ? keyframesOwner(property.slice(2), components) : undefined;
}

// Shapes (7.1, 7.9, 7.11)

/** The problems of one shape check, in the order they are found. */
type Sink = ParseProblem[];

const problem = (sink: Sink, place: Place, message: string): void => {
  sink.push({ message, place });
};

/** Every selector list of a compound's pseudo-classes, `:global()` left out. */
function argumentsOf(compound: Compound): ComplexSelector[] {
  return compound.pseudoClasses.flatMap((pseudo) => (pseudo.name === GLOBAL ? [] : (pseudo.selectors ?? [])));
}

/** The sibling combinators of a selector: a problem each (lead decision 2 of M4: 7.1 and 7.9). */
function siblingProblems(selector: ComplexSelector, where: string, sink: Sink): void {
  selector.combinators.forEach((combinator, index) => {
    if (combinator !== '+' && combinator !== '~') return;
    const place = selector.compounds[index + 1]?.place ?? selector.place;
    problem(
      sink,
      place,
      `the sibling combinator \`${combinator}\` in ${where}; use it only inside a pseudo-class such as \`:has(${combinator} …)\``,
    );
  });
}

/** Splits a text at CSS white space, as an attribute value of class names is split. */
function splitWhitespace(text: string): string[] {
  const out: string[] = [];
  let word = '';
  for (const char of text) {
    if (char === ' ' || char === '\t' || char === '\n' || char === '\r' || char === '\f') {
      if (word !== '') out.push(word);
      word = '';
    } else word += char;
  }
  if (word !== '') out.push(word);
  return out;
}

/**
 * The classes that a compound selects by, for the shape checks and the coverage rules: its classes, and the class
 * names of an attribute selector on `class` that selects whole names. `[class~=box]` is `.box`, and `[class="a b"]`
 * holds `.a` and `.b` (7.1); such a name has the place of its `[`. `[class]` alone names no class; the forms that
 * match a part of a name are `classPartProblems`.
 */
export function classNames(compound: Compound): NameSelector[] {
  const out = [...compound.classes];
  for (const attribute of compound.attributes) {
    if (attribute.name !== 'class' || attribute.value === undefined) continue;
    if (attribute.operator !== '~=' && attribute.operator !== '=') continue;
    for (const name of splitWhitespace(attribute.value)) out.push({ name, place: attribute.place });
  }
  return out;
}

/** The operators of an attribute selector that match a part of a value: `^=`, `$=`, `*=` and `|=`. */
const PART_OPERATORS: ReadonlySet<string> = new Set(['^=', '$=', '*=', '|=']);

/** An attribute selector on `class` that matches a part of a class name (`[class^=card]`): a problem each (7.1). */
function classPartProblems(selector: ComplexSelector, sink: Sink): void {
  eachCompound(selector, (compound) => {
    for (const attribute of compound.attributes) {
      if (attribute.name !== 'class' || attribute.operator === undefined || !PART_OPERATORS.has(attribute.operator)) {
        continue;
      }
      problem(
        sink,
        attribute.place,
        `the attribute selector \`[class${attribute.operator}…]\` selects classes by a part of their name; write the class`,
      );
    }
  });
}

/** The message for a class that is no part of the component. */
function foreignClass(name: string, component: string, options: ShapeOptions): string {
  const owner = ownerOf(name, options.components);
  return owner !== undefined && owner !== component
    ? `the class \`.${name}\` belongs to the component \`${owner}\`, not to \`${component}\``
    : `the class \`.${name}\` belongs to no part of \`${component}\``;
}

// elements.css

function elementsCompound(compound: Compound, inArgument: boolean, options: ShapeOptions, sink: Sink): void {
  const typed = compound.type !== undefined && compound.type !== '*';
  classNames(compound).forEach((item, index) => {
    const owner = ownerOf(item.name, options.components);
    if (owner !== undefined) {
      problem(sink, item.place, `the class \`.${item.name}\` of the component \`${owner}\` in \`elements.css\``);
    } else if (!typed) {
      problem(sink, item.place, `the class \`.${item.name}\` without a type selector: a variant attaches to a type`);
    } else if (index > 0) {
      problem(sink, item.place, `a second class \`.${item.name}\`: a type takes at most one variant class`);
    }
  });
  const bare =
    compound.type === undefined &&
    compound.classes.length === 0 &&
    compound.ids.length === 0 &&
    compound.pseudoClasses.length === 0 &&
    compound.pseudoElements.length === 0 &&
    !compound.nesting;
  if (bare && !inArgument) {
    problem(sink, compound.place, 'a compound without a type selector, `*` or a pseudo-class in `elements.css`');
  }
  for (const selector of argumentsOf(compound)) elementsShape(selector, true, options, sink);
}

function elementsShape(selector: ComplexSelector, inArgument: boolean, options: ShapeOptions, sink: Sink): void {
  for (const compound of selector.compounds) elementsCompound(flatten(compound), inArgument, options, sink);
}

// Component files

/** Says whether a selector starts at the root: its first compound holds `.<root>`, or a `:is()` of such selectors. */
function startsAtRoot(selector: ComplexSelector, component: string): boolean {
  const first = selector.compounds[0];
  return first !== undefined && rootHolder(flatten(first), component) !== undefined;
}

/**
 * How a compound holds the root class: `'class'` when it holds `.<root>`, the pseudo-class when a `:is()` or
 * `:where()` of selectors that each start at the root holds it (CSS Nesting writes a parent list in this way),
 * `undefined` when it does not.
 */
function rootHolder(compound: Compound, component: string): 'class' | PseudoClass | undefined {
  if (classNames(compound).some((item) => item.name === component)) return 'class';
  return compound.pseudoClasses.find(
    (pseudo) =>
      (pseudo.name === 'is' || pseudo.name === 'where') &&
      (pseudo.selectors?.length ?? 0) > 0 &&
      (pseudo.selectors ?? []).every((selector) => startsAtRoot(selector, component)),
  );
}

/** The shape of an argument of a pseudo-class in a component file: any class of the component, any type. */
function componentArgument(selector: ComplexSelector, component: string, options: ShapeOptions, sink: Sink): void {
  for (const compound of selector.compounds.map(flatten)) argumentCompound(compound, component, options, sink);
}

function argumentCompound(compound: Compound, component: string, options: ShapeOptions, sink: Sink): void {
  for (const item of classNames(compound)) {
    if (classRole(item.name, component) === undefined) {
      problem(sink, item.place, foreignClass(item.name, component, options));
    }
  }
  for (const inner of argumentsOf(compound)) componentArgument(inner, component, options, sink);
}

/** Says whether a pseudo-class is `:is()` or `:where()`: its arguments are the element of its compound (7.1). */
const isSameElement = (pseudo: PseudoClass): boolean => pseudo.name === 'is' || pseudo.name === 'where';

/**
 * Checks the arguments of a `:is()` or `:where()` as part of the compound that holds it: `.card:is(div, span)` is
 * `div.card` or `span.card`. The last compound of each argument gets `check`, the shape of the holding compound; the
 * compounds before it stand before the element and take the free shape of an argument.
 */
function sameElementArguments(
  pseudo: PseudoClass,
  component: string,
  options: ShapeOptions,
  sink: Sink,
  check: (compound: Compound) => void,
): void {
  for (const selector of pseudo.selectors ?? []) {
    const compounds = selector.compounds.map(flatten);
    compounds.forEach((compound, index) => {
      if (index === compounds.length - 1) check(compound);
      else argumentCompound(compound, component, options, sink);
    });
  }
}

/**
 * The classes, type and arguments of a root compound, or of an argument of its `:is()` or `:where()` (`depth` > 0).
 * `roots` counts the root class in one alternative of the compound.
 */
function rootParts(
  compound: Compound,
  component: string,
  holder: 'class' | PseudoClass | undefined,
  roots: number,
  options: ShapeOptions,
  sink: Sink,
  depth: number,
): void {
  if (holder !== undefined && compound.type !== undefined && compound.type !== '*') {
    problem(sink, compound.place, `the type selector \`${compound.type}\` in the root compound of \`${component}\``);
  }
  let count = roots;
  for (const item of classNames(compound)) {
    const role = classRole(item.name, component);
    if (role === 'root') {
      count += 1;
      if (count > 1) problem(sink, item.place, `the root class \`.${component}\` twice in one compound`);
    } else if (role === 'part') {
      problem(sink, item.place, `the part class \`.${item.name}\` in the root compound`);
    } else if (role === undefined) problem(sink, item.place, foreignClass(item.name, component, options));
  }
  for (const pseudo of compound.pseudoClasses) {
    if (pseudo.name === GLOBAL) continue;
    if (pseudo === holder) {
      // The `:is()` that holds the root stands for the selector itself (a parent list of nesting): its arguments
      // are checked as selectors of the file, the sibling rule too (`:is(.card ~ div)` is `.card ~ div`).
      for (const selector of pseudo.selectors ?? []) componentShape(selector, component, options, sink);
    } else if (isSameElement(pseudo) && depth < MAX_COUNT_DEPTH) {
      sameElementArguments(pseudo, component, options, sink, (inner) =>
        rootParts(inner, component, holder, count, options, sink, depth + 1),
      );
    } else for (const selector of pseudo.selectors ?? []) componentArgument(selector, component, options, sink);
  }
}

function rootCompound(compound: Compound, component: string, options: ShapeOptions, sink: Sink): void {
  const holder = rootHolder(compound, component);
  if (holder === undefined) {
    problem(sink, compound.place, `the selector does not start at the root class \`.${component}\``);
  }
  rootParts(compound, component, holder, 0, options, sink, 0);
}

/**
 * A compound after the root compound, or an argument of its `:is()` or `:where()` (`depth` > 0). `classes` counts
 * the classes in one alternative of the compound.
 */
function laterParts(
  compound: Compound,
  component: string,
  classes: number,
  options: ShapeOptions,
  sink: Sink,
  depth: number,
): void {
  let count = classes;
  for (const item of classNames(compound)) {
    const role = classRole(item.name, component);
    if (role === 'root') problem(sink, item.place, `the root class \`.${component}\` again after the root compound`);
    else if (role === 'modifier') {
      problem(sink, item.place, `the modifier \`.${item.name}\` outside the root compound`);
    } else if (role === undefined) problem(sink, item.place, foreignClass(item.name, component, options));
    else if (count > 0) problem(sink, item.place, `a second class \`.${item.name}\` in one compound`);
    count += 1;
  }
  for (const pseudo of compound.pseudoClasses) {
    if (pseudo.name === GLOBAL) continue;
    if (isSameElement(pseudo) && depth < MAX_COUNT_DEPTH) {
      sameElementArguments(pseudo, component, options, sink, (inner) =>
        laterParts(inner, component, count, options, sink, depth + 1),
      );
    } else for (const selector of pseudo.selectors ?? []) componentArgument(selector, component, options, sink);
  }
}

function laterCompound(compound: Compound, component: string, options: ShapeOptions, sink: Sink): void {
  laterParts(compound, component, 0, options, sink, 0);
}

function componentShape(selector: ComplexSelector, component: string, options: ShapeOptions, sink: Sink): void {
  siblingProblems(selector, 'a component file', sink);
  selector.compounds.map(flatten).forEach((compound, index) => {
    if (index === 0) rootCompound(compound, component, options, sink);
    else laterCompound(compound, component, options, sink);
  });
}

// Page files (7.9)

/** The pseudo-classes of a page file (7.9). */
const PAGE_PSEUDO_CLASSES: ReadonlySet<string> = new Set(['first-child', 'last-child', 'nth-child']);

function pageShape(selector: ComplexSelector, options: ShapeOptions, sink: Sink): void {
  siblingProblems(selector, 'a page file', sink);
  for (const compound of selector.compounds.map(flatten)) {
    if (compound.type !== undefined) {
      problem(
        sink,
        compound.place,
        `the type selector \`${compound.type}\` in a page file: it selects component roots`,
      );
    }
    for (const attribute of compound.attributes) {
      problem(sink, attribute.place, `the attribute selector \`[${attribute.name}]\` in a page file`);
    }
    for (const element of compound.pseudoElements) {
      problem(sink, element.place, `the pseudo-element \`::${element.name}\` in a page file`);
    }
    if (compound.classes.length === 0 && compound.ids.length === 0 && !compound.nesting) {
      problem(sink, compound.place, 'a compound without a component root class in a page file');
    }
    compound.classes.forEach((item, index) => {
      if (!options.components.has(item.name)) {
        problem(sink, item.place, `the class \`.${item.name}\` is no component root`);
      } else if (index > 0) problem(sink, item.place, `a second class \`.${item.name}\` in one compound`);
    });
    for (const pseudo of compound.pseudoClasses) {
      if (pseudo.name === GLOBAL) continue;
      if (!PAGE_PSEUDO_CLASSES.has(pseudo.name)) {
        problem(
          sink,
          pseudo.place,
          `the pseudo-class \`:${pseudo.name}\` in a page file: only \`:first-child\`, \`:last-child\` and \`:nth-child()\``,
        );
      } else if (pseudo.selectors !== undefined) {
        problem(sink, pseudo.place, '`:nth-child()` with `of` in a page file');
      }
    }
  }
}

/** The problems in the order of the text. */
const inOrder = (sink: Sink): ParseProblem[] => sink.sort((a, b) => a.place.offset - b.place.offset);

/**
 * The shape part of `css-selector` alone (7.1 table; 7.9 for a page file):
 *
 * - **elements**: each compound is a type, `*`, `:root` or a bare pseudo-class, with attributes, states and
 *   pseudo-elements, and at most one class, only on a named type (`a.button`). A class of a component fails. The
 *   arguments of pseudo-classes follow the same shape, and there a compound may be attributes alone.
 * - **component**: the first compound holds the root class `.<kebab>`, and besides it only modifiers, states and
 *   attributes (no type). Each later compound holds a type or `*`, at most one part class, states and attributes.
 *   Every pseudo-class is a state, structural ones too (`:first-child`, `:not(:last-child)`). A sibling combinator
 *   fails outside the argument of a pseudo-class (`.card + .card` fails, `.card:has(+ .card)` passes). In an
 *   argument of `:not()`, `:has()` or `:nth-*()`, a compound may hold any class of the component and any type. The
 *   last compound of each argument of `:is()` and `:where()` is part of the compound that holds it
 *   (`.card:is(div)` is `div.card` and fails), and a `:is()` that holds the root stands for the selector, the
 *   sibling rule too (`:is(.card ~ div)` fails).
 * - **elements** and **component**: `[class~=x]` and `[class=x]` count as the class `.x`; `[class^=…]`, `[class$=…]`,
 *   `[class*=…]` and `[class|=…]` fail.
 * - **page**: each compound is exactly one component root class, with only `:first-child`, `:last-child` or
 *   `:nth-child(An+B)` (no `of`); descendant and child combinators only.
 *
 * Ids, a bare `&`, the limits of 7.11 and `:global()` are left to `selectorProblems` and `css-banned`: they give no
 * problem here. A `:is()` of one compound counts as part of its compound, as the minifier writes it (`a:is(.b)` is
 * `a.b`).
 */
export function shapeProblems(selector: ComplexSelector, file: CssFile, options: ShapeOptions): ParseProblem[] {
  const sink: Sink = [];
  if (file.kind === 'elements') elementsShape(selector, false, options, sink);
  else if (file.kind === 'component') componentShape(selector, file.component, options, sink);
  else pageShape(selector, options, sink);
  if (file.kind !== 'page') classPartProblems(selector, sink);
  return inOrder(sink);
}

/** Visits every compound of a selector, those of pseudo-class arguments too (`:global()` left out). */
function eachCompound(selector: ComplexSelector, visit: (compound: Compound) => void): void {
  for (const compound of selector.compounds) {
    visit(compound);
    for (const inner of argumentsOf(compound)) eachCompound(inner, visit);
  }
}

/**
 * Every problem of `css-selector` for one resolved selector: an id (at any depth), a bare `&` (a top-level rule
 * that CSS reads as `:scope`), specificity above (0,3,x) (the root class left out in a component file), more than 4
 * compounds, and the shape of `shapeProblems` (7.1, 7.9, 7.11). It leaves `:global()` to css-banned: such a
 * pseudo-class and its arguments give no problem.
 */
export function selectorProblems(selector: ComplexSelector, file: CssFile, options: ShapeOptions): ParseProblem[] {
  const sink: Sink = [];
  eachCompound(selector, (compound) => {
    for (const id of compound.ids) problem(sink, id.place, `the id \`#${id.name}\`: the kit allows no id selector`);
    if (compound.nesting) problem(sink, compound.place, 'a bare `&` outside a nested rule');
  });
  const value = specificity(selector, file.kind === 'component' ? file.component : undefined);
  if (value[1] > SELECTOR_LIMITS.classes) {
    problem(sink, selector.place, `the specificity (${value.join(',')}) is above (0,${SELECTOR_LIMITS.classes},x)`);
  }
  const count = compoundCount(selector);
  if (count > SELECTOR_LIMITS.compounds) {
    const place = selector.compounds[SELECTOR_LIMITS.compounds]?.place ?? selector.place;
    problem(sink, place, `${count} compounds, more than ${SELECTOR_LIMITS.compounds}`);
  }
  sink.push(...shapeProblems(selector, file, options));
  return inOrder(sink);
}

// At-rules (7.1, 7.9)

/** The at-rules that each kind of file may hold (7.1, 7.9). */
const FILE_AT_RULES: ReadonlyMap<CssFile['kind'], ReadonlySet<string>> = new Map<CssFile['kind'], ReadonlySet<string>>([
  ['elements', new Set(['media', 'container', 'supports', 'starting-style', 'keyframes'])],
  ['component', new Set(['media', 'container', 'supports', 'starting-style', 'keyframes'])],
  ['page', new Set(['media', 'container', 'supports'])],
]);

/** The at-rules that other rules report: `@layer` (css-layer-file), `@import` and `@scope` (css-banned). */
const OTHER_RULES_AT_RULES: ReadonlySet<string> = new Set(['layer', 'import', 'scope']);

/** The names that a `@keyframes` rule cannot take (CSS Animations: the CSS-wide keywords and `none`). */
const RESERVED_KEYFRAMES: ReadonlySet<string> = new Set([
  'none',
  'initial',
  'inherit',
  'unset',
  'revert',
  'revert-layer',
  'default',
]);

const FILE_NAMES: ReadonlyMap<CssFile['kind'], string> = new Map<CssFile['kind'], string>([
  ['elements', '`elements.css`'],
  ['component', 'a component file'],
  ['page', 'a page file'],
]);

/** The problem of a `@keyframes` prelude, if any. */
function keyframesProblem(rule: AtRule, file: CssFile): ParseProblem | undefined {
  const name = rule.prelude.length === 1 ? rule.prelude[0] : undefined;
  const text = serialize(rule.prelude);
  if (file.kind === 'component') {
    const fits =
      name?.type === 'ident' &&
      name.value.startsWith(`${file.component}-`) &&
      isKebabTail(name.value.slice(file.component.length + 1));
    return fits
      ? undefined
      : { message: `the keyframes \`${text}\` are not named \`${file.component}-<name>\``, place: rule.place };
  }
  const valid = name?.type === 'string' || (name?.type === 'ident' && !RESERVED_KEYFRAMES.has(asciiLower(name.value)));
  return valid ? undefined : { message: `\`@keyframes ${text}\` has no valid name`, place: rule.place };
}

/**
 * The at-rule shape of 7.1 and 7.9 for an at-rule inside the file's layer block (css-selector): elements and
 * component files allow @media, @container, @supports, @starting-style and @keyframes (a component only
 * `@keyframes <kebab>-<name>`); a page file allows @media, @container and @supports. Each needs a block, and
 * `@starting-style` takes no prelude. `@layer` (css-layer-file), `@import` and `@scope` (css-banned) give undefined
 * here; every other at-rule gives a problem. The preludes of `@media` and `@container` are media.ts's.
 */
export function atRuleProblem(rule: AtRule, file: CssFile): ParseProblem | undefined {
  if (OTHER_RULES_AT_RULES.has(rule.name)) return undefined;
  const where = FILE_NAMES.get(file.kind) ?? 'a project file';
  if (!(FILE_AT_RULES.get(file.kind)?.has(rule.name) ?? false)) {
    return { message: `the at-rule \`@${rule.name}\` in ${where}`, place: rule.place };
  }
  if (rule.block === undefined) return { message: `\`@${rule.name}\` without a block`, place: rule.place };
  if (rule.name === 'starting-style' && rule.prelude.length > 0) {
    return { message: '`@starting-style` with a prelude, which CSS refuses', place: rule.place };
  }
  return rule.name === 'keyframes' ? keyframesProblem(rule, file) : undefined;
}

// Facts for other rules

/**
 * The placement properties of 7.9: `css-page` checks that a page file declares no other property. The selectors and
 * at-rules of a page file are `css-selector`'s (`selectorProblems`, `atRuleProblem`), so each violation reports once.
 */
export const PLACEMENT_PROPERTIES: ReadonlySet<string> = new Set([
  'grid-column',
  'grid-column-start',
  'grid-column-end',
  'grid-row',
  'grid-row-start',
  'grid-row-end',
  'grid-area',
  'order',
  'align-self',
  'justify-self',
  'place-self',
  'align-items',
  'justify-items',
  'place-items',
  'align-content',
  'justify-content',
  'place-content',
  'gap',
  'row-gap',
  'column-gap',
]);

/**
 * Says whether the selector is exactly the root compound of the component: one compound holding `.<kebab>`, with
 * no combinator (7.8: locals are defined on the root compound). A modifier or a state on it does not change that.
 */
export function isRootSelector(selector: ComplexSelector, component: string): boolean {
  const only = selector.compounds.length === 1 ? selector.compounds[0] : undefined;
  return (
    selector.leading === undefined &&
    only !== undefined &&
    flatten(only).classes.some((item) => item.name === component)
  );
}

/**
 * The last compound: the subject (css-element-coverage, css-banned overflow on html, body, :root). A `:is()` of one
 * compound is put into it, as the minifier does (`a:is(.button)` is `a.button`), so source and built CSS agree.
 */
export function subject(selector: ComplexSelector): Compound | undefined {
  const last = selector.compounds.at(-1);
  return last === undefined ? undefined : flatten(last);
}

/** Every attribute selector at every depth, arguments included, in the order of the tree (modes-media: `data-mode`). */
export function attributesOf(selector: ComplexSelector): AttributeSelector[] {
  const out: AttributeSelector[] = [];
  const visit = (current: ComplexSelector): void => {
    for (const compound of current.compounds) {
      out.push(...compound.attributes);
      for (const pseudo of compound.pseudoClasses) for (const inner of pseudo.selectors ?? []) visit(inner);
    }
  };
  visit(selector);
  return out;
}

// Normalized text (design-specs)

const HEX = 16;

/** A name as CSS Object Model serializes an identifier: escapes only where CSS needs them. */
function identifier(name: string): string {
  let out = '';
  const first = name.charCodeAt(0);
  let index = 0;
  for (const char of name) {
    const code = char.codePointAt(0) ?? 0;
    const digit = code >= 0x30 && code <= 0x39;
    if (code === 0) out += '�';
    else if ((code >= 0x01 && code <= 0x1f) || code === 0x7f || (index === 0 && digit)) {
      out += `\\${code.toString(HEX)} `;
    } else if (index === 1 && digit && first === 0x2d) out += `\\${code.toString(HEX)} `;
    else if (index === 0 && char === '-' && name.length === 1) out += '\\-';
    else if (
      code >= 0x80 ||
      char === '-' ||
      char === '_' ||
      digit ||
      (code >= 0x41 && code <= 0x5a) ||
      (code >= 0x61 && code <= 0x7a)
    ) {
      out += char;
    } else out += `\\${char}`;
    index += char.length;
  }
  return out;
}

/** A string as CSS Object Model serializes it: in double quotes. */
function quoted(text: string): string {
  let out = '"';
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (code === 0) out += '�';
    else if ((code >= 0x01 && code <= 0x1f) || code === 0x7f) out += `\\${code.toString(HEX)} `;
    else if (char === '"' || char === '\\') out += `\\${char}`;
    else out += char;
  }
  return `${out}"`;
}

/** An+B as text: `2n+1`, `-n+3`, `5`. */
function anPlusBText({ a, b }: { a: number; b: number }): string {
  if (a === 0) return String(b);
  const n = a === 1 ? 'n' : a === -1 ? '-n' : `${a}n`;
  return b === 0 ? n : b > 0 ? `${n}+${b}` : `${n}${b}`;
}

function normalizedList(list: readonly ComplexSelector[]): string {
  return list.map(normalizeSelector).join(',');
}

/** The pseudo-class that the minifier writes for `:nth-*(1)`: `:nth-child(1)` is `:first-child`. */
const FIRST_OF: ReadonlyMap<string, string> = new Map([
  ['nth-child', 'first-child'],
  ['nth-last-child', 'last-child'],
  ['nth-of-type', 'first-of-type'],
  ['nth-last-of-type', 'last-of-type'],
]);

function normalizedPseudoClass(pseudo: PseudoClass): string {
  if (pseudo.args === undefined) return `:${pseudo.name}`;
  const first = FIRST_OF.get(pseudo.name);
  if (first !== undefined && pseudo.nth?.a === 0 && pseudo.nth.b === 1 && pseudo.selectors === undefined) {
    return `:${first}`;
  }
  if (pseudo.nth !== undefined) {
    const of = pseudo.selectors === undefined ? '' : ` of ${normalizedList(pseudo.selectors)}`;
    return `:${pseudo.name}(${anPlusBText(pseudo.nth)}${of})`;
  }
  if (pseudo.selectors !== undefined) return `:${pseudo.name}(${normalizedList(pseudo.selectors)})`;
  const args = serialize(trimWhitespace(pseudo.args));
  return `:${pseudo.name}(${pseudo.name === 'dir' ? asciiLower(args) : args})`;
}

function normalizedCompound(input: Compound): string {
  const compound = flatten(input);
  let out = '';
  for (const id of compound.ids) out += `#${identifier(id.name)}`;
  for (const item of compound.classes) out += `.${identifier(item.name)}`;
  for (const attribute of compound.attributes) {
    const value = attribute.value === undefined ? '' : `${attribute.operator ?? '='}${quoted(attribute.value)}`;
    out += `[${identifier(attribute.name)}${value}${attribute.modifier === undefined ? '' : ` ${attribute.modifier}`}]`;
  }
  for (const pseudo of compound.pseudoClasses) out += normalizedPseudoClass(pseudo);
  for (const element of compound.pseudoElements) {
    out += `::${element.name}${element.args === undefined ? '' : `(${serialize(trimWhitespace(element.args))})`}`;
  }
  const type = compound.type === undefined ? '' : compound.type === '*' ? '*' : identifier(compound.type);
  const nesting = compound.nesting ? '&' : '';
  if (type === '*' && (out !== '' || nesting !== '')) return `${nesting}${out}`;
  return `${type}${nesting}${out}`;
}

/**
 * A canonical text that is equal for the source form and the built form of one selector (design-specs): types in
 * lower case, `::` for every pseudo-element, attribute values quoted, An+B as `2n+1` (odd) and `2n` (even), one
 * space for the descendant combinator, no space around the others, `*` dropped before another simple selector. In
 * each compound the type comes first, then `&`, ids, classes, attributes, pseudo-classes and pseudo-elements, each
 * kind in the order written. Two more rewrites of the minifier give the same text: a `:is()` of one compound stands
 * in its compound (`.a:is(.b)` is `.a.b`), and `:nth-child(1)` is `:first-child` (also `:nth-last-child(1)`,
 * `:nth-of-type(1)` and `:nth-last-of-type(1)`). Names are escaped as CSS Object Model escapes them.
 */
export function normalizeSelector(selector: ComplexSelector): string {
  let out = selector.leading === undefined || selector.leading === ' ' ? '' : selector.leading;
  selector.compounds.forEach((compound, index) => {
    if (index > 0) out += selector.combinators[index - 1] ?? ' ';
    out += normalizedCompound(compound);
  });
  return out;
}

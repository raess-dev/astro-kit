/**
 * The `@media` and `@container` prelude parser (specification, 3.2 and 7.10). It reads a prelude of `parse.ts` with the
 * grammar of Media Queries Level 4 and CSS Containment Level 3, and gives the media types, the features, the lengths
 * and the problems of `css-media`. `modes-media` reads the mode features (7.12), and `css-literal` asks whether a rule
 * stands inside `@media (forced-colors: active)` (7.3).
 *
 * It reads source CSS and the built CSS of Lightning CSS (13.1 item 40) alike: `(min-width: 48rem)` and the built
 * `(width>=48rem)` give the same length, and `(width >= 48rem)` and `(width>=48rem)` the same feature. The minifier
 * also rewrites the numbers of a prelude, so a built length equals a breakpoint in the minifier's form of it
 * (`minifiedWidth`): `0rem` is built as `0`, and `48.123456rem` as `48.1235rem`.
 *
 * The rules of the module:
 *
 * - Keywords, media types, feature names, keyword values and units compare in ASCII lower case (`asciiLower`).
 * - The tables are sets and maps: `constructor` and `__proto__` find nothing.
 * - It never throws. It recurses only over the brackets of the prelude, at most `MAX_DEPTH` levels deep.
 * - A prelude gives at most `MAX_PROBLEMS` problems.
 */
import type { Breakpoint } from '../context.ts';
import {
  type AtRule,
  asciiLower,
  type BlockValue,
  type ComponentValue,
  type FunctionValue,
  isDelim,
  isIdent,
  MAX_DEPTH,
  MAX_PROBLEMS,
  type ParseProblem,
  type Place,
  parseValue,
  serialize,
  trimWhitespace,
} from './parse.ts';
import type { CssForm } from './values.ts';

// The shapes

/** One media or container feature in a prelude. */
export interface MediaFeature {
  /** The feature as written, ASCII lower case, with a min-/max- prefix kept: `min-width`, `width`, `hover`. */
  name: string;
  /** `plain` (`(hover: hover)`, `(min-width: 48rem)`), `boolean` (`(hover)`) or `range` (`(width >= 48rem)`, `(48rem <= width < 60rem)`). */
  form: 'plain' | 'boolean' | 'range';
  /** The value of a plain feature, trimmed; [] otherwise. */
  value: ComponentValue[];
  /** True under a `not`: `not (hover)`, `not screen and (hover)`, `screen and not (hover)`. */
  negated: boolean;
  /** The place of the feature name. */
  place: Place;
}

/** One length of a prelude (7.10). */
export interface MediaLength {
  value: number;
  /** The unit in ASCII lower case; `''` for a unitless `0`. */
  unit: string;
  /** The length as written. */
  text: string;
  place: Place;
}

/** What one `@media` or `@container` prelude holds. */
export interface MediaPrelude {
  kind: 'media' | 'container';
  /** The media types (`screen`), ASCII lower case. */
  types: { name: string; place: Place }[];
  features: MediaFeature[];
  /** Every length of every feature: dimension tokens with a length unit, and a unitless 0 as the value of a length feature. */
  lengths: MediaLength[];
  /**
   * The problems of css-media other than the lengths: the grammar of Media Queries Level 4 (keywords not, only, and,
   * or; no mix of and and or at one level), a type other than all, screen, print, a feature not in 7.10, a value of
   * the wrong kind (a range feature needs a length), any function (var() with its own message: "the minifier stops
   * the build", S4), and for @container a container name (lead decision 3) or a list of queries.
   */
  problems: MediaProblem[];
}

/**
 * A problem of a prelude. `invalid` is true when CSS refuses the query too: a browser reads that query of `@media`
 * as `not all`, and drops an `@container` rule. It is false for a rule of 7.10 that CSS does not have: a media type
 * other than all, screen and print, a feature or a value in brackets that 7.10 does not allow (CSS reads it as an
 * unknown condition, `<general-enclosed>`), a function, `var()`, a container name and a list of container queries.
 * The acceptance test `css-oracle.test.ts` holds the module to this against Chromium.
 */
export interface MediaProblem extends ParseProblem {
  invalid: boolean;
}

// The tables (7.10)

/** The media types of 7.10. */
export const MEDIA_TYPES: ReadonlySet<string> = new Set(['all', 'screen', 'print']);

/** The names that CSS never reads as a media type (Media Queries Level 4). */
const RESERVED_TYPES: ReadonlySet<string> = new Set(['not', 'only', 'and', 'or', 'layer']);

/** What a feature takes: a length (a range feature, also with `min-`/`max-`), or one keyword of a list. */
type FeatureKind = { type: 'range' } | { type: 'discrete'; values: ReadonlySet<string> };

const RANGE: FeatureKind = { type: 'range' };
const discrete = (...values: string[]): FeatureKind => ({ type: 'discrete', values: new Set(values) });
const ORIENTATION = discrete('portrait', 'landscape');
const HOVER = discrete('none', 'hover');
const POINTER = discrete('none', 'coarse', 'fine');

/** The media features of 7.10 without the min-/max- forms. */
const MEDIA_FEATURE_KINDS: ReadonlyMap<string, FeatureKind> = new Map([
  ['width', RANGE],
  ['height', RANGE],
  ['orientation', ORIENTATION],
  ['prefers-color-scheme', discrete('light', 'dark')],
  ['prefers-contrast', discrete('no-preference', 'more', 'less', 'custom')],
  ['prefers-reduced-motion', discrete('no-preference', 'reduce')],
  ['prefers-reduced-transparency', discrete('no-preference', 'reduce')],
  ['forced-colors', discrete('none', 'active')],
  ['hover', HOVER],
  ['any-hover', HOVER],
  ['pointer', POINTER],
  ['any-pointer', POINTER],
  ['scripting', discrete('none', 'initial-only', 'enabled')],
]);

/** The container features of 7.10 without the min-/max- forms. */
const CONTAINER_FEATURE_KINDS: ReadonlyMap<string, FeatureKind> = new Map([
  ['width', RANGE],
  ['height', RANGE],
  ['inline-size', RANGE],
  ['block-size', RANGE],
  ['orientation', ORIENTATION],
]);

/** The names of a feature table, with the min-/max- forms of its range features. */
function featureNames(kinds: ReadonlyMap<string, FeatureKind>): Set<string> {
  const names = new Set<string>();
  for (const [name, kind] of kinds) {
    names.add(name);
    if (kind.type === 'range') {
      names.add(`min-${name}`);
      names.add(`max-${name}`);
    }
  }
  return names;
}

/** The media features of 7.10, with the min-/max- forms of width and height. */
export const MEDIA_FEATURES: ReadonlySet<string> = featureNames(MEDIA_FEATURE_KINDS);

/** The container features of 7.10, with the min-/max- forms of the four sizes. */
export const CONTAINER_FEATURES: ReadonlySet<string> = featureNames(CONTAINER_FEATURE_KINDS);

/** The mode features of modes-media (7.12): prefers-color-scheme and prefers-contrast. */
export const MODE_FEATURES: ReadonlySet<string> = new Set(['prefers-color-scheme', 'prefers-contrast']);

/** The length units of CSS Values Level 4 and CSS Containment Level 3, in ASCII lower case. */
const LENGTH_UNITS: ReadonlySet<string> = new Set([
  ...['px', 'cm', 'mm', 'q', 'in', 'pt', 'pc'],
  ...['em', 'rem', 'ex', 'rex', 'cap', 'rcap', 'ch', 'rch', 'ic', 'ric', 'lh', 'rlh'],
  ...['', 's', 'l', 'd'].flatMap((size) => ['vw', 'vh', 'vi', 'vb', 'vmin', 'vmax'].map((unit) => `${size}${unit}`)),
  ...['cqw', 'cqh', 'cqi', 'cqb', 'cqmin', 'cqmax'],
]);

// Messages

/** The longest text of the input that a message quotes. */
const MAX_QUOTE = 60;

/** A text of the input for a message: at most `MAX_QUOTE` characters, in backticks. */
function quote(text: string): string {
  const short = text.length > MAX_QUOTE ? `${text.slice(0, MAX_QUOTE)}…` : text;
  return `\`${short}\``;
}

/** The text of one component value for a message: a function as `name()`, a block as its two brackets. */
function shortText(value: ComponentValue): string {
  if (value.type === 'function') return `${value.text}()`;
  if (value.type === 'block') return value.open === '(' ? '( )' : value.open === '[' ? '[ ]' : '{ }';
  return value.text;
}

const VAR_MESSAGE = '`var()` in a prelude: the minifier stops the build and names no source file (7.10, S4)';

// The parser

/** A logical condition of a query: what `requiresForcedColors` reads. */
type Condition =
  | { kind: 'feature'; feature: MediaFeature }
  | { kind: 'not'; inner: Condition }
  | { kind: 'and' | 'or'; items: Condition[] }
  | { kind: 'unknown' };

/** One query of a list. */
interface Query {
  /** A `not` before the media type: the query is the negation of type and condition. */
  negated: boolean;
  condition: Condition | undefined;
  /** False when the query gave a problem. */
  valid: boolean;
}

/** The state of one prelude parse. */
interface State {
  kind: 'media' | 'container';
  features: ReadonlyMap<string, FeatureKind>;
  result: MediaPrelude;
  /** The number of `not` around the current place. */
  nots: number;
  /** The number of problems found, also those beyond `MAX_PROBLEMS`. */
  count: number;
  /** The number of brackets around the current place. */
  parens: number;
  /**
   * True after a container name. Chromium 153 keeps some rules with a name and a broken query (`@container card
   * not` stays as `@container card`), so a problem there is no claim about CSS.
   */
  named: boolean;
}

const UNKNOWN: Condition = { kind: 'unknown' };

/**
 * Records a problem. `invalid` is a problem of the grammar of CSS, `policy` one of 7.10. Inside brackets every
 * problem is `policy`: CSS reads any text in brackets as an unknown condition (`<general-enclosed>`), which is false.
 */
function addProblem(state: State, place: Place, message: string, kind: 'invalid' | 'policy'): void {
  state.count += 1;
  const invalid = kind === 'invalid' && state.parens === 0 && !state.named;
  if (state.result.problems.length < MAX_PROBLEMS) state.result.problems.push({ message, place, invalid });
}

/** The values without white space. */
const solid = (values: readonly ComponentValue[]): ComponentValue[] =>
  values.filter((value) => value.type !== 'whitespace');

/** Reports every `var()` of the values, at any depth (S4). The grammar pass then skips them. */
function findVars(state: State, values: readonly ComponentValue[], depth: number): void {
  if (depth > MAX_DEPTH) return;
  for (const value of values) {
    if (value.type === 'function') {
      if (value.name === 'var') addProblem(state, value.place, VAR_MESSAGE, 'policy');
      findVars(state, value.args, depth + 1);
    } else if (value.type === 'block') findVars(state, value.values, depth + 1);
  }
}

/** A problem for a value that stands where a condition in brackets belongs. */
function unexpected(state: State, value: ComponentValue): void {
  if (value.type === 'function') unexpectedFunction(state, value);
  else addProblem(state, value.place, `${quote(shortText(value))} where a condition in brackets belongs`, 'invalid');
}

/** A function in a prelude. A var() has its problem from `findVars` already; any other function gets one here. */
function unexpectedFunction(state: State, value: FunctionValue): void {
  if (value.name !== 'var')
    addProblem(state, value.place, `the function ${quote(`${value.text}()`)} in a prelude`, 'policy');
}

/** The length of a value, when it is one: a dimension with a length unit, or `0` without a unit when `zero` is set. */
function lengthOf(value: ComponentValue, zero: boolean): MediaLength | undefined {
  if (value.type === 'dimension' && LENGTH_UNITS.has(value.unit)) {
    return { value: value.value, unit: value.unit, text: value.text, place: value.place };
  }
  if (zero && value.type === 'number' && value.value === 0) {
    return { value: 0, unit: '', text: value.text, place: value.place };
  }
  return undefined;
}

/** The feature table entry of a name: the kind, and whether the name has a min-/max- prefix. */
function lookupFeature(state: State, name: string): { kind: FeatureKind; prefixed: boolean } | undefined {
  const own = state.features.get(name);
  if (own !== undefined) return { kind: own, prefixed: false };
  if (name.startsWith('min-') || name.startsWith('max-')) {
    const base = state.features.get(name.slice(4));
    if (base?.type === 'range') return { kind: base, prefixed: true };
  }
  return undefined;
}

/** One term of a range: a comparison or a value (a ratio `16/9` is one value of three tokens). */
type Term = { kind: 'op'; op: string; place: Place } | { kind: 'value'; values: ComponentValue[]; place: Place };

/** The delimiters that start a comparison of a range: `<`, `>` and `=`. `<=` and `>=` are two adjacent delimiters. */
const COMPARISONS: ReadonlySet<string> = new Set(['<', '>', '=']);

/** The terms of a range feature, or undefined after a problem. */
function rangeTerms(state: State, raw: readonly ComponentValue[]): Term[] | undefined {
  const terms: Term[] = [];
  let index = 0;
  while (index < raw.length) {
    const value = raw[index];
    if (value === undefined) break;
    if (value.type === 'whitespace') {
      index += 1;
      continue;
    }
    if (value.type === 'delim' && COMPARISONS.has(value.value)) {
      const next = raw[index + 1];
      if (value.value !== '=' && isDelim(next, '=')) {
        terms.push({ kind: 'op', op: `${value.value}=`, place: value.place });
        index += 2;
        continue;
      }
      if (value.value !== '=' && next?.type === 'whitespace' && isDelim(raw[index + 2], '=')) {
        addProblem(state, value.place, `a space inside ${quote(`${value.value}=`)}`, 'invalid');
        return undefined;
      }
      terms.push({ kind: 'op', op: value.value, place: value.place });
      index += 1;
      continue;
    }
    // A ratio: <number> / <number>, with or without white space.
    const rest = solid(raw.slice(index + 1, index + 6));
    if (value.type === 'number' && isDelim(rest[0], '/') && rest[1]?.type === 'number') {
      const slash = raw.indexOf(rest[0], index);
      const end = raw.indexOf(rest[1], slash) + 1;
      terms.push({ kind: 'value', values: raw.slice(index, end), place: value.place });
      index = end;
      continue;
    }
    terms.push({ kind: 'value', values: [value], place: value.place });
    index += 1;
  }
  return terms;
}

/** The direction of a comparison: `<` and `<=` are `lt`, `>` and `>=` are `gt`, `=` is `eq`. */
const direction = (op: string): 'lt' | 'gt' | 'eq' => (op.startsWith('<') ? 'lt' : op.startsWith('>') ? 'gt' : 'eq');

/** The single identifier of a term, if it is one. */
function termIdent(term: Term | undefined): ComponentValue | undefined {
  if (term?.kind !== 'value' || term.values.length !== 1) return undefined;
  const value = term.values[0];
  return isIdent(value) ? value : undefined;
}

/** Checks a value of a known feature, and records its lengths. */
function featureValue(state: State, name: string, kind: FeatureKind, values: readonly ComponentValue[]): void {
  const only = values.length === 1 ? values[0] : undefined;
  if (only === undefined) {
    const first = values[0];
    if (first !== undefined)
      addProblem(state, first.place, `the value of ${quote(name)} is more than one value`, 'invalid');
    for (const value of values) recordLength(state, value, false);
    return;
  }
  if (kind.type === 'range') {
    const length = lengthOf(only, true);
    if (length === undefined)
      addProblem(state, only.place, `the value ${quote(shortText(only))} of ${quote(name)} is no length`, 'invalid');
    else state.result.lengths.push(length);
    return;
  }
  recordLength(state, only, false);
  if (!isIdent(only) || !kind.values.has(asciiLower(only.value))) {
    addProblem(
      state,
      only.place,
      `the value ${quote(shortText(only))} of ${quote(name)} is not one of ${[...kind.values].join(', ')}`,
      'invalid',
    );
  }
}

/** Records a value as a length when it is one. */
function recordLength(state: State, value: ComponentValue, zero: boolean): void {
  const length = lengthOf(value, zero);
  if (length !== undefined) state.result.lengths.push(length);
}

/** Records a feature that the tables do not hold: one problem, and the lengths of its values. */
function unknownFeature(state: State, name: string, place: Place, values: readonly ComponentValue[]): void {
  addProblem(state, place, `the ${state.kind} feature ${quote(name)} is not allowed (7.10)`, 'policy');
  for (const value of values) recordLength(state, value, false);
}

/** Parses the inside of `( … )` as a media feature. */
function parseFeature(state: State, block: BlockValue): Condition {
  const raw = block.values;
  const items = solid(raw);
  const first = items[0];
  if (first === undefined) {
    addProblem(state, block.place, 'an empty `( )`', 'invalid');
    return UNKNOWN;
  }
  for (const item of items) {
    if (item.type === 'function') {
      unexpectedFunction(state, item);
      return UNKNOWN;
    }
  }
  const negated = state.nots > 0;
  // Boolean: `(hover)`.
  if (items.length === 1) {
    if (!isIdent(first)) {
      addProblem(state, first.place, `${quote(shortText(first))} is no media feature`, 'invalid');
      return UNKNOWN;
    }
    const name = asciiLower(first.value);
    const feature: MediaFeature = { name, form: 'boolean', value: [], negated, place: first.place };
    state.result.features.push(feature);
    const known = lookupFeature(state, name);
    if (known === undefined) unknownFeature(state, name, first.place, []);
    else if (known.prefixed) addProblem(state, first.place, `${quote(name)} needs a value`, 'invalid');
    return { kind: 'feature', feature };
  }
  // Plain: `(hover: hover)`.
  const colon = raw.findIndex((value) => value.type === 'colon');
  if (colon !== -1) {
    if (!isIdent(first) || items[1]?.type !== 'colon') {
      addProblem(state, first.place, `${quote(shortText(first))} is no media feature name`, 'invalid');
      return UNKNOWN;
    }
    const name = asciiLower(first.value);
    const value = trimWhitespace(raw.slice(colon + 1));
    const feature: MediaFeature = { name, form: 'plain', value, negated, place: first.place };
    state.result.features.push(feature);
    const known = lookupFeature(state, name);
    if (known === undefined) unknownFeature(state, name, first.place, value);
    else if (value.length === 0) addProblem(state, first.place, `${quote(name)} has no value after \`:\``, 'invalid');
    else featureValue(state, name, known.kind, value);
    return { kind: 'feature', feature };
  }
  return parseRange(state, raw, first);
}

/** Parses a range feature: `(width >= 48rem)`, `(48rem <= width)`, `(48rem <= width < 60rem)`. */
function parseRange(state: State, raw: readonly ComponentValue[], first: ComponentValue): Condition {
  const terms = rangeTerms(state, raw);
  if (terms === undefined) return UNKNOWN;
  const shapeOk =
    (terms.length === 3 || terms.length === 5) &&
    terms.every((term, index) => (index % 2 === 0 ? term.kind === 'value' : term.kind === 'op'));
  if (!shapeOk) {
    addProblem(state, first.place, `no media feature in ${quote(serialize(trimWhitespace(raw)))}`, 'invalid');
    return UNKNOWN;
  }
  let nameTerm: Term | undefined;
  const valueTerms: Term[] = [];
  if (terms.length === 3) {
    const [left, , right] = terms;
    if (termIdent(left) !== undefined) {
      nameTerm = left;
      if (right !== undefined) valueTerms.push(right);
    } else if (termIdent(right) !== undefined) {
      nameTerm = right;
      if (left !== undefined) valueTerms.push(left);
    }
  } else {
    const [left, op1, middle, op2, right] = terms;
    const one = op1?.kind === 'op' ? direction(op1.op) : 'eq';
    const two = op2?.kind === 'op' ? direction(op2.op) : 'eq';
    if (one === 'eq' || one !== two) {
      addProblem(
        state,
        op1?.place ?? first.place,
        'a range whose two comparisons do not both read `<` or both `>`',
        'invalid',
      );
      return UNKNOWN;
    }
    if (termIdent(middle) !== undefined) nameTerm = middle;
    if (left !== undefined) valueTerms.push(left);
    if (right !== undefined) valueTerms.push(right);
  }
  const nameValue = termIdent(nameTerm);
  if (!isIdent(nameValue)) {
    addProblem(state, first.place, 'a range without a feature name', 'invalid');
    return UNKNOWN;
  }
  const name = asciiLower(nameValue.value);
  const feature: MediaFeature = { name, form: 'range', value: [], negated: state.nots > 0, place: nameValue.place };
  state.result.features.push(feature);
  const known = lookupFeature(state, name);
  const values = valueTerms.flatMap((term) => (term.kind === 'value' ? term.values : []));
  if (known === undefined) unknownFeature(state, name, nameValue.place, values);
  else if (known.prefixed) {
    addProblem(
      state,
      nameValue.place,
      `${quote(name)} in a range: write ${quote(name.slice(4))} with \`<\` or \`>\``,
      'invalid',
    );
  } else if (known.kind.type === 'discrete')
    addProblem(state, nameValue.place, `${quote(name)} is no range feature`, 'invalid');
  else for (const term of valueTerms) if (term.kind === 'value') featureValue(state, name, known.kind, term.values);
  return { kind: 'feature', feature };
}

/** Parses one condition in brackets: `(hover)`, `((a) and (b))`, `(not (hover))`. */
function parseInParens(state: State, value: ComponentValue | undefined, depth: number, at: Place): Condition {
  if (value === undefined) {
    addProblem(state, at, 'a condition in brackets is missing', 'invalid');
    return UNKNOWN;
  }
  if (value.type !== 'block' || value.open !== '(') {
    unexpected(state, value);
    return UNKNOWN;
  }
  if (depth > MAX_DEPTH) {
    addProblem(state, value.place, `brackets deeper than ${MAX_DEPTH} levels`, 'policy');
    return UNKNOWN;
  }
  const items = solid(value.values);
  const first = items[0];
  state.parens += 1;
  const condition =
    first?.type === 'block' || (isIdent(first, 'not') && items[1]?.type === 'block')
      ? parseCondition(state, items, 0, true, depth + 1, value.place)
      : parseFeature(state, value);
  state.parens -= 1;
  return condition;
}

/**
 * Parses a condition that fills `items` from `start` to the end: `not <in-parens>`, or `<in-parens>` followed by
 * `and <in-parens>` or by `or <in-parens>` (not both). `or` only when `allowOr` (not after a media type).
 */
function parseCondition(
  state: State,
  items: readonly ComponentValue[],
  start: number,
  allowOr: boolean,
  depth: number,
  at: Place,
): Condition {
  const head = items[start];
  if (isIdent(head, 'not')) {
    state.nots += 1;
    const inner = parseInParens(state, items[start + 1], depth, head.place);
    state.nots -= 1;
    const after = items[start + 2];
    if (after !== undefined) {
      addProblem(state, after.place, `${quote(shortText(after))} after \`not ( … )\`: add brackets`, 'invalid');
      return UNKNOWN;
    }
    return { kind: 'not', inner };
  }
  const list: Condition[] = [parseInParens(state, head, depth, at)];
  let joiner: 'and' | 'or' | undefined;
  let index = start + 1;
  let valid = true;
  while (index < items.length) {
    const item = items[index];
    if (item === undefined) break;
    const word = isIdent(item) ? asciiLower(item.value) : '';
    if (word !== 'and' && word !== 'or') {
      addProblem(state, item.place, `${quote(shortText(item))} where \`and\` or \`or\` belongs`, 'invalid');
      return UNKNOWN;
    }
    if (word === 'or' && !allowOr) {
      addProblem(state, item.place, '`or` after a media type: add brackets', 'invalid');
      valid = false;
    } else if (joiner !== undefined && joiner !== word) {
      addProblem(state, item.place, '`and` and `or` mixed at one level: add brackets', 'invalid');
      valid = false;
    }
    joiner = word;
    const next = items[index + 1];
    if (isIdent(next, 'not')) {
      addProblem(state, next.place, `\`not\` after \`${word}\`: write \`${word} (not ( … ))\``, 'invalid');
      return UNKNOWN;
    }
    list.push(parseInParens(state, items[index + 1], depth, item.place));
    index += 2;
  }
  if (!valid) return UNKNOWN;
  const [only] = list;
  if (list.length === 1 && only !== undefined) return only;
  return { kind: joiner ?? 'and', items: list };
}

/** Parses one media query: `screen`, `not print`, `only screen and (hover)`, `(width >= 48rem) or (hover)`. */
function parseMediaQuery(state: State, items: readonly ComponentValue[], at: Place): Query {
  const head = items[0];
  const word = isIdent(head) ? asciiLower(head.value) : undefined;
  if (head === undefined) return { negated: false, condition: undefined, valid: true };
  // A media condition: `(…)` or `not (…)`.
  if (word === undefined || (word === 'not' && !isIdent(items[1]))) {
    return { negated: false, condition: parseCondition(state, items, 0, true, 0, at), valid: true };
  }
  let index = 0;
  const negated = word === 'not';
  if (word === 'not' || word === 'only') index = 1;
  const typeValue = items[index];
  if (!isIdent(typeValue)) {
    addProblem(state, head.place, `${quote(shortText(head))} without a media type`, 'invalid');
    return { negated, condition: undefined, valid: false };
  }
  const type = asciiLower(typeValue.value);
  if (RESERVED_TYPES.has(type)) {
    addProblem(state, typeValue.place, `${quote(typeValue.text)} where a media type belongs`, 'invalid');
    return { negated, condition: undefined, valid: false };
  }
  state.result.types.push({ name: type, place: typeValue.place });
  if (!MEDIA_TYPES.has(type)) {
    addProblem(state, typeValue.place, `the media type ${quote(type)} is not allowed (7.10)`, 'policy');
  }
  const joiner = items[index + 1];
  if (joiner === undefined) return { negated, condition: undefined, valid: true };
  if (!isIdent(joiner, 'and')) {
    addProblem(state, joiner.place, `${quote(shortText(joiner))} after a media type: write \`and\``, 'invalid');
    return { negated, condition: undefined, valid: false };
  }
  if (negated) state.nots += 1;
  const condition = parseCondition(state, items, index + 2, false, 0, joiner.place);
  if (negated) state.nots -= 1;
  return { negated, condition, valid: true };
}

/** One query of a container prelude: an optional container name (a problem, lead decision 3) and a condition. */
function parseContainerQuery(state: State, items: readonly ComponentValue[], at: Place): Query {
  const head = items[0];
  let start = 0;
  if (isIdent(head) && asciiLower(head.value) !== 'not') {
    addProblem(
      state,
      head.place,
      `the container name ${quote(head.text)}: a prelude queries the nearest container`,
      'policy',
    );
    start = 1;
    if (items.length === 1) return { negated: false, condition: undefined, valid: false };
  }
  state.named = start === 1;
  const condition = parseCondition(state, items, start, true, 0, head?.place ?? at);
  state.named = false;
  return { negated: false, condition, valid: true };
}

/** A whole prelude, parsed. `queries` holds one entry per comma part. */
interface Analysis {
  prelude: MediaPrelude;
  queries: Query[];
}

const START: Place = { offset: 0, line: 1, column: 1 };

/** Parses a prelude of either kind. `at` is the place for a problem of an empty prelude. */
function analyze(prelude: readonly ComponentValue[], kind: 'media' | 'container', at: Place): Analysis {
  const result: MediaPrelude = { kind, types: [], features: [], lengths: [], problems: [] };
  const state: State = {
    kind,
    features: kind === 'media' ? MEDIA_FEATURE_KINDS : CONTAINER_FEATURE_KINDS,
    result,
    nots: 0,
    count: 0,
    parens: 0,
    named: false,
  };
  findVars(state, prelude, 0);
  const queries: Query[] = [];
  const items = solid(prelude);
  if (items.length === 0) {
    if (kind === 'container') addProblem(state, prelude[0]?.place ?? at, 'an `@container` without a query', 'invalid');
    return { prelude: result, queries };
  }
  // Split at the top-level commas. An empty part reports right after the comma before it, the first one at the
  // comma after it: so each place lies inside its own part.
  const parts: { items: ComponentValue[]; at: Place }[] = [{ items: [], at: items[0]?.place ?? at }];
  for (const item of items) {
    if (item.type === 'comma') {
      if (kind === 'container' && parts.length === 1) {
        addProblem(state, item.place, 'a list of container queries: the minifier stops the build', 'policy');
      }
      parts.push({ items: [], at: { ...item.place, offset: item.place.offset + 1, column: item.place.column + 1 } });
    } else parts.at(-1)?.items.push(item);
  }
  for (const part of parts) {
    const before = state.count;
    if (part.items.length === 0) {
      addProblem(state, part.at, `an empty ${kind} query in a list`, 'invalid');
      queries.push({ negated: false, condition: undefined, valid: false });
      continue;
    }
    const query =
      kind === 'media' ? parseMediaQuery(state, part.items, part.at) : parseContainerQuery(state, part.items, part.at);
    // A query that gave a problem (a var() of findVars counts too) is no valid query.
    const own = state.count > before || hasVar(part.items, 0);
    queries.push({ ...query, valid: query.valid && !own });
  }
  result.problems.sort((a, b) => a.place.offset - b.place.offset);
  return { prelude: result, queries };
}

/** Says whether the values hold a `var()` at any depth. */
function hasVar(values: readonly ComponentValue[], depth: number): boolean {
  if (depth > MAX_DEPTH) return false;
  return values.some(
    (value) =>
      (value.type === 'function' && (value.name === 'var' || hasVar(value.args, depth + 1))) ||
      (value.type === 'block' && hasVar(value.values, depth + 1)),
  );
}

// The API

/** Parses the prelude of an @media rule, or an HTML `media` attribute after `parseValue` (7.10, modes-media). */
export function parseMediaPrelude(prelude: readonly ComponentValue[]): MediaPrelude {
  return analyze(prelude, 'media', START).prelude;
}

/** Parses the prelude of an @container rule (7.10). A container name is a problem (lead decision 3). */
export function parseContainerPrelude(prelude: readonly ComponentValue[]): MediaPrelude {
  return analyze(prelude, 'container', START).prelude;
}

/** The parsed prelude of an @media or @container at-rule; undefined for any other at-rule (@supports has no rule). */
export function preludeOf(rule: AtRule): MediaPrelude | undefined {
  if (rule.name === 'media') return analyze(rule.prelude, 'media', rule.place).prelude;
  if (rule.name === 'container') return analyze(rule.prelude, 'container', rule.place).prelude;
  return undefined;
}

/** The number and unit of a `## Breakpoints` width (`48rem`), or undefined when it is no single length. */
function widthOf(width: string): { value: number; unit: string } | undefined {
  const parsed = parseValue(width);
  const [only] = parsed.values;
  if (parsed.problems.length > 0 || parsed.values.length !== 1 || only === undefined) return undefined;
  const length = lengthOf(only, true);
  return length === undefined ? undefined : { value: length.value, unit: length.unit };
}

/** The largest integer that the minifier writes as it is (an `i32`). A larger one it writes as this. */
const MAX_MINIFIED_INTEGER = 2_147_483_647;

/** The significant digits that the minifier keeps of a number that is no integer. */
const MINIFIED_DIGITS = 6;

/**
 * The number that Lightning CSS writes for a length of a prelude (13.1 item 40): it stores the number as a 32-bit
 * float, writes an integer as it is (up to `MAX_MINIFIED_INTEGER`) and any other number with 6 significant digits.
 * `48.123456` gives `48.1235`, `1234567.5` gives `1234570`, `7654321.25` gives `7654321`. `undefined` for a number
 * beyond the range of a 32-bit float.
 */
export function minifiedWidth(value: number): number | undefined {
  const single = Math.fround(value);
  if (!Number.isFinite(single)) return undefined;
  if (Number.isInteger(single)) return Math.max(-MAX_MINIFIED_INTEGER, Math.min(MAX_MINIFIED_INTEGER, single));
  return Number(single.toPrecision(MINIFIED_DIGITS));
}

/** Says whether a length of a prelude equals a parsed width, in the form that the check reads. */
function equalsWidth(length: MediaLength, width: { value: number; unit: string }, form: CssForm): boolean {
  if (form === 'source') return width.value === length.value && width.unit === length.unit;
  // The minifier writes a zero length without its unit: `(width >= 0rem)` is built as `(width>=0)`.
  if (length.value === 0 && width.value === 0) return length.unit === '' || length.unit === width.unit;
  return width.unit === length.unit && minifiedWidth(width.value) === length.value;
}

/**
 * Says whether a length equals a `## Breakpoints` width (7.10), e.g. `48rem`: the same number and the same unit.
 * `48rem`, `48.0rem`, `+48rem` and `48REM` equal `48rem`; `768px`, `48px` and `3em` do not. With `form` `built`,
 * the length comes from built CSS and equals the minifier's form of the width: `0` equals `0rem`, and `48.1235rem`
 * equals `48.123456rem`.
 */
export function sameLength(length: MediaLength, width: string, form: CssForm = 'source'): boolean {
  const parsed = widthOf(width);
  return parsed !== undefined && equalsWidth(length, parsed, form);
}

/** A problem for each length that equals no breakpoint (css-media, 7.10), in the form that `sameLength` reads. */
export function lengthProblems(
  prelude: MediaPrelude,
  breakpoints: readonly Pick<Breakpoint, 'width'>[],
  form: CssForm = 'source',
): ParseProblem[] {
  const widths = breakpoints.flatMap((breakpoint) => {
    const parsed = widthOf(breakpoint.width);
    return parsed === undefined ? [] : [parsed];
  });
  const declared = breakpoints.map((breakpoint) => breakpoint.width).join(', ');
  const problems: ParseProblem[] = [];
  for (const length of prelude.lengths) {
    if (widths.some((width) => equalsWidth(length, width, form))) continue;
    if (problems.length >= MAX_PROBLEMS) break;
    problems.push({
      message: `the length ${quote(length.text)} equals no breakpoint width (${declared === '' ? 'none declared' : declared})`,
      place: length.place,
    });
  }
  return problems;
}

/** The features that read the mode: prefers-color-scheme and prefers-contrast (modes-media, 7.12). css-media does not report them. */
export function modeFeatures(prelude: MediaPrelude): MediaFeature[] {
  return prelude.features.filter((feature) => MODE_FEATURES.has(feature.name));
}

/** Says whether a feature is `(forced-colors: active)` or `(forced-colors)`, or `(forced-colors: none)`. */
function forcedColors(feature: MediaFeature): 'active' | 'none' | undefined {
  if (feature.name !== 'forced-colors') return undefined;
  if (feature.form === 'boolean') return 'active';
  if (feature.form !== 'plain' || feature.value.length !== 1) return undefined;
  const [value] = feature.value;
  if (isIdent(value, 'active')) return 'active';
  if (isIdent(value, 'none')) return 'none';
  return undefined;
}

/**
 * Says whether a condition implies forced colors (`truth` true), or whether its negation does (`truth` false).
 * The depth is that of the prelude's brackets, so the recursion is bounded.
 */
function implies(condition: Condition, truth: boolean): boolean {
  switch (condition.kind) {
    case 'feature':
      return forcedColors(condition.feature) === (truth ? 'active' : 'none');
    case 'not':
      return implies(condition.inner, !truth);
    case 'and':
      // A and B implies X when one part does; not (A and B) implies X when every not-part does.
      return truth
        ? condition.items.some((item) => implies(item, true))
        : condition.items.every((item) => implies(item, false));
    case 'or':
      return truth
        ? condition.items.every((item) => implies(item, true))
        : condition.items.some((item) => implies(item, false));
    default:
      return false;
  }
}

/**
 * True when one of the at-rules is an @media whose every query requires `(forced-colors: active)` (7.3,
 * `LiteralContext.forcedColors` of values.ts): the feature stands in the query's and-chain, not under `not` and not in
 * an `or` with a part that lacks it. `not (forced-colors: none)` requires it too, since the feature has only the two
 * values. A query with a problem, an empty prelude and a `not <type>` query require nothing.
 */
export function requiresForcedColors(atRules: readonly AtRule[]): boolean {
  return atRules.some((rule) => {
    if (rule.name !== 'media') return false;
    const { queries } = analyze(rule.prelude, 'media', rule.place);
    return (
      queries.length > 0 &&
      queries.every(
        (query) => query.valid && !query.negated && query.condition !== undefined && implies(query.condition, true),
      )
    );
  });
}

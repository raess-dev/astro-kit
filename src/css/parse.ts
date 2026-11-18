/**
 * The CSS parser of the kit (specification, 3.2): a tokenizer after CSS Syntax Level 3, and a parser that gives a
 * tree with a place for every node. Every `css-*` rule reads CSS through this module, source CSS and built CSS alike.
 *
 * - **Source CSS** is what a project writes: comments, nesting, `@layer` blocks, `@media`, `@container`, `@supports`,
 *   `@starting-style`, `@keyframes` and `@font-face`.
 * - **Built CSS** is what the minifier (Lightning CSS) writes into a page (13.1 items 3, 4 and 40): no white space
 *   where none is needed, `.5` for `0.5`, short hex colors, `:before` for `::before`, `@layer` statements in parts,
 *   and nesting kept with an explicit `&` or flattened.
 *
 * The parser never throws. A text that is not CSS gives a parse problem with a place, and the parser goes on with
 * the rest, as a browser does. A browser drops what such a problem names, so a rule can report each problem. The
 * tree is the tree of a browser (CSS Syntax Level 3; `css-oracle.test.ts` compares it with Chromium's CSSOM):
 *
 * - In a list of rules (the top level, a group at-rule there, the block of `@keyframes`) a `;` does not end a rule.
 *   It stands in the prelude, and the rule is dropped with its block. So is a rule whose prelude starts with
 *   `--name:`.
 * - A bracket without its partner is a delimiter token in its place: the value or the prelude that holds it is no
 *   valid CSS.
 * - In a list of declarations (`@font-face`, a keyframe) a text that is no declaration is skipped up to its next `;`.
 * - A name and a colon start a declaration when a `{}` block is its whole value; with any other value beside a
 *   block the text is a nested rule. The block of `@scope` holds declarations and rules, as a style rule does.
 * - U+0000 reads as U+FFFD, a character of a name.
 * - A byte order mark (U+FEFF) at the start is no text, as CSS Syntax Level 3 (3.2) decodes a style sheet. The
 *   places still count it, so they match the file.
 *
 * The parser is strict where CSS is strict:
 *
 * - Only CSS white space separates tokens: space, tab, line feed, carriage return and form feed. Any other character,
 *   U+00A0 too, is a character of a name.
 * - A name takes every name character after it: `#000-1px` is one hash, and `1px_` is a number with the unit `px_`.
 * - A control character other than white space, a lone surrogate, an open string, comment or `url(`, a bracket
 *   without its partner, a declaration outside a rule and a rule without a block are parse problems.
 * - Brackets and rules nest at most `MAX_DEPTH` levels deep. Deeper content is a problem, and the parser skips it.
 *
 * The tables of this module and of the modules that read its tree are maps and sets, never plain objects looked up
 * with a name from the input: `constructor` and `__proto__` find nothing.
 */

// Places and problems

/** A place in the text. `line` and `column` count from 1; the column counts UTF-16 code units. */
export interface Place {
  /** The offset in the text, from 0. */
  offset: number;
  line: number;
  column: number;
}

/** A part of the text that is not CSS. A browser drops what it names. */
export interface ParseProblem {
  message: string;
  place: Place;
}

/** The deepest nesting of brackets and blocks, together. Deeper content is a problem and is skipped. */
export const MAX_DEPTH = 32;

/** The most problems that one text gives: the first ones in the order of the text. */
export const MAX_PROBLEMS = 100;

/**
 * The most complex selectors that one nested rule resolves to. Nesting multiplies the selectors of a list with those
 * of its parent. Beyond this count the parent list stands as one `:is()` (7.1).
 */
export const MAX_RESOLVED_SELECTORS = 64;

/** The most component values in one resolved selector. A larger one is a problem, and the rule has no resolved list. */
export const MAX_RESOLVED_SIZE = 4096;

/**
 * The most component values in all resolved selectors of one text together. Beyond it, a nested rule is a problem
 * and has no resolved list. The parser stops building a rule's selectors as soon as they pass what is left, so no
 * text makes the parser or a rule that reads the selectors build more than this.
 */
export const MAX_RESOLVED_TOTAL = 1_000_000;

// Tokens

/** The sign that a number was written with: `+1` has `+`, `1` has none. */
export type Sign = '+' | '-' | '';

interface TokenBase {
  place: Place;
  /** The text of the token as written, escapes included. */
  text: string;
}

/** A name: `red`, `--menu`, `a\:b` (the value is `a:b`). */
export interface IdentToken extends TokenBase {
  type: 'ident';
  /** The name with escapes resolved, in the case it was written. */
  value: string;
}

/** `@media`: the value is `media`, with escapes resolved and in the case it was written. */
export interface AtKeywordToken extends TokenBase {
  type: 'at-keyword';
  value: string;
}

/** `#fff` or `#hero`. */
export interface HashToken extends TokenBase {
  type: 'hash';
  /** The name after `#`, with escapes resolved. */
  value: string;
  /** True when the name would start an identifier, as in an id selector: `#hero`, not `#0f0`. */
  id: boolean;
}

/** A quoted string. */
export interface StringToken extends TokenBase {
  type: 'string';
  /** The text between the quotes, with escapes resolved. */
  value: string;
}

/** An unquoted `url(…)`. A quoted one is a function `url` with a string argument. */
export interface UrlToken extends TokenBase {
  type: 'url';
  value: string;
}

interface NumericBase extends TokenBase {
  /** The number. A number beyond the range of a double is `Infinity` or `-Infinity`. */
  value: number;
  /** True when the number has no `.` and no exponent. */
  integer: boolean;
  sign: Sign;
}

export interface NumberToken extends NumericBase {
  type: 'number';
}

export interface PercentageToken extends NumericBase {
  type: 'percentage';
}

export interface DimensionToken extends NumericBase {
  type: 'dimension';
  /** The unit with escapes resolved, in ASCII lower case: `1PX` has the unit `px`. Other letters keep their case. */
  unit: string;
}

/** One character that is no other token: `.`, `>`, `+`, `~`, `*`, `&`, `!`, `/`, `=`, `|`, `$`, `^` and so on. */
export interface DelimToken extends TokenBase {
  type: 'delim';
  value: string;
}

/** A token with no value. White space in a run is one token, also across a comment. */
export interface PlainToken extends TokenBase {
  type: 'whitespace' | 'colon' | 'semicolon' | 'comma' | 'cdo' | 'cdc';
}

export type Token =
  | IdentToken
  | AtKeywordToken
  | HashToken
  | StringToken
  | UrlToken
  | NumberToken
  | PercentageToken
  | DimensionToken
  | DelimToken
  | PlainToken;

/** A function with its arguments: `var(--space-2)`, `:is(.a, .b)` (the colon is a token before it). */
export interface FunctionValue {
  type: 'function';
  /** The name with escapes resolved, in ASCII lower case: `VAR(` and `v\61r(` are `var`. */
  name: string;
  /** The name as written, without `(`. */
  text: string;
  /** The component values between the brackets, white space included. */
  args: ComponentValue[];
  place: Place;
}

/** A block in brackets: `(width >= 48rem)`, `[aria-current="page"]`. */
export interface BlockValue {
  type: 'block';
  open: '(' | '[' | '{';
  values: ComponentValue[];
  place: Place;
}

/** One component value of CSS Syntax Level 3: a token, a function or a block. */
export type ComponentValue = Token | FunctionValue | BlockValue;

// The tree

/** An at-rule: `@media (width >= 48rem) { … }`, `@layer a, b;`. */
export interface AtRule {
  type: 'at-rule';
  /** The name with escapes resolved, in ASCII lower case, without `@`. */
  name: string;
  /** The prelude, without white space at its two ends. */
  prelude: ComponentValue[];
  /** The rules and declarations of the block. An at-rule with no block, such as `@layer a, b;`, has `undefined`. */
  block: CssNode[] | undefined;
  place: Place;
}

/**
 * A qualified rule. `style` is a style rule. `keyframe` is a rule of `@keyframes`, whose selectors are `from`, `to`
 * and percentages.
 */
export interface Rule {
  type: 'rule';
  kind: 'style' | 'keyframe';
  /** The prelude, without white space at its two ends. */
  prelude: ComponentValue[];
  /** The prelude split at its top-level commas: one complex selector each, without white space at its ends. */
  selectors: ComponentValue[][];
  /**
   * Each complex selector after nesting (7.1: "each nested rule is checked as its resolved selector").
   *
   * - A rule with no enclosing style rule has its own `selectors`.
   * - A nested rule without `&`, or one that starts with a combinator, is relative: `.b`, `> .b` and `+ &` in `.a`
   *   give `.a .b`, `.a > .b` and `.a + .a`.
   * - An `&` takes the parent selector in its place when that keeps the meaning: at the start of the selector
   *   (`&:hover` gives `.a:hover`, `& .b` gives `.a .b`), or when the parent is one compound (`.b &` in `.a`
   *   gives `.b .a`). Otherwise it becomes `:is(<parent>)`, as CSS Nesting defines it.
   * - A parent list multiplies: `.a, .b { & .c {} }` gives `.a .c` and `.b .c`. Beyond `MAX_RESOLVED_SELECTORS`,
   *   for a selector with two or more `&`, and for an `&` inside a function (`:not(&)`), the parent list stands as
   *   one `:is(.a, .b)`. Inside `:has()`, a parent that holds `:has()` stands as `:is(<parent>)` too.
   * - A keyframe rule has its own `selectors`. A rule whose resolved selector would be larger than
   *   `MAX_RESOLVED_SIZE` has none, and a problem.
   *
   * The values of the parent are shared, not copied: their places point at the parent rule.
   */
  resolved: ComponentValue[][];
  /** The rules, at-rules and declarations of the block. */
  children: CssNode[];
  place: Place;
}

/** A declaration: `color: var(--color-text)`, `display: none !important`. */
export interface Declaration {
  type: 'declaration';
  /** A custom property (`--x`) as written, every other property in ASCII lower case. */
  property: string;
  /** The value without `!important` and without white space at its two ends. */
  value: ComponentValue[];
  important: boolean;
  place: Place;
}

export type CssNode = AtRule | Rule | Declaration;

/** One parsed text. */
export interface Stylesheet {
  type: 'stylesheet';
  /** The file or page that the text comes from, as the caller named it. */
  file: string;
  nodes: CssNode[];
  /** The parse problems, in the order of the text. At most `MAX_PROBLEMS`. */
  problems: ParseProblem[];
}

// Characters

const TAB = 0x09;
const LINE_FEED = 0x0a;
const LINE_TABULATION = 0x0b;
const FORM_FEED = 0x0c;
const CARRIAGE_RETURN = 0x0d;
const SPACE = 0x20;
const QUOTATION_MARK = 0x22;
const NUMBER_SIGN = 0x23;
const PERCENT = 0x25;
const APOSTROPHE = 0x27;
const LEFT_PARENTHESIS = 0x28;
const RIGHT_PARENTHESIS = 0x29;
const ASTERISK = 0x2a;
const PLUS = 0x2b;
const COMMA = 0x2c;
const HYPHEN = 0x2d;
const FULL_STOP = 0x2e;
const SOLIDUS = 0x2f;
const DIGIT_ZERO = 0x30;
const DIGIT_NINE = 0x39;
const COLON = 0x3a;
const SEMICOLON = 0x3b;
const LESS_THAN = 0x3c;
const COMMERCIAL_AT = 0x40;
const LATIN_CAPITAL_A = 0x41;
const LATIN_CAPITAL_E = 0x45;
const LATIN_CAPITAL_F = 0x46;
const LATIN_CAPITAL_Z = 0x5a;
const LEFT_SQUARE_BRACKET = 0x5b;
const REVERSE_SOLIDUS = 0x5c;
const RIGHT_SQUARE_BRACKET = 0x5d;
const LOW_LINE = 0x5f;
const LATIN_SMALL_A = 0x61;
const LATIN_SMALL_E = 0x65;
const LATIN_SMALL_F = 0x66;
const LATIN_SMALL_Z = 0x7a;
const LEFT_CURLY_BRACKET = 0x7b;
const RIGHT_CURLY_BRACKET = 0x7d;
const DELETE = 0x7f;
const FIRST_NON_ASCII = 0x80;
const REPLACEMENT_CHARACTER = '�';
const BYTE_ORDER_MARK = 0xfeff;
const MAX_CODE_POINT = 0x10ffff;
const HIGH_SURROGATE_FIRST = 0xd800;
const HIGH_SURROGATE_LAST = 0xdbff;
const LOW_SURROGATE_FIRST = 0xdc00;
const LOW_SURROGATE_LAST = 0xdfff;
const MAX_HEX_DIGITS = 6;
const HEX = 16;
const ASCII_CASE_OFFSET = 0x20;

/** `NaN` stands for the end of the text: no test below holds for it. */
const END = Number.NaN;

const isNewline = (code: number): boolean => code === LINE_FEED || code === CARRIAGE_RETURN || code === FORM_FEED;
/** The white space of CSS: space, tab, line feed, carriage return and form feed. Nothing else. */
const isWhitespaceCode = (code: number): boolean => code === SPACE || code === TAB || isNewline(code);
const isDigit = (code: number): boolean => code >= DIGIT_ZERO && code <= DIGIT_NINE;
const isHexDigit = (code: number): boolean =>
  isDigit(code) ||
  (code >= LATIN_CAPITAL_A && code <= LATIN_CAPITAL_F) ||
  (code >= LATIN_SMALL_A && code <= LATIN_SMALL_F);
const isLetter = (code: number): boolean =>
  (code >= LATIN_CAPITAL_A && code <= LATIN_CAPITAL_Z) || (code >= LATIN_SMALL_A && code <= LATIN_SMALL_Z);
/** A code point that may start a name: a letter, `_` or any non-ASCII code point (CSS Syntax Level 3). */
const isNameStart = (code: number): boolean => isLetter(code) || code === LOW_LINE || code >= FIRST_NON_ASCII;
const isNameCode = (code: number): boolean => isNameStart(code) || isDigit(code) || code === HYPHEN;
/** A control character that no CSS text holds: C0 controls other than white space, and DEL. */
const isControl = (code: number): boolean => (code < SPACE && !isWhitespaceCode(code)) || code === DELETE;
/** A code point that ends an unquoted `url(` as a bad URL. */
const isNonPrintable = (code: number): boolean =>
  (code >= 0 && code <= 0x08) || code === LINE_TABULATION || (code >= 0x0e && code <= 0x1f) || code === DELETE;

/** ASCII lower case: only `A` to `Z` change. CSS keywords and units compare in this way, never with Unicode rules. */
export function asciiLower(text: string): string {
  let out = '';
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    out +=
      code >= LATIN_CAPITAL_A && code <= LATIN_CAPITAL_Z ? String.fromCharCode(code + ASCII_CASE_OFFSET) : text[index];
  }
  return out;
}

// Problems

interface Problems {
  list: ParseProblem[];
  add(offset: number, message: string): void;
}

/** The offsets where each line starts. CR LF is one line break, and CR, LF and FF are each one alone. */
function lineStarts(text: string): number[] {
  const starts = [0];
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code === CARRIAGE_RETURN && text.charCodeAt(index + 1) === LINE_FEED) index += 1;
    if (isNewline(code)) starts.push(index + 1);
  }
  return starts;
}

/** A function that gives the place of an offset. */
function placer(text: string): (offset: number) => Place {
  const starts = lineStarts(text);
  return (offset) => {
    let low = 0;
    let high = starts.length - 1;
    while (low < high) {
      const middle = (low + high + 1) >> 1;
      if ((starts[middle] ?? 0) <= offset) low = middle;
      else high = middle - 1;
    }
    return { offset, line: low + 1, column: offset - (starts[low] ?? 0) + 1 };
  };
}

/** The problems in the order of the text. */
const inOrder = (list: ParseProblem[]): ParseProblem[] => list.sort((a, b) => a.place.offset - b.place.offset);

/**
 * The problem list of one text. It keeps the `MAX_PROBLEMS` problems that come first in the text, whatever order
 * they are found in: a later problem pushes out the last one in the text. One `add` costs at most `MAX_PROBLEMS`
 * steps, and no step when the new problem comes after all that the list holds.
 */
function problemsOf(place: (offset: number) => Place): Problems {
  const list: ParseProblem[] = [];
  /** The index of the problem that comes last in the text, once the list is full. */
  let last = -1;
  const findLast = (): number => {
    let found = 0;
    list.forEach((problem, index) => {
      if (problem.place.offset >= (list[found]?.place.offset ?? 0)) found = index;
    });
    return found;
  };
  return {
    list,
    add(offset, message) {
      if (list.length < MAX_PROBLEMS) {
        list.push({ message, place: place(offset) });
        if (list.length === MAX_PROBLEMS) last = findLast();
        return;
      }
      if (offset >= (list[last]?.place.offset ?? 0)) return;
      list[last] = { message, place: place(offset) };
      last = findLast();
    },
  };
}

// The tokenizer

type OpenChar = '(' | '[' | '{';
type CloseChar = ')' | ']' | '}';

/** One item of the token stream: a token, or a bracket. A function token is an open bracket with a name. */
type Lexeme =
  | { kind: 'token'; token: Token }
  | { kind: 'open'; char: OpenChar; place: Place; name: string | undefined; text: string }
  | { kind: 'close'; char: CloseChar; place: Place };

const CLOSER: ReadonlyMap<OpenChar, CloseChar> = new Map<OpenChar, CloseChar>([
  ['(', ')'],
  ['[', ']'],
  ['{', '}'],
]);

/**
 * Cuts the text into tokens as CSS Syntax Level 3 does (section 4). Comments go, and a run of white space is one
 * token. The stream keeps the brackets as `open` and `close` items; `pair` matches them later.
 */
function tokenize(original: string, place: (offset: number) => Place, problems: Problems): Lexeme[] {
  // CSS reads U+0000 as U+FFFD, a character of a name (CSS Syntax Level 3, 3.3). The length stays the same. The
  // values of tokens come from this text, and the `text` of each token from the original, as written.
  const text = original.replaceAll('\u0000', REPLACEMENT_CHARACTER);
  const out: Lexeme[] = [];
  // A byte order mark at the start is no text (CSS Syntax Level 3, 3.2). Starting after it keeps the places right.
  let at = original.charCodeAt(0) === BYTE_ORDER_MARK ? 1 : 0;
  const code = (offset: number): number => (offset < text.length ? text.charCodeAt(offset) : END);

  // Each control character and each lone surrogate is a problem of its own.
  for (let index = 0; index < original.length; index += 1) {
    const unit = original.charCodeAt(index);
    if (isControl(unit)) problems.add(index, `the control character U+${unit.toString(HEX).padStart(4, '0')}`);
    else if (unit >= HIGH_SURROGATE_FIRST && unit <= HIGH_SURROGATE_LAST) {
      const next = text.charCodeAt(index + 1);
      if (next >= LOW_SURROGATE_FIRST && next <= LOW_SURROGATE_LAST) index += 1;
      else problems.add(index, 'a lone surrogate');
    } else if (unit >= LOW_SURROGATE_FIRST && unit <= LOW_SURROGATE_LAST) problems.add(index, 'a lone surrogate');
  }

  /** Two code points that start a valid escape: a backslash and no newline after it. */
  const isEscape = (offset: number): boolean => code(offset) === REVERSE_SOLIDUS && !isNewline(code(offset + 1));

  /** Three code points that would start a name. */
  const startsName = (offset: number): boolean => {
    const first = code(offset);
    if (first === HYPHEN) {
      const second = code(offset + 1);
      return isNameStart(second) || second === HYPHEN || isEscape(offset + 1);
    }
    return isNameStart(first) || isEscape(offset);
  };

  /** Three code points that would start a number. */
  const startsNumber = (offset: number): boolean => {
    let first = code(offset);
    let next = offset;
    if (first === PLUS || first === HYPHEN) {
      next += 1;
      first = code(next);
    }
    if (isDigit(first)) return true;
    return first === FULL_STOP && isDigit(code(next + 1));
  };

  /** Consumes an escape after its backslash, and gives the code point as a string. */
  const readEscape = (): string => {
    if (at >= text.length) {
      problems.add(at - 1, 'a backslash at the end of the text');
      return REPLACEMENT_CHARACTER;
    }
    if (isHexDigit(code(at))) {
      let digits = 0;
      let value = 0;
      while (digits < MAX_HEX_DIGITS && isHexDigit(code(at))) {
        value = value * HEX + Number.parseInt(text.charAt(at), HEX);
        digits += 1;
        at += 1;
      }
      if (code(at) === CARRIAGE_RETURN && code(at + 1) === LINE_FEED) at += 2;
      else if (isWhitespaceCode(code(at))) at += 1;
      const surrogate = value >= HIGH_SURROGATE_FIRST && value <= LOW_SURROGATE_LAST;
      return value === 0 || surrogate || value > MAX_CODE_POINT ? REPLACEMENT_CHARACTER : String.fromCodePoint(value);
    }
    const point = text.codePointAt(at) ?? 0;
    const char = String.fromCodePoint(point);
    at += char.length;
    return char;
  };

  /** Consumes a name: every name code point and escape. */
  const name = (): string => {
    let value = '';
    while (at < text.length) {
      const unit = code(at);
      if (isNameCode(unit)) {
        value += text.charAt(at);
        at += 1;
      } else if (isEscape(at)) {
        at += 1;
        value += readEscape();
      } else break;
    }
    return value;
  };

  const push = (token: Token): void => {
    out.push({ kind: 'token', token });
  };

  const number = (start: number): void => {
    if (code(at) === PLUS || code(at) === HYPHEN) at += 1;
    while (isDigit(code(at))) at += 1;
    let integer = true;
    if (code(at) === FULL_STOP && isDigit(code(at + 1))) {
      integer = false;
      at += 1;
      while (isDigit(code(at))) at += 1;
    }
    const e = code(at);
    if (e === LATIN_CAPITAL_E || e === LATIN_SMALL_E) {
      const sign = code(at + 1);
      const signed = sign === PLUS || sign === HYPHEN;
      if (isDigit(code(at + (signed ? 2 : 1)))) {
        integer = false;
        at += signed ? 2 : 1;
        while (isDigit(code(at))) at += 1;
      }
    }
    const repr = text.slice(start, at);
    const value = Number(repr);
    const first = repr.charAt(0);
    const sign: Sign = first === '+' || first === '-' ? first : '';
    const base = { value, integer, sign };
    if (startsName(at)) {
      const unit = asciiLower(name());
      push({ type: 'dimension', ...base, unit, place: place(start), text: original.slice(start, at) });
    } else if (code(at) === PERCENT) {
      at += 1;
      push({ type: 'percentage', ...base, place: place(start), text: original.slice(start, at) });
    } else push({ type: 'number', ...base, place: place(start), text: repr });
  };

  /** Consumes the rest of a bad URL: everything up to `)` or the end, escapes included. */
  const badUrlRest = (): void => {
    while (at < text.length) {
      if (code(at) === RIGHT_PARENTHESIS) {
        at += 1;
        return;
      }
      if (isEscape(at)) {
        at += 1;
        readEscape();
      } else at += 1;
    }
  };

  /** Consumes an unquoted URL after `url(` and the white space after it. */
  const url = (start: number): void => {
    let value = '';
    let ended = false;
    while (!ended && at < text.length) {
      const unit = code(at);
      if (unit === RIGHT_PARENTHESIS) {
        at += 1;
        ended = true;
      } else if (isWhitespaceCode(unit)) {
        while (isWhitespaceCode(code(at))) at += 1;
        if (code(at) !== RIGHT_PARENTHESIS && at < text.length) {
          problems.add(start, 'white space inside an unquoted `url()`');
          badUrlRest();
          ended = true;
        }
      } else if (unit === QUOTATION_MARK || unit === APOSTROPHE || unit === LEFT_PARENTHESIS || isNonPrintable(unit)) {
        problems.add(at, 'a quote, a bracket or a control character inside an unquoted `url()`');
        badUrlRest();
        ended = true;
      } else if (unit === REVERSE_SOLIDUS && !isEscape(at)) {
        problems.add(at, 'a backslash before a newline inside `url()`');
        badUrlRest();
        ended = true;
      } else if (unit === REVERSE_SOLIDUS) {
        at += 1;
        value += readEscape();
      } else {
        value += text.charAt(at);
        at += 1;
      }
    }
    if (!ended) problems.add(start, '`url(` without its `)`');
    push({ type: 'url', value, place: place(start), text: original.slice(start, at) });
  };

  const identLike = (start: number): void => {
    const value = name();
    if (code(at) !== LEFT_PARENTHESIS) {
      push({ type: 'ident', value, place: place(start), text: original.slice(start, at) });
      return;
    }
    const lower = asciiLower(value);
    if (lower === 'url') {
      let after = at + 1;
      while (isWhitespaceCode(code(after))) after += 1;
      const next = code(after);
      if (next !== QUOTATION_MARK && next !== APOSTROPHE) {
        at = after;
        url(start);
        return;
      }
    }
    const nameText = original.slice(start, at);
    at += 1;
    out.push({ kind: 'open', char: '(', place: place(start), name: lower, text: nameText });
  };

  const string = (start: number, quote: number): void => {
    at += 1;
    let value = '';
    let ended = false;
    while (!ended && at < text.length) {
      const unit = code(at);
      const next = code(at + 1);
      if (unit === quote) {
        at += 1;
        ended = true;
      } else if (isNewline(unit)) {
        problems.add(start, 'a string that a newline ends');
        ended = true;
      } else if (unit === REVERSE_SOLIDUS && at + 1 >= text.length) {
        at += 1;
      } else if (unit === REVERSE_SOLIDUS && isNewline(next)) {
        at += next === CARRIAGE_RETURN && code(at + 2) === LINE_FEED ? 3 : 2;
      } else if (unit === REVERSE_SOLIDUS) {
        at += 1;
        value += readEscape();
      } else {
        value += text.charAt(at);
        at += 1;
      }
    }
    if (!ended) problems.add(start, 'a string without its closing quote');
    push({ type: 'string', value, place: place(start), text: original.slice(start, at) });
  };

  const plain = (type: PlainToken['type'], start: number, length: number): void => {
    at = start + length;
    push({ type, place: place(start), text: original.slice(start, at) });
  };

  const delim = (start: number): void => {
    const char = String.fromCodePoint(text.codePointAt(start) ?? 0);
    at = start + char.length;
    push({ type: 'delim', value: char, place: place(start), text: char });
  };

  while (at < text.length) {
    const start = at;
    const unit = code(at);
    if (unit === SOLIDUS && code(at + 1) === ASTERISK) {
      const end = text.indexOf('*/', at + 2);
      if (end < 0) {
        problems.add(start, 'a comment without its `*/`');
        at = text.length;
      } else at = end + 2;
      continue;
    }
    if (isWhitespaceCode(unit)) {
      while (isWhitespaceCode(code(at))) at += 1;
      const last = out.at(-1);
      if (last?.kind === 'token' && last.token.type === 'whitespace') {
        last.token.text = original.slice(last.token.place.offset, at);
      } else push({ type: 'whitespace', place: place(start), text: original.slice(start, at) });
      continue;
    }
    if (unit === QUOTATION_MARK || unit === APOSTROPHE) string(start, unit);
    else if (unit === NUMBER_SIGN) {
      if (isNameCode(code(at + 1)) || isEscape(at + 1)) {
        at += 1;
        const id = startsName(at);
        const value = name();
        push({ type: 'hash', value, id, place: place(start), text: original.slice(start, at) });
      } else delim(start);
    } else if (unit === LEFT_PARENTHESIS || unit === LEFT_SQUARE_BRACKET || unit === LEFT_CURLY_BRACKET) {
      at += 1;
      const char: OpenChar = unit === LEFT_PARENTHESIS ? '(' : unit === LEFT_SQUARE_BRACKET ? '[' : '{';
      out.push({ kind: 'open', char, place: place(start), name: undefined, text: '' });
    } else if (unit === RIGHT_PARENTHESIS || unit === RIGHT_SQUARE_BRACKET || unit === RIGHT_CURLY_BRACKET) {
      at += 1;
      const char: CloseChar = unit === RIGHT_PARENTHESIS ? ')' : unit === RIGHT_SQUARE_BRACKET ? ']' : '}';
      out.push({ kind: 'close', char, place: place(start) });
    } else if (unit === PLUS || unit === FULL_STOP) {
      if (startsNumber(at)) number(start);
      else delim(start);
    } else if (unit === HYPHEN) {
      if (startsNumber(at)) number(start);
      else if (text.startsWith('-->', at)) plain('cdc', start, 3);
      else if (startsName(at)) identLike(start);
      else delim(start);
    } else if (unit === COMMA) plain('comma', start, 1);
    else if (unit === COLON) plain('colon', start, 1);
    else if (unit === SEMICOLON) plain('semicolon', start, 1);
    else if (unit === LESS_THAN && text.startsWith('<!--', at)) plain('cdo', start, 4);
    else if (unit === COMMERCIAL_AT) {
      if (startsName(at + 1)) {
        at += 1;
        const value = name();
        push({ type: 'at-keyword', value, place: place(start), text: original.slice(start, at) });
      } else delim(start);
    } else if (unit === REVERSE_SOLIDUS) {
      if (isEscape(at)) identLike(start);
      else {
        problems.add(start, 'a backslash before a newline');
        delim(start);
      }
    } else if (isDigit(unit)) number(start);
    else if (isNameStart(unit)) identLike(start);
    else delim(start);
  }
  return out;
}

/**
 * Matches the brackets of the stream. `match[i]` is the index of the closing bracket of the open bracket `i`, or the
 * length of the stream when it has none. As in CSS, a closing bracket that is not the partner of the innermost open
 * one is no bracket: it is a problem, and it becomes a delimiter token in its place. So a value or a prelude that
 * holds it is no valid CSS, and a browser drops it too.
 */
function pair(lexemes: Lexeme[], problems: Problems): Int32Array {
  const match = new Int32Array(lexemes.length).fill(lexemes.length);
  const stack: number[] = [];
  lexemes.forEach((lexeme, index) => {
    if (lexeme.kind === 'open') stack.push(index);
    else if (lexeme.kind === 'close') {
      const top = stack.at(-1);
      const open = top === undefined ? undefined : lexemes[top];
      if (top !== undefined && open?.kind === 'open' && CLOSER.get(open.char) === lexeme.char) {
        match[top] = index;
        stack.pop();
      } else {
        problems.add(lexeme.place.offset, `\`${lexeme.char}\` without its opening bracket`);
        const { char, place } = lexeme;
        lexemes[index] = { kind: 'token', token: { type: 'delim', value: char, place, text: char } };
      }
    }
  });
  for (const index of stack) {
    const open = lexemes[index];
    if (open?.kind !== 'open') continue;
    const what = open.name === undefined ? `\`${open.char}\`` : `\`${open.text}(\``;
    problems.add(open.place.offset, `${what} without its \`${CLOSER.get(open.char) ?? ''}\``);
  }
  return match;
}

// Helpers on component values

/** Says whether the value is white space. */
export const isWhitespace = (value: ComponentValue | undefined): boolean => value?.type === 'whitespace';

/** Says whether the value is the delimiter `char`. */
export const isDelim = (value: ComponentValue | undefined, char: string): value is DelimToken =>
  value?.type === 'delim' && value.value === char;

/** Says whether the value is an identifier, and with `name`, that name in any ASCII case. */
export const isIdent = (value: ComponentValue | undefined, name?: string): value is IdentToken =>
  value?.type === 'ident' && (name === undefined || asciiLower(value.value) === asciiLower(name));

/** Says whether the value is a function, and with `name`, the function of that name (in lower case). */
export const isFunction = (value: ComponentValue | undefined, name?: string): value is FunctionValue =>
  value?.type === 'function' && (name === undefined || value.name === name);

/** The values without white space at their two ends. */
export function trimWhitespace(values: readonly ComponentValue[]): ComponentValue[] {
  let start = 0;
  let end = values.length;
  while (start < end && isWhitespace(values[start])) start += 1;
  while (end > start && isWhitespace(values[end - 1])) end -= 1;
  return values.slice(start, end);
}

/** The values split at their top-level commas, each part trimmed. An empty list gives one empty part. */
export function splitCommas(values: readonly ComponentValue[]): ComponentValue[][] {
  const parts: ComponentValue[][] = [[]];
  for (const value of values) {
    if (value.type === 'comma') parts.push([]);
    else parts.at(-1)?.push(value);
  }
  return parts.map(trimWhitespace);
}

const CLOSE_OF: ReadonlyMap<BlockValue['open'], string> = new Map([
  ['(', ')'],
  ['[', ']'],
  ['{', '}'],
]);

/**
 * The text of component values. Each token keeps its text as written, a run of white space is one space, and a
 * function and a block get their brackets. A comment is gone, so `a/**\/b` gives `ab`.
 */
export function serialize(values: readonly ComponentValue[]): string {
  let out = '';
  for (const value of values) {
    if (value.type === 'whitespace') out += ' ';
    else if (value.type === 'function') out += `${value.text}(${serialize(value.args)})`;
    else if (value.type === 'block') out += `${value.open}${serialize(value.values)}${CLOSE_OF.get(value.open) ?? ''}`;
    else out += value.text;
  }
  return out;
}

// The parser

/** How the parser reads the items of a block. */
type Mode =
  /** Rules and at-rules, no declarations: the top level, and a group at-rule outside a style rule. */
  | 'rules'
  /** Declarations, rules and at-rules: a style rule, and a group at-rule inside one. */
  | 'mixed'
  /** Declarations and at-rules: a keyframe rule, `@font-face`, `@property` and the like. */
  | 'declarations'
  /** Keyframe rules: the block of `@keyframes`. */
  | 'keyframes';

/**
 * Says whether a block is a list of rules outside a style rule: the top level, a group at-rule there, and the block
 * of `@keyframes`. In such a list a `;` ends no rule: it stands in the prelude, and a browser drops the rule.
 */
const isRuleList = (mode: Mode): boolean => mode === 'rules' || mode === 'keyframes';

/** The at-rules whose block holds declarations (CSS Fonts, Paged Media, Properties and Values, and others). */
const DECLARATION_AT_RULES: ReadonlySet<string> = new Set([
  'font-face',
  'font-palette-values',
  'counter-style',
  'property',
  'page',
  'view-transition',
  'position-try',
  'top-left-corner',
  'top-left',
  'top-center',
  'top-right',
  'top-right-corner',
  'bottom-left-corner',
  'bottom-left',
  'bottom-center',
  'bottom-right',
  'bottom-right-corner',
  'left-top',
  'left-middle',
  'left-bottom',
  'right-top',
  'right-middle',
  'right-bottom',
  'swash',
  'annotation',
  'ornaments',
  'stylistic',
  'styleset',
  'character-variant',
  'historical-forms',
]);

/** The at-rules whose block holds declarations and rules also outside a style rule (CSS Cascade Level 6). */
const MIXED_AT_RULES: ReadonlySet<string> = new Set(['scope']);

/** The at-rules whose block holds keyframe rules. */
const KEYFRAMES_AT_RULES: ReadonlySet<string> = new Set(['keyframes', '-webkit-keyframes']);

/** The combinators between compounds of a selector, besides white space. */
const COMBINATORS: ReadonlySet<string> = new Set(['>', '+', '~']);

/** A list of component values with its size: the number of values at every depth. */
interface Sized {
  values: ComponentValue[];
  size: number;
}

/** The scope of a block: the resolved selectors of the nearest enclosing style rule, if any. */
interface Scope {
  parents: Sized[] | undefined;
}

/** A whitespace token made by the parser, at a place of the text. */
const madeSpace = (place: Place): PlainToken => ({ type: 'whitespace', place, text: ' ' });

/** The number of component values in a list, at every depth. */
function sizeOf(values: readonly ComponentValue[]): number {
  let size = 0;
  for (const value of values) {
    size += 1;
    if (value.type === 'function') size += sizeOf(value.args);
    else if (value.type === 'block') size += sizeOf(value.values);
  }
  return size;
}

/** The delimiters that a bracket without its partner becomes (see `pair`). */
const STRAY_BRACKETS: ReadonlySet<string> = new Set([')', ']', '}']);

/**
 * Says whether the prelude of a rule outside a style rule can be no selector, so that a browser drops the rule
 * without reading its selector: it holds a `;` or a bracket without its partner at its top level, or it starts with
 * a custom property name and a colon (CSS Syntax Level 3 keeps `--x: {…}` for a declaration).
 */
function isNoPrelude(prelude: readonly ComponentValue[]): boolean {
  const first = prelude[0];
  const second = prelude.find((value, index) => index > 0 && !isWhitespace(value));
  if (first?.type === 'ident' && first.value.startsWith('--') && second?.type === 'colon') return true;
  return prelude.some(
    (value) => value.type === 'semicolon' || (value.type === 'delim' && STRAY_BRACKETS.has(value.value)),
  );
}

/** Says whether the list holds `&`, also inside a function. */
function hasNesting(values: readonly ComponentValue[]): boolean {
  return values.some((value) => isDelim(value, '&') || (value.type === 'function' && hasNesting(value.args)));
}

/** Says whether an `&` stands inside a function: `:not(&)`, `:has(> &)`, `:is(&)`. */
function nestingInFunction(values: readonly ComponentValue[]): boolean {
  return values.some((value) => value.type === 'function' && hasNesting(value.args));
}

/** Says whether the list holds the function `:has()`, also inside other functions. */
function holdsHas(values: readonly ComponentValue[]): boolean {
  return values.some((value) => value.type === 'function' && (value.name === 'has' || holdsHas(value.args)));
}

/** The number of `&` in the list, also inside functions. */
function nestingCount(values: readonly ComponentValue[]): number {
  let count = 0;
  for (const value of values) {
    if (isDelim(value, '&')) count += 1;
    else if (value.type === 'function') count += nestingCount(value.args);
  }
  return count;
}

/** Says whether the selector is one compound: no white space and no combinator at its top level. */
const isOneCompound = (selector: readonly ComponentValue[]): boolean =>
  !selector.some((value) => isWhitespace(value) || (value.type === 'delim' && COMBINATORS.has(value.value)));

/** Says whether a value starts a compound with a type selector or a namespace: `div`, `*`, `|`. */
const startsWithType = (value: ComponentValue | undefined): boolean =>
  value?.type === 'ident' || isDelim(value, '*') || isDelim(value, '|');

/** Says whether the next value after `out` starts a compound: after nothing, white space, a comma or a combinator. */
function atCompoundStart(out: readonly ComponentValue[]): boolean {
  const last = out.at(-1);
  return (
    last === undefined ||
    last.type === 'whitespace' ||
    last.type === 'comma' ||
    (last.type === 'delim' && COMBINATORS.has(last.value))
  );
}

/** Says whether the next value after `out` starts a selector of the list: after nothing or a comma, and white space. */
function atListStart(out: readonly ComponentValue[]): boolean {
  const last = out.findLast((value) => !isWhitespace(value));
  return last === undefined || last.type === 'comma';
}

/** `:is(<parent list>)`, made at the place of an `&`. */
function isOf(parents: readonly Sized[], place: Place): Sized {
  const args: ComponentValue[] = [];
  let size = 2;
  parents.forEach((parent, index) => {
    if (index > 0) {
      args.push({ type: 'comma', place, text: ',' }, madeSpace(place));
      size += 2;
    }
    args.push(...parent.values);
    size += parent.size;
  });
  return {
    values: [
      { type: 'colon', place, text: ':' },
      { type: 'function', name: 'is', text: 'is', args, place },
    ],
    size,
  };
}

/**
 * Puts the parent in the place of each `&` of a list. `parents` is one selector, or a list that stands as `:is()`.
 * The parent goes in as it is where that keeps the meaning (see `Rule.resolved`), else as `:is(<parent>)`. Inside
 * `:has()` a parent that holds `:has()` stands as `:is(<parent>)`: CSS refuses `:has()` in `:has()`, but `:is()`
 * forgives it, as `&` does. It gives `undefined` as soon as the result is larger than `room` values.
 */
function substitute(
  values: readonly ComponentValue[],
  parents: readonly Sized[],
  room: number,
  inHas = false,
): Sized | undefined {
  const single = parents.length === 1 ? parents[0] : undefined;
  const out: ComponentValue[] = [];
  let size = 0;
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === undefined) break;
    if (value.type === 'function' && hasNesting(value.args)) {
      const inner = substitute(value.args, parents, room - size - 1, inHas || value.name === 'has');
      if (inner === undefined) return undefined;
      out.push({ ...value, args: inner.values });
      size += 1 + inner.size;
    } else if (!isDelim(value, '&')) {
      out.push(value);
      size += sizeOf([value]);
    } else {
      const fits =
        single !== undefined &&
        !(inHas && holdsHas(single.values)) &&
        !startsWithType(values[index + 1]) &&
        (atListStart(out) ||
          (isOneCompound(single.values) && (atCompoundStart(out) || !startsWithType(single.values[0]))));
      const part = fits && single !== undefined ? single : isOf(parents, value.place);
      if (part.size > room) return undefined;
      out.push(...part.values);
      size += part.size;
    }
    if (size > room) return undefined;
  }
  return { values: out, size };
}

/** Says whether a selector starts with a combinator: `> .b`, `+ &`. */
const startsWithCombinator = (selector: readonly ComponentValue[]): boolean => {
  const first = selector[0];
  return first?.type === 'delim' && COMBINATORS.has(first.value);
};

/** The resolved selectors of a rule, or why there are none, and the values that the work built. */
interface Resolution {
  selectors: Sized[] | 'size' | 'total';
  /** The values built, also for a try that failed. The parser takes them from its budget in every case. */
  cost: number;
}

/**
 * The resolved selectors of a nested style rule (see `Rule.resolved`), or why there are none: `size` when one of
 * them would be larger than `MAX_RESOLVED_SIZE`, `total` when all together would be larger than `budget`. The work
 * stops as soon as the budget is spent, so no rule builds more than `budget` values.
 *
 * A selector is relative unless it holds `&` and does not start with a combinator (CSS Nesting): `> &` in `.a`
 * means `& > &`, that is `.a > .a`.
 */
function resolve(selectors: readonly ComponentValue[][], parents: readonly Sized[], budget: number): Resolution {
  const relative = selectors.map((selector): ComponentValue[] => {
    if (hasNesting(selector) && !startsWithCombinator(selector)) return selector;
    const first = selector[0];
    const place = first === undefined ? { offset: 0, line: 1, column: 1 } : first.place;
    return [{ type: 'delim', value: '&', place, text: '&' }, madeSpace(place), ...selector];
  });
  // A parent list multiplies only where each `&` stands at the top level: `:not(&)` with `.a, .b` is
  // `:not(:is(.a, .b))`, not the union of `:not(.a)` and `:not(.b)`, and `:nth-child(2 of &)` counts the whole list.
  const many = relative.some((selector) => nestingCount(selector) > 1 || nestingInFunction(selector));
  const union = parents.length > 1 && (many || parents.length * relative.length > MAX_RESOLVED_SELECTORS);
  const groups = union ? [parents] : parents.map((parent) => [parent]);
  const out: Sized[] = [];
  let used = 0;
  for (const selector of relative) {
    for (const group of groups) {
      const room = Math.min(MAX_RESOLVED_SIZE, budget - used);
      const resolved = substitute(selector, group, room);
      if (resolved === undefined) {
        // One more bounded try tells the two reasons apart.
        const total = room < MAX_RESOLVED_SIZE && substitute(selector, group, MAX_RESOLVED_SIZE) !== undefined;
        return {
          selectors: total ? 'total' : 'size',
          cost: used + room + (room < MAX_RESOLVED_SIZE ? MAX_RESOLVED_SIZE : 0),
        };
      }
      used += resolved.size;
      out.push(resolved);
    }
  }
  return { selectors: out, cost: used };
}

/**
 * The names of an `@layer` prelude: `a, b.c` gives `a` and `b.c`. A block takes zero names or one, a statement one
 * or more. `undefined` when the prelude is no list of layer names, or the at-rule is no `@layer`.
 */
export function layerNames(rule: AtRule): string[] | undefined {
  if (rule.name !== 'layer') return undefined;
  const parts = rule.prelude.length === 0 ? [] : splitCommas(rule.prelude);
  const names: string[] = [];
  for (const part of parts) {
    let name = '';
    for (let index = 0; index < part.length; index += 1) {
      const value = part[index];
      const expectName = index % 2 === 0;
      if (expectName && value?.type === 'ident') name += value.value;
      else if (!expectName && isDelim(value, '.')) name += '.';
      else return undefined;
    }
    if (name === '' || name.endsWith('.')) return undefined;
    names.push(name);
  }
  if (rule.block === undefined ? names.length === 0 : names.length > 1) return undefined;
  return names;
}

/**
 * Parses a text as a style sheet (CSS Syntax Level 3, with CSS Nesting). It never throws: a text that is not CSS
 * gives problems with places, and the parse goes on as a browser's does.
 */
export function parseCss(text: string, file: string): Stylesheet {
  const place = placer(text);
  const problems = problemsOf(place);
  const lexemes = tokenize(text, place, problems);
  const match = pair(lexemes, problems);
  const total = lexemes.length;
  let budget = MAX_RESOLVED_TOTAL;

  const tokenAt = (index: number): Token | undefined => {
    const lexeme = lexemes[index];
    return lexeme?.kind === 'token' ? lexeme.token : undefined;
  };
  const offsetAt = (index: number): number => {
    const lexeme = lexemes[index];
    if (lexeme === undefined) return text.length;
    return lexeme.kind === 'token' ? lexeme.token.place.offset : lexeme.place.offset;
  };
  const deep = (index: number): void => problems.add(offsetAt(index), `nesting deeper than ${MAX_DEPTH} levels`);

  /** The component values of the stream from `from` up to `to`. */
  const valuesOf = (from: number, to: number, depth: number): ComponentValue[] => {
    const out: ComponentValue[] = [];
    let index = from;
    while (index < to) {
      const lexeme = lexemes[index];
      if (lexeme === undefined) break;
      if (lexeme.kind === 'token') {
        out.push(lexeme.token);
        index += 1;
        continue;
      }
      if (lexeme.kind === 'close') {
        index += 1;
        continue;
      }
      const end = Math.min(match[index] ?? total, to);
      if (depth + 1 > MAX_DEPTH) deep(index);
      else {
        const inner = valuesOf(index + 1, end, depth + 1);
        if (lexeme.name !== undefined) {
          out.push({ type: 'function', name: lexeme.name, text: lexeme.text, args: inner, place: lexeme.place });
        } else out.push({ type: 'block', open: lexeme.char, values: inner, place: lexeme.place });
      }
      index = end + 1;
    }
    return out;
  };

  /** Where an item ends: the first top-level `;` or `{` from `from`, or `to`. Brackets are skipped whole. */
  const scan = (from: number, to: number): { at: number; stop: 'semicolon' | 'block' | 'end' } => {
    for (let index = from; index < to; index += 1) {
      const lexeme = lexemes[index];
      if (lexeme?.kind === 'open') {
        if (lexeme.char === '{') return { at: index, stop: 'block' };
        index = match[index] ?? total;
      } else if (lexeme?.kind === 'token' && lexeme.token.type === 'semicolon') return { at: index, stop: 'semicolon' };
    }
    return { at: to, stop: 'end' };
  };

  /** The next index after `from` that is no white space. */
  const skipSpace = (from: number, to: number): number => {
    let index = from;
    while (index < to && tokenAt(index)?.type === 'whitespace') index += 1;
    return index;
  };

  /** Says whether the item at `from` starts as a declaration: a name, white space and a colon. */
  const startsDeclaration = (from: number, to: number): boolean =>
    tokenAt(from)?.type === 'ident' && tokenAt(skipSpace(from + 1, to))?.type === 'colon';

  /** The end of a declaration that starts at `from`: the first top-level `;`, or `to`. Blocks belong to it. */
  const declarationEnd = (from: number, to: number): number => {
    for (let index = from; index < to; index += 1) {
      const lexeme = lexemes[index];
      if (lexeme?.kind === 'open') index = match[index] ?? total;
      else if (lexeme?.kind === 'token' && lexeme.token.type === 'semicolon') return index;
    }
    return to;
  };

  /**
   * Says whether the declaration at `from` has one `{}` block as its whole value, maybe with `!important` after it.
   * CSS Syntax Level 3 reads that as a declaration (`max-inline-size: {…}`); a block with any other value beside it
   * makes the text a nested rule (`a:hover {…}`).
   */
  const blockValue = (from: number, to: number): boolean => {
    // It reads the value only up to its first item that is no part of `{…} !important`, so a block of many such
    // items takes linear time.
    const open = skipSpace(skipSpace(from + 1, to) + 1, to);
    const lexeme = lexemes[open];
    if (lexeme?.kind !== 'open' || lexeme.char !== '{') return false;
    let index = skipSpace((match[open] ?? total) + 1, to);
    if (isDelim(tokenAt(index), '!')) {
      const word = skipSpace(index + 1, to);
      if (!isIdent(tokenAt(word), 'important')) return false;
      index = skipSpace(word + 1, to);
    }
    return index >= to || tokenAt(index)?.type === 'semicolon';
  };

  const declaration = (from: number, end: number, depth: number): Declaration | undefined => {
    const name = tokenAt(from);
    if (name?.type !== 'ident') return undefined;
    const colon = skipSpace(from + 1, end);
    const values = trimWhitespace(valuesOf(colon + 1, end, depth));
    const custom = name.value.startsWith('--');
    let value = values;
    let important = false;
    const last = values.at(-1);
    if (isIdent(last, 'important')) {
      const before = trimWhitespace(values.slice(0, -1));
      if (isDelim(before.at(-1), '!')) {
        value = trimWhitespace(before.slice(0, -1));
        important = true;
      }
    }
    if (!custom) {
      if (value.length === 0) problems.add(name.place.offset, `the declaration \`${name.value}\` has no value`);
      const bang = value.find((part) => isDelim(part, '!'));
      if (bang !== undefined) problems.add(bang.place.offset, 'a `!` that is not `!important` at the end of a value');
    }
    return {
      type: 'declaration',
      property: custom ? name.value : asciiLower(name.value),
      value,
      important,
      place: name.place,
    };
  };

  /** The items of a block from `from` up to `to`. */
  const contents = (from: number, to: number, mode: Mode, scope: Scope, depth: number): CssNode[] => {
    const nodes: CssNode[] = [];
    let index = from;
    while (index < to) {
      const lexeme = lexemes[index];
      if (lexeme === undefined) break;
      if (lexeme.kind === 'close') {
        index += 1;
        continue;
      }
      const token = lexeme.kind === 'token' ? lexeme.token : undefined;
      const type = token?.type;
      // In a list of rules a `;` starts the prelude of a rule (CSS Syntax Level 3), which a browser then drops.
      const skipped = type === 'whitespace' || (type === 'semicolon' && !isRuleList(mode));
      if (skipped || (depth === 0 && (type === 'cdo' || type === 'cdc'))) {
        index += 1;
        continue;
      }
      if (token?.type === 'at-keyword') {
        index = atRule(index, to, scope, depth, nodes);
        continue;
      }
      const looksDeclaration = startsDeclaration(index, to);
      if (mode === 'declarations' || (mode === 'mixed' && looksDeclaration)) {
        const { stop } = scan(index, to);
        const custom = token?.type === 'ident' && token.value.startsWith('--');
        if (looksDeclaration && (stop !== 'block' || custom || blockValue(index, to))) {
          const end = declarationEnd(index, to);
          const node = declaration(index, end, depth);
          if (node !== undefined) nodes.push(node);
          index = end + 1;
          continue;
        }
        if (mode === 'declarations') {
          // A browser skips such a text up to the next `;` of the list, blocks included.
          problems.add(offsetAt(index), 'a text that is no declaration');
          index = declarationEnd(index, to) + 1;
          continue;
        }
      }
      index = qualifiedRule(index, to, mode, scope, depth, nodes, looksDeclaration);
    }
    return nodes;
  };

  /** Where a prelude outside a style rule ends: the first top-level `{` from `from`, or `to`. */
  const scanBlock = (from: number, to: number): { at: number; stop: 'block' | 'end' } => {
    for (let index = from; index < to; index += 1) {
      const lexeme = lexemes[index];
      if (lexeme?.kind === 'open') {
        if (lexeme.char === '{') return { at: index, stop: 'block' };
        index = match[index] ?? total;
      }
    }
    return { at: to, stop: 'end' };
  };

  const qualifiedRule = (
    from: number,
    to: number,
    mode: Mode,
    scope: Scope,
    depth: number,
    nodes: CssNode[],
    looksDeclaration: boolean,
  ): number => {
    // In a list of rules a `;` does not end a rule: the prelude runs to the `{` (CSS Syntax Level 3).
    const { at, stop } = isRuleList(mode) ? scanBlock(from, to) : scan(from, to);
    const stray = looksDeclaration ? 'a declaration outside a rule' : 'a rule without a `{` block, or a stray text';
    if (stop !== 'block') {
      problems.add(offsetAt(from), stray);
      return at + 1;
    }
    const close = Math.min(match[at] ?? total, to);
    const prelude = trimWhitespace(valuesOf(from, at, depth));
    if (isRuleList(mode) && isNoPrelude(prelude)) {
      // A browser drops the rule and its block: no selector holds such a prelude.
      problems.add(offsetAt(from), stray);
      return close + 1;
    }
    const first = prelude[0];
    const rulePlace = first?.place ?? place(offsetAt(from));
    const selectors = splitCommas(prelude);
    if (selectors.some((selector) => selector.length === 0)) problems.add(rulePlace.offset, 'an empty selector');
    const kind = mode === 'keyframes' ? 'keyframe' : 'style';
    let resolved: Sized[] = selectors.map((selector) => ({ values: selector, size: sizeOf(selector) }));
    if (kind === 'style' && scope.parents !== undefined) {
      const { selectors: result, cost } = resolve(selectors, scope.parents, budget);
      // The budget pays for all work, also for a try that failed, so many failing rules cannot repeat it.
      budget = Math.max(0, budget - cost);
      if (result === 'size') {
        problems.add(rulePlace.offset, `a selector larger than ${MAX_RESOLVED_SIZE} values after nesting`);
        resolved = [];
      } else if (result === 'total') {
        problems.add(rulePlace.offset, `nested selectors larger than ${MAX_RESOLVED_TOTAL} values in all`);
        resolved = [];
      } else resolved = result;
    }
    const rule: Rule = {
      type: 'rule',
      kind,
      prelude,
      selectors,
      resolved: resolved.map((selector) => selector.values),
      children: [],
      place: rulePlace,
    };
    if (depth + 1 > MAX_DEPTH) deep(at);
    else {
      const childMode: Mode = kind === 'keyframe' ? 'declarations' : 'mixed';
      const childScope: Scope = kind === 'style' ? { parents: resolved } : scope;
      rule.children = contents(at + 1, close, childMode, childScope, depth + 1);
    }
    nodes.push(rule);
    return close + 1;
  };

  const atRule = (from: number, to: number, scope: Scope, depth: number, nodes: CssNode[]): number => {
    const keyword = tokenAt(from);
    const name = keyword?.type === 'at-keyword' ? asciiLower(keyword.value) : '';
    const atPlace = keyword?.place ?? place(offsetAt(from));
    const { at, stop } = scan(from + 1, to);
    const prelude = trimWhitespace(valuesOf(from + 1, at, depth));
    const rule: AtRule = { type: 'at-rule', name, prelude, block: undefined, place: atPlace };
    let next = stop === 'semicolon' ? at + 1 : at;
    if (stop === 'block') {
      const close = Math.min(match[at] ?? total, to);
      next = close + 1;
      if (depth + 1 > MAX_DEPTH) {
        deep(at);
        rule.block = [];
      } else {
        const childMode: Mode = KEYFRAMES_AT_RULES.has(name)
          ? 'keyframes'
          : DECLARATION_AT_RULES.has(name)
            ? 'declarations'
            : scope.parents === undefined && !MIXED_AT_RULES.has(name)
              ? 'rules'
              : 'mixed';
        rule.block = contents(at + 1, close, childMode, scope, depth + 1);
      }
    }
    if (name === 'layer' && layerNames(rule) === undefined) {
      problems.add(atPlace.offset, 'an `@layer` prelude that is no list of layer names');
    }
    nodes.push(rule);
    return next;
  };

  const top = contents(0, total, 'rules', { parents: undefined }, 0);
  return { type: 'stylesheet', file, nodes: top, problems: inOrder(problems.list) };
}

/**
 * Parses a text as a list of component values, as a declaration value or a prelude: `calc(100% - var(--space-4))`,
 * `(width >= 48rem)`, `.card:hover`. White space at the two ends goes. A `;` or `{}` in the text stays a token or a
 * block. It never throws.
 */
export function parseValue(text: string): { values: ComponentValue[]; problems: ParseProblem[] } {
  const place = placer(text);
  const problems = problemsOf(place);
  const lexemes = tokenize(text, place, problems);
  const match = pair(lexemes, problems);
  const build = (from: number, to: number, depth: number): ComponentValue[] => {
    const out: ComponentValue[] = [];
    let index = from;
    while (index < to) {
      const lexeme = lexemes[index];
      if (lexeme === undefined) break;
      if (lexeme.kind === 'token') out.push(lexeme.token);
      else if (lexeme.kind === 'open') {
        const end = Math.min(match[index] ?? lexemes.length, to);
        if (depth + 1 > MAX_DEPTH) problems.add(lexeme.place.offset, `nesting deeper than ${MAX_DEPTH} levels`);
        else {
          const inner = build(index + 1, end, depth + 1);
          if (lexeme.name !== undefined) {
            out.push({ type: 'function', name: lexeme.name, text: lexeme.text, args: inner, place: lexeme.place });
          } else out.push({ type: 'block', open: lexeme.char, values: inner, place: lexeme.place });
        }
        index = end;
      }
      index += 1;
    }
    return out;
  };
  return { values: trimWhitespace(build(0, lexemes.length, 0)), problems: inOrder(problems.list) };
}

// Walking the tree

/** What encloses a node. */
export interface WalkContext {
  /** The enclosing at-rules, the outermost first. */
  atRules: readonly AtRule[];
  /**
   * The full name of the enclosing cascade layer: `components`, or `astro.images` for a sub-layer, written with dots
   * also when blocks nest. An anonymous layer is `(anonymous)`. `undefined` for an unlayered node.
   */
  layer: string | undefined;
  /**
   * The rule that holds the node: for a declaration the rule it belongs to (also through `@media` or
   * `@starting-style` inside the rule), for a nested rule its parent, for a declaration of a keyframe its keyframe
   * rule. `undefined` at the top level and in `@font-face` and the like.
   */
  rule: Rule | undefined;
}

/** A function that `walk` calls for every node. */
export type Visitor = (node: CssNode, context: WalkContext) => void;

/** The anonymous layer in a layer name. A name of CSS cannot hold brackets, so it never meets a real name. */
export const ANONYMOUS_LAYER = '(anonymous)';

/** The layer of the block of an `@layer` rule, inside the layer `outer`. */
function innerLayer(rule: AtRule, outer: string | undefined): string | undefined {
  if (rule.name !== 'layer' || rule.block === undefined) return outer;
  // `walk` enters no block whose prelude is broken, so no name means an anonymous layer here.
  const name = layerNames(rule)?.[0] ?? ANONYMOUS_LAYER;
  return outer === undefined ? name : `${outer}.${name}`;
}

/**
 * Says whether a browser drops the block of an at-rule whole: an `@layer` whose prelude is no layer name
 * (`@layer a b {…}`, `@layer a, b {…}`). The parser reports the prelude; no rule reads the block as live CSS.
 */
export const isDroppedBlock = (rule: AtRule): boolean =>
  rule.name === 'layer' && rule.block !== undefined && layerNames(rule) === undefined;

/**
 * Visits every node of a sheet or of a list of nodes, in the order of the text, each before its children. It does
 * not enter a block that a browser drops whole (`isDroppedBlock`): it visits that at-rule, but not its block.
 */
export function walk(sheet: Stylesheet | readonly CssNode[], visit: Visitor): void {
  const step = (nodes: readonly CssNode[], context: WalkContext): void => {
    for (const node of nodes) {
      visit(node, context);
      if (node.type === 'at-rule' && node.block !== undefined && !isDroppedBlock(node)) {
        step(node.block, {
          atRules: [...context.atRules, node],
          layer: innerLayer(node, context.layer),
          rule: context.rule,
        });
      } else if (node.type === 'rule') step(node.children, { ...context, rule: node });
    }
  };
  step('type' in sheet ? sheet.nodes : sheet, { atRules: [], layer: undefined, rule: undefined });
}

// Classes

/** One class name of a selector, at the place of its `.`. */
export interface ClassName {
  /** The name with escapes resolved: `.a\:b` is `a:b`. */
  name: string;
  place: Place;
}

function classesIn(values: readonly ComponentValue[], out: ClassName[], seen: Set<string>): void {
  values.forEach((value, index) => {
    if (value.type === 'function') classesIn(value.args, out, seen);
    if (!isDelim(value, '.')) return;
    const next = values[index + 1];
    if (next?.type !== 'ident' || seen.has(next.value)) return;
    seen.add(next.value);
    out.push({ name: next.value, place: value.place });
  });
}

/**
 * Every class of a selector, or of every style rule of a sheet, once each, at its first place. A class is a `.`
 * with a name right after it, also inside a functional pseudo-class (`:is(.a)`, `:nth-child(2n of .b)`). Keyframe
 * selectors and at-rule preludes hold no class.
 */
export function classesOf(input: Stylesheet | readonly ComponentValue[]): ClassName[] {
  const out: ClassName[] = [];
  const seen = new Set<string>();
  if ('type' in input) {
    walk(input, (node) => {
      if (node.type === 'rule' && node.kind === 'style') classesIn(node.prelude, out, seen);
    });
  } else classesIn(input, out, seen);
  return out;
}

// Layers

/** One top-level `@layer` rule: a statement (`@layer a, b;`) or a block (`@layer a { … }`). */
export interface LayerEntry {
  kind: 'statement' | 'block';
  /** The names as written, sub-layers with dots: `astro.images`. A block has one name, or none when anonymous. */
  names: string[];
  rule: AtRule;
}

/** The top-level `@layer` statements and blocks of a sheet, in the order of the text. A broken prelude has no names. */
export function layerTree(sheet: Stylesheet): LayerEntry[] {
  return sheet.nodes.flatMap((node): LayerEntry[] =>
    node.type === 'at-rule' && node.name === 'layer'
      ? [{ kind: node.block === undefined ? 'statement' : 'block', names: layerNames(node) ?? [], rule: node }]
      : [],
  );
}

/**
 * The layer names of the top-level `@layer` statements and blocks, in the order of their first appearance (13.1
 * item 3: the minifier may write the order statement in parts). A sub-layer keeps its full name.
 */
export function layerOrder(sheet: Stylesheet): string[] {
  const order: string[] = [];
  for (const entry of layerTree(sheet)) {
    for (const name of entry.names) if (!order.includes(name)) order.push(name);
  }
  return order;
}

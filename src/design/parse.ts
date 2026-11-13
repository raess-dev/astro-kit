/**
 * The design document `docs/design.md` (specification, 7.4): its parser, and the rule `design-format`.
 *
 * The file is Markdown. A section is a `## ` heading with an exact text, and a section that the kit reads holds
 * one pipe table. Everything else is prose. `parseDesign` reads the tables into a `Design`, and it checks every
 * sentence of the rule:
 *
 * 1. The required sections exist, and each table has the exact header row.
 * 2. A token has a known prefix (7.3) and stands in the section of its family.
 * 3. No name is declared twice.
 * 4. Each value parses for its family. A color is never `color-mix()` or `color(display-p3 …)`.
 * 5. The themes: at least one base theme, `light` for `light-contrast`, `dark` for `dark-contrast`.
 * 6. Each Color cell has a value or a fallback.
 * 7. At least one Color row, one `--font-` row, one `--text-` row, one Spacing row and one pair.
 *
 * Three checks follow from 7.4 without a sentence of their own. A row has no more cells than its header row. A
 * `var()` names a token that the file declares. No alias leads back to its own token. Without the last two,
 * `tokens.css` would hold a value that no browser can compute.
 *
 * The kit has no CSS parser at this point of the build order. So this module checks a value with a small
 * tokenizer of its own and one small grammar for each family. `tokens.css` is exempt from every `css-*` rule, so
 * this rule is the only check on the text of a value. The tokenizer is strict for that reason: a value holds no
 * control character, no `<`, no backslash and no white space other than a space or a tab.
 */
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  type Breakpoint,
  type ColorToken,
  type ContrastPair,
  DESIGN_FILE,
  type Design,
  type DesignSpec,
  type HelperParameter,
  type TokenFamily,
  type ValueToken,
} from '../context.ts';
import { THEMES, type Theme } from '../modes.ts';
import type { Report } from '../registry.ts';

export type {
  Breakpoint,
  ColorToken,
  ContrastPair,
  Design,
  DesignSpec,
  HelperParameter,
  TokenFamily,
  ValueToken,
} from '../context.ts';
export { DESIGN_FILE } from '../context.ts';

const RULE = 'design-format';

// Token names

/** The prefix of each token family, in the order of 7.3. */
export const TOKEN_PREFIXES: Readonly<Record<TokenFamily, string>> = {
  color: '--color-',
  space: '--space-',
  size: '--size-',
  font: '--font-',
  text: '--text-',
  leading: '--leading-',
  weight: '--weight-',
  tracking: '--tracking-',
  radius: '--radius-',
  line: '--line-',
  shadow: '--shadow-',
  z: '--z-',
  duration: '--duration-',
  ease: '--ease-',
  opacity: '--opacity-',
  gradient: '--gradient-',
};

const isFamily = (text: string): text is TokenFamily => Object.hasOwn(TOKEN_PREFIXES, text);

/** The families, in the order of 7.3. */
const FAMILIES: readonly TokenFamily[] = Object.keys(TOKEN_PREFIXES).filter(isFamily);

/** The part of a token name after its prefix. */
const NAME_TAIL = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** The family of a token name that matches `^--<prefix>[a-z0-9]+(-[a-z0-9]+)*$` (7.3). Any other text has none. */
export function familyOf(name: string): TokenFamily | undefined {
  for (const family of FAMILIES) {
    const prefix = TOKEN_PREFIXES[family];
    if (name.startsWith(prefix) && NAME_TAIL.test(name.slice(prefix.length))) return family;
  }
  return undefined;
}

/** The six parameters of the layout helpers, each with the family of its token (7.5). */
export const HELPER_PARAMETERS: Readonly<Record<string, 'space' | 'size'>> = {
  '--stack-gap': 'space',
  '--cluster-gap': 'space',
  '--grid-gap': 'space',
  '--grid-min': 'size',
  '--center-max': 'size',
  '--center-gutter': 'space',
};

/**
 * The themes whose cell gives the value of a color in one theme, in the order to try (7.4): an empty cell takes
 * the value of the next declared theme with a value, along `dark-contrast` → `dark` → `light` and
 * `light-contrast` → `light`.
 */
export const THEME_FALLBACKS: Readonly<Record<Theme, readonly Theme[]>> = {
  light: ['light'],
  dark: ['dark', 'light'],
  'light-contrast': ['light-contrast', 'light'],
  'dark-contrast': ['dark-contrast', 'dark', 'light'],
};

// Sections

type ValueFamily = Exclude<TokenFamily, 'color'>;

const COLOR_SECTION = 'Color';

/** The token sections other than `## Color`, in the order of 7.7 (step 3.3), each with its families (7.3). */
const TOKEN_SECTIONS: readonly (readonly [section: string, families: readonly ValueFamily[], required: boolean])[] = [
  ['Typography', ['font', 'text', 'leading', 'weight', 'tracking'], true],
  ['Spacing', ['space'], true],
  ['Size', ['size'], false],
  ['Radius', ['radius'], false],
  ['Line', ['line'], false],
  ['Shadow', ['shadow'], false],
  ['Layer', ['z'], false],
  ['Motion', ['duration', 'ease'], false],
  ['Opacity', ['opacity'], false],
  ['Gradient', ['gradient'], false],
];

/** The section in which the tokens of a family stand. */
function sectionOf(family: TokenFamily): string {
  return TOKEN_SECTIONS.find(([, families]) => families.some((other) => other === family))?.[0] ?? COLOR_SECTION;
}

/** The header rows of 7.4. The header of `## Color` depends on the declared themes. */
const HEADERS = {
  themes: ['Theme', 'Use'],
  tokens: ['Token', 'Value', 'Use'],
  breakpoints: ['Name', 'Width', 'Use'],
  pairs: ['Foreground', 'Background', 'Role', 'For'],
  helpers: ['Parameter', 'Token', 'Use'],
  specs: ['Selector', 'Property', 'Token'],
} as const;

const BREAKPOINT_NAME = /^[a-z][a-z0-9-]*$/;
const BREAKPOINT_WIDTH = /^\d+(\.\d+)?(rem|em|px)$/;

// Markdown

interface Row {
  /** The line in the file, from 1. */
  line: number;
  /** The cells: trimmed, with backticks stripped. */
  cells: string[];
}

interface Table {
  /** The line of the header row. */
  line: number;
  header: string[];
  /** True when the line below the header row is the delimiter row. */
  delimiter: boolean;
  rows: Row[];
}

interface Section {
  /** The text of the `## ` heading. */
  name: string;
  line: number;
  tables: Table[];
}

/**
 * An opening or closing code fence: three or more backticks or tildes. As in Markdown, a line with a backtick
 * after the backticks is no fence: it is prose that starts with inline code.
 */
const FENCE = /^ {0,3}(?:(`{3,})[^`]*|(~{3,}).*)$/;

/** A line of a pipe table. */
const TABLE_LINE = /^ {0,3}\|/;

const DELIMITER_CELL = /^:?-+:?$/;

const BYTE_ORDER_MARK = 0xfeff;

/** The cells of one table line. `\|` is a pipe inside a cell. */
function cellsOf(line: string): string[] {
  const text = line.trim().slice(1);
  const body = text.endsWith('|') && !text.endsWith('\\|') ? text.slice(0, -1) : text;
  return body.split(/(?<!\\)\|/).map((part) => part.replaceAll('\\|', '|').replaceAll('`', '').trim());
}

/**
 * The `## ` sections of the text with their pipe tables. A `# ` heading ends a section, and a deeper heading stays
 * inside it. A code fence hides its lines. A table is a run of lines that start with `|`: inside a section, no
 * such line is prose. So rows that an empty line cuts off from their table are a second table and a finding, and
 * they never vanish from the tokens.
 */
function sectionsOf(text: string): Section[] {
  const sections: Section[] = [];
  let section: Section | undefined;
  let table: Table | undefined;
  let fence: string | undefined;
  const source = text.charCodeAt(0) === BYTE_ORDER_MARK ? text.slice(1) : text;
  for (const [index, raw] of source.split(/\r?\n/).entries()) {
    const line = index + 1;
    const found = FENCE.exec(raw);
    const mark = found?.[1] ?? found?.[2];
    if (fence !== undefined) {
      if (mark?.startsWith(fence) && raw.trim() === mark) fence = undefined;
      continue;
    }
    if (mark !== undefined) {
      fence = mark;
      table = undefined;
    } else if (raw.startsWith('# ')) {
      section = undefined;
      table = undefined;
    } else if (raw.startsWith('## ')) {
      section = { name: raw.slice(3).trim(), line, tables: [] };
      sections.push(section);
      table = undefined;
    } else if (!TABLE_LINE.test(raw)) {
      table = undefined;
    } else if (section !== undefined) {
      const cells = cellsOf(raw);
      if (table === undefined) {
        table = { line, header: cells, delimiter: false, rows: [] };
        section.tables.push(table);
      } else if (
        line === table.line + 1 &&
        cells.length === table.header.length &&
        cells.every((part) => DELIMITER_CELL.test(part))
      ) {
        table.delimiter = true;
      } else {
        table.rows.push({ line, cells });
      }
    }
  }
  return sections;
}

// Values: a small tokenizer

type Node =
  | { kind: 'space' | 'comma' | 'slash' | 'string' }
  | { kind: 'operator' | 'ident' | 'hash'; text: string }
  | { kind: 'number'; text: string; value: number; unit: string }
  | { kind: 'function'; name: string; nodes: Node[] }
  | { kind: 'block'; nodes: Node[] };

type NumberNode = Extract<Node, { kind: 'number' }>;

/** The white space of a value. Any other white space character, such as U+00A0, is no separator in CSS. */
const SPACE = /^[ \t]+/;
const STRING = /^(?:"[^"]*"|'[^']*')/;
const NUMBER = /^[+-]?(?:\d*\.\d+|\d+)(?:e[+-]?\d+)?/i;
const UNIT = /^(?:%|[a-z][a-z0-9-]*)/i;
const IDENT = /^(?:--[a-z0-9_-]+|-?[a-z_][a-z0-9_-]*)/i;
const HASH = /^#[a-z0-9]+/i;

const SINGLE: Readonly<Record<string, Node>> = {
  ',': { kind: 'comma' },
  '/': { kind: 'slash' },
  '*': { kind: 'operator', text: '*' },
  '+': { kind: 'operator', text: '+' },
  '-': { kind: 'operator', text: '-' },
};

/** The list without the spaces at its two ends. */
function trimmed(nodes: Node[]): Node[] {
  let start = 0;
  let end = nodes.length;
  while (nodes[start]?.kind === 'space') start += 1;
  while (end > start && nodes[end - 1]?.kind === 'space') end -= 1;
  return nodes.slice(start, end);
}

/** The deepest nesting of brackets in a value. No value of 7.4 needs more. */
const MAX_DEPTH = 32;

const TAB = 0x09;
const FIRST_PRINTABLE = 0x20;
const DELETE = 0x7f;

/**
 * Says whether the text holds a character that no value may hold, inside a string too.
 *
 * - A control character other than a tab. A form feed or a carriage return ends a CSS string, and with it the
 *   declaration.
 * - `<`. Astro puts the CSS into a `<style>` element as it is, so `</style>` in a string ends the element.
 * - A backslash. The minifier writes an escape as its character, so `\3c ` becomes `<`.
 */
function hasRefusedCharacter(text: string): boolean {
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if ((code < FIRST_PRINTABLE && code !== TAB) || code === DELETE) return true;
  }
  return text.includes('<') || text.includes('\\');
}

/**
 * The component values of a CSS value. It is `undefined` for a text that no grammar of this module can read: an
 * open string, a bracket without its partner, brackets that nest deeper than `MAX_DEPTH`, a character of
 * `hasRefusedCharacter`, or a character such as `;`, `{`, `}` or `!`. So no value can end its declaration in
 * `tokens.css`, and none can end the `<style>` element of a page.
 */
function lex(text: string): Node[] | undefined {
  if (hasRefusedCharacter(text)) return undefined;
  let at = 0;
  const read = (depth: number): Node[] | undefined => {
    if (depth > MAX_DEPTH) return undefined;
    const nested = depth > 0;
    const nodes: Node[] = [];
    while (at < text.length) {
      const rest = text.slice(at);
      const space = SPACE.exec(rest)?.[0];
      if (space !== undefined) {
        at += space.length;
        nodes.push({ kind: 'space' });
        continue;
      }
      const string = STRING.exec(rest)?.[0];
      if (string !== undefined) {
        at += string.length;
        nodes.push({ kind: 'string' });
        continue;
      }
      const number = NUMBER.exec(rest)?.[0];
      if (number !== undefined) {
        const unit = UNIT.exec(rest.slice(number.length))?.[0] ?? '';
        at += number.length + unit.length;
        nodes.push({ kind: 'number', text: number, value: Number(number), unit: unit.toLowerCase() });
        continue;
      }
      const ident = IDENT.exec(rest)?.[0];
      if (ident !== undefined) {
        at += ident.length;
        if (text[at] !== '(') {
          nodes.push({ kind: 'ident', text: ident });
          continue;
        }
        at += 1;
        const inner = read(depth + 1);
        if (inner === undefined) return undefined;
        nodes.push({ kind: 'function', name: ident.toLowerCase(), nodes: inner });
        continue;
      }
      const hash = HASH.exec(rest)?.[0];
      if (hash !== undefined) {
        at += hash.length;
        nodes.push({ kind: 'hash', text: hash });
        continue;
      }
      const char = rest.charAt(0);
      at += 1;
      if (char === ')') return nested ? trimmed(nodes) : undefined;
      if (char === '(') {
        const inner = read(depth + 1);
        if (inner === undefined) return undefined;
        nodes.push({ kind: 'block', nodes: inner });
        continue;
      }
      const single = SINGLE[char];
      if (single === undefined) return undefined;
      nodes.push(single);
    }
    return nested ? undefined : trimmed(nodes);
  };
  return read(0);
}

/** The nodes without the spaces. */
const wordsOf = (nodes: readonly Node[]): Node[] => nodes.filter((node) => node.kind !== 'space');

/** The one node of a value that is a single component, else `undefined`. */
function only(nodes: readonly Node[]): Node | undefined {
  const words = wordsOf(nodes);
  return words.length === 1 ? words[0] : undefined;
}

/** The parts of a comma-separated list, each without spaces. */
function listOf(nodes: readonly Node[]): Node[][] {
  const parts: Node[][] = [[]];
  for (const node of wordsOf(nodes)) {
    if (node.kind === 'comma') parts.push([]);
    else parts.at(-1)?.push(node);
  }
  return parts;
}

const isKeyword = (node: Node | undefined, ...names: readonly string[]): boolean =>
  node?.kind === 'ident' && names.includes(node.text.toLowerCase());

/** The custom property that a `var()` without fallback names, else `undefined`. */
function varName(node: Node | undefined): string | undefined {
  if (node?.kind !== 'function' || node.name !== 'var') return undefined;
  const name = only(node.nodes);
  return name?.kind === 'ident' && name.text.startsWith('--') ? name.text : undefined;
}

// Values: numbers and lengths

const LENGTH_UNITS: ReadonlySet<string> = new Set(
  `px rem em ex rex ch rch cap rcap ic ric lh rlh cm mm q in pt pc
  vw vh vi vb vmin vmax svw svh svi svb svmin svmax lvw lvh lvi lvb lvmin lvmax dvw dvh dvi dvb dvmin dvmax
  cqw cqh cqi cqb cqmin cqmax`.split(/\s+/),
);

const ANGLE_UNITS: readonly string[] = ['deg', 'grad', 'rad', 'turn'];

const isNumber = (node: Node | undefined): node is NumberNode => node?.kind === 'number' && node.unit === '';
const isInteger = (node: Node | undefined): node is NumberNode => isNumber(node) && /^[+-]?\d+$/.test(node.text);
const isPercentage = (node: Node | undefined): node is NumberNode => node?.kind === 'number' && node.unit === '%';

/** A length: a number with a length unit, or `0`. */
const isLength = (node: Node | undefined): boolean =>
  node?.kind === 'number' && (LENGTH_UNITS.has(node.unit) || (node.unit === '' && node.value === 0));

const isLengthOrPercentage = (node: Node | undefined): boolean => isLength(node) || isPercentage(node);

/** The math functions of 7.4, each with its smallest and its largest count of arguments. */
const MATH: Readonly<Record<string, readonly [number, number]>> = {
  calc: [1, 1],
  clamp: [3, 3],
  min: [1, Number.POSITIVE_INFINITY],
  max: [1, Number.POSITIVE_INFINITY],
};

/** What a calculation gives: a plain number, or a number with a unit. */
type CalcType = 'number' | 'dimension';

/** Says which dimensions a calculation may hold. */
type Accepts = (node: NumberNode) => boolean;

/** The type of one operand: a number, a dimension that `accepts` allows, a bracket, or a math function. */
function operandType(node: Node | undefined, accepts: Accepts): CalcType | undefined {
  if (node?.kind === 'number') {
    if (node.unit === '') return 'number';
    return accepts(node) ? 'dimension' : undefined;
  }
  if (node?.kind === 'block') return sumType(wordsOf(node.nodes), accepts);
  return mathType(node, accepts);
}

/**
 * The type of a calculation, or `undefined` for a text that is none. A calculation has operands with one operator
 * between each two, and the types fit as in CSS:
 *
 * - `+` and `-` need two operands of one type. So `1rem + 1` is no calculation.
 * - `*` needs a number on at least one side.
 * - The divisor of `/` is a number.
 *
 * CSS wants spaces around `+` and `-`: the tokenizer reads `1rem -2px` as two operands, so that text is no
 * calculation here either.
 */
function sumType(words: readonly Node[], accepts: Accepts): CalcType | undefined {
  if (words.length % 2 === 0) return undefined;
  /** The type of the terms before the current one. */
  let sum: CalcType | undefined;
  /** The type of the current term: a product. */
  let term: CalcType | undefined;
  for (let index = 0; index < words.length; index += 2) {
    const type = operandType(words[index], accepts);
    if (type === undefined) return undefined;
    const operator = words[index - 1];
    if (operator === undefined || term === undefined) {
      term = type;
    } else if (operator.kind === 'slash') {
      if (type !== 'number') return undefined;
    } else if (operator.kind !== 'operator') {
      return undefined;
    } else if (operator.text === '*') {
      if (term === 'dimension' && type === 'dimension') return undefined;
      if (type === 'dimension') term = type;
    } else {
      if (sum !== undefined && sum !== term) return undefined;
      sum = term;
      term = type;
    }
  }
  return sum === undefined || sum === term ? term : undefined;
}

/** The type of `calc()`, `clamp()`, `min()` or `max()`: the one type of all its arguments. */
function mathType(node: Node | undefined, accepts: Accepts): CalcType | undefined {
  if (node?.kind !== 'function') return undefined;
  const [least, most] = MATH[node.name] ?? [1, 0];
  const parts = listOf(node.nodes);
  if (parts.length < least || parts.length > most) return undefined;
  const [first, ...others] = parts.map((part) => sumType(part, accepts));
  return others.every((type) => type === first) ? first : undefined;
}

/** `calc()`, `clamp()`, `min()` or `max()` that gives a dimension which `accepts` allows. */
const isMath = (node: Node | undefined, accepts: Accepts): boolean => mathType(node, accepts) === 'dimension';

const hasLengthUnit = (node: NumberNode): boolean => LENGTH_UNITS.has(node.unit);

/** A length, a percentage or `0`, or a math function of those. */
const isSize = (node: Node | undefined): boolean => isLengthOrPercentage(node) || isMath(node, isLengthOrPercentage);

// Values: colors

/** The 148 named colors of CSS, in lower case. */
export const NAMED_COLORS: ReadonlySet<string> = new Set(
  `aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood
  cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray
  darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen
  darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue
  firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew
  hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan
  lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray
  lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue
  mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred
  midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid
  palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple
  rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue
  slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white
  whitesmoke yellow yellowgreen`.split(/\s+/),
);

const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/** What one channel of a color function may be. `none` is one more choice in the form without commas. */
type Channel = 'number' | 'percentage' | 'hue';

const NUMBER_OR_PERCENTAGE: readonly Channel[] = ['number', 'percentage'];
const PERCENTAGE: readonly Channel[] = ['percentage'];
const HUE: readonly Channel[] = ['hue'];

/** The color functions of 7.4 that take three channels and an optional alpha, each with its channels. */
const COLOR_FUNCTIONS: Readonly<Record<string, readonly (readonly Channel[])[]>> = {
  rgb: [NUMBER_OR_PERCENTAGE, NUMBER_OR_PERCENTAGE, NUMBER_OR_PERCENTAGE],
  hsl: [HUE, PERCENTAGE, PERCENTAGE],
  hwb: [HUE, PERCENTAGE, PERCENTAGE],
  lab: [NUMBER_OR_PERCENTAGE, NUMBER_OR_PERCENTAGE, NUMBER_OR_PERCENTAGE],
  lch: [NUMBER_OR_PERCENTAGE, NUMBER_OR_PERCENTAGE, HUE],
  oklab: [NUMBER_OR_PERCENTAGE, NUMBER_OR_PERCENTAGE, NUMBER_OR_PERCENTAGE],
  oklch: [NUMBER_OR_PERCENTAGE, NUMBER_OR_PERCENTAGE, HUE],
};

/** The color functions that also have the older form with commas. */
const COMMA_FUNCTIONS: readonly string[] = ['rgb', 'hsl'];

/** The color spaces of `color()` that 7.4 accepts: every predefined space other than `display-p3`. */
const COLOR_SPACES: readonly string[] = [
  'srgb',
  'srgb-linear',
  'a98-rgb',
  'prophoto-rgb',
  'rec2020',
  'xyz',
  'xyz-d50',
  'xyz-d65',
];

const REFUSED_SPACE = 'display-p3';

/** Says whether the node is a channel of one of the kinds. A hue is a number or an angle, never a percentage. */
const isChannel = (node: Node | undefined, kinds: readonly Channel[]): boolean =>
  node?.kind === 'number' &&
  kinds.some((kind) => {
    if (kind === 'number') return node.unit === '';
    if (kind === 'percentage') return node.unit === '%';
    return node.unit === '' || ANGLE_UNITS.includes(node.unit);
  });

/**
 * The form with commas: `a, b, c` or `a, b, c, d`. It has no `none`, and the three channels of `rgb()` are all
 * numbers or all percentages.
 */
function isCommaChannels(name: string, words: readonly Node[], kinds: readonly (readonly Channel[])[]): boolean {
  const parts = listOf(words);
  if (!COMMA_FUNCTIONS.includes(name) || (parts.length !== 3 && parts.length !== 4)) return false;
  const [first, second, third, alpha] = parts.map((part) => (part.length === 1 ? part[0] : undefined));
  const channels = [first, second, third];
  if (!channels.every((node, index) => isChannel(node, kinds[index] ?? []))) return false;
  if (parts.length === 4 && !isChannel(alpha, NUMBER_OR_PERCENTAGE)) return false;
  return name !== 'rgb' || channels.every((node) => isPercentage(node) === isPercentage(first));
}

/** The form without commas: `a b c` or `a b c / d`. Each part may be `none`. */
function isSpaceChannels(words: readonly Node[], kinds: readonly (readonly Channel[])[]): boolean {
  const [first, second, third, slash, alpha, ...rest] = words;
  if (rest.length > 0 || (words.length !== 3 && words.length !== 5)) return false;
  if (words.length === 5 && slash?.kind !== 'slash') return false;
  const fits = (node: Node | undefined, channel: readonly Channel[]): boolean =>
    isKeyword(node, 'none') || isChannel(node, channel);
  if (![first, second, third].every((node, index) => fits(node, kinds[index] ?? []))) return false;
  return words.length === 3 || fits(alpha, NUMBER_OR_PERCENTAGE);
}

/** A color of 7.4 that is no alias: a hex color, a color function, a named color or `transparent`. */
function isColor(node: Node | undefined): boolean {
  if (node === undefined) return false;
  if (node.kind === 'hash') return HEX_COLOR.test(node.text);
  if (node.kind === 'ident') return NAMED_COLORS.has(node.text.toLowerCase()) || isKeyword(node, 'transparent');
  if (node.kind !== 'function') return false;
  const words = wordsOf(node.nodes);
  const kinds = COLOR_FUNCTIONS[node.name];
  if (kinds !== undefined) {
    return words.some((word) => word.kind === 'comma')
      ? isCommaChannels(node.name, words, kinds)
      : isSpaceChannels(words, kinds);
  }
  const [space, ...channels] = words;
  return (
    node.name === 'color' &&
    isKeyword(space, ...COLOR_SPACES) &&
    isSpaceChannels(channels, [NUMBER_OR_PERCENTAGE, NUMBER_OR_PERCENTAGE, NUMBER_OR_PERCENTAGE])
  );
}

/** Why 7.4 refuses a color that CSS knows: the minifier replaces it, so a page would not show the design value. */
function refusedColor(node: Node | undefined): string | undefined {
  if (node?.kind !== 'function') return undefined;
  if (node.name === 'color-mix') return '`color-mix()` is not accepted: write the mixed color as its result';
  if (node.name === 'color' && isKeyword(wordsOf(node.nodes)[0], REFUSED_SPACE)) {
    return '`color(display-p3 …)` is not accepted: write a wide color in `oklch()` or `lab()`';
  }
  return undefined;
}

// Values: one grammar for each family

/** A grammar: says whether the value parses, and adds each token that a `var()` in it names to `refs`. */
type Grammar = (nodes: readonly Node[], refs: string[]) => boolean;

/** A `var()` that names a color token. The name goes to `refs`. */
function isColorVar(node: Node | undefined, refs: string[]): boolean {
  const name = varName(node);
  if (name === undefined || familyOf(name) !== 'color') return false;
  refs.push(name);
  return true;
}

const one =
  (accepts: (node: Node | undefined) => boolean): Grammar =>
  (nodes) =>
    accepts(only(nodes));

/** `--size-` also accepts a ratio `<n> / <m>` of two positive numbers. */
const isRatio = (nodes: readonly Node[]): boolean => {
  const [first, slash, second, ...rest] = wordsOf(nodes);
  return (
    rest.length === 0 &&
    isNumber(first) &&
    first.value > 0 &&
    slash?.kind === 'slash' &&
    isNumber(second) &&
    second.value > 0
  );
};

/** A font-family list: each entry is one string, or one or more identifiers. */
const isFontList: Grammar = (nodes) =>
  listOf(nodes).every(
    (part) =>
      part.length > 0 &&
      ((part.length === 1 && part[0]?.kind === 'string') ||
        part.every((node) => node.kind === 'ident' && !node.text.startsWith('--'))),
  );

/** One shadow: two to four lengths in a row, and in any place one color and the keyword `inset`. */
function isShadow(words: readonly Node[], refs: string[]): boolean {
  const lengths: number[] = [];
  let colors = 0;
  let insets = 0;
  for (const [index, node] of words.entries()) {
    if (isLength(node) || isMath(node, hasLengthUnit)) lengths.push(index);
    else if (isKeyword(node, 'inset')) insets += 1;
    else if (isColor(node) || isColorVar(node, refs)) colors += 1;
    else return false;
  }
  const [first] = lengths;
  const last = lengths.at(-1);
  if (first === undefined || last === undefined) return false;
  return (
    lengths.length >= 2 && lengths.length <= 4 && last - first + 1 === lengths.length && colors <= 1 && insets <= 1
  );
}

const isShadowList: Grammar = (nodes, refs) =>
  isKeyword(only(nodes), 'none') || listOf(nodes).every((part) => isShadow(part, refs));

const GRADIENTS: readonly string[] = ['linear-gradient', 'radial-gradient', 'conic-gradient'].flatMap((name) => [
  name,
  `repeating-${name}`,
]);

/**
 * Every keyword that a gradient may hold: directions, shapes, sizes, and the words of the color interpolation.
 * Any other word fails. So no named color and no system color such as `Canvas` gets into a gradient.
 */
const GRADIENT_KEYWORDS: ReadonlySet<string> = new Set(
  `to at from in top bottom left right center circle ellipse
  closest-side closest-corner farthest-side farthest-corner
  srgb srgb-linear display-p3 a98-rgb prophoto-rgb rec2020 lab oklab xyz xyz-d50 xyz-d65 hsl hwb lch oklch
  shorter longer increasing decreasing hue`.split(/\s+/),
);

/**
 * One gradient function. Every color in it is `var(--color-…)`, and it has at least one. Angles, stop positions
 * and lengths are free: any number, dimension, calculation and keyword of `GRADIENT_KEYWORDS` passes. A `/` has
 * no place in a gradient outside a calculation.
 */
const isGradient: Grammar = (nodes, refs) => {
  const gradient = only(nodes);
  if (gradient?.kind !== 'function' || !GRADIENTS.includes(gradient.name)) return false;
  const colors: string[] = [];
  const free = wordsOf(gradient.nodes).every((node) => {
    if (node.kind === 'number' || node.kind === 'comma') return true;
    if (node.kind === 'ident') return GRADIENT_KEYWORDS.has(node.text.toLowerCase());
    return isColorVar(node, colors) || mathType(node, () => true) !== undefined;
  });
  refs.push(...colors);
  return free && colors.length > 0;
};

const EASE_KEYWORDS: readonly string[] = [
  'linear',
  'ease',
  'ease-in',
  'ease-out',
  'ease-in-out',
  'step-start',
  'step-end',
];

const STEP_POSITIONS: readonly string[] = ['jump-start', 'jump-end', 'jump-none', 'jump-both', 'start', 'end'];

const inUnit = (node: Node | undefined): boolean => isNumber(node) && node.value >= 0 && node.value <= 1;

/** `cubic-bezier()` with four numbers, `steps()` with a count and an optional position, or `linear()` with stops. */
function isEaseFunction(node: Node | undefined): boolean {
  if (node?.kind !== 'function') return false;
  const parts = listOf(node.nodes);
  if (node.name === 'cubic-bezier') {
    const [x1, y1, x2, y2] = parts.map((part) => (part.length === 1 ? part[0] : undefined));
    return parts.length === 4 && inUnit(x1) && isNumber(y1) && inUnit(x2) && isNumber(y2);
  }
  if (node.name === 'steps') {
    const [count, position] = parts;
    const [steps] = count ?? [];
    if (count?.length !== 1 || !isInteger(steps) || steps.value < 1) return false;
    return (
      parts.length === 1 || (parts.length === 2 && position?.length === 1 && isKeyword(position[0], ...STEP_POSITIONS))
    );
  }
  if (node.name !== 'linear') return false;
  return (
    parts.length >= 2 &&
    parts.every((part) => {
      const numbers = part.filter((stop) => isNumber(stop));
      const positions = part.filter((stop) => isPercentage(stop));
      return numbers.length === 1 && positions.length <= 2 && numbers.length + positions.length === part.length;
    })
  );
}

const GRAMMARS: Readonly<Record<TokenFamily, Grammar>> = {
  color: one(isColor),
  space: one(isSize),
  size: (nodes) => isSize(only(nodes)) || isRatio(nodes),
  font: isFontList,
  text: one(isSize),
  leading: one(
    (node) => (isNumber(node) && node.value >= 0) || isLengthOrPercentage(node) || isKeyword(node, 'normal'),
  ),
  weight: one(
    (node) => (isInteger(node) && node.value >= 1 && node.value <= 1000) || isKeyword(node, 'normal', 'bold'),
  ),
  tracking: one((node) => isLength(node) || isKeyword(node, 'normal')),
  radius: one(isSize),
  line: one(isSize),
  shadow: isShadowList,
  z: one(isInteger),
  duration: one((node) => node?.kind === 'number' && (node.unit === 'ms' || node.unit === 's') && node.value >= 0),
  ease: one((node) => isKeyword(node, ...EASE_KEYWORDS) || isEaseFunction(node)),
  opacity: one(
    (node) =>
      (isNumber(node) && node.value >= 0 && node.value <= 1) ||
      (isPercentage(node) && node.value >= 0 && node.value <= 100),
  ),
  gradient: isGradient,
};

const LENGTHS = 'a length, a percentage or `0`, or `calc()`, `clamp()`, `min()` or `max()` of those';

/** What a value of each family may be (7.4), for the detail of a finding. */
const ACCEPTED: Readonly<Record<TokenFamily, string>> = {
  color:
    'a hex color with 3, 4, 6 or 8 digits, `rgb()`, `hsl()`, `hwb()`, `lab()`, `lch()`, `oklab()`, `oklch()`, `color()` in a space other than `display-p3`, a named color or `transparent`',
  space: LENGTHS,
  size: `${LENGTHS}, or a ratio such as \`16 / 9\``,
  font: 'a font-family list: names in quotes or as plain words, with commas between them',
  text: LENGTHS,
  leading: 'a number, a length, a percentage or `normal`',
  weight: 'an integer from 1 to 1000, `normal` or `bold`',
  tracking: 'a length or `normal`',
  radius: LENGTHS,
  line: LENGTHS,
  shadow: '`none` or a shadow list: each shadow has two to four lengths, and its color may be `var(--color-…)`',
  z: 'an integer',
  duration: 'a time in `ms` or `s`',
  ease: 'an easing keyword, `cubic-bezier()`, `steps()` or `linear()`',
  opacity: 'a number from 0 to 1 or a percentage from 0% to 100%',
  gradient:
    'one `linear-gradient()`, `radial-gradient()` or `conic-gradient()`, or its `repeating-` form, in which every color is `var(--color-…)`',
};

/**
 * Checks one value of a family (7.4). Returns the problem, or `undefined` for a value that parses. `refs` gets
 * each token that the value names with `var()`: an alias of the same family, or a color token in a shadow or a
 * gradient.
 */
function valueProblem(family: TokenFamily, text: string, refs: string[]): string | undefined {
  if (hasRefusedCharacter(text)) {
    return `\`${text}\` is no value of a \`${TOKEN_PREFIXES[family]}\` token: write it without a control character, without \`<\` and without a backslash, also inside quotes`;
  }
  const nodes = lex(text) ?? [];
  const alias = varName(only(nodes));
  if (alias !== undefined) {
    if (familyOf(alias) !== family) {
      return `\`${text}\` is no alias for a \`${TOKEN_PREFIXES[family]}\` token: an alias is \`var(${TOKEN_PREFIXES[family]}…)\``;
    }
    refs.push(alias);
    return undefined;
  }
  const refused = family === 'color' ? refusedColor(only(nodes)) : undefined;
  if (refused !== undefined) return refused;
  const found: string[] = [];
  if (!GRAMMARS[family](nodes, found)) {
    return `\`${text}\` is no value of a \`${TOKEN_PREFIXES[family]}\` token: write ${ACCEPTED[family]}, or an alias \`var(${TOKEN_PREFIXES[family]}…)\``;
  }
  refs.push(...found);
  return undefined;
}

/** The token that a value is an alias of, else `undefined`. */
function aliasOf(text: string | undefined): string | undefined {
  return text === undefined ? undefined : varName(only(lex(text) ?? []));
}

// The document

/** The work of one `parseDesign` call: the sections of the text, and what the checks found. */
interface Doc {
  sections: readonly Section[];
  /** Adds one finding. Line 0 is the file itself. */
  fail: (line: number, detail: string) => void;
  /** Every token name with the line of its row. */
  names: Map<string, number>;
  /** Each token that a value names with `var()`, with the line of the row that names it. */
  refs: { line: number; name: string }[];
  /** False when a token table could not be read. Then the checks across tables do not run. */
  complete: boolean;
}

/** One table of the document: its rows that fit the header, and the count of all its rows. */
interface Read {
  /** The line of the header row. */
  line: number;
  rows: Row[];
  count: number;
}

const headerText = (header: readonly string[]): string => `| ${header.join(' | ')} |`;

/** The cell of a row. A row that is shorter than the header has empty cells at its end, as in Markdown. */
const cell = (row: Row, index: number): string => row.cells[index] ?? '';

/**
 * The one table of a section. It reports a missing required section, a section that is there twice, a section
 * without a table or with two, a header row that differs, a missing delimiter row, and a row with too many cells.
 * Without `header` it checks only that the section and its table exist, and it returns nothing.
 */
function readTable(doc: Doc, name: string, header: readonly string[] | undefined, required: boolean): Read | undefined {
  const [section, ...again] = doc.sections.filter((other) => other.name === name);
  if (section === undefined) {
    if (required) doc.fail(0, `the section \`## ${name}\` is missing`);
    return undefined;
  }
  for (const other of again) doc.fail(other.line, `the section \`## ${name}\` is in the file twice`);
  const [table, ...more] = section.tables;
  if (table === undefined) {
    doc.fail(section.line, `the section \`## ${name}\` has no table`);
    return undefined;
  }
  for (const other of more) doc.fail(other.line, `the section \`## ${name}\` holds one table: this is a second one`);
  if (header === undefined) return undefined;
  if (table.header.length !== header.length || table.header.some((text, index) => text !== header[index])) {
    doc.fail(table.line, `the header row must be \`${headerText(header)}\``);
    return undefined;
  }
  if (!table.delimiter) {
    doc.fail(table.line, 'the line below the header row must be the delimiter row, such as `|---|---|`');
    return undefined;
  }
  const rows: Row[] = [];
  for (const row of table.rows) {
    if (row.cells.length <= header.length) rows.push(row);
    else doc.fail(row.line, `the row has ${row.cells.length} cells, and the header row has ${header.length}`);
  }
  return { line: table.line, rows, count: table.rows.length };
}

/** Records a name. A name that the map holds is a finding, and the result is false. */
function isFirst(doc: Doc, seen: Map<string, number>, name: string, line: number): boolean {
  const first = seen.get(name);
  if (first === undefined) {
    seen.set(name, line);
    return true;
  }
  doc.fail(line, `\`${name}\` is declared twice: the first row is on line ${first}`);
  return false;
}

/** The family of the token in the first cell of a row, when the name is right for the section and new. */
function tokenFamily<Family extends TokenFamily>(
  doc: Doc,
  row: Row,
  section: string,
  families: readonly Family[],
): Family | undefined {
  const name = cell(row, 0);
  const prefixes = families.map((other) => `\`${TOKEN_PREFIXES[other]}\``).join(', ');
  if (name === '') {
    doc.fail(row.line, 'the cell `Token` is empty');
    return undefined;
  }
  const family = familyOf(name);
  if (family === undefined) {
    doc.fail(
      row.line,
      `\`${name}\` is no token name: write ${prefixes} and then lower-case letters, digits and single hyphens`,
    );
    return undefined;
  }
  const known = families.find((other) => other === family);
  if (known === undefined) {
    doc.fail(row.line, `\`${name}\` belongs in \`## ${sectionOf(family)}\`: \`## ${section}\` holds ${prefixes}`);
    return undefined;
  }
  return isFirst(doc, doc.names, name, row.line) ? known : undefined;
}

/** Checks one value and keeps the tokens that it names. */
function checkValue(doc: Doc, row: Row, family: TokenFamily, text: string): void {
  const refs: string[] = [];
  const problem = valueProblem(family, text, refs);
  if (problem !== undefined) doc.fail(row.line, problem);
  for (const name of refs) doc.refs.push({ line: row.line, name });
}

const THEME_LIST = THEMES.map((theme) => `\`${theme}\``).join(', ');

const isTheme = (text: string): text is Theme => THEMES.some((theme) => theme === text);

/** `## Themes`: the declared themes in the order of `THEMES`, or `undefined` when the table could not be read. */
function readThemes(doc: Doc): Theme[] | undefined {
  const table = readTable(doc, 'Themes', HEADERS.themes, true);
  if (table === undefined) return undefined;
  const seen = new Map<string, number>();
  for (const row of table.rows) {
    const name = cell(row, 0);
    if (isTheme(name)) isFirst(doc, seen, name, row.line);
    else doc.fail(row.line, `\`${name}\` is no theme: the themes are ${THEME_LIST}`);
  }
  if (!seen.has('light') && !seen.has('dark')) {
    doc.fail(table.line, 'declare at least one of the base themes `light` and `dark`');
  }
  for (const [contrast, base] of [
    ['light-contrast', 'light'],
    ['dark-contrast', 'dark'],
  ] as const) {
    const line = seen.get(contrast);
    if (line !== undefined && !seen.has(base)) doc.fail(line, `\`${contrast}\` needs the theme \`${base}\``);
  }
  return THEMES.filter((theme) => seen.has(theme));
}

/** The value of a color in one theme, with the fallback of 7.4. */
function fallbackValue(values: ColorToken['values'], theme: Theme): string | undefined {
  for (const next of THEME_FALLBACKS[theme]) {
    const value = values[next];
    if (value !== undefined) return value;
  }
  return undefined;
}

/** `## Color`. Without known themes the header row is unknown, so the rows are not read. */
function readColors(doc: Doc, themes: readonly Theme[] | undefined): ColorToken[] {
  const header = themes === undefined || themes.length === 0 ? undefined : ['Token', ...themes, 'Use'];
  const table = readTable(doc, COLOR_SECTION, header, true);
  const colors: ColorToken[] = [];
  if (table === undefined || themes === undefined) {
    doc.complete = false;
    return colors;
  }
  if (table.count === 0) doc.fail(table.line, 'the table needs at least one row');
  for (const row of table.rows) {
    if (tokenFamily(doc, row, COLOR_SECTION, ['color']) === undefined) continue;
    const values: ColorToken['values'] = {};
    for (const [index, theme] of themes.entries()) {
      const text = cell(row, index + 1);
      if (text === '') continue;
      values[theme] = text;
      checkValue(doc, row, 'color', text);
    }
    const name = cell(row, 0);
    const empty = themes.filter((theme) => fallbackValue(values, theme) === undefined);
    if (empty.length > 0) {
      const list = empty.map((theme) => `\`${theme}\``).join(', ');
      doc.fail(
        row.line,
        `\`${name}\` has no value for ${list}: the cell is empty, and so is each cell that it falls back to`,
      );
    }
    colors.push({ name, values, line: row.line });
  }
  return colors;
}

/** One token section other than `## Color`. */
function readTokens(doc: Doc, section: string, families: readonly ValueFamily[], required: boolean): ValueToken[] {
  const table = readTable(doc, section, HEADERS.tokens, required);
  const tokens: ValueToken[] = [];
  if (table === undefined) {
    if (required || doc.sections.some((other) => other.name === section)) doc.complete = false;
    return tokens;
  }
  for (const row of table.rows) {
    const family = tokenFamily(doc, row, section, families);
    if (family === undefined) continue;
    const name = cell(row, 0);
    const value = cell(row, 1);
    if (value === '') doc.fail(row.line, `\`${name}\` has no value`);
    else checkValue(doc, row, family, value);
    tokens.push({ name, family, value, line: row.line });
  }
  // The counts of the rule row: a row counts by its prefix, also when its value does not parse.
  const starts = (family: ValueFamily): boolean =>
    table.rows.some((row) => cell(row, 0).startsWith(TOKEN_PREFIXES[family]));
  if (section === 'Typography') {
    for (const family of ['font', 'text'] as const) {
      if (!starts(family)) doc.fail(table.line, `the table needs at least one \`${TOKEN_PREFIXES[family]}\` row`);
    }
  }
  if (section === 'Spacing' && table.count === 0) doc.fail(table.line, 'the table needs at least one row');
  return tokens;
}

/** `## Layout helpers`: the parameters of 7.5, each set to `var()` of a token of its family. */
function readHelpers(doc: Doc): HelperParameter[] {
  const helpers: HelperParameter[] = [];
  const seen = new Map<string, number>();
  const known = Object.keys(HELPER_PARAMETERS)
    .map((name) => `\`${name}\``)
    .join(', ');
  for (const row of readTable(doc, 'Layout helpers', HEADERS.helpers, false)?.rows ?? []) {
    const name = cell(row, 0);
    const token = cell(row, 1);
    const family = HELPER_PARAMETERS[name];
    if (family === undefined) {
      doc.fail(row.line, `\`${name}\` is no helper parameter: the parameters are ${known}`);
      continue;
    }
    if (!isFirst(doc, seen, name, row.line)) continue;
    const target = aliasOf(token);
    if (target === undefined || familyOf(target) !== family) {
      doc.fail(row.line, `the token of \`${name}\` must be \`var(${TOKEN_PREFIXES[family]}…)\``);
    } else {
      doc.refs.push({ line: row.line, name: target });
    }
    helpers.push({ name, token, line: row.line });
  }
  return helpers;
}

/** `## Breakpoints`. The table may have no row. */
function readBreakpoints(doc: Doc): Breakpoint[] {
  const breakpoints: Breakpoint[] = [];
  const seen = new Map<string, number>();
  for (const row of readTable(doc, 'Breakpoints', HEADERS.breakpoints, true)?.rows ?? []) {
    const name = cell(row, 0);
    const width = cell(row, 1);
    if (!BREAKPOINT_NAME.test(name)) {
      doc.fail(
        row.line,
        `\`${name}\` is no breakpoint name: start with a lower-case letter, then letters, digits and hyphens`,
      );
    } else {
      isFirst(doc, seen, name, row.line);
    }
    if (!BREAKPOINT_WIDTH.test(width)) {
      doc.fail(
        row.line,
        `\`${width}\` is no breakpoint width: write a number with \`rem\`, \`em\` or \`px\`, such as \`48rem\``,
      );
    }
    breakpoints.push({ name, width, line: row.line });
  }
  return breakpoints;
}

/** `## Contrast pairs`. `design-pairs` checks the tokens and the roles. */
function readPairs(doc: Doc): ContrastPair[] {
  const table = readTable(doc, 'Contrast pairs', HEADERS.pairs, true);
  if (table === undefined) return [];
  if (table.count === 0) doc.fail(table.line, 'the table needs at least one pair');
  return table.rows.map((row) => ({
    foreground: cell(row, 0),
    background: cell(row, 1),
    role: cell(row, 2),
    for: cell(row, 3),
    line: row.line,
  }));
}

/** `## Elements` or `## Components`. `design-specs` checks the rows. */
function readSpecs(doc: Doc, section: string): DesignSpec[] {
  const rows = readTable(doc, section, HEADERS.specs, false)?.rows ?? [];
  return rows.map((row) => ({ selector: cell(row, 0), property: cell(row, 1), token: cell(row, 2), line: row.line }));
}

/**
 * The names that lie on a circle of the graph: a name that leads back to itself. `targets` gives the names that a
 * name depends on. This is the search for strongly connected components of Tarjan, without recursion: it visits
 * each name once, so a long chain of aliases is cheap and cannot use up the call stack.
 */
function onCircle(names: readonly string[], targets: (name: string) => readonly string[]): Set<string> {
  const found = new Set<string>();
  /** The order in which the search reached each name. */
  const order = new Map<string, number>();
  /** The earliest name, by `order`, that each name reaches on the open stack. */
  const lowest = new Map<string, number>();
  /** The names whose component is not closed yet. */
  const open: string[] = [];
  const isOpen = new Set<string>();
  const lower = (name: string, value: number): void => {
    lowest.set(name, Math.min(lowest.get(name) ?? value, value));
  };
  const enter = (name: string): { name: string; next: number } => {
    order.set(name, order.size);
    lowest.set(name, order.size - 1);
    open.push(name);
    isOpen.add(name);
    return { name, next: 0 };
  };
  for (const start of names) {
    if (order.has(start)) continue;
    const path = [enter(start)];
    for (let top = path.at(-1); top !== undefined; top = path.at(-1)) {
      const { name } = top;
      const target = targets(name)[top.next];
      top.next += 1;
      if (target === name) {
        found.add(name);
      } else if (target !== undefined && !order.has(target)) {
        path.push(enter(target));
      } else if (target !== undefined) {
        if (isOpen.has(target)) lower(name, order.get(target) ?? 0);
      } else {
        path.pop();
        const low = lowest.get(name) ?? 0;
        const parent = path.at(-1);
        if (parent !== undefined) lower(parent.name, low);
        if (low !== order.get(name)) continue;
        // `name` closes a component: the names above it on the open stack. More than one name is a circle.
        const members = open.splice(open.lastIndexOf(name));
        for (const member of members) {
          isOpen.delete(member);
          if (members.length > 1) found.add(member);
        }
      }
    }
  }
  return found;
}

/** The two contrast levels of 7.7, each with the theme of its light side and of its dark side. */
const LEVELS: readonly (readonly [light: Theme, dark: Theme])[] = [
  ['light', 'dark'],
  ['light-contrast', 'dark-contrast'],
];

/**
 * The checks across tables: each `var()` names a token of the file, and no alias leads back to its token.
 *
 * A color has one declaration at each contrast level (7.7): `light-dark(L, K)` with the two base themes, else the
 * one side. A browser reads both sides of `light-dark()` when it looks for a circle. So at each level a color
 * depends on the alias of each side that the declaration holds, and a circle that goes through the light side of
 * one color and the dark side of another is a circle too.
 */
function checkReferences(
  doc: Doc,
  themes: readonly Theme[],
  colors: readonly ColorToken[],
  tokens: readonly ValueToken[],
): void {
  for (const ref of doc.refs) {
    if (!doc.names.has(ref.name)) doc.fail(ref.line, `\`var(${ref.name})\` names no token of this file`);
  }
  const fail = (token: { name: string; line: number }): void =>
    doc.fail(token.line, `the alias of \`${token.name}\` leads back to \`${token.name}\``);

  const aliases = new Map(tokens.map((token) => [token.name, aliasOf(token.value)]));
  const circle = onCircle([...aliases.keys()], (name) => {
    const target = aliases.get(name);
    return target === undefined ? [] : [target];
  });
  for (const token of tokens) {
    if (circle.has(token.name)) fail(token);
  }

  const looping = new Set<string>();
  for (const [light, dark] of LEVELS) {
    const sides = [themes.includes('light') ? light : undefined, themes.includes('dark') ? dark : undefined];
    const targets = new Map(
      colors.map((color) => [
        color.name,
        sides.flatMap((theme) => {
          const target = theme === undefined ? undefined : aliasOf(fallbackValue(color.values, theme));
          return target === undefined ? [] : [target];
        }),
      ]),
    );
    for (const name of onCircle([...targets.keys()], (other) => targets.get(other) ?? [])) looping.add(name);
  }
  for (const color of colors) {
    if (looping.has(color.name)) fail(color);
  }
}

/**
 * Parses the text of `docs/design.md` and adds every `design-format` finding to the report, in the order of the
 * lines. Returns the design only when it added no finding. It never throws.
 */
export function parseDesign(text: string, report: Report, file: string = DESIGN_FILE): Design | undefined {
  const problems: { line: number; detail: string }[] = [];
  const doc: Doc = {
    sections: sectionsOf(text),
    fail: (line, detail) => {
      problems.push({ line, detail });
    },
    names: new Map(),
    refs: [],
    complete: true,
  };
  const themes = readThemes(doc);
  const colors = readColors(doc, themes);
  const tokens = TOKEN_SECTIONS.flatMap(([section, families, required]) =>
    readTokens(doc, section, families, required),
  );
  const helpers = readHelpers(doc);
  const breakpoints = readBreakpoints(doc);
  const pairs = readPairs(doc);
  const elements = readSpecs(doc, 'Elements');
  const components = readSpecs(doc, 'Components');
  if (doc.complete && themes !== undefined) checkReferences(doc, themes, colors, tokens);
  if (problems.length === 0 && themes !== undefined) {
    return { themes, colors, tokens, helpers, breakpoints, pairs, elements, components };
  }
  // A stable sort: the findings of the file come first, then those of each line in the order of the checks.
  for (const { line, detail } of problems.toSorted((a, b) => a.line - b.line)) {
    report.add(RULE, line === 0 ? file : `${file}:${line}`, detail);
  }
  return undefined;
}

/**
 * Reads `<root>/docs/design.md`. A missing file is one finding at `docs/design.md`. Returns the design only when
 * the file passes `design-format`.
 */
export function loadDesign(root: string, report: Report): Design | undefined {
  const path = join(root, DESIGN_FILE);
  const stats = statSync(path, { throwIfNoEntry: false });
  if (stats === undefined) {
    report.add(RULE, DESIGN_FILE, 'the file is missing');
    return undefined;
  }
  if (!stats.isFile()) {
    report.add(RULE, DESIGN_FILE, 'this is not a file');
    return undefined;
  }
  return parseDesign(readFileSync(path, 'utf8'), report);
}

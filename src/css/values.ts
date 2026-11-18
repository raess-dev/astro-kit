/**
 * The value analyzers of the kit (specification, 3.2 and 7.3): the literal classifier of `css-literal`, the token
 * family map of `css-token-family`, the `var()` extraction of `css-local-var`, `css-var-undefined`, `design-specs`
 * and `design-pairs`, and the value checks of `css-banned` (viewport units, `url()`).
 *
 * Every function reads the trees of `parse.ts`, source CSS and built CSS alike (13.1 items 4 and 40). None reports
 * a finding: each gives facts with a place, and the rules of M5 add the rule id. None throws. Every table is a map
 * or a set, so a name from the input such as `constructor` or `__proto__` finds nothing.
 */
import type { TokenFamily } from '../context.ts';
import { HELPER_PARAMETERS, NAMED_COLORS } from '../design/parse.ts';
import {
  asciiLower,
  type ComponentValue,
  type Declaration,
  type DimensionToken,
  type FunctionValue,
  type IdentToken,
  isDelim,
  isIdent,
  MAX_DEPTH,
  type NumberToken,
  type ParseProblem,
  type PercentageToken,
  type Place,
  serialize,
  trimWhitespace,
} from './parse.ts';

// Property names

/** The vendor prefixes that the minifier adds (`-webkit-backdrop-filter`, `-moz-text-size-adjust`). */
const VENDOR_PREFIXES: readonly string[] = ['-webkit-', '-moz-', '-ms-', '-o-'];

/** Says whether a property name is a custom property (`--…`): a definition in the sense of 7.3. */
export function isCustomProperty(property: string): boolean {
  return property.startsWith('--');
}

/**
 * The name under which the tables of this module know a property: ASCII lower case and without a vendor prefix, so
 * `-webkit-backdrop-filter` reads as `backdrop-filter`. A custom property keeps its name.
 */
function canonicalProperty(property: string): string {
  if (isCustomProperty(property)) return property;
  const lower = asciiLower(property);
  for (const prefix of VENDOR_PREFIXES) if (lower.startsWith(prefix)) return lower.slice(prefix.length);
  return lower;
}

/** A function name without a vendor prefix: `-webkit-linear-gradient` is `linear-gradient`. */
function canonicalFunction(name: string): string {
  for (const prefix of VENDOR_PREFIXES) if (name.startsWith(prefix)) return name.slice(prefix.length);
  return name;
}

const SIDES: readonly string[] = ['top', 'right', 'bottom', 'left'];
const LOGICAL_SIDES: readonly string[] = ['block', 'block-start', 'block-end', 'inline', 'inline-start', 'inline-end'];

/** `margin`, `margin-top` … `margin-inline-end`: a box property and each of its physical and logical sides. */
const withSides = (base: string): string[] => [
  base,
  ...SIDES.map((side) => `${base}-${side}`),
  ...LOGICAL_SIDES.map((side) => `${base}-${side}`),
];

/** `border` and its sides: the shorthands that hold a color part and a width part. */
const BORDER_SHORTHANDS: readonly string[] = withSides('border');
const BORDER_COLORS: readonly string[] = BORDER_SHORTHANDS.map((name) => `${name}-color`);
const BORDER_WIDTHS: readonly string[] = BORDER_SHORTHANDS.map((name) => `${name}-width`);
const BORDER_RADII: readonly string[] = [
  'border-radius',
  'border-top-left-radius',
  'border-top-right-radius',
  'border-bottom-right-radius',
  'border-bottom-left-radius',
  'border-start-start-radius',
  'border-start-end-radius',
  'border-end-start-radius',
  'border-end-end-radius',
];
const SIZES: readonly string[] = ['width', 'height', 'inline-size', 'block-size'].flatMap((name) => [
  name,
  `min-${name}`,
  `max-${name}`,
]);

/**
 * The properties of each family (7.3). A shorthand is listed under every family of its parts. The table of 7.3
 * names most of them; these follow from its rule "in a shorthand, each `var()` must belong to one of the
 * shorthand's families": `column-rule` (color, line), `text-emphasis` (color), the width part of `text-decoration`
 * (line), `grid-template` and `grid` (the track sizes, which the minifier merges into them), `mask` and
 * `border-image` (the image part).
 */
const FAMILY_PROPERTIES: readonly (readonly [TokenFamily, readonly string[]])[] = [
  [
    'color',
    [
      'color',
      'background-color',
      'background',
      ...BORDER_COLORS,
      ...BORDER_SHORTHANDS,
      'outline-color',
      'outline',
      'text-decoration-color',
      'text-decoration',
      'text-emphasis-color',
      'text-emphasis',
      'caret-color',
      'accent-color',
      'column-rule-color',
      'column-rule',
      'fill',
      'stroke',
      'scrollbar-color',
      'stop-color',
      'flood-color',
      'lighting-color',
    ],
  ],
  [
    'space',
    [
      ...withSides('margin'),
      ...withSides('padding'),
      'gap',
      'row-gap',
      'column-gap',
      'inset',
      ...LOGICAL_SIDES.map((side) => `inset-${side}`),
      ...SIDES,
      ...withSides('scroll-margin'),
      ...withSides('scroll-padding'),
      'text-indent',
      'translate',
    ],
  ],
  [
    'size',
    [
      ...SIZES,
      'flex-basis',
      'flex',
      'grid-template-columns',
      'grid-template-rows',
      'grid-auto-columns',
      'grid-auto-rows',
      'grid-template',
      'grid',
      'aspect-ratio',
      'contain-intrinsic-size',
      'translate',
    ],
  ],
  ['font', ['font-family', 'font']],
  ['text', ['font-size', 'font']],
  ['leading', ['line-height', 'font']],
  ['weight', ['font-weight', 'font']],
  ['tracking', ['letter-spacing', 'word-spacing']],
  ['radius', BORDER_RADII],
  [
    'line',
    [
      ...BORDER_WIDTHS,
      ...BORDER_SHORTHANDS,
      'outline-width',
      'outline',
      'outline-offset',
      'text-decoration-thickness',
      'text-decoration',
      'text-underline-offset',
      'column-rule-width',
      'column-rule',
      'stroke-width',
    ],
  ],
  ['shadow', ['box-shadow', 'text-shadow']],
  ['z', ['z-index']],
  [
    'duration',
    ['transition-duration', 'transition-delay', 'animation-duration', 'animation-delay', 'transition', 'animation'],
  ],
  ['ease', ['transition-timing-function', 'animation-timing-function', 'transition', 'animation']],
  ['opacity', ['opacity', 'fill-opacity', 'stroke-opacity']],
  ['gradient', ['background-image', 'background', 'mask-image', 'mask', 'border-image-source', 'border-image']],
];

const FAMILIES_OF: ReadonlyMap<string, ReadonlySet<TokenFamily>> = (() => {
  const map = new Map<string, Set<TokenFamily>>();
  for (const [family, properties] of FAMILY_PROPERTIES) {
    for (const property of properties) {
      const set = map.get(property) ?? new Set<TokenFamily>();
      set.add(family);
      map.set(property, set);
    }
  }
  return map;
})();

/** The length group of 7.3: space, size, line, radius, text. */
export const LENGTH_GROUP: ReadonlySet<TokenFamily> = new Set<TokenFamily>(['space', 'size', 'line', 'radius', 'text']);

/** The math functions of 7.3: calc, min, max, clamp, minmax, fit-content. */
export const MATH_FUNCTIONS: ReadonlySet<string> = new Set(['calc', 'min', 'max', 'clamp', 'minmax', 'fit-content']);

/**
 * The families that a property accepts (7.3): its row(s) of the table, and for a shorthand the families of all its
 * parts (border: line + color; font: font + text + leading + weight; background: color + gradient; flex: size;
 * transition and animation: duration + ease; outline, column-rule, text-decoration …). `undefined`: a property
 * with no family, also a custom property. A vendor prefix is ignored, and the case of the name too.
 */
export function propertyFamilies(property: string): ReadonlySet<TokenFamily> | undefined {
  return FAMILIES_OF.get(canonicalProperty(property));
}

/** The properties whose `var()` may bring a `--color-` token inside `drop-shadow()` (7.3). */
const DROP_SHADOW_PROPERTIES: ReadonlySet<string> = new Set(['filter', 'backdrop-filter']);

/**
 * Says whether a property accepts a token of `family` where the var() stands (7.3): one of its families; any family of
 * the length group inside a math function when the property's family is in the group; the length group for a property
 * with no family; and `color` in `filter` and `backdrop-filter` inside `drop-shadow()`.
 */
export function acceptsFamily(
  property: string,
  family: TokenFamily,
  use: Pick<VarUse, 'inMath' | 'functions'>,
): boolean {
  const families = propertyFamilies(property);
  if (families === undefined) {
    if (LENGTH_GROUP.has(family)) return true;
    return (
      family === 'color' &&
      DROP_SHADOW_PROPERTIES.has(canonicalProperty(property)) &&
      use.functions.some((name) => canonicalFunction(name) === 'drop-shadow')
    );
  }
  if (families.has(family)) return true;
  return use.inMath && LENGTH_GROUP.has(family) && [...families].some((each) => LENGTH_GROUP.has(each));
}

/**
 * The family of a helper parameter (7.5): `--stack-gap` is `space`. Any other name, `constructor` too, has none.
 * `HELPER_PARAMETERS` is a plain object, so this reads it only through `Object.hasOwn`.
 */
export function helperParameterFamily(name: string): 'space' | 'size' | undefined {
  return Object.hasOwn(HELPER_PARAMETERS, name) ? HELPER_PARAMETERS[name] : undefined;
}

// var() extraction

/** One var() of a value. */
export interface VarUse {
  /** The custom property it reads: `--space-2`. `''` when the first argument is no dashed identifier. */
  name: string;
  /** The values after the first top-level comma, trimmed; `undefined` without a comma. `var(--a,)` has `[]`: a fallback. */
  fallback: ComponentValue[] | undefined;
  /** True inside a function of MATH_FUNCTIONS, at any depth. */
  inMath: boolean;
  /** The names of the enclosing functions, the outermost first, without `var` itself: `['drop-shadow']`. */
  functions: string[];
  /** The place of the `var(` function. */
  place: Place;
}

/** A dashed identifier: `--menu`, `--space-2`. */
const isDashed = (value: ComponentValue | undefined): value is IdentToken =>
  isIdent(value) && value.value.startsWith('--');

/** The name and the fallback of a `var()` function. */
function readVar(fn: FunctionValue): { name: string; fallback: ComponentValue[] | undefined } {
  const comma = fn.args.findIndex((value) => value.type === 'comma');
  const head = trimWhitespace(comma < 0 ? fn.args : fn.args.slice(0, comma));
  const first = head[0];
  const name = head.length === 1 && isDashed(first) ? first.value : '';
  return { name, fallback: comma < 0 ? undefined : trimWhitespace(fn.args.slice(comma + 1)) };
}

/** A `var()` function. The type keeps every other function in the else branch of a test. */
type VarFunction = FunctionValue & { name: 'var' };

const isVar = (value: ComponentValue | undefined): value is VarFunction =>
  value?.type === 'function' && value.name === 'var';

/** Every var() of the values in text order, also those inside a fallback and inside other functions. */
export function varsOf(values: readonly ComponentValue[]): VarUse[] {
  const out: VarUse[] = [];
  const visit = (list: readonly ComponentValue[], functions: string[], inMath: boolean): void => {
    for (const value of list) {
      if (isVar(value)) {
        const { name, fallback } = readVar(value);
        out.push({ name, fallback, inMath, functions: [...functions], place: value.place });
        if (fallback !== undefined) visit(fallback, functions, inMath);
      } else if (value.type === 'function') {
        // A vendor prefix does not change a function (7.3): `-webkit-calc()` is a math function.
        visit(value.args, [...functions, value.name], inMath || MATH_FUNCTIONS.has(canonicalFunction(value.name)));
      } else if (value.type === 'block') visit(value.values, functions, inMath);
    }
  };
  visit(values, [], false);
  return out;
}

/** The name when the values are exactly one `var(--x)` without fallback, else undefined (locals, design-specs). */
export function exactVar(values: readonly ComponentValue[]): string | undefined {
  const trimmed = trimWhitespace(values);
  const only = trimmed[0];
  if (trimmed.length !== 1 || !isVar(only)) return undefined;
  const { name, fallback } = readVar(only);
  return name !== '' && fallback === undefined ? name : undefined;
}

/**
 * The dashed identifiers that are values, outside var(): `anchor-name: --menu`. They are keywords (7.3). The name
 * of a `var()` is no such value; a dashed identifier in its fallback is.
 */
export function dashedIdents(values: readonly ComponentValue[]): IdentToken[] {
  const out: IdentToken[] = [];
  const visit = (list: readonly ComponentValue[]): void => {
    for (const value of list) {
      if (isVar(value)) {
        const fallback = readVar(value).fallback;
        if (fallback !== undefined) visit(fallback);
      } else if (value.type === 'function') visit(value.args);
      else if (value.type === 'block') visit(value.values);
      else if (isDashed(value)) out.push(value);
    }
  };
  visit(values);
  return out;
}

/**
 * The var()s of a declaration whose family the property does not accept (css-token-family). `familyOf` gives the
 * family of a name: M5 passes the token prefix family, the family of a local's token (7.3: "a component local takes
 * the family of the token it is set to"), and the family of a helper parameter (7.5). A name with no family is
 * skipped (css-var-undefined's business). A custom property declaration gives none.
 */
export function familyProblems(
  declaration: Declaration,
  familyOf: (name: string) => TokenFamily | undefined,
): VarUse[] {
  if (isCustomProperty(declaration.property)) return [];
  return varsOf(declaration.value).filter((use) => {
    const family = use.name === '' ? undefined : familyOf(use.name);
    return family !== undefined && !acceptsFamily(declaration.property, family, use);
  });
}

/**
 * The most component values that one substitution visits. A lookup whose values hold more `var()`s would double
 * the work at each level; beyond this budget the rest keeps its `var()`s.
 */
const MAX_SUBSTITUTED = 100_000;

/**
 * The values with each var() replaced by `lookup(name)`, recursively, at most MAX_DEPTH levels and with no name twice
 * on one path (a cycle stops). A name that `lookup` does not know stays a var(). The work is bounded: beyond
 * 100,000 values, the rest keeps its var()s.
 */
export function substituteVars(
  values: readonly ComponentValue[],
  lookup: (name: string) => readonly ComponentValue[] | undefined,
): ComponentValue[] {
  let budget = MAX_SUBSTITUTED;
  const step = (list: readonly ComponentValue[], path: readonly string[]): ComponentValue[] => {
    const out: ComponentValue[] = [];
    for (const value of list) {
      budget -= 1;
      if (budget <= 0) out.push(value);
      else if (isVar(value)) {
        const { name } = readVar(value);
        const known = name === '' || path.includes(name) || path.length >= MAX_DEPTH ? undefined : lookup(name);
        if (known === undefined) out.push(value);
        else out.push(...step(known, [...path, name]));
      } else if (value.type === 'function') out.push({ ...value, args: step(value.args, path) });
      else if (value.type === 'block') out.push({ ...value, values: step(value.values, path) });
      else out.push(value);
    }
    return out;
  };
  return step(values, []);
}

// The literal classifier

/** Which CSS a check reads: a project file (`source`), or the CSS of a built page (`built`, 13.1 items 4 and 40). */
export type CssForm = 'source' | 'built';

/** Where a declaration stands, as the literal classifier needs it. M5 computes it from `walk` and media.ts. */
export interface LiteralContext {
  form: CssForm;
  /** True inside `@media (forced-colors: active)`: `requiresForcedColors(context.atRules)` of media.ts. */
  forcedColors: boolean;
}

export type LiteralKind =
  /** A numeric token outside the allowlist. */
  | 'number'
  | 'percentage'
  | 'dimension'
  /** A hash on a value (`#c00`), except the built transparent forms. */
  | 'hex'
  /** rgb() rgba() hsl() hsla() hwb() lab() lch() oklab() oklch() color() color-mix() light-dark() device-cmyk() … */
  | 'color-function'
  /** One of the 148 names of NAMED_COLORS, on a property that takes a color. */
  | 'named-color'
  /** A system color outside forced colors, on a property that takes a color. */
  | 'system-color';

/** One literal that the allowlist of 7.3 does not accept. */
export interface Literal {
  kind: LiteralKind;
  /** The text as written: `13px`, `#c00`, `rgb(0 0 0)`. */
  text: string;
  place: Place;
}

/** The 19 system colors of 7.3, in ASCII lower case. They are allowed only inside `@media (forced-colors: active)`. */
export const SYSTEM_COLORS: ReadonlySet<string> = new Set([
  'canvas',
  'canvastext',
  'linktext',
  'visitedtext',
  'activetext',
  'buttonface',
  'buttontext',
  'buttonborder',
  'field',
  'fieldtext',
  'highlight',
  'highlighttext',
  'selecteditem',
  'selecteditemtext',
  'mark',
  'marktext',
  'graytext',
  'accentcolor',
  'accentcolortext',
]);

/**
 * Color keywords that browsers still know but 7.3 does not allow anywhere: the deprecated system colors of CSS
 * Color 4 and the color keywords of WebKit. They are colors, so they are banned like the 19, also in forced colors.
 */
const OTHER_COLOR_KEYWORDS: ReadonlySet<string> = new Set([
  'activeborder',
  'activecaption',
  'appworkspace',
  'background',
  'buttonhighlight',
  'buttonshadow',
  'captiontext',
  'inactiveborder',
  'inactivecaption',
  'inactivecaptiontext',
  'infobackground',
  'infotext',
  'menu',
  'menutext',
  'scrollbar',
  'threeddarkshadow',
  'threedface',
  'threedhighlight',
  'threedlightshadow',
  'threedshadow',
  'window',
  'windowframe',
  'windowtext',
  '-webkit-link',
  '-webkit-activelink',
  '-webkit-focus-ring-color',
  '-webkit-text',
]);

/** The two color keywords that 7.3 allows everywhere, in ASCII lower case. */
const ALLOWED_COLOR_KEYWORDS: ReadonlySet<string> = new Set(['currentcolor', 'transparent']);

/** The forms that the minifier gives `transparent` (13.1 item 4; 7.3), without `#`. */
const BUILT_TRANSPARENT: ReadonlySet<string> = new Set(['0000', '00000000']);

/** The color functions: each is one literal. */
const COLOR_FUNCTIONS: ReadonlySet<string> = new Set([
  'rgb',
  'rgba',
  'hsl',
  'hsla',
  'hwb',
  'lab',
  'lch',
  'oklab',
  'oklch',
  'color',
  'color-mix',
  'light-dark',
  'device-cmyk',
  'contrast-color',
]);

/** The gradient functions. A named color in one counts on every property. */
const GRADIENT_FUNCTIONS: ReadonlySet<string> = new Set([
  'linear-gradient',
  'radial-gradient',
  'conic-gradient',
  'repeating-linear-gradient',
  'repeating-radial-gradient',
  'repeating-conic-gradient',
  'gradient',
]);

/** The properties that take a color besides those of the color family (7.3: "the 148 CSS color names on color properties"). */
const OTHER_COLOR_PROPERTIES: ReadonlySet<string> = new Set(['box-shadow', 'text-shadow', 'filter', 'backdrop-filter']);

/** The property families whose every longhand takes a color: `border-top-color`, `text-decoration-color` … */
const COLOR_PROPERTY_BASES: readonly string[] = [
  'background',
  'border',
  'outline',
  'column-rule',
  'text-decoration',
  'text-emphasis',
];

/**
 * Says whether a property takes a color, so that a color name in its value is a color and not a keyword. A custom
 * property may hold a color, so it takes one too.
 */
function takesColor(property: string): boolean {
  if (isCustomProperty(property)) return true;
  if (FAMILIES_OF.get(property)?.has('color') === true || OTHER_COLOR_PROPERTIES.has(property)) return true;
  return COLOR_PROPERTY_BASES.some((base) => property === base || property.startsWith(`${base}-`));
}

/** The units of CSS Values 4 and the modules it names, in lower case. A zero with another unit is no zero. */
const UNITS: ReadonlySet<string> = new Set(
  [
    // Lengths
    'em rem ex rex cap rcap ch rch ic ric lh rlh',
    'vw vh vi vb vmin vmax svw svh svi svb svmin svmax lvw lvh lvi lvb lvmin lvmax dvw dvh dvi dvb dvmin dvmax',
    'cqw cqh cqi cqb cqmin cqmax cm mm q in pt pc px',
    // Angles, times, frequencies, resolutions, flex
    'deg grad rad turn s ms hz khz dpi dpcm dppx x fr',
  ].flatMap((line) => line.split(' ')),
);

/** The angle units: an angle is allowed in any value (7.3, geometry literals). */
const ANGLE_UNITS: ReadonlySet<string> = new Set(['deg', 'grad', 'rad', 'turn']);

/**
 * The properties where a unitless integer is allowed anywhere in the value (7.3): `order`, the grid placement
 * properties, `flex-grow`, `flex-shrink`, the grow and shrink parts of `flex`, `column-count`, the count part of
 * `columns`, `line-clamp` (and `-webkit-line-clamp`, which reads as `line-clamp`).
 */
const COUNT_PROPERTIES: ReadonlySet<string> = new Set([
  'order',
  'grid-row',
  'grid-column',
  'grid-row-start',
  'grid-row-end',
  'grid-column-start',
  'grid-column-end',
  'grid-area',
  'flex-grow',
  'flex-shrink',
  'flex',
  'column-count',
  'columns',
  'line-clamp',
]);

/**
 * The properties where a plain number is a geometry literal anywhere in the value (7.3). `animation` is here for
 * its iteration count, which the minifier merges into it: there a plain number counts only at the top level of the
 * value, never inside an easing function (`cubic-bezier()`, `steps()`, `linear()`), which takes `--ease-` tokens.
 */
const GEOMETRY_NUMBER_PROPERTIES: ReadonlySet<string> = new Set([
  'rotate',
  'scale',
  'transform',
  'animation-iteration-count',
  'animation',
  'font-variation-settings',
  'font-feature-settings',
  'font-size-adjust',
  'orphans',
  'widows',
  'tab-size',
  'stroke-dasharray',
  'stroke-miterlimit',
  'border-image',
  'border-image-slice',
]);

/** The properties whose functions take plain numbers and percentages (7.3). */
const FILTER_PROPERTIES: ReadonlySet<string> = new Set(['filter', 'backdrop-filter']);

/** The properties whose shape functions take percentages (7.3). */
const SHAPE_PROPERTIES: ReadonlySet<string> = new Set(['clip-path', 'shape-outside']);

/** The basic shapes of CSS Shapes (7.3: "the shapes of clip-path and shape-outside"). */
const SHAPE_FUNCTIONS: ReadonlySet<string> = new Set([
  'inset',
  'circle',
  'ellipse',
  'polygon',
  'path',
  'xywh',
  'rect',
  'shape',
]);

/**
 * The properties where a percentage is a geometry literal anywhere in the value (7.3). The `-x` and `-y`
 * longhands of the positions are here, since the minifier writes `center` there as `50%`.
 */
const GEOMETRY_PERCENTAGE_PROPERTIES: ReadonlySet<string> = new Set([
  'translate',
  'scale',
  'transform',
  'object-position',
  'background-position',
  'background-position-x',
  'background-position-y',
  'background-size',
  'mask-position',
  'mask-position-x',
  'mask-position-y',
  'mask-size',
  'transform-origin',
  'perspective-origin',
]);

/**
 * The shorthands whose position and size parts take percentages (7.3: `background-position`, `background-size`,
 * `mask-position`, `mask-size`). Only at the top level of the value: a percentage in a gradient there is no position.
 */
const POSITION_SHORTHANDS: ReadonlySet<string> = new Set(['background', 'mask']);

/** The properties where the built half accepts `1`, the minifier's form of `100%` (13.1 item 40). */
const OPACITY_PROPERTIES: ReadonlySet<string> = new Set(['opacity', 'fill-opacity', 'stroke-opacity']);

/** The minifier's forms of `normal` and `bold` on `font-weight` and in `font` (13.1 item 40). */
const BUILT_WEIGHTS: ReadonlySet<number> = new Set([400, 700]);

/** The percentages that the minifier writes for the `font-stretch` keywords, from `ultra-condensed` to `ultra-expanded`. */
const BUILT_STRETCHES: ReadonlySet<number> = new Set([50, 62.5, 75, 87.5, 100, 112.5, 125, 150, 200]);

/** Where a value stands inside the declaration. */
interface Scope {
  /** The enclosing functions without `var`, in lower case and without a vendor prefix, the outermost first. */
  functions: readonly string[];
  inMath: boolean;
  /**
   * True inside a math function whose outermost math function holds a `var()` at any depth. Only there is a plain
   * number a factor or divisor (7.3): the minifier computes a math function of literals alone (`calc(100% / 3)`
   * becomes `33.3333%`), and keeps one that holds a `var()` as written.
   */
  mathVar: boolean;
  inGradient: boolean;
  inShape: boolean;
}

/** Says whether the values hold a `var()` at any depth. The recursion follows the tree of `parse.ts`. */
function holdsVar(list: readonly ComponentValue[]): boolean {
  return list.some(
    (value) =>
      isVar(value) ||
      (value.type === 'function' && holdsVar(value.args)) ||
      (value.type === 'block' && holdsVar(value.values)),
  );
}

type Numeric = NumberToken | PercentageToken | DimensionToken;

/** The nearest value before or after `index` that is no white space. */
function neighbor(list: readonly ComponentValue[], index: number, step: 1 | -1): ComponentValue | undefined {
  let at = index + step;
  while (at >= 0 && at < list.length && list[at]?.type === 'whitespace') at += step;
  return list[at];
}

/**
 * Says whether a numeric value is allowed where it stands (7.3, and 13.1 item 40 for the built form).
 * `inRepeatCount` is true for the values of `repeat(` before its first comma.
 */
function allowedNumeric(
  token: Numeric,
  property: string,
  scope: Scope,
  near: { before: ComponentValue | undefined; after: ComponentValue | undefined; inRepeatCount: boolean },
  context: LiteralContext,
): boolean {
  const { value } = token;
  // 0 with or without a unit, 100%, <integer>fr and any angle.
  if (value === 0 && (token.type !== 'dimension' || UNITS.has(token.unit))) return true;
  if (token.type === 'percentage' && value === 100) return true;
  if (token.type === 'dimension') {
    if (token.unit === 'fr' && token.integer && value > 0) return true;
    return ANGLE_UNITS.has(token.unit);
  }
  const topLevel = scope.functions.length === 0;
  if (token.type === 'number') {
    const integer = token.integer;
    if (integer && (COUNT_PROPERTIES.has(property) || near.inRepeatCount)) return true;
    if (integer && (isIdent(near.before, 'span') || isIdent(near.after, 'span'))) return true;
    if (scope.mathVar && (isDelim(near.before, '*') || isDelim(near.before, '/') || isDelim(near.after, '*'))) {
      return true;
    }
    if (GEOMETRY_NUMBER_PROPERTIES.has(property) && (property !== 'animation' || topLevel)) return true;
    if (FILTER_PROPERTIES.has(property) && !topLevel) return true;
    if (context.form === 'built') {
      if (integer && BUILT_WEIGHTS.has(value) && (property === 'font-weight' || (property === 'font' && topLevel))) {
        return true;
      }
      if (value === 1 && OPACITY_PROPERTIES.has(property)) return true;
    }
    return false;
  }
  // A percentage.
  if (GEOMETRY_PERCENTAGE_PROPERTIES.has(property)) return true;
  if (FILTER_PROPERTIES.has(property) && !topLevel) return true;
  if (SHAPE_PROPERTIES.has(property) && scope.inShape) return true;
  if (POSITION_SHORTHANDS.has(property) && topLevel) return true;
  return (
    context.form === 'built' &&
    BUILT_STRETCHES.has(value) &&
    (property === 'font-stretch' || (property === 'font' && topLevel))
  );
}

/**
 * Every literal of the declaration's value outside the 7.3 allowlist, in text order (css-literal).
 *
 * - Strings, `url()` and `src()` and the name of each `var()` are removed before the scan. The fallback of a `var()`
 *   is scanned in the place of the `var()`.
 * - A plain number next to `*` or after `/` is a factor or divisor only in a math function that holds a `var()`:
 *   `calc(var(--size-card) / 3)` passes, `calc(100% / 3)` fails in source as `33.3333%` fails in built CSS.
 * - A color function is one literal; its arguments are not scanned again.
 * - A color name counts on a property that takes a color, and in a gradient on any property; elsewhere it is a
 *   keyword (`animation-name: red`). A custom property takes a color.
 * - The built form also accepts the minifier's forms of allowed values: `#0000` and `#00000000`, `400` and `700` on
 *   `font-weight` and in `font`, the `font-stretch` percentages on `font-stretch` and in `font`, and `1` on
 *   `opacity`, `fill-opacity` and `stroke-opacity`.
 */
export function bannedLiterals(declaration: Declaration, context: LiteralContext): Literal[] {
  const property = canonicalProperty(declaration.property);
  const colors = takesColor(property);
  const out: Literal[] = [];

  const scan = (list: readonly ComponentValue[], scope: Scope, repeat: boolean): void => {
    const firstComma = repeat ? list.findIndex((value) => value.type === 'comma') : -1;
    list.forEach((value, index) => {
      switch (value.type) {
        case 'function': {
          const name = canonicalFunction(value.name);
          if (name === 'url' || name === 'src') return;
          if (name === 'var') {
            const fallback = readVar(value).fallback;
            if (fallback !== undefined) scan(fallback, scope, false);
            return;
          }
          if (COLOR_FUNCTIONS.has(name)) {
            out.push({ kind: 'color-function', text: serialize([value]), place: value.place });
            return;
          }
          const math = MATH_FUNCTIONS.has(name);
          const inner: Scope = {
            functions: [...scope.functions, name],
            inMath: scope.inMath || math,
            mathVar: scope.inMath ? scope.mathVar : math && holdsVar(value.args),
            inGradient: scope.inGradient || GRADIENT_FUNCTIONS.has(name),
            inShape: scope.inShape || SHAPE_FUNCTIONS.has(name),
          };
          scan(value.args, inner, name === 'repeat');
          return;
        }
        case 'block':
          scan(value.values, scope, false);
          return;
        case 'ident': {
          if (!colors && !scope.inGradient) return;
          const lower = asciiLower(value.value);
          if (ALLOWED_COLOR_KEYWORDS.has(lower)) return;
          if (NAMED_COLORS.has(lower)) out.push({ kind: 'named-color', text: value.text, place: value.place });
          else if (OTHER_COLOR_KEYWORDS.has(lower) || (SYSTEM_COLORS.has(lower) && !context.forcedColors)) {
            out.push({ kind: 'system-color', text: value.text, place: value.place });
          }
          return;
        }
        case 'hash':
          if (context.form === 'built' && BUILT_TRANSPARENT.has(asciiLower(value.value))) return;
          out.push({ kind: 'hex', text: value.text, place: value.place });
          return;
        case 'number':
        case 'percentage':
        case 'dimension': {
          const near = {
            before: neighbor(list, index, -1),
            after: neighbor(list, index, 1),
            inRepeatCount: repeat && (firstComma < 0 || index < firstComma),
          };
          if (!allowedNumeric(value, property, scope, near, context)) {
            out.push({ kind: value.type, text: value.text, place: value.place });
          }
          return;
        }
        default:
          return;
      }
    });
  };

  scan(declaration.value, { functions: [], inMath: false, mathVar: false, inGradient: false, inShape: false }, false);
  return out;
}

/**
 * A keyframe selector that is no `from`, `to` or percentage (`@keyframes` selectors of 7.3), else undefined. A
 * percentage below 0% or above 100% is a problem too: CSS drops such a keyframe. An empty selector (`50%, {…}`)
 * holds no value with a place, so its problem stands at `rulePlace`, the place of its keyframe rule, where the parser
 * reports the same selector.
 */
export function keyframeSelectorProblem(
  selector: readonly ComponentValue[],
  rulePlace: Place,
): ParseProblem | undefined {
  const values = trimWhitespace(selector);
  const first = values[0];
  if (first === undefined) return { message: 'an empty keyframe selector', place: rulePlace };
  const text = serialize(values);
  if (values.length === 1 && (isIdent(first, 'from') || isIdent(first, 'to'))) return undefined;
  if (values.length === 1 && first.type === 'percentage') {
    if (first.value >= 0 && first.value <= 100) return undefined;
    return { message: `the keyframe selector \`${text}\` is outside \`0%\` to \`100%\``, place: first.place };
  }
  return { message: `the keyframe selector \`${text}\` is no \`from\`, \`to\` or percentage`, place: first.place };
}

// css-banned

/** vw, vi, vmin, vmax and their d, l and s forms (css-banned). */
export const VIEWPORT_WIDTH_UNITS: ReadonlySet<string> = new Set(
  ['vw', 'vi', 'vmin', 'vmax'].flatMap((unit) => [unit, `d${unit}`, `l${unit}`, `s${unit}`]),
);

/** The properties where css-banned refuses a viewport width unit: the widths and every margin. */
const VIEWPORT_PROPERTIES: ReadonlySet<string> = new Set([
  'width',
  'min-width',
  'max-width',
  'inline-size',
  'min-inline-size',
  'max-inline-size',
  ...withSides('margin'),
]);

/**
 * The places of viewport units on `width`, `inline-size`, their min-/max- forms and `margin*`, after token
 * substitution (css-banned): a unit in the value gives its own place, a unit that a var() brings gives the place of
 * that var(). Any other property gives []. A var() that `lookup` does not know reads its fallback.
 */
export function viewportWidthUnits(
  declaration: Declaration,
  lookup: (name: string) => readonly ComponentValue[] | undefined,
): Place[] {
  if (!VIEWPORT_PROPERTIES.has(canonicalProperty(declaration.property))) return [];
  let budget = MAX_SUBSTITUTED;
  const isViewport = (value: ComponentValue): boolean =>
    value.type === 'dimension' && VIEWPORT_WIDTH_UNITS.has(value.unit);

  /** Says whether the values hold a viewport unit, with each var() read through `lookup`. */
  const brings = (list: readonly ComponentValue[], path: readonly string[]): boolean =>
    list.some((value) => {
      budget -= 1;
      if (budget <= 0) return false;
      if (isViewport(value)) return true;
      if (isVar(value)) {
        const { name, fallback } = readVar(value);
        if (name === '' || path.includes(name) || path.length >= MAX_DEPTH) return false;
        const known = lookup(name);
        if (known !== undefined) return brings(known, [...path, name]);
        return fallback !== undefined && brings(fallback, path);
      }
      if (value.type === 'function') return brings(value.args, path);
      return value.type === 'block' && brings(value.values, path);
    });

  const places: Place[] = [];
  const visit = (list: readonly ComponentValue[]): void => {
    for (const value of list) {
      if (isViewport(value)) places.push(value.place);
      else if (isVar(value)) {
        const { name, fallback } = readVar(value);
        const known = name === '' ? undefined : lookup(name);
        if (known !== undefined) {
          if (brings(known, [name])) places.push(value.place);
        } else if (fallback !== undefined) visit(fallback);
      } else if (value.type === 'function') visit(value.args);
      else if (value.type === 'block') visit(value.values);
    }
  };
  visit(declaration.value);
  return places;
}

/** The functions whose string arguments are URLs: `image-set("a.avif" 1x)`. */
const IMAGE_SET_FUNCTIONS: ReadonlySet<string> = new Set(['image-set']);

/**
 * The places of every URL of the values: `url` tokens, `url("…")` and `src()` functions, and the strings of
 * `image-set()`, which CSS reads as URLs (css-banned).
 */
export function urlsOf(values: readonly ComponentValue[]): Place[] {
  const places: Place[] = [];
  const visit = (list: readonly ComponentValue[], imageSet: boolean): void => {
    for (const value of list) {
      if (value.type === 'url' || (imageSet && value.type === 'string')) places.push(value.place);
      else if (value.type === 'function') {
        const name = canonicalFunction(value.name);
        if (name === 'url' || name === 'src') places.push(value.place);
        else visit(value.args, IMAGE_SET_FUNCTIONS.has(name));
      } else if (value.type === 'block') visit(value.values, false);
    }
  };
  visit(values, false);
  return places;
}

// design-pairs

/** The properties where a color token is a foreground (7.4). */
const FOREGROUND_PROPERTIES: ReadonlySet<string> = new Set([
  'color',
  'outline-color',
  'outline',
  ...BORDER_COLORS,
  ...BORDER_SHORTHANDS,
  'fill',
  'stroke',
  'text-decoration-color',
  'text-decoration',
]);

/** The properties where a color token is a background (7.4). */
const BACKGROUND_PROPERTIES: ReadonlySet<string> = new Set(['background-color', 'background']);

/**
 * The position of a color token on a property (7.4): `foreground` for color, outline-color, border-*-color, fill,
 * stroke, text-decoration-color and the color part of border*, outline and text-decoration; `background` for
 * background-color and background; otherwise undefined.
 */
export function colorPosition(property: string): 'foreground' | 'background' | undefined {
  const name = canonicalProperty(property);
  if (FOREGROUND_PROPERTIES.has(name)) return 'foreground';
  return BACKGROUND_PROPERTIES.has(name) ? 'background' : undefined;
}

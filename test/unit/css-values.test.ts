/**
 * The value analyzers (specification, 3.2 and 7.3): the literal classifier, the token-family map with the length
 * group, the geometry literals, the forced-colors exception, keyframe selectors, `var()` extraction, token
 * substitution, the value checks of css-banned and the color positions of design-pairs. Each table runs the source
 * form and, where the minifier changes it, the built form of Lightning CSS (13.1 items 4 and 40). The freedom rows
 * and the value rows of the drift matrix of 14.1 are here too.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TokenFamily } from '../../src/context.ts';
import {
  asciiLower,
  type ComponentValue,
  type Declaration,
  type Place,
  parseCss,
  parseValue,
  type Rule,
  serialize,
  walk,
} from '../../src/css/parse.ts';
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
  LENGTH_GROUP,
  MATH_FUNCTIONS,
  propertyFamilies,
  SYSTEM_COLORS,
  substituteVars,
  urlsOf,
  VIEWPORT_WIDTH_UNITS,
  varsOf,
  viewportWidthUnits,
} from '../../src/css/values.ts';
import { familyOf } from '../../src/design/parse.ts';
import { SPEC } from './spec.ts';

// Helpers. None asserts.

/** Every declaration of a sheet, with whether it stands inside `@media (forced-colors: active)`. */
function declarationsOf(css: string): { declaration: Declaration; forced: boolean }[] {
  const out: { declaration: Declaration; forced: boolean }[] = [];
  walk(parseCss(css, 'x.css'), (node, context) => {
    const forced = context.atRules.some((rule) => serialize(rule.prelude).includes('forced-colors'));
    if (node.type === 'declaration') out.push({ declaration: node, forced });
  });
  return out;
}

/** The one declaration of `.a { <text> }`, or a placeholder that holds nothing when the text has none. */
function declarationOf(text: string): Declaration {
  const empty: Declaration = {
    type: 'declaration',
    property: '',
    value: [],
    important: false,
    place: { offset: 0, line: 1, column: 1 },
  };
  return declarationsOf(`.a{${text}}`)[0]?.declaration ?? empty;
}

/** The banned literals of a sheet as `<kind>:<text>`, each declaration in its forced-colors context. */
const literalsOf = (css: string, form: CssForm): string[] =>
  declarationsOf(css).flatMap(({ declaration, forced }) =>
    bannedLiterals(declaration, { form, forcedColors: forced }).map((literal) => `${literal.kind}:${literal.text}`),
  );

/** The banned literals of one declaration as `<kind>:<text>`. */
const literals = (text: string, form: CssForm = 'source', forcedColors = false): string[] =>
  bannedLiterals(declarationOf(text), { form, forcedColors }).map((literal) => `${literal.kind}:${literal.text}`);

/** The family of a name as M5 gives it: a token prefix, else a helper parameter, else the local `--card-pad`. */
const familyOfName = (name: string): TokenFamily | undefined =>
  familyOf(name) ?? helperParameterFamily(name) ?? (name === '--card-pad' ? 'space' : undefined);

/** The names of the var()s whose family a declaration's property does not accept. */
const familyProblemsOf = (text: string): string[] =>
  familyProblems(declarationOf(text), familyOfName).map((use) => use.name);

/** The family problems of every declaration of a sheet. */
const sheetFamilyProblems = (css: string): string[] =>
  declarationsOf(css).flatMap(({ declaration }) =>
    familyProblems(declaration, familyOfName).map((use) => `${declaration.property}:${use.name}`),
  );

/** The families of a property as one sorted text, `-` for none. */
function familiesText(property: string): string {
  const families = propertyFamilies(property);
  return families === undefined ? '-' : [...families].sort().join(',');
}

const place = ({ line, column }: { line: number; column: number }): string => `${line}:${column}`;

/** A place for a selector that is not in a sheet. */
const AT_START: Place = { offset: 0, line: 1, column: 1 };

/** A lookup from a table of value texts. */
function lookupOf(table: ReadonlyMap<string, string>): (name: string) => readonly ComponentValue[] | undefined {
  return (name) => {
    const text = table.get(name);
    return text === undefined ? undefined : parseValue(text).values;
  };
}

/** The keyframe selectors of a sheet, each with its problem as `<line>:<column> <message>`, or `ok`. */
function keyframeProblems(css: string): string[] {
  const out: string[] = [];
  walk(parseCss(css, 'x.css'), (node) => {
    if (node.type !== 'rule' || node.kind !== 'keyframe') return;
    for (const selector of (node satisfies Rule).selectors) {
      const problem = keyframeSelectorProblem(selector, node.place);
      out.push(problem === undefined ? 'ok' : `${place(problem.place)} ${problem.message}`);
    }
  });
  return out;
}

// The family map (7.3)

const SIDES = ['top', 'right', 'bottom', 'left'];
const LOGICAL = ['block', 'block-start', 'block-end', 'inline', 'inline-start', 'inline-end'];
const BOXES = (base: string): string[] => [
  base,
  ...SIDES.map((side) => `${base}-${side}`),
  ...LOGICAL.map((side) => `${base}-${side}`),
];

/** Every property of the 7.3 table and every shorthand that the map holds, with its families. */
const FAMILIES: readonly (readonly [string, string])[] = [
  ['color', 'color'],
  ['background-color', 'color'],
  ['background', 'color,gradient'],
  ...BOXES('border').map((name) => [`${name}-color`, 'color'] as const),
  ...BOXES('border').map((name) => [name, 'color,line'] as const),
  ...BOXES('border').map((name) => [`${name}-width`, 'line'] as const),
  ['outline-color', 'color'],
  ['outline', 'color,line'],
  ['text-decoration-color', 'color'],
  ['text-decoration', 'color,line'],
  ['text-emphasis-color', 'color'],
  ['text-emphasis', 'color'],
  ['caret-color', 'color'],
  ['accent-color', 'color'],
  ['column-rule-color', 'color'],
  ['column-rule', 'color,line'],
  ['fill', 'color'],
  ['stroke', 'color'],
  // The other properties that take a color (7.3, "Where a color name counts") take a color token too.
  ['scrollbar-color', 'color'],
  ['stop-color', 'color'],
  ['flood-color', 'color'],
  ['lighting-color', 'color'],
  ...BOXES('margin').map((name) => [name, 'space'] as const),
  ...BOXES('padding').map((name) => [name, 'space'] as const),
  ...BOXES('scroll-margin').map((name) => [name, 'space'] as const),
  ...BOXES('scroll-padding').map((name) => [name, 'space'] as const),
  ['gap', 'space'],
  ['row-gap', 'space'],
  ['column-gap', 'space'],
  ['inset', 'space'],
  ...LOGICAL.map((side) => [`inset-${side}`, 'space'] as const),
  ...SIDES.map((side) => [side, 'space'] as const),
  ['text-indent', 'space'],
  ['translate', 'size,space'],
  ...['width', 'height', 'inline-size', 'block-size'].flatMap((name) => [
    [name, 'size'] as const,
    [`min-${name}`, 'size'] as const,
    [`max-${name}`, 'size'] as const,
  ]),
  ['flex-basis', 'size'],
  ['flex', 'size'],
  ['grid-template-columns', 'size'],
  ['grid-template-rows', 'size'],
  ['grid-auto-columns', 'size'],
  ['grid-auto-rows', 'size'],
  ['grid-template', 'size'],
  ['grid', 'size'],
  ['aspect-ratio', 'size'],
  ['contain-intrinsic-size', 'size'],
  ['font-family', 'font'],
  ['font', 'font,leading,text,weight'],
  ['font-size', 'text'],
  ['line-height', 'leading'],
  ['font-weight', 'weight'],
  ['letter-spacing', 'tracking'],
  ['word-spacing', 'tracking'],
  ['border-radius', 'radius'],
  ['border-top-left-radius', 'radius'],
  ['border-top-right-radius', 'radius'],
  ['border-bottom-right-radius', 'radius'],
  ['border-bottom-left-radius', 'radius'],
  ['border-start-start-radius', 'radius'],
  ['border-start-end-radius', 'radius'],
  ['border-end-start-radius', 'radius'],
  ['border-end-end-radius', 'radius'],
  ['outline-width', 'line'],
  ['outline-offset', 'line'],
  ['text-decoration-thickness', 'line'],
  ['text-underline-offset', 'line'],
  ['column-rule-width', 'line'],
  ['stroke-width', 'line'],
  ['box-shadow', 'shadow'],
  ['text-shadow', 'shadow'],
  ['z-index', 'z'],
  ['transition-duration', 'duration'],
  ['transition-delay', 'duration'],
  ['animation-duration', 'duration'],
  ['animation-delay', 'duration'],
  ['transition', 'duration,ease'],
  ['animation', 'duration,ease'],
  ['transition-timing-function', 'ease'],
  ['animation-timing-function', 'ease'],
  ['opacity', 'opacity'],
  ['fill-opacity', 'opacity'],
  ['stroke-opacity', 'opacity'],
  ['background-image', 'gradient'],
  ['mask-image', 'gradient'],
  ['mask', 'gradient'],
  ['border-image-source', 'gradient'],
  ['border-image', 'gradient'],
  // The case of a name and a vendor prefix do not count.
  ['COLOR', 'color'],
  ['Margin-Top', 'space'],
  ['-webkit-text-decoration', 'color,line'],
  ['-webkit-mask-image', 'gradient'],
  // No family: a property that the table does not list, a custom property, and names of JavaScript objects.
  ['transform', '-'],
  ['filter', '-'],
  ['backdrop-filter', '-'],
  ['-webkit-backdrop-filter', '-'],
  ['clip-path', '-'],
  ['order', '-'],
  ['color-scheme', '-'],
  ['--color-text', '-'],
  ['--card-pad', '-'],
  ['constructor', '-'],
  ['__proto__', '-'],
  ['toString', '-'],
  ['hasOwnProperty', '-'],
  ['', '-'],
];

test('each property of the 7.3 table maps to its families, and a shorthand to the families of its parts', () => {
  for (const [property, expected] of FAMILIES) {
    assert.equal(familiesText(property), expected, property);
  }
});

test('the length group and the math functions are those of 7.3', () => {
  assert.deepEqual([...LENGTH_GROUP].sort(), ['line', 'radius', 'size', 'space', 'text']);
  assert.deepEqual([...MATH_FUNCTIONS].sort(), ['calc', 'clamp', 'fit-content', 'max', 'min', 'minmax']);
});

/** Declarations and the var()s whose family the property does not accept (css-token-family). */
const LENGTH_GROUP_CASES: readonly (readonly [string, readonly string[]])[] = [
  // The examples of 7.3 and of the M4 contract.
  ['width: calc(100% - var(--space-4))', []],
  ['padding: var(--size-x)', ['--size-x']],
  ['padding: calc(var(--size-x) * 2)', []],
  ['z-index: calc(var(--space-1))', ['--space-1']],
  ['z-index: var(--z-top)', []],
  // Every math function admits the whole group for a property of the group.
  ['width: calc(var(--text-m) * 20)', []],
  ['width: min(var(--space-1), var(--text-m))', []],
  ['width: max(var(--line-1), var(--radius-s))', []],
  ['font-size: clamp(var(--text-s), var(--space-4), var(--text-l))', []],
  ['grid-template-columns: minmax(var(--space-4), 1fr)', []],
  ['grid-template-columns: fit-content(var(--radius-m))', []],
  ['border-radius: calc(var(--line-1) * 2)', []],
  ['border-width: max(var(--line-1), var(--radius-s))', []],
  ['margin: calc((var(--space-1) + var(--size-x)) * -1)', []],
  ['width: calc(min(var(--space-1), var(--text-m)))', []],
  // A vendor prefix does not change a function (7.3).
  ['width: -webkit-calc(100% - var(--space-4))', []],
  ['width: -webkit-calc(100% - var(--color-a))', ['--color-a']],
  // Outside a math function only the property's own families pass.
  ['width: var(--space-1)', ['--space-1']],
  ['grid-template-columns: var(--space-4) 1fr', ['--space-4']],
  ['font-size: var(--space-1)', ['--space-1']],
  ['border-radius: var(--line-1)', ['--line-1']],
  // A family outside the group never passes, in a math function neither.
  ['width: calc(var(--color-a))', ['--color-a']],
  ['width: calc(var(--opacity-half) * 1rem)', ['--opacity-half']],
  ['color: calc(var(--space-1))', ['--space-1']],
  ['opacity: calc(var(--space-1))', ['--space-1']],
  ['line-height: calc(var(--space-1))', ['--space-1']],
  ['letter-spacing: calc(var(--space-1) * 1)', ['--space-1']],
  // A property with no family accepts the length group, and filter also a color in drop-shadow().
  ['transform: translateY(var(--space-1))', []],
  ['filter: blur(var(--space-1))', []],
  ['clip-path: inset(var(--space-2) round var(--radius-m))', []],
  ['transform: translateY(var(--color-a))', ['--color-a']],
  ['transform: var(--duration-m)', ['--duration-m']],
  ['filter: drop-shadow(0 0 var(--space-1) var(--color-a))', []],
  ['backdrop-filter: drop-shadow(0 0 var(--space-1) var(--color-a))', []],
  ['-webkit-backdrop-filter: drop-shadow(0 0 var(--space-1) var(--color-a))', []],
  ['filter: blur(var(--color-a))', ['--color-a']],
  ['transform: drop-shadow(var(--color-a))', ['--color-a']],
  // Shorthands take the families of their parts.
  ['border: var(--line-1) solid var(--color-a)', []],
  ['border-block-start: var(--line-1) solid var(--color-a)', []],
  ['border: var(--space-1) solid', ['--space-1']],
  ['outline: var(--line-1) solid var(--color-focus)', []],
  ['text-decoration: underline var(--color-a) var(--line-1)', []],
  ['column-rule: var(--line-1) solid var(--color-a)', []],
  ['font: var(--weight-b) var(--text-m)/var(--leading-m) var(--font-b)', []],
  ['font: var(--space-1) var(--font-b)', ['--space-1']],
  ['transition: opacity var(--duration-m) var(--ease-out) var(--duration-s)', []],
  ['animation: card-in var(--duration-m) var(--ease-out) var(--color-a)', ['--color-a']],
  ['flex: 1 1 var(--size-x)', []],
  ['background: var(--color-a) var(--gradient-b)', []],
  ['background: var(--space-1)', ['--space-1']],
  ['box-shadow: var(--shadow-card)', []],
  ['scrollbar-color: var(--color-a) var(--color-b)', []],
  ['stop-color: var(--color-a)', []],
  ['flood-color: var(--color-a)', []],
  ['lighting-color: var(--color-a)', []],
  ['stop-color: var(--space-1)', ['--space-1']],
  ['box-shadow: 0 0 0 var(--line-1) var(--color-a)', ['--line-1', '--color-a']],
  ['translate: var(--space-1) var(--size-x)', []],
  // Helper parameters (7.5) and locals take the family that M5 gives them.
  ['gap: var(--stack-gap)', []],
  ['max-inline-size: var(--center-max)', []],
  ['width: var(--stack-gap)', ['--stack-gap']],
  ['padding: var(--card-pad)', []],
  ['color: var(--card-pad)', ['--card-pad']],
  // A fallback var() counts; a name with no family is left to css-var-undefined; a custom property gives none.
  ['padding: var(--space-1, var(--color-a))', ['--color-a']],
  ['padding: var(--brand)', []],
  ['padding: var(--constructor)', []],
  ['--card-pad: var(--color-a)', []],
];

test('the length group: a property of the group takes any token of the group inside a math function (7.3)', () => {
  for (const [text, expected] of LENGTH_GROUP_CASES) {
    assert.deepEqual(familyProblemsOf(text), expected, text);
  }
});

test('acceptsFamily reads the property, the family and where the var() stands', () => {
  const plain = { inMath: false, functions: [] };
  const inCalc = { inMath: true, functions: ['calc'] };
  assert.equal(acceptsFamily('padding', 'space', plain), true);
  assert.equal(acceptsFamily('padding', 'size', plain), false);
  assert.equal(acceptsFamily('padding', 'size', inCalc), true);
  assert.equal(acceptsFamily('z-index', 'space', inCalc), false);
  assert.equal(acceptsFamily('transform', 'radius', plain), true);
  assert.equal(acceptsFamily('transform', 'color', plain), false);
  assert.equal(acceptsFamily('filter', 'color', { inMath: false, functions: ['drop-shadow'] }), true);
  assert.equal(acceptsFamily('filter', 'color', plain), false);
  assert.equal(acceptsFamily('constructor', 'space', plain), true);
  assert.equal(acceptsFamily('__proto__', 'color', plain), false);
});

// The literal classifier (7.3)

/** One declaration in source form and the banned literals it gives. */
const LITERALS: readonly (readonly [string, readonly string[]])[] = [
  // Zero with or without a unit, 100%, <integer>fr.
  ['margin: 0', []],
  ['margin: 0px', []],
  ['margin: -0 +0rem', []],
  ['inset: 0%', []],
  ['transition-delay: 0s', []],
  ['transition-delay: 0ms', []],
  ['margin: 0px_', ['dimension:0px_']],
  ['width: 100%', []],
  ['width: 100.0%', []],
  ['width: 50%', ['percentage:50%']],
  ['width: -100%', ['percentage:-100%']],
  ['grid-template-columns: 1fr 2fr', []],
  ['grid-template-columns: 1.5fr', ['dimension:1.5fr']],
  ['grid-template-columns: -1fr', ['dimension:-1fr']],
  // Lengths, times and plain numbers are tokens.
  ['padding: 13px', ['dimension:13px']],
  ['padding: 1.5rem .5rem', ['dimension:1.5rem', 'dimension:.5rem']],
  ['transition-duration: 200ms', ['dimension:200ms']],
  ['z-index: 2', ['number:2']],
  ['line-height: 1.5', ['number:1.5']],
  ['font-size: 1px_', ['dimension:1px_']],
  ['margin: 0-0', []],
  ['margin: 1-1', ['number:1', 'number:-1']],
  ['aspect-ratio: 16 / 9', ['number:16', 'number:9']],
  ['aspect-ratio: 1', ['number:1']],
  ['counter-increment: item 2', ['number:2']],
  ['counter-reset: item 0', []],
  // Unitless integers in counts.
  ['order: -1', []],
  ['order: 1.5', ['number:1.5']],
  ['grid-row: 1 / -1', []],
  ['grid-column: 2 / span 3', []],
  ['grid-row-start: 2', []],
  ['grid-row-end: -1', []],
  ['grid-column-start: 1', []],
  ['grid-column-end: span 2', []],
  ['grid-area: 1 / 1 / span 2 / -1', []],
  ['grid-template-rows: span 2', []],
  ['grid-template-rows: 2 span', []],
  ['flex-grow: 2', []],
  ['flex-shrink: 0', []],
  ['flex: 2', []],
  ['flex: 1 1 var(--size-x)', []],
  ['flex: 1.5', ['number:1.5']],
  ['column-count: 3', []],
  ['column-count: 2.5', ['number:2.5']],
  ['columns: 3 var(--size-col)', []],
  ['line-clamp: 3', []],
  ['-webkit-line-clamp: 3', []],
  ['grid-template-columns: repeat(3, 1fr)', []],
  ['grid-template-columns: repeat(2, minmax(0, 1fr))', []],
  ['grid-template-columns: repeat(auto-fill, minmax(var(--size-card), 1fr))', []],
  ['grid-template-columns: repeat(1.5, 1fr)', ['number:1.5']],
  ['grid-template-columns: repeat(2, 3)', ['number:3']],
  // A number as a factor or divisor inside a math function.
  ['padding: calc(var(--space-2) * 1.5)', []],
  ['padding: calc(1.5 * var(--space-2))', []],
  ['width: calc(var(--size-card) / 3)', []],
  ['margin-top: calc(var(--space-2) * -1)', []],
  ['margin-top: calc(var(--space-2)*-1)', []],
  ['margin: calc((var(--space-1) + var(--space-2)) * 2)', []],
  ['width: min(100%, calc(var(--size-x) * 2))', []],
  // Only in a math function that holds a var(): the minifier computes one of literals alone (13.1 item 40), so
  // `calc(100% / 3)` would ship as `33.3333%`.
  ['width: calc(100% / 3)', ['number:3']],
  ['width: calc(100% * 0.5)', ['number:0.5']],
  ['scale: calc(2 * 1.5)', []],
  ['width: min(var(--size-x), calc(100% / 3))', []],
  ['width: clamp(var(--size-x), 100% / 3, var(--size-y))', []],
  ['width: calc(var(--size-x) + 100% / 4)', []],
  ['padding: calc(var(--space-2) + 1.5)', ['number:1.5']],
  ['padding: calc(var(--space-2) * 2px)', ['dimension:2px']],
  ['line-height: calc(1.5)', ['number:1.5']],
  ['width: calc(50% * 2)', ['percentage:50%', 'number:2']],
  // Colors.
  ['color: currentColor', []],
  ['color: CURRENTCOLOR', []],
  ['color: transparent', []],
  ['border-color: TransParent', []],
  ['color: #c00', ['hex:#c00']],
  ['color: #FFFFFF', ['hex:#FFFFFF']],
  ['color: #0000', ['hex:#0000']],
  ['box-shadow: 0 0 #00000000', ['hex:#00000000']],
  ['background: #hero', ['hex:#hero']],
  ['color: #000-1px', ['hex:#000-1px']],
  ['color: rgb(0 0 0)', ['color-function:rgb(0 0 0)']],
  ['color: RGBA(0, 0, 0, .5)', ['color-function:RGBA(0, 0, 0, .5)']],
  ['color: hsl(0 0% 0%)', ['color-function:hsl(0 0% 0%)']],
  ['color: hsla(0, 0%, 0%, 1)', ['color-function:hsla(0, 0%, 0%, 1)']],
  ['color: hwb(0 0% 0%)', ['color-function:hwb(0 0% 0%)']],
  ['color: lab(50 0 0)', ['color-function:lab(50 0 0)']],
  ['color: lch(50 0 0)', ['color-function:lch(50 0 0)']],
  ['color: oklab(.5 0 0)', ['color-function:oklab(.5 0 0)']],
  ['color: oklch(.5 0 0)', ['color-function:oklch(.5 0 0)']],
  ['color: color(srgb 1 0 0)', ['color-function:color(srgb 1 0 0)']],
  [
    'color: color-mix(in srgb, var(--color-a), var(--color-b))',
    ['color-function:color-mix(in srgb, var(--color-a), var(--color-b))'],
  ],
  ['color: light-dark(var(--color-a), var(--color-b))', ['color-function:light-dark(var(--color-a), var(--color-b))']],
  ['color: device-cmyk(0 0 0 1)', ['color-function:device-cmyk(0 0 0 1)']],
  ['transform: translate(rgb(0 0 0))', ['color-function:rgb(0 0 0)']],
  ['color: red', ['named-color:red']],
  ['color: Red', ['named-color:Red']],
  ['background: rebeccapurple', ['named-color:rebeccapurple']],
  ['border: 1px solid red', ['dimension:1px', 'named-color:red']],
  ['border-top: solid red', ['named-color:red']],
  ['border-inline-start-color: red', ['named-color:red']],
  ['outline: solid red', ['named-color:red']],
  ['text-decoration: underline red', ['named-color:red']],
  ['text-decoration-color: red', ['named-color:red']],
  ['text-emphasis: filled red', ['named-color:red']],
  ['column-rule-color: red', ['named-color:red']],
  ['caret-color: red', ['named-color:red']],
  ['accent-color: red', ['named-color:red']],
  ['scrollbar-color: red blue', ['named-color:red', 'named-color:blue']],
  ['fill: red', ['named-color:red']],
  ['stroke: red', ['named-color:red']],
  ['stop-color: red', ['named-color:red']],
  ['flood-color: red', ['named-color:red']],
  ['lighting-color: red', ['named-color:red']],
  ['box-shadow: 0 0 0 red', ['named-color:red']],
  ['text-shadow: 0 0 red', ['named-color:red']],
  ['filter: drop-shadow(0 0 0 red)', ['named-color:red']],
  ['--brand: red', ['named-color:red']],
  ['mask-image: linear-gradient(black, transparent)', ['named-color:black']],
  ['list-style-image: repeating-radial-gradient(red, var(--color-a))', ['named-color:red']],
  ['background-image: -webkit-linear-gradient(red, var(--color-a))', ['named-color:red']],
  // A color name on a property that takes no color is a keyword.
  ['animation-name: red', []],
  // A plain number in `animation` is its count only at the top level of the value (7.3).
  ['animation: card-in var(--duration-m) cubic-bezier(0.4, 0, 0.2, 1)', ['number:0.4', 'number:0.2', 'number:1']],
  ['animation: card-in var(--duration-m) steps(4)', ['number:4']],
  ['animation: card-in var(--duration-m) linear(0, 0.25, 1)', ['number:0.25', 'number:1']],
  [
    'animation: card-in var(--duration-m) var(--ease-a) 2 cubic-bezier(1, 2, 3, 4)',
    ['number:1', 'number:2', 'number:3', 'number:4'],
  ],
  ['animation: card-in var(--duration-m) var(--ease-a) 2', []],
  ['animation: card-in var(--duration-m) var(--ease-a) var(--count, 2)', []],
  ['scrollbar-color: red blue', ['named-color:red', 'named-color:blue']],
  ['font-family: Red Hat Display', []],
  ['grid-area: field', []],
  ['view-transition-name: mark', []],
  ['transition-property: color, background', []],
  ['font: menu', []],
  // System colors and other color keywords.
  ['color: Canvas', ['system-color:Canvas']],
  ['background-color: ButtonFace', ['system-color:ButtonFace']],
  ['border-color: buttonborder', ['system-color:buttonborder']],
  ['color: WindowText', ['system-color:WindowText']],
  ['outline-color: -webkit-focus-ring-color', ['system-color:-webkit-focus-ring-color']],
  ['background: background', ['system-color:background']],
  // Keywords and dashed identifiers.
  ['display: flex', []],
  ['margin-inline: auto', []],
  ['color: inherit', []],
  ['transition: none', []],
  ['color: revert-layer', []],
  ['anchor-name: --menu', []],
  ['position-anchor: --menu', []],
  // Strings, url() and var() names go before the scan; a fallback is scanned.
  ['content: "13px #fff red"', []],
  ['font-variation-settings: "wght" 400', []],
  ['background-image: url(13px.png)', []],
  ['background-image: url("13px.png")', []],
  ['src: src("x.woff2")', []],
  ['margin: var(--space-2)', []],
  ['margin: var(--space-2, 1rem)', ['dimension:1rem']],
  ['color: var(--color-a, #fff)', ['hex:#fff']],
  ['color: var(--color-a, red)', ['named-color:red']],
  ['color: var(--color-a, var(--color-b, rgb(0 0 0)))', ['color-function:rgb(0 0 0)']],
  ['margin: var(--space-2,)', []],
  ['margin: calc(var(--space-1, 2) * 1.5)', ['number:2']],
  ['--card-pad: var(--space-2)', []],
  ['--card-pad: 13px', ['dimension:13px']],
  // Names of JavaScript objects find nothing.
  ['constructor: toString', []],
  ['color: constructor', []],
  ['color: __proto__', []],
  ['__proto__: 13px', ['dimension:13px']],
];

test('the literal classifier accepts the 7.3 allowlist and gives every other literal with its kind', () => {
  for (const [text, expected] of LITERALS) {
    assert.deepEqual(literals(text), expected, text);
  }
});

test('the minified spelling of each declaration gives the same kinds of literals', () => {
  for (const [text, expected] of LITERALS) {
    const minified = text.replace(': ', ':').replaceAll(', ', ',');
    const kinds = literals(minified).map((literal) => literal.split(':')[0]);
    assert.deepEqual(
      kinds,
      expected.map((literal) => literal.split(':')[0]),
      minified,
    );
  }
});

/** The minifier's forms of allowed values (13.1 item 40): built gives none, source gives the literals named. */
const BUILT_FORMS: readonly (readonly [string, readonly string[], readonly string[]])[] = [
  ['color: #0000', [], ['hex:#0000']],
  ['color: #00000000', [], ['hex:#00000000']],
  ['border: 1px solid #0000', ['dimension:1px'], ['dimension:1px', 'hex:#0000']],
  ['box-shadow: 0 0 #0000', [], ['hex:#0000']],
  ['color: #000f', ['hex:#000f'], ['hex:#000f']],
  ['color: #0001', ['hex:#0001'], ['hex:#0001']],
  ['color: currentColor', [], []],
  ['font-weight: 400', [], ['number:400']],
  ['font-weight: 700', [], ['number:700']],
  ['font-weight: 500', ['number:500'], ['number:500']],
  ['font: 700 var(--text-m)/var(--leading-m) var(--font-b)', [], ['number:700']],
  ['font: italic 400 1rem serif', ['dimension:1rem'], ['number:400', 'dimension:1rem']],
  ['font-stretch: 50%', [], ['percentage:50%']],
  ['font-stretch: 62.5%', [], ['percentage:62.5%']],
  ['font-stretch: 75%', [], ['percentage:75%']],
  ['font-stretch: 87.5%', [], ['percentage:87.5%']],
  ['font-stretch: 100%', [], []],
  ['font-stretch: 112.5%', [], ['percentage:112.5%']],
  ['font-stretch: 125%', [], ['percentage:125%']],
  ['font-stretch: 150%', [], ['percentage:150%']],
  ['font-stretch: 200%', [], ['percentage:200%']],
  ['font-stretch: 80%', ['percentage:80%'], ['percentage:80%']],
  ['font: 75% var(--text-m) var(--font-b)', [], ['percentage:75%']],
  ['opacity: 1', [], ['number:1']],
  ['fill-opacity: 1', [], ['number:1']],
  ['stroke-opacity: 1', [], ['number:1']],
  ['opacity: .5', ['number:.5'], ['number:.5']],
  ['opacity: 0', [], []],
  ['width: 1', ['number:1'], ['number:1']],
  ['scale: 1', [], []],
  ['transform: scale(.5)', [], []],
  ['filter: grayscale()', [], []],
  ['background-position: 50%', [], []],
  ['background-position: 100% 100%', [], []],
  ['background-position-x: 50%', [], []],
  ['mask-position: 50%', [], []],
  ['transform-origin: 50%', [], []],
  ['perspective-origin: 50%', [], []],
  ['background: 0 0', [], []],
  ['flex: 1 0', [], []],
  ['flex: 0 auto', [], []],
  ['grid-area: 1/2', [], []],
  ['grid-area: 1/1/span 2/-1', [], []],
  ['grid-template: auto/repeat(2,1fr)', [], []],
  ['transition-delay: 0s', [], []],
  ['transform: rotate(0)', [], []],
  ['transform: translate(-50%,-50%)rotate(45deg)', [], []],
  ['clip-path: polygon(0 0,100% 0,50% 100%)', [], []],
  ['animation: 3 card-in', [], []],
  // The count of `animation` is a plain number at the top level only: an easing function takes `--ease-` tokens.
  [
    'animation:card-in var(--duration-m) cubic-bezier(.4,0,.2,1)',
    ['number:.4', 'number:.2', 'number:1'],
    ['number:.4', 'number:.2', 'number:1'],
  ],
  ['animation:card-in var(--duration-m) steps(4) 3', ['number:4'], ['number:4']],
  // The limits of the minifier's forms: `400`, `700` and the `font-stretch` percentages count nowhere else.
  ['z-index: 400', ['number:400'], ['number:400']],
  ['line-height: 700', ['number:700'], ['number:700']],
  ['width: 50%', ['percentage:50%'], ['percentage:50%']],
  ['inline-size: 112.5%', ['percentage:112.5%'], ['percentage:112.5%']],
  [
    'font: 400 calc(1rem * 400) serif',
    ['dimension:1rem', 'number:400'],
    ['number:400', 'dimension:1rem', 'number:400'],
  ],
  [
    'font: 75% min(75%, 1rem) serif',
    ['percentage:75%', 'dimension:1rem'],
    ['percentage:75%', 'percentage:75%', 'dimension:1rem'],
  ],
  ['text-size-adjust: 100%', [], []],
  ['-moz-text-size-adjust: 100%', [], []],
];

test('the built form accepts the minifier forms of allowed values, and the source form does not', () => {
  for (const [text, built, source] of BUILT_FORMS) {
    assert.deepEqual(literals(text, 'built'), built, `built ${text}`);
    assert.deepEqual(literals(text, 'source'), source, `source ${text}`);
  }
});

test('system colors pass only inside forced colors; named colors and other color keywords never do', () => {
  const css = [
    '.a{color:Canvas;border-color:ButtonText}',
    '@media (forced-colors: active){.a{color:CanvasText;background:Canvas;outline-color:Highlight;border-color:red}}',
    '@media (forced-colors:active){.a{color:canvastext;fill:windowtext;stroke:#0000}}',
  ].join('\n');
  assert.deepEqual(literalsOf(css, 'source'), [
    'system-color:Canvas',
    'system-color:ButtonText',
    'named-color:red',
    'system-color:windowtext',
    'hex:#0000',
  ]);
  assert.deepEqual(literalsOf(css, 'built'), [
    'system-color:Canvas',
    'system-color:ButtonText',
    'named-color:red',
    'system-color:windowtext',
  ]);
  for (const name of SYSTEM_COLORS) {
    assert.deepEqual(literals(`color: ${name}`, 'source', true), [], name);
    assert.deepEqual(literals(`color: ${name}`, 'source', false), [`system-color:${name}`], name);
  }
});

test('the system colors are the 19 of 7.3, in lower case', () => {
  const start = SPEC.indexOf('System colors (');
  const list = SPEC.slice(start, SPEC.indexOf(')', start));
  const names = [...list.matchAll(/`([A-Za-z]+)`/g)].map((match) => asciiLower(match[1] ?? ''));
  assert.equal(names.length, 19);
  assert.deepEqual([...SYSTEM_COLORS].sort(), names.sort());
});

/** The geometry literals of 7.3, property by property: a value that passes, and one that fails with its literals. */
const GEOMETRY: readonly (readonly [string, string, readonly string[]])[] = [
  // An angle in any value.
  ['rotate: 180deg', 'rotate: 10px', ['dimension:10px']],
  ['rotate: 1 0 0 -2deg', 'rotate: 1 0 0 2px', ['dimension:2px']],
  ['font-style: oblique 10deg', 'font-style: oblique 10px', ['dimension:10px']],
  [
    'background-image: linear-gradient(45deg, var(--color-a), var(--color-b))',
    'background-image: linear-gradient(45px, var(--color-a), var(--color-b))',
    ['dimension:45px'],
  ],
  ['transform: rotate(.5turn) skew(10grad) rotate(1rad)', 'transform: rotate(5px)', ['dimension:5px']],
  // A plain number.
  ['scale: 1.05', 'scale: 2px', ['dimension:2px']],
  [
    'transform: scale(1.1) matrix(1, 0, 0, 1, 0, 0) translate(var(--space-1))',
    'transform: translateX(10px)',
    ['dimension:10px'],
  ],
  ['filter: grayscale(0.4) brightness(1.1)', 'filter: blur(4px)', ['dimension:4px']],
  ['backdrop-filter: saturate(1.5) blur(var(--space-1))', 'backdrop-filter: blur(2px)', ['dimension:2px']],
  ['-webkit-backdrop-filter: saturate(1.5)', '-webkit-backdrop-filter: blur(2px)', ['dimension:2px']],
  ['animation-iteration-count: 3', 'animation-iteration-count: 3s', ['dimension:3s']],
  ['animation: card-in var(--duration-m) 3', 'animation: card-in 200ms 3', ['dimension:200ms']],
  ['font-variation-settings: "opsz" 32, "wght" 650', 'font-variation-settings: "opsz" 32px', ['dimension:32px']],
  ['font-feature-settings: "liga" 1', 'font-feature-settings: "liga" 1px', ['dimension:1px']],
  ['font-size-adjust: ex-height 0.5', 'font-size-adjust: 50%', ['percentage:50%']],
  ['orphans: 2', 'orphans: 50%', ['percentage:50%']],
  ['widows: 2', 'widows: 50%', ['percentage:50%']],
  ['tab-size: 4', 'tab-size: 4px', ['dimension:4px']],
  ['stroke-dasharray: 4 2', 'stroke-dasharray: 4px 2px', ['dimension:4px', 'dimension:2px']],
  ['stroke-miterlimit: 4', 'stroke-miterlimit: 50%', ['percentage:50%']],
  ['border-image: var(--gradient-a) 1', 'border-image: var(--gradient-a) 30%', ['percentage:30%']],
  ['border-image-slice: 1 fill', 'border-image-slice: 10px', ['dimension:10px']],
  // A percentage.
  ['translate: -50% var(--space-1)', 'translate: 10px', ['dimension:10px']],
  ['scale: 50% 120%', 'scale: 2px', ['dimension:2px']],
  ['transform: translate(-50%, -50%) scale(50%)', 'transform: translate(-50%, 10px)', ['dimension:10px']],
  ['filter: brightness(110%) opacity(50%) saturate(150%)', 'filter: brightness(110%) blur(1px)', ['dimension:1px']],
  ['backdrop-filter: brightness(80%)', 'backdrop-filter: 80%', ['percentage:80%']],
  ['filter: grayscale(50%)', 'filter: 50%', ['percentage:50%']],
  ['clip-path: polygon(0 0, 100% 0, 100% 85%, 0 100%)', 'clip-path: polygon(0 0, 10px 0)', ['dimension:10px']],
  ['clip-path: circle(50% at 30% 20%)', 'clip-path: circle(10px at 30% 20%)', ['dimension:10px']],
  ['clip-path: ellipse(40% 50% at 50% 50%)', 'clip-path: ellipse(4px 50%)', ['dimension:4px']],
  ['clip-path: inset(10% round var(--radius-m))', 'clip-path: inset(10% round 4px)', ['dimension:4px']],
  ['clip-path: xywh(0 0 100% 50%)', 'clip-path: xywh(0 0 100% 5px)', ['dimension:5px']],
  ['clip-path: rect(0 100% 50% 0)', 'clip-path: rect(0 1px 50% 0)', ['dimension:1px']],
  ['clip-path: path("M 0 0 L 10 10")', 'clip-path: 50% border-box', ['percentage:50%']],
  ['shape-outside: circle(50%)', 'shape-outside: circle(10px)', ['dimension:10px']],
  ['object-position: 30% 20%', 'object-position: 10px 20%', ['dimension:10px']],
  ['background-position: 30% 20%', 'background-position: 10px', ['dimension:10px']],
  ['background-position-x: 50%', 'background-position-x: 10px', ['dimension:10px']],
  ['background-position-y: 50%', 'background-position-y: 10px', ['dimension:10px']],
  ['background-size: 50% auto', 'background-size: 10px', ['dimension:10px']],
  ['mask-position: 50% 0', 'mask-position: 10px', ['dimension:10px']],
  ['mask-size: 50%', 'mask-size: 10px', ['dimension:10px']],
  ['transform-origin: 50% 0', 'transform-origin: 10px', ['dimension:10px']],
  ['perspective-origin: 50% 50%', 'perspective-origin: 10px', ['dimension:10px']],
  ['background: var(--gradient-a) 50% 20% / 100% no-repeat', 'background: var(--gradient-a) 10px', ['dimension:10px']],
  [
    'mask: var(--gradient-a) 50% / 50%',
    'mask: linear-gradient(var(--color-a) 50%, var(--color-b))',
    ['percentage:50%'],
  ],
  // Elsewhere neither a number nor a percentage passes.
  ['width: 100%', 'width: 50%', ['percentage:50%']],
  ['opacity: 0', 'opacity: 0.5', ['number:0.5']],
  ['margin: 0', 'margin: 2', ['number:2']],
];

test('the geometry literals pass on their properties, and lengths do not', () => {
  for (const [passes, fails, expected] of GEOMETRY) {
    assert.deepEqual(literals(passes), [], passes);
    assert.deepEqual(literals(fails), expected, fails);
  }
});

test('each literal has the place of its token', () => {
  const first = declarationOf('\n  padding: 1px 13px;');
  assert.deepEqual(
    bannedLiterals(first, { form: 'source', forcedColors: false }).map((literal) => place(literal.place)),
    ['2:12', '2:16'],
  );
  const second = declarationOf('\n  color: var(--c,\n    rgb(0 0 0))');
  assert.deepEqual(
    bannedLiterals(second, { form: 'source', forcedColors: false }).map(
      (literal) => `${literal.kind} ${place(literal.place)}`,
    ),
    ['color-function 3:5'],
  );
});

// Keyframe selectors (7.3)

test('keyframe selectors are from, to or a percentage from 0% to 100%', () => {
  assert.deepEqual(keyframeProblems('@keyframes k{from{opacity:0}50%{opacity:0}to{opacity:0}}'), ['ok', 'ok', 'ok']);
  assert.deepEqual(keyframeProblems('@keyframes k{0%{opacity:0}to{opacity:1}}'), ['ok', 'ok']);
  assert.deepEqual(keyframeProblems('@keyframes k { FROM, 0%, 33.3%, 100%, To { opacity: 0 } }'), [
    'ok',
    'ok',
    'ok',
    'ok',
    'ok',
  ]);
  assert.deepEqual(keyframeProblems('@keyframes k { 50 {} half {} -10% {} 120% {} entry 10% {} }'), [
    '1:16 the keyframe selector `50` is no `from`, `to` or percentage',
    '1:22 the keyframe selector `half` is no `from`, `to` or percentage',
    '1:30 the keyframe selector `-10%` is outside `0%` to `100%`',
    '1:38 the keyframe selector `120%` is outside `0%` to `100%`',
    '1:46 the keyframe selector `entry 10%` is no `from`, `to` or percentage',
  ]);
  assert.deepEqual(
    keyframeSelectorProblem(parseValue('.card').values, AT_START)?.message,
    'the keyframe selector `.card` is no `from`, `to` or percentage',
  );
  assert.deepEqual(keyframeSelectorProblem([], AT_START)?.message, 'an empty keyframe selector');
  // An empty selector has the place of its keyframe rule, where the parser reports it too; not the start of the file.
  const css = '.x{}\n\n@keyframes a {\n  50%, { opacity: 0 }\n  , to { opacity: 1 }\n}';
  assert.deepEqual(keyframeProblems(css), [
    'ok',
    '4:3 an empty keyframe selector',
    '5:3 an empty keyframe selector',
    'ok',
  ]);
  assert.deepEqual(
    parseCss(css, 'x.css').problems.map((problem) => `${place(problem.place)} ${problem.message}`),
    ['4:3 an empty selector', '5:3 an empty selector'],
  );
  assert.deepEqual(
    keyframeSelectorProblem(parseValue('constructor').values, AT_START)?.message,
    'the keyframe selector `constructor` is no `from`, `to` or percentage',
  );
});

// var() extraction

/** One value text and its var()s as `<name> <fallback or -> <math or -> <functions>`. */
const VARS: readonly (readonly [string, readonly string[]])[] = [
  ['var(--space-2)', ['--space-2 - - ']],
  ['var(--space-2, 1rem)', ['--space-2 1rem - ']],
  ['var(--space-2,)', ['--space-2  - ']],
  ['var( --space-2 )', ['--space-2 - - ']],
  ['VAR(--Space-2)', ['--Space-2 - - ']],
  ['var(1px)', [' - - ']],
  ['var(--a --b)', [' - - ']],
  ['var(--a, var(--b, 1px))', ['--a var(--b, 1px) - ', '--b 1px - ']],
  ['var(--a,var(--b))', ['--a var(--b) - ', '--b - - ']],
  ['calc(100% - var(--space-4))', ['--space-4 - math calc']],
  ['-webkit-calc(100% - var(--space-4))', ['--space-4 - math -webkit-calc']],
  ['-moz-min(var(--a), 1rem)', ['--a - math -moz-min']],
  ['min(calc(var(--a)), 1rem)', ['--a - math min,calc']],
  [
    'minmax(var(--space-4), 1fr) fit-content(var(--size-x))',
    ['--space-4 - math minmax', '--size-x - math fit-content'],
  ],
  ['drop-shadow(0 0 var(--space-1) var(--color-a))', ['--space-1 - - drop-shadow', '--color-a - - drop-shadow']],
  ['translate(calc((var(--a) + 1px) * 2))', ['--a - math translate,calc']],
  ['"var(--a)" url(var(--b))', []],
  ['--menu', []],
];

test('varsOf gives every var() in text order, with its fallback, its math context and its functions', () => {
  for (const [text, expected] of VARS) {
    const uses = varsOf(parseValue(text).values).map(
      (use) =>
        `${use.name} ${use.fallback === undefined ? '-' : serialize(use.fallback)} ${use.inMath ? 'math' : '-'} ${use.functions.join(',')}`,
    );
    assert.deepEqual(uses, expected, text);
  }
  assert.deepEqual(
    varsOf(parseValue('a\n  var(--x)').values).map((use) => place(use.place)),
    ['2:3'],
  );
});

test('exactVar names the one var() of a value without fallback', () => {
  const cases: readonly (readonly [string, string | undefined])[] = [
    ['var(--space-2)', '--space-2'],
    ['var( --space-2 )', '--space-2'],
    ['var(--a, 1px)', undefined],
    ['var(--a,)', undefined],
    ['var(--a) var(--b)', undefined],
    ['calc(var(--a))', undefined],
    ['var(a)', undefined],
    ['--a', undefined],
    ['', undefined],
  ];
  for (const [text, expected] of cases) {
    assert.equal(exactVar(parseValue(text).values), expected, text);
  }
});

test('dashedIdents gives the dashed identifiers that are values, never the name of a var()', () => {
  const cases: readonly (readonly [string, readonly string[]])[] = [
    ['--menu', ['--menu']],
    ['--menu, --nav', ['--menu', '--nav']],
    ['var(--a)', []],
    ['var(--a, --b)', ['--b']],
    ['anchor(--menu top)', ['--menu']],
    ['-menu menu', []],
  ];
  for (const [text, expected] of cases) {
    assert.deepEqual(
      dashedIdents(parseValue(text).values).map((ident) => ident.value),
      expected,
      text,
    );
  }
});

test('isCustomProperty and helperParameterFamily read names exactly', () => {
  assert.equal(isCustomProperty('--x'), true);
  assert.equal(isCustomProperty('--'), true);
  assert.equal(isCustomProperty('color'), false);
  assert.equal(isCustomProperty('-webkit-x'), false);
  assert.equal(helperParameterFamily('--stack-gap'), 'space');
  assert.equal(helperParameterFamily('--grid-min'), 'size');
  assert.equal(helperParameterFamily('--center-max'), 'size');
  for (const name of ['constructor', '__proto__', 'toString', 'hasOwnProperty', '--space-1', '']) {
    assert.equal(helperParameterFamily(name), undefined, name);
  }
});

// Token substitution and css-banned

test('substituteVars replaces each known var(), stops cycles and deep chains, and keeps unknown names', () => {
  const lookup = lookupOf(
    new Map([
      ['--size-screen', '100vw'],
      ['--a', 'var(--b) 1px'],
      ['--b', '2px'],
      ['--loop-a', 'var(--loop-b)'],
      ['--loop-b', 'var(--loop-a)'],
      ['--self', 'var(--self)'],
    ]),
  );
  const cases: readonly (readonly [string, string])[] = [
    ['var(--size-screen)', '100vw'],
    ['var(--a)', '2px 1px'],
    ['calc(var(--a) * 2)', 'calc(2px 1px * 2)'],
    ['(var(--b))', '(2px)'],
    ['var(--x, 1px)', 'var(--x, 1px)'],
    ['var(--loop-a)', 'var(--loop-a)'],
    ['var(--self)', 'var(--self)'],
    ['var(constructor)', 'var(constructor)'],
  ];
  for (const [text, expected] of cases) {
    assert.equal(serialize(substituteVars(parseValue(text).values, lookup)), expected, text);
  }
  const chain = lookupOf(
    new Map(Array.from({ length: 40 }, (_, index) => [`--v${index}`, index === 39 ? '1px' : `var(--v${index + 1})`])),
  );
  assert.equal(serialize(substituteVars(parseValue('var(--v0)').values, chain)), 'var(--v32)');
  const doubling = lookupOf(
    new Map(Array.from({ length: 40 }, (_, index) => [`--d${index}`, `var(--d${index + 1}) var(--d${index + 1})`])),
  );
  const started = Date.now();
  const doubled = substituteVars(parseValue('var(--d0)').values, doubling);
  assert.ok(doubled.length < 300_000);
  assert.ok(Date.now() - started < 5000);
});

test('viewport width units: a unit gives its place, a var() that brings one gives the place of the var()', () => {
  const lookup = lookupOf(
    new Map([
      ['--size-screen', '100vw'],
      ['--size-half', 'var(--size-wide)'],
      ['--size-wide', 'calc(50lvw + 1rem)'],
      ['--size-tall', '100vh'],
      ['--loop', 'var(--loop)'],
    ]),
  );
  /** Each row: a declaration, and the texts whose first place in `.a{<declaration>}` each reported place is. */
  const cases: readonly (readonly [string, readonly string[]])[] = [
    // Drift row 24.
    ['inline-size: var(--size-screen)', ['var(']],
    ['width: 100vw', ['100vw']],
    ['WIDTH: 100VW', ['100VW']],
    ['max-width: 100dvw', ['100dvw']],
    ['min-inline-size: 100svi', ['100svi']],
    ['max-inline-size: 1vmax', ['1vmax']],
    ['min-width: 1lvmin', ['1lvmin']],
    ['margin-top: 10vmin', ['10vmin']],
    ['margin-inline: calc(50% - 50vw)', ['50vw']],
    ['margin: 0 var(--size-half) 1vi', ['var(', '1vi']],
    ['width: var(--x, 100vw)', ['100vw']],
    ['width: var(--size-tall)', []],
    ['width: var(--loop)', []],
    ['width: 100vh', []],
    ['height: 100vw', []],
    ['padding: 100vw', []],
    ['inset-inline: 100vw', []],
    ['constructor: 100vw', []],
  ];
  for (const [text, markers] of cases) {
    const expected = markers.map((marker) => `1:${`.a{${text}`.indexOf(marker) + 1}`);
    assert.deepEqual(viewportWidthUnits(declarationOf(text), lookup).map(place), expected, text);
  }
  assert.deepEqual(literals('inline-size: var(--size-screen)'), []);
  assert.equal(VIEWPORT_WIDTH_UNITS.size, 16);
  assert.deepEqual([...VIEWPORT_WIDTH_UNITS].sort(), [
    'dvi',
    'dvmax',
    'dvmin',
    'dvw',
    'lvi',
    'lvmax',
    'lvmin',
    'lvw',
    'svi',
    'svmax',
    'svmin',
    'svw',
    'vi',
    'vmax',
    'vmin',
    'vw',
  ]);
});

test('urlsOf gives every URL of a value', () => {
  /** Each row: a value, and the texts whose first place in it each reported place is. */
  const cases: readonly (readonly [string, readonly string[]])[] = [
    ['url(a.png)', ['url(']],
    ['url("a.png") no-repeat', ['url(']],
    ['URL( "a.png" )', ['URL(']],
    ['src("a.woff2")', ['src(']],
    ['image-set("a.avif" 1x, url(b.png) 2x)', ['"a.avif"', 'url(']],
    ['-webkit-image-set("a.avif" 1x)', ['"a.avif"']],
    ['var(--a, url(a.png))', ['url(']],
    ['"url(a.png)" attr(src)', []],
    ['var(--a)', []],
  ];
  for (const [text, markers] of cases) {
    const expected = markers.map((marker) => `1:${text.indexOf(marker) + 1}`);
    assert.deepEqual(urlsOf(parseValue(text).values).map(place), expected, text);
  }
});

// design-pairs

test('colorPosition says where a color token stands (7.4)', () => {
  const cases: readonly (readonly [string, string])[] = [
    ['color', 'foreground'],
    ['outline-color', 'foreground'],
    ['outline', 'foreground'],
    ['border-color', 'foreground'],
    ['border-top-color', 'foreground'],
    ['border-inline-start-color', 'foreground'],
    ['border', 'foreground'],
    ['border-block-end', 'foreground'],
    ['fill', 'foreground'],
    ['stroke', 'foreground'],
    ['text-decoration-color', 'foreground'],
    ['text-decoration', 'foreground'],
    ['-webkit-text-decoration', 'foreground'],
    ['background-color', 'background'],
    ['background', 'background'],
    ['BACKGROUND', 'background'],
    ['caret-color', '-'],
    ['box-shadow', '-'],
    ['--color-text', '-'],
    ['constructor', '-'],
    ['__proto__', '-'],
  ];
  for (const [property, expected] of cases) {
    assert.equal(colorPosition(property) ?? '-', expected, property);
  }
});

// The matrices of 14.1

/** The freedom rows (14.1): each in source form and in the built form of Lightning CSS. Every one gives nothing. */
const FREEDOM: readonly (readonly [number, string, string])[] = [
  [1, '.card { rotate: 180deg; }', '.card{rotate:180deg}'],
  [2, '.card:hover { scale: 1.05; }', '.card:hover{scale:1.05}'],
  [
    3,
    '.card { transform: translateY(var(--space-1)) rotate(-2deg); }',
    '.card{transform:translateY(var(--space-1)) rotate(-2deg)}',
  ],
  [4, '.card { filter: blur(var(--space-1)) grayscale(0.4); }', '.card{filter:blur(var(--space-1)) grayscale(.4)}'],
  [5, '.card { background-image: var(--gradient-hero); }', '.card{background-image:var(--gradient-hero)}'],
  [
    6,
    '@keyframes card-in { from { opacity: 0; } 50% { opacity: var(--opacity-half); } to { opacity: 100%; } }\n.card { animation-name: card-in; }',
    '@keyframes card-in{0%{opacity:0}50%{opacity:var(--opacity-half)}to{opacity:1}}.card{animation-name:card-in}',
  ],
  [7, '.card { width: calc(100% - var(--space-4)); }', '.card{width:calc(100% - var(--space-4))}'],
  [8, '.card { padding: calc(var(--space-2) * 1.5); }', '.card{padding:calc(var(--space-2) * 1.5)}'],
  [
    9,
    '.card { grid-template-columns: minmax(var(--space-4), 1fr) minmax(0, var(--size-content)) minmax(var(--space-4), 1fr); }',
    '.card{grid-template-columns:minmax(var(--space-4), 1fr) minmax(0, var(--size-content)) minmax(var(--space-4), 1fr)}',
  ],
  [
    10,
    '.card { clip-path: polygon(0 0, 100% 0, 100% 85%, 0 100%); }',
    '.card{clip-path:polygon(0 0,100% 0,100% 85%,0 100%)}',
  ],
  [11, '.card { object-position: 30% 20%; }', '.card{object-position:30% 20%}'],
  [
    12,
    '@media (width >= 48rem) { .card { gap: var(--space-2); } }',
    '@media (width>=48rem){.card{gap:var(--space-2)}}',
  ],
  [
    13,
    '@container (inline-size >= 30rem) { .card .card__body { gap: var(--space-2); } }',
    '@container (inline-size>=30rem){.card .card__body{gap:var(--space-2)}}',
  ],
  [14, '.card { @starting-style { opacity: 0; } }', '.card{@starting-style{opacity:0}}'],
  [15, '.card { &:hover { color: var(--color-accent); } }', '.card{&:hover{color:var(--color-accent)}}'],
  [
    16,
    '.nav .nav__link[aria-current="page"]:hover { color: var(--color-accent); }',
    '.nav .nav__link[aria-current=page]:hover{color:var(--color-accent)}',
  ],
  [
    17,
    '.card:has(img) { gap: var(--space-1); }\n.list .list__item:nth-child(2n + 1) { gap: var(--space-1); }',
    '.card:has(img){gap:var(--space-1)}.list .list__item:nth-child(odd){gap:var(--space-1)}',
  ],
  [18, '.card { anchor-name: --menu; position-anchor: --menu; }', '.card{anchor-name:--menu;position-anchor:--menu}'],
  [19, '.card { font-variation-settings: "opsz" 32; }', '.card{font-variation-settings:"opsz" 32}'],
  [20, '.card { aspect-ratio: var(--size-wide); }', '.card{aspect-ratio:var(--size-wide)}'],
  [21, '.card { box-shadow: var(--shadow-card); }', '.card{box-shadow:var(--shadow-card)}'],
  [22, '.card { stroke-width: var(--line-1); }', '.card{stroke-width:var(--line-1)}'],
  [23, '.card { animation-iteration-count: 3; }', '.card{animation-iteration-count:3}'],
  [
    24,
    '@media (width >= 48rem) { .hero { grid-column: span 2; } }',
    '@media (width>=48rem){.hero{grid-column:span 2}}',
  ],
];

test('each freedom row of 14.1 classifies as allowed, in source form and in built form', () => {
  for (const [row, source, built] of FREEDOM) {
    assert.equal(parseCss(source, 'x.css').problems.length, 0, `row ${row} source parses`);
    assert.equal(parseCss(built, 'x.css').problems.length, 0, `row ${row} built parses`);
    assert.ok(declarationsOf(source).length > 0, `row ${row} has declarations`);
    assert.equal(declarationsOf(source).length, declarationsOf(built).length, `row ${row} keeps its declarations`);
    assert.deepEqual(literalsOf(source, 'source'), [], `row ${row} source literals`);
    assert.deepEqual(literalsOf(built, 'built'), [], `row ${row} built literals`);
    assert.deepEqual(sheetFamilyProblems(source), [], `row ${row} source families`);
    assert.deepEqual(sheetFamilyProblems(built), [], `row ${row} built families`);
  }
});

test('the value rows of the drift matrix (14.1) classify as the matrix expects', () => {
  // Rows 1 to 4: css-literal.
  assert.deepEqual(literalsOf('.card { color: #c00; }', 'source'), ['hex:#c00']);
  assert.deepEqual(literalsOf('.card{color:#c00}', 'built'), ['hex:#c00']);
  assert.deepEqual(literalsOf('.card { padding: 13px; }', 'source'), ['dimension:13px']);
  assert.deepEqual(literalsOf('.card{padding:13px}', 'built'), ['dimension:13px']);
  assert.deepEqual(literalsOf('.card { color: red; }', 'source'), ['named-color:red']);
  assert.deepEqual(literalsOf('.card{color:red}', 'built'), ['named-color:red']);
  assert.deepEqual(literalsOf('.card { margin: var(--space-2, 1rem); }', 'source'), ['dimension:1rem']);
  assert.deepEqual(literalsOf('.card{margin:var(--space-2,1rem)}', 'built'), ['dimension:1rem']);
  const row4 = varsOf(declarationOf('margin: var(--space-2, 1rem)').value);
  assert.deepEqual(
    row4.map((use) => [use.name, use.fallback === undefined ? undefined : serialize(use.fallback)]),
    [['--space-2', '1rem']],
  );
  // Row 5: a custom property in elements.css is a definition; its value holds no literal.
  const row5 = declarationOf('--brand: var(--color-a)');
  assert.equal(isCustomProperty(row5.property), true);
  assert.equal(exactVar(row5.value), '--color-a');
  assert.deepEqual(literals('--brand: var(--color-a)'), []);
  // Row 6: css-token-family.
  assert.deepEqual(familyProblemsOf('padding: var(--color-accent)'), ['--color-accent']);
  assert.deepEqual(literals('padding: var(--color-accent)'), []);
  // Row 7: a local is exactly one var(); whether it stands on the root is for selectors.ts.
  const row7 = declarationsOf('.card .card__body { --card-pad: var(--space-2) }')[0]?.declaration;
  assert.equal(row7 === undefined ? undefined : exactVar(row7.value), '--space-2');
  assert.equal(isCustomProperty(row7?.property ?? ''), true);
  // Rows 8 and 9: the names that css-local-var and css-var-undefined look up.
  assert.deepEqual(
    varsOf(declarationOf('padding: var(--card-pad)').value).map((use) => use.name),
    ['--card-pad'],
  );
  assert.deepEqual(
    varsOf(declarationOf('gap: var(--space-99)').value).map((use) => use.name),
    ['--space-99'],
  );
  assert.equal(familyOf('--space-99'), 'space');
  // Row 10: the helper parameter that `.stack` reads has its family.
  assert.equal(helperParameterFamily('--stack-gap'), 'space');
  // Row 24: css-banned, and no literal.
  const row24 = declarationOf('inline-size: var(--size-screen)');
  assert.equal(viewportWidthUnits(row24, lookupOf(new Map([['--size-screen', '100vw']]))).length, 1);
  assert.deepEqual(bannedLiterals(row24, { form: 'source', forcedColors: false }), []);
  assert.deepEqual(familyProblemsOf('inline-size: var(--size-screen)'), []);
});

test('hostile values give bounded results and never throw', () => {
  const deep = `width: ${'calc('.repeat(40)}var(--a)${')'.repeat(40)}`;
  assert.ok(literals(deep).length <= 1);
  assert.ok(varsOf(declarationOf(deep).value).length <= 1);
  const many = `margin: ${'1px '.repeat(20_000)}`;
  assert.equal(literals(many).length, 20_000);
  const names = 'color: constructor __proto__ toString hasOwnProperty valueOf';
  assert.deepEqual(literals(names), []);
  // A name of a JavaScript object is a property with no family: the length group passes, a color does not.
  for (const property of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
    assert.deepEqual(familyProblemsOf(`${property}: var(--space-1)`), [], property);
    assert.deepEqual(familyProblemsOf(`${property}: var(--color-a)`), ['--color-a'], property);
  }
  assert.deepEqual(familyProblemsOf('padding: var(--__proto__)'), []);
});

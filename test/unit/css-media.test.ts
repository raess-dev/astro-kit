/**
 * The `@media` and `@container` prelude parser (specification, 7.10, 7.12 and the rows `css-media` and `modes-media`
 * of section 8). Each table runs the source forms and the built forms of Lightning CSS (13.1 item 40): the minifier
 * writes `(width>=48rem)` for `(min-width: 48rem)` and `(width >= 48rem)`.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CONTAINER_FEATURES,
  lengthProblems,
  MEDIA_FEATURES,
  MEDIA_TYPES,
  type MediaPrelude,
  MODE_FEATURES,
  minifiedWidth,
  modeFeatures,
  parseContainerPrelude,
  parseMediaPrelude,
  preludeOf,
  requiresForcedColors,
  sameLength,
} from '../../src/css/media.ts';
import { type AtRule, MAX_PROBLEMS, parseCss, parseValue, walk } from '../../src/css/parse.ts';

// Helpers. None asserts.

const media = (text: string): MediaPrelude => parseMediaPrelude(parseValue(text).values);
const container = (text: string): MediaPrelude => parseContainerPrelude(parseValue(text).values);

/** The problem messages of a prelude. */
const messages = (prelude: MediaPrelude): string[] => prelude.problems.map((problem) => problem.message);

/** The features of a prelude as `name form`, with `not` for a negated one. */
const features = (prelude: MediaPrelude): string[] =>
  prelude.features.map((feature) => `${feature.name} ${feature.form}${feature.negated ? ' not' : ''}`);

/** The lengths of a prelude as `value unit`. */
const lengths = (prelude: MediaPrelude): string[] => prelude.lengths.map((length) => `${length.value} ${length.unit}`);

/** The breakpoints of the tables: `48rem` and `30rem`. */
const BREAKPOINTS = [{ width: '48rem' }, { width: '30rem' }];

/** Every `@media` and `@container` of a CSS text, with its problems and its length problems. */
function preludeProblems(css: string): string[] {
  const out: string[] = [];
  const sheet = parseCss(css, 'test.css');
  out.push(...sheet.problems.map((problem) => `parse: ${problem.message}`));
  walk(sheet, (node) => {
    if (node.type !== 'at-rule') return;
    const prelude = preludeOf(node);
    if (prelude === undefined) return;
    out.push(...messages(prelude), ...lengthProblems(prelude, BREAKPOINTS).map((problem) => problem.message));
  });
  return out;
}

/** The mode features of every prelude of a CSS text. */
function modeFeaturesOf(css: string): string[] {
  const out: string[] = [];
  walk(parseCss(css, 'test.css'), (node) => {
    if (node.type !== 'at-rule') return;
    const prelude = preludeOf(node);
    if (prelude !== undefined) out.push(...modeFeatures(prelude).map((feature) => feature.name));
  });
  return out;
}

/** `requiresForcedColors` for the at-rules around the first declaration of a CSS text. */
function forcedAt(css: string): boolean | undefined {
  let found: readonly AtRule[] | undefined;
  walk(parseCss(css, 'test.css'), (node, context) => {
    if (node.type === 'declaration' && found === undefined) found = context.atRules;
  });
  return found === undefined ? undefined : requiresForcedColors(found);
}

// Which problems CSS shares (css-oracle.test.ts holds them to Chromium)

/** The problems of a prelude as `invalid` or `policy`, in the order of the text. */
const problemKinds = (prelude: MediaPrelude): string[] =>
  prelude.problems.map((problem) => (problem.invalid ? 'invalid' : 'policy'));

/**
 * `invalid`: a browser reads the query as `not all`, or drops the `@container` rule. `policy`: a rule of 7.10 for a
 * prelude that CSS reads. CSS reads any text in brackets as an unknown condition, so a problem there is policy.
 */
const MEDIA_KINDS: readonly [string, string[]][] = [
  ['(width >= 48rem)', []],
  ['only (hover)', ['invalid']],
  ['layer', ['invalid']],
  ['screen and (hover) or (pointer)', ['invalid']],
  ['(hover) and not (pointer)', ['invalid']],
  ['screen print', ['invalid']],
  ['(hover) and(pointer)', ['invalid']],
  ['1px', ['invalid']],
  [', print', ['invalid']],
  ['print,', ['invalid']],
  ['tv', ['policy']],
  ['(hover: foo)', ['policy']],
  ['(foo bar)', ['policy']],
  ['(min-width)', ['policy']],
  ['(width: 1px 2px)', ['policy']],
  ['((hover) and (pointer) or (x))', ['policy', 'policy']],
  ['(width > var(--x))', ['policy']],
  ['foo(x)', ['policy']],
  ['tv and (hover) or (pointer)', ['policy', 'invalid']],
];

const CONTAINER_KINDS: readonly [string, string[]][] = [
  ['(inline-size > 30rem)', []],
  ['', ['invalid']],
  ['not all', ['invalid']],
  ['(width > 0) and not (height > 0)', ['invalid']],
  ['card (inline-size > 30rem)', ['policy']],
  ['card', ['policy']],
  // Chromium 153 keeps `@container card not` as `@container card`: after a name no problem is a claim about CSS.
  ['card not', ['policy', 'policy']],
  ['(inline-size > 30rem), (inline-size > 40rem)', ['policy']],
  ['style(--x: 1)', ['policy']],
];

test('each problem says whether CSS refuses the query too, or only 7.10 does', () => {
  for (const [text, expected] of MEDIA_KINDS) assert.deepEqual(problemKinds(media(text)), expected, text);
  for (const [text, expected] of CONTAINER_KINDS) assert.deepEqual(problemKinds(container(text)), expected, text);
});

test('an empty query of a list reports inside its own part: at the comma after the first, after the comma before others', () => {
  assert.deepEqual(
    media(', print').problems.map((problem) => problem.place.column),
    [1],
  );
  assert.deepEqual(
    media('print,, screen').problems.map((problem) => problem.place.column),
    [7],
  );
  assert.deepEqual(
    media('print,').problems.map((problem) => problem.place.column),
    [7],
  );
});

// The tables of 7.10

test('the tables hold the media types, the features and the mode features of 7.10 and 7.12', () => {
  assert.deepEqual([...MEDIA_TYPES], ['all', 'screen', 'print']);
  assert.deepEqual([...MEDIA_FEATURES].sort(), [
    'any-hover',
    'any-pointer',
    'forced-colors',
    'height',
    'hover',
    'max-height',
    'max-width',
    'min-height',
    'min-width',
    'orientation',
    'pointer',
    'prefers-color-scheme',
    'prefers-contrast',
    'prefers-reduced-motion',
    'prefers-reduced-transparency',
    'scripting',
    'width',
  ]);
  assert.deepEqual([...CONTAINER_FEATURES].sort(), [
    'block-size',
    'height',
    'inline-size',
    'max-block-size',
    'max-height',
    'max-inline-size',
    'max-width',
    'min-block-size',
    'min-height',
    'min-inline-size',
    'min-width',
    'orientation',
    'width',
  ]);
  assert.deepEqual([...MODE_FEATURES], ['prefers-color-scheme', 'prefers-contrast']);
  for (const name of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
    assert.equal(MEDIA_TYPES.has(name) || MEDIA_FEATURES.has(name) || CONTAINER_FEATURES.has(name), false, name);
  }
});

test('the media types all, screen and print pass, in source and built form; every other type fails', () => {
  const pass: [string, string[]][] = [
    ['all', ['all']],
    ['screen', ['screen']],
    ['print', ['print']],
    ['SCREEN', ['screen']],
    ['not print', ['print']],
    ['only screen', ['screen']],
    ['screen, print', ['screen', 'print']],
    ['screen,print', ['screen', 'print']],
    ['only screen and (hover: hover)', ['screen']],
    ['not all and (width >= 48rem)', ['all']],
  ];
  for (const [text, types] of pass) {
    const prelude = media(text);
    assert.deepEqual(messages(prelude), [], text);
    assert.deepEqual(
      prelude.types.map((type) => type.name),
      types,
      text,
    );
  }
  const fail: [string, string][] = [
    ['tv', 'the media type `tv` is not allowed (7.10)'],
    ['speech', 'the media type `speech` is not allowed (7.10)'],
    ['handheld and (hover)', 'the media type `handheld` is not allowed (7.10)'],
    ['constructor', 'the media type `constructor` is not allowed (7.10)'],
    ['__proto__', 'the media type `__proto__` is not allowed (7.10)'],
    ['layer', '`layer` where a media type belongs'],
    ['only and', '`and` where a media type belongs'],
    ['not or', '`or` where a media type belongs'],
  ];
  for (const [text, message] of fail) assert.deepEqual(messages(media(text)), [message], text);
});

test('the keywords not, only, and, or follow the grammar of Media Queries Level 4', () => {
  const pass: [string, string[]][] = [
    ['not (hover)', ['hover boolean not']],
    ['not screen and (hover)', ['hover boolean not']],
    ['screen and not (hover)', ['hover boolean not']],
    ['only screen and (hover) and (pointer: fine)', ['hover boolean', 'pointer plain']],
    ['(hover) and (pointer: fine)', ['hover boolean', 'pointer plain']],
    ['(hover)and (pointer:fine)', ['hover boolean', 'pointer plain']],
    ['(hover) or (pointer: fine)', ['hover boolean', 'pointer plain']],
    ['((hover) and (pointer: fine))', ['hover boolean', 'pointer plain']],
    ['((hover) and (pointer: fine)) or (width >= 48rem)', ['hover boolean', 'pointer plain', 'width range']],
    ['(not (hover)) and (not (pointer: fine))', ['hover boolean not', 'pointer plain not']],
    ['(width<48rem) or (not (hover))', ['width range', 'hover boolean not']],
    ['NOT (HOVER)', ['hover boolean not']],
    ['', []],
  ];
  for (const [text, expected] of pass) {
    const prelude = media(text);
    assert.deepEqual(messages(prelude), [], text);
    assert.deepEqual(features(prelude), expected, text);
  }
  // Each of these is `not all` in Chromium: CSS refuses it.
  const fail: [string, string][] = [
    ['only (hover)', '`only` without a media type'],
    ['not', 'a condition in brackets is missing'],
    ['not (hover) and (pointer)', '`and` after `not ( … )`: add brackets'],
    ['(hover) and (pointer) or (width >= 48rem)', '`and` and `or` mixed at one level: add brackets'],
    ['screen and (hover) or (pointer)', '`or` after a media type: add brackets'],
    ['(hover) and not (pointer)', '`not` after `and`: write `and (not ( … ))`'],
    ['not not (hover)', '`not` where a media type belongs'],
    ['screen and(hover)', '`and()` after a media type: write `and`'],
    ['screen screen', '`screen` after a media type: write `and`'],
    ['screen and', 'a condition in brackets is missing'],
    ['(hover) and', 'a condition in brackets is missing'],
    ['and (hover)', '`and` where a media type belongs'],
    ['or (hover)', '`or` where a media type belongs'],
    ['(hover) (pointer)', '`( )` where `and` or `or` belongs'],
    ['"screen"', '`"screen"` where a condition in brackets belongs'],
    ['[hover]', '`[ ]` where a condition in brackets belongs'],
    ['screen,,print', 'an empty media query in a list'],
    ['screen,', 'an empty media query in a list'],
    ['(hover) and (pointer) and', 'a condition in brackets is missing'],
  ];
  for (const [text, message] of fail) assert.deepEqual(messages(media(text)), [message], text);
});

test('every media feature of 7.10 passes with its values, in source and in built form', () => {
  // [source, built (Lightning CSS), the feature]
  const rows: [string, string, string][] = [
    ['(width >= 48rem)', '(width>=48rem)', 'width range'],
    ['(height < 30rem)', '(height<30rem)', 'height range'],
    ['(min-width: 48rem)', '(min-width:48rem)', 'min-width plain'],
    ['(max-width: 48rem)', '(max-width:48rem)', 'max-width plain'],
    ['(min-height: 30rem)', '(min-height:30rem)', 'min-height plain'],
    ['(max-height: 30rem)', '(max-height:30rem)', 'max-height plain'],
    ['(width)', '(width)', 'width boolean'],
    ['(orientation: portrait)', '(orientation:portrait)', 'orientation plain'],
    ['(orientation: landscape)', '(orientation:landscape)', 'orientation plain'],
    ['(prefers-color-scheme: light)', '(prefers-color-scheme:light)', 'prefers-color-scheme plain'],
    ['(prefers-color-scheme: dark)', '(prefers-color-scheme:dark)', 'prefers-color-scheme plain'],
    ['(prefers-contrast: no-preference)', '(prefers-contrast:no-preference)', 'prefers-contrast plain'],
    ['(prefers-contrast: more)', '(prefers-contrast:more)', 'prefers-contrast plain'],
    ['(prefers-contrast: less)', '(prefers-contrast:less)', 'prefers-contrast plain'],
    ['(prefers-contrast: custom)', '(prefers-contrast:custom)', 'prefers-contrast plain'],
    ['(prefers-contrast)', '(prefers-contrast)', 'prefers-contrast boolean'],
    [
      '(prefers-reduced-motion: no-preference)',
      '(prefers-reduced-motion:no-preference)',
      'prefers-reduced-motion plain',
    ],
    ['(prefers-reduced-motion: reduce)', '(prefers-reduced-motion:reduce)', 'prefers-reduced-motion plain'],
    [
      '(prefers-reduced-transparency: no-preference)',
      '(prefers-reduced-transparency:no-preference)',
      'prefers-reduced-transparency plain',
    ],
    [
      '(prefers-reduced-transparency: reduce)',
      '(prefers-reduced-transparency:reduce)',
      'prefers-reduced-transparency plain',
    ],
    ['(forced-colors: none)', '(forced-colors:none)', 'forced-colors plain'],
    ['(forced-colors: active)', '(forced-colors:active)', 'forced-colors plain'],
    ['(forced-colors)', '(forced-colors)', 'forced-colors boolean'],
    ['(hover: none)', '(hover:none)', 'hover plain'],
    ['(hover: hover)', '(hover:hover)', 'hover plain'],
    ['(hover)', '(hover)', 'hover boolean'],
    ['(any-hover: none)', '(any-hover:none)', 'any-hover plain'],
    ['(any-hover: hover)', '(any-hover:hover)', 'any-hover plain'],
    ['(pointer: none)', '(pointer:none)', 'pointer plain'],
    ['(pointer: coarse)', '(pointer:coarse)', 'pointer plain'],
    ['(pointer: fine)', '(pointer:fine)', 'pointer plain'],
    ['(any-pointer: none)', '(any-pointer:none)', 'any-pointer plain'],
    ['(any-pointer: coarse)', '(any-pointer:coarse)', 'any-pointer plain'],
    ['(any-pointer: fine)', '(any-pointer:fine)', 'any-pointer plain'],
    ['(scripting: none)', '(scripting:none)', 'scripting plain'],
    ['(scripting: initial-only)', '(scripting:initial-only)', 'scripting plain'],
    ['(scripting: enabled)', '(scripting:enabled)', 'scripting plain'],
    ['(Hover: Hover)', '(hover:Hover)', 'hover plain'],
  ];
  for (const [source, built, feature] of rows) {
    for (const text of [source, built]) {
      const prelude = media(text);
      assert.deepEqual(messages(prelude), [], text);
      assert.deepEqual(features(prelude), [feature], text);
    }
  }
});

test('a feature value of the wrong kind fails', () => {
  const rows: [string, string][] = [
    ['(hover: foo)', 'the value `foo` of `hover` is not one of none, hover'],
    ['(hover: constructor)', 'the value `constructor` of `hover` is not one of none, hover'],
    ['(forced-colors: __proto__)', 'the value `__proto__` of `forced-colors` is not one of none, active'],
    ['(orientation: 1)', 'the value `1` of `orientation` is not one of portrait, landscape'],
    [
      '(prefers-color-scheme: no-preference)',
      'the value `no-preference` of `prefers-color-scheme` is not one of light, dark',
    ],
    ['(width >= 48)', 'the value `48` of `width` is no length'],
    ['(width >= 50%)', 'the value `50%` of `width` is no length'],
    ['(width >= 48px_)', 'the value `48px_` of `width` is no length'],
    ['(width >= 2dppx)', 'the value `2dppx` of `width` is no length'],
    ['(min-width: auto)', 'the value `auto` of `min-width` is no length'],
    ['(width: 48rem 60rem)', 'the value of `width` is more than one value'],
    ['(hover: hover hover)', 'the value of `hover` is more than one value'],
    ['(hover:)', '`hover` has no value after `:`'],
    ['(min-width)', '`min-width` needs a value'],
    ['(min-width >= 48rem)', '`min-width` in a range: write `width` with `<` or `>`'],
    ['(orientation > portrait)', '`orientation` is no range feature'],
    ['(hover = hover)', '`hover` is no range feature'],
  ];
  for (const [text, message] of rows) assert.deepEqual(messages(media(text)), [message], text);
});

test('a feature that 7.10 does not name fails, also a hostile name', () => {
  const rows: [string, string][] = [
    ['(min-resolution: 2dppx)', 'the media feature `min-resolution` is not allowed (7.10)'],
    ['(aspect-ratio: 16/9)', 'the media feature `aspect-ratio` is not allowed (7.10)'],
    ['(aspect-ratio > 16 / 9)', 'the media feature `aspect-ratio` is not allowed (7.10)'],
    ['(color)', 'the media feature `color` is not allowed (7.10)'],
    ['(monochrome)', 'the media feature `monochrome` is not allowed (7.10)'],
    ['(-webkit-min-device-pixel-ratio: 2)', 'the media feature `-webkit-min-device-pixel-ratio` is not allowed (7.10)'],
    ['(inline-size > 30rem)', 'the media feature `inline-size` is not allowed (7.10)'],
    ['(min-orientation: portrait)', 'the media feature `min-orientation` is not allowed (7.10)'],
    ['(--x)', 'the media feature `--x` is not allowed (7.10)'],
    ['(constructor)', 'the media feature `constructor` is not allowed (7.10)'],
    ['(__proto__: 1)', 'the media feature `__proto__` is not allowed (7.10)'],
    ['(toString >= 1px)', 'the media feature `tostring` is not allowed (7.10)'],
    ['(hasOwnProperty)', 'the media feature `hasownproperty` is not allowed (7.10)'],
    ['(foo bar)', 'no media feature in `foo bar`'],
    ['()', 'an empty `( )`'],
    ['(width: )', '`width` has no value after `:`'],
    ['(: hover)', '`:` is no media feature name'],
    ['(48rem < 60rem)', 'a range without a feature name'],
  ];
  for (const [text, message] of rows) assert.deepEqual(messages(media(text)), [message], text);
});

// Ranges and lengths

test('range syntax reads in both directions and with two comparisons; min-/max- give the same length', () => {
  // [text, the feature, the lengths]: source and built forms side by side.
  const rows: [string, string, string[]][] = [
    ['(width >= 48rem)', 'width range', ['48 rem']],
    ['(width>=48rem)', 'width range', ['48 rem']],
    ['(WIDTH >= 48REM)', 'width range', ['48 rem']],
    ['(48rem <= width)', 'width range', ['48 rem']],
    ['(48rem<=width)', 'width range', ['48 rem']],
    ['(width < 48rem)', 'width range', ['48 rem']],
    ['(width > 48rem)', 'width range', ['48 rem']],
    ['(width <= 48rem)', 'width range', ['48 rem']],
    ['(width = 48rem)', 'width range', ['48 rem']],
    ['(48rem = width)', 'width range', ['48 rem']],
    ['(48rem > width)', 'width range', ['48 rem']],
    ['(30rem <= width < 48rem)', 'width range', ['30 rem', '48 rem']],
    ['(30rem<=width<48rem)', 'width range', ['30 rem', '48 rem']],
    ['(30rem < width <= 48rem)', 'width range', ['30 rem', '48 rem']],
    ['(48rem > width >= 30rem)', 'width range', ['48 rem', '30 rem']],
    ['(48rem>width>=30rem)', 'width range', ['48 rem', '30 rem']],
    ['(height >= 30rem)', 'height range', ['30 rem']],
    ['(min-width: 48rem)', 'min-width plain', ['48 rem']],
    ['(min-width:48rem)', 'min-width plain', ['48 rem']],
    ['(max-width: 30rem)', 'max-width plain', ['30 rem']],
    ['(min-height: 30rem)', 'min-height plain', ['30 rem']],
    ['(max-height: 48rem)', 'max-height plain', ['48 rem']],
    ['(width >= 0)', 'width range', ['0 ']],
    ['(min-width: 0)', 'min-width plain', ['0 ']],
    ['(width >= 0px)', 'width range', ['0 px']],
    ['(width >= +48rem)', 'width range', ['48 rem']],
    ['(width >= -1px)', 'width range', ['-1 px']],
  ];
  for (const [text, feature, expected] of rows) {
    const prelude = media(text);
    assert.deepEqual(messages(prelude), [], text);
    assert.deepEqual(features(prelude), [feature], text);
    assert.deepEqual(lengths(prelude), expected, text);
  }
  // CSS refuses these: Chromium keeps them only as an unknown condition that never matches.
  const fail: [string, string][] = [
    ['(width > = 48rem)', 'a space inside `>=`'],
    ['(width < = 48rem)', 'a space inside `<=`'],
    ['(width = = 48rem)', 'no media feature in `width = = 48rem`'],
    ['(width =< 48rem)', 'no media feature in `width =< 48rem`'],
    ['(width => 48rem)', 'no media feature in `width => 48rem`'],
    ['(30rem <= width > 48rem)', 'a range whose two comparisons do not both read `<` or both `>`'],
    ['(30rem = width = 48rem)', 'a range whose two comparisons do not both read `<` or both `>`'],
    ['(30rem <= width = 48rem)', 'a range whose two comparisons do not both read `<` or both `>`'],
    ['(width < 30rem < 48rem)', 'a range without a feature name'],
    ['(width width)', 'no media feature in `width width`'],
    ['(width >= 48rem >=)', 'no media feature in `width >= 48rem >=`'],
  ];
  for (const [text, message] of fail) assert.deepEqual(messages(media(text)), [message], text);
});

test('a length equals a breakpoint when the number and the unit are the same (7.10)', () => {
  // Breakpoints 48rem and 30rem: [text, the length problems].
  const rows: [string, string[]][] = [
    ['(width >= 48rem)', []],
    ['(width>=48rem)', []],
    ['(min-width: 48rem)', []],
    ['(width >= 48.0rem)', []],
    ['(width >= 48REM)', []],
    ['(width >= +48rem)', []],
    ['(30rem <= width < 48rem)', []],
    ['(width >= 768px)', ['the length `768px` equals no breakpoint width (48rem, 30rem)']],
    ['(width >= 3em)', ['the length `3em` equals no breakpoint width (48rem, 30rem)']],
    ['(width >= 48em)', ['the length `48em` equals no breakpoint width (48rem, 30rem)']],
    ['(width >= 47.99rem)', ['the length `47.99rem` equals no breakpoint width (48rem, 30rem)']],
    ['(width >= 0)', ['the length `0` equals no breakpoint width (48rem, 30rem)']],
    ['(width >= 1e1px)', ['the length `1e1px` equals no breakpoint width (48rem, 30rem)']],
    ['(20rem <= width < 30rem)', ['the length `20rem` equals no breakpoint width (48rem, 30rem)']],
    // A length of an unknown feature counts too (7.10: every length of a prelude).
    ['(device-width: 777px)', ['the length `777px` equals no breakpoint width (48rem, 30rem)']],
  ];
  for (const [text, expected] of rows) {
    assert.deepEqual(
      lengthProblems(media(text), BREAKPOINTS).map((problem) => problem.message),
      expected,
      text,
    );
  }
  assert.deepEqual(
    lengthProblems(media('(width >= 48rem)'), []).map((problem) => problem.message),
    ['the length `48rem` equals no breakpoint width (none declared)'],
  );
  const same: [string, string, boolean][] = [
    ['(width >= 48rem)', '48rem', true],
    ['(width >= 48.0rem)', '48rem', true],
    ['(width >= 48REM)', '48rem', true],
    ['(width >= 48rem)', '48.00rem', true],
    ['(width >= 48rem)', '768px', false],
    ['(width >= 768px)', '48rem', false],
    ['(width >= 3em)', '48rem', false],
    // The same number with another unit is another length.
    ['(width >= 48px)', '48rem', false],
    ['(width >= 48em)', '48rem', false],
    ['(width >= 48rem)', '48', false],
    ['(width >= 48rem)', '48rem 1px', false],
    ['(width >= 48rem)', 'constructor', false],
    ['(width >= 48rem)', '', false],
    ['(width >= 48rem)', '"48rem"', false],
  ];
  for (const [text, width, expected] of same) {
    const [length] = media(text).lengths;
    assert.equal(length !== undefined && sameLength(length, width), expected, `${text} ${width}`);
  }
});

test('a built length equals the minifier form of a breakpoint: no unit on 0, 6 significant digits (13.1 item 40)', () => {
  // The source forms on the left; Lightning CSS 1.33 with the targets of 6.1 writes the built forms on the right.
  const pairs: [source: string, built: string, width: string][] = [
    ['(width >= 0rem)', '(width>=0)', '0rem'],
    ['(min-width: 0px)', '(width>=0)', '0px'],
    ['(width >= 48.123456rem)', '(width>=48.1235rem)', '48.123456rem'],
    ['(width >= 1234567.5px)', '(width>=1234570px)', '1234567.5px'],
    ['(width >= 7654321.25px)', '(width>=7654321px)', '7654321.25px'],
    ['(width >= 48.00rem)', '(width>=48rem)', '48.00rem'],
    ['(width >= 0.0001rem)', '(width>=.0001rem)', '0.0001rem'],
  ];
  for (const [source, built, width] of pairs) {
    const breakpoints = [{ width }, { width: '48rem' }];
    assert.deepEqual(lengthProblems(media(source), breakpoints), [], source);
    assert.deepEqual(lengthProblems(media(built), breakpoints, 'built'), [], built);
    const [length] = media(built).lengths;
    assert.equal(length !== undefined && sameLength(length, width, 'built'), true, `${built} ${width}`);
  }
  // The source form stays strict: a unitless 0 and a rounded number equal no breakpoint there.
  assert.deepEqual(
    lengthProblems(media('(width>=0)'), [{ width: '0rem' }]).map((problem) => problem.message),
    ['the length `0` equals no breakpoint width (0rem)'],
  );
  assert.deepEqual(
    lengthProblems(media('(width>=48.1235rem)'), [{ width: '48.123456rem' }]).map((problem) => problem.message),
    ['the length `48.1235rem` equals no breakpoint width (48.123456rem)'],
  );
  // The built form does not make other lengths equal: a unit, a zero against a non-zero width, another number.
  const built: [string, string, boolean][] = [
    ['(width>=0)', '48rem', false],
    ['(width>=0px)', '0rem', false],
    ['(width>=0rem)', '0rem', true],
    ['(width>=48px)', '48rem', false],
    ['(width>=48.1234rem)', '48.123456rem', false],
    ['(width>=48.123456rem)', '48.123456rem', false],
    ['(width>=1e39px)', '1e39px', false],
  ];
  for (const [text, width, expected] of built) {
    const [length] = media(text).lengths;
    assert.equal(length !== undefined && sameLength(length, width, 'built'), expected, `${text} ${width}`);
  }
  assert.equal(minifiedWidth(48.123456), 48.1235);
  assert.equal(minifiedWidth(123456789), 123456792);
  assert.equal(minifiedWidth(1e20), 2_147_483_647);
  assert.equal(minifiedWidth(1e39), undefined);
});

test('var() in a prelude fails with the S4 message, at the place of var()', () => {
  const s4 = '`var()` in a prelude: the minifier stops the build and names no source file (7.10, S4)';
  const rows: [string, string[]][] = [
    ['(width < var(--bp))', [s4]],
    ['(var(--bp) <= width)', [s4]],
    ['(min-width: var(--bp))', [s4]],
    ['screen and var(--x)', [s4]],
    ['var(--x)', [s4]],
    ['((width < var(--bp)))', [s4]],
    ['(width < calc(var(--bp) * 2))', ['the function `calc()` in a prelude', s4]],
    ['(width < VAR(--bp))', [s4]],
    ['(width < calc(48rem))', ['the function `calc()` in a prelude']],
    ['(width < env(safe-area-inset-left))', ['the function `env()` in a prelude']],
  ];
  for (const [text, expected] of rows) assert.deepEqual(messages(media(text)), expected, text);
  const prelude = media('(width < var(--bp))');
  assert.deepEqual(
    prelude.problems.map((problem) => problem.place.column),
    [10],
  );
  assert.deepEqual(messages(container('(inline-size > var(--bp))')), [s4]);
});

// @container

test('every container feature of 7.10 passes, in source and in built form', () => {
  const rows: [string, string, string[]][] = [
    ['(width > 30rem)', 'width range', ['30 rem']],
    ['(width>30rem)', 'width range', ['30 rem']],
    ['(height > 30rem)', 'height range', ['30 rem']],
    ['(inline-size >= 30rem)', 'inline-size range', ['30 rem']],
    ['(inline-size>=30rem)', 'inline-size range', ['30 rem']],
    ['(block-size < 48rem)', 'block-size range', ['48 rem']],
    ['(30rem <= block-size < 48rem)', 'block-size range', ['30 rem', '48 rem']],
    ['(30rem<=block-size<48rem)', 'block-size range', ['30 rem', '48 rem']],
    ['(min-width: 30rem)', 'min-width plain', ['30 rem']],
    ['(max-width: 30rem)', 'max-width plain', ['30 rem']],
    ['(min-height: 30rem)', 'min-height plain', ['30 rem']],
    ['(max-height: 30rem)', 'max-height plain', ['30 rem']],
    ['(min-inline-size: 30rem)', 'min-inline-size plain', ['30 rem']],
    ['(max-inline-size: 30rem)', 'max-inline-size plain', ['30 rem']],
    ['(min-block-size: 30rem)', 'min-block-size plain', ['30 rem']],
    ['(max-block-size: 30rem)', 'max-block-size plain', ['30 rem']],
    ['(orientation: portrait)', 'orientation plain', []],
    ['(orientation:landscape)', 'orientation plain', []],
    ['not (inline-size > 30rem)', 'inline-size range not', ['30 rem']],
  ];
  for (const [text, feature, expected] of rows) {
    const prelude = container(text);
    assert.equal(prelude.kind, 'container', text);
    assert.deepEqual(messages(prelude), [], text);
    assert.deepEqual(features(prelude), [feature], text);
    assert.deepEqual(lengths(prelude), expected, text);
  }
  const two = container('(inline-size >= 30rem) and (orientation: landscape)');
  assert.deepEqual(messages(two), []);
  assert.deepEqual(features(two), ['inline-size range', 'orientation plain']);
  assert.deepEqual(features(container('(width > 30rem) or (height > 30rem)')), ['width range', 'height range']);
});

test('an @container prelude holds no container name (lead decision 3), no list and no media feature', () => {
  const rows: [string, string[]][] = [
    ['card (width > 30rem)', ['the container name `card`: a prelude queries the nearest container']],
    ['card', ['the container name `card`: a prelude queries the nearest container']],
    ['none (width > 30rem)', ['the container name `none`: a prelude queries the nearest container']],
    ['constructor (width > 30rem)', ['the container name `constructor`: a prelude queries the nearest container']],
    ['(width > 30rem), (height > 30rem)', ['a list of container queries: the minifier stops the build']],
    ['', ['an `@container` without a query']],
    ['(hover)', ['the container feature `hover` is not allowed (7.10)']],
    ['(prefers-color-scheme: dark)', ['the container feature `prefers-color-scheme` is not allowed (7.10)']],
    ['(aspect-ratio > 1)', ['the container feature `aspect-ratio` is not allowed (7.10)']],
    ['(__proto__)', ['the container feature `__proto__` is not allowed (7.10)']],
    ['style(--x: 1)', ['the function `style()` in a prelude']],
    ['scroll-state(stuck: top)', ['the function `scroll-state()` in a prelude']],
    ['(inline-size > 30rem) and style(--x: 1)', ['the function `style()` in a prelude']],
    ['(min-inline-size >= 30rem)', ['`min-inline-size` in a range: write `inline-size` with `<` or `>`']],
    ['(inline-size > 50%)', ['the value `50%` of `inline-size` is no length']],
  ];
  for (const [text, expected] of rows) assert.deepEqual(messages(container(text)), expected, text);
  // The name gives its problem; the features after it are still read.
  assert.deepEqual(features(container('card (inline-size > 30rem)')), ['inline-size range']);
  // A media type is no container feature: `screen` reads as a container name.
  assert.deepEqual(messages(container('screen')), [
    'the container name `screen`: a prelude queries the nearest container',
  ]);
});

test('preludeOf parses @media and @container and nothing else', () => {
  const sheet = parseCss(
    '@media (width >= 48rem) {} @container (inline-size >= 30rem) {} @supports (display: grid) {} @starting-style {}',
    'test.css',
  );
  const kinds: string[] = [];
  walk(sheet, (node) => {
    if (node.type === 'at-rule') kinds.push(`${node.name} ${preludeOf(node)?.kind ?? 'none'}`);
  });
  assert.deepEqual(kinds, ['media media', 'container container', 'supports none', 'starting-style none']);
  // An empty @container gives its problem at the place of the at-rule.
  const empty = parseCss('\n  @container {}', 'test.css');
  const places: string[] = [];
  walk(empty, (node) => {
    if (node.type === 'at-rule') {
      for (const problem of preludeOf(node)?.problems ?? [])
        places.push(`${problem.place.line}:${problem.place.column}`);
    }
  });
  assert.deepEqual(places, ['2:3']);
});

// The matrix rows (14.1) and the modes

test('drift rows 17 to 19 each give their css-media problem', () => {
  const rows: [string, string[]][] = [
    // 17
    [
      '@layer components { @media (width < 777px) { .card { gap: var(--space-2); } } }',
      ['the length `777px` equals no breakpoint width (48rem, 30rem)'],
    ],
    // 18
    [
      '@layer components { @media (width < var(--bp)) { .card { gap: var(--space-2); } } }',
      ['`var()` in a prelude: the minifier stops the build and names no source file (7.10, S4)'],
    ],
    // 19
    [
      '@layer components { @media (min-resolution: 2dppx) { .card { gap: var(--space-2); } } }',
      ['the media feature `min-resolution` is not allowed (7.10)'],
    ],
    // 17, built form
    [
      '@layer components{@media (width<777px){.card{gap:var(--space-2)}}}',
      ['the length `777px` equals no breakpoint width (48rem, 30rem)'],
    ],
  ];
  for (const [css, expected] of rows) assert.deepEqual(preludeProblems(css), expected, css);
});

test('freedom rows 12, 13 and 24 pass with the breakpoints 48rem and 30rem, in source and in built form', () => {
  const rows: string[] = [
    // 12
    '@layer components { @media (width >= 48rem) { .card { gap: var(--space-2); } } }',
    '@layer components{@media (width>=48rem){.card{gap:var(--space-2)}}}',
    // 13
    '@layer components { @container (inline-size >= 30rem) { .card .card__body { gap: var(--space-2); } } }',
    '@layer components{@container (inline-size>=30rem){.card .card__body{gap:var(--space-2)}}}',
    // 24
    '@layer page { @media (width >= 48rem) { .hero { grid-column: span 2; } } }',
    '@layer page{@media (width>=48rem){.hero{grid-column:span 2}}}',
    // The same, nested in the rule, and with min-width.
    '@layer components { .card { @media (min-width: 48rem) { gap: var(--space-2); } } }',
  ];
  for (const css of rows) assert.deepEqual(preludeProblems(css), [], css);
});

test('prefers-color-scheme and prefers-contrast are reported as mode features, not as problems; forced-colors is no mode feature', () => {
  const rows: [string, string[]][] = [
    ['@media (prefers-color-scheme: dark) { .a { color: var(--color-text); } }', ['prefers-color-scheme']],
    ['@media (prefers-color-scheme:dark){.a{color:var(--color-text)}}', ['prefers-color-scheme']],
    ['@media (prefers-contrast: more) { .a { color: var(--color-text); } }', ['prefers-contrast']],
    ['@media (prefers-contrast) { .a { color: var(--color-text); } }', ['prefers-contrast']],
    ['@media not (prefers-contrast: more) { .a { color: var(--color-text); } }', ['prefers-contrast']],
    [
      '@media screen and (prefers-color-scheme: light), (prefers-contrast: less) { .a { color: var(--color-text); } }',
      ['prefers-color-scheme', 'prefers-contrast'],
    ],
    ['@media (forced-colors: active) { .a { color: CanvasText; } }', []],
    ['@media (prefers-reduced-motion: reduce) { .a { color: var(--color-text); } }', []],
    ['@container (inline-size >= 30rem) { .a { color: var(--color-text); } }', []],
  ];
  for (const [css, expected] of rows) {
    assert.deepEqual(modeFeaturesOf(css), expected, css);
    assert.deepEqual(preludeProblems(css), [], css);
  }
  // An HTML `media` attribute reads the same way after parseValue.
  assert.deepEqual(
    modeFeatures(media('(prefers-color-scheme: dark)')).map((feature) => feature.name),
    ['prefers-color-scheme'],
  );
});

test('requiresForcedColors is true only when every query requires (forced-colors: active)', () => {
  const rows: [string, boolean][] = [
    ['@media (forced-colors: active) { .a { color: CanvasText; } }', true],
    ['@media (forced-colors:active){.a{color:canvastext}}', true],
    ['@media (FORCED-COLORS: ACTIVE) { .a { color: CanvasText; } }', true],
    ['@media (forced-colors) { .a { color: CanvasText; } }', true],
    ['@media screen and (forced-colors: active) { .a { color: CanvasText; } }', true],
    ['@media only screen and (forced-colors: active) { .a { color: CanvasText; } }', true],
    ['@media (forced-colors: active) and (hover: hover) { .a { color: CanvasText; } }', true],
    ['@media ((forced-colors: active) and (hover)) { .a { color: CanvasText; } }', true],
    ['@media (forced-colors: active) or (forced-colors) { .a { color: CanvasText; } }', true],
    ['@media not (forced-colors: none) { .a { color: CanvasText; } }', true],
    ['@media (forced-colors: active), screen and (forced-colors: active) { .a { color: CanvasText; } }', true],
    ['@media (forced-colors: active) { .a { & .b { color: CanvasText; } } }', true],
    ['.a { @media (forced-colors: active) { color: CanvasText; } }', true],
    // Two nested @media: the outer one is enough, and so is the inner one.
    ['@media (forced-colors: active) { @media (width >= 48rem) { .a { color: CanvasText; } } }', true],
    ['@media (width >= 48rem) { @media (forced-colors: active) { .a { color: CanvasText; } } }', true],
    ['@media (width >= 48rem) { @media (hover) { .a { color: CanvasText; } } }', false],
    ['@layer components { @media (forced-colors: active) { .a { color: CanvasText; } } }', true],
    ['.a { color: CanvasText; }', false],
    ['@media not (forced-colors: active) { .a { color: CanvasText; } }', false],
    ['@media (forced-colors: none) { .a { color: CanvasText; } }', false],
    ['@media (forced-colors: active), print { .a { color: CanvasText; } }', false],
    ['@media (forced-colors: active) or (hover) { .a { color: CanvasText; } }', false],
    ['@media not screen and (forced-colors: active) { .a { color: CanvasText; } }', false],
    ['@media screen { .a { color: CanvasText; } }', false],
    ['@media { .a { color: CanvasText; } }', false],
    ['@media (forced-colors: activ) { .a { color: CanvasText; } }', false],
    ['@media (forced-colors: active) and (width < var(--bp)) { .a { color: CanvasText; } }', false],
    ['@media (forced-colors: active), { .a { color: CanvasText; } }', false],
    ['@supports (display: grid) { .a { color: CanvasText; } }', false],
    ['@container (inline-size >= 30rem) { .a { color: CanvasText; } }', false],
  ];
  for (const [css, expected] of rows) assert.equal(forcedAt(css), expected, css);
});

// Places and hostile input

test('problems and lengths carry the place of their token', () => {
  const sheet = parseCss('.a{}\n@media screen and (width < 777px) and (hover: x) {}', 'test.css');
  const out: string[] = [];
  walk(sheet, (node) => {
    if (node.type !== 'at-rule') return;
    const prelude = preludeOf(node);
    for (const length of prelude?.lengths ?? [])
      out.push(`length ${length.text} ${length.place.line}:${length.place.column}`);
    for (const feature of prelude?.features ?? [])
      out.push(`feature ${feature.name} ${feature.place.line}:${feature.place.column}`);
    for (const problem of prelude?.problems ?? []) out.push(`problem ${problem.place.line}:${problem.place.column}`);
    for (const type of prelude?.types ?? []) out.push(`type ${type.name} ${type.place.line}:${type.place.column}`);
  });
  assert.deepEqual(out, [
    'length 777px 2:28',
    'feature width 2:20',
    'feature hover 2:40',
    'problem 2:47',
    'type screen 2:8',
  ]);
});

test('hostile preludes give bounded problems and never throw', () => {
  const deep = `${'('.repeat(40)}hover${')'.repeat(40)}`;
  const many = Array.from({ length: 5000 }, () => '(foo)').join(', ');
  const chain = Array.from({ length: 5000 }, () => '(hover)').join(' and ');
  const long = `(${'a'.repeat(100_000)}: ${'b'.repeat(100_000)})`;
  const started = performance.now();
  for (const text of [deep, many, chain, long, `${'not '.repeat(1000)}(hover)`, '\\', '(', ')', '(width >=']) {
    for (const prelude of [media(text), container(text)]) {
      assert.ok(prelude.problems.length <= MAX_PROBLEMS, text.slice(0, 40));
      assert.ok(
        prelude.problems.every((problem) => problem.message.length < 300),
        text.slice(0, 40),
      );
    }
  }
  assert.equal(messages(media(chain)).length, 0);
  assert.equal(messages(media(many)).length, MAX_PROBLEMS);
  assert.equal(
    forcedAt(`@media ${deep.replace('hover', 'forced-colors: active')} { .a { color: CanvasText; } }`),
    false,
  );
  assert.ok(performance.now() - started < 5000);
});

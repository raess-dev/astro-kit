/**
 * The selector analyzer (specification, 3.2, 7.1, 7.8, 7.9 and 7.11): the selector parser, An+B, specificity,
 * compounds, the layer shapes, the at-rule shapes, the normalized text and the facts for other rules. Each shape
 * table runs the source form and the built form that Lightning CSS writes (13.1 item 40), and the rows of the drift
 * matrix and the freedom matrix of 14.1 that M5 builds on this module.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { asciiLower, type ComponentValue, parseCss, parseValue, walk } from '../../src/css/parse.ts';
import {
  atRuleProblem,
  attributesOf,
  type ComplexSelector,
  type CssFile,
  classRole,
  compoundCount,
  isRootSelector,
  keyframesOwner,
  localOwner,
  normalizeSelector,
  ownerOf,
  PLACEMENT_PROPERTIES,
  parseAnPlusB,
  parseSelector,
  parseSelectorList,
  type Refusal,
  SELECTOR_LIMITS,
  type ShapeOptions,
  selectorProblems,
  shapeProblems,
  specificity,
  subject,
} from '../../src/css/selectors.ts';

// Helpers. None asserts.

/** The components of the project in these tests. */
const OPTIONS: ShapeOptions = { components: new Set(['card', 'card-list', 'nav', 'list', 'hero', 'a']) };

const ELEMENTS: CssFile = { kind: 'elements' };
const PAGE: CssFile = { kind: 'page' };
const component = (name: string): CssFile => ({ kind: 'component', component: name });

/** The component values of a text. */
const valuesOf = (text: string): ComponentValue[] => parseValue(text).values;

/** The selector of a text, or undefined when it has a problem. */
function selectorOf(text: string, relative = false): ComplexSelector | undefined {
  return parseSelector(valuesOf(text), { relative }).selector;
}

/** `ok <normalized>`, or the problem as `<line>:<column> <message>`. */
function parsed(text: string, relative = false): string {
  const { selector, problem } = parseSelector(valuesOf(text), { relative });
  if (selector !== undefined) return `ok ${normalizeSelector(selector)}`;
  return `${problem.place.line}:${problem.place.column} ${problem.message}`;
}

/** The specificity of a text as `a,b,c`, or `problem`. */
function specificityOf(text: string, root?: string): string {
  const selector = selectorOf(text);
  if (selector === undefined) return 'problem';
  return (root === undefined ? specificity(selector) : specificity(selector, root)).join(',');
}

/** The An+B of a text as `a,b`, or `invalid`. */
function anPlusB(text: string): string {
  const value = parseAnPlusB(valuesOf(text));
  return value === undefined ? 'invalid' : `${value.a},${value.b}`;
}

/**
 * Every problem of a CSS text as css-selector would see it: the parse problems of the sheet, `atRuleProblem` for
 * each at-rule, and for each resolved selector of each style rule the parse problem or `selectorProblems`. Each is
 * `<line>:<column> <message>`.
 */
function problemsOf(css: string, file: CssFile, options: ShapeOptions = OPTIONS): string[] {
  const out: string[] = [];
  const sheet = parseCss(css, 'x.css');
  for (const { place, message } of sheet.problems) out.push(`${place.line}:${place.column} css: ${message}`);
  walk(sheet, (node) => {
    if (node.type === 'at-rule') {
      const problem = atRuleProblem(node, file);
      if (problem !== undefined) out.push(`${problem.place.line}:${problem.place.column} ${problem.message}`);
    } else if (node.type === 'rule' && node.kind === 'style') {
      for (const values of node.resolved) {
        const { selector, problem } = parseSelector(values);
        const problems = selector === undefined ? [problem] : selectorProblems(selector, file, options);
        for (const { place, message } of problems) out.push(`${place.line}:${place.column} ${message}`);
      }
    }
  });
  return out;
}

/** The messages of `problemsOf`, without places: the source and the built form of a text give the same. */
const messagesOf = (css: string, file: CssFile): string[] =>
  problemsOf(css, file).map((line) => line.slice(line.indexOf(' ') + 1));

/** The normalized text of every resolved selector of a CSS text. */
function normalizedOf(css: string): string[] {
  const out: string[] = [];
  walk(parseCss(css, 'x.css'), (node) => {
    if (node.type !== 'rule' || node.kind !== 'style') return;
    for (const values of node.resolved) {
      const { selector } = parseSelector(values);
      out.push(selector === undefined ? 'problem' : normalizeSelector(selector));
    }
  });
  return out;
}

// The parser

/** Selectors that CSS accepts, each with its normalized text. */
const ACCEPTED: readonly [string, string][] = [
  ['a', 'a'],
  ['A', 'a'],
  ['*', '*'],
  ['*.a', '.a'],
  ['.a', '.a'],
  ['.A', '.A'],
  ['.a.b', '.a.b'],
  ['#a', '#a'],
  ['#\\31 a', '#\\31 a'],
  ['.a\\:b', '.a\\:b'],
  ['.--a', '.--a'],
  ['a.b#c[d]:hover', 'a#c.b[d]:hover'],
  ['[a]', '[a]'],
  ['[ a ]', '[a]'],
  ['[A=b]', '[a="b"]'],
  ['[a="b"]', '[a="b"]'],
  ["[a='b']", '[a="b"]'],
  ['[a=-b]', '[a="-b"]'],
  ['[a~=b]', '[a~="b"]'],
  ['[a|=b]', '[a|="b"]'],
  ['[a^=b]', '[a^="b"]'],
  ['[a$=b]', '[a$="b"]'],
  ['[a*=b]', '[a*="b"]'],
  ['[a = "b" ]', '[a="b"]'],
  ['[a=b i]', '[a="b" i]'],
  ['[a=b I]', '[a="b" i]'],
  ['[a="b"i]', '[a="b" i]'],
  ['[x="a\\"b"]', '[x="a\\"b"]'],
  ['a:hover', 'a:hover'],
  ['A:HOVER', 'a:hover'],
  [':root', ':root'],
  [':focus-visible', ':focus-visible'],
  [':popover-open', ':popover-open'],
  ['a::before', 'a::before'],
  ['a:before', 'a::before'],
  ['a:AFTER', 'a::after'],
  ['p:first-line', 'p::first-line'],
  ['p:first-letter', 'p::first-letter'],
  ['li::marker', 'li::marker'],
  ['input::placeholder', 'input::placeholder'],
  ['::selection', '::selection'],
  ['a:hover::before', 'a:hover::before'],
  ['a ::before', 'a ::before'],
  ['::view-transition-group(*)', '::view-transition-group(*)'],
  ['::view-transition-old( x )', '::view-transition-old(x)'],
  // View transition classes (CSS View Transitions Level 2): Chromium reads them (css-oracle.test.ts).
  ['::view-transition-group(.a)', '::view-transition-group(.a)'],
  ['::view-transition-new(x.a.b)', '::view-transition-new(x.a.b)'],
  ['::view-transition-old(*.a)', '::view-transition-old(*.a)'],
  ['::highlight(x)', '::highlight(x)'],
  ['::picker(select)', '::picker(select)'],
  ['a>b', 'a>b'],
  ['a  >  b', 'a>b'],
  ['a +b', 'a+b'],
  ['a~ b', 'a~b'],
  ['a\tb\nc', 'a b c'],
  [':is(h2, h3)', ':is(h2,h3)'],
  [':is( a , b )', ':is(a,b)'],
  ['a:is(.b)', 'a.b'],
  [':is(a).b', 'a.b'],
  [':where(.a, #b)', ':where(.a,#b)'],
  [':not(a, b)', ':not(a,b)'],
  [':not(a b)', ':not(a b)'],
  [':not(:has(a))', ':not(:has(a))'],
  [':has(> img)', ':has(>img)'],
  [':has(a, > b, + c, ~ d)', ':has(a,>b,+c,~d)'],
  [':has(> a > b)', ':has(>a>b)'],
  [':nth-child(2n + 1)', ':nth-child(2n+1)'],
  [':nth-child(odd)', ':nth-child(2n+1)'],
  [':nth-child(EVEN)', ':nth-child(2n)'],
  [':nth-child(2n+1 of .a, .b)', ':nth-child(2n+1 of .a,.b)'],
  [':nth-child(odd of.a)', ':nth-child(2n+1 of .a)'],
  [':nth-last-child(-n + 3)', ':nth-last-child(-n+3)'],
  [':nth-of-type(2)', ':nth-of-type(2)'],
  [':nth-child(1)', ':first-child'],
  [':nth-last-child(1)', ':last-child'],
  [':nth-of-type(1)', ':first-of-type'],
  [':nth-last-of-type(1)', ':last-of-type'],
  [':nth-child(1 of .a)', ':nth-child(1 of .a)'],
  [':NTH-CHILD(2n)', ':nth-child(2n)'],
  [':lang(de-CH)', ':lang(de-CH)'],
  [':dir(RTL)', ':dir(rtl)'],
  ['&', '&'],
  ['& a', '& a'],
  ['a&', 'a&'],
  ['*&', '&'],
  ['.a&', '&.a'],
  [':is(.b, &)', ':is(.b,&)'],
  // css-banned reports `:global()`; this module reads it and leaves its arguments as they are.
  ['a:global(.b)', 'a:global(.b)'],
];

test('parseSelector accepts each selector of CSS and gives its normalized text', () => {
  for (const [text, normalized] of ACCEPTED) assert.equal(parsed(text), `ok ${normalized}`, text);
});

/**
 * Selectors that the kit refuses, and the first problem. CSS refuses most of them; `REFUSALS` below says which ones
 * a browser may keep.
 */
const REFUSED: readonly [string, string][] = [
  ['', '1:1 an empty selector'],
  [':foo', '1:1 the unknown pseudo-class `:foo`'],
  [':foo(a)', '1:1 the unknown pseudo-class `:foo()`'],
  [':hover()', '1:1 the unknown pseudo-class `:hover()`'],
  [':is', '1:1 the unknown pseudo-class `:is`'],
  [':before()', '1:1 the unknown pseudo-class `:before()`'],
  [':marker', '1:1 the unknown pseudo-class `:marker`'],
  ['::foo', '1:1 the unknown pseudo-element `::foo`'],
  ['::hover', '1:1 the unknown pseudo-element `::hover`'],
  ['::before(a)', '1:1 the unknown pseudo-element `::before()`'],
  ['::view-transition-new(x y)', '1:1 `::view-transition-new(x y)` has an argument that CSS refuses'],
  ['::picker(div)', '1:1 `::picker(div)` has an argument that CSS refuses'],
  [':', '1:1 a `:` without a pseudo-class name right after it'],
  ['a::', '1:2 a `::` without a pseudo-element name'],
  ['.', '1:1 a `.` without a class name right after it'],
  ['.1', '1:1 `.1` in a selector'],
  ['.-1', '1:1 a `.` without a class name right after it'],
  ['a. b', '1:2 a `.` without a class name right after it'],
  ['#1', '1:1 `#1` is no id selector: an id starts like a name'],
  ['#0f0', '1:1 `#0f0` is no id selector: an id starts like a name'],
  ['a*', '1:2 the type selector `*` after another simple selector'],
  ['*a', '1:2 the type selector `a` after another simple selector'],
  ['&a', '1:2 the type selector `a` after another simple selector'],
  ['a/**/b', '1:6 the type selector `b` after another simple selector'],
  ['ns|a', '1:1 a namespace prefix or the column combinator `||`; the kit reads neither'],
  ['*|a', '1:1 a namespace prefix or the column combinator `||`; the kit reads neither'],
  ['|a', '1:1 a namespace prefix or the column combinator `||`; the kit reads neither'],
  ['a || b', '1:3 a namespace prefix or the column combinator `||`; the kit reads neither'],
  ['> a', '1:1 the combinator `>` at the start of a selector'],
  ['a >', '1:3 the combinator `>` without a selector after it'],
  ['a > > b', '1:5 `>` where a selector should stand'],
  ['a, b', '1:2 a comma inside one selector: a list needs `parseSelectorList`'],
  ['a::before b', '1:11 a selector after a pseudo-element, which CSS refuses'],
  ['a::before:hover', '1:10 `:` after a pseudo-element, which the kit refuses'],
  ['a::before.b', '1:10 `.` after a pseudo-element, which the kit refuses'],
  ['a::before::marker', '1:10 `:` after a pseudo-element, which the kit refuses'],
  ['a"b"', '1:2 `"b"` in a selector'],
  ['a 1px', '1:3 `1px` in a selector'],
  ['a(b)', '1:1 `a(b)` in a selector'],
  ['a{}', '1:2 `{}` in a selector'],
  [':is()', '1:1 `:is()` without a selector'],
  [':not( )', '1:1 `:not()` without a selector'],
  [':has()', '1:1 `:has()` without a selector'],
  [':is(a,)', '1:2 an empty selector'],
  [':is(:foo)', '1:5 the unknown pseudo-class `:foo`'],
  [':is(::before)', '1:5 a pseudo-element inside a pseudo-class, which CSS refuses'],
  [':not(a:before)', '1:7 a pseudo-element inside a pseudo-class, which CSS refuses'],
  [':has(.a::before)', '1:8 a pseudo-element inside a pseudo-class, which CSS refuses'],
  [':is(> a)', '1:5 the combinator `>` at the start of a selector'],
  [':not(> a)', '1:6 the combinator `>` at the start of a selector'],
  [':has(+)', '1:6 the combinator `+` without a selector after it'],
  [':has(:has(a))', '1:6 `:has()` inside `:has()`, which CSS refuses'],
  [':has(:not(:has(a)))', '1:11 `:has()` inside `:has()`, which CSS refuses'],
  [':nth-child()', '1:1 `:nth-child()` holds no valid An+B'],
  [':nth-child(1.5)', '1:1 `:nth-child(1.5)` holds no valid An+B'],
  [':nth-child(+ n)', '1:1 `:nth-child(+ n)` holds no valid An+B'],
  [':nth-child(n of)', '1:1 `:nth-child()` has `of` without a selector'],
  [':nth-child(2n of > a)', '1:18 the combinator `>` at the start of a selector'],
  [':nth-child(2n of .a,)', '1:2 an empty selector'],
  [':nth-of-type(2n of .a)', '1:1 `:nth-of-type()` takes no `of` selector list'],
  [':lang("en")', '1:1 `:lang()` takes one language tag'],
  [':lang(en, de)', '1:1 `:lang()` takes one language tag'],
  [':dir(foo)', '1:1 `:dir()` takes `ltr` or `rtl`'],
  ['[]', '1:1 an attribute selector `[]` without a name'],
  ['[1=b]', '1:1 `[1=b]` has no attribute name'],
  ['[a=1]', '1:1 `[a=1]` needs a name or a string as its value'],
  ['[a= ]', '1:1 `[a= ]` needs a name or a string as its value'],
  ['[a!=b]', '1:1 `[a!=b]` has no valid operator'],
  ['[a = = b]', '1:1 `[a = = b]` needs a name or a string as its value'],
  ['[a=b c]', '1:1 `[a=b c]` has a text after the value'],
  ['[a=b"c"]', '1:1 `[a=b"c"]` has a text after the value'],
  ['[a=b s]', '1:1 `[a=b s]` has the modifier `s`, which Chromium refuses,'],
  ['[a=b i x]', '1:1 `[a=b i x]` has a text after its end'],
  ['[ns|a]', '1:1 the namespace in `[ns|a]`; the kit reads no namespace'],
  ['[|a]', '1:1 the namespace in `[|a]`; the kit reads no namespace'],
  ['[*|a]', '1:1 the namespace in `[*|a]`; the kit reads no namespace'],
  // Hostile names find nothing in the tables.
  [':constructor', '1:1 the unknown pseudo-class `:constructor`'],
  [':__proto__', '1:1 the unknown pseudo-class `:__proto__`'],
  [':toString()', '1:1 the unknown pseudo-class `:toString()`'],
  ['::hasOwnProperty', '1:1 the unknown pseudo-element `::hasOwnProperty`'],
  ['::__proto__(x)', '1:1 the unknown pseudo-element `::__proto__()`'],
];

test('parseSelector refuses what CSS refuses, with the first problem and its place', () => {
  for (const [text, problem] of REFUSED) assert.equal(parsed(text), problem, text);
});

/**
 * The kind of each refusal (css-oracle.test.ts holds them to Chromium): `invalid` when CSS refuses the selector and a
 * browser drops the rule, `unread` when the kit does not read it but a browser may keep it.
 */
const REFUSALS: readonly [string, Refusal][] = [
  ['.1', 'invalid'],
  ['#1', 'invalid'],
  ['a*', 'invalid'],
  ['> a', 'invalid'],
  [':not()', 'invalid'],
  [':has()', 'invalid'],
  [':has(:has(a))', 'invalid'],
  [':not(a:before)', 'invalid'],
  ['[a=1]', 'invalid'],
  ['[a=b c]', 'invalid'],
  [':nth-child(2n of > a)', 'invalid'],
  [':nth-of-type(2n of .a)', 'invalid'],
  ['a::before b', 'invalid'],
  [':dir("ltr")', 'invalid'],
  ['::picker(div)', 'invalid'],
  ['::view-transition-group(x.)', 'invalid'],
  ['::view-transition-group(.a b)', 'invalid'],
  // Chromium reads white space between a view transition name and its class; CSS does not.
  ['::view-transition-new(x .a)', 'unread'],
  // A name that the kit does not know: a browser may know it (`:host`, `::part()`).
  [':foo', 'unread'],
  [':host', 'unread'],
  ['::part(x)', 'unread'],
  // A namespace, `||`, and a simple selector after a pseudo-element: the kit reads none of them.
  ['ns|a', 'unread'],
  ['*|a', 'unread'],
  ['[*|a]', 'unread'],
  ['a || b', 'unread'],
  ['a::before:hover', 'unread'],
  // A browser forgives every problem in the argument of `:is()` and `:where()`, at any depth.
  [':is()', 'unread'],
  [':is(:foo)', 'unread'],
  [':where(a,)', 'unread'],
  [':is(> a)', 'unread'],
  [':is(::before)', 'unread'],
  [':is(:not(.1))', 'unread'],
  // Chromium keeps these, or CSS defines them and Chromium 153 does not have them yet.
  [':dir(foo)', 'unread'],
  [':lang("en")', 'unread'],
  [':lang(en, de)', 'unread'],
  ['[a=b s]', 'unread'],
  [':nth-child(2n of p::before)', 'unread'],
  [':nth-child(2n OF a)', 'unread'],
  // A list needs parseSelectorList.
  ['a, b', 'unread'],
];

test('each refusal has its kind: invalid when CSS refuses the selector, unread when CSS may keep it', () => {
  for (const [text, refusal] of REFUSALS) {
    const result = parseSelector(valuesOf(text));
    assert.equal(result.selector, undefined, text);
    assert.equal(result.refusal, refusal, text);
  }
  assert.equal(parseSelector(valuesOf('a')).refusal, undefined);
  assert.equal(parseSelectorList(valuesOf('a, .1, :foo')).refusal, 'invalid');
  assert.equal(parseSelectorList(valuesOf('a, :foo')).refusal, 'unread');
  assert.equal(parseSelectorList(valuesOf('a, b')).refusal, undefined);
});

test('parseSelector reads a relative selector only when asked', () => {
  assert.equal(parsed('> img', true), 'ok >img');
  assert.equal(parsed('+ .card', true), 'ok +.card');
  assert.equal(parsed('~ a b', true), 'ok ~a b');
  assert.equal(parsed('img', true), 'ok img');
  assert.equal(parsed('> img'), '1:1 the combinator `>` at the start of a selector');
  assert.equal(parsed('>', true), '1:1 the combinator `>` without a selector after it');
});

test('parseSelector gives the tree: types, ids, classes, attributes, pseudo-classes and pseudo-elements', () => {
  const selector = selectorOf('A#Main.Card[DATA-X="y" i]:HOVER:nth-child(odd of .b):before');
  const compound = selector?.compounds[0];
  assert.equal(compound?.type, 'a');
  assert.deepEqual(
    compound?.ids.map((id) => id.name),
    ['Main'],
  );
  assert.deepEqual(
    compound?.classes.map((item) => `${item.name}@${item.place.column}`),
    ['Card@7'],
  );
  assert.deepEqual(compound?.attributes, [
    { name: 'data-x', operator: '=', value: 'y', modifier: 'i', place: { offset: 11, line: 1, column: 12 } },
  ]);
  assert.deepEqual(
    compound?.pseudoClasses.map((pseudo) => [pseudo.name, pseudo.nth, pseudo.selectors?.length, pseudo.place.column]),
    [
      ['hover', undefined, undefined, 26],
      ['nth-child', { a: 2, b: 1 }, 1, 32],
    ],
  );
  assert.deepEqual(
    compound?.pseudoElements.map((element) => [element.name, element.legacy, element.place.column]),
    [['before', true, 53]],
  );
  const relative = selectorOf('> a + b ~ c d', true);
  assert.equal(relative?.leading, '>');
  assert.deepEqual(relative?.combinators, ['+', '~', ' ']);
  assert.deepEqual(
    relative?.compounds.map((item) => `${item.type}@${item.place.column}`),
    ['a@3', 'b@7', 'c@11', 'd@13'],
  );
});

test('parseSelectorList gives each selector or its problem', () => {
  const { selectors, problems } = parseSelectorList(valuesOf('a, :foo, .b > c, , d'));
  assert.deepEqual(selectors.map(normalizeSelector), ['a', '.b>c', 'd']);
  assert.deepEqual(
    problems.map(({ place, message }) => `${place.column} ${message}`),
    ['4 the unknown pseudo-class `:foo`', '1 an empty selector'],
  );
  assert.deepEqual(parseSelectorList(valuesOf('> a, + b'), { relative: true }).selectors.map(normalizeSelector), [
    '>a',
    '+b',
  ]);
});

// An+B (CSS Syntax Level 3, section 6.2), with every token shape of the tokenizer

const AN_PLUS_B: readonly [string, string][] = [
  ['odd', '2,1'],
  ['ODD', '2,1'],
  ['even', '2,0'],
  ['2n+1', '2,1'],
  ['2n + 1', '2,1'],
  ['2n+ 1', '2,1'],
  ['2n -1', '2,-1'],
  ['2n- 1', '2,-1'],
  ['2n-1', '2,-1'],
  ['2N+1', '2,1'],
  ['-2n', '-2,0'],
  ['+2n', '2,0'],
  ['+5n', '5,0'],
  ['0n+0', '0,0'],
  ['n', '1,0'],
  ['N', '1,0'],
  ['+n', '1,0'],
  ['+n+1', '1,1'],
  ['+n-1', '1,-1'],
  ['-n', '-1,0'],
  ['-n+3', '-1,3'],
  ['-N+3', '-1,3'],
  ['-n-1', '-1,-1'],
  ['-n- 1', '-1,-1'],
  ['n-1', '1,-1'],
  ['n- 1', '1,-1'],
  ['n -1', '1,-1'],
  ['n - 1', '1,-1'],
  ['n+ 1', '1,1'],
  ['5', '0,5'],
  ['+5', '0,5'],
  ['-5', '0,-5'],
  [' 2n+1 ', '2,1'],
  ['', 'invalid'],
  ['oddd', 'invalid'],
  ['odd 1', 'invalid'],
  ['+ n', 'invalid'],
  ['+ 2n', 'invalid'],
  ['- n+1', 'invalid'],
  ['- 2n', 'invalid'],
  ['+-2n', 'invalid'],
  ['+-n', 'invalid'],
  ['2 n', 'invalid'],
  ['n+-1', 'invalid'],
  ['2n+ -1', 'invalid'],
  ['n - -1', 'invalid'],
  ['n+ +1', 'invalid'],
  ['-n- +1', 'invalid'],
  ['--n', 'invalid'],
  ['1.5', 'invalid'],
  ['1.5n', 'invalid'],
  ['1e1n', 'invalid'],
  ['n-1a', 'invalid'],
  ['2n-1-1', 'invalid'],
  ['2n+1 2', 'invalid'],
  ['2n 1', 'invalid'],
  ['2n+1.5', 'invalid'],
  ['x', 'invalid'],
  ['2x', 'invalid'],
  ['constructor', 'invalid'],
];

test('parseAnPlusB reads every token shape of An+B', () => {
  for (const [text, expected] of AN_PLUS_B) assert.equal(anPlusB(text), expected, text);
});

// Specificity (7.11)

const SPECIFICITY: readonly [text: string, expected: string, root?: string][] = [
  ['h1', '0,0,1'],
  ['*', '0,0,0'],
  ['*.a', '0,1,0'],
  ['.a', '0,1,0'],
  ['.a:hover', '0,2,0'],
  ['#a', '1,0,0'],
  ['#a#b.c', '2,1,0'],
  ['[a=b]', '0,1,0'],
  ['a[a=b]', '0,1,1'],
  ['::before', '0,0,1'],
  [':before', '0,0,1'],
  ['a::before', '0,0,2'],
  ['ul li', '0,0,2'],
  ['ul > li + li', '0,0,3'],
  [':where(.a, #b)', '0,0,0'],
  ['a:where(.a)', '0,0,1'],
  [':is(.a, #b)', '1,0,0'],
  [':is(.a, h1)', '0,1,0'],
  [':not(.a .b)', '0,2,0'],
  [':not(a, .b)', '0,1,0'],
  [':has(> img)', '0,0,1'],
  [':has(> .a, #b)', '1,0,0'],
  [':nth-child(2n)', '0,1,0'],
  [':nth-child(2n of .a)', '0,2,0'],
  [':nth-child(2n of .a, #b)', '1,1,0'],
  [':nth-last-child(odd of a.b)', '0,2,1'],
  [':nth-of-type(2)', '0,1,0'],
  [':lang(de)', '0,1,0'],
  [':is(:is(.a, .b .c), d)', '0,2,0'],
  // A bare `&` in a rule that is not nested has no parent list, so it counts as nothing (CSS Nesting; Chromium).
  ['&', '0,0,0'],
  ['&.a', '0,1,0'],
  ['a:global(.b #c)', '0,0,1'],
  // The root class of a component file is not counted in the first compound only (7.11).
  ['.nav .nav__link[aria-current="page"]:hover', '0,4,0'],
  ['.nav .nav__link[aria-current="page"]:hover', '0,3,0', 'nav'],
  ['.nav .nav__link[aria-current=page]:hover', '0,3,0', 'nav'],
  ['.card.card--wide', '0,1,0', 'card'],
  ['.card.card', '0,1,0', 'card'],
  ['.card .card', '0,1,0', 'card'],
  ['.card--wide', '0,1,0', 'card'],
  ['.card:not(:last-child)', '0,1,0', 'card'],
  ['.card:first-child', '0,1,0', 'card'],
  [':is(.card .card__a, .card .card__b) .card__c:hover', '0,3,0', 'card'],
  [':is(.card .card__a, .card .card__b) .card__c:hover', '0,4,0'],
  [':not(.card) .card__c', '0,2,0', 'card'],
  // Hostile names are names like any other.
  ['.constructor', '0,0,0', 'constructor'],
  ['.__proto__', '0,1,0', 'constructor'],
];

test('specificity counts as Selectors Level 4 and 7.11 say', () => {
  for (const [text, expected, root] of SPECIFICITY) {
    assert.equal(specificityOf(text, root), expected, `${text} ${root ?? ''}`);
  }
});

test('specificity of a nested rule: the resolved selector, in source and built form', () => {
  const cases: readonly [string, string[]][] = [
    ['.card { &:hover { gap: 0 } }', ['0,1,0', '0,2,0']],
    ['.card{&:hover{gap:0}}', ['0,1,0', '0,2,0']],
    ['.card { .card__body { &:hover { gap: 0 } } }', ['0,1,0', '0,2,0', '0,3,0']],
    ['.card{& .card__body{&:hover{gap:0}}}', ['0,1,0', '0,2,0', '0,3,0']],
  ];
  for (const [css, expected] of cases) {
    const out: string[] = [];
    walk(parseCss(css, 'x.css'), (node) => {
      if (node.type !== 'rule') return;
      for (const values of node.resolved) {
        const selector = parseSelector(values).selector;
        out.push(selector === undefined ? 'problem' : specificity(selector).join(','));
      }
    });
    assert.deepEqual(out, expected, css);
  }
});

// Compounds (7.11)

const COMPOUNDS: readonly [string, number][] = [
  ['a', 1],
  ['.a .b .c .d', 4],
  ['.a .b .c .d .e', 5],
  ['a>b+c~d', 4],
  // A compound with `:is()` or `:where()` counts as its longest argument: the argument is the same element and what
  // stands before it. Nesting writes a parent in this way: `ul li a span { p & {} }` is `p :is(ul li a span)`.
  ['.a:is(.b .c .d .e)', 4],
  ['.a:where(.b .c, .d)', 2],
  ['p :is(ul li a span)', 5],
  ['.x :is(.a, .b .c) .y', 4],
  [':is(:where(.a .b) .c) .d', 4],
  ['.a:has(> b c d e)', 1],
  ['.a:not(.b .c .d .e) .f', 2],
  ['.a:nth-child(2n of .b .c .d .e)', 1],
  ['.a::before', 1],
];

test('compoundCount counts combinators + 1, and :is() and :where() as their longest argument', () => {
  for (const [text, count] of COMPOUNDS) {
    const selector = selectorOf(text);
    assert.equal(selector === undefined ? -1 : compoundCount(selector), count, text);
  }
  assert.deepEqual(SELECTOR_LIMITS, { classes: 3, compounds: 4 });
  assert.deepEqual(problemsOf('ul li a span { p & {} }', ELEMENTS), ['1:16 5 compounds, more than 4']);
  assert.deepEqual(problemsOf('ul li a{p &{}}', ELEMENTS), []);
});

// The shapes of 7.1, 7.9 and 7.11

/** CSS texts in a file, each with its problems as `<line>:<column> <message>` ([] for none). */
const SHAPES: readonly [css: string, file: CssFile, problems: string[]][] = [
  // elements.css (7.1)
  [
    'a {} a.button {} :root {} :focus-visible {} * {} input[type="radio"] {} p::first-line {} ::selection {} ul > li {}',
    ELEMENTS,
    [],
  ],
  [':is(h2, h3) {} a:not([href]) {} h2:not(:first-child) {} dd + dt {} dt ~ dd {} a:is(.button) {}', ELEMENTS, []],
  ['.card {}', ELEMENTS, ['1:1 the class `.card` of the component `card` in `elements.css`']],
  ['p .card__body {}', ELEMENTS, ['1:3 the class `.card__body` of the component `card` in `elements.css`']],
  ['.lede {}', ELEMENTS, ['1:1 the class `.lede` without a type selector: a variant attaches to a type']],
  ['*.lede {}', ELEMENTS, ['1:2 the class `.lede` without a type selector: a variant attaches to a type']],
  ['p.x.y {}', ELEMENTS, ['1:4 a second class `.y`: a type takes at most one variant class']],
  ['[hidden] {}', ELEMENTS, ['1:1 a compound without a type selector, `*` or a pseudo-class in `elements.css`']],
  [':not(.card) {}', ELEMENTS, ['1:6 the class `.card` of the component `card` in `elements.css`']],
  [':is(.x) {}', ELEMENTS, ['1:5 the class `.x` without a type selector: a variant attaches to a type']],
  ['#main {}', ELEMENTS, ['1:1 the id `#main`: the kit allows no id selector']],
  ['a:has(#x) {}', ELEMENTS, ['1:7 the id `#x`: the kit allows no id selector']],
  ['& a {}', ELEMENTS, ['1:1 a bare `&` outside a nested rule']],
  ['a:hover:focus:active:visited {}', ELEMENTS, ['1:1 the specificity (0,4,1) is above (0,3,x)']],
  ['a b c d e {}', ELEMENTS, ['1:9 5 compounds, more than 4']],
  // Component files (7.1, 7.8): the root, parts, modifiers, states, attributes and descendants.
  [
    '.card {} .card.card--wide {} .card:hover {} .card[open] {} .card::before {} .card > .card__body {} .card img {}',
    component('card'),
    [],
  ],
  [
    '.card .card__body p {} .card .card__title:hover {} .card .card__x::marker {} .card > * {} .card :hover {}',
    component('card'),
    [],
  ],
  ['.card a.card__link {} .card:is(.card--a, .card--b) {} .card:where(.card--a) .card__x {}', component('card'), []],
  [
    '.card-list .card-list__item {} .card-list--dense {}',
    component('card-list'),
    ['1:32 the selector does not start at the root class `.card-list`'],
  ],
  ['.card--wide {}', component('card'), ['1:1 the selector does not start at the root class `.card`']],
  ['div.card {}', component('card'), ['1:1 the type selector `div` in the root compound of `card`']],
  ['.card.card__x {}', component('card'), ['1:6 the part class `.card__x` in the root compound']],
  ['.card.card {}', component('card'), ['1:6 the root class `.card` twice in one compound']],
  ['.card .card {}', component('card'), ['1:7 the root class `.card` again after the root compound']],
  ['.card .card--wide {}', component('card'), ['1:7 the modifier `.card--wide` outside the root compound']],
  ['.card .card__a.card__b {}', component('card'), ['1:15 a second class `.card__b` in one compound']],
  [
    '.card .hero__title {}',
    component('card'),
    ['1:7 the class `.hero__title` belongs to the component `hero`, not to `card`'],
  ],
  ['.card.stack {}', component('card'), ['1:6 the class `.stack` belongs to no part of `card`']],
  [
    '#card {}',
    component('card'),
    ['1:1 the id `#card`: the kit allows no id selector', '1:1 the selector does not start at the root class `.card`'],
  ],
  ['.card .card__body ul li a {}', component('card'), ['1:25 5 compounds, more than 4']],
  ['.card .card__body .card__a .card__b:hover {}', component('card'), ['1:1 the specificity (0,4,0) is above (0,3,x)']],
  [
    '& .card__x {}',
    component('card'),
    ['1:1 a bare `&` outside a nested rule', '1:1 the selector does not start at the root class `.card`'],
  ],
  // Functional pseudo-classes: the arguments hold classes of the component and types only.
  ['.card:has(img) {} .card:not(.card--wide) {} .card:has(> .card__media) {}', component('card'), []],
  ['.card:has(.box) {}', component('card'), ['1:11 the class `.box` belongs to no part of `card`']],
  [
    '.card .card__a:is(.hero) {}',
    component('card'),
    ['1:19 the class `.hero` belongs to the component `hero`, not to `card`'],
  ],
  // A parent list that nesting writes as `:is()` holds the root when each selector of it starts at the root.
  [':is(.card .card__a, .card .card__b) .card__c {}', component('card'), []],
  [
    ':is(.card, .box) .card__c {}',
    component('card'),
    ['1:1 the selector does not start at the root class `.card`', '1:12 the class `.box` belongs to no part of `card`'],
  ],
  // Specificity without the root (7.11).
  [
    '.nav .nav__link[aria-current="page"]:hover:focus {}',
    component('nav'),
    ['1:1 the specificity (0,4,0) is above (0,3,x)'],
  ],
  // Page files (7.9)
  [
    '.hero {} .hero:first-child {} .hero > .card:nth-child(2) {} .hero .card:last-child {} .list:nth-child(odd) {}',
    PAGE,
    [],
  ],
  [
    '.hero:hover {}',
    PAGE,
    ['1:6 the pseudo-class `:hover` in a page file: only `:first-child`, `:last-child` and `:nth-child()`'],
  ],
  ['.hero:nth-child(2n of .card) {}', PAGE, ['1:6 `:nth-child()` with `of` in a page file']],
  ['.hero::before {}', PAGE, ['1:6 the pseudo-element `::before` in a page file']],
  ['div.hero {}', PAGE, ['1:1 the type selector `div` in a page file: it selects component roots']],
  [
    '.hero [data-x] {}',
    PAGE,
    [
      '1:7 the attribute selector `[data-x]` in a page file',
      '1:7 a compound without a component root class in a page file',
    ],
  ],
  ['.hero__title {}', PAGE, ['1:1 the class `.hero__title` is no component root']],
  ['.hero.card {}', PAGE, ['1:6 a second class `.card` in one compound']],
  [':first-child {}', PAGE, ['1:1 a compound without a component root class in a page file']],
  ['#hero {}', PAGE, ['1:1 the id `#hero`: the kit allows no id selector']],
];

test('selectorProblems gives the shape of each layer (7.1, 7.9, 7.11)', () => {
  for (const [css, file, expected] of SHAPES) assert.deepEqual(problemsOf(css, file), expected, css);
});

test('shapeProblems is the shape alone: ids, a bare `&`, the limits and `:global()` are left to other checks', () => {
  const cases: readonly [string, CssFile, string[]][] = [
    ['#hero', PAGE, []],
    ['.hero #x', PAGE, []],
    ['& .hero', PAGE, []],
    ['.hero:global(.x)', PAGE, []],
    ['.card:global(.x .y)', component('card'), []],
    ['.card .card__a .card__b .card__c .card__d', component('card'), []],
    ['a:global(.card)', ELEMENTS, []],
    ['a:hover:focus:active:visited', ELEMENTS, []],
    [
      '.hero:hover',
      PAGE,
      ['the pseudo-class `:hover` in a page file: only `:first-child`, `:last-child` and `:nth-child()`'],
    ],
    ['.hero::before', PAGE, ['the pseudo-element `::before` in a page file']],
  ];
  for (const [text, file, expected] of cases) {
    const selector = selectorOf(text);
    const found =
      selector === undefined ? ['problem'] : shapeProblems(selector, file, OPTIONS).map((item) => item.message);
    assert.deepEqual(found, expected, text);
  }
});

test('lead decision 1: every pseudo-class is a state of its compound, structural ones too', () => {
  const css = '.card:not(:last-child) {} .card:first-child {} .card .card__item:nth-child(2n + 1) {} .card:empty {}';
  assert.deepEqual(problemsOf(css, component('card')), []);
  assert.deepEqual(problemsOf('.text-section { &:not(:last-child) {} }', component('text-section')), []);
  assert.deepEqual(problemsOf('.text-section{&:not(:last-child){}}', component('text-section')), []);
  assert.equal(specificityOf('.card:not(:last-child):first-child:hover', 'card'), '0,3,0');
  assert.equal(specificityOf('.card:not(:last-child):first-child:hover:focus', 'card'), '0,4,0');
});

test('lead decision 2: a sibling combinator fails outside the argument of a pseudo-class', () => {
  const sibling = (combinator: string, file: string) =>
    `the sibling combinator \`${combinator}\` in ${file}; use it only inside a pseudo-class such as \`:has(${combinator} …)\``;
  const again = 'the root class `.card` again after the root compound';
  const cases: readonly [string, CssFile, string[]][] = [
    ['.card:has(+ .card) {}', component('card'), []],
    ['.card:has(~ .card) {}', component('card'), []],
    ['.card:has(+.card){}', component('card'), []],
    ['.card .card__a:not(.card__b + .card__a) {}', component('card'), []],
    ['.card + .card {}', component('card'), [`1:9 ${sibling('+', 'a component file')}`, `1:9 ${again}`]],
    ['.card+.card{}', component('card'), [`1:7 ${sibling('+', 'a component file')}`, `1:7 ${again}`]],
    ['.card ~ .card {}', component('card'), [`1:9 ${sibling('~', 'a component file')}`, `1:9 ${again}`]],
    ['.card + .card__a {}', component('card'), [`1:9 ${sibling('+', 'a component file')}`]],
    ['.card .card__a + .card__b {}', component('card'), [`1:18 ${sibling('+', 'a component file')}`]],
    ['.card .card__a ~ img {}', component('card'), [`1:18 ${sibling('~', 'a component file')}`]],
    ['.card { & + .card__a {} }', component('card'), [`1:13 ${sibling('+', 'a component file')}`]],
    ['.card { + .card__a {} }', component('card'), [`1:11 ${sibling('+', 'a component file')}`]],
    ['.card{&+.card__a{}}', component('card'), [`1:9 ${sibling('+', 'a component file')}`]],
    ['.hero + .card {}', PAGE, [`1:9 ${sibling('+', 'a page file')}`]],
    ['.hero ~ .card {}', PAGE, [`1:9 ${sibling('~', 'a page file')}`]],
    ['dd + dt {} dt ~ dd {}', ELEMENTS, []],
    ['dd+dt{}', ELEMENTS, []],
    // A `:is()` or `:where()` that holds the root stands for the selector: `:is(.card ~ div)` is `.card ~ div`.
    [':is(.card ~ div) {}', component('card'), [`1:13 ${sibling('~', 'a component file')}`]],
    [':where(.card + p) {}', component('card'), [`1:16 ${sibling('+', 'a component file')}`]],
    [':is(.card>.card__a~.card__b){}', component('card'), [`1:20 ${sibling('~', 'a component file')}`]],
    [':where(.card ~ div) .card__x {}', component('card'), [`1:16 ${sibling('~', 'a component file')}`]],
    // A leading combinator makes a nested selector relative, also with `&` (CSS Nesting): `+ &` is `& + &`.
    ['.card { + & {} }', component('card'), [`1:1 ${sibling('+', 'a component file')}`, `1:1 ${again}`]],
    ['.card{~&{}}', component('card'), [`1:1 ${sibling('~', 'a component file')}`, `1:1 ${again}`]],
  ];
  for (const [css, file, expected] of cases) assert.deepEqual(problemsOf(css, file), expected, css);
});

test('the arguments of :is() and :where() are part of the compound that holds them (7.1)', () => {
  const card = component('card');
  const type = (name: string) => `the type selector \`${name}\` in the root compound of \`card\``;
  const cases: readonly [string, CssFile, string[]][] = [
    // A type there is a type of the compound, as `.card:is(div)` and `div.card` are.
    ['.card:is(div, span) {}', card, [`1:10 ${type('div')}`, `1:15 ${type('span')}`]],
    ['.card:where(div) {}', card, [`1:13 ${type('div')}`]],
    ['.card:is(div) {}', card, [`1:1 ${type('div')}`]],
    ['.card:is(.card--a, :hover) {}', card, []],
    // The root class there is the root again, and a second part class is a second class.
    ['.card :where(.card) {}', card, ['1:14 the root class `.card` again after the root compound']],
    ['.card .card__a:is(.card__b, img) {}', card, ['1:19 a second class `.card__b` in one compound']],
    ['.card .card__a:where(img) {}', card, []],
    ['.card:is(.card__a) {}', card, ['1:10 the part class `.card__a` in the root compound']],
    // The compounds before the last of an argument stand before the element and take the free shape.
    ['.card .card__a:is(.card__b *) {}', card, []],
    ['.card .card__a:is(.box *) {}', card, ['1:19 the class `.box` belongs to no part of `card`']],
    // :not(), :has() and :nth-*() keep the free shape of an argument.
    ['.card:not(div) {}', card, []],
    ['.card:has(img, .card) {}', card, []],
    ['.card .card__a:nth-child(2n of div) {}', card, []],
  ];
  for (const [css, file, expected] of cases) assert.deepEqual(problemsOf(css, file), expected, css);
});

test('an attribute selector on `class` selects by its classes: whole names count as classes, parts fail (7.1)', () => {
  const card = component('card');
  const part = (operator: string) =>
    `the attribute selector \`[class${operator}…]\` selects classes by a part of their name; write the class`;
  const cases: readonly [string, CssFile, string[]][] = [
    ['.card .card__a [class~=box] {}', card, ['1:16 the class `.box` belongs to no part of `card`']],
    ['.card[class~=card__a] {}', card, ['1:6 the part class `.card__a` in the root compound']],
    ['.card .card__a[class="card__b"] {}', card, ['1:15 a second class `.card__b` in one compound']],
    ['[class~=card] .card__a {}', card, []],
    ['.card [class^=card] {}', card, [`1:7 ${part('^=')}`]],
    ['.card [class*=box] {}', card, [`1:7 ${part('*=')}`]],
    ['a[class~=card] {}', ELEMENTS, ['1:2 the class `.card` of the component `card` in `elements.css`']],
    ['a[CLASS="x card"] {}', ELEMENTS, ['1:2 the class `.card` of the component `card` in `elements.css`']],
    ['a:not([class]) {}', ELEMENTS, []],
    ['a[class|=card] {}', ELEMENTS, [`1:2 ${part('|=')}`]],
    ['a[class$=x] {}', ELEMENTS, [`1:2 ${part('$=')}`]],
    [
      '.hero [class~=card] {}',
      PAGE,
      [
        '1:7 the attribute selector `[class]` in a page file',
        '1:7 a compound without a component root class in a page file',
      ],
    ],
  ];
  for (const [css, file, expected] of cases) assert.deepEqual(problemsOf(css, file), expected, css);
});

// The drift matrix and the freedom matrix of 14.1

/** Drift rows 11 to 15 and 31: each gives its css-selector problems. */
const DRIFT: readonly [row: number, css: string, file: CssFile, problems: string[]][] = [
  [11, '#hero {}', ELEMENTS, ['the id `#hero`: the kit allows no id selector']],
  [11, '#hero{}', ELEMENTS, ['the id `#hero`: the kit allows no id selector']],
  [
    12,
    '.a .b .c .d .e {}',
    component('a'),
    [
      'the specificity (0,4,0) is above (0,3,x)',
      'the class `.b` belongs to no part of `a`',
      'the class `.c` belongs to no part of `a`',
      'the class `.d` belongs to no part of `a`',
      '5 compounds, more than 4',
      'the class `.e` belongs to no part of `a`',
    ],
  ],
  [12, '.a .a__b ul li span {}', component('a'), ['5 compounds, more than 4']],
  [12, '.a .a__b ul li span{}', component('a'), ['5 compounds, more than 4']],
  [13, '.card .button {}', component('card'), ['the class `.button` belongs to no part of `card`']],
  [13, '.card .button{}', component('card'), ['the class `.button` belongs to no part of `card`']],
  [13, '.card { .button {} }', component('card'), ['the class `.button` belongs to no part of `card`']],
  [13, '.card{& .button{}}', component('card'), ['the class `.button` belongs to no part of `card`']],
  [14, 'h2 {}', component('card'), ['the selector does not start at the root class `.card`']],
  [14, 'h2{}', component('card'), ['the selector does not start at the root class `.card`']],
  [15, '.card {}', ELEMENTS, ['the class `.card` of the component `card` in `elements.css`']],
  [15, '.card{}', ELEMENTS, ['the class `.card` of the component `card` in `elements.css`']],
  [
    31,
    '.box {}',
    component('card'),
    ['the selector does not start at the root class `.card`', 'the class `.box` belongs to no part of `card`'],
  ],
  [
    31,
    '.box{}',
    component('card'),
    ['the selector does not start at the root class `.card`', 'the class `.box` belongs to no part of `card`'],
  ],
];

test('drift rows 11 to 15 and 31 fail css-selector, in source and built form', () => {
  for (const [row, css, file, expected] of DRIFT) assert.deepEqual(messagesOf(css, file), expected, `${row}: ${css}`);
});

/**
 * Freedom rows 12 to 17 and 24, each in source form and in the built form that Lightning CSS writes with the
 * kit's targets. Each gives no problem.
 */
const FREEDOM: readonly [row: number, source: string, built: string, file: CssFile][] = [
  [
    12,
    '@layer components { @media (width >= 48rem) { .card { gap: var(--space-2); } } }',
    '@layer components{@media (width>=48rem){.card{gap:var(--space-2)}}}',
    component('card'),
  ],
  [
    13,
    '@layer components { @container (inline-size >= 30rem) { .card .card__body { gap: var(--space-2); } } }',
    '@layer components{@container (inline-size>=30rem){.card .card__body{gap:var(--space-2)}}}',
    component('card'),
  ],
  [
    14,
    '@layer components { .card { @starting-style { opacity: 0; } } }',
    '@layer components{.card{@starting-style{opacity:0}}}',
    component('card'),
  ],
  [
    15,
    '@layer components { .card { &:hover { color: var(--color-accent); } } }',
    '@layer components{.card{&:hover{color:var(--color-accent)}}}',
    component('card'),
  ],
  [
    16,
    '@layer components { .nav .nav__link[aria-current="page"]:hover { color: var(--color-accent); } }',
    '@layer components{.nav .nav__link[aria-current=page]:hover{color:var(--color-accent)}}',
    component('nav'),
  ],
  [
    17,
    '@layer components { .card:has(img) { gap: var(--space-2); } }',
    '@layer components{.card:has(img){gap:var(--space-2)}}',
    component('card'),
  ],
  [
    17,
    '@layer components { .list .list__item:nth-child(2n + 1) { gap: var(--space-2); } }',
    '@layer components{.list .list__item:nth-child(odd){gap:var(--space-2)}}',
    component('list'),
  ],
  [
    24,
    '@layer page { @media (width >= 48rem) { .hero { grid-column: span 2; } } }',
    '@layer page{@media (width>=48rem){.hero{grid-column:span 2}}}',
    PAGE,
  ],
];

test('freedom rows 12 to 17 and 24 pass css-selector, in source and built form', () => {
  for (const [row, source, built, file] of FREEDOM) {
    assert.deepEqual(problemsOf(source, file), [], `${row}: ${source}`);
    assert.deepEqual(problemsOf(built, file), [], `${row}: ${built}`);
    assert.deepEqual(normalizedOf(source), normalizedOf(built), `${row}: ${source}`);
  }
  assert.ok(PLACEMENT_PROPERTIES.has('grid-column'));
});

/** Source and built forms of whole component files: the built forms of the test site's rules among them. */
const SOURCE_AND_BUILT: readonly [source: string, built: string, file: CssFile][] = [
  [
    '.text-section { padding-block: 0; &:not(:last-child) { gap: 0; } :is(h2, h3):not(:first-child) { gap: 0; } }',
    '.text-section{padding-block:0;&:not(:last-child){gap:0}& :is(h2,h3):not(:first-child){gap:0}}',
    component('text-section'),
  ],
  [
    '.site-header { .site-header__language:hover { gap: 0 } .site-header__language[aria-current="page"] { gap: 0 } }',
    '.site-header{& .site-header__language:hover{gap:0}& .site-header__language[aria-current=page]{gap:0}}',
    component('site-header'),
  ],
  [
    '.mode-switch { .mode-switch__panel { gap: 0 } @media (width >= 48rem) { .mode-switch__panel { gap: 0 } } }',
    '.mode-switch{& .mode-switch__panel{gap:0}@media (width>=48rem){& .mode-switch__panel{gap:0}}}',
    component('mode-switch'),
  ],
  [
    '.card { > .card__body { gap: 0 } .card__title { gap: 0 } .card__x::before { gap: 0 } * > img { gap: 0 } }',
    '.card{&>.card__body,& .card__title{gap:0}& .card__x:before{gap:0}& *>img{gap:0}}',
    component('card'),
  ],
  [
    '@keyframes card-in { from { opacity: 0 } to { opacity: 1 } } .card { animation-name: card-in }',
    '@keyframes card-in{0%{opacity:0}to{opacity:1}}.card{animation-name:card-in}',
    component('card'),
  ],
  ['.feature-card:first-child { order: 0 }', '.feature-card:first-child{order:0}', PAGE],
  [
    'input[type="radio"] { gap: 0 } dd + dt { gap: 0 } a.button:hover { gap: 0 }',
    'input[type=radio]{gap:0}dd+dt{gap:0}a.button:hover{gap:0}',
    ELEMENTS,
  ],
];

test('source and built form of one file give the same problems and the same normalized selectors', () => {
  const options: ShapeOptions = {
    components: new Set([...OPTIONS.components, 'text-section', 'site-header', 'mode-switch', 'feature-card']),
  };
  for (const [source, built, file] of SOURCE_AND_BUILT) {
    assert.deepEqual(problemsOf(source, file, options), [], source);
    assert.deepEqual(problemsOf(built, file, options), [], built);
    assert.deepEqual(normalizedOf(source), normalizedOf(built), source);
  }
});

// At-rules (7.1, 7.9)

const AT_RULES: readonly [css: string, file: CssFile, problems: string[]][] = [
  [
    '@media (width >= 48rem) {} @container (width > 30rem) {} @supports (display: grid) {} @starting-style {} @keyframes fade {} @keyframes "x y" {}',
    ELEMENTS,
    [],
  ],
  [
    '.card { @media (width >= 48rem) {} @starting-style { opacity: 0 } } @keyframes card-in {} @keyframes card-fade-out {}',
    component('card'),
    [],
  ],
  ['@media (width >= 48rem) {} @container (width > 30rem) {} @supports (display: grid) {}', PAGE, []],
  // Other rules report these.
  ['@layer page { } @layer a, b; @import "x.css"; @scope (.card) {}', PAGE, []],
  ['@font-face { font-family: x }', ELEMENTS, ['1:1 the at-rule `@font-face` in `elements.css`']],
  ['@property --x { syntax: "*" }', component('card'), ['1:1 the at-rule `@property` in a component file']],
  ['@view-transition { navigation: auto }', ELEMENTS, ['1:1 the at-rule `@view-transition` in `elements.css`']],
  ['@page { margin: 0 }', ELEMENTS, ['1:1 the at-rule `@page` in `elements.css`']],
  ['@-webkit-keyframes fade {}', ELEMENTS, ['1:1 the at-rule `@-webkit-keyframes` in `elements.css`']],
  ['@starting-style {}', PAGE, ['1:1 the at-rule `@starting-style` in a page file']],
  ['@keyframes fade {}', PAGE, ['1:1 the at-rule `@keyframes` in a page file']],
  ['@media x;', ELEMENTS, ['1:1 `@media` without a block']],
  ['@starting-style x {}', ELEMENTS, ['1:1 `@starting-style` with a prelude, which CSS refuses']],
  ['@keyframes fade {}', component('card'), ['1:1 the keyframes `fade` are not named `card-<name>`']],
  ['@keyframes card {}', component('card'), ['1:1 the keyframes `card` are not named `card-<name>`']],
  ['@keyframes card- {}', component('card'), ['1:1 the keyframes `card-` are not named `card-<name>`']],
  ['@keyframes card-In {}', component('card'), ['1:1 the keyframes `card-In` are not named `card-<name>`']],
  ['@keyframes "card-in" {}', component('card'), ['1:1 the keyframes `"card-in"` are not named `card-<name>`']],
  ['@keyframes none {}', ELEMENTS, ['1:1 `@keyframes none` has no valid name']],
  ['@keyframes a b {}', ELEMENTS, ['1:1 `@keyframes a b` has no valid name']],
  ['@keyframes {}', ELEMENTS, ['1:1 `@keyframes ` has no valid name']],
  [
    '@constructor {} @__proto__ {}',
    ELEMENTS,
    ['1:1 the at-rule `@constructor` in `elements.css`', '1:17 the at-rule `@__proto__` in `elements.css`'],
  ],
];

test('atRuleProblem gives the at-rule shape of each layer (7.1, 7.9)', () => {
  for (const [css, file, expected] of AT_RULES) assert.deepEqual(problemsOf(css, file), expected, css);
});

// Components (7.8)

const ROLES: readonly [name: string, component: string, role: string][] = [
  ['card', 'card', 'root'],
  ['card__body', 'card', 'part'],
  ['card__media-wide', 'card', 'part'],
  ['card__x1', 'card', 'part'],
  ['card--wide', 'card', 'modifier'],
  ['card--2-up', 'card', 'modifier'],
  ['card__', 'card', '-'],
  ['card--', 'card', '-'],
  ['card__Body', 'card', '-'],
  ['card__body--wide', 'card', '-'],
  ['card__-body', 'card', '-'],
  ['card__body-', 'card', '-'],
  ['card___body', 'card', '-'],
  ['card-list', 'card', '-'],
  ['card-list__item', 'card', '-'],
  ['card-list__item', 'card-list', 'part'],
  ['Card', 'card', '-'],
  ['button', 'card', '-'],
  ['card', '', '-'],
  ['constructor', 'constructor', 'root'],
  ['constructor__x', 'constructor', 'part'],
  ['__proto__', 'card', '-'],
  ['toString', 'card', '-'],
];

test('classRole names the root, a part and a modifier of a component (7.8)', () => {
  for (const [name, owner, role] of ROLES) assert.equal(classRole(name, owner) ?? '-', role, `${name} ${owner}`);
});

test('ownerOf takes the longest component name; keyframesOwner reads `<kebab>-<name>`', () => {
  const components = new Set(['card', 'card-list', 'nav']);
  const owners: readonly [string, string][] = [
    ['card', 'card'],
    ['card__body', 'card'],
    ['card-list', 'card-list'],
    ['card-list__item', 'card-list'],
    ['card-list--dense', 'card-list'],
    ['nav__link', 'nav'],
    ['navigation', '-'],
    ['button', '-'],
    ['constructor', '-'],
    ['__proto__', '-'],
    ['hasOwnProperty', '-'],
  ];
  for (const [name, owner] of owners) assert.equal(ownerOf(name, components) ?? '-', owner, name);
  const keyframes: readonly [string, string][] = [
    ['card-in', 'card'],
    ['card-list-in', 'card-list'],
    ['card-fade-out', 'card'],
    ['card-', '-'],
    ['card', '-'],
    ['nav-In', '-'],
    ['hero-rise', '-'],
    ['constructor-x', '-'],
  ];
  for (const [name, owner] of keyframes) assert.equal(keyframesOwner(name, components) ?? '-', owner, name);
});

test('localOwner gives the component of a local `--<kebab>-<name>` (7.8)', () => {
  const components = new Set(['card', 'card-list', 'nav']);
  const owners: readonly [string, string][] = [
    ['--card-pad', 'card'],
    ['--card-list-gap', 'card-list'],
    ['--card-list', 'card'],
    ['--nav-link-color', 'nav'],
    ['--card', '-'],
    ['--card-', '-'],
    ['--card-Pad', '-'],
    ['card-pad', '-'],
    ['--space-2', '-'],
    ['--constructor-x', '-'],
    ['--__proto__-x', '-'],
  ];
  for (const [name, owner] of owners) assert.equal(localOwner(name, components) ?? '-', owner, name);
});

// Facts for other rules

test('isRootSelector is one compound that holds the root class (locals, 7.8)', () => {
  const cases: readonly [string, boolean][] = [
    ['.card', true],
    ['.card:hover', true],
    ['.card.card--wide', true],
    [':is(.card)', true],
    ['.card .card__body', false],
    ['.card--wide', false],
    ['.card > *', false],
    ['.box', false],
  ];
  for (const [text, expected] of cases) {
    const selector = selectorOf(text);
    assert.equal(selector !== undefined && isRootSelector(selector, 'card'), expected, text);
  }
  const relative = selectorOf('> .card', true);
  assert.equal(relative !== undefined && isRootSelector(relative, 'card'), false);
});

test('subject puts a `:is()` of one compound into the compound it returns: its type and its classes', () => {
  const cases: readonly [string, string | undefined, string[]][] = [
    [':is(table)', 'table', []],
    ['a:is(.button)', 'a', ['button']],
    ['.x > :is(.a.b)', undefined, ['a', 'b']],
    ['main :is(body)', 'body', []],
    [':is(table, ul)', undefined, []],
  ];
  for (const [text, type, classes] of cases) {
    const selector = selectorOf(text);
    const last = selector === undefined ? undefined : subject(selector);
    assert.equal(last?.type, type, text);
    assert.deepEqual(
      last?.classes.map((item) => item.name),
      classes,
      text,
    );
  }
});

test('subject is the last compound, with a `:is()` of one compound put into it', () => {
  const cases: readonly [string, string][] = [
    ['html', 'html'],
    [':root', ':root'],
    ['body > main', 'main'],
    ['input[type="checkbox"]', 'input[type="checkbox"]'],
    ['a:is(.button)', 'a.button'],
    ['.card :before', '::before'],
  ];
  for (const [text, expected] of cases) {
    const selector = selectorOf(text);
    const last = selector === undefined ? undefined : subject(selector);
    const shown =
      last === undefined
        ? '-'
        : normalizeSelector({ leading: undefined, compounds: [last], combinators: [], place: last.place });
    assert.equal(shown, expected, text);
  }
});

test('attributesOf finds every attribute selector, in pseudo-class arguments too (modes-media)', () => {
  const cases: readonly [string, string[]][] = [
    ['.card', []],
    ['[data-mode="dark"] .card', ['data-mode=dark']],
    [':root[data-mode=dark] .card', ['data-mode=dark']],
    ['.card:is([data-x], :not([DATA-MODE]))', ['data-x', 'data-mode']],
    ['.card:has(> [data-mode~=a i])', ['data-mode~=a']],
    [':nth-child(2n of [data-mode]) [data-y="z"]', ['data-mode', 'data-y=z']],
  ];
  for (const [text, expected] of cases) {
    const selector = selectorOf(text);
    const found = selector === undefined ? ['problem'] : attributesOf(selector);
    assert.deepEqual(
      found.map((item) => (typeof item === 'string' ? item : `${item.name}${item.operator ?? ''}${item.value ?? ''}`)),
      expected,
      text,
    );
  }
});

/** Source and built forms of one selector (the table of the contracts, measured with Lightning CSS). */
const NORMALIZED_PAIRS: readonly [source: string, built: string, normalized: string][] = [
  ['.card::before', '.card:before', '.card::before'],
  ['.card::after', '.card:after', '.card::after'],
  ['.a::first-letter', '.a:first-letter', '.a::first-letter'],
  ['.a::first-line', '.a:first-line', '.a::first-line'],
  ['.a::marker', '.a::marker', '.a::marker'],
  ['.card *::before', '.card :before', '.card ::before'],
  ['.card *:hover', '.card :hover', '.card :hover'],
  ['[aria-current="page"]', '[aria-current=page]', '[aria-current="page"]'],
  ['[tabindex="-1"]', '[tabindex="-1"]', '[tabindex="-1"]'],
  ['.card [data-x="y" i]', '.card [data-x=y i]', '.card [data-x="y" i]'],
  [".card [data-x='a b']", '.card [data-x=a\\ b]', '.card [data-x="a b"]'],
  ['.a [x="a\\"b"]', '.a [x=a\\"b]', '.a [x="a\\"b"]'],
  ['.a [A=b]', '.a [A="b"]', '.a [a="b"]'],
  ['A:HOVER', 'A:hover', 'a:hover'],
  [':nth-child(2n + 1)', ':nth-child(odd)', ':nth-child(2n+1)'],
  [':nth-child(2n+1 of .b)', ':nth-child(odd of .b)', ':nth-child(2n+1 of .b)'],
  ['.card:nth-child(EVEN of .card--wide)', '.card:nth-child(2n of .card--wide)', '.card:nth-child(2n of .card--wide)'],
  ['.card:nth-child(0n+1)', '.card:first-child', '.card:first-child'],
  ['.a:nth-last-child(1)', '.a:last-child', '.a:last-child'],
  ['.a:nth-of-type(1)', '.a:first-of-type', '.a:first-of-type'],
  ['.card:nth-child(+5)', '.card:nth-child(5)', '.card:nth-child(5)'],
  ['.card:nth-child(1n+0)', '.card:nth-child(n)', '.card:nth-child(n)'],
  ['.a:nth-child(+n+1)', '.a:nth-child(n+1)', '.a:nth-child(n+1)'],
  ['.a:is(.b)', '.a.b', '.a.b'],
  ['*.card', '.card', '.card'],
  ['.card > *', '.card>*', '.card>*'],
  ['.card:has(> img)', '.card:has(>img)', '.card:has(>img)'],
  ['.card:has(+ .card)', '.card:has(+.card)', '.card:has(+.card)'],
  ['.card:is(.card--a, .card--b)', '.card:is(.card--a,.card--b)', '.card:is(.card--a,.card--b)'],
  [':is(h2, h3):not(:first-child)', ':is(h2,h3):not(:first-child)', ':is(h2,h3):not(:first-child)'],
  ['.a:NOT(.b)', '.a:not(.b)', '.a:not(.b)'],
  ['.a::view-transition-group( x )', '.a::view-transition-group(x)', '.a::view-transition-group(x)'],
  ['dd + dt', 'dd+dt', 'dd+dt'],
  ['.a  .b', '.a .b', '.a .b'],
  ['.a\\:b', '.a\\:b', '.a\\:b'],
];

test('normalizeSelector gives one text for the source form and the built form (design-specs)', () => {
  for (const [source, built, normalized] of NORMALIZED_PAIRS) {
    assert.equal(parsed(source), `ok ${normalized}`, source);
    assert.equal(parsed(built), `ok ${normalized}`, built);
  }
});

test('normalizeSelector on nested rules: source nesting and the built `&` forms agree', () => {
  const pairs: readonly [source: string, built: string, normalized: string[]][] = [
    ['.card { > .card__body {} }', '.card{&>.card__body{}}', ['.card', '.card>.card__body']],
    ['.card { .card__body {} }', '.card{& .card__body{}}', ['.card', '.card .card__body']],
    ['.card { &:hover {} }', '.card{&:hover{}}', ['.card', '.card:hover']],
    ['.card { .card__body & {} }', '.card{.card__body &{}}', ['.card', '.card__body .card']],
    ['.a, .b { .c {} }', '.a,.b{& .c{}}', ['.a', '.b', '.a .c', '.b .c']],
    ['.a .b { .c & {} }', '.a .b{.c &{}}', ['.a .b', '.c :is(.a .b)']],
  ];
  for (const [source, built, expected] of pairs) {
    assert.deepEqual(normalizedOf(source), expected, source);
    assert.deepEqual(normalizedOf(built), expected, built);
  }
});

// Hostile input

test('hostile selectors give a result and no throw, in bounded time', () => {
  const started = performance.now();
  const deep = `${':is('.repeat(200)}a${')'.repeat(200)}`;
  assert.equal(typeof parsed(deep), 'string');
  const deepHas = `${':not('.repeat(30)}:has(a)${')'.repeat(30)}`;
  assert.equal(parsed(deepHas), `ok ${':not('.repeat(30)}:has(a)${')'.repeat(30)}`);
  const nested = `${'.a{'.repeat(40)}${'&:hover .b{'.repeat(40)}${'}'.repeat(80)}`;
  const sheet = parseCss(nested, 'x.css');
  let count = 0;
  walk(sheet, (node) => {
    if (node.type !== 'rule') return;
    for (const values of node.resolved) {
      const { selector } = parseSelector(values);
      if (selector !== undefined) count += selectorProblems(selector, component('a'), OPTIONS).length;
    }
  });
  assert.ok(count >= 0);
  const wide = Array.from({ length: 2000 }, (_, index) => `.a${index}`).join(', ');
  assert.equal(parseSelectorList(valuesOf(wide)).selectors.length, 2000);
  const long = `.${'a'.repeat(100_000)} ${'b'.repeat(100_000)}[x="${'\\'.repeat(1000)}"]`;
  assert.equal(parsed(long).slice(0, 2), 'ok');
  const many = Array.from({ length: 5000 }, () => ':hover').join('');
  assert.equal(specificityOf(`a${many}`), '0,5000,1');
  const names = ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf'];
  for (const name of names) {
    assert.equal(parsed(`.${name}`), `ok .${name}`, name);
    assert.equal(parsed(`${name}`), `ok ${asciiLower(name)}`, name);
    assert.deepEqual(problemsOf(`.${name} {}`, component(name), { components: new Set([name]) }), [], name);
  }
  assert.ok(performance.now() - started < 5000);
});

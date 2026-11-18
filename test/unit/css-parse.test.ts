/**
 * The CSS parser (specification, 3.2 and 7.1): the tokenizer of CSS Syntax Level 3, the tree with its places, the
 * nesting of 7.1, `walk`, `classesOf` and the layer tree. Each table runs the source forms and the built forms of
 * Lightning CSS (13.1 items 3, 4 and 40).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ANONYMOUS_LAYER,
  asciiLower,
  type ComponentValue,
  classesOf,
  type Declaration,
  isDelim,
  isFunction,
  isIdent,
  layerOrder,
  layerTree,
  MAX_DEPTH,
  MAX_PROBLEMS,
  MAX_RESOLVED_SIZE,
  MAX_RESOLVED_TOTAL,
  parseCss,
  parseValue,
  type Rule,
  serialize,
  splitCommas,
  trimWhitespace,
  walk,
} from '../../src/css/parse.ts';

// Helpers. None asserts.

const CLOSE: ReadonlyMap<string, string> = new Map([
  ['(', ')'],
  ['[', ']'],
  ['{', '}'],
]);

/** A short text for each component value: its type and what it holds. */
function shapes(values: readonly ComponentValue[]): string[] {
  return values.map((value) => {
    switch (value.type) {
      case 'ident':
        return `ident(${value.value})`;
      case 'at-keyword':
        return `at(${value.value})`;
      case 'hash':
        return `hash(${value.value}${value.id ? ',id' : ''})`;
      case 'string':
        return `string(${value.value})`;
      case 'url':
        return `url(${value.value})`;
      case 'number':
        return `number(${value.value}${value.integer ? ',int' : ''}${value.sign})`;
      case 'percentage':
        return `percentage(${value.value}${value.integer ? ',int' : ''}${value.sign})`;
      case 'dimension':
        return `dimension(${value.value},${value.unit}${value.integer ? ',int' : ''}${value.sign})`;
      case 'delim':
        return `delim(${value.value})`;
      case 'function':
        return `${value.name}(${shapes(value.args).join(' ')})`;
      case 'block':
        return `${value.open}${shapes(value.values).join(' ')}${CLOSE.get(value.open) ?? ''}`;
      default:
        return value.type;
    }
  });
}

/** The problems of a text as `<line>:<column> <message>`. */
const problemsOf = (css: string): string[] =>
  parseCss(css, 'x.css').problems.map(({ place, message }) => `${place.line}:${place.column} ${message}`);

/** The problems of a value text as `<line>:<column> <message>`. */
const valueProblems = (text: string): string[] =>
  parseValue(text).problems.map(({ place, message }) => `${place.line}:${place.column} ${message}`);

/** Every style rule of a text: its prelude and its resolved selectors, as text. */
function resolvedOf(css: string): [string, string[]][] {
  const out: [string, string[]][] = [];
  walk(parseCss(css, 'x.css'), (node) => {
    if (node.type === 'rule') out.push([serialize(node.prelude), node.resolved.map(serialize)]);
  });
  return out;
}

/** Every declaration of a text, with what encloses it. */
function declarationsOf(css: string): string[] {
  const out: string[] = [];
  walk(parseCss(css, 'x.css'), (node, context) => {
    if (node.type !== 'declaration') return;
    const rule = context.rule === undefined ? '-' : `${context.rule.kind}:${context.rule.resolved.map(serialize)}`;
    const at = context.atRules.map((atRule) => `@${atRule.name}`).join('/') || '-';
    const important = node.important ? ' !important' : '';
    out.push(`${context.layer ?? '-'} | ${at} | ${rule} | ${node.property}: ${serialize(node.value)}${important}`);
  });
  return out;
}

/** The nodes of a text in walk order, with their places. */
function placesOf(css: string): string[] {
  const out: string[] = [];
  walk(parseCss(css, 'x.css'), (node) => {
    const what =
      node.type === 'declaration' ? node.property : node.type === 'rule' ? serialize(node.prelude) : node.name;
    out.push(`${node.type} ${what} ${node.place.line}:${node.place.column}`);
  });
  return out;
}

/** The first declaration of a text. */
function firstDeclaration(css: string): Declaration | undefined {
  let found: Declaration | undefined;
  walk(parseCss(css, 'x.css'), (node) => {
    if (found === undefined && node.type === 'declaration') found = node;
  });
  return found;
}

// The tokenizer

/** Value texts and their component values (CSS Syntax Level 3, section 4). */
const TOKENS: readonly [string, string[]][] = [
  // Names take every name character, as the specification says for a hash and a unit (7.4).
  ['#000-1px', ['hash(000-1px)']],
  ['#000 -1px', ['hash(000)', 'whitespace', 'dimension(-1,px,int-)']],
  ['1px_', ['dimension(1,px_,int)']],
  ['1px-inset', ['dimension(1,px-inset,int)']],
  ['0-0', ['number(0,int)', 'number(0,int-)']],
  ['1--x', ['dimension(1,--x,int)']],
  ['1-', ['number(1,int)', 'delim(-)']],
  ['#fff', ['hash(fff,id)']],
  ['#0f0', ['hash(0f0)']],
  ['#-a', ['hash(-a,id)']],
  ['#', ['delim(#)']],
  // Numbers, as the minifier writes them too.
  ['.5', ['number(0.5)']],
  ['+.5e-3', ['number(0.0005+)']],
  ['-0.5rem', ['dimension(-0.5,rem-)']],
  ['1e3px', ['dimension(1000,px)']],
  ['1em', ['dimension(1,em,int)']],
  ['1e+', ['dimension(1,e,int)', 'delim(+)']],
  ['1PX', ['dimension(1,px,int)']],
  ['1Kpx', ['dimension(1,Kpx,int)']],
  ['50%', ['percentage(50,int)']],
  ['1/-1', ['number(1,int)', 'delim(/)', 'number(-1,int-)']],
  ['2n+1', ['dimension(2,n,int)', 'number(1,int+)']],
  ['-n+3', ['ident(-n)', 'number(3,int+)']],
  ['- 1', ['delim(-)', 'whitespace', 'number(1,int)']],
  // Only space, tab, line feed, carriage return and form feed separate.
  [
    'a\tb\nc\rd\fe f',
    [
      'ident(a)',
      'whitespace',
      'ident(b)',
      'whitespace',
      'ident(c)',
      'whitespace',
      'ident(d)',
      'whitespace',
      'ident(e)',
      'whitespace',
      'ident(f)',
    ],
  ],
  ['a b', ['ident(a b)']],
  ['a b', ['ident(a b)']],
  ['1px solid', ['dimension(1,px solid,int)']],
  // Escapes.
  ['a\\:b', ['ident(a:b)']],
  ['\\31 0', ['ident(10)']],
  ['\\0', ['ident(�)']],
  ['\\110000', ['ident(�)']],
  ['v\\61r(--a)', ['var(ident(--a))']],
  ['--menu', ['ident(--menu)']],
  ['-x', ['ident(-x)']],
  ['--', ['ident(--)']],
  // Strings and URLs. A quoted url() is a function with a string.
  ['"a\\"b"', ['string(a"b)']],
  ["'a\\\nb'", ['string(ab)']],
  ['"\\3c /style>"', ['string(</style>)']],
  ['url(x.png)', ['url(x.png)']],
  ['URL( x.png )', ['url(x.png)']],
  ['u\\72l(x)', ['url(x)']],
  ['url( "x.png" )', ['url(whitespace string(x.png) whitespace)']],
  // Functions, blocks and the minified forms.
  ['scale(1.05)rotate(.5turn)', ['scale(number(1.05))', 'rotate(dimension(0.5,turn))']],
  ['calc(var(--space-2)*1.5)', ['calc(var(ident(--space-2)) delim(*) number(1.5))']],
  ['(width>=48rem)', ['(ident(width) delim(>) delim(=) dimension(48,rem,int))']],
  ['[aria-current=page]', ['[ident(aria-current) delim(=) ident(page)]']],
  ['{a:b}', ['{ident(a) colon ident(b)}']],
  // Delimiters and the other tokens. A comment goes, and a run of white space is one token.
  ['red!important', ['ident(red)', 'delim(!)', 'ident(important)']],
  ['a/**/b', ['ident(a)', 'ident(b)']],
  ['a /* x */ b', ['ident(a)', 'whitespace', 'ident(b)']],
  ['@media', ['at(media)']],
  ['@', ['delim(@)']],
  ['<!-- -->', ['cdo', 'whitespace', 'cdc']],
  ['a,b;c:d', ['ident(a)', 'comma', 'ident(b)', 'semicolon', 'ident(c)', 'colon', 'ident(d)']],
  ['&>.b', ['delim(&)', 'delim(>)', 'delim(.)', 'ident(b)']],
  ['\u{1F600}', ['ident(\u{1F600})']],
  ['', []],
];

test('the tokenizer cuts a value as CSS Syntax Level 3 does, in source and in minified forms', () => {
  for (const [text, expected] of TOKENS) {
    const { values, problems } = parseValue(text);
    assert.deepEqual(shapes(values), expected, JSON.stringify(text));
    assert.deepEqual(problems, [], JSON.stringify(text));
  }
});

test('each token keeps its text as written and its place', () => {
  const { values } = parseValue('a\\:b  1.50PX\n"x"');
  assert.deepEqual(
    values.map((value) => [value.type, 'text' in value ? value.text : '', value.place.line, value.place.column]),
    [
      ['ident', 'a\\:b', 1, 1],
      ['whitespace', '  ', 1, 5],
      ['dimension', '1.50PX', 1, 7],
      ['whitespace', '\n', 1, 13],
      ['string', '"x"', 2, 1],
    ],
  );
});

/** Value texts that are not CSS, each with its problems. */
const VALUE_PROBLEMS: readonly [string, string[]][] = [
  ['"abc', ['1:1 a string without its closing quote']],
  ['"a\nb"', ['1:1 a string that a newline ends', '2:2 a string without its closing quote']],
  ['url(a b)', ['1:1 white space inside an unquoted `url()`']],
  ['url(a"b)', ['1:6 a quote, a bracket or a control character inside an unquoted `url()`']],
  ['url(a', ['1:1 `url(` without its `)`']],
  ['/* x', ['1:1 a comment without its `*/`']],
  ['(a', ['1:1 `(` without its `)`']],
  ['a)', ['1:2 `)` without its opening bracket']],
  ['calc(1px', ['1:1 `calc(` without its `)`']],
  ['[a)', ['1:3 `)` without its opening bracket', '1:1 `[` without its `]`'].sort()],
  ['a\u0001b', ['1:2 the control character U+0001']],
  ['a\u0000b', ['1:2 the control character U+0000']],
  ['a\u007Fb', ['1:2 the control character U+007f']],
  ['a\uD800b', ['1:2 a lone surrogate']],
  ['a\uDC00', ['1:2 a lone surrogate']],
  ['a\\\nb', ['1:2 a backslash before a newline']],
  ['a\\', ['1:2 a backslash at the end of the text']],
  [`${'('.repeat(MAX_DEPTH + 1)}${')'.repeat(MAX_DEPTH + 1)}`, [`1:${MAX_DEPTH + 1} nesting deeper than 32 levels`]],
];

test('a value text that is not CSS gives problems with places, and no throw', () => {
  for (const [text, expected] of VALUE_PROBLEMS) {
    assert.deepEqual(valueProblems(text).sort(), [...expected].sort(), JSON.stringify(text));
  }
});

test('U+0000 is a problem, and it reads as U+FFFD, a character of a name (CSS Syntax Level 3, 3.3; Chromium)', () => {
  assert.deepEqual(shapes(parseValue('a\u0000b').values), ['ident(a�b)']);
  assert.deepEqual(valueProblems('a\u0000b'), ['1:2 the control character U+0000']);
  assert.deepEqual(declarationsOf('.a { --a\u0000b: 1; color: red }'), [
    '- | - | style:.a | --a�b: 1',
    '- | - | style:.a | color: red',
  ]);
});

test('the problems of one text stop at MAX_PROBLEMS', () => {
  assert.equal(MAX_PROBLEMS, 100);
  assert.equal(parseValue('\u0001'.repeat(1000)).problems.length, MAX_PROBLEMS);
  assert.equal(parseCss('a)'.repeat(1000), 'x.css').problems.length, MAX_PROBLEMS);
});

test('the problems kept are the first ones in the text, whatever order the parser finds them in', () => {
  // The control characters are found before the structure, but the open block at 1:3 comes first in the text.
  const late = parseCss(`.a{color:red\n.b{}${'\u0001'.repeat(100)}`, 'x.css').problems;
  assert.equal(late.length, MAX_PROBLEMS);
  assert.deepEqual(late[0], { message: '`{` without its `}`', place: { offset: 2, line: 1, column: 3 } });
  assert.deepEqual(
    late.map(({ place }) => place.offset),
    late.map(({ place }) => place.offset).toSorted((a, b) => a - b),
  );
  const early = parseCss(`${'\u0001'.repeat(100)}.a{`, 'x.css').problems;
  assert.equal(early.length, MAX_PROBLEMS);
  assert.ok(early.every(({ message }) => message === 'the control character U+0001'));
});

test('a byte order mark at the start is no text: the tree, the layers and the places match the file', () => {
  const plain = '@layer components {\n  .card { color: var(--color-text); }\n}\n.a{color:red}\n';
  const windows = `\uFEFF${plain.replaceAll('\n', '\r\n')}`;
  const sheet = parseCss(windows, 'card.css');
  assert.deepEqual(sheet.problems, []);
  assert.deepEqual(
    layerTree(sheet).map(({ kind, names }) => `${kind} ${names.join(',')}`),
    ['block components'],
  );
  assert.deepEqual(declarationsOf(windows), declarationsOf(plain));
  assert.deepEqual(declarationsOf(windows), [
    'components | @layer | style:.card | color: var(--color-text)',
    '- | - | style:.a | color: red',
  ]);
  assert.deepEqual(placesOf(windows), [
    'at-rule layer 1:2',
    'rule .card 2:3',
    'declaration color 2:11',
    'rule .a 4:1',
    'declaration color 4:4',
  ]);
  assert.deepEqual(resolvedOf('\uFEFF.a{color:red}'), [['.a', ['.a']]]);
  // Only at the start: elsewhere U+FEFF is a character of a name, as in a browser.
  assert.deepEqual(resolvedOf('.a{color:red}\uFEFF.b{color:red}'), [
    ['.a', ['.a']],
    ['\uFEFF.b', ['\uFEFF.b']],
  ]);
});

test('lines count CR LF, CR, LF and FF as one line break each', () => {
  assert.deepEqual(placesOf('.a{\r\n color: red;\r\n}\r.b{\fcolor: red}\n.c{color:red}'), [
    'rule .a 1:1',
    'declaration color 2:2',
    'rule .b 4:1',
    'declaration color 5:1',
    'rule .c 6:1',
    'declaration color 6:4',
  ]);
});

test('the helpers read component values by ASCII case, and split and trim lists', () => {
  assert.equal(asciiLower('Canvas-TEXTKİ'), 'canvas-textKİ');
  const { values } = parseValue(' VAR(--a) , Auto ,, ');
  assert.deepEqual(splitCommas(values).map(serialize), ['VAR(--a)', 'Auto', '', '']);
  assert.ok(isFunction(values[0], 'var'));
  assert.equal(isFunction(values[0], 'VAR'), false);
  assert.ok(isIdent(splitCommas(values)[1]?.[0], 'auto'));
  assert.ok(isDelim(parseValue('&').values[0], '&'));
  assert.deepEqual(trimWhitespace(parseValue(' ').values), []);
  assert.equal(serialize(parseValue('a  b\n(c,d) [e] {f} g(h)').values), 'a b (c,d) [e] {f} g(h)');
});

// The tree

test('a declaration has its property, its value, !important and its place', () => {
  const css = '.a {\n  COLOR: Red ! IMPORTANT;\n  --Brand-X:  1px ;\n  --empty:;\n  display:none!important\n}';
  const declarations: Declaration[] = [];
  walk(parseCss(css, 'x.css'), (node) => {
    if (node.type === 'declaration') declarations.push(node);
  });
  assert.deepEqual(
    declarations.map((node) => [
      node.property,
      serialize(node.value),
      node.important,
      node.place.line,
      node.place.column,
    ]),
    [
      ['color', 'Red', true, 2, 3],
      ['--Brand-X', '1px', false, 3, 3],
      ['--empty', '', false, 4, 3],
      ['display', 'none', true, 5, 3],
    ],
  );
  assert.deepEqual(parseCss(css, 'x.css').problems, []);
});

test('a custom property may hold a block, and a value keeps its functions and blocks', () => {
  assert.deepEqual(declarationsOf('.a { --x: {a: b}; --y: [c]; width: calc(100% - var(--space-4)) }'), [
    '- | - | style:.a | --x: {a: b}',
    '- | - | style:.a | --y: [c]',
    '- | - | style:.a | width: calc(100% - var(--space-4))',
  ]);
  const value = firstDeclaration('.a{grid-template-columns:repeat(auto-fit,minmax(min(100%,var(--g)),1fr))}')?.value;
  assert.deepEqual(shapes(value ?? []), [
    'repeat(ident(auto-fit) comma minmax(min(percentage(100,int) comma var(ident(--g))) comma dimension(1,fr,int)))',
  ]);
});

test('declarations belong to their rule through nested at-rules, keyframes and @font-face', () => {
  const css = [
    '@layer components {',
    '  .card {',
    '    color: var(--color-text);',
    '    @media (width >= 48rem) { gap: var(--space-2); .card__body { gap: 0 } }',
    '    @starting-style { opacity: 0; }',
    '  }',
    '  @keyframes card-in { from { opacity: 0; } 50% { opacity: var(--opacity-half); } to { opacity: 100%; } }',
    '}',
    '@font-face { font-family: X; src: url(x.woff2) format("woff2"); }',
    '@media (prefers-reduced-motion: no-preference) { @view-transition { navigation: auto; } }',
  ].join('\n');
  assert.deepEqual(declarationsOf(css), [
    'components | @layer | style:.card | color: var(--color-text)',
    'components | @layer/@media | style:.card | gap: var(--space-2)',
    'components | @layer/@media | style:.card .card__body | gap: 0',
    'components | @layer/@starting-style | style:.card | opacity: 0',
    'components | @layer/@keyframes | keyframe:from | opacity: 0',
    'components | @layer/@keyframes | keyframe:50% | opacity: var(--opacity-half)',
    'components | @layer/@keyframes | keyframe:to | opacity: 100%',
    '- | @font-face | - | font-family: X',
    '- | @font-face | - | src: url(x.woff2) format("woff2")',
    '- | @media/@view-transition | - | navigation: auto',
  ]);
  assert.deepEqual(parseCss(css, 'x.css').problems, []);
});

test('at-rules keep their name in lower case, their prelude, and a block or none', () => {
  const sheet = parseCss(
    '@IMPORT url(x.css) layer(a);@layer a, b;@Media  screen  and (width<48rem) {}@scope (.a) {}',
    'x.css',
  );
  assert.deepEqual(
    sheet.nodes.map((node) =>
      node.type === 'at-rule' ? [node.name, serialize(node.prelude), node.block === undefined ? 'none' : 'block'] : [],
    ),
    [
      ['import', 'url(x.css) layer(a)', 'none'],
      ['layer', 'a, b', 'none'],
      ['media', 'screen and (width<48rem)', 'block'],
      ['scope', '(.a)', 'block'],
    ],
  );
  assert.deepEqual(sheet.problems, []);
});

test('a rule has its prelude, its selector list and its place', () => {
  const sheet = parseCss('\n  h1 , .a > .b:is(.c, .d)::before\n{}', 'x.css');
  const rule = sheet.nodes[0];
  assert.equal(rule?.type, 'rule');
  const { prelude, selectors, kind, place } = rule as Rule;
  assert.equal(serialize(prelude), 'h1 , .a > .b:is(.c, .d)::before');
  assert.deepEqual(selectors.map(serialize), ['h1', '.a > .b:is(.c, .d)::before']);
  assert.equal(kind, 'style');
  assert.deepEqual(place, { offset: 3, line: 2, column: 3 });
});

/** Texts that are not CSS, each with its problems. */
const SHEET_PROBLEMS: readonly [string, string[]][] = [
  ['color: red;', ['1:1 a declaration outside a rule']],
  ['.a', ['1:1 a rule without a `{` block, or a stray text']],
  ['.a; .b {}', ['1:1 a rule without a `{` block, or a stray text']],
  ['.a { color: }', ['1:6 the declaration `color` has no value']],
  ['.a { color: red !ie }', ['1:17 a `!` that is not `!important` at the end of a value']],
  ['.a { color: red', ['1:4 `{` without its `}`']],
  ['.a }', ['1:4 `}` without its opening bracket', '1:1 a rule without a `{` block, or a stray text']],
  ['} .b {}', ['1:1 `}` without its opening bracket', '1:1 a rule without a `{` block, or a stray text']],
  ['.b) {}', ['1:3 `)` without its opening bracket', '1:1 a rule without a `{` block, or a stray text']],
  ['--x: a {}', ['1:1 a declaration outside a rule']],
  ['.a, {}', ['1:1 an empty selector']],
  ['{}', ['1:1 an empty selector']],
  ['@layer a b;', ['1:1 an `@layer` prelude that is no list of layer names']],
  ['@layer a, b {}', ['1:1 an `@layer` prelude that is no list of layer names']],
  ['@layer;', ['1:1 an `@layer` prelude that is no list of layer names']],
  ['@layer a.;', ['1:1 an `@layer` prelude that is no list of layer names']],
  ['@media (x) { color: red }', ['1:14 a declaration outside a rule']],
  ['@font-face { .a {} }', ['1:14 a text that is no declaration']],
  ['@keyframes k { from { .a {} } }', ['1:23 a text that is no declaration']],
  ['.a { *zoom: 1 }', ['1:6 a rule without a `{` block, or a stray text']],
  [
    `${'.a{'.repeat(MAX_DEPTH + 1)}${'}'.repeat(MAX_DEPTH + 1)}`,
    [`1:${3 * MAX_DEPTH + 3} nesting deeper than 32 levels`],
  ],
];

test('a text that is not CSS gives problems with places, and the parse goes on', () => {
  for (const [css, expected] of SHEET_PROBLEMS) {
    assert.deepEqual(problemsOf(css).sort(), [...expected].sort(), JSON.stringify(css));
  }
  // Outside a style rule a `;` ends no rule: `color: red; .b` is one prelude, and a browser drops the rule and its
  // block (Chromium, css-oracle.test.ts). So is a prelude with a bracket without its partner, or `--x:`.
  assert.deepEqual(declarationsOf('color: red; .b { color: blue }'), []);
  assert.deepEqual(declarationsOf('.a; .b { color: blue } .c { color: green }'), ['- | - | style:.c | color: green']);
  assert.deepEqual(declarationsOf('.a {} } .b { color: blue } .c { color: green }'), [
    '- | - | style:.c | color: green',
  ]);
  assert.deepEqual(declarationsOf('--x: a { color: blue } .c { color: green }'), ['- | - | style:.c | color: green']);
  assert.deepEqual(declarationsOf('.a { color: red) } .c { color: green }'), [
    '- | - | style:.a | color: red)',
    '- | - | style:.c | color: green',
  ]);
});

// The values below come from css-oracle.test.ts: in each, the kit read another tree than Chromium before the fix.

test('a list of rules reads a `;` as part of a prelude, and a browser drops that rule with its block', () => {
  assert.deepEqual(declarationsOf('.a { color: red }; .b { color: blue } .c { gap: 0 }'), [
    '- | - | style:.a | color: red',
    '- | - | style:.c | gap: 0',
  ]);
  assert.deepEqual(problemsOf('.a {}; .b {}'), ['1:6 a rule without a `{` block, or a stray text']);
  assert.deepEqual(problemsOf('@media (x) { gap: 0; .b {} }'), ['1:14 a declaration outside a rule']);
  // The block of @keyframes is a list of rules too: `from, color:red;50%` is one prelude.
  assert.deepEqual(resolvedOf('@keyframes k { from, color:red;50% {} to {} }'), [['to', ['to']]]);
  // Inside a style rule a `;` ends the text: the next rule stays.
  assert.deepEqual(resolvedOf('.a { foo; .b {} }'), [
    ['.a', ['.a']],
    ['.b', ['.a .b']],
  ]);
});

test('a list of declarations skips a text that is no declaration up to its next `;`', () => {
  assert.deepEqual(declarationsOf('@font-face { b:c{} src: url(x.woff2); font-family: X }'), [
    '- | @font-face | - | font-family: X',
  ]);
  assert.deepEqual(declarationsOf('@keyframes k { 50% { d:hover {} --z: {}; opacity: 0 } }'), [
    '- | @keyframes | keyframe:50% | opacity: 0',
  ]);
});

test('the block of @scope holds declarations and rules, as a style rule does', () => {
  assert.deepEqual(declarationsOf('@scope (.a) { color: red; .b { gap: 0 } --z: {}; }'), [
    '- | @scope | - | color: red',
    '- | @scope | style:.b | gap: 0',
    '- | @scope | - | --z: {}',
  ]);
  assert.deepEqual(parseCss('@scope (.a) { color: red; .b { gap: 0 } }', 'x.css').problems, []);
});

test('a name and a colon with one `{}` block as the whole value is a declaration (CSS Syntax Level 3; Chromium)', () => {
  assert.deepEqual(declarationsOf('.a { max-inline-size: {x}; color: {y} !important; b:c {d: e} }'), [
    '- | - | style:.a | max-inline-size: {x}',
    '- | - | style:.a | color: {y} !important',
    '- | - | style:.a b:c | d: e',
  ]);
  // A block with another value beside it: no declaration. The rule then ends at the first block: `b:` and `d`.
  assert.deepEqual(resolvedOf('.a { b: {c} d {e: f} }'), [
    ['.a', ['.a']],
    ['b:', ['.a b:']],
    ['d', ['.a d']],
  ]);
});

test('in a rule, a name and a colon start a declaration, unless a block follows it: then it is a nested rule', () => {
  assert.deepEqual(resolvedOf('.a { a:hover { color: red } color: blue; b:is(.c){} }'), [
    ['.a', ['.a']],
    ['a:hover', ['.a a:hover']],
    ['b:is(.c)', ['.a b:is(.c)']],
  ]);
  assert.deepEqual(declarationsOf('.a { a:hover { color: red } color: blue }'), [
    '- | - | style:.a a:hover | color: red',
    '- | - | style:.a | color: blue',
  ]);
});

// Nesting (7.1: each nested rule is checked as its resolved selector)

/** A parent and a nested rule, and the resolved selectors of the nested rule. */
const NESTING: readonly [string, string[]][] = [
  ['.a { &:hover {} }', ['.a:hover']],
  ['.a { & .b {} }', ['.a .b']],
  ['.a { .b {} }', ['.a .b']],
  ['.a { > .b {} }', ['.a > .b']],
  ['.a { + .b {} }', ['.a + .b']],
  ['.a { ~ .b {} }', ['.a ~ .b']],
  ['.a { .b & {} }', ['.b .a']],
  ['.a { .x& {} }', ['.x.a']],
  ['.a .b { &.c {} }', ['.a .b.c']],
  ['.a .b { .c & {} }', ['.c :is(.a .b)']],
  ['.a > .b { & + & {} }', ['.a > .b + :is(.a > .b)']],
  ['.a { & + & {} }', ['.a + .a']],
  ['div { .x& {} }', ['.x:is(div)']],
  ['.a { div& {} }', ['div.a']],
  ['.a { &div {} }', [':is(.a)div']],
  ['.a { :not(&) {} }', [':not(.a)']],
  ['.a { .b:has(> &) {} }', ['.b:has(> .a)']],
  ['.a .b { :is(&) {} }', [':is(.a .b)']],
  ['.a, .b { & .c {} }', ['.a .c', '.b .c']],
  ['.a, .b { .c, .d {} }', ['.a .c', '.b .c', '.a .d', '.b .d']],
  ['.a, .b { & + & {} }', [':is(.a, .b) + :is(.a, .b)']],
  // A selector that starts with a combinator is relative, also when it holds `&` (CSS Nesting; Chromium gives
  // `& > &`).
  ['.a { > & {} }', ['.a > .a']],
  ['.card { + & {} }', ['.card + .card']],
  ['.a { ~ & {} }', ['.a ~ .a']],
  ['.a { + .b & {} }', ['.a + .b .a']],
  ['.a, .b { ~ & {} }', [':is(.a, .b) ~ :is(.a, .b)']],
  ['.a{>&{color:red}}', ['.a >.a']],
  // A parent list multiplies only where each `&` stands at the top level (Chromium): `:not()` takes the whole list.
  ['.a, .b { .x:not(&) {} }', ['.x:not(:is(.a, .b))']],
  ['.a, .b { :nth-child(2 of &) {} }', [':nth-child(2 of :is(.a, .b))']],
  ['.a, .b { .x:has(> &) {} }', ['.x:has(> :is(.a, .b))']],
  // Inside `:has()` a parent with `:has()` stands as `:is()`, which forgives it (CSS refuses `:has()` in `:has()`).
  ['.a:has(.b) { .c:has(> &) {} }', ['.c:has(> :is(.a:has(.b)))']],
  ['.a:has(.b) { &:hover {} }', ['.a:has(.b):hover']],
  ['.a:is(.b, .c) { & .d {} }', ['.a:is(.b, .c) .d']],
  ['.a { @media (x) { .b {} } }', ['.b'].map((selector) => `.a ${selector}`)],
  ['.a { .b { .c {} } }', ['.a .b', '.a .b .c']],
  // The built form of the minifier: an explicit `&`, and rules joined.
  ['.a{&>.b,&+.c{color:red}}', ['.a>.b', '.a+.c']],
  [
    '.text-section{&:not(:last-child){padding:0}& :is(h2,h3):not(:first-child){margin:0}}',
    ['.text-section:not(:last-child)', '.text-section :is(h2,h3):not(:first-child)'],
  ],
];

test('a nested rule resolves to the selectors that CSS Nesting gives it', () => {
  for (const [css, expected] of NESTING) {
    const rules = resolvedOf(css);
    assert.deepEqual(
      rules.slice(1).flatMap(([, resolved]) => resolved),
      expected,
      css,
    );
  }
});

test('a top-level rule and a keyframe rule keep their own selectors', () => {
  assert.deepEqual(resolvedOf('& .a {} .b, .c {} @keyframes k { from, 50% {} to {} }'), [
    ['& .a', ['& .a']],
    ['.b, .c', ['.b', '.c']],
    ['from, 50%', ['from', '50%']],
    ['to', ['to']],
  ]);
  assert.deepEqual(resolvedOf('.a { @keyframes k { from {} } }'), [
    ['.a', ['.a']],
    ['from', ['from']],
  ]);
});

test('a parent list beyond the limit stands as one :is(), and a selector beyond the size limit is a problem', () => {
  const many = Array.from({ length: 9 }, (_, index) => `.p${index}`).join(', ');
  const children = Array.from({ length: 8 }, (_, index) => `.c${index}`).join(', ');
  const rules = resolvedOf(`${many} { ${children} {} }`);
  assert.equal(rules[1]?.[1].length, 8);
  assert.equal(rules[1]?.[1][0], `:is(${many}) .c0`);

  // Each level doubles the selector: `& &` with a parent of one compound.
  const doubling = `.a{${'& &{'.repeat(20)}${'}'.repeat(21)}`;
  const sheet = parseCss(doubling, 'x.css');
  assert.deepEqual(
    sheet.problems.map(({ message }) => message),
    [`a selector larger than ${MAX_RESOLVED_SIZE} values after nesting`],
  );
});

test('the budget of MAX_RESOLVED_TOTAL stops the work of nesting before it is spent, not after', () => {
  assert.equal(MAX_RESOLVED_TOTAL, 1_000_000);
  // A large parent and 60,000 `&` in one list would build about 160 million values without the running budget.
  const parent = '.a '.repeat(1360);
  const start = performance.now();
  const sheet = parseCss(`${parent}{${'&,'.repeat(60_000)}&{color:red}}`, 'x.css');
  // Two such rules fit the budget. The third spends what is left, so every later rule is a problem at no cost.
  const many = parseCss(`${parent}{${'&,'.repeat(100)}&{color:red}}`.repeat(100), 'x.css');
  const elapsed = performance.now() - start;
  assert.deepEqual(
    sheet.problems.map(({ message }) => message),
    [`nested selectors larger than ${MAX_RESOLVED_TOTAL} values in all`],
  );
  assert.equal(many.problems.length, 98);
  assert.ok(elapsed < 2000, `${Math.round(elapsed)} ms`);
});

test('a block of many nested rules that look like declarations parses in linear time', () => {
  const start = performance.now();
  const sheet = parseCss(`.x{${'a:b{}'.repeat(20_000)}${'a:b c{}'.repeat(8000)}}`, 'x.css');
  const elapsed = performance.now() - start;
  assert.deepEqual(sheet.problems, []);
  assert.equal(sheet.nodes[0]?.type === 'rule' ? sheet.nodes[0].children.length : 0, 28_000);
  assert.ok(elapsed < 2000, `${Math.round(elapsed)} ms`);
});

// walk, layers and classes

test('walk gives each node its enclosing at-rules, its full layer name and its rule', () => {
  const css = [
    '@layer a { @layer b { .x { color: red } } }',
    '@layer a.c { .y { color: red } }',
    '@layer { .z { color: red } }',
    '@layer astro.images { .w { color: red } }',
    '.u { color: red }',
    '@media (x) { @layer d { .v { color: red } } }',
  ].join('\n');
  assert.deepEqual(declarationsOf(css), [
    'a.b | @layer/@layer | style:.x | color: red',
    'a.c | @layer | style:.y | color: red',
    `${ANONYMOUS_LAYER} | @layer | style:.z | color: red`,
    'astro.images | @layer | style:.w | color: red',
    '- | - | style:.u | color: red',
    'd | @media/@layer | style:.v | color: red',
  ]);
  const visited: string[] = [];
  walk(parseCss('.a { .b { color: red } }', 'x.css').nodes, (node, context) => {
    visited.push(`${node.type}:${context.rule === undefined ? '-' : serialize(context.rule.prelude)}`);
  });
  assert.deepEqual(visited, ['rule:-', 'rule:.a', 'declaration:.b']);
});

test('the layer tree gives the top-level @layer statements and blocks in order, as the minifier splits them', () => {
  const built =
    '@layer astro;@layer reset{*{margin:0}}@layer tokens{:root{--a:1}}@layer components,page;@layer astro.images{img{display:block}}@layer page{.p{order:1}}';
  const sheet = parseCss(built, 'index.html');
  assert.deepEqual(
    layerTree(sheet).map(({ kind, names }) => `${kind} ${names.join(',')}`),
    ['statement astro', 'block reset', 'block tokens', 'statement components,page', 'block astro.images', 'block page'],
  );
  assert.deepEqual(layerOrder(sheet), ['astro', 'reset', 'tokens', 'components', 'page', 'astro.images']);
  assert.deepEqual(layerOrder(parseCss('@layer a{.x{color:red}}@layer b;@layer b.c{.y{color:red}}', 'x.css')), [
    'a',
    'b',
    'b.c',
  ]);
  // A browser drops a block whose `@layer` prelude is no layer name, so walk does not enter it.
  assert.deepEqual(declarationsOf('@layer a b{.x{color:red}}@layer a,b{.y{color:red}}@layer c{.z{color:red}}'), [
    'c | @layer | style:.z | color: red',
  ]);
  assert.deepEqual(placesOf('@layer a b{.x{color:red}}'), ['at-rule layer 1:1']);
  assert.deepEqual(
    layerTree(parseCss('@layer {} .a { @layer x {} } @layer a b;', 'x.css')).map(({ kind, names }) => [kind, names]),
    [
      ['block', []],
      ['statement', []],
    ],
  );
});

test('classesOf gives each class of a selector or of a sheet once, at its first place', () => {
  const { values } = parseValue('.a .b:is(.c, .d):not(.a) [class~="e"] .f\\:g:nth-child(2n of .h)::before');
  assert.deepEqual(
    classesOf(values).map(({ name }) => name),
    ['a', 'b', 'c', 'd', 'f:g', 'h'],
  );
  const sheet = parseCss(
    '.card { .card__body {} &.card--wide {} }\n@media (x) { .card:hover {} }\n@keyframes k { 50% {} }\n@container card (width > 1px) {}\n.x{width:.5px}',
    'card.css',
  );
  assert.deepEqual(
    classesOf(sheet).map(({ name, place }) => `${name} ${place.line}:${place.column}`),
    ['card 1:1', 'card__body 1:9', 'card--wide 1:25', 'x 5:1'],
  );
});

// The built CSS of the test site, as Lightning CSS writes it into a page (a part of the `<style>` of the home)

const BUILT = [
  '@layer astro;@layer reset{*,:before,:after{box-sizing:border-box}*{margin:0}',
  '[hidden]:not([hidden=until-found]),:root:not([data-mode]) [data-mode-switch]{display:none!important}',
  '.visually-hidden:not(:focus-within){clip-path:inset(50%)!important;white-space:nowrap!important}',
  ':focus-visible:not([tabindex="-1"]){outline-style:solid!important}',
  '@media (prefers-reduced-motion:reduce){*,:before,:after{scroll-behavior:auto!important;animation:none!important}}}',
  '@layer tokens{:root{color-scheme:light dark;--color-page:light-dark(#fbf7f0,#191512);--color-shadow:light-dark(#2b25211f,#00000073);',
  '--font-body:system-ui, -apple-system, "Segoe UI", sans-serif;--text-s:.875rem;--tracking-tight:-.01em;',
  '--ease-out:cubic-bezier(.16, 1, .3, 1);--gradient-hero:linear-gradient(170deg, var(--color-glow) 0%, var(--color-page) 100%)}',
  ':root[data-mode=light]{color-scheme:light}@media (prefers-contrast:more){:root:not([data-mode]),:root[data-mode=auto]{--color-page:light-dark(#fff,#000)}}}',
  '@layer elements{body{grid-template-rows:auto 1fr auto;grid-template-columns:minmax(0,1fr);display:grid}dd+dt{margin-block-start:var(--space-3)}',
  'a.button{border:var(--line-thick) solid var(--color-text)}input[type=radio]{flex-shrink:0}}',
  '@layer layout{.grid{grid-template-columns:repeat(auto-fit, minmax(min(100%, var(--grid-min)), 1fr))}}',
  '@layer components{.text-section{padding-block:var(--space-7);&:not(:last-child){padding-block-end:0}& :is(h2,h3):not(:first-child){margin-block-start:var(--space-5)}}',
  '.mode-switch{position:relative;& .mode-switch__panel{display:grid}@media (width>=48rem){& .mode-switch__panel{position:absolute;inset-inline:0}}}',
  '.feature-card{border:var(--line-thin) solid transparent;@container (inline-size>=40rem){& .feature-card__body{grid-template-columns:1fr 2fr}}}',
  '@keyframes hero-rise{0%{opacity:0;translate:0 var(--space-4)}}}',
  '@layer page;@media (prefers-reduced-motion:no-preference){@view-transition{navigation:auto}}',
  '@layer page{@container (inline-size>=59rem){.feature-card:first-child{grid-column:1/-1}}}',
].join('\n');

test('the built CSS of a page parses without a problem, nesting kept, as Lightning CSS writes it', () => {
  const sheet = parseCss(BUILT, '/');
  assert.deepEqual(sheet.problems, []);
  assert.deepEqual(layerOrder(sheet), ['astro', 'reset', 'tokens', 'elements', 'layout', 'components', 'page']);
  const declarations = declarationsOf(BUILT);
  assert.equal(declarations.length, 38);
  assert.deepEqual(
    declarations.filter((line) => line.includes('mode-switch__panel') || line.includes('feature-card')),
    [
      'components | @layer | style:.mode-switch .mode-switch__panel | display: grid',
      'components | @layer/@media | style:.mode-switch .mode-switch__panel | position: absolute',
      'components | @layer/@media | style:.mode-switch .mode-switch__panel | inset-inline: 0',
      'components | @layer | style:.feature-card | border: var(--line-thin) solid transparent',
      'components | @layer/@container | style:.feature-card .feature-card__body | grid-template-columns: 1fr 2fr',
      'page | @layer/@container | style:.feature-card:first-child | grid-column: 1/-1',
    ],
  );
  assert.ok(
    declarations.includes(
      'reset | @layer | style:.visually-hidden:not(:focus-within) | clip-path: inset(50%) !important',
    ),
  );
  assert.ok(declarations.includes('components | @layer/@keyframes | keyframe:0% | translate: 0 var(--space-4)'));
  assert.ok(declarations.includes('- | @media/@view-transition | - | navigation: auto'));
});

// Hostile input

/** Texts that try to break the parser. Each gives a sheet, at most MAX_PROBLEMS problems, and no throw. */
const HOSTILE: readonly string[] = [
  '',
  '{',
  '}',
  '@',
  '@media',
  '\\',
  'url(',
  '"',
  '/*',
  '(((((',
  '((((('.repeat(4000),
  '{'.repeat(20000),
  '}'.repeat(20000),
  '.a{'.repeat(5000),
  '&{'.repeat(5000),
  '.a,.b{'.repeat(200),
  'constructor{__proto__:1;toString:2}',
  '__proto__{constructor:{}}',
  '@constructor __proto__;',
  '\u0000𐏿￾',
  '.a{color:red;'.repeat(2000),
  `.a{${'& & & &{'.repeat(MAX_DEPTH + 4)}`,
  `${Array.from({ length: 200 }, (_, index) => `.p${index}`).join(',')}{${'.c,.d{'.repeat(40)}`,
  'a'.repeat(100000),
  '1e99999999px',
  `#${'a'.repeat(100000)}`,
  `"${'\\'.repeat(100001)}`,
  'url(\\',
  '<!--.a{}-->',
];

test('hostile texts give a sheet and bounded problems, never a throw', () => {
  for (const css of HOSTILE) {
    const sheet = parseCss(css, 'x.css');
    assert.equal(sheet.type, 'stylesheet', css.slice(0, 40));
    assert.ok(sheet.problems.length <= MAX_PROBLEMS, css.slice(0, 40));
    let count = 0;
    walk(sheet, () => {
      count += 1;
    });
    assert.ok(count >= 0);
    assert.ok(classesOf(sheet).length >= 0);
    assert.ok(parseValue(css).problems.length <= MAX_PROBLEMS, css.slice(0, 40));
  }
});

test('names from the input find nothing in the tables of the parser', () => {
  assert.deepEqual(problemsOf('@font-face { a: b }'), []);
  assert.deepEqual(problemsOf('@constructor { a: b }'), ['1:16 a declaration outside a rule']);
  assert.deepEqual(problemsOf('@hasOwnProperty { a: b }'), ['1:19 a declaration outside a rule']);
  assert.deepEqual(declarationsOf('@toString { .a { b: c } } @__proto__ { d: e }'), [
    '- | @tostring | style:.a | b: c',
  ]);
  assert.deepEqual(problemsOf('@toString { .a { b: c } } @__proto__ { d: e }'), ['1:40 a declaration outside a rule']);
});

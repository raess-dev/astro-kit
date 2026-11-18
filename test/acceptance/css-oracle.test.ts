/**
 * The differential test of the CSS analyzers (specification, 3.2, 7.1, 7.10, 7.11 and 14.2). The four CSS modules of
 * M4 promise to read CSS as a browser reads it, and the shapes of 7.1 promise what a component file may select. This file holds each promise to Chromium, with many thousand
 * candidates from a generator with a fixed seed:
 *
 * 1. **Selectors** (`parseSelectorList`). A selector list that the kit accepts is valid in Chromium: `CSS.supports`
 *    with `selector()` is true for each part, `querySelectorAll` does not throw, and the `selectorText` of a style
 *    rule takes it. A list that the
 *    kit refuses as `invalid` is refused by all three. A list that the kit refuses as `unread` (a name it does not
 *    know, a namespace, a problem in the forgiving argument of `:is()`) gets no claim: CSS may keep it. The shapes
 *    of 7.1 (the lead's decisions too) are no parse problem: `shapeProblems` reports them, and this file never
 *    calls it. `:global()` is the one name that the kit accepts and CSS refuses; `css-banned` reports it.
 * 2. **Specificity** (`specificity`). Two valid selectors that match one element of a fixed document stand in one
 *    layer and set one property to two values. The computed value shows the winner. The kit's order must agree:
 *    the greater specificity wins, and with equal specificity the later rule. The root-class exemption of a
 *    component file is policy, not CSS: the unit tests cover it.
 * 3. **Preludes** (`parseMediaPrelude`, `parseContainerPrelude`). A query of `@media` that the kit accepts is no
 *    `not all` in the `MediaList` of Chromium, and one with an `invalid` problem is `not all`. An `@container`
 *    prelude that the kit accepts stays in `cssRules` with the same `conditionText`, and one with an `invalid`
 *    problem is dropped. A problem of 7.10 (a media type, a feature or a value in brackets that 7.10 does not
 *    allow, a function, `var()`, a container name, a list of container queries) is policy and gets no claim.
 * 4. **Style sheets** (`parseCss`). For the source CSS of the test site, the built `<style>` of each page, the CSS of
 *    the parse unit test and mutations of all of them, the kit's tree must hold what Chromium's tree holds. The
 *    CSSOM cannot count declarations as written: it expands shorthands, drops a declaration that it cannot read
 *    and keeps one of two declarations of one property. So the test writes the kit's tree out again as CSS: each
 *    rule with its prelude and block, each declaration as `<property>:<value>` with its `!important`. Chromium
 *    reads the original text and that text, and the two style sheets must serialize to the same `cssText`, rule
 *    by rule and nested rules included, without comments. A declaration that the kit puts in the wrong rule, a rule
 *    that it drops or adds, a block that ends at another place and a value that it cuts differently all change that
 *    text. On the texts of the test site, where Chromium keeps every rule, the number of rules of the kit's tree
 *    also equals the number of rules of the CSSOM. A text with an open end, or with a quirk of Chromium 153 that
 *    CSS Syntax Level 3 does not have (`quirkOf`), is not compared; the test counts such texts. A byte order mark at
 *    the start goes before Chromium reads a text, as decoding a file drops it.
 * 5. **Nesting** (`Rule.resolved`). Nested rules with `&` in every place over the fixed document of part 2: the
 *    elements where the nested rule sets a custom property that does not inherit are the elements that the kit's
 *    resolved selectors match. A resolved selector that the kit calls `invalid` makes Chromium drop the rule.
 * 6. **Component shapes** (`shapeProblems`). The shapes are policy, but three promises can be measured: a selector
 *    that passes `card.css` matches only inside a root of `card`, and it matches the same elements when the roots
 *    have other tags and when the component `box` has another class name.
 *
 * The kit side is the packed kit: its built modules through `kitModule`. The words of the mutations come from the
 * text of the built modules `css/selectors` and `css/media`, so a name that only the kit knows is a candidate. The
 * seeds are every string of the unit test files and the CSS of the test site. Controls prove that each comparison
 * can fail. The test asserts that no candidate is a gap.
 * Run: node --test test/acceptance/css-oracle.test.ts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, test } from 'node:test';
import type * as Media from '../../src/css/media.ts';
import type * as Parse from '../../src/css/parse.ts';
import type * as Selectors from '../../src/css/selectors.ts';
import {
  type Browser,
  base,
  build,
  kitModule,
  launch,
  type Page,
  REPO,
  read,
  siteCase,
  styles,
  tree,
} from './harness.ts';

// The kit

interface Kit {
  parse: typeof Parse;
  selectors: typeof Selectors;
  media: typeof Media;
  /** The words of the built selector module: pseudo-class and pseudo-element names among them. */
  selectorWords: readonly string[];
  /** The words of the built prelude module: media types, feature names and keywords among them. */
  mediaWords: readonly string[];
}

/** A word of CSS: a name, maybe with one or two hyphens before it. */
const CSS_WORD = /-{0,2}[a-z_][a-z0-9_-]*/gi;

/** The lower-case words of a module text. Words of comments are words too; as candidates they do no harm. */
const wordsOf = (source: string): string[] =>
  [...new Set(source.match(CSS_WORD) ?? [])].filter((word) => word === word.toLowerCase());

const builtText = (name: string): string =>
  readFileSync(join(base(), 'node_modules/@raess/astro-kit/dist', `${name}.js`), 'utf8');

let loaded: Promise<Kit> | undefined;

/** The packed kit of the base copy. */
function loadKit(): Promise<Kit> {
  loaded ??= (async () => ({
    parse: await kitModule<typeof Parse>('css/parse'),
    selectors: await kitModule<typeof Selectors>('css/selectors'),
    media: await kitModule<typeof Media>('css/media'),
    selectorWords: wordsOf(builtText('css/selectors')),
    mediaWords: wordsOf(builtText('css/media')),
  }))();
  return loaded;
}

// The site

/** One CSS text of the test site. */
interface SiteText {
  name: string;
  css: string;
}

let site: SiteText[] | undefined;

/** The source CSS files and the built `<style>` texts of the test site. The site is built once for the file. */
function siteTexts(): SiteText[] {
  if (site !== undefined) return site;
  const dir = siteCase('css-oracle');
  build(dir);
  const styleDir = join(dir, 'src/styles');
  const sources = tree(styleDir)
    .filter((file) => file.endsWith('.css'))
    .map((file) => ({ name: `src/styles/${file}`, css: read(styleDir, file) }));
  const dist = join(dir, 'dist');
  const pages = tree(dist)
    .filter((file) => file.endsWith('.html'))
    .map((file) => ({ name: `dist/${file}`, css: styles(read(dist, file)) }));
  site = [...sources, ...pages];
  return site;
}

// The seeds of the unit tests

/** The characters of the escapes of a JavaScript string. */
const JS_ESCAPES: ReadonlyMap<string, string> = new Map([
  ['n', '\n'],
  ['t', '\t'],
  ['r', '\r'],
  ['f', '\f'],
  ['v', '\v'],
  ['b', '\b'],
  ['0', '\0'],
]);

function unescapeJs(text: string): string {
  return text.replace(/\\(u\{[0-9a-f]{1,6}\}|u[0-9a-f]{4}|x[0-9a-f]{2}|[\s\S])/gi, (_, code: string) => {
    const hex = code.length > 1 ? code.replace(/^[ux]\{?|\}$/gi, '') : '';
    if (hex !== '') return String.fromCodePoint(Number.parseInt(hex, 16));
    return JS_ESCAPES.get(code) ?? code;
  });
}

/** A string literal of a TypeScript text: in single quotes, double quotes or backticks, on one line. */
const STRING_LITERAL = /'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\\n$]|\\.)*)`/g;

/**
 * Every string literal of a unit test file, unescaped: the inputs of its tables, and its messages too. A message
 * is no CSS, and as a candidate it does no harm.
 */
function literalsOf(file: string): string[] {
  const text = readFileSync(join(REPO, 'test/unit', file), 'utf8');
  const out = new Set<string>();
  for (const match of text.matchAll(STRING_LITERAL)) out.add(unescapeJs(match[1] ?? match[2] ?? match[3] ?? ''));
  return [...out];
}

// The generator

/** A source of numbers from 0 to 1 that gives the same numbers in every run (mulberry32). */
type Random = () => number;

function seeded(seed: number): Random {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), state | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

/** One entry of a list, picked by `random`. */
const pick = <T>(list: readonly T[], random: Random): T => list[Math.floor(random() * list.length)] as T;

/** At most `count` entries of the list, picked by `random`, in the order of the list. */
function sample<T>(list: readonly T[], count: number, random: Random): T[] {
  if (list.length <= count) return [...list];
  const picked = new Set<number>();
  while (picked.size < count) picked.add(Math.floor(random() * list.length));
  return list.filter((_, index) => picked.has(index));
}

/**
 * The pieces of a selector or a prelude: white space, strings, escapes, names (with the `(` of a function), numbers
 * with a unit, `::`, and every other character alone.
 */
const PIECE =
  /[ \t\n]+|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|(?:-{0,2}[a-z_]|\\[0-9a-f]{1,6} ?|\\[^0-9a-f\n])(?:[\w-]|\\[0-9a-f]{1,6} ?|\\[^0-9a-f\n])*\(?|[+-]?(?:\d*\.\d+|\d+)(?:e[+-]?\d+)?(?:%|[a-z]+)?|::|[\s\S]/gi;
const NAME_PIECE = /^-{0,2}[a-z_][\w-]*$/i;
const NUMBER_PIECE = /^[+-]?(?:\d*\.\d+|\d+)(?:e[+-]?\d+)?(?:%|[a-z]+)?$/i;

const piecesOf = (text: string): string[] => text.match(PIECE) ?? [];

/** What a mutation round knows: the words, the numbers, the extra pieces and the wrappers of one analyzer. */
interface Grammar {
  words: readonly string[];
  numbers: readonly string[];
  /** Pieces that a mutation puts before a piece: combinators, brackets, signs, keywords. */
  inserts: readonly string[];
  /** Texts around the whole candidate, with `$` for it. */
  wrappers: readonly string[];
  /** The longest candidate. */
  longest: number;
}

/** The mutations of one text: a piece removed, repeated, swapped, changed, or one more piece before it. */
function mutationsOf(text: string, grammar: Grammar, random: Random, count: number): string[] {
  const pieces = piecesOf(text);
  const out: string[] = [];
  const joined = (list: readonly string[]): string => list.join('');
  for (let round = 0; round < count; round += 1) {
    const at = Math.floor(random() * Math.max(pieces.length, 1));
    const piece = pieces[at] ?? '';
    const before = pieces.slice(0, at);
    const rest = pieces.slice(at + 1);
    switch (Math.floor(random() * 9)) {
      case 0:
        out.push(joined([...before, ...rest]));
        break;
      case 1:
        out.push(joined([...before, piece, piece, ...rest]));
        break;
      case 2:
        out.push(joined([...before, ...rest.slice(0, 1), piece, ...rest.slice(1)]));
        break;
      case 3:
        out.push(joined([...before, pick(grammar.inserts, random), piece, ...rest]));
        break;
      case 4: {
        const word = pick(grammar.words, random);
        const head = piece.endsWith('(') ? `${word}(` : word;
        out.push(
          joined([...before, NAME_PIECE.test(piece) || piece.endsWith('(') ? head : `${piece}${word}`, ...rest]),
        );
        break;
      }
      case 5:
        out.push(
          joined([...before, NUMBER_PIECE.test(piece) ? pick(grammar.numbers, random) : piece.toUpperCase(), ...rest]),
        );
        break;
      case 6:
        out.push(pick(grammar.wrappers, random).replace('$', text));
        break;
      case 7:
        out.push(joined([...before, piece, ' ', pick(grammar.words, random), ...rest]));
        break;
      default:
        out.push(joined([...before, pick(grammar.inserts, random), ...rest]));
    }
  }
  return out.filter((candidate) => candidate.length <= grammar.longest);
}

/**
 * The candidates of an analyzer: the seeds, then rounds of mutations. Each later round mutates candidates that
 * the kit accepted, so many candidates stand close to the border of its grammar.
 */
function candidatesOf(
  seeds: readonly string[],
  grammar: Grammar,
  accepts: (text: string) => boolean,
  options: { seed: number; perSeed: number; rounds: number; fewest: number },
): string[] {
  const random = seeded(options.seed);
  const all = new Set(seeds.filter((seed) => seed.length <= grammar.longest));
  let current = [...all];
  for (let round = 0; round < options.rounds; round += 1) {
    const next: string[] = [];
    for (const text of current)
      for (const mutant of mutationsOf(text, grammar, random, options.perSeed)) next.push(mutant);
    for (const mutant of next) all.add(mutant);
    const accepted = next.filter(accepts);
    current = sample([...new Set(accepted)], Math.max(options.fewest / 4, 200), random);
  }
  return [...all];
}

// The page

let browser: Browser | undefined;
let opened: Page | undefined;

/** A document in standards mode, with a fixture for the specificity checks. */
const DOCUMENT = 'data:text/html,<!doctype html><title>css oracle</title>';

/** One page of one Chromium for the whole file. */
async function thePage(): Promise<Page> {
  if (opened === undefined) {
    browser = await launch();
    opened = await (await browser.newContext()).newPage();
    await opened.goto(DOCUMENT);
  }
  return opened;
}

after(async () => {
  await browser?.close();
});

/** At most this many gaps show in a failure message. */
const SHOWN = 40;

// 1. Selectors

/** What Chromium says about one selector list. */
interface SelectorJudgement {
  supports: boolean;
  queried: boolean;
  kept: boolean;
}

/** A selector list for Chromium: its text, and the text of each part between top-level commas. */
interface SelectorProbe {
  text: string;
  parts: string[];
}

/**
 * Runs in the page: the three answers of Chromium for each selector list. `selector()` of `CSS.supports` takes one
 * complex selector, so it asks for each part of the list. The style sheet check sets `selectorText` of a rule: that
 * parses a selector list alone, as a style rule reads its prelude, and keeps the old text when the list is invalid.
 */
function selectorsInPage(list: SelectorProbe[]): SelectorJudgement[] {
  const sheet = new CSSStyleSheet();
  const placeholder = '.css-oracle-placeholder';
  sheet.replaceSync(`${placeholder}{color:red}`);
  const rule = sheet.cssRules[0];
  return list.map(({ text, parts }) => {
    const supports = parts.every((part) => CSS.supports(`selector(${part})`));
    let queried = true;
    try {
      document.querySelectorAll(text);
    } catch {
      queried = false;
    }
    let kept = false;
    if (rule instanceof CSSStyleRule) {
      rule.selectorText = placeholder;
      rule.selectorText = text;
      kept = rule.selectorText !== placeholder || text.trim() === placeholder;
    }
    return { supports, queried, kept };
  });
}

/** The probe of a text: the parts between the commas at its top level, as the kit's tokens place them. */
function selectorProbe(kit: Kit, text: string): SelectorProbe {
  const commas = kit.parse
    .parseValue(text)
    .values.filter((value) => value.type === 'comma')
    .map((value) => value.place.offset);
  const cuts = [-1, ...commas, text.length];
  return { text, parts: cuts.slice(1).map((end, index) => text.slice((cuts[index] ?? 0) + 1, end)) };
}

/** What the kit says about a selector list. `undefined` when the text is no list of tokens for a selector. */
type SelectorVerdict = 'accepted' | 'global' | Selectors.Refusal;

/** Says whether a selector holds `:global()` at any depth. */
function holdsGlobal(selector: Selectors.ComplexSelector): boolean {
  return selector.compounds.some((compound) =>
    compound.pseudoClasses.some((pseudo) => pseudo.name === 'global' || (pseudo.selectors ?? []).some(holdsGlobal)),
  );
}

/**
 * A text with a token problem (an open string or comment, a bracket without its partner, a bad escape) is no
 * selector text: a style sheet would read more or less than the selector, so the three checks of Chromium would
 * not judge one thing. A brace or a semicolon ends a selector in a style sheet. Such texts belong to the style sheet
 * part of this file.
 */
function selectorVerdict(kit: Kit, text: string): SelectorVerdict | undefined {
  if (/[{};]/.test(text)) return undefined;
  const parsed = kit.parse.parseValue(text);
  if (parsed.problems.length > 0) return undefined;
  const list = kit.selectors.parseSelectorList(parsed.values);
  if (list.refusal !== undefined) return list.refusal;
  return list.selectors.some(holdsGlobal) ? 'global' : 'accepted';
}

const valid = (judgement: SelectorJudgement): boolean => judgement.supports && judgement.queried && judgement.kept;
const refused = (judgement: SelectorJudgement): boolean => !judgement.supports && !judgement.queried && !judgement.kept;

/** The gaps between the kit and Chromium: each a text with the verdicts. */
function selectorGaps(
  texts: readonly string[],
  verdicts: readonly SelectorVerdict[],
  judgements: readonly SelectorJudgement[],
): string[] {
  const gaps: string[] = [];
  texts.forEach((text, index) => {
    const verdict = verdicts[index];
    const judgement = judgements[index];
    if (verdict === undefined || judgement === undefined) return;
    const says = `supports ${judgement.supports}, querySelectorAll ${judgement.queried}, kept ${judgement.kept}`;
    if (verdict === 'accepted' && !valid(judgement)) gaps.push(`the kit accepts \`${text}\`; Chromium: ${says}`);
    if (verdict === 'invalid' && !refused(judgement)) gaps.push(`the kit calls \`${text}\` invalid; Chromium: ${says}`);
    // The kit reads `:global()` for css-banned. Chromium refuses it, or forgives it in `:is()` and `:where()`.
    if (verdict === 'global' && valid(judgement))
      gaps.push(`the kit reads \`${text}\` as :global(); Chromium: ${says}`);
  });
  return gaps;
}

/** Seeds that the unit tests do not have: every kind of simple selector, combinator and functional pseudo-class. */
const SELECTOR_SEEDS: readonly string[] = [
  'a',
  '.a',
  '#a',
  '*',
  '[a]',
  '[a="b" i]',
  'a b',
  'a>b',
  'a + b',
  'a ~ b',
  ':root',
  ':scope',
  '&',
  '& > .a',
  '.a &',
  ':is(.a, #b)',
  ':where(a b)',
  ':not(.a, :hover)',
  ':has(> a, + b)',
  ':nth-child(2n+1 of .a)',
  ':nth-last-of-type(-n + 3)',
  ':lang(de)',
  ':dir(ltr)',
  'a::before',
  'a:before',
  '::view-transition-old(x)',
  '::view-transition-group(.a)',
  '::view-transition-new(x.a.b)',
  '::picker(select):open',
  ':nth-child(n- 1)',
  'li::marker',
  '.card:has(+ .card)',
  '.card:not(:last-child)',
  '.card__title a:hover',
  '.card--wide > .card__media',
  'html:has(dialog[open])',
  'input:user-invalid',
  ':popover-open',
  'a:global(.b)',
  '.a\\:b',
  '.\\31 a',
  '#\\31 a',
  '[data-x|=en]',
  '[ a = b ]',
  '[a=--b]',
  '[a="b" I]',
  ':nth-child(n+ 1)',
  ':nth-child(-n- 1)',
  ':nth-child(1n)',
  ':nth-child(0n+0)',
  ':nth-child(01)',
  ':nth-child(-0)',
  ':nth-child( odd )',
  '\\61',
  '#-a',
  '#--a',
  '.-\\31',
  '#a\\:b',
  '&&',
  '& &',
  '.a&.b',
  '&:is(&)',
  'a>>b',
  'a > + b',
  'a::before::marker',
  'a:after::marker',
  ':host(.a)',
  '::slotted(a)',
  '::part(a b)',
  ':is(a):is(b)',
  ':not(:not(a))',
  ':not(:is(::before))',
  ':has(:is(:has(a)))',
  ':nth-child(2n of :has(a))',
  'A::BEFORE',
  'a:BEFORE',
  'a:hover:not(.b)::before',
  '[a="b"][c]',
  '*|*',
  '|*',
];

const SELECTOR_INSERTS: readonly string[] = [
  ' ',
  '>',
  '+',
  '~',
  ',',
  '.',
  '#',
  ':',
  '::',
  '*',
  '&',
  '|',
  '||',
  '[',
  ']',
  '(',
  ')',
  '=',
  '"x"',
  '\\',
  '-',
  '--',
  '_',
  '1',
  'n',
  '!',
  '^=',
  '$=',
  '*=',
  '/',
  ' of ',
  'odd',
  'i',
  's',
  '%',
  '@',
];

const SELECTOR_WRAPPERS: readonly string[] = [
  ':is($)',
  ':where($)',
  ':not($)',
  ':has($)',
  ':has(> $)',
  ':nth-child(2n of $)',
  ':nth-last-child(odd of $)',
  ':nth-of-type(2 of $)',
  '$ a',
  '$ > .b',
  '$ + .b',
  '.b ~ $',
  '$::before',
  '$:before',
  '$:hover',
  '$, a',
  '& $',
  '$ &',
  ':is($, :foo)',
  ':global($)',
];

const AN_PLUS_B: readonly string[] = [
  '0',
  '1',
  '-1',
  '2',
  '+3',
  '2n',
  '-n',
  'n+1',
  '2n-1',
  '-n+3',
  'odd',
  'even',
  '1.5',
];

/** The candidates of the selector parser and the verdicts of the kit. */
function selectorCandidates(kit: Kit): { texts: string[]; verdicts: (SelectorVerdict | undefined)[] } {
  const seeds = [
    ...literalsOf('css-selectors.test.ts'),
    ...literalsOf('css-matrix.test.ts').filter((text) => text.length <= 60),
    ...SELECTOR_SEEDS,
    ...siteSelectors(kit),
  ];
  const grammar: Grammar = {
    words: [...kit.selectorWords, 'host', 'part', 'slotted', 'playing', 'heading', 'state', 'constructor', '__proto__'],
    numbers: AN_PLUS_B,
    inserts: SELECTOR_INSERTS,
    wrappers: SELECTOR_WRAPPERS,
    longest: 160,
  };
  const accepts = (text: string): boolean => selectorVerdict(kit, text) === 'accepted';
  const texts = candidatesOf(seeds, grammar, accepts, {
    seed: 0x5e1ec7,
    perSeed: 6,
    rounds: 3,
    fewest: SELECTOR_FEWEST,
  });
  return { texts, verdicts: texts.map((text) => selectorVerdict(kit, text)) };
}

/** Every resolved selector of the CSS of the test site, as text. */
function siteSelectors(kit: Kit): string[] {
  const out = new Set<string>();
  for (const text of siteTexts()) {
    kit.parse.walk(kit.parse.parseCss(text.css, text.name), (node) => {
      if (node.type !== 'rule' || node.kind !== 'style') return;
      for (const selector of node.resolved) out.add(kit.parse.serialize(selector));
    });
  }
  return [...out];
}

/** The candidates that the selector part wants at least. */
const SELECTOR_FEWEST = 4000;

// 2. Specificity

/** The fixed document of the specificity checks. Its elements are the targets, in document order. */
const FIXTURE =
  '<main id="m" class="page" data-x="y z" lang="de-CH">' +
  '<section class="card card--wide" id="s1"><h2 class="card__title">T</h2>' +
  '<p class="card__text">P <a class="card__link" href="#t" id="t">L</a> <span class="x">S</span></p></section>' +
  '<section class="card"><ul class="list"><li class="list__item">1</li>' +
  '<li class="list__item" aria-current="page">2</li><li class="x">3</li></ul>' +
  '<input class="field" required></section></main>';

const S_TYPES = ['main', 'section', 'h2', 'p', 'a', 'span', 'ul', 'li', 'input', 'body', 'html', '*'];
const S_CLASSES = ['page', 'card', 'card--wide', 'card__title', 'card__text', 'card__link', 'x', 'list', 'list__item'];
const S_IDS = ['m', 's1', 't'];
const S_ATTRIBUTES = [
  '[data-x]',
  '[data-x="y z"]',
  '[data-x~=y]',
  '[href]',
  '[href^="#"]',
  '[lang|=de]',
  '[aria-current=page]',
  '[required]',
  '[class]',
];
const S_PLAIN = [
  ':first-child',
  ':last-child',
  ':only-child',
  ':first-of-type',
  ':last-of-type',
  ':root',
  ':scope',
  ':link',
  ':any-link',
  ':required',
  ':optional',
  ':enabled',
  ':defined',
  ':lang(de)',
  ':dir(ltr)',
  ':nth-child(2n+1)',
  ':nth-child(2)',
  ':nth-last-child(-n+2)',
  ':nth-of-type(odd)',
  ':nth-child(odd of .list__item)',
];

/** A random compound of the fixture's names. Arguments of functional pseudo-classes go two levels deep. */
function fixtureCompound(random: Random, depth: number): string {
  let out = random() < 0.4 ? pick(S_TYPES, random) : '';
  // A nesting selector stands after the type: `a&` is CSS, `&a` is not.
  if (random() < 0.05) out = out === '*' ? '&' : `${out}&`;
  const parts = 1 + Math.floor(random() * 3);
  for (let index = 0; index < parts; index += 1) {
    const roll = random();
    if (roll < 0.45) out += `.${pick(S_CLASSES, random)}`;
    else if (roll < 0.55) out += `#${pick(S_IDS, random)}`;
    else if (roll < 0.7) out += pick(S_ATTRIBUTES, random);
    else if (roll < 0.85 || depth >= 2) out += pick(S_PLAIN, random);
    else {
      const name = pick([':is', ':where', ':not', ':has', ':nth-child', ':nth-last-child'], random);
      const list = Array.from({ length: 1 + Math.floor(random() * 2) }, () => {
        const inner = fixtureComplex(random, depth + 1);
        return name === ':has' && random() < 0.5 ? `${pick(['>', '+', '~'], random)} ${inner}` : inner;
      }).join(', ');
      out += name.startsWith(':nth')
        ? `${name}(${pick(['odd', '2n', 'n+1', '1'], random)} of ${list})`
        : `${name}(${list})`;
    }
  }
  return out;
}

function fixtureComplex(random: Random, depth: number): string {
  let out = fixtureCompound(random, depth);
  const more = Math.floor(random() * (depth === 0 ? 3 : 2));
  for (let index = 0; index < more; index += 1) {
    out = `${fixtureCompound(random, depth)}${pick([' ', ' ', ' > ', ' + ', ' ~ '], random)}${out}`;
  }
  return out;
}

/** What Chromium says about one fixture selector: valid or not, and the targets it matches. */
interface Match {
  valid: boolean;
  targets: number[];
}

/** Runs in the page: puts the fixture in, then judges each selector and lists the targets that it matches. */
function matchesInPage(batch: { fixture: string; selectors: string[] }): Match[] {
  document.body.innerHTML = batch.fixture;
  const targets = [document.documentElement, document.body, ...document.body.querySelectorAll('*')];
  return batch.selectors.map((text) => {
    let queried = true;
    try {
      document.querySelector(text);
    } catch {
      queried = false;
    }
    if (!(queried && CSS.supports(`selector(${text})`))) return { valid: false, targets: [] };
    // The document is the scope, as in a style sheet: `:scope` and a top-level `&` are the root element.
    const matched = new Set(document.querySelectorAll(text));
    return { valid: true, targets: targets.flatMap((element, index) => (matched.has(element) ? [index] : [])) };
  });
}

/** One pair: two selectors that match the target, written in this order. */
interface Pair {
  first: string;
  second: string;
  target: number;
}

/**
 * Runs in the page: each pair sets its own custom property in one layer, the first rule to `a` and the second to
 * `b`. The computed value on the target shows the winner.
 */
function winnersInPage(pairs: Pair[]): string[] {
  const sheet = new CSSStyleSheet();
  const rules = pairs.map((pair, index) => `${pair.first}{--p${index}:a}${pair.second}{--p${index}:b}`).join('');
  sheet.replaceSync(`@layer probe{${rules}}`);
  document.adoptedStyleSheets = [sheet];
  const targets = [document.documentElement, document.body, ...document.body.querySelectorAll('*')];
  const winners = pairs.map((pair, index) => {
    const target = targets[pair.target];
    return target === undefined ? '' : getComputedStyle(target).getPropertyValue(`--p${index}`).trim();
  });
  document.adoptedStyleSheets = [];
  return winners;
}

/** The winner of a pair by an order of specificity: `a` when the first is greater, else `b`. */
type Order = (first: Selectors.Specificity, second: Selectors.Specificity) => 'a' | 'b';

const greater = (a: Selectors.Specificity, b: Selectors.Specificity): boolean =>
  a[0] !== b[0] ? a[0] > b[0] : a[1] !== b[1] ? a[1] > b[1] : a[2] > b[2];

/** The order of CSS: the greater specificity wins; with equal specificity the later rule, which is the second. */
const CASCADE: Order = (first, second) => (greater(first, second) ? 'a' : 'b');

/** The pairs where the kit's specificities and `order` give another winner than Chromium. */
function specificityGaps(
  pairs: readonly Pair[],
  winners: readonly string[],
  specificityOf: (text: string) => Selectors.Specificity,
  order: Order,
): string[] {
  const gaps: string[] = [];
  pairs.forEach((pair, index) => {
    const first = specificityOf(pair.first);
    const second = specificityOf(pair.second);
    const expected = order(first, second);
    const winner = winners[index];
    if (winner !== expected) {
      gaps.push(
        `\`${pair.first}\` (${first.join(',')}) then \`${pair.second}\` (${second.join(',')}): Chromium ${winner}`,
      );
    }
  });
  return gaps;
}

/** The selectors of the fixture, the pairs, and Chromium's winners. */
async function specificityCase(kit: Kit): Promise<{
  generated: number;
  valid: number;
  pairs: Pair[];
  winners: string[];
  specificityOf: (text: string) => Selectors.Specificity;
}> {
  const random = seeded(0x5bec);
  const generated = [...new Set(Array.from({ length: 6000 }, () => fixtureComplex(random, 0)))];
  const matches = await (await thePage()).evaluate(matchesInPage, { fixture: FIXTURE, selectors: generated });
  const parsed = new Map<string, Selectors.ComplexSelector>();
  const byTarget = new Map<number, string[]>();
  generated.forEach((text, index) => {
    const match = matches[index];
    if (match === undefined || !match.valid) return;
    const result = kit.selectors.parseSelector(kit.parse.parseValue(text).values);
    if (result.selector === undefined) return;
    parsed.set(text, result.selector);
    for (const target of match.targets) byTarget.set(target, [...(byTarget.get(target) ?? []), text]);
  });
  const targets = [...byTarget.entries()].filter(([, list]) => list.length >= 2);
  const pairs: Pair[] = [];
  for (let index = 0; index < PAIRS && targets.length > 0; index += 1) {
    const [target, list] = pick(targets, random);
    const first = pick(list, random);
    const second = pick(list, random);
    if (first !== second) pairs.push({ first, second, target });
  }
  const winners = await (await thePage()).evaluate(winnersInPage, pairs);
  const specificityOf = (text: string): Selectors.Specificity => {
    const selector = parsed.get(text);
    return selector === undefined ? [-1, -1, -1] : kit.selectors.specificity(selector);
  };
  return { generated: generated.length, valid: parsed.size, pairs, winners, specificityOf };
}

/** The pairs that the specificity part wants. */
const PAIRS = 4000;

// 3. Preludes

/** What Chromium says about one prelude: the queries of `@media`, and the `conditionText` of `@container`. */
interface PreludeJudgement {
  /** The queries of the `MediaList`; `null` when the style sheet dropped the `@media` rule. */
  media: string[] | null;
  /** The `conditionText` of the `@container` rule; `null` when the style sheet dropped it. */
  container: string | null;
}

/** Runs in the page: the `MediaList` of `@media` and the `conditionText` of `@container` for each prelude. */
function preludesInPage(list: string[]): PreludeJudgement[] {
  const sheet = new CSSStyleSheet();
  return list.map((text) => {
    sheet.replaceSync(`@media ${text}{a{color:red}}`);
    const media = sheet.cssRules[0];
    const queries =
      sheet.cssRules.length === 1 && media instanceof CSSMediaRule ? Array.from(media.media, (query) => query) : null;
    sheet.replaceSync(`@container ${text}{a{color:red}}`);
    const container = sheet.cssRules[0];
    const condition =
      sheet.cssRules.length === 1 && container instanceof CSSContainerRule ? container.conditionText : null;
    return { media: queries, container: condition };
  });
}

/** What the kit says about a query or a prelude: no problem, an `invalid` problem, or only problems of 7.10. */
type PreludeVerdict = 'accepted' | 'invalid' | 'policy';

/** The kit's verdicts on one prelude text: each query of `@media`, and the `@container` prelude. */
interface PreludeVerdicts {
  /** One verdict per comma part; [] for an empty prelude. */
  media: PreludeVerdict[];
  /** The parts that read `not all`: Chromium writes an invalid query in the same way, so they get no claim. */
  notAll: boolean[];
  container: PreludeVerdict;
}

const verdictOf = (problems: readonly Media.MediaProblem[]): PreludeVerdict =>
  problems.length === 0 ? 'accepted' : problems.some((problem) => problem.invalid) ? 'invalid' : 'policy';

/** The kit's verdicts. `undefined` when the text has a token problem or a brace or semicolon (see the selectors). */
function preludeVerdicts(kit: Kit, text: string): PreludeVerdicts | undefined {
  if (/[{};]/.test(text)) return undefined;
  const parsed = kit.parse.parseValue(text);
  if (parsed.problems.length > 0) return undefined;
  const commas = parsed.values.filter((value) => value.type === 'comma').map((value) => value.place.offset);
  const parts = parsed.values.length === 0 ? [] : kit.parse.splitCommas(parsed.values);
  const media = kit.media.parseMediaPrelude(parsed.values);
  // A problem belongs to the part that holds its place: the commas before it count the parts before it.
  const partOf = (problem: Media.MediaProblem): number =>
    commas.filter((offset) => offset < problem.place.offset).length;
  return {
    media: parts.map((_, index) => verdictOf(media.problems.filter((problem) => partOf(problem) === index))),
    notAll: parts.map((part) => kit.parse.serialize(part).toLowerCase().split(/\s+/).join(' ') === 'not all'),
    container: verdictOf(kit.media.parseContainerPrelude(parsed.values).problems),
  };
}

/** The largest finite 32-bit float. Chromium writes a larger number of a condition as this. */
const MAX_FLOAT = 3.4028234663852886e38;

/**
 * A number as Chromium writes it in the `conditionText` of a container rule: a 32-bit float with 6 significant
 * digits (`48.123456rem` is `48.1235rem`, `7654321px` is `7.65432e+06px`, `1e39px` is `3.40282e+38px`).
 */
function chromiumNumber(text: string): string {
  const single = Math.fround(Number(text));
  const finite = Number.isFinite(single) ? single : Math.sign(single) * MAX_FLOAT;
  return String(Number(finite.toPrecision(6)));
}

/** A text of a condition with no white space, no comments, in lower case, and each number as Chromium keeps it. */
function plainCondition(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, '')
    .toLowerCase()
    .replace(/(?<![\w-])[+-]?(?:\d*\.\d+|\d+)(?:e[+-]?\d+)?/g, chromiumNumber);
}

/** The gaps between the kit and Chromium for preludes. */
function preludeGaps(
  texts: readonly string[],
  verdicts: readonly (PreludeVerdicts | undefined)[],
  judgements: readonly PreludeJudgement[],
): string[] {
  const gaps: string[] = [];
  texts.forEach((text, index) => {
    const verdict = verdicts[index];
    const judgement = judgements[index];
    if (verdict === undefined || judgement === undefined) return;
    const queries = judgement.media;
    if (queries === null || queries.length !== verdict.media.length) {
      gaps.push(
        `@media \`${text}\`: the kit reads ${verdict.media.length} queries; Chromium: ${JSON.stringify(queries)}`,
      );
    } else {
      verdict.media.forEach((part, at) => {
        if (verdict.notAll[at]) return;
        const chromiumInvalid = queries[at] === 'not all';
        if (part === 'accepted' && chromiumInvalid)
          gaps.push(`@media \`${text}\`: the kit accepts query ${at + 1}; Chromium: not all`);
        if (part === 'invalid' && !chromiumInvalid) {
          gaps.push(`@media \`${text}\`: the kit calls query ${at + 1} invalid; Chromium: ${queries[at]}`);
        }
      });
    }
    const condition = judgement.container;
    if (
      verdict.container === 'accepted' &&
      (condition === null || plainCondition(condition) !== plainCondition(text))
    ) {
      gaps.push(`@container \`${text}\`: the kit accepts it; Chromium: ${condition === null ? 'dropped' : condition}`);
    }
    if (verdict.container === 'invalid' && condition !== null) {
      gaps.push(`@container \`${text}\`: the kit calls it invalid; Chromium keeps ${condition}`);
    }
  });
  return gaps;
}

/** Seeds that the unit tests do not have. */
const PRELUDE_SEEDS: readonly string[] = [
  'screen',
  'print',
  'all',
  'not print',
  'only screen',
  'screen and (hover)',
  'not screen and (hover: hover)',
  '(width >= 48rem)',
  '(width>=48rem)',
  '(48rem <= width < 60rem)',
  '(min-width: 48rem)',
  '(max-width:47.99rem)',
  '(prefers-color-scheme: dark)',
  '(prefers-contrast: more)',
  '(forced-colors: active)',
  '(prefers-reduced-motion: reduce)',
  '(hover) and (pointer: fine)',
  '(hover) or (pointer: coarse)',
  'not (hover)',
  '((hover) and (pointer: fine))',
  '(not (hover)) and (width > 0)',
  'screen, print',
  '(orientation: portrait), (orientation: landscape)',
  '(inline-size > 30rem)',
  '(30rem < inline-size)',
  '(block-size <= 20rem)',
  '(aspect-ratio > 1/2)',
  '(resolution >= 2x)',
  'card (inline-size > 30rem)',
  'style(--x: 1)',
  '(width > var(--x))',
  '(width > calc(1rem + 1px))',
  'tv',
  'layer',
  'none',
  '(width >= 48rem) and (width < 60rem)',
  'not (width < 1px) and (hover)',
  '(1px < width)',
  '(width = 1px)',
  '(width: 0)',
  '(min-width: 0)',
  '(orientation)',
  'not all and (hover)',
  'only all',
  'SCREEN AND (HOVER)',
  '(prefers-color-scheme)',
  '(scripting: enabled)',
  '(width > 1px) , (hover)',
  '( ( (hover) ) )',
  'not ((hover) or (pointer))',
  '(width>=48rem)and (hover)',
  '(hover)and(pointer)',
  'screen and not (hover)',
  'not screen, print',
];

const PRELUDE_WORDS: readonly string[] = [
  'and',
  'or',
  'not',
  'only',
  'all',
  'screen',
  'print',
  'tv',
  'width',
  'min-width',
  'max-width',
  'inline-size',
  'block-size',
  'aspect-ratio',
  'resolution',
  'orientation',
  'hover',
  'pointer',
  'any-hover',
  'color',
  'monochrome',
  'display-mode',
  'none',
  'active',
  'dark',
  'more',
  'style',
  'scroll-state',
  'constructor',
  '__proto__',
];

const PRELUDE_INSERTS: readonly string[] = [
  ' ',
  ' and ',
  ' or ',
  'not ',
  'only ',
  ',',
  '(',
  ')',
  ':',
  '<',
  '>',
  '=',
  '<=',
  '>=',
  '/',
  '0',
  '1px',
  '48rem',
  '-',
  '.',
  'var(--x)',
  'calc(',
  '"x"',
  '!',
  '@',
];

const PRELUDE_NUMBERS: readonly string[] = [
  '0',
  '1',
  '-1',
  '0.5',
  '.5',
  '48rem',
  '48REM',
  '768px',
  '1e2px',
  '2x',
  '1/2',
  '30em',
  '1foo',
];

const PRELUDE_WRAPPERS: readonly string[] = [
  '($)',
  'not ($)',
  '($) and (hover)',
  '(hover) or ($)',
  'screen and ($)',
  'only screen and $',
  'not $',
  '$, print',
  'print, $',
  '$ and (width > 0)',
  'card $',
];

/** The candidates of the prelude parser and the kit's verdicts. */
function preludeCandidates(kit: Kit): { texts: string[]; verdicts: (PreludeVerdicts | undefined)[] } {
  const seeds = [...literalsOf('css-media.test.ts'), ...PRELUDE_SEEDS, ...sitePreludes(kit)];
  const grammar: Grammar = {
    words: [...kit.mediaWords, ...PRELUDE_WORDS],
    numbers: PRELUDE_NUMBERS,
    inserts: PRELUDE_INSERTS,
    wrappers: PRELUDE_WRAPPERS,
    longest: 160,
  };
  const accepts = (text: string): boolean => {
    const verdicts = preludeVerdicts(kit, text);
    return (
      verdicts !== undefined &&
      (verdicts.container === 'accepted' || verdicts.media.every((part) => part === 'accepted'))
    );
  };
  const texts = candidatesOf(seeds, grammar, accepts, { seed: 0x3ed1a, perSeed: 6, rounds: 3, fewest: PRELUDE_FEWEST });
  return { texts, verdicts: texts.map((text) => preludeVerdicts(kit, text)) };
}

/** Every `@media` and `@container` prelude of the CSS of the test site, as text. */
function sitePreludes(kit: Kit): string[] {
  const out = new Set<string>();
  for (const text of siteTexts()) {
    kit.parse.walk(kit.parse.parseCss(text.css, text.name), (node) => {
      if (node.type === 'at-rule' && (node.name === 'media' || node.name === 'container')) {
        out.add(kit.parse.serialize(node.prelude));
      }
    });
  }
  return [...out];
}

/** The candidates that the prelude part wants at least. */
const PRELUDE_FEWEST = 4000;

// 4. Style sheets

/** The kinds of a component value, for the rule of CSS Syntax Level 3 (section 9) about comments between tokens. */
function kindOf(value: Parse.ComponentValue): string {
  if (value.type === 'function') return 'function';
  if (value.type === 'block') return value.open;
  if (value.type === 'delim') return `delim${value.value}`;
  return value.type;
}

const NAMES_AND_NUMBERS = ['ident', 'function', 'url', 'delim-', 'number', 'percentage', 'dimension', 'cdc'];

/** For each kind of token, the kinds after it that need a comment between the two (CSS Syntax Level 3, 9.2). */
const NEEDS_COMMENT: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ['ident', new Set([...NAMES_AND_NUMBERS, '('])],
  ['at-keyword', new Set(NAMES_AND_NUMBERS)],
  ['hash', new Set(NAMES_AND_NUMBERS)],
  ['dimension', new Set(NAMES_AND_NUMBERS)],
  ['delim#', new Set(NAMES_AND_NUMBERS.filter((kind) => kind !== 'cdc'))],
  ['delim-', new Set(NAMES_AND_NUMBERS.filter((kind) => kind !== 'cdc'))],
  ['number', new Set(['ident', 'function', 'url', 'number', 'percentage', 'dimension', 'delim%'])],
  ['delim@', new Set(['ident', 'function', 'url', 'delim-'])],
  ['delim.', new Set(['number', 'percentage', 'dimension'])],
  ['delim+', new Set(['number', 'percentage', 'dimension'])],
  ['delim/', new Set(['delim*'])],
]);

/**
 * The text of component values, as close to the original as CSS allows: each token as written, each run of white
 * space as written, and a comment `/**\/` between two tokens that would read as one without it. A string that a
 * newline ended keeps its newline, so that it ends at the same place.
 */
function textOf(values: readonly Parse.ComponentValue[], original: string, comments = true): string {
  let out = '';
  let last = '';
  for (const value of values) {
    const kind = kindOf(value);
    if (comments && NEEDS_COMMENT.get(last)?.has(kind)) out += '/**/';
    if (value.type === 'function') out += `${value.text}(${textOf(value.args, original)})`;
    else if (value.type === 'block') out += `${value.open}${textOf(value.values, original)}${CLOSERS.get(value.open)}`;
    else if (value.type === 'string' && /[\n\r\f]/.test(original.charAt(value.place.offset + value.text.length))) {
      out += `${value.text}\n`;
    } else if (
      value.place.offset + value.text.length === original.length &&
      /(?:^|[^\\])(?:\\\\)*\\$/.test(value.text)
    ) {
      // A backslash at the end of the text is U+FFFD. Here more text follows it, which it would escape.
      out += `${value.text.slice(0, -1)}\\fffd `;
    } else out += value.text;
    last = value.type === 'function' || value.type === 'block' ? ')' : kind;
  }
  return out;
}

const CLOSERS: ReadonlyMap<string, string> = new Map([
  ['(', ')'],
  ['[', ']'],
  ['{', '}'],
]);

/** A name as CSS writes an identifier: a character that is no name character gets a backslash. */
function identifier(name: string): string {
  let out = '';
  for (const char of name) {
    const code = char.codePointAt(0) ?? 0;
    const plain = code >= 0x80 || /[\w-]/.test(char);
    out += plain ? char : `\\${code.toString(16)} `;
  }
  return out;
}

/** The kit's tree as CSS text: each node as the kit read it. */
function treeText(nodes: readonly Parse.CssNode[], original: string): string {
  let out = '';
  for (const node of nodes) {
    if (node.type === 'declaration') {
      // A browser reads `unicode-range` from its text, where `U+0-7F` is one range. It takes no comment.
      const value = textOf(node.value, original, node.property !== 'unicode-range');
      out += `${identifier(node.property)}:${value}${node.important ? '!important' : ''};`;
    } else if (node.type === 'rule') {
      out += `${textOf(node.prelude, original)}{${treeText(node.children, original)}}`;
    } else {
      const prelude = node.prelude.length > 0 ? ` ${textOf(node.prelude, original)}` : '';
      out += `@${identifier(node.name)}${prelude}${node.block === undefined ? ';' : `{${treeText(node.block, original)}}`}`;
    }
  }
  return out;
}

/** The rules and at-rules of a tree, nested ones included. */
function nodeCount(nodes: readonly Parse.CssNode[]): number {
  let count = 0;
  for (const node of nodes) {
    if (node.type === 'rule') count += 1 + nodeCount(node.children);
    else if (node.type === 'at-rule') count += 1 + nodeCount(node.block ?? []);
  }
  return count;
}

/**
 * The places where the kit's tree breaks a rule of CSS Syntax Level 3: a declaration value with a `;` at its top
 * level, a value of a property that is no custom property with a `{}` block and more, or a prelude with a `{}`
 * block. Written out again, such a tree would hide a wrong split, because Chromium would split the text once more.
 */
function treeFaults(nodes: readonly Parse.CssNode[]): string[] {
  const faults: string[] = [];
  const has = (values: readonly Parse.ComponentValue[], which: (value: Parse.ComponentValue) => boolean): boolean =>
    values.some(which);
  const semicolon = (value: Parse.ComponentValue): boolean => value.type === 'semicolon';
  const brace = (value: Parse.ComponentValue): boolean => value.type === 'block' && value.open === '{';
  for (const node of nodes) {
    if (node.type === 'declaration') {
      if (has(node.value, semicolon)) faults.push(`a \`;\` in the value of ${node.property}`);
      // A `{}` block is the whole value of a property that is no custom property, or no value at all.
      const solid = node.value.filter((value) => value.type !== 'whitespace');
      if (!node.property.startsWith('--') && has(node.value, brace) && solid.length > 1) {
        faults.push(`a \`{}\` and more in the value of ${node.property}`);
      }
    } else if (node.type === 'rule') {
      if (has(node.prelude, brace)) faults.push('a `{}` in a rule prelude');
      faults.push(...treeFaults(node.children));
    } else {
      if (has(node.prelude, semicolon) || has(node.prelude, brace))
        faults.push(`a \`;\` or \`{}\` in the prelude of @${node.name}`);
      faults.push(...treeFaults(node.block ?? []));
    }
  }
  return faults;
}

/** What Chromium reads from a text: the `cssText` of its rules, and their number without nested declarations. */
interface SheetJudgement {
  text: string;
  rules: number;
}

/** Runs in the page: the CSSOM of each text. */
function sheetsInPage(list: string[]): SheetJudgement[] {
  const count = (rules: CSSRuleList): number => {
    let total = 0;
    for (const rule of rules) {
      if (rule.constructor.name !== 'CSSNestedDeclarations') total += 1;
      if ('cssRules' in rule && rule.cssRules instanceof CSSRuleList) total += count(rule.cssRules);
    }
    return total;
  };
  const sheet = new CSSStyleSheet();
  return list.map((text) => {
    sheet.replaceSync(text);
    return { text: Array.from(sheet.cssRules, (rule) => rule.cssText).join('\n'), rules: count(sheet.cssRules) };
  });
}

/** One style sheet of the test: its name, its text and the kit's tree written out again. */
interface SheetCase {
  name: string;
  css: string;
  written: string;
  faults: string[];
  nodes: number;
  /** True when the text has a quirk of Chromium (`quirkOf`). The test does not compare it. */
  quirk: boolean;
  /**
   * True when the kit says that the end of the text closes a string, a comment, a `url(`, a bracket or a block.
   * Chromium keeps such an open end as it is in the text of a custom property or a value with `var()`, but the
   * written tree must close it to go on. So the test does not compare such a text. `closedText` gives the mutants
   * an end that closes nothing, so few texts are open.
   */
  open: boolean;
}

/**
 * The quirks of Chromium 153 that CSS Syntax Level 3 does not have, in a block of declarations and rules. The kit
 * reads such a text as CSS Syntax does, so the test does not compare it and counts it:
 * - a nested rule whose prelude starts with a function, `x() .c {}`: Chromium skips it and the text after it up to
 *   the next `;`;
 * - a nested rule whose prelude is a name, a colon and a function, `inline-size: var(--s) {…}`: Chromium keeps
 *   `inline-size:var(--s){…}` as one declaration;
 * - a declaration of a property that is no custom property with a `{}` block as its value: Chromium drops it when
 *   white space follows the block.
 */
function quirkOf(nodes: readonly Parse.CssNode[], nested: boolean): boolean {
  return nodes.some((node) => {
    if (node.type === 'declaration') {
      return (
        !node.property.startsWith('--') && node.value.some((value) => value.type === 'block' && value.open === '{')
      );
    }
    if (node.type === 'at-rule') return quirkOf(node.block ?? [], nested || node.name === 'scope');
    const solid = node.prelude.filter((value) => value.type !== 'whitespace');
    const first = solid[0];
    const declarationLike = first?.type === 'ident' && solid[1]?.type === 'colon' && solid.at(-1)?.type === 'function';
    if (nested && (first?.type === 'function' || declarationLike)) return true;
    return quirkOf(node.children, true);
  });
}

/** A problem of an open end: something that the end of the text closes. */
const OPEN_END = /without its (?!opening)/;

/**
 * The text with an end that closes nothing: for each string, comment, `url(` and bracket that the kit says the end
 * closes, the innermost first, its closing quote, `*\/` or bracket. The kit only shapes the input here: the text with
 * its new end is the text that both sides read.
 */
function closedText(kit: Kit, css: string): string {
  const open = kit.parse
    .parseCss(css, 'open.css')
    .problems.filter((problem) => OPEN_END.test(problem.message))
    .sort((a, b) => b.place.offset - a.place.offset);
  let tail = '';
  for (const problem of open) {
    if (problem.message.endsWith('closing quote')) tail += css.charAt(problem.place.offset);
    else if (problem.message.endsWith('`*/`')) tail += '*/';
    else tail += /`(.)`$/.exec(problem.message)?.[1] ?? '';
  }
  return css + tail;
}

function sheetCase(kit: Kit, name: string, css: string): SheetCase {
  const sheet = kit.parse.parseCss(css, name);
  return {
    name,
    css,
    written: treeText(sheet.nodes, css),
    faults: treeFaults(sheet.nodes),
    nodes: nodeCount(sheet.nodes),
    open: sheet.problems.some((problem) => OPEN_END.test(problem.message)),
    quirk: quirkOf(sheet.nodes, false),
  };
}

/**
 * A text as a browser reads it from a file: decoding drops a byte order mark at the start (CSS Syntax Level 3, 3.2).
 * `replaceSync` takes a string that no decoding touched, so the test drops the mark for Chromium, as the kit does.
 */
const decoded = (css: string): string => (css.startsWith('\uFEFF') ? css.slice(1) : css);

/** What Chromium reads from each case: the original text and the kit's tree written out again. */
async function sheetJudgements(
  cases: readonly SheetCase[],
): Promise<{ original: SheetJudgement; written: SheetJudgement }[]> {
  const texts = cases.flatMap((each) => [decoded(each.css), each.written]);
  const judged = await (await thePage()).evaluate(sheetsInPage, texts);
  return cases.map((_, index) => ({
    original: judged[2 * index] ?? { text: '', rules: -1 },
    written: judged[2 * index + 1] ?? { text: '', rules: -1 },
  }));
}

/** The cases where the kit's tree and Chromium's tree differ, or where the kit's tree breaks its own rules. */
function sheetGaps(
  cases: readonly SheetCase[],
  judgements: readonly { original: SheetJudgement; written: SheetJudgement }[],
): string[] {
  const gaps: string[] = [];
  cases.forEach((each, index) => {
    const judgement = judgements[index];
    if (judgement === undefined) return;
    if (each.faults.length > 0) gaps.push(`${each.name}: ${each.faults.join('; ')}`);
    const original = withoutComments(judgement.original.text);
    const written = withoutComments(judgement.written.text);
    if (!each.open && !each.quirk && original !== written) {
      const at = firstDifference(original, written);
      gaps.push(
        `${each.name}: ${JSON.stringify(each.css.slice(0, 300))}\n  Chromium: ${JSON.stringify(original.slice(at - 40, at + 80))}\n  the kit:  ${JSON.stringify(written.slice(at - 40, at + 80))}`,
      );
    }
  });
  return gaps;
}

/**
 * A `cssText` without comments. Chromium keeps the text of a custom property and of a value with `var()` as
 * written, comments too. The kit's tokens keep a comment only inside a run of white space.
 */
const withoutComments = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, '');

function firstDifference(a: string, b: string): number {
  let index = 0;
  while (index < a.length && a[index] === b[index]) index += 1;
  return Math.max(index, 40);
}

/** Pieces that a mutation puts into a style sheet. */
const SHEET_INSERTS: readonly string[] = [
  '{',
  '}',
  ';',
  ':',
  '(',
  ')',
  '[',
  ']',
  '"',
  "'",
  ',',
  '@',
  '&',
  '/*',
  '*/',
  '\\',
  '!',
  '!important',
  '\n',
  ' ',
  '<!--',
  '-->',
  'color:red;',
  'a{}',
  '.x{color:red}',
  '&:hover{color:red}',
  '> .y{margin:0}',
  '@media (width>=48rem){',
  '@media screen{.z{color:blue}}',
  '@layer a;',
  '@layer b{',
  '@supports (display:grid){',
  '@keyframes k{from{opacity:0}to{opacity:1}}',
  '@font-face{font-family:x}',
  '@starting-style{',
  '@container (inline-size>1px){',
  '@foo bar;',
  '@foo{a:b}',
  '--x:{a;b};',
  '--y: ;',
  'url(a b)',
  'url(x',
  '"open',
  '\u0000',
  '\u000b',
  ' ',
  '\r\n',
  'foo;',
  ' b:c{} ',
  'b:hover{color:red}',
  '--z:{};',
  'color:{x};',
  'color:red{}',
  'color: red .b{}',
  '@page{margin:0}',
  '@property --p{syntax:"*";inherits:false}',
  '@scope (.a){',
  '@counter-style c{system:cyclic}',
  '@font-feature-values F{@swash{a:1}}',
  '@import url(x.css);',
  '@namespace svg url(x);',
  '@charset "x";',
  'unicode-range:U+0-7F;',
  '!ie',
  '! important',
  '!IMPORTANT',
  '\\7d',
  ';',
  'url( a )',
  '#{',
  '&{',
  '@media{',
  '@layer{',
  '@layer x.y;',
  '@supports selector(:has(a)){',
  '@starting-style{opacity:0}',
];

/** The style sheets of the test: the site's texts, the CSS of the parse unit test, and mutations of all of them. */
function sheetCases(kit: Kit): SheetCase[] {
  const random = seeded(0xc55);
  const texts = siteTexts();
  const units = literalsOf('css-parse.test.ts').filter((text) => /[{};]/.test(text));
  const cases: SheetCase[] = [
    ...texts.map((text) => sheetCase(kit, text.name, text.css)),
    ...units.map((text, index) => sheetCase(kit, `css-parse.test.ts #${index + 1}`, closedText(kit, text))),
  ];
  const bases = [...units, ...texts.flatMap((text) => chunksOf(text.css, random))];
  for (let index = 0; cases.length < SHEET_FEWEST; index += 1) {
    const text = pick(bases, random);
    cases.push(sheetCase(kit, `mutant #${index + 1}`, closedText(kit, mutateSheet(text, random))));
  }
  return cases;
}

/**
 * Pieces of a text of about 100 to 1500 characters. A piece starts at any place, so the cut is a mutation too, and
 * it ends after a `}`, so that the end of the text closes nothing in most pieces.
 */
function chunksOf(css: string, random: Random): string[] {
  const out: string[] = [];
  for (let start = 0; start < css.length; ) {
    const length = 100 + Math.floor(random() * 1400);
    const end = css.indexOf('}', start + length);
    out.push(css.slice(start, end < 0 ? css.length : end + 1));
    start += Math.floor(length * (0.5 + random() / 2));
  }
  return out;
}

/** One to three edits: a character removed, a piece put in, or a part repeated. */
function mutateSheet(text: string, random: Random): string {
  let out = text;
  const edits = 1 + Math.floor(random() * 3);
  for (let edit = 0; edit < edits; edit += 1) {
    const at = Math.floor(random() * (out.length + 1));
    const roll = random();
    if (roll < 0.35) out = `${out.slice(0, at)}${out.slice(at + 1)}`;
    else if (roll < 0.85) out = `${out.slice(0, at)}${pick(SHEET_INSERTS, random)}${out.slice(at)}`;
    else out = `${out.slice(0, at)}${out.slice(at, at + 40)}${out.slice(at)}`;
  }
  return out;
}

/** The style sheets that the style sheet part wants at least. */
const SHEET_FEWEST = 3000;

// 5. Nesting

/**
 * Child selectors of a nested rule, with `X` and `Y` for a random compound, `C` for a compound that starts with
 * a class and `T` for a type (`&C` is CSS, `&T` is not). `&` stands in every place: at the start, in the middle, at the end, after a
 * combinator, inside `:is()`, `:not()`, `:where()` and `:has()`, twice, and not at all.
 */
const NEST_TEMPLATES: readonly string[] = [
  '&',
  '& X',
  'X &',
  '& > X',
  '&C',
  'X&',
  'X',
  '> X',
  '+ X',
  '~ X',
  '> &',
  '+ &',
  '~ &',
  '+ X &',
  '> X &',
  '~ X > &',
  ':is(&) X',
  ':not(&) X',
  ':where(&) > X',
  'X:has(> &)',
  'X:has(+ &)',
  'X:not(&)',
  'X :is(& Y)',
  '& + &',
  '& &',
  '& ~ X &',
  '&:is(X)',
  '&:not(X) Y',
  'X, & Y',
  '> X, + Y',
  '+ &, & > X',
  // CSS refuses a type after `&`, and `:has()` inside `:has()`.
  '&T',
  '&X',
  'X:has(:has(&))',
  ':nth-child(2n+1 of &)',
  'X:not(& Y)',
  ':has(+ &) ~ X',
];

/**
 * A small compound of the fixture, so that many nested rules match a target: a type, a class, both, or a plain
 * pseudo-class, and now and then a compound of `fixtureCompound` with ids, attributes and functional pseudo-classes.
 */
function nestCompound(random: Random): string {
  const roll = random();
  if (roll < 0.25) return pick(S_TYPES, random);
  if (roll < 0.55) return `.${pick(S_CLASSES, random)}`;
  if (roll < 0.7) return `${pick(S_TYPES, random)}.${pick(S_CLASSES, random)}`;
  if (roll < 0.8) return pick(S_PLAIN, random);
  return fixtureCompound(random, 1);
}

/** A small complex selector: one or two compounds. */
const nestComplex = (random: Random): string =>
  random() < 0.6
    ? nestCompound(random)
    : `${nestCompound(random)}${pick([' ', ' > ', ' + ', ' ~ '], random)}${nestCompound(random)}`;

/** A child selector from a template: `X` and `Y` a small compound, `C` one that starts with a class, `T` a type. */
function nestedChild(random: Random): string {
  return pick(NEST_TEMPLATES, random)
    .replaceAll('C', () => `.${pick(S_CLASSES, random)}${random() < 0.3 ? pick(S_PLAIN, random) : ''}`)
    .replaceAll('T', () => pick(S_TYPES, random))
    .replaceAll('X', () => nestCompound(random))
    .replaceAll('Y', () => nestCompound(random));
}

/** A nested text: a parent list of 1 to 3 selectors, maybe a middle rule, and the rule that sets `name`. */
function nestedText(random: Random, name: string): string {
  const parents = Array.from({ length: 1 + Math.floor(random() * 3) }, () => nestComplex(random)).join(', ');
  const inner = `${nestedChild(random)}{${name}:1}`;
  return random() < 0.3 ? `${parents}{${nestedChild(random)}{${inner}}}` : `${parents}{${inner}}`;
}

/**
 * What the kit says about the rule that sets `name`: `accepted` with its resolved selectors as one list, when the
 * kit reads each of them; `invalid` when it calls one invalid (CSS drops a nested rule whose list has an invalid
 * selector); `undefined` for no claim (a parse problem, a selector the kit does not read, no resolved list).
 */
type NestingVerdict = { kind: 'accepted'; resolved: string } | { kind: 'invalid' } | undefined;

function nestingVerdict(kit: Kit, css: string, name: string): NestingVerdict {
  const sheet = kit.parse.parseCss(css, 'nesting.css');
  if (sheet.problems.length > 0) return undefined;
  let rule: Parse.Rule | undefined;
  kit.parse.walk(sheet, (node, context) => {
    if (node.type === 'declaration' && node.property === name) rule = context.rule;
  });
  if (rule === undefined || rule.resolved.length === 0) return undefined;
  const results = rule.resolved.map((values) => kit.selectors.parseSelector(values));
  if (results.some((result) => result.refusal === 'invalid')) return { kind: 'invalid' };
  if (results.some((result) => result.selector === undefined)) return undefined;
  return { kind: 'accepted', resolved: rule.resolved.map((values) => kit.parse.serialize(values)).join(', ') };
}

/** One nested case for Chromium: the text, the property that its nested rule sets, and the kit's resolved list. */
interface NestingProbe {
  css: string;
  name: string;
  resolved: string | undefined;
}

/** What Chromium says: the targets where the nested rule sets its property, and those of the kit's list. */
interface NestingJudgement {
  set: number[];
  /** `null` when `querySelectorAll` throws on the kit's list, or the kit has no list. */
  queried: number[] | null;
}

/**
 * Runs in the page: puts the fixture in, registers each property as not inherited (so only the elements that the
 * rule matches have it), and reads where each nested rule set its property, and what the kit's list matches.
 */
function nestingInPage(batch: { fixture: string; probes: NestingProbe[] }): NestingJudgement[] {
  document.body.innerHTML = batch.fixture;
  const targets = [document.documentElement, document.body, ...document.body.querySelectorAll('*')];
  for (const probe of batch.probes) {
    try {
      CSS.registerProperty({ name: probe.name, syntax: '*', inherits: false });
    } catch {
      // Registered by an earlier call: each name is new, so this does not happen.
    }
  }
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(batch.probes.map((probe) => probe.css).join('\n'));
  document.adoptedStyleSheets = [sheet];
  const computed = targets.map((element) => getComputedStyle(element));
  const judgements = batch.probes.map((probe) => {
    const set = targets.flatMap((_, index) =>
      computed[index]?.getPropertyValue(probe.name).trim() === '1' ? [index] : [],
    );
    let queried: number[] | null = null;
    if (probe.resolved !== undefined) {
      try {
        const matched = new Set(document.querySelectorAll(probe.resolved));
        queried = targets.flatMap((element, index) => (matched.has(element) ? [index] : []));
      } catch {
        queried = null;
      }
    }
    return { set, queried };
  });
  document.adoptedStyleSheets = [];
  return judgements;
}

/** The cases where the kit's resolved list and Chromium disagree. */
function nestingGaps(
  probes: readonly NestingProbe[],
  verdicts: readonly NestingVerdict[],
  judgements: readonly NestingJudgement[],
): string[] {
  const gaps: string[] = [];
  probes.forEach((probe, index) => {
    const verdict = verdicts[index];
    const judgement = judgements[index];
    if (verdict === undefined || judgement === undefined) return;
    const set = judgement.set.join(',');
    if (verdict.kind === 'invalid' && set !== '') {
      gaps.push(`\`${probe.css}\`: the kit calls a resolved selector invalid; Chromium sets the targets ${set}`);
    }
    if (verdict.kind === 'accepted' && (judgement.queried === null || judgement.queried.join(',') !== set)) {
      const kit = judgement.queried === null ? 'throws' : judgement.queried.join(',');
      gaps.push(`\`${probe.css}\` resolves to \`${verdict.resolved}\`: it matches ${kit}; the nested rule ${set}`);
    }
  });
  return gaps;
}

/** A new property name for each nested rule of the file: a registered name cannot be registered again. */
let nestingNames = 0;
const nestingName = (): string => {
  nestingNames += 1;
  return `--css-oracle-n${nestingNames}`;
};

/** The nested cases and the kit's verdicts. */
function nestingCases(kit: Kit): { probes: NestingProbe[]; verdicts: NestingVerdict[] } {
  const random = seeded(0x4e57);
  const probes: NestingProbe[] = [];
  const verdicts: NestingVerdict[] = [];
  const texts = new Set<string>();
  while (probes.length < NESTING_CASES) {
    const name = nestingName();
    const css = nestedText(random, name);
    if (texts.has(css)) continue;
    texts.add(css);
    const verdict = nestingVerdict(kit, css, name);
    verdicts.push(verdict);
    probes.push({ css, name, resolved: verdict?.kind === 'accepted' ? verdict.resolved : undefined });
  }
  return { probes, verdicts };
}

/** The nested cases that the nesting part wants. */
const NESTING_CASES = 4000;

// 6. Component shapes

/** The components of the shape part: `card` is the file's own, `box` another one. */
const SHAPE_OPTIONS = { components: new Set(['card', 'box']) };

/**
 * The fixed document of the shape part. Two roots of `card`, a `box` inside the first, part classes outside every
 * root, and an element after the roots. `roots` are the tags of the two roots, `box` the root class of `box`.
 */
const shapeFixture = (roots: readonly [string, string], box: string): string =>
  `<main id="m"><${roots[0]} class="card" id="c1"><p class="card__a" id="a1"><span class="card__b" id="b1">x</span>` +
  `<img id="i1" alt=""></p><div class="${box}" id="x1"><span class="${box}__a" id="xa1">y</span></div>` +
  `<span class="card__b" id="b2">z</span></${roots[0]}><p class="card__a" id="a2">w</p>` +
  `<${roots[1]} class="card card--wide" id="c2"><span class="card__a" id="a3"><img id="i2" alt=""></span></${roots[1]}>` +
  '<div id="out"><p id="op"><span class="card__b" id="b3">v</span></p></div></main>';

/** The tags of the roots in the fixture, and in the variant that changes them. */
const ROOT_TAGS: readonly [string, string] = ['div', 'section'];
const OTHER_ROOT_TAGS: readonly [string, string] = ['article', 'aside'];

/** Types that are no root tag: any place may hold them without making a selector depend on the tag of a root. */
const FREE_TYPES = ['p', 'span', 'img', '*'];
const SHAPE_PARTS = [
  '.card--wide',
  '.card__a',
  '.card__b',
  '.box',
  '.box__a',
  '[class~=box]',
  '[class~=card]',
  '[class="card__a"]',
  '[class^=box]',
  '[class*=card]',
  '[id]',
  ':first-child',
  ':last-child',
  ':hover',
];
const SHAPE_COMBINATORS = [' ', ' ', ' > ', ' + ', ' ~ '];

/**
 * The simple selectors of a compound after its type: classes, attributes and pseudo-classes. `types` are the types
 * that the arguments of its `:is()` and `:where()` may end in. A root tag stands only where it is a type of the
 * element itself; inside `:not()` and `:has()` and before the last compound of an argument only `FREE_TYPES` stand,
 * so the claim that a passing selector does not read the tag of a root holds.
 */
function shapeParts(random: Random, depth: number, types: readonly string[], most: number): string {
  let out = '';
  for (let index = Math.floor(random() * (most + 1)); index > 0; index -= 1) {
    if (random() < 0.75 || depth >= 2) out += pick(SHAPE_PARTS, random);
    else {
      const name = pick([':is', ':where', ':not', ':has'], random);
      const same = name === ':is' || name === ':where';
      out += `${name}(${shapeList(random, depth + 1, same ? types : FREE_TYPES, name === ':has')})`;
    }
  }
  return out;
}

/** A random compound: maybe one of `types`, and up to two more simple selectors. */
function shapeCompound(random: Random, depth: number, types: readonly string[]): string {
  const out = `${random() < 0.35 ? pick(types, random) : ''}${shapeParts(random, depth, types, 2)}`;
  return out === '' ? '*' : out;
}

/** A list of complex selectors for an argument: each ends in a compound of `types`, after compounds of free types. */
function shapeList(random: Random, depth: number, types: readonly string[], relative: boolean): string {
  return Array.from({ length: 1 + Math.floor(random() * 2) }, () => {
    let out = shapeCompound(random, depth, types);
    for (let index = Math.floor(random() * 2); index > 0; index -= 1) {
      out = `${shapeCompound(random, depth, FREE_TYPES)}${pick(SHAPE_COMBINATORS, random)}${out}`;
    }
    return relative && random() < 0.5 ? `${pick(['>', '+', '~'], random)} ${out}` : out;
  }).join(', ');
}

/** Every type of the generator: the root tags and the free types. */
const ALL_TYPES = [...ROOT_TAGS, ...FREE_TYPES];

/** A root compound: the root class with more, or a `:is()` or `:where()` of selectors that start at the root. */
function shapeRoot(random: Random): string {
  const roll = random();
  if (roll < 0.6) {
    const type = random() < 0.15 ? pick(ALL_TYPES, random) : '';
    return `${type}.card${shapeParts(random, 0, ALL_TYPES, 3)}`;
  }
  const name = roll < 0.8 ? ':is' : ':where';
  const items = Array.from({ length: 1 + Math.floor(random() * 2) }, () => {
    let out = `.card${random() < 0.3 ? pick(SHAPE_PARTS, random) : ''}`;
    for (let index = Math.floor(random() * 2); index >= 0; index -= 1) {
      out += `${pick(SHAPE_COMBINATORS, random)}${shapeCompound(random, 1, ALL_TYPES)}`;
    }
    return out;
  });
  return `${name}(${items.join(', ')})${shapeParts(random, 0, ALL_TYPES, 1)}`;
}

/** A random selector of a component file: a root compound and up to two later compounds. */
function shapeSelector(random: Random): string {
  let out = shapeRoot(random);
  for (let index = Math.floor(random() * 3); index > 0; index -= 1) {
    out += `${pick(SHAPE_COMBINATORS, random)}${shapeCompound(random, 0, ALL_TYPES)}`;
  }
  return out;
}

/** What Chromium matches with one selector in the fixture and in its two variants, as ids. */
interface ShapeJudgement {
  valid: boolean;
  /** The ids in the fixture. */
  plain: string[];
  /** The ids of the matched elements that stand in no root of `card`. */
  outside: string[];
  /** The ids when the roots have other tags. */
  tags: string[];
  /** The ids when `box` has another class name. */
  renamed: string[];
}

/** Runs in the page: the three documents, and for each selector the ids that it matches in each. */
function shapesInPage(batch: { fixtures: string[]; selectors: string[] }): ShapeJudgement[] {
  const results = batch.selectors.map(() => ({ valid: true, plain: [''], outside: [''], tags: [''], renamed: [''] }));
  batch.fixtures.forEach((fixture, which) => {
    document.body.innerHTML = fixture;
    batch.selectors.forEach((text, index) => {
      const result = results[index];
      if (result === undefined) return;
      let matched: Element[] = [];
      try {
        matched = [...document.querySelectorAll(text)];
      } catch {
        result.valid = false;
      }
      const ids = matched.map((element) => element.id);
      if (which === 0) {
        result.plain = ids;
        result.outside = matched.filter((element) => element.closest('.card') === null).map((element) => element.id);
      } else if (which === 1) result.tags = ids;
      else result.renamed = ids;
    });
  });
  return results;
}

/** The selectors that pass `shapeProblems` and still read what a component must not (7.1): each one a gap. */
function shapeGaps(
  texts: readonly string[],
  passes: readonly boolean[],
  judgements: readonly ShapeJudgement[],
): string[] {
  const gaps: string[] = [];
  texts.forEach((text, index) => {
    const judgement = judgements[index];
    if (passes[index] !== true || judgement === undefined || !judgement.valid) return;
    const plain = judgement.plain.join(',');
    if (judgement.outside.length > 0) {
      gaps.push(`\`${text}\` passes, but matches outside every root: ${judgement.outside.join(',')}`);
    }
    if (judgement.tags.join(',') !== plain) {
      gaps.push(`\`${text}\` passes, but reads the tag of a root: ${plain} and ${judgement.tags.join(',')}`);
    }
    if (judgement.renamed.join(',') !== plain) {
      gaps.push(`\`${text}\` passes, but reads a class of \`box\`: ${plain} and ${judgement.renamed.join(',')}`);
    }
  });
  return gaps;
}

/** Says whether the kit reads a selector and finds no shape problem in `card.css`. */
function passesShape(kit: Kit, text: string): boolean {
  const { selector } = kit.selectors.parseSelector(kit.parse.parseValue(text).values);
  if (selector === undefined) return false;
  return kit.selectors.shapeProblems(selector, { kind: 'component', component: 'card' }, SHAPE_OPTIONS).length === 0;
}

/** The three documents of the shape part. */
const SHAPE_FIXTURES = [
  shapeFixture(ROOT_TAGS, 'box'),
  shapeFixture(OTHER_ROOT_TAGS, 'box'),
  shapeFixture(ROOT_TAGS, 'other-box'),
];

/** The selectors that the shape part wants. */
const SHAPE_CANDIDATES = 20000;

// Controls

test('control: Chromium refuses a selector that is no CSS, and the comparison sees a kit that is wrong', async () => {
  const page = await thePage();
  const texts = ['a', '.a > b', ':is(:foo)', '.1', 'a::before:hover', ':global(.a)', '&'];
  const kit = await loadKit();
  const judgements = await page.evaluate(
    selectorsInPage,
    texts.map((text) => selectorProbe(kit, text)),
  );
  assert.deepEqual(
    judgements.map((judgement) => (valid(judgement) ? 'valid' : refused(judgement) ? 'refused' : 'forgiven')),
    ['valid', 'valid', 'forgiven', 'refused', 'refused', 'refused', 'valid'],
  );
  // A kit that accepts every selector, and one that calls every selector invalid, have gaps.
  assert.equal(
    selectorGaps(
      texts,
      texts.map(() => 'accepted'),
      judgements,
    ).length,
    4,
  );
  assert.equal(
    selectorGaps(
      texts,
      texts.map(() => 'invalid'),
      judgements,
    ).length,
    4,
  );
  assert.deepEqual(
    texts.map((text) => selectorVerdict(kit, text)),
    ['accepted', 'accepted', 'unread', 'invalid', 'unread', 'global', 'accepted'],
  );
  assert.deepEqual(
    selectorGaps(
      texts,
      texts.map((text) => selectorVerdict(kit, text) ?? 'unread'),
      judgements,
    ),
    [],
  );
});

test('control: the computed value shows the winner of two rules, and a wrong order of specificity has gaps', async () => {
  const page = await thePage();
  await page.evaluate(matchesInPage, { fixture: FIXTURE, selectors: [] });
  const pairs: Pair[] = [
    { first: '#t', second: '.card__link', target: 6 },
    { first: '.card__link', second: 'a', target: 6 },
    { first: 'a.card__link', second: '.card__text a', target: 6 },
    { first: ':where(#t)', second: 'a', target: 6 },
  ];
  const winners = await page.evaluate(winnersInPage, pairs);
  assert.deepEqual(winners, ['a', 'a', 'b', 'b']);
  const kit = await loadKit();
  const specificityOf = (text: string): Selectors.Specificity => {
    const { selector } = kit.selectors.parseSelector(kit.parse.parseValue(text).values);
    return selector === undefined ? [-1, -1, -1] : kit.selectors.specificity(selector);
  };
  assert.deepEqual(specificityGaps(pairs, winners, specificityOf, CASCADE), []);
  // The earlier rule winning a tie, and an order without ids, both disagree with Chromium.
  const earlier: Order = (first, second) => (greater(second, first) ? 'b' : 'a');
  const noIds: Order = (first, second) => CASCADE([0, first[1], first[2]], [0, second[1], second[2]]);
  assert.equal(specificityGaps(pairs, winners, specificityOf, earlier).length, 1);
  assert.equal(specificityGaps(pairs, winners, specificityOf, noIds).length, 1);
});

test('control: Chromium reads `not all` for an invalid query and drops an invalid container rule', async () => {
  const page = await thePage();
  const texts = ['(width >= 48rem)', 'only (hover)', 'screen, foo bar', '(foo: 1px)', 'card (width > 1px)', ''];
  const judgements = await page.evaluate(preludesInPage, texts);
  assert.deepEqual(
    judgements.map((judgement) => judgement.media),
    [['(width >= 48rem)'], ['not all'], ['screen', 'not all'], ['(foo: 1px)'], ['not all'], []],
  );
  assert.deepEqual(
    judgements.map((judgement) => judgement.container),
    ['(width >= 48rem)', 'only (hover)', null, '(foo: 1px)', 'card (width > 1px)', null],
  );
  const kit = await loadKit();
  const verdicts = texts.map((text) => preludeVerdicts(kit, text));
  assert.deepEqual(preludeGaps(texts, verdicts, judgements), []);
  // A kit that accepts every prelude has gaps, and so has one that calls every query and prelude invalid.
  const accepting = verdicts.map((verdict) =>
    verdict === undefined
      ? undefined
      : { ...verdict, media: verdict.media.map(() => 'accepted' as const), container: 'accepted' as const },
  );
  const refusing = verdicts.map((verdict) =>
    verdict === undefined
      ? undefined
      : { ...verdict, media: verdict.media.map(() => 'invalid' as const), container: 'invalid' as const },
  );
  assert.equal(preludeGaps(texts, accepting, judgements).length, 5);
  assert.equal(preludeGaps(texts, refusing, judgements).length, 7);
});

test('control: the written tree gives the CSSOM of the text, and a tree with a lost or moved part does not', async () => {
  const kit = await loadKit();
  const css = '@layer a{.b{color:red;&:hover{color:blue}margin:0}@media (width>=1px){.c{--x:{a;b}}}}.d{}';
  const own = sheetCase(kit, 'control', css);
  // A tree that lost its last declaration, and one whose nested rule took the declaration after it.
  const lost = { ...own, written: own.written.replace('margin:0;', '') };
  const moved = { ...own, written: own.written.replace('color:blue;}margin:0;', 'color:blue;margin:0;}') };
  const cases = [own, lost, moved];
  const judgements = await sheetJudgements(cases);
  assert.equal(judgements[0]?.original.rules, 6);
  assert.equal(own.nodes, 6);
  assert.deepEqual(
    sheetGaps(cases, judgements).map((gap) => gap.slice(0, gap.indexOf(':'))),
    ['control', 'control'],
  );
});

test('control: a nested rule sets its property where it matches, and a wrong resolution has gaps', async () => {
  const kit = await loadKit();
  const texts = [
    '.list__item{+ &{NAME:1}}',
    '.card{> h2{NAME:1}}',
    '.card__link{.card__text &{NAME:1}}',
    '.card{&div{NAME:1}}',
  ];
  const probes: NestingProbe[] = [];
  const verdicts: NestingVerdict[] = [];
  for (const text of texts) {
    const name = nestingName();
    const css = text.replace('NAME', name);
    const verdict = nestingVerdict(kit, css, name);
    verdicts.push(verdict);
    probes.push({ css, name, resolved: verdict?.kind === 'accepted' ? verdict.resolved : undefined });
  }
  // One more probe of the first text with the resolution of a kit that ignores the leading `+`.
  const first = probes[0];
  assert.ok(first);
  probes.push({ ...first, resolved: '.list__item' });
  const page = await thePage();
  const judgements = await page.evaluate(nestingInPage, { fixture: FIXTURE, probes });
  assert.deepEqual(
    judgements.map((judgement) => judgement.set.length),
    [1, 1, 1, 0, 1],
  );
  assert.deepEqual(
    verdicts.map((verdict) => (verdict?.kind === 'accepted' ? verdict.resolved : verdict?.kind)),
    ['.list__item + .list__item', '.card > h2', '.card__text .card__link', 'invalid'],
  );
  assert.deepEqual(nestingGaps(probes.slice(0, 4), verdicts, judgements), []);
  // A kit that calls `+ &` invalid, and one that resolves it to the parent alone, both disagree with Chromium.
  assert.equal(nestingGaps(probes, [{ kind: 'invalid' }], judgements).length, 1);
  assert.equal(nestingGaps(probes, [...verdicts, { kind: 'accepted', resolved: '.list__item' }], judgements).length, 1);
});

test('control: Chromium shows a selector that leaves the root, reads a root tag or reads a class of `box`', async () => {
  const texts = ['.card .card__a', ':is(.card ~ div)', '.card:is(div)', '.card [class~=box]', '.card:has(+ p)'];
  const page = await thePage();
  const judgements = await page.evaluate(shapesInPage, { fixtures: SHAPE_FIXTURES, selectors: texts });
  assert.deepEqual(
    judgements.map((judgement) => judgement.plain.join(',')),
    ['a1,a3', 'out', 'c1', 'x1', 'c1'],
  );
  const kit = await loadKit();
  const passes = texts.map((text) => passesShape(kit, text));
  assert.deepEqual(passes, [true, false, false, false, true]);
  assert.deepEqual(shapeGaps(texts, passes, judgements), []);
  // A kit that passes every selector has a gap for each of the three.
  assert.equal(
    shapeGaps(
      texts,
      texts.map(() => true),
      judgements,
    ).length,
    3,
  );
});

// The differential checks

test('selectors: what the kit accepts Chromium accepts, and what the kit calls invalid Chromium refuses', async (t) => {
  const kit = await loadKit();
  const { texts, verdicts } = selectorCandidates(kit);
  const judged = texts.filter((_, index) => verdicts[index] !== undefined);
  const judgedVerdicts = verdicts.filter((verdict): verdict is SelectorVerdict => verdict !== undefined);
  const judgements = await (await thePage()).evaluate(
    selectorsInPage,
    judged.map((text) => selectorProbe(kit, text)),
  );
  const gaps = selectorGaps(judged, judgedVerdicts, judgements);
  const count = (verdict: SelectorVerdict): number => judgedVerdicts.filter((each) => each === verdict).length;
  const unread = judgements.filter((_, index) => judgedVerdicts[index] === 'unread');
  t.diagnostic(
    `selectors: ${texts.length} candidates, ${judged.length} judged, ${texts.length - judged.length} with a token problem`,
  );
  t.diagnostic(
    `selectors: the kit accepts ${count('accepted')}, ${count('global')} with :global(), invalid ${count('invalid')}, unread ${count('unread')}`,
  );
  t.diagnostic(
    `selectors: of the unread ones Chromium keeps ${unread.filter(valid).length}, forgives ${unread.filter((each) => !valid(each) && each.kept).length}, refuses ${unread.filter(refused).length}`,
  );
  t.diagnostic(`selectors: ${gaps.length} gaps`);
  assert.ok(texts.length >= SELECTOR_FEWEST, `${texts.length} candidates`);
  assert.ok(count('accepted') >= 1000 && count('invalid') >= 1000, 'too few accepted or invalid candidates');
  assert.deepEqual(gaps.slice(0, SHOWN), [], `${gaps.length} gaps`);
});

test('specificity: the kit orders two rules as Chromium does', async (t) => {
  const kit = await loadKit();
  const { generated, valid: count, pairs, winners, specificityOf } = await specificityCase(kit);
  const gaps = specificityGaps(pairs, winners, specificityOf, CASCADE);
  const ties = pairs.filter((pair) => {
    const first = specificityOf(pair.first);
    const second = specificityOf(pair.second);
    return !greater(first, second) && !greater(second, first);
  });
  t.diagnostic(`specificity: ${generated} selectors, ${count} valid and read by the kit, ${pairs.length} pairs`);
  t.diagnostic(`specificity: ${ties.length} pairs with equal specificity, ${gaps.length} gaps`);
  assert.ok(pairs.length >= PAIRS * 0.9, `${pairs.length} pairs`);
  assert.ok(ties.length >= 200, `${ties.length} ties`);
  assert.deepEqual(gaps.slice(0, SHOWN), [], `${gaps.length} gaps`);
});

test('preludes: what the kit accepts Chromium reads, and what the kit calls invalid Chromium refuses', async (t) => {
  const kit = await loadKit();
  const { texts, verdicts } = preludeCandidates(kit);
  const judged = texts.filter((_, index) => verdicts[index] !== undefined);
  const judgedVerdicts = verdicts.filter((verdict): verdict is PreludeVerdicts => verdict !== undefined);
  const judgements = await (await thePage()).evaluate(preludesInPage, judged);
  const gaps = preludeGaps(judged, judgedVerdicts, judgements);
  const parts = judgedVerdicts.flatMap((verdict) => verdict.media);
  const count = (list: readonly PreludeVerdict[], verdict: PreludeVerdict): number =>
    list.filter((each) => each === verdict).length;
  const containers = judgedVerdicts.map((verdict) => verdict.container);
  t.diagnostic(`preludes: ${texts.length} candidates, ${judged.length} judged`);
  t.diagnostic(
    `preludes: @media queries accepted ${count(parts, 'accepted')}, invalid ${count(parts, 'invalid')}, policy ${count(parts, 'policy')}`,
  );
  t.diagnostic(
    `preludes: @container accepted ${count(containers, 'accepted')}, invalid ${count(containers, 'invalid')}, policy ${count(containers, 'policy')}`,
  );
  t.diagnostic(`preludes: ${gaps.length} gaps`);
  assert.ok(texts.length >= PRELUDE_FEWEST, `${texts.length} candidates`);
  assert.ok(count(parts, 'accepted') >= 300 && count(parts, 'invalid') >= 300, 'too few accepted or invalid queries');
  assert.ok(count(containers, 'accepted') >= 300 && count(containers, 'invalid') >= 300, 'too few container preludes');
  assert.deepEqual(gaps.slice(0, SHOWN), [], `${gaps.length} gaps`);
});

test('style sheets: the kit reads every rule and declaration that Chromium reads', async (t) => {
  const kit = await loadKit();
  const cases = sheetCases(kit);
  const judgements = await sheetJudgements(cases);
  const gaps = sheetGaps(cases, judgements);
  const texts = siteTexts();
  // The texts of the site: Chromium keeps every rule, so the counts of rules are equal too.
  const counts = cases
    .slice(0, texts.length)
    .map((each, index) => [each.name, each.nodes, judgements[index]?.original.rules]);
  const rules = judgements.reduce((sum, judgement) => sum + judgement.original.rules, 0);
  const open = cases.filter((each) => each.open).length;
  const quirks = cases.filter((each) => each.quirk).length;
  t.diagnostic(
    `style sheets: ${cases.length} texts (${texts.length} of the site), not compared: ${open} with an open end, ${quirks} with a quirk of Chromium`,
  );
  t.diagnostic(`style sheets: ${rules} rules in Chromium, ${gaps.length} gaps`);
  assert.ok(cases.length >= SHEET_FEWEST, `${cases.length} texts`);
  // Every text of the site is compared: none has an open end or a quirk.
  assert.deepEqual(
    cases
      .slice(0, texts.length)
      .filter((each) => each.open || each.quirk)
      .map((each) => each.name),
    [],
  );
  assert.deepEqual(
    counts.filter(([, nodes, chromium]) => nodes !== chromium),
    [],
  );
  assert.deepEqual(gaps.slice(0, SHOWN), [], `${gaps.length} gaps`);
});

test('nesting: the resolved selectors of the kit match what Chromium matches with the nested rule', async (t) => {
  const kit = await loadKit();
  const { probes, verdicts } = nestingCases(kit);
  const judgements = await (await thePage()).evaluate(nestingInPage, { fixture: FIXTURE, probes });
  const gaps = nestingGaps(probes, verdicts, judgements);
  const accepted = verdicts.filter((verdict) => verdict?.kind === 'accepted').length;
  const invalid = verdicts.filter((verdict) => verdict?.kind === 'invalid').length;
  const matching = judgements.filter(
    (judgement, index) => verdicts[index]?.kind === 'accepted' && judgement.set.length > 0,
  ).length;
  const leading = probes.filter(
    (probe, index) => verdicts[index]?.kind === 'accepted' && /\{\s*[>+~][^{]*&/.test(probe.css),
  ).length;
  t.diagnostic(
    `nesting: ${probes.length} texts, the kit accepts ${accepted}, invalid ${invalid}, no claim ${probes.length - accepted - invalid}`,
  );
  t.diagnostic(`nesting: ${matching} accepted rules match a target, ${leading} start with a combinator and hold \`&\``);
  t.diagnostic(`nesting: ${gaps.length} gaps`);
  assert.ok(accepted >= 1000 && invalid >= 100, 'too few accepted or invalid nested rules');
  assert.ok(matching >= 300 && leading >= 50, 'too few nested rules that match, or that start with a combinator');
  assert.deepEqual(gaps.slice(0, SHOWN), [], `${gaps.length} gaps`);
});

test('component shapes: a selector that passes card.css stays in a root and reads no root tag and no class of `box`', async (t) => {
  const kit = await loadKit();
  const random = seeded(0x5a9e);
  const texts = [...new Set(Array.from({ length: SHAPE_CANDIDATES }, () => shapeSelector(random)))];
  const passes = texts.map((text) => passesShape(kit, text));
  const judgements = await (await thePage()).evaluate(shapesInPage, { fixtures: SHAPE_FIXTURES, selectors: texts });
  const gaps = shapeGaps(texts, passes, judgements);
  const passing = passes.filter(Boolean).length;
  // The selectors that the kit refuses and that a kit passing everything would let through: the generator reaches
  // the shapes that the claims are about.
  const caught = shapeGaps(
    texts,
    passes.map((pass) => !pass),
    judgements,
  ).length;
  t.diagnostic(`component shapes: ${texts.length} selectors, ${passing} pass card.css`);
  t.diagnostic(`component shapes: ${caught} refused selectors that would break a claim, ${gaps.length} gaps`);
  assert.ok(passing >= 500, `${passing} passing selectors`);
  assert.ok(caught >= 100, `${caught} refused selectors that would break a claim`);
  assert.deepEqual(gaps.slice(0, SHOWN), [], `${gaps.length} gaps`);
});

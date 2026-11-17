/**
 * The differential test of the token values (specification, 7.3, 7.4 and 7.7).
 *
 * The kit checks each value of `docs/design.md` with the rule `design-format`, and then writes it into `tokens.css`
 * as it is. So a value that the rule accepts must be valid CSS for the properties of its token family. This file
 * tests that promise against Chromium, for every family:
 *
 * 1. It makes many candidate values: the accepted and the refused values of the unit test, more seeds, and
 *    mutations of them from a generator with a fixed seed.
 * 2. The words of the candidates come from the kit under test: every word of the built grammar module stands at
 *    each kind of place of the accepted seeds, as a keyword, as a unit and as a function name. So a word that the
 *    grammar knows and CSS does not is a candidate, with no list of this file to keep in step.
 * 3. The packed kit says which candidates it accepts: `parseDesign` on a valid design document in which one row
 *    holds the candidate. A candidate is accepted when its row has no `design-format` finding.
 * 4. Each accepted candidate must pass four checks. Chromium makes the first three.
 *    - `var()` makes every declaration valid when it is parsed. So each `var(--…)` first becomes a literal value of
 *      the family that it names. Then the declaration must parse for every use of the family: each property that
 *      the table of 7.3 lists, and a calculation with the token where 7.3 allows one.
 *    - The value must stand in `tokens.css` as one custom property that has a value.
 *    - For some uses, the declaration with `var()` of that custom property must have an effect when the
 *      declaration with the value itself has one. A browser can drop a declaration after it put the value in.
 *    - Each `var()` in the value must name a token of the family that 7.4 allows at its place.
 *
 * The test asserts that no accepted candidate fails a check. It never asserts the other direction: the kit refuses
 * many values that are valid CSS, and that is by design.
 * Run: node --test test/acceptance/design-values.test.ts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, test } from 'node:test';
import type { TokenFamily } from '../../src/design/parse.ts';
import { ACCEPTED, REFUSED } from '../unit/design-values.ts';
import { type Browser, base, kitModule, launch, type Page } from './harness.ts';

// The kit

interface Finding {
  rule: string;
  where: string;
}
interface Report {
  findings: Finding[];
}
// The members of the built kit modules that this file uses. The exports map hides the modules (14.2).
interface ParseModule {
  parseDesign(text: string, report: Report): unknown;
  NAMED_COLORS: ReadonlySet<string>;
}
interface RegistryModule {
  Report: new () => Report;
}
interface Kit {
  parseDesign: ParseModule['parseDesign'];
  /** The named colors that the kit accepts. */
  colors: readonly string[];
  /** Every word of the grammar module, in lower case: its keywords, its units and its function names are among them. */
  words: readonly string[];
  Report: RegistryModule['Report'];
}

/** The module of the kit that holds the grammars. */
const GRAMMAR_MODULE = 'design/parse';

/** A word of CSS: a name, a unit or a function name. */
const CSS_WORD = /-{0,2}[a-z_][a-z0-9_-]*/gi;

/**
 * The words of a module text. The text is not parsed: a word of a comment or the name of a function is a word too,
 * and it does no harm as a candidate. The grammar compares a word in lower case, so a word with a capital letter
 * is no entry of its lists.
 */
function wordsOf(source: string): string[] {
  return [...new Set(source.match(CSS_WORD) ?? [])].filter((word) => word === word.toLowerCase());
}

let loaded: Promise<Kit> | undefined;

/** The packed kit of the base copy. */
function loadKit(): Promise<Kit> {
  loaded ??= (async () => {
    const { parseDesign, NAMED_COLORS } = await kitModule<ParseModule>(GRAMMAR_MODULE);
    const { Report } = await kitModule<RegistryModule>('registry');
    const file = join(base(), 'node_modules/@raess/astro-kit/dist', `${GRAMMAR_MODULE}.js`);
    return { parseDesign, colors: [...NAMED_COLORS], words: wordsOf(readFileSync(file, 'utf8')), Report };
  })();
  return loaded;
}

const RULE = 'design-format';
const DESIGN_FILE = 'docs/design.md';

const FAMILIES = Object.keys(ACCEPTED) as TokenFamily[];

/** The sections of 7.4 that hold tokens, each with its families (7.3). */
const SECTIONS: readonly (readonly [section: string, families: readonly TokenFamily[]])[] = [
  ['Color', ['color']],
  ['Typography', ['font', 'text', 'leading', 'weight', 'tracking']],
  ['Spacing', ['space']],
  ['Size', ['size']],
  ['Radius', ['radius']],
  ['Line', ['line']],
  ['Shadow', ['shadow']],
  ['Layer', ['z']],
  ['Motion', ['duration', 'ease']],
  ['Opacity', ['opacity']],
  ['Gradient', ['gradient']],
];

/**
 * The tokens of the design document, for each family. A candidate may name them with `var()`: they are the names
 * that the values of the unit test use.
 */
const TOKENS: Readonly<Record<TokenFamily, readonly (readonly [name: string, value: string])[]>> = {
  color: [
    ['--color-page', '#fbf7f0'],
    ['--color-text', '#2b2521'],
    ['--color-muted', '#55493f'],
  ],
  space: [['--space-2', '0.5rem']],
  size: [['--size-content', '38rem']],
  font: [['--font-body', 'system-ui, sans-serif']],
  text: [['--text-m', '1rem']],
  leading: [['--leading-m', '1.5']],
  weight: [['--weight-bold', '700']],
  tracking: [['--tracking-wide', '0.08em']],
  radius: [['--radius-m', '0.5rem']],
  line: [['--line-1', '1px']],
  shadow: [['--shadow-card', '0 1px 2px var(--color-muted)']],
  z: [['--z-menu', '10']],
  duration: [['--duration-fast', '150ms']],
  ease: [['--ease-out', 'cubic-bezier(0.16, 1, 0.3, 1)']],
  opacity: [['--opacity-half', '0.5']],
  gradient: [['--gradient-hero', 'linear-gradient(var(--color-page), var(--color-text))']],
};

const TOKEN_NAMES: readonly string[] = FAMILIES.flatMap((family) => TOKENS[family].map(([name]) => name));

/** The text of a valid `docs/design.md` with one more row for each value, and the line of the first such row. */
function designWith(family: TokenFamily, values: readonly string[]): { text: string; first: number } {
  const lines = ['# Design', '', '## Themes', '', '| Theme | Use |', '|---|---|', '| light | The one theme. |', ''];
  let first = 0;
  for (const [section, families] of SECTIONS) {
    lines.push(`## ${section}`, '', section === 'Color' ? '| Token | light | Use |' : '| Token | Value | Use |');
    lines.push('|---|---|---|');
    for (const other of families) {
      for (const [name, value] of TOKENS[other]) lines.push(`| ${name} | ${value} | A token. |`);
    }
    if (families.includes(family)) {
      first = lines.length + 1;
      for (const [index, value] of values.entries())
        lines.push(`| --${family}-probe-row-${index} | ${value} | Probe. |`);
    }
    lines.push('');
  }
  lines.push('## Breakpoints', '', '| Name | Width | Use |', '|---|---|---|', '');
  lines.push('## Contrast pairs', '', '| Foreground | Background | Role | For |', '|---|---|---|---|');
  lines.push('| --color-text | --color-page | text | body |', '');
  return { text: lines.join('\n'), first };
}

/** The rows of one document. A document with many rows is as good as many documents: a finding names its row. */
const ROWS = 400;

/**
 * Says for each value whether the kit accepts it: its row has no `design-format` finding. It throws when a finding
 * stands at another place, because then the document itself is not valid and the answer would mean nothing.
 */
function acceptedBy(kit: Kit, family: TokenFamily, values: readonly string[]): boolean[] {
  const answers: boolean[] = [];
  for (let start = 0; start < values.length; start += ROWS) {
    const rows = values.slice(start, start + ROWS);
    const { text, first } = designWith(family, rows);
    const report = new kit.Report();
    kit.parseDesign(text, report);
    const refused = new Set<number>();
    for (const finding of report.findings) {
      const line = Number(finding.where.slice(DESIGN_FILE.length + 1));
      const fits = finding.rule === RULE && finding.where.startsWith(`${DESIGN_FILE}:`);
      if (!fits || !(line >= first && line < first + rows.length)) {
        throw new Error(`a finding outside the probe rows of ${family}: ${JSON.stringify(finding)}`);
      }
      refused.add(line - first);
    }
    for (const index of rows.keys()) answers.push(!refused.has(index));
  }
  return answers;
}

// The candidates

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

/** At most `count` entries of the list, picked by `random`, in the order of the list. */
function sample<T>(list: readonly T[], count: number, random: Random): T[] {
  if (list.length <= count) return [...list];
  const picked = new Set<number>();
  while (picked.size < count) picked.add(Math.floor(random() * list.length));
  return list.filter((_, index) => picked.has(index));
}

/**
 * Every length unit of CSS, as a candidate of each family that takes a length. These have no mutations: a mutation
 * of another seed changes the unit too.
 */
const LENGTH_SEEDS: readonly string[] = `px rem em ex rex ch rch cap rcap ic ric lh rlh cm mm Q in pt pc
  vw vh vi vb vmin vmax svw svh svi svb svmin svmax lvw lvh lvi lvb lvmin lvmax dvw dvh dvi dvb dvmin dvmax
  cqw cqh cqi cqb cqmin cqmax`
  .split(/\s+/)
  .map((unit) => `1${unit}`);

/** Numbers and calculations in the forms that a tokenizer must read. */
const MATH_SEEDS: readonly string[] = [
  '+.5e-1rem',
  '1e3px',
  '1E3PX',
  '1e400px',
  '0e0',
  '00',
  '-0px',
  'calc(1rem*2)',
  'calc(1rem/2)',
  'calc(2*-1rem)',
  'calc(1 / 2 * 1rem)',
  'calc(1rem / 2 / 3)',
  'calc(1rem / 0)',
  'calc(1rem / (1 - 1))',
  'calc(1rem - 1px * 2)',
  'calc(-1 * (1rem))',
  'calc(+1rem)',
  'calc( 1rem )',
  'calc(1rem + +1rem)',
  'calc(1rem - (-1rem))',
  'calc(1px * 1e400)',
  'calc(1E3 * 1px)',
  'calc(.5 * 1rem)',
  'calc(0px)',
  'min(1rem,2rem)',
  'clamp(1rem,2vw,3rem)',
  'max(1rem, calc(2rem), min(3rem, 4rem))',
  'clamp(1rem, calc(1rem + 2 * (1vw - 1px)), max(3rem, 4vh))',
  // A sum of three or more terms on one level.
  'calc(1px + 2px + 3px)',
  'calc(1px - 2px + 3px - 4px)',
  'calc(1 + 1px + 1px)',
  'calc(1px + 1 + 1px)',
  'calc(1px + 1px + 1)',
  'calc(1px * 2 + 3px / 4 - 5px)',
  // A zero without a unit is a length only outside a calculation.
  '0',
  '-0',
  '0px',
];

/** More seeds than the unit test has, for the branches of each grammar. */
const SEEDS: Readonly<Record<TokenFamily, readonly string[]>> = {
  color: [
    '#000',
    '#FFFFFFFF',
    'rgb(255 255 255 / 0.5)',
    'rgb(100% 0% 0% / 50%)',
    'rgb(none none none)',
    'rgb(255, 0, 0, 50%)',
    'rgb(255,255,255)',
    'rgb( 0 0 0 )',
    'rgb(0 0 0/50%)',
    'rgb(0 0 0 /.5)',
    'rgb(1e2 0 0)',
    'rgb(1e400 0 0 / 1e400)',
    'rgb(+1 -1 .5)',
    'rgb(-10% 110% 0%)',
    'hsl(120 50% 50% / 50%)',
    'hsl(120, 50%, 50%)',
    'hsl(1rad 50% 50%)',
    'hsl(100grad 50% 50%)',
    'hsl(-120 -50% 150%)',
    'hsl(1e400 50% 50%)',
    'hwb(none none none)',
    'hwb(1e3 0% 0%)',
    'lab(50 40 -20)',
    'lab(-10 200 -200)',
    'lab(none none none / none)',
    'lch(50 60 30 / 0.5)',
    'lch(50% 60% 0.5turn)',
    'oklab(0.6 0.1 -0.1 / 50%)',
    'oklab(none none none)',
    'oklch(0.7 0.3 145)',
    'oklch(70% 0.3 none / 0.5)',
    'color(srgb 20% 40% 60%)',
    'color(srgb -1 2 0.5)',
    'color(srgb none 0.4 0.6 / none)',
    'color(xyz-d50 0.2 0.4 0.6 / 0.5)',
    'Transparent',
    'red',
  ],
  space: ['1rem', '0%', 'min(1rem)', 'max(5%, 1rem)', ...MATH_SEEDS],
  size: ['1rem', '4 / 3', '1/1', '0.5 / 2', '1e1 / 2', '+16 / +9', 'clamp(10rem, 50%, 40rem)', 'min(100%, 72rem)'],
  font: [
    'serif',
    'ui-serif, serif',
    '"A", "B"',
    'Iowan Old Style, Palatino',
    'monospace',
    'A B C, D',
    '"A" , serif',
    'a,b',
    'A  B',
    'a b c d e f',
    '_x, x_y, a-b, -a, x1',
    '""',
    "''",
    '"", serif',
    `"it's", 'a "b"'`,
    // A string may hold the text of a function. It is no function.
    '"var(--font-body)", "attr(x) env(y)"',
    'revert-rule',
    'Arial, revert-rule',
    'revert-layer Sans, serif',
  ],
  text: ['1rem', '0.875rem', 'max(1rem, 1vw)', 'calc(1rem + 0.5vw)', 'min(5vw, 3rem)', ...MATH_SEEDS],
  leading: ['1.15', '1e1', '+1.5', '1.5em', '1lh', '0%', '.5', '+0', '1E1', '0px', '1e400'],
  weight: ['100', '+400', '999', '550', '0400', '01000', '1000.0', 'Normal'],
  tracking: ['0.08em', '-1px', '1ch', '+0.5px', '-0', '0', '0px', '1e-2em', 'Normal'],
  radius: ['0.25rem', '62.5rem', 'calc(0.5rem + 2px)', 'min(1rem, 4%)', ...MATH_SEEDS],
  line: ['0.0625rem', '3px', 'calc(1px * 2)', 'max(1px, 0.0625rem)', ...MATH_SEEDS],
  shadow: [
    'None',
    '0 0',
    '0 0 0',
    '0 0 0 0',
    '0 0 -0',
    '0 0 -0px red',
    '0 0 1e400px',
    '0 0, 0 0',
    '0 0 0 0 inset',
    '0 0 #000 inset',
    '1px 2px 3px 4px #000',
    '#000 1px 2px',
    '#000 -1px -2px 3px',
    '#000-1px 2px',
    'inset #000 -1px 1px',
    '1px 1px#000',
    'inset 1px 2px #000',
    '#000 1px 2px inset',
    'inset #000 1px 2px',
    '1px 2px inset #000',
    '-1px -2px 3px #000',
    '1px 2px 3px -4px #000',
    '0 1px 2px transparent',
    '0 1px red',
    '0 1px 2px oklch(40% 0.1 250 / 50%)',
    '0 1px 2px var(--color-muted), inset 0 0 0 1px var(--color-text)',
    'calc(1px + 0.1em) max(1px, 2px) min(4px, 1em) clamp(1px, 2px, 3px) #000',
    '0 0 calc(-1px) 0 #000',
    '1px 1px 0 calc(1px) transparent',
    '0 1px 2px hsl(120, 50%, 50%)',
  ],
  z: ['1', '-10', '+0', '-0', '0010', '2147483647', '99999999999999999999'],
  duration: ['1s', '1e3ms', '+1s', '+.5s', '-0s', '0.0ms', '0.15s', '700ms', '1S', '1E3MS', '1e400s'],
  ease: [
    'steps(1)',
    'steps(01)',
    'steps(2, jump-none)',
    'steps(2 , jump-none)',
    'steps(3, jump-both)',
    'steps(4, jump-start)',
    'steps(4, end)',
    'steps(+4)',
    'steps(2147483648)',
    'steps(99999999999, jump-none)',
    'cubic-bezier(0, 0, 1, 1)',
    'cubic-bezier(0,0,1,1)',
    'cubic-bezier(1, 5, 0, -5)',
    'cubic-bezier(1e0, 1e400, 0, -1e400)',
    'cubic-bezier(0.16, 1, 0.3, 1)',
    'linear(0, 1)',
    'linear(0 0%, 0.5 50%, 1 100%)',
    'linear(0, 0.5 50%, 1)',
    'linear(0 0% 10%, 1)',
    'linear(0 0% 0%, 1)',
    'linear(-1, 2)',
    'linear(1e400, 0)',
    'linear(0, 1 1e400%)',
    'linear(0 -10%, 1 110%)',
    'Linear',
    'STEPS(2, START)',
  ],
  opacity: ['0.0', '1.0', '+1', '+.5', '1e0', '5e-1', '0.5%', '+50%', '100.0%', '1e2%', '0.5e1%'],
  gradient: [
    'linear-gradient(var(--color-page), var(--color-text))',
    'linear-gradient(0deg, var(--color-page), var(--color-text))',
    'linear-gradient(-45deg, var(--color-page), var(--color-text))',
    'linear-gradient(1e400deg, var(--color-page), var(--color-text))',
    'linear-gradient(0.25turn, var(--color-page), var(--color-text))',
    'linear-gradient(1rad, var(--color-page), var(--color-text))',
    'linear-gradient(100grad, var(--color-page), var(--color-text))',
    'linear-gradient(min(45deg, 0.1turn), var(--color-page), var(--color-text))',
    'linear-gradient(to top, var(--color-page), var(--color-text))',
    'linear-gradient(to left top, var(--color-page), var(--color-text))',
    'linear-gradient(to right bottom, var(--color-page) 10%, var(--color-text) 90%)',
    'linear-gradient(in srgb, var(--color-page), var(--color-text))',
    'linear-gradient(in hsl shorter hue, var(--color-page), var(--color-text))',
    'linear-gradient(in lch decreasing hue, var(--color-page), var(--color-text))',
    'linear-gradient(45deg in oklab, var(--color-page), var(--color-text))',
    'linear-gradient(in oklch .25turn, var(--color-page), var(--color-text))',
    'linear-gradient(in oklab to right, var(--color-page), var(--color-text))',
    'linear-gradient(to right in hsl increasing hue, var(--color-page), var(--color-text))',
    'linear-gradient(var(--color-page) 10px, var(--color-text) 2rem)',
    'linear-gradient(var(--color-page) 0% 50%, var(--color-text) 50% 100%)',
    'linear-gradient(var(--color-page) 0 0, var(--color-text) 0 0)',
    'linear-gradient(var(--color-page), var(--color-muted), var(--color-text))',
    'linear-gradient(var(--color-page), 25%, var(--color-muted), 75%, var(--color-text))',
    'linear-gradient(var(--color-page) -10%, var(--color-text) 110%)',
    'linear-gradient(var(--color-page) min(10%, 1rem), max(20%, 2rem), var(--color-text) clamp(1rem, 50%, 3rem))',
    'linear-gradient(10% var(--color-page), 90% var(--color-text))',
    'radial-gradient(var(--color-page), var(--color-text))',
    'radial-gradient(circle, var(--color-page), var(--color-text))',
    'radial-gradient(ellipse, var(--color-page), var(--color-text))',
    'radial-gradient(circle closest-corner, var(--color-page), var(--color-text))',
    'radial-gradient(farthest-side circle, var(--color-page), var(--color-text))',
    'radial-gradient(10rem, var(--color-page), var(--color-text))',
    'radial-gradient(circle 10rem, var(--color-page), var(--color-text))',
    'radial-gradient(circle 0, var(--color-page), var(--color-text))',
    'radial-gradient(circle -0px, var(--color-page), var(--color-text))',
    'radial-gradient(calc(1rem - 2rem), var(--color-page), var(--color-text))',
    'radial-gradient(10rem 5rem, var(--color-page), var(--color-text))',
    'radial-gradient(0 0, var(--color-page), var(--color-text))',
    'radial-gradient(ellipse 50% 25%, var(--color-page), var(--color-text))',
    'radial-gradient(ellipse 0 0 at 0 0, var(--color-page), var(--color-text))',
    'radial-gradient(calc(1px) calc(1%), var(--color-page), var(--color-text))',
    'radial-gradient(min(1rem, 2rem) max(1%, 2%) ellipse, var(--color-page), var(--color-text))',
    'radial-gradient(at center, var(--color-page), var(--color-text))',
    'radial-gradient(at left 10% top 20%, var(--color-page), var(--color-text))',
    'radial-gradient(at top 20% right 10%, var(--color-page), var(--color-text))',
    'radial-gradient(at 1rem 2rem, var(--color-page), var(--color-text))',
    'radial-gradient(at calc(50% - 1rem) min(10%, 1rem), var(--color-page), var(--color-text))',
    'radial-gradient(circle at right bottom, var(--color-page), var(--color-text))',
    'radial-gradient(circle at bottom right, var(--color-page), var(--color-text))',
    'radial-gradient(circle at center center, var(--color-page), var(--color-text))',
    'radial-gradient(circle at left center, var(--color-page), var(--color-text))',
    'radial-gradient(circle at center top, var(--color-page), var(--color-text))',
    'radial-gradient(circle at 10% center, var(--color-page), var(--color-text))',
    'radial-gradient(circle at center 10%, var(--color-page), var(--color-text))',
    'radial-gradient(circle 5rem at 50% 50% in oklch, var(--color-page), var(--color-text))',
    'radial-gradient(circle farthest-corner at left 0 top 0 in hsl longer hue, var(--color-page), var(--color-text))',
    'radial-gradient(in oklch, var(--color-page), var(--color-text))',
    'radial-gradient(in srgb circle, var(--color-page), var(--color-text))',
    'radial-gradient(in srgb at center, var(--color-page), var(--color-text))',
    'radial-gradient(var(--color-page) 0, var(--color-text) 100%)',
    'conic-gradient(var(--color-page), var(--color-text))',
    'conic-gradient(from 45deg, var(--color-page), var(--color-text))',
    'conic-gradient(from calc(45deg + 0.1turn), var(--color-page), var(--color-text))',
    'conic-gradient(at 25% 75%, var(--color-page), var(--color-text))',
    'conic-gradient(from 1turn at left top, var(--color-page), var(--color-text))',
    'conic-gradient(from 0 at 0 0, var(--color-page) 0, var(--color-text) 0)',
    'conic-gradient(in hsl longer hue, var(--color-page), var(--color-text))',
    'conic-gradient(from 90deg in oklch, var(--color-page), var(--color-text))',
    'conic-gradient(in srgb from 0deg, var(--color-page), var(--color-text))',
    'conic-gradient(in srgb at center, var(--color-page), var(--color-text))',
    'conic-gradient(var(--color-page) 0deg 90deg, var(--color-text) 90deg 1turn)',
    'conic-gradient(var(--color-page) 25%, var(--color-text) 75%)',
    'conic-gradient(var(--color-page), 45deg, var(--color-text))',
    'conic-gradient(var(--color-page) calc(10% + 10deg), min(50%, 0.5turn), var(--color-text))',
    'repeating-linear-gradient(var(--color-page), var(--color-text) 10px)',
    'repeating-radial-gradient(circle at center, var(--color-page), var(--color-text) 10%)',
    'repeating-radial-gradient(ellipse 1% 1%, var(--color-page) 0, var(--color-text) 0)',
    'repeating-conic-gradient(from 0deg, var(--color-page) 0% 5%, var(--color-text) 5% 10%)',
    'LINEAR-GRADIENT(TO RIGHT, VAR(--color-page), VAR(--color-text))',
  ],
};

/** The families that take a length. */
const LENGTH_FAMILIES: readonly TokenFamily[] = ['space', 'size', 'text', 'leading', 'tracking', 'radius', 'line'];

/** A seed that is longer is a candidate, and it has no mutations. */
const LONGEST_SEED = 160;

/** The pieces of a value: spaces, strings, hex colors, numbers with a unit, words, function heads and signs. */
const PIECE =
  /[ \t]+|"[^"]*"|'[^']*'|#[0-9a-z]+|[+-]?(?:\d*\.\d+|\d+)(?:e[+-]?\d+)?(?:%|[a-z]+)?|-{0,2}[a-z_][a-z0-9_-]*\(?|[\s\S]/gi;
const NUMBER_PIECE = /^([+-]?(?:\d*\.\d+|\d+)(?:e[+-]?\d+)?)(%|[a-z]*)$/i;
const WORD_PIECE = /^-{0,2}[a-z_][a-z0-9_-]*$/i;
const HEAD_PIECE = /^-{0,2}[a-z_][a-z0-9_-]*\($/i;

const NUMBERS: readonly string[] = [
  '0',
  '1',
  '-1',
  '2',
  '0.5',
  '-0.5',
  '1.5',
  '.5',
  '+1',
  '-0',
  '100',
  '101',
  '360',
  '1000',
  '1001',
  '99999999999',
  '1e3',
  '1e-3',
  '1E3',
  '1e+3',
  '1e400',
  '00',
];

const UNITS: readonly string[] = [
  '',
  '%',
  'px',
  'rem',
  'em',
  'vw',
  'cqi',
  'lh',
  'rcap',
  'ric',
  'Q',
  'PX',
  'fr',
  'deg',
  'turn',
  'rad',
  'grad',
  's',
  'ms',
  'dpi',
  'x',
];

/**
 * Words of CSS, by grammar. The kit refuses most of them, and that is their use here: a word of CSS that stands
 * close to a word of the grammar. The words that the grammar accepts come from the kit itself (`dictionaryOf`).
 */
const WORDS: Readonly<Record<string, readonly string[]>> = {
  // The CSS-wide keywords, and words that may become one. This list is wider than the list of the kit: Chromium
  // says which of them are keywords (see the control), and the kit must refuse those.
  wide: ['inherit', 'initial', 'unset', 'revert', 'revert-layer', 'revert-rule', 'revert-style', 'default'],
  common: ['none', 'auto', 'normal'],
  color: ['transparent', 'currentColor', 'red', 'rebeccapurple', 'Canvas', 'none'],
  font: `serif sans-serif cursive fantasy monospace system-ui math emoji fangsong ui-serif ui-sans-serif ui-monospace
    ui-rounded -webkit-body Inter Georgia bold italic small-caps`.split(/\s+/),
  weight: ['normal', 'bold', 'bolder', 'lighter'],
  size: ['max-content', 'min-content', 'fit-content', 'stretch'],
  line: ['thin', 'medium', 'thick'],
  text: ['small', 'large', 'larger', 'smaller', 'xx-small'],
  shadow: ['inset', 'none'],
  ease: [
    'linear',
    'ease',
    'ease-in',
    'ease-out',
    'ease-in-out',
    'step-start',
    'step-end',
    'jump-start',
    'jump-end',
    'jump-none',
    'jump-both',
    'start',
    'end',
  ],
  gradient: `to at from in top bottom left right center circle ellipse
    closest-side closest-corner farthest-side farthest-corner
    srgb srgb-linear display-p3 a98-rgb prophoto-rgb rec2020 lab oklab xyz xyz-d50 xyz-d65 hsl hwb lch oklch
    shorter longer increasing decreasing hue`.split(/\s+/),
};

const ALL_WORDS: readonly string[] = [...new Set(Object.values(WORDS).flat())];

/** The function names of each grammar. */
const HEADS: Readonly<Record<string, readonly string[]>> = {
  color: ['rgb', 'rgba', 'hsl', 'hsla', 'hwb', 'lab', 'lch', 'oklab', 'oklch', 'color', 'color-mix', 'light-dark'],
  math: ['calc', 'min', 'max', 'clamp', 'minmax', 'fit-content', 'abs', 'round'],
  ease: ['cubic-bezier', 'steps', 'linear'],
  gradient: [
    'linear-gradient',
    'radial-gradient',
    'conic-gradient',
    'repeating-linear-gradient',
    'repeating-radial-gradient',
    'repeating-conic-gradient',
    'image-set',
  ],
  other: ['var', 'env', 'url', 'attr'],
};

const ALL_HEADS: readonly string[] = Object.values(HEADS).flat();

/** The names that every JavaScript object has. A grammar that looks a word up in a plain object knows them. */
const OBJECT_NAMES: readonly string[] = Object.getOwnPropertyNames(Object.prototype);

/**
 * The dictionary of a run: every word of the grammar module of the kit, the words of this file, and the names of
 * a JavaScript object. A word has no kind here. It is tried as a keyword, as a unit and as a function name.
 */
function dictionaryOf(kit: Kit): string[] {
  const own = [...ALL_WORDS, ...ALL_HEADS, ...UNITS, ...OBJECT_NAMES].filter((word) => WORD_PIECE.test(word));
  return [...new Set([...kit.words, ...own, ...own.map((word) => word.toLowerCase())])];
}

/** The grammars whose words and function names belong to a family. */
const GRAMMARS: Readonly<Record<TokenFamily, readonly string[]>> = {
  color: ['color', 'wide'],
  space: ['math', 'common', 'wide'],
  size: ['math', 'size', 'common', 'wide'],
  font: ['font', 'wide', 'common'],
  text: ['math', 'text', 'wide'],
  leading: ['math', 'common', 'wide'],
  weight: ['weight', 'wide'],
  tracking: ['math', 'common', 'wide'],
  radius: ['math', 'wide'],
  line: ['math', 'line', 'wide'],
  shadow: ['shadow', 'color', 'math', 'wide'],
  z: ['common', 'math', 'wide'],
  duration: ['math', 'wide'],
  ease: ['ease', 'wide'],
  opacity: ['math', 'wide'],
  gradient: ['gradient', 'color', 'math'],
};

const ownOf = (family: TokenFamily, lists: Readonly<Record<string, readonly string[]>>): string[] =>
  GRAMMARS[family].flatMap((grammar) => lists[grammar] ?? []);

/** The index of the `)` that closes the function head or the `(` at `open`, or -1. */
function closeOf(pieces: readonly string[], open: number): number {
  let depth = 0;
  for (let index = open; index < pieces.length; index += 1) {
    const piece = pieces[index] ?? '';
    if (piece.endsWith('(')) depth += 1;
    else if (piece === ')') depth -= 1;
    if (depth === 0) return index;
  }
  return -1;
}

/** The pieces from `start` to `end`, cut at each comma that is in no bracket. */
function argumentsOf(pieces: readonly string[], start: number, end: number): string[] {
  const parts: string[] = [];
  let part = '';
  let depth = 0;
  for (const piece of pieces.slice(start, end)) {
    if (piece.endsWith('(')) depth += 1;
    else if (piece === ')') depth -= 1;
    if (piece === ',' && depth === 0) {
      parts.push(part);
      part = '';
    } else {
      part += piece;
    }
  }
  return [...parts, part];
}

/** The lists of arguments with one argument less, and with one argument twice. */
function recounted(parts: readonly string[]): string[] {
  const lists: string[] = [];
  for (const [index, part] of parts.entries()) {
    lists.push(parts.filter((_, other) => other !== index).join(','));
    lists.push([...parts.slice(0, index), part, ...parts.slice(index)].join(','));
  }
  lists.push([...parts, parts[0] ?? ''].join(', '));
  return lists;
}

/** What a word is at one place of a value: a keyword, the unit of a number, or the name of a function. */
type Role = 'word' | 'unit' | 'head';

/** One place of a value that holds a word, a number or a function name. */
interface Slot {
  /** The index of the piece. */
  index: number;
  role: Role;
  /** The place: the role, the function around the piece, and the piece before it. */
  place: string;
  /**
   * The kind of the slot: the place, and the word or the function name that stands there. Two slots of one kind
   * take the same words, more or less.
   */
  key: string;
}

/** The places of a value where a word of the dictionary can stand. A token name is no such place. */
function slotsOf(pieces: readonly string[]): Slot[] {
  const slots: Slot[] = [];
  const around: string[] = [];
  let before = '';
  for (const [index, piece] of pieces.entries()) {
    if (piece.trim() === '') continue;
    const text = piece.toLowerCase();
    const number = NUMBER_PIECE.exec(piece);
    const role = number !== null ? 'unit' : HEAD_PIECE.test(piece) ? 'head' : 'word';
    const place = `${role} ${around.at(-1) ?? ''} ${before}`;
    if (role !== 'word' || (WORD_PIECE.test(piece) && !piece.startsWith('--'))) {
      slots.push({ index, role, place, key: role === 'unit' ? place : `${place} ${text}` });
    }
    if (piece.endsWith('(')) around.push(text);
    else if (piece === ')') around.pop();
    // A number counts by its unit, and every token name, string and hex color counts as one.
    before = number === null ? text.replace(/^(--|"|'|#).*$/, '$1') : `0${(number[2] ?? '').toLowerCase()}`;
  }
  return slots;
}

/** The word, the unit or the function name that stands in a slot, in lower case. */
function wordAt(pieces: readonly string[], slot: Slot): string {
  const piece = (pieces[slot.index] ?? '').toLowerCase();
  if (slot.role === 'unit') return NUMBER_PIECE.exec(piece)?.[2] ?? '';
  return slot.role === 'head' ? piece.slice(0, -1) : piece;
}

/** The value with another word in a slot. */
function withWord(pieces: readonly string[], slot: Slot, word: string): string {
  const number = NUMBER_PIECE.exec(pieces[slot.index] ?? '')?.[1] ?? '';
  const next = slot.role === 'unit' ? `${number}${word}` : slot.role === 'head' ? `${word}(` : word;
  return [...pieces.slice(0, slot.index), next, ...pieces.slice(slot.index + 1)].join('');
}

/** The words that the kit accepts somewhere in a family, by role: what the dictionary round found. */
type Vocabulary = Readonly<Record<Role, readonly string[]>>;

/** The seeds with one kind of slot that get every word of the dictionary. */
const SLOT_SEEDS = 3;
/**
 * The keywords of one place that count as a kind of their own. A place such as the whole value of a color has 148
 * of them, and they are all of one kind.
 */
const PLACE_WORDS = 8;
/** The words of one role that the vocabulary of a family holds at most. A font name is any word at all. */
const VOCABULARY_WORDS = 64;

/** Numbers and dimensions that stand in the place of a word, and as one more piece. */
const FILLERS: readonly string[] = ['0', '1', '10%', '1px', '45deg'];

/**
 * The mutations of one value, each with one change:
 *
 * - a piece less, a piece twice, two pieces swapped;
 * - one more comma, space or slash, a space as a tab or as nothing, and a `-` or a `_` at a piece;
 * - a number as 0, 1, a negative, a huge or a fractional one, with another unit, and as a word;
 * - a word as each word that the kit accepts in the family, as a word of this file, and as a number; a token name
 *   as each other token name;
 * - one more piece before each piece and at the end: each word that the kit accepts in the family, and a number;
 * - a function with another name, inside a math function, inside itself, and with one argument less or more;
 * - the whole value in another letter case.
 */
function mutationsOf(value: string, family: TokenFamily, random: Random, vocabulary: Vocabulary): string[] {
  const pieces = value.match(PIECE) ?? [];
  const found: string[] = [];
  const words = [...new Set([...vocabulary.word, ...ownOf(family, WORDS)])];
  // Each unit of the vocabulary stood in each kind of place in the dictionary round. Here a few of them are enough.
  const units = [...new Set([...UNITS, ...sample(vocabulary.unit, 6, random)])];
  const heads = [...new Set([...vocabulary.head, ...ownOf(family, HEADS)])];
  const put = (index: number, ...next: readonly string[]): void => {
    found.push([...pieces.slice(0, index), ...next, ...pieces.slice(index + 1)].join(''));
  };
  const wrap = (start: number, end: number): void => {
    const before = pieces.slice(0, start).join('');
    const inner = pieces.slice(start, end + 1).join('');
    const rest = pieces.slice(end + 1).join('');
    for (const text of [
      `calc(${inner})`,
      `min(${inner})`,
      `max(${inner}, ${inner})`,
      `clamp(${inner}, ${inner}, ${inner})`,
      `calc(${inner} * 2)`,
      `calc(${inner} + ${inner})`,
      `calc(${inner} + ${inner} + ${inner})`,
      `calc(1 + ${inner} + ${inner})`,
      `(${inner})`,
    ]) {
      found.push(`${before}${text}${rest}`);
    }
  };
  const solid = [...pieces.keys()].filter((index) => (pieces[index] ?? '').trim() !== '');
  const pairs = solid.flatMap((first, at) => solid.slice(at + 1).map((second) => [first, second] as const));
  for (const [first, second] of sample(pairs, 24, random)) {
    const swapped = [...pieces];
    swapped[first] = pieces[second] ?? '';
    swapped[second] = pieces[first] ?? '';
    found.push(swapped.join(''));
  }
  for (const [index, piece] of pieces.entries()) {
    put(index);
    put(index, piece, piece);
    put(index, piece, ' ', piece);
    for (const sign of [',', ' ', '/', ', ', ' / ']) put(index, sign, piece);
    if (piece.trim() === '') {
      put(index, '\t');
      put(index, '  ');
      continue;
    }
    // CSS reads `-` and `_` as a part of a name, a unit and a hex color: `#000-1px` is one token.
    for (const sign of ['-', '_']) {
      put(index, `${piece}${sign}`);
      put(index, `${sign}${piece}`);
    }
    for (const text of [...words, ...FILLERS]) put(index, ` ${text} `, piece);
    const number = NUMBER_PIECE.exec(piece);
    if (number !== null) {
      // A sign and no space before it: the number may join the piece before it.
      if (index > 0 && (pieces[index - 1] ?? '').trim() === '') {
        const bare = piece.replace(/^[+-]/, '');
        for (const sign of ['-', '+']) {
          found.push([...pieces.slice(0, index - 1), `${sign}${bare}`, ...pieces.slice(index + 1)].join(''));
        }
      }
      for (const text of NUMBERS) put(index, `${text}${number[2] ?? ''}`);
      for (const unit of units) put(index, `${number[1] ?? ''}${unit}`);
      for (const word of words) put(index, word);
      put(index, `-${piece.replace(/^[+-]/, '')}`);
      wrap(index, index);
    } else if (piece.startsWith('--')) {
      for (const name of TOKEN_NAMES) put(index, name);
    } else if (WORD_PIECE.test(piece)) {
      for (const word of [...words, ...FILLERS, ...sample(ALL_WORDS, 5, random)]) put(index, word);
      put(index, piece.toUpperCase());
    } else if (HEAD_PIECE.test(piece)) {
      const close = closeOf(pieces, index);
      for (const head of [...heads, ...sample(ALL_HEADS, 4, random)]) put(index, `${head}(`);
      if (close < 0) continue;
      wrap(index, close);
      const whole = pieces.slice(index, close + 1).join('');
      const tail = pieces.slice(close).join('');
      const head = pieces.slice(0, index + 1).join('');
      const parts = argumentsOf(pieces, index + 1, close);
      // The function inside itself, as its first argument.
      found.push(`${head}${[whole, ...parts.slice(1)].join(',')}${tail}`);
      for (const list of recounted(parts)) found.push(`${head}${list}${tail}`);
    }
  }
  for (const text of [...words, ...FILLERS]) found.push(`${value} ${text}`);
  found.push(...recounted(argumentsOf(pieces, 0, pieces.length)));
  found.push(`calc(${value})`, value.toUpperCase(), value.toLowerCase());
  for (const head of heads) found.push(`${head}(${value})`);
  return found;
}

/** The mutations of one seed that the first round takes at most. A short seed has fewer, so it keeps them all. */
const SEED_MUTATIONS = 600;
/** The seed of the generator. Another number gives other mutations, and the same number gives the same ones. */
const SEED = 0x7a3;
/** The rounds after the first one. Each round changes values that the kit accepted in the round before. */
const ROUNDS = 2;
/** The accepted values that a round changes, and the mutations that it takes of each one. */
const ROUND_VALUES = 150;
const ROUND_MUTATIONS = 30;
/** The same for the last round, which changes candidates of any verdict. */
const WILD_VALUES = 200;
const WILD_MUTATIONS = 12;

/** A text that can stand in a cell of a table and that the kit reads as it is. */
const fitsCell = (value: string): boolean => value !== '' && value === value.trim() && !/[|`\n\r]/.test(value);

interface Candidates {
  /** The count of all candidates. */
  count: number;
  /** The candidates that the kit accepts. */
  accepted: string[];
}

/**
 * The candidates of a family.
 *
 * 1. The seeds: the values of the unit test and of this file.
 * 2. The dictionary round. Each accepted seed gets every word of the dictionary in each kind of place that it has:
 *    as a keyword, as a unit and as a function name. The first `SLOT_SEEDS` seeds with a kind of place get them.
 *    The words of the candidates that the kit accepts are the vocabulary of the family. So a word that only the
 *    kit knows reaches the later rounds.
 * 3. The mutations of each seed, with the vocabulary.
 * 4. Each later round changes values that the kit accepted in the round before. So its candidates stand close to
 *    the border of the grammar, and a value with two or three changes is reached.
 * 5. The last round changes candidates of any verdict. It fills the families with a small grammar.
 */
function candidatesOf(kit: Kit, family: TokenFamily): Candidates {
  const random = seeded(SEED + FAMILIES.indexOf(family));
  const seeds = [...ACCEPTED[family], ...REFUSED[family], ...SEEDS[family]];
  const seen = new Set<string>();
  const accepted: string[] = [];
  const judge = (values: Iterable<string>): string[] => {
    const fresh = [...new Set(values)].filter((value) => fitsCell(value) && !seen.has(value));
    for (const value of fresh) seen.add(value);
    const answers = acceptedBy(kit, family, fresh);
    const passed = fresh.filter((_, index) => answers[index] === true);
    accepted.push(...passed);
    return passed;
  };
  const short = seeds.filter((seed) => seed.length <= LONGEST_SEED);
  // Candidates with no mutations of their own: every length unit, and every named color of the kit.
  const lengths = LENGTH_FAMILIES.includes(family) ? LENGTH_SEEDS : [];
  const plain = family === 'color' ? kit.colors : lengths;
  const roots = judge([...seeds, ...plain]).filter((seed) => seed.length <= LONGEST_SEED);

  // The dictionary round. `origin` says which word in which role made a candidate.
  const dictionary = dictionaryOf(kit);
  const taken = new Map<string, number>();
  const kinds = new Map<string, number>();
  const origin = new Map<string, readonly [Role, string]>();
  const known: [Role, string][] = [];
  for (const seed of roots) {
    const pieces = seed.match(PIECE) ?? [];
    for (const slot of slotsOf(pieces)) {
      known.push([slot.role, wordAt(pieces, slot)]);
      const count = taken.get(slot.key) ?? 0;
      const others = kinds.get(slot.place) ?? 0;
      if (count >= SLOT_SEEDS || (count === 0 && slot.role === 'word' && others >= PLACE_WORDS)) continue;
      taken.set(slot.key, count + 1);
      if (count === 0) kinds.set(slot.place, others + 1);
      for (const word of dictionary) {
        const candidate = withWord(pieces, slot, word);
        if (!origin.has(candidate)) origin.set(candidate, [slot.role, word]);
      }
    }
  }
  for (const candidate of judge(origin.keys())) {
    const entry = origin.get(candidate);
    if (entry !== undefined) known.push([entry[0], entry[1].toLowerCase()]);
  }
  // A named color is a candidate by itself. As a word of the vocabulary, a few of them stand for all.
  const colors = new Set(kit.colors.filter((color) => !ALL_WORDS.includes(color)));
  const wordsIn = (role: Role): string[] => {
    const words = known.filter(([other, word]) => other === role && word !== '' && !colors.has(word));
    return sample([...new Set(words.map(([, word]) => word))], VOCABULARY_WORDS, random);
  };
  const vocabulary: Vocabulary = { word: wordsIn('word'), unit: wordsIn('unit'), head: wordsIn('head') };

  const changed = (values: readonly string[], count: number, mutations: number): string[] =>
    sample(values, count, random).flatMap((value) =>
      sample(mutationsOf(value, family, random, vocabulary), mutations, random),
    );
  let passed = [...roots, ...judge(changed(short, short.length, SEED_MUTATIONS))];
  for (let round = 0; round < ROUNDS; round += 1) passed = judge(changed(passed, ROUND_VALUES, ROUND_MUTATIONS));
  judge(
    changed(
      [...seen].filter((value) => value.length <= LONGEST_SEED),
      WILD_VALUES,
      WILD_MUTATIONS,
    ),
  );
  return { count: seen.size, accepted };
}

// Chromium

/**
 * One use of a token: a property, and the value of the declaration with `{}` for the value of the token. A use is a
 * property of the 7.3 row of the family, or a calculation with the token where 7.3 allows one.
 */
type Use = readonly [property: string, template: string];

const SIDES = ['top', 'right', 'bottom', 'left'] as const;
const FLOW = ['block', 'inline', 'block-start', 'block-end', 'inline-start', 'inline-end'] as const;

const alone = (...properties: readonly string[]): Use[] => properties.map((property) => [property, '{}'] as const);
const within = (template: string, ...properties: readonly string[]): Use[] =>
  properties.map((property) => [property, template] as const);

/** A property with its side and its logical forms: `margin`, `margin-top`, `margin-block`, `margin-block-start`. */
const box = (name: string, tail = ''): string[] => [
  `${name}${tail}`,
  ...[...SIDES, ...FLOW].map((side) => `${name}-${side}${tail}`),
];

const SIZES = ['width', 'height', 'inline-size', 'block-size'];
const CORNERS = ['top-left', 'top-right', 'bottom-right', 'bottom-left'];
const FLOW_CORNERS = ['start-start', 'start-end', 'end-start', 'end-end'];

/** The color uses of 7.3 with the color itself: the properties of the table, and `drop-shadow()`. */
const COLOR_USES: readonly Use[] = [
  ...alone('color', 'background-color', 'background', ...box('border', '-color'), 'outline-color'),
  ...alone('text-decoration-color', 'text-emphasis-color', 'caret-color', 'accent-color', 'column-rule-color'),
  ...alone('fill', 'stroke'),
  ...within('1px solid {}', ...box('border'), 'outline'),
  ...within('underline {}', 'text-decoration'),
  // `filter` and `backdrop-filter` take a color token for `drop-shadow()`.
  ...within('drop-shadow(0 0 1px {})', 'filter', 'backdrop-filter'),
];

/** The token generator writes a color of two themes as `light-dark(L, K)` (7.7): each use, with the color on each side. */
const schemed = (uses: readonly Use[]): Use[] =>
  ['light-dark({}, #000000)', 'light-dark(#ffffff, {})'].flatMap((pair) =>
    uses.map(([property, template]) => [property, template.replace('{}', pair)] as const),
  );

/**
 * A token of the length group in a calculation (7.3). Inside a math function, a property of one family of the group
 * accepts a token of each of them, and so does a property with no family: `transform`, `filter`, `clip-path`. 7.4
 * itself tells the author to write `calc(var(--space-2) * -1)`.
 */
const CALCULATED: readonly Use[] = [
  ...within('calc({} * -1)', 'margin-top', 'outline-offset'),
  ...within('calc(100% - {})', 'width'),
  ...within('calc({} + 1px)', 'padding', 'font-size', 'border-radius'),
  ...within('calc({} + 1px)', 'border-width', 'column-rule-width', 'text-decoration-thickness'),
  ...within('calc(({} + 1px) / 2)', 'margin-block'),
  ...within('min({}, 1rem)', 'row-gap'),
  ...within('max({}, 1px)', 'border-top-width'),
  ...within('clamp(1px, {}, 10rem)', 'padding-inline'),
  ...within('minmax({}, 1fr)', 'grid-template-columns'),
  ...within('fit-content({})', 'grid-template-rows'),
  ...within('translateY({})', 'transform'),
  ...within('blur({})', 'filter'),
  ...within('inset({} round {})', 'clip-path'),
];

/** The uses of the tokens of each family: the properties of the table of 7.3, and the calculations of 7.3. */
const USES: Readonly<Record<TokenFamily, readonly Use[]>> = {
  color: [...COLOR_USES, ...schemed(COLOR_USES)],
  space: [
    ...alone(...box('margin'), ...box('padding'), 'gap', 'row-gap', 'column-gap'),
    ...alone('inset', ...FLOW.map((side) => `inset-${side}`), ...SIDES),
    ...alone(...box('scroll-margin'), ...box('scroll-padding'), 'text-indent', 'translate'),
    ...CALCULATED,
  ],
  size: [
    ...alone(...SIZES, ...SIZES.map((name) => `min-${name}`), ...SIZES.map((name) => `max-${name}`)),
    ...alone('flex-basis', 'grid-template-columns', 'grid-template-rows', 'grid-auto-columns', 'grid-auto-rows'),
    ...alone('aspect-ratio', 'contain-intrinsic-size', 'translate'),
    ...within('1 1 {}', 'flex'),
    ...CALCULATED,
  ],
  font: [...alone('font-family'), ...within('1rem {}', 'font')],
  text: [...alone('font-size'), ...within('{} serif', 'font'), ...CALCULATED],
  leading: [...alone('line-height'), ...within('1rem/{} serif', 'font')],
  weight: [...alone('font-weight'), ...within('{} 1rem serif', 'font')],
  tracking: [
    ...alone('letter-spacing', 'word-spacing'),
    ...within('calc({} * 2)', 'letter-spacing'),
    ...within('calc({} + 1px)', 'word-spacing'),
  ],
  radius: [
    ...alone('border-radius', ...[...CORNERS, ...FLOW_CORNERS].map((corner) => `border-${corner}-radius`)),
    ...CALCULATED,
  ],
  line: [
    ...alone(...box('border', '-width'), 'outline-width', 'outline-offset', 'column-rule-width', 'stroke-width'),
    ...alone('text-decoration-thickness', 'text-underline-offset'),
    ...within('{} solid', ...box('border'), 'outline'),
    ...CALCULATED,
  ],
  shadow: alone('box-shadow', 'text-shadow'),
  z: alone('z-index'),
  duration: [
    ...alone('transition-duration', 'transition-delay', 'animation-duration', 'animation-delay'),
    ...within('opacity {}', 'transition'),
    ...within('opacity 1s {}', 'transition'),
    ...within('{} fade', 'animation'),
    ...within('1s {} fade', 'animation'),
  ],
  ease: [
    ...alone('transition-timing-function', 'animation-timing-function'),
    ...within('opacity 1s {}', 'transition'),
    ...within('1s {} fade', 'animation'),
  ],
  opacity: alone('opacity', 'fill-opacity', 'stroke-opacity'),
  gradient: alone('background-image', 'background', 'mask-image', 'border-image-source'),
};

/**
 * The literal values that stand for a `var()` of each family. A color has two: the generator writes a color of two
 * themes as `light-dark()`, and a value must be valid with both.
 */
const LITERALS: Readonly<Record<TokenFamily, readonly string[]>> = {
  color: ['#123456', 'light-dark(#123456, rgb(1 2 3 / 50%))'],
  space: ['1rem'],
  size: ['10rem'],
  font: ['"Probe", serif'],
  text: ['1rem'],
  leading: ['1.5'],
  weight: ['400'],
  tracking: ['0.02em'],
  radius: ['0.5rem'],
  line: ['1px'],
  shadow: ['0 1px 2px #123456'],
  z: ['10'],
  duration: ['150ms'],
  ease: ['ease-out'],
  opacity: ['0.5'],
  gradient: ['linear-gradient(#123456, #654321)'],
};

const VAR = /var\(\s*--([a-z]+)-[a-z0-9-]*\s*\)/gi;
/** A function that a browser replaces before it reads the value. A declaration with one always parses. */
const SUBSTITUTION = /(?:var|env|attr)\(/i;
const QUOTED = /("[^"]*"|'[^']*')/;

const isFamily = (text: string): text is TokenFamily => Object.hasOwn(LITERALS, text);

/** The parts of a value that stand in no string. A string may hold the text `var(`: it is no function there. */
const bare = (value: string): string[] => value.split(QUOTED).filter((_, index) => index % 2 === 0);

/** The value with `change` applied to each part that stands in no string. */
const outsideStrings = (value: string, change: (part: string) => string): string =>
  value
    .split(QUOTED)
    .map((part, index) => (index % 2 === 0 ? change(part) : part))
    .join('');

/**
 * The value with a literal for each `var()`, once for each literal of a color. The spaces around the literal change
 * nothing: a browser puts the tokens of the variable in, never its text, so the literal cannot join its neighbor.
 */
function literalsOf(value: string): string[] {
  const texts = [0, 1].map((choice) =>
    outsideStrings(value, (part) =>
      part.replace(VAR, (text, family: string) => {
        const literals = isFamily(family) ? LITERALS[family] : [];
        const literal = literals[choice] ?? literals[0];
        return literal === undefined ? text : ` ${literal} `;
      }),
    ).trim(),
  );
  return [...new Set(texts)];
}

/** The families of the tokens that the value names with `var()`. */
const namedBy = (value: string): string[] =>
  bare(value).flatMap((part) => [...part.matchAll(VAR)].map((found) => (found[1] ?? '').toLowerCase()));

const ALIAS = /^var\([^()]*\)$/i;

/**
 * Says whether a `var()` of the value names a token of a family that 7.4 does not allow at its place. A value that
 * is one `var()` is an alias, and it names its own family. Any other `var()` is a color in a shadow or a gradient.
 * The check with literals cannot see this: the literal of a wrong family is often a valid value too.
 */
function misnames(family: TokenFamily, value: string): boolean {
  if (ALIAS.test(value)) return namedBy(value).some((name) => name !== family);
  return namedBy(value).some((name) => name !== 'color' || (family !== 'shadow' && family !== 'gradient'));
}

interface Batch {
  uses: readonly Use[];
  /** The uses, by index, that also get the check with `var()`. */
  substituted: readonly number[];
  /** The declarations of the tokens that a value may name. */
  tokens: string;
  /** `open` is true when a literal still holds a substitution function. Then no declaration says anything. */
  values: { text: string; literals: string[]; open: boolean }[];
}

interface Verdict {
  /** The uses, by index, whose declaration Chromium refuses. */
  refused: number[];
  /** The uses, by index, whose declaration has an effect with the value itself and none with `var()`. */
  dropped: number[];
  /** True when `tokens.css` holds the value as one custom property, and the property has a value. */
  custom: boolean;
}

/**
 * Runs in the page, for each value.
 *
 * 1. It parses one declaration for each use, with `CSS.supports` and by setting it on an element. `CSS.supports`
 *    is the judge: it parses as a style sheet of a page in standards mode does. A value that still holds a
 *    substitution function is refused: its declaration always parses, so the answer would say nothing.
 * 2. It reads the value back from a style sheet that has the shape of `tokens.css`, and it asks for the computed
 *    value of the custom property: a CSS-wide keyword such as `inherit` leaves it empty.
 * 3. For the uses of `substituted`, it sets the declaration with `var(--probe)` on an element of the page and
 *    reads the computed values of its longhands. When they are the values of an element with no declaration, it
 *    sets the declaration with the value itself. When that one changes a computed value, the browser dropped the
 *    declaration with `var()` after it put the value in: a font name that starts with a CSS-wide keyword is
 *    valid as it stands, and not valid through `var()`. The check never compares two computed texts of one
 *    value: Chromium rounds a color in another way on each of the two paths.
 */
function judgeInPage({ uses, substituted, tokens, values }: Batch): Verdict[] {
  const element = document.createElement('div');
  const probe = document.createElement('div');
  document.body.append(probe);
  const root = document.documentElement;
  const declared = new CSSStyleSheet();
  declared.replaceSync(tokens);
  document.adoptedStyleSheets = [declared];
  const sheet = new CSSStyleSheet();
  const filled = (template: string, value: string): string => template.replaceAll('{}', () => value);
  const style = getComputedStyle(probe);
  /** For each use: its longhands, and their computed values on an element with no declaration. */
  const plain = new Map<number, { names: string[]; values: string }>();
  const dropped = (index: number, text: string): boolean => {
    const [property, template] = uses[index] ?? ['', ''];
    const read = (longhands: readonly string[]): string =>
      longhands.map((name) => style.getPropertyValue(name)).join('; ');
    probe.style.cssText = '';
    probe.style.setProperty(property, filled(template, 'var(--probe)'));
    const names = plain.get(index)?.names ?? Array.from(probe.style);
    const through = read(names);
    probe.style.cssText = '';
    const nothing = plain.get(index)?.values ?? read(names);
    plain.set(index, { names, values: nothing });
    if (through !== nothing) return false;
    probe.style.setProperty(property, filled(template, text));
    return read(names) !== nothing;
  };
  const verdicts = values.map(({ text, literals, open }) => {
    const refused: number[] = [];
    for (const [index, [property, template]] of uses.entries()) {
      const valid = literals.every((literal) => {
        const value = filled(template, literal);
        element.style.cssText = '';
        element.style.setProperty(property, value);
        return !open && CSS.supports(property, value) && element.style.length > 0;
      });
      if (!valid) refused.push(index);
    }
    sheet.replaceSync(`@layer tokens {\n  :root {\n    --probe: ${text};\n    --after: 1;\n  }\n}\n`);
    const layer = sheet.cssRules[0];
    const rule = layer instanceof CSSLayerBlockRule ? layer.cssRules[0] : undefined;
    root.style.cssText = '';
    root.style.setProperty('--probe', text);
    const custom =
      sheet.cssRules.length === 1 &&
      layer instanceof CSSLayerBlockRule &&
      layer.cssRules.length === 1 &&
      rule instanceof CSSStyleRule &&
      rule.selectorText === ':root' &&
      rule.style.length === 2 &&
      rule.style.getPropertyValue('--probe') === text &&
      rule.style.getPropertyValue('--after') === '1' &&
      getComputedStyle(root).getPropertyValue('--probe') !== '';
    return { refused, dropped: substituted.filter((index) => dropped(index, text)), custom };
  });
  root.style.cssText = '';
  probe.remove();
  return verdicts;
}

let browser: Browser | undefined;
let page: Page | undefined;

/**
 * A document in standards mode. `about:blank` is in quirks mode: there an element takes a length without a unit
 * for some properties, such as `letter-spacing: 5`.
 */
const DOCUMENT = 'data:text/html,<!doctype html><title>design values</title>';

/** One page of one Chromium for the whole file. */
async function thePage(): Promise<Page> {
  if (page === undefined) {
    browser = await launch();
    page = await (await browser.newContext()).newPage();
    await page.goto(DOCUMENT);
  }
  return page;
}

after(async () => {
  await browser?.close();
});

const TOKEN_CSS = `:root { ${FAMILIES.flatMap((family) => TOKENS[family].map(([name, value]) => `${name}: ${value};`)).join(' ')} }`;

/** The uses that get the check with `var()`, at most. The check reads computed values, so it is slow. */
const SUBSTITUTED = 3;

/** The first use of each template, by index: the plain declaration, a shorthand, a calculation. */
function substitutedOf(uses: readonly Use[]): number[] {
  const first = new Map<string, number>();
  for (const [index, [, template]] of uses.entries()) if (!first.has(template)) first.set(template, index);
  return [...first.values()].slice(0, SUBSTITUTED);
}

/** What Chromium says about each value of a family. */
async function verdictsOf(family: TokenFamily, values: readonly string[]): Promise<Verdict[]> {
  const batch: Batch = {
    uses: USES[family],
    substituted: substitutedOf(USES[family]),
    tokens: TOKEN_CSS,
    values: values.map((text) => {
      const literals = literalsOf(text);
      return {
        text,
        literals,
        open: literals.some((literal) => bare(literal).some((part) => SUBSTITUTION.test(part))),
      };
    }),
  };
  return (await thePage()).evaluate(judgeInPage, batch);
}

// What 7.4 says about a value that only some uses of its family accept

const BRACKETS = /\([^()]*\)/g;

/** The value with `{}` for each pair of brackets and its content. */
function flat(value: string): string {
  let text = value;
  for (let next = text.replace(BRACKETS, '{}'); next !== text; next = text.replace(BRACKETS, '{}')) text = next;
  return text;
}

const isRatio = (value: string): boolean => flat(value).includes('/');
const hasPercentage = (value: string): boolean => value.includes('%');

/** The words of one shadow without the content of brackets: a number, a math function, a color or a keyword. */
const SHADOW_WORD = /[+-]?(?:\d*\.\d+|\d+)(?:e[+-]?\d+)?(?:%|-?[a-z_][a-z0-9_-]*)?|#[0-9a-z_-]+|[a-z-]+(?:\{\})?/gi;
const SHADOW_LENGTH = /^(?:[+-]?\.?\d|(?:calc|min|max|clamp)\{\}$)/i;

/** A shadow list with the keyword `inset`, or with a shadow of four lengths: the fourth is the spread distance. */
const isBoxShadow = (value: string): boolean =>
  flat(value)
    .split(',')
    .some((shadow) => {
      const words = shadow.match(SHADOW_WORD) ?? [];
      const lengths = words.filter((word) => SHADOW_LENGTH.test(word));
      return lengths.length >= 4 || words.some((word) => word.toLowerCase() === 'inset');
    });

interface Limit {
  families: readonly TokenFamily[];
  /** The sentence of 7.4. */
  rule: string;
  /** Says whether the rule is about the value. The value has a literal for each `var()`. */
  holds: (value: string) => boolean;
  /** Says whether the value need not be valid for the use. */
  frees: (property: string, template: string) => boolean;
}

/** The properties of `CALCULATED` that take no percentage, also inside a calculation. */
const NO_PERCENTAGE: readonly string[] = [
  'border-width',
  'border-top-width',
  'column-rule-width',
  'outline-offset',
  'filter',
];

/**
 * The values that 7.4 accepts although only some uses of the family take them. Each entry is one sentence of 7.4:
 * the two sentences about a ratio are one there. Every other accepted value must be valid for every use of its
 * family.
 */
const LIMITS: readonly Limit[] = [
  {
    families: ['size'],
    rule: 'a ratio is for `aspect-ratio` only',
    holds: isRatio,
    frees: (property) => property !== 'aspect-ratio',
  },
  {
    families: ['size'],
    rule: 'a size that is no ratio is not for `aspect-ratio`',
    holds: (value) => !isRatio(value),
    frees: (property) => property === 'aspect-ratio',
  },
  {
    families: ['size'],
    rule: 'a size with a percentage is not for `contain-intrinsic-size`',
    holds: hasPercentage,
    frees: (property) => property === 'contain-intrinsic-size',
  },
  {
    families: ['space'],
    rule: 'a space with a percentage is not for `scroll-margin`',
    holds: hasPercentage,
    frees: (property) => property.startsWith('scroll-margin'),
  },
  {
    families: ['space', 'size', 'text', 'radius'],
    rule: 'a value with a percentage is not for a calculation in a property that takes no percentage',
    holds: hasPercentage,
    frees: (property, template) => template !== '{}' && NO_PERCENTAGE.includes(property),
  },
  {
    families: ['tracking'],
    rule: '`normal` is not for a calculation',
    holds: (value) => value.toLowerCase() === 'normal',
    frees: (_, template) => template.includes('calc('),
  },
  {
    families: ['shadow'],
    rule: 'a shadow with `inset` or with four lengths is for `box-shadow` only',
    holds: isBoxShadow,
    frees: (property) => property === 'text-shadow',
  },
];

interface Judged {
  /** One line for each accepted value that Chromium refuses where 7.4 promises that it is valid. */
  gaps: string[];
  /** For each rule of `LIMITS`, the count of values that Chromium refuses only where the rule frees them. */
  limited: Map<string, number>;
}

/** The name of a use in a message: the property, and the template when the token is a part of the value. */
const useName = ([property, template]: Use): string => (template === '{}' ? property : `${property}: ${template}`);

/** Compares the verdicts of Chromium with the promise of 7.4. `limits` is `LIMITS`, or nothing for a control. */
function judged(
  family: TokenFamily,
  values: readonly string[],
  verdicts: readonly Verdict[],
  limits: readonly Limit[],
): Judged {
  const gaps: string[] = [];
  const limited = new Map<string, number>();
  const uses = USES[family];
  const usesAt = (indexes: readonly number[]): Use[] => indexes.flatMap((index) => uses.slice(index, index + 1));
  for (const [index, value] of values.entries()) {
    const verdict = verdicts[index];
    if (verdict === undefined) throw new Error(`Chromium gave no verdict for ${JSON.stringify(value)}`);
    const literal = literalsOf(value)[0] ?? value;
    const rules = limits.filter((limit) => limit.families.includes(family) && limit.holds(literal));
    const refused = usesAt(verdict.refused);
    const broken = refused.filter(([property, template]) => !rules.some((rule) => rule.frees(property, template)));
    // A use whose declaration is refused has nothing to compute.
    const dropped = usesAt(verdict.dropped.filter((use) => !verdict.refused.includes(use)));
    if (misnames(family, value)) {
      gaps.push(`${family}: \`${value}\` names a token of a family that 7.4 does not allow there`);
    } else if (!verdict.custom) {
      gaps.push(`${family}: \`${value}\` is no custom property with a value in tokens.css`);
    } else if (broken.length > 0) {
      const names = [...new Set(broken.map(useName))];
      gaps.push(`${family}: \`${value}\` is not valid for ${names.length} of ${uses.length} uses: ${names.join(', ')}`);
    } else if (dropped.length > 0) {
      const names = dropped.map(useName).join(', ');
      gaps.push(`${family}: \`${value}\` is valid as it stands, but the declaration with var() is dropped: ${names}`);
    } else if (refused.length > 0) {
      for (const rule of rules.filter((limit) =>
        refused.some(([property, template]) => limit.frees(property, template)),
      )) {
        limited.set(rule.rule, (limited.get(rule.rule) ?? 0) + 1);
      }
    }
  }
  return { gaps, limited };
}

// The tests

/** The values that are a gap for at least one use of their family, with no rule of `LIMITS`. */
async function refusedOf(cases: readonly (readonly [TokenFamily, string])[]): Promise<string[]> {
  const refused: string[] = [];
  for (const [family, value] of cases) {
    const { gaps } = judged(family, [value], await verdictsOf(family, [value]), []);
    if (gaps.length > 0) refused.push(value);
  }
  return refused;
}

/** Values that are no CSS for a use of their family. They go to Chromium directly, not through the kit. */
const NO_CSS: readonly (readonly [TokenFamily, string])[] = [
  ['ease', 'steps(1, jump-none)'],
  ['ease', 'linear(0)'],
  ['gradient', 'linear-gradient(red blue)'],
  ['gradient', 'linear-gradient(var(--color-page) var(--color-text))'],
  ['gradient', 'linear-gradient(10% red, blue)'],
  ['gradient', 'var(--color-page)'],
  ['color', '#12'],
  ['color', 'var(--space-2)'],
  ['color', 'var(--color-page, #000)'],
  ['space', '-1rem'],
  ['space', '1rem 2rem'],
  ['size', 'auto 1rem'],
  ['line', '5%'],
  ['leading', '-1px'],
  ['shadow', '0 0 -1px #000'],
  ['shadow', '0 1px 2px var(--space-2)'],
  ['font', 'inherit'],
  ['font', 'serif; color: red'],
  ['font', 'serif } html { color: red'],
  ['z', '1.5'],
  ['duration', '1'],
  ['opacity', 'half'],
  // A page in quirks mode would take a length without a unit for these properties.
  ['tracking', '5'],
  ['text', '5'],
  // A zero without a unit is a number inside a calculation.
  ['space', '0'],
  ['line', '0'],
  ['tracking', '0'],
  // Valid as it stands, but the declaration with `var()` is dropped.
  ['font', 'inherit Sans'],
  ['font', 'revert-layer Sans, serif'],
  ['font', 'serif, initial'],
  // A function name that only a JavaScript object knows.
  ['color', 'constructor(none none none)'],
  ['gradient', 'constructor(var(--color-page), var(--color-text))'],
  // A token of another family.
  ['line', 'var(--space-2)'],
  ['shadow', 'var(--color-muted) 0 var(--line-1)'],
  ['space', 'calc(1 + 1px + 1px)'],
];

/** Values that are CSS for every use of their family. */
const CSS_VALUES: readonly (readonly [TokenFamily, string])[] = [
  ['ease', 'steps(2, jump-none)'],
  ['ease', 'linear(0, 1)'],
  ['gradient', 'linear-gradient(red, blue)'],
  ['gradient', 'linear-gradient(var(--color-page), var(--color-text))'],
  ['gradient', 'var(--gradient-hero)'],
  ['color', '#123'],
  ['color', 'var(--color-page)'],
  ['space', '1rem'],
  ['line', '1px'],
  ['leading', '1.5'],
  ['shadow', '0 0 1px #000'],
  ['shadow', '0 1px 2px var(--color-muted)'],
  ['font', '"Inter", serif'],
  ['z', '10'],
  ['duration', '1s'],
  ['opacity', '0.5'],
  ['space', '0px'],
  ['space', 'calc(1px + 2px + 3px)'],
  ['tracking', '0em'],
  ['shadow', '0 0'],
  ['color', 'transparent'],
  // A string may hold the text of a substitution function.
  ['font', '"var(--font-body)", "attr(x) env(y)", serif'],
  ['font', "'The var(--x) Font', serif"],
];

test('control: Chromium refuses a value that is no CSS, and it takes a value that is CSS', async () => {
  assert.equal(await (await thePage()).evaluate(() => document.compatMode), 'CSS1Compat');
  assert.deepEqual(
    await refusedOf(NO_CSS),
    NO_CSS.map(([, value]) => value),
  );
  assert.deepEqual(await refusedOf(CSS_VALUES), []);
});

/** Runs in the page: the words that leave a custom property without a value. Those are the CSS-wide keywords. */
function wideInPage(words: string[]): string[] {
  const root = document.documentElement;
  const wide = words.filter((word) => {
    root.style.removeProperty('--probe');
    root.style.setProperty('--probe', word);
    return getComputedStyle(root).getPropertyValue('--probe') === '';
  });
  root.style.cssText = '';
  return wide;
}

/** The CSS-wide keywords of every Chromium version. */
const ALWAYS_WIDE: readonly string[] = ['inherit', 'initial', 'unset', 'revert', 'revert-layer'];

test('control: the kit refuses every CSS-wide keyword of Chromium as a font name', async () => {
  const kit = await loadKit();
  // The list is wider than the list of the kit: Chromium says which words are keywords, not this file.
  const words = [...new Set(dictionaryOf(kit).flatMap((word) => [word, word.toUpperCase()]))];
  const wide = await (await thePage()).evaluate(wideInPage, words);
  assert.deepEqual(
    ALWAYS_WIDE.filter((word) => !wide.includes(word)),
    [],
  );
  assert.deepEqual(
    wide.filter((word) => ['serif', 'default', 'none', 'auto'].includes(word)),
    [],
  );
  const answers = acceptedBy(kit, 'font', wide);
  assert.deepEqual(
    wide.filter((_, index) => answers[index] === true),
    [],
  );
});

test('control: every property of 7.3 takes a plain value of its family, and a rule of 7.4 frees the others', async () => {
  const plain: readonly (readonly [TokenFamily, string])[] = FAMILIES.map(
    (family) => [family, LITERALS[family][0] ?? ''] as const,
  );
  // A length is no ratio, so `aspect-ratio` refuses it: that is the one gap of a plain value with no rule of 7.4.
  assert.deepEqual(await refusedOf(plain), ['10rem']);
  const limited: readonly (readonly [TokenFamily, string])[] = [
    ['size', '10rem'],
    ['size', '16 / 9'],
    ['size', '50%'],
    ['space', 'clamp(1rem, 5%, 2.5rem)'],
    ['shadow', 'inset 0 0 0 1px #000'],
    ['shadow', '0 0 0 1px #000'],
    ['radius', '50%'],
    ['text', 'calc(100% + 0.25vw)'],
    ['tracking', 'normal'],
  ];
  const seen: [value: string, gaps: string[], gapsWithoutRules: number][] = [];
  for (const [family, value] of limited) {
    const verdicts = await verdictsOf(family, [value]);
    seen.push([
      value,
      judged(family, [value], verdicts, LIMITS).gaps,
      judged(family, [value], verdicts, []).gaps.length,
    ]);
  }
  // With the rules of 7.4 no value is a gap. Without them each one is: so each rule frees a use that refuses.
  assert.deepEqual(
    seen,
    limited.map(([, value]) => [value, [], 1]),
  );
});

test('control: the kit refuses a value in its row only, and the document without it is valid', async () => {
  const kit = await loadKit();
  assert.deepEqual(acceptedBy(kit, 'space', ['1rem', 'auto', '2rem', '1rem 2rem']), [true, false, true, false]);
  assert.deepEqual(
    FAMILIES.map((family) => [family, acceptedBy(kit, family, [...ACCEPTED[family]]).filter((answer) => !answer)]),
    FAMILIES.map((family) => [family, []]),
  );
});

/** The candidates of a family that this file wants at least. */
const FEWEST = 2000;
/** The gaps that a failure shows. */
const SHOWN = 60;

for (const family of FAMILIES) {
  test(`--${family}-: every value that the kit accepts is valid CSS in Chromium`, async (t) => {
    const kit = await loadKit();
    const { count, accepted } = candidatesOf(kit, family);
    const { gaps, limited } = judged(family, accepted, await verdictsOf(family, accepted), LIMITS);
    t.diagnostic(`${family}: ${count} candidates, the kit accepts ${accepted.length}, ${gaps.length} gaps`);
    for (const [rule, values] of limited) t.diagnostic(`${family}: ${values} accepted values where ${rule}`);
    assert.ok(count >= FEWEST, `${family} has ${count} candidates`);
    assert.ok(accepted.length >= ACCEPTED[family].length, `the kit accepts ${accepted.length} candidates`);
    assert.deepEqual(gaps.slice(0, SHOWN), [], `the kit accepts ${gaps.length} values that are no CSS in Chromium`);
  });
}

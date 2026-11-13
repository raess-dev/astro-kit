import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DESIGN_FILE,
  type Design,
  familyOf,
  HELPER_PARAMETERS,
  loadDesign,
  NAMED_COLORS,
  parseDesign,
  THEME_FALLBACKS,
  TOKEN_PREFIXES,
  type TokenFamily,
} from '../../src/design/parse.ts';
import { THEMES } from '../../src/modes.ts';
import { Report } from '../../src/registry.ts';
import { inTemp } from './fixtures.ts';
import { SPEC, specBlock } from './spec.ts';

const RULE = 'design-format';

// Helpers. None asserts: a helper throws an `Error` for an input that the test did not mean.

interface Seen {
  design: Design | undefined;
  /** Every finding as `<where>: <detail>`, in the order of the report. */
  findings: string[];
  /** The sorted rule ids of the findings that fail. */
  ids: string[];
}

function seenOf(report: Report, design: Design | undefined): Seen {
  return {
    design,
    findings: report.findings.map((entry) => `${entry.where}: ${entry.detail}`),
    ids: [...report.ids()].sort(),
  };
}

/** Parses a text of `docs/design.md`. */
function check(text: string): Seen {
  const report = new Report();
  return seenOf(report, parseDesign(text, report));
}

/** The line, from 1, of the first line that holds the text. */
function lineOf(text: string, needle: string): number {
  const index = text.split('\n').findIndex((line) => line.includes(needle));
  if (index < 0) throw new Error(`the text has no line with ${JSON.stringify(needle)}`);
  return index + 1;
}

/** The line of the heading of a section. */
const headingLine = (text: string, section: string): number =>
  text.split('\n').indexOf(`## ${section}`) + 1 || lineOf(text, `## ${section} is not in the text`);

/** The line of the header row of the table of a section. */
function headerLine(text: string, section: string): number {
  const lines = text.split('\n');
  const index = lines.findIndex((line, at) => at >= headingLine(text, section) && line.startsWith('|'));
  if (index < 0) throw new Error(`## ${section} has no table`);
  return index + 1;
}

/** The text with one part replaced. The part stands in the text exactly once. */
function swap(text: string, from: string, to: string): string {
  if (text.split(from).length !== 2) throw new Error(`${JSON.stringify(from)} is not in the text exactly once`);
  return text.replace(from, () => to);
}

/** The text with one more row at the end of the table of a section. */
function addRow(text: string, section: string, row: string): string {
  const lines = text.split('\n');
  let last = headerLine(text, section);
  while (lines[last]?.startsWith('|')) last += 1;
  return [...lines.slice(0, last), row, ...lines.slice(last)].join('\n');
}

/** Where a finding stands: a line number, the first line that holds a text, or the file itself. */
type Place = string | number | undefined;

/** A finding as the report prints it. */
function finding(text: string, place: Place, detail: string): string {
  if (place === undefined) return `${DESIGN_FILE}: ${detail}`;
  return `${DESIGN_FILE}:${typeof place === 'number' ? place : lineOf(text, place)}: ${detail}`;
}

// The texts

/**
 * The smallest text that passes `design-format`: the theme `light`, one color, one `--font-`, one `--text-` and one
 * `--space-` row, no breakpoint, one pair.
 */
const SMALLEST_DESIGN_MD = [
  '## Themes',
  '',
  '| Theme | Use |',
  '|---|---|',
  '| light | The one theme. |',
  '',
  '## Color',
  '',
  '| Token | light | Use |',
  '|---|---|---|',
  '| `--color-text` | `#222222` | Text. |',
  '',
  '## Typography',
  '',
  '| Token | Value | Use |',
  '|---|---|---|',
  '| `--font-body` | `system-ui, sans-serif` | Body text. |',
  '| `--text-m` | `1rem` | Body text. |',
  '',
  '## Spacing',
  '',
  '| Token | Value | Use |',
  '|---|---|---|',
  '| `--space-2` | `0.5rem` | A small gap. |',
  '',
  '## Breakpoints',
  '',
  '| Name | Width | Use |',
  '|---|---|---|',
  '',
  '## Contrast pairs',
  '',
  '| Foreground | Background | Role | For |',
  '|---|---|---|---|',
  '| `--color-text` | `--color-text` | text | body |',
  '',
].join('\n');

/**
 * A text with every section of 7.4, in another order than the kit renders them. It also holds what the parser must
 * not read: a table before the first section, and an unknown section with a table.
 */
const FULL_MD = [
  '# Design',
  '',
  'The plan of the look. A table before the first section is prose:',
  '',
  '| Token | Value |',
  '|---|---|',
  '| --space-0 | 0 |',
  '',
  '## Brand',
  '',
  'Calm and warm. An unknown section is prose, and so is its table. `## Color` in a line is no heading.',
  '',
  '| Token | Value | Use |',
  '|---|---|---|',
  '| --brand-x | 13px | Not read. |',
  '',
  '## Gradient',
  '',
  '| Token | Value | Use |',
  '|---|---|---|',
  '| `--gradient-hero` | `linear-gradient(135deg, var(--color-page) 0%, var(--color-muted) 60%)` | The hero. |',
  '',
  '## Themes',
  '',
  '| Theme | Use |',
  '|---|---|',
  '| dark-contrast | Dark, with more contrast. |',
  '| light | The default theme. |',
  '| light-contrast | Light, with more contrast. |',
  '| dark | The dark theme. |',
  '',
  '## Color',
  '',
  '| Token | light | dark | light-contrast | dark-contrast | Use |',
  '|---|---|---|---|---|---|',
  '| `--color-page` | `#ffffff` | `#111111` | | | The page. |',
  '| `--color-text` | `#222222` | `#eeeeee` | `#000000` | `#ffffff` | Text. |',
  '|   --color-muted   |   #555555   | `#bbbbbb` | `#333333` | `#dddddd` | Secondary text. |',
  '| --color-link | var(--color-text) |',
  '',
  '## Spacing',
  '',
  '| Token | Value | Use |',
  '|:---|:---:|---:|',
  '| `--space-2` | `0.5rem` | A small gap. |',
  '| `--space-4` | `clamp(1rem, 0.5rem + 2vw, 2rem)` | A fluid gap. |',
  '',
  '## Typography',
  '',
  '| Token | Value | Use |',
  '|---|---|---|',
  '| `--font-body` | `system-ui, sans-serif` | Body text. |',
  '| `--text-m` | `1rem` | Body text. |',
  '| `--leading-m` | `1.5` | Body text. |',
  '| `--weight-bold` | `700` | Titles. |',
  '| `--tracking-wide` | `0.02em` | Small capitals. |',
  '',
  '### The scale',
  '',
  'A deeper heading stays inside its section.',
  '',
  '## Motion',
  '',
  '| Token | Value | Use |',
  '|---|---|---|',
  '| `--ease-out` | `cubic-bezier(0.2, 0, 0, 1)` | Things that enter. |',
  '| `--duration-fast` | `150ms` | Hover. |',
  '',
  '## Size',
  '',
  '| Token | Value | Use |',
  '|---|---|---|',
  '| `--size-content` | `65ch` | The text column. |',
  '| `--size-wide` | `16 / 9` | Wide media. |',
  '',
  '## Radius',
  '',
  '| Token | Value | Use |',
  '|---|---|---|',
  '| `--radius-m` | `0.25rem` | Cards. |',
  '',
  '## Line',
  '',
  '| Token | Value | Use |',
  '|---|---|---|',
  '| `--line-1` | `1px` | Borders. |',
  '',
  '## Shadow',
  '',
  '| Token | Value | Use |',
  '|---|---|---|',
  '| `--shadow-card` | `0 0.5rem 1.5rem var(--color-muted)` | Cards. |',
  '',
  '## Layer',
  '',
  '| Token | Value | Use |',
  '|---|---|---|',
  '| `--z-menu` | `10` | The menu. |',
  '',
  '## Opacity',
  '',
  '| Token | Value | Use |',
  '|---|---|---|',
  '| `--opacity-half` | `0.5` | Disabled things. |',
  '',
  '## Layout helpers',
  '',
  '| Parameter | Token | Use |',
  '|---|---|---|',
  '| `--stack-gap` | `var(--space-2)` | The gap of a stack. |',
  '| `--center-gutter` | `var(--space-4)` | The gutter of the page. |',
  '',
  '## Breakpoints',
  '',
  '| Name | Width | Use |',
  '|---|---|---|',
  '| m | 48rem | Two columns. |',
  '',
  '## Contrast pairs',
  '',
  '| Foreground | Background | Role | For |',
  '|---|---|---|---|',
  '| `--color-text` | `--color-page` | text | body |',
  '| `--color-link` | `--color-page` | ui | link |',
  '',
  '## Elements',
  '',
  '| Selector | Property | Token |',
  '|---|---|---|',
  '| h1 | color | `--color-text` |',
  '',
  '## Components',
  '',
  '| Selector | Property | Token |',
  '|---|---|---|',
  '| .card | border-radius | `--radius-m` |',
  '',
  '## Roles',
  '',
  'The owner approves each change. A table here is prose:',
  '',
  '| Token | Value | Use |',
  '|---|---|---|',
  '| --role-x | 13px | Not read. |',
  '',
  '## Voice',
  '',
  'Short sentences.',
  '',
].join('\n');

const fullLine = (needle: string): number => lineOf(FULL_MD, needle);

/** The model of `FULL_MD`: the themes in the order of 7.4, and the tokens in the section order of 7.7. */
const FULL_DESIGN: Design = {
  themes: ['light', 'dark', 'light-contrast', 'dark-contrast'],
  colors: [
    {
      name: '--color-page',
      values: { light: '#ffffff', dark: '#111111' },
      line: fullLine('`--color-page` | `#ffffff`'),
    },
    {
      name: '--color-text',
      values: { light: '#222222', dark: '#eeeeee', 'light-contrast': '#000000', 'dark-contrast': '#ffffff' },
      line: fullLine('`--color-text` | `#222222`'),
    },
    {
      name: '--color-muted',
      values: { light: '#555555', dark: '#bbbbbb', 'light-contrast': '#333333', 'dark-contrast': '#dddddd' },
      line: fullLine('--color-muted   |'),
    },
    { name: '--color-link', values: { light: 'var(--color-text)' }, line: fullLine('| --color-link |') },
  ],
  tokens: [
    { name: '--font-body', family: 'font', value: 'system-ui, sans-serif', line: fullLine('`--font-body`') },
    { name: '--text-m', family: 'text', value: '1rem', line: fullLine('`--text-m`') },
    { name: '--leading-m', family: 'leading', value: '1.5', line: fullLine('`--leading-m`') },
    { name: '--weight-bold', family: 'weight', value: '700', line: fullLine('`--weight-bold`') },
    { name: '--tracking-wide', family: 'tracking', value: '0.02em', line: fullLine('`--tracking-wide`') },
    { name: '--space-2', family: 'space', value: '0.5rem', line: fullLine('`--space-2` |') },
    { name: '--space-4', family: 'space', value: 'clamp(1rem, 0.5rem + 2vw, 2rem)', line: fullLine('`--space-4` |') },
    { name: '--size-content', family: 'size', value: '65ch', line: fullLine('`--size-content`') },
    { name: '--size-wide', family: 'size', value: '16 / 9', line: fullLine('`--size-wide`') },
    { name: '--radius-m', family: 'radius', value: '0.25rem', line: fullLine('`--radius-m` | `0.25rem`') },
    { name: '--line-1', family: 'line', value: '1px', line: fullLine('`--line-1`') },
    {
      name: '--shadow-card',
      family: 'shadow',
      value: '0 0.5rem 1.5rem var(--color-muted)',
      line: fullLine('`--shadow-card`'),
    },
    { name: '--z-menu', family: 'z', value: '10', line: fullLine('`--z-menu`') },
    { name: '--ease-out', family: 'ease', value: 'cubic-bezier(0.2, 0, 0, 1)', line: fullLine('`--ease-out`') },
    { name: '--duration-fast', family: 'duration', value: '150ms', line: fullLine('`--duration-fast`') },
    { name: '--opacity-half', family: 'opacity', value: '0.5', line: fullLine('`--opacity-half`') },
    {
      name: '--gradient-hero',
      family: 'gradient',
      value: 'linear-gradient(135deg, var(--color-page) 0%, var(--color-muted) 60%)',
      line: fullLine('`--gradient-hero`'),
    },
  ],
  helpers: [
    { name: '--stack-gap', token: 'var(--space-2)', line: fullLine('`--stack-gap`') },
    { name: '--center-gutter', token: 'var(--space-4)', line: fullLine('`--center-gutter`') },
  ],
  breakpoints: [{ name: 'm', width: '48rem', line: fullLine('| m | 48rem') }],
  pairs: [
    {
      foreground: '--color-text',
      background: '--color-page',
      role: 'text',
      for: 'body',
      line: fullLine('| text | body |'),
    },
    {
      foreground: '--color-link',
      background: '--color-page',
      role: 'ui',
      for: 'link',
      line: fullLine('| ui | link |'),
    },
  ],
  elements: [{ selector: 'h1', property: 'color', token: '--color-text', line: fullLine('| h1 | color') }],
  components: [{ selector: '.card', property: 'border-radius', token: '--radius-m', line: fullLine('| .card |') }],
};

// Names

/** The rows of the prefix table of 7.3: the prefix and the section of each family, in the order of the table. */
const PREFIX_ROWS: [prefix: string, section: string][] = [
  ...SPEC.slice(
    SPEC.indexOf('### 7.3 Token families and values'),
    SPEC.indexOf('**How the families apply.**'),
  ).matchAll(/^\| `(--[a-z]+-)` \| ([A-Za-z]+) \|/gm),
].map((match) => [match[1] ?? '', match[2] ?? '']);

test('the prefixes are the ones of the table of 7.3, in its order', () => {
  assert.equal(PREFIX_ROWS.length, 16);
  assert.deepEqual(
    Object.values(TOKEN_PREFIXES),
    PREFIX_ROWS.map(([prefix]) => prefix),
  );
  assert.deepEqual(
    Object.entries(TOKEN_PREFIXES).map(([family, prefix]) => `--${family}-` === prefix),
    PREFIX_ROWS.map(() => true),
  );
});

test('familyOf reads a name that matches ^--<prefix>[a-z0-9]+(-[a-z0-9]+)*$, and no other text', () => {
  const cases: [name: string, family: TokenFamily | undefined][] = [
    ['--color-text', 'color'],
    ['--space-2', 'space'],
    ['--size-content', 'size'],
    ['--font-body', 'font'],
    ['--text-m', 'text'],
    ['--leading-m', 'leading'],
    ['--weight-bold', 'weight'],
    ['--tracking-wide', 'tracking'],
    ['--radius-m', 'radius'],
    ['--line-1', 'line'],
    ['--shadow-card', 'shadow'],
    ['--z-menu', 'z'],
    ['--duration-fast', 'duration'],
    ['--ease-out', 'ease'],
    ['--opacity-half', 'opacity'],
    ['--gradient-hero', 'gradient'],
    ['--color-text-on-dark-2', 'color'],
    ['--space-0', 'space'],
    ['--color-', undefined],
    ['--color', undefined],
    ['--color-Text', undefined],
    ['--color-text-', undefined],
    ['--color--text', undefined],
    ['--color-text_2', undefined],
    ['-color-text', undefined],
    ['color-text', undefined],
    ['--colour-text', undefined],
    ['--stack-gap', undefined],
    ['--card-pad', undefined],
    [' --space-2', undefined],
    ['var(--space-2)', undefined],
    ['', undefined],
  ];
  assert.deepEqual(
    cases.map(([name]) => [name, familyOf(name)]),
    cases,
  );
});

test('the helper parameters are the six of 7.5, each with its family', () => {
  const rows = [
    ...SPEC.slice(SPEC.indexOf('### 7.5 Layout helpers'), SPEC.indexOf('### 7.6 base.css')).matchAll(
      /^\| `(--[a-z-]+)` \| `--([a-z]+)-` \|$/gm,
    ),
  ].map((match) => [match[1], match[2]]);
  assert.equal(rows.length, 6);
  assert.deepEqual(Object.entries(HELPER_PARAMETERS), rows);
});

test('an empty Color cell falls back along dark-contrast → dark → light and light-contrast → light', () => {
  assert.deepEqual(Object.keys(THEME_FALLBACKS), [...THEMES]);
  assert.deepEqual(THEME_FALLBACKS, {
    light: ['light'],
    dark: ['dark', 'light'],
    'light-contrast': ['light-contrast', 'light'],
    'dark-contrast': ['dark-contrast', 'dark', 'light'],
  });
});

test('the kit knows the 148 named colors of CSS', () => {
  assert.equal(NAMED_COLORS.size, 148);
  assert.deepEqual(
    [...NAMED_COLORS].filter((name) => !/^[a-z]+$/.test(name)),
    [],
  );
  assert.deepEqual(
    ['rebeccapurple', 'grey', 'gray', 'aliceblue', 'yellowgreen', 'transparent', 'currentcolor'].map((name) =>
      NAMED_COLORS.has(name),
    ),
    [true, true, true, true, true, false, false],
  );
});

// Passing texts

test('the smallest design passes: one theme, one color, a font, a text size, a space, one pair', () => {
  const seen = check(SMALLEST_DESIGN_MD);
  assert.deepEqual(seen.ids, []);
  assert.deepEqual(seen.findings, []);
  assert.deepEqual(seen.design, {
    themes: ['light'],
    colors: [{ name: '--color-text', values: { light: '#222222' }, line: 11 }],
    tokens: [
      { name: '--font-body', family: 'font', value: 'system-ui, sans-serif', line: 17 },
      { name: '--text-m', family: 'text', value: '1rem', line: 18 },
      { name: '--space-2', family: 'space', value: '0.5rem', line: 24 },
    ],
    helpers: [],
    breakpoints: [],
    pairs: [{ foreground: '--color-text', background: '--color-text', role: 'text', for: 'body', line: 35 }],
    elements: [],
    components: [],
  });
});

test('a design with every section passes, and the model has the order of 7.4 and 7.7', () => {
  const seen = check(FULL_MD);
  assert.deepEqual(seen.findings, []);
  assert.deepEqual(seen.ids, []);
  assert.deepEqual(seen.design, FULL_DESIGN);
});

test('CRLF line ends and a byte order mark change nothing', () => {
  const windows = (text: string): string => `\uFEFF${text.replaceAll('\n', '\r\n')}`;
  const seen = check(windows(FULL_MD));
  assert.deepEqual(seen.findings, []);
  assert.deepEqual(seen.design, FULL_DESIGN);
  // The smallest text starts with a heading. A byte order mark that stays would hide it.
  assert.equal(SMALLEST_DESIGN_MD.startsWith('## Themes\n'), true);
  assert.deepEqual(check(windows(SMALLEST_DESIGN_MD)).design, check(SMALLEST_DESIGN_MD).design);
  assert.deepEqual(check(windows(SMALLEST_DESIGN_MD)).findings, []);
});

test('a finding goes to the file that the caller names', () => {
  const report = new Report();
  const design = parseDesign(swap(SMALLEST_DESIGN_MD, '`1rem`', '`big`'), report, 'docs/other.md');
  assert.equal(design, undefined);
  assert.deepEqual(
    report.findings.map((entry) => [entry.rule, entry.where]),
    [[RULE, 'docs/other.md:18']],
  );
});

// The header rows and the sections of the 7.4 table

interface SectionRow {
  name: string;
  required: boolean;
  /** The header row as the specification gives it, or `undefined` for the row of `## Roles`. */
  header: string | undefined;
}

/** The rows of the section table of 7.4. One row of the specification can name several sections. */
const SECTION_ROWS: SectionRow[] = SPEC.slice(
  SPEC.indexOf('### 7.4 docs/design.md'),
  SPEC.indexOf('**Values that parse,**'),
)
  .split('\n')
  .filter((line) => line.startsWith('| `## '))
  .flatMap((line) => {
    const cells = line.split(/(?<!\\)\|/).map((cell) => cell.trim());
    const header = (cells[3] ?? '').replaceAll('`', '').replaceAll('\\|', '|');
    return [...(cells[1] ?? '').matchAll(/`## ([A-Za-z ]+)`/g)].map((match) => ({
      name: match[1] ?? '',
      required: cells[2] === 'yes',
      header: header.startsWith('|') ? header : undefined,
    }));
  });

test('the fixture holds every section of the 7.4 table, each with the header row of the table', () => {
  assert.deepEqual(
    SECTION_ROWS.map((row) => row.name),
    [
      'Themes',
      'Color',
      'Typography',
      'Spacing',
      'Breakpoints',
      'Contrast pairs',
      'Size',
      'Radius',
      'Line',
      'Shadow',
      'Layer',
      'Motion',
      'Opacity',
      'Gradient',
      'Layout helpers',
      'Elements',
      'Components',
      'Roles',
    ],
  );
  const lines = FULL_MD.split('\n');
  const fixed = SECTION_ROWS.filter((row) => row.header !== undefined && row.name !== 'Color');
  assert.equal(fixed.length, 16);
  assert.deepEqual(
    fixed.map((row) => [row.name, lines[headerLine(FULL_MD, row.name) - 1]]),
    fixed.map((row) => [row.name, row.header]),
  );
  assert.equal(
    SECTION_ROWS.find((row) => row.name === 'Color')?.header,
    '| Token | <one column per declared theme, in the order light, dark, light-contrast, dark-contrast> | Use |',
  );
  assert.equal(
    lines[headerLine(FULL_MD, 'Color') - 1],
    '| Token | light | dark | light-contrast | dark-contrast | Use |',
  );
});

test('a required section that is missing is one finding at the file, and an optional one may be missing', () => {
  const seen = SECTION_ROWS.map((row) => {
    // The heading gets another text. So the section is an unknown one, and its table is prose.
    const text = swap(FULL_MD, `\n## ${row.name}\n`, `\n## ${row.name} (old)\n`);
    return [row.name, check(text).ids, check(text).findings];
  });
  assert.deepEqual(
    seen,
    SECTION_ROWS.map((row) =>
      row.required
        ? [row.name, [RULE], [`${DESIGN_FILE}: the section \`## ${row.name}\` is missing`]]
        : [row.name, [], []],
    ),
  );
  assert.deepEqual(
    SECTION_ROWS.filter((row) => row.required).map((row) => row.name),
    ['Themes', 'Color', 'Typography', 'Spacing', 'Breakpoints', 'Contrast pairs'],
  );
});

test('a header row that differs from the one of 7.4 is one finding at its line', () => {
  const tables = SECTION_ROWS.filter((row) => row.header !== undefined);
  const seen = tables.map((row) => {
    const line = headerLine(FULL_MD, row.name);
    const lines = FULL_MD.split('\n');
    // One changed thing: the last header cell gets another text.
    const text = lines
      .map((value, index) => (index === line - 1 ? value.replace(/ \w+ \|$/, ' Notes |') : value))
      .join('\n');
    return [row.name, text === FULL_MD, check(text).ids, check(text).findings];
  });
  const color = '| Token | light | dark | light-contrast | dark-contrast | Use |';
  assert.deepEqual(
    seen,
    tables.map((row) => [
      row.name,
      false,
      [RULE],
      [
        `${DESIGN_FILE}:${headerLine(FULL_MD, row.name)}: the header row must be \`${row.name === 'Color' ? color : row.header}\``,
      ],
    ]),
  );
});

// One failing case for each sentence of the rule row and of 7.4

/** One failing case: a name, the text, and each finding with its place and its detail, in the order of the report. */
type Case = readonly [name: string, text: string, ...findings: (readonly [place: Place, detail: string])[]];

/** What a case gives and what it must give, in one shape. */
const outcome = (cases: readonly Case[]): { seen: unknown[]; expected: unknown[] } => ({
  seen: cases.map(([name, text]) => [name, check(text).ids, check(text).findings, check(text).design]),
  expected: cases.map(([name, text, ...findings]) => [
    name,
    [RULE],
    findings.map(([place, detail]) => finding(text, place, detail)),
    undefined,
  ]),
});

/** A text with the given themes and one color row. The other sections are the ones of the smallest design. */
function themed(themes: readonly string[], cells: readonly string[]): string {
  const rows = themes.map((theme) => `| ${theme} | A theme. |`).join('\n');
  const header = `| Token | ${themes.join(' | ')} | Use |\n|---|${themes.map(() => '---|').join('')}---|`;
  const text = swap(SMALLEST_DESIGN_MD, '| light | The one theme. |', rows);
  return swap(
    swap(text, '| Token | light | Use |\n|---|---|---|', header),
    '| `--color-text` | `#222222` | Text. |',
    `| --color-text | ${cells.join(' | ')} | Text. |`,
  );
}

const NO_ROW = 'the table needs at least one row';
const NO_DELIMITER = 'the line below the header row must be the delimiter row, such as `|---|---|`';
const TABLE = '| Token | Value | Use |\n|---|---|---|\n';
const SECOND_TABLE = `\n${TABLE}| --line-2 | 2px | The second table. |\n`;
const NO_FALLBACK = 'the cell is empty, and so is each cell that it falls back to';
const NO_TOKEN_NAME = 'write `--space-` and then lower-case letters, digits and single hyphens';
const PARAMETERS = '`--stack-gap`, `--cluster-gap`, `--grid-gap`, `--grid-min`, `--center-max`, `--center-gutter`';

const twoTables = swap(
  FULL_MD,
  '| `--line-1` | `1px` | Borders. |\n',
  `| \`--line-1\` | \`1px\` | Borders. |\n${SECOND_TABLE}`,
);
const sectionTwice = `${FULL_MD}\n## Spacing\n\nMore prose.\n`;
const loop = addRow(
  addRow(FULL_MD, 'Spacing', '| --space-8 | var(--space-9) | x |'),
  'Spacing',
  '| --space-9 | var(--space-8) | y |',
);
const colorLoop = addRow(
  addRow(FULL_MD, 'Color', '| --color-a | var(--color-b) | #000000 | | | x |'),
  'Color',
  '| --color-b | var(--color-a) | #ffffff | | | y |',
);

/** `FULL_MD` with more Color rows. Each row gives the name after `--color-` and the four theme cells. */
const withColors = (...rows: readonly (readonly [name: string, ...cells: string[]])[]): string =>
  rows.reduce(
    (text, [name, ...cells]) => addRow(text, 'Color', `| --color-${name} | ${cells.join(' | ')} | The row ${name}. |`),
    FULL_MD,
  );
/** The finding of each named row of `withColors`. */
const circleOf = (...names: readonly string[]): (readonly [Place, string])[] =>
  names.map((name) => [`The row ${name}.`, `the alias of \`--color-${name}\` leads back to \`--color-${name}\``]);

// `tokens.css` holds `--color-a: light-dark(var(--color-b), #111111)` and
// `--color-b: light-dark(#ffffff, var(--color-a))`. A browser reads both sides, so the two are a circle.
const schemeLoop = withColors(['a', 'var(--color-b)', '#111111', '', ''], ['b', '#ffffff', 'var(--color-a)', '', '']);
const contrastLoop = withColors(
  ['a', '#ffffff', '#111111', 'var(--color-b)', ''],
  ['b', '#ffffff', '#000000', '', 'var(--color-a)'],
);
const fallbackLoop = withColors(['a', 'var(--color-b)', '', '', ''], ['b', '#ffffff', 'var(--color-a)', '', '']);
// `e` joins the circle b → c → d → b through the dark side of `c`. `f` leads into the circle and is not on it.
const sharedLoop = withColors(
  ['b', 'var(--color-c)', '#000000', '', ''],
  ['c', 'var(--color-d)', 'var(--color-e)', '', ''],
  ['d', 'var(--color-b)', '#000000', '', ''],
  ['e', 'var(--color-d)', '#000000', '', ''],
  ['f', 'var(--color-b)', '#000000', '', ''],
);

test('sections and tables: each sentence of 7.4 has a failing case with exactly its finding', () => {
  const { seen, expected } = outcome([
    [
      'a heading in another letter case is another section',
      swap(FULL_MD, '\n## Themes\n', '\n## themes\n'),
      [undefined, 'the section `## Themes` is missing'],
    ],
    [
      'a section twice',
      sectionTwice,
      [lineOf(sectionTwice, 'More prose.') - 2, 'the section `## Spacing` is in the file twice'],
    ],
    [
      'an optional token section without a table',
      swap(FULL_MD, `${TABLE}| \`--radius-m\` | \`0.25rem\` | Cards. |\n`, 'Later.\n'),
      ['## Radius', 'the section `## Radius` has no table'],
    ],
    [
      'a required section without a table',
      swap(SMALLEST_DESIGN_MD, '| Name | Width | Use |\n|---|---|---|\n', 'None.\n'),
      ['## Breakpoints', 'the section `## Breakpoints` has no table'],
    ],
    [
      'two tables in one section',
      twoTables,
      [lineOf(twoTables, 'The second table.') - 2, 'the section `## Line` holds one table: this is a second one'],
    ],
    [
      'an empty line inside a table starts a second table',
      swap(FULL_MD, '| `--text-m` | `1rem` | Body text. |\n', '| `--text-m` | `1rem` | Body text. |\n\n'),
      ['`--leading-m`', 'the section `## Typography` holds one table: this is a second one'],
    ],
    [
      'no delimiter row',
      swap(SMALLEST_DESIGN_MD, `${TABLE}| \`--space-2\``, '| Token | Value | Use |\n| `--space-2`'),
      [headerLine(SMALLEST_DESIGN_MD, 'Spacing'), NO_DELIMITER],
    ],
    [
      'a delimiter row with fewer cells than the header row',
      swap(SMALLEST_DESIGN_MD, `${TABLE}| \`--space-2\``, '| Token | Value | Use |\n|---|---|\n| `--space-2`'),
      [headerLine(SMALLEST_DESIGN_MD, 'Spacing'), NO_DELIMITER],
    ],
    [
      'a row with more cells than the header row',
      swap(SMALLEST_DESIGN_MD, '| A small gap. |', '| A small gap. | More. |'),
      ['More.', 'the row has 4 cells, and the header row has 3'],
    ],
    [
      'a Color header with the themes in another order',
      swap(FULL_MD, '| Token | light | dark | light-contrast |', '| Token | dark | light | light-contrast |'),
      [
        '| Token | dark | light |',
        'the header row must be `| Token | light | dark | light-contrast | dark-contrast | Use |`',
      ],
    ],
    [
      'a Color column of a theme that is not declared',
      swap(
        SMALLEST_DESIGN_MD,
        '| Token | light | Use |\n|---|---|---|',
        '| Token | light | dark | Use |\n|---|---|---|---|',
      ),
      ['| Token | light | dark | Use |', 'the header row must be `| Token | light | Use |`'],
    ],
    [
      'no Color column for a declared theme',
      addRow(SMALLEST_DESIGN_MD, 'Themes', '| dark | The dark theme. |'),
      ['| Token | light | Use |', 'the header row must be `| Token | light | dark | Use |`'],
    ],
  ]);
  assert.deepEqual(seen, expected);
});

test('what is no section and no table of the kit is prose', () => {
  const fence = `## Spacing\n\n${TABLE}| --space-2 | 9rem | In a code fence. |\n`;
  const texts: [name: string, text: string][] = [
    ['a section in a code fence', `${FULL_MD}\n\`\`\`md\n${fence}\`\`\`\n`],
    ['a section in a longer fence with a shorter one inside', `${FULL_MD}\n~~~~\n~~~\n${fence}~~~~\n`],
    ['a `# ` heading ends the section', swap(twoTables, SECOND_TABLE, `\n# Notes\n${SECOND_TABLE}`)],
    ['an escaped pipe is part of its cell', swap(SMALLEST_DESIGN_MD, '| A small gap. |', '| A gap \\| a gutter. |')],
    ['a row with fewer cells than the header row', swap(SMALLEST_DESIGN_MD, ' A small gap. |', '')],
    ['a table line with spaces before it', swap(SMALLEST_DESIGN_MD, '| `--space-2`', '   | `--space-2`')],
  ];
  assert.deepEqual(
    texts.map(([name, text]) => [name, check(text).findings]),
    texts.map(([name]) => [name, []]),
  );
  // The same section without the fence is a finding. So the fence is what hides it.
  assert.deepEqual(check(`${FULL_MD}\n${fence}`).ids, [RULE]);
});

test('a prose line that starts with inline code in three backticks opens no fence', () => {
  const size = `## Size\n\n${TABLE}| --size-card | 20rem | Cards. |\n`;
  const prose = '```--color-text``` is the color of the text.';
  const names = (text: string): string[] | undefined => check(text).design?.tokens.map((token) => token.name);
  const expected = ['--font-body', '--text-m', '--space-2', '--size-card'];
  // The section after the line is read: its token is in the design.
  assert.deepEqual(names(`${SMALLEST_DESIGN_MD}\n## Voice\n\n${prose}\n\n${size}`), expected);
  assert.deepEqual(names(`${SMALLEST_DESIGN_MD}\n## Voice\n\n   ${prose}\n\n${size}`), expected);
  // The line before the first section hides no required section.
  assert.deepEqual(check(`${prose}\n\n${SMALLEST_DESIGN_MD}`).findings, []);
  // A real fence with an info text still hides the section.
  assert.deepEqual(names(`${SMALLEST_DESIGN_MD}\n\`\`\`md title\n${size}\`\`\`\n`), expected.slice(0, 3));
  assert.deepEqual(names(`${SMALLEST_DESIGN_MD}\n~~~ a \`b\` c\n${size}~~~\n`), expected.slice(0, 3));
});

test('names: a known prefix, the right section, and no name twice', () => {
  const { seen, expected } = outcome([
    [
      'an unknown prefix',
      addRow(SMALLEST_DESIGN_MD, 'Spacing', '| --gap-2 | 1rem | x |'),
      ['--gap-2', `\`--gap-2\` is no token name: ${NO_TOKEN_NAME}`],
    ],
    [
      'an upper-case letter',
      addRow(SMALLEST_DESIGN_MD, 'Spacing', '| --space-M | 1rem | x |'),
      ['--space-M', `\`--space-M\` is no token name: ${NO_TOKEN_NAME}`],
    ],
    [
      'a name without its two hyphens',
      addRow(SMALLEST_DESIGN_MD, 'Spacing', '| space-3 | 1rem | x |'),
      ['| space-3', `\`space-3\` is no token name: ${NO_TOKEN_NAME}`],
    ],
    [
      'a helper parameter in a token section',
      addRow(SMALLEST_DESIGN_MD, 'Spacing', '| --stack-gap | 1rem | x |'),
      ['--stack-gap', `\`--stack-gap\` is no token name: ${NO_TOKEN_NAME}`],
    ],
    [
      'an empty Token cell',
      addRow(SMALLEST_DESIGN_MD, 'Spacing', '| | 1rem | No name. |'),
      ['No name.', 'the cell `Token` is empty'],
    ],
    [
      'a token of another family in Color',
      addRow(FULL_MD, 'Color', '| --space-9 | #ffffff | #000000 | | | x |'),
      ['--space-9', '`--space-9` belongs in `## Spacing`: `## Color` holds `--color-`'],
    ],
    [
      'a token twice',
      addRow(SMALLEST_DESIGN_MD, 'Spacing', '| --space-2 | 1rem | Again. |'),
      ['Again.', '`--space-2` is declared twice: the first row is on line 24'],
    ],
    [
      'a color twice',
      addRow(SMALLEST_DESIGN_MD, 'Color', '| --color-text | #000000 | Again. |'),
      ['Again.', '`--color-text` is declared twice: the first row is on line 11'],
    ],
    [
      'a theme twice',
      addRow(SMALLEST_DESIGN_MD, 'Themes', '| light | Again. |'),
      ['Again.', '`light` is declared twice: the first row is on line 5'],
    ],
    [
      'a helper parameter twice',
      addRow(FULL_MD, 'Layout helpers', '| --stack-gap | var(--space-4) | Again. |'),
      ['Again.', `\`--stack-gap\` is declared twice: the first row is on line ${lineOf(FULL_MD, '`--stack-gap`')}`],
    ],
    [
      'a breakpoint twice',
      addRow(FULL_MD, 'Breakpoints', '| m | 60rem | Again. |'),
      ['Again.', `\`m\` is declared twice: the first row is on line ${lineOf(FULL_MD, '| m | 48rem')}`],
    ],
  ]);
  assert.deepEqual(seen, expected);
});

test('each prefix of 7.3 belongs in its section and fails in another one', () => {
  const held = '`--font-`, `--text-`, `--leading-`, `--weight-`, `--tracking-`';
  const cases = PREFIX_ROWS.map(([prefix, section]): Case => {
    // A `--space-` token goes into Typography, and every other token into Spacing.
    const [wrong, holds] = prefix === '--space-' ? ['Typography', held] : ['Spacing', '`--space-`'];
    return [
      `${prefix} in ${wrong}`,
      addRow(FULL_MD, wrong, `| ${prefix}probe | 1rem | x |`),
      [`${prefix}probe`, `\`${prefix}probe\` belongs in \`## ${section}\`: \`## ${wrong}\` holds ${holds}`],
    ];
  });
  const { seen, expected } = outcome(cases);
  assert.deepEqual(seen, expected);
});

test('themes: a base theme, and each contrast theme with its base theme', () => {
  const { seen, expected } = outcome([
    [
      'no theme',
      swap(SMALLEST_DESIGN_MD, '| light | The one theme. |\n', ''),
      [headerLine(SMALLEST_DESIGN_MD, 'Themes'), 'declare at least one of the base themes `light` and `dark`'],
    ],
    [
      'an unknown theme',
      addRow(SMALLEST_DESIGN_MD, 'Themes', '| sepia | Warm. |'),
      ['sepia', '`sepia` is no theme: the themes are `light`, `dark`, `light-contrast`, `dark-contrast`'],
    ],
    [
      'light-contrast without light',
      themed(['dark', 'light-contrast'], ['#111111', '#000000']),
      ['| light-contrast |', '`light-contrast` needs the theme `light`'],
    ],
    [
      'dark-contrast without dark',
      themed(['light', 'dark-contrast'], ['#ffffff', '#000000']),
      ['| dark-contrast |', '`dark-contrast` needs the theme `dark`'],
    ],
  ]);
  assert.deepEqual(seen, expected);
});

test('of the fifteen theme sets, the eight of 7.4 pass', () => {
  const sets = Array.from({ length: 15 }, (_, bits) =>
    THEMES.filter((_theme, index) => ((bits + 1) & (1 << index)) !== 0),
  );
  const passing = sets.filter(
    (themes) =>
      check(
        themed(
          themes,
          themes.map(() => '#123456'),
        ),
      ).ids.length === 0,
  );
  assert.deepEqual(
    passing.map((themes) => themes.join(' ')),
    [
      'light',
      'dark',
      'light dark',
      'light light-contrast',
      'light dark light-contrast',
      'dark dark-contrast',
      'light dark dark-contrast',
      'light dark light-contrast dark-contrast',
    ],
  );
  assert.deepEqual(
    passing.map(
      (themes) =>
        check(
          themed(
            themes,
            themes.map(() => '#123456'),
          ),
        ).design?.themes,
    ),
    passing,
  );
});

test('Color cells: a value or a fallback for every declared theme', () => {
  const four = ['light', 'dark', 'light-contrast', 'dark-contrast'];
  const passing: [themes: string[], cells: string[]][] = [
    [
      ['light', 'dark'],
      ['#ffffff', ''],
    ],
    [four, ['#ffffff', '', '', '']],
    [four, ['#ffffff', '', '', '#000000']],
    [
      ['light', 'light-contrast'],
      ['#ffffff', ''],
    ],
    [
      ['dark', 'dark-contrast'],
      ['#111111', ''],
    ],
    [
      ['light', 'dark', 'dark-contrast'],
      ['#ffffff', '', ''],
    ],
  ];
  assert.deepEqual(
    passing.map(([themes, cells]) => check(themed(themes, cells)).findings),
    passing.map(() => []),
  );
  const { seen, expected } = outcome([
    [
      'an empty light cell',
      themed(['light', 'dark'], ['', '#111111']),
      ['--color-text |  |', `\`--color-text\` has no value for \`light\`: ${NO_FALLBACK}`],
    ],
    [
      'an empty light cell with four themes',
      themed(four, ['', '#111111', '', '#000000']),
      ['--color-text |  |', `\`--color-text\` has no value for \`light\`, \`light-contrast\`: ${NO_FALLBACK}`],
    ],
    [
      'only dark, and its cell is empty',
      themed(['dark'], ['']),
      ['--color-text |  |', `\`--color-text\` has no value for \`dark\`: ${NO_FALLBACK}`],
    ],
    [
      'an empty dark cell without light: dark-contrast gives no value to dark',
      themed(['dark', 'dark-contrast'], ['', '#000000']),
      ['--color-text |  |', `\`--color-text\` has no value for \`dark\`: ${NO_FALLBACK}`],
    ],
    [
      'every cell empty',
      themed(['light', 'dark'], ['', '']),
      ['--color-text |  |', `\`--color-text\` has no value for \`light\`, \`dark\`: ${NO_FALLBACK}`],
    ],
  ]);
  assert.deepEqual(seen, expected);
});

test('counts: a Color row, a --font- row, a --text- row, a Spacing row and a pair', () => {
  const { seen, expected } = outcome([
    [
      'no Color row',
      swap(SMALLEST_DESIGN_MD, '| `--color-text` | `#222222` | Text. |\n', ''),
      [headerLine(SMALLEST_DESIGN_MD, 'Color'), NO_ROW],
    ],
    [
      'no --font- row',
      swap(SMALLEST_DESIGN_MD, '| `--font-body` | `system-ui, sans-serif` | Body text. |\n', ''),
      [headerLine(SMALLEST_DESIGN_MD, 'Typography'), 'the table needs at least one `--font-` row'],
    ],
    [
      'no --text- row',
      swap(SMALLEST_DESIGN_MD, '| `--text-m` | `1rem` | Body text. |\n', ''),
      [headerLine(SMALLEST_DESIGN_MD, 'Typography'), 'the table needs at least one `--text-` row'],
    ],
    [
      'a --leading- row is no --text- row',
      swap(SMALLEST_DESIGN_MD, '| `--text-m` | `1rem` | Body text. |', '| `--leading-m` | `1.5` | Body text. |'),
      [headerLine(SMALLEST_DESIGN_MD, 'Typography'), 'the table needs at least one `--text-` row'],
    ],
    [
      'no Spacing row',
      swap(SMALLEST_DESIGN_MD, '| `--space-2` | `0.5rem` | A small gap. |\n', ''),
      [headerLine(SMALLEST_DESIGN_MD, 'Spacing'), NO_ROW],
    ],
    [
      'no pair',
      swap(SMALLEST_DESIGN_MD, '| `--color-text` | `--color-text` | text | body |\n', ''),
      [headerLine(SMALLEST_DESIGN_MD, 'Contrast pairs'), 'the table needs at least one pair'],
    ],
  ]);
  assert.deepEqual(seen, expected);
});

test('an unknown role of a pair is no design-format finding: design-pairs checks it', () => {
  const seen = check(swap(SMALLEST_DESIGN_MD, '| text | body |', '| loud | body |'));
  assert.deepEqual(seen.ids, []);
  assert.equal(seen.design?.pairs[0]?.role, 'loud');
});

test('breakpoints: the name and the width have the patterns of 7.4', () => {
  const passing = ['| m | 48rem | x |', '| tablet-2 | 768px | x |', '| a | 30.5em | x |', '| `wide` | `80rem` | x |'];
  assert.deepEqual(
    passing.map((row) => [row, check(addRow(SMALLEST_DESIGN_MD, 'Breakpoints', row)).findings]),
    passing.map((row) => [row, []]),
  );
  const noName = 'is no breakpoint name: start with a lower-case letter, then letters, digits and hyphens';
  const noWidth = 'is no breakpoint width: write a number with `rem`, `em` or `px`, such as `48rem`';
  const names = ['M', '2col', '-m', 'a_b', ''];
  const widths = ['48', '48vw', '.5rem', '48.rem', '48REM', '48 rem', '-48rem', 'calc(48rem)', ''];
  const { seen, expected } = outcome([
    ...names.map(
      (name): Case => [
        `the name ${name}`,
        addRow(SMALLEST_DESIGN_MD, 'Breakpoints', `| ${name} | 48rem | The probe. |`),
        ['The probe.', `\`${name}\` ${noName}`],
      ],
    ),
    ...widths.map(
      (width): Case => [
        `the width ${width}`,
        addRow(SMALLEST_DESIGN_MD, 'Breakpoints', `| m | ${width} | The probe. |`),
        ['The probe.', `\`${width}\` ${noWidth}`],
      ],
    ),
  ]);
  assert.deepEqual(seen, expected);
});

test('layout helpers: a parameter of 7.5, set to var() of a token of its family', () => {
  // The fixture sets two of the six parameters. The other four get a row here.
  const more = Object.entries(HELPER_PARAMETERS).filter(([name]) => !FULL_MD.includes(`| \`${name}\` |`));
  const all = more.reduce(
    (text, [name, family]) =>
      addRow(text, 'Layout helpers', `| ${name} | var(${family === 'space' ? '--space-4' : '--size-content'}) | x |`),
    FULL_MD,
  );
  assert.equal(more.length, 4);
  assert.deepEqual(check(all).findings, []);
  assert.deepEqual(
    check(all).design?.helpers.map((helper) => helper.name),
    ['--stack-gap', '--center-gutter', '--cluster-gap', '--grid-gap', '--grid-min', '--center-max'],
  );
  const { seen, expected } = outcome([
    [
      'an unknown parameter',
      addRow(FULL_MD, 'Layout helpers', '| --stack-space | var(--space-2) | x |'),
      ['--stack-space', `\`--stack-space\` is no helper parameter: the parameters are ${PARAMETERS}`],
    ],
    [
      'a token as a parameter',
      addRow(FULL_MD, 'Layout helpers', '| --space-9 | var(--space-2) | x |'),
      ['--space-9', `\`--space-9\` is no helper parameter: the parameters are ${PARAMETERS}`],
    ],
    [
      'a space parameter with a size token',
      addRow(FULL_MD, 'Layout helpers', '| --grid-gap | var(--size-content) | x |'),
      ['--grid-gap', 'the token of `--grid-gap` must be `var(--space-…)`'],
    ],
    [
      'a size parameter with a space token',
      addRow(FULL_MD, 'Layout helpers', '| --grid-min | var(--space-2) | x |'),
      ['--grid-min', 'the token of `--grid-min` must be `var(--size-…)`'],
    ],
    [
      'a value that is no var()',
      addRow(FULL_MD, 'Layout helpers', '| --grid-gap | 1rem | x |'),
      ['--grid-gap', 'the token of `--grid-gap` must be `var(--space-…)`'],
    ],
    [
      'a token name without var()',
      addRow(FULL_MD, 'Layout helpers', '| --grid-gap | --space-2 | x |'),
      ['--grid-gap', 'the token of `--grid-gap` must be `var(--space-…)`'],
    ],
    [
      'a var() with a fallback',
      addRow(FULL_MD, 'Layout helpers', '| --grid-gap | var(--space-2, 1rem) | x |'),
      ['--grid-gap', 'the token of `--grid-gap` must be `var(--space-…)`'],
    ],
    [
      'a token that the file does not declare',
      addRow(FULL_MD, 'Layout helpers', '| --grid-gap | var(--space-9) | x |'),
      ['--grid-gap', '`var(--space-9)` names no token of this file'],
    ],
  ]);
  assert.deepEqual(seen, expected);
});

test('an alias names a declared token of the same family, and no alias leads back to its token', () => {
  const passing = addRow(
    addRow(FULL_MD, 'Spacing', '| --space-8 | var(--space-9) | x |'),
    'Spacing',
    '| --space-9 | var( --space-2 ) | y |',
  );
  assert.deepEqual(check(passing).findings, []);
  const { seen, expected } = outcome([
    [
      'an alias of another family',
      addRow(FULL_MD, 'Spacing', '| --space-9 | var(--size-content) | x |'),
      ['--space-9', '`var(--size-content)` is no alias for a `--space-` token: an alias is `var(--space-…)`'],
    ],
    [
      'a color alias of another family',
      addRow(FULL_MD, 'Color', '| --color-a | var(--space-2) | | | | x |'),
      ['--color-a', '`var(--space-2)` is no alias for a `--color-` token: an alias is `var(--color-…)`'],
    ],
    [
      'an alias of a helper parameter',
      addRow(FULL_MD, 'Spacing', '| --space-9 | var(--stack-gap) | x |'),
      ['--space-9', '`var(--stack-gap)` is no alias for a `--space-` token: an alias is `var(--space-…)`'],
    ],
    [
      'an alias of a token that the file does not declare',
      addRow(FULL_MD, 'Spacing', '| --space-9 | var(--space-8) | x |'),
      ['--space-9', '`var(--space-8)` names no token of this file'],
    ],
    [
      'a color alias of a token that the file does not declare',
      addRow(FULL_MD, 'Color', '| --color-a | #ffffff | var(--color-none) | | | x |'),
      ['--color-a', '`var(--color-none)` names no token of this file'],
    ],
    [
      'a shadow with a color that the file does not declare',
      addRow(FULL_MD, 'Shadow', '| --shadow-x | 0 1px 2px var(--color-none) | x |'),
      ['--shadow-x', '`var(--color-none)` names no token of this file'],
    ],
    [
      'a gradient with a color that the file does not declare',
      addRow(FULL_MD, 'Gradient', '| --gradient-x | linear-gradient(var(--color-page), var(--color-none)) | x |'),
      ['--gradient-x', '`var(--color-none)` names no token of this file'],
    ],
    [
      'an alias of itself',
      addRow(FULL_MD, 'Spacing', '| --space-9 | var(--space-9) | x |'),
      ['--space-9', 'the alias of `--space-9` leads back to `--space-9`'],
    ],
    [
      'two aliases in a circle',
      loop,
      ['| --space-8 |', 'the alias of `--space-8` leads back to `--space-8`'],
      ['| --space-9 |', 'the alias of `--space-9` leads back to `--space-9`'],
    ],
    [
      'two color aliases in a circle, in the light themes only',
      colorLoop,
      ['| --color-a |', 'the alias of `--color-a` leads back to `--color-a`'],
      ['| --color-b |', 'the alias of `--color-b` leads back to `--color-b`'],
    ],
    ['a circle through the light side of one color and the dark side of another', schemeLoop, ...circleOf('a', 'b')],
    ['the same circle at the contrast level', contrastLoop, ...circleOf('a', 'b')],
    ['a circle through a cell that falls back to `light`', fallbackLoop, ...circleOf('a', 'b')],
    [
      'two circles that share colors, and a color that only leads into them',
      sharedLoop,
      ...circleOf('b', 'c', 'd', 'e'),
    ],
  ]);
  assert.deepEqual(seen, expected);
  // Two aliases that cross the schemes without a circle pass.
  const crossing = withColors(
    ['a', 'var(--color-b)', '#111111', '', ''],
    ['b', '#ffffff', 'var(--color-text)', '', ''],
  );
  assert.deepEqual(check(crossing).findings, []);
});

test('a long chain of aliases is read once: no circle, a circle, and the time', () => {
  const count = 4000;
  const rows = (last: string): string =>
    Array.from({ length: count }, (_, index) => {
      const value = index === count - 1 ? last : `var(--color-c${index + 1})`;
      return `| --color-c${index} | ${value} | | | | The row c${index}. |`;
    }).join('\n');
  const chain = addRow(FULL_MD, 'Color', rows('#000000'));
  const circle = addRow(FULL_MD, 'Color', rows('var(--color-c0)'));
  const start = performance.now();
  const seen = check(chain);
  const elapsed = performance.now() - start;
  assert.deepEqual(seen.findings, []);
  assert.equal(seen.design?.colors.length, count + FULL_DESIGN.colors.length);
  assert.equal(check(circle).findings.length, count);
  // The earlier check walked the chain again for each token and each theme: about 24 s for this text.
  assert.ok(elapsed < 5000, `parseDesign took ${Math.round(elapsed)} ms`);
});

// Values that parse (7.4)

/** The section of each family, from the table of 7.3. */
const SECTION_OF = new Map(PREFIX_ROWS);

/** `FULL_MD` with one more token of the family. A color has the value in its `light` cell. */
function probe(family: TokenFamily, value: string): string {
  const prefix = TOKEN_PREFIXES[family];
  const section = SECTION_OF.get(prefix);
  if (section === undefined) throw new Error(`7.3 has no section for ${prefix}`);
  const cells = family === 'color' ? `${value} | | | | The probe.` : `${value} | The probe.`;
  return addRow(FULL_MD, section, `| ${prefix}probe | ${cells} |`);
}

const LENGTHS_ACCEPTED = [
  '0',
  '0.5rem',
  '1px',
  '-1rem',
  '.5em',
  '50%',
  '100%',
  '2vw',
  '1lh',
  '10cqi',
  '2REM',
  'calc(1rem + 2px)',
  'calc(100% - 2rem)',
  'calc(1rem * 1.5)',
  'calc(100% / 3)',
  'calc((1rem + 2px) * 2)',
  'calc(1rem - -2px)',
  'clamp(1rem, 0.5rem + 2vw, 2rem)',
  'min(50%, 30rem)',
  'max(1rem, 2vw, 3px)',
  'calc(1rem + min(2vw, 1rem))',
  'CALC(1rem + 2px)',
  'calc(2 * 1rem)',
  'calc(1rem * 2 / 3 + 1px)',
  'calc(1rem * (1 + 2))',
  'calc(1rem * calc(1 / 3))',
  'calc(1rem\t+\t2px)',
  `calc(${'('.repeat(30)}1rem${')'.repeat(30)})`,
];

const LENGTHS_REFUSED = [
  '1',
  '1.5',
  '13',
  'auto',
  'none',
  '1rem 2rem',
  '1rem, 2rem',
  '16 / 9',
  '200ms',
  '45deg',
  '1fr',
  '#ffffff',
  'rem',
  '1.rem',
  'calc(1rem + )',
  'calc(1rem +2px)',
  'calc(1rem 2px)',
  'calc()',
  'min()',
  'calc(1rem, 2rem)',
  'clamp(1rem, 2rem)',
  'calc(1rem + 200ms)',
  'calc(var(--space-2) * 2)',
  'calc(1rem + 2px',
  'calc(1rem + 2px))',
  'fit-content(10rem)',
  '1rem;',
  '1rem; color: red',
  '1rem }',
  '1rem !important',
  '"1rem"',
  // A calculation has the type of a length or a percentage.
  'calc(1)',
  'calc(1 * 2)',
  'calc(1rem * 1rem)',
  'calc(1rem + 1)',
  'calc(1 + 1rem)',
  'calc(1 / 1rem)',
  'calc(1rem / 1rem)',
  'calc(1rem + 2 * 3)',
  'clamp(1rem, 2, 3rem)',
  'min(1, 2)',
  // The white space of CSS is the space and the tab.
  'calc(1rem\u00a0+\u00a02px)',
  'calc(1rem\u2028+\u20282px)',
  'calc(1rem\u000b+\u000b2px)',
  // Brackets that nest too deep are no value, and they do not stop the run.
  '('.repeat(5000),
  `calc(${'('.repeat(5000)}1rem${')'.repeat(5000)})`,
  `calc(${'('.repeat(40)}1rem${')'.repeat(40)})`,
  '1rem\\',
  '1rem <',
];

const ACCEPTED: Readonly<Record<TokenFamily, readonly string[]>> = {
  color: [
    '#abc',
    '#ABCD',
    '#a1b2c3',
    '#a1b2c380',
    'rgb(12 34 56 / 40%)',
    'rgb(200, 200, 200)',
    'rgb(0, 0, 0, 0.5)',
    'RGB(0 0 0)',
    'hsl(33, 71%, 43%)',
    'hsl(210 80% 80%)',
    'hsl(0.5turn 80% 80% / 0.5)',
    'hwb(120 20% 30%)',
    'lab(29% 39 -20)',
    'lch(52% 60 30)',
    'oklab(60% 0.1 -0.1)',
    'oklch(40% 0.1 250)',
    'oklch(70% 0.3 145deg)',
    'oklch(70% none none)',
    'color(srgb 0.2 0.4 0.6)',
    'color(srgb-linear 0.2 0.4 0.6)',
    'color(a98-rgb 0.2 0.4 0.6)',
    'color(prophoto-rgb 0.2 0.4 0.6)',
    'color(rec2020 0.2 0.4 0.6)',
    'color(xyz 0.2 0.4 0.6)',
    'color(xyz-d50 0.2 0.4 0.6)',
    'color(xyz-d65 0.2 0.4 0.6 / 50%)',
    'rebeccapurple',
    'RebeccaPurple',
    'transparent',
    'var(--color-text)',
    'rgb(0 128 0)',
    'rgb(0% 50% 0%)',
    'rgb(0%, 50%, 0%)',
    'rgb(0 128 none / none)',
    'hsl(120deg, 50%, 50%, 50%)',
    'hsl(none 50% 50%)',
    'hwb(0.25turn 20% 30% / 0.5)',
    'lab(29% 39 -20 / 50%)',
    'lch(52% 60 30deg)',
    'oklch(70% 50% 145)',
  ],
  space: [...LENGTHS_ACCEPTED, 'var(--space-2)'],
  size: [...LENGTHS_ACCEPTED, '65ch', '16 / 9', '16/9', '1 / 1', '1.5 / 1', 'var(--size-content)'],
  font: [
    'system-ui, sans-serif',
    '"Inter", system-ui',
    "'Source Serif 4', Georgia, serif",
    'Helvetica Neue, Arial',
    '-apple-system, BlinkMacSystemFont',
    'Inter',
    '"A; B", serif',
    '"Fira\u00a0Sans", sans-serif',
    "'A > B', serif",
    'var(--font-body)',
  ],
  text: [...LENGTHS_ACCEPTED, 'clamp(1rem, 0.9rem + 0.5vw, 1.25rem)', '112.5%', 'var(--text-m)'],
  leading: ['1.5', '1', '0', '24px', '1.5rem', '150%', 'normal', 'var(--leading-m)'],
  weight: ['1', '400', '700', '1000', 'normal', 'bold', 'Bold', 'var(--weight-bold)'],
  tracking: ['0.02em', '-0.01em', '1px', '0', 'normal', 'var(--tracking-wide)'],
  radius: [...LENGTHS_ACCEPTED, '999px', 'var(--radius-m)'],
  line: [...LENGTHS_ACCEPTED, '0.125rem', 'var(--line-1)'],
  shadow: [
    'none',
    '1px 1px',
    '0 1px 2px #000',
    '0 1px 2px rgb(0 0 0 / 20%)',
    '0 0.5rem 1.5rem var(--color-muted)',
    'inset 0 0 0 1px var(--color-text)',
    'var(--color-text) 0 1px',
    '0 1px 2px 3px black inset',
    '0 1px #000, 0 2px 4px #0003',
    'calc(1px * 2) 1px #000',
    'var(--shadow-card)',
  ],
  z: ['10', '0', '-1', '+2', '9999', 'var(--z-menu)'],
  duration: ['150ms', '0.2s', '0s', '.5s', '0ms', '150MS', 'var(--duration-fast)'],
  ease: [
    'linear',
    'ease',
    'ease-in',
    'ease-out',
    'ease-in-out',
    'step-start',
    'step-end',
    'Ease-Out',
    'cubic-bezier(0.2, 0, 0, 1)',
    'cubic-bezier(0.3, -0.5, 0.7, 1.5)',
    'steps(4)',
    'steps(4, jump-end)',
    'steps(2, start)',
    'linear(0, 0.25, 1)',
    'linear(0, 0.5 25% 75%, 1)',
    'var(--ease-out)',
  ],
  opacity: ['0', '1', '0.5', '.25', '50%', '0%', '100%', 'var(--opacity-half)'],
  gradient: [
    'linear-gradient(135deg, var(--color-page) 0%, var(--color-muted) 60%)',
    'linear-gradient(to right, var(--color-page), var(--color-text))',
    'linear-gradient(in oklch, var(--color-page), var(--color-text))',
    'linear-gradient(var(--color-page) calc(50% - 1px), var(--color-text) 0)',
    'radial-gradient(circle at 30% 20%, var(--color-page), var(--color-muted) 60%)',
    'conic-gradient(from 0.25turn at 50% 30%, var(--color-page), var(--color-text))',
    'repeating-linear-gradient(45deg, var(--color-page) 0 10px, var(--color-text) 10px 20px)',
    'repeating-radial-gradient(var(--color-page), var(--color-text) 2rem)',
    'repeating-conic-gradient(var(--color-page) 0deg 10deg, var(--color-text) 10deg 20deg)',
    'linear-gradient(to bottom left in oklch longer hue, var(--color-page), var(--color-text))',
    'radial-gradient(ellipse farthest-corner at top center, var(--color-page), var(--color-text))',
    'radial-gradient(closest-side, var(--color-page) calc(100% / 3), var(--color-text))',
    'var(--gradient-hero)',
  ],
};

const REFUSED: Readonly<Record<TokenFamily, readonly string[]>> = {
  color: [
    '#ab',
    '#abcde',
    '#abcdefg',
    '#ggg',
    'rgb(1 2)',
    'rgb(1 2 3 4)',
    'rgb(1, 2, 3 / 4)',
    'rgb(1px 2 3)',
    'rgb(0 0 0',
    'rgb(calc(1 + 2) 0 0)',
    'rgba(0, 0, 0, 0.5)',
    'hsla(0, 0%, 0%, 0.5)',
    // The form with commas is for `rgb()` and `hsl()` only, and it has no `none`.
    'lab(29%, 39, -20)',
    'hwb(120, 20%, 30%)',
    'oklch(40%, 0.1, 250)',
    'color(srgb 0, 0.5, 0)',
    'rgb(0, 128, none)',
    'rgb(0, 50%, 0)',
    'hsl(120, 50, 50)',
    // An angle is a hue, and a hue is no percentage.
    'rgb(5deg 128 0)',
    'hsl(50% 50% 50%)',
    'hsl(120 50 50)',
    'hwb(120 20 30)',
    'lab(29deg 39 -20)',
    'oklch(70% 0.3 50%)',
    'color(srgb 10deg 0 0)',
    'rgb(0 128 0 / 10deg)',
    // No white space other than the space and the tab.
    'rgb(0\u00a0128\u00a00)',
    'rgb(0\u2028128\u20280)',
    'rgb(0\ufeff128 0)',
    'color(p3 1 0 0)',
    'color(srgb 1 0)',
    'color(1 0 0)',
    'currentColor',
    'Canvas',
    'light-dark(#ffffff, #000000)',
    'notacolor',
    '#fff #000',
    '#fff, #000',
    '#fff;',
    '#fff; color: red',
    '#fff }',
    '#fff !important',
    'var(--color-text, #000)',
    'url(x.png)',
    '"red"',
    '1px',
    'inherit',
    'none',
  ],
  space: LENGTHS_REFUSED,
  size: [
    ...LENGTHS_REFUSED.filter((value) => value !== '16 / 9'),
    '16 / 0',
    '0 / 9',
    '16 /',
    '16 9',
    '16 / 9 / 2',
    'max-content',
    '1rem / 2rem',
  ],
  font: [
    ',',
    'Inter,',
    ', Inter',
    '"Inter" sans-serif',
    'Inter 4',
    '12px Inter',
    'Inter; color: red',
    '"Inter',
    'var(--font-body), serif',
    '--font-body',
    // A form feed and a carriage return end a CSS string, and with it the declaration.
    '"x\f; } html { visibility: hidden } :root { --z: "',
    '"x\r; } html { visibility: hidden } :root { --z: "',
    '"x\u000by"',
    '"x\u007fy"',
    'Inter\u00a0Tight, sans-serif',
    // `</style>` in a string ends the `<style>` element of a page. The minifier writes `\3c ` as `<`.
    '"</style><script>document.title=1</script><style>"',
    '"a < b"',
    '"\\3c /style>"',
    '"a\\"b"',
  ],
  text: [...LENGTHS_REFUSED, 'medium', 'larger'],
  leading: ['-1', 'tight', '1.5 1.5', 'calc(1em + 2px)', '1.5;'],
  weight: ['0', '1001', '400.5', '-400', 'bolder', 'lighter', '700 800', '4e2', '700px'],
  tracking: ['2%', '0.5', 'calc(1px + 1px)', 'wide', '1px 2px'],
  radius: [...LENGTHS_REFUSED, '50% / 20%'],
  line: [...LENGTHS_REFUSED, 'thin'],
  shadow: [
    '1px',
    '1 1',
    '0 1px 2px 3px 4px',
    '0 1px #000 #fff',
    '0 1px red blue',
    'inset inset 0 1px',
    '0 #000 1px',
    '0 1px var(--space-2)',
    '0 1px 2px color-mix(in srgb, red, blue)',
    '0 1px 2px color(display-p3 1 0 0)',
    '0 1px 2px currentColor',
    '0 1px,',
    'none, 0 1px',
    '0 1px 2px #000;',
    '0\u00a01px\u00a02px #000',
    '0 1px 2px rgb(0, 128, none)',
    'calc(50% + 1px) 1px #000',
    'calc(1) 1px #000',
  ],
  z: ['1.5', 'auto', '10px', '1 2', '1e2'],
  duration: ['150', '0', '-1s', '1m', 'fast', '1s 2s', '1s, 2s'],
  ease: [
    'fast',
    'none',
    'ease, linear',
    'ease ease',
    'cubic-bezier(0.2, 0, 0)',
    'cubic-bezier(1.2, 0, 0, 1)',
    'cubic-bezier(0.2 0 0 1)',
    'steps(0)',
    'steps(1.5)',
    'steps(4, middle)',
    'steps()',
    'linear(0)',
    'linear(0 10% 20% 30%, 1)',
    'bezier(0, 0, 1, 1)',
  ],
  opacity: ['1.5', '-0.1', '101%', '-1%', 'half', '0.5 0.5', '50px'],
  gradient: [
    'linear-gradient(#ffffff, #000000)',
    'linear-gradient(red, var(--color-page))',
    'linear-gradient(var(--color-page), transparent)',
    'linear-gradient(var(--color-page), currentColor)',
    'linear-gradient(var(--color-page), rgb(0 0 0))',
    'linear-gradient(var(--color-page), color-mix(in srgb, red, blue))',
    'linear-gradient(90deg, 10%, 20%)',
    'linear-gradient(var(--space-2), var(--color-page))',
    'linear-gradient(var(--color-page, #fff), var(--color-text))',
    'linear-gradient(var(--color-page), var(--color-text)), linear-gradient(var(--color-page), var(--color-text))',
    'linear-gradient(var(--color-page), var(--color-text)) no-repeat',
    'gradient(var(--color-page))',
    // A word that is no keyword of a gradient: a system color is a literal color too.
    'linear-gradient(Canvas, var(--color-page))',
    'linear-gradient(var(--color-page), Window)',
    'linear-gradient(var(--color-page), accentcolor)',
    'linear-gradient(var(--color-page), ButtonFace)',
    'linear-gradient(var(--color-page), inherit)',
    'linear-gradient(var(--color-page) / /, / )',
    'linear-gradient(var(--color-page) 10% / 2, var(--color-text))',
    'linear-gradient(var(--color-page) calc(1rem + 1), var(--color-text))',
    'url(hero.png)',
    'image-set("a.png" 1x)',
    'none',
  ],
};

const FAMILIES = Object.keys(TOKEN_PREFIXES).filter((family) => familyOf(`--${family}-x`) === family);

test('every family has accepted and refused values in this test', () => {
  assert.deepEqual(Object.keys(ACCEPTED), FAMILIES);
  assert.deepEqual(Object.keys(REFUSED), FAMILIES);
  assert.equal(FAMILIES.length, 16);
});

for (const [family, values] of Object.entries(ACCEPTED)) {
  test(`${TOKEN_PREFIXES[familyOf(`--${family}-x`) ?? 'color']} accepts the values of 7.4`, () => {
    const kind = familyOf(`--${family}-x`) ?? 'color';
    assert.deepEqual(
      values.map((value) => [value, check(probe(kind, value)).findings]),
      values.map((value) => [value, []]),
    );
  });
}

for (const [family, values] of Object.entries(REFUSED)) {
  test(`${TOKEN_PREFIXES[familyOf(`--${family}-x`) ?? 'color']} refuses every other value, each with one finding at its row`, () => {
    const kind = familyOf(`--${family}-x`) ?? 'color';
    const prefix = TOKEN_PREFIXES[kind];
    const line = lineOf(probe(kind, 'x'), 'The probe.');
    const start = (value: string): string =>
      `${DESIGN_FILE}:${line}: \`${value}\` is no value of a \`${prefix}\` token: write `;
    assert.deepEqual(
      values.map((value) => {
        const seen = check(probe(kind, value));
        return [value, seen.ids, seen.findings.map((text) => text.slice(0, start(value).length))];
      }),
      values.map((value) => [value, [RULE], [start(value)]]),
    );
  });
}

test('a refused value has a detail that says what the family accepts', () => {
  const lengths = 'a length, a percentage or `0`, or `calc()`, `clamp()`, `min()` or `max()` of those';
  const { seen, expected } = outcome([
    [
      'a number as a space',
      probe('space', '13'),
      ['The probe.', `\`13\` is no value of a \`--space-\` token: write ${lengths}, or an alias \`var(--space-…)\``],
    ],
    [
      'a keyword as a size',
      probe('size', 'auto'),
      [
        'The probe.',
        `\`auto\` is no value of a \`--size-\` token: write ${lengths}, or a ratio such as \`16 / 9\`, or an alias \`var(--size-…)\``,
      ],
    ],
    [
      'a number as a duration',
      probe('duration', '150'),
      [
        'The probe.',
        '`150` is no value of a `--duration-` token: write a time in `ms` or `s`, or an alias `var(--duration-…)`',
      ],
    ],
    [
      '</style> in a string',
      probe('font', '"</style>", serif'),
      [
        'The probe.',
        '`"</style>", serif` is no value of a `--font-` token: write it without a control character, without `<` and without a backslash, also inside quotes',
      ],
    ],
    [
      'an escape in a color',
      probe('color', '\\23 fff'),
      [
        'The probe.',
        '`\\23 fff` is no value of a `--color-` token: write it without a control character, without `<` and without a backslash, also inside quotes',
      ],
    ],
    ['an empty Value cell', probe('space', ''), ['The probe.', '`--space-probe` has no value']],
  ]);
  assert.deepEqual(seen, expected);
});

test('no color holds color-mix() or color(display-p3 …)', () => {
  const mix = '`color-mix()` is not accepted: write the mixed color as its result';
  const wide = '`color(display-p3 …)` is not accepted: write a wide color in `oklch()` or `lab()`';
  const { seen, expected } = outcome([
    ['color-mix in srgb', probe('color', 'color-mix(in srgb, #673843 82%, #cd5e2a)'), ['The probe.', mix]],
    ['color-mix in oklch', probe('color', 'color-mix(in oklch, #a5afac 48%, #a7ebae)'), ['The probe.', mix]],
    [
      'color-mix of tokens',
      probe('color', 'color-mix(in srgb, var(--color-text), var(--color-page))'),
      ['The probe.', mix],
    ],
    ['display-p3', probe('color', 'color(display-p3 1 0.5 0)'), ['The probe.', wide]],
    ['display-p3 in another letter case', probe('color', 'COLOR(Display-P3 0 1 0 / 50%)'), ['The probe.', wide]],
    [
      'display-p3 in a contrast cell',
      addRow(
        FULL_MD,
        'Color',
        '| --color-probe | #03edf4 | #000000 | lab(29% 39 -20) | color(display-p3 0 1 0) | The probe. |',
      ),
      ['The probe.', wide],
    ],
  ]);
  assert.deepEqual(seen, expected);
  // The same color in `oklch()` passes. So the color function is what fails.
  assert.deepEqual(check(probe('color', 'oklch(70% 0.3 145)')).ids, []);
});

test('one run reports every finding, in the order of the lines', () => {
  const text = [
    (value: string) => swap(value, '\n## Breakpoints\n', '\n## Breakpoint\n'),
    (value: string) => swap(value, '`0.5rem`', '`13`'),
    (value: string) => swap(value, '`#222222`', '`color-mix(in srgb, red, blue)`'),
    (value: string) => addRow(value, 'Themes', '| sepia | Warm. |'),
    (value: string) => swap(value, '| `--color-text` | `--color-text` | text | body |\n', ''),
  ].reduce((value, change) => change(value), SMALLEST_DESIGN_MD);
  const seen = check(text);
  assert.deepEqual(seen.ids, [RULE]);
  assert.equal(seen.design, undefined);
  assert.deepEqual(seen.findings, [
    `${DESIGN_FILE}: the section \`## Breakpoints\` is missing`,
    `${DESIGN_FILE}:6: \`sepia\` is no theme: the themes are \`light\`, \`dark\`, \`light-contrast\`, \`dark-contrast\``,
    `${DESIGN_FILE}:12: \`color-mix()\` is not accepted: write the mixed color as its result`,
    `${DESIGN_FILE}:25: \`13\` is no value of a \`--space-\` token: write a length, a percentage or \`0\`, or \`calc()\`, \`clamp()\`, \`min()\` or \`max()\` of those, or an alias \`var(--space-…)\``,
    `${DESIGN_FILE}:34: the table needs at least one pair`,
  ]);
});

// The skeleton of init (7.4)

const SKELETON = `${specBlock('**The skeleton init writes:**', 'md')}\n`;

/** The five rows that the skeleton lacks, each with its section. */
const SKELETON_ROWS: readonly (readonly [section: string, row: string, detail: string])[] = [
  ['Color', '| `--color-text` | `#222222` | Text. |', NO_ROW],
  [
    'Typography',
    '| `--font-body` | `system-ui, sans-serif` | Body text. |',
    'the table needs at least one `--font-` row',
  ],
  ['Typography', '| `--text-m` | `1rem` | Body text. |', 'the table needs at least one `--text-` row'],
  ['Spacing', '| `--space-2` | `0.5rem` | A small gap. |', NO_ROW],
  ['Contrast pairs', '| `--color-text` | `--color-text` | text | body |', 'the table needs at least one pair'],
];

test('the skeleton that init writes fails design-format, with one finding for each table that needs a row', () => {
  assert.equal(SKELETON.startsWith('# Design\n\nThe plan of the site'), true);
  const seen = check(SKELETON);
  assert.deepEqual(seen.ids, [RULE]);
  assert.equal(seen.design, undefined);
  assert.deepEqual(
    seen.findings,
    SKELETON_ROWS.map(([section, , detail]) => `${DESIGN_FILE}:${headerLine(SKELETON, section)}: ${detail}`),
  );
});

test('the skeleton passes with its five rows, and fails with exactly one finding without one of them', () => {
  const fill = (rows: typeof SKELETON_ROWS): string =>
    rows.reduce((text, [section, row]) => addRow(text, section, row), SKELETON);
  const full = check(fill(SKELETON_ROWS));
  assert.deepEqual(full.findings, []);
  assert.deepEqual(full.design?.themes, ['light']);
  assert.deepEqual(
    full.design?.tokens.map((token) => token.name),
    ['--font-body', '--text-m', '--space-2'],
  );
  assert.deepEqual(
    SKELETON_ROWS.map((_row, index) => check(fill(SKELETON_ROWS.filter((_other, at) => at !== index))).findings.length),
    SKELETON_ROWS.map(() => 1),
  );
});

// The file

test('loadDesign reads docs/design.md from the root', () => {
  const seen = inTemp({ [DESIGN_FILE]: FULL_MD }, (root) => {
    const report = new Report();
    return seenOf(report, loadDesign(root, report));
  });
  assert.deepEqual(seen.findings, []);
  assert.deepEqual(seen.design, FULL_DESIGN);
});

test('a missing docs/design.md is one finding at the file', () => {
  const cases: [name: string, files: Record<string, string>, findings: string[]][] = [
    ['no file', { 'docs/other.md': SMALLEST_DESIGN_MD }, [`${DESIGN_FILE}: the file is missing`]],
    ['no docs folder', {}, [`${DESIGN_FILE}: the file is missing`]],
    [
      'a folder with that name',
      { [`${DESIGN_FILE}/keep.md`]: SMALLEST_DESIGN_MD },
      [`${DESIGN_FILE}: this is not a file`],
    ],
    [
      'an empty file',
      { [DESIGN_FILE]: '' },
      ['Themes', 'Color', 'Typography', 'Spacing', 'Breakpoints', 'Contrast pairs'].map(
        (section) => `${DESIGN_FILE}: the section \`## ${section}\` is missing`,
      ),
    ],
    ['the skeleton', { [DESIGN_FILE]: SKELETON }, check(SKELETON).findings],
  ];
  const seen = cases.map(([name, files]) =>
    inTemp(files, (root) => {
      const report = new Report();
      const design = loadDesign(root, report);
      return [name, seenOf(report, design).ids, seenOf(report, design).findings, design];
    }),
  );
  assert.deepEqual(
    seen,
    cases.map(([name, , findings]) => [name, [RULE], findings, undefined]),
  );
});

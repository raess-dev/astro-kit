import assert from 'node:assert/strict';
import { test } from 'node:test';
import { type ColorToken, type Design, parseDesign } from '../../src/design/parse.ts';
import { checkTokens, colorValue, renderTokens, TOKENS_FILE, TOKENS_HEADER } from '../../src/design/tokens.ts';
import {
  checkModeThemes,
  defaultMode,
  enabledModes,
  type ModeOption,
  type ModeSettings,
  SYSTEM_STATES,
  type SystemState,
  THEMES,
  type Theme,
  themeOf,
} from '../../src/modes.ts';
import { getRule, Report } from '../../src/registry.ts';
import { inTemp } from './fixtures.ts';
import { SPEC, specBlock } from './spec.ts';

const RULE = 'design-tokens';

// Helpers. None asserts: a helper throws an `Error` for an input that the test did not mean.

type Modes = ModeSettings['modes'];

/** The settings with the given options on. `fallback` is `modes.default`, for settings with auto off. */
function settings(on: readonly ModeOption[], fallback?: Modes['default']): ModeSettings {
  const modes: Modes = {
    auto: on.includes('auto'),
    light: on.includes('light'),
    dark: on.includes('dark'),
    contrast: on.includes('contrast'),
  };
  return { modes: fallback === undefined ? modes : { ...modes, default: fallback } };
}

/** One row of a `## Color` table. A row with `needs` is left out of a design without that theme. */
interface ColorRow {
  name: string;
  cells: Partial<Record<Theme, string>>;
  needs?: Theme;
}

/** The text of a `docs/design.md` with these themes and colors, and the other rows of 7.7, setting 1. */
function designMd(themes: readonly Theme[], colors: readonly ColorRow[]): string {
  const rows = colors
    .filter((color) => color.needs === undefined || themes.includes(color.needs))
    .map(
      (color) => `| \`${color.name}\` | ${themes.map((theme) => color.cells[theme] ?? '').join(' | ')} | A color. |`,
    );
  return [
    '# Design',
    '',
    '## Themes',
    '',
    '| Theme | Use |',
    '|---|---|',
    ...themes.map((theme) => `| ${theme} | A theme. |`),
    '',
    '## Color',
    '',
    `| Token | ${themes.join(' | ')} | Use |`,
    `|---|${themes.map(() => '---|').join('')}---|`,
    ...rows,
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
    '## Layout helpers',
    '',
    '| Parameter | Token | Use |',
    '|---|---|---|',
    '| `--stack-gap` | `var(--space-2)` | The gap of a stack. |',
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
    '| `--color-text` | `--color-page` | text | body |',
    '',
  ].join('\n');
}

/** The parsed design of a text. Throws when the text does not pass `design-format`. */
function designOf(text: string): Design {
  const report = new Report();
  const design = parseDesign(text, report);
  if (design === undefined) throw new Error(report.format());
  return design;
}

const FOUR: readonly Theme[] = ['light', 'dark', 'light-contrast', 'dark-contrast'];

/** The `## Color` table of 7.7, setting 1. `--color-page` has two empty cells. */
const COLORS: readonly ColorRow[] = [
  { name: '--color-page', cells: { light: '#ffffff', dark: '#111111' } },
  {
    name: '--color-text',
    cells: { light: '#222222', dark: '#eeeeee', 'light-contrast': '#000000', 'dark-contrast': '#ffffff' },
  },
  {
    name: '--color-muted',
    cells: { light: '#555555', dark: '#bbbbbb', 'light-contrast': '#333333', 'dark-contrast': '#dddddd' },
  },
];

/** The design document of 7.7, setting 1, with every required section. */
const SETTING_1_MD = designMd(FOUR, COLORS);

const every = (text: string): ColorRow['cells'] => ({
  light: text,
  dark: text,
  'light-contrast': text,
  'dark-contrast': text,
});

/**
 * A wider `## Color` table, the one of spike S16. Each row is one shape that 7.4 allows. Chromium showed the design
 * value of every row in every mode state and system state, for the texts that this test holds.
 */
const WIDE: readonly ColorRow[] = [
  ...COLORS,
  // The base values are equal. So `pair` is the plain value at `std`, and `light-dark()` at `more`.
  {
    name: '--color-rule',
    cells: {
      light: 'rgb(200, 200, 200)',
      dark: 'rgb(200, 200, 200)',
      'light-contrast': 'oklch(40% 0.1 250)',
      'dark-contrast': 'hsl(210 80% 80%)',
    },
  },
  // The contrast values are equal. So `pair` is `light-dark()` at `std`, and the plain value at `more`.
  {
    name: '--color-focus',
    cells: { light: '#0044cc', dark: '#99bbff', 'light-contrast': '#ff00ff', 'dark-contrast': '#ff00ff' },
  },
  // One empty contrast cell each: `light-contrast` → `light`, and `dark-contrast` → `dark`.
  { name: '--color-brand', cells: { light: 'rebeccapurple', dark: '#cc99ff', 'dark-contrast': '#eeddff' } },
  { name: '--color-mark', cells: { light: '#ffee00', dark: '#665500', 'light-contrast': '#ffff00' } },
  // An empty `dark` cell: `dark` → `light`, and `dark-contrast` → `dark` → `light`.
  { name: '--color-flat', cells: { light: '#0a7f3f', 'light-contrast': '#064d26' }, needs: 'light' },
  // An alias in every cell, an alias in some cells, and an alias of an alias.
  { name: '--color-link', cells: every('var(--color-brand)') },
  {
    name: '--color-note',
    cells: { light: 'var(--color-muted)', dark: 'hsl(30, 100%, 50%)', 'dark-contrast': 'var(--color-text)' },
  },
  { name: '--color-deep', cells: every('var(--color-link)') },
];

// The fixed texts

test('the file and its first line are the ones of 7.7', () => {
  assert.equal(TOKENS_FILE, 'src/styles/tokens.css');
  assert.equal(SPEC.includes(`1. Line 1: \`${TOKENS_HEADER}\`\n`), true);
  assert.equal(TOKENS_HEADER.includes(`: ${getRule(RULE).hint}. */`), true);
});

test('the design of this test holds the Color table and the other rows of 7.7, setting 1', () => {
  const start = SPEC.indexOf('**Setting 1: all four themes, all four options.**');
  const table = SPEC.slice(start, SPEC.indexOf('```css', start));
  const rows = [...table.matchAll(/^\| `(--color-[a-z]+)` \|(.*)\|$/gm)].map((match) => [
    match[1],
    ...(match[2] ?? '').split('|').map((cell) => cell.replaceAll('`', '').trim()),
  ]);
  assert.deepEqual(
    rows,
    COLORS.map((color) => [color.name, ...FOUR.map((theme) => color.cells[theme] ?? '')]),
  );
  const design = designOf(SETTING_1_MD);
  assert.deepEqual(design.themes, FOUR);
  assert.deepEqual(
    design.tokens.map((token) => `\`${token.name}\` = \`${token.value}\``),
    ['`--font-body` = `system-ui, sans-serif`', '`--text-m` = `1rem`', '`--space-2` = `0.5rem`'],
  );
  assert.deepEqual(
    design.helpers.map((helper) => `\`${helper.name}\` = \`${helper.token}\``),
    ['`--stack-gap` = `var(--space-2)`'],
  );
  assert.deepEqual(
    [...design.tokens.map((token) => token.name), ...design.helpers.map((helper) => helper.name)].map((name) =>
      table.includes(`\`${name}\` = `),
    ),
    [true, true, true, true],
  );
});

// The five settings of 7.7

test('setting 1: all four themes and all four options give the exact text of 7.7', () => {
  const text = renderTokens(designOf(SETTING_1_MD), settings(['auto', 'light', 'dark', 'contrast']));
  assert.equal(text, `${specBlock('**Setting 1: all four themes, all four options.**', 'css')}\n`);
});

const SETTING_2 = `/* Generated by @raess/astro-kit from docs/design.md. Do not edit: run npx --no astro-kit tokens. */
@layer tokens {
  :root {
    color-scheme: light dark;
    --color-page: light-dark(#ffffff, #111111);
    --color-text: light-dark(#222222, #eeeeee);
    --color-muted: light-dark(#555555, #bbbbbb);
    --font-body: system-ui, sans-serif;
    --text-m: 1rem;
    --space-2: 0.5rem;
    --stack-gap: var(--space-2);
  }
  @media (prefers-contrast: more) {
    :root:not([data-mode]), :root[data-mode="auto"] {
      --color-text: light-dark(#000000, #ffffff);
      --color-muted: light-dark(#333333, #dddddd);
    }
  }
}
`;

const SETTING_3 = `/* Generated by @raess/astro-kit from docs/design.md. Do not edit: run npx --no astro-kit tokens. */
@layer tokens {
  :root {
    color-scheme: light;
    --color-page: light-dark(#ffffff, #111111);
    --color-text: light-dark(#222222, #eeeeee);
    --color-muted: light-dark(#555555, #bbbbbb);
    --font-body: system-ui, sans-serif;
    --text-m: 1rem;
    --space-2: 0.5rem;
    --stack-gap: var(--space-2);
  }
  :root[data-mode="dark"] {
    color-scheme: dark;
  }
  :root[data-mode="contrast"] {
    color-scheme: light dark;
    --color-text: light-dark(#000000, #ffffff);
    --color-muted: light-dark(#333333, #dddddd);
  }
}
`;

const SETTING_4 = `/* Generated by @raess/astro-kit from docs/design.md. Do not edit: run npx --no astro-kit tokens. */
@layer tokens {
  :root {
    color-scheme: light dark;
    --color-page: light-dark(#ffffff, #111111);
    --color-text: light-dark(#000000, #ffffff);
    --color-muted: light-dark(#333333, #dddddd);
    --font-body: system-ui, sans-serif;
    --text-m: 1rem;
    --space-2: 0.5rem;
    --stack-gap: var(--space-2);
  }
  :root[data-mode="light"] {
    color-scheme: light;
    --color-text: light-dark(#222222, #eeeeee);
    --color-muted: light-dark(#555555, #bbbbbb);
  }
  :root[data-mode="dark"] {
    color-scheme: dark;
    --color-text: light-dark(#222222, #eeeeee);
    --color-muted: light-dark(#555555, #bbbbbb);
  }
}
`;

const SETTING_5 = `/* Generated by @raess/astro-kit from docs/design.md. Do not edit: run npx --no astro-kit tokens. */
@layer tokens {
  :root {
    color-scheme: light;
    --color-page: #ffffff;
    --color-text: #222222;
    --color-muted: #555555;
    --font-body: system-ui, sans-serif;
    --text-m: 1rem;
    --space-2: 0.5rem;
    --stack-gap: var(--space-2);
  }
}
`;

test('settings 2 to 5 give the texts that the table of 7.7 describes', () => {
  const four = designOf(SETTING_1_MD);
  const light = designOf(designMd(['light'], COLORS));
  const cases: [name: string, design: Design, options: ModeSettings, text: string][] = [
    ['2: all four themes; auto only', four, settings(['auto']), SETTING_2],
    ['3: all four themes; default light', four, settings(['light', 'dark', 'contrast'], 'light'), SETTING_3],
    ['4: all four themes; default contrast', four, settings(['light', 'dark', 'contrast'], 'contrast'), SETTING_4],
    ['5: only light; auto only', light, settings(['auto']), SETTING_5],
  ];
  assert.deepEqual(
    cases.map(([name, design, options]) => [name, renderTokens(design, options)]),
    cases.map(([name, , , text]) => [name, text]),
  );
});

// The wide table: the texts that spike S16 proved in Chromium

const WIDE_ALL = `/* Generated by @raess/astro-kit from docs/design.md. Do not edit: run npx --no astro-kit tokens. */
@layer tokens {
  :root {
    color-scheme: light dark;
    --color-page: light-dark(#ffffff, #111111);
    --color-text: light-dark(#222222, #eeeeee);
    --color-muted: light-dark(#555555, #bbbbbb);
    --color-rule: rgb(200, 200, 200);
    --color-focus: light-dark(#0044cc, #99bbff);
    --color-brand: light-dark(rebeccapurple, #cc99ff);
    --color-mark: light-dark(#ffee00, #665500);
    --color-flat: #0a7f3f;
    --color-link: var(--color-brand);
    --color-note: light-dark(var(--color-muted), hsl(30, 100%, 50%));
    --color-deep: var(--color-link);
    --font-body: system-ui, sans-serif;
    --text-m: 1rem;
    --space-2: 0.5rem;
    --stack-gap: var(--space-2);
  }
  :root[data-mode="light"] {
    color-scheme: light;
  }
  :root[data-mode="dark"] {
    color-scheme: dark;
  }
  :root[data-mode="contrast"] {
    --color-text: light-dark(#000000, #ffffff);
    --color-muted: light-dark(#333333, #dddddd);
    --color-rule: light-dark(oklch(40% 0.1 250), hsl(210 80% 80%));
    --color-focus: #ff00ff;
    --color-brand: light-dark(rebeccapurple, #eeddff);
    --color-mark: light-dark(#ffff00, #665500);
    --color-flat: light-dark(#064d26, #0a7f3f);
    --color-note: light-dark(var(--color-muted), var(--color-text));
  }
  @media (prefers-contrast: more) {
    :root:not([data-mode]), :root[data-mode="auto"] {
      --color-text: light-dark(#000000, #ffffff);
      --color-muted: light-dark(#333333, #dddddd);
      --color-rule: light-dark(oklch(40% 0.1 250), hsl(210 80% 80%));
      --color-focus: #ff00ff;
      --color-brand: light-dark(rebeccapurple, #eeddff);
      --color-mark: light-dark(#ffff00, #665500);
      --color-flat: light-dark(#064d26, #0a7f3f);
      --color-note: light-dark(var(--color-muted), var(--color-text));
    }
  }
}
`;

const WIDE_DEFAULT_DARK = `/* Generated by @raess/astro-kit from docs/design.md. Do not edit: run npx --no astro-kit tokens. */
@layer tokens {
  :root {
    color-scheme: dark;
    --color-page: light-dark(#ffffff, #111111);
    --color-text: light-dark(#222222, #eeeeee);
    --color-muted: light-dark(#555555, #bbbbbb);
    --color-rule: rgb(200, 200, 200);
    --color-focus: light-dark(#0044cc, #99bbff);
    --color-brand: light-dark(rebeccapurple, #cc99ff);
    --color-mark: light-dark(#ffee00, #665500);
    --color-flat: #0a7f3f;
    --color-link: var(--color-brand);
    --color-note: light-dark(var(--color-muted), hsl(30, 100%, 50%));
    --color-deep: var(--color-link);
    --font-body: system-ui, sans-serif;
    --text-m: 1rem;
    --space-2: 0.5rem;
    --stack-gap: var(--space-2);
  }
  :root[data-mode="light"] {
    color-scheme: light;
  }
  :root[data-mode="contrast"] {
    color-scheme: light dark;
    --color-text: light-dark(#000000, #ffffff);
    --color-muted: light-dark(#333333, #dddddd);
    --color-rule: light-dark(oklch(40% 0.1 250), hsl(210 80% 80%));
    --color-focus: #ff00ff;
    --color-brand: light-dark(rebeccapurple, #eeddff);
    --color-mark: light-dark(#ffff00, #665500);
    --color-flat: light-dark(#064d26, #0a7f3f);
    --color-note: light-dark(var(--color-muted), var(--color-text));
  }
}
`;

const WIDE_DARK_ONLY = `/* Generated by @raess/astro-kit from docs/design.md. Do not edit: run npx --no astro-kit tokens. */
@layer tokens {
  :root {
    color-scheme: dark;
    --color-page: #111111;
    --color-text: #eeeeee;
    --color-muted: #bbbbbb;
    --color-rule: rgb(200, 200, 200);
    --color-focus: #99bbff;
    --color-brand: #cc99ff;
    --color-mark: #665500;
    --color-link: var(--color-brand);
    --color-note: hsl(30, 100%, 50%);
    --color-deep: var(--color-link);
    --font-body: system-ui, sans-serif;
    --text-m: 1rem;
    --space-2: 0.5rem;
    --stack-gap: var(--space-2);
  }
  :root[data-mode="contrast"] {
    --color-text: #ffffff;
    --color-muted: #dddddd;
    --color-rule: hsl(210 80% 80%);
    --color-focus: #ff00ff;
    --color-brand: #eeddff;
    --color-note: var(--color-text);
  }
}
`;

const WIDE_LIGHT_ONLY = `/* Generated by @raess/astro-kit from docs/design.md. Do not edit: run npx --no astro-kit tokens. */
@layer tokens {
  :root {
    color-scheme: light;
    --color-page: #ffffff;
    --color-text: #222222;
    --color-muted: #555555;
    --color-rule: rgb(200, 200, 200);
    --color-focus: #0044cc;
    --color-brand: rebeccapurple;
    --color-mark: #ffee00;
    --color-flat: #0a7f3f;
    --color-link: var(--color-brand);
    --color-note: var(--color-muted);
    --color-deep: var(--color-link);
    --font-body: system-ui, sans-serif;
    --text-m: 1rem;
    --space-2: 0.5rem;
    --stack-gap: var(--space-2);
  }
  :root[data-mode="contrast"] {
    --color-text: #000000;
    --color-muted: #333333;
    --color-rule: oklch(40% 0.1 250);
    --color-focus: #ff00ff;
    --color-mark: #ffff00;
    --color-flat: #064d26;
  }
  @media (prefers-contrast: more) {
    :root:not([data-mode]), :root[data-mode="auto"] {
      --color-text: #000000;
      --color-muted: #333333;
      --color-rule: oklch(40% 0.1 250);
      --color-focus: #ff00ff;
      --color-mark: #ffff00;
      --color-flat: #064d26;
    }
  }
}
`;

test('equal values, empty cells and aliases give the texts that the spike proved', () => {
  const cases: [name: string, themes: readonly Theme[], options: ModeSettings, text: string][] = [
    ['four themes; all four options', FOUR, settings(['auto', 'light', 'dark', 'contrast']), WIDE_ALL],
    ['four themes; default dark', FOUR, settings(['light', 'dark', 'contrast'], 'dark'), WIDE_DEFAULT_DARK],
    [
      'dark and dark-contrast; default dark',
      ['dark', 'dark-contrast'],
      settings(['dark', 'contrast'], 'dark'),
      WIDE_DARK_ONLY,
    ],
    [
      'light and light-contrast; auto and contrast',
      ['light', 'light-contrast'],
      settings(['auto', 'contrast']),
      WIDE_LIGHT_ONLY,
    ],
  ];
  assert.deepEqual(
    cases.map(([name, themes, options]) => [name, renderTokens(designOf(designMd(themes, WIDE)), options)]),
    cases.map(([name, , , text]) => [name, text]),
  );
});

test('the other tokens keep the section order of 7.7, and no value is changed', () => {
  const sections: [section: string, row: string][] = [
    ['Gradient', '| --gradient-hero | linear-gradient(135deg, var(--color-page) 0%, var(--color-text) 60%) | x |'],
    ['Opacity', '| --opacity-half | 0.50 | x |'],
    ['Motion', '| --ease-out | cubic-bezier(.2,0,0,1) | x |\n| --duration-fast | 150MS | x |'],
    ['Layer', '| --z-menu | +10 | x |'],
    ['Shadow', '| --shadow-card | 0 0.5rem 1.5rem var(--color-muted) | x |'],
    ['Line', '| --line-1 | 1PX | x |'],
    ['Radius', '| --radius-m | 0.250rem | x |'],
    ['Size', '| --size-wide | 16/9 | x |'],
  ];
  const more = sections.map(([section, row]) => `## ${section}\n\n| Token | Value | Use |\n|---|---|---|\n${row}\n`);
  const text = renderTokens(designOf(`${more.join('\n')}\n${designMd(['light'], COLORS)}`), settings(['auto']));
  assert.equal(
    text,
    `/* Generated by @raess/astro-kit from docs/design.md. Do not edit: run npx --no astro-kit tokens. */
@layer tokens {
  :root {
    color-scheme: light;
    --color-page: #ffffff;
    --color-text: #222222;
    --color-muted: #555555;
    --font-body: system-ui, sans-serif;
    --text-m: 1rem;
    --space-2: 0.5rem;
    --size-wide: 16/9;
    --radius-m: 0.250rem;
    --line-1: 1PX;
    --shadow-card: 0 0.5rem 1.5rem var(--color-muted);
    --z-menu: +10;
    --ease-out: cubic-bezier(.2,0,0,1);
    --duration-fast: 150MS;
    --opacity-half: 0.50;
    --gradient-hero: linear-gradient(135deg, var(--color-page) 0%, var(--color-text) 60%);
    --stack-gap: var(--space-2);
  }
}
`,
  );
});

// value(t, X)

test('colorValue gives the cell, or the next value along dark-contrast → dark → light and light-contrast → light', () => {
  const [L, K, LC, KC] = ['#aaaaaa', '#bbbbbb', '#cccccc', '#dddddd'];
  const none = undefined;
  type Value = string | undefined;
  const cases: [values: ColorToken['values'], light: Value, dark: Value, lightContrast: Value, darkContrast: Value][] =
    [
      [{ light: L, dark: K, 'light-contrast': LC, 'dark-contrast': KC }, L, K, LC, KC],
      [{ light: L }, L, L, L, L],
      [{ light: L, dark: K }, L, K, L, K],
      [{ light: L, 'light-contrast': LC }, L, L, LC, L],
      [{ light: L, 'dark-contrast': KC }, L, L, L, KC],
      [{ light: L, dark: K, 'light-contrast': LC }, L, K, LC, K],
      [{ dark: K }, none, K, none, K],
      [{ dark: K, 'dark-contrast': KC }, none, K, none, KC],
      [{ 'dark-contrast': KC }, none, none, none, KC],
      [{ 'light-contrast': LC }, none, none, LC, none],
      [{ 'light-contrast': LC, 'dark-contrast': KC }, none, none, LC, KC],
      [{}, none, none, none, none],
    ];
  assert.deepEqual(
    cases.map(([values]) => THEMES.map((theme) => colorValue({ name: '--color-x', values, line: 1 }, theme))),
    cases.map(([, ...expected]) => expected),
  );
});

// Why the text is right (7.7): each mode state and system state shows the design value of T(M, S)

/** The 20 `modes` settings that 5.2 allows: 8 with `auto`, and 12 without it. */
function modesSettings(): ModeSettings[] {
  const out: ModeSettings[] = [];
  for (let bits = 1; bits < 16; bits += 1) {
    const on = (['auto', 'light', 'dark', 'contrast'] as const).filter((_option, index) => (bits & (8 >> index)) !== 0);
    if (on.includes('auto')) out.push(settings(on));
    else for (const option of on) if (option !== 'auto') out.push(settings(on, option));
  }
  return out;
}

/** The eight theme sets that 7.4 allows. */
const THEME_SETS: readonly (readonly Theme[])[] = [
  ['light'],
  ['dark'],
  ['light', 'dark'],
  ['light', 'light-contrast'],
  ['dark', 'dark-contrast'],
  ['light', 'dark', 'light-contrast'],
  ['light', 'dark', 'dark-contrast'],
  FOUR,
];

/** The two arguments of `light-dark()`, or the value twice when it is no `light-dark()`. */
function sidesOf(value: string): [light: string, dark: string] {
  if (!value.startsWith('light-dark(')) return [value, value];
  const inner = value.slice('light-dark('.length, -1);
  let depth = 0;
  for (const [index, char] of [...inner].entries()) {
    if (char === '(') depth += 1;
    if (char === ')') depth -= 1;
    if (char === ',' && depth === 0) return [inner.slice(0, index), inner.slice(index + 1).trim()];
  }
  throw new Error(`${value} has no second argument`);
}

/**
 * What a page shows for a rendered text: the `color-scheme` of `html` and the used value of each color token, in
 * one mode state (`undefined` is an `html` without `data-mode`) and one system state. It reads the three kinds of
 * rule of 7.7 in the order of the text, so a later rule wins, as in the cascade.
 */
function shown(text: string, mode: ModeOption | undefined, state: SystemState): Map<string, string> {
  const declared = new Map<string, string>();
  let applies = false;
  let media = false;
  for (const line of text.split('\n').map((raw) => raw.trim())) {
    if (line.startsWith('@media (prefers-contrast: more)')) media = true;
    else if (line === ':root {') applies = true;
    else if (line.startsWith(':root[data-mode="') && !media) applies = line === `:root[data-mode="${mode}"] {`;
    else if (line.startsWith(':root:not([data-mode])'))
      applies = state.contrast === 'more' && (mode ?? 'auto') === 'auto';
    else if (line === '}') applies = false;
    else if (applies && line.endsWith(';'))
      declared.set(line.slice(0, line.indexOf(':')), line.slice(line.indexOf(':') + 2, -1));
  }
  const scheme = declared.get('color-scheme') ?? '';
  const side = scheme === 'light dark' ? state.scheme : scheme;
  const out = new Map([['color-scheme', scheme]]);
  for (const [name, value] of declared) {
    if (name.startsWith('--color-')) out.set(name, sidesOf(value)[side === 'dark' ? 1 : 0]);
  }
  return out;
}

test('in every mode state and system state, a color shows the design value of T(M, S)', () => {
  const valid = THEME_SETS.flatMap((themes) =>
    modesSettings()
      .filter((options) => checkModeThemes(options, themes, new Report()))
      .map((options) => ({ themes, options, design: designOf(designMd(themes, WIDE)) })),
  );
  // Spike S16 proved the same 37 designs in Chromium.
  assert.equal(valid.length, 37);
  const misses: string[] = [];
  let states = 0;
  for (const { themes, options, design } of valid) {
    const text = renderTokens(design, options);
    const D = defaultMode(options);
    const both = themes.includes('light') && themes.includes('dark');
    const modeStates = enabledModes(options).length >= 2 ? [undefined, ...enabledModes(options)] : [undefined];
    for (const mode of modeStates) {
      for (const state of SYSTEM_STATES) {
        states += 1;
        const M = mode ?? D;
        const theme = themeOf(M, state, themes);
        const page = shown(text, mode, state);
        const scheme = M === 'light' || M === 'dark' ? M : both ? 'light dark' : (themes[0] ?? '');
        const expected = new Map([
          ['color-scheme', scheme],
          ...design.colors.map((color): [string, string] => [color.name, colorValue(color, theme) ?? 'no value']),
        ]);
        for (const [name, value] of expected) {
          if (page.get(name) !== value) {
            misses.push(
              `${themes.join(',')} | ${enabledModes(options).join('+')} default ${D} | data-mode ${mode} | ${state.scheme} ${state.contrast} | ${name}: ${page.get(name)} instead of ${value}`,
            );
          }
        }
      }
    }
  }
  assert.deepEqual(misses, []);
  assert.equal(states, 428);
});

// design-tokens, the source half

/** The findings of `checkTokens` for a `tokens.css` text, or for no file. */
function checkedFile(
  text: string | undefined,
  options: ModeSettings = settings(['auto', 'light', 'dark', 'contrast']),
) {
  return inTemp(text === undefined ? { 'src/styles/elements.css': '' } : { [TOKENS_FILE]: text }, (root) => {
    const report = new Report();
    checkTokens(root, designOf(SETTING_1_MD), options, report);
    return {
      ids: [...report.ids()].sort(),
      findings: report.findings.map((entry) => `${entry.where}: ${entry.detail}`),
    };
  });
}

const SETTING_1 = `${specBlock('**Setting 1: all four themes, all four options.**', 'css')}\n`;

test('design-tokens passes when tokens.css is the rendering, after CRLF→LF and trimEnd + newline', () => {
  const texts: [name: string, text: string][] = [
    ['the rendering', SETTING_1],
    ['CRLF line ends', SETTING_1.replaceAll('\n', '\r\n')],
    ['no final newline', SETTING_1.trimEnd()],
    ['empty lines and spaces at the end', `${SETTING_1}\n  \n\n`],
  ];
  assert.deepEqual(
    texts.map(([name, text]) => [name, checkedFile(text)]),
    texts.map(([name]) => [name, { ids: [], findings: [] }]),
  );
});

test('design-tokens fails with one finding at the first line that differs', () => {
  const lines = SETTING_1.split('\n');
  const line = (needle: string): number => lines.findIndex((text) => text.includes(needle)) + 1;
  const cases: [name: string, text: string | undefined, finding: string][] = [
    ['no file', undefined, `${TOKENS_FILE}: the file is missing`],
    [
      'one value changed by hand',
      SETTING_1.replace('--text-m: 1rem;', '--text-m: 1.125rem;'),
      `${TOKENS_FILE}:${line('--text-m')}: the rendering has \`--text-m: 1rem;\` here`,
    ],
    [
      'one color changed by hand in a mode rule',
      SETTING_1.replace(
        'light-dark(#000000, #ffffff);\n    --color-muted',
        'light-dark(#000000, #fffffe);\n    --color-muted',
      ),
      `${TOKENS_FILE}:${line('light-dark(#000000, #ffffff)')}: the rendering has \`--color-text: light-dark(#000000, #ffffff);\` here`,
    ],
    [
      'a custom property added by hand',
      SETTING_1.replace('    --stack-gap: var(--space-2);\n', '    --stack-gap: var(--space-2);\n    --brand: #c00;\n'),
      `${TOKENS_FILE}:${line('--stack-gap') + 1}: the rendering has \`}\` here`,
    ],
    [
      'a line removed',
      SETTING_1.replace('    --space-2: 0.5rem;\n', ''),
      `${TOKENS_FILE}:${line('--space-2: 0.5rem')}: the rendering has \`--space-2: 0.5rem;\` here`,
    ],
    [
      'another indentation',
      SETTING_1.replace('    color-scheme: light dark;', '\tcolor-scheme: light dark;'),
      `${TOKENS_FILE}:4: the rendering has \`color-scheme: light dark;\` here`,
    ],
    [
      'the first line changed',
      SETTING_1.replace('Do not edit', 'Edit'),
      `${TOKENS_FILE}:1: the rendering has \`${TOKENS_HEADER}\` here`,
    ],
    [
      'a rule after the layer',
      `${SETTING_1}:root { --brand: #c00; }\n`,
      `${TOKENS_FILE}:${lines.length}: the rendering ends before this line`,
    ],
    ['an empty file', '', `${TOKENS_FILE}:1: the rendering has \`${TOKENS_HEADER}\` here`],
  ];
  assert.deepEqual(
    cases.map(([name, text]) => [name, checkedFile(text)]),
    cases.map(([name, , finding]) => [name, { ids: [RULE], findings: [finding] }]),
  );
});

test('design-tokens compares with the rendering for the mode options of the site', () => {
  // The file is the rendering for all four options. With `auto` only, the text has no mode rule.
  assert.deepEqual(checkedFile(SETTING_1, settings(['auto'])), {
    ids: [RULE],
    findings: [`${TOKENS_FILE}:13: the rendering has \`@media (prefers-contrast: more) {\` here`],
  });
  assert.deepEqual(checkedFile(SETTING_2, settings(['auto'])), { ids: [], findings: [] });
});

test('a folder at the path of tokens.css is one finding', () => {
  const seen = inTemp({ [`${TOKENS_FILE}/keep.css`]: '' }, (root) => {
    const report = new Report();
    checkTokens(root, designOf(SETTING_1_MD), settings(['auto']), report);
    return report.findings.map((entry) => `[${entry.rule}] ${entry.where}: ${entry.detail}`);
  });
  assert.deepEqual(seen, [`[${RULE}] ${TOKENS_FILE}: this is not a file`]);
});

test('renderTokens of a design that did not pass design-format throws, and never writes an empty value', () => {
  const broken: Design = { ...designOf(SETTING_1_MD), colors: [{ name: '--color-page', values: {}, line: 1 }] };
  assert.throws(() => renderTokens(broken, settings(['auto'])), /--color-page has no value for the theme light$/);
});

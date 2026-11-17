/**
 * Spike S16: the designs and `modes` settings that the spike checks, and the printed texts of 7.7.
 */
import {
  type Design,
  HEADER,
  type Modes,
  modesName,
  modesSettings,
  problems,
  THEME_SETS,
  type Theme,
} from './s16-tokens.ts';

const OTHERS: Design['others'] = [
  ['--font-body', 'system-ui, sans-serif'],
  ['--text-m', '1rem'],
  ['--space-2', '0.5rem'],
];
const HELPERS: Design['helpers'] = [['--stack-gap', 'var(--space-2)']];

/** The `## Color` table of 7.7, setting 1. `--color-page` has two empty cells. */
const COLORS: Design['colors'] = [
  { token: '--color-page', cells: { light: '#ffffff', dark: '#111111', 'light-contrast': '', 'dark-contrast': '' } },
  {
    token: '--color-text',
    cells: { light: '#222222', dark: '#eeeeee', 'light-contrast': '#000000', 'dark-contrast': '#ffffff' },
  },
  {
    token: '--color-muted',
    cells: { light: '#555555', dark: '#bbbbbb', 'light-contrast': '#333333', 'dark-contrast': '#dddddd' },
  },
];

const FOUR: Design = {
  themes: ['light', 'dark', 'light-contrast', 'dark-contrast'],
  colors: COLORS,
  others: OTHERS,
  helpers: HELPERS,
};

const REST = `    --font-body: system-ui, sans-serif;
    --text-m: 1rem;
    --space-2: 0.5rem;
    --stack-gap: var(--space-2);
`;

export interface Setting {
  id: number;
  design: Design;
  modes: Modes;
  /**
   * The text that 7.7 prints (setting 1, read from `test/acceptance/kit/tokens-setting-1.css`) or describes in its
   * table.
   */
  text?: string;
}

/** The five settings of 7.7. The texts of 2 to 5 are written out from the table of 7.7. */
export const SETTINGS: Setting[] = [
  { id: 1, design: FOUR, modes: { auto: true, light: true, dark: true, contrast: true } },
  {
    id: 2,
    design: FOUR,
    modes: { auto: true },
    text: `${HEADER}
@layer tokens {
  :root {
    color-scheme: light dark;
    --color-page: light-dark(#ffffff, #111111);
    --color-text: light-dark(#222222, #eeeeee);
    --color-muted: light-dark(#555555, #bbbbbb);
${REST}  }
  @media (prefers-contrast: more) {
    :root:not([data-mode]), :root[data-mode="auto"] {
      --color-text: light-dark(#000000, #ffffff);
      --color-muted: light-dark(#333333, #dddddd);
    }
  }
}
`,
  },
  {
    id: 3,
    design: FOUR,
    modes: { light: true, dark: true, contrast: true, default: 'light' },
    text: `${HEADER}
@layer tokens {
  :root {
    color-scheme: light;
    --color-page: light-dark(#ffffff, #111111);
    --color-text: light-dark(#222222, #eeeeee);
    --color-muted: light-dark(#555555, #bbbbbb);
${REST}  }
  :root[data-mode="dark"] {
    color-scheme: dark;
  }
  :root[data-mode="contrast"] {
    color-scheme: light dark;
    --color-text: light-dark(#000000, #ffffff);
    --color-muted: light-dark(#333333, #dddddd);
  }
}
`,
  },
  {
    id: 4,
    design: FOUR,
    modes: { light: true, dark: true, contrast: true, default: 'contrast' },
    text: `${HEADER}
@layer tokens {
  :root {
    color-scheme: light dark;
    --color-page: light-dark(#ffffff, #111111);
    --color-text: light-dark(#000000, #ffffff);
    --color-muted: light-dark(#333333, #dddddd);
${REST}  }
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
`,
  },
  {
    id: 5,
    design: { ...FOUR, themes: ['light'] },
    modes: { auto: true },
    text: `${HEADER}
@layer tokens {
  :root {
    color-scheme: light;
    --color-page: #ffffff;
    --color-text: #222222;
    --color-muted: #555555;
${REST}  }
}
`,
  },
];

const every = (text: string): Partial<Record<Theme, string>> => ({
  light: text,
  dark: text,
  'light-contrast': text,
  'dark-contrast': text,
});

/**
 * A wider `## Color` table. Each row is one shape that 7.4 allows. `needs` names the base theme that a row needs:
 * a theme set without it leaves the row out, because `design-format` would fail its empty cell.
 */
const WIDE: (Design['colors'][number] & { needs?: Theme })[] = [
  ...COLORS,
  // The base values are equal, so `pair` is the plain value at `std`, and `light-dark()` at `more`. Other syntaxes.
  {
    token: '--color-rule',
    cells: {
      light: 'rgb(200, 200, 200)',
      dark: 'rgb(200, 200, 200)',
      'light-contrast': 'oklch(40% 0.1 250)',
      'dark-contrast': 'hsl(210 80% 80%)',
    },
  },
  // The contrast values are equal, so `pair` is `light-dark()` at `std`, and the plain value at `more`.
  {
    token: '--color-focus',
    cells: { light: '#0044cc', dark: '#99bbff', 'light-contrast': '#ff00ff', 'dark-contrast': '#ff00ff' },
  },
  // One empty contrast cell each: `light-contrast` → `light`, and `dark-contrast` → `dark`.
  { token: '--color-brand', cells: { light: 'rebeccapurple', dark: '#cc99ff', 'dark-contrast': '#eeddff' } },
  { token: '--color-mark', cells: { light: '#ffee00', dark: '#665500', 'light-contrast': '#ffff00' } },
  // An empty `dark` cell: `dark` → `light`, and `dark-contrast` → `dark` → `light`.
  { token: '--color-flat', cells: { light: '#0a7f3f', 'light-contrast': '#064d26' }, needs: 'light' },
  // An alias in every cell, an alias in some cells (one of them reached through a fallback), an alias of an alias.
  { token: '--color-link', cells: every('var(--color-brand)') },
  {
    token: '--color-note',
    cells: { light: 'var(--color-muted)', dark: 'hsl(30, 100%, 50%)', 'dark-contrast': 'var(--color-text)' },
  },
  { token: '--color-deep', cells: every('var(--color-link)') },
];

export interface Case {
  name: string;
  design: Design;
  modes: Modes;
}

/**
 * Every theme set of 7.4 with every `modes` setting of 5.2 that `modes-themes` passes (7.12), on the wide table.
 * It holds the designs that the task names: `light` and `dark` only, only `dark`, `light` with `light-contrast`,
 * empty contrast cells, and aliases.
 */
export function cases(): Case[] {
  const out: Case[] = [];
  for (const themes of THEME_SETS) {
    const design: Design = {
      themes,
      colors: WIDE.filter((row) => !row.needs || themes.includes(row.needs)).map(({ token, cells }) => ({
        token,
        cells,
      })),
      others: OTHERS,
      helpers: HELPERS,
    };
    for (const modes of modesSettings()) {
      if (problems(design, modes).length > 0) continue;
      out.push({ name: `${themes.join(',')} | ${modesName(modes)}`, design, modes });
    }
  }
  return out;
}

const syntax = (name: string, light: string): Design['colors'][number] => ({
  token: `--color-${name}`,
  cells: { light, dark: '#123456' },
});

const FOUR_OPTIONS: Modes = { auto: true, light: true, dark: true, contrast: true };

/**
 * One token for each color syntax that 7.4 accepts, with all four themes and all four options: each hex length, each
 * color function, a named color, `transparent`, and `color()` in each space other than `display-p3`. The minifier
 * keeps these values or writes them in a shorter form (13.1 item 40), so a probe shows the design value.
 */
export const SYNTAX: Case = {
  name: 'syntax',
  modes: FOUR_OPTIONS,
  design: {
    themes: ['light', 'dark', 'light-contrast', 'dark-contrast'],
    colors: [
      syntax('hex3', '#abc'),
      syntax('hex4', '#abcd'),
      syntax('hex6', '#a1b2c3'),
      syntax('hex8', '#a1b2c380'),
      syntax('rgb', 'rgb(12 34 56 / 40%)'),
      syntax('hsl', 'hsl(33, 71%, 43%)'),
      syntax('hwb', 'hwb(120 20% 30%)'),
      syntax('lab', 'lab(29% 39 -20)'),
      syntax('lch', 'lch(52% 60 30)'),
      syntax('oklab', 'oklab(60% 0.1 -0.1)'),
      syntax('oklch', 'oklch(40% 0.1 250)'),
      // A color outside sRGB.
      syntax('oklch-wide', 'oklch(70% 0.3 145)'),
      syntax('srgb', 'color(srgb 0.2 0.4 0.6)'),
      // The other spaces of `color()`. The minifier names `display-p3` only (REFUSED), so these must stay as they are.
      syntax('srgb-linear', 'color(srgb-linear 0.2 0.4 0.6)'),
      syntax('a98-rgb', 'color(a98-rgb 0.2 0.4 0.6)'),
      syntax('prophoto-rgb', 'color(prophoto-rgb 0.2 0.4 0.6)'),
      syntax('rec2020', 'color(rec2020 0.2 0.4 0.6)'),
      syntax('xyz', 'color(xyz 0.2 0.4 0.6)'),
      syntax('xyz-d50', 'color(xyz-d50 0.2 0.4 0.6)'),
      syntax('xyz-d65', 'color(xyz-d65 0.2 0.4 0.6)'),
      syntax('named', 'rebeccapurple'),
      syntax('transparent', 'transparent'),
    ],
    others: OTHERS,
    helpers: HELPERS,
  },
};

/**
 * The two syntaxes that 7.4 refuses: `color-mix()` and `color(display-p3 …)`. The minifier replaces them
 * (13.1 item 40), so a page would not show the design value. The spike reads what the build writes for them.
 */
export const REFUSED: Case = {
  name: 'refused',
  modes: FOUR_OPTIONS,
  design: {
    themes: ['light', 'dark', 'light-contrast', 'dark-contrast'],
    colors: [
      syntax('p3', 'color(display-p3 1 0.5 0)'),
      syntax('mix', 'color-mix(in srgb, #673843 82%, #cd5e2a)'),
      // One of the two colors is nearly gray. Its hue counts for the minifier.
      syntax('mix-hue', 'color-mix(in oklch, #a5afac 48%, #a7ebae)'),
      {
        token: '--color-pair',
        cells: {
          light: '#03edf4',
          dark: 'color(display-p3 0.634 0.948 0.293)',
          'light-contrast': 'lab(29% 39 -20)',
          'dark-contrast': 'color(display-p3 0 1 0)',
        },
      },
    ],
    others: OTHERS,
    helpers: HELPERS,
  },
};

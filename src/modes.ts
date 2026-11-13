/**
 * Modes and themes (specification, sections 7.12 and 9.3).
 *
 * - A mode option is what `modes` in `astro-kit.json` turns on: `auto`, `light`, `dark` or `contrast`.
 * - A theme is a look that `## Themes` in `docs/design.md` declares: `light`, `dark`, `light-contrast` or
 *   `dark-contrast`.
 *
 * This module holds the list `enabled` and the default mode `D`, the theme function `T` (`themeOf`), the mode
 * script with its hash, and the rule `modes-themes`. Every function is pure.
 */
import { DESIGN_FILE } from './context.ts';
import { type Sha256, sha256 } from './csp.ts';
import { fieldPlace, OPTIONS_FILE, type Options } from './options.ts';
import type { Report } from './registry.ts';

/** The mode options, in the order of 7.12. */
export const MODE_OPTIONS = ['auto', 'light', 'dark', 'contrast'] as const;

export type ModeOption = (typeof MODE_OPTIONS)[number];

/** The themes that `docs/design.md` may declare, in the order of the columns of its `## Color` table (7.4). */
export const THEMES = ['light', 'dark', 'light-contrast', 'dark-contrast'] as const;

export type Theme = (typeof THEMES)[number];

/** The two base themes. Each is also a color scheme of the system. */
export type BaseTheme = 'light' | 'dark';

/** The part of the settings that this module reads. `Options` fits. */
export type ModeSettings = Pick<Options, 'modes'>;

/** The list `enabled`: the enabled mode options, in the order `auto`, `light`, `dark`, `contrast`. */
export function enabledModes(options: ModeSettings): ModeOption[] {
  return MODE_OPTIONS.filter((option) => options.modes[option]);
}

/**
 * The default mode `D`: `auto` when `modes.auto` is `true`, else `modes.default`. The schema of 5.2 requires
 * `modes.default` while auto is off. For settings that did not pass it, the first enabled option stands in.
 */
export function defaultMode(options: ModeSettings): ModeOption {
  if (options.modes.auto) return 'auto';
  return options.modes.default ?? enabledModes(options)[0] ?? 'auto';
}

/** Says whether pages get the mode script and need the mode switch: two or more options are on (9.3). */
export function hasModeScript(options: ModeSettings): boolean {
  return enabledModes(options).length >= 2;
}

// The theme function

/** A system state `S`: what `prefers-color-scheme` and `prefers-contrast` report for the visitor. */
export interface SystemState {
  scheme: BaseTheme;
  contrast: 'no-preference' | 'more';
}

/** The four system states. */
export const SYSTEM_STATES: readonly SystemState[] = [
  { scheme: 'light', contrast: 'no-preference' },
  { scheme: 'dark', contrast: 'no-preference' },
  { scheme: 'light', contrast: 'more' },
  { scheme: 'dark', contrast: 'more' },
];

/**
 * `schemeOf(S)`: the scheme of the system state when that base theme is declared, else the one declared base
 * theme. `design-format` requires at least one base theme. With none, the scheme of the state stands in.
 */
export function schemeOf(state: SystemState, themes: readonly Theme[]): BaseTheme {
  if (themes.includes(state.scheme)) return state.scheme;
  const other: BaseTheme = state.scheme === 'light' ? 'dark' : 'light';
  return themes.includes(other) ? other : state.scheme;
}

/**
 * The theme function `T(mode, S)` of 7.12, for the declared themes of `docs/design.md`.
 *
 * - `T(auto, S)` is `<schemeOf(S)>-contrast` when the contrast of `S` is `more` and that theme is declared. Else
 *   it is `schemeOf(S)`.
 * - `T(light, S)` is `light`, and `T(dark, S)` is `dark`.
 * - `T(contrast, S)` is `<schemeOf(S)>-contrast`.
 *
 * An `html` without `data-mode` shows `themeOf(D, S, themes)`. With themes that pass `modes-themes`, the result of
 * an enabled option is always a declared theme.
 */
export function themeOf(mode: ModeOption, state: SystemState, themes: readonly Theme[]): Theme {
  if (mode === 'light' || mode === 'dark') return mode;
  const scheme = schemeOf(state, themes);
  const contrast: Theme = `${scheme}-contrast`;
  if (mode === 'contrast') return contrast;
  return state.contrast === 'more' && themes.includes(contrast) ? contrast : scheme;
}

// The mode script

/** The `localStorage` key of the stored mode (9.3). */
export const MODE_STORAGE_KEY = 'astro-kit:mode';

/**
 * The text of the mode script (9.3): the lines of the specification, joined with `\n`, with no indentation and no
 * final newline. `build:done` inserts it as `<script>${modeScript(options)}</script>` right after the CSP meta of
 * every page, when two or more options are on. The text depends only on `modes`.
 */
export function modeScript(options: ModeSettings): string {
  return [
    '{',
    `const key = '${MODE_STORAGE_KEY}';`,
    `const modes = ${JSON.stringify(enabledModes(options))};`,
    `const fallback = ${JSON.stringify(defaultMode(options))};`,
    'const root = document.documentElement;',
    'const controls = \'[data-mode-switch] [name="mode"]\';',
    'const read = () => { try { const m = localStorage.getItem(key); return modes.includes(m) ? m : fallback; } catch { return fallback; } };',
    "const sync = () => { for (const c of document.querySelectorAll(controls)) { if (c.type === 'radio') c.checked = c.value === root.dataset.mode; else c.value = root.dataset.mode; } };",
    'const apply = () => { root.dataset.mode = read(); sync(); };',
    'apply();',
    "document.addEventListener('DOMContentLoaded', sync);",
    "document.addEventListener('change', (e) => { const c = e.target; if (c instanceof Element && c.matches(controls) && modes.includes(c.value)) { root.dataset.mode = c.value; try { localStorage.setItem(key, c.value); } catch {} } });",
    "document.addEventListener('prerenderingchange', apply);",
    "window.addEventListener('pageshow', (e) => { if (e.persisted) apply(); });",
    "window.addEventListener('storage', (e) => { if (e.key === key) apply(); });",
    '}',
  ].join('\n');
}

/**
 * `MODE_HASH` of the specification (6.2, 9.3): the hash of the mode script for these settings. It is in
 * `script-src` when two or more options are on. It is a function, because the text depends on `modes`.
 */
export function modeHash(options: ModeSettings): Sha256 {
  return sha256(modeScript(options));
}

// The rule `modes-themes`

const RULE = 'modes-themes';

/** The options that reach each theme (7.12): a declared theme needs one of them enabled. */
const REACHED_THROUGH: Readonly<Record<Theme, readonly ModeOption[]>> = {
  light: ['auto', 'light'],
  dark: ['auto', 'dark'],
  'light-contrast': ['auto', 'contrast'],
  'dark-contrast': ['auto', 'contrast'],
};

/** The themes that one enabled option needs, for the declared themes (7.12, the table of `modes-themes`). */
export function neededThemes(option: ModeOption, themes: readonly Theme[]): Theme[] {
  if (option === 'auto' || option === 'light') return ['light'];
  if (option === 'dark') return ['dark'];
  return [
    ...(themes.includes('light') ? (['light-contrast'] as const) : []),
    ...(themes.includes('dark') ? (['dark-contrast'] as const) : []),
  ];
}

/**
 * `modes-themes`: the declared themes of `docs/design.md` serve the enabled mode options (7.12).
 *
 * - An enabled option whose theme is not declared is one finding at `astro-kit.json: modes.<option>`.
 * - A declared theme that no enabled option reaches is one finding at `docs/design.md`.
 *
 * It reports every finding and never throws. It returns true when it added no finding: `design-tokens` runs only
 * then (6.1). The caller runs it only when `design-format` passes, and passes the declared themes of the parsed
 * design document.
 */
export function checkModeThemes(options: ModeSettings, themes: readonly Theme[], report: Report): boolean {
  const enabled = enabledModes(options);
  let passed = true;
  for (const option of enabled) {
    for (const theme of neededThemes(option, themes)) {
      if (themes.includes(theme)) continue;
      passed = false;
      report.add(
        RULE,
        fieldPlace(OPTIONS_FILE, ['modes', option]),
        `the option ${option} needs the theme ${theme}, and ${DESIGN_FILE} does not declare it`,
      );
    }
  }
  for (const theme of THEMES) {
    if (!themes.includes(theme)) continue;
    const through = REACHED_THROUGH[theme];
    if (through.some((option) => enabled.includes(option))) continue;
    passed = false;
    report.add(
      RULE,
      DESIGN_FILE,
      `no enabled mode option reaches the theme ${theme}: it needs ${through.join(' or ')} in modes`,
    );
  }
  return passed;
}

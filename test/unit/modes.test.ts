import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sha256 } from '../../src/csp.ts';
import {
  checkModeThemes,
  defaultMode,
  enabledModes,
  hasModeScript,
  MODE_OPTIONS,
  type ModeOption,
  type ModeSettings,
  modeHash,
  modeScript,
  neededThemes,
  SYSTEM_STATES,
  schemeOf,
  THEMES,
  type Theme,
  themeOf,
} from '../../src/modes.ts';
import { Report } from '../../src/registry.ts';
import { specBlock, variable } from './spec.ts';

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

const ALL: readonly ModeOption[] = ['auto', 'light', 'dark', 'contrast'];

// The options

test('the mode options and the themes have the order of 7.12 and 7.4', () => {
  assert.deepEqual(MODE_OPTIONS, ['auto', 'light', 'dark', 'contrast']);
  assert.deepEqual(THEMES, ['light', 'dark', 'light-contrast', 'dark-contrast']);
});

test('`enabled` keeps the order auto, light, dark, contrast, and `D` is auto or modes.default', () => {
  const cases: [ModeSettings, ModeOption[], ModeOption, boolean][] = [
    [settings(['auto']), ['auto'], 'auto', false],
    [settings(['contrast', 'dark', 'light', 'auto']), ['auto', 'light', 'dark', 'contrast'], 'auto', true],
    [settings(['auto', 'light', 'dark']), ['auto', 'light', 'dark'], 'auto', true],
    [settings(['light', 'dark', 'contrast'], 'light'), ['light', 'dark', 'contrast'], 'light', true],
    [settings(['light', 'dark', 'contrast'], 'contrast'), ['light', 'dark', 'contrast'], 'contrast', true],
    [settings(['dark'], 'dark'), ['dark'], 'dark', false],
    [settings(['dark', 'contrast'], 'dark'), ['dark', 'contrast'], 'dark', true],
  ];
  assert.deepEqual(
    cases.map(([options]) => [enabledModes(options), defaultMode(options), hasModeScript(options)]),
    cases.map(([, enabled, fallback, script]) => [enabled, fallback, script]),
  );
});

// The theme function

/** The four system states, in the order of the columns below. */
test('the four system states are light, dark, light with more contrast, dark with more contrast', () => {
  assert.deepEqual(SYSTEM_STATES, [
    { scheme: 'light', contrast: 'no-preference' },
    { scheme: 'dark', contrast: 'no-preference' },
    { scheme: 'light', contrast: 'more' },
    { scheme: 'dark', contrast: 'more' },
  ]);
});

const L: Theme = 'light';
const K: Theme = 'dark';
const LC: Theme = 'light-contrast';
const KC: Theme = 'dark-contrast';

/** One valid theme set of 7.4, with `T(auto, S)` and `T(contrast, S)` for the four system states, in order. */
interface ThemeCase {
  themes: Theme[];
  auto: [Theme, Theme, Theme, Theme];
  contrast: [Theme, Theme, Theme, Theme];
}

/**
 * Every theme set that `design-format` accepts: at least one base theme, `light-contrast` only with `light`, and
 * `dark-contrast` only with `dark`. The values are written out from the definition of 7.12.
 */
const THEME_CASES: readonly ThemeCase[] = [
  { themes: [L], auto: [L, L, L, L], contrast: [LC, LC, LC, LC] },
  { themes: [K], auto: [K, K, K, K], contrast: [KC, KC, KC, KC] },
  { themes: [L, K], auto: [L, K, L, K], contrast: [LC, KC, LC, KC] },
  { themes: [L, LC], auto: [L, L, LC, LC], contrast: [LC, LC, LC, LC] },
  { themes: [K, KC], auto: [K, K, KC, KC], contrast: [KC, KC, KC, KC] },
  { themes: [L, K, LC], auto: [L, K, LC, K], contrast: [LC, KC, LC, KC] },
  { themes: [L, K, KC], auto: [L, K, L, KC], contrast: [LC, KC, LC, KC] },
  { themes: [L, K, LC, KC], auto: [L, K, LC, KC], contrast: [LC, KC, LC, KC] },
];

/** `T(mode, S)` for the four system states. */
const row = (mode: ModeOption, themes: readonly Theme[]): Theme[] =>
  SYSTEM_STATES.map((state) => themeOf(mode, state, themes));

test('T(mode, S) of 7.12 for every option, every system state and every valid theme set', () => {
  assert.deepEqual(
    THEME_CASES.map(({ themes }) => ({
      themes,
      auto: row('auto', themes),
      light: row('light', themes),
      dark: row('dark', themes),
      contrast: row('contrast', themes),
    })),
    THEME_CASES.map(({ themes, auto, contrast }) => ({
      themes,
      auto,
      light: [L, L, L, L],
      dark: [K, K, K, K],
      contrast,
    })),
  );
});

test('the theme cases are exactly the theme sets that design-format accepts', () => {
  const valid: Theme[][] = [];
  for (let bits = 0; bits < 16; bits++) {
    const themes = THEMES.filter((_, index) => (bits >> index) % 2 === 1);
    const base = themes.includes(L) || themes.includes(K);
    const contrastHasBase =
      (!themes.includes(LC) || themes.includes(L)) && (!themes.includes(KC) || themes.includes(K));
    if (base && contrastHasBase) valid.push(themes);
  }
  const key = (themes: readonly Theme[]): string => themes.join(' ');
  assert.deepEqual(THEME_CASES.map(({ themes }) => key(themes)).sort(), valid.map(key).sort());
});

test('schemeOf is the scheme of the system, or the one declared base theme', () => {
  assert.deepEqual(
    THEME_CASES.map(({ themes }) => SYSTEM_STATES.map((state) => schemeOf(state, themes))),
    [
      [L, L, L, L],
      [K, K, K, K],
      [L, K, L, K],
      [L, L, L, L],
      [K, K, K, K],
      [L, K, L, K],
      [L, K, L, K],
      [L, K, L, K],
    ],
  );
});

// The mode script

const SCRIPT_MARKER = '**The mode script** (`modes-script`)';

/** The text of 9.3 with its two variables filled in. */
const specScript = (modes: readonly ModeOption[], fallback: ModeOption): string =>
  specBlock(SCRIPT_MARKER, 'js')
    .replace(variable('MODES'), JSON.stringify(modes))
    .replace(variable('DEFAULT'), JSON.stringify(fallback));

test('modeScript is the text of 9.3 with the enabled options and the default mode', () => {
  const cases: [ModeSettings, ModeOption[], ModeOption][] = [
    [settings(ALL), ['auto', 'light', 'dark', 'contrast'], 'auto'],
    [settings(['auto', 'dark']), ['auto', 'dark'], 'auto'],
    [settings(['light', 'dark', 'contrast'], 'contrast'), ['light', 'dark', 'contrast'], 'contrast'],
    [settings(['light', 'dark'], 'dark'), ['light', 'dark'], 'dark'],
  ];
  assert.deepEqual(
    cases.map(([options]) => modeScript(options)),
    cases.map(([, modes, fallback]) => specScript(modes, fallback)),
  );
  assert.ok(
    specBlock(SCRIPT_MARKER, 'js').includes(`const modes = ${variable('MODES')};`),
    'the block of 9.3 holds the variable',
  );
});

test('the test vector of 9.3: all four options and D = auto give 1,080 bytes and the given hash', () => {
  const text = modeScript(settings(ALL));
  assert.equal(Buffer.byteLength(text), 1080);
  assert.equal(modeHash(settings(ALL)), 'sha256-tVX7IDqXb4rkmRiqqGfEY8YPs6KvuNlSnmTbTdmGmSs=');
  assert.equal(text.split('\n').length, 16);
  assert.equal(text.startsWith('{\n') && text.endsWith('\n}'), true, 'no final newline');
  assert.equal(/^\s/m.test(text), false, 'no indentation');
});

test('the mode hash is the hash of the mode script, and it changes with an option and with the default', () => {
  const a = settings(['light', 'dark'], 'light');
  const b = settings(['light', 'dark'], 'dark');
  const c = settings(['light', 'dark', 'contrast'], 'light');
  assert.equal(modeHash(a), sha256(modeScript(a)));
  assert.equal(new Set([modeHash(a), modeHash(b), modeHash(c)]).size, 3);
});

// modes-themes

/** One case: a name, the enabled options, the declared themes, and the place of each finding in order. */
type RuleCase = [name: string, options: ModeSettings, themes: Theme[], places: string[]];

const DESIGN = 'docs/design.md';
const option = (name: ModeOption): string => `astro-kit.json: modes.${name}`;

const PASSING: readonly RuleCase[] = [
  ['auto with light (the init default)', settings(['auto']), [L], []],
  ['auto with every theme', settings(['auto']), [L, K, LC, KC], []],
  ['auto, light, dark with the two base themes', settings(['auto', 'light', 'dark']), [L, K], []],
  ['auto, light, dark with a contrast theme too', settings(['auto', 'light', 'dark']), [L, K, LC], []],
  ['light, dark, contrast with all four', settings(['light', 'dark', 'contrast'], 'light'), [L, K, LC, KC], []],
  ['dark alone', settings(['dark'], 'dark'), [K], []],
  ['all four options with all four themes', settings(ALL), [L, K, LC, KC], []],
  ['light and contrast with the light themes', settings(['light', 'contrast'], 'light'), [L, LC], []],
];

const FAILING: readonly RuleCase[] = [
  ['auto needs light', settings(['auto']), [K], [option('auto')]],
  ['light needs light', settings(['light', 'dark'], 'dark'), [K], [option('light')]],
  ['dark needs dark', settings(['auto', 'light', 'dark']), [L], [option('dark')]],
  ['contrast needs light-contrast with light', settings(['light', 'contrast'], 'light'), [L], [option('contrast')]],
  ['contrast needs dark-contrast with dark', settings(['dark', 'contrast'], 'dark'), [K], [option('contrast')]],
  ['contrast needs the contrast theme of each declared base theme', settings(ALL), [L, K, LC], [option('contrast')]],
  ['no option reaches dark', settings(['light'], 'light'), [L, K], [DESIGN]],
  ['no option reaches light', settings(['dark'], 'dark'), [L, K], [DESIGN]],
  ['no option reaches light-contrast', settings(['light', 'dark'], 'light'), [L, K, LC], [DESIGN]],
  ['no option reaches dark-contrast', settings(['dark'], 'dark'), [K, KC], [DESIGN]],
  [
    'every finding of one run, the options first',
    settings(['light', 'contrast'], 'light'),
    [K, KC],
    [option('light'), DESIGN],
  ],
];

interface Seen {
  name: string;
  ids: string[];
  places: string[];
  /** What the check returned: true when it added no finding. */
  passed: boolean;
}

const seenOf = (cases: readonly RuleCase[]): Seen[] =>
  cases.map(([name, options, themes]) => {
    const report = new Report();
    const passed = checkModeThemes(options, themes, report);
    return { name, ids: [...report.ids()].sort(), places: report.findings.map((finding) => finding.where), passed };
  });

const expectedOf = (cases: readonly RuleCase[]): Seen[] =>
  cases.map(([name, , , places]) => ({
    name,
    ids: places.length > 0 ? ['modes-themes'] : [],
    places,
    passed: places.length === 0,
  }));

test('modes-themes passes when the themes serve the options and every theme is reached', () => {
  assert.deepEqual(seenOf(PASSING), expectedOf(PASSING));
});

test('modes-themes fails an option without its theme, and a theme that no option reaches', () => {
  assert.deepEqual(seenOf(FAILING), expectedOf(FAILING));
});

test('a modes-themes finding names the option, the theme and the options that reach a theme', () => {
  const report = new Report();
  checkModeThemes(settings(['light', 'contrast'], 'light'), [K, KC], report);
  assert.deepEqual(
    report.findings.map((finding) => finding.detail),
    [
      'the option light needs the theme light, and docs/design.md does not declare it',
      'no enabled mode option reaches the theme dark: it needs auto or dark in modes',
    ],
  );
});

test('the themes that an option needs are those of the table of 7.12', () => {
  assert.deepEqual(
    MODE_OPTIONS.map((name) => [neededThemes(name, [L]), neededThemes(name, [K]), neededThemes(name, [L, K])]),
    [
      [[L], [L], [L]],
      [[L], [L], [L]],
      [[K], [K], [K]],
      [[LC], [KC], [LC, KC]],
    ],
  );
});

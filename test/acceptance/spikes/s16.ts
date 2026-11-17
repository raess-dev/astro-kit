import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  type Browser,
  browse,
  build,
  type Files,
  launch,
  type Page,
  PIXEL_SOURCE,
  type Pixel,
  pixelDistance,
  read,
  record,
  STAND_IN,
  samePixel,
  serve,
  styles,
} from '../harness.ts';
import { page, project } from './project.ts';
import { cases, REFUSED, SETTINGS, type Setting, SYNTAX } from './s16-designs.ts';
import {
  type Design,
  defaultOf,
  designValue,
  enabledOf,
  MEDIA_SELECTOR,
  type Modes,
  type Option,
  problems,
  renderTokens,
  SYSTEMS,
  type System,
  scheme,
  themeOf,
} from './s16-tokens.ts';

/** The text of setting 1, as 7.7 prints it. */
const SETTING_1 = readFileSync(join(STAND_IN, 'tokens-setting-1.css'), 'utf8');
const textOf = (setting: Setting): string => setting.text ?? SETTING_1;

/** A media selector that leaves `data-mode="auto"` out. No text of 7.7 has it: the controls use it. */
const NO_ATTRIBUTE_ONLY = ':root:not([data-mode])';

const tokensOf = (design: Design): string[] => design.colors.map((color) => color.token);

/** One probe for each color token: an element whose `background-color` is the token. */
const probeCss = (tokens: string[]): string => {
  const rules = tokens.map((token) => `  [data-probe="${token}"] {\n    background-color: var(${token});\n  }\n`);
  return `@layer elements {\n${rules.join('')}}\n`;
};
const probePage = (title: string, tokens: string[], frontmatter = ''): string =>
  page(title, tokens.map((token) => `<span data-probe="${token}"></span>`).join(''), frontmatter);

/** The `@layer tokens{…}` block of built CSS. `undefined` when the CSS has no tokens layer: the caller asserts it. */
function tokensBlock(css: string): string | undefined {
  const start = css.indexOf('@layer tokens{');
  if (start === -1) return undefined;
  let depth = 0;
  for (let at = start; at < css.length; at += 1) {
    if (css[at] === '{') depth += 1;
    if (css[at] === '}') {
      depth -= 1;
      if (depth === 0) return css.slice(start, at + 1);
    }
  }
  throw new Error('the tokens layer does not end');
}

/** What the init script of `open` adds to each page: the canvas painter of the harness. */
type Probed = { __pixel(color: string): Pixel };

/** A new tab whose pages can paint a color on a canvas. An init script is not subject to the page CSP. */
async function open(browser: Browser): Promise<Page> {
  const tab = await (await browser.newContext()).newPage();
  await tab.addInitScript(`window.__pixel = ${PIXEL_SOURCE};`);
  return tab;
}

/** Emulates the system state, and waits until the page's media queries report it. */
async function emulate(tab: Page, system: System): Promise<void> {
  await tab.emulateMedia({ colorScheme: system.scheme, contrast: system.contrast });
  await tab.waitForFunction(
    (s: System) =>
      matchMedia(`(prefers-color-scheme: ${s.scheme})`).matches &&
      matchMedia(`(prefers-contrast: ${s.contrast})`).matches,
    system,
    { timeout: 30_000 },
  );
}

interface Painted {
  /** The four channels of the color on a 1×1 canvas. Empty when the text is no color. */
  pixel: Pixel;
  /** The computed text. It is for the failure message only: the spike never compares it. */
  text: string;
}
interface Reading {
  scheme: string;
  colors: Record<string, { probe: Painted; reference: Painted }>;
}

/**
 * Runs in the page. Sets the mode state, then reads the computed `color-scheme` of `html`, and for each token the
 * computed color of its probe and of a reference element that is painted with the design value. So both colors go
 * through the same property, and the color syntax of the design does not matter. Both colors are then painted on a
 * 1×1 canvas, as the contrast probe of section 8 does (`contrast-pairs`): the spike compares the pixels.
 */
function readState(arg: { mode: string | null; expected: Record<string, string> }): Reading {
  const root = document.documentElement;
  if (arg.mode === null) root.removeAttribute('data-mode');
  else root.setAttribute('data-mode', arg.mode);
  const reference = document.createElement('span');
  document.body.append(reference);
  const paint = (text: string): Painted => ({ pixel: (window as unknown as Probed).__pixel(text), text });
  const colors: Reading['colors'] = {};
  for (const [token, value] of Object.entries(arg.expected)) {
    reference.style.backgroundColor = '';
    reference.style.backgroundColor = value;
    const element = document.querySelector(`[data-probe="${token}"]`);
    colors[token] = {
      probe: paint(element ? getComputedStyle(element).backgroundColor : 'no probe'),
      reference: paint(
        reference.style.backgroundColor === '' ? 'no color' : getComputedStyle(reference).backgroundColor,
      ),
    };
  }
  reference.remove();
  return { scheme: getComputedStyle(root).colorScheme, colors };
}

/** A state where the page shows another value than the design value gives. */
interface Miss {
  page: string;
  mode: string;
  system: string;
  what: string;
  got: string;
  want: string;
  /** For a color: the design value, its theme, and the distance of the two colors on a canvas, of 255. */
  design?: string;
  theme?: string;
  distance?: number;
}

class Tally {
  states = 0;
  readings = 0;
  misses: Miss[] = [];
  /** The readings that `check` cannot compare: no reading for a token, or a side that is no color. */
  unreadable: string[] = [];
}

/** The mode states of 7.12: the no-attribute state, and with two or more options each of them as `data-mode`. */
const modeStates = (modes: Modes): (Option | null)[] => {
  const enabled = enabledOf(modes);
  return [null, ...(enabled.length >= 2 ? enabled : [])];
};

/**
 * Checks the loaded page in each of the mode states `states` and each system state: every probe shows the design
 * value of `T(M, S)` (7.12), and `html` has the `color-scheme` `scheme(M)`, with `D` for the no-attribute state.
 * A probe shows the design value when each of the four canvas channels is equal within 1 of 255 (`modes-behavior`).
 * The function asserts nothing. It adds to `tally`, and the test asserts that `tally.unreadable` is empty and what
 * `tally.misses` holds.
 */
async function check(
  tab: Page,
  name: string,
  design: Design,
  modes: Modes,
  states: (Option | null)[],
  tally: Tally,
): Promise<void> {
  const tokens = tokensOf(design);
  for (const system of SYSTEMS) {
    await emulate(tab, system);
    for (const state of states) {
      const mode = state ?? defaultOf(modes);
      const theme = themeOf(design, mode, system);
      const expected = Object.fromEntries(tokens.map((token) => [token, designValue(design, token, theme)]));
      const got = await tab.evaluate(readState, { mode: state, expected });
      const where = { page: name, mode: state ?? 'no attribute', system: `${system.scheme}, ${system.contrast}` };
      tally.states += 1;
      if (got.scheme !== scheme(design, mode)) {
        tally.misses.push({ ...where, what: 'color-scheme', got: got.scheme, want: scheme(design, mode) });
      }
      for (const token of tokens) {
        const color = got.colors[token];
        if (!color) {
          tally.unreadable.push(`${name}: no reading for ${token}`);
          continue;
        }
        const before = tally.unreadable.length;
        if (color.reference.pixel.length !== 4) {
          tally.unreadable.push(`${name}: the design value of ${token} is no color: ${color.reference.text}`);
        }
        if (color.probe.pixel.length !== 4) {
          tally.unreadable.push(`${name}: the probe of ${token} has no color: ${color.probe.text}`);
        }
        if (tally.unreadable.length > before) continue;
        tally.readings += 1;
        if (!samePixel(color.probe.pixel, color.reference.pixel)) {
          tally.misses.push({
            ...where,
            what: token,
            got: color.probe.text,
            want: color.reference.text,
            design: expected[token] ?? '',
            theme,
            distance: pixelDistance(color.probe.pixel, color.reference.pixel),
          });
        }
      }
    }
  }
}

const brief = (misses: Miss[]): string[] =>
  misses.map((miss) => `${miss.page} | ${miss.mode} | ${miss.system} | ${miss.what}`);

/** The misses of a text whose media block leaves `data-mode="auto"` out: the contrast themes do not show there. */
const withoutAuto = (name: string): string[] =>
  ['light', 'dark'].flatMap((system) =>
    ['--color-text', '--color-muted'].map((token) => `${name} | auto | ${system}, more | ${token}`),
  );

test('S16: renderTokens of 7.7 gives the printed text of setting 1 and the texts of settings 2 to 5', () => {
  for (const setting of SETTINGS) {
    assert.deepEqual(problems(setting.design, setting.modes), [], `setting ${setting.id} is valid`);
    assert.equal(renderTokens(setting.design, setting.modes), textOf(setting), `the text of setting ${setting.id}`);
  }
  const all = cases();
  assert.equal(new Set(all.map((one) => one.name)).size, all.length, 'each case has its own name');
  record('S16.cases', all.length);
});

const settingDirs = new Map<number, string>();

/**
 * The built case of a setting of 7.7: the stand-in injects its text as `src/styles/tokens.css` (6.1 step 9).
 * Each setting is built once, by the first test that asks for it, so no test needs another test to run first.
 */
function settingDir(setting: Setting): string {
  const known = settingDirs.get(setting.id);
  if (known !== undefined) return known;
  const tokens = tokensOf(setting.design);
  const dir = project(`s16-${setting.id}`, {
    'src/styles/tokens.css': textOf(setting),
    'src/styles/elements.css': probeCss(tokens),
    'src/pages/index.astro': probePage(`Setting ${setting.id}`, tokens),
  });
  build(dir);
  settingDirs.set(setting.id, dir);
  return dir;
}

/** The built `tokens` layer of setting 1, from the build that injects `src/styles/tokens.css`. */
const injectedSetting1 = (): string | undefined =>
  tokensBlock(styles(read(settingDir(SETTINGS[0] as Setting), 'dist/index.html')));

test('S16: in Chromium, the five texts of 7.7 show T(M, S) and scheme(M) in every mode state and system state', async () => {
  const dirs = SETTINGS.map((setting) => {
    const dir = settingDir(setting);
    const css = styles(read(dir, 'dist/index.html'));
    assert.equal(css.includes('lightningcss'), false, 'the build does not lower light-dark()');
    assert.equal(css.includes('light-dark('), setting.id !== 5, 'light-dark() reaches the page, but not in setting 5');
    return dir;
  });
  const injected = injectedSetting1();
  assert.ok(injected, 'the built CSS of setting 1 has a tokens layer');
  record('S16.builtTokens.setting1', injected);

  const inside = new Tally();
  const outside = new Tally();
  let tokenItself = '';
  let nested: Pixel = [];
  let darkValue: Pixel = [];
  const browser = await launch();
  try {
    const tab = await open(browser);
    for (const [index, setting] of SETTINGS.entries()) {
      const server = await serve(join(dirs[index] ?? '', 'dist'));
      try {
        await tab.goto(`${server.origin}/`);
        const name = `setting ${setting.id}`;
        await check(tab, name, setting.design, setting.modes, modeStates(setting.modes), inside);
        // With one option there is no mode script, so `data-mode` is never set (7.12). What if it is set?
        const enabled = enabledOf(setting.modes);
        if (enabled.length === 1) await check(tab, name, setting.design, setting.modes, enabled, outside);
        if (setting.id === 1) {
          await emulate(tab, { scheme: 'light', contrast: 'no-preference' });
          [tokenItself, nested, darkValue] = await tab.evaluate(() => {
            const root = document.documentElement;
            root.removeAttribute('data-mode');
            const box = document.createElement('div');
            box.style.colorScheme = 'dark';
            const probe = document.createElement('span');
            probe.setAttribute('data-probe', '--color-text');
            box.append(probe);
            document.body.append(box);
            const { __pixel: pixel } = window as unknown as Probed;
            const color = pixel(getComputedStyle(probe).backgroundColor);
            box.remove();
            return [getComputedStyle(root).getPropertyValue('--color-text'), color, pixel('#eeeeee')] as const;
          });
        }
      } finally {
        await server.close();
      }
    }
  } finally {
    await browser.close();
  }

  assert.deepEqual(inside.unreadable, []);
  assert.deepEqual(inside.misses, [], 'every state shows T(M, S) and scheme(M)');
  // 20 states for setting 1, 4 for 2, 16 for 3, 16 for 4, 4 for 5; 3 color tokens.
  assert.equal(inside.states, 60);
  assert.equal(inside.readings, 180);
  record('S16.states.settings', inside.states);

  // The custom property itself keeps the text: its computed value is not a color. Only a color property that uses
  // the token computes to the design value, so the checks need a probe.
  assert.match(tokenItself, /^light-dark\(/, 'the computed value of the token itself is the light-dark() text');
  record('S16.tokenItself', 'the light-dark() text, not a color');
  // So the element that uses the token picks the side: below a `color-scheme: dark` the light page shows the dark
  // value `#eeeeee`. This is why no rule outside tokens.css may set `color-scheme` (7.12).
  assert.ok(samePixel(nested, darkValue), `a nested color-scheme decides the light-dark() tokens below it: ${nested}`);
  record('S16.nestedColorScheme', 'decides the tokens below it');

  // Outside the state space of 7.12: `data-mode` set by hand with one option (settings 2 and 5). The media block
  // always names `:root[data-mode="auto"]` too, so `data-mode="auto"` shows T(auto, S), the contrast themes included.
  assert.deepEqual(outside.unreadable, []);
  assert.equal(outside.states, 8);
  assert.deepEqual(outside.misses, [], 'data-mode set with one option shows T(M, S) too');
  record('S16.oneOption.dataModeAuto', 'shows T(auto, S), the contrast themes included');
});

test('S16: every valid theme set and modes setting shows T(M, S), with empty cells and aliases', async () => {
  const all = cases();
  // The cases with the one option `auto` and a media block. A control page holds their text with the selector
  // `:root:not([data-mode])` in the block, which an earlier text of 7.7 had with one option.
  const oneAuto = all.filter(
    (one) => enabledOf(one.modes).length === 1 && renderTokens(one.design, one.modes).includes('@media'),
  );
  // Setting 1 with the `auto` selector taken out of the media block: the check must see that this text is wrong.
  const broken = SETTING_1.replace(MEDIA_SELECTOR, NO_ATTRIBUTE_ONLY);
  assert.notEqual(broken, SETTING_1);
  const setting1 = SETTINGS[0] as Setting;

  const pages: { path: string; css: string; tokens: string[] }[] = [
    ...all.map((one, index) => ({
      path: `c${index}`,
      css: renderTokens(one.design, one.modes),
      tokens: tokensOf(one.design),
    })),
    ...oneAuto.map((one, index) => ({
      path: `narrow${index}`,
      css: renderTokens(one.design, one.modes).replace(MEDIA_SELECTOR, NO_ATTRIBUTE_ONLY),
      tokens: tokensOf(one.design),
    })),
    { path: 'broken', css: broken, tokens: tokensOf(setting1.design) },
    { path: 'setting1', css: SETTING_1, tokens: tokensOf(setting1.design) },
  ];
  for (const one of pages) {
    assert.equal(/color-mix\(|display-p3/.test(one.css), false, `${one.path} holds no color-mix() and no display-p3`);
    assert.equal(
      one.css.includes(`${NO_ATTRIBUTE_ONLY} {`),
      /^(narrow\d+|broken)$/.test(one.path),
      `${one.path}: the media selector`,
    );
  }
  const files: Files = { 'src/styles/probes.css': probeCss([...new Set(pages.flatMap((one) => one.tokens))]) };
  for (const one of pages) {
    files[`src/styles/cases/${one.path}.css`] = one.css;
    files[`src/pages/${one.path}.astro`] = probePage(one.path, one.tokens, `import '../styles/cases/${one.path}.css';`);
  }
  // One build for all pages: the stand-in injects base.css and the probes, and each page imports its own tokens file.
  const dir = project(
    's16-all',
    files,
    "{ css: ['./kit/base.css', './src/styles/probes.css'].map((file) => fileURLToPath(new URL(file, import.meta.url))) }",
    "import { fileURLToPath } from 'node:url';",
  );
  build(dir);
  for (const one of pages) {
    const css = styles(read(dir, `dist/${one.path}/index.html`));
    assert.equal(css.split('@layer tokens{').length, 2, `${one.path} holds one tokens layer`);
    assert.equal(css.includes('lightningcss'), false, 'the build does not lower light-dark()');
  }
  // The page import gives the same built text as the injection of `src/styles/tokens.css`. So the pages of this
  // build stand for the injected file of 6.1.
  const imported = tokensBlock(styles(read(dir, 'dist/setting1/index.html')));
  assert.ok(imported, 'the built CSS of the page setting1 has a tokens layer');
  const injected = injectedSetting1();
  assert.ok(injected, 'the built CSS of setting 1 has a tokens layer');
  assert.equal(imported, injected, 'the page import and the injection give the same built tokens layer');

  const inside = new Tally();
  const outside = new Tally();
  const narrowTally = new Tally();
  const brokenTally = new Tally();
  const server = await serve(join(dir, 'dist'));
  try {
    const browser = await launch();
    try {
      const tab = await open(browser);
      for (const [index, one] of all.entries()) {
        await tab.goto(`${server.origin}/c${index}/`);
        await check(tab, one.name, one.design, one.modes, modeStates(one.modes), inside);
        const enabled = enabledOf(one.modes);
        if (enabled.length === 1) await check(tab, one.name, one.design, one.modes, enabled, outside);
      }
      for (const [index, one] of oneAuto.entries()) {
        await tab.goto(`${server.origin}/narrow${index}/`);
        await check(tab, one.name, one.design, one.modes, [null, 'auto'], narrowTally);
      }
      await tab.goto(`${server.origin}/broken/`);
      await check(tab, 'broken', setting1.design, setting1.modes, modeStates(setting1.modes), brokenTally);
    } finally {
      await browser.close();
    }
  } finally {
    await server.close();
  }

  // Every reading of the four checks is a pair of colors: no token without a reading, and no text that is no color.
  assert.deepEqual(inside.unreadable, []);
  assert.deepEqual(outside.unreadable, []);
  assert.deepEqual(narrowTally.unreadable, []);
  assert.deepEqual(brokenTally.unreadable, []);
  assert.deepEqual(inside.misses, [], 'every state of every case shows T(M, S) and scheme(M)');
  record('S16.states.designs', inside.states);
  record('S16.readings.designs', inside.readings);

  // The check sees a wrong text: without the `auto` selector, `data-mode="auto"` loses the contrast themes.
  assert.deepEqual(brief(brokenTally.misses), withoutAuto('broken'));

  // Outside the state space of 7.12: `data-mode` set by hand with one option. The text of 7.7 shows T(M, S) there too.
  assert.deepEqual(outside.misses, [], 'data-mode set with one option shows T(M, S) too');
  record('S16.states.outside', outside.states);
  // The control: with `:root:not([data-mode])` alone in the media block, `data-mode="auto"` shows the base theme
  // under `prefers-contrast: more`, in each of these cases, and nothing else is wrong.
  assert.equal(oneAuto.length, 4);
  assert.equal(narrowTally.states, oneAuto.length * 8);
  assert.deepEqual(
    [...new Set(narrowTally.misses.map((miss) => miss.page))],
    oneAuto.map((one) => one.name),
  );
  assert.ok(
    narrowTally.misses.every(
      (miss) => miss.mode === 'auto' && miss.system.endsWith('more') && miss.what !== 'color-scheme',
    ),
  );
});

test('S16: every color syntax that 7.4 accepts shows the design value; the build replaces color-mix() and display-p3', async (t) => {
  const tokens = tokensOf(SYNTAX.design);
  const dir = project('s16-syntax', {
    'src/styles/tokens.css': renderTokens(SYNTAX.design, SYNTAX.modes),
    'src/styles/elements.css': probeCss(tokens),
    'src/pages/index.astro': probePage('Syntax', tokens),
  });
  build(dir);
  const built = tokensBlock(styles(read(dir, 'dist/index.html')));
  assert.ok(built, 'the built CSS has a tokens layer');
  // The minifier keeps these syntaxes as written, also a wide color in oklch(). It writes every other one in a
  // shorter form: hex, a name, or `color(xyz …)` for `xyz-d65`, which is the same space.
  for (const kept of [
    'lab(29% 39 -20)',
    'lch(52% 60 30)',
    'oklab(60% .1 -.1)',
    'oklch(40% .1 250)',
    'oklch(70% .3 145)',
  ]) {
    assert.ok(built.includes(`light-dark(${kept},#123456)`), `${kept} stays as written`);
  }
  // `color()` stays in its space, for every space that 7.4 accepts: the build writes no sRGB value in its place.
  for (const [name, written] of [
    ['srgb', 'srgb'],
    ['srgb-linear', 'srgb-linear'],
    ['a98-rgb', 'a98-rgb'],
    ['prophoto-rgb', 'prophoto-rgb'],
    ['rec2020', 'rec2020'],
    ['xyz', 'xyz'],
    ['xyz-d50', 'xyz-d50'],
    ['xyz-d65', 'xyz'],
  ] as const) {
    assert.ok(
      built.includes(`--color-${name}:light-dark(color(${written} .2 .4 .6),#123456)`),
      `color(${name} …) stays in its space: ${new RegExp(`--color-${name}:[^;}]+`).exec(built)?.[0]}`,
    );
  }
  assert.equal(built.includes('@supports'), false, 'the build adds no @supports rule');
  const tally = new Tally();
  const server = await serve(join(dir, 'dist'));
  try {
    const browser = await launch();
    try {
      const tab = await open(browser);
      await tab.goto(`${server.origin}/`);
      await check(tab, SYNTAX.name, SYNTAX.design, SYNTAX.modes, modeStates(SYNTAX.modes), tally);
    } finally {
      await browser.close();
    }
  } finally {
    await server.close();
  }
  assert.deepEqual(tally.unreadable, []);
  assert.equal(tally.states, 20);
  assert.equal(tally.readings, 20 * tokens.length);
  assert.deepEqual(tally.misses, [], 'every accepted syntax shows the design value in every state');

  // The two syntaxes that 7.4 refuses. The spike reads the built CSS only: these facts hold in any browser.
  const refused = project('s16-refused', {
    'src/styles/tokens.css': renderTokens(REFUSED.design, REFUSED.modes),
    'src/styles/elements.css': probeCss(tokensOf(REFUSED.design)),
    'src/pages/index.astro': probePage('Refused', tokensOf(REFUSED.design)),
  });
  build(refused);
  const replaced = tokensBlock(styles(read(refused, 'dist/index.html')));
  assert.ok(replaced, 'the built CSS of the refused syntaxes has a tokens layer');
  /** What the first `:root` rule of the built tokens layer declares for the token. */
  const declared = (token: string): string => new RegExp(`${token}:([^;}]+)`).exec(replaced)?.[1] ?? '';
  // The minifier computes color-mix(), so the page holds the minifier's result and never the browser's own mix.
  // The second value is a mix `in oklch` with a nearly gray color: there the two results differ visibly (below).
  assert.equal(declared('--color-mix'), 'light-dark(#793f3f,#123456)', 'color-mix() is computed in the build');
  assert.equal(declared('--color-mix-hue'), 'light-dark(oklch(81.4793% .0618126 161.106),#123456)');
  assert.equal(replaced.includes('color-mix('), false, 'no color-mix() reaches the page');
  // lightningcss holds that only Safari knows display-p3. So with the `cssTarget` of 6.1 it writes an sRGB value
  // first, and the display-p3 values in an `@supports` rule after each rule.
  assert.equal(declared('--color-p3'), 'light-dark(#ff8004,#123456)', 'display-p3 gets an sRGB value first');
  assert.equal(declared('--color-pair'), 'light-dark(#03edf4,#87f400)');
  const SUPPORTS = '@supports (color:color(display-p3 0 0 0)){';
  // In that rule the other side of the light-dark() is display-p3 too: the hex design values `#123456` and `#03edf4`
  // reach the page as display-p3 colors.
  const again =
    ':root{--color-p3:light-dark(color(display-p3 1 .5 0),color(display-p3 .106562 .200947 .326991));--color-pair:light-dark(color(display-p3 .425044 .915677 .94766),color(display-p3 .634 .948 .293))}';
  assert.ok(
    replaced.includes(`${SUPPORTS}${again}`),
    'an @supports rule holds both sides of light-dark() in display-p3',
  );
  assert.equal(replaced.split(SUPPORTS).length - 1, 3, 'one @supports rule after each rule with a display-p3 color');

  // 13.1 item 40 in the browser: the page shows the minifier's result, and that is another color than the browser's
  // own mix. Both are painted on a canvas. The spike asserts only that they differ by more than the tolerance of
  // `modes-behavior`, and it records no distance.
  const hue = '--color-mix-hue';
  const design = designValue(REFUSED.design, hue, 'light');
  assert.ok(design.startsWith('color-mix(in oklch,'), 'the design value is a mix in oklch');
  const { server: site, browser, close } = await browse(join(refused, 'dist'));
  try {
    const tab = await open(browser);
    await tab.goto(`${site.origin}/`);
    await emulate(tab, { scheme: 'light', contrast: 'no-preference' });
    const mixed = (await tab.evaluate(readState, { mode: null, expected: { [hue]: design } })).colors[hue];
    assert.ok(mixed, 'a reading for the mixed color');
    assert.equal(mixed.reference.pixel.length, 4, `the browser mixes the design value: ${mixed.reference.text}`);
    assert.equal(mixed.probe.pixel.length, 4, `the probe has a color: ${mixed.probe.text}`);
    const distance = pixelDistance(mixed.probe.pixel, mixed.reference.pixel);
    t.diagnostic(`S16: the built color-mix() differs from the browser's own mix by ${distance} of 255 in a channel`);
    assert.ok(
      distance > 1,
      `the page does not show the design value: ${mixed.probe.text} against ${mixed.reference.text}`,
    );
  } finally {
    await close();
  }
  record('S16.replacedInTheBuild', {
    '--color-mix': declared('--color-mix'),
    '--color-mix-hue': declared('--color-mix-hue'),
    '--color-p3': declared('--color-p3'),
    '--color-pair': declared('--color-pair'),
    supportsRules: replaced.split(SUPPORTS).length - 1,
  });
});

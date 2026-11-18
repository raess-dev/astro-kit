/**
 * Shared inputs of the unit tests of the css, design and modes rules (part 5a of M5): a design that passes
 * `design-format`, the smallest `elements.css` that meets `design-pairs`, the built CSS that Lightning CSS writes for
 * them, and builders of a `SourceCss` and of a `BuiltCssInput` from strings. A helper here never asserts: it throws an
 * `Error` when its input is not valid.
 *
 * The built texts are the output of the minifier with the targets of 6.1 (`vite.build.cssTarget`), for
 * `css/base.css`, `tokens.css` and `ELEMENTS_CSS` in the order of 6.1, step 9, as one chunk. A test that needs
 * the built form of other CSS writes it as the minifier writes it (13.1 item 40).
 */
import { memoryContext } from '../../src/build.ts';
import type { Design } from '../../src/context.ts';
import { type BuiltCssInput, builtCss, type SourceCss, sourceCss } from '../../src/css/rules.ts';
import { parseDesign } from '../../src/design/parse.ts';
import { renderTokens, TOKENS_FILE } from '../../src/design/tokens.ts';
import type { Options } from '../../src/options.ts';
import { Report } from '../../src/registry.ts';
import { factsOf, optionsOf, SMALLEST } from './fixtures.ts';

// Settings

/** The smallest settings: one locale, the one mode option `auto`. */
export const AUTO: Options = optionsOf(SMALLEST);

/** The smallest settings with the mode options `auto`, `light` and `dark`: `modes-media` reads the mode features. */
export const SWITCH: Options = optionsOf({
  ...SMALLEST,
  modes: { auto: true, light: true, dark: true, contrast: false },
});

// The design

/**
 * A `docs/design.md` that passes `design-format` and `modes-themes` for `AUTO` and `SWITCH`. It declares every token
 * that the drift and freedom matrices of 14.1 name, a percentage of `--space-` and of `--size-`, a ratio, a
 * viewport width, an inset shadow (the limits of `css-token-family`), the breakpoints `48rem` and `30rem`, the
 * helper parameter `--stack-gap`, and the mandatory pairs, with a pair for each color that the matrices use. It has
 * no `## Elements` and no `## Components` row.
 */
export const DESIGN_TEXT =
  '# Design\n\nThe design of the unit tests of the css, design and modes rules.\n\n## Themes\n\n| Theme | Use |\n|---|---|\n| light | The default theme. |\n| dark | The dark theme. |\n\n## Color\n\n| Token | light | dark | Use |\n|---|---|---|---|\n| `--color-page` | `#ffffff` | `#111111` | The page background. |\n| `--color-text` | `#222222` | `#eeeeee` | Body text. |\n| `--color-link` | `#0b4f9c` | `#9cc8ff` | Links. |\n| `--color-focus` | `#9c4f0b` | `#ffc89c` | The focus ring. |\n| `--color-error` | `#a1201b` | `#ffa095` | Error text. |\n| `--color-accent` | `#7a3d00` | `#ffd08a` | Accent text. |\n| `--color-a` | `#f7dfb9` | `#3b2b17` | The first color of the gradient. |\n| `--color-b` | `#f1e8d9` | `#252019` | The last color of the gradient. |\n| `--color-shadow` | `#00000033` | `#00000099` | The color of a shadow. |\n\n## Typography\n\n| Token | Value | Use |\n|---|---|---|\n| `--font-body` | `system-ui, sans-serif` | Text. |\n| `--text-m` | `1rem` | Body text. |\n\n## Spacing\n\n| Token | Value | Use |\n|---|---|---|\n| `--space-1` | `0.25rem` | A small gap. |\n| `--space-2` | `0.5rem` | A gap. |\n| `--space-4` | `1rem` | A large gap. |\n| `--space-fluid` | `5%` | A padding that grows with the container. |\n\n## Size\n\n| Token | Value | Use |\n|---|---|---|\n| `--size-content` | `40rem` | The width of the content. |\n| `--size-half` | `50%` | Half of the container. |\n| `--size-wide` | `16 / 9` | A wide ratio. |\n| `--size-screen` | `100vw` | The width of the viewport. |\n\n## Line\n\n| Token | Value | Use |\n|---|---|---|\n| `--line-1` | `0.0625rem` | A thin line. |\n\n## Shadow\n\n| Token | Value | Use |\n|---|---|---|\n| `--shadow-card` | `0 0.5rem 1.5rem var(--color-shadow)` | Cards. |\n| `--shadow-inset` | `inset 0 0 0.25rem var(--color-shadow)` | A pressed control. |\n\n## Opacity\n\n| Token | Value | Use |\n|---|---|---|\n| `--opacity-half` | `0.5` | Half visible. |\n\n## Gradient\n\n| Token | Value | Use |\n|---|---|---|\n| `--gradient-hero` | `linear-gradient(135deg, var(--color-a) 0%, var(--color-b) 60%)` | The hero. |\n\n## Breakpoints\n\n| Name | Width | Use |\n|---|---|---|\n| medium | 48rem | Tablets and wider. |\n| card | 30rem | A container query. |\n\n## Layout helpers\n\n| Parameter | Token | Use |\n|---|---|---|\n| `--stack-gap` | `var(--space-2)` | The gap of a stack. |\n\n## Contrast pairs\n\n| Foreground | Background | Role | For |\n|---|---|---|---|\n| `--color-text` | `--color-page` | text | body |\n| `--color-link` | `--color-page` | ui | link |\n| `--color-focus` | `--color-page` | non-text | focus |\n| `--color-error` | `--color-page` | ui | error |\n| `--color-accent` | `--color-page` | ui | Accent text |\n| `--color-text` | `--color-a` | text | Text on the gradient |\n| `--color-text` | `--color-b` | text | Text on the gradient |\n| `--color-focus` | `--color-a` | non-text | focus |\n| `--color-focus` | `--color-b` | non-text | focus |\n';

/** The parsed design of a text. Throws with the `design-format` findings when the text does not pass. */
export function designOf(text: string = DESIGN_TEXT): Design {
  const report = new Report();
  const design = parseDesign(text, report);
  if (design === undefined) throw new Error(report.format());
  return design;
}

/** The parsed `DESIGN_TEXT`. */
export const DESIGN: Design = designOf();

// Project CSS

/**
 * The smallest `elements.css` that meets `design-pairs` for `DESIGN`: the `body` pair on `body`, the `link` color on
 * `a`, the `focus` color on `:focus-visible`.
 */
export const ELEMENTS_CSS =
  '@layer elements {\n  body {\n    color: var(--color-text);\n    background-color: var(--color-page);\n  }\n\n  a {\n    color: var(--color-link);\n  }\n\n  :focus-visible {\n    outline-color: var(--color-focus);\n  }\n}\n';

/** A project file: its text, or `null` to leave out a default file. */
export type ProjectFiles = Readonly<Record<string, string | null>>;

/**
 * The source input of a project from strings. The defaults are `src/styles/tokens.css` (the rendering of the design
 * for the settings), `src/styles/elements.css` (`ELEMENTS_CSS`) and an empty `src/styles/fonts.css`. `files` adds
 * files, replaces a default, or with `null` leaves one out. `design` `null` gives the input of a design that fails
 * `design-format`; `options` `null` that of settings that are not valid.
 */
export function project(
  files: ProjectFiles = {},
  settings: { design?: Design | null; options?: Options | null } = {},
): SourceCss {
  const design = settings.design === null ? undefined : (settings.design ?? DESIGN);
  const options = settings.options === null ? undefined : (settings.options ?? AUTO);
  const all: Record<string, string | null> = {
    [TOKENS_FILE]: renderTokens(design ?? DESIGN, options ?? AUTO),
    'src/styles/elements.css': ELEMENTS_CSS,
    'src/styles/fonts.css': '',
    ...files,
  };
  const list = Object.entries(all).flatMap(([path, text]) => (text === null ? [] : [{ path, text }]));
  return sourceCss(list, design, options);
}

// Built CSS

/** The built CSS of the global chunk with `AUTO`: `css/base.css`, `tokens.css` and `ELEMENTS_CSS`, minified. */
export const BUILT_AUTO =
  '@layer astro;@layer reset{*,:before,:after{box-sizing:border-box}*{margin:0}img,picture,svg,video,canvas{block-size:auto;max-inline-size:100%;display:block}input,button,textarea,select{font:inherit;color:inherit}[hidden]:not([hidden=until-found]),:root:not([data-mode]) [data-mode-switch]{display:none!important}.visually-hidden:not(:focus-within){clip-path:inset(50%)!important;white-space:nowrap!important;block-size:1px!important;inline-size:1px!important;position:absolute!important;overflow:hidden!important}:focus-visible:not([tabindex="-1"]){outline-style:solid!important}@media (prefers-reduced-motion:reduce){*,:before,:after{scroll-behavior:auto!important;transition:none!important;animation:none!important}}}@layer tokens{:root{color-scheme:light dark;--color-page:light-dark(#fff,#111);--color-text:light-dark(#222,#eee);--color-link:light-dark(#0b4f9c,#9cc8ff);--color-focus:light-dark(#9c4f0b,#ffc89c);--color-error:light-dark(#a1201b,#ffa095);--color-accent:light-dark(#7a3d00,#ffd08a);--color-a:light-dark(#f7dfb9,#3b2b17);--color-b:light-dark(#f1e8d9,#252019);--color-shadow:light-dark(#0003,#0009);--font-body:system-ui, sans-serif;--text-m:1rem;--space-1:.25rem;--space-2:.5rem;--space-4:1rem;--space-fluid:5%;--size-content:40rem;--size-half:50%;--size-wide:16 / 9;--size-screen:100vw;--line-1:.0625rem;--shadow-card:0 .5rem 1.5rem var(--color-shadow);--shadow-inset:inset 0 0 .25rem var(--color-shadow);--opacity-half:.5;--gradient-hero:linear-gradient(135deg, var(--color-a) 0%, var(--color-b) 60%);--stack-gap:var(--space-2)}}@layer elements{body{color:var(--color-text);background-color:var(--color-page)}a{color:var(--color-link)}:focus-visible{outline-color:var(--color-focus)}}@layer layout{.stack{gap:var(--stack-gap);flex-direction:column;display:flex}.cluster{align-items:center;gap:var(--cluster-gap);flex-wrap:wrap;display:flex}.grid{gap:var(--grid-gap);grid-template-columns:repeat(auto-fit, minmax(min(100%, var(--grid-min)), 1fr));display:grid}.center{box-sizing:content-box;max-inline-size:var(--center-max);padding-inline:var(--center-gutter);margin-inline:auto}}@layer components,page;@media (prefers-reduced-motion:no-preference){@view-transition{navigation:auto}}';

/** The same with `SWITCH`: `tokens.css` then holds the `[data-mode]` rules. */
export const BUILT_SWITCH =
  '@layer astro;@layer reset{*,:before,:after{box-sizing:border-box}*{margin:0}img,picture,svg,video,canvas{block-size:auto;max-inline-size:100%;display:block}input,button,textarea,select{font:inherit;color:inherit}[hidden]:not([hidden=until-found]),:root:not([data-mode]) [data-mode-switch]{display:none!important}.visually-hidden:not(:focus-within){clip-path:inset(50%)!important;white-space:nowrap!important;block-size:1px!important;inline-size:1px!important;position:absolute!important;overflow:hidden!important}:focus-visible:not([tabindex="-1"]){outline-style:solid!important}@media (prefers-reduced-motion:reduce){*,:before,:after{scroll-behavior:auto!important;transition:none!important;animation:none!important}}}@layer tokens{:root{color-scheme:light dark;--color-page:light-dark(#fff,#111);--color-text:light-dark(#222,#eee);--color-link:light-dark(#0b4f9c,#9cc8ff);--color-focus:light-dark(#9c4f0b,#ffc89c);--color-error:light-dark(#a1201b,#ffa095);--color-accent:light-dark(#7a3d00,#ffd08a);--color-a:light-dark(#f7dfb9,#3b2b17);--color-b:light-dark(#f1e8d9,#252019);--color-shadow:light-dark(#0003,#0009);--font-body:system-ui, sans-serif;--text-m:1rem;--space-1:.25rem;--space-2:.5rem;--space-4:1rem;--space-fluid:5%;--size-content:40rem;--size-half:50%;--size-wide:16 / 9;--size-screen:100vw;--line-1:.0625rem;--shadow-card:0 .5rem 1.5rem var(--color-shadow);--shadow-inset:inset 0 0 .25rem var(--color-shadow);--opacity-half:.5;--gradient-hero:linear-gradient(135deg, var(--color-a) 0%, var(--color-b) 60%);--stack-gap:var(--space-2)}:root[data-mode=light]{color-scheme:light}:root[data-mode=dark]{color-scheme:dark}}@layer elements{body{color:var(--color-text);background-color:var(--color-page)}a{color:var(--color-link)}:focus-visible{outline-color:var(--color-focus)}}@layer layout{.stack{gap:var(--stack-gap);flex-direction:column;display:flex}.cluster{align-items:center;gap:var(--cluster-gap);flex-wrap:wrap;display:flex}.grid{gap:var(--grid-gap);grid-template-columns:repeat(auto-fit, minmax(min(100%, var(--grid-min)), 1fr));display:grid}.center{box-sizing:content-box;max-inline-size:var(--center-max);padding-inline:var(--center-gutter);margin-inline:auto}}@layer components,page;@media (prefers-reduced-motion:no-preference){@view-transition{navigation:auto}}';

/**
 * A built page: the CSP meta first in the head (6.1, `astro:build:done`), then each text of `styles` in a `<style>`,
 * then `head`; `body` in the body. Astro joins the CSS chunks of a page with a line feed in one `<style>`, so a page
 * with component CSS has one style text: `BUILT_AUTO`, a line feed, then the minified chunk (`@layer components{…}`).
 */
export function pageHtml(styles: readonly string[], body = '', head = ''): string {
  const css = styles.map((text) => `<style>${text}</style>`).join('');
  return `<!DOCTYPE html><html lang="de"><head><meta charset="utf-8"><meta http-equiv="content-security-policy" content="default-src 'self'">${css}${head}</head><body>${body}</body></html>`;
}

/**
 * The built input of a source input and a client directory of strings (`memoryContext`): `dist` maps a path such as
 * `index.html` or `_astro/island.js` to its text. The context takes the design and the settings of the source input.
 */
export function built(source: SourceCss, dist: Readonly<Record<string, string>>): BuiltCssInput {
  const ctx = memoryContext({
    root: '/site',
    dist: '/site/dist',
    options: source.options ?? AUTO,
    kitVersion: '0.0.0',
    facts: factsOf(),
    redirects: [],
    design: source.design ?? DESIGN,
    report: new Report(),
    files: dist,
  });
  return builtCss(ctx, source);
}

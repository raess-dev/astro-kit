/**
 * The smallest project that passes preflight with no finding, as temp files for the tests of preflight and of the
 * command `check` (14.1, Temp files). No test installs packages into it or runs a tool on it.
 */
import type { Design } from '../../src/context.ts';
import { parseDesign } from '../../src/design/parse.ts';
import { renderTokens } from '../../src/design/tokens.ts';
import { renderWrangler } from '../../src/hosts/cloudflare.ts';
import { type Options, parseOptions } from '../../src/options.ts';
import { Report } from '../../src/registry.ts';
import { SHIMS } from '../../src/shims.ts';

// The project of a case

/** The files of a project: a path from the root, and the text or the bytes of the file. */
export type Files = Readonly<Record<string, string | Uint8Array>>;

export const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

/** The smallest settings: one locale and no feature. Every other field has a default. */
export const SETTINGS = {
  site: 'https://example.ch',
  codeOwner: '@example-owner',
  locales: [{ code: 'de', tag: 'de-CH', name: 'Deutsch' }],
  defaultLocale: 'de',
  legal: { legalNote: { de: '/impressum/' }, privacy: { de: '/datenschutz/' } },
  securityContact: 'mailto:security@example.ch',
};

/** The smallest facts. */
export const SITE = { name: 'Example', legalName: 'Example AG', email: 'info@example.ch' };

export const SCHEDULE = { openingHours: [], closures: [] };

/** The parsed settings of an `astro-kit.json` value. Throws when the value is not valid. */
export function optionsOf(settings: unknown): Options {
  const report = new Report();
  const options = parseOptions(settings, report);
  if (options === undefined) throw new Error(report.format());
  return options;
}

/** The parsed design of a `docs/design.md` text. Throws when the text does not pass `design-format`. */
export function designOf(text: string): Design {
  const report = new Report();
  const design = parseDesign(text, report);
  if (design === undefined) throw new Error(report.format());
  return design;
}

export const WRANGLER = 'wrangler.jsonc';
export const DESIGN = 'docs/design.md';
export const TOKENS = 'src/styles/tokens.css';

/**
 * The smallest design document that passes `design-format` and `design-pairs`: the theme `light`, two colors, one
 * `--font-`, one `--text-` and one `--space-` row, no breakpoint, and the four mandatory pairs of 7.4. The one mode
 * option `auto` needs no other theme.
 */
export const DESIGN_MD = [
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
  '| `--color-page` | `#ffffff` | The page. |',
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
  '| `--color-text` | `--color-page` | text | body |',
  '| `--color-text` | `--color-page` | ui | link |',
  '| `--color-text` | `--color-page` | non-text | focus |',
  '| `--color-text` | `--color-page` | ui | error |',
  '',
].join('\n');

export const ELEMENTS = 'src/styles/elements.css';

/** The file of the `@font-face` rules. A site with system fonts keeps it empty, but it exists (7.2). */
export const FONTS = 'src/styles/fonts.css';

/** The smallest `elements.css`: it uses the body, link and focus pairs, as 7.4 says (`design-pairs`). */
export const ELEMENTS_CSS = [
  '@layer elements {',
  '  body {',
  '    color: var(--color-text);',
  '    background-color: var(--color-page);',
  '  }',
  '  a {',
  '    color: var(--color-text);',
  '  }',
  '  :focus-visible {',
  '    outline-color: var(--color-text);',
  '  }',
  '}',
  '',
].join('\n');

/** The text of `tokens.css` that the kit renders for the smallest design and the smallest settings. */
export const TOKENS_CSS = renderTokens(designOf(DESIGN_MD), optionsOf(SETTINGS));

/** The text of `wrangler.jsonc` that the kit renders for the smallest settings: a static site. */
export const WRANGLER_JSONC = renderWrangler(optionsOf(SETTINGS));

/**
 * The smallest project that passes preflight with no finding: the settings, the two facts files that must exist,
 * the three source shims, `wrangler.jsonc`, the design document, the `tokens.css` that the kit renders from it,
 * `elements.css` and an empty `fonts.css`. A later milestone adds the files that its rules need.
 */
export const SMALLEST: Files = {
  'astro-kit.json': json(SETTINGS),
  'site.json': json(SITE),
  'schedule.json': json(SCHEDULE),
  ...SHIMS,
  [WRANGLER]: WRANGLER_JSONC,
  [DESIGN]: DESIGN_MD,
  [TOKENS]: TOKENS_CSS,
  [ELEMENTS]: ELEMENTS_CSS,
  [FONTS]: '',
};

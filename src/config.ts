/**
 * The Astro config that the kit locks (specification, section 6.1): the values of the table, the global CSS, the
 * watch files, the kit's script hashes, and the checks on the config. `checkConfigShape` is step 3 of
 * `astro:config:setup`, and `checkResolvedConfig` is `astro:config:done`. Both report every finding and never
 * throw. The hooks of `src/index.ts` call them.
 */
import { join } from 'node:path';
import { DESIGN_FILE } from './context.ts';
import { type CspConfig, cspConfig, type Sha256, SPECULATION_HASH } from './csp.ts';
import { GLOSSARY_FILE, SCHEDULE_FILE, SITE_FILE } from './facts.ts';
import { hasModeScript, modeHash } from './modes.ts';
import { fieldPlace, OPTIONS_FILE, type Options } from './options.ts';
import { KIT_PACKAGE } from './project.ts';
import { REDIRECTS_FILE } from './redirects.ts';
import type { Report } from './registry.ts';
import { CONFIG_FILE } from './shims.ts';

// The root

/**
 * Why the kit cannot build a project in this folder, or `undefined`. With `%` or `#` in the path of the root,
 * Astro leaves out all CSS that comes through `injectScript('page-ssr', …)`, and the build still passes
 * (13.1, item 60). So the pages would have no kit CSS, no tokens and no element styles.
 */
export function rootProblem(root: string): string | undefined {
  if (!/[%#]/.test(root)) return undefined;
  return `astro-kit: the project folder ${root} has % or # in its path. Astro then leaves the global CSS out of every page. Move the project to a folder without these characters.`;
}

// Watch files and global CSS

/** The files of step 5, from the root, in its order. A change to one of them restarts `astro dev`. */
export const WATCH_FILES: readonly string[] = [
  OPTIONS_FILE,
  SITE_FILE,
  SCHEDULE_FILE,
  REDIRECTS_FILE,
  GLOSSARY_FILE,
  DESIGN_FILE,
];

/** File 1 of step 9: the package specifier of the kit's CSS. The `./css/base.css` export of 3.4 resolves it. */
export const BASE_CSS = `${KIT_PACKAGE}/css/base.css` as const;

/** Files 2 to 4 of step 9, from the root, in the order of the layers (7.1). */
export const GLOBAL_CSS: readonly string[] = [
  'src/styles/fonts.css',
  'src/styles/tokens.css',
  'src/styles/elements.css',
];

/**
 * The code of `injectScript('page-ssr', …)`: one line `import <spec>;` for each global CSS file, in the order of
 * step 9. The lines are joined with `\n`, with no final newline. Files 2 to 4 are absolute paths under the root.
 */
export function globalCssCode(root: string): string {
  return [BASE_CSS, ...GLOBAL_CSS.map((file) => join(root, file))]
    .map((spec) => `import ${JSON.stringify(spec)};`)
    .join('\n');
}

// Locked values

/** `vite.build.cssTarget`: the browsers that the built CSS must run in. */
export const CSS_TARGET: readonly string[] = ['chrome123', 'edge123', 'firefox120', 'safari17.5'];

/** `image.breakpoints`: the widths of a responsive image. */
export const IMAGE_BREAKPOINTS: readonly number[] = [640, 960, 1280, 1920];

/** The one `experimental` value that a config may hold: the default of Astro 7.4 (13.1 item 9). */
export const EXPERIMENTAL_DEFAULTS: Readonly<Record<string, unknown>> = { collectionStorage: 'single-file' };

/** The name of the one adapter that the kit adds, and only with `features.forms`. */
export const FORMS_ADAPTER = '@astrojs/cloudflare';

/**
 * The options of the adapter (6.1, step 7). `imageService: 'compile'` keeps Astro's image service for the build,
 * so the images of a forms site are the ones of a static site. `prerenderEnvironment: 'node'` renders the static
 * pages in Node, as a static build does.
 */
export const FORMS_ADAPTER_OPTIONS = { imageService: 'compile', prerenderEnvironment: 'node' } as const;

/**
 * The kit's script hashes, in the order of 6.2: the Solid hash with islands, `SPECULATION_HASH` with
 * `speculationRules`, the mode hash with two or more mode options. The caller passes the Solid hash only with
 * `features.islands`. The result goes to `cspConfig` and `lockedConfig` as it is.
 */
export function kitScriptHashes(options: Pick<Options, 'prefetch' | 'modes'>, solidHash?: Sha256): Sha256[] {
  return [
    ...(solidHash === undefined ? [] : [solidHash]),
    ...(options.prefetch.speculationRules ? [SPECULATION_HASH] : []),
    ...(hasModeScript(options) ? [modeHash(options)] : []),
  ];
}

/** The value of `i18n` in the locked config. */
export interface I18nConfig {
  defaultLocale: string;
  locales: string[];
  routing: { prefixDefaultLocale: false; redirectToDefaultLocale: false; fallbackType: 'redirect' };
}

/** The locked `i18n` value of the table: the default locale, the codes in order, and the routing. */
export function i18nConfig(options: Pick<Options, 'defaultLocale' | 'locales'>): I18nConfig {
  return {
    defaultLocale: options.defaultLocale,
    locales: options.locales.map((locale) => locale.code),
    routing: { prefixDefaultLocale: false, redirectToDefaultLocale: false, fallbackType: 'redirect' },
  };
}

/**
 * The value that the kit passes to `updateConfig`: every row of the 6.1 table except `adapter`, `integrations` and
 * `vite.plugins`. The hook adds these three, because they hold objects of other packages.
 */
export interface LockedConfig {
  site: string;
  output: 'static';
  trailingSlash: 'always';
  prerenderConflictBehavior: 'error';
  compressHTML: true;
  build: { format: 'directory'; inlineStylesheets: 'always' };
  i18n: I18nConfig;
  image: {
    layout: 'constrained';
    responsiveStyles: true;
    breakpoints: number[];
    domains: string[];
    remotePatterns: never[];
  };
  security: { checkOrigin: true; csp: CspConfig };
  prefetch: false | { prefetchAll: false };
  markdown: { syntaxHighlight: false };
  session: false;
  vite: { build: { cssTarget: string[] }; ssr: { noExternal: string[] } };
}

/**
 * The locked config for the settings, with its keys in the order of the table. `scriptHashes` is the complete
 * list of `kitScriptHashes`. Every call returns new arrays, so a caller may change its copy.
 */
export function lockedConfig(options: Options, scriptHashes: readonly Sha256[]): LockedConfig {
  return {
    site: options.site,
    output: 'static',
    trailingSlash: 'always',
    prerenderConflictBehavior: 'error',
    compressHTML: true,
    build: { format: 'directory', inlineStylesheets: 'always' },
    i18n: i18nConfig(options),
    image: {
      layout: 'constrained',
      responsiveStyles: true,
      breakpoints: [...IMAGE_BREAKPOINTS],
      domains: [],
      remotePatterns: [],
    },
    security: { checkOrigin: true, csp: cspConfig(options, scriptHashes) },
    prefetch: options.prefetch.astroPrefetch ? { prefetchAll: false } : false,
    markdown: { syntaxHighlight: false },
    // Without it, the Cloudflare adapter turns Astro sessions on and adds a KV binding (6.1).
    session: false,
    vite: { build: { cssTarget: [...CSS_TARGET] }, ssr: { noExternal: [KIT_PACKAGE] } },
  };
}

// Values of a config

/** A config value as plain data: an object that only holds keys. An array, a URL and a function are not. */
type Data = Readonly<Record<string, unknown>>;

function isData(value: unknown): value is Data {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** The value of one key of a config. A value that is no object has no key. */
function field(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null ? (value as Data)[key] : undefined;
}

/** The keys of an object that hold a value. A key with the value `undefined` counts as absent. */
const setKeys = (value: Data): string[] => Object.keys(value).filter((key) => value[key] !== undefined);

/**
 * Deep equality of two config values. Arrays are equal when they hold equal items in the same order. Objects of
 * plain data are equal when their set keys hold equal values. Any other two values are equal only when they are
 * the same value.
 */
function sameValue(actual: unknown, expected: unknown): boolean {
  if (Object.is(actual, expected)) return true;
  if (Array.isArray(actual) || Array.isArray(expected)) {
    if (!Array.isArray(actual) || !Array.isArray(expected) || actual.length !== expected.length) return false;
    return actual.every((item, index) => sameValue(item, expected[index]));
  }
  if (!isData(actual) || !isData(expected)) return false;
  const keys = new Set([...setKeys(actual), ...setKeys(expected)]);
  return [...keys].every((key) => sameValue(actual[key], expected[key]));
}

/**
 * A config value as the text of a finding: a string as it is, `undefined` as `undefined`, and every other value
 * as JSON. A value that JSON cannot hold, such as a function, is shown with `String`.
 */
export function show(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === undefined) return 'undefined';
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

/** The name of an adapter or an integration for a finding. A value without a name is shown as it is. */
function nameOf(value: unknown): string {
  const name = field(value, 'name');
  return typeof name === 'string' ? name : show(value);
}

// The checks

/** The key of the table whose value must be an object in the resolved config (6.1). */
const CSP_KEY = 'security.csp';

/**
 * The keys of the table whose objects only the kit fills. Astro adds no key to them: `updateConfig` merges a value
 * and does not run the config schema again. So a key that the kit did not set is a changed value too, such as
 * `scriptDirective.strictDynamic` or `prefetch.defaultStrategy`. Every other object of the table also holds
 * defaults of Astro and keys of other integrations.
 */
const KIT_ONLY_KEYS: readonly string[] = [CSP_KEY, 'prefetch'];

const isKitOnly = (key: string): boolean => KIT_ONLY_KEYS.some((only) => key === only || key.startsWith(`${only}.`));

/**
 * The key of the table whose lists may come back with repeated items. The Cloudflare adapter passes the whole
 * resolved `image` value back to `updateConfig`, and Astro joins two lists (13.1, item 59). So on a forms site
 * `image.breakpoints` holds each width twice. A repeat changes no page: Astro removes repeated widths from a
 * `srcset`. A new item is still a changed value.
 */
const REPEATED_LISTS_KEY = 'image';

/** A list without its repeats: the first of each group of equal items stays, in its place. */
function withoutRepeats(list: readonly unknown[]): unknown[] {
  return list.filter((item, index) => list.findIndex((other) => sameValue(other, item)) === index);
}

/** The resolved value as the comparison reads it: a list of `image` without its repeats, any other value as it is. */
function comparedValue(actual: unknown, key: string): unknown {
  return Array.isArray(actual) && key.startsWith(`${REPEATED_LISTS_KEY}.`) ? withoutRepeats(actual) : actual;
}

/**
 * Step 3 of `astro:config:setup`, on the config of the project:
 *
 * - an adapter is `config-adapter`;
 * - an `i18n` value is `config-i18n`;
 * - each truthy `experimental` key whose value is not its default is `config-experimental`.
 *
 * The place of a finding is the field in `astro.config.mjs`.
 */
export function checkConfigShape(config: object, report: Report): void {
  const adapter = field(config, 'adapter');
  if (adapter !== undefined && adapter !== null) {
    report.add('config-adapter', fieldPlace(CONFIG_FILE, ['adapter']), nameOf(adapter));
  }
  const i18n = field(config, 'i18n');
  if (i18n !== undefined && i18n !== null) report.add('config-i18n', fieldPlace(CONFIG_FILE, ['i18n']));
  const experimental = field(config, 'experimental');
  if (!isData(experimental)) return;
  for (const [key, value] of Object.entries(experimental)) {
    if (!value || sameValue(value, EXPERIMENTAL_DEFAULTS[key])) continue;
    report.add('config-experimental', fieldPlace(CONFIG_FILE, ['experimental', key]), show(value));
  }
}

/**
 * Compares one locked value with the resolved one. An object of the table is walked key by key. Every other value
 * is a leaf: a string, a number, a boolean or an array. An array is compared whole, because `updateConfig`
 * concatenates arrays; a list of `image` is compared without its repeats (`REPEATED_LISTS_KEY`). A key that only
 * the resolved config has is ignored, except in an object that only the kit fills (`KIT_ONLY_KEYS`).
 */
function compareLocked(expected: unknown, actual: unknown, path: readonly string[], report: Report): void {
  const key = path.join('.');
  if (!isData(expected)) {
    if (!sameValue(comparedValue(actual, key), expected)) {
      report.add('config-locked', key, `${show(actual)} instead of ${show(expected)}`);
    }
    return;
  }
  if (key === CSP_KEY && !isData(actual)) {
    report.add('config-locked', key, `${show(actual)} instead of an object`);
    return;
  }
  for (const [name, value] of Object.entries(expected)) {
    compareLocked(value, field(actual, name), [...path, name], report);
  }
  if (!isKitOnly(key) || !isData(actual)) return;
  for (const name of setKeys(actual)) {
    if (Object.hasOwn(expected, name)) continue;
    report.add('config-locked', [...path, name].join('.'), `${show(actual[name])} instead of ${show(undefined)}`);
  }
}

/**
 * `astro:config:done`, on the resolved config:
 *
 * - each value of the table that differs is `config-locked`, at its dotted key, with the detail
 *   `<actual> instead of <expected>`;
 * - a list of `image` that only repeats the kit's items is no difference: the Cloudflare adapter doubles it;
 * - `security.csp` that is no object is one `config-locked` finding;
 * - a key in `security.csp` or in the `prefetch` object that the kit did not set is `config-locked` too;
 * - an `i18n` value that does not equal the kit's is `config-i18n`;
 * - an adapter while forms is off, or another adapter than the kit's while forms is on, is `config-adapter`.
 *
 * `options` and `scriptHashes` are the values that `astro:config:setup` passed to `lockedConfig`.
 */
export function checkResolvedConfig(
  config: object,
  options: Options,
  scriptHashes: readonly Sha256[],
  report: Report,
): void {
  const { i18n, ...locked } = lockedConfig(options, scriptHashes);
  compareLocked(locked, config, [], report);

  const actualI18n = field(config, 'i18n');
  if (!sameValue(actualI18n, i18n)) report.add('config-i18n', 'i18n', `${show(actualI18n)} instead of ${show(i18n)}`);

  const adapter = field(config, 'adapter');
  const hasAdapter = adapter !== undefined && adapter !== null;
  if (options.features.forms) {
    const name = hasAdapter ? nameOf(adapter) : show(undefined);
    if (!hasAdapter || field(adapter, 'name') !== FORMS_ADAPTER) report.add('config-adapter', 'adapter', name);
  } else if (hasAdapter) {
    report.add('config-adapter', 'adapter', nameOf(adapter));
  }
}

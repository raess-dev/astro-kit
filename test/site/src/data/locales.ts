/**
 * The locales of the site. `astro-kit.json` is the one source: this module reads the codes, the tags and the
 * names from it, and it holds the codes once more only as a type.
 */
import settings from '../../astro-kit.json';

/** The locale codes as a type. They equal `locales[].code` of `astro-kit.json`, in the same order. */
const CODES = ['de', 'fr', 'en'] as const;

export type Locale = (typeof CODES)[number];

export interface LocaleInfo {
  /** The URL segment, for example `fr`. */
  code: Locale;
  /** The language tag for `lang` and `hreflang`, for example `fr-CH`. */
  tag: string;
  /** The name of the language in that language, for example `Français`. */
  name: string;
}

if (settings.locales.map((locale) => locale.code).join() !== CODES.join()) {
  throw new Error('src/data/locales.ts: CODES must equal locales[].code of astro-kit.json, in the same order');
}

/** Every locale, in the order of `astro-kit.json`. This is the order of the language links. */
export const LOCALES: readonly LocaleInfo[] = CODES.map((code, index) => {
  const entry = settings.locales[index];
  if (entry === undefined) throw new Error(`src/data/locales.ts: astro-kit.json has no locale ${code}`);
  return { code, tag: entry.tag, name: entry.name };
});

const isLocale = (code: string): code is Locale => CODES.some((known) => known === code);

if (!isLocale(settings.defaultLocale)) {
  throw new Error('src/data/locales.ts: defaultLocale of astro-kit.json is not a locale of the site');
}

/** The locale that owns the root URLs. */
export const DEFAULT_LOCALE: Locale = settings.defaultLocale;

/** The production address, without a trailing slash. */
export const SITE: string = settings.site;

/** The data of one locale. */
export function localeInfo(code: Locale): LocaleInfo {
  const info = LOCALES.find((locale) => locale.code === code);
  if (info === undefined) throw new Error(`src/data/locales.ts: unknown locale ${code}`);
  return info;
}

/** The language tag of a locale, for `lang`, `hreflang` and `Intl`. */
export const tagOf = (code: Locale): string => localeInfo(code).tag;

/** The mode options of the mode switch, in the order of the kit. */
const MODE_ORDER = ['auto', 'light', 'dark', 'contrast'] as const;

export type Mode = (typeof MODE_ORDER)[number];

/** The mode options that `astro-kit.json` turns on. The mode switch shows one radio for each of them. */
export const MODES: readonly Mode[] = MODE_ORDER.filter((mode) => settings.modes[mode]);

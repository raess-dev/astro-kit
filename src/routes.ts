/**
 * Paths of a site: the reserved segments, the slug pattern, the locale of a path, the locale homes and the 404 path
 * (specification, sections 6.1 and 8, `routes-slug` and `routes-404`). Pure functions on strings.
 */

/** The settings that decide the locale of a path. `Options` of src/options.ts fits. */
export interface LocaleSettings {
  defaultLocale: string;
  locales: readonly { code: string }[];
}

/**
 * Segments that a page path may not start with, in the default locale or after `/<code>/` (`routes-slug`).
 * A `404` segment is not here: `routes-404` reports it, so it reports once.
 */
export const RESERVED_SEGMENTS: readonly string[] = [
  '_astro',
  '_actions',
  '_server-islands',
  '_image',
  '_kit',
  'api',
  '500',
  '.well-known',
];

/** One segment of a page path (`routes-slug`). */
export const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** A page path: `/`, or slug segments that each end with `/`. Legal paths (5.2) and the form `return` (9.1) use it. */
export const PAGE_PATH = /^\/([a-z0-9]+(-[a-z0-9]+)*\/)*$/;

/** The one 404 page. It belongs to the default locale and is the only page path without a final `/`. */
export const NOT_FOUND_PATH = '/404.html';

/** The segments of a path: `/fr/kontakt/` gives `['fr', 'kontakt']`, and `/` gives `[]`. */
export function pathSegments(path: string): string[] {
  return path.split('/').filter((segment) => segment !== '');
}

/** Says whether the segment is a reserved one. */
export function isReservedSegment(segment: string): boolean {
  return RESERVED_SEGMENTS.includes(segment);
}

/**
 * The locale code of a path. A first segment equal to a non-default code means that locale. Anything else is the
 * default locale, `/404.html` included.
 */
export function localeOfPath(path: string, options: LocaleSettings): string {
  const first = pathSegments(path)[0];
  if (first === undefined || first === options.defaultLocale) return options.defaultLocale;
  return options.locales.some((locale) => locale.code === first) ? first : options.defaultLocale;
}

/** The home of one locale: `/` for the default locale, `/<code>/` for another. */
export function localeHome(code: string, options: Pick<LocaleSettings, 'defaultLocale'>): string {
  return code === options.defaultLocale ? '/' : `/${code}/`;
}

/** Every locale home, in the order of `locales`. */
export function localeHomes(options: LocaleSettings): string[] {
  return options.locales.map((locale) => localeHome(locale.code, options));
}

/** Says whether the path is the home of a locale. The comparison is exact: `/fr` is not `/fr/`. */
export function isLocaleHome(path: string, options: LocaleSettings): boolean {
  return localeHomes(options).includes(path);
}

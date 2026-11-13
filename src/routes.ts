/**
 * Paths and routes of a site: the reserved segments, the slug pattern, the locale of a path, the locale homes and
 * the 404 path (specification, sections 6.1 and 8, `routes-slug` and `routes-404`), and the checks of
 * `astro:routes:resolved` (`routes-on-demand` and the endpoint clause of `routes-slug`). Pure functions: they read
 * no file and keep no state.
 */
import type { Report } from './registry.ts';

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

// The resolved routes
//
// The checks of `astro:routes:resolved` (6.1). Astro calls the hook more than once in a build, so the checks keep
// no state: the same list gives the same findings on every call.

/** The pattern of the one on-demand route of a forms site (9.1). */
export const FORM_ROUTE = '/api/forms/[form]';

/** The feature shim: the entrypoint of that route, from the root. */
export const FORM_SHIM = 'src/pages/api/forms/[form].ts';

/** What the checks read of a route that Astro resolved. `IntegrationResolvedRoute` of Astro fits. */
export interface ResolvedRoute {
  pattern: string;
  entrypoint: string;
  isPrerendered: boolean;
  origin: string;
  type: string;
}

/** The settings that the route checks read. `Options` of src/options.ts fits. */
export interface RouteSettings {
  features: { forms: boolean };
  locales: readonly { code: string }[];
}

/** A literal file extension at the end of a route pattern: `.json` in `/feeds/[lang].json`. */
const FILE_EXTENSION = /\.([a-z0-9]+)$/;

/** The extensions of a page. An endpoint with one of them could write the file of a page. */
const PAGE_EXTENSIONS: readonly string[] = ['html', 'htm'];

/** The files in the root of the client directory that the kit writes, and that have a fixed name (6.3). */
const KIT_ROOT_FILES: readonly string[] = ['/robots.txt', '/_headers', '/_redirects'];

/** `/sitemap*.xml`: the sitemap of the kit, and every name that a crawler reads as one. */
const SITEMAP_FILE = /^\/sitemap[^/]*\.xml$/;

const withSlashes = (path: string): string => path.replaceAll('\\', '/');

/**
 * The entrypoint of a route from the project root, with `/`. Astro gives a path from the root for a file under
 * `src/pages/`, and it can give an absolute path. A path outside the root stays as it is.
 */
export function entrypointOf(route: Pick<ResolvedRoute, 'entrypoint'>, root: string): string {
  const file = withSlashes(route.entrypoint);
  const base = `${withSlashes(root).replace(/\/+$/, '')}/`;
  return file.startsWith(base) ? file.slice(base.length) : file;
}

/** Says whether the route is the form endpoint of a forms site: the one route that may run on demand. */
export function isFormShim(route: ResolvedRoute, root: string, options: RouteSettings): boolean {
  return options.features.forms && route.pattern === FORM_ROUTE && entrypointOf(route, root) === FORM_SHIM;
}

/** Why a segment may not start the path of a static file route, or `undefined` when it may. */
function segmentProblem(segment: string | undefined, name: string): string | undefined {
  if (segment === undefined) return undefined;
  if (segment.includes('[')) return `${name} holds a parameter`;
  if (isReservedSegment(segment)) return `${name} is the reserved segment ${segment}`;
  return undefined;
}

/**
 * The endpoint clause of `routes-slug`: every reason why a route pattern is not a static file route. An empty list
 * means that the endpoint can write neither the file of a page nor a file that the kit writes.
 */
function endpointProblems(pattern: string, options: RouteSettings): string[] {
  const problems: (string | undefined)[] = [];
  const extension = FILE_EXTENSION.exec(pattern)?.[1];
  if (extension === undefined) problems.push('the pattern does not end with a literal file extension');
  else if (PAGE_EXTENSIONS.includes(extension)) problems.push(`the extension .${extension} is that of a page`);

  const [first, second] = pathSegments(pattern);
  problems.push(segmentProblem(first, 'the first segment'));
  if (options.locales.some((locale) => locale.code === first)) {
    problems.push(segmentProblem(second, 'the segment after the locale code'));
  }

  if (KIT_ROOT_FILES.includes(pattern) || SITEMAP_FILE.test(pattern)) problems.push('the kit writes this file');
  return problems.filter((problem) => problem !== undefined);
}

/**
 * `routes-on-demand` and the endpoint clause of `routes-slug`, on the routes of one call of
 * `astro:routes:resolved`. It looks only at routes of the project: Astro adds routes of its own in every build
 * (13.1, item 44). It reports every finding, at the entrypoint of the route. A route with more than one reason
 * gives one `routes-slug` finding that names them all.
 */
export function checkResolvedRoutes(
  routes: readonly ResolvedRoute[],
  options: RouteSettings,
  root: string,
  report: Report,
): void {
  for (const route of routes) {
    if (route.origin !== 'project' || isFormShim(route, root, options)) continue;
    const where = entrypointOf(route, root);
    if (route.type !== 'redirect' && !route.isPrerendered) {
      report.add('routes-on-demand', where, `${route.pattern} is not prerendered`);
    }
    if (route.type !== 'endpoint') continue;
    const problems = endpointProblems(route.pattern, options);
    if (problems.length > 0) report.add('routes-slug', where, `${route.pattern}: ${problems.join('; ')}`);
  }
}

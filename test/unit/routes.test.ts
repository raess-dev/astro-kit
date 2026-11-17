import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Report } from '../../src/registry.ts';
import {
  checkResolvedRoutes,
  entrypointOf,
  FORM_ROUTE,
  FORM_SHIM,
  isFormShim,
  isLocaleHome,
  isReservedSegment,
  type LocaleSettings,
  localeHome,
  localeHomes,
  localeOfPath,
  NOT_FOUND_PATH,
  PAGE_PATH,
  pathSegments,
  RESERVED_SEGMENTS,
  type ResolvedRoute,
  type RouteSettings,
  SLUG,
} from '../../src/routes.ts';
import { SPEC } from './spec.ts';

/** German is the default locale; French and Italian have a prefix. */
const options: LocaleSettings = {
  defaultLocale: 'de',
  locales: [{ code: 'de' }, { code: 'fr' }, { code: 'it' }],
};

/** The same site with French as the default locale, so the default is not the first entry. */
const frenchFirst: LocaleSettings = { defaultLocale: 'fr', locales: [{ code: 'de' }, { code: 'fr' }] };

test('the reserved segments are the eight of routes-slug, without 404', () => {
  assert.deepEqual(
    [...RESERVED_SEGMENTS],
    ['_astro', '_actions', '_server-islands', '_image', '_kit', 'api', '500', '.well-known'],
  );
  const cases: [string, boolean][] = [
    ['api', true],
    ['_astro', true],
    ['.well-known', true],
    ['500', true],
    ['404', false],
    ['apis', false],
    ['API', false],
    ['', false],
  ];
  for (const [segment, expected] of cases) assert.equal(isReservedSegment(segment), expected, segment);
});

test('the 404 path is /404.html', () => {
  assert.equal(NOT_FOUND_PATH, '/404.html');
});

test('a slug is lower-case letters and digits with single hyphens', () => {
  assert.equal(SLUG.source, '^[a-z0-9]+(-[a-z0-9]+)*$');
  const cases: [string, boolean][] = [
    ['zimmer', true],
    ['zimmer-und-suiten', true],
    ['a', true],
    ['2026', true],
    ['404', true],
    ['', false],
    ['Zimmer', false],
    ['zimmer_suiten', false],
    ['zimmer--suiten', false],
    ['-zimmer', false],
    ['zimmer-', false],
    ['zimmer.html', false],
    ['zürich', false],
    ['a b', false],
    ['zimmer\n', false],
  ];
  for (const [segment, expected] of cases) assert.equal(SLUG.test(segment), expected, JSON.stringify(segment));
});

test('a page path is the root or slug segments that each end with a slash', () => {
  assert.equal(PAGE_PATH.source, '^\\/([a-z0-9]+(-[a-z0-9]+)*\\/)*$');
  const cases: [string, boolean][] = [
    ['/', true],
    ['/impressum/', true],
    ['/fr/mentions-legales/', true],
    ['/a/b/c/', true],
    ['', false],
    ['/impressum', false],
    ['impressum/', false],
    ['//', false],
    ['/a//b/', false],
    ['/Impressum/', false],
    ['/404.html', false],
    ['/a/?x=1', false],
    ['/a/#sent', false],
    ['https://example.ch/a/', false],
    ['/a\\b/', false],
  ];
  for (const [path, expected] of cases) assert.equal(PAGE_PATH.test(path), expected, JSON.stringify(path));
});

test('the segments of a path leave out the empty parts', () => {
  const cases: [string, string[]][] = [
    ['/', []],
    ['', []],
    ['/fr/', ['fr']],
    ['/fr/kontakt/', ['fr', 'kontakt']],
    ['/404.html', ['404.html']],
    ['/api/forms/contact/', ['api', 'forms', 'contact']],
  ];
  for (const [path, expected] of cases) assert.deepEqual(pathSegments(path), expected, path);
});

test('the locale of a path comes from its first segment', () => {
  const cases: [string, LocaleSettings, string][] = [
    ['/', options, 'de'],
    ['/zimmer/', options, 'de'],
    ['/fr/', options, 'fr'],
    ['/fr/chambres/', options, 'fr'],
    ['/it/camere/doppia/', options, 'it'],
    ['/fr', options, 'fr'],
    // A longer segment that starts with a code is not that code.
    ['/fragen/', options, 'de'],
    ['/fr.html', options, 'de'],
    // A code in a later segment does not count.
    ['/zimmer/fr/', options, 'de'],
    // The default code as a first segment is a default-locale path. `routes-slug` reports it.
    ['/de/zimmer/', options, 'de'],
    // A code that the site does not declare.
    ['/en/rooms/', options, 'de'],
    ['/FR/', options, 'de'],
    ['/404.html', options, 'de'],
    ['', options, 'de'],
    ['/', frenchFirst, 'fr'],
    ['/de/', frenchFirst, 'de'],
    ['/fr/', frenchFirst, 'fr'],
    ['/404.html', frenchFirst, 'fr'],
  ];
  for (const [path, settings, expected] of cases) assert.equal(localeOfPath(path, settings), expected, path);
});

test('the default locale has its home at the root, every other locale under its code', () => {
  const cases: [string, LocaleSettings, string][] = [
    ['de', options, '/'],
    ['fr', options, '/fr/'],
    ['it', options, '/it/'],
    ['de', frenchFirst, '/de/'],
    ['fr', frenchFirst, '/'],
  ];
  for (const [code, settings, expected] of cases) assert.equal(localeHome(code, settings), expected, code);
  assert.deepEqual(localeHomes(options), ['/', '/fr/', '/it/']);
  assert.deepEqual(localeHomes(frenchFirst), ['/de/', '/']);
  assert.deepEqual(localeHomes({ defaultLocale: 'de', locales: [{ code: 'de' }] }), ['/']);
});

test('a locale home is matched exactly', () => {
  const cases: [string, LocaleSettings, boolean][] = [
    ['/', options, true],
    ['/fr/', options, true],
    ['/it/', options, true],
    ['/de/', options, false],
    ['/fr', options, false],
    ['/fr/index.html', options, false],
    ['/fr/chambres/', options, false],
    ['/en/', options, false],
    ['/404.html', options, false],
    ['', options, false],
    ['/de/', frenchFirst, true],
    ['/', frenchFirst, true],
    ['/fr/', frenchFirst, false],
  ];
  for (const [path, settings, expected] of cases) assert.equal(isLocaleHome(path, settings), expected, path);
});

// The resolved routes

/** A static site with two locales, and the same site with forms. */
const STATIC: RouteSettings = { features: { forms: false }, locales: [{ code: 'de' }, { code: 'fr' }] };
const FORMS: RouteSettings = { ...STATIC, features: { forms: true } };

const ROOT = '/work/site';

/** A prerendered page route of the project. `more` changes one thing. */
const page = (pattern: string, entrypoint: string, more: Partial<ResolvedRoute> = {}): ResolvedRoute => ({
  pattern,
  entrypoint,
  isPrerendered: true,
  origin: 'project',
  type: 'page',
  ...more,
});

/** A prerendered endpoint route of the project. */
const endpoint = (pattern: string, more: Partial<ResolvedRoute> = {}): ResolvedRoute =>
  page(pattern, `src/pages${pattern}.ts`, { type: 'endpoint', ...more });

/** The findings of one list: the rule, the place and the detail of each, in the order of the run. */
function routeFindings(routes: readonly ResolvedRoute[], settings: RouteSettings): string[] {
  const report = new Report();
  checkResolvedRoutes(routes, settings, ROOT, report);
  return report.findings.map((finding) => `${finding.rule} ${finding.where}: ${finding.detail}`);
}

/** The sorted rule ids of one list, one for each finding. */
function routeIds(routes: readonly ResolvedRoute[], settings: RouteSettings): string[] {
  const report = new Report();
  checkResolvedRoutes(routes, settings, ROOT, report);
  return report.findings.map((finding) => finding.rule).sort();
}

test('the form route and the form shim are the pattern and the entrypoint of routes-on-demand', () => {
  const row = SPEC.split('\n').find((line) => line.startsWith('| `routes-on-demand` |')) ?? '';
  assert.ok(row.includes(`the route with the pattern \`${FORM_ROUTE}\``), 'the pattern of the rule row');
  assert.ok(row.includes(`the feature shim \`${FORM_SHIM}\``), 'the entrypoint of the rule row');
  assert.equal(FORM_ROUTE, '/api/forms/[form]');
  assert.equal(FORM_SHIM, 'src/pages/api/forms/[form].ts');
});

test('the entrypoint of a route is its path from the root, with forward slashes', () => {
  const cases: [entrypoint: string, root: string, expected: string][] = [
    ['src/pages/index.astro', ROOT, 'src/pages/index.astro'],
    ['/work/site/src/pages/index.astro', ROOT, 'src/pages/index.astro'],
    ['/work/site/src/pages/index.astro', '/work/site/', 'src/pages/index.astro'],
    ['/work/site-two/src/pages/index.astro', ROOT, '/work/site-two/src/pages/index.astro'],
    ['C:\\work\\site\\src\\pages\\a.astro', 'C:\\work\\site', 'src/pages/a.astro'],
    ['node_modules/astro/dist/x.js', ROOT, 'node_modules/astro/dist/x.js'],
  ];
  for (const [entrypoint, root, expected] of cases) {
    assert.equal(entrypointOf({ entrypoint }, root), expected, `${entrypoint} in ${root}`);
  }
});

test('the form shim is the form route of a forms site, with exactly its pattern and its entrypoint', () => {
  const shim = page(FORM_ROUTE, FORM_SHIM, { type: 'endpoint', isPrerendered: false });
  const cases: [name: string, route: ResolvedRoute, settings: RouteSettings, expected: boolean][] = [
    ['forms on', shim, FORMS, true],
    ['forms on, an absolute entrypoint', { ...shim, entrypoint: `${ROOT}/${FORM_SHIM}` }, FORMS, true],
    ['forms off', shim, STATIC, false],
    ['another pattern', { ...shim, pattern: '/api/forms/[id]' }, FORMS, false],
    ['another entrypoint', { ...shim, entrypoint: 'src/pages/api/forms/[form].js' }, FORMS, false],
  ];
  for (const [name, route, settings, expected] of cases) {
    assert.equal(isFormShim(route, ROOT, settings), expected, name);
  }
});

test('routes-on-demand and the endpoint clause pass prerendered pages, static file endpoints and foreign routes', () => {
  const routes: ResolvedRoute[] = [
    page('/', 'src/pages/index.astro'),
    page('/zimmer/[slug]', 'src/pages/zimmer/[slug].astro'),
    page('/404', 'src/pages/404.astro'),
    endpoint('/live.json'),
    endpoint('/feeds/[lang].json'),
    endpoint('/fr/feeds/[lang].json'),
    page('/alt', 'src/pages/alt.astro', { type: 'redirect', isPrerendered: false }),
    page('/_image', 'node_modules/astro/dist/assets/endpoint/generic.js', {
      type: 'endpoint',
      origin: 'internal',
      isPrerendered: false,
    }),
    page('/_x/[...path]', 'node_modules/other/route.js', {
      type: 'endpoint',
      origin: 'external',
      isPrerendered: false,
    }),
  ];
  assert.deepEqual(routeIds(routes, STATIC), []);
  assert.deepEqual(
    routeIds([...routes, page(FORM_ROUTE, FORM_SHIM, { type: 'endpoint', isPrerendered: false })], FORMS),
    [],
  );
});

test('one route that breaks routes-on-demand or the endpoint clause gives exactly its ids', () => {
  const cases: [route: ResolvedRoute, settings: RouteSettings, ids: string[], findings: string[]][] = [
    [
      page('/live', 'src/pages/live.astro', { isPrerendered: false }),
      STATIC,
      ['routes-on-demand'],
      ['routes-on-demand src/pages/live.astro: /live is not prerendered'],
    ],
    [
      endpoint('/live.json', { isPrerendered: false }),
      STATIC,
      ['routes-on-demand'],
      ['routes-on-demand src/pages/live.json.ts: /live.json is not prerendered'],
    ],
    [
      page(FORM_ROUTE, FORM_SHIM, { type: 'endpoint', isPrerendered: false }),
      STATIC,
      ['routes-on-demand', 'routes-slug'],
      [
        'routes-on-demand src/pages/api/forms/[form].ts: /api/forms/[form] is not prerendered',
        'routes-slug src/pages/api/forms/[form].ts: /api/forms/[form]: the pattern does not end with a literal file extension; the first segment is the reserved segment api',
      ],
    ],
    [
      endpoint('/[name].txt'),
      STATIC,
      ['routes-slug'],
      ['routes-slug src/pages/[name].txt.ts: /[name].txt: the first segment holds a parameter'],
    ],
    [
      endpoint('/[dir]/[file].json'),
      STATIC,
      ['routes-slug'],
      ['routes-slug src/pages/[dir]/[file].json.ts: /[dir]/[file].json: the first segment holds a parameter'],
    ],
    [
      endpoint('/x/index.html'),
      STATIC,
      ['routes-slug'],
      ['routes-slug src/pages/x/index.html.ts: /x/index.html: the extension .html is that of a page'],
    ],
    [
      endpoint('/fr/[file].json'),
      STATIC,
      ['routes-slug'],
      ['routes-slug src/pages/fr/[file].json.ts: /fr/[file].json: the segment after the locale code holds a parameter'],
    ],
    [
      endpoint('/sitemap-news.xml'),
      STATIC,
      ['routes-slug'],
      ['routes-slug src/pages/sitemap-news.xml.ts: /sitemap-news.xml: the kit writes this file'],
    ],
    [
      endpoint('/data'),
      STATIC,
      ['routes-slug'],
      ['routes-slug src/pages/data.ts: /data: the pattern does not end with a literal file extension'],
    ],
  ];
  for (const [route, settings, ids, findings] of cases) {
    assert.deepEqual(routeIds([route], settings), ids, route.pattern);
    assert.deepEqual(routeFindings([route], settings), findings, route.pattern);
  }
});

test('the route checks keep no state: a second run on the same list gives the same findings', () => {
  const routes = [page('/live', 'src/pages/live.astro', { isPrerendered: false }), endpoint('/[name].txt')];
  const first = routeFindings(routes, STATIC);
  assert.deepEqual(first.length, 2);
  assert.deepEqual(routeFindings(routes, STATIC), first);
  assert.deepEqual(routeFindings([], STATIC), []);
});

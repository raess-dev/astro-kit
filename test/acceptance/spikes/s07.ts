import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { build, read, record } from '../harness.ts';
import { page, project } from './project.ts';

const FRONT = "import { getAbsoluteLocaleUrl, getRelativeLocaleUrl, getRelativeLocaleUrlList } from 'astro:i18n';";
const BODY = [
  '<p id="locale">{Astro.currentLocale}</p>',
  '<a id="fr" href={getRelativeLocaleUrl("fr", "kontakt")}>fr</a>',
  '<a id="de" href={getRelativeLocaleUrl("de", "kontakt")}>de</a>',
  '<a id="en" href={getRelativeLocaleUrl("en", "kontakt")}>en</a>',
  '<a id="home-fr" href={getRelativeLocaleUrl("fr")}>fr</a>',
  '<a id="home-de" href={getRelativeLocaleUrl("de")}>de</a>',
  '<a id="absolute" href={getAbsoluteLocaleUrl("fr", "kontakt")}>fr</a>',
  '<p id="list">{getRelativeLocaleUrlList("kontakt").join(" ")}</p>',
].join('');

/** What the helpers of `astro:i18n` give on every page, whatever its locale. */
const HELPERS = {
  fr: '/fr/kontakt/',
  de: '/kontakt/',
  en: '/en/kontakt/',
  'home-fr': '/fr/',
  'home-de': '/',
  absolute: 'https://example.ch/fr/kontakt/',
  list: '/kontakt/ /fr/kontakt/ /en/kontakt/',
};

const probe = (title: string, frontmatter = ''): string => page(title, BODY, `${FRONT}\n${frontmatter}`);

// The pages of a rest route: `france/x` starts with the letters of a locale code and belongs to the default locale.
const REST = ['lage', 'fr/situation', 'en/location', 'france/x'];

const files = {
  'src/pages/index.astro': probe('de'),
  'src/pages/kontakt.astro': probe('de kontakt'),
  'src/pages/zimmer/index.astro': probe('de zimmer'),
  'src/pages/fr/index.astro': probe('fr'),
  'src/pages/fr/kontakt.astro': probe('fr kontakt'),
  'src/pages/en/index.astro': probe('en'),
  'src/pages/en/kontakt.astro': probe('en kontakt'),
  'src/pages/404.astro': probe('404'),
  'src/pages/[...slug].astro': probe(
    'rest',
    `export function getStaticPaths() {\n  return ${JSON.stringify(REST)}.map((slug) => ({ params: { slug } }));\n}`,
  ),
};

/** Every file of `dist` and the locale that its URL means (6.1, `astro:build:done`, step 2). */
const DIST: Record<string, string> = {
  '404.html': 'de',
  'en/index.html': 'en',
  'en/kontakt/index.html': 'en',
  'en/location/index.html': 'en',
  'fr/index.html': 'fr',
  'fr/kontakt/index.html': 'fr',
  'fr/situation/index.html': 'fr',
  'france/x/index.html': 'de',
  'index.html': 'de',
  'kontakt/index.html': 'de',
  'lage/index.html': 'de',
  'zimmer/index.html': 'de',
};

const list = (dir: string, prefix = ''): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? list(join(dir, entry.name), `${prefix}${entry.name}/`) : [`${prefix}${entry.name}`],
  );

/** The text or the `href` of the element with the id. */
const value = (html: string, id: string): string | undefined =>
  new RegExp(`<a id="${id}" href="([^"]*)"`).exec(html)?.[1] ?? new RegExp(`<p id="${id}">([^<]*)`).exec(html)?.[1];

interface Route {
  pattern: string;
  type: string;
  origin: string;
  entrypoint: string;
  redirect: boolean;
}

test('S7: the locked i18n emits no extra page or redirect, and the locale follows the URL', () => {
  const dir = project(
    's07',
    files,
    "{ locales: ['de', 'fr', 'en'], onRoutes: (routes, root) => writeFileSync(join(root, 'routes.json'), JSON.stringify(routes.map((route) => ({ pattern: route.pattern, type: route.type, origin: route.origin, entrypoint: route.entrypoint, redirect: route.redirect !== undefined })))) }",
    "import { writeFileSync } from 'node:fs';\nimport { join } from 'node:path';",
  );
  build(dir);

  assert.deepEqual(list(join(dir, 'dist')).sort(), Object.keys(DIST).sort(), 'dist holds the pages of the project and no other file');

  const routes = JSON.parse(read(dir, 'routes.json')) as Route[];
  assert.deepEqual(
    routes.filter((route) => route.type === 'redirect' || route.type === 'fallback' || route.redirect),
    [],
    'no redirect route and no fallback route',
  );
  assert.deepEqual(
    routes
      .filter((route) => route.origin !== 'internal')
      .map((route) => route.entrypoint)
      .sort(),
    Object.keys(files).sort(),
    'the routes that are not internal are the nine page files',
  );

  const measured: Record<string, string | undefined> = {};
  for (const [file, locale] of Object.entries(DIST)) {
    const html = read(dir, `dist/${file}`);
    assert.equal(/http-equiv="?refresh/i.test(html), false, `${file} is no redirect page`);
    measured[file] = value(html, 'locale');
    assert.equal(measured[file], locale, `Astro.currentLocale of ${file}`);
    for (const [id, expected] of Object.entries(HELPERS)) assert.equal(value(html, id), expected, `${id} on ${file}`);
  }
  record('S7.currentLocale', measured);
  record('S7.getRelativeLocaleUrl', value(read(dir, 'dist/index.html'), 'fr'));
});

/**
 * The rules of the site audit that `src/audit/site.ts` holds (part 5c of M5): routes, hreflang, links, depth and the
 * legal pages. Each case builds a `BuildContext` from strings shaped as Astro writes them (14.1), runs one rule, or the
 * two rules whose boundary it is about, and asserts the exact sorted id list.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  auditHreflangReciprocal,
  auditHreflangXDefault,
  auditLegalPages,
  auditLegalStatement,
  auditLinksDepth,
  auditLinksGeneric,
  auditLinksResolve,
  auditLinksSameName,
  auditLinksTargetBlank,
  auditRoutes404,
  auditRoutesTranslation,
  notFoundSegmentMessage,
  SITE_RULES,
} from '../../src/audit/site.ts';
import type { BuildContext } from '../../src/context.ts';
import type { Options } from '../../src/options.ts';
import { Report } from '../../src/registry.ts';
import {
  type ContextSettings,
  contextOf,
  fileOf,
  findings,
  ids,
  notFoundPage,
  OPTIONS,
  type PageParts,
  page,
  site,
} from './audit-fixtures.ts';
import { optionsOf, SITE, TWO_LOCALES } from './fixtures.ts';
import { SPEC } from './spec.ts';

type Rule = (ctx: BuildContext) => void;
type Files = Readonly<Record<string, string | Uint8Array>>;

/** Runs rules on a context of the files and returns its report. */
function run(rules: Rule | readonly Rule[], files: Files, settings: ContextSettings = {}): Report {
  const ctx = contextOf(files, settings);
  for (const rule of Array.isArray(rules) ? rules : [rules]) rule(ctx);
  return ctx.report;
}

/** The fixture site with some files replaced, added (a text) or removed (`null`). */
function siteWith(changes: Readonly<Record<string, string | null>>, options: Options = OPTIONS): Files {
  const files: Record<string, string> = { ...site(options) };
  for (const [file, text] of Object.entries(changes)) {
    if (text === null) delete files[file];
    else files[file] = text;
  }
  return files;
}

/** The text with its one occurrence of `from` replaced. Throws when `from` is not in the text. */
function edit(html: string, from: string, to: string): string {
  const at = html.indexOf(from);
  if (at < 0) throw new Error(`audit-site: the page has no ${from}`);
  return `${html.slice(0, at)}${to}${html.slice(at + from.length)}`;
}

const ORIGIN = OPTIONS.site;
/** The alternates of the two homes of the fixture site. */
const HOMES = { de: '/', fr: '/fr/' } as const;

/** The home page of the fixture site with other parts. */
const home = (parts: PageParts = {}): string => page(OPTIONS, '/', { alternates: HOMES, ...parts });
/** The fr home page of the fixture site with other parts. */
const frHome = (parts: PageParts = {}): string => page(OPTIONS, '/fr/', { alternates: HOMES, ...parts });

/** The fixture site with a changed home page. */
const withHome = (parts: PageParts): Files => siteWith({ 'index.html': home(parts) });

/** The fixture site with main of the home page as given. */
const withMain = (main: string): Files => withHome({ main: `<h1>Startseite des Beispiels</h1> ${main}` });

// The fixture site

test('the fixture site gives no id of the site group', () => {
  const report = run(
    SITE_RULES.map((rule) => rule.run),
    site(),
  );
  assert.deepEqual(ids(report), []);
});

// routes-404

test('routes-404 passes a site whose /404.html links every locale home and holds no kit form', () => {
  assert.deepEqual(ids(run(auditRoutes404, site())), []);
});

test('routes-404 fails a missing /404.html, at /404.html', () => {
  const report = run(auditRoutes404, siteWith({ '404.html': null }));
  assert.deepEqual(ids(report), ['routes-404']);
  assert.deepEqual(findings(report), ['routes-404 /404.html the file is missing: build it from src/pages/404.astro']);
});

test('routes-404 fails another page path with a 404 segment, with the exact message of section 8', () => {
  const report = run(auditRoutes404, siteWith({ 'fr/404/index.html': page(OPTIONS, '/fr/404/') }));
  assert.deepEqual(ids(report), ['routes-404']);
  assert.deepEqual(findings(report), [`routes-404 /fr/404/ ${notFoundSegmentMessage('/fr/404/')}`]);
  const deeper = run(auditRoutes404, siteWith({ 'a/404/b/index.html': page(OPTIONS, '/a/404/b/') }));
  assert.deepEqual(ids(deeper), ['routes-404']);
});

test('routes-404 has the exact message of the specification', () => {
  const row = SPEC.split('\n').find((line) => line.startsWith('| `routes-404` |')) ?? '';
  const message = notFoundSegmentMessage('<p>');
  assert.ok(row.includes(`Message for such a path \`<p>\`: \`${message}\``), message);
});

test('routes-404 leaves a segment that only starts with 404 alone', () => {
  assert.deepEqual(ids(run(auditRoutes404, siteWith({ '4040/index.html': page(OPTIONS, '/4040/') }))), []);
});

test('routes-404 fails a /404.html without a link to one locale home, once for each missing home', () => {
  const main = '<h1>Diese Seite gibt es nicht</h1> <p><a href="/">Zur Startseite</a></p>';
  const report = run(auditRoutes404, siteWith({ '404.html': notFoundPage(OPTIONS, { main }) }));
  assert.deepEqual(ids(report), ['routes-404']);
  assert.deepEqual(findings(report), ['routes-404 /404.html no link to the locale home /fr/']);
});

test('routes-404 counts an absolute link and a link with a fragment to a home, and an unbuilt home', () => {
  const main = `<h1>Nicht gefunden</h1> <p><a href="${ORIGIN}/fr/">Accueil</a> <a href="/#content">Start</a></p>`;
  const files = siteWith({ '404.html': notFoundPage(OPTIONS, { main }), 'fr/index.html': null });
  assert.deepEqual(ids(run(auditRoutes404, files)), []);
});

test('routes-404 fails a form on /404.html that posts to /api/forms/, and a control with such a formaction', () => {
  const form = (attributes: string): string =>
    `<h1>Nicht gefunden</h1> <a href="/">Start</a> <a href="/fr/">Accueil</a> <form method="post" ${attributes}><button>Senden</button></form>`;
  const posting = run(
    auditRoutes404,
    siteWith({ '404.html': notFoundPage(OPTIONS, { main: form('action="/api/forms/contact"') }) }),
  );
  assert.deepEqual(ids(posting), ['routes-404']);
  assert.deepEqual(findings(posting), ['routes-404 /404.html <form action="/api/forms/contact"> posts to a kit form']);
  const relative = run(
    auditRoutes404,
    siteWith({ '404.html': notFoundPage(OPTIONS, { main: form('action="api/forms/contact"') }) }),
  );
  assert.deepEqual(ids(relative), ['routes-404']);
  const control = `<h1>x</h1> <a href="/">Start</a> <a href="/fr/">Accueil</a> <form method="post" action="/kontakt/"><button formaction="/api/forms/contact">Senden</button></form>`;
  assert.deepEqual(ids(run(auditRoutes404, siteWith({ '404.html': notFoundPage(OPTIONS, { main: control }) }))), [
    'routes-404',
  ]);
  const other = run(
    auditRoutes404,
    siteWith({ '404.html': notFoundPage(OPTIONS, { main: form('action="/kontakt/"') }) }),
  );
  assert.deepEqual(ids(other), []);
});

test('routes-404 leaves a kit form on another page to the form rules', () => {
  const main = '<h1>Kontakt</h1> <form method="post" action="/api/forms/contact"><button>Senden</button></form>';
  assert.deepEqual(ids(run(auditRoutes404, withMain(main))), []);
});

// routes-translation

test('routes-translation passes the fixture site: each page lists its translation', () => {
  assert.deepEqual(ids(run(auditRoutesTranslation, site())), []);
});

test('routes-translation fails a fr page without a de-CH alternate, at the page', () => {
  const report = run(
    auditRoutesTranslation,
    siteWith({ 'fr/index.html': page(OPTIONS, '/fr/', { alternates: { fr: '/fr/' } }) }),
  );
  assert.deepEqual(ids(report), ['routes-translation']);
  assert.deepEqual(findings(report), ['routes-translation /fr/ no alternate with hreflang="de-CH"']);
});

test('routes-translation fails an indexable de page without the alternate of a full locale', () => {
  const report = run(
    auditRoutesTranslation,
    siteWith({ 'index.html': page(OPTIONS, '/', { alternates: { de: '/' } }) }),
  );
  assert.deepEqual(ids(report), ['routes-translation']);
  assert.deepEqual(findings(report), ['routes-translation / no alternate with hreflang="fr-CH"']);
});

test('routes-translation asks nothing of a de page for a partial locale', () => {
  const partial = optionsOf({
    ...TWO_LOCALES,
    locales: [TWO_LOCALES.locales[0], { ...TWO_LOCALES.locales[1], coverage: 'partial' }],
  });
  const files = siteWith({ 'index.html': page(partial, '/', { alternates: { de: '/' } }) }, partial);
  assert.deepEqual(ids(run(auditRoutesTranslation, files, { options: partial })), []);
  const fr = siteWith({ 'fr/index.html': page(partial, '/fr/', { alternates: { fr: '/fr/' } }) }, partial);
  assert.deepEqual(ids(run(auditRoutesTranslation, fr, { options: partial })), ['routes-translation']);
});

test('routes-translation skips a de page with noindex and exempts /404.html', () => {
  const noindex = page(OPTIONS, '/', { alternates: { de: '/' }, head: '<meta name="robots" content="noindex">' });
  assert.deepEqual(ids(run(auditRoutesTranslation, siteWith({ 'index.html': noindex }))), []);
  // The fixture /404.html lists no alternate.
  assert.deepEqual(ids(run(auditRoutesTranslation, { '404.html': notFoundPage(OPTIONS) })), []);
});

test('routes-translation counts an alternate of any ASCII case; hreflang-reciprocal reports the wrong tag', () => {
  const fr = edit(frHome(), 'hreflang="de-CH"', 'hreflang="de-ch"');
  const report = run([auditRoutesTranslation, auditHreflangReciprocal], siteWith({ 'fr/index.html': fr }));
  assert.deepEqual(ids(report), ['hreflang-reciprocal']);
});

test('routes-translation checks only that an alternate is listed: an invalid one is hreflang-reciprocal’s', () => {
  const fr = edit(frHome(), `hreflang="de-CH" href="${ORIGIN}/"`, 'hreflang="de-CH" href="/"');
  const report = run([auditRoutesTranslation, auditHreflangReciprocal], siteWith({ 'fr/index.html': fr }));
  assert.deepEqual(ids(report), ['hreflang-reciprocal']);
});

// hreflang-reciprocal

test('hreflang-reciprocal passes the fixture site and skips a page without alternates', () => {
  assert.deepEqual(ids(run(auditHreflangReciprocal, site())), []);
});

test('hreflang-reciprocal fails a relative href once, at the page that writes it', () => {
  const fr = edit(frHome(), `hreflang="de-CH" href="${ORIGIN}/"`, 'hreflang="de-CH" href="/"');
  const report = run(auditHreflangReciprocal, siteWith({ 'fr/index.html': fr }));
  assert.deepEqual(ids(report), ['hreflang-reciprocal']);
  assert.deepEqual(findings(report), [
    `hreflang-reciprocal /fr/ hreflang="de-CH" href="/": the href is not an absolute https URL under ${ORIGIN} without a query`,
  ]);
});

test('hreflang-reciprocal fails an http href, another host and a query', () => {
  for (const href of [`http://example.ch/`, 'https://other.example/', `${ORIGIN}/?a=1`, `${ORIGIN}:8443/`]) {
    const fr = edit(frHome(), `hreflang="de-CH" href="${ORIGIN}/"`, `hreflang="de-CH" href="${href}"`);
    assert.deepEqual(
      ids(run(auditHreflangReciprocal, siteWith({ 'fr/index.html': fr }))),
      ['hreflang-reciprocal'],
      href,
    );
  }
});

test('hreflang-reciprocal fails a target that does not list the page back', () => {
  const report = run(
    auditHreflangReciprocal,
    siteWith({ 'fr/index.html': page(OPTIONS, '/fr/', { alternates: { fr: '/fr/' } }) }),
  );
  assert.deepEqual(ids(report), ['hreflang-reciprocal']);
  assert.deepEqual(findings(report), [
    `hreflang-reciprocal / hreflang="fr-CH" href="${ORIGIN}/fr/": the target does not list this page back with hreflang="de-CH"`,
  ]);
});

test('hreflang-reciprocal fails a tag that names no locale, and a tag listed twice', () => {
  const unknown = run(
    auditHreflangReciprocal,
    withHome({ head: `<link rel="alternate" hreflang="it-CH" href="${ORIGIN}/">` }),
  );
  assert.deepEqual(ids(unknown), ['hreflang-reciprocal']);
  assert.deepEqual(findings(unknown), [
    `hreflang-reciprocal / hreflang="it-CH" href="${ORIGIN}/": the hreflang names no configured locale`,
  ]);
  const twice = run(
    auditHreflangReciprocal,
    withHome({ head: `<link rel="alternate" hreflang="fr-CH" href="${ORIGIN}/fr/">` }),
  );
  assert.deepEqual(findings(twice), [
    `hreflang-reciprocal / hreflang="fr-CH" href="${ORIGIN}/fr/": the hreflang is listed twice`,
  ]);
});

test('hreflang-reciprocal fails a target that is not built', () => {
  const index = edit(home(), `hreflang="x-default" href="${ORIGIN}/"`, `hreflang="x-default" href="${ORIGIN}/nicht/"`);
  const report = run(auditHreflangReciprocal, siteWith({ 'index.html': index }));
  assert.deepEqual(ids(report), ['hreflang-reciprocal']);
  assert.deepEqual(findings(report), [
    `hreflang-reciprocal / hreflang="x-default" href="${ORIGIN}/nicht/": the href names no built page`,
  ]);
});

test('hreflang-reciprocal reports a broken pair at both ends: it cannot know which end is wrong', () => {
  const report = run(auditHreflangReciprocal, withHome({ alternates: { de: '/', fr: '/fr/nicht/' } }));
  assert.deepEqual(findings(report), [
    `hreflang-reciprocal / hreflang="fr-CH" href="${ORIGIN}/fr/nicht/": the href names no built page`,
    `hreflang-reciprocal /fr/ hreflang="de-CH" href="${ORIGIN}/": the target does not list this page back with hreflang="fr-CH"`,
  ]);
});

test('hreflang-reciprocal fails a page whose alternates leave out the page itself', () => {
  const report = run(auditHreflangReciprocal, withHome({ alternates: { fr: '/fr/' } }));
  assert.deepEqual(ids(report), ['hreflang-reciprocal']);
  assert.deepEqual(findings(report), [
    `hreflang-reciprocal / no alternate with hreflang="de-CH" and the page's own URL`,
  ]);
});

test('hreflang-reciprocal fails a tag whose target is a page of another locale, in one finding', () => {
  const report = run(auditHreflangReciprocal, withHome({ alternates: { de: '/', fr: '/impressum/' } }));
  assert.deepEqual(findings(report), [
    `hreflang-reciprocal / hreflang="fr-CH" href="${ORIGIN}/impressum/": the target is a page of the locale de; the target does not list this page back with hreflang="de-CH"`,
    `hreflang-reciprocal /fr/ hreflang="de-CH" href="${ORIGIN}/": the target does not list this page back with hreflang="fr-CH"`,
  ]);
});

test('hreflang-reciprocal reads /404.html when it lists alternates', () => {
  const notFound = edit(
    notFoundPage(OPTIONS),
    '<meta name="robots"',
    `<link rel="alternate" hreflang="fr-CH" href="${ORIGIN}/fr/"><meta name="robots"`,
  );
  const report = run(auditHreflangReciprocal, siteWith({ '404.html': notFound }));
  assert.deepEqual(ids(report), ['hreflang-reciprocal']);
});

// hreflang-x-default

test('hreflang-x-default passes the fixture site', () => {
  assert.deepEqual(ids(run(auditHreflangXDefault, site())), []);
});

test('hreflang-x-default fails an x-default that names the fr page', () => {
  const report = run(
    auditHreflangXDefault,
    siteWith({
      'index.html': edit(home(), `hreflang="x-default" href="${ORIGIN}/"`, `hreflang="x-default" href="${ORIGIN}/fr/"`),
    }),
  );
  assert.deepEqual(ids(report), ['hreflang-x-default']);
  assert.deepEqual(findings(report), [
    `hreflang-x-default / x-default href="${ORIGIN}/fr/"; expected href="${ORIGIN}/"`,
  ]);
});

test('hreflang-x-default fails a page with a default alternate and no x-default', () => {
  const report = run(
    auditHreflangXDefault,
    siteWith({ 'fr/index.html': edit(frHome(), `<link rel="alternate" hreflang="x-default" href="${ORIGIN}/">`, '') }),
  );
  assert.deepEqual(findings(report), [`hreflang-x-default /fr/ no x-default; expected href="${ORIGIN}/"`]);
});

test('hreflang-x-default skips a page without a default alternate, and a page without alternates', () => {
  const fr = page(OPTIONS, '/fr/', { alternates: { fr: '/fr/' } });
  assert.deepEqual(ids(run(auditHreflangXDefault, siteWith({ 'fr/index.html': fr }))), []);
  assert.deepEqual(ids(run(auditHreflangXDefault, { '404.html': notFoundPage(OPTIONS) })), []);
});

test('hreflang-x-default compares the page that both name: one absolute URL in another spelling passes', () => {
  const index = edit(
    home(),
    `hreflang="x-default" href="${ORIGIN}/"`,
    'hreflang="x-default" href="https://EXAMPLE.ch/"',
  );
  assert.deepEqual(ids(run(auditHreflangXDefault, siteWith({ 'index.html': index }))), []);
});

test('a second x-default is hreflang-reciprocal’s "listed twice", not hreflang-x-default’s', () => {
  const report = run(
    [auditHreflangReciprocal, auditHreflangXDefault],
    withHome({ head: `<link rel="alternate" hreflang="x-default" href="${ORIGIN}/fr/">` }),
  );
  assert.deepEqual(ids(report), ['hreflang-reciprocal']);
});

// links-resolve

test('links-resolve passes the fixture site: root-relative page links and a skip link to #content', () => {
  assert.deepEqual(ids(run(auditLinksResolve, site())), []);
});

test('links-resolve fails a link to /impressum, without its final /, at the page', () => {
  const report = run(auditLinksResolve, withMain('<p><a href="/impressum">Impressum</a></p>'));
  assert.deepEqual(ids(report), ['links-resolve']);
  assert.deepEqual(findings(report), ['links-resolve / <a href="/impressum">: /impressum is no built page or file']);
});

test('links-resolve passes the file of a page, a dist file, an absolute https link and relative links', () => {
  const main = [
    '<a href="/impressum/index.html">Datei</a>',
    '<a href="/favicon.ico">Icon</a>',
    `<a href="${ORIGIN}/impressum/">Absolut</a>`,
    '<a href="//example.ch/datenschutz/">Ohne Schema</a>',
    '<a href="impressum/">Relativ</a>',
    '<a href="./fr/../datenschutz/">Punkte</a>',
    '<a href="">Selbst</a>',
  ].join(' ');
  assert.deepEqual(ids(run(auditLinksResolve, withMain(`<p>${main}</p>`))), []);
});

test('links-resolve fails a query, an http link and a link to a redirect source', () => {
  const query = run(auditLinksResolve, withMain('<p><a href="/impressum/?a=1">Impressum</a></p>'));
  assert.deepEqual(findings(query), ['links-resolve / <a href="/impressum/?a=1">: it has a query']);
  const http = run(auditLinksResolve, withMain('<p><a href="http://example.ch/impressum/">Impressum</a></p>'));
  assert.deepEqual(findings(http), [
    'links-resolve / <a href="http://example.ch/impressum/">: it uses http, not https',
  ]);
  const redirects = [{ from: '/alt/', to: '/impressum/' }];
  const files = siteWith({
    'alt/index.html': page(OPTIONS, '/alt/', { header: '<header class="site-header"></header>' }),
    'index.html': home({ main: '<h1>Start</h1> <a href="/alt/">Alt</a>' }),
  });
  const redirected = run(auditLinksResolve, files, { redirects });
  assert.deepEqual(findings(redirected), ['links-resolve / <a href="/alt/">: /alt/ is a redirect source']);
  assert.deepEqual(ids(run(auditLinksResolve, files)), []);
});

test('links-resolve fails a fragment that names no element, on the page and on the target', () => {
  const missing = run(auditLinksResolve, withMain('<p><a href="#preise">Preise</a></p>'));
  assert.deepEqual(findings(missing), ['links-resolve / <a href="#preise">: #preise names no element of the page']);
  assert.deepEqual(ids(run(auditLinksResolve, withMain('<p><a href="#">Oben</a></p>'))), ['links-resolve']);
  assert.deepEqual(ids(run(auditLinksResolve, withMain('<p id="preise"><a href="#preise">Preise</a></p>'))), []);
  const target = run(auditLinksResolve, withMain('<p><a href="/impressum/#preise">Preise</a></p>'));
  assert.deepEqual(findings(target), [
    'links-resolve / <a href="/impressum/#preise">: #preise names no element of /impressum/',
  ]);
  assert.deepEqual(ids(run(auditLinksResolve, withMain('<p><a href="/impressum/#content">Inhalt</a></p>'))), []);
  assert.deepEqual(ids(run(auditLinksResolve, withMain('<p><a href="/impressum/index.html#nichts">x</a></p>'))), [
    'links-resolve',
  ]);
});

test('links-resolve reads a fragment as written or percent-decoded, and not the fragment of a file', () => {
  assert.deepEqual(ids(run(auditLinksResolve, withMain('<p id="über"><a href="#%C3%BCber">Über</a></p>'))), []);
  assert.deepEqual(ids(run(auditLinksResolve, withMain('<p id="%"><a href="#%">x</a></p>'))), []);
  assert.deepEqual(ids(run(auditLinksResolve, withMain('<p><a href="/icon.svg#mark">Zeichen</a></p>'))), []);
});

test('links-resolve fails an absolute href that is no valid URL, and leaves other origins and schemes alone', () => {
  const report = run(auditLinksResolve, withMain('<p><a href="https://exa mple.ch/">x</a></p>'));
  assert.deepEqual(findings(report), ['links-resolve / <a href="https://exa mple.ch/">: it is no valid URL']);
  const others =
    '<a href="https://other.example/x">x</a> <a href="mailto:info@example.ch">E-Mail</a> <a href="tel:+41815550110">Telefon</a>';
  assert.deepEqual(ids(run(auditLinksResolve, withMain(`<p>${others}</p>`))), []);
});

test('links-resolve reads area links and not link elements, and reports every problem of a link in one finding', () => {
  const area = run(
    auditLinksResolve,
    withMain('<map name="m"><area href="/plan" alt="Plan" shape="rect" coords="0,0,1,1"></map>'),
  );
  assert.deepEqual(findings(area), ['links-resolve / <area href="/plan">: /plan is no built page or file']);
  assert.deepEqual(
    ids(run(auditLinksResolve, withHome({ head: '<link rel="preload" href="/nicht.css" as="style">' }))),
    [],
  );
  const many = run(auditLinksResolve, withMain('<p><a href="http://example.ch/nicht?x=1#y">x</a></p>'));
  assert.deepEqual(findings(many), [
    'links-resolve / <a href="http://example.ch/nicht?x=1#y">: it uses http, not https; it has a query; /nicht is no built page or file',
  ]);
});

test('a broken link is links-resolve’s alone: links-depth takes it as no edge', () => {
  const report = run([auditLinksResolve, auditLinksDepth], withMain('<p><a href="/zimmer">Zimmer</a></p>'));
  assert.deepEqual(ids(report), ['links-resolve']);
});

// links-generic

test('links-generic passes the fixture site, a tel link and names from alt, aria-label, labelledby and title', () => {
  const main = [
    '<a href="tel:+41815550110">+41 81 555 01 10</a>',
    '<a href="/impressum/"><img src="/_astro/a.webp" alt="Impressum"></a>',
    '<a href="/impressum/" aria-label="Zum Impressum">mehr</a>',
    '<span id="n">Datenschutz lesen</span><a href="/datenschutz/" aria-labelledby="n"></a>',
    '<a href="/datenschutz/" title="Datenschutz"></a>',
    '<a href="/datenschutz/"><svg><title>Datenschutz</title></svg></a>',
    '<a href="/datenschutz/">Mehr über uns</a>',
    '<map name="m"><area href="/impressum/" alt="Impressum" shape="rect" coords="0,0,1,1"></map>',
  ].join(' ');
  assert.deepEqual(ids(run(auditLinksGeneric, site())), []);
  assert.deepEqual(ids(run(auditLinksGeneric, withMain(`<p>${main}</p>`))), []);
});

test('links-generic fails a generic name, in any case and with non-letters at its ends', () => {
  const report = run(auditLinksGeneric, withMain('<p><a href="/impressum/">mehr</a></p>'));
  assert.deepEqual(ids(report), ['links-generic']);
  assert.deepEqual(findings(report), ['links-generic / <a href="/impressum/"> has the generic name "mehr"']);
  for (const text of ['Mehr …', '» Hier klicken!', 'READ MORE', 'en savoir plus', 'Di più']) {
    assert.deepEqual(
      ids(run(auditLinksGeneric, withMain(`<p><a href="/impressum/">${text}</a></p>`))),
      ['links-generic'],
      text,
    );
  }
});

test('links-generic fails a link without a name: empty, an empty alt, hidden text, an area without alt', () => {
  const empty = run(auditLinksGeneric, withMain('<p><a href="/impressum/"> </a></p>'));
  assert.deepEqual(findings(empty), ['links-generic / <a href="/impressum/"> has no accessible name']);
  for (const link of [
    '<a href="/impressum/"><img src="/_astro/a.webp" alt=""></a>',
    '<a href="/impressum/"><span aria-hidden="true">Impressum</span></a>',
    '<a href="/impressum/"><svg aria-hidden="true"></svg></a>',
    '<a href="/impressum/" aria-label=" "></a>',
    '<map name="m"><area href="/impressum/" shape="rect" coords="0,0,1,1"></map>',
  ]) {
    assert.deepEqual(ids(run(auditLinksGeneric, withMain(`<p>${link}</p>`))), ['links-generic'], link);
  }
});

test('links-generic reads links with href only: an a without href is no link', () => {
  assert.deepEqual(ids(run(auditLinksGeneric, withMain('<p><a>mehr</a></p>'))), []);
});

// links-same-name

test('links-same-name passes the fixture site and repeated links that share a target', () => {
  const main = [
    '<a href="/impressum/">Impressum</a>',
    `<a href="${ORIGIN}/impressum/">Impressum</a>`,
    '<a href="/impressum/index.html">impressum</a>',
    '<a href="/impressum/#">Impressum</a>',
    '<a href="mailto:info@example.ch">info@example.ch</a>',
    '<a href="mailto:info@example.ch">info@example.ch</a>',
  ].join(' ');
  assert.deepEqual(ids(run(auditLinksSameName, site())), []);
  assert.deepEqual(ids(run(auditLinksSameName, withMain(`<p>${main}</p>`))), []);
});

test('links-same-name fails two links with one name and two targets, once for the name', () => {
  const main = '<a href="/impressum/">Zimmer</a> <a href="/datenschutz/">Zimmer</a> <a href="/fr/">Zimmer</a>';
  const report = run(auditLinksSameName, withMain(`<p>${main}</p>`));
  assert.deepEqual(ids(report), ['links-same-name']);
  assert.deepEqual(findings(report), [
    'links-same-name / the name "Zimmer" links to "/impressum/", "/datenschutz/", "/fr/"',
  ]);
});

test('links-same-name compares names in lower case, and targets with their fragment', () => {
  const cased = '<a href="/impressum/">Zimmer</a> <a href="/datenschutz/">zimmer</a>';
  assert.deepEqual(ids(run(auditLinksSameName, withMain(`<p>${cased}</p>`))), ['links-same-name']);
  const fragment = '<a href="/impressum/">Impressum</a> <a href="/impressum/#content">Impressum</a>';
  assert.deepEqual(ids(run(auditLinksSameName, withMain(`<p>${fragment}</p>`))), ['links-same-name']);
  const own = '<a href="#content">Inhalt</a> <a href="/#content">Inhalt</a>';
  assert.deepEqual(ids(run(auditLinksSameName, withMain(`<p>${own}</p>`))), []);
  const mail = '<a href="mailto:info@example.ch">E-Mail</a> <a href="mailto:jobs@example.ch">E-Mail</a>';
  assert.deepEqual(ids(run(auditLinksSameName, withMain(`<p>${mail}</p>`))), ['links-same-name']);
});

test('links with a generic name or no name are links-generic’s, not links-same-name’s', () => {
  const main =
    '<a href="/impressum/">mehr</a> <a href="/datenschutz/">mehr</a> <a href="/impressum/"></a> <a href="/datenschutz/"></a>';
  const report = run([auditLinksGeneric, auditLinksSameName], withMain(`<p>${main}</p>`));
  assert.deepEqual(ids(report), ['links-generic']);
});

// links-target-blank

test('links-target-blank passes the fixture site and the three values that keep the window', () => {
  const main =
    '<a href="/impressum/" target="_self">a</a> <a href="/impressum/" target="_TOP">b</a> <a href="/impressum/" target="_parent">c</a>';
  assert.deepEqual(ids(run(auditLinksTargetBlank, site())), []);
  assert.deepEqual(ids(run(auditLinksTargetBlank, withMain(`<p>${main}</p>`))), []);
});

test('links-target-blank fails target="_blank" on a link, once for each element', () => {
  const report = run(auditLinksTargetBlank, withMain('<p><a href="/impressum/" target="_blank">Impressum</a></p>'));
  assert.deepEqual(ids(report), ['links-target-blank']);
  assert.deepEqual(findings(report), ['links-target-blank / <a target="_blank">']);
});

test('links-target-blank fails a named window, an empty target, a form target and a base target', () => {
  for (const markup of [
    '<p><a href="/impressum/" target="fenster">x</a></p>',
    '<p><a href="/impressum/" target="">x</a></p>',
    '<p><a href="/impressum/" target=" _self">x</a></p>',
    '<form action="/kontakt/" target="_blank"><button>x</button></form>',
  ]) {
    assert.deepEqual(ids(run(auditLinksTargetBlank, withMain(markup))), ['links-target-blank'], markup);
  }
  const base = run(auditLinksTargetBlank, withHome({ head: '<base href="/" target="_blank">' }));
  assert.deepEqual(findings(base), ['links-target-blank / <base target="_blank">']);
});

// links-depth

/** A page in the chain of `chain`: it links the next page. */
const linked = (path: string, next: string | undefined): string =>
  page(OPTIONS, path, {
    main: `<h1>Seite ${path}</h1>${next === undefined ? '' : ` <p><a href="${next}">Weiter</a></p>`}`,
  });

/** The fixture site with a chain of pages from the home: `/a/` → `/b/` → … */
function chain(paths: readonly string[]): Files {
  const changes: Record<string, string> = {
    'index.html': home({ main: `<h1>Start</h1> <a href="${paths[0]}">Los</a>` }),
  };
  paths.forEach((path, index) => {
    changes[fileOf(path)] = linked(path, paths[index + 1]);
  });
  return siteWith(changes);
}

test('links-depth passes the fixture site and a chain three clicks deep', () => {
  assert.deepEqual(ids(run(auditLinksDepth, site())), []);
  assert.deepEqual(ids(run(auditLinksDepth, chain(['/a/', '/b/', '/c/']))), []);
});

test('links-depth fails a page four clicks from its home', () => {
  const report = run(auditLinksDepth, chain(['/a/', '/b/', '/c/', '/d/']));
  assert.deepEqual(ids(report), ['links-depth']);
  assert.deepEqual(findings(report), ['links-depth /d/ 4 clicks from /; at most 3']);
});

test('links-depth fails an indexable page that no link reaches, and skips noindex pages and /404.html', () => {
  const report = run(auditLinksDepth, siteWith({ 'insel/index.html': page(OPTIONS, '/insel/') }));
  assert.deepEqual(findings(report), ['links-depth /insel/ no link path from / reaches the page']);
  const noindex = page(OPTIONS, '/insel/', { head: '<meta name="robots" content="noindex">' });
  assert.deepEqual(ids(run(auditLinksDepth, siteWith({ 'insel/index.html': noindex }))), []);
});

test('links-depth walks the links of every locale: a fr page linked only from a de page counts', () => {
  // /fr/ (0) → / (1, its language link) → /fr/neu/ (2).
  const main = '<h1>Start</h1> <a href="/fr/neu/">Nouveau</a>';
  const files = siteWith({ 'index.html': home({ main }), 'fr/neu/index.html': page(OPTIONS, '/fr/neu/') });
  assert.deepEqual(ids(run(auditLinksDepth, files)), []);
  // Without the language links of /fr/, the walk goes /fr/ → /fr/mentions-legales/ → /impressum/ → / → /fr/neu/.
  const fr = frHome({ header: '<header class="site-header"></header>' });
  const report = run(auditLinksDepth, { ...files, 'fr/index.html': fr });
  assert.deepEqual(findings(report), ['links-depth /fr/neu/ 4 clicks from /fr/; at most 3']);
});

test('links-depth fails a missing locale home once, at the home path, and says nothing more of its pages', () => {
  const report = run(auditLinksDepth, siteWith({ 'fr/index.html': null }));
  assert.deepEqual(ids(report), ['links-depth']);
  assert.deepEqual(findings(report), ['links-depth /fr/ the locale fr has pages, but its home is not built']);
});

test('links-depth asks no home of a locale without pages', () => {
  const files = siteWith({
    'fr/index.html': null,
    'fr/mentions-legales/index.html': null,
    'fr/protection-des-donnees/index.html': null,
  });
  assert.deepEqual(ids(run(auditLinksDepth, files)), []);
});

// legal-pages

test('legal-pages passes the fixture site: the four legal pages are built and every page links its two', () => {
  assert.deepEqual(ids(run(auditLegalPages, site())), []);
});

test('legal-pages fails a declared path that is not built, at its field', () => {
  const report = run(auditLegalPages, siteWith({ 'fr/protection-des-donnees/index.html': null }));
  assert.deepEqual(ids(report), ['legal-pages']);
  assert.deepEqual(findings(report), [
    'legal-pages astro-kit.json: legal.privacy.fr /fr/protection-des-donnees/ is not built',
  ]);
});

test('a legal page that is not built is legal-pages’ once; each link to it is links-resolve’s', () => {
  const report = run([auditLegalPages, auditLinksResolve], siteWith({ 'fr/protection-des-donnees/index.html': null }));
  assert.deepEqual(ids(report), ['legal-pages', 'links-resolve']);
  assert.equal(report.findings.filter((finding) => finding.rule === 'legal-pages').length, 1);
});

test('legal-pages fails a declared path that is a page of another locale', () => {
  const options: Options = {
    ...OPTIONS,
    legal: { ...OPTIONS.legal, privacy: { de: '/datenschutz/', fr: '/datenschutz/' } },
  };
  const report = run(auditLegalPages, site(), { options });
  assert.deepEqual(
    findings(report).filter((line) => line.includes('astro-kit.json')),
    ['legal-pages astro-kit.json: legal.privacy.fr /datenschutz/ is a page of the locale de, not fr'],
  );
});

test('legal-pages checks a declared accessibility page', () => {
  const options = optionsOf({
    ...TWO_LOCALES,
    legal: { ...TWO_LOCALES.legal, accessibility: { de: '/barrierefreiheit/', fr: '/fr/accessibilite/' } },
  });
  const files = { ...site(options), 'barrierefreiheit/index.html': page(options, '/barrierefreiheit/') };
  const report = run(auditLegalPages, files, { options });
  assert.deepEqual(findings(report), [
    'legal-pages astro-kit.json: legal.accessibility.fr /fr/accessibilite/ is not built',
  ]);
});

test('legal-pages fails an indexable page without a link to its privacy page, naming the missing paths', () => {
  const footer = '<footer class="site-footer"> <a href="/impressum/">Impressum</a> </footer>';
  const report = run(auditLegalPages, withHome({ footer }));
  assert.deepEqual(ids(report), ['legal-pages']);
  assert.deepEqual(findings(report), ['legal-pages / no link to /datenschutz/']);
  const none = run(auditLegalPages, withHome({ footer: '<footer class="site-footer"></footer>' }));
  assert.deepEqual(findings(none), ['legal-pages / no link to /impressum/ and /datenschutz/']);
});

test('legal-pages counts an absolute link, and asks no link of a noindex page or /404.html', () => {
  const absolute = `<footer> <a href="${ORIGIN}/impressum/">Impressum</a> <a href="/datenschutz/#content">Datenschutz</a> </footer>`;
  assert.deepEqual(ids(run(auditLegalPages, withHome({ footer: absolute }))), []);
  const noindex = withHome({ footer: '<footer></footer>', head: '<meta name="robots" content="noindex">' });
  assert.deepEqual(ids(run(auditLegalPages, noindex)), []);
  const notFound = edit(notFoundPage(OPTIONS), '<a href="/datenschutz/">', '<a href="/">');
  assert.deepEqual(ids(run(auditLegalPages, siteWith({ '404.html': notFound }))), []);
});

test('legal-pages asks a page of a fr locale for the fr paths', () => {
  const footer = '<footer> <a href="/impressum/">Impressum</a> <a href="/datenschutz/">Datenschutz</a> </footer>';
  const report = run(auditLegalPages, siteWith({ 'fr/index.html': frHome({ footer }) }));
  assert.deepEqual(findings(report), [
    'legal-pages /fr/ no link to /fr/mentions-legales/ and /fr/protection-des-donnees/',
  ]);
});

// legal-statement

/** Settings with an accessibility page in each locale. */
const ACCESSIBILITY = optionsOf({
  ...TWO_LOCALES,
  legal: { ...TWO_LOCALES.legal, accessibility: { de: '/barrierefreiheit/', fr: '/fr/accessibilite/' } },
});

/** The fixture site with the two accessibility pages, the de one with the main as given. */
function statement(main: string, footer?: string): Files {
  const parts: PageParts = { main: `<h1>Erklärung zur Barrierefreiheit</h1> ${main}` };
  if (footer !== undefined) parts.footer = footer;
  return {
    ...site(ACCESSIBILITY),
    'barrierefreiheit/index.html': page(ACCESSIBILITY, '/barrierefreiheit/', parts),
    'fr/accessibilite/index.html': page(ACCESSIBILITY, '/fr/accessibilite/'),
  };
}

const AUDIT = { ...SITE, accessibilityAudit: { date: '2026-10-01', by: 'Access AG', scope: 'every page' } };

test('legal-statement passes a statement without a claim, and a site without a declared accessibility page', () => {
  assert.deepEqual(
    ids(run(auditLegalStatement, statement('<p>Wir prüfen die Website laufend.</p>'), { options: ACCESSIBILITY })),
    [],
  );
  assert.deepEqual(ids(run(auditLegalStatement, withMain('<p>Diese Website ist konform mit WCAG 2.1.</p>'))), []);
});

test('legal-statement fails a claim of conformance without accessibilityAudit, once for the page', () => {
  const files = statement('<p>Diese Website ist konform mit WCAG 2.1 AA.</p> <p>Sie ist Konform.</p>');
  const report = run(auditLegalStatement, files, { options: ACCESSIBILITY });
  assert.deepEqual(ids(report), ['legal-statement']);
  assert.deepEqual(findings(report), [
    'legal-statement /barrierefreiheit/ the page claims conformance ("konform"), but site.json has no accessibilityAudit',
  ]);
  for (const claim of [
    'conforme',
    'CONFORMANT',
    'compliant',
    'teilweise konform',
    'nicht vollständig, aber in weiten Teilen konform',
  ]) {
    assert.deepEqual(
      ids(run(auditLegalStatement, statement(`<p>Die Website ist ${claim}.</p>`), { options: ACCESSIBILITY })),
      ['legal-statement'],
      claim,
    );
  }
});

test('legal-statement passes a claim when site.json has accessibilityAudit', () => {
  const files = statement('<p>Diese Website ist konform mit WCAG 2.1 AA.</p>');
  assert.deepEqual(ids(run(auditLegalStatement, files, { options: ACCESSIBILITY, site: AUDIT })), []);
});

test('legal-statement counts only whole words: Konformität and nonconformant are no claim', () => {
  const files = statement('<p>Zur Konformität: die Seite ist nonconformant und unkonform.</p>');
  assert.deepEqual(ids(run(auditLegalStatement, files, { options: ACCESSIBILITY })), []);
});

test('legal-statement lets a negation in the 24 characters before a match cancel it', () => {
  for (const text of [
    'nicht konform',
    'noch nicht vollständig konform',
    'non conforme',
    'Kein Teil ist konform',
    'is not compliant',
  ]) {
    assert.deepEqual(
      ids(run(auditLegalStatement, statement(`<p>Sie ist ${text}.</p>`), { options: ACCESSIBILITY })),
      [],
      text,
    );
  }
  // "nicht" and a space take 6 of the 24 characters: with 18 more before the match, its "n" is outside the window.
  const far = `<p>nicht ${'x'.repeat(18)} konform</p>`;
  assert.deepEqual(ids(run(auditLegalStatement, statement(far), { options: ACCESSIBILITY })), ['legal-statement']);
  const near = `<p>nicht ${'x'.repeat(17)} konform</p>`;
  assert.deepEqual(ids(run(auditLegalStatement, statement(near), { options: ACCESSIBILITY })), []);
});

test('legal-statement does not take the end of a longer word at the start of the window as a negation', () => {
  // The window holds the last 24 characters before "konform": "kein " and 19 dashes. In the text "kein" is the end of
  // "Vkein", so it is no whole word; with a space before it, it is.
  const cut = `<p>Vkein ${'-'.repeat(19)}konform</p>`;
  assert.deepEqual(ids(run(auditLegalStatement, statement(cut), { options: ACCESSIBILITY })), ['legal-statement']);
  const whole = `<p>V kein ${'-'.repeat(18)}konform</p>`;
  assert.deepEqual(ids(run(auditLegalStatement, statement(whole), { options: ACCESSIBILITY })), []);
  const apostrophe = `<p>V’kein ${'-'.repeat(18)}konform</p>`;
  assert.deepEqual(ids(run(auditLegalStatement, statement(apostrophe), { options: ACCESSIBILITY })), [
    'legal-statement',
  ]);
});

test('legal-statement reads the page text: a claim in the footer counts', () => {
  const footer =
    '<footer> <a href="/impressum/">Impressum</a> <a href="/datenschutz/">Datenschutz</a> <p>Konform mit WCAG</p> </footer>';
  const files = statement('<p>Wir prüfen die Website.</p>', footer);
  assert.deepEqual(ids(run(auditLegalStatement, files, { options: ACCESSIBILITY })), ['legal-statement']);
});

test('legal-statement leaves a declared page that is not built to legal-pages', () => {
  const files = { ...site(ACCESSIBILITY) };
  const report = run([auditLegalStatement, auditLegalPages], files, { options: ACCESSIBILITY });
  assert.deepEqual(ids(report), ['legal-pages']);
});

// Hostile input

const MINE: readonly (readonly [string, Rule])[] = [
  ['routes-404', auditRoutes404],
  ['routes-translation', auditRoutesTranslation],
  ['hreflang-reciprocal', auditHreflangReciprocal],
  ['hreflang-x-default', auditHreflangXDefault],
  ['links-resolve', auditLinksResolve],
  ['links-generic', auditLinksGeneric],
  ['links-same-name', auditLinksSameName],
  ['links-target-blank', auditLinksTargetBlank],
  ['links-depth', auditLinksDepth],
  ['legal-pages', auditLegalPages],
  ['legal-statement', auditLegalStatement],
];

/** A page of about 2 MB: many links with one generic name and many alternates that each list the other page. */
function largePage(path: string, other: string): string {
  const links = '<a href="/x/a" target="_blank">mehr</a> '.repeat(20_000);
  const alternates = `<link rel="alternate" hreflang="fr-CH" href="${ORIGIN}${other}">`.repeat(10_000);
  const claims = 'konform '.repeat(50_000);
  return page(ACCESSIBILITY, path, { head: alternates, main: `<h1>Gross</h1> <p>${links}</p> <p>${claims}</p>` });
}

/** A page that nests 5,000 elements deep, with links at the bottom. */
function deepPage(): string {
  const depth = 5_000;
  const inner = '<a href="/tief/#x">mehr</a><a href="/nicht/">Zimmer</a><a href="/impressum/">Zimmer</a>';
  return page(ACCESSIBILITY, '/tief/', {
    main: `<h1>Tief</h1>${'<div>'.repeat(depth)}${inner}${'</div>'.repeat(depth)}`,
  });
}

/** A page with attributes named constructor and __proto__, a lone surrogate and U+0000 in text and attributes. */
function oddPage(): string {
  const head = `<link rel="alternate" constructor="x" hreflang="\ud800" href="${ORIGIN}/\u0000/"><link __proto__="y" rel="alternate" hreflang="constructor" href="https://\ud800/">`;
  const main = [
    '<a constructor="1" href="/\ud800/">\ud800</a>',
    '<a __proto__="2" href="#\u0000" target="\u0000">\u0000</a>',
    '<a hasOwnProperty="3" href="https://[::1/">x</a>',
    '<area toString="4" href="/%" alt="\ud800">',
    '<form constructor="5" action="/api/forms/\ud800"></form>',
    '<p>konform \ud800 \u0000</p>',
  ].join(' ');
  return page(ACCESSIBILITY, '/odd/', { head, main });
}

const HOSTILE: Files = {
  ...site(ACCESSIBILITY),
  'barrierefreiheit/index.html': largePage('/barrierefreiheit/', '/fr/accessibilite/'),
  'fr/accessibilite/index.html': largePage('/fr/accessibilite/', '/barrierefreiheit/'),
  'tief/index.html': deepPage(),
  'odd/index.html': oddPage(),
  '404.html': edit(
    notFoundPage(ACCESSIBILITY),
    '<main id="content">',
    '<main id="content"><form action="/api/forms/x\ud800"></form>',
  ),
};

/** The hostile pages, parsed once: each case runs its rule on fresh reports of the same pages. */
const hostile = contextOf(HOSTILE, { options: ACCESSIBILITY });

/** What each rule finds on the hostile pages. */
const HOSTILE_IDS: ReadonlyMap<string, readonly string[]> = new Map([
  ['routes-404', ['routes-404']],
  ['routes-translation', ['routes-translation']],
  ['hreflang-reciprocal', ['hreflang-reciprocal']],
  ['hreflang-x-default', []],
  ['links-resolve', ['links-resolve']],
  ['links-generic', ['links-generic']],
  ['links-same-name', ['links-same-name']],
  ['links-target-blank', ['links-target-blank']],
  ['links-depth', ['links-depth']],
  ['legal-pages', []],
  ['legal-statement', ['legal-statement']],
]);

for (const [id, rule] of MINE) {
  test(`${id} does not throw on a page of 2 MB, a page nested 5,000 deep or odd bytes, and gives a stable result`, () => {
    const first = { ...hostile, report: new Report() };
    const start = performance.now();
    rule(first);
    const elapsed = performance.now() - start;
    const second = { ...hostile, report: new Report() };
    rule(second);
    assert.deepEqual(findings(second.report), findings(first.report));
    assert.deepEqual(ids(first.report), HOSTILE_IDS.get(id));
    assert.ok(elapsed < 3_000, `${id} took ${Math.round(elapsed)} ms`);
  });
}

// Review cases of part 5c

/** Every root-relative link of a page path (`href="/x/"`) written as the file of the page (`href="/x/index.html"`). */
const asFiles = (html: string): string => html.replace(/href="(\/(?:[^"]*\/)?)"/g, 'href="$1index.html"');

test('a site whose links name the files of its pages (/x/index.html) passes every site rule', () => {
  const files = Object.fromEntries(
    Object.entries(site()).map(([file, text]) => [file, file.endsWith('.html') ? asFiles(text) : text]),
  );
  assert.ok(Object.values(files).some((text) => text.includes('href="/fr/index.html"')));
  assert.deepEqual(
    ids(
      run(
        SITE_RULES.map((rule) => rule.run),
        files,
      ),
    ),
    [],
  );
});

test('links-depth, legal-pages and routes-404 count a link to the file of a page as a link to the page', () => {
  const zimmer = page(OPTIONS, '/zimmer/');
  const viaFile = siteWith({
    'zimmer/index.html': zimmer,
    'index.html': home({ main: '<h1>Startseite des Beispiels</h1> <a href="/zimmer/index.html">Zimmer</a>' }),
  });
  assert.deepEqual(ids(run(auditLinksDepth, viaFile)), []);
  const unlinked = siteWith({ 'zimmer/index.html': zimmer });
  assert.deepEqual(ids(run(auditLinksDepth, unlinked)), ['links-depth']);
  const legal = siteWith({ 'index.html': asFiles(home()) });
  assert.deepEqual(ids(run([auditLegalPages, auditRoutes404], legal)), []);
  const notFound = siteWith({ '404.html': asFiles(notFoundPage(OPTIONS)) });
  assert.deepEqual(ids(run([auditLegalPages, auditRoutes404], notFound)), []);
  // A file that is not built is no page: the link to it does not count.
  const missing = siteWith({ '404.html': notFoundPage(OPTIONS).replace('href="/fr/"', 'href="/fr/x.html"') });
  assert.deepEqual(ids(run(auditRoutes404, missing)), ['routes-404']);
});

test('an http default alternate is hreflang-reciprocal’s alone: hreflang-x-default compares nothing then', () => {
  const fr = edit(frHome(), `hreflang="de-CH" href="${ORIGIN}/"`, 'hreflang="de-CH" href="http://example.ch/"');
  const report = run([auditHreflangReciprocal, auditHreflangXDefault], siteWith({ 'fr/index.html': fr }));
  assert.deepEqual(ids(report), ['hreflang-reciprocal']);
  const xDefault = edit(frHome(), `hreflang="x-default" href="${ORIGIN}/"`, 'hreflang="x-default" href="/"');
  const relative = run([auditHreflangReciprocal, auditHreflangXDefault], siteWith({ 'fr/index.html': xDefault }));
  assert.deepEqual(ids(relative), ['hreflang-reciprocal']);
});

test('links-generic: an icon link named by an aria-label inside passes; a generic name in hidden or block parts fails', () => {
  assert.deepEqual(
    ids(run(auditLinksGeneric, withMain('<a href="/fr/"><span role="img" aria-label="Instagram"></span></a>'))),
    [],
  );
  for (const link of [
    '<a href="/fr/"><span hidden>Alle Zimmer ansehen</span>mehr</a>',
    '<a href="/fr/"><span aria-hidden="TRUE">Alle Zimmer ansehen</span>mehr</a>',
    '<a href="/fr/"><div>Mehr</div><div>erfahren</div></a>',
  ]) {
    assert.deepEqual(ids(run(auditLinksGeneric, withMain(link))), ['links-generic'], link);
  }
});

test('links-generic and links-same-name share each link name: a big labelledby text and nested links stay fast', () => {
  const big = `<div id="big">${'Wort '.repeat(200_000)}</div>`;
  const started = performance.now();
  const labelled = run(
    [auditLinksGeneric, auditLinksSameName],
    withMain(`${big}${'<a href="/fr/" aria-labelledby="big">x</a>'.repeat(250)}`),
  );
  assert.deepEqual(ids(labelled), []);
  const repeated = run(
    [auditLinksGeneric, auditLinksSameName],
    withMain(`${big}<a href="/fr/" aria-labelledby="${'big '.repeat(200_000)}">x</a>`),
  );
  assert.deepEqual(ids(repeated), []);
  const nested = run(
    [auditLinksGeneric, auditLinksSameName],
    withMain(`${'<a href="/fr/">'.repeat(5_000)}Zimmer${'</a>'.repeat(5_000)}`),
  );
  assert.deepEqual(ids(nested), []);
  assert.ok(performance.now() - started < 5_000);
});

test('links-resolve reads redirects.json once: 300 pages of 50 links and 2,000 rows stay fast', () => {
  const links = Array.from({ length: 50 }, (_, index) => `<a href="/fr/">Seite ${index}</a>`).join(' ');
  const files: Record<string, string> = { ...site() };
  for (let index = 0; index < 300; index += 1)
    files[`p${index}/index.html`] = page(OPTIONS, `/p${index}/`, { main: `<h1>x</h1> ${links}` });
  const redirects = Array.from({ length: 2_000 }, (_, index) => ({ from: `/alt/seite-${index}`, to: '/' }));
  const started = performance.now();
  assert.deepEqual(ids(run(auditLinksResolve, files, { redirects })), []);
  assert.ok(performance.now() - started < 1_500);
  const old = run(auditLinksResolve, withMain('<a href="/alt/seite-1999/">alt</a>'), { redirects });
  assert.deepEqual(ids(old), ['links-resolve']);
});

/**
 * The head rules of the page audit (part 5b of M5, `src/audit/page/head.ts`): `head-canonical`, `head-lang`,
 * `head-title`, `head-description`, `head-og`, `head-icons`, `head-jsonld`, `headings-h1`, `headings-order` and
 * `indexing-noindex`. Each sentence of a row has a passing case and a failing case that changes one thing, on a
 * `BuildContext` built from strings with pages shaped as Astro writes them (14.1).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  auditHeadCanonical,
  auditHeadDescription,
  auditHeadIcons,
  auditHeadingsH1,
  auditHeadingsOrder,
  auditHeadJsonld,
  auditHeadLang,
  auditHeadOg,
  auditHeadTitle,
  auditIndexingNoindex,
} from '../../src/audit/page/head.ts';
import { auditFactsValue } from '../../src/audit/text.ts';
import type { BuildContext } from '../../src/context.ts';
import type { Options } from '../../src/options.ts';
import { Report } from '../../src/registry.ts';
import {
  type ContextSettings,
  contextOf,
  fileOf,
  findings,
  ICON_FILES,
  ICONS,
  ids,
  notFoundPage,
  OPTIONS,
  type PageParts,
  page,
  site,
} from './audit-fixtures.ts';
import { SITE } from './fixtures.ts';

type Rule = (ctx: BuildContext) => void;
type Files = Readonly<Record<string, string | Uint8Array>>;

/** Runs rules on a context of the files and returns its report. */
function run(rules: Rule | readonly Rule[], files: Files, settings: ContextSettings = {}): Report {
  const ctx = contextOf(files, settings);
  for (const rule of Array.isArray(rules) ? rules : [rules]) rule(ctx);
  return ctx.report;
}

/** The icon files and one fixture page at a path. */
const one = (path: string, parts: PageParts = {}, options: Options = OPTIONS): Files => ({
  ...ICON_FILES,
  [fileOf(path)]: page(options, path, parts),
});

/** The text with its one occurrence of `from` replaced. Throws when `from` is not in the text. */
function edit(html: string, from: string, to: string): string {
  const at = html.indexOf(from);
  if (at < 0) throw new Error(`audit-head: the page has no ${from}`);
  return `${html.slice(0, at)}${to}${html.slice(at + from.length)}`;
}

/** One fixture page at a path, changed by `edit`. */
const edited = (path: string, from: string, to: string, parts: PageParts = {}): Files => ({
  ...ICON_FILES,
  [fileOf(path)]: edit(page(OPTIONS, path, parts), from, to),
});

const ORIGIN = OPTIONS.site;

/** A text of `count` code points. */
const ofLength = (count: number, char = 'a'): string => char.repeat(count);

// head-canonical

test('head-canonical passes the fixture site and the smallest page with its one canonical', () => {
  assert.deepEqual(ids(run(auditHeadCanonical, site())), []);
  const smallest = { 'zimmer/index.html': `<html><head><link rel="canonical" href="${ORIGIN}/zimmer/"></head></html>` };
  assert.deepEqual(ids(run(auditHeadCanonical, smallest)), []);
});

test('head-canonical fails a page without a canonical, at the page path', () => {
  const report = run(auditHeadCanonical, edited('/zimmer/', `<link rel="canonical" href="${ORIGIN}/zimmer/">`, ''));
  assert.deepEqual(ids(report), ['head-canonical']);
  assert.deepEqual(findings(report), [
    'head-canonical /zimmer/ no canonical link; expected https://example.ch/zimmer/',
  ]);
});

test('head-canonical fails two canonicals, even when both are right', () => {
  const report = run(auditHeadCanonical, one('/zimmer/', { head: `<link rel="canonical" href="${ORIGIN}/zimmer/">` }));
  assert.deepEqual(ids(report), ['head-canonical']);
  assert.deepEqual(findings(report), [
    'head-canonical /zimmer/ 2 canonical links; expected one, https://example.ch/zimmer/',
  ]);
});

test('head-canonical fails a canonical that is not <site><path>: no final /, root-relative, http, another path', () => {
  for (const href of [`${ORIGIN}/zimmer`, '/zimmer/', 'http://example.ch/zimmer/', `${ORIGIN}/`]) {
    const report = run(auditHeadCanonical, edited('/zimmer/', `href="${ORIGIN}/zimmer/"`, `href="${href}"`));
    assert.deepEqual(ids(report), ['head-canonical'], href);
  }
  const report = run(auditHeadCanonical, edited('/zimmer/', `href="${ORIGIN}/zimmer/"`, `href="${ORIGIN}/zimmer"`));
  assert.deepEqual(findings(report), [
    'head-canonical /zimmer/ the canonical is "https://example.ch/zimmer"; expected https://example.ch/zimmer/',
  ]);
});

test('head-canonical fails a canonical link without href', () => {
  const report = run(auditHeadCanonical, edited('/zimmer/', `href="${ORIGIN}/zimmer/"`, ''));
  assert.deepEqual(ids(report), ['head-canonical']);
});

test('head-canonical fails a page whose path does not end in /: its canonical cannot end in /', () => {
  const files = { 'a.html': `<html><head><link rel="canonical" href="${ORIGIN}/a.html"></head></html>` };
  const report = run(auditHeadCanonical, files);
  assert.deepEqual(findings(report), [
    'head-canonical /a.html the canonical "https://example.ch/a.html" does not end in /',
  ]);
});

test('head-canonical exempts /404.html, which has no canonical', () => {
  assert.deepEqual(ids(run(auditHeadCanonical, { ...ICON_FILES, '404.html': notFoundPage(OPTIONS) })), []);
});

test('a wrong canonical is head-canonical alone: head-og compares og:url with <site><path>', () => {
  const files = edited(
    '/zimmer/',
    `<link rel="canonical" href="${ORIGIN}/zimmer/">`,
    `<link rel="canonical" href="${ORIGIN}/">`,
  );
  assert.deepEqual(ids(run([auditHeadCanonical, auditHeadOg], files)), ['head-canonical']);
});

// head-lang

test('head-lang passes the fixture site, 404 included', () => {
  assert.deepEqual(ids(run(auditHeadLang, site())), []);
});

test('head-lang fails a de page with lang="de": the tag of the locale is de-CH', () => {
  const report = run(auditHeadLang, one('/zimmer/', { lang: 'de' }));
  assert.deepEqual(ids(report), ['head-lang']);
  assert.deepEqual(findings(report), ['head-lang /zimmer/ lang is "de"; expected "de-CH"']);
});

test('head-lang compares the exact string: de-ch fails', () => {
  assert.deepEqual(ids(run(auditHeadLang, one('/zimmer/', { lang: 'de-ch' }))), ['head-lang']);
});

test('head-lang reads the locale from the URL: a /fr/ page with de-CH fails', () => {
  const report = run(auditHeadLang, one('/fr/chambres/', { lang: 'de-CH' }));
  assert.deepEqual(findings(report), ['head-lang /fr/chambres/ lang is "de-CH"; expected "fr-CH"']);
});

test('head-lang fails an html without lang, and a page without html', () => {
  const report = run(auditHeadLang, edited('/zimmer/', '<html lang="de-CH">', '<html>'));
  assert.deepEqual(findings(report), ['head-lang /zimmer/ <html> has no lang; expected "de-CH"']);
  const bare = run(auditHeadLang, { 'zimmer/index.html': '<p>x</p>' });
  assert.deepEqual(findings(bare), ['head-lang /zimmer/ the page has no <html> element; expected lang="de-CH"']);
});

test('head-lang reads /404.html too', () => {
  const html = edit(notFoundPage(OPTIONS), '<html lang="de-CH">', '<html lang="fr-CH">');
  assert.deepEqual(findings(run(auditHeadLang, { '404.html': html })), [
    'head-lang /404.html lang is "fr-CH"; expected "de-CH"',
  ]);
});

test('a wrong lang is head-lang alone: head-og compares og:locale with the tag of the URL locale', () => {
  assert.deepEqual(ids(run([auditHeadLang, auditHeadOg], one('/zimmer/', { lang: 'fr-CH' }))), ['head-lang']);
});

// head-title

test('head-title passes the fixture site and titles of exactly 15 and 70 code points', () => {
  assert.deepEqual(ids(run(auditHeadTitle, site())), []);
  assert.deepEqual(ids(run(auditHeadTitle, one('/zimmer/', { title: ofLength(15) }))), []);
  assert.deepEqual(ids(run(auditHeadTitle, one('/zimmer/', { title: ofLength(70) }))), []);
});

test('head-title fails 14 and 71 code points', () => {
  const short = run(auditHeadTitle, one('/zimmer/', { title: ofLength(14) }));
  assert.deepEqual(findings(short), ['head-title /zimmer/ the title has 14 code points; 15–70']);
  const long = run(auditHeadTitle, one('/zimmer/', { title: ofLength(71) }));
  assert.deepEqual(findings(long), ['head-title /zimmer/ the title has 71 code points; 15–70']);
});

test('head-title counts code points, not UTF-16 units: 69 letters and one emoji are 70', () => {
  assert.deepEqual(ids(run(auditHeadTitle, one('/zimmer/', { title: `${ofLength(69)}😀` }))), []);
  assert.deepEqual(ids(run(auditHeadTitle, one('/zimmer/', { title: `${ofLength(13)}😀` }))), ['head-title']);
});

test('head-title collapses white space before it counts', () => {
  const report = run(auditHeadTitle, one('/zimmer/', { title: `  ${ofLength(7)}   ${ofLength(6)}  ` }));
  assert.deepEqual(findings(report), ['head-title /zimmer/ the title has 14 code points; 15–70']);
});

test('head-title fails a page without a title and a page with two', () => {
  const none = run(auditHeadTitle, edited('/zimmer/', '<title>Example – die Seite /zimmer/</title>', ''));
  assert.deepEqual(findings(none), ['head-title /zimmer/ the page has no <title>']);
  const two = run(auditHeadTitle, one('/zimmer/', { head: '<title>Ein zweiter Titel der Seite</title>' }));
  assert.deepEqual(findings(two), ['head-title /zimmer/ the page has 2 <title> elements; exactly 1']);
});

test('head-title does not count the title of an inline svg', () => {
  const main = '<h1>Zimmer</h1> <svg viewBox="0 0 1 1" role="img"><title>Logo</title></svg>';
  assert.deepEqual(ids(run(auditHeadTitle, one('/zimmer/', { main }))), []);
});

test('head-title fails a title that an earlier page of the same locale has, at the later page', () => {
  const title = 'Zimmer im Hotel Example';
  const files = {
    ...one('/zimmer/', { title }),
    [fileOf('/suiten/')]: page(OPTIONS, '/suiten/', { title }),
    [fileOf('/angebote/')]: page(OPTIONS, '/angebote/', { title }),
  };
  const report = run(auditHeadTitle, files);
  assert.deepEqual(ids(report), ['head-title']);
  assert.deepEqual(findings(report), [
    'head-title /suiten/ the title "Zimmer im Hotel Example" is also the title of /angebote/',
    'head-title /zimmer/ the title "Zimmer im Hotel Example" is also the title of /angebote/',
  ]);
});

test('head-title allows the same title in two locales', () => {
  const title = 'Hotel Example – Engadin';
  const files = { ...one('/', { title }), [fileOf('/fr/')]: page(OPTIONS, '/fr/', { title }) };
  assert.deepEqual(ids(run(auditHeadTitle, files)), []);
});

test('head-title exempts /404.html', () => {
  const html = edit(notFoundPage(OPTIONS), '<title>Diese Seite gibt es nicht · Cette page n’existe pas</title>', '');
  assert.deepEqual(ids(run(auditHeadTitle, { '404.html': html })), []);
});

// head-description

test('head-description passes the fixture site and descriptions of exactly 50 and 160 code points', () => {
  assert.deepEqual(ids(run(auditHeadDescription, site())), []);
  assert.deepEqual(ids(run(auditHeadDescription, one('/zimmer/', { description: ofLength(50) }))), []);
  assert.deepEqual(ids(run(auditHeadDescription, one('/zimmer/', { description: ofLength(160) }))), []);
});

test('head-description fails 49 and 161 code points', () => {
  const short = run(auditHeadDescription, one('/zimmer/', { description: ofLength(49) }));
  assert.deepEqual(findings(short), ['head-description /zimmer/ the description has 49 code points; 50–160']);
  const long = run(auditHeadDescription, one('/zimmer/', { description: ofLength(161) }));
  assert.deepEqual(findings(long), ['head-description /zimmer/ the description has 161 code points; 50–160']);
});

test('head-description counts code points of the collapsed content', () => {
  assert.deepEqual(ids(run(auditHeadDescription, one('/zimmer/', { description: `${ofLength(48)}😀` }))), [
    'head-description',
  ]);
  assert.deepEqual(ids(run(auditHeadDescription, one('/zimmer/', { description: `${ofLength(49)}😀` }))), []);
});

test('head-description fails a page without a description, and a page with two', () => {
  const none = run(auditHeadDescription, edited('/zimmer/', 'name="description"', 'name="summary"'));
  assert.deepEqual(findings(none), ['head-description /zimmer/ the page has no meta description']);
  const head = `<meta name="Description" content="${ofLength(60)}">`;
  const two = run(auditHeadDescription, one('/zimmer/', { head }));
  assert.deepEqual(findings(two), ['head-description /zimmer/ the page has 2 meta descriptions; exactly 1']);
});

test('head-description fails a description without content as 0 code points', () => {
  const html = page(OPTIONS, '/zimmer/');
  const description =
    'content="Eine Seite des Beispiels, unter der Adresse /zimmer/, mit einem kurzen Text auf Deutsch."';
  const files = { [fileOf('/zimmer/')]: edit(html, `name="description" ${description}`, 'name="description"') };
  assert.deepEqual(findings(run(auditHeadDescription, files)), [
    'head-description /zimmer/ the description has 0 code points; 50–160',
  ]);
});

test('head-description fails a description that an earlier page of the same locale has', () => {
  const description = 'Die Zimmer und Suiten des Hotels, mit Preisen und allen Angaben zur Lage.';
  const files = {
    ...one('/zimmer/', { description }),
    [fileOf('/suiten/')]: page(OPTIONS, '/suiten/', { description }),
  };
  const report = run(auditHeadDescription, files);
  assert.deepEqual(findings(report), [
    `head-description /zimmer/ the description "${description}" is also the description of /suiten/`,
  ]);
});

test('head-description leaves the same description in two locales to content-copied', () => {
  const description = 'Die Zimmer und Suiten des Hotels, mit Preisen und allen Angaben zur Lage.';
  const files = { ...one('/', { description }), [fileOf('/fr/')]: page(OPTIONS, '/fr/', { description }) };
  assert.deepEqual(ids(run(auditHeadDescription, files)), []);
});

test('head-description exempts /404.html', () => {
  const html = edit(notFoundPage(OPTIONS), 'name="description"', 'name="summary"');
  assert.deepEqual(ids(run(auditHeadDescription, { '404.html': html })), []);
});

// head-og

/** The tags of a valid share image. */
const OG_IMAGE = `<meta property="og:image" content="${ORIGIN}/_astro/share.png"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">`;

test('head-og passes the fixture site, and a page with a share image of the site within the limit', () => {
  assert.deepEqual(ids(run(auditHeadOg, site())), []);
  const files = { ...one('/zimmer/', { head: OG_IMAGE }), '_astro/share.png': new Uint8Array(153_600) };
  assert.deepEqual(ids(run(auditHeadOg, files)), []);
});

test('head-og fails og:locale de-CH: the tag with - as _', () => {
  const report = run(auditHeadOg, edited('/zimmer/', 'content="de_CH"', 'content="de-CH"'));
  assert.deepEqual(findings(report), ['head-og /zimmer/ og:locale is "de-CH"; expected de_CH']);
});

test('head-og fails an og:url that is not <site><path>', () => {
  const report = run(auditHeadOg, edited('/zimmer/', `content="${ORIGIN}/zimmer/"`, 'content="/zimmer/"'));
  assert.deepEqual(findings(report), ['head-og /zimmer/ og:url is "/zimmer/"; expected https://example.ch/zimmer/']);
});

test('head-og fails a missing og:title and an empty og:description, in one finding with every problem', () => {
  const title = '<meta property="og:title" content="Example – die Seite /zimmer/">';
  const description =
    'content="Eine Seite des Beispiels, unter der Adresse /zimmer/, mit einem kurzen Text auf Deutsch."><meta property="og:url"';
  const html = edit(edit(page(OPTIONS, '/zimmer/'), title, ''), description, 'content=" "><meta property="og:url"');
  const report = run(auditHeadOg, { ...ICON_FILES, [fileOf('/zimmer/')]: html });
  assert.deepEqual(findings(report), ['head-og /zimmer/ no og:title; og:description is empty']);
});

test('head-og fails a page without og:url and og:locale, in one finding', () => {
  const html = edit(
    edit(page(OPTIONS, '/zimmer/'), `<meta property="og:url" content="${ORIGIN}/zimmer/">`, ''),
    '<meta property="og:locale" content="de_CH">',
    '',
  );
  const report = run(auditHeadOg, { [fileOf('/zimmer/')]: html });
  assert.deepEqual(findings(report), [
    'head-og /zimmer/ no og:url; expected https://example.ch/zimmer/; no og:locale; expected de_CH',
  ]);
});

test('head-og fails a share image without its size tags', () => {
  const head = `<meta property="og:image" content="${ORIGIN}/_astro/share.png">`;
  const files = { ...one('/zimmer/', { head }), '_astro/share.png': new Uint8Array(10) };
  assert.deepEqual(findings(run(auditHeadOg, files)), [
    'head-og /zimmer/ no og:image:width; expected 1200; no og:image:height; expected 630',
  ]);
});

test('head-og fails a share image of another size', () => {
  const head = OG_IMAGE.replace('content="1200"', 'content="1201"');
  const files = { ...one('/zimmer/', { head }), '_astro/share.png': new Uint8Array(10) };
  assert.deepEqual(findings(run(auditHeadOg, files)), ['head-og /zimmer/ og:image:width is "1201"; expected 1200']);
});

test('head-og fails a share image on another host, one that is no dist file, and one over the limit', () => {
  const other = OG_IMAGE.replace(`${ORIGIN}/`, 'https://cdn.example.org/');
  assert.deepEqual(findings(run(auditHeadOg, one('/zimmer/', { head: other }))), [
    'head-og /zimmer/ og:image "https://cdn.example.org/_astro/share.png" is not under https://example.ch/',
  ]);
  assert.deepEqual(findings(run(auditHeadOg, one('/zimmer/', { head: OG_IMAGE }))), [
    'head-og /zimmer/ og:image "https://example.ch/_astro/share.png" is no file of dist',
  ]);
  const large = { ...one('/zimmer/', { head: OG_IMAGE }), '_astro/share.png': new Uint8Array(153_601) };
  assert.deepEqual(findings(run(auditHeadOg, large)), [
    'head-og /zimmer/ og:image /_astro/share.png has 153601 B; at most 153600 B',
  ]);
});

test('head-og finds the share image file without its query, and percent-decoded', () => {
  const head = OG_IMAGE.replace('/_astro/share.png', '/_astro/sh%C3%A4re.png?v=2');
  const files = { ...one('/zimmer/', { head }), '_astro/shäre.png': new Uint8Array(10) };
  assert.deepEqual(ids(run(auditHeadOg, files)), []);
});

test('head-og exempts /404.html, which has no Open Graph tags', () => {
  assert.deepEqual(ids(run(auditHeadOg, { ...ICON_FILES, '404.html': notFoundPage(OPTIONS) })), []);
});

// head-icons

test('head-icons passes the fixture site, 404 included, and the smallest page with the three links', () => {
  assert.deepEqual(ids(run(auditHeadIcons, site())), []);
  assert.deepEqual(ids(run(auditHeadIcons, { ...ICON_FILES, 'index.html': `<html><head>${ICONS}</head></html>` })), []);
});

test('head-icons fails a page without one icon link, at the page', () => {
  const report = run(
    auditHeadIcons,
    edited('/zimmer/', '<link rel="apple-touch-icon" href="/apple-touch-icon.png">', ''),
  );
  assert.deepEqual(findings(report), ['head-icons /zimmer/ no icon link to /apple-touch-icon.png']);
});

test('head-icons reads /404.html too', () => {
  const html = edit(notFoundPage(OPTIONS), ICONS, '');
  assert.deepEqual(findings(run(auditHeadIcons, { ...ICON_FILES, '404.html': html })), [
    'head-icons /404.html no icon link to /favicon.ico, /icon.svg, /apple-touch-icon.png',
  ]);
});

test('head-icons fails a missing icon file once for the site, at the file', () => {
  const { 'icon.svg': _svg, ...files } = site();
  const report = run(auditHeadIcons, files);
  assert.deepEqual(findings(report), ['head-icons /icon.svg the file is missing from dist']);
});

test('head-icons counts rel "shortcut icon" and an absolute https href, not one with a query or another rel', () => {
  const absolute = `<link rel="shortcut icon" href="${ORIGIN}/favicon.ico">`;
  const shortcut = {
    ...ICON_FILES,
    'index.html': `<html><head>${ICONS.replace('<link rel="icon" href="/favicon.ico" sizes="32x32">', absolute)}</head></html>`,
  };
  assert.deepEqual(ids(run(auditHeadIcons, shortcut)), []);
  const query = {
    ...ICON_FILES,
    'index.html': `<html><head>${ICONS.replace('/icon.svg', '/icon.svg?v=1')}</head></html>`,
  };
  assert.deepEqual(findings(run(auditHeadIcons, query)), ['head-icons / no icon link to /icon.svg']);
  const rel = {
    ...ICON_FILES,
    'index.html': `<html><head>${ICONS.replace('rel="apple-touch-icon"', 'rel="preload"')}</head></html>`,
  };
  assert.deepEqual(findings(run(auditHeadIcons, rel)), ['head-icons / no icon link to /apple-touch-icon.png']);
});

test('head-icons checks no file on a build without pages', () => {
  assert.deepEqual(ids(run(auditHeadIcons, { 'robots.txt': 'x' })), []);
});

// head-jsonld

/** A JSON-LD block of a graph. */
const ld = (graph: readonly unknown[]): string =>
  `<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@graph': graph })}</script>`;

/** The organization node of the facts `SITE`. */
const ORGANIZATION = {
  '@type': 'Organization',
  '@id': `${ORIGIN}/#organization`,
  name: SITE.name,
  legalName: SITE.legalName,
  url: `${ORIGIN}/`,
  email: SITE.email,
};

/** The WebPage node of a page. */
const webPage = (path: string, tag = 'de-CH'): Record<string, unknown> => ({
  '@type': 'WebPage',
  '@id': `${ORIGIN}${path}#webpage`,
  url: `${ORIGIN}${path}`,
  inLanguage: tag,
});

/** A de page at `/zimmer/` with a graph. */
const graphPage = (graph: readonly unknown[], path = '/zimmer/'): Files => one(path, { jsonld: ld(graph) });

/** The facts of the test site, as `site.json` and `schedule.json` hold them. */
const TEST_SITE = {
  site: JSON.parse(readFileSync(new URL('../site/site.json', import.meta.url), 'utf8')) as unknown,
  schedule: JSON.parse(readFileSync(new URL('../site/schedule.json', import.meta.url), 'utf8')) as unknown,
};

/** The organization node of the test site, as its layout writes it into every built page. */
const HOTEL = {
  '@type': 'Hotel',
  '@id': 'https://laerchenwald.example/#organization',
  name: 'Hotel Lärchenwald',
  legalName: 'Hotel Lärchenwald AG',
  url: 'https://laerchenwald.example/',
  email: 'info@laerchenwald.example',
  telephone: '+41815550110',
  vatID: 'CHE-123.456.789 MWST',
  taxID: 'CHE-123.456.789',
  address: {
    '@type': 'PostalAddress',
    streetAddress: 'Via da Fex 7',
    postalCode: '7514',
    addressLocality: 'Sils im Engadin/Segl',
    addressRegion: 'GR',
    addressCountry: 'CH',
  },
  openingHoursSpecification: [
    {
      '@type': 'OpeningHoursSpecification',
      dayOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
      opens: '07:00',
      closes: '22:00',
    },
  ],
  specialOpeningHoursSpecification: [
    {
      '@type': 'OpeningHoursSpecification',
      validFrom: '2027-04-05',
      validThrough: '2027-06-03',
      opens: '00:00',
      closes: '00:00',
    },
  ],
};

/** A page of the test site's home with the hotel node changed. */
const hotelHome = (hotel: Record<string, unknown>): Files =>
  graphPage([hotel, webPage('/'), { '@type': 'WebSite', '@id': `${ORIGIN}/#website`, url: `${ORIGIN}/` }], '/');

test('head-jsonld passes the fixture site, and the hotel node of the test site with its facts', () => {
  assert.deepEqual(ids(run(auditHeadJsonld, site())), []);
  assert.deepEqual(ids(run(auditHeadJsonld, hotelHome(HOTEL), TEST_SITE)), []);
  // The 404 page of the test site holds the organization node alone.
  const notFound = { '404.html': notFoundPage(OPTIONS, { head: ld([HOTEL]) }) };
  assert.deepEqual(ids(run(auditHeadJsonld, notFound, TEST_SITE)), []);
});

test('head-jsonld fails a block that does not parse, with that problem alone', () => {
  const report = run(
    auditHeadJsonld,
    one('/zimmer/', { jsonld: '<script type="application/ld+json">{"@type": </script>' }),
  );
  assert.deepEqual(ids(report), ['head-jsonld']);
  assert.equal(report.findings.length, 1);
  assert.match(findings(report)[0] ?? '', /^head-jsonld \/zimmer\/ JSON-LD block 1 does not parse: /);
});

test('head-jsonld reads only application/ld+json: another data block is not parsed', () => {
  const block = '<script type="application/json">{</script>';
  assert.deepEqual(ids(run(auditHeadJsonld, one('/zimmer/', { head: block }))), []);
  const upper = '<script type=" Application/LD+JSON ">{</script>';
  assert.deepEqual(ids(run(auditHeadJsonld, one('/zimmer/', { head: upper }))), ['head-jsonld']);
});

test('head-jsonld fails a node without @type, once for the page; a node reference needs none', () => {
  const report = run(auditHeadJsonld, graphPage([ORGANIZATION, webPage('/zimmer/'), { name: 'a' }, { name: 'b' }]));
  assert.deepEqual(findings(report), ['head-jsonld /zimmer/ a node has no @type']);
  const reference = { ...webPage('/zimmer/'), publisher: { '@id': `${ORIGIN}/#organization` } };
  assert.deepEqual(ids(run(auditHeadJsonld, graphPage([ORGANIZATION, reference]))), []);
});

test('head-jsonld fails a banned type at any depth, as a term, an IRI or one of a list', () => {
  for (const type of ['Review', 'https://schema.org/HowTo', 'schema:ClaimReview', ['Thing', 'SpecialAnnouncement']]) {
    const nested = { ...webPage('/zimmer/'), about: { '@type': 'Thing', subjectOf: { '@type': type, name: 'x' } } };
    assert.deepEqual(ids(run(auditHeadJsonld, graphPage([ORGANIZATION, nested]))), ['head-jsonld'], String(type));
  }
  const report = run(
    auditHeadJsonld,
    graphPage([ORGANIZATION, { ...webPage('/zimmer/'), about: { '@type': 'Review' } }]),
  );
  assert.deepEqual(findings(report), ['head-jsonld /zimmer/ a node has the banned type Review']);
});

test('head-jsonld fails an aggregateRating or review property', () => {
  const rating = { ...ORGANIZATION, aggregateRating: { '@type': 'Rating', ratingValue: 5 } };
  assert.deepEqual(findings(run(auditHeadJsonld, graphPage([rating, webPage('/zimmer/')]))), [
    'head-jsonld /zimmer/ a node has the banned property aggregateRating',
  ]);
  const review = { ...webPage('/zimmer/'), mainEntity: { '@type': 'Product', review: 'gut' } };
  assert.deepEqual(ids(run(auditHeadJsonld, graphPage([ORGANIZATION, review]))), ['head-jsonld']);
});

test('head-jsonld fails a second organization @id once for the site, at the first page that has it', () => {
  const other = { ...ORGANIZATION, '@id': `${ORIGIN}/#org` };
  const files = {
    ...graphPage([ORGANIZATION, webPage('/a/')], '/a/'),
    [fileOf('/b/')]: page(OPTIONS, '/b/', { jsonld: ld([other, webPage('/b/')]) }),
    [fileOf('/c/')]: page(OPTIONS, '/c/', { jsonld: ld([other, webPage('/c/')]) }),
  };
  const report = run(auditHeadJsonld, files);
  assert.deepEqual(findings(report), [
    'head-jsonld /b/ the organization @id is "https://example.ch/#org"; /a/ has "https://example.ch/#organization"',
  ]);
});

test('head-jsonld fails an organization node without @id', () => {
  const { '@id': _id, ...anonymous } = ORGANIZATION;
  assert.deepEqual(findings(run(auditHeadJsonld, graphPage([anonymous, webPage('/zimmer/')]))), [
    'head-jsonld /zimmer/ the organization node has no @id',
  ]);
});

test('head-jsonld fails an organization telephone that differs from site.json, and passes one formatted', () => {
  const report = run(auditHeadJsonld, hotelHome({ ...HOTEL, telephone: '+41815550111' }), TEST_SITE);
  assert.deepEqual(findings(report), [
    'head-jsonld / the organization telephone is "+41815550111"; site.json has "+41815550110"',
  ]);
  for (const telephone of ['+41 81 555 01 10', '0041 81 555 01 10', '081 555 01 10', 'tel:+41815550110']) {
    assert.deepEqual(ids(run(auditHeadJsonld, hotelHome({ ...HOTEL, telephone }), TEST_SITE)), [], telephone);
  }
});

test('head-jsonld compares name, legalName, vatID and taxID exactly, and email in lower case', () => {
  for (const [name, value] of [
    ['name', 'Hotel Laerchenwald'],
    ['legalName', 'Hotel Lärchenwald'],
    ['vatID', 'CHE-123.456.789'],
    ['taxID', 'CHE-123.456.780'],
    ['email', 'info@example.ch'],
  ] as const) {
    assert.deepEqual(
      ids(run(auditHeadJsonld, hotelHome({ ...HOTEL, [name]: value }), TEST_SITE)),
      ['head-jsonld'],
      name,
    );
  }
  assert.deepEqual(
    ids(run(auditHeadJsonld, hotelHome({ ...HOTEL, email: 'Info@Laerchenwald.example' }), TEST_SITE)),
    [],
  );
});

test('head-jsonld fails a fact that site.json does not hold, and a fact that is not text', () => {
  const report = run(auditHeadJsonld, graphPage([{ ...ORGANIZATION, telephone: '+41441234567' }, webPage('/zimmer/')]));
  assert.deepEqual(findings(report), [
    'head-jsonld /zimmer/ the organization telephone "+41441234567" is not in site.json',
  ]);
  const list = run(auditHeadJsonld, graphPage([{ ...ORGANIZATION, name: ['Example'] }, webPage('/zimmer/')]));
  assert.deepEqual(findings(list), ['head-jsonld /zimmer/ the organization name is not text']);
});

test('head-jsonld checks the address field by field; a text address or a Country object', () => {
  const address = { ...HOTEL.address, streetAddress: 'Via da Fex 8' };
  assert.deepEqual(findings(run(auditHeadJsonld, hotelHome({ ...HOTEL, address }), TEST_SITE)), [
    'head-jsonld / the organization streetAddress is "Via da Fex 8"; site.json has "Via da Fex 7"',
  ]);
  const text = run(auditHeadJsonld, hotelHome({ ...HOTEL, address: 'Via da Fex 7, 7514 Sils' }), TEST_SITE);
  assert.deepEqual(findings(text), ['head-jsonld / the organization address is not a PostalAddress object']);
  const country = { ...HOTEL.address, addressCountry: { '@type': 'Country', name: 'CH' }, postalCode: 7514 };
  assert.deepEqual(ids(run(auditHeadJsonld, hotelHome({ ...HOTEL, address: country }), TEST_SITE)), []);
  const none = run(auditHeadJsonld, graphPage([{ ...ORGANIZATION, address: HOTEL.address }, webPage('/zimmer/')]));
  assert.deepEqual(findings(none), ['head-jsonld /zimmer/ the organization states an address, but site.json has none']);
});

test('head-jsonld compares the opening hours as a set of days: one row for each day equals one for the week', () => {
  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const perDay = days.map((day) => ({
    '@type': 'OpeningHoursSpecification',
    dayOfWeek: `https://schema.org/${day}`,
    opens: '07:00:00',
    closes: '22:00',
  }));
  assert.deepEqual(
    ids(run(auditHeadJsonld, hotelHome({ ...HOTEL, openingHoursSpecification: perDay }), TEST_SITE)),
    [],
  );
  const late = [{ ...HOTEL.openingHoursSpecification[0], closes: '23:00' }];
  assert.deepEqual(
    findings(run(auditHeadJsonld, hotelHome({ ...HOTEL, openingHoursSpecification: late }), TEST_SITE)),
    [
      'head-jsonld / the organization openingHoursSpecification states "Monday 07:00–23:00", which schedule.json openingHours does not',
    ],
  );
  const fewer = [{ ...HOTEL.openingHoursSpecification[0], dayOfWeek: days.slice(0, 6) }];
  assert.deepEqual(
    findings(run(auditHeadJsonld, hotelHome({ ...HOTEL, openingHoursSpecification: fewer }), TEST_SITE)),
    [
      'head-jsonld / the organization openingHoursSpecification lacks "Sunday 07:00–22:00" of schedule.json openingHours',
    ],
  );
});

test('head-jsonld compares the closures as day ranges from 00:00 to 00:00', () => {
  const special = [{ ...HOTEL.specialOpeningHoursSpecification[0], opens: '08:00' }];
  assert.deepEqual(
    findings(run(auditHeadJsonld, hotelHome({ ...HOTEL, specialOpeningHoursSpecification: special }), TEST_SITE)),
    [
      'head-jsonld / the organization specialOpeningHoursSpecification states "2027-04-05–2027-06-03 08:00–00:00", which schedule.json closures does not',
    ],
  );
  const missing = run(auditHeadJsonld, hotelHome({ ...HOTEL, specialOpeningHoursSpecification: [] }), TEST_SITE);
  assert.deepEqual(findings(missing), [
    'head-jsonld / the organization specialOpeningHoursSpecification lacks "2027-04-05–2027-06-03 00:00–00:00" of schedule.json closures',
  ]);
});

test('head-jsonld fails a sameAs that site.json sameAs does not hold; a subset passes', () => {
  const facts = { site: { ...SITE, sameAs: ['https://a.example/x', 'https://b.example/y'] } };
  const subset = graphPage([{ ...ORGANIZATION, sameAs: ['https://b.example/y'] }, webPage('/zimmer/')]);
  assert.deepEqual(ids(run(auditHeadJsonld, subset, facts)), []);
  const other = graphPage([{ ...ORGANIZATION, sameAs: 'https://c.example/z' }, webPage('/zimmer/')]);
  assert.deepEqual(findings(run(auditHeadJsonld, other, facts)), [
    'head-jsonld /zimmer/ the organization sameAs "https://c.example/z" is not in site.json sameAs',
  ]);
});

test('head-jsonld reads the organization node by Organization or the site.json type', () => {
  // The test site's type is Hotel: a Hotel node is the organization node and is checked.
  assert.deepEqual(ids(run(auditHeadJsonld, hotelHome({ ...HOTEL, name: 'x' }), TEST_SITE)), ['head-jsonld']);
  // With the default type Organization, a Hotel node is no organization node.
  assert.deepEqual(
    ids(run(auditHeadJsonld, graphPage([ORGANIZATION, { ...HOTEL, name: 'x' }, webPage('/zimmer/')]))),
    [],
  );
});

test('head-jsonld passes an Offer price in major units of a site.json price, and fails another', () => {
  const facts = { site: { ...SITE, prices: [{ id: 'room', amount: 32000, currency: 'CHF' }] } };
  for (const price of ['320', '320.00', '320.0', 320, 320.0]) {
    const offer = { '@type': 'Offer', price, priceCurrency: 'CHF' };
    assert.deepEqual(
      ids(run(auditHeadJsonld, graphPage([ORGANIZATION, webPage('/zimmer/'), offer]), facts)),
      [],
      String(price),
    );
  }
  for (const price of ['330', '320,00', 'CHF 320', '32000', 3.2, -320]) {
    const offer = { '@type': 'Offer', price };
    assert.deepEqual(
      ids(run(auditHeadJsonld, graphPage([ORGANIZATION, webPage('/zimmer/'), offer]), facts)),
      ['head-jsonld'],
      String(price),
    );
  }
  const euro = { '@type': 'Offer', price: '320', priceCurrency: 'EUR' };
  const report = run(auditHeadJsonld, graphPage([ORGANIZATION, webPage('/zimmer/'), euro]), facts);
  assert.deepEqual(findings(report), [
    'head-jsonld /zimmer/ an Offer price "320" is no price amount of site.json in major units',
  ]);
});

test('head-jsonld fails a WebPage inLanguage that is not the tag of the URL locale, or none', () => {
  assert.deepEqual(findings(run(auditHeadJsonld, graphPage([ORGANIZATION, webPage('/zimmer/', 'fr-CH')]))), [
    'head-jsonld /zimmer/ a WebPage inLanguage is "fr-CH"; expected "de-CH"',
  ]);
  const { inLanguage: _language, ...bare } = webPage('/zimmer/');
  assert.deepEqual(findings(run(auditHeadJsonld, graphPage([ORGANIZATION, { ...bare, '@type': 'AboutPage' }]))), [
    'head-jsonld /zimmer/ a WebPage has no inLanguage; expected "de-CH"',
  ]);
  assert.deepEqual(
    ids(run(auditHeadJsonld, graphPage([ORGANIZATION, webPage('/fr/chambres/', 'fr-CH')], '/fr/chambres/'))),
    [],
  );
});

test('head-jsonld fails a WebSite node on a page that is no locale home', () => {
  const website = { '@type': 'WebSite', '@id': `${ORIGIN}/#website`, url: `${ORIGIN}/` };
  assert.deepEqual(findings(run(auditHeadJsonld, graphPage([ORGANIZATION, webPage('/zimmer/'), website]))), [
    'head-jsonld /zimmer/ a WebSite node on a page that is no locale home',
  ]);
  assert.deepEqual(ids(run(auditHeadJsonld, graphPage([ORGANIZATION, webPage('/fr/', 'fr-CH'), website], '/fr/'))), []);
});

test('head-jsonld reads keys named __proto__ and constructor as properties, and never throws on them', () => {
  const block =
    '<script type="application/ld+json">{"@type": "Thing", "constructor": {"__proto__": {"@type": "Review"}}, "name": "\\ud800"}</script>';
  assert.deepEqual(findings(run(auditHeadJsonld, one('/zimmer/', { jsonld: block }))), [
    'head-jsonld /zimmer/ a node has no @type',
    'head-jsonld /zimmer/ a node has the banned type Review',
  ]);
});

test('head-jsonld reads /404.html too', () => {
  const files = { '404.html': notFoundPage(OPTIONS, { head: ld([{ ...ORGANIZATION, '@type': 'Review' }]) }) };
  assert.deepEqual(findings(run(auditHeadJsonld, files)), ['head-jsonld /404.html a node has the banned type Review']);
});

test('a wrong fact in JSON-LD is head-jsonld alone: JSON-LD is no page text of facts-value', () => {
  const files = hotelHome({ ...HOTEL, telephone: '+41815550199', email: 'x@laerchenwald.example' });
  assert.deepEqual(ids(run([auditHeadJsonld, auditFactsValue], files, TEST_SITE)), ['head-jsonld']);
});

// headings-h1

test('headings-h1 passes the fixture site, 404 included, and the smallest page', () => {
  assert.deepEqual(ids(run(auditHeadingsH1, site())), []);
  assert.deepEqual(ids(run(auditHeadingsH1, { 'index.html': '<html><body><h1>Start</h1></body></html>' })), []);
});

test('headings-h1 fails a page without h1 and a page with two', () => {
  assert.deepEqual(findings(run(auditHeadingsH1, one('/zimmer/', { main: '<h2>Zimmer</h2>' }))), [
    'headings-h1 /zimmer/ the page has 0 h1 elements; exactly 1',
  ]);
  assert.deepEqual(findings(run(auditHeadingsH1, one('/zimmer/', { main: '<h1>A</h1> <h1>B</h1>' }))), [
    'headings-h1 /zimmer/ the page has 2 h1 elements; exactly 1',
  ]);
});

test('headings-h1 reads /404.html too', () => {
  const files = { '404.html': notFoundPage(OPTIONS, { main: '<h2>Nicht gefunden</h2>' }) };
  assert.deepEqual(ids(run(auditHeadingsH1, files)), ['headings-h1']);
});

// headings-order

test('headings-order passes the fixture site and steps of one level down and any level up', () => {
  assert.deepEqual(ids(run(auditHeadingsOrder, site())), []);
  const main = '<h1>A</h1> <h2>B</h2> <h3>C</h3> <h4>D</h4> <h2>E</h2> <h3>F</h3> <h2>G</h2>';
  assert.deepEqual(ids(run(auditHeadingsOrder, one('/zimmer/', { main }))), []);
});

test('headings-order fails an h4 right after an h2', () => {
  const report = run(auditHeadingsOrder, one('/zimmer/', { main: '<h1>A</h1> <h2>B</h2> <h4>Preise  pro Nacht</h4>' }));
  assert.deepEqual(findings(report), ['headings-order /zimmer/ h4 "Preise pro Nacht" follows h2']);
});

test('headings-order reports one finding for each page, with the first wrong step and the count', () => {
  const main = '<h1>A</h1> <h3>B</h3> <h2>C</h2> <h5>D</h5>';
  assert.deepEqual(findings(run(auditHeadingsOrder, one('/zimmer/', { main }))), [
    'headings-order /zimmer/ h3 "B" follows h1; 2 steps skip a level',
  ]);
});

test('headings-order fails a page whose h1 is not its first heading', () => {
  const report = run(
    [auditHeadingsH1, auditHeadingsOrder],
    one('/zimmer/', { main: '<h2>Vorab</h2> <h1>Zimmer</h1>' }),
  );
  assert.deepEqual(findings(report), ['headings-order /zimmer/ the first heading is h2 "Vorab", not h1']);
});

test('headings-order leaves a page without h1 to headings-h1, and checks only its steps', () => {
  const steps = run([auditHeadingsH1, auditHeadingsOrder], one('/zimmer/', { main: '<h2>A</h2> <h3>B</h3>' }));
  assert.deepEqual(ids(steps), ['headings-h1']);
  const skip = run([auditHeadingsH1, auditHeadingsOrder], one('/zimmer/', { main: '<h2>A</h2> <h4>B</h4>' }));
  assert.deepEqual(ids(skip), ['headings-h1', 'headings-order']);
});

test('headings-order reads /404.html too', () => {
  const files = { '404.html': notFoundPage(OPTIONS, { main: '<h1>A</h1> <h3>B</h3>' }) };
  assert.deepEqual(findings(run(auditHeadingsOrder, files)), ['headings-order /404.html h3 "B" follows h1']);
});

// indexing-noindex

test('indexing-noindex passes the fixture site: only /404.html carries noindex', () => {
  assert.deepEqual(ids(run(auditIndexingNoindex, site())), []);
});

test('indexing-noindex fails a normal page with noindex, or with none, in any case', () => {
  for (const content of ['noindex', 'NOINDEX, follow', 'none']) {
    const files = one('/zimmer/', { head: `<meta name="Robots" content="${content}">` });
    assert.deepEqual(
      findings(run(auditIndexingNoindex, files)),
      ['indexing-noindex /zimmer/ the page carries robots noindex'],
      content,
    );
  }
  assert.deepEqual(
    ids(run(auditIndexingNoindex, one('/zimmer/', { head: '<meta name="robots" content="nofollow">' }))),
    [],
  );
});

test('indexing-noindex fails /404.html without noindex', () => {
  const html = edit(notFoundPage(OPTIONS), '<meta name="robots" content="noindex">', '');
  assert.deepEqual(findings(run(auditIndexingNoindex, { '404.html': html })), [
    'indexing-noindex /404.html the 404 page has no robots noindex',
  ]);
});

test('indexing-noindex leaves a missing /404.html to routes-404', () => {
  const { '404.html': _notFound, ...files } = site();
  assert.deepEqual(ids(run(auditIndexingNoindex, files)), []);
});

// Hostile input

/** A page of about 2 MB: a long title and description, many sections and headings, and a large JSON-LD block. */
function largePage(): string {
  const sections = '<section><h2>Abschnitt</h2> <p>Text des Abschnitts mit einigen Wörtern.</p></section>'.repeat(
    20_000,
  );
  const nodes = Array.from({ length: 5_000 }, (_, index) => ({
    '@type': 'Thing',
    name: `n${index}`,
    about: { '@id': 'x' },
  }));
  return page(OPTIONS, '/gross/', {
    title: ofLength(100_000),
    description: ofLength(100_000),
    jsonld: ld([ORGANIZATION, webPage('/gross/'), ...nodes]),
    main: `<h1>Gross</h1> ${sections}`,
  });
}

/** A page that nests 5,000 elements deep, with headings, titles in svg and JSON-LD nested as deep. */
function deepPage(): string {
  const depth = 5_000;
  const main = `<h1>Tief</h1>${'<div><h3>x</h3>'.repeat(depth)}${'</div>'.repeat(depth)}${'<svg><title>t</title>'.repeat(depth)}${'</svg>'.repeat(depth)}`;
  const nested = `<script type="application/ld+json">${'['.repeat(100_000)}${']'.repeat(100_000)}</script>`;
  return page(OPTIONS, '/tief/', { main, head: nested });
}

/** A page with attributes named constructor and __proto__, a lone surrogate and U+0000 in text and attributes. */
function oddPage(): string {
  const head = [
    `<link constructor="x" rel="canonical" href="${ORIGIN}/odd/">`,
    '<meta __proto__="x" property="og:image" content="\ud800\u0000">',
    '<meta name="description" constructor="y" content="\ud800 \u0000 description of an odd page with odd bytes.">',
    '<script type="application/ld+json">{"__proto__": {"@type": "Review"}, "constructor": 1, "@type": "Thing", "name": "\\ud800\\u0000"}</script>',
    '<script type="application/ld+json">\u0000</script>',
  ].join('');
  const main = '<h1 constructor="1" __proto__="2" hasOwnProperty="3">\ud800\u0000</h1> <h4 toString="x">\u0000</h4>';
  return edit(
    page(OPTIONS, '/odd/', { head, main, title: `Odd \ud800\u0000 title of a page` }),
    '<html lang',
    '<html constructor="z" lang',
  );
}

const HOSTILE: Files = {
  ...ICON_FILES,
  'gross/index.html': largePage(),
  'tief/index.html': deepPage(),
  'odd/index.html': oddPage(),
};

const RULES: readonly (readonly [string, Rule])[] = [
  ['head-canonical', auditHeadCanonical],
  ['head-lang', auditHeadLang],
  ['head-title', auditHeadTitle],
  ['head-description', auditHeadDescription],
  ['head-og', auditHeadOg],
  ['head-icons', auditHeadIcons],
  ['head-jsonld', auditHeadJsonld],
  ['headings-h1', auditHeadingsH1],
  ['headings-order', auditHeadingsOrder],
  ['indexing-noindex', auditIndexingNoindex],
];

/** The hostile pages, parsed once: each case runs its rule on fresh reports of the same pages. */
const hostile = contextOf(HOSTILE);

/** What each rule finds on the hostile pages. */
const HOSTILE_IDS: ReadonlyMap<string, readonly string[]> = new Map([
  ['head-canonical', ['head-canonical']],
  ['head-lang', []],
  ['head-title', ['head-title']],
  ['head-description', ['head-description']],
  ['head-og', ['head-og']],
  ['head-icons', []],
  ['head-jsonld', ['head-jsonld']],
  ['headings-h1', []],
  ['headings-order', ['headings-order']],
  ['indexing-noindex', []],
]);

for (const [id, rule] of RULES) {
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

// Review cases of part 5b

/** A JSON-LD block written out as text: an array that nests `depth` deep, which `JSON.stringify` cannot write. */
const deepArray = (depth: number): string => `${'['.repeat(depth)}${']'.repeat(depth)}`;

/** The organization node of `SITE` with one more property, as JSON text. */
const organizationWith = (property: string, value: string): string =>
  `{"@type":"Organization","@id":"${ORIGIN}/#organization","name":${JSON.stringify(SITE.name)},${JSON.stringify(property)}:${value}}`;

const blockOf = (nodes: readonly string[]): string =>
  `<script type="application/ld+json">{"@context":"https://schema.org","@graph":[${nodes.join(',')}]}</script>`;

test('head-jsonld fails a value that nests 5,000 deep in sameAs, a price, inLanguage or the hours, and never throws', () => {
  const deep = deepArray(5000);
  const cases = [
    blockOf([organizationWith('sameAs', deep)]),
    blockOf([`{"@type":"Offer","price":${deep}}`]),
    blockOf([`{"@type":"WebPage","inLanguage":${deep}}`]),
    blockOf([
      organizationWith('openingHoursSpecification', `[{"dayOfWeek":${deep},"opens":${deep},"closes":"18:00"}]`),
    ]),
    blockOf([organizationWith('specialOpeningHoursSpecification', `[{"validFrom":${deep},"validThrough":${deep}}]`)]),
  ];
  for (const block of cases) {
    assert.deepEqual(
      ids(run(auditHeadJsonld, one('/zimmer/', { jsonld: block }))),
      ['head-jsonld'],
      block.slice(0, 120),
    );
  }
});

test('head-jsonld fails an ImageGallery, a VideoGallery or a MediaGallery without inLanguage: WebPage subtypes', () => {
  for (const type of ['ImageGallery', 'VideoGallery', 'MediaGallery']) {
    const node = { ...webPage('/zimmer/'), '@type': type };
    assert.deepEqual(ids(run(auditHeadJsonld, graphPage([ORGANIZATION, node]))), [], type);
    const without = { '@type': type, '@id': `${ORIGIN}/zimmer/#webpage`, url: `${ORIGIN}/zimmer/` };
    assert.deepEqual(ids(run(auditHeadJsonld, graphPage([ORGANIZATION, without]))), ['head-jsonld'], type);
  }
});

test('head-canonical, head-og and head-description read only the children of head: one in body counts as none', () => {
  const canonical = `<link rel="canonical" href="${ORIGIN}/zimmer/">`;
  const moved = (tag: string): Files => {
    const html = page(OPTIONS, '/zimmer/');
    return {
      ...ICON_FILES,
      [fileOf('/zimmer/')]: edit(edit(html, tag, ''), '<main id="content">', `<main id="content">${tag}`),
    };
  };
  assert.deepEqual(ids(run(auditHeadCanonical, moved(canonical))), ['head-canonical']);
  const title = '<meta property="og:title" content="Example – die Seite /zimmer/">';
  assert.deepEqual(ids(run(auditHeadOg, moved(title))), ['head-og']);
  const description =
    '<meta name="description" content="Eine Seite des Beispiels, unter der Adresse /zimmer/, mit einem kurzen Text auf Deutsch.">';
  assert.deepEqual(ids(run(auditHeadDescription, moved(description))), ['head-description']);
  // A second one in body is no second one either.
  const twice = {
    ...ICON_FILES,
    [fileOf('/zimmer/')]: page(OPTIONS, '/zimmer/', { main: `<h1>x</h1>${canonical}${title}` }),
  };
  assert.deepEqual(ids(run([auditHeadCanonical, auditHeadOg], twice)), []);
});

test('head-og: when og:title appears twice, the first tag counts, in both orders', () => {
  const title = '<meta property="og:title" content="Example – die Seite /zimmer/">';
  const emptyFirst = edited('/zimmer/', title, `<meta property="og:title" content="">${title}`);
  assert.deepEqual(findings(run(auditHeadOg, emptyFirst)), ['head-og /zimmer/ og:title is empty']);
  const emptyLast = edited('/zimmer/', title, `${title}<meta property="og:title" content="">`);
  assert.deepEqual(ids(run(auditHeadOg, emptyLast)), []);
});

test('head-og checks every og:image: a valid first one and a second on another host fail, naming the second', () => {
  const second = '<meta property="og:image" content="https://cdn.example/share.png">';
  const files = { ...one('/zimmer/', { head: `${OG_IMAGE}${second}` }), '_astro/share.png': new Uint8Array(10) };
  assert.deepEqual(findings(run(auditHeadOg, files)), [
    `head-og /zimmer/ og:image "https://cdn.example/share.png" is not under ${ORIGIN}/`,
  ]);
  const valid = { ...one('/zimmer/', { head: OG_IMAGE }), '_astro/share.png': new Uint8Array(10) };
  assert.deepEqual(ids(run(auditHeadOg, valid)), []);
});

test('indexing-noindex fails noindex in a robots meta of googlebot, googlebot-news or bingbot', () => {
  for (const name of ['googlebot', 'GoogleBot-News', 'bingbot']) {
    const files = one('/zimmer/', { head: `<meta name="${name}" content="noindex">` });
    assert.deepEqual(ids(run(auditIndexingNoindex, files)), ['indexing-noindex'], name);
  }
  assert.deepEqual(
    ids(run(auditIndexingNoindex, one('/zimmer/', { head: '<meta name="googlebot" content="nosnippet">' }))),
    [],
  );
  assert.deepEqual(
    ids(run(auditIndexingNoindex, one('/zimmer/', { head: '<meta name="otherbot" content="noindex">' }))),
    [],
  );
});

test('indexing-noindex: /404.html needs noindex in meta[name=robots]; googlebot alone is not every crawler', () => {
  const only = notFoundPage(OPTIONS).replace(
    '<meta name="robots" content="noindex">',
    '<meta name="googlebot" content="noindex">',
  );
  assert.deepEqual(ids(run(auditIndexingNoindex, { '404.html': only })), ['indexing-noindex']);
  assert.deepEqual(ids(run(auditIndexingNoindex, { '404.html': notFoundPage(OPTIONS) })), []);
});

test('headings read no template content: an h1 only in a template fails, an extra h1 in a template passes', () => {
  const only = one('/zimmer/', { main: '<template><h1>Vorlage</h1></template> <h2>Zimmer</h2>' });
  assert.deepEqual(ids(run([auditHeadingsH1, auditHeadingsOrder], only)), ['headings-h1']);
  const extra = one('/zimmer/', {
    main: '<h1>Zimmer</h1> <template><h1>Vorlage</h1><h4>x</h4></template> <h2>Preise</h2>',
  });
  assert.deepEqual(ids(run([auditHeadingsH1, auditHeadingsOrder], extra)), []);
});

test('headings read the content of pre as markup, and the content of textarea as text', () => {
  const pre = one('/zimmer/', { main: '<h1>Zimmer</h1> <pre><h3>Code</h3></pre>' });
  assert.deepEqual(ids(run(auditHeadingsOrder, pre)), ['headings-order']);
  const textarea = one('/zimmer/', {
    main: '<h1>Zimmer</h1> <label>Text <textarea><h4>t</h4></textarea></label> <h2>B</h2>',
  });
  assert.deepEqual(ids(run([auditHeadingsH1, auditHeadingsOrder], textarea)), []);
});

test('head-jsonld: an organization with 200,000 sameAs entries fails once and never throws', () => {
  const entries = Array.from({ length: 200_000 }, (_, index) => `"https://x.example/${index}"`).join(',');
  const report = run(
    auditHeadJsonld,
    one('/zimmer/', { jsonld: blockOf([organizationWith('sameAs', `[${entries}]`)]) }),
  );
  assert.deepEqual(ids(report), ['head-jsonld']);
});

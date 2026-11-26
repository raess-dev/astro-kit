/**
 * The shared helpers of the build audits (`src/audit/dom.ts`): attributes, the page read once, text, accessible
 * names, labels, the CSP meta, scripts, robots, the site index, links and hreflang alternates. The fixture pages of
 * `audit-fixtures.ts` are tested here too, so that every group starts from pages that hold what they claim.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { HTMLElement } from 'node-html-parser';
import {
  accessibleName,
  alternateIn,
  alternatesOf,
  ancestorsOf,
  attr,
  attributesOf,
  closestTag,
  collapse,
  cspMetasOf,
  decodePath,
  descendantsOf,
  domOf,
  hasAttr,
  hasNoindex,
  isCspMeta,
  isExecutableScript,
  isIndexable,
  labelsOf,
  legalText,
  linkedPages,
  linksOf,
  localeOf,
  localeOfLang,
  MAX_NAME,
  nameKey,
  normalizeSpaces,
  pageText,
  parseCsp,
  rawContentOf,
  resolveHref,
  robotsOf,
  sameLang,
  sameLangText,
  scriptKind,
  siteOf,
  sourceOf,
  sourcesOf,
  tagOf,
  textOf,
  tokensOf,
  wordsOf,
} from '../../src/audit/dom.ts';
import type { BuiltPage } from '../../src/context.ts';
import { SPECULATION_HASH } from '../../src/csp.ts';
import { modeHash } from '../../src/modes.ts';
import {
  contextOf,
  cspContent,
  NO_DESIGN,
  notFoundPage,
  OPTIONS,
  PAGE_CSS,
  page,
  SWITCH_OPTIONS,
  site,
} from './audit-fixtures.ts';

// Helpers. None asserts.

/** The one page of a context of one HTML text at `index.html`. */
function onePage(html: string): BuiltPage {
  const ctx = contextOf({ 'index.html': html });
  const found = ctx.pages[0];
  if (found === undefined) throw new Error('no page');
  return found;
}

/** A page whose body is `body`. */
const bodyPage = (body: string, head = ''): BuiltPage =>
  onePage(`<!DOCTYPE html><html lang="de-CH"> <head>${head}</head> <body>${body}</body> </html>`);

/** The first element with a tag on a page. */
function first(target: BuiltPage, tag: string): HTMLElement {
  const found = domOf(target).byTag(tag)[0];
  if (found === undefined) throw new Error(`no ${tag}`);
  return found;
}

// Attributes

test('attributesOf reads names in lower case, decodes values, keeps the first of a name, and takes any name', () => {
  const link = first(bodyPage('<a HREF="/a?x=1&amp;y=2" href="/b" constructor="c" hasOwnProperty>t</a>'), 'a');
  assert.deepEqual(
    [...attributesOf(link)],
    [
      ['href', '/a?x=1&y=2'],
      ['constructor', 'c'],
      ['hasownproperty', ''],
    ],
  );
  assert.equal(attr(link, 'href'), '/a?x=1&y=2');
  assert.equal(attr(link, 'title'), undefined);
  assert.equal(hasAttr(link, 'hasownproperty'), true);
  assert.equal(hasAttr(link, 'toString'), false);
  assert.deepEqual(tokensOf(first(bodyPage('<link rel="Alternate  ICON">'), 'link'), 'rel'), ['alternate', 'icon']);
  assert.equal(tagOf(link), 'a');
});

// The page, read once

test('domOf lists elements in document order, with depth, nearest lang, ids and labels', () => {
  const target = bodyPage(
    '<div id="a" lang="en"><p id="b">x</p><p id="b" lang="">y</p></div><label for="c">C</label><input id="c">',
  );
  const dom = domOf(target);
  assert.equal(dom, domOf(target), 'cached');
  assert.deepEqual(
    dom.elements.map((element) => tagOf(element)),
    ['html', 'head', 'body', 'div', 'p', 'p', 'label', 'input'],
  );
  assert.equal(dom.depth(first(target, 'html')), 1);
  assert.equal(dom.depth(first(target, 'p')), 4);
  const [p1, p2] = dom.byTag('p');
  assert.ok(p1 !== undefined && p2 !== undefined);
  assert.equal(dom.lang(p1), 'en');
  assert.equal(dom.lang(p2), '');
  assert.equal(dom.lang(first(target, 'input')), 'de-CH');
  assert.equal(dom.byId.get('b'), p1, 'the first element with an id');
  assert.equal(dom.labelsFor('c').length, 1);
  assert.equal(dom.order(p2), 5);
  assert.equal(dom.main, undefined);
  assert.deepEqual(
    dom.texts.filter((run) => run.text.trim() !== '').map((run) => [run.text, run.lang]),
    [
      ['x', 'en'],
      ['y', ''],
      ['C', 'de-CH'],
    ],
  );
});

test('the page helpers do not recurse: a page that nests 5,000 elements deep reads without a throw', () => {
  const depth = 5000;
  const target = bodyPage(`<main>${'<div>'.repeat(depth)}<a href="/x/">tief</a>${'</div>'.repeat(depth)}</main>`);
  const dom = domOf(target);
  assert.equal(dom.depth(first(target, 'a')), depth + 4);
  assert.equal(pageText(target), 'tief');
  assert.equal(legalText(target), 'tief');
  assert.equal(accessibleName(dom, first(target, 'a')), 'tief');
  assert.equal(ancestorsOf(first(target, 'a')).length, depth + 3);
  assert.equal(descendantsOf(first(target, 'main')).length, depth + 1);
  assert.equal(closestTag(first(target, 'a'), new Set(['main'])), dom.main);
});

// Text

test('collapse, normalizeSpaces and wordsOf follow the Measurement details', () => {
  assert.equal(collapse('  a \n\t b  '), 'a b');
  assert.equal(normalizeSpaces('CHF 180  .–'), 'CHF 180 .–');
  assert.deepEqual(wordsOf("L’hôtel d'Engadin: it's 3 x-y"), ['L’hôtel', "d'Engadin", "it's", 'x', 'y']);
  assert.deepEqual(wordsOf("' a'"), ['a']);
  assert.equal(sameLang('de-ch', 'de-CH'), true);
  assert.equal(sameLang('de', 'de-CH'), false);
});

test('textOf gives the textContent: decoded text, raw script and style text, a br as a line feed', () => {
  const target = bodyPage('<p>a&amp;b<br>c<script>x &amp; y</script><style>p{}</style></p>');
  assert.equal(textOf(first(target, 'p')), 'a&b\ncx &amp; yp{}');
  assert.equal(textOf(first(target, 'p'), { skip: (element) => tagOf(element) === 'script' }), 'a&b\ncp{}');
});

test('pageText is the body text in NFC with white space collapsed, legalText the text of main', () => {
  const target = bodyPage('<header>Kopf</header> <main> Café \n Text </main>');
  assert.equal(pageText(target), 'Kopf Café Text');
  assert.equal(legalText(target), 'Café Text');
  assert.equal(pageText(onePage('<html><head><title>T</title></head></html>')), '');
});

test('sameLangText leaves out the subtrees with another lang, and keeps those with the same lang', () => {
  const target = bodyPage('<p>Ein Satz <q lang="en">a quote</q> <span lang="DE-ch">und mehr</span></p>');
  assert.equal(collapse(sameLangText(domOf(target), first(target, 'p'))), 'Ein Satz und mehr');
});

// Names and labels

test('accessibleName follows the order of the Measurement details', () => {
  const name = (body: string): string => {
    const target = bodyPage(body);
    return accessibleName(domOf(target), first(target, 'a'));
  };
  assert.equal(
    name('<a href="/" aria-labelledby="x y" aria-label="L">T</a><b id="x">Zimmer</b><b id="y">Preise</b>'),
    'Zimmer Preise',
  );
  assert.equal(name('<a href="/" aria-labelledby="none" aria-label=" Zimmer ">T</a>'), 'Zimmer');
  assert.equal(name('<a href="/">Zim<b>mer</b> <img alt="und Preise" src="/a.webp"></a>'), 'Zimmer und Preise');
  assert.equal(name('<a href="/"><svg aria-label="Start"></svg></a>'), 'Start');
  assert.equal(name('<a href="/"><svg><title>Start</title><text>x</text></svg></a>'), 'Start');
  assert.equal(name('<a href="/"><span aria-hidden="true">→</span> Weiter</a>'), 'Weiter');
  assert.equal(name('<a href="/" title="Zimmer"><img alt="" src="/a.webp"></a>'), 'Zimmer');
  assert.equal(name('<a href="/"><img src="/a.webp"></a>'), '');
});

test('nameKey is in lower case and drops the characters that are not letters at both ends', () => {
  assert.equal(nameKey('Mehr …'), 'mehr');
  assert.equal(nameKey('« Lire la suite »'), 'lire la suite');
  assert.equal(nameKey('→ 3 Zimmer: 2'), 'zimmer');
  assert.equal(nameKey('…'), '');
});

test('labelsOf finds the labels with for and the wrapping label without for', () => {
  const target = bodyPage(
    '<label for="m">A</label><label>B <input id="m" type="radio"></label><label for="z">C <input type="radio"></label>',
  );
  const dom = domOf(target);
  const [one, two] = dom.byTag('input');
  assert.ok(one !== undefined && two !== undefined);
  assert.deepEqual(
    labelsOf(dom, one).map((label) => textOf(label).trim()),
    ['A', 'B'],
  );
  assert.deepEqual(labelsOf(dom, two), [], 'a label with another for does not label it');
});

// The head

test('the CSP meta is the meta with http-equiv content-security-policy in any case, and parseCsp reads it', () => {
  const target = onePage(
    `<html><head><meta http-equiv="Content-Security-Policy" content="a"><meta http-equiv="content-security-policy-report-only" content="b"><script>"<meta http-equiv=content-security-policy>"</script></head></html>`,
  );
  const metas = cspMetasOf(domOf(target));
  assert.equal(metas.length, 1);
  assert.ok(metas[0] !== undefined && isCspMeta(metas[0]));
  const policy = parseCsp(cspContent(SWITCH_OPTIONS, { styles: [PAGE_CSS] }));
  assert.equal(policy[0]?.name, 'default-src');
  assert.deepEqual(sourcesOf(policy, 'script-src'), [
    "'self'",
    `'${SPECULATION_HASH}'`,
    `'${modeHash(SWITCH_OPTIONS)}'`,
  ]);
  assert.equal(sourcesOf(policy, 'style-src')?.length, 2);
  assert.deepEqual(parseCsp(" ; Script-Src  'self' ;script-src x;"), [
    { name: 'script-src', sources: ["'self'"] },
    { name: 'script-src', sources: ['x'] },
  ]);
  assert.equal(sourcesOf(parseCsp("default-src 'self'"), 'script-src'), undefined);
});

test('scriptKind reads the type as HTML does', () => {
  const kinds = bodyPage(
    '<script>a</script><script type=" Text/JavaScript ">b</script><script type="module">c</script><script type="application/ld+json">{}</script><script type="speculationrules">{}</script><script type="importmap">{}</script><script type="text/plain">d</script>',
  );
  const scripts = domOf(kinds).byTag('script');
  assert.deepEqual(scripts.map(scriptKind), [
    'classic',
    'classic',
    'module',
    'json-ld',
    'speculationrules',
    'importmap',
    'data',
  ]);
  assert.deepEqual(scripts.map(isExecutableScript), [true, true, true, false, false, false, false]);
  assert.deepEqual(scripts.map(rawContentOf).slice(0, 3), ['a', 'b', 'c']);
});

test('sourceOf gives the markup of an element as the page writes it', () => {
  const target = bodyPage('<p class="x">a <b>b</b></p>', '<meta http-equiv="content-security-policy" content="x">');
  assert.equal(sourceOf(target, first(target, 'p')), '<p class="x">a <b>b</b></p>');
  assert.equal(sourceOf(target, first(target, 'meta')), '<meta http-equiv="content-security-policy" content="x">');
});

test('robots: noindex and none mean noindex, and /404.html is never indexable', () => {
  const noindex = bodyPage('', '<meta name="ROBOTS" content="NoIndex, follow">');
  assert.deepEqual([...robotsOf(noindex)], ['noindex', 'follow']);
  assert.equal(hasNoindex(noindex), true);
  assert.equal(hasNoindex(bodyPage('', '<meta name="robots" content="none">')), true);
  assert.equal(isIndexable(bodyPage('')), true);
  const ctx = contextOf({ '404.html': notFoundPage(OPTIONS) });
  assert.equal(ctx.pages[0]?.is404, true);
  assert.equal(ctx.pages[0] !== undefined && isIndexable(ctx.pages[0]), false);
});

// The site

test('siteOf indexes pages and files, and the locale helpers read the settings', () => {
  const ctx = contextOf(site());
  const index = siteOf(ctx);
  assert.equal(index, siteOf(ctx), 'cached');
  assert.equal(index.host, 'example.ch');
  assert.deepEqual(
    [...index.pages.keys()],
    ['/', '/404.html', '/datenschutz/', '/fr/', '/fr/mentions-legales/', '/fr/protection-des-donnees/', '/impressum/'],
  );
  assert.ok(index.files.has('favicon.ico'));
  assert.equal(localeOf(OPTIONS, 'fr')?.tag, 'fr-CH');
  assert.equal(localeOf(OPTIONS, 'it'), undefined);
  assert.equal(localeOfLang(OPTIONS, 'FR-ch')?.code, 'fr');
  assert.equal(localeOfLang(OPTIONS, 'fr')?.code, 'fr');
  assert.equal(localeOfLang(OPTIONS, 'en'), undefined);
});

// Links

test('resolveHref: fragments, same-origin paths, other origins and other schemes', () => {
  const host = 'example.ch';
  const cases: [href: string, base: string, expected: ReturnType<typeof resolveHref>][] = [
    ['#content', '/', { kind: 'fragment', fragment: 'content' }],
    [
      '/zimmer/',
      '/',
      { kind: 'internal', path: '/zimmer/', query: '', fragment: undefined, absolute: false, scheme: '' },
    ],
    [
      ' /zimmer/#a ',
      '/',
      { kind: 'internal', path: '/zimmer/', query: '', fragment: 'a', absolute: false, scheme: '' },
    ],
    [
      'kontakt/?x=1',
      '/fr/',
      { kind: 'internal', path: '/fr/kontakt/', query: '?x=1', fragment: undefined, absolute: false, scheme: '' },
    ],
    [
      '../',
      '/fr/acces/',
      { kind: 'internal', path: '/fr/', query: '', fragment: undefined, absolute: false, scheme: '' },
    ],
    ['../../..', '/fr/', { kind: 'internal', path: '/', query: '', fragment: undefined, absolute: false, scheme: '' }],
    ['', '/fr/', { kind: 'internal', path: '/fr/', query: '', fragment: undefined, absolute: false, scheme: '' }],
    [
      '/Zimmer',
      '/',
      { kind: 'internal', path: '/Zimmer', query: '', fragment: undefined, absolute: false, scheme: '' },
    ],
    [
      'https://Example.ch/a/./b/',
      '/',
      { kind: 'internal', path: '/a/b/', query: '', fragment: undefined, absolute: true, scheme: 'https' },
    ],
    [
      'http://example.ch',
      '/',
      { kind: 'internal', path: '/', query: '', fragment: undefined, absolute: true, scheme: 'http' },
    ],
    [
      '//example.ch/x',
      '/',
      { kind: 'internal', path: '/x', query: '', fragment: undefined, absolute: true, scheme: 'https' },
    ],
    ['https://example.ch:8443/', '/', { kind: 'external', scheme: 'https', host: 'example.ch' }],
    ['https://www.example.ch/', '/', { kind: 'external', scheme: 'https', host: 'www.example.ch' }],
    ['mailto:info@example.ch', '/', { kind: 'external', scheme: 'mailto', host: undefined }],
    ['TEL:+41', '/', { kind: 'external', scheme: 'tel', host: undefined }],
    ['https://[', '/', { kind: 'invalid' }],
    [
      '/404.html',
      '/404.html',
      { kind: 'internal', path: '/404.html', query: '', fragment: undefined, absolute: false, scheme: '' },
    ],
  ];
  for (const [href, base, expected] of cases) assert.deepEqual(resolveHref(href, base, host), expected, href);
  assert.equal(decodePath('/%C3%BC/'), '/ü/');
});

test('resolveHref: a backslash before the query reads as a slash, as the URL standard reads it', () => {
  const host = 'example.ch';
  const internal = (path: string, query = '', absolute = false, scheme = '') => ({
    kind: 'internal',
    path,
    query,
    fragment: undefined,
    absolute,
    scheme,
  });
  assert.deepEqual(resolveHref('\\api\\forms\\contact\\', '/', host), internal('/api/forms/contact/'));
  assert.deepEqual(resolveHref('api\\forms\\', '/fr/', host), internal('/fr/api/forms/'));
  assert.deepEqual(resolveHref('https:\\\\example.ch\\a\\', '/', host), internal('/a/', '', true, 'https'));
  assert.deepEqual(resolveHref('\\\\other.example\\x', '/', host), {
    kind: 'external',
    scheme: 'https',
    host: 'other.example',
  });
  // A backslash in the query stays as it is.
  assert.deepEqual(resolveHref('/a/?b=\\c', '/', host), internal('/a/', '?b=\\c'));
  // The URL parser of Node, which follows the URL standard as browsers do, gives the same path.
  for (const href of ['\\api\\forms\\contact\\', 'https:\\\\example.ch\\a\\', '/a/?b=\\c']) {
    const url = new URL(href, 'https://example.ch/');
    const target = resolveHref(href, '/', host);
    assert.equal(target.kind === 'internal' ? target.path : '', url.pathname, href);
  }
  assert.equal(decodePath('/%E0%A4%A/'), undefined);
});

test('resolveHref: a dot segment written with %2e is a dot segment, in any letter case, as the URL standard reads it', () => {
  const host = 'example.ch';
  const pathOf = (href: string, base = '/'): string => {
    const target = resolveHref(href, base, host);
    return target.kind === 'internal' ? target.path : '';
  };
  const cases: [href: string, path: string][] = [
    ['/_astro/%2e%2e/x.js', '/x.js'],
    ['/_astro/%2E%2e/x.js', '/x.js'],
    ['/_astro/.%2e/x.js', '/x.js'],
    ['/_astro/%2e./x.js', '/x.js'],
    ['/_astro/.%2E/x.js', '/x.js'],
    ['/_astro/%2E./x.js', '/x.js'],
    ['/_astro/%2e/x.js', '/_astro/x.js'],
    ['/_astro/%2E/x.js', '/_astro/x.js'],
    ['/a/b/%2e%2e', '/a/'],
    ['/a/b/%2e', '/a/b/'],
    ['%2e%2e/x/', '/x/'],
    ['https://example.ch/_astro/%2e%2e/vendor/track.js', '/vendor/track.js'],
    // Not dot segments: more than two dots, another encoding, or a dot with other text.
    ['/a/%2e%2e%2e/x', '/a/%2e%2e%2e/x'],
    ['/a/%252e%252e/x', '/a/%252e%252e/x'],
    ['/a/%2ex/x', '/a/%2ex/x'],
    ['/a/...', '/a/...'],
  ];
  for (const [href, path] of cases) {
    assert.equal(pathOf(href, '/fr/'), path, href);
    // The URL parser of Node, which follows the URL standard as browsers do, gives the same path.
    assert.equal(new URL(href, 'https://example.ch/fr/').pathname, path, href);
  }
});

test('resolveHref: a tab or line break anywhere in the href is removed, as the URL standard does', () => {
  const host = 'example.ch';
  for (const href of ['/api/for\tms/contact/', '/api/forms/\ncontact/', '/zim\r\nmer/#a', 'https://exa\tmple.ch/a/']) {
    const url = new URL(href, 'https://example.ch/');
    const target = resolveHref(href, '/', host);
    assert.equal(target.kind, 'internal', JSON.stringify(href));
    assert.equal(target.kind === 'internal' ? target.path : '', url.pathname, JSON.stringify(href));
  }
});

test('linksOf resolves each a[href] and area[href] once, and linkedPages keeps the built pages', () => {
  const ctx = contextOf(site());
  const home = siteOf(ctx).pages.get('/');
  assert.ok(home !== undefined);
  const links = linksOf(ctx, home);
  assert.equal(links, linksOf(ctx, home), 'cached');
  assert.deepEqual(
    links.map((link) => link.href),
    ['#content', '/', '/', '/fr/', '/impressum/', '/datenschutz/'],
  );
  assert.deepEqual([...linkedPages(ctx, home)], ['/', '/fr/', '/impressum/', '/datenschutz/']);
});

test('alternatesOf reads the hreflang links, and alternateIn finds the built alternate of a locale', () => {
  const ctx = contextOf(site());
  const pages = siteOf(ctx).pages;
  const home = pages.get('/');
  const notFound = pages.get('/404.html');
  assert.ok(home !== undefined && notFound !== undefined);
  assert.deepEqual(
    alternatesOf(ctx, home).map((alternate) => [alternate.hreflang, alternate.path]),
    [
      ['de-CH', '/'],
      ['fr-CH', '/fr/'],
      ['x-default', '/'],
    ],
  );
  assert.equal(alternateIn(ctx, home, 'fr'), pages.get('/fr/'));
  assert.equal(alternateIn(ctx, home, 'it'), undefined);
  assert.deepEqual(alternatesOf(ctx, notFound), []);
  const relative = onePage(page(OPTIONS, '/', { head: '<link rel="alternate" hreflang="fr-CH" href="/fr/">' }));
  assert.deepEqual(
    alternatesOf(contextOf({}), relative).map((alternate) => [alternate.hreflang, alternate.path]),
    [
      ['de-CH', '/'],
      ['x-default', '/'],
      ['fr-CH', undefined],
    ],
  );
});

// The fixtures

test('the fixture pages hold the head tags, the CSP meta and the inserts in the order that Astro writes them', () => {
  const html = page(SWITCH_OPTIONS, '/');
  const order = [
    '<meta charset="utf-8">',
    '<title>',
    '<link rel="canonical"',
    '<link rel="alternate"',
    '<meta property="og:title"',
    '<link rel="icon"',
    '<script type="application/ld+json">',
    '<meta http-equiv="content-security-policy"',
    '<script>{',
    '<script type="speculationrules">',
    '<style>',
    '</head> <body> <a class="skip-link',
    '<fieldset class="mode-switch" data-mode-switch>',
    '<main id="content">',
    '<footer',
  ].map((text) => html.indexOf(text));
  assert.ok(
    order.every((at, index) => at >= 0 && (index === 0 || at > (order[index - 1] ?? 0))),
    JSON.stringify(order),
  );
  assert.equal(NO_DESIGN.colors.length, 0);
  const notFound = notFoundPage(OPTIONS);
  assert.ok(notFound.includes('<meta name="robots" content="noindex">'));
  assert.ok(!notFound.includes('rel="canonical"'));
  assert.ok(notFound.includes('<a href="/fr/">'));
});

// Review cases of part 5b

/** The accessible name of the first link of a page with this body. */
const linkName = (body: string): string => {
  const target = bodyPage(body);
  return accessibleName(domOf(target), first(target, 'a'));
};

test('accessibleName: a descendant with an aria-label counts as its label, as Chromium names it', () => {
  assert.equal(linkName('<a href="/"><span role="img" aria-label="Stern">*</span> Bewertung</a>'), 'Stern Bewertung');
  assert.equal(linkName('<a href="/"><span aria-label="Inner">x</span></a>'), 'Inner');
  assert.equal(linkName('<a href="/"><span role="img" aria-label="Instagram"></span></a>'), 'Instagram');
  assert.equal(linkName('<a href="/"><img alt="Bild" aria-label="Label"></a>'), 'Label');
});

test('accessibleName: hidden content counts as nothing, aria-hidden in any case, and a block stands apart', () => {
  assert.equal(linkName('<a href="/"><span hidden>Versteckt</span>Sichtbar</a>'), 'Sichtbar');
  assert.equal(linkName('<a href="/"><span hidden>Nur versteckt</span></a>'), '');
  assert.equal(linkName('<a href="/"><span aria-hidden="TRUE">Gross</span>Klein</a>'), 'Klein');
  assert.equal(linkName('<a href="/"><span aria-hidden=" true ">Gross</span>Klein</a>'), 'Klein');
  assert.equal(linkName('<a href="/"><div>Block</div><div>Zwei</div></a>'), 'Block Zwei');
  assert.equal(linkName('<a href="/"><p>Absatz</p><p>Zwei</p></a>'), 'Absatz Zwei');
  assert.equal(linkName('<a href="/">Zim<b>mer</b><span>preise</span></a>'), 'Zimmerpreise');
  assert.equal(linkName('<a href="/">Zimmer<template>und mehr</template></a>'), 'Zimmer');
});

test('accessibleName reads a name up to MAX_NAME characters', () => {
  const long = 'a'.repeat(5000);
  assert.equal(linkName(`<a href="/">${long}</a>`), 'a'.repeat(MAX_NAME));
  assert.equal(linkName(`<a href="/" aria-label="${long}">x</a>`).length, MAX_NAME);
  assert.equal(linkName(`<a href="/">${' '.repeat(5000)}Zimmer</a>`), 'Zimmer');
});

test('accessibleName: hostile name shapes stay fast and never throw', () => {
  const started = performance.now();
  const big = `<div id="big">${'Wort '.repeat(200_000)}</div>`;
  const many = bodyPage(`${big}${'<a href="/fr/" aria-labelledby="big">x</a>'.repeat(2_000)}`);
  const dom = domOf(many);
  for (const link of dom.byTag('a')) assert.equal(accessibleName(dom, link).length, MAX_NAME - 1);
  const repeated = bodyPage(`${big}<a href="/fr/" aria-labelledby="${'big '.repeat(200_000)}">x</a>`);
  assert.equal(accessibleName(domOf(repeated), first(repeated, 'a')).length, MAX_NAME - 1);
  const nested = bodyPage(`${'<a href="/fr/">'.repeat(5_000)}x${'</a>'.repeat(5_000)}`);
  const nestedDom = domOf(nested);
  for (const link of nestedDom.byTag('a')) assert.equal(accessibleName(nestedDom, link), 'x');
  assert.ok(performance.now() - started < 3_000);
});

test('domOf leaves template content out of elements, texts, byTag and byId, and keeps it in inert', () => {
  const target = bodyPage(
    '<main><h1>A</h1><template><h1 id="t">T</h1><template><p>tief</p></template></template></main>',
  );
  const dom = domOf(target);
  assert.equal(dom.byTag('h1').length, 1);
  assert.equal(dom.byTag('template').length, 1);
  assert.equal(dom.byId.has('t'), false);
  assert.deepEqual(
    dom.inert.map((element) => tagOf(element)),
    ['h1', 'template', 'p'],
  );
  assert.equal(collapse(textOf(first(target, 'body'))), 'A');
  assert.equal(textOf(first(target, 'main')), 'A');
  assert.deepEqual(
    descendantsOf(first(target, 'main')).map((element) => tagOf(element)),
    ['h1', 'template'],
  );
});

test('cspMetasOf reads only a CSP meta that is a child of head', () => {
  const meta = '<meta http-equiv="content-security-policy" content="x">';
  assert.equal(cspMetasOf(domOf(bodyPage('', meta))).length, 1);
  assert.equal(cspMetasOf(domOf(bodyPage(`<main>${meta}</main>`))).length, 0);
  assert.equal(cspMetasOf(domOf(bodyPage('', `<template>${meta}</template>`))).length, 0);
});

test('hasNoindex reads the robots metas of the big crawlers too', () => {
  assert.equal(hasNoindex(bodyPage('', '<meta name="googlebot" content="noindex">')), true);
  assert.equal(hasNoindex(bodyPage('', '<meta name="BingBot" content="none">')), true);
  assert.equal(hasNoindex(bodyPage('', '<meta name="slurp" content="noindex">')), false);
  assert.deepEqual([...robotsOf(bodyPage('', '<meta name="googlebot" content="noindex">'))], []);
});

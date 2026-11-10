import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import load from 'astro/runtime/client/load.prebuilt.js';
import visible from 'astro/runtime/client/visible.prebuilt.js';
import islandRuntime from 'astro/runtime/server/astro-island.prebuilt.js';
import { auditPages } from '../../src/audit/page.ts';
import { parseHtml } from '../../src/build.ts';
import type { BuildContext, BuiltPage } from '../../src/context.ts';
import { SPECULATION_JSON, sha256 } from '../../src/csp.ts';
import { KIT_MESSAGES, siteSchema } from '../../src/facts.ts';
import type { PageRecord } from '../../src/manifest.ts';
import { effectiveLimits, type KitOptions, optionsSchema } from '../../src/options.ts';
import { Report } from '../../src/registry.ts';

const SITE = 'https://example.ch';
const OPTIONS = optionsSchema.parse({
  site: SITE,
  locales: [{ code: 'de', tag: 'de-CH', name: 'Deutsch' }],
  defaultLocale: 'de',
  securityContact: 'mailto:security@example.ch',
});
const FACTS = siteSchema.parse({
  type: 'ProfessionalService',
  name: 'Muster',
  legalName: 'Muster AG',
  email: 'hallo@example.ch',
  phone: '+41440000000',
  address: { street: 'Musterstrasse 1', postalCode: '8000', locality: 'Zürich', country: 'CH' },
});

// Image files: still and animated variants of each format.
const u32be = (n: number) => Buffer.from([n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
const u32le = (n: number) => Buffer.from([n & 255, (n >>> 8) & 255, (n >>> 16) & 255, n >>> 24]);
const png = (...types: string[]) =>
  Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10]),
    ...types.map((t) => Buffer.concat([u32be(4), Buffer.from(t), Buffer.alloc(4), Buffer.alloc(4)])),
  ]);
const webp = (...types: string[]) => {
  const chunks = Buffer.concat(types.map((t) => Buffer.concat([Buffer.from(t), u32le(4), Buffer.alloc(4)])));
  return Buffer.concat([Buffer.from('RIFF'), u32le(chunks.length + 4), Buffer.from('WEBP'), chunks]);
};
const avif = (major: string) =>
  Buffer.concat([u32be(24), Buffer.from(`ftyp${major}`), Buffer.alloc(4), Buffer.from('mif1miaf')]);
const frame = [0x21, 0xf9, 4, 0, 0, 0, 0, 0, 0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 2, 0x44, 1, 0];
const gif = (frames: number) =>
  Buffer.from([...Buffer.from('GIF89a'), 1, 0, 1, 0, 0, 0, 0, ...Array(frames).fill(frame).flat(), 0x3b]);

const DIST = mkdtempSync(join(tmpdir(), 'audit-page-'));
const FILES: Record<string, Buffer> = {
  'favicon.ico': Buffer.alloc(16),
  'icon.svg': Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),
  'apple-touch-icon.png': png('IHDR', 'IDAT', 'IEND'),
  '_astro/og.png': png('IHDR', 'IDAT', 'IEND'),
  '_astro/og-big.png': Buffer.alloc(151 * 1024),
  '_astro/still.gif': gif(1),
  '_astro/anim.gif': gif(2),
  '_astro/still.png': png('IHDR', 'IDAT', 'IEND'),
  '_astro/anim.png': png('IHDR', 'acTL', 'IDAT', 'IEND'),
  '_astro/still.webp': webp('VP8 '),
  '_astro/anim.webp': webp('VP8X', 'ANIM', 'ANMF'),
  '_astro/still.avif': avif('avif'),
  '_astro/anim.avif': avif('avis'),
};
for (const [file, bytes] of Object.entries(FILES)) {
  mkdirSync(dirname(join(DIST, file)), { recursive: true });
  writeFileSync(join(DIST, file), bytes);
}

const ORG = {
  '@type': 'ProfessionalService',
  '@id': `${SITE}/#org`,
  name: 'Muster',
  telephone: '+41440000000',
  address: {
    '@type': 'PostalAddress',
    streetAddress: 'Musterstrasse 1',
    postalCode: '8000',
    addressLocality: 'Zürich',
    addressCountry: 'CH',
  },
  openingHoursSpecification: [
    {
      '@type': 'OpeningHoursSpecification',
      dayOfWeek: ['https://schema.org/Monday', 'https://schema.org/Tuesday'],
      opens: '08:00',
      closes: '17:00',
    },
  ],
};
const ld = (...nodes: object[]) =>
  JSON.stringify({
    '@context': 'https://schema.org',
    '@graph': [ORG, { '@type': 'WebPage', inLanguage: 'de-CH' }, ...nodes],
  });

/** Fills %CSP% with a meta that hashes every inline script (except JSON-LD) and style. */
function finish(html: string): string {
  const hashes = (tag: string) =>
    [...html.matchAll(new RegExp(`<${tag}([^>]*)>([\\s\\S]*?)</${tag}>`, 'g'))]
      .filter((m) => !/src=|ld\+json/.test(m[1] ?? ''))
      .map((m) => `'${sha256(m[2] ?? '')}'`)
      .join(' ');
  const csp = `default-src 'self'; script-src 'self' ${hashes('script')}; style-src 'self' ${hashes('style')}`;
  return html.replace('%CSP%', `<meta http-equiv="content-security-policy" content="${csp}">`);
}

const DESCRIPTION = 'Wir beraten kleine und mittlere Unternehmen in Zürich zu Strategie, Finanzen und Wachstum.';

function template(path: string, title: string, description = DESCRIPTION, json = ld()): string {
  return `<!DOCTYPE html><html lang="de-CH"><head><meta charset="utf-8"><title>${title}</title><meta name="description" content="${description}"><link rel="canonical" href="${SITE}${path}"><meta property="og:title" content="${title}"><meta property="og:description" content="${description}"><meta property="og:url" content="${SITE}${path}"><meta property="og:locale" content="de_CH"><meta property="og:image" content="${SITE}/_astro/og.png"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><link rel="icon" href="/favicon.ico" sizes="32x32"><link rel="icon" href="/icon.svg" type="image/svg+xml"><link rel="apple-touch-icon" href="/apple-touch-icon.png"><link rel="preload" href="/_astro/inter.woff2" as="font" type="font/woff2" crossorigin><style>@font-face{font-family:"Inter";src:url(/_astro/inter.woff2) format("woff2")}@font-face{font-family:"Inter fallback: Arial";src:local("Arial")}</style>%CSP%<script type="speculationrules">${SPECULATION_JSON}</script><script type="application/ld+json">${json}</script></head><body><a href="#main">Zum Inhalt springen</a><header><nav><a href="/leistungen/">Leistungen</a><a href="https://www.linkedin.com/company/muster">LinkedIn</a></nav></header><main id="main"><h1>${title}</h1><h2>Leistungen</h2><h3>Beratung</h3><picture><source type="image/avif" srcset="/_astro/team.avif 640w, /_astro/team-2.avif 960w"><img src="/_astro/team.webp" srcset="/_astro/team.webp 640w" width="640" height="480" alt="Das Team" fetchpriority="high"></picture><img src="/_astro/still.gif" width="1" height="1" alt=""><svg aria-hidden="true"><path d="M0 0h1"/></svg><svg role="img"><title>Logo</title><svg><path d="M0 0h1"/></svg></svg><video controls src="/_astro/clip.mp4" poster="/_astro/still.webp"><track kind="captions" srclang="de" src="/_astro/clip.vtt"></video><audio controls src="/_astro/talk.mp3"></audio><p><a href="/transkript/">Transkript des Vortrags</a></p><form method="post" action="/api/contact/"><label for="name">Name (Pflichtfeld)</label><input id="name" name="name" autocomplete="name" required><label>E-Mail (Pflichtfeld) <input type="email" name="email" autocomplete="email" required></label><label>Nachricht (optional)<textarea name="message" autocomplete="off"></textarea></label><label><input type="checkbox" name="copy"> Kopie an mich (optional)</label><div inert><input name="website" tabindex="-1"></div><input type="hidden" name="locale" value="de"><p><a href="/datenschutz/">Datenschutz</a></p><button type="submit">Senden</button></form></main></body></html>`;
}

const record = (id: string, path: string, extra: Partial<PageRecord> = {}): PageRecord => ({
  id,
  locale: 'de',
  entryId: `de/${id}`,
  file: `src/content/pages/de/${id}.md`,
  slug: path.slice(1, -1),
  path,
  title: id,
  description: '',
  draft: false,
  missing: [],
  ...extra,
});

interface Case {
  /** Applied to the home page before the CSP meta is computed. */
  pre?: (html: string) => string;
  /** Applied to the home page after the CSP meta is computed. */
  post?: (html: string) => string;
  options?: KitOptions;
  services?: string;
  notFound?: string;
  files?: string[];
  serviceRecord?: Partial<PageRecord>;
  drafts?: boolean;
  css?: BuildContext['css'];
}

const HOME = template(
  '/',
  'Muster – Beratung für KMU in Zürich',
  DESCRIPTION,
  ld({ '@type': 'WebSite', url: `${SITE}/` }),
);
const SERVICES = template(
  '/leistungen/',
  'Leistungen – Strategie und Finanzen',
  'Strategie, Finanzen und Wachstum: unsere Leistungen für kleine und mittlere Unternehmen.',
);
const NOT_FOUND = template('/404.html', 'Seite nicht gefunden').replace(
  '<meta charset="utf-8">',
  '<meta charset="utf-8"><meta name="robots" content="noindex">',
);

/** Runs the audit on home, services and 404; returns the sorted rule ids found. */
function run(c: Case = {}): string[] {
  const options = c.options ?? OPTIONS;
  const records = [
    record('home', '/', { slug: '' }),
    record('services', '/leistungen/', c.serviceRecord),
    record('privacy', '/datenschutz/'),
  ];
  const home = (c.post ?? ((s) => s))(finish((c.pre ?? ((s) => s))(HOME)));
  const pages = [
    ['/', home],
    ['/leistungen/', finish(c.services ?? SERVICES)],
    ['/404.html', finish(c.notFound ?? NOT_FOUND)],
  ] as const;
  const built = pages.map(([path, html]): BuiltPage => {
    const page: BuiltPage = {
      file: join(DIST, path),
      path,
      html,
      doc: parseHtml(html),
      locale: 'de',
      is404: path === '/404.html',
    };
    const r = records.find((x) => x.path === path);
    if (r) page.record = r;
    return page;
  });
  const ctx: BuildContext = {
    root: DIST,
    dist: DIST,
    options,
    limits: effectiveLimits(options),
    manifest: {
      pages: records,
      byId: Object.fromEntries(records.map((r) => [r.id, { de: r }])),
      drafts: c.drafts ?? false,
    },
    site: FACTS,
    schedule: { openingHours: [{ days: ['Mo', 'Tu'], opens: '08:00', closes: '17:00' }], closures: [] },
    messages: { de: KIT_MESSAGES.de ?? {} },
    pages: built,
    css: c.css ?? [],
    files: c.files ?? Object.keys(FILES),
    redirects: [],
    wrangler: undefined,
    report: new Report(),
    env: {},
  };
  auditPages(ctx);
  return [...ctx.report.ids()].sort();
}

const add = (html: string, before: string, insert: string) => html.replace(before, `${insert}${before}`);
const body = (insert: string) => (html: string) => add(html, '</main>', insert);
const withFeatures = (
  features: Partial<KitOptions['features']>,
  prefetch: Partial<KitOptions['prefetch']> = {},
): KitOptions => ({
  ...OPTIONS,
  features: { ...OPTIONS.features, ...features },
  prefetch: { ...OPTIONS.prefetch, ...prefetch },
});

test('a good site passes', () => {
  assert.deepEqual(run(), []);
});

const CASES: [string, Case, string[]][] = [
  // head
  [
    'canonical without trailing slash',
    { post: (h) => h.replace(`rel="canonical" href="${SITE}/"`, `rel="canonical" href="${SITE}"`) },
    ['head-canonical'],
  ],
  ['two canonicals', { post: (h) => add(h, '</head>', `<link rel="canonical" href="${SITE}/">`) }, ['head-canonical']],
  [
    'canonical to another page',
    { services: SERVICES.replace(`rel="canonical" href="${SITE}/leistungen/"`, `rel="canonical" href="${SITE}/"`) },
    ['head-canonical'],
  ],
  ['404 without canonical', { notFound: NOT_FOUND.replace(/<link rel="canonical"[^>]*>/, '') }, []],
  ['lang without region', { pre: (h) => h.replace('lang="de-CH"', 'lang="de"') }, ['head-lang']],
  ['short title', { pre: (h) => h.replace(/<title>[^<]*<\/title>/, '<title>Muster</title>') }, ['head-title']],
  [
    'duplicate title',
    { services: SERVICES.replace(/<title>[^<]*<\/title>/, '<title>Muster – Beratung für KMU in Zürich</title>') },
    ['head-title'],
  ],
  [
    'long description',
    {
      pre: (h) =>
        h.replace(`name="description" content="${DESCRIPTION}"`, `name="description" content="${'x'.repeat(161)}"`),
    },
    ['head-description'],
  ],
  [
    'duplicate description',
    { services: template('/leistungen/', 'Leistungen – Strategie und Finanzen') },
    ['head-description'],
  ],
  [
    '404 shares the title and description',
    { notFound: NOT_FOUND.replace(/<title>[^<]*<\/title>/, '<title>Muster – Beratung für KMU in Zürich</title>') },
    [],
  ],
  ['no og:locale', { pre: (h) => h.replace('<meta property="og:locale" content="de_CH">', '') }, ['head-og']],
  [
    'og:url differs',
    { pre: (h) => h.replace(`property="og:url" content="${SITE}/"`, `property="og:url" content="${SITE}/x/"`) },
    ['head-og'],
  ],
  [
    'og:image on a CDN',
    { pre: (h) => h.replace(`${SITE}/_astro/og.png`, 'https://cdn.example.com/og.png') },
    ['head-og'],
  ],
  ['og:image missing in dist', { pre: (h) => h.replace('/_astro/og.png', '/_astro/none.png') }, ['head-og']],
  ['og:image too large', { pre: (h) => h.replace('/_astro/og.png', '/_astro/og-big.png') }, ['head-og']],
  ['og:image wrong size', { pre: (h) => h.replace('content="1200"', 'content="1000"') }, ['head-og']],
  [
    'no apple-touch-icon link',
    { pre: (h) => h.replace('<link rel="apple-touch-icon" href="/apple-touch-icon.png">', '') },
    ['head-icons'],
  ],
  ['favicon file missing', { files: Object.keys(FILES).filter((f) => f !== 'favicon.ico') }, ['head-icons']],
  // json-ld
  ['JSON-LD does not parse', { pre: (h) => h.replace(/(ld\+json">)[^<]*/, '$1{') }, ['head-jsonld']],
  ['FAQPage type', { pre: (h) => h.replace(/(ld\+json">)[^<]*/, `$1${ld({ '@type': 'FAQPage' })}`) }, ['head-jsonld']],
  [
    'BreadcrumbList nested',
    {
      pre: (h) =>
        h.replace(/(ld\+json">)[^<]*/, `$1${ld({ '@type': 'WebSite', breadcrumb: { '@type': 'BreadcrumbList' } })}`),
    },
    ['head-jsonld'],
  ],
  [
    'WebSite off the home',
    {
      services: template(
        '/leistungen/',
        'Leistungen – Strategie und Finanzen',
        'Strategie, Finanzen und Wachstum: unsere Leistungen für KMU.',
        ld({ '@type': 'WebSite' }),
      ),
    },
    ['head-jsonld'],
  ],
  [
    'Article without a date',
    {
      services: template(
        '/leistungen/',
        'Leistungen – Strategie und Finanzen',
        'Strategie, Finanzen und Wachstum: unsere Leistungen für KMU.',
        ld({ '@type': 'Article' }),
      ),
    },
    ['head-jsonld'],
  ],
  [
    'Article with a date',
    {
      serviceRecord: { date: '2026-01-01' },
      services: template(
        '/leistungen/',
        'Leistungen – Strategie und Finanzen',
        'Strategie, Finanzen und Wachstum: unsere Leistungen für KMU.',
        ld({ '@type': 'Article' }),
      ),
    },
    [],
  ],
  ['organisation name differs', { pre: (h) => h.replace('"name":"Muster"', '"name":"Muster GmbH"') }, ['head-jsonld']],
  ['telephone differs', { pre: (h) => h.replace('"+41440000000"', '"+41449999999"') }, ['head-jsonld']],
  ['address differs', { pre: (h) => h.replace('"8000"', '"8001"') }, ['head-jsonld']],
  ['opening hours differ', { pre: (h) => h.replace('"closes":"17:00"', '"closes":"18:00"') }, ['head-jsonld']],
  [
    'vatID not in site.json',
    { pre: (h) => h.replace('"name":"Muster"', '"name":"Muster","vatID":"CHE-123.456.789 MWST"') },
    ['head-jsonld'],
  ],
  [
    'another organisation @id',
    { services: SERVICES.replaceAll(`${SITE}/#org`, `${SITE}/leistungen/#org`) },
    ['head-jsonld'],
  ],
  [
    'WebPage in another language',
    { pre: (h) => h.replace('"inLanguage":"de-CH"', '"inLanguage":"fr-CH"') },
    ['head-jsonld'],
  ],
  // headings and indexing
  ['two h1', { pre: body('<h1>Zweiter Titel</h1>') }, ['headings-h1']],
  [
    'skipped heading level',
    { pre: (h) => h.replace('<h2>Leistungen</h2>', '<h3>Leistungen</h3>') },
    ['headings-order'],
  ],
  [
    'noindex on a page',
    { pre: (h) => add(h, '</head>', '<meta name="robots" content="noindex">') },
    ['indexing-noindex'],
  ],
  [
    'noindex on a draft in a drafts build',
    {
      drafts: true,
      serviceRecord: { draft: true },
      services: add(SERVICES, '</head>', '<meta name="robots" content="noindex">'),
    },
    [],
  ],
  [
    'noindex on a draft in production',
    { serviceRecord: { draft: true }, services: add(SERVICES, '</head>', '<meta name="robots" content="noindex">') },
    ['indexing-noindex'],
  ],
  [
    '404 without noindex',
    { notFound: NOT_FOUND.replace('<meta name="robots" content="noindex">', '') },
    ['indexing-noindex'],
  ],
  // csp
  [
    'two CSP metas',
    { post: (h) => add(h, '</head>', '<meta http-equiv="Content-Security-Policy" content="default-src \'self\'">') },
    ['csp-meta'],
  ],
  [
    'unsafe-inline in the CSP',
    { post: (h) => h.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'") },
    ['csp-meta'],
  ],
  [
    'wildcard in the CSP',
    { post: (h) => h.replace("default-src 'self'", "default-src 'self' https://*.example.com") },
    ['csp-meta'],
  ],
  [
    'script before the CSP meta',
    {
      options: withFeatures({ scripts: true }),
      pre: (h) => add(h, '%CSP%', '<script type="module" src="/_astro/a.js"></script>'),
    },
    ['csp-meta'],
  ],
  ['unhashed inline style', { post: body('<style>p{margin:0}</style>') }, ['csp-hash']],
  [
    'unhashed inline module',
    { options: withFeatures({ scripts: true }), post: body('<script type="module">console.log(1)</script>') },
    ['csp-hash'],
  ],
  [
    'hashed inline module with scripts',
    { options: withFeatures({ scripts: true }), pre: body('<script type="module">console.log(1)</script>') },
    [],
  ],
  ['a base element', { pre: (h) => add(h, '</head>', '<base href="/">') }, ['csp-base']],
  // js and speculation
  ['inline classic script', { pre: body('<script>console.log(1)</script>') }, ['js-script']],
  [
    'bundled module without the feature',
    { pre: body('<script type="module" src="/_astro/a.js"></script>') },
    ['js-script'],
  ],
  [
    'bundled module with scripts',
    { options: withFeatures({ scripts: true }), pre: body('<script type="module" src="/_astro/a.js"></script>') },
    [],
  ],
  [
    'bundled module with astroPrefetch',
    {
      options: withFeatures({}, { astroPrefetch: true }),
      pre: body('<script type="module" src="/_astro/page.js"></script>'),
    },
    [],
  ],
  [
    'module from elsewhere with scripts',
    { options: withFeatures({ scripts: true }), pre: body('<script type="module" src="/js/a.js"></script>') },
    ['js-script'],
  ],
  ['data block script', { pre: body('<script type="application/json">{}</script>') }, ['js-script']],
  [
    'island with client:visible',
    {
      options: withFeatures({ islands: true }),
      pre: body(
        `<script>${visible}</script><script>${islandRuntime}</script><astro-island client="visible" component-url="/_astro/Counter.js"></astro-island>`,
      ),
    },
    [],
  ],
  [
    'island scripts without islands',
    { pre: body(`<script>${visible}</script><script>${islandRuntime}</script>`) },
    ['js-script'],
  ],
  [
    'island with client:load',
    {
      options: withFeatures({ islands: true }),
      pre: body(
        `<script>${load}</script><script>${islandRuntime}</script><astro-island client="load" component-url="/_astro/C.js"></astro-island>`,
      ),
    },
    ['js-directive'],
  ],
  [
    'changed island runtime',
    { options: withFeatures({ islands: true }), pre: body(`<script>${islandRuntime};alert(1)</script>`) },
    ['js-script'],
  ],
  [
    'data-astro-prefetch',
    { pre: body('<a href="/leistungen/" data-astro-prefetch>Leistungen</a>') },
    ['js-prefetch-attr'],
  ],
  [
    'no speculation block',
    { post: (h) => h.replace(/<script type="speculationrules">[^<]*<\/script>/, '') },
    ['speculation-block'],
  ],
  [
    'two speculation blocks',
    { pre: body(`<script type="speculationrules">${SPECULATION_JSON}</script>`) },
    ['speculation-block'],
  ],
  [
    'changed speculation rules',
    { pre: (h) => h.replace(SPECULATION_JSON, SPECULATION_JSON.replace('moderate', 'eager')) },
    ['speculation-block'],
  ],
  [
    'speculation block before the CSP meta',
    {
      pre: (h) =>
        h
          .replace(`<script type="speculationrules">${SPECULATION_JSON}</script>`, '')
          .replace('%CSP%', `<script type="speculationrules">${SPECULATION_JSON}</script>%CSP%`),
    },
    ['speculation-block'],
  ],
  ['speculation block while off', { options: withFeatures({}, { speculationRules: false }) }, ['speculation-block']],
  // images, fonts, origins
  [
    'image outside the pipeline',
    { pre: body('<img src="/images/a.jpg" width="1" height="1" alt="">') },
    ['images-src'],
  ],
  [
    'srcset outside the pipeline',
    { pre: (h) => h.replace('/_astro/team-2.avif 960w', '/img/team.avif 960w') },
    ['images-src'],
  ],
  [
    'image without width',
    {
      pre: (h) =>
        h.replace(
          '<img src="/_astro/team.webp" srcset="/_astro/team.webp 640w" width="640"',
          '<img src="/_astro/team.webp"',
        ),
    },
    ['images-attrs'],
  ],
  ['image without alt', { pre: body('<img src="/_astro/a.webp" width="1" height="1">') }, ['images-attrs']],
  [
    'picture with a WebP source',
    { pre: (h) => h.replace('type="image/avif"', 'type="image/webp"') },
    ['images-format'],
  ],
  [
    'picture with a JPEG img',
    { pre: (h) => h.replace('<img src="/_astro/team.webp"', '<img src="/_astro/team.jpg"') },
    ['images-format'],
  ],
  [
    'two priority images',
    { pre: body('<img src="/_astro/b.webp" width="1" height="1" alt="" fetchpriority="high">') },
    ['images-priority'],
  ],
  [
    'three font families',
    {
      pre: (h) =>
        h.replace(
          '</style>',
          '@font-face{font-family:Lora;src:url(/_astro/lora.woff2)}@font-face{font-family:Mono;src:url(/_astro/mono.woff2)}</style>',
        ),
    },
    ['fonts-limit'],
  ],
  [
    'three families across a linked stylesheet',
    {
      pre: (h) => add(h, '</head>', '<link rel="stylesheet" href="/_astro/a.css">'),
      css: [
        {
          where: '/_astro/a.css',
          text: '@font-face{font-family:"Lora";src:url(./lora.woff2)}@font-face{font-family:Mono;src:url(/_astro/m.woff2)}',
        },
      ],
    },
    ['fonts-limit'],
  ],
  [
    'font from another origin',
    { pre: (h) => h.replace('url(/_astro/inter.woff2)', 'url(https://fonts.gstatic.com/inter.woff2)') },
    ['fonts-limit'],
  ],
  [
    'two font preloads',
    {
      pre: (h) =>
        add(h, '</head>', '<link rel="preload" href="/_astro/b.woff2" as="font" type="font/woff2" crossorigin>'),
    },
    ['fonts-limit'],
  ],
  [
    'third-party stylesheet',
    { pre: (h) => add(h, '</head>', '<link rel="stylesheet" href="https://cdn.example.com/a.css">') },
    ['origins-third-party'],
  ],
  [
    'third-party iframe',
    { pre: body('<iframe src="https://www.youtube-nocookie.com/embed/x" title="Video"></iframe>') },
    ['origins-third-party'],
  ],
  [
    'third-party form action',
    { pre: (h) => h.replace('action="/api/contact/"', 'action="https://formspree.io/f/x"') },
    ['origins-third-party'],
  ],
  [
    'protocol-relative video poster',
    { pre: (h) => h.replace('poster="/_astro/still.webp"', 'poster="//cdn.example.com/p.webp"') },
    ['origins-third-party'],
  ],
  ['outbound anchor', { pre: body('<p><a href="https://www.admin.ch/">Bund</a></p>') }, []],
  // shell and svg
  ['no skip link', { pre: (h) => h.replace('<a href="#main">Zum Inhalt springen</a>', '') }, ['html-shell']],
  [
    'button before the skip link',
    { pre: (h) => h.replace('<body>', '<body><button type="button">Menü</button>') },
    ['html-shell'],
  ],
  ['main without id', { pre: (h) => h.replace('<main id="main">', '<main>') }, ['html-shell']],
  ['two main elements', { pre: (h) => h.replace('</body>', '<main id="main2"></main></body>') }, ['html-shell']],
  ['unnamed svg', { pre: body('<svg><path d="M0 0h1"/></svg>') }, ['svg-name']],
  ['svg role img without a name', { pre: body('<svg role="img"><path d="M0 0h1"/></svg>') }, ['svg-name']],
  ['svg with aria-label', { pre: body('<svg role="img" aria-label="Karte"><path d="M0 0h1"/></svg>') }, []],
  // media
  ['video captions in another language', { pre: (h) => h.replace('srclang="de"', 'srclang="fr"') }, ['media-captions']],
  ['video subtitles only', { pre: (h) => h.replace('kind="captions"', 'kind="subtitles"') }, ['media-captions']],
  ['video captions as de-CH', { pre: (h) => h.replace('srclang="de"', 'srclang="de-CH"') }, []],
  [
    'audio without a transcript link',
    { pre: (h) => h.replace('Transkript des Vortrags', 'Vortrag') },
    ['media-captions'],
  ],
  // forms
  ['label without required or optional', { pre: (h) => h.replace('Name (Pflichtfeld)', 'Name') }, ['forms-fields']],
  [
    'field without a label',
    { pre: (h) => h.replace('<label for="name">Name (Pflichtfeld)</label>', '') },
    ['forms-fields'],
  ],
  ['field without autocomplete', { pre: (h) => h.replace(' autocomplete="email"', '') }, ['forms-fields']],
  [
    'field with a placeholder',
    { pre: (h) => h.replace('autocomplete="name"', 'autocomplete="name" placeholder="Max"') },
    ['forms-fields'],
  ],
  ['honeypot outside inert', { pre: (h) => h.replace('<div inert>', '<div>') }, ['forms-fields']],
  [
    'file input',
    { pre: (h) => h.replace('<button type="submit">', '<input type="file" name="cv"><button type="submit">') },
    ['forms-safety'],
  ],
  ['pre-checked checkbox', { pre: (h) => h.replace('name="copy"', 'name="copy" checked') }, ['forms-safety']],
  [
    'POST form without privacy link',
    { pre: (h) => h.replace('<p><a href="/datenschutz/">Datenschutz</a></p>', '') },
    ['forms-safety'],
  ],
  [
    'GET form without privacy link',
    {
      pre: (h) =>
        h.replace('<p><a href="/datenschutz/">Datenschutz</a></p>', '').replace('method="post"', 'method="get"'),
    },
    [],
  ],
];

for (const [name, c, expected] of CASES) {
  test(name, () => assert.deepEqual(run(c), expected));
}

test('animated images fail, still images pass', () => {
  for (const kind of ['gif', 'png', 'webp', 'avif']) {
    const image = (file: string) =>
      run({ pre: body(`<img src="/_astro/${file}.${kind}" width="1" height="1" alt="">`) });
    assert.deepEqual(image('still'), [], `still ${kind}`);
    assert.deepEqual(image('anim'), ['media-animated'], `animated ${kind}`);
  }
  assert.deepEqual(run({ pre: (h) => h.replace('poster="/_astro/still.webp"', 'poster="/_astro/anim.webp"') }), [
    'media-animated',
  ]);
  assert.deepEqual(run({ pre: (h) => h.replace('/_astro/team-2.avif', '/_astro/anim.avif') }), ['media-animated']);
});

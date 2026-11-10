import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { auditEdge } from '../../src/audit/edge.ts';
import { parseHtml } from '../../src/build.ts';
import type { BuildContext, BuiltPage, RedirectRow } from '../../src/context.ts';
import { headerCsp } from '../../src/csp.ts';
import {
  headersFile,
  IMMUTABLE,
  PERMISSIONS_POLICY,
  PREFETCH_HTML,
  parseHeaders,
  redirectsFile,
  robotsTxt,
  securityTxt,
  sitemapXml,
  writeEdgeFiles,
} from '../../src/hosts/cloudflare.ts';
import type { Manifest, PageRecord } from '../../src/manifest.ts';
import { effectiveLimits, type KitOptions } from '../../src/options.ts';
import { Report } from '../../src/registry.ts';

const SITE = 'https://example.ch';
const BASE: KitOptions = {
  site: SITE,
  locales: [
    { code: 'de', tag: 'de-CH', name: 'Deutsch' },
    { code: 'fr', tag: 'fr-CH', name: 'Français' },
  ],
  defaultLocale: 'de',
  nav: [],
  features: { forms: false, islands: false, scripts: false },
  prefetch: { speculationRules: true, astroPrefetch: false },
  securityContact: 'mailto:security@example.ch',
  dependencies: [],
  limits: {},
};
const opts = (
  features: Partial<KitOptions['features']> = {},
  prefetch: Partial<KitOptions['prefetch']> = {},
): KitOptions => ({
  ...BASE,
  features: { ...BASE.features, ...features },
  prefetch: { ...BASE.prefetch, ...prefetch },
});
/** What @astrojs/cloudflare 14 writes when it runs before the kit. */
const ADAPTER = `/_astro/*\n  Cache-Control: ${IMMUTABLE}\n`;
const ASSET = '/_astro/index.Bc1d2.css';
const PATHS = ['/', '/leistungen/', '/fr/prestations/', '/robots.txt', ASSET];
const cacheLines = (text: string): number => text.split('\n').filter((l) => /^\s+Cache-Control:/i.test(l)).length;

/**
 * What Cloudflare sends for a path, as the asset worker applies _headers: matching rules in file order,
 * each rule's `! Name` detaches first, then its headers are set, and a repeated header is comma-joined.
 */
function resolve(text: string, path: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const rule of parseHeaders(text)) {
    const source = rule.pattern
      .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*')
      .replace(/:[A-Za-z]\w*/g, '[^/]+');
    if (!new RegExp(`^${source}$`).test(path)) continue;
    for (const line of rule.lines) if (line.startsWith('!')) out.delete(line.slice(1).trim().toLowerCase());
    for (const line of rule.lines) {
      if (line.startsWith('!')) continue;
      const name = line.slice(0, line.indexOf(':')).trim().toLowerCase();
      const value = line.slice(line.indexOf(':') + 1).trim();
      const prior = out.get(name);
      out.set(name, prior === undefined ? value : `${prior}, ${value}`);
    }
  }
  return out;
}
const cacheOf = (text: string, path: string): string | undefined => resolve(text, path).get('cache-control');
/** The Cache-Control every probe path gets, as path → value. */
const caching = (text: string): Record<string, string | undefined> =>
  Object.fromEntries(PATHS.map((p) => [p, cacheOf(text, p)]));
const expected = (html: string | undefined, asset: string | undefined) =>
  Object.fromEntries(PATHS.map((p) => [p, p === ASSET ? asset : html]));

// ── _headers ────────────────────────────────────────────────────────────────

test('static site: security headers on every path, immutable on assets only', () => {
  const options = opts();
  const file = headersFile(options);
  for (const path of PATHS) {
    const h = resolve(file, path);
    assert.equal(h.get('content-security-policy'), headerCsp(options));
    assert.equal(h.get('strict-transport-security'), 'max-age=31536000; includeSubDomains');
    assert.equal(h.get('x-content-type-options'), 'nosniff');
    assert.equal(h.get('referrer-policy'), 'strict-origin-when-cross-origin');
    assert.equal(h.get('cross-origin-opener-policy'), 'same-origin');
    assert.equal(h.get('cross-origin-resource-policy'), 'same-origin');
    assert.equal(h.get('permissions-policy'), PERMISSIONS_POLICY);
  }
  assert.deepEqual(caching(file), expected(undefined, IMMUTABLE));
  assert.match(PERMISSIONS_POLICY, /^accelerometer=\(\), autoplay=\(self\), bluetooth=\(\), /);
  assert.match(PERMISSIONS_POLICY, /fullscreen=\(self\), geolocation=\(\)/);
  assert.match(PERMISSIONS_POLICY, /usb=\(\), xr-spatial-tracking=\(\)$/);
  assert.equal(PERMISSIONS_POLICY.split(', ').length, 21);
  assert.deepEqual(
    parseHeaders(file).map((r) => r.pattern),
    ['/*', '/_astro/*'],
  );
});

test('astroPrefetch: HTML gets max-age=120 and assets detach it before immutable', () => {
  const file = headersFile(opts({}, { astroPrefetch: true }));
  assert.deepEqual(caching(file), expected(PREFETCH_HTML, IMMUTABLE));
  assert.match(file, /\/_astro\/\*\n {2}! Cache-Control\n {2}Cache-Control: public, max-age=31536000, immutable\n/);
  // Without the detach, or with /* after /_astro/*, assets would get both values.
  assert.equal(cacheOf(file.replace('  ! Cache-Control\n', ''), ASSET), `${PREFETCH_HTML}, ${IMMUTABLE}`);
  const [all, assets] = parseHeaders(file);
  const swapped = [assets, all]
    .map((r) => [r?.pattern, ...(r?.lines ?? []).map((l) => `  ${l}`)].join('\n'))
    .join('\n');
  assert.equal(cacheOf(swapped, ASSET), `${IMMUTABLE}, ${PREFETCH_HTML}`);
});

test('forms: no kit asset rule; an adapter rule written first stays, once, after /*', () => {
  const options = opts({ forms: true });
  const alone = headersFile(options);
  assert.equal(parseHeaders(alone).length, 1);
  assert.equal(cacheLines(alone), 0);
  const merged = headersFile(options, ADAPTER);
  assert.equal(cacheLines(merged), 1);
  assert.deepEqual(
    parseHeaders(merged).map((r) => r.pattern),
    ['/*', '/_astro/*'],
  );
  assert.deepEqual(caching(merged), expected(undefined, IMMUTABLE));
});

test('forms with astroPrefetch: the detach joins the adapter rule, or the kit writes the rule', () => {
  const options = opts({ forms: true }, { astroPrefetch: true });
  for (const existing of ['', ADAPTER]) {
    const file = headersFile(options, existing);
    assert.equal(cacheLines(file), 2, file);
    assert.deepEqual(caching(file), expected(PREFETCH_HTML, IMMUTABLE));
  }
});

test('forms: the real adapter, run after the kit, ends with one asset rule', async (t) => {
  const url = new URL('../../node_modules/@astrojs/cloudflare/dist/utils/headers.js', import.meta.url);
  if (!existsSync(url)) return t.skip('@astrojs/cloudflare is not installed');
  type Inject = (o: object, read: () => Promise<string>) => Promise<{ content: string } | null>;
  const { buildAssetsHeadersContent } = (await import(url.href)) as { buildAssetsHeadersContent: Inject };
  for (const astroPrefetch of [false, true]) {
    const kit = headersFile(opts({ forms: true }, { astroPrefetch }));
    const result = await buildAssetsHeadersContent(
      { assetsDir: '_astro', basePrefix: '', headersPath: '' },
      async () => kit,
    );
    const file = result?.content ?? kit;
    assert.equal(cacheLines(file), astroPrefetch ? 2 : 1, file);
    assert.deepEqual(caching(file), expected(astroPrefetch ? PREFETCH_HTML : undefined, IMMUTABLE));
  }
});

test('headers merge keeps foreign rules and replaces kit headers on /*', () => {
  const existing = '# adapter\n/*\n  X-Content-Type-Options: sniff\n  X-Extra: 1\n/api/*\n  X-Robots-Tag: noindex\n';
  const file = headersFile(opts(), existing);
  assert.equal(resolve(file, '/').get('x-content-type-options'), 'nosniff');
  assert.equal(resolve(file, '/').get('x-extra'), '1');
  assert.equal(resolve(file, '/api/contact').get('x-robots-tag'), 'noindex');
  assert.deepEqual(caching(file), expected(undefined, IMMUTABLE));
  assert.ok(!file.includes('#'));
});

// ── _redirects ──────────────────────────────────────────────────────────────

test('redirects: static before dynamic, adapter path rules kept, host rules dropped', () => {
  const lines = ['/alt/ /neu/ 301', '/blog/* /news/:splat 301'];
  const existing =
    '/legacy/ /neu/ 301\n/alt/ /other/ 302\nhttps://www.example.ch/* https://example.ch/:splat 301\n/x/:id /y/ 301\n';
  assert.equal(
    redirectsFile(lines, existing),
    '/alt/ /neu/ 301\n/legacy/ /neu/ 301\n/blog/* /news/:splat 301\n/x/:id /y/ 301\n',
  );
  assert.equal(redirectsFile([], ''), '');
});

// ── sitemap, robots, security.txt ───────────────────────────────────────────

const record = (path: string, extra: Partial<PageRecord> = {}): PageRecord => ({
  id: path,
  locale: 'de',
  entryId: `de${path}`,
  file: `src/content/pages/de${path}.md`,
  slug: path,
  path,
  title: path,
  description: path,
  draft: false,
  missing: [],
  ...extra,
});
const page = (path: string, head: string, extra?: Partial<PageRecord>, is404 = false): BuiltPage => {
  const html = `<!doctype html><html lang="de-CH"><head>${head}</head><body><main><h1>x</h1></main></body></html>`;
  const built: BuiltPage = { file: `/dist${path}index.html`, path, html, doc: parseHtml(html), locale: 'de', is404 };
  if (extra) built.record = record(path, extra);
  return built;
};
const canonical = (path: string): string => `<link rel="canonical" href="${SITE}${path}">`;

test('sitemap lists self-canonical indexable pages, sorted, lastmod from updated only', () => {
  const pages = [
    page('/leistungen/', canonical('/leistungen/'), { updated: '2026-10-01', date: '2026-01-01' }),
    page('/', canonical('/'), { date: '2026-01-01' }),
    page('/fr/', canonical('/fr/')),
    page('/a&b/', canonical('/a&b/')),
    page('/kopie/', canonical('/leistungen/'), {}),
    page('/entwurf/', `${canonical('/entwurf/')}<meta name="robots" content="noindex, follow">`, {}),
    page('/ohne/', '', {}),
    page('/doppelt/', canonical('/doppelt/') + canonical('/doppelt/'), {}),
    page('/404.html', `<meta name="robots" content="noindex">${canonical('/404.html')}`, undefined, true),
  ];
  assert.equal(
    sitemapXml(pages, SITE),
    [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
      '<url><loc>https://example.ch/</loc></url>',
      '<url><loc>https://example.ch/a&amp;b/</loc></url>',
      '<url><loc>https://example.ch/fr/</loc></url>',
      '<url><loc>https://example.ch/leistungen/</loc><lastmod>2026-10-01</lastmod></url>',
      '</urlset>',
      '',
    ].join('\n'),
  );
  assert.equal(sitemapXml([], SITE).split('\n').length, 4);
});

test('robots.txt allows all, signals content use and names the sitemap', () => {
  assert.equal(
    robotsTxt(SITE),
    'User-agent: *\nAllow: /\nContent-Signal: search=yes, ai-input=yes, ai-train=no\n\nSitemap: https://example.ch/sitemap.xml\n',
  );
});

test('security.txt expires 180 days after the build', () => {
  assert.equal(
    securityTxt(BASE, new Date('2026-11-10T08:30:00.123Z')),
    [
      'Contact: mailto:security@example.ch',
      'Expires: 2027-05-09T08:30:00Z',
      'Preferred-Languages: de, fr',
      'Canonical: https://example.ch/.well-known/security.txt',
      '',
    ].join('\n'),
  );
});

// ── writeEdgeFiles ──────────────────────────────────────────────────────────

function context(
  options: KitOptions,
  pages: BuiltPage[],
  redirects: RedirectRow[],
  env: Record<string, string>,
): BuildContext {
  const manifest: Manifest = { pages: [], byId: {}, drafts: false };
  return {
    root: '/project',
    dist: mkdtempSync(join(tmpdir(), 'kit-host-')),
    options,
    limits: effectiveLimits(options),
    manifest,
    site: undefined,
    schedule: {} as BuildContext['schedule'],
    messages: {},
    pages,
    css: [],
    files: ['index.html'],
    redirects,
    wrangler: undefined,
    report: new Report(),
    env,
  };
}
const EDGE_FILES = [
  '_headers',
  '_redirects',
  'sitemap.xml',
  'robots.txt',
  '.well-known/security.txt',
  '_kit/release.txt',
];

test('writeEdgeFiles writes every edge file and merges the adapter output', () => {
  const rows: RedirectRow[] = [
    { from: '/alt/', to: '/' },
    { from: '/weg/', gone: true },
  ];
  const ctx = context(opts({ forms: true }), [page('/', canonical('/'), {})], rows, { GITHUB_SHA: 'abc123' });
  writeFileSync(join(ctx.dist, '_headers'), ADAPTER);
  writeFileSync(join(ctx.dist, '_redirects'), '/old/* /:splat 301\n');
  writeEdgeFiles(ctx, '0.1.0');
  const read = (name: string): string => readFileSync(join(ctx.dist, name), 'utf8');
  assert.deepEqual(ctx.report.findings, []);
  assert.equal(read('_headers'), headersFile(ctx.options, ADAPTER));
  assert.equal(cacheLines(read('_headers')), 1);
  assert.equal(read('_redirects'), '/alt/ / 301\n/old/* /:splat 301\n');
  assert.match(read('sitemap.xml'), /<url><loc>https:\/\/example\.ch\/<\/loc><\/url>/);
  assert.equal(read('robots.txt'), robotsTxt(SITE));
  assert.match(
    read('.well-known/security.txt'),
    /^Contact: mailto:security@example\.ch\nExpires: \d{4}-\d\d-\d\dT[\d:]{8}Z\n/,
  );
  assert.equal(read('_kit/release.txt'), 'abc123\n@raess/astro-kit 0.1.0\n');
  assert.deepEqual(ctx.files, ['index.html', ...EDGE_FILES]);
});

test('writeEdgeFiles without a commit writes local; auditEdge reports the redirect limits once', () => {
  const rows = Array.from({ length: 101 }, (_, i): RedirectRow => ({ from: `/a${i}/*`, to: '/' }));
  const ctx = context(opts(), [], rows, {});
  writeEdgeFiles(ctx, '0.1.0');
  assert.equal(readFileSync(join(ctx.dist, '_kit/release.txt'), 'utf8'), 'local\n@raess/astro-kit 0.1.0\n');
  assert.deepEqual([...ctx.report.ids()], []);
  auditEdge(ctx);
  assert.deepEqual(
    ctx.report.findings.map((f) => f.rule),
    ['edge-redirects'],
  );
  for (const f of EDGE_FILES) assert.ok(existsSync(join(ctx.dist, f)), f);
});

import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';
import { brotliCompressSync, constants, zstdCompressSync } from 'node:zlib';
import { auditBudgets, compressedSize, domStats, headOf } from '../../src/audit/budgets.ts';
import { auditEdge } from '../../src/audit/edge.ts';
import { parseHtml } from '../../src/build.ts';
import type { BuildContext } from '../../src/context.ts';
import { headerCsp } from '../../src/csp.ts';
import { headersFile } from '../../src/hosts/cloudflare.ts';
import { effectiveLimits, optionsSchema } from '../../src/options.ts';
import { Report } from '../../src/registry.ts';

const BASE = {
  site: 'https://example.ch',
  locales: [{ code: 'de', tag: 'de-CH', name: 'Deutsch' }],
  defaultLocale: 'de',
  securityContact: 'mailto:security@example.ch',
};

const dirs: string[] = [];
after(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

/** A context over a temporary dist that holds the given files. */
function context(
  pages: Record<string, string>,
  files: Record<string, string | Buffer> = {},
  extra: object = {},
): BuildContext {
  const dist = mkdtempSync(join(tmpdir(), 'kit-budgets-'));
  dirs.push(dist);
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dist, path)), { recursive: true });
    writeFileSync(join(dist, path), body);
  }
  const options = optionsSchema.parse({ ...BASE, ...extra });
  return {
    root: dist,
    dist,
    options,
    limits: effectiveLimits(options),
    manifest: { pages: [], byId: {}, drafts: false },
    site: undefined,
    schedule: { openingHours: [], closures: [] },
    messages: {},
    pages: Object.entries(pages).map(([path, html]) => ({
      file: join(dist, path, 'index.html'),
      path,
      html,
      doc: parseHtml(html),
      locale: 'de',
      is404: false,
    })),
    css: [],
    files: Object.keys(files),
    redirects: [],
    wrangler: undefined,
    report: new Report(),
    env: {},
  };
}

const page = (head: string, body = '<p>Text</p>') =>
  `<!DOCTYPE html><html lang="de"><head><meta charset="utf-8">${head}</head><body><main>${body}</main></body></html>`;
/** Text that barely compresses: n random bytes as base64. */
const noise = (n: number) => randomBytes(n).toString('base64');
const rules = (ctx: BuildContext) => ctx.report.findings.map((f) => f.rule);

test('compressedSize is the larger of zstd 3 and brotli 5', () => {
  const text = `${noise(3000)}${'repeat '.repeat(500)}`;
  const zstd = zstdCompressSync(Buffer.from(text), { params: { [constants.ZSTD_c_compressionLevel]: 3 } }).length;
  const brotli = brotliCompressSync(text, { params: { [constants.BROTLI_PARAM_QUALITY]: 5 } }).length;
  assert.equal(compressedSize(text), Math.max(zstd, brotli));
  assert.equal(compressedSize(''), 0);
  assert.equal(
    headOf('<html><head><title>x</title></head><body>y</body></html>'),
    '<html><head><title>x</title></head>',
  );
});

test('budget-head and budget-document fail over the limit and print the breakdown', () => {
  const head = `<meta http-equiv="content-security-policy" content="default-src 'self'"><style>a{b:c}/*${noise(2000)}*/</style><script type="application/ld+json">{"a":1}</script>`;
  const ctx = context(
    { '/': page(head, `<p>${noise(2000)}</p>`) },
    {},
    { limits: { headBytes: 2000, documentBytes: 4000 } },
  );
  auditBudgets(ctx);
  assert.deepEqual(rules(ctx), ['budget-head', 'budget-document']);
  for (const f of ctx.report.findings)
    assert.match(f.detail ?? '', /KB > .* KB: markup .* KB, CSS .* KB, CSP meta .* KB, JSON-LD .* KB$/);

  const small = context({ '/': page('<title>Klein</title>') });
  auditBudgets(small);
  assert.deepEqual(rules(small), []);
});

test('budget-dom counts elements and depth', () => {
  const nest = (n: number) => `${'<div>'.repeat(n)}x${'</div>'.repeat(n)}`;
  assert.deepEqual(domStats(parseHtml('<html><head></head><body><p>a</p></body></html>')), { elements: 4, depth: 3 });
  const deep = context({ '/': page('', nest(32)) });
  auditBudgets(deep);
  assert.deepEqual(rules(deep), ['budget-dom']);
  const ok = context({ '/': page('', nest(28)) });
  auditBudgets(ok);
  assert.deepEqual(rules(ok), []);
  const wide = context({ '/': page('', '<p>x</p>'.repeat(60)) }, {}, { limits: { domElements: 50 } });
  auditBudgets(wide);
  assert.deepEqual(rules(wide), ['budget-dom']);
});

test('budget-fonts sums the font files pages reference, once each', () => {
  const html = page(
    '<link rel="preload" href="/_astro/a.woff2" as="font" type="font/woff2" crossorigin><style>@font-face{src:url(/_astro/b.woff2)}</style>',
  );
  const big = context(
    { '/': html, '/x/': html },
    { '_astro/a.woff2': randomBytes(60_000), '_astro/b.woff2': randomBytes(50_000) },
  );
  auditBudgets(big);
  assert.deepEqual(rules(big), ['budget-fonts']);
  assert.match(big.report.findings[0]?.detail ?? '', /107\.4 KB > 100\.0 KB/);
  const ok = context(
    { '/': html, '/x/': html },
    { '_astro/a.woff2': randomBytes(40_000), '_astro/b.woff2': randomBytes(40_000) },
  );
  auditBudgets(ok);
  assert.deepEqual(rules(ok), []);
});

test('js-budget: island JS with its static imports, only with features.islands', () => {
  const island =
    '<astro-island component-url="/_astro/C.js" renderer-url="/_astro/client.js" ssr client="visible"><button type="button">0</button></astro-island>';
  const files = (size: number) => ({
    '_astro/C.js': `import{a}from"./dep.js";import("./lazy.js");export default a;`,
    '_astro/client.js': 'export default 1;',
    '_astro/dep.js': `export const a="${noise(size)}";`,
    '_astro/lazy.js': `export const b="${noise(40_000)}";`,
  });
  const big = context({ '/': page('', island) }, files(25_000), { features: { islands: true } });
  auditBudgets(big);
  assert.deepEqual(rules(big), ['js-budget']);
  assert.match(big.report.findings[0]?.detail ?? '', /^island JS .* > 20\.0 KB: .*\/_astro\/dep\.js/);
  assert.doesNotMatch(big.report.findings[0]?.detail ?? '', /lazy/);
  const ok = context({ '/': page('', island) }, files(5_000), { features: { islands: true } });
  auditBudgets(ok);
  assert.deepEqual(rules(ok), []);
  const off = context({ '/': page('', island) }, files(25_000));
  auditBudgets(off);
  assert.deepEqual(rules(off), []);
});

test('js-budget: the prefetch chunk stays within 2 KB with astroPrefetch', () => {
  const html = page('<script type="module" src="/_astro/page.js"></script>');
  const chunk = (size: number) => ({
    '_astro/page.js': `import{p}from"./prefetch.js";HTMLScriptElement.supports?.("speculationrules")||p();`,
    '_astro/prefetch.js': `export const p=()=>"${noise(size)}";`,
  });
  const big = context({ '/': html }, chunk(3_000), { prefetch: { astroPrefetch: true } });
  auditBudgets(big);
  assert.deepEqual(rules(big), ['js-budget']);
  assert.match(big.report.findings[0]?.detail ?? '', /^prefetch JS .* > 2\.0 KB/);
  const ok = context({ '/': html }, chunk(500), { prefetch: { astroPrefetch: true } });
  auditBudgets(ok);
  assert.deepEqual(rules(ok), []);
});

test('js-budget: the prefetch chunk is found by its path, also when the minifier removed the speculationrules gate', () => {
  // With speculationRules off, the gate is `false && …`, which the minifier drops with its string.
  const html = page('<script type="module" src="/_astro/page.C7OqX83G.js"></script>');
  const files = { '_astro/page.C7OqX83G.js': `document.addEventListener("pointerover",()=>"${noise(3_000)}");` };
  const big = context({ '/': html }, files, { prefetch: { speculationRules: false, astroPrefetch: true } });
  auditBudgets(big);
  assert.deepEqual(rules(big), ['js-budget']);
  assert.match(big.report.findings[0]?.detail ?? '', /^prefetch JS .* > 2\.0 KB/);
});

test('js-budget: astroPrefetch without a prefetch chunk on the page is a finding, never a silent skip', () => {
  const missing = context({ '/': page('') }, {}, { prefetch: { astroPrefetch: true } });
  auditBudgets(missing);
  assert.deepEqual(rules(missing), ['js-budget']);
  assert.match(missing.report.findings[0]?.detail ?? '', /no \/_astro\/page\.\*\.js/);
});

/** A valid _headers for the default options, written by hand. */
const HEADERS = () =>
  [
    '/*',
    `  Content-Security-Policy: ${headerCsp(optionsSchema.parse(BASE))}`,
    '  Strict-Transport-Security: max-age=31536000; includeSubDomains',
    '  X-Content-Type-Options: nosniff',
    '  Referrer-Policy: strict-origin-when-cross-origin',
    '  Cross-Origin-Opener-Policy: same-origin',
    '  Cross-Origin-Resource-Policy: same-origin',
    '  Permissions-Policy: camera=(), fullscreen=(self)',
    '/_astro/*',
    '  Cache-Control: public, max-age=31536000, immutable',
    '',
  ].join('\n');

/** Runs the edge audit on the given dist files and returns the finding details. */
function edge(files: Record<string, string>, extra: object = {}): string[] {
  const ctx = context({}, files, extra);
  auditEdge(ctx);
  return ctx.report.findings.map((f) => `${f.rule} ${f.where}: ${f.detail}`);
}

test('edge-headers: the kit shape passes, including what the host writer produces', () => {
  assert.deepEqual(edge({ _headers: HEADERS(), _redirects: '/alt/ /neu/ 301\n/blog/* /news/:splat 301\n' }), []);
  for (const extra of [
    {},
    { features: { scripts: true } },
    { features: { islands: true } },
    { prefetch: { astroPrefetch: true } },
    { features: { forms: true }, contact: { to: 'a@example.ch', from: 'form@example.ch' } },
  ]) {
    const options = optionsSchema.parse({ ...BASE, ...extra });
    assert.deepEqual(edge({ _headers: headersFile(options) }, extra), [], JSON.stringify(extra));
  }
});

test('edge-headers: missing or wrong security headers fail', () => {
  assert.deepEqual(edge({}), ['edge-headers _headers: missing from dist']);
  assert.deepEqual(edge({ _headers: HEADERS().replace('  X-Content-Type-Options: nosniff\n', '') }), [
    'edge-headers /*: x-content-type-options is missing',
  ]);
  assert.equal(edge({ _headers: HEADERS().replace('same-origin\n  Cross', 'unsafe-none\n  Cross') }).length, 1);
  assert.equal(edge({ _headers: HEADERS().replace('max-age=31536000; includeSubDomains', 'max-age=600') }).length, 1);
  assert.equal(edge({ _headers: HEADERS().replace('camera=()', 'camera=*') }).length, 1);
  assert.equal(edge({ _headers: HEADERS().replace('/_astro/*', '  X-Frame-Options: DENY\n/_astro/*') }).length, 1);
  // Trusted Types must match the features: islands turn it off.
  assert.equal(edge({ _headers: HEADERS() }, { features: { islands: true } }).length, 1);
});

test('edge-headers: Cache-Control only on /_astro/*, and the astroPrefetch shape', () => {
  assert.deepEqual(edge({ _headers: `${HEADERS()}/fr/*\n  Cache-Control: no-store\n` }), [
    'edge-headers /fr/*: sets Cache-Control no-store',
  ]);
  assert.deepEqual(
    edge({ _headers: HEADERS().replace('  Cache-Control: public, max-age=31536000, immutable\n', '') }),
    ['edge-headers /_astro/*: Cache-Control public, max-age=31536000, immutable is missing'],
  );
  const prefetch = { prefetch: { astroPrefetch: true } };
  const withHtml = HEADERS().replace('/_astro/*\n', '  Cache-Control: public, max-age=120\n/_astro/*\n');
  assert.deepEqual(edge({ _headers: withHtml.replace('/_astro/*\n', '/_astro/*\n  ! Cache-Control\n') }, prefetch), []);
  assert.deepEqual(edge({ _headers: withHtml }, prefetch), [
    'edge-headers /_astro/*: must detach the HTML Cache-Control with ! Cache-Control',
  ]);
  assert.deepEqual(edge({ _headers: withHtml }), ['edge-headers /*: sets Cache-Control public, max-age=120']);
});

test('edge-headers: Cloudflare limits and duplicate patterns', () => {
  const many = Array.from({ length: 99 }, (_, i) => `/p${i}/\n  X-Robots-Tag: noindex`).join('\n');
  assert.deepEqual(edge({ _headers: `${HEADERS()}${many}\n` }), ['edge-headers _headers: 101 rules, limit 100']);
  assert.equal(
    edge({ _headers: HEADERS().replace('camera=()', `camera=(), ${'usb=(), '.repeat(300)}midi=()`) }).length,
    1,
  );
  assert.deepEqual(edge({ _headers: `${HEADERS()}/_astro/*\n  X-Robots-Tag: noindex\n` }), [
    'edge-headers /_astro/*: pattern appears twice; Cloudflare merges the values',
  ]);
});

test('edge-redirects: Cloudflare limits and line shape', () => {
  const ok = { _headers: HEADERS() };
  const statics = Array.from({ length: 2001 }, (_, i) => `/a${i}/ /b/ 301`).join('\n');
  assert.deepEqual(edge({ ...ok, _redirects: statics }), ['edge-redirects _redirects: 2001 static rules, limit 2000']);
  const dynamics = Array.from({ length: 101 }, (_, i) => `/a${i}/* /b/:splat 301`).join('\n');
  assert.deepEqual(edge({ ...ok, _redirects: dynamics }), ['edge-redirects _redirects: 101 dynamic rules, limit 100']);
  assert.equal(edge({ ...ok, _redirects: `/${'x'.repeat(1000)}/ /b/ 301` }).length, 1);
  assert.equal(edge({ ...ok, _redirects: '/a/ /b/ 200' }).length, 1);
  assert.equal(edge({ ...ok, _redirects: 'https://old.example.ch/ /' }).length, 1);
});

test('routes-redirects: every redirect target is built, so no old URL lands on a 404', () => {
  const html = page('');
  const ctx = context({ '/': html, '/neu/': html }, { _headers: HEADERS(), 'brochure.pdf': '%PDF' });
  ctx.redirects = [
    { from: '/alt/', to: '/neu/' },
    { from: '/alt-ohne-slash/', to: '/neu' },
    { from: '/prospekt/', to: '/brochure.pdf' },
    { from: '/blog/*', to: '/news/:splat' },
    { from: '/weg/', gone: true },
    { from: '/vertippt/', to: '/nue/' },
  ];
  auditEdge(ctx);
  assert.deepEqual(
    ctx.report.findings.map((f) => `${f.rule} ${f.where}: ${f.detail}`),
    ['routes-redirects src/content/redirects.json: /vertippt/ → /nue/, which is not built'],
  );
});

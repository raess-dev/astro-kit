import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { IMMUTABLE, robotsTxt, securityHeaders } from '../../src/hosts/cloudflare.ts';
import { loadOptions } from '../../src/options.ts';
import { Report } from '../../src/registry.ts';
import { HTML_CACHE, runSmoke, txtValue } from '../../src/smoke.ts';

const NOW = new Date('2026-11-10T12:00:00Z');
const SHA = 'a'.repeat(40);
const PAGE_404 =
  '<!doctype html><html lang="de-CH"><head><meta name="robots" content="noindex"></head><body><h1>Nicht gefunden</h1></body></html>';
const ROBOTS = 'User-agent: *\nAllow: /\n';

/** A project root with astro-kit.json (forms on) and the dist files smoke compares with. */
function project(forms = true): string {
  const root = mkdtempSync(join(tmpdir(), 'kit-smoke-'));
  const options = {
    site: 'https://example.ch',
    locales: [
      { code: 'de', tag: 'de-CH', name: 'Deutsch' },
      { code: 'fr', tag: 'fr-CH', name: 'Français' },
    ],
    defaultLocale: 'de',
    features: { forms },
    ...(forms ? { contact: { to: 'info@example.ch', from: 'form@example.ch' } } : {}),
    securityContact: 'mailto:security@example.ch',
  };
  writeFileSync(join(root, 'astro-kit.json'), JSON.stringify(options));
  mkdirSync(join(root, 'dist'));
  writeFileSync(join(root, 'dist/index.html'), '<!doctype html>');
  writeFileSync(join(root, 'dist/404.html'), PAGE_404);
  writeFileSync(join(root, 'dist/robots.txt'), ROBOTS);
  return root;
}

const ROOT = project();
const OPTIONS = loadOptions(ROOT, new Report());
assert.ok(OPTIONS);
const KIT_HEADERS = Object.fromEntries(securityHeaders(OPTIONS));

type Route = (init: RequestInit) => Response;
const html = (body: string, extra: Record<string, string> = {}, status = 200) =>
  new Response(body, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': HTML_CACHE,
      'content-encoding': 'br',
      'alt-svc': 'h3=":443"; ma=86400',
      ...KIT_HEADERS,
      ...extra,
    },
  });
const HOME = '<!doctype html><meta property="og:image" content="https://example.ch/_astro/og.abc.jpg"><h1>Start</h1>';
const dns =
  (...data: string[]) =>
  () =>
    Response.json({ Status: 0, Answer: data.map((d) => ({ type: 16, data: d })) });

const asset = (headers: Record<string, string>) => () =>
  new Response('jpg', { headers: { ...KIT_HEADERS, 'cache-control': IMMUTABLE, ...headers } });
const moved =
  (location: string, status = 301) =>
  () =>
    Response.redirect(location, status);

function routes(): Record<string, Route> {
  return {
    'GET https://example.ch/': () => html(HOME),
    'GET https://example.ch/fr/': () => html('<h1>Accueil</h1>'),
    'GET https://example.ch/kit-smoke-x/': () => html(PAGE_404, {}, 404),
    'GET https://example.ch/_astro/og.abc.jpg': asset({ 'content-type': 'image/jpeg' }),
    'GET http://example.ch/': moved('https://example.ch/'),
    'GET https://www.example.ch/': moved('https://example.ch/'),
    'GET https://example.ch/robots.txt': () => new Response(ROBOTS, { headers: { 'content-type': 'text/plain' } }),
    'GET https://example.ch/_kit/release.txt': () => new Response(`${SHA}\n@raess/astro-kit 0.1.0\n`),
    'GET https://example.ch/.well-known/security.txt': () =>
      new Response('Contact: mailto:security@example.ch\nExpires: 2027-05-09T12:00:00Z\n'),
    'GET https://cloudflare-dns.com/dns-query?name=example.ch&type=TXT': dns(
      '"v=spf1 include:_spf.mx.cloudflare.net "  "~all"',
      '"google-site-verification=x"',
    ),
    'GET https://cloudflare-dns.com/dns-query?name=_dmarc.example.ch&type=TXT': dns('"v=DMARC1; p=reject"'),
    'POST https://example.ch/api/contact/': (init) =>
      new Response(null, {
        status: 303,
        headers: {
          location:
            (init.headers as Record<string, string>)['x-kit-probe'] === 'secret'
              ? '/kontakt/#sent'
              : '/kontakt/#not-sent',
        },
      }),
  };
}

/** A fetch over the routes; an unknown host fails like DNS does. */
function fakeFetch(table: Record<string, Route>, calls: string[] = []): typeof fetch {
  return ((input: string | URL | Request, init: RequestInit = {}) => {
    const key = `${init.method ?? 'GET'} ${String(input).replace(/kit-smoke-[a-z0-9]+/, 'kit-smoke-x')}`;
    calls.push(key);
    const route = table[key];
    if (!route) return Promise.reject(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } }));
    return Promise.resolve(route(init));
  }) as typeof fetch;
}

const smoke = (
  table: Record<string, Route>,
  calls: string[] = [],
  env: Record<string, string> = { KIT_PROBE_SECRET: 'secret' },
) =>
  runSmoke('https://example.ch', {
    root: ROOT,
    expectedSha: SHA,
    workersDev: 'example.acct.workers.dev',
    probe: true,
    env,
    fetch: fakeFetch(table, calls),
    now: NOW,
  });

test('a production site that matches the kit passes every smoke check', async () => {
  const calls: string[] = [];
  const report = await smoke(routes(), calls);
  assert.deepEqual(report.findings, []);
  assert.ok(calls.includes('POST https://example.ch/api/contact/'));
  assert.ok(calls.includes('GET https://example.acct.workers.dev/'));
});

test('without a local build, robots.txt is compared with the one the kit writes for the site', async () => {
  const root = project();
  rmSync(join(root, 'dist'), { recursive: true, force: true });
  const run = (robots: string) =>
    runSmoke('https://example.ch', {
      root,
      expectedSha: SHA,
      workersDev: 'example.acct.workers.dev',
      env: {},
      fetch: fakeFetch({ ...routes(), 'GET https://example.ch/robots.txt': () => new Response(robots) }),
      now: NOW,
    });
  const ids = async (robots: string) => [...(await run(robots)).ids()].filter((id) => id === 'smoke-robots');
  assert.deepEqual(await ids(robotsTxt('https://example.ch')), []);
  assert.deepEqual(await ids('User-agent: *\nDisallow: /\n'), ['smoke-robots']);
});

test('the weekly probe skips a site without forms: no post, no finding', async () => {
  const calls: string[] = [];
  const report = await runSmoke('https://example.ch', {
    root: project(false),
    expectedSha: SHA,
    workersDev: 'example.acct.workers.dev',
    probe: true,
    env: {},
    fetch: fakeFetch(routes(), calls),
    now: NOW,
  });
  assert.deepEqual(
    report.findings.filter((f) => f.rule === 'smoke-probe'),
    [],
  );
  assert.ok(!calls.some((c) => c.startsWith('POST ')), calls.join(' | '));
});

/** [case, the one rule it must fail, the routes it replaces, the env]. */
const cases: [string, string, Record<string, Route>, Record<string, string>?][] = [
  ['a locale home that fails', 'smoke-status', { 'GET https://example.ch/fr/': () => html('oops', {}, 500) }],
  ['an unknown path that answers 200', 'smoke-status', { 'GET https://example.ch/kit-smoke-x/': () => html(PAGE_404) }],
  [
    'a 404 that is not the kit page',
    'smoke-status',
    { 'GET https://example.ch/kit-smoke-x/': () => html('<h1>CDN error</h1>', {}, 404) },
  ],
  [
    'HTML without nosniff',
    'smoke-headers',
    { 'GET https://example.ch/': () => html(HOME, { 'x-content-type-options': '' }) },
  ],
  [
    'a changed CSP on the asset',
    'smoke-headers',
    { 'GET https://example.ch/_astro/og.abc.jpg': asset({ 'content-security-policy': 'default-src *' }) },
  ],
  [
    'an asset cached for an hour',
    'smoke-cache',
    { 'GET https://example.ch/_astro/og.abc.jpg': asset({ 'cache-control': 'public, max-age=3600' }) },
  ],
  [
    'HTML with an edge TTL',
    'smoke-cache',
    { 'GET https://example.ch/fr/': () => html('<h1>Accueil</h1>', { 'cache-control': 'public, max-age=14400' }) },
  ],
  ['uncompressed HTML', 'smoke-transport', { 'GET https://example.ch/': () => html(HOME, { 'content-encoding': '' }) }],
  ['no HTTP/3', 'smoke-transport', { 'GET https://example.ch/': () => html(HOME, { 'alt-svc': '' }) }],
  ['http that serves the page', 'smoke-transport', { 'GET http://example.ch/': () => html(HOME) }],
  [
    'http that redirects to www first',
    'smoke-transport',
    { 'GET http://example.ch/': moved('https://www.example.ch/') },
  ],
  ['www that serves the site', 'smoke-redirects', { 'GET https://www.example.ch/': () => html(HOME) }],
  ['www that answers 302', 'smoke-redirects', { 'GET https://www.example.ch/': moved('https://example.ch/', 302) }],
  ['a live workers.dev URL', 'smoke-redirects', { 'GET https://example.acct.workers.dev/': () => html(HOME) }],
  [
    'a managed robots.txt',
    'smoke-robots',
    { 'GET https://example.ch/robots.txt': () => new Response(`${ROBOTS}User-agent: GPTBot\nDisallow: /\n`) },
  ],
  [
    'a cookie on the home page',
    'smoke-injection',
    { 'GET https://example.ch/': () => html(HOME, { 'set-cookie': '__cf_bm=1; path=/' }) },
  ],
  [
    'a home page asset that is missing',
    'smoke-status',
    { 'GET https://example.ch/_astro/og.abc.jpg': () => new Response('not found', { status: 404 }) },
  ],
  ['NEL on an asset', 'smoke-injection', { 'GET https://example.ch/_astro/og.abc.jpg': asset({ nel: '{}' }) }],
  [
    'email obfuscation in the HTML',
    'smoke-injection',
    { 'GET https://example.ch/fr/': () => html('<a href="/cdn-cgi/l/email-protection" data-cfemail="1">x</a>') },
  ],
  [
    'an older release',
    'smoke-release',
    { 'GET https://example.ch/_kit/release.txt': () => new Response(`${'b'.repeat(40)}\n`) },
  ],
  [
    'security.txt about to expire',
    'smoke-security-txt',
    { 'GET https://example.ch/.well-known/security.txt': () => new Response('Expires: 2026-11-20T00:00:00Z\n') },
  ],
  [
    'two SPF records',
    'smoke-mail-dns',
    {
      'GET https://cloudflare-dns.com/dns-query?name=example.ch&type=TXT': dns(
        '"v=spf1 -all"',
        '"v=spf1 include:x ~all"',
      ),
    },
  ],
  [
    'no DMARC record',
    'smoke-mail-dns',
    { 'GET https://cloudflare-dns.com/dns-query?name=_dmarc.example.ch&type=TXT': dns() },
  ],
  ['a probe that is not sent', 'smoke-probe', {}, { KIT_PROBE_SECRET: 'wrong' }],
  ['a probe without the secret', 'smoke-probe', {}, {}],
];

for (const [name, rule, replaced, env] of cases) {
  test(`${rule} fails on ${name}`, async () => {
    const report = await smoke({ ...routes(), ...replaced }, [], env);
    assert.deepEqual([...report.ids()], [rule], JSON.stringify(report.findings));
  });
}

test('without a root, smoke checks what it can and still finds a bad 404', async () => {
  const table = { ...routes(), 'GET https://example.ch/kit-smoke-x/': () => html('<h1>CDN error</h1>', {}, 404) };
  const report = await runSmoke('https://example.ch', { fetch: fakeFetch(table), now: NOW, env: {} });
  assert.deepEqual([...report.ids()], ['smoke-status']);
});

test('TXT values join quoted chunks', () => {
  assert.equal(txtValue('"v=spf1 include:a " "~all"'), 'v=spf1 include:a ~all');
  assert.equal(txtValue('v=DMARC1; p=none'), 'v=DMARC1; p=none');
});

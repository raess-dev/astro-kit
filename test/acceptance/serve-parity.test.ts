/**
 * The server case of milestone M6 (specification, 14, M6): one request table, sent to `serveDist` of the packed kit
 * and to `wrangler dev` in local mode, on the built test site. The site has forms, so `wrangler dev` runs the built
 * Worker with the config that the adapter wrote (`WORKER_CONFIG`), and its asset layer answers every path outside
 * `/api/forms/*`. For each request the two answers have the same status, `location`, `cache-control` and the seven
 * kit headers of 6.3 (`kitHeaders`). The kit's browser checks then see the answers that Workers static assets give.
 * Run: node --test test/acceptance/serve-parity.test.ts
 */
import assert from 'node:assert/strict';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import type * as Cloudflare from '../../src/hosts/cloudflare.ts';
import type * as OptionsModule from '../../src/options.ts';
import type * as RegistryModule from '../../src/registry.ts';
import { CLIENT, type KitRun, kitModule, run, type Served, serve, siteCase, WORKER_CONFIG } from './harness.ts';
import { type Answer, call, type Wrangler, wranglerDev } from './wrangler.ts';

/** One request of the table. */
interface Row {
  method: string;
  path: string;
}

/**
 * The request table: pages with and without the slash, a path that ends in `/index.html`, the 404 page by both its
 * names, missing paths at two depths and under `/_astro/`, queries, a HEAD and a POST.
 */
const TABLE: readonly Row[] = [
  { method: 'GET', path: '/' },
  { method: 'GET', path: '/zimmer' },
  { method: 'GET', path: '/zimmer/' },
  { method: 'GET', path: '/zimmer/index.html' },
  { method: 'GET', path: '/index.html' },
  { method: 'GET', path: '/fr/chambres' },
  { method: 'GET', path: '/404.html' },
  { method: 'GET', path: '/404' },
  { method: 'GET', path: '/gibt-es-nicht/' },
  { method: 'GET', path: '/fr/a/b/' },
  { method: 'GET', path: '/gibt-es-nicht.png' },
  { method: 'GET', path: '/_astro/gibt-es-nicht.css' },
  { method: 'GET', path: '/zimmer?a=1&b=2' },
  { method: 'GET', path: '/zimmer/index.html?a=1' },
  { method: 'GET', path: '/404.html?a=1' },
  { method: 'GET', path: '/zimmer/?a=1' },
  { method: 'GET', path: '/robots.txt' },
  { method: 'GET', path: '/sitemap.xml' },
  { method: 'HEAD', path: '/zimmer/' },
  { method: 'HEAD', path: '/gibt-es-nicht/' },
  { method: 'POST', path: '/kontakt/' },
  { method: 'POST', path: '/gibt-es-nicht/' },
];

/** Files planted in the built client directory for the second table, by path. */
const PLANTED: ReadonlyMap<string, string> = new Map([
  ['t/page.html', '<!doctype html><title>page</title>'],
  ['t/dir/index.html', '<!doctype html><title>dir</title>'],
  ['t/both.html', '<!doctype html><title>both file</title>'],
  ['t/both/index.html', '<!doctype html><title>both folder</title>'],
  ['t/zürich/index.html', '<!doctype html><title>z</title>'],
  ['t/a,b.txt', 'comma'],
  ['t/a.json', '{}'],
  ['t/a.yaml', 'a: 1'],
  ['t/a.rss', '<rss/>'],
  ['t/a.cjs', 'module.exports = 1'],
  ['t/a.txt.gz', 'gz'],
  ['t/noext', 'none'],
  ['t/detach/a.txt', 'a'],
  ['t/p/x/y.txt', 'y'],
  ['t/dupe.txt', 'd'],
  ['t/space/a b.txt', 's'],
  ['t/q', 'q'],
  ['t/dot/a.txt', 'dot'],
  ['t/tab/a.txt', 'tab'],
  ['t/secret.txt', 'secret'],
  ['t/ignored.txt', 'ignored'],
  ['t/a.bak', 'bak'],
  ['t/keep/nested-secret.txt', 'nested'],
  ['.assetsignore', 'secret.txt\nt/ignored.txt\n*.bak\nnested-secret.txt\n'],
  ['_redirects', '/alt /zimmer/ 301\n/alt2/ /fr/chambres/ 302\n/proxy /zimmer/ 200\n/old/* /new/:splat 301\n'],
]);

/** Rules appended to the `_headers` of the build for the second table: placeholders, stored forms, a repeat. */
const PLANTED_HEADERS = [
  '/t/*',
  '  X-Star: star-:splat',
  '/t/:file.json',
  '  X-Name: name-:file',
  '/t/p/:a/:b',
  '  X-Ph: :a+:b',
  '/t/detach/*',
  '  ! Cache-Control',
  '  ! Referrer-Policy',
  '/t/dupe.txt',
  '  X-First: 1',
  '/t/dupe.txt',
  '  X-Second: 2',
  '/t/space/a b.txt',
  '  X-Space: s',
  '/t/zürich/*',
  '  X-Uni: uni',
  '/t/q?x=1',
  '  X-Query: q',
  '/t/./dot/*',
  '  X-Dot: d',
  '/t/tab/*',
  '  !\tReferrer-Policy',
  '',
].join('\n');

/**
 * The second table, on the planted files: the html handling of `.html` and `/index` names, the canonical form of a
 * path, `_redirects`, placeholders and stored patterns of `_headers`, content types, `.assetsignore`, and the
 * cache-control of a request with Authorization or Range.
 */
const PLANTED_TABLE: readonly (Row & { headers?: Record<string, string> })[] = [
  ...[
    '/index',
    '/zimmer/index',
    '/zimmer.html',
    '/zimmer.html?q=1',
    '/404/',
    '/404/index.html',
    '/t/page',
    '/t/page.html',
    '/t/page/',
    '/t/both',
    '/t/both/',
    '/t/both.html',
    '/t/dir.html',
    '/%7Aimmer/',
    '/zimmer%2F',
    '//zimmer/',
    '/zimmer//',
    '/%zz',
    '/t/a,b.txt',
    '/t/z%c3%bcrich/',
    '/t/z%C3%BCrich/',
    '/alt',
    '/alt?q=1',
    '/alt2/',
    '/proxy',
    '/old/x/y',
    '/t/detach/a.txt',
    '/t/a.json',
    '/t/p/x/y.txt',
    '/t/dupe.txt',
    '/t/space/a%20b.txt',
    '/t/q',
    '/t/dot/a.txt',
    '/t/tab/a.txt',
    '/t/a.yaml',
    '/t/a.rss',
    '/t/a.cjs',
    '/t/a.txt.gz',
    '/t/noext',
    '/t/secret.txt',
    '/t/ignored.txt',
    '/t/a.bak',
    '/t/keep/nested-secret.txt',
  ].map((path) => ({ method: 'GET', path })),
  { method: 'POST', path: '/alt' },
  { method: 'POST', path: '/zimmer.html' },
  { method: 'GET', path: '/zimmer/', headers: { authorization: 'Basic eDp5' } },
  { method: 'GET', path: '/zimmer/', headers: { range: 'bytes=0-9' } },
];

/** The test headers of the planted rules. */
const PLANTED_NAMES = ['x-star', 'x-name', 'x-ph', 'x-first', 'x-second', 'x-space', 'x-uni', 'x-query', 'x-dot'];

/** What the case compares of an answer. */
type Compared = Record<string, string | number | undefined>;

const single = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value.join(', ') : value;

function compared(answer: Answer, names: readonly string[]): Compared {
  const result: Compared = {
    status: answer.status,
    location: single(answer.headers.location),
    'cache-control': single(answer.headers['cache-control']),
  };
  for (const name of names) result[name] = single(answer.headers[name]);
  return result;
}

/** The last part of a command's output, for the message of a failed assertion. */
const tail = (result: KitRun): string => result.output.slice(-4000);

test('M6: serveDist answers the request table as wrangler dev does: status, location, cache-control, kit headers', async () => {
  const dir = siteCase('serve-parity');
  const built = run(dir, 'build');
  assert.equal(built.status, 0, `astro-kit build failed in ${dir}:\n${tail(built)}`);

  const { loadOptions } = await kitModule<typeof OptionsModule>('options');
  const { Report } = await kitModule<typeof RegistryModule>('registry');
  const { kitHeaders } = await kitModule<typeof Cloudflare>('hosts/cloudflare');
  const options = loadOptions(dir, new Report());
  assert.ok(options, 'astro-kit.json of the site is valid');
  const expected = kitHeaders(options).map(([name, value]) => [name.toLowerCase(), value] as const);
  assert.equal(expected.length, 7, 'the seven kit headers of 6.3');
  const names = expected.map(([name]) => name);

  let kit: Served | undefined;
  let wrangler: Wrangler | undefined;
  try {
    kit = await serve(join(dir, CLIENT));
    wrangler = await wranglerDev(dir, WORKER_CONFIG);
    const differences: string[] = [];
    const statuses = new Set<number>();
    for (const row of TABLE) {
      const label = `${row.method} ${row.path}`;
      const ours = compared(await call(kit.origin, row.path, { method: row.method }), names);
      const theirs = compared(await call(wrangler.origin, row.path, { method: row.method }), names);
      statuses.add(Number(ours.status));
      if (JSON.stringify(ours) !== JSON.stringify(theirs)) {
        differences.push(
          `${label}\n  serveDist:    ${JSON.stringify(ours)}\n  wrangler dev: ${JSON.stringify(theirs)}`,
        );
      }
      // Every answer carries the kit headers with the kit's values, whatever its status (13.1 item 19).
      for (const [name, value] of expected) assert.equal(ours[name], value, `${label}: ${name}`);
    }
    assert.deepEqual(differences, [], `the answers differ:\n${differences.join('\n')}`);
    // The table reaches each kind of answer.
    assert.deepEqual([...statuses].sort(), [200, 307, 404, 405]);
    assert.ok(
      kit.received.some((request) => request.method === 'POST' && request.path === '/kontakt/'),
      'serveDist records the requests',
    );
  } finally {
    try {
      await wrangler?.close();
    } finally {
      await kit?.close();
    }
  }

  // The second table: the same build with planted files, rules and redirects, served again by both.
  const dist = join(dir, CLIENT);
  for (const [file, text] of PLANTED) {
    mkdirSync(dirname(join(dist, file)), { recursive: true });
    writeFileSync(join(dist, file), text);
  }
  appendFileSync(join(dist, '_headers'), PLANTED_HEADERS);
  kit = undefined;
  wrangler = undefined;
  try {
    kit = await serve(dist);
    wrangler = await wranglerDev(dir, WORKER_CONFIG);
    const extra = [...names, 'content-type', ...PLANTED_NAMES];
    const differences: string[] = [];
    for (const row of PLANTED_TABLE) {
      const label = `${row.method} ${row.path} ${JSON.stringify(row.headers ?? {})}`;
      const send = { method: row.method, headers: row.headers ?? {} };
      const [mine, other] = [await call(kit.origin, row.path, send), await call(wrangler.origin, row.path, send)];
      const ours = { ...compared(mine, extra), etag: mine.headers.etag !== undefined, body: mine.body };
      const theirs = { ...compared(other, extra), etag: other.headers.etag !== undefined, body: other.body };
      if (JSON.stringify(ours) !== JSON.stringify(theirs)) {
        differences.push(
          `${label}\n  serveDist:    ${JSON.stringify(ours)}\n  wrangler dev: ${JSON.stringify(theirs)}`,
        );
      }
    }
    // A conditional request with the etag that each server gave gets 304 from both.
    for (const origin of [kit.origin, wrangler.origin]) {
      const etag = (await call(origin, '/zimmer/')).headers.etag;
      assert.equal(typeof etag, 'string', `${origin}: an etag`);
      const again = await call(origin, '/zimmer/', { headers: { 'if-none-match': String(etag) } });
      assert.equal(again.status, 304, `${origin}: If-None-Match`);
    }
    assert.deepEqual(differences, [], `the answers on the planted files differ:\n${differences.join('\n')}`);
  } finally {
    try {
      await wrangler?.close();
    } finally {
      await kit?.close();
    }
  }
});

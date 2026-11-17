import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { build, caseDir, read, record, write } from '../harness.ts';
import { page, project } from './project.ts';
import { type Answer, FORM_SHIM, get, WRANGLER_FORMS, WRANGLER_STATIC, wranglerDev } from '../wrangler.ts';

/** The asset rule of 6.3, which the kit writes on a static site and the adapter on a forms site. */
const ASSET_RULE = '/_astro/*\n  Cache-Control: public, max-age=31536000, immutable\n';
const IMMUTABLE = 'public, max-age=31536000, immutable';
/** A `/*` rule with two test headers, in the place of the seven kit headers of 6.3, and then the asset rule. */
const HEADERS = `/*\n  X-Spike-One: one\n  X-Spike-Two: two words; x=1\n${ASSET_RULE}`;
const RULE = { 'x-spike-one': 'one', 'x-spike-two': 'two words; x=1' };
const HTML_CACHE = 'public, max-age=0, must-revalidate';
const HTML_TYPE = 'text/html; charset=utf-8';

const pages = {
  'src/pages/index.astro': page('Home', '<p id="who">home</p>'),
  'src/pages/404.astro': page('Nicht gefunden', '<p id="who">root 404</p><p lang="fr">Page introuvable</p>'),
  'src/pages/fr/index.astro': page('Accueil', '<p id="who">fr home</p>'),
  'src/pages/fr/404.astro': page('Introuvable', '<p id="who">fr 404</p>'),
};

/** The headers of the `/*` rule that an answer carries. */
const rule = (answer: Answer): Record<string, unknown> =>
  Object.fromEntries(
    Object.keys(RULE)
      .filter((name) => answer.headers[name] !== undefined)
      .map((name) => [name, answer.headers[name]]),
  );

const brief = (answer: Answer): { status: number; location?: unknown } =>
  answer.status >= 300 && answer.status < 400
    ? { status: answer.status, location: answer.headers.location }
    : { status: answer.status };

test('S9: Workers static assets answer a missing URL at any depth with /404.html, status 404 and the /* headers', async () => {
  const dir = project('s09', { ...pages, 'wrangler.jsonc': WRANGLER_STATIC }, "{ locales: ['de', 'fr'] }");
  build(dir);
  // 13.1 item 17: one file that Cloudflare can use as the 404 answer; the French one is an ordinary page.
  assert.ok(existsSync(join(dir, 'dist/404.html')), 'src/pages/404.astro builds dist/404.html');
  assert.ok(existsSync(join(dir, 'dist/fr/404/index.html')), 'src/pages/fr/404.astro builds dist/fr/404/index.html');
  assert.equal(existsSync(join(dir, 'dist/fr/404.html')), false, 'the build writes no dist/fr/404.html');
  write(dir, { 'dist/_headers': HEADERS });
  const notFound = read(dir, 'dist/404.html');
  assert.ok(notFound.includes('root 404'));

  const wrangler = await wranglerDev(dir);
  try {
    const { origin } = wrangler;
    assert.ok(wrangler.output().includes('Parsed 2 valid header rules'), `wrangler read _headers:\n${wrangler.output()}`);

    const home = await get(origin, '/');
    assert.equal(home.status, 200, 'the home answers 200');
    assert.equal(home.body, read(dir, 'dist/index.html'));
    assert.deepEqual(rule(home), RULE, 'the home carries the /* headers');
    assert.equal(home.headers['cache-control'], HTML_CACHE, 'the default cache-control of HTML (13.1 item 21)');

    // Missing pages at each depth, a path without the slash, a missing file, and a locale in the wrong case.
    const paths = ['/x/', '/fr/x/', '/a/b/c/', '/fr/a/b/c/', '/x', '/x.png', '/FR/'];
    for (const path of paths) {
      const answer = await get(origin, path);
      assert.equal(answer.status, 404, `${path} answers 404`);
      assert.equal(answer.body, notFound, `${path} answers with the body of dist/404.html`);
      assert.deepEqual(rule(answer), RULE, `the 404 answer for ${path} carries the /* headers`);
      assert.equal(answer.headers['content-type'], HTML_TYPE, `${path}: the type of the 404 answer`);
      assert.equal(answer.headers['cache-control'], HTML_CACHE, `${path}: the 404 answer has the HTML default`);
    }
    record('S9.missing', { paths, status: 404, body: '/404.html', type: HTML_TYPE, cache: HTML_CACHE });
    // A header rule applies by path, whatever the status: the 404 answer for a missing asset is "immutable".
    const asset = await get(origin, '/_astro/x.css');
    assert.equal(asset.status, 404);
    assert.equal(asset.body, notFound);
    assert.deepEqual(rule(asset), RULE);
    assert.equal(asset.headers['cache-control'], IMMUTABLE, 'the /_astro/* rule sets Cache-Control on a 404 answer too');
    record('S9.missingAsset', { path: '/_astro/x.css', status: 404, body: '/404.html', cache: asset.headers['cache-control'] });
    const head = await get(origin, '/fr/x/', 'HEAD');
    assert.equal(head.status, 404, 'HEAD on a missing URL answers 404');
    assert.equal(head.body, '');
    assert.deepEqual(rule(head), RULE);
    record('S9.missingPost', brief(await get(origin, '/fr/x/', 'POST')));

    // `/fr/404/` is an ordinary page: it answers 200 and is never the 404 answer (1.4, `routes-404`).
    const french = await get(origin, '/fr/404/');
    assert.equal(french.status, 200, '/fr/404/ answers 200');
    assert.equal(french.body, read(dir, 'dist/fr/404/index.html'));
    record('S9.fr404', { status: french.status, body: '/fr/404/index.html', cache: french.headers['cache-control'] });

    // `html_handling: "auto-trailing-slash"`: a directory page without its slash redirects, with the query kept.
    const noSlash = await get(origin, '/fr');
    assert.deepEqual(brief(noSlash), { status: 307, location: '/fr/' }, '/fr redirects to /fr/');
    assert.deepEqual(rule(noSlash), RULE, 'the redirect carries the /* headers');
    assert.deepEqual(brief(await get(origin, '/fr?a=1')), { status: 307, location: '/fr/?a=1' }, 'the query stays');
    assert.equal((await get(origin, '/fr/?a=1')).status, 200, 'a query does not change the page');
    const redirects: Record<string, unknown> = {};
    for (const path of ['/fr', '/fr?a=1', '/fr/404', '/index.html', '/fr/index.html', '/404.html', '/404/', '//x/']) {
      redirects[path] = brief(await get(origin, path));
    }
    record('S9.redirects', redirects);
    // The 404 page itself is also a page: `/404` answers 200 with the same body.
    const own = await get(origin, '/404');
    assert.equal(own.body, notFound);
    record('S9.own404', { path: '/404', status: own.status });
    record('S9.htmlCacheControl', home.headers['cache-control']);
    record('S9.headerRuleOn', { '200': rule(home), '404': RULE, '307': rule(noSlash), '405': rule(await get(origin, '/x/', 'POST')) });
  } finally {
    await wrangler.close();
  }
});

test('S9: the 404 answer is the nearest 404.html up the path, so only a file of that name can replace /404.html', async () => {
  // Astro cannot build `dist/fr/404.html` under `build.format: 'directory'` (13.1 item 17), so the suite plants it.
  const html = (who: string): string => `<!doctype html><html lang="de"><title>${who}</title><p>${who}</p></html>\n`;
  const dir = caseDir(
    's09-nearest',
    {
      'wrangler.jsonc': WRANGLER_STATIC,
      'dist/index.html': html('home'),
      'dist/404.html': html('root 404'),
      'dist/fr/index.html': html('fr home'),
      'dist/fr/404.html': html('planted fr 404'),
      'dist/_headers': HEADERS,
    },
    { kit: false },
  );
  const wrangler = await wranglerDev(dir);
  try {
    const { origin } = wrangler;
    const nearest: Record<string, string> = {};
    for (const [path, file] of [
      ['/x/', 'dist/404.html'],
      ['/de/x/', 'dist/404.html'],
      ['/fr/x/', 'dist/fr/404.html'],
      ['/fr/a/b/', 'dist/fr/404.html'],
    ] as const) {
      const answer = await get(origin, path);
      assert.equal(answer.status, 404, `${path} answers 404`);
      assert.equal(answer.body, read(dir, file), `${path} answers with ${file}`);
      assert.deepEqual(rule(answer), RULE);
      nearest[path] = file.slice('dist'.length);
    }
    record('S9.nearest', nearest);
  } finally {
    await wrangler.close();
  }
});

test('S9: on a forms site the assets answer a missing URL the same way, and an answer of the Worker has no _headers rule', async () => {
  const dir = project(
    's09-forms',
    { ...pages, 'src/pages/api/forms/[form].ts': FORM_SHIM, 'wrangler.jsonc': WRANGLER_FORMS },
    "{ locales: ['de', 'fr'], adapter: cloudflare({ imageService: 'compile', prerenderEnvironment: 'node' }) }",
    "import cloudflare from '@astrojs/cloudflare';",
  );
  build(dir);
  assert.ok(existsSync(join(dir, 'dist/client/404.html')), 'the 404 page is in dist/client');
  assert.ok(existsSync(join(dir, 'dist/client/fr/404/index.html')));
  // 13.1 item 18: the adapter wrote the asset rule. The `/*` rule of the kit comes first (6.3).
  assert.equal(read(dir, 'dist/client/_headers'), ASSET_RULE, 'the adapter writes the /_astro/* rule');
  write(dir, { 'dist/client/_headers': HEADERS });
  const notFound = read(dir, 'dist/client/404.html');

  const wrangler = await wranglerDev(dir, 'dist/server/wrangler.json');
  try {
    const { origin } = wrangler;
    const home = await get(origin, '/');
    assert.equal(home.status, 200);
    assert.deepEqual(rule(home), RULE);
    assert.equal(home.headers['cache-control'], HTML_CACHE);
    // Only `/api/forms/*` runs the Worker first. Every other missing path is answered by the assets.
    const paths = ['/x/', '/fr/x/', '/a/b/c/', '/api/x/', '/x'];
    for (const path of paths) {
      const answer = await get(origin, path);
      assert.equal(answer.status, 404, `${path} answers 404`);
      assert.equal(answer.body, notFound, `${path} answers with the body of dist/client/404.html`);
      assert.deepEqual(rule(answer), RULE, `the 404 answer for ${path} carries the /* headers`);
      assert.equal(answer.headers['cache-control'], HTML_CACHE);
    }
    assert.deepEqual({ status: (await get(origin, '/fr/404/')).status }, { status: 200 }, '/fr/404/ answers 200');
    record('S9.forms.missing', { paths, status: 404, body: '/404.html', cache: HTML_CACHE, headerRule: RULE });

    // The Worker's own answer: no rule of `_headers` reaches it.
    const sent = await get(origin, '/api/forms/kontakt/', 'POST');
    assert.equal(sent.status, 200, `the endpoint answers:\n${wrangler.output().slice(-2000)}`);
    assert.equal(sent.body, 'ok');
    assert.deepEqual(rule(sent), {}, 'an answer of the Worker carries no header of the /* rule');
    record('S9.forms.workerAnswer', { path: 'POST /api/forms/kontakt/', status: sent.status, headerRule: rule(sent) });
    // A Worker-first path with no handler: Astro answers 404 with the prerendered 404 page, which it gets from the assets.
    const noHandler = await get(origin, '/api/forms/kontakt/');
    assert.equal(noHandler.status, 404);
    record('S9.forms.workerNotFound', {
      path: 'GET /api/forms/kontakt/',
      status: noHandler.status,
      body: noHandler.body === notFound ? '/404.html' : 'other',
      headerRule: rule(noHandler),
    });
  } finally {
    await wrangler.close();
  }
});

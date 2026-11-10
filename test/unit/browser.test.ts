import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { type Browser, chromium } from 'playwright-core';
import {
  axeFailures,
  checkFocus,
  chromePath,
  contrastRatio,
  distPages,
  over,
  PAGE_HELPERS,
  pickPages,
} from '../../src/browser.ts';
import type { KitOptions } from '../../src/options.ts';
import { Report } from '../../src/registry.ts';
import { DEFAULT_CACHE, headerRules, headersFor, serveDist } from '../../src/serve.ts';

function dist(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'kit-browser-'));
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true });
    writeFileSync(join(dir, name), text);
  }
  return dir;
}

const HEADERS = `/*
  Content-Security-Policy: frame-ancestors 'none'
  X-Content-Type-Options: nosniff
/_astro/*
  ! Cache-Control
  Cache-Control: public, max-age=31536000, immutable
`;

test('serveDist answers like Workers static assets and applies _headers', async () => {
  const dir = dist({
    'index.html': '<h1>Home</h1>',
    'a/index.html': '<h1>A</h1>',
    '404.html': '<h1>Not found</h1>',
    '_astro/app.css': 'h1{}',
    '_astro/app.js': '',
    _headers: HEADERS,
  });
  const server = await serveDist(dir, { contact: { de: '/kontakt/', fr: '/fr/contact/' } });
  const get = (path: string, init?: RequestInit) => fetch(`${server.origin}${path}`, { redirect: 'manual', ...init });
  try {
    const home = await get('/');
    assert.equal(home.status, 200);
    assert.equal(home.headers.get('content-type'), 'text/html; charset=utf-8');
    assert.equal(home.headers.get('content-security-policy'), "frame-ancestors 'none'");
    assert.equal(home.headers.get('cache-control'), DEFAULT_CACHE);
    const bare = await get('/a');
    assert.equal(bare.status, 307);
    assert.equal(bare.headers.get('location'), '/a/');
    assert.equal(await (await get('/a/')).text(), '<h1>A</h1>');
    const missing = await get('/nope/');
    assert.equal(missing.status, 404);
    assert.equal(await missing.text(), '<h1>Not found</h1>');
    assert.equal(missing.headers.get('x-content-type-options'), 'nosniff');
    const css = await get('/_astro/app.css');
    assert.equal(css.headers.get('content-type'), 'text/css; charset=utf-8');
    assert.equal(css.headers.get('cache-control'), 'public, max-age=31536000, immutable');
    assert.equal((await get('/_astro/app.js')).headers.get('content-type'), 'text/javascript; charset=utf-8');
    assert.equal((await get('/%2e%2e/%2e%2e/etc/passwd')).status, 404);
    const post = await get('/api/contact/', { method: 'POST', body: new URLSearchParams({ locale: 'fr', name: 'x' }) });
    assert.equal(post.status, 303);
    assert.equal(post.headers.get('location'), '/fr/contact/#sent');
  } finally {
    await server.close();
  }
});

test('headersFor joins repeated headers and detaches with !', () => {
  const rules = headerRules('/*\n  X-A: 1\n/b/*\n  X-A: 2\n  ! Cache-Control\n/b/:id\n  X-Id: yes\n');
  assert.deepEqual(headersFor(rules, '/b/c', { 'cache-control': 'x' }), { 'x-a': '1, 2', 'x-id': 'yes' });
  assert.deepEqual(headersFor(rules, '/c', { 'cache-control': 'x' }), { 'cache-control': 'x', 'x-a': '1' });
});

test('axe violations and the hiding "needs review" results fail; other incompletes pass', () => {
  assert.deepEqual(
    axeFailures({
      violations: [],
      incomplete: [{ id: 'color-contrast', nodes: [{ target: 'p', keys: ['fgAlpha'] }] }],
    }),
    [],
  );
  assert.deepEqual(axeFailures({ violations: [{ id: 'image-alt', targets: ['img'] }], incomplete: [] }), [
    'image-alt: img',
  ]);
  assert.equal(
    axeFailures({
      violations: [],
      incomplete: [{ id: 'color-contrast', nodes: [{ target: 'h1', keys: ['bgImage'] }] }],
    }).length,
    1,
  );
  assert.equal(
    axeFailures({ violations: [], incomplete: [{ id: 'video-caption', nodes: [{ target: 'video', keys: [] }] }] })
      .length,
    1,
  );
});

test('contrast follows WCAG relative luminance, with alpha painted over the background', () => {
  assert.equal(Math.round(contrastRatio([0, 0, 0], [255, 255, 255])), 21);
  assert.equal(contrastRatio([119, 119, 119], [119, 119, 119]), 1);
  assert.ok(contrastRatio([118, 118, 118], [255, 255, 255]) >= 4.5);
  assert.ok(contrastRatio([128, 128, 128], [255, 255, 255]) < 4.5);
  assert.deepEqual(over([0, 0, 0, 0], [255, 255, 255]), [255, 255, 255]);
  assert.deepEqual(over([0, 0, 0, 255], [255, 255, 255]), [0, 0, 0]);
});

test('pages are grouped by layout and locale; --all keeps every page', () => {
  const options = {
    locales: [
      { code: 'de', tag: 'de-CH', name: 'Deutsch' },
      { code: 'fr', tag: 'fr-CH', name: 'Français' },
    ],
    defaultLocale: 'de',
  } as KitOptions;
  const page = (lang: string, main: string) => `<html lang="${lang}"><body><main>${main}</main></body></html>`;
  const dir = dist({
    'index.html': page('de-CH', '<h1>Start</h1>'),
    'a/index.html': page('de-CH', '<p>A</p>'),
    'b/index.html': page('de-CH', '<p>B</p>'),
    'c/index.html': page('de-CH', '<table></table>'),
    'kontakt/index.html': page('de-CH', '<form method="post" action="/api/contact/"></form>'),
    'fr/index.html': page('fr-CH', '<h1>Accueil</h1>'),
    'fr/a/index.html': page('fr-CH', '<p data-astro-cid-x1>A</p>'),
    '404.html': page('de-CH', '<h1>404</h1>'),
  });
  const pages = distPages(dir, options);
  assert.equal(pages.length, 8);
  assert.deepEqual(
    pickPages(pages, false).map((p) => p.path),
    ['/', '/404.html', '/a/', '/c/', '/fr/', '/fr/a/', '/kontakt/'],
  );
  assert.equal(pickPages(pages, true).length, 8);
  assert.deepEqual(
    pages.filter((p) => p.contact).map((p) => p.path),
    ['/kontakt/'],
  );
  assert.equal(pages.find((p) => p.path === '/fr/a/')?.locale, 'fr');
});

test('CHROME_PATH wins over the system Chrome', () => {
  assert.equal(chromePath({ CHROME_PATH: '/opt/chrome' }), '/opt/chrome');
});

/** One launch for the real-browser test; it skips itself when no Chrome is found. */
async function launch(): Promise<Browser | undefined> {
  const executablePath = chromePath();
  try {
    return await chromium.launch({ ...(executablePath ? { executablePath } : {}), timeout: 30_000 });
  } catch {
    return undefined;
  }
}

test('a11y-focus: a CSS-free page fails, the kit focus style passes, a :focus ring on click fails', async (t) => {
  const browser = await launch();
  if (!browser) {
    t.skip('no Chrome found; set CHROME_PATH');
    return;
  }
  const body = '<a href="#x">Skip</a><p>Text <a href="/a/">a link</a></p><button type="button">Button</button>';
  const dir = dist({
    'plain/index.html': `<!doctype html><html lang="en"><title>Plain</title>${body}</html>`,
    'kit/index.html': `<!doctype html><html lang="en"><title>Kit</title><link rel="stylesheet" href="/kit.css">${body}</html>`,
    'click/index.html': `<!doctype html><html lang="en"><title>Click</title><link rel="stylesheet" href="/click.css">${body}</html>`,
    'kit.css': ':focus-visible { outline: 2px solid #0050c8; outline-offset: 2px; }',
    'click.css': ':focus { outline: 3px solid #0050c8; }',
  });
  const server = await serveDist(dir);
  try {
    const context = await browser.newContext();
    await context.addInitScript(PAGE_HELPERS);
    const page = await context.newPage();
    const focus = async (path: string) => {
      const report = new Report();
      await page.goto(`${server.origin}${path}`);
      await checkFocus(page, path, report);
      return report.findings.map((f) => f.detail ?? '');
    };
    const plain = await focus('/plain/');
    assert.equal(plain.length, 1);
    assert.match(plain[0] ?? '', /^Tab: a "Skip" has a 1px auto outline/);
    assert.deepEqual(await focus('/kit/'), []);
    const click = await focus('/click/');
    assert.ok(click.some((d) => d.startsWith('a mouse click on a')));
    assert.ok(click.some((d) => d.startsWith('a mouse click on button')));
  } finally {
    await browser.close();
    await server.close();
  }
});

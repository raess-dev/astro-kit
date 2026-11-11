import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { get as httpGet } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { brotliDecompressSync, crc32, deflateSync, gunzipSync, zstdDecompressSync } from 'node:zlib';
import { type Browser, chromium } from 'playwright-core';
import {
  axeFailures,
  checkFocus,
  chromePath,
  contrastRatio,
  distPages,
  over,
  oversizedImages,
  PAGE_HELPERS,
  pickPages,
  sweep,
} from '../../src/browser.ts';
import type { KitOptions } from '../../src/options.ts';
import { Report } from '../../src/registry.ts';
import { DEFAULT_CACHE, headerRules, headersFor, serveDist } from '../../src/serve.ts';

function dist(files: Record<string, string | Buffer>): string {
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

test('serveDist compresses text like Cloudflare (zstd, then br, then gzip) and leaves images alone', async () => {
  const html = `<h1>${'Hotel Lärchenwald '.repeat(200)}</h1>`;
  const dir = dist({ 'index.html': html, 'a.png': Buffer.alloc(2000, 7) });
  const server = await serveDist(dir);
  const raw = (path: string, accept: string) =>
    new Promise<{ encoding: string | undefined; vary: string | undefined; body: Buffer }>((done, fail) => {
      httpGet(`${server.origin}${path}`, { headers: { 'accept-encoding': accept } }, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () =>
          done({
            encoding: res.headers['content-encoding'],
            vary: res.headers.vary,
            body: Buffer.concat(chunks),
          }),
        );
      }).on('error', fail);
    });
  try {
    const decode: Record<string, (b: Buffer) => Buffer> = {
      zstd: zstdDecompressSync,
      br: brotliDecompressSync,
      gzip: gunzipSync,
    };
    for (const [accept, encoding] of [
      ['gzip, deflate, br, zstd', 'zstd'],
      ['gzip, br', 'br'],
      ['gzip', 'gzip'],
    ] as const) {
      const r = await raw('/', accept);
      assert.equal(r.encoding, encoding, accept);
      assert.equal(r.vary, 'accept-encoding');
      assert.ok(r.body.length < html.length / 4);
      assert.equal(decode[encoding]?.(r.body).toString(), html);
    }
    const plain = await raw('/', 'identity');
    assert.equal(plain.encoding, undefined);
    assert.equal(plain.body.toString(), html);
    assert.equal((await raw('/a.png', 'gzip, br, zstd')).encoding, undefined);
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

test('astro-kit test exits with an error when Chromium cannot start, and does not hang', () => {
  const root = mkdtempSync(join(tmpdir(), 'kit-launch-'));
  cpSync(new URL('../fixtures/good/astro-kit.json', import.meta.url), join(root, 'astro-kit.json'));
  mkdirSync(join(root, 'dist'));
  writeFileSync(join(root, 'dist/index.html'), '<!doctype html><html lang="de-CH"><title>x</title></html>');
  const cli = fileURLToPath(new URL('../../src/cli.ts', import.meta.url));
  const run = spawnSync(process.execPath, [cli, 'test'], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, CHROME_PATH: '/bin/false' },
    timeout: 90_000,
  });
  rmSync(root, { recursive: true, force: true });
  assert.equal(run.signal, null, 'the run hung until the timeout killed it');
  assert.equal(run.status, 1, run.stderr);
});

/** A grey PNG of the given size. */
function png(width: number, height: number): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const head = Buffer.alloc(4);
    head.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([head, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 0, 0, 0, 0], 8);
  const rows = Buffer.alloc((width + 1) * height, 128);
  for (let y = 0; y < height; y++) rows[y * (width + 1)] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(rows)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

test('perf-image-oversize measures the delivered pixels, not the sizes-scaled naturalWidth', async (t) => {
  const browser = await launch();
  if (!browser) {
    t.skip('no Chrome found; set CHROME_PATH');
    return;
  }
  // Rendered 200px wide at 3x: 900px is the most it may deliver. sizes="390px" picks the 1280w file.
  const img = (sizes: string) =>
    `<img src="/a640.png" srcset="/a640.png 640w, /a1280.png 1280w" sizes="${sizes}" style="width:200px" alt="">`;
  const dir = dist({
    'wide/index.html': `<!doctype html><html lang="en"><title>Wide</title>${img('390px')}</html>`,
    'right/index.html': `<!doctype html><html lang="en"><title>Right</title>${img('200px')}</html>`,
    'a640.png': png(640, 10),
    'a1280.png': png(1280, 20),
  });
  const server = await serveDist(dir);
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 600 }, deviceScaleFactor: 3 });
    const check = async (path: string) => {
      await page.goto(`${server.origin}${path}`);
      await page.waitForFunction(() => [...document.images].every((i) => i.complete));
      return page.evaluate(oversizedImages);
    };
    assert.deepEqual(await check('/wide/'), ['a1280.png 1280px for 200px at 3x']);
    assert.deepEqual(await check('/right/'), []);
  } finally {
    await browser.close();
    await server.close();
  }
});

test('a11y-keyboard: a wrapped link and a field partly below the fold are visible; a link under a fixed bar is covered', async (t) => {
  const browser = await launch();
  if (!browser) {
    t.skip('no Chrome found; set CHROME_PATH');
    return;
  }
  const bar = '<div style="position: fixed; inset: 0 0 auto 0; height: 4rem; background: #fff"></div>';
  // Two lines with a gap between them: the box centre falls on the li, not on the link.
  const wrapped =
    '<ul style="inline-size: 12rem; line-height: 2"><li><a href="/a/">Datenschutzerklärung des Hotels Lärchenwald</a></li></ul>';
  // Its top is on screen and its centre below the fold (844 px), so Chrome does not scroll it on focus.
  const tall =
    '<textarea aria-label="Message" style="position: absolute; inset-block-start: 760px; block-size: 250px"></textarea>';
  const dir = dist({
    'page/index.html': `<!doctype html><html lang="de"><title>Seite</title><body style="font-size: 18px; margin: 0">${bar}<p style="margin: 0"><a href="/b/">Unter dem Balken</a></p><div style="block-size: 5rem"></div>${wrapped}${tall}</body></html>`,
  });
  const server = await serveDist(dir);
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await context.addInitScript(PAGE_HELPERS);
    const page = await context.newPage();
    await page.goto(`${server.origin}/page/`);
    const report = new Report();
    await sweep({ report }, page, '/page/');
    const keyboard = report.findings.filter((f) => f.rule === 'a11y-keyboard').map((f) => f.detail);
    assert.deepEqual(keyboard, ['hidden when focused 1: a "Unter dem Balken" (covered)']);
  } finally {
    await browser.close();
    await server.close();
  }
});

test('a11y-keyboard counts each radio group as one Tab stop', async (t) => {
  const browser = await launch();
  if (!browser) {
    t.skip('no Chrome found; set CHROME_PATH');
    return;
  }
  const groups = Array.from(
    { length: 8 },
    (_, g) =>
      `<fieldset><legend>Q${g}</legend>${[1, 2, 3].map((v) => `<label><input type="radio" name="q${g}" value="${v}">${v}</label>`).join('')}</fieldset>`,
  ).join('');
  const dir = dist({
    'form/index.html': `<!doctype html><html lang="en"><title>Form</title><form>${groups}<a href="/next/">Next</a><button type="submit">Send</button></form></html>`,
  });
  const server = await serveDist(dir);
  try {
    const context = await browser.newContext();
    await context.addInitScript(PAGE_HELPERS);
    const page = await context.newPage();
    await page.goto(`${server.origin}/form/`);
    const report = new Report();
    await sweep({ report }, page, '/form/');
    assert.deepEqual(
      report.findings.filter((f) => f.rule === 'a11y-keyboard'),
      [],
    );
  } finally {
    await browser.close();
    await server.close();
  }
});

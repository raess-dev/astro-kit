import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { browse, build, type ConsoleMessage, cspMeta, read, record, type StandIn, standIn } from '../harness.ts';
import type { Served } from '../serve.ts';
import { PERMISSIONS_POLICY, PNG, page, project } from './project.ts';

interface Seen {
  path: string;
  purpose: string | undefined;
}

// Chromium writes a console warning for each feature of the `Permissions-Policy` header that it does not know on its
// platform. On Linux that is `bluetooth`, in Chromium 153 and 158. The warning is about the header of 6.3, not about
// the CSP or the speculation rules. The spike keeps these warnings apart and allows them only for the names below.
const POLICY_WARNING = /^Error with Permissions-Policy header: Unrecognized feature: '([a-z-]+)'\.$/;
const UNKNOWN_ON_SOME_PLATFORM = ['bluetooth'];

/**
 * The 6.3 headers of a plain site. The header CSP has Trusted Types on. HSTS is left out: the suite serves http.
 */
const headers = (kit: StandIn): Record<string, string> => ({
  'Content-Security-Policy': kit.headerCsp({}),
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Permissions-Policy': PERMISSIONS_POLICY,
});

/** Runs before the page's own scripts and is not subject to its CSP (13.1 item 30). */
const PROBE = `(() => {
  window.__s8 = [];
  document.addEventListener('securitypolicyviolation', (e) => window.__s8.push(e.effectiveDirective + ' ' + e.blockedURI));
})();`;

/**
 * The requests that the server got, without the icon: the path, and the `Sec-Purpose` request header, which is how
 * a server tells a speculative load from a navigation.
 */
const seenBy = (server: Served): Seen[] =>
  server.received
    .filter((request) => request.path !== '/favicon.ico')
    .map((request) => ({
      path: request.path,
      purpose: [request.headers['sec-purpose']].flat().join(',') || undefined,
    }));

/** Waits until `ready()` holds. A speculative load starts some time after the hover, so the spike never sleeps blind. */
async function until(ready: () => boolean, ms = 15_000): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (ready()) return true;
    await new Promise((done) => setTimeout(done, 50));
  }
  return ready();
}

const files = {
  // Chromium asks for the icon at a time of its own choice. The file keeps the 404 out of the console.
  'public/favicon.ico': PNG,
  'src/pages/index.astro': page(
    'Home',
    '<main><h1>Home</h1><p><a id="next" href="/next/">Next</a></p><p><a id="api" href="/api/x/">API</a></p></main>',
  ),
  'src/pages/next.astro': page('Next', '<main><h1>Next</h1><p><a href="/">Home</a></p></main>'),
  'src/pages/api/x.astro': page('API', '<main><h1>Not for speculation</h1></main>'),
  // The same page, for the control: after the build the spike changes one byte of its speculation block.
  'src/pages/control.astro': page('Control', '<main><h1>Control</h1><p><a id="next" href="/next/">Next</a></p></main>'),
};

test('S8: the speculation block inserted in build:done passes the CSP in Chromium, and its rules are active', async (t) => {
  const kit = await standIn();
  const dir = project('s08', files);
  build(dir);

  const home = read(dir, 'dist/index.html');
  const block = `<script type="speculationrules">${kit.SPECULATION_JSON}</script>`;
  const meta = /<meta\b[^>]*http-equiv="?content-security-policy"?[^>]*>/i.exec(home);
  assert.ok(meta, 'the page has the CSP meta');
  assert.equal(home.split(block).length, 2, 'one speculation block, with the text of 6.2');
  assert.equal(home.indexOf(block), meta.index + meta[0].length, 'the block follows the CSP meta directly');
  assert.equal(kit.SPECULATION_HASH, 'sha256-4255RGsO6JUC8vuukcO69AaAmBKnnolynaWf9b0Q6og=', 'the hash of 6.2');
  assert.ok(cspMeta(home).includes(`'${kit.SPECULATION_HASH}'`), 'the CSP meta holds the hash of the block');
  assert.ok(kit.headerCsp({}).includes("require-trusted-types-for 'script'"), 'the header CSP has Trusted Types on');

  // The control: one more space in the JSON, so the hash in the CSP meta no longer fits.
  const control = join(dir, 'dist/control/index.html');
  writeFileSync(control, readFileSync(control, 'utf8').replace('"eagerness":"moderate"', '"eagerness": "moderate"'));

  const { server, browser, close } = await browse(join(dir, 'dist'), { headers: headers(kit) });
  const seen = (): Seen[] => seenBy(server);
  try {
    const context = await browser.newContext();
    await context.addInitScript(PROBE);
    const tab = await context.newPage();
    const consoleErrors: string[] = [];
    const policyWarnings = new Set<string>();
    tab.on('console', (message: ConsoleMessage) => {
      if (message.type() !== 'error' && message.type() !== 'warning') return;
      const feature = POLICY_WARNING.exec(message.text())?.[1];
      if (feature === undefined) consoleErrors.push(message.text());
      else policyWarnings.add(feature);
    });
    tab.on('pageerror', (error: Error) => consoleErrors.push(String(error)));

    await tab.goto(`${server.origin}/`);
    assert.equal(
      await tab.evaluate(() => HTMLScriptElement.supports('speculationrules')),
      true,
      'Chromium supports speculation rules',
    );
    assert.equal(
      await tab.evaluate(() => document.querySelectorAll('script[type=speculationrules]').length),
      1,
      'the block is in the document',
    );
    assert.deepEqual(seen(), [{ path: '/', purpose: undefined }], 'before a hover: the navigation only');

    // A link that the rules exclude starts nothing, a link that they match starts a prerender.
    await tab.hover('#api');
    assert.equal(await until(() => seen().length > 1, 1000), false, 'a link under /api/ starts no load');
    await tab.hover('#next');
    assert.ok(
      await until(() => seen().some((request) => request.path === '/next/')),
      'the hover starts a load of /next/',
    );
    const speculative = seen().filter((request) => request.path !== '/');
    const purpose = speculative[0]?.purpose;
    assert.deepEqual(
      speculative,
      [{ path: '/next/', purpose: 'prefetch;prerender' }],
      'one prerender, of the matched link',
    );
    record('S8.secPurpose', purpose);

    assert.deepEqual(await tab.evaluate(() => (window as unknown as { __s8: string[] }).__s8), [], 'no CSP violation');
    assert.equal(consoleErrors.join('\n'), '', 'no console error or warning');
    const unknown = [...policyWarnings].sort();
    assert.deepEqual(
      unknown.filter((feature) => !UNKNOWN_ON_SOME_PLATFORM.includes(feature)),
      [],
      'Chromium knows every other feature of the Permissions-Policy header',
    );
    if (unknown.length > 0)
      t.diagnostic(`S8: this Chromium does not know the Permissions-Policy feature ${unknown.join(', ')}`);

    // The header CSP is in force on this page: Trusted Types refuses a string at an HTML sink.
    const sink = await tab.evaluate(() => {
      try {
        document.body.innerHTML = '<p>x</p>';
        return 'allowed';
      } catch (error) {
        return (error as Error).name;
      }
    });
    assert.equal(sink, 'TypeError', 'Trusted Types is on');

    // The control page: the same headers and the same meta, but a block whose hash is not in the CSP.
    const before = seen().length;
    await tab.goto(`${server.origin}/control/`);
    // The pointer moves away first, so that the hover on the link is a new one on this page.
    await tab.hover('h1');
    await tab.hover('#next');
    const violations = await tab.evaluate(() => (window as unknown as { __s8: string[] }).__s8);
    assert.deepEqual(violations, ['script-src-elem inline'], 'a block that the CSP does not name is a violation');
    // The wording of the message changes between Chromium versions. The name of the policy stays.
    assert.ok(
      consoleErrors.some((text) => text.includes('Content Security Policy')),
      'and a console error',
    );
    assert.equal(await until(() => seen().length > before + 1, 1500), false, 'and its rules start no load');
    record('S8.blockedDirective', violations[0]);
  } finally {
    await close();
  }
});

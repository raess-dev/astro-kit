import assert from 'node:assert/strict';
import { type ChildProcess, spawn } from 'node:child_process';
import { join } from 'node:path';
import { test } from 'node:test';
import { atEnd, browse, build, chromePath, PIXEL_SOURCE, record, samePixel, serve, standIn, type Page, type Pixel } from '../harness.ts';
import { PNG, page, project } from './project.ts';

// Two options and no `auto`, so that no state of this spike depends on the system of the machine.
const MODES = { light: true, dark: true, default: 'light' };
// The two values of `--color-page` in tokens.css below: the design values, and the four channels of a canvas pixel.
const PAGE = { light: '#ffeedd', dark: '#111111' };
const LIGHT: Pixel = [0xff, 0xee, 0xdd, 255];
const DARK: Pixel = [0x11, 0x11, 0x11, 255];
const KEY = 'astro-kit:mode';

const SWITCH = [
  '<fieldset data-mode-switch><legend>Darstellung</legend>',
  '<label><input type="radio" name="mode" value="light"> Hell</label>',
  '<label><input type="radio" name="mode" value="dark"> Dunkel</label>',
  '</fieldset>',
].join('');

// The pages under /auto/ drive themselves, for the run with no DevTools client. A list rule has the eagerness
// `immediate`, so page A prerenders page B with no pointer. The kit's own rules need a pointer (`moderate`).
const RULES = '{"prerender":[{"urls":["/auto/b/"]}]}';

/**
 * Page A. When the prerendered page B says that it is ready, A chooses "dark" in its switch: the `change` event
 * is the path of a visitor. When B says that it saw the change, A follows its link to B.
 */
const DRIVER = `
  let changed = false;
  let gone = false;
  window.addEventListener('storage', (event) => {
    if (event.key === 's17:ready' && !changed) {
      changed = true;
      const radio = document.querySelector('input[value="dark"]');
      radio.checked = true;
      radio.dispatchEvent(new Event('change', { bubbles: true }));
    }
    if (event.key === 's17:stale' && !gone) {
      gone = true;
      document.querySelector('#to-b').click();
    }
  });`;

/**
 * Page B. It notes its state at each step and sends the notes to the server when it becomes active. Its listeners
 * are registered after those of the mode script, so each note shows what the mode script made of the event.
 * A note names the page background as `light` or `dark`: the page paints it on a canvas next to the two design
 * values, and a color is the same within 1 of 255 in each channel. No computed color text leaves the page.
 * A BroadcastChannel message of a prerendered page does not arrive before the activation, so B talks to A through
 * localStorage keys of its own.
 */
const REPORTER = `
  const root = document.documentElement;
  const log = [];
  const pixel = ${PIXEL_SOURCE};
  const background = () => {
    const got = pixel(getComputedStyle(document.body).backgroundColor);
    const same = (value) => got.length === 4 && pixel(value).every((channel, index) => Math.abs(channel - got[index]) <= 1);
    return same('${PAGE.light}') ? 'light' : same('${PAGE.dark}') ? 'dark' : 'other ' + got.join(',');
  };
  const note = (name) => log.push([
    name,
    'prerendering=' + document.prerendering,
    'mode=' + root.dataset.mode,
    'checked=' + document.querySelector('[name="mode"]:checked')?.value,
    'background=' + background(),
  ].join(' '));
  const report = () => fetch('/report/?' + encodeURIComponent(JSON.stringify({
    log,
    activated: performance.getEntriesByType('navigation')[0].activationStart > 0,
    stored: localStorage.getItem('${KEY}'),
  })));
  document.addEventListener('DOMContentLoaded', () => {
    note('loaded');
    if (!document.prerendering) {
      report();
      return;
    }
    let count = 0;
    const ready = setInterval(() => localStorage.setItem('s17:ready', String(++count)), 50);
    window.addEventListener('storage', (event) => {
      if (event.key !== '${KEY}') return;
      clearInterval(ready);
      note('storage');
      // Back to the old mode, as on a page that the storage event did not reach. The activation must repair it.
      root.dataset.mode = 'light';
      note('stale');
      localStorage.setItem('s17:stale', '1');
    });
    document.addEventListener('prerenderingchange', () => {
      note('prerenderingchange');
      report();
    });
  });`;

const files = {
  'public/favicon.ico': PNG,
  'src/styles/tokens.css': [
    '@layer tokens {',
    '  :root {',
    '    color-scheme: light;',
    `    --color-page: light-dark(${PAGE.light}, ${PAGE.dark});`,
    '    --color-text: light-dark(#222222, #eeeeee);',
    '  }',
    '  :root[data-mode="dark"] {',
    '    color-scheme: dark;',
    '  }',
    '}',
    '',
  ].join('\n'),
  'src/styles/elements.css':
    '@layer elements {\n  body {\n    background: var(--color-page);\n    color: var(--color-text);\n  }\n}\n',
  // These two pages have no script but the mode script.
  'src/pages/index.astro': page('A', `${SWITCH}<main><h1>A</h1><a id="to-b" href="/b/">B</a></main>`),
  'src/pages/b/index.astro': page('B', `${SWITCH}<main><h1>B</h1><a href="/">A</a></main>`),
  'src/pages/auto/index.astro': page(
    'A',
    [
      `${SWITCH}<main><h1>A</h1><a id="to-b" href="/auto/b/">B</a></main>`,
      `<script type="speculationrules" set:html={${JSON.stringify(RULES)}}></script><script>${DRIVER}</script>`,
    ].join(''),
  ),
  'src/pages/auto/b/index.astro': page('B', `${SWITCH}<main><h1>B</h1></main><script>${REPORTER}</script>`),
};

let cached: Promise<{ dist: string; dir: string; header: string }> | undefined;

/** The built site of this spike, and the header CSP of 6.2 with Trusted Types on. */
function site(): Promise<{ dist: string; dir: string; header: string }> {
  cached ??= (async () => {
    const kit = await standIn();
    const options = `{ modes: ${JSON.stringify(MODES)}, scriptHashes: [${JSON.stringify(kit.sha256(RULES))}] }`;
    const dir = project('s17', files, options);
    build(dir);
    return { dist: join(dir, 'dist'), dir, header: kit.headerCsp({}) };
  })();
  return cached;
}

/**
 * Waits until `read` gives a value that `done` accepts. The failure shows the last value. `what` can be a function:
 * it then runs when the time is over, so that the message holds the state of that moment.
 */
async function until<T>(read: () => T | Promise<T>, done: (value: T) => boolean, what: string | (() => string)): Promise<T> {
  const end = Date.now() + 30_000;
  for (;;) {
    const value = await read();
    if (done(value)) return value;
    if (Date.now() >= end) assert.fail(`${typeof what === 'string' ? what : what()}: ${JSON.stringify(value)}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

/**
 * Notes the page events. The listeners "found" are registered before the mode script, so they show the state that
 * the event finds. The listeners "left" are registered after it, so they show what the mode script made of it.
 */
const PROBE = `(() => {
  window.__pixel = ${PIXEL_SOURCE};
  const log = window.__s17 = [];
  const mode = () => document.documentElement.dataset.mode;
  window.addEventListener('pagehide', (e) => log.push('pagehide persisted=' + e.persisted));
  window.addEventListener('pageshow', (e) => log.push('pageshow persisted=' + e.persisted + ' found ' + mode()));
  document.addEventListener('DOMContentLoaded', () => {
    window.addEventListener('pageshow', (e) => log.push('pageshow persisted=' + e.persisted + ' left ' + mode()));
    window.addEventListener('storage', (e) => log.push('storage ' + e.key + ' left ' + mode()));
  });
})();`;

type Probed = { __s17: string[]; __kept?: string; __pixel(color: string): Pixel };

/** The page has the mode, its switch shows it, and its background has the color, as a canvas pixel. */
async function assertState(tab: Page, mode: 'light' | 'dark', background: Pixel): Promise<void> {
  const state = await tab.evaluate(() => ({
    mode: document.documentElement.dataset.mode,
    checked: document.querySelector<HTMLInputElement>('[name="mode"]:checked')?.value,
    background: (window as unknown as Probed).__pixel(getComputedStyle(document.body).backgroundColor),
  }));
  assert.deepEqual({ mode: state.mode, checked: state.checked }, { mode, checked: mode });
  assert.ok(samePixel(state.background, background), `the background with the mode ${mode}: ${state.background}`);
}

test('S17: a page restored from the back/forward cache shows the mode that another page changed', async () => {
  const { dist, header } = await site();
  const { server, browser, close } = await browse(dist, { headers: { 'content-security-policy': header } });
  try {
    const tab = await (await browser.newContext({ colorScheme: 'light' })).newPage();
    await tab.addInitScript(PROBE);
    await tab.goto(`${server.origin}/`);
    await assertState(tab, 'light', LIGHT);
    await tab.evaluate(() => {
      (window as unknown as Probed).__kept = 'the same window';
    });

    // Page A goes into the cache. Page B changes the mode.
    await tab.click('#to-b');
    await tab.waitForURL(`${server.origin}/b/`);
    await tab.click('input[value="dark"]');
    await assertState(tab, 'dark', DARK);
    assert.equal(await tab.evaluate((key: string) => localStorage.getItem(key), KEY), 'dark');

    // Back. A restore fires no load event, so wait for the commit and then for the events.
    await tab.goBack({ waitUntil: 'commit' });
    const log = await until(
      () => tab.evaluate(() => (window as unknown as Probed).__s17 ?? []),
      (notes) => notes.length >= 6,
      'the events of the restored page',
    );
    assert.deepEqual(log, [
      'pageshow persisted=false found light',
      'pageshow persisted=false left light',
      'pagehide persisted=true',
      // The restore: the page comes back with the old mode, and the pageshow listener of the script repairs it.
      'pageshow persisted=true found light',
      'pageshow persisted=true left dark',
      // Chromium kept the storage event of the change for the frozen page, and delivers it after the restore.
      `storage ${KEY} left dark`,
    ]);
    assert.equal(await tab.evaluate(() => location.pathname), '/');
    assert.equal(await tab.evaluate(() => (window as unknown as Probed).__kept), 'the same window', 'no reload');
    assert.equal(server.requests.filter((path) => path === '/').length, 1, 'the server sent page A once');
    await assertState(tab, 'dark', DARK);
    record('S17.bfcache', { restored: true, modeAfterPageshow: 'dark', storageEventAfterRestore: true });
  } finally {
    await close();
  }
});

interface Report {
  log: string[];
  activated: boolean;
  stored: string | null;
}

test('S17: a prerendered page shows the changed mode when it activates, with no DevTools client', async () => {
  const { dist, dir, header } = await site();
  const binary = chromePath();
  assert.ok(binary, 'the spike needs the file of a Chromium: set CHROME_PATH, or install the one of playwright-core');
  // The server is the only thing open before the `try`. An open server would keep the test process alive.
  const server = await serve(dist, { headers: { 'content-security-policy': header } });
  let chrome: ChildProcess | undefined;
  let exited: Promise<void> | undefined;
  let forget = (): void => {};
  let limit: NodeJS.Timeout | undefined;
  try {
    // No debugging port and no pipe: nothing can attach to this browser. The pages report to the server.
    const child = spawn(
      binary,
      [
        '--headless=new',
        '--no-sandbox',
        '--disable-gpu',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-background-networking',
        '--disable-component-update',
        '--disable-sync',
        '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1',
        `--user-data-dir=${join(dir, '.chrome-profile')}`,
        `${server.origin}/auto/`,
      ],
      { stdio: 'ignore' },
    );
    chrome = child;
    forget = atEnd(() => child.kill('SIGKILL'));
    // The time limit of the browser. The `timeout` option of `spawn` would keep the test process alive for that
    // time when the browser does not start, so the spike has its own timer and clears it.
    limit = setTimeout(() => child.kill('SIGKILL'), 120_000);
    // A browser that does not start emits `error` and no `exit`.
    let failed: Error | undefined;
    exited = new Promise<void>((resolve) => {
      child.once('exit', () => resolve());
      child.once('error', (error) => {
        failed = error;
        resolve();
      });
    });
    const sent = await until(
      () => server.requests.find((path) => path.startsWith('/report/?')),
      (path) => path !== undefined || child.exitCode !== null || failed !== undefined,
      // The request list is the only trace of this browser, so the message reads it when the time is over.
      () => `page B sent no report; the requests were ${server.requests.join(' ')}`,
    );
    assert.equal(failed, undefined, `Chromium did not start: ${String(failed)}`);
    assert.ok(sent, `Chromium ended with code ${child.exitCode} before page B sent its report`);
    const report = JSON.parse(decodeURIComponent(sent.slice('/report/?'.length))) as Report;
    assert.deepEqual(report, {
      log: [
        // Prerendered before the change: the page has the default mode.
        'loaded prerendering=true mode=light checked=light background=light',
        // The storage event of the change reaches the prerendered page, and the script applies it there.
        'storage prerendering=true mode=dark checked=dark background=dark',
        'stale prerendering=true mode=light checked=dark background=light',
        // The activation: the prerenderingchange listener of the script applies the stored mode.
        'prerenderingchange prerendering=false mode=dark checked=dark background=dark',
      ],
      activated: true,
      stored: 'dark',
    });
    assert.equal(server.requests.filter((path) => path === '/auto/b/').length, 1, 'the activation used the prerender');
    record('S17.prerender', {
      activatedWithNoDevTools: true,
      storageEventWhilePrerendered: true,
      modeAfterActivation: 'dark',
    });
  } finally {
    clearTimeout(limit);
    try {
      if (chrome && exited) {
        const child = chrome;
        child.kill();
        const timer = setTimeout(() => child.kill('SIGKILL'), 5_000);
        await exited;
        clearTimeout(timer);
        forget();
      }
    } finally {
      await server.close();
    }
  }
});

interface PrerenderStatus {
  status: string;
  prerenderStatus?: string;
  key: { url: string };
}
type Timing = PerformanceNavigationTiming & { activationStart: number };

test('S17: with a DevTools client, Chromium cancels the prerender of the kit rules (13.1 item 28)', async () => {
  const { dist, header } = await site();
  const { server, browser, close } = await browse(dist, { headers: { 'content-security-policy': header } });
  try {
    const context = await browser.newContext({ colorScheme: 'light' });
    const tab = await context.newPage();
    await tab.addInitScript('window.__s17 = { prerendering: document.prerendering };');
    const cdp = await context.newCDPSession(tab);
    const failures: string[] = [];
    cdp.on('Preload.prerenderStatusUpdated', (event: PrerenderStatus) => {
      if (event.status === 'Failure') failures.push(`${new URL(event.key.url).pathname} ${event.prerenderStatus}`);
    });
    await cdp.send('Preload.enable');
    const purposes: string[] = [];
    tab.on('request', (request: { url(): string; headers(): Record<string, string> }) => {
      if (new URL(request.url()).pathname === '/b/') purposes.push(request.headers()['sec-purpose'] ?? 'none');
    });
    await tab.goto(`${server.origin}/`);

    // The rules of the kit (`moderate`): the pointer rests on the link, and Chromium starts the prerender.
    await tab.hover('#to-b');
    await until(() => purposes, (seen) => seen.length > 0, 'the prerender request');
    await until(() => failures, (seen) => seen.length > 0, 'the status of the prerender');
    assert.equal(purposes[0], 'prefetch;prerender');
    assert.equal(failures[0], '/b/ PrerenderingDisabledByDevTools');
    record('S17.prerenderWithDevTools', 'PrerenderingDisabledByDevTools');

    // So the click is a normal navigation: page B was never a prerendered page.
    await tab.click('#to-b');
    await tab.waitForURL(`${server.origin}/b/`);
    assert.deepEqual(
      await tab.evaluate(() => ({
        prerendered: (window as unknown as { __s17: { prerendering: boolean } }).__s17.prerendering,
        activationStart: (performance.getEntriesByType('navigation')[0] as Timing).activationStart,
      })),
      { prerendered: false, activationStart: 0 },
    );
  } finally {
    await close();
  }
});

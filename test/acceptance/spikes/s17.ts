import assert from 'node:assert/strict';
import { type ChildProcess, spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  atEnd,
  browse,
  build,
  chromePath,
  type Page,
  PIXEL_SOURCE,
  type Pixel,
  record,
  samePixel,
  serve,
  standIn,
} from '../harness.ts';
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
  // Each step sends a trace request, so a failed run shows the last step that happened.
  const trace = (step) => fetch('/trace/?a-' + step).catch(() => undefined);
  trace('loaded');
  let changed = false;
  let gone = false;
  window.addEventListener('storage', (event) => {
    if (event.key === 's17:ready' && !changed) {
      changed = true;
      trace('ready');
      const radio = document.querySelector('input[value="dark"]');
      radio.checked = true;
      radio.dispatchEvent(new Event('change', { bubbles: true }));
    }
    if (event.key === 's17:stale' && !gone) {
      gone = true;
      trace('click');
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
  // Each step sends a trace request, so a failed run shows the last step that happened.
  const trace = (step) => fetch('/trace/?b-' + step).catch(() => undefined);
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
    trace('loaded-prerendering-' + document.prerendering);
    if (!document.prerendering) {
      report();
      return;
    }
    let count = 0;
    const ready = setInterval(() => {
      if (count === 0) trace('ready');
      localStorage.setItem('s17:ready', String(++count));
    }, 50);
    window.addEventListener('storage', (event) => {
      if (event.key !== '${KEY}') return;
      clearInterval(ready);
      trace('storage');
      note('storage');
      // Back to the old mode, as on a page that the storage event did not reach. The activation must repair it.
      root.dataset.mode = 'light';
      note('stale');
      localStorage.setItem('s17:stale', '1');
    });
    document.addEventListener('prerenderingchange', () => {
      trace('activated');
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

/** The end of a wait of `until`: the last value, and whether `done` accepted it before the time was over. */
interface Waited<T> {
  done: boolean;
  value: T;
}

/**
 * Waits until `read` gives a value that `done` accepts, for 30 seconds at most, or until `end` (a `Date.now()` time)
 * when the caller gives one. It asserts nothing: the caller asserts `done` right after the wait, with a message that
 * holds the last value and the state of that moment.
 */
async function until<T>(
  read: () => T | Promise<T>,
  done: (value: T) => boolean,
  end = Date.now() + 30_000,
): Promise<Waited<T>> {
  for (;;) {
    const value = await read();
    if (done(value)) return { done: true, value };
    if (Date.now() >= end) return { done: false, value };
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

/** The mode of the page, the mode that its switch shows, and its background as a canvas pixel. */
interface State {
  shown: { mode: string | undefined; checked: string | undefined };
  background: Pixel;
}

const stateOf = (tab: Page): Promise<State> =>
  tab.evaluate(() => ({
    shown: {
      mode: document.documentElement.dataset.mode,
      checked: document.querySelector<HTMLInputElement>('[name="mode"]:checked')?.value,
    },
    background: (window as unknown as Probed).__pixel(getComputedStyle(document.body).backgroundColor),
  }));

test('S17: a page restored from the back/forward cache shows the mode that another page changed', async () => {
  const { dist, header } = await site();
  const { server, browser, close } = await browse(dist, { headers: { 'content-security-policy': header } });
  try {
    const tab = await (await browser.newContext({ colorScheme: 'light' })).newPage();
    await tab.addInitScript(PROBE);
    await tab.goto(`${server.origin}/`);
    const first = await stateOf(tab);
    assert.deepEqual(first.shown, { mode: 'light', checked: 'light' });
    assert.ok(samePixel(first.background, LIGHT), `the background with the mode light: ${first.background}`);
    await tab.evaluate(() => {
      (window as unknown as Probed).__kept = 'the same window';
    });

    // Page A goes into the cache. Page B changes the mode.
    await tab.click('#to-b');
    await tab.waitForURL(`${server.origin}/b/`);
    await tab.click('input[value="dark"]');
    const changed = await stateOf(tab);
    assert.deepEqual(changed.shown, { mode: 'dark', checked: 'dark' });
    assert.ok(samePixel(changed.background, DARK), `the background with the mode dark: ${changed.background}`);
    assert.equal(await tab.evaluate((key: string) => localStorage.getItem(key), KEY), 'dark');

    // Back. A restore fires no load event, so wait for the commit and then for the events.
    await tab.goBack({ waitUntil: 'commit' });
    const events = await until(
      () => tab.evaluate(() => (window as unknown as Probed).__s17 ?? []),
      (notes) => notes.length >= 6,
    );
    assert.ok(events.done, `the events of the restored page: ${JSON.stringify(events.value)}`);
    assert.deepEqual(events.value, [
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
    const restored = await stateOf(tab);
    assert.deepEqual(restored.shown, { mode: 'dark', checked: 'dark' });
    assert.ok(samePixel(restored.background, DARK), `the background with the mode dark: ${restored.background}`);
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

/**
 * The switches of the browser with no DevTools client. They are the switches of Playwright's launch that change what
 * Chromium enables or how it schedules a page, so this browser runs as the browser of the kit's checks does (8,
 * the harness). Without `--disable-field-trial-config`, a Chromium build that is not Google Chrome turns on the
 * groups of its field-trial testing config: 90 in Chromium 153, other ones in each version. A prerendered page has no
 * visible widget, so without the three other switches Chromium may give its renderer a lower priority and throttle
 * its timers.
 */
const KIT_LIKE = [
  '--disable-field-trial-config',
  '--disable-background-timer-throttling',
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
];

/**
 * What Chromium's network log says about each request for `path`: the status line of the answer, the bytes that the
 * page got, and the network error. The log has one event on each line, and the last lines of a log of a killed
 * browser can be cut. A line that is no event is left out.
 */
function netLogOf(file: string, path: string): string {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return 'no network log';
  }
  const lines = text.split('\n');
  const head = lines[0] ?? '';
  const types = new Map<number, string>();
  try {
    const constants = JSON.parse(head.slice('{"constants":'.length, head.endsWith(',') ? -1 : undefined)) as {
      logEventTypes?: Record<string, number>;
    };
    for (const [name, id] of Object.entries(constants.logEventTypes ?? {})) types.set(id, name);
  } catch {
    return 'a network log with no constants';
  }
  interface Event {
    source?: { id?: number };
    type?: number;
    phase?: number;
    params?: { url?: unknown; headers?: unknown; net_error?: unknown; byte_count?: unknown };
  }
  const events: Event[] = [];
  for (const line of lines.slice(1)) {
    const trimmed = line.trim().replace(/,$/, '');
    if (!trimmed.startsWith('{')) continue;
    try {
      events.push(JSON.parse(trimmed) as Event);
    } catch {
      // The cut last line of a killed browser.
    }
  }
  const sources = new Set<number>();
  for (const event of events) {
    const url = event.params?.url;
    if (typeof url !== 'string' || !URL.canParse(url) || types.get(event.type ?? -1) !== 'REQUEST_ALIVE') continue;
    if (new URL(url).pathname === path) sources.add(event.source?.id ?? -1);
  }
  const notes: string[] = [];
  for (const id of sources) {
    let status = 'no answer';
    let bytes = 0;
    let error = 'none';
    let ended = false;
    for (const event of events) {
      if (event.source?.id !== id) continue;
      const type = types.get(event.type ?? -1);
      const headers = event.params?.headers;
      if (type === 'HTTP_TRANSACTION_READ_RESPONSE_HEADERS' && Array.isArray(headers)) status = String(headers[0]);
      if (type === 'URL_REQUEST_JOB_FILTERED_BYTES_READ' && typeof event.params?.byte_count === 'number') {
        bytes += event.params.byte_count;
      }
      if (event.params?.net_error !== undefined) error = String(event.params.net_error);
      if (type === 'REQUEST_ALIVE' && event.phase === 2) ended = true;
    }
    notes.push(`${status}, ${bytes} bytes read, net error ${error}, ${ended ? 'ended' : 'still open'}`);
  }
  return notes.length === 0 ? `no request for ${path}` : notes.join('; ');
}

test('S17: a prerendered page shows the changed mode when it activates, with no DevTools client', async () => {
  const { dist, dir, header } = await site();
  const binary = chromePath();
  assert.ok(binary, 'the spike needs the file of a Chromium: set CHROME_PATH, or install the one of playwright-core');
  // The server is the only thing open before the `try`. An open server would keep the test process alive.
  // The time of each request since the start, and its Sec-Purpose header, for the message of a failed run.
  const start = Date.now();
  const timeline: string[] = [];
  const server = await serve(dist, {
    headers: { 'content-security-policy': header },
    onRequest: (request) => {
      const purpose = request.headers['sec-purpose'];
      timeline.push(`${Date.now() - start}ms ${request.path}${typeof purpose === 'string' ? ` [${purpose}]` : ''}`);
    },
  });
  const netLog = join(dir, 's17-net.json');
  let chrome: ChildProcess | undefined;
  let exited: Promise<void> | undefined;
  let forget: (() => void) | undefined;
  let limit: NodeJS.Timeout | undefined;
  try {
    // No debugging port and no pipe: nothing can attach to this browser. The pages report to the server. The
    // network log is a file that Chromium writes itself; it attaches no client.
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
        ...KIT_LIKE,
        '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1',
        `--log-net-log=${netLog}`,
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
    const gone = (): boolean => child.exitCode !== null || child.signalCode !== null || failed !== undefined;
    // The three steps of the run are events that the server sees: the prerender request of page B, the first note
    // of page B while it is prerendered, and its report after the activation. Each wait ends at its event, and all
    // three end at the same time limit. So a failed run names the step that did not come.
    const end = Date.now() + 30_000;
    const state = (): string =>
      `the requests were: ${timeline.join(', ')}; Chromium's network log of /auto/b/: ${netLogOf(netLog, '/auto/b/')}`;
    const prerender = await until(
      () => server.received.find((request) => request.path === '/auto/b/'),
      (request) => request !== undefined || gone(),
      end,
    );
    assert.equal(failed, undefined, `Chromium did not start: ${String(failed)}`);
    assert.equal(
      prerender.value?.headers['sec-purpose'],
      'prefetch;prerender',
      `Chromium sent no prerender request for page B; ${state()}`,
    );
    const running = await until(
      () => server.requests.find((path) => path.startsWith('/trace/?b-loaded')),
      (path) => path !== undefined || gone(),
      end,
    );
    assert.equal(
      running.value,
      '/trace/?b-loaded-prerendering-true',
      `page B did not run as a prerendered page: Chromium sent its prerender request and then dropped it; ${state()}`,
    );
    const reported = await until(
      () => server.requests.find((path) => path.startsWith('/report/?')),
      (path) => path !== undefined || gone(),
      end,
    );
    // The request list is the only trace of this browser, so the message reads it right after the wait.
    assert.ok(reported.done && reported.value, `page B sent no report; ${state()}`);
    const sent = reported.value;
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
        forget?.();
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
    const requested = await until(
      () => purposes,
      (seen) => seen.length > 0,
    );
    assert.ok(requested.done, `the prerender request: ${JSON.stringify(requested.value)}`);
    const status = await until(
      () => failures,
      (seen) => seen.length > 0,
    );
    assert.ok(status.done, `the status of the prerender: ${JSON.stringify(status.value)}`);
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

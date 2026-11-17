import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  browse,
  build,
  cspMeta,
  read,
  record,
  standIn,
  type BrowserContext,
  type ConsoleMessage,
  type Page,
} from '../harness.ts';
import { PERMISSIONS_POLICY, PNG, page, project } from './project.ts';

interface Routed {
  request(): { url(): string; method(): string; postData(): string | null };
  fulfill(answer: { status: number; contentType: string; headers?: Record<string, string>; body: string }): Promise<void>;
}
interface Violation {
  directive: string;
  blocked: string;
  policy: string;
}
type Probed = { __s18: Violation[]; __s18done: Record<string, string>; __s18popup: Window | null };

// One origin for each directive of 9.4, and one that the page contacts while it loads (`load: "page"`).
const ORIGINS = [
  { host: 'maps.example.org', directives: ['frame'] },
  { host: 'js.pay.example', directives: ['script'] },
  { host: 'api.pay.example', directives: ['connect'] },
  { host: 'news.example.com', directives: ['form'] },
  { host: 'stats.example.net', directives: ['script', 'connect'] },
];
const OPTIONS = { origins: ORIGINS, scripts: true };

/** The `/*` headers of 6.3. HSTS is left out, because the suite serves http. */
const headers = (csp: string, opener: string): Record<string, string> => ({
  'Content-Security-Policy': csp,
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Cross-Origin-Opener-Policy': opener,
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Permissions-Policy': PERMISSIONS_POLICY,
});

/** Runs before the page's own scripts and is not subject to its CSP (13.1 item 30). */
const PROBE = `(() => {
  window.__s18 = [];
  document.addEventListener('securitypolicyviolation', (e) =>
    window.__s18.push({ directive: e.effectiveDirective, blocked: e.blockedURI, policy: e.originalPolicy }));
})();`;

const button = (id: string, kind: string, url: string): string =>
  `<button type="button" id="${id}" data-do="${kind}" data-url="${url}">${id}</button>`;
// A form needs no script (9.4): the visitor's click on its button submits it. A control with `data-do="submit"` lets
// the bundled script submit the same form.
const form = (id: string, url: string): string =>
  `<form method="post" action="${url}"><input name="email" value="a@example.ch"><button id="${id}">${id}</button></form>`;

// The project's bundled script. It contacts a host only after a click on a control.
const SCRIPT = `
  const done: Record<string, string> = {};
  const state = window as unknown as { __s18done: typeof done; __s18popup: Window | null };
  state.__s18done = done;
  document.addEventListener('click', (event) => {
    const control = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-do]') : null;
    if (!control) return;
    const { do: kind, url = '' } = control.dataset;
    const settle = (result: string) => { done[control.id] = result; };
    if (kind === 'frame') {
      const frame = document.createElement('iframe');
      frame.title = 'Map';
      frame.src = url;
      frame.addEventListener('load', () => settle('load'));
      document.body.append(frame);
    } else if (kind === 'script' || kind === 'style' || kind === 'image') {
      const element = document.createElement(kind === 'script' ? 'script' : kind === 'style' ? 'link' : 'img');
      element.addEventListener('load', () => settle('load'));
      element.addEventListener('error', () => settle('error'));
      if (element instanceof HTMLLinkElement) { element.rel = 'stylesheet'; element.href = url; } else { element.src = url; }
      document.head.append(element);
    } else if (kind === 'fetch') {
      fetch(url).then((answer) => answer.text()).then(settle, () => settle('error'));
    } else if (kind === 'popup') {
      state.__s18popup = window.open(url);
      settle('opened');
    } else if (kind === 'submit') {
      const target = [...document.forms].find((one) => one.action === url);
      settle(target ? 'submitted' : 'no form');
      target?.requestSubmit();
    }
  });
`;

// A host that is not declared, for each directive. Then a declared host, used for what its directives do not name.
const BLOCKED: [id: string, kind: string, url: string][] = [
  ['bad-frame', 'frame', 'https://other.example/embed'],
  ['bad-script', 'script', 'https://other.example/x.js'],
  ['bad-fetch', 'fetch', 'https://other.example/data'],
  ['cross-fetch', 'fetch', 'https://maps.example.org/data'],
  ['cross-frame', 'frame', 'https://js.pay.example/embed'],
  ['cross-script', 'script', 'https://api.pay.example/x.js'],
  ['cross-style', 'style', 'https://js.pay.example/v1.css'],
  ['cross-image', 'image', 'https://js.pay.example/logo.png'],
];

const files = {
  'public/favicon.ico': PNG,
  'src/pages/index.astro': page(
    'Origins',
    [
      '<main><h1>Origins</h1><p id="slot"></p>',
      button('frame', 'frame', 'https://maps.example.org/embed'),
      button('script', 'script', 'https://js.pay.example/v1.js'),
      button('fetch', 'fetch', 'https://api.pay.example/session'),
      button('popup', 'popup', 'https://js.pay.example/embed'),
      form('submit', 'https://news.example.com/subscribe'),
      button('script-submit', 'submit', 'https://news.example.com/subscribe'),
      ...BLOCKED.map(([id, kind, url]) => button(id, kind, url)),
      form('bad-submit', 'https://other.example/subscribe'),
      button('bad-script-submit', 'submit', 'https://other.example/subscribe'),
      button('bad-popup', 'popup', 'https://other.example/embed'),
      '<a id="bad-link" href="https://other.example/embed">A link to a host that is not declared</a>',
      `</main><script>${SCRIPT}</script>`,
    ].join(''),
  ),
  // `load: "page"`: the built HTML holds the frame and the script of the host.
  'src/pages/page.astro': page(
    'Page load',
    '<main><h1>Page load</h1><iframe src="https://maps.example.org/embed" title="Map"></iframe></main><script src="https://stats.example.net/x.js" async></script>',
  ),
};

let built: string | undefined;
/** One build for the three tests. */
function site(): string {
  if (built) return built;
  const dir = project('s18', files, JSON.stringify(OPTIONS));
  build(dir);
  built = dir;
  return dir;
}

/**
 * Answers every `https:` request itself, for a declared host or not, so that only the CSP can stop a request.
 * Returns the requests that arrived.
 */
async function thirdParties(context: BrowserContext): Promise<string[]> {
  const hits: string[] = [];
  await context.route(/^https:\/\//, async (route: Routed) => {
    const request = route.request();
    const url = new URL(request.url());
    const posted = request.postData();
    hits.push(`${request.method()} ${url.href}${posted ? ` ${posted}` : ''}`);
    const headers = { 'access-control-allow-origin': '*' };
    if (url.pathname === '/embed' || url.pathname === '/subscribe') {
      const body = `<!doctype html><title>${url.host}</title><p>${url.pathname}</p>`;
      await route.fulfill({ status: 200, contentType: 'text/html', body });
    } else if (url.href === 'https://stats.example.net/x.js') {
      // A script that loads with the page, and reports the page view to its own host.
      const body = `fetch('https://stats.example.net/collect', { method: 'POST', body: 'view' }).then(() => { document.documentElement.dataset.stats = 'sent'; });`;
      await route.fulfill({ status: 200, contentType: 'text/javascript', headers, body });
    } else if (url.pathname.endsWith('.js')) {
      // A third-party script writes HTML through a sink that Trusted Types refuses.
      const body = `document.getElementById('slot').innerHTML = '<b>${url.host}</b>';`;
      await route.fulfill({ status: 200, contentType: 'text/javascript', headers, body });
    } else if (url.pathname.endsWith('.css')) {
      await route.fulfill({ status: 200, contentType: 'text/css', headers, body: 'h1 { color: red; }' });
    } else {
      await route.fulfill({ status: 200, contentType: 'application/json', headers, body: '{"ok":true}' });
    }
  });
  return hits;
}

interface Session {
  context: BrowserContext;
  tab: Page;
  origin: string;
  /** The third-party requests that arrived. */
  hits: string[];
  /** Every request of the context, own origin included. */
  requests: string[];
  consoleErrors: string[];
  /** The violations of the current document: the directive, the blocked URL and the policy that reported it. */
  violations(): Promise<string[]>;
  done(): Promise<Record<string, string>>;
}

/** Serves the built site with `responseHeaders`, opens a tab, and closes everything after `run`. */
async function session(responseHeaders: Record<string, string>, run: (s: Session) => Promise<void>): Promise<void> {
  const { server, browser, close } = await browse(join(site(), 'dist'), { headers: responseHeaders });
  try {
    const context = await browser.newContext();
    await context.addInitScript(PROBE);
    const hits = await thirdParties(context);
    const requests: string[] = [];
    context.on('request', (request: { url(): string }) => requests.push(request.url()));
    const tab = await context.newPage();
    const consoleErrors: string[] = [];
    tab.on('console', (message: ConsoleMessage) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    const header = responseHeaders['Content-Security-Policy'];
    await run({
      context,
      tab,
      origin: server.origin,
      hits,
      requests,
      consoleErrors,
      violations: async () =>
        (await tab.evaluate(() => (window as unknown as Probed).__s18))
          .map((v) => `${v.directive} ${v.blocked} (${v.policy === header ? 'header' : 'meta'})`)
          .sort(),
      done: () => tab.evaluate(() => (window as unknown as Probed).__s18done),
    });
  } finally {
    await close();
  }
}

/** Clicks the control and waits until the bundled script has a result for it. */
async function act(tab: Page, id: string): Promise<void> {
  await tab.click(`#${id}`);
  await tab.waitForFunction((key: string) => (window as unknown as Probed).__s18done[key] !== undefined, id);
}

/** Clicks a control that opens a window, and returns the loaded window. */
async function open(s: Session, id: string): Promise<Page> {
  const opened = s.context.waitForEvent('page') as Promise<Page>;
  await s.tab.click(`#${id}`);
  const popup = await opened;
  await popup.waitForLoadState();
  return popup;
}

/** Clicks a control whose request the CSP must stop, and returns the `count` violations that the click adds. */
async function blocked(s: Session, id: string, count = 1): Promise<string[]> {
  const before = await s.violations();
  // Playwright waits for a navigation that the click starts. A form submission that the CSP stops never ends for it.
  await s.tab.click(`#${id}`, { noWaitAfter: true });
  await s.tab.waitForFunction((size: number) => (window as unknown as Probed).__s18.length >= size, before.length + count);
  const after = await s.violations();
  for (const known of before) after.splice(after.indexOf(known), 1);
  return after;
}

test('S18: declared origins work after a click under the CSP of 9.4, and every other request is blocked', async () => {
  const { headerCsp, sha256 } = await standIn();
  const dir = site();
  const home = read(dir, 'dist/index.html');
  const meta = cspMeta(home);
  const header = headerCsp(OPTIONS);

  // The policies of 6.2 with the changes of 9.4.
  for (const directive of [
    "connect-src 'self' https://api.pay.example https://stats.example.net",
    'frame-src https://maps.example.org',
    "form-action 'self' https://news.example.com",
    "script-src 'self' https://js.pay.example https://stats.example.net 'sha256-",
  ]) {
    assert.ok(meta.includes(directive), `the CSP meta holds ${directive}`);
  }
  assert.equal(header, "frame-ancestors 'none'; base-uri 'none'; object-src 'none'; form-action 'self' https://news.example.com");

  // `gesture`: the built page holds no frame and no script of a host. The form's `action` is the one host URL.
  assert.equal(/<iframe/.test(home), false, 'no iframe in the built page');
  assert.equal(/<script[^>]*\ssrc=/.test(home), false, 'no script with a src in the built page');
  // Astro inlines a small bundled script as a module script, and puts its hash into the CSP meta.
  const inline = /<script type="module">([\s\S]*?)<\/script>/.exec(home)?.[1];
  assert.ok(inline, 'the bundled script is an inline module script');
  assert.ok(meta.includes(`'${sha256(inline)}'`), 'Astro added the hash of the bundled script');
  record('S18.bundledScript', 'inline module script, hashed by Astro');

  await session(headers(header, 'same-origin-allow-popups'), async (s) => {
    const { tab } = s;
    await tab.goto(`${s.origin}/`);
    await tab.waitForLoadState('networkidle');
    assert.deepEqual(s.hits, [], 'before the click: no request to another origin');
    assert.ok(s.requests.length > 0 && s.requests.every((url) => url.startsWith(`${s.origin}/`)), 'own origin only');

    // The four declared uses. The form comes last, because it leaves the page.
    for (const id of ['frame', 'script', 'fetch']) await act(tab, id);
    assert.deepEqual(await s.done(), { frame: 'load', script: 'load', fetch: '{"ok":true}' });
    assert.ok(tab.frames().some((frame) => frame.url() === 'https://maps.example.org/embed'), 'the frame holds the map');
    assert.equal(
      await tab.evaluate(() => document.querySelector('#slot')?.innerHTML),
      '<b>js.pay.example</b>',
      'the third-party script ran, and wrote HTML: Trusted Types is off',
    );

    // A window that a script of the page opens keeps its opener (`same-origin-allow-popups`).
    const popup = await open(s, 'popup');
    assert.equal(popup.url(), 'https://js.pay.example/embed');
    assert.equal(await popup.evaluate(() => window.opener !== null), true, 'the opened window has its opener');
    assert.equal(await tab.evaluate(() => (window as unknown as Probed).__s18popup?.closed), false, 'the page keeps the window');
    await popup.close();

    assert.deepEqual(await s.violations(), [], 'no CSP violation');
    assert.deepEqual(s.consoleErrors, [], 'no console error');
    assert.deepEqual(s.hits, [
      'GET https://maps.example.org/embed',
      'GET https://js.pay.example/v1.js',
      'GET https://api.pay.example/session',
      'GET https://js.pay.example/embed',
    ]);

    // Every other request: the CSP meta stops it before it leaves, and names the directive.
    const directives: Record<string, string[]> = {};
    for (const [id] of BLOCKED) directives[id] = await blocked(s, id);
    assert.equal(s.hits.length, 4, 'no blocked request reached its host');

    // No CSP directive covers a navigation. A window that the script opens reaches any host, as a link does.
    const other = await open(s, 'bad-popup');
    assert.equal(other.url(), 'https://other.example/embed');
    assert.equal(s.hits.at(-1), 'GET https://other.example/embed', 'the request reached the host that is not declared');
    assert.equal((await s.violations()).length, BLOCKED.length, 'and it is no violation');
    await other.close();

    // The form last: after a stopped submission Playwright takes no further click on this document.
    // The header CSP and the CSP meta both hold `form-action`, so both report.
    directives['bad-submit'] = await blocked(s, 'bad-submit', 2);
    assert.equal(tab.url(), `${s.origin}/`, 'the stopped form does not leave the page');
    // The same form, submitted by the bundled script, on a fresh document.
    await tab.goto(`${s.origin}/`);
    directives['bad-script-submit'] = await blocked(s, 'bad-script-submit', 2);
    assert.equal((await s.done())['bad-script-submit'], 'submitted', 'the bundled script called requestSubmit()');
    assert.deepEqual(directives, {
      'bad-frame': ['frame-src https://other.example (meta)'],
      'bad-script': ['script-src-elem https://other.example/x.js (meta)'],
      'bad-fetch': ['connect-src https://other.example/data (meta)'],
      'cross-fetch': ['connect-src https://maps.example.org/data (meta)'],
      'cross-frame': ['frame-src https://js.pay.example (meta)'],
      'cross-script': ['script-src-elem https://api.pay.example/x.js (meta)'],
      'cross-style': ['style-src-elem https://js.pay.example/v1.css (meta)'],
      'cross-image': ['img-src https://js.pay.example/logo.png (meta)'],
      'bad-submit': [
        'form-action https://other.example/subscribe (header)',
        'form-action https://other.example/subscribe (meta)',
      ],
      'bad-script-submit': [
        'form-action https://other.example/subscribe (header)',
        'form-action https://other.example/subscribe (meta)',
      ],
    });
    assert.equal(tab.url(), `${s.origin}/`, 'the stopped form does not leave the page');
    assert.equal(s.hits.length, 5, 'no blocked request reached its host');
    record('S18.blocked', directives);

    // A link to a host that is not declared, on a fresh document: the click leaves the page and reaches the host.
    await tab.goto(`${s.origin}/`);
    await tab.click('#bad-link');
    await tab.waitForURL('https://other.example/embed');
    assert.equal(s.hits.at(-1), 'GET https://other.example/embed', 'the link reached the host that is not declared');
    assert.equal(s.hits.length, 6);
    record('S18.notBlocked', ['window.open', 'link']);

    // The declared form, on a fresh document: the bundled script submits it after a click on its control.
    await tab.goto(`${s.origin}/`);
    await tab.click('#script-submit');
    await tab.waitForURL('https://news.example.com/subscribe');
    assert.equal(s.hits.at(-1), 'POST https://news.example.com/subscribe email=a%40example.ch');
    assert.equal(s.hits.length, 7);
    // And with no script: the visitor's click on the button of the form.
    await tab.goto(`${s.origin}/`);
    await tab.click('#submit');
    await tab.waitForURL('https://news.example.com/subscribe');
    assert.equal(s.hits.at(-1), 'POST https://news.example.com/subscribe email=a%40example.ch');
    assert.equal(s.hits.length, 8);
    record('S18.declaredForm', ['requestSubmit() of the bundled script', 'the button of the form']);
  });
});

test('S18: with load "page", a static async script and a titled iframe of declared hosts load with no violation', async () => {
  const { headerCsp } = await standIn();
  const html = read(site(), 'dist/page/index.html');
  assert.ok(html.includes('<iframe src="https://maps.example.org/embed" title="Map"></iframe>'), 'Astro keeps the iframe');
  assert.ok(html.includes('<script src="https://stats.example.net/x.js" async></script>'), 'Astro keeps the script tag');

  await session(headers(headerCsp(OPTIONS), 'same-origin-allow-popups'), async (s) => {
    await s.tab.goto(`${s.origin}/page/`);
    await s.tab.waitForFunction(() => document.documentElement.dataset.stats === 'sent');
    await s.tab.waitForLoadState('networkidle');
    assert.ok(s.tab.frames().some((frame) => frame.url() === 'https://maps.example.org/embed'), 'the frame holds the map');
    assert.deepEqual([...s.hits].sort(), [
      'GET https://maps.example.org/embed',
      'GET https://stats.example.net/x.js',
      'POST https://stats.example.net/collect view',
    ]);
    assert.deepEqual(await s.violations(), [], 'no CSP violation');
    assert.deepEqual(s.consoleErrors, [], 'no console error');
  });
});

test('S18: the headers of a plain site would break a script origin: Trusted Types and COOP same-origin', async () => {
  const { headerCsp } = await standIn();
  // The same built pages, served with the headers of a site that has no scripts and no origins (6.2, 6.3).
  const plain = headerCsp({ origins: ORIGINS.filter((origin) => origin.directives.includes('form')) });
  assert.ok(plain.endsWith("; require-trusted-types-for 'script'; trusted-types 'none'"), 'Trusted Types is on');

  await session(headers(plain, 'same-origin'), async (s) => {
    const { tab } = s;
    const errors: string[] = [];
    tab.on('pageerror', (error: Error) => errors.push(error.name));
    await tab.goto(`${s.origin}/`);

    // The bundled script cannot give a script element a URL: `src` is a Trusted Types sink.
    await tab.click('#script');
    await tab.waitForFunction(() => (window as unknown as Probed).__s18.length > 0);
    const violations = await s.violations();
    assert.deepEqual(violations, ['require-trusted-types-for trusted-types-sink (header)']);
    assert.deepEqual(errors, ['TypeError'], 'the assignment throws');
    assert.deepEqual(s.hits, [], 'the script is not requested');
    record('S18.trustedTypesBlocks', violations);

    // A window that the page opens on another origin is cut off from it.
    const popup = await open(s, 'popup');
    assert.equal(popup.url(), 'https://js.pay.example/embed');
    assert.equal(await popup.evaluate(() => window.opener === null), true, 'the opened window has no opener');
    await tab.waitForFunction(() => (window as unknown as Probed).__s18popup?.closed === true);
  });
});

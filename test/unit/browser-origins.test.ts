/**
 * The browser rule `origins-gesture` (specification, section 8 and 9.4), and the refusing proxy that keeps every check
 * of `astro-kit test` off the network. `browser-origins-leaks.test.ts` holds the ways in which a page reaches another
 * host without a request event, and the lock of the browser. Each browser case writes a temp `dist/` from strings and opens it in Chromium
 * (14.1). Every host of another origin is under `.example`, which never resolves, and the harness answers each request
 * to it with 204 itself: no case reaches the network.
 */
import assert from 'node:assert/strict';
import { connect } from 'node:net';
import { test } from 'node:test';
import type { BrowserRule } from '../../src/browser/harness.ts';
import { OTHER_ORIGIN_STATUS, REFUSAL, startRefusingProxy } from '../../src/browser/network.ts';
import {
  connectionTarget,
  gesture,
  gestureFindings,
  LEAVE_MS,
  ORIGINS_RULES,
  ownOf,
  PAGE_TIME_MS,
  type Seen,
  URL_TEXT_MAX,
  urlText,
  visitorAgent,
} from '../../src/browser/origins.ts';
import { BROWSER_RULES } from '../../src/browser/rules.ts';
import type { Options } from '../../src/options.ts';
import { RULE_BY_ID } from '../../src/registry.ts';
import { BODY, CSS, findingsOf, html, useBrowser } from './browser-fixtures.ts';
import { optionsOf, origin, SMALLEST } from './fixtures.ts';
import { SPEC } from './spec.ts';

const browser = useBrowser();

/** The smallest settings with bundled scripts on, so a `gesture` origin is valid (5.2), and `origins`. */
const withOrigins = (origins: readonly unknown[]): Options =>
  optionsOf({ ...SMALLEST, features: { scripts: true }, origins });

/** A page of the browser tests with `extra` after `main`: a script, a frame or a link. */
const pageWith = (extra: string): string => html(`${BODY}${extra}`, { css: CSS });

/** The details of `origins-gesture` on the one page `index.html`. */
async function detailsOf(index: string, settings: Options = withOrigins([])): Promise<string[]> {
  const findings = await findingsOf(browser(), { 'index.html': index }, [gesture], { settings });
  return findings.map((finding) => `${finding.rule} ${finding.where}: ${finding.detail ?? ''}`);
}

test('origins-gesture is the first browser rule, in the origins group, and it checks the tested pages, four at a time', () => {
  assert.deepEqual(
    ORIGINS_RULES.map((rule) => rule.id),
    ['origins-gesture'],
  );
  assert.equal(BROWSER_RULES[0]?.id, 'origins-gesture');
  assert.equal(gesture.pages, 'tested');
  assert.equal(gesture.concurrent, true);
  assert.equal(RULE_BY_ID.get('origins-gesture')?.stage, 'browser');
  assert.equal(RULE_BY_ID.get('origins-gesture')?.waivable, false);
});

test('the values of origins-gesture are the values of section 8', () => {
  assert.equal(PAGE_TIME_MS, 60_000);
  assert.equal(LEAVE_MS, 500);
  assert.equal(OTHER_ORIGIN_STATUS, 204);
  assert.ok(
    SPEC.includes(
      '| `origins-gesture` | browser | On each tested page, with JS on, from the navigation until the page is closed: nothing goes to another host before a gesture, a click on the control or a key that activates it (9.4).',
    ),
  );
});

/** What the check saw: nothing, but for `more`. */
const seenOf = (more: Partial<Seen>): Seen => ({ requests: [], connections: [], links: [], peers: [], ...more });

test('gestureFindings: one finding for each other origin, sorted, with its first URL', () => {
  const own = ownOf(['http://example.ch:4321', 'https://example.ch']);
  const reached = (url: string) => ({ url, blocked: false });
  const seen = seenOf({
    requests: [
      reached('http://example.ch:4321/'),
      reached('https://example.ch/og.jpg'),
      reached('https://maps.example.org/embed?a=1'),
      reached('https://stats.example.net/hit'),
      reached('https://maps.example.org/tile.png'),
      reached('wss://live.example.org/socket'),
      reached('data:text/plain,a'),
      reached('blob:http://example.ch:4321/0b7c'),
      reached('https://maps.example.org:8443/'),
      reached('http://maps.example.org/'),
      reached('no url'),
      // A WebSocket to the host and port of the page is the own origin, as CSP 'self' allows it.
      reached('ws://example.ch:4321/live'),
      reached('wss://example.ch/live'),
      reached('http://127.0.0.1:4321/'),
      { url: 'https://pixel.example.org/p.gif', blocked: true },
      { url: 'https://pixel.example.org/q.gif', blocked: true },
      { url: 'https://stats.example.net/blocked', blocked: true },
    ],
  });
  assert.deepEqual(gestureFindings(seen, own, new Set(['stats.example.net'])), [
    '1280×800: http://127.0.0.1:4321 got a request before a gesture: http://127.0.0.1:4321/',
    '1280×800: http://maps.example.org got a request before a gesture: http://maps.example.org/',
    '1280×800: https://live.example.org got a request before a gesture: wss://live.example.org/socket',
    '1280×800: https://maps.example.org got a request before a gesture: https://maps.example.org/embed?a=1 (and 1 more request)',
    '1280×800: https://maps.example.org:8443 got a request before a gesture: https://maps.example.org:8443/',
    '1280×800: https://pixel.example.org was the target of a request that the CSP blocked before a gesture: https://pixel.example.org/p.gif (and 1 more request)',
  ]);
  // A host of an origin with `load: "page"` passes in every scheme and port: the CSP of the site decides those.
  assert.deepEqual(
    gestureFindings(
      seenOf({ requests: seen.requests.filter((request) => !request.url.includes('127.0.0.1')) }),
      own,
      new Set(['maps.example.org', 'live.example.org', 'pixel.example.org']),
    ),
    ['1280×800: https://stats.example.net got a request before a gesture: https://stats.example.net/hit'],
  );
  assert.deepEqual(gestureFindings(seenOf({}), own, new Set()), []);
});

test('gestureFindings: a connection at the proxy, a link, and a peer connection', () => {
  const own = ownOf(['http://example.ch:4321', 'https://example.ch']);
  const seen = seenOf({
    requests: [{ url: 'https://both.example.org/a', blocked: false }],
    connections: [
      'CONNECT shared.example.org:443 HTTP/1.1',
      'CONNECT shared.example.org:443 HTTP/1.1',
      'CONNECT both.example.org:443 HTTP/1.1',
      'CONNECT odd.example.org:8443 HTTP/1.1',
      'GET http://plain.example.org/x HTTP/1.1',
      'CONNECT example.ch:443 HTTP/1.1',
      'CONNECT stats.example.net:443 HTTP/1.1',
    ],
    links: [
      { rel: 'preconnect', url: 'https://pc.example.org/' },
      { rel: 'canonical', url: 'https://canonical.example.org/' },
      { rel: 'Alternate', url: 'https://alternate.example.org/' },
      { rel: 'prerender', url: 'https://shared.example.org/p' },
      { rel: 'dns-prefetch', url: 'https://example.ch/' },
      { rel: 'icon', url: 'data:image/png;base64,AA==' },
    ],
    peers: [['stun:192.0.2.1:3478'], [], ['stun:192.0.2.1:3478']],
  });
  assert.deepEqual(gestureFindings(seen, own, new Set(['stats.example.net'])), [
    '1280×800: http://plain.example.org got a connection before a gesture: GET http://plain.example.org/x HTTP/1.1',
    '1280×800: https://both.example.org got a request before a gesture: https://both.example.org/a',
    '1280×800: https://pc.example.org is the target of a link rel="preconnect" before a gesture: https://pc.example.org/',
    '1280×800: https://shared.example.org got a connection before a gesture: CONNECT shared.example.org:443 HTTP/1.1',
    '1280×800: odd.example.org:8443 got a connection before a gesture: CONNECT odd.example.org:8443 HTTP/1.1',
    '1280×800: a peer connection was made before a gesture',
    '1280×800: a peer connection to stun:192.0.2.1:3478 was made before a gesture (2 times)',
  ]);
});

test('connectionTarget names the origin of a line of the proxy, and never throws', () => {
  assert.equal(connectionTarget('CONNECT a.example.org:443 HTTP/1.1').origin, 'https://a.example.org');
  assert.equal(connectionTarget('CONNECT A.Example.org:80 HTTP/1.1').origin, 'a.example.org:80');
  assert.equal(connectionTarget('CONNECT [2001:db8::1]:443 HTTP/1.1').origin, 'https://2001:db8::1');
  assert.equal(connectionTarget('GET http://b.example.org:8080/x HTTP/1.1').origin, 'http://b.example.org:8080');
  assert.equal(connectionTarget('\u0016\u0003\u0001').origin, '\u0016\u0003\u0001');
  assert.equal(connectionTarget('').origin, '');
});

test('visitorAgent is the user agent of Chrome of the same major version, without HeadlessChrome', () => {
  assert.equal(
    visitorAgent('153.0.8010.12', 'linux'),
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36',
  );
  assert.match(visitorAgent('158.0.1.2', 'darwin'), /^Mozilla\/5\.0 \(Macintosh; .*\) .* Chrome\/158\.0\.0\.0 Safari/);
});

test('urlText cuts a long URL to the limit, with …', () => {
  const long = `https://maps.example.org/?q=${'x'.repeat(400)}`;
  assert.equal(urlText(long).length, URL_TEXT_MAX);
  assert.ok(urlText(long).endsWith('…'));
  assert.equal(urlText('https://maps.example.org/'), 'https://maps.example.org/');
});

test('origins-gesture passes a page that contacts its own origin only', async () => {
  const index = pageWith('<img src="/a.png" alt=""><script>fetch("/data.json")</script>');
  assert.deepEqual(await detailsOf(index), []);
});

test('origins-gesture fails a frame and a fetch of another origin while the page loads', async () => {
  const index = pageWith(
    '<iframe title="Karte" src="https://maps.example.org/embed?zoom=12"></iframe>' +
      '<script>fetch("https://api.example.org/v1/hit?page=home")</script>',
  );
  assert.deepEqual(await detailsOf(index), [
    'origins-gesture /: 1280×800: https://api.example.org got a request before a gesture: https://api.example.org/v1/hit?page=home',
    'origins-gesture /: 1280×800: https://maps.example.org got a request before a gesture: https://maps.example.org/embed?zoom=12',
  ]);
});

test('origins-gesture fails a declared origin with load gesture, and passes it with load page', async () => {
  const index = pageWith('<script async src="https://stats.example.net/count.js"></script>');
  const gestureLoad = withOrigins([origin('stats.example.net', ['script'], { load: 'gesture' })]);
  assert.deepEqual(await detailsOf(index, gestureLoad), [
    'origins-gesture /: 1280×800: https://stats.example.net got a request before a gesture: https://stats.example.net/count.js',
  ]);
  const pageLoad = withOrigins([origin('stats.example.net', ['script'], { load: 'page' })]);
  assert.deepEqual(await detailsOf(index, pageLoad), []);
});

test('origins-gesture has no time edge: a request 1 s and one 3.5 s after load both fail', async () => {
  const at = (ms: number): string =>
    pageWith(
      `<script>addEventListener("load", () => setTimeout(() => fetch("https://late.example.org/"), ${ms}))</script>`,
    );
  // 8b fix: the page clock stands still and the check moves it by 60 s, so a timer of 3.5 s counts too.
  for (const ms of [1000, 3500]) {
    assert.deepEqual(await detailsOf(at(ms)), [
      'origins-gesture /: 1280×800: https://late.example.org got a request before a gesture: https://late.example.org/',
    ]);
  }
});

test('origins-gesture answers each request to another origin with 204 and an empty body', async () => {
  // The page asks a second host only when the first one answered 204 with an empty body: the harness answered it.
  const index = pageWith(
    '<script>fetch("https://first.example.org/a").then(async (answer) => {' +
      'const body = await answer.text();' +
      'if (answer.status === 204 && body === "") fetch("https://after-204.example.org/");' +
      '})</script>',
  );
  assert.deepEqual(await detailsOf(index), [
    'origins-gesture /: 1280×800: https://after-204.example.org got a request before a gesture: https://after-204.example.org/',
    'origins-gesture /: 1280×800: https://first.example.org got a request before a gesture: https://first.example.org/a',
  ]);
});

test('origins-gesture fails a WebSocket and a worker that contact another host', async () => {
  const index = pageWith('<script>new WebSocket("wss://live.example.org/feed"); new Worker("/worker.js")</script>');
  const findings = await findingsOf(
    browser(),
    { 'index.html': index, 'worker.js': 'fetch("https://worker.example.org/ping")' },
    [gesture],
    { settings: withOrigins([]) },
  );
  assert.deepEqual(
    findings.map((finding) => finding.detail),
    [
      // A WebSocket names the https origin of its host, which its connection reaches, so it sorts there (8b fix).
      '1280×800: https://live.example.org got a request before a gesture: wss://live.example.org/feed',
      '1280×800: https://worker.example.org got a request before a gesture: https://worker.example.org/ping',
    ],
  );
});

test('origins-gesture reads every tested page and reports the page that made the request', async () => {
  const files = {
    'index.html': pageWith('<a href="/zimmer/">Zimmer</a>'),
    'zimmer/index.html': pageWith('<script>fetch("https://api.example.org/rooms")</script>'),
  };
  const findings = await findingsOf(browser(), files, [gesture], { settings: withOrigins([]) });
  assert.deepEqual(
    findings.map((finding) => `${finding.where} ${finding.detail ?? ''}`),
    ['/zimmer/ 1280×800: https://api.example.org got a request before a gesture: https://api.example.org/rooms'],
  );
});

/**
 * A rule of the test, under an id of the registry: it reports what a `fetch` of another origin gives in its tab, and
 * the URL of the frame of another origin. `cache` marks it as a rule of the perf pass.
 */
const probe = (cache: boolean): BrowserRule => ({
  id: 'perf-cls',
  pages: 'tested',
  cache,
  check: async (check) => {
    const tab = await check.open();
    const answer = await tab.evaluate(() =>
      fetch('https://api.example.org/x').then(
        async (response) => `answered ${response.status} with ${(await response.text()).length} characters`,
        () => 'refused',
      ),
    );
    check.report(`${answer}; frame ${tab.frames()[1]?.url() ?? 'none'}`);
  },
});

test('every check answers a request to another origin with 204, and the perf pass gets the refusing proxy', async () => {
  const index = pageWith('<iframe title="Karte" src="https://maps.example.org/embed"></iframe>');
  const detailOf = async (cache: boolean): Promise<string[]> => {
    const findings = await findingsOf(browser(), { 'index.html': index }, [probe(cache)], {
      settings: withOrigins([]),
    });
    return findings.map((finding) => finding.detail ?? '');
  };
  // The frame stays empty: its navigation got 204, which keeps the document it had.
  assert.deepEqual(await detailOf(false), ['answered 204 with 0 characters; frame ']);
  // The perf pass keeps the browser cache, so no route answers: the proxy refused the tunnel, and Chromium shows its
  // error page in the frame. No request left the machine either way.
  assert.deepEqual(await detailOf(true), ['refused; frame chrome-error://chromewebdata/']);
});

test('the rules of the perf pass, and only they, keep the browser cache', () => {
  assert.deepEqual(
    BROWSER_RULES.filter((rule) => rule.cache === true).map((rule) => rule.id),
    ['perf-lcp-priority', 'perf-cls', 'perf-image-oversize', 'perf-bfcache', 'perf-prerender', 'perf-prefetch'],
  );
});

test('the refusing proxy answers every request with 403 and records its first line', async () => {
  const proxy = await startRefusingProxy();
  try {
    assert.match(proxy.server, /^http:\/\/127\.0\.0\.1:\d+$/);
    const port = Number(new URL(proxy.server).port);
    const answer = await new Promise<string>((done, fail) => {
      const socket = connect(port, '127.0.0.1', () => {
        socket.write('CONNECT maps.example.org:443 HTTP/1.1\r\nHost: maps.example.org:443\r\n\r\n');
      });
      let text = '';
      socket.on('data', (chunk) => {
        text += chunk.toString('latin1');
      });
      socket.on('end', () => done(text));
      socket.on('error', fail);
    });
    assert.equal(answer, REFUSAL);
    assert.deepEqual(proxy.refused, ['CONNECT maps.example.org:443 HTTP/1.1']);
  } finally {
    await proxy.close();
  }
});

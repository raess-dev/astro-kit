/**
 * The ways in which a page reaches another host before a gesture, each of which `origins-gesture` must see
 * (specification, section 8, `origins-gesture`, and 9.4), and the lock that keeps the browser of a run off the network
 * (section 8, the harness, Network). Each case writes a temp `dist/` from strings and opens it in Chromium (14.1).
 * Every host of another origin is under `.example` or in TEST-NET-1, and the harness answers or refuses each request
 * to it: no case reaches the network.
 */
import assert from 'node:assert/strict';
import { createServer, type Socket } from 'node:net';
import { test } from 'node:test';
import { gesture } from '../../src/browser/origins.ts';
import { runBrowser } from '../../src/browser.ts';
import type { Options } from '../../src/options.ts';
import { Report } from '../../src/registry.ts';
import { BODY, CSS, findingsOf, html, useBrowser } from './browser-fixtures.ts';
import { DESIGN } from './css-rules-fixtures.ts';
import { type Files, inTempAsync, optionsOf, SMALLEST } from './fixtures.ts';

const browser = useBrowser();

/** The smallest settings with bundled scripts on. Their `site` is `https://example.ch`. */
const SETTINGS: Options = optionsOf({ ...SMALLEST, features: { scripts: true } });

/** A page of the tests with `extra` after `main`, and `head` in the head. */
const pageWith = (extra: string, head = ''): string => html(`${BODY}${extra}`, { css: CSS, head });

/** A page with one script. */
const scripted = (script: string, head = ''): string => pageWith(`<script>${script}</script>`, head);

/** The details of `origins-gesture` on the pages of `files`, as `<where> <detail>`. */
async function detailsOf(files: Files): Promise<string[]> {
  const findings = await findingsOf(browser(), files, [gesture], { settings: SETTINGS });
  return findings.map((finding) => `${finding.where} ${finding.detail ?? ''}`);
}

/** The other origins that the findings of `files` name, one for each page, as `<where> <origin>`. */
async function originsOf(files: Files): Promise<string[]> {
  return (await detailsOf(files)).map((detail) => detail.replace(/^(\S+) 1280×800: (\S+) .*$/, '$1 $2'));
}

test('origins-gesture sees a shared worker, a prerender and a preconnect, which give no request event', async () => {
  const files = {
    'index.html': scripted('new SharedWorker("/w.js")'),
    'w.js': 'fetch("https://shared.example.org/s")',
    'pre/index.html': pageWith('', '<link rel="prerender" href="https://prerender.example.org/p">'),
    'added/index.html': scripted(
      'for (const [rel, host] of [["prerender", "added-prerender"], ["preconnect", "added-preconnect"]]) {' +
        'const link = document.createElement("link"); link.rel = rel; link.href = "https://" + host + ".example.org/";' +
        'document.head.append(link); }',
    ),
  };
  assert.deepEqual(await detailsOf(files), [
    '/ 1280×800: https://shared.example.org got a connection before a gesture: CONNECT shared.example.org:443 HTTP/1.1',
    '/added/ 1280×800: https://added-preconnect.example.org is the target of a link rel="preconnect" before a gesture: https://added-preconnect.example.org/',
    '/added/ 1280×800: https://added-prerender.example.org got a connection before a gesture: CONNECT added-prerender.example.org:443 HTTP/1.1',
    '/pre/ 1280×800: https://prerender.example.org got a connection before a gesture: CONNECT prerender.example.org:443 HTTP/1.1',
  ]);
});

test('origins-gesture sees a beacon and a keepalive fetch when the visitor leaves the page', async () => {
  const files = {
    'index.html': scripted(
      'addEventListener("pagehide", () => navigator.sendBeacon("https://hide.example.org/b", "x"))',
    ),
    'bye/index.html': scripted(
      'addEventListener("beforeunload", () => navigator.sendBeacon("https://bye.example.org/b", "x"))',
    ),
    'hidden/index.html': scripted(
      'document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") ' +
        'fetch("https://hidden.example.org/k", { method: "POST", body: "x", keepalive: true }) })',
    ),
  };
  assert.deepEqual(await originsOf(files), [
    '/ https://hide.example.org',
    '/bye/ https://bye.example.org',
    '/hidden/ https://hidden.example.org',
  ]);
});

test('origins-gesture sees a peer connection, which the CSP cannot stop', async () => {
  const files = {
    'index.html': scripted(
      'const peer = new RTCPeerConnection({ iceServers: [{ urls: "stun:192.0.2.1:3478" }] });' +
        'peer.createDataChannel("x"); peer.createOffer().then((offer) => peer.setLocalDescription(offer));',
    ),
    'plain/index.html': scripted('new webkitRTCPeerConnection()'),
    // The constructor of the prototype is the watched one too.
    'proto/index.html': scripted(
      'new RTCPeerConnection.prototype.constructor({ iceServers: [{ urls: ["stun:192.0.2.2:3478", "turn:192.0.2.3"] }] })',
    ),
  };
  assert.deepEqual(await detailsOf(files), [
    '/ 1280×800: a peer connection to stun:192.0.2.1:3478 was made before a gesture',
    '/plain/ 1280×800: a peer connection was made before a gesture',
    '/proto/ 1280×800: a peer connection to stun:192.0.2.2:3478 turn:192.0.2.3 was made before a gesture',
  ]);
});

test('origins-gesture sees a peer connection of a new frame or popup that a script reads at once', async () => {
  const peer = (from: string, host: number): string =>
    `new ${from}.RTCPeerConnection({ iceServers: [{ urls: "stun:192.0.2.${host}:3478" }] });`;
  const frame = (setup = ''): string =>
    `const f = document.createElement("iframe"); f.title = "x"; ${setup} document.body.append(f);`;
  const files = {
    // The new frame is about:blank; the script reads its constructor in the same task.
    'index.html': scripted(`${frame()} ${peer('f.contentWindow', 1)}`),
    'blank/index.html': scripted(`${frame('f.src = "about:blank";')} ${peer('f.contentWindow', 2)}`),
    // A srcdoc frame keeps its window when its document loads, so a constructor read at once stays valid.
    'srcdoc/index.html': scripted(`${frame('f.srcdoc = "<p>x</p>";')} ${peer('f.contentWindow', 3)}`),
    'popup/index.html': scripted(`const w = open(""); ${peer('w', 4)}`),
    'indexed/index.html': scripted(`${frame()} ${peer('frames[0]', 5)}`),
    'parsed/index.html': pageWith(`<iframe title="x"></iframe><script>${peer('frames[0]', 6)}</script>`),
    'nested/index.html': scripted(
      `${frame()} const g = f.contentDocument.createElement("iframe"); f.contentDocument.body.append(g); ${peer('g.contentWindow', 7)}`,
    ),
    // A frame that may run no script of its own still has a constructor that its parent can call.
    'sandbox/index.html': scripted(`${frame('f.sandbox = "allow-same-origin";')} ${peer('f.contentWindow', 8)}`),
  };
  assert.deepEqual(await detailsOf(files), [
    '/ 1280×800: a peer connection to stun:192.0.2.1:3478 was made before a gesture',
    '/blank/ 1280×800: a peer connection to stun:192.0.2.2:3478 was made before a gesture',
    '/indexed/ 1280×800: a peer connection to stun:192.0.2.5:3478 was made before a gesture',
    '/nested/ 1280×800: a peer connection to stun:192.0.2.7:3478 was made before a gesture',
    '/parsed/ 1280×800: a peer connection to stun:192.0.2.6:3478 was made before a gesture',
    '/popup/ 1280×800: a peer connection to stun:192.0.2.4:3478 was made before a gesture',
    '/sandbox/ 1280×800: a peer connection to stun:192.0.2.8:3478 was made before a gesture',
    '/srcdoc/ 1280×800: a peer connection to stun:192.0.2.3:3478 was made before a gesture',
  ]);
});

test('origins-gesture moves the page clock: a timer at 1.9 s, 2.1 s and 30 s after load counts', async () => {
  const at = (ms: number): string =>
    scripted(`addEventListener("load", () => setTimeout(() => fetch("https://t${ms}.example.org/"), ${ms}))`);
  const files = { 'index.html': at(1900), 'b/index.html': at(2100), 'c/index.html': at(30_000) };
  assert.deepEqual(await originsOf(files), [
    '/ https://t1900.example.org',
    '/b/ https://t2100.example.org',
    '/c/ https://t30000.example.org',
  ]);
});

test('origins-gesture makes the acts that give no consent: scroll, hover, Tab and focus', async () => {
  const tall = (script: string): string =>
    pageWith(`<div style="block-size:4000px"></div><footer id="end">Ende</footer><script>${script}</script>`);
  const frame = (host: string): string =>
    `{ const f = document.createElement("iframe"); f.title = "x"; f.src = "https://${host}.example.org/"; document.body.append(f); }`;
  const files = {
    'index.html': tall(`addEventListener("scroll", () => ${frame('scroll')}, { once: true })`),
    'seen/index.html': tall(
      `new IntersectionObserver((entries, o) => { if (entries.some((e) => e.isIntersecting)) { o.disconnect(); import("/late.js"); } })` +
        '.observe(document.getElementById("end"))',
    ),
    'late.js': `${frame('island')}; setTimeout(() => fetch("https://island-timer.example.org/"), 5000)`,
    'move/index.html': tall(`addEventListener("pointermove", () => ${frame('move')}, { once: true })`),
    'over/index.html': tall(`document.addEventListener("mouseover", () => ${frame('over')}, { once: true })`),
    'tab/index.html': tall(`addEventListener("keydown", () => ${frame('key')}, { once: true })`),
    'focus/index.html': tall(`addEventListener("focus", () => ${frame('focus')}, { once: true })`),
  };
  assert.deepEqual(await originsOf(files), [
    '/ https://scroll.example.org',
    '/focus/ https://focus.example.org',
    '/move/ https://move.example.org',
    '/over/ https://over.example.org',
    '/seen/ https://island-timer.example.org',
    '/seen/ https://island.example.org',
    '/tab/ https://key.example.org',
  ]);
});

test('origins-gesture scrolls one view at a time: an island in the middle of a long page hydrates (Codex, #30)', async () => {
  const files = {
    'index.html': pageWith(
      '<div style="block-size:6000px"></div><div id="mid">Mitte</div><div style="block-size:6000px"></div>' +
        '<script>new IntersectionObserver((entries, o) => { if (entries.some((e) => e.isIntersecting)) { o.disconnect(); ' +
        'fetch("https://middle.example.org/"); } }).observe(document.getElementById("mid"))</script>',
    ),
  };
  assert.deepEqual(await originsOf(files), ['/ https://middle.example.org']);
});

test('origins-gesture serves the site under its own https origin: an absolute same-site module runs (Codex, #30)', async () => {
  // 'self' must be the origin of the site, or the browser refuses the module.
  const csp = `<meta http-equiv="Content-Security-Policy" content="script-src 'self'">`;
  const files = {
    'index.html': pageWith('<script type="module" src="https://example.ch/abs.js"></script>', csp),
    'abs.js': 'fetch("https://abs.example.org/")',
    'proto/index.html': scripted(
      'if (location.protocol !== "https:" || location.port !== "") fetch("https://proto.example.org/")',
    ),
  };
  assert.deepEqual(await originsOf(files), ['/ https://abs.example.org']);
});

test('origins-gesture opens the page as a visitor: no webdriver, no HeadlessChrome, the host of site', async () => {
  const unless = (condition: string, host: string): string =>
    scripted(`if (!(${condition})) fetch("https://${host}.example.org/")`);
  const files = {
    'index.html': unless('navigator.webdriver', 'webdriver'),
    'agent/index.html': unless('/HeadlessChrome/.test(navigator.userAgent)', 'agent'),
    'host/index.html': unless('location.hostname === "127.0.0.1" || location.hostname === "localhost"', 'host'),
    'secure/index.html': unless('!isSecureContext', 'secure'),
  };
  assert.deepEqual(await originsOf(files), [
    '/ https://webdriver.example.org',
    '/agent/ https://agent.example.org',
    '/host/ https://host.example.org',
    '/secure/ https://secure.example.org',
  ]);
});

test('origins-gesture: the origin of site is the own origin, and a request that the CSP blocked has its own words', async () => {
  const csp = `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'unsafe-inline'">`;
  const files = {
    // In production the absolute URL of the site is 'self'.
    'index.html': scripted('new Image().src = "https://example.ch/og.jpg"; fetch("https://example.ch/data.json")', csp),
    'blocked/index.html': scripted('new Image().src = "https://pixel.example.org/p.gif"', csp),
    // A WebSocket to the host and port of the page is the own origin, as CSP 'self' allows it.
    'socket/index.html': scripted('new WebSocket("ws://" + location.host + "/live")'),
  };
  assert.deepEqual(await detailsOf(files), [
    '/blocked/ 1280×800: https://pixel.example.org was the target of a request that the CSP blocked before a gesture: https://pixel.example.org/p.gif',
  ]);
});

test('the browser of a run sends nothing to the network, not even through a proxy of the environment', async () => {
  const seen: string[] = [];
  const sockets = new Set<Socket>();
  const logger = createServer((socket) => {
    sockets.add(socket);
    socket.on('error', () => undefined);
    socket.once('data', (chunk: Buffer) => {
      seen.push(chunk.toString('latin1').split('\r\n')[0] ?? '');
      socket.end('HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n');
    });
  });
  await new Promise<void>((done) => logger.listen(0, '127.0.0.1', () => done()));
  const address = logger.address();
  const proxy = `http://127.0.0.1:${typeof address === 'object' && address !== null ? address.port : 0}`;
  const names = [
    'HTTPS_PROXY',
    'HTTP_PROXY',
    'https_proxy',
    'http_proxy',
    'ALL_PROXY',
    'all_proxy',
    'NO_PROXY',
    'no_proxy',
  ];
  const kept = new Map(names.map((name) => [name, process.env[name]]));
  for (const name of names) process.env[name] = name.toLowerCase().startsWith('no') ? '' : proxy;
  try {
    const report = new Report();
    await inTempAsync({ 'index.html': scripted('fetch("https://api.example.org/x")') }, (dist) =>
      // The runner launches the browsers itself: the one of the run and the one of `origins-gesture`.
      runBrowser({
        dist,
        options: SETTINGS,
        design: DESIGN,
        components: [],
        report,
        all: true,
        rules: [gesture],
        env: process.env,
      }),
    );
    assert.deepEqual(seen, []);
  } finally {
    for (const [name, value] of kept) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((done) => logger.close(() => done()));
  }
});

/**
 * `origins-gesture` (specification, section 8, the browser table, and 9.4): nothing reaches another host before the
 * visitor acts. A gesture is a click on the control or a key that activates it (9.4). The check makes no gesture.
 *
 * The check opens each tested page as a visitor's browser opens it: in the browser of the run for this rule
 * (`TestRun.visitor`), under the host of `site`, with a user agent of Chrome and no `navigator.webdriver`. Its
 * context answers each request to another origin with 204 and an empty body (`answerOtherOrigins`), and it sends
 * every other connection to a refusing proxy of its own, so the log of that proxy belongs to this one page.
 *
 * The page time stands still: Playwright's clock is paused before the navigation, and the check moves it on itself.
 * After `load` it advances the clock by 60 s, scrolls to the end of the page, moves the mouse over it, presses Tab
 * once, dispatches a window `focus`, and advances the clock by 60 s again. Then it leaves the page: it navigates the
 * tab to `about:blank` (`beforeunload`, `pagehide`, `visibilitychange`) and closes it. Every act is one that gives no
 * consent. So a page timer, a scroll, a hover, a focus and a beacon on leaving all count, and in every run the same.
 *
 * After each step the check waits until the page is calm (`calm`): two rounds in a row of two animation frames and
 * the end of every started request bring no new event. Each wait ends at an event. The only fixed wait is
 * `LEAVE_MS` after the tab closed, for a beacon that the browser sends on its own after the page is gone.
 *
 * It counts what reaches another host, or tries to: each request and WebSocket of the context, each connection that
 * its proxy gets (a shared worker, `link rel=prerender`, a beacon on leaving), each `link` that a browser may fetch
 * (an observer of the page reports it: Chromium makes no connection for `preconnect`), and each `RTCPeerConnection`,
 * whose UDP the lock of the browser stops.
 */
import type { Browser, BrowserContext, Page, Request } from 'playwright-core';
import { isFetchingRel } from '../audit/page/scripts.ts';
import { ACTION_LIMIT_MS, type BrowserRule, DESKTOP, NAVIGATION_LIMIT_MS, sizeText } from './harness.ts';
import { answerOtherOrigins, startRefusingProxy } from './network.ts';

/** How far the check moves the page clock, twice: after `load` and after the acts (section 8, `origins-gesture`). */
export const PAGE_TIME_MS = 60_000;

/** The fixed real wait after the tab closed, for the beacons that the browser sends after the page is gone. */
export const LEAVE_MS = 500;

/** The longest URL that a finding shows. A longer one is cut and ends with `…`. */
export const URL_TEXT_MAX = 200;

/** How many rounds in a row must bring no event before the page counts as calm, and the most rounds of one wait. */
const CALM_ROUNDS = 2;
const ROUNDS_MAX = 10;

/**
 * One scroll step, in px: less than the height of the view (800 px), so each part of the page is in view at one step,
 * and an element in the middle of a long page intersects the view (Codex, #30). At most `SCROLL_STEPS_MAX` steps
 * (60,000 px); then one wheel to the end.
 */
export const SCROLL_STEP_PX = 600;
export const SCROLL_STEPS_MAX = 100;

/** The longest wait for two animation frames, and for the end of the started requests, in one round. */
const FRAMES_LIMIT_MS = 5_000;
const DRAIN_LIMIT_MS = 2_000;

/** The most reports of one kind that a page can send to the check. A hostile page may send without end. */
const REPORTS_MAX = 1_000;

/** The names of the page side (`watchPage`): the binding that it reports to, and its wait for two frames. */
export const WATCH_NAMES = { binding: '__astroKitWatch', frames: '__astroKitFrames' } as const;

/** One request or WebSocket of the context: its URL, and whether the CSP of the page blocked it. */
export interface SeenRequest {
  url: string;
  blocked: boolean;
}

/** One `link` of the page, as the observer of the page saw it: its `rel` and its resolved `href`. */
export interface SeenLink {
  rel: string;
  url: string;
}

/** What `origins-gesture` saw of one page. */
export interface Seen {
  requests: readonly SeenRequest[];
  /** The first line of each connection that the proxy of the check got, such as `CONNECT a.example.org:443 HTTP/1.1`. */
  connections: readonly string[];
  links: readonly SeenLink[];
  /** The `iceServers` URLs of each `RTCPeerConnection` that the page made. */
  peers: readonly (readonly string[])[];
}

/** A URL for a finding: as the browser sent it, cut to `URL_TEXT_MAX` characters. */
export const urlText = (url: string): string =>
  url.length > URL_TEXT_MAX ? `${url.slice(0, URL_TEXT_MAX - 1)}…` : url;

/** The default port of each scheme that the rule reads. */
const DEFAULT_PORTS: ReadonlyMap<string, string> = new Map([
  ['http:', '80'],
  ['https:', '443'],
  ['ws:', '80'],
  ['wss:', '443'],
]);

/** `<host>:<port>` of a URL, with the default port of its scheme. */
const hostPortOf = (url: URL): string =>
  `${url.hostname}:${url.port === '' ? (DEFAULT_PORTS.get(url.protocol) ?? '') : url.port}`;

/** Where a request, a connection or a link goes: the origin of the finding, its host, and its host and port. */
interface Target {
  origin: string;
  host: string;
  hostPort: string;
  /** A WebSocket: it counts as the own origin when its host and port are those of the page, as CSP `'self'` does. */
  socket: boolean;
}

/** The target of a URL that goes over the network, or `undefined` for one with no host (`data:`, `blob:`, `about:`). */
function urlTarget(text: string): Target | undefined {
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return undefined;
  }
  if (!DEFAULT_PORTS.has(url.protocol) || url.hostname === '') return undefined;
  const socket = url.protocol === 'ws:' || url.protocol === 'wss:';
  return {
    // A WebSocket opens its connection as an http or https request to its host: its finding names that origin, so
    // the connection that the proxy got and the WebSocket give one finding.
    origin: socket ? `${url.protocol === 'ws:' ? 'http' : 'https'}://${url.host}` : url.origin,
    host: url.hostname,
    hostPort: hostPortOf(url),
    socket,
  };
}

/**
 * The target of the first line of a connection to the proxy. `CONNECT host:443` is `https://host`, another port is
 * named `host:port`. A request in absolute form (`GET http://host/ HTTP/1.1`) has the origin of its URL. Another
 * line is named as it is.
 */
export function connectionTarget(line: string): Target {
  const [method = '', target = ''] = line.split(' ');
  if (method === 'CONNECT') {
    const colon = target.lastIndexOf(':');
    const host = (colon === -1 ? target : target.slice(0, colon)).replace(/^\[(.*)\]$/, '$1').toLowerCase();
    const port = colon === -1 ? '443' : target.slice(colon + 1);
    return {
      origin: port === '443' ? `https://${host}` : `${host}:${port}`,
      host,
      hostPort: `${host}:${port}`,
      socket: false,
    };
  }
  return urlTarget(target) ?? { origin: urlText(line), host: '', hostPort: '', socket: false };
}

/**
 * The own origins of a page: the origin under which the check serves it and the origin of `site`. A WebSocket to
 * the host and port of one of them counts as own too.
 */
export interface Own {
  origins: ReadonlySet<string>;
  hostPorts: ReadonlySet<string>;
}

/** The own origins of `origins`, such as `http://example.ch:4321` and `https://example.ch`. */
export function ownOf(origins: readonly string[]): Own {
  const targets = origins.flatMap((origin) => urlTarget(origin) ?? []);
  return {
    origins: new Set(targets.map((target) => target.origin)),
    hostPorts: new Set(targets.map((target) => target.hostPort)),
  };
}

/** What one other origin got. */
interface OriginSeen {
  reached: string[];
  blocked: string[];
  connections: string[];
  links: SeenLink[];
}

const more = (count: number): string =>
  count === 0 ? '' : ` (and ${count} more ${count === 1 ? 'request' : 'requests'})`;

/** The detail of one other origin: the strongest thing that it got, from a request that reached it to a blocked one. */
function originDetail(origin: string, seen: OriginSeen): string {
  const size = sizeText(DESKTOP);
  const [first] = seen.reached;
  if (first !== undefined) {
    return `${size}: ${origin} got a request before a gesture: ${urlText(first)}${more(seen.reached.length - 1)}`;
  }
  const [connection] = seen.connections;
  if (connection !== undefined) return `${size}: ${origin} got a connection before a gesture: ${urlText(connection)}`;
  const [link] = seen.links;
  if (link !== undefined) {
    return `${size}: ${origin} is the target of a link rel="${urlText(link.rel)}" before a gesture: ${urlText(link.url)}`;
  }
  const [blocked = ''] = seen.blocked;
  return `${size}: ${origin} was the target of a request that the CSP blocked before a gesture: ${urlText(blocked)}${more(seen.blocked.length - 1)}`;
}

/**
 * The findings of one page. One for each other origin that the page reached or tried to reach, sorted by the
 * origin: a request comes first, then a connection at the proxy, then a link that a browser may fetch, then a request
 * that the CSP blocked. Then one for each set of `iceServers` URLs of a peer connection, sorted. A request passes
 * when it goes to an own origin (`own`) or to a host of an origin with `load: "page"` (`pageHosts`), in every scheme
 * and port.
 */
export function gestureFindings(seen: Seen, own: Own, pageHosts: ReadonlySet<string>): string[] {
  const byOrigin = new Map<string, OriginSeen>();
  const add = (target: Target | undefined, put: (entry: OriginSeen) => void): void => {
    if (target === undefined || passesTarget(target, own, pageHosts)) return;
    const entry = byOrigin.get(target.origin) ?? { reached: [], blocked: [], connections: [], links: [] };
    put(entry);
    byOrigin.set(target.origin, entry);
  };
  for (const request of seen.requests) {
    add(urlTarget(request.url), (entry) => (request.blocked ? entry.blocked : entry.reached).push(request.url));
  }
  for (const line of seen.connections) add(connectionTarget(line), (entry) => entry.connections.push(line));
  for (const link of seen.links) {
    const tokens = link.rel
      .toLowerCase()
      .split(/[\t\n\f\r ]+/)
      .filter((token) => token !== '');
    if (isFetchingRel(tokens)) add(urlTarget(link.url), (entry) => entry.links.push(link));
  }
  // Sorted by origin: two requests of one page can reach the harness in either order, and the output must not change.
  const details = [...byOrigin]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([origin, entry]) => originDetail(origin, entry));
  const peers = new Map<string, number>();
  for (const urls of seen.peers) {
    const text = urls.length === 0 ? 'a peer connection' : `a peer connection to ${urlText(urls.join(' '))}`;
    peers.set(text, (peers.get(text) ?? 0) + 1);
  }
  const size = sizeText(DESKTOP);
  for (const [text, count] of [...peers].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    details.push(`${size}: ${text} was made before a gesture${count === 1 ? '' : ` (${count} times)`}`);
  }
  return details;
}

/** Says whether a target passes: an own origin, a WebSocket to an own host and port, or a host with `load: "page"`. */
function passesTarget(target: Target, own: Own, pageHosts: ReadonlySet<string>): boolean {
  if (own.origins.has(target.origin) || pageHosts.has(target.host)) return true;
  return target.socket && own.hostPorts.has(target.hostPort);
}

/**
 * The page side of the check, sent to every document of the context as an init script, before Playwright's clock.
 * It reads nothing outside itself and keeps every reference that it needs, so a page script can break none of them.
 *
 * - It takes the binding of the check out of `window`, so a page can neither see it by its name nor call it.
 * - `RTCPeerConnection` (and `webkitRTCPeerConnection`) reports the `iceServers` URLs of each new connection.
 * - An observer reports the `rel` and the resolved `href` of each `link` that is added or changed.
 * - `window[names.frames]()` waits for two animation frames of the browser, which the clock does not hold.
 */
export function watchPage(names: { binding: string; frames: string }): void {
  const report: unknown = Reflect.get(globalThis, names.binding);
  Reflect.deleteProperty(globalThis, names.binding);
  const send = (kind: string, data: readonly string[]): void => {
    if (typeof report !== 'function') return;
    try {
      Reflect.apply(report, undefined, [kind, data]);
    } catch {
      // The check is gone: the page is closing.
    }
  };
  const Waiting = Promise;
  const frame = typeof requestAnimationFrame === 'function' ? requestAnimationFrame.bind(globalThis) : undefined;
  Object.defineProperty(globalThis, names.frames, {
    value: () =>
      new Waiting<void>((done) => {
        if (frame === undefined) done();
        else frame(() => frame(() => done()));
      }),
  });

  const Native = globalThis.RTCPeerConnection;
  if (typeof Native === 'function') {
    const urlsOf = (config: unknown): string[] => {
      const found: string[] = [];
      try {
        const servers: unknown = config !== null && typeof config === 'object' ? Reflect.get(config, 'iceServers') : [];
        for (const server of Array.isArray(servers) ? servers.slice(0, 20) : []) {
          if (server === null || typeof server !== 'object') continue;
          for (const key of ['urls', 'url']) {
            const value: unknown = Reflect.get(server, key);
            for (const url of Array.isArray(value) ? value.slice(0, 20) : [value]) {
              if (typeof url === 'string') found.push(url.slice(0, 300));
            }
          }
        }
      } catch {
        // A page may give a value that throws when it is read; the connection still counts.
      }
      return found;
    };
    const Peer = function RTCPeerConnection(this: unknown, ...args: unknown[]): object {
      if (new.target === undefined) throw new TypeError("Failed to construct 'RTCPeerConnection': use 'new'");
      send('peer', urlsOf(args[0]));
      return Reflect.construct(Native, args, new.target);
    };
    Peer.prototype = Native.prototype;
    Object.setPrototypeOf(Peer, Native);
    Object.defineProperty(Native.prototype, 'constructor', { value: Peer, writable: true, configurable: true });
    for (const name of ['RTCPeerConnection', 'webkitRTCPeerConnection']) {
      Object.defineProperty(globalThis, name, { value: Peer, writable: true, configurable: true });
    }
  }

  const Observer = globalThis.MutationObserver;
  const getAttribute = Element.prototype.getAttribute;
  const select = Element.prototype.querySelectorAll;
  const localName = Object.getOwnPropertyDescriptor(Element.prototype, 'localName')?.get;
  const baseUri = Object.getOwnPropertyDescriptor(Node.prototype, 'baseURI')?.get;
  const Address = URL;
  const readLink = (link: Element): void => {
    if (localName === undefined || Reflect.apply(localName, link, []) !== 'link') return;
    const rel: unknown = Reflect.apply(getAttribute, link, ['rel']);
    const href: unknown = Reflect.apply(getAttribute, link, ['href']);
    if (typeof href !== 'string') return;
    let url = href;
    try {
      const base: unknown = baseUri === undefined ? undefined : Reflect.apply(baseUri, link, []);
      url = new Address(href.trim(), typeof base === 'string' ? base : undefined).href;
    } catch {
      // Not a URL: no browser fetches it.
    }
    send('link', [typeof rel === 'string' ? rel : '', url]);
  };
  if (typeof Observer === 'function') {
    const observer = new Observer((records) => {
      for (const record of records) {
        if (record.type === 'attributes') {
          if (record.target instanceof Element) readLink(record.target);
          continue;
        }
        for (const node of record.addedNodes) {
          if (!(node instanceof Element)) continue;
          readLink(node);
          for (const inner of Reflect.apply(select, node, ['link']) as Iterable<Element>) readLink(inner);
        }
      }
    });
    observer.observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['rel', 'href'] });
  }
}

/** The platform part of the user agent of Chrome on each system, such as `X11; Linux x86_64`. */
const PLATFORMS: ReadonlyMap<string, string> = new Map([
  ['darwin', 'Macintosh; Intel Mac OS X 10_15_7'],
  ['win32', 'Windows NT 10.0; Win64; x64'],
]);

/** The user agent of Chrome (not `HeadlessChrome`) of the major version of `version`, such as `153.0.8010.12`. */
export function visitorAgent(version: string, platform: string = process.platform): string {
  const major = /^\d+/.exec(version)?.[0] ?? '0';
  const system = PLATFORMS.get(platform) ?? 'X11; Linux x86_64';
  return `Mozilla/5.0 (${system}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`;
}

const pause = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

/** Runs a step of the page and ignores its error: the page may navigate or close itself, and the check goes on. */
async function attempt(step: () => Promise<unknown>): Promise<void> {
  try {
    await step();
  } catch {
    // The page navigated, closed, or threw in a timer that the clock ran.
  }
}

/** What the context of one check records, and the events that it counts for `calm`. */
class Recorder {
  readonly requests: SeenRequest[] = [];
  readonly links: SeenLink[] = [];
  readonly peers: string[][] = [];
  /** The started requests that did not end yet, with the time in ms of `Date.now()` when each started. */
  readonly pending = new Map<Request, number>();
  private readonly index = new Map<Request, SeenRequest>();
  events = 0;

  request(request: Request): void {
    this.events += 1;
    const seen = { url: request.url(), blocked: false };
    this.requests.push(seen);
    this.index.set(request, seen);
    this.pending.set(request, Date.now());
  }

  ended(request: Request, failure?: string): void {
    this.pending.delete(request);
    const seen = this.index.get(request);
    if (seen !== undefined && failure === 'csp') seen.blocked = true;
  }

  socket(url: string): void {
    this.events += 1;
    this.requests.push({ url, blocked: false });
  }

  /** A report of the page side. A hostile page can call nothing here, but its values are still checked. */
  report(kind: unknown, data: unknown): void {
    if (!Array.isArray(data) || !data.every((item) => typeof item === 'string')) return;
    const texts = data.map((item) => String(item).slice(0, 2_000));
    if (kind === 'peer' && this.peers.length < REPORTS_MAX) {
      this.events += 1;
      this.peers.push(texts.slice(0, 20));
    }
    if (kind === 'link' && this.links.length < REPORTS_MAX && texts.length === 2) {
      this.events += 1;
      this.links.push({ rel: texts[0] ?? '', url: texts[1] ?? '' });
    }
  }
}

/** One check: its page, its context and its proxy. */
interface Visit {
  tab: Page;
  recorder: Recorder;
  proxy: Awaited<ReturnType<typeof startRefusingProxy>>;
}

/**
 * Waits until every started request ended and the proxy holds no silent connection. A request that did not end
 * `DRAIN_LIMIT_MS` after it started is not waited for again: Playwright never ends the request of the script of a
 * shared worker, for one. The wait decides no verdict, since the check counts a request when it starts.
 */
async function drained(visit: Visit): Promise<void> {
  const busy = (): boolean => {
    const now = Date.now();
    for (const [request, started] of visit.recorder.pending) {
      if (now - started < DRAIN_LIMIT_MS) return true;
      visit.recorder.pending.delete(request);
    }
    return visit.proxy.waiting > 0;
  };
  const end = Date.now() + DRAIN_LIMIT_MS;
  while (busy() && Date.now() < end) await pause(10);
}

/**
 * Waits until the page is calm: `CALM_ROUNDS` rounds in a row bring no event. A round waits for two animation
 * frames (an `IntersectionObserver` reports in the next frame) and for the end of the started requests.
 */
async function calm(visit: Visit): Promise<void> {
  let quiet = 0;
  for (let round = 0; round < ROUNDS_MAX && quiet < CALM_ROUNDS; round += 1) {
    const before = visit.recorder.events + visit.proxy.refused.length;
    await attempt(() =>
      Promise.race([
        visit.tab.evaluate((name) => {
          const wait: unknown = Reflect.get(globalThis, name);
          return typeof wait === 'function' ? Reflect.apply(wait, undefined, []) : undefined;
        }, WATCH_NAMES.frames),
        pause(FRAMES_LIMIT_MS),
      ]),
    );
    await drained(visit);
    quiet = visit.recorder.events + visit.proxy.refused.length === before ? quiet + 1 : 0;
  }
}

/**
 * Scrolls to the end of the page with the mouse wheel, `SCROLL_STEP_PX` at a time, and waits until the page is calm
 * after each step, so an `IntersectionObserver` or a `client:visible` island anywhere on the page sees its element.
 * It stops at the end of the page, or when a step moves the page no more.
 */
async function scrollToEnd(visit: Visit): Promise<void> {
  const { tab } = visit;
  const position = (): Promise<{ top: number; end: boolean }> =>
    tab.evaluate(() => ({
      top: scrollY,
      end: scrollY + innerHeight >= document.documentElement.scrollHeight - 1,
    }));
  await tab.mouse.move(DESKTOP.width / 2, DESKTOP.height / 2);
  for (let step = 0; step < SCROLL_STEPS_MAX; step += 1) {
    const before = await position();
    if (before.end) return;
    await tab.mouse.wheel(0, SCROLL_STEP_PX);
    await calm(visit);
    if ((await position()).top === before.top) return;
  }
  await tab.mouse.wheel(0, 1_000_000);
}

/** The acts of the check after `load`, in order: none of them is a gesture. Each one ends when the page is calm. */
async function act(visit: Visit): Promise<void> {
  const { tab } = visit;
  const steps: readonly (() => Promise<unknown>)[] = [
    async () => undefined,
    () => tab.clock.runFor(PAGE_TIME_MS),
    () => scrollToEnd(visit),
    async () => {
      await tab.mouse.move(0, 0);
      await tab.mouse.move(DESKTOP.width - 1, DESKTOP.height - 1, { steps: 8 });
    },
    () => tab.keyboard.press('Tab'),
    () => tab.evaluate(() => void dispatchEvent(new FocusEvent('focus'))),
    () => tab.clock.runFor(PAGE_TIME_MS),
  ];
  for (const step of steps) {
    await attempt(step);
    await calm(visit);
  }
}

/** Leaves the page: navigates the tab to `about:blank`, closes it, and waits `LEAVE_MS` and the started requests. */
async function leave(visit: Visit): Promise<void> {
  const { tab } = visit;
  // The navigation runs `beforeunload`, `pagehide` and `visibilitychange` of the page in every run; a closed tab
  // may end before the browser takes a beacon of `pagehide`.
  await attempt(() => tab.evaluate(() => void location.assign('about:blank')));
  await attempt(() => tab.waitForURL('about:blank', { timeout: ACTION_LIMIT_MS }));
  const closed = new Promise<void>((done) => tab.once('close', () => done()));
  await attempt(() => tab.close({ runBeforeUnload: true }));
  await Promise.race([closed, pause(ACTION_LIMIT_MS)]);
  await pause(LEAVE_MS);
  await drained(visit);
}

/**
 * Serves each request of `context` to `origin`, the origin of `site`, from the test server at `served`: a route
 * fetches the same path and query there and answers with its status, headers and body, and follows no redirect (the
 * server writes a redirect on its own origin as a path). So the page runs under the origin of the site, `https`
 * with no port, as in production: `'self'` of its CSP is that origin, and an absolute URL of the site loads from the
 * built `dist` (Codex, #30). A later route of Playwright runs first, so this route comes after `answerOtherOrigins`.
 */
async function serveUnder(context: BrowserContext, origin: string, served: string): Promise<void> {
  await context.route(
    (url) => url.origin === origin,
    async (route) => {
      const url = new URL(route.request().url());
      const response = await route.fetch({ url: `${served}${url.pathname}${url.search}`, maxRedirects: 0 });
      await route.fulfill({ response });
    },
  );
}

/** A context of the visitor's browser for one check, with its records. */
async function visitorContext(
  browser: Browser,
  origin: string,
  served: string,
  proxy: Visit['proxy'],
  recorder: Recorder,
): Promise<BrowserContext> {
  const context = await browser.newContext({
    viewport: DESKTOP,
    deviceScaleFactor: 1,
    javaScriptEnabled: true,
    userAgent: visitorAgent(browser.version()),
    proxy: { server: proxy.server, bypass: `127.0.0.1,${new URL(origin).host}` },
  });
  context.setDefaultTimeout(ACTION_LIMIT_MS);
  context.setDefaultNavigationTimeout(NAVIGATION_LIMIT_MS);
  context.on('request', (request) => recorder.request(request));
  context.on('requestfinished', (request) => recorder.ended(request));
  context.on('requestfailed', (request) => recorder.ended(request, request.failure()?.errorText));
  context.on('page', (tab) => {
    tab.on('websocket', (socket) => recorder.socket(socket.url()));
    tab.on('dialog', (dialog) => void dialog.accept().catch(() => undefined));
  });
  await answerOtherOrigins(context, origin);
  await serveUnder(context, origin, served);
  await context.exposeBinding(WATCH_NAMES.binding, (_source, kind: unknown, data: unknown) =>
    recorder.report(kind, data),
  );
  await context.addInitScript(watchPage, WATCH_NAMES);
  await context.clock.install();
  await context.clock.pauseAt(Date.now() + 1_000);
  return context;
}

/** `origins-gesture` on each tested page at 1280×800, with JavaScript on (section 8). */
export const gesture: BrowserRule = {
  id: 'origins-gesture',
  pages: 'tested',
  concurrent: true,
  check: async (check) => {
    const { run } = check;
    const own = ownOf([run.visitorOrigin, run.options.site]);
    const pageHosts = new Set(
      run.options.origins.filter((origin) => origin.load === 'page').map((origin) => origin.host),
    );
    const recorder = new Recorder();
    const proxy = await startRefusingProxy();
    let context: BrowserContext | undefined;
    try {
      context = await visitorContext(await run.visitor(), run.visitorOrigin, run.origin, proxy, recorder);
      const tab = await context.newPage();
      const response = await tab.goto(`${run.visitorOrigin}${check.page.path}`, { waitUntil: 'load' });
      const status = response?.status() ?? 200;
      if (status < 200 || status > 299) throw new Error(`${check.page.path} answered ${status}`);
      const visit: Visit = { tab, recorder, proxy };
      await act(visit);
      await leave(visit);
      const seen: Seen = {
        requests: recorder.requests,
        connections: proxy.refused,
        links: recorder.links,
        peers: recorder.peers,
      };
      for (const detail of gestureFindings(seen, own, pageHosts)) check.report(detail);
    } finally {
      await context?.close().catch(() => undefined);
      await proxy.close();
    }
  },
};

/** The origins rules of the browser stage. */
export const ORIGINS_RULES: readonly BrowserRule[] = [gesture];

/**
 * The perf rules of the browser stage (specification, section 8): `perf-lcp-priority`, `perf-cls`,
 * `perf-image-oversize`, `perf-bfcache`, `perf-prerender` and `perf-prefetch`. They run on the tested pages: the
 * sample, or every page with `--all`.
 *
 * Every wait of these rules ends at an event: a request that the test server got, an entry of the page's
 * performance timeline, a `pageshow`, the load of the images, the end of the animations. Each wait has a limit, and
 * a rule reports when its event did not come within that limit. No rule repeats a measurement. The fixed pauses of
 * `perf-cls` are part of its measurement (section 8). A verdict never depends on the speed of the machine: `perf-cls`
 * moves every animation in fixed steps of one frame, so each run paints the same frames. A measured number in a
 * detail, such as a CLS value that a page script's timer changes, may differ between runs.
 *
 * The code that runs in the page is a callback of `page.evaluate` or an init script. Playwright sends its source to
 * the page, so a callback reads nothing outside itself.
 */
import type { CDPSession, ElementHandle, Page } from 'playwright-core';
import type { Received } from '../serve.ts';
import {
  type BrowserRule,
  type Check,
  DESKTOP,
  NARROW,
  NAVIGATION_LIMIT_MS,
  settle,
  sizeText,
  type Viewport,
} from './harness.ts';

// The devices of the perf pass

/** A viewport with a device scale factor. */
export interface Device extends Viewport {
  scale: number;
}

/** The phone and the desktop of `perf-lcp-priority`, and of `perf-image-oversize`. */
export const PHONE: Device = { width: 390, height: 844, scale: 3 };
export const WIDE: Device = { width: 1440, height: 900, scale: 1 };
export const PERF_DEVICES: readonly Device[] = [PHONE, WIDE];

/** `390×844@3`: the text of a device in a finding. */
export const deviceText = (device: Device): string => `${device.width}×${device.height}@${device.scale}`;

/** The viewport part of a device, for `setViewportSize`. */
const viewportOf = (device: Device): Viewport => ({ width: device.width, height: device.height });

/** A number for a finding, cut (not rounded) to `digits` decimals, so a failing value never reads as the limit. */
export function cut(value: number, digits: number): string {
  const factor = 10 ** digits;
  return (Math.floor(value * factor + 1e-9) / factor).toFixed(digits);
}

/** A pause in Node, as a part of a measurement that section 8 gives in time (`perf-cls`). */
const pause = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

/** Waits until `ready()` gives a value other than `undefined`, for `ms` at most. It looks every 20 ms. */
async function until<T>(ready: () => T | undefined | Promise<T | undefined>, ms: number): Promise<T | undefined> {
  const end = Date.now() + ms;
  for (;;) {
    const value = await ready();
    if (value !== undefined || Date.now() >= end) return value;
    await new Promise((done) => setTimeout(done, 20));
  }
}

// perf-lcp-priority

/** The network of `perf-lcp-priority`: latency in ms, throughput in bytes per second. */
export const LCP_NETWORK = { latency: 150, downloadThroughput: 200_000, uploadThroughput: 75_000 } as const;

/** The CPU slowdown of `perf-lcp-priority`. */
export const LCP_CPU_RATE = 4;

/**
 * Throttles a tab before its navigation: the network of `LCP_NETWORK` for every request, the CPU 4× slower, and the
 * cache off. The session belongs to the tab, so it ends with it.
 */
async function throttle(page: Page): Promise<CDPSession> {
  const session = await page.context().newCDPSession(page);
  await session.send('Network.enable');
  await session.send('Network.setCacheDisabled', { cacheDisabled: true });
  await session.send('Network.emulateNetworkConditionsByRule', {
    matchedNetworkConditions: [{ urlPattern: '', ...LCP_NETWORK }],
  });
  await session.send('Emulation.setCPUThrottlingRate', { rate: LCP_CPU_RATE });
  return session;
}

/**
 * An init script: it keeps every `largest-contentful-paint` entry of the page in `window.__astroKitLcp`, from the
 * start of the document.
 */
function watchLcp(): void {
  const entries: PerformanceEntry[] = [];
  const waiting: (() => void)[] = [];
  Object.defineProperty(window, '__astroKitLcp', { value: entries });
  // A promise for the next entry: `lastLcp` waits on it.
  Object.defineProperty(window, '__astroKitLcpNext', {
    value: () => new Promise<void>((done) => waiting.push(done)),
  });
  try {
    new PerformanceObserver((list) => {
      entries.push(...list.getEntries());
      for (const done of waiting.splice(0)) done();
    }).observe({ type: 'largest-contentful-paint', buffered: true });
  } catch {
    // A browser without the entry type gives no candidate.
  }
}

/** What `perf-lcp-priority` reads of the last LCP candidate. */
interface LcpImage {
  /** The candidate is an `img`. Else the rule has nothing to check: text, a background image, a video. */
  image: boolean;
  name: string;
  /** The IDL values, as the browser reads the attributes: `fetchPriority` is `high`, `low` or `auto`. */
  fetchPriority: string;
  /** `lazy` or `eager`. */
  loading: string;
}

/** How long `lastLcp` waits for the entry of an image that the page shows larger than the last candidate. */
export const LCP_ENTRY_WAIT_MS = 5_000;

/**
 * How long `lastLcp` waits for the load of an image in the viewport that is not complete: the page load limit. A
 * heavy lazy image on the throttled network loads late, and it is the LCP element all the same.
 */
export const LCP_IMAGE_WAIT_MS = NAVIGATION_LIMIT_MS;

/**
 * The last LCP candidate of the page: the entry of the largest element that the page painted before any input.
 * Chromium reports an entry when the frame of the paint is presented, some time after the paint. So the wait ends
 * at an event: while a loaded image in the viewport is larger than the last candidate and has no entry, it waits for
 * the next entry, for `LCP_ENTRY_WAIT_MS` at most. A lazy image in the viewport loads after `load`, so the wait first
 * takes its `load` event, for `LCP_IMAGE_WAIT_MS` at most. The size of an image is its visible area, scaled down when
 * the image is shown larger than its natural size, as the LCP algorithm counts it. `null` when the page has no
 * candidate. The attributes are read as the browser reads them, through the IDL values: `fetchpriority=" high "` is
 * `auto`.
 */
function lastLcp(page: Page): Promise<LcpImage | null> {
  return page.evaluate(
    async (limits) => {
      type Entry = PerformanceEntry & { element?: Element | null; size?: number };
      const kit = window as unknown as { __astroKitLcp?: Entry[]; __astroKitLcpNext?: () => Promise<void> };
      const entries = kit.__astroKitLcp ?? [];
      const timeLeft = (deadline: number): Promise<unknown> =>
        new Promise((done) => setTimeout(done, Math.max(0, deadline - Date.now())));
      // A lazy image in the viewport loads after the `load` event: the wait is for its `load` or `error`.
      const inView = (image: HTMLImageElement): boolean => {
        const box = image.getBoundingClientRect();
        return box.right > 0 && box.bottom > 0 && box.left < innerWidth && box.top < innerHeight;
      };
      const loading = Array.from(document.images).filter((image) => !image.complete && inView(image));
      const loaded = loading.map(
        (image) =>
          new Promise((done) => {
            image.addEventListener('load', done, { once: true });
            image.addEventListener('error', done, { once: true });
          }),
      );
      await Promise.race([Promise.all(loaded), timeLeft(Date.now() + limits.image)]);
      await Promise.all(
        Array.from(document.images, (image) => (image.complete ? image.decode().catch(() => undefined) : undefined)),
      );
      const sizeOf = (image: HTMLImageElement): number => {
        const box = image.getBoundingClientRect();
        const width = Math.max(0, Math.min(box.right, innerWidth) - Math.max(box.left, 0));
        const height = Math.max(0, Math.min(box.bottom, innerHeight) - Math.max(box.top, 0));
        const shown = box.width * box.height;
        const natural = image.naturalWidth * image.naturalHeight;
        return shown > 0 ? width * height * Math.min(1, natural / shown) : 0;
      };
      const unreported = (): boolean => {
        const last = entries.at(-1)?.size ?? 0;
        const seen = new Set(entries.map((entry) => entry.element));
        return Array.from(document.images).some(
          (image) =>
            image.complete &&
            image.naturalWidth > 0 &&
            !seen.has(image) &&
            window.__astroKit.visible(image) &&
            sizeOf(image) > last,
        );
      };
      const end = Date.now() + limits.entry;
      while (unreported() && Date.now() < end && kit.__astroKitLcpNext) {
        await Promise.race([kit.__astroKitLcpNext(), timeLeft(end)]);
      }
      const element = entries.at(-1)?.element ?? null;
      if (element === null) return null;
      const isImage = element instanceof HTMLImageElement;
      return {
        image: isImage,
        name: isImage
          ? `${window.__astroKit.describe(element)} (${new URL(element.currentSrc || element.src, document.baseURI).pathname})`
          : window.__astroKit.describe(element),
        fetchPriority: isImage ? element.fetchPriority : '',
        loading: isImage ? element.loading : '',
      };
    },
    { image: LCP_IMAGE_WAIT_MS, entry: LCP_ENTRY_WAIT_MS },
  );
}

/**
 * `perf-lcp-priority`: on a phone (390×844 at device scale 3) and a desktop (1440×900 at scale 1), with the network
 * of `LCP_NETWORK`, the CPU 4× slower and the cache off, an image that is the LCP element has `fetchpriority="high"`
 * and no `loading="lazy"`.
 */
export const lcpPriority: BrowserRule = {
  id: 'perf-lcp-priority',
  pages: 'tested',
  concurrent: true,
  check: async (check) => {
    for (const device of PERF_DEVICES) {
      const context = await check.context({ viewport: viewportOf(device), deviceScaleFactor: device.scale });
      await context.addInitScript(watchLcp);
      const page = await check.open({
        context,
        viewport: viewportOf(device),
        prepare: async (tab) => {
          await throttle(tab);
        },
      });
      const lcp = await lastLcp(page);
      if (lcp === null || !lcp.image) continue;
      const problems: string[] = [];
      if (lcp.fetchPriority !== 'high') problems.push('has no fetchpriority="high"');
      if (lcp.loading === 'lazy') problems.push('has loading="lazy"');
      if (problems.length > 0) {
        check.report(`${deviceText(device)}: the LCP element ${lcp.name} ${problems.join(' and ')}`);
      }
    }
  },
};

// perf-cls

/** The largest CLS of a page: the largest session window. */
export const CLS_MAX = 0.05;
/** A session window ends at a gap of 1 s between two shifts, or 5 s after its first shift. */
export const CLS_GAP_MS = 1_000;
export const CLS_CAP_MS = 5_000;
/** The pause after `load`, the pause between two scroll steps, and the wait for the images. */
export const CLS_PAUSE_MS = 500;
export const CLS_STEP_MS = 150;
export const CLS_IMAGES_MS = 10_000;
/** The most scroll steps on one page: a page taller than 100 half viewports is measured in its first part. */
export const CLS_STEPS = 100;
/**
 * The end of the measurement: at least `CLS_WATCH_MS` after `load`, and 2 s with no layout shift, after the images,
 * at most 10 s. The watch time catches a banner that a script adds a few seconds after load on a short page.
 */
export const CLS_QUIET_MS = 2_000;
export const CLS_QUIET_CAP_MS = 10_000;
export const CLS_WATCH_MS = 5_000;
/** One frame of the animation clock of `perf-cls`, in ms: the frame of a 60 Hz screen. */
export const CLS_FRAME_MS = 16.7;
/** How long `perf-cls` waits for the running animations to end before a scroll step, at most. */
export const CLS_ANIMATION_MS = 10_000;
/** The viewports of `perf-cls`, each in a context of its own. */
export const CLS_VIEWPORTS: readonly Viewport[] = [NARROW, DESKTOP];

/** One layout shift, as `perf-cls` keeps it. */
export interface Shift {
  time: number;
  value: number;
  /** The element of the largest source of the shift, or `''`. */
  source: string;
}

/** The largest session window of a list of shifts in time order (gap < 1 s, at most 5 s), with its largest shift. */
export function largestWindow(shifts: readonly Shift[]): { value: number; largest: Shift | undefined } {
  let best = { value: 0, largest: undefined as Shift | undefined };
  let value = 0;
  let start = Number.NEGATIVE_INFINITY;
  let previous = Number.NEGATIVE_INFINITY;
  let largest: Shift | undefined;
  for (const shift of shifts) {
    if (shift.time - previous >= CLS_GAP_MS || shift.time - start >= CLS_CAP_MS) {
      value = 0;
      start = shift.time;
      largest = undefined;
    }
    value += shift.value;
    previous = shift.time;
    if (largest === undefined || shift.value > largest.value) largest = shift;
    if (value > best.value) best = { value, largest };
  }
  return best;
}

/**
 * An init script: it keeps every layout shift without recent input in `window.__astroKitShifts`, from the start of
 * the document, with the element of its largest source.
 */
function watchShifts(): void {
  const shifts: { time: number; value: number; source: string }[] = [];
  Object.defineProperty(window, '__astroKitShifts', { value: shifts });
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as (PerformanceEntry & {
        value: number;
        hadRecentInput: boolean;
        sources?: { node: Node | null; previousRect: DOMRectReadOnly; currentRect: DOMRectReadOnly }[];
      })[]) {
        if (entry.hadRecentInput) continue;
        // The source with the largest area names the shift. `body` and `html` name it only when no other source does.
        let source = '';
        let area = -1;
        for (const part of entry.sources ?? []) {
          const size =
            part.previousRect.width * part.previousRect.height + part.currentRect.width * part.currentRect.height;
          const node = part.node;
          if (!(node instanceof Element)) continue;
          const root = node === document.body || node === document.documentElement;
          if (root && source === '') source = window.__astroKit.describe(node);
          if (!root && size > area) {
            area = size;
            source = window.__astroKit.describe(node);
          }
        }
        shifts.push({ time: entry.startTime, value: entry.value, source });
      }
    }).observe({ type: 'layout-shift', buffered: true });
  } catch {
    // A browser without the entry type gives no shift.
  }
}

/** Waits until every `img` of the page is complete (loaded or failed), for `ms` at most. */
function imagesLoaded(page: Page, ms: number): Promise<void> {
  return page.evaluate(async (limit) => {
    const pending = Array.from(document.images).filter((image) => !image.complete);
    const all = Promise.all(
      pending.map(
        (image) =>
          new Promise((done) => {
            image.addEventListener('load', done, { once: true });
            image.addEventListener('error', done, { once: true });
          }),
      ),
    );
    await Promise.race([all, new Promise((done) => setTimeout(done, limit))]);
  }, ms);
}

/**
 * Holds the document timeline of a tab before its navigation (CDP `Animation.setPlaybackRate` 0): every animation and
 * transition of the page stays at its start, from the first frame on. The clock of `startClock` then moves them.
 */
async function holdAnimations(page: Page): Promise<void> {
  const session = await page.context().newCDPSession(page);
  await session.send('Animation.enable');
  await session.send('Animation.setPlaybackRate', { playbackRate: 0 });
}

/**
 * The animation clock of `perf-cls`. In each animation frame, it moves every animation and transition that will
 * end by one frame of `CLS_FRAME_MS`: the timeline itself stands still (`holdAnimations`). So Chromium paints the
 * same frames in every run, however slow the machine is, and the layout shifts of an animated layout property get
 * the same values. An animation that never ends stays at its start, as **Themes** says. `busy()` tells whether an
 * animation still moves. `times` holds, for each frame, its time on the page's clock and on the clock of the
 * animations, where a frame after one that moved an animation lasts one step (`onClock`).
 */
function startClock(page: Page, frame: number): Promise<void> {
  return page.evaluate((step) => {
    const timeOf = (animation: Animation): number =>
      typeof animation.currentTime === 'number' ? animation.currentTime : 0;
    const endOf = (animation: Animation): number => {
      const end = animation.effect?.getComputedTiming().endTime;
      return typeof end === 'number' ? end : Number.POSITIVE_INFINITY;
    };
    // An animation that runs forward and will end. One that runs backward, or one that the page paused, keeps its
    // time.
    const moving = (): Animation[] =>
      window.__astroKit
        .animations()
        .filter(
          (animation) =>
            animation.playState === 'running' &&
            animation.playbackRate > 0 &&
            Number.isFinite(endOf(animation)) &&
            timeOf(animation) < endOf(animation),
        );
    // The time of each frame on the page's clock and on the clock of the animations, as pairs.
    const times: [number, number][] = [];
    let moved = false;
    // The timestamp of an animation frame callback stands still with the timeline, so the page's clock is
    // `performance.now()`.
    const tick = (): void => {
      const now = performance.now();
      const last = times.at(-1);
      times.push([now, last === undefined ? now : last[1] + (moved ? step : now - last[0])]);
      const running = moving();
      for (const animation of running) animation.currentTime = Math.min(endOf(animation), timeOf(animation) + step);
      moved = running.length > 0;
      requestAnimationFrame(tick);
    };
    Object.defineProperty(window, '__astroKitClock', { value: { busy: () => moving().length > 0, times } });
    requestAnimationFrame(tick);
  }, frame);
}

/**
 * The time of a layout shift on the clock of the animations. A shift has the time of the start of its frame, and the
 * clock reads its time in that frame, a little later. So the shift takes the time of the first frame of the clock at
 * or after it. A shift after the last frame takes the time of that frame plus the time since then. Before the first
 * frame, both clocks agree. So the gaps of the session windows between the shifts of an animation do not grow when
 * the machine paints its frames more slowly.
 */
export function onClock(time: number, times: readonly (readonly [number, number])[]): number {
  const first = times[0];
  if (first === undefined || time < first[0] - CLS_FRAME_MS) return time;
  for (const pair of times) if (pair[0] >= time) return pair[1];
  const last = times.at(-1) ?? first;
  return last[1] + (time - last[0]);
}

/** Waits until the clock moves no animation, for `CLS_ANIMATION_MS` at most. */
async function animationsDone(page: Page): Promise<void> {
  await page
    .waitForFunction(
      () => !(window as unknown as { __astroKitClock?: { busy(): boolean } }).__astroKitClock?.busy(),
      undefined,
      { timeout: CLS_ANIMATION_MS, polling: 20 },
    )
    .catch(() => undefined);
}

/**
 * Waits until at least `CLS_WATCH_MS` passed since `load` and the page had no layout shift for `CLS_QUIET_MS`, for
 * `CLS_QUIET_CAP_MS` at most.
 */
function quiet(page: Page): Promise<void> {
  return page.evaluate(
    async (limits) => {
      const shifts = (window as unknown as { __astroKitShifts?: Shift[] }).__astroKitShifts ?? [];
      const start = performance.now();
      const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
      const loaded = navigation !== undefined && navigation.loadEventEnd > 0 ? navigation.loadEventEnd : start;
      for (;;) {
        const now = performance.now();
        const last = Math.max(start, shifts.at(-1)?.time ?? 0);
        const done = now - loaded >= limits.watch && now - last >= limits.quiet;
        if (done || now - start >= limits.cap) return;
        await new Promise((next) => setTimeout(next, 50));
      }
    },
    { quiet: CLS_QUIET_MS, cap: CLS_QUIET_CAP_MS, watch: CLS_WATCH_MS },
  );
}

/** Measures `perf-cls` at one viewport and gives the detail of a failure, or `undefined`. */
async function clsAt(check: Check, viewport: Viewport): Promise<string | undefined> {
  const context = await check.context({ viewport });
  await context.addInitScript(watchShifts);
  const page = await check.open({ context, viewport, prepare: holdAnimations, settle: false });
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await startClock(page, CLS_FRAME_MS);
  await animationsDone(page);
  await pause(CLS_PAUSE_MS);
  for (let step = 0; step < CLS_STEPS; step += 1) {
    const more = await page.evaluate(() => {
      const root = document.scrollingElement ?? document.documentElement;
      const before = root.scrollTop;
      window.scrollTo({ top: before + window.innerHeight / 2, behavior: 'instant' });
      return root.scrollTop > before;
    });
    if (!more) break;
    await pause(CLS_STEP_MS);
    await animationsDone(page);
  }
  // The page watches the late shifts at its start, where a visitor reads first: content that a script puts above
  // the viewport of a scrolled page moves nothing in view (scroll anchoring).
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await imagesLoaded(page, CLS_IMAGES_MS);
  await animationsDone(page);
  await quiet(page);
  const measured = await page.evaluate(() => {
    const kit = window as unknown as {
      __astroKitShifts?: Shift[];
      __astroKitClock?: { times: [number, number][] };
    };
    return { shifts: kit.__astroKitShifts?.slice() ?? [], times: kit.__astroKitClock?.times.slice() ?? [] };
  });
  const shifts = measured.shifts.map((shift) => ({ ...shift, time: onClock(shift.time, measured.times) }));
  const { value, largest } = largestWindow(shifts);
  if (value <= CLS_MAX) return undefined;
  const source = largest?.source ? `; its largest shift moves ${largest.source}` : '';
  return `${sizeText(viewport)}: CLS ${cut(value, 3)} in the largest session window, at most ${CLS_MAX}${source}`;
}

/**
 * `perf-cls` at 390×844 and at 1280×800, each in a context of its own, at the same time. The timeline of the page stands still from
 * its start, and from `load` on a clock moves every animation one frame of 16.7 ms in each animation frame. The rule
 * waits until the animations end, pauses 500 ms, and scrolls down half a viewport every 150 ms to the end of the
 * page, each step after the animations that it started have ended. Then it scrolls back to the top, the images get
 * up to 10 s to load, and the measurement ends when at least 5 s passed since `load` and 2 s pass with no layout
 * shift, after 10 s at most. The largest session window of the layout
 * shifts must be at most 0.05.
 */
export const cls: BrowserRule = {
  id: 'perf-cls',
  pages: 'tested',
  concurrent: true,
  check: async (check) => {
    // The viewports run at the same time: most of the time goes to the fixed pauses, and the clock makes the
    // result of each one independent of the speed of the machine.
    const details = await Promise.all(CLS_VIEWPORTS.map((viewport) => clsAt(check, viewport)));
    for (const detail of details) if (detail !== undefined) check.report(detail);
  },
};

// perf-image-oversize

/** An image may load at most 1.5 times the pixels of its rendered width. */
export const OVERSIZE_FACTOR = 1.5;

/** One `img` as `perf-image-oversize` reads it. */
export interface LoadedImage {
  /** The number of the element in this tab: the same element keeps its number in each read. */
  id: number;
  name: string;
  /** The `currentSrc`, as a URL without its fragment, and its path. */
  href: string;
  url: string;
  /** The image is complete and loaded a raster file (not `.svg`). */
  raster: boolean;
  /** The image has a box at this device. */
  box: boolean;
  /** The image is visible, and its box is wider than 0. */
  shown: boolean;
  /** The width of the loaded file in pixels: the `w` descriptor, else the natural width times the density. */
  loaded: number;
  /** The rendered width in CSS pixels. */
  rendered: number;
  /** The loaded candidate is the smallest `w` candidate of its `srcset`. */
  smallest: boolean;
}

/** One candidate of a `srcset`: its URL and its descriptors. */
export interface Candidate {
  url: string;
  width?: number;
  density?: number;
}

/**
 * The candidates of a `srcset`, as HTML parses them ("parse a srcset attribute"): a URL, and at most one width
 * (`w`), one density (`x`) and one future height (`h`) descriptor. A width and a density together, a height without
 * a width, a width or a height of 0, a negative density and any other descriptor drop the candidate. A candidate
 * with no descriptor has the density 1.
 */
export function srcsetCandidates(text: string): Candidate[] {
  const candidates: Candidate[] = [];
  let at = 0;
  while (at < text.length) {
    while (at < text.length && /[\s,]/.test(text[at] ?? '')) at += 1;
    if (at >= text.length) break;
    let end = at;
    while (end < text.length && !/\s/.test(text[end] ?? '')) end += 1;
    let url = text.slice(at, end);
    at = end;
    const descriptors: string[] = [];
    if (url.endsWith(',')) {
      url = url.replace(/,+$/, '');
    } else {
      let depth = 0;
      let word = '';
      for (; at < text.length; at += 1) {
        const char = text[at] ?? '';
        if (char === '(') depth += 1;
        if (char === ')') depth = Math.max(0, depth - 1);
        if (depth === 0 && char === ',') break;
        if (depth === 0 && /\s/.test(char)) {
          if (word !== '') descriptors.push(word);
          word = '';
        } else word += char;
      }
      if (word !== '') descriptors.push(word);
      at += 1;
    }
    if (url === '') continue;
    let width: number | undefined;
    let density: number | undefined;
    let height: number | undefined;
    let error = false;
    for (const descriptor of descriptors) {
      const value = descriptor.slice(0, -1);
      const kind = descriptor.at(-1);
      if (kind === 'w' && /^\d+$/.test(value) && width === undefined && density === undefined) {
        width = Number(value);
        if (width === 0) error = true;
      } else if (
        kind === 'x' &&
        /^-?(\d+(\.\d+)?|\.\d+)([eE][+-]?\d+)?$/.test(value) &&
        width === undefined &&
        density === undefined &&
        height === undefined
      ) {
        density = Number(value);
        if (density < 0) error = true;
      } else if (kind === 'h' && /^\d+$/.test(value) && height === undefined && density === undefined) {
        height = Number(value);
        if (height === 0) error = true;
      } else error = true;
    }
    if (height !== undefined && width === undefined) error = true;
    if (error) continue;
    if (width !== undefined) candidates.push({ url, width });
    else candidates.push({ url, density: density ?? 1 });
  }
  return candidates;
}

/**
 * Every `img` of the page, in document order, with its loaded and its rendered width. The candidate is found by its
 * URL in the `srcset` of the `source` elements of its `picture` and of the `img`. An SVG file is no raster image.
 */
function readImages(page: Page): Promise<LoadedImage[]> {
  return page.evaluate(() => {
    interface Numbers {
      ids: WeakMap<HTMLImageElement, number>;
      next: number;
    }
    const kit = window as unknown as { __astroKitSrcset: typeof srcsetCandidates; __astroKitImages?: Numbers };
    const candidatesOf = kit.__astroKitSrcset;
    if (kit.__astroKitImages === undefined) {
      Object.defineProperty(window, '__astroKitImages', { value: { ids: new WeakMap(), next: 0 } });
    }
    const numbers: Numbers = kit.__astroKitImages ?? { ids: new WeakMap(), next: 0 };
    const found: LoadedImage[] = [];
    for (const image of Array.from(document.images)) {
      let id = numbers.ids.get(image);
      if (id === undefined) {
        id = numbers.next;
        numbers.next += 1;
        numbers.ids.set(image, id);
      }
      const current = image.currentSrc;
      const loaded = current !== '' && image.complete && image.naturalWidth > 0;
      const href = current === '' ? '' : (new URL(current).href.split('#')[0] ?? '');
      const url = current === '' ? '' : new URL(current).pathname;
      const raster = loaded && !url.toLowerCase().endsWith('.svg');
      const rendered = image.getBoundingClientRect().width;
      const read: LoadedImage = {
        id,
        name: window.__astroKit.describe(image),
        href,
        url,
        raster,
        box: image.getClientRects().length > 0,
        shown: rendered > 0 && window.__astroKit.visible(image),
        loaded: image.naturalWidth,
        rendered,
        smallest: false,
      };
      // The browser takes the first source whose media matches; a source whose media does not match gives nothing.
      const sets: string[] = [];
      if (image.parentElement instanceof HTMLPictureElement) {
        for (const child of Array.from(image.parentElement.children)) {
          if (!(child instanceof HTMLSourceElement) || child.srcset === '') continue;
          if (child.media === '' || window.matchMedia(child.media).matches) sets.push(child.srcset);
        }
      }
      if (image.srcset !== '') sets.push(image.srcset);
      for (const set of sets) {
        const candidates = candidatesOf(set).map((candidate) => ({
          ...candidate,
          href: new URL(candidate.url, document.baseURI).href,
        }));
        const match = candidates.find((candidate) => candidate.href === current);
        if (match === undefined) continue;
        if (match.width !== undefined) {
          read.loaded = match.width;
          const widths = candidates.flatMap((candidate) => (candidate.width === undefined ? [] : [candidate.width]));
          read.smallest = match.width <= Math.min(...widths);
        } else {
          read.loaded = image.naturalWidth * (match.density ?? 1);
        }
        break;
      }
      found.push(read);
    }
    return found;
  });
}

/** The resource timing entries of the page: each URL without its fragment, with the bytes of its body. */
function resources(page: Page): Promise<Map<string, number>> {
  return page
    .evaluate(() =>
      performance
        .getEntriesByType('resource')
        .map((entry): [string, number] => [
          entry.name.split('#')[0] ?? '',
          (entry as PerformanceResourceTiming).encodedBodySize,
        ]),
    )
    .then((entries) => new Map(entries));
}

/**
 * Makes the lazy images load. An image with `sizes="auto"` stays lazy, because HTML applies `auto` to a lazy image
 * only: the page scrolls it into view, and the wait is for its load. Every other lazy image becomes eager. The waits
 * share one limit of `ms`.
 */
function loadLazyImages(page: Page, ms: number): Promise<void> {
  return page.evaluate(async (limit) => {
    const end = Date.now() + limit;
    const auto = (image: HTMLImageElement): boolean =>
      (image.getAttribute('sizes') ?? '').split(',')[0]?.trim().toLowerCase() === 'auto';
    const settled = (image: HTMLImageElement): Promise<unknown> =>
      new Promise((done) => {
        if (image.complete) done(undefined);
        image.addEventListener('load', done, { once: true });
        image.addEventListener('error', done, { once: true });
        setTimeout(done, Math.max(0, end - Date.now()));
      });
    const lazy = Array.from(document.images).filter((image) => image.loading === 'lazy');
    for (const image of lazy) if (!auto(image)) image.loading = 'eager';
    for (const image of lazy) {
      if (!auto(image) || image.complete) continue;
      image.scrollIntoView({ block: 'center', behavior: 'instant' });
      await settled(image);
    }
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, ms);
}

/**
 * The images that `perf-image-oversize` judges: the first `img` in document order of each loaded file, among the
 * images that had loaded on their own; else, when the file came only with the lazy images, the first one of those,
 * when the page has a resource timing entry for the file. So an image that shows a file that another image of the
 * page loaded on its own, from the memory cache, adds nothing to the transfer and is not judged. A fetch by anything
 * else (a preload, a style sheet) does not exempt an image: whether Chromium then loads a lazy image on its own
 * depends on which of the two ends first, and the verdict must not.
 */
export function judged(
  early: readonly LoadedImage[],
  late: readonly LoadedImage[],
  after: ReadonlyMap<string, number>,
): LoadedImage[] {
  const chosen: LoadedImage[] = [];
  const seen = new Set<string>();
  const earlyFiles = new Set(early.filter((image) => image.raster).map((image) => image.href));
  for (const image of late) {
    if (!image.raster || seen.has(image.href)) continue;
    const wasEarly = early.some((other) => other.id === image.id && other.raster && other.href === image.href);
    if (earlyFiles.has(image.href) && !wasEarly) continue;
    if (!wasEarly && !after.has(image.href)) continue;
    seen.add(image.href);
    chosen.push(image);
  }
  return chosen;
}

/**
 * The init script that gives the page `srcsetCandidates` as `window.__astroKitSrcset`. An init script is not subject
 * to the page CSP (13.1 item 30), while a function made from a text in the page would be (`'unsafe-eval'`).
 */
const srcsetScript = (): string =>
  `Object.defineProperty(window, '__astroKitSrcset', { value: (${srcsetCandidates.toString()}) });`;

/**
 * `perf-image-oversize`: on the phone and the desktop of `perf-lcp-priority` (no throttling). The rule first reads
 * the images that loaded on their own: one that loaded a raster file but has no box at that device shows nowhere,
 * and fails. Then the lazy images load (`loadLazyImages`, 10 s at most), and no judged image (`judged`) loads more
 * than 1.5 × its rendered width × the device scale. The smallest `w` candidate of a `srcset` is exempt. The `w`
 * descriptor gives the loaded width, not `naturalWidth`, which Chromium scales to the `sizes` width (13.1 item 32).
 */
export const imageOversize: BrowserRule = {
  id: 'perf-image-oversize',
  pages: 'tested',
  concurrent: true,
  check: async (check) => {
    for (const device of PERF_DEVICES) {
      const context = await check.context({ viewport: viewportOf(device), deviceScaleFactor: device.scale });
      await context.addInitScript({ content: srcsetScript() });
      const page = await check.open({ context, viewport: viewportOf(device) });
      const early = await readImages(page);
      const before = await resources(page);
      const unshown = new Set<string>();
      for (const [index, image] of early.entries()) {
        if (!image.raster || image.box) continue;
        // The file shows when another image with a box shows it. Two hidden copies do not exempt each other, and a
        // file that shows nowhere is reported once, for its first image.
        const shows = early.some((other, at) => at !== index && other.raster && other.box && other.href === image.href);
        const bytes = before.get(image.href);
        if (shows || bytes === undefined || unshown.has(image.href)) continue;
        unshown.add(image.href);
        check.report(`${deviceText(device)}: ${image.name} loads ${image.url} (${bytes} B) and shows nowhere`);
      }
      await loadLazyImages(page, CLS_IMAGES_MS);
      await imagesLoaded(page, CLS_IMAGES_MS);
      const late = await readImages(page);
      const after = await resources(page);
      for (const image of judged(early, late, after)) {
        if (!image.shown) continue;
        const needed = image.rendered * device.scale;
        if (image.smallest || image.loaded <= OVERSIZE_FACTOR * needed + 1e-6) continue;
        check.report(
          `${deviceText(device)}: ${image.name} loads ${image.url} at ${image.loaded} px for a box of ` +
            `${cut(image.rendered, 1)} px × ${device.scale} (${cut(image.loaded / needed, 2)}×, at most ${OVERSIZE_FACTOR}×)`,
        );
      }
    }
  },
};

// perf-bfcache

/** How long `perf-bfcache` waits for the `pageshow` of the restore. */
export const BFCACHE_WAIT_MS = 5_000;

/** The query of the second page of `perf-bfcache`. */
export const BFCACHE_QUERY = 'kit-bfcache';

/** An init script: it keeps the `persisted` value of each `pageshow` of this window in `window.__astroKitShows`. */
function watchShows(): void {
  const shows: boolean[] = [];
  Object.defineProperty(window, '__astroKitShows', { value: shows });
  window.addEventListener('pageshow', (event) => shows.push(event.persisted));
}

/** How long `perf-bfcache` waits for an idle period of the second page, at most. */
export const BFCACHE_IDLE_MS = 2_000;

/**
 * The reasons of a page that loaded again, as the detail gives them: sorted, without `masked` (Chromium names it in
 * most runs but not in all, and it names no cause), and without `navigation-canceled` when another reason is there.
 */
export function bfcacheReasons(reasons: readonly string[]): string[] {
  const known = [...new Set(reasons)].filter((reason) => reason !== 'masked').sort();
  return known.some((reason) => reason !== 'navigation-canceled')
    ? known.filter((reason) => reason !== 'navigation-canceled')
    : known;
}

/**
 * `perf-bfcache` at 1280×800: the page, then the page with `?kit-bfcache`, then back. The second page settles first
 * (`load`, the fonts, the animations and one idle period), so its scripts ran, as for a visitor who reads it. The
 * `pageshow` of the page must have `persisted` true within 5 s. A page that loads again instead gives the reasons that
 * Chromium names in `notRestoredReasons` (`bfcacheReasons`).
 */
export const bfcache: BrowserRule = {
  id: 'perf-bfcache',
  pages: 'tested',
  concurrent: true,
  check: async (check) => {
    const context = await check.context({ viewport: DESKTOP });
    await context.addInitScript(watchShows);
    const page = await check.open({ context, viewport: DESKTOP });
    // A mark of this window: a page that loads again is a new window without it.
    await page.evaluate(() => Object.defineProperty(window, '__astroKitBefore', { value: true }));
    await page.goto(`${check.run.origin}${check.page.path}?${BFCACHE_QUERY}`, { waitUntil: 'load' });
    await settle(page);
    await page.evaluate(
      (limit) =>
        new Promise<void>((done) => {
          if (typeof requestIdleCallback === 'function') requestIdleCallback(() => done(), { timeout: limit });
          else setTimeout(done, 0);
        }),
      BFCACHE_IDLE_MS,
    );
    // A restore fires no `load` event (13.1 item 53), so the wait is for the commit and then for the `pageshow`.
    await page.goBack({ waitUntil: 'commit' });
    let shown: { restored: boolean; reasons: string[] } | undefined;
    try {
      await page.waitForFunction(
        () => {
          const shows = (window as unknown as { __astroKitShows?: boolean[] }).__astroKitShows ?? [];
          const before = (window as unknown as { __astroKitBefore?: boolean }).__astroKitBefore === true;
          return shows.includes(true) || (!before && shows.length > 0);
        },
        undefined,
        { timeout: BFCACHE_WAIT_MS, polling: 50 },
      );
      shown = await page.evaluate(() => {
        const shows = (window as unknown as { __astroKitShows?: boolean[] }).__astroKitShows ?? [];
        interface Reasons {
          reasons?: { reason?: string }[] | null;
          children?: Reasons[] | null;
        }
        const reasons: string[] = [];
        const collect = (node: Reasons | null | undefined): void => {
          for (const item of node?.reasons ?? []) if (item.reason) reasons.push(item.reason);
          for (const child of node?.children ?? []) collect(child);
        };
        const entry = performance.getEntriesByType('navigation')[0] as
          | (PerformanceEntry & { notRestoredReasons?: Reasons | null })
          | undefined;
        collect(entry?.notRestoredReasons);
        return { restored: shows.includes(true), reasons };
      });
    } catch {
      shown = undefined;
    }
    if (shown?.restored === true) return;
    const reasons = bfcacheReasons(shown?.reasons ?? []);
    const why = reasons.length > 0 ? ` (Chromium: ${reasons.join(', ')})` : '';
    check.report(
      shown === undefined
        ? `1280×800: after ?${BFCACHE_QUERY} and back, no pageshow came within ${BFCACHE_WAIT_MS / 1000} s`
        : `1280×800: after ?${BFCACHE_QUERY} and back, the page loaded again instead of a restore from the back/forward cache${why}`,
    );
  },
};

// perf-prerender and perf-prefetch

/**
 * How long the hover rules wait for the request after the hover. The pointer stays on the link the whole time, so it
 * rests there for the 300 ms of the rule and longer.
 */
export const SPECULATION_WAIT_MS = 2_000;

/** The link that the hover rules hover: its name and the request target (path and query) of its URL. */
interface Hovered {
  name: string;
  target: string;
}

/**
 * The links that the kit's document rule of 6.2 leaves out, and those that the prefetch gate leaves out. A `target`
 * of `_self`, in any letter case, and an empty `target` open the link in the same tab, as no `target` does.
 */
const RULE_EXCLUDED = "[download], [hreflang], [target]:not([target='_self' i]):not([target='']), [rel~=nofollow]";
const GATE_EXCLUDED = "[download], [target]:not([target='_self' i]):not([target=''])";

/**
 * The first link in `header`, `main` or `footer`, in document order, that is visible, leads to another page of the
 * site and is eligible. A link to another page has the same origin, a path outside `/api/` and a URL other than the
 * page's own (both without the fragment). With `speculation`, eligible means what the kit's document rule of 6.2
 * matches: none of `[download]`, `[hreflang]`, `[rel~=nofollow]` and a `[target]` other than `_self`. Else it means
 * what the prefetch gate of 6.2 picks: no `download`, and no `target` other than `_self`. The page keeps the element
 * as `window.__astroKitHovered`. `others` counts the visible links to other pages.
 */
async function firstEligible(page: Page, speculation: boolean): Promise<{ link?: Hovered; others: number }> {
  const found = await page.evaluate(
    (excluded) => {
      const here = location.href.split('#')[0];
      let others = 0;
      for (const link of Array.from(document.querySelectorAll('header a[href], main a[href], footer a[href]'))) {
        if (!(link instanceof HTMLAnchorElement) || link.origin !== location.origin) continue;
        if (link.pathname.startsWith('/api/') || link.href.split('#')[0] === here) continue;
        if (!window.__astroKit.visible(link)) continue;
        others += 1;
        if (link.matches(excluded)) continue;
        Object.defineProperty(window, '__astroKitHovered', { value: link, configurable: true });
        return { link: { name: window.__astroKit.describe(link), target: `${link.pathname}${link.search}` }, others };
      }
      return { others };
    },
    speculation ? RULE_EXCLUDED : GATE_EXCLUDED,
  );
  return found.link === undefined ? { others: found.others } : { link: found.link, others: found.others };
}

/** The element that `firstEligible` chose. */
async function hoveredLink(page: Page): Promise<ElementHandle<Element> | null> {
  const handle = await page.evaluateHandle(
    () => (window as unknown as { __astroKitHovered?: Element }).__astroKitHovered ?? null,
  );
  return handle.asElement();
}

/** The first request for `target` that the server got after the request with the index `from`, if `accept` takes it. */
const requestFor = (
  received: readonly Received[],
  from: number,
  target: string,
  accept: (request: Received) => boolean,
): Received | undefined => received.slice(from).find((request) => request.path === target && accept(request));

/** The `Sec-Purpose` of a request, as one text. */
const purposeOf = (request: Received): string => [request.headers['sec-purpose'] ?? ''].flat().join(',');

/**
 * Hovers the chosen link and keeps the pointer on it. Gives the index of the first request after the hover. The
 * pointer moves to the center of the link without Playwright's wait for an actionable element: on a page where
 * another element covers the link, that element gets the pointer, as it does for a visitor, and the rule reports.
 */
async function hover(check: Check, page: Page): Promise<number | undefined> {
  const link = await hoveredLink(page);
  if (link === null) return undefined;
  await link.scrollIntoViewIfNeeded();
  const from = check.run.received.length;
  await link.hover({ force: true });
  return from;
}

/** The detail of `perf-prerender` for a page whose links to other pages are all left out by the document rule. */
export const NO_PRERENDER =
  '1280×800: no link of the page can be prerendered: each visible link to another page in header, main or footer ' +
  'has download, hreflang, rel=nofollow or a target other than _self';

/**
 * `perf-prerender` at 1280×800, with `prefetch.speculationRules`: the pointer rests on the first eligible link in
 * `header`, `main` or `footer`, and within 2 s the test server must get a request for its URL with
 * `Sec-Purpose: prefetch;prerender`. The wait ends at that request. Under Playwright, Chromium then cancels the
 * prerender (13.1 item 28), so the rule looks at the request only. A page with visible links to other pages, none of
 * them eligible, fails (`NO_PRERENDER`); a page with no such link passes.
 */
export const prerender: BrowserRule = {
  id: 'perf-prerender',
  pages: 'tested',
  check: async (check) => {
    if (!check.run.options.prefetch.speculationRules) return;
    const page = await check.open({ viewport: DESKTOP });
    const { link, others } = await firstEligible(page, true);
    if (link === undefined) {
      if (others > 0) check.report(NO_PRERENDER);
      return;
    }
    const from = await hover(check, page);
    if (from === undefined) return;
    const seen = await until(
      () => requestFor(check.run.received, from, link.target, (request) => purposeOf(request).includes('prerender')),
      SPECULATION_WAIT_MS,
    );
    if (seen === undefined) {
      check.report(
        `1280×800: a hover on ${link.name} (${link.target}) gave no request with Sec-Purpose: prefetch;prerender ` +
          `within ${SPECULATION_WAIT_MS / 1000} s`,
      );
    }
  },
};

/** The request target of a URL: its path and query. */
const targetOf = (href: string): string => {
  const url = new URL(href);
  return `${url.pathname}${url.search}`;
};

/**
 * `perf-prefetch` at 1280×800, with `prefetch.astroPrefetch` on and `prefetch.speculationRules` off: the pointer
 * rests on the first link that the prefetch gate picks in `header`, `main` or `footer`; the test server must get a
 * request for its URL within 2 s; when the page holds the response (its resource timing entry, compared without the
 * fragment), a click on the link must give a navigation with `transferSize` 0, so the browser took the page from the
 * prefetch. The click waits for the load of the navigation that it starts, whatever its final URL: a link that
 * redirects is judged by the request of the page where the redirect ends, as a visitor gets it.
 */
export const prefetch: BrowserRule = {
  id: 'perf-prefetch',
  pages: 'tested',
  check: async (check) => {
    const settings = check.run.options.prefetch;
    if (!settings.astroPrefetch || settings.speculationRules) return;
    const page = await check.open({ viewport: DESKTOP });
    const { link } = await firstEligible(page, false);
    if (link === undefined) return;
    const from = await hover(check, page);
    if (from === undefined) return;
    const seen = await until(() => requestFor(check.run.received, from, link.target, () => true), SPECULATION_WAIT_MS);
    if (seen === undefined) {
      check.report(
        `1280×800: a hover on ${link.name} (${link.target}) gave no prefetch request within ${SPECULATION_WAIT_MS / 1000} s`,
      );
      return;
    }
    const url = `${check.run.origin}${link.target}`;
    const held = await page
      .waitForFunction(
        (href) =>
          performance
            .getEntriesByType('resource')
            .some((entry) => entry.name.split('#')[0] === href && (entry as PerformanceResourceTiming).responseEnd > 0),
        url,
        { timeout: SPECULATION_WAIT_MS, polling: 20 },
      )
      .then(
        () => true,
        () => false,
      );
    if (!held) {
      check.report(`1280×800: the prefetch of ${link.target} did not finish within ${SPECULATION_WAIT_MS / 1000} s`);
      return;
    }
    const element = await hoveredLink(page);
    if (element === null) return;
    const clicked = check.run.received.length;
    await Promise.all([page.waitForEvent('load', { timeout: NAVIGATION_LIMIT_MS }), element.click()]);
    const landed = targetOf(page.url());
    const transfer = await page.evaluate(
      () => (performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined)?.transferSize,
    );
    // The navigation took the page from the prefetch when the server got no request for it (`transferSize` 0), or
    // only a conditional one: Chromium 153 revalidates a prefetched page whose answer has `max-age=0`, the
    // `Cache-Control` of Workers static assets, and the 304 carries no body.
    const again = check.run.received
      .slice(clicked)
      .filter((request) => request.path === landed && request.headers['if-none-match'] === undefined);
    if (transfer !== 0 && again.length > 0) {
      check.report(
        `1280×800: the click on ${link.name} loaded ${landed} again (transferSize ${transfer ?? 'unknown'}), ` +
          'not from the prefetch',
      );
    }
  },
};

/** The rules of this file. `src/browser/rules.ts` puts every rule in the order of section 8. */
export const PERF_RULES: readonly BrowserRule[] = [lcpPriority, cls, imageOversize, bfcache, prerender, prefetch];

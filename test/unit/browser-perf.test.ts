import assert from 'node:assert/strict';
import { test } from 'node:test';
import { crc32, deflateSync } from 'node:zlib';
import type { BrowserRule } from '../../src/browser/harness.ts';
import type { LoadedImage } from '../../src/browser/perf.ts';
import {
  BFCACHE_IDLE_MS,
  BFCACHE_QUERY,
  BFCACHE_WAIT_MS,
  bfcache,
  bfcacheReasons,
  CLS_ANIMATION_MS,
  CLS_CAP_MS,
  CLS_FRAME_MS,
  CLS_GAP_MS,
  CLS_IMAGES_MS,
  CLS_MAX,
  CLS_PAUSE_MS,
  CLS_QUIET_CAP_MS,
  CLS_QUIET_MS,
  CLS_STEP_MS,
  CLS_VIEWPORTS,
  CLS_WATCH_MS,
  cls,
  cut,
  deviceText,
  imageOversize,
  judged,
  LCP_CPU_RATE,
  LCP_ENTRY_WAIT_MS,
  LCP_IMAGE_WAIT_MS,
  LCP_NETWORK,
  largestWindow,
  lcpPriority,
  NO_PRERENDER,
  OVERSIZE_FACTOR,
  onClock,
  PERF_DEVICES,
  PERF_RULES,
  prefetch,
  prerender,
  SPECULATION_WAIT_MS,
  srcsetCandidates,
} from '../../src/browser/perf.ts';
import { SPECULATION_JSON } from '../../src/csp.ts';
import type { Options } from '../../src/options.ts';
import { RULE_BY_ID } from '../../src/registry.ts';
import { BODY, CSS, findingsOf, html, SETTINGS, useBrowser } from './browser-fixtures.ts';
import type { Files } from './fixtures.ts';
import { SPEC } from './spec.ts';

const browser = useBrowser();

/**
 * A PNG of `width` × `height` pixels: the photo of a test page. Without `noise`, one color. With it, each byte is a
 * value of a fixed pseudo-random sequence, stored without compression, so the file has about 3 B for each pixel.
 */
function png(width: number, height: number, noise = false): Uint8Array {
  const chunk = (type: string, data: Buffer): Buffer => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, sum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const raw = Buffer.concat(
    Array.from({ length: height }, () => Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3, 0x7f)])),
  );
  let seed = 12_345;
  for (let at = 0; noise && at < raw.length; at += 1) {
    if (at % (width * 3 + 1) === 0) continue;
    seed = (seed * 1_103_515_245 + 12_345) >>> 0;
    raw[at] = seed >>> 24;
  }
  const pixels = deflateSync(raw, { level: noise ? 0 : 6 });
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', pixels),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** The details of the findings of one run, in order, each with its page in front. */
async function detailsOf(files: Files, rule: BrowserRule, settings: Options = SETTINGS): Promise<string[]> {
  const findings = await findingsOf(browser(), files, [rule], { settings });
  return findings.map((finding) => `${finding.where} ${finding.detail ?? ''}`);
}

/** A page with the passing CSS of the browser tests, `main` as given, and a header with links. */
const page = (main: string, parts: { css?: string; head?: string; header?: string } = {}): string =>
  html(`<header>${parts.header ?? ''}</header><main id="main"><h1>Willkommen</h1>${main}</main>`, {
    css: CSS + (parts.css ?? ''),
    ...(parts.head === undefined ? {} : { head: parts.head }),
  });

const standardOf = (id: string): string => RULE_BY_ID.get(id)?.standard ?? '';

test('the rules of src/browser/perf.ts, in their order, on the tested pages (every page with --all)', () => {
  assert.deepEqual(
    PERF_RULES.map((rule) => rule.id),
    ['perf-lcp-priority', 'perf-cls', 'perf-image-oversize', 'perf-bfcache', 'perf-prerender', 'perf-prefetch'],
  );
  for (const rule of PERF_RULES) assert.equal(rule.pages, 'tested', rule.id);
  assert.ok(SPEC.includes('The perf pass uses the sample, and every page with `--all`.'));
});

test('the values of the perf rules are the values of section 8', () => {
  assert.deepEqual(PERF_DEVICES.map(deviceText), ['390×844@3', '1440×900@1']);
  assert.deepEqual(LCP_NETWORK, { latency: 150, downloadThroughput: 200_000, uploadThroughput: 75_000 });
  assert.equal(LCP_CPU_RATE, 4);
  assert.ok(
    SPEC.includes(
      '| `perf-lcp-priority` | browser | At 390×844@3 and 1440×900@1, with 150 ms latency, 200,000 B/s down, 75,000 B/s up, CPU 4× and the cache off',
    ),
  );
  assert.equal(LCP_ENTRY_WAIT_MS, 5000);
  assert.equal(LCP_IMAGE_WAIT_MS, 30_000);
  assert.deepEqual(
    [CLS_MAX, CLS_GAP_MS, CLS_CAP_MS, CLS_PAUSE_MS, CLS_STEP_MS, CLS_IMAGES_MS],
    [0.05, 1000, 5000, 500, 150, 10_000],
  );
  assert.deepEqual([CLS_QUIET_MS, CLS_QUIET_CAP_MS, CLS_FRAME_MS, CLS_ANIMATION_MS], [2000, 10_000, 16.7, 10_000]);
  assert.equal(CLS_WATCH_MS, 5000);
  assert.deepEqual(
    CLS_VIEWPORTS.map((viewport) => `${viewport.width}×${viewport.height}`),
    ['390×844', '1280×800'],
  );
  assert.equal(BFCACHE_IDLE_MS, 2000);
  assert.ok(SPEC.includes('| `perf-cls` | browser | CLS ≤ 0.05: the largest session window (gap < 1 s, cap 5 s).'));
  assert.equal(OVERSIZE_FACTOR, 1.5);
  assert.ok(SPEC.includes('No image loads more than 1.5 × its rendered width × DPR'));
  assert.equal(BFCACHE_QUERY, 'kit-bfcache');
  assert.equal(BFCACHE_WAIT_MS, 5000);
  assert.ok(SPEC.includes('A, then `A?kit-bfcache`, then back: `pageshow.persisted` is true within 5 s.'));
  assert.equal(SPECULATION_WAIT_MS, 2000);
  assert.ok(SPEC.includes('The rule fails when the test server gets no such request within 2 s of the hover.'));
  for (const rule of PERF_RULES) assert.ok(standardOf(rule.id).length > 0, rule.id);
});

test('cut: a value is cut, not rounded, so a failing value never reads as the limit', () => {
  assert.equal(cut(0.0509, 3), '0.050');
  assert.equal(cut(1.789, 2), '1.78');
  assert.equal(cut(2, 1), '2.0');
});

test('largestWindow: session windows end at a gap of 1 s or after 5 s', () => {
  const shift = (time: number, value: number): { time: number; value: number; source: string } => ({
    time,
    value,
    source: `s${time}`,
  });
  assert.deepEqual(largestWindow([]), { value: 0, largest: undefined });
  // A gap of 1 s starts a new window.
  assert.equal(largestWindow([shift(0, 0.03), shift(999, 0.03)]).value, 0.06);
  assert.equal(largestWindow([shift(0, 0.03), shift(1000, 0.03)]).value, 0.03);
  // A window lasts at most 5 s from its first shift.
  const long = [0, 900, 1800, 2700, 3600, 4500, 5400].map((time) => shift(time, 0.01));
  assert.equal(cut(largestWindow(long).value, 3), '0.060');
  const result = largestWindow([shift(0, 0.01), shift(100, 0.04), shift(3000, 0.02)]);
  assert.equal(result.value, 0.05);
  assert.equal(result.largest?.source, 's100');
});

test('srcsetCandidates reads a srcset as HTML parses it', () => {
  assert.deepEqual(srcsetCandidates('/a.webp 640w, /b.webp 1280w'), [
    { url: '/a.webp', width: 640 },
    { url: '/b.webp', width: 1280 },
  ]);
  // A comma inside a URL stays in it: the URL ends at white space.
  assert.deepEqual(srcsetCandidates('/a.png,/b.png 2x'), [{ url: '/a.png,/b.png', density: 2 }]);
  assert.deepEqual(srcsetCandidates(' /a.png, /b.png 2x , /c.png 1.5x'), [
    { url: '/a.png', density: 1 },
    { url: '/b.png', density: 2 },
    { url: '/c.png', density: 1.5 },
  ]);
  // A candidate with two descriptors of a kind or an unknown one is left out, and hostile text gives no error.
  assert.deepEqual(srcsetCandidates('/a.png 1x 2x, /b.png 10h, /c.png 300w'), [{ url: '/c.png', width: 300 }]);
  // HTML keeps a width with a future height (`h`), and drops a width with a density, a width or a height of 0, a
  // negative density, and a descriptor in upper case.
  assert.deepEqual(
    srcsetCandidates(
      '/a.png 100w 5h, /b.png 0w, /c.png 10w 2x, /d.png 1600w 100h, /e.png 10w 0h, /f.png -1x, /g.png 2X',
    ),
    [
      { url: '/a.png', width: 100 },
      { url: '/d.png', width: 1600 },
    ],
  );
  assert.deepEqual(srcsetCandidates(',,, ,'), []);
  assert.deepEqual(srcsetCandidates('/x.png (1 2,3)'), []);
});

// perf-lcp-priority

/** A first screen whose largest element is a photo of 800×600 with the given attributes. */
const hero = (attributes: string): Files => ({
  'index.html': page(`<img src="/hero.png" width="800" height="600" alt="Der Garten" ${attributes}>`, {
    css: 'img{display:block;inline-size:100%;block-size:auto}',
  }),
  'hero.png': png(800, 600),
});

test('perf-lcp-priority passes an LCP image with fetchpriority high and no lazy loading', async () => {
  assert.deepEqual(await detailsOf(hero('fetchpriority="high"'), lcpPriority), []);
  // Text as the LCP element gives nothing to check.
  assert.deepEqual(await detailsOf({ 'index.html': html(BODY, { css: CSS }) }, lcpPriority), []);
  // The browser does not trim the value of an enumerated attribute: `loading=" lazy "` loads eagerly.
  assert.deepEqual(await detailsOf(hero('fetchpriority="high" loading=" lazy "'), lcpPriority), []);
});

test('perf-lcp-priority fails an LCP image without fetchpriority high, or a lazy one', async () => {
  assert.deepEqual(await detailsOf(hero('loading="lazy"'), lcpPriority), [
    '/ 390×844@3: the LCP element img (/hero.png) has no fetchpriority="high" and has loading="lazy"',
    '/ 1440×900@1: the LCP element img (/hero.png) has no fetchpriority="high" and has loading="lazy"',
  ]);
  assert.deepEqual(await detailsOf(hero('fetchpriority="high" loading="lazy"'), lcpPriority), [
    '/ 390×844@3: the LCP element img (/hero.png) has loading="lazy"',
    '/ 1440×900@1: the LCP element img (/hero.png) has loading="lazy"',
  ]);
  // `fetchpriority=" high "` is `auto` for the browser.
  assert.deepEqual(await detailsOf(hero('fetchpriority=" high "'), lcpPriority), [
    '/ 390×844@3: the LCP element img (/hero.png) has no fetchpriority="high"',
    '/ 1440×900@1: the LCP element img (/hero.png) has no fetchpriority="high"',
  ]);
});

test('perf-lcp-priority waits for a heavy lazy LCP image longer than 5 s', async () => {
  // About 1.2 MB of noise: more than 5 s at 200,000 B/s. The rule waits for its load, up to the page load limit.
  const files: Files = {
    'index.html': page('<img src="/big.png" width="1000" height="400" alt="Der Garten" loading="lazy">', {
      css: 'img{display:block;inline-size:100%;block-size:auto}',
    }),
    'big.png': png(1000, 400, true),
  };
  assert.deepEqual(await detailsOf(files, lcpPriority), [
    '/ 390×844@3: the LCP element img (/big.png) has no fetchpriority="high" and has loading="lazy"',
    '/ 1440×900@1: the LCP element img (/big.png) has no fetchpriority="high" and has loading="lazy"',
  ]);
});

// perf-cls

/** A tall page. With `late`, a script puts a block of 300 px at the top of `main` `late` ms after `load`. */
const shifting = (late?: number): Files => ({
  'index.html': page(
    `${'<p>Ein Absatz mit Text, der die Seite lang macht.</p>'.repeat(60)}${
      late === undefined
        ? ''
        : `<script>addEventListener('load', () => setTimeout(() => { const block = document.createElement('div'); block.className = 'late'; block.style.blockSize = '300px'; document.querySelector('main').prepend(block); }, ${late}));</script>`
    }`,
  ),
});

/** The detail of `perf-cls` without its value, which a page timer may change. */
const withoutValue = (detail: string): string => detail.replace(/CLS \d\.\d{3}/, 'CLS <value>');

test('onClock: a shift takes the time of its frame on the clock of the animations', () => {
  const times: [number, number][] = [
    [100, 100],
    [170, 116.7],
    [240, 133.4],
  ];
  // Before the first frame, the clocks agree.
  assert.equal(onClock(50, times), 50);
  // A shift takes the clock time of the first frame at or after it.
  assert.equal(onClock(165, times), 116.7);
  assert.equal(onClock(240, times), 133.4);
  // After the last frame, the time since that frame counts.
  assert.equal(onClock(300, times), 193.4);
  assert.equal(onClock(10, []), 10);
});

test('perf-cls passes a page whose content stays in place', async () => {
  assert.deepEqual(await detailsOf(shifting(), cls), []);
});

test('perf-cls fails a page that moves its content after load, at 390×844 and at 1280×800', async () => {
  const details = await detailsOf(shifting(300), cls);
  assert.equal(details.length, 2, details.join('\n'));
  assert.match(
    details[0] ?? '',
    /^\/ 390×844: CLS \d\.\d{3} in the largest session window, at most 0\.05; its largest shift moves (body|h1|p|main)/,
  );
  assert.match(details[1] ?? '', /^\/ 1280×800: CLS \d\.\d{3} in the largest session window/);
});

test('perf-cls watches until 2 s pass with no shift: a block 2 s after load fails', async () => {
  // A short page: before, the measurement ended about 1 s after load.
  const files: Files = {
    'index.html': page(
      "<p>Ein Absatz.</p><script>addEventListener('load', () => setTimeout(() => { const block = document.createElement('div'); block.style.blockSize = '300px'; document.querySelector('main').prepend(block); }, 2000));</script>",
    ),
  };
  const details = await detailsOf(files, cls);
  assert.deepEqual(details.map(withoutValue), [
    '/ 390×844: CLS <value> in the largest session window, at most 0.05; its largest shift moves body',
    '/ 1280×800: CLS <value> in the largest session window, at most 0.05; its largest shift moves body',
  ]);
});

test('perf-cls watches at least 5 s after load: a block 4 s after load on a short page fails', async () => {
  // A short page: the 2 s quiet period alone ended about 2 s after load, so a late banner was never seen.
  const files: Files = {
    'index.html': page(
      "<p>Ein Absatz.</p><script>addEventListener('load', () => setTimeout(() => { const block = document.createElement('div'); block.style.blockSize = '300px'; document.querySelector('main').prepend(block); }, 4000));</script>",
    ),
  };
  const details = await detailsOf(files, cls);
  assert.deepEqual(details.map(withoutValue), [
    '/ 390×844: CLS <value> in the largest session window, at most 0.05; its largest shift moves body',
    '/ 1280×800: CLS <value> in the largest session window, at most 0.05; its largest shift moves body',
  ]);
});

test('perf-cls measures 1280×800 too: a shift that only a desktop sees fails', async () => {
  const files: Files = {
    'index.html': page(
      `<p class="wide">${'Hinweis. '.repeat(20)}</p>${'<p>Ein Absatz mit Text.</p>'.repeat(30)}<script>addEventListener('load', () => setTimeout(() => document.querySelector('.wide').classList.add('open'), 300));</script>`,
      { css: '.wide{display:none}@media (width >= 48rem){.wide.open{display:block;block-size:200px}}' },
    ),
  };
  const details = await detailsOf(files, cls);
  assert.deepEqual(details.map(withoutValue), [
    '/ 1280×800: CLS <value> in the largest session window, at most 0.05; its largest shift moves p',
  ]);
});

/**
 * A notice that unfolds 300 ms after its start, above the text of the page. With `busy`, a page script keeps every
 * animation frame busy for 70 ms, as a slow machine paints: the frames come about 4 times less often.
 */
const unfolding = (busy: boolean): Files => ({
  'index.html': page(
    `<p class="notice">${'Hinweis. '.repeat(30)}</p>${'<p>Ein Absatz mit Text, der die Seite lang macht.</p>'.repeat(40)}${
      busy
        ? '<script>requestAnimationFrame(function busy() { const start = performance.now(); while (performance.now() - start < 70); requestAnimationFrame(busy); });</script>'
        : ''
    }`,
    {
      css: '@keyframes unfold{from{max-block-size:0}to{max-block-size:4lh}}.notice{overflow:hidden;animation:unfold 600ms 300ms ease-out backwards}',
    },
  ),
});

test('perf-cls moves the animations in fixed frames: a slow machine gets the same result', async () => {
  // Real time moves the unfold in larger steps on a slow machine, and each step scores more: 0.077 and 0.122 before.
  // The clock of the rule moves it 16.7 ms in each frame, so both pages give the same shifts.
  const fast = await detailsOf(unfolding(false), cls);
  assert.deepEqual(fast, [
    '/ 390×844: CLS 0.077 in the largest session window, at most 0.05; its largest shift moves p',
  ]);
  assert.deepEqual(await detailsOf(unfolding(true), cls), fast);
});

// perf-image-oversize

test('perf-image-oversize passes images that load what they show, and the smallest srcset candidate', async () => {
  const files: Files = {
    'index.html': page(
      [
        '<img src="/w100.png" width="100" height="50" alt="Klein">',
        // The only candidate is the smallest one: it is exempt, although it is much wider than its box.
        '<img src="/w1600.png" srcset="/w1600.png 1600w" sizes="100px" width="100" height="10" alt="Breit">',
        // An SVG file is no raster image.
      ].join(''),
    ),
    'w100.png': png(100, 50),
    'w1600.png': png(1600, 100),
  };
  assert.deepEqual(await detailsOf(files, imageOversize), []);
});

test('perf-image-oversize fails an image that loads far more pixels than its box', async () => {
  const files: Files = {
    'index.html': page(
      [
        '<img src="/w1600.png" width="100" height="10" alt="Zu breit">',
        // The `w` descriptor counts, not the natural width: 1600w for a box of 200 px.
        '<img src="/b100.png" srcset="/b100.png 100w, /b1600.png 1600w" sizes="200px" width="200" height="10" alt="Gross" loading="lazy">',
        // A `w` descriptor with a future `h` descriptor is a candidate too.
        '<img src="/c100.png" srcset="/c100.png 100w 5h, /c1600.png 1600w 100h" sizes="200px" width="200" height="10" alt="Hoch">',
        // A density candidate is never exempt, also when it is the only one.
        '<img srcset="/d1600.png 1x" width="100" height="6" alt="Dicht">',
      ].join(''),
    ),
    'w1600.png': png(1600, 100),
    'b100.png': png(100, 50),
    'b1600.png': png(1600, 100),
    'c100.png': png(100, 50),
    'c1600.png': png(1600, 100),
    'd1600.png': png(1600, 100),
  };
  assert.deepEqual(await detailsOf(files, imageOversize), [
    '/ 390×844@3: img loads /w1600.png at 1600 px for a box of 100.0 px × 3 (5.33×, at most 1.5×)',
    '/ 390×844@3: img loads /b1600.png at 1600 px for a box of 200.0 px × 3 (2.66×, at most 1.5×)',
    '/ 390×844@3: img loads /c1600.png at 1600 px for a box of 200.0 px × 3 (2.66×, at most 1.5×)',
    '/ 390×844@3: img loads /d1600.png at 1600 px for a box of 100.0 px × 3 (5.33×, at most 1.5×)',
    '/ 1440×900@1: img loads /w1600.png at 1600 px for a box of 100.0 px × 1 (16.00×, at most 1.5×)',
    '/ 1440×900@1: img loads /b1600.png at 1600 px for a box of 200.0 px × 1 (8.00×, at most 1.5×)',
    '/ 1440×900@1: img loads /c1600.png at 1600 px for a box of 200.0 px × 1 (8.00×, at most 1.5×)',
    '/ 1440×900@1: img loads /d1600.png at 1600 px for a box of 100.0 px × 1 (16.00×, at most 1.5×)',
  ]);
});

test('perf-image-oversize judges what an image adds to the transfer', async () => {
  const files: Files = {
    'index.html': page(
      [
        '<img src="/w1600.png" width="1100" height="70" alt="Gross" fetchpriority="high">',
        // A small lazy copy of the same file: the browser takes it from the memory cache, with no new request.
        `${'<p>Ein Absatz mit Text.</p>'.repeat(40)}<img src="/w100.png" srcset="/w100.png 100w, /w1600.png 1600w" sizes="100vw" width="100" height="10" alt="Klein" loading="lazy" style="inline-size:100px">`,
        // `sizes="auto"` needs a lazy image: the rule scrolls it into view instead of making it eager.
        '<img src="/a400.png" srcset="/a400.png 400w, /a960.png 960w, /a1600.png 1600w" sizes="auto" width="300" height="10" alt="Auto" loading="lazy" style="inline-size:300px">',
      ].join(''),
      { css: 'img{display:block;max-inline-size:100%}' },
    ),
    'w100.png': png(100, 50),
    'w1600.png': png(1600, 100),
    'a400.png': png(400, 10),
    'a960.png': png(960, 24),
    'a1600.png': png(1600, 40),
  };
  assert.deepEqual(await detailsOf(files, imageOversize), []);
});

/** An image of `judged`: complete (`raster`) or still loading, with a box, 1600 px for a box of 100 px. */
const loadedImage = (id: number, path: string, raster: boolean): LoadedImage => ({
  id,
  name: `img#${id}`,
  href: `http://127.0.0.1${path}`,
  url: path,
  raster,
  box: true,
  shown: true,
  loaded: 1600,
  rendered: 100,
  smallest: false,
});

test('perf-image-oversize judges a lazy image that finished its own load between the reads of the rule', () => {
  // The image was not complete when the rule read the images, and its resource timing entry was there a moment
  // later: about 1 run in 50 under load, before the fix, lost the finding. The image is judged all the same.
  const late = [loadedImage(1, '/b1600.png', true)];
  const entry = new Map([['http://127.0.0.1/b1600.png', 1_000]]);
  assert.deepEqual(judged([loadedImage(1, '/b1600.png', false)], late, entry), late);
  // A lazy copy of a file that another image loaded on its own is not judged; the first image is.
  const copy = [loadedImage(1, '/b1600.png', true), loadedImage(2, '/b1600.png', true)];
  assert.deepEqual(judged([loadedImage(1, '/b1600.png', true), loadedImage(2, '/b1600.png', false)], copy, entry), [
    copy[0],
  ]);
  // A file with no resource timing entry was never requested by the page: not judged.
  assert.deepEqual(judged([], late, new Map()), []);
});

test('perf-image-oversize judges a lazy image whose file a preload fetched, in every run', async () => {
  // Chromium loads a lazy image at once when its file is in the memory cache, so the image loads on its own when
  // the preload ends first, and after the switch when it does not. Before the fix, only the first case was judged.
  const files: Files = {
    'index.html': page(
      [
        '<link rel="preload" as="image" href="/w1600.png">',
        '<div style="block-size:6000px"></div><img src="/w1600.png" width="100" height="6" alt="Klein" loading="lazy">',
      ].join(''),
    ),
    'w1600.png': png(1600, 100),
  };
  assert.deepEqual(await detailsOf(files, imageOversize), [
    '/ 390×844@3: img loads /w1600.png at 1600 px for a box of 100.0 px × 3 (5.33×, at most 1.5×)',
    '/ 1440×900@1: img loads /w1600.png at 1600 px for a box of 100.0 px × 1 (16.00×, at most 1.5×)',
  ]);
});

test('perf-image-oversize fails an image that loads and shows nowhere', async () => {
  const files: Files = {
    'index.html': page(
      '<img class="wide" src="/w1600.png" width="1600" height="100" alt="Breit"><img class="lazy" src="/w100.png" width="100" height="50" alt="Klein" loading="lazy">',
      {
        css: '.wide{display:none}@media (width >= 48rem){.wide{display:block;inline-size:100%;block-size:auto}}.lazy{display:none}',
      },
    ),
    'w100.png': png(100, 50),
    'w1600.png': png(1600, 100),
  };
  const details = await detailsOf(files, imageOversize);
  // The lazy hidden image never loads on its own, so it is not blamed.
  assert.equal(details.length, 1, details.join('\n'));
  assert.match(details[0] ?? '', /^\/ 390×844@3: img\.wide loads \/w1600\.png \(\d+ B\) and shows nowhere$/);
});

test('perf-image-oversize fails a file that two hidden images load, once', async () => {
  // Each copy loads the file, and no image with a box shows it: the copies do not exempt each other.
  const files: Files = {
    'index.html': page(
      '<img class="a" src="/w1600.png" width="1600" height="100" alt="Breit"><img class="b" src="/w1600.png" width="1600" height="100" alt="Breit">',
      { css: '.a,.b{display:none}' },
    ),
    'w1600.png': png(1600, 100),
  };
  const details = await detailsOf(files, imageOversize);
  assert.equal(details.length, 2, details.join('\n'));
  assert.match(details[0] ?? '', /^\/ 390×844@3: img\.a loads \/w1600\.png \(\d+ B\) and shows nowhere$/);
  assert.match(details[1] ?? '', /^\/ 1440×900@1: img\.a loads \/w1600\.png \(\d+ B\) and shows nowhere$/);
});

test('perf-image-oversize reads the descriptors of the source that the browser selected', async () => {
  // The source does not match at either device: the img gives the candidate, with 1x, so the file is 300 px wide.
  const files: Files = {
    'index.html': page(
      '<picture><source media="(width >= 2000px)" srcset="/p300.png 2x"><img class="p" src="/p300.png" srcset="/p300.png 1x" width="100" height="10" alt="Bild"></picture>',
      { css: 'img.p{display:block;inline-size:100px}@media (width >= 48rem){img.p{inline-size:300px}}' },
    ),
    'p300.png': png(300, 30),
  };
  assert.deepEqual(await detailsOf(files, imageOversize), []);
});

test('a navigation that times out under the throttle of perf-lcp-priority is not replayed to other rules', async () => {
  // About 1 MB: fast on the local server, more than 3 s at 200,000 B/s.
  const files: Files = {
    'index.html': page('<img class="big" src="/big.png" width="200" height="200" alt="Gross">', {
      css: 'img.big{display:block;inline-size:200px;block-size:auto}',
    }),
    'big.png': png(600, 600, true),
  };
  const findings = await findingsOf(browser(), files, [lcpPriority, imageOversize], { navigationLimitMs: 3_000 });
  const of = (id: string): string[] =>
    findings.filter((finding) => finding.rule === id).map((finding) => finding.detail ?? '');
  assert.ok(
    of('perf-lcp-priority').some((detail) => detail.includes('did not load within 3 s')),
    of('perf-lcp-priority').join('\n'),
  );
  // perf-image-oversize measures the page: 600 px for a box of 200 px at scale 1.
  assert.deepEqual(of('perf-image-oversize'), [
    '1440×900@1: img.big loads /big.png at 600 px for a box of 200.0 px × 1 (3.00×, at most 1.5×)',
  ]);
});

// perf-bfcache

test('bfcacheReasons: sorted, without masked, and without navigation-canceled beside another reason', () => {
  assert.deepEqual(bfcacheReasons(['masked']), []);
  assert.deepEqual(bfcacheReasons(['weblocks-contention', 'navigation-canceled', 'masked']), ['weblocks-contention']);
  assert.deepEqual(bfcacheReasons(['navigation-canceled']), ['navigation-canceled']);
  assert.deepEqual(bfcacheReasons(['b', 'a', 'b']), ['a', 'b']);
});

test('perf-bfcache passes a page that the browser restores from the back/forward cache', async () => {
  assert.deepEqual(await detailsOf({ 'index.html': html(BODY, { css: CSS }) }, bfcache), []);
});

test('perf-bfcache fails a page with Cache-Control: no-store, with the reason of Chromium', async () => {
  // `no-store` alone does not block the cache in Chromium 153 in every run: under load it restored such a page in
  // 42 of 2000 checks. A request from script for a `no-store` answer blocks it in 153 and in 158 (13.1 item 76).
  // The request is synchronous, so it ends before `load`, and the check leaves the page only after `load`.
  const request = "const request = new XMLHttpRequest(); request.open('GET', '/x.txt', false); request.send();";
  const files: Files = {
    'index.html': html(`${BODY}<script>${request}</script>`, { css: CSS }),
    'x.txt': 'x',
    _headers: '/*\n  Cache-Control: no-store\n',
  };
  const details = await detailsOf(files, bfcache);
  assert.equal(details.length, 1, details.join('\n'));
  assert.match(
    details[0] ?? '',
    /^\/ 1280×800: after \?kit-bfcache and back, the page loaded again instead of a restore from the back\/forward cache \(Chromium: [a-z, -]*response-cache-control-no-store/,
  );
});

test('perf-bfcache fails a held Web Lock with a stable detail', async () => {
  const restore =
    '/ 1280×800: after ?kit-bfcache and back, the page loaded again instead of a restore from the back/forward cache';
  // An unload listener is no case here: Chromium 153 keeps such a page out of the cache, and Chromium 158 restores it
  // (13.1 item 76). The kit reports what the browser does; bfcacheReasons has its own test for `masked`.
  // The second page asks for the lock that the first one holds, once its scripts ran. Chromium 153 names
  // weblocks-contention; the detail of another version may name no reason, when it names only masked (13.1 item 76).
  const lock = html(`${BODY}<script>navigator.locks.request('kit', () => new Promise(() => {}));</script>`, {
    css: CSS,
  });
  const details = await detailsOf({ 'index.html': lock }, bfcache);
  assert.equal(details.length, 1, details.join('\n'));
  assert.ok([restore, `${restore} (Chromium: weblocks-contention)`].includes(details[0] ?? ''), details[0]);
});

// perf-prerender

/** The home with the speculation rules as given, and the links of its header. */
const speculation = (
  rules: string,
  header = '<a href="#main">Zum Inhalt</a><a href="/zimmer/" target="_blank">Neu</a><a href="/zimmer/">Zimmer</a>',
): Files => ({
  'index.html': page('<p>Ein Absatz mit Text.</p>', {
    head: `<script type="speculationrules">${rules}</script>`,
    header,
  }),
  'zimmer/index.html': page('<p>Die Zimmer.</p>'),
});

test('perf-prerender passes a page whose hovered link starts a prerender', async () => {
  assert.deepEqual(await detailsOf(speculation(SPECULATION_JSON), prerender), []);
  // `target="_self"` opens the link in the same tab: the document rule takes it.
  assert.deepEqual(
    await detailsOf(speculation(SPECULATION_JSON, '<a href="/zimmer/" target="_SELF">Zimmer</a>'), prerender),
    [],
  );
  // `target=""` opens the link in the same tab too.
  assert.deepEqual(
    await detailsOf(speculation(SPECULATION_JSON, '<a href="/zimmer/" target="">Zimmer</a>'), prerender),
    [],
  );
  // A page with no link to another page passes.
  assert.deepEqual(await detailsOf(speculation(SPECULATION_JSON, '<a href="#main">Zum Inhalt</a>'), prerender), []);
  // With the speculation rules off, the rule checks nothing.
  const off = { ...SETTINGS, prefetch: { speculationRules: false, astroPrefetch: true } };
  assert.deepEqual(
    await detailsOf(speculation(SPECULATION_JSON.replace('moderate', 'conservative')), prerender, off),
    [],
  );
});

test('perf-prerender fails a page whose hovered link starts no prerender', async () => {
  // The first eligible link: not the skip link to the page itself, not the one with `target`.
  assert.deepEqual(await detailsOf(speculation(SPECULATION_JSON.replace('moderate', 'conservative')), prerender), [
    '/ 1280×800: a hover on a "Zimmer" (/zimmer/) gave no request with Sec-Purpose: prefetch;prerender within 2 s',
  ]);
  // Links to other pages, none of them eligible.
  assert.deepEqual(
    await detailsOf(
      speculation(SPECULATION_JSON, '<a href="/zimmer/" target="_blank">Neu</a><a href="/zimmer/" download>PDF</a>'),
      prerender,
    ),
    [`/ ${NO_PRERENDER}`],
  );
});

// perf-prefetch

/** The settings of the prefetch gate: astroPrefetch on, speculationRules off. */
const GATE: Options = { ...SETTINGS, prefetch: { speculationRules: false, astroPrefetch: true } };

/**
 * A stand-in of the prefetch gate of 6.2: 80 ms after `pointerover` on a link, a `<link rel="prefetch">` of its URL
 * without the fragment, as Astro's `prefetch()` adds it.
 */
const GATE_SCRIPT =
  "<script>document.addEventListener('pointerover', (e) => { const a = e.target instanceof Element ? e.target.closest('a[href]') : null; if (!a) return; setTimeout(() => { const l = document.createElement('link'); l.rel = 'prefetch'; l.href = a.href.split('#')[0]; document.head.append(l); }, 80); });</script>";

const gated = (headers?: string, href = '/zimmer/'): Files => ({
  'index.html': page(`<p>Ein Absatz mit Text.</p>${GATE_SCRIPT}`, { header: `<a href="${href}">Zimmer</a>` }),
  'zimmer/index.html': page('<p>Die Zimmer.</p>'),
  ...(headers === undefined ? {} : { _headers: headers }),
});

test('perf-prefetch passes a page whose hovered link is prefetched and then used', async () => {
  assert.deepEqual(await detailsOf(gated(), prefetch, GATE), []);
  // A link with a fragment, and a link that redirects to the page with its slash.
  assert.deepEqual(await detailsOf(gated(undefined, '/zimmer/#preise'), prefetch, GATE), []);
  assert.deepEqual(await detailsOf(gated(undefined, '/zimmer'), prefetch, GATE), []);
  // With the speculation rules on, the rule checks nothing.
  assert.deepEqual(await detailsOf(gated('/*\n  Cache-Control: no-store\n'), prefetch), []);
});

test('perf-prefetch fails a prefetch that the click cannot use, and a link that nothing prefetches', async () => {
  const stored = await detailsOf(gated('/*\n  Cache-Control: no-store\n'), prefetch, GATE);
  assert.equal(stored.length, 1, stored.join('\n'));
  assert.match(
    stored[0] ?? '',
    /^\/ 1280×800: the click on a "Zimmer" loaded \/zimmer\/ again \(transferSize [1-9]\d*\), not from the prefetch$/,
  );
  const plain: Files = {
    'index.html': page('<p>Ein Absatz mit Text.</p>', { header: '<a href="/zimmer/">Zimmer</a>' }),
    'zimmer/index.html': page('<p>Die Zimmer.</p>'),
  };
  assert.deepEqual(await detailsOf(plain, prefetch, GATE), [
    '/ 1280×800: a hover on a "Zimmer" (/zimmer/) gave no prefetch request within 2 s',
  ]);
});

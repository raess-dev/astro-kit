import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import type { BrowserContext, ConsoleMessage, Page, Pixel } from '../harness.ts';
import { baseRequire, browse, build, cspMeta, PIXEL_SOURCE, read, record, samePixel, standIn } from '../harness.ts';
import { PNG, project } from './project.ts';

const MODES = { auto: true, light: true, dark: true };
// The two values of `--color-page` in tokens.css below, as the four channels of a canvas pixel.
const LIGHT: Pixel = [0xff, 0xee, 0xdd, 255];
const DARK: Pixel = [0x11, 0x11, 0x11, 255];
/** A pixel of a painted frame, as `screencast` writes it: the two colors and the blank tab. It is no computed style. */
const PAINTED = { light: 'rgb(255, 238, 221)', dark: 'rgb(17, 17, 17)', blank: 'rgb(255, 255, 255)' };

// A head with the tags that a real page has, so that the place of the CSP meta shows.
const doc = (title: string, body: string): string =>
  [
    '---\n---\n<html lang="de"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${title}</title><meta name="description" content="A page">`,
    `<link rel="icon" href="/favicon.ico"></head><body>${body}</body></html>\n`,
  ].join('');

const files = {
  'public/favicon.ico': PNG,
  'src/styles/tokens.css': [
    '@layer tokens {',
    '  :root {',
    '    color-scheme: light dark;',
    '    --color-page: light-dark(#ffeedd, #111111);',
    '    --color-text: light-dark(#222222, #eeeeee);',
    '  }',
    '  :root[data-mode="light"] {',
    '    color-scheme: light;',
    '  }',
    '  :root[data-mode="dark"] {',
    '    color-scheme: dark;',
    '  }',
    '}',
    '',
  ].join('\n'),
  'src/styles/elements.css':
    '@layer elements {\n  body {\n    background: var(--color-page);\n    color: var(--color-text);\n  }\n}\n',
  'src/pages/index.astro': doc(
    'Mode',
    [
      '<fieldset data-mode-switch><legend>Darstellung</legend>',
      '<label><input type="radio" name="mode" value="auto"> Automatisch</label>',
      '<label><input type="radio" name="mode" value="light"> Hell</label>',
      '<label><input type="radio" name="mode" value="dark"> Dunkel</label>',
      '</fieldset>',
      '<main><h1>Mode</h1><p>The text below the switch moves when the switch appears late.</p></main>',
    ].join(''),
  ),
  'src/pages/404.astro': doc('Not found', '<main><h1>404</h1></main>'),
};

interface Frame {
  at: number;
  mode: string | null;
  scheme: string;
  /** The background color of `body`, painted on a canvas. `null` before the body exists. */
  background: Pixel | null;
  switch: string | null;
}
interface Log {
  attribute: { at: number; value: string | null; body: boolean; style: boolean; readyState: string } | null;
  frames: Frame[];
  violations: string[];
  paints: Record<string, number>;
  shifts: number[];
}

/**
 * Runs before every script of the page, and is not subject to the page CSP (13.1 item 30). It records when
 * `data-mode` appears, what every animation frame up to the first contentful paint shows, the paint entries, the
 * layout shifts and the CSP violations. A color is read as a canvas pixel, never as computed text.
 */
const PROBE = `(() => {
  const log = { attribute: null, frames: [], violations: [], paints: {}, shifts: [] };
  window.__s15 = log;
  const pixel = window.__pixel = ${PIXEL_SOURCE};
  new MutationObserver(() => {
    if (log.attribute !== null) return;
    log.attribute = {
      at: performance.now(),
      value: document.documentElement.getAttribute('data-mode'),
      body: document.body !== null,
      style: document.querySelector('style') !== null,
      readyState: document.readyState,
    };
  }).observe(document, { attributes: true, attributeFilter: ['data-mode'], subtree: true });
  document.addEventListener('securitypolicyviolation', (e) => log.violations.push(e.effectiveDirective));
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) log.paints[entry.name] = entry.startTime;
  }).observe({ type: 'paint', buffered: true });
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) if (!entry.hadRecentInput) log.shifts.push(entry.value);
  }).observe({ type: 'layout-shift', buffered: true });
  const frame = () => {
    const root = document.documentElement;
    const control = document.querySelector('[data-mode-switch]');
    log.frames.push({
      at: performance.now(),
      mode: root.getAttribute('data-mode'),
      scheme: getComputedStyle(root).colorScheme,
      background: document.body ? pixel(getComputedStyle(document.body).backgroundColor) : null,
      switch: control ? getComputedStyle(control).display : null,
    });
    if (log.frames.length < 600 && log.paints['first-contentful-paint'] === undefined) requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
})();`;

type Probed = { __s15: Log; __pixel(color: string): Pixel };

interface Raw {
  data: Uint8Array;
  info: { width: number; height: number; channels: number };
}

const logOf = (tab: Page): Promise<Log> => tab.evaluate(() => (window as unknown as Probed).__s15);

/** Two animation frames: after them, a layout shift of the last change has reached its observer. */
const settle = (tab: Page): Promise<void> =>
  tab.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))));

/**
 * The frames that Chromium paints for the tab, as the color of the pixel near the bottom right corner, where only
 * the page background shows. Chromium sends the next frame after the acknowledgment, so a frame can be missing.
 */
async function screencast(context: BrowserContext, tab: Page): Promise<() => Promise<string[]>> {
  const sharp = baseRequire()('sharp') as (input: Buffer) => {
    raw(): { toBuffer(options: { resolveWithObject: true }): Promise<Raw> };
  };
  const cdp = await context.newCDPSession(tab);
  const colors: Promise<string>[] = [];
  cdp.on('Page.screencastFrame', (frame: { data: string; sessionId: number }) => {
    colors.push(
      sharp(Buffer.from(frame.data, 'base64'))
        .raw()
        .toBuffer({ resolveWithObject: true })
        .then(({ data, info }) => {
          const at = ((info.height - 5) * info.width + info.width - 5) * info.channels;
          return `rgb(${data[at]}, ${data[at + 1]}, ${data[at + 2]})`;
        }),
    );
    cdp.send('Page.screencastFrameAck', { sessionId: frame.sessionId }).catch(() => {
      // The tab can close before the acknowledgment arrives. Then no frame follows, and the spike needs none.
    });
  });
  await cdp.send('Page.startScreencast', { format: 'png', everyNthFrame: 1 });
  return () => Promise.all(colors);
}

/**
 * Waits until the last painted frame has the color, and returns the painted frames. After 30 seconds it returns the
 * frames as they are, so the caller asserts that the last frame has the color.
 */
async function painted(colors: () => Promise<string[]>, color: string): Promise<string[]> {
  const end = Date.now() + 30_000;
  for (;;) {
    const seen = await colors();
    if (seen.at(-1) === color || Date.now() >= end) return seen;
    await new Promise((done) => setTimeout(done, 20));
  }
}

/** The failure message for a wait of `painted` that did not end on the color. */
const notPainted = (frames: string[], color: string): string => `no painted frame is ${color}: ${frames.join(' | ')}`;

/** The tags of the head of a built page, in order. */
function headOrder(html: string, modeText: string): string[] {
  const head = /<head>([\s\S]*?)<\/head>/.exec(html)?.[1] ?? '';
  const order: string[] = [];
  for (const match of head.matchAll(/<(meta|title|script|style|link)\b([^>]*)>/g)) {
    const tag = match[1] ?? '';
    const attributes = match[2] ?? '';
    const rest = head.slice(match.index + match[0].length);
    if (tag === 'meta') {
      const name = /name="([^"]+)"/.exec(attributes)?.[1];
      order.push(`meta ${attributes.includes('charset') ? 'charset' : (name ?? 'csp')}`);
    } else if (tag === 'script') {
      const mode = rest.startsWith(`${modeText}</script>`);
      order.push(attributes.includes('speculationrules') ? 'script speculationrules' : mode ? 'script mode' : 'script');
    } else order.push(tag === 'link' ? `link ${/rel="([^"]+)"/.exec(attributes)?.[1] ?? ''}` : tag);
  }
  return order;
}

test('S15: the mode script of build:done runs before the first paint, with the CSP and Trusted Types on', async () => {
  const kit = await standIn();
  const script = kit.modeScript(MODES);
  const dir = project('s15', files, `{ modes: ${JSON.stringify(MODES)} }`);
  build(dir);

  // The built head: the project's tags, the CSP meta, the two inserts, then the one <style>.
  const html = read(dir, 'dist/index.html');
  const order = headOrder(html, script);
  assert.deepEqual(order, [
    'meta charset',
    'meta viewport',
    'title',
    'meta description',
    'link icon',
    'meta csp',
    'script mode',
    'script speculationrules',
    'style',
  ]);
  record('S15.headOrder', order);
  assert.deepEqual(headOrder(read(dir, 'dist/404.html'), script), order, '/404.html has the same head');
  assert.ok(cspMeta(html).includes(`'${kit.sha256(script)}'`), 'the CSP meta holds the hash of the mode script');

  const header = kit.headerCsp({});
  assert.ok(header.includes("require-trusted-types-for 'script'; trusted-types 'none'"), 'Trusted Types is on');
  const { server, browser, close } = await browse(join(dir, 'dist'), {
    headers: { 'content-security-policy': header },
  });
  try {
    /** Opens `path` in a new context with a light system and the stored mode, and waits for the first paint. */
    const open = async (stored: string | undefined, path = '/') => {
      const context = await browser.newContext({
        colorScheme: 'light',
        storageState: {
          cookies: [],
          origins: stored ? [{ origin: server.origin, localStorage: [{ name: 'astro-kit:mode', value: stored }] }] : [],
        },
      });
      // A copy of the page whose mode script differs by one space, so its hash is not in the CSP.
      await context.route(`${server.origin}/tampered/`, (route: { fulfill(response: unknown): Promise<void> }) =>
        route.fulfill({
          status: 200,
          contentType: 'text/html; charset=utf-8',
          headers: { 'content-security-policy': header },
          body: html.replace(`<script>${script}</script>`, `<script>${script} </script>`),
        }),
      );
      const tab = await context.newPage();
      const errors: string[] = [];
      tab.on('console', (message: ConsoleMessage) => {
        if (message.type() === 'error') errors.push(message.text());
      });
      tab.on('pageerror', (error: Error) => errors.push(String(error)));
      await tab.addInitScript(PROBE);
      const colors = await screencast(context, tab);
      await tab.goto(`${server.origin}${path}`);
      await tab.waitForFunction(() => 'first-contentful-paint' in (window as unknown as Probed).__s15.paints);
      await settle(tab);
      return { tab, errors, colors };
    };

    // The system is light and the stored mode is dark.
    const { tab, errors, colors } = await open('dark');
    const seen = await logOf(tab);
    const firstPaint = seen.paints['first-paint'] ?? Number.NaN;
    const at = seen.attribute?.at ?? Number.NaN;
    assert.deepEqual(
      { ...seen.attribute, at: 0 },
      { at: 0, value: 'dark', body: false, style: false, readyState: 'loading' },
      'data-mode appears while the head is parsed: no body yet, and the <style> is not parsed yet',
    );
    assert.ok(at < firstPaint, `data-mode (${at} ms) comes before the first-paint entry (${firstPaint} ms)`);
    // Every animation frame up to the first paint already has the dark theme and the visible switch.
    const before = seen.frames.filter((frame) => frame.at <= firstPaint);
    assert.ok(before.length > 0, 'an animation frame ran before the first paint');
    for (const frame of seen.frames) {
      assert.deepEqual({ mode: frame.mode, scheme: frame.scheme }, { mode: 'dark', scheme: 'dark' });
      assert.ok(frame.background === null || samePixel(frame.background, DARK), `a frame has ${frame.background}`);
      assert.ok(frame.switch === null || frame.switch === 'block', `a frame has the switch at ${frame.switch}`);
    }
    const last = before.at(-1);
    assert.ok(
      samePixel(last?.background ?? [], DARK),
      `the frame of the first paint has the dark background: ${last?.background}`,
    );
    assert.equal(last?.switch, 'block', 'the frame of the first paint has the switch');
    // The painted frames themselves: the blank tab, then dark. No frame shows the light theme of the system.
    const frames = await painted(colors, PAINTED.dark);
    assert.equal(frames.at(-1), PAINTED.dark, notPainted(frames, PAINTED.dark));
    assert.deepEqual(
      [...new Set(frames)].filter((color) => color !== PAINTED.blank),
      [PAINTED.dark],
      frames.join(' | '),
    );
    assert.deepEqual(seen.shifts, [], 'no layout shift: CLS is 0');
    const checked = (): string | undefined => document.querySelector<HTMLInputElement>('[name="mode"]:checked')?.value;
    assert.equal(await tab.evaluate(checked), 'dark', 'the switch shows the stored mode');
    record('S15.firstPaint', { dataModeBeforeBody: true, dataModeBeforeStyle: true, background: '#111111', cls: 0 });

    // Control: the layout-shift observer sees the switch disappear, so a late switch would have counted.
    await tab.evaluate(() => document.documentElement.removeAttribute('data-mode'));
    await tab.waitForFunction(() => (window as unknown as Probed).__s15.shifts.length > 0);
    await tab.evaluate(() => document.documentElement.setAttribute('data-mode', 'dark'));

    // The rest of the script under the CSP: a choice in the switch sets the mode and stores it.
    await tab.click('input[value="light"]');
    assert.deepEqual(
      await tab.evaluate(() => [document.documentElement.dataset.mode, localStorage.getItem('astro-kit:mode')]),
      ['light', 'light'],
    );
    const background = (): Pixel =>
      (window as unknown as Probed).__pixel(getComputedStyle(document.body).backgroundColor);
    assert.ok(samePixel(await tab.evaluate(background), LIGHT), 'the page shows the light value');
    assert.deepEqual(errors, [], 'no console error and no page error');
    assert.deepEqual((await logOf(tab)).violations, [], 'no CSP violation');

    // Control: Trusted Types is enforced, and the violation listener and the console see it.
    assert.equal(
      await tab.evaluate(() => {
        try {
          document.createElement('div').innerHTML = '<b>x</b>';
          return 'allowed';
        } catch (error) {
          return (error as Error).name;
        }
      }),
      'TypeError',
    );
    // The violation event is a task of its own, so wait for it.
    await tab.waitForFunction(() => (window as unknown as Probed).__s15.violations.length > 0);
    assert.deepEqual((await logOf(tab)).violations, ['require-trusted-types-for']);

    // Control: with no stored mode, the same page paints the light theme of the system.
    const plain = await open(undefined);
    const plainSeen = await logOf(plain.tab);
    assert.equal(plainSeen.attribute?.value, 'auto');
    assert.equal(plainSeen.attribute?.body, false);
    const plainPaint = plainSeen.paints['first-paint'] ?? 0;
    const plainLast = plainSeen.frames.filter((frame) => frame.at <= plainPaint).at(-1);
    assert.ok(
      samePixel(plainLast?.background ?? [], LIGHT),
      `the frame of the first paint is light: ${plainLast?.background}`,
    );
    const plainFrames = await painted(plain.colors, PAINTED.light);
    assert.equal(plainFrames.at(-1), PAINTED.light, notPainted(plainFrames, PAINTED.light));
    assert.equal(plainFrames.includes(PAINTED.dark), false);
    assert.deepEqual(plain.errors, []);

    // Control: a mode script whose hash is not in the CSP meta does not run, and both listeners report it.
    const tampered = await open('dark', '/tampered/');
    await tampered.tab.waitForFunction(() => (window as unknown as Probed).__s15.violations.length > 0);
    const tamperedSeen = await logOf(tampered.tab);
    assert.equal(tamperedSeen.attribute, null, 'the script did not run');
    assert.deepEqual(tamperedSeen.violations, ['script-src-elem']);
    const end = Date.now() + 30_000;
    while (tampered.errors.length === 0 && Date.now() < end) await settle(tampered.tab);
    assert.equal(tampered.errors.length, 1, tampered.errors.join('\n'));
    assert.match(tampered.errors[0] ?? '', /Content Security Policy/);
    const tamperedFrames = await painted(tampered.colors, PAINTED.light);
    assert.equal(tamperedFrames.at(-1), PAINTED.light, notPainted(tamperedFrames, PAINTED.light));
    assert.equal(tamperedFrames.includes(PAINTED.dark), false, 'the page shows the system theme');
  } finally {
    await close();
  }
});

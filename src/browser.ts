/**
 * astro-kit test: the browser checks, in Chromium through playwright-core, against dist served locally.
 * Pages: every page with --all, else one per layout × locale. The perf pass always uses that smaller set.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { type Browser, chromium, type Page } from 'playwright-core';
import { parseHtml, urlPathOf } from './build.ts';
import { CONTACT_ACTION } from './forms/limits.ts';
import { type KitOptions, loadOptions } from './options.ts';
import { Report } from './registry.ts';
import { serveDist } from './serve.ts';

export const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];
/** color-contrast "needs review" reasons that hide text over images, so they count as failures. */
export const AXE_CONTRAST_UNKNOWN = ['bgImage', 'bgGradient', 'imgNode', 'pseudoContent'];
/** WCAG 1.4.12 text spacing. */
export const TEXT_SPACING =
  '* { line-height: 1.5 !important; letter-spacing: .12em !important; word-spacing: .16em !important } p { margin-bottom: 2em !important }';
/** Token pairs [foreground, background, ratio]. */
export const PAIRS: readonly [string, string, number][] = [
  ['text', 'bg', 7],
  ['text', 'surface', 7],
  ['contrast-fg', 'contrast-bg', 7],
  ['muted', 'bg', 4.5],
  ['muted', 'surface', 4.5],
  ['link', 'bg', 4.5],
  ['primary-fg', 'primary', 4.5],
  ['error', 'bg', 4.5],
  ['border', 'bg', 3],
  ['focus', 'bg', 3],
  ['focus', 'surface', 3],
];
export const PERF_VIEWPORTS = [
  { label: '390×844@3', viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 },
  { label: '1440×900@1', viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
];
const DESKTOP = { width: 1280, height: 800 };
const NARROW = { width: 390, height: 844 };

/** Page helpers, installed before any page script; the page CSP does not apply to them. */
export const PAGE_HELPERS = `window.__kit = {
  name(e) { const t = (e.getAttribute('aria-label') || e.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 30); return e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + (t ? ' "' + t + '"' : ''); },
  shown(e) { const r = e.getBoundingClientRect(); return e.checkVisibility({ visibilityProperty: true }) && r.width > 0 && r.height > 0 && !e.closest('[inert]'); },
};`;
/** LCP element and CLS as the largest session window (1 s gap, 5 s cap). */
const PERF = `(() => { const k = { cls: 0, lcp: null }; let win = 0, first = 0, last = 0;
  new PerformanceObserver((l) => { for (const e of l.getEntries()) k.lcp = e.element || k.lcp; }).observe({ type: 'largest-contentful-paint', buffered: true });
  new PerformanceObserver((l) => { for (const e of l.getEntries()) { if (e.hadRecentInput) continue;
    if (win && e.startTime - last < 1000 && e.startTime - first < 5000) win += e.value; else { win = e.value; first = e.startTime; }
    last = e.startTime; k.cls = Math.max(k.cls, win); } }).observe({ type: 'layout-shift', buffered: true });
  window.__kitPerf = k; })();`;

declare global {
  interface Window {
    __kit: { name(e: Element): string; shown(e: Element): boolean };
    __kitPerf: { cls: number; lcp: Element | null };
    __kitPersisted?: boolean;
  }
}

export interface DistPage {
  path: string;
  locale: string;
  /** Scoped components, media in main, home or 404: pages with the same value share a layout. */
  layout: string;
  contact: boolean;
}

export function chromePath(env: Record<string, string | undefined> = process.env): string | undefined {
  if (env.CHROME_PATH) return env.CHROME_PATH;
  return existsSync('/usr/bin/google-chrome') ? '/usr/bin/google-chrome' : undefined;
}

/** dist, or dist/client when the Cloudflare adapter split the build. */
export const distDir = (root: string): string =>
  existsSync(join(root, 'dist/client/index.html')) ? join(root, 'dist/client') : join(root, 'dist');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, out);
    else if (entry.name.endsWith('.html')) out.push(path);
  }
  return out;
}

export function distPages(dist: string, options: KitOptions): DistPage[] {
  const codes = new Map(options.locales.map((l) => [l.tag.toLowerCase(), l.code]));
  const homes = new Set(options.locales.map((l) => (l.code === options.defaultLocale ? '/' : `/${l.code}/`)));
  return walk(dist)
    .map((file) => {
      const doc = parseHtml(readFileSync(file, 'utf8'));
      const path = urlPathOf(dist, file);
      const lang = (doc.querySelector('html')?.getAttribute('lang') ?? '').toLowerCase();
      const cids = new Set<string>();
      for (const el of doc.querySelectorAll('*')) {
        for (const name of Object.keys(el.attributes)) if (name.startsWith('data-astro-cid-')) cids.add(name);
      }
      const main = doc.querySelector('main');
      const media = ['picture', 'img', 'video', 'audio', 'table', 'form', 'iframe'].filter((tag) =>
        main?.querySelector(tag),
      );
      const kind = path === '/404.html' ? ['404'] : homes.has(path) ? ['home'] : [];
      return {
        path,
        locale: codes.get(lang) ?? (lang.split('-')[0] || options.defaultLocale),
        layout: [...kind, ...[...cids].sort(), ...media].join(' '),
        contact: doc.querySelector(`form[action="${CONTACT_ACTION}"]`) !== null,
      };
    })
    .sort((a, b) => a.path.localeCompare(b.path));
}

/** All pages, or the first page of each layout in each locale. */
export function pickPages(pages: readonly DistPage[], all: boolean): DistPage[] {
  if (all) return [...pages];
  const seen = new Set<string>();
  return pages.filter((p) => {
    const key = `${p.locale}|${p.layout}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const channel = (c: number): number => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
export const luminance = ([r = 0, g = 0, b = 0]: readonly number[]): number =>
  0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
export function contrastRatio(a: readonly number[], b: readonly number[]): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}
/** An RGBA colour painted over an opaque one. */
export function over([r = 0, g = 0, b = 0, a = 255]: readonly number[], bg: readonly number[]): number[] {
  const f = a / 255;
  return [r, g, b].map((c, i) => Math.round(c * f + (bg[i] ?? 255) * (1 - f)));
}

export interface AxeSummary {
  violations: { id: string; targets: string[] }[];
  incomplete: { id: string; nodes: { target: string; keys: string[] }[] }[];
}

/** Violations, plus "needs review" results that hide missing captions or text over images. */
export function axeFailures(result: AxeSummary): string[] {
  const out = result.violations.map((v) => `${v.id}: ${v.targets.slice(0, 3).join(', ')}`);
  for (const item of result.incomplete) {
    const nodes = item.nodes.filter(
      (n) =>
        item.id === 'video-caption' ||
        (item.id === 'color-contrast' && n.keys.some((k) => AXE_CONTRAST_UNKNOWN.includes(k))),
    );
    if (nodes.length)
      out.push(
        `${item.id} needs review: ${nodes
          .slice(0, 3)
          .map((n) => `${n.target}${n.keys.length ? ` (${n.keys.join(', ')})` : ''}`)
          .join(', ')}`,
      );
  }
  return out;
}

interface Run {
  browser: Browser;
  origin: string;
  report: Report;
  options: KitOptions;
  warnings: string[];
}

const list = (items: readonly string[]): string =>
  `${items.length}: ${items.slice(0, 5).join(', ')}${items.length > 5 ? ', …' : ''}`;

/** A check that throws is a failure of that check, never a silent pass. */
async function step(run: Run, rule: string, where: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (error) {
    run.report.add(rule, where, `the check did not finish: ${(error as Error).message.split('\n')[0]}`);
  }
}

async function open(run: Run, page: Page, path: string, viewport = DESKTOP): Promise<void> {
  await page.setViewportSize(viewport);
  await page.goto(new URL(path, run.origin).href, { waitUntil: 'load' });
}

/** Opens every visible header menu; returns how many. */
const openMenu = (page: Page): Promise<number> =>
  page.evaluate(() => {
    const menus = [...document.querySelectorAll<HTMLDetailsElement>('header details')].filter((d) =>
      d.checkVisibility(),
    );
    for (const d of menus) d.open = true;
    return menus.length;
  });

const focusRing = (page: Page) =>
  page.evaluate(() => {
    const e = document.activeElement;
    if (!e || e === document.body) return null;
    const s = getComputedStyle(e);
    return { name: window.__kit.name(e), width: Number.parseFloat(s.outlineWidth) || 0, style: s.outlineStyle };
  });

async function axe(run: Run, page: Page, path: string, source: string): Promise<void> {
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme });
    await open(run, page, path);
    await page.evaluate(source);
    const result = await page.evaluate(async (tags) => {
      type Node = { target: string[]; any: { data?: { messageKey?: string } | null }[] };
      type Result = { id: string; nodes: Node[] };
      const axeRun = (
        window as unknown as {
          axe: { run(c: Document, o: object): Promise<{ violations: Result[]; incomplete: Result[] }> };
        }
      ).axe;
      const r = await axeRun.run(document, {
        runOnly: { type: 'tag', values: tags },
        resultTypes: ['violations', 'incomplete'],
      });
      return {
        violations: r.violations.map((v) => ({ id: v.id, targets: v.nodes.map((n) => n.target.join(' ')) })),
        incomplete: r.incomplete.map((v) => ({
          id: v.id,
          nodes: v.nodes.map((n) => ({
            target: n.target.join(' '),
            keys: n.any.flatMap((c) => (c.data?.messageKey ? [c.data.messageKey] : [])),
          })),
        })),
      };
    }, AXE_TAGS);
    for (const failure of axeFailures(result)) run.report.add('a11y-axe', `${path} (${colorScheme})`, failure);
  }
  await page.emulateMedia({ colorScheme: null });
}

/** a11y-focus: the first Tab shows an outline of 2 px or more; a mouse click on a link and a button shows none. */
export async function checkFocus(page: Page, where: string, report: Report): Promise<void> {
  await page.keyboard.press('Tab');
  const ring = await focusRing(page);
  if (!ring) report.add('a11y-focus', where, 'the first Tab focuses nothing');
  else if (ring.style === 'none' || ring.width < 2)
    report.add('a11y-focus', where, `Tab: ${ring.name} has a ${ring.width}px ${ring.style} outline`);
  await page.reload();
  for (const selector of ['a[href]', 'button, summary']) {
    const found = await page.evaluate((sel) => {
      for (const e of document.querySelectorAll('[data-kit-click]')) e.removeAttribute('data-kit-click');
      const r = (e: Element) => e.getBoundingClientRect();
      const hit = [...document.querySelectorAll(sel)].find(
        (e) => window.__kit.shown(e) && r(e).top >= 0 && r(e).bottom <= innerHeight,
      );
      hit?.setAttribute('data-kit-click', '');
      // The click must not navigate, submit or toggle; focus moves on mousedown anyway.
      if (hit) addEventListener('click', (e) => e.preventDefault(), { capture: true, once: true });
      return hit !== undefined;
    }, selector);
    if (!found) continue;
    await page.click('[data-kit-click]');
    const after = await focusRing(page);
    if (after && after.style !== 'none' && after.width > 0)
      report.add('a11y-focus', where, `a mouse click on ${after.name} shows a ${after.width}px outline`);
  }
}

/** a11y-keyboard: Tab reaches every visible control, and each focused control is visible and on top. */
export async function sweep(run: Pick<Run, 'report'>, page: Page, where: string): Promise<void> {
  const total = await page.evaluate(() => {
    let n = 0;
    const groups = new Set<string>();
    for (const e of document.querySelectorAll<HTMLElement>(
      'a[href], button, input, select, textarea, summary, [tabindex], [contenteditable]',
    )) {
      if (e.tabIndex < 0 || e.matches(':disabled, [type=hidden]') || !window.__kit.shown(e)) continue;
      // A named radio group is one Tab stop: its checked radio, or its first one.
      if (e instanceof HTMLInputElement && e.type === 'radio' && e.name) {
        const key = `${e.form ? [...document.forms].indexOf(e.form) : -1}:${e.name}`;
        if (groups.has(key)) continue;
        groups.add(key);
        const group = [...document.querySelectorAll<HTMLInputElement>('input[type=radio]')].filter(
          (r) => r.name === e.name && r.form === e.form && !r.disabled && window.__kit.shown(r),
        );
        (group.find((r) => r.checked) ?? e).setAttribute('data-kit-stop', String(n++));
        continue;
      }
      e.setAttribute('data-kit-stop', String(n++));
    }
    return n;
  });
  const reached = new Set<string>();
  const hidden = new Set<string>();
  const ringless = new Set<string>();
  for (let i = 0; i < total + 5 && reached.size < total; i++) {
    await page.keyboard.press('Tab');
    const f = await page.evaluate(() => {
      const e = document.activeElement;
      if (!e || e === document.body) return null;
      // WCAG 2.4.11: a focused element is not entirely hidden. So sample the on-screen part of each line box,
      // its centre and then points just inside its corners: a wrapped link's box centre can fall between its
      // lines, and a tall field's centre can sit below the fold while its top is on screen.
      const hits = (x: number, y: number) => {
        const top = document.elementFromPoint(x, y);
        return top !== null && (top === e || e.contains(top));
      };
      const boxes = [...e.getClientRects()];
      const onTop = (boxes.length ? boxes : [e.getBoundingClientRect()]).some((q) => {
        const [l, t] = [Math.max(q.left, 0), Math.max(q.top, 0)];
        const [r, b] = [Math.min(q.right, innerWidth), Math.min(q.bottom, innerHeight)];
        if (r - l < 1 || b - t < 1) return false;
        const inset = Math.min(2, (r - l) / 2, (b - t) / 2);
        const points = [
          [(l + r) / 2, (t + b) / 2],
          [l + inset, t + inset],
          [r - inset, t + inset],
          [l + inset, b - inset],
          [r - inset, b - inset],
        ];
        return points.some(([x = 0, y = 0]) => hits(x, y));
      });
      const kit = window.__kit;
      const s = getComputedStyle(e);
      return {
        stop: e.getAttribute('data-kit-stop'),
        name: kit.name(e),
        shown: kit.shown(e),
        onTop,
        ring: s.outlineStyle !== 'none' && (Number.parseFloat(s.outlineWidth) || 0) >= 2,
      };
    });
    if (!f) continue;
    if (f.stop !== null) reached.add(f.stop);
    if (!f.shown || !f.onTop) hidden.add(`${f.name} (${f.shown ? 'covered' : 'not visible'})`);
    if (!f.ring) ringless.add(f.name);
  }
  if (hidden.size) run.report.add('a11y-keyboard', where, `hidden when focused ${list([...hidden])}`);
  if (ringless.size) run.report.add('a11y-focus', where, `no 2px outline on Tab ${list([...ringless])}`);
  if (reached.size < total) {
    const missed = await page.evaluate(
      (seen) =>
        // A stop that an island removed or hid while hydrating is no longer a stop.
        [...document.querySelectorAll('[data-kit-stop]')]
          .filter((e) => !seen.includes(e.getAttribute('data-kit-stop') ?? '') && window.__kit.shown(e))
          .map((e) => window.__kit.name(e)),
      [...reached],
    );
    if (missed.length) run.report.add('a11y-keyboard', where, `not reached by Tab ${list(missed)}`);
  }
}

async function keyboard(run: Run, page: Page, path: string): Promise<void> {
  await open(run, page, path);
  await sweep(run, page, path);
  await open(run, page, path, NARROW);
  await sweep(run, page, `${path} (390 px)`);
  await open(run, page, path, NARROW);
  if (await openMenu(page)) await sweep(run, page, `${path} (390 px, menu open)`);
}

async function targets(run: Run, page: Page, path: string): Promise<void> {
  for (const viewport of [DESKTOP, NARROW]) {
    await open(run, page, path, viewport);
    const menu = viewport === NARROW && (await openMenu(page)) > 0;
    const small = await page.evaluate(() => {
      const out: string[] = [];
      for (const e of document.querySelectorAll('a[href], button, input, select, summary')) {
        if (e.matches('[type=checkbox], [type=radio], [type=hidden]') || !window.__kit.shown(e)) continue;
        if (getComputedStyle(e).display === 'inline') continue;
        const r = e.getBoundingClientRect();
        // Visually hidden, or above the page start (a skip link before focus): not a pointer target.
        if ((r.width <= 1 && r.height <= 1) || r.bottom + scrollY <= 0) continue;
        if (r.width < 43.5 || r.height < 43.5)
          out.push(`${window.__kit.name(e)} ${Math.round(r.width)}×${Math.round(r.height)}`);
      }
      return out;
    });
    if (small.length)
      run.report.add(
        'a11y-targets',
        `${path} (${viewport.width} px${menu ? ', menu open' : ''})`,
        `under 44×44 px ${list(small)}`,
      );
  }
}

async function reflow(run: Run, page: Page, path: string): Promise<void> {
  for (const menu of [false, true]) {
    await open(run, page, path, { width: 320, height: 640 });
    if (menu && !(await openMenu(page))) continue;
    const wide = await page.evaluate(() => {
      const w = document.documentElement.clientWidth;
      const past = new Set<Element>();
      for (const e of document.body.querySelectorAll('*')) {
        const r = e.getBoundingClientRect();
        if (r.width === 0 || r.right <= w + 1 || !e.checkVisibility()) continue;
        let p = e.parentElement;
        while (p && p !== document.body && getComputedStyle(p).overflowX === 'visible') p = p.parentElement;
        if (!p || p === document.body) past.add(e);
      }
      const kit = window.__kit;
      const outer = [...past]
        .filter((e) => !past.has(e.parentElement as Element))
        .map((e) => `${kit.name(e)} to ${Math.round(e.getBoundingClientRect().right)} px`);
      // A hint at the cause: the widest unbreakable text, measured with width: min-content for a moment.
      const texts: [number, string][] = [];
      for (const e of past.size ? document.body.querySelectorAll<HTMLElement>('*') : []) {
        if (![...e.childNodes].some((n) => n.nodeType === 3 && n.textContent?.trim())) continue;
        const old = e.style.width;
        e.style.width = 'min-content';
        texts.push([e.getBoundingClientRect().width, kit.name(e)]);
        e.style.width = old;
      }
      const causes = texts
        .sort((a, b) => b[0] - a[0])
        .slice(0, 2)
        .map(([width, name]) => `${name} ${Math.round(width)} px`);
      // Text can overflow a box that itself fits; the page then still scrolls sideways.
      const scroll = document.documentElement.scrollWidth > w + 1 ? document.documentElement.scrollWidth : 0;
      return { outer, causes, scroll };
    });
    const where = `${path} (320 px${menu ? ', menu open' : ''})`;
    if (wide.outer.length)
      run.report.add(
        'a11y-reflow',
        where,
        `past the viewport ${list(wide.outer)}${wide.causes.length ? `; widest text ${wide.causes.join(', ')}` : ''}`,
      );
    else if (wide.scroll) run.report.add('a11y-reflow', where, `the page scrolls sideways to ${wide.scroll} px`);
  }
}

async function spacing(run: Run, page: Page, path: string): Promise<void> {
  for (const viewport of [DESKTOP, NARROW]) {
    await open(run, page, path, viewport);
    const result = await page.evaluate((css) => {
      // A constructed sheet is CSSOM, so the page CSP allows it.
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(css);
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
      const clipped: string[] = [];
      for (const e of document.body.querySelectorAll('*')) {
        const s = getComputedStyle(e);
        if (!/hidden|clip/.test(s.overflowY) || e.clientHeight <= 1 || e.clientWidth <= 1) continue;
        if (e.scrollHeight - e.clientHeight > 2) clipped.push(window.__kit.name(e));
      }
      const root = document.documentElement;
      return { clipped, sideways: root.scrollWidth > root.clientWidth };
    }, TEXT_SPACING);
    const where = `${path} (${viewport.width} px)`;
    if (result.clipped.length) run.report.add('a11y-spacing', where, `clipped ${list(result.clipped)}`);
    if (result.sideways) run.report.add('a11y-spacing', where, 'the page scrolls sideways');
  }
}

async function forcedColors(run: Run, page: Page, path: string): Promise<void> {
  await page.emulateMedia({ forcedColors: 'active' });
  try {
    await open(run, page, path);
    for (const selector of ['h1', 'main']) {
      if (!(await page.locator(selector).first().isVisible()))
        run.report.add('a11y-forced-colors', path, `${selector} is not visible`);
    }
    const borderless = await page.evaluate(() =>
      [...document.querySelectorAll('button, .primary, .secondary, .outline')]
        .filter((e) => window.__kit.shown(e))
        .filter((e) => {
          const s = getComputedStyle(e);
          return (
            s.borderTopStyle === 'none' ||
            Number.parseFloat(s.borderTopWidth) < 1 ||
            /transparent|rgba\([^)]*,\s*0\)/.test(s.borderTopColor)
          );
        })
        .map((e) => window.__kit.name(e)),
    );
    if (borderless.length)
      run.report.add('a11y-forced-colors', path, `buttons without a visible border ${list(borderless)}`);
    await page.keyboard.press('Tab');
    const ring = await focusRing(page);
    if (ring && (ring.style === 'none' || ring.width === 0))
      run.report.add('a11y-forced-colors', path, `${ring.name} shows no focus ring`);
  } finally {
    await page.emulateMedia({ forcedColors: null });
  }
}

/** a11y-no-js: the shell renders, and the contact form reaches #sent through the stub. */
async function noJs(run: Run, page: Page, p: DistPage): Promise<void> {
  await open(run, page, p.path);
  for (const selector of ['h1', 'main', 'nav']) {
    if (!(await page.locator(selector).first().isVisible()))
      run.report.add('a11y-no-js', p.path, `${selector} is not visible without JS`);
  }
  if (!p.contact || !run.options.features.forms) return;
  const form = page.locator(`form[action="${CONTACT_ACTION}"]`).first();
  for (const field of await form.locator('input[required], textarea[required]').all()) {
    if (!(await field.isVisible())) continue;
    const type = (await field.getAttribute('type')) ?? 'text';
    if (type === 'checkbox') await field.check();
    else
      await field.fill(type === 'email' ? 'probe@example.com' : type === 'tel' ? '+41441234567' : 'Kit browser test');
  }
  await form.locator('button[type="submit"], button:not([type])').first().click();
  const sent = await page.waitForURL(/#sent$/, { timeout: 10_000 }).then(
    () => page.locator('#sent').isVisible(),
    () => false,
  );
  if (!sent) run.report.add('a11y-no-js', p.path, 'the contact form does not show #sent after a submit without JS');
}

async function contrastPairs(run: Run, page: Page, path: string): Promise<void> {
  const tokens = [...new Set(PAIRS.flat().filter((x): x is string => typeof x === 'string'))];
  for (const colorScheme of ['light', 'dark'] as const) {
    for (const contrast of ['no-preference', 'more'] as const) {
      await page.emulateMedia({ colorScheme, contrast });
      await open(run, page, path);
      // Each token is resolved through a probe's computed colour and painted on a 1×1 canvas for sRGB bytes.
      const colors = await page.evaluate((names) => {
        const root = getComputedStyle(document.documentElement);
        const probe = document.body.appendChild(document.createElement('i'));
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 1;
        const g = canvas.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
        const out: Record<string, number[] | null> = {};
        for (const name of names) {
          if (!root.getPropertyValue(`--${name}`).trim()) {
            out[name] = null;
            continue;
          }
          probe.style.color = `var(--${name})`;
          g.clearRect(0, 0, 1, 1);
          g.fillStyle = getComputedStyle(probe).color;
          g.fillRect(0, 0, 1, 1);
          out[name] = [...g.getImageData(0, 0, 1, 1).data];
        }
        probe.remove();
        return out;
      }, tokens);
      if (colorScheme === 'light' && contrast === 'no-preference') {
        const missing = tokens.filter((name) => !colors[name]).map((name) => `--${name}`);
        if (missing.length) run.report.add('contrast-pairs', path, `tokens not defined ${list(missing)}`);
      }
      const where = `${path} (${colorScheme}${contrast === 'more' ? ', more contrast' : ''})`;
      for (const [fg, bg, need] of PAIRS) {
        const [a, b] = [colors[fg], colors[bg]];
        if (!a || !b) continue;
        const base = over(b, [255, 255, 255]);
        const ratio = contrastRatio(over(a, base), base);
        if (ratio < need)
          run.report.add('contrast-pairs', where, `--${fg} on --${bg} is ${ratio.toFixed(2)}:1, needs ${need}:1`);
      }
    }
  }
  await page.emulateMedia({ colorScheme: null, contrast: null });
}

/**
 * perf-image-oversize, run in the page: images whose delivered pixels exceed 1.5 × their rendered width × DPR,
 * unless they are already the smallest srcset candidate. For a `w` candidate, naturalWidth is scaled to the sizes
 * width, so the resource width comes from the descriptor.
 */
export function oversizedImages(): string[] {
  const oversized: string[] = [];
  for (const img of document.images) {
    if (!img.naturalWidth || !img.clientWidth) continue;
    const sets = [
      img,
      ...(img.parentElement?.tagName === 'PICTURE' ? img.parentElement.querySelectorAll('source') : []),
    ].map((s) =>
      (s.getAttribute('srcset') ?? '')
        .split(',')
        .map((c) => c.trim().split(/\s+/))
        .filter((c) => c[0])
        .map(([u = '', d = '1x']) => ({
          url: new URL(u, location.href).href,
          size: Number.parseFloat(d),
          unit: d.endsWith('w') ? 'w' : 'x',
        })),
    );
    const set = sets.find((s) => s.some((c) => c.url === img.currentSrc));
    const mine = set?.find((c) => c.url === img.currentSrc);
    const pixels = !mine ? img.naturalWidth : mine.unit === 'w' ? mine.size : img.naturalWidth * mine.size;
    if (pixels <= 1.5 * img.clientWidth * devicePixelRatio) continue;
    // The smallest candidate of the srcset that delivered currentSrc is as small as it gets.
    if (set && mine && mine.size <= Math.min(...set.map((c) => c.size))) continue;
    oversized.push(`${img.currentSrc.split('/').pop()} ${pixels}px for ${img.clientWidth}px at ${devicePixelRatio}x`);
  }
  return oversized;
}

/** perf-lcp-priority, perf-cls and perf-image-oversize under CDP throttling, at both viewports. */
async function perf(run: Run, pages: readonly DistPage[]): Promise<void> {
  for (const v of PERF_VIEWPORTS) {
    const context = await run.browser.newContext({ viewport: v.viewport, deviceScaleFactor: v.deviceScaleFactor });
    await context.addInitScript(PERF);
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: 150,
      downloadThroughput: 200_000,
      uploadThroughput: 75_000,
    });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    for (const p of pages) {
      const where = `${p.path} (${v.label})`;
      await step(run, 'perf-cls', where, async () => {
        await page.goto(new URL(p.path, run.origin).href, { waitUntil: 'load', timeout: 120_000 });
        await page.waitForTimeout(500);
        const lcp = await page.evaluate(() => {
          const e = window.__kitPerf.lcp;
          return e instanceof HTMLImageElement
            ? { src: e.currentSrc, priority: e.getAttribute('fetchpriority'), loading: e.getAttribute('loading') }
            : null;
        });
        if (lcp && (lcp.priority !== 'high' || lcp.loading === 'lazy')) {
          run.report.add(
            'perf-lcp-priority',
            where,
            `${lcp.src.split('/').pop()}: fetchpriority ${lcp.priority ?? 'unset'}, loading ${lcp.loading ?? 'unset'}`,
          );
        }
        await page.evaluate(async () => {
          const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));
          for (let y = 0; y < document.documentElement.scrollHeight; y += innerHeight / 2) {
            scrollTo(0, y);
            await wait(150);
          }
          const pending = [...document.images].filter((i) => !i.complete);
          await Promise.race([
            Promise.all(
              pending.map(
                (i) =>
                  new Promise((done) => i.addEventListener('loadend' in i ? 'loadend' : 'load', done, { once: true })),
              ),
            ),
            wait(10_000),
          ]);
          await wait(500);
        });
        const result = {
          cls: await page.evaluate(() => window.__kitPerf.cls),
          oversized: await page.evaluate(oversizedImages),
        };
        if (result.cls > 0.05) run.report.add('perf-cls', where, `CLS ${result.cls.toFixed(3)}`);
        for (const o of result.oversized) run.report.add('perf-image-oversize', where, o);
      });
    }
    await context.close();
  }
}

/** perf-bfcache: A → B → back restores A from the back/forward cache. */
async function bfcache(run: Run, pages: readonly DistPage[]): Promise<void> {
  const context = await run.browser.newContext({ viewport: DESKTOP });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Page.enable');
  let reasons: string[] = [];
  cdp.on('Page.backForwardCacheNotUsed', (e) => {
    reasons = e.notRestoredExplanations.map((x) => x.reason);
  });
  for (const p of pages) {
    await step(run, 'perf-bfcache', p.path, async () => {
      reasons = [];
      const a = new URL(p.path, run.origin).href;
      await page.goto(a);
      await page.evaluate(() =>
        addEventListener('pageshow', (e) => {
          window.__kitPersisted = e.persisted;
        }),
      );
      await page.goto(`${a}?kit-bfcache`);
      await page.goBack({ waitUntil: 'commit' });
      const restored = await page
        .waitForFunction(() => window.__kitPersisted === true, undefined, { timeout: 5_000 })
        .then(
          () => true,
          () => false,
        );
      if (!restored)
        run.report.add(
          'perf-bfcache',
          p.path,
          reasons.length ? `not restored: ${reasons.join(', ')}` : 'pageshow.persisted is not true',
        );
    });
  }
  await context.close();
}

/** A new context with the page helpers, so no cache or prerender state carries over. */
async function fresh(run: Run) {
  const context = await run.browser.newContext({ viewport: DESKTOP });
  await context.addInitScript(PAGE_HELPERS);
  return { context, page: await context.newPage() };
}

/** Hovers the first eligible same-origin link for 300 ms; returns its URL and a click that waits for the navigation. */
async function hoverLink(page: Page): Promise<{ href: string; click: () => Promise<unknown> } | undefined> {
  const href = await page.evaluate(() => {
    const a = [...document.querySelectorAll<HTMLAnchorElement>('header a[href], main a[href], footer a[href]')].find(
      (x) => {
        if (x.origin !== location.origin || x.pathname === location.pathname || x.pathname.startsWith('/api/'))
          return false;
        if (x.matches('[download], [hreflang], [target], [rel~=nofollow], [aria-current]') || !window.__kit.shown(x))
          return false;
        // Only a link the pointer can reach.
        x.scrollIntoView({ block: 'center' });
        const r = x.getBoundingClientRect();
        return x.contains(document.elementFromPoint(r.x + 2, r.y + 2));
      },
    );
    a?.setAttribute('data-kit-link', '');
    return a?.href ?? null;
  });
  if (!href) return undefined;
  const link = page.locator('[data-kit-link]');
  await link.hover();
  await page.waitForTimeout(300);
  return { href, click: () => Promise.all([page.waitForURL(href), link.click()]) };
}

/**
 * perf-prerender: a hovered link starts a prerender, and the click activates it. Chromium never activates a prerender
 * while DevTools is attached (PrerenderingDisabledByDevTools), so under Playwright the attempt is the proof and the
 * missing activation is a warning.
 */
async function prerender(run: Run, path: string): Promise<void> {
  const { context, page } = await fresh(run);
  const cdp = await context.newCDPSession(page);
  await cdp.send('Preload.enable');
  const rules: string[] = [];
  const attempts = new Map<string, string>();
  cdp.on('Preload.ruleSetUpdated', (e) => rules.push(e.ruleSet.errorType ?? 'ok'));
  cdp.on('Preload.prerenderStatusUpdated', (e) => attempts.set(e.key.url, e.prerenderStatus ?? e.status));
  try {
    await page.goto(new URL(path, run.origin).href);
    const link = await hoverLink(page);
    if (!link) {
      run.warnings.push(`perf-prerender ${path}: no eligible link to hover`);
      return;
    }
    await link.click();
    const start = await page.evaluate(
      () =>
        (performance.getEntriesByType('navigation')[0] as { activationStart?: number } | undefined)?.activationStart ??
        0,
    );
    const attempt = attempts.get(link.href);
    if (start > 0) return;
    if (!rules.includes('ok'))
      run.report.add(
        'perf-prerender',
        path,
        rules.length ? `speculation rules rejected: ${rules.join(', ')}` : 'no speculation rules were loaded',
      );
    else if (!attempt) run.report.add('perf-prerender', path, `hovering ${link.href} started no prerender`);
    else if (attempt === 'PrerenderingDisabledByDevTools')
      run.warnings.push(
        `perf-prerender ${path}: the hover started a prerender; Chromium does not activate it under DevTools, so activationStart is unverified`,
      );
    else run.report.add('perf-prerender', path, `the prerender of ${link.href} ended with ${attempt}`);
  } finally {
    await context.close();
  }
}

/** perf-prefetch: a hovered link is fetched, and the click reuses it (transferSize 0). */
async function prefetch(run: Run, path: string): Promise<void> {
  const { context, page } = await fresh(run);
  const seen: string[] = [];
  page.on('request', (r) => seen.push(r.url()));
  try {
    await page.goto(new URL(path, run.origin).href);
    seen.length = 0;
    const link = await hoverLink(page);
    if (!link) {
      run.warnings.push(`perf-prefetch ${path}: no eligible link to hover`);
      return;
    }
    const target = link.href.split('#')[0] ?? '';
    const prefetched = seen.includes(target);
    await link.click();
    const size = await page.evaluate(
      () =>
        (performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined)?.transferSize ?? -1,
    );
    if (!prefetched) run.report.add('perf-prefetch', path, `${target} was not prefetched on hover`);
    else if (size !== 0)
      run.report.add('perf-prefetch', path, `the click fetched ${target} again (transferSize ${size})`);
  } finally {
    await context.close();
  }
}

export async function runBrowserTests(opts: { root: string; all?: boolean; outline?: string }): Promise<Report> {
  const report = new Report();
  const options = loadOptions(opts.root, report);
  if (!options) return report;
  const dist = distDir(opts.root);
  const external = opts.outline !== undefined && /^https?:\/\//.test(opts.outline);
  if (!external && !existsSync(join(dist, 'index.html')))
    throw new Error('astro-kit test: no built site in dist/; run `npx --no astro-kit build` first');
  const all = external ? [] : distPages(dist, options);
  const contact = Object.fromEntries(all.filter((p) => p.contact).map((p) => [p.locale, p.path]));
  const server = external ? undefined : await serveDist(dist, options.features.forms ? { contact } : {});
  const executablePath = chromePath();
  let browser: Browser | undefined;
  try {
    // Inside the try: a failed launch must still close the server, or the process never exits.
    browser = await chromium.launch({
      ...(executablePath ? { executablePath } : {}),
      // bfcache must be possible; Playwright disables it by default.
      ignoreDefaultArgs: ['--disable-back-forward-cache'],
      timeout: 60_000,
    });
    if (opts.outline !== undefined) {
      const page = await browser.newPage();
      await page.goto(external ? opts.outline : new URL(opts.outline, server?.origin).href);
      console.log(await page.locator('body').ariaSnapshot());
      return report;
    }
    const run: Run = { browser, origin: server?.origin ?? '', report, options, warnings: [] };
    const pages = pickPages(all, opts.all === true);
    const sample = pickPages(all, false);
    console.log(`astro-kit test: ${pages.length} of ${all.length} pages, perf on ${sample.length}`);
    const axeSource = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');

    const { page } = await fresh(run);
    const plain = await (await browser.newContext({ viewport: DESKTOP, javaScriptEnabled: false })).newPage();
    for (const p of pages) {
      await step(run, 'a11y-axe', p.path, () => axe(run, page, p.path, axeSource));
      await step(run, 'a11y-focus', p.path, async () => {
        await open(run, page, p.path);
        await checkFocus(page, p.path, report);
      });
      await step(run, 'a11y-keyboard', p.path, () => keyboard(run, page, p.path));
      await step(run, 'a11y-targets', p.path, () => targets(run, page, p.path));
      await step(run, 'a11y-reflow', p.path, () => reflow(run, page, p.path));
      await step(run, 'a11y-spacing', p.path, () => spacing(run, page, p.path));
      await step(run, 'a11y-forced-colors', p.path, () => forcedColors(run, page, p.path));
      await step(run, 'a11y-no-js', p.path, () => noJs(run, plain, p));
    }
    const home = sample[0];
    if (home) await step(run, 'contrast-pairs', home.path, () => contrastPairs(run, page, home.path));
    await perf(run, sample);
    await bfcache(run, sample);
    if (home && options.prefetch.speculationRules)
      await step(run, 'perf-prerender', home.path, () => prerender(run, home.path));
    else if (home && options.prefetch.astroPrefetch)
      await step(run, 'perf-prefetch', home.path, () => prefetch(run, home.path));
    for (const w of run.warnings) console.warn(`astro-kit test: warning ${w}`);
    return report;
  } finally {
    await browser?.close();
    await server?.close();
  }
}

/**
 * The color rules of the browser stage (specification, section 8): `a11y-axe`, `contrast-pairs` and
 * `modes-behavior`. Each one reads the page in every declared theme, or in every mode state, and measures colors
 * only through the Colors probe of the harness: a color is painted on a 1×1 canvas (`pixel`), composited with
 * `over` and compared with `contrast`, the one WCAG luminance formula of the kit. No rule compares the computed text
 * of a color.
 *
 * - `a11y-axe` runs axe-core from the kit's own dependency, injected into the page with `evaluate`: the page CSP
 *   does not apply to it, and axe works under the kit's CSP with Trusted Types on (13.1 item 67). It reads 1280×800
 *   in every theme and 390×844 after the reveal step, checks links without underline in running text, and reports
 *   each animation that never ends.
 * - `contrast-pairs` reads each pair of `docs/design.md` from a probe element on the default home.
 * - `modes-behavior` clicks through the mode switch of the default home and compares every color token with its
 *   design value in each emulated system state.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { AxeResults, NodeResult, RunOptions } from 'axe-core';
import type { BrowserContext, JSHandle, Page } from 'playwright-core';
import type { ContrastPair, Design } from '../context.ts';
import { colorValue, modeScheme } from '../design/tokens.ts';
import {
  defaultMode,
  enabledModes,
  type ModeOption,
  SYSTEM_STATES,
  type SystemState,
  type Theme,
  themeOf,
} from '../modes.ts';
import {
  ACTION_LIMIT_MS,
  applyTheme,
  type BrowserRule,
  type Check,
  DESKTOP,
  finishNow,
  NARROW,
  type Pixel,
  reveal,
  samePixel,
  settle,
  sizeText,
  type ThemeState,
  themeStates,
  type Viewport,
} from './harness.ts';
import { INLINE_ELEMENTS } from './layout.ts';

declare global {
  interface Window {
    /** axe-core, once `a11y-axe` injected it. `setup` and `teardown` let the kit call `commons` after a run. */
    axe?: {
      run(context: Document, options: RunOptions): Promise<AxeResults>;
      setup(context: Document): unknown;
      teardown(): void;
      commons: { color: { getBackgroundStack(element: Element): Element[] | null } };
    };
    /** What the init script of `modes-behavior` saw when `data-mode` appeared on `html`. */
    __astroKitMode?: ModeWatch;
  }
}

// Shared

/** The text of a theme state in a finding: `1280×800 in the dark theme`. */
const themeLabel = (viewport: Viewport, state: ThemeState | undefined): string =>
  state === undefined ? sizeText(viewport) : `${sizeText(viewport)} in the ${state.theme} theme`;

/** A ratio in a finding: rounded down to two decimals, so a failing ratio never reads as the floor. */
export const ratioText = (ratio: number): string => (Math.floor(ratio * 100) / 100).toFixed(2);

/** The four channels of a painted color in a finding: `[43, 37, 33, 255]`; `no color` for a text that is none. */
export const pixelText = (pixel: Pixel): string => (pixel.length === 4 ? `[${pixel.join(', ')}]` : 'no color');

/** The fixed detail of a page that writes `data-mode` while a rule measures it. */
export const MODE_WRITE = 'the page changes data-mode by itself';

/**
 * The theme states of a check: the Themes walk (section 8, the harness) over the declared themes. Without a
 * design (a unit test that gives none) the check runs once, in the state of a fresh tab.
 */
function statesOf(check: Check): (ThemeState | undefined)[] {
  const states = themeStates(check.run.options, check.run.design?.themes ?? []);
  return states.length > 0 ? states : [undefined];
}

/** The writes of `data-mode` that the page made by itself since the last look (`modeWrites` of the harness). */
const modeWrites = (tab: Page): Promise<number> => tab.evaluate(() => window.__astroKit.modeWrites());

/**
 * How long the watch of `data-mode` runs at least before a check gives its verdict, from the `load` event: a page
 * script that writes `data-mode` at least once in this time is always seen, however fast the check measures.
 */
export const MODE_WATCH_MS = 1_000;

/** The writes since the last look, after the watch has run for `MODE_WATCH_MS` (the last look of a check). */
async function finalModeWrites(tab: Page): Promise<number> {
  const age = await tab.evaluate(() => window.__astroKit.modeAge());
  if (age < MODE_WATCH_MS) await tab.waitForTimeout(MODE_WATCH_MS - age);
  return modeWrites(tab);
}

/**
 * Groups equal details of one rule on one page, in the order of their first one: a detail that comes `n` times
 * reads `<detail> (and <n - 1> more nodes)`, or `(and 1 more node)`.
 */
export function grouped(details: readonly string[]): string[] {
  const counts = new Map<string, number>();
  for (const detail of details) counts.set(detail, (counts.get(detail) ?? 0) + 1);
  const more = (count: number): string => (count === 2 ? ' (and 1 more node)' : ` (and ${count - 1} more nodes)`);
  return [...counts].map(([detail, count]) => (count > 1 ? `${detail}${more(count)}` : detail));
}

// a11y-axe

/** The axe tags of `a11y-axe`, in the order of section 8. */
export const AXE_TAGS: readonly string[] = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];

/** The AAA contrast rule of axe that also runs. A violation counts only on running text. */
export const AXE_ENHANCED = 'color-contrast-enhanced';

/** The reasons of a "needs review" `color-contrast` result that fail. */
export const AXE_REVIEW_FAILS: readonly string[] = ['bgImage', 'imgNode', 'pseudoContent'];

/** The reason of a "needs review" `color-contrast` result that the harness decides with the gradient stops. */
export const AXE_GRADIENT = 'bgGradient';

/** Running text for `color-contrast-enhanced`: inside `main`, in one of these, and not inside an interactive one. */
export const RUNNING_TEXT = 'p, li, dd, td, th, blockquote, figcaption';
export const NOT_RUNNING_TEXT = 'a, button, label, summary';

/** The least contrast of a link without underline in running text against the text around it (WCAG 1.4.1). */
export const LINK_CONTRAST = 3;

/** What the page code of `a11y-axe` gets. */
interface AxeArgument {
  options: RunOptions;
  enhanced: string;
  reviewFails: readonly string[];
  gradient: string;
  running: string;
  notRunning: string;
  /** The inline elements of `a11y-targets`; empty: no link check in this state. */
  inlineNames: readonly string[];
  linkContrast: number;
}

/** One failing node of axe or of the link check: a key for the node and the rule, and the text of the finding. */
interface AxeHit {
  key: string;
  text: string;
}

let axeSource: string | undefined;

/** The source of `axe-core/axe.min.js` of the kit's dependency (2.1), read once. */
export function axeScript(): string {
  axeSource ??= readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
  return axeSource;
}

/** The options of the axe run: the tags of section 8, and the AAA contrast rule on top of them. */
export const AXE_OPTIONS: RunOptions = {
  runOnly: { type: 'tag', values: [...AXE_TAGS] },
  rules: { [AXE_ENHANCED]: { enabled: true } },
  resultTypes: ['violations', 'incomplete'],
  elementRef: true,
};

/**
 * Page code: runs axe on the document and gives the failing nodes. A violation fails, except one of
 * `color-contrast-enhanced` outside running text. A "needs review" result fails for `video-caption`, and for
 * `color-contrast` with a reason of `reviewFails`. For `color-contrast` with the reason `bgGradient` the kit decides
 * with the color stops of the gradient (section 8, `a11y-axe`). With `inlineNames`, it also checks each link without
 * underline in running text against the color of that text.
 */
async function runAxe(arg: AxeArgument): Promise<AxeHit[]> {
  const kit = window.__astroKit;
  const axe = window.axe;
  if (axe === undefined) throw new Error('axe-core is not in the page');
  const results = await axe.run(document, arg.options);
  const hits: AxeHit[] = [];
  const white = [255, 255, 255, 255];
  const nameOf = (node: NodeResult): string =>
    node.element ? kit.describe(node.element) : node.target.flat(2).join(' ');
  const add = (rule: string, node: NodeResult, text: string): void => {
    hits.push({ key: `${rule} ${JSON.stringify(node.target)}`, text });
  };
  const rgb = (color: readonly number[]): string => `rgb(${color[0]}, ${color[1]}, ${color[2]})`;
  const shown = (ratio: number): string => (Math.floor(ratio * 100) / 100).toFixed(2);
  const up = (from: Element): Element | null => {
    if (from.assignedSlot) return from.assignedSlot;
    if (from.parentElement) return from.parentElement;
    const root = from.getRootNode();
    return root instanceof ShadowRoot ? root.host : null;
  };
  // `closest` stops at a shadow root, so running text inside a component in `main` is found through the flat tree.
  const within = (element: Element, selector: string): boolean => {
    for (let node: Element | null = element; node !== null; node = up(node)) if (node.matches(selector)) return true;
    return false;
  };
  const running = (element: Element): boolean =>
    within(element, 'main') && within(element, arg.running) && !within(element, arg.notRunning);
  // The layers composited from the nearest to the farthest, until one is opaque, then over white.
  const flatten = (elements: Iterable<Element>): number[] => {
    const layers: number[][] = [];
    for (const element of elements) {
      const color = kit.pixel(getComputedStyle(element).backgroundColor);
      if (color.length === 4 && (color[3] ?? 0) > 0) layers.push(color);
      if (color[3] === 255) break;
    }
    let result = white;
    for (const layer of layers.reverse()) result = kit.over(layer, result);
    return result;
  };
  function* ancestors(from: Element): Generator<Element> {
    for (let node = up(from); node !== null; node = up(node)) yield node;
  }
  // The parts of a text at the top level of its brackets, cut at each character that `cut` accepts.
  const split = (text: string, cut: (char: string) => boolean): string[] => {
    const parts: string[] = [];
    let depth = 0;
    let start = 0;
    for (let at = 0; at < text.length; at += 1) {
      const char = text[at] ?? '';
      if (char === '(') depth += 1;
      else if (char === ')') depth = Math.max(0, depth - 1);
      else if (depth === 0 && cut(char)) {
        parts.push(text.slice(start, at));
        start = at + 1;
      }
    }
    parts.push(text.slice(start));
    return parts.map((part) => part.trim()).filter((part) => part !== '');
  };
  // The color stops of each gradient layer of a `background-image`, from the top layer down. An image layer
  // (`url()`) has no stops that the kit can read, so it is left out.
  const layersOf = (image: string): string[][] => {
    const layers: string[][] = [];
    for (const layer of split(image, (char) => char === ',')) {
      const inner = /^(?:repeating-)?(?:linear|radial|conic)-gradient\((.*)\)$/s.exec(layer)?.[1];
      if (inner === undefined) continue;
      const stops: string[] = [];
      for (const part of split(inner, (char) => char === ',')) {
        for (const word of split(part, (char) => /\s/.test(char))) if (CSS.supports('color', word)) stops.push(word);
      }
      if (stops.length > 0) layers.push(stops);
    }
    return layers;
  };
  // The colors that the layers can paint over `under`. An opaque stop hides the layers below it; a stop with alpha
  // is composited over each color that the layers below can paint. At most `PAINT_LIMIT` colors are kept.
  const PAINT_LIMIT = 256;
  const paintedBy = (layers: readonly string[][], under: number[]): number[][] => {
    const [top, ...rest] = layers;
    if (top === undefined) return [under];
    const below = paintedBy(rest, under);
    const colors: number[][] = [];
    for (const stop of top) {
      const color = kit.pixel(stop);
      if (color[3] === 255) colors.push(color);
      else for (const back of below) colors.push(kit.over(color, back));
      if (colors.length >= PAINT_LIMIT) break;
    }
    return colors.slice(0, PAINT_LIMIT);
  };
  // The colors that a stack of elements can paint, from the top element down, over white: each element paints its
  // background color, then its gradient layers, over the colors below it. The walk ends at the first element that
  // paints an opaque color with no gradient over it.
  const backdrops = (elements: readonly Element[]): number[][] => {
    const [top, ...rest] = elements;
    if (top === undefined) return [white];
    const style = getComputedStyle(top);
    const color = kit.pixel(style.backgroundColor);
    const layers = style.backgroundImage === 'none' ? [] : layersOf(style.backgroundImage);
    const opaque = color.length === 4 && color[3] === 255;
    const lower = opaque ? [white] : backdrops(rest);
    const based = lower.map((back) => (color.length === 4 && (color[3] ?? 0) > 0 ? kit.over(color, back) : back));
    return (layers.length === 0 ? based : based.flatMap((back) => paintedBy(layers, back))).slice(0, PAINT_LIMIT);
  };
  const dataOf = (node: NodeResult): { reason: string; expected: number } => {
    for (const result of [...node.any, ...node.all, ...node.none]) {
      const data: unknown = result.data;
      if (typeof data !== 'object' || data === null || !('messageKey' in data)) continue;
      const reason = typeof data.messageKey === 'string' ? data.messageKey : '';
      const ratio = 'expectedContrastRatio' in data ? String(data.expectedContrastRatio) : '';
      return { reason, expected: Number.parseFloat(ratio) };
    }
    return { reason: '', expected: Number.NaN };
  };
  // The visual stack behind a text as axe reads it, from the top; the flat-tree ancestors when axe gives none.
  const stackOf = (element: Element): Element[] => {
    let stack: Element[] | null = null;
    try {
      stack = axe.commons.color.getBackgroundStack(element);
    } catch {
      stack = null;
    }
    return stack !== null && stack.length > 0 ? stack : [element, ...ancestors(element)];
  };
  // The worst stop of the gradient behind a text: its ratio and the color behind the text there. `null`: no stop.
  const worstStop = (element: Element): { ratio: number; behind: number[] } | null => {
    const stack = stackOf(element);
    const at = stack.findIndex((layer) => getComputedStyle(layer).backgroundImage !== 'none');
    const holder = stack[at];
    if (holder === undefined) return null;
    const style = getComputedStyle(holder);
    const layers = layersOf(style.backgroundImage);
    if (layers.length === 0) return null;
    // The colors behind the gradient: the elements below the holder in the stack, their gradients included, then
    // white. Each lower element paints its background color, then its gradient layers, over what lies below it.
    const belowAll = backdrops(stack.slice(at + 1));
    const below = belowAll[0] ?? white;
    // With `background-clip: text` the gradient paints the text itself, and its background color too is clipped.
    const clipText = style.backgroundClip === 'text';
    const unders = belowAll.map((back) => (clipText ? back : kit.over(kit.pixel(style.backgroundColor), back)));
    const text = kit.pixel(getComputedStyle(element).color);
    // The background colors between the holder and the text lie over the gradient: from the holder up to the text.
    const above = clipText ? [] : stack.slice(0, at).reverse();
    let worst: { ratio: number; behind: number[] } | null = null;
    for (const painted of unders.flatMap((under) => paintedBy(layers, under)).slice(0, PAINT_LIMIT)) {
      let seen = painted;
      for (const layer of above) {
        const color = kit.pixel(getComputedStyle(layer).backgroundColor);
        if (color.length === 4 && (color[3] ?? 0) > 0) seen = kit.over(color, seen);
      }
      const behind = clipText ? below : seen;
      const ratio = kit.contrast(kit.over(text, clipText ? painted : seen), behind);
      if (worst === null || ratio < worst.ratio) worst = { ratio, behind: seen };
    }
    return worst;
  };
  for (const rule of results.violations) {
    for (const node of rule.nodes) {
      if (rule.id === arg.enhanced && (node.element === undefined || !running(node.element))) continue;
      add(rule.id, node, `${rule.id} on ${nameOf(node)}`);
    }
  }
  const gradients = results.incomplete
    .filter((rule) => rule.id === 'color-contrast')
    .flatMap((rule) => rule.nodes)
    .filter((node) => dataOf(node).reason === arg.gradient);
  // `commons` needs the tree of axe, which `axe.run` removes when it ends.
  let ready = false;
  if (gradients.length > 0) {
    try {
      axe.setup(document);
      ready = true;
    } catch {
      ready = false;
    }
  }
  try {
    for (const rule of results.incomplete) {
      for (const node of rule.nodes) {
        if (rule.id === 'video-caption') add(rule.id, node, `video-caption needs review on ${nameOf(node)}`);
        if (rule.id !== 'color-contrast') continue;
        const { reason, expected } = dataOf(node);
        if (arg.reviewFails.includes(reason)) {
          add(rule.id, node, `color-contrast needs review (${reason}) on ${nameOf(node)}`);
          continue;
        }
        if (reason !== arg.gradient || !node.element) continue;
        const worst = worstStop(node.element);
        if (worst === null) {
          add(rule.id, node, `color-contrast on ${nameOf(node)}: no color stop of a gradient lies behind it`);
          continue;
        }
        const least = Number.isFinite(expected) ? expected : 4.5;
        const where = `${shown(worst.ratio)}:1 on the gradient stop ${rgb(worst.behind)}`;
        if (worst.ratio < least) add(rule.id, node, `color-contrast on ${nameOf(node)}: ${where}, ${least}:1 expected`);
        // The AAA floor on running text, as on a flat color: 7:1, and 4.5:1 for large text (AA 3:1).
        const enhanced = least <= 3 ? 4.5 : 7;
        if (running(node.element) && worst.ratio < enhanced) {
          add(arg.enhanced, node, `${arg.enhanced} on ${nameOf(node)}: ${where}, ${enhanced}:1 expected`);
        }
      }
    }
  } finally {
    if (ready) axe.teardown();
  }
  // A link without underline in running text: its color against the color of the text it stands in.
  const inlineElements = new Set(arg.inlineNames);
  const word = /[\p{L}\p{N}]/u;
  // The ancestor that holds the text around a link: from its parent through the inline elements (a11y-targets).
  // A link is underlined when each of its text nodes has an element with a text decoration line between it and
  // the link, the link included: an underline on a `span` inside the link counts.
  // A text node that the page renders: it holds a letter or a digit, and its element is visible. Hidden text
  // (`hidden`, `display: none`, `visibility: hidden`) does not count, as for axe.
  const rendered = (node: Node): boolean =>
    word.test(node.textContent ?? '') && node.parentElement?.checkVisibility({ visibilityProperty: true }) === true;
  const underlined = (link: Element): boolean => {
    const walker = document.createTreeWalker(link, NodeFilter.SHOW_TEXT);
    let texts = 0;
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      if (!rendered(node)) continue;
      texts += 1;
      let marked = false;
      for (let element = node.parentElement; element !== null; element = element.parentElement) {
        if (getComputedStyle(element).textDecorationLine !== 'none') marked = true;
        if (marked || element === link) break;
      }
      if (!marked) return false;
    }
    return texts > 0 || getComputedStyle(link).textDecorationLine !== 'none';
  };
  // The parent of a node, across the top of a shadow tree to its host.
  const parentOf = (node: Element): Element | null => {
    if (node.parentElement) return node.parentElement;
    const root = node.getRootNode();
    return root instanceof ShadowRoot ? root.host : null;
  };
  const textAround = (link: Element): Element | null => {
    for (let node = parentOf(link); node !== null; node = parentOf(node)) {
      for (const child of node.childNodes) {
        if (child.nodeType === Node.TEXT_NODE && word.test(child.textContent ?? '')) return node;
      }
      if (!inlineElements.has(node.localName)) return null;
    }
    return null;
  };
  if (inlineElements.size > 0) {
    // The links of the document and of every open shadow root in it.
    const links: Element[] = [];
    const collect = (root: Document | ShadowRoot): void => {
      for (const element of root.querySelectorAll('*')) {
        if (element.matches('a[href]')) links.push(element);
        if (element.shadowRoot) collect(element.shadowRoot);
      }
    };
    collect(document);
    for (const [index, link] of links.entries()) {
      if (underlined(link) || !kit.visible(link)) continue;
      const around = textAround(link);
      if (around === null) continue;
      const behind = flatten([link, ...ancestors(link)]);
      const text = kit.over(kit.pixel(getComputedStyle(around).color), behind);
      // The color of the link is the color of the elements that hold its text; the worst one counts.
      const holders = new Set<Element>();
      const walker = document.createTreeWalker(link, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
        if (rendered(node) && node.parentElement !== null) holders.add(node.parentElement);
      }
      // A link that renders no text (an image alone) has no text color to tell it apart: axe judges its image.
      if (holders.size === 0) continue;
      let own = text;
      let ratio = Number.POSITIVE_INFINITY;
      for (const holder of holders) {
        const color = kit.over(kit.pixel(getComputedStyle(holder).color), behind);
        const each = kit.contrast(color, text);
        if (each < ratio) {
          ratio = each;
          own = color;
        }
      }
      if (ratio >= arg.linkContrast) continue;
      hits.push({
        key: `link-in-text-block ${index}`,
        text:
          `link-in-text-block on ${kit.describe(link)} without underline: ${rgb(own)} against the text ${rgb(text)} ` +
          `is ${shown(ratio)}:1, ${arg.linkContrast}:1 expected`,
      });
    }
  }
  return hits;
}

/**
 * One axe run in a state, bounded by `ACTION_LIMIT_MS`: a page that runs no timer (a `sandbox` CSP without
 * `allow-scripts`) never lets `axe.run` end. `null` when the run did not end; axe is then injected again, so the next
 * run does not meet the one that still waits.
 */
async function axeOnce(tab: Page, argument: AxeArgument): Promise<AxeHit[] | null> {
  const run = tab.evaluate(runAxe, argument);
  // The run that loses the race ends when the tab closes; its rejection is no error of the check.
  run.catch(() => undefined);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<null>((done) => {
    timer = setTimeout(() => done(null), ACTION_LIMIT_MS);
  });
  try {
    const hits = await Promise.race([run, limit]);
    if (hits === null) await tab.evaluate(axeScript());
    return hits;
  } finally {
    clearTimeout(timer);
  }
}

/** The text of `ACTION_LIMIT_MS` in a finding: `15 s`. */
const limitText = `${ACTION_LIMIT_MS / 1000} s`;

/**
 * `a11y-axe`: no axe violation with the tags of section 8. The first pass reads a fresh tab at 1280×800 in every
 * declared theme, with the link check. The second pass reads a fresh tab at 390×844 in its own theme, after the
 * reveal step and with each of its dialogs open. A node fails once for each axe rule, in the first state that shows
 * it; equal details are grouped. Then each animation that never ends fails once (WCAG 2.2.2). A page that writes
 * `data-mode` by itself gives one fixed finding instead, so its result cannot change from run to run.
 */
export const axeRule: BrowserRule = {
  id: 'a11y-axe',
  pages: 'tested',
  concurrent: true,
  check: async (check) => {
    const argument: AxeArgument = {
      options: AXE_OPTIONS,
      enhanced: AXE_ENHANCED,
      reviewFails: AXE_REVIEW_FAILS,
      gradient: AXE_GRADIENT,
      running: RUNNING_TEXT,
      notRunning: NOT_RUNNING_TEXT,
      inlineNames: INLINE_ELEMENTS,
      linkContrast: LINK_CONTRAST,
    };
    const seen = new Set<string>();
    const details: string[] = [];
    const endless = new Set<string>();
    let written: string | undefined;
    // One axe run in a state; `false` when the page wrote `data-mode` by itself, so the check stops.
    const measure = async (tab: Page, viewport: Viewport, label: string, links: boolean): Promise<boolean> => {
      if ((await modeWrites(tab)) > 0) written ??= sizeText(viewport);
      const hits = await axeOnce(tab, links ? argument : { ...argument, inlineNames: [] });
      if ((await modeWrites(tab)) > 0) written ??= sizeText(viewport);
      if (written !== undefined) return false;
      if (hits === null) details.push(`${label}: axe did not finish within ${limitText}`);
      for (const hit of hits ?? []) {
        if (seen.has(hit.key)) continue;
        seen.add(hit.key);
        details.push(`${label}: ${hit.text}`);
      }
      return true;
    };
    const animations = async (tab: Page, viewport: Viewport): Promise<void> => {
      const found = await tab.evaluate(() =>
        window.__astroKit.endless.map(({ element, name }) => ({
          element: element === null ? 'the document' : window.__astroKit.describe(element),
          name,
        })),
      );
      for (const { element, name } of found) {
        const text = `the animation ${JSON.stringify(name)} on ${element} never ends`;
        if (endless.has(text)) continue;
        endless.add(text);
        details.push(`${sizeText(viewport)}: ${text} (WCAG 2.2.2)`);
      }
    };
    const wide = await check.open({ viewport: DESKTOP });
    await wide.evaluate(axeScript());
    let going = true;
    for (const state of statesOf(check)) {
      if (state !== undefined) await applyTheme(wide, state);
      going = await measure(wide, DESKTOP, themeLabel(DESKTOP, state), true);
      if (!going) break;
    }
    if (going && (await finalModeWrites(wide)) > 0) {
      written ??= sizeText(DESKTOP);
      going = false;
    }
    if (going) {
      await animations(wide, DESKTOP);
      const narrow = await check.open({ viewport: NARROW });
      await narrow.evaluate(axeScript());
      await reveal(narrow, async (state) => {
        if (going) going = await measure(narrow, NARROW, state.label, false);
      });
      if (going && (await finalModeWrites(narrow)) > 0) {
        written ??= sizeText(NARROW);
        going = false;
      }
      if (going) await animations(narrow, NARROW);
    }
    if (written !== undefined) {
      check.report(`${written}: ${MODE_WRITE}`);
      return;
    }
    for (const detail of grouped(details)) check.report(detail);
  },
};

// contrast-pairs

/** The ratio that each role of a contrast pair needs (7.4). */
export const ROLE_RATIOS: ReadonlyMap<string, number> = new Map([
  ['text', 7],
  ['ui', 4.5],
  ['non-text', 3],
]);

/** What `pairRatios` reads: the tokens of each pair, and the page background (the background of the `body` pair). */
interface PairRead {
  pairs: readonly { foreground: string; background: string }[];
  page: string | undefined;
}

/**
 * Page code: the contrast of each pair. A fresh probe takes the foreground as `color` and the background as
 * `background-color`; both computed colors are painted. A background with alpha is composited over the page
 * background of the theme, and that over white; the foreground over the result.
 */
function pairRatios(read: PairRead): number[] {
  const kit = window.__astroKit;
  // A fresh probe for each read, which no transition or animation of the page reaches, each property `!important`.
  const paint = (properties: readonly (readonly [string, string])[]): { color: string; background: string } => {
    const probe = document.createElement('span');
    probe.style.setProperty('transition', 'none', 'important');
    probe.style.setProperty('animation', 'none', 'important');
    for (const [name, value] of properties) probe.style.setProperty(name, value, 'important');
    document.body.append(probe);
    try {
      const style = getComputedStyle(probe);
      return { color: style.color, background: style.backgroundColor };
    } finally {
      probe.remove();
    }
  };
  const white = [255, 255, 255, 255];
  const page =
    read.page === undefined
      ? white
      : kit.over(kit.pixel(paint([['background-color', `var(${read.page})`]]).background), white);
  return read.pairs.map((pair) => {
    const style = paint([
      ['color', `var(${pair.foreground})`],
      ['background-color', `var(${pair.background})`],
    ]);
    const behind = kit.over(kit.pixel(style.background), pair.background === read.page ? white : page);
    return kit.contrast(kit.over(kit.pixel(style.color), behind), behind);
  });
}

/** `contrast-pairs`: on the default home, in every declared theme, each pair of `docs/design.md` meets its role. */
export const contrastPairs: BrowserRule = {
  id: 'contrast-pairs',
  pages: 'home',
  check: async (check) => {
    const all = check.run.design?.pairs ?? [];
    const pairs: ContrastPair[] = all.filter((pair) => ROLE_RATIOS.has(pair.role));
    if (pairs.length === 0) return;
    const tab = await check.open({ viewport: DESKTOP });
    const read: PairRead = {
      pairs: pairs.map((pair) => ({ foreground: pair.foreground, background: pair.background })),
      page: all.find((pair) => pair.for === 'body')?.background,
    };
    const details: string[] = [];
    for (const state of statesOf(check)) {
      if (state !== undefined) await applyTheme(tab, state);
      const ratios = await tab.evaluate(pairRatios, read);
      if ((await modeWrites(tab)) > 0) {
        check.report(`${sizeText(DESKTOP)}: ${MODE_WRITE}`);
        return;
      }
      for (const [index, pair] of pairs.entries()) {
        const ratio = ratios[index] ?? 0;
        const least = ROLE_RATIOS.get(pair.role) ?? 0;
        if (ratio >= least) continue;
        const where = state === undefined ? 'the page' : `the ${state.theme} theme`;
        details.push(
          `${where}: ${pair.foreground} on ${pair.background} has ${ratioText(ratio)}:1; the role ${pair.role} ` +
            `needs ${least}:1 (docs/design.md, line ${pair.line})`,
        );
      }
    }
    if ((await finalModeWrites(tab)) > 0) {
      check.report(`${sizeText(DESKTOP)}: ${MODE_WRITE}`);
      return;
    }
    for (const detail of details) check.report(detail);
  },
};

// modes-behavior

/** What the init script of `modes-behavior` records: whether `data-mode` appeared, and whether `body` existed then. */
interface ModeWatch {
  appeared: boolean;
  body: boolean;
}

/**
 * Init script: records `document.body` when `data-mode` appears on `html`. A `MutationObserver` on `document`
 * runs its callback at the microtask checkpoint after the script that set the attribute, so a mode script in the
 * head is seen before the parser makes `body` (S15).
 */
function watchMode(): void {
  const seen: ModeWatch = { appeared: false, body: false };
  Object.defineProperty(window, '__astroKitMode', { value: seen, configurable: true });
  const observer = new MutationObserver(() => {
    if (seen.appeared || document.documentElement?.hasAttribute('data-mode') !== true) return;
    seen.appeared = true;
    seen.body = document.body !== null;
    observer.disconnect();
  });
  observer.observe(document, { attributes: true, attributeFilter: ['data-mode'], subtree: true });
}

/** A color token and the painted value that the design gives it in one theme. */
interface ExpectedColor {
  name: string;
  /** The design value with fallbacks and aliases resolved: a color text. */
  value: string;
}

/** What `readColors` gives: the computed `color-scheme` of `html`, and both paintings of each token. */
interface ColorReading {
  scheme: string;
  colors: { name: string; probe: number[]; reference: number[] }[];
}

/**
 * The design value of a color token in a theme (7.4 and 7.7): the cell with its fallback along the themes, and an
 * alias `var(--color-…)` replaced with the value of the token it names, in the same theme. `undefined` when no
 * value exists.
 */
export function designColor(design: Pick<Design, 'colors'>, name: string, theme: Theme): string | undefined {
  const byName = new Map(design.colors.map((color) => [color.name, color]));
  // A chain of aliases of any length is followed; a token met twice is a circle (`design-format` refuses it), and
  // the walk ends there, so hostile input stays finite.
  const seen = new Set<string>();
  let current = name;
  while (!seen.has(current)) {
    seen.add(current);
    const color = byName.get(current);
    const value = color === undefined ? undefined : colorValue(color, theme);
    if (value === undefined) return undefined;
    const alias = /^var\(\s*(--color-[A-Za-z0-9_-]+)\s*\)$/.exec(value)?.[1];
    if (alias === undefined) return value;
    current = alias;
  }
  return undefined;
}

/**
 * Page code: the computed `color-scheme` of `html`, and for each token the computed `background-color` of a probe
 * (`var(<token>)`) and of a reference painted with the design value, both painted on the canvas. Each read uses a
 * fresh element, which no transition or animation of the page reaches, with its color set as `!important`. A design
 * value that is no color gives an empty reference.
 */
function readColors(expected: readonly ExpectedColor[]): ColorReading {
  const kit = window.__astroKit;
  const paint = (value: string): number[] => {
    const probe = document.createElement('span');
    probe.style.setProperty('transition', 'none', 'important');
    probe.style.setProperty('animation', 'none', 'important');
    probe.style.setProperty('background-color', value, 'important');
    if (probe.style.getPropertyValue('background-color') === '') return [];
    document.body.append(probe);
    try {
      return kit.pixel(getComputedStyle(probe).backgroundColor);
    } finally {
      probe.remove();
    }
  };
  const colors = expected.map((color) => ({
    name: color.name,
    probe: paint(`var(${color.name})`),
    reference: paint(color.value),
  }));
  return { scheme: getComputedStyle(document.documentElement).colorScheme, colors };
}

/** The text of a system state in a finding: `system dark, contrast more`. */
const systemText = (state: SystemState): string => `system ${state.scheme}, contrast ${state.contrast}`;

/**
 * Emulates each system state and compares the probe of every color token with its design value in the theme that
 * `themeFor` gives, and, when `scheme` is given, the computed `color-scheme` of `html` with it.
 */
async function compareColors(
  report: (detail: string) => void,
  tab: Page,
  design: Design,
  label: string,
  themeFor: (state: SystemState) => Theme,
  scheme: string | undefined,
): Promise<void> {
  for (const state of SYSTEM_STATES) {
    await tab.emulateMedia({ colorScheme: state.scheme, contrast: state.contrast });
    await finishNow(tab);
    const theme = themeFor(state);
    const expected: ExpectedColor[] = design.colors.map((color) => ({
      name: color.name,
      value: designColor(design, color.name, theme) ?? '',
    }));
    const reading = await tab.evaluate(readColors, expected);
    const where = `${label}, ${systemText(state)}`;
    const shown = reading.scheme.replace(/\s+/g, ' ').trim();
    if (scheme !== undefined && shown !== scheme) {
      report(`${where}: html has color-scheme "${shown}", 7.7 expects "${scheme}"`);
    }
    for (const color of reading.colors) {
      if (samePixel(color.probe, color.reference)) continue;
      report(
        `${where}: ${color.name} paints ${pixelText(color.probe)}, the ${theme} value of docs/design.md ` +
          `paints ${pixelText(color.reference)}`,
      );
    }
  }
}

/** What `nextInvoker` gives: the native invoker to click, or a problem, or neither when the switch is open. */
interface InvokerStep {
  invoker: Element | null;
  problem: string | null;
  /** The closed elements around the switch, the switch included, before the click. */
  closed: number;
}

/**
 * Page code: the closed `details`, `dialog` and popover elements that hold the mode switch (or are it), outermost
 * first, and the native invoker of the outermost one. An element with the `popover` attribute is a popover, a
 * `dialog` too: it is closed when it does not match `:popover-open`, and a `[popovertarget]` whose action is not
 * `hide`, or a `[commandfor]` with `show-popover` or `toggle-popover`, opens it. Another `dialog` is closed when it
 * is not open, and a `[commandfor]` with `show-modal` opens it. A `details` opens through its first `summary`. Of the
 * invokers that open the element, the first visible one in document order is taken.
 */
function nextInvoker(): InvokerStep {
  const kit = window.__astroKit;
  const control = document.querySelector('[data-mode-switch]');
  if (control === null) return { invoker: null, problem: 'the page has no [data-mode-switch] element', closed: 0 };
  const isPopover = (node: Element): boolean => node instanceof HTMLElement && node.hasAttribute('popover');
  const closed: Element[] = [];
  for (let node: Element | null = control; node !== null; node = node.parentElement) {
    const shut =
      (node instanceof HTMLDetailsElement && !node.open) ||
      (isPopover(node) && !node.matches(':popover-open')) ||
      (!isPopover(node) && node instanceof HTMLDialogElement && !node.open);
    if (shut) closed.unshift(node);
  }
  const outer = closed[0];
  if (outer === undefined) return { invoker: null, problem: null, closed: 0 };
  const opening: Element[] = [];
  if (outer instanceof HTMLDetailsElement) {
    const summary = outer.querySelector(':scope > summary');
    if (summary !== null) opening.push(summary);
  } else {
    const popover = isPopover(outer);
    for (const candidate of document.querySelectorAll('[popovertarget], [commandfor]')) {
      if (!(candidate instanceof HTMLButtonElement || candidate instanceof HTMLInputElement)) continue;
      const command = (candidate.getAttribute('command') ?? '').toLowerCase();
      const target = candidate.hasAttribute('popovertarget') ? candidate.popoverTargetElement : null;
      const opens = popover
        ? (target === outer && candidate.popoverTargetAction !== 'hide') ||
          (candidate instanceof HTMLButtonElement &&
            candidate.commandForElement === outer &&
            (command === 'show-popover' || command === 'toggle-popover'))
        : candidate instanceof HTMLButtonElement && candidate.commandForElement === outer && command === 'show-modal';
      if (opens) opening.push(candidate);
    }
  }
  const name = kit.describe(outer);
  const first = opening[0];
  if (first === undefined) return { invoker: null, problem: `no native invoker opens ${name}`, closed: closed.length };
  // A disabled control (also one in a disabled fieldset) opens nothing, so the first visible enabled one counts.
  const shown = opening.filter((candidate) => kit.visible(candidate));
  const invoker = shown.find((candidate) => !candidate.matches(':disabled'));
  if (invoker === undefined) {
    const which = shown[0];
    const problem =
      which === undefined
        ? `${kit.describe(first)}, the invoker of ${name}, is not visible`
        : `${kit.describe(which)}, the invoker of ${name}, is disabled`;
    return { invoker: null, problem, closed: 0 };
  }
  return { invoker, problem: null, closed: closed.length };
}

/** The step of `nextInvoker` as plain data: the problem, the number of closed elements, the name of the invoker. */
function stepData(step: JSHandle<InvokerStep>): Promise<{ problem: string | null; closed: number; name: string }> {
  return step.evaluate((data) => ({
    problem: data.problem,
    closed: data.closed,
    name: data.invoker === null ? '' : window.__astroKit.describe(data.invoker),
  }));
}

/**
 * Opens the closed elements around the switch, outermost first, each with a click on its native invoker. Gives a
 * problem, or `null` when the switch is open. A click that leaves as many elements closed as before is a problem,
 * so the loop ends.
 */
async function openSwitch(tab: Page): Promise<string | null> {
  let before = Number.POSITIVE_INFINITY;
  let clicked = '';
  for (;;) {
    const step = await tab.evaluateHandle(nextInvoker);
    try {
      const data = await stepData(step);
      if (data.problem !== null) return data.problem;
      if (data.closed >= before) return `a click on ${clicked} opens nothing around the switch`;
      const invoker = (await step.getProperty('invoker')).asElement();
      if (invoker === null) return null;
      before = data.closed;
      clicked = data.name;
      await invoker.click();
      await finishNow(tab);
    } finally {
      await step.dispose();
    }
  }
}

/** Page code: the control of an option inside the switch: the label of its radio, or the select. */
function controlOf(option: string): { kind: 'label' | 'select' | 'none'; element: Element | null } {
  const root = document.querySelector('[data-mode-switch]');
  const select = root?.querySelector('select[name="mode"]') ?? null;
  if (select !== null) return { kind: 'select', element: select };
  const radio = [...(root?.querySelectorAll('input[type="radio"][name="mode"]') ?? [])].find(
    (input) => input instanceof HTMLInputElement && input.value === option,
  );
  const label = radio instanceof HTMLInputElement ? (radio.labels?.[0] ?? null) : null;
  return label === null ? { kind: 'none', element: null } : { kind: 'label', element: label };
}

/** Page code: `data-mode` of `html`, and whether the switch shows `option` (its radio checked, or its select value). */
function shownMode(option: string): { mode: string | null; shows: boolean } {
  const root = document.querySelector('[data-mode-switch]');
  const select = root?.querySelector('select[name="mode"]');
  const shows =
    select instanceof HTMLSelectElement
      ? select.value === option
      : [...(root?.querySelectorAll('input[type="radio"][name="mode"]') ?? [])].some(
          (input) => input instanceof HTMLInputElement && input.value === option && input.checked,
        );
  return { mode: document.documentElement.getAttribute('data-mode'), shows };
}

/**
 * Chooses an option: a click on the label of its radio, or `selectOption` on the select. Gives a problem, or
 * `null`.
 */
async function choose(tab: Page, option: ModeOption): Promise<string | null> {
  const found = await tab.evaluateHandle(controlOf, option);
  try {
    const kind = await found.evaluate((control) => control.kind);
    const element = (await found.getProperty('element')).asElement();
    if (kind === 'none' || element === null) return `the switch has no labeled radio for ${option}`;
    if (kind === 'select') await element.selectOption(option);
    else await element.click();
    await finishNow(tab);
    return null;
  } finally {
    await found.dispose();
  }
}

/**
 * The order in which `modes-behavior` chooses the options: the default mode `D` first, then the others in the
 * order of `enabled`. So the last choice is never `D`, and a page that ignores the stored choice cannot pass the
 * navigation and the reload by showing `D`.
 */
export function chooseOrder(enabled: readonly ModeOption[], fallback: ModeOption): ModeOption[] {
  return [...enabled.filter((mode) => mode === fallback), ...enabled.filter((mode) => mode !== fallback)];
}

/**
 * The other page of the navigation: the first page of the sample in path order that is neither the default home nor
 * the 404 page, else the 404 page. `undefined` when the sample holds no other page.
 */
function otherPage(check: Check): string | undefined {
  const others = check.run.sample.filter((page) => page.where !== check.page.where);
  return (others.find((page) => !page.is404) ?? others[0])?.path;
}

/**
 * The JavaScript part of `modes-behavior` at one viewport, in a context of its own (a fresh stored mode). It gives
 * its details; `MODE_WRITE` alone when the page wrote `data-mode` by itself, outside the clicks of the rule.
 */
async function withScripts(check: Check, viewport: Viewport, design: Design): Promise<string[]> {
  const options = check.run.options;
  const label = sizeText(viewport);
  const details: string[] = [];
  const report = (detail: string): void => {
    details.push(detail);
  };
  const context: BrowserContext = await check.context();
  await context.addInitScript(watchMode);
  const tab = await check.open({ viewport, context });
  // A write of `data-mode` since the last look that no click of the rule made. The watch runs from the load.
  const watch = async (): Promise<boolean> => (await modeWrites(tab)) > 0;
  const seen = await tab.evaluate(() => window.__astroKitMode ?? { appeared: false, body: false });
  if (!seen.appeared) report(`${label}: html gets no data-mode`);
  else if (seen.body) report(`${label}: data-mode appears on html only after body exists`);
  const fixed = (): string[] => [`${label}: ${MODE_WRITE}`];
  if (await watch()) return fixed();
  const closed = await openSwitch(tab);
  // The clicks on the invokers may write `data-mode`; the look after them starts a new count.
  await modeWrites(tab);
  if (closed !== null) {
    report(`${label}: ${closed}`);
    return details;
  }
  const visible = await tab.evaluate(() => {
    const control = document.querySelector('[data-mode-switch]');
    return control !== null && window.__astroKit.visible(control);
  });
  if (!visible) {
    report(`${label}: the mode switch is not visible`);
    return details;
  }
  const order = chooseOrder(enabledModes(options), defaultMode(options));
  for (const option of order) {
    if (await watch()) return fixed();
    const problem = await choose(tab, option);
    // The writes of the choice are the rule's own.
    await modeWrites(tab);
    if (problem !== null) {
      report(`${label}: ${problem}`);
      continue;
    }
    const { mode } = await tab.evaluate(shownMode, option);
    if (mode !== option) report(`${label}: after the choice of ${option}, html has data-mode ${JSON.stringify(mode)}`);
    const scheme = modeScheme(design, option);
    const themeFor = (state: SystemState): Theme => themeOf(option, state, design.themes);
    await compareColors(report, tab, design, `${label}, ${option} chosen`, themeFor, scheme);
  }
  if ((await finalModeWrites(tab)) > 0) return fixed();
  const last = order.at(-1);
  if (last === undefined) return details;
  const other = otherPage(check);
  const visits: { name: string; go: () => Promise<unknown> }[] = [
    ...(other === undefined
      ? []
      : [
          {
            name: `a navigation to ${other}`,
            go: () => tab.goto(`${check.run.origin}${other}`, { waitUntil: 'load' }),
          },
        ]),
    { name: 'a reload', go: () => tab.reload({ waitUntil: 'load' }) },
  ];
  for (const visit of visits) {
    await visit.go();
    await settle(tab);
    // A new document: its watch starts at its own load, after its mode script ran. The mode counts only once the
    // watch has run for `MODE_WATCH_MS`, so a script that resets it on a timer after the load is seen.
    if ((await finalModeWrites(tab)) > 0) return fixed();
    const shown: { mode: string | null; shows: boolean } = await tab.evaluate(shownMode, last);
    const { mode, shows } = shown;
    if (mode !== last) report(`${label}: after ${visit.name}, html has data-mode ${JSON.stringify(mode)}, not ${last}`);
    if (!shows) report(`${label}: after ${visit.name}, the switch does not show ${last}`);
  }
  return details;
}

/** The JavaScript-off part of `modes-behavior` at one viewport. */
async function withoutScripts(check: Check, viewport: Viewport, design: Design): Promise<void> {
  const label = `${sizeText(viewport)} with JS off`;
  const tab = await check.open({ viewport, javaScript: false });
  const shown = await tab.evaluate(() =>
    [...document.querySelectorAll('[name="mode"]')]
      .filter((element) => element.matches('input, select, textarea, button') && window.__astroKit.visible(element))
      .map((element) => window.__astroKit.describe(element)),
  );
  for (const name of shown) check.report(`${label}: the control ${name} is visible`);
  const fallback = defaultMode(check.run.options);
  const themeFor = (state: SystemState): Theme => themeOf(fallback, state, design.themes);
  await compareColors((detail) => check.report(detail), tab, design, label, themeFor, undefined);
}

/** The viewports of `modes-behavior`, in order. */
export const MODES_VIEWPORTS: readonly Viewport[] = [DESKTOP, NARROW];

/**
 * `modes-behavior`: with two or more mode options, on the default home, at 1280×800 and at 390×844, without the
 * reveal step: the switch works, each option shows its theme in every system state, the last choice survives a
 * navigation and a reload, and with JavaScript off the page shows the default mode.
 */
export const modesBehavior: BrowserRule = {
  id: 'modes-behavior',
  pages: 'home',
  check: async (check) => {
    const design = check.run.design;
    if (enabledModes(check.run.options).length < 2 || design === undefined) return;
    for (const viewport of MODES_VIEWPORTS) {
      for (const detail of await withScripts(check, viewport, design)) check.report(detail);
      await withoutScripts(check, viewport, design);
    }
  },
};

/** The rules of this file. `src/browser/rules.ts` puts every rule in the order of section 8. */
export const COLOR_RULES: readonly BrowserRule[] = [modesBehavior, axeRule, contrastPairs];

/**
 * The layout rules of the browser stage (specification, section 8): `a11y-targets`, `a11y-reflow`,
 * `a11y-spacing`, `a11y-forced-colors` and `a11y-reveal`. Each rule measures one tested page through its `Check`
 * and reports each failing place with `check.report(detail)`.
 *
 * The code that runs in the page is a callback of `page.evaluate`. Playwright sends its source to the page, so a
 * callback reads nothing outside itself: every value it needs comes in as its argument.
 */
import type { Page } from 'playwright-core';
import { type BrowserRule, type Check, DESKTOP, NARROW, reveal, settle, sizeText, type Viewport } from './harness.ts';

/** A length for a finding: CSS pixels, cut (not rounded) to one decimal, so a failing 43.46 never reads 43.5. */
export function lengthText(value: number): string {
  return String(Math.floor(value * 10 + 1e-6) / 10);
}

// a11y-targets

/** The smallest block size and inline size of a target, in CSS pixels. */
export const TARGET_MIN = 43.5;

/** The elements that `a11y-targets` measures. `input` drops checkbox, radio and hidden in the page code. */
export const TARGET_SELECTOR = 'a[href], button, input, select, summary';

/** A target that is too small: its name and its box. */
interface SmallTarget {
  name: string;
  width: number;
  height: number;
}

/**
 * The inline elements of `links-generic` (section 8, Measurement details): a link climbs through them to find the
 * text that it stands in.
 */
export const INLINE_ELEMENTS: readonly string[] = [
  'a',
  'abbr',
  'b',
  'bdi',
  'bdo',
  'cite',
  'code',
  'data',
  'del',
  'dfn',
  'em',
  'i',
  'ins',
  'kbd',
  'mark',
  'q',
  's',
  'samp',
  'small',
  'span',
  'strong',
  'sub',
  'sup',
  'time',
  'u',
  'var',
  'wbr',
];

/**
 * The visible targets in `window.__astroKit.root()` that are smaller than `min` on a side, in document order.
 * Skipped: a link inline in text, an input of type checkbox, radio or hidden, a box of at most 1×1 (both sides ≤ 1,
 * such as the kit's `.visually-hidden` link), and a box above the page start (its bottom is at or above the top of
 * the document). A link is inline in text when one of its ancestors, from its parent through the inline elements up
 * to the nearest ancestor that is not inline, has a text node of its own with a letter or a digit.
 */
function smallTargets(page: Page): Promise<SmallTarget[]> {
  return page.evaluate(
    ({ selector, min, inlineNames }) => {
      const kit = window.__astroKit;
      const word = /[\p{L}\p{N}]/u;
      const skippedInputs = new Set(['checkbox', 'radio', 'hidden']);
      const inlineElements = new Set(inlineNames);
      const inline = (link: Element): boolean => {
        for (let up = link.parentElement; up !== null; up = up.parentElement) {
          for (const node of up.childNodes) {
            if (node.nodeType === Node.TEXT_NODE && word.test(node.textContent ?? '')) return true;
          }
          if (!inlineElements.has(up.localName)) return false;
        }
        return false;
      };
      const small: { name: string; width: number; height: number }[] = [];
      for (const element of kit.root().querySelectorAll(selector)) {
        if (element instanceof HTMLInputElement && skippedInputs.has(element.type)) continue;
        if (element.localName === 'a' && inline(element)) continue;
        if (!kit.visible(element)) continue;
        const box = element.getBoundingClientRect();
        if (box.width <= 1 && box.height <= 1) continue;
        if (box.bottom + window.scrollY <= 0) continue;
        if (box.width >= min && box.height >= min) continue;
        small.push({ name: kit.describe(element), width: box.width, height: box.height });
      }
      return small;
    },
    { selector: TARGET_SELECTOR, min: TARGET_MIN, inlineNames: INLINE_ELEMENTS },
  );
}

/** Reports each small target of one state: `390×844: a.nav__link "Zimmer" is 40×20`. */
async function reportTargets(check: Check, page: Page, state: string): Promise<void> {
  for (const target of await smallTargets(page)) {
    check.report(`${state}: ${target.name} is ${lengthText(target.width)}×${lengthText(target.height)}`);
  }
}

/**
 * `a11y-targets`: controls are at least 43.5×43.5 at 1280×800, at 390×844 and after the reveal step. Each state
 * reports each small control once, so a control that is small in three states gives three findings.
 */
export const targets: BrowserRule = {
  id: 'a11y-targets',
  pages: 'tested',
  concurrent: true,
  check: async (check) => {
    const desktop = await check.open({ viewport: DESKTOP });
    await reportTargets(check, desktop, sizeText(DESKTOP));
    const narrow = await check.open({ viewport: NARROW });
    await reportTargets(check, narrow, sizeText(NARROW));
    // The reveal step opens in the narrow tab: its page state is the narrow state with everything opened.
    await reveal(narrow, (state) => reportTargets(check, narrow, state.label));
  },
};

// a11y-reflow

/** The viewport of `a11y-reflow`: 320 CSS pixels wide, which is 1280 at 400 % zoom (WCAG 1.4.10). */
export const REFLOW: Viewport = { width: 320, height: 640 };

/** What `a11y-reflow` measured in one state. */
interface Reflow {
  scrollWidth: number;
  clientWidth: number;
  /** The outermost visible elements whose right edge is past `clientWidth + 1`, with no ancestor that scrolls. */
  wide: { name: string; right: number }[];
}

/**
 * Measures the reflow of one state in `window.__astroKit.root()`. An element sticks out when its right edge is past
 * `clientWidth + 1` of `html`. It is left out when an ancestor below `body` scrolls (computed `overflow-x` is `auto`
 * or `scroll`), when it is not visible, when it is inside an `svg` (the outer `svg` counts, not its shapes), when it
 * has the class `visually-hidden` or is inside such an element (the kit class clips its content in a 1 px box on
 * purpose, 7.6), and when an ancestor sticks out already: the outermost element names the problem once.
 */
function measureReflow(page: Page): Promise<Reflow> {
  return page.evaluate(() => {
    const kit = window.__astroKit;
    const html = document.documentElement;
    // The right edge is read in page coordinates from the left of the document.
    window.scrollTo({ left: 0, top: window.scrollY, behavior: 'instant' });
    const limit = html.clientWidth + 1;
    const root = kit.root();
    const wide = new Set<Element>();
    const found: { name: string; right: number }[] = [];
    for (const element of [root, ...root.querySelectorAll('*')]) {
      const parent = element.parentElement;
      if (parent !== null && parent.closest('svg') !== null) continue;
      if (element.closest('.visually-hidden') !== null) continue;
      if (!kit.visible(element)) continue;
      const right = element.getBoundingClientRect().right;
      if (right <= limit) continue;
      let scrolls = false;
      let inside = false;
      for (let up = element.parentElement; up !== null && up !== document.body && up !== html; up = up.parentElement) {
        if (wide.has(up)) inside = true;
        const overflow = getComputedStyle(up).overflowX;
        if (overflow === 'auto' || overflow === 'scroll') scrolls = true;
      }
      if (scrolls) continue;
      wide.add(element);
      if (!inside) found.push({ name: kit.describe(element), right });
    }
    return { scrollWidth: html.scrollWidth, clientWidth: html.clientWidth, wide: found };
  });
}

/** Sets the reflow viewport, waits for the animations and reports what sticks out in one state. */
async function reportReflow(check: Check, page: Page, state: string, whole: boolean): Promise<void> {
  await page.setViewportSize(REFLOW);
  await settle(page);
  const reflow = await measureReflow(page);
  // The scroll width of the page is read in the page states. A modal dialog does not change it.
  if (whole && reflow.scrollWidth > reflow.clientWidth + 1) {
    check.report(
      `${state}: the page scrolls sideways: scrollWidth ${reflow.scrollWidth} > clientWidth ${reflow.clientWidth} + 1`,
    );
  }
  for (const element of reflow.wide) {
    check.report(
      `${state}: ${element.name} ends at ${lengthText(element.right)}, past clientWidth ${reflow.clientWidth} + 1`,
    );
  }
}

/**
 * `a11y-reflow`: at 320×640, before and after the reveal step, nothing sticks out on the right and the page does not
 * scroll sideways. The reveal step opens at 390×844, as for every rule. Then each state is measured at 320×640:
 * `320×640 after the reveal step`, `320×640 with dialog#booking open`.
 */
export const reflow: BrowserRule = {
  id: 'a11y-reflow',
  pages: 'tested',
  concurrent: true,
  check: async (check) => {
    const page = await check.open({ viewport: REFLOW });
    const size = sizeText(REFLOW);
    await reportReflow(check, page, size, true);
    const narrow = sizeText(NARROW);
    await reveal(page, (state) => {
      const rest = state.label.startsWith(narrow) ? state.label.slice(narrow.length) : ` ${state.label}`;
      return reportReflow(check, page, `${size}${rest}`, state.kind === 'page');
    });
  },
};

// a11y-spacing

/** The text spacing of WCAG 1.4.12, as section 8 gives it. */
export const SPACING_CSS =
  '* { line-height: 1.5 !important; letter-spacing: .12em !important; word-spacing: .16em !important } ' +
  'p { margin-bottom: 2em !important }';

/** The viewports of `a11y-spacing`: 1280 and 390 CSS pixels wide. */
export const SPACING_VIEWPORTS: readonly Viewport[] = [DESKTOP, NARROW];

/** The overflow that a box may hide, in CSS pixels: `scrollHeight − clientHeight` must not be more. */
export const SPACING_SLACK = 2;

/**
 * Adds the text spacing to the page through a constructed style sheet: `adoptedStyleSheets` is allowed by the page
 * CSP (13.1 item 31), and a `style` element would not be.
 */
async function addSpacing(page: Page): Promise<void> {
  await page.evaluate((css) => {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  }, SPACING_CSS);
  await settle(page);
}

/**
 * The visible elements whose computed `overflow-y` is `hidden` or `clip`, whose content is more than `slack` pixels
 * higher than their box, and that hold text: a text node with a letter or a digit, outside `script`, `style` and
 * `.visually-hidden`. So a frame that crops a photo holds no text and passes. An element with the class
 * `visually-hidden`, and every element inside one, is skipped: the kit class clips text in a 1 px box on purpose
 * (7.6).
 */
function cutBoxes(page: Page): Promise<{ name: string; scrollHeight: number; clientHeight: number }[]> {
  return page.evaluate((slack) => {
    const kit = window.__astroKit;
    const word = /[\p{L}\p{N}]/u;
    const holdsText = (element: Element): boolean => {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
        if (!word.test(node.textContent ?? '')) continue;
        if ((node.parentElement?.closest('script, style, noscript, .visually-hidden') ?? null) === null) return true;
      }
      return false;
    };
    const cut: { name: string; scrollHeight: number; clientHeight: number }[] = [];
    for (const element of document.querySelectorAll('*')) {
      const overflow = getComputedStyle(element).overflowY;
      if (overflow !== 'hidden' && overflow !== 'clip') continue;
      if (element.closest('.visually-hidden') !== null) continue;
      if (element.scrollHeight - element.clientHeight <= slack) continue;
      if (!holdsText(element) || !kit.visible(element)) continue;
      cut.push({ name: kit.describe(element), scrollHeight: element.scrollHeight, clientHeight: element.clientHeight });
    }
    return cut;
  }, SPACING_SLACK);
}

/** `a11y-spacing`: with the text spacing of WCAG 1.4.12, no box that hides its overflow cuts its text. */
export const spacing: BrowserRule = {
  id: 'a11y-spacing',
  pages: 'tested',
  concurrent: true,
  check: async (check) => {
    for (const viewport of SPACING_VIEWPORTS) {
      const page = await check.open({ viewport });
      await addSpacing(page);
      for (const box of await cutBoxes(page)) {
        check.report(
          `${sizeText(viewport)} with the text spacing: ${box.name} cuts its text: ` +
            `scrollHeight ${box.scrollHeight} > clientHeight ${box.clientHeight} + ${SPACING_SLACK}`,
        );
      }
    }
  },
};

// a11y-forced-colors

/** The buttons of `a11y-forced-colors`. */
export const BUTTON_SELECTOR =
  'button, input[type="button" i], input[type="submit" i], input[type="reset" i], [role="button" i]';

/** The sides of a border, in the order of `border-*-width`. */
export const SIDES: readonly string[] = ['top', 'right', 'bottom', 'left'];

/**
 * The text of a button border that does not show, from the reason of each side (`''`: the side shows):
 * `has no border (style none)` when all four sides fail alike, else `has no border on the top (width 0px)`.
 */
export function borderText(reasons: readonly string[]): string {
  const first = reasons[0] ?? '';
  if (first !== '' && reasons.length === SIDES.length && reasons.every((reason) => reason === first)) {
    return `has no border (${first})`;
  }
  const failing = SIDES.flatMap((side, index) => {
    const reason = reasons[index] ?? '';
    return reason === '' ? [] : [`the ${side} (${reason})`];
  });
  return `has no border on ${failing.join(', ')}`;
}

/** What `a11y-forced-colors` measured with forced colors in one state. */
interface ForcedColors {
  /** `h1` and `main`, each with `missing`, `hidden` or `''` (visible). */
  content: { tag: string; problem: string }[];
  /**
   * The visible buttons in `root()` with a side whose border does not show, and why for each of the four sides
   * (`''`: it shows). A button that an earlier state of the tab reported is left out.
   */
  buttons: { name: string; sides: string[] }[];
}

declare global {
  interface Window {
    /** The buttons that `a11y-forced-colors` reported in this tab. */
    __astroKitBorders?: WeakSet<Element> | undefined;
  }
}

/**
 * Reads the content and the button borders of one state. The first `h1` and the `main` must be visible. Every side
 * of a button border must show: style not `none` or `hidden`, width ≥ 1 px and a color whose painted alpha is not 0
 * (section 8, Colors: the computed color text is never compared).
 */
function measureForcedColors(page: Page): Promise<ForcedColors> {
  return page.evaluate(
    ({ selector, sideNames }) => {
      const kit = window.__astroKit;
      const content: { tag: string; problem: string }[] = [];
      for (const tag of ['h1', 'main']) {
        const element = document.querySelector(tag);
        content.push({ tag, problem: element === null ? 'missing' : kit.visible(element) ? '' : 'hidden' });
      }
      window.__astroKitBorders ??= new WeakSet();
      const reported = window.__astroKitBorders;
      const buttons: { name: string; sides: string[] }[] = [];
      for (const element of kit.root().querySelectorAll(selector)) {
        if (reported.has(element) || !kit.visible(element)) continue;
        const style = getComputedStyle(element);
        const sides: string[] = [];
        for (const side of sideNames) {
          const line = style.getPropertyValue(`border-${side}-style`);
          const width = Number.parseFloat(style.getPropertyValue(`border-${side}-width`));
          const alpha = kit.pixel(style.getPropertyValue(`border-${side}-color`))[3] ?? 0;
          if (line === 'none' || line === 'hidden') sides.push(`style ${line}`);
          else if (!(width >= 1)) sides.push(`width ${style.getPropertyValue(`border-${side}-width`)}`);
          else if (alpha === 0) sides.push('color transparent');
          else sides.push('');
        }
        if (sides.some((reason) => reason !== '')) {
          reported.add(element);
          buttons.push({ name: kit.describe(element), sides });
        }
      }
      return { content, buttons };
    },
    { selector: BUTTON_SELECTOR, sideNames: SIDES },
  );
}

/** The outline of the focused element: `''` when it shows, else the reason. */
function focusRing(page: Page): Promise<{ name: string; problem: string }> {
  return page.evaluate(() => {
    const kit = window.__astroKit;
    const active = document.activeElement;
    if (active === null || active === document.body || active === document.documentElement) {
      return { name: '', problem: 'nothing' };
    }
    const style = getComputedStyle(active);
    const width = Number.parseFloat(style.outlineWidth);
    const problem =
      style.outlineStyle === 'none' ? 'outline-style none' : width >= 1 ? '' : `outline-width ${style.outlineWidth}`;
    return { name: kit.describe(active), problem };
  });
}

/** Reports the buttons of one state of `a11y-forced-colors` that have a side without a border. */
function reportBorders(check: Check, state: string, measured: ForcedColors): void {
  for (const button of measured.buttons) check.report(`${state}: ${button.name} ${borderText(button.sides)}`);
}

/**
 * `a11y-forced-colors`: with `emulateMedia({ forcedColors: 'active' })` at 1280×800, `h1` and `main` are visible,
 * and the first Tab of the fresh page shows a focus ring: the focused element has an outline with style not `none`
 * and width ≥ 1 px. Every visible button has a border on each side at 1280×800, at 390×844 and in each state of the
 * reveal step. The same tab measures every state, so a button reports once, in the first state that fails it.
 */
export const forcedColors: BrowserRule = {
  id: 'a11y-forced-colors',
  pages: 'tested',
  concurrent: true,
  check: async (check) => {
    const state = 'forced colors';
    const page = await check.open({ viewport: DESKTOP, media: { forcedColors: 'active' } });
    const desktop = await measureForcedColors(page);
    for (const { tag, problem } of desktop.content) {
      if (problem === 'missing') check.report(`${state}: the page has no ${tag}`);
      else if (problem === 'hidden') check.report(`${state}: ${tag} is not visible`);
    }
    reportBorders(check, state, desktop);
    await page.keyboard.press('Tab');
    await settle(page);
    const ring = await focusRing(page);
    if (ring.problem === 'nothing') check.report(`${state}: the first Tab focuses nothing`);
    else if (ring.problem !== '') check.report(`${state}: the first Tab focuses ${ring.name}, with ${ring.problem}`);
    await page.setViewportSize(NARROW);
    await settle(page);
    reportBorders(check, `${state} at ${sizeText(NARROW)}`, await measureForcedColors(page));
    await reveal(page, async (revealed) => {
      reportBorders(check, `${state} at ${revealed.label}`, await measureForcedColors(page));
    });
  },
};

// a11y-reveal

/**
 * The elements with ARIA state of a toggle that are no native invoker, outside an `astro-island`, after load with
 * JavaScript on. A native invoker is the first `summary` of a `details`, a `button` or `input` with `popovertarget`,
 * or a `button` with `commandfor` (section 8; 9.2 allows any element inside an island). The live DOM is read, so an
 * attribute that a script sets counts too.
 */
function toggles(page: Page): Promise<{ name: string; attributes: string[] }[]> {
  return page.evaluate(() => {
    const kit = window.__astroKit;
    const native = (element: Element): boolean => {
      if (element.localName === 'summary') {
        const details = element.parentElement;
        return details?.localName === 'details' && details.querySelector(':scope > summary') === element;
      }
      if (element instanceof HTMLButtonElement && element.hasAttribute('commandfor')) return true;
      return (
        (element instanceof HTMLButtonElement || element instanceof HTMLInputElement) &&
        element.hasAttribute('popovertarget')
      );
    };
    const found: { name: string; attributes: string[] }[] = [];
    for (const element of document.querySelectorAll('[aria-expanded], [aria-controls]')) {
      if (element.closest('astro-island') !== null || native(element)) continue;
      const attributes = ['aria-expanded', 'aria-controls'].filter((name) => element.hasAttribute(name));
      found.push({ name: kit.describe(element), attributes });
    }
    return found;
  });
}

/** `a11y-reveal`: hidden UI opens only through native invokers. */
export const revealRule: BrowserRule = {
  id: 'a11y-reveal',
  pages: 'tested',
  concurrent: true,
  check: async (check) => {
    const page = await check.open({ viewport: DESKTOP });
    for (const toggle of await toggles(page)) {
      check.report(
        `${sizeText(DESKTOP)}: ${toggle.name} has ${toggle.attributes.join(' and ')}, ` +
          'but it is no native invoker (summary, [popovertarget], [commandfor])',
      );
    }
  },
};

/** The rules of this file. `src/browser/rules.ts` puts every rule in the order of section 8. */
export const LAYOUT_RULES: readonly BrowserRule[] = [targets, reflow, spacing, forcedColors, revealRule];

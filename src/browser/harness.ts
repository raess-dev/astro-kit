/**
 * The harness of the browser rules (specification, section 8, "a11y (9), contrast (1), perf (6)": the harness).
 *
 * This module holds what every browser rule shares: the shape of a rule (`BrowserRule`), the context of one check
 * (`Check`), the viewports, the page helpers that an init script installs, the reveal step, the sweep, the Themes
 * walk and the Colors probe. `src/browser.ts` runs the rules. A rule file in `src/browser/` exports its rules, and
 * `src/browser/rules.ts` lists them. No rule file imports `src/browser.ts`, so the modules form no cycle.
 *
 * A rule never retries a measurement. A value that depends on time is read after a fixed wait (`settle`), so one
 * run gives the same findings as the next.
 */
import type { Browser, BrowserContext, BrowserContextOptions, Page } from 'playwright-core';
import type { PageDom } from '../audit/dom.ts';
import type { Design } from '../context.ts';
import {
  defaultMode,
  enabledModes,
  type ModeOption,
  SYSTEM_STATES,
  type SystemState,
  type Theme,
  themeOf,
} from '../modes.ts';
import type { Options } from '../options.ts';
import type { Received } from '../serve.ts';

// Viewports

export interface Viewport {
  width: number;
  height: number;
}

/** The two viewports of the harness. */
export const DESKTOP: Viewport = { width: 1280, height: 800 };
export const NARROW: Viewport = { width: 390, height: 844 };

/** The viewports of the harness, in order. `--shots` writes one image for each. */
export const VIEWPORTS: readonly Viewport[] = [DESKTOP, NARROW];

/** `1280×800`: the text of a viewport in a finding. */
export const sizeText = (viewport: Viewport): string => `${viewport.width}×${viewport.height}`;

// Waits

/** The longest wait for running animations: after a change of the mode, of the system state or of the reveal step. */
export const ANIMATION_WAIT_MS = 2_000;

/** The time limit of one check on one page. A check that takes longer did not finish. */
export const CHECK_LIMIT_MS = 120_000;

/** The time limit of one Playwright action, and of one navigation. */
export const ACTION_LIMIT_MS = 15_000;
export const NAVIGATION_LIMIT_MS = 30_000;

// Pages

/** One page that the harness tests. */
export interface TestPage {
  /** The built page path: the `where` of the findings on it. `/zimmer/`; the 404 page is `/404.html`. */
  where: string;
  /** The path that the harness opens: the page path, and `/404` for the 404 page (section 8, Pages). */
  path: string;
  /** The locale code of the page. The 404 page belongs to the default locale. */
  locale: string;
  is404: boolean;
  /** A locale home: `/` or `/<code>/`. */
  isHome: boolean;
  /** The home of the default locale: `/`. */
  isDefaultHome: boolean;
  /** The key of the browser sample: `404`, `home`, or the layout key (section 8, Measurement details). */
  key: string;
  /** The built page as the build audits read it. */
  dom: PageDom;
}

/** What every check of one run shares. */
export interface TestRun {
  /** `http://127.0.0.1:<port>`: the origin of the served `dist`. */
  origin: string;
  options: Options;
  /** The model of `docs/design.md`. `undefined` only in a unit test that gives none. */
  design: Design | undefined;
  /** The tested pages: every page with `--all`, else the sample. In path order. */
  pages: readonly TestPage[];
  /** The sample: one page for each locale and key. The perf pass always uses it. */
  sample: readonly TestPage[];
  /** The home of the default locale, when it is built (`contrast-pairs`). */
  home: TestPage | undefined;
  /** Every request that the server got, in order, with its headers (`perf-prerender` reads `sec-purpose`). */
  received: readonly Received[];
  browser: Browser;
}

/** How `Check.open` opens a page. */
export interface OpenOptions {
  /** The viewport. The default is `DESKTOP`. */
  viewport?: Viewport;
  /** `false` opens the page in the context with JavaScript off. The default is `true`. */
  javaScript?: boolean;
  /** Media features to emulate before the navigation: `colorScheme`, `contrast`, `forcedColors`, `reducedMotion`. */
  media?: Parameters<Page['emulateMedia']>[0];
  /** Another path or query of the same origin, such as `/zimmer/?kit-bfcache`. The default is the page's path. */
  path?: string;
  /** Opens the page in this context: one that `Check.context` made. */
  context?: BrowserContext;
}

/** The context of one rule on one page. Every page and context that it opens is closed when the check ends. */
export interface Check {
  readonly rule: string;
  readonly page: TestPage;
  readonly run: TestRun;
  /**
   * Adds a finding of this rule on this page. The `where` is the page path. Start the detail with the state, such
   * as `390×844 after the reveal step: a.nav__link "Zimmer" is 40×20`.
   */
  report(detail: string): void;
  /**
   * Opens the page in a new tab, with the page helpers, and waits for `load`, the fonts and the animations
   * (`settle`). Throws when the answer is not 2xx: the check then did not finish.
   */
  open(options?: OpenOptions): Promise<Page>;
  /** A browser context of its own, with the page helpers, for options that a context fixes (`deviceScaleFactor`). */
  context(options?: BrowserContextOptions): Promise<BrowserContext>;
}

/** Which pages a rule checks. */
export type PageScope = 'tested' | 'sample' | 'home';

/** A browser rule. `src/browser/rules.ts` lists them; the runner runs them in the order of section 8. */
export interface BrowserRule {
  /** The id of the rule in the registry. */
  id: string;
  /**
   * `tested`: every tested page (the sample, or every page with `--all`). `sample`: always the sample (the perf
   * pass). `home`: the home of the default locale only.
   */
  pages: PageScope;
  check(check: Check): Promise<void>;
}

/** The detail of a check that threw (section 8, Errors). */
export function didNotFinish(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  const line = text.split('\n').find((part) => part.trim() !== '') ?? '';
  return `the check did not finish: ${line.trim()}`;
}

// The page helpers

/** What `a11y-focus` asks of a focus ring (`focusRing`). */
export interface RingFloor {
  /** The least `outline-width`, in CSS pixels. */
  px: number;
  /** The least contrast of the ring against the color behind it. */
  contrast: number;
  /** Only the color: the other themes measure the width and the style once, in the states of a fresh tab. */
  colorOnly: boolean;
}

/** A box in CSS pixels, relative to the viewport. */
export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

/**
 * The page helpers: `window.__astroKit`. An init script installs them (`installHelpers`), so the page CSP does not
 * apply to them (13.1 item 30). They exist in the context with JavaScript off too: Playwright runs init scripts and
 * `evaluate` there, and only the page's own scripts are off.
 */
export interface PageHelpers {
  /** The element that the reveal step opened, while it is open: a `dialog`. Else `null`. */
  scope: Element | null;
  /** The element that a check measures in: `scope`, else `body`. */
  root(): Element;
  /** The element is rendered: `checkVisibility` with the visibility property, and at least one box. */
  visible(element: Element): boolean;
  /**
   * A short name of the element for a finding: `a.nav__link "Zimmer"`, `button#menu "Menü"`, `dialog#booking`.
   * The text in quotes is the `aria-label`, or the text of a link, button, summary, label, legend, option or heading.
   */
  describe(element: Element): string;
  /** The element is in the Tab sequence: focusable, not disabled, not inert, no negative `tabindex`, visible. */
  tabbable(element: Element): boolean;
  /**
   * The stops of `a11y-keyboard` in `root()`, in document order (section 8, Measurement details): the elements in
   * the Tab sequence, a radio group once, as its first radio; a control that a negative `tabindex` keeps out of the
   * Tab sequence, a composite widget with roving `tabindex` once; and a scroll container that the browser puts into
   * the Tab sequence.
   */
  stops(): Element[];
  /** The line boxes of an element that are on screen (13.1 item 33). */
  boxes(element: Element): Box[];
  /** The four channels of a color painted on a 1×1 canvas, each 0 to 255; `[]` for a text that is no color. */
  pixel(color: string): number[];
  /** The color `top` composited over `bottom`, both painted colors of four channels (0 to 255). */
  over(top: readonly number[], bottom: readonly number[]): number[];
  /** The WCAG contrast ratio of two opaque painted colors, from their relative luminance. */
  contrast(a: readonly number[], b: readonly number[]): number;
  /**
   * The opaque color behind the focus ring of an element (section 8, Measurement details): the walk starts at the
   * parent when `outline-offset` ≥ 0, else at the element, goes up the flat tree, and composites each
   * `background-color` until the color is opaque, then over white. `null` when an element of the walk, up to the
   * first opaque one, has a `background-image`: the ring then has no single color behind it.
   */
  behindRing(element: Element): number[] | null;
  /**
   * Measures the ring of the focused element (`a11y-focus`): the element and the detail of a failing ring, else
   * `null`. The focused element inside a shadow root is the one measured. Not measured: the body, `html`, the root of
   * the state, an `iframe` (its own document draws the ring), and a control that does not match `:focus` while it
   * holds the focus (the focus is on a part that the browser draws inside it, such as the picker of a date field).
   */
  focusRing(least: RingFloor): { element: Element; detail: string } | null;
  /**
   * The animations of the document and of every open shadow root in it. `document.getAnimations()` alone holds no
   * animation of a shadow tree (Chromium 153).
   */
  animations(): Animation[];
  /** Says whether an animation of the document or of an open shadow root runs (`animations()`). */
  animating(): boolean;
  /**
   * Pauses each running animation that never ends (its end time is infinite) at time 0, and says whether an
   * animation still runs. `settle` calls it until nothing runs. Each animation that it pauses goes into `endless`
   * first.
   */
  calm(): boolean;
  /**
   * The animations that never end, as `calm` and `finish` found them running, once each, in order: the element and
   * the name (`animationName`, else the `id`). `a11y-axe` reports them (WCAG 2.2.2).
   */
  endless: { element: Element | null; name: string }[];
  /**
   * The writes of `data-mode` on `html` since the last call that a check did not make itself (`setMode`). The watch
   * starts at the `load` event of the page, or at the first call if that comes first. A `MutationObserver` records
   * each write, also one of the same value.
   */
  modeWrites(): number;
  /** How long the watch of `modeWrites` has run, in milliseconds; 0 before it starts. */
  modeAge(): number;
  /** Sets `data-mode` on `html` (`null` removes it). The watch of `modeWrites` does not count this write. */
  setMode(mode: string | null): void;
  /**
   * Finishes each animation that runs, and pauses at time 0 one that cannot finish (it never ends). `settle` calls
   * it at the end of its wait, and a sweep after each press.
   */
  finish(): void;
  /**
   * The first two parts of the reveal step: every visible `details` open, every popover of a visible invoker shown.
   * An exclusive group (`details[name]`, `auto` and `hint` popovers) is opened as a whole: the step removes the
   * `name` and shows each popover as `manual`. Each popover that it shows goes into `revealed`.
   */
  openAll(): void;
  /** The popovers that `openAll` showed. A sample of `a11y-keyboard` that hits one of them is no cover. */
  revealed: Element[];
  /**
   * Gives each popover that `openAll` made `manual` its own `popover` value again, and hides the ones a modal dialog
   * would hide (`auto` and `hint`), except one that holds the open modal dialog. With `keep`, a popover that holds
   * `keep` stays as it is, for a later call. The reveal step calls it before a dialog opens. The form check of
   * `a11y-no-js` calls it with the dialog's invoker before the click, so no other popover covers the invoker, and
   * again after the dialog opens. So the dialog's state is the one a visitor sees.
   */
  restorePopovers(keep?: Element | null): void;
  /** The dialogs of the reveal step: the targets of visible `[commandfor][command=show-modal]`, once each. */
  dialogs(): HTMLDialogElement[];
  /** The dialogs that the reveal step opens, one at a time: `dialogs()` as it was after `openAll`. */
  revealDialogs: HTMLDialogElement[];
  /**
   * Starts a sweep in `root()`: focuses its start, turns smooth scrolling off, empties `focused` and gives the number
   * of stops.
   */
  startSweep(): number;
  /**
   * Ends the animations that run (`finish`), then records the focused element of one press of a sweep when it is
   * inside `root()`. It says whether the press left the focus on the element of the press before: a part of a date
   * field or of a media player, a link in an `iframe`, or a trap.
   */
  recordStop(): boolean;
  /** Ends a sweep: restores what `startSweep` changed. */
  endSweep(): void;
  /** The element that each press of the current sweep focused, in order; one entry per press that focused one. */
  focused: Element[];
}

declare global {
  interface Window {
    __astroKit: PageHelpers;
  }
}

/**
 * Installs `window.__astroKit`. Playwright sends the source of this function to the page as an init script, so it
 * reads nothing outside itself.
 */
export function installHelpers(): void {
  const FOCUSABLE =
    'a[href], area[href], button, input:not([type="hidden" i]), select, textarea, summary, iframe, [tabindex], ' +
    '[contenteditable]:not([contenteditable="false" i]), audio[controls], video[controls]';
  // A control that is a stop also with a negative `tabindex`: the native controls, and the control roles of
  // `CONTROL_ROLES` in `src/browser/keyboard.ts`.
  const CONTROLS =
    'a[href], area[href], button, input:not([type="hidden" i]), select, textarea, summary, audio[controls], ' +
    'video[controls]';
  const CONTROL_ROLES = new Set([
    'button',
    'checkbox',
    'combobox',
    'link',
    'menuitem',
    'radio',
    'slider',
    'switch',
    'tab',
    'textbox',
  ]);
  // The composite widgets whose members may use a roving `tabindex`: the group is one stop.
  const COMPOSITE = ['tablist', 'menu', 'menubar', 'toolbar', 'radiogroup', 'listbox', 'grid', 'tree', 'treegrid']
    .map((role) => `[role="${role}" i]`)
    .join(', ');
  const NAMED = new Set(['a', 'button', 'summary', 'label', 'legend', 'option', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
  let paint: CanvasRenderingContext2D | null = null;
  let restore: (() => void) | undefined;
  let last: Element | null = null;
  const scrolls = (value: string): boolean => value === 'auto' || value === 'scroll';
  // Focusable, not disabled, not inert, the first summary of its details, and visible: tabbable but for `tabindex`.
  const focusable = (element: Element): boolean => {
    if (!element.matches(FOCUSABLE) || element.matches(':disabled') || element.closest('[inert]') !== null) {
      return false;
    }
    if (element.localName === 'summary') {
      const details = element.parentElement;
      if (details?.localName !== 'details' || details.querySelector(':scope > summary') !== element) return false;
    }
    return helpers.visible(element);
  };
  const negative = (element: Element): boolean => {
    const index = element.getAttribute('tabindex');
    return index !== null && Number.parseInt(index, 10) < 0;
  };
  const isControl = (element: Element): boolean =>
    element.matches(CONTROLS) || CONTROL_ROLES.has((element.getAttribute('role') ?? '').trim().toLowerCase());
  // Chromium puts a scroll container into the Tab sequence when its content is larger than its box and no
  // element inside it is in the Tab sequence (keyboard-focusable scrollers, Chromium 130).
  const focusableScroller = (element: Element): boolean => {
    const style = getComputedStyle(element);
    const across = scrolls(style.overflowX) && element.scrollWidth > element.clientWidth;
    const down = scrolls(style.overflowY) && element.scrollHeight > element.clientHeight;
    if ((!across && !down) || element.closest('[inert]') !== null || !helpers.visible(element)) return false;
    return ![...element.querySelectorAll(FOCUSABLE)].some((inner) => helpers.tabbable(inner));
  };
  // The `popover` value of each popover that `openAll` made `manual` (`restorePopovers`).
  const kinds = new Map<HTMLElement, string>();
  // The animations already in `endless`.
  const recorded = new Set<Animation>();
  const record = (animation: Animation): void => {
    if (recorded.has(animation)) return;
    recorded.add(animation);
    const effect = animation.effect;
    const element = effect instanceof KeyframeEffect ? effect.target : null;
    const name = animation instanceof CSSAnimation ? animation.animationName : animation.id;
    helpers.endless.push({ element, name });
  };
  // The watch of `modeWrites`: the observer, the writes that its callback took, and when it started. It starts at
  // the `load` event, so a page script that writes `data-mode` after the load is seen however short a check is.
  let modeWatch: MutationObserver | null = null;
  let modeCount = 0;
  let modeStart = 0;
  const startModeWatch = (): void => {
    if (modeWatch !== null) return;
    modeWatch = new MutationObserver((records) => {
      modeCount += records.length;
    });
    modeWatch.observe(document.documentElement, { attributes: true, attributeFilter: ['data-mode'] });
    modeStart = performance.now();
  };
  window.addEventListener('load', startModeWatch, { once: true });
  const helpers: PageHelpers = {
    scope: null,
    focused: [],
    revealed: [],
    revealDialogs: [],
    endless: [],
    root: () => helpers.scope ?? document.body ?? document.documentElement,
    visible: (element) => {
      // The layout first: `checkVisibility` reads a skipped `content-visibility` subtree, such as the content of a
      // `details` that was just opened, from the last layout.
      element.getBoundingClientRect();
      return (
        element.checkVisibility({ visibilityProperty: true, contentVisibilityAuto: true }) &&
        element.getClientRects().length > 0
      );
    },
    describe: (element) => {
      let text = element.localName;
      if (element.id !== '') text += `#${element.id}`;
      else if (element.classList.length > 0) text += `.${element.classList[0]}`;
      // The text names an element that a person reads as one name; a container such as a dialog has its id.
      const named = NAMED.has(element.localName);
      const label = element.getAttribute('aria-label') ?? (named ? element.textContent : '') ?? '';
      const name = label.replace(/\s+/g, ' ').trim();
      if (name !== '') text += ` "${name.length > 40 ? `${name.slice(0, 39)}…` : name}"`;
      return text;
    },
    tabbable: (element) => !negative(element) && focusable(element),
    stops: () => {
      const root = helpers.root();
      const groups = new Set<string>();
      const composites = new Set<Element>();
      const stops: Element[] = [];
      for (const element of root.querySelectorAll('*')) {
        if (!element.matches(FOCUSABLE)) {
          if (focusableScroller(element)) stops.push(element);
          continue;
        }
        if (!negative(element)) {
          if (!focusable(element)) continue;
          if (element instanceof HTMLInputElement && element.type === 'radio' && element.name !== '') {
            const forms = [...document.forms];
            const key = `${element.form === null ? -1 : forms.indexOf(element.form)} ${element.name}`;
            if (groups.has(key)) continue;
            groups.add(key);
          }
          stops.push(element);
          continue;
        }
        // A control that a negative `tabindex` keeps out of the Tab sequence is still a stop, so the sweep reports
        // it. A member of a composite widget counts with its group: once, and not at all when the group has a member
        // in the Tab sequence (a roving `tabindex`).
        if (!isControl(element) || !focusable(element)) continue;
        const composite = element.closest(COMPOSITE);
        if (composite !== null) {
          if (composites.has(composite)) continue;
          composites.add(composite);
          if ([...composite.querySelectorAll(FOCUSABLE)].some((inner) => helpers.tabbable(inner))) continue;
        }
        stops.push(element);
      }
      return stops;
    },
    boxes: (element) =>
      [...element.getClientRects()]
        .filter(
          (box) =>
            box.width > 0 &&
            box.height > 0 &&
            box.right > 0 &&
            box.bottom > 0 &&
            box.left < innerWidth &&
            box.top < innerHeight,
        )
        .map((box) => ({
          left: box.left,
          top: box.top,
          right: box.right,
          bottom: box.bottom,
          width: box.width,
          height: box.height,
        })),
    pixel: (color) => {
      if (!CSS.supports('color', color)) return [];
      paint ??= Object.assign(document.createElement('canvas'), { width: 1, height: 1 }).getContext('2d', {
        willReadFrequently: true,
      });
      if (paint === null) return [];
      paint.clearRect(0, 0, 1, 1);
      paint.fillStyle = color;
      paint.fillRect(0, 0, 1, 1);
      return [...paint.getImageData(0, 0, 1, 1).data];
    },
    over: (top, bottom) => {
      const alpha = (top[3] ?? 255) / 255;
      const base = (bottom[3] ?? 255) / 255;
      const out = alpha + base * (1 - alpha);
      if (out === 0) return [0, 0, 0, 0];
      const channel = (index: number): number =>
        Math.round(((top[index] ?? 0) * alpha + (bottom[index] ?? 0) * base * (1 - alpha)) / out);
      return [channel(0), channel(1), channel(2), Math.round(out * 255)];
    },
    contrast: (a, b) => {
      const linear = (value: number): number => {
        const c = value / 255;
        return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      };
      const luminance = (color: readonly number[]): number =>
        0.2126 * linear(color[0] ?? 0) + 0.7152 * linear(color[1] ?? 0) + 0.0722 * linear(color[2] ?? 0);
      const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
      return ((high ?? 0) + 0.05) / ((low ?? 0) + 0.05);
    },
    behindRing: (element) => {
      const offset = Number.parseFloat(getComputedStyle(element).outlineOffset) || 0;
      const up = (from: Element): Element | null => {
        if (from.assignedSlot) return from.assignedSlot;
        if (from.parentElement) return from.parentElement;
        const root = from.getRootNode();
        return root instanceof ShadowRoot ? root.host : null;
      };
      let node: Element | null = offset < 0 ? element : up(element);
      // The layers from the nearest to the farthest; the walk ends at the first opaque one.
      const layers: number[][] = [];
      while (node !== null) {
        const style = getComputedStyle(node);
        // A background image paints over the background color, so the ring has no single color behind it.
        if (style.backgroundImage !== 'none') return null;
        const color = helpers.pixel(style.backgroundColor);
        if (color.length === 4 && (color[3] ?? 0) > 0) layers.push(color);
        if (color[3] === 255) break;
        node = up(node);
      }
      let result = [255, 255, 255, 255];
      for (const layer of layers.reverse()) result = helpers.over(layer, result);
      return result;
    },
    focusRing: (least) => {
      let active = document.activeElement;
      while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
      if (active === null || active === helpers.root()) return null;
      if (active === document.body || active === document.documentElement || active.localName === 'iframe') return null;
      if (!active.matches(':focus')) return null;
      const style = getComputedStyle(active);
      if (style.outlineStyle === 'none' || Number.parseFloat(style.outlineWidth) < least.px) {
        if (least.colorOnly) return null;
        // With `outline-style: none` a newer Chromium still computes the width, so the detail leaves the width out.
        const shown =
          style.outlineStyle === 'none' ? 'no outline' : `the outline ${style.outlineWidth} ${style.outlineStyle}`;
        return { element: active, detail: `${helpers.describe(active)} shows ${shown}` };
      }
      // The color: the ring composited over the color behind it, against that color.
      const ring = helpers.pixel(style.outlineColor);
      const behind = helpers.behindRing(active);
      if (ring.length !== 4 || behind === null) return null;
      const ratio = helpers.contrast(helpers.over(ring, behind), behind);
      if (ratio >= least.contrast) return null;
      const [red, green, blue] = behind;
      const shown = (Math.floor(ratio * 100) / 100).toFixed(2);
      return {
        element: active,
        detail: `${helpers.describe(active)} shows a ring of contrast ${shown}:1 on rgb(${red}, ${green}, ${blue})`,
      };
    },
    animations: () => {
      const found = document.getAnimations();
      // Each open shadow root, also one inside another: its `getAnimations()` holds the animations of its tree.
      const roots: (Document | ShadowRoot)[] = [document];
      for (let at = 0; at < roots.length; at += 1) {
        for (const element of roots[at]?.querySelectorAll('*') ?? []) {
          const shadow = element.shadowRoot;
          if (shadow === null) continue;
          roots.push(shadow);
          for (const animation of shadow.getAnimations()) if (!found.includes(animation)) found.push(animation);
        }
      }
      return found;
    },
    animating: () => helpers.animations().some((animation) => animation.playState === 'running'),
    calm: () => {
      let running = false;
      for (const animation of helpers.animations()) {
        if (animation.playState !== 'running') continue;
        if (animation.effect?.getComputedTiming().endTime === Number.POSITIVE_INFINITY) {
          record(animation);
          animation.pause();
          animation.currentTime = 0;
        } else running = true;
      }
      return running;
    },
    finish: () => {
      for (const animation of helpers.animations()) {
        if (animation.playState !== 'running') continue;
        try {
          animation.finish();
        } catch {
          record(animation);
          animation.pause();
          animation.currentTime = 0;
        }
      }
    },
    modeWrites: () => {
      if (modeWatch === null) {
        startModeWatch();
        return 0;
      }
      const writes = modeCount + modeWatch.takeRecords().length;
      modeCount = 0;
      return writes;
    },
    modeAge: () => (modeWatch === null ? 0 : performance.now() - modeStart),
    setMode: (mode) => {
      // The records before this write stay counted; the record of this write is taken at once.
      const before = modeWatch === null ? 0 : modeCount + modeWatch.takeRecords().length;
      if (mode === null) document.documentElement.removeAttribute('data-mode');
      else document.documentElement.setAttribute('data-mode', mode);
      modeWatch?.takeRecords();
      modeCount = before;
    },
    openAll: () => {
      // In document order, so a `details` inside an outer one is visible when its turn comes. A `name` makes an
      // exclusive group, in which opening one closes the others; without it, every one stays open and is measured.
      for (const details of document.querySelectorAll('details')) {
        if (!helpers.visible(details)) continue;
        details.removeAttribute('name');
        details.open = true;
      }
      // A shown popover can hold the invoker of another one, so the passes go on until one shows nothing new.
      const invokers = [...document.querySelectorAll('[popovertarget], [commandfor]')];
      for (let pass = 0; pass <= invokers.length; pass += 1) {
        let shown = 0;
        for (const invoker of invokers) {
          if (!(invoker instanceof HTMLButtonElement || invoker instanceof HTMLInputElement)) continue;
          if (!helpers.visible(invoker)) continue;
          let target: Element | null = null;
          if (invoker.hasAttribute('popovertarget')) target = invoker.popoverTargetElement;
          else if (invoker instanceof HTMLButtonElement) {
            const command = (invoker.getAttribute('command') ?? '').toLowerCase();
            if (command === 'show-popover' || command === 'toggle-popover') target = invoker.commandForElement;
          }
          if (!(target instanceof HTMLElement) || !target.hasAttribute('popover') || target.matches(':popover-open')) {
            continue;
          }
          try {
            // An `auto` or `hint` popover closes the others of its kind when it shows. As `manual`, each one stays
            // open, so the content of every popover is measured, as a visitor sees each of them in turn.
            const kind = target.getAttribute('popover') ?? '';
            if (kind !== 'manual') {
              if (!kinds.has(target)) kinds.set(target, kind);
              target.setAttribute('popover', 'manual');
            }
            target.showPopover();
            if (!helpers.revealed.includes(target)) helpers.revealed.push(target);
            shown += 1;
          } catch {
            // A popover that cannot show (it is not connected, or a dialog holds it) stays closed.
          }
        }
        if (shown === 0) break;
      }
    },
    restorePopovers: (keep) => {
      for (const [target, kind] of [...kinds]) {
        if (keep && target.contains(keep)) continue;
        // A popover that holds the open modal dialog stays open: hiding it would hide the dialog too.
        if (target.matches(':popover-open') && target.querySelector('dialog:modal') === null) target.hidePopover();
        target.setAttribute('popover', kind);
        kinds.delete(target);
      }
    },
    dialogs: () => {
      const dialogs: HTMLDialogElement[] = [];
      for (const invoker of document.querySelectorAll('[commandfor]')) {
        if (!(invoker instanceof HTMLButtonElement) || !helpers.visible(invoker)) continue;
        if ((invoker.getAttribute('command') ?? '').toLowerCase() !== 'show-modal') continue;
        const target = invoker.commandForElement;
        if (target instanceof HTMLDialogElement && !dialogs.includes(target)) dialogs.push(target);
      }
      return dialogs;
    },
    startSweep: () => {
      const root = helpers.root();
      // No smooth scrolling during the sweep: the scroll that a focus starts ends before the press is measured. A
      // constructed sheet is allowed by the page CSP (13.1 item 31).
      const instant = new CSSStyleSheet();
      instant.replaceSync('* { scroll-behavior: auto !important }');
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, instant];
      // The start of the sweep: the root itself takes the focus, so the first Tab goes to the first stop inside it.
      const before = root.getAttribute('tabindex');
      root.setAttribute('tabindex', '-1');
      if (root instanceof HTMLElement) root.focus({ preventScroll: true });
      if (helpers.scope === null) window.scrollTo({ left: 0, top: 0, behavior: 'instant' });
      restore = () => {
        if (before === null) root.removeAttribute('tabindex');
        else root.setAttribute('tabindex', before);
        document.adoptedStyleSheets = document.adoptedStyleSheets.filter((sheet) => sheet !== instant);
      };
      helpers.focused = [];
      last = null;
      return helpers.stops().length;
    },
    recordStop: () => {
      helpers.finish();
      const active = document.activeElement;
      const root = helpers.root();
      const inside = active !== null && active !== root && active !== document.body && root.contains(active);
      const same = inside && active === last;
      if (inside) helpers.focused.push(active);
      last = inside ? active : null;
      return same;
    },
    endSweep: () => {
      restore?.();
      restore = undefined;
    },
  };
  Object.defineProperty(window, '__astroKit', { value: helpers, configurable: true });
}

/** The pause between two looks at the running animations: one frame at 60 Hz. */
const FRAME_MS = 16;

const pause = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

/**
 * Waits until the fonts are ready and no animation runs, for at most `ANIMATION_WAIT_MS` (section 8, Themes). The
 * wait runs in Node: with JavaScript off, a page runs no timer and no animation frame callback, but `evaluate`
 * works. An animation that never ends is paused at time 0 at once, and one that still runs at the end of the wait
 * is finished, so every run measures the same frame.
 */
export async function settle(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  const end = Date.now() + ANIMATION_WAIT_MS;
  while (await page.evaluate(() => window.__astroKit.calm())) {
    if (Date.now() >= end) {
      await page.evaluate(() => window.__astroKit.finish());
      return;
    }
    await pause(FRAME_MS);
  }
}

/**
 * Waits until the fonts are ready, then ends every running animation at once (`finish`): for a check that reads only
 * values that no animation changes, such as the probes of `modes-behavior`, so it needs no wait of up to 2 s.
 */
export async function finishNow(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts.ready;
    window.__astroKit.finish();
  });
}

// The reveal step

/** One state of the reveal step. */
export interface RevealState {
  /** `page`: every `details` open and every popover shown. `dialog`: one dialog open by itself, as a modal. */
  kind: 'page' | 'dialog';
  /** The text of the state in a finding: `390×844 after the reveal step`, `390×844 with dialog#booking open`. */
  label: string;
}

/**
 * The reveal step (section 8, the harness). At 390×844 it opens every visible `details` and shows every popover of
 * a visible invoker, waits for the animations and calls `visit` for that state. Then it takes the dialog targets of
 * the visible `[commandfor][command=show-modal]` once, as elements, and opens each as a modal, one at a time:
 * `visit` runs while it is open, with `window.__astroKit.scope` set to it, so the stops, the sweep and `root()` hold
 * only the dialog. Then it closes the dialog and opens the `details` and popovers again, because `showModal` closes
 * the open `auto` popovers. `visit` may change the viewport (`a11y-reflow` measures at 320×640); the step sets
 * 390×844 again before the next dialog.
 */
export async function reveal(page: Page, visit: (state: RevealState) => Promise<void>): Promise<void> {
  await page.setViewportSize(NARROW);
  await page.evaluate(() => window.__astroKit.openAll());
  await settle(page);
  await visit({ kind: 'page', label: `${sizeText(NARROW)} after the reveal step` });
  await page.setViewportSize(NARROW);
  // The list is taken once: a dialog that closes the popovers would shorten a list taken again.
  const names = await page.evaluate(() => {
    const helpers = window.__astroKit;
    helpers.revealDialogs = helpers.dialogs();
    return helpers.revealDialogs.map((dialog) => helpers.describe(dialog));
  });
  for (const [index, name] of names.entries()) {
    const opened = await page.evaluate((at) => {
      const dialog = window.__astroKit.revealDialogs[at];
      if (dialog === undefined || dialog.open || !dialog.isConnected) return false;
      // A modal dialog hides the `auto` popovers; the reveal step made them `manual`, so it hides them itself.
      window.__astroKit.restorePopovers();
      try {
        dialog.showModal();
      } catch {
        // A dialog that cannot open as a modal (a shown popover, say) has no state of its own.
        return false;
      }
      window.__astroKit.scope = dialog;
      return true;
    }, index);
    if (!opened) continue;
    try {
      await settle(page);
      await visit({ kind: 'dialog', label: `${sizeText(NARROW)} with ${name} open` });
    } finally {
      await page.setViewportSize(NARROW);
      await page.evaluate(() => {
        const dialog = window.__astroKit.scope;
        window.__astroKit.scope = null;
        if (dialog instanceof HTMLDialogElement) dialog.close();
        window.__astroKit.openAll();
      });
      await settle(page);
    }
  }
}

// The sweep

/** The result of one sweep. */
export interface Sweep {
  /** The number of stops in the root (section 8, Measurement details). */
  stops: number;
  /** The Tab presses that count: stops + 5. */
  presses: number;
  /** Every Tab press of the sweep: the presses that count, and the ones that kept the focus on the same element. */
  pressed: number;
}

/** The presses of a sweep beyond its stops (`a11y-keyboard`: within stops + 5 presses). */
export const SWEEP_EXTRA_PRESSES = 5;

/** The most presses of one sweep that do not count because they keep the focus on the same element. */
export const SWEEP_SAME_PRESSES = 50;

/** How a sweep runs. */
export interface SweepOptions {
  /**
   * `false` for a tab with JavaScript off, where the page runs no timer. With scripts (the default), each press
   * first waits for one timer turn of the page, so a script that moves the focus with `setTimeout(…, 0)` has moved it.
   */
  scripts?: boolean;
}

/**
 * A sweep (section 8, Measurement details): the Tab sequence of `a11y-keyboard`, through its stops. It starts at the
 * start of `root()` (the page, or the dialog that the reveal step opened), with smooth scrolling off, and presses Tab
 * until stops + 5 presses count. A press that keeps the focus on the element of the press before does not count, up
 * to `SWEEP_SAME_PRESSES` of them: Chromium gives a date field, a media player or an `iframe` several presses. After
 * each press the sweep finishes the animations that run, so a focus ring that grows is read at its end and no wait
 * depends on time; it records the focused element in `window.__astroKit.focused` and calls `visit(press)`, so a
 * rule can measure the focused element (`document.activeElement`). A press that leaves the root records nothing.
 */
export async function sweep(
  page: Page,
  visit?: (press: number) => Promise<void>,
  options: SweepOptions = {},
): Promise<Sweep> {
  const stops = await page.evaluate(() => window.__astroKit.startSweep());
  const presses = stops + SWEEP_EXTRA_PRESSES;
  let counted = 0;
  let same = 0;
  let press = 0;
  try {
    while (counted < presses) {
      press += 1;
      await page.keyboard.press('Tab');
      const kept = await page.evaluate(async (scripts) => {
        if (scripts) await new Promise((done) => setTimeout(done, 0));
        return window.__astroKit.recordStop();
      }, options.scripts !== false);
      if (kept && same < SWEEP_SAME_PRESSES) same += 1;
      else counted += 1;
      if (visit) await visit(press);
    }
  } finally {
    await page.evaluate(() => window.__astroKit.endSweep());
  }
  return { stops, presses, pressed: press };
}

// Themes

/** One theme as the Themes walk reaches it: the mode option to set (`undefined`: no `data-mode`) and the system. */
export interface ThemeState {
  theme: Theme;
  mode: ModeOption | undefined;
  system: SystemState;
}

/** The order in which the walk tries the mode options: a fixed option comes before the system setting. */
export const THEME_MODE_ORDER: readonly ModeOption[] = ['light', 'dark', 'contrast', 'auto'];

/**
 * The Themes walk (section 8, the harness): each declared theme once, in the order of `## Themes`, with the first
 * state that reaches it. With two or more mode options it tries the enabled options in `THEME_MODE_ORDER` and,
 * for each, the system states in the order of `SYSTEM_STATES`. With fewer, it sets no `data-mode` and tries the
 * system states with the default mode `D`. A theme that no state reaches is left out (`modes-themes` fails it).
 */
export function themeStates(options: Pick<Options, 'modes'>, themes: readonly Theme[]): ThemeState[] {
  const enabled = enabledModes(options);
  const tries: { mode: ModeOption | undefined; use: ModeOption }[] =
    enabled.length >= 2
      ? THEME_MODE_ORDER.filter((mode) => enabled.includes(mode)).map((mode) => ({ mode, use: mode }))
      : [{ mode: undefined, use: defaultMode(options) }];
  const states: ThemeState[] = [];
  for (const theme of themes) {
    let found: ThemeState | undefined;
    for (const { mode, use } of tries) {
      const system = SYSTEM_STATES.find((state) => themeOf(use, state, themes) === theme);
      if (system !== undefined) {
        found = { theme, mode, system };
        break;
      }
    }
    if (found) states.push(found);
  }
  return states;
}

/**
 * Puts a page into a theme state: `data-mode` on `html` (or none), the emulated color scheme and contrast, and
 * then the wait for the animations.
 */
export async function applyTheme(page: Page, state: ThemeState): Promise<void> {
  await page.evaluate((mode) => window.__astroKit.setMode(mode), state.mode ?? null);
  await page.emulateMedia({ colorScheme: state.system.scheme, contrast: state.system.contrast });
  await settle(page);
}

// Colors

/** The four channels of a painted color. */
export type Pixel = readonly number[];

/** The largest difference of a channel between two painted colors, of 255. `Infinity` when one is no color. */
export function pixelDistance(a: Pixel, b: Pixel): number {
  if (a.length !== 4 || b.length !== 4) return Number.POSITIVE_INFINITY;
  return Math.max(...a.map((channel, index) => Math.abs(channel - (b[index] ?? 0))));
}

/** Two painted colors are equal: each of the four channels differs by at most 1 (section 8, Colors). */
export const samePixel = (a: Pixel, b: Pixel): boolean => pixelDistance(a, b) <= 1;

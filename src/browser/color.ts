/**
 * The color rules of the browser stage (specification, section 8): `a11y-axe`, `contrast-pairs` and
 * `modes-behavior`. Each one reads the page in every declared theme, or in every mode state, and measures colors
 * only through the Colors probe of the harness: a color is painted on a 1×1 canvas (`pixel`), composited with
 * `over` and compared with `contrast`, the one WCAG luminance formula of the kit. No rule compares the computed text
 * of a color.
 *
 * - `a11y-axe` runs axe-core from the kit's own dependency, injected into the page with `evaluate`: the page CSP
 *   does not apply to it (13.1 item 30), and axe works under the kit's CSP with Trusted Types on.
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
  applyTheme,
  type BrowserRule,
  type Check,
  DESKTOP,
  NARROW,
  type Pixel,
  samePixel,
  settle,
  sizeText,
  type ThemeState,
  themeStates,
  type Viewport,
} from './harness.ts';

declare global {
  interface Window {
    /** axe-core, once `a11y-axe` injected it. */
    axe?: { run(context: Document, options: RunOptions): Promise<AxeResults> };
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

/**
 * The theme states of a check: the Themes walk (section 8, the harness) over the declared themes. Without a
 * design (a unit test that gives none) the check runs once, in the state of a fresh tab.
 */
function statesOf(check: Check): (ThemeState | undefined)[] {
  const states = themeStates(check.run.options, check.run.design?.themes ?? []);
  return states.length > 0 ? states : [undefined];
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

/** What the page code of `a11y-axe` gets. */
interface AxeArgument {
  options: RunOptions;
  enhanced: string;
  reviewFails: readonly string[];
  gradient: string;
  running: string;
  notRunning: string;
}

/** One failing node of axe: a key for the node and the rule, and the text of the finding. */
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
 * `color-contrast` with a reason of `reviewFails`. For `color-contrast` with the reason `bgGradient` the kit
 * decides: it reads the color stops of the first computed `background-image` behind the text (the element and then
 * its ancestors in the flat tree), composites each stop over white and the text color over the stop, and the node
 * fails when a stop gives less than the ratio that axe expects for the text.
 */
async function runAxe(arg: AxeArgument): Promise<AxeHit[]> {
  const kit = window.__astroKit;
  if (window.axe === undefined) throw new Error('axe-core is not in the page');
  const results = await window.axe.run(document, arg.options);
  const hits: AxeHit[] = [];
  const nameOf = (node: NodeResult): string =>
    node.element ? kit.describe(node.element) : node.target.flat(2).join(' ');
  const add = (rule: string, node: NodeResult, text: string): void => {
    hits.push({ key: `${rule} ${JSON.stringify(node.target)}`, text });
  };
  const up = (from: Element): Element | null => {
    if (from.assignedSlot) return from.assignedSlot;
    if (from.parentElement) return from.parentElement;
    const root = from.getRootNode();
    return root instanceof ShadowRoot ? root.host : null;
  };
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
  const stopsOf = (image: string): string[] => {
    const stops: string[] = [];
    for (const layer of split(image, (char) => char === ',')) {
      const inner = /^(?:repeating-)?(?:linear|radial|conic)-gradient\((.*)\)$/s.exec(layer)?.[1];
      if (inner === undefined) continue;
      for (const part of split(inner, (char) => char === ',')) {
        for (const word of split(part, (char) => /\s/.test(char))) if (CSS.supports('color', word)) stops.push(word);
      }
    }
    return stops;
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
  const gradient = (element: Element, expected: number): string | null => {
    let holder: Element | null = element;
    while (holder !== null && getComputedStyle(holder).backgroundImage === 'none') holder = up(holder);
    const stops = holder === null ? [] : stopsOf(getComputedStyle(holder).backgroundImage);
    if (stops.length === 0) return 'no color stop of a gradient lies behind it';
    const text = kit.pixel(getComputedStyle(element).color);
    let worst: { ratio: number; stop: number[] } | undefined;
    for (const stop of stops) {
      const behind = kit.over(kit.pixel(stop), [255, 255, 255, 255]);
      const ratio = kit.contrast(kit.over(text, behind), behind);
      if (worst === undefined || ratio < worst.ratio) worst = { ratio, stop: behind };
    }
    if (worst === undefined || worst.ratio >= expected) return null;
    const shown = (Math.floor(worst.ratio * 100) / 100).toFixed(2);
    const [red, green, blue] = worst.stop;
    return `${shown}:1 on the gradient stop rgb(${red}, ${green}, ${blue}), ${expected}:1 expected`;
  };
  for (const rule of results.violations) {
    for (const node of rule.nodes) {
      if (rule.id === arg.enhanced) {
        const element = node.element;
        const running =
          element !== undefined &&
          element.closest('main') !== null &&
          element.closest(arg.running) !== null &&
          element.closest(arg.notRunning) === null;
        if (!running) continue;
      }
      add(rule.id, node, `${rule.id} on ${nameOf(node)}`);
    }
  }
  for (const rule of results.incomplete) {
    for (const node of rule.nodes) {
      if (rule.id === 'video-caption') add(rule.id, node, `video-caption needs review on ${nameOf(node)}`);
      if (rule.id !== 'color-contrast') continue;
      const { reason, expected } = dataOf(node);
      if (arg.reviewFails.includes(reason)) {
        add(rule.id, node, `color-contrast needs review (${reason}) on ${nameOf(node)}`);
      } else if (reason === arg.gradient && node.element) {
        const problem = gradient(node.element, Number.isFinite(expected) ? expected : 4.5);
        if (problem !== null) add(rule.id, node, `color-contrast on ${nameOf(node)}: ${problem}`);
      }
    }
  }
  return hits;
}

/**
 * `a11y-axe`: no axe violation with the tags of section 8, in every declared theme. One tab at 1280×800, with axe
 * injected once; each theme state of the Themes walk in turn. A rule reports a node once, in the first theme that
 * fails it.
 */
export const axeRule: BrowserRule = {
  id: 'a11y-axe',
  pages: 'tested',
  check: async (check) => {
    const tab = await check.open({ viewport: DESKTOP });
    await tab.evaluate(axeScript());
    const argument: AxeArgument = {
      options: AXE_OPTIONS,
      enhanced: AXE_ENHANCED,
      reviewFails: AXE_REVIEW_FAILS,
      gradient: AXE_GRADIENT,
      running: RUNNING_TEXT,
      notRunning: NOT_RUNNING_TEXT,
    };
    const seen = new Set<string>();
    for (const state of statesOf(check)) {
      if (state !== undefined) await applyTheme(tab, state);
      for (const hit of await tab.evaluate(runAxe, argument)) {
        if (seen.has(hit.key)) continue;
        seen.add(hit.key);
        check.report(`${themeLabel(DESKTOP, state)}: ${hit.text}`);
      }
    }
  },
};

// contrast-pairs

/** The ratio that each role of a contrast pair needs (7.4). */
export const ROLE_RATIOS: ReadonlyMap<string, number> = new Map([
  ['text', 7],
  ['ui', 4.5],
  ['non-text', 3],
]);

/**
 * Page code: the contrast of each pair. A probe element takes the foreground as `color` and the background as
 * `background-color`; both computed colors are painted, the background is composited over white and the
 * foreground over that.
 */
function pairRatios(pairs: readonly { foreground: string; background: string }[]): number[] {
  const kit = window.__astroKit;
  const probe = document.createElement('span');
  document.body.append(probe);
  try {
    return pairs.map((pair) => {
      probe.style.setProperty('color', `var(${pair.foreground})`);
      probe.style.setProperty('background-color', `var(${pair.background})`);
      const style = getComputedStyle(probe);
      const behind = kit.over(kit.pixel(style.backgroundColor), [255, 255, 255, 255]);
      return kit.contrast(kit.over(kit.pixel(style.color), behind), behind);
    });
  } finally {
    probe.remove();
  }
}

/** `contrast-pairs`: on the default home, in every declared theme, each pair of `docs/design.md` meets its role. */
export const contrastPairs: BrowserRule = {
  id: 'contrast-pairs',
  pages: 'home',
  check: async (check) => {
    const pairs: ContrastPair[] = (check.run.design?.pairs ?? []).filter((pair) => ROLE_RATIOS.has(pair.role));
    if (pairs.length === 0) return;
    const tab = await check.open({ viewport: DESKTOP });
    const tokens = pairs.map((pair) => ({ foreground: pair.foreground, background: pair.background }));
    for (const state of statesOf(check)) {
      if (state !== undefined) await applyTheme(tab, state);
      const ratios = await tab.evaluate(pairRatios, tokens);
      for (const [index, pair] of pairs.entries()) {
        const ratio = ratios[index] ?? 0;
        const least = ROLE_RATIOS.get(pair.role) ?? 0;
        if (ratio >= least) continue;
        const where = state === undefined ? 'the page' : `the ${state.theme} theme`;
        check.report(
          `${where}: ${pair.foreground} on ${pair.background} has ${ratioText(ratio)}:1; the role ${pair.role} ` +
            `needs ${least}:1 (docs/design.md, line ${pair.line})`,
        );
      }
    }
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

/** The most aliases that `designColor` follows. `design-format` refuses a circle; this bound keeps hostile input finite. */
const ALIAS_DEPTH = 32;

/**
 * The design value of a color token in a theme (7.4 and 7.7): the cell with its fallback along the themes, and an
 * alias `var(--color-…)` replaced with the value of the token it names, in the same theme. `undefined` when no
 * value exists.
 */
export function designColor(design: Pick<Design, 'colors'>, name: string, theme: Theme): string | undefined {
  const byName = new Map(design.colors.map((color) => [color.name, color]));
  let current = name;
  for (let depth = 0; depth <= ALIAS_DEPTH; depth += 1) {
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
 * (`var(<token>)`) and of a reference painted with the design value, both painted on the canvas. A design value
 * that is no color gives an empty reference.
 */
function readColors(expected: readonly ExpectedColor[]): ColorReading {
  const kit = window.__astroKit;
  const probe = document.createElement('span');
  const reference = document.createElement('span');
  document.body.append(probe, reference);
  try {
    const colors = expected.map((color) => {
      probe.style.setProperty('background-color', `var(${color.name})`);
      reference.style.removeProperty('background-color');
      reference.style.setProperty('background-color', color.value);
      const set = reference.style.getPropertyValue('background-color') !== '';
      return {
        name: color.name,
        probe: kit.pixel(getComputedStyle(probe).backgroundColor),
        reference: set ? kit.pixel(getComputedStyle(reference).backgroundColor) : [],
      };
    });
    return { scheme: getComputedStyle(document.documentElement).colorScheme, colors };
  } finally {
    probe.remove();
    reference.remove();
  }
}

/** The text of a system state in a finding: `system dark, contrast more`. */
const systemText = (state: SystemState): string => `system ${state.scheme}, contrast ${state.contrast}`;

/**
 * Emulates each system state and compares the probe of every color token with its design value in the theme that
 * `themeFor` gives, and, when `scheme` is given, the computed `color-scheme` of `html` with it.
 */
async function compareColors(
  check: Check,
  tab: Page,
  design: Design,
  label: string,
  themeFor: (state: SystemState) => Theme,
  scheme: string | undefined,
): Promise<void> {
  for (const state of SYSTEM_STATES) {
    await tab.emulateMedia({ colorScheme: state.scheme, contrast: state.contrast });
    await settle(tab);
    const theme = themeFor(state);
    const expected: ExpectedColor[] = design.colors.map((color) => ({
      name: color.name,
      value: designColor(design, color.name, theme) ?? '',
    }));
    const reading = await tab.evaluate(readColors, expected);
    const where = `${label}, ${systemText(state)}`;
    const shown = reading.scheme.replace(/\s+/g, ' ').trim();
    if (scheme !== undefined && shown !== scheme) {
      check.report(`${where}: html has color-scheme "${shown}", 7.7 expects "${scheme}"`);
    }
    for (const color of reading.colors) {
      if (samePixel(color.probe, color.reference)) continue;
      check.report(
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
 * first, and the native invoker of the outermost one: the first `summary` of a `details`, a `[popovertarget]` or a
 * `[commandfor]` with `show-popover` or `toggle-popover` for a popover, a `[commandfor]` with `show-modal` for a
 * dialog.
 */
function nextInvoker(): InvokerStep {
  const kit = window.__astroKit;
  const control = document.querySelector('[data-mode-switch]');
  if (control === null) return { invoker: null, problem: 'the page has no [data-mode-switch] element', closed: 0 };
  const closed: Element[] = [];
  for (let node: Element | null = control; node !== null; node = node.parentElement) {
    const shut =
      (node instanceof HTMLDetailsElement && !node.open) ||
      (node instanceof HTMLDialogElement && !node.open) ||
      (node instanceof HTMLElement &&
        !(node instanceof HTMLDialogElement) &&
        node.hasAttribute('popover') &&
        !node.matches(':popover-open'));
    if (shut) closed.unshift(node);
  }
  const outer = closed[0];
  if (outer === undefined) return { invoker: null, problem: null, closed: 0 };
  let invoker: Element | null = null;
  if (outer instanceof HTMLDetailsElement) invoker = outer.querySelector(':scope > summary');
  else {
    for (const candidate of document.querySelectorAll('[popovertarget], [commandfor]')) {
      if (candidate instanceof HTMLButtonElement || candidate instanceof HTMLInputElement) {
        if (candidate.hasAttribute('popovertarget') && candidate.popoverTargetElement === outer) invoker = candidate;
        if (candidate instanceof HTMLButtonElement && candidate.commandForElement === outer) {
          const command = (candidate.getAttribute('command') ?? '').toLowerCase();
          const opens =
            outer instanceof HTMLDialogElement
              ? command === 'show-modal'
              : command === 'show-popover' || command === 'toggle-popover';
          if (opens) invoker = candidate;
        }
      }
      if (invoker !== null) break;
    }
  }
  const name = kit.describe(outer);
  if (invoker === null) return { invoker: null, problem: `no native invoker opens ${name}`, closed: closed.length };
  if (!kit.visible(invoker)) {
    return { invoker: null, problem: `${kit.describe(invoker)}, the invoker of ${name}, is not visible`, closed: 0 };
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
      await settle(tab);
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
    await settle(tab);
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

/** The JavaScript part of `modes-behavior` at one viewport, in a context of its own (a fresh stored mode). */
async function withScripts(check: Check, viewport: Viewport, design: Design): Promise<void> {
  const options = check.run.options;
  const label = sizeText(viewport);
  const context: BrowserContext = await check.context();
  await context.addInitScript(watchMode);
  const tab = await check.open({ viewport, context });
  const watch = await tab.evaluate(() => window.__astroKitMode ?? { appeared: false, body: false });
  if (!watch.appeared) check.report(`${label}: html gets no data-mode`);
  else if (watch.body) check.report(`${label}: data-mode appears on html only after body exists`);
  const closed = await openSwitch(tab);
  if (closed !== null) {
    check.report(`${label}: ${closed}`);
    return;
  }
  const visible = await tab.evaluate(() => {
    const control = document.querySelector('[data-mode-switch]');
    return control !== null && window.__astroKit.visible(control);
  });
  if (!visible) {
    check.report(`${label}: the mode switch is not visible`);
    return;
  }
  const order = chooseOrder(enabledModes(options), defaultMode(options));
  for (const option of order) {
    const problem = await choose(tab, option);
    if (problem !== null) {
      check.report(`${label}: ${problem}`);
      continue;
    }
    const { mode } = await tab.evaluate(shownMode, option);
    if (mode !== option) {
      check.report(`${label}: after the choice of ${option}, html has data-mode ${JSON.stringify(mode)}`);
    }
    const scheme = modeScheme(design, option);
    const themeFor = (state: SystemState): Theme => themeOf(option, state, design.themes);
    await compareColors(check, tab, design, `${label}, ${option} chosen`, themeFor, scheme);
  }
  const last = order.at(-1);
  if (last === undefined) return;
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
    const shown: { mode: string | null; shows: boolean } = await tab.evaluate(shownMode, last);
    const { mode, shows } = shown;
    if (mode !== last)
      check.report(`${label}: after ${visit.name}, html has data-mode ${JSON.stringify(mode)}, not ${last}`);
    if (!shows) check.report(`${label}: after ${visit.name}, the switch does not show ${last}`);
  }
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
  await compareColors(check, tab, design, label, themeFor, undefined);
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
      await withScripts(check, viewport, design);
      await withoutScripts(check, viewport, design);
    }
  },
};

/** The rules of this file. `src/browser/rules.ts` puts every rule in the order of section 8. */
export const COLOR_RULES: readonly BrowserRule[] = [modesBehavior, axeRule, contrastPairs];

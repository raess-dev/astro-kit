/**
 * The keyboard rules of the browser stage (specification, section 8): `a11y-focus`, `a11y-keyboard` and
 * `a11y-no-js`. Each rule measures one tested page through its `Check` and reports each failing place with
 * `check.report(detail)`.
 *
 * `a11y-focus` and `a11y-keyboard` measure in the same states: 1280×800, 390×844, and 390×844 after the reveal
 * step (the page, then each dialog by itself). In each state a sweep (section 8, Measurement details) presses Tab
 * until stops + 5 presses count, and the rule measures the focused element after each press. A rule reports an
 * element once in a state, at the first press that fails it.
 */
import { errors, type Page } from 'playwright-core';
import { defaultMode, SYSTEM_STATES, themeOf } from '../modes.ts';
import type { FormField } from '../options.ts';
import {
  applyTheme,
  type BrowserRule,
  type Check,
  DESKTOP,
  NARROW,
  type RingFloor,
  reveal,
  settle,
  sizeText,
  sweep,
  themeStates,
  type Viewport,
} from './harness.ts';

/** What a keyboard rule keeps in the page during one state: the stops before the first press, and its findings. */
interface KeyboardState {
  /** The stops of the state (`window.__astroKit.stops()`), taken before the first press. */
  stops: Element[];
  /** The elements that the rule reported in this state. */
  reported: Set<Element>;
  /** The details of the findings of this state, without the state, in the order of the presses. */
  found: string[];
}

declare global {
  interface Window {
    /** The state of the keyboard rule that measures now. `beginState` sets it. */
    __astroKitKeyboard?: KeyboardState | undefined;
  }
}

/** Starts a state in the page: takes the stops and empties the findings. Page code. */
function beginState(): void {
  window.__astroKitKeyboard = { stops: window.__astroKit.stops(), reported: new Set(), found: [] };
}

/** The findings of the state, and the end of the state. Page code. */
function endState(): string[] {
  const found = window.__astroKitKeyboard?.found ?? [];
  window.__astroKitKeyboard = undefined;
  return found;
}

/**
 * The states of `a11y-focus` and `a11y-keyboard`: a fresh tab at 1280×800, a fresh tab at 390×844, and that tab
 * after the reveal step. `measure` runs in each state, with the label of the state.
 */
async function eachState(check: Check, measure: (tab: Page, label: string) => Promise<void>): Promise<void> {
  const viewports: readonly Viewport[] = [DESKTOP, NARROW];
  for (const viewport of viewports) {
    const tab = await check.open({ viewport });
    await measure(tab, sizeText(viewport));
    if (viewport === NARROW) await reveal(tab, (state) => measure(tab, state.label));
  }
}

// a11y-focus

/** The least width of a focus ring, in CSS pixels. */
export const FOCUS_RING_PX = 2;

/** The least contrast of a focus ring against the color behind it (WCAG 1.4.11, non-text). */
export const FOCUS_RING_CONTRAST = 3;

const RING: RingFloor = { px: FOCUS_RING_PX, contrast: FOCUS_RING_CONTRAST, colorOnly: false };
const RING_COLOR: RingFloor = { ...RING, colorOnly: true };

/**
 * Measures the ring of the focused element (`a11y-focus`, page code) with `focusRing`: its width, its style and its
 * contrast. A fail is recorded once per element in the state.
 */
function measureFocus(least: RingFloor): void {
  const state = window.__astroKitKeyboard;
  const found = window.__astroKit.focusRing(least);
  if (state === undefined || found === null || state.reported.has(found.element)) return;
  state.reported.add(found.element);
  state.found.push(found.detail);
}

/**
 * Focuses each stop in turn as the keyboard would, ends its animations, and measures its ring (page code): the
 * details of the failing rings, once per element. `focus()` and the computed style are synchronous, so one call
 * measures every stop.
 */
function measureStops(least: RingFloor): string[] {
  const helpers = window.__astroKit;
  const reported = new Set<Element>();
  const found: string[] = [];
  for (const stop of helpers.stops()) {
    if (!(stop instanceof HTMLElement || stop instanceof SVGElement)) continue;
    stop.focus({ focusVisible: true } as FocusOptions);
    helpers.finish();
    const ring = helpers.focusRing(least);
    if (ring === null || reported.has(ring.element)) continue;
    reported.add(ring.element);
    found.push(ring.detail);
  }
  return found;
}

/** The element that a detail of `a11y-focus` names: the text before ` shows `. */
export const ringOwner = (detail: string): string => detail.slice(0, Math.max(0, detail.indexOf(' shows ')));

/**
 * The other themes of `a11y-focus`: in each declared theme that a fresh tab does not show, reached as Themes says,
 * at 1280×800, each stop takes the focus in turn and is measured. A ring can pass in one theme and vanish in
 * another. No Tab press is needed beyond the first, which makes the focus come from the keyboard. An element that
 * the fresh 1280×800 tab already reported (`known`, by `ringOwner`) is not reported again.
 */
async function themeState(check: Check, known: ReadonlySet<string>): Promise<void> {
  const themes = check.run.design?.themes ?? [];
  // A fresh tab has the default mode and the first system state: light, with no contrast preference.
  const fresh = SYSTEM_STATES[0];
  if (fresh === undefined) return;
  const shown = themeOf(defaultMode(check.run.options), fresh, themes);
  const others = themeStates(check.run.options, themes).filter((state) => state.theme !== shown);
  if (others.length === 0) return;
  // One tab for every theme: a theme state only sets `data-mode` and the emulated media, so no reload is needed.
  const tab = await check.open({ viewport: DESKTOP });
  await tab.keyboard.press('Tab');
  for (const state of others) {
    await applyTheme(tab, state);
    for (const detail of await tab.evaluate(measureStops, RING_COLOR)) {
      if (!known.has(ringOwner(detail))) check.report(`${sizeText(DESKTOP)} in the ${state.theme} theme: ${detail}`);
    }
  }
}

/** The kinds of element that `a11y-focus` clicks with the mouse, in order. */
export const CLICKED: readonly string[] = ['a[href]', 'button', 'summary'];

/** Where a mouse click hits an element: a point in the viewport and the place of the element in its list. */
interface ClickPoint {
  x: number;
  y: number;
  index: number;
}

/**
 * The first element of a kind that a mouse click can hit (page code): visible, scrolled to the center, and hit by
 * `elementFromPoint` at the center of one of its line boxes. `null` when there is none.
 */
function clickPoint(selector: string): ClickPoint | null {
  const helpers = window.__astroKit;
  const elements = [...document.querySelectorAll(selector)];
  for (const [index, element] of elements.entries()) {
    if (!helpers.visible(element)) continue;
    element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
    for (const box of helpers.boxes(element)) {
      const x = (box.left + box.right) / 2;
      const y = (box.top + box.bottom) / 2;
      const hit = document.elementFromPoint(x, y);
      if (hit !== null && (hit === element || element.contains(hit))) return { x, y, index };
    }
  }
  return null;
}

/** The outline of an element after a mouse click (page code): a text when it shows one, else `null`. */
function clickedOutline(input: { selector: string; index: number }): string | null {
  const element = document.querySelectorAll(input.selector)[input.index];
  if (element === undefined) return null;
  const style = getComputedStyle(element);
  if (style.outlineStyle === 'none' || Number.parseFloat(style.outlineWidth) === 0) return null;
  return `${window.__astroKit.describe(element)} shows the outline ${style.outlineWidth} ${style.outlineStyle}`;
}

/**
 * The mouse part of `a11y-focus`: on a fresh 1280×800 tab, a click on the first link, button and summary that a
 * click can hit. A capturing listener cancels each click, so no link navigates, no summary toggles and no invoker
 * acts. The element then shows no outline, or one of width 0.
 */
async function clickState(check: Check): Promise<void> {
  const tab = await check.open({ viewport: DESKTOP });
  await tab.evaluate(() => {
    window.addEventListener('click', (event) => event.preventDefault(), { capture: true });
  });
  for (const selector of CLICKED) {
    const point = await tab.evaluate(clickPoint, selector);
    if (point === null) continue;
    await tab.mouse.click(point.x, point.y);
    await settle(tab);
    const shown = await tab.evaluate(clickedOutline, { selector, index: point.index });
    if (shown !== null) check.report(`${sizeText(DESKTOP)} after a mouse click: ${shown}`);
  }
}

/**
 * `a11y-focus`: the first Tab and every sweep stop show a focus ring of at least 2 px with a contrast of at least 3:1
 * against the color behind it, also in the other themes; a mouse click shows none.
 */
export const focus: BrowserRule = {
  id: 'a11y-focus',
  pages: 'tested',
  check: async (check) => {
    let firstTab = true;
    const known = new Set<string>();
    await eachState(check, async (tab, label) => {
      await tab.evaluate(beginState);
      // The first Tab of the fresh 1280×800 tab belongs to that state, so an element that fails there reports once.
      if (firstTab) {
        firstTab = false;
        await tab.keyboard.press('Tab');
        await settle(tab);
        await tab.evaluate(measureFocus, RING);
      }
      await sweep(tab, () => tab.evaluate(measureFocus, RING));
      for (const detail of await tab.evaluate(endState)) {
        if (label === sizeText(DESKTOP)) known.add(ringOwner(detail));
        check.report(`${label}: ${detail}`);
      }
    });
    await themeState(check, known);
    await clickState(check);
  },
};

// a11y-keyboard

/** The inset of the corner samples from the edges of a line box, in CSS pixels. */
export const SAMPLE_INSET_PX = 2;

/**
 * Says whether the focused element is entirely covered (`a11y-keyboard`, page code; 13.1 item 33). Each line box on
 * screen is clipped to the viewport and sampled at its center and its four corners, inset 2 px. A sample hits the
 * element when `elementFromPoint` gives the element, an element inside it, or one of its labels. A sample inside a
 * popover that the reveal step showed is no cover either: the visitor opened it and closes it with Esc (WCAG
 * 2.4.11). An element with no line box on screen is not seen. A fail is recorded once per element in the state.
 */
function measureCover(inset: number): void {
  const state = window.__astroKitKeyboard;
  const helpers = window.__astroKit;
  const active = document.activeElement;
  const root = helpers.root();
  if (state === undefined || active === null || active === root || active === document.body) return;
  if (!root.contains(active) || state.reported.has(active)) return;
  const labels = active instanceof HTMLInputElement ? [...(active.labels ?? [])] : [];
  const opened = helpers.revealed.filter((popover) => popover.matches(':popover-open') && !popover.contains(active));
  const hits = (element: Element | null): boolean =>
    element !== null &&
    (element === active ||
      active.contains(element) ||
      labels.some((label) => label.contains(element)) ||
      opened.some((popover) => popover.contains(element)));
  const width = document.documentElement.clientWidth;
  const height = document.documentElement.clientHeight;
  let cover: Element | null = null;
  let onScreen = false;
  for (const box of helpers.boxes(active)) {
    const left = Math.max(box.left, 0);
    const right = Math.min(box.right, width);
    const top = Math.max(box.top, 0);
    const bottom = Math.min(box.bottom, height);
    if (right <= left || bottom <= top) continue;
    onScreen = true;
    const x = Math.min(inset, (right - left) / 2);
    const y = Math.min(inset, (bottom - top) / 2);
    const center = document.elementFromPoint((left + right) / 2, (top + bottom) / 2);
    const corners = [
      [left + x, top + y],
      [right - x, top + y],
      [left + x, bottom - y],
      [right - x, bottom - y],
    ].map(([px = 0, py = 0]) => document.elementFromPoint(px, py));
    if (hits(center) || corners.some(hits)) return;
    cover ??= center;
  }
  state.reported.add(active);
  const name = helpers.describe(active);
  if (!onScreen) state.found.push(`${name} is not on screen`);
  else state.found.push(`${name} is covered${cover === null ? '' : ` by ${helpers.describe(cover)}`}`);
}

/**
 * The stops that the sweep did not reach (page code): a stop is reached when a press focused it; a radio group when
 * a press focused one of its radios.
 */
function unreached(presses: number): void {
  const state = window.__astroKitKeyboard;
  if (state === undefined) return;
  const forms = [...document.forms];
  const groupOf = (element: Element): string | null =>
    element instanceof HTMLInputElement && element.type === 'radio' && element.name !== ''
      ? `${element.form === null ? -1 : forms.indexOf(element.form)} ${element.name}`
      : null;
  const focused = new Set(window.__astroKit.focused);
  const groups = new Set(window.__astroKit.focused.map(groupOf).filter((group) => group !== null));
  for (const stop of state.stops) {
    const group = groupOf(stop);
    if (focused.has(stop) || (group !== null && groups.has(group))) continue;
    state.found.push(`${window.__astroKit.describe(stop)} is not reached within ${presses} Tab presses`);
  }
}

/** `a11y-keyboard`: Tab reaches every visible control within stops + 5 presses, and no focused element is covered. */
export const keyboard: BrowserRule = {
  id: 'a11y-keyboard',
  pages: 'tested',
  check: async (check) => {
    await eachState(check, async (tab, label) => {
      await tab.evaluate(beginState);
      const { presses } = await sweep(tab, () => tab.evaluate(measureCover, SAMPLE_INSET_PX));
      await tab.evaluate(unreached, presses);
      for (const detail of await tab.evaluate(endState)) check.report(`${label}: ${detail}`);
    });
  },
};

// a11y-no-js

/** One link target or named control that is visible in a state. */
interface Shown {
  /** `link <absolute URL>`, or the kind and the name of a control. */
  key: string;
  /** The text in a finding: `the link to /zimmer/`, `button "Menü"`. */
  text: string;
}

/** The ARIA roles of a control that `a11y-no-js` reads besides the native controls. */
export const CONTROL_ROLES: readonly string[] = [
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
];

/**
 * The visible link targets and named controls of the document, outside `[data-mode-switch]` (page code). The name
 * of a control is the text of its `aria-labelledby` elements, else its `aria-label`, else the text of its labels,
 * else the value of an input button or the `alt` of an image input, else its own text, else its `title`.
 */
function shownTargets(roles: readonly string[]): Shown[] {
  const helpers = window.__astroKit;
  const clean = (text: string | null | undefined): string => (text ?? '').replace(/\s+/g, ' ').trim();
  const nameOf = (element: Element): string => {
    const ids = clean(element.getAttribute('aria-labelledby'));
    if (ids !== '') {
      const text = clean(
        ids
          .split(' ')
          .map((id) => document.getElementById(id)?.textContent ?? '')
          .join(' '),
      );
      if (text !== '') return text;
    }
    const label = clean(element.getAttribute('aria-label'));
    if (label !== '') return label;
    if (
      element instanceof HTMLInputElement ||
      element instanceof HTMLSelectElement ||
      element instanceof HTMLTextAreaElement ||
      element instanceof HTMLButtonElement
    ) {
      const labels = clean([...(element.labels ?? [])].map((one) => one.textContent ?? '').join(' '));
      if (labels !== '') return labels;
    }
    if (element instanceof HTMLInputElement) {
      if (['button', 'submit', 'reset'].includes(element.type)) return clean(element.value);
      if (element.type === 'image') return clean(element.alt);
      return clean(element.title);
    }
    if (element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement) return clean(element.title);
    return clean(element.textContent) || clean(element.getAttribute('title'));
  };
  const selector = [
    'a[href]',
    'button',
    'input:not([type="hidden" i])',
    'select',
    'textarea',
    'summary',
    ...roles.map((role) => `[role="${role}"]`),
  ].join(', ');
  const shown: Shown[] = [];
  for (const element of document.querySelectorAll(selector)) {
    if (element.closest('[data-mode-switch]') !== null || !helpers.visible(element)) continue;
    if (element instanceof HTMLAnchorElement) {
      shown.push({ key: `link ${element.href}`, text: `the link to ${element.getAttribute('href') ?? ''}` });
      continue;
    }
    const name = nameOf(element);
    if (name === '') continue;
    const role = element.getAttribute('role');
    const kind =
      role !== null && roles.includes(role)
        ? `[role=${role}]`
        : element instanceof HTMLInputElement
          ? `input[type=${element.type}]`
          : element.localName;
    shown.push({ key: `${kind} ${name}`, text: `${kind} "${name.length > 40 ? `${name.slice(0, 39)}…` : name}"` });
  }
  return shown;
}

/** The text of the states of `a11y-no-js` in a finding. */
const NO_JS_LABEL = `${sizeText(NARROW)} after the reveal step with JS off`;

/** The visible link targets and named controls of a tab in every state of the reveal step, by key, in order. */
async function shownAfterReveal(tab: Page, onPage?: () => Promise<void>): Promise<Map<string, string>> {
  const shown = new Map<string, string>();
  await reveal(tab, async (state) => {
    if (state.kind === 'page' && onPage) await onPage();
    for (const item of await tab.evaluate(shownTargets, CONTROL_ROLES)) {
      if (!shown.has(item.key)) shown.set(item.key, item.text);
    }
  });
  return shown;
}

/** The values that `a11y-no-js` fills in (section 8, `a11y-no-js`). */
export const FORM_TEXT = 'Kit browser test';
export const FORM_EMAIL = 'probe@example.com';
export const FORM_TEL = '+41441234567';

/** The days from today to the date that `a11y-no-js` fills in. */
export const FORM_DATE_DAYS = 30;

const DAY_MS = 86_400_000;

/**
 * The value that `a11y-no-js` fills into a field: the texts above, the date today + 30 days (`YYYY-MM-DD`, UTC),
 * a number its `min`, a choice its first option. A consent is checked, so its value is `on`.
 */
export function formValue(field: FormField, now: number): string {
  switch (field.type) {
    case 'email':
      return FORM_EMAIL;
    case 'tel':
      return FORM_TEL;
    case 'date':
      return new Date(now + FORM_DATE_DAYS * DAY_MS).toISOString().slice(0, 10);
    case 'number':
      return String(field.min ?? 0);
    case 'choice':
      return field.options?.[0] ?? '';
    case 'consent':
      return 'on';
    default:
      return FORM_TEXT;
  }
}

/** The longest wait for a submitted form to land on its page. */
export const FORM_LIMIT_MS = 10_000;

/** The path of the endpoint of a declared form (9.1). */
export const formAction = (id: string): string => `/api/forms/${id}/`;

/** The submit controls of a form, as the first one is found. */
const SUBMIT = 'button:not([type]), button[type="submit" i], input[type="submit" i], input[type="image" i]';

/** The places of the forms that post to `action` among the forms of the document (page code). */
function formsOf(action: string): number[] {
  const places: number[] = [];
  for (const [index, form] of [...document.forms].entries()) {
    if (new URL(form.action, location.href).pathname === action) places.push(index);
  }
  return places;
}

/** What blocks the fill of one field of the form at `index` (page code): `null` when its control is visible. */
function fieldProblem(input: { index: number; name: string }): string | null {
  const control = document.forms[input.index]?.elements.namedItem(input.name);
  if (control === null || control === undefined) return `has no control for the field ${input.name}`;
  const first = control instanceof RadioNodeList ? control[0] : control;
  if (first === undefined || !window.__astroKit.visible(first)) return `shows no control for the field ${input.name}`;
  return null;
}

/** The name of the first control of the form at `index` that is not valid (page code), else `null`. */
function invalidField(index: number): string | null {
  for (const element of document.forms[index]?.elements ?? []) {
    const valid =
      element instanceof HTMLInputElement ||
      element instanceof HTMLSelectElement ||
      element instanceof HTMLTextAreaElement
        ? element.checkValidity()
        : true;
    if (!valid) return element.getAttribute('name') ?? element.localName;
  }
  return null;
}

/** The attribute that marks the native invoker of the dialog that holds a form (`markDialogInvoker`). */
const DIALOG_INVOKER = 'data-astro-kit-invoker';

/**
 * Marks the visible native invoker (`[commandfor][command=show-modal]`) of the closed dialog that holds a form, and
 * says whether it marked one (page code). A form in no dialog, or in an open one, needs none.
 */
function markDialogInvoker(index: number): boolean {
  const dialog = document.querySelectorAll('form')[index]?.closest('dialog');
  if (!dialog || dialog.open || dialog.id === '') return false;
  for (const invoker of document.querySelectorAll('[commandfor]')) {
    if (!(invoker instanceof HTMLButtonElement) || invoker.commandForElement !== dialog) continue;
    if ((invoker.getAttribute('command') ?? '').toLowerCase() !== 'show-modal') continue;
    if (!window.__astroKit.visible(invoker)) continue;
    invoker.setAttribute('data-astro-kit-invoker', '');
    return true;
  }
  return false;
}

/**
 * Fills and submits one declared form with JS off and gives the detail of a fail, or `null`. Each form gets a
 * fresh tab: after a submission that the CSP stops, Playwright takes no further click on that document (13.1
 * item 56). The tab first opens every `details` and popover, as the reveal step does, so a form inside one can be
 * filled, and then the dialog that holds the form through its native invoker. The fields are filled in their
 * declared order.
 */
async function submitForm(check: Check, fields: readonly FormField[], index: number): Promise<string | null> {
  const tab = await check.open({ viewport: NARROW, javaScript: false });
  await tab.evaluate(() => window.__astroKit.openAll());
  await settle(tab);
  // A form inside a closed dialog: a click on the dialog's visible native invoker opens it, as a visitor does.
  if (await tab.evaluate(markDialogInvoker, index)) {
    // Before the click, the popovers that do not hold the invoker close, so none of them covers it. The ones that
    // hold it stay open for the click, and close after it, as a modal dialog closes them for a visitor.
    await tab.evaluate(
      (marker) => window.__astroKit.restorePopovers(document.querySelector(`[${marker}]`)),
      DIALOG_INVOKER,
    );
    await tab.locator(`[${DIALOG_INVOKER}]`).first().click();
    await tab.evaluate(() => window.__astroKit.restorePopovers());
    await settle(tab);
  }
  for (const field of fields) {
    const problem = await tab.evaluate(fieldProblem, { index, name: field.name });
    if (problem !== null) return problem;
  }
  const form = tab.locator('form').nth(index);
  const now = Date.now();
  for (const field of fields) {
    const value = formValue(field, now);
    // A declared name matches ^[a-z][a-z0-9_]*$ and an option ^[a-z0-9][a-z0-9-]*$, so neither needs quoting.
    const control = form.locator(`[name="${field.name}"]`).first();
    if (field.type === 'consent') await control.check();
    else if (field.type !== 'choice') await control.fill(value);
    else if (await control.evaluate((element) => element instanceof HTMLSelectElement)) {
      await control.selectOption(value);
    } else await form.locator(`[name="${field.name}"][value="${value}"]`).check();
  }
  const invalid = await tab.evaluate(invalidField, index);
  if (invalid !== null) return `is not valid after the fill: the field ${invalid}`;
  const submit = form.locator(SUBMIT).first();
  if ((await submit.count()) === 0) return 'has no submit button';
  const start = new URL(tab.url());
  // The wait starts before the click, so it also sees a navigation that ends before the click returns.
  const landed = tab.waitForURL((url) => url.href !== start.href, { timeout: FORM_LIMIT_MS, waitUntil: 'load' });
  landed.catch(() => undefined);
  await submit.click({ noWaitAfter: true });
  try {
    await landed;
  } catch (error) {
    if (error instanceof errors.TimeoutError) return `does not leave the page within ${FORM_LIMIT_MS / 1000} s`;
    throw error;
  }
  const end = new URL(tab.url());
  const want = `${start.pathname}#sent`;
  if (`${end.pathname}${end.hash}` !== want) return `lands on ${end.pathname}${end.hash}, not on ${want}`;
  const sent = await tab.evaluate(() => {
    const element = document.getElementById('sent');
    return element !== null && window.__astroKit.visible(element);
  });
  return sent ? null : `lands on ${want}, but #sent is not visible`;
}

/** `a11y-no-js`: with JavaScript off, the content and the controls show, and each declared form reaches `#sent`. */
export const noJs: BrowserRule = {
  id: 'a11y-no-js',
  pages: 'tested',
  check: async (check) => {
    const on = await shownAfterReveal(await check.open({ viewport: NARROW }));
    const offTab = await check.open({ viewport: NARROW, javaScript: false });
    const off = await shownAfterReveal(offTab, async () => {
      const seen = await offTab.evaluate(() => ({
        h1: [...document.querySelectorAll('h1')].some((element) => window.__astroKit.visible(element)),
        main: [...document.querySelectorAll('main')].some((element) => window.__astroKit.visible(element)),
      }));
      if (!seen.h1) check.report(`${NO_JS_LABEL}: no h1 is visible`);
      if (!seen.main) check.report(`${NO_JS_LABEL}: no main is visible`);
    });
    for (const [key, text] of on) if (!off.has(key)) check.report(`${NO_JS_LABEL}: ${text} is not visible`);
    // The declared forms that the page holds with JS off. The reveal step does not change `document.forms`.
    const forms = Object.entries(check.run.options.forms ?? {});
    for (const [id, form] of forms) {
      for (const index of await offTab.evaluate(formsOf, formAction(id))) {
        const problem = await submitForm(check, form.fields, index);
        if (problem !== null) check.report(`${sizeText(NARROW)} with JS off: the form ${id} ${problem}`);
      }
    }
  },
};

/** The rules of this file. `src/browser/rules.ts` puts every rule in the order of section 8. */
export const KEYBOARD_RULES: readonly BrowserRule[] = [focus, keyboard, noJs];

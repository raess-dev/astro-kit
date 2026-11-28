/**
 * The browser half of `legal-approved` (specification, section 8): on each declared legal page that is built, the
 * text that a visitor is shown in `main` is the whole text of `main`. The build half (`checkLock` in
 * `src/audit/site.ts`) locks the whole text and fails hiding markup; this half fails what CSS does: a part that CSS
 * hides, and text that a pseudo-element adds. It runs in every `astro-kit test`, on the legal pages only, with or
 * without `--all`.
 *
 * The code that runs in the page is a callback of `page.evaluate`. Playwright sends its source to the page, so a
 * callback reads nothing outside itself: every value it needs comes in as its argument.
 */
import type { Page } from 'playwright-core';
import { lockedText } from '../audit/dom.ts';
import { LOCK_FILE } from '../context.ts';
import { sha256 } from '../csp.ts';
import { type BrowserRule, type Check, DESKTOP, NARROW, sizeText, type Viewport } from './harness.ts';

/** The viewports of the check, in order: the first one with a finding ends the check of the page. */
export const LEGAL_VIEWPORTS: readonly Viewport[] = [DESKTOP, NARROW];

/** The most characters of a text that a finding quotes. */
export const QUOTE_MAX = 60;

/**
 * The first place in `main` where the shown text and the whole text differ, as the detail of a finding, or `null`
 * when they are equal. Both texts are read in one walk of `main` in document order: the data of each text node,
 * and a line feed for each `br`, as the build reads the text (`textOf`); then each run of white space is one space,
 * in NFC, trimmed. A text node with only white space counts as shown. Any other text node is not shown when:
 *
 * - its parent fails `checkVisibility` with the visibility and the opacity properties (`display: none` on it or
 *   around it, a skipped `content-visibility: hidden` subtree such as a closed `details` or `hidden="until-found"`,
 *   `visibility: hidden` or `collapse`, `opacity: 0` on it or around it);
 * - its color or its text fill color is fully transparent;
 * - it has no box of at least 1×1 CSS pixel (`font-size: 0`, a transform that scales it to 0, a replaced element);
 * - an element around it has a `clip-path` or a `mask` other than `none`, or a `clip` other than `auto` while it is
 *   absolutely positioned;
 * - every box of it lies outside the box of an element around it that clips (`overflow` `hidden` or `clip` on an
 *   axis, or `contain` with `paint`), or entirely left of or above the page, or, with no element around it that
 *   scrolls on that axis, entirely right of the viewport.
 *
 * Before that walk: each element of `main` (`main` included) whose `::before` or `::after` is rendered with a
 * `content` that holds a string with a character other than white space, `attr()`, `counter()` or `counters()`, or
 * `open-quote` or `close-quote` with `quotes` other than `auto`, adds text; so does a list item whose `::marker` has
 * such a `content`, or whose `list-style-type` is a string or names an `@counter-style` rule of the page. The first
 * such element in document order is the finding, unless a hidden text comes before it.
 */
export function firstDifference(page: Page, quoteMax: number): Promise<string | null> {
  return page.evaluate((max) => {
    const main = document.querySelector('main');
    if (main === null) return null;
    const quote = (text: string): string => {
      const flat = text.replace(/\s+/g, ' ').trim();
      const chars = [...flat];
      return JSON.stringify(chars.length > max ? `${chars.slice(0, max).join('')}…` : flat);
    };
    const nameOf = (element: Element): string => {
      const id = element.id === '' ? '' : `#${element.id}`;
      const classes = [...element.classList].map((name) => `.${name}`).join('');
      return `${element.localName}${id}${classes}`;
    };
    const styles = new Map<Element, CSSStyleDeclaration>();
    const style = (element: Element): CSSStyleDeclaration => {
      let found = styles.get(element);
      if (found === undefined) {
        found = getComputedStyle(element);
        styles.set(element, found);
      }
      return found;
    };
    const around = (element: Element): Element[] => {
      const list: Element[] = [];
      for (let node: Element | null = element; node !== null; node = node.parentElement) list.push(node);
      return list;
    };
    const transparent = (color: string): boolean =>
      color === 'transparent' || /^rgba\(.*,\s*0\)$/.test(color) || /\/\s*0\)$/.test(color);

    // The names of the `@counter-style` rules of the page, at any depth of its same-origin style sheets.
    const counterStyles = new Set<string>();
    const readRules = (rules: CSSRuleList): void => {
      for (const rule of rules) {
        if (rule instanceof CSSCounterStyleRule) counterStyles.add(rule.name);
        if ('cssRules' in rule && rule.cssRules instanceof CSSRuleList) readRules(rule.cssRules);
      }
    };
    for (const sheet of [...document.styleSheets, ...document.adoptedStyleSheets]) {
      try {
        readRules(sheet.cssRules);
      } catch {
        // A sheet of another origin cannot be read; the CSP of the kit loads none.
      }
    }

    /** Says whether a `content` value adds text; `element` is the element of the pseudo-element. */
    const addsText = (content: string, element: Element): boolean => {
      if (content === 'none' || content === 'normal') return false;
      const strings = content.match(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g) ?? [];
      if (strings.some((text) => /[^\s"'\\]|\\[0-9a-fA-F]/.test(text.slice(1, -1).replace(/\\[aA]\s?/g, '')))) {
        return true;
      }
      const rest = content.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '');
      if (/\b(?:attr|counters?)\(/.test(rest)) return true;
      return /\b(?:open|close)-quote\b/.test(rest) && style(element).quotes !== 'auto';
    };
    /**
     * Says whether a pseudo-element of `element` with the style `computed` is shown: the nearest element with a box
     * is rendered and not at `opacity: 0` (its own `visibility` is not read, since the pseudo-element can override
     * it), and the pseudo-element is visible, not fully transparent and has a font size above 0.
     */
    const pseudoShown = (element: Element, computed: CSSStyleDeclaration): boolean => {
      let boxed: Element = element;
      while (style(boxed).display === 'contents' && boxed.parentElement !== null) boxed = boxed.parentElement;
      const rendered = boxed.checkVisibility({
        opacityProperty: true,
        checkOpacity: true,
        contentVisibilityAuto: false,
        checkVisibilityCSS: false,
        visibilityProperty: false,
      } as CheckVisibilityOptions);
      return (
        rendered &&
        computed.visibility === 'visible' &&
        computed.opacity !== '0' &&
        !transparent(computed.color) &&
        !transparent(computed.webkitTextFillColor) &&
        Number.parseFloat(computed.fontSize) > 0
      );
    };
    /** The first pseudo-element of `element` that adds shown text: `::marker` and `::before` (`start`), or `::after`. */
    const pseudoText = (element: Element, start: boolean): string | null => {
      if (start && style(element).display.includes('list-item')) {
        const markerStyle = getComputedStyle(element, '::marker');
        // A marker that no visitor is shown adds no text; `::before` is still read below.
        if (pseudoShown(element, markerStyle)) {
          const marker = markerStyle.content;
          if (marker !== 'normal' && addsText(marker, element)) {
            return `${nameOf(element)}::marker adds the text ${quote(marker)}`;
          }
          const type = style(element).listStyleType;
          if (type.startsWith('"') || type.startsWith("'") || counterStyles.has(type)) {
            return `${nameOf(element)}::marker adds the text of list-style-type ${quote(type)}`;
          }
        }
      }
      const pseudo = start ? '::before' : '::after';
      const computed = getComputedStyle(element, pseudo);
      if (computed.display !== 'none' && addsText(computed.content, element) && pseudoShown(element, computed)) {
        return `${nameOf(element)}${pseudo} adds the text ${quote(computed.content)}`;
      }
      return null;
    };

    const width = document.documentElement.clientWidth;
    /** Why a text node is not shown, or `null` when it is. */
    const hiddenBy = (text: Text, parent: Element): string | null => {
      // A `display: contents` element has no box, so `checkVisibility` is false for it and its box properties
      // (opacity, clip-path, overflow, content-visibility) do nothing. The nearest element with a box decides,
      // and `visibility`, which its text inherits, is read on the parent itself.
      let boxed: Element = parent;
      while (style(boxed).display === 'contents' && boxed.parentElement !== null) {
        boxed = boxed.parentElement;
      }
      const visible =
        style(parent).visibility === 'visible' &&
        boxed.checkVisibility({
          visibilityProperty: true,
          opacityProperty: true,
          checkVisibilityCSS: true,
          checkOpacity: true,
        } as CheckVisibilityOptions);
      if (!visible) return 'it is not rendered, or its visibility or opacity hides it';
      const own = style(parent);
      if (transparent(own.color) || transparent(own.webkitTextFillColor)) return 'its color is transparent';
      const range = document.createRange();
      range.selectNodeContents(text);
      let boxes = [...range.getClientRects()].filter((box) => box.width >= 1 && box.height >= 1);
      if (boxes.length === 0) return 'it has no box of at least 1×1 px';
      const chain = around(parent).filter((element) => style(element).display !== 'contents');
      for (const element of chain) {
        const computed = style(element);
        if (computed.contentVisibility === 'hidden') return `${nameOf(element)} has content-visibility: hidden`;
        if (computed.clipPath !== 'none') return `${nameOf(element)} has clip-path: ${computed.clipPath}`;
        const mask = computed.maskImage || computed.webkitMaskImage;
        if (mask !== undefined && mask !== '' && mask !== 'none') return `${nameOf(element)} has a mask`;
        if (computed.clip !== 'auto' && computed.clip !== '' && /absolute|fixed/.test(computed.position)) {
          return `${nameOf(element)} has clip: ${computed.clip}`;
        }
      }
      let scrollsX = false;
      for (const element of chain) {
        const computed = style(element);
        const clipsX = /hidden|clip/.test(computed.overflowX);
        const clipsY = /hidden|clip/.test(computed.overflowY);
        const paints = /paint|strict|content/.test(computed.contain);
        if (/auto|scroll/.test(computed.overflowX)) scrollsX = true;
        if (!clipsX && !clipsY && !paints) continue;
        const frame = element.getBoundingClientRect();
        boxes = boxes.filter(
          (box) =>
            (!(clipsX || paints) || (box.right > frame.left + 0.5 && box.left < frame.right - 0.5)) &&
            (!(clipsY || paints) || (box.bottom > frame.top + 0.5 && box.top < frame.bottom - 0.5)),
        );
        if (boxes.length === 0) return `${nameOf(element)} clips it`;
      }
      const onPage = boxes.filter(
        (box) => box.right + scrollX > 0 && box.bottom + scrollY > 0 && (scrollsX || box.left < width),
      );
      if (onPage.length === 0) return 'it lies outside the page';
      return null;
    };

    const full: string[] = [];
    const shown: string[] = [];
    let first: string | null = null;
    // An entry `{ closes }` stands for the end of an element: its `::after` comes after its children.
    const stack: (Node | { closes: Element })[] = [main];
    for (let item = stack.pop(); item !== undefined; item = stack.pop()) {
      if (!(item instanceof Node)) {
        first ??= pseudoText(item.closes, false);
        continue;
      }
      if (item.nodeType === Node.TEXT_NODE) {
        const text = item as Text;
        full.push(text.data);
        const parent = text.parentElement;
        const reason = /^\s*$/.test(text.data) || parent === null ? null : hiddenBy(text, parent);
        if (reason === null) shown.push(text.data);
        else first ??= `${quote(text.data)} in ${parent === null ? 'main' : nameOf(parent)} is not shown: ${reason}`;
        continue;
      }
      if (item.nodeType !== Node.ELEMENT_NODE) continue;
      const element = item as Element;
      if (element.localName === 'br') {
        full.push('\n');
        shown.push('\n');
        continue;
      }
      first ??= pseudoText(element, true);
      stack.push({ closes: element });
      for (let index = element.childNodes.length - 1; index >= 0; index -= 1) {
        const child = element.childNodes[index];
        if (child !== undefined) stack.push(child);
      }
    }
    const read = (parts: string[]): string => parts.join('').normalize('NFC').replace(/\s+/g, ' ').trim();
    if (first !== null) return first;
    // Every text node is shown and no pseudo-element adds text, so the two texts are equal; the comparison stays as
    // the statement of the rule.
    return read(full) === read(shown) ? null : 'the text that a visitor is shown differs from the whole text';
  }, quoteMax);
}

/** The attributes of the locked text, in its order: `LOCKED_ATTRIBUTES` of `src/audit/dom.ts`. */
const LIVE_ATTRIBUTES: readonly string[] = ['title', 'alt', 'aria-label', 'value', 'placeholder'];

/**
 * The locked text of the live `main` of a page, as Chromium holds it now: the same text as `lockedText` gives for the
 * built page (Measurement details, "The locked text"). The data of each text node of the first `main` in document
 * order, template content included (`template.content`), a line feed for each `br`, in NFC, each run of white space
 * as one space, trimmed; then, for each element of `main` in document order (`main` first, template content
 * included) and each attribute of the lock that it carries, in that order, one line feed and `<name>=<value>`, the
 * value read in the same way. `''` without a `main`.
 */
export function liveLockedText(page: Page): Promise<string> {
  return page.evaluate((names) => {
    const main = document.querySelector('main');
    if (main === null) return '';
    const read = (text: string): string => text.normalize('NFC').replace(/\s+/g, ' ').trim();
    const childrenOf = (node: Node): NodeListOf<ChildNode> =>
      node instanceof HTMLTemplateElement ? node.content.childNodes : node.childNodes;
    const parts: string[] = [];
    const lines: string[] = [];
    const stack: Node[] = [main];
    for (let node = stack.pop(); node !== undefined; node = stack.pop()) {
      if (node.nodeType === Node.TEXT_NODE) {
        parts.push((node as Text).data);
        continue;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) continue;
      const element = node as Element;
      for (const name of names) {
        const value = element.getAttribute(name);
        if (value !== null) lines.push(`${name}=${read(value)}`);
      }
      if (element.localName === 'br') {
        parts.push('\n');
        continue;
      }
      const children = childrenOf(element);
      for (let index = children.length - 1; index >= 0; index -= 1) {
        const child = children[index];
        if (child !== undefined) stack.push(child);
      }
    }
    return [read(parts.join('')), ...lines].join('\n');
  }, LIVE_ATTRIBUTES);
}

/**
 * The hash that the live text of a legal page must have: its entry in `legal.lock.json` when the file is a JSON
 * object with a text for the path, else the hash of the locked text of the built page. `source` names it for the
 * finding.
 */
function expectedHash(check: Check): { hash: string; source: string } {
  const built = sha256(lockedText(check.page.dom.page));
  const fromBuild = { hash: built, source: `the built page hashes to ${built}` };
  const lock = check.run.legalLock;
  if (lock === undefined) return fromBuild;
  try {
    const value: unknown = JSON.parse(lock);
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      const entry = (value as Record<string, unknown>)[check.page.where];
      if (typeof entry === 'string' && Object.hasOwn(value, check.page.where))
        return { hash: entry, source: `${LOCK_FILE} holds ${entry}` };
    }
  } catch {
    // The build half reports a broken file; the live text is compared with the build.
  }
  return fromBuild;
}

/**
 * `legal-approved`, browser half: in each viewport of `LEGAL_VIEWPORTS`, with JavaScript on, the hash of the live
 * locked text of `main` (`liveLockedText`) equals the entry of the page in `legal.lock.json` (or, without one, the
 * hash of the built page), and the text that a visitor is shown in `main` equals its whole text, and no pseudo-element in `main` adds text (`firstDifference`). One
 * finding for each page at most: the first viewport with a difference, and its first place.
 */
export const legalShown: BrowserRule = {
  id: 'legal-approved',
  pages: 'legal',
  concurrent: true,
  check: async (check) => {
    const expected = expectedHash(check);
    for (const viewport of LEGAL_VIEWPORTS) {
      const page = await check.open({ viewport });
      const live = sha256(await liveLockedText(page));
      if (live !== expected.hash) {
        check.report(`${sizeText(viewport)}: the live text of main hashes to ${live}, and ${expected.source}`);
        return;
      }
      const detail = await firstDifference(page, QUOTE_MAX);
      if (detail !== null) {
        check.report(`${sizeText(viewport)}: ${detail}`);
        return;
      }
    }
  },
};

export const LEGAL_RULES: readonly BrowserRule[] = [legalShown];

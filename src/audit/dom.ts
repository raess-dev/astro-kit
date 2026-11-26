/**
 * What the build audits share about built pages (specification, section 8 and its Measurement details): a page read
 * once as a list of elements, attributes, text, accessible names, labels, the CSP meta, scripts, robots, the hreflang
 * alternates and the links of a page, and the index of the site. The page, site, budgets and html audits all read
 * pages through this module, so that every rule sees the same document and no rule parses a page again.
 *
 * **Hostile input.** A page may have 2 MB, nest 5,000 elements deep, or hold odd bytes. So nothing here recurses
 * over the tree, and nothing is quadratic in the size of a page:
 *
 * - node-html-parser computes `rawText`, `text`, `textContent`, `innerText` and `structuredText` of an element by
 *   recursion: at 5,000 levels they throw `RangeError`. Read text only with `textOf` and the other text helpers.
 * - node-html-parser stores the attributes of an element in a plain object. An attribute named `constructor` or
 *   `hasOwnProperty` makes its `attributes`, `attrs` and `getAttribute` throw or lie, and hides the element from
 *   `querySelectorAll('a[href]')`. Read attributes only with `attr`, `hasAttr` and `attributesOf`, and find elements
 *   by tag in `PageDom.elements` or `byTag`, never with an attribute selector.
 *
 * Each helper caches what it reads in a `WeakMap` on the page or on the context, so a rule may call it freely.
 */
import { type HTMLElement, type Node, NodeType, TextNode } from 'node-html-parser';
import { type BuildContext, type BuiltPage, pagePathOf } from '../context.ts';
import { readAttributes } from '../inject.ts';
import type { Locale, Options } from '../options.ts';

// Rules

/** One rule of an audit: its id and its built half, which adds its findings to `ctx.report` and never throws. */
export interface AuditRule {
  id: string;
  run: (ctx: BuildContext) => void;
}

/**
 * Adds every item to a list, one by one. A spread (`list.push(...items)`) passes each item as an argument, so a long
 * list from a hostile page overflows the stack.
 */
export function pushAll<T>(list: T[], items: Iterable<T>): void {
  for (const item of items) list.push(item);
}

/** Runs the rules in their order. Returns the ids of the rules that ran. */
export function runRules(ctx: BuildContext, rules: readonly AuditRule[]): string[] {
  for (const rule of rules) rule.run(ctx);
  return rules.map((rule) => rule.id);
}

// Attributes

/** The ASCII lower case of a text. A tag or attribute name compares in it. */
const asciiLower = (text: string): string => text.replace(/[A-Z]+/g, (upper) => upper.toLowerCase());

/** The tag name of an element in ASCII lower case: `a`, `svg`, `astro-island`. The parse root gives `''`. */
export const tagOf = (element: HTMLElement): string => asciiLower(element.rawTagName ?? '');

const ATTRIBUTES = new WeakMap<HTMLElement, ReadonlyMap<string, string>>();

/** Decodes the character references of a text as node-html-parser decodes a text node. */
const decode = (raw: string): string => (raw.includes('&') ? new TextNode(raw, null).text : raw);

/**
 * The attributes of an element: names in ASCII lower case, values with character references decoded. The first
 * attribute of a name counts, as in HTML. A table, never an object: any name is safe.
 */
export function attributesOf(element: HTMLElement): ReadonlyMap<string, string> {
  let found = ATTRIBUTES.get(element);
  if (found === undefined) {
    const raw = readAttributes(element.rawAttrs ?? '', 0).attributes;
    const decoded = new Map<string, string>();
    for (const [name, value] of raw) decoded.set(name, decode(value));
    found = decoded;
    ATTRIBUTES.set(element, found);
  }
  return found;
}

/** The value of one attribute, or `undefined` when the element does not have it. The name is in lower case. */
export const attr = (element: HTMLElement, name: string): string | undefined => attributesOf(element).get(name);

/** Says whether the element has the attribute, with any value. The name is in lower case. */
export const hasAttr = (element: HTMLElement, name: string): boolean => attributesOf(element).has(name);

/** The tokens of an attribute that holds a list (`rel`, `class`), in ASCII lower case; none without the attribute. */
export function tokensOf(element: HTMLElement, name: string): string[] {
  const value = attr(element, name);
  return value === undefined
    ? []
    : asciiLower(value)
        .split(/[\t\n\f\r ]+/)
        .filter((token) => token !== '');
}

// The page, read once

/** One text node of a page, with its parent element and the nearest `lang` of that parent. */
export interface TextRun {
  /**
   * The text: decoded, except inside `script` and `style`, whose text stays as written (the DOM does not decode
   * it). `build.ts` parses `noscript`, `textarea` and `title` as text too: their content is one text node, markup
   * included.
   */
  text: string;
  parent: HTMLElement;
  lang: string | undefined;
}

/**
 * A page read once, in one pass over its tree without recursion.
 *
 * **Template content.** node-html-parser parses the content of a `<template>` as child elements. In the DOM it is
 * an inert document fragment: it is not rendered, not focusable, and not found by `querySelectorAll` or
 * `getElementById`. So `elements`, `texts`, `byTag` and `byId` hold the `template` element but nothing inside it;
 * `inert` holds what is inside. Only the rules that guard what template content can become once a script inserts
 * it (`csp-hash`, `csp-base`) read `inert`.
 */
export interface PageDom {
  page: BuiltPage;
  /** Every element of the document in document order, without template content. The parse root is not one. */
  elements: readonly HTMLElement[];
  /** Every element inside a `template`, at any depth, in document order. */
  inert: readonly HTMLElement[];
  /** Every text node of the document in document order, without template content. */
  texts: readonly TextRun[];
  /** The first `html`, `head`, `body` and `main` element, when there is one. */
  html: HTMLElement | undefined;
  head: HTMLElement | undefined;
  body: HTMLElement | undefined;
  main: HTMLElement | undefined;
  /** The elements with one tag, in document order: `byTag('a')`. An unknown tag gives an empty list. */
  byTag: (tag: string) => readonly HTMLElement[];
  /** The first element with each `id`, as `getElementById` finds it. */
  byId: ReadonlyMap<string, HTMLElement>;
  /** The depth of an element: `html` is 1 (`budget-dom`). 0 for an element of another page. */
  depth: (element: HTMLElement) => number;
  /** The place of an element in `elements`, to sort or compare in document order. -1 for one of another page. */
  order: (element: HTMLElement) => number;
  /**
   * The nearest `lang` of an element: its own `lang` attribute or the one of the nearest ancestor that has one, as
   * written (an empty value counts: it means an unknown language). `undefined` when no element up to `html` has it.
   */
  lang: (element: HTMLElement) => string | undefined;
  /** The `label` elements whose `for` names an id, in document order. */
  labelsFor: (id: string) => readonly HTMLElement[];
}

const DOMS = new WeakMap<BuiltPage, PageDom>();

/** The elements whose text the DOM keeps as written. */
const RAW_TEXT: ReadonlySet<string> = new Set(['script', 'style']);

/** Says whether an element is a `template`: its content is no part of the document (`PageDom`). */
export const isTemplate = (element: HTMLElement): boolean => tagOf(element) === 'template';

/** The page read once: elements, texts, depths, nearest `lang`, ids and labels. Cached for each page. */
export function domOf(page: BuiltPage): PageDom {
  const known = DOMS.get(page);
  if (known !== undefined) return known;
  const elements: HTMLElement[] = [];
  const inert: HTMLElement[] = [];
  const texts: TextRun[] = [];
  const tags = new Map<string, HTMLElement[]>();
  const ids = new Map<string, HTMLElement>();
  const labels = new Map<string, HTMLElement[]>();
  const depths = new Map<HTMLElement, number>();
  const orders = new Map<HTMLElement, number>();
  const langs = new Map<HTMLElement, string | undefined>();
  const stack: { node: Node; depth: number }[] = [];
  const pushChildren = (node: Node, depth: number): void => {
    for (let index = node.childNodes.length - 1; index >= 0; index -= 1) {
      const child = node.childNodes[index];
      if (child !== undefined) stack.push({ node: child, depth });
    }
  };
  pushChildren(page.root, 1);
  // The content of each template, read in a second pass of its own, so the first pass stays as it is.
  const templates: HTMLElement[] = [];
  for (let item = stack.pop(); item !== undefined; item = stack.pop()) {
    const { node, depth } = item;
    if (node.nodeType === NodeType.TEXT_NODE) {
      const parent = node.parentNode;
      // A text at the top level, such as the doctype that node-html-parser keeps as text, is no text of a page.
      if (parent === null || parent.parentNode === null) continue;
      texts.push({ text: RAW_TEXT.has(tagOf(parent)) ? node.rawText : node.text, parent, lang: langs.get(parent) });
      continue;
    }
    if (node.nodeType !== NodeType.ELEMENT_NODE) continue;
    const element = node as HTMLElement;
    orders.set(element, elements.length);
    elements.push(element);
    depths.set(element, depth);
    const parent = element.parentNode;
    langs.set(element, attr(element, 'lang') ?? (parent === null ? undefined : langs.get(parent)));
    const tag = tagOf(element);
    const list = tags.get(tag);
    if (list === undefined) tags.set(tag, [element]);
    else list.push(element);
    const id = attr(element, 'id');
    if (id !== undefined && id !== '' && !ids.has(id)) ids.set(id, element);
    if (tag === 'label') {
      const target = attr(element, 'for');
      if (target !== undefined) {
        const named = labels.get(target);
        if (named === undefined) labels.set(target, [element]);
        else named.push(element);
      }
    }
    if (tag === 'template') templates.push(element);
    else pushChildren(element, depth + 1);
  }
  for (const template of templates) for (const element of subtreeOf(template)) inert.push(element);
  const first = (tag: string): HTMLElement | undefined => tags.get(tag)?.[0];
  const dom: PageDom = {
    page,
    elements,
    inert,
    texts,
    html: first('html'),
    head: first('head'),
    body: first('body'),
    main: first('main'),
    byTag: (tag) => tags.get(tag) ?? [],
    byId: ids,
    depth: (element) => depths.get(element) ?? 0,
    order: (element) => orders.get(element) ?? -1,
    lang: (element) => langs.get(element),
    labelsFor: (id) => labels.get(id) ?? [],
  };
  DOMS.set(page, dom);
  return dom;
}

/** The ancestors of an element, nearest first, up to the parse root (which is not in the list). */
export function ancestorsOf(element: HTMLElement): HTMLElement[] {
  const out: HTMLElement[] = [];
  for (let parent = element.parentNode; parent !== null && parent.parentNode !== null; parent = parent.parentNode) {
    out.push(parent);
  }
  return out;
}

/** The nearest ancestor with one of the tags, or `undefined`. */
export function closestTag(element: HTMLElement, tags: ReadonlySet<string>): HTMLElement | undefined {
  return ancestorsOf(element).find((ancestor) => tags.has(tagOf(ancestor)));
}

/**
 * Every element below an element in document order, without recursion. `skip` leaves out the subtree of an element
 * (the element itself too), and `into` says whether to read the children of an element that is kept.
 */
function subtreeOf(
  element: HTMLElement,
  skip?: (element: HTMLElement) => boolean,
  into: (element: HTMLElement) => boolean = () => true,
): HTMLElement[] {
  const out: HTMLElement[] = [];
  const stack: Node[] = [...element.childNodes].reverse();
  for (let node = stack.pop(); node !== undefined; node = stack.pop()) {
    if (node.nodeType !== NodeType.ELEMENT_NODE) continue;
    const child = node as HTMLElement;
    if (skip?.(child)) continue;
    out.push(child);
    if (!into(child)) continue;
    for (let index = child.childNodes.length - 1; index >= 0; index -= 1) {
      const next = child.childNodes[index];
      if (next !== undefined) stack.push(next);
    }
  }
  return out;
}

/**
 * Every descendant of an element in document order, without recursion. `skip` leaves out the subtree of an element
 * (the element itself too). The element itself is not in the list. A `template` is in the list, but its content is
 * not: it is no part of the document (`PageDom`).
 */
export const descendantsOf = (element: HTMLElement, skip?: (element: HTMLElement) => boolean): HTMLElement[] =>
  subtreeOf(element, skip, (child) => !isTemplate(child));

// Text

/** Each run of white space as one space, trimmed (Measurement details). */
export const collapse = (text: string): string => text.replace(/\s+/g, ' ').trim();

/**
 * Every Unicode space separator (`\p{Zs}`: U+00A0, U+202F, U+2009 and the others) as U+0020, then each run of white
 * space as one space, trimmed: the normalization of `facts-value`, in this order (Measurement details).
 */
export const normalizeSpaces = (text: string): string => collapse(text.replace(/\p{Zs}/gu, ' '));

/**
 * The `textContent` of an element, as the DOM gives it, without recursion: the texts of its text nodes in document
 * order. Template content is no part of it, as in the DOM. `skip` leaves out the subtree of an element, and
 * `replace` gives the text that stands for an element and its subtree. The element itself is never skipped or
 * replaced.
 */
export function textOf(
  element: HTMLElement,
  options: {
    skip?: (element: HTMLElement) => boolean;
    replace?: (element: HTMLElement) => string | undefined;
  } = {},
): string {
  const parts: string[] = [];
  const stack: Node[] = [...element.childNodes].reverse();
  for (let node = stack.pop(); node !== undefined; node = stack.pop()) {
    if (node.nodeType === NodeType.TEXT_NODE) {
      const parent = node.parentNode;
      parts.push(parent !== null && RAW_TEXT.has(tagOf(parent)) ? node.rawText : node.text);
      continue;
    }
    if (node.nodeType !== NodeType.ELEMENT_NODE) continue;
    const child = node as HTMLElement;
    if (options.skip?.(child)) continue;
    const replaced = options.replace?.(child);
    if (replaced !== undefined) {
      parts.push(replaced);
      continue;
    }
    const tag = tagOf(child);
    if (tag === 'br') {
      parts.push('\n');
      continue;
    }
    if (tag === 'template') continue;
    for (let index = child.childNodes.length - 1; index >= 0; index -= 1) {
      const next = child.childNodes[index];
      if (next !== undefined) stack.push(next);
    }
  }
  return parts.join('');
}

const PAGE_TEXTS = new WeakMap<BuiltPage, { page: string; legal: string }>();

/** The page text and the legal text of a page, found once. */
function textsOf(page: BuiltPage): { page: string; legal: string } {
  let found = PAGE_TEXTS.get(page);
  if (found === undefined) {
    const dom = domOf(page);
    const of = (element: HTMLElement | undefined): string =>
      element === undefined ? '' : collapse(textOf(element).normalize('NFC'));
    found = { page: of(dom.body), legal: of(dom.main) };
    PAGE_TEXTS.set(page, found);
  }
  return found;
}

/**
 * The page text (Measurement details): the `textContent` of `body`, in NFC, with each run of white space as one
 * space. `''` without a `body`. `facts-value` applies `normalizeSpaces` to it before it looks for candidates.
 */
export const pageText = (page: BuiltPage): string => textsOf(page).page;

/** The legal text (Measurement details): the same for the first `main`. `''` without a `main`. */
export const legalText = (page: BuiltPage): string => textsOf(page).legal;

/** Says whether two `lang` values name one language tag: BCP 47 compares tags without regard to ASCII case. */
export const sameLang = (a: string | undefined, b: string | undefined): boolean =>
  a !== undefined && b !== undefined && asciiLower(a) === asciiLower(b);

/**
 * The text of an element without the subtrees of its descendants that carry a `lang` attribute naming another
 * language than the nearest `lang` of the element (`content-language`).
 */
export function sameLangText(dom: PageDom, element: HTMLElement): string {
  const own = dom.lang(element);
  return textOf(element, {
    skip: (child) => {
      const lang = attr(child, 'lang');
      return lang !== undefined && !sameLang(lang, own);
    },
  });
}

/**
 * The words of a text (Measurement details): each longest run of letters (`\p{L}`), where `'` and `’` between two
 * letters stay inside the word. The pattern cannot backtrack: a letter is never an apostrophe.
 */
export const wordsOf = (text: string): string[] => text.match(/\p{L}+(?:['’]\p{L}+)*/gu) ?? [];

// Names and labels

/**
 * Elements that do not break a text: their text joins the text around them (`Hotel <b>Laerchenwald</b>`). The text
 * of any other element stands apart: `content-glossary` starts a new text there, and an accessible name puts a space
 * around it, as a browser does for a block.
 */
export const INLINE: ReadonlySet<string> = new Set([
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
]);

/** Says whether an element carries `aria-hidden="true"`: the value trimmed, in any ASCII case. */
export const isAriaHidden = (element: HTMLElement): boolean =>
  asciiLower((attr(element, 'aria-hidden') ?? '').trim()) === 'true';

/** Says whether a browser exposes no part of an element: it is `aria-hidden="true"` or has the `hidden` attribute. */
export const isHidden = (element: HTMLElement): boolean => isAriaHidden(element) || hasAttr(element, 'hidden');

/**
 * The most characters of a name that the kit reads, after white space is collapsed (Measurement details). A longer
 * name is cut there: it is neither empty nor generic, and two names compare by these characters.
 */
export const MAX_NAME = 1000;

/** A text with each run of white space as one space, cut to `MAX_NAME` characters (never inside a surrogate pair). */
function capped(text: string): string {
  const squeezed = text.replace(/\s+/g, ' ');
  if (squeezed.length <= MAX_NAME) return squeezed;
  const code = squeezed.charCodeAt(MAX_NAME);
  return squeezed.slice(0, code >= 0xdc00 && code <= 0xdfff ? MAX_NAME - 1 : MAX_NAME);
}

/** What a child element gives to the name text of its parent, when it does not give its own content. */
function replacementOf(child: HTMLElement): string | undefined {
  const label = attr(child, 'aria-label');
  if (label !== undefined && collapse(label) !== '') return ` ${label} `;
  const tag = tagOf(child);
  if (tag === 'img') return ` ${attr(child, 'alt') ?? ''} `;
  if (tag !== 'svg') return undefined;
  const title = child.childNodes.find(
    (node) => node.nodeType === NodeType.ELEMENT_NODE && tagOf(node as HTMLElement) === 'title',
  );
  return ` ${title === undefined ? '' : textOf(title as HTMLElement)} `;
}

const NAME_TEXTS = new WeakMap<HTMLElement, string>();

/**
 * The text that the content of an element gives to an accessible name (Measurement details): its text nodes, where
 * a hidden descendant (`isHidden`) and template content count as nothing; a descendant with a non-empty
 * `aria-label` counts as that label; an `img` as its `alt`; an `svg` as the text of its `title` child; a `br` as a
 * space; and the text of an element that is not `INLINE` stands between spaces. White space runs
 * are one space, and the text is cut at `MAX_NAME` characters.
 *
 * One pass over the subtree after its children, without recursion. The text of every element on the way is kept, so
 * the content of nested links and of an element that many `aria-labelledby` name is read once for the page.
 */
function nameText(root: HTMLElement): string {
  const known = NAME_TEXTS.get(root);
  if (known !== undefined) return known;
  const frames: { element: HTMLElement; next: number; parts: string[] }[] = [{ element: root, next: 0, parts: [] }];
  let result = '';
  for (let frame = frames.at(-1); frame !== undefined; frame = frames.at(-1)) {
    const child = frame.element.childNodes[frame.next];
    frame.next += 1;
    if (child === undefined) {
      frames.pop();
      const text = capped(frame.parts.join(''));
      NAME_TEXTS.set(frame.element, text);
      const parent = frames.at(-1);
      if (parent === undefined) result = text;
      else parent.parts.push(INLINE.has(tagOf(frame.element)) ? text : ` ${text} `);
      continue;
    }
    if (child.nodeType === NodeType.TEXT_NODE) {
      frame.parts.push(RAW_TEXT.has(tagOf(frame.element)) ? child.rawText : child.text);
      continue;
    }
    if (child.nodeType !== NodeType.ELEMENT_NODE) continue;
    const element = child as HTMLElement;
    const tag = tagOf(element);
    if (isHidden(element) || tag === 'template') continue;
    if (tag === 'br') {
      frame.parts.push(' ');
      continue;
    }
    const replaced = replacementOf(element);
    if (replaced !== undefined) {
      frame.parts.push(replaced);
      continue;
    }
    const inner = NAME_TEXTS.get(element);
    if (inner !== undefined) frame.parts.push(INLINE.has(tag) ? inner : ` ${inner} `);
    else frames.push({ element, next: 0, parts: [] });
  }
  return result;
}

const NAMES = new WeakMap<HTMLElement, string>();

/**
 * The accessible name of a link or another element (Measurement details, `links-generic`): the first of these that
 * is not empty: the text of the elements that `aria-labelledby` names; `aria-label`; the element's own text, as
 * `nameText` reads it; the `title` attribute. White space is collapsed and trimmed, and a name has at most
 * `MAX_NAME` characters. `''` when all are empty. Found once for each element, so every rule that reads the name
 * of a link shares it.
 */
export function accessibleName(dom: PageDom, element: HTMLElement): string {
  const known = NAMES.get(element);
  if (known !== undefined) return known;
  const name = nameOf(dom, element);
  NAMES.set(element, name);
  return name;
}

function nameOf(dom: PageDom, element: HTMLElement): string {
  // The ids keep their letter case: `tokensOf` folds it, so read the raw value.
  const ids = collapse(attr(element, 'aria-labelledby') ?? '');
  if (ids !== '') {
    const parts: string[] = [];
    let length = 0;
    for (const id of ids.split(' ')) {
      const found = dom.byId.get(id);
      if (found === undefined) continue;
      const text = nameText(found);
      parts.push(text);
      length += text.length + 1;
      if (length > MAX_NAME) break;
    }
    const named = collapse(capped(parts.join(' ')));
    if (named !== '') return named;
  }
  const label = collapse(capped(attr(element, 'aria-label') ?? ''));
  if (label !== '') return label;
  const text = collapse(nameText(element));
  if (text !== '') return text;
  return collapse(capped(attr(element, 'title') ?? ''));
}

/**
 * A name as `links-generic` compares it with its list: in lower case, with the characters that are not letters
 * removed from its start and its end (`"Mehr …"` gives `mehr`).
 */
export function nameKey(name: string): string {
  const chars = Array.from(name.toLowerCase());
  let start = 0;
  let end = chars.length;
  while (start < end && !/\p{L}/u.test(chars[start] ?? '')) start += 1;
  while (end > start && !/\p{L}/u.test(chars[end - 1] ?? '')) end -= 1;
  return chars.slice(start, end).join('');
}

/**
 * The `label` elements of a form control: each `label` whose `for` is the id of the control, and the nearest
 * ancestor `label` without `for` (HTML labels a control in both ways). Document order, each once.
 */
export function labelsOf(dom: PageDom, control: HTMLElement): HTMLElement[] {
  const id = attr(control, 'id');
  const out = id === undefined || id === '' ? [] : [...dom.labelsFor(id)];
  const wrapping = closestTag(control, new Set(['label']));
  if (wrapping !== undefined && !hasAttr(wrapping, 'for') && !out.includes(wrapping)) out.push(wrapping);
  return out.sort((a, b) => dom.order(a) - dom.order(b));
}

// The head: the CSP meta, scripts and robots

/** Says whether an element is a CSP meta: a `<meta>` whose `http-equiv` is `content-security-policy` in any case. */
export const isCspMeta = (element: HTMLElement): boolean =>
  tagOf(element) === 'meta' && asciiLower(attr(element, 'http-equiv') ?? '') === 'content-security-policy';

/** Says whether an element is a child of the `head` of its page. */
export const inHead = (dom: PageDom, element: HTMLElement): boolean =>
  dom.head !== undefined && element.parentNode === dom.head;

/**
 * Every CSP meta of a page that a browser applies, in document order: a CSP meta that is a child of `head` (HTML
 * ignores one anywhere else). The first one is the one that `build:done` inserts after.
 */
export const cspMetasOf = (dom: PageDom): HTMLElement[] =>
  dom.byTag('meta').filter((meta) => isCspMeta(meta) && inHead(dom, meta));

/** Every CSP meta of a page that is not a child of `head`: a browser ignores it (`csp-meta`). */
export const strayCspMetasOf = (dom: PageDom): HTMLElement[] =>
  dom.byTag('meta').filter((meta) => isCspMeta(meta) && !inHead(dom, meta));

/** One directive of a policy: its name in ASCII lower case and its sources as written. */
export interface PolicyDirective {
  name: string;
  sources: string[];
}

/**
 * The directives of a policy text, in their order, duplicates included: the text split at `;`, each part at ASCII
 * white space. An empty part gives no directive. A browser uses the first directive of a name (CSP Level 3).
 */
export function parseCsp(text: string): PolicyDirective[] {
  const out: PolicyDirective[] = [];
  for (const part of text.split(';')) {
    const [name, ...sources] = part.split(/[\t\n\f\r ]+/).filter((token) => token !== '');
    if (name !== undefined) out.push({ name: asciiLower(name), sources });
  }
  return out;
}

/** The sources of the first directive of a name, or `undefined` when the policy has none. */
export const sourcesOf = (policy: readonly PolicyDirective[], name: string): string[] | undefined =>
  policy.find((directive) => directive.name === name)?.sources;

/** What a `<script>` is, by its `type` (HTML, "prepare the script element"). */
export type ScriptKind = 'classic' | 'module' | 'json-ld' | 'speculationrules' | 'importmap' | 'data';

/** The JavaScript MIME types of HTML. A `type` with one of them, or with none, is a classic script. */
const JAVASCRIPT_TYPES: ReadonlySet<string> = new Set([
  'application/ecmascript',
  'application/javascript',
  'application/x-ecmascript',
  'application/x-javascript',
  'text/ecmascript',
  'text/javascript',
  'text/javascript1.0',
  'text/javascript1.1',
  'text/javascript1.2',
  'text/javascript1.3',
  'text/javascript1.4',
  'text/javascript1.5',
  'text/jscript',
  'text/livescript',
  'text/x-ecmascript',
  'text/x-javascript',
]);

/** The kinds of `type` that HTML reads as their own kind. */
const SCRIPT_TYPES: ReadonlyMap<string, ScriptKind> = new Map<string, ScriptKind>([
  ['module', 'module'],
  ['application/ld+json', 'json-ld'],
  ['speculationrules', 'speculationrules'],
  ['importmap', 'importmap'],
]);

/** The kind of a `<script>`: by its `type`, trimmed and in ASCII lower case. Any other type is a data block. */
export function scriptKind(element: HTMLElement): ScriptKind {
  const type = asciiLower((attr(element, 'type') ?? '').trim());
  if (type === '' || JAVASCRIPT_TYPES.has(type)) return 'classic';
  return SCRIPT_TYPES.get(type) ?? 'data';
}

/** Says whether a `<script>` runs code: a classic or a module script. */
export const isExecutableScript = (element: HTMLElement): boolean => {
  const kind = scriptKind(element);
  return kind === 'classic' || kind === 'module';
};

/**
 * The text of a raw-text element (`script`, `style`) as the page writes it, between its start and end tags: the
 * text that a CSP hash covers. `''` for an empty element.
 */
export const rawContentOf = (element: HTMLElement): string =>
  element.childNodes.map((node) => (node.nodeType === NodeType.TEXT_NODE ? node.rawText : '')).join('');

/** The markup of an element as the page writes it: the bytes of its range in `page.html`. */
export const sourceOf = (page: BuiltPage, element: HTMLElement): string =>
  page.html.slice(element.range[0], element.range[1]);

/**
 * The `name` values of a robots meta: `robots` for every crawler, and the crawlers of the big search engines, which
 * obey a meta of their own name too.
 */
export const ROBOTS_NAMES: ReadonlySet<string> = new Set(['robots', 'googlebot', 'googlebot-news', 'bingbot']);

const ROBOTS = new WeakMap<BuiltPage, ReadonlyMap<string, ReadonlySet<string>>>();

/**
 * The tokens of the robots metas of a page, by the `name` of the meta in ASCII lower case (`robots`, `googlebot`),
 * each in ASCII lower case: `noindex`, `nofollow`. Only the names of `ROBOTS_NAMES` count.
 */
function robotsByName(page: BuiltPage): ReadonlyMap<string, ReadonlySet<string>> {
  let found = ROBOTS.get(page);
  if (found === undefined) {
    const names = new Map<string, Set<string>>();
    for (const meta of domOf(page).byTag('meta')) {
      const name = asciiLower(attr(meta, 'name') ?? '');
      if (!ROBOTS_NAMES.has(name)) continue;
      let tokens = names.get(name);
      if (tokens === undefined) {
        tokens = new Set();
        names.set(name, tokens);
      }
      for (const token of asciiLower(attr(meta, 'content') ?? '').split(/[\s,]+/)) if (token !== '') tokens.add(token);
    }
    found = names;
    ROBOTS.set(page, found);
  }
  return found;
}

/** The tokens of every `meta[name=robots]` of a page, in ASCII lower case: `noindex`, `nofollow`. */
export const robotsOf = (page: BuiltPage): ReadonlySet<string> => robotsByName(page).get('robots') ?? new Set();

const isNoindex = (tokens: ReadonlySet<string> | undefined): boolean =>
  tokens !== undefined && (tokens.has('noindex') || tokens.has('none'));

/**
 * Says whether a page carries `noindex` (`none` means `noindex, nofollow`) for some crawler: in a robots meta of any
 * name of `ROBOTS_NAMES`. Such a page leaves the index of that search engine.
 */
export const hasNoindex = (page: BuiltPage): boolean => [...robotsByName(page).values()].some(isNoindex);

/** Says whether a page carries `noindex` for every crawler: in a `meta[name=robots]`. */
export const hasRobotsNoindex = (page: BuiltPage): boolean => isNoindex(robotsOf(page));

/** Says whether a page is indexable: it is not `/404.html` and carries no robots `noindex`. */
export const isIndexable = (page: BuiltPage): boolean => !page.is404 && !hasNoindex(page);

// The site

/** The pages and files of a build as tables, and the host of the site. */
export interface SiteIndex {
  /** Each page by its path. */
  pages: ReadonlyMap<string, BuiltPage>;
  /** Each file of the client directory, as `ctx.files` lists it (no leading `/`). */
  files: ReadonlySet<string>;
  /** The host of `options.site`, in lower case: `laerchenwald.example`. */
  host: string;
}

const SITES = new WeakMap<BuildContext, SiteIndex>();

/** The index of a build, found once for each context. `findPage` and `hasFile` of `context.ts` are linear. */
export function siteOf(ctx: BuildContext): SiteIndex {
  let found = SITES.get(ctx);
  if (found === undefined) {
    found = {
      pages: new Map(ctx.pages.map((page) => [page.path, page])),
      files: new Set(ctx.files),
      host: asciiLower(ctx.options.site.slice('https://'.length)),
    };
    SITES.set(ctx, found);
  }
  return found;
}

/** The settings of one locale by its code, or `undefined`. */
export const localeOf = (options: Pick<Options, 'locales'>, code: string): Locale | undefined =>
  options.locales.find((locale) => locale.code === code);

/**
 * The configured locale that a `lang` value names: its tag or its code, in any ASCII case (`content-glossary`).
 * `undefined` for a `lang` that names no configured locale.
 */
export const localeOfLang = (options: Pick<Options, 'locales'>, lang: string): Locale | undefined =>
  options.locales.find((locale) => sameLang(locale.tag, lang) || sameLang(locale.code, lang));

// Links

/** Where an `href` leads, from one page of the site. */
export type HrefTarget =
  /** A fragment-only href: `#content`. `fragment` is the text after `#`, as written. */
  | { kind: 'fragment'; fragment: string }
  /**
   * A same-origin href: a relative one, a root-relative one, or an absolute one on the host of the site, with any
   * scheme of `http` and `https` (`links-resolve` fails `http`). `path` is the path that the browser asks for: a
   * relative path is resolved against the page, dot segments are removed, and nothing else changes (no percent
   * decoding, no letter case, no `/` added).
   */
  | {
      kind: 'internal';
      path: string;
      /** The query with its `?`, or `''`. */
      query: string;
      /** The text after `#`, or `undefined` when the href has no `#`. */
      fragment: string | undefined;
      /** True when the href names the host: `https://<host>/…` or `//<host>/…`. */
      absolute: boolean;
      /** `https` or `http` for an absolute href, `''` otherwise (a `//` href takes the `https` of the site). */
      scheme: string;
    }
  /** Another origin, or another scheme: `mailto:`, `tel:`, `javascript:`. `scheme` is in lower case. */
  | { kind: 'external'; scheme: string; host: string | undefined }
  /** An absolute `http` or `https` href that is no valid URL. */
  | { kind: 'invalid' };

/** An href without the C0 controls and spaces at both ends, which a URL parser strips. */
function strip(text: string): string {
  let start = 0;
  let end = text.length;
  while (start < end && text.charCodeAt(start) <= 0x20) start += 1;
  while (end > start && text.charCodeAt(end - 1) <= 0x20) end -= 1;
  return text.slice(start, end);
}

/** Removes the dot segments of a path that starts with `/` (RFC 3986, 5.2.4). */
function removeDots(path: string): string {
  const out: string[] = [];
  const segments = path.split('/');
  segments.forEach((segment, index) => {
    const last = index === segments.length - 1;
    if (segment === '.' || segment === '..') {
      if (segment === '..' && out.length > 1) out.pop();
      if (last) out.push('');
    } else out.push(segment);
  });
  const joined = out.join('/');
  return joined.startsWith('/') ? joined : `/${joined}`;
}

/** The path, the query and the fragment of the part of an href after its origin. */
function splitPath(rest: string): { path: string; query: string; fragment: string | undefined } {
  const hash = rest.indexOf('#');
  const fragment = hash < 0 ? undefined : rest.slice(hash + 1);
  const beforeHash = hash < 0 ? rest : rest.slice(0, hash);
  const mark = beforeHash.indexOf('?');
  return {
    path: mark < 0 ? beforeHash : beforeHash.slice(0, mark),
    query: mark < 0 ? '' : beforeHash.slice(mark),
    fragment,
  };
}

const SCHEME = /^([A-Za-z][A-Za-z0-9+.-]*):/;

/**
 * An href with each backslash before its query and its fragment read as a slash. The URL standard reads an `http`
 * or `https` URL, and a relative URL on such a page, this way: `\\api\\forms\\x\\` asks for `/api/forms/x/`.
 */
function withSlashes(text: string): string {
  const end = text.search(/[?#]/);
  const head = end < 0 ? text : text.slice(0, end);
  return head.includes('\\') ? `${head.replaceAll('\\', '/')}${end < 0 ? '' : text.slice(end)}` : text;
}

/**
 * Where an `href` of the page at `base` (a page path such as `/fr/kontakt/` or `/404.html`) leads, for the site on
 * `host` (lower case, no port). A backslash before the query reads as a slash (`withSlashes`). It never throws.
 */
export function resolveHref(href: string, base: string, host: string): HrefTarget {
  const stripped = strip(href);
  if (stripped.startsWith('#')) return { kind: 'fragment', fragment: stripped.slice(1) };
  const scheme = SCHEME.exec(stripped)?.[1]?.toLowerCase();
  const isWeb = scheme === 'http' || scheme === 'https';
  if (scheme !== undefined && !isWeb) return { kind: 'external', scheme, host: undefined };
  const text = withSlashes(stripped);
  const authority = isWeb ? text.slice(scheme.length + 1) : text;
  if (authority.startsWith('//')) {
    let url: URL;
    try {
      url = new URL(isWeb ? text : `https:${text}`);
    } catch {
      return { kind: 'invalid' };
    }
    const own = url.hostname.toLowerCase() === host && url.port === '' && url.username === '' && url.password === '';
    if (!own) return { kind: 'external', scheme: scheme ?? 'https', host: url.hostname.toLowerCase() };
    const after = authority.slice(2);
    const ends = after.search(/[/?#]/);
    const rest = ends < 0 ? '/' : after.slice(ends);
    const parts = splitPath(rest.startsWith('/') ? rest : `/${rest}`);
    return { kind: 'internal', ...parts, path: removeDots(parts.path), absolute: true, scheme: scheme ?? 'https' };
  }
  if (isWeb) {
    // `https:x` without `//` is a relative reference in a special scheme of the same name: a browser resolves it
    // against the page only when the schemes match. The kit reads it as its own path.
    const parts = splitPath(authority);
    const path = parts.path.startsWith('/') ? parts.path : `${base.slice(0, base.lastIndexOf('/') + 1)}${parts.path}`;
    return { kind: 'internal', ...parts, path: removeDots(path), absolute: false, scheme };
  }
  const parts = splitPath(text);
  if (parts.path === '') return { kind: 'internal', ...parts, path: base, absolute: false, scheme: '' };
  const path = parts.path.startsWith('/') ? parts.path : `${base.slice(0, base.lastIndexOf('/') + 1)}${parts.path}`;
  return { kind: 'internal', ...parts, path: removeDots(path), absolute: false, scheme: '' };
}

/** A path with its percent escapes decoded, or `undefined` when an escape is broken. */
export function decodePath(path: string): string | undefined {
  try {
    return decodeURIComponent(path);
  } catch {
    return undefined;
  }
}

/** One link of a page: an `a` or `area` with an `href`. */
export interface PageLink {
  element: HTMLElement;
  /** The `href` as the attribute holds it (decoded character references). */
  href: string;
  target: HrefTarget;
}

const LINKS = new WeakMap<BuiltPage, readonly PageLink[]>();

/** The links of a page (`a[href]` and `area[href]`), in document order, each resolved once. */
export function linksOf(ctx: BuildContext, page: BuiltPage): readonly PageLink[] {
  let found = LINKS.get(page);
  if (found === undefined) {
    const { host } = siteOf(ctx);
    found = domOf(page)
      .elements.filter((element) => {
        const tag = tagOf(element);
        return (tag === 'a' || tag === 'area') && hasAttr(element, 'href');
      })
      .map((element) => {
        const href = attr(element, 'href') ?? '';
        return { element, href, target: resolveHref(href, page.path, host) };
      });
    LINKS.set(page, found);
  }
  return found;
}

/**
 * The built page that a same-origin path names: a page path, or the file of a page (`/zimmer/index.html` names
 * `/zimmer/`), as `links-resolve` accepts both. `undefined` for any other path.
 */
export function pageAt(ctx: BuildContext, path: string): BuiltPage | undefined {
  const { pages, files } = siteOf(ctx);
  const direct = pages.get(path);
  if (direct !== undefined) return direct;
  const file = path.slice(1);
  return file.endsWith('.html') && files.has(file) ? pages.get(pagePathOf(file)) : undefined;
}

/**
 * The paths of the built pages that a page links, as a set: each same-origin link whose path names a built page
 * (`pageAt`: the page path, or the file of the page). A link to a fragment of the page itself counts as the page
 * itself only when it has a path.
 */
export function linkedPages(ctx: BuildContext, page: BuiltPage): ReadonlySet<string> {
  const out = new Set<string>();
  for (const link of linksOf(ctx, page)) {
    if (link.target.kind !== 'internal') continue;
    const target = pageAt(ctx, link.target.path);
    if (target !== undefined) out.add(target.path);
  }
  return out;
}

// hreflang

/** One hreflang alternate of a page: a `link` whose `rel` holds `alternate` and that has an `hreflang`. */
export interface Alternate {
  element: HTMLElement;
  /** The `hreflang` as written. */
  hreflang: string;
  href: string;
  target: HrefTarget;
  /** The page path for an absolute same-origin `https` href (`hreflang-reciprocal`), else `undefined`. */
  path: string | undefined;
}

const ALTERNATES = new WeakMap<BuiltPage, readonly Alternate[]>();

/** The hreflang alternates of a page, in document order, parsed once. */
export function alternatesOf(ctx: BuildContext, page: BuiltPage): readonly Alternate[] {
  let found = ALTERNATES.get(page);
  if (found === undefined) {
    const { host } = siteOf(ctx);
    found = domOf(page)
      .byTag('link')
      .filter((element) => tokensOf(element, 'rel').includes('alternate') && hasAttr(element, 'hreflang'))
      .map((element) => {
        const href = attr(element, 'href') ?? '';
        const target = resolveHref(href, page.path, host);
        const path =
          target.kind === 'internal' && target.absolute && target.scheme === 'https' && target.query === ''
            ? target.path
            : undefined;
        return { element, hreflang: attr(element, 'hreflang') ?? '', href, target, path };
      });
    ALTERNATES.set(page, found);
  }
  return found;
}

/**
 * The alternate of a page in one locale: the built page that its first alternate with the tag of that locale (as
 * written, exact) names. `undefined` when the page lists none, or when that page is not built.
 */
export function alternateIn(ctx: BuildContext, page: BuiltPage, code: string): BuiltPage | undefined {
  const tag = localeOf(ctx.options, code)?.tag;
  if (tag === undefined) return undefined;
  const path = alternatesOf(ctx, page).find((alternate) => alternate.hreflang === tag)?.path;
  return path === undefined ? undefined : siteOf(ctx).pages.get(path);
}

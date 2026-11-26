/**
 * The html audit (specification, 6.1, `astro:build:done`, step 4, last): `html-validate` with only the kit config.
 * It runs after every other audit.
 *
 * **The config** (section 8, exact): `extends` `html-validate:recommended` and `html-validate:document`, `elements`
 * `html5`; `unique-landmark`, `prefer-native-element` and `no-missing-references` are errors; `heading-level`,
 * `wcag/h37`, `long-title` and `no-inline-style` are off; `require-sri` targets `crossorigin`, except a `script` whose
 * `src` is on a host of a declared origin with `script` and `load: "page"` (9.4). No config file of the project and
 * no inline `<!-- [html-validate-…] -->` directive of a page changes it:
 *
 * - The validator gets the config as an object through a `StaticConfigLoader`, with `root: true`, so it reads no
 *   file (`.htmlvalidate.json` and the like stay unread).
 * - html-validate has no setting that turns directives off. So the audit validates a copy of the page in which the
 *   `-` after `html-validate` of each comment that would be a directive is a `_`: such a comment is a plain comment
 *   then. The copy has the length of the page, so every line and column stays the same.
 * - On a site with islands, Astro writes its island style element into the body (`ISLAND_STYLE_ELEMENT`, 7.1), where
 *   html-validate refuses a `<style>`. The copy holds a comment of the same length in its place. Any other `<style>`
 *   stays an error.
 * - The `require-sri` exception is not a setting either: the rule's `exclude` option matches any part of a URL, so
 *   `https://evil.example/?https://js.pay.example/` would pass. The audit drops a `require-sri` message only when the
 *   element at its place is a `script` whose `src` is an `https` URL on such a host, with no port and no user.
 *
 * **The text.** html-validate reads the page as the file holds it. The context decodes a page without its UTF-8 byte
 * order mark, so the audit puts the mark back in front of the text when the file starts with one: html-validate's
 * `no-utf8-bom` then reports it, as on the file.
 *
 * **Size.** html-validate takes seconds on a page of many thousand elements and overflows its own stack on deep
 * nesting. A page with more than `4 × domElements` elements or a depth over `4 × domDepth` (the kit's limits, not
 * ones that a site lowered; template content counted) is not validated: it gives one finding that says so.
 * `budget-dom` reports the page too: two facts.
 *
 * **Who reports what.** One finding for each error message of html-validate, at the page path, with the
 * html-validate rule id, the message and the line and column in the detail. The overlaps that the exact config
 * keeps (for example an empty link, which `links-generic` reports too) are part of the specification. A page that
 * makes html-validate throw (it throws on an attribute named `constructor` or `__proto__`) gives one finding.
 */
import { type ConfigData, HtmlValidate, type Message, StaticConfigLoader } from 'html-validate';
import { type HTMLElement, type Node, NodeType } from 'node-html-parser';
import type { BuildContext, BuiltPage } from '../context.ts';
import { snippet } from '../css/rules.ts';
import { LIMITS, type Options } from '../options.ts';
import { attr, domOf } from './dom.ts';

const RULE = 'html-validate';

/** The kit config of section 8, exact. */
export const HTML_VALIDATE_CONFIG: ConfigData = {
  root: true,
  extends: ['html-validate:recommended', 'html-validate:document'],
  elements: ['html5'],
  rules: {
    'unique-landmark': 'error',
    'prefer-native-element': 'error',
    'no-missing-references': 'error',
    'heading-level': 'off',
    'wcag/h37': 'off',
    'long-title': 'off',
    'no-inline-style': 'off',
    'require-sri': ['error', { target: 'crossorigin' }],
  },
};

/** The severity of an error message of html-validate. */
const ERROR = 2;

let validator: HtmlValidate | undefined;

/** The one validator of the process: html-validate is the slowest audit, and its config never changes. */
function validatorOf(): HtmlValidate {
  validator ??= new HtmlValidate(new StaticConfigLoader(HTML_VALIDATE_CONFIG));
  return validator;
}

/**
 * The page text with every inline directive turned into a plain comment: `<!-- [html-validate-disable …] -->`
 * becomes `<!-- [html-validate_disable …] -->`. This is the pattern of html-validate's lexer (`<!--`, white space,
 * an optional `[`, `html-validate-`); the text keeps its length.
 */
export const withoutDirectives = (html: string): string =>
  html.replace(/(<!--\s*\[?html-validate)-/g, (_match, start: string) => `${start}_`);

/**
 * Astro's island style element, exact: the one text of 7.1 in a `<style>` without attributes. Astro writes it into
 * the body, right before the first island of a page, and html-validate refuses a `<style>` in most places of the
 * body (`element-permitted-content`). The project cannot change it.
 */
export const ISLAND_STYLE_ELEMENT = '<style>astro-island,astro-slot,astro-static-slot{display:contents}</style>';

/** A comment of the length of the island style element: the copy keeps every line and column. */
const ISLAND_STYLE_COMMENT = `<!--${' '.repeat(ISLAND_STYLE_ELEMENT.length - 7)}-->`;

/**
 * The page text with each exact island style element (`ISLAND_STYLE_ELEMENT`) turned into a comment of the same
 * length, on a site with islands. Any other `<style>` stays as it is, so html-validate still judges it.
 */
export const withoutIslandStyle = (html: string): string => html.replaceAll(ISLAND_STYLE_ELEMENT, ISLAND_STYLE_COMMENT);

/** The hosts of the declared origins whose script files a page may load while it loads (9.4). */
function pageScriptHosts(options: Pick<Options, 'origins'>): ReadonlySet<string> {
  return new Set(
    options.origins
      .filter((origin) => origin.directives.includes('script') && origin.load === 'page')
      .map((origin) => origin.host),
  );
}

/** Says whether a `src` is an `https` URL on one of the hosts, with no port and no user. */
function isOnHost(src: string, hosts: ReadonlySet<string>): boolean {
  if (hosts.size === 0) return false;
  let url: URL;
  try {
    url = new URL(src.trim(), 'https://invalid.invalid/');
  } catch {
    return false;
  }
  return (
    url.protocol === 'https:' &&
    url.port === '' &&
    url.username === '' &&
    url.password === '' &&
    hosts.has(url.hostname)
  );
}

/** The `script` elements of a page by the place of their `<`. */
function scriptsByStart(page: BuiltPage): ReadonlyMap<number, HTMLElement> {
  return new Map(
    domOf(page)
      .byTag('script')
      .map((script) => [script.range[0], script]),
  );
}

/**
 * Says whether a message is the `require-sri` exception of 9.4: its place is the tag name of a `script` start tag
 * (html-validate points one past the `<`) whose `src` is on a host of `hosts`. `shift` is the number of characters
 * that the validated text has in front of `page.html` (the byte order mark).
 */
function isAllowedSri(
  message: Message,
  scripts: () => ReadonlyMap<number, HTMLElement>,
  hosts: ReadonlySet<string>,
  shift: number,
): boolean {
  if (message.ruleId !== 'require-sri' || hosts.size === 0) return false;
  const script = scripts().get(message.offset - 1 - shift);
  const src = script === undefined ? undefined : attr(script, 'src');
  return src !== undefined && isOnHost(src, hosts);
}

/** How many times the limits of `budget-dom` a page may reach before html-validate no longer reads it. */
export const VALIDATE_FACTOR = 4;

/** The number of elements of a page and its depth (`html` is 1), template content included, without recursion. */
export function sizeOf(page: BuiltPage): { elements: number; depth: number } {
  let elements = 0;
  let depth = 0;
  const stack: { node: Node; level: number }[] = page.root.childNodes.map((node) => ({ node, level: 1 }));
  for (let item = stack.pop(); item !== undefined; item = stack.pop()) {
    if (item.node.nodeType !== NodeType.ELEMENT_NODE) continue;
    elements += 1;
    depth = Math.max(depth, item.level);
    for (const child of item.node.childNodes) stack.push({ node: child, level: item.level + 1 });
  }
  return { elements, depth };
}

/** The problem of a page that is too large or too deep for html-validate, or `undefined`. */
function sizeProblem(page: BuiltPage): string | undefined {
  const most = { elements: VALIDATE_FACTOR * LIMITS.domElements, depth: VALIDATE_FACTOR * LIMITS.domDepth };
  const size = sizeOf(page);
  if (size.elements <= most.elements && size.depth <= most.depth) return undefined;
  return `the page is not validated: it has ${size.elements} elements and a depth of ${size.depth}; html-validate reads at most ${most.elements} elements and a depth of ${most.depth}`;
}

/** Says whether the file of a page starts with the UTF-8 byte order mark. */
function startsWithBom(ctx: BuildContext, page: BuiltPage): boolean {
  const bytes = ctx.read(page.file);
  return bytes !== undefined && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
}

/** The detail of one message: `<rule id>: <message> (<line>:<column>)`. */
const detailOf = (message: Message): string =>
  `${message.ruleId}: ${snippet(message.message)} (${message.line}:${message.column})`;

/** `html-validate`: every page passes html-validate with the kit config and nothing else. */
export async function auditHtmlValidate(ctx: BuildContext): Promise<void> {
  const hosts = pageScriptHosts(ctx.options);
  for (const page of ctx.pages) {
    const tooLarge = sizeProblem(page);
    if (tooLarge !== undefined) {
      ctx.report.add(RULE, page.path, tooLarge);
      continue;
    }
    const bom = startsWithBom(ctx, page) ? '\uFEFF' : '';
    let messages: Message[];
    try {
      const html = ctx.options.features.islands ? withoutIslandStyle(page.html) : page.html;
      const report = await validatorOf().validateString(`${bom}${withoutDirectives(html)}`, page.file);
      messages = report.results.flatMap((result) => result.messages);
    } catch (error) {
      ctx.report.add(RULE, page.path, `html-validate stopped on the page: ${snippet(String(error))}`);
      continue;
    }
    let scripts: ReadonlyMap<number, HTMLElement> | undefined;
    const lazyScripts = (): ReadonlyMap<number, HTMLElement> => {
      scripts ??= scriptsByStart(page);
      return scripts;
    };
    for (const message of messages) {
      if (message.severity !== ERROR || isAllowedSri(message, lazyScripts, hosts, bom.length)) continue;
      ctx.report.add(RULE, page.path, detailOf(message));
    }
  }
}

/** The html audit. */
export async function auditHtml(ctx: BuildContext): Promise<void> {
  await auditHtmlValidate(ctx);
}

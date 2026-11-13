/**
 * The two output edits of `astro:build:done` (specification, 6.1, step 1): the mode script insert and the
 * speculation insert. They go right after the CSP meta of every built HTML file, `/404.html` included, and they
 * are the only edits that the kit makes to a built page.
 *
 * - The edit works on the bytes of a file, so no other byte of a page changes.
 * - The CSP meta differs between pages (6.2; 13.1, items 12 and 41). So each page is searched for its own meta, and
 *   no meta is kept for the next page.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { listDist } from './build.ts';
import { isHtmlFile } from './context.ts';
import { SPECULATION_JSON } from './csp.ts';
import { hasModeScript, modeScript } from './modes.ts';
import type { Options } from './options.ts';

/** The value of `http-equiv` that makes a `<meta>` the CSP meta. HTML compares it without regard to case. */
const CSP_EQUIV = 'content-security-policy';

/** The elements whose content is text, never markup. A `<meta` inside one is no element. */
const TEXT_ELEMENTS: readonly string[] = [
  'script',
  'style',
  'title',
  'textarea',
  'noscript',
  'xmp',
  'iframe',
  'noembed',
  'noframes',
];

const TAG_NAME = /[a-z][^\t\n\f\r />]*/iy;
/**
 * One attribute: its name, and its value with double quotes, with single quotes or without quotes. A value with an
 * open quote does not match, so its tag is no tag for this module.
 */
const ATTRIBUTE =
  /[\t\n\f\r /]*([^\t\n\f\r />=][^\t\n\f\r />=]*)(?:[\t\n\f\r ]*=[\t\n\f\r ]*(?:"([^"]*)"|'([^']*)'|([^\t\n\f\r >"'][^\t\n\f\r >]*)))?/y;

/** One start tag: its name in lower case, its attributes with names in lower case, and the index after its `>`. */
interface StartTag {
  name: string;
  attributes: Map<string, string>;
  end: number;
}

/** The start tag at `<`, or `undefined` when the text there is no start tag or the tag never ends. */
function startTagAt(html: string, at: number): StartTag | undefined {
  TAG_NAME.lastIndex = at + 1;
  const name = TAG_NAME.exec(html)?.[0];
  if (name === undefined) return undefined;
  const attributes = new Map<string, string>();
  let index = at + 1 + name.length;
  for (;;) {
    ATTRIBUTE.lastIndex = index;
    const attribute = ATTRIBUTE.exec(html);
    if (attribute === null) break;
    const key = (attribute[1] ?? '').toLowerCase();
    // As in HTML, the first attribute of a name counts.
    if (!attributes.has(key)) attributes.set(key, attribute[2] ?? attribute[3] ?? attribute[4] ?? '');
    index = ATTRIBUTE.lastIndex;
  }
  const end = html.indexOf('>', index);
  // Between the last attribute and `>` there is only white space and `/`.
  if (end < 0 || /[^\t\n\f\r /]/.test(html.slice(index, end))) return undefined;
  return { name: name.toLowerCase(), attributes, end: end + 1 };
}

/** The index after the end tag of a text element, or the length of the text when the element never ends. */
function afterTextElement(html: string, name: string, from: number): number {
  const close = new RegExp(`</${name}[\\t\\n\\f\\r />]`, 'ig');
  close.lastIndex = from;
  const found = close.exec(html);
  return found === null ? html.length : found.index;
}

/**
 * The index right after the CSP meta of a page, or `undefined` when the page has none. Astro writes the meta after
 * the head tags of the project and before its `<style>` (13.1, item 12).
 *
 * The page is read as elements, not as text. So a text that only looks like the meta does not count: in a
 * comment, in a script or a style, in the title, or in the value of an attribute. The meta is the first `<meta>`
 * whose `http-equiv` is exactly `content-security-policy`, in any letter case.
 *
 * The text has one character for each byte (latin1), so the index is an index in the bytes. Every character that
 * the search looks for is ASCII.
 */
export function cspMetaEnd(html: string): number | undefined {
  let at = html.indexOf('<');
  while (at >= 0) {
    let next = at + 1;
    if (html.startsWith('<!--', at)) {
      // `<!-->` and `<!--->` are empty comments.
      const end = html.startsWith('>', at + 4) || html.startsWith('->', at + 4) ? at + 2 : html.indexOf('-->', at + 4);
      if (end < 0) return undefined;
      next = end + 3;
    } else if (html.startsWith('<!', at) || html.startsWith('<?', at) || html.startsWith('</', at)) {
      // A doctype, a processing instruction or an end tag: none has attributes that count.
      const end = html.indexOf('>', at);
      if (end < 0) return undefined;
      next = end + 1;
    } else {
      const tag = startTagAt(html, at);
      if (tag !== undefined) {
        const isCsp = tag.name === 'meta' && tag.attributes.get('http-equiv')?.toLowerCase() === CSP_EQUIV;
        if (isCsp) return tag.end;
        next = TEXT_ELEMENTS.includes(tag.name) ? afterTextElement(html, tag.name, tag.end) : tag.end;
      }
    }
    at = html.indexOf('<', next);
  }
  return undefined;
}

/** The settings that decide the inserts. `Options` fits. */
export type InsertSettings = Pick<Options, 'modes' | 'prefetch'>;

/** The mode script insert: `<script>${modeScript(options)}</script>` with two or more mode options, else `''`. */
export function modeInsert(options: Pick<Options, 'modes'>): string {
  return hasModeScript(options) ? `<script>${modeScript(options)}</script>` : '';
}

/** The speculation insert: the block of 6.1 with `prefetch.speculationRules`, else `''`. */
export function speculationInsert(options: Pick<Options, 'prefetch'>): string {
  return options.prefetch.speculationRules ? `<script type="speculationrules">${SPECULATION_JSON}</script>` : '';
}

/** Both inserts as one text, the mode script first. `''` when the settings ask for neither. */
export function inserts(options: InsertSettings): string {
  return modeInsert(options) + speculationInsert(options);
}

/**
 * The page with the text right after its CSP meta (`cspMetaEnd`), or `undefined` when the page has no CSP meta.
 *
 * - Every byte before and after the insert stays as it is. The page is not decoded: a BOM, a CRLF line end and a
 *   byte that is no valid UTF-8 all pass through.
 * - The text is written as UTF-8.
 * - A page that already holds the text right after its meta comes back as it is: the same array, not a copy. So a
 *   second call never inserts the text twice.
 */
export function insertAfterCspMeta(html: Uint8Array, text: string): Uint8Array | undefined {
  const page = Buffer.from(html.buffer, html.byteOffset, html.byteLength);
  // latin1 gives one character for each byte, so an index in the text is an index in the bytes.
  const at = cspMetaEnd(page.toString('latin1'));
  if (at === undefined) return undefined;
  const insert = Buffer.from(text, 'utf8');
  if (page.subarray(at, at + insert.length).equals(insert)) return html;
  return Buffer.concat([page.subarray(0, at), insert, page.subarray(at)]);
}

/** What `injectBuild` did. Both lists hold files from the client directory, with `/`, sorted. */
export interface Injected {
  /** The pages that got the inserts. */
  changed: string[];
  /** The pages without a CSP meta. They are not changed. */
  missing: string[];
}

/**
 * Puts the inserts into every `.html` file under `dist`, on disk. `dist` is the client directory: `dist/`, or
 * `dist/client/` with an adapter (13.1, item 16).
 *
 * - With no insert for the settings, it reads and writes nothing.
 * - A page without a CSP meta is listed in `missing`. The function never throws for it: the caller decides.
 * - A page that already holds the inserts is in neither list.
 */
export function injectBuild(dist: string, options: InsertSettings): Injected {
  const injected: Injected = { changed: [], missing: [] };
  const text = inserts(options);
  if (text === '') return injected;
  for (const file of listDist(dist).filter(isHtmlFile)) {
    const path = join(dist, file);
    const html = readFileSync(path);
    const page = insertAfterCspMeta(html, text);
    if (page === undefined) injected.missing.push(file);
    else if (page !== html) {
      writeFileSync(path, page);
      injected.changed.push(file);
    }
  }
  return injected;
}

/**
 * The error text for pages without a CSP meta: one line `astro-kit: <file> has no CSP meta` for each file. The kit
 * cannot put its inserts into such a page, so `astro:build:done` stops with this text.
 */
export function missingMetaMessage(missing: readonly string[]): string {
  return missing.map((file) => `astro-kit: ${file} has no CSP meta`).join('\n');
}

/**
 * The source halves of the script rules (specification, section 8 and 6.1, step 2.4): `js-script`,
 * `js-prefetch-attr`, `js-directive` and `csp-hash`. They read the start tags of every `.astro` file under `src/`,
 * with file and line. The built halves in `src/audit/page/scripts.ts` and `src/audit/page/shell.ts` are the
 * authority; these halves name the source line early, in `check`, `dev` and at the start of a build.
 *
 * **How a file is read.** `astroTags` scans the template of a `.astro` file for start tags, in one pass, without a
 * regex that can backtrack: it skips the frontmatter between the two `---` fences, HTML comments, and the content of
 * `script` and `style`. An attribute value may be quoted, a template literal or an `{expression}`, whose braces and
 * strings it skips. A tag inside an `{expression}` of the template counts too, because JSX in an expression renders.
 * A text that only looks like a tag inside a string of an expression counts as well: the scan is not a JavaScript
 * parser, and the rules fail closed.
 */
import { ISLAND_DIRECTIVES } from './audit/page/scripts.ts';
import { asciiLower } from './css/parse.ts';
import type { Options } from './options.ts';
import { sources } from './project.ts';
import type { Report } from './registry.ts';

// The scanner

/** One start tag of a `.astro` template. */
export interface SourceTag {
  /** The tag name as written: `script`, `Counter`, `astro-island`. */
  name: string;
  /**
   * The attributes, by name in ASCII lower case, the first of each name. The value is the text inside its quotes, the
   * whole `{expression}` with its braces, or `undefined` for an attribute without a value. A spread `{...props}` is
   * no attribute.
   */
  attributes: ReadonlyMap<string, string | undefined>;
  /** The line of the `<`, from 1. */
  line: number;
}

const isSpace = (char: string | undefined): boolean =>
  char === ' ' || char === '\t' || char === '\n' || char === '\r' || char === '\f';

const isLetter = (char: string | undefined): boolean => char !== undefined && /^[A-Za-z]$/.test(char);

/** The tag name at `start`: a letter, then letters, digits, `_`, `:`, `.` and `-`. */
const TAG_NAME = /[A-Za-z][\w:.-]*/y;

/** An attribute name at a place: any run without white space, `=`, `>`, `/`, quotes and braces. */
const ATTRIBUTE_NAME = /[^\s=>/"'`{}]+/y;

/** An unquoted attribute value: a run without white space and `>`. */
const UNQUOTED = /[^\s>]+/y;

/** The text of a sticky pattern at a place, or `undefined`. */
function stickyAt(pattern: RegExp, text: string, at: number): string | undefined {
  pattern.lastIndex = at;
  return pattern.exec(text)?.[0];
}

/** The end of a quoted text that starts at `start` with its quote: after the closing quote, or the end of the text. */
function quotedEnd(text: string, start: number): number {
  const quote = text[start];
  for (let index = start + 1; index < text.length; index += 1) {
    const char = text[index];
    if (char === '\\') index += 1;
    else if (char === quote) return index + 1;
  }
  return text.length;
}

/**
 * The end of a balanced `{…}` that starts at `start`: after its closing brace, or the end of the text. Strings,
 * template literals and comments inside it are skipped, so a brace in them does not count.
 */
function bracesEnd(text: string, start: number): number {
  let depth = 0;
  let index = start;
  while (index < text.length) {
    const char = text[index];
    if (char === '"' || char === "'" || char === '`') {
      index = quotedEnd(text, index);
      continue;
    }
    if (char === '/' && text[index + 1] === '/') {
      const end = text.indexOf('\n', index);
      index = end < 0 ? text.length : end;
      continue;
    }
    if (char === '/' && text[index + 1] === '*') {
      const end = text.indexOf('*/', index + 2);
      index = end < 0 ? text.length : end + 2;
      continue;
    }
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) return index + 1;
    }
    index += 1;
  }
  return text.length;
}

/**
 * The place where the template of a `.astro` file starts: after the closing `---` fence of the frontmatter, when
 * the file starts with one (white space before it is allowed). A file without frontmatter starts at 0. A
 * frontmatter without its closing fence holds the whole file.
 */
export function templateStart(text: string): number {
  let index = 0;
  while (isSpace(text[index]) || text[index] === '﻿') index += 1;
  if (!text.startsWith('---', index)) return 0;
  const close = /^---/gm;
  close.lastIndex = index + 3;
  const found = close.exec(text);
  return found === null ? text.length : found.index + 3;
}

/** The elements whose content is text: no tag inside them is an element. */
const RAW_TEXT: ReadonlySet<string> = new Set(['script', 'style']);

/** The line of each place of a text, found by a binary search over the line starts. */
function lineFinder(text: string): (at: number) => number {
  const starts = [0];
  for (let index = text.indexOf('\n'); index >= 0; index = text.indexOf('\n', index + 1)) starts.push(index + 1);
  return (at) => {
    let low = 0;
    let high = starts.length - 1;
    while (low < high) {
      const middle = (low + high + 1) >> 1;
      if ((starts[middle] ?? 0) <= at) low = middle;
      else high = middle - 1;
    }
    return low + 1;
  };
}

/** The attributes of a start tag from `start` (after its name) to its end. Returns them and the end of the tag. */
function readAttributes(
  text: string,
  start: number,
): { attributes: Map<string, string | undefined>; end: number; selfClosing: boolean } {
  const attributes = new Map<string, string | undefined>();
  let index = start;
  while (index < text.length) {
    while (isSpace(text[index])) index += 1;
    const char = text[index];
    if (char === undefined) break;
    if (char === '>') return { attributes, end: index + 1, selfClosing: false };
    if (text.startsWith('/>', index)) return { attributes, end: index + 2, selfClosing: true };
    if (char === '{') {
      index = bracesEnd(text, index);
      continue;
    }
    const name = stickyAt(ATTRIBUTE_NAME, text, index);
    if (name === undefined) {
      index += 1;
      continue;
    }
    index += name.length;
    let value: string | undefined;
    let after = index;
    while (isSpace(text[after])) after += 1;
    if (text[after] === '=') {
      after += 1;
      while (isSpace(text[after])) after += 1;
      const first = text[after];
      if (first === '"' || first === "'" || first === '`') {
        const end = quotedEnd(text, after);
        value = text.slice(after + 1, Math.max(after + 1, end - 1));
        index = end;
      } else if (first === '{') {
        const end = bracesEnd(text, after);
        value = text.slice(after, end);
        index = end;
      } else {
        value = stickyAt(UNQUOTED, text, after) ?? '';
        index = after + value.length;
      }
    }
    const key = asciiLower(name);
    if (!attributes.has(key)) attributes.set(key, value);
  }
  return { attributes, end: text.length, selfClosing: false };
}

/**
 * The start tags of the template of a `.astro` file, in order (see the module comment). It reads each character a
 * bounded number of times, and it never throws.
 */
export function astroTags(text: string): SourceTag[] {
  const out: SourceTag[] = [];
  const lineAt = lineFinder(text);
  let index = templateStart(text);
  while (index < text.length) {
    const open = text.indexOf('<', index);
    if (open < 0) break;
    if (text.startsWith('<!--', open)) {
      const close = text.indexOf('-->', open + 4);
      index = close < 0 ? text.length : close + 3;
      continue;
    }
    if (!isLetter(text[open + 1])) {
      index = open + 1;
      continue;
    }
    const name = stickyAt(TAG_NAME, text, open + 1) ?? '';
    const { attributes, end, selfClosing } = readAttributes(text, open + 1 + name.length);
    out.push({ name, attributes, line: lineAt(open) });
    index = end;
    const lower = asciiLower(name);
    if (!selfClosing && RAW_TEXT.has(lower) && /^[a-z]/.test(name)) {
      const close = new RegExp(`</${lower}`, 'ig');
      close.lastIndex = end;
      const found = close.exec(text);
      index = found === null ? text.length : found.index;
    }
  }
  return out;
}

// The rules

/** The rules of the source halves, in the order in which they report. */
export const SOURCE_RULES: readonly string[] = ['js-script', 'js-prefetch-attr', 'js-directive', 'csp-hash'];

/** The two directives of Astro that the CSP cannot hash (section 8, `csp-hash`). */
const UNHASHED: readonly string[] = ['define:vars', 'is:inline'];

/**
 * Says whether a tag is an HTML `script` element: Astro reads a tag name that starts with a capital letter as a
 * component, and any other as an element, whose name HTML reads in any letter case.
 */
const isScriptTag = (tag: SourceTag): boolean => asciiLower(tag.name) === 'script' && /^[a-z]/.test(tag.name);

/** Says whether a script tag is JSON-LD: its `type` is `application/ld+json`, trimmed and in any ASCII case. */
const isJsonLd = (tag: SourceTag): boolean => {
  const type = tag.attributes.get('type');
  return type !== undefined && asciiLower(type.trim()) === 'application/ld+json';
};

/**
 * Says whether the settings allow a `<script>` other than JSON-LD in a `.astro` file: `features.scripts`, or an
 * origin with `script` and `load: "page"` (section 8, `js-script`). Islands alone allow none: Astro writes the
 * scripts of an island itself, and a bundled script needs scripts.
 */
export function allowsSourceScripts(options: Pick<Options, 'features' | 'origins'>): boolean {
  return (
    options.features.scripts ||
    options.origins.some((origin) => origin.directives.includes('script') && origin.load === 'page')
  );
}

/**
 * The source halves of `js-script`, `js-prefetch-attr`, `js-directive` and `csp-hash`, on every `.astro` file under
 * `src/` (6.1, step 2.4). Each finding stands at `<file>:<line>` of the tag. The findings of one rule come together,
 * and the rules come in the order of `SOURCE_RULES`.
 *
 * - `js-script`: a `<script>` whose `type` is not `application/ld+json` needs `allowsSourceScripts`. A `type` that is
 *   an `{expression}` is no JSON-LD. This half reads the settings, so it runs only with valid settings
 *   (`options` is then given).
 * - `js-prefetch-attr`: no tag carries `data-astro-prefetch`, an element or a component.
 * - `js-directive`: every `client:*` directive is `client:visible`, `client:idle` or `client:media`, in any letter
 *   case of its name.
 * - `csp-hash`: no tag carries `define:vars` or `is:inline`.
 *
 * A file larger than the kit reads is `config-suppression`'s.
 */
export function checkScriptSources(root: string, options: Options | undefined, report: Report): void {
  const scripts = options === undefined ? undefined : allowsSourceScripts(options);
  // Each rule reports in one run, in the order of section 8 (6.1, step 2.4).
  const found = new Map<string, [where: string, detail: string][]>(SOURCE_RULES.map((id) => [id, []]));
  const add = (id: string, where: string, detail: string): void => {
    found.get(id)?.push([where, detail]);
  };
  for (const source of sources(root, ['.astro'])) {
    if (source.text === undefined) continue;
    for (const tag of astroTags(source.text)) {
      const where = `${source.path}:${tag.line}`;
      if (scripts === false && isScriptTag(tag) && !isJsonLd(tag)) {
        add('js-script', where, `<${tag.name}> needs features.scripts or a page script origin`);
      }
      if (tag.attributes.has('data-astro-prefetch')) add('js-prefetch-attr', where, `<${tag.name}>`);
      for (const name of tag.attributes.keys()) {
        if (name.startsWith('client:') && !ISLAND_DIRECTIVES.has(name.slice('client:'.length))) {
          add('js-directive', where, `${name} on <${tag.name}>`);
        }
      }
      for (const name of UNHASHED) if (tag.attributes.has(name)) add('csp-hash', where, `${name} on <${tag.name}>`);
    }
  }
  for (const [id, list] of found) for (const [where, detail] of list) report.add(id, where, detail);
}

/**
 * The budgets audit (specification, 6.1, `astro:build:done`, step 4, third; section 8): `js-budget`, `budget-head`,
 * `budget-document`, `budget-dom` and `budget-fonts`.
 *
 * **Compressed size** is the larger of zstd level 3 (`ZSTD_c_compressionLevel`) and brotli quality 5
 * (`BROTLI_PARAM_QUALITY`) of the bytes (section 8): `compressedSize`.
 *
 * **Scopes** (Measurement details): `js-budget`, `budget-head`, `budget-document` and `budget-dom` hold for each page, and report
 * at the page path. `budget-fonts` holds for the site as a whole, and reports once, at `/` (the place of a waiver for
 * it).
 *
 * **Who reports what.** `budget-head` measures the HTML up to and including `</head>`, and the CSP meta tag alone;
 * `budget-document` the whole file. A page over both limits gives both ids: two limits, two facts. `budget-dom`
 * counts elements and depth: one finding for each of the two limits that a page breaks. Font files over the limit are
 * `budget-fonts`'s; the number of families is `fonts-limit`'s.
 */
import { brotliCompressSync, constants, zstdCompressSync } from 'node:zlib';
import type { HTMLElement } from 'node-html-parser';
import type { BuildContext, BuiltPage } from '../context.ts';
import { asciiLower } from '../css/parse.ts';
import {
  type AuditRule,
  attr,
  cspMetasOf,
  decodePath,
  distFileOf,
  domOf,
  type PageDom,
  rawContentOf,
  runRules,
  scriptKind,
  tokensOf,
} from './dom.ts';

const ENCODER = new TextEncoder();

/** The compressed size of a text (as UTF-8) or of bytes: the larger of zstd level 3 and brotli quality 5. */
export function compressedSize(data: string | Uint8Array): number {
  const bytes = typeof data === 'string' ? ENCODER.encode(data) : data;
  const zstd = zstdCompressSync(bytes, { params: { [constants.ZSTD_c_compressionLevel]: 3 } }).length;
  const brotli = brotliCompressSync(bytes, { params: { [constants.BROTLI_PARAM_QUALITY]: 5 } }).length;
  return Math.max(zstd, brotli);
}

/** A size for a detail: `14,512 B`. */
const bytes = (size: number): string => `${size.toLocaleString('en-US')} B`;

// js-budget

/** The static imports of a JS text, exact (section 8): `import "…"`, `from "…"`, for a `.js` file. */
export const STATIC_IMPORT = /(?:\bimport|\bfrom)\s*["']([^"']+\.js)["']/g;

/**
 * The dynamic imports of a JS text, exact (section 8): `import("…")`, `import('…')` or ``import(`…`)`` of a `.js`
 * file. A template literal counts only without a substitution (`${`). Astro 7 bundles with Rolldown, which writes the
 * backtick form. The specifier is the group that matched.
 */
export const DYNAMIC_IMPORT = /\bimport\(\s*(?:"([^"]+\.js)"|'([^']+\.js)'|`([^`$]+\.js)`)\s*\)/g;

/**
 * The start of every `import(` call: the word `import`, white space, and `(`. A property access (`x.import(`) and a
 * longer name (`reimport(`) are no such call. Each one must be a match of `DYNAMIC_IMPORT`, or the JS cannot be
 * measured.
 */
const IMPORT_CALL = /(?<![\w$.])import\s*\(/g;

/**
 * The worker URLs of a JS text, exact (section 8): a string literal of a `.js` file as the first argument of
 * `new URL(`, `new Worker(`, `new SharedWorker(`, `importScripts(` or `serviceWorker.register(`. Rolldown writes a
 * worker as ``new Worker(new URL(`/_astro/w.js`, ``+import.meta.url), …)``. The specifier is the group that matched.
 */
export const WORKER_URL =
  /(?:(?<![\w$.])(?:new\s+(?:URL|Worker|SharedWorker)|importScripts)|\bserviceWorker\s*\.\s*register)\s*\(\s*(?:"([^"]+\.js)"|'([^']+\.js)'|`([^`$]+\.js)`)/g;

/**
 * The start of every call that starts a worker: `new Worker(`, `new SharedWorker(`, `importScripts(` and
 * `serviceWorker.register(`. Each one must take a literal of a `.js` file (`WORKER_ARGUMENT`), or the JS cannot be
 * measured.
 */
const WORKER_CALL =
  /(?:(?<![\w$.])(?:new\s+(?:Worker|SharedWorker)|importScripts)|\bserviceWorker\s*\.\s*register)\s*\(/g;

/** The first argument of a worker call that the kit can measure: a literal of a `.js` file, or `new URL(` of one. */
const WORKER_ARGUMENT = /\s*(?:new\s+URL\s*\(\s*)?(?:"[^"]+\.js"|'[^']+\.js'|`[^`$]+\.js`)/y;

/** The specifier of a match of `DYNAMIC_IMPORT` or `WORKER_URL`: the group that matched. */
const dynamicSpecifier = (match: RegExpMatchArray): string => match[1] ?? match[2] ?? match[3] ?? '';

/** The prefetch chunk of `injectScript('page', …)`, by its path (13.1, item 8). */
export const PREFETCH_CHUNK = /^\/_astro\/page(\.[\w-]+)?\.js$/;

/** The attributes of an `astro-island` that name the JS that loads at once. */
export const ISLAND_URLS: readonly string[] = ['component-url', 'renderer-url', 'before-hydration-url'];

/** What `js-budget` reads of the JS files of a build, each file once. */
interface JsIndex {
  /** The dist file of a URL of the page or of the file at `base`, or `undefined` when dist has no such file. */
  fileOf: (url: string, base: string) => string | undefined;
  /** The files that a file names in its static imports. */
  imports: (file: string) => readonly string[];
  /** The files that a JS text names in its static imports; `base` is the URL path of the text. */
  staticOf: (text: string, base: string) => string[];
  /** The dist files that a JS text names in `import()` or as a worker URL; `base` is the URL path of the text. */
  dynamic: (text: string, base: string) => string[];
  /** The text of a dist file, as UTF-8. */
  text: (file: string) => string;
  /** The compressed size of a dist file. */
  size: (file: string) => number;
}

const JS_INDEXES = new WeakMap<BuildContext, JsIndex>();

const DECODER = new TextDecoder();

/** The JS index of a build, made once for each context. */
function jsIndexOf(ctx: BuildContext): JsIndex {
  const known = JS_INDEXES.get(ctx);
  if (known !== undefined) return known;
  const texts = new Map<string, string>();
  const sizes = new Map<string, number>();
  const statics = new Map<string, readonly string[]>();
  const fileOf = (url: string, base: string): string | undefined => distFileOf(ctx, url, base);
  const text = (file: string): string => {
    let found = texts.get(file);
    if (found === undefined) {
      const content = ctx.read(file);
      found = content === undefined ? '' : DECODER.decode(content);
      texts.set(file, found);
    }
    return found;
  };
  const named = (specifiers: Iterable<string>, base: string): string[] => {
    const out: string[] = [];
    for (const specifier of specifiers) {
      const file = fileOf(specifier, base);
      if (file !== undefined) out.push(file);
    }
    return out;
  };
  const staticOf = (source: string, base: string): string[] =>
    named(
      [...source.matchAll(STATIC_IMPORT)].map((match) => match[1] ?? ''),
      base,
    );
  const index: JsIndex = {
    fileOf,
    imports: (file) => {
      let found = statics.get(file);
      if (found === undefined) {
        found = staticOf(text(file), `/${file}`);
        statics.set(file, found);
      }
      return found;
    },
    staticOf,
    dynamic: (source, base) =>
      named([...source.matchAll(DYNAMIC_IMPORT), ...source.matchAll(WORKER_URL)].map(dynamicSpecifier), base),
    text,
    size: (file) => {
      let found = sizes.get(file);
      if (found === undefined) {
        found = compressedSize(ctx.read(file) ?? new Uint8Array());
        sizes.set(file, found);
      }
      return found;
    },
  };
  JS_INDEXES.set(ctx, index);
  return index;
}

/**
 * Says whether a JS text holds an `import(` that `DYNAMIC_IMPORT` does not read: its argument is no string literal
 * of a `.js` file (`import(url)`, a template literal with `${`), or white space stands before the parenthesis. It
 * also holds when a worker call (`WORKER_CALL`) takes no literal of a `.js` file (`WORKER_ARGUMENT`). The kit cannot
 * know what such a call loads, so the JS cannot be measured.
 */
export function hasUnmeasuredImport(text: string): boolean {
  const read = new Set<number>();
  for (const match of text.matchAll(DYNAMIC_IMPORT)) read.add(match.index);
  for (const match of text.matchAll(IMPORT_CALL)) if (!read.has(match.index)) return true;
  for (const match of text.matchAll(WORKER_CALL)) {
    WORKER_ARGUMENT.lastIndex = match.index + match[0].length;
    if (!WORKER_ARGUMENT.test(text)) return true;
  }
  return false;
}

/** The static-import closure of some files: the files and every file that they import, at any depth, once each. */
function closureOf(index: JsIndex, start: Iterable<string>): Set<string> {
  const seen = new Set<string>();
  const stack = [...start];
  for (let file = stack.pop(); file !== undefined; file = stack.pop()) {
    if (seen.has(file)) continue;
    seen.add(file);
    for (const next of index.imports(file)) if (!seen.has(next)) stack.push(next);
  }
  return seen;
}

/**
 * The JS that loads later: every dist file that a file of `start` or one of the inline `texts` names in `import()` or
 * as a worker URL, with its static closure, and again for the `import()` of each new file, until nothing is added; minus
 * the files of `atOnce`. Each file is read once, so the search ends.
 */
function laterOf(
  index: JsIndex,
  atOnce: ReadonlySet<string>,
  texts: readonly { text: string; base: string }[],
): Set<string> {
  const later = new Set<string>();
  const queue: string[] = [];
  const add = (named: readonly string[]): void => {
    for (const file of closureOf(index, named)) {
      if (atOnce.has(file) || later.has(file)) continue;
      later.add(file);
      queue.push(file);
    }
  };
  for (const { text, base } of texts) add(index.dynamic(text, base));
  for (const file of atOnce) add(index.dynamic(index.text(file), `/${file}`));
  for (let file = queue.pop(); file !== undefined; file = queue.pop()) add(index.dynamic(index.text(file), `/${file}`));
  return later;
}

/** The sum of the compressed sizes of some files. */
function sizeOf(index: JsIndex, files: Iterable<string>): number {
  let total = 0;
  for (const file of files) total += index.size(file);
  return total;
}

/** The largest files of a set as a detail: `/_astro/a.js 12,000 B, /_astro/b.js 900 B`, at most five. */
function largest(index: JsIndex, files: ReadonlySet<string>): string {
  const list = [...files]
    .map((file) => [file, index.size(file)] as const)
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  const shown = list.slice(0, 5).map(([file, size]) => `/${file} ${bytes(size)}`);
  return list.length > 5 ? `${shown.join(', ')}, and ${list.length - 5} more` : shown.join(', ');
}

/** The first five names of a list as a detail, with the number of the others. */
function firstNames(names: readonly string[]): string {
  const shown = names.slice(0, 5).join(', ');
  return names.length > 5 ? `${shown}, and ${names.length - 5} more` : shown;
}

/** One module script of a page: the dist file of its `src`, or its inline text. */
interface ModuleScript {
  /** The URL path of the text: the file of `src`, or the page for an inline script. */
  base: string;
  text: string;
  /** The dist file of `src`, or `undefined` for an inline script and for a `src` that names no dist file. */
  file: string | undefined;
  /** Says whether the script is inline: it has no `src`. */
  inline: boolean;
}

/** The module scripts of a page (`type="module"`), with `src` or inline. */
function moduleScripts(index: JsIndex, dom: PageDom): ModuleScript[] {
  const out: ModuleScript[] = [];
  for (const script of dom.byTag('script')) {
    if (scriptKind(script) !== 'module') continue;
    const src = attr(script, 'src');
    if (src === undefined) {
      out.push({ base: dom.page.path, text: rawContentOf(script), file: undefined, inline: true });
      continue;
    }
    const file = index.fileOf(src, dom.page.path);
    out.push({
      base: file === undefined ? dom.page.path : `/${file}`,
      text: file === undefined ? '' : index.text(file),
      file,
      inline: false,
    });
  }
  return out;
}

/**
 * `js-budget` (section 8), for each page.
 *
 * - **At once:** the static-import closure (`STATIC_IMPORT`) of the files that the `component-url`, `renderer-url`
 *   and `before-hydration-url` of every `astro-island` of the page name, and of every module script of the page: the
 *   file of its `src`, or the files that its inline text imports; and of the file of every `link` whose `rel` holds
 *   `modulepreload`, or `preload` with `as="script"`. The sum of their compressed sizes is at most `islandJsBytes`.
 * - **Later:** every dist file that an at-once file or an inline module script names in `import()`
 *   (`DYNAMIC_IMPORT`) or as a worker URL (`WORKER_URL`), with the static-import closure of each, and again for the `import()` of each new file, until
 *   nothing is added (`laterOf`); minus the at-once files. The sum is at most `lazyJsBytes`.
 * - **Cannot be measured:** an at-once or later file, or an inline module script, with an `import(` that
 *   `DYNAMIC_IMPORT` does not read, or a worker call with no literal URL (`hasUnmeasuredImport`).
 * - **Prefetch:** a module script of the page whose `src` is the prefetch chunk (`PREFETCH_CHUNK`), with its
 *   static-import closure, is at most `prefetchJsBytes`. With astroPrefetch on, a page without that chunk, or whose
 *   chunk names no dist file, fails.
 *
 * A URL resolves against the page, and a specifier of a JS file against the URL of that file (`resolveHref`). A URL
 * that names no dist file adds nothing: the browser loads nothing from it. One finding for each limit that a page
 * breaks, with its largest files.
 */
export function auditJsBudget(ctx: BuildContext): void {
  const index = jsIndexOf(ctx);
  const { islandJsBytes, lazyJsBytes, prefetchJsBytes } = ctx.limits;
  for (const page of ctx.pages) {
    const dom = domOf(page);
    const start: string[] = [];
    for (const island of dom.byTag('astro-island')) {
      for (const name of ISLAND_URLS) {
        const url = attr(island, name);
        const file = url === undefined ? undefined : index.fileOf(url, page.path);
        if (file !== undefined) start.push(file);
      }
    }
    for (const link of dom.byTag('link')) {
      const rel = tokensOf(link, 'rel');
      const script =
        rel.includes('modulepreload') ||
        (rel.includes('preload') && asciiLower(attr(link, 'as') ?? '').trim() === 'script');
      const href = attr(link, 'href');
      const file = script && href !== undefined ? index.fileOf(href, page.path) : undefined;
      if (file !== undefined) start.push(file);
    }
    const scripts = moduleScripts(index, dom);
    const inline = scripts.filter((script) => script.inline);
    for (const script of scripts) {
      if (script.file !== undefined) start.push(script.file);
      if (script.inline) start.push(...index.staticOf(script.text, script.base));
    }
    const atOnce = closureOf(index, start);
    const later = laterOf(index, atOnce, inline);

    const now = sizeOf(index, atOnce);
    if (now > islandJsBytes) {
      ctx.report.add(
        'js-budget',
        page.path,
        `the JS that loads at once has ${bytes(now)} compressed; at most ${bytes(islandJsBytes)} (${largest(index, atOnce)})`,
      );
    }
    const lazy = sizeOf(index, later);
    if (lazy > lazyJsBytes) {
      ctx.report.add(
        'js-budget',
        page.path,
        `the JS that loads later through import() or a worker has ${bytes(lazy)} compressed; at most ${bytes(lazyJsBytes)} (${largest(index, later)})`,
      );
    }
    const unmeasured = [
      ...[...atOnce, ...later].filter((file) => hasUnmeasuredImport(index.text(file))).map((file) => `/${file}`),
      ...(inline.some((script) => hasUnmeasuredImport(script.text)) ? ['an inline module script'] : []),
    ];
    if (unmeasured.length > 0) {
      ctx.report.add(
        'js-budget',
        page.path,
        `the JS cannot be measured: an import() or a worker whose argument is no string literal of a .js file (${firstNames(unmeasured)})`,
      );
    }
    const chunks = scripts
      .map((script) => script.file)
      .filter((file): file is string => file !== undefined && PREFETCH_CHUNK.test(`/${file}`));
    for (const chunk of new Set(chunks)) {
      const closure = closureOf(index, [chunk]);
      const size = sizeOf(index, closure);
      if (size > prefetchJsBytes) {
        ctx.report.add(
          'js-budget',
          page.path,
          `the prefetch chunk has ${bytes(size)} compressed with its imports; at most ${bytes(prefetchJsBytes)} (${largest(index, closure)})`,
        );
      }
    }
    if (ctx.options.prefetch.astroPrefetch && chunks.length === 0) {
      ctx.report.add(
        'js-budget',
        page.path,
        'astroPrefetch is on, but the page loads no prefetch chunk /_astro/page.<hash>.js',
      );
    }
  }
}

// budget-head

/** The end of the head in `page.html`: after the `</head>` of the first `head` element, or the end of the file. */
function headEnd(dom: PageDom): number {
  return dom.head?.range[1] ?? dom.page.html.length;
}

/** The parts of a head, each compressed alone (section 8: "a failure prints the separately compressed ..."). */
function headParts(dom: PageDom, end: number): string {
  const { html } = dom.page;
  const inHead = (element: HTMLElement): boolean => element.range[1] <= end;
  const styles = dom.byTag('style').filter(inHead);
  const metas = cspMetasOf(dom).filter(inHead);
  const jsonld = dom.byTag('script').filter((element) => inHead(element) && scriptKind(element) === 'json-ld');
  // The markup is the head without these elements: the gaps between their ranges, in order.
  const cut = [...styles, ...metas, ...jsonld].map((element) => element.range).sort((a, b) => a[0] - b[0]);
  const gaps: string[] = [];
  let from = 0;
  for (const [start, stop] of cut) {
    if (start < from) continue;
    gaps.push(html.slice(from, start));
    from = stop;
  }
  gaps.push(html.slice(from, end));
  const size = (texts: readonly string[]): string => bytes(texts.length === 0 ? 0 : compressedSize(texts.join('')));
  return [
    `markup ${size(gaps)}`,
    `CSS ${size(styles.map(rawContentOf))}`,
    `CSP meta ${size(metas.map((meta) => html.slice(meta.range[0], meta.range[1])))}`,
    `JSON-LD ${size(jsonld.map(rawContentOf))}`,
  ].join(', ');
}

/**
 * `budget-head`: the HTML up to and including the first `</head>` (the end of the first `head` element; the whole
 * file when there is no `head`) compressed ≤ `headBytes`, and the CSP meta tag of the page alone compressed ≤
 * `cspBytes`. The meta is the first CSP meta of the page; a page without one has nothing to measure (`csp-meta`
 * reports it). Each failure prints the separately compressed markup, CSS, CSP meta and JSON-LD of the head.
 */
export function auditBudgetHead(ctx: BuildContext): void {
  const { headBytes, cspBytes } = ctx.limits;
  for (const page of ctx.pages) {
    const dom = domOf(page);
    const end = headEnd(dom);
    const head = compressedSize(page.html.slice(0, end));
    const meta = cspMetasOf(dom)[0];
    const policy = meta === undefined ? 0 : compressedSize(page.html.slice(meta.range[0], meta.range[1]));
    if (head <= headBytes && policy <= cspBytes) continue;
    const parts = headParts(dom, end);
    if (head > headBytes) {
      ctx.report.add(
        'budget-head',
        page.path,
        `the head has ${bytes(head)} compressed; at most ${bytes(headBytes)} (${parts})`,
      );
    }
    if (policy > cspBytes) {
      ctx.report.add(
        'budget-head',
        page.path,
        `the CSP meta has ${bytes(policy)} compressed; at most ${bytes(cspBytes)} (${parts})`,
      );
    }
  }
}

// budget-document

/** The bytes of a page as built: the file, or its text when the file cannot be read. */
const pageBytes = (ctx: BuildContext, page: BuiltPage): Uint8Array => ctx.read(page.file) ?? ENCODER.encode(page.html);

/** `budget-document`: the whole page, the bytes of its file as built, compressed ≤ `documentBytes`. */
export function auditBudgetDocument(ctx: BuildContext): void {
  const limit = ctx.limits.documentBytes;
  for (const page of ctx.pages) {
    const size = compressedSize(pageBytes(ctx, page));
    if (size > limit) {
      ctx.report.add('budget-document', page.path, `the page has ${bytes(size)} compressed; at most ${bytes(limit)}`);
    }
  }
}

// budget-dom

/**
 * `budget-dom`: ≤ `domElements` elements and a depth ≤ `domDepth` (`html` is depth 1). Every element of the
 * document counts, `html` included. One finding for each limit that a page breaks.
 */
export function auditBudgetDom(ctx: BuildContext): void {
  const { domElements, domDepth } = ctx.limits;
  for (const page of ctx.pages) {
    const dom = domOf(page);
    const count = dom.elements.length;
    let depth = 0;
    for (const element of dom.elements) depth = Math.max(depth, dom.depth(element));
    if (count > domElements) {
      ctx.report.add('budget-dom', page.path, `${count.toLocaleString('en-US')} elements; at most ${domElements}`);
    }
    if (depth > domDepth) ctx.report.add('budget-dom', page.path, `depth ${depth}; at most ${domDepth}`);
  }
}

// budget-fonts

/** The exact regex of `budget-fonts` (section 8). `fontPaths` finds the same matches without backtracking. */
export const FONT_PATH = /\/[^"'()\s,]+\.(?:woff2?|ttf|otf)(?=[?#"'()\s,]|$)/gi;

/** A run of the characters that `FONT_PATH` never takes into a match: they split the text into runs. */
const STOPS = /["'()\s,]+/;

/** The font extensions of `FONT_PATH`, in lower case. */
const FONT_EXTENSIONS: ReadonlySet<string> = new Set(['woff', 'woff2', 'ttf', 'otf']);

/**
 * The end of a font path whose dot is at `dot` in `run`, or -1: `.woff`, `.woff2`, `.ttf` or `.otf`, in any letter
 * case, followed by the end of the run, `?` or `#` (the lookahead of `FONT_PATH`).
 */
function extensionEnd(run: string, dot: number): number {
  for (const length of [5, 4, 3]) {
    const end = dot + 1 + length;
    if (end > run.length) continue;
    if (!FONT_EXTENSIONS.has(run.slice(dot + 1, end).toLowerCase())) continue;
    const next = run[end];
    if (next === undefined || next === '?' || next === '#') return end;
  }
  return -1;
}

/**
 * The matches of `FONT_PATH` in a text, in order, in linear time. A match lies inside one run of characters that the
 * class `[^"'()\s,]` takes, and the lookahead holds at the end of each run. In a run, the regex starts at the first
 * `/` and takes the longest match: up to the last font extension that ends the run or stands before `?` or `#`,
 * with at least one character between the `/` and the dot. No later start in the run can match then, so a run gives
 * at most one match. The exact regex would retry from each `/` of a long run: quadratic on hostile text.
 */
export function fontPaths(text: string): string[] {
  const out: string[] = [];
  for (const run of text.split(STOPS)) {
    const found = fontPathIn(run);
    if (found !== undefined) out.push(found);
  }
  return out;
}

/** The one match of `FONT_PATH` in a run without stop characters, or `undefined`. */
function fontPathIn(run: string): string | undefined {
  const slash = run.indexOf('/');
  if (slash < 0) return undefined;
  for (let dot = run.lastIndexOf('.'); dot >= slash + 2; dot = run.lastIndexOf('.', dot - 1)) {
    const end = extensionEnd(run, dot);
    if (end >= 0) return run.slice(slash, end);
  }
  return undefined;
}

/**
 * The dist file of a font path, or `undefined` when the client directory has none: the path without its leading `/`
 * and without a `?` or `#` part, as written or percent-decoded.
 */
function fontFile(files: ReadonlySet<string>, path: string): string | undefined {
  const cut = path.search(/[?#]/);
  const file = (cut < 0 ? path : path.slice(0, cut)).slice(1);
  if (files.has(file)) return file;
  const decoded = decodePath(file);
  return decoded !== undefined && files.has(decoded) ? decoded : undefined;
}

/**
 * `budget-fonts`: the raw bytes of the distinct existing font files that any page or same-origin sheet references
 * ≤ `fontBytes`: one sum for the site. The references are the matches of `FONT_PATH` in the HTML of every page and
 * in every sheet of `ctx.css` (the inline `<style>` texts and the `.css` files of the client directory). A path that
 * names no dist file adds nothing. Over the limit, one finding at `/`, listing the files.
 */
export function auditBudgetFonts(ctx: BuildContext): void {
  const files = new Set(ctx.files);
  const found = new Map<string, number>();
  const add = (text: string): void => {
    for (const path of fontPaths(text)) {
      const file = fontFile(files, path);
      if (file !== undefined && !found.has(file)) found.set(file, ctx.read(file)?.length ?? 0);
    }
  };
  for (const page of ctx.pages) add(page.html);
  for (const sheet of ctx.css) if (sheet.kind === 'file') add(sheet.text);
  let total = 0;
  for (const size of found.values()) total += size;
  const limit = ctx.limits.fontBytes;
  if (total <= limit) return;
  const list = [...found]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, 5)
    .map(([file, size]) => `/${file} ${bytes(size)}`)
    .join(', ');
  const more = found.size > 5 ? `, and ${found.size - 5} more` : '';
  ctx.report.add(
    'budget-fonts',
    '/',
    `${bytes(total)} in ${found.size} font files; at most ${bytes(limit)}: ${list}${more}`,
  );
}

// The audit

/** The rules of the budgets audit, in the order of section 8. */
export const BUDGET_RULES: readonly AuditRule[] = [
  { id: 'js-budget', run: auditJsBudget },
  { id: 'budget-head', run: auditBudgetHead },
  { id: 'budget-document', run: auditBudgetDocument },
  { id: 'budget-dom', run: auditBudgetDom },
  { id: 'budget-fonts', run: auditBudgetFonts },
];

/** The budgets audit: every rule of `BUDGET_RULES`, in order. */
export function auditBudgets(ctx: BuildContext): void {
  runRules(ctx, BUDGET_RULES);
}

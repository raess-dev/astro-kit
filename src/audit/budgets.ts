/**
 * Size budgets, measured as served: max(zstd level 3, brotli quality 5), the larger of the two.
 * Head and document bytes, DOM size, font files and island or prefetch JS.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { brotliCompressSync, constants, zstdCompressSync } from 'node:zlib';
import type { HTMLElement } from 'node-html-parser';
import type { Audit, BuildContext, BuiltPage } from '../context.ts';

/** Compressed size in bytes: the larger of zstd 3 and brotli 5, so either encoding fits. */
export function compressedSize(text: string | Buffer): number {
  const input = typeof text === 'string' ? Buffer.from(text) : text;
  if (input.length === 0) return 0;
  const zstd = zstdCompressSync(input, { params: { [constants.ZSTD_c_compressionLevel]: 3 } }).length;
  const brotli = brotliCompressSync(input, { params: { [constants.BROTLI_PARAM_QUALITY]: 5 } }).length;
  return Math.max(zstd, brotli);
}

export const kb = (bytes: number): string => `${(bytes / 1024).toFixed(1)} KB`;

const CSP_META = /<meta\b[^>]*http-equiv=["']?content-security-policy["']?[^>]*>/gi;
const JSON_LD = /<script\b[^>]*type=["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi;
const STYLE = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;

/** Where the bytes go: markup, CSS, CSP meta and JSON-LD, each compressed on its own. */
export function breakdown(html: string): string {
  let markup = html;
  const take = (re: RegExp, inner: boolean) => {
    let parts = '';
    markup = markup.replace(re, (all: string, body?: string) => {
      parts += inner ? (body ?? '') : all;
      return '';
    });
    return compressedSize(parts);
  };
  const css = take(STYLE, true);
  const csp = take(CSP_META, false);
  const jsonld = take(JSON_LD, true);
  return `markup ${kb(compressedSize(markup))}, CSS ${kb(css)}, CSP meta ${kb(csp)}, JSON-LD ${kb(jsonld)}`;
}

/** The html up to and including </head>; the whole html when there is none. */
export function headOf(html: string): string {
  const end = html.search(/<\/head>/i);
  return end < 0 ? html : html.slice(0, end + '</head>'.length);
}

/** Element count and maximum depth; html is depth 1. */
export function domStats(root: HTMLElement): { elements: number; depth: number } {
  let elements = 0;
  let depth = 0;
  const visit = (node: HTMLElement, d: number): void => {
    for (const child of node.childNodes) {
      if (child.nodeType !== 1) continue;
      elements++;
      if (d > depth) depth = d;
      visit(child as HTMLElement, d + 1);
    }
  };
  visit(root, 1);
  return { elements, depth };
}

const FONT_URL = /\/[^"'()\s,]+\.(?:woff2?|ttf|otf)(?=[?#"'()\s,]|$)/gi;
/** Static imports in an ES module chunk; dynamic import() is loaded later and not counted. */
/** The chunk Astro emits for scripts injected at the page stage: the kit's prefetch gate and Astro's runtime. */
const PREFETCH_CHUNK = /^\/_astro\/page(\.[\w-]+)?\.js$/;
const STATIC_IMPORT = /(?:\bimport|\bfrom)\s*["']([^"']+\.js)["']/g;

const sameOrigin = (url: string, site: string): string | undefined => {
  const path = url.startsWith(`${site}/`) ? url.slice(site.length) : url;
  return path.startsWith('/') && !path.startsWith('//') ? path.split(/[?#]/)[0] : undefined;
};

export const auditBudgets: Audit = (ctx: BuildContext) => {
  const { report, limits, options, dist } = ctx;
  const site = options.site;
  const read = (path: string): string | undefined => {
    const file = join(dist, path);
    return existsSync(file) ? readFileSync(file, 'utf8') : undefined;
  };
  const sizes = new Map<string, number>();
  const sizeOf = (path: string): number => {
    const size = sizes.get(path) ?? compressedSize(readFileSync(join(dist, path)));
    sizes.set(path, size);
    return size;
  };
  /** Every dist JS file the entries load through static imports. */
  const closure = (entries: Iterable<string>): string[] => {
    const seen = new Set<string>();
    const queue = [...entries];
    while (queue.length > 0) {
      const path = queue.pop() ?? '';
      if (seen.has(path)) continue;
      const code = read(path);
      if (code === undefined) continue;
      seen.add(path);
      for (const m of code.matchAll(STATIC_IMPORT))
        queue.push(new URL(m[1] ?? '', `https://kit.invalid${path}`).pathname);
    }
    return [...seen];
  };
  const jsBudget = (page: BuiltPage, label: string, files: string[], extra: number, limit: number) => {
    const total = files.reduce((n, f) => n + sizeOf(f), extra);
    if (total <= limit) return;
    const parts = files.map((f) => `${f} ${kb(sizeOf(f))}`);
    if (extra > 0) parts.push(`inline ${kb(extra)}`);
    report.add('js-budget', page.path, `${label} ${kb(total)} > ${kb(limit)}: ${parts.join(', ')}`);
  };

  const fonts = new Set<string>();
  const cssFiles = new Map(ctx.css.filter((c) => c.where.endsWith('.css')).map((c) => [c.where, c.text]));
  for (const page of ctx.pages) {
    const { html, doc } = page;
    const head = headOf(html);
    const headSize = compressedSize(head);
    if (headSize > limits.headBytes)
      report.add('budget-head', page.path, `${kb(headSize)} > ${kb(limits.headBytes)}: ${breakdown(head)}`);
    const docSize = compressedSize(html);
    if (docSize > limits.documentBytes)
      report.add('budget-document', page.path, `${kb(docSize)} > ${kb(limits.documentBytes)}: ${breakdown(html)}`);
    const dom = domStats(doc);
    if (dom.elements > limits.domElements || dom.depth > limits.domDepth) {
      report.add(
        'budget-dom',
        page.path,
        `${dom.elements} elements (limit ${limits.domElements}), depth ${dom.depth} (limit ${limits.domDepth})`,
      );
    }

    // Fonts: referenced from the page or from a stylesheet it links.
    const texts = [html];
    for (const link of doc.querySelectorAll('link[rel~=stylesheet]')) {
      const sheet = cssFiles.get(sameOrigin(link.getAttribute('href') ?? '', site) ?? '');
      if (sheet) texts.push(sheet);
    }
    for (const text of texts) for (const m of text.matchAll(FONT_URL)) fonts.add(m[0]);

    if (options.features.islands) {
      const entries = doc
        .querySelectorAll('astro-island')
        .flatMap((el) =>
          ['component-url', 'renderer-url', 'before-hydration-url'].map((a) =>
            sameOrigin(el.getAttribute(a) ?? '', site),
          ),
        );
      jsBudget(
        page,
        'island JS',
        closure(entries.filter((e): e is string => e !== undefined)),
        0,
        limits.islandJsBytes,
      );
    }
    if (options.prefetch.astroPrefetch) {
      // Astro bundles every injectScript('page') script into one /_astro/page.<hash>.js chunk, and the kit gate is
      // the only one. The path identifies it: the gate's code changes with speculationRules and the minifier.
      const entries = doc
        .querySelectorAll('script[type=module][src]')
        .map((script) => sameOrigin(script.getAttribute('src') ?? '', site))
        .filter((src): src is string => src !== undefined && PREFETCH_CHUNK.test(src));
      if (!entries.length)
        report.add(
          'js-budget',
          page.path,
          'astroPrefetch is on, but the page loads no /_astro/page.*.js chunk to measure',
        );
      else jsBudget(page, 'prefetch JS', closure(entries), 0, limits.prefetchJsBytes);
    }
  }

  // Font files are already compressed, so their raw size counts.
  const present = [...fonts].filter((f) => existsSync(join(dist, f)));
  const fontBytes = present.reduce((n, f) => n + statSync(join(dist, f)).size, 0);
  if (fontBytes > limits.fontBytes) {
    report.add(
      'budget-fonts',
      'dist',
      `${kb(fontBytes)} > ${kb(limits.fontBytes)}: ${present.map((f) => `${f} ${kb(statSync(join(dist, f)).size)}`).join(', ')}`,
    );
  }
};

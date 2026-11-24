/**
 * `serveDist`: the local static server of the browser checks (specification, 3.2 and 14, M6). It emulates Workers
 * static assets with the `assets` block of 10.4: `html_handling: "auto-trailing-slash"` and
 * `not_found_handling: "404-page"`. It follows the asset worker of workers-shared, as `wrangler dev` runs it, step by
 * step. Three choices of the specification differ from that worker: the traversal guard, the text `Not found`, and
 * the compression of row M6.
 *
 * The steps of one request:
 * 1. The guard. A target that does not start with `/` gets the root 404 page. So does a segment that decodes to `.`
 *    or `..` (also through a decoded `/`), or that holds NUL or `\`. No file outside the root is ever read, also not
 *    through a symbolic link.
 * 2. `_redirects`: the static rules by exact path, then the dynamic rules (`*`, `:name`) in file order. The query
 *    is kept. A 200 rule serves its target.
 * 3. The html handling of `auto-trailing-slash`: `/a` gives 307 to `/a/` when `a/index.html` exists, `/a/index.html`
 *    and `/404.html` give 307 to `/a/` and `/404`, and an `a.html` file is served at `/a`. A redirect happens only
 *    when its target gives the same file. A missing path gets the nearest `404.html` up the path, with status 404,
 *    else the text `Not found`.
 * 4. A method other than GET and HEAD gets 405 with `allow: GET, HEAD`.
 * 5. A path in another form than its canonical one gets 307 to that form: each segment decoded and encoded again
 *    with `encodeURIComponent`, and each run of `/` made one.
 * 6. A file answer has an `etag`, its content type, and `cache-control: public, max-age=0, must-revalidate`, except
 *    when the request has `Authorization` or `Range`. An `If-None-Match` with the etag gets 304.
 * 7. The rules of `_headers` apply to an answer of any status (13.1 item 19), with `:splat` and `:name` replaced in
 *    the values.
 * 8. Text answers are compressed: zstd level 3, else brotli quality 5, else gzip, as the request accepts them.
 *
 * The form stub of 9.1 is not here: it comes with forms (M7). A caller observes each request through `received`
 * or `onRequest`, for example the `Sec-Purpose` header of a prerender (`perf-prerender`).
 */
import { createHash } from 'node:crypto';
import { createReadStream, type Stats } from 'node:fs';
import { readFile, realpath, stat } from 'node:fs/promises';
import {
  createServer,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type ServerResponse,
  validateHeaderName,
  validateHeaderValue,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import { extname, join, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';
import { brotliCompress, constants, gzip, zstdCompress } from 'node:zlib';
import {
  HEADERS_FILE,
  type HeaderRule,
  IGNORE_FILE,
  type IgnoreRule,
  ignoreRules,
  isIgnored,
  PLATFORM_IGNORES,
  parseHeaders,
  REDIRECTS_OUT,
} from './hosts/cloudflare.ts';

/** The address that the server listens on. */
export const HOST = '127.0.0.1';
/** The default `cache-control` of a file (13.1 item 21). */
export const FILE_CACHE = 'public, max-age=0, must-revalidate';
/** The `allow` header of a 405 answer. */
export const ALLOW = 'GET, HEAD';
/** The body of a 404 answer when no `404.html` is on the path. */
export const NOT_FOUND_TEXT = 'Not found';
/** The body of an answer when the server fails. */
export const ERROR_TEXT = 'Internal error';
/** A larger text file is streamed without compression. It still gets `vary: accept-encoding`. */
export const COMPRESS_LIMIT = 8 * 1024 * 1024;
/** The encodings, in the order of preference (13.1 item 22). */
export const ENCODINGS: readonly Encoding[] = ['zstd', 'br', 'gzip'];
/** The limits that Cloudflare applies: the `_headers` rules, the characters of a line, the `_redirects` rules. */
export const HEADER_RULE_LIMIT = 100;
export const HEADER_LINE_LIMIT = 2_000;
export const STATIC_REDIRECT_LIMIT = 2_000;
export const DYNAMIC_REDIRECT_LIMIT = 100;
/** The status codes that a `_redirects` rule may give. A rule with no status gives 302. */
const REDIRECT_STATUSES: ReadonlySet<number> = new Set([200, 301, 302, 303, 307, 308]);

export type Encoding = 'zstd' | 'br' | 'gzip';

/**
 * The content types of the files of a static site, as Workers static assets give them (the `mime` 4 table that
 * wrangler uses). A file whose extension is not here gets no content type, as on Cloudflare.
 */
export const CONTENT_TYPES: ReadonlyMap<string, string> = new Map([
  ['.html', 'text/html'],
  ['.htm', 'text/html'],
  ['.css', 'text/css'],
  ['.js', 'text/javascript'],
  ['.mjs', 'text/javascript'],
  ['.cjs', 'application/node'],
  ['.txt', 'text/plain'],
  ['.csv', 'text/csv'],
  ['.tsv', 'text/tab-separated-values'],
  ['.md', 'text/markdown'],
  ['.markdown', 'text/markdown'],
  ['.vtt', 'text/vtt'],
  ['.ics', 'text/calendar'],
  ['.yaml', 'text/yaml'],
  ['.yml', 'text/yaml'],
  ['.xml', 'application/xml'],
  ['.xsl', 'application/xml'],
  ['.xhtml', 'application/xhtml+xml'],
  ['.rss', 'application/rss+xml'],
  ['.atom', 'application/atom+xml'],
  ['.gpx', 'application/gpx+xml'],
  ['.json', 'application/json'],
  ['.map', 'application/json'],
  ['.jsonld', 'application/ld+json'],
  ['.geojson', 'application/geo+json'],
  ['.webmanifest', 'application/manifest+json'],
  ['.toml', 'application/toml'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.apng', 'image/apng'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.gif', 'image/gif'],
  ['.webp', 'image/webp'],
  ['.avif', 'image/avif'],
  ['.jxl', 'image/jxl'],
  ['.heic', 'image/heic'],
  ['.bmp', 'image/bmp'],
  ['.tif', 'image/tiff'],
  ['.tiff', 'image/tiff'],
  ['.ico', 'image/vnd.microsoft.icon'],
  ['.woff2', 'font/woff2'],
  ['.woff', 'font/woff'],
  ['.ttf', 'font/ttf'],
  ['.otf', 'font/otf'],
  ['.pdf', 'application/pdf'],
  ['.wasm', 'application/wasm'],
  ['.mp4', 'video/mp4'],
  ['.webm', 'video/webm'],
  ['.mov', 'video/quicktime'],
  ['.mp3', 'audio/mpeg'],
  ['.m4a', 'audio/mp4'],
  ['.ogg', 'audio/ogg'],
  ['.opus', 'audio/ogg'],
  ['.wav', 'audio/wav'],
  ['.zip', 'application/zip'],
  ['.bin', 'application/octet-stream'],
  ['.gz', 'application/gzip'],
]);

/** The types that are compressed besides `text/*`. */
const COMPRESSED_TYPES: ReadonlySet<string> = new Set([
  'image/svg+xml',
  'application/json',
  'application/xml',
  'application/manifest+json',
]);

/** The headers that frame an answer. The server sets them, and a rule of `_headers` never does. */
const FRAMING: ReadonlySet<string> = new Set([
  'content-length',
  'content-encoding',
  'transfer-encoding',
  'connection',
  'keep-alive',
  'upgrade',
  'trailer',
  'te',
  'proxy-connection',
]);

/** One request as the server saw it. */
export interface Received {
  method: string;
  /** The request target as sent: the path with the query. */
  path: string;
  /** The request headers, with lower-case names. */
  headers: IncomingHttpHeaders;
}

export interface ServeOptions {
  /** Headers for every answer, before the rules of `_headers`: for example a header CSP for a page with no `_headers`. */
  headers?: Readonly<Record<string, string>>;
  /** Called for each request, before the answer. An error that it throws or a promise that it rejects is ignored. */
  onRequest?: (request: Received) => void;
}

export interface Served {
  /** `http://127.0.0.1:<port>`. */
  origin: string;
  /** The address that the socket listens on, as the system reports it: `127.0.0.1`. */
  address: string;
  /** The folder that the server serves: `dist/client` or `dist` (see `clientDir`). */
  root: string;
  /** Every request, in order. */
  received: Received[];
  /** Ends every connection and stops the server. */
  close(): Promise<void>;
}

// Content types and compression

/** The content type of a file name, with `; charset=utf-8` for `text/*`, or `undefined` for an unknown extension. */
export function contentTypeOf(file: string): string | undefined {
  const type = CONTENT_TYPES.get(extname(file).toLowerCase());
  return type?.startsWith('text/') === true ? `${type}; charset=utf-8` : type;
}

/** Says whether an answer of this content type is compressed: `text/*`, SVG, JSON, XML and the web manifest. */
export function isCompressible(type: string): boolean {
  const base = (type.split(';')[0] ?? '').trim().toLowerCase();
  return base.startsWith('text/') || COMPRESSED_TYPES.has(base);
}

/** A quality value of `accept-encoding`: a number from 0 to 1. Any other text gives `undefined`. */
function quality(text: string): number | undefined {
  if (!/^(?:0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/.test(text)) return undefined;
  return Number(text);
}

/**
 * The encoding for an `accept-encoding` header: the first of zstd, br and gzip that the header accepts with a
 * quality above 0, named or through `*`. A named quality wins over `*`. An item with a bad quality is ignored.
 */
export function encodingOf(header: string | undefined): Encoding | undefined {
  if (header === undefined) return undefined;
  const qualities = new Map<string, number>();
  for (const item of header.split(',')) {
    const [name = '', ...params] = item.split(';').map((part) => part.trim());
    if (name === '') continue;
    let value: number | undefined = 1;
    for (const param of params) {
      const equals = param.indexOf('=');
      if (equals < 0) continue;
      if (param.slice(0, equals).trim().toLowerCase() === 'q') value = quality(param.slice(equals + 1).trim());
    }
    if (value !== undefined) qualities.set(name.toLowerCase(), value);
  }
  const any = qualities.get('*') ?? 0;
  return ENCODINGS.find((encoding) => (qualities.get(encoding) ?? any) > 0);
}

const zstdAsync = promisify(zstdCompress);
const brotliAsync = promisify(brotliCompress);
const gzipAsync = promisify(gzip);

/** Compresses bytes: zstd level 3, brotli quality 5, or gzip at its default level. */
export function compress(body: Buffer, encoding: Encoding): Promise<Buffer> {
  if (encoding === 'zstd') return zstdAsync(body, { params: { [constants.ZSTD_c_compressionLevel]: 3 } });
  if (encoding === 'br') return brotliAsync(body, { params: { [constants.BROTLI_PARAM_QUALITY]: 5 } });
  return gzipAsync(body);
}

// Paths

/** The path and the query of a request target. A `?` with nothing after it is no query. */
export function splitTarget(target: string): { path: string; query: string } {
  const mark = target.indexOf('?');
  if (mark < 0) return { path: target, query: '' };
  const query = target.slice(mark);
  return { path: target.slice(0, mark), query: query === '?' ? '' : query };
}

/** `decodeURIComponent`, or the text itself when it holds a bad escape. */
function decoded(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

/** `encodeURIComponent`, or the text itself when it holds a lone surrogate. */
function encoded(text: string): string {
  try {
    return encodeURIComponent(text);
  } catch {
    return text;
  }
}

/**
 * The traversal guard of row M6: says whether a raw request path may be served. It must start with `/`. No
 * segment may decode to `.` or `..`, also not between decoded `/`, and none may hold NUL or `\`.
 */
export function passesGuard(path: string): boolean {
  if (!path.startsWith('/')) return false;
  for (const raw of path.split('/')) {
    const text = decoded(raw);
    if (text.includes('\0') || text.includes('\\')) return false;
    if (text.split('/').some((piece) => piece === '.' || piece === '..')) return false;
  }
  return true;
}

/** The decoded path of a URL path, as the asset worker reads it: each segment decoded, each run of `/` made one. */
export function decodePath(path: string): string {
  return path.split('/').map(decoded).join('/').replace(/\/+/g, '/');
}

/** The URL path of a decoded path: each segment encoded with `encodeURIComponent`, as the platform writes it. */
export function encodePath(path: string): string {
  return path.split('/').map(encoded).join('/');
}

/**
 * A pattern of `_headers` or `_redirects` as Cloudflare stores it: the pathname of
 * `new URL('//' + pattern, 'relative://')`. That encodes a space and a non-ASCII character, drops `?query` and
 * `#hash`, and resolves `.` and `..`. A pattern that the URL parser refuses gives `undefined`.
 */
export function normalizePattern(pattern: string): string | undefined {
  try {
    return new URL(`//${pattern}`, 'relative://').pathname;
  } catch {
    return undefined;
  }
}

// Patterns

/** One part of a pattern: a character, `*` (any text, captured as `splat`), or `:name` (characters other than `/`). */
export type Part = { kind: 'char'; char: string } | { kind: 'any'; name: string } | { kind: 'param'; name: string };

const PLACEHOLDER = /:[A-Za-z]\w*/g;

/** Says whether the parts from `at` are the characters of `text`. */
function charsAt(parts: readonly Part[], at: number, text: string): boolean {
  for (let index = 0; index < text.length; index += 1) {
    const part = parts[at + index];
    if (part?.kind !== 'char' || part.char !== text[index]) return false;
  }
  return true;
}

/**
 * The parts of a relative pattern, as the asset worker builds its regular expression: `*` is `(?<splat>.*)`, and
 * then each placeholder text `:name`, in the order of the pattern, stands for `(?<name>[^/]+)` wherever it occurs.
 * A pattern that does not start with `/` (an absolute pattern), or one that names a group twice (two `*`, `*` and
 * `:splat`, a placeholder twice, or `:a` inside a later `:ab`), gives `undefined`: Cloudflare skips it.
 */
export function patternParts(pattern: string): Part[] | undefined {
  if (!pattern.startsWith('/')) return undefined;
  let parts: Part[] = pattern
    .split('')
    .map((char): Part => (char === '*' ? { kind: 'any', name: 'splat' } : { kind: 'char', char }));
  for (const [text] of pattern.matchAll(PLACEHOLDER)) {
    const next: Part[] = [];
    for (let at = 0; at < parts.length; ) {
      if (charsAt(parts, at, text)) {
        next.push({ kind: 'param', name: text.slice(1) });
        at += text.length;
        continue;
      }
      const part = parts[at];
      if (part !== undefined) next.push(part);
      at += 1;
    }
    parts = next;
  }
  const names = parts.flatMap((part) => (part.kind === 'char' ? [] : [part.name]));
  return new Set(names).size === names.length ? parts : undefined;
}

/**
 * Matches the parts against the whole path, as the regular expression of the asset worker does, and gives the text
 * of each group by name, in the order of the pattern, or `undefined` when the path does not match.
 *
 * It fills a table from the end of the path: `ok[at][i]` says that the path from `at` matches the parts from `i`,
 * and `inside[at][i]` says the same inside the placeholder of part `i`, after at least one character. Then it walks
 * forward and takes for each group as many characters as still let the rest match, which is the greedy choice of
 * the regular expression. The time and the table are the length of the path times the number of parts. Nothing
 * backtracks.
 */
export function matchParts(parts: readonly Part[], path: string): Map<string, string> | undefined {
  const size = path.length;
  const width = parts.length + 1;
  const ok = new Uint8Array((size + 1) * width);
  const inside = new Uint8Array((size + 1) * width);
  const okAt = (from: number, index: number): boolean => ok[from * width + index] === 1;
  const insideAt = (from: number, index: number): boolean => inside[from * width + index] === 1;
  for (let at = size; at >= 0; at -= 1) {
    const char = path[at];
    const more = char !== undefined && char !== '/';
    ok[at * width + parts.length] = at === size ? 1 : 0;
    for (let index = parts.length - 1; index >= 0; index -= 1) {
      const part = parts[index];
      let value = false;
      if (part?.kind === 'char') value = char === part.char && okAt(at + 1, index + 1);
      else if (part?.kind === 'any') value = (char !== undefined && okAt(at + 1, index)) || okAt(at, index + 1);
      else if (part?.kind === 'param') {
        inside[at * width + index] = (more && insideAt(at + 1, index)) || okAt(at, index + 1) ? 1 : 0;
        value = more && insideAt(at + 1, index);
      }
      ok[at * width + index] = value ? 1 : 0;
    }
  }
  if (!okAt(0, 0)) return undefined;
  const groups = new Map<string, string>();
  let at = 0;
  for (const [index, part] of parts.entries()) {
    if (part.kind === 'char') {
      at += 1;
      continue;
    }
    const start = at;
    if (part.kind === 'any') {
      while (at < size && okAt(at + 1, index)) at += 1;
    } else {
      at += 1;
      while (at < size && path[at] !== '/' && insideAt(at + 1, index)) at += 1;
    }
    groups.set(part.name, path.slice(start, at));
  }
  return groups;
}

/** Says whether a pattern applies to a path. A pattern that Cloudflare skips never applies. */
export function patternMatches(pattern: string, path: string): boolean {
  const parts = patternParts(pattern);
  return parts !== undefined && matchParts(parts, path) !== undefined;
}

/** Replaces each `:name` of the groups in a text, in the order of the groups, as the asset worker does. */
export function replaced(text: string, groups: ReadonlyMap<string, string>): string {
  let result = text;
  for (const [name, value] of groups) result = result.replaceAll(`:${name}`, value);
  return result;
}

/** An absolute pattern of Cloudflare: `https://` and a host. `port` says whether the host names a port. */
function absoluteOf(token: string): { port: boolean } | undefined {
  if (!token.startsWith('https://')) return undefined;
  let start = 'https://'.length;
  while (token[start] === '/') start += 1;
  const end = token.indexOf('/', start);
  const host = token.slice(start, end < 0 ? token.length : end);
  if (host === '') return undefined;
  const colon = host.lastIndexOf(':');
  return { port: colon >= 0 && colon < host.length - 1 && /^\d+$/.test(host.slice(colon + 1)) };
}

// `_headers`

/** One rule of `_headers` as the server applies it. */
export interface HeaderPlan {
  parts: Part[];
  /** The names to remove, in lower case. */
  unset: string[];
  /** The names to set, in lower case, with their values. Two lines for one name are joined with a comma. */
  set: [name: string, value: string][];
}

/** Says whether Node can send a header line. A line that it cannot send is skipped. */
function sendable(name: string, value: string): boolean {
  try {
    validateHeaderName(name);
    validateHeaderValue(name, value);
    return true;
  } catch {
    return false;
  }
}

/**
 * The rules of a `_headers` text as Workers static assets keep them, read with the one parser of the kit:
 * - lines of more than 2,000 characters are dropped, and at most 100 rules with a valid pattern and a line are kept;
 * - each pattern is stored in its URL form (`normalizePattern`); an absolute pattern is skipped (row M6), and so is
 *   a pattern that Cloudflare skips (`patternParts`);
 * - a second rule for a stored pattern replaces the first, in the place of the first;
 * - a line that names a framing header, or that Node cannot send, is skipped.
 */
export function headerRules(text: string): HeaderPlan[] {
  const short = text
    .split('\n')
    .map((line) => (line.length > HEADER_LINE_LIMIT ? '' : line))
    .join('\n');
  const kept = parseHeaders(short)
    .filter((rule) => rule.headers.length > 0)
    .flatMap((rule): { rule: HeaderRule; stored: string | undefined }[] => {
      const absolute = absoluteOf(rule.pattern);
      if (absolute !== undefined) return absolute.port ? [] : [{ rule, stored: undefined }];
      const stored = rule.pattern.startsWith('/') ? normalizePattern(rule.pattern) : undefined;
      if (stored === undefined) return [];
      const stars = stored.split('*').length - 1;
      if (stars > 1 || (stars === 1 && /:splat(?!\w)/.test(stored))) return [];
      return [{ rule, stored }];
    })
    .slice(0, HEADER_RULE_LIMIT);
  const byPattern = new Map<string, HeaderPlan>();
  for (const { rule, stored } of kept) {
    if (stored === undefined) continue;
    const plan: HeaderPlan = { parts: [], unset: [], set: [] };
    const values = new Map<string, string>();
    for (const line of rule.headers) {
      const name = line.name.toLowerCase();
      if (FRAMING.has(name)) continue;
      if (line.detach) {
        if (sendable(name, 'x')) plan.unset.push(name);
        continue;
      }
      if (!sendable(name, line.value)) continue;
      const before = values.get(name);
      values.set(name, before === undefined ? line.value : `${before}, ${line.value}`);
    }
    plan.set = [...values];
    const parts = patternParts(stored);
    if (parts === undefined) {
      byPattern.delete(stored);
      continue;
    }
    plan.parts = parts;
    byPattern.set(stored, plan);
  }
  return [...byPattern.values()];
}

/** The headers of an answer, by lower-case name, in the order they were first set. */
export type AnswerHeaders = Map<string, string>;

/**
 * Applies the matching rules to the headers of an answer, in file order, as Workers static assets do. A rule first
 * removes each `! Name`, whatever set it, also the default `cache-control`. Then it sets its lines, with `:splat`
 * and `:name` replaced: the first rule that sets a name replaces the value of the answer, and a later rule adds its
 * value after a comma.
 */
export function applyHeaderRules(rules: readonly HeaderPlan[], path: string, headers: AnswerHeaders): void {
  const set = new Set<string>();
  for (const rule of rules) {
    const groups = matchParts(rule.parts, path);
    if (groups === undefined) continue;
    for (const name of rule.unset) headers.delete(name);
    for (const [name, raw] of rule.set) {
      const value = replaced(raw, groups);
      const before = headers.get(name);
      headers.set(name, set.has(name) && before !== undefined ? `${before}, ${value}` : value);
      set.add(name);
    }
  }
}

// `_redirects`

/** One rule of `_redirects`. */
export interface RedirectRule {
  status: number;
  /** The target in its stored form: a path with its query and fragment, or an `https://` URL. */
  to: string;
}

/** The rules of `_redirects` as the asset worker keeps them. */
export interface Redirects {
  /** The static rules, by their stored `from`. */
  statics: Map<string, RedirectRule>;
  /** The dynamic rules, in file order. */
  dynamics: (RedirectRule & { parts: Part[] })[];
}

/** A line without the comment that follows white space: `/a /b # note` gives `/a /b`. */
function withoutComment(line: string): string {
  for (let at = 1; at < line.length; at += 1) {
    if (line[at] !== '#' || !/\s/.test(line[at - 1] ?? '')) continue;
    let start = at - 1;
    while (start > 0 && /\s/.test(line[start - 1] ?? '')) start -= 1;
    return line.slice(0, start);
  }
  return line;
}

/** The stored form of a `to`: an `https://` URL keeps its host, and a path keeps its query and fragment. */
function storedTarget(to: string): string | undefined {
  if (absoluteOf(to) !== undefined) {
    let start = 'https://'.length;
    while (to[start] === '/') start += 1;
    const end = to.indexOf('/', start);
    const host = to.slice(start, end < 0 ? to.length : end);
    // As the parser reads `https://host/path`: one `/` after the host, then the path, which gets a `/` in front.
    const rest = end < 0 ? '' : to.slice(end + 1);
    const url = urlOf(`//${rest.startsWith('/') ? rest : `/${rest}`}`, 'relative://');
    return url === undefined ? undefined : `https://${host}${url.pathname}${url.search}${url.hash}`;
  }
  if (!to.startsWith('/')) return undefined;
  const url = urlOf(`//${to}`, 'relative://');
  return url === undefined ? undefined : `${url.pathname}${url.search}${url.hash}`;
}

function urlOf(text: string, base?: string): URL | undefined {
  try {
    return new URL(text, base);
  } catch {
    return undefined;
  }
}

const INDEX_TARGET = /\/index(.html)?$/;

/**
 * The rules of a `_redirects` text as the parser of workers-shared keeps them. A line is `from to [status]`; a
 * `from` is relative and is stored in its URL form; the default status is 302. Static rules come before the first
 * dynamic rule (`*` or `:name`); a static rule after it is dynamic. At most 2,000 static and 100 dynamic rules. A
 * rule that would loop through the html handling, a second rule for a stored `from`, and a 200 rule to another host
 * are skipped.
 */
export function redirectRules(text: string): Redirects {
  const statics = new Map<string, RedirectRule>();
  const dynamics: Redirects['dynamics'] = [];
  const seen = new Set<string>();
  let staticCount = 0;
  let dynamicCount = 0;
  let canStatic = true;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#') || line.length > HEADER_LINE_LIMIT) continue;
    const tokens = withoutComment(line).split(/\s+/);
    if (tokens.length < 2 || tokens.length > 3) continue;
    const [rawFrom = '', rawTo = '', rawStatus = '302'] = tokens;
    if (absoluteOf(rawFrom) !== undefined) continue;
    const from = normalizePattern(rawFrom.startsWith('/') ? rawFrom : `/${rawFrom}`);
    if (from === undefined) continue;
    const dynamic = !canStatic || from.includes('*') || /:[A-Za-z]/.test(from);
    if (dynamic) {
      dynamicCount += 1;
      canStatic = false;
      if (dynamicCount > DYNAMIC_REDIRECT_LIMIT) break;
    } else {
      staticCount += 1;
      if (staticCount > STATIC_REDIRECT_LIMIT) continue;
    }
    const to = storedTarget(rawTo);
    const status = Number(rawStatus);
    if (to === undefined || !REDIRECT_STATUSES.has(status)) continue;
    const relative = absoluteOf(to) === undefined;
    const loops = INDEX_TARGET.test(to) && (from.endsWith('/*') || from.endsWith('/'));
    if ((relative && loops) || seen.has(from) || (status === 200 && !relative)) continue;
    seen.add(from);
    if (!dynamic) {
      statics.set(from, { status, to });
      continue;
    }
    const parts = patternParts(from);
    if (parts !== undefined) dynamics.push({ status, to, parts });
  }
  return { statics, dynamics };
}

/** The target of a dynamic rule: the groups replaced, and in a path each run of `/` or `\` made one `/`. */
function dynamicTarget(to: string, groups: ReadonlyMap<string, string>): string {
  const external = /^(?:\w+:\/\/|\/\/[^/\\\s?#])/.test(to.trim());
  const target = replaced(to, groups).trim();
  if (external) return target;
  const cut = target.search(/[?#]/);
  const path = cut < 0 ? target : target.slice(0, cut);
  return path.replace(/[/\\]+/g, '/') + (cut < 0 ? '' : target.slice(cut));
}

// The folder

/** The client directory of a build: `dist/client` with an adapter (13.1 item 16), else `dist`. */
export async function clientDir(dist: string): Promise<string> {
  const client = join(dist, 'client');
  const [index, folder] = await Promise.all([statOf(join(dist, 'index.html')), statOf(client)]);
  return folder?.isDirectory() === true && index?.isFile() !== true ? client : dist;
}

async function statOf(file: string): Promise<Stats | undefined> {
  try {
    return await stat(file);
  } catch {
    return undefined;
  }
}

// Answers

/** A file of the site. */
interface Asset {
  /** The path under the root, as the request names it. Its extension gives the content type. */
  name: string;
  /** The real path of the file. */
  file: string;
  size: number;
  /** The etag: as in `wrangler dev`, a hash of the path and the modification time. */
  etag: string;
}

/** What the html handling decides for a path: a file with a status, or a redirect to a decoded path. */
interface Intent {
  asset?: { asset: Asset; status: 200 | 404 };
  redirect?: string;
}

/** What the server sends for one request, before the headers of the options and of `_headers`. */
interface Answer {
  status: number;
  headers: AnswerHeaders;
  /** The file to send. */
  file?: string;
  /** The size of the file. */
  size?: number;
  /** A body that is no file. */
  body?: Buffer;
}

const DRIVE_SEP = sep === '\\';

const emptyAnswer = (status: number, headers: [string, string][] = []): Answer => ({
  status,
  headers: new Map(headers),
  body: Buffer.alloc(0),
});

class Site {
  readonly root: string;
  readonly origin: string;
  readonly headerRules: HeaderPlan[];
  readonly redirects: Redirects;
  readonly ignores: IgnoreRule[];

  constructor(root: string, origin: string, headers: HeaderPlan[], redirects: Redirects, ignores: IgnoreRule[]) {
    this.root = root;
    this.origin = origin;
    this.headerRules = headers;
    this.redirects = redirects;
    this.ignores = ignores;
  }

  /**
   * The file of a decoded path (`/a/b.css`), or `undefined` when no such file exists. A segment that is empty, `.`
   * or `..`, or that holds NUL or `\` (on Windows also `:`), names no file. Nor does a file that `.assetsignore`
   * hides, or one whose real path leaves the root through a symbolic link.
   */
  async exists(path: string): Promise<Asset | undefined> {
    if (!path.startsWith('/')) return undefined;
    const segments = path.slice(1).split('/');
    for (const segment of segments) {
      if (segment === '' || segment === '.' || segment === '..') return undefined;
      if (segment.includes('\0') || segment.includes('\\') || (DRIVE_SEP && segment.includes(':'))) return undefined;
    }
    if (isIgnored(this.ignores, segments)) return undefined;
    const name = join(this.root, ...segments);
    if (!name.startsWith(this.root + sep)) return undefined;
    let file: string;
    try {
      file = await realpath(name);
    } catch {
      return undefined;
    }
    if (!file.startsWith(this.root + sep)) return undefined;
    const info = await statOf(file);
    if (info?.isFile() !== true) return undefined;
    const etag = createHash('sha256').update(`${name}\0${info.mtimeMs}`).digest('hex').slice(0, 32);
    return { name, file, size: info.size, etag };
  }

  /** The html handling of `auto-trailing-slash` for a decoded path. `skip` turns the redirects off. */
  async intentOf(path: string, skip: boolean): Promise<Intent | undefined> {
    const ok = (asset: Asset): Intent => ({ asset: { asset, status: 200 } });
    const exact = await this.exists(path);
    let redirect: Intent | undefined;
    if (path.endsWith('/index')) {
      if (exact !== undefined) return ok(exact);
      redirect =
        (await this.safeRedirect(`${path}.html`, path.slice(0, -5), skip)) ??
        (await this.safeRedirect(`${path.slice(0, -6)}.html`, path.slice(0, -6), skip));
    } else if (path.endsWith('/index.html')) {
      redirect =
        (await this.safeRedirect(path, path.slice(0, -10), skip)) ??
        (await this.safeRedirect(`${path.slice(0, -11)}.html`, path.slice(0, -11), skip));
    } else if (path.endsWith('/')) {
      const index = await this.exists(`${path}index.html`);
      if (index !== undefined) return ok(index);
      redirect = await this.safeRedirect(`${path.slice(0, -1)}.html`, path.slice(0, -1), skip);
    } else if (path.endsWith('.html')) {
      redirect =
        (await this.safeRedirect(path, path.slice(0, -5), skip)) ??
        (await this.safeRedirect(`${path.slice(0, -5)}/index.html`, `${path.slice(0, -5)}/`, skip));
    }
    if (redirect !== undefined) return redirect;
    if (exact !== undefined) return ok(exact);
    const html = await this.exists(`${path}.html`);
    if (html !== undefined) return ok(html);
    return (await this.safeRedirect(`${path}/index.html`, `${path}/`, skip)) ?? this.notFound(path);
  }

  /** A redirect to `destination` when it is no file and its html handling gives the file `file`. */
  async safeRedirect(file: string, destination: string, skip: boolean): Promise<Intent | undefined> {
    if (skip || (await this.exists(destination)) !== undefined) return undefined;
    const target = (await this.intentOf(destination, true))?.asset;
    if (target === undefined) return undefined;
    const source = await this.exists(file);
    return source !== undefined && source.etag === target.asset.etag ? { redirect: destination } : undefined;
  }

  /** The nearest `404.html` up the folders of the path, with status 404. */
  async notFound(path: string): Promise<Intent | undefined> {
    let folder = path;
    while (folder !== '') {
      folder = folder.slice(0, folder.lastIndexOf('/'));
      const page = await this.exists(`${folder}/404.html`);
      if (page !== undefined) return { asset: { asset: page, status: 404 } };
    }
    return undefined;
  }

  /** The answer of `_redirects` for a URL, or the path to serve and whether a 200 rule gave it. */
  redirected(url: URL): Answer | { path: string; proxied: boolean } {
    let rule = this.redirects.statics.get(url.pathname);
    if (rule === undefined) {
      for (const dynamic of this.redirects.dynamics) {
        const groups = matchParts(dynamic.parts, url.pathname);
        if (groups === undefined) continue;
        rule = { status: dynamic.status, to: dynamicTarget(dynamic.to, groups) };
        break;
      }
    }
    if (rule === undefined) return { path: url.pathname, proxied: false };
    const destination = urlOf(rule.to, url.href);
    if (destination === undefined) return { path: url.pathname, proxied: false };
    if (rule.status === 200) return { path: destination.pathname, proxied: true };
    const search = destination.search === '' ? url.search : destination.search;
    const location =
      destination.origin === url.origin
        ? `${destination.pathname}${search}${destination.hash}`
        : `${destination.href.slice(0, destination.href.length - destination.search.length - destination.hash.length)}${search}${destination.hash}`;
    return emptyAnswer(rule.status, [['location', location]]);
  }

  /** The answer of a file: its etag, its type, its cache-control, and 304 for a matching `If-None-Match`. */
  fileAnswer(found: { asset: Asset; status: number }, request: IncomingHttpHeaders): Answer {
    const { asset, status } = found;
    const etag = `"${asset.etag}"`;
    const headers: AnswerHeaders = new Map([['etag', etag]]);
    const type = contentTypeOf(asset.name);
    if (type !== undefined) headers.set('content-type', type);
    if (request.authorization === undefined && request.range === undefined) headers.set('cache-control', FILE_CACHE);
    const match = request['if-none-match'];
    if (match === etag || match === `W/${etag}`) return { status: 304, headers };
    return { status, headers, file: asset.file, size: asset.size };
  }

  /** The answer to a request, and the path that the rules of `_headers` match. */
  async answer(method: string, target: string, request: IncomingHttpHeaders): Promise<[Answer, string]> {
    const read = method === 'GET' || method === 'HEAD';
    const path = splitTarget(target).path;
    const url = path.startsWith('/') ? urlOf(`${this.origin}${target}`) : undefined;
    if (url === undefined || !passesGuard(path)) {
      // The rules of `_headers` match the path as the URL parser gives it, as on Cloudflare.
      const matched = url?.pathname ?? '/';
      const page = await this.notFound('/');
      if (page?.asset === undefined) return [this.notFoundText(), matched];
      return [read ? this.fileAnswer(page.asset, request) : emptyAnswer(405, [['allow', ALLOW]]), matched];
    }
    const routed = this.redirected(url);
    if (!('path' in routed)) return [routed, url.pathname];
    const decodedPath = decodePath(routed.path);
    const intent = await this.intentOf(decodedPath, false);
    if (intent === undefined) return [this.notFoundText(), url.pathname];
    if (!read) return [emptyAnswer(405, [['allow', ALLOW]]), url.pathname];
    const canonical = encodePath(intent.redirect ?? decodedPath);
    if (intent.redirect !== undefined || (canonical !== routed.path && intent.asset !== undefined)) {
      return [emptyAnswer(307, [['location', canonical + url.search]]), url.pathname];
    }
    if (intent.asset === undefined) return [this.notFoundText(), url.pathname];
    return [this.fileAnswer(intent.asset, request), url.pathname];
  }

  notFoundText(): Answer {
    return {
      status: 404,
      headers: new Map([['content-type', 'text/plain; charset=utf-8']]),
      body: Buffer.from(NOT_FOUND_TEXT),
    };
  }
}

/** Finishes an answer: the headers of the options, the rules of `_headers`, the encoding and the length. */
async function send(
  site: Site,
  request: IncomingMessage,
  response: ServerResponse,
  answer: Answer,
  path: string,
  extra: Readonly<Record<string, string>>,
): Promise<void> {
  const headers = answer.headers;
  for (const [name, value] of Object.entries(extra)) headers.set(name.toLowerCase(), value);
  const type = headers.get('content-type');
  const hasBody = answer.status !== 304 && (answer.file !== undefined || (answer.body?.byteLength ?? 0) > 0);
  const compressible = hasBody && type !== undefined && isCompressible(type);
  let body = answer.body;
  let encoding: Encoding | undefined;
  if (compressible) {
    headers.set('vary', 'accept-encoding');
    encoding = (answer.size ?? 0) <= COMPRESS_LIMIT ? encodingOf(request.headers['accept-encoding']) : undefined;
    if (encoding !== undefined) {
      body = await compress(
        answer.file === undefined ? (body ?? Buffer.alloc(0)) : await readFile(answer.file),
        encoding,
      );
    }
  }
  applyHeaderRules(site.headerRules, path, headers);
  for (const name of FRAMING) headers.delete(name);
  if (encoding !== undefined) headers.set('content-encoding', encoding);
  if (answer.status !== 304) headers.set('content-length', String(body?.byteLength ?? answer.size ?? 0));
  response.writeHead(answer.status, Object.fromEntries(headers));
  if (request.method === 'HEAD' || answer.status === 304) {
    response.end();
    return;
  }
  if (body !== undefined || answer.file === undefined) {
    response.end(body);
    return;
  }
  await pipeline(createReadStream(answer.file), response);
}

/**
 * Serves a build on 127.0.0.1 and a free port: `dist/client` when it is the client directory, else `dist`
 * (`clientDir`). It reads `_headers`, `_redirects` and `.assetsignore` once, at the start. The caller closes the
 * server in a `finally`.
 */
export async function serveDist(dist: string, options: ServeOptions = {}): Promise<Served> {
  const folder = await clientDir(dist);
  const info = await statOf(folder);
  if (info?.isDirectory() !== true) throw new Error(`astro-kit: ${folder} is no folder, so there is nothing to serve`);
  const root = await realpath(folder);
  const text = async (name: string): Promise<string> => {
    const found = await statOf(join(root, name));
    return found?.isFile() === true ? readFile(join(root, name), 'utf8') : '';
  };
  const ignores = ignoreRules([...PLATFORM_IGNORES, ...(await text(IGNORE_FILE)).split('\n')]);
  const headers = headerRules(await text(HEADERS_FILE));
  const redirects = redirectRules(await text(REDIRECTS_OUT));
  const extra = options.headers ?? {};
  const received: Received[] = [];
  let site: Site | undefined;

  const observe = (seen: Received): void => {
    try {
      const result: unknown = options.onRequest?.(seen);
      if (result instanceof Promise) result.catch(() => undefined);
    } catch {
      // An observer never changes the answer.
    }
  };

  const handle = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const seen: Received = { method: request.method ?? 'GET', path: request.url ?? '/', headers: request.headers };
    received.push(seen);
    observe(seen);
    if (site === undefined) throw new Error('astro-kit: the server is not ready');
    const [answer, path] = await site.answer(seen.method, seen.path, request.headers);
    await send(site, request, response, answer, path, extra);
  };

  const server = createServer((request, response) => {
    handle(request, response).catch(() => {
      // A file that went away, a header that Node refuses, or a connection that the client closed. The server never
      // throws: it answers 500 when it can, else it ends the connection.
      if (response.headersSent) {
        response.destroy();
        return;
      }
      try {
        response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
        response.end(ERROR_TEXT);
      } catch {
        response.destroy();
      }
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, HOST, () => {
      server.off('error', reject);
      resolve();
    });
  });
  const { address, port } = server.address() as AddressInfo;
  const origin = `http://${HOST}:${port}`;
  site = new Site(root, origin, headers, redirects, ignores);
  return {
    origin,
    address,
    root,
    received,
    close: () =>
      new Promise<void>((done) => {
        server.closeAllConnections();
        server.close(() => done());
      }),
  };
}

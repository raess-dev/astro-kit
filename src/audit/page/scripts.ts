/**
 * The script and origin rules of the page audit (specification, section 8 and 9.4): `js-script`, `js-prefetch-attr`,
 * `js-directive` and `origins-third-party`. Each function is the built half of one rule and adds its findings at the
 * page path. Every page counts, `/404.html` included. Template content is no part of the page here: only `csp-hash`
 * and `csp-base` read it (section 8, Measurement details, "The parsed page").
 *
 * **Who reports what.**
 *
 * - The speculation block and every script that starts like the mode script are `speculation-block`'s and
 *   `modes-script`'s: they check count, text and place. `js-script` skips them. A JSON-LD block is allowed.
 * - The directive of an island is `js-directive`'s. So `js-script` allows the texts of all five built-in client
 *   directives of Astro, `load` and `only` included: a `client:load` island gives one id.
 * - The hash of an inline script is `csp-hash`'s: `js-script` decides only whether such a script may stand on the
 *   page at all.
 * - A third-party `src` on an `img` is `images-src`'s too (it is no `/_astro/` file): two facts, two ids.
 */
import type { HTMLElement } from 'node-html-parser';
import { type BuildContext, type BuiltPage, readText } from '../../context.ts';
import { asciiLower } from '../../css/parse.ts';
import { snippet } from '../../css/rules.ts';
import { islandScriptTexts, solidHydrationText } from '../../islands.ts';
import type { Options } from '../../options.ts';
import { PREFETCH_CHUNK } from '../budgets.ts';
import {
  attr,
  attributesOf,
  distFileOf,
  domOf,
  hasAttr,
  rawContentOf,
  resolveHref,
  scriptKind,
  siteOf,
  tagOf,
  tokensOf,
} from '../dom.ts';
import { srcsetCandidates } from './assets.ts';
import { isModeScriptLike, listed, nestedOf, noscriptElements, startTag } from './shell.ts';

// Shared

/** Adds one finding for a page when it has problems. */
function reportPage(ctx: BuildContext, id: string, page: BuiltPage, problems: readonly string[]): void {
  if (problems.length > 0) ctx.report.add(id, page.path, listed(problems));
}

/** The hosts of the declared origins that have a directive, with a `load` when one is given. */
function hostsWith(
  options: Pick<Options, 'origins'>,
  directive: Options['origins'][number]['directives'][number],
  load?: Options['origins'][number]['load'],
): ReadonlySet<string> {
  return new Set(
    options.origins
      .filter((origin) => origin.directives.includes(directive) && (load === undefined || origin.load === load))
      .map((origin) => origin.host),
  );
}

/**
 * The host of a URL when it is an `https` URL with no port and no user, else `undefined`. The URL parser strips
 * white space at both ends and removes tabs and line breaks, as a browser does.
 */
function httpsHost(url: string): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return undefined;
  }
  if (parsed.protocol !== 'https:' || parsed.port !== '' || parsed.username !== '' || parsed.password !== '') {
    return undefined;
  }
  return parsed.hostname;
}

// js-script

const JS_SCRIPT = 'js-script';

/** The folder of Astro's bundled assets: a `/_astro/` module script is a file under it. */
const ASSETS = '/_astro/';

/** Says whether a `script` element has one of the attributes that load it without blocking the parser. */
const loadsLate = (script: HTMLElement): boolean =>
  hasAttr(script, 'async') || hasAttr(script, 'defer') || scriptKind(script) === 'module';

/** What `js-script` allows for the settings. */
interface ScriptPolicy {
  /** `/_astro/` module scripts and inline module scripts: with scripts. */
  bundled: boolean;
  /** The prefetch chunk `/_astro/page.<hash>.js` as a module script: with astroPrefetch. */
  prefetch: boolean;
  /** Astro's island texts and Solid's hydration script: with islands. */
  islands: boolean;
  /** The hosts of the origins with `script` and `load: "page"`. */
  pageHosts: ReadonlySet<string>;
}

function scriptPolicy(options: Options): ScriptPolicy {
  const { features, prefetch } = options;
  return {
    bundled: features.scripts,
    prefetch: prefetch.astroPrefetch,
    islands: features.islands,
    pageHosts: hostsWith(options, 'script', 'page'),
  };
}

/** The inline texts that islands allow: Astro's island texts, and Solid's hydration script. */
interface IslandTexts {
  astro: ReadonlySet<string>;
  solid: string | undefined;
}

/** The island texts of the project, read once for each context, and only when a page needs them. */
const ISLAND_TEXTS = new WeakMap<BuildContext, IslandTexts>();

function islandTexts(ctx: BuildContext): IslandTexts {
  let texts = ISLAND_TEXTS.get(ctx);
  if (texts === undefined) {
    texts = { astro: islandScriptTexts(ctx.root), solid: solidHydrationText(ctx.root) };
    ISLAND_TEXTS.set(ctx, texts);
  }
  return texts;
}

/**
 * Says whether a script with `src` is allowed (section 8).
 *
 * - A script of a page origin: its `src` is an `https` URL with no port and no user, whose host in ASCII lower case
 *   is a host with `script` and `load: "page"`, and it has `async`, `defer` or `type="module"` (9.4). The URL is
 *   compared as the browser parses it (`httpsHost`), as `origins-third-party` compares it.
 * - A `/_astro/` module script: a `script[type=module]` whose `src` resolves to a same-origin path under `/_astro/`,
 *   not over `http:`, that names a file of the client directory. The path is the one that the browser asks for
 *   (`resolveHref`), so `/_astro/%2e%2e/x.js` is `/x.js`. With scripts, any such file passes. With astroPrefetch, the
 *   prefetch chunk (`PREFETCH_CHUNK`) passes.
 */
function allowedSource(
  ctx: BuildContext,
  policy: ScriptPolicy,
  page: BuiltPage,
  script: HTMLElement,
  src: string,
): boolean {
  const host = httpsHost(src);
  if (host !== undefined && policy.pageHosts.has(host) && loadsLate(script)) return true;
  if (scriptKind(script) !== 'module' || !(policy.bundled || policy.prefetch)) return false;
  const file = distFileOf(ctx, src, page.path);
  if (file === undefined) return false;
  const path = `/${file}`;
  if (!path.startsWith(ASSETS) || path.length === ASSETS.length) return false;
  return policy.bundled || PREFETCH_CHUNK.test(path);
}

/**
 * Says whether an inline script is allowed: a module script with scripts; with islands, a classic script whose text
 * is one of Astro's island texts (`islandScriptTexts`) or exactly Solid's hydration script (`solidHydrationText`).
 */
function allowedInline(ctx: BuildContext, policy: ScriptPolicy, script: HTMLElement): boolean {
  const kind = scriptKind(script);
  if (kind === 'module') return policy.bundled;
  if (kind !== 'classic' || !policy.islands) return false;
  const text = rawContentOf(script);
  const texts = islandTexts(ctx);
  return texts.astro.has(text) || text === texts.solid;
}

/** Why an inline script of an islands site may fail: the texts that the kit could not read. */
function unreadTexts(ctx: BuildContext): string {
  const texts = islandTexts(ctx);
  const missing = [
    ...(texts.astro.size === 0 ? ["the island scripts of the project's astro"] : []),
    ...(texts.solid === undefined ? ["the hydration script of the project's solid-js"] : []),
  ];
  return missing.length === 0 ? '' : ` (${missing.join(' and ')} could not be read)`;
}

/**
 * `js-script`: pages ship no script except JSON-LD, the kit speculation block and the kit mode script, and what the
 * settings allow (section 8): with scripts, `/_astro/` module scripts and inline module scripts; with astroPrefetch,
 * the prefetch chunk; with islands, Astro's exact island runtime and client directive texts (`islandScriptTexts`)
 * and Solid's exact hydration script (`solidHydrationText`); with an origin that has `script` and `load: "page"`, a
 * script of that host with `async`, `defer` or `type="module"`. Every other `script` element is a problem: a classic
 * or module script, an import map and a data block. One finding for each page, which lists its scripts.
 *
 * With `features.workers` off, each start of a worker (`workerStarts`) is a finding too, whatever its argument: one for
 * each JavaScript file of the client directory (`JS_FILE`) at its path, and one for each page whose inline scripts hold
 * one (9.5).
 */
export function auditJsScript(ctx: BuildContext): void {
  const policy = scriptPolicy(ctx.options);
  const workers = ctx.options.features.workers;
  for (const page of ctx.pages) {
    const problems: string[] = [];
    const starts: string[] = [];
    for (const script of domOf(page).byTag('script')) {
      const kind = scriptKind(script);
      const src = attr(script, 'src');
      if (!workers && src === undefined && (kind === 'classic' || kind === 'module')) {
        starts.push(...workerStarts(rawContentOf(script)));
      }
      if (kind === 'json-ld' || kind === 'speculationrules') continue;
      if (src === undefined && isModeScriptLike(script)) continue;
      const allowed =
        src === undefined ? allowedInline(ctx, policy, script) : allowedSource(ctx, policy, page, script, src);
      if (allowed) continue;
      const missing = src === undefined && kind === 'classic' && policy.islands ? unreadTexts(ctx) : '';
      const text = src === undefined ? `: ${snippet(rawContentOf(script))}` : '';
      problems.push(`${startTag(page, script)}${text}${missing}`);
    }
    reportPage(ctx, JS_SCRIPT, page, problems);
    if (starts.length > 0) ctx.report.add(JS_SCRIPT, page.path, workerDetail('an inline script', starts));
  }
  if (workers) return;
  for (const file of ctx.files) {
    if (!JS_FILE.test(file)) continue;
    const starts = workerStarts(readText(ctx, file) ?? '');
    if (starts.length > 0) ctx.report.add(JS_SCRIPT, `/${file}`, workerDetail('the script', starts));
  }
}

// js-script: workers

/**
 * A file that the host serves as JavaScript, by its extension in any ASCII case: `.js`, `.mjs` and `.cjs`. A module
 * script and a worker script need a JavaScript MIME type, and the asset worker takes the type from the extension.
 */
const JS_FILE = /\.[mc]?js$/i;

/**
 * The forms of a start of a worker that `js-script` reads when `features.workers` is off (section 8 and 9.5),
 * whatever its argument:
 *
 * - `new` before `Worker` or `SharedWorker`, also reached through members (`new globalThis.Worker`,
 *   `new self["SharedWorker"]`, `new (window.Worker)`). A member named `Worker` without `new` is no start.
 * - `serviceWorker` (or `["serviceWorker"]`) then a member `register`: `navigator.serviceWorker.register`, also not
 *   called.
 * - The name `importScripts`, anywhere: it exists only in a worker.
 *
 * White space and comments may stand between the tokens. The text is read as it is, so a match inside a string or a
 * comment counts too. A `new` is the word that no letter, digit, `_`, `$` or `.` comes before; `serviceWorker` and
 * `importScripts` are words that no letter, digit, `_` or `$` comes before.
 *
 * The scanner reads each text in linear time (Codex, #31): two tables give, for each position, the next line
 * terminator and the next `*` + `/`, so a comment is skipped in one step, and the end of each gap is kept, so no gap is
 * read twice. A regex reads a gap again from each candidate inside it, which was quadratic on a run of comments or
 * on one long comment.
 */
class WorkerScanner {
  private readonly text: string;
  private readonly length: number;
  /** For each position, the first line terminator at or after it (`\n`, `\r`, U+2028, U+2029), else the length. */
  private readonly lineEnd: Int32Array;
  /** For each position, the first `*` that a `/` follows, at or after it, else -1. */
  private readonly blockEnd: Int32Array;
  /** For each position that a gap read, where that gap ends; -1 where no gap was read yet. */
  private readonly gapEnd: Int32Array;
  /**
   * The results of the steps after a gap, by the position where the step starts. Each step depends on its start
   * only, so many candidates that reach one position read what follows once (Codex, #31).
   */
  private readonly members = new Map<number, Step | undefined>();
  private readonly tails = new Map<number, Step | undefined>();
  private readonly computeds = new Map<number, Step | undefined>();
  private readonly literals = new Map<number, { value: string; end: number } | undefined>();

  constructor(text: string) {
    this.text = text;
    this.length = text.length;
    this.lineEnd = new Int32Array(this.length + 1);
    this.blockEnd = new Int32Array(this.length + 1);
    this.gapEnd = new Int32Array(this.length + 1).fill(-1);
    let line = this.length;
    let block = -1;
    this.lineEnd[this.length] = line;
    this.blockEnd[this.length] = block;
    for (let index = this.length - 1; index >= 0; index -= 1) {
      const code = text.charCodeAt(index);
      if (code === 0x0a || code === 0x0d || code === 0x2028 || code === 0x2029) line = index;
      if (code === 0x2a && text.charCodeAt(index + 1) === 0x2f) block = index;
      this.lineEnd[index] = line;
      this.blockEnd[index] = block;
    }
  }

  /** Where the white space and comments at `start` end: a line comment ends after its line terminator. */
  gap(start: number): number {
    const visited: number[] = [];
    let index = start;
    while (index < this.length) {
      const known = this.gapEnd[index] ?? -1;
      if (known >= 0) {
        index = known;
        break;
      }
      visited.push(index);
      const char = this.text[index] ?? '';
      if (WHITE_SPACE.test(char)) {
        index += 1;
      } else if (char === '/' && this.text[index + 1] === '*') {
        const close = this.blockEnd[index + 2] ?? -1;
        if (close < 0) break;
        index = close + 2;
      } else if (char === '/' && this.text[index + 1] === '/') {
        index = Math.min(this.length, (this.lineEnd[index + 2] ?? this.length) + 1);
      } else {
        break;
      }
    }
    for (const position of visited) this.gapEnd[position] = index;
    return index;
  }

  /** The end of the name at `start`, or `start` when none stands there. */
  private nameEnd(start: number): number {
    let index = start;
    while (index < this.length && NAME_CHAR.test(this.text[index] ?? '')) index += 1;
    return index;
  }

  /** Whether `word` stands at `start` as a whole name: no name character follows it. */
  private wordAt(start: number, word: string): boolean {
    return this.text.startsWith(word, start) && !NAME_CHAR.test(this.text[start + word.length] ?? '');
  }

  /** The string literal at `start` (`"…"`, `'…'` or a template with no `${`, no escape): its text and end. */
  private literal(start: number): { value: string; end: number } | undefined {
    if (!this.literals.has(start)) this.literals.set(start, this.literalAt(start));
    return this.literals.get(start);
  }

  /**
   * The string literal at `start`, read once: it ends at the next quote of its own kind, so each character is read
   * at most once for each of the three kinds of quote.
   */
  private literalAt(start: number): { value: string; end: number } | undefined {
    const quote = this.text[start];
    if (quote !== '"' && quote !== "'" && quote !== '`') return undefined;
    for (let index = start + 1; index < this.length; index += 1) {
      const char = this.text[index];
      if (char === quote) return { value: this.text.slice(start + 1, index), end: index + 1 };
      if (char === '\\' || (quote === '`' ? char === '$' : char === '\n')) return undefined;
    }
    return undefined;
  }

  /**
   * One member step at `start`: `.name` or `?.name` (gaps around the dot), or `[literal]` or `?.[literal]` (gaps
   * inside). Its name and its end, or undefined when no step stands there. A template literal must close.
   */
  member(start: number): Step | undefined {
    const index = this.gap(start);
    if (!this.members.has(index)) this.members.set(index, this.memberAt(index));
    return this.members.get(index);
  }

  /** The member step at `start`, after its gap. */
  private memberAt(start: number): Step | undefined {
    let index = start;
    if (this.text[index] === '?' && this.text[index + 1] === '.') {
      const after = this.gap(index + 2);
      if (this.text[after] === '[') return this.computed(after);
      const end = this.nameEnd(after);
      return end > after ? { name: this.text.slice(after, end), end } : undefined;
    }
    if (this.text[index] === '.') {
      index = this.gap(index + 1);
      const end = this.nameEnd(index);
      return end > index ? { name: this.text.slice(index, end), end } : undefined;
    }
    return this.text[index] === '[' ? this.computed(index) : undefined;
  }

  /** A computed member `[literal]` at `start`, with gaps inside. */
  computed(start: number): Step | undefined {
    if (!this.computeds.has(start)) this.computeds.set(start, this.computedAt(start));
    return this.computeds.get(start);
  }

  /** The computed member at `start`, read once. */
  private computedAt(start: number): Step | undefined {
    const value = this.literal(this.gap(start + 1));
    if (value === undefined) return undefined;
    const close = this.gap(value.end);
    return this.text[close] === ']' ? { name: value.value, end: close + 1 } : undefined;
  }

  /** A start of a worker with `new` at `start`: its name and end. */
  private newAt(start: number): Step | undefined {
    const index = this.gap(start + 3);
    if (!this.tails.has(index)) this.tails.set(index, this.tailAt(index));
    return this.tails.get(index);
  }

  /** What follows `new` and its gap at `start`: parentheses, then a worker name or a name and its members. */
  private tailAt(start: number): Step | undefined {
    let index = start;
    while (this.text[index] === '(') index = this.gap(index + 1);
    for (const name of WORKER_NAMES) {
      if (this.wordAt(index, name)) return { name: `new ${name}`, end: index + name.length };
    }
    let end = this.nameEnd(index);
    if (end === index) return undefined;
    for (let step = this.member(end); step !== undefined; step = this.member(end)) {
      end = step.end;
      if ((WORKER_NAMES as readonly string[]).includes(step.name)) return { name: `new ${step.name}`, end };
    }
    return undefined;
  }

  /** A start of a worker through `serviceWorker` at `start`, as a name or a computed member, then `register`. */
  private serviceWorkerAt(start: number): number | undefined {
    let end: number | undefined;
    if (this.text[start] === '[') {
      const step = this.computed(start);
      if (step?.name === 'serviceWorker') end = step.end;
    } else if (this.wordAt(start, 'serviceWorker') && !NAME_CHAR.test(this.text[start - 1] ?? '')) {
      end = start + 'serviceWorker'.length;
    }
    if (end === undefined) return undefined;
    const step = this.member(end);
    return step?.name === 'register' ? step.end : undefined;
  }

  /** Each start of a worker, in the order of the text; the search goes on after the end of each start. */
  starts(): string[] {
    const found: string[] = [];
    let index = 0;
    while (index < this.length) {
      const char = this.text[index];
      const before = this.text[index - 1] ?? '';
      if (char === 'n' && this.wordAt(index, 'new') && !NAME_CHAR.test(before) && before !== '.') {
        const start = this.newAt(index);
        if (start !== undefined) {
          found.push(start.name);
          index = start.end;
          continue;
        }
      }
      if (char === 's' || char === '[') {
        const end = this.serviceWorkerAt(index);
        if (end !== undefined) {
          found.push('serviceWorker.register');
          index = end;
          continue;
        }
      }
      if (char === 'i' && this.wordAt(index, 'importScripts') && !NAME_CHAR.test(before)) {
        found.push('importScripts');
        index += 'importScripts'.length;
        continue;
      }
      index += 1;
    }
    return found;
  }
}

/** A name that the scanner read, and the end of its text. */
interface Step {
  name: string;
  end: number;
}

/** One character of white space as JavaScript reads it (`\s`). */
const WHITE_SPACE = /^\s$/;

/** One character of a name: a letter, a digit, `_` or `$`, as `[\w$]`. */
const NAME_CHAR = /^[\w$]$/;

const WORKER_NAMES = ['Worker', 'SharedWorker'] as const;

/** The names of the starts of a worker in a JS text (`WorkerScanner`), in the order of the text. */
export function workerStarts(text: string): string[] {
  return new WorkerScanner(text).starts();
}

/** The detail of a finding for the starts of a worker: each name once, in the order of the text. */
const workerDetail = (what: string, starts: readonly string[]): string =>
  `${what} starts a worker (${[...new Set(starts)].join(', ')}), but features.workers is off (9.5)`;

// js-prefetch-attr

/** `js-prefetch-attr`: no element carries `data-astro-prefetch`. One finding for each page, listing the elements. */
export function auditJsPrefetchAttr(ctx: BuildContext): void {
  for (const page of ctx.pages) {
    const problems = domOf(page)
      .elements.filter((element) => hasAttr(element, 'data-astro-prefetch'))
      .map((element) => startTag(page, element));
    reportPage(ctx, 'js-prefetch-attr', page, problems);
  }
}

// js-directive

/** The client directives that an island may use (9.2). */
export const ISLAND_DIRECTIVES: ReadonlySet<string> = new Set(['visible', 'idle', 'media']);

/**
 * `js-directive`, built half: every `astro-island` element hydrates with `client:visible`, `client:idle` or
 * `client:media`. Astro writes the directive into its `client` attribute (`client="visible"`). An island without it,
 * or with another value (`load`, `only`, a directive of an integration), is a problem. The value compares exactly,
 * as Astro reads it. One finding for each page, listing the islands.
 */
export function auditJsDirective(ctx: BuildContext): void {
  for (const page of ctx.pages) {
    const problems: string[] = [];
    for (const island of domOf(page).byTag('astro-island')) {
      const client = attr(island, 'client');
      if (client !== undefined && ISLAND_DIRECTIVES.has(client)) continue;
      const what = client === undefined ? 'no client directive' : `client:${snippet(client)}`;
      problems.push(
        `${startTag(page, island)} hydrates with ${what}; only client:visible, client:idle or client:media`,
      );
    }
    reportPage(ctx, 'js-directive', page, problems);
  }
}

// origins-third-party

const ORIGINS_THIRD_PARTY = 'origins-third-party';

/**
 * The resource elements of `origins-third-party` (section 8). Each reads every attribute of `RESOURCE_ATTRIBUTES`. A
 * `link` counts unless every token of its `rel` is one that never fetches (`NON_FETCHING_RELS`).
 */
const RESOURCE_TAGS: ReadonlySet<string> = new Set([
  'img',
  'script',
  'link',
  'iframe',
  'source',
  'video',
  'audio',
  'track',
  'object',
  'embed',
  'form',
]);

/**
 * The `rel` tokens of a `link` that never make Chromium fetch its `href` (section 8, `origins-third-party`). A `link`
 * counts when one token of its `rel` is not in this set, so a `rel` that a browser may fetch, such as `prerender`, or a
 * new one, counts. A browser fetches `manifest`, `search` and `apple-touch-icon` when it needs them, so they count.
 */
export const NON_FETCHING_RELS: ReadonlySet<string> = new Set([
  'alternate',
  'author',
  'canonical',
  'expect',
  'help',
  'license',
  'me',
  'next',
  'prev',
  'privacy-policy',
  'terms-of-service',
]);

/** Says whether a `rel` value, split into ASCII lower-case tokens, makes a browser fetch the `href` of its `link`. */
export const isFetchingRel = (tokens: readonly string[]): boolean =>
  tokens.some((token) => !NON_FETCHING_RELS.has(token));

/**
 * The attributes that name a URL, on every element of `RESOURCE_TAGS`. `imagesrcset` is the `srcset` of a
 * `link rel=preload as=image`: a browser fetches its candidates too, so it counts as a `srcset`.
 */
const RESOURCE_ATTRIBUTES: readonly string[] = ['src', 'href', 'srcset', 'imagesrcset', 'poster', 'action', 'data'];

/**
 * The attributes of the other elements that make a request (section 8): a submit control's `formaction`, the `ping`
 * of a link, which a click sends, and the `href` of an SVG `image` or `use`. An `image` outside SVG is an `img` to
 * the HTML parser, so its `src` counts too. The `src` of an `input` counts only for `type="image"`
 * (`IMAGE_INPUT_ATTRIBUTES`).
 */
const OTHER_ATTRIBUTES: ReadonlyMap<string, readonly string[]> = new Map([
  ['button', ['formaction']],
  ['input', ['formaction']],
  ['a', ['ping']],
  ['area', ['ping']],
  ['image', ['href', 'xlink:href', 'src']],
  ['use', ['href', 'xlink:href']],
]);

/** The attributes of an `input` whose `type` is `image`: it loads its `src`. */
const IMAGE_INPUT_ATTRIBUTES: readonly string[] = ['formaction', 'src'];

const SRCSET_ATTRIBUTES: ReadonlySet<string> = new Set(['srcset', 'imagesrcset']);

/** The attribute that holds a list of URLs, split at ASCII white space: `ping`. */
const URL_LISTS: ReadonlySet<string> = new Set(['ping']);

/**
 * The other origin that a URL of a page names, as `<scheme>://<host>`, or `undefined` for a same-origin URL and for
 * a URL without a host (`data:`, `blob:`, `about:`, `javascript:`, `mailto:`, a fragment). Another host, another port
 * and `http:` on the host of the site are other origins.
 */
function otherOrigin(url: string, page: BuiltPage, host: string): string | undefined {
  const target = resolveHref(url, page.path, host);
  if (target.kind === 'internal') return target.scheme === 'http' ? `http://${host}` : undefined;
  if (target.kind !== 'external') return undefined;
  if (target.host !== undefined) return `${target.scheme}://${target.host}`;
  // A scheme that is no web scheme: it names an origin only when the URL parser finds a host (`ftp://x`, `wss://x`).
  try {
    const parsed = new URL(url.trim());
    return parsed.hostname === '' ? undefined : `${target.scheme}://${parsed.hostname}`;
  } catch {
    return undefined;
  }
}

/** The settings of the three exceptions of `origins-third-party` (9.4). */
interface OriginExceptions {
  forms: ReadonlySet<string>;
  scripts: ReadonlySet<string>;
  frames: ReadonlySet<string>;
}

/**
 * Says whether a URL of another origin is one of the three exceptions (9.4): a `form` `action`, or the `formaction`
 * of a submit control, on a host with `form`; a `script` `src` on a host with `script` and `load: "page"`; an
 * `iframe` `src` with a `title` that is not empty, on a host with `frame` and `load: "page"`. The URL is `https`,
 * with no port and no user, on that host.
 */
function isException(element: HTMLElement, name: string, url: string, allowed: OriginExceptions): boolean {
  const host = httpsHost(url);
  if (host === undefined) return false;
  const tag = tagOf(element);
  if ((tag === 'form' && name === 'action') || name === 'formaction') return allowed.forms.has(host);
  if (tag === 'script' && name === 'src') return allowed.scripts.has(host);
  if (tag === 'iframe' && name === 'src')
    return (attr(element, 'title') ?? '').trim() !== '' && allowed.frames.has(host);
  return false;
}

/** The URL attributes that `origins-third-party` reads on an element: none for an element that it does not read. */
function urlAttributesOf(element: HTMLElement): readonly string[] {
  const tag = tagOf(element);
  if (RESOURCE_TAGS.has(tag)) {
    if (tag === 'link' && !isFetchingRel(tokensOf(element, 'rel'))) return [];
    return RESOURCE_ATTRIBUTES;
  }
  if (tag === 'input' && asciiLower((attr(element, 'type') ?? '').trim()) === 'image') return IMAGE_INPUT_ATTRIBUTES;
  return OTHER_ATTRIBUTES.get(tag) ?? [];
}

/** The URLs of one attribute value: each candidate of a `srcset`, each token of a `ping`, or the value. */
function urlsOf(name: string, value: string): string[] {
  if (SRCSET_ATTRIBUTES.has(name)) return srcsetCandidates(value).map((one) => one.url);
  if (URL_LISTS.has(name)) return value.split(/[\t\n\f\r ]+/).filter((url) => url !== '');
  return [value];
}

/** One element that `origins-third-party` reads, with the words that say where it stands. */
interface ReadElement {
  element: HTMLElement;
  /** `''` for an element of the page; else ` in a noscript` or ` in an iframe srcdoc`. */
  place: string;
}

/** The start tag of an element of a `noscript` or a `srcdoc`, which has no place in the page: its tag and attributes. */
function looseTag(element: HTMLElement): string {
  const attributes = [...attributesOf(element)].map(([name, value]) => `${name}="${value}"`).join(' ');
  return snippet(`<${tagOf(element)}${attributes === '' ? '' : ` ${attributes}`}>`);
}

/**
 * `origins-third-party`: no `img`, `script`, `link` (unless its `rel` never fetches), `iframe`, `source`, `video`, `audio`,
 * `track`, `object`, `embed` or `form` names another origin (`otherOrigin`) in `src`, `href`, `srcset`, `imagesrcset`,
 * `poster`, `action` or `data`; no `button` or `input` in `formaction`, no `input[type=image]` in `src`, no `a` or
 * `area` in `ping`, and no SVG `image` or `use` in `href` or `xlink:href`; but for the three exceptions of 9.4
 * (`isException`). A `srcset` counts each candidate, and a `ping` each URL. The elements inside a `noscript` count
 * too, as a visitor without JavaScript loads them, and so do the elements of the markup of an `iframe` `srcdoc`, with
 * the `srcdoc` and `noscript` markup nested inside it (`nestedOf`). An
 * `a` or `area` `href` may name any address: this rule does not read links. One finding for each element, attribute
 * and URL.
 */
export function auditOriginsThirdParty(ctx: BuildContext): void {
  const { host } = siteOf(ctx);
  const allowed: OriginExceptions = {
    forms: hostsWith(ctx.options, 'form'),
    scripts: hostsWith(ctx.options, 'script', 'page'),
    frames: hostsWith(ctx.options, 'frame', 'page'),
  };
  for (const page of ctx.pages) {
    const { elements } = domOf(page);
    const hidden = noscriptElements(page);
    const found: ReadElement[] = [
      ...elements.map((element) => ({ element, place: '' })),
      ...hidden.map((element) => ({ element, place: ' in a noscript' })),
      ...nestedOf(page).elements,
    ];
    for (const { element, place } of found) {
      for (const name of urlAttributesOf(element)) {
        const value = attr(element, name);
        if (value === undefined) continue;
        for (const url of urlsOf(name, value)) {
          const origin = otherOrigin(url, page, host);
          if (origin === undefined || isException(element, name, url, allowed)) continue;
          const tag = place === '' ? startTag(page, element) : `${looseTag(element)}${place}`;
          ctx.report.add(ORIGINS_THIRD_PARTY, page.path, `${name} of ${tag} names ${snippet(origin)}: ${snippet(url)}`);
        }
      }
    }
  }
}

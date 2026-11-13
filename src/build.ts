/**
 * Loads a built site into a `BuildContext` (specification, 6.1, `astro:build:done`, step 2).
 *
 * - `loadBuild` reads the client directory on disk: `dist/`, or `dist/client/` with an adapter (13.1, item 16).
 * - `memoryContext` builds the same context from a map of paths to texts or bytes. A unit test of a build audit
 *   uses it, so that it needs no disk (14.1).
 *
 * Neither function adds a finding, and neither throws for the content of a file.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { type HTMLElement, parse } from 'node-html-parser';
import {
  addFile,
  type BuildContext,
  type BuiltCss,
  type BuiltPage,
  type Design,
  type Env,
  type Facts,
  isHtmlFile,
  isNotFoundPath,
  pagePathOf,
  readText,
} from './context.ts';
import { effectiveLimits, type Options } from './options.ts';
import type { RedirectRow } from './redirects.ts';
import type { Report } from './registry.ts';
import { localeOfPath } from './routes.ts';

// HTML

/**
 * Parses one HTML text. Comments are dropped. The text of `script`, `noscript`, `style` and `pre` stays raw: it is
 * one text node, and nothing inside it becomes an element. Every audit parses with this function, so that all of
 * them see the same document.
 */
export function parseHtml(html: string): HTMLElement {
  return parse(html, { comment: false, blockTextElements: { script: true, noscript: true, style: true, pre: true } });
}

// Files

/**
 * Every file under `dist`, as a sorted list of paths with `/` and no leading `/`. A folder that does not exist
 * gives an empty list. An entry that is no folder counts as a file.
 */
export function listDist(dist: string): string[] {
  if (!existsSync(dist)) return [];
  const files: string[] = [];
  const visit = (folder: string, prefix: string): void => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      if (entry.isDirectory()) visit(join(folder, entry.name), `${prefix}${entry.name}/`);
      else files.push(`${prefix}${entry.name}`);
    }
  };
  visit(dist, '');
  return files.sort();
}

const isCssFile = (file: string): boolean => file.endsWith('.css');

/**
 * Says whether the text is a path inside the client directory, as `files` of a context lists it: segments joined
 * with `/`, no leading `/`, and no empty, `.` or `..` segment.
 */
function isDistPath(file: string): boolean {
  return !file.includes('\\') && file.split('/').every((part) => part !== '' && part !== '.' && part !== '..');
}

/** Throws for a path that would leave the client directory. This is an error in the calling code, not a finding. */
function requireDistPath(file: string): void {
  if (!isDistPath(file))
    throw new Error(`astro-kit: ${JSON.stringify(file)} is not a path inside the client directory`);
}

// The context

/** What a context is built from, next to the files of the client directory. */
export interface ContextInput {
  /** The project root. */
  root: string;
  /** The client directory. */
  dist: string;
  options: Options;
  kitVersion: string;
  facts: Facts;
  redirects: RedirectRow[];
  design: Design;
  report: Report;
  /** The environment variables. The default is an empty object. */
  env?: Env;
  /** The build time. The default is the time of the call. */
  now?: Date;
}

/** The files of a client directory: on disk, or in memory. */
type Store = Pick<BuildContext, 'files' | 'read' | 'write'>;

function textOf(store: Store, file: string): string {
  const text = readText(store, file);
  if (text === undefined) throw new Error(`astro-kit: ${file} is not in the client directory`);
  return text;
}

/** The page of one HTML file. The locale comes from the URL path, and only `/404.html` is the 404 page. */
function pageOf(file: string, html: string, options: Options): BuiltPage {
  const path = pagePathOf(file);
  return { file, path, locale: localeOfPath(path, options), is404: isNotFoundPath(path), html, root: parseHtml(html) };
}

/** Reads every `.html` and `.css` file of the store once, and puts the context together. */
function contextOf(input: ContextInput, store: Store): BuildContext {
  const { options } = input;
  const pages = store.files
    .filter(isHtmlFile)
    .map((file) => pageOf(file, textOf(store, file), options))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const css: BuiltCss[] = [];
  for (const page of pages) {
    for (const style of page.root.querySelectorAll('style')) {
      css.push({ kind: 'style', where: page.path, text: style.rawText });
    }
  }
  for (const file of store.files.filter(isCssFile)) {
    css.push({ kind: 'file', where: `/${file}`, text: textOf(store, file) });
  }
  return {
    root: input.root,
    dist: input.dist,
    options,
    limits: effectiveLimits(options),
    kitVersion: input.kitVersion,
    pages,
    css,
    files: store.files,
    read: store.read,
    write: store.write,
    facts: input.facts,
    redirects: input.redirects,
    design: input.design,
    report: input.report,
    env: input.env ?? {},
    now: input.now ?? new Date(),
  };
}

/**
 * The context of a built site on disk. It reads every `.html` and `.css` file once. `read` reads any other file
 * when an audit asks for it, and it gives `undefined` for a path that `files` does not list. `write` writes under
 * `dist` and creates the folders. A page that is written later is not parsed again: the kit writes no page.
 */
export function loadBuild(input: ContextInput): BuildContext {
  const { dist } = input;
  const files = listDist(dist);
  const known = new Set(files);
  return contextOf(input, {
    files,
    read: (file) => (known.has(file) ? readFileSync(join(dist, file)) : undefined),
    write: (file, text) => {
      requireDistPath(file);
      const path = join(dist, file);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, text);
      known.add(file);
      addFile(files, file);
    },
  });
}

/**
 * The same context from a map of client directory paths to texts or bytes. Nothing touches the disk: `root` and
 * `dist` are plain strings, and `write` puts the text into the map of the context. A text is stored as UTF-8.
 */
export function memoryContext(
  input: ContextInput & { files: Readonly<Record<string, string | Uint8Array>> },
): BuildContext {
  const encoder = new TextEncoder();
  const store = new Map<string, Uint8Array>();
  for (const [file, content] of Object.entries(input.files)) {
    requireDistPath(file);
    store.set(file, typeof content === 'string' ? encoder.encode(content) : content);
  }
  const files = [...store.keys()].sort();
  return contextOf(input, {
    files,
    read: (file) => store.get(file),
    write: (file, text) => {
      requireDistPath(file);
      store.set(file, encoder.encode(text));
      addFile(files, file);
    },
  });
}

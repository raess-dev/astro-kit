/**
 * The build context: what `astro:build:done` loads from `dist/` and gives to the edge files and to every build
 * audit (specification, 6.1, `astro:build:done`, step 2). This module holds the types and a few pure helpers on
 * paths. `src/build.ts` builds a context, from the disk (`loadBuild`) or from strings (a unit test).
 *
 * The model of `docs/design.md` is here too, because the context carries it. `src/design/parse.ts` fills it.
 */
import type { HTMLElement } from 'node-html-parser';
import type { Glossary, Schedule, SiteFacts } from './facts.ts';
import type { Theme } from './modes.ts';
import type { Limits, Options } from './options.ts';
import type { RedirectRow } from './redirects.ts';
import type { Report } from './registry.ts';
import { NOT_FOUND_PATH } from './routes.ts';

// Pages

/** One built HTML file. */
export interface BuiltPage {
  /** The file from the client directory, with forward slashes: `fr/kontakt/index.html`, `404.html`. */
  file: string;
  /** The URL path: `/fr/kontakt/`. The 404 page is `/404.html`. */
  path: string;
  /**
   * The locale code, from the URL: a first segment equal to a non-default code means that locale, and anything
   * else is the default locale. `/404.html` belongs to the default locale.
   */
  locale: string;
  /** True for `/404.html` only. */
  is404: boolean;
  /** The text of the file, after the inserts of `build:done`. */
  html: string;
  /** The parsed document. */
  root: HTMLElement;
}

/** One piece of built CSS. */
export interface BuiltCss {
  /** `style`: an inline `<style>` of a page. `file`: a `.css` file of the client directory. */
  kind: 'style' | 'file';
  /** The path of the page for a `<style>` (`/zimmer/`), or the path of the file (`/_astro/a.css`). */
  where: string;
  text: string;
}

// Facts

/** The facts of the site. `preflight` has validated the three files before a build loads them. */
export interface Facts {
  site: SiteFacts;
  schedule: Schedule;
  glossary: Glossary;
}

// The design document

/** The file of the design document, from the project root. */
export const DESIGN_FILE = 'docs/design.md';

/** A token family of 7.3, named by its prefix: `--space-2` is of the family `space`. */
export type TokenFamily =
  | 'color'
  | 'space'
  | 'size'
  | 'font'
  | 'text'
  | 'leading'
  | 'weight'
  | 'tracking'
  | 'radius'
  | 'line'
  | 'shadow'
  | 'z'
  | 'duration'
  | 'ease'
  | 'opacity'
  | 'gradient';

/** One row of `## Color`. */
export interface ColorToken {
  /** The custom property: `--color-text`. */
  name: string;
  /**
   * The cell of each declared theme that holds a value: trimmed, with backticks stripped. An empty cell and a
   * theme that is not declared have no entry. `colorValue` of `src/design/tokens.ts` resolves the fallback of 7.4.
   */
  values: Partial<Record<Theme, string>>;
  /** The line of the row in the file, from 1. */
  line: number;
}

/** One row of a token section other than `## Color`. */
export interface ValueToken {
  /** The custom property: `--space-2`. */
  name: string;
  family: Exclude<TokenFamily, 'color'>;
  /** The cell `Value`: trimmed, with backticks stripped. */
  value: string;
  line: number;
}

/** One row of `## Layout helpers`. */
export interface HelperParameter {
  /** The parameter of 7.5: `--stack-gap`. */
  name: string;
  /** The cell `Token`, as written: `var(--space-3)`. */
  token: string;
  line: number;
}

/** One row of `## Breakpoints`. */
export interface Breakpoint {
  name: string;
  /** The cell `Width`, as written: `48rem`. */
  width: string;
  line: number;
}

/** One row of `## Contrast pairs`. `design-pairs` checks the tokens and the role. */
export interface ContrastPair {
  foreground: string;
  background: string;
  /** `text`, `ui` or `non-text`. Another text is a finding of `design-pairs`, so the type is open. */
  role: string;
  /** Free text, or one of the reserved values `body`, `link`, `focus` and `error`. */
  for: string;
  line: number;
}

/** One row of `## Elements` or `## Components`. */
export interface DesignSpec {
  selector: string;
  property: string;
  /** The cell `Token`: `--color-title`. */
  token: string;
  line: number;
}

/** The parsed `docs/design.md` (7.4). Every list keeps the order of its table. */
export interface Design {
  /** The declared themes, in the order `light`, `dark`, `light-contrast`, `dark-contrast`. */
  themes: Theme[];
  colors: ColorToken[];
  /**
   * Every other token, in the section order of 7.7: Typography, Spacing, Size, Radius, Line, Shadow, Layer,
   * Motion, Opacity, Gradient. Inside a section, the order is that of the table.
   */
  tokens: ValueToken[];
  helpers: HelperParameter[];
  breakpoints: Breakpoint[];
  pairs: ContrastPair[];
  elements: DesignSpec[];
  components: DesignSpec[];
}

// The context

/** The environment variables that the build reads, such as `GITHUB_SHA`. */
export type Env = Readonly<Record<string, string | undefined>>;

/**
 * Everything that the edge files and a build audit need. An audit reads the context and adds findings to
 * `report`. It reads a file only through `read`, so a context built from strings works without a disk.
 */
export interface BuildContext {
  /** The project root, an absolute path. */
  root: string;
  /** The client directory, an absolute path: `dist/`, or `dist/client/` with forms. */
  dist: string;
  options: Options;
  /** The limits of the kit, with the three that the site lowered. */
  limits: Limits;
  /** The version of the kit, for `/_kit/release.txt`. */
  kitVersion: string;
  /** Every built HTML file, sorted by `path`. */
  pages: BuiltPage[];
  /** The inline `<style>` texts of every page, in page and document order, then the `.css` files. */
  css: BuiltCss[];
  /** Every file of the client directory, as a sorted list of paths with forward slashes and no leading `/`. */
  files: string[];
  /** The bytes of one file of `files`, or `undefined` when the client directory has no such file. */
  read: (file: string) => Uint8Array | undefined;
  /** Writes one text file into the client directory, creates its folders, and adds its path to `files`. */
  write: (file: string, text: string) => void;
  facts: Facts;
  /** The rows of `redirects.json`. A missing file is an empty list. */
  redirects: RedirectRow[];
  design: Design;
  report: Report;
  env: Env;
  /** The build time. `security.txt` takes its `Expires` from it. */
  now: Date;
}

/** One build audit. It adds findings to `ctx.report`, and it never throws for a finding. */
export type Audit = (ctx: BuildContext) => void | Promise<void>;

// Paths

const INDEX = 'index.html';

/** Says whether a file of the client directory is an HTML file, and so a page. */
export function isHtmlFile(file: string): boolean {
  return file.endsWith('.html');
}

/**
 * The URL path of a built HTML file: `index.html` gives `/`, `fr/kontakt/index.html` gives `/fr/kontakt/`, and
 * `404.html` gives `/404.html`. Any other HTML file keeps its name: `a.html` gives `/a.html`.
 */
export function pagePathOf(file: string): string {
  if (file === INDEX) return '/';
  if (file.endsWith(`/${INDEX}`)) return `/${file.slice(0, -INDEX.length)}`;
  return `/${file}`;
}

/** The file of a page path, from the client directory: `/` gives `index.html`, and `/404.html` gives `404.html`. */
export function fileOfPagePath(path: string): string {
  return path.endsWith('/') ? `${path.slice(1)}${INDEX}` : path.slice(1);
}

/** Says whether the path is the one 404 page. */
export function isNotFoundPath(path: string): boolean {
  return path === NOT_FOUND_PATH;
}

/** The page with this URL path, or `undefined`. */
export function findPage(ctx: Pick<BuildContext, 'pages'>, path: string): BuiltPage | undefined {
  return ctx.pages.find((page) => page.path === path);
}

/** Says whether the client directory holds the file. */
export function hasFile(ctx: Pick<BuildContext, 'files'>, file: string): boolean {
  return ctx.files.includes(file);
}

/** The text of one file of the client directory as UTF-8, or `undefined` when there is no such file. */
export function readText(ctx: Pick<BuildContext, 'read'>, file: string): string | undefined {
  const bytes = ctx.read(file);
  return bytes === undefined ? undefined : new TextDecoder().decode(bytes);
}

/** Adds a path to a sorted file list, once. `write` of a context uses it. */
export function addFile(files: string[], file: string): void {
  if (files.includes(file)) return;
  files.push(file);
  files.sort();
}

/**
 * The `css-*` rules and `modes-media` (specification, 3.2, 7 and 8). This module holds what the rules share, and it
 * re-exports the three groups of rules in `./rules/`:
 *
 * - `structure.ts`: `css-sources`, `css-layer-file`, `css-layer-order`, `css-component-file`, `css-selector`,
 *   `css-page` and `css-banned`;
 * - `values.ts`: `css-literal`, `css-token-family`, `css-local-var`, `css-var-undefined`, `css-media` and
 *   `modes-media`;
 * - `coverage.ts`: `css-classes`, `css-unused` and `css-element-coverage`.
 *
 * `src/design/rules.ts` holds `design-specs`, `design-pairs` and the built half of `design-tokens`, on the same inputs.
 *
 * **The inputs.** A source half reads a `SourceCss`: the project CSS files of 7.1 with their layer, each parsed once,
 * the other style files, the source texts under `src/`, the components, and the declared tokens and breakpoints of
 * `docs/design.md`. A built half reads a `BuiltCssInput`: the build context, the same `SourceCss`, and the CSS of
 * each built page, parsed once, with the layer of each node, the elements and the classes of the page.
 *
 * **The order.** `CSS_CHECKS` runs the source halves in the order of 6.1, step 2, sub-step 10, and `CSS_AUDITS` the
 * built halves in the order of section 8. Each entry says what it needs (`Need`), and the runner applies the
 * dependency rule and the settings rule of 6.1, so a rule never tests them itself.
 *
 * **Import cycles.** A group module imports this module, and this module imports the groups. So a group uses the
 * exports of this module only inside its functions, never at its top level, and it exports its rules as function
 * declarations. Then either module can load first.
 *
 * Nothing here adds a finding, and nothing throws for the content of a file. Every table is a map or a set.
 */
import { readFileSync } from 'node:fs';
import { extname } from 'node:path';
import type { HTMLElement } from 'node-html-parser';
import { parseHtml } from '../build.ts';
import type { BuildContext, BuiltPage, Design, TokenFamily } from '../context.ts';
import { familyOf } from '../design/parse.ts';
import { colorValue, TOKENS_FILE } from '../design/tokens.ts';
import type { Options } from '../options.ts';
import { listFiles, SOURCE_MAX_BYTES } from '../project.ts';
import type { Report } from '../registry.ts';
import {
  type AtRule,
  asciiLower,
  type ComponentValue,
  type CssNode,
  type Declaration,
  layerOrder,
  type Place,
  parseCss,
  parseValue,
  type Rule,
  type Stylesheet,
  serialize,
  walk,
} from './parse.ts';
import { auditCssClasses, auditCssElementCoverage, auditCssUnused } from './rules/coverage.ts';
import {
  auditCssBanned,
  auditCssLayerOrder,
  auditCssPage,
  auditCssSelector,
  auditCssSources,
  checkCssBanned,
  checkCssComponentFile,
  checkCssLayerFile,
  checkCssPage,
  checkCssSelector,
  checkCssSources,
} from './rules/structure.ts';
import {
  auditCssLiteral,
  auditCssLocalVar,
  auditCssMedia,
  auditCssTokenFamily,
  auditCssVarUndefined,
  auditModesMedia,
  checkCssLiteral,
  checkCssLocalVar,
  checkCssMedia,
  checkCssTokenFamily,
  checkCssVarUndefined,
  checkModesMedia,
} from './rules/values.ts';
import type { CssFile, ShapeOptions } from './selectors.ts';
import { helperParameterFamily } from './values.ts';

export {
  auditCssBanned,
  auditCssClasses,
  auditCssElementCoverage,
  auditCssLayerOrder,
  auditCssLiteral,
  auditCssLocalVar,
  auditCssMedia,
  auditCssPage,
  auditCssSelector,
  auditCssSources,
  auditCssTokenFamily,
  auditCssUnused,
  auditCssVarUndefined,
  auditModesMedia,
  checkCssBanned,
  checkCssComponentFile,
  checkCssLayerFile,
  checkCssLiteral,
  checkCssLocalVar,
  checkCssMedia,
  checkCssPage,
  checkCssSelector,
  checkCssSources,
  checkCssTokenFamily,
  checkCssVarUndefined,
  checkModesMedia,
};

// The places of 7.1 and 7.2

/** The file of the `elements` layer (7.1). `TOKENS_FILE` of `src/design/tokens.ts` is the file of `tokens`. */
export const ELEMENTS_FILE = 'src/styles/elements.css';

/** The file of the `@font-face` rules (7.2). */
export const FONTS_FILE = 'src/styles/fonts.css';

/** The folder of the component files: `src/styles/components/<kebab>.css`, with no folder below it (7.1). */
export const COMPONENT_CSS_FOLDER = 'src/styles/components/';

/** The folder of the page files: `src/styles/pages/<route path>.css`, at any depth (7.1, 7.9). */
export const PAGE_CSS_FOLDER = 'src/styles/pages/';

/** The folder of the components: `src/components/**` (7.8). */
export const COMPONENTS_FOLDER = 'src/components/';

/** The folder of the routes: `src/pages/**` (7.2). */
export const ROUTES_FOLDER = 'src/pages/';

/** The folder of the layouts, which import no CSS (7.2). */
export const LAYOUTS_FOLDER = 'src/layouts/';

/** The extensions of a component (7.8). */
export const COMPONENT_EXTENSIONS: ReadonlySet<string> = new Set(['.astro', '.tsx']);

/**
 * The extensions of a style file. Vite reads each of them as CSS, so each one outside the places of 7.1 is a finding
 * of `css-sources` (`.css` in `public/` too). The extension compares in ASCII lower case.
 */
export const STYLE_EXTENSIONS: ReadonlySet<string> = new Set([
  '.css',
  '.less',
  '.sass',
  '.scss',
  '.styl',
  '.stylus',
  '.pcss',
  '.postcss',
  '.sss',
]);

/**
 * The extensions of a source text that a rule reads under `src/`: the markup files of `css-sources`, `css-banned` and
 * `modes-media`, and every file that can import CSS.
 */
export const SOURCE_TEXT_KINDS: ReadonlyMap<string, SourceKind> = new Map<string, SourceKind>([
  ['.astro', 'astro'],
  ['.md', 'md'],
  ['.mdx', 'mdx'],
  ['.tsx', 'tsx'],
  ['.jsx', 'jsx'],
  ['.ts', 'script'],
  ['.js', 'script'],
  ['.mjs', 'script'],
  ['.mts', 'script'],
  ['.cts', 'script'],
  ['.cjs', 'script'],
]);

/**
 * The classes that the kit's `css/base.css` defines (7.5, 7.6): `.visually-hidden` and the four layout helpers.
 * `css-classes` accepts them on a page, and `css-unused` leaves them out.
 */
export const BASE_CLASSES: ReadonlySet<string> = new Set(['visually-hidden', 'stack', 'cluster', 'grid', 'center']);

/** The parameters that each layout helper reads (7.5). `css-var-undefined` needs them for a helper used on a page. */
export const HELPER_CLASS_PARAMETERS: ReadonlyMap<string, readonly string[]> = new Map([
  ['stack', ['--stack-gap']],
  ['cluster', ['--cluster-gap']],
  ['grid', ['--grid-gap', '--grid-min']],
  ['center', ['--center-max', '--center-gutter']],
]);

/** The page file of a route (7.2): `src/pages/a/b.astro` pairs with `src/styles/pages/a/b.css`. */
export function pageCssOf(route: string): string | undefined {
  if (!route.startsWith(ROUTES_FOLDER)) return undefined;
  const rest = route.slice(ROUTES_FOLDER.length);
  const extension = extname(rest);
  if (extension === '' || rest.length === extension.length) return undefined;
  return `${PAGE_CSS_FOLDER}${rest.slice(0, -extension.length)}.css`;
}

/**
 * The kebab name of a component name (7.8): PascalCase to kebab-case. A `-` stands before each upper-case letter that
 * follows a lower-case letter or a digit, and before the last upper-case letter of a run that a lower-case letter
 * follows. So `FeatureCard` gives `feature-card`, `SEOHead` gives `seo-head` and `Card2Up` gives `card2-up`. A name
 * that is not PascalCase ASCII (`^[A-Z][A-Za-z0-9]*$`) has none.
 */
export function kebabOf(name: string): string | undefined {
  if (!/^[A-Z][A-Za-z0-9]*$/.test(name)) return undefined;
  let out = '';
  for (let index = 0; index < name.length; index += 1) {
    const char = name.charAt(index);
    const upper = char >= 'A' && char <= 'Z';
    if (upper && index > 0) {
      const before = name.charAt(index - 1);
      const after = name.charAt(index + 1);
      const lowerBefore = (before >= 'a' && before <= 'z') || (before >= '0' && before <= '9');
      const runEnds = before >= 'A' && before <= 'Z' && after >= 'a' && after <= 'z';
      if (lowerBefore || runEnds) out += '-';
    }
    out += upper ? char.toLowerCase() : char;
  }
  return out;
}

// The project CSS files (7.1)

/** What a project CSS file is (7.1). */
export type CssFileKind = 'tokens' | 'elements' | 'fonts' | 'component' | 'page';

/** The layer that a project CSS file writes into (7.1). `fonts.css` writes into none. */
export type SourceLayer = 'tokens' | 'elements' | 'components' | 'page';

/** The place of a project CSS file in 7.1. */
export interface CssPlace {
  kind: CssFileKind;
  /** The layer of the file; `undefined` for `fonts.css`. */
  layer: SourceLayer | undefined;
  /** The kebab name of a component file: `card` for `components/card.css`. `undefined` for any other file. */
  component: string | undefined;
  /** The route path of a page file: `en/index` for `pages/en/index.css`. `undefined` for any other file. */
  route: string | undefined;
  /** The file kind of `selectors.ts` for the shape checks: elements, component and page files. */
  shape: CssFile | undefined;
}

const LAYER_OF: ReadonlyMap<CssFileKind, SourceLayer> = new Map<CssFileKind, SourceLayer>([
  ['tokens', 'tokens'],
  ['elements', 'elements'],
  ['component', 'components'],
  ['page', 'page'],
]);

const placeOf = (kind: CssFileKind, component?: string, route?: string): CssPlace => {
  const shape: CssFile | undefined =
    kind === 'elements'
      ? { kind: 'elements' }
      : kind === 'component'
        ? { kind: 'component', component: component ?? '' }
        : kind === 'page'
          ? { kind: 'page' }
          : undefined;
  return { kind, layer: LAYER_OF.get(kind), component, route, shape };
};

/**
 * The place of a path in 7.1, or `undefined` when the path is no project CSS file: `src/styles/tokens.css`,
 * `elements.css`, `fonts.css`, `components/<name>.css` (one level) and `pages/**\/<name>.css`. The extension is
 * exactly `.css`. A component file keeps any name here: `css-component-file` checks it against the components.
 */
export function cssPlaceOf(path: string): CssPlace | undefined {
  if (path === TOKENS_FILE) return placeOf('tokens');
  if (path === ELEMENTS_FILE) return placeOf('elements');
  if (path === FONTS_FILE) return placeOf('fonts');
  if (!path.endsWith('.css')) return undefined;
  if (path.startsWith(COMPONENT_CSS_FOLDER)) {
    const name = path.slice(COMPONENT_CSS_FOLDER.length, -'.css'.length);
    return name === '' || name.includes('/') ? undefined : placeOf('component', name);
  }
  if (path.startsWith(PAGE_CSS_FOLDER)) {
    const route = path.slice(PAGE_CSS_FOLDER.length, -'.css'.length);
    const segments = route.split('/');
    return segments.some((segment) => segment === '') ? undefined : placeOf('page', undefined, route);
  }
  return undefined;
}

/** One project CSS file at a place of 7.1, parsed once. */
export interface CssSourceFile extends CssPlace {
  /** The path from the project root: `src/styles/components/card.css`. */
  path: string;
  text: string;
  /** The parsed text. Its `file` is `path`. */
  sheet: Stylesheet;
}

// Source texts (7.2)

/** What a source text is: a markup file of 7.2, or a script that can import CSS. */
export type SourceKind = 'astro' | 'md' | 'mdx' | 'tsx' | 'jsx' | 'script';

/** One text file under `src/` with an extension of `SOURCE_TEXT_KINDS`. */
export interface SourceText {
  path: string;
  kind: SourceKind;
  text: string;
  /**
   * The frontmatter between the two `---` lines at the start of an `.astro`, `.md` or `.mdx` file, with its offsets
   * in `text` (the fences included). `undefined` when the file has none.
   */
  frontmatter: { text: string; start: number; end: number } | undefined;
  /**
   * The markup of an `.astro`, `.md`, `.mdx`, `.tsx` or `.jsx` file, parsed with `parseHtml`: the elements, their
   * attributes and their offsets (`range`) in `text`. The frontmatter is blanked first (each character other than a
   * line feed becomes a space), so no tag there counts and every offset still fits `text`. A script has none.
   */
  markup: HTMLElement | undefined;
}

const MARKUP_KINDS: ReadonlySet<SourceKind> = new Set<SourceKind>(['astro', 'md', 'mdx', 'tsx', 'jsx']);
const FRONTMATTER_KINDS: ReadonlySet<SourceKind> = new Set<SourceKind>(['astro', 'md', 'mdx']);

/**
 * The frontmatter of a text: a first line `---` (white space before it is allowed), up to the next line that is
 * `---`. Lines may end with CRLF. `undefined` when the text has no such fence pair.
 */
export function frontmatterOf(text: string): { text: string; start: number; end: number } | undefined {
  const start = text.length - text.trimStart().length;
  const firstEnd = text.indexOf('\n', start);
  if (firstEnd < 0 || text.slice(start, firstEnd).trimEnd() !== '---') return undefined;
  let lineStart = firstEnd + 1;
  while (lineStart <= text.length) {
    const next = text.indexOf('\n', lineStart);
    const lineEnd = next < 0 ? text.length : next;
    if (text.slice(lineStart, lineEnd).trimEnd() === '---') {
      return { text: text.slice(firstEnd + 1, lineStart), start, end: lineEnd };
    }
    if (next < 0) return undefined;
    lineStart = next + 1;
  }
  return undefined;
}

/** The text with the characters from `start` to `end` replaced by spaces, line feeds kept. */
function blank(text: string, start: number, end: number): string {
  return text.slice(0, start) + text.slice(start, end).replace(/[^\n]/g, ' ') + text.slice(end);
}

function sourceTextOf(path: string, kind: SourceKind, text: string): SourceText {
  const frontmatter = FRONTMATTER_KINDS.has(kind) ? frontmatterOf(text) : undefined;
  const markupText = frontmatter === undefined ? text : blank(text, frontmatter.start, frontmatter.end);
  return { path, kind, text, frontmatter, markup: MARKUP_KINDS.has(kind) ? parseHtml(markupText) : undefined };
}

// Components (7.8)

/** One component: `src/components/**\/<Name>.astro` or `<Name>.tsx`. */
export interface Component {
  path: string;
  /** The file name without its extension: `FeatureCard`. */
  name: string;
  /** `.astro` or `.tsx`. */
  extension: string;
  /** The kebab name (`kebabOf`), or `undefined` when the name is not PascalCase. */
  kebab: string | undefined;
  /** The file it needs: `src/styles/components/<kebab>.css`. `undefined` without a kebab name. */
  css: string | undefined;
}

// Tokens (7.3, 7.4, 7.5)

/** One custom property that `tokens.css` defines: a token of `docs/design.md`, or a helper parameter of 7.5. */
export interface DeclaredName {
  name: string;
  /** The family of a token by its prefix, or the family of a helper parameter (7.5). */
  family: TokenFamily;
  kind: 'token' | 'helper';
  /**
   * The value as `docs/design.md` gives it: the cell `Value`, the cell `Token` of a helper parameter (`var(--space-3)`),
   * or for a color the cell of the first declared theme, with the fallback of 7.4 resolved.
   */
  text: string;
  /** `text` after `parseValue`. */
  value: ComponentValue[];
}

/** The custom properties that `tokens.css` defines, by name, in the order of `docs/design.md`. */
export type TokenTable = ReadonlyMap<string, DeclaredName>;

/** The tokens and helper parameters of a design, as `tokens.css` defines them (7.7). */
export function tokenTableOf(design: Design): TokenTable {
  const table = new Map<string, DeclaredName>();
  const add = (name: string, family: TokenFamily, kind: DeclaredName['kind'], text: string): void => {
    if (!table.has(name)) table.set(name, { name, family, kind, text, value: parseValue(text).values });
  };
  const first = design.themes[0];
  for (const color of design.colors)
    add(color.name, 'color', 'token', first === undefined ? '' : (colorValue(color, first) ?? ''));
  for (const token of design.tokens) add(token.name, token.family, 'token', token.value);
  for (const helper of design.helpers) {
    const family = helperParameterFamily(helper.name);
    if (family !== undefined) add(helper.name, family, 'helper', helper.token);
  }
  return table;
}

/** The family of a token name by its prefix (7.3), declared or not. A helper parameter has the family of 7.5. */
export function prefixFamily(name: string): TokenFamily | undefined {
  return familyOf(name) ?? helperParameterFamily(name);
}

// The source input

/** What `sourceCss` reads: one file of `src/` or `public/`. `text` is `undefined` for a file that is not read. */
export interface ProjectText {
  path: string;
  text: string | undefined;
}

/** The project files that the source halves read (6.1, step 2, sub-steps 9 and 10). */
export interface SourceCss {
  /** The settings, or `undefined` when `astro-kit.json` is not valid (the settings rule of 6.1). */
  options: Options | undefined;
  /** The design, or `undefined` when `docs/design.md` fails `design-format` (the dependency rule of 6.1). */
  design: Design | undefined;
  /**
   * The names that `tokens.css` defines, or `undefined` unless `docs/design.md` and `tokens.css` both parse: the
   * design is defined, and `src/styles/tokens.css` exists and has no parse problem (6.1, the dependency rule).
   */
  tokens: TokenTable | undefined;
  /** The project CSS files of 7.1 that were read, sorted by path, `tokens.css` and `fonts.css` included. */
  files: CssSourceFile[];
  /**
   * The paths of the files at a place of 7.1 that were not read, sorted: a link to a file outside the project, or a
   * file of more than `SOURCE_MAX_BYTES`. `config-suppression` reports them; a rule that asks whether a file exists
   * (`css-component-file`) still finds them here.
   */
  unread: string[];
  /**
   * The paths of every other style file under `src/` and `public/` (`STYLE_EXTENSIONS`), sorted: a file outside the
   * places of 7.1, a `.css` file in `public/`, and a file at a place of 7.1 whose extension is not exactly `.css`.
   */
  stray: string[];
  /** The source texts under `src/` that were read, sorted by path. */
  sources: SourceText[];
  /** The components, sorted by path. Two components may share a name: `css-component-file` reports it. */
  components: Component[];
  /**
   * The shape options of `selectors.ts`: the kebab names of every component and of every component file. A component
   * file without a component still names a component, so another file cannot use its classes.
   */
  shape: ShapeOptions;
}

const isStyleFile = (path: string): boolean => STYLE_EXTENSIONS.has(asciiLower(extname(path)));

const byPath = <Item extends { path: string }>(a: Item, b: Item): number =>
  a.path === b.path ? 0 : a.path < b.path ? -1 : 1;

/**
 * The source input from a list of project files, with no disk. A unit test builds it from strings. Each CSS file is
 * parsed once, and each markup file too. A file with no text is not read: it counts only by its path.
 */
export function sourceCss(
  files: readonly ProjectText[],
  design: Design | undefined,
  options: Options | undefined,
): SourceCss {
  const css: CssSourceFile[] = [];
  const unread: string[] = [];
  const stray: string[] = [];
  const sources: SourceText[] = [];
  const components: Component[] = [];
  for (const { path, text } of files) {
    const place = cssPlaceOf(path);
    if (place !== undefined) {
      if (text !== undefined) css.push({ ...place, path, text, sheet: parseCss(text, path) });
      else unread.push(path);
    } else if (isStyleFile(path)) stray.push(path);
    const kind = SOURCE_TEXT_KINDS.get(extname(path));
    if (path.startsWith('src/') && kind !== undefined && text !== undefined)
      sources.push(sourceTextOf(path, kind, text));
    const extension = extname(path);
    if (path.startsWith(COMPONENTS_FOLDER) && COMPONENT_EXTENSIONS.has(extension)) {
      const name = path.slice(path.lastIndexOf('/') + 1, -extension.length);
      const kebab = kebabOf(name);
      const file = kebab === undefined ? undefined : `${COMPONENT_CSS_FOLDER}${kebab}.css`;
      components.push({ path, name, extension, kebab, css: file });
    }
  }
  css.sort(byPath);
  unread.sort();
  stray.sort();
  sources.sort(byPath);
  components.sort(byPath);
  const names = new Set<string>();
  for (const component of components) if (component.kebab !== undefined) names.add(component.kebab);
  for (const file of css) if (file.component !== undefined) names.add(file.component);
  const tokensFile = css.find((file) => file.kind === 'tokens');
  const tokens =
    design !== undefined && tokensFile !== undefined && tokensFile.sheet.problems.length === 0
      ? tokenTableOf(design)
      : undefined;
  return { options, design, tokens, files: css, unread, stray, sources, components, shape: { components: names } };
}

/** Says whether the source halves read the text of this file: a style file or a source text under `src/`. */
const isRead = (path: string): boolean =>
  cssPlaceOf(path) !== undefined || (path.startsWith('src/') && SOURCE_TEXT_KINDS.has(extname(path)));

/**
 * The source input of a project on disk: every file under `src/` and `public/`, listed once (`listFiles` of
 * `project.ts`). It reads the text of each project CSS file and each source text, but not a link to a file outside
 * the project and not a file of more than `SOURCE_MAX_BYTES` (`config-suppression` reports both).
 */
export function loadSourceCss(root: string, design: Design | undefined, options: Options | undefined): SourceCss {
  const files: ProjectText[] = [];
  for (const folder of ['src', 'public']) {
    for (const file of listFiles(root, folder)) {
      let text: string | undefined;
      if (file.inside && isRead(file.path)) {
        const bytes = readFileSync(file.file);
        text = bytes.length > SOURCE_MAX_BYTES ? undefined : new TextDecoder().decode(bytes);
      }
      files.push({ path: file.path, text });
    }
  }
  return sourceCss(files, design, options);
}

// Built CSS (7.1, 13.1 items 3 and 40)

/** The layers of the order statement of `css/base.css`, in order (7.1). */
export const LAYER_ORDER = ['astro', 'reset', 'tokens', 'elements', 'layout', 'components', 'page'] as const;

/** One layer of `LAYER_ORDER`. */
export type KitLayer = (typeof LAYER_ORDER)[number];

const KIT_LAYER_NAMES: ReadonlySet<string> = new Set<string>(LAYER_ORDER);

const isKitLayer = (name: string): name is KitLayer => KIT_LAYER_NAMES.has(name);

/** The layers that project CSS writes into (7.1): `elements`, `components` and `page`. */
export const PROJECT_LAYERS: ReadonlySet<KitLayer> = new Set<KitLayer>(['elements', 'components', 'page']);

/** The layers of the kit and of Astro, which the value rules leave alone: `astro`, `reset` and `layout`. */
export const KIT_LAYERS: ReadonlySet<KitLayer> = new Set<KitLayer>(['astro', 'reset', 'layout']);

/**
 * The layer of `LAYER_ORDER` that a full layer name of `walk` belongs to: its first segment. `astro.images` belongs to
 * `astro`, and `components.x` to `components`. `undefined` for an unlayered node, an anonymous layer and any other
 * name.
 */
export function kitLayerOf(layer: string | undefined): KitLayer | undefined {
  if (layer === undefined) return undefined;
  const dot = layer.indexOf('.');
  const top = dot < 0 ? layer : layer.slice(0, dot);
  return isKitLayer(top) ? top : undefined;
}

/** One node of built CSS with what encloses it (`WalkContext` of `parse.ts`). */
export interface BuiltNode {
  node: CssNode;
  /** The enclosing at-rules, the outermost first. */
  atRules: readonly AtRule[];
  /** The rule that holds the node, as `WalkContext.rule` gives it. */
  rule: Rule | undefined;
  /** The full layer name (`astro.images`), or `undefined` for an unlayered node. */
  layer: string | undefined;
  /** The layer of `LAYER_ORDER` that the node belongs to (`kitLayerOf`). */
  kitLayer: KitLayer | undefined;
}

/** One `<style>` text of a page, parsed once. Pages with the same text share one object. */
export interface BuiltSheet {
  text: string;
  /** The parsed text. Its `file` is the path of the first page that holds the text. */
  sheet: Stylesheet;
  /** Every node, in the order of the text, each before its children (`walk`). */
  nodes: BuiltNode[];
}

/** The CSS and the markup of one built page. */
export interface PageCss {
  page: BuiltPage;
  /** The page path: the `where` of every built finding (section 8, Where). */
  path: string;
  /** The `<style>` elements of the page, in document order. */
  sheets: BuiltSheet[];
  /**
   * The layer names of the top-level `@layer` statements and blocks of all its sheets, in the order of first
   * appearance (`layerOrder` of `parse.ts`, 13.1 item 3).
   */
  layerOrder: string[];
  /**
   * Every element of the page, in document order: those of `page.root`, then those inside each `<noscript>`, whose
   * text `parseHtml` keeps raw and this list parses once more.
   */
  elements: HTMLElement[];
  /** Every class on an element of `elements`. */
  classes: ReadonlySet<string>;
}

/** What a built half reads (6.1, `astro:build:done`, step 4). */
export interface BuiltCssInput {
  ctx: BuildContext;
  /** The project CSS, the components and the tokens, as the source halves read them. */
  source: SourceCss;
  /** One entry for each built page, sorted by path, `/404.html` included. */
  pages: PageCss[];
}

function nodesOf(sheet: Stylesheet): BuiltNode[] {
  const nodes: BuiltNode[] = [];
  walk(sheet, (node, context) => {
    nodes.push({
      node,
      atRules: context.atRules,
      rule: context.rule,
      layer: context.layer,
      kitLayer: kitLayerOf(context.layer),
    });
  });
  return nodes;
}

/** The class names of a `class` attribute: split at ASCII white space, empty parts dropped (HTML). */
export function classNames(value: string | undefined): string[] {
  return value === undefined ? [] : value.split(/[\t\n\f\r ]+/).filter((name) => name !== '');
}

function elementsOf(page: BuiltPage): HTMLElement[] {
  const elements = page.root.querySelectorAll('*');
  const inner = elements
    .filter((element) => element.rawTagName.toLowerCase() === 'noscript')
    .flatMap((element) => parseHtml(element.rawText).querySelectorAll('*'));
  return [...elements, ...inner];
}

/**
 * The built input of a context and a source input, with no disk: each distinct `<style>` text is parsed once, and
 * each page's markup is read once.
 */
export function builtCss(ctx: BuildContext, source: SourceCss): BuiltCssInput {
  const sheets = new Map<string, BuiltSheet>();
  const stylesOf = new Map<string, BuiltSheet[]>();
  for (const css of ctx.css) {
    if (css.kind !== 'style') continue;
    let built = sheets.get(css.text);
    if (built === undefined) {
      const sheet = parseCss(css.text, css.where);
      built = { text: css.text, sheet, nodes: nodesOf(sheet) };
      sheets.set(css.text, built);
    }
    const list = stylesOf.get(css.where) ?? [];
    list.push(built);
    stylesOf.set(css.where, list);
  }
  const pages = ctx.pages.map((page): PageCss => {
    const own = stylesOf.get(page.path) ?? [];
    const order: string[] = [];
    for (const { sheet } of own) for (const name of layerOrder(sheet)) if (!order.includes(name)) order.push(name);
    const elements = elementsOf(page);
    const classes = new Set(elements.flatMap((element) => classNames(element.getAttribute('class'))));
    return { page, path: page.path, sheets: own, layerOrder: order, elements, classes };
  });
  return { ctx, source, pages };
}

const BUILT = new WeakMap<BuildContext, BuiltCssInput>();

/**
 * The built input of a build, read once: the css audit and the design audit share it. It loads the source input from
 * `ctx.root` with the design and the settings of the context.
 */
export function builtCssOf(ctx: BuildContext): BuiltCssInput {
  const cached = BUILT.get(ctx);
  if (cached !== undefined) return cached;
  const input = builtCss(ctx, loadSourceCss(ctx.root, ctx.design, ctx.options));
  BUILT.set(ctx, input);
  return input;
}

// Findings

/** Adds one finding: `report.add` with the same arguments. */
export type Add = (id: string, where: string, detail?: string) => void;

/**
 * A function that adds each finding once: a second call with the same id, place and detail adds nothing. A rule
 * that meets one fact twice (a shared `<style>`, a selector list) uses it, so a fact reports once for each place.
 */
export function reportOnce(report: Report): Add {
  const seen = new Set<string>();
  return (id, where, detail) => {
    const key = JSON.stringify([id, where, detail ?? null]);
    if (seen.has(key)) return;
    seen.add(key);
    if (detail === undefined) report.add(id, where);
    else report.add(id, where, detail);
  };
}

/** The `where` of a source finding: the project file and the line (`src/styles/elements.css:12`, section 8). */
export function sourceWhere(path: string, place: Pick<Place, 'line'>): string {
  return `${path}:${place.line}`;
}

/** The line of an offset in a text, from 1. */
export function lineAt(text: string, offset: number): number {
  let line = 1;
  const end = Math.min(Math.max(offset, 0), text.length);
  for (let index = text.indexOf('\n'); index >= 0 && index < end; index = text.indexOf('\n', index + 1)) line += 1;
  return line;
}

/** The longest text of a detail. A longer one is cut and ends with `…`. */
export const MAX_DETAIL = 120;

/** A text for a detail: white space runs as one space, cut at `MAX_DETAIL` characters. */
export function snippet(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= MAX_DETAIL ? flat : `${flat.slice(0, MAX_DETAIL - 1)}…`;
}

/** A declaration as a detail: `color: #c00`, with `!important` when it has one. */
export function declarationText(declaration: Declaration): string {
  return snippet(
    `${declaration.property}: ${serialize(declaration.value)}${declaration.important ? ' !important' : ''}`,
  );
}

// The order of the rules

/**
 * What a rule needs before it runs (6.1, the dependency rule and the settings rule): `nothing`; `settings`, valid
 * settings; `design`, a design that passes `design-format`; `tokens`, the design and a `tokens.css` that parses.
 */
export type Need = 'nothing' | 'settings' | 'design' | 'tokens';

/** One source half. */
export interface SourceCheck {
  id: string;
  needs: Need;
  run: (input: SourceCss, report: Report) => void;
}

/** One built half. */
export interface BuiltCheck {
  id: string;
  needs: Need;
  run: (input: BuiltCssInput, report: Report) => void;
}

/** Says whether the input meets the need. */
export function meets(input: SourceCss, need: Need): boolean {
  switch (need) {
    case 'settings':
      return input.options !== undefined;
    case 'design':
      return input.design !== undefined;
    case 'tokens':
      return input.tokens !== undefined;
    default:
      return true;
  }
}

/** Runs the checks in order, each one whose need the input meets. Returns the ids of the checks that ran. */
export function runSourceChecks(input: SourceCss, checks: readonly SourceCheck[], report: Report): string[] {
  const ran: string[] = [];
  for (const check of checks) {
    if (!meets(input, check.needs)) continue;
    check.run(input, report);
    ran.push(check.id);
  }
  return ran;
}

/** Runs the built halves in order, each one whose need the source input meets. Returns the ids that ran. */
export function runBuiltChecks(input: BuiltCssInput, checks: readonly BuiltCheck[], report: Report): string[] {
  const ran: string[] = [];
  for (const check of checks) {
    if (!meets(input.source, check.needs)) continue;
    check.run(input, report);
    ran.push(check.id);
  }
  return ran;
}

/** The CSS source halves, in the order of 6.1, step 2, sub-step 10. */
export const CSS_CHECKS: readonly SourceCheck[] = [
  { id: 'css-sources', needs: 'nothing', run: checkCssSources },
  { id: 'css-layer-file', needs: 'nothing', run: checkCssLayerFile },
  { id: 'css-component-file', needs: 'nothing', run: checkCssComponentFile },
  { id: 'css-literal', needs: 'nothing', run: checkCssLiteral },
  { id: 'css-token-family', needs: 'tokens', run: checkCssTokenFamily },
  { id: 'css-local-var', needs: 'nothing', run: checkCssLocalVar },
  { id: 'css-var-undefined', needs: 'tokens', run: checkCssVarUndefined },
  { id: 'css-selector', needs: 'nothing', run: checkCssSelector },
  { id: 'css-banned', needs: 'nothing', run: checkCssBanned },
  { id: 'css-media', needs: 'tokens', run: checkCssMedia },
  { id: 'css-page', needs: 'nothing', run: checkCssPage },
  { id: 'modes-media', needs: 'settings', run: checkModesMedia },
];

/** The CSS built halves, in the order of section 8, then `modes-media` (6.1, `astro:build:done`, step 4). */
export const CSS_AUDITS: readonly BuiltCheck[] = [
  { id: 'css-sources', needs: 'nothing', run: auditCssSources },
  { id: 'css-layer-order', needs: 'nothing', run: auditCssLayerOrder },
  { id: 'css-literal', needs: 'nothing', run: auditCssLiteral },
  { id: 'css-token-family', needs: 'tokens', run: auditCssTokenFamily },
  { id: 'css-local-var', needs: 'nothing', run: auditCssLocalVar },
  { id: 'css-var-undefined', needs: 'tokens', run: auditCssVarUndefined },
  { id: 'css-selector', needs: 'nothing', run: auditCssSelector },
  { id: 'css-classes', needs: 'nothing', run: auditCssClasses },
  { id: 'css-banned', needs: 'nothing', run: auditCssBanned },
  { id: 'css-media', needs: 'tokens', run: auditCssMedia },
  { id: 'css-unused', needs: 'nothing', run: auditCssUnused },
  { id: 'css-page', needs: 'nothing', run: auditCssPage },
  { id: 'css-element-coverage', needs: 'nothing', run: auditCssElementCoverage },
  { id: 'modes-media', needs: 'settings', run: auditModesMedia },
];

/** Sub-step 10 of 6.1, step 2: the CSS source halves, from `css-sources` to `modes-media`. */
export function checkCss(input: SourceCss, report: Report): void {
  runSourceChecks(input, CSS_CHECKS, report);
}

/** The css audit of 6.1, `astro:build:done`, step 4: the built halves of the `css-*` rules and of `modes-media`. */
export function auditCss(ctx: BuildContext): void {
  runBuiltChecks(builtCssOf(ctx), CSS_AUDITS, ctx.report);
}

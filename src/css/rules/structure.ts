/**
 * The structure rules of the css group (specification, 7.1, 7.2, 7.8, 7.9, 7.11 and 8): `css-sources`,
 * `css-layer-file`, `css-layer-order`, `css-component-file`, `css-selector`, `css-page` and `css-banned`.
 *
 * A `check…` function is the source half of a rule, an `audit…` function its built half. `../rules.ts` runs them in
 * the order of 6.1 and applies the dependency rule and the settings rule. This module uses the exports of
 * `../rules.ts` only inside its functions (see the head of that module).
 *
 * **Who reports what.** Each fact reports once, by one rule:
 *
 * - The top level of a project CSS file is `css-layer-file`'s: a second block, a rule outside the block, a statement.
 *   `css-selector` reads only what stands inside a layer block. A top-level `@import` or `@scope` is `css-banned`'s.
 * - A parse problem is `css-layer-file`'s in a project file and `css-layer-order`'s in built CSS.
 * - A non-placement declaration of a page file is `css-page`'s alone, with its `!important`.
 * - `@import`, `@scope` (and what it holds), `:global()`, `is:global`, `url()` and `style=` are `css-banned`'s. A
 *   viewport unit is `css-banned`'s only when a `var()` brings it: a literal one is `css-literal`'s.
 * - A `<style>` (with its `is:global`), a `<link rel="stylesheet">`, a CSS import, an `import.meta.glob` that can
 *   match a style file, a stray style file, a missing `elements.css` or `fonts.css` and a second `<style>` on a built
 *   page are `css-sources`'s. The elements.css parts of `design-pairs` and `design-specs` skip a missing file. A missing file or a missing import of a component's own file is
 *   `css-component-file`'s.
 *
 * **The import scanner.** One scanner reads the CSS imports of a source text for `css-sources` and
 * `css-component-file`. It lexes the text once, from left to right: comments, strings, template literals (with their
 * `${…}` parts) and regular expression literals. Then it matches `import 'x'`, `… from 'x'`, `import('x')`,
 * `require('x')` and the patterns of `import.meta.glob('x')` and `import.meta.glob(['x', 'y'])` on the tokens. So a commented import does not count, and no regular expression runs on the text.
 */
import type { HTMLElement } from 'node-html-parser';
import { parseHtml } from '../../build.ts';
import type { Report } from '../../registry.ts';
import {
  ANONYMOUS_LAYER,
  type AtRule,
  asciiLower,
  type ComponentValue,
  type CssNode,
  type Declaration,
  layerNames,
  MAX_DEPTH,
  type ParseProblem,
  type Place,
  type Rule,
  type Stylesheet,
  serialize,
  walk,
} from '../parse.ts';
import type {
  Add,
  BuiltCssInput,
  BuiltNode,
  BuiltSheet,
  Component,
  CssSourceFile,
  PageCss,
  SourceCss,
  SourceText,
} from '../rules.ts';
import {
  COMPONENT_CSS_FOLDER,
  cssPlaceOf,
  declarationText,
  ELEMENTS_FILE,
  FONTS_FILE,
  LAYER_ORDER,
  PROJECT_LAYERS,
  pageCssOf,
  ROUTES_FOLDER,
  reportOnce,
  STYLE_EXTENSIONS,
  snippet,
  sourceWhere,
} from '../rules.ts';
import {
  atRuleProblem,
  type ComplexSelector,
  type Compound,
  type CssFile,
  keyframesOwner,
  PLACEMENT_PROPERTIES,
  parseSelector,
  rootCandidates,
  rootComponentOf,
  type ShapeOptions,
  selectorProblems,
  subject,
} from '../selectors.ts';
import { keyframeSelectorProblem, urlsOf, varsOf, viewportWidthUnits } from '../values.ts';

// The import scanner (7.2)

/** One token of a script: a word, a string (a template literal too) or one character of punctuation. */
interface ScriptToken {
  kind: 'word' | 'string' | 'punct';
  value: string;
  /** The offset of the token in the text; for a string, of its first character after the quote. */
  offset: number;
}

/** The words after which a `/` starts a regular expression literal, not a division. */
const REGEX_WORDS: ReadonlySet<string> = new Set([
  'return',
  'typeof',
  'case',
  'do',
  'else',
  'in',
  'of',
  'void',
  'yield',
  'await',
  'delete',
  'new',
  'throw',
]);

/** The punctuation after which a `/` starts a regular expression literal. */
const REGEX_PUNCTUATION = '(,=:[!&|?{};+-*%<>~^';

const isWordStart = (char: string): boolean =>
  (char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z') || char === '_' || char === '$';

const isWordChar = (char: string): boolean => isWordStart(char) || (char >= '0' && char <= '9');

/**
 * The tokens of a script, in one pass. Comments and white space give no token. A quoted string ends at its quote or at
 * the end of its line. A template literal gives one string token, with its `${…}` parts as written; the tokens of
 * those parts follow it. A `/` after an operator or a keyword starts a regular expression literal, which gives no
 * token.
 */
function scriptTokens(text: string): ScriptToken[] {
  const tokens: ScriptToken[] = [];
  /** The open template literals: their token, their start, and the brace depth at their open `${`. */
  const templates: { token: ScriptToken; start: number; depth: number }[] = [];
  let depth = 0;
  let index = 0;

  /** Reads a template literal from `from` (after the backtick or after the `}` of a part). Returns the next index. */
  const template = (from: number, entry: { token: ScriptToken; start: number; depth: number }): number => {
    let at = from;
    while (at < text.length) {
      const char = text.charAt(at);
      if (char === '\\') at += 2;
      else if (char === '`') {
        entry.token.value = text.slice(entry.start, at);
        return at + 1;
      } else if (char === '$' && text.charAt(at + 1) === '{') {
        entry.depth = depth;
        depth += 1;
        templates.push(entry);
        return at + 2;
      } else at += 1;
    }
    entry.token.value = text.slice(entry.start);
    return text.length;
  };

  const regexAllowed = (): boolean => {
    const last = tokens.at(-1);
    if (last === undefined) return true;
    if (last.kind === 'punct') return REGEX_PUNCTUATION.includes(last.value);
    return last.kind === 'word' && REGEX_WORDS.has(last.value);
  };

  while (index < text.length) {
    const char = text.charAt(index);
    const next = text.charAt(index + 1);
    if (char === '/' && next === '/') {
      const end = text.indexOf('\n', index);
      index = end < 0 ? text.length : end;
    } else if (char === '/' && next === '*') {
      const end = text.indexOf('*/', index + 2);
      index = end < 0 ? text.length : end + 2;
    } else if (char === '"' || char === "'") {
      let at = index + 1;
      let value = '';
      while (at < text.length) {
        const inner = text.charAt(at);
        if (inner === char || inner === '\n') break;
        if (inner === '\\') {
          value += text.charAt(at + 1);
          at += 2;
        } else {
          value += inner;
          at += 1;
        }
      }
      tokens.push({ kind: 'string', value, offset: index + 1 });
      index = at + 1;
    } else if (char === '`') {
      const token: ScriptToken = { kind: 'string', value: '', offset: index + 1 };
      tokens.push(token);
      index = template(index + 1, { token, start: index + 1, depth: 0 });
    } else if (char === '/' && regexAllowed()) {
      let at = index + 1;
      let inClass = false;
      while (at < text.length) {
        const inner = text.charAt(at);
        if (inner === '\n') break;
        if (inner === '\\') at += 1;
        else if (inner === '[') inClass = true;
        else if (inner === ']') inClass = false;
        else if (inner === '/' && !inClass) break;
        at += 1;
      }
      index = at + 1;
    } else if (isWordStart(char)) {
      let at = index + 1;
      while (at < text.length && isWordChar(text.charAt(at))) at += 1;
      tokens.push({ kind: 'word', value: text.slice(index, at), offset: index });
      index = at;
    } else if (char === ' ' || char === '\t' || char === '\n' || char === '\r' || char === '\f') {
      index += 1;
    } else if (char === '}' && templates.length > 0 && templates.at(-1)?.depth === depth - 1) {
      depth -= 1;
      const entry = templates.pop();
      index = entry === undefined ? index + 1 : template(index + 1, entry);
    } else {
      if (char === '{') depth += 1;
      else if (char === '}') depth = Math.max(0, depth - 1);
      tokens.push({ kind: 'punct', value: char, offset: index });
      index += 1;
    }
  }
  return tokens;
}

/** A string found by the scanner, with the offset of its first character in the script. */
interface Found {
  value: string;
  offset: number;
}

/** What one pass of the scanner finds in a script. */
interface ScriptScan {
  /** The specifiers that the script imports: static, re-export, dynamic and `require`. */
  specifiers: Found[];
  /** The patterns of each `import.meta.glob(…)`: a string, or each string of an array. */
  globs: Found[];
}

/** The most tokens that the type arguments of `import.meta.glob<…>(…)` may take; more reads as no glob. */
const MAX_TYPE_TOKENS = 64;

/**
 * The patterns of the `import.meta.glob` call whose `glob` word stands at `at`: a string, or an array of strings.
 * Type arguments (`glob<Module>(…)`) are skipped. Any other first argument gives none: Vite refuses it.
 */
function globPatterns(tokens: readonly ScriptToken[], at: number): Found[] {
  let index = at + 1;
  if (tokens[index]?.kind === 'punct' && tokens[index]?.value === '<') {
    let depth = 0;
    const end = Math.min(tokens.length, index + MAX_TYPE_TOKENS);
    for (; index < end; index += 1) {
      const token = tokens[index];
      if (token?.kind !== 'punct') continue;
      if (token.value === '<') depth += 1;
      else if (token.value === '>') depth -= 1;
      if (depth === 0) break;
    }
    if (depth !== 0) return [];
    index += 1;
  }
  const open = tokens[index];
  if (open?.kind !== 'punct' || open.value !== '(') return [];
  const first = tokens[index + 1];
  if (first?.kind === 'string') return [{ value: first.value, offset: first.offset }];
  if (first?.kind !== 'punct' || first.value !== '[') return [];
  const out: Found[] = [];
  for (let item = index + 2; item < tokens.length; item += 1) {
    const token = tokens[item];
    if (token === undefined || (token.kind === 'punct' && token.value === ']')) break;
    if (token.kind === 'string') out.push({ value: token.value, offset: token.offset });
    else if (token.kind !== 'punct' || token.value !== ',') break;
  }
  return out;
}

/** Says whether the tokens before `at` are `import . meta .`: the `glob` word at `at` is `import.meta.glob`. */
const isMetaGlob = (tokens: readonly ScriptToken[], at: number): boolean =>
  tokens[at]?.value === 'glob' &&
  tokens[at - 1]?.kind === 'punct' &&
  tokens[at - 1]?.value === '.' &&
  tokens[at - 2]?.kind === 'word' &&
  tokens[at - 2]?.value === 'meta' &&
  tokens[at - 3]?.kind === 'punct' &&
  tokens[at - 3]?.value === '.' &&
  tokens[at - 4]?.kind === 'word' &&
  tokens[at - 4]?.value === 'import';

/** The specifiers and the glob patterns of a script, from one pass of the lexer. */
function scanScript(text: string): ScriptScan {
  const tokens = scriptTokens(text);
  const specifiers: Found[] = [];
  const globs: Found[] = [];
  tokens.forEach((token, index) => {
    if (token.kind !== 'word') return;
    if (isMetaGlob(tokens, index)) {
      globs.push(...globPatterns(tokens, index));
      return;
    }
    if (tokens[index - 1]?.value === '.' && tokens[index - 1]?.kind === 'punct') return;
    const next = tokens[index + 1];
    const after = tokens[index + 2];
    if ((token.value === 'import' || token.value === 'from') && next?.kind === 'string') {
      specifiers.push({ value: next.value, offset: next.offset });
    } else if (
      (token.value === 'import' || token.value === 'require') &&
      next?.kind === 'punct' &&
      next.value === '(' &&
      after?.kind === 'string'
    ) {
      specifiers.push({ value: after.value, offset: after.offset });
    }
  });
  return { specifiers, globs };
}

/** The characters that make a glob pattern match more than one name (picomatch, which Vite uses). */
const GLOB_CHARACTERS = '*?[]{}()!+@';

/** The most brace groups that `globMatchesStyle` expands in one pattern; a deeper pattern counts as a match. */
const MAX_BRACE_DEPTH = 8;

/** The alternatives of the brace group that ends a pattern, and the text before it; `undefined` when it has none. */
function lastBraceGroup(pattern: string): { before: string; alternatives: string[] } | undefined {
  if (!pattern.endsWith('}')) return undefined;
  let open = -1;
  let depth = 0;
  for (let index = pattern.length - 1; index >= 0 && open < 0; index -= 1) {
    const char = pattern.charAt(index);
    if (char === '}') depth += 1;
    else if (char === '{') {
      depth -= 1;
      if (depth === 0) open = index;
    }
  }
  if (open < 0) return undefined;
  const alternatives: string[] = [];
  let from = open + 1;
  depth = 0;
  for (let index = open + 1; index < pattern.length - 1; index += 1) {
    const char = pattern.charAt(index);
    if (char === '{') depth += 1;
    else if (char === '}') depth -= 1;
    else if (char === ',' && depth === 0) {
      alternatives.push(pattern.slice(from, index));
      from = index + 1;
    }
  }
  alternatives.push(pattern.slice(from, -1));
  return { before: pattern.slice(0, open), alternatives };
}

/**
 * Says whether a glob pattern of `import.meta.glob` can match a style file (`STYLE_EXTENSIONS`). It can, unless its
 * last segment ends in a literal extension that is not a style extension (`./*.ts`), or it is a literal name without
 * an extension. A brace group at the end counts as each of its alternatives (`./*.{js,css}` can). Any other glob
 * character in the extension can match a style extension (`./x.*`, `./x.cs?`), and so can a last segment of glob
 * characters alone (`./*`, `./**`). A negative pattern (`!…`) adds no file.
 */
function globMatchesStyle(pattern: string, depth = 0): boolean {
  if (pattern.startsWith('!')) return false;
  const group = lastBraceGroup(pattern);
  if (group !== undefined) {
    if (depth >= MAX_BRACE_DEPTH) return true;
    return group.alternatives.some((alternative) => globMatchesStyle(`${group.before}${alternative}`, depth + 1));
  }
  const segment = pattern.slice(pattern.lastIndexOf('/') + 1);
  const dot = segment.lastIndexOf('.');
  const hasGlob = (text: string): boolean => [...text].some((char) => GLOB_CHARACTERS.includes(char));
  if (dot < 0) return hasGlob(segment);
  const extension = segment.slice(dot);
  return hasGlob(extension) || STYLE_EXTENSIONS.has(asciiLower(extension));
}

/** One CSS import of a source text. */
interface CssImport {
  /** The specifier as written: `../styles/components/card.css?url`. */
  specifier: string;
  /** The project path it names (`src/styles/components/card.css`), or `undefined` for a bare specifier. */
  resolved: string | undefined;
  line: number;
}

/** A part of a source text that holds script, with the offset of its first character in the text. */
interface ScriptPart {
  text: string;
  base: number;
}

/** The offset where the content of a raw-text element (`<script>`, `<noscript>`) starts in the text. */
function contentStart(text: string, element: HTMLElement): number {
  const [start, end] = element.range;
  const raw = element.rawText;
  const close = `</${asciiLower(element.rawTagName)}>`;
  const guess = end - close.length - raw.length;
  if (asciiLower(text.slice(end - close.length, end)) === close && text.slice(guess, guess + raw.length) === raw) {
    return guess;
  }
  const open = text.indexOf('>', start);
  return open < 0 ? start : open + 1;
}

/** The frontmatter of a source text as a script part. */
function frontmatterPart(source: SourceText): ScriptPart[] {
  const frontmatter = source.frontmatter;
  if (frontmatter === undefined) return [];
  const lineEnd = source.text.indexOf('\n', frontmatter.start);
  return [{ text: frontmatter.text, base: lineEnd < 0 ? frontmatter.start : lineEnd + 1 }];
}

/** Says whether a line opens or closes a fenced code block of Markdown. */
const isFence = (line: string): boolean => {
  const trimmed = line.trimStart();
  return trimmed.startsWith('```') || trimmed.startsWith('~~~');
};

/**
 * The ESM blocks of an `.mdx` body: a block starts at a line that begins with `import` or `export` and ends at a
 * blank line (MDX). Fenced code blocks hold none.
 */
function mdxParts(source: SourceText): ScriptPart[] {
  const parts: ScriptPart[] = [];
  const text = source.text;
  let at = source.frontmatter === undefined ? 0 : source.frontmatter.end;
  let fenced = false;
  let block: number | undefined;
  while (at <= text.length) {
    const next = text.indexOf('\n', at);
    const end = next < 0 ? text.length : next;
    const line = text.slice(at, end);
    if (block !== undefined && line.trim() === '') {
      parts.push({ text: text.slice(block, at), base: block });
      block = undefined;
    } else if (block === undefined) {
      if (isFence(line)) fenced = !fenced;
      else if (!fenced && (line.startsWith('import') || line.startsWith('export'))) block = at;
    }
    if (next < 0) break;
    at = next + 1;
  }
  if (block !== undefined) parts.push({ text: text.slice(block), base: block });
  return parts;
}

/** The index after a quoted string that starts at `at` (its quote): at the closing quote, or at the end of the line. */
function afterString(text: string, at: number): number {
  const quote = text.charAt(at);
  let index = at + 1;
  while (index < text.length) {
    const char = text.charAt(index);
    if (char === '\\') index += 2;
    else if (char === quote) return index + 1;
    else if (char === '\n' && quote !== '`') return index;
    else index += 1;
  }
  return text.length;
}

/**
 * The template expression that starts at the `{` at `at`, as a script part, and the index after its `}`. Braces
 * nest; strings, template literals and comments hold no brace that counts. An expression without its `}` runs to the
 * end of the text.
 */
function expressionAt(text: string, at: number): { part: ScriptPart; next: number } {
  let depth = 1;
  let index = at + 1;
  while (index < text.length) {
    const char = text.charAt(index);
    const next = text.charAt(index + 1);
    if (char === '"' || char === "'" || char === '`') index = afterString(text, index);
    else if (char === '/' && next === '*') {
      const end = text.indexOf('*/', index + 2);
      index = end < 0 ? text.length : end + 2;
    } else if (char === '/' && next === '/') {
      const end = text.indexOf('\n', index);
      index = end < 0 ? text.length : end;
    } else {
      if (char === '{') depth += 1;
      else if (char === '}') {
        depth -= 1;
        if (depth === 0) return { part: { text: text.slice(at + 1, index), base: at + 1 }, next: index + 1 };
      }
      index += 1;
    }
  }
  return { part: { text: text.slice(at + 1), base: at + 1 }, next: text.length };
}

/** The elements whose content is no markup: a `{` there starts no expression. */
const RAW_ELEMENTS: ReadonlySet<string> = new Set(['script', 'style']);

/**
 * The template expressions of the markup of an `.astro` or `.mdx` file (7.2): each `{…}` in text and in an attribute
 * value. Astro and MDX compile them into the module of the file, so an `import()` there attaches CSS as one in the
 * frontmatter does. A `{` inside a quoted attribute value, an HTML comment, the content of `<script>` and `<style>`,
 * or (in `.mdx`) a code block or a code span starts none. `<script>` content is a script part of its own.
 */
function expressionParts(source: SourceText): ScriptPart[] {
  const { text } = source;
  const code = source.kind === 'mdx' ? codeRanges(text) : [];
  const inCode = (offset: number): boolean => code.some(([from, to]) => offset >= from && offset < to);
  const lower = asciiLower(text);
  const parts: ScriptPart[] = [];
  let at = source.frontmatter === undefined ? 0 : source.frontmatter.end;
  while (at < text.length) {
    const char = text.charAt(at);
    if (text.startsWith('<!--', at)) {
      const end = text.indexOf('-->', at + 4);
      at = end < 0 ? text.length : end + 3;
    } else if (char === '{' && !inCode(at)) {
      const found = expressionAt(text, at);
      parts.push(found.part);
      at = found.next;
    } else if (char === '<' && isWordStart(text.charAt(at + 1)) && !inCode(at)) {
      // A start tag: its quoted values hold no expression; an unquoted `{…}` value is one.
      let index = at + 1;
      while (index < text.length && (isWordChar(text.charAt(index)) || text.charAt(index) === '-')) index += 1;
      const name = asciiLower(text.slice(at + 1, index));
      let closed = false;
      while (index < text.length && !closed) {
        const inner = text.charAt(index);
        if (inner === '"' || inner === "'") index = afterString(text, index);
        else if (inner === '{') {
          const found = expressionAt(text, index);
          parts.push(found.part);
          index = found.next;
        } else {
          closed = inner === '>';
          index += 1;
        }
      }
      if (RAW_ELEMENTS.has(name) && text.charAt(index - 2) !== '/') {
        const end = lower.indexOf(`</${name}`, index);
        index = end < 0 ? text.length : end;
      }
      at = index;
    } else at += 1;
  }
  return parts;
}

/**
 * The parts of a source text that can import CSS (7.2). The YAML frontmatter of `.md` and `.mdx` imports nothing:
 * only the ESM blocks and the expressions of an `.mdx` body are script.
 */
function scriptParts(source: SourceText): ScriptPart[] {
  switch (source.kind) {
    case 'astro': {
      const scripts = (source.markup?.querySelectorAll('script') ?? []).map((element) => ({
        text: element.rawText,
        base: contentStart(source.text, element),
      }));
      return [...frontmatterPart(source), ...scripts, ...expressionParts(source)];
    }
    case 'md':
      return [];
    case 'mdx':
      return [...mdxParts(source), ...expressionParts(source)];
    default:
      return [{ text: source.text, base: 0 }];
  }
}

/** The extension of a path in ASCII lower case, with its dot; `''` when its last segment has none. */
function extensionOf(path: string): string {
  const slash = path.lastIndexOf('/');
  const dot = path.lastIndexOf('.');
  return dot <= slash + 1 ? '' : asciiLower(path.slice(dot));
}

/** A path with `.` and `..` segments resolved; `undefined` when it leaves the project. */
function normalizePath(path: string): string | undefined {
  const out: string[] = [];
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      if (out.length === 0) return undefined;
      out.pop();
    } else out.push(segment);
  }
  return out.join('/');
}

/**
 * The CSS file that a specifier names, or `undefined` when it names no style file. A specifier names a style file
 * when its path, without `?…` and `#…`, has an extension of `STYLE_EXTENSIONS` (`./card.css?url` too). A relative
 * specifier resolves against the folder of the importer, a `/src/…` one against the project root. A bare one
 * (`pkg/x.css`, `@/styles/x.css`) names no project file.
 */
function cssTarget(specifier: string, importer: string): { resolved: string | undefined } | undefined {
  const query = specifier.indexOf('?');
  let path = query < 0 ? specifier : specifier.slice(0, query);
  const hash = path.indexOf('#', 1);
  if (hash > 0) path = path.slice(0, hash);
  if (!STYLE_EXTENSIONS.has(extensionOf(path))) return undefined;
  if (path.startsWith('./') || path.startsWith('../')) {
    const folder = importer.slice(0, importer.lastIndexOf('/') + 1);
    return { resolved: normalizePath(`${folder}${path}`) };
  }
  if (path.startsWith('/')) return { resolved: normalizePath(path) };
  return { resolved: undefined };
}

/** The offsets of the line feeds of each source text, found once. */
const LINE_FEEDS = new WeakMap<SourceText, number[]>();

/**
 * The line of an offset in a source text, from 1, as `lineAt` of `../rules.ts` gives it. It finds the line feeds of the
 * text once and then searches them, so many findings in one large file stay fast.
 */
function lineOf(source: SourceText, offset: number): number {
  let feeds = LINE_FEEDS.get(source);
  if (feeds === undefined) {
    feeds = [];
    for (let index = source.text.indexOf('\n'); index >= 0; index = source.text.indexOf('\n', index + 1)) {
      feeds.push(index);
    }
    LINE_FEEDS.set(source, feeds);
  }
  let low = 0;
  let high = feeds.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if ((feeds[middle] ?? 0) < offset) low = middle + 1;
    else high = middle;
  }
  return low + 1;
}

/** One `import.meta.glob` pattern of a source text that can match a style file. */
interface CssGlob {
  pattern: string;
  line: number;
}

/** What the scanner finds in a source text: its CSS imports and its globs of CSS. */
interface CssReferences {
  imports: CssImport[];
  globs: CssGlob[];
}

/** The references of each source text, found once: `css-sources` and `css-component-file` both read them. */
const REFERENCES = new WeakMap<SourceText, CssReferences>();

/** Every CSS import and every glob of CSS of a source text (7.2), from one pass over each of its script parts. */
function cssReferencesOf(source: SourceText): CssReferences {
  const known = REFERENCES.get(source);
  if (known !== undefined) return known;
  const imports: CssImport[] = [];
  const globs: CssGlob[] = [];
  for (const part of scriptParts(source)) {
    const scan = scanScript(part.text);
    for (const found of scan.specifiers) {
      const target = cssTarget(found.value, source.path);
      if (target === undefined) continue;
      imports.push({
        specifier: found.value,
        resolved: target.resolved,
        line: lineOf(source, part.base + found.offset),
      });
    }
    for (const found of scan.globs) {
      if (globMatchesStyle(found.value))
        globs.push({ pattern: found.value, line: lineOf(source, part.base + found.offset) });
    }
  }
  const references = { imports, globs };
  REFERENCES.set(source, references);
  return references;
}

/** Every CSS import of a source text (7.2). */
const cssImportsOf = (source: SourceText): CssImport[] => cssReferencesOf(source).imports;

// Markup

/** An element of a source text, with its offset in the text. */
export interface MarkupElement {
  element: HTMLElement;
  offset: number;
}

/**
 * The fenced code blocks and code spans of a Markdown text, as offset ranges: a `<style>` there is an example, not
 * markup. A code span is a run of backticks up to the next run on the same line.
 */
function codeRanges(text: string): [number, number][] {
  const ranges: [number, number][] = [];
  let at = 0;
  let fence: number | undefined;
  while (at <= text.length) {
    const next = text.indexOf('\n', at);
    const end = next < 0 ? text.length : next;
    const line = text.slice(at, end);
    if (isFence(line)) {
      if (fence === undefined) fence = at;
      else {
        ranges.push([fence, end]);
        fence = undefined;
      }
    } else if (fence === undefined) {
      let open: number | undefined;
      for (let index = line.indexOf('`'); index >= 0; index = line.indexOf('`', index + 1)) {
        if (open === undefined) open = index;
        else {
          ranges.push([at + open, at + index]);
          open = undefined;
        }
      }
    }
    if (next < 0) break;
    at = next + 1;
  }
  if (fence !== undefined) ranges.push([fence, text.length]);
  return ranges;
}

/**
 * The elements of the markup of a source text that `keep` accepts, those inside `<noscript>` too, with their offsets.
 * In `.md` and `.mdx`, an element inside a fenced code block or a code span does not count. `keep` runs first, so the
 * work for each element stays small.
 */
export function markupElements(source: SourceText, keep: (element: HTMLElement) => boolean): MarkupElement[] {
  if (source.markup === undefined) return [];
  const out: MarkupElement[] = [];
  for (const element of source.markup.querySelectorAll('*')) {
    if (keep(element)) out.push({ element, offset: element.range[0] });
    if (asciiLower(element.rawTagName) !== 'noscript') continue;
    const start = contentStart(source.text, element);
    for (const inner of parseHtml(element.rawText).querySelectorAll('*')) {
      if (keep(inner)) out.push({ element: inner, offset: start + inner.range[0] });
    }
  }
  if (out.length === 0 || (source.kind !== 'md' && source.kind !== 'mdx')) return out;
  const code = codeRanges(source.text);
  return out.filter(({ offset }) => !code.some(([from, to]) => offset >= from && offset < to));
}

/** The tag name of an element in ASCII lower case. */
const tagOf = (element: HTMLElement): string => asciiLower(element.rawTagName ?? '');

/** Says whether an element is a `<link>` whose `rel` holds the token `stylesheet` (ASCII case-insensitive). */
function isStylesheetLink(element: HTMLElement): boolean {
  if (tagOf(element) !== 'link') return false;
  const rel = element.getAttribute('rel') ?? '';
  return rel.split(/[\t\n\f\r ]+/).some((token) => asciiLower(token) === 'stylesheet');
}

/** The value of an attribute by its name in ASCII lower case, or `undefined`. */
function attributeOf(element: HTMLElement, name: string): string | undefined {
  for (const [key, value] of Object.entries(element.attributes)) if (asciiLower(key) === name) return value;
  return undefined;
}

/** The markup kinds of 7.2: `<style>` and `<link rel="stylesheet">` fail in each. */
const MARKUP_KINDS: ReadonlySet<string> = new Set(['astro', 'md', 'mdx', 'tsx', 'jsx']);

// Selectors

/** A selector of one compound, for `subject`, which puts each `:is()` of one compound into its compound. */
const alone = (compound: Compound): ComplexSelector => ({
  leading: undefined,
  compounds: [compound],
  combinators: [],
  place: compound.place,
});

/** The first compound of a selector with each `:is()` of one compound put into it (the minifier's form). */
const firstCompound = (selector: ComplexSelector): Compound | undefined => {
  const first = selector.compounds[0];
  return first === undefined ? undefined : subject(alone(first));
};

/** The type selectors that name the element of a compound inside a `:not()` (the lead decision of 7.1). */
function subjectTypes(selector: ComplexSelector, sink: ParseProblem[], depth: number): void {
  const last = subject(selector);
  if (last === undefined) return;
  if (last.type !== undefined && last.type !== '*') {
    sink.push({
      message: `the type selector \`${last.type}\` inside \`:not()\` of the root compound`,
      place: last.place,
    });
  }
  if (depth >= MAX_DEPTH) return;
  for (const pseudo of last.pseudoClasses) {
    if (pseudo.name !== 'not' && pseudo.name !== 'is' && pseudo.name !== 'where') continue;
    for (const inner of pseudo.selectors ?? []) subjectTypes(inner, sink, depth + 1);
  }
}

/**
 * Says whether a compound is the element of the root of `component`: it holds the root class, or an argument of its
 * `:is()` or `:where()` is one compound that is that element (`:where(.card)`, `:is(.card, .card)`).
 */
function isRootElement(compound: Compound, component: string, depth: number): boolean {
  if (compound.classes.some((item) => item.name === component)) return true;
  if (depth >= MAX_DEPTH) return false;
  return compound.pseudoClasses.some(
    (pseudo) =>
      (pseudo.name === 'is' || pseudo.name === 'where') &&
      (pseudo.selectors ?? []).some((inner) => {
        const [only, ...rest] = inner.compounds;
        return only !== undefined && rest.length === 0 && isRootElement(only, component, depth + 1);
      }),
  );
}

/**
 * 7.1: in a component file, a type inside the `:not()` of the root compound says which element the root is not, so it
 * fails as a type in the root compound does: `.card:not(div)` and `:where(.card):not(div)` fail, `.card
 * .card__body:not(div)` passes. The type counts where it names the element of the `:not()` argument: the last
 * compound of each argument, also through a nested `:not()`, `:is()` or `:where()`. An argument of `:is()` or
 * `:where()` with one compound is the same element; one with more compounds stands for a selector of its own, whose
 * first compound is the root compound (7.1). A type inside `:has()` names another element (`.card:has(img)` passes).
 * `selectors.ts` accepts such a type, so this module adds the problem.
 */
function rootNotProblems(selector: ComplexSelector, component: string, depth = 0): ParseProblem[] {
  const first = firstCompound(selector);
  if (first === undefined || depth >= MAX_DEPTH || !rootCandidates(first).includes(component)) return [];
  const root = isRootElement(first, component, 0);
  const sink: ParseProblem[] = [];
  const visit = (compound: Compound, level: number): void => {
    if (level >= MAX_DEPTH) return;
    for (const pseudo of compound.pseudoClasses) {
      if (pseudo.name === 'not') {
        if (root) for (const inner of pseudo.selectors ?? []) subjectTypes(inner, sink, level + 1);
      } else if (pseudo.name === 'is' || pseudo.name === 'where') {
        for (const inner of pseudo.selectors ?? []) {
          const [only, ...rest] = inner.compounds;
          if (only !== undefined && rest.length === 0) visit(only, level + 1);
          else sink.push(...rootNotProblems(inner, component, depth + level + 1));
        }
      }
    }
  };
  visit(first, depth);
  return sink;
}

/** Every problem of `css-selector` for one parsed selector: `selectorProblems` and the lead decision of 7.1. */
function shapeOf(selector: ComplexSelector, file: CssFile, shape: ShapeOptions): ParseProblem[] {
  const problems = selectorProblems(selector, file, shape);
  if (file.kind === 'component') problems.push(...rootNotProblems(selector, file.component));
  return problems;
}

/** Says whether a node stands inside an `@scope` rule: `css-banned` reports the rule, no other rule reads it. */
const inScope = (atRules: readonly AtRule[]): boolean => atRules.some((rule) => rule.name === 'scope');

/** The at-rules that `css-banned` reports wherever they stand. */
const BANNED_AT_RULES: ReadonlySet<string> = new Set(['import', 'scope']);

// Built CSS

/** One fact of a built sheet, reported on each page that holds the sheet. */
type Fact = string;

/**
 * Reports the facts of every page, with the page path as `where`. A sheet is shared by many pages, so its facts are
 * computed once.
 */
function reportPages(input: BuiltCssInput, add: Add, id: string, facts: (sheet: BuiltSheet) => Fact[]): void {
  const cache = new Map<BuiltSheet, Fact[]>();
  for (const page of input.pages) {
    for (const sheet of page.sheets) {
      let found = cache.get(sheet);
      if (found === undefined) {
        found = facts(sheet);
        cache.set(sheet, found);
      }
      for (const fact of found) add(id, page.path, fact);
    }
  }
}

/**
 * The findings of a source half: one finding for each place (section 8, Where), with the details of its facts joined.
 * Two facts on one line, or a selector with two problems, give one finding.
 */
function sourceFindings(report: Report): { add: Add; flush: () => void } {
  const places = new Map<string, { id: string; where: string; details: string[] }>();
  const add: Add = (id, where, detail) => {
    const key = JSON.stringify([id, where]);
    let entry = places.get(key);
    if (entry === undefined) {
      entry = { id, where, details: [] };
      places.set(key, entry);
    }
    if (detail !== undefined && !entry.details.includes(detail)) entry.details.push(detail);
  };
  const flush = (): void => {
    const once = reportOnce(report);
    for (const { id, where, details } of places.values()) {
      once(id, where, details.length === 0 ? undefined : snippet(details.join('; ')));
    }
  };
  return { add, flush };
}

/** A rule's selector as a detail: `.card .box`. */
const selectorText = (values: readonly ComponentValue[]): string => snippet(serialize(values));

/** An at-rule as a detail: `@media (width>=48rem)`. */
const atRuleText = (rule: AtRule): string =>
  snippet(rule.prelude.length === 0 ? `@${rule.name}` : `@${rule.name} ${serialize(rule.prelude)}`);

// css-sources

/**
 * `css-sources`, source half: style files, `<style>`, `<link rel="stylesheet">`, CSS imports and globs of CSS under
 * `src/`, `.css` in `public/`, and a missing `elements.css` or `fonts.css`.
 */
export function checkCssSources(input: SourceCss, report: Report): void {
  const { add, flush } = sourceFindings(report);
  const id = 'css-sources';
  // CSS exists only at the places of 7.1: every other style file fails.
  for (const path of input.stray) add(id, path, 'a style file outside the places of 7.1');
  const components = new Map<string, Component>(input.components.map((component) => [component.path, component]));
  for (const source of input.sources) {
    // No `<style>` and no `<link rel="stylesheet">` in markup (7.2).
    if (MARKUP_KINDS.has(source.kind)) {
      const keep = (element: HTMLElement): boolean => tagOf(element) === 'style' || isStylesheetLink(element);
      for (const { element, offset } of markupElements(source, keep)) {
        const where = sourceWhere(source.path, { line: lineOf(source, offset) });
        const detail =
          tagOf(element) === 'style'
            ? '<style>'
            : `<link rel="stylesheet" href="${element.getAttribute('href') ?? ''}">`;
        add(id, where, detail);
      }
    }
    // A component imports only its own file, a route only its page file, anything else none (7.2).
    const own =
      components.get(source.path)?.css ?? (source.path.startsWith(ROUTES_FOLDER) ? pageCssOf(source.path) : undefined);
    const references = cssReferencesOf(source);
    for (const found of references.imports) {
      if (found.resolved !== undefined && found.resolved === own) continue;
      add(id, sourceWhere(source.path, { line: found.line }), `import '${found.specifier}'`);
    }
    // A glob of CSS is no static import: the kit cannot see what it loads (7.2).
    for (const found of references.globs) {
      add(id, sourceWhere(source.path, { line: found.line }), `import.meta.glob('${found.pattern}')`);
    }
  }
  // The kit imports `elements.css` and `fonts.css` into every page (6.1, step 9), so both exist (7.2). A file that
  // exists but is not read (`unread`) is `config-suppression`'s, and a missing `tokens.css` is `design-tokens`'s.
  for (const path of [ELEMENTS_FILE, FONTS_FILE]) {
    if (!input.files.some((file) => file.path === path) && !input.unread.includes(path)) {
      add(id, path, 'the file is missing: the kit imports it into every page');
    }
  }
  flush();
}

/** Says whether a built sheet is Astro's island style and nothing else (7.1). */
const isIslandSheet = (sheet: BuiltSheet): boolean =>
  sheet.sheet.nodes.length > 0 && sheet.sheet.nodes.every((node) => node.type === 'rule' && isAstroIslandRule(node));

/** Says whether a built sheet holds a top-level `@import`: Astro gives such a chunk a `<style>` of its own (7.2). */
const holdsImport = (sheet: BuiltSheet): boolean =>
  sheet.sheet.nodes.some((node) => node.type === 'at-rule' && node.name === 'import');

/**
 * `css-sources`, built half: no `<link rel="stylesheet">` in built HTML, and one `<style>` of project CSS on each page
 * (7.2: `inlineStylesheets: 'always'` merges the CSS of a page into one). Astro's island style, a chunk with an
 * `@import` (`css-banned`'s) and a sheet with a fact of `css-layer-order` (an unlayered rule, a parse problem) do not
 * count. So a layered `<style>` that markup builds at render time, which the source half cannot read (`set:html`),
 * fails here.
 */
export function auditCssSources(input: BuiltCssInput, report: Report): void {
  const add = reportOnce(report);
  /** Whether a sheet counts as a `<style>` of project CSS, found once for each sheet: pages share sheets. */
  const counts = new Map<BuiltSheet, boolean>();
  const countsOf = (sheet: BuiltSheet): boolean => {
    let found = counts.get(sheet);
    if (found === undefined) {
      found = !isIslandSheet(sheet) && !holdsImport(sheet) && layerFacts(sheet).length === 0;
      counts.set(sheet, found);
    }
    return found;
  };
  for (const page of input.pages) {
    for (const element of page.elements) {
      if (isStylesheetLink(element))
        add('css-sources', page.path, `<link rel="stylesheet" href="${element.getAttribute('href') ?? ''}">`);
    }
    if (page.sheets.length < 2) continue;
    const sheets = page.sheets.filter(countsOf);
    for (const sheet of sheets.slice(1)) add('css-sources', page.path, snippet(`a second <style>: ${sheet.text}`));
  }
}

// css-layer-file

/** Says whether a top-level node is `css-banned`'s alone: `@import` and `@scope`. */
const isBannedAtRule = (node: CssNode): boolean => node.type === 'at-rule' && BANNED_AT_RULES.has(node.name);

/** A top-level node as a detail. */
function nodeText(node: CssNode): string {
  if (node.type === 'at-rule') return atRuleText(node);
  if (node.type === 'rule') return selectorText(node.prelude);
  return declarationText(node);
}

/** Says whether a node is the layer block of the file: `@layer <layer> { … }`. */
const isLayerBlock = (node: CssNode, layer: string): boolean =>
  node.type === 'at-rule' &&
  node.name === 'layer' &&
  node.block !== undefined &&
  layerNames(node)?.length === 1 &&
  layerNames(node)?.[0] === layer;

/** `css-layer-file`: each project CSS file is one block of its layer; `fonts.css` holds only `@font-face`; parse problems. */
export function checkCssLayerFile(input: SourceCss, report: Report): void {
  const { add, flush } = sourceFindings(report);
  const id = 'css-layer-file';
  for (const file of input.files) {
    // `tokens.css` is left to `design-tokens` (spec row).
    if (file.kind === 'tokens') continue;
    // A parse problem of a project CSS file fails this rule (lead decision; 3.2).
    for (const problem of file.sheet.problems) add(id, sourceWhere(file.path, problem.place), problem.message);
    const nodes = file.sheet.nodes.filter((node) => !isBannedAtRule(node));
    if (file.kind === 'fonts') {
      // `fonts.css` holds only `@font-face` rules, outside any layer (7.2). An empty file passes.
      for (const node of nodes) {
        if (node.type !== 'at-rule' || node.name !== 'font-face') {
          add(id, sourceWhere(file.path, node.place), `${nodeText(node)} is no \`@font-face\` rule`);
        }
      }
    } else {
      // Exactly one top-level `@layer <its layer> { … }` (7.1).
      const layer = file.layer ?? '';
      if (nodes.length === 0) add(id, file.path, `the file holds no \`@layer ${layer} { … }\` block`);
      const block = nodes.findIndex((node) => isLayerBlock(node, layer));
      nodes.forEach((node, index) => {
        if (index === block) return;
        const what =
          block < 0
            ? `${nodeText(node)} instead of \`@layer ${layer} { … }\``
            : `${nodeText(node)} outside the \`@layer ${layer}\` block`;
        add(id, sourceWhere(file.path, node.place), what);
      });
    }
    // No nested `@layer`, block or statement (7.1).
    walk(file.sheet, (node, context) => {
      if (node.type === 'at-rule' && node.name === 'layer' && context.atRules.length > 0) {
        add(id, sourceWhere(file.path, node.place), `the nested ${atRuleText(node)}`);
      }
    });
  }
  flush();
}

// css-layer-order

/** The at-rules that wrap rules without a cascade meaning of their own: their content is checked, not they. */
const WRAPPERS: ReadonlySet<string> = new Set(['layer', 'media', 'supports', 'container', 'starting-style']);

/** The at-rules that may stand unlayered (7.1): `@font-face` and the kit's `@view-transition`. */
const UNLAYERED_AT_RULES: ReadonlySet<string> = new Set(['font-face', 'view-transition']);

/** The elements of Astro's island style. */
const ASTRO_ISLAND_TYPES: ReadonlySet<string> = new Set(['astro-island', 'astro-slot', 'astro-static-slot']);

/**
 * Says whether a rule is Astro's island style: `astro-island,astro-slot,astro-static-slot{display:contents}`. Astro
 * writes it unlayered, in a `<style>` of its own, on every page with an island (9.2). It selects only Astro's own
 * elements and sets only `display: contents`, so it is accepted as part of Astro's CSS.
 */
function isAstroIslandRule(rule: Rule): boolean {
  const types = rule.selectors.every((selector) => {
    const only = selector.length === 1 ? selector[0] : undefined;
    return only?.type === 'ident' && ASTRO_ISLAND_TYPES.has(asciiLower(only.value));
  });
  const display = rule.children.every(
    (child) =>
      child.type === 'declaration' &&
      child.property === 'display' &&
      !child.important &&
      asciiLower(serialize(child.value)) === 'contents',
  );
  return rule.selectors.length > 0 && rule.children.length > 0 && types && display;
}

/** The full names of the layers that an `@layer` rule names, inside the layer `outer`. */
function namesOf(rule: AtRule, outer: string | undefined): string[] {
  const names = layerNames(rule) ?? [];
  const own = rule.block !== undefined && names.length === 0 ? [ANONYMOUS_LAYER] : names;
  return own.map((name) => (outer === undefined ? name : `${outer}.${name}`));
}

/** The facts of `css-layer-order` that a sheet holds: nested layers, unlayered rules, parse problems. */
function layerFacts(sheet: BuiltSheet): Fact[] {
  const facts: Fact[] = [];
  for (const item of sheet.nodes) {
    const { node, atRules, layer } = item;
    if (inScope(atRules) || isBannedAtRule(node)) continue;
    if (node.type === 'at-rule' && node.name === 'layer') {
      // A sub-layer other than `astro.*`, an anonymous layer, and a layer named below the top level fail. An unknown
      // name at the top level shows in the layer order.
      for (const name of namesOf(node, layer)) {
        const bad = name.includes('.') ? !name.startsWith('astro.') : name === ANONYMOUS_LAYER || atRules.length > 0;
        if (bad) facts.push(`the layer \`${name}\``);
      }
      continue;
    }
    if (layer !== undefined || node.type === 'declaration') continue;
    // An unlayered node: only `@font-face` and `@view-transition` may stand there. Wrappers report their content,
    // and the content of a reported rule is part of it.
    if (atRules.some((rule) => !WRAPPERS.has(rule.name)) || item.rule !== undefined) continue;
    if (node.type === 'rule') {
      if (!isAstroIslandRule(node)) facts.push(`the unlayered rule \`${selectorText(node.prelude)}\``);
    } else if (!WRAPPERS.has(node.name) && !UNLAYERED_AT_RULES.has(node.name)) {
      facts.push(`the unlayered ${atRuleText(node)}`);
    }
  }
  // A parse problem of built CSS fails this rule (lead decision).
  for (const problem of sheet.sheet.problems) {
    facts.push(`${problem.message} (${problem.place.line}:${problem.place.column})`);
  }
  return facts;
}

/** The layer order of a page with each `astro.*` name read as `astro`, repeats dropped (13.1 item 3). */
function foldedOrder(page: PageCss): string[] {
  const out: string[] = [];
  for (const name of page.layerOrder) {
    const folded = name.startsWith('astro.') ? 'astro' : name;
    if (!out.includes(folded)) out.push(folded);
  }
  return out;
}

/** `css-layer-order`: the built layer order of each page, unlayered rules and parse problems of built CSS. */
export function auditCssLayerOrder(input: BuiltCssInput, report: Report): void {
  const add = reportOnce(report);
  const id = 'css-layer-order';
  const expected = LAYER_ORDER.join(', ');
  for (const page of input.pages) {
    const order = foldedOrder(page).join(', ');
    if (order !== expected) add(id, page.path, order === '' ? 'no layer order' : `the layer order ${order}`);
  }
  reportPages(input, add, id, layerFacts);
}

// css-component-file

/** Says whether a parsed sheet holds a style rule whose first compound holds the class `.<kebab>`. */
function hasRootClass(sheet: Stylesheet, kebab: string): boolean {
  let found = false;
  walk(sheet, (node) => {
    if (found || node.type !== 'rule' || node.kind !== 'style') return;
    for (const values of node.resolved) {
      const { selector } = parseSelector(values);
      const first = selector === undefined ? undefined : firstCompound(selector);
      if (first !== undefined && rootCandidates(first).includes(kebab)) found = true;
    }
  });
  return found;
}

/** `css-component-file`: each component has its file with its root class and imports it; names are unique. */
export function checkCssComponentFile(input: SourceCss, report: Report): void {
  const { add, flush } = sourceFindings(report);
  const id = 'css-component-file';
  const files = new Map<string, CssSourceFile>(input.files.map((file) => [file.path, file]));
  const unread = new Set(input.unread);
  const sources = new Map<string, SourceText>(input.sources.map((source) => [source.path, source]));
  const first = new Map<string, string>();
  for (const component of input.components) {
    const { kebab, css } = component;
    if (kebab === undefined || css === undefined) {
      add(id, component.path, `the name \`${component.name}\` is not PascalCase`);
      continue;
    }
    // Names are unique across folders (7.8).
    const earlier = first.get(kebab);
    if (earlier !== undefined) add(id, component.path, `the name of ${earlier}`);
    else first.set(kebab, component.path);
    // The component has its file, with its root class (7.8).
    const file = files.get(css);
    if (file === undefined && !unread.has(css)) add(id, component.path, `no ${css}`);
    else if (file !== undefined && !hasRootClass(file.sheet, kebab)) add(id, css, `no root class \`.${kebab}\``);
    // The component imports its file (7.2).
    const source = sources.get(component.path);
    if (source !== undefined && !cssImportsOf(source).some((found) => found.resolved === css)) {
      add(id, component.path, `no import of ${css}`);
    }
  }
  // Each component file has its component (7.8).
  const paths = [
    ...input.files.filter((file) => file.kind === 'component').map((file) => file.path),
    ...input.unread.filter((path) => cssPlaceOf(path)?.kind === 'component'),
  ].sort();
  for (const path of paths) {
    const name = path.slice(COMPONENT_CSS_FOLDER.length, -'.css'.length);
    if (!first.has(name)) add(id, path, `no component \`${name}\``);
  }
  flush();
}

// css-selector

/** The problems of `css-selector` in the nodes of one file or one layer: selectors, keyframe selectors, at-rules. */
function selectorNodeProblems(node: CssNode, file: CssFile, shape: ShapeOptions): ParseProblem[] {
  if (node.type === 'at-rule') {
    const problem = atRuleProblem(node, file);
    return problem === undefined ? [] : [problem];
  }
  if (node.type !== 'rule') return [];
  if (node.kind === 'keyframe') {
    return node.selectors.flatMap((selector) => {
      const problem = keyframeSelectorProblem(selector, node.place);
      return problem === undefined ? [] : [problem];
    });
  }
  // A resolved selector shares the values of its parent (`&`, or the parent of a relative selector), so a problem
  // there has the place of the parent rule. It stands at the rule's own prelude instead (section 8, Where).
  const own = (problem: ParseProblem): ParseProblem =>
    problem.place.offset < node.place.offset ? { ...problem, place: node.place } : problem;
  return node.resolved.flatMap((values) => {
    const parsed = parseSelector(values);
    return (parsed.selector === undefined ? [parsed.problem] : shapeOf(parsed.selector, file, shape)).map(own);
  });
}

/** `css-selector`, source half: the selector and at-rule shapes of 7.1, 7.9 and 7.11 in each project CSS file. */
export function checkCssSelector(input: SourceCss, report: Report): void {
  const { add, flush } = sourceFindings(report);
  for (const file of input.files) {
    const shape = file.shape;
    if (shape === undefined) continue;
    // Only what stands inside a layer block: the top level of a file is css-layer-file's.
    walk(file.sheet, (node, context) => {
      if (context.layer === undefined || inScope(context.atRules)) return;
      for (const problem of selectorNodeProblems(node, shape, input.shape)) {
        add('css-selector', sourceWhere(file.path, problem.place), problem.message);
      }
    });
  }
  flush();
}

/**
 * The file kind of a node of built CSS (7.1): from its layer. In `components`, the component of the root that the
 * first compound of the selector holds (a root class or a modifier); `undefined` when it holds none. A `@keyframes`
 * belongs to the component of its name, and any other at-rule to no component in particular.
 */
function builtFile(item: BuiltNode, selector: ComplexSelector | undefined, shape: ShapeOptions): CssFile | undefined {
  if (item.kitLayer === 'elements') return { kind: 'elements' };
  if (item.kitLayer === 'page') return { kind: 'page' };
  const { node } = item;
  if (node.type === 'at-rule') {
    const name = node.prelude[0];
    const owner =
      node.name === 'keyframes' && name?.type === 'ident' ? keyframesOwner(name.value, shape.components) : undefined;
    return { kind: 'component', component: owner ?? '' };
  }
  const owner = selector === undefined ? undefined : rootComponentOf(selector, shape.components);
  return owner === undefined ? undefined : { kind: 'component', component: owner };
}

/** The facts of built `css-selector` in one sheet. */
function selectorFacts(sheet: BuiltSheet, shape: ShapeOptions): Fact[] {
  const facts: Fact[] = [];
  for (const item of sheet.nodes) {
    const { node } = item;
    if (item.kitLayer === undefined || !PROJECT_LAYERS.has(item.kitLayer) || inScope(item.atRules)) continue;
    if (node.type === 'rule' && node.kind === 'style') {
      for (const values of node.resolved) {
        const text = selectorText(values);
        const parsed = parseSelector(values);
        if (parsed.selector === undefined) {
          facts.push(`${text}: ${parsed.problem.message}`);
          continue;
        }
        const file = builtFile(item, parsed.selector, shape);
        if (file === undefined) {
          facts.push(`${text}: the selector starts at no component root`);
          continue;
        }
        const problems = shapeOf(parsed.selector, file, shape);
        if (problems.length > 0) facts.push(`${text}: ${problems.map((problem) => problem.message).join('; ')}`);
      }
    } else if (node.type === 'at-rule' || node.type === 'rule') {
      const file = builtFile(item, undefined, shape) ?? { kind: 'elements' };
      const text = node.type === 'at-rule' ? atRuleText(node) : selectorText(node.prelude);
      for (const problem of selectorNodeProblems(node, file, shape)) facts.push(`${text}: ${problem.message}`);
    }
  }
  return facts;
}

/** `css-selector`, built half: the same shapes in the project layers of built CSS. */
export function auditCssSelector(input: BuiltCssInput, report: Report): void {
  const add = reportOnce(report);
  reportPages(input, add, 'css-selector', (sheet) => selectorFacts(sheet, input.source.shape));
}

// css-page

/** Says whether a declaration is a placement declaration of 7.9. */
const isPlacement = (declaration: Declaration): boolean => PLACEMENT_PROPERTIES.has(asciiLower(declaration.property));

/** `css-page`, source half: page files hold only the placement properties of 7.9. */
export function checkCssPage(input: SourceCss, report: Report): void {
  const { add, flush } = sourceFindings(report);
  for (const file of input.files) {
    if (file.kind !== 'page') continue;
    walk(file.sheet, (node) => {
      if (node.type === 'declaration' && !isPlacement(node)) {
        add('css-page', sourceWhere(file.path, node.place), declarationText(node));
      }
    });
  }
  flush();
}

/** `css-page`, built half: the `page` layer holds only the placement properties of 7.9. */
export function auditCssPage(input: BuiltCssInput, report: Report): void {
  const add = reportOnce(report);
  reportPages(input, add, 'css-page', (sheet) =>
    sheet.nodes.flatMap(({ node, kitLayer }) =>
      kitLayer === 'page' && node.type === 'declaration' && !isPlacement(node) ? [declarationText(node)] : [],
    ),
  );
}

// css-banned

/** The properties where `hidden` and `clip` fail on `html`, `body` and `:root`. */
const OVERFLOW_PROPERTIES: ReadonlySet<string> = new Set(['overflow', 'overflow-x', 'overflow-inline']);

/** The types on which an overflow `hidden` or `clip` fails. */
const ROOT_TYPES: ReadonlySet<string> = new Set(['html', 'body']);

/** The places of every `:global()` in the values of a selector, at any depth. */
function globalPlaces(values: readonly ComponentValue[], out: Place[], depth = 0): void {
  if (depth >= MAX_DEPTH) return;
  values.forEach((value, index) => {
    if (value.type !== 'function') return;
    if (value.name === 'global' && values[index - 1]?.type === 'colon') out.push(value.place);
    globalPlaces(value.args, out, depth + 1);
  });
}

/**
 * Says whether a subject compound selects `html`, `body` or `:root`: by its type, by `:root`, or through an argument
 * of `:is()` or `:where()`, whose last compound is the same element (7.1). `:is(html, body)` and `:where(body)` select
 * them too.
 */
function namesRoot(compound: Compound, depth: number): boolean {
  if (compound.type !== undefined && ROOT_TYPES.has(compound.type)) return true;
  if (compound.pseudoClasses.some((pseudo) => pseudo.name === 'root')) return true;
  if (depth >= MAX_DEPTH) return false;
  return compound.pseudoClasses.some(
    (pseudo) =>
      (pseudo.name === 'is' || pseudo.name === 'where') &&
      (pseudo.selectors ?? []).some((inner) => {
        const last = subject(inner);
        return last !== undefined && namesRoot(last, depth + 1);
      }),
  );
}

/** Says whether a rule selects `html`, `body` or `:root` as its subject, in one of its resolved selectors. */
function selectsRoot(rule: Rule | undefined): boolean {
  if (rule === undefined || rule.kind !== 'style') return false;
  return rule.resolved.some((values) => {
    const selector = parseSelector(values).selector;
    const compound = selector === undefined ? undefined : subject(selector);
    return compound !== undefined && namesRoot(compound, 0);
  });
}

/** One banned construct: its place and its detail. */
interface Banned {
  place: Place;
  detail: string;
}

/** What a declaration context needs for the banned values. */
interface ValueScope {
  /** The value of a custom property: a token or a definition of the same CSS. */
  lookup: (name: string) => readonly ComponentValue[] | undefined;
  /** True when the value checks apply (not a non-placement declaration of a page file: css-page's). */
  values: boolean;
  /** True when `!important` fails here (the project layers). */
  important: boolean;
}

/** The banned values of one declaration (css-banned): viewport units, forced colors, overflow, `!important`, `url()`. */
function bannedValues(
  declaration: Declaration,
  atRules: readonly AtRule[],
  rule: Rule | undefined,
  scope: ValueScope,
): Banned[] {
  const out: Banned[] = [];
  const text = declarationText(declaration);
  // A non-placement declaration of a page file is `css-page`'s alone, its `!important` too (spec row).
  if (!scope.values) return out;
  if (scope.important && declaration.important) out.push({ place: declaration.place, detail: text });
  // A viewport unit that the declaration writes is a literal: `css-literal`'s. This rule reads the units that a
  // `var()` brings, after token substitution (spec row, drift 24).
  const vars = new Set(varsOf(declaration.value).map((use) => use.place.offset));
  for (const place of viewportWidthUnits(declaration, scope.lookup)) {
    if (vars.has(place.offset)) out.push({ place, detail: text });
  }
  const property = asciiLower(declaration.property);
  const idents = declaration.value.flatMap((value) => (value.type === 'ident' ? [asciiLower(value.value)] : []));
  if (property === 'forced-color-adjust' && idents.includes('none'))
    out.push({ place: declaration.place, detail: text });
  // The `overflow` shorthand sets `overflow-x` with its first value: only that one counts (the row leaves out the
  // block axis). `overflow-x` and `overflow-inline` have one value.
  const axis = idents[0];
  if (OVERFLOW_PROPERTIES.has(property) && (axis === 'hidden' || axis === 'clip') && selectsRoot(rule)) {
    out.push({ place: declaration.place, detail: text });
  }
  if (!atRules.some((item) => item.name === 'font-face')) {
    for (const place of urlsOf(declaration.value)) out.push({ place, detail: text });
  }
  return out;
}

/**
 * The custom properties that a CSS text defines, by name: the values of every definition of each, one after the
 * other. A modifier, a state or an `@media` block may set a local again (7.3), and css-banned asks only whether one
 * of these values brings a viewport unit.
 */
function definitionsOf(nodes: readonly { node: CssNode }[]): Map<string, ComponentValue[]> {
  const out = new Map<string, ComponentValue[]>();
  for (const { node } of nodes) {
    if (node.type !== 'declaration' || !node.property.startsWith('--')) continue;
    const values = out.get(node.property) ?? [];
    values.push(...node.value);
    out.set(node.property, values);
  }
  return out;
}

/** The kinds of project file whose declarations css-banned reads, and whether `!important` fails there. */
const IMPORTANT_KINDS: ReadonlySet<string> = new Set(['elements', 'component', 'page']);

/** Every banned construct of a project CSS file. */
function bannedInFile(file: CssSourceFile, input: SourceCss): Banned[] {
  const out: Banned[] = [];
  const nodes: { node: CssNode }[] = [];
  walk(file.sheet, (node) => {
    nodes.push({ node });
  });
  const own = definitionsOf(nodes);
  const lookup = (name: string): readonly ComponentValue[] | undefined =>
    own.get(name) ?? input.tokens?.get(name)?.value;
  walk(file.sheet, (node, context) => {
    if (node.type === 'at-rule') {
      if (BANNED_AT_RULES.has(node.name)) out.push({ place: node.place, detail: atRuleText(node) });
    } else if (inScope(context.atRules)) {
      // What `@scope` holds is part of the banned `@scope`, as in built CSS.
    } else if (node.type === 'rule') {
      if (node.kind !== 'style') return;
      const places: Place[] = [];
      for (const selector of node.selectors) globalPlaces(selector, places);
      for (const place of places) out.push({ place, detail: ':global()' });
    } else {
      const scope: ValueScope = {
        lookup,
        values: file.kind !== 'page' || isPlacement(node),
        important: IMPORTANT_KINDS.has(file.kind),
      };
      out.push(...bannedValues(node, context.atRules, context.rule, scope));
    }
  });
  return out;
}

/** `css-banned`, source half: the banned constructs in `.astro` files and project CSS. */
export function checkCssBanned(input: SourceCss, report: Report): void {
  const { add, flush } = sourceFindings(report);
  const id = 'css-banned';
  // A `style` attribute and `is:global` in the markup of `.astro` files.
  for (const source of input.sources) {
    if (source.kind !== 'astro') continue;
    const keep = (element: HTMLElement): boolean =>
      attributeOf(element, 'style') !== undefined || attributeOf(element, 'is:global') !== undefined;
    for (const { element, offset } of markupElements(source, keep)) {
      const where = sourceWhere(source.path, { line: lineOf(source, offset) });
      const tag = tagOf(element);
      if (attributeOf(element, 'style') !== undefined) add(id, where, `<${tag} style>`);
      // `is:global` on a `<style>` is part of the `<style>`, which is `css-sources`'s (7.2).
      if (attributeOf(element, 'is:global') !== undefined && tag !== 'style') add(id, where, `<${tag} is:global>`);
    }
  }
  // Project CSS: every file but `tokens.css`, which is design-tokens'.
  for (const file of input.files) {
    if (file.kind === 'tokens') continue;
    for (const banned of bannedInFile(file, input)) add(id, sourceWhere(file.path, banned.place), banned.detail);
  }
  flush();
}

/** The facts of built `css-banned` in one sheet. */
function bannedFacts(sheet: BuiltSheet, input: BuiltCssInput): Fact[] {
  const facts: Fact[] = [];
  const own = definitionsOf(sheet.nodes);
  const tokens = input.source.tokens;
  const lookup = (name: string): readonly ComponentValue[] | undefined => tokens?.get(name)?.value ?? own.get(name);
  for (const item of sheet.nodes) {
    const { node, atRules, kitLayer } = item;
    const project = kitLayer !== undefined && PROJECT_LAYERS.has(kitLayer);
    if (node.type === 'at-rule') {
      if (BANNED_AT_RULES.has(node.name)) facts.push(atRuleText(node));
    } else if (node.type === 'rule') {
      if (!project || node.kind !== 'style') continue;
      const places: Place[] = [];
      for (const selector of node.selectors) globalPlaces(selector, places);
      if (places.length > 0) facts.push(`:global() in ${selectorText(node.prelude)}`);
    } else if (project && !inScope(atRules)) {
      const scope: ValueScope = { lookup, values: kitLayer !== 'page' || isPlacement(node), important: true };
      for (const banned of bannedValues(node, atRules, item.rule, scope)) facts.push(banned.detail);
    } else if (
      !inScope(atRules) &&
      !atRules.some((rule) => rule.name === 'font-face') &&
      urlsOf(node.value).length > 0
    ) {
      // `url()` outside `@font-face` fails in any layer or none.
      facts.push(declarationText(node));
    }
  }
  return facts;
}

/** `css-banned`, built half: the banned constructs in built HTML and built CSS. */
export function auditCssBanned(input: BuiltCssInput, report: Report): void {
  const add = reportOnce(report);
  const id = 'css-banned';
  for (const page of input.pages) {
    for (const element of page.elements) {
      const style = attributeOf(element, 'style');
      if (style !== undefined) add(id, page.path, snippet(`<${tagOf(element)} style="${style}">`));
    }
  }
  reportPages(input, add, id, (sheet) => bannedFacts(sheet, input));
}

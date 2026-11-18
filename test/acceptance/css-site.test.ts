/**
 * The suite case of milestone M4 (specification, 14, row M4): the CSS analyzers of the packed kit read the CSS of
 * the test site. The case builds the site with the packed kit, and then feeds the `<style>` of every built page and
 * every source CSS file under `src/styles/` to `css/parse`, `css/selectors`, `css/media` and `css/values`. It
 * asserts that every rule and every declaration parses, and that each analyzer reads each of them:
 *
 * - `parseCss` gives no parse problem, and `walk` reaches every rule, at-rule and declaration of the tree. The
 *   blocks of the tree are the `{` of the text (outside comments and strings), and the declarations that `walk`
 *   gives are those that a plain reading of the text finds (`textDeclarations`), with the same property, value and
 *   `!important`, in the same order. So no part of the text is lost.
 * - Every resolved selector of every style rule parses with `parseSelector`; every keyframe selector passes
 *   `keyframeSelectorProblem`.
 * - Every `@media` and `@container` prelude parses with `preludeOf`, and its lengths are breakpoints of
 *   `docs/design.md` (7.10).
 * - Every declaration value gives literals of a known kind; in the project layers (`elements`, `components`,
 *   `page`) it gives no literal and no family problem (7.3).
 * - The layer order of each built page is the order of 7.1, with `astro` first.
 *
 * Chromium is not needed: the differential stage compares the analyzers with the browser.
 * Run: node --test test/acceptance/css-site.test.ts
 */
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import type * as Media from '../../src/css/media.ts';
import type * as Parse from '../../src/css/parse.ts';
import type * as Selectors from '../../src/css/selectors.ts';
import type * as Values from '../../src/css/values.ts';
import type * as Design from '../../src/design/parse.ts';
import type * as Registry from '../../src/registry.ts';
import { type KitRun, kitModule, read, run, siteCase, styles, tree } from './harness.ts';

// The built kit modules. The exports map hides them (14.2); the types come from their sources.

interface Kit {
  parse: typeof Parse;
  selectors: typeof Selectors;
  media: typeof Media;
  values: typeof Values;
  design: typeof Design;
  registry: typeof Registry;
}

async function loadKit(): Promise<Kit> {
  return {
    parse: await kitModule<typeof Parse>('css/parse'),
    selectors: await kitModule<typeof Selectors>('css/selectors'),
    media: await kitModule<typeof Media>('css/media'),
    values: await kitModule<typeof Values>('css/values'),
    design: await kitModule<typeof Design>('design/parse'),
    registry: await kitModule<typeof Registry>('registry'),
  };
}

/** The layer order of 7.1. */
const ORDER = ['astro', 'reset', 'tokens', 'elements', 'layout', 'components', 'page'];
/** The layers that the project writes (7.1): the literal and family checks of css-literal and css-token-family. */
const PROJECT_LAYERS = new Set(['elements', 'components', 'page']);
/** The kinds of `Literal` (values.ts). */
const KINDS = new Set(['number', 'percentage', 'dimension', 'hex', 'color-function', 'named-color', 'system-color']);

/** The last part of a command's output, for the message of a failed assertion. */
const tail = (result: KitRun): string => result.output.slice(-4000);

/** A comment or a string of CSS text: the text between them holds every `{` of a block. */
const COMMENT_OR_STRING = /\/\*[\s\S]*?\*\/|"(?:[^"\\\n]|\\[\s\S])*"|'(?:[^'\\\n]|\\[\s\S])*'/g;

/** The number of `{` in CSS text, outside comments and strings. */
const braces = (css: string): number => css.replace(COMMENT_OR_STRING, '').split('{').length - 1;

/** CSS white space: space, tab, line feed, carriage return and form feed. */
const isSpace = (char: string | undefined): boolean =>
  char === ' ' || char === '\t' || char === '\n' || char === '\r' || char === '\f';

/** A declaration as `property: value`, with ` !important` when it has it: the form of both readings below. */
function declarationText(name: string, value: string, important: boolean, custom: boolean): string {
  return `${custom ? name : name.toLowerCase()}: ${value}${important ? ' !important' : ''}`;
}

/**
 * The declarations of CSS text, read from the text alone, without the parser of the kit: in each block, an item
 * that a top-level `;` or the end of its block ends is a declaration, unless it is empty or an at-rule; an item
 * that a `{` ends is the prelude of a rule. Comments go, white space outside strings is one space, a string stays
 * as written. It holds for the site's CSS, which has no `{}` block in a value.
 */
function textDeclarations(css: string): string[] {
  const out: string[] = [];
  let item = '';
  let depth = 0;
  let brackets = 0;
  let at = 0;
  const end = (): void => {
    const text = item.trim();
    item = '';
    if (depth === 0 || text === '' || text.startsWith('@')) return;
    const colon = text.indexOf(':');
    const name = text.slice(0, colon).trim();
    let value = text.slice(colon + 1).trim();
    const bang = value.lastIndexOf('!');
    const important =
      bang >= 0 &&
      value
        .slice(bang + 1)
        .trim()
        .toLowerCase() === 'important';
    if (important) value = value.slice(0, bang).trim();
    out.push(declarationText(name, value, important, name.startsWith('--')));
  };
  while (at < css.length) {
    const char = css[at] ?? '';
    if (char === '/' && css[at + 1] === '*') {
      const close = css.indexOf('*/', at + 2);
      at = close < 0 ? css.length : close + 2;
    } else if (char === '"' || char === "'") {
      let close = at + 1;
      while (close < css.length && css[close] !== char) close += css[close] === '\\' ? 2 : 1;
      item += css.slice(at, close + 1);
      at = close + 1;
    } else if (char === '\\') {
      item += css.slice(at, at + 2);
      at += 2;
    } else if (isSpace(char)) {
      if (!item.endsWith(' ')) item += ' ';
      while (isSpace(css[at])) at += 1;
    } else {
      if (char === '(' || char === '[') brackets += 1;
      if (char === ')' || char === ']') brackets -= 1;
      if (brackets === 0 && char === '{') {
        item = '';
        depth += 1;
      } else if (brackets === 0 && (char === ';' || char === '}')) {
        end();
        if (char === '}') depth -= 1;
      } else item += char;
      at += 1;
    }
  }
  return out;
}

/** The counts of a tree, read from the tree itself: style and keyframe rules, at-rules, blocks and declarations. */
function countTree(nodes: readonly Parse.CssNode[]): { nodes: number; blocks: number; declarations: number } {
  let count = { nodes: 0, blocks: 0, declarations: 0 };
  for (const node of nodes) {
    count.nodes += 1;
    if (node.type === 'declaration') count.declarations += 1;
    const inner = node.type === 'rule' ? node.children : node.type === 'at-rule' ? node.block : undefined;
    if (inner === undefined) continue;
    const below = countTree(inner);
    count = {
      nodes: count.nodes + below.nodes,
      blocks: count.blocks + 1 + below.blocks,
      declarations: count.declarations + below.declarations,
    };
  }
  return count;
}

/** One CSS text of the site: a built page or a source file. */
interface Text {
  name: string;
  css: string;
  form: Values.CssForm;
  /** For a source file: true when it is a project file whose values css-literal reads (7.3). */
  project: boolean;
}

/** What the four analyzers found in one CSS text. Every list is empty for the site, the counts are equal. */
interface Analysis {
  problems: string[];
  selectors: string[];
  keyframes: string[];
  preludes: string[];
  lengths: string[];
  unknownKinds: string[];
  literals: string[];
  families: string[];
  walked: number;
  /** The declarations that `walk` gives, as `declarationText` writes them. */
  walkedDeclarations: string[];
  /** The declarations of the text alone (`textDeclarations`). */
  textDeclarations: string[];
  tree: number;
  blocks: number;
  braces: number;
  declarations: number;
  rules: number;
  layers: string[];
}

/** Runs the four analyzers of the packed kit on one text. It does not assert. */
function analyze(kit: Kit, text: Text, breakpoints: readonly { width: string }[]): Analysis {
  const { parse, selectors, media, values, design } = kit;
  const sheet = parse.parseCss(text.css, text.name);
  const counted = countTree(sheet.nodes);
  const out: Analysis = {
    problems: sheet.problems.map((item) => `${item.place.line}:${item.place.column} ${item.message}`),
    selectors: [],
    keyframes: [],
    preludes: [],
    lengths: [],
    unknownKinds: [],
    literals: [],
    families: [],
    walked: 0,
    walkedDeclarations: [],
    textDeclarations: textDeclarations(text.css),
    tree: counted.nodes,
    blocks: counted.blocks,
    braces: braces(text.css),
    declarations: counted.declarations,
    rules: 0,
    layers: parse.layerOrder(sheet),
  };
  const where = (place: Parse.Place): string => `${text.name}:${place.line}:${place.column}`;
  parse.walk(sheet, (node, context) => {
    out.walked += 1;
    if (node.type === 'at-rule') {
      const prelude = media.preludeOf(node);
      if (prelude === undefined) return;
      for (const item of prelude.problems) out.preludes.push(`${where(item.place)} ${item.message}`);
      for (const item of media.lengthProblems(prelude, breakpoints, text.form)) {
        out.lengths.push(`${where(item.place)} ${item.message}`);
      }
      return;
    }
    if (node.type === 'rule') {
      out.rules += 1;
      if (node.kind === 'keyframe') {
        for (const keyframe of node.selectors) {
          const item = values.keyframeSelectorProblem(keyframe, node.place);
          if (item !== undefined) out.keyframes.push(`${where(item.place)} ${item.message}`);
        }
        return;
      }
      if (node.resolved.length === 0) out.selectors.push(`${where(node.place)} a style rule with no selector`);
      for (const resolved of node.resolved) {
        const { problem } = selectors.parseSelector(resolved);
        if (problem !== undefined) out.selectors.push(`${where(problem.place)} ${problem.message}`);
      }
      return;
    }
    const custom = node.property.startsWith('--');
    out.walkedDeclarations.push(declarationText(node.property, parse.serialize(node.value), node.important, custom));
    const literalContext = { form: text.form, forcedColors: media.requiresForcedColors(context.atRules) };
    const found = values.bannedLiterals(node, literalContext);
    for (const item of found) {
      if (!KINDS.has(item.kind)) out.unknownKinds.push(`${where(item.place)} ${item.kind} ${item.text}`);
    }
    const project = text.form === 'built' ? PROJECT_LAYERS.has(context.layer ?? '') : text.project;
    if (!project) return;
    for (const item of found) out.literals.push(`${where(item.place)} ${node.property}: ${item.kind} ${item.text}`);
    for (const use of values.familyProblems(node, design.familyOf)) {
      out.families.push(`${where(use.place)} ${node.property}: ${use.name}`);
    }
  });
  return out;
}

test('M4: the CSS analyzers read every rule and declaration of the built pages and of the source CSS', async () => {
  const dir = siteCase('css-site');
  const result = run(dir, 'build');
  assert.equal(result.status, 0, `astro-kit build failed in ${dir}:\n${tail(result)}`);
  assert.deepEqual(result.ids, []);

  const kit = await loadKit();
  const report = new kit.registry.Report();
  const design = kit.design.parseDesign(read(dir, 'docs/design.md'), report);
  assert.ok(design, `docs/design.md does not parse: ${JSON.stringify(report.findings)}`);
  const breakpoints = design.breakpoints;
  assert.ok(breakpoints.length > 0, 'docs/design.md declares no breakpoint');

  const dist = join(dir, 'dist');
  const pages = tree(dist).filter((file) => file.endsWith('.html'));
  assert.ok(pages.length >= 10, `only ${pages.length} built pages`);
  const sources = tree(join(dir, 'src/styles')).filter((file) => file.endsWith('.css'));
  assert.ok(sources.length >= 10, `only ${sources.length} source CSS files`);

  const texts: Text[] = [
    ...pages.map((page) => ({
      name: `dist/${page}`,
      css: styles(read(dist, page)),
      form: 'built' as const,
      project: false,
    })),
    ...sources.map((file) => ({
      name: `src/styles/${file}`,
      css: read(join(dir, 'src/styles'), file),
      form: 'source' as const,
      // tokens.css is the kit's rendering and fonts.css holds `@font-face` rules: both are exempt (7.3).
      project: file !== 'tokens.css' && file !== 'fonts.css',
    })),
  ];

  const analyses = texts.map((text) => ({ text, found: analyze(kit, text, breakpoints) }));
  let declarations = 0;
  let rules = 0;
  for (const { text, found } of analyses) {
    assert.deepEqual(found.problems, [], `${text.name}: parse problems`);
    assert.equal(found.walked, found.tree, `${text.name}: walk reaches ${found.walked} of ${found.tree} nodes`);
    assert.equal(found.blocks, found.braces, `${text.name}: ${found.blocks} blocks for ${found.braces} braces`);
    assert.deepEqual(found.walkedDeclarations, found.textDeclarations, `${text.name}: the declarations of the text`);
    assert.deepEqual(found.selectors, [], `${text.name}: selectors that do not parse`);
    assert.deepEqual(found.keyframes, [], `${text.name}: keyframe selectors`);
    assert.deepEqual(found.preludes, [], `${text.name}: @media and @container preludes`);
    assert.deepEqual(found.lengths, [], `${text.name}: prelude lengths that are no breakpoint`);
    assert.deepEqual(found.unknownKinds, [], `${text.name}: literals of an unknown kind`);
    assert.deepEqual(found.literals, [], `${text.name}: literals outside the allowlist of 7.3`);
    assert.deepEqual(found.families, [], `${text.name}: tokens of a family that the property does not accept`);
    declarations += found.declarations;
    rules += found.rules;
  }
  // Every built page has CSS, and the layer order of 7.1: the names in their order of first appearance (13.1 item 3).
  // A source file may be empty: `fonts.css` of a site without fonts.
  for (const { text, found } of analyses.filter((each) => each.text.form === 'built')) {
    assert.ok(found.declarations > 0, `${text.name}: no declaration`);
    assert.deepEqual(found.layers, ORDER, `${text.name}: the layer order`);
  }
  // The site has real CSS: hundreds of rules and declarations, not an empty text that passes.
  assert.ok(rules > 100, `${rules} rules in all`);
  assert.ok(declarations > 500, `${declarations} declarations in all`);
});

/**
 * The CSS contract, checked on each page's CSS (its inline styles and linked sheets, in document
 * order): the kit layer order comes first, every var() is defined, colour literals live only in
 * tokens, global classes come from the frozen kit list, and the layout bans hold.
 */
import type { Audit, BuildContext, BuiltPage } from '../context.ts';

/** The frozen global class list. Everything else is a scoped component class. */
export const KIT_CLASSES: readonly string[] = Object.freeze([
  'container',
  'grid',
  'stack',
  'cluster',
  'full-bleed',
  'primary',
  'secondary',
  'contrast',
  'outline',
  'lead',
  'muted',
  'visually-hidden',
]);
const KIT_CLASS_SET = new Set(KIT_CLASSES);

/** The kit layers in cascade order; theme is the project's token layer. */
export const KIT_LAYERS = ['kit.reset', 'kit.tokens', 'kit.base', 'theme'] as const;

export type CssNode =
  | { type: 'decl'; prop: string; value: string }
  | { type: 'rule'; selector: string; children: CssNode[] }
  | { type: 'at'; name: string; prelude: string; children?: CssNode[] };

/** A small CSS parser: enough structure for the contract, nesting included. Comments are dropped. */
export function parseCss(css: string): CssNode[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  let i = 0;
  const item = (raw: string, children?: CssNode[]): CssNode => {
    if (raw.startsWith('@')) {
      const name = /^@([\w-]+)/.exec(raw)?.[1]?.toLowerCase() ?? '';
      const prelude = raw.slice(name.length + 1).trim();
      return children ? { type: 'at', name, prelude, children } : { type: 'at', name, prelude };
    }
    if (children) return { type: 'rule', selector: raw, children };
    const colon = raw.indexOf(':');
    const prop = (colon < 0 ? raw : raw.slice(0, colon)).trim();
    return {
      type: 'decl',
      prop: prop.startsWith('--') ? prop : prop.toLowerCase(),
      value: colon < 0 ? '' : raw.slice(colon + 1).trim(),
    };
  };
  const block = (): CssNode[] => {
    const out: CssNode[] = [];
    let start = i;
    let parens = 0;
    while (i < text.length) {
      const c = text[i];
      if (c === '"' || c === "'") {
        for (i++; i < text.length && text[i] !== c; i++) if (text[i] === '\\') i++;
      } else if (c === '(') parens++;
      else if (c === ')') parens--;
      else if (parens <= 0 && c === '{') {
        const head = text.slice(start, i).trim();
        i++;
        out.push(item(head, block()));
        start = i;
        continue;
      } else if (parens <= 0 && (c === ';' || c === '}')) {
        const raw = text.slice(start, i).trim();
        if (raw) out.push(item(raw));
        i++;
        if (c === '}') return out;
        start = i;
        continue;
      }
      i++;
    }
    const rest = text.slice(start).trim();
    if (rest) out.push(item(rest));
    return out;
  };
  return block();
}

/** Splits at top-level commas, outside parentheses, brackets and strings. */
export function splitList(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote = '';
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = '';
    } else if (c === '"' || c === "'") quote = c;
    else if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
    else if (c === ',' && depth === 0) {
      out.push(text.slice(start, i).trim());
      start = i + 1;
    }
  }
  out.push(text.slice(start).trim());
  return out.filter(Boolean);
}

interface Scope {
  /** Full dotted layer name, '' when unlayered. */
  layer: string;
  /** Inside a rule whose every selector carries [data-astro-cid-*]. */
  scoped: boolean;
  keyframes: boolean;
  property: boolean;
}

type Visit = (node: CssNode, scope: Scope) => void;

const join = (parent: string, name: string): string => (parent ? `${parent}.${name}` : name);

function walk(nodes: CssNode[], scope: Scope, visit: Visit): void {
  for (const node of nodes) {
    visit(node, scope);
    if (node.type === 'decl' || !node.children) continue;
    if (node.type === 'rule') {
      const scoped = scope.scoped || splitList(node.selector).every((s) => s.includes('[data-astro-cid-'));
      walk(node.children, { ...scope, scoped }, visit);
    } else if (node.name === 'layer') {
      walk(node.children, { ...scope, layer: join(scope.layer, node.prelude || '(anonymous)') }, visit);
    } else {
      walk(
        node.children,
        {
          ...scope,
          keyframes: scope.keyframes || /keyframes$/.test(node.name),
          property: scope.property || node.name === 'property',
        },
        visit,
      );
    }
  }
}

/** Layer names in order of first appearance, from @layer statements and blocks. */
export function layerOrder(nodes: CssNode[]): string[] {
  const order: string[] = [];
  const add = (name: string) => {
    if (!order.includes(name)) order.push(name);
  };
  walk(nodes, { layer: '', scoped: false, keyframes: false, property: false }, (node, scope) => {
    if (node.type !== 'at' || node.name !== 'layer') return;
    if (node.children) add(join(scope.layer, node.prelude || '(anonymous)'));
    else for (const name of splitList(node.prelude)) add(join(scope.layer, name));
  });
  return order;
}

const isAstroLayer = (name: string): boolean => name === 'astro' || name.startsWith('astro.');
const inLayer = (layer: string, name: string): boolean => layer === name || layer.startsWith(`${name}.`);

/** Undefined when the order holds; otherwise what is wrong. Astro's own layers are neutral. */
export function layerOrderProblem(order: string[]): string | undefined {
  const named = order.filter((n) => n !== 'kit' && !isAstroLayer(n));
  if (named[0] !== 'kit.reset') return `first layer is ${named[0] ?? 'missing'}, expected kit.reset`;
  const kit = named.filter((n) => (KIT_LAYERS as readonly string[]).includes(n));
  const expected = KIT_LAYERS.filter((n) => kit.includes(n));
  if (kit.join() !== expected.join()) return `layer order ${kit.join(', ')}, expected ${expected.join(', ')}`;
  return undefined;
}

const NAMED_COLOURS = new Set(
  `aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood cadetblue
  chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey
  darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray
  darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen
  fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender
  lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey
  lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen
  magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen
  mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange
  orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple
  rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray
  slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen`.split(
    /\s+/,
  ),
);
const COLOUR_FN = /(?<![\w-])(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(/i;
/** Properties that take a colour, where a bare word may be a named colour. */
const COLOUR_PROP =
  /color|shadow|^(background|border|outline|text-decoration|text-emphasis|column-rule|fill|stroke|filter)/;

/** The first colour literal in a declaration value, if any. Strings, url() and var names are ignored. */
export function colourLiteral(prop: string, value: string): string | undefined {
  const v = value
    .replace(/(["'])(?:\\.|(?!\1).)*\1/g, '')
    .replace(/url\([^)]*\)/gi, '')
    .replace(/--[\w-]+/g, '');
  const fn = COLOUR_FN.exec(v);
  if (fn) return `${fn[0]}…)`;
  // #0000 is how the minifier writes `transparent`; it carries no colour.
  for (const m of v.matchAll(/#([0-9a-f]+)(?![\w-])/gi))
    if ([3, 4, 6, 8].includes(m[1]?.length ?? 0) && !/^0{4}(0{4})?$/.test(m[1] ?? '')) return m[0];
  if (COLOUR_PROP.test(prop))
    for (const m of v.matchAll(/(?<![\w-])[a-z]+(?![\w(-])/gi)) if (NAMED_COLOURS.has(m[0].toLowerCase())) return m[0];
  return undefined;
}

/** var() names used without a fallback. */
export function varsWithoutFallback(value: string): string[] {
  return [...value.matchAll(/var\(\s*(--[^\s,)]+)\s*\)/g)].map((m) => m[1] ?? '');
}

const VIEWPORT_WIDTH = /(?<![\w.])100[dls]?vw(?![\w-])/i;
const WIDTH_PROP = /^(min-|max-)?(width|inline-size)$|^margin/;
const PAGE_ROOT = /^(html|body|:root)(?![\w-])/i;

/** The subject compound of a complex selector: the part after the last combinator. */
const subject = (selector: string): string =>
  selector
    .split(/\s*[>+~]\s*|\s+/)
    .filter(Boolean)
    .pop() ?? '';

/** Classes named in a selector, ignoring attribute selectors and strings. */
export function classesOf(selector: string): string[] {
  const s = selector.replace(/(["'])(?:\\.|(?!\1).)*\1/g, '').replace(/\[[^\]]*\]/g, '');
  return [...s.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((m) => m[1] ?? '');
}

/** The page's CSS in document order: inline styles and linked stylesheets found in dist. */
function pageSheets(page: BuiltPage, files: Map<string, string>): string[] {
  const out: string[] = [];
  for (const el of page.doc.querySelectorAll('style, link')) {
    if (el.tagName === 'STYLE') out.push(el.textContent);
    else if ((el.getAttribute('rel') ?? '').toLowerCase().split(/\s+/).includes('stylesheet')) {
      const text = files.get((el.getAttribute('href') ?? '').split(/[?#]/)[0] ?? '');
      if (text !== undefined) out.push(text);
    }
  }
  return out;
}

/** Checks one page's parsed CSS; add() receives rule, detail. */
export function checkCss(nodes: CssNode[], add: (rule: string, detail: string) => void): void {
  const problem = layerOrderProblem(layerOrder(nodes));
  if (problem) add('css-layer-order', problem);
  const defined = new Set<string>();
  const used = new Set<string>();
  walk(nodes, { layer: '', scoped: false, keyframes: false, property: false }, (node, scope) => {
    if (node.type === 'at') {
      if (node.name === 'property') defined.add(node.prelude);
      return;
    }
    if (node.type === 'rule') {
      const selectors = splitList(node.selector);
      const roots = selectors.filter((s) => PAGE_ROOT.test(subject(s)));
      for (const d of roots.length > 0 ? node.children : []) {
        if (d.type === 'decl' && /^overflow(-x|-inline)?$/.test(d.prop) && /^(hidden|clip)\b/i.test(d.value)) {
          add('css-banned', `${d.prop}: ${d.value} on ${roots.join(', ')}`);
        }
      }
      if (scope.keyframes || inLayer(scope.layer, 'kit') || inLayer(scope.layer, 'astro')) return;
      for (const selector of selectors) {
        if (scope.scoped || selector.includes('[data-astro-cid-')) continue;
        for (const name of classesOf(selector))
          if (!KIT_CLASS_SET.has(name)) add('css-classes', `.${name} in "${selector}"`);
      }
      return;
    }
    const { prop, value } = node;
    if (prop.startsWith('--')) defined.add(prop);
    for (const name of varsWithoutFallback(value)) used.add(name);
    const tokens =
      prop.startsWith('--') || scope.property || inLayer(scope.layer, 'kit.tokens') || inLayer(scope.layer, 'theme');
    const literal = tokens ? undefined : colourLiteral(prop, value);
    if (literal) add('css-literal', `${prop}: ${literal}${scope.layer ? ` in @layer ${scope.layer}` : ''}`);
    if (WIDTH_PROP.test(prop) && VIEWPORT_WIDTH.test(value)) add('css-banned', `${prop}: ${value}`);
    if (prop === 'forced-color-adjust' && /^none\b/i.test(value)) add('css-banned', 'forced-color-adjust: none');
  });
  for (const name of used) if (!defined.has(name)) add('css-var-undefined', `var(${name})`);
}

export const auditCss: Audit = (ctx: BuildContext) => {
  const files = new Map(ctx.css.filter((c) => c.where.endsWith('.css')).map((c) => [c.where, c.text]));
  const parsed = new Map<string, CssNode[]>();
  // The same CSS repeats on every page: report each finding once, with the first page and a count.
  const seen = new Map<string, { rule: string; where: string; detail: string; pages: number }>();
  for (const page of ctx.pages) {
    const nodes = pageSheets(page, files).flatMap((text) => {
      const tree = parsed.get(text) ?? parseCss(text);
      parsed.set(text, tree);
      return tree;
    });
    const local = new Set<string>();
    const add = (rule: string, detail: string) => {
      const key = `${rule}\0${detail}`;
      if (local.has(key)) return;
      local.add(key);
      const entry = seen.get(key);
      if (entry) entry.pages++;
      else seen.set(key, { rule, where: page.path, detail, pages: 1 });
    };
    checkCss(nodes, add);
    const styled = page.doc.querySelectorAll('[style]');
    if (styled.length > 0)
      add('css-banned', `style attribute on ${styled.length} element(s), first <${styled[0]?.tagName.toLowerCase()}>`);
  }
  for (const { rule, where, detail, pages } of seen.values()) {
    ctx.report.add(rule, where, pages > 1 ? `${detail}; on ${pages} pages` : detail);
  }
};

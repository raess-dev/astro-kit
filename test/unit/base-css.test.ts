import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { brotliCompressSync, constants, zstdCompressSync } from 'node:zlib';
import { type CssNode, checkCss, classesOf, KIT_CLASSES, parseCss, splitList } from '../../src/audit/css.ts';
import { LIMITS } from '../../src/options.ts';

const BASE = readFileSync(new URL('../../css/base.css', import.meta.url), 'utf8');

/** Comments and formatting removed, close to what the build ships. */
const flat = (css: string): string =>
  css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s*([{};:,>])\s*/g, '$1')
    .trim();

/** A pattern for a compact CSS snippet that matches it in any formatting. */
const loose = (snippet: string): RegExp =>
  new RegExp(
    snippet
      .trim()
      .split(/(\s*[{};:,>]\s*|\s+)/)
      .map((t) =>
        /^\s+$/.test(t)
          ? '\\s+'
          : /^\s*[{};:,>]\s*$/.test(t)
            ? `\\s*\\${t.trim()}\\s*`
            : t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
      )
      .join(''),
  );

/** max(zstd 3, brotli 5) of the flattened file, the kit's measure. */
const compressed = (text: string): number => {
  const b = Buffer.from(flat(text));
  const zstd = zstdCompressSync(b, { params: { [constants.ZSTD_c_compressionLevel]: 3 } }).length;
  const brotli = brotliCompressSync(b, { params: { [constants.BROTLI_PARAM_QUALITY]: 5 } }).length;
  return Math.max(zstd, brotli);
};

interface Flat {
  /** Enclosing at-rules, e.g. ['layer kit.base', 'media print']. */
  at: string[];
  selector: string;
  decls: Map<string, string>;
}

function flatten(nodes: CssNode[], at: string[] = [], out: Flat[] = []): Flat[] {
  for (const node of nodes) {
    if (node.type === 'rule') {
      const decls = new Map<string, string>();
      for (const d of node.children) if (d.type === 'decl') decls.set(d.prop, d.value);
      out.push({ at, selector: node.selector, decls });
      flatten(node.children, at, out);
    } else if (node.type === 'at' && node.children)
      flatten(node.children, [...at, `${node.name} ${node.prelude}`], out);
  }
  return out;
}

const rulesOf = (css: string) => flatten(parseCss(css));
const find = (rules: Flat[], selector: string, at?: string) =>
  rules.filter(
    (r) => splitList(r.selector).includes(selector) && (at === undefined || r.at.some((a) => a.includes(at))),
  );

/** The base.css contract; returns what is wrong. */
function problems(css: string): string[] {
  const out: string[] = [];
  const rules = rulesOf(css);
  if (css.split('\n')[0] !== '@layer kit.reset, kit.tokens, kit.base, theme;')
    out.push('first line is not the layer order');
  if (compressed(css) > LIMITS.baseCssBytes) out.push(`compressed ${compressed(css)} bytes`);
  checkCss(parseCss(css), (rule, detail) => out.push(`${rule}: ${detail}`));

  const root = find(rules, ':root', 'layer kit.tokens').find((r) => r.at.length === 1);
  const tokens = [...(root?.decls.keys() ?? [])].filter((p) => p.startsWith('--'));
  if (tokens.length < 28) out.push(`${tokens.length} tokens`);
  if (root?.decls.get('color-scheme') !== 'light dark') out.push('no color-scheme: light dark');
  for (const name of [
    'text',
    'muted',
    'bg',
    'surface',
    'border',
    'link',
    'primary',
    'primary-fg',
    'contrast-bg',
    'contrast-fg',
    'error',
    'focus',
  ]) {
    if (!/^light-dark\(oklch\([^)]*\), oklch\([^)]*\)\)$/.test(root?.decls.get(`--${name}`) ?? ''))
      out.push(`--${name} is not light-dark(oklch, oklch)`);
  }
  if (root?.decls.get('--target') !== '2.75rem') out.push('--target is not 2.75rem');

  const classes = new Set(rules.flatMap((r) => classesOf(r.selector)));
  for (const c of classes) if (!KIT_CLASSES.includes(c)) out.push(`global class .${c}`);
  for (const c of KIT_CLASSES) if (!classes.has(c)) out.push(`kit class .${c} undefined`);

  const focus = find(rules, ':focus-visible')[0];
  if (focus?.decls.get('outline') !== '2px solid var(--focus)' || focus.decls.get('outline-offset') !== '2px')
    out.push('no 2px :focus-visible outline');
  for (const r of rules) {
    const onFocus = splitList(r.selector).some((s) => /:focus(?![-\w])/.test(s));
    if (onFocus && [...r.decls.keys()].some((p) => p.startsWith('outline')))
      out.push(`outline on :focus in "${r.selector}"`);
  }

  const control = (sel: string) => find(rules, sel).some((r) => r.decls.get('min-block-size') === 'var(--target)');
  if (!control('button') || !control('input')) out.push('controls lack the 44 px target');
  if (
    root?.decls.get('--clear') !== 'transparent' ||
    !find(rules, 'button').some((r) => r.decls.get('border') === '2px solid var(--clear)')
  ) {
    out.push('buttons lack a transparent border');
  }
  if (!rules.some((r) => r.selector === 'label:has(+ :user-invalid)')) out.push('no label:has(+ :user-invalid)');

  if (find(rules, '#sent')[0]?.decls.get('display') !== 'none') out.push('#sent is not hidden');
  if (find(rules, ':is(#sent, #not-sent):target')[0]?.decls.get('display') !== 'block')
    out.push('results not shown on :target');
  if (find(rules, '#sent:target ~ form')[0]?.decls.get('display') !== 'none') out.push('the form stays after #sent');

  if (!find(rules, 'body > header', 'min-height: 30rem').some((r) => r.decls.get('position') === 'sticky'))
    out.push('header not sticky at 30rem');
  if (
    find(rules, 'body > header').some(
      (r) => r.decls.has('position') && !r.at.some((a) => /min-height: 30rem|print/.test(a)),
    )
  )
    out.push('header sticky at any height');
  if (!find(rules, 'html', 'min-height: 30rem').some((r) => r.decls.has('scroll-padding-block-start')))
    out.push('no scroll padding');
  if (!find(rules, 'header nav > details', 'width < ').some((r) => r.decls.get('display') === 'block'))
    out.push('menu not shown on narrow screens');

  const more = find(rules, ':root', 'prefers-contrast: more')[0];
  if (!more?.decls.has('--muted') || !more.decls.has('--border'))
    out.push('more contrast does not raise muted and border');
  if (!find(rules, ':focus-visible', 'forced-colors: active').length) out.push('no forced-colors focus');
  const reduce = find(rules, '*', 'prefers-reduced-motion: reduce')[0];
  if (!reduce?.at[0]?.includes('kit.reset') || !/none/.test(reduce.decls.get('transition') ?? ''))
    out.push('no reduced-motion block in kit.reset');
  if (!loose('@media (prefers-reduced-motion: no-preference) { @view-transition { navigation: auto; }').test(css))
    out.push('view transitions not gated');
  const print = rules.filter((r) => r.at.some((a) => a === 'media print'));
  const hidden = print.filter((r) => r.decls.get('display') === 'none').flatMap((r) => splitList(r.selector));
  for (const sel of ['header nav', 'form', 'body > a[href="#main"]'])
    if (!hidden.includes(sel)) out.push(`print shows ${sel}`);
  if (!print.some((r) => r.selector.startsWith('a[href^="http"]::after'))) out.push('print hides external hrefs');
  return out;
}

test('base.css meets the contract', () => {
  assert.deepEqual(problems(BASE), []);
});

test('base.css is 3 KB or less compressed', () => {
  assert.ok(compressed(BASE) <= LIMITS.baseCssBytes, `${compressed(BASE)} bytes`);
  const padded = `${BASE}:root { --pad: "${randomBytes(1024).toString('hex')}"; }\n`;
  assert.ok(problems(padded).some((p) => p.startsWith('compressed')));
});

test('each contract check fails on a bad copy', () => {
  const bad = (from: string | RegExp, to: string, expect: RegExp) => {
    const css = BASE.replace(typeof from === 'string' ? loose(from) : from, to);
    assert.notEqual(css, BASE, `no match for ${from}`);
    assert.ok(
      problems(css).some((p) => expect.test(p)),
      `${from} → ${problems(css).join('; ')}`,
    );
  };
  bad('@layer kit.reset, kit.tokens, kit.base, theme;', '@layer theme, kit.reset;', /layer order|css-layer-order/);
  bad('.lead { font-size: var(--step-1); }', '.lead { font-size: var(--step-1); color: #333; }', /css-literal/);
  bad('.lead {', '.hero, .lead {', /global class \.hero/);
  bad('.muted { color: var(--muted); }', '', /kit class \.muted undefined/);
  bad('outline: 2px solid var(--focus); outline-offset: 2px;', 'outline: 1px dotted;', /no 2px :focus-visible/);
  bad(
    'body > a[href="#main"]:focus { translate',
    'a:focus { outline: 3px solid var(--focus); } body > a[href="#main"]:focus { translate',
    /outline on :focus/,
  );
  bad(
    'min-block-size: var(--target); min-inline-size: var(--target); padding: var(--space-xs) var(--space-m)',
    'padding: 0',
    /44 px target/,
  );
  bad('border: 2px solid var(--clear);', 'border: 0;', /transparent border/);
  bad('#sent:target ~ form { display: none; }', '', /form stays/);
  bad(
    '--muted: light-dark(oklch(47% 0.01 250), oklch(77% 0.01 250));',
    '--muted: oklch(47% 0.01 250);',
    /--muted is not light-dark/,
  );
  bad(
    '@media (min-height: 30rem) { html { scroll-padding-block-start: 5rem; } body > header { position: sticky; inset-block-start: 0; z-index: 1; } }',
    'body > header { position: sticky; }',
    /not sticky|sticky at any height/,
  );
  bad('@media (prefers-contrast: more)', '@media (prefers-contrast: less)', /more contrast/);
  bad(
    '@media (prefers-reduced-motion: no-preference) { @view-transition',
    '@media all { @view-transition',
    /view transitions/,
  );
  bad(
    'body > a[href="#main"], header nav, form { display: none; }',
    'body > a[href="#main"], form { display: none; }',
    /print shows header nav/,
  );
  bad('input, select, textarea { inline-size: 100%;', 'input, select, textarea { inline-size: 100vw;', /css-banned/);
  bad('background: var(--backdrop);', 'background: var(--shade);', /css-var-undefined/);
});

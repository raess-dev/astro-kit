/**
 * The budgets audit (part 5c of M5): `budget-head`, `budget-document`, `budget-dom` and `budget-fonts`, and the
 * compressed size of section 8. Each case builds a `BuildContext` from strings shaped as Astro writes them (14.1),
 * runs one rule, and asserts the exact sorted id list.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { brotliCompressSync, constants, zstdCompressSync } from 'node:zlib';
import {
  auditBudgetDocument,
  auditBudgetDom,
  auditBudgetFonts,
  auditBudgetHead,
  auditBudgets,
  compressedSize,
  FONT_PATH,
  fontPaths,
} from '../../src/audit/budgets.ts';
import { cspMetasOf, domOf, rawContentOf, scriptKind } from '../../src/audit/dom.ts';
import type { BuildContext } from '../../src/context.ts';
import { LIMITS } from '../../src/options.ts';
import { Report } from '../../src/registry.ts';
import {
  type ContextSettings,
  contextOf,
  cspContent,
  fileOf,
  findings,
  ICON_FILES,
  ids,
  OPTIONS,
  PAGE_CSS,
  type PageParts,
  page,
  site,
} from './audit-fixtures.ts';
import { optionsOf, TWO_LOCALES } from './fixtures.ts';
import { SPEC } from './spec.ts';

type Rule = (ctx: BuildContext) => void;
type Files = Readonly<Record<string, string | Uint8Array>>;

/** Runs rules on a context of the files and returns its report. */
function run(rules: Rule | readonly Rule[], files: Files, settings: ContextSettings = {}): Report {
  const ctx = contextOf(files, settings);
  for (const rule of Array.isArray(rules) ? rules : [rules]) rule(ctx);
  return ctx.report;
}

/** The icon files and one fixture page at a path. */
const one = (path: string, parts: PageParts = {}): Files => ({
  ...ICON_FILES,
  [fileOf(path)]: page(OPTIONS, path, parts),
});

/** Text that compresses badly: hex digits from a fixed linear congruential generator, so every run is the same. */
function noise(length: number, seed = 1): string {
  let state = seed;
  let out = '';
  while (out.length < length) {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    out += (state >>> 8).toString(16).padStart(6, '0');
  }
  return out.slice(0, length);
}

/** A size as a detail prints it. */
const bytes = (size: number): string => `${size.toLocaleString('en-US')} B`;

/** The UTF-8 bytes of a text. */
const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);

// compressedSize

test('compressedSize is the larger of zstd level 3 and brotli quality 5, of a text as UTF-8 or of bytes', () => {
  const text = `${'Hotel Lärchenwald '.repeat(200)}${noise(2_000)}`;
  const data = utf8(text);
  const zstd = zstdCompressSync(data, { params: { [constants.ZSTD_c_compressionLevel]: 3 } }).length;
  const brotli = brotliCompressSync(data, { params: { [constants.BROTLI_PARAM_QUALITY]: 5 } }).length;
  assert.equal(compressedSize(text), Math.max(zstd, brotli));
  assert.equal(compressedSize(data), compressedSize(text));
  assert.ok(compressedSize('') > 0);
});

// budget-head

test('budget-head passes the fixture site', () => {
  assert.deepEqual(ids(run(auditBudgetHead, site())), []);
});

test('budget-head fails a head over headBytes compressed, with the parts of the head in the detail', () => {
  const css = `@layer page{.a{--x:"${noise(30_000)}"}}`;
  const files = one('/', { css });
  const ctx = contextOf(files);
  auditBudgetHead(ctx);
  assert.deepEqual(ids(ctx.report), ['budget-head']);
  const built = ctx.pages[0];
  assert.ok(built !== undefined);
  const dom = domOf(built);
  const html = built.html;
  const end = dom.head?.range[1] ?? 0;
  const head = compressedSize(html.slice(0, end));
  const style = dom.byTag('style')[0];
  const meta = cspMetasOf(dom)[0];
  const script = dom.byTag('script').find((element) => scriptKind(element) === 'json-ld');
  assert.ok(style !== undefined && meta !== undefined && script !== undefined);
  // The fixture head writes the JSON-LD, then the CSP meta and the inserts, then the style.
  const markup = [
    html.slice(0, script.range[0]),
    html.slice(script.range[1], meta.range[0]),
    html.slice(meta.range[1], style.range[0]),
    html.slice(style.range[1], end),
  ].join('');
  const parts = [
    `markup ${bytes(compressedSize(markup))}`,
    `CSS ${bytes(compressedSize(css))}`,
    `CSP meta ${bytes(compressedSize(html.slice(meta.range[0], meta.range[1])))}`,
    `JSON-LD ${bytes(compressedSize(rawContentOf(script)))}`,
  ].join(', ');
  assert.deepEqual(findings(ctx.report), [
    `budget-head / the head has ${bytes(head)} compressed; at most ${bytes(LIMITS.headBytes)} (${parts})`,
  ]);
});

test('budget-head reads the limit that the site lowered', () => {
  const lowered = optionsOf({ ...TWO_LOCALES, limits: { headBytes: 300 } });
  const files = { ...ICON_FILES, 'index.html': page(lowered, '/') };
  assert.deepEqual(ids(run(auditBudgetHead, files, { options: lowered })), ['budget-head']);
  assert.deepEqual(ids(run(auditBudgetHead, files)), []);
});

test('budget-head measures up to </head>: a large body does not count', () => {
  const files = one('/', { main: `<h1>Gross</h1> <p>${noise(60_000)}</p>` });
  assert.deepEqual(ids(run(auditBudgetHead, files)), []);
  assert.deepEqual(ids(run(auditBudgetDocument, files)), ['budget-document']);
});

test('budget-head measures the whole file when the page has no head element', () => {
  const small = '<!DOCTYPE html><html lang="de-CH"> <body> <main id="content"><h1>Klein</h1></main> </body> </html>';
  assert.deepEqual(ids(run(auditBudgetHead, { 'index.html': small })), []);
  const large = small.replace('<h1>Klein</h1>', `<p>${noise(40_000)}</p>`);
  assert.deepEqual(ids(run(auditBudgetHead, { 'index.html': large })), ['budget-head']);
});

test('budget-head fails a CSP meta over cspBytes compressed, alone', () => {
  const hashes = Array.from({ length: 200 }, (_, index) => `x${index}`);
  const csp = cspContent(OPTIONS, { scripts: hashes, styles: ['@layer reset{*{margin:0}}'] });
  const report = run([auditBudgetHead, auditBudgetDocument], one('/', { csp }));
  assert.deepEqual(ids(report), ['budget-head']);
  assert.equal(report.findings.length, 1);
  const meta = `<meta http-equiv="content-security-policy" content="${csp}">`;
  const detail = report.findings[0]?.detail ?? '';
  assert.ok(
    detail.startsWith(
      `the CSP meta has ${bytes(compressedSize(meta))} compressed; at most ${bytes(LIMITS.cspBytes)} (markup `,
    ),
    detail,
  );
});

test('budget-head gives two findings for a page over both of its limits, and the budgets audit runs all four', () => {
  const hashes = Array.from({ length: 200 }, (_, index) => `x${index}`);
  const css = `@layer page{.a{--x:"${noise(70_000)}"}}`;
  const csp = cspContent(OPTIONS, { scripts: hashes, styles: [css] });
  const head = run(auditBudgetHead, one('/', { css, csp }));
  assert.equal(head.findings.length, 2);
  const ctx = contextOf(one('/', { css, csp }));
  auditBudgets(ctx);
  assert.deepEqual(ids(ctx.report), ['budget-document', 'budget-head']);
});

test('budget-head has nothing to measure for a page without a CSP meta: csp-meta reports it', () => {
  const html = '<!DOCTYPE html><html lang="de-CH"> <head><title>Ohne Richtlinie</title></head> <body></body> </html>';
  assert.deepEqual(ids(run(auditBudgetHead, { 'index.html': html })), []);
});

// budget-document

test('budget-document passes the fixture site', () => {
  assert.deepEqual(ids(run(auditBudgetDocument, site())), []);
});

test('budget-document fails a page over documentBytes compressed, at the page', () => {
  const files = one('/zimmer/', { main: `<h1>Zimmer</h1> <p>${noise(70_000)}</p>` });
  const ctx = contextOf(files);
  auditBudgetDocument(ctx);
  assert.deepEqual(ids(ctx.report), ['budget-document']);
  const size = compressedSize(ctx.read('zimmer/index.html') ?? new Uint8Array());
  assert.deepEqual(findings(ctx.report), [
    `budget-document /zimmer/ the page has ${bytes(size)} compressed; at most ${bytes(LIMITS.documentBytes)}`,
  ]);
});

test('budget-document measures the bytes of the file as built', () => {
  const html = page(OPTIONS, '/', { main: `<h1>Bytes</h1> <p>${noise(70_000)}</p>` });
  assert.deepEqual(ids(run(auditBudgetDocument, { ...ICON_FILES, 'index.html': utf8(html) })), ['budget-document']);
  const lowered = optionsOf({ ...TWO_LOCALES, limits: { documentBytes: 1_000 } });
  const small = { ...ICON_FILES, 'index.html': page(lowered, '/') };
  assert.deepEqual(ids(run(auditBudgetDocument, small, { options: lowered })), ['budget-document']);
});

// budget-dom

/** The number of elements and the depth of the fixture home page with an empty main. */
function measure(files: Files): { count: number; depth: number } {
  const ctx = contextOf(files);
  const built = ctx.pages[0];
  if (built === undefined) throw new Error('audit-budgets: no page');
  const dom = domOf(built);
  return { count: dom.elements.length, depth: Math.max(...dom.elements.map((element) => dom.depth(element))) };
}

const EMPTY_MAIN = measure(one('/', { main: '<h1>Leer</h1>' }));

test('budget-dom passes the fixture site', () => {
  assert.deepEqual(ids(run(auditBudgetDom, site())), []);
});

test('budget-dom passes exactly domElements elements and fails one more, at the page', () => {
  const extra = LIMITS.domElements - EMPTY_MAIN.count;
  const at = one('/', { main: `<h1>Leer</h1>${'<i></i>'.repeat(extra)}` });
  assert.equal(measure(at).count, LIMITS.domElements);
  assert.deepEqual(ids(run(auditBudgetDom, at)), []);
  const over = one('/', { main: `<h1>Leer</h1>${'<i></i>'.repeat(extra + 1)}` });
  const report = run(auditBudgetDom, over);
  assert.deepEqual(ids(report), ['budget-dom']);
  assert.deepEqual(findings(report), [`budget-dom / 1,401 elements; at most ${LIMITS.domElements}`]);
});

test('budget-dom passes a depth of exactly 32 (html is 1) and fails 33', () => {
  // main is at depth 3; its h1 at 4. Each nested div adds one.
  const nest = (levels: number): Files =>
    one('/', { main: `<h1>Tief</h1>${'<div>'.repeat(levels)}${'</div>'.repeat(levels)}` });
  const at = nest(LIMITS.domDepth - 3);
  assert.equal(measure(at).depth, LIMITS.domDepth);
  assert.deepEqual(ids(run(auditBudgetDom, at)), []);
  const report = run(auditBudgetDom, nest(LIMITS.domDepth - 2));
  assert.deepEqual(findings(report), [`budget-dom / depth 33; at most ${LIMITS.domDepth}`]);
});

test('budget-dom gives one finding for each broken limit', () => {
  const main = `<h1>Beides</h1>${'<div>'.repeat(40)}${'</div>'.repeat(40)}${'<i></i>'.repeat(1_500)}`;
  const report = run(auditBudgetDom, one('/', { main }));
  assert.deepEqual(ids(report), ['budget-dom']);
  assert.equal(report.findings.length, 2);
  const lowered = optionsOf({ ...TWO_LOCALES, limits: { domElements: 20 } });
  const files = { ...ICON_FILES, 'index.html': page(lowered, '/') };
  assert.deepEqual(ids(run(auditBudgetDom, files, { options: lowered })), ['budget-dom']);
});

// budget-fonts

test('budget-fonts has the exact regex of the specification', () => {
  const row = SPEC.split('\n').find((line) => line.startsWith('| `budget-fonts` |')) ?? '';
  assert.ok(row.includes(`The regex is \`${FONT_PATH.toString().replaceAll('|', '\\|')}\``), row);
});

test('fontPaths finds what the exact regex finds, on many generated texts', () => {
  const pieces = [
    '/',
    '.',
    'woff',
    'woff2',
    'WOFF2',
    'ttf',
    'otf',
    'Otf',
    '?',
    '#',
    '"',
    "'",
    '(',
    ')',
    ' ',
    ',',
    'a',
    'x',
    ' ',
    '-',
    '\n',
  ];
  let state = 7;
  const next = (): number => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state >>> 8;
  };
  for (let index = 0; index < 5_000; index += 1) {
    const length = 1 + (next() % 16);
    const text = Array.from({ length }, () => pieces[next() % pieces.length]).join('');
    assert.deepEqual(fontPaths(text), text.match(FONT_PATH) ?? [], JSON.stringify(text));
  }
  for (const text of [
    'url(/_astro/a.woff2?v=1)',
    '"/f/a.ttf#x" /b.otf',
    '/a.woff2x /b.woff',
    'x/.woff2',
    '//.woff',
    'url(/a.b/c.WOFF)',
  ]) {
    assert.deepEqual(fontPaths(text), text.match(FONT_PATH) ?? [], text);
  }
});

test('fontPaths is linear on a long run of slashes and dots', () => {
  const start = performance.now();
  assert.deepEqual(fontPaths(`${'/a.'.repeat(700_000)}x`), []);
  assert.deepEqual(fontPaths(`${'/a.'.repeat(700_000)}woff`), [`${'/a.'.repeat(700_000)}woff`]);
  assert.ok(performance.now() - start < 2_000);
});

/** A font file of a set size. */
const font = (size: number): Uint8Array => new Uint8Array(size).fill(0x77);

/** The fixture site with font files and a sheet that names them. */
function withFonts(fonts: Readonly<Record<string, number>>, sheet: string): Files {
  const files: Record<string, string | Uint8Array> = { ...site(), '_astro/fonts.css': sheet };
  for (const [file, size] of Object.entries(fonts)) files[file] = font(size);
  return files;
}

test('budget-fonts passes the fixture site and font files of exactly fontBytes', () => {
  assert.deepEqual(ids(run(auditBudgetFonts, site())), []);
  const files = withFonts({ '_astro/a.woff2': LIMITS.fontBytes }, '@font-face{src:url(/_astro/a.woff2)}');
  assert.deepEqual(ids(run(auditBudgetFonts, files)), []);
});

test('budget-fonts fails font files over fontBytes once for the site, at /', () => {
  const files = withFonts(
    { '_astro/a.woff2': 60_000, '_astro/b.woff2': 42_401 },
    '@font-face{src:url(/_astro/a.woff2) format("woff2")}@font-face{src:url("/_astro/b.woff2?v=2")}',
  );
  const report = run(auditBudgetFonts, files);
  assert.deepEqual(ids(report), ['budget-fonts']);
  assert.deepEqual(findings(report), [
    'budget-fonts / 102,401 B in 2 font files; at most 102,400 B: /_astro/a.woff2 60,000 B, /_astro/b.woff2 42,401 B',
  ]);
});

test('budget-fonts counts each file once, and a reference in a page as well as in a sheet', () => {
  const twice = withFonts(
    { '_astro/a.woff2': 60_000 },
    '@font-face{src:url(/_astro/a.woff2)}@font-face{src:url(/_astro/a.woff2#x)}',
  );
  assert.deepEqual(ids(run(auditBudgetFonts, twice)), []);
  const preload = '<link rel="preload" href="/_astro/b.woff2" as="font" type="font/woff2" crossorigin>';
  const files: Record<string, string | Uint8Array> = {
    ...twice,
    'index.html': page(OPTIONS, '/', { alternates: { de: '/', fr: '/fr/' }, head: preload }),
    '_astro/b.woff2': font(50_000),
  };
  assert.deepEqual(ids(run(auditBudgetFonts, files)), ['budget-fonts']);
  const inline = `<style>@font-face{src:url(/_astro/b.woff2)}</style>`;
  const viaStyle: Record<string, string | Uint8Array> = {
    ...twice,
    'index.html': page(OPTIONS, '/', { alternates: { de: '/', fr: '/fr/' }, head: inline }),
    '_astro/b.woff2': font(50_000),
  };
  assert.deepEqual(ids(run(auditBudgetFonts, viaStyle)), ['budget-fonts']);
});

test('budget-fonts adds nothing for a path that names no dist file, and nothing for a file no page names', () => {
  const missing = withFonts({}, '@font-face{src:url(/_astro/nicht.woff2)}');
  assert.deepEqual(ids(run(auditBudgetFonts, missing)), []);
  const unnamed = withFonts({ '_astro/a.woff2': 200_000 }, '@font-face{src:local(Arial)}');
  assert.deepEqual(ids(run(auditBudgetFonts, unnamed)), []);
  const encoded = withFonts({ '_astro/a b.woff2': 200_000 }, '@font-face{src:url(/_astro/a%20b.woff2)}');
  assert.deepEqual(ids(run(auditBudgetFonts, encoded)), ['budget-fonts']);
});

// Hostile input

const RULES: readonly (readonly [string, Rule])[] = [
  ['budget-head', auditBudgetHead],
  ['budget-document', auditBudgetDocument],
  ['budget-dom', auditBudgetDom],
  ['budget-fonts', auditBudgetFonts],
];

/** A page of about 2 MB of text that compresses badly, with font paths and slashes. */
const largePage = (): string =>
  page(OPTIONS, '/gross/', { main: `<h1>Gross</h1> <p>${noise(1_000_000)}</p> <p>${'/a.'.repeat(300_000)}woff2</p>` });

/** A page that nests 5,000 elements deep. */
const deepPage = (): string =>
  page(OPTIONS, '/tief/', { main: `<h1>Tief</h1>${'<div>'.repeat(5_000)}x${'</div>'.repeat(5_000)}` });

/** A page with attributes named constructor and __proto__, a lone surrogate and U+0000 in text and attributes. */
const oddPage = (): string =>
  page(OPTIONS, '/odd/', {
    head: '<meta constructor="x" http-equiv="content-security-policy" content="\ud800"><style __proto__="y">\u0000</style>',
    main: '<h1 constructor="1">\ud800\u0000</h1> <p __proto__="2" title="\ud800">/\ud800.woff2 \u0000</p>',
  });

const HOSTILE: Files = {
  ...ICON_FILES,
  'gross/index.html': largePage(),
  'tief/index.html': deepPage(),
  'odd/index.html': oddPage(),
  'noheadclose.html': `<html><head><title>x</title><body>${'<p>'.repeat(3_000)}`,
};

const hostile = contextOf(HOSTILE);

const HOSTILE_IDS: ReadonlyMap<string, readonly string[]> = new Map([
  ['budget-head', []],
  ['budget-document', ['budget-document']],
  ['budget-dom', ['budget-dom']],
  ['budget-fonts', []],
]);

for (const [id, rule] of RULES) {
  test(`${id} does not throw on a page of 2 MB, a page nested 5,000 deep or odd bytes, and gives a stable result`, () => {
    const first = { ...hostile, report: new Report() };
    const start = performance.now();
    rule(first);
    const elapsed = performance.now() - start;
    const second = { ...hostile, report: new Report() };
    rule(second);
    assert.deepEqual(findings(second.report), findings(first.report));
    assert.deepEqual(ids(first.report), HOSTILE_IDS.get(id));
    assert.ok(elapsed < 3_000, `${id} took ${Math.round(elapsed)} ms`);
  });
}

// Review cases of part 5c: each limit holds at its exact value

/** The compressed size of the head of the fixture page at `/` (up to and including `</head>`), and of the file. */
function measured(files: Files): { head: number; document: number } {
  const built = contextOf(files).pages[0];
  if (built === undefined) throw new Error('audit-budgets: no page');
  const end = domOf(built).head?.range[1] ?? 0;
  return { head: compressedSize(built.html.slice(0, end)), document: compressedSize(utf8(built.html)) };
}

/**
 * A policy whose CSP meta compresses to exactly `size` bytes: the fixture policy with one more source of noise,
 * found by a search over its length. The compressed size moves in steps, so one noise sequence can miss a size; the
 * search then tries the next seed. Throws when no seed and length give the size.
 */
function policyOfSize(size: number): string {
  const base = cspContent(OPTIONS, { styles: [PAGE_CSS] });
  for (let seed = 7; seed < 47; seed += 1) {
    const sizeOf = (length: number): number =>
      compressedSize(`<meta http-equiv="content-security-policy" content="${base} ${noise(length, seed)}">`);
    let low = 0;
    let high = 40_000;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (sizeOf(middle) < size) low = middle + 1;
      else high = middle;
    }
    for (let length = Math.max(0, low - 64); length < low + 64; length += 1) {
      if (sizeOf(length) === size) return `${base} ${noise(length, seed)}`;
    }
  }
  throw new Error(`audit-budgets: no policy compresses to ${size} B`);
}

test('budget-head passes a head of exactly headBytes and fails one byte less of limit', () => {
  const files = { ...ICON_FILES, 'index.html': page(OPTIONS, '/') };
  const { head } = measured(files);
  const exact = optionsOf({ ...TWO_LOCALES, limits: { headBytes: head } });
  assert.deepEqual(ids(run(auditBudgetHead, files, { options: exact })), []);
  const less = optionsOf({ ...TWO_LOCALES, limits: { headBytes: head - 1 } });
  assert.deepEqual(ids(run(auditBudgetHead, files, { options: less })), ['budget-head']);
});

test('budget-head passes a CSP meta of exactly cspBytes and fails one of cspBytes + 1', () => {
  const exact = one('/', { csp: policyOfSize(LIMITS.cspBytes) });
  assert.deepEqual(ids(run(auditBudgetHead, exact)), []);
  const over = one('/', { csp: policyOfSize(LIMITS.cspBytes + 1) });
  assert.deepEqual(ids(run(auditBudgetHead, over)), ['budget-head']);
});

test('budget-document passes a page of exactly documentBytes and fails one byte less of limit', () => {
  const files = { ...ICON_FILES, 'index.html': page(OPTIONS, '/') };
  const { document } = measured(files);
  const exact = optionsOf({ ...TWO_LOCALES, limits: { documentBytes: document } });
  assert.deepEqual(ids(run(auditBudgetDocument, files, { options: exact })), []);
  const less = optionsOf({ ...TWO_LOCALES, limits: { documentBytes: document - 1 } });
  assert.deepEqual(ids(run(auditBudgetDocument, files, { options: less })), ['budget-document']);
});

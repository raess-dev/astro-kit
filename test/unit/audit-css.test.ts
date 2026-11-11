import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { auditCss, KIT_CLASSES, layerOrder, parseCss } from '../../src/audit/css.ts';
import { auditHtml } from '../../src/audit/html.ts';
import { parseHtml } from '../../src/build.ts';
import type { BuildContext, BuiltCss } from '../../src/context.ts';
import { effectiveLimits, optionsSchema } from '../../src/options.ts';
import { Report } from '../../src/registry.ts';

const OPTIONS = optionsSchema.parse({
  site: 'https://example.ch',
  locales: [{ code: 'de', tag: 'de-CH', name: 'Deutsch' }],
  defaultLocale: 'de',
  securityContact: 'mailto:security@example.ch',
});

/** A minimal context: one page per path, no records, nothing on disk. */
function context(pages: Record<string, string>, css: BuiltCss[] = [], dir = '/nowhere'): BuildContext {
  return {
    root: dir,
    dist: dir,
    options: OPTIONS,
    limits: effectiveLimits(OPTIONS),
    manifest: { pages: [], byId: {}, drafts: false },
    site: undefined,
    schedule: { openingHours: [], closures: [] },
    messages: {},
    pages: Object.entries(pages).map(([path, html]) => ({
      file: join(dir, path, 'index.html'),
      path,
      html,
      doc: parseHtml(html),
      locale: 'de',
      is404: false,
    })),
    css,
    files: [],
    redirects: [],
    wrangler: undefined,
    report: new Report(),
    env: {},
  };
}

const KIT =
  '@layer kit.reset{*{box-sizing:border-box}}@layer kit.tokens{:root{--bg:#fff;--fg:light-dark(#111,#eee)}}@layer kit.base{body{background:var(--bg);color:var(--fg)}}';
const page = (css: string, body = '<p>Text</p>') =>
  `<!DOCTYPE html><html lang="de"><head><meta charset="utf-8"><title>Seite</title><style>${css}</style></head><body><main>${body}</main></body></html>`;

/** Runs the CSS audit on one page and returns rule → details. */
function cssFindings(css: string, body?: string): Map<string, string[]> {
  const ctx = context({ '/': page(css, body) });
  auditCss(ctx);
  const out = new Map<string, string[]>();
  for (const f of ctx.report.findings) out.set(f.rule, [...(out.get(f.rule) ?? []), f.detail ?? '']);
  return out;
}

test('parseCss keeps strings, url() and nesting intact', () => {
  const tree = parseCss(
    '/* c{ */a{content:"}{;";background:url(data:image/png;base64,AA==)}b{&:hover{color:var(--x)}}@layer x;',
  );
  assert.deepEqual(tree[0], {
    type: 'rule',
    selector: 'a',
    children: [
      { type: 'decl', prop: 'content', value: '"}{;"' },
      { type: 'decl', prop: 'background', value: 'url(data:image/png;base64,AA==)' },
    ],
  });
  assert.equal(tree[1]?.type === 'rule' && tree[1].children[0]?.type, 'rule');
  assert.deepEqual(tree[2], { type: 'at', name: 'layer', prelude: 'x' });
});

test('KIT_CLASSES is the frozen twelve-class list', () => {
  assert.equal(KIT_CLASSES.length, 12);
  assert.ok(Object.isFrozen(KIT_CLASSES));
});

test('a kit-shaped page passes every CSS rule', () => {
  const css = `${KIT}@layer theme{:root{--brand:oklch(60% .2 250)}}@layer astro.images{:where([data-astro-image]){height:auto}}
    .card[data-astro-cid-abc]{color:var(--brand);border:1px solid currentColor;outline-color:Canvas;background:transparent}
    .card[data-astro-cid-abc]:hover{& .title{color:var(--fg)}}.muted,.visually-hidden{color:var(--fg)}
    .x[data-astro-cid-abc]{margin-inline:calc(50% - 50vw);content:"#fff";background:url(#red);width:var(--w,100%)}
    @property --w{syntax:'<length>';inherits:false;initial-value:0px}@keyframes fade{from{opacity:0}to{opacity:1}}
    astro-island,astro-slot{display:contents}`;
  assert.deepEqual([...cssFindings(css).keys()], []);
});

test('css-layer-order: kit.reset first and the kit order kept, also when split', () => {
  assert.deepEqual(layerOrder(parseCss('@layer kit.reset;@layer kit.tokens{a{b:c}}@layer theme;')), [
    'kit.reset',
    'kit.tokens',
    'theme',
  ]);
  assert.deepEqual(layerOrder(parseCss('@layer kit{@layer reset{}}@layer kit.base,theme;')), [
    'kit',
    'kit.reset',
    'kit.base',
    'theme',
  ]);
  const ok = (css: string) => !cssFindings(css).has('css-layer-order');
  assert.ok(ok('@layer kit.reset,kit.tokens,kit.base,theme;'));
  assert.ok(ok('@layer kit.reset;@layer kit.tokens{:root{--a:0}}@layer theme;'));
  assert.ok(ok('@layer astro.images{}@layer kit.reset{}@layer components{}'));
  assert.ok(!ok('@layer theme;@layer kit.reset{}'));
  assert.ok(!ok('@layer components{}@layer kit.reset{}'));
  assert.ok(!ok('@layer kit.reset,kit.base,kit.tokens;'));
  assert.ok(!ok('a{color:inherit}'));
});

test('css-var-undefined: var() without a fallback needs a definition', () => {
  assert.deepEqual(cssFindings(`${KIT}a{color:var(--nope)}`).get('css-var-undefined'), ['var(--nope)']);
  assert.deepEqual(cssFindings(`${KIT}a{color:var(--nope,var(--gone))}`).get('css-var-undefined'), ['var(--gone)']);
  assert.ok(!cssFindings(`${KIT}a{color:var(--nope,inherit)}`).has('css-var-undefined'));
  assert.ok(!cssFindings(`${KIT}@property --p{syntax:'*';inherits:true}a{color:var(--p)}`).has('css-var-undefined'));
});

test('css-literal: colour literals only in custom properties and the token layers', () => {
  const literal = (css: string) => cssFindings(`${KIT}${css}`).get('css-literal') ?? [];
  assert.equal(literal('@layer kit.base{a{color:#123456}}').length, 1);
  assert.equal(literal('a[data-astro-cid-x]{border:1px solid red}').length, 1);
  assert.equal(literal('a[data-astro-cid-x]{box-shadow:0 0 2px rgb(0 0 0/.5)}').length, 1);
  assert.equal(literal('a[data-astro-cid-x]{color:light-dark(#000,#fff)}').length, 1);
  assert.equal(literal('a[data-astro-cid-x]{--local:hsl(0 0% 0%)}').length, 0);
  assert.equal(literal('@layer theme{a{color:tomato}}').length, 0);
  assert.equal(
    literal(
      'a[data-astro-cid-x]{color:currentColor;background:transparent;border-color:inherit;outline-color:CanvasText}',
    ).length,
    0,
  );
  assert.equal(literal('a[data-astro-cid-x]{font-family:Tan;animation-name:red}').length, 0);
  assert.equal(literal('a[data-astro-cid-x]{border-color:#0000;outline-color:#00000000}').length, 0);
  assert.equal(literal('a[data-astro-cid-x]{border-color:#0001}').length, 1);
});

test('css-classes: global classes come from the kit list', () => {
  assert.deepEqual(cssFindings(`${KIT}.card{color:inherit}`).get('css-classes'), ['.card in ".card"']);
  assert.deepEqual(cssFindings(`${KIT}.a[data-astro-cid-x],.loose{color:inherit}`).get('css-classes'), [
    '.loose in ".loose"',
  ]);
  assert.deepEqual(cssFindings(`${KIT}main :is(.lead,.hero){color:inherit}`).get('css-classes'), [
    '.hero in "main :is(.lead,.hero)"',
  ]);
  assert.ok(
    !cssFindings(`${KIT}.a[data-astro-cid-x]{&.b{color:inherit}}@layer kit.base{.anything{color:inherit}}`).has(
      'css-classes',
    ),
  );
});

test('css-banned: viewport widths, root overflow, forced-color-adjust none and style attributes', () => {
  const banned = (css: string, body?: string) => cssFindings(`${KIT}${css}`, body).get('css-banned') ?? [];
  assert.equal(banned('body{overflow-x:hidden}').length, 1);
  assert.equal(banned('html{overflow:clip}').length, 1);
  assert.equal(banned(':root,main{overflow-x:clip}').length, 1);
  assert.equal(banned('.full-bleed{width:100vw}').length, 1);
  assert.equal(banned('.full-bleed{max-width:100dvw}').length, 1);
  assert.equal(banned('.x[data-astro-cid-a]{margin-left:calc(-100vw + 50%)}').length, 1);
  assert.equal(banned('a{forced-color-adjust:none}').length, 1);
  assert.equal(banned('', '<p style="color:red">Text</p>').length, 1);
  assert.equal(banned('.x[data-astro-cid-a]{overflow-x:hidden;height:100vh;forced-color-adjust:auto}').length, 0);
  assert.equal(banned('body{overflow-y:hidden}').length, 0);
});

test('a finding repeated on every page is reported once with a count, and linked sheets count', () => {
  const linked =
    '<!DOCTYPE html><html lang="de"><head><link rel="stylesheet" href="/_astro/a.css"></head><body></body></html>';
  const ctx = context(
    { '/': page(`${KIT}.card{color:inherit}`), '/b/': page(`${KIT}.card{color:inherit}`), '/c/': linked },
    [{ where: '/_astro/a.css', text: `${KIT}.loose{color:inherit}` }],
  );
  auditCss(ctx);
  const details = ctx.report.findings.map((f) => `${f.where} ${f.detail}`);
  assert.deepEqual(details, ['/ .card in ".card"; on 2 pages', '/c/ .loose in ".loose"']);
});

const GOOD_HTML =
  '<!DOCTYPE html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Muster – Beratung für KMU</title></head>' +
  '<body><a href="#main">Zum Inhalt</a><header><nav aria-label="Hauptnavigation"><a href="/">Start</a></nav></header><main id="main"><h1>Muster</h1><h2>Leistungen</h2>' +
  '<img src="/_astro/a.webp" alt="Ein Bild" width="10" height="10"><script type="module" src="/_astro/a.js"></script></main><footer><p>Fuss</p></footer></body></html>';

test('html-validate: a clean page passes, broken markup reports the html-validate rule and line', async () => {
  const good = context({ '/': GOOD_HTML });
  await auditHtml(good);
  assert.deepEqual(good.report.findings, []);

  const bad = GOOD_HTML.replace('<p>Fuss</p>', '<div role="button">Fuss</div><p id="twin">a</p><p id="twin">b</p>');
  const ctx = context({ '/': bad });
  await auditHtml(ctx);
  const details = ctx.report.findings.map((f) => f.detail ?? '');
  assert.ok(ctx.report.findings.every((f) => f.rule === 'html-validate'));
  for (const rule of ['prefer-native-element at 1:', 'no-dup-id at 1:']) {
    assert.ok(
      details.some((d) => d.startsWith(rule)),
      `${rule} in ${details.join(' | ')}`,
    );
  }
});

test('html-validate stays quiet where a kit rule reports the same defect', async () => {
  const bad = GOOD_HTML.replace('alt="Ein Bild" ', '').replace('<h2>Leistungen</h2>', '\n<h3>Leistungen</h3>');
  const ctx = context({ '/': bad });
  await auditHtml(ctx);
  assert.deepEqual(ctx.report.findings, []);
});

test('html-validate ignores a project config file', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'kit-html-'));
  writeFileSync(
    join(dir, '.htmlvalidate.json'),
    JSON.stringify({ root: true, rules: { 'prefer-native-element': 'off', 'no-dup-id': 'off' } }),
  );
  const ctx = context({ '/': GOOD_HTML.replace('<p>Fuss</p>', '<div role="button">Fuss</div>') }, [], dir);
  await auditHtml(ctx);
  rmSync(dir, { recursive: true, force: true });
  assert.ok(ctx.report.findings.some((f) => f.detail?.startsWith('prefer-native-element')));
});

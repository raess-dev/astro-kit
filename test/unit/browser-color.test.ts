import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  AXE_ENHANCED,
  AXE_GRADIENT,
  AXE_OPTIONS,
  AXE_REVIEW_FAILS,
  AXE_TAGS,
  axeRule,
  COLOR_RULES,
  contrastPairs,
  MODES_VIEWPORTS,
  NOT_RUNNING_TEXT,
  pixelText,
  ROLE_RATIOS,
  RUNNING_TEXT,
  ratioText,
} from '../../src/browser/color.ts';
import type { BrowserRule } from '../../src/browser/harness.ts';
import type { Design } from '../../src/context.ts';
import { renderTokens } from '../../src/design/tokens.ts';
import type { Options } from '../../src/options.ts';
import { RULE_BY_ID } from '../../src/registry.ts';
import { BODY, CSS, findingsOf, html, idsOf, SETTINGS, useBrowser } from './browser-fixtures.ts';
import { DESIGN, DESIGN_TEXT, designOf, SWITCH } from './css-rules-fixtures.ts';
import { SPEC } from './spec.ts';

const browser = useBrowser();

/** The details of the findings of one run, each with its `where` in front. */
async function placesOf(
  files: Record<string, string>,
  rule: BrowserRule,
  parts: { settings?: Options; design?: Design } = {},
): Promise<string[]> {
  const findings = await findingsOf(browser(), files, [rule], parts);
  return findings.map((finding) => `${finding.where} ${finding.detail ?? ''}`);
}

/** The standard of a rule in the registry, which `docs/standards.md` and section 8 hold too. */
const standardOf = (id: string): string => RULE_BY_ID.get(id)?.standard ?? '';

test('the rules of src/browser/color.ts, in their order, and their scopes (modes-behavior: browser-modes.test.ts)', () => {
  assert.deepEqual(
    COLOR_RULES.map((rule) => [rule.id, rule.pages]),
    [
      ['modes-behavior', 'home'],
      ['a11y-axe', 'tested'],
      ['contrast-pairs', 'home'],
    ],
  );
});

test('the values of the rules are the values of section 8', () => {
  assert.deepEqual(AXE_TAGS, ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice']);
  assert.ok(
    SPEC.includes('No axe violation with tags `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, `wcag22aa`, `best-practice`'),
  );
  assert.deepEqual(AXE_REVIEW_FAILS, ['bgImage', 'imgNode', 'pseudoContent']);
  assert.ok(SPEC.includes('`color-contrast` with reason `bgImage`, `imgNode` or `pseudoContent`, and `video-caption`'));
  assert.equal(AXE_GRADIENT, 'bgGradient');
  assert.equal(AXE_ENHANCED, 'color-contrast-enhanced');
  assert.equal(RUNNING_TEXT, 'p, li, dd, td, th, blockquote, figcaption');
  assert.equal(NOT_RUNNING_TEXT, 'a, button, label, summary');
  const running =
    'inside `main`, in a `p`, `li`, `dd`, `td`, `th`, `blockquote` or `figcaption`, not inside `a`, `button`, `label` or `summary`';
  assert.ok(standardOf('a11y-axe').includes(running));
  assert.ok(SPEC.includes(running));
  assert.deepEqual(AXE_OPTIONS, {
    runOnly: { type: 'tag', values: [...AXE_TAGS] },
    rules: { 'color-contrast-enhanced': { enabled: true } },
    resultTypes: ['violations', 'incomplete'],
    elementRef: true,
  });
  assert.deepEqual(
    [...ROLE_RATIOS],
    [
      ['text', 7],
      ['ui', 4.5],
      ['non-text', 3],
    ],
  );
  assert.ok(SPEC.includes('every design.md pair meets its role ratio: text 7, ui 4.5, non-text 3.'));
  assert.deepEqual(
    MODES_VIEWPORTS.map((viewport) => `${viewport.width}×${viewport.height}`),
    ['1280×800', '390×844'],
  );
  assert.ok(SPEC.includes('With two or more mode options, on the default home, at 1280×800 and at 390×844'));
});

test('a ratio is cut to two decimals, so a failing ratio never reads as its floor; a pixel shows its channels', () => {
  assert.equal(ratioText(4.4999), '4.49');
  assert.equal(ratioText(7), '7.00');
  assert.equal(pixelText([43, 37, 33, 255]), '[43, 37, 33, 255]');
  assert.equal(pixelText([]), 'no color');
});

// a11y-axe

/** The page that meets every rule of this file. */
const PASSING = { 'index.html': html(BODY, { css: CSS }) };

/** A page with `main` content and extra CSS. */
const axePage = (main: string, css = ''): Record<string, string> => ({
  'index.html': html(`<a href="#main">Zum Inhalt</a><main id="main"><h1>Willkommen</h1>${main}</main>`, {
    css: CSS + css,
  }),
});

test('a11y-axe: the smallest page passes, in both themes of the design', async () => {
  assert.deepEqual(await placesOf(PASSING, axeRule), []);
});

test('a11y-axe: an image without alt fails, once, in the first theme', async () => {
  assert.deepEqual(await placesOf(axePage('<p><img src="/foto.png" width="10" height="10"></p>'), axeRule), [
    '/ 1280×800 in the light theme: image-alt on img',
  ]);
  assert.deepEqual(await idsOf(browser(), axePage('<button type="button"></button>'), [axeRule]), ['a11y-axe']);
});

test('a11y-axe: a contrast fault that only the dark theme shows fails there', async () => {
  const css = '@media (prefers-color-scheme: dark){body{background:#000;color:#fff}a{color:#fff}p{color:#333}}';
  assert.deepEqual(await placesOf(axePage('<p>Ein Absatz mit Text.</p>', css), axeRule), [
    '/ 1280×800 in the dark theme: color-contrast on p',
  ]);
});

test('a11y-axe: color-contrast-enhanced counts on running text in main only', async () => {
  // #767676 on white is 4.54:1: AA passes, AAA (7:1) fails.
  const css = '.grey{color:#767676}';
  assert.deepEqual(await placesOf(axePage('<p class="grey">Ein grauer Absatz.</p>', css), axeRule), [
    '/ 1280×800 in the light theme: color-contrast-enhanced on p.grey',
  ]);
  assert.deepEqual(await placesOf(axePage('<ul><li class="grey">Ein grauer Punkt.</li></ul>', css), axeRule), [
    '/ 1280×800 in the light theme: color-contrast-enhanced on li.grey',
  ]);
  // A link, a heading and text outside main are no running text.
  assert.deepEqual(await placesOf(axePage('<p><a class="grey" href="/a/">Ein grauer Link</a></p>', css), axeRule), []);
  assert.deepEqual(await placesOf(axePage('<h2 class="grey">Ein grauer Titel</h2>', css), axeRule), []);
  const outside = html(`${BODY}<footer><p class="grey">Ein grauer Fuss.</p></footer>`, { css: CSS + css });
  assert.deepEqual(await placesOf({ 'index.html': outside }, axeRule), []);
});

test('a11y-axe: text on a gradient is decided with the color stops of the gradient', async () => {
  const on = (stops: string): Record<string, string> =>
    axePage(
      '<p class="hero">Text auf einem Verlauf.</p>',
      `.hero{color:#000;background-image:linear-gradient(${stops})}`,
    );
  // Black on #777777 is 4.69:1, on white 21:1: every stop gives at least 4.5:1.
  assert.deepEqual(await placesOf(on('#ffffff, #777777'), axeRule), []);
  // Black on #333333 is 1.66:1.
  assert.deepEqual(await placesOf(on('#ffffff 0%, #333333 100%'), axeRule), [
    '/ 1280×800 in the light theme: color-contrast on p.hero: 1.66:1 on the gradient stop rgb(51, 51, 51), 4.5:1 expected',
  ]);
  // A stop with alpha is composited over white first: #00000080 gives rgb(127, 127, 127), and black on it is 5.25:1.
  assert.deepEqual(await placesOf(on('#ffffff, #00000080'), axeRule), []);
});

test('a11y-axe: the needs-review results bgImage, pseudoContent and video-caption fail', async () => {
  const photo = {
    ...axePage('<p class="photo">Text auf einem Foto.</p>', '.photo{color:#000;background-image:url(/foto.svg)}'),
    'foto.svg': '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>',
  };
  assert.deepEqual(await placesOf(photo, axeRule), [
    '/ 1280×800 in the light theme: color-contrast needs review (bgImage) on p.photo',
  ]);
  const pseudo = axePage(
    '<p class="pseudo">Text vor einem Bild.</p>',
    '.pseudo{position:relative;color:#000}.pseudo::before{content:"";position:absolute;inset:0;background-color:#0000ff40}',
  );
  assert.deepEqual(await placesOf(pseudo, axeRule), [
    '/ 1280×800 in the light theme: color-contrast needs review (pseudoContent) on p.pseudo',
  ]);
  const video = axePage('<video controls src="/film.mp4" width="320" height="180"></video>');
  assert.deepEqual(await placesOf(video, axeRule), [
    '/ 1280×800 in the light theme: video-caption needs review on video',
  ]);
});

test('a11y-axe: axe runs under a header CSP with Trusted Types on, as the kit writes it', async () => {
  // Trusted Types work only in a header (6.2), so `_headers` sets the policy. A page script that probes the policy
  // shows that it holds: an HTML sink throws, and the page records it.
  const policy =
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; require-trusted-types-for 'script'; trusted-types 'none'";
  const probe = "try { document.body.innerHTML += ''; } catch { document.documentElement.dataset.trusted = 'on'; }";
  const page = html(
    '<a href="#main">Zum Inhalt</a><main id="main"><h1>Willkommen</h1><p><img src="/foto.png" width="10" height="10"></p></main><script src="/probe.js"></script>',
    { css: CSS },
  );
  const files = { 'index.html': page, 'probe.js': probe, _headers: `/*\n  Content-Security-Policy: ${policy}\n` };
  assert.deepEqual(await placesOf(files, axeRule), ['/ 1280×800 in the light theme: image-alt on img']);
  // The policy is on: the probe rule below reads the mark that the page script set.
  const trusted: BrowserRule = {
    id: 'a11y-axe',
    pages: 'home',
    check: async (check) => {
      const tab = await check.open();
      const mark = await tab.evaluate(() => document.documentElement.dataset.trusted ?? 'off');
      check.report(mark);
    },
  };
  assert.deepEqual(await placesOf(files, trusted), ['/ on']);
});

// contrast-pairs

/** The settings with the switch (auto, light, dark). */
const MODES: Options = SWITCH;

/** A home page whose CSS is the rendering of a design for the settings, then `CSS`. */
const tokenPage = (design: Design, settings: Options, body = BODY): string =>
  html(body, {
    css: `${renderTokens(design, settings)}${CSS}body{color:var(--color-text);background:var(--color-page)}`,
  });

test('contrast-pairs: the pairs of the design pass in both themes', async () => {
  assert.deepEqual(await placesOf({ 'index.html': tokenPage(DESIGN, SETTINGS) }, contrastPairs), []);
  assert.deepEqual(await placesOf({ 'index.html': tokenPage(DESIGN, MODES) }, contrastPairs, { settings: MODES }), []);
});

test('contrast-pairs: a link color that is too dark in the dark theme fails there, with its line', async () => {
  const design = designOf(DESIGN_TEXT.replace('`#9cc8ff`', '`#333333`'));
  const line = design.pairs.find((pair) => pair.for === 'link')?.line;
  const expected = `/ the dark theme: --color-link on --color-page has 1.49:1; the role ui needs 4.5:1 (docs/design.md, line ${line})`;
  assert.deepEqual(await placesOf({ 'index.html': tokenPage(design, SETTINGS) }, contrastPairs, { design }), [
    expected,
  ]);
  // The same theme reached through `data-mode="dark"` with the switch.
  assert.deepEqual(
    await placesOf({ 'index.html': tokenPage(design, MODES) }, contrastPairs, { design, settings: MODES }),
    [expected],
  );
});

test('contrast-pairs: a foreground with alpha is composited over the background', async () => {
  // #7a3d00 at 50% over white is rgb(189, 158, 128): 2.42:1 on white, so the ui pair of the accent fails.
  const design = designOf(DESIGN_TEXT.replace('`#7a3d00`', '`#7a3d0080`'));
  const findings = await placesOf({ 'index.html': tokenPage(design, SETTINGS) }, contrastPairs, { design });
  assert.equal(findings.length, 1);
  assert.match(
    findings[0] ?? '',
    /^\/ the light theme: --color-accent on --color-page has 2\.\d\d:1; the role ui needs 4\.5:1/,
  );
});

test('contrast-pairs: only the default home is read', async () => {
  const design = designOf(DESIGN_TEXT.replace('`#9cc8ff`', '`#333333`'));
  const files = { 'index.html': tokenPage(DESIGN, SETTINGS), 'a/index.html': tokenPage(design, SETTINGS) };
  assert.deepEqual(await placesOf(files, contrastPairs), []);
});

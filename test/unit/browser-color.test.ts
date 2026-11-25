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
  grouped,
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

test('a11y-axe: running text inside an open shadow root in main counts, through the flat tree', async () => {
  // #767676 on white is 4.54:1: AA passes, AAA (7:1) fails. closest() stops at the shadow root; the flat tree does not.
  const shadow =
    '<div class="card"><template shadowrootmode="open"><style>p{color:#767676}</style><p>Ein grauer Absatz.</p></template></div>';
  const found = await placesOf(axePage(shadow, ''), axeRule);
  assert.equal(found.length, 1, JSON.stringify(found));
  assert.match(found[0] ?? '', /^\/ 1280×800 in the light theme: color-contrast-enhanced on /);
});

test('a11y-axe: text on a gradient is decided with the color stops of the gradient', async () => {
  const on = (stops: string): Record<string, string> =>
    axePage(
      '<p class="hero">Text auf einem Verlauf.</p>',
      `.hero{color:#000;background-image:linear-gradient(${stops})}`,
    );
  // Black on #999999 is 7.37:1, on white 21:1: every stop gives at least 7:1, the floor of running text.
  assert.deepEqual(await placesOf(on('#ffffff, #999999'), axeRule), []);
  // Black on #333333 is 1.66:1: AA and AAA fail.
  assert.deepEqual(await placesOf(on('#ffffff 0%, #333333 100%'), axeRule), [
    '/ 1280×800 in the light theme: color-contrast on p.hero: 1.66:1 on the gradient stop rgb(51, 51, 51), 4.5:1 expected',
    '/ 1280×800 in the light theme: color-contrast-enhanced on p.hero: 1.66:1 on the gradient stop rgb(51, 51, 51), 7:1 expected',
  ]);
  // A stop with alpha is composited over the color behind the gradient: here the white of the page. #00000040 gives
  // rgb(191, 191, 191), and black on it is 11.7:1.
  assert.deepEqual(await placesOf(on('#ffffff, #00000040'), axeRule), []);
});

test('a11y-axe: a lower gradient layer that an opaque upper layer hides does not count', async () => {
  // Black on #ffffff to #eeeeee is at least 18:1. The black layer below is hidden behind the opaque upper one.
  const css = '.hero{color:#000;background-image:linear-gradient(#ffffff, #eeeeee), linear-gradient(#000000, #000000)}';
  assert.deepEqual(await placesOf(axePage('<p class="hero">Text auf zwei Verlaeufen.</p>', css), axeRule), []);
  // A see-through upper stop shows the layer below: #00000000 over black is black, and black text on it is 1:1.
  const seeThrough =
    '.hero{color:#000;background-image:linear-gradient(#ffffff, #00000000), linear-gradient(#000000, #000000)}';
  const found = await placesOf(axePage('<p class="hero">Text auf zwei Verlaeufen.</p>', seeThrough), axeRule);
  assert.ok(
    found.some((line) => line.includes('1.00:1 on the gradient stop rgb(0, 0, 0)')),
    JSON.stringify(found),
  );
});

test('a11y-axe: a translucent background between the text and the gradient counts', async () => {
  // Black text on a 95% white paragraph over a black gradient: the text sits on about #f2f2f2, far above 7:1.
  const css =
    '.g{background-image:linear-gradient(#000000, #000000)}.t{color:#000;background-color:rgb(255 255 255 / 95%)}';
  assert.deepEqual(
    await placesOf(axePage('<div class="g"><p class="t">Text auf einem hellen Feld.</p></div>', css), axeRule),
    [],
  );
});

test('a11y-axe: a transparent gradient over a lower element with a gradient is read over that gradient', async () => {
  // White text on a transparent gradient over a black gradient: the text sits on black, 21:1.
  const css =
    '.p{background-image:linear-gradient(#000000, #000000)}.t{color:#fff;background-image:linear-gradient(transparent, transparent)}';
  assert.deepEqual(
    await placesOf(axePage('<div class="p"><p class="t">Weiss auf Schwarz.</p></div>', css), axeRule),
    [],
  );
});

test('a11y-axe: running text on a gradient must meet the AAA floor too, as on a flat color', async () => {
  // Black on #777777 is 4.68:1: AA passes, AAA fails on running text. A heading is no running text.
  const css = '.hero{color:#000;background-image:linear-gradient(#ffffff, #777777)}';
  assert.deepEqual(await placesOf(axePage('<p class="hero">Text auf einem Verlauf.</p>', css), axeRule), [
    '/ 1280×800 in the light theme: color-contrast-enhanced on p.hero: 4.68:1 on the gradient stop rgb(119, 119, 119), 7:1 expected',
  ]);
  assert.deepEqual(await placesOf(axePage('<h2 class="hero">Ein Titel auf einem Verlauf</h2>', css), axeRule), []);
  // #6b6b6b on a faint gradient is about 5:1 (axe passes color-contrast-enhanced there).
  const faint = '.g{color:#6b6b6b;background-image:linear-gradient(#fff,#f8f8f8)}';
  assert.deepEqual(await placesOf(axePage('<p class="g">Ein grauer Absatz.</p>', faint), axeRule), [
    '/ 1280×800 in the light theme: color-contrast-enhanced on p.g: 5.01:1 on the gradient stop rgb(248, 248, 248), 7:1 expected',
  ]);
});

test('a11y-axe: a gradient stop is composited over the color behind the gradient, not over white', async () => {
  // White text on a dark page under a gradient from transparent to a dark veil: about 21:1.
  const dark =
    'body{background:#000;color:#fff}a{color:#fff}.hero{color:#fff;background-image:linear-gradient(transparent, rgba(0,0,0,.5))}';
  assert.deepEqual(await placesOf(axePage('<p class="hero">Weiss auf Schwarz.</p>', dark), axeRule), []);
  // The same with the dark color on the element itself, under the gradient.
  const own = '.hero{color:#eee;background-color:#111;background-image:linear-gradient(rgb(0 0 0/.2),rgb(0 0 0/.4))}';
  assert.deepEqual(await placesOf(axePage('<p class="hero">Hell auf Dunkel.</p>', own), axeRule), []);
  // Grey text on a dark color under a faint light gradient: about 1.6:1, which a stop over white would hide.
  const faint =
    '.hero{color:#444;background-color:#222;background-image:linear-gradient(rgba(255,255,255,0), rgba(255,255,255,.1))}';
  const findings = await placesOf(axePage('<p class="hero">Grau auf Dunkel.</p>', faint), axeRule);
  assert.match(
    findings[0] ?? '',
    /^\/ 1280×800 in the light theme: color-contrast on p\.hero: 1\.\d\d:1 on the gradient stop rgb\(/,
  );
  assert.equal(findings.length, 2);
});

test('a11y-axe: the gradient of a layer behind the text counts, as axe reads the stack', async () => {
  const css =
    '.wrap{position:relative}.layer{position:absolute;inset:0;background-image:linear-gradient(#fff,#eee)}.t{position:relative;color:#000}';
  const main = '<div class="wrap"><div class="layer"></div><p class="t">Text vor einer Ebene.</p></div>';
  assert.deepEqual(await placesOf(axePage(main, css), axeRule), []);
  const low = css.replace('color:#000', 'color:#bbb');
  assert.deepEqual(await placesOf(axePage(main, low), axeRule), [
    '/ 1280×800 in the light theme: color-contrast on p.t: 1.65:1 on the gradient stop rgb(238, 238, 238), 4.5:1 expected',
    '/ 1280×800 in the light theme: color-contrast-enhanced on p.t: 1.65:1 on the gradient stop rgb(238, 238, 238), 7:1 expected',
  ]);
});

test('a11y-axe: gradient text is decided with its stops against the color behind the text', async () => {
  const text = (stops: string): Record<string, string> =>
    axePage(
      '<p class="g">Ein Text im Verlauf.</p>',
      `.g{background-image:linear-gradient(90deg,${stops});background-clip:text;color:transparent}`,
    );
  // #222 and #333 on the white page: about 14:1 and 12.6:1.
  assert.deepEqual(await placesOf(text('#222,#333'), axeRule), []);
  // #ccc on white is 1.6:1.
  const findings = await placesOf(text('#222,#cccccc'), axeRule);
  assert.equal(
    findings[0],
    '/ 1280×800 in the light theme: color-contrast on p.g: 1.60:1 on the gradient stop rgb(204, 204, 204), 4.5:1 expected',
  );
});

test('a11y-axe: gradient text over a parent gradient is compared with the backdrop under each of its stops', async () => {
  const over = (parent: string): Record<string, string> =>
    axePage(
      '<div class="p"><p class="g">Ein Text im Verlauf.</p></div>',
      `.p{${parent}}.g{background-image:linear-gradient(90deg,#111,#222);background-clip:text;color:transparent}`,
    );
  // On a flat white parent, #111 and #222 are about 18.9:1 and 15.9:1.
  assert.deepEqual(await placesOf(over('background-color:#fff'), axeRule), []);
  // The parent runs from white to black. Where it is black, the dark text stops are about 1.1:1 against it. The
  // first backdrop (white) alone would hide that.
  const found = await placesOf(over('background-image:linear-gradient(#fff,#000)'), axeRule);
  assert.ok(
    found.some((line) => /color-contrast on p\.g: 1\.\d\d:1 on the gradient stop rgb\(17, 17, 17\)/.test(line)),
    JSON.stringify(found),
  );
});

test('a11y-axe: a second pass at 390×844 reads closed details, popovers and dialogs after the reveal step', async () => {
  const css = '.faint{color:#999}';
  // The answer of a closed details, and the content of a popover, show only after the reveal step.
  const details = '<details><summary>Gibt es Parkplätze?</summary><p class="faint">Ja, zwölf Plätze.</p></details>';
  assert.deepEqual(await placesOf(axePage(details, css), axeRule), [
    '/ 390×844 after the reveal step: color-contrast on p.faint',
  ]);
  const popover =
    '<p><button type="button" popovertarget="tip">Hinweis</button></p><div id="tip" popover><p class="faint">Ein Hinweis.</p></div>';
  assert.deepEqual(await placesOf(axePage(popover, css), axeRule), [
    '/ 390×844 after the reveal step: color-contrast on p.faint',
  ]);
  const dialog =
    '<p><button type="button" commandfor="form" command="show-modal">Anfrage</button></p><dialog id="form"><p class="faint">Ein Formular.</p></dialog>';
  assert.deepEqual(await placesOf(axePage(dialog, css), axeRule), [
    '/ 390×844 with dialog#form open: color-contrast on p.faint',
  ]);
  // A fault below a breakpoint shows only at 390×844. A node of the first pass is not reported again.
  const narrow = '@media (width < 48rem){.small{color:#999}}';
  assert.deepEqual(await placesOf(axePage('<p class="small">Klein.</p>', narrow), axeRule), [
    '/ 390×844 after the reveal step: color-contrast on p.small',
  ]);
  assert.deepEqual(await placesOf(axePage('<p class="faint">Immer.</p>', css), axeRule), [
    '/ 1280×800 in the light theme: color-contrast on p.faint',
  ]);
});

test('a11y-axe: a link without underline in running text needs 3:1 against the text around it', async () => {
  const sentence =
    '<p class="t">Rufen Sie uns an: <a class="l" href="tel:+41815550110">081 555 01 10</a>, jeden Tag.</p>';
  // #7d340d next to #2b2521 is 1.70:1: axe passes link-in-text-block when the link computes a text-decoration
  // thickness, although it has no underline (13.1).
  const css = '.t{color:#2b2521}.l{color:#7d340d;text-decoration-line:none;text-decoration-thickness:1px}';
  assert.deepEqual(await placesOf(axePage(sentence, css), axeRule), [
    '/ 1280×800 in the light theme: link-in-text-block on a.l "081 555 01 10" without underline: rgb(125, 52, 13) against the text rgb(43, 37, 33) is 1.70:1, 3:1 expected',
  ]);
  // With an underline, or alone in its paragraph, the link passes.
  assert.deepEqual(await placesOf(axePage(sentence, css.replace('none', 'underline')), axeRule), []);
  const alone = '<p class="t"><a class="l" href="tel:+41815550110">081 555 01 10</a></p>';
  assert.deepEqual(await placesOf(axePage(alone, css), axeRule), []);
});

test('a11y-axe: a link whose text is underlined by an element inside it counts as underlined', async () => {
  const sentence =
    '<p class="t">Rufen Sie uns an: <a class="l" href="tel:+41815550110"><span class="u">081 555 01 10</span></a>, jeden Tag.</p>';
  const css = '.t{color:#2b2521}.l{color:#2b2521;text-decoration-line:none}.u{text-decoration-line:underline}';
  assert.deepEqual(await placesOf(axePage(sentence, css), axeRule), []);
  // Without the underline on the span, the same link fails at 1:1.
  const bare = css.replace('.u{text-decoration-line:underline}', '');
  const found = await placesOf(axePage(sentence, bare), axeRule);
  assert.ok(
    found.some((line) => line.includes('without underline') && line.includes('1.00:1')),
    JSON.stringify(found),
  );
});

test('a11y-axe: an underline drawn by an element around the link counts, as CSS hands it down', async () => {
  const around = (css: string, wrap = 'span'): Record<string, string> =>
    axePage(
      `<p class="t">Rufen Sie uns an: <${wrap} class="u"><a class="l" href="tel:+41815550110">081 555 01 10</a></${wrap}>, jeden Tag.</p>`,
      `.t{color:#2b2521}.l{display:inline;color:#2b2521;text-decoration-line:none}${css}`,
    );
  // The fixture CSS makes links inline-block (a11y-targets); a link in running text is inline here.
  const bare = (found: string[]): number =>
    found.filter((line) => line.includes('without underline') && line.includes('1.00:1')).length;
  // The span around the link draws the underline on the link text: the link is set apart.
  const span = await placesOf(around('.u{text-decoration-line:underline}'), axeRule);
  assert.equal(bare(span), 0, JSON.stringify(span));
  // An inline-block link stops the underline of the span (CSS Text Decoration 3, 2.1): the link text has none.
  const block = await placesOf(around('.u{text-decoration-line:underline}.l{display:inline-block}'), axeRule);
  assert.equal(bare(block), 1, JSON.stringify(block));
  // An underline on the paragraph underlines the text around the link too, so it does not set the link apart.
  const paragraph = await placesOf(around('.t{text-decoration-line:underline}'), axeRule);
  assert.equal(bare(paragraph), 1, JSON.stringify(paragraph));
  // A shadow host around the link that draws the underline counts, through the flat tree.
  const host = axePage(
    '<p class="t">Rufen Sie uns an: <span class="u"><template shadowrootmode="open"><slot></slot></template>' +
      '<a class="l" href="tel:+41815550110">081 555 01 10</a></span>, jeden Tag.</p>',
    '.t{color:#2b2521}.l{display:inline;color:#2b2521;text-decoration-line:none}.u{text-decoration-line:underline}',
  );
  const hosted = await placesOf(host, axeRule);
  assert.equal(bare(hosted), 0, JSON.stringify(hosted));
  // An inline-block around the slot, in the shadow tree, stops the host's underline: the walk follows the slot.
  const blocked = await placesOf(
    {
      'index.html': (host['index.html'] ?? '').replace(
        '<slot></slot>',
        '<style>.w{display:inline-block}</style><span class="w"><slot></slot></span>',
      ),
    },
    axeRule,
  );
  assert.equal(bare(blocked), 1, JSON.stringify(blocked));
});

test('a11y-axe: the link check reads the color of the element that holds the link text', async () => {
  const sentence =
    '<p class="t">Rufen Sie uns an: <a class="l" href="tel:+41815550110"><span class="s">081 555 01 10</span></a>, jeden Tag.</p>';
  // The anchor is #aaaaaa, but its text sits in a span in the text color #222222: 1:1 against the text.
  const css =
    '.t{color:#222222}.l{color:#aaaaaa;text-decoration-line:none;text-decoration-thickness:1px}.s{color:#222222}';
  const found = await placesOf(axePage(sentence, css), axeRule);
  assert.ok(
    found.some((line) => line.includes('without underline') && line.includes('1.00:1')),
    JSON.stringify(found),
  );
});

test('a11y-axe: hidden text inside a link does not count for the link check', async () => {
  // #666666 next to black text is 3.66:1, so the link passes; a hidden black span inside it must not change that.
  const sentence =
    '<p class="t">Rufen Sie uns an: <a class="l" href="tel:+41815550110">081 555 01 10<span hidden class="h">Versteckt</span></a>, jeden Tag.</p>';
  const css = '.t{color:#000000}.l{color:#666666;text-decoration-line:none}.h{color:#000000}';
  const found = await placesOf(axePage(sentence, css), axeRule);
  assert.equal(found.filter((line) => line.includes('without underline')).length, 0, JSON.stringify(found));
});

test('a11y-axe: a link that holds only an image is no text link for the link check', async () => {
  const sentence =
    '<p class="t">Besuchen Sie <a class="l" href="/next/"><img src="/logo.svg" alt="Weiter" width="20" height="20"></a> heute.</p>';
  const css = '.t{color:#222222}.l{color:#222222;text-decoration-line:none}';
  const files = {
    ...axePage(sentence, css),
    'logo.svg': '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20"/></svg>',
  };
  const found = await placesOf(files, axeRule);
  assert.equal(found.filter((line) => line.includes('without underline')).length, 0, JSON.stringify(found));
});

test('a11y-axe: the link check also reads a link inside an open shadow root', async () => {
  const shadow =
    '<div class="card"><template shadowrootmode="open"><style>p{color:#2b2521}a{color:#7d340d;text-decoration-line:none;text-decoration-thickness:1px}</style>' +
    '<p>Rufen Sie uns an: <a href="tel:+41815550110">081 555 01 10</a>, jeden Tag.</p></template></div>';
  const found = await placesOf(axePage(shadow, ''), axeRule);
  assert.equal(
    found.filter((line) => line.includes('link-in-text-block on a "081 555 01 10" without underline')).length,
    1,
    JSON.stringify(found),
  );
});

test('a11y-axe: an animation that never ends fails once, also inside a shadow root', async () => {
  const css = '@keyframes blink{50%{opacity:0}}.blink{animation:blink 1s infinite}';
  assert.deepEqual(await placesOf(axePage('<p class="blink">Neu!</p>', css), axeRule), [
    '/ 1280×800: the animation "blink" on p.blink never ends (WCAG 2.2.2)',
  ]);
  // A long animation that ends is no fault.
  const long = '@keyframes rise{from{opacity:0}}.rise{animation:rise 10s}';
  assert.deepEqual(await placesOf(axePage('<p class="rise">Neu!</p>', long), axeRule), []);
  // Inside an open shadow root the animation is paused at time 0 as well, so its first frame is measured in every
  // run: #aaaaaa on white is 2.32:1.
  const shadow = {
    ...axePage('<x-note></x-note><script src="/note.js"></script>'),
    'note.js':
      "const host = document.querySelector('x-note'); const root = host.attachShadow({ mode: 'open' }); " +
      "root.innerHTML = '<style>@keyframes k{0%{color:#aaa}100%{color:#222}} p{animation:k 1s infinite}</style><p>Im Schatten.</p>';",
  };
  for (let run = 0; run < 3; run += 1) {
    assert.deepEqual(await placesOf(shadow, axeRule), [
      '/ 1280×800 in the light theme: color-contrast on p',
      '/ 1280×800: the animation "k" on p never ends (WCAG 2.2.2)',
    ]);
  }
});

test('a11y-axe: equal details on one page are one finding with a count', async () => {
  const main = '<p class="faint">Eins.</p><p class="faint">Zwei.</p><p class="faint">Drei.</p>';
  assert.deepEqual(await placesOf(axePage(main, '.faint{color:#aaa}'), axeRule), [
    '/ 1280×800 in the light theme: color-contrast on p.faint (and 2 more nodes)',
  ]);
});

test('a11y-axe and contrast-pairs: a page that writes data-mode by itself gives one fixed finding', async () => {
  const design = designOf(DESIGN_TEXT);
  const writer = "setInterval(() => { document.documentElement.dataset.mode = 'light'; }, 25);";
  const page = html(BODY, {
    css: `${renderTokens(design, MODES)}${CSS}body{color:var(--color-text);background:var(--color-page)}`,
    head: '<script src="/writer.js"></script>',
  });
  const files = { 'index.html': page, 'writer.js': writer };
  for (let run = 0; run < 2; run += 1) {
    assert.deepEqual(await placesOf(files, axeRule, { settings: MODES }), [
      '/ 1280×800: the page changes data-mode by itself',
    ]);
    assert.deepEqual(await placesOf(files, contrastPairs, { settings: MODES }), [
      '/ 1280×800: the page changes data-mode by itself',
    ]);
  }
});

test('a11y-axe: a page that writes data-mode only at the narrow viewport gives the fixed finding there', async () => {
  const design = designOf(DESIGN_TEXT);
  const writer = "if (innerWidth < 500) setTimeout(() => { document.documentElement.dataset.mode = 'light'; }, 500);";
  const page = html(BODY, {
    css: `${renderTokens(design, MODES)}${CSS}body{color:var(--color-text);background:var(--color-page)}`,
    head: '<script src="/writer.js"></script>',
  });
  const files = { 'index.html': page, 'writer.js': writer };
  assert.deepEqual(await placesOf(files, axeRule, { settings: MODES }), [
    '/ 390×844: the page changes data-mode by itself',
  ]);
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

test('contrast-pairs: a transition of the page never reaches the probe, and no rule of the page wins over it', async () => {
  // #bbbbbb on white is 1.91:1: the ui pair of the accent fails, also when every element has a transition.
  const design = designOf(DESIGN_TEXT.replace('`#7a3d00`', '`#bbbbbb`'));
  const line = design.pairs.find((pair) => pair.foreground === '--color-accent')?.line;
  const expected = [
    `/ the light theme: --color-accent on --color-page has 1.91:1; the role ui needs 4.5:1 (docs/design.md, line ${line})`,
  ];
  const page = (extra: string): Record<string, string> => ({
    'index.html': html(BODY, {
      css: `${renderTokens(design, SETTINGS)}${CSS}body{color:var(--color-text);background:var(--color-page)}${extra}`,
    }),
  });
  assert.deepEqual(await placesOf(page(''), contrastPairs, { design }), expected);
  assert.deepEqual(
    await placesOf(page('*{transition:color 1s,background-color 1s}'), contrastPairs, { design }),
    expected,
  );
  // A rule with !important on every span of the body cannot change the probe.
  assert.deepEqual(await placesOf(page('body>span{color:#000!important}'), contrastPairs, { design }), expected);
});

test('contrast-pairs: a background with alpha is composited over the page background of the theme', async () => {
  // A dark surface of white at 6% over the dark page #111111 is about #1f1f1f: text #eeeeee on it is about 14:1.
  const design = designOf(DESIGN_TEXT.replace('`#3b2b17`', '`#ffffff0f`'));
  assert.deepEqual(await placesOf({ 'index.html': tokenPage(design, SETTINGS) }, contrastPairs, { design }), []);
});

test('a11y-axe: the count of equal details reads well for two nodes', () => {
  assert.deepEqual(grouped(['a', 'b', 'a', 'c', 'c', 'c']), ['a (and 1 more node)', 'b', 'c (and 2 more nodes)']);
});

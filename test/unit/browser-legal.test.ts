/**
 * The browser half of `legal-approved` (part 9b of M9, after review): on each declared legal page, in every run of
 * `test`, the text that a visitor is shown in `main` is the whole text, and no pseudo-element adds text. Each case
 * writes a temp `dist/` from strings and runs the rule in the shared Chromium (14.1).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { lockedText } from '../../src/audit/dom.ts';
import { LEGAL_RULES, LEGAL_VIEWPORTS, legalShown, liveLockedText } from '../../src/browser/legal.ts';
import { BROWSER_RULES } from '../../src/browser/rules.ts';
import { parseHtml } from '../../src/build.ts';
import { sha256 } from '../../src/csp.ts';
import { getRule } from '../../src/registry.ts';
import { CSS, findingsOf, html, SETTINGS, useBrowser } from './browser-fixtures.ts';
import { SPEC } from './spec.ts';

const browser = useBrowser();

/** The two declared legal paths of `SETTINGS`: the legal note and the privacy page. */
const NOTE = 'impressum/index.html';
const PRIVACY = 'datenschutz/index.html';

/** The text of the legal note in the passing case. */
const MAIN =
  '<main id="main"><h1>Impressum</h1><p>Hotel Beispiel AG, Dorfstrasse 1,<br>7514 Sils.</p>' +
  '<p>Wir antworten innert 30 Tagen.</p><ul><li>Erstens</li><li>Zweitens</li></ul></main>';

/** A site with the legal note holding `main` and `css`, the privacy page passing, and a home page. */
function site(main: string, css = '', more: Record<string, string> = {}): Record<string, string> {
  return {
    'index.html': html('<main><h1>Willkommen</h1><p>Text.</p></main>', { css: CSS }),
    [NOTE]: html(`<a href="#main">Zum Inhalt</a>${main}`, { css: CSS + css }),
    [PRIVACY]: html(`<a href="#main">Zum Inhalt</a>${MAIN}`, { css: CSS }),
    ...more,
  };
}

/** The findings of the rule, each as `<where> <detail>`. */
async function run(files: Record<string, string>, all = false): Promise<string[]> {
  const found = await findingsOf(browser(), files, [legalShown], { all });
  return found.map((finding) => `${finding.where} ${finding.detail ?? ''}`);
}

/** The legal note with one more paragraph that `css` styles. */
const withExtra = (
  css: string,
  markup = '<div class="wrap"><p class="extra">Wir geben Ihre Daten weiter.</p></div>',
): string[] => [MAIN.replace('</main>', `${markup}</main>`), css];

test('the rule is the browser half of legal-approved, in the browser rules, on the legal pages of every run', () => {
  assert.equal(getRule('legal-approved').stage, 'build + browser');
  assert.deepEqual(
    LEGAL_RULES.map((rule) => [rule.id, rule.pages]),
    [['legal-approved', 'legal']],
  );
  assert.ok(BROWSER_RULES.includes(legalShown));
  assert.deepEqual(
    LEGAL_VIEWPORTS.map((viewport) => `${viewport.width}×${viewport.height}`),
    ['1280×800', '390×844'],
  );
  assert.ok(SPEC.includes('| `legal-approved` | build + browser | **Build:**'));
  assert.ok(
    SPEC.includes('**Browser:** in every run of `test`, with or without `--all`, on each built declared legal page'),
  );
});

test('legal-approved (browser): legal pages whose whole text is shown pass, without --all too', async () => {
  assert.deepEqual(await run(site(MAIN)), []);
  assert.deepEqual(await run(site(MAIN), true), []);
});

test('legal-approved (browser): white space that is not shown, a quote mark and a scroller pass', async () => {
  const main = MAIN.replace(
    '</main>',
    '<p>Er sagte <q>ja</q>.<span class="gap"> </span></p>' +
      '<div class="scroller"><p class="wide">Eine sehr breite Zeile in einem Rahmen, der rollt.</p></div></main>',
  );
  const css = '.gap{display:none}.scroller{overflow-x:auto}.wide{inline-size:3000px;padding-inline-start:2000px}';
  assert.deepEqual(await run(site(main, css)), []);
});

for (const [name, css, reason] of [
  ['display: none', '.extra{display:none}', 'it is not rendered, or its visibility or opacity hides it'],
  ['visibility: hidden', '.extra{visibility:hidden}', 'it is not rendered, or its visibility or opacity hides it'],
  ['content-visibility: hidden', '.extra{content-visibility:hidden}', 'p.extra has content-visibility: hidden'],
  ['opacity: 0 around it', 'div.wrap{opacity:0}', 'it is not rendered, or its visibility or opacity hides it'],
  ['a transparent color', '.extra{color:transparent}', 'its color is transparent'],
  ['font-size: 0', '.extra{font-size:0}', 'it has no box of at least 1×1 px'],
  ['transform: scale(0)', '.extra{transform:scale(0)}', 'it has no box of at least 1×1 px'],
  ['clip-path', '.extra{clip-path:inset(50%)}', 'p.extra has clip-path: inset(50%)'],
  [
    'clip on an absolute box',
    '.extra{position:absolute;clip:rect(0 0 0 0)}',
    'p.extra has clip: rect(0px, 0px, 0px, 0px)',
  ],
  ['a box of no height that clips', '.extra{block-size:0;overflow:hidden;margin:0}', 'p.extra clips it'],
  ['a place left of the page', '.extra{position:absolute;inset-inline-start:-9999px}', 'it lies outside the page'],
  ['text-indent out of the page', '.extra{text-indent:-9999px}', 'it lies outside the page'],
] as const) {
  test(`legal-approved (browser): ${name} on a part of main fails, once, at 1280×800, naming the text`, async () => {
    const [main, style] = withExtra(css);
    assert.deepEqual(await run(site(main ?? '', style)), [
      `/impressum/ 1280×800: "Wir geben Ihre Daten weiter." in p.extra is not shown: ${reason}`,
    ]);
  });
}

test('legal-approved (browser): text in display: contents elements is shown; their own box properties do nothing', async () => {
  const [main, css] = withExtra(
    '.c{display:contents}.cut{display:contents;overflow:hidden;clip-path:inset(50%);content-visibility:hidden}',
    '<p><span class="c">Wir geben <span class="c">Ihre Daten</span> nicht weiter.</span></p>' +
      '<p><span class="cut">Ein Satz in einem Element ohne Box.</span></p>',
  );
  assert.deepEqual(await run(site(main ?? '', css)), []);
});

test('legal-approved (browser): a display: contents element hides its text by visibility or by a hidden ancestor', async () => {
  const [hidden, css] = withExtra('.c{display:contents;visibility:hidden}', '<p><span class="c">Versteckt.</span></p>');
  assert.deepEqual(await run(site(hidden ?? '', css)), [
    '/impressum/ 1280×800: "Versteckt." in span.c is not shown: it is not rendered, or its visibility or opacity hides it',
  ]);
  const [inside, css2] = withExtra(
    '.c{display:contents}.wrap{display:none}',
    '<div class="wrap"><span class="c">Versteckt.</span></div>',
  );
  assert.deepEqual(await run(site(inside ?? '', css2)), [
    '/impressum/ 1280×800: "Versteckt." in span.c is not shown: it is not rendered, or its visibility or opacity hides it',
  ]);
});

test('legal-approved (browser): a part hidden only at 390 px fails there; a closed details fails', async () => {
  const [narrow, css] = withExtra('@media (max-width: 600px){.extra{display:none}}');
  assert.deepEqual(await run(site(narrow ?? '', css)), [
    '/impressum/ 390×844: "Wir geben Ihre Daten weiter." in p.extra is not shown: it is not rendered, or its visibility or opacity hides it',
  ]);
  const details = MAIN.replace('</main>', '<details><summary>Mehr</summary><p>Ein Zusatz.</p></details></main>');
  assert.deepEqual(await run(site(details)), [
    '/impressum/ 1280×800: "Ein Zusatz." in p is not shown: it is not rendered, or its visibility or opacity hides it',
  ]);
});

for (const [name, css, detail] of [
  ['::after with a string', 'h1::after{content:" (gilt nicht)"}', 'h1::after adds the text "\\" (gilt nicht)\\""'],
  // Chromium gives the computed `content` of `attr()` as the string that it reads.
  ['::before with attr()', 'h1::before{content:attr(data-x)}', 'h1::before adds the text "\\"Nicht\\""'],
  ['::before with a counter', 'h1::before{content:counter(x)}', 'h1::before adds the text "counter(x)"'],
  ['::marker with a string', 'li::marker{content:"Nicht "}', 'li::marker adds the text "\\"Nicht \\""'],
  [
    'a list-style-type string',
    'ul{list-style-type:"Nicht "}',
    'li::marker adds the text of list-style-type "\\"Nicht \\""',
  ],
  [
    'an @counter-style rule',
    '@counter-style nicht{system:cyclic;symbols:"Nicht";suffix:" "}ul{list-style-type:nicht}',
    'li::marker adds the text of list-style-type "nicht"',
  ],
  ['open-quote with quotes of the page', 'q{quotes:"Nicht " ""}', 'q::before adds the text "open-quote"'],
] as const) {
  test(`legal-approved (browser): ${name} in main fails`, async () => {
    const main = (name.includes('quote') ? MAIN.replace('</main>', '<p><q>ja</q></p></main>') : MAIN).replace(
      '<h1>',
      '<h1 data-x="Nicht">',
    );
    assert.deepEqual(await run(site(main, css)), [`/impressum/ 1280×800: ${detail}`]);
  });
}

test('legal-approved (browser): a pseudo-element with text that no visitor is shown passes', async () => {
  const css =
    'h1::before{content:"Hinweis";visibility:hidden}h1::after{content:"Alt";opacity:0}' +
    'li::before{content:"x";color:transparent}li::after{content:"y";font-size:0}' +
    '.gone{display:none}.gone span::after{content:"Versteckt"}';
  const main = MAIN.replace('</main>', '<div class="gone"><span></span></div></main>');
  assert.deepEqual(await run(site(main, css)), []);
});

test('legal-approved (browser): a shown pseudo-element of a hidden element still adds text', async () => {
  const css = 'h1{visibility:hidden}h1::before{content:"Neu: ";visibility:visible}';
  assert.deepEqual(await run(site(MAIN, css)), ['/impressum/ 1280×800: h1::before adds the text "\\"Neu: \\""']);
});

test('legal-approved (browser): an empty or decorative pseudo-element passes; one outside main passes', async () => {
  const css =
    'h1::before{content:"";display:block;block-size:2px}h1::after{content:"  "}' +
    'body::after{content:"Nicht gültig"}main::after{content:none}';
  assert.deepEqual(await run(site(MAIN, css)), []);
});

test('legal-approved (browser): one finding per page, the first place; the other legal page and the home are apart', async () => {
  const main = MAIN.replace('<h1>Impressum</h1>', '<h1 class="a">Impressum</h1>').replace(
    '</main>',
    '<p class="b">Zwei.</p></main>',
  );
  const files = site(main, '.a{display:none}.b{display:none}', {
    'index.html': html('<main><h1>Willkommen</h1><p class="c">Text.</p></main>', { css: `${CSS}.c{display:none}` }),
  });
  assert.deepEqual(await run(files), [
    '/impressum/ 1280×800: "Impressum" in h1.a is not shown: it is not rendered, or its visibility or opacity hides it',
  ]);
});

test('legal-approved (browser): a script or a noscript in main is text that no visitor is shown', async () => {
  const main = MAIN.replace('</main>', '<noscript><p>Ohne Skript.</p></noscript></main>');
  const [finding] = await run(site(main));
  assert.match(finding ?? '', /^\/impressum\/ 1280×800: "<p>Ohne Skript\.<\/p>" in noscript is not shown: /);
});

test('legal-approved (browser): the settings of the run decide the legal pages', async () => {
  const [main, css] = withExtra('.extra{display:none}');
  const files = site(main ?? '', css);
  const settings = { ...SETTINGS, legal: { legalNote: { de: '/datenschutz/' }, privacy: { de: '/datenschutz/' } } };
  const found = await findingsOf(browser(), files, [legalShown], { settings, all: false });
  assert.deepEqual(found, []);
});

// The hash of the live text (second review of 9b)

/** The hash of the locked text of a built page, as the build half reads it. */
const builtHash = (markup: string): string =>
  sha256(
    lockedText({ file: NOTE, path: '/impressum/', locale: 'de', is404: false, html: markup, root: parseHtml(markup) }),
  );

test('the live locked text in Chromium equals lockedText of the build: hidden parts, template, br, NFD and the attributes', async () => {
  const nfd = 'Ru\u0308ckfrage'; // "Rückfrage" in NFD
  const main =
    '<main id="main" title=" Haupt  teil "><h1 aria-label="Titel">Impressum</h1>' +
    `<p hidden>Ein Entwurf.</p><p>${nfd} an <abbr title="Datenschutzgesetz">DSG</abbr>,<br>Zeile\n\t zwei.</p>` +
    '<template><p title="T">Vorlage <b>fett</b></p></template><div aria-hidden="true"><img alt=" Bild " src="data:,"></div>' +
    '<p><input value="1" placeholder="Nr." aria-label="Nummer"></p><dialog>Dialog</dialog></main>';
  const markup = html(main);
  const context = await browser().newContext();
  try {
    const tab = await context.newPage();
    await tab.setContent(markup);
    const live = await liveLockedText(tab);
    const built = lockedText({
      file: NOTE,
      path: '/impressum/',
      locale: 'de',
      is404: false,
      html: markup,
      root: parseHtml(markup),
    });
    assert.equal(live, built);
    assert.equal(
      built,
      [
        'ImpressumEin Entwurf.Rückfrage an DSG, Zeile zwei.Vorlage fettDialog',
        'title=Haupt teil',
        'aria-label=Titel',
        'title=Datenschutzgesetz',
        'title=T',
        'alt=Bild',
        'aria-label=Nummer',
        'value=1',
        'placeholder=Nr.',
      ].join('\n'),
    );
  } finally {
    await context.close();
  }
});

test('legal-approved (browser): a script that rewrites a word of main after load fails, with both hashes', async () => {
  const script =
    "<script>addEventListener('load', () => { const p = document.querySelector('main p:last-of-type');" +
    " if (p) p.textContent = 'Wir antworten innert 90 Tagen.'; });</script>";
  const files = site(MAIN, '', {});
  files[NOTE] = html(
    `<a href="#main">Zum Inhalt</a>${MAIN.replace('<ul>', '<p>Wir antworten innert 30 Tagen.</p><ul>')}${script}`,
    {
      css: CSS,
    },
  );
  const built = builtHash(files[NOTE] ?? '');
  const rewritten = (files[NOTE] ?? '').replace(
    '<p>Wir antworten innert 30 Tagen.</p><ul>',
    '<p>Wir antworten innert 90 Tagen.</p><ul>',
  );
  const live = builtHash(rewritten.replace(script, ''));
  assert.deepEqual(await run(files), [
    `/impressum/ 1280×800: the live text of main hashes to ${live}, and the built page hashes to ${built}`,
  ]);
  // With a lock, the live text is compared with its entry.
  const lock = `{\n  "/impressum/": "sha256-AAAA"\n}\n`;
  const found = await findingsOf(browser(), site(MAIN), [legalShown], { all: false, legalLock: lock });
  assert.deepEqual(
    found.map((finding) => `${finding.where} ${finding.detail ?? ''}`),
    [
      `/impressum/ 1280×800: the live text of main hashes to ${builtHash(site(MAIN)[NOTE] ?? '')}, and legal.lock.json holds sha256-AAAA`,
    ],
  );
  const right = `{\n  "/datenschutz/": "${builtHash(site(MAIN)[PRIVACY] ?? '')}",\n  "/impressum/": "${builtHash(site(MAIN)[NOTE] ?? '')}"\n}\n`;
  assert.deepEqual(await findingsOf(browser(), site(MAIN), [legalShown], { all: false, legalLock: right }), []);
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { BrowserRule } from '../../src/browser/harness.ts';
import {
  BUTTON_SELECTOR,
  borderText,
  forcedColors,
  LAYOUT_RULES,
  lengthText,
  REFLOW,
  reflow,
  revealRule,
  SPACING_CSS,
  SPACING_SLACK,
  spacing,
  TARGET_MIN,
  TARGET_SELECTOR,
  targets,
} from '../../src/browser/layout.ts';
import { RULE_BY_ID } from '../../src/registry.ts';
import { BODY, CSS, findingsOf, html, idsOf, useBrowser } from './browser-fixtures.ts';
import { SPEC } from './spec.ts';

const browser = useBrowser();

/** The smallest page that meets every rule of this file. */
const PASSING = { 'index.html': html(BODY, { css: CSS }) };

/** The home page from a body and extra CSS, on top of the passing page's CSS. */
const page = (body: string, css = ''): Record<string, string> => ({
  'index.html': html(body, { css: CSS + css }),
});

/**
 * The details of the findings of one run, in order. Every finding of these pages is on the home `/`; a finding
 * anywhere else keeps its `where` in front, so the comparison shows it.
 */
async function detailsOf(files: Record<string, string>, rule: BrowserRule): Promise<string[]> {
  const findings = await findingsOf(browser(), files, [rule]);
  return findings.map((finding) => `${finding.where === '/' ? '' : `${finding.where} `}${finding.detail ?? ''}`);
}

/** The standard of a rule in the registry, which `docs/standards.md` and section 8 hold too. */
const standardOf = (id: string): string => RULE_BY_ID.get(id)?.standard ?? '';

test('the rules of src/browser/layout.ts, in their order', () => {
  assert.deepEqual(
    LAYOUT_RULES.map((rule) => rule.id),
    ['a11y-targets', 'a11y-reflow', 'a11y-spacing', 'a11y-forced-colors', 'a11y-reveal'],
  );
  for (const rule of LAYOUT_RULES) assert.equal(rule.pages, 'tested', rule.id);
});

test('the values of the rules are the values of section 8', () => {
  assert.equal(TARGET_MIN, 43.5);
  assert.ok(
    standardOf('a11y-targets').includes('≥ 43.5×43.5. Boxes ≤ 1×1 and boxes above the page start are skipped.'),
  );
  assert.equal(TARGET_SELECTOR, 'a[href], button, input, select, summary');
  assert.deepEqual(REFLOW, { width: 320, height: 640 });
  assert.ok(SPEC.includes('| `a11y-reflow` | browser | At 320×640, before and after the reveal step:'));
  // The text spacing is the exact CSS of the row.
  assert.ok(SPEC.includes(`| \`a11y-spacing\` | browser | With \`${SPACING_CSS}\` at 1280 and 390 px`));
  assert.equal(SPACING_SLACK, 2);
  assert.ok(standardOf('a11y-spacing').includes('`scrollHeight − clientHeight > 2`'));
  assert.ok(SPEC.includes("With `emulateMedia({ forcedColors: 'active' })`: `h1` and `main` are visible;"));
  assert.ok(SPEC.includes('every button (`button`, `input[type=button\\|submit\\|reset]`, `[role=button]`)'));
  assert.equal(
    BUTTON_SELECTOR,
    'button, input[type="button" i], input[type="submit" i], input[type="reset" i], [role="button" i]',
  );
});

test('a length in a finding is cut to one decimal, so a failing size never reads as the limit', () => {
  assert.equal(lengthText(43.46), '43.4');
  assert.equal(lengthText(44), '44');
  assert.equal(lengthText(220.5), '220.5');
  assert.equal(lengthText(0.3), '0.3');
});

// a11y-targets

test('a11y-targets: the smallest page passes', async () => {
  assert.deepEqual(await idsOf(browser(), PASSING, [targets]), []);
});

/** A control of a fixed size, 40×20, that the rule measures. */
const SMALL =
  '.small{display:inline-block;box-sizing:border-box;min-inline-size:0;min-block-size:0;inline-size:40px;block-size:20px}';

test('a11y-targets: a link that stands alone and is 40×20 fails at 1280×800, at 390×844 and after the reveal step', async () => {
  const files = page(`${BODY}<p><a class="small" href="/zimmer/">Zimmer</a></p>`, SMALL);
  assert.deepEqual(await idsOf(browser(), files, [targets]), ['a11y-targets']);
  assert.deepEqual(await detailsOf(files, targets), [
    '1280×800: a.small "Zimmer" is 40×20',
    '390×844: a.small "Zimmer" is 40×20',
    '390×844 after the reveal step: a.small "Zimmer" is 40×20',
  ]);
});

test('a11y-targets: each control kind is measured, each side alone; checkbox, radio and hidden inputs are not', async () => {
  const controls = [
    '<button class="small" type="button">Los</button>',
    '<input class="small" type="text" aria-label="Name">',
    '<input class="small" type="submit" value="Senden">',
    '<select class="small" aria-label="Zimmer"><option>Doppel</option></select>',
    '<details><summary class="small">Mehr</summary><p>Text.</p></details>',
    '<input class="small" type="checkbox" aria-label="Ja">',
    '<input class="small" type="radio" aria-label="Eins">',
    '<input class="small" type="hidden" value="x">',
    '<p><a class="wide" href="/zimmer/">Zimmer</a></p>',
  ].join('');
  const wide = '.wide{display:inline-block;min-block-size:0;inline-size:200px;block-size:43px}';
  const details = await detailsOf(page(BODY + controls, SMALL + wide), targets);
  assert.deepEqual(
    details.filter((detail) => detail.startsWith('1280×800: ')),
    [
      '1280×800: button.small "Los" is 40×20',
      '1280×800: input.small "Name" is 40×20',
      '1280×800: input.small is 40×20',
      '1280×800: select.small "Zimmer" is 40×20',
      '1280×800: summary.small "Mehr" is 40×20',
      '1280×800: a.wide "Zimmer" is 200×43',
    ],
  );
});

test('a11y-targets: a link inline in text is exempt; text of only spaces and signs makes no link inline', async () => {
  const inline = page(`${BODY}<p>Lesen Sie <a class="small" href="/zimmer/">hier</a> weiter.</p>`, SMALL);
  assert.deepEqual(await idsOf(browser(), inline, [targets]), []);
  const digit = page(`${BODY}<p>2 <a class="small" href="/zimmer/">Zimmer</a></p>`, SMALL);
  assert.deepEqual(await idsOf(browser(), digit, [targets]), []);
  // The text must be in the parent element itself: text in a sibling element does not make the link inline.
  const signs = page(`${BODY}<p> – <a class="small" href="/zimmer/">Zimmer</a> · <span>Text</span></p>`, SMALL);
  assert.deepEqual(await idsOf(browser(), signs, [targets]), ['a11y-targets']);
  // An `a` without `href` is no link.
  const anchor = page(`${BODY}<p><a class="small" id="anker">Anker</a></p>`, SMALL);
  assert.deepEqual(await idsOf(browser(), anchor, [targets]), []);
});

test('a11y-targets: a link climbs through its inline ancestors to the text it stands in', async () => {
  const strong = page(
    `${BODY}<p>Lesen Sie <strong><a class="small" href="/zimmer/">hier</a></strong> weiter.</p>`,
    SMALL,
  );
  assert.deepEqual(await idsOf(browser(), strong, [targets]), []);
  const inner = page(`${BODY}<p><em><span>Mehr <a class="small" href="/zimmer/">hier</a></span></em></p>`, SMALL);
  assert.deepEqual(await idsOf(browser(), inner, [targets]), []);
  // A link alone in its inline ancestors stands alone: no text of its own in any of them.
  const alone = page(`${BODY}<p><strong><a class="small" href="/zimmer/">Zimmer</a></strong></p>`, SMALL);
  assert.deepEqual(await idsOf(browser(), alone, [targets]), ['a11y-targets']);
  // The climb stops at the first element that is not inline: the text of the `div` around the `p` does not count.
  const block = page(`${BODY}<div>Text <p><a class="small" href="/zimmer/">Zimmer</a></p></div>`, SMALL);
  assert.deepEqual(await idsOf(browser(), block, [targets]), ['a11y-targets']);
  assert.equal(SPEC.includes('climbing from its parent through the inline elements that `links-generic` lists'), true);
});

test('a11y-targets: boxes of at most 1×1 (both sides) and boxes above the page start are skipped', async () => {
  const tiny =
    '.tiny{position:absolute;min-inline-size:0;min-block-size:0;inline-size:1px;block-size:1px;overflow:hidden}';
  assert.deepEqual(
    await idsOf(browser(), page(`<p><a class="tiny" href="#main">Zum Inhalt</a></p>${BODY}`, tiny), [targets]),
    [],
  );
  // 1×40 is not ≤ 1×1: only a box with both sides ≤ 1 is skipped.
  const thin = '.thin{display:inline-block;min-inline-size:0;min-block-size:0;inline-size:1px;block-size:40px}';
  assert.deepEqual(await idsOf(browser(), page(`${BODY}<p><a class="thin" href="/">x</a></p>`, thin), [targets]), [
    'a11y-targets',
  ]);
  // Above the page start: the bottom of the box is at or above the top of the document.
  const above = `${SMALL}.small{position:absolute;inset-block-start:-20px}`;
  assert.deepEqual(
    await idsOf(browser(), page(`${BODY}<p><a class="small" href="/">Oben</a></p>`, above), [targets]),
    [],
  );
  // A box that only starts above the page start is measured.
  const partly = `${SMALL}.small{position:absolute;inset-block-start:-10px}`;
  assert.deepEqual(
    await idsOf(browser(), page(`${BODY}<p><a class="small" href="/">Oben</a></p>`, partly), [targets]),
    ['a11y-targets'],
  );
});

test('a11y-targets: a control that is not visible is skipped; one small in one viewport fails there only', async () => {
  // The test pages have no kit floor, so `display` of a class would beat `hidden`: the wrapper hides the controls.
  const hidden = `${BODY}<div hidden><button class="small">Los</button></div><p><a class="small gone" href="/">x</a></p>`;
  assert.deepEqual(await idsOf(browser(), page(hidden, `${SMALL}.gone{visibility:hidden}`), [targets]), []);
  const desktop = `@media (width >= 50rem){.only{min-inline-size:0;min-block-size:0;inline-size:40px;block-size:20px}}`;
  assert.deepEqual(await detailsOf(page(`${BODY}<p><a class="only" href="/">Zimmer</a></p>`, desktop), targets), [
    '1280×800: a.only "Zimmer" is 40×20',
  ]);
});

test('a11y-targets: the reveal step measures inside details and popovers, and each dialog by itself', async () => {
  const body = [
    BODY,
    '<details><summary class="big">Mehr</summary><p><a class="small" href="/a/">Im Details</a></p></details>',
    '<button popovertarget="pop">Menü</button><div popover id="pop"><p><a class="small" href="/b/">Im Popover</a></p></div>',
    '<button commandfor="book" command="show-modal">Buchen</button>',
    '<dialog id="book"><p><button class="small" type="button">Im Dialog</button></p></dialog>',
  ].join('');
  assert.deepEqual(await detailsOf(page(body, `${SMALL}.big{min-block-size:44px}`), targets), [
    '390×844 after the reveal step: a.small "Im Details" is 40×20',
    '390×844 after the reveal step: a.small "Im Popover" is 40×20',
    // In the dialog state the rule measures inside the dialog only, so the page behind gives no finding again.
    '390×844 with dialog#book open: button.small "Im Dialog" is 40×20',
  ]);
});

// a11y-reflow

test('a11y-reflow: the smallest page passes', async () => {
  assert.deepEqual(await idsOf(browser(), PASSING, [reflow]), []);
});

/** A box of 600 px: wider than the reflow viewport. */
const WIDE = '.wide{inline-size:600px;block-size:10px}';

test('a11y-reflow: a box of 600 px fails at 320×640, before and after the reveal step, once as the outermost', async () => {
  const files = page(`${BODY}<div class="wide"><p class="inner">Breit</p></div>`, WIDE);
  assert.deepEqual(await idsOf(browser(), files, [reflow]), ['a11y-reflow']);
  assert.deepEqual(await detailsOf(files, reflow), [
    '320×640: the page scrolls sideways: scrollWidth 600 > clientWidth 320 + 1',
    '320×640: div.wide ends at 600, past clientWidth 320 + 1',
    '320×640 after the reveal step: the page scrolls sideways: scrollWidth 600 > clientWidth 320 + 1',
    '320×640 after the reveal step: div.wide ends at 600, past clientWidth 320 + 1',
  ]);
});

test('a11y-reflow: a box inside an ancestor that scrolls passes; one that only an ancestor clips fails', async () => {
  const scroller = '.scroll{overflow-x:auto}';
  assert.deepEqual(
    await idsOf(browser(), page(`${BODY}<div class="scroll"><div class="wide">Tabelle</div></div>`, WIDE + scroller), [
      reflow,
    ]),
    [],
  );
  // A clipped box cuts its content off: the page does not scroll, but the element sticks out.
  const clip = '.clip{overflow-x:clip}';
  assert.deepEqual(
    await detailsOf(page(`${BODY}<div class="clip"><div class="wide">Weg</div></div>`, WIDE + clip), reflow),
    [
      '320×640: div.wide ends at 600, past clientWidth 320 + 1',
      '320×640 after the reveal step: div.wide ends at 600, past clientWidth 320 + 1',
    ],
  );
});

test('a11y-reflow: one pixel of slack passes; a long word that sticks out widens the page', async () => {
  const slack = '.edge{inline-size:321px;block-size:10px}';
  assert.deepEqual(await idsOf(browser(), page(`${BODY}<div class="edge"></div>`, slack), [reflow]), []);
  const word = `${BODY}<p>${'Donaudampfschifffahrtsgesellschaftskapitän'.repeat(2)}</p>`;
  const details = await detailsOf(page(word), reflow);
  assert.equal(details.length, 2, details.join('\n'));
  assert.match(details[0] ?? '', /^320×640: the page scrolls sideways: scrollWidth \d+ > clientWidth 320 \+ 1$/);
  assert.match(details[1] ?? '', /^320×640 after the reveal step: the page scrolls sideways: /);
});

test('a11y-reflow: content that only the reveal step shows fails after it; a dialog is measured by itself', async () => {
  const details = `${BODY}<details><summary>Mehr</summary><div class="wide">Breit</div></details>`;
  assert.deepEqual(await detailsOf(page(details, WIDE), reflow), [
    '320×640 after the reveal step: the page scrolls sideways: scrollWidth 600 > clientWidth 320 + 1',
    '320×640 after the reveal step: div.wide ends at 600, past clientWidth 320 + 1',
  ]);
  const dialog = [
    BODY,
    '<button commandfor="book" command="show-modal">Buchen</button>',
    '<dialog id="book"><p>Buchen</p></dialog>',
  ].join('');
  // A modal dialog scrolls its own content (`overflow: auto`), so only a dialog wider than the viewport fails.
  const fixed = '#book{box-sizing:border-box;inline-size:400px;max-inline-size:none;margin:0}';
  assert.deepEqual(await detailsOf(page(dialog, fixed), reflow), [
    '320×640 with dialog#book open: dialog#book ends at 400, past clientWidth 320 + 1',
  ]);
  const inside = `${BODY}<button commandfor="book" command="show-modal">Buchen</button><dialog id="book"><div class="wide">Breit</div></dialog>`;
  assert.deepEqual(await idsOf(browser(), page(inside, WIDE), [reflow]), []);
});

test('a11y-reflow: an element inside the kit class visually-hidden is not measured', async () => {
  const hidden =
    '.visually-hidden{position:absolute;inline-size:1px;block-size:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}';
  // An icon button at the right edge: the hidden name starts in it, and its words run past the viewport unseen.
  const body = `${BODY}<p class="end"><button type="button"><span class="visually-hidden">Ein Zimmer <span lang="en">online</span> buchen</span>X</button></p>`;
  const end = '.end{text-align:end}';
  assert.deepEqual(await idsOf(browser(), page(body, hidden + end), [reflow]), []);
  // The same box without the class sticks out: the skip is the class.
  const plain = body.replace('class="visually-hidden"', 'class="cut"');
  const cut = hidden.replace('.visually-hidden', '.cut') + end;
  assert.deepEqual(await idsOf(browser(), page(plain, cut), [reflow]), ['a11y-reflow']);
});

test('a11y-reflow: an element that is not visible, and the shapes inside an svg, are not measured', async () => {
  const hidden = `${BODY}<div hidden><div class="wide">Weg</div></div>`;
  assert.deepEqual(await idsOf(browser(), page(hidden, WIDE), [reflow]), []);
  const svg =
    '<svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true"><rect x="0" y="0" width="2000" height="2"/></svg>';
  assert.deepEqual(await idsOf(browser(), page(BODY + svg), [reflow]), []);
});

// a11y-spacing

test('a11y-spacing: the smallest page passes', async () => {
  assert.deepEqual(await idsOf(browser(), PASSING, [spacing]), []);
});

/** A box of one line at line-height 1: the text spacing makes its line 24 px high. */
const LINE = '.line{block-size:16px;line-height:1;overflow:hidden}';

test('a11y-spacing: a box of a fixed height that hides its overflow fails at 1280 and at 390', async () => {
  const files = page(`${BODY}<div class="line">Zimmer</div>`, LINE);
  assert.deepEqual(await idsOf(browser(), files, [spacing]), ['a11y-spacing']);
  assert.deepEqual(await detailsOf(files, spacing), [
    '1280×800 with the text spacing: div.line cuts its text: scrollHeight 24 > clientHeight 16 + 2',
    '390×844 with the text spacing: div.line cuts its text: scrollHeight 24 > clientHeight 16 + 2',
  ]);
});

test('a11y-spacing: overflow-y clip fails too; 2 px of overflow pass, 3 px fail; a box that grows passes', async () => {
  const clip = '.line{block-size:16px;line-height:1;overflow-y:clip}';
  assert.deepEqual(await idsOf(browser(), page(`${BODY}<div class="line">Zimmer</div>`, clip), [spacing]), [
    'a11y-spacing',
  ]);
  const two = '.line{block-size:22px;overflow:hidden}';
  assert.deepEqual(await idsOf(browser(), page(`${BODY}<div class="line">Zimmer</div>`, two), [spacing]), []);
  const three = '.line{block-size:21px;overflow:hidden}';
  assert.deepEqual(await idsOf(browser(), page(`${BODY}<div class="line">Zimmer</div>`, three), [spacing]), [
    'a11y-spacing',
  ]);
  const grows = '.line{overflow:hidden;line-height:1}';
  assert.deepEqual(await idsOf(browser(), page(`${BODY}<div class="line">Zimmer</div>`, grows), [spacing]), []);
  // `overflow-x: hidden` alone makes `overflow-y` compute to `auto`: the box scrolls, it does not cut.
  const sideways = '.line{block-size:16px;line-height:1;overflow-x:hidden}';
  assert.deepEqual(await idsOf(browser(), page(`${BODY}<div class="line">Zimmer</div>`, sideways), [spacing]), []);
});

test('a11y-spacing: an element with the class visually-hidden, and every element inside it, is skipped', async () => {
  const hidden =
    '.visually-hidden{position:absolute;inline-size:1px;block-size:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}' +
    '.inner{display:block;block-size:16px;overflow:hidden}';
  const body = `${BODY}<p class="visually-hidden">Für Screenreader <span class="inner">Zimmer und Preise</span></p>`;
  assert.deepEqual(await idsOf(browser(), page(body, hidden), [spacing]), []);
  // The same box without the class fails: the skip is the class, not the size.
  const plain = `${BODY}<p class="hidden-text">Für Screenreader</p>`;
  const css = '.hidden-text{position:absolute;inline-size:1px;block-size:1px;overflow:hidden;white-space:nowrap}';
  assert.deepEqual(await idsOf(browser(), page(plain, css), [spacing]), ['a11y-spacing']);
});

test('a11y-spacing: a box that holds no text passes: a frame that crops a photo', async () => {
  const frame = '.frame{aspect-ratio:16/9;overflow:hidden}.frame svg{display:block;inline-size:100%;block-size:auto}';
  const photo =
    '<div class="frame"><svg viewBox="0 0 400 400" role="img" aria-label="Ein Zimmer"><rect width="400" height="400"/></svg></div>';
  assert.deepEqual(await idsOf(browser(), page(`${BODY}${photo}`, frame), [spacing]), []);
  // A text inside the frame counts: the same frame with a caption fails.
  const caption = photo.replace('</div>', '<p>Das Doppelzimmer</p></div>');
  assert.deepEqual(await idsOf(browser(), page(`${BODY}${caption}`, frame), [spacing]), ['a11y-spacing']);
  assert.equal(SPEC.includes('holds a text node with a letter or a digit'), true);
});

// a11y-forced-colors

test('a11y-forced-colors: the smallest page passes', async () => {
  assert.deepEqual(await idsOf(browser(), PASSING, [forcedColors]), []);
});

test('a11y-forced-colors: buttons with a border pass, a transparent border too, because forced colors paint it', async () => {
  const body = `${BODY}<p><button type="button">Standard</button><button class="clear" type="button">Klar</button><input type="submit" value="Senden"></p>`;
  const css = '.clear{border:1px solid transparent;background:none}';
  assert.deepEqual(await idsOf(browser(), page(body, css), [forcedColors]), []);
});

test('a11y-forced-colors: a button without a border fails, each kind of button, each side alone', async () => {
  const body = [
    BODY,
    '<p><button class="flat" type="button">Los</button>',
    '<input class="flat" type="submit" value="Senden"><input class="flat" type="RESET" value="Leeren">',
    '<input class="flat" type="button" value="Mehr"><span class="flat" role="button" tabindex="0">Rolle</span>',
    '<button class="top" type="button">Oben</button><button class="thin" type="button">Dünn</button></p>',
    '<div hidden><button class="flat" type="button">Weg</button></div>',
  ].join('');
  const css =
    '.flat{border:0}.top{border:2px solid;border-block-start:none}.thin{border:2px solid;border-inline-start-width:0}';
  const files = page(body, css);
  assert.deepEqual(await idsOf(browser(), files, [forcedColors]), ['a11y-forced-colors']);
  assert.deepEqual(await detailsOf(files, forcedColors), [
    'forced colors: button.flat "Los" has no border (style none)',
    'forced colors: input.flat has no border (style none)',
    'forced colors: input.flat has no border (style none)',
    'forced colors: input.flat has no border (style none)',
    'forced colors: span.flat has no border (style none)',
    'forced colors: button.top "Oben" has no border on the top (style none)',
    'forced colors: button.thin "Dünn" has no border on the left (width 0px)',
  ]);
  assert.equal(
    borderText(['', 'color transparent', '', 'width 0px']),
    'has no border on the right (color transparent), the left (width 0px)',
  );
});

test('a11y-forced-colors: hidden content, a missing h1 and a focus ring that forced colors remove fail', async () => {
  const hide = '@media (forced-colors: active){main{display:none}}';
  assert.deepEqual(await detailsOf(page(BODY, hide), forcedColors), [
    'forced colors: h1 is not visible',
    'forced colors: main is not visible',
  ]);
  const noHeading = '<a href="#main">Zum Inhalt</a><main id="main"><p>Ein Absatz.</p></main>';
  assert.deepEqual(await detailsOf(page(noHeading), forcedColors), ['forced colors: the page has no h1']);
  const ring = '@media (forced-colors: active){:focus-visible{outline:none}}';
  assert.deepEqual(await detailsOf(page(BODY, ring), forcedColors), [
    'forced colors: the first Tab focuses a "Zum Inhalt", with outline-style none',
  ]);
  const zero = '@media (forced-colors: active){:focus-visible{outline-width:0}}';
  assert.deepEqual(await detailsOf(page(BODY, zero), forcedColors), [
    'forced colors: the first Tab focuses a "Zum Inhalt", with outline-width 0px',
  ]);
  const nothing = '<main id="main"><h1>Willkommen</h1><p>Ein Absatz.</p></main>';
  assert.deepEqual(await detailsOf(page(nothing), forcedColors), ['forced colors: the first Tab focuses nothing']);
});

test('a11y-forced-colors: a button is measured at 390×844 and in each state of the reveal step, once', async () => {
  const body = [
    BODY,
    '<p><button class="flat" type="button">Immer</button><button class="burger" type="button">Menü</button></p>',
    '<details><summary>Mehr</summary><p><button class="flat" type="button">Im Details</button></p></details>',
    '<button commandfor="book" command="show-modal">Buchen</button>',
    '<dialog id="book"><button class="flat" type="button">Schliessen</button></dialog>',
  ].join('');
  const css = '.flat,.burger{border:0}.burger{display:none}@media (width < 40rem){.burger{display:inline-block}}';
  assert.deepEqual(await detailsOf(page(body, css), forcedColors), [
    'forced colors: button.flat "Immer" has no border (style none)',
    'forced colors at 390×844: button.burger "Menü" has no border (style none)',
    'forced colors at 390×844 after the reveal step: button.flat "Im Details" has no border (style none)',
    'forced colors at 390×844 with dialog#book open: button.flat "Schliessen" has no border (style none)',
  ]);
});

test('a11y-forced-colors: the rule emulates forced colors, so a rule for forced-colors none does not apply', async () => {
  const other = '@media (forced-colors: none){main{display:none}}';
  assert.deepEqual(await idsOf(browser(), page(BODY, other), [forcedColors]), []);
});

// a11y-reveal

test('a11y-reveal: the smallest page passes', async () => {
  assert.deepEqual(await idsOf(browser(), PASSING, [revealRule]), []);
});

test('a11y-reveal: the native invokers and the content of an island may carry aria-expanded and aria-controls', async () => {
  const body = [
    BODY,
    '<details><summary aria-expanded="false" aria-controls="x">Mehr</summary><p id="x">Text.</p></details>',
    '<button popovertarget="pop" aria-expanded="false">Menü</button><div popover id="pop">Menü</div>',
    '<input type="button" popovertarget="pop" aria-controls="pop" value="Menü">',
    '<button commandfor="book" command="show-modal" aria-controls="book">Buchen</button><dialog id="book">Buchen</dialog>',
    '<astro-island><div><span aria-expanded="false" aria-controls="list">Liste</span><ul id="list"></ul></div></astro-island>',
  ].join('');
  assert.deepEqual(await idsOf(browser(), page(body), [revealRule]), []);
});

test('a11y-reveal: a script-only toggle fails, also when a script sets the attribute after load', async () => {
  const files = page(
    `${BODY}<div class="toggle" aria-expanded="false" aria-controls="menu">Menü</div><ul id="menu" hidden></ul>`,
  );
  assert.deepEqual(await idsOf(browser(), files, [revealRule]), ['a11y-reveal']);
  assert.deepEqual(await detailsOf(files, revealRule), [
    '1280×800: div.toggle has aria-expanded and aria-controls, but it is no native invoker (summary, [popovertarget], [commandfor])',
  ]);
  const script =
    '<span id="later">Menü</span><script>addEventListener("load", () => document.getElementById("later").setAttribute("aria-expanded", "false"))</script>';
  assert.deepEqual(await detailsOf(page(BODY + script), revealRule), [
    '1280×800: span#later has aria-expanded, but it is no native invoker (summary, [popovertarget], [commandfor])',
  ]);
});

test('a11y-reveal: popovertarget and commandfor count only on their elements, summary only as the first of a details', async () => {
  const body = [
    BODY,
    '<a href="#pop" popovertarget="pop" aria-expanded="false">Link</a><div popover id="pop">Menü</div>',
    '<div commandfor="book" aria-controls="book">Rolle</div><dialog id="book">Buchen</dialog>',
    '<details><summary>Eins</summary><summary aria-expanded="true">Zwei</summary></details>',
    '<button type="button" aria-expanded="false">Ohne Ziel</button>',
  ].join('');
  assert.deepEqual(await detailsOf(page(body), revealRule), [
    '1280×800: a "Link" has aria-expanded, but it is no native invoker (summary, [popovertarget], [commandfor])',
    '1280×800: div has aria-controls, but it is no native invoker (summary, [popovertarget], [commandfor])',
    '1280×800: summary "Zwei" has aria-expanded, but it is no native invoker (summary, [popovertarget], [commandfor])',
    '1280×800: button "Ohne Ziel" has aria-expanded, but it is no native invoker (summary, [popovertarget], [commandfor])',
  ]);
});

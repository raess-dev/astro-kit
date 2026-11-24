import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  FORM_EMAIL,
  FORM_TEL,
  FORM_TEXT,
  focus,
  formValue,
  KEYBOARD_RULES,
  keyboard,
  noJs,
} from '../../src/browser/keyboard.ts';
import type { FormField } from '../../src/options.ts';
import { BODY, CSS, findingsOf, html, idsOf, useBrowser } from './browser-fixtures.ts';
import { EXAMPLE, optionsOf, SMALLEST } from './fixtures.ts';

const browser = useBrowser();

/** The smallest page that meets every rule of this file. */
const PASSING = { 'index.html': html(BODY, { css: CSS }) };

/** The place and the detail of each finding of a run. */
const placesOf = async (...args: Parameters<typeof findingsOf>): Promise<string[]> =>
  (await findingsOf(...args)).map((finding) => `${finding.where} ${finding.detail}`);

/**
 * A page with every kind of stop: links, a button, a `details` with a link inside, a radio group of three, a link
 * that wraps over two lines, and a dialog that a `show-modal` invoker opens, with a link and a button inside. The
 * wrapped link has two line boxes at 1280×800, and the center of its bounding box hits the `p` (13.1 item 33).
 */
const RICH = html(
  [
    '<a href="#main">Zum Inhalt</a>',
    '<main id="main"><h1>Willkommen</h1>',
    '<p class="narrow">Ein langer Satz mit einem <a href="/zimmer/">Link, der über zwei Zeilen läuft</a> im Text.</p>',
    '<details><summary>Mehr</summary><a href="/mehr/">Mehr lesen</a></details>',
    '<fieldset><legend>Zimmer</legend>',
    '<label><input type="radio" name="room" value="a"> Einzel</label>',
    '<label><input type="radio" name="room" value="b"> Doppel</label>',
    '<label><input type="radio" name="room" value="c"> Suite</label></fieldset>',
    '<button type="button" commandfor="booking" command="show-modal">Buchen</button>',
    '<dialog id="booking"><a href="/buchen/">Jetzt buchen</a>',
    '<button type="button" commandfor="booking" command="close">Schliessen</button></dialog>',
    '</main>',
  ].join(''),
  { css: `${CSS}.narrow{max-inline-size:14rem}.narrow a{display:inline}input{inline-size:44px;block-size:44px}` },
);

test('the rules of src/browser/keyboard.ts, in their order', () => {
  assert.deepEqual(
    KEYBOARD_RULES.map((rule) => rule.id),
    ['a11y-focus', 'a11y-keyboard', 'a11y-no-js'],
  );
});

// a11y-focus

test('a11y-focus: the smallest page passes', async () => {
  assert.deepEqual(await idsOf(browser(), PASSING, [focus]), []);
});

test('a11y-focus: links, a button, a summary, radios and a dialog with a 2px ring pass', async () => {
  assert.deepEqual(await idsOf(browser(), { 'index.html': RICH }, [focus]), []);
});

test('a11y-focus: a ring of 1px fails at each sweep stop, once per state', async () => {
  const page = html(`${BODY.replace('</main>', '<p><a class="thin" href="/zimmer/">Zimmer</a></p></main>')}`, {
    css: `${CSS}.thin:focus-visible{outline-width:1px}`,
  });
  assert.deepEqual(await idsOf(browser(), { 'index.html': page }, [focus]), ['a11y-focus']);
  assert.deepEqual(await placesOf(browser(), { 'index.html': page }, [focus]), [
    '/ 1280×800: a.thin "Zimmer" shows the outline 1px solid',
    '/ 390×844: a.thin "Zimmer" shows the outline 1px solid',
    '/ 390×844 after the reveal step: a.thin "Zimmer" shows the outline 1px solid',
  ]);
});

/** A page with one more link, of class `ring`, and its CSS; `wrap` puts markup around the link. */
const ringPage = (css: string, wrap: [string, string] = ['<p>', '</p>']): string =>
  html(BODY.replace('</main>', `${wrap[0]}<a class="ring" href="/zimmer/">Zimmer</a>${wrap[1]}</main>`), {
    css: `${CSS}${css}`,
  });

/** The findings of `a11y-focus` on a ring page. */
const ringPlaces = (css: string, wrap?: [string, string]): Promise<string[]> =>
  placesOf(browser(), { 'index.html': ringPage(css, wrap) }, [focus]);

/** The three states of a fresh tab, each with the same detail. */
const inStates = (detail: string): string[] => [
  `/ 1280×800: ${detail}`,
  `/ 390×844: ${detail}`,
  `/ 390×844 after the reveal step: ${detail}`,
];

test('a11y-focus: a transparent ring fails, and the other theme does not report it again', async () => {
  assert.deepEqual(
    await ringPlaces('.ring:focus-visible{outline-color:transparent}'),
    inStates('a.ring "Zimmer" shows a ring of contrast 1.00:1 on rgb(255, 255, 255)'),
  );
});

test('a11y-focus: a ring in the color of the page background fails', async () => {
  assert.deepEqual(
    await ringPlaces(
      'body{background:#204060;color:#fff}a{color:#fff}:focus-visible{outline-color:#fff}.ring:focus-visible{outline-color:#204060}',
    ),
    inStates('a.ring "Zimmer" shows a ring of contrast 1.00:1 on rgb(32, 64, 96)'),
  );
});

test('a11y-focus: a ring at 30% alpha is composited over the background, and fails', async () => {
  assert.deepEqual(
    await ringPlaces('.ring:focus-visible{outline-color:rgb(0 0 0 / 30%)}'),
    inStates('a.ring "Zimmer" shows a ring of contrast 2.12:1 on rgb(255, 255, 255)'),
  );
});

test('a11y-focus: the contrast floor is 3:1 against white: #949494 passes, #959595 fails', async () => {
  assert.deepEqual(await ringPlaces('.ring:focus-visible{outline-color:#949494}'), []);
  assert.deepEqual(
    await ringPlaces('.ring:focus-visible{outline-color:#959595}'),
    inStates('a.ring "Zimmer" shows a ring of contrast 2.99:1 on rgb(255, 255, 255)'),
  );
});

test('a11y-focus: a ring with a negative offset is measured against the element, else against its parent', async () => {
  const dark = '.ring{background:#1f3a5f;color:#fff}.ring:focus-visible{outline-color:#fff;';
  assert.deepEqual(await ringPlaces(`${dark}outline-offset:-4px}`), []);
  assert.deepEqual(
    await ringPlaces(`${dark}outline-offset:2px}`),
    inStates('a.ring "Zimmer" shows a ring of contrast 1.00:1 on rgb(255, 255, 255)'),
  );
});

test('a11y-focus: a ring over a background image has no single color behind it and is not measured', async () => {
  const css = '.photo{background-image:linear-gradient(#000,#fff)}.ring:focus-visible{outline-color:transparent}';
  assert.deepEqual(await ringPlaces(css, ['<p class="photo">', '</p>']), []);
});

test('a11y-focus: a ring that vanishes only in the dark theme fails there, at 1280×800', async () => {
  const css =
    '@media (prefers-color-scheme: dark){body{background:#000;color:#fff}.ring:focus-visible{outline-color:#111}}';
  assert.deepEqual(await ringPlaces(css), [
    '/ 1280×800 in the dark theme: a.ring "Zimmer" shows a ring of contrast 1.11:1 on rgb(0, 0, 0)',
  ]);
});

test('a11y-focus: an element that fails in the fresh tab is not reported again in another theme', async () => {
  const css =
    '.ring:focus-visible{outline-color:rgb(0 0 0 / 30%)}@media (prefers-color-scheme: dark){body{background:#000}}';
  assert.deepEqual(
    await ringPlaces(css),
    inStates('a.ring "Zimmer" shows a ring of contrast 2.12:1 on rgb(255, 255, 255)'),
  );
});

test('a11y-focus: the first Tab with outline 0 under the kit floor fails: the style is solid, the width 0', async () => {
  // The floor of 7.6 keeps `outline-style: solid` on `:focus-visible`, and `outline: 0` sets the width to 0 (S5).
  const floor = ':focus-visible:not([tabindex="-1"]){outline-style:solid !important}';
  const page = html(BODY, { css: `${CSS}${floor}a[href="#main"]:focus-visible{outline:0}` });
  assert.deepEqual(await placesOf(browser(), { 'index.html': page }, [focus]), [
    '/ 1280×800: a "Zum Inhalt" shows the outline 0px solid',
    '/ 390×844: a "Zum Inhalt" shows the outline 0px solid',
    '/ 390×844 after the reveal step: a "Zum Inhalt" shows the outline 0px solid',
  ]);
});

test('a11y-focus: a stop inside a dialog fails in the state of that dialog', async () => {
  const page = RICH.replace('<a href="/buchen/">', '<a class="thin" href="/buchen/">').replace(
    '</style>',
    '.thin:focus-visible{outline-style:none}</style>',
  );
  assert.deepEqual(await placesOf(browser(), { 'index.html': page }, [focus]), [
    '/ 390×844 with dialog#booking open: a.thin "Jetzt buchen" shows no outline',
  ]);
});

/** Fields that Chromium gives several Tab presses: the parts of a date and a time field, and their picker. */
const FIELDS =
  '<p><label>Anreise <input type="date" name="a"></label> <label>Zeit <input type="time" name="t"></label></p>';

test('a11y-focus: a field whose parts the browser draws is measured when it takes the focus, not on its parts', async () => {
  // On the picker button of a date field the input does not match `:focus`, and the browser draws that ring.
  const passing = html(BODY.replace('</main>', `${FIELDS}</main>`), { css: CSS });
  assert.deepEqual(await idsOf(browser(), { 'index.html': passing }, [focus]), []);
  const thin = html(BODY.replace('</main>', `${FIELDS}</main>`), {
    css: `${CSS}input[type="date"]:focus-visible{outline-width:1px}`,
  });
  assert.deepEqual(await placesOf(browser(), { 'index.html': thin }, [focus]), [
    '/ 1280×800: input shows the outline 1px solid',
    '/ 390×844: input shows the outline 1px solid',
    '/ 390×844 after the reveal step: input shows the outline 1px solid',
  ]);
});

test('a11y-focus: a ring that grows in a transition is read at its end, the same in every run', async () => {
  const links = Array.from({ length: 6 }, (_, index) => `<p><a href="/p${index}/">Seite ${index}</a></p>`).join('');
  const page = html(BODY.replace('</main>', `${links}</main>`), {
    css: `${CSS}a,button{outline:0 solid #9c4f0b}:focus-visible{outline-width:2px;transition:outline-width 300ms linear}`,
  });
  const runs = [
    await placesOf(browser(), { 'index.html': page }, [focus]),
    await placesOf(browser(), { 'index.html': page }, [focus]),
  ];
  assert.deepEqual(runs, [[], []]);
});

test('a11y-focus: a ring on :focus shows after a mouse click on a link, a button and a summary', async () => {
  const page = html(
    BODY.replace(
      '</main>',
      '<button type="button">Weiter</button><details><summary>Mehr</summary><p>Text</p></details></main>',
    ),
    { css: `${CSS}:focus{outline:2px solid #9c4f0b}` },
  );
  assert.deepEqual(await placesOf(browser(), { 'index.html': page }, [focus]), [
    '/ 1280×800 after a mouse click: a "Zum Inhalt" shows the outline 2px solid',
    '/ 1280×800 after a mouse click: button "Weiter" shows the outline 2px solid',
    '/ 1280×800 after a mouse click: summary "Mehr" shows the outline 2px solid',
  ]);
});

test('a11y-focus: the click does not navigate, so the clicked link is measured on its own page', async () => {
  // Had the click on / navigated, the autofocused link of /zimmer/ would show its ring on `:focus`, and / would fail.
  const page = html('<main><h1>Willkommen</h1><p><a href="/zimmer/">Zimmer</a></p></main>', { css: CSS });
  const next = html('<main><h1>Zimmer</h1><p><a href="/" autofocus>Zurück</a></p></main>', {
    css: `${CSS}:focus{outline:2px solid}`,
  });
  assert.deepEqual(await placesOf(browser(), { 'index.html': page, 'zimmer/index.html': next }, [focus]), [
    '/zimmer/ 1280×800 after a mouse click: a "Zurück" shows the outline 2px solid',
  ]);
});

// a11y-keyboard

test('a11y-keyboard: the smallest page passes', async () => {
  assert.deepEqual(await idsOf(browser(), PASSING, [keyboard]), []);
});

test('a11y-keyboard: a radio group is one stop, a wrapped link is sampled per line, a dialog has its own sweep', async () => {
  assert.deepEqual(await idsOf(browser(), { 'index.html': RICH }, [keyboard]), []);
});

test('a11y-keyboard: a focused link under another element fails in each state', async () => {
  const page = html(
    BODY.replace('</main>', '<p class="box"><a href="/angebot/">Angebot</a><span class="cover"></span></p></main>'),
    { css: `${CSS}.box{position:relative}.cover{position:absolute;inset:0;background:#fff}` },
  );
  assert.deepEqual(await idsOf(browser(), { 'index.html': page }, [keyboard]), ['a11y-keyboard']);
  assert.deepEqual(await placesOf(browser(), { 'index.html': page }, [keyboard]), [
    '/ 1280×800: a "Angebot" is covered by span.cover',
    '/ 390×844: a "Angebot" is covered by span.cover',
    '/ 390×844 after the reveal step: a "Angebot" is covered by span.cover',
  ]);
});

test('a11y-keyboard: a link covered only at its center is not covered', async () => {
  const page = html(
    BODY.replace('</main>', '<p class="box"><a href="/angebot/">Angebot</a><span class="dot"></span></p></main>'),
    {
      css:
        `${CSS}.box{position:relative;inline-size:max-content}` +
        '.dot{position:absolute;inset-block-start:calc(50% - 4px);inset-inline-start:calc(50% - 4px);' +
        'inline-size:8px;block-size:8px;background:#000}',
    },
  );
  assert.deepEqual(await idsOf(browser(), { 'index.html': page }, [keyboard]), []);
});

test('a11y-keyboard: a focused link off screen fails; a hidden checkbox shown by its label passes', async () => {
  const hidden =
    '.hide{position:absolute;inline-size:1px;block-size:1px;overflow:hidden;clip-path:inset(50%)}' +
    '.off{position:absolute;inset-inline-start:-9999px}label{display:inline-block;min-block-size:44px}';
  const page = html(
    BODY.replace(
      '</main>',
      '<label><input class="hide" type="checkbox" name="news"> Neuigkeiten</label>' +
        '<p><a class="off" href="/versteckt/">Versteckt</a></p></main>',
    ),
    { css: `${CSS}${hidden}` },
  );
  assert.deepEqual(await placesOf(browser(), { 'index.html': page }, [keyboard]), [
    '/ 1280×800: a.off "Versteckt" is not on screen',
    '/ 390×844: a.off "Versteckt" is not on screen',
    '/ 390×844 after the reveal step: a.off "Versteckt" is not on screen',
  ]);
});

test('a11y-keyboard: a control that Tab does not reach fails', async () => {
  const trap =
    "<script>document.addEventListener('keydown', (event) => {" +
    " if (event.key === 'Tab' && document.activeElement?.id === 'b') event.preventDefault(); });</script>";
  const page = html(
    BODY.replace('</main>', '<p><a id="b" href="/b/">Zwei</a> <a id="c" href="/c/">Drei</a></p></main>') + trap,
    { css: CSS },
  );
  assert.deepEqual(await placesOf(browser(), { 'index.html': page }, [keyboard]), [
    '/ 1280×800: a#c "Drei" is not reached within 8 Tab presses',
    '/ 390×844: a#c "Drei" is not reached within 8 Tab presses',
    '/ 390×844 after the reveal step: a#c "Drei" is not reached within 8 Tab presses',
  ]);
});

test('a11y-keyboard: date and time fields and an iframe take several presses, and Tab still reaches what follows', async () => {
  const links = Array.from({ length: 8 }, (_, index) => `<a href="/k${index}/">Ort ${index}</a>`).join(' ');
  const page = html(
    BODY.replace(
      '</main>',
      `${FIELDS}${FIELDS.replaceAll('name="', 'name="b')}<iframe title="Karte" src="/karte/"></iframe>` +
        '<p><a href="/ende/">Ende</a></p></main>',
    ),
    { css: CSS },
  );
  const files = { 'index.html': page, 'karte/index.html': html(`<main><h1>Karte</h1>${links}</main>`, { css: CSS }) };
  assert.deepEqual(await placesOf(browser(), files, [keyboard]), []);
});

test('a11y-keyboard: smooth scrolling is off during a sweep, so a link below the fold is on screen', async () => {
  const space = '<div style="block-size:1500px">Platz</div>';
  const links = Array.from({ length: 4 }, (_, index) => `<p><a href="/p${index}/">Seite ${index}</a></p>`).join('');
  const page = html(BODY.replace('</main>', `${space}${links}${space}</main>`), {
    css: `${CSS}html{scroll-behavior:smooth}`,
  });
  assert.deepEqual(await placesOf(browser(), { 'index.html': page }, [keyboard]), []);
});

test('a11y-keyboard: a script that takes the focus back on blur with a timer traps the sweep', async () => {
  const trap =
    '<script>const first = document.getElementById("b");' +
    'first.addEventListener("blur", () => setTimeout(() => first.focus()));</script>';
  const page = html(
    BODY.replace('</main>', '<p><a id="b" href="/b/">Zwei</a> <a id="c" href="/c/">Drei</a></p></main>') + trap,
    { css: CSS },
  );
  assert.deepEqual(await placesOf(browser(), { 'index.html': page }, [keyboard]), [
    '/ 1280×800: a#c "Drei" is not reached within 8 Tab presses',
    '/ 390×844: a#c "Drei" is not reached within 8 Tab presses',
    // The tab of 390×844 ends that sweep on the trap, and the start of the next sweep blurs it, so the trap holds.
    '/ 390×844 after the reveal step: a "Zum Inhalt" is not reached within 8 Tab presses',
    '/ 390×844 after the reveal step: a#c "Drei" is not reached within 8 Tab presses',
  ]);
});

test('a11y-keyboard: a link with tabindex -1 is not reached; a roving tablist and main with -1 pass', async () => {
  const tabs =
    '<div role="tablist"><button role="tab" tabindex="0">Eins</button><button role="tab" tabindex="-1">Zwei</button></div>';
  const passing = html(
    BODY.replace('<main id="main">', '<main id="main" tabindex="-1">').replace('</main>', `${tabs}</main>`),
    {
      css: CSS,
    },
  );
  assert.deepEqual(await placesOf(browser(), { 'index.html': passing }, [keyboard]), []);
  const hidden = html(BODY.replace('</main>', '<p><a href="/weg/" tabindex="-1">Weg</a></p></main>'), { css: CSS });
  assert.deepEqual(await placesOf(browser(), { 'index.html': hidden }, [keyboard]), [
    '/ 1280×800: a "Weg" is not reached within 7 Tab presses',
    '/ 390×844: a "Weg" is not reached within 7 Tab presses',
    '/ 390×844 after the reveal step: a "Weg" is not reached within 7 Tab presses',
  ]);
});

test('a11y-keyboard: a popover that the reveal step shows is no cover; one that a script shows covers', async () => {
  const menu =
    '<button popovertarget="menu">Menü</button>' +
    '<nav id="menu" popover><p><a href="/zimmer/">Zimmer</a></p><p><a href="/restaurant/">Restaurant</a></p></nav>';
  const full = `${CSS}#menu{inset:0;inline-size:100%;block-size:100%;margin:0;border:0;background:#fff}`;
  const shown = html(BODY.replace('</main>', `${menu}<p><a href="/ende/">Ende</a></p></main>`), { css: full });
  assert.deepEqual(await placesOf(browser(), { 'index.html': shown }, [keyboard]), []);
  const banner =
    '<div id="banner" popover="manual"><p>Wir verwenden keine Cookies.</p></div>' +
    '<script>document.getElementById("banner").showPopover()</script>';
  const bottom = `${CSS}#banner{inset:auto 0 0 0;inline-size:100%;block-size:100%;margin:0;border:0;background:#fff}`;
  const covered = html(BODY.replace('</main>', `<p><a href="/ende/">Ende</a></p></main>${banner}`), { css: bottom });
  const places = await placesOf(browser(), { 'index.html': covered }, [keyboard]);
  assert.deepEqual(
    places.filter((place) => place.includes('"Ende"')),
    [
      '/ 1280×800: a "Ende" is covered by div#banner',
      '/ 390×844: a "Ende" is covered by div#banner',
      '/ 390×844 after the reveal step: a "Ende" is covered by div#banner',
    ],
  );
});

test('a11y-keyboard: a covered link inside a dialog fails in the state of that dialog only', async () => {
  const page = RICH.replace(
    '<a href="/buchen/">Jetzt buchen</a>',
    '<p class="box"><a href="/buchen/">Jetzt buchen</a><span class="cover"></span></p>',
  ).replace('</style>', '.box{position:relative}.cover{position:absolute;inset:0;background:#fff}</style>');
  assert.deepEqual(await placesOf(browser(), { 'index.html': page }, [keyboard]), [
    '/ 390×844 with dialog#booking open: a "Jetzt buchen" is covered by span.cover',
  ]);
});

// a11y-no-js

test('a11y-no-js: the smallest page passes', async () => {
  assert.deepEqual(await idsOf(browser(), PASSING, [noJs]), []);
});

test('a11y-no-js: a mode switch shown only with JS, and controls in details and dialogs, pass', async () => {
  const modeScript = "<script>document.documentElement.setAttribute('data-mode', 'light');</script>";
  const page = RICH.replace(
    '<main id="main">',
    '<details data-mode-switch><summary>Darstellung</summary><label><input type="radio" name="mode"> Hell</label>' +
      '</details><main id="main">',
  ).replace('</style>', ':root:not([data-mode]) [data-mode-switch]{display:none}</style>');
  assert.deepEqual(
    await idsOf(browser(), { 'index.html': page.replace('</head>', `${modeScript}</head>`) }, [noJs]),
    [],
  );
});

test('a11y-no-js: a link and a control that only a script shows fail', async () => {
  const script =
    "<script>document.querySelector('main').insertAdjacentHTML('beforeend', '<p><a href=\"/zimmer/\">Zimmer</a></p>');" +
    "document.getElementById('menu').hidden = false;</script>";
  const page = html(
    BODY.replace('</main>', '<p id="menu" hidden><button type="button">Menü</button></p></main>') + script,
    {
      css: CSS,
    },
  );
  assert.deepEqual(await idsOf(browser(), { 'index.html': page }, [noJs]), ['a11y-no-js']);
  assert.deepEqual(await placesOf(browser(), { 'index.html': page }, [noJs]), [
    '/ 390×844 after the reveal step with JS off: button "Menü" is not visible',
    '/ 390×844 after the reveal step with JS off: the link to /zimmer/ is not visible',
  ]);
});

test('a11y-no-js: a main that only a script shows fails with its h1', async () => {
  const page = html(
    `${BODY.replace('<main id="main">', '<main id="main" hidden>')}<script>document.getElementById('main').hidden = false;</script>`,
    { css: CSS },
  );
  assert.deepEqual(await placesOf(browser(), { 'index.html': page }, [noJs]), [
    '/ 390×844 after the reveal step with JS off: no h1 is visible',
    '/ 390×844 after the reveal step with JS off: no main is visible',
  ]);
});

// a11y-no-js: the declared forms

/** Settings with forms: one form with a field of each type, the choice once as a select and once as radios. */
const FORMS = optionsOf({
  ...SMALLEST,
  features: EXAMPLE.features,
  contact: EXAMPLE.contact,
  processing: EXAMPLE.processing,
  forms: {
    booking: {
      fields: [
        { name: 'name', type: 'text' },
        { name: 'email', type: 'email' },
        { name: 'tel', type: 'tel' },
        { name: 'arrival', type: 'date' },
        { name: 'guests', type: 'number', min: 1, max: 6 },
        { name: 'room', type: 'choice', options: ['einzel', 'doppel'] },
        { name: 'meal', type: 'choice', options: ['fruehstueck', 'halbpension'] },
        { name: 'message', type: 'textarea' },
        { name: 'privacy', type: 'consent' },
      ],
    },
  },
});

/** The booking form of `FORMS` on the home, with every field required, as `forms-declared` wants it. */
const bookingPage = (dateMax = ''): string =>
  html(
    BODY.replace(
      '</main>',
      [
        '<form method="post" action="/api/forms/booking/">',
        '<input type="hidden" name="return" value="/">',
        '<label>Name (Pflichtfeld) <input type="text" name="name" required></label>',
        '<label>E-Mail (Pflichtfeld) <input type="email" name="email" required></label>',
        '<label>Telefon (Pflichtfeld) <input type="tel" name="tel" required></label>',
        `<label>Anreise (Pflichtfeld) <input type="date" name="arrival" required${dateMax}></label>`,
        '<label>Gäste (Pflichtfeld) <input type="number" name="guests" min="1" max="6" required></label>',
        '<label>Zimmer (Pflichtfeld) <select name="room" required><option value=""></option>',
        '<option value="einzel">Einzel</option><option value="doppel">Doppel</option></select></label>',
        '<fieldset><legend>Verpflegung (Pflichtfeld)</legend>',
        '<label><input type="radio" name="meal" value="fruehstueck" required> Frühstück</label>',
        '<label><input type="radio" name="meal" value="halbpension"> Halbpension</label></fieldset>',
        '<label>Nachricht (Pflichtfeld) <textarea name="message" required></textarea></label>',
        '<label><input type="checkbox" name="privacy" required> Datenschutz (Pflichtfeld)</label>',
        '<button>Senden</button></form><p id="sent">Danke.</p><p id="not-sent">Leider nicht.</p></main>',
      ].join(''),
    ),
    { css: `${CSS}input,select,textarea{min-block-size:44px}` },
  );

test('a11y-no-js: the fill values of 8', () => {
  const field = (type: FormField['type'], more: Partial<FormField> = {}): FormField => ({
    name: 'x',
    type,
    required: true,
    autocomplete: 'off',
    ...more,
  });
  const now = Date.UTC(2026, 10, 24, 23, 30);
  assert.equal(formValue(field('text'), now), FORM_TEXT);
  assert.equal(formValue(field('textarea'), now), 'Kit browser test');
  assert.equal(formValue(field('email'), now), FORM_EMAIL);
  assert.equal(FORM_EMAIL, 'probe@example.com');
  assert.equal(formValue(field('tel'), now), FORM_TEL);
  assert.equal(FORM_TEL, '+41441234567');
  assert.equal(formValue(field('date'), now), '2026-12-24');
  assert.equal(formValue(field('number', { min: 3, max: 9 }), now), '3');
  assert.equal(formValue(field('choice', { options: ['b', 'a'] }), now), 'b');
  assert.equal(formValue(field('consent'), now), 'on');
});

test('a11y-no-js: a declared form that lands on #sent passes', async () => {
  // Until the form stub of M7, a `_redirects` rule answers the post with 303 to `/#sent`, as the stub does.
  const files = { 'index.html': bookingPage(), _redirects: '/api/forms/booking/ /#sent 303\n' };
  assert.deepEqual(await idsOf(browser(), files, [noJs], { settings: FORMS }), []);
});

test('a11y-no-js: a declared form inside a dialog that a native invoker opens passes', async () => {
  const page = bookingPage()
    .replace(
      '<form method="post"',
      '<button type="button" commandfor="book" command="show-modal">Buchen</button><dialog id="book"><form method="post"',
    )
    .replace('</form>', '</form></dialog>');
  const files = { 'index.html': page, _redirects: '/api/forms/booking/ /#sent 303\n' };
  assert.deepEqual(await idsOf(browser(), files, [noJs], { settings: FORMS }), []);
});

test('a11y-no-js: a declared form inside a dialog whose invoker sits in an auto popover passes', async () => {
  const page = bookingPage()
    .replace(
      '<form method="post"',
      '<button type="button" popovertarget="menu">Menü</button><div popover id="menu"><button type="button" commandfor="book" command="show-modal">Buchen</button></div><dialog id="book"><form method="post"',
    )
    .replace('</form>', '</form></dialog>');
  const files = { 'index.html': page, _redirects: '/api/forms/booking/ /#sent 303\n' };
  assert.deepEqual(await idsOf(browser(), files, [noJs], { settings: FORMS }), []);
});

test('a11y-no-js: a declared form inside a dialog that no native invoker opens fails', async () => {
  const page = bookingPage()
    .replace('<form method="post"', '<dialog id="book"><form method="post"')
    .replace('</form>', '</form></dialog>');
  const files = { 'index.html': page, _redirects: '/api/forms/booking/ /#sent 303\n' };
  assert.deepEqual(await idsOf(browser(), files, [noJs], { settings: FORMS }), ['a11y-no-js']);
});

test('a11y-no-js: a declared form that the server refuses fails', async () => {
  assert.deepEqual(await placesOf(browser(), { 'index.html': bookingPage() }, [noJs], { settings: FORMS }), [
    '/ 390×844 with JS off: the form booking lands on /api/forms/booking/, not on /#sent',
  ]);
});

test('a11y-no-js: a declared form that the fill cannot make valid fails before the submission', async () => {
  const files = { 'index.html': bookingPage(' max="2000-01-01"'), _redirects: '/api/forms/booking/ /#sent 303\n' };
  assert.deepEqual(await placesOf(browser(), files, [noJs], { settings: FORMS }), [
    '/ 390×844 with JS off: the form booking is not valid after the fill: the field arrival',
  ]);
});

test('a11y-no-js: a page without the declared form has nothing to submit', async () => {
  assert.deepEqual(await idsOf(browser(), PASSING, [noJs], { settings: FORMS }), []);
});

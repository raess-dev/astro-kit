/**
 * The forms rules of the page audit (`src/audit/page/forms.ts`): `forms-declared`, `forms-fields` and
 * `forms-safety`. Each case builds a context from pages shaped as Astro writes them (`audit-fixtures.ts`) with the
 * two forms of the test site (14.2), changes one thing, and asserts the exact sorted id list.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { auditFormsDeclared, auditFormsFields, auditFormsSafety } from '../../src/audit/page/forms.ts';
import type { BuildContext } from '../../src/context.ts';
import { EMAIL_PATTERN } from '../../src/forms/fields.ts';
import type { Options } from '../../src/options.ts';
import type { Report } from '../../src/registry.ts';
import {
  contextOf,
  fileOf,
  findings,
  ICON_FILES,
  ids,
  notFoundPage,
  page,
  SWITCH_OPTIONS,
  site,
} from './audit-fixtures.ts';
import { optionsOf, TWO_LOCALES } from './fixtures.ts';

// Inputs

type Rule = (ctx: BuildContext) => void;

const ALL: readonly Rule[] = [auditFormsDeclared, auditFormsFields, auditFormsSafety];

/** `TWO_LOCALES` with forms on and the two forms of the test site (14.2). */
const FORMS = {
  ...TWO_LOCALES,
  features: { forms: true },
  contact: { to: 'info@example.ch', from: 'form@example.ch' },
  forms: {
    contact: {
      fields: [
        { name: 'name', type: 'text' },
        { name: 'email', type: 'email' },
        { name: 'message', type: 'textarea' },
      ],
    },
    booking: {
      fields: [
        { name: 'name', type: 'text' },
        { name: 'email', type: 'email' },
        { name: 'tel', type: 'tel', required: false },
        { name: 'arrival', type: 'date' },
        { name: 'nights', type: 'number', min: 1, max: 14 },
        { name: 'room', type: 'choice', options: ['single', 'double', 'family'] },
        { name: 'terms', type: 'consent' },
      ],
    },
  },
  processing: ['cdn', 'previews', 'forms', 'server'],
} as const;

const OPTIONS: Options = optionsOf(FORMS);

/** The settings with the forms and the mode switch. */
const SWITCH_FORMS: Options = optionsOf({ ...FORMS, modes: SWITCH_OPTIONS.modes });

/** The text with its first `from` replaced. Throws when the text does not hold `from`. */
function swap(text: string, from: string, to: string): string {
  const at = text.indexOf(from);
  if (at < 0) throw new Error(`audit-forms: ${JSON.stringify(from)} is not in the text`);
  return `${text.slice(0, at)}${to}${text.slice(at + from.length)}`;
}

const PRIVACY = new Map([
  ['/', '/datenschutz/'],
  ['/kontakt/', '/datenschutz/'],
  ['/fr/', '/fr/protection-des-donnees/'],
  ['/fr/contact/', '/fr/protection-des-donnees/'],
]);

/** The return input and the honeypot of 9.1, as the markup pattern writes them. */
const hidden = (path: string): string =>
  `<input type="hidden" name="return" value="${path}"> <div class="visually-hidden" inert aria-hidden="true"><input name="website" type="text" tabindex="-1" autocomplete="off"></div>`;

/** The privacy sentence inside a form. */
const privacyOf = (path: string): string =>
  `<p>Wir lesen Ihre Angaben nach unserer <a href="${PRIVACY.get(path) ?? '/datenschutz/'}">Datenschutzerklärung</a>.</p>`;

/** The contact form on a German page. */
const contactForm = (path: string): string =>
  `<form action="/api/forms/contact/" method="post">${hidden(path)} <label>Name (Pflichtfeld) <input type="text" name="name" required maxlength="200" autocomplete="name"></label> <label>E-Mail (Pflichtfeld) <input type="email" name="email" required maxlength="254" pattern="${EMAIL_PATTERN}" autocomplete="email"></label> <label>Nachricht (Pflichtfeld) <textarea name="message" required maxlength="5000" autocomplete="off"></textarea></label> ${privacyOf(path)} <button type="submit">Senden</button></form>`;

/** The booking form on a German page, with the room as a select. */
const bookingForm = (path: string): string =>
  `<form action="/api/forms/booking/" method="post">${hidden(path)} <label>Name (Pflichtfeld) <input type="text" name="name" required maxlength="200" autocomplete="name"></label> <label>E-Mail (Pflichtfeld) <input type="email" name="email" required maxlength="254" pattern="${EMAIL_PATTERN}" autocomplete="email"></label> <label>Telefon (optional) <input type="tel" name="tel" maxlength="32" autocomplete="tel"></label> <label>Anreise (Pflichtfeld) <input type="date" name="arrival" required autocomplete="off"></label> <label>Nächte (Pflichtfeld) <input type="number" name="nights" required min="1" max="14" autocomplete="off"></label> <label>Zimmer (Pflichtfeld) <select name="room" required autocomplete="off"><option value=""></option><option value="single">Einzelzimmer</option><option value="double">Doppelzimmer</option><option value="family">Familienzimmer</option></select></label> <label><input type="checkbox" name="terms" required> Ich bin mit den Bedingungen einverstanden (Pflichtfeld)</label> ${privacyOf(path)} <button type="submit">Anfrage senden</button></form>`;

/** The two notes of the markup pattern. */
const NOTES =
  '<p id="sent" tabindex="-1">Danke, wir antworten bald.</p> <p id="not-sent" tabindex="-1">Das hat nicht geklappt.</p>';

/** The main content of a contact page with both forms. */
const contactMain = (path: string, forms = `${contactForm(path)} ${bookingForm(path)}`): string =>
  `<h1>Kontakt</h1> ${NOTES} ${forms}`;

/** The site of `site()` with both forms on the German home. */
function formSite(main = contactMain('/'), options: Options = OPTIONS): Record<string, string> {
  const files = site(options);
  files['index.html'] = page(options, '/', { alternates: { de: '/', fr: '/fr/' }, main });
  return files;
}

/** Runs the rules on the files with the settings, and gives the report. */
function run(rules: Rule | readonly Rule[], files: Record<string, string>, options: Options = OPTIONS): Report {
  const ctx = contextOf(files, { options });
  for (const rule of Array.isArray(rules) ? rules : [rules]) (rule as Rule)(ctx);
  return ctx.report;
}

/** Runs the rules on the site with the German home holding this main content. */
const runMain = (rules: Rule | readonly Rule[], main: string, options: Options = OPTIONS): Report =>
  run(rules, formSite(main, options), options);

/** Runs the rules on the site with the contact form changed from `from` to `to`. */
const runContact = (rules: Rule | readonly Rule[], from: string, to: string): Report =>
  runMain(rules, contactMain('/', `${swap(contactForm('/'), from, to)} ${bookingForm('/')}`));

/** Runs the rules on the site with the booking form changed from `from` to `to`. */
const runBooking = (rules: Rule | readonly Rule[], from: string, to: string): Report =>
  runMain(rules, contactMain('/', `${contactForm('/')} ${swap(bookingForm('/'), from, to)}`));

// All three

test('forms: the two forms of the test site on a page pass the three rules', () => {
  assert.deepEqual(findings(run(ALL, formSite())), []);
});

test('forms: a French page with French labels and the French privacy path passes', () => {
  const fr = (text: string): string =>
    text
      .replaceAll('(Pflichtfeld)', '(obligatoire)')
      .replaceAll('(optional)', '(facultatif)')
      .replaceAll('value="/"', 'value="/fr/"');
  const main = `<h1>Contact</h1> ${NOTES} ${fr(contactForm('/fr/'))} ${fr(bookingForm('/fr/'))}`;
  const files = site(OPTIONS);
  files['fr/index.html'] = page(OPTIONS, '/fr/', { alternates: { de: '/', fr: '/fr/' }, main });
  assert.deepEqual(findings(run(ALL, files)), []);
});

test('forms: a site without forms and without a form passes the three rules', () => {
  const options = optionsOf(TWO_LOCALES);
  assert.deepEqual(findings(run(ALL, site(options), options)), []);
});

test('forms: the mode switch passes forms-fields without a required word or autocomplete', () => {
  const files = formSite(contactMain('/'), SWITCH_FORMS);
  assert.deepEqual(findings(run(ALL, files, SWITCH_FORMS)), []);
});

// forms-declared

test('forms-declared: an absolute action on the host of the site counts as the action of the form', () => {
  const report = runContact(
    auditFormsDeclared,
    'action="/api/forms/contact/"',
    'action="https://example.ch/api/forms/contact/"',
  );
  assert.deepEqual(ids(report), []);
});

test('forms-declared: an action without the last slash, with a query or to an undeclared id fails', () => {
  for (const action of ['/api/forms/contact', '/api/forms/contact/?x=1', '/api/forms/newsletter/', '/api/forms/']) {
    const report = runContact(auditFormsDeclared, 'action="/api/forms/contact/"', `action="${action}"`);
    assert.deepEqual(ids(report), ['forms-declared'], action);
  }
  // The contact form now posts elsewhere, so it appears on no page either.
  const report = runContact(auditFormsDeclared, 'action="/api/forms/contact/"', 'action="/api/forms/contact"');
  assert.deepEqual(
    findings(report).map((line) => line.split(' ').slice(0, 2).join(' ')),
    ['forms-declared /', 'forms-declared astro-kit.json:'],
  );
});

test('forms-declared: an absolute action on the host with http fails', () => {
  const report = runContact(
    auditFormsDeclared,
    'action="/api/forms/contact/"',
    'action="http://example.ch/api/forms/contact/"',
  );
  assert.deepEqual(ids(report), ['forms-declared']);
  assert.match(findings(report)[0] ?? '', /uses http/);
});

test('forms-declared: a relative action that resolves to a form path counts', () => {
  const report = runContact(auditFormsDeclared, 'action="/api/forms/contact/"', 'action="api/forms/contact/"');
  assert.deepEqual(ids(report), []);
});

test('forms-declared: method get, a missing method and a text/plain enctype fail; POST in capitals passes', () => {
  for (const [from, to, expected] of [
    ['method="post"', 'method="get"', ['forms-declared']],
    ['method="post"', '', ['forms-declared']],
    ['method="post"', 'method="POST"', []],
    ['method="post"', 'method="post" enctype="text/plain"', ['forms-declared']],
    ['method="post"', 'method="post" enctype="multipart/form-data"', []],
  ] as const) {
    assert.deepEqual(ids(runContact(auditFormsDeclared, from, to)), expected, to);
  }
});

test('forms-declared: return must be one hidden input with the page path', () => {
  for (const to of [
    '',
    '<input type="hidden" name="return" value="/fr/">',
    '<input type="text" name="return" value="/">',
    '<input type="hidden" name="return" value="/"><input type="hidden" name="return" value="/">',
  ]) {
    const report = runContact(auditFormsDeclared, '<input type="hidden" name="return" value="/">', to);
    assert.deepEqual(ids(report), ['forms-declared'], to);
  }
});

test('forms-declared: the honeypot must have its exact attributes inside the inert hidden wrapper', () => {
  const trap = '<input name="website" type="text" tabindex="-1" autocomplete="off">';
  for (const to of [
    '',
    '<input name="website" tabindex="-1" autocomplete="off">',
    '<input name="website" type="text" autocomplete="off">',
    '<input name="website" type="text" tabindex="-1">',
    '<input name="website" type="email" tabindex="-1" autocomplete="off">',
  ]) {
    assert.deepEqual(ids(runContact(auditFormsDeclared, trap, to)), ['forms-declared'], to);
  }
  const wrapper = '<div class="visually-hidden" inert aria-hidden="true">';
  for (const to of [
    '<div class="visually-hidden" aria-hidden="true">',
    '<div class="visually-hidden" inert>',
    '<div inert aria-hidden="true">',
    '<div>',
  ]) {
    assert.deepEqual(ids(runContact(auditFormsDeclared, wrapper, to)), ['forms-declared'], to);
  }
});

test('forms-declared: a missing, an extra and a renamed field fail', () => {
  const name =
    '<label>Name (Pflichtfeld) <input type="text" name="name" required maxlength="200" autocomplete="name"></label>';
  assert.deepEqual(ids(runContact(auditFormsDeclared, name, '')), ['forms-declared']);
  assert.deepEqual(
    ids(
      runContact(
        auditFormsDeclared,
        name,
        `${name} <label>Firma (optional) <input type="text" name="company" autocomplete="organization"></label>`,
      ),
    ),
    ['forms-declared'],
  );
  assert.deepEqual(ids(runContact(auditFormsDeclared, 'name="name"', 'name="full_name"')), ['forms-declared']);
});

test('forms-declared: a button with a name is no field, and a submit control may have a name', () => {
  const report = runContact(
    auditFormsDeclared,
    '<button type="submit">',
    '<button type="submit" name="send" value="1">',
  );
  assert.deepEqual(ids(report), []);
});

test('forms-declared: each field needs the control of its type', () => {
  for (const [from, to] of [
    [
      '<input type="text" name="name" required maxlength="200" autocomplete="name">',
      '<textarea name="name" required maxlength="200" autocomplete="name"></textarea>',
    ],
    ['type="email" name="email"', 'type="text" name="email"'],
    [
      '<textarea name="message" required maxlength="5000" autocomplete="off"></textarea>',
      '<input type="text" name="message" required maxlength="5000" autocomplete="off">',
    ],
  ] as const) {
    assert.deepEqual(ids(runContact(auditFormsDeclared, from, to)), ['forms-declared'], to);
  }
  for (const [from, to] of [
    ['type="tel" name="tel"', 'type="text" name="tel"'],
    ['type="date" name="arrival"', 'type="text" name="arrival"'],
    ['type="number" name="nights"', 'type="text" name="nights"'],
    ['type="checkbox" name="terms"', 'type="radio" name="terms"'],
  ] as const) {
    assert.deepEqual(ids(runBooking(auditFormsDeclared, from, to)), ['forms-declared'], to);
  }
});

test('forms-declared: an input without a type, or with an unknown type, is a text input', () => {
  for (const to of ['<input name="name"', '<input type="TEXT" name="name"', '<input type="fancy" name="name"']) {
    assert.deepEqual(ids(runContact(auditFormsDeclared, '<input type="text" name="name"', to)), [], to);
  }
});

test('forms-declared: required, maxlength, min and max as declared', () => {
  for (const [from, to] of [
    ['name="name" required', 'name="name"'],
    ['maxlength="200"', 'maxlength="100"'],
    ['maxlength="200"', ''],
    ['maxlength="254"', 'maxlength="254x"'],
  ] as const) {
    assert.deepEqual(ids(runContact(auditFormsDeclared, from, to)), ['forms-declared'], to);
  }
  for (const [from, to] of [
    ['name="tel" maxlength', 'name="tel" required maxlength'],
    ['min="1"', 'min="0"'],
    ['min="1"', ''],
    ['max="14"', 'max="15"'],
    ['name="arrival" required', 'name="arrival" required min="2026-01-01"'],
  ] as const) {
    assert.deepEqual(ids(runBooking(auditFormsDeclared, from, to)), ['forms-declared'], to);
  }
  // `1.0` and `1e0` are the number 1.
  assert.deepEqual(ids(runBooking(auditFormsDeclared, 'min="1"', 'min="1.0"')), []);
  assert.deepEqual(ids(runBooking(auditFormsDeclared, 'max="14"', 'max="1.4e1"')), []);
});

test('forms-declared: a date field compares min and max as written', () => {
  const options = optionsOf({
    ...FORMS,
    forms: {
      ...FORMS.forms,
      booking: { fields: [{ name: 'arrival', type: 'date', min: '2027-01-01', max: '2027-12-31' }] },
    },
  });
  const form = (attrs: string): string =>
    `<form action="/api/forms/booking/" method="post">${hidden('/')} <label>Anreise (Pflichtfeld) <input type="date" name="arrival" required ${attrs} autocomplete="off"></label> ${privacyOf('/')}</form>`;
  const main = (attrs: string): string => contactMain('/', `${contactForm('/')} ${form(attrs)}`);
  assert.deepEqual(ids(runMain(ALL, main('min="2027-01-01" max="2027-12-31"'), options)), []);
  assert.deepEqual(ids(runMain(ALL, main('min="2027-01-01"'), options)), ['forms-declared']);
  assert.deepEqual(ids(runMain(ALL, main('min="2027-1-1" max="2027-12-31"'), options)), ['forms-declared']);
});

test('forms-declared: a select holds exactly the declared options and at most one empty option', () => {
  const options =
    '<option value=""></option><option value="single">Einzelzimmer</option><option value="double">Doppelzimmer</option><option value="family">Familienzimmer</option>';
  assert.deepEqual(ids(runBooking(auditFormsDeclared, '<option value=""></option>', '')), []);
  for (const to of [
    '<option value=""></option><option value="single">Einzelzimmer</option><option value="double">Doppelzimmer</option>',
    `${options}<option value="suite">Suite</option>`,
    `${options}<option value="">–</option>`,
    `${options}<option value="single">Einzelzimmer</option>`,
    '<option value=""></option><option value="single">Einzelzimmer</option><option value="double">Doppelzimmer</option><option value="Family">Familienzimmer</option>',
  ]) {
    assert.deepEqual(ids(runBooking(auditFormsDeclared, options, to)), ['forms-declared'], to);
  }
  // An option without a value submits its text.
  assert.deepEqual(
    ids(runBooking(auditFormsDeclared, '<option value="family">Familienzimmer</option>', '<option> family </option>')),
    [],
  );
  assert.deepEqual(ids(runBooking(auditFormsDeclared, '<select name="room"', '<select multiple name="room"')), [
    'forms-declared',
  ]);
});

test('forms-declared: a radio group in place of the select passes, and its values are the declared options', () => {
  const select = /<label>Zimmer \(Pflichtfeld\) <select.*?<\/select><\/label>/.exec(bookingForm('/'))?.[0] ?? '';
  const radio = (value: string, required = ' required'): string =>
    `<label><input type="radio" name="room" value="${value}"${required}> ${value}</label>`;
  const group = (radios: string): string => `<fieldset><legend>Zimmer (Pflichtfeld)</legend> ${radios}</fieldset>`;
  const three = `${radio('single')} ${radio('double')} ${radio('family')}`;
  assert.deepEqual(ids(runBooking(ALL, select, group(three))), []);
  assert.deepEqual(ids(runBooking(auditFormsDeclared, select, group(`${radio('single')} ${radio('double')}`))), [
    'forms-declared',
  ]);
  assert.deepEqual(ids(runBooking(auditFormsDeclared, select, group(`${three} ${radio('suite')}`))), [
    'forms-declared',
  ]);
  assert.deepEqual(
    ids(runBooking(auditFormsDeclared, select, group(`${radio('single')} ${radio('double')} ${radio('family', '')}`))),
    ['forms-declared'],
  );
  // A radio without a value submits `on`.
  assert.deepEqual(
    ids(
      runBooking(
        auditFormsDeclared,
        select,
        group(`${three} <label><input type="radio" name="room" required> x</label>`),
      ),
    ),
    ['forms-declared'],
  );
  // A radio mixed with a select is no group.
  assert.deepEqual(ids(runBooking(auditFormsDeclared, select, `${select} ${group(radio('single'))}`)), [
    'forms-declared',
  ]);
});

test('forms-declared: consent is a required checkbox', () => {
  assert.deepEqual(ids(runBooking(auditFormsDeclared, 'name="terms" required', 'name="terms"')), ['forms-declared']);
});

test('forms-declared: autocomplete as declared, compared in ASCII lower case; not on a checkbox', () => {
  assert.deepEqual(ids(runContact(auditFormsDeclared, 'autocomplete="name"', 'autocomplete="NAME"')), []);
  assert.deepEqual(ids(runContact(auditFormsDeclared, 'autocomplete="name"', 'autocomplete="given-name"')), [
    'forms-declared',
  ]);
  assert.deepEqual(ids(runContact(auditFormsDeclared, 'autocomplete="email"', '')), ['forms-declared']);
  assert.deepEqual(
    ids(runBooking(auditFormsDeclared, 'name="terms" required', 'name="terms" required autocomplete="on"')),
    [],
  );
});

test('forms-declared: a declared autocomplete replaces the default', () => {
  const options = optionsOf({
    ...FORMS,
    forms: {
      ...FORMS.forms,
      contact: {
        fields: [
          { name: 'name', type: 'text', autocomplete: 'given-name' },
          FORMS.forms.contact.fields[1],
          FORMS.forms.contact.fields[2],
        ],
      },
    },
  });
  const main = (value: string): string =>
    contactMain('/', `${swap(contactForm('/'), 'autocomplete="name"', `autocomplete="${value}"`)} ${bookingForm('/')}`);
  assert.deepEqual(ids(runMain(auditFormsDeclared, main('given-name'), options)), []);
  assert.deepEqual(ids(runMain(auditFormsDeclared, main('name'), options)), ['forms-declared']);
});

test('forms-declared: formaction, formmethod, formenctype and form attributes fail', () => {
  for (const to of [
    '<button type="submit" formaction="/api/forms/booking/">',
    '<button type="submit" formmethod="get">',
    '<button type="submit" formenctype="text/plain">',
    '<button type="submit" form="other">',
  ]) {
    assert.deepEqual(ids(runContact(auditFormsDeclared, '<button type="submit">', to)), ['forms-declared'], to);
  }
  const outside = contactMain(
    '/',
    `${swap(contactForm('/'), '<form ', '<form id="kontakt" ')} <label>Firma (optional) <input type="text" name="company" form="kontakt" autocomplete="organization"></label> ${bookingForm('/')}`,
  );
  assert.deepEqual(ids(runMain(auditFormsDeclared, outside)), ['forms-declared']);
});

test('forms-declared: a page with a kit form needs #sent and #not-sent', () => {
  for (const to of [
    '<p id="sent" tabindex="-1">Danke, wir antworten bald.</p>',
    '<p id="not-sent" tabindex="-1">Das hat nicht geklappt.</p>',
  ]) {
    const report = runMain(auditFormsDeclared, swap(contactMain('/'), to, ''));
    assert.deepEqual(findings(report), [
      `forms-declared / no element with the id ${to.includes('not-sent') ? 'not-sent' : 'sent'}`,
    ]);
  }
});

test('forms-declared: a declared form that no page holds fails at its field', () => {
  const report = runMain(auditFormsDeclared, contactMain('/', contactForm('/')));
  assert.deepEqual(findings(report), [
    'forms-declared astro-kit.json: forms.booking no page holds a form that posts to /api/forms/booking/',
  ]);
});

test('forms-declared: a form on /404.html is left to routes-404, and it counts for no declared form', () => {
  const files = formSite(contactMain('/', contactForm('/')));
  files['404.html'] = notFoundPage(OPTIONS, { main: `<h1>Nicht gefunden</h1> ${bookingForm('/404.html')}` });
  const report = run(auditFormsDeclared, files);
  assert.deepEqual(findings(report), [
    'forms-declared astro-kit.json: forms.booking no page holds a form that posts to /api/forms/booking/',
  ]);
});

test('forms-declared: without forms, a form of the kit names no declared id', () => {
  const options = optionsOf(TWO_LOCALES);
  const report = runMain(auditFormsDeclared, contactMain('/'), options);
  assert.deepEqual(ids(report), ['forms-declared']);
  assert.equal(report.findings.length, 2);
});

test('forms-declared: a form that posts elsewhere is no form of the kit', () => {
  const other = `<form action="/suche/" method="get"><label>Suche (optional) <input type="search" name="q" autocomplete="off"></label></form>`;
  assert.deepEqual(ids(runMain(ALL, contactMain('/', `${contactForm('/')} ${bookingForm('/')} ${other}`))), []);
});

// forms-fields

test('forms-fields: a field without a label fails; aria-label is no label', () => {
  const name =
    '<label>Name (Pflichtfeld) <input type="text" name="name" required maxlength="200" autocomplete="name"></label>';
  for (const to of [
    '<input type="text" name="name" required maxlength="200" autocomplete="name">',
    '<input type="text" name="name" required maxlength="200" autocomplete="name" aria-label="Name (Pflichtfeld)">',
    '<label for="other">Name (Pflichtfeld)</label> <input type="text" name="name" id="n" required maxlength="200" autocomplete="name">',
  ]) {
    assert.deepEqual(ids(runContact(auditFormsFields, name, to)), ['forms-fields'], to);
  }
  const byFor =
    '<label for="n">Name (Pflichtfeld)</label> <input type="text" name="name" id="n" required maxlength="200" autocomplete="name">';
  assert.deepEqual(ids(runContact(ALL, name, byFor)), []);
});

test('forms-fields: hidden, submit, reset, button and image inputs and fields under [inert] need no label', () => {
  // The field under [inert] has its autocomplete: only the label check skips it (section 8).
  const extra =
    '<input type="hidden" name="x"> <input type="submit" value="Senden"> <input type="reset"> <input type="button" value="b"> <input type="image" alt="Senden" src="/a.png"> <div inert><input type="text" name="y" autocomplete="off"></div>';
  assert.deepEqual(ids(runContact(auditFormsFields, '<button type="submit">', `${extra} <button type="submit">`)), []);
});

test('forms-fields: a required label needs a required word, an optional label an optional word, whole words only', () => {
  for (const [from, to] of [
    ['Name (Pflichtfeld)', 'Name'],
    ['Name (Pflichtfeld)', 'Name (optional)'],
    ['Name (Pflichtfeld)', 'Name (Pflichtfelder)'],
    ['Name (Pflichtfeld)', 'Name*'],
  ] as const) {
    assert.deepEqual(ids(runContact(auditFormsFields, from, to)), ['forms-fields'], to);
  }
  assert.deepEqual(ids(runBooking(auditFormsFields, 'Telefon (optional)', 'Telefon (Pflichtfeld)')), ['forms-fields']);
  for (const to of ['Name (pflicht)', 'Name (ERFORDERLICH)', 'Name <span class="visually-hidden">Pflichtfeld</span>']) {
    assert.deepEqual(ids(runContact(auditFormsFields, 'Name (Pflichtfeld)', to)), [], to);
  }
  assert.deepEqual(ids(runBooking(auditFormsFields, 'Telefon (optional)', 'Telefon (freiwillig)')), []);
});

test('forms-fields: a label that holds both words fails, whichever the field is', () => {
  const both = runContact(auditFormsFields, 'Name (Pflichtfeld)', 'Name (optional, Pflichtfeld)');
  assert.deepEqual(ids(both), ['forms-fields']);
  assert.match(both.findings[0]?.detail ?? '', /has the optional word "optional"; the field is required/);
  const optional = runBooking(auditFormsFields, 'Telefon (optional)', 'Telefon (freiwillig, erforderlich)');
  assert.deepEqual(ids(optional), ['forms-fields']);
  assert.match(optional.findings[0]?.detail ?? '', /has the required word "erforderlich"; the field is optional/);
});

test('forms-fields: the language of the field picks the words; a radio reads the legend of its fieldset', () => {
  assert.deepEqual(
    ids(runContact(auditFormsFields, '<label>Name (Pflichtfeld)', '<label lang="fr">Nom (obligatoire)')),
    [],
  );
  assert.deepEqual(
    ids(runContact(auditFormsFields, '<label>Name (Pflichtfeld)', '<label lang="fr-CH">Nom (Pflichtfeld)')),
    ['forms-fields'],
  );
  for (const [lang, word] of [
    ['it', 'obbligatorio'],
    ['en', 'required'],
    ['rm', 'obligatoric'],
  ] as const) {
    const report = runContact(auditFormsFields, '<label>Name (Pflichtfeld)', `<label lang="${lang}">Name (${word})`);
    assert.deepEqual(ids(report), [], lang);
  }
  const select = /<label>Zimmer \(Pflichtfeld\) <select.*?<\/select><\/label>/.exec(bookingForm('/'))?.[0] ?? '';
  const radios = ['single', 'double', 'family']
    .map((value) => `<label><input type="radio" name="room" value="${value}" required> ${value}</label>`)
    .join(' ');
  assert.deepEqual(
    ids(runBooking(auditFormsFields, select, `<fieldset><legend>Zimmer (Pflichtfeld)</legend> ${radios}</fieldset>`)),
    [],
  );
  assert.deepEqual(
    ids(runBooking(auditFormsFields, select, `<fieldset><legend>Zimmer</legend> ${radios}</fieldset>`)),
    ['forms-fields'],
  );
});

test('forms-fields: a field in a language without words fails on a page whose locale has words', () => {
  // A lang attribute must not switch the word check off (the lang weakness of the 7b review).
  const report = runContact(auditFormsFields, '<label>Name (Pflichtfeld)', '<label lang="es">Nombre');
  assert.deepEqual(ids(report), ['forms-fields']);
  assert.match(findings(report)[0] ?? '', /in the language "es", which has no required and optional words/);
  assert.equal(report.findings.filter((finding) => finding.warning === true).length, 0);
});

test('forms-fields: on a page whose locale has no words, the word check is skipped with a warning that fails nothing', () => {
  // The second locale has the language tag es-ES, for which the kit has no words.
  const options = optionsOf({
    ...FORMS,
    locales: [FORMS.locales[0], { code: 'fr', tag: 'es-ES', name: 'Español' }],
  });
  const files = formSite(contactMain('/'), options);
  files['fr/index.html'] = page(options, '/fr/', {
    alternates: { de: '/', fr: '/fr/' },
    main: '<h1>Contacto</h1> <label>Nombre <input type="text" name="nombre" autocomplete="name"></label>',
  });
  const report = run(auditFormsFields, files, options);
  assert.deepEqual(ids(report), []);
  assert.equal(report.ok, true);
  assert.deepEqual(
    report.findings.map((finding) => [finding.rule, finding.where, finding.warning]),
    [['forms-fields', '/fr/', true]],
  );
  // The warning prints its own message, not the failure message of the rule, and no fix line.
  const text = report.format();
  assert.match(
    text,
    /^! \[forms-fields\] \/fr\/: The kit has no required and optional words for this language\. \(the word check skips 1 field in the language "es"\)$/m,
  );
  assert.doesNotMatch(text, /A form field has no label/);
  assert.doesNotMatch(text, /fix:/);
});

test('forms-fields: every non-checkbox, non-radio field needs autocomplete', () => {
  assert.deepEqual(ids(runContact(auditFormsFields, ' autocomplete="name"', '')), ['forms-fields']);
  assert.deepEqual(ids(runContact(auditFormsFields, ' autocomplete="name"', ' autocomplete=" "')), ['forms-fields']);
  assert.deepEqual(
    ids(
      runBooking(auditFormsFields, '<select name="room" required autocomplete="off">', '<select name="room" required>'),
    ),
    ['forms-fields'],
  );
});

test('forms-fields: no placeholder, also on a field outside a form', () => {
  assert.deepEqual(ids(runContact(auditFormsFields, 'name="name"', 'name="name" placeholder="Anna Muster"')), [
    'forms-fields',
  ]);
  assert.deepEqual(ids(runContact(auditFormsFields, '<textarea ', '<textarea placeholder="" ')), ['forms-fields']);
  const search =
    '<label>Suche (optional) <input type="search" name="q" autocomplete="off" placeholder="Suchen"></label>';
  assert.deepEqual(ids(runMain(auditFormsFields, `${contactMain('/')} ${search}`)), ['forms-fields']);
});

test('forms-fields: a field of the mode switch needs a label, and nothing more', () => {
  const files = formSite(contactMain('/'), SWITCH_FORMS);
  const home = files['index.html'] ?? '';
  files['index.html'] = home.replace(
    /<label> (<input type="radio" name="mode" value="auto">) Automatisch <\/label>/,
    '$1',
  );
  assert.notEqual(files['index.html'], home);
  assert.deepEqual(ids(run(auditFormsFields, files, SWITCH_FORMS)), ['forms-fields']);
});

test('forms-fields: a page without forms, the 404 page included, passes', () => {
  const files = { ...ICON_FILES, [fileOf('/')]: page(OPTIONS, '/'), '404.html': notFoundPage(OPTIONS) };
  assert.deepEqual(findings(run(auditFormsFields, files)), []);
});

// forms-safety

test('forms-safety: a file input fails on any page, inside a form or not', () => {
  const file = '<label>Datei (optional) <input type="file" name="cv" autocomplete="off"></label>';
  assert.deepEqual(ids(runMain(auditFormsSafety, `${contactMain('/')} ${file}`)), ['forms-safety']);
  assert.deepEqual(
    ids(runMain(auditFormsSafety, `${contactMain('/')} ${file.replace('type="file"', 'type="FILE"')}`)),
    ['forms-safety'],
  );
});

test('forms-safety: a pre-checked checkbox or radio fails', () => {
  assert.deepEqual(ids(runBooking(auditFormsSafety, 'name="terms" required', 'name="terms" required checked')), [
    'forms-safety',
  ]);
  const radio = '<label><input type="radio" name="size" value="s" checked> klein (optional)</label>';
  assert.deepEqual(ids(runMain(auditFormsSafety, `${contactMain('/')} ${radio}`)), ['forms-safety']);
  // A checked attribute on another control is no pre-checked choice.
  assert.deepEqual(ids(runContact(auditFormsSafety, 'name="name"', 'name="name" checked')), []);
});

test('forms-safety: every POST form links the privacy page of its locale inside the form', () => {
  const privacy = '<a href="/datenschutz/">Datenschutzerklärung</a>';
  assert.deepEqual(ids(runContact(auditFormsSafety, privacy, 'Datenschutzerklärung')), ['forms-safety']);
  assert.deepEqual(
    ids(runContact(auditFormsSafety, privacy, '<a href="/fr/protection-des-donnees/">Datenschutzerklärung</a>')),
    ['forms-safety'],
  );
  assert.deepEqual(
    ids(runContact(auditFormsSafety, privacy, '<a href="/datenschutz/index.html">Datenschutzerklärung</a>')),
    [],
  );
  assert.deepEqual(
    ids(
      runContact(
        auditFormsSafety,
        privacy,
        '<a href="https://example.ch/datenschutz/#formulare">Datenschutzerklärung</a>',
      ),
    ),
    [],
  );
  // A link next to the form does not count.
  const main = contactMain(
    '/',
    `${swap(contactForm('/'), privacy, 'Datenschutzerklärung')} ${privacy} ${bookingForm('/')}`,
  );
  assert.deepEqual(ids(runMain(auditFormsSafety, main)), ['forms-safety']);
});

test('forms-safety: a POST form of any action needs the link; a GET form does not', () => {
  const post = '<form action="https://other.example/x" method="POST"><button type="submit">x</button></form>';
  const get = '<form action="/suche/" method="get"><button type="submit">x</button></form>';
  assert.deepEqual(ids(runMain(auditFormsSafety, `${contactMain('/')} ${post}`)), ['forms-safety']);
  assert.deepEqual(ids(runMain(auditFormsSafety, `${contactMain('/')} ${get}`)), []);
});

// The findings of the 7b review: each case failed to fail before the fix.

/** The contact form with a hidden `return`, a honeypot and one field, posting to `action`: no complete kit form. */
const bareForm = (action: string, method = 'post'): string =>
  `<form action="${action}" method="${method}"><label>Name (Pflichtfeld) <input type="text" name="name" required maxlength="200" autocomplete="name"></label> ${privacyOf('/')} <button>Senden</button></form>`;

/** Runs the three rules on the German home with both forms and one more piece of markup. */
const runExtra = (extra: string): Report => runMain(ALL, `${contactMain('/')} ${extra}`);

test('forms-declared: method and enctype compare as HTML does, without a trim', () => {
  for (const to of ['method="post "', 'method=" post"', 'method="post\t"']) {
    assert.deepEqual(ids(runContact(ALL, 'method="post"', to)), ['forms-declared'], to);
  }
  const enctype = 'method="post" enctype="multipart/form-data "';
  assert.deepEqual(ids(runContact(auditFormsDeclared, 'method="post"', enctype)), ['forms-declared']);
  // A form with method="post " sends a GET: forms-safety needs no privacy link for it.
  const get = '<form action="https://news.example/x" method="post "><button>Abo</button></form>';
  assert.deepEqual(ids(runMain(auditFormsSafety, `${contactMain('/')} ${get}`)), []);
});

test('forms-declared: a submit control that changes a post to /api/forms/ fails on any page', () => {
  const plain = `<form method="post" action="https://news.example/x"><button formaction="/api/forms/contact/">x</button> ${privacyOf('/')}</form>`;
  assert.deepEqual(ids(runExtra(plain)), ['forms-declared']);
  const upper = plain.replace('formaction="/api/forms/contact/"', 'formaction="/API/Forms/contact/"');
  assert.deepEqual(ids(runExtra(upper)), ['forms-declared']);
  // A control outside any kit form that names a kit form's action with formmethod changes a kit post too.
  // A control outside its form, named by form=, changes the post of a form that is no kit form.
  const outside = `<form id="abo" action="https://news.example/x"></form> <button form="abo" formaction="/api/forms/contact/" formmethod="post">x</button>`;
  const report = runMain(auditFormsDeclared, `${contactMain('/')} ${outside}`);
  assert.deepEqual(ids(report), ['forms-declared']);
  assert.match(findings(report)[0] ?? '', /<button form="abo" .*> changes a post to \/api\/forms\/contact\//);
  for (const to of ['<button type="submit" formtarget="_blank">', '<button type="submit" formnovalidate>']) {
    assert.deepEqual(ids(runContact(auditFormsDeclared, '<button type="submit">', to)), ['forms-declared'], to);
  }
});

test('forms-declared: an action with backslashes resolves as a browser resolves it', () => {
  assert.deepEqual(
    ids(runContact(ALL, 'action="/api/forms/contact/"', 'action="\\api\\forms\\contact\\"')),
    [],
    'the contact form still posts to /api/forms/contact/',
  );
  const extra = runExtra(bareForm('\\api\\forms\\contact\\'));
  assert.deepEqual(ids(extra), ['forms-declared']);
  assert.match(findings(extra)[0] ?? '', /0 controls named return/);
});

test('forms-safety: a form that posts by formmethod needs the privacy link', () => {
  const form =
    '<form action="https://news.example/x"><label>E-Mail (Pflichtfeld) <input type="email" name="e" required autocomplete="email"></label><button formmethod="post">Abo</button></form>';
  assert.deepEqual(ids(runExtra(form)), ['forms-safety']);
  const byForm =
    '<form id="abo" action="https://news.example/x"></form> <button form="abo" formmethod="POST">Abo</button>';
  assert.deepEqual(ids(runExtra(byForm)), ['forms-safety']);
});

test('forms-declared: a kit form that can never be sent fails', () => {
  for (const [from, to] of [
    ['name="website" type="text"', 'name="website" value="x" type="text"'],
    ['name="return"', 'name="return" disabled'],
    ['name="email" required', 'name="email" disabled required'],
    [
      '<label>Name (Pflichtfeld) <input type="text" name="name" required maxlength="200" autocomplete="name"></label>',
      '<fieldset disabled><label>Name (Pflichtfeld) <input type="text" name="name" required maxlength="200" autocomplete="name"></label></fieldset>',
    ],
  ] as const) {
    assert.deepEqual(ids(runContact(auditFormsDeclared, from, to)), ['forms-declared'], to);
  }
  assert.deepEqual(ids(runBooking(auditFormsDeclared, 'name="terms"', 'name="terms" value=""')), ['forms-declared']);
  for (const wrapper of ['div inert', 'div hidden']) {
    const main = `<h1>K</h1> ${NOTES} <${wrapper}>${contactForm('/')}</div> ${bookingForm('/')}`;
    assert.ok(ids(runMain(auditFormsDeclared, main)).includes('forms-declared'), wrapper);
  }
  // The first legend of a disabled fieldset is not disabled, and a form in a closed dialog stays allowed.
  const legend =
    '<fieldset disabled><legend><label>Name (Pflichtfeld) <input type="text" name="name" required maxlength="200" autocomplete="name"></label></legend></fieldset>';
  const name =
    '<label>Name (Pflichtfeld) <input type="text" name="name" required maxlength="200" autocomplete="name"></label>';
  assert.deepEqual(ids(runContact(auditFormsDeclared, name, legend)), []);
  const dialog = `<h1>K</h1> ${NOTES} <dialog id="d">${contactForm('/')}</dialog> ${bookingForm('/')}`;
  assert.deepEqual(ids(runMain(ALL, dialog)), []);
});

test('forms-safety: the privacy link counts only when a visitor can see and reach it', () => {
  const link = '<a href="/datenschutz/">';
  for (const to of ['<a hidden href="/datenschutz/">', '<a aria-hidden="true" href="/datenschutz/">']) {
    assert.deepEqual(ids(runContact(auditFormsSafety, link, to)), ['forms-safety'], to);
  }
  assert.deepEqual(
    ids(runContact(auditFormsSafety, '<p>Wir lesen', '<p inert>Wir lesen')),
    ['forms-safety'],
    'a link under [inert]',
  );
  // The only link sits in the honeypot wrapper.
  const sentence = /<p>Wir lesen.*?<\/p>/.exec(contactForm('/'))?.[0] ?? '';
  const inWrapper = swap(
    swap(contactForm('/'), sentence, ''),
    'autocomplete="off"></div>',
    'autocomplete="off"><a href="/datenschutz/">x</a></div>',
  );
  assert.deepEqual(ids(runMain(auditFormsSafety, contactMain('/', `${inWrapper} ${bookingForm('/')}`))), [
    'forms-safety',
  ]);
});

test('forms-fields: under [inert] only the label check is skipped', () => {
  const aside =
    '<aside inert><form action="/suche/" method="get"><input type="text" name="q" placeholder="Suche"></form></aside>';
  const report = runExtra(aside);
  assert.deepEqual(ids(report), ['forms-fields']);
  assert.match(findings(report)[0] ?? '', /has a placeholder; .* has no autocomplete/);
  assert.doesNotMatch(findings(report)[0] ?? '', /no label/);
});

test('forms-fields: the word comes from the rendered label text, not from controls or hidden text', () => {
  const message =
    '<label>Nachricht (Pflichtfeld) <textarea name="message" required maxlength="5000" autocomplete="off">';
  for (const to of [
    '<label>Nachricht <textarea name="message" required maxlength="5000" autocomplete="off">Pflichtfeld',
    '<label>Nachricht<span hidden> (Pflichtfeld)</span> <textarea name="message" required maxlength="5000" autocomplete="off">',
    '<label>Nachricht<span aria-hidden="true"> (Pflichtfeld)</span> <textarea name="message" required maxlength="5000" autocomplete="off">',
    '<label>Nachricht<template>(Pflichtfeld)</template> <textarea name="message" required maxlength="5000" autocomplete="off">',
  ]) {
    assert.deepEqual(ids(runContact(auditFormsFields, message, to)), ['forms-fields'], to);
  }
  // The text of an option is no part of the label of the select.
  assert.deepEqual(ids(runBooking(auditFormsFields, 'Zimmer (Pflichtfeld) <select', 'Zimmer <select')), [
    'forms-fields',
  ]);
  const select = /<label>Zimmer \(Pflichtfeld\) <select.*?<\/select><\/label>/.exec(bookingForm('/'))?.[0] ?? '';
  const radios = ['single', 'double', 'family']
    .map((value) => `<label><input type="radio" name="room" value="${value}" required> ${value}</label>`)
    .join(' ');
  const legend = `<fieldset><legend>Zimmer<span hidden> (Pflichtfeld)</span></legend> ${radios}</fieldset>`;
  assert.deepEqual(ids(runBooking(auditFormsFields, select, legend)), ['forms-fields']);
});

test('forms-declared: every same-origin POST form posts to /api/forms/<id>/ of a declared form', () => {
  for (const action of ['/API/forms/contact/', 'x/api/forms/contact/', '/kontakt/', '', 'https://example.ch/x/']) {
    assert.deepEqual(ids(runExtra(bareForm(action))), ['forms-declared'], action);
  }
  const noAction = `<form method="post"><button>x</button> ${privacyOf('/')}</form>`;
  assert.deepEqual(ids(runExtra(noAction)), ['forms-declared']);
  // A POST to another origin, and a GET form, are no post of this site.
  assert.deepEqual(ids(runExtra(bareForm('https://news.example/x'))), []);
  assert.deepEqual(ids(runExtra(bareForm('/suche/', 'get'))), []);
  // On /404.html a same-origin POST that is no kit form fails too; a kit action there is routes-404's.
  const files = formSite();
  files['404.html'] = notFoundPage(OPTIONS, { main: `<h1>Nicht gefunden</h1> ${bareForm('/kontakt/')}` });
  assert.deepEqual(
    findings(run(auditFormsDeclared, files)).map((line) => line.split(' ').slice(0, 2).join(' ')),
    ['forms-declared /404.html'],
  );
  files['404.html'] = notFoundPage(OPTIONS, { main: `<h1>Nicht gefunden</h1> ${bareForm('/api/forms/x/')}` });
  assert.deepEqual(findings(run(auditFormsDeclared, files)), []);
});

test('forms-declared: a constraint that no declaration expresses fails on a declared control', () => {
  for (const [from, to] of [
    ['name="name" required', 'name="name" pattern="[A-Za-z ]+" required'],
    ['name="message" required', 'name="message" minlength="300" required'],
    ['name="name" required', 'name="name" readonly required'],
    ['name="email" required', 'name="email" multiple required'],
    ['method="post"', 'method="post" novalidate'],
    ['<button type="submit">', '<button type="submit" formnovalidate>'],
  ] as const) {
    assert.deepEqual(ids(runContact(auditFormsDeclared, from, to)), ['forms-declared'], to);
  }
  for (const [from, to, expected] of [
    ['name="nights" required', 'name="nights" step="7" required', ['forms-declared']],
    ['name="nights" required', 'name="nights" step="any" required', []],
    ['name="nights" required', 'name="nights" step="1" required', []],
    ['name="arrival" required', 'name="arrival" step="1" required', ['forms-declared']],
    ['name="arrival" required', 'name="arrival" maxlength="10" required', ['forms-declared']],
    ['name="tel" maxlength', 'name="tel" accept="image/*" maxlength', ['forms-declared']],
    ['name="room" required', 'name="room" required min="1"', ['forms-declared']],
  ] as const) {
    assert.deepEqual(ids(runBooking(auditFormsDeclared, from, to)), expected, to);
  }
});

test('forms-declared: an email field carries EMAIL_PATTERN, and no other field has a pattern', () => {
  const pattern = ` pattern="${EMAIL_PATTERN}"`;
  assert.deepEqual(ids(runContact(auditFormsDeclared, pattern, '')), ['forms-declared']);
  assert.deepEqual(ids(runContact(auditFormsDeclared, pattern, ' pattern=".+@.+"')), ['forms-declared']);
  assert.match(findings(runContact(auditFormsDeclared, pattern, ''))[0] ?? '', /EMAIL_PATTERN/);
});

test('forms-declared: accept-charset other than utf-8 fails', () => {
  for (const [value, expected] of [
    ['iso-8859-1', ['forms-declared']],
    ['utf-8 iso-8859-1', ['forms-declared']],
    ['UTF-8', []],
    [' utf-8 ', []],
  ] as const) {
    const report = runContact(auditFormsDeclared, 'method="post"', `method="post" accept-charset="${value}"`);
    assert.deepEqual(ids(report), expected, value);
  }
});

test('forms-declared: #sent and #not-sent follow the markup pattern', () => {
  const notes = (sent: string, notSent = '<p id="not-sent" tabindex="-1">Nein.</p>'): string =>
    `<h1>K</h1> ${sent} ${notSent} ${contactForm('/')} ${bookingForm('/')}`;
  for (const sent of [
    '<p id="sent">Danke.</p>',
    '<p id="sent" tabindex="-1"></p>',
    '<p id="sent" tabindex="-1"><span hidden>Danke.</span></p>',
    '<dialog><p id="sent" tabindex="-1">Danke.</p></dialog>',
  ]) {
    assert.deepEqual(ids(runMain(auditFormsDeclared, notes(sent))), ['forms-declared'], sent);
  }
  const onForms = `<h1>K</h1> ${swap(contactForm('/'), '<form ', '<form id="sent" ')} ${swap(bookingForm('/'), '<form ', '<form id="not-sent" ')}`;
  assert.deepEqual(ids(runMain(auditFormsDeclared, onForms)), ['forms-declared']);
  // A closed details may hold a note: the browser opens it for the fragment.
  const details = notes('<details><summary>Status</summary><p id="sent" tabindex="-1">Danke.</p></details>');
  assert.deepEqual(ids(runMain(auditFormsDeclared, details)), []);
});

test('forms-declared: nothing outside the wrapper names the honeypot', () => {
  const wrapper = '<div class="visually-hidden" inert aria-hidden="true"><input name="website"';
  for (const to of [
    '<label for="hp">Website (optional)</label><div class="visually-hidden" inert aria-hidden="true"><input id="hp" name="website"',
    '<p id="d" aria-describedby="hp">x</p><div class="visually-hidden" inert aria-hidden="true"><input id="hp" name="website"',
  ]) {
    assert.deepEqual(ids(runContact(auditFormsDeclared, wrapper, to)), ['forms-declared'], to);
  }
  const inside =
    '<div class="visually-hidden" inert aria-hidden="true"><label for="hp">Website</label><input id="hp" name="website"';
  assert.deepEqual(ids(runContact(auditFormsDeclared, wrapper, inside)), []);
});

test('forms-fields: a labelled field under [inert] keeps the words of its label', () => {
  const field = '<label>Suche (optional) <input type="search" name="q" autocomplete="off"></label>';
  assert.deepEqual(ids(runExtra(`<aside inert>${field}</aside>`)), []);
  assert.deepEqual(ids(runExtra(`<aside inert>${field.replace(' (optional)', '')}</aside>`)), ['forms-fields']);
});

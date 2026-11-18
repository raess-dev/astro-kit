/**
 * The html audit (`src/audit/html.ts`): `html-validate` with only the kit config of section 8. The oracle is
 * html-validate itself: a case runs a validator with the config as the specification writes it, and compares its
 * messages with the findings. The real pages of the test site, as Astro and the kit write them, must pass.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { type ConfigData, HtmlValidate, StaticConfigLoader } from 'html-validate';
import { auditHtml, auditHtmlValidate, HTML_VALIDATE_CONFIG, sizeOf, withoutDirectives } from '../../src/audit/html.ts';
import { modeInsert, speculationInsert } from '../../src/inject.ts';
import type { Options } from '../../src/options.ts';
import type { Report } from '../../src/registry.ts';
import {
  contextOf,
  findings,
  ICON_FILES,
  ids,
  OPTIONS,
  PAGE_CSS,
  page,
  SWITCH_OPTIONS,
  site,
} from './audit-fixtures.ts';
import { optionsOf, origin, TWO_LOCALES } from './fixtures.ts';

// Inputs

/** The config of section 8, written out as the specification gives it: the oracle of these cases. */
const SPEC_CONFIG: ConfigData = {
  root: true,
  extends: ['html-validate:recommended', 'html-validate:document'],
  elements: ['html5'],
  rules: {
    'unique-landmark': 'error',
    'prefer-native-element': 'error',
    'no-missing-references': 'error',
    'heading-level': 'off',
    'wcag/h37': 'off',
    'long-title': 'off',
    'no-inline-style': 'off',
    'require-sri': ['error', { target: 'crossorigin' }],
  },
};

const oracle = new HtmlValidate(new StaticConfigLoader(SPEC_CONFIG));

/** The error messages of the oracle for a text, as `<rule id>: <line>:<column>`, in their order. */
async function oracleMessages(html: string): Promise<string[]> {
  const report = await oracle.validateString(html, 'page.html');
  return report.results
    .flatMap((result) => result.messages)
    .filter((message) => message.severity === 2)
    .map((message) => `${message.ruleId}: ${message.line}:${message.column}`);
}

/** Runs the html audit on a client directory and gives the report. */
async function runFiles(files: Record<string, string>, options: Options = OPTIONS): Promise<Report> {
  const ctx = contextOf(files, { options });
  await auditHtmlValidate(ctx);
  return ctx.report;
}

/** Runs the html audit on one page at `/`. */
const run = (html: string, options: Options = OPTIONS): Promise<Report> =>
  runFiles({ ...ICON_FILES, 'index.html': html }, options);

/** The findings of a report as `<rule id>: <line>:<column>`, read back from the details, in their order. */
const placesOf = (report: Report): string[] =>
  report.findings.map((finding) => (finding.detail ?? '').replace(/^([^:]+): .* \((\d+:\d+)\)$/, '$1: $2'));

const home = (main: string, options: Options = OPTIONS): string =>
  page(options, '/', { main: `<h1>Titel der Seite</h1> ${main}` });

/** The test site settings for the inserts: all four mode options, speculation rules on. */
const FOUR_MODES = optionsOf({ ...TWO_LOCALES, modes: { auto: true, light: true, dark: true, contrast: true } });

// The real pages of the test site (stage 1), as Astro 7.4 and the kit write them: the CSS is shortened.

const REAL_HOME_HEAD = [
  '<!DOCTYPE html><html lang="de-CH"> <head><meta charset="utf-8">',
  '<meta name="viewport" content="width=device-width, initial-scale=1"><title>',
  'Hotel Lärchenwald – Ihr Berghotel in Sils im Engadin</title>',
  '<meta name="description" content="Familienhotel am Lärchenwald über dem Silsersee: ruhige Zimmer mit',
  ' Arvenholz, Engadiner Küche und Wanderwege ab der Haustür. Fragen Sie Ihr Zimmer direkt an.">',
  '<link rel="canonical" href="https://laerchenwald.example/">',
  '<link rel="alternate" hreflang="de-CH" href="https://laerchenwald.example/">',
  '<link rel="alternate" hreflang="fr-CH" href="https://laerchenwald.example/fr/">',
  '<link rel="alternate" hreflang="en" href="https://laerchenwald.example/en/">',
  '<link rel="alternate" hreflang="x-default" href="https://laerchenwald.example/">',
  '<meta property="og:type" content="website">',
  '<meta property="og:site_name" content="Hotel Lärchenwald">',
  '<meta property="og:title" content="Hotel Lärchenwald – Ihr Berghotel in Sils im Engadin">',
  '<meta property="og:description" content="Familienhotel am Lärchenwald über dem Silsersee: ruhige Zim',
  'mer mit Arvenholz, Engadiner Küche und Wanderwege ab der Haustür. Fragen Sie Ihr Zimmer direkt an.">',
  '<meta property="og:url" content="https://laerchenwald.example/">',
  '<meta property="og:locale" content="de_CH"><link rel="icon" href="/favicon.ico" sizes="32x32">',
  '<link rel="icon" href="/icon.svg" type="image/svg+xml">',
  '<link rel="apple-touch-icon" href="/apple-touch-icon.png"><script type="application/ld+json">',
  '{"@context":"https://schema.org","@graph":[{"@type":"Hotel","@id":"https://laerchenwald.example/#org',
  'anization","name":"Hotel Lärchenwald","legalName":"Hotel Lärchenwald AG","url":"https://laerchenwald',
  '.example/","email":"info@laerchenwald.example","telephone":"+41815550110","vatID":"CHE-123.456.789 M',
  'WST","taxID":"CHE-123.456.789","address":{"@type":"PostalAddress","streetAddress":"Via da Fex 7","po',
  'stalCode":"7514","addressLocality":"Sils im Engadin/Segl","addressRegion":"GR","addressCountry":"CH"',
  '},"openingHoursSpecification":[{"@type":"OpeningHoursSpecification","dayOfWeek":["Monday","Tuesday",',
  '"Wednesday","Thursday","Friday","Saturday","Sunday"],"opens":"07:00","closes":"22:00"}],"specialOpen',
  'ingHoursSpecification":[{"@type":"OpeningHoursSpecification","validFrom":"2027-04-05","validThrough"',
  ':"2027-06-03","opens":"00:00","closes":"00:00"}]},{"@type":"WebPage","@id":"https://laerchenwald.exa',
  'mple/#webpage","url":"https://laerchenwald.example/","name":"Hotel Lärchenwald – Ihr Berghotel in Si',
  'ls im Engadin","description":"Familienhotel am Lärchenwald über dem Silsersee: ruhige Zimmer mit Arv',
  'enholz, Engadiner Küche und Wanderwege ab der Haustür. Fragen Sie Ihr Zimmer direkt an.","inLanguage',
  '":"de-CH"},{"@type":"WebSite","@id":"https://laerchenwald.example/#website","url":"https://laerchenw',
  'ald.example/","name":"Hotel Lärchenwald"}]}</script>',
].join('');
const REAL_CSP_META = [
  "<meta http-equiv=\"content-security-policy\" content=\"default-src 'self';img-src 'self';font-src 'self",
  "';connect-src 'self';media-src 'self';manifest-src 'self';worker-src 'none';frame-src 'none';form-ac",
  "tion 'self';base-uri 'self';object-src 'none'; script-src 'self' 'sha256-4255RGsO6JUC8vuukcO69AaAmBK",
  "nnolynaWf9b0Q6og=' 'sha256-tVX7IDqXb4rkmRiqqGfEY8YPs6KvuNlSnmTbTdmGmSs=' 'sha256-xIb/Pa7FUshAu4ihwjc",
  "hYcQpyCI8eS8kt40GpOAYCz8=' 'sha256-1BvDVWLr3QCC20uHhUDi27eDFVJpk1uMQJGIWKUks2I=' 'sha256-kmZE/W8I1iu",
  "Tnl1b3yqzv9/DQZenPngd3NjSKMQl7y0=' 'sha256-Y8t0ntteBwH+PqGKUyjWW3CAk+BNJKSoQc0xZ68FjhM=' 'sha256-0O7",
  "iB6zr9x0r6X6eWYITC9V5q+yWCGAoFvcysBGbY9Q='; style-src 'self' 'sha256-MX8aRUv2cSkY6AbIy/05lHe7WdcOEVy",
  "qe0guesH9UH8=' 'sha256-FXsC3G9WM2RAYM6hXWDPZoI9ZM4mtUg0KpHyQ9zLhyM=' 'sha256-9LQvTPYt4oDTxM1cEvIAs3h",
  "4yhL4F6O4OtiN7jv8smI=' 'sha256-/qov563Uu4dGogHH76uKGF/jYBeOs4ADDEfeSDSkTtI=';\">",
].join('');
const REAL_HOME_BODY = [
  '</head> <body> <a class="skip-link visually-hidden" href="#content">Zum Inhalt springen</a>',
  ' <header class="site-header"> <div class="site-header__inner center">',
  ' <a class="site-header__brand" href="/">',
  ' <svg class="site-header__mark" viewBox="0 0 32 32" width="32" height="32" aria-hidden="true">',
  ' <path d="M16 2l5.5 9H19l5 7.5h-3l5.5 8h-9V30h-3v-3.5h-9l5.5-8H8l5-7.5h-2.5z"></path> </svg>',
  ' Hotel Lärchenwald </a> <div class="site-header__tools"> <nav aria-label="Sprache">',
  ' <ul class="site-header__languages"> <li>',
  ' <a class="site-header__language" href="/" lang="de-CH" hreflang="de-CH" aria-current="page">',
  ' DE <span class="visually-hidden">– Deutsch</span> </a> </li><li>',
  ' <a class="site-header__language" href="/fr/" lang="fr-CH" hreflang="fr-CH">',
  ' FR <span class="visually-hidden">– Français</span> </a> </li><li>',
  ' <a class="site-header__language" href="/en/" lang="en" hreflang="en">',
  ' EN <span class="visually-hidden">– English</span> </a> </li> </ul> </nav>',
  ' <details class="mode-switch" data-mode-switch> <summary>Darstellung</summary>',
  ' <fieldset class="mode-switch__panel"> <legend class="visually-hidden">Darstellung wählen</legend>',
  ' <label> <input type="radio" name="mode" value="auto"> Automatisch </label><label>',
  ' <input type="radio" name="mode" value="light"> Hell </label><label>',
  ' <input type="radio" name="mode" value="dark"> Dunkel </label><label>',
  ' <input type="radio" name="mode" value="contrast"> Mehr Kontrast </label> </fieldset> </details>',
  ' </div> </div> </header> <main id="content">  <section class="hero">',
  ' <div class="hero__content center stack"> <p class="hero__eyebrow">',
  'Sils im Engadin · 1809 m ü. M.</p> <h1>Ruhe finden zwischen Lärchen und See</h1>  <p class="lede">',
  '\nDas Hotel Lärchenwald liegt am Eingang zum Fextal, zehn Gehminuten vom Silsersee. Seit drei Generat',
  'ionen empfängt\n      Familie Clalüna hier Gäste, die Stille, gutes Essen und weite Wege suchen.\n</p>',
  ' <p><a class="button" href="mailto:info@laerchenwald.example">Zimmer anfragen</a></p> <p>',
  'Oder rufen Sie uns an: <a href="tel:+41815550110">+41 81 555 01 10</a></p>  </div> </section>',
  ' <section class="text-section"> <div class="center stack">  <h2>Ein Haus mit Geschichte</h2> <p>',
  '\nDas Haus wurde 1926 als Pension für Sommergäste gebaut und ist bis heute ein Familienbetrieb. Die 2',
  '4 Zimmer sind\n      mit Arvenholz ausgebaut, in der Stube steht noch der Specksteinofen von damals, ',
  'und auf der Terrasse sitzen Sie im\n      Sommer unter alten Lärchen.\n</p>',
  ' <p>',
  '\nWir halten es einfach: ein gutes Bett, eine ehrliche Küche und Zeit für unsere Gäste. Einen Fernseh',
  'er bringen wir\n      Ihnen auf Wunsch ins Zimmer, WLAN gibt es im ganzen Haus.\n</p>',
  '  </div> </section> <section class="text-section"> <div class="center stack">  <h2>',
  'Was Sie bei uns erwartet</h2> <div class="grid"> <article class="feature-card">',
  ' <div class="feature-card__body"> <h3>Zimmer mit Blick ins Fextal</h3> <div class="stack">  <p>',
  '\nEinzel-, Doppel- und Familienzimmer mit Arvenholz und Balkon, mit Blick auf den See oder ins Fextal',
  '. Das\n          Frühstücksbuffet mit Brot aus dem Dorf und Engadiner Bergkäse ist im Preis inbegriff',
  'en.\n</p>',
  ' <p><strong>Doppelzimmer ab CHF 320.00 pro Nacht</strong></p>  </div> </div> </article>',
  ' <article class="feature-card"> <div class="feature-card__body"> <h3>Engadiner Küche</h3>',
  ' <div class="stack">  <p>',
  '\nAm Abend kocht Küchenchef Reto Caduff ein Menü in vier Gängen: Gerstensuppe, Capuns, Wild aus dem T',
  'al und\n          Nusstorte nach dem Rezept der Grossmutter.\n</p>',
  ' <p><strong>Abendmenü CHF 98.00 pro Person</strong></p>  </div> </div> </article>',
  ' <article class="feature-card"> <div class="feature-card__body"> <h3>Wandern ab der Haustür</h3>',
  ' <div class="stack">  <p>',
  '\nDer Weg ins Fextal beginnt hinter dem Haus, und die Luftseilbahn Furtschellas ist fünf Minuten entf',
  'ernt. Im\n          Winter führt die Loipe am Hotel vorbei.\n</p>',
  '  </div> </div> </article> <article class="feature-card"> <div class="feature-card__body"> <h3>',
  'Zeit für sich</h3> <div class="stack">  <p>',
  '\nEine kleine Sauna mit Blick in den Wald, eine Bibliothek mit Cheminée und ein Garten mit Liegestühl',
  'en. Auch\n          Ihr Hund ist bei uns willkommen.\n</p>',
  '  </div> </div> </article> </div>  </div> </section> <section class="text-section">',
  ' <div class="center stack">  <h2>Was Gäste sagen</h2> <figure class="guest-quote">',
  ' <blockquote lang="en">  <p>',
  '\n“We came for three nights and stayed for eight. The silence, the larches turning gold, and the best',
  ' barley soup\n        we have ever had: we will be back.”\n</p>',
  '  </blockquote> <figcaption>Margaret und Alan H. aus Edinburgh, im Oktober zu Gast</figcaption>',
  ' </figure>  </div> </section> <section class="text-section"> <div class="center stack">  <h2>',
  'Anreise und Kontakt</h2> <p>',
  '\nSils erreichen Sie mit der Rhätischen Bahn bis St. Moritz und von dort mit dem Bus in zwanzig Minut',
  'en. Die\n      Haltestelle «Sils/Segl Maria, Posta» liegt fünf Gehminuten vom Hotel. Auf Wunsch holen',
  ' wir Sie und Ihr Gepäck dort\n      ab.\n</p>',
  ' <address> Hotel Lärchenwald<br> Via da Fex 7<br> 7514 Sils im Engadin/Segl<br>',
  ' Telefon: <a href="tel:+41815550110">+41 81 555 01 10</a><br>',
  ' E-Mail: <a href="mailto:info@laerchenwald.example">info@laerchenwald.example</a> </address> <dl>',
  '  <dt>Rezeption</dt> <dd> Täglich, 07:00–22:00 Uhr </dd>   <dt>Betriebsferien</dt> <dd>',
  '5. April – 3. Juni 2027</dd>  </dl>  </div> </section>  </main> <footer class="site-footer">',
  ' <div class="site-footer__inner center stack"> <div class="grid"> <div class="stack">',
  ' <p class="site-footer__title">Hotel Lärchenwald</p> <address> Via da Fex 7<br>',
  ' 7514 Sils im Engadin/Segl </address> <p> Telefon: <a href="tel:+41815550110">+41 81 555 01 10</a>',
  '<br> E-Mail: <a href="mailto:info@laerchenwald.example">info@laerchenwald.example</a> </p> </div>',
  ' <div class="stack"> <p class="site-footer__title">Rezeption</p> <p> Täglich, 07:00–22:00 Uhr </p>',
  ' <p> Betriebsferien: 5. April – 3. Juni 2027 </p> </div> <nav aria-label="Rechtliches">',
  ' <ul class="site-footer__links"> <li><a class="site-footer__link" href="/impressum/">Impressum</a>',
  '</li> <li><a class="site-footer__link" href="/datenschutz/">Datenschutz</a></li> </ul> </nav> </div>',
  ' <p class="site-footer__copyright">© 2026 Hotel Lärchenwald AG</p> </div> </footer> </body> </html>',
].join('');
const REAL_404_HEAD = [
  '<!DOCTYPE html><html lang="de-CH"> <head><meta charset="utf-8">',
  '<meta name="viewport" content="width=device-width, initial-scale=1"><title>',
  'Diese Seite gibt es nicht · Cette page n’existe pas · This page does not exist</title>',
  '<meta name="description" content="Vielleicht ist die Adresse falsch geschrieben, oder wir haben die ',
  'Seite verschoben. Auf der Startseite finden Sie alles Wichtige über unser Haus.">',
  '<meta name="robots" content="noindex"><link rel="icon" href="/favicon.ico" sizes="32x32">',
  '<link rel="icon" href="/icon.svg" type="image/svg+xml">',
  '<link rel="apple-touch-icon" href="/apple-touch-icon.png"><script type="application/ld+json">',
  '{"@context":"https://schema.org","@graph":[{"@type":"Hotel","@id":"https://laerchenwald.example/#org',
  'anization","name":"Hotel Lärchenwald","legalName":"Hotel Lärchenwald AG","url":"https://laerchenwald',
  '.example/","email":"info@laerchenwald.example","telephone":"+41815550110","vatID":"CHE-123.456.789 M',
  'WST","taxID":"CHE-123.456.789","address":{"@type":"PostalAddress","streetAddress":"Via da Fex 7","po',
  'stalCode":"7514","addressLocality":"Sils im Engadin/Segl","addressRegion":"GR","addressCountry":"CH"',
  '},"openingHoursSpecification":[{"@type":"OpeningHoursSpecification","dayOfWeek":["Monday","Tuesday",',
  '"Wednesday","Thursday","Friday","Saturday","Sunday"],"opens":"07:00","closes":"22:00"}],"specialOpen',
  'ingHoursSpecification":[{"@type":"OpeningHoursSpecification","validFrom":"2027-04-05","validThrough"',
  ':"2027-06-03","opens":"00:00","closes":"00:00"}]}]}</script>',
].join('');
const REAL_404_BODY = [
  '</head> <body> <a class="skip-link visually-hidden" href="#content">Zum Inhalt springen</a>',
  ' <header class="site-header"> <div class="site-header__inner center">',
  ' <a class="site-header__brand" href="/">',
  ' <svg class="site-header__mark" viewBox="0 0 32 32" width="32" height="32" aria-hidden="true">',
  ' <path d="M16 2l5.5 9H19l5 7.5h-3l5.5 8h-9V30h-3v-3.5h-9l5.5-8H8l5-7.5h-2.5z"></path> </svg>',
  ' Hotel Lärchenwald </a> <div class="site-header__tools"> <nav aria-label="Sprache">',
  ' <ul class="site-header__languages"> <li>',
  ' <a class="site-header__language" href="/" lang="de-CH" hreflang="de-CH">',
  ' DE <span class="visually-hidden">– Deutsch</span> </a> </li><li>',
  ' <a class="site-header__language" href="/fr/" lang="fr-CH" hreflang="fr-CH">',
  ' FR <span class="visually-hidden">– Français</span> </a> </li><li>',
  ' <a class="site-header__language" href="/en/" lang="en" hreflang="en">',
  ' EN <span class="visually-hidden">– English</span> </a> </li> </ul> </nav>',
  ' <details class="mode-switch" data-mode-switch> <summary>Darstellung</summary>',
  ' <fieldset class="mode-switch__panel"> <legend class="visually-hidden">Darstellung wählen</legend>',
  ' <label> <input type="radio" name="mode" value="auto"> Automatisch </label><label>',
  ' <input type="radio" name="mode" value="light"> Hell </label><label>',
  ' <input type="radio" name="mode" value="dark"> Dunkel </label><label>',
  ' <input type="radio" name="mode" value="contrast"> Mehr Kontrast </label> </fieldset> </details>',
  ' </div> </div> </header> <main id="content">  <section class="text-section">',
  ' <div class="center stack">  <h1>Diese Seite gibt es nicht</h1> <p class="lede">',
  'Vielleicht ist die Adresse falsch geschrieben, oder wir haben die Seite verschoben. Auf der Startsei',
  'te finden Sie alles Wichtige über unser Haus.</p>',
  ' <p><a class="button" href="/">Zur Startseite</a></p>  </div> </section>',
  ' <section class="text-section" lang="fr-CH"> <div class="center stack">  <h2>',
  'Cette page n’existe pas</h2> <p class="lede">',
  'L’adresse est peut-être mal écrite, ou nous avons déplacé la page. La page d’accueil vous présente l',
  '’essentiel sur notre maison.</p>',
  ' <p> <a class="button" href="/fr/" hreflang="fr-CH"> Vers la page d’accueil </a> </p>  </div>',
  ' </section><section class="text-section" lang="en"> <div class="center stack">  <h2>',
  'This page does not exist</h2> <p class="lede">',
  'The address may be misspelled, or we have moved the page. The home page tells you all that matters a',
  'bout our hotel.</p>',
  ' <p> <a class="button" href="/en/" hreflang="en"> To the home page </a> </p>  </div> </section>',
  ' </main> <footer class="site-footer"> <div class="site-footer__inner center stack">',
  ' <div class="grid"> <div class="stack"> <p class="site-footer__title">Hotel Lärchenwald</p>',
  ' <address> Via da Fex 7<br> 7514 Sils im Engadin/Segl </address> <p>',
  ' Telefon: <a href="tel:+41815550110">+41 81 555 01 10</a><br>',
  ' E-Mail: <a href="mailto:info@laerchenwald.example">info@laerchenwald.example</a> </p> </div>',
  ' <div class="stack"> <p class="site-footer__title">Rezeption</p> <p> Täglich, 07:00–22:00 Uhr </p>',
  ' <p> Betriebsferien: 5. April – 3. Juni 2027 </p> </div> <nav aria-label="Rechtliches">',
  ' <ul class="site-footer__links"> <li><a class="site-footer__link" href="/impressum/">Impressum</a>',
  '</li> <li><a class="site-footer__link" href="/datenschutz/">Datenschutz</a></li> </ul> </nav> </div>',
  ' <p class="site-footer__copyright">© 2026 Hotel Lärchenwald AG</p> </div> </footer> </body> </html>',
].join('');

const realPage = (head: string, body: string): string =>
  `${head}${REAL_CSP_META}${modeInsert(FOUR_MODES)}${speculationInsert(FOUR_MODES)}<style>${PAGE_CSS}</style>${body}`;

// Cases

test('html-validate: the config is the one of section 8, exactly', () => {
  assert.deepEqual(HTML_VALIDATE_CONFIG, SPEC_CONFIG);
});

test('html-validate: the real home page and 404 page of the test site pass, with the kit inserts', async () => {
  const files = {
    ...ICON_FILES,
    'index.html': realPage(REAL_HOME_HEAD, REAL_HOME_BODY),
    '404.html': realPage(REAL_404_HEAD, REAL_404_BODY),
  };
  assert.deepEqual(await oracleMessages(files['index.html']), []);
  assert.deepEqual(ids(await runFiles(files, FOUR_MODES)), []);
});

test('html-validate: the fixture sites pass', async () => {
  assert.deepEqual(ids(await runFiles(site(OPTIONS))), []);
  assert.deepEqual(ids(await runFiles(site(SWITCH_OPTIONS), SWITCH_OPTIONS)), []);
});

test('html-validate: a duplicate id fails with one finding at the page', async () => {
  const report = await run(home('<p id="content">x</p>'));
  assert.deepEqual(ids(report), ['html-validate']);
  assert.match(findings(report)[0] ?? '', /^html-validate \/ no-dup-id: Duplicate ID "content" \(1:\d+\)$/);
});

test('html-validate: a div inside a p fails: one finding for each message of html-validate', async () => {
  const html = home('<p>Text <div>Block</div></p>');
  const report = await run(html);
  assert.deepEqual(ids(report), ['html-validate']);
  const expected = await oracleMessages(html);
  assert.ok(expected.length >= 2);
  assert.deepEqual(placesOf(report), expected);
});

test('html-validate: the findings equal the messages of the oracle on broken pages', async () => {
  for (const main of [
    '<h2></h2>',
    '<p><a href="/x/"></a></p>',
    '<iframe src="/x/"></iframe>',
    '<div role="button">x</div>',
    '<nav></nav><nav></nav>',
    '<label for="nothing">x</label>',
    '<script src="https://cdn.example/a.js"></script>',
    '<ul><p>x</p></ul>',
  ]) {
    const html = home(main);
    const expected = await oracleMessages(html);
    assert.ok(expected.length > 0, main);
    assert.deepEqual(placesOf(await run(html)), expected, main);
  }
});

test('html-validate: an inline directive in a page does not switch a rule off', async () => {
  const html = home('<!-- [html-validate-disable-next no-dup-id] --><p id="content">x</p>');
  assert.deepEqual(await oracleMessages(html), []);
  assert.deepEqual(ids(await run(html)), ['html-validate']);
  const block = home('<!--[html-validate-disable no-dup-id]--><p id="content">x</p>');
  assert.deepEqual(ids(await run(block)), ['html-validate']);
});

test('withoutDirectives: a directive becomes a plain comment of the same length', () => {
  const html = '<p>a</p><!-- \n [html-validate-disable-next x] --><!--html-validate-enable y--><p>html-validate-x</p>';
  const plain = withoutDirectives(html);
  assert.equal(plain.length, html.length);
  assert.equal(
    plain,
    '<p>a</p><!-- \n [html-validate_disable-next x] --><!--html-validate_enable y--><p>html-validate-x</p>',
  );
});

test('html-validate: a config file of the project is not read', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'astro-kit-'));
  const cwd = process.cwd();
  try {
    writeFileSync(join(folder, '.htmlvalidate.json'), JSON.stringify({ root: true, rules: { 'no-dup-id': 'off' } }));
    process.chdir(folder);
    const ctx = contextOf({ ...ICON_FILES, 'index.html': home('<p id="content">x</p>') });
    await auditHtmlValidate(ctx);
    assert.deepEqual(ids(ctx.report), ['html-validate']);
  } finally {
    process.chdir(cwd);
    rmSync(folder, { recursive: true, force: true });
  }
});

/** Settings with one declared origin `js.pay.example` with `script` and the given `load`. */
const withScriptOrigin = (load: 'page' | 'gesture'): Options =>
  optionsOf({
    ...TWO_LOCALES,
    features: { forms: false, islands: false, scripts: true, wasm: false, workers: false },
    origins: [origin('js.pay.example', ['script'], { load })],
  });

test('html-validate: require-sri passes a script on a host with script and load "page"', async () => {
  const options = withScriptOrigin('page');
  for (const src of ['https://js.pay.example/v3/', '//js.pay.example/a.js', 'https://JS.pay.example/a.js']) {
    assert.deepEqual(ids(await run(home(`<script src="${src}" async></script>`, options), options)), [], src);
  }
});

test('html-validate: require-sri fails any other cross-origin resource without integrity', async () => {
  const onPage = withScriptOrigin('page');
  for (const markup of [
    '<script src="https://evil.example/?https://js.pay.example/" async></script>',
    '<script src="http://js.pay.example/a.js" async></script>',
    '<script src="https://js.pay.example:8443/a.js" async></script>',
    '<script src="https://user@js.pay.example/a.js" async></script>',
  ]) {
    const report = await run(home(markup, onPage), onPage);
    assert.deepEqual(ids(report), ['html-validate'], markup);
    assert.match(findings(report).join('\n'), /require-sri/, markup);
  }
  const sheet = page(onPage, '/', { head: '<link rel="stylesheet" href="https://js.pay.example/a.css">' });
  assert.deepEqual(placesOf(await run(sheet, onPage)), await oracleMessages(sheet));
  assert.deepEqual(ids(await run(sheet, onPage)), ['html-validate']);
  const gesture = withScriptOrigin('gesture');
  const html = home('<script src="https://js.pay.example/a.js" async></script>', gesture);
  assert.deepEqual(placesOf(await run(html, gesture)), await oracleMessages(html));
  assert.deepEqual(ids(await run(html, gesture)), ['html-validate']);
});

test('html-validate: a page that makes html-validate throw gives one finding', async () => {
  const report = await run(home('<p constructor="x">x</p>'));
  assert.deepEqual(findings(report), [
    'html-validate / html-validate stopped on the page: TypeError: list.push is not a function',
  ]);
  assert.deepEqual(ids(await run(home('<p __proto__="x">x</p>'))), ['html-validate']);
});

test('html-validate: a deep, a large and an odd page finish and never throw', async () => {
  const started = performance.now();
  const files = {
    ...ICON_FILES,
    'index.html': home(`${'<div>'.repeat(5000)}x${'</div>'.repeat(5000)}`),
    'big/index.html': page(OPTIONS, '/big/', {
      main: `<h1>Titel der Seite</h1> ${'<p>Lorem ipsum dolor sit amet.</p>'.repeat(30000)}`,
    }),
    'odd/index.html': page(OPTIONS, '/odd/', { main: '<h1>Ti\ud800tel\u0000</h1> <p title="\ud800\u0000">\u0000</p>' }),
    'bytes/index.html': '\u0000\ud800<html \u0000><<<>>>&#xD800;',
  };
  const first = findings(await runFiles(files));
  const second = findings(await runFiles(files));
  assert.deepEqual(first, second);
  assert.ok(performance.now() - started < 60_000);
  assert.deepEqual(
    first.filter((finding) => finding.startsWith('html-validate / ') || finding.startsWith('html-validate /big/ ')),
    [
      'html-validate / the page is not validated: it has 5036 elements and a depth of 5003; html-validate reads at most 5600 elements and a depth of 128',
      'html-validate /big/ the page is not validated: it has 30036 elements and a depth of 7; html-validate reads at most 5600 elements and a depth of 128',
    ],
  );
  assert.ok(first.some((finding) => finding.startsWith('html-validate /bytes/ ')));
});

/** The number of elements of one page at `/`, as the html audit counts them. Throws when there is no page. */
function elementsOf(html: string): number {
  const built = contextOf({ 'index.html': html }).pages[0];
  if (built === undefined) throw new Error('audit-html: no page');
  return sizeOf(built).elements;
}

test('html-validate: a page over 4 × domElements elements or 4 × domDepth deep gives one finding and is not read', async () => {
  // The fixture page puts main at depth 3, so its content starts at depth 4.
  const nest = (depth: number): string => `${'<div>'.repeat(depth)}x${'</div>'.repeat(depth)}`;
  assert.deepEqual(ids(await run(home(nest(125)))), []);
  assert.deepEqual(ids(await run(home(nest(126)))), ['html-validate']);
  const fixed = elementsOf(home(''));
  const many = (count: number): string => '<p>x</p>'.repeat(count - fixed);
  assert.deepEqual(ids(await run(home(many(5600)))), []);
  assert.deepEqual(findings(await run(home(`${many(5601)}<button>x</button>`))), [
    'html-validate / the page is not validated: it has 5602 elements and a depth of 7; html-validate reads at most 5600 elements and a depth of 128',
  ]);
});

test('auditHtml runs html-validate', async () => {
  const ctx = contextOf({ ...ICON_FILES, 'index.html': home('<p id="content">x</p>') });
  await auditHtml(ctx);
  assert.deepEqual(ids(ctx.report), ['html-validate']);
});

// Review cases of part 5b

test('html-validate reads a page that starts with a UTF-8 byte order mark as the file holds it: no-utf8-bom', async () => {
  const html = home('<p>x</p>');
  assert.deepEqual(ids(await run(html)), []);
  const report = await run(`﻿${html}`);
  assert.deepEqual(ids(report), ['html-validate']);
  assert.deepEqual(placesOf(report), ['no-utf8-bom: 1:1']);
});

test('html-validate: with a byte order mark, the require-sri exception still finds its script', async () => {
  const onPage = withScriptOrigin('page');
  const html = home('<script src="https://js.pay.example/a.js" async></script>', onPage);
  assert.deepEqual(placesOf(await run(html, onPage)), []);
  assert.deepEqual(placesOf(await run(`\uFEFF${html}`, onPage)), ['no-utf8-bom: 1:1']);
});

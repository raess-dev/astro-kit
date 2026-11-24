/**
 * The text rules of the site audit (part 5c of M5, `src/audit/text.ts`): `facts-value`, `content-stale`,
 * `content-language`, `content-copied`, `content-glossary` and `content-nfc`. Each sentence of a row, and each item of
 * Measurement details that the row points to, has a passing case and a failing case that changes one thing, on a
 * `BuildContext` built from strings with pages shaped as Astro writes them (14.1). The two hand-written matchers of
 * `facts-value` are compared with the patterns of the specification on random texts.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  auditContentCopied,
  auditContentGlossary,
  auditContentLanguage,
  auditContentNfc,
  auditContentStale,
  auditFactsValue,
  CHF_LAST,
  currencyLastMatches,
  EMAIL,
  emailMatches,
  factsShown,
  type TextMatch,
} from '../../src/audit/text.ts';
import type { BuildContext } from '../../src/context.ts';
import type { Options } from '../../src/options.ts';
import type { Report } from '../../src/registry.ts';
import {
  type ContextSettings,
  contextOf,
  fileOf,
  findings,
  ICON_FILES,
  ids,
  notFoundPage,
  OPTIONS,
  type PageParts,
  page,
  site,
} from './audit-fixtures.ts';
import { optionsOf, SITE, TWO_LOCALES } from './fixtures.ts';

type Rule = (ctx: BuildContext) => void;
type Files = Readonly<Record<string, string | Uint8Array>>;

const RULES: readonly Rule[] = [
  auditFactsValue,
  auditContentStale,
  auditContentLanguage,
  auditContentCopied,
  auditContentGlossary,
  auditContentNfc,
];

/** Runs rules on a context of the files and returns its report. */
function run(rules: Rule | readonly Rule[], files: Files, settings: ContextSettings = {}): Report {
  const ctx = contextOf(files, settings);
  for (const rule of Array.isArray(rules) ? rules : [rules]) rule(ctx);
  return ctx.report;
}

/** The icon files and one fixture page at a path. */
const one = (path: string, parts: PageParts = {}, options: Options = OPTIONS): Files => ({
  ...ICON_FILES,
  [fileOf(path)]: page(options, path, parts),
});

/** A page whose `main` is an `h1` and the markup. */
const withMain = (main: string, path = '/zimmer/', options: Options = OPTIONS): Files =>
  one(path, { main: `<h1>Zimmer und Preise im Haus</h1> ${main}` }, options);

/**
 * The two homes of `site()`, `/` and `/fr/`, as one pair of translations with their own parts; the rest of the
 * fixture site stays.
 */
function pair(de: PageParts, fr: PageParts, options: Options = OPTIONS): Record<string, string> {
  const alternates = { de: '/', fr: '/fr/' };
  return {
    ...site(options),
    'index.html': page(options, '/', { alternates, ...de }),
    'fr/index.html': page(options, '/fr/', { alternates, ...fr }),
  };
}

// facts-value

/** The facts of the facts-value cases: every kind of value, and a contact. */
const FACTS = {
  ...SITE,
  phone: '+41815550110',
  uid: 'CHE-123.456.789',
  iban: 'CH93 0076 2011 6238 5295 7',
  prices: [
    { id: 'room-double', amount: 32000, currency: 'CHF' },
    { id: 'menu', amount: 9800, currency: 'CHF' },
    { id: 'dog', amount: 2500, currency: 'CHF' },
    { id: 'big', amount: 120000, currency: 'CHF' },
    { id: 'euro', amount: 4000, currency: 'EUR' },
  ],
  contacts: [{ name: 'Jobs', email: 'jobs@example.ch', phone: '+41815550130' }],
};

const facts = (files: Files, values: unknown = FACTS): Report => run(auditFactsValue, files, { site: values });

test('facts-value passes the fixture site, and a page that shows each kind of value of site.json', () => {
  assert.deepEqual(ids(run(auditFactsValue, site())), []);
  const main = [
    '<p>E-Mail: <a href="mailto:info@example.ch">info@example.ch</a></p>',
    '<p>Telefon: <a href="tel:+41815550110">+41 81 555 01 10</a></p>',
    '<p>UID CHE-123.456.789, IBAN CH93 0076 2011 6238 5295 7</p>',
    '<p>Doppelzimmer ab CHF 320.00, Menü 98.00 CHF</p>',
  ].join(' ');
  assert.deepEqual(ids(facts(withMain(main))), []);
});

test('facts-value fails each kind of value that site.json does not hold, at the page path, with the value', () => {
  const cases: [string, string][] = [
    ['info@example.com', 'facts-value /zimmer/ email info@example.com is not in site.json (email, contacts)'],
    ['+41 81 555 01 11', 'facts-value /zimmer/ phone +41815550111 is not in site.json (phone, contacts)'],
    ['CHE-123.456.780', 'facts-value /zimmer/ UID CHE-123.456.780 is not in site.json (uid, vatId)'],
    ['CH93 0076 2011 6238 5295 8', 'facts-value /zimmer/ IBAN CH9300762011623852958 is not in site.json (iban)'],
    ['CHF 330.00', 'facts-value /zimmer/ CHF 330.00 is not in site.json (prices)'],
  ];
  for (const [value, expected] of cases) {
    const report = facts(withMain(`<p>Gültig: ${value}</p>`));
    assert.deepEqual(ids(report), ['facts-value'], value);
    assert.deepEqual(findings(report), [expected], value);
  }
});

test('facts-value finds the emails and phone numbers of contacts', () => {
  assert.deepEqual(ids(facts(withMain('<p>Jobs: jobs@example.ch, +41 81 555 01 30</p>'))), []);
  const noContacts = { ...FACTS, contacts: [] };
  const report = facts(withMain('<p>Jobs: jobs@example.ch, +41 81 555 01 30</p>'), noContacts);
  assert.deepEqual(findings(report), [
    'facts-value /zimmer/ email jobs@example.ch is not in site.json (email, contacts)',
    'facts-value /zimmer/ phone +41815550130 is not in site.json (phone, contacts)',
  ]);
});

test('facts-value compares emails in lower case', () => {
  assert.deepEqual(ids(facts(withMain('<p>Info@Example.CH</p>'))), []);
  assert.deepEqual(ids(facts(withMain('<p>Info@Example.CO</p>'))), ['facts-value']);
});

test('facts-value normalizes Swiss phones written +41, 0041 or 0 to E.164', () => {
  for (const shown of ['+41 81 555 01 10', '0041 81 555 01 10', '081 555 01 10', '081/555.01.10', '0815550110']) {
    assert.deepEqual(ids(facts(withMain(`<p>Telefon ${shown}</p>`))), [], shown);
  }
  for (const shown of ['+41 81 555 01 19', '0041 81 555 01 19', '081 555 01 19']) {
    const report = facts(withMain(`<p>Telefon ${shown}</p>`));
    assert.deepEqual(findings(report), [
      'facts-value /zimmer/ phone +41815550119 is not in site.json (phone, contacts)',
    ]);
  }
});

test('facts-value drops a (0) right after the country code, and nowhere else', () => {
  for (const shown of ['+41 (0)81 555 01 10', '0041 (0)81 555 01 10', '+41(0)815550110', '+41 (0) 81 555 01 10']) {
    assert.deepEqual(ids(facts(withMain(`<p>Telefon ${shown}</p>`))), [], shown);
  }
  // A tel: link reads the same way. site.json holds E.164 only (its schema), so it never has a (0).
  assert.deepEqual(ids(facts(withMain('<p><a href="tel:+41(0)815550110">Anrufen</a></p>'))), []);
  const cases: [string, string][] = [
    ['+41 (0)81 555 01 11', 'facts-value /zimmer/ phone +41815550111 is not in site.json (phone, contacts)'],
    ['+41 81 (0)555 01 10', 'facts-value /zimmer/ phone +418105550110 is not in site.json (phone, contacts)'],
  ];
  for (const [shown, expected] of cases) {
    assert.deepEqual(findings(facts(withMain(`<p>Telefon ${shown}</p>`))), [expected], shown);
  }
});

test('facts-value finds a foreign number written with +, and no other national form', () => {
  assert.deepEqual(ids(facts(withMain('<p>Berlin: +49 30 1234 5678</p>'))), ['facts-value']);
  assert.deepEqual(ids(facts(withMain('<p>Berlin: (030) 12345678</p>'))), []);
});

test('facts-value counts a number that both phone patterns find once', () => {
  // `0041 81 555 01 19` holds a national form at no place, `+41 081 555 01 19` holds `081 555 01 19`.
  const report = facts(withMain('<p>Telefon +41 081 555 01 19</p>'));
  assert.deepEqual(findings(report), [
    'facts-value /zimmer/ phone +410815550119 is not in site.json (phone, contacts)',
  ]);
});

test('facts-value compares CHF in minor units against the CHF prices', () => {
  const shown = [
    'CHF 320.00',
    'CHF 320',
    'CHF320.–',
    'Fr. 320.-',
    'SFr. 320,00',
    '320.00 CHF',
    '320.– Fr.',
    '320 Fr.',
    'CHF 1’200.00',
    "CHF 1'200",
    'CHF 1 200.–',
    '1 200 CHF',
    'CHF 25',
  ];
  for (const text of shown) assert.deepEqual(ids(facts(withMain(`<p>Preis ${text}</p>`))), [], text);
  for (const text of ['CHF 320.50', '320.05 CHF', 'Fr. 32', 'CHF 3200', 'CHF 12 000']) {
    assert.deepEqual(ids(facts(withMain(`<p>Preis ${text}</p>`))), ['facts-value'], text);
  }
});

test('facts-value checks no other currency, and no CHF price of another currency in site.json', () => {
  assert.deepEqual(ids(facts(withMain('<p>EUR 330.00, € 12.50, USD 7</p>'))), []);
  // The price `euro` is 4000 in EUR: CHF 40.00 is no value.
  assert.deepEqual(findings(facts(withMain('<p>CHF 40.00</p>'))), [
    'facts-value /zimmer/ CHF 40.00 is not in site.json (prices)',
  ]);
});

test('facts-value counts an amount that both CHF patterns find once', () => {
  assert.deepEqual(ids(facts(withMain('<p>CHF 320.– Fr.</p>'))), []);
  assert.deepEqual(findings(facts(withMain('<p>CHF 180.– Fr.</p>'))), [
    'facts-value /zimmer/ CHF 180.00 is not in site.json (prices)',
  ]);
});

test('facts-value reads the UID inside vatId, and every IBAN with its spaces removed on both sides', () => {
  const vat = { ...FACTS, uid: undefined, vatId: 'CHE-123.456.789 MWST' };
  assert.deepEqual(ids(facts(withMain('<p>UID CHE123456789 MWST</p>'), vat)), []);
  assert.deepEqual(ids(facts(withMain('<p>UID CHE-123.456.789</p>'), { ...FACTS, uid: undefined })), ['facts-value']);
  assert.deepEqual(ids(facts(withMain('<p>IBAN CH9300762011623852957</p>'))), []);
});

test('facts-value checks mailto: and tel: hrefs too', () => {
  const good =
    '<p><a href="mailto:INFO@example.ch?subject=Anfrage">Schreiben</a> <a href="tel:081-555-01-10">Anrufen</a></p>';
  assert.deepEqual(ids(facts(withMain(good))), []);
  assert.deepEqual(ids(facts(withMain('<p><a href="mailto:info%40example.ch">Schreiben</a></p>'))), []);
  const report = facts(
    withMain(
      '<p><a href="tel:+41815550111">+41 81 555 01 10</a> <a href="mailto:info@example.com">info@example.ch</a></p>',
    ),
  );
  assert.deepEqual(findings(report), [
    'facts-value /zimmer/ email info@example.com (a mailto: link) is not in site.json (email, contacts)',
    'facts-value /zimmer/ phone +41815550111 (a tel: link) is not in site.json (phone, contacts)',
  ]);
});

test('facts-value turns every Unicode space separator into a space before it joins white space', () => {
  // A no-break space beside a space: in the other order the amount pattern would not match.
  for (const text of [
    'CHF\u00a0320.00',
    'CHF \u00a0320.00',
    '+41\u202f81\u00a0555\u200901\u00a010',
    '320.00\u202fCHF',
  ]) {
    assert.deepEqual(ids(facts(withMain(`<p>${text}</p>`))), [], JSON.stringify(text));
  }
  assert.deepEqual(ids(facts(withMain('<p>CHF \u00a0330.00</p>'))), ['facts-value']);
});

test('facts-value reports a wrong value once per page, however often the page shows it', () => {
  const main =
    '<p>Ruf an: +41 81 555 01 11</p> <p>Oder: 081 555 01 11</p> <p><a href="tel:+41815550111">Anrufen</a></p>';
  assert.deepEqual(findings(facts(withMain(main))), [
    'facts-value /zimmer/ phone +41815550111 is not in site.json (phone, contacts)',
  ]);
});

test('facts-value reads the page text as one text: a number right after a phone number joins it', () => {
  // The page text joins the two paragraphs with one space, and the phone pattern takes up to 22 characters.
  const report = facts(withMain('<p>+41 81 555 01 10</p> <p>24 Zimmer</p>'));
  assert.deepEqual(findings(report), [
    'facts-value /zimmer/ phone +4181555011024 is not in site.json (phone, contacts)',
  ]);
});

test('facts-value reads only the page text: JSON-LD in the head is head-jsonld’s', () => {
  const jsonld = '<script type="application/ld+json">{"@type":"Organization","telephone":"+41 81 555 01 11"}</script>';
  assert.deepEqual(ids(facts(one('/zimmer/', { jsonld }))), []);
});

test('facts-value finds no phone in the digits of an IBAN or a UID', () => {
  assert.deepEqual(ids(facts(withMain('<p>IBAN CH93 0076 2011 6238 5295 7, UID CHE-123.456.789</p>'))), []);
});

test('factsShown holds the values of site.json that a page shows, and not a wrong one', () => {
  const ctx = contextOf(withMain('<p>info@example.ch, +41 81 555 01 11, CHF 320.00, CHF 330.00</p>'), {
    site: FACTS,
  });
  const shown = ctx.pages.find((built) => built.path === '/zimmer/');
  assert.ok(shown !== undefined);
  assert.deepEqual([...factsShown(ctx, shown)].sort(), ['CHF 320.00', 'email info@example.ch']);
});

/** A small random generator with a seed, so that each run tests the same texts. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

/** A random text of pieces. */
function textOf(next: () => number, pieces: readonly string[], length: number): string {
  let out = '';
  const count = Math.floor(next() * length);
  for (let index = 0; index < count; index += 1) out += pieces[Math.floor(next() * pieces.length)] ?? '';
  return out;
}

/** The matches of a pattern with `matchAll`, in the shape of `TextMatch`. */
function oracle(pattern: RegExp, text: string, groups: boolean): TextMatch[] {
  return [...text.matchAll(pattern)].map((match) => ({
    start: match.index,
    end: match.index + match[0].length,
    ...(groups && match[1] !== undefined ? { amount: match[1] } : {}),
    ...(groups && match[2] !== undefined ? { decimals: match[2] } : {}),
  }));
}

test('emailMatches finds exactly the matches of the email pattern of the specification', () => {
  const next = random(7);
  const pieces = ['a', 'Z', '9', '.', '_', '%', '+', '-', '@', ' ', '!', 'ä', '.ch', 'x@y.z'];
  for (let index = 0; index < 4000; index += 1) {
    const text = textOf(next, pieces, 24);
    assert.deepEqual(emailMatches(text), oracle(EMAIL, text, false), JSON.stringify(text));
  }
});

test('currencyLastMatches finds exactly the matches of the CHF pattern with the currency last', () => {
  const next = random(11);
  const pieces = ['1', '2', '0', '000', ' ', "'", '’', '.', ',', '–', '-', 'CHF', 'Fr.', 'S', 'F', 'r', 'x', '.00'];
  for (let index = 0; index < 6000; index += 1) {
    const text = textOf(next, pieces, 20);
    assert.deepEqual(currencyLastMatches(text), oracle(CHF_LAST, text, true), JSON.stringify(text));
  }
});

test('the two matchers stay linear where the patterns take seconds', () => {
  const letters = `${'a'.repeat(1_000_000)}@@ ${'a.'.repeat(500_000)}@`;
  const digits = `${'1'.repeat(1_000_000)}.5 CHF ${"1'".repeat(500_000)} Fr.`;
  const started = performance.now();
  assert.deepEqual(emailMatches(letters), []);
  assert.deepEqual(currencyLastMatches(digits).length, 1);
  assert.ok(performance.now() - started < 2000);
});

// content-stale

/** A main with `h2` sections and more markup. */
const sections = (count: number, more = ''): string =>
  `<h1>Unser Haus im Tal</h1> ${Array.from({ length: count }, (_, index) => `<h2>Teil ${index + 1}</h2>`).join(' ')} ${more}`;

test('content-stale passes the fixture site, and a translation with the same sections, facts and links', () => {
  assert.deepEqual(ids(run(auditContentStale, site())), []);
  const files = pair(
    { main: sections(2, '<p>+41 81 555 01 10 <a href="/impressum/">Impressum</a></p>') },
    { main: sections(2, '<p>+41 81 555 01 10 <a href="/fr/mentions-legales/">Mentions</a></p>') },
  );
  assert.deepEqual(ids(run(auditContentStale, files, { site: FACTS })), []);
});

test('content-stale fails a translation with another number of h2 elements, at the translation', () => {
  const report = run(auditContentStale, pair({ main: sections(3) }, { main: sections(2) }));
  assert.deepEqual(findings(report), ['content-stale /fr/ 2 h2, / has 3']);
});

test('content-stale fails a translation that shows other site.json facts', () => {
  const files = pair(
    { main: sections(1, '<p>+41 81 555 01 10, CHF 320.00</p>') },
    { main: sections(1, '<p>CHF 320.00, info@example.ch</p>') },
  );
  assert.deepEqual(findings(run(auditContentStale, files, { site: FACTS })), [
    'content-stale /fr/ facts missing: phone +41815550110; facts extra: email info@example.ch',
  ]);
});

test('content-stale compares only the facts that equal site.json: a wrong value is facts-value’s', () => {
  const files = pair({ main: sections(1, '<p>CHF 330.00</p>') }, { main: sections(1, '<p>CHF 340.00</p>') });
  const report = run([auditFactsValue, auditContentStale], files, { site: FACTS });
  assert.deepEqual(findings(report), [
    'facts-value / CHF 330.00 is not in site.json (prices)',
    'facts-value /fr/ CHF 340.00 is not in site.json (prices)',
  ]);
});

test('content-stale fails a translation with other internal link targets, mapped into the default locale', () => {
  const rooms = { de: '/zimmer/', fr: '/fr/chambres/' };
  const files = {
    ...pair(
      { main: sections(1, '<p><a href="/zimmer/">Zimmer</a></p>') },
      { main: sections(1, '<p><a href="/fr/">Accueil</a></p>') },
    ),
    'zimmer/index.html': page(OPTIONS, '/zimmer/', { alternates: rooms }),
    'fr/chambres/index.html': page(OPTIONS, '/fr/chambres/', { alternates: rooms }),
  };
  assert.deepEqual(findings(run(auditContentStale, files)), ['content-stale /fr/ links missing: /zimmer/']);
  const swapped = {
    ...files,
    'index.html': page(OPTIONS, '/', { alternates: { de: '/', fr: '/fr/' }, main: sections(1) }),
    'fr/index.html': page(OPTIONS, '/fr/', {
      alternates: { de: '/', fr: '/fr/' },
      main: sections(1, '<p><a href="/fr/chambres/">Chambres</a></p>'),
    }),
  };
  assert.deepEqual(findings(run(auditContentStale, swapped)), ['content-stale /fr/ links extra: /zimmer/']);
});

test('content-stale maps a link to a page of either locale to its default-locale page', () => {
  // The de page links the fr legal note, the fr page links the de one: both map to /impressum/.
  const files = pair(
    { main: sections(1, '<p><a href="/fr/mentions-legales/">Mentions légales</a></p>') },
    { main: sections(1, '<p><a href="/impressum/">Impressum</a></p>') },
  );
  assert.deepEqual(ids(run(auditContentStale, files)), []);
});

test('content-stale leaves out a target without a default-locale page, and one without a page in the translation’s locale', () => {
  const files = {
    ...pair(
      { main: sections(1, '<p><a href="/nur-deutsch/">Nur Deutsch</a></p>') },
      { main: sections(1, '<p><a href="/fr/seulement/">Seulement</a></p>') },
    ),
    'nur-deutsch/index.html': page(OPTIONS, '/nur-deutsch/'),
    'fr/seulement/index.html': page(OPTIONS, '/fr/seulement/'),
  };
  assert.deepEqual(ids(run(auditContentStale, files)), []);
  // With a fr alternate, /nur-deutsch/ is a target in both locales, and the fr page lacks it.
  const both = {
    ...files,
    'nur-deutsch/index.html': page(OPTIONS, '/nur-deutsch/', {
      alternates: { de: '/nur-deutsch/', fr: '/fr/seulement/' },
    }),
    'fr/seulement/index.html': page(OPTIONS, '/fr/seulement/', {
      alternates: { de: '/nur-deutsch/', fr: '/fr/seulement/' },
    }),
  };
  assert.deepEqual(ids(run(auditContentStale, both)), []);
  const lacking = {
    ...both,
    'fr/index.html': page(OPTIONS, '/fr/', { alternates: { de: '/', fr: '/fr/' }, main: sections(1) }),
  };
  assert.deepEqual(findings(run(auditContentStale, lacking)), ['content-stale /fr/ links missing: /nur-deutsch/']);
});

test('content-stale skips a translation without a built default-locale alternate: routes-translation’s', () => {
  const files = { ...site(), 'fr/seul/index.html': page(OPTIONS, '/fr/seul/', { main: sections(4) }) };
  assert.deepEqual(ids(run(auditContentStale, files)), []);
  const unbuilt = {
    ...site(),
    'fr/seul/index.html': page(OPTIONS, '/fr/seul/', { alternates: { de: '/allein/', fr: '/fr/seul/' } }),
  };
  assert.deepEqual(ids(run(auditContentStale, unbuilt)), []);
});

// content-language

const ENGLISH = 'We come back every winter for the quiet rooms and the long walks in the valley.';
const GERMAN = 'Wir kommen jeden Winter wieder, für die ruhigen Zimmer und die langen Wege im Tal.';

test('content-language passes the fixture site, and a German leaf on a German page', () => {
  assert.deepEqual(ids(run(auditContentLanguage, site())), []);
  assert.deepEqual(ids(run(auditContentLanguage, withMain(`<p>${GERMAN}</p>`))), []);
});

test('content-language fails a leaf in another language, at the page path, with its text', () => {
  const report = run(auditContentLanguage, withMain(`<p>${ENGLISH}</p>`));
  assert.deepEqual(findings(report), [`content-language /zimmer/ 7 en stopwords and 0 de: "${ENGLISH}"`]);
});

test('content-language looks at each leaf p, li, td and blockquote, and at nothing else', () => {
  for (const markup of [
    `<ul><li>${ENGLISH}</li></ul>`,
    `<table><tr><td>${ENGLISH}</td></tr></table>`,
    `<blockquote>${ENGLISH}</blockquote>`,
    `<blockquote><p>${ENGLISH}</p></blockquote>`,
  ]) {
    assert.deepEqual(findings(run(auditContentLanguage, withMain(markup))).length, 1, markup);
  }
  for (const markup of [`<div>${ENGLISH}</div>`, `<ul><li>${ENGLISH} <p>${GERMAN}</p></li></ul>`]) {
    assert.deepEqual(ids(run(auditContentLanguage, withMain(markup))), [], markup);
  }
});

test('content-language skips a leaf whose nearest lang is another one: its own or an ancestor’s', () => {
  assert.deepEqual(ids(run(auditContentLanguage, withMain(`<p lang="en">${ENGLISH}</p>`))), []);
  assert.deepEqual(
    ids(run(auditContentLanguage, withMain(`<blockquote lang="en"><p>${ENGLISH}</p></blockquote>`))),
    [],
  );
  // `de-ch` is the tag `de-CH`: the leaf is in the page language.
  assert.deepEqual(ids(run(auditContentLanguage, withMain(`<p lang="de-ch">${ENGLISH}</p>`))), ['content-language']);
});

test('content-language counts only the text that is not inside a descendant with another lang', () => {
  const quoted = `<p>Ein Gast schreibt: <q lang="en">${ENGLISH}</q></p>`;
  assert.deepEqual(ids(run(auditContentLanguage, withMain(quoted))), []);
  const unmarked = `<p>Ein Gast schreibt: <q>${ENGLISH}</q></p>`;
  assert.deepEqual(ids(run(auditContentLanguage, withMain(unmarked))), ['content-language']);
});

test('content-language looks only at a text of 12 words or more', () => {
  const eleven = 'We come back every winter for the quiet rooms and walks.';
  assert.deepEqual(ids(run(auditContentLanguage, withMain(`<p>${eleven}</p>`))), []);
  assert.deepEqual(ids(run(auditContentLanguage, withMain(`<p>${eleven} Today</p>`))), ['content-language']);
});

test('content-language fails only with 3 stopwords of another language or more', () => {
  const two =
    'Lovely quiet rooms, friendly staff, great breakfast, wonderful views, calm nights, the lake and mountains.';
  assert.deepEqual(ids(run(auditContentLanguage, withMain(`<p>${two}</p>`))), []);
  assert.deepEqual(ids(run(auditContentLanguage, withMain(`<p>${two.replace('.', ' with snow.')}</p>`))), [
    'content-language',
  ]);
});

test('content-language fails only with more than twice the stopwords of the page language', () => {
  const twice = 'Der Weg und Wald: we walk to the lake and hills every early morning.';
  assert.deepEqual(ids(run(auditContentLanguage, withMain(`<p>${twice}</p>`))), []);
  const more = 'Der Weg und Wald: we walk to the lake and the hills every morning.';
  assert.deepEqual(findings(run(auditContentLanguage, withMain(`<p>${more}</p>`))), [
    `content-language /zimmer/ 5 en stopwords and 2 de: "${more}"`,
  ]);
});

test('content-language reads the page language from html lang and skips a language without a list', () => {
  assert.deepEqual(ids(run(auditContentLanguage, one('/zimmer/', { lang: 'en', main: `<p>${GERMAN}</p>` }))), [
    'content-language',
  ]);
  assert.deepEqual(ids(run(auditContentLanguage, one('/zimmer/', { lang: 'rm-CH', main: `<p>${ENGLISH}</p>` }))), []);
  assert.deepEqual(
    ids(run(auditContentLanguage, { 'a/index.html': `<html><body><p>${ENGLISH}</p></body></html>` })),
    [],
  );
});

test('content-language finds French and Italian too, with words that hold an apostrophe', () => {
  const french = 'Nous venons chaque hiver pour le calme, la cuisine et les longues promenades dans la vallée.';
  assert.deepEqual(ids(run(auditContentLanguage, withMain(`<p>${french}</p>`))), ['content-language']);
  const italian = 'Veniamo ogni inverno per la quiete, la cucina e le lunghe passeggiate nella valle con gli amici.';
  assert.deepEqual(ids(run(auditContentLanguage, withMain(`<p>${italian}</p>`))), ['content-language']);
  assert.deepEqual(
    ids(run(auditContentLanguage, one('/fr/chambres/', { main: `<p>${french} L’hôtel d’été.</p>` }))),
    [],
  );
});

test('content-language reports two leaves with the same text once', () => {
  const report = run(auditContentLanguage, withMain(`<p>${ENGLISH}</p> <p>${ENGLISH}</p>`));
  assert.equal(report.findings.length, 1);
});

// content-copied

test('content-copied passes the fixture site, whose translations have their own descriptions', () => {
  assert.deepEqual(ids(run(auditContentCopied, site())), []);
});

test('content-copied fails a translation with the description of its default-locale sibling', () => {
  const description = 'Eine Seite des Beispiels mit einem Text, der in beiden Sprachen gleich geblieben ist.';
  const report = run(auditContentCopied, pair({ description }, { description }));
  assert.deepEqual(findings(report), [`content-copied /fr/ the description of /: "${description}"`]);
});

test('content-copied lets titles and h1s match', () => {
  const title = 'Example – das Haus im Tal';
  assert.deepEqual(ids(run(auditContentCopied, pair({ title }, { title }))), []);
});

test('content-copied compares collapsed descriptions, and skips a page without a sibling', () => {
  const description = 'Eine Seite des Beispiels mit einem Text, der in beiden Sprachen gleich geblieben ist.';
  const spaced = ` ${description.replaceAll(' ', '  ')} `;
  assert.deepEqual(ids(run(auditContentCopied, pair({ description }, { description: spaced }))), ['content-copied']);
  const alone = { ...site(), 'fr/seul/index.html': page(OPTIONS, '/fr/seul/', { description }) };
  assert.deepEqual(
    ids(run(auditContentCopied, { ...alone, 'seul/index.html': page(OPTIONS, '/seul/', { description }) })),
    [],
  );
});

// content-glossary

const GLOSSARY = {
  de: { banned: { Email: 'E-Mail', 'Hotel Laerchenwald': 'Hotel Lärchenwald' } },
  fr: { banned: { courriel: 'e-mail' } },
};

const glossary = (files: Files): Report => run(auditContentGlossary, files, { glossary: GLOSSARY });

test('content-glossary passes the fixture site, and a page with the canonical terms', () => {
  assert.deepEqual(ids(glossary(site())), []);
  assert.deepEqual(ids(glossary(withMain('<p>Schreiben Sie uns eine E-Mail an das Hotel Lärchenwald.</p>'))), []);
});

test('content-glossary fails a banned variant in the body text, at the page path', () => {
  const report = glossary(withMain('<p>Schreiben Sie uns eine Email.</p>'));
  assert.deepEqual(findings(report), [
    'content-glossary /zimmer/ "Email" in the text (glossary.json de: write "E-Mail")',
  ]);
});

test('content-glossary fails a banned variant in the title and in the description', () => {
  const title = one('/zimmer/', { title: 'Email an das Haus im Tal', main: '<h1>Kontakt</h1>' });
  assert.deepEqual(findings(glossary(title)), [
    'content-glossary /zimmer/ "Email" in the title (glossary.json de: write "E-Mail")',
  ]);
  const description = 'Schreiben Sie dem Haus eine Email, wir antworten am selben Tag auf jede Anfrage.';
  const files = one('/zimmer/', { description, main: '<h1>Kontakt</h1>' });
  assert.deepEqual(findings(glossary(files)), [
    'content-glossary /zimmer/ "Email" in the description (glossary.json de: write "E-Mail")',
  ]);
});

test('content-glossary compares case-sensitive substrings in NFC', () => {
  assert.deepEqual(ids(glossary(withMain('<p>Die email-Adresse und die E-Mail.</p>'))), []);
  assert.deepEqual(ids(glossary(withMain('<p>Emails</p>'))), ['content-glossary']);
  const nfd = { de: { banned: { Fru\u0308hstu\u0308cksbu\u0308ffet: 'Frühstücksbuffet' } } };
  assert.deepEqual(ids(run(auditContentGlossary, withMain('<p>Frühstücksbüffet</p>'), { glossary: nfd })), [
    'content-glossary',
  ]);
});

test('content-glossary uses the list of the nearest lang, by tag or code', () => {
  assert.deepEqual(ids(glossary(withMain('<p>Le courriel de la maison.</p>'))), []);
  for (const lang of ['fr', 'fr-CH', 'FR-ch']) {
    assert.deepEqual(ids(glossary(withMain(`<p lang="${lang}">Le courriel de la maison.</p>`))), ['content-glossary']);
    assert.deepEqual(ids(glossary(withMain(`<div lang="${lang}"><p>Le <b>courriel</b>.</p></div>`))), [
      'content-glossary',
    ]);
  }
  assert.deepEqual(ids(glossary(withMain('<p lang="fr">Une Email.</p>'))), []);
});

test('content-glossary skips text under a lang that names no configured locale', () => {
  assert.deepEqual(ids(glossary(withMain('<p lang="en">Send an Email.</p>'))), []);
  assert.deepEqual(ids(glossary(withMain('<p lang="">Email</p>'))), []);
  assert.deepEqual(ids(glossary(one('/zimmer/', { lang: 'en', main: '<h1>Email</h1>' }))), []);
});

test('content-glossary applies ß, „ and “ for the tag de-CH only', () => {
  const report = run(auditContentGlossary, withMain('<p>Die „Straße“ zum Haus.</p>'));
  assert.deepEqual(findings(report), [
    'content-glossary /zimmer/ "ß" in the text (de-CH: write "ss")',
    'content-glossary /zimmer/ "“" in the text (de-CH: write "»")',
    'content-glossary /zimmer/ "„" in the text (de-CH: write "«")',
  ]);
  const german = optionsOf({
    ...TWO_LOCALES,
    locales: [{ code: 'de', tag: 'de-DE', name: 'Deutsch' }, TWO_LOCALES.locales[1]],
  });
  assert.deepEqual(
    ids(run(auditContentGlossary, withMain('<p>Die „Straße“ zum Haus.</p>', '/zimmer/', german), { options: german })),
    [],
  );
  assert.deepEqual(ids(run(auditContentGlossary, withMain('<p lang="fr">La Straße.</p>'))), []);
});

test('content-glossary joins text across inline elements, not across blocks', () => {
  assert.deepEqual(ids(glossary(withMain('<p>Willkommen im Hotel <b>Laerchenwald</b>!</p>'))), ['content-glossary']);
  assert.deepEqual(ids(glossary(withMain('<p>Willkommen im Hotel\n  <a href="/">Laerchenwald</a></p>'))), [
    'content-glossary',
  ]);
  assert.deepEqual(ids(glossary(withMain('<p>Hotel</p><p> Laerchenwald</p>'))), []);
  assert.deepEqual(ids(glossary(withMain('<p>E<br>mail</p>'))), []);
  assert.deepEqual(ids(glossary(withMain('<p>Hotel <span lang="fr">Laerchenwald</span></p>'))), []);
});

test('content-glossary skips the text of script and style', () => {
  const block = '<script type="application/ld+json">{"name":"Email"}</script>';
  assert.deepEqual(ids(glossary(withMain(`<p>Kontakt</p>${block}`))), []);
});

test('content-glossary reports each banned variant once per page', () => {
  const report = glossary(withMain('<p>Email</p> <p>Email</p> <p>Hotel Laerchenwald</p>'));
  assert.deepEqual(findings(report), [
    'content-glossary /zimmer/ "Email" in the text (glossary.json de: write "E-Mail")',
    'content-glossary /zimmer/ "Hotel Laerchenwald" in the text (glossary.json de: write "Hotel Lärchenwald")',
  ]);
});

// content-nfc

test('content-nfc passes the fixture site, 404 included', () => {
  assert.deepEqual(ids(run(auditContentNfc, site())), []);
  assert.deepEqual(ids(run(auditContentNfc, { '404.html': notFoundPage(OPTIONS) })), []);
});

test('content-nfc fails a text node that is not in NFC, with its code points', () => {
  const report = run(auditContentNfc, withMain('<p>Cafe\u0301 am See</p>'));
  assert.deepEqual(findings(report), [
    'content-nfc /zimmer/ the text "Cafe\u0301 am See": U+0065 U+0301 is not in NFC',
  ]);
});

test('content-nfc fails an attribute value that is not in NFC, in the head too', () => {
  const report = run(auditContentNfc, withMain('<p><img src="/_astro/a.webp" alt="Cafe\u0301"></p>'));
  assert.deepEqual(findings(report), [
    'content-nfc /zimmer/ the attribute alt "Cafe\u0301": U+0065 U+0301 is not in NFC',
  ]);
  const head = run(auditContentNfc, one('/zimmer/', { head: '<meta name="author" content="A\u030angström">' }));
  assert.deepEqual(ids(head), ['content-nfc']);
  const title = run(
    auditContentNfc,
    one('/zimmer/', { title: 'Das \u212bngström-Zimmer im Haus', main: '<h1>x</h1>', jsonld: '' }),
  );
  assert.deepEqual(findings(title), [
    'content-nfc /zimmer/ the text "Das \u212bngström-Zimmer im Haus": U+212B is not in NFC',
  ]);
});

test('content-nfc reports each distinct text once per page', () => {
  const report = run(
    auditContentNfc,
    withMain('<p>Cafe\u0301</p> <p>Cafe\u0301</p> <p title="Cafe\u0301">Ro\u0302ti</p>'),
  );
  assert.equal(report.findings.length, 2);
});

test('content-nfc keeps a lone surrogate: it is in NFC', () => {
  assert.deepEqual(ids(run(auditContentNfc, withMain('<p title="\ud800">\ud800 x</p>'))), []);
});

// Who reports what

test('a decomposed ß is content-nfc’s, and the glossary still reads the NFC text', () => {
  const report = run([auditContentNfc, auditContentGlossary], withMain('<p>Straße</p>'));
  assert.deepEqual(ids(report), ['content-glossary']);
  const decomposed = run([auditContentNfc, auditContentGlossary], withMain('<p>Cafe\u0301</p>'));
  assert.deepEqual(ids(decomposed), ['content-nfc']);
});

test('all six text rules pass the fixture site of two locales', () => {
  assert.deepEqual(ids(run(RULES, site(), { site: FACTS, glossary: GLOSSARY })), []);
});

// Hostile input

/** Pages that a hostile project can build: 2 MB of text, nesting 5,000 deep, odd attribute names and bytes. */
const HOSTILE: Files = {
  ...site(),
  'large/index.html': page(OPTIONS, '/large/', {
    main: `<h1>Gross</h1> <p>${'Zimmer CHF 330.00 und 081 555 01 11, info@example.com. '.repeat(36_000)}</p> <p>${'a'.repeat(200_000)}@@ ${'1'.repeat(200_000)}.5 CHF</p>`,
  }),
  'deep/index.html': page(OPTIONS, '/deep/', {
    main: `<h1>Tief</h1> ${'<div><span>'.repeat(2500)}Hotel <b>Laerchenwald</b> Cafe\u0301 ${'</span></div>'.repeat(2500)} ${'<blockquote>'.repeat(5000)}${ENGLISH}${'</blockquote>'.repeat(5000)}`,
  }),
  'odd/index.html': page(OPTIONS, '/odd/', {
    head: '<meta constructor="x" __proto__="y" name="description" content="\ud800\u0000">',
    main: '<h1 constructor="1" __proto__="2" hasOwnProperty="3">\ud800\u0000</h1> <p lang="__proto__">Email \ud800</p> <p lang="constructor"><a href="tel:%E0%A4%A" constructor="1">x</a> <a href="mailto:%ud800">y</a></p>',
  }),
};

test('the text rules never throw on hostile pages, finish fast, and give a stable result', () => {
  const started = performance.now();
  const first = findings(run(RULES, HOSTILE, { site: FACTS, glossary: GLOSSARY }));
  assert.ok(performance.now() - started < 10_000);
  const second = findings(run(RULES, HOSTILE, { site: FACTS, glossary: GLOSSARY }));
  assert.deepEqual(first, second);
  assert.deepEqual([...new Set(first.map((line) => line.split(' ').slice(0, 2).join(' ')))].sort(), [
    'content-glossary /deep/',
    'content-language /deep/',
    'content-nfc /deep/',
    'facts-value /large/',
    'facts-value /odd/',
  ]);
});

// Review cases of part 5c

test('content-stale drops a target whose hreflang round trip fails, on both sides: one fault, no stale page', () => {
  // /zimmer/ names /fr/chambres/, but /fr/chambres/ names only itself: neither side keeps the pair.
  const files = {
    ...pair(
      { main: sections(1, '<p><a href="/zimmer/">Zimmer</a></p>') },
      { main: sections(1, '<p><a href="/fr/chambres/">Chambres</a></p>') },
    ),
    'zimmer/index.html': page(OPTIONS, '/zimmer/', { alternates: { de: '/zimmer/', fr: '/fr/chambres/' } }),
    'fr/chambres/index.html': page(OPTIONS, '/fr/chambres/', { alternates: { fr: '/fr/chambres/' } }),
  };
  assert.deepEqual(ids(run(auditContentStale, files)), []);
  // The round trip holds when both pages name each other.
  const rooms = { de: '/zimmer/', fr: '/fr/chambres/' };
  const both = { ...files, 'fr/chambres/index.html': page(OPTIONS, '/fr/chambres/', { alternates: rooms }) };
  assert.deepEqual(ids(run(auditContentStale, both)), []);
  const lacking = {
    ...both,
    'fr/index.html': page(OPTIONS, '/fr/', { alternates: { de: '/', fr: '/fr/' }, main: sections(1) }),
  };
  assert.deepEqual(ids(run(auditContentStale, lacking)), ['content-stale']);
});

test('content-stale: an http default alternate of a home gives no stale finding on the pages that link the home', () => {
  const fr = page(OPTIONS, '/fr/', { alternates: { de: '/', fr: '/fr/' } }).replace(
    `hreflang="de-CH" href="${OPTIONS.site}/"`,
    'hreflang="de-CH" href="http://example.ch/"',
  );
  assert.deepEqual(ids(run(auditContentStale, { ...site(), 'fr/index.html': fr })), []);
});

test('content-glossary: a page of 250,000 text blocks never throws', () => {
  const report = glossary(withMain(`${'<p>x</p>'.repeat(250_000)}<p>Email</p>`));
  assert.deepEqual(ids(report), ['content-glossary']);
});

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  DAYS,
  GLOSSARY_FILE,
  glossarySchema,
  loadGlossary,
  loadSchedule,
  loadSite,
  parseGlossary,
  parseSchedule,
  parseSite,
  SCHEDULE_FILE,
  SITE_FILE,
  scheduleSchema,
  siteSchema,
  TIME,
} from '../../src/facts.ts';
import { Report } from '../../src/registry.ts';

type Json = Record<string, unknown>;
type Key = string | number;

/** A value of an edit that removes the key. */
const REMOVE = Symbol('remove');

const isRecord = (value: unknown): value is Json => typeof value === 'object' && value !== null;

/** Sets or removes one value in a JSON tree. A missing object on the way is created. */
function put(root: Json, path: readonly Key[], value: unknown): void {
  let node: Json = root;
  for (const key of path.slice(0, -1)) {
    if (node[key] === undefined) node[key] = {};
    const next = node[key];
    if (!isRecord(next)) throw new Error(`no object at ${String(key)}`);
    node = next;
  }
  const last = path.at(-1);
  if (last === undefined) throw new Error('an edit needs a path');
  if (value === REMOVE) delete node[last];
  else node[last] = value;
}

const SPEC = readFileSync(fileURLToPath(new URL('../../docs/spec.md', import.meta.url)), 'utf8');

/** The text that `init` writes into a file, read from 12.2, so that the test and the document cannot differ. */
function skeleton(file: string): string {
  const start = SPEC.indexOf(`\`${file}\` (\``);
  const end = SPEC.indexOf('`)', start);
  if (start < 0 || end < 0) throw new Error(`docs/spec.md has no init text for ${file}`);
  return SPEC.slice(start + file.length + 5, end);
}

/** The `site.json` skeleton of 12.2 for one site. */
const siteSkeleton = (): string =>
  skeleton(SITE_FILE).replaceAll('<NAME>', 'Example').replaceAll('<host>', 'example.ch');

/** The smallest valid `site.json`. */
const smallestSite = (): Json => ({ name: 'Example', legalName: 'Example AG', email: 'info@example.ch' });

/** A `site.json` with every field: the facts of the hotel site of 14.2, and the fields that it leaves out. */
const fullSite = (): Json => ({
  type: 'Hotel',
  name: 'Hotel Lärchenwald',
  legalName: 'Hotel Lärchenwald AG',
  email: 'info@example.ch',
  phone: '+41815550110',
  address: {
    street: 'Via da Fex 7',
    postalCode: '7514',
    locality: 'Sils im Engadin/Segl',
    region: 'GR',
    country: 'CH',
  },
  uid: 'CHE-123.456.789',
  vatId: 'CHE-123.456.789 MWST',
  iban: 'CH93 0076 2011 6238 5295 7',
  prices: [
    { id: 'room-single', amount: 18000, currency: 'CHF' },
    { id: 'room-double', amount: 32000 },
  ],
  sameAs: ['https://www.instagram.com/example/'],
  documents: { 'speisekarte.pdf': '/restaurant/' },
  accessibilityAudit: { date: '2026-03-01', by: 'Example Audit GmbH', scope: 'All pages' },
  contacts: [
    { name: 'Restaurant', phone: '+41815550120' },
    { name: 'Jobs', email: 'jobs@example.ch', phone: '+41815550130' },
  ],
});

/** What the full `site.json` parses to: the second price gets the currency CHF. */
const fullSiteParsed = (): Json => ({
  ...fullSite(),
  prices: [
    { id: 'room-single', amount: 18000, currency: 'CHF' },
    { id: 'room-double', amount: 32000, currency: 'CHF' },
  ],
});

/** The smallest valid `schedule.json`: the skeleton of 12.2. */
const smallestSchedule = (): Json => ({ openingHours: [], closures: [] });

/** A `schedule.json` with every field. */
const fullSchedule = (): Json => ({
  openingHours: [
    { days: ['Mo', 'Tu', 'We', 'Th', 'Fr'], opens: '07:00', closes: '22:00' },
    { days: ['Sa', 'Su'], opens: '08:00', closes: '23:59' },
  ],
  closures: [
    { from: '2026-11-02', to: '2026-12-04', note: 'Betriebsferien' },
    { from: '2027-04-12', to: '2027-04-12' },
  ],
});

/** A `glossary.json` with one locale. */
const glossary = (): Json => ({ de: { banned: { Fahrrad: 'Velo', Parkplatz: 'Parkfeld' } } });

type Edit = readonly [path: readonly Key[], value: unknown];
/** A field path as a finding prints it (`''` for the file itself), and the exact detail when the case asserts it. */
type Expected = readonly [path: string, detail?: string];
type Case = readonly [name: string, edits: readonly Edit[], expect: readonly Expected[]];

/** What one case gave, or what it must give. */
interface Seen {
  /** The sorted places of the findings. */
  places: string[];
  /** The sorted rule ids of the findings. */
  rules: string[];
  /** The details that the case names, each as `<place>: <detail>`. */
  details: string[];
  /** True when the value is valid. */
  valid: boolean;
}

interface Outcome {
  name: string;
  actual: Seen;
  expected: Seen;
}

/** One facts file: its name, its rule, its parser and the valid value that each case edits. */
interface Subject {
  file: string;
  rule: string;
  parse: (value: unknown, report: Report) => unknown;
  base: () => Json;
}

const SITE: Subject = { file: SITE_FILE, rule: 'config-options', parse: parseSite, base: fullSite };
const SCHEDULE: Subject = { file: SCHEDULE_FILE, rule: 'facts-schedule', parse: parseSchedule, base: fullSchedule };
const GLOSSARY: Subject = { file: GLOSSARY_FILE, rule: 'config-options', parse: parseGlossary, base: glossary };

/** Parses the edited value of each case. The test compares `actual` with `expected`. */
function outcomes(subject: Subject, cases: readonly Case[]): Outcome[] {
  const place = (path: string): string => (path === '' ? subject.file : `${subject.file}: ${path}`);
  return cases.map(([name, edits, expect]) => {
    const value = subject.base();
    for (const [path, to] of edits) put(value, path, to);
    const report = new Report();
    const parsed = subject.parse(value, report);
    const got = report.findings.map((finding) => `${finding.where}: ${finding.detail}`);
    const details = expect.flatMap(([path, detail]) => (detail === undefined ? [] : [`${place(path)}: ${detail}`]));
    return {
      name,
      actual: {
        places: report.findings.map((finding) => finding.where).sort(),
        rules: report.findings.map((finding) => finding.rule).sort(),
        details: details.filter((detail) => got.includes(detail)),
        valid: parsed !== undefined,
      },
      expected: {
        places: expect.map(([path]) => place(path)).sort(),
        rules: expect.map(() => subject.rule),
        details,
        valid: expect.length === 0,
      },
    };
  });
}

/** The findings of one parse, as sorted rule ids. */
function ids(parse: (value: unknown, report: Report) => unknown, value: unknown): string[] {
  const report = new Report();
  parse(value, report);
  return report.findings.map((finding) => finding.rule).sort();
}

const text = (length: number): string => 'x'.repeat(length);

// The skeletons of init

test('the site.json skeleton of 12.2 passes and gets every default of 5.6', () => {
  assert.equal(
    skeleton(SITE_FILE),
    '{"type": "Organization", "name": "<NAME>", "legalName": "<NAME> AG", "email": "info@<host>"}',
  );
  const report = new Report();
  const site = parseSite(JSON.parse(siteSkeleton()), report);
  assert.deepEqual(report.findings, []);
  assert.deepEqual(site, {
    type: 'Organization',
    name: 'Example',
    legalName: 'Example AG',
    email: 'info@example.ch',
    prices: [],
    sameAs: [],
    documents: {},
    contacts: [],
  });
});

test('the schedule.json skeleton of 12.2 passes', () => {
  assert.equal(skeleton(SCHEDULE_FILE), '{"openingHours": [], "closures": []}');
  const report = new Report();
  const schedule = parseSchedule(JSON.parse(skeleton(SCHEDULE_FILE)), report);
  assert.deepEqual(report.findings, []);
  assert.deepEqual(schedule, { openingHours: [], closures: [] });
});

test('the glossary.json skeleton of 12.2 passes', () => {
  assert.equal(skeleton(GLOSSARY_FILE), '{}');
  const report = new Report();
  assert.deepEqual(parseGlossary(JSON.parse(skeleton(GLOSSARY_FILE)), report), {});
  assert.deepEqual(report.findings, []);
});

// site.json

test('site.json: the smallest file gets the type Organization, and a full file keeps every value', () => {
  const small = new Report();
  assert.deepEqual(parseSite(smallestSite(), small), {
    ...smallestSite(),
    type: 'Organization',
    prices: [],
    sameAs: [],
    documents: {},
    contacts: [],
  });
  assert.deepEqual(small.findings, []);

  const full = new Report();
  const site = parseSite(fullSite(), full);
  assert.deepEqual(full.findings, []);
  assert.deepEqual(site, fullSiteParsed());
});

test('site.json: a default is a new value on each parse', () => {
  const first = parseSite(smallestSite(), new Report());
  first?.prices.push({ id: 'x', amount: 1, currency: 'CHF' });
  first?.sameAs.push('https://example.ch/');
  first?.contacts.push({ name: 'x', phone: '+41815550110' });
  if (first) first.documents['x.pdf'] = '/';
  const second = parseSite(smallestSite(), new Report());
  assert.deepEqual(second?.prices, []);
  assert.deepEqual(second?.sameAs, []);
  assert.deepEqual(second?.contacts, []);
  assert.deepEqual(second?.documents, {});
});

test('site.json: type, name, legalName, email, and the file itself', () => {
  const cases: Case[] = [
    ['the full file', [], []],
    ['type: a LocalBusiness subtype', [[['type'], 'ProfessionalService']], []],
    ['type: absent', [[['type'], REMOVE]], []],
    ['type: lower case', [[['type'], 'hotel']], [['type']]],
    ['type: one letter', [[['type'], 'H']], [['type']]],
    ['type: two words', [[['type'], 'Local Business']], [['type']]],
    ['type: a digit', [[['type'], 'Hotel2']], [['type']]],
    ['type: not a string', [[['type'], 5]], [['type']]],
    ['name: absent', [[['name'], REMOVE]], [['name']]],
    ['name: empty', [[['name'], '']], [['name']]],
    ['name: not a string', [[['name'], ['Example']]], [['name']]],
    ['legalName: absent', [[['legalName'], REMOVE]], [['legalName']]],
    ['legalName: empty', [[['legalName'], '']], [['legalName']]],
    ['email: absent', [[['email'], REMOVE]], [['email']]],
    ['email: no dot in the domain', [[['email'], 'info@example']], [['email']]],
    ['email: a space', [[['email'], 'in fo@example.ch']], [['email']]],
    ['email: two @', [[['email'], 'info@@example.ch']], [['email']]],
    ['an unknown key', [[['fax'], '+41815550111']], [['fax', 'unknown key']]],
    [
      'two unknown keys',
      [
        [['fax'], '+41815550111'],
        [['founded'], 1998],
      ],
      [
        ['fax', 'unknown key'],
        ['founded', 'unknown key'],
      ],
    ],
  ];
  for (const { name, actual, expected } of outcomes(SITE, cases)) assert.deepEqual(actual, expected, name);

  assert.deepEqual(ids(parseSite, []), ['config-options']);
  assert.deepEqual(ids(parseSite, null), ['config-options']);
  assert.deepEqual(ids(parseSite, 'Example'), ['config-options']);
  const report = new Report();
  parseSite([], report);
  assert.deepEqual(
    report.findings.map((finding) => finding.where),
    ['site.json'],
  );
});

test('site.json: phone, uid, vatId and iban', () => {
  const cases: Case[] = [
    ['phone: absent', [[['phone'], REMOVE]], []],
    ['phone: 7 digits', [[['phone'], '+1234567']], []],
    ['phone: 15 digits', [[['phone'], '+123456789012345']], []],
    ['phone: 6 digits', [[['phone'], '+123456']], [['phone']]],
    ['phone: 16 digits', [[['phone'], '+1234567890123456']], [['phone']]],
    ['phone: the national form', [[['phone'], '0815550110']], [['phone']]],
    ['phone: 00 in place of +', [[['phone'], '0041815550110']], [['phone']]],
    ['phone: a zero after +', [[['phone'], '+0815550110']], [['phone']]],
    ['phone: spaces', [[['phone'], '+41 81 555 01 10']], [['phone']]],
    ['phone: a number', [[['phone'], 41815550110]], [['phone']]],
    ['uid: absent', [[['uid'], REMOVE]], []],
    ['uid: no dots', [[['uid'], 'CHE-123456789']], [['uid']]],
    ['uid: no hyphen', [[['uid'], 'CHE123.456.789']], [['uid']]],
    ['uid: too short', [[['uid'], 'CHE-123.456.78']], [['uid']]],
    ['uid: with the VAT suffix', [[['uid'], 'CHE-123.456.789 MWST']], [['uid']]],
    ['uid: lower case', [[['uid'], 'che-123.456.789']], [['uid']]],
    ['vatId: absent', [[['vatId'], REMOVE]], []],
    ['vatId: any text', [[['vatId'], 'DE123456789']], []],
    ['vatId: not a string', [[['vatId'], 123456789]], [['vatId']]],
    ['iban: absent', [[['iban'], REMOVE]], []],
    ['iban: without spaces', [[['iban'], 'CH9300762011623852957']], []],
    ['iban: lower case', [[['iban'], 'ch9300762011623852957']], [['iban']]],
    ['iban: no check digits', [[['iban'], 'CHXX00762011623852957']], [['iban']]],
    ['iban: too short', [[['iban'], 'CH93007620116']], [['iban']]],
    ['iban: too long', [[['iban'], `CH93${'0'.repeat(31)}`]], [['iban']]],
    ['iban: a hyphen', [[['iban'], 'CH93-0076-2011-6238-5295-7']], [['iban']]],
  ];
  for (const { name, actual, expected } of outcomes(SITE, cases)) assert.deepEqual(actual, expected, name);
});

test('site.json: address', () => {
  const cases: Case[] = [
    ['absent', [[['address'], REMOVE]], []],
    ['region: absent', [[['address', 'region'], REMOVE]], []],
    ['street: absent', [[['address', 'street'], REMOVE]], [['address.street']]],
    ['street: not a string', [[['address', 'street'], 7]], [['address.street']]],
    ['postalCode: absent', [[['address', 'postalCode'], REMOVE]], [['address.postalCode']]],
    ['postalCode: a number', [[['address', 'postalCode'], 7514]], [['address.postalCode']]],
    ['locality: absent', [[['address', 'locality'], REMOVE]], [['address.locality']]],
    ['locality: not a string', [[['address', 'locality'], null]], [['address.locality']]],
    ['region: not a string', [[['address', 'region'], 18]], [['address.region']]],
    ['country: absent', [[['address', 'country'], REMOVE]], [['address.country']]],
    ['country: lower case', [[['address', 'country'], 'ch']], [['address.country']]],
    ['country: three letters', [[['address', 'country'], 'CHE']], [['address.country']]],
    ['country: a name', [[['address', 'country'], 'Schweiz']], [['address.country']]],
    ['an unknown key', [[['address', 'zip'], '7514']], [['address.zip', 'unknown key']]],
    ['not an object', [[['address'], 'Via da Fex 7, 7514 Sils']], [['address']]],
    [
      'an empty object',
      [[['address'], {}]],
      [['address.street'], ['address.postalCode'], ['address.locality'], ['address.country']],
    ],
  ];
  for (const { name, actual, expected } of outcomes(SITE, cases)) assert.deepEqual(actual, expected, name);
});

test('site.json: prices', () => {
  const cases: Case[] = [
    ['absent', [[['prices'], REMOVE]], []],
    ['amount: zero', [[['prices', 0, 'amount'], 0]], []],
    ['currency: another code', [[['prices', 0, 'currency'], 'EUR']], []],
    ['not an array', [[['prices'], { 'room-single': 18000 }]], [['prices']]],
    ['an entry that is not an object', [[['prices', 1], 32000]], [['prices[1]']]],
    ['id: absent', [[['prices', 0, 'id'], REMOVE]], [['prices[0].id']]],
    ['id: not a string', [[['prices', 0, 'id'], 1]], [['prices[0].id']]],
    ['amount: absent', [[['prices', 1, 'amount'], REMOVE]], [['prices[1].amount']]],
    ['amount: negative', [[['prices', 1, 'amount'], -1]], [['prices[1].amount']]],
    ['amount: major units with a fraction', [[['prices', 1, 'amount'], 320.5]], [['prices[1].amount']]],
    ['amount: a string', [[['prices', 1, 'amount'], '32000']], [['prices[1].amount']]],
    ['currency: lower case', [[['prices', 0, 'currency'], 'chf']], [['prices[0].currency']]],
    ['currency: two letters', [[['prices', 0, 'currency'], 'CH']], [['prices[0].currency']]],
    ['currency: four letters', [[['prices', 0, 'currency'], 'CHFR']], [['prices[0].currency']]],
    ['currency: a sign', [[['prices', 0, 'currency'], 'Fr.']], [['prices[0].currency']]],
    ['an unknown key', [[['prices', 0, 'label'], 'Einzelzimmer']], [['prices[0].label', 'unknown key']]],
  ];
  for (const { name, actual, expected } of outcomes(SITE, cases)) assert.deepEqual(actual, expected, name);
});

test('site.json: sameAs', () => {
  const url = 'a sameAs entry must be a URL that starts with https:// or http://';
  const cases: Case[] = [
    ['absent', [[['sameAs'], REMOVE]], []],
    ['http', [[['sameAs', 0], 'http://example.org/profile']], []],
    ['a query and a fragment', [[['sameAs', 0], 'https://example.org/p?id=1#top']], []],
    ['not an array', [[['sameAs'], 'https://example.org/']], [['sameAs']]],
    ['no scheme', [[['sameAs', 0], 'www.instagram.com/example']], [['sameAs[0]', url]]],
    ['a path', [[['sameAs', 0], '/kontakt/']], [['sameAs[0]', url]]],
    ['mailto', [[['sameAs', 0], 'mailto:info@example.ch']], [['sameAs[0]', url]]],
    ['javascript', [[['sameAs', 0], 'javascript:alert(1)']], [['sameAs[0]', url]]],
    ['no host', [[['sameAs', 0], 'https://']], [['sameAs[0]', url]]],
    ['a space', [[['sameAs', 0], 'https://example.org/a b']], [['sameAs[0]', url]]],
    ['a host that does not parse', [[['sameAs', 0], 'https://exa%mple.org/']], [['sameAs[0]', url]]],
    ['the second entry', [[['sameAs', 1], 'example.org']], [['sameAs[1]', url]]],
    ['not a string', [[['sameAs', 0], 1]], [['sameAs[0]']]],
  ];
  for (const { name, actual, expected } of outcomes(SITE, cases)) assert.deepEqual(actual, expected, name);
});

test('site.json: documents', () => {
  const key = 'a key must be the path of a PDF in dist, for example leitfaden.pdf';
  const cases: Case[] = [
    ['absent', [[['documents'], REMOVE]], []],
    ['a PDF in a folder', [[['documents'], { 'downloads/leitfaden.pdf': '/leitfaden/' }]], []],
    ['the home page', [[['documents'], { 'leitfaden.pdf': '/' }]], []],
    ['a page of another locale', [[['documents'], { 'guide.pdf': '/fr/guide-pratique/' }]], []],
    ['an upper case suffix', [[['documents'], { 'Leitfaden.PDF': '/leitfaden/' }]], []],
    ['not an object', [[['documents'], ['speisekarte.pdf']]], [['documents']]],
    [
      'key: a leading slash',
      [[['documents'], { '/leitfaden.pdf': '/leitfaden/' }]],
      [['documents["/leitfaden.pdf"]', key]],
    ],
    ['key: not a PDF', [[['documents'], { 'leitfaden.txt': '/leitfaden/' }]], [['documents["leitfaden.txt"]', key]]],
    ['key: a folder', [[['documents'], { 'downloads/': '/leitfaden/' }]], [['documents.downloads/', key]]],
    [
      'key: a parent folder',
      [[['documents'], { '../leitfaden.pdf': '/leitfaden/' }]],
      [['documents["../leitfaden.pdf"]', key]],
    ],
    ['key: an empty segment', [[['documents'], { 'a//b.pdf': '/leitfaden/' }]], [['documents["a//b.pdf"]', key]]],
    ['key: a backslash', [[['documents'], { 'a\\b.pdf': '/leitfaden/' }]], [['documents["a\\\\b.pdf"]', key]]],
    [
      'value: no leading slash',
      [[['documents', 'speisekarte.pdf'], 'restaurant/']],
      [['documents["speisekarte.pdf"]']],
    ],
    [
      'value: no trailing slash',
      [[['documents', 'speisekarte.pdf'], '/restaurant']],
      [['documents["speisekarte.pdf"]']],
    ],
    ['value: upper case', [[['documents', 'speisekarte.pdf'], '/Restaurant/']], [['documents["speisekarte.pdf"]']]],
    [
      'value: a full URL',
      [[['documents', 'speisekarte.pdf'], 'https://example.ch/restaurant/']],
      [['documents["speisekarte.pdf"]']],
    ],
    ['value: not a string', [[['documents', 'speisekarte.pdf'], true]], [['documents["speisekarte.pdf"]']]],
  ];
  for (const { name, actual, expected } of outcomes(SITE, cases)) assert.deepEqual(actual, expected, name);
});

test('site.json: accessibilityAudit', () => {
  const cases: Case[] = [
    ['absent', [[['accessibilityAudit'], REMOVE]], []],
    ['date: absent', [[['accessibilityAudit', 'date'], REMOVE]], [['accessibilityAudit.date']]],
    ['date: not a string', [[['accessibilityAudit', 'date'], 2026]], [['accessibilityAudit.date']]],
    ['by: absent', [[['accessibilityAudit', 'by'], REMOVE]], [['accessibilityAudit.by']]],
    ['by: not a string', [[['accessibilityAudit', 'by'], { name: 'x' }]], [['accessibilityAudit.by']]],
    ['scope: absent', [[['accessibilityAudit', 'scope'], REMOVE]], [['accessibilityAudit.scope']]],
    ['scope: not a string', [[['accessibilityAudit', 'scope'], ['/']]], [['accessibilityAudit.scope']]],
    ['an unknown key', [[['accessibilityAudit', 'level'], 'AA']], [['accessibilityAudit.level', 'unknown key']]],
    ['not an object', [[['accessibilityAudit'], true]], [['accessibilityAudit']]],
  ];
  for (const { name, actual, expected } of outcomes(SITE, cases)) assert.deepEqual(actual, expected, name);
});

test('site.json: contacts', () => {
  const need = 'a contact needs an email or a phone';
  const cases: Case[] = [
    ['absent', [[['contacts'], REMOVE]], []],
    ['only an email', [[['contacts', 1, 'phone'], REMOVE]], []],
    ['not an array', [[['contacts'], { Restaurant: '+41815550120' }]], [['contacts']]],
    ['an entry that is not an object', [[['contacts', 0], '+41815550120']], [['contacts[0]']]],
    ['name: absent', [[['contacts', 0, 'name'], REMOVE]], [['contacts[0].name']]],
    ['name: not a string', [[['contacts', 0, 'name'], 1]], [['contacts[0].name']]],
    ['no email and no phone', [[['contacts', 0, 'phone'], REMOVE]], [['contacts[0]', need]]],
    ['email: no domain', [[['contacts', 1, 'email'], 'jobs']], [['contacts[1].email']]],
    ['phone: the national form', [[['contacts', 1, 'phone'], '081 555 01 30']], [['contacts[1].phone']]],
    ['an unknown key', [[['contacts', 1, 'role'], 'HR']], [['contacts[1].role', 'unknown key']]],
  ];
  for (const { name, actual, expected } of outcomes(SITE, cases)) assert.deepEqual(actual, expected, name);
});

test('site.json: one run reports every finding', () => {
  const value = fullSite();
  put(value, ['type'], 'hotel');
  put(value, ['email'], 'info');
  put(value, ['address', 'country'], 'Schweiz');
  put(value, ['prices', 1, 'amount'], 320.5);
  put(value, ['contacts', 0, 'phone'], REMOVE);
  put(value, ['fax'], '+41815550111');
  const report = new Report();
  assert.equal(parseSite(value, report), undefined);
  assert.deepEqual(report.findings.map((finding) => finding.where).sort(), [
    'site.json: address.country',
    'site.json: contacts[0]',
    'site.json: email',
    'site.json: fax',
    'site.json: prices[1].amount',
    'site.json: type',
  ]);
  assert.deepEqual([...report.ids()], ['config-options']);
});

// schedule.json

test('schedule.json: a full file keeps every value', () => {
  const report = new Report();
  assert.deepEqual(parseSchedule(fullSchedule(), report), fullSchedule());
  assert.deepEqual(report.findings, []);
  assert.deepEqual(DAYS, ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']);
  assert.equal(TIME.source, '^([01]\\d|2[0-3]):[0-5]\\d$');
});

test('schedule.json: openingHours', () => {
  const cases: Case[] = [
    ['the full file', [], []],
    ['every day', [[['openingHours', 0, 'days'], [...DAYS]]], []],
    ['midnight', [[['openingHours', 0, 'opens'], '00:00']], []],
    ['the last minute', [[['openingHours', 0, 'closes'], '23:59']], []],
    ['closes after midnight', [[['openingHours', 0, 'closes'], '02:00']], []],
    ['absent', [[['openingHours'], REMOVE]], [['openingHours']]],
    ['not an array', [[['openingHours'], { Mo: '07:00-22:00' }]], [['openingHours']]],
    ['an entry that is not an object', [[['openingHours', 0], 'Mo 07:00-22:00']], [['openingHours[0]']]],
    ['days: absent', [[['openingHours', 0, 'days'], REMOVE]], [['openingHours[0].days']]],
    ['days: empty', [[['openingHours', 0, 'days'], []]], [['openingHours[0].days']]],
    ['days: not an array', [[['openingHours', 0, 'days'], 'Mo']], [['openingHours[0].days']]],
    ['days: three letters', [[['openingHours', 0, 'days', 1], 'Tue']], [['openingHours[0].days[1]']]],
    ['days: lower case', [[['openingHours', 1, 'days', 0], 'sa']], [['openingHours[1].days[0]']]],
    ['days: a number', [[['openingHours', 1, 'days', 1], 7]], [['openingHours[1].days[1]']]],
    ['opens: absent', [[['openingHours', 0, 'opens'], REMOVE]], [['openingHours[0].opens']]],
    ['opens: one digit for the hour', [[['openingHours', 0, 'opens'], '7:00']], [['openingHours[0].opens']]],
    ['opens: hour 24', [[['openingHours', 0, 'opens'], '24:00']], [['openingHours[0].opens']]],
    ['opens: minute 60', [[['openingHours', 0, 'opens'], '07:60']], [['openingHours[0].opens']]],
    ['opens: with seconds', [[['openingHours', 0, 'opens'], '07:00:00']], [['openingHours[0].opens']]],
    ['opens: a dot', [[['openingHours', 0, 'opens'], '07.00']], [['openingHours[0].opens']]],
    ['opens: a number', [[['openingHours', 0, 'opens'], 7]], [['openingHours[0].opens']]],
    ['closes: absent', [[['openingHours', 1, 'closes'], REMOVE]], [['openingHours[1].closes']]],
    ['closes: hour 24', [[['openingHours', 1, 'closes'], '24:00']], [['openingHours[1].closes']]],
    ['closes: 12-hour clock', [[['openingHours', 1, 'closes'], '11:00 pm']], [['openingHours[1].closes']]],
    ['an unknown key', [[['openingHours', 0, 'note'], 'x']], [['openingHours[0].note', 'unknown key']]],
  ];
  for (const { name, actual, expected } of outcomes(SCHEDULE, cases)) assert.deepEqual(actual, expected, name);
});

test('schedule.json: closures, and the file itself', () => {
  const date = 'a date must be a real date YYYY-MM-DD';
  const cases: Case[] = [
    ['note: absent', [[['closures', 0, 'note'], REMOVE]], []],
    ['note: 80 characters', [[['closures', 0, 'note'], text(80)]], []],
    ['a leap day', [[['closures', 0, 'from'], '2028-02-29']], []],
    ['absent', [[['closures'], REMOVE]], [['closures']]],
    ['not an array', [[['closures'], '2026-11-02']], [['closures']]],
    ['an entry that is not an object', [[['closures', 1], '2027-04-12']], [['closures[1]']]],
    ['from: absent', [[['closures', 0, 'from'], REMOVE]], [['closures[0].from']]],
    ['from: one digit for the month', [[['closures', 0, 'from'], '2026-2-01']], [['closures[0].from', date]]],
    ['from: day first', [[['closures', 0, 'from'], '02.11.2026']], [['closures[0].from', date]]],
    ['from: a day that does not exist', [[['closures', 0, 'from'], '2026-02-30']], [['closures[0].from', date]]],
    ['from: with a time', [[['closures', 0, 'from'], '2026-11-02T00:00']], [['closures[0].from', date]]],
    ['to: absent', [[['closures', 1, 'to'], REMOVE]], [['closures[1].to']]],
    ['to: month 13', [[['closures', 1, 'to'], '2027-13-01']], [['closures[1].to', date]]],
    ['to: no leap day', [[['closures', 1, 'to'], '2027-02-29']], [['closures[1].to', date]]],
    ['to: a number', [[['closures', 1, 'to'], 20270412]], [['closures[1].to']]],
    ['note: 81 characters', [[['closures', 0, 'note'], text(81)]], [['closures[0].note']]],
    ['note: not a string', [[['closures', 0, 'note'], 1]], [['closures[0].note']]],
    ['an unknown key in an entry', [[['closures', 0, 'reason'], 'x']], [['closures[0].reason', 'unknown key']]],
    ['an unknown key', [[['holidays'], []]], [['holidays', 'unknown key']]],
  ];
  for (const { name, actual, expected } of outcomes(SCHEDULE, cases)) assert.deepEqual(actual, expected, name);

  assert.deepEqual(ids(parseSchedule, []), ['facts-schedule']);
  assert.deepEqual(ids(parseSchedule, null), ['facts-schedule']);
  assert.deepEqual(ids(parseSchedule, {}), ['facts-schedule', 'facts-schedule']);
});

test('schedule.json: one run reports every finding', () => {
  const value = fullSchedule();
  put(value, ['openingHours', 0, 'days'], []);
  put(value, ['openingHours', 1, 'opens'], '8:00');
  put(value, ['closures', 0, 'to'], '2026-12-32');
  put(value, ['closures', 1, 'note'], text(81));
  put(value, ['holidays'], []);
  const report = new Report();
  assert.equal(parseSchedule(value, report), undefined);
  assert.deepEqual(report.findings.map((finding) => finding.where).sort(), [
    'schedule.json: closures[0].to',
    'schedule.json: closures[1].note',
    'schedule.json: holidays',
    'schedule.json: openingHours[0].days',
    'schedule.json: openingHours[1].opens',
  ]);
  assert.deepEqual([...report.ids()], ['facts-schedule']);
});

// The key __proto__

test('the key __proto__ is an unknown key in every record and object of the facts files', () => {
  // JSON.parse gives the key as an own property. The zod record parser drops it without an issue.
  const cases: [name: string, parse: (value: unknown, report: Report) => unknown, source: string, places: string[]][] =
    [
      [
        'site.json: documents',
        parseSite,
        '{"documents": {"__proto__": "/a/", "a.pdf": "/a/"}}',
        ['documents.__proto__'],
      ],
      ['site.json: the file', parseSite, '{"__proto__": 1}', ['__proto__']],
      [
        'site.json: address',
        parseSite,
        '{"address": {"street": "a", "postalCode": "1", "locality": "b", "country": "CH", "__proto__": 1}}',
        ['address.__proto__'],
      ],
      ['schedule.json: the file', parseSchedule, '{"__proto__": 1}', ['__proto__']],
      ['glossary.json: the file', parseGlossary, '{"__proto__": {"banned": {}}}', ['__proto__']],
      ['glossary.json: banned', parseGlossary, '{"de": {"banned": {"__proto__": "x"}}}', ['de.banned.__proto__']],
      ['glossary.json: a locale', parseGlossary, '{"de": {"__proto__": 1, "banned": {}}}', ['de.__proto__']],
    ];
  const bases = new Map<unknown, () => Json>([
    [parseSite, smallestSite],
    [parseSchedule, smallestSchedule],
    [parseGlossary, () => ({})],
  ]);
  const seen = cases.map(([name, parse, source]) => {
    const report = new Report();
    // The own keys of the parsed text are added to a valid value, so that the key is the only thing wrong.
    const value: Json = { ...bases.get(parse)?.(), ...(JSON.parse(source) as Json) };
    const parsed = parse(value, report);
    const files = report.findings.map((finding) => finding.where.replace(/^[a-z]+\.json: /, ''));
    return {
      name,
      places: files,
      details: report.findings.map((finding) => finding.detail),
      valid: parsed !== undefined,
    };
  });
  assert.deepEqual(
    seen,
    cases.map(([name, , , places]) => ({ name, places, details: places.map(() => 'unknown key'), valid: false })),
  );
});

// glossary.json

test('glossary.json', () => {
  const cases: Case[] = [
    ['one locale', [], []],
    ['two locales', [[['fr'], { banned: { courriel: 'e-mail' } }]], []],
    ['a code of three letters', [[['gsw'], { banned: {} }]], []],
    ['no banned variant', [[['de', 'banned'], {}]], []],
    ['an empty canonical term', [[['de', 'banned', 'Fahrrad'], '']], []],
    ['key: upper case', [[['DE'], { banned: {} }]], [['DE', 'a key must be a locale code']]],
    ['key: a language tag', [[['de-CH'], { banned: {} }]], [['de-CH', 'a key must be a locale code']]],
    ['key: a name', [[['deutsch'], { banned: {} }]], [['deutsch', 'a key must be a locale code']]],
    ['a locale that is not an object', [[['de'], ['Fahrrad']]], [['de']]],
    ['banned: absent', [[['de', 'banned'], REMOVE]], [['de.banned']]],
    ['banned: an array', [[['de', 'banned'], ['Fahrrad']]], [['de.banned']]],
    [
      'banned: an empty variant',
      [[['de', 'banned', ''], 'Velo']],
      [['de.banned[""]', 'a banned variant must not be empty']],
    ],
    ['banned: a canonical term that is not a string', [[['de', 'banned', 'Fahrrad'], 1]], [['de.banned.Fahrrad']]],
    ['banned: a list of canonical terms', [[['de', 'banned', 'Fahrrad'], ['Velo']]], [['de.banned.Fahrrad']]],
    ['an unknown key in a locale', [[['de', 'allowed'], {}]], [['de.allowed', 'unknown key']]],
  ];
  for (const { name, actual, expected } of outcomes(GLOSSARY, cases)) assert.deepEqual(actual, expected, name);

  assert.deepEqual(ids(parseGlossary, []), ['config-options']);
  assert.deepEqual(ids(parseGlossary, null), ['config-options']);
  const report = new Report();
  assert.deepEqual(parseGlossary(glossary(), report), glossary());
  assert.deepEqual(report.findings, []);
});

// The schemas

test('the three schemas are strict and give the documented defaults', () => {
  assert.equal(siteSchema.safeParse({ ...smallestSite(), extra: 1 }).success, false);
  assert.equal(scheduleSchema.safeParse({ ...smallestSchedule(), extra: 1 }).success, false);
  assert.equal(glossarySchema.safeParse({ de: { banned: {}, extra: 1 } }).success, false);
  assert.equal(siteSchema.parse(smallestSite()).type, 'Organization');
  assert.equal(siteSchema.parse({ ...smallestSite(), prices: [{ id: 'a', amount: 1 }] }).prices[0]?.currency, 'CHF');
});

// The rules

test('config-options: the smallest site.json passes, and one changed value fails', () => {
  assert.deepEqual(ids(parseSite, smallestSite()), []);
  assert.deepEqual(ids(parseSite, { ...smallestSite(), email: 'info@example' }), ['config-options']);
});

test('facts-schedule: the smallest schedule.json passes, and one changed value fails', () => {
  assert.deepEqual(ids(parseSchedule, smallestSchedule()), []);
  assert.deepEqual(
    ids(parseSchedule, { openingHours: [{ days: ['Mo'], opens: '08:00', closes: '17:00' }], closures: [] }),
    [],
  );
  assert.deepEqual(
    ids(parseSchedule, { openingHours: [{ days: ['Mo'], opens: '08:00', closes: '25:00' }], closures: [] }),
    ['facts-schedule'],
  );
});

// The loaders

/** What the three loaders gave for one folder. */
interface Loaded {
  site: unknown;
  schedule: unknown;
  glossary: unknown;
  findings: string[];
}

/** Writes the given files into a new temp folder, runs the three loaders and removes the folder. */
function loadAll(files: Readonly<Record<string, string>>): Loaded {
  const root = mkdtempSync(join(tmpdir(), 'astro-kit-'));
  try {
    for (const [file, content] of Object.entries(files)) writeFileSync(join(root, file), content);
    const report = new Report();
    const site = loadSite(root, report);
    const schedule = loadSchedule(root, report);
    const glossaryValue = loadGlossary(root, report);
    return {
      site,
      schedule,
      glossary: glossaryValue,
      findings: report.findings.map((finding) => `[${finding.rule}] ${finding.where}`),
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('the loaders read the files that init writes', () => {
  const loaded = loadAll({
    [SITE_FILE]: `${siteSkeleton()}\n`,
    [SCHEDULE_FILE]: `${skeleton(SCHEDULE_FILE)}\n`,
    [GLOSSARY_FILE]: `${skeleton(GLOSSARY_FILE)}\n`,
  });
  assert.deepEqual(loaded, {
    site: {
      type: 'Organization',
      name: 'Example',
      legalName: 'Example AG',
      email: 'info@example.ch',
      prices: [],
      sameAs: [],
      documents: {},
      contacts: [],
    },
    schedule: { openingHours: [], closures: [] },
    glossary: {},
    findings: [],
  });
});

test('the loaders read full files', () => {
  const loaded = loadAll({
    [SITE_FILE]: JSON.stringify(fullSite(), null, 2),
    [SCHEDULE_FILE]: JSON.stringify(fullSchedule(), null, 2),
    [GLOSSARY_FILE]: JSON.stringify(glossary(), null, 2),
  });
  assert.deepEqual(loaded.findings, []);
  assert.deepEqual(loaded.schedule, fullSchedule());
  assert.deepEqual(loaded.glossary, glossary());
  assert.deepEqual(loaded.site, fullSiteParsed());
});

test('a missing site.json and a missing schedule.json are findings; a missing glossary.json is an empty glossary', () => {
  assert.deepEqual(loadAll({}), {
    site: undefined,
    schedule: undefined,
    glossary: {},
    findings: ['[config-options] site.json', '[facts-schedule] schedule.json'],
  });

  const root = mkdtempSync(join(tmpdir(), 'astro-kit-'));
  try {
    const report = new Report();
    loadSite(root, report);
    loadSchedule(root, report);
    assert.deepEqual(report.findings, [
      { rule: 'config-options', where: 'site.json', detail: 'the file is missing' },
      { rule: 'facts-schedule', where: 'schedule.json', detail: 'the file is missing' },
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('each missing file is reported alone', () => {
  const site = `${siteSkeleton()}\n`;
  const schedule = `${skeleton(SCHEDULE_FILE)}\n`;
  assert.deepEqual(loadAll({ [SITE_FILE]: site }).findings, ['[facts-schedule] schedule.json']);
  assert.deepEqual(loadAll({ [SCHEDULE_FILE]: schedule }).findings, ['[config-options] site.json']);
  assert.deepEqual(loadAll({ [SITE_FILE]: site, [SCHEDULE_FILE]: schedule }).findings, []);
});

test('a file that is not JSON is one finding at the file', () => {
  const loaded = loadAll({
    [SITE_FILE]: '{ "name": ',
    [SCHEDULE_FILE]: '{ "openingHours": [], "closures": [], }',
    [GLOSSARY_FILE]: '// no terms yet\n{}',
  });
  assert.deepEqual(loaded, {
    site: undefined,
    schedule: undefined,
    glossary: undefined,
    findings: ['[config-options] site.json', '[facts-schedule] schedule.json', '[config-options] glossary.json'],
  });

  const root = mkdtempSync(join(tmpdir(), 'astro-kit-'));
  try {
    writeFileSync(join(root, SCHEDULE_FILE), '');
    const report = new Report();
    assert.equal(loadSchedule(root, report), undefined);
    assert.deepEqual(
      report.findings.map((finding) => [finding.rule, finding.where, finding.detail?.slice(0, 27)]),
      [['facts-schedule', 'schedule.json', 'the file is not valid JSON:']],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the loaders name the field path of each wrong value, under the rule of the file', () => {
  const site = fullSite();
  put(site, ['address', 'country'], 'ch');
  put(site, ['contacts', 1, 'email'], 'jobs');
  const schedule = fullSchedule();
  put(schedule, ['openingHours', 1, 'days', 0], 'Sat');
  put(schedule, ['closures', 0, 'from'], '2026-11-31');
  const terms = glossary();
  put(terms, ['de', 'banned', 'Fahrrad'], 1);
  put(terms, ['FR'], { banned: {} });
  const loaded = loadAll({
    [SITE_FILE]: JSON.stringify(site),
    [SCHEDULE_FILE]: JSON.stringify(schedule),
    [GLOSSARY_FILE]: JSON.stringify(terms),
  });
  assert.deepEqual(loaded, {
    site: undefined,
    schedule: undefined,
    glossary: undefined,
    findings: [
      '[config-options] site.json: address.country',
      '[config-options] site.json: contacts[1].email',
      '[facts-schedule] schedule.json: openingHours[1].days[0]',
      '[facts-schedule] schedule.json: closures[0].from',
      '[config-options] glossary.json: de.banned.Fahrrad',
      '[config-options] glossary.json: FR',
    ],
  });
});

test('a JSON value that is not an object fails at the file', () => {
  const loaded = loadAll({ [SITE_FILE]: '[]', [SCHEDULE_FILE]: 'null', [GLOSSARY_FILE]: '"de"' });
  assert.deepEqual(loaded.findings, [
    '[config-options] site.json',
    '[facts-schedule] schedule.json',
    '[config-options] glossary.json',
  ]);
});

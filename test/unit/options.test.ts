import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { z } from 'astro/zod';
import {
  checkProcessing,
  checkWaivers,
  EMAIL,
  effectiveLimits,
  fieldPath,
  fieldPlace,
  hiddenKeys,
  isRealDate,
  LIMITS,
  loadOptions,
  MESSAGES,
  OPTIONS_FILE,
  type Options,
  optionsSchema,
  parseOptions,
  readJson,
  reportIssues,
} from '../../src/options.ts';
import { Report, RULES } from '../../src/registry.ts';

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

/** The example of section 5.1, read from the specification, so that the test and the document cannot differ. */
const EXAMPLE = (() => {
  const spec = readFileSync(fileURLToPath(new URL('../../docs/spec.md', import.meta.url)), 'utf8');
  const match = /### 5\.1 Example\n\n```json\n([\s\S]*?)\n```/.exec(spec);
  if (!match?.[1]) throw new Error('docs/spec.md has no example in 5.1');
  return match[1];
})();

const example = (): Json => JSON.parse(EXAMPLE) as Json;

/** The smallest valid settings: one locale, no feature. */
const single = (): Json => ({
  site: 'https://example.ch',
  codeOwner: '@example-owner',
  locales: [{ code: 'de', tag: 'de-CH', name: 'Deutsch' }],
  defaultLocale: 'de',
  legal: { legalNote: { de: '/impressum/' }, privacy: { de: '/datenschutz/' } },
  securityContact: 'mailto:security@example.ch',
});

/** Two locales, no feature. */
const two = (): Json => ({
  ...single(),
  locales: [
    { code: 'de', tag: 'de-CH', name: 'Deutsch' },
    { code: 'fr', tag: 'fr-CH', name: 'Français' },
  ],
  legal: {
    legalNote: { de: '/impressum/', fr: '/fr/mentions-legales/' },
    privacy: { de: '/datenschutz/', fr: '/fr/protection-des-donnees/' },
  },
});

/** One locale with forms and one declared form. */
const forms = (): Json => ({
  ...single(),
  features: { forms: true },
  contact: { to: 'info@example.ch', from: 'form@example.ch' },
  forms: { contact: { fields: [{ name: 'message', type: 'textarea' }] } },
  processing: ['cdn', 'previews', 'forms', 'server'],
});

/** One locale with one origin that loads with the page. */
const origin = (): Json => ({
  ...single(),
  origins: [
    { host: 'js.stripe.com', directives: ['frame'], load: 'page', purpose: 'Payment', processor: 'Stripe, Inc.' },
  ],
});

/** One locale with one waiver. */
const waiver = (): Json => ({
  ...single(),
  waivers: [{ rule: 'head-title', where: '/jobs/', reason: 'The client wants this title', until: '2026-12-31' }],
});

type Edit = readonly [path: readonly Key[], value: unknown];
/** A field path as a finding prints it (`''` for the file itself), and the exact message when the case asserts it. */
type Expected = readonly [path: string, detail?: string];
type Case = readonly [name: string, base: () => Json, edits: readonly Edit[], expect: readonly Expected[]];

const place = (path: string): string => (path === '' ? OPTIONS_FILE : `${OPTIONS_FILE}: ${path}`);

/** What one case gave, or what it must give. */
interface Seen {
  /** The sorted places of the findings. */
  places: string[];
  /** The sorted rule ids of the findings. */
  rules: string[];
  /** The exact messages that the case names, each as `<place>: <message>`. */
  messages: string[];
  /** True when the settings are valid. */
  valid: boolean;
}

interface Outcome {
  name: string;
  actual: Seen;
  expected: Seen;
}

/** Parses the settings of each case. The test compares `actual` with `expected`. */
function outcomes(cases: readonly Case[]): Outcome[] {
  return cases.map(([name, base, edits, expect]) => {
    const value = base();
    for (const [path, to] of edits) put(value, path, to);
    const report = new Report();
    const options = parseOptions(value, report);
    const got = report.findings.map((finding) => `${finding.where}: ${finding.detail}`);
    const messages = expect.flatMap(([path, detail]) => (detail === undefined ? [] : [`${place(path)}: ${detail}`]));
    return {
      name,
      actual: {
        places: report.findings.map((finding) => finding.where).sort(),
        rules: report.findings.map((finding) => finding.rule).sort(),
        messages: messages.filter((message) => got.includes(message)),
        valid: options !== undefined,
      },
      expected: {
        places: expect.map(([path]) => place(path)).sort(),
        rules: expect.map(() => 'config-options'),
        messages,
        valid: expect.length === 0,
      },
    };
  });
}

const text = (length: number): string => 'x'.repeat(length);

test('the registry holds the rules of milestone M2 in the order of section 8', () => {
  assert.deepEqual(
    RULES.map((rule) => [rule.id, rule.group, rule.stage]),
    [
      ['config-options', 'config', 'config'],
      ['config-shim', 'config', 'config'],
      ['config-imports', 'config', 'config'],
      ['config-suppression', 'config', 'config'],
      ['config-server', 'config', 'config'],
      ['config-waiver', 'config', 'config'],
      ['config-overrides', 'config', 'config'],
      ['config-dep-spec', 'config', 'config'],
      ['config-dep-allowlist', 'config', 'config'],
      ['config-public-shadow', 'config', 'config'],
      ['routes-redirects', 'routes', 'config + build'],
      ['images-public', 'images', 'config'],
      ['images-original', 'images', 'config'],
      ['facts-schedule', 'facts', 'config'],
      ['legal-processing', 'legal', 'config'],
    ],
  );
  for (const rule of RULES) {
    assert.equal(rule.level, 'error', rule.id);
    assert.equal(rule.waivable, false, rule.id);
    assert.ok(rule.standard.length > 0 && rule.message.length > 0 && rule.hint.length > 0, rule.id);
  }
});

test('LIMITS holds the table of section 8', () => {
  assert.deepEqual(LIMITS, {
    headBytes: 14336,
    cspBytes: 4096,
    documentBytes: 30720,
    domElements: 1400,
    domDepth: 32,
    fontBytes: 102400,
    islandJsBytes: 20480,
    lazyJsBytes: 204800,
    prefetchJsBytes: 2048,
    ogImageBytes: 153600,
    titleMin: 15,
    titleMax: 70,
    descriptionMin: 50,
    descriptionMax: 160,
    imageMaxPx: 2560,
    imageMaxBytes: 3145728,
    clickDepth: 3,
  });
});

test('the example of 5.1 passes and gets the documented defaults', () => {
  const report = new Report();
  const options = parseOptions(example(), report);
  assert.deepEqual(report.findings, []);
  assert.deepEqual(options, {
    $schema: './node_modules/@raess/astro-kit/schema/astro-kit.schema.json',
    site: 'https://example.ch',
    codeOwner: '@example-owner',
    locales: [
      { code: 'de', tag: 'de-CH', name: 'Deutsch', coverage: 'full' },
      { code: 'fr', tag: 'fr-CH', name: 'Français', coverage: 'full' },
    ],
    defaultLocale: 'de',
    features: { forms: true, islands: false, scripts: false, wasm: false, workers: false },
    prefetch: { speculationRules: true, astroPrefetch: false },
    modes: { auto: true, light: true, dark: true, contrast: false },
    contact: { to: 'info@example.ch', from: 'form@example.ch' },
    forms: {
      contact: {
        to: 'info@example.ch',
        fields: [
          { name: 'name', type: 'text', required: true, maxLength: 100, autocomplete: 'name' },
          { name: 'email', type: 'email', required: true, maxLength: 254, autocomplete: 'email' },
          { name: 'message', type: 'textarea', required: true, maxLength: 5000, autocomplete: 'off' },
        ],
      },
    },
    legal: {
      legalNote: { de: '/impressum/', fr: '/fr/mentions-legales/' },
      privacy: { de: '/datenschutz/', fr: '/fr/protection-des-donnees/' },
    },
    processing: ['cdn', 'previews', 'forms', 'server'],
    securityContact: 'mailto:security@example.ch',
    dependencies: [],
    origins: [],
    waivers: [],
    limits: {},
  });
  const rules = new Report();
  if (options) {
    checkWaivers(options, rules);
    checkProcessing(options, rules);
  }
  assert.deepEqual(rules.findings, []);
});

test('the smallest settings get every default of 5.2', () => {
  const report = new Report();
  const options = parseOptions(single(), report);
  assert.deepEqual(report.findings, []);
  assert.deepEqual(options, {
    site: 'https://example.ch',
    codeOwner: '@example-owner',
    locales: [{ code: 'de', tag: 'de-CH', name: 'Deutsch', coverage: 'full' }],
    defaultLocale: 'de',
    features: { forms: false, islands: false, scripts: false, wasm: false, workers: false },
    prefetch: { speculationRules: true, astroPrefetch: false },
    modes: { auto: true, light: false, dark: false, contrast: false },
    legal: { legalNote: { de: '/impressum/' }, privacy: { de: '/datenschutz/' } },
    processing: ['cdn', 'previews'],
    securityContact: 'mailto:security@example.ch',
    dependencies: [],
    origins: [],
    waivers: [],
    limits: {},
  });
});

test('a default is a new value on each parse', () => {
  const first = optionsSchema.parse(single());
  const second = optionsSchema.parse(single());
  first.processing.push('forms');
  first.dependencies.push('sharp');
  first.modes.dark = true;
  assert.deepEqual(second.processing, ['cdn', 'previews']);
  assert.deepEqual(second.dependencies, []);
  assert.equal(second.modes.dark, false);
});

test('forms: the defaults of a form, of a field type and of a field name', () => {
  const declared = forms();
  put(declared, ['contact', 'probe'], 'probe@example.ch');
  put(declared, ['forms'], {
    contact: {
      fields: [
        { name: 'name', type: 'text' },
        { name: 'email', type: 'email' },
        { name: 'tel', type: 'tel', required: false },
        { name: 'mail2', type: 'email', autocomplete: 'work email' },
        { name: 'message', type: 'textarea', maxLength: 800 },
      ],
    },
    booking: {
      to: 'booking@example.ch',
      fields: [
        { name: 'arrival', type: 'date' },
        { name: 'departure', type: 'date', min: '2026-01-01', max: '2027-12-31' },
        { name: 'nights', type: 'number', min: 1, max: 14 },
        { name: 'room', type: 'choice', options: ['single', 'double', 'family'] },
        { name: 'terms', type: 'consent' },
      ],
    },
  });
  const report = new Report();
  const options = parseOptions(declared, report);
  assert.deepEqual(report.findings, []);
  assert.deepEqual(options?.contact, { to: 'info@example.ch', from: 'form@example.ch', probe: 'probe@example.ch' });
  assert.deepEqual(options?.forms, {
    contact: {
      to: 'info@example.ch',
      fields: [
        { name: 'name', type: 'text', required: true, maxLength: 200, autocomplete: 'name' },
        { name: 'email', type: 'email', required: true, maxLength: 254, autocomplete: 'email' },
        { name: 'tel', type: 'tel', required: false, maxLength: 32, autocomplete: 'tel' },
        { name: 'mail2', type: 'email', required: true, maxLength: 254, autocomplete: 'work email' },
        { name: 'message', type: 'textarea', required: true, maxLength: 800, autocomplete: 'off' },
      ],
    },
    booking: {
      to: 'booking@example.ch',
      fields: [
        { name: 'arrival', type: 'date', required: true, autocomplete: 'off' },
        { name: 'departure', type: 'date', required: true, min: '2026-01-01', max: '2027-12-31', autocomplete: 'off' },
        { name: 'nights', type: 'number', required: true, min: 1, max: 14, autocomplete: 'off' },
        { name: 'room', type: 'choice', required: true, options: ['single', 'double', 'family'], autocomplete: 'off' },
        { name: 'terms', type: 'consent', required: true, autocomplete: 'off' },
      ],
    },
  });
});

test('forms: a site with forms and no declared form gets the form contact', () => {
  const declared = forms();
  put(declared, ['forms'], REMOVE);
  const report = new Report();
  const options = parseOptions(declared, report);
  assert.deepEqual(report.findings, []);
  assert.deepEqual(options?.forms, {
    contact: {
      to: 'info@example.ch',
      fields: [
        { name: 'name', type: 'text', required: true, maxLength: 200, autocomplete: 'name' },
        { name: 'email', type: 'email', required: true, maxLength: 254, autocomplete: 'email' },
        { name: 'message', type: 'textarea', required: true, maxLength: 5000, autocomplete: 'off' },
      ],
    },
  });
  const none = parseOptions(single(), new Report());
  assert.ok(none);
  assert.equal('forms' in none, false);
  assert.equal('contact' in none, false);
});

test('the top-level fields: $schema, site, codeOwner, securityContact, dependencies and unknown keys', () => {
  const cases: Case[] = [
    ['the smallest settings', single, [], []],
    ['$schema as a string', single, [[['$schema'], './schema.json']], []],
    ['$schema as a number', single, [[['$schema'], 1]], [['$schema']]],
    ['an unknown key', single, [[['nav'], []]], [['nav', 'unknown key']]],
    [
      'two unknown keys',
      single,
      [
        [['nav'], []],
        [['theme'], 'dark'],
      ],
      [['nav'], ['theme']],
    ],
    ['no site', single, [[['site'], REMOVE]], [['site']]],
    ['site with http', single, [[['site'], 'http://example.ch']], [['site']]],
    ['site with a trailing slash', single, [[['site'], 'https://example.ch/']], [['site']]],
    ['site with a path', single, [[['site'], 'https://example.ch/de']], [['site']]],
    ['site with an upper-case letter', single, [[['site'], 'https://Example.ch']], [['site']]],
    ['site with a port', single, [[['site'], 'https://example.ch:8443']], [['site']]],
    ['site with a subdomain', single, [[['site'], 'https://www.example-hotel.ch']], []],
    ['no codeOwner', single, [[['codeOwner'], REMOVE]], [['codeOwner']]],
    ['codeOwner without @', single, [[['codeOwner'], 'example-owner']], [['codeOwner']]],
    ['codeOwner with a space', single, [[['codeOwner'], '@example owner']], [['codeOwner']]],
    ['codeOwner with two slashes', single, [[['codeOwner'], '@org/team/x']], [['codeOwner']]],
    ['codeOwner as a team', single, [[['codeOwner'], '@example-org/web.team_1']], []],
    ['codeOwner with a dot in the login', single, [[['codeOwner'], '@example.owner']], [['codeOwner']]],
    ['codeOwner with an underscore in the login', single, [[['codeOwner'], '@example_owner/team']], [['codeOwner']]],
    ['no securityContact', single, [[['securityContact'], REMOVE]], [['securityContact']]],
    [
      'securityContact as a bare address',
      single,
      [[['securityContact'], 'security@example.ch']],
      [['securityContact']],
    ],
    ['securityContact with http', single, [[['securityContact'], 'http://example.ch/security']], [['securityContact']]],
    ['securityContact as an https page', single, [[['securityContact'], 'https://example.ch/security/']], []],
    [
      'securityContact with words before the address',
      single,
      [[['securityContact'], 'see mailto:security@example.ch']],
      [['securityContact']],
    ],
    ['dependencies as a string', single, [[['dependencies'], 'sharp']], [['dependencies']]],
    ['a dependency with a space', single, [[['dependencies'], ['sharp', 'Bad Name']]], [['dependencies[1]']]],
    ['a dependency with a version', single, [[['dependencies'], ['sharp@1.0.0']]], [['dependencies[0]']]],
    ['a dependency as a git URL', single, [[['dependencies'], ['github:lovell/sharp']]], [['dependencies[0]']]],
    ['plain and scoped dependencies', single, [[['dependencies'], ['sharp', '@fontsource/inter', 'lit-html.v2']]], []],
    ['a dependency with an upper-case letter', single, [[['dependencies'], ['Sharp']]], [['dependencies[0]']]],
    ['a scope with an upper-case letter', single, [[['dependencies'], ['@Fontsource/inter']]], [['dependencies[0]']]],
    ['a dependency of 214 characters', single, [[['dependencies'], ['a'.repeat(214)]]], []],
    ['a dependency of 215 characters', single, [[['dependencies'], ['a'.repeat(215)]]], [['dependencies[0]']]],
    ['settings that are an array', () => [] as unknown as Json, [], [['']]],
  ];
  for (const { name, actual, expected } of outcomes(cases)) assert.deepEqual(actual, expected, name);
});

test('locales and defaultLocale', () => {
  const english = { code: 'en', tag: 'en', name: 'English' };
  const cases: Case[] = [
    ['two locales', two, [], []],
    ['no locales', single, [[['locales'], REMOVE]], [['locales']]],
    [
      'an empty locales list',
      single,
      [[['locales'], []]],
      [['locales'], ['defaultLocale', MESSAGES.defaultLocale], ['legal.legalNote.de'], ['legal.privacy.de']],
    ],
    [
      'a duplicate code',
      two,
      [[['locales', 1], { code: 'de', tag: 'de-DE', name: 'Deutsch (DE)' }]],
      [['locales[1].code', 'duplicate code "de"'], ['legal.legalNote.fr'], ['legal.privacy.fr']],
    ],
    ['a duplicate tag', two, [[['locales', 1, 'tag'], 'de-CH']], [['locales[1].tag', 'duplicate tag "de-CH"']]],
    [
      'a code with four letters',
      two,
      [
        [['locales', 1, 'code'], 'fran'],
        [['legal', 'legalNote'], { de: '/impressum/', fran: '/fran/mentions-legales/' }],
        [['legal', 'privacy'], { de: '/datenschutz/', fran: '/fran/protection-des-donnees/' }],
      ],
      [['locales[1].code']],
    ],
    [
      'a code in upper case',
      two,
      [
        [['locales', 1, 'code'], 'FR'],
        [['legal', 'legalNote'], { de: '/impressum/', FR: '/fr/mentions-legales/' }],
        [['legal', 'privacy'], { de: '/datenschutz/', FR: '/fr/protection-des-donnees/' }],
      ],
      [['locales[1].code'], ['legal.legalNote.FR'], ['legal.privacy.FR']],
    ],
    [
      'a code that is a reserved segment',
      two,
      [
        [['locales', 1], { code: 'api', tag: 'fr-CH', name: 'Français' }],
        [['legal', 'legalNote'], { de: '/impressum/', api: '/api/mentions-legales/' }],
        [['legal', 'privacy'], { de: '/datenschutz/', api: '/api/protection-des-donnees/' }],
      ],
      [['locales[1].code', 'a locale code must not be a reserved segment']],
    ],
    ['no code', single, [[['locales', 0, 'code'], REMOVE]], [['locales[0].code']]],
    ['a tag with an underscore', single, [[['locales', 0, 'tag'], 'de_CH']], [['locales[0].tag']]],
    ['a tag with a lower-case region', single, [[['locales', 0, 'tag'], 'de-ch']], [['locales[0].tag']]],
    ['a tag without a region', single, [[['locales', 0, 'tag'], 'de']], []],
    ['a tag with a region of three letters', single, [[['locales', 0, 'tag'], 'de-CHE']], [['locales[0].tag']]],
    ['a tag with a region of one letter', single, [[['locales', 0, 'tag'], 'de-C']], [['locales[0].tag']]],
    ['no tag', single, [[['locales', 0, 'tag'], REMOVE]], [['locales[0].tag']]],
    ['a name of one character', single, [[['locales', 0, 'name'], 'D']], [['locales[0].name']]],
    ['no name', single, [[['locales', 0, 'name'], REMOVE]], [['locales[0].name']]],
    ['an unknown coverage', single, [[['locales', 0, 'coverage'], 'some']], [['locales[0].coverage']]],
    ['partial coverage on another locale', two, [[['locales', 1, 'coverage'], 'partial']], []],
    [
      'partial coverage on the default locale',
      two,
      [[['locales', 0, 'coverage'], 'partial']],
      [['locales[0].coverage', 'the default locale must have the coverage "full"']],
    ],
    ['an unknown key in a locale', single, [[['locales', 0, 'flag'], 'ch']], [['locales[0].flag', 'unknown key']]],
    ['no defaultLocale', single, [[['defaultLocale'], REMOVE]], [['defaultLocale']]],
    [
      'a defaultLocale that is no code',
      two,
      [[['defaultLocale'], 'en']],
      [['defaultLocale', 'defaultLocale must be one of locales[].code']],
    ],
    [
      'a third locale with its legal paths',
      two,
      [
        [['locales', 2], english],
        [['legal', 'legalNote', 'en'], '/en/legal-note/'],
        [['legal', 'privacy', 'en'], '/en/privacy/'],
      ],
      [],
    ],
    [
      'the second locale as the default',
      two,
      [
        [['defaultLocale'], 'fr'],
        [['legal', 'legalNote'], { de: '/de/impressum/', fr: '/mentions-legales/' }],
        [['legal', 'privacy'], { de: '/de/datenschutz/', fr: '/protection-des-donnees/' }],
      ],
      [],
    ],
  ];
  for (const { name, actual, expected } of outcomes(cases)) assert.deepEqual(actual, expected, name);
});

test('features and prefetch', () => {
  const needs = 'features.wasm and features.workers need features.islands or features.scripts';
  const cases: Case[] = [
    ['features.forms as a string', single, [[['features', 'forms'], 'yes']], [['features.forms']]],
    ['features.islands as a number', single, [[['features', 'islands'], 1]], [['features.islands']]],
    ['features.scripts as null', single, [[['features', 'scripts'], null]], [['features.scripts']]],
    ['features.wasm as a string', single, [[['features', 'wasm'], 'true']], [['features.wasm']]],
    ['features.workers as a list', single, [[['features', 'workers'], []]], [['features.workers']]],
    ['an unknown feature', single, [[['features', 'search'], true]], [['features.search', 'unknown key']]],
    ['features as a list', single, [[['features'], ['forms']]], [['features']]],
    ['islands alone', single, [[['features', 'islands'], true]], []],
    ['scripts alone', single, [[['features', 'scripts'], true]], []],
    ['wasm alone', single, [[['features', 'wasm'], true]], [['features.wasm', needs]]],
    ['workers alone', single, [[['features', 'workers'], true]], [['features.workers', needs]]],
    [
      'wasm and workers alone',
      single,
      [[['features'], { wasm: true, workers: true }]],
      [
        ['features.wasm', needs],
        ['features.workers', needs],
      ],
    ],
    ['wasm with islands', single, [[['features'], { wasm: true, islands: true }]], []],
    ['workers with scripts', single, [[['features'], { workers: true, scripts: true }]], []],
    ['speculationRules as a number', single, [[['prefetch', 'speculationRules'], 1]], [['prefetch.speculationRules']]],
    ['astroPrefetch as a string', single, [[['prefetch', 'astroPrefetch'], 'no']], [['prefetch.astroPrefetch']]],
    [
      'an unknown prefetch key',
      single,
      [[['prefetch', 'prefetchAll'], true]],
      [['prefetch.prefetchAll', 'unknown key']],
    ],
    ['both prefetch options changed', single, [[['prefetch'], { speculationRules: false, astroPrefetch: true }]], []],
  ];
  for (const { name, actual, expected } of outcomes(cases)) assert.deepEqual(actual, expected, name);
  const options = parseOptions(
    { ...single(), prefetch: { astroPrefetch: true }, features: { scripts: true } },
    new Report(),
  );
  assert.deepEqual(options?.prefetch, { speculationRules: true, astroPrefetch: true });
  assert.deepEqual(options?.features, { forms: false, islands: false, scripts: true, wasm: false, workers: false });
});

test('modes', () => {
  const none = 'modes needs at least one option set to true';
  const contrast =
    'modes.contrast needs auto, light or dark too: design.md needs a base theme, and contrast alone never shows it';
  const auto = 'modes.default is only for modes.auto false; with auto on, auto is the default mode';
  const named = 'modes.default must name an option of modes that is true';
  const cases: Case[] = [
    ['modes.auto as a string', single, [[['modes', 'auto'], 'on']], [['modes.auto']]],
    ['modes.light as a number', single, [[['modes', 'light'], 1]], [['modes.light']]],
    ['modes.dark as null', single, [[['modes', 'dark'], null]], [['modes.dark']]],
    ['modes.contrast as a string', single, [[['modes', 'contrast'], 'more']], [['modes.contrast']]],
    [
      'modes.default with an unknown option',
      single,
      [[['modes'], { auto: false, light: true, default: 'auto' }]],
      [['modes.default']],
    ],
    ['an unknown key in modes', single, [[['modes', 'sepia'], true]], [['modes.sepia', 'unknown key']]],
    ['an empty modes object', single, [[['modes'], {}]], []],
    ['all four options on', single, [[['modes'], { auto: true, light: true, dark: true, contrast: true }]], []],
    [
      'no option on',
      single,
      [[['modes'], { auto: false }]],
      [
        ['modes', none],
        ['modes.default', named],
      ],
    ],
    [
      'no option on, with a default',
      single,
      [[['modes'], { auto: false, light: false, dark: false, contrast: false, default: 'light' }]],
      [
        ['modes', none],
        ['modes.default', named],
      ],
    ],
    [
      'contrast alone',
      single,
      [[['modes'], { auto: false, contrast: true, default: 'contrast' }]],
      [['modes.contrast', contrast]],
    ],
    ['contrast with dark', single, [[['modes'], { auto: false, dark: true, contrast: true, default: 'contrast' }]], []],
    ['contrast with auto', single, [[['modes'], { contrast: true }]], []],
    [
      'a default with auto on',
      single,
      [[['modes'], { auto: true, light: true, default: 'light' }]],
      [['modes.default', auto]],
    ],
    ['no default with auto off', single, [[['modes'], { auto: false, light: true }]], [['modes.default', named]]],
    [
      'a default that names an option that is off',
      single,
      [[['modes'], { auto: false, light: true, default: 'dark' }]],
      [['modes.default', named]],
    ],
    [
      'a default that names an option that is on',
      single,
      [[['modes'], { auto: false, light: true, default: 'light' }]],
      [],
    ],
    [
      'dark as the default of two',
      single,
      [[['modes'], { auto: false, light: true, dark: true, default: 'dark' }]],
      [],
    ],
  ];
  for (const { name, actual, expected } of outcomes(cases)) assert.deepEqual(actual, expected, name);
  const options = parseOptions({ ...single(), modes: { auto: false, dark: true, default: 'dark' } }, new Report());
  assert.deepEqual(options?.modes, { auto: false, light: false, dark: true, contrast: false, default: 'dark' });
});

test('contact and the forms record', () => {
  const field = { name: 'message', type: 'textarea' };
  const many = (count: number): Json =>
    Object.fromEntries(Array.from({ length: count }, (_, index) => [`form-${index}`, { fields: [field] }]));
  const cases: Case[] = [
    ['forms with contact and one form', forms, [], []],
    [
      'forms without contact',
      forms,
      [[['contact'], REMOVE]],
      [['contact', 'features.forms needs contact.to and contact.from']],
    ],
    [
      'contact without forms',
      single,
      [[['contact'], { to: 'info@example.ch', from: 'form@example.ch' }]],
      [['contact', 'contact must be absent without features.forms']],
    ],
    [
      'a form without the feature',
      single,
      [[['forms'], { contact: { fields: [field] } }]],
      [['forms', 'forms must be absent without features.forms']],
    ],
    ['no contact.to', forms, [[['contact', 'to'], REMOVE]], [['contact.to']]],
    ['contact.to without a domain', forms, [[['contact', 'to'], 'info@example']], [['contact.to']]],
    ['no contact.from', forms, [[['contact', 'from'], REMOVE]], [['contact.from']]],
    ['contact.from with a space', forms, [[['contact', 'from'], 'form @example.ch']], [['contact.from']]],
    ['contact.probe without @', forms, [[['contact', 'probe'], 'probe.example.ch']], [['contact.probe']]],
    ['contact.probe as an address', forms, [[['contact', 'probe'], 'probe@example.ch']], []],
    ['an unknown key in contact', forms, [[['contact', 'cc'], 'cc@example.ch']], [['contact.cc', 'unknown key']]],
    [
      'a form id in upper case',
      forms,
      [[['forms', 'Contact'], { fields: [field] }]],
      [['forms.Contact', 'a form id must match ^[a-z][a-z0-9-]{0,31}$']],
    ],
    ['a form id that starts with a digit', forms, [[['forms', '1st'], { fields: [field] }]], [['forms.1st']]],
    ['a form id with an underscore', forms, [[['forms', 'job_offer'], { fields: [field] }]], [['forms.job_offer']]],
    ['a form id of 33 characters', forms, [[['forms', `a${text(32)}`], { fields: [field] }]], [[`forms.a${text(32)}`]]],
    ['a form id of 32 characters', forms, [[['forms', `a${text(31)}`], { fields: [field] }]], []],
    ['no form in the record', forms, [[['forms'], {}]], [['forms', 'declare 1 to 10 forms']]],
    ['eleven forms', forms, [[['forms'], many(11)]], [['forms', 'declare 1 to 10 forms']]],
    ['ten forms', forms, [[['forms'], many(10)]], []],
    [
      'a form recipient without a domain',
      forms,
      [[['forms', 'contact', 'to'], 'jobs@example']],
      [['forms.contact.to']],
    ],
    ['a form without fields', forms, [[['forms', 'contact', 'fields'], REMOVE]], [['forms.contact.fields']]],
    ['a form with an empty field list', forms, [[['forms', 'contact', 'fields'], []]], [['forms.contact.fields']]],
    [
      'a form with 21 fields',
      forms,
      [
        [
          ['forms', 'contact', 'fields'],
          Array.from({ length: 21 }, (_, index) => ({ name: `f${index}`, type: 'text' })),
        ],
      ],
      [['forms.contact.fields']],
    ],
    [
      'a form with 20 fields',
      forms,
      [
        [
          ['forms', 'contact', 'fields'],
          Array.from({ length: 20 }, (_, index) => ({ name: `f${index}`, type: 'text' })),
        ],
      ],
      [],
    ],
    [
      'two fields with one name',
      forms,
      [
        [
          ['forms', 'contact', 'fields'],
          [field, { name: 'message', type: 'text' }],
        ],
      ],
      [['forms.contact.fields[1].name', 'duplicate name "message"']],
    ],
    [
      'an unknown key in a form',
      forms,
      [[['forms', 'contact', 'subject'], 'Hello']],
      [['forms.contact.subject', 'unknown key']],
    ],
  ];
  for (const { name, actual, expected } of outcomes(cases)) assert.deepEqual(actual, expected, name);
});

test('the fields of a form', () => {
  const at = (key: string): Key[] => ['forms', 'contact', 'fields', 0, key];
  const one = (field: Json): Edit[] => [[['forms', 'contact', 'fields'], [field]]];
  const reserved = 'the names return, website, form and mode are reserved';
  const cases: Case[] = [
    ['no name', forms, [[at('name'), REMOVE]], [['forms.contact.fields[0].name']]],
    ['a name in upper case', forms, [[at('name'), 'Message']], [['forms.contact.fields[0].name']]],
    ['a name with a hyphen', forms, [[at('name'), 'first-name']], [['forms.contact.fields[0].name']]],
    ['a name of 33 characters', forms, [[at('name'), `a${text(32)}`]], [['forms.contact.fields[0].name']]],
    ['a name with an underscore and a digit', forms, [[at('name'), 'first_name_2']], []],
    ['the reserved name return', forms, [[at('name'), 'return']], [['forms.contact.fields[0].name', reserved]]],
    ['the reserved name website', forms, [[at('name'), 'website']], [['forms.contact.fields[0].name', reserved]]],
    ['the reserved name form', forms, [[at('name'), 'form']], [['forms.contact.fields[0].name', reserved]]],
    ['the reserved name mode', forms, [[at('name'), 'mode']], [['forms.contact.fields[0].name', reserved]]],
    ['no type', forms, [[at('type'), REMOVE]], [['forms.contact.fields[0].type']]],
    ['an unknown type', forms, [[at('type'), 'file']], [['forms.contact.fields[0].type']]],
    ['required as a string', forms, [[at('required'), 'yes']], [['forms.contact.fields[0].required']]],
    ['an optional field', forms, [[at('required'), false]], []],
    [
      'an optional consent',
      forms,
      one({ name: 'terms', type: 'consent', required: false }),
      [['forms.contact.fields[0].required', 'a consent field is always required']],
    ],
    ['a required consent', forms, one({ name: 'terms', type: 'consent', required: true }), []],
    ['maxLength 0', forms, [[at('maxLength'), 0]], [['forms.contact.fields[0].maxLength']]],
    ['maxLength 5001', forms, [[at('maxLength'), 5001]], [['forms.contact.fields[0].maxLength']]],
    ['maxLength 1.5', forms, [[at('maxLength'), 1.5]], [['forms.contact.fields[0].maxLength']]],
    ['maxLength as a string', forms, [[at('maxLength'), '100']], [['forms.contact.fields[0].maxLength']]],
    [
      'maxLength 1 and 5000',
      forms,
      [
        [
          ['forms', 'contact', 'fields'],
          [
            { name: 'a', type: 'text', maxLength: 1 },
            { name: 'b', type: 'tel', maxLength: 5000 },
          ],
        ],
      ],
      [],
    ],
    [
      'maxLength on a date',
      forms,
      one({ name: 'arrival', type: 'date', maxLength: 10 }),
      [['forms.contact.fields[0].maxLength', 'maxLength is only for the types text, textarea, email and tel']],
    ],
    [
      'maxLength on a number',
      forms,
      one({ name: 'nights', type: 'number', min: 1, max: 14, maxLength: 2 }),
      [['forms.contact.fields[0].maxLength']],
    ],
    [
      'maxLength on a choice',
      forms,
      one({ name: 'room', type: 'choice', options: ['a', 'b'], maxLength: 2 }),
      [['forms.contact.fields[0].maxLength']],
    ],
    [
      'maxLength on a consent',
      forms,
      one({ name: 'terms', type: 'consent', maxLength: 2 }),
      [['forms.contact.fields[0].maxLength']],
    ],
    ['a number with min and max', forms, one({ name: 'nights', type: 'number', min: 1, max: 14 }), []],
    [
      'a number with a fraction and a negative value',
      forms,
      one({ name: 'delta', type: 'number', min: -1.5, max: 0 }),
      [],
    ],
    [
      'a number without min',
      forms,
      one({ name: 'nights', type: 'number', max: 14 }),
      [['forms.contact.fields[0].min', 'a number field needs min']],
    ],
    [
      'a number without max',
      forms,
      one({ name: 'nights', type: 'number', min: 1 }),
      [['forms.contact.fields[0].max', 'a number field needs max']],
    ],
    [
      'a number with a text as min',
      forms,
      one({ name: 'nights', type: 'number', min: '1', max: 14 }),
      [['forms.contact.fields[0].min', 'min of a number field must be a number']],
    ],
    ['a date without a range', forms, one({ name: 'arrival', type: 'date' }), []],
    ['a date with only min', forms, one({ name: 'arrival', type: 'date', min: '2026-01-01' }), []],
    [
      'a date with a day that does not exist',
      forms,
      one({ name: 'arrival', type: 'date', min: '2026-02-30' }),
      [['forms.contact.fields[0].min', 'min of a date field must be a real date YYYY-MM-DD']],
    ],
    [
      'a date with a number as max',
      forms,
      one({ name: 'arrival', type: 'date', max: 20270101 }),
      [['forms.contact.fields[0].max']],
    ],
    [
      'a date with a time in max',
      forms,
      one({ name: 'arrival', type: 'date', max: '2027-01-01T00:00' }),
      [['forms.contact.fields[0].max']],
    ],
    ['min as a boolean', forms, one({ name: 'arrival', type: 'date', min: true }), [['forms.contact.fields[0].min']]],
    [
      'a text with min',
      forms,
      one({ name: 'name', type: 'text', min: 2 }),
      [['forms.contact.fields[0].min', 'min is only for the types number and date']],
    ],
    [
      'a choice with max',
      forms,
      one({ name: 'room', type: 'choice', options: ['a', 'b'], max: 2 }),
      [['forms.contact.fields[0].max']],
    ],
    ['a choice with two options', forms, one({ name: 'room', type: 'choice', options: ['single', 'double'] }), []],
    [
      'a choice without options',
      forms,
      one({ name: 'room', type: 'choice' }),
      [['forms.contact.fields[0].options', 'a choice field needs options']],
    ],
    [
      'a choice with one option',
      forms,
      one({ name: 'room', type: 'choice', options: ['single'] }),
      [['forms.contact.fields[0].options']],
    ],
    [
      'a choice with 21 options',
      forms,
      one({ name: 'room', type: 'choice', options: Array.from({ length: 21 }, (_, index) => `o${index}`) }),
      [['forms.contact.fields[0].options']],
    ],
    [
      'a choice with 20 options',
      forms,
      one({ name: 'room', type: 'choice', options: Array.from({ length: 20 }, (_, index) => `o${index}`) }),
      [],
    ],
    [
      'an option in upper case',
      forms,
      one({ name: 'room', type: 'choice', options: ['Single', 'double'] }),
      [['forms.contact.fields[0].options[0]']],
    ],
    [
      'an option that starts with a hyphen',
      forms,
      one({ name: 'room', type: 'choice', options: ['single', '-double'] }),
      [['forms.contact.fields[0].options[1]']],
    ],
    [
      'an option of 41 characters',
      forms,
      one({ name: 'room', type: 'choice', options: ['single', text(41)] }),
      [['forms.contact.fields[0].options[1]']],
    ],
    ['an option of 40 characters', forms, one({ name: 'room', type: 'choice', options: ['single', text(40)] }), []],
    [
      'a text with options',
      forms,
      one({ name: 'name', type: 'text', options: ['a', 'b'] }),
      [['forms.contact.fields[0].options', 'options is only for the type choice']],
    ],
    ['autocomplete as a number', forms, [[at('autocomplete'), 1]], [['forms.contact.fields[0].autocomplete']]],
    ['autocomplete as a token', forms, [[at('autocomplete'), 'street-address']], []],
    [
      'an unknown key in a field',
      forms,
      [[at('label'), 'Message']],
      [['forms.contact.fields[0].label', 'unknown key']],
    ],
  ];
  for (const { name, actual, expected } of outcomes(cases)) assert.deepEqual(actual, expected, name);
});

test('legal paths', () => {
  const cases: Case[] = [
    ['no legal', single, [[['legal'], REMOVE]], [['legal']]],
    ['no legalNote', single, [[['legal', 'legalNote'], REMOVE]], [['legal.legalNote']]],
    ['no privacy', single, [[['legal', 'privacy'], REMOVE]], [['legal.privacy']]],
    ['an unknown key in legal', single, [[['legal', 'terms'], { de: '/agb/' }]], [['legal.terms', 'unknown key']]],
    [
      'a legal note that misses a locale',
      two,
      [[['legal', 'legalNote', 'fr'], REMOVE]],
      [['legal.legalNote.fr', 'the locale fr needs a path']],
    ],
    ['a privacy page that misses a locale', two, [[['legal', 'privacy', 'fr'], REMOVE]], [['legal.privacy.fr']]],
    ['an empty legal note record', single, [[['legal', 'legalNote'], {}]], [['legal.legalNote.de']]],
    [
      'a legal note for a locale that is not declared',
      single,
      [[['legal', 'legalNote', 'it'], '/it/note-legali/']],
      [['legal.legalNote.it', 'it is not one of locales[].code']],
    ],
    [
      'a privacy page for a locale that is not declared',
      single,
      [[['legal', 'privacy', 'it'], '/it/privacy/']],
      [['legal.privacy.it']],
    ],
    [
      'a path without the first slash',
      single,
      [[['legal', 'legalNote', 'de'], 'impressum/']],
      [['legal.legalNote.de']],
    ],
    ['a path without the last slash', single, [[['legal', 'legalNote', 'de'], '/impressum']], [['legal.legalNote.de']]],
    ['a path in upper case', single, [[['legal', 'privacy', 'de'], '/Datenschutz/']], [['legal.privacy.de']]],
    ['a path with a double hyphen', single, [[['legal', 'privacy', 'de'], '/daten--schutz/']], [['legal.privacy.de']]],
    [
      'a path that is a URL',
      single,
      [[['legal', 'privacy', 'de'], 'https://example.ch/datenschutz/']],
      [['legal.privacy.de']],
    ],
    ['a path as a number', single, [[['legal', 'privacy', 'de'], 1]], [['legal.privacy.de']]],
    ['a nested path', single, [[['legal', 'privacy', 'de'], '/rechtliches/datenschutz/']], []],
    [
      'a legal note of another locale without its prefix',
      two,
      [[['legal', 'legalNote', 'fr'], '/mentions-legales/']],
      [['legal.legalNote.fr', 'a path of the locale fr must start with /fr/']],
    ],
    [
      'a privacy page of another locale with a wrong prefix',
      two,
      [[['legal', 'privacy', 'fr'], '/fra/protection-des-donnees/']],
      [['legal.privacy.fr', 'a path of the locale fr must start with /fr/']],
    ],
    [
      'an accessibility page for one of two locales',
      two,
      [[['legal', 'accessibility'], { fr: '/fr/accessibilite/' }]],
      [],
    ],
    [
      'an accessibility page for each locale',
      two,
      [[['legal', 'accessibility'], { de: '/barrierefreiheit/', fr: '/fr/accessibilite/' }]],
      [],
    ],
    ['an empty accessibility record', two, [[['legal', 'accessibility'], {}]], []],
    [
      'a legal note of the default locale under the code of another locale',
      two,
      [[['legal', 'legalNote', 'de'], '/fr/impressum/']],
      [['legal.legalNote.de', 'a path of the default locale de must not start with a locale code']],
    ],
    [
      'a privacy page of the default locale under its own code',
      two,
      [[['legal', 'privacy', 'de'], '/de/datenschutz/']],
      [['legal.privacy.de', 'a path of the default locale de must not start with a locale code']],
    ],
    [
      'an accessibility page of the default locale under a locale code',
      two,
      [[['legal', 'accessibility'], { de: '/fr/barrierefreiheit/' }]],
      [['legal.accessibility.de', 'a path of the default locale de must not start with a locale code']],
    ],
    [
      'a default-locale path that only starts like a code',
      two,
      [[['legal', 'legalNote', 'de'], '/frau/impressum/']],
      [],
    ],
    ['a default-locale path with a code in a later segment', two, [[['legal', 'legalNote', 'de'], '/info/fr/']], []],
    ['the home page as a legal note of the default locale', two, [[['legal', 'legalNote', 'de'], '/']], []],
    [
      'an accessibility page for a locale that is not declared',
      two,
      [[['legal', 'accessibility'], { it: '/it/accessibilita/' }]],
      [['legal.accessibility.it', 'it is not one of locales[].code']],
    ],
    [
      'an accessibility page without its prefix',
      two,
      [[['legal', 'accessibility'], { fr: '/accessibilite/' }]],
      [['legal.accessibility.fr', 'a path of the locale fr must start with /fr/']],
    ],
    [
      'an accessibility path without the last slash',
      two,
      [[['legal', 'accessibility'], { de: '/barrierefreiheit' }]],
      [['legal.accessibility.de']],
    ],
  ];
  for (const { name, actual, expected } of outcomes(cases)) assert.deepEqual(actual, expected, name);
});

test('processing', () => {
  const cases: Case[] = [
    ['the two keys of a static site', single, [[['processing'], ['cdn', 'previews']]], []],
    ['an empty list', single, [[['processing'], []]], []],
    ['an unknown key', single, [[['processing'], ['cdn', 'previews', 'analytics']]], [['processing[2]']]],
    [
      'a key twice',
      single,
      [[['processing'], ['cdn', 'previews', 'cdn']]],
      [['processing[2]', 'duplicate value "cdn"']],
    ],
    ['a string', single, [[['processing'], 'cdn']], [['processing']]],
  ];
  for (const { name, actual, expected } of outcomes(cases)) assert.deepEqual(actual, expected, name);
});

test('origins', () => {
  const at = (key: string): Key[] => ['origins', 0, key];
  const map = {
    host: 'www.openstreetmap.org',
    directives: ['frame'],
    purpose: 'Map',
    processor: 'OpenStreetMap Foundation',
  };
  const gesture =
    'a gesture origin needs features.scripts or features.islands: a script adds the frame, the script or the request after the click';
  const cases: Case[] = [
    ['one origin that loads with the page', origin, [], []],
    ['origins as an object', single, [[['origins'], {}]], [['origins']]],
    [
      'eleven origins',
      single,
      [
        [
          ['origins'],
          Array.from({ length: 11 }, (_, index) => ({ ...map, host: `h${index}.example.org`, load: 'page' })),
        ],
      ],
      [['origins']],
    ],
    [
      'ten origins',
      single,
      [
        [
          ['origins'],
          Array.from({ length: 10 }, (_, index) => ({ ...map, host: `h${index}.example.org`, load: 'page' })),
        ],
      ],
      [],
    ],
    [
      'one host twice',
      origin,
      [
        [
          ['origins', 1],
          {
            host: 'js.stripe.com',
            directives: ['script'],
            load: 'page',
            purpose: 'Payment',
            processor: 'Stripe, Inc.',
          },
        ],
      ],
      [['origins[1].host', 'duplicate host "js.stripe.com"']],
    ],
    ['no host', origin, [[at('host'), REMOVE]], [['origins[0].host']]],
    ['a host with a scheme', origin, [[at('host'), 'https://js.stripe.com']], [['origins[0].host']]],
    ['a host with a wildcard', origin, [[at('host'), '*.stripe.com']], [['origins[0].host']]],
    ['a host with one label', origin, [[at('host'), 'localhost']], [['origins[0].host']]],
    ['a host in upper case', origin, [[at('host'), 'JS.stripe.com']], [['origins[0].host']]],
    ['a host with a path', origin, [[at('host'), 'js.stripe.com/v3']], [['origins[0].host']]],
    ['a host with a port', origin, [[at('host'), 'js.stripe.com:443']], [['origins[0].host']]],
    ['a label that ends with a hyphen', origin, [[at('host'), 'js-.stripe.com']], [['origins[0].host']]],
    [
      'the host of the site',
      origin,
      [[at('host'), 'example.ch']],
      [['origins[0].host', 'an origin must not be the host of site']],
    ],
    ['a subdomain of the site', origin, [[at('host'), 'shop.example.ch']], []],
    ['no directives', origin, [[at('directives'), REMOVE]], [['origins[0].directives']]],
    ['an empty directives list', origin, [[at('directives'), []]], [['origins[0].directives']]],
    ['an unknown directive', origin, [[at('directives'), ['img']]], [['origins[0].directives[0]']]],
    [
      'a directive twice',
      origin,
      [[at('directives'), ['frame', 'frame']]],
      [['origins[0].directives[1]', 'duplicate value "frame"']],
    ],
    [
      'five directives',
      origin,
      [[at('directives'), ['connect', 'frame', 'script', 'form', 'connect']]],
      [['origins[0].directives']],
    ],
    ['all four directives', origin, [[at('directives'), ['connect', 'frame', 'script', 'form']]], []],
    ['an unknown load', origin, [[at('load'), 'click']], [['origins[0].load']]],
    ['an unknown browser feature', origin, [[at('allow'), ['camera']]], [['origins[0].allow[0]']]],
    [
      'a browser feature twice',
      origin,
      [[at('allow'), ['payment', 'payment']]],
      [['origins[0].allow[1]', 'duplicate value "payment"']],
    ],
    [
      'all four browser features on a frame',
      origin,
      [[at('allow'), ['payment', 'fullscreen', 'autoplay', 'geolocation']]],
      [],
    ],
    [
      'allow without the frame directive',
      origin,
      [
        [at('directives'), ['script']],
        [at('allow'), ['payment']],
      ],
      [['origins[0].allow', 'origins[].allow needs the frame directive']],
    ],
    [
      'an empty allow without the frame directive',
      origin,
      [
        [at('directives'), ['script']],
        [at('allow'), []],
      ],
      [],
    ],
    ['no purpose', origin, [[at('purpose'), REMOVE]], [['origins[0].purpose']]],
    ['a purpose of 2 characters', origin, [[at('purpose'), 'ab']], [['origins[0].purpose']]],
    ['a purpose of 121 characters', origin, [[at('purpose'), text(121)]], [['origins[0].purpose']]],
    [
      'a purpose of 3 and of 120 characters',
      origin,
      [
        [at('purpose'), 'Map'],
        [['origins', 1], { ...map, load: 'page', purpose: text(120) }],
      ],
      [],
    ],
    ['no processor', origin, [[at('processor'), REMOVE]], [['origins[0].processor']]],
    ['a processor of 1 character', origin, [[at('processor'), 'S']], [['origins[0].processor']]],
    ['a processor of 81 characters', origin, [[at('processor'), text(81)]], [['origins[0].processor']]],
    [
      'a processor of 2 and of 80 characters',
      origin,
      [
        [at('processor'), 'SA'],
        [['origins', 1], { ...map, load: 'page', processor: text(80) }],
      ],
      [],
    ],
    ['an unknown key in an origin', origin, [[at('consent'), true]], [['origins[0].consent', 'unknown key']]],
    [
      'a gesture origin without scripts and islands',
      single,
      [[['origins'], [{ ...map, load: 'gesture' }]]],
      [['origins[0].load', gesture]],
    ],
    ['load defaults to gesture', single, [[['origins'], [map]]], [['origins[0].load', gesture]]],
    [
      'a gesture origin with scripts',
      single,
      [
        [['origins'], [map]],
        [['features', 'scripts'], true],
      ],
      [],
    ],
    [
      'a gesture origin with islands',
      single,
      [
        [['origins'], [map]],
        [['features', 'islands'], true],
      ],
      [],
    ],
    ['a gesture origin with only the form directive', single, [[['origins'], [{ ...map, directives: ['form'] }]]], []],
    [
      'a gesture origin with form and connect',
      single,
      [[['origins'], [{ ...map, directives: ['form', 'connect'] }]]],
      [['origins[0].load', gesture]],
    ],
  ];
  for (const { name, actual, expected } of outcomes(cases)) assert.deepEqual(actual, expected, name);
  const options = parseOptions({ ...single(), origins: [map], features: { scripts: true } }, new Report());
  assert.deepEqual(options?.origins, [{ ...map, load: 'gesture', allow: [] }]);
});

test('waivers: the shape of an entry', () => {
  const at = (key: string): Key[] => ['waivers', 0, key];
  const entry = { rule: 'head-title', where: '/jobs/', reason: 'The client wants this title', until: '2026-12-31' };
  const cases: Case[] = [
    ['one waiver', waiver, [], []],
    ['waivers as an object', single, [[['waivers'], {}]], [['waivers']]],
    ['six waivers', single, [[['waivers'], Array.from({ length: 6 }, () => entry)]], [['waivers']]],
    ['five waivers', single, [[['waivers'], Array.from({ length: 5 }, () => entry)]], []],
    ['no rule', waiver, [[at('rule'), REMOVE]], [['waivers[0].rule']]],
    ['a rule in upper case', waiver, [[at('rule'), 'Head-Title']], [['waivers[0].rule']]],
    ['a rule with a wildcard', waiver, [[at('rule'), 'budget-*']], [['waivers[0].rule']]],
    ['a rule that the schema cannot judge', waiver, [[at('rule'), 'config-shim']], []],
    ['no where', waiver, [[at('where'), REMOVE]], [['waivers[0].where']]],
    ['an empty where', waiver, [[at('where'), '']], [['waivers[0].where']]],
    ['a where of 201 characters', waiver, [[at('where'), text(201)]], [['waivers[0].where']]],
    ['a where of 200 characters', waiver, [[at('where'), text(200)]], []],
    ['no reason', waiver, [[at('reason'), REMOVE]], [['waivers[0].reason']]],
    ['a reason of 9 characters', waiver, [[at('reason'), text(9)]], [['waivers[0].reason']]],
    ['a reason of 201 characters', waiver, [[at('reason'), text(201)]], [['waivers[0].reason']]],
    ['a reason of 10 characters', waiver, [[at('reason'), text(10)]], []],
    ['no until', waiver, [[at('until'), REMOVE]], [['waivers[0].until']]],
    [
      'an until with a short year',
      waiver,
      [[at('until'), '26-12-31']],
      [['waivers[0].until', 'until must be a real date YYYY-MM-DD']],
    ],
    ['an until with a time', waiver, [[at('until'), '2026-12-31T00:00:00Z']], [['waivers[0].until']]],
    [
      'an until on a day that does not exist',
      waiver,
      [[at('until'), '2026-02-30']],
      [['waivers[0].until', 'until must be a real date YYYY-MM-DD']],
    ],
    ['an until in month 13', waiver, [[at('until'), '2026-13-01']], [['waivers[0].until']]],
    ['an until on a leap day', waiver, [[at('until'), '2028-02-29']], []],
    ['an unknown key in a waiver', waiver, [[at('page'), '/jobs/']], [['waivers[0].page', 'unknown key']]],
  ];
  for (const { name, actual, expected } of outcomes(cases)) assert.deepEqual(actual, expected, name);
});

test('limits: a site may only lower a limit', () => {
  const cases: Case[] = [
    ['an empty limits object', single, [[['limits'], {}]], []],
    [
      'each limit at its value',
      single,
      [[['limits'], { headBytes: 14336, documentBytes: 30720, domElements: 1400 }]],
      [],
    ],
    ['each limit lowered', single, [[['limits'], { headBytes: 10000, documentBytes: 20000, domElements: 800 }]], []],
    [
      'a looser headBytes',
      single,
      [[['limits', 'headBytes'], 14337]],
      [['limits.headBytes', 'a site can only lower this limit: at most 14336']],
    ],
    [
      'a looser documentBytes',
      single,
      [[['limits', 'documentBytes'], 30721]],
      [['limits.documentBytes', 'a site can only lower this limit: at most 30720']],
    ],
    [
      'a looser domElements',
      single,
      [[['limits', 'domElements'], 1401]],
      [['limits.domElements', 'a site can only lower this limit: at most 1400']],
    ],
    ['headBytes 0', single, [[['limits', 'headBytes'], 0]], [['limits.headBytes']]],
    ['documentBytes below 0', single, [[['limits', 'documentBytes'], -1]], [['limits.documentBytes']]],
    ['domElements with a fraction', single, [[['limits', 'domElements'], 800.5]], [['limits.domElements']]],
    ['headBytes as a string', single, [[['limits', 'headBytes'], '10000']], [['limits.headBytes']]],
    ['a limit that a site cannot change', single, [[['limits', 'domDepth'], 16]], [['limits.domDepth', 'unknown key']]],
  ];
  for (const { name, actual, expected } of outcomes(cases)) assert.deepEqual(actual, expected, name);
});

test('effectiveLimits takes the lowered limits and keeps every other limit', () => {
  const lowered = parseOptions({ ...single(), limits: { headBytes: 10000, domElements: 800 } }, new Report());
  assert.ok(lowered);
  assert.deepEqual(effectiveLimits(lowered), { ...LIMITS, headBytes: 10000, domElements: 800 });
  const plain = parseOptions(single(), new Report());
  assert.ok(plain);
  assert.deepEqual(effectiveLimits(plain), LIMITS);
  // A looser value never reaches a check, also when the schema did not run.
  assert.deepEqual(effectiveLimits({ limits: { headBytes: 99999, documentBytes: 99999, domElements: 99999 } }), LIMITS);
});

test('one run reports every finding', () => {
  const value = two();
  put(value, ['site'], 'http://example.ch');
  put(value, ['codeOwner'], 'owner');
  put(value, ['locales', 1, 'tag'], 'fr_CH');
  put(value, ['defaultLocale'], 'en');
  put(value, ['modes'], { auto: true, default: 'dark' });
  put(value, ['features'], { workers: true });
  put(value, ['securityContact'], 'security');
  put(value, ['limits'], { headBytes: 20000 });
  const report = new Report();
  assert.equal(parseOptions(value, report), undefined);
  assert.deepEqual(report.findings.map((finding) => finding.where).sort(), [
    'astro-kit.json: codeOwner',
    'astro-kit.json: defaultLocale',
    'astro-kit.json: features.workers',
    'astro-kit.json: limits.headBytes',
    'astro-kit.json: locales[1].tag',
    'astro-kit.json: modes.default',
    'astro-kit.json: securityContact',
    'astro-kit.json: site',
  ]);
  assert.deepEqual([...report.ids()], ['config-options']);
});

test('the cross-field messages are the texts of 5.2', () => {
  assert.deepEqual(MESSAGES, {
    defaultLocale: 'defaultLocale must be one of locales[].code',
    formsContact: 'features.forms needs contact.to and contact.from',
    modesNone: 'modes needs at least one option set to true',
    modesContrast:
      'modes.contrast needs auto, light or dark too: design.md needs a base theme, and contrast alone never shows it',
    modesDefaultAuto: 'modes.default is only for modes.auto false; with auto on, auto is the default mode',
    modesDefault: 'modes.default must name an option of modes that is true',
    wasmWorkers: 'features.wasm and features.workers need features.islands or features.scripts',
    originAllow: 'origins[].allow needs the frame directive',
    originGesture:
      'a gesture origin needs features.scripts or features.islands: a script adds the frame, the script or the request after the click',
  });
});

test('the schema gives a JSON Schema of its input for the settings page', () => {
  const schema = z.toJSONSchema(optionsSchema, { io: 'input', unrepresentable: 'any' });
  assert.equal(schema.type, 'object');
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(schema.required, ['site', 'codeOwner', 'locales', 'defaultLocale', 'legal', 'securityContact']);
  assert.deepEqual(Object.keys(schema.properties ?? {}), [
    '$schema',
    'site',
    'codeOwner',
    'locales',
    'defaultLocale',
    'features',
    'prefetch',
    'modes',
    'contact',
    'forms',
    'legal',
    'processing',
    'securityContact',
    'dependencies',
    'origins',
    'waivers',
    'limits',
  ]);
});

test('the key __proto__ is an unknown key in every record and object of the settings', () => {
  // JSON.parse gives the key as an own property. The zod record parser drops it without an issue.
  const withKey = (base: () => Json, path: readonly string[], value: unknown): unknown => {
    const marked = base();
    put(marked, [...path, 'PROTO'], value);
    return JSON.parse(JSON.stringify(marked).replace('"PROTO"', '"__proto__"'));
  };
  const form = { fields: [{ name: 'message', type: 'textarea' }] };
  const cases: [name: string, value: unknown, place: string][] = [
    ['legal.legalNote', withKey(two, ['legal', 'legalNote'], '/x/'), 'legal.legalNote.__proto__'],
    ['legal.privacy', withKey(two, ['legal', 'privacy'], 12345), 'legal.privacy.__proto__'],
    ['legal.accessibility', withKey(two, ['legal', 'accessibility'], '/x/'), 'legal.accessibility.__proto__'],
    ['forms, with a valid form', withKey(forms, ['forms'], form), 'forms.__proto__'],
    ['forms, with a value that is no form', withKey(forms, ['forms'], { fields: 'junk', x: 1 }), 'forms.__proto__'],
    ['the file', withKey(single, [], 1), '__proto__'],
    ['features', withKey(single, ['features'], true), 'features.__proto__'],
    ['a locale', withKey(single, ['locales', '0'], 'x'), 'locales[0].__proto__'],
  ];
  const seen = cases.map(([name, value]) => {
    const report = new Report();
    const options = parseOptions(value, report);
    return {
      name,
      findings: report.findings.map((finding) => [finding.rule, finding.where, finding.detail]),
      valid: options !== undefined,
    };
  });
  assert.deepEqual(
    seen,
    cases.map(([name, , path]) => ({
      name,
      findings: [['config-options', `astro-kit.json: ${path}`, 'unknown key']],
      valid: false,
    })),
  );
  assert.deepEqual(hiddenKeys(JSON.parse('{"a": {"__proto__": 1}, "b": {"c": {"__proto__": 2}}}'), ['*', 'c']), [
    ['b', 'c', '__proto__'],
  ]);
  assert.deepEqual(hiddenKeys(JSON.parse('{"a": [{"__proto__": 1}], "b": "x"}'), ['a']), []);
});

test('a field path reads like the settings', () => {
  const cases: [PropertyKey[], string][] = [
    [[], ''],
    [['site'], 'site'],
    [['locales', 1, 'code'], 'locales[1].code'],
    [['forms', 'contact', 'fields', 0, 'name'], 'forms.contact.fields[0].name'],
    [['legal', 'privacy', 'fr'], 'legal.privacy.fr'],
    [['origins', 0, 'directives', 2], 'origins[0].directives[2]'],
    [[0, 'from'], '[0].from'],
    [['forms', 'contact-us', 'to'], 'forms.contact-us.to'],
    [['dependencies', '@astrojs/cloudflare'], 'dependencies.@astrojs/cloudflare'],
    // A key that is not plain stands in brackets.
    [['documents', 'leitfaden.pdf'], 'documents["leitfaden.pdf"]'],
    [['de', 'banned', ''], 'de.banned[""]'],
    [['de', 'banned', 'zu Fuss', 0], 'de.banned["zu Fuss"][0]'],
    [['a"b', 'c[0]'], '["a\\"b"]["c[0]"]'],
  ];
  for (const [path, expected] of cases) assert.equal(fieldPath(path), expected, expected);
  assert.equal(fieldPlace('site.json', []), 'site.json');
  assert.equal(fieldPlace('site.json', ['address', 'country']), 'site.json: address.country');
  assert.equal(fieldPlace('redirects.json', [3, 'to']), 'redirects.json: [3].to');
});

test('reportIssues gives one finding for each issue and for each unknown key, under the given rule and file', () => {
  const schema = z.strictObject({ name: z.string().min(1), days: z.array(z.enum(['Mo', 'Tu'])) });
  const parsed = schema.safeParse({ name: '', days: ['Mo', 'Xx'], a: 1, b: 2 });
  assert.equal(parsed.success, false);
  const report = new Report();
  reportIssues(report, 'facts-schedule', 'schedule.json', parsed.error?.issues ?? []);
  assert.deepEqual(report.findings.map((finding) => finding.where).sort(), [
    'schedule.json: a',
    'schedule.json: b',
    'schedule.json: days[1]',
    'schedule.json: name',
  ]);
  assert.deepEqual([...report.ids()], ['facts-schedule']);
});

test('the mail pattern and the date check', () => {
  assert.equal(EMAIL.source, '^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$');
  const dates: [string, boolean][] = [
    ['2026-01-01', true],
    ['2028-02-29', true],
    ['2026-02-29', false],
    ['2026-04-31', false],
    ['2026-00-10', false],
    ['2026-1-1', false],
    ['01.01.2026', false],
    ['2026-01-01 ', false],
    ['', false],
  ];
  for (const [value, expected] of dates) assert.equal(isRealDate(value), expected, JSON.stringify(value));
});

test('loadOptions reads astro-kit.json: a missing file, a broken file, a wrong file and a good file', () => {
  const root = mkdtempSync(join(tmpdir(), 'astro-kit-'));
  try {
    const missing = new Report();
    assert.equal(loadOptions(root, missing), undefined);
    assert.deepEqual(missing.findings, [
      { rule: 'config-options', where: 'astro-kit.json', detail: 'the file is missing' },
    ]);
    assert.deepEqual(readJson(root, OPTIONS_FILE), { state: 'missing' });

    writeFileSync(join(root, OPTIONS_FILE), '{ "site": ');
    const broken = new Report();
    assert.equal(loadOptions(root, broken), undefined);
    assert.deepEqual(
      broken.findings.map((finding) => [finding.rule, finding.where]),
      [['config-options', 'astro-kit.json']],
    );
    assert.match(broken.findings[0]?.detail ?? '', /^the file is not valid JSON: /);
    assert.equal(readJson(root, OPTIONS_FILE).state, 'invalid');

    const wrong = two();
    put(wrong, ['locales', 1, 'code'], 'FR');
    put(wrong, ['defaultLocale'], 'it');
    writeFileSync(join(root, OPTIONS_FILE), JSON.stringify(wrong));
    const invalid = new Report();
    assert.equal(loadOptions(root, invalid), undefined);
    assert.deepEqual(
      invalid.findings.map((finding) => `${finding.where}: ${finding.detail}`),
      [
        'astro-kit.json: locales[1].code: Invalid string: must match pattern /^[a-z]{2,3}$/',
        'astro-kit.json: defaultLocale: defaultLocale must be one of locales[].code',
        'astro-kit.json: legal.legalNote.FR: the locale FR needs a path',
        'astro-kit.json: legal.legalNote.fr: fr is not one of locales[].code',
        'astro-kit.json: legal.privacy.FR: the locale FR needs a path',
        'astro-kit.json: legal.privacy.fr: fr is not one of locales[].code',
      ],
    );
    assert.deepEqual([...invalid.ids()], ['config-options']);

    writeFileSync(join(root, OPTIONS_FILE), `${EXAMPLE}\n`);
    const good = new Report();
    const options = loadOptions(root, good);
    assert.deepEqual(good.findings, []);
    assert.deepEqual([...good.ids()].sort(), []);
    assert.equal(options?.site, 'https://example.ch');
    assert.deepEqual(readJson(root, OPTIONS_FILE), { state: 'ok', value: example() });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

/** The settings parts that `checkWaivers` reads. */
const withWaivers = (...waivers: Options['waivers']): Pick<Options, 'waivers'> => ({ waivers });

test('config-waiver: a waivable rule, and an end date from today to 90 days ahead (UTC)', () => {
  const today = new Date('2026-11-13T12:00:00Z');
  const entry = { rule: 'head-title', where: '/jobs/', reason: 'The client wants this title' };
  const ended = (rule: string, where: string, until: string): string =>
    `the waiver for ${rule} on ${where} ended on ${until}: fix the page, or ask the owner for a new date`;
  const cases: [name: string, waivers: Options['waivers'], now: Date, ids: string[], finding?: [string, string]][] = [
    ['no waiver', [], today, []],
    ['a waivable rule that ends today', [{ ...entry, until: '2026-11-13' }], today, []],
    ['a waivable rule that ends in 90 days', [{ ...entry, until: '2027-02-11' }], today, []],
    ['a rule that a prefix makes waivable', [{ ...entry, rule: 'budget-head', until: '2026-12-01' }], today, []],
    [
      'a rule that is not waivable',
      [{ ...entry, rule: 'config-shim', until: '2026-12-01' }],
      today,
      ['config-waiver'],
      ['astro-kit.json: waivers[0].rule', 'config-shim is not a waivable rule'],
    ],
    [
      'a rule that does not exist',
      [{ ...entry, rule: 'no-such-rule', until: '2026-12-01' }],
      today,
      ['config-waiver'],
      ['astro-kit.json: waivers[0].rule', 'no-such-rule is not a waivable rule'],
    ],
    [
      'a date in the past',
      [{ ...entry, until: '2026-11-12' }],
      today,
      ['config-waiver'],
      [
        'astro-kit.json: waivers[0].until',
        'the waiver for head-title on /jobs/ ended on 2026-11-12: fix the page, or ask the owner for a new date',
      ],
    ],
    [
      'a date 91 days ahead',
      [{ ...entry, until: '2027-02-12' }],
      today,
      ['config-waiver'],
      ['astro-kit.json: waivers[0].until', '2027-02-12 is more than 90 days ahead: the last date is 2027-02-11'],
    ],
    [
      'the second of two waivers ended',
      [
        { ...entry, until: '2026-11-13' },
        { ...entry, rule: 'a11y-axe', where: 'src/styles/components/card.css', until: '2025-01-01' },
      ],
      today,
      ['config-waiver'],
      ['astro-kit.json: waivers[1].until', ended('a11y-axe', 'src/styles/components/card.css', '2025-01-01')],
    ],
    [
      'a rule that is not waivable, on an old date',
      [{ ...entry, rule: 'legal-approved', until: '2026-01-01' }],
      today,
      ['config-waiver', 'config-waiver'],
      ['astro-kit.json: waivers[0].until', ended('legal-approved', '/jobs/', '2026-01-01')],
    ],
    // The day is the UTC day: 23:30 in New York on the 13th is the 14th in UTC.
    [
      'the UTC day decides',
      [{ ...entry, until: '2026-11-13' }],
      new Date('2026-11-13T23:30:00-05:00'),
      ['config-waiver'],
      ['astro-kit.json: waivers[0].until', ended('head-title', '/jobs/', '2026-11-13')],
    ],
    ['the last second of the UTC day', [{ ...entry, until: '2026-11-13' }], new Date('2026-11-13T23:59:59Z'), []],
    ['the 90 days cross a leap day', [{ ...entry, until: '2028-03-01' }], new Date('2027-12-02T00:00:00Z'), []],
    [
      'one day past the 90 days across a leap day',
      [{ ...entry, until: '2028-03-02' }],
      new Date('2027-12-02T00:00:00Z'),
      ['config-waiver'],
      ['astro-kit.json: waivers[0].until', '2028-03-02 is more than 90 days ahead: the last date is 2028-03-01'],
    ],
  ];
  // The zone of the machine is set to New York for this test. So the local day differs from the UTC day in the case
  // 'the UTC day decides' on every machine, and a check that takes the local day fails it.
  const zone = process.env.TZ;
  process.env.TZ = 'America/New_York';
  try {
    assert.equal(new Date('2026-11-13T23:30:00-05:00').getDate(), 13, 'the local day is the 13th');
    assert.equal(new Date('2026-11-13T23:30:00-05:00').getUTCDate(), 14, 'the UTC day is the 14th');
    for (const [name, waivers, now, ids, finding] of cases) {
      const report = new Report();
      checkWaivers(withWaivers(...waivers), report, now);
      const seen = report.findings.map((item) => `${item.where}: ${item.detail}`);
      const wanted = finding === undefined ? [] : [finding.join(': ')];
      assert.deepEqual(report.findings.map((item) => item.rule).sort(), ids, name);
      assert.deepEqual(
        wanted.filter((line) => !seen.includes(line)),
        [],
        `${name}: ${JSON.stringify(seen)}`,
      );
    }
  } finally {
    if (zone === undefined) delete process.env.TZ;
    else process.env.TZ = zone;
  }
});

test('config-waiver: without a date argument, today is the day of the run', () => {
  const day = (offset: number): string => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
  const entry = { rule: 'head-title', where: '/jobs/', reason: 'The client wants this title' };
  const good = new Report();
  checkWaivers(withWaivers({ ...entry, until: day(30) }), good);
  assert.deepEqual(good.findings, []);
  const old = new Report();
  checkWaivers(withWaivers({ ...entry, until: day(-2) }), old);
  assert.deepEqual([...old.ids()], ['config-waiver']);
  const far = new Report();
  checkWaivers(withWaivers({ ...entry, until: day(92) }), far);
  assert.deepEqual([...far.ids()], ['config-waiver']);
});

test('legal-processing: cdn and previews always, forms and server with forms and only then', () => {
  type Keys = Options['processing'];
  const cases: [name: string, forms: boolean, processing: Keys, findings: [where: string, detail: string][]][] = [
    ['a static site with cdn and previews', false, ['cdn', 'previews'], []],
    ['a static site without cdn', false, ['previews'], [['astro-kit.json: processing', 'cdn is missing']]],
    ['a static site without previews', false, ['cdn'], [['astro-kit.json: processing', 'previews is missing']]],
    [
      'a static site with an empty list',
      false,
      [],
      [
        ['astro-kit.json: processing', 'cdn is missing'],
        ['astro-kit.json: processing', 'previews is missing'],
      ],
    ],
    [
      'a static site with forms',
      false,
      ['cdn', 'previews', 'forms'],
      [['astro-kit.json: processing[2]', 'forms is only for features.forms true']],
    ],
    [
      'a static site with server',
      false,
      ['cdn', 'server', 'previews'],
      [['astro-kit.json: processing[1]', 'server is only for features.forms true']],
    ],
    ['a forms site with all four keys', true, ['cdn', 'previews', 'forms', 'server'], []],
    ['a forms site with the keys in another order', true, ['server', 'forms', 'previews', 'cdn'], []],
    [
      'a forms site without forms',
      true,
      ['cdn', 'previews', 'server'],
      [['astro-kit.json: processing', 'forms is missing']],
    ],
    [
      'a forms site without server',
      true,
      ['cdn', 'previews', 'forms'],
      [['astro-kit.json: processing', 'server is missing']],
    ],
    [
      'a forms site without cdn',
      true,
      ['previews', 'forms', 'server'],
      [['astro-kit.json: processing', 'cdn is missing']],
    ],
  ];
  for (const [name, withForms, processing, findings] of cases) {
    const report = new Report();
    const features = { forms: withForms, islands: false, scripts: false, wasm: false, workers: false };
    checkProcessing({ features, processing }, report);
    assert.deepEqual(
      report.findings.map((finding) => finding.rule).sort(),
      findings.map(() => 'legal-processing'),
      name,
    );
    assert.deepEqual(
      report.findings.map((finding) => [finding.where, finding.detail]),
      findings,
      name,
    );
  }
});

test('legal-processing: the default of processing fails a site with forms', () => {
  const declared = forms();
  put(declared, ['processing'], REMOVE);
  const options = parseOptions(declared, new Report());
  assert.ok(options);
  assert.deepEqual(options.processing, ['cdn', 'previews']);
  const report = new Report();
  checkProcessing(options, report);
  assert.deepEqual(report.findings.map((finding) => finding.rule).sort(), ['legal-processing', 'legal-processing']);
});

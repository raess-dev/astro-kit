import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  auditEdge,
  BANNED_HEADERS,
  checkHeaders,
  checkRedirects,
  HEADER_LIMITS,
  REDIRECT_STATUSES,
} from '../../src/audit/edge.ts';
import { addFile, type BuildContext } from '../../src/context.ts';
import { headerCsp } from '../../src/csp.ts';
import {
  headersText,
  IMMUTABLE,
  kitHeaders,
  PREFETCH_HTML,
  redirectsText,
  writeEdgeFiles,
} from '../../src/hosts/cloudflare.ts';
import { effectiveLimits, type Options } from '../../src/options.ts';
import { REDIRECT_LIMITS, type RedirectRow } from '../../src/redirects.ts';
import { getRule, Report } from '../../src/registry.ts';
import { EXAMPLE, factsOf, optionsOf, origin, SMALLEST } from './fixtures.ts';
import { SPEC, specBlock } from './spec.ts';

const HEADERS = 'edge-headers';
const REDIRECTS = 'edge-redirects';

/** The row of a rule in the table of section 8. */
const specRow = (rule: string): string => SPEC.split('\n').find((line) => line.startsWith(`| \`${rule}\` |`)) ?? '';

// Settings

/** A static site: no feature, no origin, no prefetch script. */
const STATIC = optionsOf(SMALLEST);
/** A site with forms: the example of 5.1. */
const FORMS = optionsOf(EXAMPLE);
const PREFETCH = optionsOf({ ...SMALLEST, prefetch: { astroPrefetch: true } });
const PREFETCH_FORMS = optionsOf({ ...EXAMPLE, prefetch: { astroPrefetch: true } });
const SCRIPTS = optionsOf({ ...SMALLEST, features: { scripts: true } });

/** A case of 9.4: the example of 5.1 with `features.scripts` and its own origins. */
const withOrigins = (origins: readonly unknown[]): Options =>
  optionsOf({ ...EXAMPLE, features: { ...EXAMPLE.features, scripts: true }, origins });

const MAPS = origin('maps.example.org', ['frame']);
const PAY = origin('js.pay.example', ['script', 'frame'], { allow: ['payment'] });
const PAY_API = origin('api.pay.example', ['connect']);
const STATS = origin('stats.example.net', ['connect'], { load: 'page' });
const NEWS = origin('news.example.com', ['form']);
const PAY_A = origin('pay.a.example', ['frame'], { allow: ['payment'] });
const PAY_B = origin('pay.b.example', ['frame'], { allow: ['payment'] });

const FRAME = withOrigins([MAPS]);
const PAYMENT = withOrigins([PAY, PAY_API]);
const TWO_PAYMENTS = withOrigins([PAY_B, PAY_A]);
const FORM_ORIGIN = withOrigins([NEWS]);

// The texts that the cases change

/**
 * The text of a static site: the block of 6.3.
 *
 * ```
 *  1 /*
 *  2   Content-Security-Policy
 *  3   Strict-Transport-Security
 *  4   X-Content-Type-Options
 *  5   Referrer-Policy
 *  6   Cross-Origin-Opener-Policy
 *  7   Cross-Origin-Resource-Policy
 *  8   Permissions-Policy
 *  9 /_astro/*
 * 10   Cache-Control
 * ```
 */
const STATIC_TEXT = headersText(STATIC);

/** With `astroPrefetch`: line 9 is the Cache-Control of `/*`, then `/_astro/*` (10), the detach (11), the value (12). */
const PREFETCH_TEXT = headersText(PREFETCH);

/** With forms: the eight lines of `/*`. The adapter writes the asset rule. */
const FORMS_TEXT = headersText(FORMS);

/** The rule that `@astrojs/cloudflare` writes (13.1, item 18). */
const ADAPTER_RULE = `/_astro/*\n  Cache-Control: ${IMMUTABLE}\n`;

/** What the adapter does when it runs after the kit: its rule and an empty line, then the old text. */
const adapterAfter = (text: string): string => `${ADAPTER_RULE}\n${text}`;

/** Replaces one text. It throws when the text is missing, so that a case cannot pass by accident. */
function swap(text: string, from: string, to: string): string {
  if (!text.includes(from)) throw new Error(`the text does not hold ${JSON.stringify(from)}`);
  return text.replace(from, to);
}

/** The lines of a text, without the empty entry after the last newline. */
const linesOf = (text: string): string[] => text.trimEnd().split('\n');

/** Removes the one header line of a name. */
function without(text: string, name: string): string {
  const lines = linesOf(text);
  const index = lines.findIndex((line) => line.trim().startsWith(`${name}:`));
  if (index < 0) throw new Error(`the text has no header ${name}`);
  lines.splice(index, 1);
  return `${lines.join('\n')}\n`;
}

/** Sets the value of the one header line of a name. */
function setValue(text: string, name: string, value: string): string {
  const lines = linesOf(text);
  const index = lines.findIndex((line) => line.trim().startsWith(`${name}:`));
  if (index < 0) throw new Error(`the text has no header ${name}`);
  lines[index] = `  ${name}: ${value}`;
  return `${lines.join('\n')}\n`;
}

/** Adds lines after a line of the text. Line numbers count from 1. */
function insertAfter(text: string, line: number, ...more: string[]): string {
  const lines = linesOf(text);
  if (line > lines.length) throw new Error(`the text has no line ${line}`);
  lines.splice(line, 0, ...more);
  return `${lines.join('\n')}\n`;
}

/** `count` more rules, each with one harmless header. */
const rules = (count: number): string =>
  Array.from({ length: count }, (_, index) => `/r${index}/*\n  X-R: ${index}\n`).join('');

/** One item of the Permissions-Policy of the text, changed. */
const item = (text: string, from: string, to: string): string => swap(text, `, ${from},`, `, ${to},`);

// Running the cases

/** One case: a name, the settings, the text of `_headers`, and the place of each finding, in order. */
type HeaderCase = readonly [name: string, options: Options, text: string, wheres: readonly string[]];

interface Seen {
  name: string;
  /** The sorted rule ids of the findings that fail. */
  ids: string[];
  /** The place of every finding, in the order of the report. */
  wheres: readonly string[];
}

function seenHeaders(cases: readonly HeaderCase[]): Seen[] {
  return cases.map(([name, options, text]) => {
    const report = new Report();
    checkHeaders(text, options, report);
    return { name, ids: [...report.ids()].sort(), wheres: report.findings.map((finding) => finding.where) };
  });
}

/** What the cases must give: no id when a case names no place, else the one id of the rule. */
const expectedOf = (cases: readonly (readonly [name: string, wheres: readonly string[]])[], rule: string): Seen[] =>
  cases.map(([name, wheres]) => ({ name, ids: wheres.length === 0 ? [] : [rule], wheres }));

const expectedHeaders = (cases: readonly HeaderCase[]): Seen[] =>
  expectedOf(
    cases.map(([name, , , wheres]) => [name, wheres]),
    HEADERS,
  );

// The fixed values

test('the limits, the banned headers and the statuses are those of the rule table', () => {
  assert.deepEqual(HEADER_LIMITS, { rules: 100, lineChars: 2000 });
  assert.ok(
    specRow(HEADERS).includes('`_headers` has ≤ 100 rules, lines ≤ 2,000 characters and no duplicate pattern.'),
  );
  assert.deepEqual(BANNED_HEADERS, ['X-Frame-Options', 'Cross-Origin-Embedder-Policy']);
  assert.ok(specRow(HEADERS).includes('No `X-Frame-Options` or `Cross-Origin-Embedder-Policy` on any rule.'));
  assert.ok(specRow(HEADERS).includes(`(= \`${IMMUTABLE}\`)`));
  assert.ok(specRow(HEADERS).includes(`(= \`${PREFETCH_HTML}\`)`));
  assert.ok(specRow(HEADERS).includes('HSTS max-age ≥ 31,536,000 with includeSubDomains'));
  assert.deepEqual(REDIRECT_STATUSES, ['301', '302', '303', '307', '308']);
  assert.ok(specRow(REDIRECTS).includes(`[${REDIRECT_STATUSES.join('\\|')}]`));
  assert.ok(specRow(REDIRECTS).includes('≤ 2,000 static and ≤ 100 dynamic rules, lines ≤ 1,000 characters'));
  for (const id of [HEADERS, REDIRECTS]) {
    assert.equal(getRule(id).stage, 'build', id);
    assert.equal(getRule(id).group, 'edge', id);
    assert.equal(getRule(id).waivable, false, id);
  }
});

test('the texts that the cases change are the texts of 6.3', () => {
  const block = specBlock('**`_headers`.** The kit', 'text');
  assert.equal(STATIC_TEXT, `${block.replace('<header policy>', headerCsp(STATIC))}\n`);
  assert.equal(linesOf(STATIC_TEXT).length, 10);
  assert.equal(linesOf(FORMS_TEXT).length, 8);
  assert.deepEqual(linesOf(PREFETCH_TEXT).slice(8), [
    `  Cache-Control: ${PREFETCH_HTML}`,
    '/_astro/*',
    '  ! Cache-Control',
    `  Cache-Control: ${IMMUTABLE}`,
  ]);
});

// edge-headers: what passes

/** The settings and an existing file of each merge case. `headersText` of each must pass the rule. */
const WRITTEN: readonly (readonly [name: string, options: Options, existing: string | undefined])[] = [
  ['a static site', STATIC, undefined],
  ['forms, no file', FORMS, undefined],
  ['forms, the adapter ran first', FORMS, ADAPTER_RULE],
  ['forms, the adapter ran after the kit, and the kit merges again', FORMS, adapterAfter(FORMS_TEXT)],
  ['prefetch', PREFETCH, undefined],
  ['prefetch with forms', PREFETCH_FORMS, undefined],
  ['prefetch with forms, the adapter ran first', PREFETCH_FORMS, ADAPTER_RULE],
  ['prefetch, an existing /* rule with a Cache-Control', PREFETCH, '/*\n  Cache-Control: no-store\n'],
  ['scripts: no Trusted Types', SCRIPTS, undefined],
  ['other rules of an existing file', STATIC, '# x\n/*\n  X-Robots-Tag: noindex\n/downloads/*\n  X-A: 1\n'],
  ['two existing asset rules', STATIC, '/_astro/*\n  Cache-Control: no-store\n/_astro/*\n  ! Cache-Control\n'],
  ['9.4, case 1: no origin', withOrigins([]), undefined],
  ['9.4, case 2: a frame origin', FRAME, undefined],
  ['9.4, case 3: a script and frame origin with payment, and a connect origin', PAYMENT, undefined],
  ['9.4, case 4: a connect origin', withOrigins([STATS]), undefined],
  ['9.4, case 5: a form origin', FORM_ORIGIN, undefined],
  ['two origins allow one feature', TWO_PAYMENTS, undefined],
  [
    'origins with prefetch, the adapter ran first',
    optionsOf({ ...PAYMENT, prefetch: { astroPrefetch: true } }),
    ADAPTER_RULE,
  ],
];

test('edge-headers passes the text that headersText writes, for every merge case and the five cases of 9.4', () => {
  const cases: HeaderCase[] = WRITTEN.map(([name, options, existing]) => [
    name,
    options,
    headersText(options, existing),
    [],
  ]);
  assert.deepEqual(seenHeaders(cases), expectedHeaders(cases));
});

test('the texts of the 9.4 cases hold the changed header values', () => {
  const frame = headersText(FRAME);
  const payment = headersText(PAYMENT);
  const form = headersText(FORM_ORIGIN);
  assert.ok(frame.includes('\n  Cross-Origin-Opener-Policy: same-origin-allow-popups\n'));
  assert.ok(payment.includes('\n  Cross-Origin-Opener-Policy: same-origin-allow-popups\n'));
  assert.ok(payment.includes(', payment=(self "https://js.pay.example"), '));
  assert.ok(headersText(TWO_PAYMENTS).includes(', payment=(self "https://pay.a.example" "https://pay.b.example"), '));
  assert.ok(form.includes("; form-action 'self' https://news.example.com\n"));
  assert.ok(STATIC_TEXT.includes('\n  Cross-Origin-Opener-Policy: same-origin\n'));
  assert.ok(STATIC_TEXT.includes(', payment=(), '));
});

const ADAPTER_CASES: readonly HeaderCase[] = [
  ['forms: the adapter runs after the kit and puts its rule before /*', FORMS, adapterAfter(FORMS_TEXT), []],
  ['forms: no asset rule yet', FORMS, FORMS_TEXT, []],
  [
    'a static site without the asset rule: the rule asks for it only with prefetch',
    STATIC,
    FORMS_TEXT.replace(headerCsp(FORMS), headerCsp(STATIC)),
    [],
  ],
  [
    'the asset rule before /*, without prefetch',
    STATIC,
    `${ADAPTER_RULE}${linesOf(STATIC_TEXT).slice(0, 8).join('\n')}\n`,
    [],
  ],
  ['CRLF line ends', STATIC, STATIC_TEXT.replaceAll('\n', '\r\n'), []],
  ['comments and empty lines', STATIC, `# a comment\n\n${insertAfter(STATIC_TEXT, 8, '', '  # more')}`, []],
  ['header names in lower case', STATIC, STATIC_TEXT.replace(/^ {2}[A-Za-z-]+:/gm, (name) => name.toLowerCase()), []],
];

test('edge-headers passes the adapter rule before /*, and a file without the asset rule', () => {
  assert.deepEqual(seenHeaders(ADAPTER_CASES), expectedHeaders(ADAPTER_CASES));
});

// edge-headers: the limits and the patterns

const LONG = 'X-Long: ';

const LIMIT_CASES: readonly HeaderCase[] = [
  ['100 rules', STATIC, `${STATIC_TEXT}${rules(98)}`, []],
  ['101 rules', STATIC, `${STATIC_TEXT}${rules(99)}`, ['_headers']],
  [
    'a header line of 2,000 characters',
    STATIC,
    `${STATIC_TEXT}/long/*\n  ${LONG}${'a'.repeat(2000 - LONG.length)}\n`,
    [],
  ],
  [
    'a header line of 2,001 characters',
    STATIC,
    `${STATIC_TEXT}/long/*\n  ${LONG}${'a'.repeat(2001 - LONG.length)}\n`,
    ['_headers:12'],
  ],
  ['a pattern of 2,001 characters', STATIC, `${STATIC_TEXT}/${'a'.repeat(2000)}\n  X-A: 1\n`, ['_headers:11']],
  ['a comment of 2,001 characters', STATIC, `${STATIC_TEXT}#${'a'.repeat(2000)}\n`, ['_headers:11']],
  ['two patterns, each once', STATIC, `${STATIC_TEXT}/a/*\n  X-A: 1\n/b/*\n  X-B: 2\n`, []],
  ['a pattern twice', STATIC, `${STATIC_TEXT}/a/*\n  X-A: 1\n/a/*\n  X-B: 2\n`, ['_headers:13']],
  ['the asset rule twice', STATIC, `${STATIC_TEXT}/_astro/*\n  X-A: 1\n`, ['_headers:11']],
  [
    'the adapter rule before the kit text of a static site: two asset rules',
    STATIC,
    adapterAfter(STATIC_TEXT),
    ['_headers:12'],
  ],
  [
    '/* twice: Cloudflare keeps the last one, and it has none of the seven headers',
    STATIC,
    `${STATIC_TEXT}/*\n  X-A: 1\n`,
    ['_headers:11', '_headers', '_headers', '_headers', '_headers', '_headers', '_headers', '_headers'],
  ],
];

test('edge-headers: at most 100 rules, lines of at most 2,000 characters, no duplicate pattern', () => {
  assert.deepEqual(seenHeaders(LIMIT_CASES), expectedHeaders(LIMIT_CASES));
});

// edge-headers: the seven headers of /*

const NAMES = kitHeaders(STATIC).map(([name]) => name);

const MISSING_CASES: readonly HeaderCase[] = [
  ['no /* rule', STATIC, ADAPTER_RULE, ['_headers']],
  ['the seven headers on another pattern', STATIC, swap(STATIC_TEXT, '/*\n', '/x/*\n'), ['_headers']],
  ...NAMES.map((name): HeaderCase => [`no ${name}`, STATIC, without(STATIC_TEXT, name), ['_headers']]),
  ...NAMES.map(
    (name): HeaderCase => [
      `${name} is detached, not set`,
      STATIC,
      swap(without(STATIC_TEXT, name), '/_astro/*', `  ! ${name}\n/_astro/*`),
      ['_headers'],
    ],
  ),
  [
    'no header at all',
    STATIC,
    `/*\n  X-A: 1\n${ADAPTER_RULE}`,
    ['_headers', '_headers', '_headers', '_headers', '_headers', '_headers', '_headers'],
  ],
];

test('edge-headers: /* has each of the seven headers', () => {
  assert.equal(NAMES.length, 7);
  assert.deepEqual(seenHeaders(MISSING_CASES), expectedHeaders(MISSING_CASES));
});

const EXACT_CASES: readonly HeaderCase[] = [
  ['nosniff, changed', STATIC, setValue(STATIC_TEXT, 'X-Content-Type-Options', 'sniff'), ['_headers:4']],
  [
    'nosniff, set twice: Cloudflare joins the values',
    STATIC,
    insertAfter(STATIC_TEXT, 8, '  X-Content-Type-Options: nosniff'),
    ['_headers:4'],
  ],
  ['the referrer policy, changed', STATIC, setValue(STATIC_TEXT, 'Referrer-Policy', 'no-referrer'), ['_headers:5']],
  ['CORP, changed', STATIC, setValue(STATIC_TEXT, 'Cross-Origin-Resource-Policy', 'cross-origin'), ['_headers:7']],
  [
    'COOP allows popups, with no origin',
    STATIC,
    setValue(STATIC_TEXT, 'Cross-Origin-Opener-Policy', 'same-origin-allow-popups'),
    ['_headers:6'],
  ],
  ['COOP unsafe-none', STATIC, setValue(STATIC_TEXT, 'Cross-Origin-Opener-Policy', 'unsafe-none'), ['_headers:6']],
  ['COOP allows popups, with a frame origin', FRAME, headersText(FRAME), []],
  [
    'COOP same-origin, with a frame origin',
    FRAME,
    setValue(headersText(FRAME), 'Cross-Origin-Opener-Policy', 'same-origin'),
    ['_headers:6'],
  ],
  [
    'COOP same-origin, with a script origin',
    PAYMENT,
    setValue(headersText(PAYMENT), 'Cross-Origin-Opener-Policy', 'same-origin'),
    ['_headers:6'],
  ],
  [
    'COOP allows popups, with a connect origin only',
    withOrigins([STATS]),
    setValue(headersText(withOrigins([STATS])), 'Cross-Origin-Opener-Policy', 'same-origin-allow-popups'),
    ['_headers:6'],
  ],
];

test('edge-headers: nosniff, referrer and CORP are exact, and COOP follows the origins', () => {
  assert.deepEqual(seenHeaders(EXACT_CASES), expectedHeaders(EXACT_CASES));
});

const CSP = 'Content-Security-Policy';
const TRUSTED =
  "frame-ancestors 'none'; base-uri 'none'; object-src 'none'; form-action 'self'; require-trusted-types-for 'script'; trusted-types 'none'";
const UNTRUSTED = "frame-ancestors 'none'; base-uri 'none'; object-src 'none'; form-action 'self'";

const CSP_CASES: readonly HeaderCase[] = [
  ['the header policy with Trusted Types', STATIC, setValue(STATIC_TEXT, CSP, TRUSTED), []],
  [
    'the directives in another order, with more spaces and a final semicolon',
    STATIC,
    setValue(
      STATIC_TEXT,
      CSP,
      "trusted-types  'none';object-src 'none' ; require-trusted-types-for 'script'; form-action 'self'; base-uri 'none'; frame-ancestors 'none';",
    ),
    [],
  ],
  [
    'one directive is missing',
    STATIC,
    setValue(STATIC_TEXT, CSP, TRUSTED.replace("object-src 'none'; ", '')),
    ['_headers:2'],
  ],
  ['one more directive', STATIC, setValue(STATIC_TEXT, CSP, `${TRUSTED}; default-src 'self'`), ['_headers:2']],
  ['a directive twice', STATIC, setValue(STATIC_TEXT, CSP, `${TRUSTED}; base-uri 'none'`), ['_headers:2']],
  [
    'one source changed',
    STATIC,
    setValue(STATIC_TEXT, CSP, TRUSTED.replace("frame-ancestors 'none'", "frame-ancestors 'self'")),
    ['_headers:2'],
  ],
  [
    'one more source',
    STATIC,
    setValue(STATIC_TEXT, CSP, TRUSTED.replace("form-action 'self'", "form-action 'self' https://x.example")),
    ['_headers:2'],
  ],
  ['no Trusted Types on a site without scripts', STATIC, setValue(STATIC_TEXT, CSP, UNTRUSTED), ['_headers:2']],
  ['no Trusted Types on a site with scripts', SCRIPTS, setValue(STATIC_TEXT, CSP, UNTRUSTED), []],
  ['Trusted Types on a site with scripts', SCRIPTS, setValue(STATIC_TEXT, CSP, TRUSTED), ['_headers:2']],
  [
    'the policy set twice: Cloudflare joins the values',
    STATIC,
    insertAfter(STATIC_TEXT, 2, `  ${CSP}: ${TRUSTED}`),
    ['_headers:2'],
  ],
  ['a form origin in form-action', FORM_ORIGIN, headersText(FORM_ORIGIN), []],
  [
    'a form origin, and form-action without its host',
    FORM_ORIGIN,
    setValue(headersText(FORM_ORIGIN), CSP, UNTRUSTED),
    ['_headers:2'],
  ],
  [
    'no form origin, and form-action with a host',
    FRAME,
    setValue(headersText(FRAME), CSP, `${UNTRUSTED} https://news.example.com`),
    ['_headers:2'],
  ],
];

test('edge-headers: the CSP directive set equals the header policy, compared sorted', () => {
  assert.equal(headerCsp(STATIC), TRUSTED);
  assert.equal(headerCsp(SCRIPTS), UNTRUSTED);
  assert.deepEqual(seenHeaders(CSP_CASES), expectedHeaders(CSP_CASES));
});

const HSTS = 'Strict-Transport-Security';

const HSTS_CASES: readonly HeaderCase[] = [
  ['one year with includeSubDomains', STATIC, setValue(STATIC_TEXT, HSTS, 'max-age=31536000; includeSubDomains'), []],
  ['two years, with preload', STATIC, setValue(STATIC_TEXT, HSTS, 'max-age=63072000; includeSubDomains; preload'), []],
  ['another order and case', STATIC, setValue(STATIC_TEXT, HSTS, 'INCLUDESUBDOMAINS;MAX-AGE=31536000'), []],
  [
    'one second less than a year',
    STATIC,
    setValue(STATIC_TEXT, HSTS, 'max-age=31535999; includeSubDomains'),
    ['_headers:3'],
  ],
  ['max-age=0', STATIC, setValue(STATIC_TEXT, HSTS, 'max-age=0; includeSubDomains'), ['_headers:3']],
  ['no includeSubDomains', STATIC, setValue(STATIC_TEXT, HSTS, 'max-age=31536000'), ['_headers:3']],
  ['no max-age', STATIC, setValue(STATIC_TEXT, HSTS, 'includeSubDomains'), ['_headers:3']],
  [
    'a directive that only ends with max-age',
    STATIC,
    setValue(STATIC_TEXT, HSTS, 'x-max-age=31536000; includeSubDomains'),
    ['_headers:3'],
  ],
  [
    'a max-age that is no number',
    STATIC,
    setValue(STATIC_TEXT, HSTS, 'max-age=31536000x; includeSubDomains'),
    ['_headers:3'],
  ],
];

test('edge-headers: HSTS has a max-age of 31,536,000 or more, and includeSubDomains', () => {
  assert.deepEqual(seenHeaders(HSTS_CASES), expectedHeaders(HSTS_CASES));
});

const PAYMENT_TEXT = headersText(PAYMENT);
const PAYMENT_ITEM = 'payment=(self "https://js.pay.example")';
const TWO_TEXT = headersText(TWO_PAYMENTS);
const TWO_ITEM = 'payment=(self "https://pay.a.example" "https://pay.b.example")';

const PERMISSION_CASES: readonly HeaderCase[] = [
  [
    'autoplay and fullscreen are off too',
    STATIC,
    item(item(STATIC_TEXT, 'autoplay=(self)', 'autoplay=()'), 'fullscreen=(self)', 'fullscreen=()'),
    [],
  ],
  // The rule row checks each item. It does not ask for the whole list of 6.3.
  [
    'a shorter list of valid items',
    STATIC,
    setValue(STATIC_TEXT, 'Permissions-Policy', 'camera=(), fullscreen=(self)'),
    [],
  ],
  ['(self) for another feature', STATIC, item(STATIC_TEXT, 'camera=()', 'camera=(self)'), ['_headers:8']],
  ['a star', STATIC, item(STATIC_TEXT, 'camera=()', 'camera=*'), ['_headers:8']],
  ['(*)', STATIC, item(STATIC_TEXT, 'camera=()', 'camera=(*)'), ['_headers:8']],
  ['an item without a list', STATIC, item(STATIC_TEXT, 'camera=()', 'camera'), ['_headers:8']],
  ['an empty item', STATIC, item(STATIC_TEXT, 'camera=()', ''), ['_headers:8']],
  [
    'a host that is no origin',
    STATIC,
    item(STATIC_TEXT, 'payment=()', 'payment=(self "https://js.pay.example")'),
    ['_headers:8'],
  ],
  [
    'a host for fullscreen that is no origin',
    STATIC,
    item(STATIC_TEXT, 'fullscreen=(self)', 'fullscreen=(self "https://x.example")'),
    ['_headers:8'],
  ],
  [
    'two items that are not valid: one finding each',
    STATIC,
    item(item(STATIC_TEXT, 'camera=()', 'camera=*'), 'usb=()', 'usb=(self)'),
    ['_headers:8', '_headers:8'],
  ],
  ['an origin allows payment', PAYMENT, PAYMENT_TEXT, []],
  ['an origin allows payment, and the item is off', PAYMENT, item(PAYMENT_TEXT, PAYMENT_ITEM, 'payment=()'), []],
  [
    'an origin allows payment, and the item is (self)',
    PAYMENT,
    item(PAYMENT_TEXT, PAYMENT_ITEM, 'payment=(self)'),
    ['_headers:8'],
  ],
  [
    'an origin allows payment, and the item names another host',
    PAYMENT,
    item(PAYMENT_TEXT, PAYMENT_ITEM, 'payment=(self "https://api.pay.example")'),
    ['_headers:8'],
  ],
  [
    'an origin allows payment, and the item has no self',
    PAYMENT,
    item(PAYMENT_TEXT, PAYMENT_ITEM, 'payment=("https://js.pay.example")'),
    ['_headers:8'],
  ],
  [
    'an origin allows payment, and another item names its host',
    PAYMENT,
    item(PAYMENT_TEXT, 'geolocation=()', 'geolocation=(self "https://js.pay.example")'),
    ['_headers:8'],
  ],
  ['two origins allow payment: the sorted hosts', TWO_PAYMENTS, TWO_TEXT, []],
  [
    'two origins allow payment: the hosts in another order',
    TWO_PAYMENTS,
    item(TWO_TEXT, TWO_ITEM, 'payment=(self "https://pay.b.example" "https://pay.a.example")'),
    ['_headers:8'],
  ],
  [
    'two origins allow payment: one host only',
    TWO_PAYMENTS,
    item(TWO_TEXT, TWO_ITEM, 'payment=(self "https://pay.a.example")'),
    ['_headers:8'],
  ],
];

test('edge-headers: each Permissions-Policy item has one of the three forms', () => {
  assert.ok(PAYMENT_TEXT.includes(PAYMENT_ITEM));
  assert.ok(TWO_TEXT.includes(TWO_ITEM));
  assert.deepEqual(seenHeaders(PERMISSION_CASES), expectedHeaders(PERMISSION_CASES));
});

// edge-headers: headers that the kit does not allow

const BANNED_CASES: readonly HeaderCase[] = [
  ['X-Frame-Options on /*', STATIC, insertAfter(STATIC_TEXT, 8, '  X-Frame-Options: DENY'), ['_headers:9']],
  [
    'X-Frame-Options on another rule, in lower case',
    STATIC,
    `${STATIC_TEXT}/x/*\n  x-frame-options: SAMEORIGIN\n`,
    ['_headers:12'],
  ],
  [
    'Cross-Origin-Embedder-Policy on /*',
    STATIC,
    insertAfter(STATIC_TEXT, 1, '  Cross-Origin-Embedder-Policy: require-corp'),
    ['_headers:2'],
  ],
  [
    'Cross-Origin-Embedder-Policy on the asset rule',
    STATIC,
    `${STATIC_TEXT}  Cross-Origin-Embedder-Policy: credentialless\n`,
    ['_headers:11'],
  ],
  [
    'both on one rule',
    STATIC,
    `${STATIC_TEXT}/x/*\n  X-Frame-Options: DENY\n  Cross-Origin-Embedder-Policy: require-corp\n`,
    ['_headers:12', '_headers:13'],
  ],
  [
    'a detach of both: nothing is set',
    STATIC,
    `${STATIC_TEXT}/x/*\n  ! X-Frame-Options\n  ! Cross-Origin-Embedder-Policy\n`,
    [],
  ],
  ['another header on another rule', STATIC, `${STATIC_TEXT}/x/*\n  X-Robots-Tag: noindex\n`, []],
];

test('edge-headers: no X-Frame-Options and no Cross-Origin-Embedder-Policy on any rule', () => {
  assert.deepEqual(seenHeaders(BANNED_CASES), expectedHeaders(BANNED_CASES));
});

// edge-headers: Cache-Control

const CACHE = 'Cache-Control';
/** The lines of the two rules of `PREFETCH_TEXT`. */
const PREFETCH_ALL = linesOf(PREFETCH_TEXT).slice(0, 9).join('\n');
const PREFETCH_ASSETS = linesOf(PREFETCH_TEXT).slice(9).join('\n');

const CACHE_CASES: readonly HeaderCase[] = [
  ['without prefetch, on /*', STATIC, insertAfter(STATIC_TEXT, 8, `  ${CACHE}: ${PREFETCH_HTML}`), ['_headers:9']],
  ['on another rule', STATIC, `${STATIC_TEXT}/x/*\n  ${CACHE}: no-store\n`, ['_headers:12']],
  [
    'on another rule, with the immutable value',
    STATIC,
    `${STATIC_TEXT}/fonts/*\n  ${CACHE}: ${IMMUTABLE}\n`,
    ['_headers:12'],
  ],
  [
    'on the asset rule, with another value',
    STATIC,
    swap(STATIC_TEXT, IMMUTABLE, 'public, max-age=60'),
    ['_headers:10'],
  ],
  [
    'on the asset rule, without immutable',
    STATIC,
    swap(STATIC_TEXT, IMMUTABLE, 'public, max-age=31536000'),
    ['_headers:10'],
  ],
  [
    'on the asset rule twice: Cloudflare joins the values',
    STATIC,
    `${STATIC_TEXT}  ${CACHE}: ${IMMUTABLE}\n`,
    ['_headers:10'],
  ],
  ['on the asset rule, the name in lower case', STATIC, swap(STATIC_TEXT, `  ${CACHE}:`, '  cache-control:'), []],
  ['a detach on another rule sets nothing', STATIC, `${STATIC_TEXT}/x/*\n  ! ${CACHE}\n`, []],
  ['with prefetch: the text of the kit', PREFETCH, PREFETCH_TEXT, []],
  [
    'with prefetch, on /* with another value',
    PREFETCH,
    swap(PREFETCH_TEXT, PREFETCH_HTML, 'public, max-age=600'),
    ['_headers:9'],
  ],
  ['with prefetch, on another rule', PREFETCH, `${PREFETCH_TEXT}/x/*\n  ${CACHE}: no-store\n`, ['_headers:14']],
  [
    'with prefetch, on the asset rule with another value',
    PREFETCH,
    swap(PREFETCH_TEXT, IMMUTABLE, 'no-store'),
    ['_headers:12'],
  ],
  ['with prefetch: no detach', PREFETCH, swap(PREFETCH_TEXT, `  ! ${CACHE}\n`, ''), ['_headers']],
  ['with prefetch: a detach without the space', PREFETCH, swap(PREFETCH_TEXT, `! ${CACHE}`, `!${CACHE}`), ['_headers']],
  ['with prefetch: a detach of another header', PREFETCH, swap(PREFETCH_TEXT, `! ${CACHE}`, '! Expires'), ['_headers']],
  [
    'with prefetch: the detach on /*, not on the asset rule',
    PREFETCH,
    insertAfter(swap(PREFETCH_TEXT, `  ! ${CACHE}\n`, ''), 9, `  ! ${CACHE}`),
    ['_headers'],
  ],
  ['with prefetch: no asset rule', PREFETCH, `${PREFETCH_ALL}\n`, ['_headers']],
  [
    'with prefetch: the detach after the value, in one rule',
    PREFETCH,
    `${PREFETCH_ALL}\n/_astro/*\n  ${CACHE}: ${IMMUTABLE}\n  ! ${CACHE}\n`,
    [],
  ],
  ['with prefetch: the asset rule before /*', PREFETCH, `${PREFETCH_ASSETS}\n${PREFETCH_ALL}\n`, ['_headers:1']],
  [
    'with prefetch: the adapter rule before the kit text',
    PREFETCH,
    adapterAfter(PREFETCH_TEXT),
    ['_headers:13', '_headers:1'],
  ],
];

test('edge-headers: Cache-Control only on /_astro/*, or with prefetch on /*; with prefetch the detach, after /*', () => {
  assert.deepEqual(seenHeaders(CACHE_CASES), expectedHeaders(CACHE_CASES));
});

test('edge-headers reports every finding of one text, each with its detail', () => {
  const text = [
    '/x/*',
    '  X-Frame-Options: DENY',
    '/*',
    '  X-Content-Type-Options: sniff',
    '  Strict-Transport-Security: max-age=1',
    '  Permissions-Policy: camera=(self)',
    '  Cache-Control: no-store',
    '',
  ].join('\n');
  const report = new Report();
  checkHeaders(text, STATIC, report);
  assert.deepEqual(
    report.findings.map((finding) => `${finding.rule} ${finding.where}: ${finding.detail}`),
    [
      'edge-headers _headers: `/*` does not set Content-Security-Policy',
      'edge-headers _headers:5: Strict-Transport-Security is `max-age=1`; it needs max-age=31536000 or more, and includeSubDomains',
      'edge-headers _headers:4: X-Content-Type-Options is `sniff` instead of `nosniff`',
      'edge-headers _headers: `/*` does not set Referrer-Policy',
      'edge-headers _headers: `/*` does not set Cross-Origin-Opener-Policy',
      'edge-headers _headers: `/*` does not set Cross-Origin-Resource-Policy',
      'edge-headers _headers:6: Permissions-Policy item `camera=(self)`: `camera` takes `()`',
      'edge-headers _headers:2: X-Frame-Options is not allowed on any rule',
      'edge-headers _headers:7: Cache-Control on `/*`; only `/_astro/*` may set it',
    ],
  );
});

// edge-redirects

/** One case: a name, the text of `_redirects`, and the place of each finding, in order. */
type RedirectCase = readonly [name: string, text: string, wheres: readonly string[]];

function seenRedirects(cases: readonly RedirectCase[]): Seen[] {
  return cases.map(([name, text]) => {
    const report = new Report();
    checkRedirects(text, report);
    return { name, ids: [...report.ids()].sort(), wheres: report.findings.map((finding) => finding.where) };
  });
}

const statics = (count: number): string =>
  Array.from({ length: count }, (_, index) => `/alt-${index}/ /neu/ 301\n`).join('');
const dynamics = (count: number): string =>
  Array.from({ length: count }, (_, index) => `/blog-${index}/* /news/:splat 301\n`).join('');

/** A line of exactly `length` characters. */
const lineOf = (length: number): string => `/${'a'.repeat(length - '/ /b 301'.length)} /b 301\n`;

const ROWS: readonly RedirectRow[] = [
  { from: '/blog/*', to: '/news/:splat' },
  { from: '/alt/', to: '/neu/' },
  { from: '/weg/', gone: true },
];

const REDIRECT_CASES: readonly RedirectCase[] = [
  ['the empty text', '', []],
  ['the text of the kit', redirectsText(ROWS), []],
  ['the text of the kit with kept rules of an existing file', redirectsText(ROWS, '/x/* /y/ 302\n/a /b\n'), []],
  ['each status, and none', '/a /b 301\n/c /d 302\n/e /f 303\n/g /h 307\n/i /j 308\n/k /l\n', []],
  ['comments, empty lines and CRLF', '# moved\r\n\r\n/a /b 301\r\n  /c   /d   308  \r\n', []],
  ['2,000 static and 100 dynamic rules', `${statics(2000)}${dynamics(100)}`, []],
  ['2,001 static rules', statics(2001), ['_redirects']],
  ['101 dynamic rules', dynamics(101), ['_redirects']],
  [
    'a placeholder is dynamic: 101 of them',
    Array.from({ length: 101 }, (_, index) => `/u${index}/:id /user/:id 301\n`).join(''),
    ['_redirects'],
  ],
  ['a line of 1,000 characters', lineOf(1000), []],
  ['a line of 1,001 characters', lineOf(1001), ['_redirects:1']],
  ['one token', '/a /b 301\n/c\n', ['_redirects:2']],
  ['four tokens', '/a /b 301 !\n', ['_redirects:1']],
  ['a comment at the end of a line', '/a /b 301 # moved\n', ['_redirects:1']],
  ['a host rule', 'https://www.example.ch/* https://example.ch/:splat 301\n', ['_redirects:1', '_redirects:1']],
  ['a to on another host', '/a https://evil.example/ 301\n', ['_redirects:1']],
  ['a to that starts with two slashes', '/a //evil.example/ 301\n', ['_redirects:1']],
  // Cloudflare removes a dot segment, so it stores each of these with another host.
  ['a to with a . segment before two slashes', '/a /.//evil.example/ 301\n', ['_redirects:1']],
  ['a to with a .. segment before two slashes', '/a /x/..//evil.example/path 301\n', ['_redirects:1']],
  ['a to with a dot segment as %2e', '/a /%2e//evil.example/\n', ['_redirects:1']],
  ['a to with a backslash after a dot segment', '/a /./\\evil.example/ 301\n', ['_redirects:1']],
  ['a to with a dot segment in a pattern', '/b/* /.//evil.example/:splat 301\n', ['_redirects:1']],
  ['a from with a .. segment', '/x/../c/ /b/ 301\n', ['_redirects:1']],
  ['a from with a fragment', '/a#old /b/ 301\n', ['_redirects:1']],
  ['a from with a query string', '/a?id=3 /b/ 301\n', ['_redirects:1']],
  ['dots that are no dot segment, and a to with a query string and a fragment', '/a/.b/ /c/..d/?e=/../#f\n', []],
  ['from without the first slash', '/a /b 301\nc /d 301\n', ['_redirects:2']],
  ['the status 200', '/a /b 200\n', ['_redirects:1']],
  ['the status 300', '/a /b 300\n', ['_redirects:1']],
  ['a status that is no number', '/a /b permanent\n', ['_redirects:1']],
  ['a static rule after a dynamic one', '/a /b 301\n/blog/* /news/:splat 301\n/c /d 301\n', ['_redirects:3']],
  [
    'a static rule after a placeholder rule',
    '/u/:id /user/:id 301\n\n/c /d 301\n/e /f 301\n',
    ['_redirects:3', '_redirects:4'],
  ],
  ['three problems on one line', 'a /b 200 x\n', ['_redirects:1', '_redirects:1', '_redirects:1']],
];

test('edge-redirects: the limits, the line shape, and static rules before dynamic ones', () => {
  assert.equal(lineOf(1000).length, 1001, 'a line of 1,000 characters and its newline');
  assert.deepEqual(REDIRECT_LIMITS, { staticRules: 2000, dynamicRules: 100, lineChars: 1000 });
  assert.deepEqual(
    seenRedirects(REDIRECT_CASES),
    expectedOf(
      REDIRECT_CASES.map(([name, , wheres]) => [name, wheres]),
      REDIRECTS,
    ),
  );
});

test('edge-redirects reports every finding of one text, each with its detail', () => {
  const report = new Report();
  checkRedirects('/blog/* /news/:splat 301\nx /y 200 z\n/a/./b#c /.//evil.example/\n/d //evil.example/\n', report);
  assert.deepEqual(
    report.findings.map((finding) => `${finding.rule} ${finding.where}: ${finding.detail}`),
    [
      'edge-redirects _redirects:2: the line has 4 tokens; its shape is `from to [status]`',
      'edge-redirects _redirects:2: `from` must start with /',
      'edge-redirects _redirects:2: the status `200` is not one of 301, 302, 303, 307, 308',
      'edge-redirects _redirects:2: a static rule stands after a dynamic rule',
      'edge-redirects _redirects:3: fragments cannot be matched: a browser never sends the text after #',
      'edge-redirects _redirects:3: `from` must not hold a . or .. segment, also not as %2e: Cloudflare removes it',
      'edge-redirects _redirects:3: `to` must not hold a . or .. segment, also not as %2e: Cloudflare removes it',
      'edge-redirects _redirects:3: a static rule stands after a dynamic rule',
      'edge-redirects _redirects:4: `to` must not start with // or /\\: it would leave the site',
      'edge-redirects _redirects:4: a static rule stands after a dynamic rule',
    ],
  );
});

// The audit

const EMPTY_DESIGN: BuildContext['design'] = {
  themes: ['light'],
  colors: [],
  tokens: [],
  helpers: [],
  breakpoints: [],
  pairs: [],
  elements: [],
  components: [],
};

/** A build context in memory, from a map of the files of the client directory. */
function contextOf(
  options: Options,
  initial: Readonly<Record<string, string>>,
  redirects: RedirectRow[] = [],
): BuildContext {
  const texts = new Map(Object.entries(initial));
  const files = [...texts.keys()].sort();
  return {
    root: '/project',
    dist: '/project/dist',
    options,
    limits: effectiveLimits(options),
    kitVersion: '1.2.3',
    pages: [],
    css: [],
    files,
    read: (file) => {
      const text = texts.get(file);
      return text === undefined ? undefined : new TextEncoder().encode(text);
    },
    write: (file, text) => {
      texts.set(file, text);
      addFile(files, file);
    },
    facts: factsOf(),
    redirects,
    design: EMPTY_DESIGN,
    report: new Report(),
    env: {},
    now: new Date('2026-11-13T12:00:00.000Z'),
  };
}

/** One case: a name, the settings, the files of the client directory, and each finding as `<rule> <where>`. */
type AuditCase = readonly [
  name: string,
  options: Options,
  files: Readonly<Record<string, string>>,
  findings: readonly string[],
];

const AUDIT_CASES: readonly AuditCase[] = [
  ['both files of the kit', STATIC, { _headers: STATIC_TEXT, _redirects: redirectsText(ROWS) }, []],
  ['no _redirects: no redirect', STATIC, { _headers: STATIC_TEXT }, []],
  ['an empty _redirects', STATIC, { _headers: STATIC_TEXT, _redirects: '' }, []],
  ['no _headers', STATIC, { _redirects: '' }, ['edge-headers _headers']],
  ['an empty _headers', STATIC, { _headers: '', _redirects: '' }, ['edge-headers _headers']],
  [
    'the settings decide: the static text on a site with prefetch',
    PREFETCH,
    { _headers: STATIC_TEXT },
    ['edge-headers _headers'],
  ],
  [
    'a _redirects line that is not valid',
    STATIC,
    { _headers: STATIC_TEXT, _redirects: '/a\n' },
    ['edge-redirects _redirects:1'],
  ],
  [
    'both files fail',
    STATIC,
    { _headers: `${STATIC_TEXT}/x/*\n  X-Frame-Options: DENY\n`, _redirects: '/a /b 200\n' },
    ['edge-headers _headers:12', 'edge-redirects _redirects:1'],
  ],
];

test('auditEdge reads _headers and _redirects of the client directory', async () => {
  const seen: { name: string; findings: string[]; ids: string[] }[] = [];
  for (const [name, options, files] of AUDIT_CASES) {
    const ctx = contextOf(options, files);
    await auditEdge(ctx);
    seen.push({
      name,
      findings: ctx.report.findings.map((finding) => `${finding.rule} ${finding.where}`),
      ids: [...ctx.report.ids()].sort(),
    });
  }
  assert.deepEqual(
    seen,
    AUDIT_CASES.map(([name, , , findings]) => ({
      name,
      findings,
      ids: [...new Set(findings.map((finding) => finding.split(' ')[0] ?? ''))].sort(),
    })),
  );
  const missing = contextOf(STATIC, {});
  await auditEdge(missing);
  assert.deepEqual(missing.report.findings, [
    { rule: 'edge-headers', where: '_headers', detail: 'the file is missing' },
  ]);
});

/** The settings and the files that an adapter left, for a run of `writeEdgeFiles` and then the audit. */
const BUILDS: readonly (readonly [name: string, options: Options, files: Readonly<Record<string, string>>])[] = [
  ['a static site', STATIC, {}],
  ['forms, the adapter runs later', FORMS, {}],
  ['forms, the adapter ran first', FORMS, { _headers: ADAPTER_RULE, _redirects: '/old/ /new/ 301\n' }],
  ['prefetch', PREFETCH, {}],
  ['prefetch with forms, the adapter ran first', PREFETCH_FORMS, { _headers: ADAPTER_RULE }],
  ['origins', PAYMENT, {}],
];

test('the edge files that writeEdgeFiles writes pass the audit', async () => {
  const seen: { name: string; findings: unknown[] }[] = [];
  for (const [name, options, files] of BUILDS) {
    const ctx = contextOf(options, files, [...ROWS]);
    writeEdgeFiles(ctx);
    await auditEdge(ctx);
    seen.push({ name, findings: ctx.report.findings });
  }
  assert.deepEqual(
    seen,
    BUILDS.map(([name]) => ({ name, findings: [] })),
  );
});

test('a rule that another integration planted in _headers fails the build audit with edge-headers', async () => {
  const ctx = contextOf(STATIC, { _headers: '/*\n  X-Frame-Options: DENY\n/x/*\n  Cache-Control: no-store\n' });
  writeEdgeFiles(ctx);
  await auditEdge(ctx);
  assert.deepEqual([...ctx.report.ids()].sort(), ['edge-headers']);
  assert.deepEqual(
    ctx.report.findings.map((finding) => finding.where),
    ['_headers:9', '_headers:13'],
  );
});

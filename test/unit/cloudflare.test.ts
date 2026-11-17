import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parse } from 'node-html-parser';
import {
  addFile,
  type BuildContext,
  type BuiltPage,
  type Env,
  fileOfPagePath,
  isNotFoundPath,
} from '../../src/context.ts';
import { headerCsp } from '../../src/csp.ts';
import {
  ALL_PATTERN,
  ASSETS_PATTERN,
  COMPATIBILITY_DATE,
  checkWrangler,
  EDGE_FILES,
  HEADERS_FILE,
  HSTS,
  headersText,
  IMMUTABLE,
  kitHeaders,
  OTHER_WRANGLER_FILES,
  openerPolicy,
  PERMISSIONS,
  PREFETCH_HTML,
  parseHeaders,
  permissionsPolicy,
  REDIRECTS_OUT,
  RELEASE_FILE,
  ROBOTS_FILE,
  ROUTES_FILE,
  redirectsText,
  releaseText,
  renderWrangler,
  robotsText,
  routesText,
  SECURITY_FILE,
  SELF_PERMISSIONS,
  SITEMAP_FILE,
  securityText,
  siteHost,
  sitemapText,
  WORKER_NAME_CHARS,
  WRANGLER_FILE,
  workerName,
  writeEdgeFiles,
} from '../../src/hosts/cloudflare.ts';
import { effectiveLimits, type Options } from '../../src/options.ts';
import type { RedirectRow } from '../../src/redirects.ts';
import { getRule, Report } from '../../src/registry.ts';
import { EXAMPLE, type Files, factsOf, inTemp, optionsOf, origin, SMALLEST } from './fixtures.ts';
import { SPEC, specBlock, variable } from './spec.ts';

// Settings

/** A static site: no feature, no origin, no prefetch script. */
const STATIC = optionsOf(SMALLEST);
/** A site with forms: the example of 5.1. */
const FORMS = optionsOf(EXAMPLE);
const PREFETCH = optionsOf({ ...SMALLEST, prefetch: { astroPrefetch: true } });
const PREFETCH_FORMS = optionsOf({ ...EXAMPLE, prefetch: { astroPrefetch: true } });

/** A case of 9.4: the example of 5.1 with `features.scripts` and its own origins. */
const withOrigins = (origins: readonly unknown[]): Options =>
  optionsOf({ ...EXAMPLE, features: { ...EXAMPLE.features, scripts: true }, origins });

const MAPS = origin('maps.example.org', ['frame']);
const PAY = origin('js.pay.example', ['script', 'frame'], { allow: ['payment'] });
const PAY_API = origin('api.pay.example', ['connect']);
const STATS = origin('stats.example.net', ['connect'], { load: 'page' });
const NEWS = origin('news.example.com', ['form']);

// The `_headers` block of 6.3

/** The block of 6.3: `/*` with its seven headers, then `/_astro/*` with its one header. */
const HEADERS_BLOCK = specBlock('**`_headers`.** The kit', 'text');
const BLOCK_LINES = HEADERS_BLOCK.split('\n');
const POLICY_MARK = '<header policy>';
/** `/*` and its seven header lines. */
const ALL_LINES = 8;

/** The `/*` rule of the block for the settings, with more header lines at its end. */
const allRule = (options: Options, ...more: string[]): string =>
  [...BLOCK_LINES.slice(0, ALL_LINES), ...more.map((line) => `  ${line}`)]
    .map((line) => `${line.replace(POLICY_MARK, headerCsp(options))}\n`)
    .join('');

/** The `/_astro/*` rule of the block. The adapter writes the same text (13.1, item 18). */
const ASSET_RULE = BLOCK_LINES.slice(ALL_LINES)
  .map((line) => `${line}\n`)
  .join('');

/** The `/_astro/*` rule with `astroPrefetch`: the detach first, then the immutable line. */
const PREFETCH_ASSET_RULE = `${ASSETS_PATTERN}\n  ! Cache-Control\n  Cache-Control: ${IMMUTABLE}\n`;
const PREFETCH_LINE = `Cache-Control: ${PREFETCH_HTML}`;

/** What `@astrojs/cloudflare` does when it runs after the kit: its rule and an empty line, then the old text. */
const adapterAfter = (text: string): string => `${ASSET_RULE}\n${text}`;

/** The header lines of the `/*` rule of the block, as name and value. */
const blockHeaders = (options: Options): [string, string][] =>
  BLOCK_LINES.slice(1, ALL_LINES).map((line) => {
    const text = line.trim().replace(POLICY_MARK, headerCsp(options));
    const colon = text.indexOf(': ');
    return [text.slice(0, colon), text.slice(colon + 2)];
  });

/** The `Permissions-Policy` of the block: no origin. */
const PLAIN_PERMISSIONS = blockHeaders(STATIC).at(-1)?.[1] ?? '';

// Fixed values

test('the file names, the patterns and the fixed values are those of the specification', () => {
  assert.deepEqual(EDGE_FILES, [
    '_headers',
    '_redirects',
    'robots.txt',
    'sitemap.xml',
    '.well-known/security.txt',
    '_kit/release.txt',
    '_kit/routes.txt',
  ]);
  assert.deepEqual(EDGE_FILES, [
    HEADERS_FILE,
    REDIRECTS_OUT,
    ROBOTS_FILE,
    SITEMAP_FILE,
    SECURITY_FILE,
    RELEASE_FILE,
    ROUTES_FILE,
  ]);
  assert.equal(BLOCK_LINES.length, 10, 'the block of 6.3 has ten lines');
  assert.equal(BLOCK_LINES[0], ALL_PATTERN);
  assert.equal(BLOCK_LINES[8], ASSETS_PATTERN);
  assert.equal(BLOCK_LINES[9], `  Cache-Control: ${IMMUTABLE}`);
  assert.equal(BLOCK_LINES[2], `  Strict-Transport-Security: ${HSTS}`);
  assert.ok(SPEC.includes(`\`/*\` also carries \`Cache-Control: ${PREFETCH_HTML}\``), '6.3 holds the HTML value');
});

test('the Permissions-Policy has the 21 features of 6.3 in its order, and only two are for the page itself', () => {
  const items = PLAIN_PERMISSIONS.split(', ');
  assert.equal(items.length, 21);
  assert.deepEqual(
    PERMISSIONS,
    items.map((item) => item.slice(0, item.indexOf('='))),
  );
  assert.deepEqual(
    SELF_PERMISSIONS,
    items.filter((item) => item.endsWith('=(self)')).map((item) => item.slice(0, item.indexOf('='))),
  );
  assert.deepEqual(SELF_PERMISSIONS, ['autoplay', 'fullscreen']);
  assert.equal(permissionsPolicy(STATIC), PLAIN_PERMISSIONS);
});

// The seven headers

test('kitHeaders gives the seven headers of 6.3, in order', () => {
  for (const options of [STATIC, FORMS, PREFETCH]) {
    assert.deepEqual(kitHeaders(options), blockHeaders(options));
  }
  assert.equal(kitHeaders(STATIC).length, 7);
  assert.equal(kitHeaders(STATIC)[0]?.[1].includes("require-trusted-types-for 'script'"), true);
});

/** One case of 9.4: its number, its origins, and the three header values that an origin can change. */
type OriginCase = readonly [
  name: string,
  origins: readonly unknown[],
  opener: string,
  permissions: string,
  formAction: string,
];

const payment = (list: string): string => PLAIN_PERMISSIONS.replace('payment=()', `payment=(${list})`);

const ORIGIN_CASES: readonly OriginCase[] = [
  ['1: none', [], 'same-origin', PLAIN_PERMISSIONS, "form-action 'self'"],
  ['2: a frame origin', [MAPS], 'same-origin-allow-popups', PLAIN_PERMISSIONS, "form-action 'self'"],
  [
    '3: a script and frame origin with payment, and a connect origin',
    [PAY, PAY_API],
    'same-origin-allow-popups',
    payment('self "https://js.pay.example"'),
    "form-action 'self'",
  ],
  ['4: a connect origin', [STATS], 'same-origin', PLAIN_PERMISSIONS, "form-action 'self'"],
  ['5: a form origin', [NEWS], 'same-origin', PLAIN_PERMISSIONS, "form-action 'self' https://news.example.com"],
  [
    'a script origin alone',
    [origin('cdn.example.org', ['script'])],
    'same-origin-allow-popups',
    PLAIN_PERMISSIONS,
    "form-action 'self'",
  ],
  [
    'two origins allow one feature: the hosts are sorted',
    [
      origin('pay.b.example', ['frame'], { allow: ['payment'] }),
      origin('pay.a.example', ['frame'], { allow: ['payment'] }),
    ],
    'same-origin-allow-popups',
    payment('self "https://pay.a.example" "https://pay.b.example"'),
    "form-action 'self'",
  ],
  [
    'an origin allows a feature that the page itself may use',
    [origin('video.example.org', ['frame'], { allow: ['fullscreen', 'autoplay', 'geolocation'] })],
    'same-origin-allow-popups',
    PLAIN_PERMISSIONS.replace('autoplay=(self)', 'autoplay=(self "https://video.example.org")')
      .replace('fullscreen=(self)', 'fullscreen=(self "https://video.example.org")')
      .replace('geolocation=()', 'geolocation=(self "https://video.example.org")'),
    "form-action 'self'",
  ],
];

test('the headers with declared origins: COOP, Permissions-Policy and form-action follow 6.3 and 9.4', () => {
  for (const [name, origins, opener, permissions, formAction] of ORIGIN_CASES) {
    const options = withOrigins(origins);
    const headers = new Map(kitHeaders(options));
    assert.equal(openerPolicy(options), opener, name);
    assert.equal(headers.get('Cross-Origin-Opener-Policy'), opener, name);
    assert.equal(permissionsPolicy(options), permissions, name);
    assert.equal(headers.get('Permissions-Policy'), permissions, name);
    // Each case has `features.scripts`, so Trusted Types is off in all of them.
    const policy = `frame-ancestors 'none'; base-uri 'none'; object-src 'none'; ${formAction}`;
    assert.equal(headers.get('Content-Security-Policy'), policy, name);
    assert.equal(headers.get('Cross-Origin-Resource-Policy'), 'same-origin', name);
    assert.equal(headers.size, 7, name);
  }
});

// The parser

test('parseHeaders gives the rules in file order, with the line of each pattern and of each header', () => {
  const text = [
    '# a comment',
    '/*',
    '  X-A: 1',
    '',
    '  ! X-B',
    '  #X-Commented: 1',
    '/_astro/*',
    '\tCache-Control: public, max-age=1; a:b',
    'https://example.ch/x/*',
    '  x-c:3',
  ].join('\n');
  assert.deepEqual(parseHeaders(text), [
    {
      pattern: '/*',
      line: 2,
      headers: [
        { line: 3, name: 'X-A', value: '1', detach: false },
        { line: 5, name: 'X-B', value: '', detach: true },
      ],
    },
    {
      pattern: '/_astro/*',
      line: 7,
      headers: [{ line: 8, name: 'Cache-Control', value: 'public, max-age=1; a:b', detach: false }],
    },
    { pattern: 'https://example.ch/x/*', line: 9, headers: [{ line: 10, name: 'x-c', value: '3', detach: false }] },
  ]);
  assert.deepEqual(parseHeaders(''), []);
  assert.deepEqual(parseHeaders('/*\r\n  X-A: 1\r\n'), [
    { pattern: '/*', line: 1, headers: [{ line: 2, name: 'X-A', value: '1', detach: false }] },
  ]);
});

test('parseHeaders reads a line as Cloudflare does: the content decides, and a line that it ignores is dropped', () => {
  // A header at column 0 belongs to the rule before it, and an indented path starts a rule.
  assert.deepEqual(parseHeaders('/*\nX-A: 1\n  /b/*\n  X-B: 2\n'), [
    { pattern: '/*', line: 1, headers: [{ line: 2, name: 'X-A', value: '1', detach: false }] },
    { pattern: '/b/*', line: 3, headers: [{ line: 4, name: 'X-B', value: '2', detach: false }] },
  ]);
  const ignored = [
    '  X-Early: before the first pattern',
    '/*',
    '  no colon and no detach',
    '  !X-NoSpace',
    '  : no name',
    '  X-Empty:',
    '  X Space: 1',
    '  ! X-A: 1',
  ].join('\n');
  assert.deepEqual(parseHeaders(ignored), [{ pattern: '/*', line: 2, headers: [] }]);
});

// `_headers`: the merge

type MergeCase = readonly [name: string, options: Options, existing: string | undefined, expected: string];

const MERGE_CASES: readonly MergeCase[] = [
  ['a static site, no file: the block of 6.3', STATIC, undefined, `${allRule(STATIC)}${ASSET_RULE}`],
  ['a static site, an empty file', STATIC, '', `${allRule(STATIC)}${ASSET_RULE}`],
  ['forms, no file: the adapter writes the asset rule', FORMS, undefined, allRule(FORMS)],
  ['forms, the adapter ran first', FORMS, ASSET_RULE, `${allRule(FORMS)}${ASSET_RULE}`],
  [
    'forms, the adapter ran after the kit: one asset rule, after /*',
    FORMS,
    adapterAfter(allRule(FORMS)),
    `${allRule(FORMS)}${ASSET_RULE}`,
  ],
  [
    'a static site, the adapter text before the kit text',
    STATIC,
    adapterAfter(`${allRule(STATIC)}${ASSET_RULE}`),
    `${allRule(STATIC)}${ASSET_RULE}`,
  ],
  ['prefetch, no file', PREFETCH, undefined, `${allRule(PREFETCH, PREFETCH_LINE)}${PREFETCH_ASSET_RULE}`],
  [
    'prefetch with forms, no file: the kit writes the asset rule, because the adapter skips it',
    PREFETCH_FORMS,
    undefined,
    `${allRule(PREFETCH_FORMS, PREFETCH_LINE)}${PREFETCH_ASSET_RULE}`,
  ],
  [
    'prefetch with forms, the adapter ran first: one Cache-Control line, after the detach',
    PREFETCH_FORMS,
    ASSET_RULE,
    `${allRule(PREFETCH_FORMS, PREFETCH_LINE)}${PREFETCH_ASSET_RULE}`,
  ],
  [
    'prefetch: a Cache-Control of an existing /* rule is replaced',
    PREFETCH,
    '/*\n  cache-control: no-store\n  X-Robots-Tag: noindex\n',
    `${allRule(PREFETCH, PREFETCH_LINE, 'X-Robots-Tag: noindex')}${PREFETCH_ASSET_RULE}`,
  ],
  [
    'an existing /* rule: kit names are replaced, set or detached; other lines are kept; comments are dropped',
    STATIC,
    [
      '# written by another integration',
      '/*',
      '  x-content-type-options: sniff',
      '  ! Referrer-Policy',
      '  X-Robots-Tag: noindex',
      '  # an indented comment',
      '  ! X-Powered-By',
      '',
      '/downloads/*',
      '  Content-Disposition: attachment',
      '',
    ].join('\n'),
    `${allRule(STATIC, 'X-Robots-Tag: noindex', '! X-Powered-By')}${ASSET_RULE}/downloads/*\n  Content-Disposition: attachment\n`,
  ],
  [
    'without prefetch, the kit keeps a Cache-Control of an existing /* rule, and edge-headers reports it',
    STATIC,
    '/*\n  Cache-Control: no-store\n',
    `${allRule(STATIC, 'Cache-Control: no-store')}${ASSET_RULE}`,
  ],
  [
    'two existing /* rules give one',
    STATIC,
    '/*\n  X-A: 1\n/b/*\n  X-B: 2\n/*\n  X-C: 3\n',
    `${allRule(STATIC, 'X-A: 1', 'X-C: 3')}${ASSET_RULE}/b/*\n  X-B: 2\n`,
  ],
  [
    'two existing /_astro/* rules give one: the immutable line first, then their other lines',
    STATIC,
    '/_astro/*\n  Cache-Control: no-store\n  X-A: 1\n/_astro/*\n  ! Cache-Control\n  X-B: 2\n',
    `${allRule(STATIC)}${ASSET_RULE}  X-A: 1\n  X-B: 2\n`,
  ],
  [
    'forms: an existing asset rule that sets no Cache-Control keeps its lines and gets none',
    FORMS,
    '/_astro/*\n  X-A: 1\n',
    `${allRule(FORMS)}/_astro/*\n  X-A: 1\n`,
  ],
  [
    'forms: an existing asset rule with only a detach is left out',
    FORMS,
    '/_astro/*\n  ! Cache-Control\n',
    allRule(FORMS),
  ],
  [
    'prefetch: the other lines of an existing asset rule follow the two kit lines',
    PREFETCH,
    '/_astro/*\n  X-A: 1\n  Cache-Control: no-store\n',
    `${allRule(PREFETCH, PREFETCH_LINE)}${PREFETCH_ASSET_RULE}  X-A: 1\n`,
  ],
  [
    'other rules follow in file order, wherever they stood',
    STATIC,
    '/b/*\r\n  X-B: 2\r\n/*\r\n  X-A: 1\r\n/a/*\r\n  X-C:3\r\n  !  X-D\r\n',
    `${allRule(STATIC, 'X-A: 1')}${ASSET_RULE}/b/*\n  X-B: 2\n/a/*\n  X-C: 3\n  ! X-D\n`,
  ],
];

test('headersText of a static site with no file is the block of 6.3', () => {
  const expected = `${HEADERS_BLOCK.replace(POLICY_MARK, headerCsp(STATIC))}\n`;
  assert.equal(headersText(STATIC), expected);
  assert.equal(`${allRule(STATIC)}${ASSET_RULE}`, expected, 'the test builds its expected texts from the block');
});

test('headersText merges with an existing file: adapter first, adapter after, prefetch, other rules', () => {
  for (const [name, options, existing, expected] of MERGE_CASES) {
    assert.equal(headersText(options, existing), expected, name);
  }
});

test('headersText gives the same text when it runs on its own output', () => {
  for (const [name, options, existing] of MERGE_CASES) {
    const once = headersText(options, existing);
    assert.equal(headersText(options, once), once, name);
    assert.equal(headersText(options, adapterAfter(once)).split(`${ASSETS_PATTERN}\n`).length <= 2, true, name);
  }
});

test('headersText writes the /* rule first and at most one /_astro/* rule, with no empty line and no comment', () => {
  for (const [name, options, existing] of MERGE_CASES) {
    const text = headersText(options, existing);
    const patterns = parseHeaders(text).map((rule) => rule.pattern);
    assert.equal(patterns[0], ALL_PATTERN, name);
    assert.equal(patterns.filter((pattern) => pattern === ALL_PATTERN).length, 1, name);
    assert.equal(patterns.filter((pattern) => pattern === ASSETS_PATTERN).length <= 1, true, name);
    assert.equal(/\n\n|#|\r/.test(text), false, name);
    assert.equal(text.endsWith('\n'), true, name);
  }
});

test('headersText with declared origins writes the values of 9.4', () => {
  for (const [name, origins, opener, permissions, formAction] of ORIGIN_CASES) {
    const lines = headersText(withOrigins(origins)).split('\n');
    assert.equal(lines[1], `  Content-Security-Policy: ${headerCsp(withOrigins(origins))}`, name);
    assert.equal(lines[1]?.endsWith(`; ${formAction}`), true, name);
    assert.equal(lines[5], `  Cross-Origin-Opener-Policy: ${opener}`, name);
    assert.equal(lines[7], `  Permissions-Policy: ${permissions}`, name);
  }
});

// `_redirects`

type RedirectCase = readonly [name: string, rows: readonly RedirectRow[], existing: string | undefined, text: string];

const ROWS: readonly RedirectRow[] = [
  { from: '/blog/*', to: '/news/:splat' },
  { from: '/alt/', to: '/neu/' },
  { from: '/weg/', gone: true },
  { from: '/u/:id/', to: '/user/:id/' },
  { from: '/a/', to: '/b/' },
];
const ROW_LINES = '/alt/ /neu/ 301\n/a/ /b/ 301\n/blog/* /news/:splat 301\n/u/:id/ /user/:id/ 301\n';

const REDIRECT_CASES: readonly RedirectCase[] = [
  ['no row and no file: the empty text', [], undefined, ''],
  ['only gone rows: the empty text', [{ from: '/weg/', gone: true }], '', ''],
  ['static rules first, then dynamic ones; a gone row writes no line', ROWS, undefined, ROW_LINES],
  [
    'an existing file: path rules are kept, static before dynamic',
    ROWS,
    '/old/* /new/:splat 302\n/x/ /y/\n',
    '/alt/ /neu/ 301\n/a/ /b/ 301\n/x/ /y/\n/blog/* /news/:splat 301\n/u/:id/ /user/:id/ 301\n/old/* /new/:splat 302\n',
  ],
  [
    'an existing rule with a source of the kit is dropped',
    ROWS,
    '/alt/ /other/ 302\n/blog/*   /elsewhere/ 301\n/keep/ /kept/ 308\n',
    '/alt/ /neu/ 301\n/a/ /b/ 301\n/keep/ /kept/ 308\n/blog/* /news/:splat 301\n/u/:id/ /user/:id/ 301\n',
  ],
  [
    'host rules, comments and empty lines of an existing file are dropped',
    [{ from: '/alt/', to: '/neu/' }],
    '# a comment\r\n\r\nhttps://www.example.ch/* https://example.ch/:splat 301\r\n  /x/ /y/ 301  \r\nexample.ch/a /b 301\r\n',
    '/alt/ /neu/ 301\n/x/ /y/ 301\n',
  ],
  ['no row and an existing file', [], '/x/* /y/ 301\n/a/ /b/ 301', '/a/ /b/ 301\n/x/* /y/ 301\n'],
];

test('redirectsText writes the lines of redirects.json and keeps the path rules of an existing file', () => {
  for (const [name, rows, existing, text] of REDIRECT_CASES) {
    assert.equal(redirectsText(rows, existing), text, name);
    assert.equal(redirectsText(rows, text), text, `${name}: the same text on its own output`);
  }
});

// `robots.txt`

test('robotsText is the exact text of 6.3', () => {
  const block = specBlock('**`robots.txt`** (exact', 'text');
  assert.equal(robotsText('https://example.ch'), `${block.replace(variable('site'), 'https://example.ch')}\n`);
  assert.equal(
    robotsText('https://www.example.com'),
    'User-agent: *\nAllow: /\nContent-Signal: search=yes, ai-input=yes, ai-train=no\n\nSitemap: https://www.example.com/sitemap.xml\n',
  );
});

// `sitemap.xml`

const SITE = 'https://example.ch';
const NOW = new Date('2026-11-13T12:00:00.000Z');

/** One built page from the tags of its head. */
function pageOf(path: string, head = ''): BuiltPage {
  const html = `<!doctype html><html lang="de"><head>${head}</head><body><h1>A</h1></body></html>`;
  return { file: fileOfPagePath(path), path, locale: 'de', is404: isNotFoundPath(path), html, root: parse(html) };
}

const canonical = (path: string, site = SITE): string => `<link rel="canonical" href="${site}${path}">`;
const jsonLd = (value: unknown): string => `<script type="application/ld+json">${JSON.stringify(value)}</script>`;

/** A page that the sitemap lists, with more tags in its head. */
const listed = (path: string, more = ''): BuiltPage => pageOf(path, `${canonical(path)}${more}`);

const SITEMAP_HEAD =
  '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';
const SITEMAP_END = '</urlset>\n';
const url = (path: string, lastmod = ''): string =>
  `<url><loc>${SITE}${path}</loc>${lastmod === '' ? '' : `<lastmod>${lastmod}</lastmod>`}</url>\n`;

test('sitemapText is byte-exact: the head of 6.3, one line for each listed page, sorted by the URL', () => {
  // The specification writes the head with `\n` for each line end.
  assert.ok(SPEC.includes(`Starts with \`${SITEMAP_HEAD.replaceAll('\n', '\\n')}\`.`), '6.3 holds the head');

  assert.equal(sitemapText([], SITE, NOW), `${SITEMAP_HEAD}${SITEMAP_END}`);
  const pages = [
    listed('/zimmer/'),
    listed('/a/1/'),
    listed('/', jsonLd({ '@type': 'WebPage', dateModified: '2026-05-01' })),
    listed('/a/'),
    listed('/fr/'),
    listed('/404.html'),
  ];
  // By the URL, `/a/` stands before `/a/1/`. By the whole line it would not: `<` sorts after `1`.
  const expected = `${SITEMAP_HEAD}${url('/', '2026-05-01')}${url('/a/')}${url('/a/1/')}${url('/fr/')}${url('/zimmer/')}${SITEMAP_END}`;
  assert.equal(sitemapText(pages, SITE, NOW), expected);
  assert.equal(sitemapText([...pages].reverse(), SITE, NOW), expected);
});

type ListCase = readonly [name: string, page: BuiltPage, listed: boolean];

const LIST_CASES: readonly ListCase[] = [
  ['one canonical equal to the URL', listed('/a/'), true],
  ['rel in another case, with a second word', pageOf('/a/', `<link rel="Canonical nofollow" href="${SITE}/a/">`), true],
  ['a robots meta without noindex', listed('/a/', '<meta name="robots" content="index, follow">'), true],
  ['a meta of another name with noindex', listed('/a/', '<meta name="googlebot" content="noindex">'), true],
  ['/404.html', listed('/404.html'), false],
  ['no canonical', pageOf('/a/'), false],
  ['two canonicals', listed('/a/', canonical('/a/')), false],
  ['a canonical of another page', pageOf('/a/', canonical('/b/')), false],
  ['a canonical without the final slash', pageOf('/a/', `<link rel="canonical" href="${SITE}/a">`), false],
  ['a canonical of another site', pageOf('/a/', canonical('/a/', 'https://www.example.ch')), false],
  ['a canonical without href', pageOf('/a/', '<link rel="canonical">'), false],
  ['robots noindex', listed('/a/', '<meta name="robots" content="noindex">'), false],
  ['robots NOINDEX in a list', listed('/a/', '<meta name="ROBOTS" content="follow, NOINDEX">'), false],
];

test('sitemapText lists a page that is not /404.html, has one canonical of its own URL and no robots noindex', () => {
  for (const [name, page, isListed] of LIST_CASES) {
    const expected = isListed ? `${SITEMAP_HEAD}${url(page.path)}${SITEMAP_END}` : `${SITEMAP_HEAD}${SITEMAP_END}`;
    assert.equal(sitemapText([page], SITE, NOW), expected, name);
  }
});

type DateCase = readonly [name: string, head: string, lastmod: string];

const DATE_CASES: readonly DateCase[] = [
  ['a date on a WebPage node', jsonLd({ '@type': 'WebPage', dateModified: '2026-05-01' }), '2026-05-01'],
  ['a date on an Article node', jsonLd({ '@type': 'Article', dateModified: '2025-12-31' }), '2025-12-31'],
  [
    'a type list that holds WebPage',
    jsonLd({ '@type': ['FAQPage', 'WebPage'], dateModified: '2026-05-01' }),
    '2026-05-01',
  ],
  ['today', jsonLd({ '@type': 'WebPage', dateModified: '2026-11-13' }), '2026-11-13'],
  [
    'a date-time in UTC, written as given',
    jsonLd({ '@type': 'WebPage', dateModified: '2026-11-13T11:59:59Z' }),
    '2026-11-13T11:59:59Z',
  ],
  [
    'a date-time with an offset and fractions',
    jsonLd({ '@type': 'WebPage', dateModified: '2026-11-13T12:59:59.5+01:00' }),
    '2026-11-13T12:59:59.5+01:00',
  ],
  [
    'a node in a top-level list',
    jsonLd([{ '@type': 'Organization' }, { '@type': 'WebPage', dateModified: '2026-05-01' }]),
    '2026-05-01',
  ],
  [
    'a node in @graph',
    jsonLd({ '@context': 'https://schema.org', '@graph': [{ '@type': 'Article', dateModified: '2026-05-01' }] }),
    '2026-05-01',
  ],
  [
    'the first node with a date decides',
    jsonLd([
      { '@type': 'WebPage' },
      { '@type': 'WebPage', dateModified: '2026-05-01' },
      { '@type': 'Article', dateModified: '2026-06-01' },
    ]),
    '2026-05-01',
  ],
  [
    'a second block, after one that does not parse',
    `<script type="application/ld+json">{</script>${jsonLd({ '@type': 'WebPage', dateModified: '2026-05-01' })}`,
    '2026-05-01',
  ],
  ['no JSON-LD', '', ''],
  ['no dateModified', jsonLd({ '@type': 'WebPage', datePublished: '2026-05-01' }), ''],
  ['a date on a node of another type', jsonLd({ '@type': 'Organization', dateModified: '2026-05-01' }), ''],
  [
    'a date on a nested node',
    jsonLd({ '@type': 'Thing', mainEntity: { '@type': 'WebPage', dateModified: '2026-05-01' } }),
    '',
  ],
  ['tomorrow', jsonLd({ '@type': 'WebPage', dateModified: '2026-11-14' }), ''],
  ['a date-time one second after the build', jsonLd({ '@type': 'WebPage', dateModified: '2026-11-13T12:00:01Z' }), ''],
  ['a date that does not exist', jsonLd({ '@type': 'WebPage', dateModified: '2026-02-30' }), ''],
  [
    'a date-time on a day that does not exist',
    jsonLd({ '@type': 'WebPage', dateModified: '2026-02-30T10:00:00Z' }),
    '',
  ],
  ['a date-time without a zone', jsonLd({ '@type': 'WebPage', dateModified: '2026-05-01T10:00:00' }), ''],
  ['a date in words', jsonLd({ '@type': 'WebPage', dateModified: '1 May 2026' }), ''],
  ['a number', jsonLd({ '@type': 'WebPage', dateModified: 20260501 }), ''],
  [
    'the first date is not valid: no later node is used',
    jsonLd([
      { '@type': 'WebPage', dateModified: 'soon' },
      { '@type': 'WebPage', dateModified: '2026-05-01' },
    ]),
    '',
  ],
  [
    'a script of another type',
    `<script>${JSON.stringify({ '@type': 'WebPage', dateModified: '2026-05-01' })}</script>`,
    '',
  ],
];

test('sitemapText takes lastmod from dateModified of a WebPage or Article node, when it is a valid past ISO date', () => {
  for (const [name, head, lastmod] of DATE_CASES) {
    const expected = `${SITEMAP_HEAD}${url('/a/', lastmod)}${SITEMAP_END}`;
    assert.equal(sitemapText([listed('/a/', head)], SITE, NOW), expected, name);
  }
});

test('sitemapText escapes the five XML characters', () => {
  const path = '/a&b<c>d"e\'f/';
  const page = pageOf(path, `<link rel="canonical" href="${SITE}/a&amp;b&lt;c&gt;d&quot;e&#39;f/">`);
  assert.equal(
    sitemapText([page], SITE, NOW),
    `${SITEMAP_HEAD}<url><loc>${SITE}/a&amp;b&lt;c&gt;d&quot;e&apos;f/</loc></url>\n${SITEMAP_END}`,
  );
});

// `security.txt`, `release.txt`, `routes.txt`

test('securityText is the four lines of 6.3, with Expires 180 days after the build', () => {
  const block = specBlock('**`.well-known/security.txt`.**', 'text').split('\n');
  assert.equal(block.length, 4);
  const expected = [
    block[0]?.replace(variable('securityContact'), 'mailto:security@example.ch'),
    'Expires: 2027-05-12T12:00:00Z',
    'Preferred-Languages: de, fr',
    block[3]?.replace(variable('site'), 'https://example.ch'),
    '',
  ].join('\n');
  assert.equal(securityText(FORMS, NOW), expected);
  assert.equal(
    expected,
    'Contact: mailto:security@example.ch\nExpires: 2027-05-12T12:00:00Z\nPreferred-Languages: de, fr\nCanonical: https://example.ch/.well-known/security.txt\n',
  );
  assert.ok(block[1]?.startsWith('Expires: <build time + 180 days, ISO 8601, milliseconds removed, ending in Z>'));
  assert.ok(block[2]?.startsWith('Preferred-Languages: <defaultLocale, then the other codes, deduplicated'));

  // The milliseconds of the build time are cut, not rounded.
  const late = securityText(FORMS, new Date('2026-12-31T23:59:59.999Z')).split('\n');
  assert.equal(late[1], 'Expires: 2027-06-29T23:59:59Z');

  // The default locale comes first, whatever the order of `locales`.
  const french = optionsOf({
    ...EXAMPLE,
    defaultLocale: 'fr',
    legal: {
      legalNote: { de: '/de/impressum/', fr: '/mentions-legales/' },
      privacy: { de: '/de/datenschutz/', fr: '/protection-des-donnees/' },
    },
    securityContact: 'https://example.ch/security/',
  });
  const lines = securityText(french, NOW).split('\n');
  assert.equal(lines[0], 'Contact: https://example.ch/security/');
  assert.equal(lines[2], 'Preferred-Languages: fr, de');
  assert.equal(securityText(STATIC, NOW).split('\n')[2], 'Preferred-Languages: de');
});

test('releaseText is the commit, or local, and the kit with its version', () => {
  const template = `\`${variable("GITHUB_SHA || 'local'")}\\n@raess/astro-kit ${variable('version')}\\n\``;
  assert.ok(SPEC.includes(`**\`/_kit/release.txt\`.** ${template}`), '6.3 holds the text');
  const sha = '0123456789abcdef0123456789abcdef01234567';
  assert.equal(releaseText({ GITHUB_SHA: sha }, '1.2.3'), `${sha}\n@raess/astro-kit 1.2.3\n`);
  assert.equal(releaseText({}, '0.0.0'), 'local\n@raess/astro-kit 0.0.0\n');
  assert.equal(releaseText({ GITHUB_SHA: '' }, '0.1.0'), 'local\n@raess/astro-kit 0.1.0\n');
  assert.equal(releaseText({ GITHUB_SHA: undefined }, '0.1.0'), 'local\n@raess/astro-kit 0.1.0\n');
});

test('routesText is every page path except /404.html and every .pdf path, sorted, one on each line', () => {
  const pages = [pageOf('/zimmer/'), pageOf('/'), pageOf('/404.html'), pageOf('/fr/'), pageOf('/a.html')];
  const files = ['_astro/a.css', 'docs/preise.pdf', 'a.pdf', 'index.html', 'favicon.ico', 'x.pdf.txt'];
  assert.equal(routesText(pages, files), '/\n/a.html\n/a.pdf\n/docs/preise.pdf\n/fr/\n/zimmer/\n');
  assert.equal(routesText([pageOf('/404.html')], ['404.html']), '');
  assert.equal(routesText([], []), '');
});

// writeEdgeFiles

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

interface Site {
  options: Options;
  files?: Readonly<Record<string, string>>;
  pages?: BuiltPage[];
  redirects?: RedirectRow[];
  env?: Env;
}

/** A build context in memory, and the files in the order in which they were written. */
function contextOf(site: Site): { ctx: BuildContext; written: string[]; texts: Map<string, string> } {
  const texts = new Map(Object.entries(site.files ?? {}));
  const written: string[] = [];
  const files = [...texts.keys()].sort();
  const ctx: BuildContext = {
    root: '/project',
    dist: '/project/dist',
    options: site.options,
    limits: effectiveLimits(site.options),
    kitVersion: '1.2.3',
    pages: site.pages ?? [],
    css: [],
    files,
    read: (file) => {
      const text = texts.get(file);
      return text === undefined ? undefined : new TextEncoder().encode(text);
    },
    write: (file, text) => {
      texts.set(file, text);
      written.push(file);
      addFile(files, file);
    },
    facts: factsOf(),
    redirects: site.redirects ?? [],
    design: EMPTY_DESIGN,
    report: new Report(),
    env: site.env ?? {},
    now: NOW,
  };
  return { ctx, written, texts };
}

test('writeEdgeFiles writes the seven files, byte-exact, in the order of EDGE_FILES', () => {
  const pages = [
    listed('/', jsonLd({ '@type': 'WebPage', dateModified: '2026-05-01' })),
    listed('/404.html', '<meta name="robots" content="noindex">'),
    listed('/zimmer/'),
  ];
  const { ctx, written, texts } = contextOf({
    options: STATIC,
    files: { 'index.html': '', '404.html': '', 'zimmer/index.html': '', 'preise.pdf': '' },
    pages,
    redirects: [...ROWS],
    env: { GITHUB_SHA: 'abc123' },
  });
  writeEdgeFiles(ctx);

  assert.deepEqual(written, EDGE_FILES);
  assert.equal(texts.get('_headers'), `${HEADERS_BLOCK.replace(POLICY_MARK, headerCsp(STATIC))}\n`);
  assert.equal(texts.get('_redirects'), ROW_LINES);
  assert.equal(
    texts.get('robots.txt'),
    'User-agent: *\nAllow: /\nContent-Signal: search=yes, ai-input=yes, ai-train=no\n\nSitemap: https://example.ch/sitemap.xml\n',
  );
  assert.equal(texts.get('sitemap.xml'), `${SITEMAP_HEAD}${url('/', '2026-05-01')}${url('/zimmer/')}${SITEMAP_END}`);
  assert.equal(
    texts.get('.well-known/security.txt'),
    'Contact: mailto:security@example.ch\nExpires: 2027-05-12T12:00:00Z\nPreferred-Languages: de\nCanonical: https://example.ch/.well-known/security.txt\n',
  );
  assert.equal(texts.get('_kit/release.txt'), 'abc123\n@raess/astro-kit 1.2.3\n');
  assert.equal(texts.get('_kit/routes.txt'), '/\n/preise.pdf\n/zimmer/\n');
  assert.deepEqual(ctx.files, [
    '.well-known/security.txt',
    '404.html',
    '_headers',
    '_kit/release.txt',
    '_kit/routes.txt',
    '_redirects',
    'index.html',
    'preise.pdf',
    'robots.txt',
    'sitemap.xml',
    'zimmer/index.html',
  ]);
  assert.deepEqual(ctx.report.findings, [], 'writeEdgeFiles adds no finding');
});

test('writeEdgeFiles merges with the _headers and _redirects that the adapter wrote, and writes empty files too', () => {
  const forms = contextOf({
    options: FORMS,
    files: { _headers: ASSET_RULE, _redirects: '/old/ /new/ 301\n' },
    redirects: [{ from: '/alt/', to: '/neu/' }],
  });
  writeEdgeFiles(forms.ctx);
  assert.equal(forms.texts.get('_headers'), `${allRule(FORMS)}${ASSET_RULE}`);
  assert.equal(forms.texts.get('_redirects'), '/alt/ /neu/ 301\n/old/ /new/ 301\n');
  assert.equal(forms.texts.get('_kit/release.txt'), 'local\n@raess/astro-kit 1.2.3\n');

  const empty = contextOf({ options: FORMS });
  writeEdgeFiles(empty.ctx);
  assert.deepEqual(empty.written, EDGE_FILES);
  assert.equal(empty.texts.get('_headers'), allRule(FORMS));
  assert.equal(empty.texts.get('_redirects'), '');
  assert.equal(empty.texts.get('sitemap.xml'), `${SITEMAP_HEAD}${SITEMAP_END}`);
  assert.equal(empty.texts.get('_kit/routes.txt'), '');

  // A second run on its own output changes nothing.
  const before = new Map(forms.texts);
  writeEdgeFiles(forms.ctx);
  assert.deepEqual(forms.texts, before);
});

// `wrangler.jsonc`

type NameCase = readonly [site: string, host: string, worker: string];

const NAME_CASES: readonly NameCase[] = [
  ['https://example.ch', 'example.ch', 'example-ch'],
  ['https://www.example.ch', 'example.ch', 'example-ch'],
  ['https://www.hotel-laerchenwald.example.com', 'hotel-laerchenwald.example.com', 'hotel-laerchenwald-example-com'],
  ['https://a--b..c.example', 'a--b..c.example', 'a-b-c-example'],
  ['https://wwwx.example.ch', 'wwwx.example.ch', 'wwwx-example-ch'],
  // 42 characters exactly, then 43: the cut, and the cut that leaves a `-` at the end.
  [`https://${'a'.repeat(39)}.ch`, `${'a'.repeat(39)}.ch`, `${'a'.repeat(39)}-ch`],
  [`https://${'a'.repeat(40)}.ch`, `${'a'.repeat(40)}.ch`, `${'a'.repeat(40)}-c`],
  [`https://${'a'.repeat(41)}.ch`, `${'a'.repeat(41)}.ch`, 'a'.repeat(41)],
  [`https://${'a'.repeat(60)}.ch`, `${'a'.repeat(60)}.ch`, 'a'.repeat(42)],
];

test('siteHost is the host without www., and workerName follows the rule of 10.4', () => {
  assert.equal(WORKER_NAME_CHARS, 42);
  assert.ok(SPEC.includes('replaced by `-`, cut to 42 characters, with a trailing `-` removed'), '10.4 holds the rule');
  for (const [site, host, worker] of NAME_CASES) {
    assert.equal(siteHost(site), host, site);
    assert.equal(workerName(site), worker, site);
    assert.equal(`b-0123456789-${workerName(site)}-preview`.length <= 63, true, site);
  }
});

const WRANGLER_BLOCK = specBlock('**Exact text of a static site**', 'jsonc');

/** The block of 10.4 with its two variables filled in. */
const wranglerOf = (worker: string, host: string): string =>
  `${WRANGLER_BLOCK.replaceAll('<worker>', worker).replaceAll('<the host of site>', host)}\n`;

test('renderWrangler gives the exact static text of 10.4', () => {
  assert.equal(WRANGLER_FILE, 'wrangler.jsonc');
  assert.ok(WRANGLER_BLOCK.includes(`"compatibility_date": "${COMPATIBILITY_DATE}"`));
  assert.equal(WRANGLER_BLOCK.split('<worker>').length, 3, 'the block names the worker twice');
  assert.equal(renderWrangler(STATIC), wranglerOf('example-ch', 'example.ch'));

  // The route pattern is the host of `site` as written. Only the Worker name drops `www.`.
  const www = optionsOf({ ...SMALLEST, site: 'https://www.hotel-laerchenwald.example.com' });
  assert.equal(renderWrangler(www), wranglerOf('hotel-laerchenwald-example-com', 'www.hotel-laerchenwald.example.com'));
});

test('the rendering has full-line // comments only and no trailing commas: without them it is JSON', () => {
  const lines = renderWrangler(STATIC).split('\n');
  const json = lines.filter((line) => !line.trimStart().startsWith('//')).join('\n');
  assert.equal(lines.filter((line) => line.includes('//')).length, 1, 'no comment at the end of a line');
  assert.deepEqual(JSON.parse(json), {
    $schema: 'node_modules/wrangler/config-schema.json',
    name: 'example-ch',
    compatibility_date: '2026-11-01',
    assets: { directory: './dist', not_found_handling: '404-page', html_handling: 'auto-trailing-slash' },
    workers_dev: false,
    preview_urls: false,
    routes: [{ pattern: 'example.ch', custom_domain: true }],
    env: { preview: { name: 'example-ch-preview', routes: [], workers_dev: true, preview_urls: true } },
  });
});

test('renderWrangler has no text for a site with forms before milestone M7', () => {
  assert.throws(() => renderWrangler(FORMS), /M7/);
});

// config-wrangler

const RULE = 'config-wrangler';
const RENDERED = renderWrangler(STATIC);

/** One case: the files of the project root, the settings, and each finding as `<where>: <detail>`. */
type WranglerCase = readonly [name: string, files: Files, options: Options | undefined, findings: readonly string[]];

const ONLY = '`wrangler.jsonc` is the only wrangler config';

const WRANGLER_CASES: readonly WranglerCase[] = [
  ['the rendering of the kit', { [WRANGLER_FILE]: RENDERED }, STATIC, []],
  ['CRLF line ends and no final newline', { [WRANGLER_FILE]: RENDERED.trimEnd().replaceAll('\n', '\r\n') }, STATIC, []],
  ['more empty lines at the end', { [WRANGLER_FILE]: `${RENDERED}\n\n` }, STATIC, []],
  ['no wrangler.jsonc', {}, STATIC, ['wrangler.jsonc: the file is missing']],
  ['wrangler.jsonc is a folder', { 'wrangler.jsonc/x': '' }, STATIC, ['wrangler.jsonc: this is not a file']],
  [
    'a wrangler.json too',
    { [WRANGLER_FILE]: RENDERED, 'wrangler.json': '{}' },
    STATIC,
    [`wrangler.json: remove this file: ${ONLY}`],
  ],
  [
    'a wrangler.toml too',
    { [WRANGLER_FILE]: RENDERED, 'wrangler.toml': '' },
    STATIC,
    [`wrangler.toml: remove this file: ${ONLY}`],
  ],
  [
    'only a wrangler.toml',
    { 'wrangler.toml': 'name = "x"' },
    STATIC,
    [`wrangler.toml: remove this file: ${ONLY}`, 'wrangler.jsonc: the file is missing'],
  ],
  [
    'another compatibility date',
    { [WRANGLER_FILE]: RENDERED.replace(COMPATIBILITY_DATE, '2025-01-01') },
    STATIC,
    ['wrangler.jsonc:5: the kit renders `  "compatibility_date": "2026-11-01",` here'],
  ],
  [
    'the text of another site',
    { [WRANGLER_FILE]: RENDERED },
    optionsOf({ ...SMALLEST, site: 'https://example.com' }),
    ['wrangler.jsonc:4: the kit renders `  "name": "example-com",` here'],
  ],
  [
    'a comment at the end of a line',
    { [WRANGLER_FILE]: RENDERED.replace('"workers_dev": false,', '"workers_dev": false, // off') },
    STATIC,
    ['wrangler.jsonc:7: the kit renders `  "workers_dev": false,` here'],
  ],
  [
    'one more line at the end',
    { [WRANGLER_FILE]: `${RENDERED}// more\n` },
    STATIC,
    ['wrangler.jsonc:14: the text of the kit ends before this line'],
  ],
  [
    'an empty file',
    { [WRANGLER_FILE]: '' },
    STATIC,
    [`wrangler.jsonc:1: the kit renders \`${RENDERED.split('\n')[0]}\` here`],
  ],
  // Without valid settings, only the file part runs.
  ['no settings: the text is not compared', { [WRANGLER_FILE]: '{}\n' }, undefined, []],
  ['no settings: a missing file', {}, undefined, ['wrangler.jsonc: the file is missing']],
  [
    'no settings: a wrangler.toml too',
    { [WRANGLER_FILE]: '{}\n', 'wrangler.toml': '' },
    undefined,
    [`wrangler.toml: remove this file: ${ONLY}`],
  ],
  // A site with forms: milestone M7 adds its text. Until then only the file part runs.
  ['forms: the text is not compared before M7', { [WRANGLER_FILE]: RENDERED }, FORMS, []],
  ['forms: a missing file', {}, FORMS, ['wrangler.jsonc: the file is missing']],
];

interface Seen {
  name: string;
  findings: readonly string[];
  ids: string[];
}

test('config-wrangler: only wrangler.jsonc exists, and it equals the rendering for the settings', () => {
  assert.deepEqual(OTHER_WRANGLER_FILES, ['wrangler.json', 'wrangler.toml']);
  const seen: Seen[] = WRANGLER_CASES.map(([name, files, options]) => {
    const report = new Report();
    inTemp(files, (root) => checkWrangler(root, options, report));
    return {
      name,
      findings: report.findings.map((finding) => `${finding.where}: ${finding.detail}`),
      ids: [...report.ids()].sort(),
    };
  });
  const expected: Seen[] = WRANGLER_CASES.map(([name, , , findings]) => ({
    name,
    findings,
    ids: findings.length === 0 ? [] : [RULE],
  }));
  assert.deepEqual(seen, expected);
});

test('config-wrangler carries the hint of the protected task, and it is not waivable', () => {
  const hint =
    'The protected files do not match the settings. Say so in the pull request: the owner starts the protected task for this branch.';
  assert.ok(SPEC.includes(`The hint says: \`${hint}\``), '10.6 holds the hint');
  assert.equal(getRule(RULE).hint, hint);
  assert.equal(getRule(RULE).waivable, false);
  assert.equal(getRule(RULE).stage, 'config');
});

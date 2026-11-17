/**
 * The Cloudflare host: the edge files that the kit writes into the client directory at the end of a build, and
 * the rendered `wrangler.jsonc` with its rule `config-wrangler` (specification, sections 6.3 and 10.4).
 *
 * Every text function is pure. `writeEdgeFiles` reads and writes only through the build context, and
 * `checkWrangler` reads the project root.
 */
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { BuildContext, BuiltPage, Env } from '../context.ts';
import { isNotFoundPath, readText } from '../context.ts';
import { headerCsp, originSource } from '../csp.ts';
import { isRealDate, type Options } from '../options.ts';
import { isDynamic, type RedirectRow, redirectLines } from '../redirects.ts';
import type { Report } from '../registry.ts';
import { firstDifference } from '../shims.ts';

// The files

export const HEADERS_FILE = '_headers';
export const REDIRECTS_OUT = '_redirects';
export const ROBOTS_FILE = 'robots.txt';
export const SITEMAP_FILE = 'sitemap.xml';
export const SECURITY_FILE = '.well-known/security.txt';
export const RELEASE_FILE = '_kit/release.txt';
export const ROUTES_FILE = '_kit/routes.txt';

/** The seven files, in the order in which `writeEdgeFiles` writes them. */
export const EDGE_FILES: readonly string[] = [
  HEADERS_FILE,
  REDIRECTS_OUT,
  ROBOTS_FILE,
  SITEMAP_FILE,
  SECURITY_FILE,
  RELEASE_FILE,
  ROUTES_FILE,
];

// The headers

/** The pattern of the rule that holds the headers of every answer. */
export const ALL_PATTERN = '/*';
/** The pattern of the rule for the hashed files of Astro. */
export const ASSETS_PATTERN = '/_astro/*';

/** The `Cache-Control` of a hashed file. */
export const IMMUTABLE = 'public, max-age=31536000, immutable';
/** The `Cache-Control` of HTML with `astroPrefetch`, so that a prefetched page is used again on the click. */
export const PREFETCH_HTML = 'public, max-age=120';
export const HSTS = 'max-age=31536000; includeSubDomains';

export const CSP_HEADER = 'Content-Security-Policy';
export const HSTS_HEADER = 'Strict-Transport-Security';
export const OPENER_HEADER = 'Cross-Origin-Opener-Policy';
export const PERMISSIONS_HEADER = 'Permissions-Policy';
export const CACHE_CONTROL = 'Cache-Control';

/** The 21 feature names of the Permissions-Policy of 6.3, in its order. */
export const PERMISSIONS: readonly string[] = [
  'accelerometer',
  'autoplay',
  'bluetooth',
  'browsing-topics',
  'camera',
  'display-capture',
  'fullscreen',
  'geolocation',
  'gyroscope',
  'hid',
  'idle-detection',
  'local-fonts',
  'magnetometer',
  'microphone',
  'midi',
  'payment',
  'publickey-credentials-get',
  'screen-wake-lock',
  'serial',
  'usb',
  'xr-spatial-tracking',
];

/** The features that the page itself may use. Every other feature is off, unless an origin is allowed to use it. */
export const SELF_PERMISSIONS: readonly string[] = ['autoplay', 'fullscreen'];

/** The settings that decide the seven headers. `Options` fits. */
export type HeaderSettings = Pick<Options, 'features' | 'origins'>;

/** `same-origin-allow-popups` while an origin has `frame` or `script`, because such flows open windows (9.4). */
export function openerPolicy(options: HeaderSettings): 'same-origin' | 'same-origin-allow-popups' {
  const opens = options.origins.some((origin) =>
    origin.directives.some((directive) => directive === 'frame' || directive === 'script'),
  );
  return opens ? 'same-origin-allow-popups' : 'same-origin';
}

/** The hosts of the origins whose `allow` names the feature, sorted. */
export function permissionHosts(options: Pick<Options, 'origins'>, feature: string): string[] {
  return options.origins
    .filter((origin) => origin.allow.some((allowed) => allowed === feature))
    .map((origin) => origin.host)
    .sort();
}

/** The allow list of one feature with declared hosts: `self "https://<host1>" "https://<host2>"`. */
export function permissionSources(hosts: readonly string[]): string {
  return ['self', ...hosts.map((host) => `"${originSource(host)}"`)].join(' ');
}

/** The value of `Permissions-Policy` (6.3): every feature off, but for the page itself and the declared origins. */
export function permissionsPolicy(options: HeaderSettings): string {
  return PERMISSIONS.map((feature) => {
    const hosts = permissionHosts(options, feature);
    if (hosts.length > 0) return `${feature}=(${permissionSources(hosts)})`;
    return `${feature}=(${SELF_PERMISSIONS.includes(feature) ? 'self' : ''})`;
  }).join(', ');
}

/**
 * The seven headers of `/*`, in the order of 6.3, for the settings. This is the one source of the values:
 * `headersText` writes them, and `edge-headers` reads them.
 */
export function kitHeaders(options: HeaderSettings): [name: string, value: string][] {
  return [
    [CSP_HEADER, headerCsp(options)],
    [HSTS_HEADER, HSTS],
    ['X-Content-Type-Options', 'nosniff'],
    ['Referrer-Policy', 'strict-origin-when-cross-origin'],
    [OPENER_HEADER, openerPolicy(options)],
    ['Cross-Origin-Resource-Policy', 'same-origin'],
    [PERMISSIONS_HEADER, permissionsPolicy(options)],
  ];
}

// Reading `_headers`

/** One header line of a rule. `! Name` detaches the header: `detach` is true and `value` is empty. */
export interface HeaderLine {
  /** The line in the file, from 1. */
  line: number;
  /** The header name as written. Names compare in lower case. */
  name: string;
  value: string;
  detach: boolean;
}

/** One rule: a pattern with its header lines. */
export interface HeaderRule {
  pattern: string;
  /** The line of the pattern in the file, from 1. */
  line: number;
  headers: HeaderLine[];
}

/** A line that Cloudflare reads as a pattern: it starts with `/` or with a scheme, such as `https://`. */
const PATTERN_LINE = /^(\S+:\/\/|\/)/;

const DETACH_LINE = /^!\s+(\S+)$/;

/** Reads one header line. A line that Cloudflare ignores gives `undefined`. */
function headerLine(text: string, line: number): HeaderLine | undefined {
  const colon = text.indexOf(':');
  if (colon < 0) {
    const name = DETACH_LINE.exec(text)?.[1];
    return name === undefined ? undefined : { line, name, value: '', detach: true };
  }
  const name = text.slice(0, colon).trim();
  const value = text.slice(colon + 1).trim();
  if (name === '' || /\s/.test(name) || value === '') return undefined;
  return { line, name, value, detach: false };
}

/**
 * The rules of a `_headers` text, in file order. This is the one parser of the kit.
 *
 * In the usual layout a line at column 0 is a pattern and an indented line is a header. The parser reads the file
 * as Cloudflare does: it trims each line, and the content decides. A line that starts with `/` or with a scheme
 * is a pattern. Any other line is a header of the rule before it: `Name: value`, or `! Name` to detach. Comments
 * (`#`) and empty lines are dropped, and so is a line that Cloudflare ignores: a header before the first pattern,
 * a line with no colon that is no detach, an empty name or value, and a name with white space.
 */
export function parseHeaders(text: string): HeaderRule[] {
  const rules: HeaderRule[] = [];
  text.split('\n').forEach((raw, index) => {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) return;
    if (PATTERN_LINE.test(line)) {
      rules.push({ pattern: line, line: index + 1, headers: [] });
      return;
    }
    const header = headerLine(line, index + 1);
    if (header !== undefined) rules.at(-1)?.headers.push(header);
  });
  return rules;
}

/** Says whether the header line sets or detaches the name. Names compare in lower case. */
export function namesHeader(header: Pick<HeaderLine, 'name'>, name: string): boolean {
  return header.name.toLowerCase() === name.toLowerCase();
}

// Writing `_headers`

const setLine = (name: string, value: string): string => `${name}: ${value}`;
const detachLine = (name: string): string => `! ${name}`;
const lineText = (header: HeaderLine): string =>
  header.detach ? detachLine(header.name) : setLine(header.name, header.value);

/** The text of one rule: the pattern at column 0, and each header line with two spaces. */
const ruleText = (pattern: string, lines: readonly string[]): string =>
  [pattern, ...lines.map((line) => `  ${line}`)].map((line) => `${line}\n`).join('');

/**
 * The text of `_headers` (6.3), merged with the text that the client directory already holds. The adapter may
 * write its `/_astro/*` rule before or after the kit, so the merge gives the same text when it runs again on its
 * own output.
 *
 * 1. `/*` comes first, because Cloudflare applies the matching rules in file order and a detach removes only what
 *    an earlier rule set. It holds the seven headers of the kit, with `astroPrefetch` the `Cache-Control` of HTML,
 *    and then each line of an existing `/*` rule that neither sets nor detaches one of these names.
 * 2. One `/_astro/*` rule comes second. With `astroPrefetch` it detaches `Cache-Control` and sets the immutable
 *    value, also with forms: the adapter skips its rule when `/*` sets `Cache-Control`. Without `astroPrefetch`
 *    the kit sets the immutable value when forms is off, or when an existing rule set the header. Other lines of
 *    an existing `/_astro/*` rule are kept. A rule with no line is left out.
 * 3. Every other rule follows, in file order.
 * 4. Comments and empty lines are dropped.
 */
export function headersText(options: Pick<Options, 'features' | 'origins' | 'prefetch'>, existing = ''): string {
  const rules = parseHeaders(existing);
  const linesOf = (pattern: string): HeaderLine[] =>
    rules.filter((rule) => rule.pattern === pattern).flatMap((rule) => rule.headers);
  const prefetch = options.prefetch.astroPrefetch;

  const kit = kitHeaders(options);
  if (prefetch) kit.push([CACHE_CONTROL, PREFETCH_HTML]);
  const all = [
    ...kit.map(([name, value]) => setLine(name, value)),
    ...linesOf(ALL_PATTERN)
      .filter((header) => !kit.some(([name]) => namesHeader(header, name)))
      .map(lineText),
  ];

  const found = linesOf(ASSETS_PATTERN);
  const others = found.filter((header) => !namesHeader(header, CACHE_CONTROL)).map(lineText);
  const wasSet = found.some((header) => !header.detach && namesHeader(header, CACHE_CONTROL));
  const immutable = setLine(CACHE_CONTROL, IMMUTABLE);
  let assets = others;
  if (prefetch) assets = [detachLine(CACHE_CONTROL), immutable, ...others];
  else if (!options.features.forms || wasSet) assets = [immutable, ...others];

  return [
    ruleText(ALL_PATTERN, all),
    assets.length > 0 ? ruleText(ASSETS_PATTERN, assets) : '',
    ...rules
      .filter((rule) => rule.pattern !== ALL_PATTERN && rule.pattern !== ASSETS_PATTERN)
      .map((rule) => ruleText(rule.pattern, rule.headers.map(lineText))),
  ].join('');
}

// `_redirects`

/** The source of a `_redirects` line: its first token. */
const sourceOf = (line: string): string => line.split(/\s+/)[0] ?? '';

/**
 * The text of `_redirects` (6.3): the lines of `redirects.json`, and each path rule of an existing file whose
 * source the kit does not write. A host rule, a comment and any other line of the existing file are dropped.
 * All static rules stand before all dynamic ones, each group in that order. No line gives the empty text.
 */
export function redirectsText(rows: readonly RedirectRow[], existing = ''): string {
  const kit = redirectLines(rows);
  const sources = new Set(kit.map(sourceOf));
  const kept = existing
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('/') && !sources.has(sourceOf(line)));
  const lines = [...kit, ...kept];
  const dynamic = (line: string): boolean => isDynamic(sourceOf(line));
  return [...lines.filter((line) => !dynamic(line)), ...lines.filter(dynamic)].map((line) => `${line}\n`).join('');
}

// `robots.txt`

/** The text of `robots.txt` (6.3, exact). Smoke compares it byte for byte. */
export function robotsText(site: string): string {
  return `User-agent: *
Allow: /
Content-Signal: search=yes, ai-input=yes, ai-train=no

Sitemap: ${site}/sitemap.xml
`;
}

// `sitemap.xml`

const SITEMAP_HEAD =
  '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';

const XML_ESCAPES: ReadonlyMap<string, string> = new Map([
  ['&', '&amp;'],
  ['<', '&lt;'],
  ['>', '&gt;'],
  ['"', '&quot;'],
  ["'", '&apos;'],
]);

const xml = (text: string): string => text.replace(/[&<>"']/g, (character) => XML_ESCAPES.get(character) ?? character);

/** The words of an attribute value, in lower case. */
const words = (value: string | undefined, separator: RegExp): string[] =>
  (value ?? '')
    .toLowerCase()
    .split(separator)
    .map((word) => word.trim())
    .filter((word) => word !== '');

/**
 * Says whether the sitemap lists the page: it is not `/404.html`, it has exactly one canonical link, that link
 * equals the URL of the page, and no robots meta holds the word `noindex`.
 */
function isListed(page: BuiltPage, url: string): boolean {
  if (isNotFoundPath(page.path)) return false;
  const canonicals = page.root
    .querySelectorAll('link')
    .filter((link) => words(link.getAttribute('rel'), /\s+/).includes('canonical'));
  if (canonicals.length !== 1 || canonicals[0]?.getAttribute('href') !== url) return false;
  return !page.root
    .querySelectorAll('meta')
    .filter((meta) => meta.getAttribute('name')?.trim().toLowerCase() === 'robots')
    .some((meta) => words(meta.getAttribute('content'), /,/).includes('noindex'));
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const listOf = (value: unknown): readonly unknown[] => (Array.isArray(value) ? value : [value]);

/** The JSON-LD nodes of a page: each top-level value, each item of a top-level list, and each item of `@graph`. */
function jsonLdNodes(page: BuiltPage): Record<string, unknown>[] {
  const nodes: unknown[] = [];
  for (const script of page.root.querySelectorAll('script')) {
    if (script.getAttribute('type')?.trim().toLowerCase() !== 'application/ld+json') continue;
    let value: unknown;
    try {
      value = JSON.parse(script.rawText);
    } catch {
      continue;
    }
    for (const top of listOf(value)) {
      nodes.push(top);
      if (isRecord(top) && Array.isArray(top['@graph'])) nodes.push(...listOf(top['@graph']));
    }
  }
  return nodes.filter(isRecord);
}

/** The node types that carry the date of a page. */
const DATED_TYPES: readonly unknown[] = ['WebPage', 'Article'];

const DATE_TIME = /^(\d{4}-\d{2}-\d{2})T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

/** Says whether the text is an ISO date that exists and is not after `now`: `YYYY-MM-DD`, or a full date-time. */
function isPastIsoDate(text: string, now: Date): boolean {
  if (isRealDate(text)) return text <= now.toISOString().slice(0, 10);
  const day = DATE_TIME.exec(text)?.[1];
  if (day === undefined || !isRealDate(day)) return false;
  const time = Date.parse(text);
  return !Number.isNaN(time) && time <= now.getTime();
}

/**
 * The `lastmod` of a page: the first `dateModified` of a JSON-LD node whose `@type` is or holds `WebPage` or
 * `Article`, as written. A value that is no valid ISO date, or that is in the future, gives `undefined`.
 */
function lastModified(page: BuiltPage, now: Date): string | undefined {
  for (const node of jsonLdNodes(page)) {
    if (!listOf(node['@type']).some((type) => DATED_TYPES.includes(type))) continue;
    const value = node.dateModified;
    if (value === undefined) continue;
    return typeof value === 'string' && isPastIsoDate(value, now) ? value : undefined;
  }
  return undefined;
}

/**
 * The text of `sitemap.xml` (6.3): one `<url>` line for each listed page, sorted by the URL as a string, with the
 * URL and the date XML-escaped.
 */
export function sitemapText(pages: readonly BuiltPage[], site: string, now: Date): string {
  const urls = pages
    .map((page) => ({ page, url: `${site}${page.path}` }))
    .filter(({ page, url }) => isListed(page, url))
    .sort((a, b) => (a.url < b.url ? -1 : a.url > b.url ? 1 : 0))
    .map(({ page, url }) => {
      const date = lastModified(page, now);
      const lastmod = date === undefined ? '' : `<lastmod>${xml(date)}</lastmod>`;
      return `<url><loc>${xml(url)}</loc>${lastmod}</url>\n`;
    });
  return `${SITEMAP_HEAD}${urls.join('')}</urlset>\n`;
}

// `security.txt`, `release.txt` and `routes.txt`

const DAY_MS = 86_400_000;
/** `Expires` of `security.txt` is this many days after the build. */
export const SECURITY_DAYS = 180;

/** The text of `.well-known/security.txt` (6.3, RFC 9116). */
export function securityText(
  options: Pick<Options, 'site' | 'securityContact' | 'defaultLocale' | 'locales'>,
  now: Date,
): string {
  const expires = new Date(now.getTime() + SECURITY_DAYS * DAY_MS).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const languages = [...new Set([options.defaultLocale, ...options.locales.map((locale) => locale.code)])];
  return `Contact: ${options.securityContact}
Expires: ${expires}
Preferred-Languages: ${languages.join(', ')}
Canonical: ${options.site}/${SECURITY_FILE}
`;
}

/** The text of `/_kit/release.txt` (6.3). The first line is the commit. Smoke compares it with `main`. */
export function releaseText(env: Env, kitVersion: string): string {
  return `${env.GITHUB_SHA || 'local'}\n@raess/astro-kit ${kitVersion}\n`;
}

/**
 * The text of `/_kit/routes.txt` (6.3): every built page path except `/404.html`, and every `.pdf` path of the
 * client directory, one on each line, sorted. `routes-removed` reads it from production.
 */
export function routesText(pages: readonly BuiltPage[], files: readonly string[]): string {
  const paths = [
    ...pages.map((page) => page.path).filter((path) => !isNotFoundPath(path)),
    ...files.filter((file) => file.endsWith('.pdf')).map((file) => `/${file}`),
  ];
  return paths
    .sort()
    .map((path) => `${path}\n`)
    .join('');
}

/**
 * Writes the seven edge files into the client directory, in the order of `EDGE_FILES`. It merges `_headers` and
 * `_redirects` with the text that an adapter already wrote there. It adds no finding: `auditEdge` checks the two
 * files after this.
 */
export function writeEdgeFiles(ctx: BuildContext): void {
  const { options } = ctx;
  ctx.write(HEADERS_FILE, headersText(options, readText(ctx, HEADERS_FILE)));
  ctx.write(REDIRECTS_OUT, redirectsText(ctx.redirects, readText(ctx, REDIRECTS_OUT)));
  ctx.write(ROBOTS_FILE, robotsText(options.site));
  ctx.write(SITEMAP_FILE, sitemapText(ctx.pages, options.site, ctx.now));
  ctx.write(SECURITY_FILE, securityText(options, ctx.now));
  ctx.write(RELEASE_FILE, releaseText(ctx.env, ctx.kitVersion));
  ctx.write(ROUTES_FILE, routesText(ctx.pages, ctx.files));
}

// `wrangler.jsonc`

export const WRANGLER_FILE = 'wrangler.jsonc';

/** The wrangler config files that a project must not hold. */
export const OTHER_WRANGLER_FILES: readonly string[] = ['wrangler.json', 'wrangler.toml'];

/** The compatibility date of every site. A kit release changes it, and the protected task brings it to each site. */
export const COMPATIBILITY_DATE = '2026-11-01';

/** A Worker name has at most this many characters, so that `b-<10 hex>-<worker>-preview` has at most 63 (10.1). */
export const WORKER_NAME_CHARS = 42;

/** The host of `site`, as written. */
const hostOf = (site: string): string => site.replace(/^https:\/\//, '');

/** The template variable `host` (10.4): the host of `site` without a leading `www.`. */
export function siteHost(site: string): string {
  return hostOf(site).replace(/^www\./, '');
}

/**
 * The template variable `worker` (10.4): `host` with each run of `[^a-z0-9]+` replaced by `-`, cut to 42
 * characters, with a trailing `-` removed.
 */
export function workerName(site: string): string {
  return siteHost(site)
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, WORKER_NAME_CHARS)
    .replace(/-$/, '');
}

/**
 * The exact text of `wrangler.jsonc` for the settings (10.4). It has full-line `//` comments only and no trailing
 * commas, because the deploy job reads it with `jq`.
 *
 * This milestone renders the static site. With `features.forms` the function throws: milestone M7 adds that text.
 */
export function renderWrangler(options: Options): string {
  if (options.features.forms) {
    throw new Error('astro-kit: renderWrangler has no text for a site with forms yet; milestone M7 adds it.');
  }
  const worker = workerName(options.site);
  return `// Managed by @raess/astro-kit. A protected file: the kit renders it, and only the protected task changes it.
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "${worker}",
  "compatibility_date": "${COMPATIBILITY_DATE}",
  "assets": { "directory": "./dist", "not_found_handling": "404-page", "html_handling": "auto-trailing-slash" },
  "workers_dev": false,
  "preview_urls": false,
  "routes": [{ "pattern": "${hostOf(options.site)}", "custom_domain": true }],
  "env": {
    "preview": { "name": "${worker}-preview", "routes": [], "workers_dev": true, "preview_urls": true }
  }
}
`;
}

const WRANGLER_RULE = 'config-wrangler';

/**
 * The rule `config-wrangler`.
 *
 * - The file part always runs: `wrangler.jsonc` exists, and the root holds no `wrangler.json` and no
 *   `wrangler.toml`.
 * - The settings part runs with valid settings: the file equals `renderWrangler(options)` after CRLF→LF and
 *   trimEnd + newline. The finding names the first line that differs. This milestone compares a static site only.
 */
export function checkWrangler(root: string, options: Options | undefined, report: Report): void {
  for (const name of OTHER_WRANGLER_FILES) {
    if (statSync(join(root, name), { throwIfNoEntry: false }) !== undefined) {
      report.add(WRANGLER_RULE, name, `remove this file: \`${WRANGLER_FILE}\` is the only wrangler config`);
    }
  }
  const path = join(root, WRANGLER_FILE);
  const stats = statSync(path, { throwIfNoEntry: false });
  if (stats === undefined) {
    report.add(WRANGLER_RULE, WRANGLER_FILE, 'the file is missing');
    return;
  }
  if (!stats.isFile()) {
    report.add(WRANGLER_RULE, WRANGLER_FILE, 'this is not a file');
    return;
  }
  if (options === undefined || options.features.forms) return;
  const difference = firstDifference(readFileSync(path, 'utf8'), renderWrangler(options));
  if (difference === undefined) return;
  const expected =
    difference.expected === undefined
      ? 'the text of the kit ends before this line'
      : `the kit renders \`${difference.expected}\` here`;
  report.add(WRANGLER_RULE, `${WRANGLER_FILE}:${difference.line}`, expected);
}

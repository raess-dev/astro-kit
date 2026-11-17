/**
 * The edge audit: the rules `edge-headers` and `edge-redirects` on the two files that Cloudflare reads from the
 * client directory (specification, sections 6.3 and 8). It runs after `writeEdgeFiles`, so it checks what the kit
 * and every other integration left in `_headers` and `_redirects`.
 *
 * Every expected value comes from `src/hosts/cloudflare.ts`, `src/csp.ts` and `src/redirects.ts`. This module
 * holds no second copy of a header value.
 */
import type { Audit } from '../context.ts';
import { readText } from '../context.ts';
import {
  ALL_PATTERN,
  ASSETS_PATTERN,
  CACHE_CONTROL,
  CSP_HEADER,
  HEADERS_FILE,
  type HeaderRule,
  HSTS,
  HSTS_HEADER,
  IMMUTABLE,
  kitHeaders,
  namesHeader,
  PERMISSIONS_HEADER,
  PREFETCH_HTML,
  parseHeaders,
  permissionHosts,
  permissionSources,
  REDIRECTS_OUT,
  SELF_PERMISSIONS,
} from '../hosts/cloudflare.ts';
import type { Options } from '../options.ts';
import { isDynamic, REDIRECT_LIMITS, sourceProblems, targetProblems } from '../redirects.ts';
import type { Report } from '../registry.ts';

const HEADERS_RULE = 'edge-headers';
const REDIRECTS_RULE = 'edge-redirects';

/** The limits of `_headers` on Cloudflare: the rules, and the characters of one line. */
export const HEADER_LIMITS = { rules: 100, lineChars: 2_000 } as const;

/** The headers that no rule may set. The header policy has `frame-ancestors`, and the kit isolates no page. */
export const BANNED_HEADERS: readonly string[] = ['X-Frame-Options', 'Cross-Origin-Embedder-Policy'];

/** The statuses that a `_redirects` line may name. */
export const REDIRECT_STATUSES: readonly string[] = ['301', '302', '303', '307', '308'];

// `_headers`

/** The settings that decide the expected headers. `Options` fits. */
type HeaderSettings = Pick<Options, 'features' | 'origins' | 'prefetch'>;

/** The value that one rule gives a header, and the first line that sets it. */
interface Effective {
  value: string;
  line: number;
}

/**
 * The value that a rule gives a header. Cloudflare joins the values of repeated lines with a comma, so a header
 * that a rule sets twice has another value than each of its lines.
 */
function effective(rule: HeaderRule, name: string): Effective | undefined {
  const lines = rule.headers.filter((header) => !header.detach && namesHeader(header, name));
  const [first] = lines;
  if (first === undefined) return undefined;
  return { value: lines.map((header) => header.value).join(', '), line: first.line };
}

/** The directives of a policy text: trimmed, with single spaces, sorted. */
const directives = (policy: string): string[] =>
  policy
    .split(';')
    .map((directive) => directive.trim().replace(/\s+/g, ' '))
    .filter((directive) => directive !== '')
    .sort();

/** The `max-age` of a `Strict-Transport-Security` value, or `undefined`. */
function maxAge(directiveList: readonly string[]): number | undefined {
  for (const directive of directiveList) {
    const seconds = /^max-age=(\d+)$/i.exec(directive)?.[1];
    if (seconds !== undefined) return Number(seconds);
  }
  return undefined;
}

/** The smallest `max-age` that the rule accepts: the one that the kit writes. */
const MIN_MAX_AGE: number = maxAge(directives(HSTS)) ?? Number.POSITIVE_INFINITY;

/** Says what is wrong with a `Strict-Transport-Security` value, or `undefined`. */
function hstsProblem(value: string): string | undefined {
  const list = directives(value);
  const seconds = maxAge(list);
  const subDomains = list.some((directive) => directive.toLowerCase() === 'includesubdomains');
  if (seconds !== undefined && seconds >= MIN_MAX_AGE && subDomains) return undefined;
  return `${HSTS_HEADER} is \`${value}\`; it needs max-age=${MIN_MAX_AGE} or more, and includeSubDomains`;
}

/** Says what is wrong with a `Content-Security-Policy` value, or `undefined`. The directive sets compare sorted. */
function cspProblem(value: string, expected: string): string | undefined {
  if (directives(value).join('; ') === directives(expected).join('; ')) return undefined;
  return `${CSP_HEADER} is \`${value}\` instead of \`${expected}\``;
}

const PERMISSION_ITEM = /^([a-z-]+)=\(([^()]*)\)$/;

/**
 * Says what is wrong with each item of a `Permissions-Policy` value. An item is `name=()`, or `name=(self)` for
 * `autoplay` and `fullscreen`, or `name=(self "https://<host>" …)` with exactly the sorted hosts of the origins
 * whose `allow` names it.
 */
function permissionProblems(value: string, options: Pick<Options, 'origins'>): string[] {
  const problems: string[] = [];
  for (const item of value.split(',').map((part) => part.trim())) {
    const [, name = '', list = ''] = PERMISSION_ITEM.exec(item) ?? [];
    const allowed = [''];
    if (SELF_PERMISSIONS.includes(name)) allowed.push('self');
    const hosts = permissionHosts(options, name);
    if (hosts.length > 0) allowed.push(permissionSources(hosts));
    if (name !== '' && allowed.includes(list)) continue;
    const forms =
      name === ''
        ? 'an item is `name=(…)`'
        : `\`${name}\` takes ${allowed.map((entry) => `\`(${entry})\``).join(' or ')}`;
    problems.push(`${PERMISSIONS_HEADER} item \`${item}\`: ${forms}`);
  }
  return problems;
}

/** Says what is wrong with the value that `/*` gives one of the seven headers. */
function valueProblems(name: string, value: string, expected: string, options: HeaderSettings): string[] {
  if (name === CSP_HEADER) return [cspProblem(value, expected)].filter((problem) => problem !== undefined);
  if (name === HSTS_HEADER) return [hstsProblem(value)].filter((problem) => problem !== undefined);
  if (name === PERMISSIONS_HEADER) return permissionProblems(value, options);
  return value === expected ? [] : [`${name} is \`${value}\` instead of \`${expected}\``];
}

/**
 * The rule `edge-headers` on the text of `_headers`. It reports every finding. A finding on one line is at
 * `_headers:<line>`. A missing header, a missing rule and the rule limit are at `_headers`.
 */
export function checkHeaders(text: string, options: HeaderSettings, report: Report): void {
  const add = (where: string, detail: string): void => report.add(HEADERS_RULE, where, detail);
  const at = (line: number): string => `${HEADERS_FILE}:${line}`;
  const prefetch = options.prefetch.astroPrefetch;

  // The limits. Cloudflare trims a line before it counts its characters.
  text.split('\n').forEach((raw, index) => {
    const { length } = raw.trim();
    if (length > HEADER_LIMITS.lineChars) {
      add(at(index + 1), `the line has ${length} characters; the limit is ${HEADER_LIMITS.lineChars}`);
    }
  });
  const rules = parseHeaders(text);
  if (rules.length > HEADER_LIMITS.rules) {
    add(HEADERS_FILE, `${rules.length} rules; the limit is ${HEADER_LIMITS.rules}`);
  }

  // No duplicate pattern: Cloudflare keeps only the last rule of a pattern.
  const firstLines = new Map<string, number>();
  for (const rule of rules) {
    const first = firstLines.get(rule.pattern);
    if (first === undefined) firstLines.set(rule.pattern, rule.line);
    else add(at(rule.line), `duplicate pattern \`${rule.pattern}\`, first in line ${first}`);
  }

  // The seven headers of `/*`.
  const all = rules.findLast((rule) => rule.pattern === ALL_PATTERN);
  if (all === undefined) add(HEADERS_FILE, `the rule \`${ALL_PATTERN}\` is missing`);
  else {
    for (const [name, expected] of kitHeaders(options)) {
      const found = effective(all, name);
      if (found === undefined) add(HEADERS_FILE, `\`${ALL_PATTERN}\` does not set ${name}`);
      else for (const problem of valueProblems(name, found.value, expected, options)) add(at(found.line), problem);
    }
  }

  for (const rule of rules) {
    // No banned header on any rule.
    for (const header of rule.headers) {
      const banned = BANNED_HEADERS.find((name) => !header.detach && namesHeader(header, name));
      if (banned !== undefined) add(at(header.line), `${banned} is not allowed on any rule`);
    }

    // Cache-Control only where the kit puts it, with the value of the kit.
    const cache = effective(rule, CACHE_CONTROL);
    if (cache === undefined) continue;
    let expected: string | undefined;
    if (rule.pattern === ASSETS_PATTERN) expected = IMMUTABLE;
    else if (rule.pattern === ALL_PATTERN && prefetch) expected = PREFETCH_HTML;
    if (expected === undefined) {
      const places = prefetch ? `\`${ASSETS_PATTERN}\` and \`${ALL_PATTERN}\`` : `\`${ASSETS_PATTERN}\``;
      add(at(cache.line), `${CACHE_CONTROL} on \`${rule.pattern}\`; only ${places} may set it`);
    } else if (cache.value !== expected) {
      add(at(cache.line), `${CACHE_CONTROL} is \`${cache.value}\` instead of \`${expected}\``);
    }
  }

  // With prefetch, `/*` sets a Cache-Control for HTML. The asset rule must detach it, and a detach removes only
  // what an earlier rule set.
  if (!prefetch) return;
  const assets = rules.filter((rule) => rule.pattern === ASSETS_PATTERN);
  const detaches = assets.some((rule) =>
    rule.headers.some((header) => header.detach && namesHeader(header, CACHE_CONTROL)),
  );
  if (!detaches) add(HEADERS_FILE, `\`${ASSETS_PATTERN}\` needs the line \`! ${CACHE_CONTROL}\``);
  const firstAll = firstLines.get(ALL_PATTERN);
  const [firstAssets] = assets;
  if (firstAll !== undefined && firstAssets !== undefined && firstAssets.line < firstAll) {
    add(at(firstAssets.line), `\`${ASSETS_PATTERN}\` must come after \`${ALL_PATTERN}\``);
  }
}

// `_redirects`

/**
 * The rule `edge-redirects` on the text of `_redirects`. It reports every finding. A finding on one line is at
 * `_redirects:<line>`, and a limit is at `_redirects`. Empty lines and comments (`#`) are no rules, but the line limit
 * holds for them too. A `from` and a `to` pass the checks of `routes-redirects` on one path, so no line leaves the
 * site and Cloudflare stores each path as written.
 */
export function checkRedirects(text: string, report: Report): void {
  const add = (where: string, detail: string): void => report.add(REDIRECTS_RULE, where, detail);
  let statics = 0;
  let dynamics = 0;
  text.split('\n').forEach((raw, index) => {
    const line = raw.trim();
    const where = `${REDIRECTS_OUT}:${index + 1}`;
    if (line.length > REDIRECT_LIMITS.lineChars) {
      add(where, `the line has ${line.length} characters; the limit is ${REDIRECT_LIMITS.lineChars}`);
    }
    if (line === '' || line.startsWith('#')) return;
    const tokens = line.split(/\s+/);
    const [from = '', to, status] = tokens;
    if (tokens.length < 2 || tokens.length > 3) {
      add(where, `the line has ${tokens.length} tokens; its shape is \`from to [status]\``);
    }
    // The same checks as for a row of `redirects.json`: a kept line of another integration gets them here.
    for (const problem of sourceProblems(from, '`from`')) add(where, problem);
    for (const problem of to === undefined ? [] : targetProblems(to, '`to`')) add(where, problem);
    if (status !== undefined && !REDIRECT_STATUSES.includes(status)) {
      add(where, `the status \`${status}\` is not one of ${REDIRECT_STATUSES.join(', ')}`);
    }
    if (isDynamic(from)) dynamics += 1;
    else {
      statics += 1;
      if (dynamics > 0) add(where, 'a static rule stands after a dynamic rule');
    }
  });
  if (statics > REDIRECT_LIMITS.staticRules) {
    add(REDIRECTS_OUT, `${statics} static rules; the limit is ${REDIRECT_LIMITS.staticRules}`);
  }
  if (dynamics > REDIRECT_LIMITS.dynamicRules) {
    add(REDIRECTS_OUT, `${dynamics} dynamic rules; the limit is ${REDIRECT_LIMITS.dynamicRules}`);
  }
}

// The audit

/**
 * The edge audit of a build. A client directory without `_headers` is one `edge-headers` finding. A client
 * directory without `_redirects` has no redirect, and that is valid.
 */
export const auditEdge: Audit = (ctx) => {
  const headers = readText(ctx, HEADERS_FILE);
  if (headers === undefined) ctx.report.add(HEADERS_RULE, HEADERS_FILE, 'the file is missing');
  else checkHeaders(headers, ctx.options, ctx.report);
  checkRedirects(readText(ctx, REDIRECTS_OUT) ?? '', ctx.report);
};

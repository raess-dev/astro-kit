/**
 * The edge files as written to dist: _headers and _redirects within Cloudflare's limits, the security
 * headers on /*, and Cache-Control only where the kit puts it.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Audit, BuildContext } from '../context.ts';
import { headerCsp } from '../csp.ts';
import { IMMUTABLE, PREFETCH_HTML } from '../hosts/cloudflare.ts';
import { REDIRECT_LIMITS } from '../redirects.ts';

/** Cloudflare Workers static assets limits for _headers. */
export const HEADER_LIMITS = { rules: 100, lineLength: 2000 } as const;
const ASSETS = '/_astro/*';

/** Exact values; CSP, HSTS and Permissions-Policy are checked on their own. */
const EXACT: Record<string, string> = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-resource-policy': 'same-origin',
};
const REQUIRED = ['content-security-policy', 'strict-transport-security', 'permissions-policy', ...Object.keys(EXACT)];
const BANNED = ['x-frame-options', 'cross-origin-embedder-policy'];

export interface HeaderRule {
  pattern: string;
  /** Lower-cased name → value; a repeated header is comma-joined, as Cloudflare does. */
  set: Map<string, string>;
  detach: Set<string>;
}

/** A line at column 0 is a URL pattern; indented lines are `Name: value` or `! Name`. */
export function parseHeadersFile(text: string): HeaderRule[] {
  const rules: HeaderRule[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const rule = rules.at(-1);
    if (!/^\s/.test(raw) || !rule) rules.push({ pattern: line, set: new Map(), detach: new Set() });
    else if (line.startsWith('!')) rule.detach.add(line.slice(1).trim().toLowerCase());
    else {
      const colon = line.indexOf(':');
      const name = line.slice(0, colon).trim().toLowerCase();
      const value = line.slice(colon + 1).trim();
      const prior = rule.set.get(name);
      rule.set.set(name, prior === undefined ? value : `${prior}, ${value}`);
    }
  }
  return rules;
}

const directives = (csp: string): string[] =>
  csp
    .split(';')
    .map((d) => d.trim().replace(/\s+/g, ' '))
    .filter(Boolean)
    .sort();

export function checkHeadersFile(ctx: BuildContext, text: string): void {
  const add = (where: string, detail: string) => ctx.report.add('edge-headers', where, detail);
  const { options } = ctx;
  const prefetch = options.prefetch.astroPrefetch;
  for (const line of text.split(/\r?\n/)) {
    if (line.length > HEADER_LIMITS.lineLength)
      add('_headers', `a ${line.length}-character line: ${line.slice(0, 40)}`);
  }
  const rules = parseHeadersFile(text);
  if (rules.length > HEADER_LIMITS.rules) add('_headers', `${rules.length} rules, limit ${HEADER_LIMITS.rules}`);
  const patterns = rules.map((r) => r.pattern);
  for (const [i, p] of patterns.entries())
    if (patterns.indexOf(p) !== i) add(p, 'pattern appears twice; Cloudflare merges the values');

  const all = rules.find((r) => r.pattern === '/*');
  const headers = all?.set ?? new Map<string, string>();
  for (const name of REQUIRED) if (!headers.has(name)) add('/*', `${name} is missing`);
  for (const [name, value] of Object.entries(EXACT)) {
    if (headers.has(name) && headers.get(name) !== value)
      add('/*', `${name} is ${headers.get(name)}, expected ${value}`);
  }
  const csp = headers.get('content-security-policy');
  if (csp !== undefined && directives(csp).join() !== directives(headerCsp(options)).join())
    add('/*', `Content-Security-Policy is ${csp}, expected ${headerCsp(options)}`);
  const hsts = headers.get('strict-transport-security');
  if (
    hsts !== undefined &&
    !(Number(/max-age=(\d+)/i.exec(hsts)?.[1] ?? 0) >= 31_536_000 && /includeSubDomains/i.test(hsts))
  ) {
    add('/*', `Strict-Transport-Security is ${hsts}, expected a year and includeSubDomains`);
  }
  for (const item of (headers.get('permissions-policy') ?? '').split(',').map((s) => s.trim())) {
    const m = /^([a-z-]+)=\((self)?\)$/.exec(item);
    if (headers.has('permissions-policy') && (!m || (m[2] && !['fullscreen', 'autoplay'].includes(m[1] ?? ''))))
      add('/*', `Permissions-Policy item ${item || '(empty)'}`);
  }
  for (const rule of rules)
    for (const name of BANNED) if (rule.set.has(name)) add(rule.pattern, `${name} is not used by the kit`);

  // Cache-Control: immutable on /_astro/*; HTML keeps the platform default unless astroPrefetch sets max-age=120.
  for (const rule of rules) {
    const value = rule.set.get('cache-control');
    if (value === undefined) continue;
    if (rule.pattern === ASSETS) {
      if (value !== IMMUTABLE) add(ASSETS, `Cache-Control is ${value}, expected ${IMMUTABLE}`);
    } else if (rule.pattern === '/*' && prefetch) {
      if (value !== PREFETCH_HTML) add('/*', `Cache-Control is ${value}, expected ${PREFETCH_HTML}`);
    } else add(rule.pattern, `sets Cache-Control ${value}`);
  }
  const assets = rules.find((r) => r.pattern === ASSETS);
  // With forms the adapter writes the asset rule itself; with astroPrefetch it skips it, so the kit must.
  if ((prefetch || !options.features.forms) && !assets?.set.has('cache-control'))
    add(ASSETS, `Cache-Control ${IMMUTABLE} is missing`);
  if (prefetch) {
    if (!headers.has('cache-control')) add('/*', `Cache-Control ${PREFETCH_HTML} is missing`);
    if (!assets?.detach.has('cache-control')) add(ASSETS, 'must detach the HTML Cache-Control with ! Cache-Control');
    // A detach only removes what an earlier rule set.
    if (assets && all && rules.indexOf(assets) < rules.indexOf(all)) add(ASSETS, 'must come after /*');
  }
}

export function checkRedirectsFile(ctx: BuildContext, text: string): void {
  const add = (detail: string) => ctx.report.add('edge-redirects', '_redirects', detail);
  let statics = 0;
  let dynamics = 0;
  for (const line of text.split(/\r?\n/).map((l) => l.trim())) {
    if (!line || line.startsWith('#')) continue;
    if (line.length > REDIRECT_LIMITS.lineLength) add(`a ${line.length}-character line: ${line.slice(0, 40)}`);
    const [from = '', to, status, ...rest] = line.split(/\s+/);
    if (!from.startsWith('/') || !to || rest.length > 0 || (status !== undefined && !/^30[12378]$/.test(status)))
      add(`malformed line: ${line.slice(0, 80)}`);
    if (/[*:]/.test(from)) dynamics++;
    else statics++;
  }
  if (statics > REDIRECT_LIMITS.staticRules) add(`${statics} static rules, limit ${REDIRECT_LIMITS.staticRules}`);
  if (dynamics > REDIRECT_LIMITS.dynamicRules) add(`${dynamics} dynamic rules, limit ${REDIRECT_LIMITS.dynamicRules}`);
}

export const auditEdge: Audit = (ctx: BuildContext) => {
  const read = (name: string): string | undefined => {
    const file = join(ctx.dist, name);
    return existsSync(file) ? readFileSync(file, 'utf8') : undefined;
  };
  const headers = read('_headers');
  if (headers === undefined) ctx.report.add('edge-headers', '_headers', 'missing from dist');
  else checkHeadersFile(ctx, headers);
  checkRedirectsFile(ctx, read('_redirects') ?? '');
};

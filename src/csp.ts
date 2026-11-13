/**
 * The Content Security Policy of a site (specification, sections 6.2, 9.4 and 9.5): the meta policy that Astro
 * writes into every page, the header policy of `_headers`, the forbidden sources, the speculation rules with their
 * hash, and the source of the prefetch gate. Every function is pure, and every text depends only on the settings.
 */
import { createHash } from 'node:crypto';
import type { AstroUserConfig } from 'astro';
import type { Options, Origin } from './options.ts';

/** A SHA-256 hash as a CSP source without its quotes. */
export type Sha256 = `sha256-${string}`;

/** `sha256(text) = 'sha256-' + base64(SHA-256(text))`, over the UTF-8 bytes of the text. */
export function sha256(text: string): Sha256 {
  return `sha256-${createHash('sha256').update(text).digest('base64')}`;
}

// The speculation rules

/** The one static speculation-rules block of a page: prerender same-site documents at moderate eagerness. */
export const SPECULATION_RULES = {
  prerender: [
    {
      source: 'document',
      where: {
        and: [
          { href_matches: '/*' },
          { not: { href_matches: '/api/*' } },
          { not: { selector_matches: '[download], [hreflang], [target], [rel~=nofollow]' } },
        ],
      },
      eagerness: 'moderate',
    },
  ],
} as const;

/** The text of the block: compact, with the key order of the specification. */
export const SPECULATION_JSON: string = JSON.stringify(SPECULATION_RULES);

/** The hash of the block. It is static, so it is in the config before the build. */
export const SPECULATION_HASH: Sha256 = sha256(SPECULATION_JSON);

// Declared origins

/** The four things that a page may do with a declared origin (9.4). */
export type OriginDirective = Origin['directives'][number];

/** The settings that decide the policies. `Options` fits. */
export type CspSettings = Pick<Options, 'features' | 'origins'>;

/** The CSP source of a declared origin: `https://<host>`. */
export const originSource = (host: string): string => `https://${host}`;

/** The sources `https://<host>` of the origins that have the directive, sorted by host. */
export function originSources(options: Pick<Options, 'origins'>, directive: OriginDirective): string[] {
  return options.origins
    .filter((origin) => origin.directives.includes(directive))
    .map((origin) => origin.host)
    .sort()
    .map(originSource);
}

// The meta policy

/** One directive of the meta policy, as Astro's `security.csp.directives` takes it. */
export type CspDirective = NonNullable<
  Extract<NonNullable<AstroUserConfig['security']>['csp'], object>['directives']
>[number];

/** The value of `security.csp` in the locked config (6.1). */
export interface CspConfig {
  algorithm: 'SHA-256';
  directives: CspDirective[];
  scriptDirective: { resources: string[]; hashes: Sha256[] };
  styleDirective: { resources: string[] };
}

/**
 * The eleven directives of the meta policy for the settings, in the order of 6.2. Each `connect` origin adds its
 * source to `connect-src`, and each `form` origin to `form-action`. A `frame` origin replaces `'none'` in
 * `frame-src`. `features.workers` sets `worker-src 'self'`.
 */
export function metaDirectives(options: CspSettings): CspDirective[] {
  const frames = originSources(options, 'frame');
  return [
    "default-src 'self'",
    "img-src 'self'",
    "font-src 'self'",
    `connect-src ${["'self'", ...originSources(options, 'connect')].join(' ')}`,
    "media-src 'self'",
    "manifest-src 'self'",
    `worker-src ${options.features.workers ? "'self'" : "'none'"}`,
    `frame-src ${frames.length > 0 ? frames.join(' ') : "'none'"}`,
    `form-action ${["'self'", ...originSources(options, 'form')].join(' ')}`,
    "base-uri 'self'",
    "object-src 'none'",
  ];
}

/**
 * The resources of `script-src`: `'self'`, then `'wasm-unsafe-eval'` with `features.wasm`, then the source of
 * each `script` origin.
 */
export function scriptResources(options: CspSettings): string[] {
  return ["'self'", ...(options.features.wasm ? ["'wasm-unsafe-eval'"] : []), ...originSources(options, 'script')];
}

/** The resources of `style-src`. */
export const STYLE_RESOURCES: readonly string[] = ["'self'"];

/**
 * The meta policy: the value of `security.csp` (6.2). `scriptHashes` is the complete list of the kit's script
 * hashes, in this order: the Solid hash with islands, `SPECULATION_HASH` with `speculationRules`, the mode hash
 * with two or more mode options. The caller builds the list, and this function copies it. Astro adds the style
 * hashes, the hashes of its own scripts and the asset hashes itself.
 */
export function cspConfig(options: CspSettings, scriptHashes: readonly Sha256[]): CspConfig {
  return {
    algorithm: 'SHA-256',
    directives: metaDirectives(options),
    scriptDirective: { resources: scriptResources(options), hashes: [...scriptHashes] },
    styleDirective: { resources: [...STYLE_RESOURCES] },
  };
}

// The header policy

/** The two directives that turn Trusted Types on. They work only in a header. */
export const TRUSTED_TYPES: readonly string[] = ["require-trusted-types-for 'script'", "trusted-types 'none'"];

/**
 * Says whether the header policy carries Trusted Types. It is on unless `features.scripts` or `features.islands`
 * is on, or an origin has `script`. The mode script does not turn it off.
 */
export function trustedTypes(options: CspSettings): boolean {
  return !options.features.scripts && !options.features.islands && originSources(options, 'script').length === 0;
}

/** The directives of the header policy, in the order of 6.2. */
export function headerDirectives(options: CspSettings): string[] {
  return [
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "object-src 'none'",
    `form-action ${["'self'", ...originSources(options, 'form')].join(' ')}`,
    ...(trustedTypes(options) ? TRUSTED_TYPES : []),
  ];
}

/** The header policy: the value of `Content-Security-Policy` on `/*` in `_headers` (6.2). */
export function headerCsp(options: CspSettings): string {
  return headerDirectives(options).join('; ');
}

// Forbidden sources

/** The sources that no CSP of a site may hold, in lower case (6.2). `isForbiddenSource` adds two patterns. */
export const FORBIDDEN_SOURCES: readonly string[] = [
  "'unsafe-inline'",
  "'unsafe-eval'",
  "'unsafe-hashes'",
  "'strict-dynamic'",
  'data:',
  'blob:',
  'http:',
];

/**
 * Says whether one source of a CSP directive is forbidden (6.2): a source of `FORBIDDEN_SOURCES`, any token that
 * contains `*`, and any host source other than `https://<host>` of a declared origin. A quoted keyword, a hash and
 * a scheme source that the list does not name are not host sources.
 */
export function isForbiddenSource(source: string, options: Pick<Options, 'origins'>): boolean {
  const token = source.toLowerCase();
  if (FORBIDDEN_SOURCES.includes(token) || token.includes('*')) return true;
  if (token.startsWith("'") || /^[a-z][a-z0-9+.-]*:$/.test(token)) return false;
  return !options.origins.some((origin) => originSource(origin.host) === token);
}

// The prefetch gate

/**
 * The source of the prefetch gate (6.2, exact). With `prefetch.astroPrefetch`, the hook passes it to
 * `injectScript('page', …)`. Astro's own `prefetch()` runs on hover, focus or touch, and never in a browser that
 * runs the kit's speculation rules.
 */
export function prefetchGateScript(options: Pick<Options, 'prefetch'>): string {
  return `import { prefetch } from 'astro:prefetch';
const sr = ${options.prefetch.speculationRules ? 'true' : 'false'} && HTMLScriptElement.supports?.('speculationrules');
if (!sr) {
  const done = new Set();
  let timer;
  const pick = (t) => { const a = t instanceof Element ? t.closest('a[href]') : null; return a && a.origin === location.origin && !a.hasAttribute('download') && !a.target && !a.pathname.startsWith('/api/') && a.href.split('#')[0] !== location.href.split('#')[0] ? a : null; };
  const go = (a) => { if (!done.has(a.href)) { done.add(a.href); prefetch(a.href); } };
  document.addEventListener('pointerover', (e) => { const a = pick(e.target); if (a) { clearTimeout(timer); timer = setTimeout(() => go(a), 80); } }, { passive: true });
  document.addEventListener('pointerout', () => clearTimeout(timer), { passive: true });
  document.addEventListener('focusin', (e) => { const a = pick(e.target); if (a) go(a); });
  document.addEventListener('touchstart', (e) => { const a = pick(e.target); if (a) go(a); }, { passive: true });
}`;
}

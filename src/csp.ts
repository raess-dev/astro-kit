import { createHash } from 'node:crypto';
import type { KitOptions } from './options.ts';

export const sha256 = (text: string): string => `sha256-${createHash('sha256').update(text).digest('base64')}`;

/** Meta CSP directives. frame-ancestors, report-to and Trusted Types live in the _headers CSP. */
export const META_DIRECTIVES = [
  "default-src 'self'",
  "img-src 'self'",
  "font-src 'self'",
  "connect-src 'self'",
  "media-src 'self'",
  "manifest-src 'self'",
  "worker-src 'none'",
  "frame-src 'none'",
  "form-action 'self'",
  "base-uri 'self'",
  "object-src 'none'",
] as const;

/** Sources the audit rejects anywhere in a CSP. */
export const FORBIDDEN_SOURCES = ["'unsafe-inline'", "'unsafe-eval'", "'unsafe-hashes'", "'strict-dynamic'", 'data:', 'blob:', 'http:', '*'];

/** One static speculation-rules block: prerender same-origin documents at moderate eagerness. */
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

export const SPECULATION_JSON = JSON.stringify(SPECULATION_RULES);
export const SPECULATION_HASH = sha256(SPECULATION_JSON);

export function cspConfig(options: KitOptions, extraScriptHashes: readonly string[]) {
  const hashes = [...extraScriptHashes];
  if (options.prefetch.speculationRules) hashes.push(SPECULATION_HASH);
  return {
    algorithm: 'SHA-256' as const,
    directives: [...META_DIRECTIVES],
    scriptDirective: { resources: ["'self'"], hashes: hashes as `sha256-${string}`[] },
    styleDirective: { resources: ["'self'"] },
  };
}

/** Trusted Types stays on unless a feature ships code that writes HTML (Solid templates, project scripts). */
export const trustedTypes = (options: KitOptions): boolean => !options.features.scripts && !options.features.islands;

export function headerCsp(options: KitOptions): string {
  const parts = ["frame-ancestors 'none'", "base-uri 'none'", "object-src 'none'", "form-action 'self'"];
  if (trustedTypes(options)) parts.push("require-trusted-types-for 'script'", "trusted-types 'none'");
  return parts.join('; ');
}

/**
 * The gated Astro prefetch: Astro's own prefetch() is called on hover, focus or touch,
 * but never in a browser that runs the kit's speculation rules (never both in Chromium).
 */
export function prefetchGateScript(options: KitOptions): string {
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

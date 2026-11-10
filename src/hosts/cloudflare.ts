import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { BuildContext, BuiltPage } from '../context.ts';
import { headerCsp } from '../csp.ts';
import type { KitOptions } from '../options.ts';
import { redirectLines } from '../redirects.ts';

export const IMMUTABLE = 'public, max-age=31536000, immutable';
/** HTML cache with astroPrefetch, so a prefetched page is reused on click. */
export const PREFETCH_HTML = 'public, max-age=120';
const ASSETS = '/_astro/*';
const DAY = 86_400_000;

/** Every powerful feature off, except autoplay and fullscreen for the page itself. */
export const PERMISSIONS_POLICY =
  `accelerometer autoplay=(self) bluetooth browsing-topics camera display-capture fullscreen=(self)
  geolocation gyroscope hid idle-detection local-fonts magnetometer microphone midi payment publickey-credentials-get
  screen-wake-lock serial usb xr-spatial-tracking`
    .split(/\s+/)
    .map((f) => (f.includes('=') ? f : `${f}=()`))
    .join(', ');

export function securityHeaders(options: KitOptions): [string, string][] {
  return [
    ['Content-Security-Policy', headerCsp(options)],
    ['Strict-Transport-Security', 'max-age=31536000; includeSubDomains'],
    ['X-Content-Type-Options', 'nosniff'],
    ['Referrer-Policy', 'strict-origin-when-cross-origin'],
    ['Cross-Origin-Opener-Policy', 'same-origin'],
    ['Cross-Origin-Resource-Policy', 'same-origin'],
    ['Permissions-Policy', PERMISSIONS_POLICY],
  ];
}

type HeaderRule = { pattern: string; lines: string[] };

/** _headers rules in file order: a line at column 0 is a pattern, indented lines are its headers. */
export function parseHeaders(text: string): HeaderRule[] {
  const rules: HeaderRule[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (/^\s/.test(raw)) rules.at(-1)?.lines.push(line);
    else rules.push({ pattern: line, lines: [] });
  }
  return rules;
}

const nameOf = (line: string): string => (line.split(':')[0] ?? '').trim().toLowerCase();

/**
 * The merged _headers. The kit's /* rule comes first, because Cloudflare applies matching rules in order
 * and a detach only removes what an earlier rule set. An adapter's /_astro/* rule is kept, never doubled.
 */
export function headersFile(options: KitOptions, existing = ''): string {
  const rules = parseHeaders(existing);
  const prefetch = options.prefetch.astroPrefetch;
  const kit = securityHeaders(options);
  if (prefetch) kit.push(['Cache-Control', PREFETCH_HTML]);
  const names = new Set(kit.map(([n]) => n.toLowerCase()));
  const all = rules.find((r) => r.pattern === '/*');
  const assets = rules.find((r) => r.pattern === ASSETS) ?? { pattern: ASSETS, lines: [] };
  const lines = [...kit.map(([n, v]) => `${n}: ${v}`), ...(all?.lines ?? []).filter((l) => !names.has(nameOf(l)))];
  // With forms the adapter writes the asset rule, before or after this hook. With astroPrefetch it would
  // skip it, because /* now sets Cache-Control, so the kit writes it.
  if ((!options.features.forms || prefetch) && !assets.lines.some((l) => nameOf(l) === 'cache-control')) {
    assets.lines.push(`Cache-Control: ${IMMUTABLE}`);
  }
  if (prefetch && !assets.lines.some((l) => /^!\s*cache-control$/i.test(l))) assets.lines.unshift('! Cache-Control');
  const out = [
    { pattern: '/*', lines },
    ...(assets.lines.length ? [assets] : []),
    ...rules.filter((r) => r !== all && r !== assets),
  ];
  return `${out.map((r) => [r.pattern, ...r.lines.map((l) => `  ${l}`)].join('\n')).join('\n')}\n`;
}

const sourceOf = (line: string): string => line.split(/\s+/)[0] ?? '';
const isDynamic = (line: string): boolean => /[*:]/.test(sourceOf(line));

/** The kit's lines plus path rules already in the file (host rules are dropped); static before dynamic. */
export function redirectsFile(lines: string[], existing = ''): string {
  const ours = new Set(lines.map(sourceOf));
  const theirs = existing
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.startsWith('/') && !ours.has(sourceOf(l)));
  const all = [...lines, ...theirs];
  const sorted = [...all.filter((l) => !isDynamic(l)), ...all.filter(isDynamic)];
  return sorted.length ? `${sorted.join('\n')}\n` : '';
}

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' };
const xml = (s: string): string => s.replace(/[&<>"']/g, (c) => ESC[c] ?? c);

/** Listed: not the 404, one canonical equal to its own URL, and no robots noindex. */
export function inSitemap(page: BuiltPage, site: string): boolean {
  if (page.is404) return false;
  const canonicals = page.doc
    .querySelectorAll('link')
    .filter((l) => (l.getAttribute('rel') ?? '').toLowerCase().split(/\s+/).includes('canonical'));
  const robots = page.doc.querySelectorAll('meta').filter((m) => m.getAttribute('name')?.toLowerCase() === 'robots');
  const noindex = robots.some((m) => /noindex/i.test(m.getAttribute('content') ?? ''));
  return canonicals.length === 1 && canonicals[0]?.getAttribute('href') === `${site}${page.path}` && !noindex;
}

export function sitemapXml(pages: readonly BuiltPage[], site: string): string {
  const urls = pages
    .filter((p) => inSitemap(p, site))
    .map((p) => {
      const updated = p.record?.updated;
      const lastmod = updated && /^\d{4}-\d{2}-\d{2}/.test(updated) ? `<lastmod>${xml(updated)}</lastmod>` : '';
      return `<url><loc>${xml(`${site}${p.path}`)}</loc>${lastmod}</url>`;
    })
    .sort();
  const head = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';
  return `${head}${urls.map((u) => `${u}\n`).join('')}</urlset>\n`;
}

export function robotsTxt(site: string): string {
  return `User-agent: *\nAllow: /\nContent-Signal: search=yes, ai-input=yes, ai-train=no\n\nSitemap: ${site}/sitemap.xml\n`;
}

/** RFC 9116; Expires is 180 days after the build. */
export function securityTxt(options: KitOptions, now: Date): string {
  const expires = new Date(now.getTime() + 180 * DAY).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const languages = [...new Set([options.defaultLocale, ...options.locales.map((l) => l.code)])];
  return [
    `Contact: ${options.securityContact}`,
    `Expires: ${expires}`,
    `Preferred-Languages: ${languages.join(', ')}`,
    `Canonical: ${options.site}/.well-known/security.txt`,
    '',
  ].join('\n');
}

/** Writes the edge files into dist, merged with what an adapter already wrote there. */
export function writeEdgeFiles(ctx: BuildContext, kitVersion: string): void {
  const { dist, options } = ctx;
  const read = (name: string): string => (existsSync(join(dist, name)) ? readFileSync(join(dist, name), 'utf8') : '');
  const write = (name: string, text: string): void => {
    mkdirSync(dirname(join(dist, name)), { recursive: true });
    writeFileSync(join(dist, name), text);
    if (!ctx.files.includes(name)) ctx.files.push(name);
  };
  // src/audit/edge.ts checks both files after this.
  write('_headers', headersFile(options, read('_headers')));
  write('_redirects', redirectsFile(redirectLines(ctx.redirects), read('_redirects')));
  write('sitemap.xml', sitemapXml(ctx.pages, options.site));
  write('robots.txt', robotsTxt(options.site));
  write('.well-known/security.txt', securityTxt(options, new Date()));
  // The first line is the commit; smoke compares it with main.
  write('_kit/release.txt', `${ctx.env.GITHUB_SHA || 'local'}\n@raess/astro-kit ${kitVersion}\n`);
}

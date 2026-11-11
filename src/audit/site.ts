/**
 * Cross-page and content audits: hreflang, links, click depth, facts, legal pages, translations, language, glossary.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { HTMLElement, TextNode } from 'node-html-parser';
import type { Audit, BuildContext, BuiltPage } from '../context.ts';
import type { SiteFacts } from '../facts.ts';
import { PAGES_DIR } from '../manifest.ts';
import { DE_CH_BANNED, GENERIC_LINK_TEXT, STOPWORDS } from './text.ts';

export const GLOSSARY_FILE = 'src/content/glossary.json';

const SKIP = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT']);
const BLOCK = new Set(
  'ADDRESS ARTICLE ASIDE BLOCKQUOTE BR BUTTON DD DETAILS DIV DL DT FIELDSET FIGCAPTION FIGURE FOOTER FORM H1 H2 H3 H4 H5 H6 HEADER HR LABEL LI MAIN NAV OL OPTION P SECTION SUMMARY TABLE TD TH TR UL'.split(
    ' ',
  ),
);
const TEXT_BLOCKS = 'p, li, td, blockquote';

const norm = (s: string): string => s.replace(/\s+/g, ' ').trim();
const primary = (lang: string): string => lang.toLowerCase().split('-')[0] ?? '';
const safeDecode = (s: string): string => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};
const mainOf = (page: BuiltPage): HTMLElement =>
  page.doc.querySelector('main') ?? page.doc.querySelector('body') ?? page.doc;
const indexable = (page: BuiltPage): boolean =>
  !page.is404 && !/noindex/i.test(page.doc.querySelector('meta[name="robots"]')?.getAttribute('content') ?? '');

/** Visible text; block elements are space-separated. With lang, descendants marked with another language are left out. */
export function textOf(el: HTMLElement, lang?: string): string {
  let out = '';
  for (const node of el.childNodes) {
    if (node.nodeType === 3) out += (node as TextNode).text;
    if (node.nodeType !== 1) continue;
    const child = node as HTMLElement;
    const own = child.getAttribute('lang');
    if (SKIP.has(child.tagName) || (lang && own && primary(own) !== lang)) continue;
    const inner = textOf(child, lang);
    out += BLOCK.has(child.tagName) ? ` ${inner} ` : inner;
  }
  return out;
}

function nameFrom(el: HTMLElement): string {
  let out = '';
  for (const node of el.childNodes) {
    if (node.nodeType === 3) out += (node as TextNode).text;
    if (node.nodeType !== 1) continue;
    const child = node as HTMLElement;
    if (SKIP.has(child.tagName) || child.getAttribute('aria-hidden') === 'true' || child.hasAttribute('hidden'))
      continue;
    out +=
      child.getAttribute('aria-label') ??
      (child.tagName === 'IMG' ? (child.getAttribute('alt') ?? '') : nameFrom(child));
  }
  return out;
}

/** Accessible name of a link: aria-labelledby, aria-label, then content (visually hidden text and img alt included). */
export function accessibleName(a: HTMLElement, doc: HTMLElement): string {
  const refs = (a.getAttribute('aria-labelledby') ?? '')
    .split(/\s+/)
    .flatMap((id) => (id ? (doc.getElementById(id) ?? []) : []));
  if (refs.length) return norm(refs.map(nameFrom).join(' '));
  return norm(a.getAttribute('aria-label') ?? '') || norm(nameFrom(a)) || norm(a.getAttribute('title') ?? '');
}

/** Same-origin href → raw path and fragment; undefined for other origins and schemes. */
function sameOrigin(href: string, site: string, here: string) {
  const abs = /^(?:(https?):)?\/\/([^/?#]*)(.*)$/i.exec(href);
  if (abs ? abs[2]?.toLowerCase() !== site.slice('https://'.length) : /^[a-z][a-z0-9+.-]*:/i.test(href))
    return undefined;
  const rest = abs ? (abs[3] ?? '') : href;
  const hash = rest.indexOf('#');
  const path = hash < 0 ? rest : rest.slice(0, hash);
  return {
    path: !abs && path === '' && hash === 0 ? here : path,
    fragment: hash < 0 ? undefined : rest.slice(hash + 1),
    http: abs?.[1]?.toLowerCase() === 'http',
  };
}

function redirectMatches(from: string, path: string): boolean {
  if (!/[*:]/.test(from)) return from === path;
  const pattern = from
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/:[A-Za-z]\w*/g, '[^/]+');
  return new RegExp(`^${pattern}$`).test(path);
}

// ── facts ────────────────────────────────────────────────────────────────────

export interface Fact {
  kind: 'email' | 'phone' | 'uid' | 'iban' | 'chf';
  raw: string;
  /** Normalised: lower-case email, E.164 phone, CHE-123.456.789, IBAN without spaces, amount text as rendered. */
  value: string;
}

const NUM = String.raw`(?:\d{1,3}(?:[' ]\d{3})+|\d+)(?:[.,](?:\d{2}|[-–—]{1,2}))?`;
const FACT_PATTERNS: [Fact['kind'], RegExp, (m: RegExpMatchArray) => string][] = [
  ['email', /[\w.%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}/gi, (m) => m[0].toLowerCase()],
  [
    'iban',
    /(?<![A-Z0-9])[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,3})?(?![A-Z0-9])/g,
    (m) => m[0].replace(/ /g, ''),
  ],
  ['uid', /CHE[- ]?(\d{3})\.?(\d{3})\.?(\d{3})/g, (m) => `CHE-${m[1]}.${m[2]}.${m[3]}`],
  ['chf', new RegExp(String.raw`CHF ?${NUM}(?!\d)|(?<![\d'.,])${NUM} ?CHF(?![A-Za-z])`, 'g'), (m) => m[0]],
  [
    'phone',
    /(?<![\d+.,'])(?:(?:\+|00)41 ?(?:\(0\) ?)?|0)(\d{2}(?:[ ./-]?\d){7})(?!\d)/g,
    (m) => `+41${(m[1] ?? '').replace(/\D/g, '')}`,
  ],
];

const flat = (s: string): string => s.replace(/\s+/g, ' ').replace(/[’ʼ]/g, "'");

/** Emails, Swiss phone numbers, CHE-UIDs, IBANs and CHF amounts in a text. Each match is blanked before the next pattern runs. */
export function extractFacts(input: string): Fact[] {
  let text = flat(input);
  const out: Fact[] = [];
  for (const [kind, re, value] of FACT_PATTERNS) {
    for (const m of text.matchAll(re)) out.push({ kind, raw: m[0].trim(), value: value(m) });
    text = text.replace(re, (s) => ' '.repeat(s.length));
  }
  return out;
}

function e164(tel: string): string {
  const d = tel.replace('(0)', '').replace(/[^\d+]/g, '');
  if (d.startsWith('+')) return d;
  if (d.startsWith('00')) return `+${d.slice(2)}`;
  return d.startsWith('0') ? `+41${d.slice(1)}` : d;
}

/** site.json prices as formatMoney() renders them for a locale: rendered text → price key. */
function pricesFor(ctx: BuildContext, locale: string): Map<string, string> {
  const tag = ctx.options.locales.find((l) => l.code === locale)?.tag ?? locale;
  const fmt = (amount: number, currency: string) =>
    flat(new Intl.NumberFormat(tag, { style: 'currency', currency }).format(amount / 100));
  return new Map((ctx.site?.prices ?? []).map((p) => [fmt(p.amount, p.currency), `price:${p.id}`]));
}

/** The site.json key a fact equals, or undefined. */
function factKey(f: Fact, site: SiteFacts, prices: Map<string, string>): string | undefined {
  const equal: Record<Fact['kind'], boolean> = {
    email: f.value === site.email.toLowerCase(),
    phone: f.value === site.phone,
    uid: f.value === site.uid || (site.vatId?.includes(f.value) ?? false),
    iban: f.value === site.iban?.replace(/ /g, ''),
    chf: prices.has(flat(f.value)),
  };
  if (!equal[f.kind]) return undefined;
  return f.kind === 'chf' ? prices.get(flat(f.value)) : f.kind;
}

function checkFacts(ctx: BuildContext): void {
  const site = ctx.site;
  if (!site) return;
  for (const page of ctx.pages) {
    const body = page.doc.querySelector('body') ?? page.doc;
    const facts = extractFacts(textOf(body));
    for (const a of body.querySelectorAll('a[href]')) {
      const href = a.getAttribute('href') ?? '';
      if (/^mailto:/i.test(href))
        facts.push({ kind: 'email', raw: href, value: safeDecode(href.slice(7).split('?')[0] ?? '').toLowerCase() });
      if (/^tel:/i.test(href)) facts.push({ kind: 'phone', raw: href, value: e164(href.slice(4)) });
    }
    const prices = pricesFor(ctx, page.locale);
    const want = {
      email: site.email,
      phone: site.phone,
      uid: site.uid,
      iban: site.iban,
      chf: [...prices.keys()].join(', '),
    };
    const seen = new Set<string>();
    for (const f of facts) {
      if (seen.has(f.raw) || factKey(f, site, prices)) continue;
      seen.add(f.raw);
      ctx.report.add('facts-value', page.path, `${f.kind} "${f.raw}"; site.json has ${want[f.kind] || 'none'}`);
    }
  }
}

// ── hreflang ─────────────────────────────────────────────────────────────────

function checkHreflang(ctx: BuildContext): void {
  const { site, locales, defaultLocale } = ctx.options;
  const add = (rule: string, page: BuiltPage, detail: string) => ctx.report.add(rule, page.path, detail);
  const codeOf = (value: string) => {
    const v = value.toLowerCase();
    return v === 'x-default' ? v : locales.find((l) => l.code === v || l.tag.toLowerCase() === v)?.code;
  };
  // page path → locale code (or x-default) → href
  const alts = new Map<string, Map<string, string>>();
  for (const page of ctx.pages) {
    const map = new Map<string, string>();
    for (const link of page.doc.querySelectorAll('link[hreflang]')) {
      if (!(link.getAttribute('rel') ?? '').split(/\s+/).includes('alternate')) continue;
      const value = link.getAttribute('hreflang') ?? '';
      const href = link.getAttribute('href') ?? '';
      const code = codeOf(value);
      if (!code) add('hreflang-reciprocal', page, `hreflang "${value}" is not a configured locale`);
      else if (map.has(code)) add('hreflang-reciprocal', page, `hreflang "${value}" appears twice`);
      else map.set(code, href);
      if (!href.startsWith(`${site}/`))
        add('hreflang-reciprocal', page, `hreflang "${value}" href "${href}" is not absolute under ${site}`);
    }
    alts.set(page.path, map);
  }
  for (const page of ctx.pages) {
    const map = alts.get(page.path) ?? new Map<string, string>();
    const cluster = page.record ? ctx.manifest.byId[page.record.id] : undefined;
    // A page without translations needs no hreflang.
    if (page.is404 || (map.size === 0 && Object.keys(cluster ?? {}).length <= 1)) continue;
    const self = `${site}${page.path}`;
    if (cluster) {
      // The cluster is exactly the published variants; when every page passes this, reciprocity follows.
      for (const [code, rec] of Object.entries(cluster)) {
        const href = map.get(code);
        if (href !== `${site}${rec.path}`)
          add('hreflang-reciprocal', page, `hreflang ${code} is ${href ?? 'missing'}, expected ${site}${rec.path}`);
      }
      for (const code of map.keys()) {
        if (code !== 'x-default' && !cluster[code])
          add('hreflang-reciprocal', page, `hreflang ${code} has no published variant of this page`);
      }
    } else {
      if (![...map.values()].includes(self))
        add('hreflang-reciprocal', page, 'the alternates do not include the page itself');
      for (const [code, href] of map) {
        if (code === 'x-default' || href === self) continue;
        const back = alts.get(href.slice(site.length));
        if (!back) add('hreflang-reciprocal', page, `${href} is not an emitted page`);
        else if (![...back.values()].includes(self))
          add('hreflang-reciprocal', page, `${href} does not list ${self} back`);
      }
    }
    const main = cluster?.[defaultLocale];
    const expected = main ? `${site}${main.path}` : map.get(defaultLocale);
    const xd = map.get('x-default');
    if (expected && xd !== expected)
      add('hreflang-x-default', page, `x-default is ${xd ?? 'missing'}, expected ${expected}`);
  }
}

// ── links ────────────────────────────────────────────────────────────────────

/** Checks every a[href]; returns the internal link graph (page path → linked page paths). */
function checkLinks(ctx: BuildContext, byPath: Map<string, BuiltPage>): Map<string, Set<string>> {
  const files = new Set(ctx.files.filter((f) => !f.endsWith('.html')).map((f) => `/${f}`));
  const ids = new Map<string, Set<string>>();
  const idsOf = (page: BuiltPage): Set<string> => {
    const known = ids.get(page.path) ?? new Set(page.doc.querySelectorAll('[id]').map((e) => e.id));
    ids.set(page.path, known);
    return known;
  };
  const graph = new Map<string, Set<string>>();
  for (const page of ctx.pages) {
    const targets = new Set<string>();
    graph.set(page.path, targets);
    const names = new Map<string, string>();
    const seen = new Set<string>();
    const add = (rule: string, detail: string) => {
      if (!seen.has(rule + detail)) ctx.report.add(rule, page.path, detail);
      seen.add(rule + detail);
    };
    for (const a of page.doc.querySelectorAll('a[href]')) {
      const href = (a.getAttribute('href') ?? '').trim();
      const target = (a.getAttribute('target') ?? '').toLowerCase();
      if (target && !['_self', '_top', '_parent'].includes(target))
        add('links-target-blank', `${href} target="${target}"`);

      const name = accessibleName(a, page.doc);
      const key = name.toLowerCase();
      if (!name) add('links-generic', `${href} has no accessible name`);
      else if (GENERIC_LINK_TEXT.has(key.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')))
        add('links-generic', `${href} "${name}"`);

      const local = sameOrigin(href, ctx.options.site, page.path);
      const resolved = local ? `${local.path}${local.fragment === undefined ? '' : `#${local.fragment}`}` : href;
      const other = names.get(key);
      if (key && other !== undefined && other !== resolved)
        add('links-same-name', `"${name}" links to ${other} and ${resolved}`);
      if (key && other === undefined) names.set(key, resolved);
      if (!local) continue;

      const { path, fragment } = local;
      if (local.http) add('links-resolve', `${href} uses http`);
      const moved = ctx.redirects.find((r) => redirectMatches(r.from, path));
      const dest = byPath.get(path);
      if (moved)
        add(
          'links-resolve',
          `${href} is a redirects.json source; ${moved.to ? `link ${moved.to}` : 'the page is gone'}`,
        );
      else if (dest) {
        if (dest.path !== page.path) targets.add(dest.path);
        if (fragment !== undefined && !idsOf(dest).has(safeDecode(fragment)))
          add('links-resolve', `${href}: no id "${fragment}" on ${path}`);
      } else if (!files.has(path) && !files.has(safeDecode(path)))
        add('links-resolve', `${href} is not an emitted path`);
    }
  }
  return graph;
}

/** Click depth from each locale home, and the link to each locale's sitemap page. */
function checkReach(ctx: BuildContext, graph: Map<string, Set<string>>): void {
  const limit = ctx.limits.clickDepth;
  for (const { code } of ctx.options.locales) {
    const pages = ctx.pages.filter((p) => p.locale === code && indexable(p));
    if (pages.length === 0) continue;
    const home = ctx.manifest.byId.home?.[code];
    const sitemap = ctx.manifest.byId.sitemap?.[code];
    if (!home) ctx.report.add('links-depth', `${PAGES_DIR}/${code}`, 'no page with id home');
    if (!sitemap) ctx.report.add('links-sitemap-page', `${PAGES_DIR}/${code}`, 'no page with id sitemap');
    const depth = new Map<string, number>(home ? [[home.path, 0]] : []);
    const queue = [...depth.keys()];
    for (let i = 0; i < queue.length; i++) {
      const path = queue[i] ?? '';
      const d = depth.get(path) ?? 0;
      if (d >= limit) continue;
      for (const next of graph.get(path) ?? []) {
        if (depth.has(next)) continue;
        depth.set(next, d + 1);
        queue.push(next);
      }
    }
    for (const page of pages) {
      if (home && !depth.has(page.path))
        ctx.report.add('links-depth', page.path, `not reachable within ${limit} clicks from ${home.path}`);
      if (sitemap && page.path !== sitemap.path && !graph.get(page.path)?.has(sitemap.path)) {
        ctx.report.add('links-sitemap-page', page.path, `no link to ${sitemap.path}`);
      }
    }
  }
}

// ── legal ────────────────────────────────────────────────────────────────────

function checkLegal(ctx: BuildContext, byPath: Map<string, BuiltPage>): void {
  const { byId } = ctx.manifest;
  for (const { code } of ctx.options.locales) {
    for (const id of ['imprint', 'privacy'])
      if (!byId[id]?.[code]) ctx.report.add('legal-pages', `${PAGES_DIR}/${code}`, `no ${id} page`);
  }
  // Previews run behind Access OTP, so they are always declared; forms add mail and server code.
  const need = ['cdn', 'previews', ...(ctx.options.features.forms ? ['forms', 'server'] : [])];
  for (const rec of Object.values(byId.privacy ?? {})) {
    const missing = need.filter((key) => !rec.processing?.includes(key));
    if (missing.length) ctx.report.add('legal-processing', rec.file, `processing lacks ${missing.join(', ')}`);
  }
  for (const rec of Object.values(byId.accessibility ?? {})) {
    const page = byPath.get(rec.path);
    const text = page ? textOf(mainOf(page)).toLowerCase() : '';
    // "not compliant", "nicht konform" and "n'est pas conforme" disclose, they do not claim.
    const negated = (at: number) =>
      /\b(not|non|nicht|pas|kein|keine)\b[^.;:!?]{0,24}$/.test(text.slice(Math.max(0, at - 40), at));
    const claim = [...text.matchAll(/konform|conforme|conformant|compliant/g)].find((m) => !negated(m.index));
    if (claim && !ctx.site?.accessibilityAudit)
      ctx.report.add('legal-statement', rec.path, `"${claim[0]}" without accessibilityAudit in site.json`);
  }
}

// ── translations ─────────────────────────────────────────────────────────────

/** What a translation must share with the default locale: h2 count, rendered facts, internal link targets by page id. */
function shapeOf(ctx: BuildContext, page: BuiltPage, byPath: Map<string, BuiltPage>) {
  const main = mainOf(page);
  const prices = pricesFor(ctx, page.locale);
  const site = ctx.site;
  const facts = new Set(
    extractFacts(textOf(main)).map((f) => (site && factKey(f, site, prices)) || `${f.kind} ${f.raw}`),
  );
  const links = new Set<string>();
  for (const a of main.querySelectorAll('a[href]')) {
    const local = sameOrigin(a.getAttribute('href') ?? '', ctx.options.site, page.path);
    const id = local && byPath.get(local.path)?.record?.id;
    if (id) links.add(id);
  }
  return { h2: main.querySelectorAll('h2').length, facts, links };
}

function difference(own: Set<string>, base: Set<string>): string {
  const missing = [...base].filter((x) => !own.has(x));
  const extra = [...own].filter((x) => !base.has(x));
  return missing.length || extra.length ? `missing [${missing.join(', ')}] extra [${extra.join(', ')}]` : '';
}

function checkTranslations(ctx: BuildContext, byPath: Map<string, BuiltPage>): void {
  const def = ctx.options.defaultLocale;
  for (const variants of Object.values(ctx.manifest.byId)) {
    const base = variants[def];
    if (!base) continue;
    const basePage = byPath.get(base.path);
    const baseShape = basePage && shapeOf(ctx, basePage, byPath);
    for (const rec of Object.values(variants)) {
      if (rec.locale === def) continue;
      // Only the description: a title or h1 such as "Restaurant", "Jobs" or the brand name reads the same in
      // several languages, while a 50–160 character sentence never does.
      if (rec.description && rec.description === base.description)
        ctx.report.add('content-copied', rec.file, `description equals the ${def} description`);
      const page = byPath.get(rec.path);
      if (!page || !basePage || !baseShape) continue;
      const shape = shapeOf(ctx, page, byPath);
      if (shape.h2 !== baseShape.h2)
        ctx.report.add('content-stale', page.path, `${shape.h2} h2 sections; ${def} has ${baseShape.h2}`);
      // A link to a page that exists in only one of the two locales (declared missing) cannot match.
      const both = (id: string) => Boolean(ctx.manifest.byId[id]?.[rec.locale] && ctx.manifest.byId[id]?.[def]);
      const comparable = {
        facts: [shape.facts, baseShape.facts],
        links: [new Set([...shape.links].filter(both)), new Set([...baseShape.links].filter(both))],
      } as const;
      for (const key of ['facts', 'links'] as const) {
        const diff = difference(...comparable[key]);
        if (diff)
          ctx.report.add(
            'content-stale',
            page.path,
            `${key === 'facts' ? 'site.json facts' : 'internal link targets'} differ from ${def}: ${diff}`,
          );
      }
    }
  }
}

// ── language and glossary ────────────────────────────────────────────────────

/** The language whose stopwords clearly outnumber the page language's in a block of 12 or more words. */
export function dominantLanguage(text: string, own: string): { lang: string; score: number; own: number } | undefined {
  if (norm(text).split(' ').length < 12) return undefined;
  const tokens = text.toLowerCase().match(/\p{L}+/gu) ?? [];
  const score = (lang: string) => tokens.filter((t) => STOPWORDS[lang]?.has(t)).length;
  const mine = score(own);
  let best = { lang: own, score: 0, own: mine };
  for (const lang of Object.keys(STOPWORDS)) {
    const s = lang === own ? 0 : score(lang);
    if (s > best.score) best = { lang, score: s, own: mine };
  }
  return best.lang !== own && best.score >= 3 && best.score > 2 * mine ? best : undefined;
}

/** The element or an ancestor below <html> is marked with another language. */
function foreign(el: HTMLElement, own: string): boolean {
  for (let n: HTMLElement | null = el; n && n.tagName !== 'HTML'; n = n.parentNode) {
    const lang = n.getAttribute('lang');
    if (lang && primary(lang) !== own) return true;
  }
  return false;
}

function checkLanguage(ctx: BuildContext): void {
  for (const page of ctx.pages) {
    const own = primary(page.locale);
    if (!STOPWORDS[own]) continue;
    for (const block of mainOf(page).querySelectorAll(TEXT_BLOCKS)) {
      if (block.querySelector(TEXT_BLOCKS) || foreign(block, own)) continue;
      const text = norm(textOf(block, own));
      const hit = dominantLanguage(text, own);
      if (hit)
        ctx.report.add(
          'content-language',
          page.path,
          `reads as ${hit.lang} (${hit.score} vs ${hit.own} stopwords): "${text.slice(0, 60)}…"`,
        );
    }
  }
}

type Glossary = Record<string, { banned?: Record<string, string> }>;

function isGlossary(value: unknown): value is Glossary {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.values(value).every((entry: unknown) => {
    const banned = entry && typeof entry === 'object' ? (entry as { banned?: unknown }).banned : null;
    const map = !!banned && typeof banned === 'object' && !Array.isArray(banned);
    return banned === undefined || (map && Object.values(banned).every((v) => typeof v === 'string'));
  });
}

function occurrences(text: string, variant: string): number {
  if ([...variant].length === 1) return text.split(variant).length - 1;
  const escaped = variant.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text.match(new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'giu'))?.length ?? 0;
}

function checkGlossary(ctx: BuildContext): void {
  const file = join(ctx.root, GLOSSARY_FILE);
  let glossary: Glossary = {};
  if (existsSync(file)) {
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(file, 'utf8'));
    } catch (error) {
      ctx.report.add('content-glossary', GLOSSARY_FILE, (error as Error).message);
      return;
    }
    if (!isGlossary(raw)) {
      ctx.report.add(
        'content-glossary',
        GLOSSARY_FILE,
        'expected { "<locale>": { "banned": { "<variant>": "<canonical>" } } }',
      );
      return;
    }
    glossary = raw;
  }
  for (const page of ctx.pages) {
    const tag = ctx.options.locales.find((l) => l.code === page.locale)?.tag ?? page.locale;
    const builtIn = tag === 'de' || tag === 'de-CH' ? DE_CH_BANNED : {};
    const banned = Object.entries({ ...builtIn, ...glossary[page.locale]?.banned, ...glossary[tag]?.banned });
    if (banned.length === 0) continue;
    const head = `${page.doc.querySelector('title')?.text ?? ''} ${page.doc.querySelector('meta[name="description"]')?.getAttribute('content') ?? ''}`;
    const text = `${head} ${textOf(page.doc.querySelector('body') ?? page.doc, primary(page.locale))}`;
    for (const [variant, canonical] of banned) {
      const n = occurrences(text, variant);
      if (n) ctx.report.add('content-glossary', page.path, `"${variant}" ${n}× (use "${canonical}")`);
    }
  }
}

export const auditSite: Audit = (ctx) => {
  const byPath = new Map(ctx.pages.map((p) => [p.path, p]));
  checkHreflang(ctx);
  checkReach(ctx, checkLinks(ctx, byPath));
  checkFacts(ctx);
  checkLegal(ctx, byPath);
  checkTranslations(ctx, byPath);
  checkLanguage(ctx);
  checkGlossary(ctx);
};

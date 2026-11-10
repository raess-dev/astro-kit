/**
 * Per-page audits on the built HTML: head, JSON-LD, headings, indexing, CSP, scripts, images, fonts,
 * origins, the page shell, SVG, media and forms. Titles, descriptions and the organisation @id are
 * also compared across pages.
 */
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import idle from 'astro/runtime/client/idle.prebuilt.js';
import load from 'astro/runtime/client/load.prebuilt.js';
import media from 'astro/runtime/client/media.prebuilt.js';
import only from 'astro/runtime/client/only.prebuilt.js';
import visible from 'astro/runtime/client/visible.prebuilt.js';
import islandRuntime from 'astro/runtime/server/astro-island.prebuilt.js';
import type { HTMLElement } from 'node-html-parser';
import type { Audit, BuildContext, BuiltPage } from '../context.ts';
import { FORBIDDEN_SOURCES, SPECULATION_JSON, sha256 } from '../csp.ts';
import { localePrefix } from '../manifest.ts';

type Add = (rule: string, detail?: string) => void;
type Json = Record<string, unknown>;

interface State {
  title: Map<string, string>;
  description: Map<string, string>;
  orgId?: string;
  files: Set<string>;
  animated: Map<string, string | undefined>;
}

const ICONS = ['/favicon.ico', '/icon.svg', '/apple-touch-icon.png'];
/** Astro's classic island scripts (runtime and directives), matched by exact text. */
const ISLAND_SCRIPTS = new Set<string>([islandRuntime, idle, load, media, only, visible]);
/** Solid's hydration script, rendered by @astrojs/solid-js. */
const SOLID_HYDRATION = /^window\._\$HY\|\|/;
const EXECUTABLE = /^(|module|(text|application)\/(x-)?(java|ecma)script)$/;
const RESOURCE_RELS = new Set([
  'stylesheet',
  'preload',
  'modulepreload',
  'prefetch',
  'preconnect',
  'dns-prefetch',
  'icon',
  'apple-touch-icon',
  'manifest',
]);
const RESOURCE_TAGS = 'img, script, link, iframe, source, video, audio, track, object, embed, form';
const URL_ATTRS = ['src', 'href', 'srcset', 'poster', 'action', 'data'];
const FOCUSABLE =
  'a[href], area[href], button, input:not([type=hidden]), select, textarea, summary, iframe, [tabindex]:not([tabindex="-1"]), [contenteditable], audio[controls], video[controls]';
const TRANSCRIPT = /transcript|transkript|transcription|trascrizione/i;
const NOT_FIELDS = new Set(['hidden', 'submit', 'reset', 'button', 'image']);

const attr = (el: HTMLElement | null | undefined, name: string): string => el?.getAttribute(name)?.trim() ?? '';
const rels = (el: HTMLElement): string[] => attr(el, 'rel').toLowerCase().split(/\s+/);
const srcset = (value: string): string[] =>
  value
    .split(',')
    .map((c) => c.trim().split(/\s+/)[0] ?? '')
    .filter(Boolean);
const isJson = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const short = (text: string): string => (text.length > 80 ? `${text.slice(0, 77)}...` : text);

/** Path of a same-origin URL; undefined for another origin or any other scheme. */
function localPath(url: string, site: string): string | undefined {
  if (url === site) return '/';
  if (url.startsWith(`${site}/`)) return url.slice(site.length);
  if (url.startsWith('//') || /^[a-z][a-z0-9+.-]*:/i.test(url)) return undefined;
  return url;
}

function directives(policy: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const part of policy.split(';')) {
    const [name, ...sources] = part.trim().split(/\s+/);
    if (name && !out.has(name.toLowerCase())) out.set(name.toLowerCase(), sources);
  }
  return out;
}

/** Number of frames in a GIF, stopping at two. */
function gifFrames(b: Buffer): number {
  const table = (flags: number) => (flags & 0x80 ? 3 * 2 ** ((flags & 7) + 1) : 0);
  let i = 13 + table(b[10] ?? 0);
  let frames = 0;
  while (i < b.length && frames < 2) {
    const block = b[i++];
    if (block === 0x2c) {
      frames++;
      i += 9 + table(b[i + 8] ?? 0) + 1; // descriptor, local colour table, LZW code size
    } else if (block === 0x21)
      i++; // extension label
    else break;
    while (i < b.length && b[i]) i += (b[i] ?? 0) + 1; // data sub-blocks
    i++;
  }
  return frames;
}

/** Names the animation in an image file, or undefined for a still image or another format. */
function animation(b: Buffer): string | undefined {
  if (b.length < 16) return undefined;
  const ascii = (at: number) => b.toString('latin1', at, at + 4);
  if (ascii(0) === 'GIF8') return gifFrames(b) > 1 ? 'an animated GIF' : undefined;
  if (b.readUInt32BE(0) === 0x89504e47) {
    // PNG chunks: length, type, data, CRC; acTL must come before the first IDAT.
    for (let i = 8; i + 8 <= b.length && ascii(i + 4) !== 'IDAT'; i += 12 + b.readUInt32BE(i))
      if (ascii(i + 4) === 'acTL') return 'an APNG';
  } else if (ascii(0) === 'RIFF' && ascii(8) === 'WEBP') {
    // RIFF chunks: type, little-endian size, data padded to even length.
    for (let i = 12; i + 8 <= b.length; i += 8 + b.readUInt32LE(i + 4) + (b.readUInt32LE(i + 4) & 1))
      if (ascii(i) === 'ANIM') return 'an animated WebP';
  } else if (ascii(4) === 'ftyp') {
    // ISO BMFF ftyp: major brand at 8, compatible brands from 16.
    const end = Math.min(b.readUInt32BE(0), b.length);
    for (let i = 8; i + 4 <= end; i += i === 8 ? 8 : 4) if (ascii(i) === 'avis') return 'an AVIF image sequence';
  }
  return undefined;
}

function head(ctx: BuildContext, page: BuiltPage, add: Add, state: State): void {
  const { doc } = page;
  const { site } = ctx.options;
  const self = `${site}${page.path}`;
  const tag = ctx.options.locales.find((l) => l.code === page.locale)?.tag;
  const lang = attr(doc.querySelector('html'), 'lang');
  if (lang !== tag) add('head-lang', `lang "${lang}", expected ${tag ?? 'a configured locale tag'}`);

  const metas = new Map<string, string>();
  for (const m of doc.querySelectorAll('meta')) {
    const key = (m.getAttribute('property') ?? m.getAttribute('name') ?? '').toLowerCase();
    if (key && !metas.has(key)) metas.set(key, attr(m, 'content'));
  }
  const noindex = /\bnoindex\b/i.test(metas.get('robots') ?? '');
  const draft = ctx.manifest.drafts && page.record?.draft === true;
  if (noindex !== page.is404 && !(noindex && draft))
    add('indexing-noindex', page.is404 ? 'the 404 page is not noindex' : 'robots noindex');

  const iconLinks = doc
    .querySelectorAll('link')
    .filter((l) => rels(l).some((r) => r === 'icon' || r === 'apple-touch-icon'));
  const unlinked = ICONS.filter((icon) => !iconLinks.some((l) => localPath(attr(l, 'href'), site) === icon));
  if (unlinked.length) add('head-icons', `no link to ${unlinked.join(', ')}`);
  if (page.is404) return;

  const canonicals = doc.querySelectorAll('link').filter((l) => rels(l).includes('canonical'));
  const canonical = attr(canonicals[0], 'href');
  if (canonicals.length !== 1 || canonical !== self || !page.path.endsWith('/')) {
    add('head-canonical', `${canonicals.length} canonical link(s), href ${canonical || 'none'}, expected ${self}`);
  }

  const { limits } = ctx;
  const texts = [
    ['head-title', 'title', doc.querySelector('title')?.text.trim() ?? '', limits.titleMin, limits.titleMax],
    ['head-description', 'description', metas.get('description') ?? '', limits.descriptionMin, limits.descriptionMax],
  ] as const;
  for (const [rule, key, text, min, max] of texts) {
    const length = [...text].length;
    if (length < min || length > max) add(rule, `${length} characters, allowed ${min}–${max}`);
    const id = `${page.locale}\n${text}`;
    const other = state[key].get(id);
    if (other && text) add(rule, `same ${key} as ${other}`);
    else state[key].set(id, page.path);
  }

  // Open Graph: one finding that lists every problem.
  const og = (key: string) => metas.get(`og:${key}`) || 'missing';
  const ogLocale = tag?.replace('-', '_');
  const image = og('image');
  const stat = image.startsWith(`${site}/`)
    ? statSync(join(ctx.dist, image.slice(site.length)), { throwIfNoEntry: false })
    : undefined;
  const problems = [
    ...['title', 'description'].filter((key) => og(key) === 'missing').map((key) => `og:${key} missing`),
    og('url') !== self && `og:url ${og('url')}, expected ${self}`,
    og('locale') !== ogLocale && `og:locale ${og('locale')}, expected ${ogLocale}`,
    !stat?.isFile() && `og:image ${image}${image === 'missing' ? '' : ` is not a file in dist under ${site}/`}`,
    stat && stat.size > limits.ogImageBytes && `og:image is ${stat.size} bytes, limit ${limits.ogImageBytes}`,
    (og('image:width') !== '1200' || og('image:height') !== '630') &&
      `og:image is ${og('image:width')}×${og('image:height')}, expected 1200×630`,
  ].filter(Boolean);
  if (problems.length) add('head-og', problems.join('; '));
}

/** Day and hour triples, e.g. "Mo 08:00-17:00", from an openingHoursSpecification value. */
function hoursOf(spec: unknown): string {
  return [spec]
    .flat()
    .filter(isJson)
    .flatMap((s) =>
      [s.dayOfWeek].flat().map(
        (d) =>
          `${String(d)
            .replace(/^https?:\/\/schema\.org\//, '')
            .slice(0, 2)} ${String(s.opens).slice(0, 5)}-${String(s.closes).slice(0, 5)}`,
      ),
    )
    .sort()
    .join(', ');
}

function organisation(node: Json, ctx: BuildContext, add: Add, state: State): void {
  const id = typeof node['@id'] === 'string' ? node['@id'] : '';
  if (!id) add('head-jsonld', 'the organisation has no @id');
  else if (state.orgId === undefined) state.orgId = id;
  else if (id !== state.orgId) add('head-jsonld', `organisation @id ${id}, other pages use ${state.orgId}`);
  const facts = ctx.site;
  if (!facts) return;
  const address = (a: Json | undefined) =>
    a && JSON.stringify([a.streetAddress, a.postalCode, a.addressLocality, a.addressRegion, a.addressCountry]);
  const f = facts.address;
  const pairs: [string, unknown, unknown][] = [
    ['name', node.name, facts.name],
    ['telephone', node.telephone, facts.phone],
    ['vatID', node.vatID, facts.vatId],
    [
      'address',
      address(isJson(node.address) ? node.address : undefined),
      f && JSON.stringify([f.street, f.postalCode, f.locality, f.region, f.country]),
    ],
    [
      'openingHoursSpecification',
      hoursOf(node.openingHoursSpecification),
      ctx.schedule.openingHours
        .flatMap((h) => h.days.map((d) => `${d} ${h.opens}-${h.closes}`))
        .sort()
        .join(', '),
    ],
  ];
  for (const [key, actual, expected] of pairs) {
    if (actual !== expected)
      add(
        'head-jsonld',
        `${key} is ${JSON.stringify(actual) ?? 'unset'}, the facts say ${JSON.stringify(expected) ?? 'unset'}`,
      );
  }
}

function jsonld(ctx: BuildContext, page: BuiltPage, add: Add, state: State): void {
  const orgTypes = new Set(['Organization', ctx.site?.type ?? 'Organization']);
  const tag = ctx.options.locales.find((l) => l.code === page.locale)?.tag;
  const home = page.path === localePrefix(ctx.options, page.locale);
  for (const el of page.doc.querySelectorAll('script')) {
    if (attr(el, 'type').toLowerCase() !== 'application/ld+json') continue;
    let data: unknown;
    try {
      data = JSON.parse(el.innerHTML);
    } catch {
      add('head-jsonld', 'JSON-LD does not parse');
      continue;
    }
    if (JSON.stringify(data).includes('"BreadcrumbList"')) add('head-jsonld', 'BreadcrumbList is not used');
    const nodes = [data]
      .flat()
      .flatMap((d) => (isJson(d) && Array.isArray(d['@graph']) ? d['@graph'] : [d]))
      .filter(isJson);
    for (const node of nodes) {
      const types = [node['@type']].flat().filter((t): t is string => typeof t === 'string');
      if (types.length === 0) add('head-jsonld', 'a node has no @type');
      for (const type of types) {
        if (orgTypes.has(type)) organisation(node, ctx, add, state);
        else if (type === 'WebPage') {
          if (node.inLanguage !== tag)
            add('head-jsonld', `WebPage inLanguage ${String(node.inLanguage)}, expected ${tag}`);
        } else if (type === 'WebSite') {
          if (!home) add('head-jsonld', 'WebSite belongs on locale homes only');
        } else if (type === 'Article') {
          if (!page.record?.date) add('head-jsonld', 'Article needs a page date');
        } else if (type !== 'BreadcrumbList') add('head-jsonld', `@type ${type} is not allowed`);
      }
    }
  }
}

function scripts(ctx: BuildContext, page: BuiltPage, add: Add): void {
  const { doc } = page;
  const { features, prefetch } = ctx.options;
  const metas = doc
    .querySelectorAll('meta')
    .filter((m) => attr(m, 'http-equiv').toLowerCase() === 'content-security-policy');
  const meta = metas[0];
  if (metas.length !== 1) add('csp-meta', `${metas.length} CSP meta elements`);
  const policy = attr(meta, 'content');
  const forbidden = policy.split(/[\s;]+/).filter((t) => FORBIDDEN_SOURCES.includes(t) || t.includes('*'));
  if (forbidden.length) add('csp-meta', `forbidden sources ${forbidden.join(' ')}`);
  const dirs = directives(policy);
  const sources = (name: string) => new Set(dirs.get(name) ?? dirs.get('default-src') ?? []);
  const scriptSources = sources('script-src');
  const styleSources = sources('style-src');
  const metaAt = meta ? meta.range[0] : -1;
  if (doc.querySelector('base')) add('csp-base');

  const speculation: HTMLElement[] = [];
  for (const el of doc.querySelectorAll('script')) {
    const type = attr(el, 'type').toLowerCase();
    const src = attr(el, 'src');
    const text = el.innerHTML;
    if (type === 'application/ld+json') continue;
    if (EXECUTABLE.test(type) && el.range[0] < metaAt)
      add('csp-meta', `<script${src ? ` src="${src}"` : ''}> precedes the CSP meta`);
    const hashed = EXECUTABLE.test(type) || type === 'speculationrules' || type === 'importmap';
    if (!src && hashed && !scriptSources.has(`'${sha256(text)}'`))
      add('csp-hash', `inline script ${sha256(text)} is not in script-src`);
    if (type === 'speculationrules') {
      speculation.push(el);
      continue;
    }
    const bundled =
      type === 'module' &&
      src.startsWith('/_astro/') &&
      (features.scripts || features.islands || prefetch.astroPrefetch);
    const inlined = type === 'module' && !src && features.scripts; // Astro inlines small bundled scripts
    const island = type === '' && !src && features.islands && (ISLAND_SCRIPTS.has(text) || SOLID_HYDRATION.test(text));
    if (!bundled && !inlined && !island)
      add('js-script', src ? `<script src="${src}">` : `inline ${type || 'classic'} script: ${short(text)}`);
  }
  for (const el of doc.querySelectorAll('style')) {
    if (!styleSources.has(`'${sha256(el.innerHTML)}'`))
      add('csp-hash', `inline style ${sha256(el.innerHTML)} is not in style-src`);
  }

  for (const el of doc.querySelectorAll('[data-astro-prefetch]'))
    add('js-prefetch-attr', `<${el.rawTagName} href="${attr(el, 'href')}">`);
  for (const island of doc.querySelectorAll('astro-island')) {
    const client = attr(island, 'client');
    if (!['visible', 'idle', 'media'].includes(client))
      add('js-directive', `client:${client} on ${attr(island, 'component-url')}`);
  }

  const [block] = speculation;
  if (!prefetch.speculationRules) {
    if (block) add('speculation-block', 'speculationRules is off but the page has a block');
  } else if (speculation.length !== 1 || !block) add('speculation-block', `${speculation.length} blocks`);
  else if (block.innerHTML !== SPECULATION_JSON) add('speculation-block', 'the rules differ from the kit rules');
  else if (block.range[0] < metaAt) add('speculation-block', 'the block precedes the CSP meta');
}

function resources(ctx: BuildContext, page: BuiltPage, add: Add, state: State): void {
  const { doc } = page;
  const { site } = ctx.options;
  const imgs = doc.querySelectorAll('img');
  for (const el of doc.querySelectorAll('img, picture source')) {
    for (const url of [...(el.tagName === 'IMG' ? [attr(el, 'src')] : []), ...srcset(attr(el, 'srcset'))]) {
      const path = localPath(url, site) ?? '';
      if (!path.startsWith('/_astro/') && !ICONS.includes(path)) add('images-src', url || '(empty src)');
    }
  }
  for (const img of imgs) {
    const missing = ['width', 'height', 'alt'].filter((a) => (a === 'alt' ? !img.hasAttribute(a) : !attr(img, a)));
    if (missing.length) add('images-attrs', `${attr(img, 'src')} lacks ${missing.join(', ')}`);
  }
  for (const picture of doc.querySelectorAll('picture')) {
    const sources = picture.querySelectorAll('source');
    const src = attr(picture.querySelector('img'), 'src');
    if (
      !sources.length ||
      !sources.every((s) => attr(s, 'type') === 'image/avif') ||
      !/\.webp$/i.test(src.split(/[?#]/)[0] ?? '')
    ) {
      add(
        'images-format',
        `picture ${src}: sources ${sources.map((s) => attr(s, 'type') || '?').join(', ') || 'none'}`,
      );
    }
  }
  const priority = imgs.filter((i) => attr(i, 'fetchpriority').toLowerCase() === 'high').length;
  if (priority > 1) add('images-priority', `${priority} images`);

  // Fonts: the page's inline styles plus its linked stylesheets. Faces with only local() are metric fallbacks.
  const links = doc.querySelectorAll('link');
  const sheets = links.filter((l) => rels(l).includes('stylesheet')).map((l) => localPath(attr(l, 'href'), site));
  const css = [
    ...doc.querySelectorAll('style').map((s) => s.innerHTML),
    ...ctx.css.filter((c) => sheets.includes(c.where)).map((c) => c.text),
  ].join('\n');
  const families = new Set<string>();
  for (const [, face = ''] of css.matchAll(/@font-face\s*\{([^}]*)\}/gi)) {
    const urls = [...face.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi)].map((m) => m[2] ?? '');
    if (!urls.length) continue;
    const family = /font-family\s*:\s*([^;]+)/i.exec(face)?.[1] ?? '';
    families.add(
      family
        .trim()
        .replace(/^['"]|['"]$/g, '')
        .toLowerCase(),
    );
    for (const url of urls) if (localPath(url, site) === undefined) add('fonts-limit', `font from ${short(url)}`);
  }
  if (families.size > 2) add('fonts-limit', `${families.size} font families: ${[...families].join(', ')}`);
  const preloads = links.filter((l) => rels(l).includes('preload') && attr(l, 'as') === 'font').length;
  if (preloads > 1) add('fonts-limit', `${preloads} font preloads`);

  for (const el of doc.querySelectorAll(RESOURCE_TAGS)) {
    if (el.tagName === 'LINK' && !rels(el).some((r) => RESOURCE_RELS.has(r))) continue;
    for (const name of URL_ATTRS) {
      const value = el.getAttribute(name);
      if (value === undefined) continue;
      for (const url of name === 'srcset' ? srcset(value) : [value.trim()]) {
        if (localPath(url, site) === undefined)
          add('origins-third-party', `<${el.rawTagName} ${name}="${short(url)}">`);
      }
    }
  }

  for (const el of doc.querySelectorAll('img, picture source, video')) {
    const urls = el.tagName === 'VIDEO' ? [attr(el, 'poster')] : [attr(el, 'src'), ...srcset(attr(el, 'srcset'))];
    for (const url of urls) {
      const path = localPath(url, site)?.split(/[?#]/)[0] ?? '';
      if (!path.startsWith('/') || !state.files.has(path.slice(1))) continue;
      if (!state.animated.has(path)) state.animated.set(path, animation(readFileSync(join(ctx.dist, path))));
      const kind = state.animated.get(path);
      if (kind) add('media-animated', `${path} is ${kind}`);
    }
  }
}

function shell(ctx: BuildContext, page: BuiltPage, add: Add): void {
  const { doc } = page;
  const first = doc.querySelector(FOCUSABLE);
  if (first?.tagName !== 'A' || attr(first, 'href') !== '#main')
    add('html-shell', `the first focusable element is <${first?.rawTagName ?? 'none'}>, not a link to #main`);
  const mains = doc.querySelectorAll('main');
  if (mains.length !== 1 || attr(mains[0], 'id') !== 'main')
    add('html-shell', `${mains.length} main element(s), id "${attr(mains[0], 'id')}"`);

  for (const svg of doc.querySelectorAll('svg')) {
    if (svg.parentNode?.closest('svg')) continue;
    const titled = svg.children.some((c) => c.tagName === 'TITLE' && c.text.trim() !== '');
    const named = attr(svg, 'role') === 'img' && (attr(svg, 'aria-label') !== '' || titled);
    if (attr(svg, 'aria-hidden') !== 'true' && !named)
      add('svg-name', `<svg${attr(svg, 'class') ? ` class="${attr(svg, 'class')}"` : ''}>`);
  }

  const tag = ctx.options.locales.find((l) => l.code === page.locale)?.tag.toLowerCase();
  for (const video of doc.querySelectorAll('video')) {
    const captioned = video
      .querySelectorAll('track')
      .some(
        (t) =>
          attr(t, 'kind').toLowerCase() === 'captions' && [tag, page.locale].includes(attr(t, 'srclang').toLowerCase()),
      );
    if (!captioned) add('media-captions', `video ${attr(video, 'src')} has no ${tag ?? page.locale} captions track`);
  }
  for (const audio of doc.querySelectorAll('audio')) {
    const next = audio.nextElementSibling ?? audio.parentNode?.nextElementSibling;
    const links = next ? (next.tagName === 'A' ? [next] : next.querySelectorAll('a')) : [];
    if (!links.some((a) => TRANSCRIPT.test(a.text)))
      add('media-captions', `audio ${attr(audio, 'src')} is not followed by a transcript link`);
  }
}

function forms(ctx: BuildContext, page: BuiltPage, add: Add): void {
  const { doc } = page;
  const words = ctx.messages[page.locale] ?? {};
  const marks = [words.required, words.optional].filter((w): w is string => Boolean(w)).map((w) => w.toLowerCase());
  const labels = doc.querySelectorAll('label');
  for (const field of doc.querySelectorAll('input, select, textarea')) {
    const type = field.tagName === 'INPUT' ? attr(field, 'type').toLowerCase() : '';
    const name = attr(field, 'name') || attr(field, 'id') || field.rawTagName;
    if (type === 'file') {
      add('forms-safety', `file input ${name}`);
      continue;
    }
    const choice = type === 'checkbox' || type === 'radio';
    if (choice && field.hasAttribute('checked')) add('forms-safety', `pre-checked ${type} ${name}`);
    if (NOT_FIELDS.has(type) || field.closest('[inert]')) continue;
    const id = attr(field, 'id');
    const label = field.closest('label') ?? labels.find((l) => id !== '' && attr(l, 'for') === id);
    const text = label?.text.replace(/\s+/g, ' ').toLowerCase() ?? '';
    const problems: string[] = [];
    if (!label) problems.push('no label');
    else if (!marks.some((m) => text.includes(m))) problems.push(`the label does not say ${marks.join(' or ')}`);
    if (!choice && !attr(field, 'autocomplete')) problems.push('no autocomplete');
    if (field.hasAttribute('placeholder')) problems.push('a placeholder');
    if (problems.length) add('forms-fields', `${name}: ${problems.join(', ')}`);
  }

  const privacy = ctx.manifest.byId.privacy?.[page.locale]?.path;
  for (const form of doc.querySelectorAll('form')) {
    if (attr(form, 'method').toLowerCase() !== 'post') continue;
    const linked =
      privacy !== undefined &&
      form.querySelectorAll('a').some((a) => localPath(attr(a, 'href'), ctx.options.site) === privacy);
    if (!linked)
      add(
        'forms-safety',
        privacy ? `the POST form does not link ${privacy}` : `no ${page.locale} privacy page to link`,
      );
  }
}

export const auditPages: Audit = (ctx) => {
  const state: State = { title: new Map(), description: new Map(), files: new Set(ctx.files), animated: new Map() };
  for (const icon of ICONS)
    if (!state.files.has(icon.slice(1))) ctx.report.add('head-icons', `dist${icon}`, 'file missing');
  for (const page of ctx.pages) {
    const add: Add = (rule, detail) => ctx.report.add(rule, page.path, detail);
    head(ctx, page, add, state);
    jsonld(ctx, page, add, state);
    if (page.doc.querySelectorAll('h1').length !== 1)
      add('headings-h1', `${page.doc.querySelectorAll('h1').length} h1 elements`);
    let level = 0;
    for (const h of page.doc.querySelectorAll('h1, h2, h3, h4, h5, h6')) {
      const next = Number(h.tagName[1]);
      if (next > level + 1)
        add('headings-order', `h${next} "${short(h.text.trim())}" follows ${level ? `h${level}` : 'nothing'}`);
      level = next;
    }
    scripts(ctx, page, add);
    resources(ctx, page, add, state);
    shell(ctx, page, add);
    forms(ctx, page, add);
  }
};

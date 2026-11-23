/**
 * The head rules of the page audit (specification, section 8): `head-canonical`, `head-lang`, `head-title`,
 * `head-description`, `head-og`, `head-icons`, `head-jsonld`, `headings-h1`, `headings-order` and
 * `indexing-noindex`. Each function is the built half of one rule. It reads every page of the context and adds its
 * findings at the page path (`/zimmer/`), or at a dist file for a file it reads.
 *
 * **Who reports what.**
 *
 * - `head-canonical`, `head-og` and `head-title`, `head-description` skip `/404.html`; `head-lang`, `head-icons`,
 *   `head-jsonld`, `headings-*` and `indexing-noindex` read it too. A missing `/404.html` is `routes-404`'s alone.
 * - `head-og` compares `og:url` with `<site><path>`, the canonical that `head-canonical` asks for, and `og:locale`
 *   with the tag of the locale of the path, never with the page's own canonical or `lang`: a wrong canonical or `lang`
 *   reports once.
 * - A page without an `h1` is `headings-h1`'s; `headings-order` then checks only the steps after the first heading.
 * - A title or a description that equals the one of an earlier page of the same locale (in path order) reports at
 *   the later page, with the earlier path in the detail. The same description in two locales is `content-copied`'s.
 * - JSON-LD is no page text: a wrong fact in it is `head-jsonld`'s, never `facts-value`'s.
 *
 * Every rule reads the pages through `../dom.ts`: no recursion over the tree, and no attribute read through
 * node-html-parser (see there).
 */
import type { HTMLElement } from 'node-html-parser';
import type { BuildContext, BuiltPage, Facts } from '../../context.ts';
import { snippet } from '../../css/rules.ts';
import { isLocaleHome } from '../../routes.ts';
import {
  attr,
  collapse,
  decodePath,
  domOf,
  hasNoindex,
  hasRobotsNoindex,
  inHead,
  localeOf,
  type PageDom,
  pushAll,
  rawContentOf,
  resolveHref,
  scriptKind,
  siteOf,
  tagOf,
  textOf,
  tokensOf,
} from '../dom.ts';

// Shared helpers

/** The ASCII lower case of a text: a `name` or `property` of a `meta` compares in it. */
const asciiLower = (text: string): string => text.replace(/[A-Z]+/g, (upper) => upper.toLowerCase());

/** The number of code points of a text (Measurement details: lengths count code points, not UTF-16 units). */
const codePoints = (text: string): number => {
  let count = 0;
  for (const _ of text) count += 1;
  return count;
};

/** A text in a detail: cut and in double quotes. */
const quoted = (text: string): string => `"${snippet(text)}"`;

/** The tag of the locale of the URL of a page (`page.locale`), or `undefined` for a code that is not configured. */
const tagOfPage = (ctx: BuildContext, page: BuiltPage): string | undefined => localeOf(ctx.options, page.locale)?.tag;

/** The URL that `head-canonical` and `head-og` ask for: `<site><path>`. */
const urlOfPage = (ctx: BuildContext, page: BuiltPage): string => `${ctx.options.site}${page.path}`;

const FOREIGN = new WeakMap<PageDom, ReadonlySet<HTMLElement>>();

/**
 * The elements of a page that are SVG or MathML content: an `svg` or `math` element and everything inside it. A
 * `title` there is no title of the document. One pass in document order, where a parent comes before its children.
 */
function foreignOf(dom: PageDom): ReadonlySet<HTMLElement> {
  let found = FOREIGN.get(dom);
  if (found === undefined) {
    const inside = new Set<HTMLElement>();
    for (const element of dom.elements) {
      const tag = tagOf(element);
      const parent = element.parentNode;
      if (tag === 'svg' || tag === 'math' || (parent !== null && inside.has(parent))) inside.add(element);
    }
    found = inside;
    FOREIGN.set(dom, found);
  }
  return found;
}

/**
 * The elements of a tag that are children of `head`. Search engines and share scrapers read the canonical, the
 * description and the Open Graph tags only there, so one in `body` counts as none.
 */
const headTags = (dom: PageDom, tag: string): HTMLElement[] => dom.byTag(tag).filter((element) => inHead(dom, element));

/** The `meta` children of `head` whose attribute (`name`, `property`) equals a value in ASCII lower case. */
const metasBy = (dom: PageDom, attribute: string, value: string): HTMLElement[] =>
  headTags(dom, 'meta').filter((meta) => asciiLower(attr(meta, attribute) ?? '') === value);

// head-canonical

/**
 * `head-canonical`: each non-404 page has exactly one canonical, `<site><path>`, ending in `/`. A canonical is a
 * `link` child of `head` whose `rel` holds `canonical`; one in `body` counts as none.
 */
export function auditHeadCanonical(ctx: BuildContext): void {
  for (const page of ctx.pages) {
    if (page.is404) continue;
    const expected = urlOfPage(ctx, page);
    const links = headTags(domOf(page), 'link').filter((link) => tokensOf(link, 'rel').includes('canonical'));
    const problem = canonicalProblem(links, expected);
    if (problem !== undefined) ctx.report.add('head-canonical', page.path, problem);
  }
}

function canonicalProblem(links: readonly HTMLElement[], expected: string): string | undefined {
  const [link] = links;
  if (link === undefined) return `no canonical link; expected ${expected}`;
  if (links.length > 1) return `${links.length} canonical links; expected one, ${expected}`;
  const href = attr(link, 'href');
  if (href === undefined) return `the canonical link has no href; expected ${expected}`;
  if (href !== expected) return `the canonical is ${quoted(href)}; expected ${expected}`;
  // A page path that does not end in `/` (`/a.html`) has no canonical that the rule accepts.
  if (!href.endsWith('/')) return `the canonical ${quoted(href)} does not end in /`;
  return undefined;
}

// head-lang

/** `head-lang`: `html lang` equals the tag of the locale of the URL, as an exact string. */
export function auditHeadLang(ctx: BuildContext): void {
  for (const page of ctx.pages) {
    const tag = tagOfPage(ctx, page) ?? '';
    const html = domOf(page).html;
    if (html === undefined) {
      ctx.report.add('head-lang', page.path, `the page has no <html> element; expected lang="${tag}"`);
      continue;
    }
    const lang = attr(html, 'lang');
    if (lang === tag) continue;
    const found = lang === undefined ? '<html> has no lang' : `lang is ${quoted(lang)}`;
    ctx.report.add('head-lang', page.path, `${found}; expected "${tag}"`);
  }
}

// head-title and head-description

/** What a page holds for a text rule: the one text, or the problem that keeps the rule from reading it. */
type Read = { text: string } | { problem: string };

/**
 * The length and uniqueness check of `head-title` and `head-description`: each non-404 page holds a text of `min` to
 * `max` code points, and no earlier page of its locale (in path order) holds the same text. A page whose text cannot
 * be read (none, or more than one) reports that alone. Length and uniqueness are two facts: two findings at most.
 */
function auditHeadText(
  ctx: BuildContext,
  id: string,
  noun: string,
  range: { min: number; max: number },
  read: (dom: PageDom) => Read,
): void {
  const seen = new Map<string, Map<string, string>>();
  for (const page of ctx.pages) {
    if (page.is404) continue;
    const found = read(domOf(page));
    if ('problem' in found) {
      ctx.report.add(id, page.path, found.problem);
      continue;
    }
    const { text } = found;
    const length = codePoints(text);
    if (length < range.min || length > range.max) {
      ctx.report.add(id, page.path, `the ${noun} has ${length} code points; ${range.min}–${range.max}`);
    }
    if (text === '') continue;
    let locale = seen.get(page.locale);
    if (locale === undefined) {
      locale = new Map();
      seen.set(page.locale, locale);
    }
    const first = locale.get(text);
    if (first === undefined) locale.set(text, page.path);
    else ctx.report.add(id, page.path, `the ${noun} ${quoted(text)} is also the ${noun} of ${first}`);
  }
}

/**
 * The title of a page: the collapsed text of its one `title` element. A `title` inside `svg` or `math` is no title
 * of the document. `parseHtml` reads the content of `title` as text, as a browser does: a tag inside a title stays
 * as written, with its markup.
 */
function readTitle(dom: PageDom): Read {
  const foreign = foreignOf(dom);
  const titles = dom.byTag('title').filter((element) => !foreign.has(element));
  const [title] = titles;
  if (title === undefined) return { problem: 'the page has no <title>' };
  if (titles.length > 1) return { problem: `the page has ${titles.length} <title> elements; exactly 1` };
  return { text: collapse(textOf(title)) };
}

/**
 * The description of a page: the collapsed `content` of its one `meta[name=description]` (any ASCII case), a child
 * of `head`.
 */
function readDescription(dom: PageDom): Read {
  const metas = metasBy(dom, 'name', 'description');
  const [meta] = metas;
  if (meta === undefined) return { problem: 'the page has no meta description' };
  if (metas.length > 1) return { problem: `the page has ${metas.length} meta descriptions; exactly 1` };
  return { text: collapse(attr(meta, 'content') ?? '') };
}

/** `head-title`: 15–70 code points, unique per locale; `/404.html` exempt. */
export function auditHeadTitle(ctx: BuildContext): void {
  auditHeadText(ctx, 'head-title', 'title', { min: ctx.limits.titleMin, max: ctx.limits.titleMax }, readTitle);
}

/** `head-description`: 50–160 code points, unique per locale; `/404.html` exempt. */
export function auditHeadDescription(ctx: BuildContext): void {
  const range = { min: ctx.limits.descriptionMin, max: ctx.limits.descriptionMax };
  auditHeadText(ctx, 'head-description', 'description', range, readDescription);
}

// head-og

/** The share image size that `head-og` asks for. */
const OG_IMAGE_WIDTH = '1200';
const OG_IMAGE_HEIGHT = '630';

/**
 * `head-og`: the Open Graph tags of each non-404 page, and the share image when there is one. One finding for each
 * page lists every problem.
 *
 * A tag is a `meta` child of `head` whose `property` is the name in ASCII lower case. For `og:title`, `og:description`, `og:url`,
 * `og:locale`, `og:image:width` and `og:image:height`, the first tag counts; each `og:image` is checked. A title or
 * a description must not be empty. `og:url` must equal `<site><path>` and `og:locale` the tag of the locale of the
 * path with each `-` as `_`. An `og:image` must start with `<site>/`, and the rest, without its query and fragment
 * (as written, or percent-decoded), must be a dist file of at most `ogImageBytes` bytes.
 */
export function auditHeadOg(ctx: BuildContext): void {
  const { files } = siteOf(ctx);
  for (const page of ctx.pages) {
    if (page.is404) continue;
    const tags = openGraphOf(domOf(page));
    const first = (name: string): string | undefined => tags.get(name)?.[0];
    const problems: string[] = [];
    for (const name of ['og:title', 'og:description']) {
      const value = first(name);
      if (value === undefined) problems.push(`no ${name}`);
      else if (collapse(value) === '') problems.push(`${name} is empty`);
    }
    const expected = new Map([
      ['og:url', urlOfPage(ctx, page)],
      ['og:locale', (tagOfPage(ctx, page) ?? '').replaceAll('-', '_')],
    ]);
    for (const [name, value] of expected) {
      const found = first(name);
      if (found === undefined) problems.push(`no ${name}; expected ${value}`);
      else if (found !== value) problems.push(`${name} is ${quoted(found)}; expected ${value}`);
    }
    const images = tags.get('og:image') ?? [];
    for (const image of images) {
      const problem = imageProblem(ctx, files, image);
      if (problem !== undefined) problems.push(problem);
    }
    if (images.length > 0) {
      const size = new Map([
        ['og:image:width', OG_IMAGE_WIDTH],
        ['og:image:height', OG_IMAGE_HEIGHT],
      ]);
      for (const [name, value] of size) {
        const found = first(name);
        if (found === undefined) problems.push(`no ${name}; expected ${value}`);
        else if (found.trim() !== value) problems.push(`${name} is ${quoted(found)}; expected ${value}`);
      }
    }
    if (problems.length > 0) ctx.report.add('head-og', page.path, problems.join('; '));
  }
}

/**
 * The `content` of each Open Graph `meta` of a page (a child of `head`), by its `property` in ASCII lower case, in
 * document order.
 */
function openGraphOf(dom: PageDom): ReadonlyMap<string, string[]> {
  const out = new Map<string, string[]>();
  for (const meta of headTags(dom, 'meta')) {
    const property = attr(meta, 'property');
    if (property === undefined) continue;
    const name = asciiLower(property);
    const content = attr(meta, 'content') ?? '';
    const list = out.get(name);
    if (list === undefined) out.set(name, [content]);
    else list.push(content);
  }
  return out;
}

/** The problem of one `og:image`, or `undefined` when it is a dist file of the site within `ogImageBytes`. */
function imageProblem(ctx: BuildContext, files: ReadonlySet<string>, image: string): string | undefined {
  const prefix = `${ctx.options.site}/`;
  if (!image.startsWith(prefix)) return `og:image ${quoted(image)} is not under ${prefix}`;
  let rest = image.slice(prefix.length);
  for (const mark of ['#', '?']) {
    const at = rest.indexOf(mark);
    if (at >= 0) rest = rest.slice(0, at);
  }
  const decoded = decodePath(rest);
  const file = files.has(rest) ? rest : decoded !== undefined && files.has(decoded) ? decoded : undefined;
  if (file === undefined) return `og:image ${quoted(image)} is no file of dist`;
  const bytes = ctx.read(file)?.length ?? 0;
  if (bytes > ctx.limits.ogImageBytes) return `og:image /${file} has ${bytes} B; at most ${ctx.limits.ogImageBytes} B`;
  return undefined;
}

// head-icons

/** The three icons that every page links, as paths. */
const ICON_PATHS: readonly string[] = ['/favicon.ico', '/icon.svg', '/apple-touch-icon.png'];

/** The `rel` tokens of an icon link. */
const ICON_RELS: ReadonlySet<string> = new Set(['icon', 'apple-touch-icon']);

/**
 * `head-icons`: every page, 404 included, links the three icons, and the files exist. A link counts when its `rel`
 * holds `icon` or `apple-touch-icon` and its `href` is the path of the icon on the site (root-relative, relative or
 * absolute `https`), without a query or a fragment. One finding for each page names the icons it does not link. A
 * missing icon file is one finding at the file (`/favicon.ico`), once for the site.
 */
export function auditHeadIcons(ctx: BuildContext): void {
  if (ctx.pages.length === 0) return;
  const { files, host } = siteOf(ctx);
  for (const page of ctx.pages) {
    const linked = new Set<string>();
    for (const link of domOf(page).byTag('link')) {
      if (!tokensOf(link, 'rel').some((rel) => ICON_RELS.has(rel))) continue;
      const target = resolveHref(attr(link, 'href') ?? '', page.path, host);
      if (target.kind !== 'internal' || target.scheme === 'http') continue;
      if (target.query === '' && target.fragment === undefined) linked.add(target.path);
    }
    const missing = ICON_PATHS.filter((path) => !linked.has(path));
    if (missing.length > 0) ctx.report.add('head-icons', page.path, `no icon link to ${missing.join(', ')}`);
  }
  for (const path of ICON_PATHS) {
    if (!files.has(path.slice(1))) ctx.report.add('head-icons', path, 'the file is missing from dist');
  }
}

// head-jsonld

/** The types that no node may have, at any depth. */
const BANNED_TYPES: ReadonlySet<string> = new Set([
  'AggregateRating',
  'Review',
  'EmployerAggregateRating',
  'ClaimReview',
  'HowTo',
  'SpecialAnnouncement',
]);

/** The properties that no node may have, at any depth. */
const BANNED_PROPERTIES: ReadonlySet<string> = new Set(['aggregateRating', 'review']);

/** `WebPage` and its schema.org subtypes: each states the `inLanguage` of the page. */
const WEB_PAGE_TYPES: ReadonlySet<string> = new Set([
  'WebPage',
  'AboutPage',
  'CheckoutPage',
  'CollectionPage',
  'ContactPage',
  'FAQPage',
  'ImageGallery',
  'ItemPage',
  'MediaGallery',
  'MedicalWebPage',
  'ProfilePage',
  'QAPage',
  'RealEstateListing',
  'SearchResultsPage',
  'VideoGallery',
]);

/** The prefixes of a schema.org term written as an IRI or a compact IRI. */
const SCHEMA_PREFIXES: readonly string[] = ['https://schema.org/', 'http://schema.org/', 'schema:'];

/** A schema.org term without its vocabulary: `https://schema.org/Review` and `schema:Review` give `Review`. */
function term(text: string): string {
  for (const prefix of SCHEMA_PREFIXES) if (text.startsWith(prefix)) return text.slice(prefix.length);
  return text;
}

/** The days of `schedule.json` as schema.org names them. */
const DAY_NAMES: ReadonlyMap<string, string> = new Map([
  ['Mo', 'Monday'],
  ['Tu', 'Tuesday'],
  ['We', 'Wednesday'],
  ['Th', 'Thursday'],
  ['Fr', 'Friday'],
  ['Sa', 'Saturday'],
  ['Su', 'Sunday'],
]);

/** One node of a JSON-LD block: its properties (keys as schema.org terms, the first of a term wins) and types. */
interface JsonNode {
  properties: ReadonlyMap<string, unknown>;
  types: readonly string[];
}

/** A plain JSON object, as `JSON.parse` gives one. */
const isObject = (value: unknown): value is object =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The properties of a JSON object with each key as a schema.org term. A table, never an object: any key is safe. */
function propertiesOf(value: object): Map<string, unknown> {
  const out = new Map<string, unknown>();
  for (const [key, item] of Object.entries(value)) {
    const name = term(key);
    if (!out.has(name)) out.set(name, item);
  }
  return out;
}

/** A value as a list: an array as it is, any other value as a list of one. */
const listOf = (value: unknown): readonly unknown[] => (Array.isArray(value) ? value : [value]);

/** The types of a node: each string of its `@type`, as a schema.org term. */
const typesOf = (properties: ReadonlyMap<string, unknown>): string[] =>
  listOf(properties.get('@type'))
    .filter((type): type is string => typeof type === 'string' && type !== '')
    .map(term);

/**
 * The nodes of a parsed JSON-LD block, without recursion, and the problems of its shape. A node is a JSON object
 * that is none of these: a value object (`@value`), a list or set object (`@list`, `@set`), a graph container (an
 * object with `@graph` whose keys all start with `@`), a node reference (an object with `@id` alone, or an empty
 * object). `@context` holds no node.
 */
function nodesOf(value: unknown): { nodes: JsonNode[]; problems: string[] } {
  const nodes: JsonNode[] = [];
  const problems = new Set<string>();
  if (!listOf(value).every(isObject)) problems.add('the JSON-LD block is not an object or a list of objects');
  const stack: unknown[] = [value];
  while (stack.length > 0) {
    const item = stack.pop();
    if (Array.isArray(item)) {
      for (let index = item.length - 1; index >= 0; index -= 1) stack.push(item[index]);
      continue;
    }
    if (!isObject(item)) continue;
    const properties = propertiesOf(item);
    if (properties.has('@value')) continue;
    const keys = [...properties.keys()];
    const container = properties.has('@list') || properties.has('@set') || properties.has('@graph');
    const isNode = !(container && keys.every((key) => key.startsWith('@'))) && !keys.every((key) => key === '@id');
    if (isNode) {
      const types = typesOf(properties);
      nodes.push({ properties, types });
      if (types.length === 0) problems.add('a node has no @type');
      for (const type of types) if (BANNED_TYPES.has(type)) problems.add(`a node has the banned type ${type}`);
      for (const key of keys) if (BANNED_PROPERTIES.has(key)) problems.add(`a node has the banned property ${key}`);
    }
    for (const [key, child] of [...properties].reverse()) {
      if (key === '@context' || key === '@type' || key === '@id') continue;
      if (typeof child === 'object' && child !== null) stack.push(child);
    }
  }
  return { nodes, problems: [...problems] };
}

/** A phone number as `facts-value` compares it: the digits, with `+` for a leading `+` or `00`, `+41` for `0`. */
function phoneKey(text: string): string {
  const trimmed = text.trim();
  const plain = trimmed.toLowerCase().startsWith('tel:') ? trimmed.slice(4).trim() : trimmed;
  const digits = plain.replace(/\D+/g, '');
  if (plain.startsWith('+')) return `+${digits}`;
  if (digits.startsWith('00')) return `+${digits.slice(2)}`;
  if (digits.startsWith('0')) return `+41${digits.slice(1)}`;
  return digits;
}

/** A text value of a property, or `undefined` for any other value. A number counts as its text (a postal code). */
function textValue(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}

/**
 * A value as a detail or a set key shows it: a text or a finite number as its text, any other value as a fixed
 * word. The rule never writes out a value of unknown shape: `JSON.stringify` and `String` recurse, so an array that
 * nests 5,000 deep (which `JSON.parse` accepts) would overflow the stack.
 */
const shownValue = (value: unknown): string => textValue(value) ?? '(a value that is no text)';

/** A time of day as `HH:MM`: `07:00:00` gives `07:00`; any other value stays as `shownValue` shows it. */
const timeKey = (value: unknown): string => {
  const text = shownValue(value);
  return /^\d{2}:\d{2}:00$/.test(text) ? text.slice(0, 5) : text;
};

/**
 * Compares one stated property with its fact: the property must be text equal to the fact (compared by `key`), and
 * the fact must exist. A property the node does not state is no problem.
 */
function compareFact(
  problems: string[],
  properties: ReadonlyMap<string, unknown>,
  name: string,
  fact: string | undefined,
  key: (text: string) => string = (text) => text,
  label = name,
): void {
  if (!properties.has(name)) return;
  const value = textValue(properties.get(name));
  if (value === undefined) problems.push(`the organization ${label} is not text`);
  else if (fact === undefined) problems.push(`the organization ${label} ${quoted(value)} is not in site.json`);
  else if (key(value) !== key(fact)) {
    problems.push(`the organization ${label} is ${quoted(value)}; site.json has ${quoted(fact)}`);
  }
}

/** Compares two sets of keys: the first key that one has and the other lacks, as a problem. */
function compareSets(
  problems: string[],
  name: string,
  stated: ReadonlySet<string>,
  facts: ReadonlySet<string>,
  file: string,
): void {
  const extra = [...stated].find((key) => !facts.has(key));
  if (extra !== undefined) {
    problems.push(`the organization ${name} states ${quoted(extra)}, which ${file} does not`);
    return;
  }
  const missing = [...facts].find((key) => !stated.has(key));
  if (missing !== undefined) problems.push(`the organization ${name} lacks ${quoted(missing)} of ${file}`);
}

/** The address properties of a `PostalAddress` and the fields of `site.json` `address` that they state. */
const ADDRESS_FIELDS: readonly (readonly [string, 'street' | 'postalCode' | 'locality' | 'region' | 'country'])[] = [
  ['streetAddress', 'street'],
  ['postalCode', 'postalCode'],
  ['addressLocality', 'locality'],
  ['addressRegion', 'region'],
  ['addressCountry', 'country'],
];

/**
 * The problems of an organization node against `site.json` and `schedule.json`: each fact it states must equal the
 * fact. `email` compares in lower case, `telephone` as a phone number (`facts-value`), the rest exactly. The address
 * must be a `PostalAddress` object (a text address cannot be compared); `addressCountry` may be a `Country` with a
 * `name`. The opening hours compare as sets of (day, opens, closes), so one row for each day equals one row for the
 * week; the closures as sets of (from, to, 00:00, 00:00). `sameAs` is a subset of `site.json` `sameAs`.
 */
function organizationProblems(node: JsonNode, facts: Facts): string[] {
  const { site, schedule } = facts;
  const problems: string[] = [];
  const { properties } = node;
  compareFact(problems, properties, 'name', site.name);
  compareFact(problems, properties, 'legalName', site.legalName);
  compareFact(problems, properties, 'email', site.email, (text) => text.toLowerCase());
  compareFact(problems, properties, 'telephone', site.phone, phoneKey);
  compareFact(problems, properties, 'vatID', site.vatId);
  compareFact(problems, properties, 'taxID', site.uid);
  if (properties.has('address')) {
    const address = properties.get('address');
    if (site.address === undefined) problems.push('the organization states an address, but site.json has none');
    else if (!isObject(address)) problems.push('the organization address is not a PostalAddress object');
    else {
      const stated = propertiesOf(address);
      const country = stated.get('addressCountry');
      if (isObject(country)) stated.set('addressCountry', propertiesOf(country).get('name'));
      for (const [property, field] of ADDRESS_FIELDS) {
        compareFact(problems, stated, property, site.address[field], undefined, property);
      }
    }
  }
  if (properties.has('openingHoursSpecification')) {
    const expected = new Set<string>();
    for (const row of schedule.openingHours) {
      for (const day of row.days) expected.add(`${DAY_NAMES.get(day) ?? day} ${row.opens}–${row.closes}`);
    }
    const stated = new Set<string>();
    for (const item of listOf(properties.get('openingHoursSpecification'))) {
      const row = isObject(item) ? propertiesOf(item) : new Map<string, unknown>();
      const days = listOf(row.get('dayOfWeek')).map((day) => (typeof day === 'string' ? term(day) : shownValue(day)));
      for (const day of days) stated.add(`${day} ${timeKey(row.get('opens'))}–${timeKey(row.get('closes'))}`);
    }
    compareSets(problems, 'openingHoursSpecification', stated, expected, 'schedule.json openingHours');
  }
  if (properties.has('specialOpeningHoursSpecification')) {
    const expected = new Set(schedule.closures.map((closure) => `${closure.from}–${closure.to} 00:00–00:00`));
    const stated = new Set<string>();
    for (const item of listOf(properties.get('specialOpeningHoursSpecification'))) {
      const row = isObject(item) ? propertiesOf(item) : new Map<string, unknown>();
      const range = `${shownValue(row.get('validFrom'))}–${shownValue(row.get('validThrough'))}`;
      stated.add(`${range} ${timeKey(row.get('opens'))}–${timeKey(row.get('closes'))}`);
    }
    compareSets(problems, 'specialOpeningHoursSpecification', stated, expected, 'schedule.json closures');
  }
  if (properties.has('sameAs')) {
    const allowed = new Set(site.sameAs);
    for (const entry of listOf(properties.get('sameAs'))) {
      const text = shownValue(entry);
      if (typeof entry !== 'string' || !allowed.has(text))
        problems.push(`the organization sameAs ${quoted(text)} is not in site.json sameAs`);
    }
  }
  return problems;
}

/** The highest amount of an `Offer` price that the rule reads: twelve digits of major units. */
const MAJOR_PRICE = /^\d{1,12}(?:\.\d{1,2})?$/;

/**
 * The amount of an `Offer` `price` in minor units, or `undefined` when it is no price in major units. These forms
 * count: a number (`320`, `320.5`) and a text of digits with at most two decimals after a point (`"320"`,
 * `"320.00"`). A comma, a currency or a sign is not a price: `"320,00"` and `"CHF 320"` fail.
 */
function minorUnits(value: unknown): number | undefined {
  if (typeof value === 'number') {
    const minor = Math.round(value * 100);
    return Number.isFinite(value) && value >= 0 && Math.abs(minor - value * 100) < 1e-6 ? minor : undefined;
  }
  if (typeof value !== 'string' || !MAJOR_PRICE.test(value)) return undefined;
  const [whole = '0', fraction = ''] = value.split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}

/** The problem of one `Offer` node, or `undefined`. An `Offer` without a `price` states no price. */
function offerProblem(node: JsonNode, facts: Facts): string | undefined {
  if (!node.properties.has('price')) return undefined;
  const price = node.properties.get('price');
  const minor = minorUnits(price);
  const currency = node.properties.get('priceCurrency');
  const match = facts.site.prices.some(
    (entry) => entry.amount === minor && (typeof currency !== 'string' || entry.currency === currency),
  );
  if (match) return undefined;
  return `an Offer price ${quoted(shownValue(price))} is no price amount of site.json in major units`;
}

/**
 * `head-jsonld`: every JSON-LD block (`script[type=application/ld+json]`, anywhere in the page) parses and states
 * only the facts of `site.json` and `schedule.json`.
 *
 * A block that does not parse reports only that. Each problem of a page is one finding at the page path; a problem
 * that many nodes share (`a node has no @type`) reports once. An organization node is a node whose type is
 * `Organization` or the `type` of `site.json`. It must have an `@id`, and every page uses the same one: the first
 * organization `@id` in path order is the site's, and each other `@id` is one finding, at the first page that has it.
 */
export function auditHeadJsonld(ctx: BuildContext): void {
  const state: SharedId = {
    types: new Set(['Organization', ctx.facts.site.type]),
    shared: undefined,
    others: new Set(),
  };
  for (const page of ctx.pages) {
    const problems = new Set<string>();
    const blocks = domOf(page)
      .byTag('script')
      .filter((script) => scriptKind(script) === 'json-ld');
    for (const [index, block] of blocks.entries()) {
      const parsed = parseBlock(rawContentOf(block));
      if ('problem' in parsed) problems.add(`JSON-LD block ${index + 1} ${parsed.problem}`);
      else for (const problem of blockProblems(ctx, page, parsed.value, state)) problems.add(problem);
    }
    for (const problem of problems) ctx.report.add('head-jsonld', page.path, problem);
  }
}

/** What `head-jsonld` keeps across pages: the organization types, and the first organization `@id` of the site. */
interface SharedId {
  types: ReadonlySet<string>;
  shared: { id: string; path: string } | undefined;
  /** Each other `@id` that was reported, so that it reports once for the site. */
  others: Set<string>;
}

/** The parsed value of a JSON-LD block, or why it does not parse. */
function parseBlock(text: string): { value: unknown } | { problem: string } {
  try {
    return { value: JSON.parse(text) };
  } catch (error) {
    return { problem: `does not parse: ${snippet(error instanceof Error ? error.message : String(error))}` };
  }
}

/** The problems of one parsed JSON-LD block of a page. */
function blockProblems(ctx: BuildContext, page: BuiltPage, value: unknown, state: SharedId): string[] {
  const read = nodesOf(value);
  const problems = [...read.problems];
  const tag = tagOfPage(ctx, page) ?? '';
  for (const node of read.nodes) {
    if (node.types.some((type) => state.types.has(type))) {
      pushAll(problems, organizationProblems(node, ctx.facts));
      const id = node.properties.get('@id');
      if (typeof id !== 'string' || id === '') problems.push('the organization node has no @id');
      else if (state.shared === undefined) state.shared = { id, path: page.path };
      else if (id !== state.shared.id && !state.others.has(id)) {
        state.others.add(id);
        problems.push(`the organization @id is ${quoted(id)}; ${state.shared.path} has ${quoted(state.shared.id)}`);
      }
    }
    if (node.types.includes('Offer')) {
      const problem = offerProblem(node, ctx.facts);
      if (problem !== undefined) problems.push(problem);
    }
    if (node.types.some((type) => WEB_PAGE_TYPES.has(type))) {
      const language = node.properties.get('inLanguage');
      if (language === undefined) problems.push(`a WebPage has no inLanguage; expected "${tag}"`);
      else if (language !== tag) {
        problems.push(`a WebPage inLanguage is ${quoted(shownValue(language))}; expected "${tag}"`);
      }
    }
    if (node.types.includes('WebSite') && !isLocaleHome(page.path, ctx.options)) {
      problems.push('a WebSite node on a page that is no locale home');
    }
  }
  return problems;
}

// headings

/** The level of each heading tag. */
const HEADING_LEVELS: ReadonlyMap<string, number> = new Map([
  ['h1', 1],
  ['h2', 2],
  ['h3', 3],
  ['h4', 4],
  ['h5', 5],
  ['h6', 6],
]);

/** `headings-h1`: exactly one `h1` per page, `/404.html` included. */
export function auditHeadingsH1(ctx: BuildContext): void {
  for (const page of ctx.pages) {
    const count = domOf(page).byTag('h1').length;
    if (count !== 1) ctx.report.add('headings-h1', page.path, `the page has ${count} h1 elements; exactly 1`);
  }
}

/**
 * `headings-order`: each heading level ≤ previous + 1, starting from `h1`, `/404.html` included.
 *
 * The headings are the `h1`–`h6` elements in document order. A page with an `h1` must start with it; a page without
 * one is `headings-h1`'s, and only its steps are checked. One finding for each page: the detail names the first
 * wrong place and the number of wrong steps.
 */
export function auditHeadingsOrder(ctx: BuildContext): void {
  for (const page of ctx.pages) {
    const dom = domOf(page);
    const headings: { element: HTMLElement; level: number }[] = [];
    for (const element of dom.elements) {
      const level = HEADING_LEVELS.get(tagOf(element));
      if (level !== undefined) headings.push({ element, level });
    }
    const [first] = headings;
    if (first === undefined) continue;
    const wrong: string[] = [];
    if (first.level !== 1 && dom.byTag('h1').length > 0) {
      wrong.push(`the first heading is h${first.level} ${quoted(collapse(textOf(first.element)))}, not h1`);
    }
    let steps = 0;
    for (let index = 1; index < headings.length; index += 1) {
      const previous = headings[index - 1];
      const current = headings[index];
      if (previous === undefined || current === undefined || current.level <= previous.level + 1) continue;
      steps += 1;
      if (steps === 1) {
        const text = quoted(collapse(textOf(current.element)));
        wrong.push(`h${current.level} ${text} follows h${previous.level}`);
      }
    }
    if (steps > 1) wrong.push(`${steps} steps skip a level`);
    if (wrong.length > 0) ctx.report.add('headings-order', page.path, wrong.join('; '));
  }
}

// indexing-noindex

/**
 * `indexing-noindex`: no page other than `/404.html` carries `noindex` (or `none`) in a robots meta of any name of
 * `ROBOTS_NAMES` (`robots`, `googlebot`, `googlebot-news`, `bingbot`): each search engine obeys the meta of its own
 * crawler. `/404.html` carries it in `meta[name=robots]`, for every crawler. A missing `/404.html` is `routes-404`'s
 * alone: the rule has nothing to check then.
 */
export function auditIndexingNoindex(ctx: BuildContext): void {
  for (const page of ctx.pages) {
    if (page.is404 && !hasRobotsNoindex(page)) {
      ctx.report.add('indexing-noindex', page.path, 'the 404 page has no robots noindex');
    }
    if (!page.is404 && hasNoindex(page))
      ctx.report.add('indexing-noindex', page.path, 'the page carries robots noindex');
  }
}

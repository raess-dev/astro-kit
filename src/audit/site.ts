/**
 * The site audit (specification, 6.1, `astro:build:done`, step 4, second): the rules that compare pages with each
 * other and with the settings, in the order of section 8. Routes, hreflang, links and depth, and the legal pages (the
 * processors of the origins included) are here; the text rules (`facts-value` and `content-*`) are in `./text.ts`,
 * and this audit runs them at their place.
 *
 * **Who reports what.**
 *
 * - A missing `/404.html` and a second 404 page are `routes-404`'s alone.
 * - A page path that is not a clean slug path is `routes-slug`'s; a `404` segment in it stays `routes-404`'s.
 * - `routes-translation` asks that an alternate is listed; `hreflang-reciprocal` that each listed alternate is
 *   valid and points back; `hreflang-x-default` that `x-default` is the default-locale alternate, and it skips a page
 *   without a default-locale alternate (`routes-translation`'s).
 * - `links-resolve` reports each link (`a[href]`, `area[href]`) whose target is not built, a redirect source, a
 *   missing fragment or `http`. `links-depth` walks only the links that reach a built page; a missing locale home is
 *   its own finding, and the pages of that locale then report nothing more.
 * - `links-generic` reports a link without a name or with a generic one; `links-same-name` compares only links that
 *   have a name that is not generic.
 * - A declared legal page that is not built is `legal-pages`'s, at the field of `astro-kit.json`; a link to it is
 *   `links-resolve`'s.
 *
 * **Tags.** A locale tag compares as written, as `alternateIn` of `./dom.ts` compares it: `hreflang-reciprocal`
 * reports a tag in another letter case (`de-ch`) as a tag that names no locale. `routes-translation` counts such an
 * alternate as listed, so that the one wrong tag gives one finding.
 */
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { HTMLElement } from 'node-html-parser';
import { type BuildContext, type BuiltPage, LOCK_FILE } from '../context.ts';
import { sha256 } from '../csp.ts';
import { snippet } from '../css/rules.ts';
import { FORM_ACTION_PREFIX } from '../forms/limits.ts';
import { fieldPlace, type Locale, OPTIONS_FILE, type Options } from '../options.ts';
import { redirectMatcher } from '../redirects.ts';
import type { Report } from '../registry.ts';
import { localeHome, NOT_FOUND_PATH, pagePathProblems, pathSegments } from '../routes.ts';
import {
  type Alternate,
  type AuditRule,
  accessibleName,
  alternatesOf,
  attr,
  collapse,
  decodePath,
  domOf,
  type HrefTarget,
  isIndexable,
  legalText,
  linkedPages,
  linksOf,
  localeOf,
  MAX_NAME,
  nameKey,
  type PageDom,
  pageAt,
  resolveHref,
  runRules,
  sameLang,
  seenPageText,
  siteOf,
  tagOf,
  tokensOf,
} from './dom.ts';
import {
  auditContentCopied,
  auditContentGlossary,
  auditContentLanguage,
  auditContentNfc,
  auditContentStale,
  auditFactsValue,
  CONFORMANCE,
  GENERIC_LINK_TEXTS,
  NEGATION_WINDOW,
  NEGATIONS,
} from './text.ts';

/**
 * The exact detail of `routes-404` for a built page path `path` with a `404` segment (section 8). `path` is the
 * page path, such as `/fr/404/`.
 */
export const notFoundSegmentMessage = (path: string): string =>
  `${path} has a 404 segment. Under build.format 'directory' it is written to ${path}index.html, an ordinary page that answers 200. Cloudflare answers a missing URL only with a file named 404.html, which Astro builds only from src/pages/404.astro. Put every language on ${NOT_FOUND_PATH}.`;

/** The tag of a locale code, or `undefined` for a code that is not configured. */
const tagOfCode = (ctx: BuildContext, code: string): string | undefined => localeOf(ctx.options, code)?.tag;

/** The pages other than `/404.html`, in path order. */
const contentPages = (ctx: BuildContext): BuiltPage[] => ctx.pages.filter((page) => !page.is404);

/** A path or an href for a detail: short, on one line, in quotes when it could hold spaces. */
const shown = (text: string): string => JSON.stringify(snippet(text));

/**
 * The same-origin paths that a page links, as a set, each also as the path of the page it names (`pageAt`): a link
 * to `/zimmer/index.html` counts as a link to `/zimmer/` too. A path that is not built stays as written.
 */
function linkedPaths(ctx: BuildContext, page: BuiltPage): ReadonlySet<string> {
  const out = new Set<string>();
  for (const link of linksOf(ctx, page)) {
    if (link.target.kind !== 'internal') continue;
    out.add(link.target.path);
    const target = pageAt(ctx, link.target.path);
    if (target !== undefined) out.add(target.path);
  }
  return out;
}

// routes

/**
 * `routes-404`: `/404.html` exists, is the only 404 page, links every locale home and holds no form of the kit.
 *
 * - A missing `/404.html` is one finding at `/404.html`. The other checks then have no page to read.
 * - Each other page path with a segment `404` is one finding at that path, with the exact message of section 8.
 *   `routes-slug` leaves this segment to this rule. (A file `fr/404.html` has no such segment: its path does not end
 *   in `/`, and that is `routes-slug`'s.)
 * - Each locale home that no link of `/404.html` reaches is one finding: a link counts when its same-origin target
 *   path is the home or the file of the home (`/fr/index.html`, when it is built), whatever its query or fragment.
 *   Whether the home is built is `links-depth`'s.
 * - Each `form` whose action, resolved like a link, has a path that starts with `/api/forms/` (in any letter case) is one finding. A
 *   `formaction` of a control counts as such an action too, because it replaces the action of its form.
 */
export function auditRoutes404(ctx: BuildContext): void {
  const { pages, host } = siteOf(ctx);
  for (const page of ctx.pages) {
    if (!page.is404 && pathSegments(page.path).includes('404')) {
      ctx.report.add('routes-404', page.path, notFoundSegmentMessage(page.path));
    }
  }
  const notFound = pages.get(NOT_FOUND_PATH);
  if (notFound === undefined) {
    ctx.report.add('routes-404', NOT_FOUND_PATH, 'the file is missing: build it from src/pages/404.astro');
    return;
  }
  const linked = linkedPaths(ctx, notFound);
  for (const locale of ctx.options.locales) {
    const home = localeHome(locale.code, ctx.options);
    if (!linked.has(home)) ctx.report.add('routes-404', NOT_FOUND_PATH, `no link to the locale home ${home}`);
  }
  for (const element of domOf(notFound).elements) {
    const tag = tagOf(element);
    const name = tag === 'form' ? 'action' : 'formaction';
    const action = attr(element, name);
    if (action === undefined) continue;
    const target = resolveHref(action, notFound.path, host);
    // The prefix compares in any letter case, as `forms-declared` reads a kit form.
    if (target.kind === 'internal' && target.path.toLowerCase().startsWith(FORM_ACTION_PREFIX)) {
      ctx.report.add('routes-404', NOT_FOUND_PATH, `<${tag} ${name}=${shown(action)}> posts to a kit form`);
    }
  }
}

/**
 * `routes-slug`, the build half: every built page path other than `/404.html` is a clean slug path
 * (`pagePathProblems` of `../routes.ts`). One finding for each page, at its path, that names every problem. The
 * endpoint clause runs on the resolved routes (`checkResolvedRoutes`).
 */
export function auditRoutesSlug(ctx: BuildContext): void {
  for (const page of ctx.pages) {
    const problems = pagePathProblems(page.path, ctx.options);
    if (problems.length > 0) ctx.report.add('routes-slug', page.path, `built as ${page.file}: ${problems.join('; ')}`);
  }
}

/**
 * `routes-translation`: the alternates that the locales and their coverage require are listed.
 *
 * - Every page of a non-default locale lists an alternate with the default tag.
 * - In each other locale with `coverage: "full"`, every indexable default-locale page lists an alternate with that
 *   locale's tag.
 *
 * `/404.html` is exempt. The rule checks only that such an alternate is listed (its `hreflang` names the tag, in any
 * ASCII case); whether it is valid and reciprocal is `hreflang-reciprocal`'s. One finding for each page and missing
 * locale.
 */
export function auditRoutesTranslation(ctx: BuildContext): void {
  const { options } = ctx;
  const defaultTag = tagOfCode(ctx, options.defaultLocale);
  const full = options.locales.filter((locale) => locale.code !== options.defaultLocale && locale.coverage === 'full');
  for (const page of contentPages(ctx)) {
    const listed = alternatesOf(ctx, page).map((alternate) => alternate.hreflang);
    const lists = (tag: string): boolean => listed.some((hreflang) => sameLang(hreflang, tag));
    const missing: string[] = [];
    if (page.locale !== options.defaultLocale) {
      if (defaultTag !== undefined && !lists(defaultTag)) missing.push(defaultTag);
    } else if (isIndexable(page)) {
      for (const locale of full) if (!lists(locale.tag)) missing.push(locale.tag);
    }
    for (const tag of missing) {
      ctx.report.add('routes-translation', page.path, `no alternate with hreflang="${tag}"`);
    }
  }
}

/** The configured tags of the settings, as written. */
const tagsOf = (ctx: BuildContext): ReadonlySet<string> => new Set(ctx.options.locales.map((locale) => locale.tag));

const LISTED = new WeakMap<BuiltPage, ReadonlySet<string>>();

/**
 * Says whether a page lists `path` as an alternate with the tag `tag`. Any same-origin href of that path counts,
 * also one in a form that `hreflang-reciprocal` refuses (relative, `http`, with a query): that href is a finding of
 * its own page, so the page it names does not report the same fact again. The pairs of a page are a table, found
 * once, so that a page with many alternates costs no more than its length.
 */
function listsBack(ctx: BuildContext, page: BuiltPage, tag: string, path: string): boolean {
  let listed = LISTED.get(page);
  if (listed === undefined) {
    const pairs = new Set<string>();
    for (const alternate of alternatesOf(ctx, page)) {
      if (alternate.target.kind === 'internal') pairs.add(`${alternate.hreflang}\n${alternate.target.path}`);
    }
    listed = pairs;
    LISTED.set(page, listed);
  }
  return listed.has(`${tag}\n${path}`);
}

/** The locale of a configured tag, as written. */
const localeOfTag = (ctx: BuildContext, tag: string): Locale | undefined =>
  ctx.options.locales.find((locale) => locale.tag === tag);

/**
 * `hreflang-reciprocal`: the alternates of a page are valid, include it, and point to pages that list it back. A page
 * with no alternate is skipped.
 *
 * One finding for each alternate with a problem, with every problem of it in the detail:
 *
 * - its `hreflang` is neither a configured tag (as written) nor `x-default`;
 * - its `hreflang` came before on the page (the first one is not a problem);
 * - its `href` is not an absolute `https` URL on the host of `site`, without a query (`Alternate.path`);
 * - its target is not a built page;
 * - the target is a page of another locale than the tag names;
 * - the target does not list this page back (for a tag other than `x-default`): no alternate of the target has this page's tag and names this page's
 *   path in any same-origin form (a back link in a wrong form is the target's own finding).
 *
 * And one finding for the page when no alternate has the page's own tag and names its path ("include the page
 * itself"; again in any same-origin form, so a self alternate with a relative href reports once). The tags compare as
 * written.
 */
export function auditHreflangReciprocal(ctx: BuildContext): void {
  const { pages } = siteOf(ctx);
  const tags = tagsOf(ctx);
  for (const page of ctx.pages) {
    const alternates = alternatesOf(ctx, page);
    if (alternates.length === 0) continue;
    const ownTag = tagOfCode(ctx, page.locale);
    const seen = new Set<string>();
    for (const alternate of alternates) {
      const problems = alternateProblems(ctx, page, ownTag, alternate, { tags, seen, pages });
      if (problems.length > 0) {
        ctx.report.add(
          'hreflang-reciprocal',
          page.path,
          `hreflang=${shown(alternate.hreflang)} href=${shown(alternate.href)}: ${problems.join('; ')}`,
        );
      }
    }
    if (ownTag !== undefined && !listsBack(ctx, page, ownTag, page.path)) {
      ctx.report.add('hreflang-reciprocal', page.path, `no alternate with hreflang="${ownTag}" and the page's own URL`);
    }
  }
}

/** The problems of one alternate of `page`, for `hreflang-reciprocal`. */
function alternateProblems(
  ctx: BuildContext,
  page: BuiltPage,
  ownTag: string | undefined,
  alternate: Alternate,
  known: { tags: ReadonlySet<string>; seen: Set<string>; pages: ReadonlyMap<string, BuiltPage> },
): string[] {
  const problems: string[] = [];
  const { hreflang } = alternate;
  const isDefault = hreflang === 'x-default';
  if (!isDefault && !known.tags.has(hreflang)) problems.push('the hreflang names no configured locale');
  if (known.seen.has(hreflang)) problems.push('the hreflang is listed twice');
  known.seen.add(hreflang);
  if (alternate.path === undefined) {
    problems.push(`the href is not an absolute https URL under ${ctx.options.site} without a query`);
    return problems;
  }
  const target = known.pages.get(alternate.path);
  if (target === undefined) {
    problems.push('the href names no built page');
    return problems;
  }
  const locale = isDefault ? undefined : localeOfTag(ctx, hreflang);
  if (locale !== undefined && target.locale !== locale.code) {
    problems.push(`the target is a page of the locale ${target.locale}`);
  }
  // The target of `x-default` is the one of the default-locale alternate, which this check reads already.
  if (!isDefault && target !== page && ownTag !== undefined && !listsBack(ctx, target, ownTag, page.path)) {
    problems.push(`the target does not list this page back with hreflang="${ownTag}"`);
  }
  return problems;
}

/**
 * `hreflang-x-default`: `x-default` equals the default-locale alternate. A page with no alternate is skipped, and so
 * is a page with no alternate of the default tag (that is `routes-translation`'s, or for a default-locale page
 * `hreflang-reciprocal`'s "include the page itself"). The first `x-default` counts: a second one is
 * `hreflang-reciprocal`'s "listed twice". Two alternates are equal when they name the same page path. When one of
 * them is no absolute `https` URL of the site without a query (`Alternate.path`), `hreflang-reciprocal` reports that
 * href, and this rule compares nothing: one fact, one finding.
 */
export function auditHreflangXDefault(ctx: BuildContext): void {
  const defaultTag = tagOfCode(ctx, ctx.options.defaultLocale);
  for (const page of ctx.pages) {
    const alternates = alternatesOf(ctx, page);
    const fallback = alternates.find((alternate) => alternate.hreflang === defaultTag);
    if (fallback === undefined) continue;
    const xDefault = alternates.find((alternate) => alternate.hreflang === 'x-default');
    if (xDefault === undefined) {
      ctx.report.add('hreflang-x-default', page.path, `no x-default; expected href=${shown(fallback.href)}`);
    } else if (xDefault.path !== undefined && fallback.path !== undefined && xDefault.path !== fallback.path) {
      ctx.report.add(
        'hreflang-x-default',
        page.path,
        `x-default href=${shown(xDefault.href)}; expected href=${shown(fallback.href)}`,
      );
    }
  }
}

// links

/**
 * The accessible name of a link (Measurement details). An `area` has no text: its `alt` stands for the text, as in
 * HTML, before the `title` attribute.
 */
function linkName(dom: PageDom, element: HTMLElement): string {
  if (tagOf(element) !== 'area') return accessibleName(dom, element);
  if (tokensOf(element, 'aria-labelledby').length > 0 || collapse(attr(element, 'aria-label') ?? '') !== '') {
    return accessibleName(dom, element);
  }
  return collapse(attr(element, 'alt') ?? '').slice(0, MAX_NAME) || accessibleName(dom, element);
}

/** Says whether a fragment names an element of a page: as written, or percent-decoded. `''` names none. */
function hasFragment(dom: PageDom, fragment: string): boolean {
  if (fragment === '') return false;
  if (dom.byId.has(fragment)) return true;
  const decoded = decodePath(fragment);
  return decoded !== undefined && dom.byId.has(decoded);
}

const MATCHERS = new WeakMap<BuildContext, (path: string) => boolean>();

/** Says whether a path is a source of `redirects.json` (`redirectMatcher`), with the matcher built once per context. */
function isRedirected(ctx: BuildContext, path: string): boolean {
  let matcher = MATCHERS.get(ctx);
  if (matcher === undefined) {
    matcher = redirectMatcher(ctx.redirects);
    MATCHERS.set(ctx, matcher);
  }
  return matcher(path);
}

/** The problems of one link target for `links-resolve`, or none. */
function linkProblems(ctx: BuildContext, page: BuiltPage, target: HrefTarget): string[] {
  if (target.kind === 'external') return [];
  if (target.kind === 'invalid') return ['it is no valid URL'];
  if (target.kind === 'fragment') {
    return hasFragment(domOf(page), target.fragment) ? [] : [`#${target.fragment} names no element of the page`];
  }
  const { pages, files } = siteOf(ctx);
  const problems: string[] = [];
  if (target.scheme === 'http') problems.push('it uses http, not https');
  if (target.query !== '') problems.push('it has a query');
  const built = pages.has(target.path) || files.has(target.path.slice(1));
  if (!built) problems.push(`${target.path} is no built page or file`);
  if (isRedirected(ctx, target.path)) problems.push(`${target.path} is a redirect source`);
  if (built && target.fragment !== undefined) {
    const linked = pageAt(ctx, target.path);
    if (linked !== undefined && !hasFragment(domOf(linked), target.fragment)) {
      problems.push(`#${target.fragment} names no element of ${linked.path}`);
    }
  }
  return problems;
}

/**
 * `links-resolve`: every same-origin link reaches a built page or file, and its fragment.
 *
 * It reads the links of a page (`a[href]`, `area[href]`); `link` elements are the head rules'. For each link:
 *
 * - a fragment-only href (`#content`) names an id on the page, as written or percent-decoded; `#` alone names none;
 * - a same-origin href: its path equals, byte for byte, a built page path or `/` and a dist file (`/zimmer` fails,
 *   `/zimmer/index.html` passes); it uses no `http` (an absolute href uses https); it has no query (with a query it
 *   equals no path byte for byte); its path is no source of `redirects.json`; its fragment names an id on the target
 *   page (a fragment of a file that is no page is not checked);
 * - an absolute `http` or `https` href that is no valid URL fails, because it cannot resolve.
 *
 * Another origin and another scheme (`mailto:`, `tel:`) are no concern of this rule. One finding for each link, with
 * every problem in the detail.
 */
export function auditLinksResolve(ctx: BuildContext): void {
  for (const page of ctx.pages) {
    for (const link of linksOf(ctx, page)) {
      const problems = linkProblems(ctx, page, link.target);
      if (problems.length > 0) {
        ctx.report.add(
          'links-resolve',
          page.path,
          `<${tagOf(link.element)} href=${shown(link.href)}>: ${problems.join('; ')}`,
        );
      }
    }
  }
}

/**
 * `links-generic`: every link (`a[href]`, `area[href]`) has an accessible name (Measurement details), and its key
 * (`nameKey`: lower case, the characters that are not letters removed at both ends) is not a generic text. A name
 * whose key is empty, such as a phone number, is a name and passes. One finding for each link.
 */
export function auditLinksGeneric(ctx: BuildContext): void {
  for (const page of ctx.pages) {
    const dom = domOf(page);
    for (const link of linksOf(ctx, page)) {
      const name = linkName(dom, link.element);
      const element = `<${tagOf(link.element)} href=${shown(link.href)}>`;
      if (name === '') ctx.report.add('links-generic', page.path, `${element} has no accessible name`);
      else if (GENERIC_LINK_TEXTS.has(nameKey(name))) {
        ctx.report.add('links-generic', page.path, `${element} has the generic name ${shown(name)}`);
      }
    }
  }
}

/** The target of a link for `links-same-name`: the page path and the fragment, or the href of another origin. */
function targetKey(ctx: BuildContext, page: BuiltPage, href: string, target: HrefTarget): string {
  if (target.kind === 'fragment') return target.fragment === '' ? page.path : `${page.path}#${target.fragment}`;
  if (target.kind !== 'internal') return href.trim();
  const path = pageAt(ctx, target.path)?.path ?? target.path;
  return target.fragment === undefined || target.fragment === '' ? path : `${path}#${target.fragment}`;
}

/**
 * `links-same-name`: the links of a page that share an accessible name share one target.
 *
 * - Names compare in lower case after white space is collapsed: a reader hears `Zimmer` and `zimmer` as one name.
 * - A link without a name, or with a generic one, is `links-generic`'s and is left out here.
 * - The target is the page path and the fragment (`/zimmer/#preise`; the file of a page counts as its path, and an
 *   empty fragment as none; the query does not count), or the href as written for another origin or scheme
 *   (`mailto:`, `tel:`).
 *
 * One finding for each name with more than one target, listing the targets in document order.
 */
export function auditLinksSameName(ctx: BuildContext): void {
  for (const page of ctx.pages) {
    const dom = domOf(page);
    const groups = new Map<string, { name: string; targets: Set<string> }>();
    for (const link of linksOf(ctx, page)) {
      const name = linkName(dom, link.element);
      if (name === '' || GENERIC_LINK_TEXTS.has(nameKey(name))) continue;
      const key = name.toLowerCase();
      let group = groups.get(key);
      if (group === undefined) {
        group = { name, targets: new Set() };
        groups.set(key, group);
      }
      group.targets.add(targetKey(ctx, page, link.href, link.target));
    }
    for (const { name, targets } of groups.values()) {
      if (targets.size < 2) continue;
      const list = [...targets].map(shown).join(', ');
      ctx.report.add('links-same-name', page.path, `the name ${shown(name)} links to ${snippet(list)}`);
    }
  }
}

/** The values of `target` that keep a link in its window (ASCII case-insensitive, HTML). */
const SAME_WINDOW: ReadonlySet<string> = new Set(['_self', '_top', '_parent']);

/**
 * `links-target-blank`: every element with a `target` attribute (`a`, `area`, `form`, `base`) has the value `_self`,
 * `_top` or `_parent`, in any ASCII letter case. Any other value, the empty one included, fails. One finding for each
 * element. (`csp-base` reports a `<base>` too: two facts.)
 */
export function auditLinksTargetBlank(ctx: BuildContext): void {
  for (const page of ctx.pages) {
    for (const element of domOf(page).elements) {
      const value = attr(element, 'target');
      if (value === undefined) continue;
      const lower = value.replace(/[A-Z]+/g, (upper) => upper.toLowerCase());
      if (!SAME_WINDOW.has(lower)) {
        ctx.report.add('links-target-blank', page.path, `<${tagOf(element)} target=${shown(value)}>`);
      }
    }
  }
}

/** The click depth of every page from one home: breadth-first over the links that reach a built page. */
function depthsFrom(ctx: BuildContext, home: BuiltPage): ReadonlyMap<string, number> {
  const { pages } = siteOf(ctx);
  const depths = new Map<string, number>([[home.path, 0]]);
  const queue: BuiltPage[] = [home];
  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index];
    if (current === undefined) break;
    const depth = depths.get(current.path) ?? 0;
    for (const path of linkedPages(ctx, current)) {
      if (depths.has(path)) continue;
      const next = pages.get(path);
      if (next === undefined) continue;
      depths.set(path, depth + 1);
      queue.push(next);
    }
  }
  return depths;
}

/**
 * `links-depth`: each locale home exists when its locale has pages, and every indexable page is within `clickDepth`
 * clicks of its locale home.
 *
 * - A locale has pages when a built page other than `/404.html` has its locale. Its home missing (`/fr/`) is one
 *   finding at the home path; the pages of that locale then report nothing more (one fact).
 * - The walk is breadth-first from the home over every link of a page whose path is a built page, in any locale (the
 *   language links count). The home has depth 0. A link to a target that is not built is no edge (`links-resolve`
 *   reports it).
 * - Each indexable page deeper than `clickDepth`, or not reached, is one finding at its path.
 */
export function auditLinksDepth(ctx: BuildContext): void {
  const { pages } = siteOf(ctx);
  const limit = ctx.limits.clickDepth;
  const withPages = new Set(contentPages(ctx).map((page) => page.locale));
  const depths = new Map<string, ReadonlyMap<string, number>>();
  for (const locale of ctx.options.locales) {
    if (!withPages.has(locale.code)) continue;
    const homePath = localeHome(locale.code, ctx.options);
    const home = pages.get(homePath);
    if (home === undefined) {
      ctx.report.add('links-depth', homePath, `the locale ${locale.code} has pages, but its home is not built`);
      continue;
    }
    depths.set(locale.code, depthsFrom(ctx, home));
  }
  for (const page of ctx.pages) {
    if (!isIndexable(page)) continue;
    const fromHome = depths.get(page.locale);
    if (fromHome === undefined) continue;
    const home = localeHome(page.locale, ctx.options);
    const depth = fromHome.get(page.path);
    if (depth === undefined) ctx.report.add('links-depth', page.path, `no link path from ${home} reaches the page`);
    else if (depth > limit) {
      ctx.report.add('links-depth', page.path, `${depth} clicks from ${home}; at most ${limit}`);
    }
  }
}

// legal

/** The kinds of legal paths in `astro-kit.json`, in the order of 5.2. */
export const LEGAL_KINDS = ['legalNote', 'privacy', 'accessibility'] as const;

type LegalKind = (typeof LEGAL_KINDS)[number];

/** The declared paths of one kind, by locale code. A plain record of the settings, read into a table. */
const legalPaths = (ctx: BuildContext, kind: LegalKind): ReadonlyMap<string, string> =>
  new Map(Object.entries(ctx.options.legal[kind] ?? {}));

/**
 * `legal-pages`: the declared legal pages are built in their locales, and every indexable page links its own
 * locale's legal note and privacy page.
 *
 * - Each path of `legal.legalNote`, `legal.privacy` and `legal.accessibility` that is no built page of the locale of
 *   its key is one finding at the field: `astro-kit.json: legal.privacy.fr`.
 * - Every indexable page links the legal note and the privacy path of its locale: a link whose same-origin target path
 *   equals the path, or is the file of that page (`linkedPaths`). The target need not be built (that fact is the
 *   declaration's). One finding for each page that
 *   misses a link, naming the missing paths. A locale with no declared path has nothing to link.
 */
export function auditLegalPages(ctx: BuildContext): void {
  const { pages } = siteOf(ctx);
  for (const kind of LEGAL_KINDS) {
    for (const [code, path] of legalPaths(ctx, kind)) {
      const page = pages.get(path);
      const problem =
        page === undefined
          ? `${path} is not built`
          : page.locale === code
            ? undefined
            : `${path} is a page of the locale ${page.locale}, not ${code}`;
      if (problem !== undefined)
        ctx.report.add('legal-pages', fieldPlace(OPTIONS_FILE, ['legal', kind, code]), problem);
    }
  }
  const notes = legalPaths(ctx, 'legalNote');
  const privacy = legalPaths(ctx, 'privacy');
  for (const page of ctx.pages) {
    if (!isIndexable(page)) continue;
    const required = [notes.get(page.locale), privacy.get(page.locale)].filter((path) => path !== undefined);
    if (required.length === 0) continue;
    const linked = linkedPaths(ctx, page);
    const missing = required.filter((path) => !linked.has(path));
    if (missing.length > 0) ctx.report.add('legal-pages', page.path, `no link to ${missing.join(' and ')}`);
  }
}

/** The words of a text with their places, as `wordsOf` finds them. */
const WORD = /\p{L}+(?:['’]\p{L}+)*/gu;

/**
 * Says whether a negation cancels the match at `index` (Measurement details, `legal-statement`): one of `NEGATIONS`
 * stands as a whole word, in any letter case, in the `NEGATION_WINDOW` characters before the match. A word that the
 * window cuts at its start is not whole: also not one whose apostrophe is the first character of the window.
 */
function isNegated(text: string, index: number): boolean {
  const start = Math.max(0, index - NEGATION_WINDOW);
  for (const match of text.slice(start, index).matchAll(WORD)) {
    if (continuesBefore(text, start + match.index)) continue;
    if (NEGATIONS.has(match[0].toLowerCase())) return true;
  }
  return false;
}

const isLetter = (char: string | undefined): boolean => char !== undefined && /\p{L}/u.test(char);

/**
 * Says whether the word at `start` begins before it: the character before is a letter, or an apostrophe between two
 * letters (Measurement details, Words).
 */
function continuesBefore(text: string, start: number): boolean {
  const before = text[start - 1];
  if (isLetter(before)) return true;
  return (before === "'" || before === '’') && isLetter(text[start - 2]) && isLetter(text[start]);
}

/**
 * `legal-statement`: a declared accessibility page claims conformance only when `site.json` has `accessibilityAudit`.
 * The text is the page text (Measurement details: the `textContent` of `body`, so a claim in the footer counts). A
 * match of `CONFORMANCE` is a claim unless a negation cancels it (`isNegated`). One finding for each page with a claim,
 * not for each claim. A declared page that is not built is `legal-pages`'s.
 */
export function auditLegalStatement(ctx: BuildContext): void {
  if (ctx.facts.site.accessibilityAudit !== undefined) return;
  const { pages } = siteOf(ctx);
  const done = new Set<string>();
  for (const path of legalPaths(ctx, 'accessibility').values()) {
    const page = pages.get(path);
    if (page === undefined || done.has(path)) continue;
    done.add(path);
    const text = seenPageText(page);
    const claim = [...text.matchAll(new RegExp(CONFORMANCE, 'giu'))].find(
      (match) => !isNegated(text, match.index ?? 0),
    );
    if (claim !== undefined) {
      ctx.report.add(
        'legal-statement',
        page.path,
        `the page claims conformance (${shown(claim[0])}), but site.json has no accessibilityAudit`,
      );
    }
  }
}

// The legal lock (5.6, `legal-approved`): `legal.lock.json` holds one hash for each declared legal path that is built,
// and the owner approves each change to it. `lockEntries` hashes the legal text, `renderLock` gives the text that
// `astro-kit legal --write` writes, and `checkLock` is the rule, which the build audit and `legal --check` run.

/** The text of `legal.lock.json` in a project root, or `undefined` when the root holds no such file. */
export function readLock(root: string): string | undefined {
  const file = join(root, LOCK_FILE);
  return statSync(file, { throwIfNoEntry: false })?.isFile() === true ? readFileSync(file, 'utf8') : undefined;
}

/**
 * Every declared legal path (`legal.legalNote`, `legal.privacy`, `legal.accessibility`), once, sorted. A path that is
 * declared twice, for example as the legal note and as the accessibility page, is one path.
 */
export function declaredLegalPaths(options: Pick<Options, 'legal'>): string[] {
  const paths = new Set<string>();
  for (const kind of LEGAL_KINDS) for (const path of Object.values(options.legal[kind] ?? {})) paths.add(path);
  return [...paths].sort();
}

/** The hash of each declared legal path that is built, by path, in the sorted order of the paths. */
export function lockEntries(
  options: Pick<Options, 'legal'>,
  pages: ReadonlyMap<string, BuiltPage>,
): Map<string, string> {
  const entries = new Map<string, string>();
  for (const path of declaredLegalPaths(options)) {
    const page = pages.get(path);
    if (page !== undefined) entries.set(path, sha256(legalText(page)));
  }
  return entries;
}

/** The text of `legal.lock.json`: the entries with sorted keys, two-space indentation and a final newline (6.4). */
export function renderLock(entries: ReadonlyMap<string, string>): string {
  const sorted = [...entries].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `${JSON.stringify(Object.fromEntries(sorted), null, 2)}\n`;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * `legal-approved`: for each declared legal path that is built, the hash of its legal text equals the entry of that
 * path in `legal.lock.json`, and the file has no other key.
 *
 * - `lock` is the text of the file, or `undefined` when there is no file. A missing file has no entry, so each
 *   built path is a finding, and a project with no built legal page has none. A text that is not JSON and a JSON
 *   value that is not an object are one finding each, at `legal.lock.json`, and nothing else is compared.
 * - A built path without an entry, or whose hash differs, is one finding at the page path. A value that is not a
 *   text differs from every hash.
 * - A key that is no declared legal path is one finding at its field: `legal.lock.json: /alt/`. A key of a
 *   declared path that is not built is no other key: that page is `legal-pages`'s.
 */
export function checkLock(
  options: Pick<Options, 'legal'>,
  pages: ReadonlyMap<string, BuiltPage>,
  lock: string | undefined,
  report: Report,
): void {
  let value: unknown = {};
  try {
    if (lock !== undefined) value = JSON.parse(lock);
  } catch {
    report.add('legal-approved', LOCK_FILE, 'the file is not valid JSON');
    return;
  }
  if (!isRecord(value)) {
    report.add('legal-approved', LOCK_FILE, 'the file is not a JSON object');
    return;
  }
  const locked = new Map(Object.entries(value));
  for (const [path, hash] of lockEntries(options, pages)) {
    if (!locked.has(path)) {
      report.add('legal-approved', path, `${LOCK_FILE} has no entry for this page`);
      continue;
    }
    const entry = locked.get(path);
    if (entry !== hash) {
      const held = typeof entry === 'string' ? entry : JSON.stringify(entry);
      report.add('legal-approved', path, `the legal text hashes to ${hash}, and ${LOCK_FILE} holds ${held}`);
    }
  }
  const declared = new Set(declaredLegalPaths(options));
  for (const key of [...locked.keys()].sort()) {
    if (!declared.has(key))
      report.add('legal-approved', fieldPlace(LOCK_FILE, [key]), 'no declared legal path has this key');
  }
}

/**
 * `legal-approved`: the hash of the legal text of each declared legal path that is built equals its entry in
 * `legal.lock.json`, and the file has no other key (``checkLock`, which `legal --check` runs too).
 */
export function auditLegalApproved(ctx: BuildContext): void {
  checkLock(ctx.options, siteOf(ctx).pages, ctx.legalLock, ctx.report);
}

/**
 * The text of a processor as the legal text holds text: in NFC, with each run of white space as one space, trimmed
 * (Measurement details, "Legal text and page text"). Without it, a processor with two spaces could never match.
 */
const processorText = (processor: string): string => collapse(processor.normalize('NFC'));

/**
 * `legal-origins`: the legal text (`legalText`, the text of `main`) of the privacy page of each locale holds the
 * `processor` of each entry of `origins` as an exact substring, in its letter case (9.4). The processor reads as the
 * legal text does (`processorText`). One finding for each privacy page that lacks a processor, naming every missing
 * one. A declared privacy page that is not built is `legal-pages`'s.
 */
export function auditLegalOrigins(ctx: BuildContext): void {
  const processors = [...new Set(ctx.options.origins.map((origin) => processorText(origin.processor)))];
  if (processors.length === 0) return;
  const { pages } = siteOf(ctx);
  const done = new Set<string>();
  for (const path of legalPaths(ctx, 'privacy').values()) {
    const page = pages.get(path);
    if (page === undefined || done.has(path)) continue;
    done.add(path);
    const text = legalText(page);
    const missing = processors.filter((processor) => !text.includes(processor));
    if (missing.length > 0) {
      ctx.report.add(
        'legal-origins',
        page.path,
        `the privacy text does not name the processor ${missing.map(shown).join(', ')}`,
      );
    }
  }
}

// The audit

/** The rules of the site audit, in the order of section 8, the text rules of `./text.ts` included. */
export const SITE_RULES: readonly AuditRule[] = [
  { id: 'routes-404', run: auditRoutes404 },
  { id: 'routes-slug', run: auditRoutesSlug },
  { id: 'routes-translation', run: auditRoutesTranslation },
  { id: 'hreflang-reciprocal', run: auditHreflangReciprocal },
  { id: 'hreflang-x-default', run: auditHreflangXDefault },
  { id: 'links-resolve', run: auditLinksResolve },
  { id: 'links-generic', run: auditLinksGeneric },
  { id: 'links-same-name', run: auditLinksSameName },
  { id: 'links-target-blank', run: auditLinksTargetBlank },
  { id: 'links-depth', run: auditLinksDepth },
  { id: 'facts-value', run: auditFactsValue },
  { id: 'content-stale', run: auditContentStale },
  { id: 'content-language', run: auditContentLanguage },
  { id: 'content-copied', run: auditContentCopied },
  { id: 'content-glossary', run: auditContentGlossary },
  { id: 'content-nfc', run: auditContentNfc },
  { id: 'legal-pages', run: auditLegalPages },
  { id: 'legal-statement', run: auditLegalStatement },
  { id: 'legal-approved', run: auditLegalApproved },
  { id: 'legal-origins', run: auditLegalOrigins },
];

/** The site audit: every rule of `SITE_RULES`, in order. */
export function auditSite(ctx: BuildContext): void {
  runRules(ctx, SITE_RULES);
}

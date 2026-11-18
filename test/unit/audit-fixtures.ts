/**
 * Shared inputs of the unit tests of the page, site, budgets and html audits (parts 5b and 5c of M5): built pages
 * shaped as Astro 7.4 writes them with the kit, and a `BuildContext` from strings (14.1). A helper here never
 * asserts: it throws an `Error` when its input is not valid.
 *
 * The page shape is the one of the test site, built with the packed kit: `<!DOCTYPE html><html lang> <head>` with
 * the head tags of the project in this order (charset, viewport, title, description, robots, canonical, alternates,
 * Open Graph, icons, JSON-LD), then the CSP meta that Astro writes, then the two inserts of `build:done`, then the
 * one `<style>`; then ` <body> ` with the skip link, the header, `<main id="content">` and the footer. Astro keeps one
 * space between tags where the source has white space (`compressHTML`).
 *
 * A test takes `page()` or `site()` and changes one thing. The smallest input that meets one rule is often smaller:
 * a test may write its own HTML, in the same shape.
 */
import { memoryContext } from '../../src/build.ts';
import type { BuildContext, Design } from '../../src/context.ts';
import { metaDirectives, SPECULATION_HASH, scriptResources, sha256 } from '../../src/csp.ts';
import { inserts } from '../../src/inject.ts';
import { enabledModes, hasModeScript, modeHash } from '../../src/modes.ts';
import type { Options } from '../../src/options.ts';
import type { RedirectRow } from '../../src/redirects.ts';
import { Report } from '../../src/registry.ts';
import { localeHome } from '../../src/routes.ts';
import { factsOf, optionsOf, SITE, TWO_LOCALES } from './fixtures.ts';

// Settings and facts

/** The settings of most cases: `TWO_LOCALES` (de-CH by default, fr-CH), one mode option, speculation rules on. */
export const OPTIONS: Options = optionsOf(TWO_LOCALES);

/** The same with the mode options `auto`, `light` and `dark`: pages get the mode script and a mode switch. */
export const SWITCH_OPTIONS: Options = optionsOf({
  ...TWO_LOCALES,
  modes: { auto: true, light: true, dark: true, contrast: false },
});

/** A design with no token: the page, site, budgets and html audits do not read it. */
export const NO_DESIGN: Design = {
  themes: ['light'],
  colors: [],
  tokens: [],
  helpers: [],
  breakpoints: [],
  pairs: [],
  elements: [],
  components: [],
};

// The CSP meta

/** The page CSS of the fixture pages: a short layered text, as the minifier writes one. */
export const PAGE_CSS = '@layer reset{*{margin:0}}';

/**
 * The content of the CSP meta as Astro writes it: the directives of `metaDirectives` joined with `;`, then
 * `; script-src` with the resources and the hashes, then `; style-src 'self'` with the hashes, and a final `;`.
 * `scripts` are the inline texts whose hashes Astro adds after the kit hashes, `styles` the inline style texts.
 */
export function cspContent(
  options: Options,
  inline: { scripts?: readonly string[]; styles?: readonly string[] } = {},
): string {
  const kit = [
    ...(options.prefetch.speculationRules ? [SPECULATION_HASH] : []),
    ...(hasModeScript(options) ? [modeHash(options)] : []),
  ];
  const scripts = [...scriptResources(options), ...kit, ...(inline.scripts ?? []).map(sha256)].map(quoteHash);
  const styles = ["'self'", ...(inline.styles ?? []).map(sha256)].map(quoteHash);
  return `${metaDirectives(options).join(';')}; script-src ${scripts.join(' ')}; style-src ${styles.join(' ')};`;
}

/** A hash as a CSP source, in quotes: `'sha256-…'`. Another source stays as it is. */
const quoteHash = (source: string): string => (source.startsWith('sha256-') ? `'${source}'` : source);

/** The CSP meta of a page. */
export const cspMeta = (content: string): string => `<meta http-equiv="content-security-policy" content="${content}">`;

// Pages

/** The texts of a fixture page in one locale. */
interface LocaleTexts {
  skip: string;
  languages: string;
  mode: string;
  modes: Readonly<Record<string, string>>;
  legalNote: string;
  privacy: string;
}

const TEXTS: ReadonlyMap<string, LocaleTexts> = new Map<string, LocaleTexts>([
  [
    'de',
    {
      skip: 'Zum Inhalt springen',
      languages: 'Sprache',
      mode: 'Darstellung',
      modes: { auto: 'Automatisch', light: 'Hell', dark: 'Dunkel', contrast: 'Mehr Kontrast' },
      legalNote: 'Impressum',
      privacy: 'Datenschutz',
    },
  ],
  [
    'fr',
    {
      skip: 'Aller au contenu',
      languages: 'Langue',
      mode: 'Affichage',
      modes: { auto: 'Automatique', light: 'Clair', dark: 'Sombre', contrast: 'Plus de contraste' },
      legalNote: 'Mentions légales',
      privacy: 'Protection des données',
    },
  ],
]);

/** The parts of a fixture page. Every part has a default that meets the page rules. */
export interface PageParts {
  /** The `lang` of `html`. The default is the tag of the locale of the path. */
  lang?: string;
  title?: string;
  description?: string;
  /** The paths of the page in each locale code, the page itself included. The default is the page alone. */
  alternates?: Readonly<Record<string, string>>;
  /** Tags at the end of the project head, before the CSP meta (Astro writes the meta after them). */
  head?: string;
  /** Replaces the JSON-LD block. `''` leaves it out. */
  jsonld?: string;
  /** The content of `main`. The default is an `h1` and one short paragraph. */
  main?: string;
  /** Replaces the header (the brand link, the language links and the mode switch). */
  header?: string;
  /** Replaces the footer (the legal links). */
  footer?: string;
  /** Replaces the content of the CSP meta. The default is `cspContent(options, { styles: [css] })`. */
  csp?: string;
  /** The page CSS. The default is `PAGE_CSS`. */
  css?: string;
}

/** The locale code of a path, as the kit reads it. */
function codeOf(options: Options, path: string): string {
  const first = path.split('/')[1] ?? '';
  return options.locales.some((locale) => locale.code === first && first !== options.defaultLocale)
    ? first
    : options.defaultLocale;
}

function textsOf(code: string): LocaleTexts {
  const texts = TEXTS.get(code);
  if (texts === undefined) throw new Error(`audit-fixtures: no texts for the locale ${code}`);
  return texts;
}

function tagOfCode(options: Options, code: string): string {
  const tag = options.locales.find((locale) => locale.code === code)?.tag;
  if (tag === undefined) throw new Error(`audit-fixtures: no locale ${code}`);
  return tag;
}

/** The legal path of a locale. */
function legalPath(paths: Readonly<Record<string, string>> | undefined, code: string): string {
  const path = new Map(Object.entries(paths ?? {})).get(code);
  if (path === undefined) throw new Error(`audit-fixtures: no legal path for ${code}`);
  return path;
}

/** The mode switch of 9.3 with a radio group, for the enabled options of the settings. */
export function modeSwitch(options: Options, code: string): string {
  const texts = textsOf(code);
  const names = new Map(Object.entries(texts.modes));
  const radios = enabledModes(options)
    .map((mode) => `<label> <input type="radio" name="mode" value="${mode}"> ${names.get(mode) ?? mode} </label>`)
    .join('');
  return `<fieldset class="mode-switch" data-mode-switch> <legend>${texts.mode}</legend> ${radios} </fieldset>`;
}

/** The header of a page: the brand link, the links to the page in each locale, and the mode switch. */
function headerOf(options: Options, code: string, alternates: ReadonlyMap<string, string>): string {
  const texts = textsOf(code);
  const languages = options.locales
    .filter((locale) => alternates.has(locale.code))
    .map((locale) => {
      const current = locale.code === code ? ' aria-current="page"' : '';
      return `<li><a href="${alternates.get(locale.code) ?? ''}" lang="${locale.tag}" hreflang="${locale.tag}"${current}> ${locale.code.toUpperCase()} </a></li>`;
    })
    .join('');
  const modes = hasModeScript(options) ? ` ${modeSwitch(options, code)}` : '';
  return `<header class="site-header"> <a class="site-header__brand" href="${localeHome(code, options)}">Example</a> <nav aria-label="${texts.languages}"> <ul>${languages}</ul> </nav>${modes} </header>`;
}

/** The footer of a page: the links to the legal note and the privacy page of the locale. */
function footerOf(options: Options, code: string): string {
  const texts = textsOf(code);
  const note = legalPath(options.legal.legalNote, code);
  const privacy = legalPath(options.legal.privacy, code);
  return `<footer class="site-footer"> <nav aria-label="${texts.legalNote}"> <a href="${note}">${texts.legalNote}</a> <a href="${privacy}">${texts.privacy}</a> </nav> </footer>`;
}

/**
 * The JSON-LD block of a page for the facts of `SITE`: the organization node, the `WebPage` node, and the `WebSite`
 * node on a locale home.
 */
export function jsonld(options: Options, path: string, title: string, description: string): string {
  const origin = options.site;
  const code = codeOf(options, path);
  const graph: unknown[] = [
    {
      '@type': 'Organization',
      '@id': `${origin}/#organization`,
      name: SITE.name,
      legalName: SITE.legalName,
      url: `${origin}/`,
      email: SITE.email,
    },
    {
      '@type': 'WebPage',
      '@id': `${origin}${path}#webpage`,
      url: `${origin}${path}`,
      name: title,
      description,
      inLanguage: tagOfCode(options, code),
    },
  ];
  if (path === localeHome(code, options))
    graph.push({ '@type': 'WebSite', '@id': `${origin}/#website`, url: `${origin}/`, name: SITE.name });
  return `<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@graph': graph })}</script>`;
}

/** A title of 15 to 70 code points that is unique for each path. */
const titleOf = (path: string): string => `Example – die Seite ${path}`;

/** A description of 50 to 160 code points that is unique for each path and locale. */
const descriptionOf = (code: string, path: string): string =>
  code === 'fr'
    ? `Une page de l’exemple, à l’adresse ${path}, avec un texte court en français.`
    : `Eine Seite des Beispiels, unter der Adresse ${path}, mit einem kurzen Text auf Deutsch.`;

/**
 * One built page as Astro writes it, with the inserts of `build:done` for the settings. The defaults meet every page
 * rule of parts 5b and 5c for a page that is not `/404.html`.
 */
export function page(options: Options, path: string, parts: PageParts = {}): string {
  const code = codeOf(options, path);
  const texts = textsOf(code);
  const alternates = new Map(Object.entries(parts.alternates ?? { [code]: path }));
  const title = parts.title ?? titleOf(path);
  const description = parts.description ?? descriptionOf(code, path);
  const origin = options.site;
  const links = [...alternates]
    .map(
      ([locale, target]) => `<link rel="alternate" hreflang="${tagOfCode(options, locale)}" href="${origin}${target}">`,
    )
    .join('');
  const fallback = alternates.get(options.defaultLocale);
  const xDefault =
    fallback === undefined ? '' : `<link rel="alternate" hreflang="x-default" href="${origin}${fallback}">`;
  const tag = tagOfCode(options, code);
  const og = [
    '<meta property="og:type" content="website">',
    `<meta property="og:site_name" content="${SITE.name}">`,
    `<meta property="og:title" content="${title}">`,
    `<meta property="og:description" content="${description}">`,
    `<meta property="og:url" content="${origin}${path}">`,
    `<meta property="og:locale" content="${tag.replace('-', '_')}">`,
  ].join('');
  const css = parts.css ?? PAGE_CSS;
  const head = [
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${title}</title>`,
    `<meta name="description" content="${description}">`,
    `<link rel="canonical" href="${origin}${path}">`,
    links,
    xDefault,
    og,
    ICONS,
    parts.jsonld ?? jsonld(options, path, title, description),
    parts.head ?? '',
    cspMeta(parts.csp ?? cspContent(options, { styles: [css] })),
    inserts(options),
    `<style>${css}</style>`,
  ].join('');
  const main = parts.main ?? `<h1>${title}</h1> <p>${description}</p>`;
  const header = parts.header ?? headerOf(options, code, alternates);
  const footer = parts.footer ?? footerOf(options, code);
  return `<!DOCTYPE html><html lang="${parts.lang ?? tag}"> <head>${head}</head> <body> <a class="skip-link visually-hidden" href="#content">${texts.skip}</a> ${header} <main id="content"> ${main} </main> ${footer} </body> </html>`;
}

/** The three icon links that `head-icons` asks for. */
export const ICONS =
  '<link rel="icon" href="/favicon.ico" sizes="32x32"><link rel="icon" href="/icon.svg" type="image/svg+xml"><link rel="apple-touch-icon" href="/apple-touch-icon.png">';

/** The icon files of `public/`, as Astro copies them into dist. Their bytes do not matter to a build rule. */
export const ICON_FILES: Readonly<Record<string, string>> = {
  'favicon.ico': 'ico',
  'icon.svg': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"></svg>',
  'apple-touch-icon.png': 'png',
};

/**
 * The one 404 page: every locale on `/404.html`, with `noindex`, a link to each locale home, no canonical, no
 * alternate and no Open Graph tags (the head rules exempt it). The other locales stand in sections with `lang`.
 */
export function notFoundPage(options: Options, parts: Pick<PageParts, 'main' | 'head' | 'csp' | 'css'> = {}): string {
  const code = options.defaultLocale;
  const texts = textsOf(code);
  const title = 'Diese Seite gibt es nicht · Cette page n’existe pas';
  const description = 'Vielleicht ist die Adresse falsch geschrieben, oder wir haben die Seite verschoben.';
  const sections = options.locales
    .map((locale, index) => {
      const heading = index === 0 ? 'h1' : 'h2';
      const lang = locale.code === code ? '' : ` lang="${locale.tag}"`;
      const home = localeHome(locale.code, options);
      return `<section${lang}> <${heading}>${locale.code === 'fr' ? 'Cette page n’existe pas' : 'Diese Seite gibt es nicht'}</${heading}> <p><a href="${home}">${locale.code === 'fr' ? 'Vers la page d’accueil' : 'Zur Startseite'}</a></p> </section>`;
    })
    .join('');
  const css = parts.css ?? PAGE_CSS;
  const head = [
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${title}</title>`,
    `<meta name="description" content="${description}">`,
    '<meta name="robots" content="noindex">',
    ICONS,
    parts.head ?? '',
    cspMeta(parts.csp ?? cspContent(options, { styles: [css] })),
    inserts(options),
    `<style>${css}</style>`,
  ].join('');
  const modes = hasModeScript(options) ? ` ${modeSwitch(options, code)}` : '';
  return `<!DOCTYPE html><html lang="${tagOfCode(options, code)}"> <head>${head}</head> <body> <a class="skip-link visually-hidden" href="#content">${texts.skip}</a> <header class="site-header"> <a class="site-header__brand" href="/">Example</a>${modes} </header> <main id="content"> ${parts.main ?? sections} </main> ${footerOf(options, code)} </body> </html>`;
}

// Sites

/**
 * The smallest site of `TWO_LOCALES` that meets the rules of parts 5b and 5c: the two homes, the legal note and the
 * privacy page in both locales, each linked to its translation, and `/404.html`, with the icon files. The keys are
 * the files of the client directory.
 */
export function site(options: Options = OPTIONS): Record<string, string> {
  const pairs: [string, string][] = [
    ['/', '/fr/'],
    [legalPath(options.legal.legalNote, 'de'), legalPath(options.legal.legalNote, 'fr')],
    [legalPath(options.legal.privacy, 'de'), legalPath(options.legal.privacy, 'fr')],
  ];
  const files: Record<string, string> = { ...ICON_FILES, '404.html': notFoundPage(options) };
  for (const [de, fr] of pairs) {
    const alternates = { de, fr };
    files[fileOf(de)] = page(options, de, { alternates });
    files[fileOf(fr)] = page(options, fr, { alternates });
  }
  return files;
}

/** The dist file of a page path: `/` gives `index.html`, `/fr/` gives `fr/index.html`. */
export const fileOf = (path: string): string => (path.endsWith('/') ? `${path.slice(1)}index.html` : path.slice(1));

/** What a context is built from, next to the files. */
export interface ContextSettings {
  options?: Options;
  /** `site.json` and `schedule.json` as values, parsed with their schemas. */
  site?: unknown;
  schedule?: unknown;
  glossary?: BuildContext['facts']['glossary'];
  redirects?: RedirectRow[];
  report?: Report;
}

/** A `BuildContext` of a client directory of strings or bytes (`memoryContext`), with a new `Report`. */
export function contextOf(
  files: Readonly<Record<string, string | Uint8Array>>,
  settings: ContextSettings = {},
): BuildContext {
  const facts = factsOf(settings.site, settings.schedule);
  return memoryContext({
    root: '/site',
    dist: '/site/dist',
    options: settings.options ?? OPTIONS,
    kitVersion: '0.0.0',
    facts: { ...facts, glossary: settings.glossary ?? {} },
    redirects: settings.redirects ?? [],
    design: NO_DESIGN,
    report: settings.report ?? new Report(),
    files,
  });
}

// Results

/** The sorted ids of the failing findings of a report. */
export const ids = (report: Report): string[] => [...report.ids()].sort();

/** Each finding as `<id> <where> <detail>`, sorted. */
export const findings = (report: Report): string[] =>
  report.findings.map((finding) => `${finding.rule} ${finding.where} ${finding.detail ?? ''}`.trimEnd()).sort();

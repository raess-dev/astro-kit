/**
 * The routes of the site: which page exists in which locale, and at which path. Every link, every alternate and
 * every canonical URL comes from this table, so no other file holds a path.
 *
 * To add a page: add its key to `PageKey`, add its row to `ROUTES`, and create the route file under `src/pages/`
 * at the path of the row. The layout stops the build when the two do not match.
 */
import settings from '../../astro-kit.json';
import { DEFAULT_LOCALE, LOCALES, type Locale, SITE } from './locales.ts';

/** The pages of the site. A page has one key in every locale. */
export type PageKey = 'home' | 'legalNote' | 'privacy';

/** The path of the home page of a locale: `/` for the default locale, `/<code>/` for the others. */
const homePath = (locale: Locale): string => (locale === DEFAULT_LOCALE ? '/' : `/${locale}/`);

const homes = (): Record<Locale, string> => ({ de: homePath('de'), fr: homePath('fr'), en: homePath('en') });

/**
 * Page key → locale → path. A locale without the page has no entry (the partial locale `en` will have no jobs
 * page). The legal paths are the ones that `astro-kit.json` declares.
 */
const ROUTES: Readonly<Record<PageKey, Readonly<Partial<Record<Locale, string>>>>> = {
  home: homes(),
  legalNote: settings.legal.legalNote,
  privacy: settings.legal.privacy,
};

/** The path of a page in a locale, or `undefined` when the locale has no such page. */
export const pathOf = (page: PageKey, locale: Locale): string | undefined => ROUTES[page][locale];

/** The path of a page that must exist in the locale. Use it for links: a missing page stops the build. */
export function linkTo(page: PageKey, locale: Locale): string {
  const path = pathOf(page, locale);
  if (path === undefined) throw new Error(`src/data/routes.ts: the page ${page} has no path in the locale ${locale}`);
  return path;
}

/** The absolute URL of a path of the site. */
export const absoluteUrl = (path: string): string => `${SITE}${path}`;

export interface Alternate {
  locale: Locale;
  /** The language tag, for `hreflang`. */
  tag: string;
  path: string;
}

/** Every locale version of a page, the page itself included, in the order of the locales. */
export function alternatesOf(page: PageKey): Alternate[] {
  const alternates: Alternate[] = [];
  for (const { code, tag } of LOCALES) {
    const path = pathOf(page, code);
    if (path !== undefined) alternates.push({ locale: code, tag, path });
  }
  return alternates;
}

export interface LanguageLink {
  locale: Locale;
  tag: string;
  /** The name of the language in that language. */
  name: string;
  /** The same page in that locale, or the home page of that locale when it has no such page. */
  path: string;
  /** True when the link leads to the page that shows it. */
  current: boolean;
}

/**
 * The language links of a page: one for each locale. Without a page (the 404 page), every link leads to the home
 * page of its locale and none is the current one.
 */
export function languageLinks(page: PageKey | undefined, current: Locale): LanguageLink[] {
  return LOCALES.map(({ code, tag, name }) => ({
    locale: code,
    tag,
    name,
    path: (page === undefined ? undefined : pathOf(page, code)) ?? linkTo('home', code),
    current: page !== undefined && code === current,
  }));
}

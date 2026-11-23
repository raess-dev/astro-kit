/**
 * The texts of the parts that every page shares: the skip link, the header, the navigation, the mode switch, the
 * footer, the sitemap and the 404 page. A page's own text lives in its route file. Every locale has every key: the
 * type checks it.
 */
import type { Locale, Mode } from './locales.ts';
import type { PageKey } from './routes.ts';

export interface UiText {
  /** The skip link, the first focusable element of every page. */
  skipToContent: string;
  /** The accessible name of the navigation that holds the language links. */
  languageNav: string;
  /** The accessible name of the main navigation in the header. */
  mainNav: string;
  /**
   * The name of each page, in the navigation, the footer and the sitemap page. `en` has no jobs page, so its name
   * there is never shown.
   */
  pages: Readonly<Record<PageKey, string>>;
  /** The label of the mode switch (its `summary`). */
  modeSwitch: string;
  /** The `legend` of the mode switch. It differs from the label, so a screen reader does not say one text twice. */
  modeLegend: string;
  /** The name of each mode option. The names of one locale differ from each other. */
  modes: Readonly<Record<Mode, string>>;
  /** The accessible name of the footer navigation: the legal pages and the sitemap page. */
  footerNav: string;
  /** The two headings of the sitemap page: the pages of the hotel, and the other pages. */
  indexHotel: string;
  indexMore: string;
  /** The words before the phone number and the email address. */
  phone: string;
  email: string;
  /** The colon after a label. French sets a narrow no-break space (U+202F) before it. */
  colon: string;
  /** The heading of the opening hours in the footer. */
  reception: string;
  /** The word for a row of opening hours that holds all seven days. */
  everyDay: string;
  /** A word after the hours, such as `Uhr`. Empty when the language needs none. */
  hoursSuffix: string;
  /** The words before the date range of a closure. */
  closed: string;
  /** The 404 page: its heading, its text and the text of the link to the home page of the locale. */
  notFoundTitle: string;
  notFoundText: string;
  notFoundHome: string;
}

export const UI: Readonly<Record<Locale, UiText>> = {
  de: {
    skipToContent: 'Zum Inhalt springen',
    languageNav: 'Sprache',
    mainNav: 'Hauptnavigation',
    pages: {
      home: 'Startseite',
      rooms: 'Zimmer und Preise',
      restaurant: 'Restaurant',
      gettingHere: 'Anreise',
      contact: 'Kontakt',
      jobs: 'Jobs',
      legalNote: 'Impressum',
      privacy: 'Datenschutz',
      sitemap: 'Sitemap',
    },
    modeSwitch: 'Darstellung',
    modeLegend: 'Darstellung wählen',
    modes: { auto: 'Automatisch', light: 'Hell', dark: 'Dunkel', contrast: 'Mehr Kontrast' },
    footerNav: 'Weitere Seiten',
    indexHotel: 'Das Hotel',
    indexMore: 'Rechtliches und Übersicht',
    phone: 'Telefon',
    email: 'E-Mail',
    colon: ':',
    reception: 'Rezeption',
    everyDay: 'Täglich',
    hoursSuffix: 'Uhr',
    closed: 'Betriebsferien',
    notFoundTitle: 'Diese Seite gibt es nicht',
    notFoundText:
      'Vielleicht ist die Adresse falsch geschrieben, oder wir haben die Seite verschoben. Auf der Startseite finden Sie alles Wichtige über unser Haus.',
    notFoundHome: 'Zur Startseite',
  },
  fr: {
    skipToContent: 'Aller au contenu',
    languageNav: 'Langue',
    mainNav: 'Navigation principale',
    pages: {
      home: 'Accueil',
      rooms: 'Chambres et prix',
      restaurant: 'Restaurant',
      gettingHere: 'Accès',
      contact: 'Contact',
      jobs: 'Emplois',
      legalNote: 'Mentions légales',
      privacy: 'Protection des données',
      sitemap: 'Plan du site',
    },
    modeSwitch: 'Affichage',
    modeLegend: 'Choisir l’affichage',
    modes: { auto: 'Automatique', light: 'Clair', dark: 'Sombre', contrast: 'Contraste élevé' },
    footerNav: 'Autres pages',
    indexHotel: 'L’hôtel',
    indexMore: 'Informations légales et vue d’ensemble',
    phone: 'Téléphone',
    email: 'E-mail',
    colon: '\u202f:',
    reception: 'Réception',
    everyDay: 'Tous les jours',
    hoursSuffix: '',
    closed: 'Fermeture annuelle',
    notFoundTitle: 'Cette page n’existe pas',
    notFoundText:
      'L’adresse est peut-être mal écrite, ou nous avons déplacé la page. La page d’accueil vous présente l’essentiel sur notre maison.',
    notFoundHome: 'Vers la page d’accueil',
  },
  en: {
    skipToContent: 'Skip to content',
    languageNav: 'Language',
    mainNav: 'Main navigation',
    pages: {
      home: 'Home',
      rooms: 'Rooms and prices',
      restaurant: 'Restaurant',
      gettingHere: 'Getting here',
      contact: 'Contact',
      jobs: 'Jobs',
      legalNote: 'Legal note',
      privacy: 'Privacy',
      sitemap: 'Sitemap',
    },
    modeSwitch: 'Display',
    modeLegend: 'Choose the display',
    modes: { auto: 'Automatic', light: 'Light', dark: 'Dark', contrast: 'More contrast' },
    footerNav: 'More pages',
    indexHotel: 'The hotel',
    indexMore: 'Legal pages and overview',
    phone: 'Phone',
    email: 'Email',
    colon: ':',
    reception: 'Reception',
    everyDay: 'Daily',
    hoursSuffix: '',
    closed: 'Closed for the season break',
    notFoundTitle: 'This page does not exist',
    notFoundText:
      'The address may be misspelled, or we have moved the page. The home page tells you all that matters about our hotel.',
    notFoundHome: 'To the home page',
  },
};

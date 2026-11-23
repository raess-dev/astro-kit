/**
 * The facts of the hotel. `site.json` and `schedule.json` are the one source: a page never types an address, a
 * phone number, a price or an opening hour. It reads the value here, so the page and the facts cannot differ.
 */
import schedule from '../../schedule.json';
import site from '../../site.json';
import { type Locale, SITE, tagOf } from './locales.ts';

export { site };

/** A no-break space. A phone number and a price must not break at a line end. */
const NBSP = ' ';

/** An en dash, for a range of times. */
const EN_DASH = '–';

/**
 * A Swiss number in E.164 form as people write it: `+41 81 555 01 10`, with no-break spaces.
 * Another number is returned as it is.
 */
export function formatPhone(e164: string): string {
  const parts = /^\+41(\d{2})(\d{3})(\d{2})(\d{2})$/.exec(e164);
  if (parts === null) return e164;
  return ['+41', parts[1], parts[2], parts[3], parts[4]].join(NBSP);
}

export const telHref = (e164: string): string => `tel:${e164}`;

export const mailHref = (email: string): string => `mailto:${email}`;

/** A person or a desk of `site.json` `contacts`, by its name. */
export function contact(name: string): (typeof site.contacts)[number] {
  const found = site.contacts.find((entry) => entry.name === name);
  if (found === undefined) throw new Error(`src/data/facts.ts: site.json has no contact named ${name}`);
  return found;
}

/** The ids of the prices in `site.json`. */
export type PriceId = 'room-single' | 'room-double' | 'room-family' | 'dog' | 'parking' | 'dinner-menu';

/** One row of a price list: a name, a price of `site.json` and what the price is for. */
export interface PriceItem {
  /** The name of the item, such as the kind of room. */
  label: string;
  /** The id of the price in `site.json`. */
  price: PriceId;
  /** What the price is for, after the amount: `pro Nacht`. */
  unit: string;
  /** One sentence on what the price includes. */
  note?: string;
}

/**
 * A price of `site.json` as text in the form of the locale, for example `CHF 320.00` or `320.00 CHF`.
 * The amount in the file is in minor units (Rappen).
 */
export function price(id: PriceId, locale: Locale): string {
  const entry = site.prices.find((candidate) => candidate.id === id);
  if (entry === undefined) throw new Error(`src/data/facts.ts: site.json has no price with the id ${id}`);
  const format = new Intl.NumberFormat(tagOf(locale), { style: 'currency', currency: entry.currency });
  return format.format(entry.amount / 100);
}

/** The ending of a Swiss VAT number in each official language. `site.json` holds the German form. */
const VAT_ENDINGS: Readonly<Partial<Record<Locale, string>>> = { fr: 'TVA' };

/**
 * The VAT number of `site.json` as the locale writes it. The number is the same in every language. Only its
 * ending differs: `MWST` in German and `TVA` in French. English has no official ending, so it keeps the German one.
 */
export function vatId(locale: Locale): string {
  const ending = VAT_ENDINGS[locale];
  if (ending === undefined) return site.vatId;
  if (!site.vatId.endsWith(' MWST')) throw new Error('src/data/facts.ts: vatId of site.json must end with " MWST"');
  return `${site.vatId.slice(0, -'MWST'.length)}${ending}`;
}

type Day = 'Mo' | 'Tu' | 'We' | 'Th' | 'Fr' | 'Sa' | 'Su';

/** The days of `schedule.json`, in the order of a week, each with a date that falls on it (5 January 2026 is a Monday). */
const WEEK: readonly Day[] = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

const SCHEMA_DAYS: Readonly<Record<Day, string>> = {
  Mo: 'Monday',
  Tu: 'Tuesday',
  We: 'Wednesday',
  Th: 'Thursday',
  Fr: 'Friday',
  Sa: 'Saturday',
  Su: 'Sunday',
};

const isDay = (text: string): text is Day => WEEK.some((day) => day === text);

/** The days of one row of the opening hours, checked and in the order of a week. */
function daysOf(row: (typeof schedule.openingHours)[number]): Day[] {
  const days = row.days.filter(isDay);
  if (days.length !== row.days.length) throw new Error('src/data/facts.ts: schedule.json holds an unknown day');
  return WEEK.filter((day) => days.includes(day));
}

/** The name of a weekday in the language of a locale. */
function dayName(day: Day, locale: Locale): string {
  const date = new Date(Date.UTC(2026, 0, 5 + WEEK.indexOf(day)));
  return new Intl.DateTimeFormat(tagOf(locale), { weekday: 'long', timeZone: 'UTC' }).format(date);
}

export interface OpeningHours {
  /** The days as text: the word for "every day", one day, a range (`Montag–Freitag`) or a list. */
  days: string;
  /** The hours as text, for example `07:00–22:00`. */
  hours: string;
}

/**
 * The opening hours of `schedule.json` as text. `everyDay` is the word of the locale for a row that holds all
 * seven days.
 */
export function openingHours(locale: Locale, everyDay: string): OpeningHours[] {
  return schedule.openingHours.map((row) => {
    const days = daysOf(row);
    const first = days[0];
    const last = days.at(-1);
    if (first === undefined || last === undefined)
      throw new Error('src/data/facts.ts: a row of schedule.json has no day');
    const isRange = days.length === WEEK.indexOf(last) - WEEK.indexOf(first) + 1;
    let text = days.map((day) => dayName(day, locale)).join(', ');
    if (days.length === WEEK.length) text = everyDay;
    else if (isRange && days.length > 2) text = `${dayName(first, locale)}${EN_DASH}${dayName(last, locale)}`;
    return { days: text, hours: `${row.opens}${EN_DASH}${row.closes}` };
  });
}

/** The closures of `schedule.json` that have not ended on the day of the build, each as a date range in the locale. */
export function closures(locale: Locale): string[] {
  const today = new Date().toISOString().slice(0, 10);
  // `en` alone gives the date order of the United States. The site writes day, month, year in every language.
  const tag = locale === 'en' ? 'en-GB' : tagOf(locale);
  const format = new Intl.DateTimeFormat(tag, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  return schedule.closures
    .filter((closure) => closure.to >= today)
    .map((closure) => format.formatRange(new Date(`${closure.from}T00:00:00Z`), new Date(`${closure.to}T00:00:00Z`)));
}

/** The `@id` of the organization node. Every page uses this one id. */
const ORGANIZATION_ID = `${SITE}/#organization`;

/** The `@id` of the `WebSite` node. Only the locale homes hold the node. */
export const WEBSITE_ID = `${SITE}/#website`;

/**
 * The organization node of the JSON-LD: the hotel, with every fact of `site.json` and `schedule.json`.
 * A closure is a day range that opens and closes at 00:00.
 */
export function organizationNode(): Record<string, unknown> {
  return {
    '@type': site.type,
    '@id': ORGANIZATION_ID,
    name: site.name,
    legalName: site.legalName,
    url: `${SITE}/`,
    email: site.email,
    telephone: site.phone,
    vatID: site.vatId,
    taxID: site.uid,
    address: {
      '@type': 'PostalAddress',
      streetAddress: site.address.street,
      postalCode: site.address.postalCode,
      addressLocality: site.address.locality,
      addressRegion: site.address.region,
      addressCountry: site.address.country,
    },
    openingHoursSpecification: schedule.openingHours.map((row) => ({
      '@type': 'OpeningHoursSpecification',
      dayOfWeek: daysOf(row).map((day) => SCHEMA_DAYS[day]),
      opens: row.opens,
      closes: row.closes,
    })),
    specialOpeningHoursSpecification: schedule.closures.map((closure) => ({
      '@type': 'OpeningHoursSpecification',
      validFrom: closure.from,
      validThrough: closure.to,
      opens: '00:00',
      closes: '00:00',
    })),
  };
}

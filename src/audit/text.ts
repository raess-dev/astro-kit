/**
 * The word lists of the text rules (specification, 3.2 and the Measurement details of section 8), and the text rules
 * of the site audit: `facts-value`, `content-stale`, `content-language`, `content-copied`, `content-glossary` and
 * `content-nfc`. `./site.ts` runs them at their place in the order of section 8. `links-generic` and
 * `legal-statement` (in `./site.ts`) read their lists from here.
 *
 * Each list is a table (`Set` or `Map`), never an object looked up with page text.
 *
 * **Who reports what.**
 *
 * - `facts-value` reports each value on a page that differs from `site.json`, at the page path. `content-stale`
 *   compares the set of the values that `facts-value` finds (`factsShown`), so a wrong value reports once as a wrong
 *   value and, on a translation, once more only when the sets of the two pages differ.
 * - The text rules pair a translation with its default-locale sibling through hreflang (`alternateIn` of `./dom.ts`).
 *   A page without such a sibling is `routes-translation`'s: these rules skip it. The sibling must be a page of the
 *   default locale; an alternate that names a page of another locale is `hreflang-reciprocal`'s.
 * - `content-copied` compares descriptions across locales; the uniqueness inside one locale is `head-description`'s.
 *   A missing or empty description is `head-description`'s too: `content-copied` compares only two that are not
 *   empty.
 * - JSON-LD in the head is no page text: a wrong fact there is `head-jsonld`'s.
 * - A banned variant of the glossary is `content-glossary`'s; a decomposed character is `content-nfc`'s. The glossary
 *   rule compares NFC text, so a decomposed `ß` or `Straße` gives both ids only when both facts hold.
 *
 * **Hostile input.** The patterns of `facts-value` run with `matchAll`, except two: the email pattern and the CHF
 * pattern with the currency last start with an unbounded quantifier, and a regex engine then tries every start
 * position again (a run of 160,000 letters takes 13 s). `emailMatches` and `currencyLastMatches` find exactly the
 * matches of these two patterns in one pass; the unit tests compare them with the patterns on random texts.
 */
import type { HTMLElement, Node } from 'node-html-parser';
import { NodeType } from 'node-html-parser';
import type { BuildContext, BuiltPage } from '../context.ts';
import { snippet } from '../css/rules.ts';
import type { Locale } from '../options.ts';
import {
  alternateIn,
  attr,
  attributesOf,
  collapse,
  domOf,
  INLINE,
  linkedPages,
  linksOf,
  localeOfLang,
  normalizeSpaces,
  type PageDom,
  pageText,
  pushAll,
  sameLang,
  sameLangText,
  siteOf,
  tagOf,
  textOf,
  wordsOf,
} from './dom.ts';

// The word lists

/**
 * The generic link texts of `links-generic`, as `nameKey` of `./dom.ts` gives a name: in lower case, without the
 * characters that are not letters at both ends.
 */
export const GENERIC_LINK_TEXTS: ReadonlySet<string> = new Set([
  'here',
  'click',
  'click here',
  'more',
  'read more',
  'learn more',
  'link',
  'hier',
  'klicken',
  'hier klicken',
  'mehr',
  'weiterlesen',
  'mehr erfahren',
  'ici',
  'cliquez',
  'cliquez ici',
  'plus',
  'lire la suite',
  'en savoir plus',
  'qui',
  'clicca qui',
  'di più',
  'scopri di più',
  'leggi tutto',
]);

/** The stopwords of `content-language` for each language, compared in lower case (Measurement details). */
export const STOPWORDS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  [
    'de',
    new Set(
      'der die das und ist nicht mit für auf ein eine den dem des von zu im sich auch wir sie ihr oder wird sind bei aus nach wie noch'.split(
        ' ',
      ),
    ),
  ],
  [
    'fr',
    new Set(
      'le la les et est des un une du pour dans que qui pas sur avec nous vous au aux ce cette sont par plus ou votre notre en à'.split(
        ' ',
      ),
    ),
  ],
  [
    'it',
    new Set(
      'il lo la gli le e è di un una per con che non del della dei nel sono si da su come più anche noi vostro nostro alla al'.split(
        ' ',
      ),
    ),
  ],
  [
    'en',
    new Set(
      'the and is of to in for with on that this are you your our we it at from by as be or not have has will can an was'.split(
        ' ',
      ),
    ),
  ],
]);

/** The built-in bans of `content-glossary` for the tag `de-CH` only: each banned variant and its replacement. */
export const DE_CH_BANS: ReadonlyMap<string, string> = new Map([
  ['ß', 'ss'],
  ['„', '«'],
  ['“', '»'],
]);

/**
 * A claim of conformance of `legal-statement`: a whole word, in any letter case (Measurement details, exact). It has
 * no `g` flag, so it keeps no state: find every match with `text.matchAll(new RegExp(CONFORMANCE, 'giu'))`.
 */
export const CONFORMANCE = /(?<!\p{L})(konform|conforme|conformant|compliant)(?!\p{L})/iu;

/** The words that cancel a claim when one stands as a whole word in the `NEGATION_WINDOW` characters before it. */
export const NEGATIONS: ReadonlySet<string> = new Set(['not', 'non', 'nicht', 'pas', 'kein', 'keine']);

/** The number of characters before a claim in which a negation cancels it. */
export const NEGATION_WINDOW = 24;

/**
 * The words of `forms-fields` by language (section 8, exact): the label of a required field holds one of the
 * required words, and the label of an optional field one of the optional words. A word compares whole and in lower
 * case. A language without a row skips the word check with a warning.
 */
export const FIELD_WORDS: ReadonlyMap<string, { required: ReadonlySet<string>; optional: ReadonlySet<string> }> =
  new Map([
    [
      'de',
      { required: new Set(['pflichtfeld', 'erforderlich', 'pflicht']), optional: new Set(['optional', 'freiwillig']) },
    ],
    ['fr', { required: new Set(['obligatoire', 'requis']), optional: new Set(['facultatif', 'optionnel']) }],
    ['it', { required: new Set(['obbligatorio', 'richiesto']), optional: new Set(['facoltativo', 'opzionale']) }],
    ['en', { required: new Set(['required']), optional: new Set(['optional']) }],
    ['rm', { required: new Set(['obligatoric']), optional: new Set(['facultativ']) }],
  ]);

// Small helpers

/** The ASCII lower case of a text: a tag, an attribute name or a language subtag compares in it. */
const asciiLower = (text: string): string => text.replace(/[A-Z]+/g, (upper) => upper.toLowerCase());

/** A list for a detail: the first three items, then the number of the others. */
function listOf(items: readonly string[]): string {
  const shown = items.slice(0, 3).map(snippet).join(', ');
  return items.length > 3 ? `${shown} and ${items.length - 3} more` : shown;
}

/** A text with its percent escapes decoded, or as it is when an escape is broken. */
function percentDecoded(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

/**
 * The default-locale page of a page: the page itself in the default locale, else its hreflang alternate with the
 * default tag when that is a built page of the default locale. `undefined` otherwise.
 */
function inDefault(ctx: BuildContext, page: BuiltPage): BuiltPage | undefined {
  const code = ctx.options.defaultLocale;
  if (page.locale === code) return page;
  const sibling = alternateIn(ctx, page, code);
  return sibling !== undefined && sibling.locale === code ? sibling : undefined;
}

/**
 * The default-locale sibling of a translation: `inDefault` of a page that is not in the default locale. `/404.html`
 * belongs to the default locale, so it has none.
 */
function siblingOf(ctx: BuildContext, page: BuiltPage): BuiltPage | undefined {
  return page.locale === ctx.options.defaultLocale ? undefined : inDefault(ctx, page);
}

// The facts on a page: the patterns

/** The email pattern of Measurement details. `emailMatches` finds exactly its matches. */
export const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+/g;

/** The CHF pattern with the currency last. `currencyLastMatches` finds exactly its matches. */
export const CHF_LAST = /(\d{1,3}(?:['’ ]\d{3})+|\d+)(?:[.,](\d{2}|–|-))?\s?(?:CHF|Fr\.)/g;

/**
 * The other patterns of Measurement details, as the specification writes them. Each starts with a literal or has
 * only bounded quantifiers, so `matchAll` stays linear on any text. `d` gives the place of the amount of a CHF
 * match; it does not change what matches.
 */
const PHONE = /(?:\+|00)\d[\d ()./-]{6,20}\d/g;
const PHONE_NATIONAL = /\b0\d{2}[ ./-]?\d{3}[ ./-]?\d{2}[ ./-]?\d{2}\b/g;
const UID = /CHE-?\d{3}\.?\d{3}\.?\d{3}/g;
const IBAN = /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,3})?\b/g;
const CHF_FIRST = /(?:CHF|SFr\.|Fr\.)\s?(\d{1,3}(?:['’ ]\d{3})+|\d+)(?:[.,](\d{2}|–|-))?/dg;

/** One match of a pattern: its place in the text, and the groups that a CHF match captures. */
export interface TextMatch {
  start: number;
  end: number;
  /** The amount of a CHF match: group 1. */
  amount?: string;
  /** The decimals of a CHF match: group 2, when the match has it. */
  decimals?: string;
}

const isDigit = (code: number): boolean => code >= 0x30 && code <= 0x39;
const isAsciiLetter = (code: number): boolean => (code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a);
/** `[A-Za-z0-9-]`: a character of a domain label. */
const isLabel = (code: number): boolean => isDigit(code) || isAsciiLetter(code) || code === 0x2d;
/** `[A-Za-z0-9._%+-]`: a character of the part before `@`. */
const isLocal = (code: number): boolean =>
  isLabel(code) || code === 0x2e || code === 0x5f || code === 0x25 || code === 0x2b;

/**
 * The matches of `EMAIL` in a text, as `matchAll` gives them, in one pass. A match starts where a run of local
 * characters starts and ends at the first `@` after it; `@` is no local character, so no later start in the run can
 * match when this one does not. After `@` the pattern is deterministic: labels joined by single dots, at least two.
 */
export function emailMatches(text: string): TextMatch[] {
  const out: TextMatch[] = [];
  const length = text.length;
  let index = 0;
  while (index < length) {
    if (!isLocal(text.charCodeAt(index))) {
      index += 1;
      continue;
    }
    const start = index;
    while (index < length && isLocal(text.charCodeAt(index))) index += 1;
    if (index >= length || text.charCodeAt(index) !== 0x40) continue;
    const at = index;
    let end = at + 1;
    while (end < length && isLabel(text.charCodeAt(end))) end += 1;
    let labels = 0;
    if (end > at + 1) {
      while (end + 1 < length && text.charCodeAt(end) === 0x2e && isLabel(text.charCodeAt(end + 1))) {
        end += 1;
        while (end < length && isLabel(text.charCodeAt(end))) end += 1;
        labels += 1;
      }
    }
    if (labels === 0) {
      index = at + 1;
      continue;
    }
    out.push({ start, end });
    index = end;
  }
  return out;
}

/** `['’ ]`: a group separator of an amount. */
const isGroupSeparator = (char: string | undefined): boolean => char === "'" || char === '’' || char === ' ';
/** A character that can stand in a match of `CHF_LAST` before its currency. */
const isAmountChar = (char: string): boolean => /[0-9.,–-]/.test(char) || isGroupSeparator(char) || /\s/.test(char);

/** The currency of `CHF_LAST` that starts at an index, or `''`. */
const currencyAt = (text: string, index: number): string =>
  text.startsWith('CHF', index) ? 'CHF' : text.startsWith('Fr.', index) ? 'Fr.' : '';

/**
 * The matches of `CHF_LAST` in a text, as `matchAll` gives them, in one pass. A match ends with a currency, and the
 * text before the currency, from the start of the match, is a run of amount characters. So the rule takes each
 * currency in turn and finds, in the run before it, the first start from which the rest is `amount decimals? space?`.
 * That part is read from its end. A space is always the `\s?`, and a dash always ends the decimals. `.dd` are the
 * decimals when an amount stands before them, else `dd` is the amount. The amount is the longest run of digit groups
 * (`1'000'000`) or, without a group, the digits before the end.
 */
export function currencyLastMatches(text: string): TextMatch[] {
  const out: TextMatch[] = [];
  let previous = 0;
  for (let index = 0; index < text.length; index += 1) {
    const currency = currencyAt(text, index);
    if (currency === '') continue;
    const match = amountBefore(text, previous, index);
    if (match !== undefined) {
      out.push({ ...match, end: index + currency.length });
      previous = index + currency.length;
    }
    index += currency.length - 1;
  }
  return out;
}

/** The match of `amount decimals? space?` that ends at `currency` and starts at or after `floor`, if any. */
function amountBefore(text: string, floor: number, currency: number): Omit<TextMatch, 'end'> | undefined {
  let start = currency;
  while (start > floor && isAmountChar(text.charAt(start - 1))) start -= 1;
  const digit = (at: number): boolean => at >= start && isDigit(text.charCodeAt(at));
  /** The first start of an amount that ends at `last`: digit groups, else the digits before `end`. */
  const amountTo = (last: number): number | undefined => {
    let digits = last;
    while (digit(digits - 1)) digits -= 1;
    if (digits === last) return undefined;
    if (last - digits !== 3 || digits - 1 < start || !isGroupSeparator(text.charAt(digits - 1))) return digits;
    // Digit groups: walk back over `sep ddd` while one more group fits, then take one to three leading digits.
    let runEnd = digits - 1;
    let runStart = runEnd;
    while (digit(runStart - 1)) runStart -= 1;
    while (runEnd - runStart === 3 && isGroupSeparator(text.charAt(runStart - 1)) && digit(runStart - 2)) {
      runEnd = runStart - 1;
      runStart = runEnd;
      while (digit(runStart - 1)) runStart -= 1;
    }
    return runEnd > runStart ? runEnd - Math.min(runEnd - runStart, 3) : digits;
  };
  const found = (first: number, last: number, decimals?: string): Omit<TextMatch, 'end'> => ({
    start: first,
    amount: text.slice(first, last),
    ...(decimals === undefined ? {} : { decimals }),
  });
  // A space before the currency is always the `\s?`: no amount and no decimals end in one.
  let end = currency;
  if (end > start && /\s/.test(text.charAt(end - 1))) end -= 1;
  const final = text.charAt(end - 1);
  if (end > start && (final === '–' || final === '-')) {
    // A dash ends only the decimals.
    if (end - 2 < start || !/[.,]/.test(text.charAt(end - 2))) return undefined;
    const from = amountTo(end - 2);
    return from === undefined ? undefined : found(from, end - 2, final);
  }
  if (end - 3 >= start && digit(end - 1) && digit(end - 2) && /[.,]/.test(text.charAt(end - 3))) {
    // `.dd` are the decimals when an amount stands before them; else `dd` is the amount (`x.00 CHF`).
    const from = amountTo(end - 3);
    if (from !== undefined) return found(from, end - 3, text.slice(end - 2, end));
  }
  const from = amountTo(end);
  return from === undefined ? undefined : found(from, end);
}

// The facts on a page: the values

/** The kinds of facts, with the `site.json` fields that hold their values (for a detail). */
const FIELDS: ReadonlyMap<string, string> = new Map([
  ['email', 'email, contacts'],
  ['phone', 'phone, contacts'],
  ['UID', 'uid, vatId'],
  ['IBAN', 'iban'],
  ['CHF', 'prices'],
]);

/**
 * A `(0)` right after the country code of an international number: the trunk zero of `+41 (0)81 555 01 10`. It is
 * no digit of the number. The pattern is anchored, and each part has a bound, so it cannot backtrack.
 */
const TRUNK_ZERO = /^(\s*(?:\+|00)\d{1,3})\s*\(0\)/;

/**
 * A phone number normalized to E.164 (Measurement details): the digits; a leading `+` or `00` gives `+`; a leading
 * single `0` (a Swiss national number) gives `+41` and the digits without that `0`. Any other text gives its digits.
 * A `(0)` right after the country code is dropped first, so `+41 (0)81 555 01 10` is `+41815550110`.
 */
function phoneOf(text: string): string {
  const plain = text.replace(TRUNK_ZERO, '$1');
  const digits = plain.replace(/\D+/g, '');
  const trimmed = plain.trimStart();
  if (trimmed.startsWith('+')) return `+${digits}`;
  if (trimmed.startsWith('00')) return `+${digits.slice(2)}`;
  if (trimmed.startsWith('0')) return `+41${digits.slice(1)}`;
  return digits;
}

/** A CHE-UID as `CHE-ddd.ddd.ddd`. */
function uidOf(text: string): string {
  const digits = text.replace(/\D+/g, '');
  return `CHE-${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}`;
}

/** The key of an amount in minor units, given as digits: `CHF 320.00`. */
function priceKey(minor: string): string {
  const digits = minor.replace(/^0+/, '').padStart(3, '0');
  return `CHF ${digits.slice(0, -2)}.${digits.slice(-2)}`;
}

/** The key of a CHF match: the whole part times 100 plus the two decimals (`–` and `-` count as `00`). */
function amountKey(amount: string, decimals: string | undefined): string {
  const cents = decimals !== undefined && decimals.length === 2 ? decimals : '00';
  return priceKey(`${amount.replace(/['’ ]/g, '')}${cents}`);
}

/**
 * The keys of the facts of `site.json`, normalized as the page text is: `email info@example.ch`,
 * `phone +41815550110`, `UID CHE-123.456.789`, `IBAN CH9300762011623852957`, `CHF 320.00`.
 */
function siteKeys(ctx: BuildContext): ReadonlySet<string> {
  let keys = SITE_KEYS.get(ctx);
  if (keys !== undefined) return keys;
  const site = ctx.facts.site;
  const found = new Set<string>();
  const email = (value: string | undefined): void => {
    if (value !== undefined) found.add(`email ${normalizeSpaces(value).toLowerCase()}`);
  };
  const phone = (value: string | undefined): void => {
    if (value !== undefined) found.add(`phone ${phoneOf(normalizeSpaces(value))}`);
  };
  email(site.email);
  phone(site.phone);
  for (const contact of site.contacts) {
    email(contact.email);
    phone(contact.phone);
  }
  // `vatId` holds the UID with a suffix (`CHE-123.456.789 MWST`): the UID pattern finds it inside.
  for (const value of [site.uid, site.vatId]) {
    if (value === undefined) continue;
    for (const match of normalizeSpaces(value).matchAll(UID)) found.add(`UID ${uidOf(match[0])}`);
  }
  if (site.iban !== undefined) found.add(`IBAN ${normalizeSpaces(site.iban).replaceAll(' ', '')}`);
  for (const price of site.prices) if (price.currency === 'CHF') found.add(priceKey(String(price.amount)));
  keys = found;
  SITE_KEYS.set(ctx, keys);
  return keys;
}

const SITE_KEYS = new WeakMap<BuildContext, ReadonlySet<string>>();

/** Where a fact on a page was found first. */
type FactSource = 'text' | 'mailto' | 'tel';

/** The facts that a page shows: each key once, with the place it was found first and whether `site.json` has it. */
interface PageFacts {
  found: ReadonlyMap<string, FactSource>;
  shown: ReadonlySet<string>;
}

const PAGE_FACTS = new WeakMap<BuildContext, WeakMap<BuiltPage, PageFacts>>();

/**
 * The keys of the facts in a text, in the order of the kinds: emails, IBANs, UIDs, CHF amounts (currency first, then
 * currency last), phone numbers (international, then national). A match that overlaps the text of an earlier match
 * is no candidate: so an amount that both CHF patterns find counts once, a national number inside an international
 * one counts once, and the digits of an IBAN are no phone number.
 */
function textKeys(text: string): string[] {
  const claimed = new Uint8Array(text.length);
  const out: string[] = [];
  const claim = (start: number, end: number, key: string): void => {
    for (let index = start; index < end; index += 1) if (claimed[index] === 1) return;
    claimed.fill(1, start, end);
    out.push(key);
  };
  for (const match of emailMatches(text)) {
    claim(match.start, match.end, `email ${text.slice(match.start, match.end).toLowerCase()}`);
  }
  for (const match of text.matchAll(IBAN)) {
    claim(match.index, match.index + match[0].length, `IBAN ${match[0].replaceAll(' ', '')}`);
  }
  for (const match of text.matchAll(UID)) claim(match.index, match.index + match[0].length, `UID ${uidOf(match[0])}`);
  for (const match of text.matchAll(CHF_FIRST)) {
    claim(match.index, match.index + match[0].length, amountKey(match[1] ?? '', match[2]));
  }
  for (const match of currencyLastMatches(text)) {
    claim(match.start, match.end, amountKey(match.amount ?? '', match.decimals));
  }
  for (const pattern of [PHONE, PHONE_NATIONAL]) {
    for (const match of text.matchAll(pattern)) {
      claim(match.index, match.index + match[0].length, `phone ${phoneOf(match[0])}`);
    }
  }
  return out;
}

/**
 * The keys of the `mailto:` and `tel:` hrefs of a page. A `mailto:` gives each address before `?`, percent-decoded,
 * split at `,`, in lower case. A `tel:` gives the number before `;` or `?`, percent-decoded and normalized as a
 * phone. An empty address or a number without digits gives nothing.
 */
function hrefKeys(ctx: BuildContext, page: BuiltPage): [string, FactSource][] {
  const out: [string, FactSource][] = [];
  for (const link of linksOf(ctx, page)) {
    if (link.target.kind !== 'external') continue;
    const { scheme } = link.target;
    if (scheme !== 'mailto' && scheme !== 'tel') continue;
    const rest = link.href.slice(link.href.indexOf(':') + 1);
    if (scheme === 'mailto') {
      for (const part of percentDecoded(rest.split('?')[0] ?? '').split(',')) {
        const address = normalizeSpaces(part).toLowerCase();
        if (address !== '') out.push([`email ${address}`, 'mailto']);
      }
      continue;
    }
    const number = normalizeSpaces(percentDecoded(rest.split(/[;?]/)[0] ?? ''));
    if (/\d/.test(number)) out.push([`phone ${phoneOf(number)}`, 'tel']);
  }
  return out;
}

/** The facts of a page, found once for each context and page. */
function pageFacts(ctx: BuildContext, page: BuiltPage): PageFacts {
  let pages = PAGE_FACTS.get(ctx);
  if (pages === undefined) {
    pages = new WeakMap();
    PAGE_FACTS.set(ctx, pages);
  }
  const known = pages.get(page);
  if (known !== undefined) return known;
  const allowed = siteKeys(ctx);
  const found = new Map<string, FactSource>();
  for (const key of textKeys(normalizeSpaces(pageText(page)))) if (!found.has(key)) found.set(key, 'text');
  for (const [key, source] of hrefKeys(ctx, page)) if (!found.has(key)) found.set(key, source);
  const facts: PageFacts = { found, shown: new Set([...found.keys()].filter((key) => allowed.has(key))) };
  pages.set(page, facts);
  return facts;
}

/**
 * The `site.json` values that `facts-value` finds on a page, as a set of their normalized forms (Measurement details,
 * `content-stale`): the candidates of the page text and of the `mailto:` and `tel:` hrefs that equal a value. Cached
 * for each page. A value is written with its kind: `email info@example.ch`, `phone +41815550110`,
 * `UID CHE-123.456.789`, `IBAN CH9300762011623852957`, `CHF 320.00`.
 */
export function factsShown(ctx: BuildContext, page: BuiltPage): ReadonlySet<string> {
  return pageFacts(ctx, page).shown;
}

// The rules

/**
 * `facts-value`: every email, phone number, CHE-UID, IBAN and CHF amount on a page equals a `site.json` value. One
 * finding for each page and each distinct wrong value, at the page path. The detail names the value and the fields
 * of `site.json` that it should come from; a value that only a link holds says so (`a tel: link`).
 */
export function auditFactsValue(ctx: BuildContext): void {
  const allowed = siteKeys(ctx);
  for (const page of ctx.pages) {
    for (const [key, source] of pageFacts(ctx, page).found) {
      if (allowed.has(key)) continue;
      const kind = key.slice(0, key.indexOf(' '));
      const where = source === 'text' ? '' : ` (a ${source}: link)`;
      ctx.report.add('facts-value', page.path, `${snippet(key)}${where} is not in site.json (${FIELDS.get(kind)})`);
    }
  }
}

/**
 * The link targets of a page for `content-stale`, mapped into the default locale (Measurement details): each built
 * page that the page links becomes its default-locale page (`inDefault`). A target is kept only when the round trip
 * holds: its default-locale page has a built alternate in the locale `code` of the translation (`alternateIn`), and
 * that alternate maps back to the same default-locale page. Any other target is dropped. The test reads only the
 * key, so both pages drop the same keys, and one hreflang fault is no difference of the two pages.
 */
function mappedTargets(ctx: BuildContext, page: BuiltPage, code: string): Set<string> {
  const { pages } = siteOf(ctx);
  const out = new Set<string>();
  for (const path of linkedPages(ctx, page)) {
    const target = pages.get(path);
    if (target === undefined) continue;
    const key = inDefault(ctx, target);
    if (key === undefined) continue;
    const translated = alternateIn(ctx, key, code);
    if (translated === undefined || translated.locale !== code || inDefault(ctx, translated) !== key) continue;
    out.add(key.path);
  }
  return out;
}

/** The items of `a` that `b` does not hold, in the order of `a`. */
const without = (a: ReadonlySet<string>, b: ReadonlySet<string>): string[] => [...a].filter((item) => !b.has(item));

/**
 * `content-stale`: a translation matches its default-locale sibling in the number of `h2` elements, in the facts shown
 * and in the link targets mapped into the default locale. One finding for each translation, at its path, with every
 * difference in the detail: `missing` names what the sibling has and the translation lacks, `extra` the reverse.
 */
export function auditContentStale(ctx: BuildContext): void {
  for (const page of ctx.pages) {
    const sibling = siblingOf(ctx, page);
    if (sibling === undefined) continue;
    const problems: string[] = [];
    const h2 = domOf(page).byTag('h2').length;
    const expected = domOf(sibling).byTag('h2').length;
    if (h2 !== expected) problems.push(`${h2} h2, ${sibling.path} has ${expected}`);
    const compare = (name: string, own: ReadonlySet<string>, theirs: ReadonlySet<string>): void => {
      const missing = without(theirs, own);
      const extra = without(own, theirs);
      if (missing.length > 0) problems.push(`${name} missing: ${listOf(missing)}`);
      if (extra.length > 0) problems.push(`${name} extra: ${listOf(extra)}`);
    };
    compare('facts', factsShown(ctx, page), factsShown(ctx, sibling));
    compare('links', mappedTargets(ctx, page, page.locale), mappedTargets(ctx, sibling, page.locale));
    if (problems.length > 0) ctx.report.add('content-stale', page.path, problems.join('; '));
  }
}

/** The tags of the leaves of `content-language`. */
const LEAF_TAGS: ReadonlySet<string> = new Set(['p', 'li', 'td', 'blockquote']);

/**
 * The leaves of a page (Measurement details): each `p`, `li`, `td` or `blockquote` with none of these inside it. One
 * pass in reverse document order marks each element that holds one, so the test is linear in the page.
 */
function leavesOf(dom: PageDom): HTMLElement[] {
  const holders = new Set<HTMLElement>();
  const out: HTMLElement[] = [];
  for (let index = dom.elements.length - 1; index >= 0; index -= 1) {
    const element = dom.elements[index];
    if (element === undefined) continue;
    const leafTag = LEAF_TAGS.has(tagOf(element));
    if (leafTag && !holders.has(element)) out.push(element);
    if ((leafTag || holders.has(element)) && element.parentNode !== null) holders.add(element.parentNode);
  }
  return out.reverse();
}

/**
 * `content-language`: a leaf whose nearest `lang` is the page's `html lang` is not written in another language. The
 * page language is the primary subtag of `html lang` in lower case (`de-CH` gives `de`); a page without a list for it
 * is skipped. The text is the leaf's text without the subtrees under another `lang`, in NFC; the words are counted in
 * lower case, each occurrence once. One finding for each leaf, at the page path; two leaves with the same text and
 * counts give one.
 */
export function auditContentLanguage(ctx: BuildContext): void {
  for (const page of ctx.pages) {
    const dom = domOf(page);
    const lang = dom.html === undefined ? undefined : attr(dom.html, 'lang');
    if (lang === undefined) continue;
    const primary = asciiLower(lang.split('-')[0] ?? '');
    if (!STOPWORDS.has(primary)) continue;
    const seen = new Set<string>();
    for (const leaf of leavesOf(dom)) {
      if (!sameLang(dom.lang(leaf), lang)) continue;
      const text = sameLangText(dom, leaf).normalize('NFC');
      const words = wordsOf(text).map((word) => word.toLowerCase());
      if (words.length < 12) continue;
      const counts = new Map<string, number>();
      for (const [code, list] of STOPWORDS) counts.set(code, words.filter((word) => list.has(word)).length);
      const own = counts.get(primary) ?? 0;
      let worst: [string, number] | undefined;
      for (const [code, count] of counts) {
        if (code === primary || count < 3 || count <= 2 * own) continue;
        if (worst === undefined || count > worst[1]) worst = [code, count];
      }
      if (worst === undefined) continue;
      const detail = `${worst[1]} ${worst[0]} stopwords and ${own} ${primary}: "${snippet(text)}"`;
      if (seen.has(detail)) continue;
      seen.add(detail);
      ctx.report.add('content-language', page.path, detail);
    }
  }
}

/** The collapsed `content` of the first `meta[name=description]` of a page, or `undefined`. */
function descriptionOf(dom: PageDom): { element: HTMLElement; text: string } | undefined {
  const element = dom.byTag('meta').find((meta) => asciiLower(attr(meta, 'name') ?? '') === 'description');
  return element === undefined ? undefined : { element, text: collapse(attr(element, 'content') ?? '') };
}

/**
 * `content-copied`: a translation's meta description differs from its default-locale sibling's. The two are compared
 * collapsed, character for character; an empty or missing one is `head-description`'s. One finding at the translation.
 */
export function auditContentCopied(ctx: BuildContext): void {
  for (const page of ctx.pages) {
    const sibling = siblingOf(ctx, page);
    if (sibling === undefined) continue;
    const own = descriptionOf(domOf(page))?.text ?? '';
    const theirs = descriptionOf(domOf(sibling))?.text ?? '';
    if (own === '' || own !== theirs) continue;
    ctx.report.add('content-copied', page.path, `the description of ${sibling.path}: "${snippet(own)}"`);
  }
}

/** One banned variant of a locale, with its replacement and the list that bans it. */
interface Ban {
  replacement: string;
  list: string;
}

/**
 * The elements whose text `content-glossary` skips: it is no text of the page. Template content is no part of the
 * document (`PageDom`).
 */
const NO_TEXT: ReadonlySet<string> = new Set(['script', 'style', 'template']);

/** One text of `content-glossary`: collapsed and in NFC, with its nearest `lang` and its place. */
interface GlossaryText {
  text: string;
  lang: string | undefined;
  place: string;
}

/**
 * The body texts of a page for `content-glossary`, in one pass without recursion: each run of text nodes of one block
 * and one nearest `lang`, joined. A block is the nearest element that is not `INLINE`. Entering any element that is
 * not `INLINE` ends the run. `seen` gets every element of the body.
 */
function bodyTexts(dom: PageDom, seen: Set<HTMLElement>): GlossaryText[] {
  const body = dom.body;
  if (body === undefined) return [];
  const out: GlossaryText[] = [];
  const blocks = new Map<HTMLElement, HTMLElement>([[body, body]]);
  seen.add(body);
  let current: { block: HTMLElement; lang: string | undefined; parts: string[] } | undefined;
  const flush = (): void => {
    if (current !== undefined) out.push({ text: current.parts.join(''), lang: current.lang, place: 'the text' });
    current = undefined;
  };
  const stack: Node[] = [...body.childNodes].reverse();
  for (let node = stack.pop(); node !== undefined; node = stack.pop()) {
    const parent = node.parentNode;
    if (parent === null) continue;
    if (node.nodeType === NodeType.TEXT_NODE) {
      const block = blocks.get(parent) ?? parent;
      const lang = dom.lang(parent);
      if (current === undefined || current.block !== block || current.lang !== lang) {
        flush();
        current = { block, lang, parts: [] };
      }
      current.parts.push(node.text);
      continue;
    }
    if (node.nodeType !== NodeType.ELEMENT_NODE) continue;
    const element = node as HTMLElement;
    seen.add(element);
    const tag = tagOf(element);
    if (NO_TEXT.has(tag)) {
      flush();
      continue;
    }
    if (INLINE.has(tag)) blocks.set(element, blocks.get(parent) ?? parent);
    else {
      flush();
      blocks.set(element, element);
    }
    for (let index = element.childNodes.length - 1; index >= 0; index -= 1) {
      const child = element.childNodes[index];
      if (child !== undefined) stack.push(child);
    }
  }
  flush();
  return out;
}

/** The banned variants of each locale code: the glossary's, and for the tag `de-CH` the built-in ones too. */
function bansOf(ctx: BuildContext): ReadonlyMap<string, ReadonlyMap<string, Ban>> {
  let bans = BANS.get(ctx);
  if (bans !== undefined) return bans;
  const glossary = new Map(Object.entries(ctx.facts.glossary));
  const found = new Map<string, ReadonlyMap<string, Ban>>();
  for (const locale of ctx.options.locales) {
    const list = new Map<string, Ban>();
    for (const [variant, replacement] of Object.entries(glossary.get(locale.code)?.banned ?? {})) {
      const key = variant.normalize('NFC');
      if (key !== '' && !list.has(key)) list.set(key, { replacement, list: `glossary.json ${locale.code}` });
    }
    if (sameLang(locale.tag, 'de-CH')) {
      for (const [variant, replacement] of DE_CH_BANS) {
        if (!list.has(variant)) list.set(variant, { replacement, list: 'de-CH' });
      }
    }
    found.set(locale.code, list);
  }
  bans = found;
  BANS.set(ctx, bans);
  return bans;
}

const BANS = new WeakMap<BuildContext, ReadonlyMap<string, ReadonlyMap<string, Ban>>>();

/**
 * `content-glossary`: the title, the description and the body text hold no banned variant of the locale of their
 * nearest `lang`. The title and the description take the nearest `lang` of their element (in a page, the one of
 * `html`). A banned variant is found as a case-sensitive substring of the NFC text, with each run of white space as
 * one space. Body text is joined across inline elements (`INLINE`), so `Hotel <b>Laerchenwald</b>` is one text; text
 * in `script` and `style` is skipped. One finding for each page and each banned variant, at the page path.
 */
export function auditContentGlossary(ctx: BuildContext): void {
  const bans = bansOf(ctx);
  const locales = new Map<string, Locale | undefined>();
  const localeFor = (lang: string): Locale | undefined => {
    if (!locales.has(lang)) locales.set(lang, localeOfLang(ctx.options, lang));
    return locales.get(lang);
  };
  for (const page of ctx.pages) {
    const dom = domOf(page);
    const inBody = new Set<HTMLElement>();
    const body = bodyTexts(dom, inBody);
    const texts: GlossaryText[] = [];
    for (const title of dom.byTag('title')) {
      if (!inBody.has(title)) texts.push({ text: textOf(title), lang: dom.lang(title), place: 'the title' });
    }
    const description = descriptionOf(dom);
    if (description !== undefined) {
      texts.push({ text: description.text, lang: dom.lang(description.element), place: 'the description' });
    }
    pushAll(texts, body);
    const reported = new Set<string>();
    for (const { text, lang, place } of texts) {
      const locale = lang === undefined ? undefined : localeFor(lang);
      const list = locale === undefined ? undefined : bans.get(locale.code);
      if (list === undefined || list.size === 0) continue;
      const normalized = collapse(text).normalize('NFC');
      for (const [variant, ban] of list) {
        if (reported.has(variant) || !normalized.includes(variant)) continue;
        reported.add(variant);
        ctx.report.add(
          'content-glossary',
          page.path,
          `"${snippet(variant)}" in ${place} (${ban.list}: write "${snippet(ban.replacement)}")`,
        );
      }
    }
  }
}

/** The code points at the first place where a text differs from its NFC form, as `U+0065 U+0301`. */
function decomposedAt(text: string, normalized: string): string {
  let index = 0;
  while (index < text.length && text.charCodeAt(index) === normalized.charCodeAt(index)) index += 1;
  // Start at the code point that holds the index, then show it and the marks that follow it.
  if (index > 0 && /[\udc00-\udfff]/.test(text.charAt(index)) && /[\ud800-\udbff]/.test(text.charAt(index - 1))) {
    index -= 1;
  }
  const points = Array.from(text.slice(index, index + 8));
  const shown = [points[0] ?? ''];
  for (const point of points.slice(1)) {
    if (!/\p{M}/u.test(point) || shown.length >= 4) break;
    shown.push(point);
  }
  return shown.map((point) => `U+${(point.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0')}`).join(' ');
}

/**
 * `content-nfc`: every text node (in `head` and `body`, `script` and `style` included) and every attribute value of
 * every element equals its NFC form. One finding for each page and each distinct text, at the page path; the detail
 * names the place, the text and the code points where it is not NFC.
 */
export function auditContentNfc(ctx: BuildContext): void {
  for (const page of ctx.pages) {
    const dom = domOf(page);
    const reported = new Set<string>();
    const check = (text: string, place: string): void => {
      if (reported.has(text)) return;
      const normalized = text.normalize('NFC');
      if (normalized === text) return;
      reported.add(text);
      ctx.report.add(
        'content-nfc',
        page.path,
        `${place} "${snippet(text)}": ${decomposedAt(text, normalized)} is not in NFC`,
      );
    };
    for (const run of dom.texts) check(run.text, 'the text');
    for (const element of dom.elements) {
      for (const [name, value] of attributesOf(element)) check(value, `the attribute ${snippet(name)}`);
    }
  }
}

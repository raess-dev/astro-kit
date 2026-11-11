import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'astro/zod';
import type { KitOptions } from './options.ts';
import type { Report } from './registry.ts';

export const SITE_FILE = 'src/content/site.json';
export const SCHEDULE_FILE = 'src/content/schedule.json';
export const MESSAGES_DIR = 'src/content/messages';

const minor = z.number().int().nonnegative();

/** The owner's facts. Protected by the push ruleset; agents never edit it. */
const email = z.string().regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/);
const phone = z.string().regex(/^\+[1-9]\d{6,14}$/);

export const siteSchema = z
  .object({
    /** schema.org type: Organization, or one LocalBusiness subtype such as ProfessionalService. */
    type: z
      .string()
      .regex(/^[A-Z][A-Za-z]+$/)
      .default('Organization'),
    name: z.string().min(1),
    legalName: z.string().min(1),
    email,
    phone: phone.optional(),
    address: z
      .object({
        street: z.string(),
        postalCode: z.string(),
        locality: z.string(),
        region: z.string().optional(),
        country: z.string().regex(/^[A-Z]{2}$/),
      })
      .optional(),
    uid: z
      .string()
      .regex(/^CHE-\d{3}\.\d{3}\.\d{3}$/)
      .optional(),
    vatId: z.string().optional(),
    iban: z
      .string()
      .regex(/^[A-Z]{2}\d{2}[A-Z0-9 ]{10,30}$/)
      .optional(),
    /** Prices as integer minor units, rendered with formatMoney(). */
    prices: z
      .array(z.object({ id: z.string(), amount: minor, currency: z.string().length(3).default('CHF') }))
      .default([]),
    sameAs: z.array(z.string().url()).default([]),
    /** PDFs in public/ and the page id with the same content, e.g. { "brochure.pdf": "services" } (media-pdf). */
    documents: z.record(z.string(), z.string()).default({}),
    /** Needed before an accessibility statement may claim conformance. */
    accessibilityAudit: z.object({ date: z.string(), by: z.string(), scope: z.string() }).optional(),
    /** More addresses and numbers the pages may show, such as jobs@ or a restaurant line. */
    contacts: z
      .array(
        z
          .object({ name: z.string().min(1), email: email.optional(), phone: phone.optional() })
          .strict()
          .refine((c) => c.email !== undefined || c.phone !== undefined, 'a contact needs an email or a phone'),
      )
      .default([]),
  })
  .strict();

export type SiteFacts = z.output<typeof siteSchema>;

const day = z.enum(['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']);
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

/** Opening hours and closures only (agents may edit it). */
export const scheduleSchema = z
  .object({
    openingHours: z.array(z.object({ days: z.array(day).min(1), opens: time, closes: time })).default([]),
    closures: z
      .array(
        z.object({
          from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          note: z.string().max(80).optional(),
        }),
      )
      .default([]),
  })
  .strict();

export type Schedule = z.output<typeof scheduleSchema>;

function readJson(file: string): unknown {
  return JSON.parse(readFileSync(file, 'utf8'));
}

export function loadSite(root: string, report: Report): SiteFacts | undefined {
  const file = join(root, SITE_FILE);
  if (!existsSync(file)) {
    report.add('config-options', SITE_FILE, 'file not found; the owner provides the facts');
    return undefined;
  }
  const parsed = siteSchema.safeParse(readJson(file));
  if (!parsed.success) {
    for (const issue of parsed.error.issues)
      report.add('config-options', SITE_FILE, `${issue.path.join('.')}: ${issue.message}`);
    return undefined;
  }
  return parsed.data;
}

export function loadSchedule(root: string, report: Report): Schedule {
  const file = join(root, SCHEDULE_FILE);
  if (!existsSync(file)) return { openingHours: [], closures: [] };
  const parsed = scheduleSchema.safeParse(readJson(file));
  if (!parsed.success) {
    for (const issue of parsed.error.issues)
      report.add('facts-schedule', SCHEDULE_FILE, `${issue.path.join('.')}: ${issue.message}`);
    return { openingHours: [], closures: [] };
  }
  return parsed.data;
}

/** Kit UI strings. Projects override or extend them in src/content/messages/<locale>.json. */
export const KIT_MESSAGES: Record<string, Record<string, string>> = {
  de: {
    skip: 'Zum Inhalt springen',
    menu: 'Menü',
    nav: 'Hauptnavigation',
    languages: 'Sprache',
    required: 'Pflichtfeld',
    optional: 'optional',
    sentTitle: 'Nachricht gesendet',
    sentBody: 'Danke. Wir antworten so bald wie möglich.',
    notSentTitle: 'Nachricht nicht gesendet',
    notSentBody: 'Bitte versuchen Sie es später erneut oder schreiben Sie uns direkt:',
    contact: 'Kontakt',
    imprint: 'Impressum',
    privacy: 'Datenschutz',
    sitemap: 'Sitemap',
    name: 'Name',
    email: 'E-Mail',
    message: 'Nachricht',
    send: 'Senden',
    notFound: 'Seite nicht gefunden',
    home: 'Zur Startseite',
  },
  fr: {
    skip: 'Aller au contenu',
    menu: 'Menu',
    nav: 'Navigation principale',
    languages: 'Langue',
    required: 'obligatoire',
    optional: 'facultatif',
    sentTitle: 'Message envoyé',
    sentBody: 'Merci. Nous vous répondons dès que possible.',
    notSentTitle: 'Message non envoyé',
    notSentBody: 'Veuillez réessayer plus tard ou nous écrire directement :',
    contact: 'Contact',
    imprint: 'Mentions légales',
    privacy: 'Protection des données',
    sitemap: 'Plan du site',
    name: 'Nom',
    email: 'E-mail',
    message: 'Message',
    send: 'Envoyer',
    notFound: 'Page introuvable',
    home: 'Vers l’accueil',
  },
  it: {
    skip: 'Vai al contenuto',
    menu: 'Menu',
    nav: 'Navigazione principale',
    languages: 'Lingua',
    required: 'obbligatorio',
    optional: 'facoltativo',
    sentTitle: 'Messaggio inviato',
    sentBody: 'Grazie. Risponderemo al più presto.',
    notSentTitle: 'Messaggio non inviato',
    notSentBody: 'Riprova più tardi o scrivici direttamente:',
    contact: 'Contatto',
    imprint: 'Note legali',
    privacy: 'Protezione dei dati',
    sitemap: 'Mappa del sito',
    name: 'Nome',
    email: 'E-mail',
    message: 'Messaggio',
    send: 'Invia',
    notFound: 'Pagina non trovata',
    home: 'Alla pagina iniziale',
  },
  en: {
    skip: 'Skip to content',
    menu: 'Menu',
    nav: 'Main navigation',
    languages: 'Language',
    required: 'required',
    optional: 'optional',
    sentTitle: 'Message sent',
    sentBody: 'Thank you. We will reply as soon as we can.',
    notSentTitle: 'Message not sent',
    notSentBody: 'Please try again later or write to us directly:',
    contact: 'Contact',
    imprint: 'Imprint',
    privacy: 'Privacy',
    sitemap: 'Sitemap',
    name: 'Name',
    email: 'Email',
    message: 'Message',
    send: 'Send',
    notFound: 'Page not found',
    home: 'Go to the home page',
  },
};

export function loadMessages(
  root: string,
  options: KitOptions,
  report: Report,
): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  const projectKeys: Record<string, string[]> = {};
  for (const { code } of options.locales) {
    const base = KIT_MESSAGES[code] ?? KIT_MESSAGES.en ?? {};
    const file = join(root, MESSAGES_DIR, `${code}.json`);
    let project: Record<string, string> = {};
    if (existsSync(file)) {
      const raw = readJson(file);
      if (raw && typeof raw === 'object') project = raw as Record<string, string>;
      for (const [key, value] of Object.entries(project)) {
        if (typeof value === 'string' && value !== value.normalize('NFC')) {
          report.add('content-messages', `${MESSAGES_DIR}/${code}.json`, `${key} is not NFC-normalised`);
        }
      }
    }
    projectKeys[code] = Object.keys(project).sort();
    out[code] = { ...base, ...project };
    // The kit has UI text in de, fr, it and en only; another language brings every key itself.
    if (!KIT_MESSAGES[code]) {
      const absent = Object.keys(KIT_MESSAGES.en ?? {}).filter((k) => !(k in project));
      if (absent.length)
        report.add(
          'content-messages',
          `${MESSAGES_DIR}/${code}.json`,
          `the kit has no ${code} UI text; add [${absent.join(', ')}]`,
        );
    }
  }
  // Parity covers the project's own keys; a kit key may be reworded in one locale only.
  const own = (keys: string[] = []) => keys.filter((k) => !(k in (KIT_MESSAGES.en ?? {})));
  const codes = Object.keys(projectKeys);
  const reference = own(projectKeys[options.defaultLocale]);
  for (const code of codes) {
    const keys = own(projectKeys[code]);
    const missing = reference.filter((k) => !keys.includes(k));
    const extra = keys.filter((k) => !reference.includes(k));
    if (missing.length || extra.length) {
      report.add(
        'content-messages',
        `${MESSAGES_DIR}/${code}.json`,
        `missing [${missing.join(', ')}] extra [${extra.join(', ')}]`,
      );
    }
  }
  return out;
}

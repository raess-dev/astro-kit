/**
 * The facts of a site: the schemas and loaders of `site.json`, `schedule.json` and `glossary.json`
 * (specification, 5.6). The `site.json` half of `config-options` and the rule `facts-schedule` live here.
 */
import { z } from 'astro/zod';
import { EMAIL, isRealDate, readJson, reportHiddenKeys, reportIssues } from './options.ts';
import type { Report } from './registry.ts';
import { PAGE_PATH } from './routes.ts';

export const SITE_FILE = 'site.json';
export const SCHEDULE_FILE = 'schedule.json';
export const GLOSSARY_FILE = 'glossary.json';

// site.json

const email = z.string().regex(EMAIL);

/** A phone number in E.164: `+`, then 7 to 15 digits. */
const phone = z.string().regex(/^\+[1-9]\d{6,14}$/);

/** Says whether the text is an absolute web address. */
function isWebUrl(text: string): boolean {
  return /^https?:\/\/\S+$/.test(text) && URL.canParse(text);
}

/** Says whether the text is the path of a PDF file in `dist/`, without a leading slash: `leitfaden.pdf`. */
function isPdfPath(text: string): boolean {
  if (!/\.pdf$/i.test(text) || text.includes('\\')) return false;
  return text.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}

const addressSchema = z.strictObject({
  street: z.string(),
  postalCode: z.string(),
  locality: z.string(),
  region: z.string().optional(),
  country: z.string().regex(/^[A-Z]{2}$/),
});

const priceSchema = z.strictObject({
  id: z.string(),
  /** Integer minor units: 18000 is CHF 180.00. */
  amount: z.number().int().min(0),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .default('CHF'),
});

const auditSchema = z.strictObject({
  date: z.string(),
  by: z.string(),
  scope: z.string(),
});

const contactSchema = z
  .strictObject({
    name: z.string(),
    email: email.optional(),
    phone: phone.optional(),
  })
  .superRefine((contact, ctx) => {
    if (contact.email !== undefined || contact.phone !== undefined) return;
    ctx.addIssue({ code: 'custom', message: 'a contact needs an email or a phone', path: [] });
  });

/** The strict schema of `site.json`: the facts that the owner provides. */
export const siteSchema = z.strictObject({
  /** The schema.org type: `Organization`, or `LocalBusiness` or one of its subtypes. */
  type: z
    .string()
    .regex(/^[A-Z][A-Za-z]+$/)
    .default('Organization'),
  name: z.string().min(1),
  legalName: z.string().min(1),
  email,
  phone: phone.optional(),
  address: addressSchema.optional(),
  uid: z
    .string()
    .regex(/^CHE-\d{3}\.\d{3}\.\d{3}$/)
    .optional(),
  vatId: z.string().optional(),
  iban: z
    .string()
    .regex(/^[A-Z]{2}\d{2}[A-Z0-9 ]{10,30}$/)
    .optional(),
  prices: z.array(priceSchema).default(() => []),
  sameAs: z
    .array(z.string().refine(isWebUrl, { error: 'a sameAs entry must be a URL that starts with https:// or http://' }))
    .default(() => []),
  /** Each PDF in `dist/` and the page with the same content (`media-pdf`). */
  documents: z
    .record(
      z.string().refine(isPdfPath, { error: 'a key must be the path of a PDF in dist, for example leitfaden.pdf' }),
      z.string().regex(PAGE_PATH),
    )
    .default(() => ({})),
  /** Needed before an accessibility page may claim conformance (`legal-statement`). */
  accessibilityAudit: auditSchema.optional(),
  /** More addresses and numbers that pages may show (`facts-value`). */
  contacts: z.array(contactSchema).default(() => []),
});

/** The facts of a site, with every default filled in. */
export type SiteFacts = z.output<typeof siteSchema>;
export type Address = NonNullable<SiteFacts['address']>;
export type Price = SiteFacts['prices'][number];
export type Contact = SiteFacts['contacts'][number];
export type AccessibilityAudit = NonNullable<SiteFacts['accessibilityAudit']>;

// schedule.json

/** The days of a week, as `schedule.json` names them. */
export const DAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'] as const;

export type Day = (typeof DAYS)[number];

/** A time of day, `HH:MM`. */
export const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

const time = z.string().regex(TIME);

const date = z.string().refine(isRealDate, { error: 'a date must be a real date YYYY-MM-DD' });

const openingHoursSchema = z.strictObject({
  days: z.array(z.enum(DAYS)).min(1),
  opens: time,
  closes: time,
});

const closureSchema = z.strictObject({
  from: date,
  to: date,
  note: z.string().max(80).optional(),
});

/** The strict schema of `schedule.json`: opening hours and closures. */
export const scheduleSchema = z.strictObject({
  openingHours: z.array(openingHoursSchema),
  closures: z.array(closureSchema),
});

export type Schedule = z.output<typeof scheduleSchema>;
export type OpeningHours = Schedule['openingHours'][number];
export type Closure = Schedule['closures'][number];

// glossary.json

const glossaryLocaleSchema = z.strictObject({
  /** Each banned variant, with the canonical term that replaces it. */
  banned: z.record(z.string().min(1, { error: 'a banned variant must not be empty' }), z.string()),
});

/** The strict schema of `glossary.json`: the banned variants of each locale, by locale code. */
export const glossarySchema = z.record(
  z.string().regex(/^[a-z]{2,3}$/, { error: 'a key must be a locale code' }),
  glossaryLocaleSchema,
);

export type Glossary = z.output<typeof glossarySchema>;
export type GlossaryLocale = Glossary[string];

// Findings

/** One file of the facts: its name, its rule, its schema and the records that it holds (see `hiddenKeys`). */
interface FactsFile<Schema extends z.ZodType> {
  file: string;
  rule: string;
  schema: Schema;
  records: readonly (readonly string[])[];
}

const SITE = { file: SITE_FILE, rule: 'config-options', schema: siteSchema, records: [['documents']] } as const;

const SCHEDULE = { file: SCHEDULE_FILE, rule: 'facts-schedule', schema: scheduleSchema, records: [] } as const;

/** The specification names no rule of its own for the glossary: the row `config-options` covers it. */
const GLOSSARY = {
  file: GLOSSARY_FILE,
  rule: 'config-options',
  schema: glossarySchema,
  records: [[], ['*', 'banned']],
} as const;

/** Validates a parsed value. Each issue is one finding of the rule, at `<file>` or `<file>: <field path>`. */
function parse<Schema extends z.ZodType>(
  facts: FactsFile<Schema>,
  value: unknown,
  report: Report,
): z.output<Schema> | undefined {
  const hidden = reportHiddenKeys(report, facts.rule, facts.file, value, facts.records);
  const parsed = facts.schema.safeParse(value);
  if (!parsed.success) reportIssues(report, facts.rule, facts.file, parsed.error.issues);
  return parsed.success && !hidden ? parsed.data : undefined;
}

/**
 * Reads and validates one JSON file of the project. A text that is not JSON is a finding. A missing file is a
 * finding too, unless `whenMissing` gives the value that stands for it.
 */
function load<Schema extends z.ZodType>(
  facts: FactsFile<Schema>,
  root: string,
  report: Report,
  whenMissing?: () => z.output<Schema>,
): z.output<Schema> | undefined {
  const read = readJson(root, facts.file);
  if (read.state === 'missing') {
    if (whenMissing) return whenMissing();
    report.add(facts.rule, facts.file, 'the file is missing');
    return undefined;
  }
  if (read.state === 'invalid') {
    report.add(facts.rule, facts.file, `the file is not valid JSON: ${read.message}`);
    return undefined;
  }
  return parse(facts, read.value, report);
}

/** Validates a parsed `site.json` value (`config-options`). Returns the facts, or `undefined` when not valid. */
export function parseSite(value: unknown, report: Report): SiteFacts | undefined {
  return parse(SITE, value, report);
}

/** Validates a parsed `schedule.json` value (`facts-schedule`). */
export function parseSchedule(value: unknown, report: Report): Schedule | undefined {
  return parse(SCHEDULE, value, report);
}

/** Validates a parsed `glossary.json` value (`config-options`). */
export function parseGlossary(value: unknown, report: Report): Glossary | undefined {
  return parse(GLOSSARY, value, report);
}

/** Reads and validates `<root>/site.json` (`config-options`). A missing file is a finding. */
export function loadSite(root: string, report: Report): SiteFacts | undefined {
  return load(SITE, root, report);
}

/** `facts-schedule`: `<root>/schedule.json` exists and matches its strict schema. */
export function loadSchedule(root: string, report: Report): Schedule | undefined {
  return load(SCHEDULE, root, report);
}

/** Reads and validates `<root>/glossary.json` (`config-options`). A missing file is an empty glossary. */
export function loadGlossary(root: string, report: Report): Glossary | undefined {
  return load(GLOSSARY, root, report, () => ({}));
}

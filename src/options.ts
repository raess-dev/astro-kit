/**
 * The settings of a site: the schema of `astro-kit.json`, the limits, and the loader (specification, section 5).
 * The rules `config-options` (the settings half), `config-waiver` and `legal-processing` live here.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'astro/zod';
import { isWaivable, type Report } from './registry.ts';
import { PAGE_PATH, pathSegments, RESERVED_SEGMENTS } from './routes.ts';

export const OPTIONS_FILE = 'astro-kit.json';

/** The limits of section 8. A site may only lower `headBytes`, `documentBytes` and `domElements`. */
export const LIMITS = {
  headBytes: 14_336,
  cspBytes: 4_096,
  documentBytes: 30_720,
  domElements: 1_400,
  domDepth: 32,
  fontBytes: 102_400,
  islandJsBytes: 20_480,
  lazyJsBytes: 204_800,
  prefetchJsBytes: 2_048,
  ogImageBytes: 153_600,
  titleMin: 15,
  titleMax: 70,
  descriptionMin: 50,
  descriptionMax: 160,
  imageMaxPx: 2_560,
  imageMaxBytes: 3_145_728,
  clickDepth: 3,
} as const;

export type Limits = { readonly [Name in keyof typeof LIMITS]: number };

/** The exact messages of the cross-field refinements of 5.2. The settings page shows the same texts (5.5). */
export const MESSAGES = {
  defaultLocale: 'defaultLocale must be one of locales[].code',
  formsContact: 'features.forms needs contact.to and contact.from',
  modesNone: 'modes needs at least one option set to true',
  modesContrast:
    'modes.contrast needs auto, light or dark too: design.md needs a base theme, and contrast alone never shows it',
  modesDefaultAuto: 'modes.default is only for modes.auto false; with auto on, auto is the default mode',
  modesDefault: 'modes.default must name an option of modes that is true',
  wasmWorkers: 'features.wasm and features.workers need features.islands or features.scripts',
  originAllow: 'origins[].allow needs the frame directive',
  originGesture:
    'a gesture origin needs features.scripts or features.islands: a script adds the frame, the script or the request after the click',
} as const;

/** The pattern of every mail address in the settings and in `site.json`. */
export const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Says whether the text is a date `YYYY-MM-DD` that exists in the calendar. */
export function isRealDate(text: string): boolean {
  if (!DATE.test(text)) return false;
  const date = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === text;
}

/** The part of a zod refinement context that the checks below use. */
interface Issues {
  addIssue(issue: { code: 'custom'; message: string; path: PropertyKey[] }): void;
}

const add = (ctx: Issues, path: PropertyKey[], message: string): void =>
  ctx.addIssue({ code: 'custom', message, path });

/** Reports each value that an earlier item of the list already holds. */
function uniqueValues(values: readonly string[], ctx: Issues, key?: string): void {
  values.forEach((value, index) => {
    if (values.indexOf(value) === index) return;
    add(ctx, key === undefined ? [index] : [index, key], `duplicate ${key ?? 'value'} "${value}"`);
  });
}

const email = z.string().regex(EMAIL);

// Locales

const localeSchema = z.strictObject({
  code: z
    .string()
    .regex(/^[a-z]{2,3}$/)
    .refine((code) => !RESERVED_SEGMENTS.includes(code), { error: 'a locale code must not be a reserved segment' }),
  tag: z.string().regex(/^[a-z]{2,3}(-[A-Z]{2})?$/),
  name: z.string().min(2),
  coverage: z.enum(['full', 'partial']).default('full'),
});

const localesSchema = z
  .array(localeSchema)
  .min(1)
  .superRefine((locales, ctx) => {
    uniqueValues(
      locales.map((locale) => locale.code),
      ctx,
      'code',
    );
    uniqueValues(
      locales.map((locale) => locale.tag),
      ctx,
      'tag',
    );
  });

// Features, prefetch and modes

const featuresSchema = z
  .strictObject({
    forms: z.boolean().default(false),
    islands: z.boolean().default(false),
    scripts: z.boolean().default(false),
    wasm: z.boolean().default(false),
    workers: z.boolean().default(false),
  })
  .superRefine((features, ctx) => {
    if (features.islands || features.scripts) return;
    if (features.wasm) add(ctx, ['wasm'], MESSAGES.wasmWorkers);
    if (features.workers) add(ctx, ['workers'], MESSAGES.wasmWorkers);
  });

const prefetchSchema = z.strictObject({
  speculationRules: z.boolean().default(true),
  astroPrefetch: z.boolean().default(false),
});

const modesSchema = z
  .strictObject({
    auto: z.boolean().default(true),
    light: z.boolean().default(false),
    dark: z.boolean().default(false),
    contrast: z.boolean().default(false),
    default: z.enum(['light', 'dark', 'contrast']).optional(),
  })
  .superRefine((modes, ctx) => {
    const base = modes.auto || modes.light || modes.dark;
    if (!base && !modes.contrast) add(ctx, [], MESSAGES.modesNone);
    if (modes.contrast && !base) add(ctx, ['contrast'], MESSAGES.modesContrast);
    if (modes.auto && modes.default !== undefined) add(ctx, ['default'], MESSAGES.modesDefaultAuto);
    if (!modes.auto && (modes.default === undefined || !modes[modes.default])) {
      add(ctx, ['default'], MESSAGES.modesDefault);
    }
  });

// Forms

const FIELD_TYPES = ['text', 'textarea', 'email', 'tel', 'date', 'number', 'choice', 'consent'] as const;

export type FieldType = (typeof FIELD_TYPES)[number];

/** The default `maxLength` of each string type. Only these types take a `maxLength`. */
const MAX_LENGTH: ReadonlyMap<FieldType, number> = new Map([
  ['text', 200],
  ['textarea', 5000],
  ['email', 254],
  ['tel', 32],
]);

/** The default `autocomplete` by field name. Every other name gets `off`. */
const AUTOCOMPLETE: ReadonlyMap<string, string> = new Map([
  ['name', 'name'],
  ['email', 'email'],
  ['tel', 'tel'],
]);

/** The endpoint uses these names itself (9.1). */
const RESERVED_FIELD_NAMES: readonly string[] = ['return', 'website', 'form', 'mode'];

/** One declared field, with every default filled in. */
export interface FormField {
  name: string;
  type: FieldType;
  /** Always `true` for `consent`. */
  required: boolean;
  /** Set for `text`, `textarea`, `email` and `tel`, and for no other type. */
  maxLength?: number;
  /** A number for `number`, a date `YYYY-MM-DD` for `date`. */
  min?: number | string;
  max?: number | string;
  /** Set for `choice`, and for no other type. */
  options?: string[];
  autocomplete: string;
}

/** One declared form, with every default filled in. */
export interface Form {
  /** The recipient: the form's own `to`, or `contact.to`. */
  to: string;
  fields: FormField[];
}

const rangeSchema = z.union([z.number(), z.string()]).optional();

const fieldShape = z.strictObject({
  name: z
    .string()
    .regex(/^[a-z][a-z0-9_]{0,31}$/)
    .refine((name) => !RESERVED_FIELD_NAMES.includes(name), {
      error: 'the names return, website, form and mode are reserved',
    }),
  type: z.enum(FIELD_TYPES),
  required: z.boolean().default(true),
  maxLength: z.number().int().min(1).max(5000).optional(),
  min: rangeSchema,
  max: rangeSchema,
  options: z
    .array(z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/))
    .min(2)
    .max(20)
    .optional(),
  autocomplete: z.string().optional(),
});

type DeclaredField = z.output<typeof fieldShape>;

/** The rules that depend on the type of the field. */
function checkField(field: DeclaredField, ctx: Issues): void {
  if (field.type === 'consent' && !field.required) add(ctx, ['required'], 'a consent field is always required');
  if (field.maxLength !== undefined && !MAX_LENGTH.has(field.type)) {
    add(ctx, ['maxLength'], 'maxLength is only for the types text, textarea, email and tel');
  }
  for (const key of ['min', 'max'] as const) {
    const value = field[key];
    if (field.type === 'number') {
      if (value === undefined) add(ctx, [key], `a number field needs ${key}`);
      else if (typeof value !== 'number') add(ctx, [key], `${key} of a number field must be a number`);
    } else if (field.type === 'date') {
      if (value !== undefined && (typeof value !== 'string' || !isRealDate(value))) {
        add(ctx, [key], `${key} of a date field must be a real date YYYY-MM-DD`);
      }
    } else if (value !== undefined) {
      add(ctx, [key], `${key} is only for the types number and date`);
    }
  }
  if (field.type === 'choice' && field.options === undefined) add(ctx, ['options'], 'a choice field needs options');
  if (field.type !== 'choice' && field.options !== undefined) {
    add(ctx, ['options'], 'options is only for the type choice');
  }
}

/** Fills the defaults that depend on the type and on the name of the field. */
function fillField(field: DeclaredField): FormField {
  const maxLength = field.maxLength ?? MAX_LENGTH.get(field.type);
  return {
    name: field.name,
    type: field.type,
    required: field.type === 'consent' ? true : field.required,
    ...(maxLength === undefined ? {} : { maxLength }),
    ...(field.min === undefined ? {} : { min: field.min }),
    ...(field.max === undefined ? {} : { max: field.max }),
    ...(field.options === undefined ? {} : { options: field.options }),
    autocomplete: field.autocomplete ?? AUTOCOMPLETE.get(field.name) ?? 'off',
  };
}

const fieldSchema = fieldShape.superRefine(checkField).transform(fillField);

const formSchema = z.strictObject({
  to: email.optional(),
  fields: z
    .array(fieldSchema)
    .min(1)
    .max(20)
    .superRefine((fields, ctx) => {
      uniqueValues(
        fields.map((field) => field.name),
        ctx,
        'name',
      );
    }),
});

const formsSchema = z
  .record(
    z.string().regex(/^[a-z][a-z0-9-]{0,31}$/, { error: 'a form id must match ^[a-z][a-z0-9-]{0,31}$' }),
    formSchema,
  )
  .refine((forms) => Object.keys(forms).length >= 1 && Object.keys(forms).length <= 10, {
    error: 'declare 1 to 10 forms',
  });

/** The fields of the form `contact` that a site with forms gets when it declares no form. */
const defaultFields = (): FormField[] => [
  fillField({ name: 'name', type: 'text', required: true }),
  fillField({ name: 'email', type: 'email', required: true }),
  fillField({ name: 'message', type: 'textarea', required: true }),
];

// Legal pages, origins, waivers and limits

const legalPathsSchema = z.record(z.string(), z.string().regex(PAGE_PATH));

const legalSchema = z.strictObject({
  legalNote: legalPathsSchema,
  privacy: legalPathsSchema,
  accessibility: legalPathsSchema.optional(),
});

const originSchema = z
  .strictObject({
    host: z.string().regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/),
    directives: z
      .array(z.enum(['connect', 'frame', 'script', 'form']))
      .min(1)
      .max(4)
      .superRefine((values, ctx) => uniqueValues(values, ctx)),
    load: z.enum(['gesture', 'page']).default('gesture'),
    allow: z
      .array(z.enum(['payment', 'fullscreen', 'autoplay', 'geolocation']))
      .superRefine((values, ctx) => uniqueValues(values, ctx))
      .default(() => []),
    purpose: z.string().min(3).max(120),
    processor: z.string().min(2).max(80),
  })
  .superRefine((origin, ctx) => {
    if (origin.allow.length > 0 && !origin.directives.includes('frame')) add(ctx, ['allow'], MESSAGES.originAllow);
  });

const originsSchema = z
  .array(originSchema)
  .max(10)
  .superRefine((origins, ctx) => {
    uniqueValues(
      origins.map((origin) => origin.host),
      ctx,
      'host',
    );
  });

const UNTIL = 'until must be a real date YYYY-MM-DD';

const waiverSchema = z.strictObject({
  rule: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
  where: z.string().min(1).max(200),
  reason: z.string().min(10).max(200),
  until: z.string().regex(DATE, { error: UNTIL, abort: true }).refine(isRealDate, { error: UNTIL }),
});

/** One limit that a site may lower. A looser value fails. */
const lowerOnly = (name: 'headBytes' | 'documentBytes' | 'domElements') =>
  z
    .number()
    .int()
    .positive()
    .max(LIMITS[name], { error: `a site can only lower this limit: at most ${LIMITS[name]}` })
    .optional();

const limitsSchema = z.strictObject({
  headBytes: lowerOnly('headBytes'),
  documentBytes: lowerOnly('documentBytes'),
  domElements: lowerOnly('domElements'),
});

/** The processing keys of 5.4. */
const PROCESSING_KEYS = ['cdn', 'previews', 'forms', 'server'] as const;

export type ProcessingKey = (typeof PROCESSING_KEYS)[number];

/** An npm package name, with or without a scope. */
const PACKAGE_NAME = /^(@[a-z0-9~-][a-z0-9._~-]*\/)?[a-z0-9~-][a-z0-9._~-]*$/;

// The whole file

const shape = z.strictObject({
  $schema: z.string().optional(),
  site: z.string().regex(/^https:\/\/[a-z0-9.-]+$/),
  codeOwner: z.string().regex(/^@[A-Za-z0-9-]+(\/[A-Za-z0-9._-]+)?$/),
  locales: localesSchema,
  defaultLocale: z.string(),
  features: featuresSchema.prefault({}),
  prefetch: prefetchSchema.prefault({}),
  modes: modesSchema.default(() => ({ auto: true, light: false, dark: false, contrast: false })),
  contact: z.strictObject({ to: email, from: email, probe: email.optional() }).optional(),
  forms: formsSchema.optional(),
  legal: legalSchema,
  processing: z
    .array(z.enum(PROCESSING_KEYS))
    .superRefine((values, ctx) => uniqueValues(values, ctx))
    .default((): ProcessingKey[] => ['cdn', 'previews']),
  securityContact: z.string().regex(/^(mailto:|https:\/\/)/),
  dependencies: z.array(z.string().max(214).regex(PACKAGE_NAME)).default(() => []),
  origins: originsSchema.default(() => []),
  waivers: z
    .array(waiverSchema)
    .max(5)
    .default(() => []),
  limits: limitsSchema.prefault({}),
});

type Declared = z.output<typeof shape>;

type Resolved = Omit<Declared, 'forms'> & {
  /** The declared forms by id. Absent without `features.forms`. */
  forms?: Record<string, Form>;
};

/** The refinements that read more than one field of the file. */
function checkAcrossFields(options: Declared, ctx: Issues): void {
  const codes = options.locales.map((locale) => locale.code);
  const defaultIsDeclared = codes.includes(options.defaultLocale);
  if (!defaultIsDeclared) add(ctx, ['defaultLocale'], MESSAGES.defaultLocale);
  options.locales.forEach((locale, index) => {
    if (locale.code === options.defaultLocale && locale.coverage !== 'full') {
      add(ctx, ['locales', index, 'coverage'], 'the default locale must have the coverage "full"');
    }
  });

  if (options.features.forms) {
    if (options.contact === undefined) add(ctx, ['contact'], MESSAGES.formsContact);
  } else {
    if (options.contact !== undefined) add(ctx, ['contact'], 'contact must be absent without features.forms');
    if (options.forms !== undefined) add(ctx, ['forms'], 'forms must be absent without features.forms');
  }

  for (const kind of ['legalNote', 'privacy', 'accessibility'] as const) {
    const paths = options.legal[kind];
    if (paths === undefined) continue;
    if (kind !== 'accessibility') {
      for (const code of codes) {
        if (!Object.hasOwn(paths, code)) add(ctx, ['legal', kind, code], `the locale ${code} needs a path`);
      }
    }
    for (const [code, path] of Object.entries(paths)) {
      if (!codes.includes(code)) {
        add(ctx, ['legal', kind, code], `${code} is not one of locales[].code`);
        continue;
      }
      // Without a declared default locale, no path has a known prefix. The finding on `defaultLocale` says so.
      if (!defaultIsDeclared) continue;
      if (code !== options.defaultLocale) {
        if (!path.startsWith(`/${code}/`)) {
          add(ctx, ['legal', kind, code], `a path of the locale ${code} must start with /${code}/`);
        }
      } else if (codes.includes(pathSegments(path)[0] ?? '')) {
        add(ctx, ['legal', kind, code], `a path of the default locale ${code} must not start with a locale code`);
      }
    }
  }

  const siteHost = options.site.slice('https://'.length);
  const scripted = options.features.scripts || options.features.islands;
  options.origins.forEach((origin, index) => {
    if (origin.host === siteHost) add(ctx, ['origins', index, 'host'], 'an origin must not be the host of site');
    if (origin.load === 'gesture' && !scripted && origin.directives.some((directive) => directive !== 'form')) {
      add(ctx, ['origins', index, 'load'], MESSAGES.originGesture);
    }
  });
}

/** Fills the defaults that need another field: the form `contact`, and the recipient of each form. */
function resolve(options: Declared): Resolved {
  const { forms: declared, ...rest } = options;
  if (!options.features.forms || options.contact === undefined) return rest;
  const forms: Record<string, Form> = {};
  for (const [id, form] of Object.entries(declared ?? { contact: { fields: defaultFields() } })) {
    forms[id] = { to: form.to ?? options.contact.to, fields: form.fields };
  }
  return { ...options, forms };
}

/**
 * The strict schema of `astro-kit.json` (5.2). Its input is the file. Its output has every default filled in.
 * An unknown key fails at every level.
 */
export const optionsSchema = shape.superRefine(checkAcrossFields).transform(resolve);

/** The settings of a site, with every default filled in. */
export type Options = z.output<typeof optionsSchema>;
export type Locale = Options['locales'][number];
export type Origin = Options['origins'][number];

/** The limits for one site: the limits of the kit, with the three that the site lowered. */
export function effectiveLimits(options: Pick<Options, 'limits'>): Limits {
  return {
    ...LIMITS,
    headBytes: Math.min(LIMITS.headBytes, options.limits.headBytes ?? LIMITS.headBytes),
    documentBytes: Math.min(LIMITS.documentBytes, options.limits.documentBytes ?? LIMITS.documentBytes),
    domElements: Math.min(LIMITS.domElements, options.limits.domElements ?? LIMITS.domElements),
  };
}

// Findings

/** A key that a field path can hold after a dot: it is not empty and has no dot, bracket, quote or white space. */
const PLAIN_KEY = /^[^\s.[\]"]+$/;

/**
 * A field path as a finding prints it: `locales[1].code`, `forms.contact.fields[0].name`, `legal.privacy.fr`.
 * A key that is not plain stands in brackets, so that the path stays clear: `documents["leitfaden.pdf"]`.
 */
export function fieldPath(path: readonly PropertyKey[]): string {
  let out = '';
  for (const key of path) {
    if (typeof key === 'number') out += `[${key}]`;
    else if (!PLAIN_KEY.test(String(key))) out += `[${JSON.stringify(String(key))}]`;
    else out += out === '' ? String(key) : `.${String(key)}`;
  }
  return out;
}

/** The place of a finding in a JSON file: the file, or the file with a field path (section 8, Where). */
export function fieldPlace(file: string, path: readonly PropertyKey[]): string {
  return path.length === 0 ? file : `${file}: ${fieldPath(path)}`;
}

/**
 * Adds one finding for each zod issue. The place names the field, and the detail is the message.
 * Each unknown key is one finding of its own, at the path of the key.
 */
export function reportIssues(report: Report, rule: string, file: string, issues: readonly z.core.$ZodIssue[]): void {
  for (const issue of issues) {
    if (issue.code === 'unrecognized_keys') {
      for (const key of issue.keys) report.add(rule, fieldPlace(file, [...issue.path, key]), 'unknown key');
    } else if (issue.code === 'invalid_key') {
      const messages = issue.issues.map((inner) => inner.message);
      report.add(rule, fieldPlace(file, issue.path), messages.join('; ') || issue.message);
    } else {
      report.add(rule, fieldPlace(file, issue.path), issue.message);
    }
  }
}

/**
 * The paths of the keys `__proto__` in the records that a pattern names. The zod record parser drops this key
 * without an issue, so the loaders report it themselves. In a pattern, `*` stands for every key of an object:
 * `['legal', 'privacy']` names one record, and `['*', 'banned']` names the record `banned` of every entry.
 */
export function hiddenKeys(value: unknown, pattern: readonly string[], path: readonly string[] = []): string[][] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return [];
  const [head, ...rest] = pattern;
  if (head === undefined) return Object.hasOwn(value, '__proto__') ? [[...path, '__proto__']] : [];
  const entries: [string, unknown][] = Object.entries(value);
  return entries
    .filter(([key]) => head === '*' || key === head)
    .flatMap(([key, entry]) => hiddenKeys(entry, rest, [...path, key]));
}

/**
 * Adds one finding for each key `__proto__` in the records that the patterns name. Returns true when it added one.
 * The detail is that of an unknown key in a strict object.
 */
export function reportHiddenKeys(
  report: Report,
  rule: string,
  file: string,
  value: unknown,
  patterns: readonly (readonly string[])[],
): boolean {
  const paths = patterns.flatMap((pattern) => hiddenKeys(value, pattern));
  for (const path of paths) report.add(rule, fieldPlace(file, path), 'unknown key');
  return paths.length > 0;
}

/** The records of `astro-kit.json`: the forms by id, and the legal paths by locale code. */
const OPTION_RECORDS: readonly (readonly string[])[] = [
  ['forms'],
  ['legal', 'legalNote'],
  ['legal', 'privacy'],
  ['legal', 'accessibility'],
];

/** What reading a JSON file of the project gave. */
export type JsonFile = { state: 'ok'; value: unknown } | { state: 'missing' } | { state: 'invalid'; message: string };

/** Reads one JSON file of the project. It never throws for a missing file or for a text that is not JSON. */
export function readJson(root: string, file: string): JsonFile {
  const path = join(root, file);
  if (!existsSync(path)) return { state: 'missing' };
  try {
    return { state: 'ok', value: JSON.parse(readFileSync(path, 'utf8')) as unknown };
  } catch (error) {
    return { state: 'invalid', message: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Validates a parsed settings value. Each issue is one `config-options` finding at `<file>` or `<file>: <field
 * path>`, with the message as the detail. Returns the settings, or `undefined` when they are not valid.
 */
export function parseOptions(value: unknown, report: Report, file: string = OPTIONS_FILE): Options | undefined {
  const hidden = reportHiddenKeys(report, 'config-options', file, value, OPTION_RECORDS);
  const parsed = optionsSchema.safeParse(value);
  if (!parsed.success) reportIssues(report, 'config-options', file, parsed.error.issues);
  return parsed.success && !hidden ? parsed.data : undefined;
}

/** Reads and validates `<root>/astro-kit.json`. A missing file and a text that is not JSON are findings too. */
export function loadOptions(root: string, report: Report): Options | undefined {
  const read = readJson(root, OPTIONS_FILE);
  if (read.state === 'missing') {
    report.add('config-options', OPTIONS_FILE, 'the file is missing');
    return undefined;
  }
  if (read.state === 'invalid') {
    report.add('config-options', OPTIONS_FILE, `the file is not valid JSON: ${read.message}`);
    return undefined;
  }
  return parseOptions(read.value, report);
}

// The rules on valid settings

const DAY_MS = 86_400_000;

/** The longest time that a waiver may run, in days after today. */
export const WAIVER_MAX_DAYS = 90;

/**
 * `config-waiver`: each waiver names a waivable rule, and its `until` is today or later and at most 90 days after
 * today. All dates are UTC.
 */
export function checkWaivers(options: Pick<Options, 'waivers'>, report: Report, today: Date = new Date()): void {
  const now = today.toISOString().slice(0, 10);
  const last = new Date(Date.parse(`${now}T00:00:00Z`) + WAIVER_MAX_DAYS * DAY_MS).toISOString().slice(0, 10);
  options.waivers.forEach((waiver, index) => {
    const place = (field: string): string => fieldPlace(OPTIONS_FILE, ['waivers', index, field]);
    if (!isWaivable(waiver.rule)) report.add('config-waiver', place('rule'), `${waiver.rule} is not a waivable rule`);
    if (waiver.until < now) {
      report.add(
        'config-waiver',
        place('until'),
        `the waiver for ${waiver.rule} on ${waiver.where} ended on ${waiver.until}: fix the page, or ask the owner for a new date`,
      );
    } else if (waiver.until > last) {
      report.add(
        'config-waiver',
        place('until'),
        `${waiver.until} is more than ${WAIVER_MAX_DAYS} days ahead: the last date is ${last}`,
      );
    }
  });
}

/**
 * `legal-processing`: `processing` holds `cdn` and `previews`, and with forms `forms` and `server`. It holds `forms`
 * and `server` only with forms.
 */
export function checkProcessing(options: Pick<Options, 'features' | 'processing'>, report: Report): void {
  const needed: ProcessingKey[] = options.features.forms ? [...PROCESSING_KEYS] : ['cdn', 'previews'];
  for (const key of needed) {
    if (!options.processing.includes(key)) {
      report.add('legal-processing', fieldPlace(OPTIONS_FILE, ['processing']), `${key} is missing`);
    }
  }
  options.processing.forEach((entry, index) => {
    if (!needed.includes(entry)) {
      report.add(
        'legal-processing',
        fieldPlace(OPTIONS_FILE, ['processing', index]),
        `${entry} is only for features.forms true`,
      );
    }
  });
}

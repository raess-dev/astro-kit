/**
 * The fields of a declared form (specification, 5.2 and 9.1): the field types, their defaults, the validation of a
 * submitted value (step 7 of 9.1), and the subject and text of the mail. The endpoint and the test server stub use
 * this one validator.
 *
 * Pure functions. The module imports only types, so it loads in the Worker without `node:` modules.
 */
import type { FormField } from '../options.ts';

/** The field types of 5.2. */
export const FIELD_TYPES = ['text', 'textarea', 'email', 'tel', 'date', 'number', 'choice', 'consent'] as const;

export type FieldType = (typeof FIELD_TYPES)[number];

/** The default `maxLength` of each string type. Only these types take a `maxLength`. */
export const MAX_LENGTH: ReadonlyMap<FieldType, number> = new Map([
  ['text', 200],
  ['textarea', 5000],
  ['email', 254],
  ['tel', 32],
]);

/** The default `autocomplete` by field name. Every other name gets `off`. */
export const AUTOCOMPLETE: ReadonlyMap<string, string> = new Map([
  ['name', 'name'],
  ['email', 'email'],
  ['tel', 'tel'],
]);

/** The pattern of every mail address: in the settings, in `site.json` and in an `email` field. */
export const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** A date `YYYY-MM-DD`. `isRealDate` also checks the calendar. */
export const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The pattern of a `tel` value (9.1). */
export const TEL = /^\+?[0-9 ()./-]{5,32}$/;

/** A valid floating-point number of HTML: the form in which a browser sends the value of `input[type=number]`. */
export const NUMBER = /^-?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?$/;

/**
 * The address of the mail's `replyTo`: the "valid e-mail address" of HTML, which a browser checks for
 * `input[type=email]`. It has no white space, no `<`, `>`, `,`, `;`, `:` or `"`, and no character outside ASCII.
 */
export const REPLY_TO =
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

/** A control character other than tab and line feed: the characters that a textarea may not hold. */
const CONTROL_IN_TEXTAREA = /[^\P{Cc}\t\n]/u;
/** Any control character: the characters that every other field may not hold. */
const CONTROL = /\p{Cc}/u;
/**
 * The characters that no field may hold: the line and paragraph separators (U+2028, U+2029), which some mail
 * clients show as a line break, and the bidi embeddings, overrides and isolates (U+202A to U+202E, U+2066 to
 * U+2069), which can turn the text around. Other format characters, such as the soft hyphen, ZWJ, ZWNJ, LRM and
 * RLM, stay allowed: names and emoji use them.
 */
const SEPARATOR_OR_BIDI = /[\u2028\u2029\u202a-\u202e\u2066-\u2069]/u;

/** Says whether the text is a date `YYYY-MM-DD` that exists in the calendar. */
export function isRealDate(text: string): boolean {
  if (!DATE.test(text)) return false;
  const date = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === text;
}

/**
 * A submitted value as step 7 reads it: each CRLF and each CR becomes LF, then the value is trimmed. So a line
 * break counts as one character, as in the browser's `maxlength`.
 */
export function normalizeValue(raw: string): string {
  return raw.replace(/\r\n?/g, '\n').trim();
}

/** Says whether a value is within the declared `min` and `max` of a number field. */
function inNumberRange(field: FormField, value: number): boolean {
  if (typeof field.min === 'number' && value < field.min) return false;
  return !(typeof field.max === 'number' && value > field.max);
}

/** Says whether a date is within the declared `min` and `max` of a date field. Both sides are `YYYY-MM-DD`. */
function inDateRange(field: FormField, value: string): boolean {
  if (typeof field.min === 'string' && value < field.min) return false;
  return !(typeof field.max === 'string' && value > field.max);
}

/**
 * Says whether a normalized value that is not empty is valid for its field (9.1, step 7). The length counts UTF-16
 * code units, as the `maxlength` of a browser does.
 */
export function isValidValue(field: FormField, value: string): boolean {
  if ((field.type === 'textarea' ? CONTROL_IN_TEXTAREA : CONTROL).test(value)) return false;
  if (SEPARATOR_OR_BIDI.test(value)) return false;
  if (field.maxLength !== undefined && value.length > field.maxLength) return false;
  switch (field.type) {
    case 'email':
      return EMAIL.test(value);
    case 'tel':
      return TEL.test(value);
    case 'date':
      return isRealDate(value) && inDateRange(field, value);
    case 'number': {
      const number = Number(value);
      return NUMBER.test(value) && Number.isFinite(number) && inNumberRange(field, number);
    }
    case 'choice':
      return field.options?.includes(value) === true;
    default:
      // `text`, `textarea` and `consent`: a consent is valid when it is present.
      return true;
  }
}

/** The result of step 7: the normalized value of each declared field, and the names of the invalid fields. */
export interface FieldResult {
  /** The value of each declared field, normalized, by name. An empty optional field has the empty text. */
  values: Map<string, string>;
  /** The names of the invalid fields, in declared order. */
  invalid: string[];
}

/**
 * Step 7 of 9.1 on the parsed body. A field is valid when it is empty and optional, or when its value is valid.
 * A required field needs a value of at least one character after the trim. Other keys of the body are ignored.
 */
export function validateFields(fields: readonly FormField[], body: ReadonlyMap<string, string>): FieldResult {
  const values = new Map<string, string>();
  const invalid: string[] = [];
  for (const field of fields) {
    const value = normalizeValue(body.get(field.name) ?? '');
    values.set(field.name, value);
    const valid = value === '' ? !field.required : isValidValue(field, value);
    if (!valid) invalid.push(field.name);
  }
  return { values, invalid };
}

// The mail

const ENGLISH = 'Message through the website form';

/** The subject of the mail by locale. Another locale takes the English text. */
export const SUBJECTS: ReadonlyMap<string, string> = new Map([
  ['de', 'Nachricht über das Formular der Website'],
  ['fr', 'Message via le formulaire du site'],
  ['it', 'Messaggio dal modulo del sito'],
  ['en', ENGLISH],
]);

/** The subject: `${SUBJECTS[locale] ?? SUBJECTS.en}: ${id}`. A visitor never sets it. */
export function mailSubject(locale: string, id: string): string {
  return `${SUBJECTS.get(locale) ?? ENGLISH}: ${id}`;
}

/** The first line of every mail. */
export const NOT_VERIFIED = 'Sent through the website form; the sender address is not verified.';

/** What the mail text reads. */
export interface MailInput {
  id: string;
  /** The validated `return`: the path of the posting page. */
  page: string;
  locale: string;
  fields: readonly FormField[];
  /** The normalized values of `validateFields`. */
  values: ReadonlyMap<string, string>;
}

/**
 * The text of the mail (9.1). The head names the form, the page and the locale. Then each single-line field in
 * declared order, as `<name>: <value>` (a consent as `yes`), and each textarea after a blank line, as `<name>:`
 * and its value on the next lines. An empty optional field is left out. The lines end with LF, and the text ends
 * with one LF.
 */
export function mailText(input: MailInput): string {
  const lines = [NOT_VERIFIED, '', `Form: ${input.id}`, `Page: ${input.page}`, `Locale: ${input.locale}`];
  const filled = input.fields.filter((field) => (input.values.get(field.name) ?? '') !== '');
  const single = filled.filter((field) => field.type !== 'textarea');
  if (single.length > 0) lines.push('');
  for (const field of single) {
    lines.push(`${field.name}: ${field.type === 'consent' ? 'yes' : (input.values.get(field.name) ?? '')}`);
  }
  for (const field of filled.filter((each) => each.type === 'textarea')) {
    lines.push('', `${field.name}:`, input.values.get(field.name) ?? '');
  }
  return `${lines.join('\n')}\n`;
}

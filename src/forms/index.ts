/**
 * The form endpoint (specification, 9.1): `@raess/astro-kit/forms`. The feature shim
 * `src/pages/api/forms/[form].ts` of a site holds:
 *
 *   import { createFormEndpoint } from '@raess/astro-kit/forms';
 *   export const prerender = false;
 *   export const POST = createFormEndpoint();
 *
 * `handleForm` follows the order of processing of 9.1 step by step, and the first step that fails decides the code.
 * `checkForm` holds steps 1 to 7. The test server stub of `serveDist` runs the same `checkForm`, without the
 * bindings, the rate limits and the mail (`stubForm`). Every answer carries `FORM_HEADERS` and `private, no-store`.
 * The log holds the code only, never form content. A failed load of the runtime also logs the message of its error.
 *
 * `cloudflare:workers` and `virtual:astro-kit` load on the first request, so the module imports in Node. It imports
 * no `node:` module, because it runs in the Worker.
 */
import type { Form, Options } from '../options.ts';
import { localeOfPath, PAGE_PATH } from '../routes.ts';
import {
  bodyCap,
  type FieldResult,
  mailSubject,
  mailText,
  normalizeValue,
  REPLY_TO,
  validateFields,
} from './fields.ts';
import { FORM_HEADERS, HONEYPOT, MAX_RETURN_CHARS, NO_STORE, RETURN_FIELD } from './limits.ts';

export * from './fields.ts';
export * from './limits.ts';

/** The codes of a failed request, in the order of the steps of 9.1 (the trap shows as `invalid`). */
export type FormCode =
  | 'too_large'
  | 'bad_body'
  | 'bad_form'
  | 'bad_return'
  | 'trap'
  | 'invalid'
  | 'no_binding'
  | 'rate_limited'
  | 'send_failed';

/** The settings that the endpoint reads. `Options` of src/options.ts fits. */
export type FormSettings = Pick<Options, 'site' | 'defaultLocale' | 'locales' | 'contact' | 'forms'>;

/** The status of each outcome in JSON mode (9.1, "The answer"). */
export const FORM_STATUS: ReadonlyMap<FormCode | 'sent', number> = new Map([
  ['sent', 200],
  ['too_large', 413],
  ['bad_body', 400],
  ['bad_form', 404],
  ['bad_return', 400],
  ['trap', 400],
  ['invalid', 400],
  ['no_binding', 503],
  ['rate_limited', 429],
  ['send_failed', 502],
]);

/** The status of every answer in redirect mode. */
export const REDIRECT_STATUS = 303;

/** The content type of an answer in JSON mode. */
export const JSON_TYPE = 'application/json; charset=utf-8';

/** The two content types that step 3 parses. */
const URLENCODED = 'application/x-www-form-urlencoded';
const MULTIPART = 'multipart/form-data';

/** The page of a failure that comes before step 5 validates `return`. */
const ROOT = '/';

// The answer

/**
 * Says whether the answer is JSON: `Accept` lists `application/json` with a `q` above 0. A missing `q` is 1; a `q`
 * that is not a number is 0. `*\/*` and `application/*` do not count.
 */
export function wantsJson(accept: string | null): boolean {
  if (accept === null) return false;
  for (const range of accept.split(',')) {
    const [type = '', ...parameters] = range.split(';');
    if (type.trim().toLowerCase() !== 'application/json') continue;
    let quality = 1;
    for (const parameter of parameters) {
      const [name = '', value = ''] = parameter.split('=');
      if (name.trim().toLowerCase() === 'q') quality = Number(value.trim() === '' ? 'x' : value.trim());
    }
    if (quality > 0) return true;
  }
  return false;
}

/** The headers of every answer: the five headers of 9.1 and `Cache-Control`. */
function answerHeaders(): Headers {
  const headers = new Headers();
  for (const [name, value] of FORM_HEADERS) headers.set(name, value);
  headers.set('Cache-Control', NO_STORE);
  return headers;
}

/** The outcome of one request: `sent`, or a failure with its code. */
export interface Outcome {
  code: FormCode | 'sent';
  /** The validated `return`, or `undefined` before step 5 has passed. */
  page: string | undefined;
  /** The invalid field names of `trap` and `invalid`, in declared order. */
  fields: readonly string[];
}

/**
 * The answer for an outcome (9.1, "The answer"). Redirect mode: 303 to `<return>#sent` or `<return>#not-sent`,
 * and to `/#not-sent` when `return` is not valid or not read yet. JSON mode: the status and body of the table.
 */
export function formAnswer(outcome: Outcome, json: boolean): Response {
  const headers = answerHeaders();
  if (!json) {
    headers.set('Location', `${outcome.page ?? ROOT}#${outcome.code === 'sent' ? 'sent' : 'not-sent'}`);
    return new Response(null, { status: REDIRECT_STATUS, headers });
  }
  headers.set('Content-Type', JSON_TYPE);
  const body =
    outcome.code === 'sent'
      ? { ok: true }
      : outcome.code === 'trap' || outcome.code === 'invalid'
        ? { ok: false, code: 'invalid', fields: outcome.fields }
        : { ok: false, code: outcome.code };
  return new Response(JSON.stringify(body), { status: FORM_STATUS.get(outcome.code) ?? 400, headers });
}

// Steps 1 to 7

/**
 * Step 2: reads the body as a stream into one buffer of `max` bytes. Past `max` bytes it cancels the stream and
 * gives `undefined`, so the endpoint never holds more than `max` bytes of the body. A stream that fails gives
 * `undefined` too. A request with no body gives an empty buffer.
 */
export async function readCapped(request: Request, max: number): Promise<Uint8Array<ArrayBuffer> | undefined> {
  if (request.body === null) return new Uint8Array(0);
  const reader = request.body.getReader();
  const buffer = new Uint8Array(max);
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return buffer.subarray(0, size);
      if (size + value.byteLength > max) break;
      buffer.set(value, size);
      size += value.byteLength;
    }
  } catch {
    // A stream that fails is read no further.
  }
  await reader.cancel().catch(() => undefined);
  return undefined;
}

/**
 * The parameters of a content type, by lower-case name, each with every value it has. A quoted value loses its
 * quotes. The split at `;` ignores quotes: a value with `;` in quotes gives more parameters, never fewer.
 */
export function mediaParameters(contentType: string): Map<string, string[]> {
  const parameters = new Map<string, string[]>();
  for (const part of contentType.split(';').slice(1)) {
    const equals = part.indexOf('=');
    if (equals < 0) continue;
    const name = part.slice(0, equals).trim().toLowerCase();
    const raw = part.slice(equals + 1).trim();
    const value = raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"') ? raw.slice(1, -1) : raw;
    parameters.set(name, [...(parameters.get(name) ?? []), value]);
  }
  return parameters;
}

/**
 * The body as text with one character for each byte (the code of the character is the byte), as a header value
 * reads. No byte sequence can hide a line from the scan of `hasFilePart`.
 */
function latin1(body: Uint8Array): string {
  let text = '';
  for (let start = 0; start < body.length; start += 8_192) {
    text += String.fromCharCode(...body.subarray(start, start + 8_192));
  }
  return text;
}

/** A `filename` or `filename*` parameter in a `Content-Disposition` line, with any value. */
const FILE_NAME = /filename\*?\s*=/i;

/** A header line of a part that is its `Content-Disposition`. */
const DISPOSITION = /^content-disposition\s*:/i;

/**
 * Says whether a multipart body has a part with a file name, as step 3 reads it: the kit reads the part headers
 * itself, before any parser of the runtime. A `Content-Disposition` with a `filename` or `filename*` parameter
 * counts, with any value and under any key. The Worker's `formData()` gives a part with `filename=""` or
 * `filename*=` as a text (13.1 item 78), so the parser alone cannot decide. A body with no usable boundary counts
 * as one with a file, so it never reaches the parser.
 */
export function hasFilePart(body: Uint8Array<ArrayBuffer>, contentType: string): boolean {
  const boundaries = mediaParameters(contentType).get('boundary') ?? [];
  const boundary = boundaries[0];
  if (boundaries.length !== 1 || boundary === undefined || boundary === '') return true;
  const text = latin1(body);
  // Every line of a part counts, not only the lines before its first blank line: a parser that ends the head
  // later must find no file name that the kit missed. A value line that looks like such a header rejects too.
  for (const part of text.split(`--${boundary}`).slice(1)) {
    for (const line of part.replace(/(?:\r\n|\r|\n)[ \t]+/g, ' ').split(/\r\n|\r|\n/)) {
      if (DISPOSITION.test(line) && FILE_NAME.test(line)) return true;
    }
  }
  return false;
}

/** Says whether an urlencoded body declares a charset other than UTF-8, in any letter case. */
function otherCharset(contentType: string): boolean {
  return (mediaParameters(contentType).get('charset') ?? []).some((charset) => charset.toLowerCase() !== 'utf-8');
}

/**
 * Step 3: the fields of the body, or `undefined`. Only `application/x-www-form-urlencoded` and
 * `multipart/form-data` parse. A part with a file name rejects the body (`hasFilePart`), and so does any file
 * value that the parser gives. An urlencoded body with a charset other than UTF-8 rejects, in Node as in the
 * Worker. The first value of each key wins.
 */
export async function parseBody(
  body: Uint8Array<ArrayBuffer>,
  contentType: string | null,
): Promise<Map<string, string> | undefined> {
  const type = (contentType ?? '').split(';')[0]?.trim().toLowerCase();
  if (contentType === null || (type !== URLENCODED && type !== MULTIPART)) return undefined;
  if (type === URLENCODED && otherCharset(contentType)) return undefined;
  if (type === MULTIPART && hasFilePart(body, contentType)) return undefined;
  try {
    const data = await new Response(body, { headers: { 'content-type': contentType } }).formData();
    const values = new Map<string, string>();
    for (const [key, value] of data) {
      if (typeof value !== 'string') return undefined;
      if (!values.has(key)) values.set(key, value);
    }
    return values;
  } catch {
    // A body that does not parse, or a content type that `Headers` refuses.
    return undefined;
  }
}

/** Step 5: a page path of at most 512 characters, with no `//`, no scheme and no backslash. */
export function isValidReturn(page: string): boolean {
  return (
    page.length <= MAX_RETURN_CHARS &&
    PAGE_PATH.test(page) &&
    !page.includes('//') &&
    !page.includes('\\') &&
    !/^[a-z][a-z0-9+.-]*:/i.test(page)
  );
}

/** The declared forms by id, as a table: an id from the route is looked up there, never in the object. */
function formsOf(settings: FormSettings): Map<string, Form> {
  return new Map(Object.entries(settings.forms ?? {}));
}

/** A request that passed steps 1 to 7. */
export interface Accepted {
  ok: true;
  id: string;
  form: Form;
  /** The validated `return`. */
  page: string;
  /** The locale of `return`. */
  locale: string;
  values: FieldResult['values'];
}

/** A request that failed one of steps 1 to 7. */
export interface Refused extends Outcome {
  ok: false;
  code: FormCode;
}

const refused = (code: FormCode, page?: string, fields: readonly string[] = []): Refused => ({
  ok: false,
  code,
  page,
  fields,
});

/** Says whether the content length that the request declares is above the cap (step 1). */
function declaresTooMuch(request: Request, cap: number): boolean {
  const length = request.headers.get('content-length');
  return length !== null && /^\s*\d+\s*$/.test(length) && Number(length) > cap;
}

/**
 * The body cap of steps 1 and 2 for a request to the form `id`: the `bodyCap` of that form. An id that names no
 * declared form gets the largest cap of the declared forms, so the order of the codes stays: such a body still
 * reaches step 4 and gets `bad_form`.
 */
export function capOf(settings: FormSettings, id: string | undefined): number {
  const forms = formsOf(settings);
  const form = id === undefined ? undefined : forms.get(id);
  if (form !== undefined) return bodyCap(form.fields);
  return Math.max(bodyCap([]), ...[...forms.values()].map((each) => bodyCap(each.fields)));
}

/**
 * Steps 1 to 7 of 9.1, in order: the declared length, the capped read, the parse, the form id, `return`, the
 * honeypot and the declared fields. The first step that fails decides the code. With a filled honeypot the fields
 * are validated all the same, so the answer of the trap has the shape of an `invalid` one.
 */
export async function checkForm(
  request: Request,
  id: string | undefined,
  settings: FormSettings,
): Promise<Accepted | Refused> {
  const cap = capOf(settings, id);
  if (declaresTooMuch(request, cap)) return refused('too_large');
  const body = await readCapped(request, cap);
  if (body === undefined) return refused('too_large');
  const values = await parseBody(body, request.headers.get('content-type'));
  if (values === undefined) return refused('bad_body');
  const form = id === undefined ? undefined : formsOf(settings).get(id);
  if (id === undefined || form === undefined) return refused('bad_form');
  const page = values.get(RETURN_FIELD);
  if (page === undefined || !isValidReturn(page)) return refused('bad_return');
  const result = validateFields(form.fields, values);
  if (normalizeValue(values.get(HONEYPOT) ?? '') !== '') return refused('trap', page, result.invalid);
  if (result.invalid.length > 0) return refused('invalid', page, result.invalid);
  return { ok: true, id, form, page, locale: localeOfPath(page, settings), values: result.values };
}

// Steps 8 to 10

/** A rate limiter binding of Workers (`ratelimits`). */
export interface RateLimit {
  limit(options: { key: string }): Promise<unknown>;
}

/** The message that the `send_email` binding takes as a plain object (13.1 item 47). */
export interface Mail {
  from: string;
  to: string;
  subject: string;
  text: string;
  replyTo?: string;
}

/** The `send_email` binding of Workers. */
export interface SendEmail {
  send(message: Mail): Promise<unknown>;
}

/** The bindings of step 8, and the probe secret. */
interface Bindings {
  email: SendEmail;
  /** `FORM_RATE_LIMIT`: 3 in 60 s, keyed by IP address. */
  ip: RateLimit;
  /** `FORM_RATE_LIMIT_ALL`: 20 in 60 s, keyed by form. */
  all: RateLimit;
  /** `KIT_PROBE_SECRET`, when it is a text that is not empty. */
  secret: string | undefined;
}

/** A member of a value that may be anything, or `undefined`. It never throws for an object. */
function member(value: unknown, name: string): unknown {
  return typeof value === 'object' && value !== null && name in value ? Reflect.get(value, name) : undefined;
}

const isRateLimit = (value: unknown): value is RateLimit => typeof member(value, 'limit') === 'function';
const isSendEmail = (value: unknown): value is SendEmail => typeof member(value, 'send') === 'function';

/** Step 8: the three bindings, or `undefined` when one is missing. */
function bindingsOf(env: unknown): Bindings | undefined {
  const email = member(env, 'EMAIL');
  const ip = member(env, 'FORM_RATE_LIMIT');
  const all = member(env, 'FORM_RATE_LIMIT_ALL');
  if (!isSendEmail(email) || !isRateLimit(ip) || !isRateLimit(all)) return undefined;
  const secret = member(env, 'KIT_PROBE_SECRET');
  return { email, ip, all, secret: typeof secret === 'string' && secret !== '' ? secret : undefined };
}

/** The `host` of 10.4: the host of `site` without a leading `www.`. It starts each rate limit key. */
export const keyHost = (site: string): string => site.replace(/^https:\/\//, '').replace(/^www\./, '');

/** An IPv4 address: four decimal numbers from 0 to 255. */
const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/** The four numbers of an IPv4 address, or `undefined`. */
function ipv4Of(text: string): number[] | undefined {
  const match = IPV4.exec(text);
  if (match === null) return undefined;
  const numbers = match.slice(1).map(Number);
  return numbers.every((number) => number <= 255) ? numbers : undefined;
}

/** A group of an IPv6 address: one to four hex digits. */
const HEXTET = /^[0-9a-f]{1,4}$/i;

/** The groups of one side of `::`: hex groups, and an IPv4 tail as two groups. `undefined` when one is not valid. */
function hextetsOf(side: string, last: boolean): number[] | undefined {
  if (side === '') return [];
  const groups = side.split(':');
  const result: number[] = [];
  for (const [index, group] of groups.entries()) {
    const tail = last && index === groups.length - 1 ? ipv4Of(group) : undefined;
    if (tail !== undefined) {
      result.push(((tail[0] ?? 0) << 8) | (tail[1] ?? 0), ((tail[2] ?? 0) << 8) | (tail[3] ?? 0));
    } else if (HEXTET.test(group)) result.push(Number.parseInt(group, 16));
    else return undefined;
  }
  return result;
}

/** The eight groups of an IPv6 address, with `::` expanded, or `undefined` for a text that is not one. */
export function ipv6Of(text: string): number[] | undefined {
  const sides = text.split('::');
  if (sides.length > 2) return undefined;
  const [left = '', right] = sides;
  const head = hextetsOf(left, right === undefined);
  const tail = right === undefined ? [] : hextetsOf(right, true);
  if (head === undefined || tail === undefined) return undefined;
  if (right === undefined) return head.length === 8 ? head : undefined;
  const missing = 8 - head.length - tail.length;
  return missing >= 1 ? [...head, ...Array<number>(missing).fill(0), ...tail] : undefined;
}

/**
 * The address part of the IP key of step 9. An IPv4 address stays whole, written in decimal. An IPv6 address
 * counts by its /64 prefix: its first four groups in lower-case hex without leading zeros, as `2001:db8:1:2::/64`.
 * An IPv4-mapped IPv6 address (`::ffff:192.0.2.1`) counts as its IPv4 address. A missing or unparsable address
 * is `unknown`.
 */
export function ipKey(ip: string | null): string {
  const text = (ip ?? '').trim();
  const v4 = ipv4Of(text);
  if (v4 !== undefined) return v4.join('.');
  const v6 = ipv6Of(text);
  if (v6 === undefined) return 'unknown';
  if (v6.slice(0, 5).every((group) => group === 0) && v6[5] === 0xffff) {
    const [high = 0, low = 0] = v6.slice(6);
    return [high >> 8, high & 0xff, low >> 8, low & 0xff].join('.');
  }
  return `${v6
    .slice(0, 4)
    .map((group) => group.toString(16))
    .join(':')}::/64`;
}

/** The two keys of step 9: one for the IP address (`ipKey`), one for the form. */
export function limitKeys(site: string, ip: string | null, id: string): { ip: string; form: string } {
  const host = keyHost(site);
  return { ip: `${host}:ip:${ipKey(ip)}`, form: `${host}:form:${id}` };
}

/** Says whether a limiter let the request pass: its result is an object with `success: true`. */
const passed = (result: unknown): boolean => member(result, 'success') === true;

/** One call of a limiter. A limiter that throws at once gives a rejected promise, like one that rejects. */
const limitOf = (limiter: RateLimit, key: string): Promise<unknown> =>
  Promise.resolve().then(() => limiter.limit({ key }));

/**
 * Step 9: the limiters, one after the other. `FORM_RATE_LIMIT` counts the IP key first. Only a request that it
 * lets pass reaches `FORM_RATE_LIMIT_ALL` with the form key, so a request refused for its IP address never uses the
 * budget of the form. A matched probe skips the IP limiter and still counts against the form. A limiter that
 * refuses, throws or rejects stops the request.
 */
async function withinLimits(bindings: Bindings, keys: { ip: string; form: string }, probe: boolean): Promise<boolean> {
  try {
    if (!probe && !passed(await limitOf(bindings.ip, keys.ip))) return false;
    return passed(await limitOf(bindings.all, keys.form));
  } catch {
    return false;
  }
}

/** The part of `SubtleCrypto` of Workers that Node lacks: a comparison in constant time. */
interface TimingSafe {
  timingSafeEqual(a: ArrayBuffer, b: ArrayBuffer): boolean;
}

const isTimingSafe = (subtle: SubtleCrypto): subtle is SubtleCrypto & TimingSafe =>
  typeof member(subtle, 'timingSafeEqual') === 'function';

/**
 * The probe compare (9.1, abuse control): says whether the header equals the secret, in constant time. Both texts
 * are hashed with SHA-256 first, so the compare reads two buffers of 32 bytes whatever the lengths. The Worker
 * compares them with `crypto.subtle.timingSafeEqual`; where that is missing (Node), a loop compares every byte and
 * never stops early.
 */
export async function probeMatches(
  given: string | null,
  secret: string,
  subtle: SubtleCrypto = crypto.subtle,
): Promise<boolean> {
  if (given === null) return false;
  const encoder = new TextEncoder();
  const [a, b] = await Promise.all([
    subtle.digest('SHA-256', encoder.encode(given)),
    subtle.digest('SHA-256', encoder.encode(secret)),
  ]);
  if (isTimingSafe(subtle)) return subtle.timingSafeEqual(a, b);
  return sameBytes(new Uint8Array(a), new Uint8Array(b));
}

/**
 * The compare of the probe where `timingSafeEqual` is missing: says whether two byte arrays are equal. It reads
 * every byte of both, also after the first difference, so its time does not depend on where they differ.
 */
export function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  const length = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let index = 0; index < length; index += 1) difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  return difference === 0;
}

/**
 * The header of the weekly probe of smoke. Its name holds `token`, so Cloudflare writes `REDACTED` for its value
 * in trace events, Workers Logs and Tail Workers (13.1 item 77).
 */
export const PROBE_HEADER = 'x-kit-probe-token';

/**
 * The `replyTo` of the mail: the value of the first `email` field, when it is also a valid e-mail address of HTML
 * (`REPLY_TO`). Any other value gives no `replyTo`; the address stays in the text of the mail.
 */
function replyToOf(accepted: Accepted): string | undefined {
  const field = accepted.form.fields.find((each) => each.type === 'email');
  const value = field === undefined ? '' : (accepted.values.get(field.name) ?? '');
  return REPLY_TO.test(value) ? value : undefined;
}

/**
 * One POST to the endpoint: steps 1 to 10 of 9.1, in order, and the answer. A failure logs
 * `astro-kit form: <code>` and nothing else.
 */
export async function handleForm(
  request: Request,
  id: string | undefined,
  settings: FormSettings,
  env: unknown,
): Promise<Response> {
  const json = wantsJson(request.headers.get('accept'));
  const fail = (outcome: Outcome): Response => {
    console.warn(`astro-kit form: ${outcome.code}`);
    return formAnswer(outcome, json);
  };
  const checked = await checkForm(request, id, settings);
  if (!checked.ok) return fail(checked);
  const page = checked.page;
  const bindings = bindingsOf(env);
  const contact = settings.contact;
  if (bindings === undefined || contact === undefined) return fail({ code: 'no_binding', page, fields: [] });
  // The probe is compared before step 9, because a matched probe skips the IP limiter.
  const probe =
    contact.probe !== undefined &&
    bindings.secret !== undefined &&
    (await probeMatches(request.headers.get(PROBE_HEADER), bindings.secret));
  const keys = limitKeys(settings.site, request.headers.get('cf-connecting-ip'), checked.id);
  if (!(await withinLimits(bindings, keys, probe))) return fail({ code: 'rate_limited', page, fields: [] });
  const replyTo = replyToOf(checked);
  const mail: Mail = {
    from: contact.from,
    to: probe && contact.probe !== undefined ? contact.probe : checked.form.to,
    subject: mailSubject(checked.locale, checked.id),
    text: mailText({
      id: checked.id,
      page,
      locale: checked.locale,
      fields: checked.form.fields,
      values: checked.values,
    }),
    ...(replyTo === undefined ? {} : { replyTo }),
  };
  try {
    await bindings.email.send(mail);
  } catch {
    return fail({ code: 'send_failed', page, fields: [] });
  }
  return formAnswer({ code: 'sent', page, fields: [] }, json);
}

/**
 * The test server stub (9.1): steps 1 to 7 of `checkForm`, with no bindings, no rate limits and no mail. A request
 * that passes them is `sent`. It logs nothing.
 */
export async function stubForm(request: Request, id: string | undefined, settings: FormSettings): Promise<Response> {
  const json = wantsJson(request.headers.get('accept'));
  const checked = await checkForm(request, id, settings);
  return formAnswer(checked.ok ? { code: 'sent', page: checked.page, fields: [] } : checked, json);
}

/** What the endpoint needs at run time: the settings of the site and the Worker env. */
export interface FormRuntime {
  settings: FormSettings;
  env: unknown;
}

/** Loads the settings from `virtual:astro-kit` and the env from `cloudflare:workers`. */
async function loadRuntime(): Promise<FormRuntime> {
  const [kit, workers] = await Promise.all([import('virtual:astro-kit'), import('cloudflare:workers')]);
  return { settings: kit.options, env: workers.env };
}

/**
 * The part of Astro's `APIContext` that the endpoint reads. A function that takes it fits Astro's `APIRoute`, so
 * the module needs no type of Astro.
 */
export interface FormContext {
  params: Readonly<Record<string, string | undefined>>;
  request: Request;
}

/** The POST handler of the shim. */
export type FormRoute = (context: FormContext) => Promise<Response>;

/**
 * The POST handler of the feature shim. The settings and the env load on the first request, and once. A test
 * gives its own `load`.
 *
 * A load that fails answers as `no_binding`: 503 in JSON mode, else 303 to `/#not-sent`, with the five headers.
 * It logs `astro-kit form: no_binding`, and the message of the load error with `console.error`; that message
 * holds no form content. The next request tries the load again.
 */
export function createFormEndpoint(load: () => Promise<FormRuntime> = loadRuntime): FormRoute {
  let runtime: Promise<FormRuntime> | undefined;
  return async ({ params, request }) => {
    runtime ??= Promise.resolve().then(load);
    let loaded: FormRuntime;
    try {
      loaded = await runtime;
    } catch (error) {
      runtime = undefined;
      console.error(
        `astro-kit form: the runtime did not load: ${error instanceof Error ? error.message : String(error)}`,
      );
      console.warn('astro-kit form: no_binding');
      return formAnswer({ code: 'no_binding', page: undefined, fields: [] }, wantsJson(request.headers.get('accept')));
    }
    return handleForm(request, params.form, loaded.settings, loaded.env);
  };
}

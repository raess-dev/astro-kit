/**
 * The contact endpoint for src/pages/api/contact.ts (prerender = false):
 *
 *   import { createContactEndpoint } from '@raess/astro-kit/forms';
 *   export const prerender = false;
 *   export const POST = createContactEndpoint();
 *
 * Every answer is a 303 to the contact page of the validated locale plus #sent or #not-sent,
 * never to a client-supplied URL. Logs carry error codes only, never form content.
 */
import type { APIRoute } from 'astro';
import { z } from 'astro/zod';
import type { Manifest } from '../manifest.ts';
import type { KitOptions } from '../options.ts';
import { HONEYPOT, LIMITS, MAX_BODY_BYTES } from './limits.ts';

export { CONTACT_ACTION, FIELD, HONEYPOT, LIMITS, MAX_BODY_BYTES } from './limits.ts';

type RateLimit = { limit(options: { key: string }): Promise<{ success: boolean }> };

/** The Worker bindings the endpoint uses; wrangler.jsonc declares them (forms-binding). */
export interface ContactEnv {
  EMAIL?: {
    send(message: { from: string; to: string; replyTo: string; subject: string; text: string }): Promise<unknown>;
  };
  /** 3 per 60 s, keyed per IP. */
  FORM_RATE_LIMIT?: RateLimit;
  /** 20 per 60 s for the whole form. */
  FORM_RATE_LIMIT_ALL?: RateLimit;
  KIT_PROBE_SECRET?: string;
}

export interface ContactConfig {
  /** The site host from astro-kit.json. It scopes the rate-limit keys, so sites in one account never share counters. */
  site: string;
  locales: readonly string[];
  defaultLocale: string;
  contact: { to: string; from: string; probe?: string | undefined };
  /** Contact page path per locale, e.g. { de: '/kontakt/', fr: '/fr/contact/' }. */
  paths: Readonly<Record<string, string>>;
}

export type Outcome = 'sent' | 'not-sent';

export const NOT_VERIFIED = 'Sent through the website form; the sender address is not verified.';

/** Fixed subjects; a visitor never sets the subject. */
export const SUBJECTS: Readonly<Record<string, string>> = {
  de: 'Nachricht über das Kontaktformular',
  fr: 'Message via le formulaire de contact',
  it: 'Messaggio dal modulo di contatto',
  en: 'Message through the contact form',
};

// No control characters, so nothing can break a mail header; the message keeps tabs and line breaks.
const line = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .regex(/^[^\p{Cc}]*$/u);
export const contactSchema = z.object({
  name: line(LIMITS.name),
  email: line(LIMITS.email).regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/),
  message: z
    .string()
    .trim()
    .min(1)
    .max(LIMITS.message)
    .regex(/^(?:[^\p{Cc}]|[\t\n])*$/u),
});
export type ContactFields = z.output<typeof contactSchema>;

/** The contact page of a locale plus the result fragment. */
export function resultUrl(config: ContactConfig, locale: string, outcome: Outcome): string {
  const path = config.paths[locale] ?? config.paths[config.defaultLocale] ?? '/';
  return `${path}#${outcome}`;
}

/** The body, or undefined once it passes max bytes; the stream is cancelled there. */
export async function readCapped(request: Request, max = MAX_BODY_BYTES): Promise<Uint8Array<ArrayBuffer> | undefined> {
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      return undefined;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.byteLength;
  }
  return out;
}

/** Form fields as strings; undefined for another content type, a file or a malformed body. */
export async function parseForm(
  body: Uint8Array<ArrayBuffer>,
  contentType: string,
): Promise<Map<string, string> | undefined> {
  const type = contentType.split(';')[0]?.trim().toLowerCase();
  if (type !== 'application/x-www-form-urlencoded' && type !== 'multipart/form-data') return undefined;
  try {
    const data = await new Response(body, { headers: { 'content-type': contentType } }).formData();
    const out = new Map<string, string>();
    for (const [key, value] of data) {
      if (typeof value !== 'string') return undefined;
      if (!out.has(key)) out.set(key, value);
    }
    return out;
  } catch {
    return undefined;
  }
}

/** Validates the fields; browsers count a line break as one character but send CRLF. */
export function validate(fields: Map<string, string>): ContactFields | undefined {
  const parsed = contactSchema.safeParse({
    name: fields.get('name') ?? '',
    email: fields.get('email') ?? '',
    message: (fields.get('message') ?? '').replace(/\r\n?/g, '\n'),
  });
  return parsed.success ? parsed.data : undefined;
}

/** Constant-time comparison for the probe secret. */
function same(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

export function mailText(fields: ContactFields, locale: string): string {
  return [
    NOT_VERIFIED,
    '',
    `Name: ${fields.name}`,
    `Email: ${fields.email}`,
    `Locale: ${locale}`,
    '',
    fields.message,
  ].join('\n');
}

/** Handles one POST: size cap, parse, honeypot, locale, fields, rate limits, send. */
export async function handleContact(request: Request, env: ContactEnv, config: ContactConfig): Promise<Response> {
  let locale = config.defaultLocale;
  const answer = (outcome: Outcome, code?: string): Response => {
    if (code) console.warn(`astro-kit contact: ${code}`);
    return new Response(null, {
      status: 303,
      headers: { Location: resultUrl(config, locale, outcome), 'Cache-Control': 'private, no-store' },
    });
  };

  if (Number(request.headers.get('content-length') ?? 0) > MAX_BODY_BYTES) return answer('not-sent', 'too_large');
  const body = await readCapped(request);
  if (!body) return answer('not-sent', 'too_large');
  const form = await parseForm(body, request.headers.get('content-type') ?? '');
  if (!form) return answer('not-sent', 'bad_body');
  const claimed = form.get('locale') ?? '';
  if (config.locales.includes(claimed)) locale = claimed;
  if (form.get(HONEYPOT)) return answer('not-sent', 'trap');
  if (locale !== claimed) return answer('not-sent', 'bad_locale');
  const fields = validate(form);
  if (!fields) return answer('not-sent', 'invalid');

  if (!env.FORM_RATE_LIMIT || !env.FORM_RATE_LIMIT_ALL || !env.EMAIL) return answer('not-sent', 'no_binding');
  const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';
  const limits = await Promise.all([
    env.FORM_RATE_LIMIT.limit({ key: `${config.site}:ip:${ip}` }),
    env.FORM_RATE_LIMIT_ALL.limit({ key: `${config.site}:form` }),
  ]);
  if (!limits.every((l) => l.success)) return answer('not-sent', 'rate_limited');

  const secret = env.KIT_PROBE_SECRET;
  const probe = Boolean(config.contact.probe && secret && same(request.headers.get('x-kit-probe') ?? '', secret));
  try {
    await env.EMAIL.send({
      from: config.contact.from,
      to: probe && config.contact.probe ? config.contact.probe : config.contact.to,
      replyTo: fields.email,
      subject: SUBJECTS[locale] ?? SUBJECTS.en ?? 'Contact form',
      text: mailText(fields, locale),
    });
  } catch {
    return answer('not-sent', 'send_failed');
  }
  return answer('sent');
}

/** Reads the kit options and the manifest into the endpoint config. */
export function contactConfig(options: KitOptions, manifest: Manifest): ContactConfig {
  if (!options.contact)
    throw new Error('astro-kit: features.forms needs contact.to and contact.from in astro-kit.json');
  const paths: Record<string, string> = {};
  for (const [code, page] of Object.entries(manifest.byId.contact ?? {})) paths[code] = page.path;
  return {
    site: new URL(options.site).host,
    locales: options.locales.map((l) => l.code),
    defaultLocale: options.defaultLocale,
    contact: options.contact,
    paths,
  };
}

/** The POST handler. The Worker env and the kit data load on first use, so this module imports in Node too. */
export function createContactEndpoint(): APIRoute {
  let config: ContactConfig | undefined;
  return async ({ request }) => {
    // Only workerd provides this module, so it loads on first request.
    const { env } = (await import('cloudflare:workers')) as { env: ContactEnv };
    if (!config) {
      const kit = await import('virtual:astro-kit');
      config = contactConfig(kit.options as KitOptions, kit.manifest as Manifest);
    }
    return handleContact(request, env, config);
  };
}

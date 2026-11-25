/**
 * Shared inputs of the form tests (specification, 9.1 and 14.2): the settings of the test site with its two forms,
 * the fake Worker env with per-key counters, and the requests. A helper here never asserts.
 */
import type { Mail, RateLimit, SendEmail } from '../../src/forms/index.ts';
import type { Options } from '../../src/options.ts';
import { optionsOf } from './fixtures.ts';

/** The host of the test site (14.2). */
export const HOST = 'laerchenwald.example';

/** The settings of the test site at M7: three locales, the `contact` and `booking` forms of 14.2. */
export const SITE_FORMS = {
  site: `https://${HOST}`,
  codeOwner: '@example-owner',
  locales: [
    { code: 'de', tag: 'de-CH', name: 'Deutsch' },
    { code: 'fr', tag: 'fr-CH', name: 'Français' },
    { code: 'en', tag: 'en', name: 'English' },
  ],
  defaultLocale: 'de',
  features: { forms: true },
  contact: { to: `info@${HOST}`, from: `form@${HOST}` },
  forms: {
    contact: {
      fields: [
        { name: 'name', type: 'text' },
        { name: 'email', type: 'email' },
        { name: 'message', type: 'textarea' },
      ],
    },
    booking: {
      fields: [
        { name: 'name', type: 'text' },
        { name: 'email', type: 'email' },
        { name: 'tel', type: 'tel', required: false },
        { name: 'arrival', type: 'date' },
        { name: 'nights', type: 'number', min: 1, max: 14 },
        { name: 'room', type: 'choice', options: ['single', 'double', 'family'] },
        { name: 'terms', type: 'consent' },
      ],
    },
  },
  legal: {
    legalNote: { de: '/impressum/', fr: '/fr/mentions-legales/', en: '/en/legal-note/' },
    privacy: { de: '/datenschutz/', fr: '/fr/protection-des-donnees/', en: '/en/privacy/' },
  },
  processing: ['cdn', 'previews', 'forms', 'server'],
  securityContact: `mailto:security@${HOST}`,
} as const;

export const SETTINGS: Options = optionsOf(SITE_FORMS);

/** The test site with a probe inbox. */
export const PROBE_ADDRESS = `probe@${HOST}`;
export const WITH_PROBE: Options = optionsOf({
  ...SITE_FORMS,
  contact: { ...SITE_FORMS.contact, probe: PROBE_ADDRESS },
});

/** A valid post of the contact form on the German contact page. */
export const CONTACT: Readonly<Record<string, string>> = {
  return: '/kontakt/',
  website: '',
  name: 'Anna Muster',
  email: 'anna@example.com',
  message: 'Guten Tag\r\nIst am 3. März ein Zimmer frei?',
};

/** A valid post of the booking form on the French contact page. */
export const BOOKING: Readonly<Record<string, string>> = {
  return: '/fr/contact/',
  website: '',
  name: 'Jean Dupont',
  email: 'jean@example.com',
  tel: '+41 81 555 01 99',
  arrival: '2027-01-15',
  nights: '3',
  room: 'double',
  terms: 'on',
};

export const URLENCODED = 'application/x-www-form-urlencoded';

/** A POST of urlencoded fields to the endpoint of a form, with more headers. */
export function post(
  id: string,
  fields: Readonly<Record<string, string>>,
  headers: Readonly<Record<string, string>> = {},
): Request {
  return new Request(`https://${HOST}/api/forms/${id}/`, {
    method: 'POST',
    headers: { 'content-type': URLENCODED, ...headers },
    body: new URLSearchParams({ ...fields }).toString(),
  });
}

/** A POST whose body is a stream of `size` bytes in chunks of 4,096, with no `content-length`. */
export function streamed(id: string, size: number, pulled: { bytes: number; cancelled: boolean }): Request {
  const chunk = new Uint8Array(4_096).fill(0x61);
  let left = size;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (left <= 0) {
        controller.close();
        return;
      }
      const part = chunk.subarray(0, Math.min(chunk.byteLength, left));
      left -= part.byteLength;
      pulled.bytes += part.byteLength;
      controller.enqueue(part);
    },
    cancel() {
      pulled.cancelled = true;
    },
  });
  const init: RequestInit & { duplex: 'half' } = {
    method: 'POST',
    headers: { 'content-type': URLENCODED },
    body,
    duplex: 'half',
  };
  return new Request(`https://${HOST}/api/forms/${id}/`, init);
}

/** A rate limiter of Workers with a counter for each key: a key passes `max` times in the test. */
export class FakeLimiter implements RateLimit {
  readonly max: number;
  readonly counts = new Map<string, number>();
  readonly keys: string[] = [];
  fails = false;

  constructor(max: number) {
    this.max = max;
  }

  limit(options: { key: string }): Promise<{ success: boolean }> {
    if (this.fails) return Promise.reject(new Error('the limiter failed'));
    const count = (this.counts.get(options.key) ?? 0) + 1;
    this.counts.set(options.key, count);
    this.keys.push(options.key);
    return Promise.resolve({ success: count <= this.max });
  }
}

/** The `send_email` binding: it keeps each message, or throws. */
export class FakeMail implements SendEmail {
  readonly sent: Mail[] = [];
  fails = false;

  send(message: Mail): Promise<void> {
    if (this.fails) return Promise.reject(new Error('the mail failed'));
    this.sent.push(message);
    return Promise.resolve();
  }
}

/** The fake Worker env: the three bindings of step 8, with the limits of 10.4, and the probe secret. */
export interface FakeEnv {
  EMAIL: FakeMail;
  FORM_RATE_LIMIT: FakeLimiter;
  FORM_RATE_LIMIT_ALL: FakeLimiter;
  KIT_PROBE_SECRET?: string;
}

export function fakeEnv(secret?: string): FakeEnv {
  return {
    EMAIL: new FakeMail(),
    FORM_RATE_LIMIT: new FakeLimiter(3),
    FORM_RATE_LIMIT_ALL: new FakeLimiter(20),
    ...(secret === undefined ? {} : { KIT_PROBE_SECRET: secret }),
  };
}

/** The five headers of 9.1, written out, so that a changed constant of src/forms/limits.ts fails here. */
export const FIVE_HEADERS: readonly (readonly [string, string])[] = [
  ['x-content-type-options', 'nosniff'],
  ['referrer-policy', 'strict-origin-when-cross-origin'],
  ['strict-transport-security', 'max-age=31536000; includeSubDomains'],
  ['cross-origin-resource-policy', 'same-origin'],
  ['content-security-policy', "default-src 'none'; frame-ancestors 'none'"],
];

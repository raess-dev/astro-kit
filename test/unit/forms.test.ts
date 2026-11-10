import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  type ContactConfig,
  type ContactEnv,
  contactConfig,
  handleContact,
  LIMITS,
  MAX_BODY_BYTES,
  NOT_VERIFIED,
  parseForm,
  readCapped,
  resultUrl,
  validate,
} from '../../src/forms/index.ts';
import type { Manifest, PageRecord } from '../../src/manifest.ts';
import type { KitOptions } from '../../src/options.ts';

const config: ContactConfig = {
  locales: ['de', 'fr'],
  defaultLocale: 'de',
  contact: { to: 'client@example.ch', from: 'form@example.ch', probe: 'probe@example.ch' },
  paths: { de: '/kontakt/', fr: '/fr/contact/' },
};

type Sent = Parameters<NonNullable<ContactEnv['EMAIL']>['send']>[0];

/** A fake Worker env: records mail, allows `allow` calls per rate-limit key. */
function fakeEnv(opts: { allow?: number; allowAll?: number; fail?: boolean; secret?: string } = {}) {
  const sent: Sent[] = [];
  const limiter = (allow: number) => {
    const counts = new Map<string, number>();
    return {
      async limit({ key }: { key: string }) {
        const n = (counts.get(key) ?? 0) + 1;
        counts.set(key, n);
        return { success: n <= allow };
      },
    };
  };
  const env: ContactEnv = {
    EMAIL: {
      async send(message) {
        if (opts.fail) throw new Error('provider down');
        sent.push(message);
      },
    },
    FORM_RATE_LIMIT: limiter(opts.allow ?? 3),
    FORM_RATE_LIMIT_ALL: limiter(opts.allowAll ?? 20),
  };
  if (opts.secret) env.KIT_PROBE_SECRET = opts.secret;
  return { env, sent };
}

const good = {
  locale: 'de',
  name: 'Anna Muster',
  email: 'anna@example.org',
  message: 'Guten Tag,\r\nbitte rufen Sie mich an.',
  website: '',
};

function post(fields: Record<string, string>, headers: Record<string, string> = {}): Request {
  return new Request('https://example.ch/api/contact', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'cf-connecting-ip': '192.0.2.1', ...headers },
    body: new URLSearchParams(fields).toString(),
  });
}

async function run(request: Request, env: ContactEnv) {
  const res = await handleContact(request, env, config);
  return { status: res.status, location: res.headers.get('location'), cache: res.headers.get('cache-control') };
}

test('a valid post sends one mail and answers 303 to #sent', async () => {
  const { env, sent } = fakeEnv();
  const res = await run(post(good), env);
  assert.deepEqual(res, { status: 303, location: '/kontakt/#sent', cache: 'private, no-store' });
  assert.equal(sent.length, 1);
  const mail = sent[0];
  assert.ok(mail);
  assert.equal(mail.from, 'form@example.ch');
  assert.equal(mail.to, 'client@example.ch');
  assert.equal(mail.replyTo, 'anna@example.org');
  assert.equal(mail.subject, 'Nachricht über das Kontaktformular');
  assert.equal(mail.text.split('\n')[0], NOT_VERIFIED);
  assert.match(mail.text, /Name: Anna Muster\nEmail: anna@example.org\nLocale: de\n\nGuten Tag,\nbitte/);
});

test('the redirect follows the validated locale', async () => {
  const { env, sent } = fakeEnv();
  assert.equal((await run(post({ ...good, locale: 'fr' }), env)).location, '/fr/contact/#sent');
  assert.equal(sent[0]?.subject, 'Message via le formulaire de contact');
  assert.equal((await run(post({ ...good, locale: 'xx' }), env)).location, '/kontakt/#not-sent');
  assert.equal(resultUrl({ ...config, paths: { de: '/kontakt/' } }, 'fr', 'sent'), '/kontakt/#sent');
  assert.equal(resultUrl({ ...config, paths: {} }, 'fr', 'not-sent'), '/#not-sent');
});

test('a filled honeypot lands on #not-sent and sends nothing', async () => {
  const { env, sent } = fakeEnv();
  const res = await run(post({ ...good, locale: 'fr', website: 'https://spam.example' }), env);
  assert.equal(res.location, '/fr/contact/#not-sent');
  assert.equal(sent.length, 0);
});

test('the size cap rejects a large Content-Length and a large streamed body', async () => {
  const { env, sent } = fakeEnv();
  const declared = post(good, { 'content-length': String(MAX_BODY_BYTES + 1) });
  assert.equal((await run(declared, env)).location, '/kontakt/#not-sent');
  const big = new TextEncoder().encode('x'.repeat(MAX_BODY_BYTES + 1));
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      for (let i = 0; i < big.length; i += 4096) c.enqueue(big.slice(i, i + 4096));
      c.close();
    },
  });
  const streamed = new Request('https://example.ch/api/contact', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: stream,
    duplex: 'half',
  } as RequestInit);
  assert.equal(await readCapped(streamed), undefined);
  assert.equal(sent.length, 0);
  const small = await readCapped(post(good));
  assert.ok(small && small.byteLength > 0 && small.byteLength <= MAX_BODY_BYTES);
});

test('validation enforces LIMITS and rejects control characters', () => {
  const fields = (over: Record<string, string>) => new Map(Object.entries({ ...good, ...over }));
  assert.ok(validate(fields({})));
  assert.ok(validate(fields({ name: 'n'.repeat(LIMITS.name) })));
  assert.equal(validate(fields({ name: 'n'.repeat(LIMITS.name + 1) })), undefined);
  assert.equal(validate(fields({ name: '   ' })), undefined);
  assert.equal(validate(fields({ name: 'Anna\r\nBcc: x@example.org' })), undefined);
  assert.equal(validate(fields({ email: 'not-an-address' })), undefined);
  assert.equal(validate(fields({ email: `${'a'.repeat(LIMITS.email)}@example.org` })), undefined);
  // 2,500 lines: CRLF counts as one character, as the browser's maxlength does.
  const lines = Array.from({ length: LIMITS.message / 2 }, () => 'x').join('\r\n');
  assert.ok(validate(fields({ message: `${lines}x` })));
  assert.equal(validate(fields({ message: 'm'.repeat(LIMITS.message + 1) })), undefined);
  assert.equal(validate(fields({ message: 'hi\u0000there' })), undefined);
});

test('an invalid field lands on #not-sent', async () => {
  const { env, sent } = fakeEnv();
  assert.equal((await run(post({ ...good, email: 'nope' }), env)).location, '/kontakt/#not-sent');
  assert.equal(sent.length, 0);
});

test('multipart bodies parse; other types and files are rejected', async () => {
  const form = new FormData();
  for (const [k, v] of Object.entries(good)) form.set(k, v);
  const multipart = new Request('https://example.ch/api/contact', { method: 'POST', body: form });
  const { env, sent } = fakeEnv();
  assert.equal((await run(multipart, env)).location, '/kontakt/#sent');
  assert.equal(sent.length, 1);
  const json = await parseForm(new TextEncoder().encode('{}'), 'application/json');
  assert.equal(json, undefined);
  const withFile = new FormData();
  withFile.set('name', 'Anna');
  withFile.set('upload', new Blob(['x']), 'x.txt');
  const req = new Request('https://example.ch/', { method: 'POST', body: withFile });
  const bytes = new Uint8Array(await req.arrayBuffer());
  assert.equal(await parseForm(bytes, req.headers.get('content-type') ?? ''), undefined);
});

test('the rate limits cover the IP and the form', async () => {
  const perIp = fakeEnv({ allow: 1 });
  assert.equal((await run(post(good), perIp.env)).location, '/kontakt/#sent');
  assert.equal((await run(post(good), perIp.env)).location, '/kontakt/#not-sent');
  assert.equal((await run(post(good, { 'cf-connecting-ip': '192.0.2.2' }), perIp.env)).location, '/kontakt/#sent');
  const whole = fakeEnv({ allowAll: 1 });
  assert.equal((await run(post(good), whole.env)).location, '/kontakt/#sent');
  assert.equal((await run(post(good, { 'cf-connecting-ip': '192.0.2.2' }), whole.env)).location, '/kontakt/#not-sent');
  assert.equal(perIp.sent.length + whole.sent.length, 3);
});

test('missing bindings and a failed send land on #not-sent', async () => {
  assert.equal((await run(post(good), {})).location, '/kontakt/#not-sent');
  const { env } = fakeEnv({ fail: true });
  assert.equal((await run(post(good), env)).location, '/kontakt/#not-sent');
});

test('the probe secret routes mail to the probe address only when it matches', async () => {
  const { env, sent } = fakeEnv({ secret: 's3cret-value' });
  await run(post(good, { 'x-kit-probe': 's3cret-value' }), env);
  await run(post(good, { 'x-kit-probe': 'wrong', 'cf-connecting-ip': '192.0.2.3' }), env);
  await run(post(good, { 'cf-connecting-ip': '192.0.2.4' }), fakeEnv().env);
  assert.deepEqual(
    sent.map((m) => m.to),
    ['probe@example.ch', 'client@example.ch'],
  );
});

test('contactConfig reads locales, addresses and contact paths', () => {
  const page = (locale: string, path: string) => ({ id: 'contact', locale, path }) as PageRecord;
  const manifest = {
    pages: [],
    drafts: false,
    byId: { contact: { de: page('de', '/kontakt/'), fr: page('fr', '/fr/contact/') } },
  } as Manifest;
  const options = {
    locales: [
      { code: 'de', tag: 'de-CH', name: 'Deutsch' },
      { code: 'fr', tag: 'fr-CH', name: 'Français' },
    ],
    defaultLocale: 'de',
    contact: config.contact,
  } as KitOptions;
  assert.deepEqual(contactConfig(options, manifest), config);
  assert.throws(() => contactConfig({ ...options, contact: undefined } as unknown as KitOptions, manifest));
});

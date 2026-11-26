/**
 * The unit tests of the form endpoint, part two (specification, 9.1, and 14, M7): `handleForm` with a fake Worker
 * env that counts each key of both limiters. Every outcome code in both modes, the five headers on every answer,
 * the order of the steps, the rate limit keys, the probe, the mail and the log.
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, mock, test } from 'node:test';
import type { APIRoute } from 'astro';
import {
  bodyCap,
  capOf,
  createFormEndpoint,
  type FormSettings,
  handleForm,
  ipKey,
  PROBE_HEADER,
  type RateLimit,
} from '../../src/forms/index.ts';
import {
  BOOKING,
  CONTACT,
  CONTACT_CAP,
  type FakeEnv,
  FIVE_HEADERS,
  fakeEnv,
  HOST,
  PROBE_ADDRESS,
  post,
  SETTINGS,
  streamed,
  WITH_PROBE,
} from './forms-fixtures.ts';

const JSON_ACCEPT = { accept: 'application/json' };

/** The `console.warn` and `console.error` lines of the endpoint in one test. */
let warnings: string[] = [];
let errors: string[] = [];
beforeEach(() => {
  warnings = [];
  errors = [];
  mock.method(console, 'warn', (line: unknown) => warnings.push(String(line)));
  mock.method(console, 'error', (line: unknown) => errors.push(String(line)));
});
afterEach(() => mock.restoreAll());

interface Seen {
  status: number;
  location: string | null;
  type: string | null;
  body: string;
}

const seen = async (response: Response): Promise<Seen> => ({
  status: response.status,
  location: response.headers.get('location'),
  type: response.headers.get('content-type'),
  body: await response.text(),
});

/** One case of the outcome table: how to make the request, the env, and the answers in both modes. */
interface OutcomeCase {
  code: string;
  id: string;
  request: (headers: Readonly<Record<string, string>>) => Request;
  env: () => unknown;
  settings?: FormSettings;
  redirect: string;
  status: number;
  json: unknown;
}

const OUTCOMES: readonly OutcomeCase[] = [
  {
    code: 'sent',
    id: 'contact',
    request: (headers) => post('contact', CONTACT, headers),
    env: fakeEnv,
    redirect: '/kontakt/#sent',
    status: 200,
    json: { ok: true },
  },
  {
    code: 'too_large',
    id: 'contact',
    request: (headers) => post('contact', CONTACT, { ...headers, 'content-length': String(CONTACT_CAP + 1) }),
    env: fakeEnv,
    redirect: '/#not-sent',
    status: 413,
    json: { ok: false, code: 'too_large' },
  },
  {
    code: 'too_large',
    id: 'contact',
    request: (headers) => {
      const request = streamed('contact', CONTACT_CAP + 1, { bytes: 0, cancelled: false });
      for (const [name, value] of Object.entries(headers)) request.headers.set(name, value);
      return request;
    },
    env: fakeEnv,
    redirect: '/#not-sent',
    status: 413,
    json: { ok: false, code: 'too_large' },
  },
  {
    code: 'bad_body',
    id: 'contact',
    request: (headers) => post('contact', CONTACT, { ...headers, 'content-type': 'application/json' }),
    env: fakeEnv,
    redirect: '/#not-sent',
    status: 400,
    json: { ok: false, code: 'bad_body' },
  },
  {
    code: 'bad_form',
    id: 'newsletter',
    request: (headers) => post('newsletter', CONTACT, headers),
    env: fakeEnv,
    redirect: '/#not-sent',
    status: 404,
    json: { ok: false, code: 'bad_form' },
  },
  {
    code: 'bad_return',
    id: 'contact',
    request: (headers) => post('contact', { ...CONTACT, return: '//evil.example/' }, headers),
    env: fakeEnv,
    redirect: '/#not-sent',
    status: 400,
    json: { ok: false, code: 'bad_return' },
  },
  {
    code: 'trap',
    id: 'contact',
    request: (headers) => post('contact', { ...CONTACT, website: 'https://spam.example/' }, headers),
    env: fakeEnv,
    redirect: '/kontakt/#not-sent',
    status: 400,
    json: { ok: false, code: 'invalid', fields: [] },
  },
  {
    code: 'invalid',
    id: 'booking',
    request: (headers) => post('booking', { ...BOOKING, email: 'jean', nights: '15', terms: '' }, headers),
    env: fakeEnv,
    redirect: '/fr/contact/#not-sent',
    status: 400,
    json: { ok: false, code: 'invalid', fields: ['email', 'nights', 'terms'] },
  },
  {
    code: 'no_binding',
    id: 'contact',
    request: (headers) => post('contact', CONTACT, headers),
    env: () => ({ EMAIL: fakeEnv().EMAIL, FORM_RATE_LIMIT: fakeEnv().FORM_RATE_LIMIT }),
    redirect: '/kontakt/#not-sent',
    status: 503,
    json: { ok: false, code: 'no_binding' },
  },
  {
    code: 'rate_limited',
    id: 'contact',
    request: (headers) => post('contact', CONTACT, headers),
    env: () => {
      const env = fakeEnv();
      env.FORM_RATE_LIMIT.counts.set(`${HOST}:ip:unknown`, 3);
      return env;
    },
    redirect: '/kontakt/#not-sent',
    status: 429,
    json: { ok: false, code: 'rate_limited' },
  },
  {
    code: 'send_failed',
    id: 'contact',
    request: (headers) => post('contact', CONTACT, headers),
    env: () => {
      const env = fakeEnv();
      env.EMAIL.fails = true;
      return env;
    },
    redirect: '/kontakt/#not-sent',
    status: 502,
    json: { ok: false, code: 'send_failed' },
  },
];

test('every outcome code of 9.1 in redirect mode: 303 to <return>#sent or #not-sent, with no body', async () => {
  const actual: unknown[] = [];
  for (const outcome of OUTCOMES) {
    const response = await handleForm(outcome.request({}), outcome.id, outcome.settings ?? SETTINGS, outcome.env());
    actual.push([outcome.code, await seen(response)]);
  }
  assert.deepEqual(
    actual,
    OUTCOMES.map((outcome) => [outcome.code, { status: 303, location: outcome.redirect, type: null, body: '' }]),
  );
  // Each failure logs its code and nothing else; the sent post logs nothing.
  assert.deepEqual(
    warnings,
    OUTCOMES.filter((outcome) => outcome.code !== 'sent').map((outcome) => `astro-kit form: ${outcome.code}`),
  );
});

test('every outcome code of 9.1 in JSON mode: the status and the body of the table', async () => {
  const actual: unknown[] = [];
  for (const outcome of OUTCOMES) {
    const response = await handleForm(
      outcome.request(JSON_ACCEPT),
      outcome.id,
      outcome.settings ?? SETTINGS,
      outcome.env(),
    );
    const answer = await seen(response);
    actual.push([outcome.code, answer.status, answer.location, answer.type, JSON.parse(answer.body)]);
  }
  assert.deepEqual(
    actual,
    OUTCOMES.map((outcome) => [outcome.code, outcome.status, null, 'application/json; charset=utf-8', outcome.json]),
  );
  // The exact text of two bodies: no space, the key order of 9.1.
  const invalid = await handleForm(OUTCOMES[7]?.request(JSON_ACCEPT) ?? post('x', {}), 'booking', SETTINGS, fakeEnv());
  assert.equal(await invalid.text(), '{"ok":false,"code":"invalid","fields":["email","nights","terms"]}');
  const sent = await handleForm(post('contact', CONTACT, JSON_ACCEPT), 'contact', SETTINGS, fakeEnv());
  assert.equal(await sent.text(), '{"ok":true}');
});

test('every answer carries the five headers of 9.1 and private, no-store, in both modes', async () => {
  for (const accept of [{}, JSON_ACCEPT, { accept: 'application/json;q=0' }]) {
    for (const outcome of OUTCOMES) {
      const response = await handleForm(
        outcome.request(accept),
        outcome.id,
        outcome.settings ?? SETTINGS,
        outcome.env(),
      );
      const place = `${outcome.code} with ${JSON.stringify(accept)}`;
      for (const [name, value] of FIVE_HEADERS) assert.equal(response.headers.get(name), value, `${place}: ${name}`);
      assert.equal(response.headers.get('cache-control'), 'private, no-store', place);
      const names = [...response.headers.keys()].sort();
      const json = response.status !== 303;
      assert.deepEqual(
        names,
        [...FIVE_HEADERS.map(([name]) => name), 'cache-control', json ? 'content-type' : 'location'].sort(),
        `${place}: no other header`,
      );
    }
  }
});

test('the first step that fails decides the code', async () => {
  const code = async (request: Request, id: string, bindings: unknown = fakeEnv()): Promise<string> => {
    const body = JSON.parse(await (await handleForm(request, id, SETTINGS, bindings)).text()) as { code?: string };
    return body.code ?? 'sent';
  };
  const everything = { ...CONTACT, return: '/x//', website: 'x', email: 'no' };
  assert.equal(
    await code(post('nope', everything, { ...JSON_ACCEPT, 'content-type': 'text/plain' }), 'nope'),
    'bad_body',
  );
  assert.equal(await code(post('nope', everything, JSON_ACCEPT), 'nope'), 'bad_form', 'step 4 before step 5');
  assert.equal(await code(post('contact', everything, JSON_ACCEPT), 'contact'), 'bad_return', 'step 5 before 6');
  // The trap shows as `invalid`, and only the log names it.
  warnings = [];
  assert.equal(await code(post('contact', { ...everything, return: '/' }, JSON_ACCEPT), 'contact'), 'invalid');
  assert.deepEqual(warnings, ['astro-kit form: trap']);
  assert.equal(
    await code(post('contact', { ...CONTACT, email: 'no' }, JSON_ACCEPT), 'contact', {}),
    'invalid',
    'step 7 before 8',
  );
  const limited = fakeEnv();
  limited.FORM_RATE_LIMIT.fails = true;
  limited.EMAIL.fails = true;
  assert.equal(
    await code(post('contact', CONTACT, JSON_ACCEPT), 'contact', limited),
    'rate_limited',
    'step 9 before 10',
  );
  // A missing return and a missing form id.
  const { return: _, ...noReturn } = CONTACT;
  assert.equal(await code(post('contact', noReturn, JSON_ACCEPT), 'contact'), 'bad_return');
  assert.equal(await code(post('contact', CONTACT, JSON_ACCEPT), ''), 'bad_form');
  const missing = await handleForm(post('contact', CONTACT, JSON_ACCEPT), undefined, SETTINGS, fakeEnv());
  assert.equal(missing.status, 404);
  // An id that names a property of every object is no form.
  for (const id of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
    assert.equal(await code(post(id, CONTACT, JSON_ACCEPT), id), 'bad_form', id);
  }
  // A step that fails reaches no later step: no limiter counts and no mail goes out.
  const env = fakeEnv();
  await handleForm(post('contact', { ...CONTACT, email: 'no' }), 'contact', SETTINGS, env);
  assert.deepEqual([env.FORM_RATE_LIMIT.keys, env.FORM_RATE_LIMIT_ALL.keys, env.EMAIL.sent], [[], [], []]);
});

test('the edges of steps 1 and 6: a declared length of exactly the cap passes, and a honeypot of spaces is empty', async () => {
  const fields = { ...CONTACT, pad: '' };
  const size = new URLSearchParams({ ...fields }).toString().length;
  const exact = { ...fields, pad: 'a'.repeat(CONTACT_CAP - size) };
  const body = new URLSearchParams(exact).toString();
  assert.equal(body.length, CONTACT_CAP);
  const sent = await handleForm(
    post('contact', exact, { ...JSON_ACCEPT, 'content-length': String(CONTACT_CAP) }),
    'contact',
    SETTINGS,
    fakeEnv(),
  );
  assert.deepEqual([sent.status, await sent.text()], [200, '{"ok":true}']);
  const over = { ...exact, pad: `${exact.pad}a` };
  const large = await handleForm(
    post('contact', over, { ...JSON_ACCEPT, 'content-length': String(CONTACT_CAP + 1) }),
    'contact',
    SETTINGS,
    fakeEnv(),
  );
  assert.equal(large.status, 413);
  for (const website of ['  ', '\t', '\r\n', ' \n ']) {
    const answer = await handleForm(
      post('contact', { ...CONTACT, website }, JSON_ACCEPT),
      'contact',
      SETTINGS,
      fakeEnv(),
    );
    assert.deepEqual([answer.status, await answer.text()], [200, '{"ok":true}'], JSON.stringify(website));
  }
  const filled = await handleForm(
    post('contact', { ...CONTACT, website: ' x ' }, JSON_ACCEPT),
    'contact',
    SETTINGS,
    fakeEnv(),
  );
  assert.equal(filled.status, 400);
});

test('a binding that is not usable counts as missing', async () => {
  const base = fakeEnv();
  const envs: readonly (readonly [string, unknown])[] = [
    ['no env', undefined],
    ['null', null],
    ['an empty env', {}],
    ['no EMAIL', { FORM_RATE_LIMIT: base.FORM_RATE_LIMIT, FORM_RATE_LIMIT_ALL: base.FORM_RATE_LIMIT_ALL }],
    ['no FORM_RATE_LIMIT_ALL', { EMAIL: base.EMAIL, FORM_RATE_LIMIT: base.FORM_RATE_LIMIT }],
    ['EMAIL without send', { ...base, EMAIL: {} }],
    ['FORM_RATE_LIMIT as a text', { ...base, FORM_RATE_LIMIT: 'x' }],
  ];
  for (const [name, env] of envs) {
    const response = await handleForm(post('contact', CONTACT, JSON_ACCEPT), 'contact', SETTINGS, env);
    assert.equal(response.status, 503, name);
  }
  assert.deepEqual(base.EMAIL.sent, []);
});

/** Posts the contact form from an IP address, and gives the code. */
async function from(env: FakeEnv, id: string, ip: string | undefined): Promise<string> {
  const fields = id === 'booking' ? BOOKING : CONTACT;
  const headers = ip === undefined ? JSON_ACCEPT : { ...JSON_ACCEPT, 'cf-connecting-ip': ip };
  const body = JSON.parse(await (await handleForm(post(id, fields, headers), id, SETTINGS, env)).text()) as {
    code?: string;
  };
  return body.code ?? 'sent';
}

/** Sends the posts one after the other, so that the order of the counts is fixed. */
async function inTurn(count: number, send: () => Promise<string>): Promise<string[]> {
  const codes: string[] = [];
  for (let index = 0; index < count; index += 1) codes.push(await send());
  return codes;
}

test('the limiters count each key: 3 in 60 s for each IP address, 20 in 60 s for each form', async () => {
  const env = fakeEnv();
  assert.deepEqual(await inTurn(5, () => from(env, 'contact', '192.0.2.1')), [
    'sent',
    'sent',
    'sent',
    'rate_limited',
    'rate_limited',
  ]);
  // Another address has its own count. So has every form: the IP key holds no form id.
  assert.equal(await from(env, 'contact', '192.0.2.2'), 'sent');
  assert.equal(await from(env, 'booking', '192.0.2.1'), 'rate_limited', 'the IP limit covers every form');
  assert.deepEqual(
    [...env.FORM_RATE_LIMIT.counts],
    [
      [`${HOST}:ip:192.0.2.1`, 6],
      [`${HOST}:ip:192.0.2.2`, 1],
    ],
  );
  // The form limiter counts only the requests that the IP limiter let pass (owner decision of M7, 9.1 step 9).
  assert.deepEqual([...env.FORM_RATE_LIMIT_ALL.counts], [[`${HOST}:form:contact`, 4]]);
  assert.equal(env.EMAIL.sent.length, 4);

  // 20 posts of one form from 20 addresses pass, the 21st does not, and another form still has its budget.
  const all = fakeEnv();
  const codes: string[] = [];
  for (let index = 1; index <= 21; index += 1) codes.push(await from(all, 'contact', `198.51.100.${index}`));
  assert.deepEqual(codes, [...Array(20).fill('sent'), 'rate_limited']);
  assert.equal(await from(all, 'booking', '198.51.100.1'), 'sent', 'one form cannot use up the budget of another');

  // With no `cf-connecting-ip`, the key holds `unknown`.
  const unknown = fakeEnv();
  await from(unknown, 'contact', undefined);
  await from(unknown, 'contact', '');
  assert.deepEqual(unknown.FORM_RATE_LIMIT.keys, [`${HOST}:ip:unknown`, `${HOST}:ip:unknown`]);
});

test('a request refused for its IP address uses no budget of the form, so one client cannot lock a form', async () => {
  const env = fakeEnv();
  const attacker = await inTurn(22, () => from(env, 'contact', '203.0.113.7'));
  assert.deepEqual(attacker, [...Array(3).fill('sent'), ...Array(19).fill('rate_limited')]);
  assert.deepEqual([...env.FORM_RATE_LIMIT_ALL.counts], [[`${HOST}:form:contact`, 3]]);
  assert.equal(await from(env, 'contact', '198.51.100.9'), 'sent', 'a visitor from another address');
  // Seven addresses with three posts each use up the 20 of the form; the 21st post is refused.
  const many = fakeEnv();
  const codes: string[] = [];
  for (let host = 1; host <= 7; host += 1)
    codes.push(...(await inTurn(3, () => from(many, 'contact', `192.0.2.${host}`))));
  assert.deepEqual(codes, [...Array(20).fill('sent'), 'rate_limited']);
});

test('the IP key: IPv4 whole, IPv6 by its /64 prefix, an IPv4-mapped address as IPv4, else unknown', () => {
  const cases: readonly (readonly [string | null, string])[] = [
    ['192.0.2.1', '192.0.2.1'],
    [' 192.0.2.1 ', '192.0.2.1'],
    ['010.000.002.001', '10.0.2.1'],
    ['2001:db8:1:2::1', '2001:db8:1:2::/64'],
    ['2001:DB8:1:2:FFFF:FFFF:FFFF:FFFF', '2001:db8:1:2::/64'],
    ['2001:0db8:0001:0002:0000:0000:0000:0001', '2001:db8:1:2::/64'],
    ['2001:db8:1:3::1', '2001:db8:1:3::/64'],
    ['2001:db8::1', '2001:db8:0:0::/64'],
    ['::1', '0:0:0:0::/64'],
    ['::', '0:0:0:0::/64'],
    ['1:2:3:4:5:6:7::', '1:2:3:4::/64'],
    ['1:2:3:4:5:6:192.0.2.1', '1:2:3:4::/64'],
    ['::ffff:192.0.2.1', '192.0.2.1'],
    ['::ffff:c000:201', '192.0.2.1'],
    [null, 'unknown'],
    ['', 'unknown'],
    ['unknown', 'unknown'],
    ['256.0.0.1', 'unknown'],
    ['192.0.2', 'unknown'],
    ['1:2:3:4:5:6:7:8:9', 'unknown'],
    ['1:2:3:4:5:6:7', 'unknown'],
    ['1::2::3', 'unknown'],
    ['1:2:3:4:5:6:7:8::', 'unknown'],
    ['12345::1', 'unknown'],
    ['2001:db8::1%eth0', 'unknown'],
    ['[2001:db8::1]', 'unknown'],
    ['g::1', 'unknown'],
  ];
  assert.deepEqual(
    cases.map(([ip]) => [ip, ipKey(ip)]),
    cases,
  );
});

test('two IPv6 addresses in one /64 share the IP count; another /64 has its own', async () => {
  const env = fakeEnv();
  const one = ['2001:db8:1:2::1', '2001:db8:1:2::2', '2001:db8:1:2:aaaa::7', '2001:db8:1:2::ffff'];
  const codes: string[] = [];
  for (const ip of one) codes.push(await from(env, 'contact', ip));
  assert.deepEqual(codes, ['sent', 'sent', 'sent', 'rate_limited']);
  assert.equal(await from(env, 'contact', '2001:db8:1:3::1'), 'sent');
  assert.deepEqual(
    [...env.FORM_RATE_LIMIT.counts],
    [
      [`${HOST}:ip:2001:db8:1:2::/64`, 4],
      [`${HOST}:ip:2001:db8:1:3::/64`, 1],
    ],
  );
});

/** A limiter that throws at once, before it gives a promise. */
const throwing = (keys: string[]): RateLimit => ({
  limit(options: { key: string }): Promise<unknown> {
    keys.push(options.key);
    throw new Error('the limiter threw at once');
  },
});

test('a limiter that throws at once counts as rate_limited, and the order of the two calls holds', async () => {
  // The IP limiter throws: the form limiter is never called, so the form keeps its budget.
  const first = fakeEnv();
  const tried: string[] = [];
  const env1 = { ...first, FORM_RATE_LIMIT: throwing(tried) };
  const answer1 = await handleForm(post('contact', CONTACT, JSON_ACCEPT), 'contact', SETTINGS, env1);
  assert.deepEqual([answer1.status, await answer1.text()], [429, '{"ok":false,"code":"rate_limited"}']);
  assert.deepEqual([tried, first.FORM_RATE_LIMIT_ALL.keys, first.EMAIL.sent], [[`${HOST}:ip:unknown`], [], []]);
  // The form limiter throws: the IP key was counted first, and no mail goes out.
  const second = fakeEnv();
  const formTried: string[] = [];
  const env2 = { ...second, FORM_RATE_LIMIT_ALL: throwing(formTried) };
  const answer2 = await handleForm(post('contact', CONTACT, JSON_ACCEPT), 'contact', SETTINGS, env2);
  assert.equal(answer2.status, 429);
  assert.deepEqual(
    [second.FORM_RATE_LIMIT.keys, formTried, second.EMAIL.sent],
    [[`${HOST}:ip:unknown`], [`${HOST}:form:contact`], []],
  );
  // A limiter that rejects counts the same.
  const third = fakeEnv();
  third.FORM_RATE_LIMIT_ALL.fails = true;
  assert.equal((await handleForm(post('contact', CONTACT, JSON_ACCEPT), 'contact', SETTINGS, third)).status, 429);
  // A limiter whose answer has no `success: true` refuses.
  const odd = fakeEnv();
  const env4 = { ...odd, FORM_RATE_LIMIT: { limit: () => Promise.resolve({ success: 'yes' }) } };
  assert.equal((await handleForm(post('contact', CONTACT, JSON_ACCEPT), 'contact', SETTINGS, env4)).status, 429);
});

test('a site with www. keys its limits by the host without www.', async () => {
  const env = fakeEnv();
  const www = { ...SETTINGS, site: `https://www.${HOST}` };
  await handleForm(post('contact', CONTACT, { 'cf-connecting-ip': '192.0.2.9' }), 'contact', www, env);
  assert.deepEqual(
    [env.FORM_RATE_LIMIT.keys, env.FORM_RATE_LIMIT_ALL.keys],
    [[`${HOST}:ip:192.0.2.9`], [`${HOST}:form:contact`]],
  );
});

test('the mail: from contact.from, to the form recipient, replyTo the first email field, the subject of the locale', async () => {
  const env = fakeEnv();
  await handleForm(post('contact', CONTACT), 'contact', SETTINGS, env);
  await handleForm(post('booking', BOOKING), 'booking', SETTINGS, env);
  const own = {
    ...SETTINGS,
    forms: { ...SETTINGS.forms, contact: { to: `rezeption@${HOST}`, fields: SETTINGS.forms?.contact?.fields ?? [] } },
  };
  await handleForm(post('contact', { ...CONTACT, return: '/en/contact/' }), 'contact', own, env);
  assert.deepEqual(
    env.EMAIL.sent.map(({ text: _, ...rest }) => rest),
    [
      {
        from: `form@${HOST}`,
        to: `info@${HOST}`,
        subject: 'Nachricht über das Formular der Website: contact',
        replyTo: 'anna@example.com',
      },
      {
        from: `form@${HOST}`,
        to: `info@${HOST}`,
        subject: 'Message via le formulaire du site: booking',
        replyTo: 'jean@example.com',
      },
      {
        from: `form@${HOST}`,
        to: `rezeption@${HOST}`,
        subject: 'Message through the website form: contact',
        replyTo: 'anna@example.com',
      },
    ],
  );
  // The text never repeats in a header, and no header holds a line break.
  for (const mail of env.EMAIL.sent) {
    for (const value of [mail.from, mail.to, mail.subject, mail.replyTo ?? '']) assert.doesNotMatch(value, /[\r\n]/);
  }
  // An optional first email field that is empty gives no replyTo.
  const optional = {
    ...SETTINGS,
    forms: {
      note: {
        to: `info@${HOST}`,
        fields: [
          { name: 'email', type: 'email' as const, required: false, maxLength: 254, autocomplete: 'email' },
          { name: 'message', type: 'textarea' as const, required: true, maxLength: 5000, autocomplete: 'off' },
        ],
      },
    },
  };
  const quiet = fakeEnv();
  await handleForm(post('note', { return: '/', email: '', message: 'Hallo' }), 'note', optional, quiet);
  assert.deepEqual(Object.keys(quiet.EMAIL.sent[0] ?? {}).sort(), ['from', 'subject', 'text', 'to']);
});

test('the probe header is x-kit-probe-token: Cloudflare redacts a header whose name holds token (13.1 item 77)', () => {
  assert.equal(PROBE_HEADER, 'x-kit-probe-token');
  assert.match(PROBE_HEADER, /token/);
  assert.equal(PROBE_HEADER, PROBE_HEADER.toLowerCase());
});

test('the probe: with contact.probe and the secret, a matching probe header sends the mail to the probe inbox', async () => {
  const SECRET = 'Zr7-probe-secret-value';
  const toOf = async (
    settings: FormSettings,
    secret: string | undefined,
    header: string | undefined,
    name: string = PROBE_HEADER,
  ) => {
    const env = fakeEnv(secret);
    const headers = header === undefined ? {} : { [name]: header };
    await handleForm(post('contact', CONTACT, headers), 'contact', settings, env);
    return env.EMAIL.sent[0]?.to;
  };
  assert.equal(await toOf(WITH_PROBE, SECRET, SECRET), PROBE_ADDRESS, 'probe on');
  assert.equal(await toOf(WITH_PROBE, SECRET, `${SECRET}x`), `info@${HOST}`, 'a wrong header');
  assert.equal(await toOf(WITH_PROBE, SECRET, SECRET.slice(0, -1)), `info@${HOST}`, 'a prefix of the secret');
  assert.equal(await toOf(WITH_PROBE, SECRET, undefined), `info@${HOST}`, 'no header');
  assert.equal(await toOf(WITH_PROBE, undefined, SECRET), `info@${HOST}`, 'no secret in the env');
  assert.equal(await toOf(WITH_PROBE, '', ''), `info@${HOST}`, 'an empty secret is no secret');
  assert.equal(await toOf(SETTINGS, SECRET, SECRET), `info@${HOST}`, 'no contact.probe: probe off');
  assert.equal(await toOf(WITH_PROBE, SECRET, SECRET, 'x-kit-probe'), `info@${HOST}`, 'the old header name');
  // The probe skips the IP limiter and counts against the form, and its mail keeps the subject of the form.
  const env = fakeEnv(SECRET);
  await handleForm(post('contact', CONTACT, { [PROBE_HEADER]: SECRET }), 'contact', WITH_PROBE, env);
  assert.deepEqual([env.FORM_RATE_LIMIT.keys, env.FORM_RATE_LIMIT_ALL.keys], [[], [`${HOST}:form:contact`]]);
  assert.equal(env.EMAIL.sent[0]?.subject, 'Nachricht über das Formular der Website: contact');
  // A wrong header is a plain post: it goes through the IP limiter.
  const wrong = fakeEnv(SECRET);
  await handleForm(post('contact', CONTACT, { [PROBE_HEADER]: 'nope' }), 'contact', WITH_PROBE, wrong);
  assert.deepEqual(wrong.FORM_RATE_LIMIT.keys, [`${HOST}:ip:unknown`]);
});

test('the probe of smoke reaches every form from one runner address, also past the 3 of the IP limit', async () => {
  const SECRET = 's3cret';
  const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'];
  const contact = WITH_PROBE.forms?.contact;
  if (contact === undefined) throw new Error('the fixture has no contact form');
  const ten: FormSettings = { ...WITH_PROBE, forms: Object.fromEntries(ids.map((id) => [id, contact])) };
  const env = fakeEnv(SECRET);
  const runner = { [PROBE_HEADER]: SECRET, 'cf-connecting-ip': '198.51.100.7', origin: `https://${HOST}` };
  const smoke = { return: '/', name: 'astro-kit probe', email: `probe@${HOST}`, message: 'Weekly delivery probe.' };
  const locations: (string | null)[] = [];
  for (const id of ids) {
    locations.push((await handleForm(post(id, smoke, runner), id, ten, env)).headers.get('location'));
  }
  assert.deepEqual(locations, Array(10).fill('/#sent'));
  assert.deepEqual(
    env.EMAIL.sent.map((mail) => mail.to),
    Array(10).fill(PROBE_ADDRESS),
  );
  assert.deepEqual(env.FORM_RATE_LIMIT.keys, [], 'the probe skips the IP limiter');
  assert.deepEqual(
    env.FORM_RATE_LIMIT_ALL.keys,
    ids.map((id) => `${HOST}:form:${id}`),
  );
  // A probe still counts against the form: with the 20 of a form used up, it is refused.
  const full = fakeEnv(SECRET);
  full.FORM_RATE_LIMIT_ALL.counts.set(`${HOST}:form:contact`, 20);
  const refused = await handleForm(
    post('contact', CONTACT, { [PROBE_HEADER]: SECRET, ...JSON_ACCEPT }),
    'contact',
    WITH_PROBE,
    full,
  );
  assert.deepEqual([refused.status, full.EMAIL.sent], [429, []]);
});

test('replyTo is set only for a valid e-mail address of HTML; any other value stays in the text alone', async () => {
  const replyOf = async (email: string) => {
    const env = fakeEnv();
    const answer = await handleForm(post('contact', { ...CONTACT, email }, JSON_ACCEPT), 'contact', SETTINGS, env);
    const mail = env.EMAIL.sent[0];
    return [
      answer.status,
      mail === undefined ? 'no mail' : (mail.replyTo ?? 'none'),
      mail?.text.includes(`email: ${email}\n`),
    ];
  };
  const cases: readonly (readonly [string, readonly unknown[]])[] = [
    ['anna@example.com', [200, 'anna@example.com', true]],
    ["o'brien+tag@mail.example.ch", [200, "o'brien+tag@mail.example.ch", true]],
    ['=?utf-8?b?QQ==?=@b.ch', [200, '=?utf-8?b?QQ==?=@b.ch', true]],
    // The pattern of 5.2 lets these pass step 7, and the pattern of HTML keeps them out of the header.
    ['<x@y.z>', [200, 'none', true]],
    ['x<a@b.c>', [200, 'none', true]],
    ['a,b@c.ch', [200, 'none', true]],
    ['a@b.ch,x', [200, 'none', true]],
    ['"a"@b.ch', [200, 'none', true]],
    ['a,b<attacker@evil.example>', [200, 'none', true]],
    ['staff:attacker@evil.example;', [200, 'none', true]],
    ['g:x@evil.com;', [200, 'none', true]],
    ['zoë@example.ch', [200, 'none', true]],
    ['anna@-example.ch', [200, 'none', true]],
    // Step 7 refuses these, so no mail goes out.
    ['a\u202e@b.ch', [400, 'no mail', undefined]],
    ['a@b.ch\u2028Bcc: x@y.z', [400, 'no mail', undefined]],
    ['a@b.ch\r\nBcc: x@y.z', [400, 'no mail', undefined]],
    ['a@b.ch\u0085', [400, 'no mail', undefined]],
  ];
  const answers: unknown[] = [];
  for (const [email] of cases) answers.push([email, await replyOf(email)]);
  assert.deepEqual(answers, cases);
});

test('the log holds the code only, never form content or the secret', async () => {
  const marker = 'MARKER-7b4d';
  const env = fakeEnv(marker);
  env.EMAIL.fails = true;
  await handleForm(
    post('contact', { ...CONTACT, name: marker, message: marker }, { [PROBE_HEADER]: marker }),
    'contact',
    SETTINGS,
    env,
  );
  await handleForm(post('contact', { ...CONTACT, email: marker }), 'contact', SETTINGS, fakeEnv());
  assert.deepEqual(warnings, ['astro-kit form: send_failed', 'astro-kit form: invalid']);
});

test('createFormEndpoint loads the settings and the env once, and passes the route parameter as the form id', async () => {
  const env = fakeEnv();
  let loads = 0;
  const endpoint = createFormEndpoint(() => {
    loads += 1;
    return Promise.resolve({ settings: SETTINGS, env });
  });
  const call = (id: string | undefined, request: Request) => endpoint({ params: { form: id }, request });
  const first = await call('contact', post('contact', CONTACT));
  const second = await call('booking', post('booking', BOOKING, JSON_ACCEPT));
  const third = await call(undefined, post('contact', CONTACT, JSON_ACCEPT));
  assert.deepEqual(
    [first.status, first.headers.get('location'), second.status, third.status],
    [303, '/kontakt/#sent', 200, 404],
  );
  assert.equal(loads, 1);
  assert.equal(env.EMAIL.sent.length, 2);
});

test('a load that fails answers no_binding with the five headers, logs its message, and is tried again', async () => {
  let attempts = 0;
  const flaky = createFormEndpoint(() => {
    attempts += 1;
    if (attempts === 1) return Promise.reject(new Error("Cannot find module 'virtual:astro-kit'"));
    if (attempts === 2) throw new Error('cloudflare:workers is missing');
    return Promise.resolve({ settings: SETTINGS, env: fakeEnv() });
  });
  const call = (request: Request) => flaky({ params: { form: 'contact' }, request });
  const redirect = await call(post('contact', { ...CONTACT, message: 'SECRET-TEXT' }));
  const json = await call(post('contact', CONTACT, JSON_ACCEPT));
  assert.deepEqual(
    [redirect.status, redirect.headers.get('location'), json.status, await json.text()],
    [303, '/#not-sent', 503, '{"ok":false,"code":"no_binding"}'],
  );
  for (const answer of [redirect, json]) {
    for (const [name, value] of FIVE_HEADERS) assert.equal(answer.headers.get(name), value, name);
    assert.equal(answer.headers.get('cache-control'), 'private, no-store');
  }
  assert.deepEqual(warnings, ['astro-kit form: no_binding', 'astro-kit form: no_binding']);
  assert.deepEqual(errors, [
    "astro-kit form: the runtime did not load: Cannot find module 'virtual:astro-kit'",
    'astro-kit form: the runtime did not load: cloudflare:workers is missing',
  ]);
  // The third request loads, and the form is sent.
  const sent = await call(post('contact', CONTACT));
  assert.deepEqual([sent.status, sent.headers.get('location'), attempts], [303, '/kontakt/#sent', 3]);
});

test('the handler fits the APIRoute of Astro, so the shim needs no cast', () => {
  const route: APIRoute = createFormEndpoint(() => Promise.resolve({ settings: SETTINGS, env: fakeEnv() }));
  assert.equal(typeof route, 'function');
});

test('the body cap of a form holds the largest body that a browser sends for it, and one byte more fails', async () => {
  // Every field at its maxLength with a character of three UTF-8 bytes: 9 B a code unit in an urlencoded body.
  const worst = {
    return: '/kontakt/',
    website: '',
    name: '日'.repeat(200),
    email: `${'日'.repeat(248)}@日.日日`,
    message: '日\r\n'.repeat(2_500),
  };
  const body = new URLSearchParams(worst).toString();
  assert.ok(body.length <= CONTACT_CAP, `${body.length} B`);
  const sent = await handleForm(post('contact', worst, JSON_ACCEPT), 'contact', SETTINGS, fakeEnv());
  assert.deepEqual([sent.status, await sent.text()], [200, '{"ok":true}']);
  // The same in multipart is smaller still.
  const multipart = new FormData();
  for (const [name, value] of Object.entries(worst)) multipart.append(name, value);
  const encoded = new Request('https://x.example/', { method: 'POST', body: multipart });
  assert.ok((await encoded.arrayBuffer()).byteLength <= CONTACT_CAP);
  // A body of exactly the cap passes, also streamed without a length, and one byte more is too_large.
  const padded = { ...worst, pad: '' };
  const pad = CONTACT_CAP - new URLSearchParams(padded).toString().length;
  const exact = { ...padded, pad: 'a'.repeat(pad) };
  assert.equal(new URLSearchParams(exact).toString().length, CONTACT_CAP);
  const atCap = await handleForm(post('contact', exact, JSON_ACCEPT), 'contact', SETTINGS, fakeEnv());
  assert.equal(atCap.status, 200);
  const over = await handleForm(
    post('contact', { ...exact, pad: `${exact.pad}a` }, JSON_ACCEPT),
    'contact',
    SETTINGS,
    fakeEnv(),
  );
  assert.equal(over.status, 413);
  const streamedOver = streamed('contact', CONTACT_CAP + 1, { bytes: 0, cancelled: false });
  streamedOver.headers.set('accept', 'application/json');
  assert.equal((await handleForm(streamedOver, 'contact', SETTINGS, fakeEnv())).status, 413);
});

test('capOf: each form has its own cap, and an id that no form declares gets the largest one', () => {
  const booking = bodyCap(SETTINGS.forms?.booking?.fields ?? []);
  assert.equal(capOf(SETTINGS, 'booking'), booking);
  assert.equal(capOf(SETTINGS, 'contact'), CONTACT_CAP);
  assert.ok(booking < CONTACT_CAP);
  assert.equal(capOf(SETTINGS, 'newsletter'), CONTACT_CAP);
  assert.equal(capOf(SETTINGS, undefined), CONTACT_CAP);
});

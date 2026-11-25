/**
 * The unit tests of the form endpoint, part one (specification, 9.1, and 14, M7): the fixed values, the field
 * validation of step 7, the parts of steps 1 to 5, the answer mode, the probe compare and the mail text.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mock, test } from 'node:test';
import {
  checkForm,
  FORM_ACTION_PREFIX,
  FORM_HEADERS,
  formAction,
  HONEYPOT,
  hasFilePart,
  isValidReturn,
  isValidValue,
  MAX_BODY_BYTES,
  MAX_RETURN_CHARS,
  mailSubject,
  mailText,
  mediaParameters,
  NO_STORE,
  NOT_VERIFIED,
  normalizeValue,
  parseBody,
  probeMatches,
  RETURN_FIELD,
  readCapped,
  SUBJECTS,
  sameBytes,
  validateFields,
  wantsJson,
} from '../../src/forms/index.ts';
import { HSTS } from '../../src/hosts/cloudflare.ts';
import type { FormField } from '../../src/options.ts';
import { optionsOf } from './fixtures.ts';
import { BOOKING, CONTACT, FIVE_HEADERS, post, SETTINGS, SITE_FORMS, streamed, URLENCODED } from './forms-fixtures.ts';
import { SPEC, specBlock } from './spec.ts';

test('the fixed values of 9.1', () => {
  assert.equal(FORM_ACTION_PREFIX, '/api/forms/');
  assert.equal(formAction('booking'), '/api/forms/booking/');
  assert.equal(MAX_BODY_BYTES, 32_768);
  assert.equal(HONEYPOT, 'website');
  assert.equal(RETURN_FIELD, 'return');
  assert.equal(MAX_RETURN_CHARS, 512);
  assert.equal(NO_STORE, 'private, no-store');
  assert.deepEqual(
    [...FORM_HEADERS].map(([name, value]) => [name.toLowerCase(), value]),
    FIVE_HEADERS,
  );
  // The HSTS value is the one of `_headers` (6.3).
  assert.equal(FORM_HEADERS.get('Strict-Transport-Security'), HSTS);
  for (const [name, value] of FORM_HEADERS) assert.ok(SPEC.includes(`\`${name}: ${value}\``), name);
  assert.deepEqual(
    [...SUBJECTS],
    [
      ['de', 'Nachricht über das Formular der Website'],
      ['fr', 'Message via le formulaire du site'],
      ['it', 'Messaggio dal modulo del sito'],
      ['en', 'Message through the website form'],
    ],
  );
  assert.equal(mailSubject('fr', 'booking'), 'Message via le formulaire du site: booking');
  assert.equal(mailSubject('rm', 'contact'), 'Message through the website form: contact', 'another locale: English');
  assert.equal(NOT_VERIFIED, specBlock('- Text:', 'text').split('\n')[0]);
});

test('the feature shim of the template is the exact block of 9.1', () => {
  const template = readFileSync(
    new URL('../../templates/features/forms/src/pages/api/forms/[form].ts', import.meta.url),
    'utf8',
  );
  assert.equal(template, `${specBlock('The project file is a fixed feature shim', 'ts')}\n`);
});

// Step 7: the fields

const field = (type: FormField['type'], more: Partial<FormField> = {}): FormField => ({
  name: 'x',
  type,
  required: true,
  autocomplete: 'off',
  ...more,
});

test('normalizeValue turns CRLF and CR into LF, then trims', () => {
  assert.equal(normalizeValue(' a\r\nb\rc\n '), 'a\nb\nc');
  assert.equal(normalizeValue('\r\n\r\n'), '');
  assert.equal(normalizeValue(' x '), 'x', 'trim removes white space of Unicode too');
});

test('step 7: a line break counts as one character against maxLength, also as CRLF or CR', () => {
  const textarea = field('textarea', { maxLength: 5 });
  const valid = (raw: string): boolean => validateFields([textarea], new Map([['x', raw]])).invalid.length === 0;
  assert.equal(valid('ab\r\ncd'), true, 'CRLF is one character: 5');
  assert.equal(valid('ab\rcd'), true, 'CR is one character: 5');
  assert.equal(valid('ab\ncd'), true, 'LF: 5');
  assert.equal(valid('ab\r\ncde'), false, 'CRLF and 4 letters: 6');
  assert.equal(valid('abcdef'), false);
  // The length counts UTF-16 code units, as the maxlength of a browser does.
  assert.equal(valid('ab😀c'), true, '5 code units');
  assert.equal(valid('ab😀cd'), false, '6 code units');
});

test('step 7: a control character fails, except tab and line feed in a textarea', () => {
  const cases: readonly (readonly [FormField['type'], string, boolean])[] = [
    ['textarea', 'a\tb', true],
    ['textarea', 'a\nb', true],
    ['textarea', 'a\r\nb', true],
    ['textarea', 'a\u0007b', false],
    ['textarea', 'a\u0000b', false],
    ['textarea', 'a\u007fb', false],
    ['textarea', 'a\u0085b', false],
    ['text', 'a\tb', false],
    ['text', 'a\nb', false],
    ['text', 'a\r\nb', false],
    ['text', 'a\rb', false],
    ['text', 'a\u001bb', false],
    ['text', 'a\u007fb', false],
    ['text', 'a\u0085b', false],
    ['text', 'a\u009fb', false],
    ['email', 'a@b.ch\n', true],
    ['email', 'a@b.ch\nBcc: c@d.ch', false],
    ['tel', '+41\t81', false],
    ['text', 'Zoë 😀', true],
  ];
  const seen = cases.map(([type, raw]) => {
    const result = validateFields(
      [field(type, type === 'tel' || type === 'email' ? {} : { maxLength: 100 })],
      new Map([['x', raw]]),
    );
    return [type, raw, result.invalid.length === 0];
  });
  assert.deepEqual(seen, cases);
});

test('step 7: U+2028, U+2029 and the bidi controls fail in every field; other format characters pass', () => {
  const failing = [
    '\u2028',
    '\u2029',
    '\u202a',
    '\u202b',
    '\u202c',
    '\u202d',
    '\u202e',
    '\u2066',
    '\u2067',
    '\u2068',
    '\u2069',
  ];
  const passing = ['\u00ad', '\u200c', '\u200d', '\u200e', '\u200f', '\u2060', '\ufeff'];
  const seen: (readonly [string, string, boolean])[] = [];
  for (const type of ['text', 'textarea'] as const) {
    for (const character of [...failing, ...passing]) {
      const result = validateFields([field(type, { maxLength: 100 })], new Map([['x', `A${character}B`]]));
      seen.push([type, character, result.invalid.length === 0]);
    }
  }
  const email = validateFields([field('email', { maxLength: 254 })], new Map([['x', 'a\u2066@b.ch']]));
  assert.deepEqual(email.invalid, ['x'], 'an email field too');
  assert.deepEqual(
    seen,
    (['text', 'textarea'] as const).flatMap((type) => [
      ...failing.map((character) => [type, character, false] as const),
      ...passing.map((character) => [type, character, true] as const),
    ]),
  );
  // A real name with a soft hyphen and an emoji with ZWJ still passes.
  assert.deepEqual(
    validateFields([field('text', { maxLength: 100 })], new Map([['x', 'Zoë Mül\u00adler 👩\u200d💻']])).invalid,
    [],
  );
});

test('step 7: each type checks its value', () => {
  const cases: readonly (readonly [string, FormField, string, boolean])[] = [
    ['an email', field('email', { maxLength: 254 }), 'anna@example.com', true],
    ['an email with no dot after @', field('email', { maxLength: 254 }), 'anna@example', false],
    ['an email with two @', field('email', { maxLength: 254 }), 'a@b@c.ch', false],
    ['an email with a space', field('email', { maxLength: 254 }), 'a b@c.ch', false],
    ['an email over maxLength', field('email', { maxLength: 10 }), 'anna@example.com', false],
    ['a tel', field('tel', { maxLength: 32 }), '+41 (81) 555-01.10/1', true],
    ['a tel with a letter', field('tel', { maxLength: 32 }), '+41 81 555 01 1x', false],
    ['a tel of 4 characters', field('tel', { maxLength: 32 }), '1234', false],
    ['a tel with a + inside', field('tel', { maxLength: 32 }), '41+81555', false],
    ['a date', field('date'), '2027-02-28', true],
    ['a date that does not exist', field('date'), '2027-02-29', false],
    ['a date in another form', field('date'), '28.02.2027', false],
    ['a date at min', field('date', { min: '2027-01-01', max: '2027-12-31' }), '2027-01-01', true],
    ['a date before min', field('date', { min: '2027-01-01' }), '2026-12-31', false],
    ['a date after max', field('date', { max: '2027-12-31' }), '2028-01-01', false],
    ['a number', field('number', { min: 1, max: 14 }), '14', true],
    ['a number below min', field('number', { min: 1, max: 14 }), '0', false],
    ['a number above max', field('number', { min: 1, max: 14 }), '15', false],
    ['a decimal number', field('number', { min: 1, max: 14 }), '2.5', true],
    ['a number with an exponent', field('number', { min: 1, max: 14 }), '1e1', true],
    ['a number that is not one', field('number', { min: 1, max: 14 }), '3 Nächte', false],
    ['a number in hex', field('number', { min: 0, max: 100 }), '0x10', false],
    ['Infinity', field('number', { min: 0, max: 100 }), 'Infinity', false],
    ['a number with a +', field('number', { min: 0, max: 100 }), '+5', false],
    ['a choice', field('choice', { options: ['single', 'double'] }), 'double', true],
    ['a value that is no option', field('choice', { options: ['single', 'double'] }), 'suite', false],
    ['an option of another letter case', field('choice', { options: ['single', 'double'] }), 'Double', false],
    ['a consent', field('consent'), 'on', true],
    ['a consent with any value', field('consent'), 'yes', true],
    ['a text', field('text', { maxLength: 3 }), 'abc', true],
    ['a text over maxLength', field('text', { maxLength: 3 }), 'abcd', false],
  ];
  assert.deepEqual(
    cases.map(([name, declared, value]) => [name, isValidValue(declared, value)]),
    cases.map(([name, , , valid]) => [name, valid]),
  );
});

test('step 7: a required field needs a value after the trim, and an empty optional field is valid', () => {
  const fields = [
    field('text', { name: 'name', maxLength: 200 }),
    field('tel', { name: 'tel', required: false, maxLength: 32 }),
    field('consent', { name: 'terms' }),
    field('number', { name: 'nights', required: false, min: 1, max: 14 }),
  ];
  const result = validateFields(
    fields,
    new Map([
      ['name', '  \r\n '],
      ['tel', ' '],
      ['nights', 'x'],
    ]),
  );
  assert.deepEqual(result.invalid, ['name', 'terms', 'nights'], 'in declared order');
  assert.deepEqual(
    [...result.values],
    [
      ['name', ''],
      ['tel', ''],
      ['terms', ''],
      ['nights', 'x'],
    ],
  );
  const passing = validateFields(
    fields,
    new Map([
      ['name', ' Anna '],
      ['terms', 'on'],
      ['other', '\u0000'],
    ]),
  );
  assert.deepEqual(passing.invalid, [], 'a key that no field declares is ignored');
  assert.equal(passing.values.get('name'), 'Anna');
  assert.equal(passing.values.has('other'), false);
});

// Steps 1 to 5

test('readCapped holds at most 32,768 B and cancels the stream past them', async () => {
  const exact = { bytes: 0, cancelled: false };
  const body = await readCapped(streamed('contact', MAX_BODY_BYTES, exact));
  assert.equal(body?.byteLength, MAX_BODY_BYTES, 'exactly the cap passes');
  assert.equal(exact.cancelled, false);

  const over = { bytes: 0, cancelled: false };
  assert.equal(await readCapped(streamed('contact', 10 * MAX_BODY_BYTES, over)), undefined);
  assert.equal(over.cancelled, true, 'the stream is cancelled');
  // The reader stops at the chunk that passes the cap: the stream had at most one chunk of 4,096 B queued beyond it.
  assert.ok(over.bytes <= MAX_BODY_BYTES + 2 * 4_096, `read ${over.bytes} B`);

  const one = { bytes: 0, cancelled: false };
  assert.equal(await readCapped(streamed('contact', MAX_BODY_BYTES + 1, one)), undefined, 'one byte more fails');
  assert.equal(one.cancelled, true);

  const empty = new Request('https://x.example/', { method: 'POST' });
  assert.equal((await readCapped(empty))?.byteLength, 0, 'no body is an empty body');

  const failing = new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.error(new Error('the client went away'));
    },
  });
  const init: RequestInit & { duplex: 'half' } = { method: 'POST', body: failing, duplex: 'half' };
  assert.equal(await readCapped(new Request('https://x.example/', init)), undefined, 'a stream that fails');
});

const bytes = (text: string): Uint8Array<ArrayBuffer> => new TextEncoder().encode(text);

test('parseBody reads urlencoded and multipart only; a file rejects; the first value of a key wins', async () => {
  const urlencoded = await parseBody(bytes('a=1&b=%C3%A4&a=2&c'), URLENCODED);
  assert.deepEqual(
    [...(urlencoded ?? [])],
    [
      ['a', '1'],
      ['b', 'ä'],
      ['c', ''],
    ],
  );
  assert.deepEqual(
    [...((await parseBody(bytes('a=1'), `${URLENCODED.toUpperCase()}; charset=UTF-8`)) ?? [])],
    [['a', '1']],
  );
  const boundary = 'kitboundary';
  const part = (name: string, value: string, file = ''): string =>
    `--${boundary}\r\nContent-Disposition: form-data; name="${name}"${file}\r\n\r\n${value}\r\n`;
  const multipart = `multipart/form-data; boundary=${boundary}`;
  const fields = await parseBody(
    bytes(`${part('a', 'x')}${part('a', 'y')}${part('b', 'z')}--${boundary}--\r\n`),
    multipart,
  );
  assert.deepEqual(
    [...(fields ?? [])],
    [
      ['a', 'x'],
      ['b', 'z'],
    ],
  );
  const withFile = `${part('a', 'x')}${part('f', 'data', '; filename="a.txt"')}--${boundary}--\r\n`;
  assert.equal(await parseBody(bytes(withFile), multipart), undefined, 'a file value rejects');
  const emptyFile = `${part('f', '', '; filename=""')}--${boundary}--\r\n`;
  assert.equal(await parseBody(bytes(emptyFile), multipart), undefined, 'an empty file input rejects too');
  assert.equal(await parseBody(bytes('broken'), multipart), undefined, 'a multipart body that does not parse');
  assert.equal(await parseBody(bytes('a=1'), 'multipart/form-data'), undefined, 'multipart with no boundary');
  for (const type of ['application/json', 'text/plain', '', 'application/x-www-form-urlencodedx']) {
    assert.equal(await parseBody(bytes('a=1'), type), undefined, type);
  }
  assert.equal(await parseBody(bytes('a=1'), null), undefined, 'no content type');
  assert.equal(await parseBody(bytes('a=1'), `${URLENCODED}\u0000`), undefined, 'a content type that Headers refuses');
});

test('step 3: the kit reads the part headers itself, so a file name rejects whatever the parser gives', async () => {
  const boundary = '----KitBoundary7MA4YWxk';
  const multipart = `multipart/form-data; boundary=${boundary}`;
  const body = (disposition: string, value = 'FILE-CONTENT'): Uint8Array<ArrayBuffer> =>
    bytes(
      `--${boundary}\r\nContent-Disposition: form-data; name="return"\r\n\r\n/kontakt/\r\n` +
        `--${boundary}\r\n${disposition}\r\n\r\n${value}\r\n--${boundary}--\r\n`,
    );
  const cases: readonly (readonly [string, string, boolean])[] = [
    ['a text part', 'Content-Disposition: form-data; name="message"', false],
    ['an empty file name', 'Content-Disposition: form-data; name="message"; filename=""', true],
    ['an RFC 5987 file name', 'Content-Disposition: form-data; name="message"; filename*=UTF-8\'\'a.txt', true],
    ['a file name under an undeclared key', 'Content-Disposition: form-data; name="upload"; filename="a.txt"', true],
    ['in another letter case and spacing', 'content-DISPOSITION :form-data;name="message";FILENAME = ""', true],
    ['on a folded line', 'Content-Disposition: form-data; name="message";\r\n filename=""', true],
    [
      'a part with a content type and no file name',
      'Content-Disposition: form-data; name="message"\r\nContent-Type: text/plain',
      false,
    ],
  ];
  assert.deepEqual(
    cases.map(([name, disposition]) => [name, hasFilePart(body(disposition), multipart)]),
    cases.map(([name, , file]) => [name, file]),
  );
  // A value line that reads like such a header rejects too: the scan reads every line of a part.
  assert.equal(
    hasFilePart(
      body('Content-Disposition: form-data; name="message"', 'Content-Disposition: x; filename=""'),
      multipart,
    ),
    true,
  );
  // No boundary, an empty one or two of them: the body never reaches the parser.
  for (const type of ['multipart/form-data', 'multipart/form-data; boundary=', `${multipart}; boundary=other`]) {
    assert.equal(hasFilePart(body('Content-Disposition: form-data; name="message"'), type), true, type);
  }
  assert.equal(
    hasFilePart(body('Content-Disposition: form-data; name="message"'), `multipart/form-data; boundary="${boundary}"`),
    false,
    'a quoted boundary',
  );

  // The Worker's formData() gives a part with filename="" as a text (13.1 item 78). With a parser that does so,
  // the body is still refused, because the kit does not rely on the parser.
  const workerd = mock.method(Response.prototype, 'formData', () => {
    const data = new FormData();
    data.append('return', '/kontakt/');
    data.append('message', 'FILE-CONTENT');
    return Promise.resolve(data);
  });
  try {
    assert.equal(
      await parseBody(body('Content-Disposition: form-data; name="message"; filename=""'), multipart),
      undefined,
    );
    assert.equal(
      await parseBody(body('Content-Disposition: form-data; name="message"; filename*=UTF-8\'\'a.txt'), multipart),
      undefined,
    );
    assert.deepEqual(
      [...((await parseBody(body('Content-Disposition: form-data; name="message"'), multipart)) ?? [])],
      [
        ['return', '/kontakt/'],
        ['message', 'FILE-CONTENT'],
      ],
      'the same parser with no file name: the body parses',
    );
  } finally {
    workerd.mock.restore();
  }
});

test('step 3: an urlencoded body with a charset other than UTF-8 is bad_body, in Node as in the Worker', async () => {
  const cases: readonly (readonly [string, boolean])[] = [
    [URLENCODED, true],
    [`${URLENCODED}; charset=utf-8`, true],
    [`${URLENCODED}; charset=UTF-8`, true],
    [`${URLENCODED}; charset="utf-8"`, true],
    [`${URLENCODED}; charset=iso-8859-1`, false],
    [`${URLENCODED}; charset=ISO-8859-1`, false],
    [`${URLENCODED}; charset=utf8`, false],
    [`${URLENCODED}; charset=windows-1252`, false],
    [`${URLENCODED}; charset=utf-8; charset=iso-8859-1`, false],
  ];
  const seen: (readonly [string, boolean])[] = [];
  for (const [type] of cases) seen.push([type, (await parseBody(bytes('a=1'), type)) !== undefined]);
  assert.deepEqual(seen, cases);
  assert.deepEqual(
    [...mediaParameters('text/x; A=1; b="2"; a=3; c')],
    [
      ['a', ['1', '3']],
      ['b', ['2']],
    ],
  );
});

test('step 5: return is a page path of at most 512 characters, with no //, scheme or backslash', () => {
  const long = `/${'a/'.repeat(255)}`;
  assert.equal(long.length, 511);
  const cases: readonly (readonly [string, boolean])[] = [
    ['/', true],
    ['/kontakt/', true],
    ['/fr/contact/', true],
    [long, true],
    [`${long}b/`, false],
    ['/kontakt', false],
    ['kontakt/', false],
    ['//evil.example/', false],
    ['/a//b/', false],
    ['https://evil.example/', false],
    ['javascript:alert(1)/', false],
    ['/\\evil.example/', false],
    ['/Kontakt/', false],
    ['/kontakt/?x=1', false],
    ['/kontakt/#sent', false],
    ['/404.html', false],
    ['', false],
    [' /kontakt/', false],
  ];
  assert.deepEqual(
    cases.map(([page]) => [page, isValidReturn(page)]),
    cases,
  );
});

test('the answer mode: JSON when Accept lists application/json with q above 0', () => {
  const cases: readonly (readonly [string | null, boolean])[] = [
    [null, false],
    ['', false],
    ['text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', false],
    ['application/json', true],
    ['Application/JSON', true],
    ['text/html, application/json;q=0.5', true],
    ['application/json;q=0', false],
    ['application/json; q=0.000', false],
    ['application/json;q=0.001', true],
    ['application/json;q=', false],
    ['application/json;q=x', false],
    ['application/json;charset=utf-8', true],
    ['*/*', false],
    ['application/*', false],
    ['application/jsonx', false],
  ];
  assert.deepEqual(
    cases.map(([accept]) => [accept, wantsJson(accept)]),
    cases,
  );
});

// The probe compare

test('probeMatches compares the SHA-256 of both texts, so the work is the same for every length', async () => {
  assert.equal(await probeMatches('s3cret-value', 's3cret-value'), true);
  assert.equal(await probeMatches('s3cret-valuE', 's3cret-value'), false, 'one character differs');
  assert.equal(await probeMatches('s3cret', 's3cret-value'), false, 'a prefix');
  assert.equal(await probeMatches('s3cret-value-and-more', 's3cret-value'), false, 'a longer text');
  assert.equal(await probeMatches('', 's3cret-value'), false, 'an empty header');
  assert.equal(await probeMatches(null, 's3cret-value'), false, 'no header');
  assert.equal(await probeMatches('Grüezi 😀', 'Grüezi 😀'), true, 'UTF-8');

  // In the Worker the compare is `crypto.subtle.timingSafeEqual`, on the two digests of 32 bytes.
  const calls: number[][] = [];
  const subtle = Object.assign(Object.create(crypto.subtle) as SubtleCrypto, {
    digest: (algorithm: AlgorithmIdentifier, data: BufferSource) => crypto.subtle.digest(algorithm, data),
    timingSafeEqual: (a: ArrayBuffer, b: ArrayBuffer): boolean => {
      calls.push([a.byteLength, b.byteLength]);
      return Buffer.from(a).equals(Buffer.from(b));
    },
  });
  assert.equal(await probeMatches('a', 'a much longer secret', subtle), false);
  assert.equal(await probeMatches('same', 'same', subtle), true);
  assert.deepEqual(calls, [
    [32, 32],
    [32, 32],
  ]);
});

test('sameBytes, the compare where timingSafeEqual is missing, reads every byte of both, also after a difference', () => {
  /** A byte array that counts each read of an index. */
  const counted = (values: readonly number[]): { array: Uint8Array; reads: number[] } => {
    const target = Uint8Array.from(values);
    const reads: number[] = [];
    const array = new Proxy(target, {
      get(object, property) {
        if (typeof property === 'string' && /^\d+$/.test(property)) reads.push(Number(property));
        return Reflect.get(object, property);
      },
    });
    return { array, reads };
  };
  const all = Array.from({ length: 32 }, (_, index) => index);
  for (const [name, left, right, equal] of [
    ['equal', all, all, true],
    ['the first byte differs', [99, ...all.slice(1)], all, false],
    ['the last byte differs', all, [...all.slice(0, 31), 99], false],
  ] as const) {
    const a = counted(left);
    const b = counted(right);
    assert.equal(sameBytes(a.array, b.array), equal, name);
    assert.deepEqual([a.reads, b.reads], [all, all], `${name}: every byte of both is read once`);
  }
  assert.equal(sameBytes(new Uint8Array(2), new Uint8Array(3)), false, 'another length');
});

// The mail

const accepted = async (id: string, fields: Readonly<Record<string, string>>) => {
  const checked = await checkForm(post(id, fields), id, SETTINGS);
  if (!checked.ok) throw new Error(`the post was refused: ${checked.code}`);
  return mailText({
    id: checked.id,
    page: checked.page,
    locale: checked.locale,
    fields: checked.form.fields,
    values: checked.values,
  });
};

test('the mail text of the contact form, in German and in English, is byte-exact', async () => {
  assert.equal(
    await accepted('contact', CONTACT),
    [
      'Sent through the website form; the sender address is not verified.',
      '',
      'Form: contact',
      'Page: /kontakt/',
      'Locale: de',
      '',
      'name: Anna Muster',
      'email: anna@example.com',
      '',
      'message:',
      'Guten Tag',
      'Ist am 3. März ein Zimmer frei?',
      '',
    ].join('\n'),
  );
  assert.equal(
    await accepted('contact', { ...CONTACT, return: '/en/contact/', message: ' Hello,\r\n\r\n\tone room?\r\n' }),
    'Sent through the website form; the sender address is not verified.\n\nForm: contact\nPage: /en/contact/\nLocale: en\n\nname: Anna Muster\nemail: anna@example.com\n\nmessage:\nHello,\n\n\tone room?\n',
  );
});

test('the mail text of the booking form, in French and in German, is byte-exact', async () => {
  assert.equal(
    await accepted('booking', BOOKING),
    [
      'Sent through the website form; the sender address is not verified.',
      '',
      'Form: booking',
      'Page: /fr/contact/',
      'Locale: fr',
      '',
      'name: Jean Dupont',
      'email: jean@example.com',
      'tel: +41 81 555 01 99',
      'arrival: 2027-01-15',
      'nights: 3',
      'room: double',
      'terms: yes',
      '',
    ].join('\n'),
  );
  // The optional tel left empty is left out. A consent reads `yes` whatever its value.
  assert.equal(
    await accepted('booking', { ...BOOKING, return: '/kontakt/', tel: '', terms: 'ja' }),
    'Sent through the website form; the sender address is not verified.\n\nForm: booking\nPage: /kontakt/\nLocale: de\n\nname: Jean Dupont\nemail: jean@example.com\narrival: 2027-01-15\nnights: 3\nroom: double\nterms: yes\n',
  );
});

test('the mail text puts every textarea after the single-line fields, each after a blank line', () => {
  const fields: FormField[] = [
    field('textarea', { name: 'first', maxLength: 50 }),
    field('text', { name: 'name', maxLength: 50 }),
    field('textarea', { name: 'second', maxLength: 50, required: false }),
    field('textarea', { name: 'third', maxLength: 50 }),
  ];
  const values = new Map([
    ['first', 'a\nb'],
    ['name', 'N'],
    ['second', ''],
    ['third', 'c'],
  ]);
  assert.equal(
    mailText({ id: 'x', page: '/', locale: 'de', fields, values }),
    `${NOT_VERIFIED}\n\nForm: x\nPage: /\nLocale: de\n\nname: N\n\nfirst:\na\nb\n\nthird:\nc\n`,
  );
  const onlyText = mailText({ id: 'x', page: '/', locale: 'de', fields: [fields[0] ?? field('text')], values });
  assert.equal(onlyText, `${NOT_VERIFIED}\n\nForm: x\nPage: /\nLocale: de\n\nfirst:\na\nb\n`);
});

test('the locale comes from return: a first segment equal to a non-default code, else the default', async () => {
  const locale = async (page: string): Promise<string> => {
    const checked = await checkForm(post('contact', { ...CONTACT, return: page }), 'contact', SETTINGS);
    return checked.ok ? checked.locale : checked.code;
  };
  assert.deepEqual(
    await Promise.all(['/kontakt/', '/fr/contact/', '/en/contact/', '/de/x/', '/it/x/', '/'].map(locale)),
    ['de', 'fr', 'en', 'de', 'de', 'de'],
  );
  // A site that declares no form has none: every id is unknown.
  const without = optionsOf({
    ...SITE_FORMS,
    features: { forms: false },
    contact: undefined,
    forms: undefined,
    processing: ['cdn', 'previews'],
  });
  const refused = await checkForm(post('contact', CONTACT), 'contact', without);
  assert.equal(refused.ok ? 'sent' : refused.code, 'bad_form');
});

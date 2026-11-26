/**
 * The test server stub of 9.1 in `serveDist` (specification, 9.1, "The test server stub", and 14, M7). The stub
 * answers a POST to `/api/forms/<id>/` with the `checkForm` of the endpoint, without limits or mail: 303 or JSON,
 * with the five headers of 9.1 and no `_headers` rule.
 */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { request as httpRequest, type IncomingHttpHeaders } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { formIdOf, type Served, type ServeOptions, serveDist } from '../../src/serve.ts';
import { BOOKING, CONTACT, CONTACT_CAP, FIVE_HEADERS, SETTINGS, URLENCODED } from './forms-fixtures.ts';

const FILES: Readonly<Record<string, string>> = {
  'dist/index.html': '<!doctype html><title>Home</title>',
  'dist/kontakt/index.html': '<!doctype html><title>Kontakt</title>',
  'dist/404.html': '<!doctype html><title>Not found</title>',
  // A rule for every path: the stub, like the Worker, gets none of it.
  'dist/_headers': '/*\n  X-Rule: yes\n/api/*\n  X-Api-Rule: yes\n',
  // A rule for the form path: the stub answers before `_redirects`, as `run_worker_first` sends the path to the Worker.
  'dist/_redirects': '/api/forms/contact/ /elsewhere/ 301\n',
};

async function withServer(use: (server: Served) => Promise<void>, options: ServeOptions = { forms: SETTINGS }) {
  const dir = mkdtempSync(join(tmpdir(), 'astro-kit-'));
  try {
    for (const [file, content] of Object.entries(FILES)) {
      mkdirSync(dirname(join(dir, file)), { recursive: true });
      writeFileSync(join(dir, file), content);
    }
    const server = await serveDist(join(dir, 'dist'), { headers: { 'X-Extra': 'yes' }, ...options });
    try {
      await use(server);
    } finally {
      await server.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

interface Answer {
  status: number;
  headers: IncomingHttpHeaders;
  body: string;
}

/** One raw request. A body given as a list of chunks is sent with chunked transfer coding. */
function send(
  origin: string,
  target: string,
  method: string,
  headers: Record<string, string>,
  body: string | readonly string[] = '',
): Promise<Answer> {
  return new Promise((resolve, reject) => {
    const sent = httpRequest(`${origin}/`, { method, path: target, headers, agent: false }, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () =>
        resolve({
          status: response.statusCode ?? 0,
          headers: response.headers,
          body: Buffer.concat(chunks).toString('utf8'),
        }),
      );
      response.on('error', reject);
    });
    sent.setTimeout(10_000, () => sent.destroy(new Error(`no answer for ${method} ${target}`)));
    // The server may answer and stop reading before the whole body is sent.
    sent.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code !== 'EPIPE' && error.code !== 'ECONNRESET') reject(error);
    });
    if (typeof body === 'string') {
      sent.end(body);
      return;
    }
    for (const chunk of body) sent.write(chunk);
    sent.end();
  });
}

const form = (fields: Readonly<Record<string, string>>): string => new URLSearchParams({ ...fields }).toString();

/** A POST of urlencoded fields with its content length. */
const postForm = (origin: string, target: string, fields: Readonly<Record<string, string>>, more = {}) => {
  const body = form(fields);
  return send(
    origin,
    target,
    'POST',
    { 'content-type': URLENCODED, 'content-length': String(Buffer.byteLength(body)), ...more },
    body,
  );
};

/** The headers of a stub answer, without the ones that every HTTP answer of Node has. */
const stubHeaders = (answer: Answer): string[] =>
  Object.keys(answer.headers)
    .filter((name) => !['date', 'connection', 'keep-alive', 'transfer-encoding'].includes(name))
    .sort();

/**
 * The headers of 9.1 that an answer carries, and the three that it must not carry: the `_headers` rules and the
 * header of `ServeOptions.headers`. `EXPECTED` is what every stub answer gives.
 */
const headersOf = (answer: Answer): Record<string, unknown> => ({
  five: FIVE_HEADERS.map(([name]) => [name, answer.headers[name]]),
  cache: answer.headers['cache-control'],
  rule: answer.headers['x-rule'],
  apiRule: answer.headers['x-api-rule'],
  extra: answer.headers['x-extra'],
});

const EXPECTED = {
  five: FIVE_HEADERS,
  cache: 'private, no-store',
  rule: undefined,
  apiRule: undefined,
  extra: undefined,
};

test('formIdOf reads the id of /api/forms/<id>/, decoded, and nothing else', () => {
  const cases: readonly (readonly [string, string | undefined])[] = [
    ['/api/forms/contact/', 'contact'],
    ['/api/forms/contact/?x=1', 'contact'],
    ['/api/forms/contact/#x', 'contact'],
    ['/api/forms/%63ontact/', 'contact'],
    ['/api/forms/%E0%A4%A/', '%E0%A4%A'],
    ['/api/forms/contact', undefined],
    ['/api/forms/', undefined],
    ['/api/forms//', undefined],
    ['/api/forms/a/b/', undefined],
    ['/API/forms/contact/', undefined],
    ['/fr/api/forms/contact/', undefined],
  ];
  assert.deepEqual(
    cases.map(([target]) => [target, formIdOf(target)]),
    cases,
  );
});

test('the stub answers a valid post with 303 to <return>#sent, and JSON mode with 200, both with the five headers', async () => {
  await withServer(async (server) => {
    const redirect = await postForm(server.origin, '/api/forms/contact/', CONTACT);
    assert.equal(redirect.status, 303);
    assert.equal(redirect.headers.location, '/kontakt/#sent');
    assert.equal(redirect.body, '');
    assert.deepEqual(headersOf(redirect), EXPECTED, 'redirect');
    assert.deepEqual(
      stubHeaders(redirect),
      [...FIVE_HEADERS.map(([name]) => name), 'cache-control', 'content-length', 'location'].sort(),
    );

    const json = await postForm(server.origin, '/api/forms/booking/?from=page', BOOKING, {
      accept: 'application/json',
    });
    assert.equal(json.status, 200);
    assert.equal(json.headers['content-type'], 'application/json; charset=utf-8');
    assert.equal(json.body, '{"ok":true}');
    assert.deepEqual(headersOf(json), EXPECTED, 'json');
    assert.deepEqual(
      server.received.map((seen) => [seen.method, seen.path]),
      [
        ['POST', '/api/forms/contact/'],
        ['POST', '/api/forms/booking/?from=page'],
      ],
    );
  });
});

test('the stub runs the same return and field validation as the endpoint, with no limit and no mail', async () => {
  await withServer(async (server) => {
    const cases: readonly (readonly [string, string, Readonly<Record<string, string>>, number, string, string])[] = [
      [
        'invalid',
        '/api/forms/contact/',
        { ...CONTACT, email: 'anna' },
        400,
        '/kontakt/#not-sent',
        '{"ok":false,"code":"invalid","fields":["email"]}',
      ],
      [
        'the trap',
        '/api/forms/contact/',
        { ...CONTACT, website: 'x' },
        400,
        '/kontakt/#not-sent',
        '{"ok":false,"code":"invalid","fields":[]}',
      ],
      [
        'bad_return',
        '/api/forms/contact/',
        { ...CONTACT, return: '//evil.example/' },
        400,
        '/#not-sent',
        '{"ok":false,"code":"bad_return"}',
      ],
      ['bad_form', '/api/forms/newsletter/', CONTACT, 404, '/#not-sent', '{"ok":false,"code":"bad_form"}'],
      [
        'a CRLF counts as one character',
        '/api/forms/contact/',
        { ...CONTACT, message: `${'a\r\n'.repeat(2_500)}` },
        200,
        '/kontakt/#sent',
        '{"ok":true}',
      ],
    ];
    for (const [name, target, fields, status, location, body] of cases) {
      const redirect = await postForm(server.origin, target, fields);
      assert.deepEqual([redirect.status, redirect.headers.location], [303, location], name);
      assert.deepEqual(headersOf(redirect), EXPECTED, name);
      const json = await postForm(server.origin, target, fields, { accept: 'application/json' });
      assert.deepEqual([json.status, json.body], [status, body], name);
      assert.deepEqual(headersOf(json), EXPECTED, name);
    }
    // No rate limit: ten posts in a row from one client are all sent.
    for (let index = 0; index < 10; index += 1) {
      assert.equal((await postForm(server.origin, '/api/forms/contact/', CONTACT)).headers.location, '/kontakt/#sent');
    }
    const other = await send(server.origin, '/api/forms/contact/', 'POST', { 'content-type': 'text/plain' }, 'x');
    assert.deepEqual([other.status, other.headers.location], [303, '/#not-sent'], 'bad_body');
    // A charset other than UTF-8 is bad_body in the stub, as in the Worker (13.1 item 78).
    const latin = await send(
      server.origin,
      '/api/forms/contact/',
      'POST',
      { 'content-type': `${URLENCODED}; charset=iso-8859-1`, accept: 'application/json' },
      form(CONTACT),
    );
    assert.deepEqual([latin.status, latin.body], [400, '{"ok":false,"code":"bad_body"}'], 'charset=iso-8859-1');
  });
});

test('the stub caps the body: a declared length and a chunked body past the cap of the form give too_large', async () => {
  await withServer(async (server) => {
    const big = form({ ...CONTACT, message: 'x'.repeat(CONTACT_CAP) });
    const declared = await send(
      server.origin,
      '/api/forms/contact/',
      'POST',
      { 'content-type': URLENCODED, 'content-length': String(Buffer.byteLength(big)), accept: 'application/json' },
      big,
    );
    assert.deepEqual([declared.status, declared.body], [413, '{"ok":false,"code":"too_large"}']);
    assert.deepEqual(headersOf(declared), EXPECTED, 'declared');

    const chunks = Array.from({ length: 64 }, () => 'y'.repeat(4_096));
    const chunked = await send(
      server.origin,
      '/api/forms/contact/',
      'POST',
      { 'content-type': URLENCODED, accept: 'application/json' },
      [`${form(CONTACT)}&pad=`, ...chunks],
    );
    assert.deepEqual([chunked.status, chunked.body], [413, '{"ok":false,"code":"too_large"}']);

    // The server still answers after both.
    assert.equal((await postForm(server.origin, '/api/forms/contact/', CONTACT)).headers.location, '/kontakt/#sent');
  });
});

test('only a POST to /api/forms/<id>/ reaches the stub; every other request is served as before', async () => {
  await withServer(async (server) => {
    const get = await send(server.origin, '/api/forms/booking/', 'GET', {});
    assert.equal(get.status, 404, 'a GET gets the 404 page');
    assert.equal(get.headers['x-rule'], 'yes', 'with the _headers rules');
    const head = await send(server.origin, '/api/forms/booking/', 'HEAD', {});
    assert.equal(head.status, 404);
    // The asset steps run for it, `_redirects` first: unlike the Worker of 10.4, which gets every `/api/forms/*` path.
    const redirected = await send(server.origin, '/api/forms/contact/', 'GET', {});
    assert.equal(redirected.status, 301);
    const noSlash = await postForm(server.origin, '/api/forms/contact', CONTACT);
    assert.equal(noSlash.status, 405, 'no slash: not the form path');
    const page = await postForm(server.origin, '/kontakt/', CONTACT);
    assert.equal(page.status, 405, 'a POST to a page');
  });
});

test('without the settings of a forms site there is no stub: the M6 server answers 405, or its _redirects rule', async () => {
  await withServer(async (server) => {
    const answer = await postForm(server.origin, '/api/forms/contact/', CONTACT);
    assert.deepEqual([answer.status, answer.headers.location], [301, '/elsewhere/']);
    const other = await postForm(server.origin, '/api/forms/booking/', BOOKING);
    assert.equal(other.status, 405);
  }, {});
});

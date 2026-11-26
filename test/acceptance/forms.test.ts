/**
 * The forms cases of milestone M7 (specification, 14, M7, and 13.1 items 63 and 78): the test site with forms, built
 * with the packed kit and `@astrojs/cloudflare` 14.4.9, and its Worker run by `wrangler dev` in local mode with the
 * Worker config that the adapter wrote. No case reaches the network: `send_email` writes the mail into the case
 * folder, and the rate limits count in memory.
 *
 * - The Worker answers a form post through the endpoint of the kit, so `virtual:astro-kit` resolves in the Worker
 *   bundle: a failed load would answer `no_binding`. The mail text is byte-exact.
 * - The Worker itself refuses a file part with an empty or an extended file name and an urlencoded body in another
 *   charset (13.1 item 78): its own parser would give the first two as text.
 * - The adapter writes `dist/client/.assetsignore` before the audit of the kit (13.1 item 63): a planted `.dev.vars`
 *   passes `edge-private` only because the audit reads the lines of the adapter. The final file keeps the project
 *   lines, and neither server serves a private file.
 *
 * Run: node --test test/acceptance/forms.test.ts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import type * as EdgeModule from '../../src/audit/edge.ts';
import type * as RegistryModule from '../../src/registry.ts';
import {
  CLIENT,
  type KitRun,
  kitModule,
  passedLine,
  read,
  run,
  type Served,
  serve,
  siteCase,
  tree,
  WORKER_CONFIG,
  write,
} from './harness.ts';
import { type Answer, call, type Wrangler, wranglerDev } from './wrangler.ts';

/** The last part of a command's output, for the message of a failed assertion. */
const tail = (result: KitRun): string => result.output.slice(-6000);

/** The five headers of every answer of the endpoint (9.1), with the `Cache-Control` of every answer. */
const FORM_HEADERS: readonly [string, string][] = [
  ['cache-control', 'private, no-store'],
  ['x-content-type-options', 'nosniff'],
  ['referrer-policy', 'strict-origin-when-cross-origin'],
  ['strict-transport-security', 'max-age=31536000; includeSubDomains'],
  ['cross-origin-resource-policy', 'same-origin'],
  ['content-security-policy', "default-src 'none'; frame-ancestors 'none'"],
];

/** The project line of the planted `public/.assetsignore`: it hides the planted `.env`. */
const PROJECT_IGNORE = '.env\n';

/** A valid post of the contact form on the German contact page, urlencoded. A line break is CRLF, as a browser sends. */
const CONTACT = new URLSearchParams({
  return: '/kontakt/',
  website: '',
  name: 'Anna Muster',
  email: 'anna@example.com',
  message: 'Guten Tag\r\nIst am 3. März ein Zimmer frei?',
}).toString();

/** The mail text of `CONTACT` (9.1): LF line ends, one final LF, the textarea after a blank line. */
const CONTACT_MAIL = [
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
].join('\n');

/** The mail text of the booking post of `bookingBody` on the French contact page; the empty `tel` is left out. */
const BOOKING_MAIL = [
  'Sent through the website form; the sender address is not verified.',
  '',
  'Form: booking',
  'Page: /fr/contact/',
  'Locale: fr',
  '',
  'name: Jean Dupont',
  'email: jean@example.com',
  'arrival: 2027-01-15',
  'nights: 3',
  'room: double',
  'terms: yes',
  '',
].join('\n');

/** One multipart body with the boundary `KitBoundary`, from its parts: each part is its header lines and its value. */
function multipart(parts: readonly [headers: string, value: string][]): string {
  const lines = parts.map(([headers, value]) => `--KitBoundary\r\n${headers}\r\n\r\n${value}\r\n`);
  return `${lines.join('')}--KitBoundary--\r\n`;
}

/** The fields of the booking post, as multipart parts. */
const bookingParts = (): [string, string][] =>
  [
    ['return', '/fr/contact/'],
    ['website', ''],
    ['name', 'Jean Dupont'],
    ['email', 'jean@example.com'],
    ['tel', ''],
    ['arrival', '2027-01-15'],
    ['nights', '3'],
    ['room', 'double'],
    ['terms', 'on'],
  ].map(([name, value]) => [`Content-Disposition: form-data; name="${name}"`, value ?? '']);

const MULTIPART = 'multipart/form-data; boundary=KitBoundary';
const URLENCODED = 'application/x-www-form-urlencoded';

/** A post to a form path, from the IP address `ip`: each post has an address of its own, so no IP limit counts. */
const post = (origin: string, path: string, ip: string, type: string, body: string, json = false): Promise<Answer> =>
  call(origin, path, {
    method: 'POST',
    headers: { 'content-type': type, 'cf-connecting-ip': ip, ...(json ? { accept: 'application/json' } : {}) },
    body,
  });

/** The headers of an answer that the endpoint sets on every answer, as `[name, value]`. */
const formHeaders = (answer: Answer): [string, string][] =>
  FORM_HEADERS.map(([name]) => [name, String(answer.headers[name])]);

/** Every mail text that `send_email` of `wrangler dev` wrote in the case folder. */
function mails(dir: string): string[] {
  const root = join(dir, 'dist/server/.wrangler/tmp');
  let files: string[];
  try {
    files = tree(root);
  } catch {
    return [];
  }
  return files.filter((file) => file.includes('email-text/')).map((file) => readFileSync(join(root, file), 'utf8'));
}

/** The longest wait for the lines that wrangler logs after an answer. */
const LOG_LIMIT_MS = 10_000;

/**
 * Waits until the output of wrangler holds each pattern at least as often as its count, and fails with the tail of
 * the output after `LOG_LIMIT_MS`. It waits for an event that comes; it never repeats a request.
 */
async function outputHolds(wrangler: Wrangler, wanted: readonly [RegExp, number][]): Promise<void> {
  const deadline = Date.now() + LOG_LIMIT_MS;
  const done = (): boolean =>
    wanted.every(([pattern, count]) => (wrangler.output().match(pattern) ?? []).length >= count);
  while (!done()) {
    if (Date.now() > deadline) {
      throw new Error(
        `wrangler did not log ${wanted.map(([pattern, count]) => `${count} × ${pattern.source}`).join(' and ')} within ${LOG_LIMIT_MS / 1000} s:\n${wrangler.output().slice(-3000)}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

test('M7: the built Worker answers form posts in wrangler dev, and no private file of the build is public', async () => {
  const dir = siteCase('forms-worker', (folder) => {
    write(folder, {
      'public/.assetsignore': PROJECT_IGNORE,
      'public/.env': 'KEY=planted\n',
      'public/.dev.vars': 'KEY=planted\n',
    });
  });
  const built = run(dir, 'build');
  // `.dev.vars` and `wrangler.json` pass only because the audit read the lines that the adapter adds.
  assert.equal(built.status, 0, tail(built));
  assert.deepEqual(built.ids, []);
  assert.deepEqual(passedLine(built), { last: true, count: 1 }, tail(built));

  // The adapter appends its lines to the project lines (13.1 item 63). The final file is the one the audit read.
  const client = join(dir, CLIENT);
  assert.equal(read(client, '.assetsignore'), `${PROJECT_IGNORE}wrangler.json\n.dev.vars\n`);
  const files = tree(client);
  for (const file of ['.env', '.dev.vars']) assert.ok(files.includes(file), `${file} is in the build`);
  // With the on-demand route of the forms, the Worker config is in `dist/server/`, not in the client directory.
  assert.ok(!files.includes('wrangler.json'), 'wrangler.json is in the client directory');
  assert.ok(tree(join(dir, 'dist/server')).includes('wrangler.json'), 'dist/server/wrangler.json is missing');
  const { checkPrivate } = await kitModule<typeof EdgeModule>('audit/edge');
  const { Report } = await kitModule<typeof RegistryModule>('registry');
  const report = new Report();
  checkPrivate({
    files,
    read: (file) => (files.includes(file) ? new Uint8Array(readFileSync(join(client, file))) : undefined),
    report,
  });
  assert.deepEqual(report.findings, [], 'the final client directory hides every private file');

  let kit: Served | undefined;
  let wrangler: Wrangler | undefined;
  try {
    kit = await serve(client);
    wrangler = await wranglerDev(dir, WORKER_CONFIG);
    for (const path of ['/.env', '/.dev.vars', '/wrangler.json', '/.assetsignore', '/_headers']) {
      assert.equal((await call(wrangler.origin, path)).status, 404, `wrangler dev ${path}`);
      assert.equal((await call(kit.origin, path)).status, 404, `serveDist ${path}`);
    }

    // A valid post: 303 to `#sent` of the page, with the five headers, and the mail of 9.1.
    const sent = await post(wrangler.origin, '/api/forms/contact/', '192.0.2.1', URLENCODED, CONTACT);
    assert.equal(sent.status, 303, `${sent.status} ${sent.body}\n${wrangler.output().slice(-3000)}`);
    assert.equal(sent.headers.location, '/kontakt/#sent');
    assert.deepEqual(formHeaders(sent), FORM_HEADERS);
    // JSON mode, multipart, French: 200 with the body of 9.1.
    const booked = await post(
      wrangler.origin,
      '/api/forms/booking/',
      '192.0.2.2',
      MULTIPART,
      multipart(bookingParts()),
      true,
    );
    assert.equal(booked.status, 200, booked.body);
    assert.equal(booked.body, '{"ok":true}');
    assert.equal(booked.headers['content-type'], 'application/json; charset=utf-8');
    assert.deepEqual(formHeaders(booked), FORM_HEADERS);

    // Step 3 in the Worker itself (13.1 item 78): a file part with an empty or an extended file name, and an
    // urlencoded body in another charset, are `bad_body`.
    const refused: [string, string, string][] = [
      [
        'filename=""',
        MULTIPART,
        multipart([
          ...bookingParts(),
          ['Content-Disposition: form-data; name="cv"; filename=""\r\nContent-Type: text/plain', 'x'],
        ]),
      ],
      [
        "filename*=UTF-8''a.txt",
        MULTIPART,
        multipart([
          ...bookingParts(),
          ['Content-Disposition: form-data; name="cv"; filename*=UTF-8\'\'a.txt\r\nContent-Type: text/plain', 'x'],
        ]),
      ],
      ['charset=iso-8859-1', `${URLENCODED}; charset=iso-8859-1`, CONTACT],
    ];
    for (const [index, [label, type, body]] of refused.entries()) {
      const answer = await post(wrangler.origin, '/api/forms/booking/', `192.0.2.${10 + index}`, type, body, true);
      assert.equal(answer.status, 400, `${label}: ${answer.status} ${answer.body}`);
      assert.equal(answer.body, '{"ok":false,"code":"bad_body"}', label);
      assert.deepEqual(formHeaders(answer), FORM_HEADERS, label);
    }

    // Miniflare stores each mail in `ctx.waitUntil` after `send()` has resolved, and logs "send_email binding
    // called" once the file is stored. A `console.warn` of the Worker can reach the output after its answer. So the
    // case waits for these known lines first, with a bounded deadline, and then reads the mails and the output once.
    await outputHolds(wrangler, [
      [/send_email binding called/g, 2],
      [/astro-kit form: bad_body/g, 3],
    ]);
    // The two mails, byte-exact. The log names the codes only: no value of a form is in the output of wrangler.
    assert.deepEqual(mails(dir).sort(), [BOOKING_MAIL, CONTACT_MAIL].sort());
    const output = wrangler.output();
    assert.equal((output.match(/astro-kit form: bad_body/g) ?? []).length, 3, output.slice(-3000));
    for (const value of ['Anna Muster', 'Guten Tag', 'Jean Dupont', 'jean@example.com']) {
      assert.ok(!output.includes(value), `the output of wrangler holds ${value}`);
    }
  } finally {
    try {
      await wrangler?.close();
    } finally {
      await kit?.close();
    }
  }
});

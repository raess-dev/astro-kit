/**
 * The unit tests of `serveDist` (specification, 14, M6, and 14.1). Each test writes a small `dist/` from strings into
 * `mkdtemp(join(tmpdir(), 'astro-kit-'))`, serves it, sends raw requests with `node:http` and closes the server in a
 * `finally`. Each bullet of row M6 has a passing and a failing case.
 */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { request as httpRequest, type IncomingHttpHeaders } from 'node:http';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import {
  brotliCompress,
  brotliDecompressSync,
  constants,
  gunzipSync,
  zstdCompress,
  zstdDecompressSync,
} from 'node:zlib';
import {
  clientDir,
  contentTypeOf,
  decodePath,
  encodePath,
  encodingOf,
  globMatches,
  headerRules,
  ignoreRules,
  isCompressible,
  isIgnored,
  matchParts,
  normalizePattern,
  passesGuard,
  patternMatches,
  patternParts,
  type Received,
  redirectRules,
  type Served,
  type ServeOptions,
  serveDist,
  splitTarget,
} from '../../src/serve.ts';

/** The values of row M6, written out, so that a changed constant of serve.ts fails here. */
const FILE_CACHE = 'public, max-age=0, must-revalidate';
const ALLOW = 'GET, HEAD';
const NOT_FOUND_TEXT = 'Not found';

type Files = Record<string, string | Buffer>;

/** A temp folder with the files, by path relative to the folder. */
function folderOf(files: Files): string {
  const dir = mkdtempSync(join(tmpdir(), 'astro-kit-'));
  for (const [file, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, file)), { recursive: true });
    writeFileSync(join(dir, file), content);
  }
  return dir;
}

/** Serves `<dir>/dist` of the files, runs `use` and closes the server and removes the folder in any case. */
async function served(
  files: Files,
  use: (server: Served, dir: string) => Promise<void>,
  options: ServeOptions = {},
  prepare?: (dir: string) => void,
): Promise<void> {
  const dir = folderOf(files);
  try {
    prepare?.(dir);
    const server = await serveDist(join(dir, 'dist'), options);
    try {
      await use(server, dir);
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
  body: Buffer;
}

/** One raw request: the target is sent as it is written, with no URL normalization. */
function call(origin: string, target: string, method = 'GET', headers: Record<string, string> = {}): Promise<Answer> {
  return new Promise((resolve, reject) => {
    const sent = httpRequest(`${origin}/`, { method, path: target, headers, agent: false }, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () =>
        resolve({ status: response.statusCode ?? 0, headers: response.headers, body: Buffer.concat(chunks) }),
      );
      response.on('error', reject);
    });
    // An answer that never ends fails the test instead of holding it.
    sent.setTimeout(10_000, () => sent.destroy(new Error(`no answer for ${method} ${target}`)));
    sent.on('error', reject);
    sent.end(method === 'POST' ? 'a=1' : undefined);
  });
}

const page = (name: string): string => `<!doctype html><title>${name}</title><p>${name}</p>`;
const NOT_FOUND = page('404');

/** The status, the location and the body of an answer as text. */
const brief = (answer: Answer): [number, string | undefined, string] => [
  answer.status,
  answer.headers.location,
  answer.body.toString('utf8'),
];

// The address

test('serveDist listens on 127.0.0.1 and a free port, and a second server gets another port', async () => {
  await served({ 'dist/index.html': page('home') }, async (one) => {
    await served({ 'dist/index.html': page('home') }, async (two) => {
      assert.equal(one.address, '127.0.0.1', 'the socket listens on the loopback address only');
      assert.equal(two.address, '127.0.0.1');
      assert.match(one.origin, /^http:\/\/127\.0\.0\.1:\d+$/);
      assert.match(two.origin, /^http:\/\/127\.0\.0\.1:\d+$/);
      assert.notEqual(one.origin, two.origin);
      assert.equal((await call(one.origin, '/')).status, 200);
    });
  });
});

/** The error code of a TCP connection to the host and port, or `connected`. */
function connectTo(host: string, port: number): Promise<string> {
  return new Promise((resolve) => {
    const socket = connect({ host, port });
    socket.setTimeout(5_000, () => {
      socket.destroy();
      resolve('timeout');
    });
    socket.once('connect', () => {
      socket.destroy();
      resolve('connected');
    });
    socket.once('error', (error: NodeJS.ErrnoException) => resolve(error.code ?? 'error'));
  });
}

// Linux routes all of 127.0.0.0/8 to the loopback device, so a server on every address would answer 127.0.0.2.
test('serveDist refuses a connection to another address of the machine', {
  skip: process.platform !== 'linux',
}, async () => {
  await served({ 'dist/index.html': page('home') }, async (server) => {
    const port = Number(new URL(server.origin).port);
    assert.equal(await connectTo('127.0.0.1', port), 'connected');
    assert.equal(await connectTo('127.0.0.2', port), 'ECONNREFUSED');
  });
});

test('serveDist rejects a folder that does not exist, and starts no server', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'astro-kit-'));
  try {
    await assert.rejects(serveDist(join(dir, 'dist')), /is no folder/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// The traversal guard

const TRAVERSALS: readonly string[] = [
  '/%2e%2e/secret.txt',
  '/%2E%2E/secret.txt',
  '/a/%2e%2e/%2e%2e/secret.txt',
  '/../secret.txt',
  '/a/../../secret.txt',
  '/./a/x.txt',
  '/%2e%2e%2fsecret.txt',
  '/a%2f..%2f..%2fsecret.txt',
  '/%5c..%5csecret.txt',
  '/a/%00.txt',
  '/a/x.txt%00',
  '/c%3A/secret.txt',
  'http://127.0.0.1/a/x.txt',
  '/link.txt',
  '/out/secret.txt',
];

/**
 * Paths that are no traversal but are not in their canonical form. The asset worker gives 307 to the form with each
 * segment decoded and encoded again and each run of `/` made one. Then the server answers as for that path.
 */
const CANONICAL: ReadonlyMap<string, string> = new Map([
  ['/%E0%A4%A.txt', '/%25E0%25A4%25A.txt'],
  ['/%zz', '/%25zz'],
  ['/C:/secret.txt', '/C%3A/secret.txt'],
  ['//secret.txt', '/secret.txt'],
  ['/a//x.txt', '/a/x.txt'],
  ['//a/x.txt?q=1', '/a/x.txt?q=1'],
  ['/a%2Fx.txt', '/a/x.txt'],
  ['/%61/x.txt', '/a/x.txt'],
  ['/caf%c3%a9.txt', '/caf%C3%A9.txt'],
  ['/a,b.txt', '/a%2Cb.txt'],
  ['/a+b.txt', '/a%2Bb.txt'],
  ['/a@b.txt', '/a%40b.txt'],
  ['/a.txt;x', '/a.txt%3Bx'],
]);

test('the traversal guard: no path reads a file outside the root, and each gives the root 404 page', async () => {
  await served(
    { 'secret.txt': 'secret', 'dist/404.html': NOT_FOUND, 'dist/a/x.txt': 'x', 'dist/a/404.html': page('a 404') },
    async (server) => {
      for (const target of TRAVERSALS) {
        const answer = await call(server.origin, target);
        assert.deepEqual(brief(answer), [404, undefined, NOT_FOUND], target);
      }
    },
    {},
    (dir) => {
      symlinkSync(join(dir, 'secret.txt'), join(dir, 'dist/link.txt'));
      symlinkSync(dir, join(dir, 'dist/out'));
    },
  );
});

test('a path in another form than its canonical one gets 307 to that form, with the query', async () => {
  await served(
    {
      'secret.txt': 'secret',
      'dist/404.html': NOT_FOUND,
      'dist/a/x.txt': 'x',
      'dist/café.txt': 'café',
      'dist/a,b.txt': 'comma',
      'dist/a+b.txt': 'plus',
      'dist/a@b.txt': 'at',
      'dist/a.txt;x': 'semicolon',
    },
    async (server) => {
      for (const [target, location] of CANONICAL) {
        assert.deepEqual(brief(await call(server.origin, target)), [307, location, ''], target);
      }
      const after = new Map([
        ['/%25zz', [404, NOT_FOUND]],
        ['/C%3A/secret.txt', [404, NOT_FOUND]],
        ['/secret.txt', [404, NOT_FOUND]],
        ['/a/x.txt', [200, 'x']],
        ['/caf%C3%A9.txt', [200, 'café']],
        ['/a%2Cb.txt', [200, 'comma']],
        ['/a%2Bb.txt', [200, 'plus']],
        ['/a%40b.txt', [200, 'at']],
        ['/a.txt%3Bx', [200, 'semicolon']],
      ]);
      for (const [target, [status, body]] of after) {
        assert.deepEqual(brief(await call(server.origin, target)), [status, undefined, body], target);
      }
    },
  );
});

test('the canonical redirect needs an answer: with no 404.html, a missing path in another form answers Not found', async () => {
  await served({ 'dist/index.html': page('home') }, async (server) => {
    assert.deepEqual(brief(await call(server.origin, '//gone/')), [404, undefined, NOT_FOUND_TEXT]);
    assert.deepEqual(brief(await call(server.origin, '//')), [307, '/', '']);
  });
});

test('the traversal guard lets a decoded name and a link inside the root through', async () => {
  await served(
    { 'dist/a/x.txt': 'x', 'dist/café.txt': 'café', 'dist/a b/c.txt': 'c', 'dist/a/%2e.txt': 'dot' },
    async (server) => {
      assert.deepEqual(brief(await call(server.origin, '/a/x.txt')), [200, undefined, 'x']);
      assert.deepEqual(brief(await call(server.origin, '/caf%C3%A9.txt')), [200, undefined, 'café']);
      assert.deepEqual(brief(await call(server.origin, '/a%20b/c.txt')), [200, undefined, 'c']);
      assert.deepEqual(brief(await call(server.origin, '/a/%252e.txt')), [200, undefined, 'dot']);
      assert.deepEqual(brief(await call(server.origin, '/inside.txt')), [200, undefined, 'x']);
    },
    {},
    (dir) => symlinkSync(join(dir, 'dist/a/x.txt'), join(dir, 'dist/inside.txt')),
  );
});

test('passesGuard refuses a path that could leave the root, and lets every other path through', () => {
  assert.deepEqual(
    ['/%2e%2e/', '/./', '/a/..', '/a%2F..%2Fb', '/a%5Cb', '/a\\b', '/a%00', 'a', '', 'http://x/'].map(passesGuard),
    Array(10).fill(false),
  );
  assert.deepEqual(
    ['/', '/a/', '/a%2Fb', '/%', '/D:', '//a', '/...', '/a..b', '/%2e.txt'].map(passesGuard),
    Array(9).fill(true),
  );
});

test('decodePath decodes each segment and makes each run of / one; encodePath encodes each segment', () => {
  assert.equal(decodePath('/'), '/');
  assert.equal(decodePath('/a/b%20c'), '/a/b c');
  assert.equal(decodePath('//a//b%2F%2Fc/'), '/a/b/c/');
  assert.equal(decodePath('/%zz/%E0%A4%A'), '/%zz/%E0%A4%A');
  assert.equal(encodePath('/a b/c:d/é/'), '/a%20b/c%3Ad/%C3%A9/');
  assert.equal(encodePath('/%zz'), '/%25zz');
  assert.equal(encodePath('/\uD800'), '/\uD800', 'a lone surrogate stays as it is');
});

test('splitTarget keeps the query with its ?, and a lone ? is no query', () => {
  assert.deepEqual(splitTarget('/a?x=1&y'), { path: '/a', query: '?x=1&y' });
  assert.deepEqual(splitTarget('/a?'), { path: '/a', query: '' });
  assert.deepEqual(splitTarget('/a'), { path: '/a', query: '' });
});

// The three redirects

const PAGES: Files = {
  'dist/index.html': page('home'),
  'dist/404.html': NOT_FOUND,
  'dist/zimmer/index.html': page('zimmer'),
  'dist/fr/index.html': page('fr'),
};

test('/a gives 307 to /a/ when a/index.html exists, with the query kept', async () => {
  await served(PAGES, async (server) => {
    assert.deepEqual(brief(await call(server.origin, '/zimmer')), [307, '/zimmer/', '']);
    assert.deepEqual(brief(await call(server.origin, '/zimmer?a=1&b=2')), [307, '/zimmer/?a=1&b=2', '']);
    assert.deepEqual(brief(await call(server.origin, '/zimmer/')), [200, undefined, page('zimmer')]);
    assert.deepEqual(brief(await call(server.origin, '/zimmer/?a=1')), [200, undefined, page('zimmer')]);
  });
});

test('/b answers 404 when b/index.html does not exist', async () => {
  await served(PAGES, async (server) => {
    assert.deepEqual(brief(await call(server.origin, '/suite')), [404, undefined, NOT_FOUND]);
    assert.deepEqual(brief(await call(server.origin, '/suite?a=1')), [404, undefined, NOT_FOUND]);
  });
});

test('a path that ends in /index.html and names a file gives 307 to the path without index.html', async () => {
  await served(PAGES, async (server) => {
    assert.deepEqual(brief(await call(server.origin, '/zimmer/index.html')), [307, '/zimmer/', '']);
    assert.deepEqual(brief(await call(server.origin, '/zimmer/index.html?x=1')), [307, '/zimmer/?x=1', '']);
    assert.deepEqual(brief(await call(server.origin, '/index.html')), [307, '/', '']);
    assert.deepEqual(brief(await call(server.origin, '/index.html?x')), [307, '/?x', '']);
  });
});

test('a path that ends in /index.html and names no file answers 404', async () => {
  await served(PAGES, async (server) => {
    assert.deepEqual(brief(await call(server.origin, '/suite/index.html')), [404, undefined, NOT_FOUND]);
  });
});

test('/404.html gives 307 to /404 with the query kept, and /404 answers 200 with the 404 page', async () => {
  await served(PAGES, async (server) => {
    assert.deepEqual(brief(await call(server.origin, '/404.html')), [307, '/404', '']);
    assert.deepEqual(brief(await call(server.origin, '/404.html?a=1')), [307, '/404?a=1', '']);
    const own = await call(server.origin, '/404');
    assert.deepEqual(brief(own), [200, undefined, NOT_FOUND]);
    assert.equal(own.headers['content-type'], 'text/html; charset=utf-8');
  });
});

test('without a 404.html, /404.html and /404 answer 404 with the text Not found', async () => {
  await served({ 'dist/index.html': page('home') }, async (server) => {
    assert.deepEqual(brief(await call(server.origin, '/404.html')), [404, undefined, NOT_FOUND_TEXT]);
    assert.deepEqual(brief(await call(server.origin, '/404')), [404, undefined, NOT_FOUND_TEXT]);
  });
});

// The 404 answer

test('a missing path gets the nearest 404.html up the path, with status 404', async () => {
  await served({ ...PAGES, 'dist/fr/404.html': page('fr 404') }, async (server) => {
    const nearest = new Map([
      ['/x/', NOT_FOUND],
      ['/x', NOT_FOUND],
      ['/a/b/c/', NOT_FOUND],
      ['/x.png', NOT_FOUND],
      ['/fr/x/', page('fr 404')],
      ['/fr/a/b', page('fr 404')],
      ['/fr/x.css', page('fr 404')],
      ['/FR/', NOT_FOUND],
    ]);
    for (const [path, body] of nearest) {
      const answer = await call(server.origin, path);
      assert.deepEqual(brief(answer), [404, undefined, body], path);
      assert.equal(answer.headers['content-type'], 'text/html; charset=utf-8', path);
      assert.equal(answer.headers['cache-control'], FILE_CACHE, path);
    }
  });
});

test('with no 404.html on the path, a missing path answers 404 with the text Not found', async () => {
  await served({ 'dist/index.html': page('home'), 'dist/fr/x/404.html': page('deep') }, async (server) => {
    const answer = await call(server.origin, '/fr/y/');
    assert.deepEqual(brief(answer), [404, undefined, NOT_FOUND_TEXT]);
    assert.equal(answer.headers['content-type'], 'text/plain; charset=utf-8');
    assert.equal(answer.headers['cache-control'], undefined);
  });
});

// Types and cache-control

const TYPED: Files = {
  'dist/index.html': page('home'),
  'dist/_astro/a.css': 'a{}',
  'dist/_astro/a.js': 'a()',
  'dist/robots.txt': 'User-agent: *',
  'dist/a.json': '{}',
  'dist/a.svg': '<svg/>',
  'dist/a.png': Buffer.from([0x89, 0x50]),
  'dist/a.woff2': Buffer.from([1]),
  'dist/a.pdf': Buffer.from([2]),
  'dist/a.bin': Buffer.from([3]),
  'dist/a.yaml': 'a: 1',
  'dist/a.rss': '<rss/>',
  'dist/a.unknown': 'x',
  'dist/LICENSE': 'text',
};

test('a file gets its content type, with charset=utf-8 for text, and the default cache-control', async () => {
  await served(TYPED, async (server) => {
    const types = new Map([
      ['/', 'text/html; charset=utf-8'],
      ['/_astro/a.css', 'text/css; charset=utf-8'],
      ['/_astro/a.js', 'text/javascript; charset=utf-8'],
      ['/robots.txt', 'text/plain; charset=utf-8'],
      ['/a.json', 'application/json'],
      ['/a.svg', 'image/svg+xml'],
      ['/a.png', 'image/png'],
      ['/a.woff2', 'font/woff2'],
      ['/a.pdf', 'application/pdf'],
      ['/a.bin', 'application/octet-stream'],
      ['/a.yaml', 'text/yaml; charset=utf-8'],
      ['/a.rss', 'application/rss+xml'],
      ['/LICENSE', undefined],
      ['/a.unknown', undefined],
    ]);
    for (const [path, type] of types) {
      const answer = await call(server.origin, path);
      assert.equal(answer.status, 200, path);
      assert.equal(answer.headers['content-type'], type, path);
      assert.equal(answer.headers['cache-control'], FILE_CACHE, path);
    }
  });
});

test('a redirect and a 405 answer have no content type and no cache-control', async () => {
  await served(PAGES, async (server) => {
    for (const answer of [await call(server.origin, '/zimmer'), await call(server.origin, '/', 'POST')]) {
      assert.equal(answer.headers['content-type'], undefined);
      assert.equal(answer.headers['cache-control'], undefined);
      assert.equal(answer.headers['content-length'], '0');
    }
  });
});

test('contentTypeOf adds the charset only to text types, and gives no type for an unknown extension', () => {
  const types = new Map([
    ['a.HTML', 'text/html; charset=utf-8'],
    ['a.mjs', 'text/javascript; charset=utf-8'],
    ['a.cjs', 'application/node'],
    ['a.webmanifest', 'application/manifest+json'],
    ['a.xml', 'application/xml'],
    ['a.ico', 'image/vnd.microsoft.icon'],
    ['a.atom', 'application/atom+xml'],
    ['a.xhtml', 'application/xhtml+xml'],
    ['a.jsonld', 'application/ld+json'],
    ['a.toml', 'application/toml'],
    ['a.wav', 'audio/wav'],
    ['a.bmp', 'image/bmp'],
    ['a.tiff', 'image/tiff'],
    ['a.txt.gz', 'application/gzip'],
    ['a.mp4', 'video/mp4'],
    ['a', undefined],
    ['a.xyz', undefined],
    ['.htaccess', undefined],
  ]);
  assert.deepEqual([...types.keys()].map(contentTypeOf), [...types.values()]);
});

// `_headers`

const HEADERS = [
  '# a comment',
  '/*',
  '  X-All: one',
  '/zimmer/*',
  '  X-Room: yes',
  '/:lang/x/',
  '  X-Param: yes',
  'https://example.ch/*',
  '  X-Absolute: yes',
  '/two/*/*',
  '  X-Two: yes',
  '/:any*',
  '  X-All: two',
  '/plain/*',
  '  ! X-All',
  '/plain/again/*',
  '  X-All: again',
  '/nocache/*',
  '  ! Cache-Control',
  '/_astro/*',
  '  Cache-Control: public, max-age=31536000, immutable',
  '',
].join('\n');

const RULED: Files = {
  ...PAGES,
  'dist/_headers': HEADERS,
  'dist/plain/index.html': page('plain'),
  'dist/plain/again/index.html': page('again'),
  'dist/nocache/index.html': page('nocache'),
  'dist/two/a/b/index.html': page('two'),
};

/** The test headers of an answer. */
const ruled = (answer: Answer): Record<string, unknown> =>
  Object.fromEntries(
    ['x-all', 'x-room', 'x-param', 'x-absolute', 'x-two']
      .filter((name) => answer.headers[name] !== undefined)
      .map((name) => [name, answer.headers[name]]),
  );

test('_headers applies by path to an answer of any status, in file order, with repeated values comma-joined', async () => {
  await served(RULED, async (server) => {
    assert.deepEqual(ruled(await call(server.origin, '/')), { 'x-all': 'one' }, '200: /:any* needs a character');
    const all = { 'x-all': 'one, two' };
    assert.deepEqual(ruled(await call(server.origin, '/zimmer')), all, '307: /zimmer is not under /zimmer/');
    assert.deepEqual(ruled(await call(server.origin, '/zimmer/')), { ...all, 'x-room': 'yes' }, '200 under /zimmer/');
    assert.deepEqual(ruled(await call(server.origin, '/x/')), all, '404');
    assert.deepEqual(ruled(await call(server.origin, '/fr/x/')), { ...all, 'x-param': 'yes' }, ':lang');
    assert.deepEqual(ruled(await call(server.origin, '/zimmer/', 'POST')), { ...all, 'x-room': 'yes' }, '405');
    assert.deepEqual(ruled(await call(server.origin, '/zimmer/', 'HEAD')), { ...all, 'x-room': 'yes' }, 'HEAD');
    const asset = await call(server.origin, '/_astro/gone.css');
    assert.equal(asset.status, 404);
    assert.equal(asset.headers['cache-control'], 'public, max-age=31536000, immutable', 'a 404 for /_astro/');
  });
});

test('_headers skips absolute patterns and patterns with two *, and :name does not cross a /', async () => {
  await served(RULED, async (server) => {
    assert.deepEqual(ruled(await call(server.origin, '/a/b/x/')), { 'x-all': 'one, two' });
    assert.deepEqual(ruled(await call(server.origin, '/two/a/b/')), { 'x-all': 'one, two' });
  });
});

test('! Name detaches the header for the rest of the pass, and a later rule sets it again', async () => {
  await served(RULED, async (server) => {
    assert.deepEqual(ruled(await call(server.origin, '/plain/')), {});
    assert.deepEqual(ruled(await call(server.origin, '/plain/again/')), { 'x-all': 'again' });
    assert.equal((await call(server.origin, '/nocache/')).headers['cache-control'], undefined);
    assert.equal((await call(server.origin, '/zimmer/')).headers['cache-control'], FILE_CACHE);
  });
});

test('the headers option applies to every answer before _headers, and _headers itself is no file', async () => {
  await served(
    RULED,
    async (server) => {
      const home = await call(server.origin, '/');
      assert.equal(home.headers['content-security-policy'], "default-src 'self'");
      assert.equal(home.headers['x-all'], 'one', 'a rule of _headers replaces the value of the option');
      for (const file of ['/_headers', '/_redirects', '/.assetsignore', '/wrangler.json']) {
        const answer = await call(server.origin, file);
        assert.deepEqual(brief(answer), [404, undefined, NOT_FOUND], file);
        assert.equal(answer.headers['content-security-policy'], "default-src 'self'", file);
      }
    },
    { headers: { 'Content-Security-Policy': "default-src 'self'", 'X-All': 'option' } },
    (dir) => {
      writeFileSync(join(dir, 'dist/_redirects'), '');
      writeFileSync(join(dir, 'dist/.assetsignore'), 'wrangler.json\n.dev.vars\n');
      writeFileSync(join(dir, 'dist/wrangler.json'), '{}');
    },
  );
});

test('a dotted folder such as .well-known is served', async () => {
  await served({ 'dist/.well-known/security.txt': 'Contact: x' }, async (server) => {
    assert.deepEqual(brief(await call(server.origin, '/.well-known/security.txt')), [200, undefined, 'Contact: x']);
  });
});

test('patternMatches reads * as any text and :name as one or more characters other than /', () => {
  const cases: readonly [pattern: string, path: string, matches: boolean][] = [
    ['/*', '/', true],
    ['/*', '/a/b', true],
    ['/_astro/*', '/_astro/a.css', true],
    ['/_astro/*', '/_astro', false],
    ['/a', '/a', true],
    ['/a', '/a/', false],
    ['/:lang/', '/fr/', true],
    ['/:lang/', '//', false],
    ['/:lang/', '/fr/x/', false],
    ['/:a/:b', '/x/y', true],
    ['/:a*', '/x/y', true],
    ['/:a*b', '/xb', true],
    ['/a.:ext', '/a.css', true],
    ['/a.:ext', '/abcss', false],
    ['/a/:x-y', '/a/1-y', true],
    ['/*/*', '/a/b', false],
    ['/*:splat', '/a', false],
    ['/:a/:a', '/x/y', false],
    ['https://example.ch/*', '/a', false],
    ['/:1', '/:1', true],
  ];
  assert.deepEqual(
    cases.map(([pattern, path]) => patternMatches(pattern, path)),
    cases.map(([, , matches]) => matches),
  );
});

test('patternMatches takes linear time on a hostile pattern and path', () => {
  const pattern = `/${'x'.repeat(50)}*${'x'.repeat(50)}`;
  const start = process.hrtime.bigint();
  assert.equal(patternMatches(pattern, `/${'x'.repeat(20_000)}y`), false);
  assert.ok(process.hrtime.bigint() - start < 5_000_000_000n);
});

// Compression

const TEXT = `<!doctype html><title>home</title>${'<p>Zimmer mit Aussicht.</p>'.repeat(200)}`;
const COMPRESS: Files = {
  'dist/index.html': TEXT,
  'dist/a.svg': `<svg>${'<g/>'.repeat(200)}</svg>`,
  'dist/a.json': JSON.stringify({ a: 'b'.repeat(2_000) }),
  'dist/a.png': Buffer.alloc(4_000, 7),
  'dist/a.wasm': Buffer.alloc(4_000, 7),
};

const DECODE = new Map<string, (body: Buffer) => Buffer>([
  ['zstd', (body) => zstdDecompressSync(body)],
  ['br', (body) => brotliDecompressSync(body)],
  ['gzip', (body) => gunzipSync(body)],
]);

test('text answers are compressed with zstd, then br, then gzip, with vary and content-length', async () => {
  await served(COMPRESS, async (server) => {
    const accepted = new Map([
      ['gzip, deflate, br, zstd', 'zstd'],
      ['gzip, br', 'br'],
      ['gzip', 'gzip'],
      ['zstd;q=0, br;q=0.1, gzip', 'br'],
      ['zstd;q=0, *', 'br'],
      ['*;q=0.5', 'zstd'],
      ['ZSTD', 'zstd'],
      ['zstd;q=2, gzip', 'gzip'],
    ]);
    for (const [header, encoding] of accepted) {
      for (const path of ['/', '/a.svg', '/a.json']) {
        const answer = await call(server.origin, path, 'GET', { 'accept-encoding': header });
        assert.equal(answer.headers['content-encoding'], encoding, `${path} with ${header}`);
        assert.equal(answer.headers.vary, 'accept-encoding');
        assert.equal(answer.headers['content-length'], String(answer.body.byteLength));
        const decode = DECODE.get(encoding);
        assert.ok(decode);
        const file = path === '/' ? TEXT : String(COMPRESS[`dist${path}`]);
        assert.equal(decode(answer.body).toString('utf8'), file);
      }
    }
  });
});

test('no compression for q=0, for no accept-encoding and for a type off the list', async () => {
  await served(COMPRESS, async (server) => {
    for (const header of ['zstd;q=0, br;q=0, gzip;q=0', '*;q=0', 'identity', 'deflate', '']) {
      const answer = await call(server.origin, '/', 'GET', header === '' ? {} : { 'accept-encoding': header });
      assert.equal(answer.headers['content-encoding'], undefined, header);
      assert.equal(answer.headers.vary, 'accept-encoding', header);
      assert.equal(answer.body.toString('utf8'), TEXT);
      assert.equal(answer.headers['content-length'], String(Buffer.byteLength(TEXT)));
    }
    for (const path of ['/a.png', '/a.wasm']) {
      const answer = await call(server.origin, path, 'GET', { 'accept-encoding': 'zstd, br, gzip' });
      assert.equal(answer.headers['content-encoding'], undefined, path);
      assert.equal(answer.headers.vary, undefined, path);
      assert.equal(answer.headers['content-length'], '4000');
      assert.equal(answer.body.byteLength, 4_000);
    }
  });
});

test('encodingOf and isCompressible', () => {
  assert.deepEqual(
    [undefined, '', 'br;q=0.000', 'br;q=1.000', 'br ; q=0.5', 'gzip;level=1', 'zstd;q=x, gzip'].map(encodingOf),
    [undefined, undefined, undefined, 'br', 'br', 'gzip', 'gzip'],
  );
  assert.deepEqual(
    ['text/plain; charset=utf-8', 'TEXT/HTML', 'image/svg+xml', 'application/manifest+json', 'application/xml'].map(
      isCompressible,
    ),
    [true, true, true, true, true],
  );
  assert.deepEqual(['image/png', 'application/wasm', 'application/pdf', 'font/woff2'].map(isCompressible), [
    false,
    false,
    false,
    false,
  ]);
});

// Methods

test('HEAD gets the status and the headers of GET and no body', async () => {
  await served({ ...PAGES, ...COMPRESS }, async (server) => {
    for (const path of ['/', '/zimmer', '/x/', '/a.png']) {
      const headers = { 'accept-encoding': 'br' };
      const [get, head] = [
        await call(server.origin, path, 'GET', headers),
        await call(server.origin, path, 'HEAD', headers),
      ];
      assert.equal(head.status, get.status, path);
      assert.equal(head.body.byteLength, 0, path);
      assert.ok(get.headers['content-length'] !== '0' || get.status === 307, path);
      for (const name of ['content-type', 'content-length', 'content-encoding', 'cache-control', 'location', 'vary']) {
        assert.equal(head.headers[name], get.headers[name], `${path}: ${name}`);
      }
    }
  });
});

test('other methods get 405 with allow: GET, HEAD and no body', async () => {
  await served(PAGES, async (server) => {
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS']) {
      for (const path of ['/', '/zimmer', '/x/']) {
        const answer = await call(server.origin, path, method);
        assert.deepEqual(brief(answer), [405, undefined, ''], `${method} ${path}`);
        assert.equal(answer.headers.allow, ALLOW);
      }
    }
    const get = await call(server.origin, '/');
    assert.equal(get.status, 200);
    assert.equal(get.headers.allow, undefined);
  });
});

// Observing requests

test('a caller observes each request with its method, its target and its headers', async () => {
  const seen: Received[] = [];
  await served(
    PAGES,
    async (server) => {
      await call(server.origin, '/zimmer/?a=1', 'GET', { 'sec-purpose': 'prefetch;prerender' });
      await call(server.origin, '/x', 'POST');
      assert.deepEqual(
        server.received.map((request) => [request.method, request.path, request.headers['sec-purpose']]),
        [
          ['GET', '/zimmer/?a=1', 'prefetch;prerender'],
          ['POST', '/x', undefined],
        ],
      );
      assert.deepEqual(seen, server.received);
    },
    { onRequest: (request) => seen.push(request) },
  );
});

test('an observer that throws changes no answer', async () => {
  await served(
    PAGES,
    async (server) => {
      assert.equal((await call(server.origin, '/')).status, 200);
      assert.equal(server.received.length, 1);
    },
    {
      onRequest: () => {
        throw new Error('observer');
      },
    },
  );
});

// The folder

test('serveDist serves dist/client when it is the client directory of an adapter build', async () => {
  await served({ 'dist/client/index.html': page('client'), 'dist/server/entry.mjs': '' }, async (server, dir) => {
    assert.equal(server.root, join(dir, 'dist/client'));
    assert.deepEqual(brief(await call(server.origin, '/')), [200, undefined, page('client')]);
  });
});

test('serveDist serves dist when dist/index.html exists, also beside a page folder named client', async () => {
  await served({ 'dist/index.html': page('home'), 'dist/client/index.html': page('a page') }, async (server, dir) => {
    assert.equal(server.root, join(dir, 'dist'));
    assert.deepEqual(brief(await call(server.origin, '/')), [200, undefined, page('home')]);
    assert.deepEqual(brief(await call(server.origin, '/client/')), [200, undefined, page('a page')]);
  });
});

test('clientDir gives dist for a folder with no client directory', async () => {
  const dir = folderOf({ 'dist/a.txt': 'a' });
  try {
    assert.equal(await clientDir(join(dir, 'dist')), join(dir, 'dist'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Large files

test('a large file is streamed whole, with its length', async () => {
  const large = Buffer.alloc(3 * 1024 * 1024);
  for (let index = 0; index < large.length; index += 1) large[index] = (index * 31) % 251;
  await served({ 'dist/photo.jpg': large }, async (server) => {
    const answer = await call(server.origin, '/photo.jpg', 'GET', { 'accept-encoding': 'zstd' });
    assert.equal(answer.status, 200);
    assert.equal(answer.headers['content-length'], String(large.byteLength));
    assert.ok(answer.body.equals(large));
  });
});

test('a text file over the compression limit is streamed whole, with vary and no encoding', async () => {
  const large = Buffer.alloc(9 * 1024 * 1024, 'a');
  await served({ 'dist/big.txt': large }, async (server) => {
    const answer = await call(server.origin, '/big.txt', 'GET', { 'accept-encoding': 'zstd, br, gzip' });
    assert.equal(answer.status, 200);
    assert.equal(answer.headers['content-encoding'], undefined);
    assert.equal(answer.headers.vary, 'accept-encoding');
    assert.equal(answer.headers['content-length'], String(large.byteLength));
    assert.ok(answer.body.equals(large));
  });
});

test('zstd uses level 3 and brotli quality 5: the body is the bytes of node:zlib at that level', async () => {
  const zstdAsync = promisify(zstdCompress);
  const brotliAsync = promisify(brotliCompress);
  await served(COMPRESS, async (server) => {
    const text = Buffer.from(TEXT);
    const zstd = await call(server.origin, '/', 'GET', { 'accept-encoding': 'zstd' });
    const zstdLevel = (level: number): Promise<Buffer> =>
      zstdAsync(text, { params: { [constants.ZSTD_c_compressionLevel]: level } });
    assert.ok(zstd.body.equals(await zstdLevel(3)), 'zstd level 3');
    assert.ok(!(await zstdLevel(3)).equals(await zstdLevel(19)), 'the levels give other bytes for this text');
    const br = await call(server.origin, '/', 'GET', { 'accept-encoding': 'br' });
    const brQuality = (quality: number): Promise<Buffer> =>
      brotliAsync(text, { params: { [constants.BROTLI_PARAM_QUALITY]: quality } });
    assert.ok(br.body.equals(await brQuality(5)), 'brotli quality 5');
    assert.ok(!(await brQuality(5)).equals(await brQuality(11)), 'the qualities give other bytes for this text');
  });
});

// Etag and conditional requests

test('a file answer has an etag, and If-None-Match with it, strong or weak, gets 304 with no body', async () => {
  await served(PAGES, async (server) => {
    const first = await call(server.origin, '/zimmer/');
    const etag = first.headers.etag;
    assert.match(etag ?? '', /^"[0-9a-f]{32}"$/);
    assert.equal((await call(server.origin, '/zimmer/')).headers.etag, etag, 'the etag is stable');
    assert.notEqual((await call(server.origin, '/')).headers.etag, etag, 'another file has another etag');
    for (const match of [etag ?? '', `W/${etag}`]) {
      const again = await call(server.origin, '/zimmer/', 'GET', { 'if-none-match': match, 'accept-encoding': 'br' });
      assert.deepEqual(brief(again), [304, undefined, ''], match);
      assert.equal(again.headers.etag, etag);
      assert.equal(again.headers['cache-control'], FILE_CACHE);
      assert.equal(again.headers['content-type'], 'text/html; charset=utf-8');
      assert.equal(again.headers['content-encoding'], undefined);
    }
    for (const match of ['"other"', '*', `${etag}, "other"`]) {
      const other = await call(server.origin, '/zimmer/', 'GET', { 'if-none-match': match });
      assert.equal(other.status, 200, match);
    }
    const missing = await call(server.origin, '/gone/');
    assert.equal(missing.status, 404);
    assert.equal(missing.headers.etag, (await call(server.origin, '/404')).headers.etag, 'the 404 page has its etag');
    assert.equal((await call(server.origin, '/zimmer')).headers.etag, undefined, 'a redirect has no etag');
  });
});

test('the etag changes when the file changes', async () => {
  await served(PAGES, async (server, dir) => {
    const before = (await call(server.origin, '/zimmer/')).headers.etag;
    utimesSync(join(dir, 'dist/zimmer/index.html'), new Date(2_000_000_000_000), new Date(2_000_000_000_000));
    const after = (await call(server.origin, '/zimmer/', 'GET', { 'if-none-match': before ?? '' })).headers.etag;
    assert.notEqual(after, before);
  });
});

test('a request with Authorization or Range gets no cache-control, as Workers static assets give it', async () => {
  await served(PAGES, async (server) => {
    for (const headers of [{ authorization: 'Basic eDp5' }, { range: 'bytes=0-9' }]) {
      const answer = await call(server.origin, '/zimmer/', 'GET', headers);
      assert.deepEqual(brief(answer), [200, undefined, page('zimmer')], JSON.stringify(headers));
      assert.equal(answer.headers['cache-control'], undefined, JSON.stringify(headers));
    }
  });
});

// The html handling of auto-trailing-slash

test('the html handling serves a.html at /a, and redirects the other names of a page to one name', async () => {
  await served(
    {
      ...PAGES,
      'dist/t/page.html': page('page'),
      'dist/t/both.html': page('both file'),
      'dist/t/both/index.html': page('both folder'),
      'dist/t/index/index.html': page('index folder'),
    },
    async (server) => {
      const answers = new Map<string, [number, string | undefined, string]>([
        ['/index', [307, '/', '']],
        ['/zimmer/index', [307, '/zimmer/', '']],
        ['/zimmer.html', [307, '/zimmer/', '']],
        ['/zimmer.html?q=1', [307, '/zimmer/?q=1', '']],
        ['/404/', [307, '/404', '']],
        ['/404/index.html', [307, '/404', '']],
        ['/t/page', [200, undefined, page('page')]],
        ['/t/page.html', [307, '/t/page', '']],
        ['/t/page/', [307, '/t/page', '']],
        ['/t/page?q=1', [200, undefined, page('page')]],
        ['/t/both', [200, undefined, page('both file')]],
        ['/t/both/', [200, undefined, page('both folder')]],
        ['/t/both.html', [307, '/t/both', '']],
        ['/t/index/', [200, undefined, page('index folder')]],
        ['/t/gone.html', [404, undefined, NOT_FOUND]],
        ['/t/gone/index', [404, undefined, NOT_FOUND]],
      ]);
      for (const [target, answer] of answers)
        assert.deepEqual(brief(await call(server.origin, target)), answer, target);
    },
  );
});

test('a method other than GET and HEAD gets 405 before the html handling redirects', async () => {
  await served(PAGES, async (server) => {
    for (const target of ['/zimmer', '/zimmer/index.html', '/404.html', '//zimmer/']) {
      const answer = await call(server.origin, target, 'POST');
      assert.deepEqual(brief(answer), [405, undefined, ''], target);
      assert.equal(answer.headers.allow, ALLOW, target);
    }
  });
});

test('with no 404.html, a POST to a missing path answers 404 Not found, as no file answers it', async () => {
  await served({ 'dist/index.html': page('home') }, async (server) => {
    assert.deepEqual(brief(await call(server.origin, '/gone/', 'POST')), [404, undefined, NOT_FOUND_TEXT]);
    assert.deepEqual(brief(await call(server.origin, '/', 'POST')), [405, undefined, '']);
  });
});

// `_redirects`

const REDIRECTS = [
  '# a comment',
  '/alt /zimmer/ 301',
  '/alt2/ /fr/ 302',
  '/plain /zimmer/',
  '/see /zimmer/ 303',
  '/temp /zimmer/ 307',
  '/perm /zimmer/ 308',
  '/proxy /zimmer/ 200',
  '/query /zimmer/?from=rule 301',
  '/away https://example.ch/x 301 # a note',
  '/bad /zimmer/ 404',
  '/alt /fr/ 302',
  '/old/* /new/:splat 301',
  '/news/:year/:slug /blog/:year-:slug/ 301',
  '/late /zimmer/ 301',
  '',
].join('\n');

test('_redirects: static rules by exact path, then dynamic rules with the placeholders, and the query kept', async () => {
  await served({ ...PAGES, 'dist/_redirects': REDIRECTS }, async (server) => {
    const answers = new Map<string, [number, string | undefined, string]>([
      ['/alt', [301, '/zimmer/', '']],
      ['/alt?q=1', [301, '/zimmer/?q=1', '']],
      ['/alt2/', [302, '/fr/', '']],
      ['/plain', [302, '/zimmer/', '']],
      ['/see', [303, '/zimmer/', '']],
      ['/temp', [307, '/zimmer/', '']],
      ['/perm', [308, '/zimmer/', '']],
      ['/query?q=1', [301, '/zimmer/?from=rule', '']],
      ['/away?q=1', [301, 'https://example.ch/x?q=1', '']],
      ['/bad', [404, undefined, NOT_FOUND]],
      ['/old/x/y', [301, '/new/x/y', '']],
      ['/old/', [301, '/new/', '']],
      ['/news/2026/ski', [301, '/blog/2026-ski/', '']],
      ['/late', [301, '/zimmer/', '']],
      ['/alt/', [404, undefined, NOT_FOUND]],
    ]);
    for (const [target, answer] of answers) assert.deepEqual(brief(await call(server.origin, target)), answer, target);
    assert.deepEqual(brief(await call(server.origin, '/proxy')), [200, undefined, page('zimmer')], 'a 200 rule serves');
    const posted = await call(server.origin, '/alt', 'POST');
    assert.deepEqual(brief(posted), [301, '/zimmer/', ''], 'a redirect comes before the method check');
  });
});

test('redirectRules keeps the rules as the parser of workers-shared does', () => {
  const rules = redirectRules(
    [
      '/a /b',
      '/a /c 301',
      'nofrom /d 301',
      '/x?q=1 /e',
      '/sp ace',
      '/many /to 301 extra',
      'https://example.ch/abs /f 301',
      '/proxy https://example.ch/ 200',
      '/folder/ /index.html 301',
      '/all/* /x/index 301',
      '/dyn/:a /g/:a',
      '/static /h 301',
      '/two/*/* /i 301',
    ].join('\n'),
  );
  assert.deepEqual(
    [...rules.statics].map(([from, rule]) => [from, rule.status, rule.to]),
    [
      ['/a', 302, '/b'],
      ['/nofrom', 301, '/d'],
      ['/x', 302, '/e'],
    ],
  );
  assert.deepEqual(
    rules.dynamics.map((rule) => [rule.status, rule.to]),
    [
      [302, '/g/:a'],
      [301, '/h'],
    ],
  );
});

// `_headers`: placeholders, stored patterns, repeated patterns, framing

test('_headers replaces :splat and :name in the values with the text that they matched', async () => {
  await served(
    {
      ...PAGES,
      'dist/_headers': [
        '/t/*',
        '  X-Star: star-:splat',
        '/t/:file.json',
        '  X-Name: name-:file',
        '/t/p/:a/:b',
        '  X-Ph: :a+:b',
        '/t/ph/:x.txt',
        '  X-PhX: :x',
        '',
      ].join('\n'),
      'dist/t/a.json': '{}',
      'dist/t/detach/a.txt': 'a',
      'dist/t/p/x/y.txt': 'y',
      'dist/t/ph/a.b.txt': 'b',
    },
    async (server) => {
      const values = async (target: string): Promise<unknown[]> => {
        const { headers } = await call(server.origin, target);
        return ['x-star', 'x-name', 'x-ph', 'x-phx'].map((name) => headers[name]);
      };
      assert.deepEqual(await values('/t/detach/a.txt'), ['star-detach/a.txt', undefined, undefined, undefined]);
      assert.deepEqual(await values('/t/a.json'), ['star-a.json', 'name-a', undefined, undefined]);
      assert.deepEqual(await values('/t/p/x/y.txt'), ['star-p/x/y.txt', undefined, 'x+y.txt', undefined]);
      assert.deepEqual(await values('/t/ph/a.b.txt'), ['star-ph/a.b.txt', undefined, undefined, 'a.b']);
      assert.deepEqual(await values('/t/gone/'), ['star-gone/', undefined, undefined, undefined]);
    },
  );
});

test('_headers stores each pattern in its URL form, so a space, a non-ASCII name, ? and ./ match as on Cloudflare', async () => {
  await served(
    {
      'dist/_headers': [
        '/t/space/a b.txt',
        '  X-Hit: space',
        '/t/zürich/*',
        '  X-Hit: uni',
        '/t/q?x=1',
        '  X-Hit: query',
        '/t/hash#x',
        '  X-Hit: hash',
        '/t/./dot/*',
        '  X-Hit: dot',
        '',
      ].join('\n'),
      'dist/t/space/a b.txt': 's',
      'dist/t/zürich/index.html': page('z'),
      'dist/t/q': 'q',
      'dist/t/hash': 'h',
      'dist/t/dot/a.txt': 'd',
    },
    async (server) => {
      const hits = new Map([
        ['/t/space/a%20b.txt', 'space'],
        ['/t/z%C3%BCrich/', 'uni'],
        ['/t/q', 'query'],
        ['/t/hash', 'hash'],
        ['/t/dot/a.txt', 'dot'],
      ]);
      for (const [target, hit] of hits) assert.equal((await call(server.origin, target)).headers['x-hit'], hit, target);
    },
  );
});

test('a second rule for one pattern replaces the first, in the place of the first', async () => {
  await served(
    {
      'dist/_headers': [
        '/t/dupe.txt',
        '  X-First: 1',
        '  X-Order: a',
        '/t/*',
        '  X-Order: b',
        '/t/dupe.txt',
        '  X-Second: 2',
        '  X-Order: c',
        '',
      ].join('\n'),
      'dist/t/dupe.txt': 'd',
    },
    async (server) => {
      const { headers } = await call(server.origin, '/t/dupe.txt');
      assert.deepEqual([headers['x-first'], headers['x-second'], headers['x-order']], [undefined, '2', 'c, b']);
    },
  );
});

test('a detach needs "! " with a space: "!<TAB>Name" is no detach', async () => {
  await served(
    {
      'dist/_headers': [
        '/*',
        '  Referrer-Policy: same-origin',
        '/tab/*',
        '  !\tReferrer-Policy',
        '/space/*',
        '  ! Referrer-Policy',
        '',
      ].join('\n'),
      'dist/tab/a.txt': 'a',
      'dist/space/a.txt': 'a',
    },
    async (server) => {
      assert.equal((await call(server.origin, '/tab/a.txt')).headers['referrer-policy'], 'same-origin');
      assert.equal((await call(server.origin, '/space/a.txt')).headers['referrer-policy'], undefined);
    },
  );
});

test('_headers never sets a framing header, so a rule cannot break the length or the encoding of an answer', async () => {
  await served(
    {
      'dist/_headers': [
        '/len/*',
        '  Content-Length: 3',
        '  Transfer-Encoding: chunked',
        '  Content-Encoding: gzip',
        '  Connection: close',
        '  ! Content-Length',
        '  X-Kept: yes',
        '',
      ].join('\n'),
      'dist/len/index.html': 'lengthy body',
    },
    async (server) => {
      const answer = await call(server.origin, '/len/');
      assert.deepEqual(brief(answer), [200, undefined, 'lengthy body']);
      assert.equal(answer.headers['content-length'], '12');
      assert.equal(answer.headers['transfer-encoding'], undefined);
      assert.equal(answer.headers['content-encoding'], undefined);
      assert.equal(answer.headers['x-kept'], 'yes');
      const zstd = await call(server.origin, '/len/', 'GET', { 'accept-encoding': 'zstd' });
      assert.equal(zstd.headers['content-encoding'], 'zstd');
      assert.equal(zstdDecompressSync(zstd.body).toString('utf8'), 'lengthy body');
    },
  );
});

test('a _headers line that Node cannot send is skipped, and the page is still served', async () => {
  await served(
    {
      'dist/_headers': [
        '/*',
        '  X-A: one\rSet-Cookie: evil=1',
        '  X-Price: 5 €',
        '  X(A): v',
        '  X-C: a\u0001b',
        '  X-L: grüezi',
        '  X-Ok: ok',
        '',
      ].join('\n'),
      'dist/index.html': page('home'),
    },
    async (server) => {
      const answer = await call(server.origin, '/');
      assert.deepEqual(brief(answer), [200, undefined, page('home')]);
      assert.equal(answer.headers['x-ok'], 'ok');
      assert.equal(answer.headers['x-l'], 'grüezi', 'a Latin-1 value is sent');
      for (const name of ['x-a', 'set-cookie', 'x-price', 'x-c']) assert.equal(answer.headers[name], undefined, name);
    },
  );
});

test('headerRules keeps at most 100 rules and skips lines over 2,000 characters', () => {
  const many = Array.from({ length: 120 }, (_, index) => `/r${index}/*\n  X-R: ${index}\n`).join('');
  assert.equal(headerRules(many).length, 100);
  assert.deepEqual(headerRules(`/*\n  X-Long: ${'a'.repeat(2_100)}\n  X-Short: b\n`)[0]?.set, [['x-short', 'b']]);
  assert.deepEqual(headerRules('/*\n  X-A: 1\n  x-a: 2\n')[0]?.set, [['x-a', '1, 2']]);
});

test('patternParts builds the groups of the asset worker: a placeholder text stands for a group wherever it occurs', () => {
  assert.equal(patternParts('/:a/:ab'), undefined, ':a also stands in :ab, so the group a is named twice');
  assert.equal(patternParts('/:a/:a'), undefined);
  assert.equal(patternParts('/*/*'), undefined);
  assert.equal(patternParts('/*/:splat'), undefined);
  assert.ok(patternParts('/*/:splatx'));
  assert.deepEqual(
    [...(matchParts(patternParts('/:ab/:a') ?? [], '/x/y') ?? [])],
    [
      ['ab', 'x'],
      ['a', 'y'],
    ],
  );
});

test('matchParts gives the groups of the greedy regular expression', () => {
  const groups = (pattern: string, path: string): [string, string][] | undefined => {
    const found = matchParts(patternParts(pattern) ?? [], path);
    return found === undefined ? undefined : [...found];
  };
  assert.deepEqual(groups('/*', '/a/b'), [['splat', 'a/b']]);
  assert.deepEqual(groups('/*.:ext', '/a.b.c'), [
    ['splat', 'a.b'],
    ['ext', 'c'],
  ]);
  assert.deepEqual(groups('/:a*', '/xyz'), [
    ['a', 'xyz'],
    ['splat', ''],
  ]);
  assert.deepEqual(groups('/:a.:b', '/x.y.z'), [
    ['a', 'x.y'],
    ['b', 'z'],
  ]);
  assert.deepEqual(groups('/*/:last', '/a/b/c'), [
    ['splat', 'a/b'],
    ['last', 'c'],
  ]);
  assert.equal(groups('/:a', '/'), undefined);
  assert.deepEqual(groups('/a', '/a'), []);
});

test('normalizePattern gives the URL form of a pattern', () => {
  assert.deepEqual(['/a b', '/zürich/*', '/q?x=1', '/h#x', '/./a/../b', '/:lang/*'].map(normalizePattern), [
    '/a%20b',
    '/z%C3%BCrich/*',
    '/q',
    '/h',
    '/b',
    '/:lang/*',
  ]);
});

// `.assetsignore`

test('.assetsignore hides files as .gitignore does: a name at any depth, a path from the root, globs and !', async () => {
  await served(
    {
      'dist/.assetsignore': ['secret.txt', 't/ignored.txt', '*.bak', 'drafts/', '!keep.bak', '# a comment', ''].join(
        '\n',
      ),
      'dist/404.html': NOT_FOUND,
      'dist/secret.txt': 's',
      'dist/t/secret.txt': 's',
      'dist/t/ignored.txt': 'i',
      'dist/u/t/ignored.txt': 'kept',
      'dist/t/a.bak': 'b',
      'dist/t/keep.bak': 'kept',
      'dist/drafts/a.txt': 'd',
      'dist/x/drafts/a.txt': 'd',
      'dist/drafts.txt': 'kept',
      'dist/sub/wrangler.json': '{}',
      'dist/sub/_headers': 'kept',
    },
    async (server) => {
      for (const target of [
        '/secret.txt',
        '/t/secret.txt',
        '/t/ignored.txt',
        '/t/a.bak',
        '/drafts/a.txt',
        '/x/drafts/a.txt',
      ]) {
        assert.deepEqual(brief(await call(server.origin, target)), [404, undefined, NOT_FOUND], target);
      }
      for (const target of ['/u/t/ignored.txt', '/t/keep.bak', '/drafts.txt', '/sub/_headers']) {
        assert.equal((await call(server.origin, target)).status, 200, target);
      }
    },
  );
});

test('the .assetsignore of the Cloudflare adapter hides its Worker files', async () => {
  await served(
    {
      'dist/client/index.html': page('client'),
      'dist/client/.assetsignore': '_worker.js\n_routes.json\n',
      'dist/client/_worker.js/index.js': 'export default {}',
      'dist/client/_routes.json': '{}',
    },
    async (server) => {
      assert.equal((await call(server.origin, '/')).status, 200);
      for (const target of ['/_worker.js/index.js', '/_routes.json', '/.assetsignore']) {
        assert.deepEqual(brief(await call(server.origin, target)), [404, undefined, NOT_FOUND_TEXT], target);
      }
    },
  );
});

test('globMatches and isIgnored read the globs of .gitignore without backtracking', () => {
  assert.deepEqual(
    [
      ['*.txt', 'a.txt'],
      ['*.txt', 'a.txt.bak'],
      ['a?c', 'abc'],
      ['a?c', 'ac'],
      ['[ab]x', 'bx'],
      ['[!ab]x', 'bx'],
      ['[a-c]x', 'cx'],
      ['\\*', '*'],
      ['\\*', 'a'],
      ['[x', '[x'],
    ].map(([glob = '', name = '']) => globMatches(glob, name)),
    [true, false, true, false, true, false, true, true, false, true],
  );
  const start = process.hrtime.bigint();
  assert.equal(globMatches(`${'*a'.repeat(30)}b`, 'a'.repeat(5_000)), false);
  assert.ok(process.hrtime.bigint() - start < 5_000_000_000n);
  const rules = ignoreRules(['/root.txt', 'a/**', '!a/keep', '**/deep', 'dir/']);
  const hidden = (path: string): boolean => isIgnored(rules, path.split('/'));
  assert.deepEqual(
    ['root.txt', 'x/root.txt', 'a/b', 'a/keep', 'a/b/c', 'x/y/deep', 'deep', 'dir/a', 'dir'].map(hidden),
    [true, false, true, false, true, true, true, true, false],
  );
});

// The error path and the observers

test('an answer that the server cannot send gets 500 with a body, not an empty reply', async () => {
  await served(
    PAGES,
    async (server) => {
      const answer = await call(server.origin, '/');
      assert.deepEqual(brief(answer), [500, undefined, 'Internal error']);
      assert.equal((await call(server.origin, '/zimmer/')).status, 500, 'the server still answers');
    },
    { headers: { 'X-Bad': 'a\rb' } },
  );
});

test('an async observer that rejects changes no answer and does not end the process', async () => {
  let calls = 0;
  await served(
    PAGES,
    async (server) => {
      assert.equal((await call(server.origin, '/')).status, 200);
      assert.equal((await call(server.origin, '/zimmer/')).status, 200);
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(calls, 2);
    },
    {
      onRequest: () => {
        calls += 1;
        return Promise.reject(new Error('async observer'));
      },
    },
  );
});

test('the headers option cannot set a framing header either', async () => {
  await served(
    { 'dist/index.html': 'lengthy body' },
    async (server) => {
      const answer = await call(server.origin, '/');
      assert.deepEqual(brief(answer), [200, undefined, 'lengthy body']);
      assert.equal(answer.headers['content-length'], '12');
      assert.equal(answer.headers['content-encoding'], undefined);
    },
    { headers: { 'Content-Length': '3', 'Content-Encoding': 'gzip' } },
  );
});

test('the root 404 page of the guard gets the rules of _headers for the path that the URL parser gives', async () => {
  await served(
    { 'dist/404.html': NOT_FOUND, 'dist/_headers': '/*\n  X-All: all\n/t/*\n  X-T: :splat\n' },
    async (server) => {
      const answer = await call(server.origin, '/t/%00.txt');
      assert.deepEqual(brief(answer), [404, undefined, NOT_FOUND]);
      assert.deepEqual([answer.headers['x-all'], answer.headers['x-t']], ['all', '%00.txt']);
      const absolute = await call(server.origin, 'http://127.0.0.1/t/a');
      assert.deepEqual([absolute.status, absolute.headers['x-all'], absolute.headers['x-t']], [404, 'all', undefined]);
    },
  );
});

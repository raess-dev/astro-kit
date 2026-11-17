/**
 * The suite's own static server (specification, 14.2): `node:http` on 127.0.0.1 and a free port.
 * It serves a built `dist/` the way a spike needs it: `/a/` gives `/a/index.html`, a missing path gives the nearest
 * `404.html` with status 404, and `headers` are added to every response. It is not the kit's test server.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { dirname, extname, join, normalize, sep } from 'node:path';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
};

/** One request as the server saw it. */
export interface Received {
  method: string;
  /** The path with the query, as in `requests`. */
  path: string;
  /** The request headers, with lower-case names. */
  headers: IncomingHttpHeaders;
}

export interface Served {
  origin: string;
  /** Every request path the server saw, in order. */
  requests: string[];
  /** The same requests, in the same order, with the method and the request headers. */
  received: Received[];
  close(): Promise<void>;
}

export interface ServeOptions {
  /** Headers for every response, for example the header CSP of 6.2. */
  headers?: Record<string, string>;
}

function resolveFile(root: string, pathname: string): string | undefined {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return undefined;
  }
  const file = normalize(join(root, decoded));
  if (file !== root && !file.startsWith(root + sep)) return undefined;
  if (existsSync(file) && statSync(file).isFile()) return file;
  const index = join(file, 'index.html');
  if (decoded.endsWith('/') && existsSync(index)) return index;
  return undefined;
}

/** The nearest `404.html` up the path, as Workers static assets choose it. */
function notFoundFile(root: string, pathname: string): string | undefined {
  let dir = normalize(join(root, pathname));
  if (!dir.startsWith(root)) dir = root;
  for (;;) {
    const candidate = join(dir, '404.html');
    if (existsSync(candidate)) return candidate;
    if (dir === root) return undefined;
    dir = dirname(dir);
    if (!dir.startsWith(root)) return undefined;
  }
}

export function serve(dist: string, options: ServeOptions = {}): Promise<Served> {
  const root = normalize(dist).replace(/[/\\]+$/, '');
  const requests: string[] = [];
  const received: Received[] = [];
  const server: Server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    requests.push(url.pathname + url.search);
    received.push({ method: request.method ?? 'GET', path: url.pathname + url.search, headers: request.headers });
    for (const [name, value] of Object.entries(options.headers ?? {})) response.setHeader(name, value);
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { allow: 'GET, HEAD' }).end();
      return;
    }
    const file = resolveFile(root, url.pathname);
    if (file) {
      const body = readFileSync(file);
      response.writeHead(200, {
        'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
        'cache-control': 'public, max-age=0, must-revalidate',
        'content-length': body.byteLength,
      });
      response.end(request.method === 'HEAD' ? undefined : body);
      return;
    }
    const missing = notFoundFile(root, url.pathname);
    const body = missing ? readFileSync(missing) : Buffer.from('Not found');
    response.writeHead(404, {
      'content-type': missing ? 'text/html; charset=utf-8' : 'text/plain; charset=utf-8',
      'content-length': body.byteLength,
    });
    response.end(request.method === 'HEAD' ? undefined : body);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        origin: `http://127.0.0.1:${port}`,
        requests,
        received,
        close: () =>
          new Promise<void>((done) => {
            server.closeAllConnections();
            server.close(() => done());
          }),
      });
    });
  });
}

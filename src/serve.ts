/**
 * A small static server over dist for the browser checks. It answers like Workers static assets with
 * html_handling auto-trailing-slash and not_found_handling 404-page, applies dist/_headers, and compresses
 * text as Cloudflare does, so the throttled performance pass sees production-sized transfers.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { extname, join, resolve, sep } from 'node:path';
import { brotliCompressSync, constants, gzipSync, zstdCompressSync } from 'node:zlib';
import { CONTACT_ACTION } from './forms/limits.ts';
import { parseHeaders } from './hosts/cloudflare.ts';

const TEXT = (type: string) => `${type}; charset=utf-8`;
export const TYPES: Readonly<Record<string, string>> = {
  '.html': TEXT('text/html'),
  '.css': TEXT('text/css'),
  '.js': TEXT('text/javascript'),
  '.mjs': TEXT('text/javascript'),
  '.txt': TEXT('text/plain'),
  '.vtt': TEXT('text/vtt'),
  '.xml': 'application/xml',
  '.json': 'application/json',
  '.pdf': 'application/pdf',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
};

/** The platform default for assets without a Cache-Control rule. */
export const DEFAULT_CACHE = 'public, max-age=0, must-revalidate';

type Rule = { pattern: RegExp; lines: string[] };

const COMPRESSIBLE = /^(text\/|image\/svg\+xml|application\/(json|xml|manifest\+json))/;

/** The body for the client: zstd, then br, then gzip, for text types, as Cloudflare chooses. */
export function encodeBody(data: Buffer, type: string, accept: string): { body: Buffer; encoding?: string } {
  if (!COMPRESSIBLE.test(type)) return { body: data };
  const offered = new Set(
    accept
      .split(',')
      .map((part) => part.trim().split(';'))
      .filter(([, q]) => !/^\s*q=0(\.0*)?\s*$/.test(q ?? ''))
      .map(([name]) => (name ?? '').trim().toLowerCase()),
  );
  if (offered.has('zstd'))
    return { body: zstdCompressSync(data, { params: { [constants.ZSTD_c_compressionLevel]: 3 } }), encoding: 'zstd' };
  if (offered.has('br'))
    return { body: brotliCompressSync(data, { params: { [constants.BROTLI_PARAM_QUALITY]: 5 } }), encoding: 'br' };
  if (offered.has('gzip')) return { body: gzipSync(data), encoding: 'gzip' };
  return { body: data };
}

/** /* and :name placeholders as in Cloudflare _headers; absolute URL patterns are skipped. */
export function headerRules(text: string): Rule[] {
  return parseHeaders(text)
    .filter((r) => r.pattern.startsWith('/'))
    .map((r) => {
      const source = r.pattern
        .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '.*')
        .replace(/:[A-Za-z]\w*/g, '[^/]+');
      return { pattern: new RegExp(`^${source}$`), lines: r.lines };
    });
}

/** Headers for a path: the defaults, then every matching rule in order. A repeated header joins with a comma; `! Name` detaches. */
export function headersFor(
  rules: readonly Rule[],
  path: string,
  defaults: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = { ...defaults };
  const fromRules = new Set<string>();
  for (const rule of rules) {
    if (!rule.pattern.test(path)) continue;
    for (const line of rule.lines) {
      const detach = /^!\s*(.+)$/.exec(line);
      if (detach?.[1]) {
        const name = detach[1].trim().toLowerCase();
        delete out[name];
        fromRules.delete(name);
        continue;
      }
      const at = line.indexOf(':');
      if (at < 1) continue;
      const name = line.slice(0, at).trim().toLowerCase();
      const value = line.slice(at + 1).trim();
      out[name] = fromRules.has(name) ? `${out[name]}, ${value}` : value;
      fromRules.add(name);
    }
  }
  return out;
}

export interface ServeOptions {
  /** Contact page path per locale; POST /api/contact/ then answers 303 to it plus #sent, like the kit endpoint. */
  contact?: Readonly<Record<string, string>>;
}

export interface Served {
  origin: string;
  close(): Promise<void>;
}

/** The posted form fields; the stub only needs the locale. */
async function body(req: IncomingMessage): Promise<Record<string, string>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  try {
    const form = await new Response(Buffer.concat(chunks), {
      headers: { 'content-type': req.headers['content-type'] ?? '' },
    }).formData();
    return Object.fromEntries([...form].map(([k, v]) => [k, typeof v === 'string' ? v : '']));
  } catch {
    return {};
  }
}

/** Serves dir on 127.0.0.1 at a free port. */
export function serveDist(dir: string, options: ServeOptions = {}): Promise<Served> {
  const root = resolve(dir);
  const headersFile = join(root, '_headers');
  const rules = existsSync(headersFile) ? headerRules(readFileSync(headersFile, 'utf8')) : [];
  const file = (path: string): string | undefined => {
    const full = resolve(root, `.${path}`);
    if (full !== root && !full.startsWith(root + sep)) return undefined;
    return existsSync(full) && statSync(full).isFile() ? full : undefined;
  };

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://kit.invalid');
    let path: string;
    try {
      path = decodeURIComponent(url.pathname);
    } catch {
      path = '/';
    }
    if (req.method === 'POST' && path === CONTACT_ACTION && options.contact) {
      const form = await body(req);
      const pages = options.contact;
      const target = pages[form.locale ?? ''] ?? Object.values(pages)[0] ?? '/';
      res.writeHead(303, { location: `${target}#sent`, 'cache-control': 'private, no-store' }).end();
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { allow: 'GET, HEAD' }).end();
      return;
    }
    // auto-trailing-slash: /a/ serves a/index.html, /a redirects to /a/ when that exists.
    let found = path.endsWith('/') ? file(`${path}index.html`) : file(path);
    if (!found && !path.endsWith('/') && file(`${path}/index.html`)) {
      res.writeHead(307, { location: `${path}/${url.search}` }).end();
      return;
    }
    let status = 200;
    if (!found) {
      found = file('/404.html');
      status = 404;
    }
    const type = (found && TYPES[extname(found).toLowerCase()]) || 'application/octet-stream';
    const headers = headersFor(rules, path, { 'content-type': type, 'cache-control': DEFAULT_CACHE });
    if (!found) {
      res.writeHead(404, { ...headers, 'content-type': 'text/plain; charset=utf-8' }).end('Not found');
      return;
    }
    const accept = String(req.headers['accept-encoding'] ?? '');
    const { body: data, encoding } = encodeBody(readFileSync(found), type, accept);
    const encoded = encoding ? { 'content-encoding': encoding, vary: 'accept-encoding' } : {};
    res.writeHead(status, { ...headers, ...encoded, 'content-length': String(data.length) });
    res.end(req.method === 'HEAD' ? undefined : data);
  });

  return new Promise((done, fail) => {
    server.once('error', fail);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      done({
        origin: `http://127.0.0.1:${port}`,
        close: () =>
          new Promise<void>((ok) => {
            server.closeAllConnections();
            server.close(() => ok());
          }),
      });
    });
  });
}

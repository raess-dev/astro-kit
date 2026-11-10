/**
 * astro-kit smoke <url>: read-only production checks over HTTPS. --probe also posts the contact form once,
 * with the probe secret, so the mail goes to the probe address.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONTACT_ACTION } from './forms/limits.ts';
import { IMMUTABLE, PREFETCH_HTML, robotsTxt, securityHeaders } from './hosts/cloudflare.ts';
import { type KitOptions, loadOptions } from './options.ts';
import { Report } from './registry.ts';

const VERSION = (JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string })
  .version;
export const SMOKE_AGENT = `astro-kit/${VERSION} (+https://github.com/raess-dev/astro-kit; smoke)`;
/** The Workers static assets default for HTML. */
export const HTML_CACHE = 'public, max-age=0, must-revalidate';
const DAY = 86_400_000;

export interface SmokeOptions {
  probe?: boolean;
  root?: string;
  /** The commit /_kit/release.txt must name (or a prefix of it); also read from KIT_RELEASE_SHA. */
  expectedSha?: string;
  /** The production <name>.<account>.workers.dev host, which must not answer; also read from KIT_WORKERS_DEV. */
  workersDev?: string;
  fetch?: typeof fetch;
  env?: Record<string, string | undefined>;
  now?: Date;
}

type Got = { path: string; status: number; headers: Headers; text: string } | { path: string; error: string };
const ok = (g: Got): g is Extract<Got, { status: number }> => 'status' in g;
const state = (g: Got): string =>
  ok(g) ? `answers ${g.status}${g.headers.get('location') ? ` → ${g.headers.get('location')}` : ''}` : g.error;

/** TXT record strings: quoted chunks are joined, as resolvers return long records split. */
export const txtValue = (data: string): string =>
  data.includes('"') ? [...data.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]).join('') : data;

export async function runSmoke(url: string, opts: SmokeOptions = {}): Promise<Report> {
  const report = new Report();
  const call = opts.fetch ?? fetch;
  const env = opts.env ?? process.env;
  const now = opts.now ?? new Date();
  const { origin, hostname: host } = new URL(url);
  const options: KitOptions | undefined = opts.root ? loadOptions(opts.root, report) : undefined;
  const dist = opts.root
    ? [join(opts.root, 'dist/client'), join(opts.root, 'dist')].find((d) => existsSync(join(d, 'index.html')))
    : undefined;
  const built = (name: string): string | undefined =>
    dist && existsSync(join(dist, name)) ? readFileSync(join(dist, name), 'utf8') : undefined;
  const responses: Got[] = [];

  const get = async (
    target: string,
    init: { method?: string; body?: string; headers?: Record<string, string> } = {},
  ): Promise<Got> => {
    const path = target.startsWith('/') ? target : target.replace(/^https?:\/\/[^/]+/, '') || '/';
    const full = target.startsWith('/') ? `${origin}${target}` : target;
    try {
      const r = await call(full, {
        ...init,
        redirect: 'manual',
        headers: { 'user-agent': SMOKE_AGENT, 'accept-encoding': 'br, gzip', ...init.headers },
        signal: AbortSignal.timeout(15_000),
      });
      const got: Got = {
        path: full.startsWith(origin) ? path : full,
        status: r.status,
        headers: r.headers,
        text: await r.text(),
      };
      if (full.startsWith(origin)) responses.push(got);
      return got;
    } catch (error) {
      const code = (error as { cause?: { code?: string } }).cause?.code;
      return { path: full, error: `does not answer: ${(error as Error).message}${code ? ` (${code})` : ''}` };
    }
  };

  // smoke-status: the root and every locale home answer 200; an unknown path answers 404 with the kit 404 page.
  const homes = options ? options.locales.map((l) => (l.code === options.defaultLocale ? '/' : `/${l.code}/`)) : ['/'];
  const pages: Got[] = [];
  for (const path of homes) {
    const page = await get(path);
    pages.push(page);
    if (!ok(page) || page.status !== 200) report.add('smoke-status', `${origin}${path}`, state(page));
  }
  const missingPath = `/kit-smoke-${now.getTime().toString(36)}/`;
  const missing = await get(missingPath);
  const page404 = built('404.html');
  if (!ok(missing) || missing.status !== 404)
    report.add('smoke-status', `${origin}${missingPath}`, `${state(missing)}, expected 404`);
  else if (
    page404 !== undefined ? missing.text !== page404 : !/<meta name="?robots"? content="?noindex/.test(missing.text)
  ) {
    report.add(
      'smoke-status',
      `${origin}${missingPath}`,
      page404 !== undefined ? 'the body differs from dist/404.html' : 'the body is not the kit 404 page',
    );
  }

  // smoke-headers and smoke-cache: the HTML, one /_astro/ asset and the 404 page.
  const home = pages[0];
  const html = home && ok(home) ? home : undefined;
  const assetPath = html?.text.match(/(?:https?:\/\/[^/"'\s]+)?(\/_astro\/[^"'\s)<>,?#]+)/)?.[1];
  const asset = assetPath ? await get(assetPath) : undefined;
  if (!assetPath) console.log('astro-kit smoke: the home page names no /_astro/ asset; the asset checks are skipped');
  else if (asset && (!ok(asset) || asset.status !== 200))
    report.add(
      'smoke-status',
      `${origin}${assetPath}`,
      `${state(asset)}, expected 200 for an asset the home page uses`,
    );
  const kit = securityHeaders(options ?? ({ features: {} } as KitOptions));
  // A missing asset is already a smoke-status finding; the 404 page's own headers are checked as `missing`.
  const assetOk = asset && ok(asset) && asset.status === 200 ? asset : undefined;
  for (const got of [html, assetOk, ok(missing) ? missing : undefined]) {
    if (!got || !ok(got)) continue;
    const wrong = kit.flatMap(([name, value]) => {
      const actual = got.headers.get(name);
      if (actual === null) return [`${name} missing`];
      return options && actual !== value ? [`${name}: ${actual}`] : [];
    });
    if (wrong.length) report.add('smoke-headers', `${origin}${got.path}`, wrong.join('; '));
  }
  const htmlCache = options?.prefetch.astroPrefetch ? PREFETCH_HTML : HTML_CACHE;
  for (const [got, expected] of [...pages.map((p) => [p, htmlCache] as const), [asset, IMMUTABLE] as const]) {
    if (!got || !ok(got) || got.status !== 200) continue;
    const actual = got.headers.get('cache-control');
    if (actual !== expected)
      report.add(
        'smoke-cache',
        `${origin}${got.path}`,
        `Cache-Control is ${actual ?? 'missing'}, expected ${expected}`,
      );
  }

  // smoke-transport: compression, HTTP/3 and one hop from http to https.
  if (html) {
    const encoding = html.headers.get('content-encoding') ?? 'none';
    if (!['zstd', 'br', 'gzip'].includes(encoding))
      report.add('smoke-transport', `${origin}/`, `content-encoding is ${encoding}`);
    if (!/\bh3\b/.test(html.headers.get('alt-svc') ?? ''))
      report.add(
        'smoke-transport',
        `${origin}/`,
        `alt-svc does not advertise h3 (${html.headers.get('alt-svc') ?? 'missing'})`,
      );
  }
  const plain = await get(`http://${host}/`);
  const hop = ok(plain) ? (plain.headers.get('location') ?? '') : '';
  if (!ok(plain) || plain.status < 301 || plain.status > 308 || !hop.startsWith(`https://${host}/`)) {
    report.add('smoke-transport', `http://${host}/`, `${state(plain)}, expected one redirect to https://${host}/`);
  }

  // smoke-redirects: the other www/apex host answers one 301 to this one; workers.dev does not answer.
  const other = host.startsWith('www.') ? host.slice(4) : `www.${host}`;
  const alias = await get(`https://${other}/`);
  if (!ok(alias) || alias.status !== 301 || alias.headers.get('location')?.replace(/\/$/, '') !== origin) {
    report.add('smoke-redirects', `https://${other}/`, `${state(alias)}, expected 301 to ${origin}/`);
  }
  const workersDev = opts.workersDev ?? env.KIT_WORKERS_DEV;
  if (workersDev) {
    const dev = await get(`https://${workersDev.replace(/^https?:\/\/|\/.*$/g, '')}/`);
    if (ok(dev) && dev.status === 200)
      report.add('smoke-redirects', dev.path, 'the workers.dev URL answers 200; set workers_dev false');
  }

  // smoke-robots: byte-equal to the build, or, without a local build (the smoke job), to what the kit writes.
  const robots = await get('/robots.txt');
  const robotsBuilt = built('robots.txt');
  const robotsWanted = robotsBuilt ?? (options ? robotsTxt(options.site) : undefined);
  if (!ok(robots) || robots.status !== 200) report.add('smoke-robots', `${origin}/robots.txt`, state(robots));
  else if (robotsWanted !== undefined && robots.text !== robotsWanted)
    report.add(
      'smoke-robots',
      `${origin}/robots.txt`,
      robotsBuilt !== undefined ? 'differs from dist/robots.txt' : 'differs from the robots.txt the kit writes',
    );

  // smoke-release: release.txt names the expected commit, or at least a commit.
  const release = await get('/_kit/release.txt');
  const expected = opts.expectedSha ?? env.KIT_RELEASE_SHA;
  const sha = ok(release) && release.status === 200 ? (release.text.split('\n')[0] ?? '').trim() : '';
  if (!ok(release) || release.status !== 200) report.add('smoke-release', `${origin}/_kit/release.txt`, state(release));
  else if (expected ? !sha.startsWith(expected) : !/^[0-9a-f]{40}$/.test(sha)) {
    report.add(
      'smoke-release',
      `${origin}/_kit/release.txt`,
      `names ${sha || 'nothing'}${expected ? `, expected ${expected}` : ', not a commit'}`,
    );
  }

  // smoke-security-txt: Expires at least 30 days ahead.
  const security = await get('/.well-known/security.txt');
  const expires =
    ok(security) && security.status === 200
      ? Date.parse(security.text.match(/^Expires:\s*(.+)$/m)?.[1] ?? '')
      : Number.NaN;
  if (!ok(security) || security.status !== 200)
    report.add('smoke-security-txt', `${origin}/.well-known/security.txt`, state(security));
  else if (Number.isNaN(expires))
    report.add('smoke-security-txt', `${origin}/.well-known/security.txt`, 'no valid Expires line');
  else if (expires - now.getTime() < 30 * DAY) {
    report.add(
      'smoke-security-txt',
      `${origin}/.well-known/security.txt`,
      `expires in ${Math.floor((expires - now.getTime()) / DAY)} days`,
    );
  }

  // smoke-injection: on everything fetched from the site.
  for (const got of responses) {
    if (!ok(got)) continue;
    const where = `${origin}${got.path}`;
    if (got.headers.getSetCookie().length) report.add('smoke-injection', where, 'Set-Cookie');
    for (const name of ['nel', 'report-to'])
      if (got.headers.has(name)) report.add('smoke-injection', where, `${name} header`);
    if ((got.headers.get('content-type') ?? '').includes('text/html')) {
      for (const marker of ['/cdn-cgi/', 'data-cfemail'])
        if (got.text.includes(marker)) report.add('smoke-injection', where, `${marker} in the HTML`);
    }
  }

  // smoke-mail-dns: one SPF record and a DMARC record for the sender domain, over DNS over HTTPS.
  if (options?.features.forms) {
    const domain = options.contact?.from.split('@')[1] ?? host;
    const txt = async (name: string): Promise<string[] | string> => {
      try {
        const r = await call(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=TXT`, {
          headers: { accept: 'application/dns-json', 'user-agent': SMOKE_AGENT },
          signal: AbortSignal.timeout(15_000),
        });
        const body = (await r.json()) as { Answer?: { type: number; data: string }[] };
        return (body.Answer ?? []).filter((a) => a.type === 16).map((a) => txtValue(a.data));
      } catch (error) {
        return `DNS over HTTPS failed: ${(error as Error).message}`;
      }
    };
    const spf = await txt(domain);
    if (typeof spf === 'string') report.add('smoke-mail-dns', domain, spf);
    else if (spf.filter((t) => /^v=spf1\b/i.test(t)).length !== 1)
      report.add('smoke-mail-dns', domain, `${spf.filter((t) => /^v=spf1\b/i.test(t)).length} SPF records, expected 1`);
    // DMARC discovery walks up the tree: a policy at a parent domain covers a sender subdomain.
    const labels = domain.split('.');
    let found = false;
    for (let i = 0; i + 2 <= labels.length && !found; i++) {
      const name = `_dmarc.${labels.slice(i).join('.')}`;
      const dmarc = await txt(name);
      if (typeof dmarc === 'string') {
        report.add('smoke-mail-dns', name, dmarc);
        found = true;
      } else found = dmarc.some((t) => /^v=DMARC1\b/i.test(t));
    }
    if (!found) report.add('smoke-mail-dns', `_dmarc.${domain}`, 'no v=DMARC1 record here or at a parent domain');
  }

  // smoke-probe: one real submission with the probe secret. A site without forms has no endpoint to probe.
  if (opts.probe && !options?.features.forms) console.log('astro-kit smoke: probe skipped: features.forms is off');
  else if (opts.probe) {
    const secret = env.KIT_PROBE_SECRET;
    if (!secret) report.add('smoke-probe', `${origin}${CONTACT_ACTION}`, 'KIT_PROBE_SECRET is not set');
    else {
      const body = new URLSearchParams({
        locale: options?.defaultLocale ?? '',
        name: 'astro-kit probe',
        email: `probe@${host}`,
        message: 'Weekly delivery probe from astro-kit smoke.',
      });
      const sent = await get(CONTACT_ACTION, {
        method: 'POST',
        body: body.toString(),
        headers: { 'content-type': 'application/x-www-form-urlencoded', origin, 'x-kit-probe': secret },
      });
      if (!ok(sent) || sent.status !== 303 || !(sent.headers.get('location') ?? '').endsWith('#sent')) {
        report.add('smoke-probe', `${origin}${CONTACT_ACTION}`, `${state(sent)}, expected 303 to #sent`);
      }
    }
  }
  return report;
}

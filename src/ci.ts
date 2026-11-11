/**
 * The commands that run tools, and the route checks that need the base branch or the live site.
 * Each tool runs as one process with the current Node and the bin script from the project's node_modules:
 * never npm, npx or a shell string.
 */
import { spawn, spawnSync } from 'node:child_process';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';
import { stripVTControlCharacters } from 'node:util';
import { urlPathOf } from './build.ts';
import type { RedirectRow } from './context.ts';
import { changedFeatureShims, KIT_VERSION } from './init.ts';
import { buildManifest, PAGES_DIR } from './manifest.ts';
import { type KitOptions, loadOptions, OPTIONS_FILE } from './options.ts';
import { preflight } from './preflight.ts';
import { loadRedirects, REDIRECTS_FILE } from './redirects.ts';
import { formatFindings, Report } from './registry.ts';

export const USER_AGENT = `astro-kit/${KIT_VERSION} (+https://github.com/raess-dev/astro-kit; route check)`;
const QUERY = 'query strings cannot be matched; mark it gone or add a zone Single Redirect';

/** Appends to the GitHub job summary when there is one. */
export function summary(text: string, env = process.env): void {
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `\n\`\`\`text\n${text}\n\`\`\`\n`);
}

export function reportFindings(report: Report): number {
  if (report.ok) return 0;
  const text = formatFindings(report.findings);
  console.error(text);
  summary(text);
  return 1;
}

/** A package's bin script, found the way Node finds the package: up from the project root. */
export function binPath(root: string, pkg: string, name = pkg.split('/').pop() ?? pkg): string {
  for (let dir = root; ; dir = dirname(dir)) {
    const manifest = join(dir, 'node_modules', pkg, 'package.json');
    if (existsSync(manifest)) {
      const { bin } = JSON.parse(readFileSync(manifest, 'utf8')) as { bin?: string | Record<string, string> };
      const rel = typeof bin === 'string' ? bin : bin?.[name];
      if (!rel) throw new Error(`astro-kit: ${pkg} has no bin ${name}`);
      return join(dirname(manifest), rel);
    }
    if (dirname(dir) === dir) throw new Error(`astro-kit: ${pkg} is not installed; run npm ci --ignore-scripts`);
  }
}

/** Runs a tool and streams its output; on failure the kit's finding lines also go to the job summary. */
export function runTool(
  root: string,
  pkg: string,
  args: readonly string[],
  env: Record<string, string> = {},
): Promise<number> {
  const bin = binPath(root, pkg);
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [bin, ...args], {
      cwd: root,
      env: { ...process.env, ASTRO_TELEMETRY_DISABLED: '1', ...env },
      stdio: ['inherit', 'pipe', 'pipe'],
    });
    let out = '';
    const tee = (target: NodeJS.WriteStream) => (chunk: Buffer) => {
      target.write(chunk);
      out = (out + chunk.toString()).slice(-1_000_000);
    };
    child.stdout.on('data', tee(process.stdout));
    child.stderr.on('data', tee(process.stderr));
    child.on('error', (error) => {
      console.error(`astro-kit: ${pkg} did not start: ${error.message}`);
      resolve(1);
    });
    child.on('close', (code) => {
      if (code !== 0) {
        const lines = stripVTControlCharacters(out)
          .split('\n')
          .filter((l) => /✗ \[|^\s+(fix|rule): /.test(l));
        summary(lines.length ? lines.join('\n') : `${pkg} ${args.join(' ')} failed; see the job log.`);
      }
      resolve(code ?? 1);
    });
  });
}

/** The kit's project checks, Biome, the islands lint, then astro check for types. Any finding fails. */
export async function check(root: string): Promise<number> {
  const report = new Report();
  const options = preflight(root, report)?.options;
  if (options?.features.islands)
    for (const path of changedFeatureShims(root, options.features))
      report.add('config-shim', path, 'differs from the kit copy');
  const codes = [
    reportFindings(report),
    await runTool(root, '@biomejs/biome', ['ci', '--colors=off', '--error-on-warnings', '.']),
  ];
  if (options?.features.islands) {
    if (existsSync(join(root, 'src/islands')))
      codes.push(await runTool(root, 'eslint', ['--max-warnings', '0', 'src/islands']));
  }
  codes.push(await runTool(root, 'astro', ['check']));
  return codes.some((c) => c !== 0) ? 1 : 0;
}

export const build = (root: string): Promise<number> => runTool(root, 'astro', ['build']);

// ── routes ───────────────────────────────────────────────────────────────────

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, out);
    else out.push(path);
  }
  return out;
}

/** The static output: dist/client when the adapter builds a Worker, else dist. */
export const staticDir = (root: string): string =>
  existsSync(join(root, 'dist/client')) ? join(root, 'dist/client') : join(root, 'dist');

/** Every path dist serves: pages by URL, other files by file path. */
export function builtPaths(dist: string): Set<string> {
  return new Set(
    walk(dist).map((f) => (f.endsWith('.html') ? urlPathOf(dist, f) : `/${relative(dist, f).split(sep).join('/')}`)),
  );
}

/** auto-trailing-slash answers /a with /a/, and /a/index.html with /a/. */
export const isBuilt = (path: string, built: ReadonlySet<string>): boolean =>
  built.has(path) ||
  built.has(`${path}/`) ||
  (path.endsWith('/index.html') && built.has(path.slice(0, -'index.html'.length)));

const matches = (from: string, path: string): boolean => {
  if (!/[*:]/.test(from)) return from === path;
  const pattern = from
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/:[A-Za-z]\w*/g, '[^/]+');
  return new RegExp(`^${pattern}$`).test(path);
};

export const isRedirected = (path: string, rows: readonly { from: string }[]): boolean =>
  rows.some((r) => matches(r.from, path));

/** Sources that were on the base branch and are gone now. A path that is built again is no loss. */
export const droppedSources = (
  base: readonly string[],
  current: readonly string[],
  built: ReadonlySet<string>,
): string[] => base.filter((from) => !current.includes(from) && !isBuilt(from, built));

/** <loc> values of a sitemap, or one URL or path per line of a list (# starts a comment). */
export function parseUrlList(text: string): string[] {
  if (/<(urlset|sitemapindex)\b/.test(text)) {
    return [...text.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/g)].map((m) => (m[1] ?? '').replace(/&amp;/g, '&'));
  }
  return text
    .split(/\r?\n/)
    .map((l) => l.replace(/#.*$/, '').trim())
    .filter(Boolean);
}

/** The path of a URL or path; query is set when the URL has one. */
export function pathOf(raw: string): { path: string; query: boolean } | undefined {
  try {
    const url = new URL(raw, 'https://kit.invalid');
    return { path: url.pathname, query: url.search !== '' };
  } catch {
    return undefined;
  }
}

/** The redirects.json sources on a git ref, or undefined when the ref is not there. */
export function baseSources(root: string, ref: string): string[] | undefined {
  const git = (...args: string[]) => spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  if (git('rev-parse', '--verify', '--quiet', `${ref}^{commit}`).status !== 0) return undefined;
  const shown = git('show', `${ref}:${REDIRECTS_FILE}`);
  if (shown.status !== 0) return [];
  const rows = JSON.parse(shown.stdout) as unknown;
  return Array.isArray(rows)
    ? rows.map((r) => (r as { from?: unknown }).from).filter((f): f is string => typeof f === 'string')
    : [];
}

/**
 * The page paths published on a git ref, from its astro-kit.json and src/content/pages.
 * No build is needed: the kit's manifest gives every URL. Undefined when the ref has no kit site.
 */
export function basePagePaths(root: string, ref: string): string[] | undefined {
  const git = (...args: string[]) =>
    spawnSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const files = git('ls-tree', '-r', '--name-only', ref, '--', OPTIONS_FILE, PAGES_DIR);
  if (files.status !== 0 || !files.stdout.includes(OPTIONS_FILE)) return undefined;
  const tmp = mkdtempSync(join(tmpdir(), 'kit-base-'));
  try {
    for (const file of files.stdout.split('\n').filter(Boolean)) {
      const shown = git('show', `${ref}:${file}`);
      if (shown.status !== 0) continue;
      mkdirSync(dirname(join(tmp, file)), { recursive: true });
      writeFileSync(join(tmp, file), shown.stdout);
    }
    const report = new Report();
    const options = loadOptions(tmp, report);
    return options ? buildManifest(tmp, options, report, {}).pages.map((p) => p.path) : undefined;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

type Fetch = typeof fetch;
type Live = { paths: string[] } | { skip: string } | { error: string };

/** The live sitemap's paths, following one level of sitemap index. A host that does not resolve or a 404 is a skip. */
export async function liveSitemap(site: string, call: Fetch = fetch): Promise<Live> {
  const get = async (url: string): Promise<{ text: string } | { skip: string } | { error: string }> => {
    try {
      const response = await call(url, {
        headers: { 'user-agent': USER_AGENT },
        redirect: 'follow',
        signal: AbortSignal.timeout(15_000),
      });
      if (response.status === 404) return { skip: `${url} answers 404` };
      if (!response.ok) return { error: `${url} answers ${response.status}` };
      return { text: await response.text() };
    } catch (error) {
      const code = ((error as { cause?: { code?: string } }).cause?.code ?? '') as string;
      if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return { skip: `${new URL(url).host} does not resolve` };
      return { error: `${url}: ${(error as Error).message}${code ? ` (${code})` : ''}` };
    }
  };
  const root = await get(`${site}/sitemap.xml`);
  if (!('text' in root)) return root;
  if (!/<sitemapindex\b/.test(root.text)) return { paths: parseUrlList(root.text) };
  const paths: string[] = [];
  for (const child of parseUrlList(root.text).slice(0, 50)) {
    const part = await get(child);
    if ('error' in part) return part;
    if ('text' in part) paths.push(...parseUrlList(part.text));
  }
  return { paths };
}

/** routes-removed: no base-branch source is dropped, and every live sitemap URL is built or redirected. */
export async function checkRoutes(
  root: string,
  options: KitOptions,
  report: Report,
  call: Fetch = fetch,
  env = process.env,
): Promise<void> {
  const dist = staticDir(root);
  const built = existsSync(dist) ? builtPaths(dist) : new Set<string>();
  const rows: RedirectRow[] = loadRedirects(root, new Report());
  const ref = `origin/${env.GITHUB_BASE_REF || 'main'}`;
  const base = baseSources(root, ref);
  if (!base) {
    if (env.GITHUB_ACTIONS === 'true')
      report.add('routes-removed', ref, 'the base branch is not fetched; check out with fetch-depth: 0');
    else console.log(`astro-kit: ${ref} not found; the base-branch redirect check is skipped`);
  }
  for (const from of droppedSources(
    base ?? [],
    rows.map((r) => r.from),
    built,
  )) {
    report.add('routes-removed', REDIRECTS_FILE, `${from} is a source on ${ref} and is gone`);
  }
  // A page published on the base branch keeps its URL: built again, or redirected.
  if (base) {
    for (const path of basePagePaths(root, ref) ?? []) {
      if (!isBuilt(path, built) && !isRedirected(path, rows))
        report.add('routes-removed', path, `published on ${ref}; add a redirects.json row for it`);
    }
  }
  const live = await liveSitemap(options.site, call);
  if ('skip' in live) console.log(`astro-kit: live sitemap check skipped: ${live.skip}`);
  else if ('error' in live) report.add('routes-removed', `${options.site}/sitemap.xml`, live.error);
  else {
    for (const raw of live.paths) {
      const url = pathOf(raw);
      if (!url) report.add('routes-removed', `${options.site}/sitemap.xml`, `${raw} is not a URL`);
      else if (url.query) report.add('routes-removed', `${options.site}/sitemap.xml`, `${raw}: ${QUERY}`);
      else if (!isBuilt(url.path, built) && !isRedirected(url.path, rows)) {
        report.add(
          'routes-removed',
          `${options.site}/sitemap.xml`,
          `${url.path} is neither built nor a redirects.json source`,
        );
      }
    }
  }
}

/** Adds {from, gone: true} for every listed path that is neither built nor already a source. */
export function importRoutes(root: string, list: string): { added: string[]; rejected: string[] } {
  const dist = staticDir(root);
  if (!existsSync(dist)) throw new Error('astro-kit routes import: no dist/; run `npx --no astro-kit build` first');
  const built = builtPaths(dist);
  const file = join(root, REDIRECTS_FILE);
  const rows = existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as RedirectRow[]) : [];
  if (!Array.isArray(rows)) throw new Error(`astro-kit routes import: ${REDIRECTS_FILE} must be an array`);
  const added: string[] = [];
  const rejected: string[] = [];
  for (const raw of parseUrlList(readFileSync(list, 'utf8'))) {
    const url = pathOf(raw);
    if (!url) rejected.push(`${raw}: not a URL or path`);
    else if (url.query) rejected.push(`${raw}: ${QUERY}`);
    else if (!isBuilt(url.path, built) && !isRedirected(url.path, rows) && !added.includes(url.path)) {
      rows.push({ from: url.path, gone: true });
      added.push(url.path);
    }
  }
  if (added.length) writeFileSync(file, `${JSON.stringify(rows, null, 2)}\n`);
  return { added, rejected };
}

/** check, build, test --all, then the route checks. A failed check or build stops; a failed test still runs the route checks. */
export async function runCi(root: string, test: () => Promise<number>): Promise<number> {
  if ((await check(root)) !== 0) return 1;
  if ((await build(root)) !== 0) return 1;
  const tested = await test().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  });
  const report = new Report();
  const options = loadOptions(root, report);
  if (options) await checkRoutes(root, options, report);
  return reportFindings(report) || tested;
}

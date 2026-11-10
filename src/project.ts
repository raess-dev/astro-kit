import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import type { KitOptions } from './options.ts';
import type { Report } from './registry.ts';
import { normalize, SHIMS } from './shims.ts';

/** Packages the kit itself allows in a site's package.json. */
export const BASE_DEPENDENCIES = ['astro', '@raess/astro-kit'];
export const FEATURE_DEPENDENCIES = {
  forms: ['@astrojs/cloudflare', 'wrangler'],
  islands: ['@astrojs/solid-js', 'solid-js', 'eslint', 'eslint-plugin-solid', 'typescript-eslint'],
  scripts: [] as string[],
} as const;

/** Files the kit generates; a copy in public/ would shadow it. */
export const GENERATED_PUBLIC = ['robots.txt', '_headers', '_redirects', '.well-known/security.txt', '_kit'];
export const PUBLIC_RASTER_ALLOW = ['favicon.ico', 'apple-touch-icon.png', 'og.png', 'og.jpg'];

const SUPPRESSIONS = /(biome-ignore|@ts-ignore|@ts-expect-error|@ts-nocheck)/;
const INTL = /(\.toLocale(Date|Time)?String\s*\(|\bnew\s+Intl\.)/;
const FORBIDDEN_IMPORT = /from\s+['"](astro:i18n|astro:transitions(\/client)?)['"]/;
const RASTER = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.bmp', '.tif', '.tiff']);

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.git')) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, out);
    else out.push(path);
  }
  return out;
}

export function checkShims(root: string, report: Report): void {
  for (const [file, expected] of Object.entries(SHIMS)) {
    const path = join(root, file);
    if (!existsSync(path)) {
      report.add('config-shim', file, 'missing');
      continue;
    }
    if (normalize(readFileSync(path, 'utf8')) !== normalize(expected))
      report.add('config-shim', file, 'content differs');
  }
}

export function checkPackage(root: string, options: KitOptions, report: Report): void {
  const file = join(root, 'package.json');
  if (!existsSync(file)) return;
  const pkg = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
  if (pkg.overrides || pkg.resolutions) report.add('config-overrides', 'package.json', 'remove overrides');
  const allowed = new Set<string>([...BASE_DEPENDENCIES, ...options.dependencies]);
  for (const [feature, deps] of Object.entries(FEATURE_DEPENDENCIES)) {
    if (options.features[feature as keyof typeof FEATURE_DEPENDENCIES]) for (const d of deps) allowed.add(d);
  }
  for (const field of ['dependencies', 'devDependencies', 'optionalDependencies']) {
    const deps = (pkg[field] ?? {}) as Record<string, string>;
    for (const [name, spec] of Object.entries(deps)) {
      if (!allowed.has(name)) report.add('config-dep-allowlist', 'package.json', `${field}.${name}`);
      // The kit itself may be a local tarball in fixtures; its identity is checked in the protected workflow.
      if (name !== '@raess/astro-kit' && /^(git|https?:|file:|link:|github:|[^@\s]+\/[^@\s]+$)/.test(spec)) {
        report.add('config-dep-spec', 'package.json', `${name}@${spec}`);
      }
    }
  }
}

export function checkSources(root: string, options: KitOptions, report: Report): void {
  const files = walk(join(root, 'src')).filter((f) => /\.(astro|ts|tsx|js|mjs|jsx|css|md|mdx)$/.test(f));
  for (const file of files) {
    const rel = relative(root, file);
    const text = readFileSync(file, 'utf8');
    if (SUPPRESSIONS.test(text)) report.add('config-suppression', rel, text.match(SUPPRESSIONS)?.[1]);
    if (/\.(astro|ts|tsx|js|mjs|jsx)$/.test(file)) {
      if (INTL.test(text)) report.add('content-intl', rel, text.match(INTL)?.[0]?.trim());
      if (FORBIDDEN_IMPORT.test(text)) report.add('config-imports', rel, text.match(FORBIDDEN_IMPORT)?.[1]);
    }
    if (file.endsWith('.astro')) {
      if (/\bis:global\b|:global\(/.test(text)) report.add('css-banned', rel, 'is:global or :global()');
      if (/\sstyle=(["'{])/.test(text.replace(/<style[\s\S]*?<\/style>/g, '')))
        report.add('css-banned', rel, 'style attribute');
      if (/\bdefine:vars\b/.test(text)) report.add('csp-hash', rel, 'define:vars creates an unhashed inline style');
      if (/\bis:inline\b/.test(text)) report.add('csp-hash', rel, 'is:inline scripts are not hashed');
      if (/data-astro-prefetch/.test(text)) report.add('js-prefetch-attr', rel);
      if (/client:(load|only)\b/.test(text)) report.add('js-directive', rel, text.match(/client:(load|only)/)?.[0]);
      if (
        !options.features.scripts &&
        !options.features.islands &&
        /<script(?![^>]*type=["']application\/ld\+json)[\s>]/.test(text)
      ) {
        report.add('js-script', rel, 'enable features.scripts to ship a <script>');
      }
    }
  }
}

export function checkPublic(root: string, report: Report): void {
  const pub = join(root, 'public');
  for (const name of GENERATED_PUBLIC) {
    if (existsSync(join(pub, name))) report.add('config-public-shadow', `public/${name}`);
  }
  for (const file of walk(pub)) {
    const rel = relative(pub, file);
    if (/^sitemap.*\.xml$/.test(rel)) report.add('config-public-shadow', `public/${rel}`);
    if (RASTER.has(extname(file).toLowerCase()) && !PUBLIC_RASTER_ALLOW.includes(rel))
      report.add('images-public', `public/${rel}`);
    if (extname(file).toLowerCase() === '.pdf')
      report.add('media-pdf', `public/${rel}`, 'map it to an HTML page in site.json');
  }
}

/** Reads width and height from PNG, JPEG, GIF and WebP headers without decoding. */
export function imageSize(buf: Buffer): { width: number; height: number } | undefined {
  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47)
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  if (buf.length > 10 && buf.toString('ascii', 0, 3) === 'GIF')
    return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
  if (buf.length > 30 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    const chunk = buf.toString('ascii', 12, 16);
    if (chunk === 'VP8X') return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
    if (chunk === 'VP8 ') return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
    if (chunk === 'VP8L') {
      const b = buf.readUInt32LE(21);
      return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 };
    }
  }
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) return undefined;
      const marker = buf[i + 1] ?? 0;
      const size = buf.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
      }
      i += 2 + size;
    }
  }
  return undefined;
}

export function checkAssets(root: string, report: Report, limits: { imageMaxPx: number; imageMaxBytes: number }): void {
  for (const file of walk(join(root, 'src/assets'))) {
    if (!RASTER.has(extname(file).toLowerCase())) continue;
    const rel = relative(root, file);
    const bytes = statSync(file).size;
    if (bytes > limits.imageMaxBytes) report.add('images-original', rel, `${Math.round(bytes / 1024)} KB`);
    const size = imageSize(readFileSync(file));
    if (size && Math.max(size.width, size.height) > limits.imageMaxPx)
      report.add('images-original', rel, `${size.width}×${size.height}`);
  }
}

/** Minimal JSONC: strips comments outside strings and trailing commas. */
export function parseJsonc(text: string): unknown {
  let out = '';
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const n = text[i + 1];
    if (inString) {
      out += c;
      if (c === '\\') out += text[++i] ?? '';
      else if (c === '"') inString = false;
    } else if (c === '"') {
      inString = true;
      out += c;
    } else if (c === '/' && n === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      out += '\n';
    } else if (c === '/' && n === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i++;
    } else out += c;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
}

export function checkWrangler(root: string, options: KitOptions, report: Report): Record<string, unknown> | undefined {
  for (const other of ['wrangler.json', 'wrangler.toml']) {
    if (existsSync(join(root, other))) report.add('config-wrangler', other, 'use wrangler.jsonc only');
  }
  const file = join(root, 'wrangler.jsonc');
  if (!existsSync(file)) {
    report.add('config-wrangler', 'wrangler.jsonc', 'missing');
    return undefined;
  }
  let config: Record<string, unknown>;
  try {
    config = parseJsonc(readFileSync(file, 'utf8')) as Record<string, unknown>;
  } catch (error) {
    report.add('config-wrangler', 'wrangler.jsonc', (error as Error).message);
    return undefined;
  }
  const assets = (config.assets ?? {}) as Record<string, unknown>;
  const expect = (cond: boolean, detail: string) => {
    if (!cond) report.add('config-wrangler', 'wrangler.jsonc', detail);
  };
  expect(
    assets.directory === './dist' || assets.directory === 'dist' || assets.directory === './dist/client',
    'assets.directory must point at the build output',
  );
  expect(assets.not_found_handling === '404-page', 'assets.not_found_handling must be "404-page"');
  expect(assets.html_handling === 'auto-trailing-slash', 'assets.html_handling must be "auto-trailing-slash"');
  expect(config.workers_dev === false, 'workers_dev must be false');
  expect(config.preview_urls === false, 'preview_urls must be false in production');
  const routes = Array.isArray(config.routes) ? (config.routes as Record<string, unknown>[]) : [];
  expect(routes.length > 0 && routes.every((r) => r.custom_domain === true), 'routes must be custom_domain entries');
  const preview = ((config.env ?? {}) as Record<string, Record<string, unknown>>).preview;
  expect(!!preview, 'env.preview is missing');
  if (preview) {
    expect(Array.isArray(preview.routes) && preview.routes.length === 0, 'env.preview.routes must be []');
    expect(preview.preview_urls === true, 'env.preview.preview_urls must be true');
  }
  if (options.features.forms) {
    const mail = (config.send_email ?? []) as Record<string, unknown>[];
    const binding = mail.find((m) => m.name === 'EMAIL');
    if (!binding || !Array.isArray(binding.allowed_destination_addresses)) {
      report.add('forms-binding', 'wrangler.jsonc', 'send_email EMAIL with allowed_destination_addresses');
    } else {
      const allowed = binding.allowed_destination_addresses as string[];
      if (options.contact && !allowed.includes(options.contact.to))
        report.add('forms-binding', 'wrangler.jsonc', `${options.contact.to} is not an allowed destination`);
    }
    const rl = (config.ratelimits ?? []) as Record<string, unknown>[];
    for (const [name, limit] of [
      ['FORM_RATE_LIMIT', 3],
      ['FORM_RATE_LIMIT_ALL', 20],
    ] as const) {
      const entry = rl.find((x) => x.name === name);
      const simple = entry?.simple as { limit?: unknown; period?: unknown } | undefined;
      if (simple?.limit !== limit || simple.period !== 60)
        report.add('forms-binding', 'wrangler.jsonc', `ratelimits ${name} must allow ${limit} per 60 s`);
    }
  }
  return config;
}

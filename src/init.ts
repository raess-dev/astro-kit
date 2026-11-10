/**
 * `astro-kit init`: writes a new site from templates/, the kit's shims and a few generated files.
 * It never overwrites a file without --force. `--shims` restores only the fixed files.
 * src/assets/og.jpg (1200×630) is the owner's: Page renders no share image without it, and the build fails head-og.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateSync } from 'node:zlib';
import { type Brief, hashBrief } from './manifest.ts';
import { type KitOptions, OPTIONS_FILE, optionsSchema } from './options.ts';
import { normalize, SHIMS } from './shims.ts';

export type Feature = 'forms' | 'islands' | 'scripts';
export const FEATURES: readonly Feature[] = ['forms', 'islands', 'scripts'];

export const KIT_VERSION = (
  JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }
).version;
export const TEMPLATES = fileURLToPath(new URL('../templates/', import.meta.url));
const SITE_TEMPLATES = join(TEMPLATES, 'site');

/** Exact pins for a new site's package.json. */
export const PINS = {
  astro: '7.4.8',
  wrangler: '4.160.0',
  forms: { '@astrojs/cloudflare': '14.4.6', wrangler: '4.160.0' },
  islands: { '@astrojs/solid-js': '7.1.2', 'solid-js': '1.9.18' },
  islandsLint: { eslint: '10.14.0', 'eslint-plugin-solid': '0.19.0', 'typescript-eslint': '8.72.2' },
} as const;

/** Template files written only with a feature. */
const ONLY: Record<string, Feature> = { 'src/pages/api/contact.ts': 'forms', 'eslint.config.mjs': 'islands' };
/** Fixed files for a feature; `check` compares them and `init --shims` restores them. */
export const FEATURE_SHIMS: Record<string, Feature> = { 'eslint.config.mjs': 'islands' };

/** `{{#flag}}…{{/flag}}` keeps its body when the flag is on; `{{NAME}}` takes a value. GitHub's `${{ x }}` is left alone. */
export function render(text: string, vars: Record<string, string>, flags: Record<string, boolean> = {}): string {
  return text
    .replace(/\{\{#(\w+)\}\}\n?([\s\S]*?)\{\{\/\1\}\}\n?/g, (_, flag: string, body: string) =>
      flags[flag] ? body : '',
    )
    .replace(/\{\{([A-Z_]+)\}\}/g, (match, key: string) => vars[key] ?? match);
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, out);
    else out.push(path);
  }
  return out;
}

/** templates/site/_github/x.yml → .github/x.yml; a .tmpl suffix keeps tools from parsing a template. */
const outputPath = (file: string): string =>
  relative(SITE_TEMPLATES, file)
    .split(sep)
    .map((s) => (s.startsWith('_') ? `.${s.slice(1)}` : s))
    .join('/')
    .replace(/\.tmpl$/, '');

// ── starter pages ────────────────────────────────────────────────────────────

type PageId = 'home' | 'imprint' | 'privacy' | 'sitemap' | 'contact';
type Copy = { slug: string; title: string; description: string; body: string };

/**
 * templates/pages.json: locale tags and endonyms, one brief per starter page, and placeholder copy per locale,
 * each in its own language, so the content checks pass until the owner's text arrives.
 */
const PAGES = JSON.parse(readFileSync(join(TEMPLATES, 'pages.json'), 'utf8')) as {
  tags: Record<string, [string, string]>;
  briefs: Record<PageId, Brief>;
  copy: Record<string, Record<PageId, Copy>>;
};
const TAGS = PAGES.tags;
const BRIEFS = PAGES.briefs;

const q = (s: string): string => JSON.stringify(s);

function pageFile(id: PageId, copy: Copy, primary: boolean, processing: string[]): string {
  const brief = BRIEFS[id];
  const fm = ['---'];
  if (copy.slug) fm.push(`slug: ${copy.slug}`);
  fm.push(`title: ${q(copy.title)}`, `description: ${q(copy.description)}`);
  if (primary) fm.push('brief:', ...Object.entries(brief).map(([k, v]) => `  ${k}: ${q(v)}`));
  else fm.push(`transcreatedFrom: ${hashBrief(brief)}`);
  if (id === 'privacy') fm.push(`processing: [${processing.join(', ')}]`);
  return `${[...fm, '---', '', copy.body].join('\n')}\n`;
}

// ── icons: one solid colour, encoded here so the kit ships no binaries ──────

/** An opaque RGBA PNG of one colour. */
export function solidPng(size: number, rgb: readonly [number, number, number]): Buffer {
  const row = Buffer.alloc(1 + size * 4);
  for (let x = 0; x < size; x++) row.set([...rgb, 255], 1 + x * 4);
  const chunk = (type: string, data: Buffer): Buffer => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc32(body), body.length + 4);
    return out;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.set([8, 6, 0, 0, 0], 8); // 8-bit RGBA, deflate, no filter method, no interlace
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const idat = deflateSync(Buffer.concat(Array.from({ length: size }, () => row)));
  return Buffer.concat([signature, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

/** An ICO with one PNG image, which every current browser reads. */
export function pngIco(png: Buffer, size: number): Buffer {
  const head = Buffer.alloc(22);
  head.writeUInt16LE(1, 2); // type: icon
  head.writeUInt16LE(1, 4); // one image
  head.set([size % 256, size % 256, 0, 0], 6); // width, height, palette, reserved
  head.writeUInt16LE(1, 10); // colour planes
  head.writeUInt16LE(32, 12); // bits per pixel
  head.writeUInt32LE(png.length, 14);
  head.writeUInt32LE(22, 18); // image offset
  return Buffer.concat([head, png]);
}

const ICON_RGB = [0x1d, 0x4e, 0xd8] as const;

// ── the project ──────────────────────────────────────────────────────────────

export interface InitInput {
  root: string;
  features?: readonly Feature[];
  /** Production origin for a new astro-kit.json, e.g. https://example.ch. */
  site?: string;
  /** Locale codes for a new astro-kit.json; the first is the default. */
  locales?: readonly string[];
  shims?: boolean;
  force?: boolean;
}

/** An existing astro-kit.json decides; otherwise the flags build the example. */
function projectOptions(input: InitInput): { options: KitOptions; raw: Record<string, unknown> | undefined } {
  const file = join(input.root, OPTIONS_FILE);
  if (existsSync(file)) {
    const parsed = optionsSchema.safeParse(JSON.parse(readFileSync(file, 'utf8')));
    if (!parsed.success)
      throw new Error(
        `astro-kit init: ${OPTIONS_FILE} is invalid: ${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`,
      );
    return { options: parsed.data, raw: undefined };
  }
  const site = (input.site ?? 'https://example.ch').replace(/\/+$/, '');
  const host = new URL(site).host.replace(/^www\./, '');
  const codes = input.locales?.length ? input.locales : ['de', 'fr'];
  const features = Object.fromEntries(FEATURES.map((f) => [f, input.features?.includes(f) ?? false])) as Record<
    Feature,
    boolean
  >;
  const raw: Record<string, unknown> = {
    site,
    locales: codes.map((code) => ({ code, tag: TAGS[code]?.[0] ?? code, name: TAGS[code]?.[1] ?? code })),
    defaultLocale: codes[0],
    nav: features.forms ? ['contact'] : [],
    features,
    prefetch: { speculationRules: true, astroPrefetch: false },
    ...(features.forms ? { contact: { to: `info@${host}`, from: `form@${host}` } } : {}),
    securityContact: `mailto:security@${host}`,
    dependencies: [],
    limits: {},
  };
  const parsed = optionsSchema.safeParse(raw);
  if (!parsed.success)
    throw new Error(`astro-kit init: ${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`);
  return { options: parsed.data, raw };
}

const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

/** Every file of a new project, by path. */
export function projectFiles(input: InitInput): Map<string, string | Buffer> {
  const { options, raw } = projectOptions(input);
  const { features } = options;
  const host = new URL(options.site).host.replace(/^www\./, '');
  const name = (host.split('.')[0] ?? 'site')
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
  const worker = host.replace(/[^a-z0-9]+/g, '-');
  const files = new Map<string, string | Buffer>();

  for (const [path, text] of Object.entries(SHIMS)) files.set(path, text);
  if (raw) files.set(OPTIONS_FILE, json(raw));

  const vars = {
    NAME: name,
    SITE: options.site,
    WRANGLER: PINS.wrangler,
    DEFAULT_LOCALE: options.defaultLocale,
    LOCALES: options.locales.map((l) => `${l.code} (${l.tag}, ${l.name})`).join(', '),
  };
  for (const file of walk(SITE_TEMPLATES)) {
    const path = outputPath(file);
    const only = ONLY[path];
    if (only && !features[only]) continue;
    files.set(path, render(readFileSync(file, 'utf8'), vars, features));
  }

  const dependencies: Record<string, string> = { '@raess/astro-kit': KIT_VERSION, astro: PINS.astro };
  if (features.forms) Object.assign(dependencies, PINS.forms);
  if (features.islands) Object.assign(dependencies, PINS.islands);
  const sorted = (deps: Record<string, string>) =>
    Object.fromEntries(Object.entries(deps).sort(([a], [b]) => a.localeCompare(b)));
  files.set(
    'package.json',
    json({
      name: worker,
      private: true,
      type: 'module',
      scripts: { check: 'astro-kit check', build: 'astro-kit build', test: 'astro-kit test', ci: 'astro-kit ci' },
      dependencies: sorted(dependencies),
      ...(features.islands ? { devDependencies: sorted({ ...PINS.islandsLint }) } : {}),
    }),
  );

  const addresses = [options.contact?.to, options.contact?.probe].filter((a): a is string => !!a);
  const wrangler = readFileSync(join(TEMPLATES, features.forms ? 'wrangler.forms.jsonc' : 'wrangler.jsonc'), 'utf8')
    .replace(/\bSITE_NAME\b/g, worker)
    .replace(/\bSITE_HOST\b/g, new URL(options.site).host)
    .replace('["CONTACT_TO"]', JSON.stringify(addresses));
  files.set('wrangler.jsonc', wrangler);

  files.set(
    'src/content/site.json',
    json({ type: 'Organization', name, legalName: `${name} AG`, email: `info@${host}` }),
  );
  files.set('src/content/schedule.json', json({ openingHours: [], closures: [] }));

  const ids: PageId[] = ['home', 'imprint', 'privacy', 'sitemap', ...(features.forms ? (['contact'] as const) : [])];
  const processing = ['cdn', 'previews', ...(features.forms ? ['forms', 'server'] : [])];
  for (const { code } of options.locales) {
    const copy = PAGES.copy[code] ?? PAGES.copy.en;
    if (!copy) continue;
    for (const id of ids) {
      const named = Object.fromEntries(
        Object.entries(copy[id]).map(([k, v]) => [k, render(v, { NAME: name })]),
      ) as Copy;
      files.set(`src/content/pages/${code}/${id}.md`, pageFile(id, named, code === options.defaultLocale, processing));
    }
  }

  files.set('public/favicon.ico', pngIco(solidPng(32, ICON_RGB), 32));
  files.set('public/apple-touch-icon.png', solidPng(180, ICON_RGB));
  return files;
}

/** The shims plus the fixed files of enabled features. */
export function shimFiles(root: string): Map<string, string> {
  const files = new Map(Object.entries(SHIMS));
  const optionsFile = join(root, OPTIONS_FILE);
  const features = existsSync(optionsFile)
    ? (optionsSchema.safeParse(JSON.parse(readFileSync(optionsFile, 'utf8'))).data?.features ?? {})
    : {};
  for (const [path, feature] of Object.entries(FEATURE_SHIMS)) {
    if ((features as Partial<Record<Feature, boolean>>)[feature])
      files.set(path, readFileSync(join(SITE_TEMPLATES, path), 'utf8'));
  }
  return files;
}

/** Compares the fixed feature files with the kit's copies; returns the paths that differ or are missing. */
export function changedFeatureShims(root: string, features: Record<Feature, boolean>): string[] {
  return Object.entries(FEATURE_SHIMS)
    .filter(([, feature]) => features[feature])
    .map(([path]) => path)
    .filter((path) => {
      const file = join(root, path);
      return (
        !existsSync(file) ||
        normalize(readFileSync(file, 'utf8')) !== normalize(readFileSync(join(SITE_TEMPLATES, path), 'utf8'))
      );
    });
}

export function init(input: InitInput): { written: string[]; kept: string[] } {
  const files = input.shims ? shimFiles(input.root) : projectFiles(input);
  const written: string[] = [];
  const kept: string[] = [];
  for (const [path, content] of files) {
    const file = join(input.root, path);
    if (existsSync(file) && !input.force && !input.shims) {
      kept.push(path);
      continue;
    }
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
    written.push(path);
  }
  return { written, kept };
}

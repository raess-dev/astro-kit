import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { KitOptions } from './options.ts';
import type { Report } from './registry.ts';

export const PAGES_DIR = 'src/content/pages';

/** Segments a default-locale URL may never start with, plus every locale code. */
export const RESERVED_SEGMENTS = ['_astro', '_actions', '_server-islands', '_image', '_kit', 'api', '404', '500', '.well-known'];

export interface Brief {
  intent: string;
  audience: string;
  message: string;
  cta: string;
}

export interface PageRecord {
  /** Translation key: the file name, the same in every locale. */
  id: string;
  locale: string;
  /** Content collection id, `<locale>/<id>`. */
  entryId: string;
  file: string;
  slug: string;
  parent?: string;
  /** Emitted path with trailing slash, e.g. /leistungen/ or /fr/prestations/. */
  path: string;
  title: string;
  description: string;
  draft: boolean;
  brief?: Brief;
  briefHash?: string;
  transcreatedFrom?: string;
  missing: string[];
  date?: string;
  updated?: string;
  image?: string;
  imageAlt?: string;
  /** Privacy pages: declared processing keys. */
  processing?: string[];
}

export interface Manifest {
  pages: PageRecord[];
  /** id → locale → record (drafts excluded unless KIT_DRAFTS=1). */
  byId: Record<string, Record<string, PageRecord>>;
  drafts: boolean;
}

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function hashBrief(brief: Brief): string {
  const canonical = JSON.stringify([brief.intent, brief.audience, brief.message, brief.cta]);
  return createHash('sha256').update(canonical).digest('hex').slice(0, 12);
}

function readFrontmatter(file: string): Record<string, unknown> {
  const text = readFileSync(file, 'utf8');
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!match?.[1]) return {};
  const data = parseYaml(match[1]) as unknown;
  return data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
}

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

export function localePrefix(options: KitOptions, locale: string): string {
  return locale === options.defaultLocale ? '/' : `/${locale}/`;
}

export function buildManifest(root: string, options: KitOptions, report: Report, env = process.env): Manifest {
  const drafts = env.KIT_DRAFTS === '1';
  const base = join(root, PAGES_DIR);
  const all: PageRecord[] = [];
  const codes = options.locales.map((l) => l.code);

  if (!existsSync(base)) {
    report.add('routes-translation', PAGES_DIR, 'no pages directory');
    return { pages: [], byId: {}, drafts };
  }

  for (const dir of readdirSync(base, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    if (!codes.includes(dir.name)) {
      report.add('routes-translation', `${PAGES_DIR}/${dir.name}`, `folder is not a configured locale (${codes.join(', ')})`);
      continue;
    }
    for (const f of readdirSync(join(base, dir.name), { withFileTypes: true })) {
      if (!f.isFile() || !/\.mdx?$/.test(f.name)) continue;
      const file = join(base, dir.name, f.name);
      const rel = relative(root, file);
      const id = f.name.replace(/\.mdx?$/, '');
      const fm = readFrontmatter(file);
      const slug = id === 'home' ? '' : (str(fm.slug) ?? '');
      const record: PageRecord = {
        id,
        locale: dir.name,
        entryId: `${dir.name}/${id}`,
        file: rel,
        slug,
        path: '',
        title: str(fm.title) ?? '',
        description: str(fm.description) ?? '',
        draft: fm.draft === true,
        missing: Array.isArray(fm.missing) ? fm.missing.filter((m): m is string => typeof m === 'string') : [],
      };
      const parent = str(fm.parent);
      if (parent) record.parent = parent;
      for (const key of ['transcreatedFrom', 'date', 'updated', 'image', 'imageAlt'] as const) {
        const value = fm[key];
        const text = value instanceof Date ? value.toISOString().slice(0, 10) : str(value);
        if (text) record[key] = text;
      }
      if (Array.isArray(fm.processing)) record.processing = fm.processing.filter((x): x is string => typeof x === 'string');
      const brief = fm.brief as Partial<Brief> | undefined;
      if (brief && typeof brief === 'object') {
        const b: Brief = {
          intent: str(brief.intent) ?? '',
          audience: str(brief.audience) ?? '',
          message: str(brief.message) ?? '',
          cta: str(brief.cta) ?? '',
        };
        record.brief = b;
        record.briefHash = hashBrief(b);
      }
      if (id !== 'home' && !SLUG.test(slug)) {
        report.add('routes-slug', rel, `slug "${slug}" must match a–z, 0–9 and single hyphens`);
      }
      all.push(record);
    }
  }

  const visible = all.filter((p) => drafts || !p.draft);
  const byId: Record<string, Record<string, PageRecord>> = {};
  for (const page of visible) {
    byId[page.id] ??= {};
    (byId[page.id] as Record<string, PageRecord>)[page.locale] = page;
  }

  // Paths: parent's localized path plus own slug; cycles and unknown parents are slug errors.
  const resolve = (page: PageRecord, seen: Set<string>): string[] => {
    if (page.id === 'home') return [];
    if (!page.parent) return [page.slug];
    if (seen.has(page.id)) {
      report.add('routes-slug', page.file, `parent cycle through ${[...seen].join(' → ')}`);
      return [page.slug];
    }
    seen.add(page.id);
    const parent = byId[page.parent]?.[page.locale];
    if (!parent) {
      report.add('routes-translation', page.file, `parent "${page.parent}" has no ${page.locale} page`);
      return [page.slug];
    }
    return [...resolve(parent, seen), page.slug];
  };
  for (const page of visible) {
    const segments = resolve(page, new Set());
    const prefix = localePrefix(options, page.locale);
    page.path = segments.length ? `${prefix}${segments.join('/')}/` : prefix;
    const first = segments[0];
    if (page.locale === options.defaultLocale && first !== undefined) {
      if (codes.includes(first) || RESERVED_SEGMENTS.includes(first)) {
        report.add('routes-slug', page.file, `a default-locale URL may not start with "${first}"`);
      }
    } else if (first !== undefined && RESERVED_SEGMENTS.includes(first)) {
      report.add('routes-slug', page.file, `"${first}" is reserved`);
    }
  }

  // Duplicates: same emitted path, or same slug among siblings in one locale.
  const seenPaths = new Map<string, string>();
  for (const page of visible) {
    const other = seenPaths.get(page.path);
    if (other) report.add('routes-duplicate', page.file, `${page.path} is also emitted by ${other}`);
    else seenPaths.set(page.path, page.file);
  }

  // Translations: every id has a default-locale entry; other locales exist or are declared missing.
  for (const [id, locales] of Object.entries(byId)) {
    const primary = locales[options.defaultLocale];
    if (!primary) {
      const any = Object.values(locales)[0];
      report.add('routes-translation', any?.file ?? id, `"${id}" has no ${options.defaultLocale} entry`);
      continue;
    }
    for (const code of codes) {
      if (code === options.defaultLocale) continue;
      const translated = locales[code];
      if (!translated && !primary.missing.includes(code)) {
        report.add('routes-translation', primary.file, `"${id}" has no ${code} page and does not list ${code} in missing`);
      }
      if (translated && primary.briefHash && translated.transcreatedFrom !== primary.briefHash) {
        report.add(
          'content-stale',
          translated.file,
          `transcreatedFrom is ${translated.transcreatedFrom ?? 'unset'}; the brief hash is ${primary.briefHash}`,
        );
      }
    }
    if (!primary.brief && id !== 'home') {
      report.add('content-stale', primary.file, 'the default-locale page has no brief');
    }
  }

  return { pages: visible, byId, drafts };
}

/** Absolute URL map locale → URL for a page id (published variants only). */
export function alternatesFor(manifest: Manifest, options: KitOptions, id: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [locale, page] of Object.entries(manifest.byId[id] ?? {})) {
    if (!page.draft) out[locale] = `${options.site}${page.path}`;
  }
  return out;
}

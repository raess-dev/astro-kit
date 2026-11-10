/**
 * Runtime helpers for pages and content.config.ts. Runs inside Astro (Vite), so it may import virtual modules.
 */
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';
import { defineCollection } from 'astro:content';
import * as kit from 'virtual:astro-kit';
import type { Schedule, SiteFacts } from './facts.ts';
import type { Manifest, PageRecord } from './manifest.ts';
import type { KitOptions } from './options.ts';

export type { PageRecord };
export const options = kit.options as KitOptions;
export const site = kit.site as SiteFacts | undefined;
export const schedule = kit.schedule as Schedule;
export const kitVersion = kit.kitVersion;
const messages = kit.messages as Record<string, Record<string, string>>;
const manifest = kit.manifest as Manifest;

const brief = z.object({
  intent: z.string().min(10),
  audience: z.string().min(3),
  message: z.string().min(10),
  cta: z.string().min(2),
});

/** The kit's page schema. Projects extend it through defineKitCollections({ pages: (s) => s.extend({...}) }). */
export function pageSchema(image: () => z.ZodTypeAny) {
  return z
    .object({
      slug: z.string().optional(),
      title: z.string(),
      description: z.string(),
      draft: z.boolean().default(false),
      brief: brief.optional(),
      transcreatedFrom: z.string().regex(/^[0-9a-f]{12}$/).optional(),
      missing: z.array(z.string()).default([]),
      parent: z.string().optional(),
      date: z.coerce.date().optional(),
      updated: z.coerce.date().optional(),
      image: image().optional(),
      imageAlt: z.string().optional(),
      lang: z.string().optional(),
      /** Privacy pages only: what the site processes, one key per enabled feature (cdn, forms, server, previews). */
      processing: z.array(z.enum(['cdn', 'forms', 'server', 'previews'])).optional(),
    })
    .strict();
}

type PageSchema = ReturnType<typeof pageSchema>;

export function defineKitCollections(ext: { pages?: (schema: PageSchema) => z.ZodTypeAny; extra?: Record<string, unknown> } = {}) {
  return {
    pages: defineCollection({
      // The id is always <locale>/<file>; glob() would otherwise use the slug field as id.
      loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/pages', generateId: ({ entry }) => entry.replace(/\.mdx?$/, '') }),
      schema: ({ image }: { image: () => z.ZodTypeAny }) => {
        const base = pageSchema(image);
        return ext.pages ? ext.pages(base) : base;
      },
    }),
    ...(ext.extra ?? {}),
  };
}

const pages = manifest.pages;
const byId = manifest.byId;

/** getStaticPaths for src/pages/[...path].astro: one path per published page and locale. */
export function pagePaths() {
  return pages.map((page) => ({
    params: { path: page.path === '/' ? undefined : page.path.slice(1, -1) },
    props: { page },
  }));
}

export function page(id: string, locale: string): PageRecord | undefined {
  return byId[id]?.[locale];
}

/** Path of a page in a locale, e.g. pageUrl('contact', 'fr') → /fr/contact/. */
export function pageUrl(id: string, locale: string): string {
  const record = page(id, locale);
  if (!record) throw new Error(`astro-kit: page "${id}" has no ${locale} entry`);
  return record.path;
}

/** Absolute URLs of every published translation of a page: { de: 'https://…/', fr: 'https://…/fr/' }. */
export function alternates(id: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [locale, record] of Object.entries(byId[id] ?? {})) out[locale] = `${options.site}${record.path}`;
  return out;
}

/** Child pages of a parent in one locale, newest first when dated. */
export function children(id: string, locale: string): PageRecord[] {
  return pages
    .filter((p) => p.parent === id && p.locale === locale)
    .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '') || a.title.localeCompare(b.title));
}

/** Every published page of a locale, for the sitemap page. */
export function siteIndex(locale: string): PageRecord[] {
  return pages.filter((p) => p.locale === locale).sort((a, b) => a.path.localeCompare(b.path));
}

export function localeTag(code: string): string {
  return options.locales.find((l) => l.code === code)?.tag ?? code;
}

/** UI message for a locale; kit defaults merged with src/content/messages/<locale>.json. */
export function t(locale: string, key: string): string {
  const value = messages[locale]?.[key] ?? messages[options.defaultLocale]?.[key];
  if (value === undefined) throw new Error(`astro-kit: message "${key}" is missing for ${locale}`);
  return value;
}

/** The only sanctioned date formatting. Always UTC, so builds are deterministic. */
export function formatDate(locale: string, iso: string | Date, style: 'long' | 'numeric' = 'long'): string {
  const date = typeof iso === 'string' ? new Date(iso) : iso;
  const opts: Intl.DateTimeFormatOptions =
    style === 'long' ? { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' } : { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' };
  return new Intl.DateTimeFormat(localeTag(locale), opts).format(date);
}

/** The only sanctioned money formatting. Amounts are integer minor units: 12900 → CHF 129.00. */
export function formatMoney(locale: string, minorUnits: number, currency = 'CHF'): string {
  return new Intl.NumberFormat(localeTag(locale), { style: 'currency', currency }).format(minorUnits / 100);
}

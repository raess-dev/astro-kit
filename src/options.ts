import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'astro/zod';
import type { Report } from './registry.ts';

/** BCP 47 tag such as de-CH; code is the URL segment such as de. */
const locale = z.object({
  code: z.string().regex(/^[a-z]{2,3}$/),
  tag: z.string().regex(/^[a-z]{2,3}(-[A-Z]{2})?$/),
  /** Endonym shown in the language switcher, e.g. Deutsch, Français. */
  name: z.string().min(2),
});

const email = z.string().regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/);

export const optionsSchema = z
  .object({
    $schema: z.string().optional(),
    /** Production origin, https only, no trailing slash. */
    site: z.string().regex(/^https:\/\/[a-z0-9.-]+$/),
    locales: z.array(locale).min(1),
    /** Effectively permanent: changing it moves every URL of two locales. */
    defaultLocale: z.string(),
    /** Page ids shown in the header navigation, in order. */
    nav: z.array(z.string()).default([]),
    features: z
      .object({
        forms: z.boolean().default(false),
        islands: z.boolean().default(false),
        scripts: z.boolean().default(false),
      })
      .default({ forms: false, islands: false, scripts: false }),
    prefetch: z
      .object({
        speculationRules: z.boolean().default(true),
        astroPrefetch: z.boolean().default(false),
      })
      .default({ speculationRules: true, astroPrefetch: false }),
    /** Required with features.forms. Addresses must be verified in Cloudflare Email Routing. */
    contact: z.object({ to: email, from: email, probe: email.optional() }).optional(),
    /** security.txt Contact, e.g. mailto:security@example.ch */
    securityContact: z.string().regex(/^(mailto:|https:\/\/)/),
    /** Extra npm dependencies the owner allows beyond the kit's own. */
    dependencies: z.array(z.string()).default([]),
    /** Stricter limits only; looser values fail. Sizes in bytes, compressed. */
    limits: z
      .object({
        headBytes: z.number().int().positive().optional(),
        documentBytes: z.number().int().positive().optional(),
        domElements: z.number().int().positive().optional(),
      })
      .default({}),
  })
  .strict()
  .refine((o) => o.locales.some((l) => l.code === o.defaultLocale), {
    message: 'defaultLocale must be one of locales[].code',
    path: ['defaultLocale'],
  })
  .refine((o) => !o.features.forms || o.contact !== undefined, {
    message: 'features.forms needs contact.to and contact.from',
    path: ['contact'],
  });

export type KitOptions = z.output<typeof optionsSchema>;
export type KitLocale = KitOptions['locales'][number];

/** Kit defaults; projects may only tighten them through limits. */
export const LIMITS = {
  headBytes: 14 * 1024,
  documentBytes: 30 * 1024,
  domElements: 1400,
  domDepth: 32,
  fontBytes: 100 * 1024,
  islandJsBytes: 20 * 1024,
  prefetchJsBytes: 2 * 1024,
  ogImageBytes: 150 * 1024,
  baseCssBytes: 3 * 1024,
  titleMin: 15,
  titleMax: 70,
  descriptionMin: 50,
  descriptionMax: 160,
  imageMaxPx: 2560,
  imageMaxBytes: 3 * 1024 * 1024,
  clickDepth: 3,
} as const;

export function effectiveLimits(options: KitOptions) {
  const l = options.limits;
  return {
    ...LIMITS,
    headBytes: Math.min(LIMITS.headBytes, l.headBytes ?? LIMITS.headBytes),
    documentBytes: Math.min(LIMITS.documentBytes, l.documentBytes ?? LIMITS.documentBytes),
    domElements: Math.min(LIMITS.domElements, l.domElements ?? LIMITS.domElements),
  };
}

export const OPTIONS_FILE = 'astro-kit.json';

export function loadOptions(root: string, report: Report): KitOptions | undefined {
  const file = join(root, OPTIONS_FILE);
  if (!existsSync(file)) {
    report.add('config-options', OPTIONS_FILE, 'file not found');
    return undefined;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    report.add('config-options', OPTIONS_FILE, `invalid JSON: ${(error as Error).message}`);
    return undefined;
  }
  const parsed = optionsSchema.safeParse(raw);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      report.add('config-options', OPTIONS_FILE, `${issue.path.join('.') || '(root)'}: ${issue.message}`);
    }
    return undefined;
  }
  return parsed.data;
}

export function localeByCode(options: KitOptions, code: string): KitLocale | undefined {
  return options.locales.find((l) => l.code === code);
}

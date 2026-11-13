/**
 * Shared inputs of the unit tests: the settings of the specification, the smallest facts, and a temp folder that
 * is removed at the end. A helper here never asserts: it throws an `Error` when its input is not valid.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { Facts } from '../../src/context.ts';
import { parseSchedule, parseSite } from '../../src/facts.ts';
import { type Options, parseOptions } from '../../src/options.ts';
import { Report } from '../../src/registry.ts';

// Settings

/** The example of 5.1, without `$schema`: two locales, forms on, three mode options. */
export const EXAMPLE = {
  site: 'https://example.ch',
  codeOwner: '@example-owner',
  locales: [
    { code: 'de', tag: 'de-CH', name: 'Deutsch', coverage: 'full' },
    { code: 'fr', tag: 'fr-CH', name: 'Français', coverage: 'full' },
  ],
  defaultLocale: 'de',
  features: { forms: true, islands: false, scripts: false, wasm: false, workers: false },
  prefetch: { speculationRules: true, astroPrefetch: false },
  modes: { auto: true, light: true, dark: true, contrast: false },
  contact: { to: 'info@example.ch', from: 'form@example.ch' },
  forms: {
    contact: {
      fields: [
        { name: 'name', type: 'text', maxLength: 100, autocomplete: 'name' },
        { name: 'email', type: 'email' },
        { name: 'message', type: 'textarea' },
      ],
    },
  },
  legal: {
    legalNote: { de: '/impressum/', fr: '/fr/mentions-legales/' },
    privacy: { de: '/datenschutz/', fr: '/fr/protection-des-donnees/' },
  },
  processing: ['cdn', 'previews', 'forms', 'server'],
  securityContact: 'mailto:security@example.ch',
  dependencies: [],
  origins: [],
  waivers: [],
  limits: {},
} as const;

/** The smallest settings: one locale and no feature. Every other field has its default (auto is the one mode). */
export const SMALLEST = {
  site: 'https://example.ch',
  codeOwner: '@example-owner',
  locales: [{ code: 'de', tag: 'de-CH', name: 'Deutsch' }],
  defaultLocale: 'de',
  legal: { legalNote: { de: '/impressum/' }, privacy: { de: '/datenschutz/' } },
  securityContact: 'mailto:security@example.ch',
} as const;

/** A static site with two locales: the smallest settings with `fr`. */
export const TWO_LOCALES = {
  ...SMALLEST,
  locales: [
    { code: 'de', tag: 'de-CH', name: 'Deutsch' },
    { code: 'fr', tag: 'fr-CH', name: 'Français' },
  ],
  legal: {
    legalNote: { de: '/impressum/', fr: '/fr/mentions-legales/' },
    privacy: { de: '/datenschutz/', fr: '/fr/protection-des-donnees/' },
  },
} as const;

/** The parsed settings of an `astro-kit.json` value, with every default. Throws when the value is not valid. */
export function optionsOf(value: unknown): Options {
  const report = new Report();
  const options = parseOptions(value, report);
  if (options === undefined) throw new Error(report.format());
  return options;
}

/** One declared origin of 9.4, with a purpose and a processor. `more` sets `load` and `allow`. */
export const origin = (
  host: string,
  directives: readonly string[],
  more: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> => ({
  host,
  directives,
  purpose: 'A purpose in plain words.',
  processor: 'Example Ltd',
  ...more,
});

// Facts

/** The smallest `site.json`. */
export const SITE = { name: 'Example', legalName: 'Example AG', email: 'info@example.ch' } as const;

/** The smallest `schedule.json`. */
export const SCHEDULE = { openingHours: [], closures: [] } as const;

/** The parsed facts of a site, with every default. Throws when a value is not valid. */
export function factsOf(site: unknown = SITE, schedule: unknown = SCHEDULE): Facts {
  const report = new Report();
  const parsedSite = parseSite(site, report);
  const parsedSchedule = parseSchedule(schedule, report);
  if (parsedSite === undefined || parsedSchedule === undefined) throw new Error(report.format());
  return { site: parsedSite, schedule: parsedSchedule, glossary: {} };
}

// Temp folders

/** The files of a temp folder: a path from its root, and the text or the bytes of the file. */
export type Files = Readonly<Record<string, string | Uint8Array>>;

/** The text of a JSON file: two spaces and a final newline. */
export const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

function makeTemp(files: Files): string {
  const root = mkdtempSync(join(tmpdir(), 'astro-kit-'));
  for (const [path, content] of Object.entries(files)) {
    const file = join(root, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
  }
  return root;
}

/**
 * The file that a `require` of the specifier finds from a folder, or `undefined`. Node also looks in every folder
 * above a temp folder. So a test of a missing package reads this first: on a machine where a folder above the temp
 * folder holds the package, the test fails with that path and does not run the package.
 */
export function resolvedFrom(root: string, specifier: string): string | undefined {
  try {
    return createRequire(join(root, 'package.json')).resolve(specifier);
  } catch {
    return undefined;
  }
}

/** Writes the files into a new temp folder, runs `use` on its root, and removes the folder, also after a throw. */
export function inTemp<Result>(files: Files, use: (root: string) => Result): Result {
  const root = makeTemp(files);
  try {
    return use(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/** `inTemp` for an asynchronous `use`: the folder is removed when the promise settles. */
export async function inTempAsync<Result>(files: Files, use: (root: string) => Promise<Result>): Promise<Result> {
  const root = makeTemp(files);
  try {
    return await use(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

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

/** The npm settings that `kit-identity.sh` refuses in the environment (10.3), by the name that npm gives them. */
export const REFUSED_NPM_SETTINGS: readonly string[] = [
  'registry',
  'strict-ssl',
  'ignore-scripts',
  'replace-registry-host',
];

/**
 * The npm settings of the machine that `kit-identity.sh` does not check (10.3): they point npm at the npmrc files of
 * the machine, which the flags of the install win over.
 */
export const MACHINE_NPM_SETTINGS: readonly string[] = ['userconfig', 'globalconfig'];

/**
 * The environment without the variables that `kit-identity.sh` refuses: `npm_config_<name>` in any letter case and
 * with `_` or `-` between the words, as npm reads it. `npm test` and `npm run` set some of them (such as
 * `npm_config_ignore_scripts`). A proxy setting and the npmrc settings of the machine (`NPM_CONFIG_USERCONFIG`) stay:
 * the script allows them. `GITHUB_ACTIONS` goes too, so the script runs as outside CI unless a test sets it.
 */
export function scriptEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const kept: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(env)) {
    const setting = name.slice('npm_config_'.length).replace(/_/g, '-').toLowerCase();
    if (/^npm_config_/i.test(name) && REFUSED_NPM_SETTINGS.includes(setting)) continue;
    if (name === 'GITHUB_ACTIONS') continue;
    kept[name] = value;
  }
  return kept;
}

/**
 * The environment without any `npm_config_` variable, in any letter case: `npm run` sets `npm_config_userconfig` and
 * `npm_config_globalconfig`, and a cloud machine sets `NPM_CONFIG_USERCONFIG`, so a test that reads the npm config
 * of a fake HOME starts from none of them.
 */
export function withoutNpmConfig(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(env).filter(([name]) => !/^npm_config_/i.test(name)));
}

/**
 * The text of a fake `npm` for `kit-identity.sh` (10.3), to put first on the path. Each call appends one line to the
 * file `$FAKE_NPM_LOG`: the state of the folder after `--cache` when npm runs (`empty`, `filled` or `missing`), then
 * the arguments. Then it puts a file in that folder, as a real npm fills its cache. `npm view` exits with
 * `$FAKE_VIEW_EXIT` (default 0) and prints `$FAKE_VIEW_ANSWER`, or, when that is not set, the `integrity` of the kit
 * entry of `package-lock.json` in the current folder. Any other call fails with status 99.
 */
export const FAKE_NPM_VIEW = `#!/usr/bin/env bash
cache=; prev=
for arg in "$@"; do [ "$prev" != --cache ] || cache=$arg; prev=$arg; done
state=missing
if [ -n "$cache" ] && [ -d "$cache" ]; then
  if [ -z "$(ls -A "$cache")" ]; then state=empty; else state=filled; fi
  : > "$cache/filled-by-fake-npm"
fi
printf '%s %s\\n' "$state" "$*" >> "$FAKE_NPM_LOG"
[ "$1" = view ] || { echo 'fake npm: not a view call' >&2; exit 99; }
[ "\${FAKE_VIEW_EXIT:-0}" = 0 ] || { echo 'npm error code E404' >&2; exit "$FAKE_VIEW_EXIT"; }
if [ -n "\${FAKE_VIEW_ANSWER+set}" ]; then printf '%s\\n' "$FAKE_VIEW_ANSWER"
else jq -r '.packages["node_modules/@raess/astro-kit"].integrity' package-lock.json; fi
`;

/** One call of a fake npm: the state of its `--cache` folder when it ran, that folder, and its arguments. */
export interface NpmCall {
  state: string;
  cache: string;
  args: string[];
}

/** The calls in the log of a fake npm (`FAKE_NPM_VIEW`), one per line. */
export function npmCalls(log: string): NpmCall[] {
  return log
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => {
      const [state = '', ...args] = line.split(' ');
      const at = args.indexOf('--cache');
      return { state, cache: at < 0 ? '' : (args[at + 1] ?? ''), args };
    });
}

/** The arguments of `kit-identity.sh`'s one `npm view` call for the kit at `version`, with its cache folder. */
export const npmViewArgs = (version: string, cache: string): string[] => [
  'view',
  `@raess/astro-kit@${version}`,
  'dist.integrity',
  '--registry=https://registry.npmjs.org/',
  '--replace-registry-host=never',
  '--strict-ssl=true',
  '--cache',
  cache,
];

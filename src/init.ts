/**
 * `astro-kit init` (specification, 6.4 and 12.2): it writes the site templates into a project root.
 *
 * - The settings: `astro-kit.json` with the defaults of 5.3 and the values of the flags, in the `--apply` format of
 *   5.5. An existing `astro-kit.json` is kept, and its values win over the flags.
 * - `package.json` with the pins (`PINS`), the three source shims of `src/shims.ts`, the tree `templates/site/`
 *   (`_x` becomes `.x`, a `.tmpl` file is rendered and loses its suffix) and the feature shims of
 *   `templates/features/<feature>/`.
 * - `--shims` writes only the shims and the shims of the enabled features.
 * - It never overwrites a file without `--force`, and `--force` rewrites only the kit's files: it keeps the files of
 *   `FORCE_KEPT`.
 * - A planning pass checks every path before the first write (`plan`): a link, or a file or folder in the wrong
 *   place, throws, and the run writes nothing.
 *
 * The protected files of 10.6: plain `init` writes the two that this kit version renders, `.github/kit-identity.sh`
 * and `.npmrc` (`RENDERED_PROTECTED` of `src/shims.ts`, part 9d of milestone M9), with `.claude/settings.json`, whose
 * hook runs the script (12.3). `--protected` throws until part 9e of M9 renders all seven, so it never writes a part
 * of them.
 */
import {
  closeSync,
  constants,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { siteHost, workerName } from './hosts/cloudflare.ts';
import { loadOptions, OPTIONS_FILE, type Options, parseOptions } from './options.ts';
import { Report } from './registry.ts';
import { FORMS_SHIM_FILE, ISLANDS_SHIM_FILE, RENDERED_PROTECTED, SHIMS } from './shims.ts';
import { KIT_VERSION } from './virtual.ts';

/** Where `init` writes, as the command line gives it. */
export interface InitIo {
  out: (text: string) => void;
  err: (text: string) => void;
}

/** The flags of `init` (6.4). A flag that takes a value is `undefined` when it is not given. */
export interface InitFlags {
  site?: string | undefined;
  locales?: string | undefined;
  features?: string | undefined;
  owner?: string | undefined;
  shims?: boolean;
  protected?: boolean;
  force?: boolean;
}

/** The features that `--features` takes, in the order of the error message (6.4). */
export const INIT_FEATURES = ['forms', 'islands', 'scripts'] as const;
export type InitFeature = (typeof INIT_FEATURES)[number];

/**
 * The seven protected files of 10.6. The kit renders them from the settings, and only the protected task writes
 * them. Plain `init` writes the ones of `RENDERED_PROTECTED` (part 9d of M9); `init --protected` throws until part 9e
 * of M9 renders all seven.
 */
export const PROTECTED_FILES: readonly string[] = [
  '.github/workflows/site.yml',
  '.github/workflows/site-merge.yml',
  '.github/dependabot.yml',
  '.github/kit-identity.sh',
  '.github/CODEOWNERS',
  '.npmrc',
  'wrangler.jsonc',
];

/** The message of `init --protected` until part 9e of M9 renders all seven protected files. */
export const PROTECTED_NOT_YET =
  'astro-kit init: --protected is not available in this kit version: it does not render all seven protected files of 10.6 yet, so it wrote nothing.';

/**
 * The files that `--force` never rewrites (6.4): the files of the project and of its owner. The kit block of 12.1
 * names the owner-approved ones (`astro-kit.json`, `site.json`, `docs/design.md`, `legal.lock.json`, `.mcp.json`); the
 * others hold the project's own text or data (12.2). `--force` rewrites only the kit's files: the shims, the feature
 * shims, `.gitignore`, `.node-version`, `src/styles/tokens.css` (the kit renders it), the two `.gitkeep`,
 * `.claude/settings.json` and the protected files that init writes (`config-shim` compares each with the kit's
 * rendering). A project's own Claude Code settings go in `.claude/settings.local.json`, which init never writes.
 */
export const FORCE_KEPT: readonly string[] = [
  '.mcp.json',
  'AGENTS.md',
  'CLAUDE.md',
  'KIT-FEEDBACK.md',
  'astro-kit.json',
  'docs/design.md',
  'docs/spec.md',
  'glossary.json',
  'legal.lock.json',
  'package.json',
  'redirects.json',
  'schedule.json',
  'site.json',
  'src/styles/elements.css',
  'src/styles/fonts.css',
];

/** The message of a path where init would write a file, and which is a link or no regular file (6.4). */
export const notAFile = (path: string): string => `astro-kit init: ${path} is not a file`;

/** The message of a parent path of a file of init that is a link or no folder (6.4). */
export const notAFolder = (path: string): string => `astro-kit init: ${path} is not a folder`;

/** The message of an existing `astro-kit.json` and a flag that sets a value (6.4). */
export const SETTINGS_EXIST = 'astro-kit init: astro-kit.json exists; its values are used and the flags are ignored.';

/** The message without `--owner` and without `astro-kit.json` (5.3). */
export const NO_OWNER = 'astro-kit init: give the code owner, e.g. --owner @your-login';
/** The message without `--site` and without `astro-kit.json`. */
export const NO_SITE = 'astro-kit init: give the production address, e.g. --site https://example.ch';
/** The message without `--locales` and without `astro-kit.json`. */
export const NO_LOCALES = 'astro-kit init: give the locales, the default first, e.g. --locales de,fr';

/** The message of an unknown feature (6.4). */
export const unknownFeature = (name: string): string =>
  `astro-kit init: unknown feature ${name} (${INIT_FEATURES.join(', ')})`;

/** The line for a locale code that the locale table of 5.3 does not hold. */
export const unknownLocale = (code: string): string =>
  `astro-kit init: the locale ${code} is not in the kit's table, so its tag and its name are "${code}"; set them on the settings page.`;

/**
 * The pins of section 2.1 that `init` writes into `package.json`. The kit itself is pinned at its own version
 * (`KIT_VERSION`).
 */
export const PINS = {
  astro: '7.4.13',
  wrangler: '4.165.0',
  '@astrojs/cloudflare': '14.4.9',
  '@astrojs/solid-js': '7.1.6',
  'solid-js': '1.9.20',
  eslint: '10.15.0',
  'eslint-plugin-solid': '0.20.0',
  'typescript-eslint': '8.73.0',
} as const;

/** The locale table of 5.3: code to tag and name. */
export const LOCALE_TABLE: ReadonlyMap<string, { tag: string; name: string }> = new Map([
  ['de', { tag: 'de-CH', name: 'Deutsch' }],
  ['fr', { tag: 'fr-CH', name: 'Français' }],
  ['it', { tag: 'it-CH', name: 'Italiano' }],
  ['en', { tag: 'en', name: 'English' }],
  ['rm', { tag: 'rm-CH', name: 'Rumantsch' }],
]);

/** The legal slugs of 5.3: code to the slug of the legal note and of the privacy page. */
export const LEGAL_SLUGS: ReadonlyMap<string, { legalNote: string; privacy: string }> = new Map([
  ['de', { legalNote: 'impressum', privacy: 'datenschutz' }],
  ['fr', { legalNote: 'mentions-legales', privacy: 'protection-des-donnees' }],
  ['it', { legalNote: 'note-legali', privacy: 'protezione-dei-dati' }],
  ['rm', { legalNote: 'impressum', privacy: 'protecziun-da-datas' }],
]);

/** The legal slugs of a code that the table of 5.3 does not hold. */
const OTHER_SLUGS = { legalNote: 'legal-note', privacy: 'privacy' } as const;

/** The folder of the templates in the package: one folder above `src/` and above `dist/`. */
const TEMPLATES = fileURLToPath(new URL('../templates/', import.meta.url));

/** The features of `--features`, in the order given, each once. Throws for an unknown one. */
export function parseFeatures(text: string): InitFeature[] {
  const features: InitFeature[] = [];
  for (const name of text.split(',')) {
    const feature = INIT_FEATURES.find((known) => known === name);
    if (feature === undefined) throw new Error(unknownFeature(name));
    if (!features.includes(feature)) features.push(feature);
  }
  return features;
}

/** The locale codes of `--locales`, the default first. Throws for an empty entry. */
export function parseLocales(text: string): string[] {
  const codes = text.split(',');
  if (codes.some((code) => code === '')) throw new Error(`${NO_LOCALES}; an entry is empty`);
  return codes;
}

/** The template variable `NAME` (10.4): the first label of `host`, split on `-`, each word capitalized. */
export function siteName(site: string): string {
  const label = siteHost(site).split('.')[0] ?? '';
  return label
    .split('-')
    .filter((word) => word !== '')
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(' ');
}

/** The template variables of 10.4 for the settings of a site. */
export function templateVariables(options: Pick<Options, 'site' | 'codeOwner'>): Readonly<Record<string, string>> {
  return {
    host: siteHost(options.site),
    worker: workerName(options.site),
    NAME: siteName(options.site),
    SITE: options.site,
    OWNER: options.codeOwner,
  };
}

/** Renders a `.tmpl` text: each `{{name}}` becomes its variable. Throws for a name that is not a variable. */
export function renderTemplate(text: string, variables: Readonly<Record<string, string>>): string {
  return text.replace(/\{\{([A-Za-z]+)\}\}/g, (_match, name: string) => {
    const value = Object.hasOwn(variables, name) ? variables[name] : undefined;
    if (value === undefined) throw new Error(`astro-kit init: the template variable ${name} does not exist`);
    return value;
  });
}

/** The text of a JSON settings file in the `--apply` format of 5.5: two spaces, objects and lists expanded. */
export const settingsText = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

/** The legal path of one locale: at the root for the default locale, else under `/<code>/` (5.3). */
const legalPath = (code: string, slug: string, defaultLocale: string): string =>
  code === defaultLocale ? `/${slug}/` : `/${code}/${slug}/`;

/**
 * The value of `astro-kit.json` that `init` writes (5.3): every field of 5.1 but `$schema`, in its order. With
 * forms, `contact` and the processing keys `forms` and `server`; `forms` stays out, so its default of 5.2 applies.
 */
export function initSettings(site: string, codes: readonly string[], features: readonly InitFeature[], owner: string) {
  const defaultLocale = codes[0] ?? '';
  const forms = features.includes('forms');
  const host = siteHost(site);
  const slugs = (code: string) => LEGAL_SLUGS.get(code) ?? OTHER_SLUGS;
  return {
    site,
    codeOwner: owner,
    locales: codes.map((code) => ({
      code,
      tag: LOCALE_TABLE.get(code)?.tag ?? code,
      name: LOCALE_TABLE.get(code)?.name ?? code,
      coverage: 'full',
    })),
    defaultLocale,
    features: {
      forms,
      islands: features.includes('islands'),
      scripts: features.includes('scripts'),
      wasm: false,
      workers: false,
    },
    prefetch: { speculationRules: true, astroPrefetch: false },
    modes: { auto: true, light: false, dark: false, contrast: false },
    ...(forms ? { contact: { to: `info@${host}`, from: `form@${host}` } } : {}),
    legal: {
      legalNote: Object.fromEntries(codes.map((code) => [code, legalPath(code, slugs(code).legalNote, defaultLocale)])),
      privacy: Object.fromEntries(codes.map((code) => [code, legalPath(code, slugs(code).privacy, defaultLocale)])),
    },
    processing: forms ? ['cdn', 'previews', 'forms', 'server'] : ['cdn', 'previews'],
    securityContact: `mailto:security@${host}`,
    dependencies: [],
    origins: [],
    waivers: [],
    limits: {},
  };
}

/** The features that a site has on, in the order of `INIT_FEATURES`. */
const enabledFeatures = (options: Options): InitFeature[] =>
  INIT_FEATURES.filter((feature) => options.features[feature]);

/** An object with its keys sorted. */
const sorted = (entries: readonly (readonly [string, string])[]): Record<string, string> =>
  Object.fromEntries([...entries].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));

/**
 * The `package.json` of 12.2: the worker name, the four scripts, the kit and `astro` with the feature pins as
 * dependencies, and `wrangler` with the islands lint pins as devDependencies, each list sorted.
 */
export function packageText(options: Options, kitVersion: string = KIT_VERSION): string {
  const dependencies: [string, string][] = [
    ['@raess/astro-kit', kitVersion],
    ['astro', PINS.astro],
  ];
  const devDependencies: [string, string][] = [['wrangler', PINS.wrangler]];
  if (options.features.forms) dependencies.push(['@astrojs/cloudflare', PINS['@astrojs/cloudflare']]);
  if (options.features.islands) {
    dependencies.push(['@astrojs/solid-js', PINS['@astrojs/solid-js']], ['solid-js', PINS['solid-js']]);
    devDependencies.push(
      ['eslint', PINS.eslint],
      ['eslint-plugin-solid', PINS['eslint-plugin-solid']],
      ['typescript-eslint', PINS['typescript-eslint']],
    );
  }
  return settingsText({
    name: workerName(options.site),
    private: true,
    type: 'module',
    scripts: { check: 'astro-kit check', build: 'astro-kit build', test: 'astro-kit test', ci: 'astro-kit ci' },
    dependencies: sorted(dependencies),
    devDependencies: sorted(devDependencies),
  });
}

/** Every file under a folder of the templates, as sorted paths with `/`. */
function templateFiles(folder: string): string[] {
  const found: string[] = [];
  const visit = (dir: string, path: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const child = path === '' ? entry.name : `${path}/${entry.name}`;
      if (entry.isDirectory()) visit(join(dir, entry.name), child);
      else if (entry.isFile()) found.push(child);
    }
  };
  visit(folder, '');
  return found.sort();
}

/** The project path of a template path: each segment `_x` becomes `.x`, and a `.tmpl` suffix goes. */
export function projectPath(template: string): string {
  return template
    .split('/')
    .map((segment) => (segment.startsWith('_') ? `.${segment.slice(1)}` : segment))
    .join('/')
    .replace(/\.tmpl$/, '');
}

/** One file that `init` writes: its project path and its text. */
export interface InitFile {
  path: string;
  text: string;
}

/** The files of the tree `templates/site/`, rendered with the variables, by project path. */
export function siteTemplates(variables: Readonly<Record<string, string>>): InitFile[] {
  const folder = join(TEMPLATES, 'site');
  return templateFiles(folder).map((template) => {
    const text = readFileSync(join(folder, template), 'utf8');
    return { path: projectPath(template), text: template.endsWith('.tmpl') ? renderTemplate(text, variables) : text };
  });
}

/** The feature shims of each feature (9.1, 9.2), as paths under `templates/features/<feature>/`. `scripts` has none. */
export const FEATURE_SHIMS: Readonly<Record<InitFeature, readonly string[]>> = {
  forms: [FORMS_SHIM_FILE],
  islands: [ISLANDS_SHIM_FILE],
  scripts: [],
};

/** The feature shims of the enabled features, read from `templates/features/<feature>/`. Throws for a missing one. */
export function featureShims(features: readonly InitFeature[], templates: string = TEMPLATES): InitFile[] {
  return features.flatMap((feature) =>
    FEATURE_SHIMS[feature].map((path) => {
      const file = join(templates, 'features', feature, path);
      if (lstatSync(file, { throwIfNoEntry: false })?.isFile() !== true) {
        throw new Error(`astro-kit init: the template templates/features/${feature}/${path} is missing`);
      }
      return { path, text: readFileSync(file, 'utf8') };
    }),
  );
}

/** The three source shims of 12.2. */
const sourceShims = (): InitFile[] => Object.entries(SHIMS).map(([path, text]) => ({ path, text }));

/** The settings of the project: the valid `astro-kit.json` of the root, else `undefined` when there is none. */
function existingSettings(root: string): Options | undefined {
  const stats = lstatSync(join(root, OPTIONS_FILE), { throwIfNoEntry: false });
  if (stats === undefined) return undefined;
  // A link is never read or written (6.4): it could name a file outside the project.
  if (!stats.isFile() || stats.nlink > 1) throw new Error(notAFile(OPTIONS_FILE));
  const report = new Report();
  const options = loadOptions(root, report);
  if (options === undefined) {
    throw new Error(`astro-kit init: astro-kit.json is not valid; fix it first.\n${report.format()}`);
  }
  return options;
}

/** The settings that the flags give, validated as `astro-kit.json` is. Throws when they are not valid. */
function settingsOfFlags(flags: InitFlags): { value: unknown; options: Options; unknown: string[] } {
  if (flags.site === undefined) throw new Error(NO_SITE);
  if (flags.locales === undefined) throw new Error(NO_LOCALES);
  if (flags.owner === undefined) throw new Error(NO_OWNER);
  const codes = parseLocales(flags.locales);
  const features = flags.features === undefined ? [] : parseFeatures(flags.features);
  const value = initSettings(flags.site, codes, features, flags.owner);
  const report = new Report();
  const options = parseOptions(value, report);
  if (options === undefined) {
    throw new Error(`astro-kit init: the flags give settings that are not valid.\n${report.format()}`);
  }
  return { value, options, unknown: codes.filter((code) => !LOCALE_TABLE.has(code)) };
}

/** The "Next:" block of a run of `init`. */
export function nextSteps(shims: boolean): string {
  if (shims) return 'Next:\n  npx --no astro-kit check\n';
  return [
    'Next:',
    '  1. npm install --ignore-scripts',
    '  2. Read node_modules/@raess/astro-kit/docs/INDEX.md. Write docs/spec.md and docs/design.md with the owner.',
    '  3. npx --no astro-kit tokens',
    '  4. npx --no astro-kit check',
    'This kit version writes .npmrc and .github/kit-identity.sh, not yet the other protected files:',
    'the workflows, dependabot.yml and CODEOWNERS in .github/, and wrangler.jsonc.',
    'So check reports config-wrangler until a later kit version writes them.',
    '',
  ].join('\n');
}

/** What `init` does with one file: write a new one, rewrite an existing one, or keep it. */
type Step = 'create' | 'overwrite' | 'keep';

/**
 * The planning pass (6.4): it reads every path that a file of init names, under the root, and writes nothing.
 * `lstat` reads each segment as it is, so a link is seen and never followed.
 *
 * - A parent segment that is a link, or exists and is no folder, throws `notAFolder`.
 * - The file itself: a link, a non-regular file, or a file with more than one link (a hard link) throws `notAFile`.
 * - A missing file is created. An existing one is kept, and with `force` it is rewritten unless `FORCE_KEPT` holds it.
 */
export function plan(root: string, paths: readonly string[], force: boolean): Map<string, Step> {
  const folders = new Map<string, boolean>();
  /** True when the folder exists. Throws when the path is a link or no folder. */
  const folder = (path: string): boolean => {
    const known = folders.get(path);
    if (known !== undefined) return known;
    const stats = lstatSync(join(root, path), { throwIfNoEntry: false });
    if (stats !== undefined && !stats.isDirectory()) throw new Error(notAFolder(path));
    folders.set(path, stats !== undefined);
    return stats !== undefined;
  };
  const steps = new Map<string, Step>();
  for (const path of paths) {
    const segments = path.split('/');
    let exists = true;
    for (let index = 1; index < segments.length && exists; index += 1) {
      exists = folder(segments.slice(0, index).join('/'));
    }
    const stats = exists ? lstatSync(join(root, path), { throwIfNoEntry: false }) : undefined;
    if (stats !== undefined && (!stats.isFile() || stats.nlink > 1)) throw new Error(notAFile(path));
    steps.set(path, stats === undefined ? 'create' : force && !FORCE_KEPT.includes(path) ? 'overwrite' : 'keep');
  }
  return steps;
}

/**
 * Writes one file of the plan. A new file is opened with `wx`, so it never replaces what appeared after the plan; an
 * existing one with `O_NOFOLLOW` where the system has it, so a link that appeared since is not followed. Every
 * error of the file system becomes a message of init.
 */
function writeOne(root: string, file: InitFile, step: 'create' | 'overwrite'): void {
  const path = join(root, file.path);
  const segments = file.path.split('/');
  try {
    for (let index = 1; index < segments.length; index += 1) {
      const parent = join(root, ...segments.slice(0, index));
      if (lstatSync(parent, { throwIfNoEntry: false }) === undefined) mkdirSync(parent);
    }
    const flags = step === 'create' ? 'wx' : constants.O_WRONLY | constants.O_TRUNC | (constants.O_NOFOLLOW ?? 0);
    const fd = openSync(path, flags);
    try {
      writeFileSync(fd, file.text);
    } finally {
      closeSync(fd);
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? 'an error';
    throw new Error(`astro-kit init: ${file.path} could not be written (${code}): it changed while init ran`);
  }
}

/**
 * The command `init` (6.4). Returns 0; a problem throws, which the command line maps to 1.
 *
 * - `--protected` throws `PROTECTED_NOT_YET` and writes nothing, until part 9e of M9.
 * - Every flag is read first: an unknown feature or an empty locale throws before a file is written.
 * - With an existing valid `astro-kit.json`, its values are used, and a flag that sets a value only prints
 *   `SETTINGS_EXIST`. An existing file that is not valid throws with its `config-options` findings.
 * - Without it, `--site`, `--locales` and `--owner` are needed, and the settings that they give must be valid.
 * - It prints `wrote <file>` or `kept <file>` for each file, in path order, and then the "Next:" block, on stdout.
 */
export function init(root: string, flags: InitFlags, io: InitIo): number {
  if (flags.protected === true) throw new Error(PROTECTED_NOT_YET);
  const flagFeatures = flags.features === undefined ? undefined : parseFeatures(flags.features);
  if (flags.locales !== undefined) parseLocales(flags.locales);
  const force = flags.force === true;
  const existing = existingSettings(root);
  const valued = [flags.site, flags.locales, flags.features, flags.owner].some((value) => value !== undefined);
  if (existing !== undefined && valued) io.err(`${SETTINGS_EXIST}\n`);

  const files: InitFile[] = [];
  const notes: string[] = [];
  let features: InitFeature[];
  if (flags.shims === true) {
    features = existing === undefined ? (flagFeatures ?? []) : enabledFeatures(existing);
    files.push(...sourceShims());
  } else {
    let options = existing;
    if (options === undefined) {
      const fresh = settingsOfFlags(flags);
      options = fresh.options;
      notes.push(...fresh.unknown.map(unknownLocale));
      files.push({ path: OPTIONS_FILE, text: settingsText(fresh.value) });
    }
    features = enabledFeatures(options);
    files.push(
      { path: 'package.json', text: packageText(options) },
      ...sourceShims(),
      ...siteTemplates(templateVariables(options)),
    );
  }
  files.push(...featureShims(features));
  // A protected file that this kit version does not render yet never comes from a template.
  for (const file of files) {
    if (PROTECTED_FILES.includes(file.path) && !Object.hasOwn(RENDERED_PROTECTED, file.path)) {
      throw new Error(`astro-kit init: ${file.path} is a protected file`);
    }
  }

  const byPath = (a: { path: string }, b: { path: string }): number => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  files.sort(byPath);
  // Every path is checked before the first write, so a run that fails writes nothing (6.4).
  const steps = plan(
    root,
    files.map((file) => file.path),
    force,
  );
  const lines = files.map((file) => {
    const step = steps.get(file.path) ?? 'keep';
    if (step === 'keep') return { path: file.path, line: `kept ${file.path}` };
    writeOne(root, file, step);
    return { path: file.path, line: `wrote ${file.path}` };
  });
  // An existing `astro-kit.json` is kept, also with `--force` (12.2): the owner changes it through the settings page.
  if (existing !== undefined && flags.shims !== true) lines.push({ path: OPTIONS_FILE, line: `kept ${OPTIONS_FILE}` });
  const text = [...lines.sort(byPath).map((entry) => entry.line), ...notes].join('\n');
  io.out(`${text}\n${nextSteps(flags.shims === true)}`);
  return 0;
}

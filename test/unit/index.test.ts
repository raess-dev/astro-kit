import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { AstroConfig, AstroIntegration, HookParameters } from 'astro';
import { mergeConfig, validateConfig } from 'astro/config';
import { FORMS_ADAPTER_OPTIONS } from '../../src/config.ts';
import { type Sha256, sha256 } from '../../src/csp.ts';
import { parseDesign } from '../../src/design/parse.ts';
import { renderTokens } from '../../src/design/tokens.ts';
import { renderWrangler } from '../../src/hosts/cloudflare.ts';
import astroKit from '../../src/index.ts';
import type { Options } from '../../src/options.ts';
import { FindingError, Report } from '../../src/registry.ts';
import { SHIMS } from '../../src/shims.ts';
import {
  EXAMPLE,
  type Files,
  inTempAsync,
  json,
  optionsOf,
  origin,
  resolvedFrom,
  SCHEDULE,
  SITE,
  SMALLEST,
  TWO_LOCALES,
} from './fixtures.ts';
import { SPEC, specBlock, variable } from './spec.ts';

// The fake arguments of Astro

type Setup = HookParameters<'astro:config:setup'>;
type Done = HookParameters<'astro:config:done'>;
type Resolved = HookParameters<'astro:routes:resolved'>;
type Built = HookParameters<'astro:build:done'>;
type Update = Parameters<Setup['updateConfig']>[0];
type Logger = Setup['logger'];
type Route = Resolved['routes'][number];
type Command = Setup['command'];

/** What the fakes recorded in one run of the hooks. */
interface Recording {
  /** The config as Astro holds it: the project's config, and then each update merged in by Astro's own merge. */
  config: AstroConfig;
  /** Each value that a hook passed to `updateConfig`. */
  updates: Update[];
  /** Each `injectScript` call: the stage and the code. */
  scripts: [stage: string, code: string][];
  /** Each `addWatchFile` call. */
  watched: string[];
  /** Each `logger.warn` call. */
  warnings: string[];
  /** Every other call to an argument of a hook, by name. The kit makes none. */
  others: string[];
}

/** A logger that records. `AstroIntegrationLogger` of Astro has no private member, so a plain object fits. */
function fakeLogger(seen: Pick<Recording, 'warnings' | 'others'>): Logger {
  const note = (name: string) => {
    return (message: string): void => {
      seen.others.push(`logger.${name}: ${message}`);
    };
  };
  const logger: Logger = {
    options: {
      destination: {
        write: (chunk) => {
          seen.others.push(`logger.write: ${chunk.message}`);
        },
      },
      level: 'silent',
    },
    label: 'astro-kit',
    fork: () => logger,
    info: note('info'),
    warn: (message) => {
      seen.warnings.push(message);
    },
    error: note('error'),
    debug: note('debug'),
    flush: () => {
      seen.others.push('logger.flush');
    },
    close: () => {
      seen.others.push('logger.close');
    },
  };
  return logger;
}

/**
 * The arguments of `astro:config:setup` for a project in `root`. `config` is what Astro 7.4 resolves from the
 * project's config `user`; no file is read for it. `updateConfig` merges as Astro does.
 */
async function setupArguments(
  root: string,
  command: Command,
  user: Readonly<Record<string, unknown>>,
): Promise<{ args: Setup; seen: Recording }> {
  const seen: Recording = {
    config: await validateConfig(user, root, command),
    updates: [],
    scripts: [],
    watched: [],
    warnings: [],
    others: [],
  };
  const other = (name: string) => {
    return (): void => {
      seen.others.push(name);
    };
  };
  const args: Setup = {
    config: seen.config,
    command,
    isRestart: false,
    updateConfig: (update) => {
      seen.updates.push(update);
      seen.config = mergeConfig<AstroConfig>(seen.config, update);
      return seen.config;
    },
    addRenderer: other('addRenderer'),
    addWatchFile: (path) => {
      seen.watched.push(typeof path === 'string' ? path : path.href);
    },
    injectScript: (stage, code) => {
      seen.scripts.push([stage, code]);
    },
    injectRoute: other('injectRoute'),
    addClientDirective: other('addClientDirective'),
    addDevToolbarApp: other('addDevToolbarApp'),
    addMiddleware: other('addMiddleware'),
    createCodegenDir: () => {
      seen.others.push('createCodegenDir');
      return new URL('.astro/integrations/astro-kit/', seen.config.root);
    },
    logger: fakeLogger(seen),
  };
  return { args, seen };
}

/** The arguments of `astro:config:done` for a resolved config. */
function doneArguments(config: AstroConfig, seen: Recording): Done {
  return {
    config,
    setAdapter: () => {
      seen.others.push('setAdapter');
    },
    injectTypes: () => {
      seen.others.push('injectTypes');
      return new URL('.astro/types.d.ts', config.root);
    },
    logger: fakeLogger(seen),
    buildOutput: 'static',
  };
}

/** The arguments of `astro:build:done` for a client directory, with an empty `assets` map. */
function builtArguments(dist: string, seen: Recording): Built {
  return { pages: [], dir: pathToFileURL(`${dist}/`), assets: new Map(), logger: fakeLogger(seen) };
}

/** One route as `astro:routes:resolved` lists it. The default is a prerendered page of the project. */
function route(
  pattern: string,
  entrypoint: string,
  more: Partial<Pick<Route, 'type' | 'origin' | 'isPrerendered'>> = {},
): Route {
  return {
    pattern,
    entrypoint,
    type: 'page',
    origin: 'project',
    isPrerendered: true,
    params: [],
    segments: [],
    patternRegex: /^$/,
    fallbackRoutes: [],
    generate: () => pattern,
    ...more,
  };
}

/** A prerendered endpoint of the project. */
const endpoint = (pattern: string, entrypoint: string, more: Partial<Pick<Route, 'isPrerendered'>> = {}): Route =>
  route(pattern, entrypoint, { type: 'endpoint', ...more });

// Running a hook

/** The value, or an error when it is missing. */
function need<Value>(value: Value | undefined, name: string): Value {
  if (value === undefined) throw new Error(`${name} is missing`);
  return value;
}

/** What `run` threw or rejected with, or `undefined` when it did neither. */
async function caught(run: () => unknown): Promise<unknown> {
  try {
    await run();
  } catch (error) {
    return error ?? new Error('thrown without a value');
  }
  return undefined;
}

/** The sorted rule ids of a `FindingError`. Any other value gives one entry that says what it is. */
function idsOf(error: unknown): string[] {
  if (!(error instanceof FindingError)) return [`no FindingError: ${String(error)}`];
  return [...new Set(error.findings.map((finding) => finding.rule))].sort();
}

/** Each finding of a `FindingError` as `<rule> <where>: <detail>`, in the order of the report. */
function findingsOf(error: unknown): string[] {
  if (!(error instanceof FindingError)) return [`no FindingError: ${String(error)}`];
  return error.findings.map((finding) => `${finding.rule} ${finding.where}: ${finding.detail ?? ''}`);
}

/** The message of a plain `Error`. A `FindingError` and any other value give one text that says what it is. */
function messageOf(error: unknown): string {
  if (error instanceof FindingError) return `a FindingError: ${idsOf(error).join(', ')}`;
  return error instanceof Error ? error.message : `no Error: ${String(error)}`;
}

const setupOf = (kit: AstroIntegration) => need(kit.hooks['astro:config:setup'], 'astro:config:setup');
const doneOf = (kit: AstroIntegration) => need(kit.hooks['astro:config:done'], 'astro:config:done');
const resolvedOf = (kit: AstroIntegration) => need(kit.hooks['astro:routes:resolved'], 'astro:routes:resolved');
const builtOf = (kit: AstroIntegration) => need(kit.hooks['astro:build:done'], 'astro:build:done');

// The project of a case

const KIT_ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** The version in the kit's `package.json`. */
const VERSION: string = need(
  (JSON.parse(readFileSync(join(KIT_ROOT, 'package.json'), 'utf8')) as { version?: string }).version,
  'the version of the kit',
);

type ThemeName = 'light' | 'dark' | 'light-contrast' | 'dark-contrast';

const LIGHT: readonly ThemeName[] = ['light'];
const LIGHT_DARK: readonly ThemeName[] = ['light', 'dark'];
const FOUR_THEMES: readonly ThemeName[] = ['light', 'dark', 'light-contrast', 'dark-contrast'];

/** The smallest design document that passes `design-format` with the given themes: one color, and one pair. */
function designMd(themes: readonly ThemeName[]): string {
  return [
    '## Themes',
    '',
    '| Theme | Use |',
    '|---|---|',
    ...themes.map((theme) => `| ${theme} | A theme. |`),
    '',
    '## Color',
    '',
    `| Token | ${themes.join(' | ')} | Use |`,
    `|---|${themes.map(() => '---|').join('')}---|`,
    `| \`--color-text\` | ${themes.map((theme) => (theme.startsWith('light') ? '`#222222`' : '`#eeeeee`')).join(' | ')} | Text. |`,
    '',
    '## Typography',
    '',
    '| Token | Value | Use |',
    '|---|---|---|',
    '| `--font-body` | `system-ui, sans-serif` | Body text. |',
    '| `--text-m` | `1rem` | Body text. |',
    '',
    '## Spacing',
    '',
    '| Token | Value | Use |',
    '|---|---|---|',
    '| `--space-2` | `0.5rem` | A small gap. |',
    '',
    '## Breakpoints',
    '',
    '| Name | Width | Use |',
    '|---|---|---|',
    '',
    '## Contrast pairs',
    '',
    '| Foreground | Background | Role | For |',
    '|---|---|---|---|',
    '| `--color-text` | `--color-text` | text | body |',
    '',
  ].join('\n');
}

/** The text of `tokens.css` that the kit renders for a design document and the settings. */
function tokensOf(design: string, options: Options): string {
  const report = new Report();
  const parsed = parseDesign(design, report);
  if (parsed === undefined) throw new Error(report.format());
  return renderTokens(parsed, options);
}

/**
 * The smallest project that passes preflight for the settings: `astro-kit.json`, the two facts files that must
 * exist, the three shims, `wrangler.jsonc`, the design document and its `tokens.css`. At this milestone the kit
 * compares `wrangler.jsonc` only for a static site, so a forms site gets the static text too.
 */
function projectFiles(settings: unknown, themes: readonly ThemeName[] = LIGHT): Files {
  const options = optionsOf(settings);
  const design = designMd(themes);
  return {
    'astro-kit.json': json(settings),
    'site.json': json(SITE),
    'schedule.json': json(SCHEDULE),
    ...SHIMS,
    'wrangler.jsonc': renderWrangler({ ...options, features: { ...options.features, forms: false } }),
    'docs/design.md': design,
    'src/styles/tokens.css': tokensOf(design, options),
  };
}

/** One project, and how its hooks are called. */
interface SiteInput {
  settings: unknown;
  themes?: readonly ThemeName[];
  /** Files that are added to the smallest project, or that replace one of its files. */
  files?: Files;
  /** Files of the smallest project that the case leaves out. */
  without?: readonly string[];
  command?: Command;
  /** The project's own Astro config. The shim gives an empty one. */
  user?: Readonly<Record<string, unknown>>;
  /** Runs on the temp folder before the first hook, for what a file map cannot hold, such as a link. */
  prepare?: (root: string) => void;
}

/** A project after `astro:config:setup`. */
interface Site {
  /** The root as the hook computes it from `config.root`. */
  root: string;
  kit: AstroIntegration;
  seen: Recording;
  /** What `astro:config:setup` threw, or `undefined`. */
  error: unknown;
}

/**
 * Writes the project into a temp folder, calls `astro:config:setup`, and runs `use`. The folder is removed at the
 * end, also after a throw. The recording and the state of the integration stay usable after that.
 */
function inSite<Result>(input: SiteInput, use: (site: Site) => Result | Promise<Result>): Promise<Result> {
  const files = { ...projectFiles(input.settings, input.themes), ...input.files };
  const kept = Object.fromEntries(Object.entries(files).filter(([name]) => !input.without?.includes(name)));
  return inTempAsync(kept, async (folder) => {
    input.prepare?.(folder);
    const { args, seen } = await setupArguments(folder, input.command ?? 'build', input.user ?? {});
    const kit = astroKit();
    const error = await caught(() => setupOf(kit)(args));
    return use({ root: fileURLToPath(seen.config.root), kit, seen, error });
  });
}

/** A project after `astro:config:setup`, with its temp folder already removed. The later hooks keep their state. */
const started = (input: SiteInput): Promise<Site> => inSite(input, (site) => site);

// Settings

const NO_SPECULATION = { speculationRules: false, astroPrefetch: false } as const;
const ALL_MODES = { auto: true, light: true, dark: true, contrast: true } as const;
const LIGHT_AND_DARK = { auto: false, light: true, dark: true, contrast: false, default: 'dark' } as const;

/** A static site with all four mode options: both inserts. */
const FOUR_MODES = { ...SMALLEST, modes: ALL_MODES } as const;

/** A static site with islands. */
const ISLANDS = { ...SMALLEST, features: { islands: true } } as const;

// Values of the specification

/** A value in backticks that the specification gives after a text. */
function specValue(before: string): string {
  const start = SPEC.indexOf(before);
  const found = start < 0 ? null : /`([^`]+)`/.exec(SPEC.slice(start + before.length));
  return need(found?.[1], `a value in docs/spec.md after ${JSON.stringify(before)}`);
}

const asHash = (text: string): Sha256 => {
  if (!text.startsWith('sha256-')) throw new Error(`${text} is no hash`);
  return `sha256-${text.slice('sha256-'.length)}`;
};

/** The hash of the speculation JSON (6.2). */
const SPECULATION_HASH = asHash(specValue('  Its hash is '));

/** The hash of the mode script with all four options and the default `auto` (9.3, the test vector). */
const MODE_HASH_ALL = asHash(specValue('the text has 1,080 bytes and hashes to '));

/** 13.1, item 11: the versions of `solid-js` that the specification names, and the hash of their script. */
const SOLID = need(
  /With solid-js ([\d.]+) and ([\d.]+) its hash is `(sha256-[^`]+)`/.exec(SPEC) ?? undefined,
  'item 11',
);
const SOLID_VERSIONS = [SOLID[1], SOLID[2]];
const SOLID_HASH = asHash(SOLID[3] ?? '');

/** The message for a site with islands and without the Solid packages (6.2). */
const ISLANDS_MISSING = specValue('  - A missing package throws ');

/** The mode script of 9.3 with its two variables filled in. */
const modeScriptOf = (modes: readonly string[], fallback: string): string =>
  specBlock('**The mode script** (`modes-script`)', 'js')
    .replace(variable('MODES'), JSON.stringify(modes))
    .replace(variable('DEFAULT'), JSON.stringify(fallback));

/** The two inserts as 6.1 writes them, with their texts from 9.3 and 6.2. */
const modeInsertOf = (modes: readonly string[], fallback: string): string =>
  `<script>${modeScriptOf(modes, fallback)}</script>`;
const SPECULATION_INSERT = `<script type="speculationrules">${specBlock('- **Speculation JSON**', 'json')}</script>`;

/** The prefetch gate of 6.2 for a value of `speculationRules`. */
const gateOf = (speculationRules: boolean): string =>
  specBlock('- **Prefetch gate.**', 'js').replace(
    variable("speculationRules ? 'true' : 'false'"),
    String(speculationRules),
  );

/** The code of `injectScript('page-ssr', …)`: the four imports of step 9, in order. */
const cssCode = (root: string): string =>
  [
    'import "@raess/astro-kit/css/base.css";',
    `import ${JSON.stringify(join(root, 'src/styles/fonts.css'))};`,
    `import ${JSON.stringify(join(root, 'src/styles/tokens.css'))};`,
    `import ${JSON.stringify(join(root, 'src/styles/elements.css'))};`,
  ].join('\n');

/** The six watch files of step 5, in its order. */
const watchFiles = (root: string): string[] =>
  ['astro-kit.json', 'site.json', 'schedule.json', 'redirects.json', 'glossary.json', 'docs/design.md'].map((file) =>
    join(root, file),
  );

/** The eleven directives of 6.2 for a site without origins. */
const DIRECTIVES: readonly string[] = [
  "default-src 'self'",
  "img-src 'self'",
  "font-src 'self'",
  "connect-src 'self'",
  "media-src 'self'",
  "manifest-src 'self'",
  "worker-src 'none'",
  "frame-src 'none'",
  "form-action 'self'",
  "base-uri 'self'",
  "object-src 'none'",
];

/** What a case changes in the table of 6.1. */
interface TableInput {
  locales?: readonly string[];
  hashes: readonly Sha256[];
  prefetch?: false | { prefetchAll: false };
}

/** The table of 6.1 for `https://example.ch`, written out. `vite.plugins` holds the names of the plugins. */
function tableOf({ locales = ['de'], hashes, prefetch = false }: TableInput): Record<string, unknown> {
  return {
    site: 'https://example.ch',
    output: 'static',
    trailingSlash: 'always',
    prerenderConflictBehavior: 'error',
    compressHTML: true,
    build: { format: 'directory', inlineStylesheets: 'always' },
    i18n: {
      defaultLocale: 'de',
      locales: [...locales],
      routing: { prefixDefaultLocale: false, redirectToDefaultLocale: false, fallbackType: 'redirect' },
    },
    image: {
      layout: 'constrained',
      responsiveStyles: true,
      breakpoints: [640, 960, 1280, 1920],
      domains: [],
      remotePatterns: [],
    },
    security: {
      checkOrigin: true,
      csp: {
        algorithm: 'SHA-256',
        directives: [...DIRECTIVES],
        scriptDirective: { resources: ["'self'"], hashes: [...hashes] },
        styleDirective: { resources: ["'self'"] },
      },
    },
    prefetch,
    markdown: { syntaxHighlight: false },
    session: false,
    vite: {
      plugins: ['astro-kit:virtual'],
      build: { cssTarget: ['chrome123', 'edge123', 'firefox120', 'safari17.5'] },
      ssr: { noExternal: ['@raess/astro-kit'] },
    },
  };
}

// Reading a recorded update

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The name of each plugin or integration of a list. Another value gives one entry that says what it is. */
function namesOf(list: unknown): unknown[] {
  if (!Array.isArray(list)) return [`no list: ${String(list)}`];
  return list.map((item: unknown) => (isRecord(item) ? item.name : item));
}

/**
 * An update as plain data: the plugins, the adapter and the integrations by name. The keys `adapter` and
 * `integrations` stay absent when the update has none.
 */
function plain(update: Update | undefined): Record<string, unknown> {
  if (update === undefined) return { missing: 'no update' };
  const { vite, adapter, integrations, ...rest } = update;
  return {
    ...rest,
    vite: { ...vite, plugins: namesOf(vite?.plugins) },
    ...(adapter === undefined ? {} : { adapter: adapter.name }),
    ...(integrations === undefined ? {} : { integrations: namesOf(integrations) }),
  };
}

/** The CSP of an update, as plain data. An update without a CSP object gives an empty object. */
function cspOf(update: Update | undefined): Readonly<Record<string, unknown>> {
  const csp: unknown = update?.security?.csp;
  return isRecord(csp) ? csp : {};
}

/** The script directive of the CSP of an update: its resources and the kit's script hashes. */
function scriptOf(update: Update | undefined): Readonly<Record<string, unknown>> {
  const script = cspOf(update).scriptDirective;
  return isRecord(script) ? script : {};
}

/** The kit's script hashes of an update. */
const hashesOf = (update: Update | undefined): unknown => scriptOf(update).hashes;

/** The code of the virtual module, as Vite gets it from the plugin of an update. */
function virtualCode(update: Update | undefined): string {
  const plugins: unknown = update?.vite?.plugins;
  const plugin = Array.isArray(plugins)
    ? plugins.find((item: unknown) => isRecord(item) && item.name === 'astro-kit:virtual')
    : undefined;
  if (!isRecord(plugin) || typeof plugin.resolveId !== 'function' || typeof plugin.load !== 'function') {
    throw new Error('the update has no plugin astro-kit:virtual');
  }
  return String(plugin.load(plugin.resolveId('virtual:astro-kit')));
}

// The integration

test('the default export gives the integration with the four hooks of 6.1, in its order', async () => {
  const kit = astroKit();
  assert.equal(kit.name, '@raess/astro-kit');
  assert.deepEqual(Object.keys(kit.hooks), [
    'astro:config:setup',
    'astro:config:done',
    'astro:routes:resolved',
    'astro:build:done',
  ]);
  const headings = [
    ...SPEC.slice(SPEC.indexOf('### 6.1'), SPEC.indexOf('### 6.2')).matchAll(/^\*\*`(astro:[a-z:]+)`\*\*/gm),
  ];
  assert.deepEqual(
    Object.keys(kit.hooks),
    headings.map((heading) => heading[1]),
  );
  assert.deepEqual(Object.keys(await import('../../src/index.ts')), ['default'], 'no other runtime export');
});

test('a hook that runs before astro:config:setup throws a plain error', async () => {
  const { args, seen } = await setupArguments(KIT_ROOT, 'build', {});
  const expected = 'astro-kit: astro:config:setup did not run before this hook.';
  const kit = astroKit();
  assert.equal(messageOf(await caught(() => doneOf(kit)(doneArguments(args.config, seen)))), expected);
  assert.equal(messageOf(await caught(() => resolvedOf(kit)({ routes: [], logger: args.logger }))), expected);
  assert.equal(messageOf(await caught(() => builtOf(kit)(builtArguments(join(KIT_ROOT, 'no-dist'), seen)))), expected);
});

// astro:config:setup

test('config:setup on the smallest project: one updateConfig with the table of 6.1, one page-ssr script, six watch files', async () => {
  const { root, seen, error } = await started({ settings: SMALLEST });
  assert.equal(error, undefined);
  assert.equal(seen.updates.length, 1);
  assert.deepEqual(plain(seen.updates[0]), tableOf({ hashes: [SPECULATION_HASH] }));
  assert.deepEqual(seen.scripts, [['page-ssr', cssCode(root)]]);
  assert.deepEqual(seen.watched, watchFiles(root));
  assert.deepEqual(seen.warnings, []);
  assert.deepEqual(seen.others, [], 'the kit calls no other argument of the hook');
});

test('config:setup reads the root as a path: a folder name with a space stays as it is', async () => {
  const folder = 'my site';
  const files = Object.fromEntries(
    Object.entries(projectFiles(SMALLEST)).map(([name, text]) => [`${folder}/${name}`, text]),
  );
  const seen = await inTempAsync(files, async (temp) => {
    const root = join(temp, folder);
    const { args, seen: recorded } = await setupArguments(root, 'build', {});
    const error = await caught(() => setupOf(astroKit())(args));
    return { error, href: args.config.root.href, root, scripts: recorded.scripts, watched: recorded.watched };
  });
  assert.equal(seen.error, undefined);
  assert.ok(seen.href.endsWith('/my%20site/'), 'Astro gives the root as a file URL');
  assert.deepEqual(seen.scripts, [['page-ssr', cssCode(seen.root)]]);
  assert.deepEqual(seen.watched, watchFiles(seen.root));
});

test('config:setup stops in a folder with % or # in its path, for every command, before any check', async () => {
  const message = (root: string): string =>
    `astro-kit: the project folder ${root} has % or # in its path. Astro then leaves the global CSS out of every page. Move the project to a folder without these characters.`;
  // The folder holds no project file. So a preflight finding would show that the check came too late.
  const run = (folder: string, command: Command): Promise<{ root: string; message: string; calls: number }> =>
    inTempAsync({ [`${folder}/.keep`]: '' }, async (temp) => {
      const { args, seen } = await setupArguments(join(temp, folder), command, {});
      const error = await caught(() => setupOf(astroKit())(args));
      return {
        root: fileURLToPath(args.config.root),
        message: messageOf(error),
        calls: seen.updates.length + seen.scripts.length + seen.watched.length + seen.warnings.length,
      };
    });
  const cases: readonly [folder: string, command: Command][] = [
    ['a%20b', 'build'],
    ['a%b', 'build'],
    ['h#i', 'build'],
    ['a%20b', 'dev'],
  ];
  const seen: { folder: string; root: string; message: string; calls: number }[] = [];
  for (const [folder, command] of cases) seen.push({ folder, ...(await run(folder, command)) });
  assert.deepEqual(
    seen,
    cases.map(([folder], index) => ({
      folder,
      root: seen[index]?.root,
      message: message(seen[index]?.root ?? ''),
      calls: 0,
    })),
  );
  assert.deepEqual(
    seen.map(({ root, folder }) => root.endsWith(`/${folder}/`)),
    cases.map(() => true),
    'the message names the folder as it is on disk',
  );
});

test('config:setup gives the virtual module the settings and the kit version', async () => {
  const { seen } = await started({ settings: SMALLEST });
  assert.equal(
    virtualCode(seen.updates[0]),
    `export const options = ${JSON.stringify(optionsOf(SMALLEST))};\nexport const kitVersion = ${JSON.stringify(VERSION)};\n`,
  );
});

test('config:setup follows the settings: the site, the locales and the adapter keys', async () => {
  const two = await started({ settings: TWO_LOCALES });
  assert.deepEqual(plain(two.seen.updates[0]), tableOf({ locales: ['de', 'fr'], hashes: [SPECULATION_HASH] }));
  const other = await started({ settings: { ...SMALLEST, site: 'https://www.hotel.example' } });
  assert.deepEqual(plain(other.seen.updates[0]), {
    ...tableOf({ hashes: [SPECULATION_HASH] }),
    site: 'https://www.hotel.example',
  });
  assert.deepEqual([two.error, other.error], [undefined, undefined]);
});

test('config:setup puts MODE_HASH into the script hashes with two or more mode options, and not with one', async () => {
  const twoModesHash = sha256(modeScriptOf(['light', 'dark'], 'dark'));
  const cases: readonly [name: string, input: SiteInput, hashes: readonly Sha256[]][] = [
    ['one option, speculation rules', { settings: SMALLEST }, [SPECULATION_HASH]],
    ['one option, no speculation rules', { settings: { ...SMALLEST, prefetch: NO_SPECULATION } }, []],
    ['four options', { settings: FOUR_MODES, themes: FOUR_THEMES }, [SPECULATION_HASH, MODE_HASH_ALL]],
    [
      'four options, no speculation rules',
      { settings: { ...FOUR_MODES, prefetch: NO_SPECULATION }, themes: FOUR_THEMES },
      [MODE_HASH_ALL],
    ],
    [
      'two options without auto',
      { settings: { ...SMALLEST, modes: LIGHT_AND_DARK }, themes: LIGHT_DARK },
      [SPECULATION_HASH, twoModesHash],
    ],
  ];
  const seen: { name: string; error: unknown; hashes: unknown }[] = [];
  for (const [name, input] of cases) {
    const site = await started(input);
    seen.push({ name, error: site.error, hashes: hashesOf(site.seen.updates[0]) });
  }
  assert.deepEqual(
    seen,
    cases.map(([name, , hashes]) => ({ name, error: undefined, hashes })),
  );
  assert.notEqual(twoModesHash, MODE_HASH_ALL);
});

test('config:setup puts the host of a declared origin into the CSP directives of 9.4', async () => {
  // Case 3 of 9.4: the example of 5.1 with scripts, a payment script in a frame, and its API.
  const settings = {
    ...EXAMPLE,
    features: { ...EXAMPLE.features, scripts: true },
    origins: [
      origin('js.pay.example', ['script', 'frame'], { load: 'gesture', allow: ['payment'] }),
      origin('api.pay.example', ['connect']),
    ],
  };
  const { seen, error } = await started({ settings, themes: LIGHT_DARK });
  assert.equal(error, undefined);
  assert.deepEqual(cspOf(seen.updates[0]), {
    algorithm: 'SHA-256',
    directives: [
      "default-src 'self'",
      "img-src 'self'",
      "font-src 'self'",
      "connect-src 'self' https://api.pay.example",
      "media-src 'self'",
      "manifest-src 'self'",
      "worker-src 'none'",
      'frame-src https://js.pay.example',
      "form-action 'self'",
      "base-uri 'self'",
      "object-src 'none'",
    ],
    scriptDirective: {
      resources: ["'self'", 'https://js.pay.example'],
      hashes: [SPECULATION_HASH, sha256(modeScriptOf(['auto', 'light', 'dark'], 'auto'))],
    },
    styleDirective: { resources: ["'self'"] },
  });

  // Case 1: without origins, the same settings give the directives without a host.
  const none = await started({ settings: { ...settings, origins: [] }, themes: LIGHT_DARK });
  assert.deepEqual(cspOf(none.seen.updates[0]).directives, [...DIRECTIVES]);
  assert.deepEqual(scriptOf(none.seen.updates[0]).resources, ["'self'"]);
});

test('config:setup injects the prefetch gate as a page script only with astroPrefetch', async () => {
  const cases: readonly [speculationRules: boolean, astroPrefetch: boolean][] = [
    [true, false],
    [false, false],
    [true, true],
    [false, true],
  ];
  const seen: { scripts: Recording['scripts']; prefetch: unknown; root: string }[] = [];
  for (const [speculationRules, astroPrefetch] of cases) {
    const site = await started({ settings: { ...SMALLEST, prefetch: { speculationRules, astroPrefetch } } });
    seen.push({ scripts: site.seen.scripts, prefetch: site.seen.updates[0]?.prefetch, root: site.root });
  }
  assert.deepEqual(
    seen.map(({ scripts }) => scripts),
    cases.map(([speculationRules, astroPrefetch], index) => {
      const css: [string, string] = ['page-ssr', cssCode(seen[index]?.root ?? '')];
      const gate: [string, string] = ['page', gateOf(speculationRules)];
      return astroPrefetch ? [gate, css] : [css];
    }),
  );
  assert.deepEqual(
    seen.map(({ prefetch }) => prefetch),
    [false, false, { prefetchAll: false }, { prefetchAll: false }],
  );
  assert.ok(gateOf(true).includes('const sr = true && '), 'the test fills the variable of the block of 6.2');
});

/** Links the kit's own `solid-js` into a project, as an installed package (14.1, Feature packages). */
function linkSolid(root: string): void {
  mkdirSync(join(root, 'node_modules'), { recursive: true });
  symlinkSync(join(KIT_ROOT, 'node_modules/solid-js'), join(root, 'node_modules/solid-js'), 'dir');
}

test('config:setup with islands adds the Solid integration and the hash of its hydration script', async () => {
  const installed: unknown = JSON.parse(readFileSync(join(KIT_ROOT, 'node_modules/solid-js/package.json'), 'utf8'));
  const version = isRecord(installed) ? installed.version : undefined;
  assert.ok(SOLID_VERSIONS.includes(String(version)), `13.1, item 11 names the installed solid-js ${String(version)}`);

  const { seen, error } = await started({ settings: ISLANDS, prepare: linkSolid });
  assert.equal(error, undefined);
  assert.deepEqual(plain(seen.updates[0]), {
    ...tableOf({ hashes: [SOLID_HASH, SPECULATION_HASH] }),
    integrations: ['@astrojs/solid-js'],
  });
  assert.equal('adapter' in (seen.updates[0] ?? {}), false, 'islands alone add no adapter');

  // With every kit hash, the order is that of 6.2: Solid, speculation, mode.
  const all = await started({ settings: { ...ISLANDS, modes: ALL_MODES }, themes: FOUR_THEMES, prepare: linkSolid });
  assert.deepEqual(hashesOf(all.seen.updates[0]), [SOLID_HASH, SPECULATION_HASH, MODE_HASH_ALL]);
});

test('config:setup with islands and no solid-js in the project throws the message of 6.2', async () => {
  // Node looks for solid-js in every folder above the temp folder too. `above` names one that holds it.
  let above: string | undefined;
  const { seen, error } = await started({
    settings: ISLANDS,
    prepare: (root) => {
      above = resolvedFrom(root, 'solid-js/web/dist/server.js');
    },
  });
  assert.equal(above, undefined, 'no folder above the temp folder holds solid-js');
  assert.equal(
    ISLANDS_MISSING,
    'astro-kit: features.islands needs solid-js and @astrojs/solid-js installed; see node_modules/@raess/astro-kit/docs/islands.md.',
  );
  assert.equal(messageOf(error), ISLANDS_MISSING);
  assert.deepEqual(seen.updates, [], 'the config is not set');
});

/** A stand-in for an installed `solid-js`: only the file that 6.2 reads, with the given module text. */
const fakeSolid = (server: string): Files => ({
  'node_modules/solid-js/package.json': json({ name: 'solid-js', version: '0.0.0', type: 'module' }),
  'node_modules/solid-js/web/dist/server.js': server,
});

test('config:setup hashes the hydration script of the solid-js that the project has installed', async () => {
  // The text of the first <script>, without the tags and without what follows it (6.2).
  const output = '<script>window.fake||(window.fake=1);</script><!--xs--><script>second</script>';
  const server = `export function generateHydrationScript() { return ${JSON.stringify(output)}; }\n`;
  const { seen, error } = await started({ settings: ISLANDS, files: fakeSolid(server) });
  assert.equal(error, undefined);
  assert.deepEqual(hashesOf(seen.updates[0]), [sha256('window.fake||(window.fake=1);'), SPECULATION_HASH]);
  assert.notEqual(sha256('window.fake||(window.fake=1);'), SOLID_HASH);
});

test('config:setup with a solid-js that gives no hydration script throws an explicit message', async () => {
  const cases: readonly [name: string, server: string, message: string][] = [
    [
      'no <script> in the output',
      "export function generateHydrationScript() { return '<!--xs-->'; }\n",
      'astro-kit: generateHydrationScript() of solid-js returned no <script>; the CSP hash cannot be computed.',
    ],
    [
      'the output is no text',
      'export function generateHydrationScript() { return 1; }\n',
      'astro-kit: generateHydrationScript() of solid-js returned no <script>; the CSP hash cannot be computed.',
    ],
    [
      'no function generateHydrationScript',
      'export const generateHydrationScript = 1;\n',
      'astro-kit: solid-js/web/dist/server.js exports no generateHydrationScript(); the CSP hash cannot be computed.',
    ],
  ];
  const seen: { name: string; message: string; updates: number }[] = [];
  for (const [name, server] of cases) {
    const site = await started({ settings: ISLANDS, files: fakeSolid(server) });
    seen.push({ name, message: messageOf(site.error), updates: site.seen.updates.length });
  }
  assert.deepEqual(
    seen,
    cases.map(([name, , message]) => ({ name, message, updates: 0 })),
  );
});

test('config:setup with forms puts the Cloudflare adapter into adapter and into integrations', async () => {
  const { seen, error } = await started({ settings: EXAMPLE, themes: LIGHT_DARK });
  assert.equal(error, undefined);
  const update = seen.updates[0];
  const modeHash = sha256(modeScriptOf(['auto', 'light', 'dark'], 'auto'));
  assert.deepEqual(plain(update), {
    ...tableOf({ locales: ['de', 'fr'], hashes: [SPECULATION_HASH, modeHash] }),
    adapter: '@astrojs/cloudflare',
    integrations: ['@astrojs/cloudflare'],
  });
  assert.equal(update?.integrations?.[0], update?.adapter, 'the same adapter object is in both places');
  assert.ok(isRecord(update?.adapter?.hooks), 'the adapter is an integration with hooks');
  assert.equal(seen.updates.length, 1);
});

test('the options of the adapter are the two of 6.1, step 7', () => {
  // The object in the call of step 7, read as JSON: `{ imageService: 'compile', … }`.
  const call = /\(await import\('@astrojs\/cloudflare'\)\)\.default\((\{[^}]*\})\)/.exec(SPEC)?.[1] ?? '';
  const options: unknown = JSON.parse(call.replaceAll("'", '"').replace(/(\w+):/g, '"$1":'));
  assert.deepEqual(options, { imageService: 'compile', prerenderEnvironment: 'node' });
  assert.deepEqual(FORMS_ADAPTER_OPTIONS, options);
});

test('config:setup with islands and forms pushes the Solid integration first, then the adapter', async () => {
  const settings = { ...EXAMPLE, features: { ...EXAMPLE.features, islands: true } };
  const { seen, error } = await started({ settings, themes: LIGHT_DARK, prepare: linkSolid });
  assert.equal(error, undefined);
  const update = plain(seen.updates[0]);
  assert.deepEqual(update.integrations, ['@astrojs/solid-js', '@astrojs/cloudflare']);
  assert.equal(update.adapter, '@astrojs/cloudflare');
  assert.deepEqual(hashesOf(seen.updates[0]), [
    SOLID_HASH,
    SPECULATION_HASH,
    sha256(modeScriptOf(['auto', 'light', 'dark'], 'auto')),
  ]);
});

// Findings in astro:config:setup

/** What a run of `astro:config:setup` gave, for a case that looks at findings. */
interface Outcome {
  /** The sorted ids of the `FindingError`, or `passed` when the hook did not throw. */
  thrown: string[] | 'passed';
  /** The sorted ids of the failing findings that `logger.warn` got. */
  warned: string[];
  /** The number of `updateConfig` calls. */
  updates: number;
}

async function outcomeOf(input: SiteInput): Promise<Outcome> {
  const { seen, error } = await started(input);
  return {
    thrown: error === undefined ? 'passed' : idsOf(error),
    warned: seen.warnings.flatMap((text) => [...text.matchAll(/✗ \[([a-z0-9-]+)\]/g)].map((id) => id[1] ?? '')).sort(),
    updates: seen.updates.length,
  };
}

const STOPPED = { warned: [], updates: 0 } as const;

/** Cases that hold a `config-options` finding: in `astro-kit.json`, in `site.json` and in `glossary.json`. */
const OPTIONS_CASES: readonly [name: string, input: SiteInput, ids: readonly string[]][] = [
  [
    'astro-kit.json: `site` is not https',
    { settings: SMALLEST, files: { 'astro-kit.json': json({ ...SMALLEST, site: 'http://example.ch' }) } },
    ['config-options'],
  ],
  ['no astro-kit.json', { settings: SMALLEST, without: ['astro-kit.json'] }, ['config-options']],
  ['no site.json', { settings: SMALLEST, without: ['site.json'] }, ['config-options']],
  [
    'glossary.json has a locale without `banned`',
    { settings: SMALLEST, files: { 'glossary.json': json({ de: {} }) } },
    ['config-options'],
  ],
  [
    'no site.json, and another finding',
    { settings: SMALLEST, without: ['site.json'], files: { 'biome.json': '{}\n' } },
    ['config-options', 'config-shim'],
  ],
];

test('a config-options finding always throws a FindingError: for build and for dev', async () => {
  const seen: { name: string; build: Outcome; dev: Outcome }[] = [];
  for (const [name, input] of OPTIONS_CASES) {
    seen.push({
      name,
      build: await outcomeOf({ ...input, command: 'build' }),
      dev: await outcomeOf({ ...input, command: 'dev' }),
    });
  }
  assert.deepEqual(
    seen,
    OPTIONS_CASES.map(([name, , ids]) => ({
      name,
      build: { thrown: ids, ...STOPPED },
      dev: { thrown: ids, ...STOPPED },
    })),
  );
});

/** Cases with one finding that is no `config-options` finding: one of preflight for each sub-step of M3, and step 3. */
const OTHER_CASES: readonly [name: string, input: SiteInput, ids: readonly string[]][] = [
  ['preflight: biome.json has another text', { settings: SMALLEST, files: { 'biome.json': '{}\n' } }, ['config-shim']],
  ['preflight: no schedule.json', { settings: SMALLEST, without: ['schedule.json'] }, ['facts-schedule']],
  ['preflight: no wrangler.jsonc', { settings: SMALLEST, without: ['wrangler.jsonc'] }, ['config-wrangler']],
  ['preflight: no docs/design.md', { settings: SMALLEST, without: ['docs/design.md'] }, ['design-format']],
  [
    'preflight: the option dark without its theme',
    { settings: { ...SMALLEST, modes: LIGHT_AND_DARK } },
    ['modes-themes'],
  ],
  ['preflight: no tokens.css', { settings: SMALLEST, without: ['src/styles/tokens.css'] }, ['design-tokens']],
  [
    'config shape: the project sets an adapter',
    { settings: SMALLEST, user: { adapter: { name: 'an-adapter', hooks: {} } } },
    ['config-adapter'],
  ],
  [
    'config shape: the project sets i18n',
    { settings: SMALLEST, user: { i18n: { defaultLocale: 'de', locales: ['de'] } } },
    ['config-i18n'],
  ],
  [
    'config shape: an experimental flag',
    { settings: SMALLEST, user: { experimental: { clientPrerender: true } } },
    ['config-experimental'],
  ],
  [
    'preflight and config shape together',
    { settings: SMALLEST, files: { 'biome.json': '{}\n' }, user: { adapter: { name: 'an-adapter', hooks: {} } } },
    ['config-adapter', 'config-shim'],
  ],
];

test('any other finding throws a FindingError for build, and goes to logger.warn for dev', async () => {
  const seen: { name: string; build: Outcome; dev: Outcome }[] = [];
  for (const [name, input] of OTHER_CASES) {
    seen.push({
      name,
      build: await outcomeOf({ ...input, command: 'build' }),
      dev: await outcomeOf({ ...input, command: 'dev' }),
    });
  }
  assert.deepEqual(
    seen,
    OTHER_CASES.map(([name, , ids]) => ({
      name,
      build: { thrown: ids, ...STOPPED },
      dev: { thrown: 'passed', warned: ids, updates: 1 },
    })),
  );
});

test('for dev, a finding is one warning in the finding format, and the hook goes on with every step', async () => {
  const { root, seen, error } = await started({ settings: SMALLEST, files: { 'biome.json': '{}\n' }, command: 'dev' });
  assert.equal(error, undefined);
  assert.equal(seen.warnings.length, 1);
  const lines = (seen.warnings[0] ?? '').split('\n');
  assert.equal(lines[0], 'astro-kit: 1 finding');
  assert.ok(lines[1]?.startsWith('✗ [config-shim] biome.json:1: '), lines[1]);
  assert.equal(lines.length, 4, 'one finding: its line, the fix and the rule');
  assert.equal(lines.at(-1), '    rule: node_modules/@raess/astro-kit/docs/standards.md#config-shim');
  assert.deepEqual(plain(seen.updates[0]), tableOf({ hashes: [SPECULATION_HASH] }));
  assert.deepEqual(seen.scripts, [['page-ssr', cssCode(root)]]);
  assert.deepEqual(seen.watched, watchFiles(root));
});

test('the config shape is checked also without valid settings: one run reports both', async () => {
  const input: SiteInput = {
    settings: SMALLEST,
    files: { 'astro-kit.json': json({ ...SMALLEST, site: 'http://example.ch' }) },
    user: { adapter: { name: 'an-adapter', hooks: {} }, experimental: { clientPrerender: true } },
  };
  const expected = { thrown: ['config-adapter', 'config-experimental', 'config-options'], ...STOPPED };
  assert.deepEqual(await outcomeOf({ ...input, command: 'build' }), expected);
  assert.deepEqual(await outcomeOf({ ...input, command: 'dev' }), expected);
});

test('for dev and for build, a project without a finding gives no warning', async () => {
  assert.deepEqual(await outcomeOf({ settings: SMALLEST, command: 'dev' }), {
    thrown: 'passed',
    warned: [],
    updates: 1,
  });
  assert.deepEqual(await outcomeOf({ settings: SMALLEST, command: 'build' }), {
    thrown: 'passed',
    warned: [],
    updates: 1,
  });
});

// astro:config:done

/** What `astro:config:done` threw for the config of a site after the updates of other integrations. */
function doneError(site: Site, ...updates: readonly Update[]): Promise<unknown> {
  const config = updates.reduce<AstroConfig>((merged, update) => mergeConfig(merged, update), site.seen.config);
  return caught(() => doneOf(site.kit)(doneArguments(config, site.seen)));
}

test('config:done passes on the config that Astro resolves from the update of the kit', async () => {
  const cases: readonly [name: string, input: SiteInput][] = [
    ['the smallest project', { settings: SMALLEST }],
    ['astroPrefetch', { settings: { ...SMALLEST, prefetch: { speculationRules: true, astroPrefetch: true } } }],
    ['four mode options', { settings: FOUR_MODES, themes: FOUR_THEMES }],
    ['forms: the adapter of the kit', { settings: EXAMPLE, themes: LIGHT_DARK }],
    ['islands', { settings: ISLANDS, prepare: linkSolid }],
  ];
  const seen: { name: string; setup: unknown; done: unknown }[] = [];
  for (const [name, input] of cases) {
    const site = await started(input);
    seen.push({ name, setup: site.error, done: await doneError(site) });
  }
  assert.deepEqual(
    seen,
    cases.map(([name]) => ({ name, setup: undefined, done: undefined })),
  );
});

const CSS_TARGETS = '["chrome123","edge123","firefox120","safari17.5"]';

/**
 * Each locked key of the table, changed in turn by the update of another integration. Astro's merge replaces a
 * plain value and concatenates an array. Each case gives one finding: the rule, the key and the detail.
 */
const CHANGES: readonly [update: Update, finding: string][] = [
  [{ site: 'https://other.example' }, 'config-locked site: https://other.example instead of https://example.ch'],
  [{ output: 'server' }, 'config-locked output: server instead of static'],
  [{ trailingSlash: 'never' }, 'config-locked trailingSlash: never instead of always'],
  [{ prerenderConflictBehavior: 'warn' }, 'config-locked prerenderConflictBehavior: warn instead of error'],
  [{ compressHTML: false }, 'config-locked compressHTML: false instead of true'],
  [{ build: { format: 'file' } }, 'config-locked build.format: file instead of directory'],
  [{ build: { inlineStylesheets: 'auto' } }, 'config-locked build.inlineStylesheets: auto instead of always'],
  [{ image: { layout: 'fixed' } }, 'config-locked image.layout: fixed instead of constrained'],
  [{ image: { responsiveStyles: false } }, 'config-locked image.responsiveStyles: false instead of true'],
  [
    { image: { breakpoints: [320] } },
    'config-locked image.breakpoints: [640,960,1280,1920,320] instead of [640,960,1280,1920]',
  ],
  [{ image: { domains: ['img.example'] } }, 'config-locked image.domains: ["img.example"] instead of []'],
  [
    { image: { remotePatterns: [{ hostname: 'img.example' }] } },
    'config-locked image.remotePatterns: [{"hostname":"img.example"}] instead of []',
  ],
  [{ security: { checkOrigin: false } }, 'config-locked security.checkOrigin: false instead of true'],
  [{ security: { csp: false } }, 'config-locked security.csp: false instead of an object'],
  [{ security: { csp: { algorithm: 'SHA-512' } } }, 'config-locked security.csp.algorithm: SHA-512 instead of SHA-256'],
  [
    { security: { csp: { algorithm: 'SHA-256', scriptDirective: { resources: ["'unsafe-inline'"] } } } },
    `config-locked security.csp.scriptDirective.resources: ["'self'","'unsafe-inline'"] instead of ["'self'"]`,
  ],
  [{ prefetch: true }, 'config-locked prefetch: true instead of false'],
  [{ markdown: { syntaxHighlight: 'shiki' } }, 'config-locked markdown.syntaxHighlight: shiki instead of false'],
  [{ session: { ttl: 60 } }, 'config-locked session: {"ttl":60} instead of false'],
  [
    { vite: { build: { cssTarget: ['ie11'] } } },
    `config-locked vite.build.cssTarget: ${CSS_TARGETS.replace(']', ',"ie11"]')} instead of ${CSS_TARGETS}`,
  ],
  [
    { vite: { ssr: { noExternal: ['other'] } } },
    'config-locked vite.ssr.noExternal: ["@raess/astro-kit","other"] instead of ["@raess/astro-kit"]',
  ],
  [
    { i18n: { fallback: { fr: 'de' } } },
    'config-i18n i18n: {"defaultLocale":"de","locales":["de","fr"],"routing":{"prefixDefaultLocale":false,"redirectToDefaultLocale":false,"fallbackType":"redirect"},"fallback":{"fr":"de"}} instead of {"defaultLocale":"de","locales":["de","fr"],"routing":{"prefixDefaultLocale":false,"redirectToDefaultLocale":false,"fallbackType":"redirect"}}',
  ],
  [{ adapter: { name: 'an-adapter', hooks: {} } }, 'config-adapter adapter: an-adapter'],
];

test('config:done: each locked key, changed in turn, gives its finding with the key and the detail', async () => {
  const site = await started({ settings: TWO_LOCALES });
  assert.equal(site.error, undefined);
  const seen: string[][] = [];
  for (const [update] of CHANGES) seen.push(findingsOf(await doneError(site, update)));
  assert.deepEqual(
    seen,
    CHANGES.map(([, finding]) => [finding]),
  );

  // Every key of the 6.1 table that the kit locks has a case.
  const rows = SPEC.slice(SPEC.indexOf('| Key | Value (locked) |'), SPEC.indexOf('**Why `session` is locked.**'))
    .split('\n')
    .map((line) => /^\| `([^`]+)`/.exec(line)?.[1])
    .filter((key) => key !== undefined && key !== 'vite.plugins');
  assert.equal(rows.length, 15);
  const places = CHANGES.map(([, finding]) => finding.split(' ')[1]?.replace(/:$/, '') ?? '');
  assert.deepEqual(
    rows.filter((key) => !places.some((place) => place === key || place.startsWith(`${key}.`))),
    [],
  );
});

test('config:done reports every changed value in one run', async () => {
  const site = await started({ settings: SMALLEST });
  const error = await doneError(
    site,
    { output: 'server' },
    { compressHTML: false },
    { adapter: { name: 'an-adapter', hooks: {} } },
  );
  assert.deepEqual(findingsOf(error), [
    'config-locked output: server instead of static',
    'config-locked compressHTML: false instead of true',
    'config-adapter adapter: an-adapter',
  ]);
});

test('config:done with forms: the adapter of the kit passes, and another adapter fails', async () => {
  const site = await started({ settings: EXAMPLE, themes: LIGHT_DARK });
  assert.equal(await doneError(site), undefined);
  assert.deepEqual(findingsOf(await doneError(site, { adapter: { name: 'an-adapter' } })), [
    'config-adapter adapter: an-adapter',
  ]);
});

const isIntegration = (value: unknown): value is AstroIntegration =>
  isRecord(value) && typeof value.name === 'string' && isRecord(value.hooks);

/**
 * Runs the `astro:config:setup` hook of the adapter that the kit added, on the config that the hook of the kit
 * left. Astro does the same: it runs the hooks of an integration that was pushed during the loop (13.1, item 7).
 */
async function afterAdapterSetup(site: Site): Promise<{ config: AstroConfig; seen: Recording }> {
  const added: unknown = site.seen.updates[0]?.adapter;
  if (!isIntegration(added)) throw new Error('the update of the kit holds no adapter');
  const { args, seen } = await setupArguments(site.root, 'build', {});
  seen.config = site.seen.config;
  await setupOf(added)({ ...args, config: site.seen.config });
  return { config: seen.config, seen };
}

test('config:done with forms passes after the Cloudflare adapter ran its own hook, which doubles image.breakpoints', async () => {
  const outcome = await inSite({ settings: EXAMPLE, themes: LIGHT_DARK }, async (site) => {
    const { config, seen } = await afterAdapterSetup(site);
    const more = mergeConfig<AstroConfig>(config, { image: { breakpoints: [320] } });
    return {
      setup: site.error,
      breakpoints: config.image.breakpoints,
      service: config.image.service,
      endpoint: config.image.endpoint,
      session: config.session,
      done: await caught(() => doneOf(site.kit)(doneArguments(config, seen))),
      changed: findingsOf(await caught(() => doneOf(site.kit)(doneArguments(more, seen)))),
    };
  });
  // The adapter passes the whole image config back to updateConfig, and Astro joins two lists (13.1, item 59).
  assert.deepEqual(outcome, {
    setup: undefined,
    breakpoints: [640, 960, 1280, 1920, 640, 960, 1280, 1920],
    // `imageService: 'compile'` (6.1, step 7): Astro's own service builds the images, and the Worker passes
    // an image request through. Without the option the adapter sets its binding service.
    service: {
      build: { entrypoint: 'astro/assets/services/sharp', config: {} },
      runtime: { entrypoint: '@astrojs/cloudflare/image-service-workerd' },
    },
    endpoint: { route: '/_image', entrypoint: '@astrojs/cloudflare/image-passthrough-endpoint' },
    session: false,
    done: undefined,
    changed: [
      'config-locked image.breakpoints: [640,960,1280,1920,640,960,1280,1920,320] instead of [640,960,1280,1920]',
    ],
  });
});

// astro:routes:resolved

const SHIM = 'src/pages/api/forms/[form].ts';

/** The routes that Astro adds itself to every build (13.1, item 44). They are on demand. */
const INTERNAL: readonly Route[] = [
  route('/_image', 'node_modules/astro/dist/assets/endpoint/generic.js', {
    type: 'endpoint',
    origin: 'internal',
    isPrerendered: false,
  }),
  route('/_server-islands/[name]', '_server-islands.astro', { origin: 'internal', isPrerendered: false }),
];

/** The project routes of a static site that pass. */
const PAGES: readonly Route[] = [
  route('/', 'src/pages/index.astro'),
  route('/zimmer/[slug]', 'src/pages/zimmer/[slug].astro'),
  route('/fr', 'src/pages/fr/index.astro'),
  route('/404', 'src/pages/404.astro'),
];

/** The form endpoint of a forms site, as S19 recorded it. */
const FORM_ROUTE = endpoint('/api/forms/[form]', SHIM, { isPrerendered: false });

/** What the hook threw for a list: the sorted ids and the findings, or two empty lists when it passed. */
async function routesOutcome(site: Site, routes: readonly Route[]): Promise<{ ids: string[]; findings: string[] }> {
  const error = await caught(() => resolvedOf(site.kit)({ routes: [...routes], logger: fakeLogger(site.seen) }));
  return error === undefined ? { ids: [], findings: [] } : { ids: idsOf(error), findings: findingsOf(error) };
}

const NO_FINDING = { ids: [], findings: [] } as const;

test('routes:resolved passes prerendered pages, static file endpoints, and the routes of Astro itself', async () => {
  const site = await started({ settings: TWO_LOCALES });
  const routes = [
    ...PAGES,
    ...INTERNAL,
    endpoint('/live.json', 'src/pages/live.json.ts'),
    endpoint('/feeds/[lang].json', 'src/pages/feeds/[lang].json.ts'),
    endpoint('/fr/feeds/[lang].json', 'src/pages/fr/feeds/[lang].json.ts'),
    endpoint('/fr/live.json', 'src/pages/fr/live.json.ts'),
    endpoint('/sitemaps/news.xml', 'src/pages/sitemaps/news.xml.ts'),
    endpoint('/robots.json', 'src/pages/robots.json.ts'),
    // A redirect is no prerendered route, and the first check does not look at it.
    route('/alt', 'src/pages/alt.astro', { type: 'redirect', isPrerendered: false }),
    // A route of another integration is not a project route.
    route('/_extern/[...path]', 'node_modules/other/route.js', {
      type: 'endpoint',
      origin: 'external',
      isPrerendered: false,
    }),
  ];
  assert.deepEqual(await routesOutcome(site, routes), NO_FINDING);
  assert.deepEqual(await routesOutcome(site, []), NO_FINDING, 'a static build with zero pages gives an empty list');
  assert.deepEqual(await routesOutcome(site, PAGES), NO_FINDING, 'the shorter first list of a static build');
});

/** One route added to the passing routes of a site with the locales `de` and `fr`, and its findings. */
const ROUTE_CASES: readonly [route: Route, findings: readonly string[]][] = [
  // routes-on-demand
  [
    route('/live', 'src/pages/live.astro', { isPrerendered: false }),
    ['routes-on-demand src/pages/live.astro: /live is not prerendered'],
  ],
  [
    endpoint('/live.json', 'src/pages/live.json.ts', { isPrerendered: false }),
    ['routes-on-demand src/pages/live.json.ts: /live.json is not prerendered'],
  ],
  // routes-slug, the endpoint clause: the file extension
  [
    endpoint('/data', 'src/pages/data.ts'),
    ['routes-slug src/pages/data.ts: /data: the pattern does not end with a literal file extension'],
  ],
  [
    endpoint('/data/[file]', 'src/pages/data/[file].ts'),
    ['routes-slug src/pages/data/[file].ts: /data/[file]: the pattern does not end with a literal file extension'],
  ],
  [
    endpoint('/a/index.html', 'src/pages/a/index.html.ts'),
    ['routes-slug src/pages/a/index.html.ts: /a/index.html: the extension .html is that of a page'],
  ],
  [
    endpoint('/a/index.htm', 'src/pages/a/index.htm.ts'),
    ['routes-slug src/pages/a/index.htm.ts: /a/index.htm: the extension .htm is that of a page'],
  ],
  [
    endpoint('/data/[file.json]', 'src/pages/data/[file.json].ts'),
    [
      'routes-slug src/pages/data/[file.json].ts: /data/[file.json]: the pattern does not end with a literal file extension',
    ],
  ],
  [
    endpoint('/data.JSON', 'src/pages/data.JSON.ts'),
    ['routes-slug src/pages/data.JSON.ts: /data.JSON: the pattern does not end with a literal file extension'],
  ],
  // the first segment
  [
    endpoint('/[name].txt', 'src/pages/[name].txt.ts'),
    ['routes-slug src/pages/[name].txt.ts: /[name].txt: the first segment holds a parameter'],
  ],
  [
    endpoint('/[dir]/[file].json', 'src/pages/[dir]/[file].json.ts'),
    ['routes-slug src/pages/[dir]/[file].json.ts: /[dir]/[file].json: the first segment holds a parameter'],
  ],
  [
    endpoint('/api/data.json', 'src/pages/api/data.json.ts'),
    ['routes-slug src/pages/api/data.json.ts: /api/data.json: the first segment is the reserved segment api'],
  ],
  [
    endpoint('/_kit/release.txt', 'src/pages/_kit/release.txt.ts'),
    ['routes-slug src/pages/_kit/release.txt.ts: /_kit/release.txt: the first segment is the reserved segment _kit'],
  ],
  [
    endpoint('/.well-known/security.txt', 'src/pages/.well-known/security.txt.ts'),
    [
      'routes-slug src/pages/.well-known/security.txt.ts: /.well-known/security.txt: the first segment is the reserved segment .well-known',
    ],
  ],
  // the segment after a locale code
  [
    endpoint('/fr/[x].json', 'src/pages/fr/[x].json.ts'),
    ['routes-slug src/pages/fr/[x].json.ts: /fr/[x].json: the segment after the locale code holds a parameter'],
  ],
  [
    endpoint('/fr/api/data.json', 'src/pages/fr/api/data.json.ts'),
    [
      'routes-slug src/pages/fr/api/data.json.ts: /fr/api/data.json: the segment after the locale code is the reserved segment api',
    ],
  ],
  // the files of the kit
  [
    endpoint('/robots.txt', 'src/pages/robots.txt.ts'),
    ['routes-slug src/pages/robots.txt.ts: /robots.txt: the kit writes this file'],
  ],
  [
    endpoint('/sitemap.xml', 'src/pages/sitemap.xml.ts'),
    ['routes-slug src/pages/sitemap.xml.ts: /sitemap.xml: the kit writes this file'],
  ],
  [
    endpoint('/sitemap-1.xml', 'src/pages/sitemap-1.xml.ts'),
    ['routes-slug src/pages/sitemap-1.xml.ts: /sitemap-1.xml: the kit writes this file'],
  ],
  [
    endpoint('/_headers', 'src/pages/_headers.ts'),
    [
      'routes-slug src/pages/_headers.ts: /_headers: the pattern does not end with a literal file extension; the kit writes this file',
    ],
  ],
  [
    endpoint('/_redirects', 'src/pages/_redirects.ts'),
    [
      'routes-slug src/pages/_redirects.ts: /_redirects: the pattern does not end with a literal file extension; the kit writes this file',
    ],
  ],
  // The form shim on a site without forms: an on-demand endpoint under the reserved segment `api`.
  [
    FORM_ROUTE,
    [
      `routes-on-demand ${SHIM}: /api/forms/[form] is not prerendered`,
      `routes-slug ${SHIM}: /api/forms/[form]: the pattern does not end with a literal file extension; the first segment is the reserved segment api`,
    ],
  ],
];

test('routes:resolved: one route that breaks a sentence of the two rules gives exactly its findings', async () => {
  const site = await started({ settings: TWO_LOCALES });
  const seen: string[][] = [];
  for (const [added] of ROUTE_CASES) seen.push((await routesOutcome(site, [...PAGES, ...INTERNAL, added])).findings);
  assert.deepEqual(
    seen,
    ROUTE_CASES.map(([, findings]) => [...findings]),
  );
});

test('routes:resolved reports every route of one list, and a second call gives the same findings', async () => {
  const site = await started({ settings: TWO_LOCALES });
  const routes = [
    ...PAGES,
    endpoint('/[name].txt', 'src/pages/[name].txt.ts'),
    endpoint('/feeds/[lang].json', 'src/pages/feeds/[lang].json.ts'),
    route('/live', 'src/pages/live.astro', { isPrerendered: false }),
    ...INTERNAL,
  ];
  const expected = {
    ids: ['routes-on-demand', 'routes-slug'],
    findings: [
      'routes-slug src/pages/[name].txt.ts: /[name].txt: the first segment holds a parameter',
      'routes-on-demand src/pages/live.astro: /live is not prerendered',
    ],
  };
  const first = await routesOutcome(site, routes);
  const second = await routesOutcome(site, routes);
  assert.deepEqual(first, expected);
  assert.deepEqual(second, expected);

  // Astro calls the hook with a shorter list first (S19). Each call checks only its own list.
  assert.deepEqual(await routesOutcome(site, PAGES), NO_FINDING);
  assert.deepEqual(await routesOutcome(site, routes), expected);
});

test('routes:resolved names an absolute entrypoint by its path from the root', async () => {
  const site = await started({ settings: SMALLEST });
  const absolute = route('/live', join(site.root, 'src/pages/live.astro'), { isPrerendered: false });
  assert.deepEqual((await routesOutcome(site, [absolute])).findings, [
    'routes-on-demand src/pages/live.astro: /live is not prerendered',
  ]);
  const outside = route('/live', '/somewhere/else/live.astro', { isPrerendered: false });
  assert.deepEqual((await routesOutcome(site, [outside])).findings, [
    'routes-on-demand /somewhere/else/live.astro: /live is not prerendered',
  ]);
});

test('routes:resolved: a locale code is a first segment only when the site declares it', async () => {
  // With the one locale `de`, `fr` is a plain folder: the second segment may hold a parameter.
  const one = await started({ settings: SMALLEST });
  const french = endpoint('/fr/[x].json', 'src/pages/fr/[x].json.ts');
  assert.deepEqual(await routesOutcome(one, [french]), NO_FINDING);
  assert.deepEqual((await routesOutcome(one, [endpoint('/de/[x].json', 'src/pages/de/[x].json.ts')])).ids, [
    'routes-slug',
  ]);
  const two = await started({ settings: TWO_LOCALES });
  assert.deepEqual((await routesOutcome(two, [french])).ids, ['routes-slug']);
});

test('routes:resolved with forms: the form shim is the one route that may run on demand', async () => {
  const forms = await started({ settings: EXAMPLE, themes: LIGHT_DARK });
  assert.equal(forms.error, undefined);
  assert.deepEqual(await routesOutcome(forms, [...PAGES, ...INTERNAL, FORM_ROUTE]), NO_FINDING);
  assert.deepEqual(
    await routesOutcome(forms, [endpoint('/api/forms/[form]', join(forms.root, SHIM), { isPrerendered: false })]),
    NO_FINDING,
    'the entrypoint can be absolute',
  );

  const cases: readonly [name: string, route: Route, ids: readonly string[]][] = [
    [
      'the pattern of the shim with another entrypoint',
      endpoint('/api/forms/[form]', 'src/pages/api/forms/[form].js', { isPrerendered: false }),
      ['routes-on-demand', 'routes-slug'],
    ],
    [
      'the shim file under another pattern',
      endpoint('/api/forms/[id]', SHIM, { isPrerendered: false }),
      ['routes-on-demand', 'routes-slug'],
    ],
    [
      'another on-demand endpoint',
      endpoint('/live.json', 'src/pages/live.json.ts', { isPrerendered: false }),
      ['routes-on-demand'],
    ],
    ['an on-demand page', route('/live', 'src/pages/live.astro', { isPrerendered: false }), ['routes-on-demand']],
    ['a prerendered endpoint under api', endpoint('/api/data.json', 'src/pages/api/data.json.ts'), ['routes-slug']],
  ];
  const seen: { name: string; ids: string[] }[] = [];
  for (const [name, added] of cases) seen.push({ name, ids: (await routesOutcome(forms, [FORM_ROUTE, added])).ids });
  assert.deepEqual(
    seen,
    cases.map(([name, , ids]) => ({ name, ids })),
  );

  // Without forms, the same route fails both rules.
  const none = await started({ settings: TWO_LOCALES });
  assert.deepEqual((await routesOutcome(none, [FORM_ROUTE])).ids, ['routes-on-demand', 'routes-slug']);
});

// astro:build:done

/** A built page in three parts: the bytes up to the CSP meta, the meta, and the rest. */
interface Page {
  before: string;
  meta: string;
  after: string;
}

/** A page as Astro builds it: the CSP meta follows the head tags of the project and stands before the `<style>`. */
const page = (title: string, styleHash: string, head = ''): Page => ({
  before: `<!DOCTYPE html><html lang="de"><head><meta charset="utf-8"><title>${title}</title>${head}`,
  meta: `<meta http-equiv="content-security-policy" content="default-src 'self'; script-src 'self' 'sha256-c2NyaXB0'; style-src 'self' 'sha256-${styleHash}';">`,
  after: `<style>@layer reset{h1{margin:0}}</style></head><body><h1>${title}</h1><p>Zimmer für Gäste, schön &amp; ruhig.</p></body></html>`,
});

const sourceOf = (built: Page): string => built.before + built.meta + built.after;
const withInsert = (built: Page, insert: string): string => built.before + built.meta + insert + built.after;

/** The bytes of a text, one character for each byte, so that a comparison shows every byte. */
const bytesOf = (text: string): string => Buffer.from(text, 'utf8').toString('latin1');

const canonical = (path: string): string => `<link rel="canonical" href="https://example.ch${path}">`;

/** The pages of the fake dist: two that the sitemap lists, one with `noindex`, and the 404 page. */
const BUILT_PAGES: Readonly<Record<string, Page>> = {
  'index.html': page('Start', 'aG9tZQ==', canonical('/')),
  'zimmer/index.html': page(
    'Zimmer',
    'emltbWVy',
    `${canonical('/zimmer/')}<script type="application/ld+json">{"@context":"https://schema.org","@type":"WebPage","dateModified":"2025-06-01"}</script>`,
  ),
  'entwurf/index.html': page(
    'Entwurf',
    'ZW50d3VyZg==',
    `${canonical('/entwurf/')}<meta name="robots" content="noindex">`,
  ),
  '404.html': page('Nicht gefunden', 'NDA0'),
};

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a, 0xff, 0x00]);

/** The files of a fake client directory under `folder`: the pages, a CSS file and a PDF. */
const distFiles = (folder: string): Files => ({
  ...Object.fromEntries(Object.entries(BUILT_PAGES).map(([file, built]) => [`${folder}/${file}`, sourceOf(built)])),
  [`${folder}/_astro/index.a1b2c3.css`]: '@layer reset{h1{margin:0}}',
  [`${folder}/docs/preise.pdf`]: PDF,
});

const REDIRECTS = [
  { from: '/blog/*', to: '/' },
  { from: '/alt/', to: '/zimmer/' },
  { from: '/weg/', gone: true },
];

/** The header policy of 6.2 for a site without scripts, islands and origins: Trusted Types is on. */
const HEADER_POLICY =
  "frame-ancestors 'none'; base-uri 'none'; object-src 'none'; form-action 'self'; require-trusted-types-for 'script'; trusted-types 'none'";

/** The `_headers` text of 6.3 for such a site. */
const HEADERS = `${specBlock('**`_headers`.** The kit', 'text').replace('<header policy>', HEADER_POLICY)}\n`;

const ROBOTS = `${specBlock('**`robots.txt`** (exact', 'text').replace(variable('site'), 'https://example.ch')}\n`;

const SITEMAP = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  '<url><loc>https://example.ch/</loc></url>',
  '<url><loc>https://example.ch/zimmer/</loc><lastmod>2025-06-01</lastmod></url>',
  '</urlset>',
  '',
].join('\n');

/** `security.txt` of 6.3 for the languages, with a mark in place of the time of its `Expires` line. */
const securityOf = (languages: string): string =>
  [
    'Contact: mailto:security@example.ch',
    'Expires: <time>',
    `Preferred-Languages: ${languages}`,
    'Canonical: https://example.ch/.well-known/security.txt',
    '',
  ].join('\n');

/** The seven edge files, in the order of 6.3. */
const EDGE_FILES = [
  '_headers',
  '_redirects',
  'robots.txt',
  'sitemap.xml',
  '.well-known/security.txt',
  '_kit/release.txt',
  '_kit/routes.txt',
] as const;

const EXPIRES_LINE = /^Expires: (.*)$/m;

/** The text of `security.txt` with the mark in place of the time of its `Expires` line. */
const withoutTime = (text: string | undefined): string => (text ?? '').replace(EXPIRES_LINE, 'Expires: <time>');

/** The time of the `Expires` line of `security.txt`, or an empty text. */
const expiresOf = (text: string | undefined): string => EXPIRES_LINE.exec(text ?? '')?.[1] ?? '';

const DAY_MS = 86_400_000;

/** The text of a file, or a text that says that the file is missing. */
function textOf(file: string): string {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return `no file ${file}`;
  }
}

/** The bytes of each page of the fake dist, by file. */
const pageBytes = (dist: string): Record<string, string> =>
  Object.fromEntries(Object.keys(BUILT_PAGES).map((file) => [file, readFileSync(join(dist, file)).toString('latin1')]));

/** The text of each edge file of the client directory, by file. */
const edgeTexts = (dist: string): Record<string, string> =>
  Object.fromEntries(EDGE_FILES.map((file) => [file, textOf(join(dist, file))]));

/** Sets `GITHUB_SHA` for the time of `use`, and puts the earlier value back. */
async function withSha<Result>(sha: string | undefined, use: () => Promise<Result>): Promise<Result> {
  const before = process.env.GITHUB_SHA;
  if (sha === undefined) delete process.env.GITHUB_SHA;
  else process.env.GITHUB_SHA = sha;
  try {
    return await use();
  } finally {
    if (before === undefined) delete process.env.GITHUB_SHA;
    else process.env.GITHUB_SHA = before;
  }
}

/** What `astro:build:done` threw on the client directory `<root>/<folder>`, or `undefined`. */
const buildDone = (site: Site, folder = 'dist'): Promise<unknown> =>
  caught(() => builtOf(site.kit)(builtArguments(join(site.root, folder), site.seen)));

test('build:done on a static site: both inserts right after the CSP meta, no other byte changed, seven edge files byte-exact', async () => {
  const input: SiteInput = {
    settings: FOUR_MODES,
    themes: FOUR_THEMES,
    files: { ...distFiles('dist'), 'redirects.json': json(REDIRECTS) },
  };
  const seen = await inSite(input, (site) =>
    withSha('0123456789abcdef0123456789abcdef01234567', async () => {
      const dist = join(site.root, 'dist');
      const before = Date.now();
      const error = await buildDone(site);
      return {
        setup: site.error,
        error,
        before,
        after: Date.now(),
        pages: pageBytes(dist),
        edge: edgeTexts(dist),
        pdf: [...readFileSync(join(dist, 'docs/preise.pdf'))],
        css: textOf(join(dist, '_astro/index.a1b2c3.css')),
        warnings: site.seen.warnings,
      };
    }),
  );
  assert.equal(seen.setup, undefined);
  assert.equal(seen.error, undefined);

  // The mode script comes first, then the speculation block (6.1, step 1). Every other byte is as Astro wrote it.
  const insert = modeInsertOf(['auto', 'light', 'dark', 'contrast'], 'auto') + SPECULATION_INSERT;
  assert.equal(sha256(modeScriptOf(['auto', 'light', 'dark', 'contrast'], 'auto')), MODE_HASH_ALL);
  assert.deepEqual(
    seen.pages,
    Object.fromEntries(Object.entries(BUILT_PAGES).map(([file, built]) => [file, bytesOf(withInsert(built, insert))])),
  );
  assert.ok(seen.pages['index.html']?.includes(`';">${bytesOf(insert)}<style>`), 'between the meta and the <style>');
  assert.deepEqual(seen.pdf, [...PDF]);
  assert.equal(seen.css, '@layer reset{h1{margin:0}}');

  const security = seen.edge['.well-known/security.txt'];
  assert.deepEqual(
    { ...seen.edge, '.well-known/security.txt': withoutTime(security) },
    {
      _headers: HEADERS,
      _redirects: '/alt/ /zimmer/ 301\n/blog/* / 301\n',
      'robots.txt': ROBOTS,
      'sitemap.xml': SITEMAP,
      '.well-known/security.txt': securityOf('de'),
      '_kit/release.txt': `0123456789abcdef0123456789abcdef01234567\n@raess/astro-kit ${VERSION}\n`,
      '_kit/routes.txt': '/\n/docs/preise.pdf\n/entwurf/\n/zimmer/\n',
    },
  );

  // `Expires` is the build time plus 180 days, in ISO 8601 without milliseconds, ending in Z.
  const expires = expiresOf(security);
  assert.match(expires, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  assert.ok(Date.parse(expires) >= Math.floor(seen.before / 1000) * 1000 + 180 * DAY_MS, expires);
  assert.ok(Date.parse(expires) <= seen.after + 180 * DAY_MS, expires);
  assert.deepEqual(seen.warnings, []);
});

test('build:done inserts only what the settings ask for, and release.txt says local without GITHUB_SHA', async () => {
  const three = modeInsertOf(['auto', 'light', 'dark'], 'auto');
  const cases: readonly [name: string, settings: unknown, themes: readonly ThemeName[], insert: string][] = [
    ['one mode option, speculation rules', SMALLEST, LIGHT, SPECULATION_INSERT],
    ['one mode option, no speculation rules', { ...SMALLEST, prefetch: NO_SPECULATION }, LIGHT, ''],
    [
      'three mode options, no speculation rules',
      { ...SMALLEST, modes: EXAMPLE.modes, prefetch: NO_SPECULATION },
      LIGHT_DARK,
      three,
    ],
    [
      'three mode options, speculation rules',
      { ...SMALLEST, modes: EXAMPLE.modes },
      LIGHT_DARK,
      three + SPECULATION_INSERT,
    ],
  ];
  const seen: { name: string; error: unknown; pages: Record<string, string>; release: string }[] = [];
  for (const [name, settings, themes] of cases) {
    seen.push(
      await inSite({ settings, themes, files: distFiles('dist') }, (site) =>
        withSha(undefined, async () => {
          const error = await buildDone(site);
          const dist = join(site.root, 'dist');
          return { name, error, pages: pageBytes(dist), release: textOf(join(dist, '_kit/release.txt')) };
        }),
      ),
    );
  }
  assert.deepEqual(
    seen,
    cases.map(([name, , , insert]) => ({
      name,
      error: undefined,
      pages: Object.fromEntries(
        Object.entries(BUILT_PAGES).map(([file, built]) => [file, bytesOf(withInsert(built, insert))]),
      ),
      release: `local\n@raess/astro-kit ${VERSION}\n`,
    })),
  );
});

test('build:done on a forms site works in the client directory, and merges the _headers of the adapter', async () => {
  // The adapter ran first: it wrote its asset rule into `dist/client/_headers` (13.1, items 16 and 18).
  const adapterRule = '/_astro/*\n  Cache-Control: public, max-age=31536000, immutable\n';
  const input: SiteInput = {
    settings: EXAMPLE,
    themes: LIGHT_DARK,
    files: {
      ...distFiles('dist/client'),
      'dist/client/_headers': adapterRule,
      'dist/server/entry.mjs': 'export {};\n',
    },
  };
  const seen = await inSite(input, async (site) => {
    const error = await buildDone(site, 'dist/client');
    const client = join(site.root, 'dist/client');
    return {
      setup: site.error,
      error,
      pages: pageBytes(client),
      headers: textOf(join(client, '_headers')),
      security: textOf(join(client, '.well-known/security.txt')),
      outside: EDGE_FILES.map((file) => textOf(join(site.root, 'dist', file)).startsWith('no file ')),
      server: textOf(join(site.root, 'dist/server/entry.mjs')),
    };
  });
  assert.equal(seen.setup, undefined);
  assert.equal(seen.error, undefined);
  const insert = modeInsertOf(['auto', 'light', 'dark'], 'auto') + SPECULATION_INSERT;
  assert.deepEqual(
    seen.pages,
    Object.fromEntries(Object.entries(BUILT_PAGES).map(([file, built]) => [file, bytesOf(withInsert(built, insert))])),
  );
  assert.equal(seen.headers, HEADERS, 'the rule of the kit comes first, and there is one asset rule');
  assert.equal(withoutTime(seen.security), securityOf('de, fr'));
  assert.deepEqual(
    seen.outside,
    EDGE_FILES.map(() => true),
    'nothing is written outside the client directory',
  );
  assert.equal(seen.server, 'export {};\n');
});

/** Plants in the fake dist that fail one audit, and the exact ids of the `FindingError`. */
const PLANTS: readonly [name: string, files: Files, ids: readonly string[]][] = [
  ['a _headers rule with X-Frame-Options', { 'dist/_headers': '/*\n  X-Frame-Options: DENY\n' }, ['edge-headers']],
  [
    'a _headers file with one pattern twice',
    { 'dist/_headers': '/x/*\n  X-Robots-Tag: noindex\n/x/*\n  X-Robots-Tag: none\n' },
    ['edge-headers'],
  ],
  ['a _redirects line with the status 200', { 'dist/_redirects': '/alt/ /zimmer/ 200\n' }, ['edge-redirects']],
  [
    'both',
    { 'dist/_headers': '/*\n  X-Frame-Options: DENY\n', 'dist/_redirects': '/alt/ /zimmer/ 200\n' },
    ['edge-headers', 'edge-redirects'],
  ],
];

test('build:done throws a FindingError with exactly the ids of the audits that fail, after it wrote the edge files', async () => {
  const seen: { name: string; ids: string[]; written: boolean[] }[] = [];
  for (const [name, files] of PLANTS) {
    seen.push(
      await inSite({ settings: SMALLEST, files: { ...distFiles('dist'), ...files } }, async (site) => {
        const error = await buildDone(site);
        const dist = join(site.root, 'dist');
        return {
          name,
          ids: idsOf(error),
          written: EDGE_FILES.map((file) => !textOf(join(dist, file)).startsWith('no file ')),
        };
      }),
    );
  }
  assert.deepEqual(
    seen,
    PLANTS.map(([name, , ids]) => ({ name, ids, written: EDGE_FILES.map(() => true) })),
  );
});

test('build:done keeps a rule of an existing _headers that passes the audit', async () => {
  const seen = await inSite(
    {
      settings: SMALLEST,
      files: { ...distFiles('dist'), 'dist/_headers': '# A comment.\n/docs/*\n  X-Robots-Tag: noindex\n' },
    },
    async (site) => ({ error: await buildDone(site), headers: textOf(join(site.root, 'dist/_headers')) }),
  );
  assert.equal(seen.error, undefined);
  assert.equal(seen.headers, `${HEADERS}/docs/*\n  X-Robots-Tag: noindex\n`);
});

test('build:done stops with a plain error for a page without a CSP meta, and only when there is an insert', async () => {
  const bare = '<!DOCTYPE html><html lang="de"><head><title>Kontakt</title></head><body><h1>Kontakt</h1></body></html>';
  const files = { ...distFiles('dist'), 'dist/kontakt/index.html': bare, 'dist/a/b/index.html': bare };
  const run = (settings: unknown): Promise<{ message: string; page: string; headers: boolean }> =>
    inSite({ settings, files }, async (site) => {
      const error = await buildDone(site);
      return {
        message: error === undefined ? 'passed' : messageOf(error),
        page: textOf(join(site.root, 'dist/kontakt/index.html')),
        headers: !textOf(join(site.root, 'dist/_headers')).startsWith('no file '),
      };
    });
  assert.deepEqual(await run(SMALLEST), {
    message: 'astro-kit: a/b/index.html has no CSP meta\nastro-kit: kontakt/index.html has no CSP meta',
    page: bare,
    headers: false,
  });
  assert.deepEqual(await run({ ...SMALLEST, prefetch: NO_SPECULATION }), {
    message: 'passed',
    page: bare,
    headers: true,
  });
});

test('build:done loads the facts, the redirects and the design again: a file that broke since the start stops it', async () => {
  const cases: readonly [name: string, change: (root: string) => void, ids: readonly string[]][] = [
    ['site.json is gone', (root) => rmSync(join(root, 'site.json')), ['config-options']],
    ['schedule.json is no JSON', (root) => writeFileSync(join(root, 'schedule.json'), '{'), ['facts-schedule']],
    [
      'glossary.json has a locale without `banned`',
      (root) => writeFileSync(join(root, 'glossary.json'), json({ de: {} })),
      ['config-options'],
    ],
    [
      'redirects.json has a `from` without `/`',
      (root) => writeFileSync(join(root, 'redirects.json'), json([{ from: 'alt/', to: '/' }])),
      ['routes-redirects'],
    ],
    ['docs/design.md is gone', (root) => rmSync(join(root, 'docs/design.md')), ['design-format']],
  ];
  const seen: { name: string; setup: unknown; ids: string[]; headers: boolean }[] = [];
  for (const [name, change] of cases) {
    seen.push(
      await inSite({ settings: SMALLEST, files: distFiles('dist') }, async (site) => {
        change(site.root);
        const error = await buildDone(site);
        const headers = !textOf(join(site.root, 'dist/_headers')).startsWith('no file ');
        return { name, setup: site.error, ids: idsOf(error), headers };
      }),
    );
  }
  assert.deepEqual(
    seen,
    cases.map(([name, , ids]) => ({ name, setup: undefined, ids, headers: false })),
  );
});

test('build:done on an empty client directory writes the seven edge files and passes', async () => {
  const seen = await inSite({ settings: SMALLEST }, async (site) => {
    mkdirSync(join(site.root, 'dist'), { recursive: true });
    const error = await buildDone(site);
    return { error, edge: edgeTexts(join(site.root, 'dist')), folder: dirname(join(site.root, 'dist/_headers')) };
  });
  assert.equal(seen.error, undefined);
  assert.deepEqual(
    {
      ...seen.edge,
      '.well-known/security.txt': withoutTime(seen.edge['.well-known/security.txt']),
    },
    {
      _headers: HEADERS,
      _redirects: '',
      'robots.txt': ROBOTS,
      'sitemap.xml': SITEMAP.split('\n')
        .filter((line) => !line.startsWith('<url>'))
        .join('\n'),
      '.well-known/security.txt': securityOf('de'),
      '_kit/release.txt': `${process.env.GITHUB_SHA || 'local'}\n@raess/astro-kit ${VERSION}\n`,
      '_kit/routes.txt': '',
    },
  );
});

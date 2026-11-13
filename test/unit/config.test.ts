import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import type { AstroConfig, HookParameters } from 'astro';
import { mergeConfig, validateConfig } from 'astro/config';
import {
  BASE_CSS,
  CSS_TARGET,
  checkConfigShape,
  checkResolvedConfig,
  EXPERIMENTAL_DEFAULTS,
  FORMS_ADAPTER,
  GLOBAL_CSS,
  globalCssCode,
  IMAGE_BREAKPOINTS,
  i18nConfig,
  kitScriptHashes,
  type LockedConfig,
  lockedConfig,
  show,
  WATCH_FILES,
} from '../../src/config.ts';
import { cspConfig, type Sha256, SPECULATION_HASH } from '../../src/csp.ts';
import { modeHash } from '../../src/modes.ts';
import type { Options } from '../../src/options.ts';
import { Report } from '../../src/registry.ts';
import { KIT_VERSION, virtualModulePlugin } from '../../src/virtual.ts';
import { EXAMPLE, optionsOf, origin, SMALLEST, TWO_LOCALES } from './fixtures.ts';
import { SPEC, variable } from './spec.ts';

// The specification as input

/** The lines of the specification from the line that holds `from` up to the line that holds `to`. */
function specLines(from: string, to: string): string[] {
  const start = SPEC.indexOf(from);
  const end = SPEC.indexOf(to, start);
  if (start < 0 || end < 0) throw new Error(`docs/spec.md does not hold ${JSON.stringify(start < 0 ? from : to)}`);
  return SPEC.slice(start, end).split('\n');
}

/** The texts in backticks of one line. */
const backticks = (line: string): string[] => [...line.matchAll(/`([^`]+)`/g)].map((found) => found[1] ?? '');

/** The rows of the 6.1 table: the key cell without its backticks, and the first value in backticks. */
const TABLE: ReadonlyMap<string, string> = new Map(
  specLines('| Key | Value (locked) |', '**Why `session` is locked.**')
    .map((line) => /^\| (`.+?) \| (.+) \|$/.exec(line))
    .filter((row) => row !== null)
    .map((row): [string, string] => [(row[1] ?? '').replaceAll('`', ''), backticks(row[2] ?? '')[0] ?? '']),
);

/** The value cell of one row of the 6.1 table. Throws for a key that the table does not hold. */
function cell(key: string): string {
  const value = TABLE.get(key);
  if (value === undefined || value === '') throw new Error(`the table of 6.1 has no value for ${key}`);
  return value;
}

/** The value of a literal as the specification writes it: single quotes, and keys without quotes. */
const literal = (text: string): unknown =>
  JSON.parse(text.replaceAll("'", '"').replace(/([{,]\s*)([A-Za-z]\w*)\s*:/g, '$1"$2":'));

// Values of a config

type Data = Record<string, unknown>;

const isData = (value: unknown): value is Data => typeof value === 'object' && value !== null && !Array.isArray(value);

/** The value at a dotted key of a config. */
function valueAt(config: unknown, key: string): unknown {
  let value = config;
  for (const name of key.split('.')) value = isData(value) ? value[name] : undefined;
  return value;
}

/** A copy of a config with one value at a dotted key. No object of the input is changed. */
function withValue(config: object, key: string, value: unknown): Data {
  const [head = '', ...rest] = key.split('.');
  const copy: Data = { ...config };
  const child = copy[head];
  copy[head] = rest.length === 0 ? value : withValue(isData(child) ? child : {}, rest.join('.'), value);
  return copy;
}

/** The dotted keys of the leaves of a config, in key order: every value that is not an object of keys. */
function leafKeys(config: unknown, prefix = ''): string[] {
  if (!isData(config)) return [prefix];
  return Object.entries(config).flatMap(([name, value]) => leafKeys(value, prefix === '' ? name : `${prefix}.${name}`));
}

// Settings

const ALL_MODES = { auto: true, light: true, dark: true, contrast: true } as const;

/** The hash of 13.1 item 11, as a stand-in for the Solid hash of a site with islands. */
const SOLID_HASH: Sha256 = 'sha256-VmEf2BGdqVUwcvyhTyarJo/bY7DNqS2+T2sz4IO/kbw=';

/** The hash of the speculation rules (6.2). */
const SPECULATION: Sha256 = 'sha256-4255RGsO6JUC8vuukcO69AaAmBKnnolynaWf9b0Q6og=';

/** The hash of the mode script with all four options and the default `auto` (9.3, test vector). */
const MODE_ALL: Sha256 = 'sha256-tVX7IDqXb4rkmRiqqGfEY8YPs6KvuNlSnmTbTdmGmSs=';

const STATIC = optionsOf(SMALLEST);
const STATIC_PREFETCH = optionsOf({ ...SMALLEST, prefetch: { speculationRules: true, astroPrefetch: true } });
const FORMS = optionsOf(EXAMPLE);

/** A static site that uses every setting that changes the config: all modes, both prefetch kinds, an origin. */
const FULL = optionsOf({
  ...TWO_LOCALES,
  defaultLocale: 'fr',
  legal: {
    legalNote: { de: '/de/impressum/', fr: '/mentions-legales/' },
    privacy: { de: '/de/datenschutz/', fr: '/protection-des-donnees/' },
  },
  features: { forms: false, islands: false, scripts: true, wasm: true, workers: true },
  prefetch: { speculationRules: true, astroPrefetch: true },
  modes: ALL_MODES,
  origins: [origin('pay.example', ['connect', 'frame', 'script', 'form'])],
});

// Findings

type Row = [rule: string, where: string, detail: string | undefined];

/** The findings of a report, in the order of the run. */
const rowsOf = (report: Report): Row[] =>
  report.findings.map((finding) => [finding.rule, finding.where, finding.detail]);

/** The sorted rule ids of rows, one for each finding. */
const idsOf = (rows: readonly Row[]): string[] => rows.map(([rule]) => rule).sort();

function shapeRows(config: object): Row[] {
  const report = new Report();
  checkConfigShape(config, report);
  return rowsOf(report);
}

function resolvedRows(config: object, options: Options, hashes: readonly Sha256[] = kitScriptHashes(options)): Row[] {
  const report = new Report();
  checkResolvedConfig(config, options, hashes, report);
  return rowsOf(report);
}

// A resolved config

/** The config that Astro 7.4 resolves from an empty project config. No file is read. */
const DEFAULTS: AstroConfig = await validateConfig({}, '/site/', 'build');

/** What a hook may pass to `updateConfig`. The locked config of the kit must fit it. */
type Update = Parameters<HookParameters<'astro:config:setup'>['updateConfig']>[0];

/** What Astro's `updateConfig` does with an update: it merges it into the config (13.1, and 6.1 step 10). */
const merge = (config: AstroConfig, update: Update): AstroConfig => mergeConfig<AstroConfig>(config, update);

/** What the hook passes to `updateConfig`: the locked config and the plugin of the virtual module. */
function kitUpdate(options: Options, hashes: readonly Sha256[] = kitScriptHashes(options)): Update {
  const locked: LockedConfig = lockedConfig(options, hashes);
  const plugin = virtualModulePlugin({ options, kitVersion: KIT_VERSION });
  return { ...locked, vite: { ...locked.vite, plugins: [plugin] } };
}

/** The resolved config of a site: Astro's defaults, the kit's update, and then the updates of other integrations. */
function resolved(options: Options, ...others: readonly Update[]): AstroConfig {
  return others.reduce(merge, merge(DEFAULTS, kitUpdate(options)));
}

/** A stand-in for the Cloudflare adapter. */
const ADAPTER = { name: '@astrojs/cloudflare', hooks: {} };

/**
 * What the adapter itself passes to `updateConfig` (version 14.4, with `imageService: 'compile'`). It passes the
 * whole `image` value of the config back, with its own service and endpoint (13.1, item 59).
 */
const adapterUpdate = (config: AstroConfig): Update => ({
  build: { redirects: false },
  session: config.session,
  vite: { plugins: [{ name: '@astrojs/cloudflare:cf-imports' }] },
  image: {
    ...config.image,
    service: {
      build: { entrypoint: 'astro/assets/services/sharp', config: {} },
      runtime: { entrypoint: '@astrojs/cloudflare/image-service-workerd' },
    },
    endpoint: { entrypoint: '@astrojs/cloudflare/image-passthrough-endpoint' },
  },
});

/** The config after the adapter ran its own `astro:config:setup`, as it does after the hook of the kit. */
const afterAdapter = (config: AstroConfig): AstroConfig => merge(config, adapterUpdate(config));
const withAdapter = (adapter: typeof ADAPTER = ADAPTER): Update => ({
  adapter,
  integrations: [adapter],
});

// Watch files and global CSS

test('the watch files are the six files of step 5, in its order', () => {
  const [line = ''] = specLines('5. **Watch files.**', '6. **Islands.**');
  assert.deepEqual(WATCH_FILES, backticks(line).slice(1));
  assert.deepEqual(WATCH_FILES, [
    'astro-kit.json',
    'site.json',
    'schedule.json',
    'redirects.json',
    'glossary.json',
    'docs/design.md',
  ]);
});

test('the page-ssr code holds the four imports of step 9, in order', () => {
  const root = join('/', 'sites', 'hotel');
  const specs = specLines('9. **Global CSS.**', '10. **Config.**')
    .filter((line) => /^\s+[1-4]\. `/.test(line))
    .map((line) => backticks(line)[0] ?? '')
    .map((spec) =>
      spec.startsWith('join(root, ') ? join(root, spec.slice("join(root, '".length, -"')".length)) : spec,
    );
  assert.equal(specs.length, 4);
  assert.deepEqual([BASE_CSS, ...GLOBAL_CSS.map((file) => join(root, file))], specs);

  const code = globalCssCode(root);
  assert.equal(code, specs.map((spec) => `import ${JSON.stringify(spec)};`).join('\n'));
  assert.deepEqual(code.split('\n'), [
    'import "@raess/astro-kit/css/base.css";',
    `import ${JSON.stringify(join(root, 'src/styles/fonts.css'))};`,
    `import ${JSON.stringify(join(root, 'src/styles/tokens.css'))};`,
    `import ${JSON.stringify(join(root, 'src/styles/elements.css'))};`,
  ]);
  assert.equal(globalCssCode(join(root, 'a"b')).includes(String.raw`a\"b`), true);
});

// Script hashes

test('the kit script hashes are the Solid hash, the speculation hash and the mode hash, each only with its setting', () => {
  assert.equal(SPECULATION_HASH, SPECULATION);
  const none = { auto: true, light: false, dark: false, contrast: false };
  const two = { auto: false, light: true, dark: true, contrast: false, default: 'dark' } as const;
  const on = { speculationRules: true, astroPrefetch: false };
  const off = { speculationRules: false, astroPrefetch: true };
  const cases: [Pick<Options, 'prefetch' | 'modes'>, Sha256 | undefined, Sha256[]][] = [
    [{ prefetch: off, modes: none }, undefined, []],
    [{ prefetch: on, modes: none }, undefined, [SPECULATION]],
    [{ prefetch: off, modes: ALL_MODES }, undefined, [MODE_ALL]],
    [{ prefetch: on, modes: ALL_MODES }, undefined, [SPECULATION, MODE_ALL]],
    [{ prefetch: on, modes: two }, undefined, [SPECULATION, modeHash({ modes: two })]],
    [{ prefetch: off, modes: none }, SOLID_HASH, [SOLID_HASH]],
    [{ prefetch: on, modes: none }, SOLID_HASH, [SOLID_HASH, SPECULATION]],
    [{ prefetch: off, modes: ALL_MODES }, SOLID_HASH, [SOLID_HASH, MODE_ALL]],
    [{ prefetch: on, modes: ALL_MODES }, SOLID_HASH, [SOLID_HASH, SPECULATION, MODE_ALL]],
  ];
  assert.deepEqual(
    cases.map(([options, solid]) => kitScriptHashes(options, solid)),
    cases.map(([, , hashes]) => hashes),
  );
  assert.notEqual(modeHash({ modes: two }), MODE_ALL);
});

// The locked config

test('i18n holds the default locale, the codes in order, and the routing of the table', () => {
  const routing = { prefixDefaultLocale: false, redirectToDefaultLocale: false, fallbackType: 'redirect' };
  assert.deepEqual(i18nConfig(STATIC), { defaultLocale: 'de', locales: ['de'], routing });
  assert.deepEqual(i18nConfig(FORMS), { defaultLocale: 'de', locales: ['de', 'fr'], routing });
  assert.deepEqual(i18nConfig(FULL), { defaultLocale: 'fr', locales: ['de', 'fr'], routing });
  assert.deepEqual(
    i18nConfig(FULL),
    literal(cell('i18n').replace('<defaultLocale>', "'fr'").replace('<codes in order>', "'de', 'fr'")),
  );
});

test('the locked config of a site with all four mode options is the table of 6.1, written out', () => {
  const options = optionsOf({ ...EXAMPLE, modes: ALL_MODES });
  const hashes = kitScriptHashes(options);
  assert.deepEqual(hashes, [SPECULATION, MODE_ALL]);
  assert.deepEqual(lockedConfig(options, hashes), {
    site: 'https://example.ch',
    output: 'static',
    trailingSlash: 'always',
    prerenderConflictBehavior: 'error',
    compressHTML: true,
    build: { format: 'directory', inlineStylesheets: 'always' },
    i18n: {
      defaultLocale: 'de',
      locales: ['de', 'fr'],
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
        directives: [
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
        ],
        scriptDirective: { resources: ["'self'"], hashes: [SPECULATION, MODE_ALL] },
        styleDirective: { resources: ["'self'"] },
      },
    },
    prefetch: false,
    markdown: { syntaxHighlight: false },
    session: false,
    vite: {
      build: { cssTarget: ['chrome123', 'edge123', 'firefox120', 'safari17.5'] },
      ssr: { noExternal: ['@raess/astro-kit'] },
    },
  });
});

test('each row of the 6.1 table gives the value of the locked config', () => {
  const hashes = kitScriptHashes(FULL);
  const locked = lockedConfig(FULL, hashes);
  const literals = [
    'output',
    'trailingSlash',
    'prerenderConflictBehavior',
    'compressHTML',
    'build',
    'image',
    'markdown',
    'session',
    'vite.build.cssTarget',
    'vite.ssr.noExternal',
  ];
  for (const key of literals) assert.deepEqual(valueAt(locked, key), literal(cell(key)), key);

  assert.equal(cell('site'), 'options.site');
  assert.equal(locked.site, FULL.site);

  const security = cell('security');
  assert.equal(security.includes('cspConfig(options, scriptHashes)'), true);
  assert.deepEqual(
    { ...locked.security, csp: 'csp' },
    literal(security.replace('cspConfig(options, scriptHashes)', "'csp'")),
  );
  assert.deepEqual(locked.security.csp, cspConfig(FULL, hashes));

  const [, on = '', off = ''] = /^astroPrefetch \? (.+) : (.+)$/.exec(cell('prefetch')) ?? [];
  assert.deepEqual(lockedConfig(STATIC_PREFETCH, []).prefetch, literal(on));
  assert.deepEqual(lockedConfig(STATIC, []).prefetch, literal(off));
  assert.deepEqual([literal(on), literal(off)], [{ prefetchAll: false }, false]);

  assert.deepEqual(CSS_TARGET, literal(cell('vite.build.cssTarget')));
  assert.deepEqual(IMAGE_BREAKPOINTS, [640, 960, 1280, 1920]);
});

test('the locked config has the keys of the table in its order, without adapter, integrations and vite.plugins', () => {
  const keys = [...TABLE.keys()];
  assert.deepEqual(keys.slice(-5), [
    'session',
    'adapter / integrations',
    'vite.plugins',
    'vite.build.cssTarget',
    'vite.ssr.noExternal',
  ]);
  const own = keys.filter((key) => key !== 'adapter / integrations' && key !== 'vite.plugins');
  const locked = lockedConfig(FORMS, kitScriptHashes(FORMS));
  assert.deepEqual(Object.keys(locked), [...new Set(own.map((key) => key.split('.')[0]))]);
  assert.deepEqual(
    leafKeys(locked.vite).map((key) => `vite.${key}`),
    own.filter((key) => key.startsWith('vite.')),
  );
  assert.equal('adapter' in locked || 'integrations' in locked || 'plugins' in locked.vite, false);
});

test('the locked config follows the settings: site, prefetch, the script hashes and the declared origins', () => {
  const hashes = kitScriptHashes(FULL);
  const locked = lockedConfig(FULL, hashes);
  assert.equal(
    lockedConfig(optionsOf({ ...SMALLEST, site: 'https://www.hotel.example' }), []).site,
    'https://www.hotel.example',
  );
  assert.deepEqual(locked.prefetch, { prefetchAll: false });
  assert.deepEqual(locked.security.csp.scriptDirective, {
    resources: ["'self'", "'wasm-unsafe-eval'", 'https://pay.example'],
    hashes: [SPECULATION, MODE_ALL],
  });
  assert.equal(locked.security.csp.directives.includes("connect-src 'self' https://pay.example"), true);
  assert.equal(locked.security.csp.directives.includes('frame-src https://pay.example'), true);
  assert.equal(locked.security.csp.directives.includes("worker-src 'self'"), true);
  assert.deepEqual(lockedConfig(FULL, [SOLID_HASH, ...hashes]).security.csp.scriptDirective.hashes, [
    SOLID_HASH,
    SPECULATION,
    MODE_ALL,
  ]);
  assert.deepEqual(lockedConfig(STATIC, []).security.csp.scriptDirective.hashes, []);
});

test('each call gives a new locked config, so a change to one copy reaches no other', () => {
  const hashes = kitScriptHashes(STATIC);
  const first = lockedConfig(STATIC, hashes);
  first.image.breakpoints.push(1);
  first.image.domains.push('cdn.example');
  first.vite.build.cssTarget.push('ie11');
  first.vite.ssr.noExternal.push('other');
  first.security.csp.scriptDirective.hashes.push(SOLID_HASH);
  first.i18n.locales.push('xx');
  const second = lockedConfig(STATIC, hashes);
  assert.deepEqual(second.image.breakpoints, [640, 960, 1280, 1920]);
  assert.deepEqual(second.image.domains, []);
  assert.deepEqual(second.vite.build.cssTarget, ['chrome123', 'edge123', 'firefox120', 'safari17.5']);
  assert.deepEqual(second.vite.ssr.noExternal, ['@raess/astro-kit']);
  assert.deepEqual(second.security.csp.scriptDirective.hashes, [SPECULATION]);
  assert.deepEqual(second.i18n.locales, ['de']);
  assert.deepEqual(hashes, [SPECULATION]);
  assert.deepEqual(CSS_TARGET, ['chrome123', 'edge123', 'firefox120', 'safari17.5']);
});

// show

test('show gives a string as it is, undefined as undefined, and every other value as JSON', () => {
  const circular: Data = {};
  circular.self = circular;
  const named = (): number => 1;
  const cases: [unknown, string][] = [
    ['static', 'static'],
    ['', ''],
    ['a "b"', 'a "b"'],
    [undefined, 'undefined'],
    [null, 'null'],
    [true, 'true'],
    [false, 'false'],
    [0, '0'],
    [640, '640'],
    [[], '[]'],
    [['chrome123', 'edge123'], '["chrome123","edge123"]'],
    [[640, 960], '[640,960]'],
    [{ prefetchAll: false }, '{"prefetchAll":false}'],
    [{ a: undefined }, '{}'],
    [new URL('https://example.ch/a'), '"https://example.ch/a"'],
    [named, String(named)],
    [circular, '[object Object]'],
    [10n, '10'],
  ];
  assert.deepEqual(
    cases.map(([value]) => show(value)),
    cases.map(([, text]) => text),
  );
});

// Step 3 of config:setup

test('the default config of Astro 7.4 passes the config shape, and its truthy experimental keys are the allowed default', () => {
  const truthy = Object.fromEntries(Object.entries(DEFAULTS.experimental).filter(([, value]) => Boolean(value)));
  assert.deepEqual(truthy, { collectionStorage: 'single-file' });
  assert.deepEqual(EXPERIMENTAL_DEFAULTS, truthy);
  assert.deepEqual(
    EXPERIMENTAL_DEFAULTS,
    literal(backticks(specLines('The only allowed default is', '4. **Findings.**')[0] ?? '')[0] ?? ''),
  );
  assert.equal(DEFAULTS.adapter, undefined);
  assert.equal(DEFAULTS.i18n, undefined);
  assert.deepEqual(shapeRows(DEFAULTS), []);
});

test('the config shape: an adapter, an i18n value and an experimental flag each give their rule', () => {
  const place = (field: string): string => `astro.config.mjs: ${field}`;
  const i18n = { defaultLocale: 'de', locales: ['de'] };
  const cases: [name: string, config: object, rows: Row[]][] = [
    ['an empty config', {}, []],
    ['keys without a value', { adapter: undefined, i18n: undefined, experimental: undefined }, []],
    ['the default flag', { experimental: { collectionStorage: 'single-file' } }, []],
    [
      'flags that are off',
      { experimental: { clientPrerender: false, svgOptimizer: undefined, contentIntellisense: null, x: 0, y: '' } },
      [],
    ],
    ['other keys of a config', { site: 'https://example.ch', integrations: [{ name: 'x', hooks: {} }], vite: {} }, []],
    ['an adapter', { adapter: ADAPTER }, [['config-adapter', place('adapter'), '@astrojs/cloudflare']]],
    [
      'another adapter',
      { adapter: { name: '@astrojs/node', hooks: {} } },
      [['config-adapter', place('adapter'), '@astrojs/node']],
    ],
    ['an adapter without a name', { adapter: { hooks: {} } }, [['config-adapter', place('adapter'), '{"hooks":{}}']]],
    ['i18n', { i18n }, [['config-i18n', place('i18n'), undefined]]],
    [
      'a flag that is on',
      { experimental: { ...DEFAULTS.experimental, clientPrerender: true } },
      [['config-experimental', place('experimental.clientPrerender'), 'true']],
    ],
    [
      'another value of the default flag',
      { experimental: { ...DEFAULTS.experimental, collectionStorage: 'chunked' } },
      [['config-experimental', place('experimental.collectionStorage'), 'chunked']],
    ],
    [
      'a flag with an object value',
      { experimental: { parallelPrerender: { workers: 2 } } },
      [['config-experimental', place('experimental.parallelPrerender'), '{"workers":2}']],
    ],
    [
      'two flags',
      { experimental: { clientPrerender: true, collectionStorage: 'single-file', incrementalBuild: true } },
      [
        ['config-experimental', place('experimental.clientPrerender'), 'true'],
        ['config-experimental', place('experimental.incrementalBuild'), 'true'],
      ],
    ],
    [
      'all three at once',
      { adapter: ADAPTER, i18n, experimental: { redirectPage: true } },
      [
        ['config-adapter', place('adapter'), '@astrojs/cloudflare'],
        ['config-i18n', place('i18n'), undefined],
        ['config-experimental', place('experimental.redirectPage'), 'true'],
      ],
    ],
  ];
  for (const [name, config, rows] of cases) {
    const found = shapeRows(config);
    assert.deepEqual(found, rows, name);
    assert.deepEqual(idsOf(found), idsOf(rows), name);
  }
  assert.deepEqual(idsOf(shapeRows({ adapter: ADAPTER, i18n, experimental: { redirectPage: true } })), [
    'config-adapter',
    'config-experimental',
    'config-i18n',
  ]);
});

test('the config shape is checked on the config that Astro resolves from the project config', async () => {
  const cases: [config: object, ids: string[]][] = [
    [{}, []],
    [{ adapter: ADAPTER }, ['config-adapter']],
    [{ i18n: { defaultLocale: 'de', locales: ['de', 'fr'] } }, ['config-i18n']],
    [{ experimental: { clientPrerender: true } }, ['config-experimental']],
    [{ experimental: { collectionStorage: 'single-file' } }, []],
  ];
  const found = await Promise.all(
    cases.map(async ([config]) => idsOf(shapeRows(await validateConfig(config, '/site/', 'build')))),
  );
  assert.deepEqual(
    found,
    cases.map(([, ids]) => ids),
  );
});

// astro:config:done

test('the config that Astro merges from its defaults and the update of the kit passes', () => {
  const cases: [name: string, config: AstroConfig, options: Options][] = [
    ['a static site', resolved(STATIC), STATIC],
    ['a static site with astroPrefetch', resolved(STATIC_PREFETCH), STATIC_PREFETCH],
    ['every setting that changes the config', resolved(FULL), FULL],
    ['forms, with the adapter and its own update', afterAdapter(resolved(FORMS, withAdapter())), FORMS],
    [
      'another integration with a plugin',
      resolved(STATIC, { vite: { plugins: [{ name: 'x' }], ssr: { external: ['y'] } } }),
      STATIC,
    ],
  ];
  for (const [name, config, options] of cases) assert.deepEqual(resolvedRows(config, options), [], name);

  // The passing config holds keys that only the resolved config has. The check ignores them.
  const config = afterAdapter(resolved(FORMS, withAdapter()));
  assert.deepEqual(
    [
      config.build.redirects,
      config.build.assets,
      valueAt(config, 'image.service.build.entrypoint'),
      config.security.allowedDomains,
    ],
    [false, '_astro', 'astro/assets/services/sharp', []],
  );
  assert.deepEqual(
    (config.vite.plugins ?? []).map((plugin) => valueAt(plugin, 'name')),
    ['astro-kit:virtual', '@astrojs/cloudflare:cf-imports'],
  );
  assert.equal(config.adapter?.name, FORMS_ADAPTER);
});

/** One changed value of the resolved config of the static site, and the detail of its finding. */
const CHANGES: [key: string, value: unknown, detail: string][] = [
  ['site', 'https://other.example', 'https://other.example instead of https://example.ch'],
  ['output', 'server', 'server instead of static'],
  ['trailingSlash', 'ignore', 'ignore instead of always'],
  ['prerenderConflictBehavior', 'warn', 'warn instead of error'],
  ['compressHTML', 'jsx', 'jsx instead of true'],
  ['build.format', 'file', 'file instead of directory'],
  ['build.inlineStylesheets', 'auto', 'auto instead of always'],
  ['image.layout', undefined, 'undefined instead of constrained'],
  ['image.responsiveStyles', false, 'false instead of true'],
  ['image.breakpoints', [640, 960, 1280], '[640,960,1280] instead of [640,960,1280,1920]'],
  ['image.domains', ['cdn.example'], '["cdn.example"] instead of []'],
  ['image.remotePatterns', [{ hostname: '**.example' }], '[{"hostname":"**.example"}] instead of []'],
  ['security.checkOrigin', false, 'false instead of true'],
  ['security.csp.algorithm', 'SHA-512', 'SHA-512 instead of SHA-256'],
  [
    'security.csp.directives',
    ["default-src 'self'"],
    `["default-src 'self'"] instead of ${JSON.stringify(cspConfig(STATIC, []).directives)}`,
  ],
  [
    'security.csp.scriptDirective.resources',
    ["'self'", 'https://cdn.example'],
    `["'self'","https://cdn.example"] instead of ["'self'"]`,
  ],
  ['security.csp.scriptDirective.hashes', [], `[] instead of ["${SPECULATION}"]`],
  [
    'security.csp.styleDirective.resources',
    ["'self'", "'unsafe-inline'"],
    `["'self'","'unsafe-inline'"] instead of ["'self'"]`,
  ],
  ['prefetch', true, 'true instead of false'],
  ['markdown.syntaxHighlight', 'shiki', 'shiki instead of false'],
  ['session', undefined, 'undefined instead of false'],
  ['vite.build.cssTarget', 'es2020', 'es2020 instead of ["chrome123","edge123","firefox120","safari17.5"]'],
  ['vite.ssr.noExternal', true, 'true instead of ["@raess/astro-kit"]'],
];

test('each locked value, changed in turn, gives config-locked with its key and "<actual> instead of <expected>"', () => {
  const config = resolved(STATIC);
  const { i18n: _i18n, ...locked } = lockedConfig(STATIC, kitScriptHashes(STATIC));
  assert.deepEqual(
    CHANGES.map(([key]) => key),
    leafKeys(locked),
  );
  const format = `${variable('actual')} instead of ${variable('expected')}`;
  assert.equal(SPEC.includes(`A difference reports \`config-locked\` with the key and \`${format}\`.`), true);
  for (const [key, value, detail] of CHANGES) {
    const found = resolvedRows(withValue(config, key, value), STATIC);
    assert.deepEqual(found, [['config-locked', key, detail]], key);
    assert.deepEqual(idsOf(found), ['config-locked'], key);
  }
  assert.deepEqual(resolvedRows(config, STATIC), []);
});

test('one run reports every changed value, in the order of the table', () => {
  const changed = CHANGES.reduce<object>((config, [key, value]) => withValue(config, key, value), resolved(STATIC));
  assert.deepEqual(
    resolvedRows(changed, STATIC),
    CHANGES.map(([key, , detail]) => ['config-locked', key, detail]),
  );
});

test('the prefetch value of a site with astroPrefetch is locked key by key', () => {
  const config = resolved(STATIC_PREFETCH);
  const cases: [key: string, value: unknown, rows: Row[]][] = [
    ['prefetch.prefetchAll', false, []],
    ['prefetch.prefetchAll', true, [['config-locked', 'prefetch.prefetchAll', 'true instead of false']]],
    ['prefetch', false, [['config-locked', 'prefetch.prefetchAll', 'undefined instead of false']]],
    ['prefetch', true, [['config-locked', 'prefetch.prefetchAll', 'undefined instead of false']]],
    ['prefetch.defaultStrategy', undefined, []],
    ['prefetch.defaultStrategy', 'load', [['config-locked', 'prefetch.defaultStrategy', 'load instead of undefined']]],
  ];
  for (const [key, value, rows] of cases) {
    assert.deepEqual(resolvedRows(withValue(config, key, value), STATIC_PREFETCH), rows, `${key} ${show(value)}`);
  }
  assert.deepEqual(resolvedRows(withValue(resolved(STATIC), 'prefetch', { prefetchAll: false }), STATIC), [
    ['config-locked', 'prefetch', '{"prefetchAll":false} instead of false'],
  ]);
});

test('security.csp must be an object: any other value is one finding, with none below it', () => {
  const config = resolved(STATIC);
  const cases: [value: unknown, detail: string][] = [
    [false, 'false instead of an object'],
    [true, 'true instead of an object'],
    [undefined, 'undefined instead of an object'],
    [['SHA-256'], '["SHA-256"] instead of an object'],
  ];
  for (const [value, detail] of cases) {
    assert.deepEqual(
      resolvedRows(withValue(config, 'security.csp', value), STATIC),
      [['config-locked', 'security.csp', detail]],
      detail,
    );
  }
});

test('a key in security.csp that the kit did not set is a changed value', () => {
  const config = resolved(STATIC);
  const cases: [key: string, value: unknown, rows: Row[]][] = [
    ['security.csp.scriptDirective.strictDynamic', undefined, []],
    [
      'security.csp.scriptDirective.strictDynamic',
      true,
      [['config-locked', 'security.csp.scriptDirective.strictDynamic', 'true instead of undefined']],
    ],
    [
      'security.csp.styleDirective.hashes',
      [SOLID_HASH],
      [['config-locked', 'security.csp.styleDirective.hashes', `["${SOLID_HASH}"] instead of undefined`]],
    ],
    ['security.csp.report', 'x', [['config-locked', 'security.csp.report', 'x instead of undefined']]],
    ['security.allowedDomains', [{ hostname: 'example.ch' }], []],
    ['build.assets', 'assets', []],
    ['image.service', { entrypoint: 'astro/assets/services/noop' }, []],
    ['markdown.gfm', false, []],
    ['vite.build.minify', false, []],
  ];
  for (const [key, value, rows] of cases) {
    assert.deepEqual(resolvedRows(withValue(config, key, value), STATIC), rows, `${key} ${show(value)}`);
  }
});

test('an update of another integration is merged into the arrays of the kit, and each such array fails whole', () => {
  const cases: [name: string, update: Update, rows: Row[]][] = [
    [
      'an image domain',
      { image: { domains: ['cdn.example'] } },
      [['config-locked', 'image.domains', '["cdn.example"] instead of []']],
    ],
    [
      'a package that is bundled',
      { vite: { ssr: { noExternal: ['other'] } } },
      [['config-locked', 'vite.ssr.noExternal', '["@raess/astro-kit","other"] instead of ["@raess/astro-kit"]']],
    ],
    [
      'a script hash',
      { security: { csp: { algorithm: 'SHA-256', scriptDirective: { hashes: [SOLID_HASH] } } } },
      [
        [
          'config-locked',
          'security.csp.scriptDirective.hashes',
          `["${SPECULATION}","${SOLID_HASH}"] instead of ["${SPECULATION}"]`,
        ],
      ],
    ],
    [
      'two values',
      { output: 'server', build: { inlineStylesheets: 'never' } },
      [
        ['config-locked', 'output', 'server instead of static'],
        ['config-locked', 'build.inlineStylesheets', 'never instead of always'],
      ],
    ],
    [
      'the policy turned off',
      { security: { csp: false } },
      [['config-locked', 'security.csp', 'false instead of an object']],
    ],
  ];
  for (const [name, update, rows] of cases)
    assert.deepEqual(resolvedRows(resolved(STATIC, update), STATIC), rows, name);

  // The update of the kit, merged a second time, doubles every array that is not empty. Only a list of `image`
  // may come back doubled, because the Cloudflare adapter does that.
  const twice = resolvedRows(resolved(STATIC, kitUpdate(STATIC)), STATIC);
  assert.deepEqual(
    twice.map(([rule, where]) => [rule, where]),
    [
      'security.csp.directives',
      'security.csp.scriptDirective.resources',
      'security.csp.scriptDirective.hashes',
      'security.csp.styleDirective.resources',
      'vite.build.cssTarget',
      'vite.ssr.noExternal',
    ]
      .map((key) => ['config-locked', key])
      .concat([['config-i18n', 'i18n']]),
  );
});

test('a list of image that the Cloudflare adapter doubles is no changed value, and a new item in it is one', () => {
  const forms = afterAdapter(resolved(FORMS, withAdapter()));
  const doubled = '[640,960,1280,1920,640,960,1280,1920]';
  assert.equal(JSON.stringify(forms.image.breakpoints), doubled, 'Astro joins the two lists');
  assert.deepEqual(resolvedRows(forms, FORMS), []);

  const cases: [name: string, breakpoints: number[], detail: string][] = [
    ['a new width after the repeat', [640, 960, 1280, 1920, 640, 960, 1280, 1920, 320], `${doubled.slice(0, -1)},320]`],
    ['a missing width', [640, 960, 1280, 640, 960, 1280], '[640,960,1280,640,960,1280]'],
    ['another order', [960, 640, 1280, 1920, 960, 640, 1280, 1920], '[960,640,1280,1920,960,640,1280,1920]'],
    ['no width', [], '[]'],
  ];
  for (const [name, breakpoints, detail] of cases) {
    assert.deepEqual(
      resolvedRows(withValue(forms, 'image.breakpoints', breakpoints), FORMS),
      [['config-locked', 'image.breakpoints', `${detail} instead of [640,960,1280,1920]`]],
      name,
    );
  }

  // A repeat in a list outside `image` stays a changed value.
  assert.deepEqual(resolvedRows(resolved(STATIC, { vite: { ssr: { noExternal: ['@raess/astro-kit'] } } }), STATIC), [
    ['config-locked', 'vite.ssr.noExternal', '["@raess/astro-kit","@raess/astro-kit"] instead of ["@raess/astro-kit"]'],
  ]);
});

test('the script hashes of the check are the ones that config:setup passed', () => {
  const config = resolved(FULL);
  assert.deepEqual(resolvedRows(config, FULL, kitScriptHashes(FULL)), []);
  assert.deepEqual(resolvedRows(config, FULL, [SOLID_HASH, ...kitScriptHashes(FULL)]), [
    [
      'config-locked',
      'security.csp.scriptDirective.hashes',
      `["${SPECULATION}","${MODE_ALL}"] instead of ["${SOLID_HASH}","${SPECULATION}","${MODE_ALL}"]`,
    ],
  ]);
});

test('the resolved i18n must equal the value of the kit', () => {
  const config = afterAdapter(resolved(FORMS, withAdapter()));
  const expected =
    '{"defaultLocale":"de","locales":["de","fr"],"routing":{"prefixDefaultLocale":false,"redirectToDefaultLocale":false,"fallbackType":"redirect"}}';
  assert.equal(JSON.stringify(i18nConfig(FORMS)), expected);
  const cases: [name: string, key: string, value: unknown, detail: string | undefined][] = [
    ['keys without a value', 'i18n.fallback', undefined, undefined],
    ['a routing key without a value', 'i18n.routing.extra', undefined, undefined],
    ['no i18n', 'i18n', undefined, 'undefined'],
    [
      'another default locale',
      'i18n.defaultLocale',
      'fr',
      JSON.stringify({ ...i18nConfig(FORMS), defaultLocale: 'fr' }),
    ],
    [
      'one more locale',
      'i18n.locales',
      ['de', 'fr', 'it'],
      JSON.stringify({ ...i18nConfig(FORMS), locales: ['de', 'fr', 'it'] }),
    ],
    ['another order', 'i18n.locales', ['fr', 'de'], JSON.stringify({ ...i18nConfig(FORMS), locales: ['fr', 'de'] })],
    ['a fallback', 'i18n.fallback', { fr: 'de' }, JSON.stringify({ ...i18nConfig(FORMS), fallback: { fr: 'de' } })],
    [
      'domains',
      'i18n.domains',
      { fr: 'https://fr.example.ch' },
      JSON.stringify({ ...i18nConfig(FORMS), domains: { fr: 'https://fr.example.ch' } }),
    ],
    ['manual routing', 'i18n.routing', 'manual', JSON.stringify({ ...i18nConfig(FORMS), routing: 'manual' })],
    [
      'a prefix for the default locale',
      'i18n.routing.prefixDefaultLocale',
      true,
      JSON.stringify({ ...i18nConfig(FORMS), routing: { ...i18nConfig(FORMS).routing, prefixDefaultLocale: true } }),
    ],
  ];
  for (const [name, key, value, detail] of cases) {
    const rows: Row[] = detail === undefined ? [] : [['config-i18n', 'i18n', `${detail} instead of ${expected}`]];
    const found = resolvedRows(withValue(config, key, value), FORMS);
    assert.deepEqual(found, rows, name);
    assert.deepEqual(idsOf(found), idsOf(rows), name);
  }
  // An update of another integration is merged into the list of locales.
  assert.deepEqual(idsOf(resolvedRows(resolved(STATIC, { i18n: { locales: ['it'] } }), STATIC)), ['config-i18n']);
});

test('an adapter fails while forms is off, and with forms the adapter must be the one of the kit', () => {
  const node = { name: '@astrojs/node', hooks: {} };
  const cases: [name: string, config: object, options: Options, rows: Row[]][] = [
    ['forms off, no adapter', resolved(STATIC), STATIC, []],
    ['forms off, the key without a value', withValue(resolved(STATIC), 'adapter', undefined), STATIC, []],
    [
      'forms off, the adapter of the kit',
      resolved(STATIC, withAdapter()),
      STATIC,
      [['config-adapter', 'adapter', '@astrojs/cloudflare']],
    ],
    [
      'forms off, another adapter',
      resolved(STATIC, withAdapter(node)),
      STATIC,
      [['config-adapter', 'adapter', '@astrojs/node']],
    ],
    ['forms on, the adapter of the kit', resolved(FORMS, withAdapter()), FORMS, []],
    ['forms on, no adapter', resolved(FORMS), FORMS, [['config-adapter', 'adapter', 'undefined']]],
    [
      'forms on, another adapter',
      resolved(FORMS, withAdapter(node)),
      FORMS,
      [['config-adapter', 'adapter', '@astrojs/node']],
    ],
    [
      'forms on, an adapter without a name',
      withValue(resolved(FORMS), 'adapter', { hooks: {} }),
      FORMS,
      [['config-adapter', 'adapter', '{"hooks":{}}']],
    ],
  ];
  for (const [name, config, options, rows] of cases) {
    const found = resolvedRows(config, options);
    assert.deepEqual(found, rows, name);
    assert.deepEqual(idsOf(found), idsOf(rows), name);
  }
  assert.equal(FORMS_ADAPTER, '@astrojs/cloudflare');
});

test('one run reports the locked values, then i18n, then the adapter', () => {
  const config = withValue(withValue(resolved(STATIC, withAdapter()), 'i18n', undefined), 'session', undefined);
  const found = resolvedRows(config, STATIC);
  assert.deepEqual(found, [
    ['config-locked', 'session', 'undefined instead of false'],
    ['config-i18n', 'i18n', `undefined instead of ${JSON.stringify(i18nConfig(STATIC))}`],
    ['config-adapter', 'adapter', '@astrojs/cloudflare'],
  ]);
  assert.deepEqual(idsOf(found), ['config-adapter', 'config-i18n', 'config-locked']);
});

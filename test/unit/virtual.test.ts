import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { AstroUserConfig } from 'astro';
import type { Options } from '../../src/options.ts';
import { KIT_VERSION, VIRTUAL_ID, virtualModuleCode, virtualModulePlugin } from '../../src/virtual.ts';
import { EXAMPLE, optionsOf, SMALLEST } from './fixtures.ts';

/** A file of the kit repository, by its path from the root. */
const kitFile = (path: string): string => fileURLToPath(new URL(`../../${path}`, import.meta.url));

/** The id that Vite loads: the virtual id after a NUL byte. */
const RESOLVED_ID = '\0virtual:astro-kit';

/** What a module with the code of the virtual module exports. */
interface VirtualExports {
  options: unknown;
  kitVersion: unknown;
}

/** Runs the code as a module and returns its exports. */
async function evaluate(code: string): Promise<VirtualExports> {
  const module: VirtualExports = await import(`data:text/javascript,${encodeURIComponent(code)}`);
  return { options: module.options, kitVersion: module.kitVersion };
}

/** The entries that Astro takes in `vite.plugins`. The plugin of the kit must fit one of them. */
type VitePlugins = NonNullable<NonNullable<AstroUserConfig['vite']>['plugins']>;

/** The types that `src/env.d.ts` gives the two ambient modules. */
type VirtualModule = typeof import('virtual:astro-kit');
type WorkersModule = typeof import('cloudflare:workers');

test('the virtual id is virtual:astro-kit', () => {
  assert.equal(VIRTUAL_ID, 'virtual:astro-kit');
});

test('KIT_VERSION is the version in the package.json of the kit', () => {
  const manifest: { version?: unknown } = JSON.parse(readFileSync(kitFile('package.json'), 'utf8'));
  assert.equal(typeof manifest.version, 'string');
  assert.match(KIT_VERSION, /^\d+\.\d+\.\d+/);
  assert.equal(KIT_VERSION, manifest.version);
});

test('the code of the virtual module is two export lines with JSON values', () => {
  const options = optionsOf(SMALLEST);
  const code = virtualModuleCode({ options, kitVersion: '1.2.3' });
  assert.equal(code, `export const options = ${JSON.stringify(options)};\nexport const kitVersion = "1.2.3";\n`);
  assert.equal(code.split('\n').length, 3);
  assert.equal(code.includes('"site":"https://example.ch"'), true);
});

test('the code of the virtual module runs and exports the settings and the version', async () => {
  const cases: [Options, string][] = [
    [optionsOf(SMALLEST), '0.0.0'],
    [optionsOf(EXAMPLE), '1.2.3-beta.1'],
    [{ ...optionsOf(SMALLEST), codeOwner: 'a b `</script>\'"\\' }, '"\n'],
  ];
  const results = await Promise.all(
    cases.map(([options, kitVersion]) => evaluate(virtualModuleCode({ options, kitVersion }))),
  );
  assert.deepEqual(
    results,
    cases.map(([options, kitVersion]) => ({ options, kitVersion })),
  );
});

test('the plugin resolves and loads only the virtual module', () => {
  const data = { options: optionsOf(EXAMPLE), kitVersion: KIT_VERSION };
  const plugin = virtualModulePlugin(data);
  const plugins: VitePlugins = [plugin];
  assert.equal(plugins.length, 1);
  assert.deepEqual(Object.keys(plugin).sort(), ['load', 'name', 'resolveId']);
  assert.equal(plugin.name, 'astro-kit:virtual');

  assert.equal(plugin.resolveId(VIRTUAL_ID), RESOLVED_ID);
  assert.equal(plugin.load(RESOLVED_ID), virtualModuleCode(data));

  const others = [
    '',
    'virtual:astro-kit/x',
    'virtual:astro-kit.js',
    '/virtual:astro-kit',
    'astro:prefetch',
    './options.ts',
  ];
  assert.deepEqual(
    [RESOLVED_ID, ...others].map((id) => plugin.resolveId(id)),
    [RESOLVED_ID, ...others].map(() => undefined),
  );
  assert.deepEqual(
    [VIRTUAL_ID, ...others].map((id) => plugin.load(id)),
    [VIRTUAL_ID, ...others].map(() => undefined),
  );
});

test('each plugin serves its own data', () => {
  const first = virtualModulePlugin({ options: optionsOf(SMALLEST), kitVersion: '1.0.0' });
  const second = virtualModulePlugin({ options: optionsOf(EXAMPLE), kitVersion: '2.0.0' });
  assert.equal(first.load(RESOLVED_ID)?.endsWith('export const kitVersion = "1.0.0";\n'), true);
  assert.equal(second.load(RESOLVED_ID)?.endsWith('export const kitVersion = "2.0.0";\n'), true);
});

test('src/env.d.ts declares the two ambient modules and is no module itself', () => {
  const text = readFileSync(kitFile('src/env.d.ts'), 'utf8');
  assert.deepEqual(
    [...text.matchAll(/^declare module '([^']+)' \{$/gm)].map((found) => found[1]),
    ['virtual:astro-kit', 'cloudflare:workers'],
  );
  assert.equal(/^(import|export)\b/m.test(text), false);

  // The type check proves the declared types: these two functions compile only with them.
  const optionsOfModule = (module: VirtualModule): Options => module.options;
  const versionOfModule = (module: VirtualModule): string => module.kitVersion;
  const envOfModule = (module: WorkersModule): unknown => module.env;
  const options = optionsOf(SMALLEST);
  assert.equal(optionsOfModule({ options, kitVersion: KIT_VERSION }), options);
  assert.equal(versionOfModule({ options, kitVersion: KIT_VERSION }), KIT_VERSION);
  assert.equal(envOfModule({ env: 1 }), 1);
});

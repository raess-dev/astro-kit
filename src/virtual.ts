/**
 * The virtual module `virtual:astro-kit` (specification, 3.2 and the `vite.plugins` row of 6.1). It gives the code
 * of a site the settings and the kit version. The plugin is a plain object: this module imports no `vite`.
 */
import { readFileSync } from 'node:fs';
import type { Options } from './options.ts';

/** The id that a site imports. */
export const VIRTUAL_ID = 'virtual:astro-kit';

/** The id that the plugin loads. The NUL byte keeps other plugins away from it. */
const RESOLVED_ID = `\0${VIRTUAL_ID}`;

/** Reads `version` from the kit's `package.json`. The file is one folder above `src/` and above `dist/`. */
function readKitVersion(): string {
  const manifest: unknown = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const version = typeof manifest === 'object' && manifest !== null && 'version' in manifest ? manifest.version : null;
  if (typeof version !== 'string' || version === '') throw new Error('astro-kit: its package.json has no version');
  return version;
}

/** The version in the kit's `package.json`. */
export const KIT_VERSION: string = readKitVersion();

/** What the virtual module exports. */
export interface VirtualData {
  options: Options;
  kitVersion: string;
}

/** The code of the virtual module: one line for each export, each value as JSON. */
export function virtualModuleCode(data: VirtualData): string {
  return `export const options = ${JSON.stringify(data.options)};\nexport const kitVersion = ${JSON.stringify(data.kitVersion)};\n`;
}

/** The part of a Vite plugin that the virtual module needs. It fits an entry of Astro's `vite.plugins`. */
export interface VirtualPlugin {
  name: 'astro-kit:virtual';
  resolveId(id: string): string | undefined;
  load(id: string): string | undefined;
}

/**
 * The Vite plugin for `virtual:astro-kit`. `resolveId` answers only the virtual id, and `load` answers only the
 * resolved id. Every other id gives `undefined`, so Vite asks the next plugin.
 */
export function virtualModulePlugin(data: VirtualData): VirtualPlugin {
  const code = virtualModuleCode(data);
  return {
    name: 'astro-kit:virtual',
    resolveId: (id) => (id === VIRTUAL_ID ? RESOLVED_ID : undefined),
    load: (id) => (id === RESOLVED_ID ? code : undefined),
  };
}

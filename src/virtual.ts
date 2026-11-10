import type { Plugin } from 'vite';
import type { Schedule, SiteFacts } from './facts.ts';
import type { Manifest } from './manifest.ts';
import type { KitOptions } from './options.ts';

import { existsSync } from 'node:fs';
import { join } from 'node:path';

export const VIRTUAL_ID = 'virtual:astro-kit';
/** The project's src/styles/theme.css, or an empty stylesheet when the project has none. */
export const THEME_ID = 'virtual:astro-kit/theme.css';
const RESOLVED = `\0${VIRTUAL_ID}`;
const EMPTY_THEME = '\0astro-kit-empty-theme.css';

export interface VirtualData {
  root: string;
  options: KitOptions;
  site: SiteFacts | undefined;
  schedule: Schedule;
  messages: Record<string, Record<string, string>>;
  manifest: Manifest;
  kitVersion: string;
}

/** Serialises the kit's config, facts and manifest for components and content helpers. */
export function virtualModulePlugin(data: VirtualData): Plugin {
  return {
    name: 'astro-kit:virtual',
    resolveId(id) {
      if (id === VIRTUAL_ID) return RESOLVED;
      if (id === THEME_ID) {
        const theme = join(data.root, 'src/styles/theme.css');
        return existsSync(theme) ? theme : EMPTY_THEME;
      }
      return undefined;
    },
    load(id) {
      if (id === EMPTY_THEME) return '';
      if (id !== RESOLVED) return undefined;
      const json = (v: unknown) => JSON.stringify(v ?? null);
      return [
        `export const options = ${json(data.options)};`,
        `export const site = ${json(data.site)};`,
        `export const schedule = ${json(data.schedule)};`,
        `export const messages = ${json(data.messages)};`,
        `export const manifest = ${json(data.manifest)};`,
        `export const kitVersion = ${json(data.kitVersion)};`,
      ].join('\n');
    },
  };
}

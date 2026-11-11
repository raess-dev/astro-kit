/** Files a project must keep byte-identical to these. `astro-kit init --shims` restores them. */
export const SHIMS: Record<string, string> = {
  'astro.config.mjs': `// Managed by @raess/astro-kit. Every option lives in astro-kit.json.
import astroKit from '@raess/astro-kit';
import { defineConfig } from 'astro/config';

export default defineConfig({ integrations: [astroKit()] });
`,
  'biome.json': `{
  "$schema": "./node_modules/@biomejs/biome/configuration_schema.json",
  "extends": ["@raess/astro-kit/biome.json"]
}
`,
  'tsconfig.json': `{
  "extends": "@raess/astro-kit/tsconfig.json",
  "include": [".astro/types.d.ts", "**/*"],
  "exclude": ["dist", "node_modules"]
}
`,
};

export const normalize = (text: string): string => `${text.replace(/\r\n/g, '\n').trimEnd()}\n`;

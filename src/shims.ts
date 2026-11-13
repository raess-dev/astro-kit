/**
 * The shims: fixed project files that the kit compares byte for byte (specification, 12.2), and the rule
 * `config-shim` for them. `astro-kit init --shims` writes these texts.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { UNCHECKED_FOLDERS } from './project.ts';
import type { Report } from './registry.ts';

const RULE = 'config-shim';

/** The one Astro config file of a project. Every other `astro.config.*` file in the root is a finding. */
export const CONFIG_FILE = 'astro.config.mjs';

const CONFIG_PREFIX = 'astro.config.';

/** The one Biome config file of a project. */
export const BIOME_FILE = 'biome.json';

/**
 * The file names of a Biome config. Biome reads such a file in any folder: a nested one with `"root": false` can
 * switch the linter off for its folder. So the root `biome.json` is the only one that a project may hold.
 */
export const BIOME_CONFIG_NAMES: readonly string[] = [BIOME_FILE, 'biome.jsonc', '.biome.json', '.biome.jsonc'];

/** The folders that the search for a Biome config does not enter: Biome checks no file in them, and Git owns `.git`. */
const UNSEARCHED_FOLDERS: readonly string[] = [...UNCHECKED_FOLDERS, '.git'];

/**
 * File name to exact text (12.2). A change to a text is a breaking change (11.5).
 * The two JSON files hold the JSON of 12.2 in the format that Biome gives them under the kit preset: objects
 * expanded, short lists on one line. `check` runs `biome ci` on the project, so any other format fails there.
 */
export const SHIMS = {
  [CONFIG_FILE]: `// Managed by @raess/astro-kit. Every option lives in astro-kit.json.
import astroKit from '@raess/astro-kit';
import { defineConfig } from 'astro/config';

export default defineConfig({ integrations: [astroKit()] });
`,
  [BIOME_FILE]: `{
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
} as const satisfies Readonly<Record<string, string>>;

export type ShimFile = keyof typeof SHIMS;

/** The form in which two texts are compared: CRLF becomes LF, and the text ends with exactly one newline. */
export const normalize = (text: string): string => `${text.replace(/\r\n/g, '\n').trimEnd()}\n`;

/** The lines of a text in the compared form, without the empty entry after the last newline. */
const linesOf = (text: string): string[] => normalize(text).slice(0, -1).split('\n');

/** One place where a text differs from the text of the kit. */
export interface Difference {
  /** The first line that differs, counted from 1. */
  line: number;
  /** The kit's text of that line. It is undefined when the kit's text ends before the line. */
  expected: string | undefined;
}

/** Compares a text with the text of the kit, both in the compared form. Equal texts give undefined. */
export function firstDifference(text: string, expected: string): Difference | undefined {
  const actual = linesOf(text);
  const wanted = linesOf(expected);
  const count = Math.max(actual.length, wanted.length);
  for (let index = 0; index < count; index += 1) {
    if (actual[index] !== wanted[index]) return { line: index + 1, expected: wanted[index] };
  }
  return undefined;
}

/** Says what the kit's text holds at the line that differs. */
function describe(difference: Difference): string {
  if (difference.expected === undefined) return 'the kit shim ends before this line';
  if (difference.expected === '') return 'the kit shim has an empty line here';
  return `the kit shim has \`${difference.expected}\` here`;
}

/** Compares one project file with the text of the kit. */
function checkFile(root: string, file: string, expected: string, report: Report): void {
  const path = join(root, file);
  const stats = statSync(path, { throwIfNoEntry: false });
  if (!stats) {
    report.add(RULE, file, 'the file is missing');
    return;
  }
  if (!stats.isFile()) {
    report.add(RULE, file, 'this is not a file');
    return;
  }
  const difference = firstDifference(readFileSync(path, 'utf8'), expected);
  if (!difference) return;
  report.add(RULE, `${file}:${difference.line}`, describe(difference));
}

/** The names in the project root, sorted. A root that is not a folder has none. */
function rootNames(root: string): string[] {
  if (!statSync(root, { throwIfNoEntry: false })?.isDirectory()) return [];
  return readdirSync(root).sort();
}

/**
 * Every Biome config file of the project other than the root `biome.json`, as a sorted list of paths from the root.
 * A name counts in any letter case, because some file systems ignore the case. The search does not follow a
 * symbolic link.
 */
export function otherBiomeConfigs(root: string): string[] {
  const found: string[] = [];
  const visit = (folder: string, path: string): void => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const child = path === '' ? entry.name : `${path}/${entry.name}`;
      if (entry.isDirectory()) {
        if (!UNSEARCHED_FOLDERS.includes(entry.name)) visit(join(folder, entry.name), child);
      } else if (BIOME_CONFIG_NAMES.includes(entry.name.toLowerCase()) && child !== BIOME_FILE) found.push(child);
    }
  };
  if (statSync(root, { throwIfNoEntry: false })?.isDirectory()) visit(root, '');
  return found.sort();
}

/**
 * The M2 part of `config-shim`: `astro.config.mjs`, `biome.json` and `tsconfig.json` equal the kit shims, the root
 * holds no other `astro.config.*` file, and the project holds no other Biome config. One run reports every file.
 */
export function checkShims(root: string, report: Report): void {
  for (const [file, expected] of Object.entries(SHIMS)) checkFile(root, file, expected, report);
  for (const name of rootNames(root)) {
    if (name.startsWith(CONFIG_PREFIX) && name !== CONFIG_FILE) {
      report.add(RULE, name, `remove this file: \`${CONFIG_FILE}\` is the only Astro config`);
    }
  }
  for (const path of otherBiomeConfigs(root)) {
    report.add(RULE, path, `remove this file: \`${BIOME_FILE}\` in the root is the only Biome config`);
  }
}

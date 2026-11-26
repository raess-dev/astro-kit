/**
 * Islands: the hash of Solid's hydration script (specification, section 6.2), and the texts of the inline scripts
 * that Astro writes for islands (`js-script`, section 8).
 *
 * - Astro does not hash the script of a renderer (13.1, item 10), so the kit adds the hash to `script-src`. The text
 *   comes from the `solid-js` that the site has installed, so the hash follows that version.
 * - Astro writes its island runtime and the script of each client directive inline into a page with an island. The
 *   texts come from the `astro` that the site has installed, so `js-script` follows that version too.
 */
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { type Sha256, sha256 } from './csp.ts';

/** The file of `solid-js` that renders the hydration script. */
export const SOLID_SERVER = 'solid-js/web/dist/server.js';

/** The message for a site with islands and without the Solid packages (6.2). */
export const ISLANDS_MISSING =
  'astro-kit: features.islands needs solid-js and @astrojs/solid-js installed; see node_modules/@raess/astro-kit/docs/islands.md.';

/** The text of the first `<script>` of a text. The output of Solid ends with `<!--xs-->` after it. */
const FIRST_SCRIPT = /^<script[^>]*>([\s\S]*?)<\/script>/;

/**
 * The hash of the hydration script of the `solid-js` that the project in `root` has installed.
 *
 * - A project without `solid-js` throws `ISLANDS_MISSING`.
 * - A `solid-js` without `generateHydrationScript()`, or whose output starts with no `<script>`, throws a message
 *   that says so: without the text there is no hash, and the page would block the script.
 */
export async function solidHydrationHash(root: string): Promise<Sha256> {
  let entry: string;
  try {
    entry = createRequire(join(root, 'package.json')).resolve(SOLID_SERVER);
  } catch (cause) {
    throw new Error(ISLANDS_MISSING, { cause });
  }
  const web: unknown = await import(pathToFileURL(entry).href);
  const generate =
    typeof web === 'object' && web !== null && 'generateHydrationScript' in web
      ? web.generateHydrationScript
      : undefined;
  if (typeof generate !== 'function') {
    throw new Error(
      `astro-kit: ${SOLID_SERVER} exports no generateHydrationScript(); the CSP hash cannot be computed.`,
    );
  }
  const html: unknown = generate();
  const text = typeof html === 'string' ? FIRST_SCRIPT.exec(html)?.[1] : undefined;
  if (text === undefined) {
    throw new Error(
      'astro-kit: generateHydrationScript() of solid-js returned no <script>; the CSP hash cannot be computed.',
    );
  }
  return sha256(text);
}

// The inline scripts of Astro's islands

/** The start of Solid's hydration script (13.1, item 11). `js-script` compares the whole text (`solidHydrationText`). */
export const SOLID_HYDRATION_START = /^window\._\$HY\|\|/;

/**
 * The exact text of Solid's hydration script, from the `solid-js` that the project in `root` has installed: the text
 * that `solidHydrationHash` hashes. It is read with a synchronous `require`, as the audits run without `await`.
 * `undefined` when the project has no such `solid-js`, or when its `generateHydrationScript()` gives no `<script>`.
 * Then `js-script` allows no Solid script. It never throws.
 */
export function solidHydrationText(root: string): string | undefined {
  try {
    const load = createRequire(join(root, 'package.json'));
    const web: unknown = load(load.resolve(SOLID_SERVER));
    const generate: unknown =
      isObject(web) && 'generateHydrationScript' in web ? web.generateHydrationScript : undefined;
    if (typeof generate !== 'function') return undefined;
    const html: unknown = generate();
    return typeof html === 'string' ? FIRST_SCRIPT.exec(html)?.[1] : undefined;
  } catch {
    return undefined;
  }
}

/** The module of Astro's runtime that holds the text of the island runtime, for a build (not `astro dev`). */
export const ISLAND_RUNTIME = '@astrojs/runtime/_internal/server/astro-island.prebuilt.js';

/** The module of Astro's runtime that holds the texts of the five built-in client directives. */
export const CLIENT_DIRECTIVES = '@astrojs/runtime/_internal/core/client-directive/default.js';

/** Says whether a value is an object that may hold keys. */
const isObject = (value: unknown): value is object => typeof value === 'object' && value !== null;

/** The `default` export of a module namespace, when it is a text. */
function defaultText(module: unknown): string | undefined {
  const value: unknown = isObject(module) && 'default' in module ? module.default : undefined;
  return typeof value === 'string' ? value : undefined;
}

/** The texts of the client directives of `getDefaultClientDirectives()`, a table of name to text. */
function directiveTexts(module: unknown): string[] {
  const get: unknown =
    isObject(module) && 'getDefaultClientDirectives' in module ? module.getDefaultClientDirectives : undefined;
  if (typeof get !== 'function') return [];
  const table: unknown = get();
  if (!(table instanceof Map)) return [];
  return [...table.values()].filter((text): text is string => typeof text === 'string');
}

/**
 * The exact texts of the inline scripts that Astro writes for islands, from the `astro` that the project in `root`
 * has installed: the island runtime of a build, and the texts of the five built-in client directives (`idle`,
 * `load`, `media`, `only`, `visible`). `js-directive` refuses `load` and `only`, so `js-script` takes their texts:
 * one fact, one id. Astro's runtime package (`@astrojs/runtime`) is resolved from the folder of `astro`, as Astro
 * itself imports it.
 *
 * The modules are read with `require`: Node loads an ES module without top-level `await` that way. A project
 * without `astro`, or an `astro` whose runtime has no such module, gives an empty set. Then no island script is
 * allowed, so the page fails `js-script`, and its detail says why. It never throws.
 */
export function islandScriptTexts(root: string): ReadonlySet<string> {
  const texts = new Set<string>();
  try {
    const astro = createRequire(join(root, 'package.json')).resolve('astro/package.json');
    const load = createRequire(astro);
    const runtime = defaultText(load(ISLAND_RUNTIME));
    if (runtime !== undefined) texts.add(runtime);
    for (const text of directiveTexts(load(CLIENT_DIRECTIVES))) texts.add(text);
  } catch {
    return new Set();
  }
  return texts;
}

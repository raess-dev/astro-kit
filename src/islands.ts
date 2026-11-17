/**
 * Islands: the hash of Solid's hydration script (specification, section 6.2). Astro does not hash the script of a
 * renderer (13.1, item 10), so the kit adds the hash to `script-src`. The text comes from the `solid-js` that the
 * site has installed, so the hash follows that version.
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

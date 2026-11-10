import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { sha256 } from './csp.ts';

/**
 * Astro does not hash a renderer's hydration script. The kit computes it from the site's installed
 * solid-js (server build) and hashes the text inside its <script>, so it is never hard-coded.
 */
export async function solidHydrationHash(root: string): Promise<string> {
  const require = createRequire(join(root, 'package.json'));
  let entry: string;
  try {
    entry = require.resolve('solid-js/web/dist/server.js');
  } catch {
    throw new Error(
      'astro-kit: features.islands needs solid-js and @astrojs/solid-js installed; see node_modules/@raess/astro-kit/docs/islands.md.',
    );
  }
  const web = (await import(pathToFileURL(entry).href)) as { generateHydrationScript: (o?: object) => string };
  const html = web.generateHydrationScript();
  // The output is `<script>…</script>` plus a trailing `<!--xs-->` marker; only the script text is hashed.
  const inner = /^<script[^>]*>([\s\S]*?)<\/script>/.exec(html)?.[1];
  if (!inner)
    throw new Error(
      'astro-kit: solid-js generateHydrationScript() returned no <script>; the CSP hash cannot be computed.',
    );
  return sha256(inner);
}

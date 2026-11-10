import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { sha256 } from './csp.ts';

/**
 * Astro does not hash a renderer's hydration script. The kit computes it from the site's installed
 * solid-js (server build), strips the <script> tags and hashes the inner text, so it is never hard-coded.
 */
export async function solidHydrationHash(root: string): Promise<string> {
  const require = createRequire(join(root, 'package.json'));
  let entry: string;
  try {
    entry = require.resolve('solid-js/web/dist/server.js');
  } catch {
    throw new Error('astro-kit: features.islands needs solid-js and @astrojs/solid-js; run `npx --no astro-kit init --features islands`.');
  }
  const web = (await import(pathToFileURL(entry).href)) as { generateHydrationScript: (o?: object) => string };
  const html = web.generateHydrationScript();
  const inner = html.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, '');
  return sha256(inner);
}

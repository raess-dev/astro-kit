/**
 * The spikes of the specification, 13.2: S1 to S19. Each one proves a platform fact in a minimal Astro project that
 * the suite writes from strings. A spike uses no kit: it uses the stand-in integration of `kit/`.
 * Run: node --test test/acceptance/spikes.test.ts
 * One spike alone: node --test test/acceptance/spikes/s05.ts
 */
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('./spikes/', import.meta.url));
for (const file of readdirSync(dir)
  .filter((name) => /^s\d\d\.ts$/.test(name))
  .sort()) {
  await import(`./spikes/${file}`);
}

/**
 * `js-budget` on the bundler's own output (specification, 14.2, "Real JS budget"; section 8). Astro 7 bundles with
 * Rolldown, which writes a dynamic import as ``import(`./x.js`)``. A unit test on strings cannot prove that the kit
 * reads that form, so this case builds the site with `features.scripts` on and a bundled script that loads a large
 * module through `import()` on a click. The build gives `js-budget` alone, for the JS that loads later. Run:
 * node --test test/acceptance/js-budget.test.ts
 */
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { CLIENT, edit, type KitRun, read, run, siteCase, write } from './harness.ts';

/** The last part of a command's output, for the message of a failed assertion. */
const tail = (result: KitRun): string => result.output.slice(-6000);

/**
 * Text that compresses badly: letters, digits, `-` and `_` from xorshift32 with seed 11. About three quarters of its
 * length remain after compression, so 400,000 characters give about 300,000 B, over `lazyJsBytes` (204,800 B).
 */
function noise(length: number): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let seed = 11;
  let text = '';
  for (let index = 0; index < length; index++) {
    seed ^= seed << 13;
    seed >>>= 0;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    seed >>>= 0;
    text += alphabet[seed % alphabet.length];
  }
  return text;
}

test('M8 js-budget: a large module behind import() of a bundled script fails the later limit on a real build', () => {
  const dir = siteCase('js-budget-real');
  const settings = JSON.parse(read(dir, 'astro-kit.json')) as { features: Record<string, boolean> };
  settings.features.scripts = true;
  write(dir, {
    'astro-kit.json': `${JSON.stringify(settings, null, 2)}\n`,
    'src/data/large.ts': `export const large = '${noise(400_000)}';\n`,
  });
  // The script loads the module only on a click, so its JS is the JS that loads later.
  const script =
    '<script>\n  document.addEventListener("click", async () => {\n    const { large } = await import("../data/large.ts");\n    document.documentElement.dataset.large = String(large.length);\n  });\n</script>\n';
  const page = 'src/pages/anreise.astro';
  const text = read(dir, page);
  edit(dir, page, /<\/Page>\s*$/, `</Page>\n\n${script}`);
  assert.notEqual(read(dir, page), text);

  const built = run(dir, 'build');
  assert.deepEqual(built.ids, ['js-budget'], tail(built));
  assert.notEqual(built.status, 0, tail(built));
  const findings = built.output.split('\n').filter((line) => line.includes('[js-budget]'));
  assert.equal(findings.length, 1, tail(built));
  assert.match(findings[0] ?? '', /\/anreise\/: .*the JS that loads later through import\(\) has [\d,]+ B compressed/);
  // The finding rests on the backtick form that Rolldown writes.
  const assets = join(dir, CLIENT, '_astro');
  const texts = readdirSync(assets)
    .filter((file) => file.endsWith('.js'))
    .map((file) => read(assets, file));
  assert.ok(
    texts.some((js) => /\bimport\(`\.\/large\.[\w-]+\.js`\)/.test(js)),
    'a bundled script loads the module with import(`./large.<hash>.js`)',
  );
});

import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { build, read, record, styles } from '../harness.ts';
import { page, project } from './project.ts';

const REMOTE = 'https://cdn.example/x.css';

/**
 * Astro's default `inlineStylesheets: 'auto'` also inlines a style sheet that is smaller than Vite's
 * `assetsInlineLimit`, which is 4096 B. So the global CSS and the CSS of the route are both larger than that here.
 * Else the spike could not tell `'always'` from the default.
 */
const INLINE_LIMIT = 4096;
const filler = (selector: (index: number) => string): string =>
  Array.from({ length: 400 }, (_, index) => `  ${selector(index)} {\n    order: ${index + 1};\n  }\n`).join('');

/** The case: two components and a page file on the home page. `head` is put before the layer block of card.css. */
const files = (head = ''): Record<string, string> => ({
  'src/styles/elements.css': `@layer elements {\n  body {\n    color: var(--color-text);\n  }\n${filler((index) => `[data-filler="${index}"]`)}}\n`,
  'src/styles/components/card.css': `${head}@layer components {\n  .card {\n    display: block;\n  }\n  .card--unused {\n    display: grid;\n  }\n${filler((index) => `.card--filler-${index}`)}}\n`,
  'src/styles/components/badge.css': '@layer components {\n  .badge {\n    display: inline-block;\n  }\n}\n',
  'src/styles/components/extra.css': '@layer components {\n  .extra {\n    display: flex;\n  }\n}\n',
  'src/styles/pages/index.css': '@layer page {\n  .card {\n    order: 1;\n  }\n}\n',
  'src/components/Card.astro': "---\nimport '../styles/components/card.css';\n---\n<div class=\"card\"><slot /></div>\n",
  'src/components/Badge.astro': "---\nimport '../styles/components/badge.css';\n---\n<span class=\"badge\"><slot /></span>\n",
  'src/pages/index.astro': page(
    'Home',
    '<Card><Badge>b</Badge></Card>',
    "import Card from '../components/Card.astro';\nimport Badge from '../components/Badge.astro';\nimport '../styles/pages/index.css';",
  ),
  'src/pages/plain.astro': page('Plain', '<p>p</p>'),
});

/** The text of each inline `<style>` of a built page. */
const sheets = (html: string): string[] =>
  [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((match) => match[1] ?? '');

/** Every file under `dir` whose name ends with `.css`. */
function cssFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? cssFiles(join(dir, entry.name)) : entry.name.endsWith('.css') ? [entry.name] : [],
  );
}

test("S3: inlineStylesheets 'always' gives one <style>, and an unused selector ships", () => {
  const dir = project('s03', files());
  build(dir);
  for (const file of ['dist/index.html', 'dist/plain/index.html']) {
    const html = read(dir, file);
    assert.equal(sheets(html).length, 1, `${file} has one <style>`);
    assert.equal(/<link\b[^>]*stylesheet/i.test(html), false, `${file} links no style sheet`);
  }
  assert.deepEqual(cssFiles(join(dir, 'dist')), [], 'the build writes no .css file');
  const html = read(dir, 'dist/index.html');
  const css = styles(html);
  // The global files, two component files and the page file are in the one <style>.
  for (const part of ['--color-text', '.card{display:block}', '.badge{display:inline-block}', '.card{order:1}']) {
    assert.ok(css.includes(part), `the one <style> holds ${part}`);
  }
  assert.ok(html.indexOf('<style') < html.indexOf('</head>'), 'the <style> is in the head');
  // No rule-level tree shaking: no built page has the class, and the rule ships.
  assert.equal(html.includes('card--unused"'), false, 'no element has the class card--unused');
  assert.ok(css.includes('.card--unused{display:grid}'), 'the unused rule ships');
  assert.equal(css.includes('.extra'), false, 'a CSS file that nothing imports does not ship');
  // Both parts are larger than the limit, so the default `'auto'` would link them (the next test).
  const global = Buffer.byteLength(styles(read(dir, 'dist/plain/index.html')));
  assert.ok(global > INLINE_LIMIT, `the global CSS has ${global} B`);
  assert.ok(Buffer.byteLength(css) - global > INLINE_LIMIT, `the CSS of the route has ${Buffer.byteLength(css) - global} B`);
});

test("S3: the control: with inlineStylesheets 'auto', the same project links its style sheets", () => {
  // `config` is merged last into the locked config of the stand-in, so it replaces the whole `build` object.
  const dir = project('s03-auto', files(), "{ config: { build: { format: 'directory', inlineStylesheets: 'auto' } } }");
  build(dir);
  const links = (file: string): number => read(dir, file).match(/<link\b[^>]*stylesheet/gi)?.length ?? 0;
  // The home page links the global CSS and the CSS of its route. The plain page links the global CSS.
  assert.deepEqual(
    { home: links('dist/index.html'), plain: links('dist/plain/index.html') },
    { home: 2, plain: 1 },
    'each style sheet above the limit is a <link>',
  );
  for (const file of ['dist/index.html', 'dist/plain/index.html']) {
    assert.equal(sheets(read(dir, file)).length, 0, `${file} has no <style>`);
  }
  assert.equal(cssFiles(join(dir, 'dist')).length, 2, 'the build writes two .css files');
});

test('S3: a chunk with a remote @import stays in a second <style>', () => {
  const dir = project('s03-import', files(`@import url('${REMOTE}');\n`));
  build(dir);
  const home = sheets(read(dir, 'dist/index.html'));
  assert.equal(home.length, 2, 'the page has two <style> elements');
  assert.equal(home[0]?.includes('@import'), false, 'the global files stay in the first <style>');
  assert.ok(home[0]?.includes('--color-text'));
  // The @import is hoisted to the start of the chunk of the route, which holds every component and the page file.
  assert.ok(home[1]?.startsWith(`@import "${REMOTE}";`), 'the second <style> starts with the @import');
  for (const part of ['.card{display:block}', '.badge{display:inline-block}', '.card{order:1}']) {
    assert.ok(home[1]?.includes(part), `the second <style> holds ${part}`);
  }
  assert.equal(/<link\b[^>]*stylesheet/i.test(read(dir, 'dist/index.html')), false, 'separate means inline, not linked');
  assert.deepEqual(cssFiles(join(dir, 'dist')), [], 'the build writes no .css file');
  assert.equal(sheets(read(dir, 'dist/plain/index.html')).length, 1, 'a page without the chunk keeps one <style>');
  record('S3.remoteImport', 'a second inline <style> that starts with the @import');
});

test('S3: a relative @import is resolved by Vite, so the page keeps one <style>', () => {
  const dir = project('s03-relative', files("@import './extra.css';\n"));
  build(dir);
  const home = sheets(read(dir, 'dist/index.html'));
  assert.equal(home.length, 1, 'the page has one <style>');
  assert.equal(home[0]?.includes('@import'), false, 'no @import is left');
  assert.ok(home[0]?.includes('.extra{display:flex}'), 'the imported file is in the <style>');
  record('S3.relativeImport', 'inlined by Vite: one <style>, no @import left');
});

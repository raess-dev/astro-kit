import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { browse, build, layerOrder, read, record, styles } from '../harness.ts';
import { PNG, page, project } from './project.ts';

const ORDER = ['astro', 'reset', 'tokens', 'elements', 'layout', 'components', 'page'];

/** The top-level layers of built CSS in cascade order. `astro.images` is a part of the layer `astro`. */
const layers = (css: string): string[] => layerOrder(css).filter((name) => !name.includes('.'));

const files = {
  'src/assets/photo.png': PNG,
  'src/styles/fonts.css': "@font-face {\n  font-family: Spike;\n  src: local('Arial');\n}\n",
  'src/styles/components/card.css':
    '@layer components {\n  .card {\n    display: block;\n  }\n  .card img {\n    block-size: 3rem;\n  }\n}\n',
  'src/styles/pages/index.css': '@layer page {\n  .card {\n    order: 1;\n  }\n}\n',
  'src/components/Card.astro': "---\nimport '../styles/components/card.css';\n---\n<div class=\"card\"><slot /></div>\n",
  'src/pages/index.astro': page(
    'Home',
    '<Card><Image src={photo} alt="" /></Card>',
    "import { Image } from 'astro:assets';\nimport photo from '../assets/photo.png';\nimport Card from '../components/Card.astro';\nimport '../styles/pages/index.css';",
  ),
  'src/pages/fr/index.astro': page('Accueil', '<p class="stack">Bonjour</p>'),
};

/** The computed height of the image in the card, in Chromium. */
async function imageHeight(dist: string): Promise<string> {
  const { server, browser, close } = await browse(dist);
  try {
    const tab = await (await browser.newContext()).newPage();
    await tab.goto(`${server.origin}/`);
    return await tab.evaluate(() => getComputedStyle(document.querySelector('.card img') as Element).height);
  } finally {
    await close();
  }
}

test('S1: page-ssr CSS lands in every page, base.css first, in the layer order of 7.1', async () => {
  const dir = project('s01', files);
  build(dir);
  const pages = ['dist/index.html', 'dist/fr/index.html'].map((file) => read(dir, file));
  for (const html of pages) {
    assert.equal(html.match(/<style/g)?.length, 1, 'one merged <style> for each page');
    assert.equal(html.includes('rel="stylesheet"'), false, 'no linked style sheet');
    const css = styles(html);
    assert.ok(css.includes('.visually-hidden'), 'base.css is in the page');
    assert.ok(css.includes('--color-text'), 'tokens.css is in the page');
    assert.ok(/@font-face\{[^}]*Spike/.test(css), 'the unlayered @font-face of fonts.css is in the same <style>');
    assert.deepEqual(layers(css), ORDER, 'the built layer order follows 7.1');
    assert.ok(css.indexOf('box-sizing:border-box') < css.indexOf('--color-text'), 'base.css comes before tokens.css');
  }
  const home = styles(pages[0] ?? '');
  // The minifier moves the `layout` block of base.css after `elements`, and keeps a statement for the rest.
  assert.ok(home.indexOf('@layer elements{') < home.indexOf('@layer layout{'), 'layout follows elements in the output');
  assert.ok(home.includes('@layer astro.images{'), 'responsiveStyles emits @layer astro.images');
  // Astro's own layer is lowest, so a project rule on an Astro image wins.
  assert.equal(await imageHeight(join(dir, 'dist')), '48px', 'a component rule beats the astro.images layer');
  record('S1.astroImagesPosition', home.indexOf('@layer astro.images{') > home.indexOf('@layer layout{') ? 'after the global CSS' : 'first');
});

test('S1: without `astro` first in the order statement, the astro.images layer beats every project layer', async () => {
  const dir = project('s01-no-astro', files);
  const css = join(dir, 'kit/base.css');
  writeFileSync(css, readFileSync(css, 'utf8').replace('@layer astro, reset,', '@layer reset,'));
  build(dir);
  assert.equal(layerOrder(styles(read(dir, 'dist/index.html'))).at(-1), 'astro.images', 'the astro layer is declared last');
  assert.equal(await imageHeight(join(dir, 'dist')), '1px', 'the component rule loses: height stays auto');
});

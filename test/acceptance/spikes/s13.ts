import assert from 'node:assert/strict';
import { test } from 'node:test';
import { crc32, deflateSync } from 'node:zlib';
import { build, read, record, styles } from '../harness.ts';
import { page, project } from './project.ts';

/** A PNG of one color, wide enough for the breakpoints 640 and 960 of the stand-in. */
function png(width: number, height: number): Uint8Array {
  const chunk = (type: string, data: Buffer): Buffer => {
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc32(body), body.length + 4);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8); // 8 bits, RGB
  const row = Buffer.alloc(1 + width * 3, 0x66);
  row[0] = 0; // filter: none
  const pixels = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(pixels)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const files = {
  'src/assets/photo.png': png(1000, 500),
  'src/pages/index.astro': page(
    'Home',
    [
      '<Image src={photo} alt="image" />',
      '<Image src={photo} alt="priority" priority />',
      '<Picture src={photo} formats={["avif"]} fallbackFormat="webp" alt="picture" />',
      '<Picture src={photo} formats={["avif"]} fallbackFormat="webp" alt="sizes" sizes="50vw" />',
    ].join(''),
    "import { Image, Picture } from 'astro:assets';\nimport photo from '../assets/photo.png';",
  ),
  // A Markdown image goes through the same image service, with no component.
  'src/pages/text.md': '![markdown](../assets/photo.png)\n',
};

interface Tag {
  name: string;
  attributes: Record<string, string>;
}

/** Every start tag of the body of a built page, with its attributes. */
function tags(html: string): Tag[] {
  const body = html.slice(html.indexOf('</style>'));
  return [...body.matchAll(/<([a-z][a-z0-9-]*)\b([^>]*)>/g)].map((match) => ({
    name: match[1] ?? '',
    attributes: Object.fromEntries(
      [...(match[2] ?? '').matchAll(/([^\s=]+)(?:="([^"]*)")?/g)].map((attribute) => [attribute[1], attribute[2] ?? '']),
    ),
  }));
}

const names = (tag: Tag | undefined): string[] => Object.keys(tag?.attributes ?? {}).sort();
const byAlt = (all: Tag[], alt: string): Tag | undefined => all.find((tag) => tag.attributes.alt === alt);

test('S13: Astro adds no class and no style attribute to <Image>, <Picture> and Markdown image output', () => {
  const dir = project('s13', files);
  build(dir);
  const home = read(dir, 'dist/index.html');
  const text = read(dir, 'dist/text/index.html');
  const all = tags(home);
  const markdown = tags(text);

  assert.equal(all.filter((tag) => tag.name === 'img').length, 4, 'four images on the home page');
  assert.equal(all.filter((tag) => tag.name === 'picture').length, 2, 'two picture elements');
  assert.equal(markdown.filter((tag) => tag.name === 'img').length, 1, 'one image on the Markdown page');
  for (const tag of [...all, ...markdown]) {
    assert.equal('class' in tag.attributes, false, `<${tag.name}> has no class attribute`);
    assert.equal('style' in tag.attributes, false, `<${tag.name}> has no style attribute`);
  }
  assert.equal(/\sclass=/.test(home + text), false, 'no class attribute anywhere in the built pages');

  // Every attribute that Astro writes. The source gave only `src`, `alt`, `priority`, `formats` and `fallbackFormat`.
  const responsive = ['data-astro-image', 'data-astro-image-fit', 'data-astro-image-pos'];
  const base = ['alt', 'decoding', 'height', 'loading', 'sizes', 'src', 'srcset', 'width'];
  const img = [...base, ...responsive].sort();
  assert.deepEqual(names(byAlt(all, 'image')), img, 'the attributes of <Image>');
  assert.deepEqual(names(byAlt(all, 'priority')), [...img, 'fetchpriority'].sort(), '`priority` adds fetchpriority');
  assert.deepEqual(names(byAlt(all, 'picture')), img, 'the attributes of the <img> of <Picture>');
  assert.deepEqual(names(byAlt(markdown, 'markdown')), img.filter((name) => name !== 'data-astro-image-fit'));
  const pictures = all.filter((tag) => tag.name === 'picture');
  assert.deepEqual(pictures.map(names), [[], []], '<picture> has no attribute');

  const image = byAlt(all, 'image')?.attributes ?? {};
  assert.equal(image['data-astro-image'], 'constrained', 'the layout of the stand-in');
  assert.equal(image['data-astro-image-fit'], 'cover');
  assert.equal(image['data-astro-image-pos'], 'center');
  assert.equal(image.sizes, '(min-width: 1000px) 1000px, 100vw');
  assert.deepEqual(image.srcset?.match(/\d+w/g), ['640w', '960w', '1000w'], 'the breakpoints up to the image width');
  assert.equal(image.loading, 'lazy');
  assert.equal(image.decoding, 'async');
  // A Markdown image gets the same generated `sizes` and lazy loading (13.1 item 35).
  const inText = byAlt(markdown, 'markdown')?.attributes ?? {};
  assert.deepEqual([inText.sizes, inText.loading], ['(min-width: 1000px) 1000px, 100vw', 'lazy']);
  const priority = byAlt(all, 'priority')?.attributes ?? {};
  assert.deepEqual([priority.loading, priority.decoding, priority.fetchpriority], ['eager', 'sync', 'high']);

  // <Picture formats avif, fallback webp>: one avif <source>, and a webp <img>.
  const sources = all.filter((tag) => tag.name === 'source');
  assert.equal(sources.length, 2, 'one <source> for each picture');
  assert.equal(sources[0]?.attributes.type, 'image/avif');
  assert.match(byAlt(all, 'picture')?.attributes.src ?? '', /^\/_astro\/photo\.[\w-]+\.webp$/, 'the fallback is webp');
  // Astro copies `sizes` to <source> only when the source code passes `sizes`. The generated value stays on <img>.
  assert.deepEqual(names(sources[0]), ['srcset', 'type'], 'a <source> has a width srcset and no sizes');
  assert.match(sources[0]?.attributes.srcset ?? '', /640w/);
  assert.deepEqual(names(sources[1]), ['sizes', 'srcset', 'type'], 'an explicit sizes reaches the <source>');
  assert.equal(byAlt(all, 'sizes')?.attributes.sizes, '50vw');

  // The responsive styles select by attribute, in the layer astro.images, with no class selector.
  const layerBlock = /@layer astro\.images\{((?:[^{}]*\{[^{}]*\})*)\}/.exec(styles(home));
  const layer = layerBlock?.[1] ?? '';
  assert.ok(layer.includes(':where([data-astro-image=constrained]){max-width:100%}'), 'the astro.images layer is in the page');
  const selectors = [...layer.matchAll(/([^{}]+)\{/g)].map((match) => match[1] ?? '');
  assert.ok(selectors.length > 3);
  for (const selector of selectors) {
    assert.match(selector, /^(?::where\()?\[data-astro-image[a-z-]*(?:=[a-z-]+)?\]\)?$/, `${selector} selects by attribute`);
  }

  record('S13.classNames', []);
  record('S13.sizes', { image: image.sizes, markdown: inText.sizes });
  // The block is in every page that holds an Astro image, and it counts toward the head budget (7.2).
  record('S13.imagesLayerBytes', Buffer.byteLength(layerBlock?.[0] ?? ''));
  record('S13.attributes', {
    img: names(byAlt(all, 'image')),
    imgPriority: names(byAlt(all, 'priority')),
    imgMarkdown: names(byAlt(markdown, 'markdown')),
    picture: names(pictures[0]),
    source: names(sources[0]),
    sourceWithSizesProp: names(sources[1]),
  });
});

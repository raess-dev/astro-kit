import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { test } from 'node:test';
import { isDeepStrictEqual } from 'node:util';
import { brotliCompressSync, constants, zstdCompressSync } from 'node:zlib';
import { build, type Files, read, record, tree } from '../harness.ts';
import { page, project } from './project.ts';

const SHEETS = 60;
const CSP_BYTES = 4096;

/** A component of 7.2 with its own CSS file, as the scale case of 14.2 generates it. */
const component = (name: string, order: number): Files => ({
  [`src/styles/components/${name.toLowerCase()}.css`]: `@layer components {\n  .${name.toLowerCase()} {\n    order: ${order};\n  }\n}\n`,
  [`src/components/${name}.astro`]: `---\nimport '../styles/components/${name.toLowerCase()}.css';\n---\n<div class="${name.toLowerCase()}"><slot /></div>\n`,
});

const uses = (name: string, path = '..'): string => `import ${name} from '${path}/components/${name}.astro';`;

const COPY = '@layer page {\n  .copy {\n    order: 7;\n  }\n}\n';

const plain: Files = {
  // Two route files with the global CSS only.
  'src/pages/index.astro': page('Home', '<p>home</p>'),
  'src/pages/fr/index.astro': page('Accueil', '<p>accueil</p>'),
  // Two route files that import one component.
  ...component('Shared', 1),
  'src/pages/twin-a.astro': page('Twin a', '<Shared>a</Shared>', uses('Shared')),
  'src/pages/twin-b.astro': page('Twin b', '<Shared>b</Shared>', uses('Shared')),
  // Two route files that each import their own CSS file, with the same text.
  'src/styles/pages/copy-a.css': COPY,
  'src/styles/pages/copy-b.css': COPY,
  'src/pages/copy-a.astro': page('Copy a', '<p class="copy">a</p>', "import '../styles/pages/copy-a.css';"),
  'src/pages/copy-b.astro': page('Copy b', '<p class="copy">b</p>', "import '../styles/pages/copy-b.css';"),
  // One dynamic route that builds 60 pages.
  ...component('Entry', 2),
  'src/pages/entries/[slug].astro': page(
    'Entry',
    '<Entry>{Astro.params.slug}</Entry>',
    `${uses('Entry', '../..')}\nexport function getStaticPaths() {\n  return Array.from({ length: ${SHEETS} }, (_, index) => ({ params: { slug: \`entry-\${index + 1}\` } }));\n}`,
  ),
};

/** 60 more route files. Each imports its own component with its own CSS file: 60 more distinct page style sheets. */
const topics: Files = Object.assign(
  {},
  ...Array.from({ length: SHEETS }, (_, index) => {
    const name = `Topic${index + 1}`;
    return {
      ...component(name, 100 + index),
      [`src/pages/topic-${index + 1}.astro`]: page(name, `<${name}>topic</${name}>`, uses(name)),
    };
  }),
);

const sha256 = (text: string): string => `sha256-${createHash('sha256').update(text).digest('base64')}`;

/** The compressed size of section 8: the larger of zstd level 3 and brotli quality 5. */
const compressed = (text: string): number =>
  Math.max(
    zstdCompressSync(text, { params: { [constants.ZSTD_c_compressionLevel]: 3 } }).length,
    brotliCompressSync(text, { params: { [constants.BROTLI_PARAM_QUALITY]: 5 } }).length,
  );

const size = (tag: string): { raw: number; compressed: number } => ({
  raw: Buffer.byteLength(tag),
  compressed: compressed(tag),
});

const TAG = /<meta\b[^>]*http-equiv="?content-security-policy"?[^>]*>/i;
/** The same pattern for a count of the CSP metas of a page: `match` without the `g` flag gives one match at most. */
const TAGS = new RegExp(TAG.source, 'gi');
const STYLE_SRC = /style-src ([^;]*);/;

interface Built {
  /** The whole CSP meta tag. */
  tag: string;
  /** The tag without the hashes of `style-src`. */
  frame: string;
  /** The hashes of `style-src`, in order. */
  hashes: string[];
  /** The text of the page's one `<style>`. */
  css: string;
}

interface Site {
  /** The pages. The key is the page's URL path. */
  pages: Map<string, Built>;
  /** Each expectation that a file of `dist` does not meet. */
  unmet: string[];
}

/**
 * Builds the case and reads the CSP meta and the `<style>` of every page. The test asserts that `unmet` is empty.
 */
function site(name: string, files: Files): Site {
  const dir = project(name, files);
  build(dir);
  const pages = new Map<string, Built>();
  const unmet: string[] = [];
  for (const file of tree(join(dir, 'dist'))) {
    if (!file.endsWith('index.html')) {
      unmet.push(`dist holds pages only, and no CSS file: ${file}`);
      continue;
    }
    const html = read(dir, `dist/${file}`);
    const tag = TAG.exec(html)?.[0] ?? '';
    const sheets = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((match) => match[1] ?? '');
    if ([...html.matchAll(TAGS)].length !== 1) unmet.push(`${file} has one CSP meta`);
    if (sheets.length !== 1) unmet.push(`${file} has one <style>`);
    if (!(html.indexOf(tag) < html.indexOf('<style'))) {
      unmet.push(`the CSP meta of ${file} comes before its <style>`);
    }
    pages.set(`/${file.replace(/index\.html$/, '')}`, {
      tag,
      frame: tag.replace(STYLE_SRC, 'style-src;'),
      hashes: (STYLE_SRC.exec(tag)?.[1] ?? '').match(/sha256-[^']+/g) ?? [],
      css: sheets[0] ?? '',
    });
  }
  return { pages, unmet };
}

/** The paths of `paths` that the site did not build. A test asserts that there are none before it reads a page. */
const missing = (pages: Map<string, Built>, paths: string[]): string[] => paths.filter((path) => !pages.has(path));

/** The page at `path`. The test asserted before, with `missing`, that the page is built. */
const at = (pages: Map<string, Built>, path: string): Built => {
  const found = pages.get(path);
  if (!found) throw new Error(`${path} is not built`);
  return found;
};

const distinct = <T>(values: Iterable<T>): T[] => [...new Set(values)];

/**
 * Astro bundles the CSS of a route as chunks: the global chunk first, then one chunk for each CSS module group.
 * `inlineStylesheets: 'always'` joins them into the page's one `<style>`. This gives the text after the global chunk.
 * The test asserts before, with `unchunked`, that the `<style>` of the page has this form.
 */
const chunk = (pages: Map<string, Built>, path: string): string => at(pages, path).css.slice(at(pages, '/').css.length);

/** The paths of `paths` whose `<style>` is not the global CSS plus a chunk of its own. */
function unchunked(pages: Map<string, Built>, paths: string[]): string[] {
  const global = at(pages, '/').css;
  return paths.filter((path) => {
    const css = at(pages, path).css;
    return !(css.startsWith(global) && css.length > global.length);
  });
}

interface Rule {
  /** One hash for each distinct CSS chunk of the site, sorted. */
  expected: string[];
  /** The style hashes of the home page, sorted. */
  home: string[];
  /** Each expectation that a page does not meet. */
  unmet: string[];
  /** The metas that differ. */
  metas: string[];
}

/**
 * The real rule of Astro 7.4, measured for every page: the style hashes of the CSP meta are one hash for each CSS
 * chunk of the whole site (`chunks`, the same list in the same order on every page), then the hash of the page's
 * own `<style>` unless the list holds it already. The test asserts that `home` is `expected` and `unmet` is empty.
 */
function rule(pages: Map<string, Built>, chunks: string[]): Rule {
  const first = at(pages, '/');
  const unmet: string[] = [];
  for (const [path, built] of pages) {
    if (built.frame !== first.frame) {
      unmet.push(`${path}: the directives and the script hashes are the same on every page`);
    }
    const own = sha256(built.css);
    if (!built.hashes.includes(own)) unmet.push(`${path}: the hash of the page's own <style> is in style-src`);
    if (!isDeepStrictEqual(built.hashes, first.hashes.includes(own) ? first.hashes : [...first.hashes, own])) {
      unmet.push(`${path}: the site's chunk hashes, then the hash of the page's own <style>`);
    }
  }
  return {
    expected: distinct(chunks.map(sha256)).sort(),
    home: [...first.hashes].sort(),
    unmet,
    metas: distinct([...pages.values()].map((built) => built.tag)),
  };
}

/** The largest CSP meta of the site: `budget-head` measures each page. */
const largest = (pages: Map<string, Built>): Built =>
  [...pages.values()].reduce((a, b) => (compressed(b.tag) > compressed(a.tag) ? b : a));

let cache: Site | undefined;
/** The plain site. Two tests read it, and it is built once. */
function plainSite(): Site {
  cache ??= site('s06', plain);
  return cache;
}

const entries = (pages: Map<string, Built>): Built[] =>
  [...pages].filter(([path]) => path.startsWith('/entries/')).map(([, built]) => built);

/** The pages of the plain site with a chunk of their own: one component, the two page files, the dynamic route. */
const OWN_CHUNK = ['/twin-a/', '/copy-a/', '/copy-b/', '/entries/entry-1/'];

/** The pages of the plain site that a test reads. */
const PLAIN_PATHS = ['/', '/fr/', '/twin-b/', ...OWN_CHUNK];

/** The CSS chunks of the plain site: the global one, the two components, and the one text of the two page files. */
const plainChunks = (pages: Map<string, Built>): string[] => [
  at(pages, '/').css,
  ...OWN_CHUNK.map((path) => chunk(pages, path)),
];

test('S6: the CSP meta is not the same on every page: the chunk hashes of the site, then the hash of the own <style>', () => {
  const { pages, unmet } = plainSite();
  assert.deepEqual(unmet, []);
  assert.equal(pages.size, 6 + SHEETS);
  assert.deepEqual(missing(pages, PLAIN_PATHS), [], 'each of these pages is built');
  assert.deepEqual(
    unchunked(pages, OWN_CHUNK),
    [],
    'the <style> of each of these pages is the global CSS plus its own chunk',
  );
  const measured = rule(pages, plainChunks(pages));
  assert.deepEqual(
    measured.home,
    measured.expected,
    'the home page lists one hash for each distinct CSS chunk of the site',
  );
  assert.deepEqual(measured.unmet, []);
  const { metas } = measured;
  // The specification said: the same on every page. Pages share a meta only when they share a <style>.
  assert.equal(
    metas.length,
    distinct([...pages.values()].map((built) => built.css)).length,
    'one meta for each distinct <style>',
  );
  assert.equal(metas.length, 4);
  record('S6.metaSameOnEveryPage', false);

  // Two route files with the same CSS share one hash: with one component, and with two files of the same text.
  assert.equal(at(pages, '/fr/').tag, at(pages, '/').tag, 'two routes with the global CSS only');
  assert.equal(at(pages, '/twin-b/').tag, at(pages, '/twin-a/').tag, 'two routes with one component');
  assert.equal(at(pages, '/copy-b/').tag, at(pages, '/copy-a/').tag, 'two routes with two CSS files of the same text');
  assert.equal(chunk(pages, '/copy-b/'), chunk(pages, '/copy-a/'));
  record(
    'S6.hashesOfTwoRoutesWithIdenticalCss',
    distinct([at(pages, '/copy-a/'), at(pages, '/copy-b/')].map((built) => sha256(built.css))).length,
  );

  // One dynamic route with 60 pages: one <style>, so one chunk hash on every page and one own hash on its pages.
  assert.equal(entries(pages).length, SHEETS);
  assert.equal(
    distinct(entries(pages).map((built) => built.tag)).length,
    1,
    'the 60 pages of one route file share one meta',
  );
  record('S6.hashesOfOneDynamicRouteWith60Pages', distinct(entries(pages).map((built) => sha256(built.css))).length);
  record('S6.styleHashes.plain', {
    home: at(pages, '/').hashes.length,
    pageWithOwnChunk: at(pages, '/twin-a/').hashes.length,
  });
});

test('S6: 60 more distinct page style sheets grow the CSP meta by at most 45 B compressed for each', (t) => {
  const plainBuilt = plainSite();
  assert.deepEqual(plainBuilt.unmet, []);
  const before = plainBuilt.pages;
  const built = site('s06-60', { ...plain, ...topics });
  assert.deepEqual(built.unmet, []);
  const after = built.pages;
  assert.equal(after.size, before.size + SHEETS);
  const paths = Array.from({ length: SHEETS }, (_, index) => `/topic-${index + 1}/`);
  assert.deepEqual(missing(before, ['/']), [], 'the home page of the plain site is built');
  assert.deepEqual(missing(after, [...PLAIN_PATHS, ...paths]), [], 'each of these pages is built');
  assert.deepEqual(
    unchunked(after, [...OWN_CHUNK, ...paths]),
    [],
    'the <style> of each of these pages is the global CSS plus its own chunk',
  );
  const measured = rule(after, [...plainChunks(after), ...paths.map((path) => chunk(after, path))]);
  assert.deepEqual(
    measured.home,
    measured.expected,
    'the home page lists one hash for each distinct CSS chunk of the site',
  );
  assert.deepEqual(measured.unmet, []);
  const { metas } = measured;
  assert.equal(metas.length, 4 + SHEETS, 'each of the 60 routes has its own meta');

  // Each added style sheet adds one hash to the meta of every page, and one more to its own pages.
  const home = { before: at(before, '/'), after: at(after, '/') };
  assert.equal(home.after.hashes.length, home.before.hashes.length + SHEETS);
  assert.equal(at(after, '/topic-1/').hashes.length, home.after.hashes.length + 1);
  record('S6.styleHashes.with60', {
    home: home.after.hashes.length,
    pageWithOwnChunk: at(after, '/topic-1/').hashes.length,
  });

  const sizes = {
    plainHome: size(home.before.tag),
    plainLargest: size(largest(before).tag),
    with60Home: size(home.after.tag),
    with60Largest: size(largest(after).tag),
  };
  const growth = {
    raw: (sizes.with60Home.raw - sizes.plainHome.raw) / SHEETS,
    compressed: Math.round(((sizes.with60Home.compressed - sizes.plainHome.compressed) / SHEETS) * 100) / 100,
    compressedLargest:
      Math.round(((sizes.with60Largest.compressed - sizes.plainLargest.compressed) / SHEETS) * 100) / 100,
  };
  assert.equal(growth.raw, 54, 'one hash is 54 B raw (13.1 item 41)');
  assert.ok(growth.compressed <= 45, `${growth.compressed} B compressed for each sheet on the home page`);
  assert.ok(
    growth.compressedLargest <= 45,
    `${growth.compressedLargest} B compressed for each sheet on the largest meta`,
  );
  assert.ok(sizes.with60Largest.compressed <= CSP_BYTES, 'the largest meta of the site stays within cspBytes');
  // How many distinct CSS chunks fit into cspBytes on top of the plain site, at the measured growth (6.2: about 100).
  const fit = Math.floor(
    (CSP_BYTES - sizes.plainLargest.compressed) / Math.max(growth.compressed, growth.compressedLargest),
  );
  assert.ok(fit >= 100, `${fit} more chunks fit into cspBytes`);
  // A compressed size depends on the zstd and brotli versions of the Node release. So the spike asserts its limits,
  // records the raw sizes only, and prints what this run measured.
  t.diagnostic(
    `S6 compressed, Node ${process.versions.node} (zstd ${process.versions.zstd}, brotli ${process.versions.brotli}): ` +
      `${growth.compressed} B for each sheet on the home page, ${growth.compressedLargest} B on the largest meta, ` +
      `${sizes.with60Largest.compressed} B for the largest meta with ${SHEETS} sheets, ${fit} more chunks fit`,
  );
  record('S6.metaBytesRaw', {
    plainHome: sizes.plainHome.raw,
    plainLargest: sizes.plainLargest.raw,
    with60Home: sizes.with60Home.raw,
    with60Largest: sizes.with60Largest.raw,
  });
  record('S6.rawBytesPerHash', growth.raw);
});

test('S6: CSS files that the same set of route files imports share one chunk, so one hash', () => {
  // Six components. G is on every route, so it joins the global chunk. B, D and E are on the same two routes.
  const names = ['A', 'B', 'C', 'D', 'E', 'G'];
  const route = (...used: string[]): string =>
    page(used.join(''), used.map((name) => `<${name}>x</${name}>`).join(''), used.map((name) => uses(name)).join('\n'));
  const { pages, unmet } = site('s06-chunks', {
    ...Object.assign({}, ...names.map((name, index) => component(name, 10 + index))),
    'src/pages/index.astro': route('G'),
    'src/pages/one.astro': route('A', 'B', 'D', 'E', 'G'),
    'src/pages/two.astro': route('B', 'C', 'D', 'E', 'G'),
    'src/pages/three.astro': route('A', 'C', 'G'),
  });
  assert.deepEqual(unmet, []);
  assert.deepEqual(missing(pages, ['/', '/one/', '/two/', '/three/']), [], 'each of these pages is built');
  for (const name of names) {
    assert.equal(
      at(pages, '/one/').css.includes(`.${name.toLowerCase()}{`),
      'ABDEG'.includes(name),
      `${name} on /one/`,
    );
  }
  // The chunks: global with G, A (one, three), C (two, three), and B with D and E (one, two).
  assert.equal(at(pages, '/').hashes.length, 4, 'four chunk hashes for the global CSS and six component files');
  assert.equal(
    at(pages, '/').hashes[0],
    sha256(at(pages, '/').css),
    'the component of every route is in the global chunk',
  );
  for (const path of ['/one/', '/two/', '/three/'])
    assert.equal(at(pages, path).hashes.length, 5, `${path} adds its own hash`);
  assert.equal(distinct([...pages.values()].map((built) => built.tag)).length, 4);
  record('S6.chunkHashesOfFiveCssFilesWithThreeImportSets', at(pages, '/').hashes.length - 1);
});

/**
 * The `browser` set of the planted violations at milestone M6 (specification, 14.2, "Planted-violation sets"). One
 * copy of the test site is built (the build passes), every plant of the list goes into the built client directory
 * (`dist/client/` with forms), and one `test --all` run must report exactly the ids of the set, and no passed line.
 *
 * Each plant is the smallest violation of its rule, on a page that no other plant touches, so that one plant gives
 * one id and no other plant gives it. The one exception is the `legal-approved` plant: every legal page holds a plant
 * already, so it shares the German legal note with `a11y-axe`. A plant adds a style sheet or a script of its own as a file of the client
 * directory, and links it from its page: the CSP of the site allows a file of its own origin (`'self'`), while a
 * change to an inline style or script would break its hash. The a11y plants stand on the pages that were outside
 * the browser sample at M6, where the site has such a page; from M7 the contact pages and `/fr/emplois/` are in the
 * sample. `contrast-pairs` and `modes-behavior` read the default home only, so their plants are there.
 *
 * `KIT_PLANTED_DROP=<id>` runs the set without the plant of that id, and expects the list without that id. The review
 * runs it once for each id, to prove that each plant gives its id alone. CI does not set it.
 *
 * Run: node --test test/acceptance/planted-browser.test.ts
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { crc32, deflateSync } from 'node:zlib';
import { CLIENT, edit, passedLine, read, run, siteCase, write } from './harness.ts';

/** The ids of the set, sorted. */
const BROWSER_IDS = [
  'a11y-axe',
  'a11y-focus',
  'a11y-forced-colors',
  'a11y-keyboard',
  'a11y-no-js',
  'a11y-reflow',
  'a11y-reveal',
  'a11y-spacing',
  'a11y-targets',
  'contrast-pairs',
  'legal-approved',
  'modes-behavior',
  'perf-cls',
  'perf-image-oversize',
  'perf-lcp-priority',
  'perf-prerender',
];

/**
 * A PNG of `width` × `height` gray pixels. With `noise`, each pixel is a value of a fixed pseudo-random sequence, so
 * the file does not compress and Chromium counts it as a candidate of the largest contentful paint (an image of very
 * few bytes for its size is no candidate). Without it, every pixel is the same gray.
 */
function png(width: number, height: number, noise: boolean): Buffer {
  const chunk = (type: string, data: Buffer): Buffer => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, sum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  // Bit depth 8, color type 0 (gray), no interlace.
  header.set([8, 0, 0, 0, 0], 8);
  const pixels = Buffer.alloc((width + 1) * height, 0x80);
  let seed = 20_261_124;
  for (let row = 0; row < height; row += 1) {
    pixels[row * (width + 1)] = 0;
    if (!noise) continue;
    for (let column = 1; column <= width; column += 1) {
      seed = (seed * 1_103_515_245 + 12_345) >>> 0;
      pixels[row * (width + 1) + column] = seed >>> 24;
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(pixels)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** The built page of a page path: `dist/client/<path>index.html` (`CLIENT`). */
const pageFile = (path: string): string => `${CLIENT}${path}index.html`;

/** Links a file of the client directory from the head of a built page: a style sheet (`.css`) or a module script (`.js`). */
function link(dir: string, path: string, file: string): void {
  const tag = file.endsWith('.css')
    ? `<link rel="stylesheet" href="${file}">`
    : `<script type="module" src="${file}"></script>`;
  edit(dir, pageFile(path), '</head>', `${tag}</head>`);
}

/** Puts `markup` into a built page right after the start tag of its `main`. */
function intoMain(dir: string, path: string, markup: string): void {
  const tag = /<main\b[^>]*>/.exec(read(dir, pageFile(path)))?.[0];
  if (tag === undefined) throw new Error(`kit-acceptance: ${path} has no main`);
  edit(dir, pageFile(path), tag, `${tag}${markup}`);
}

/** Puts `markup` into a built page right before the end tag of its `main`. */
const atMainEnd = (dir: string, path: string, markup: string): void =>
  edit(dir, pageFile(path), '</main>', `${markup}</main>`);

/** Adds a style sheet of its own to the client directory and links it from one page. */
function style(dir: string, path: string, name: string, css: string): void {
  write(dir, { [`${CLIENT}/${name}.css`]: css });
  link(dir, path, `/${name}.css`);
}

/** Adds a module script of its own to the client directory and links it from one page. */
function script(dir: string, path: string, name: string, js: string): void {
  write(dir, { [`${CLIENT}/${name}.js`]: js });
  link(dir, path, `/${name}.js`);
}

const PLANTS: readonly { id: string; plant: (dir: string) => void }[] = [
  {
    // An image with no `alt` on the German legal note: axe gives `image-alt`.
    id: 'a11y-axe',
    plant: (dir) => {
      write(dir, { [`${CLIENT}/plant-dot.png`]: png(8, 8, false) });
      atMainEnd(dir, '/impressum/', '<p><img src="/plant-dot.png" width="8" height="8"></p>');
    },
  },
  {
    // A focus ring that the page makes transparent on the German contact page: no contrast with the color behind it.
    id: 'a11y-focus',
    plant: (dir) => style(dir, '/kontakt/', 'plant-focus', 'a:focus-visible { outline-color: transparent; }\n'),
  },
  {
    // The heading of the English privacy page is not visible with forced colors.
    id: 'a11y-forced-colors',
    plant: (dir) =>
      style(
        dir,
        '/en/privacy/',
        'plant-forced',
        '@media (forced-colors: active) { main h1 { visibility: hidden; } }\n',
      ),
  },
  {
    // An overlay: a transparent layer over the `main` of the French jobs page, so every focused element there is
    // under it. The header stays free, so the hover of `perf-prerender` (every page with --all) reaches its link.
    id: 'a11y-keyboard',
    plant: (dir) => {
      style(
        dir,
        '/fr/emplois/',
        'plant-overlay',
        'main { position: relative; }\n.plant-overlay { position: absolute; inset: 0; z-index: 100; }\n',
      );
      atMainEnd(dir, '/fr/emplois/', '<div class="plant-overlay"></div>');
    },
  },
  {
    // A script adds a link to the French privacy page, so the link exists with JavaScript on only. Its URL is on no
    // other link of the page, and it stands in a sentence, so it is no target of `a11y-targets`.
    id: 'a11y-no-js',
    plant: (dir) =>
      script(
        dir,
        '/fr/protection-des-donnees/',
        'plant-no-js',
        [
          "const paragraph = document.createElement('p');",
          "const link = document.createElement('a');",
          "link.href = '/fr/chambres/#prix';",
          "link.textContent = 'les prix des chambres';",
          "paragraph.append('Voir aussi ', link, '.');",
          "document.querySelector('main')?.append(paragraph);",
          '',
        ].join('\n'),
      ),
  },
  {
    // The heading of the German privacy page is 500 px wide: at 320 px the page scrolls sideways.
    id: 'a11y-reflow',
    plant: (dir) => style(dir, '/datenschutz/', 'plant-reflow', 'main h1 { min-inline-size: 500px; }\n'),
  },
  {
    // A script-only toggle on the French contact page: a button with `aria-expanded` and `aria-controls` that a
    // script opens, instead of a native invoker. It is large enough, has a border and the colors of the site's text
    // on its page, so only `a11y-reveal` fails: the browser's own button colors miss the contrast of axe in the
    // dark theme.
    id: 'a11y-reveal',
    plant: (dir) => {
      style(
        dir,
        '/fr/contact/',
        'plant-toggle',
        '.plant-toggle { min-inline-size: 3rem; min-block-size: 3rem; border: 1px solid currentColor; ' +
          'color: var(--color-text); background: var(--color-page); }\n',
      );
      atMainEnd(
        dir,
        '/fr/contact/',
        '<p><button type="button" class="plant-toggle" aria-expanded="false" aria-controls="plant-more">Plus</button></p>' +
          '<p id="plant-more" hidden>Nous répondons dans la journée.</p>',
      );
      script(
        dir,
        '/fr/contact/',
        'plant-toggle',
        [
          "const button = document.querySelector('.plant-toggle');",
          "const more = document.getElementById('plant-more');",
          "button?.addEventListener('click', () => {",
          '  if (more === null) return;',
          '  more.hidden = !more.hidden;',
          "  button.setAttribute('aria-expanded', String(!more.hidden));",
          '});',
          '',
        ].join('\n'),
      );
    },
  },
  {
    // The first paragraph of the English legal note keeps a fixed block size and hides its overflow: with wider
    // text spacing, its text is cut.
    id: 'a11y-spacing',
    plant: (dir) =>
      style(dir, '/en/legal-note/', 'plant-spacing', 'main p:first-of-type { block-size: 3lh; overflow: hidden; }\n'),
  },
  {
    // A button of 32 × 32 px on the German jobs page: below 43.5 px, above the 24 px of axe's `target-size`. From M7
    // `elements.css` gives every button a minimum size of 44 px, so the plant sets both minimums to 0.
    id: 'a11y-targets',
    plant: (dir) => {
      style(
        dir,
        '/jobs/',
        'plant-small',
        '.plant-small { box-sizing: border-box; inline-size: 32px; block-size: 32px; min-inline-size: 0; min-block-size: 0; padding: 0; border: 1px solid currentColor; }\n',
      );
      atMainEnd(dir, '/jobs/', '<p><button type="button" class="plant-small" aria-label="Teilen">+</button></p>');
    },
  },
  {
    // The dark value of `--color-error` becomes a dark red in `docs/design.md` and in the tokens of the home page,
    // so the tokens still equal their design values, and the pair error on page misses its ratio of 4.5 in the
    // dark theme. The site shows no error text, so no other rule sees the color.
    id: 'contrast-pairs',
    plant: (dir) => {
      edit(dir, 'docs/design.md', '| `#a1201b` | `#ffa095` |', '| `#a1201b` | `#7a3a33` |');
      style(
        dir,
        '/',
        'plant-pairs',
        '@layer tokens {\n  :root {\n    --color-error: light-dark(#a1201b, #7a3a33);\n  }\n}\n',
      );
    },
  },
  {
    // The browser half of `legal-approved`: a style sheet adds text after the heading of the German legal note, so
    // the text that a visitor is shown is not the locked text. Every declared legal page holds a plant of another
    // rule already, so this one shares the page of `a11y-axe`: axe reads no generated text as a failure, and the
    // image without `alt` adds no text. The build half does not see it, because the plant is in the built files.
    id: 'legal-approved',
    plant: (dir) => style(dir, '/impressum/', 'plant-legal', 'main h1::after { content: " (gilt nicht)"; }\n'),
  },
  {
    // An extra CSS file on the home page changes a color token under `:root[data-mode="dark"]`: the shadow color,
    // which is in no pair and which the site uses nowhere, so only the comparison with the design value fails.
    id: 'modes-behavior',
    plant: (dir) => style(dir, '/', 'plant-modes', ':root[data-mode="dark"] { --color-shadow: #00000080; }\n'),
  },
  {
    // A script on the English contact page puts a block of 300 px at the top of `main` 300 ms after `load`.
    id: 'perf-cls',
    plant: (dir) =>
      script(
        dir,
        '/en/contact/',
        'plant-cls',
        [
          "addEventListener('load', () => {",
          '  setTimeout(() => {',
          "    const block = document.createElement('div');",
          "    block.style.blockSize = '300px';",
          "    document.querySelector('main')?.prepend(block);",
          '  }, 300);',
          '});',
          '',
        ].join('\n'),
      ),
  },
  {
    // A gray image of 1600 × 900 px in a box of 64 × 36 px at the end of the German sitemap page. The box is small, so
    // the image is never the largest element of the first screen.
    id: 'perf-image-oversize',
    plant: (dir) => {
      write(dir, { [`${CLIENT}/plant-wide.png`]: png(1600, 900, false) });
      atMainEnd(
        dir,
        '/sitemap/',
        '<p><img src="/plant-wide.png" width="64" height="36" alt="Eine graue Fläche" loading="lazy"></p>',
      );
    },
  },
  {
    // A noise PNG as the first element of `main` on the French legal note, the largest element of the first screen,
    // with neither `fetchpriority="high"` nor `loading="eager"`.
    id: 'perf-lcp-priority',
    plant: (dir) => {
      write(dir, { [`${CLIENT}/plant-noise.png`]: png(480, 360, true) });
      style(
        dir,
        '/fr/mentions-legales/',
        'plant-lcp',
        '.plant-lcp { display: block; inline-size: 100%; block-size: auto; }\n',
      );
      intoMain(
        dir,
        '/fr/mentions-legales/',
        '<img class="plant-lcp" src="/plant-noise.png" width="480" height="360" alt="Un bruit gris" loading="lazy">',
      );
    },
  },
  {
    // `eagerness: conservative` in the speculation block of the English sitemap page, with its hash in the CSP meta
    // of that page: a hover no longer starts a prerender.
    id: 'perf-prerender',
    plant: (dir) => {
      const file = pageFile('/en/sitemap/');
      const old = /<script type="speculationrules">([^<]*)<\/script>/.exec(read(dir, file))?.[1];
      if (old === undefined) throw new Error('kit-acceptance: /en/sitemap/ has no speculation block');
      const changed = old.replace('"eagerness":"moderate"', '"eagerness":"conservative"');
      const hash = (text: string): string => `'sha256-${createHash('sha256').update(text).digest('base64')}'`;
      // `edit` throws when a text is not there, so the block and its hash in the CSP meta both change.
      edit(dir, file, `>${old}<`, `>${changed}<`);
      edit(dir, file, hash(old), hash(changed));
    },
  },
];

/** The last part of a command's output, for the message of a failed assertion. */
const tail = (output: string): string => output.slice(-6000);

test('every id of the browser set has one plant', () => {
  assert.deepEqual(
    PLANTS.map((plant) => plant.id),
    BROWSER_IDS,
  );
});

test('M6 planted: the browser set gives exactly its ids', () => {
  const drop = process.env.KIT_PLANTED_DROP;
  if (drop !== undefined && !BROWSER_IDS.includes(drop)) {
    throw new Error(`KIT_PLANTED_DROP: ${drop} is no id of the browser set`);
  }
  const dir = siteCase(drop === undefined ? 'planted-browser' : `planted-browser-without-${drop}`);
  const built = run(dir, 'build');
  assert.equal(built.status, 0, tail(built.output));
  for (const plant of PLANTS) if (plant.id !== drop) plant.plant(dir);
  const result = run(dir, ['test', '--all']);
  // A killed command has no findings: it must read as a kill, not as a set that gives no id.
  assert.equal(result.killed, undefined, tail(result.output));
  assert.deepEqual(
    result.ids,
    BROWSER_IDS.filter((id) => id !== drop),
    tail(result.output),
  );
  assert.equal(result.status, 1);
  assert.deepEqual(passedLine(result), { last: false, count: 0 }, tail(result.output));
});

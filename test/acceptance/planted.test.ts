/**
 * The planted-violation sets of milestone M5 and the five typical agent mistakes (specification, 14 and 14.2).
 *
 * - **A set** plants every violation of its list in one copy of the site, runs `build` once, and asserts exactly
 *   that list of rule ids, and that the output holds no passed line. This file holds the sets `config` (M9), `css`,
 *   `design`, `modes` and `route`. Each plant changes as little as it can, and its comment says which id it plants.
 * - **A mistake** is one change that agents often make, each on its own copy of the site. Its case runs `build` and
 *   asserts exactly one id.
 *
 * The ids of rules that later milestones add join their sets with their rules: `js-budget` joined the `css` set at M8.
 * The `route` set (M7) starts from the `static` variant and adds an on-demand route of the project.
 * `KIT_PLANTED_DROP=<id>` runs the `css` or the `route` set without the plant of that id, and expects the list without
 * that id. The review runs it once for each id, to prove that each plant gives its id alone. CI does not set it.
 * A case that changes `docs/design.md` runs `tokens` first (14.2, Rendered files).
 * Run: node --test test/acceptance/planted.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { edit, type KitRun, kitModule, passedLine, read, run, siteCase, write } from './harness.ts';
import { toStatic } from './variants.ts';

/** The last part of a command's output, for the message of a failed assertion. */
const tail = (result: KitRun): string => result.output.slice(-6000);

/** No passed line anywhere: the command failed (6.4). */
const NOT_PASSED = { last: false, count: 0 } as const;

// The members of the built kit modules that the css set uses. The exports map hides the modules (14.2).
interface OptionsModule {
  LIMITS: { headBytes: number; documentBytes: number; domElements: number; fontBytes: number; islandJsBytes: number };
}
interface BudgetsModule {
  compressedSize(data: string | Uint8Array): number;
}

// Files and anchors of the site that the plants use.
const LAYOUT = 'src/layouts/Page.astro';
/** The line of the shared head after which a plant puts an element into the head of one page. */
const HEAD_ANCHOR = '<meta name="viewport" content="width=device-width, initial-scale=1">';

/** Puts `markup` into the head of the one page with the key `key` in the locale `locale`, through the layout. */
function intoHead(dir: string, key: string, locale: string, markup: string): void {
  edit(dir, LAYOUT, HEAD_ANCHOR, `${HEAD_ANCHOR}\n    {page === '${key}' && locale === '${locale}' && (${markup})}`);
}

/**
 * Text that no compressor can shrink much: letters, digits, `-` and `_` from xorshift32 with seed 7, the generator
 * of `photos.ts`. It has about 6 bits for each character, so it compresses to about three quarters of its length.
 * It depends only on `length`.
 */
function noise(length: number): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let seed = 7;
  let text = '';
  for (let i = 0; i < length; i++) {
    seed ^= seed << 13;
    seed >>>= 0;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    seed >>>= 0;
    text += alphabet[seed % alphabet.length];
  }
  return text;
}

/**
 * An animated GIF of 1 × 1 pixel: two frames, each with its graphic control extension, and a comment extension of
 * 20 blocks of 255 bytes. The comment makes the file larger than Vite's limit for inlining, so Vite writes it as a
 * file into `dist/_astro/`, and the page links it.
 */
function animatedGif(): Uint8Array {
  const header = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x80, 0x00, 0x00];
  const palette = [0x00, 0x00, 0x00, 0xff, 0xff, 0xff];
  const control = [0x21, 0xf9, 0x04, 0x00, 0x0a, 0x00, 0x00, 0x00];
  const image = [0x2c, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0x02, 0x02, 0x44, 0x01, 0x00];
  const frame = [...control, ...image];
  const comment = [0x21, 0xfe];
  for (let block = 0; block < 20; block++) comment.push(0xff, ...new Array<number>(255).fill(0x78));
  comment.push(0x00);
  return Uint8Array.from([...header, ...palette, ...frame, ...frame, ...comment, 0x3b]);
}

// The css set

/** The size of each budget plant. The test checks each one against its limit of LIMITS. */
const SIZES = {
  /** Characters of noise in the head of /anreise/: about 15,000 B compressed, beside the 6,000 B of the head. */
  head: 20_000,
  /** Characters of noise in a `template` of /jobs/: about 39,000 B compressed. */
  document: 52_000,
  /** Empty `span` elements on /zimmer/. */
  elements: 2_000,
  /** Bytes of the font file that /restaurant/ preloads. */
  font: 150_000,
  /** Characters of noise in the island file of /fr/restaurant/: about 30,000 B compressed. */
  island: 40_000,
} as const;

/** One plant of a set: the id that it plants, and the change to a case folder. */
interface Plant {
  id: string;
  plant(dir: string): void;
}

/**
 * The plants of the `css` set at M5: the budgets, the font limit, the CSS rules that read the built pages, and the
 * animated image. Each plant sits on a page of its own, and none on a legal page (`legal-approved` joins at M9).
 */
const CSS_PLANTS: readonly Plant[] = [
  {
    // One `meta` with noise in the head of /anreise/. The noise alone is over `headBytes` compressed, and the whole
    // page stays under `documentBytes`. A `meta` with a name of its own is valid HTML that no other rule reads.
    id: 'budget-head',
    plant(dir) {
      intoHead(dir, 'gettingHere', 'de', `<meta name="planted-head" content="${noise(SIZES.head)}" />`);
    },
  },
  {
    // A `template` with noise in the body of /jobs/: over `documentBytes` compressed, and nothing in the head.
    // Template content is an inert fragment, so only the budget reads it (section 8, Measurement details).
    id: 'budget-document',
    plant(dir) {
      const next = '<h2>Bewerbung</h2>';
      edit(dir, 'src/pages/jobs.astro', next, `<template>${noise(SIZES.document)}</template>\n    ${next}`);
    },
  },
  {
    // Empty `span` elements in one hidden `div` on /zimmer/, so the page has far more than `domElements` elements.
    // Empty spans are valid HTML, with no text, no link and no class.
    id: 'budget-dom',
    plant(dir) {
      const spans = '<span></span>'.repeat(SIZES.elements);
      edit(dir, 'src/pages/zimmer.astro', '</TextSection>', `<div hidden>${spans}</div>\n  </TextSection>`);
    },
  },
  {
    // One font file over `fontBytes`, which /restaurant/ preloads. One preload on the page stays within
    // `fonts-limit`.
    id: 'budget-fonts',
    plant(dir) {
      write(dir, { 'public/fonts/menu-serif.woff2': new Uint8Array(SIZES.font) });
      intoHead(
        dir,
        'restaurant',
        'de',
        '<link rel="preload" as="font" type="font/woff2" href="/fonts/menu-serif.woff2" crossorigin />',
      );
    },
  },
  {
    // Two font preloads on /kontakt/, where the rule allows one. The two files are tiny, so they add almost nothing
    // to the sum of `budget-fonts`.
    id: 'fonts-limit',
    plant(dir) {
      write(dir, {
        'public/fonts/display.woff2': new TextEncoder().encode('wOF2 display'),
        'public/fonts/body.woff2': new TextEncoder().encode('wOF2 body'),
      });
      const preload = (file: string): string =>
        `<link rel="preload" as="font" type="font/woff2" href="/fonts/${file}" crossorigin />`;
      intoHead(dir, 'contact', 'de', `<>${preload('display.woff2')}${preload('body.woff2')}</>`);
    },
  },
  {
    // One class that no CSS file defines, on the heading of /sitemap/. The bare `h1` rule of `elements.css` still
    // matches the heading, so `css-element-coverage` has nothing to say.
    id: 'css-classes',
    plant(dir) {
      edit(dir, 'src/pages/sitemap.astro', '<h1>Sitemap</h1>', '<h1 class="page-title">Sitemap</h1>');
    },
  },
  {
    // One `code` element on /en/getting-here/: `code` is in the list of the rule, and `elements.css` has no rule
    // for it.
    id: 'css-element-coverage',
    plant(dir) {
      edit(dir, 'src/pages/en/getting-here.astro', '“Sils/Segl Maria, Posta”', '<code>Sils/Segl Maria, Posta</code>');
    },
  },
  {
    // An SVG file with a `<style>` of its own, as a drawing program exports it, shown inline on /fr/plan-du-site/
    // as an Astro SVG component. Its rule stands unlayered in the built page. The source half of `css-sources` reads
    // no `.svg` file, and a `<style>` with an unlayered rule is no second `<style>` of project CSS. The rule selects
    // only `path`, so it adds no class.
    id: 'css-layer-order',
    plant(dir) {
      write(dir, {
        'src/assets/mark.svg':
          '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16">' +
          '<style>path{fill:currentColor}</style><path d="M8 1 15 15H1z"/></svg>\n',
      });
      const page = 'src/pages/fr/plan-du-site.astro';
      const first = "import PageIndex from '../../components/PageIndex.astro';";
      edit(dir, page, first, `import Mark from '../../assets/mark.svg';\n${first}`);
      edit(dir, page, '<h1>Plan du site</h1>', '<Mark aria-hidden="true" />\n    <h1>Plan du site</h1>');
    },
  },
  {
    // One part of the price list that no page uses. It sets only a token of the right family, and no design row
    // names it.
    id: 'css-unused',
    plant(dir) {
      const next = '    .price-list__note {';
      const unused = '    .price-list__total {\n      font-weight: var(--weight-bold);\n    }\n\n';
      edit(dir, 'src/styles/components/price-list.css', next, `${unused}${next}`);
    },
  },
  {
    // An island on /fr/restaurant/, written as the markup that Astro writes for one, whose component file is over
    // `islandJsBytes` compressed. The page imports the file with `?url`, so Vite writes it to `/_astro/` (it is over
    // the 4 KB that Vite inlines as a `data:` URL): `public/` may hold no JS file (`config-public-shadow`). Its
    // directive is `visible`, so `js-directive` has nothing to say, and the page has no script, so `js-script` has
    // nothing either: only the budget reads the island's URLs. The site has no islands, so nothing ever loads the file.
    id: 'js-budget',
    plant(dir) {
      write(dir, { 'src/assets/island-plant.js': `export default () => {};\n/*${noise(SIZES.island)}*/\n` });
      const page = 'src/pages/fr/restaurant.astro';
      const first = "import restaurant from '../../assets/photos/restaurant.jpg';";
      edit(dir, page, first, `import plant from '../../assets/island-plant.js?url';\n${first}`);
      const island =
        '<astro-island uid="Plant" component-url={plant} component-export="default" renderer-url={plant} props="{}" ssr client="visible" opts="{}"></astro-island>';
      edit(dir, page, '<h1>Restaurant</h1>', `<h1>Restaurant</h1>\n    ${island}`);
    },
  },
  {
    // A GIF with two frames, imported as a URL and shown on /fr/emplois/. It is 1 × 1 pixel, so `images-original`
    // has nothing to say, and an `img` outside a `picture` is no case of `images-format`.
    id: 'media-animated',
    plant(dir) {
      write(dir, { 'src/assets/wave.gif': animatedGif() });
      const page = 'src/pages/fr/emplois.astro';
      const first = "import ContactCard from '../../components/ContactCard.astro';";
      edit(dir, page, first, `import wave from '../../assets/wave.gif?url';\n${first}`);
      edit(dir, page, '</h1>', '</h1>\n    <img src={wave} width="1" height="1" alt="">');
    },
  },
];

/** The ids of the `css` set at M5, with `js-budget` of M8. */
const CSS_SET = [
  'budget-document',
  'budget-dom',
  'budget-fonts',
  'budget-head',
  'css-classes',
  'css-element-coverage',
  'css-layer-order',
  'css-unused',
  'fonts-limit',
  'js-budget',
  'media-animated',
];

/** The ids of the `route` set (M7). */
const ROUTE_SET = ['routes-on-demand'];

/**
 * The id of `KIT_PLANTED_DROP` when it is an id of `set`, else `undefined`. This file takes an id of the `css` set or
 * of the `route` set; any other id stops the run.
 */
function droppedFrom(set: readonly string[]): string | undefined {
  const drop = process.env.KIT_PLANTED_DROP;
  if (drop === undefined) return undefined;
  if (!CSS_SET.includes(drop) && !ROUTE_SET.includes(drop)) {
    throw new Error(`KIT_PLANTED_DROP: ${drop} is no id of the css or the route set`);
  }
  return set.includes(drop) ? drop : undefined;
}

test('M5 planted set css: exactly the ids of its list', async () => {
  // Each id of the list has one plant.
  assert.deepEqual(
    CSS_PLANTS.map(({ id }) => id),
    [...new Set(CSS_PLANTS.map(({ id }) => id))],
  );
  assert.deepEqual(CSS_PLANTS.map(({ id }) => id).sort(), CSS_SET);
  // Each budget plant alone is over its limit, the plants of /zimmer/, /jobs/ and /restaurant/ by a fifth or more.
  // With the 6,000 B of its own head, /anreise/ is about 22,000 B, and its whole page stays under `documentBytes`.
  const { LIMITS } = await kitModule<OptionsModule>('options');
  const { compressedSize } = await kitModule<BudgetsModule>('audit/budgets');
  assert.ok(compressedSize(noise(SIZES.head)) > LIMITS.headBytes);
  assert.ok(compressedSize(noise(SIZES.head)) < 0.6 * LIMITS.documentBytes);
  assert.ok(compressedSize(noise(SIZES.document)) > 1.2 * LIMITS.documentBytes);
  assert.ok(SIZES.elements > 1.2 * LIMITS.domElements);
  assert.ok(SIZES.font > 1.2 * LIMITS.fontBytes);
  assert.ok(compressedSize(noise(SIZES.island)) > 1.2 * LIMITS.islandJsBytes);

  const drop = droppedFrom(CSS_SET);
  const dir = siteCase(drop === undefined ? 'planted-css' : `planted-css-without-${drop}`, (folder) => {
    for (const { id, plant } of CSS_PLANTS) if (id !== drop) plant(folder);
  });
  const result = run(dir, 'build');
  assert.deepEqual(
    result.ids,
    CSS_SET.filter((id) => id !== drop),
    tail(result),
  );
  assert.equal(result.status, 1, tail(result));
  assert.deepEqual(passedLine(result), NOT_PASSED, tail(result));
  // `budget-document` holds the word that sets off Astro's false browser hint (13.1); the kit keeps it off.
  assert.equal(result.output.includes('Browser APIs are not available'), false, tail(result));
});

// The route set

test('M7 planted set route: the static site with an on-demand route of its own gives routes-on-demand', () => {
  const drop = droppedFrom(ROUTE_SET);
  const dir = siteCase(drop === undefined ? 'planted-route' : `planted-route-without-${drop}`);
  toStatic(dir);
  // The pattern `/live.json` passes the endpoint clause of `routes-slug`; only `routes-on-demand` refuses the route.
  if (drop === undefined) {
    write(dir, {
      'src/pages/live.json.ts': [
        'export const prerender = false;',
        "export const GET = () => new Response('{}', { headers: { 'content-type': 'application/json' } });",
        '',
      ].join('\n'),
    });
  }
  const result = run(dir, 'build');
  assert.deepEqual(
    result.ids,
    ROUTE_SET.filter((id) => id !== drop),
    tail(result),
  );
  // Without its plant the set is the `static` variant, which passes.
  const passes = drop !== undefined;
  assert.equal(result.status, passes ? 0 : 1, tail(result));
  assert.deepEqual(passedLine(result), passes ? { last: true, count: 1 } : NOT_PASSED, tail(result));
});

// The config set

/** The ids of the `config` set (14.2), sorted. Every id is a config-stage rule or the source half of one. */
const CONFIG_SET = [
  'config-dep-allowlist',
  'config-dep-spec',
  'config-experimental',
  'config-i18n',
  'config-imports',
  'config-overrides',
  'config-public-shadow',
  'config-server',
  'config-shim',
  'config-suppression',
  'config-waiver',
  'config-wrangler',
  'csp-hash',
  'css-banned',
  'css-component-file',
  'css-layer-file',
  'css-literal',
  'css-local-var',
  'css-media',
  'css-page',
  'css-selector',
  'css-sources',
  'css-token-family',
  'css-var-undefined',
  'design-pairs',
  'design-specs',
  'design-tokens',
  'facts-schedule',
  'forms-binding',
  'images-original',
  'images-public',
  'js-directive',
  'js-prefetch-attr',
  'js-script',
  'legal-processing',
  'routes-redirects',
];

/** The first 24 bytes of a PNG file: the signature and the IHDR chunk start with the width and the height. */
function pngHeader(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

/** Reads a JSON file of a case, lets `change` edit it, and writes it back. */
function changeJson<T>(dir: string, file: string, change: (value: T) => void): void {
  const value = JSON.parse(read(dir, file)) as T;
  change(value);
  write(dir, { [file]: `${JSON.stringify(value, null, 2)}\n` });
}

/** The component CSS file that the css plants of the config set use, and the end of its root rule. */
const CARD_CSS = 'src/styles/components/feature-card.css';
const CARD_ROOT = '    --stack-gap: var(--space-3);\n';

/**
 * The plants of the `config` set. The build stops in the config stage, so no page is built and no build rule runs.
 * One change of `astro.config.mjs` plants three ids: the shim differs, and the config sets an experimental flag and
 * `i18n`. The other plants give one id each.
 */
const CONFIG_PLANTS: readonly { ids: readonly string[]; plant: (dir: string) => void }[] = [
  {
    // The shim with an experimental flag and an `i18n` of its own.
    ids: ['config-experimental', 'config-i18n', 'config-shim'],
    plant: (dir) =>
      edit(
        dir,
        'astro.config.mjs',
        'integrations: [astroKit()]',
        "integrations: [astroKit()], experimental: { clientPrerender: true }, i18n: { locales: ['de'], defaultLocale: 'de' }",
      ),
  },
  {
    // A package that the allowlist does not hold, a dependency from a file, and an override.
    ids: ['config-dep-allowlist', 'config-dep-spec', 'config-overrides'],
    plant: (dir) =>
      changeJson<Record<string, Record<string, string>>>(dir, 'package.json', (manifest) => {
        manifest.dependencies = { ...manifest.dependencies, 'left-pad': '1.3.0' };
        manifest.devDependencies = { ...manifest.devDependencies, wrangler: 'file:../wrangler' };
        manifest.overrides = { 'left-pad': '1.3.0' };
      }),
  },
  {
    // A source that imports the client router.
    ids: ['config-imports'],
    plant: (dir) => write(dir, { 'src/data/router.ts': "export { ClientRouter } from 'astro:transitions';\n" }),
  },
  {
    // A `robots.txt` of the project, which the kit writes itself.
    ids: ['config-public-shadow'],
    plant: (dir) => write(dir, { 'public/robots.txt': 'User-agent: *\nAllow: /\n' }),
  },
  {
    // Server code of the project: a middleware.
    ids: ['config-server'],
    plant: (dir) => write(dir, { 'src/middleware.ts': 'export const onRequest = (_context, next) => next();\n' }),
  },
  {
    // A comment that takes a line out of the type check.
    ids: ['config-suppression'],
    plant: (dir) => write(dir, { 'src/data/routes.ts': `${read(dir, 'src/data/routes.ts')}// @ts-ignore\n` }),
  },
  {
    // A waiver whose `until` was yesterday (UTC).
    ids: ['config-waiver'],
    plant: (dir) =>
      changeJson<Record<string, unknown>>(dir, 'astro-kit.json', (settings) => {
        const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
        settings.waivers = [
          { rule: 'head-title', where: '/jobs/', reason: 'Planted waiver of the config set', until: yesterday },
        ];
      }),
  },
  {
    // A second wrangler file next to `wrangler.jsonc`.
    ids: ['config-wrangler'],
    plant: (dir) => write(dir, { 'wrangler.toml': 'name = "laerchenwald-example"\n' }),
  },
  {
    // A form rate limit that is not the one of 9.1, in `wrangler.jsonc`. The file is no longer the rendering
    // either, which `config-wrangler` reports too.
    ids: ['forms-binding', 'config-wrangler'],
    plant: (dir) =>
      edit(dir, 'wrangler.jsonc', '"simple": { "limit": 3, "period": 60 }', '"simple": { "limit": 30, "period": 60 }'),
  },
  {
    // A page with an inline script with `is:inline`, a script without the feature, a prefetch attribute and an
    // island that hydrates on load.
    ids: ['csp-hash', 'js-directive', 'js-prefetch-attr', 'js-script'],
    plant: (dir) =>
      edit(
        dir,
        'src/pages/jobs.astro',
        '<h1>Arbeiten im Hotel Lärchenwald</h1>',
        [
          '<h1>Arbeiten im Hotel Lärchenwald</h1>',
          '    <script is:inline type="application/ld+json">{}</script>',
          '    <script>document.title = "Jobs";</script>',
          '    <a href="/zimmer/" data-astro-prefetch>Zimmer</a>',
          '    <span client:load>Jetzt</span>',
        ].join('\n'),
      ),
  },
  {
    // In a component file: `!important`, a literal length, a color token for a length, an undeclared token, a
    // local custom property set off the root, an id selector, a breakpoint that `docs/design.md` does not declare,
    // and a second top-level layer.
    ids: [
      'css-banned',
      'css-layer-file',
      'css-literal',
      'css-local-var',
      'css-media',
      'css-selector',
      'css-token-family',
      'css-var-undefined',
    ],
    plant: (dir) => {
      edit(
        dir,
        CARD_CSS,
        CARD_ROOT,
        [
          CARD_ROOT,
          '    color: var(--color-text) !important;',
          '    padding: 13px;',
          '    margin: var(--color-accent);',
          '    gap: var(--space-99);',
          '',
          '    .feature-card__body {',
          '      --feature-card-pad: var(--space-2);',
          '    }',
          '',
          '    #hero {',
          '      color: var(--color-title);',
          '    }',
          '',
          '    @media (width < 777px) {',
          '      gap: var(--space-2);',
          '    }',
          '',
        ].join('\n'),
      );
      write(dir, {
        [CARD_CSS]: `${read(dir, CARD_CSS)}\n@layer components {\n  .feature-card {\n    gap: var(--space-2);\n  }\n}\n`,
      });
    },
  },
  {
    // A component without its CSS file.
    ids: ['css-component-file'],
    plant: (dir) => write(dir, { 'src/components/Badge.astro': '<span class="badge">Neu</span>\n' }),
  },
  {
    // A page file that sets a color.
    ids: ['css-page'],
    plant: (dir) =>
      edit(
        dir,
        'src/styles/pages/index.css',
        '      grid-column: 1 / -1;\n',
        '      grid-column: 1 / -1;\n      color: var(--color-text);\n',
      ),
  },
  {
    // A style sheet in `public/`.
    ids: ['css-sources'],
    plant: (dir) => write(dir, { 'public/extra.css': '.x {\n  color: red;\n}\n' }),
  },
  {
    // A background that no contrast pair holds, and an Elements row that `elements.css` does not implement.
    ids: ['design-pairs', 'design-specs'],
    plant: (dir) => {
      edit(
        dir,
        CARD_CSS,
        '    background-color: var(--color-surface);\n',
        '    background-color: var(--color-brand);\n',
      );
      edit(
        dir,
        'docs/design.md',
        '| `body` | `color` | `--color-text` |\n',
        '| `body` | `color` | `--color-text` |\n| `body` | `outline-color` | `--color-focus` |\n',
      );
    },
  },
  {
    // One value changed by hand in `tokens.css`.
    ids: ['design-tokens'],
    plant: (dir) => edit(dir, 'src/styles/tokens.css', /: [\d.]+rem;/, ': 77.7rem;'),
  },
  {
    // An opening time that is no time of day.
    ids: ['facts-schedule'],
    plant: (dir) => edit(dir, 'schedule.json', '"closes": "22:00"', '"closes": "24:30"'),
  },
  {
    // An original image under `src/` that is wider than 2,560 px, and a photo in `public/`.
    ids: ['images-original', 'images-public'],
    plant: (dir) =>
      write(dir, { 'src/assets/huge.png': pngHeader(3000, 2000), 'public/photo.png': pngHeader(800, 600) }),
  },
  {
    // `processing` without `previews`.
    ids: ['legal-processing'],
    plant: (dir) =>
      changeJson<{ processing: string[] }>(dir, 'astro-kit.json', (settings) => {
        settings.processing = settings.processing.filter((key) => key !== 'previews');
      }),
  },
  {
    // A redirect source with a query string.
    ids: ['routes-redirects'],
    plant: (dir) =>
      write(dir, { 'redirects.json': `${JSON.stringify([{ from: '/angebot/?id=7', to: '/' }], null, 2)}\n` }),
  },
];

test('M9 planted set config: the build stops in the config stage with exactly the ids of its list', () => {
  assert.deepEqual([...new Set(CONFIG_PLANTS.flatMap(({ ids }) => ids))].sort(), CONFIG_SET);
  const dir = siteCase('planted-config', (folder) => {
    for (const { plant } of CONFIG_PLANTS) plant(folder);
  });
  const result = run(dir, 'build');
  assert.equal(result.killed, undefined, tail(result));
  assert.deepEqual(result.ids, CONFIG_SET, tail(result));
  assert.equal(result.status, 1, tail(result));
  assert.deepEqual(passedLine(result), NOT_PASSED, tail(result));
  // The build stopped in `astro:config:setup`: Astro built no page.
  assert.doesNotMatch(result.output, /generating static routes|\[build\] Complete!/i, tail(result));
});

// The design set

test('M5 planted set design: a color value that the format refuses gives design-format', () => {
  const dir = siteCase('planted-design', (folder) => {
    // design-format: `color-mix()` is no color value of 7.4. It is one cell of one Color row, the smallest value that
    // the format refuses. The other design rules run only when the format passes.
    edit(
      folder,
      'docs/design.md',
      '| `--color-glow` | `#f7dfb9` |',
      '| `--color-glow` | `color-mix(in srgb, #e9bd6b 40%, #fbf7f0)` |',
    );
  });
  // A case that changes docs/design.md runs `tokens` first (14.2). It refuses the document and writes nothing.
  const before = read(dir, 'src/styles/tokens.css');
  const tokens = run(dir, 'tokens');
  assert.deepEqual(tokens.ids, ['design-format'], tail(tokens));
  assert.equal(tokens.status, 1, tail(tokens));
  assert.deepEqual(passedLine(tokens), NOT_PASSED, tail(tokens));
  assert.equal(read(dir, 'src/styles/tokens.css'), before, 'tokens wrote tokens.css from a refused docs/design.md');

  const result = run(dir, 'build');
  assert.deepEqual(result.ids, ['design-format'], tail(result));
  assert.equal(result.status, 1, tail(result));
  assert.deepEqual(passedLine(result), NOT_PASSED, tail(result));
});

// The modes set

/**
 * `docs/design.md` without the theme `light-contrast`: its row of `## Themes` and its column of `## Color`. It
 * throws when a Color row has not the six cells of the site's table.
 */
function withoutLightContrast(design: string): string {
  let section = '';
  const out: string[] = [];
  for (const line of design.split('\n')) {
    if (line.startsWith('## ')) section = line;
    if (section === '## Themes' && line.startsWith('| light-contrast |')) continue;
    if (section === '## Color' && line.startsWith('|')) {
      // The cells between the pipes: Token, light, dark, light-contrast, dark-contrast, Use.
      const cells = line.split('|');
      if (cells.length !== 8) throw new Error(`a Color row without six cells: ${line}`);
      cells.splice(4, 1);
      out.push(cells.join('|'));
      continue;
    }
    out.push(line);
  }
  return out.join('\n');
}

test('M5 planted set modes: a missing contrast theme and a mode query in a component give modes-media and modes-themes', () => {
  const dir = siteCase('planted-modes', (folder) => {
    // modes-themes: `light-contrast` goes from docs/design.md while `modes.contrast` stays on, so the contrast option
    // has no theme for the light side. `dark-contrast` still has `dark`, so `design-format` passes.
    write(folder, { 'docs/design.md': withoutLightContrast(read(folder, 'docs/design.md')) });

    // modes-media: a `prefers-color-scheme` query in a component file, which the mode switch cannot change. The
    // block sets only a token of the right family.
    edit(
      folder,
      'src/styles/components/feature-card.css',
      '    --stack-gap: var(--space-3);\n',
      '    --stack-gap: var(--space-3);\n\n    @media (prefers-color-scheme: dark) {\n      box-shadow: var(--shadow-overlay);\n    }\n',
    );
  });
  const design = read(dir, 'docs/design.md');
  assert.ok(!design.includes('light-contrast'), 'docs/design.md still names light-contrast');
  assert.ok(design.includes('| `--color-page` | `#fbf7f0` | `#191512` | `#000000` |'), 'the Color table lost a theme');

  // The theme list changed, so `tokens` runs first (14.2, Rendered files). The rendering uses the mode options, so
  // `tokens` refuses the themes with `modes-themes` and writes nothing. `design-tokens` runs only when
  // `modes-themes` passes (6.1, step 9), so the old tokens.css gives no finding.
  const before = read(dir, 'src/styles/tokens.css');
  const tokens = run(dir, 'tokens');
  assert.deepEqual(tokens.ids, ['modes-themes'], tail(tokens));
  assert.equal(tokens.status, 1, tail(tokens));
  assert.deepEqual(passedLine(tokens), NOT_PASSED, tail(tokens));
  assert.equal(
    read(dir, 'src/styles/tokens.css'),
    before,
    'tokens wrote tokens.css for themes that the options refuse',
  );

  const result = run(dir, 'build');
  assert.deepEqual(result.ids, ['modes-media', 'modes-themes'], tail(result));
  assert.equal(result.status, 1, tail(result));
  assert.deepEqual(passedLine(result), NOT_PASSED, tail(result));
});

// The five typical agent mistakes

/** Each mistake: what the agent did, the change to a case folder, and the one id that `build` must give. */
interface Mistake {
  name: string;
  change(dir: string): void;
  id: string;
}

const MISTAKES: readonly Mistake[] = [
  {
    // The agent copies the light hex value of `--color-muted` from docs/design.md in place of the token. No design
    // row names this declaration, so only the value rule reads it.
    name: 'a raw color in a component file',
    change(dir) {
      const note = '      font-size: var(--text-s);\n      color: ';
      edit(dir, 'src/styles/components/price-list.css', `${note}var(--color-muted);`, `${note}#55493f;`);
    },
    id: 'css-literal',
  },
  {
    // The agent makes the contact card a little tighter with a pixel value in place of a spacing token.
    name: 'padding: 13px in a component file',
    change(dir) {
      edit(dir, 'src/styles/components/contact-card.css', 'padding: var(--space-5);', 'padding: 13px;');
    },
    id: 'css-literal',
  },
  {
    // The agent centres the main action of the contact page with a utility class that no CSS file defines.
    name: 'an undeclared class on a page',
    change(dir) {
      const action = '<a class="button" href={mailHref(site.email)}>';
      edit(dir, 'src/pages/kontakt.astro', `<p>${action}`, `<p class="text-center">${action}`);
    },
    id: 'css-classes',
  },
  {
    // The agent gives the component a scoped style, as Astro allows, in place of a change to its CSS file.
    name: 'a <style> in an .astro file',
    change(dir) {
      const file = 'src/components/ContactCard.astro';
      const style = '<style>\n  .contact-card {\n    gap: var(--space-3);\n  }\n</style>\n';
      write(dir, { [file]: `${read(dir, file)}\n${style}` });
    },
    id: 'css-sources',
  },
  {
    // The agent picks a width in pixels for the wide panel of the mode switch, in place of the `medium` breakpoint.
    name: 'a 777px media query in a component file',
    change(dir) {
      edit(dir, 'src/styles/components/mode-switch.css', '@media (width >= 48rem)', '@media (width >= 777px)');
    },
    id: 'css-media',
  },
];

for (const [index, mistake] of MISTAKES.entries()) {
  test(`M5 mistake: ${mistake.name} gives ${mistake.id}`, () => {
    const dir = siteCase(`mistake-${index + 1}`, mistake.change);
    const result = run(dir, 'build');
    assert.deepEqual(result.ids, [mistake.id], tail(result));
    assert.equal(result.status, 1, tail(result));
    assert.deepEqual(passedLine(result), NOT_PASSED, tail(result));
  });
}

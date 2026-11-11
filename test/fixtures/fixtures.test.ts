/**
 * Fixture sites, built with the kit's dist. Run `npm run build` first.
 * Variants must pass. Each bad site must report exactly its expected rule ids. The scale site records sizes.
 */
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { crc32, deflateSync, zstdCompressSync } from 'node:zlib';
import { hashBrief } from '../../src/manifest.ts';
import type { KitOptions } from '../../src/options.ts';

const KIT = fileURLToPath(new URL('../../', import.meta.url));
const GOOD = join(KIT, 'test/fixtures/good');
const WORK = join(KIT, 'test/fixtures/.work');
const CLI = join(KIT, 'dist/cli.js');
const SKIP = new Set(['dist', '.astro', 'node_modules']);

assert.ok(existsSync(CLI), 'run `npm run build` before the fixture tests');

function run(dir: string, args: string[], env: Record<string, string> = {}) {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, ASTRO_TELEMETRY_DISABLED: '1', GITHUB_STEP_SUMMARY: '', KIT_DRAFTS: '', ...env },
    timeout: 600_000,
  });
  const out = `${r.stdout}\n${r.stderr}`;
  return { status: r.status, out, ids: [...new Set([...out.matchAll(/✗ \[([a-z0-9-]+)\]/g)].map((m) => m[1]))].sort() };
}

/** A fresh copy of the good site, or of a site written by init with the given features (and host and locales). */
function site(name: string, features: string[] = [], init = { site: 'https://example.ch', locales: 'de,fr' }): string {
  const dir = join(WORK, name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  if (features.length) {
    const r = run(dir, ['init', '--site', init.site, '--locales', init.locales, '--features', features.join(',')]);
    assert.equal(r.status, 0, r.out);
    cpSync(join(GOOD, 'src/assets/og.jpg'), join(dir, 'src/assets/og.jpg'));
  } else {
    cpSync(GOOD, dir, { recursive: true, filter: (src) => !SKIP.has(src.split(/[\\/]/).pop() ?? '') });
  }
  return dir;
}

function write(dir: string, file: string, text: string | Buffer | ((old: string) => string)): void {
  const path = join(dir, file);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, typeof text === 'function' ? text(readFileSync(path, 'utf8')) : text);
}

function json(dir: string, file: string, change: (data: Record<string, unknown>) => void): void {
  write(dir, file, (old) => {
    const data = JSON.parse(old) as Record<string, unknown>;
    change(data);
    return `${JSON.stringify(data, null, 2)}\n`;
  });
}

const options = (dir: string, change: (o: KitOptions) => void) =>
  json(dir, 'astro-kit.json', (data) => change(data as unknown as KitOptions));

function build(dir: string) {
  const r = run(dir, ['build']);
  assert.equal(r.status, 0, r.out);
  return r;
}

const browser = (dir: string) => run(dir, ['test', '--all']);

/** A PNG header with the given size; enough for the kit's header reader. */
function png(width: number, height: number): Buffer {
  const b = Buffer.alloc(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  b.writeUInt32BE(width, 16);
  b.writeUInt32BE(height, 20);
  return b;
}

type Sharp = (
  input: Buffer,
  options: { raw: { width: number; height: number; channels: 3 } },
) => { jpeg(options: { quality: number }): { toFile(path: string): Promise<unknown> } };

/**
 * Camera-like photos from a fixed seed, so the repository holds no binaries: noise over a base colour, about as
 * detailed as a real photo. sharp comes with Astro's image pipeline; the kit adds no dependency for it.
 */
async function photos(dir: string): Promise<void> {
  const sharp = createRequire(join(KIT, 'node_modules/astro/package.json'))('sharp') as Sharp;
  const list: [string, number, number, [number, number, number]][] = [
    ['hotel-aussen.jpg', 2400, 1600, [60, 110, 70]],
    ['doppelzimmer.jpg', 2000, 1333, [150, 110, 70]],
    ['restaurant.jpg', 2000, 1333, [120, 80, 50]],
    // Its 1200×630 share image is 157 KB at JPEG quality 80, over the 150 KB head-og limit; 134 KB at the kit's 70.
    ['og.jpg', 1200, 630, [60, 110, 70]],
  ];
  mkdirSync(join(dir, 'src/assets'), { recursive: true });
  for (const [name, width, height, [r, g, b]] of list) {
    let seed = 7;
    const rand = () => {
      seed ^= seed << 13;
      seed >>>= 0;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      seed >>>= 0;
      return seed / 4294967296;
    };
    const px = Buffer.alloc(width * height * 3);
    for (let i = 0; i < px.length; i += 3) {
      const n = (rand() + rand() + rand() - 1.5) * 18;
      px[i] = Math.max(0, Math.min(255, r + n));
      px[i + 1] = Math.max(0, Math.min(255, g + n));
      px[i + 2] = Math.max(0, Math.min(255, b + n));
    }
    await sharp(px, { raw: { width, height, channels: 3 } })
      .jpeg({ quality: 82 })
      .toFile(join(dir, 'src/assets', name));
  }
}

// ── variants that must pass ────────────────────────────────────────────────

test('good: build and browser checks pass', () => {
  const dir = site('good');
  build(dir);
  const t = browser(dir);
  assert.equal(t.status, 0, t.out);
});

test('hotel: a realistic three-locale site with forms passes build, check and the browser checks', async () => {
  // Written as a hotel's editor would: a brand h1, "Restaurant" in every locale, Swiss prices ("CHF 180.–"),
  // two phones and two emails, photos in Markdown, a PDF menu, closures, an English guest quote on every page.
  const dir = site('hotel', ['forms'], { site: 'https://laerchenwald.example', locales: 'de,fr,en' });
  cpSync(join(KIT, 'test/fixtures/hotel'), dir, { recursive: true });
  await photos(dir);
  build(dir);
  // After a build, the adapter's .wrangler/ output must not fail Biome.
  const checked = run(dir, ['check']);
  assert.equal(checked.status, 0, checked.out);
  const home = readFileSync(join(dir, 'dist/client/index.html'), 'utf8');
  assert.match(home, /<img[^>]*fetchpriority="high"[^>]*hotel-aussen/);
  const t = browser(dir);
  assert.equal(t.status, 0, t.out);
});

test('forms: the adapter runs, the contact page posts to /api/contact/', () => {
  const dir = site('forms', ['forms']);
  build(dir);
  const headers = readFileSync(join(dir, 'dist/client/_headers'), 'utf8');
  assert.equal(headers.match(/^\/_astro\/\*$/gm)?.length, 1, headers);
  assert.match(readFileSync(join(dir, 'dist/client/kontakt/index.html'), 'utf8'), /action="\/api\/contact\/"/);
  assert.ok(existsSync(join(dir, 'dist/server/entry.mjs')));
  const t = browser(dir);
  assert.equal(t.status, 0, t.out);
});

test('islands: the Solid hydration hash is in the CSP and Trusted Types is off', () => {
  const dir = site('islands', ['islands']);
  cpSync(join(KIT, 'test/fixtures/islands'), dir, { recursive: true });
  build(dir);
  const html = readFileSync(join(dir, 'dist/index.html'), 'utf8');
  assert.match(html, /<astro-island/);
  assert.doesNotMatch(readFileSync(join(dir, 'dist/_headers'), 'utf8'), /trusted-types/);
  const t = browser(dir);
  assert.equal(t.status, 0, t.out);
});

test('prefetch: both methods on; HTML gets max-age=120 and assets detach it', () => {
  const dir = site('prefetch-both');
  options(dir, (o) => {
    o.prefetch = { speculationRules: true, astroPrefetch: true };
  });
  build(dir);
  const headers = readFileSync(join(dir, 'dist/_headers'), 'utf8');
  assert.match(headers, /^\/\*\n(?: {2}.*\n)* {2}Cache-Control: public, max-age=120$/m);
  assert.match(headers, /^\/_astro\/\*\n {2}! Cache-Control\n {2}Cache-Control: public, max-age=31536000, immutable$/m);
  assert.ok(headers.indexOf('/*\n') < headers.indexOf('/_astro/*'));
  const t = browser(dir);
  assert.equal(t.status, 0, t.out);
});

test('prefetch: Astro prefetch alone is seen and reused on click', () => {
  const dir = site('prefetch-astro');
  options(dir, (o) => {
    o.prefetch = { speculationRules: false, astroPrefetch: true };
  });
  build(dir);
  assert.doesNotMatch(readFileSync(join(dir, 'dist/index.html'), 'utf8'), /speculationrules/);
  const t = browser(dir);
  assert.equal(t.status, 0, t.out);
});

test('scripts: a bundled script builds, and Trusted Types is off', () => {
  const dir = site('scripts');
  options(dir, (o) => {
    o.features.scripts = true;
  });
  write(
    dir,
    'src/pages/[...path].astro',
    (old) => `${old}\n<script>\n  document.documentElement.dataset.ready = '';\n</script>\n`,
  );
  build(dir);
  assert.match(readFileSync(join(dir, 'dist/index.html'), 'utf8'), /<script type="module"/);
  assert.doesNotMatch(readFileSync(join(dir, 'dist/_headers'), 'utf8'), /trusted-types/);
});

test('check: a config finding fails the fast check, not only the build', () => {
  const dir = site('check-config');
  write(dir, 'src/content.config.ts', (old) => `// @ts-ignore\n${old}`);
  const r = run(dir, ['check']);
  assert.notEqual(r.status, 0);
  assert.deepEqual(r.ids, ['config-suppression'], r.out);
});

test('dev: a changed title and a new page appear without a manual restart', async () => {
  const dir = site('dev');
  const port = 43210 + Math.floor(Math.random() * 1000);
  const dev = spawn(join(KIT, 'node_modules/.bin/astro'), ['dev', '--port', String(port), '--host', '127.0.0.1'], {
    cwd: dir,
    env: { ...process.env, ASTRO_TELEMETRY_DISABLED: '1' },
    stdio: 'ignore',
  });
  const page = async (path: string) => {
    const r = await fetch(`http://127.0.0.1:${port}${path}`).catch(() => undefined);
    return r ? { status: r.status, html: await r.text() } : { status: 0, html: '' };
  };
  const until = async (ok: () => Promise<boolean>, what: string) => {
    for (let i = 0; i < 120; i++) {
      if (await ok()) return;
      await new Promise((r) => setTimeout(r, 500));
    }
    assert.fail(`dev never showed ${what}`);
  };
  try {
    await until(async () => (await page('/leistungen/')).status === 200, 'the services page');
    write(dir, 'src/content/pages/de/services.md', (old) =>
      old.replace('title: "Leistungen von Example für KMU"', 'title: "Neue Leistungen von Example für KMU"'),
    );
    await until(async () => (await page('/leistungen/')).html.includes('Neue Leistungen von Example'), 'the new title');
    write(
      dir,
      'src/content/pages/de/team.md',
      '---\nslug: team\ntitle: "Das Team von Example in Zürich"\ndescription: "Wer bei Example arbeitet, was jede Person tut und wie Sie das Team direkt erreichen."\nbrief:\n  intent: "Introduce the team and how to reach it."\n  audience: "Prospective clients"\n  message: "A small team you can reach directly."\n  cta: "Contact us"\nmissing: [fr]\n---\n\n# Das Team\n\nWir sind ein kleines Team.\n',
    );
    await until(async () => (await page('/team/')).status === 200, 'the new page');
  } finally {
    dev.kill();
  }
});

// ── bad sites: exactly these rule ids ─────────────────────────────────────

test('bad config: config:setup reports every planted config rule', () => {
  const dir = site('bad-config');
  write(dir, 'biome.json', (old) => old.replace('"extends"', '"vcs": { "enabled": false },\n  "extends"'));
  write(dir, 'astro.config.mjs', (old) =>
    old.replace(
      'integrations: [astroKit()]',
      "integrations: [astroKit()], i18n: { defaultLocale: 'de', locales: ['de', 'fr'] }, experimental: { clientPrerender: true }",
    ),
  );
  json(dir, 'package.json', (p) => {
    p.overrides = { yaml: '2.9.1' };
    p.dependencies = { ...(p.dependencies as object), lodash: '4.17.21', 'left-pad': 'github:stevemao/left-pad' };
  });
  write(dir, 'public/robots.txt', 'User-agent: *\n');
  write(dir, 'public/team.png', png(10, 10));
  write(dir, 'src/assets/huge.png', png(3000, 2000));
  write(dir, 'wrangler.jsonc', (old) => old.replace('"workers_dev": false', '"workers_dev": true'));
  write(
    dir,
    'src/content/schedule.json',
    '{ "openingHours": [{ "days": ["Mo"], "opens": "25:00", "closes": "17:00" }] }\n',
  );
  write(dir, 'src/content/messages/de.json', '{ "extra": "Nur auf Deutsch" }\n');
  write(
    dir,
    'src/components/Price.astro',
    "---\n// @ts-ignore\nconst p = new Intl.NumberFormat('de-CH').format(1);\nimport { ClientRouter } from 'astro:transitions';\n---\n<p style=\"color: red\" data-astro-prefetch>{p}</p>\n<script is:inline>1</script>\n<style is:global>p { margin: 0 }</style>\n",
  );
  write(
    dir,
    'src/content/pages/de/bad.md',
    '---\nslug: Bad_Slug\ntitle: "Eine Seite mit falschem Slug"\ndescription: "Diese Seite hat einen Slug mit Grossbuchstaben und einem Unterstrich, das ist verboten."\nbrief:\n  intent: "Show a slug that breaks the rule."\n  audience: "The kit tests"\n  message: "Slugs use a to z, digits and hyphens."\n  cta: "None"\nmissing: [fr]\n---\n\n# Falscher Slug\n',
  );
  write(
    dir,
    'src/content/pages/de/twin.md',
    (() => {
      const t = readFileSync(join(dir, 'src/content/pages/de/services.md'), 'utf8');
      return t.replace('missing: []', '');
    })(),
  );
  write(dir, 'src/content/pages/fr/services.md', (old) =>
    old.replace(/transcreatedFrom: "[0-9a-f]+"/, 'transcreatedFrom: "000000000000"'),
  );
  const r = run(dir, ['build']);
  assert.notEqual(r.status, 0);
  assert.deepEqual(
    r.ids,
    [
      'config-dep-allowlist',
      'config-dep-spec',
      'config-experimental',
      'config-i18n',
      'config-imports',
      'config-overrides',
      'config-public-shadow',
      'config-shim',
      'config-suppression',
      'config-wrangler',
      'content-intl',
      'content-messages',
      'content-stale',
      'csp-hash',
      'css-banned',
      'facts-schedule',
      'images-original',
      'images-public',
      'js-prefetch-attr',
      'js-script',
      'routes-duplicate',
      'routes-slug',
      'routes-translation',
    ],
    r.out,
  );
});

test('bad route: an undeclared on-demand route fails routes-on-demand', () => {
  const dir = site('bad-route');
  write(
    dir,
    'src/pages/api/live.ts',
    "export const prerender = false;\nexport const GET = () => new Response('live');\n",
  );
  const r = run(dir, ['build']);
  assert.notEqual(r.status, 0);
  assert.deepEqual(r.ids, ['routes-on-demand']);
});

test('bad build: the dist audits report every planted build rule', () => {
  const dir = site('bad-build');
  write(
    dir,
    'src/content/pages/de/services.md',
    (old) =>
      `${old}\n#### Zu tief\n\n<a href="/gibt-es-nicht/">mehr</a> <a href="/" target="_blank">Startseite</a> <a href="https://cdn.example.org/x.css">Stil</a>\n\n<img src="https://cdn.example.org/a.jpg" alt="Fremdbild">\n\n<script>console.log(1)</script>\n\n<svg><path d="M0 0h1"/></svg>\n\nTelefon: +41 44 000 00 00, E-Mail: falsch@example.ch\n`,
  );
  write(dir, 'src/content/pages/fr/home.md', (old) => old.replace(/^title: .*$/m, 'title: "Willkommen bei Example"'));
  const r = run(dir, ['build']);
  assert.notEqual(r.status, 0);
  assert.deepEqual(
    r.ids,
    [
      'content-copied',
      'content-stale',
      'csp-hash',
      'facts-value',
      'headings-order',
      'images-attrs',
      'images-src',
      'js-script',
      'links-generic',
      'links-resolve',
      'links-target-blank',
      'origins-third-party',
      'svg-name',
    ],
    r.out,
  );
});

/** A PNG of random pixels: it barely compresses, so it arrives late under the throttled network. */
function noisePng(width: number, height: number): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  const rows = Buffer.alloc((width * 3 + 1) * height);
  for (let i = 0; i < rows.length; i++) rows[i] = i % (width * 3 + 1) === 0 ? 0 : (i * 2654435761) >>> 24;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(rows)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Plants go into the built dist, so the build audits cannot stop the run first. */
function plantDist(dir: string, page: string, change: (html: string) => string): void {
  write(dir, `dist/${page}`, change);
}

test('bad browser: the browser checks report every planted rule', () => {
  const dir = site('bad-browser');
  build(dir);
  const og = readdirSync(join(dir, 'dist/_astro')).find((f) => f.startsWith('og.'));
  write(
    dir,
    'dist/_astro/bad.css',
    [
      '@layer theme { :root { --text: oklch(80% 0 0); } }',
      ':focus-visible { outline: 1px dotted; }',
      '.tiny { min-block-size: 0; min-inline-size: 0; padding: 0; border: none; }',
      '.wide { inline-size: 500px; block-size: 10px; }',
      '.clip { block-size: 1.7em; overflow: hidden; }',
      '.overlay { position: fixed; inset: auto 0 0 0; block-size: 120px; background: var(--bg); z-index: 5; }',
      '.small { inline-size: 120px; }',
      '.noshow h1 { visibility: hidden; }',
    ].join('\n'),
  );
  write(dir, 'dist/_astro/slow.png', noisePng(400, 300));
  const css = '<link rel="stylesheet" href="/_astro/bad.css"></head>';
  plantDist(dir, 'index.html', (html) =>
    html
      .replace('</head>', css)
      .replace(
        '<main id="main" tabindex="-1">',
        `<main id="main" tabindex="-1"><img src="/_astro/slow.png" alt="Rauschen"><img src="/_astro/${og}" width="1200" height="630" alt="Gross" loading="lazy"><img class="small" src="/_astro/${og}" width="1200" height="630" alt="Klein"><button class="tiny">x</button><div class="wide"></div><p class="clip">Dieser Absatz hat eine feste Höhe und wird unter dem Textabstand abgeschnitten, sobald er mehr Zeilen braucht.</p>`,
      )
      .replace('</footer>', '<a href="/sitemap/">Verdeckt</a></footer><div class="overlay"></div>')
      .replace('"eagerness":"moderate"', '"eagerness":"conservative"'),
  );
  plantDist(dir, 'impressum/index.html', (html) =>
    html.replace('</head>', css).replace('<body>', '<body class="noshow">'),
  );
  const t = browser(dir);
  assert.notEqual(t.status, 0);
  assert.deepEqual(
    t.ids,
    [
      'a11y-axe',
      'a11y-focus',
      'a11y-forced-colors',
      'a11y-keyboard',
      'a11y-no-js',
      'a11y-reflow',
      'a11y-spacing',
      'a11y-targets',
      'contrast-pairs',
      'perf-cls',
      'perf-image-oversize',
      'perf-lcp-priority',
      'perf-prerender',
    ],
    t.out,
  );
});

test('bad prefetch: no-store HTML defeats Astro prefetch and the back/forward cache', () => {
  const dir = site('bad-prefetch');
  options(dir, (o) => {
    o.prefetch = { speculationRules: false, astroPrefetch: true };
  });
  build(dir);
  write(dir, 'dist/_headers', (old) => `${old}\n/*\n  Cache-Control: no-store\n`);
  const t = browser(dir);
  assert.notEqual(t.status, 0);
  assert.deepEqual(t.ids, ['perf-bfcache', 'perf-prefetch'], t.out);
});

// ── scale: 100 page ids × 5 locales ────────────────────────────────────────

const LOCALES = [
  {
    code: 'de',
    tag: 'de-CH',
    name: 'Deutsch',
    word: 'Thema',
    text: 'Hier steht, was wir für Sie tun und wie Sie uns erreichen.',
  },
  {
    code: 'fr',
    tag: 'fr-CH',
    name: 'Français',
    word: 'Sujet',
    text: 'Vous trouvez ici ce que nous faisons pour vous et comment nous joindre.',
  },
  {
    code: 'it',
    tag: 'it-CH',
    name: 'Italiano',
    word: 'Tema',
    text: 'Qui trovate che cosa facciamo per voi e come raggiungerci.',
  },
  {
    code: 'en',
    tag: 'en-GB',
    name: 'English',
    word: 'Topic',
    text: 'Here you find what we do for you and how to reach us.',
  },
  {
    code: 'rm',
    tag: 'rm-CH',
    name: 'Rumantsch',
    word: 'Tema',
    text: 'Qua chattais Vus tge che nus faschain per Vus e co contactar nus.',
  },
];

const RM_MESSAGES = {
  skip: 'Siglir al cuntegn',
  menu: 'Menu',
  nav: 'Navigaziun',
  languages: 'Linguas',
  required: 'obligatoric',
  optional: 'facultativ',
  sentTitle: 'Messadi tramess',
  sentBody: 'Grazia fitg. Nus respundain uschè svelt sco pussaivel.',
  notSentTitle: 'Messadi betg tramess',
  notSentBody: 'Empruvai pli tard u scrivai directamain a nus:',
  contact: 'Contact',
  imprint: 'Impressum',
  privacy: 'Protecziun da datas',
  sitemap: 'Survista da la pagina',
  name: 'Num',
  email: 'E-mail',
  message: 'Messadi',
  send: 'Trametter',
  notFound: 'Pagina betg chattada',
  home: 'A la pagina principala',
};

test('scale: 500 pages build, and the sizes are recorded', (t) => {
  const dir = join(WORK, 'scale');
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const init = run(dir, ['init', '--site', 'https://example.ch', '--locales', LOCALES.map((l) => l.code).join(',')]);
  assert.equal(init.status, 0, init.out);
  cpSync(join(GOOD, 'src/assets/og.jpg'), join(dir, 'src/assets/og.jpg'));
  // The kit has no Romansh UI text, so the site brings every key (content-messages).
  write(dir, 'src/content/messages/rm.json', `${JSON.stringify(RM_MESSAGES, null, 2)}\n`);
  for (let i = 1; i <= 96; i++) {
    const brief = {
      intent: `Explain topic ${i} to a visitor.`,
      audience: 'Prospective clients',
      message: `Topic ${i} matters to your firm.`,
      cta: 'Contact us',
    };
    for (const l of LOCALES) {
      const head =
        l.code === 'de'
          ? `brief:\n  intent: "${brief.intent}"\n  audience: "${brief.audience}"\n  message: "${brief.message}"\n  cta: "${brief.cta}"`
          : `transcreatedFrom: "${hashBrief(brief)}"`;
      write(
        dir,
        `src/content/pages/${l.code}/topic-${i}.md`,
        `---\nslug: ${l.word.toLowerCase()}-${i}\ntitle: "${l.word} ${i} – Example (${l.name})"\ndescription: "${l.word} ${i}: ${l.text}"\n${head}\n---\n\n# ${l.word} ${i}\n\n${l.text}\n`,
      );
    }
  }
  const started = Date.now();
  const r = run(dir, ['build']);
  const seconds = (Date.now() - started) / 1000;
  assert.equal(r.status, 0, r.out.slice(-4000));
  const pages = readdirSync(join(dir, 'dist'), { recursive: true }).filter((f) => String(f).endsWith('.html'));
  assert.ok(pages.length >= 500, `${pages.length} pages`);
  const home = readFileSync(join(dir, 'dist/index.html'), 'utf8');
  const csp = /<meta http-equiv="content-security-policy" content="([^"]*)"/i.exec(home)?.[1] ?? '';
  const head = home.slice(0, home.indexOf('</head>'));
  const zstd = (s: string) => zstdCompressSync(Buffer.from(s)).length;
  const bytes = pages.reduce((n, f) => n + statSync(join(dir, 'dist', String(f))).size, 0);
  t.diagnostic(
    `${pages.length} pages in ${seconds.toFixed(1)} s; CSP ${csp.length} B; home head ${head.length} B (${zstd(head)} B zstd); HTML ${Math.round(bytes / pages.length)} B per page`,
  );
});

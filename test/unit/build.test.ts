import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { type ContextInput, listDist, loadBuild, memoryContext, parseHtml } from '../../src/build.ts';
import { type BuildContext, type Design, readText } from '../../src/context.ts';
import { SPECULATION_JSON } from '../../src/csp.ts';
import { injectBuild } from '../../src/inject.ts';
import { modeScript } from '../../src/modes.ts';
import { effectiveLimits, LIMITS, type Options } from '../../src/options.ts';
import type { RedirectRow } from '../../src/redirects.ts';
import { Report } from '../../src/registry.ts';
import { type Files, factsOf, inTemp, optionsOf, TWO_LOCALES } from './fixtures.ts';

// parseHtml

test('parseHtml drops comments', () => {
  assert.equal(parseHtml('<p>a<!-- a comment -->b</p><!-- another -->').toString(), '<p>ab</p>');
});

/** An element whose text stays raw, with a text that would read as markup or as an entity elsewhere. */
const RAW_TEXTS: readonly [tag: string, text: string][] = [
  ['script', 'if (a < b && c > d) document.title = "<b>&amp;</b>";'],
  ['style', '.a > .b::after { content: "<i>&lt;</i>"; }'],
  ['noscript', '<img src="/a.png" alt=""> &amp; <b>text</b>'],
  ['pre', 'a <b>bold</b> &amp; text'],
];

test('the text of script, style, noscript and pre stays raw, and nothing inside becomes an element', () => {
  const read = (tag: string, text: string): [string | undefined, number] => {
    const root = parseHtml(`<div><${tag}>${text}</${tag}><b>after</b></div>`);
    return [root.querySelector(tag)?.rawText, root.querySelectorAll('b, i, img').length];
  };
  assert.deepEqual(
    RAW_TEXTS.map(([tag, text]) => [tag, ...read(tag, text)]),
    RAW_TEXTS.map(([tag, text]) => [tag, text, 1]),
  );
});

test('parseHtml reads the attributes and the order of the elements of a head', () => {
  const root = parseHtml(
    '<!DOCTYPE html><html lang="fr-CH"><head><meta charset="utf-8"><title>Été</title><link rel="canonical" href="https://example.ch/fr/"></head><body></body></html>',
  );
  assert.equal(root.querySelector('html')?.getAttribute('lang'), 'fr-CH');
  assert.equal(root.querySelector('link[rel~=canonical]')?.getAttribute('href'), 'https://example.ch/fr/');
  assert.deepEqual(
    root.querySelectorAll('head > *').map((element) => element.rawTagName),
    ['meta', 'title', 'link'],
  );
});

// listDist

test('listDist gives every file under a folder: sorted as whole paths, with forward slashes', () => {
  const files = inTemp(
    {
      'dist/index.html': '',
      'dist/a0.txt': '',
      'dist/a-b.txt': '',
      'dist/a/b.txt': '',
      'dist/a/c/d/index.html': '',
      'dist/_astro/page.js': '',
      'dist/.well-known/security.txt': '',
      'dist/Z.txt': '',
      'outside.txt': '',
    },
    (root) => listDist(join(root, 'dist')),
  );
  assert.deepEqual(files, [
    '.well-known/security.txt',
    'Z.txt',
    '_astro/page.js',
    'a-b.txt',
    'a/b.txt',
    'a/c/d/index.html',
    'a0.txt',
    'index.html',
  ]);
});

test('listDist of a folder that does not exist, and of an empty folder, is an empty list', () => {
  const lists = inTemp({ 'dist/a/b.txt': '' }, (root) => [
    listDist(join(root, 'missing')),
    listDist(join(root, 'dist/a/b.txt/c')),
    listDist(join(root, 'dist/a')),
  ]);
  assert.deepEqual(lists, [[], [], ['b.txt']]);
});

// A context

const OPTIONS: Options = optionsOf(TWO_LOCALES);

const DESIGN: Design = {
  themes: ['light'],
  colors: [{ name: '--color-text', values: { light: '#222222' }, line: 12 }],
  tokens: [{ name: '--space-2', family: 'space', value: '0.5rem', line: 20 }],
  helpers: [],
  breakpoints: [],
  pairs: [{ foreground: '--color-text', background: '--color-page', role: 'text', for: 'body', line: 50 }],
  elements: [],
  components: [],
};

const NOW = new Date('2026-11-13T10:00:00.000Z');

/** The input of a context. Each test names the client directory, and the values that it looks at. */
const inputOf = (dist: string, more: Partial<ContextInput> = {}): ContextInput => ({
  root: '/project',
  dist,
  options: OPTIONS,
  kitVersion: '1.2.3',
  facts: factsOf(),
  redirects: [],
  design: DESIGN,
  report: new Report(),
  now: NOW,
  ...more,
});

/**
 * Runs `use` on the context of a client directory on disk, and on the context of the same files in memory. The
 * second argument is the client directory on disk, or `undefined` for the context in memory.
 */
function onBoth<Result>(files: Files, use: (ctx: BuildContext, dist?: string) => Result): [Result, Result] {
  const onDisk = Object.fromEntries(Object.entries(files).map(([file, content]) => [`dist/${file}`, content]));
  const disk = inTemp({ ...onDisk, 'secret.txt': 'outside the client directory' }, (root) => {
    const dist = join(root, 'dist');
    return use(loadBuild(inputOf(dist, { root })), dist);
  });
  return [disk, use(memoryContext({ ...inputOf('/project/dist'), files }))];
}

const html = (lang: string, title: string, more = ''): string =>
  `<!DOCTYPE html><html lang="${lang}"><head><title>${title}</title>${more}</head><body><h1>${title}</h1></body></html>`;

const PDF = Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x00, 0xff, 0xfe, 0x0d, 0x0a]);

const HOME_STYLES = '<style>@layer reset{a>b{color:red}}</style><style>.a::after{content:"&amp;<i>"}</style>';

/**
 * A client directory. The order of the files, the order of the page paths and the order below all differ. Two pages
 * have a `lang` of another locale than their URL: the locale of a page comes from the URL.
 */
const DIST: Files = {
  'index.html': html('de-CH', 'Start', HOME_STYLES),
  'fr/index.html': html('fr-CH', 'Accueil', '<style>h1{margin:0}</style>'),
  'fr/x/index.html': html('de-CH', 'Été'),
  'fr/404/index.html': html('fr-CH', 'Une page'),
  'france/x/index.html': html('fr-CH', 'Frankreich'),
  'de/x/index.html': html('de-CH', 'Zimmer'),
  '404.html': html('de-CH', 'Nicht gefunden', '<style>h1{color:blue}</style>'),
  '_astro/b.css': '.b{color:blue}',
  '_astro/a.css': '.a::before{content:"ä"}',
  '_astro/page.B1x2.js': 'export {};',
  'styles/print.css': '@media print{a{color:#000}}',
  'leitfaden.pdf': PDF,
  'robots.txt': 'User-agent: *\nAllow: /\n',
};

const DIST_FILES = [
  '404.html',
  '_astro/a.css',
  '_astro/b.css',
  '_astro/page.B1x2.js',
  'de/x/index.html',
  'fr/404/index.html',
  'fr/index.html',
  'fr/x/index.html',
  'france/x/index.html',
  'index.html',
  'leitfaden.pdf',
  'robots.txt',
  'styles/print.css',
];

/** The pages of `DIST`, sorted by path: the file, the path, the locale, whether it is the 404 page, and the title. */
const DIST_PAGES: readonly [file: string, path: string, locale: string, is404: boolean, title: string][] = [
  ['index.html', '/', 'de', false, 'Start'],
  ['404.html', '/404.html', 'de', true, 'Nicht gefunden'],
  ['de/x/index.html', '/de/x/', 'de', false, 'Zimmer'],
  ['fr/index.html', '/fr/', 'fr', false, 'Accueil'],
  ['fr/404/index.html', '/fr/404/', 'fr', false, 'Une page'],
  ['fr/x/index.html', '/fr/x/', 'fr', false, 'Été'],
  ['france/x/index.html', '/france/x/', 'de', false, 'Frankreich'],
];

const DIST_CSS = [
  { kind: 'style', where: '/', text: '@layer reset{a>b{color:red}}' },
  { kind: 'style', where: '/', text: '.a::after{content:"&amp;<i>"}' },
  { kind: 'style', where: '/404.html', text: 'h1{color:blue}' },
  { kind: 'style', where: '/fr/', text: 'h1{margin:0}' },
  { kind: 'file', where: '/_astro/a.css', text: '.a::before{content:"ä"}' },
  { kind: 'file', where: '/_astro/b.css', text: '.b{color:blue}' },
  { kind: 'file', where: '/styles/print.css', text: '@media print{a{color:#000}}' },
];

test('the files of a context are every file of the client directory, sorted', () => {
  const [disk, memory] = onBoth(DIST, (ctx) => ctx.files);
  assert.deepEqual(disk, DIST_FILES);
  assert.deepEqual(memory, DIST_FILES);
});

test('a page is every HTML file: sorted by path, with the locale of its URL, and only /404.html is the 404 page', () => {
  const read = (ctx: BuildContext): unknown[] =>
    ctx.pages.map((page) => [page.file, page.path, page.locale, page.is404, page.root.querySelector('title')?.text]);
  const [disk, memory] = onBoth(DIST, read);
  assert.deepEqual(disk, DIST_PAGES);
  assert.deepEqual(memory, DIST_PAGES);
});

test('a page holds the text of its file and the parsed document of that text', () => {
  const read = (ctx: BuildContext): unknown[] => ctx.pages.map((page) => [page.file, page.html, page.root.toString()]);
  const expected = DIST_PAGES.map(([file]) => [file, DIST[file], parseHtml(String(DIST[file])).toString()]);
  const [disk, memory] = onBoth(DIST, read);
  assert.deepEqual(disk, expected);
  assert.deepEqual(memory, expected);
});

test('the CSS is the raw text of each <style> in page and document order, then each .css file', () => {
  const [disk, memory] = onBoth(DIST, (ctx) => ctx.css);
  assert.deepEqual(disk, DIST_CSS);
  assert.deepEqual(memory, DIST_CSS);
});

test('a file given as bytes and the same file given as text are the same page', () => {
  const text = html('de-CH', 'Gästehaus Zürich', '<style>h1::after{content:"→"}</style>');
  const read = (ctx: BuildContext): unknown[] => [ctx.pages.map((page) => [page.path, page.html]), ctx.css];
  const expected = [[['/', text]], [{ kind: 'style', where: '/', text: 'h1::after{content:"→"}' }]];
  assert.deepEqual(onBoth({ 'index.html': text }, read), [expected, expected]);
  assert.deepEqual(onBoth({ 'index.html': new TextEncoder().encode(text) }, read), [expected, expected]);
});

test('a client directory with no file is a context with no page', () => {
  const read = (ctx: BuildContext): unknown[] => [ctx.files, ctx.pages, ctx.css];
  assert.deepEqual(onBoth({}, read), [
    [[], [], []],
    [[], [], []],
  ]);
  const missing = inTemp({}, (root) => read(loadBuild(inputOf(join(root, 'dist')))));
  assert.deepEqual(missing, [[], [], []]);
});

// read

const bytesOf = (bytes: Uint8Array | undefined): number[] | undefined => (bytes === undefined ? undefined : [...bytes]);

test('read gives the bytes of a file, and undefined for a path that the client directory does not list', () => {
  const read = (ctx: BuildContext): unknown[] => [
    bytesOf(ctx.read('leitfaden.pdf')),
    readText(ctx, 'robots.txt'),
    readText(ctx, '_astro/a.css'),
    readText(ctx, 'fr/x/index.html'),
    ctx.read('missing.txt'),
    ctx.read('/robots.txt'),
    ctx.read('./robots.txt'),
    ctx.read('fr'),
    ctx.read('../secret.txt'),
    ctx.read(''),
  ];
  const expected = [
    [...PDF],
    'User-agent: *\nAllow: /\n',
    '.a::before{content:"ä"}',
    DIST['fr/x/index.html'],
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
  ];
  const [disk, memory] = onBoth(DIST, read);
  assert.deepEqual(disk, expected);
  assert.deepEqual(memory, expected);
});

// write

const HEADERS = '/*\n  X-Content-Type-Options: nosniff\n';
const SECURITY = 'Contact: mailto:security@example.ch\n';
const ROUTES = '/\n/fr/été/\n';

test('write stores a text, creates its folders, and lists the file once and in order', () => {
  const run = (ctx: BuildContext, dist?: string): unknown[] => {
    ctx.write('_headers', 'a first text');
    ctx.write('_kit/routes.txt', ROUTES);
    ctx.write('.well-known/security.txt', SECURITY);
    ctx.write('_headers', HEADERS);
    return [
      ctx.files,
      readText(ctx, '_headers'),
      readText(ctx, '_kit/routes.txt'),
      readText(ctx, '.well-known/security.txt'),
      ctx.pages.length,
      dist === undefined ? undefined : listDist(dist),
      dist === undefined ? undefined : readFileSync(join(dist, '_kit/routes.txt'), 'utf8'),
    ];
  };
  const files = ['.well-known/security.txt', '404.html', '_headers', '_kit/routes.txt', 'index.html'];
  const [disk, memory] = onBoth({ 'index.html': html('de-CH', 'Start'), '404.html': html('de-CH', '404') }, run);
  assert.deepEqual(disk, [files, HEADERS, ROUTES, SECURITY, 2, files, ROUTES]);
  assert.deepEqual(memory, [files, HEADERS, ROUTES, SECURITY, 2, undefined, undefined]);
});

/** Paths that are no file inside the client directory. */
const OUTSIDE = ['../outside.txt', 'a/../../outside.txt', '/outside.txt', 'a//b.txt', './a.txt', 'a\\b.txt', ''];

test('write refuses a path that is not inside the client directory, and writes nothing', () => {
  const run = (ctx: BuildContext, dist?: string): unknown[] => {
    const messages = OUTSIDE.map((file) => {
      try {
        ctx.write(file, 'x');
        return 'written';
      } catch (error) {
        return error instanceof Error ? error.message : 'no error';
      }
    });
    return [messages, ctx.files, dist === undefined ? undefined : listDist(join(dist, '..'))];
  };
  const messages = OUTSIDE.map(
    (file) => `astro-kit: ${JSON.stringify(file)} is not a path inside the client directory`,
  );
  const [disk, memory] = onBoth({ 'index.html': '' }, run);
  assert.deepEqual(disk, [messages, ['index.html'], ['dist/index.html', 'secret.txt']]);
  assert.deepEqual(memory, [messages, ['index.html'], undefined]);
});

test('a context in memory never touches the disk', () => {
  const [files, exists] = inTemp({}, (root) => {
    const dist = join(root, 'dist');
    const ctx = memoryContext({ ...inputOf(dist, { root }), files: { 'index.html': html('de-CH', 'Start') } });
    ctx.write('_kit/release.txt', 'local\n');
    return [ctx.files, existsSync(dist)];
  });
  assert.deepEqual(files, ['_kit/release.txt', 'index.html']);
  assert.equal(exists, false);
});

test('a context in memory refuses a file key that is no path of a client directory', () => {
  assert.throws(() => memoryContext({ ...inputOf('/project/dist'), files: { '/index.html': '' } }), {
    message: 'astro-kit: "/index.html" is not a path inside the client directory',
  });
});

// The other fields

test('a context carries its input, the limits of the settings, and the defaults of env and now', () => {
  const options = optionsOf({ ...TWO_LOCALES, limits: { domElements: 900 } });
  const redirects: RedirectRow[] = [{ from: '/alt/', to: '/' }];
  const report = new Report();
  const facts = factsOf();
  const env = { GITHUB_SHA: 'abc' };
  const input = { ...inputOf('/project/dist', { options, redirects, report, facts, env }), files: {} };
  const ctx = memoryContext(input);
  assert.equal(ctx.root, '/project');
  assert.equal(ctx.dist, '/project/dist');
  assert.equal(ctx.options, options);
  assert.equal(ctx.kitVersion, '1.2.3');
  assert.equal(ctx.facts, facts);
  assert.equal(ctx.redirects, redirects);
  assert.equal(ctx.design, DESIGN);
  assert.equal(ctx.report, report);
  assert.equal(ctx.env, env);
  assert.equal(ctx.now, NOW);
  assert.deepEqual(ctx.limits, { ...LIMITS, domElements: 900 });
  assert.deepEqual(memoryContext({ ...inputOf('/project/dist'), files: {} }).limits, effectiveLimits(OPTIONS));
});

test('without env and now, a context has an empty environment and the time of the call', () => {
  const { root, dist, options, kitVersion, facts, redirects, design, report } = inputOf('/project/dist');
  const before = Date.now();
  const ctx = memoryContext({ root, dist, options, kitVersion, facts, redirects, design, report, files: {} });
  const after = Date.now();
  assert.deepEqual(ctx.env, {});
  assert.ok(before <= ctx.now.getTime() && ctx.now.getTime() <= after);
});

test('loading adds no finding and does not throw, whatever the files hold', () => {
  const report = new Report();
  const files: Files = {
    'index.html': '<html><head><style>a{</head><body><p><div></span><<<',
    'empty/index.html': '',
    'bytes.html': Uint8Array.from([0xff, 0xfe, 0x00, 0x3c]),
    '_astro/broken.css': '}}}{',
  };
  const memory = memoryContext({ ...inputOf('/project/dist', { report }), files });
  const disk = inTemp(files, (dist) => loadBuild(inputOf(dist, { report })).pages.map((page) => page.path));
  assert.deepEqual(disk, ['/', '/bytes.html', '/empty/']);
  assert.deepEqual(
    memory.pages.map((page) => page.path),
    ['/', '/bytes.html', '/empty/'],
  );
  assert.deepEqual(report.findings, []);
});

// After the inserts

const META =
  "<meta http-equiv=\"content-security-policy\" content=\"default-src 'self'; script-src 'self'; style-src 'self' 'sha256-aG9tZQ==';\">";

test('a page that is loaded after the inserts holds what speculation-block and modes-script look for', () => {
  const options = optionsOf({ ...TWO_LOCALES, modes: { auto: true, light: true, dark: true, contrast: false } });
  const source = html('de-CH', 'Start', `${META}<style>h1{margin:0}</style>`);
  const [injected, page] = inTemp({ 'index.html': source, '404.html': source }, (dist) => {
    const result = injectBuild(dist, options);
    return [result, loadBuild(inputOf(dist, { options })).pages.find((built) => built.is404)];
  });
  const head = page?.root.querySelectorAll('head > *') ?? [];
  const [, meta, mode, speculation, style] = head;
  assert.deepEqual(injected, { changed: ['404.html', 'index.html'], missing: [] });
  assert.deepEqual(
    head.map((element) => element.rawTagName),
    ['title', 'meta', 'script', 'script', 'style'],
  );
  assert.equal(meta?.getAttribute('http-equiv'), 'content-security-policy');
  assert.deepEqual(mode?.attributes, {});
  assert.equal(mode?.rawText, modeScript(options));
  assert.deepEqual(speculation?.attributes, { type: 'speculationrules' });
  assert.equal(speculation?.innerHTML, SPECULATION_JSON);
  assert.equal(style?.rawText, 'h1{margin:0}');
  assert.equal(page?.root.querySelectorAll('script').length, 2);
  assert.equal(
    page?.html,
    source.replace(
      META,
      () =>
        `${META}<script>${modeScript(options)}</script><script type="speculationrules">${SPECULATION_JSON}</script>`,
    ),
  );
});

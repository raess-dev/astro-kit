import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parse } from 'node-html-parser';
import {
  addFile,
  type BuildContext,
  type BuiltPage,
  DESIGN_FILE,
  type Design,
  fileOfPagePath,
  findPage,
  hasFile,
  isHtmlFile,
  isNotFoundPath,
  pagePathOf,
  readText,
} from '../../src/context.ts';
import { effectiveLimits } from '../../src/options.ts';
import { Report } from '../../src/registry.ts';
import { localeOfPath } from '../../src/routes.ts';
import { factsOf, optionsOf, TWO_LOCALES } from './fixtures.ts';

/** Files of a client directory with the URL path of each, and whether the file is a page. */
const FILES: readonly [file: string, path: string, html: boolean][] = [
  ['index.html', '/', true],
  ['404.html', '/404.html', true],
  ['fr/index.html', '/fr/', true],
  ['fr/kontakt/index.html', '/fr/kontakt/', true],
  ['zimmer/suite/index.html', '/zimmer/suite/', true],
  ['fr/404/index.html', '/fr/404/', true],
  ['a.html', '/a.html', true],
  // A name that only ends in `index.html` is no index file, and `.htm` is no page.
  ['xindex.html', '/xindex.html', true],
  ['fr/xindex.html', '/fr/xindex.html', true],
  ['a.htm', '/a.htm', false],
  ['_astro/page.abc.js', '/_astro/page.abc.js', false],
  ['leitfaden.pdf', '/leitfaden.pdf', false],
  ['index.html.txt', '/index.html.txt', false],
];

test('the URL path of a built file: index.html is the folder, and every other file keeps its name', () => {
  assert.deepEqual(
    FILES.map(([file]) => [file, pagePathOf(file), isHtmlFile(file)]),
    FILES.map(([file, path, html]) => [file, path, html]),
  );
});

test('the file of a page path is the inverse of the URL path of a page', () => {
  const pages = FILES.filter(([, , html]) => html);
  assert.deepEqual(
    pages.map(([, path]) => fileOfPagePath(path)),
    pages.map(([file]) => file),
  );
});

test('only /404.html is the 404 page', () => {
  assert.deepEqual(
    ['/404.html', '/404/', '/fr/404/', '/fr/404.html', '/'].map((path) => isNotFoundPath(path)),
    [true, false, false, false, false],
  );
});

test('the design document is docs/design.md', () => {
  assert.equal(DESIGN_FILE, 'docs/design.md');
});

// A context from strings

const DESIGN: Design = {
  themes: ['light'],
  colors: [{ name: '--color-text', values: { light: '#222222' }, line: 12 }],
  tokens: [{ name: '--space-2', family: 'space', value: '0.5rem', line: 20 }],
  helpers: [{ name: '--stack-gap', token: 'var(--space-2)', line: 30 }],
  breakpoints: [{ name: 'wide', width: '48rem', line: 40 }],
  pairs: [{ foreground: '--color-text', background: '--color-page', role: 'text', for: 'body', line: 50 }],
  elements: [{ selector: 'h1', property: 'color', token: '--color-text', line: 60 }],
  components: [],
};

/** The smallest context that holds every field: it lives in memory, as the context of a unit test does. */
function context(texts: Readonly<Record<string, string>>): BuildContext {
  const options = optionsOf(TWO_LOCALES);
  const store = new Map(Object.entries(texts).map(([file, text]) => [file, new TextEncoder().encode(text)]));
  const files = [...store.keys()].sort();
  const pages: BuiltPage[] = files.filter(isHtmlFile).map((file) => {
    const path = pagePathOf(file);
    const html = texts[file] ?? '';
    return { file, path, locale: localeOfPath(path, options), is404: isNotFoundPath(path), html, root: parse(html) };
  });
  return {
    root: '/project',
    dist: '/project/dist',
    options,
    limits: effectiveLimits(options),
    kitVersion: '0.0.0',
    pages,
    css: [],
    files,
    read: (file) => store.get(file),
    write: (file, text) => {
      store.set(file, new TextEncoder().encode(text));
      addFile(files, file);
    },
    facts: factsOf(),
    redirects: [],
    design: DESIGN,
    report: new Report(),
    env: {},
    now: new Date('2026-11-13T10:00:00.000Z'),
  };
}

const PAGES = {
  'index.html': '<!doctype html><html lang="de-CH"><head><title>Start</title></head><body></body></html>',
  'fr/index.html': '<!doctype html><html lang="fr-CH"><head><title>Accueil</title></head><body></body></html>',
  '404.html': '<!doctype html><html lang="de-CH"><head><title>404</title></head><body></body></html>',
  'leitfaden.pdf': '%PDF-1.7',
};

test('a context finds a page by its path, and each page has the locale of its URL', () => {
  const ctx = context(PAGES);
  assert.deepEqual(
    ctx.pages.map((page) => [page.file, page.path, page.locale, page.is404]),
    [
      ['404.html', '/404.html', 'de', true],
      ['fr/index.html', '/fr/', 'fr', false],
      ['index.html', '/', 'de', false],
    ],
  );
  assert.equal(findPage(ctx, '/fr/')?.root.querySelector('title')?.text, 'Accueil');
  assert.equal(findPage(ctx, '/fr'), undefined);
  assert.equal(findPage(ctx, '/en/'), undefined);
});

test('a context reads a file as text, and a missing file is undefined', () => {
  const ctx = context({ ...PAGES, 'robots.txt': 'User-agent: *\nAllow: /\n', 'umlaut.txt': 'Lärchenwald' });
  assert.equal(readText(ctx, 'robots.txt'), 'User-agent: *\nAllow: /\n');
  assert.equal(readText(ctx, 'umlaut.txt'), 'Lärchenwald');
  assert.equal(readText(ctx, '/robots.txt'), undefined);
  assert.equal(readText(ctx, '_headers'), undefined);
  assert.equal(hasFile(ctx, 'leitfaden.pdf'), true);
  assert.equal(hasFile(ctx, '_headers'), false);
});

test('a written file is in the file list once, the list stays sorted, and the file can be read', () => {
  const ctx = context(PAGES);
  ctx.write('_headers', '/*\n  X-Content-Type-Options: nosniff\n');
  ctx.write('_kit/routes.txt', '/\n/fr/\n');
  ctx.write('_headers', '/*\n');
  assert.deepEqual(ctx.files, [
    '404.html',
    '_headers',
    '_kit/routes.txt',
    'fr/index.html',
    'index.html',
    'leitfaden.pdf',
  ]);
  assert.equal(readText(ctx, '_headers'), '/*\n');
  assert.equal(readText(ctx, '_kit/routes.txt'), '/\n/fr/\n');
});

test('addFile keeps a list sorted and adds a path once', () => {
  const files = ['b', 'd'];
  addFile(files, 'c');
  addFile(files, 'a');
  addFile(files, 'c');
  addFile(files, 'e/f');
  assert.deepEqual(files, ['a', 'b', 'c', 'd', 'e/f']);
});

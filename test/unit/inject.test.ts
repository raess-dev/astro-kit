import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { test } from 'node:test';
import {
  cspMetaEnd,
  type InsertSettings,
  injectBuild,
  insertAfterCspMeta,
  inserts,
  missingMetaMessage,
  modeInsert,
  speculationInsert,
} from '../../src/inject.ts';
import { type Files, inTemp, optionsOf, SMALLEST } from './fixtures.ts';
import { SPEC, specBlock, variable } from './spec.ts';

// Settings

const NO_SPECULATION = { speculationRules: false, astroPrefetch: false } as const;
const THREE_MODES = { auto: true, light: true, dark: true, contrast: false } as const;
const TWO_MODES = { auto: false, light: true, dark: true, contrast: false, default: 'dark' } as const;

/** The default settings: `auto` is the one mode option, and the speculation rules are on. */
const SPECULATION_ONLY: InsertSettings = optionsOf(SMALLEST);
const BOTH: InsertSettings = optionsOf({ ...SMALLEST, modes: THREE_MODES });
const BOTH_TWO_MODES: InsertSettings = optionsOf({ ...SMALLEST, modes: TWO_MODES });
const MODE_ONLY: InsertSettings = optionsOf({ ...SMALLEST, modes: THREE_MODES, prefetch: NO_SPECULATION });
const NEITHER: InsertSettings = optionsOf({ ...SMALLEST, prefetch: NO_SPECULATION });

// The texts of the specification

const MODE_VARIABLE = variable('modeScript(options)');
const SPECULATION_VARIABLE = variable('SPECULATION_JSON');

/** The two inserts as 6.1 writes them, each with its variable. */
const MODE_TEMPLATE = `<script>${MODE_VARIABLE}</script>`;
const SPECULATION_TEMPLATE = `<script type="speculationrules">${SPECULATION_VARIABLE}</script>`;

/** The mode script of 9.3 with its two variables filled in. */
const specScript = (modes: readonly string[], fallback: string): string =>
  specBlock('**The mode script** (`modes-script`)', 'js')
    .replace(variable('MODES'), JSON.stringify(modes))
    .replace(variable('DEFAULT'), JSON.stringify(fallback));

const modeText = (modes: readonly string[], fallback: string): string =>
  MODE_TEMPLATE.replace(MODE_VARIABLE, () => specScript(modes, fallback));

const SPECULATION_TEXT = SPECULATION_TEMPLATE.replace(SPECULATION_VARIABLE, () =>
  specBlock('- **Speculation JSON**', 'json'),
);

const THREE_MODES_TEXT = modeText(['auto', 'light', 'dark'], 'auto');
const TWO_MODES_TEXT = modeText(['light', 'dark'], 'dark');

/** Each setting with its mode insert and its speculation insert. */
const SETTINGS: readonly [name: string, options: InsertSettings, mode: string, speculation: string][] = [
  ['three mode options and speculation rules', BOTH, THREE_MODES_TEXT, SPECULATION_TEXT],
  ['two mode options without auto, and speculation rules', BOTH_TWO_MODES, TWO_MODES_TEXT, SPECULATION_TEXT],
  ['three mode options, no speculation rules', MODE_ONLY, THREE_MODES_TEXT, ''],
  ['one mode option and speculation rules', SPECULATION_ONLY, '', SPECULATION_TEXT],
  ['one mode option, no speculation rules', NEITHER, '', ''],
];

// Pages

/** A built page in three parts: the bytes up to the CSP meta, the meta, and the rest. */
interface Page {
  before: string;
  meta: string;
  after: string;
}

/** A page as Astro builds it: the CSP meta follows the head tags of the project and stands before the `<style>`. */
const page = (lang: string, title: string, styleHash: string): Page => ({
  before: `<!DOCTYPE html><html lang="${lang}"><head><meta charset="utf-8"><title>${title}</title>`,
  meta: `<meta http-equiv="content-security-policy" content="default-src 'self'; script-src 'self' 'sha256-c2NyaXB0'; style-src 'self' 'sha256-${styleHash}';">`,
  after: `<style>@layer reset{h1{margin:0}}</style></head><body><h1>${title}</h1></body></html>`,
});

const textOf = (built: Page, insert = ''): string => built.before + built.meta + insert + built.after;

/** Three pages. Each has its own CSP meta, because the style hashes differ between pages (13.1, item 41). */
const HOME = page('de-CH', 'Gästehaus', 'aG9tZQ==');
const NOT_FOUND = page('de-CH', 'Nicht gefunden', 'bm90Zm91bmQ=');
const SUITE = page('fr-CH', 'Suite « Lac »', 'c3VpdGU=');

const PAGES: Readonly<Record<string, Page>> = {
  'index.html': HOME,
  '404.html': NOT_FOUND,
  'fr/zimmer/suite/index.html': SUITE,
};

/** Files of a client directory that are no page. One is a text file that holds a CSP meta. */
const OTHER_FILES: Files = {
  '_astro/elements.B1x2.css': 'h1{color:red}',
  'robots.txt': 'User-agent: *\nAllow: /\n',
  'notes.html.txt': '<meta http-equiv="content-security-policy" content="default-src \'self\'">',
  'favicon.ico': Uint8Array.from([0, 0, 1, 0, 255, 254]),
};

/** The client directory, with the given text after the CSP meta of every page. */
const distOf = (insert = ''): Files => ({
  ...Object.fromEntries(Object.entries(PAGES).map(([file, built]) => [file, textOf(built, insert)])),
  ...OTHER_FILES,
});

const PAGE_FILES = ['404.html', 'fr/zimmer/suite/index.html', 'index.html'];

/** The bytes of a file as text with one character for each byte, so that a difference shows in the test output. */
const raw = (content: string | Uint8Array): string => Buffer.from(content).toString('latin1');

const rawFiles = (files: Files): Record<string, string> =>
  Object.fromEntries(Object.entries(files).map(([file, content]) => [file, raw(content)]));

/** Every file under a folder, with its bytes as `raw` gives them. */
function snapshot(root: string): Record<string, string> {
  const files: Record<string, string> = {};
  for (const entry of readdirSync(root, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const path = join(entry.parentPath, entry.name);
    files[relative(root, path).split(sep).join('/')] = readFileSync(path, 'latin1');
  }
  return files;
}

// The texts

test('6.1 names the two inserts as the tests build them', () => {
  assert.ok(SPEC.includes(`the mode script \`${MODE_TEMPLATE}\` (9.3);`));
  assert.ok(SPEC.includes(`with \`speculationRules\`, \`${SPECULATION_TEMPLATE}\`.`));
});

test('the mode insert needs two mode options, and the speculation insert needs speculationRules', () => {
  assert.deepEqual(
    SETTINGS.map(([name, options]) => [name, modeInsert(options), speculationInsert(options)]),
    SETTINGS.map(([name, , mode, speculation]) => [name, mode, speculation]),
  );
});

test('the inserts are one text: the mode script first, then the speculation block', () => {
  assert.deepEqual(
    SETTINGS.map(([name, options]) => [name, inserts(options)]),
    SETTINGS.map(([name, , mode, speculation]) => [name, mode + speculation]),
  );
});

// One page

const META = '<meta http-equiv="content-security-policy" content="default-src \'self\'">';
const INSERT = '<script>x</script>';

/** A page text, and the text with `INSERT` in it. `undefined`: the page has no CSP meta. */
const PLACES: readonly [name: string, html: string, expected: string | undefined][] = [
  ['the meta alone', META, `${META}${INSERT}`],
  [
    'after the head tags of the project and before the style',
    `<head><meta charset="utf-8"><title>a</title>${META}<style>a{}</style></head>`,
    `<head><meta charset="utf-8"><title>a</title>${META}${INSERT}<style>a{}</style></head>`,
  ],
  [
    'upper case',
    '<META HTTP-EQUIV="Content-Security-Policy" CONTENT="default-src \'self\'"><style>a{}</style>',
    `<META HTTP-EQUIV="Content-Security-Policy" CONTENT="default-src 'self'">${INSERT}<style>a{}</style>`,
  ],
  [
    'no quotes',
    '<meta http-equiv=content-security-policy content="a"><p>',
    `<meta http-equiv=content-security-policy content="a">${INSERT}<p>`,
  ],
  [
    'the content attribute first',
    '<meta content="a" http-equiv="content-security-policy"><p>',
    `<meta content="a" http-equiv="content-security-policy">${INSERT}<p>`,
  ],
  [
    'a line break inside the meta',
    '<meta\n  http-equiv="content-security-policy"\n  content="a"\n>\n<p>',
    `<meta\n  http-equiv="content-security-policy"\n  content="a"\n>${INSERT}\n<p>`,
  ],
  ['two CSP metas: after the first', `${META}<p>${META}`, `${META}${INSERT}<p>${META}`],
  ['no meta', '<head><title>a</title><style>a{}</style></head>', undefined],
  ['another http-equiv', '<meta http-equiv="refresh" content="0">', undefined],
  ['the words in a content attribute', '<meta name="description" content="content-security-policy">', undefined],
  ['another element', '<metadata http-equiv="content-security-policy">', undefined],
  ['an empty file', '', undefined],
  // A text that only looks like the meta is no element. The real meta follows it, as Astro writes it.
  [
    'the words in a comment before the meta',
    `<head><!-- Astro adds ${META} here --><title>a</title>${META}<style>a{}</style>`,
    `<head><!-- Astro adds ${META} here --><title>a</title>${META}${INSERT}<style>a{}</style>`,
  ],
  [
    'the words in a JSON-LD script before the meta',
    `<script type="application/ld+json">{"text":"<meta http-equiv=content-security-policy content=x>"}</script>${META}<p>`,
    `<script type="application/ld+json">{"text":"<meta http-equiv=content-security-policy content=x>"}</script>${META}${INSERT}<p>`,
  ],
  [
    'the words in the value of an attribute before the meta',
    `<meta name="description" content="How to write <meta http-equiv=content-security-policy> tags > here">${META}<p>`,
    `<meta name="description" content="How to write <meta http-equiv=content-security-policy> tags > here">${META}${INSERT}<p>`,
  ],
  [
    'the words in the title, in a style and in a noscript before the meta',
    `<title>${META}</title><style>/* ${META} */</style><noscript>${META}</noscript>${META}<p>`,
    `<title>${META}</title><style>/* ${META} */</style><noscript>${META}</noscript>${META}${INSERT}<p>`,
  ],
  [
    'a script that holds an end tag of another element, and an end tag in upper case',
    `<SCRIPT>"</scripts></style>${META}"</SCRIPT\n>${META}<p>`,
    `<SCRIPT>"</scripts></style>${META}"</SCRIPT\n>${META}${INSERT}<p>`,
  ],
  [
    'the words in a comment after a > of the comment',
    `<!-- a > b: ${META} -->${META}<p>`,
    `<!-- a > b: ${META} -->${META}${INSERT}<p>`,
  ],
  ['the words in a comment after a >, and no meta', `<!-- a > b: ${META} --><p>`, undefined],
  ['the words in a comment, and no meta', `<!-- ${META} --><p>`, undefined],
  ['the words in a comment that never ends', `<!-- ${META}<p>`, undefined],
  ['the words in a script that never ends', `<script>${META}`, undefined],
  ['an empty comment hides nothing', `<!-->${META}<p>`, `<!-->${META}${INSERT}<p>`],
  [
    'a doctype and an end tag before the meta',
    `<!DOCTYPE html></p x="${META}">${META}`,
    `<!DOCTYPE html></p x="${META}">${META}${INSERT}`,
  ],
  // The value of `http-equiv` is the whole word.
  ['a longer value', '<meta http-equiv="content-security-policy-report-only" content="a">', undefined],
  ['a longer value without quotes', '<meta http-equiv=content-security-policy-report-only content="a">', undefined],
  ['a value with a space', '<meta http-equiv=" content-security-policy" content="a">', undefined],
  ['an attribute whose name only ends in http-equiv', '<meta data-http-equiv="content-security-policy">', undefined],
  [
    'the words in the value of another attribute of a meta',
    '<meta name="x" content=\'http-equiv="content-security-policy"\'>',
    undefined,
  ],
  [
    'two http-equiv attributes: the first counts',
    '<meta http-equiv="refresh" http-equiv="content-security-policy" content="0">',
    undefined,
  ],
  [
    'single quotes, spaces around the equals sign and a slash at the end',
    "<meta content = 'a' HTTP-Equiv = 'Content-Security-Policy' /><p>",
    `<meta content = 'a' HTTP-Equiv = 'Content-Security-Policy' />${INSERT}<p>`,
  ],
  ['a meta that never ends', '<meta http-equiv="content-security-policy" content="a"', undefined],
  ['a quote that never ends', '<meta http-equiv="content-security-policy" content="a><p>', undefined],
];

test('cspMetaEnd gives the index right after the meta', () => {
  assert.equal(cspMetaEnd(`<i>${META}<p>`), 3 + META.length);
  assert.equal(cspMetaEnd('<i><p>'), undefined);
});

test('the text goes right after the first CSP meta, and a page without one gives undefined', () => {
  const insert = (html: string): string | undefined => {
    const result = insertAfterCspMeta(Buffer.from(html), INSERT);
    return result === undefined ? undefined : Buffer.from(result).toString();
  };
  assert.deepEqual(
    PLACES.map(([name, html]) => [name, insert(html)]),
    PLACES.map(([name, , expected]) => [name, expected]),
  );
});

test('with both inserts, the mode script stands right after the meta, then the speculation block, then the style', () => {
  const result = insertAfterCspMeta(Buffer.from(textOf(HOME)), inserts(BOTH));
  const html = result === undefined ? '' : Buffer.from(result).toString();
  const mode = HOME.before.length + HOME.meta.length;
  const speculation = mode + THREE_MODES_TEXT.length;
  const style = speculation + SPECULATION_TEXT.length;
  assert.equal(html.indexOf('<script>'), mode);
  assert.equal(html.indexOf('<script type="speculationrules">'), speculation);
  assert.equal(html.indexOf('<style>'), style);
  assert.equal(html, HOME.before + HOME.meta + THREE_MODES_TEXT + SPECULATION_TEXT + HOME.after);
});

/** A page with a BOM, CRLF line ends, UTF-8 text and two bytes that are no valid UTF-8. */
const BYTES_BEFORE = Buffer.concat([
  Buffer.from([0xef, 0xbb, 0xbf]),
  Buffer.from('<!doctype html>\r\n<html lang="de-CH">\r\n<head>\r\n<title>Gästehaus Zürich</title>\r\n'),
]);
const BYTES_AFTER = Buffer.concat([
  Buffer.from('\r\n<style>h1::after{content:"→"}</style>\r\n</head>\r\n<body>\r\n<p>Grüezi '),
  Buffer.from([0xff, 0xfe]),
  Buffer.from('</p>\r\n</body>\r\n</html>\r\n'),
]);
const BYTES = Buffer.concat([BYTES_BEFORE, Buffer.from(META), BYTES_AFTER]);

test('an insert changes no other byte: a BOM, CRLF, UTF-8 text and invalid UTF-8 pass through', () => {
  const text = inserts(BOTH);
  assert.deepEqual(
    insertAfterCspMeta(BYTES, text),
    Buffer.concat([BYTES_BEFORE, Buffer.from(META), Buffer.from(text), BYTES_AFTER]),
  );
  // The page would not survive a decoder: this is what makes the comparison above a test of the bytes.
  assert.notDeepEqual(Buffer.from(BYTES.toString('utf8')), BYTES);
});

test('the inserted text is written as UTF-8', () => {
  assert.deepEqual(
    insertAfterCspMeta(Buffer.from(`${META}<p>`), '<script>"ä→"</script>'),
    Buffer.from(`${META}<script>"ä→"</script><p>`),
  );
});

test('a part of a larger buffer is read from its own start', () => {
  const whole = Buffer.from(`${META}<i>${META}<p>`);
  const part = new Uint8Array(whole.buffer, whole.byteOffset + META.length, whole.length - META.length);
  assert.deepEqual(insertAfterCspMeta(part, INSERT), Buffer.from(`<i>${META}${INSERT}<p>`));
});

test('a page that already holds the text right after its meta comes back as it is', () => {
  const first = insertAfterCspMeta(BYTES, inserts(BOTH));
  const again = first === undefined ? undefined : insertAfterCspMeta(first, inserts(BOTH));
  assert.notEqual(first, undefined);
  assert.equal(again, first);
  // The text further down the page does not count: only the place right after the meta does.
  const later = Buffer.from(`${META}<p>${INSERT}`);
  assert.deepEqual(insertAfterCspMeta(later, INSERT), Buffer.from(`${META}${INSERT}<p>${INSERT}`));
});

test('an empty text changes nothing, and it still needs the meta', () => {
  assert.equal(insertAfterCspMeta(BYTES, ''), BYTES);
  assert.equal(insertAfterCspMeta(Buffer.from('<p>'), ''), undefined);
});

// A client directory

test('every page of a client directory gets the inserts of the settings, and no other byte changes', () => {
  const runs = SETTINGS.map(([name, options, mode, speculation]) => {
    const [injected, files] = inTemp(distOf(), (dist) => [injectBuild(dist, options), snapshot(dist)]);
    return { name, injected, files, insert: mode + speculation };
  });
  assert.deepEqual(
    runs.map(({ name, injected }) => [name, injected]),
    SETTINGS.map(([name, , mode, speculation]) => [
      name,
      { changed: mode + speculation === '' ? [] : PAGE_FILES, missing: [] },
    ]),
  );
  // Each page keeps its own CSP meta: the expected text of a page holds the meta of that page.
  assert.deepEqual(
    runs.map(({ name, files }) => [name, files]),
    runs.map(({ name, insert }) => [name, rawFiles(distOf(insert))]),
  );
});

test('the 404 page and a nested page get the inserts right after their own meta', () => {
  const files = inTemp(distOf(), (dist) => {
    injectBuild(dist, BOTH);
    return snapshot(dist);
  });
  const insert = THREE_MODES_TEXT + SPECULATION_TEXT;
  assert.equal(files['404.html'], raw(NOT_FOUND.before + NOT_FOUND.meta + insert + NOT_FOUND.after));
  assert.equal(files['fr/zimmer/suite/index.html'], raw(SUITE.before + SUITE.meta + insert + SUITE.after));
  assert.notEqual(NOT_FOUND.meta, SUITE.meta);
});

test('a second run changes no file', () => {
  const [second, files] = inTemp(distOf(), (dist) => {
    injectBuild(dist, BOTH);
    return [injectBuild(dist, BOTH), snapshot(dist)];
  });
  assert.deepEqual(second, { changed: [], missing: [] });
  assert.deepEqual(files, rawFiles(distOf(THREE_MODES_TEXT + SPECULATION_TEXT)));
});

/** Two HTML files without a CSP meta. The second one holds the words, but not as an `http-equiv` meta. */
const WITHOUT_META: Files = {
  'google1a2b3c.html': 'google-site-verification: google1a2b3c.html',
  'fr/plain/index.html': '<!DOCTYPE html><html lang="fr-CH"><head><title>content-security-policy</title></head></html>',
};

test('a page without a CSP meta is listed and not changed, and the other pages still get the inserts', () => {
  const [injected, files] = inTemp({ ...distOf(), ...WITHOUT_META }, (dist) => [
    injectBuild(dist, BOTH),
    snapshot(dist),
  ]);
  assert.deepEqual(injected, { changed: PAGE_FILES, missing: ['fr/plain/index.html', 'google1a2b3c.html'] });
  assert.deepEqual(files, rawFiles({ ...distOf(THREE_MODES_TEXT + SPECULATION_TEXT), ...WITHOUT_META }));
});

test('with no insert, a page without a CSP meta is not listed', () => {
  const injected = inTemp({ ...distOf(), ...WITHOUT_META }, (dist) => injectBuild(dist, NEITHER));
  assert.deepEqual(injected, { changed: [], missing: [] });
});

test('with no insert, the client directory is not read', () => {
  // The path is a file. A function that lists it as a folder throws.
  const injected = inTemp({ dist: 'a file' }, (root) => injectBuild(join(root, 'dist'), NEITHER));
  assert.deepEqual(injected, { changed: [], missing: [] });
});

test('a client directory that does not exist has no page', () => {
  const injected = inTemp({}, (root) => injectBuild(join(root, 'dist'), BOTH));
  assert.deepEqual(injected, { changed: [], missing: [] });
});

test('with an adapter, only the client directory is edited', () => {
  const tree: Files = {
    'client/index.html': textOf(HOME),
    'client/404.html': textOf(NOT_FOUND),
    'server/entry.mjs': 'export default {};\n',
    'server/pages/index.html': textOf(SUITE),
  };
  const [injected, files] = inTemp(tree, (root) => [injectBuild(join(root, 'client'), BOTH), snapshot(root)]);
  const insert = THREE_MODES_TEXT + SPECULATION_TEXT;
  assert.deepEqual(injected, { changed: ['404.html', 'index.html'], missing: [] });
  assert.deepEqual(
    files,
    rawFiles({ ...tree, 'client/index.html': textOf(HOME, insert), 'client/404.html': textOf(NOT_FOUND, insert) }),
  );
});

test('the error text names every page without a CSP meta', () => {
  assert.equal(missingMetaMessage(['404.html']), 'astro-kit: 404.html has no CSP meta');
  assert.equal(
    missingMetaMessage(['fr/plain/index.html', 'google1a2b3c.html']),
    'astro-kit: fr/plain/index.html has no CSP meta\nastro-kit: google1a2b3c.html has no CSP meta',
  );
});

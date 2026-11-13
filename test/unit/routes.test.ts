import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  isLocaleHome,
  isReservedSegment,
  type LocaleSettings,
  localeHome,
  localeHomes,
  localeOfPath,
  NOT_FOUND_PATH,
  PAGE_PATH,
  pathSegments,
  RESERVED_SEGMENTS,
  SLUG,
} from '../../src/routes.ts';

/** German is the default locale; French and Italian have a prefix. */
const options: LocaleSettings = {
  defaultLocale: 'de',
  locales: [{ code: 'de' }, { code: 'fr' }, { code: 'it' }],
};

/** The same site with French as the default locale, so the default is not the first entry. */
const frenchFirst: LocaleSettings = { defaultLocale: 'fr', locales: [{ code: 'de' }, { code: 'fr' }] };

test('the reserved segments are the eight of routes-slug, without 404', () => {
  assert.deepEqual(
    [...RESERVED_SEGMENTS],
    ['_astro', '_actions', '_server-islands', '_image', '_kit', 'api', '500', '.well-known'],
  );
  const cases: [string, boolean][] = [
    ['api', true],
    ['_astro', true],
    ['.well-known', true],
    ['500', true],
    ['404', false],
    ['apis', false],
    ['API', false],
    ['', false],
  ];
  for (const [segment, expected] of cases) assert.equal(isReservedSegment(segment), expected, segment);
});

test('the 404 path is /404.html', () => {
  assert.equal(NOT_FOUND_PATH, '/404.html');
});

test('a slug is lower-case letters and digits with single hyphens', () => {
  assert.equal(SLUG.source, '^[a-z0-9]+(-[a-z0-9]+)*$');
  const cases: [string, boolean][] = [
    ['zimmer', true],
    ['zimmer-und-suiten', true],
    ['a', true],
    ['2026', true],
    ['404', true],
    ['', false],
    ['Zimmer', false],
    ['zimmer_suiten', false],
    ['zimmer--suiten', false],
    ['-zimmer', false],
    ['zimmer-', false],
    ['zimmer.html', false],
    ['zürich', false],
    ['a b', false],
    ['zimmer\n', false],
  ];
  for (const [segment, expected] of cases) assert.equal(SLUG.test(segment), expected, JSON.stringify(segment));
});

test('a page path is the root or slug segments that each end with a slash', () => {
  assert.equal(PAGE_PATH.source, '^\\/([a-z0-9]+(-[a-z0-9]+)*\\/)*$');
  const cases: [string, boolean][] = [
    ['/', true],
    ['/impressum/', true],
    ['/fr/mentions-legales/', true],
    ['/a/b/c/', true],
    ['', false],
    ['/impressum', false],
    ['impressum/', false],
    ['//', false],
    ['/a//b/', false],
    ['/Impressum/', false],
    ['/404.html', false],
    ['/a/?x=1', false],
    ['/a/#sent', false],
    ['https://example.ch/a/', false],
    ['/a\\b/', false],
  ];
  for (const [path, expected] of cases) assert.equal(PAGE_PATH.test(path), expected, JSON.stringify(path));
});

test('the segments of a path leave out the empty parts', () => {
  const cases: [string, string[]][] = [
    ['/', []],
    ['', []],
    ['/fr/', ['fr']],
    ['/fr/kontakt/', ['fr', 'kontakt']],
    ['/404.html', ['404.html']],
    ['/api/forms/contact/', ['api', 'forms', 'contact']],
  ];
  for (const [path, expected] of cases) assert.deepEqual(pathSegments(path), expected, path);
});

test('the locale of a path comes from its first segment', () => {
  const cases: [string, LocaleSettings, string][] = [
    ['/', options, 'de'],
    ['/zimmer/', options, 'de'],
    ['/fr/', options, 'fr'],
    ['/fr/chambres/', options, 'fr'],
    ['/it/camere/doppia/', options, 'it'],
    ['/fr', options, 'fr'],
    // A longer segment that starts with a code is not that code.
    ['/fragen/', options, 'de'],
    ['/fr.html', options, 'de'],
    // A code in a later segment does not count.
    ['/zimmer/fr/', options, 'de'],
    // The default code as a first segment is a default-locale path. `routes-slug` reports it.
    ['/de/zimmer/', options, 'de'],
    // A code that the site does not declare.
    ['/en/rooms/', options, 'de'],
    ['/FR/', options, 'de'],
    ['/404.html', options, 'de'],
    ['', options, 'de'],
    ['/', frenchFirst, 'fr'],
    ['/de/', frenchFirst, 'de'],
    ['/fr/', frenchFirst, 'fr'],
    ['/404.html', frenchFirst, 'fr'],
  ];
  for (const [path, settings, expected] of cases) assert.equal(localeOfPath(path, settings), expected, path);
});

test('the default locale has its home at the root, every other locale under its code', () => {
  const cases: [string, LocaleSettings, string][] = [
    ['de', options, '/'],
    ['fr', options, '/fr/'],
    ['it', options, '/it/'],
    ['de', frenchFirst, '/de/'],
    ['fr', frenchFirst, '/'],
  ];
  for (const [code, settings, expected] of cases) assert.equal(localeHome(code, settings), expected, code);
  assert.deepEqual(localeHomes(options), ['/', '/fr/', '/it/']);
  assert.deepEqual(localeHomes(frenchFirst), ['/de/', '/']);
  assert.deepEqual(localeHomes({ defaultLocale: 'de', locales: [{ code: 'de' }] }), ['/']);
});

test('a locale home is matched exactly', () => {
  const cases: [string, LocaleSettings, boolean][] = [
    ['/', options, true],
    ['/fr/', options, true],
    ['/it/', options, true],
    ['/de/', options, false],
    ['/fr', options, false],
    ['/fr/index.html', options, false],
    ['/fr/chambres/', options, false],
    ['/en/', options, false],
    ['/404.html', options, false],
    ['', options, false],
    ['/de/', frenchFirst, true],
    ['/', frenchFirst, true],
    ['/fr/', frenchFirst, false],
  ];
  for (const [path, settings, expected] of cases) assert.equal(isLocaleHome(path, settings), expected, path);
});

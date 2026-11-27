/**
 * The build rule `legal-approved` (part 9b of M9): the hash of the legal text of each declared legal page that is
 * built equals its entry in `legal.lock.json`, and the file has no other key. Each case builds a `BuildContext` from
 * strings (14.1). The fixture context holds the lock that `legal --write` writes for its files, unless a case gives
 * another one.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { auditLegalApproved, auditSite, declaredLegalPaths, lockEntries, renderLock } from '../../src/audit/site.ts';
import { LOCK_FILE } from '../../src/context.ts';
import { sha256 } from '../../src/csp.ts';
import { getRule } from '../../src/registry.ts';
import { type ContextSettings, contextOf, findings, ids, OPTIONS, page, site } from './audit-fixtures.ts';
import { optionsOf, TWO_LOCALES } from './fixtures.ts';
import { SPEC } from './spec.ts';

type Files = Readonly<Record<string, string | Uint8Array>>;

/** Runs `legal-approved` on a context of the files and returns its report. */
function run(files: Files, settings: ContextSettings = {}) {
  const ctx = contextOf(files, settings);
  auditLegalApproved(ctx);
  return ctx.report;
}

/** The lock that `legal --write` writes for the fixture site. */
function lockOfSite(files: Files = site()): string {
  const ctx = contextOf(files);
  return renderLock(lockEntries(ctx.options, new Map(ctx.pages.map((built) => [built.path, built]))));
}

/** The fixture site with the German privacy page changed. */
const withPrivacy = (main: string): Files => ({
  ...site(),
  'datenschutz/index.html': page(OPTIONS, '/datenschutz/', {
    alternates: { de: '/datenschutz/', fr: '/fr/protection-des-donnees/' },
    main,
  }),
});

/** The default `main` of the German privacy page: its title and its description (`page` of the fixtures). */
const PRIVACY_TITLE = 'Example – die Seite /datenschutz/';
const PRIVACY_TEXT = 'Eine Seite des Beispiels, unter der Adresse /datenschutz/, mit einem kurzen Text auf Deutsch.';
const PRIVACY_MAIN = `<h1>${PRIVACY_TITLE}</h1> <p>${PRIVACY_TEXT}</p>`;

const RULE = getRule('legal-approved');

test('the row of legal-approved in section 8 is the registry rule of the build stage, and it is not waivable', () => {
  assert.equal(SPEC.includes('| `legal-approved` | build | For each declared legal path'), true);
  assert.deepEqual(
    { stage: RULE.stage, group: RULE.group, waivable: RULE.waivable },
    {
      stage: 'build',
      group: 'legal',
      waivable: false,
    },
  );
});

test('legal-approved passes the lock that legal --write writes, and the site audit runs it', () => {
  assert.deepEqual(ids(run(site())), []);
  const ctx = contextOf(site(), { legalLock: '{}\n' });
  auditSite(ctx);
  assert.deepEqual(ids(ctx.report), ['legal-approved']);
});

test('the lock holds the four legal pages of the fixture site, with sorted keys, and the hash of the legal text', () => {
  const lock = JSON.parse(lockOfSite()) as Record<string, string>;
  assert.deepEqual(Object.keys(lock), [
    '/datenschutz/',
    '/fr/mentions-legales/',
    '/fr/protection-des-donnees/',
    '/impressum/',
  ]);
  // The legal text is the visible text of `main`, each run of white space as one space.
  assert.equal(lock['/datenschutz/'], sha256(`${PRIVACY_TITLE} ${PRIVACY_TEXT}`));
  assert.equal(lockOfSite().endsWith('"\n}\n'), true);
});

test('legal-approved fails one word changed on the privacy page, at the page, with both hashes', () => {
  const changed = PRIVACY_MAIN.replace('kurzen', 'langen');
  const report = run(withPrivacy(changed), { legalLock: lockOfSite() });
  assert.deepEqual(ids(report), ['legal-approved']);
  const before = sha256(`${PRIVACY_TITLE} ${PRIVACY_TEXT}`);
  const after = sha256(`${PRIVACY_TITLE} ${PRIVACY_TEXT.replace('kurzen', 'langen')}`);
  assert.deepEqual(findings(report), [
    `legal-approved /datenschutz/ the legal text hashes to ${after}, and ${LOCK_FILE} holds ${before}`,
  ]);
});

for (const [name, main] of [
  ['a change of white space', PRIVACY_MAIN.replace('</h1> <p>', '</h1>\n\n   <p>')],
  ['a hidden part', `${PRIVACY_MAIN}<p hidden>Entwurf</p><div aria-hidden="true">Bild</div>`],
  [
    'a visually hidden part and a template',
    `${PRIVACY_MAIN}<span class="visually-hidden">x</span><template>y</template>`,
  ],
] as const) {
  test(`legal-approved passes ${name} in main: no visitor sees a change of the legal text`, () => {
    assert.deepEqual(ids(run(withPrivacy(main), { legalLock: lockOfSite() })), []);
  });
}

test('legal-approved passes a change outside main: the header and the footer hold no legal text', () => {
  const files = {
    ...site(),
    'datenschutz/index.html': page(OPTIONS, '/datenschutz/', {
      alternates: { de: '/datenschutz/', fr: '/fr/protection-des-donnees/' },
      header: '<header class="site-header"><a href="/">Ein anderes Beispiel</a></header>',
    }),
  };
  assert.deepEqual(ids(run(files, { legalLock: lockOfSite() })), []);
});

test('legal-approved: a missing file has no entry, so each built legal page is a finding', () => {
  const report = run(site(), { legalLock: null });
  assert.deepEqual(
    findings(report),
    declaredLegalPaths(OPTIONS).map((path) => `legal-approved ${path} ${LOCK_FILE} has no entry for this page`),
  );
});

test('legal-approved: a site with no built legal page passes a missing file and an empty lock', () => {
  const home = { 'index.html': site()['index.html'] ?? '' };
  assert.deepEqual(ids(run(home, { legalLock: null })), []);
  assert.deepEqual(ids(run(home, { legalLock: '{}\n' })), []);
});

test('legal-approved: a broken file is one finding at the file, and no page is compared', () => {
  assert.deepEqual(findings(run(site(), { legalLock: 'nope' })), [
    `legal-approved ${LOCK_FILE} the file is not valid JSON`,
  ]);
  assert.deepEqual(findings(run(site(), { legalLock: '"text"' })), [
    `legal-approved ${LOCK_FILE} the file is not a JSON object`,
  ]);
  assert.deepEqual(findings(run(site(), { legalLock: 'null' })), [
    `legal-approved ${LOCK_FILE} the file is not a JSON object`,
  ]);
});

test('legal-approved: a key that is no declared legal path fails at its field; a declared page not built does not', () => {
  const lock = JSON.parse(lockOfSite()) as Record<string, string>;
  const other = JSON.stringify({ ...lock, '/zimmer/': 'sha256-x' });
  assert.deepEqual(findings(run(site(), { legalLock: other })), [
    `legal-approved ${LOCK_FILE}: /zimmer/ no declared legal path has this key`,
  ]);
  // Without the French privacy page, its entry is no other key: the page is `legal-pages`'s.
  const files: Record<string, string> = { ...site() };
  delete files['fr/protection-des-donnees/index.html'];
  assert.deepEqual(ids(run(files, { legalLock: lockOfSite() })), []);
});

test('legal-approved reads a path declared twice once, and an accessibility page too', () => {
  const options = optionsOf({
    ...TWO_LOCALES,
    legal: { ...TWO_LOCALES.legal, accessibility: { de: '/impressum/', fr: '/fr/accessibilite/' } },
  });
  assert.deepEqual(declaredLegalPaths(options), [
    '/datenschutz/',
    '/fr/accessibilite/',
    '/fr/mentions-legales/',
    '/fr/protection-des-donnees/',
    '/impressum/',
  ]);
  const files = site(options);
  const lock = JSON.parse(lockOfSite(files)) as Record<string, string>;
  assert.equal(Object.keys(lock).length, 4);
  assert.deepEqual(ids(run(files, { options, legalLock: JSON.stringify(lock) })), []);
});

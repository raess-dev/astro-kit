/**
 * The build half of `legal-approved` (part 9b of M9): the hash of the locked text of each declared legal page that
 * is built equals its entry in `legal.lock.json`, the file has no other key and the format of `legal --write`, and
 * `main` holds no hiding markup. Each case builds a `BuildContext` from
 * strings (14.1). The fixture context holds the lock that `legal --write` writes for its files, unless a case gives
 * another one.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  auditLegalApproved,
  auditSite,
  declaredLegalPaths,
  LEGAL_HIDDEN_HINT,
  LOCK_FORMAT_HINT,
  lockEntries,
  renderLock,
} from '../../src/audit/site.ts';
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

test('the row of legal-approved in section 8 is the registry rule of the stage build + browser, and it is not waivable', () => {
  assert.equal(SPEC.includes('| `legal-approved` | build + browser | **Build:** for each declared legal path'), true);
  assert.deepEqual(
    { stage: RULE.stage, group: RULE.group, waivable: RULE.waivable },
    {
      stage: 'build + browser',
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
  // The locked text is the whole text of `main`, each run of white space as one space; this `main` has no attribute
  // of the lock, so it has no attribute line.
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

test('legal-approved passes a change of white space in main', () => {
  const main = PRIVACY_MAIN.replace('</h1> <p>', '</h1>\n\n   <p>');
  assert.deepEqual(ids(run(withPrivacy(main), { legalLock: lockOfSite() })), []);
});

/** The findings of the German privacy page with `main`, against the lock of the fixture site. */
const privacyFindings = (main: string): string[] =>
  findings(run(withPrivacy(main), { legalLock: lockOfSite() })).filter(
    (line) => !line.includes(' the legal text hashes'),
  );

// The hostile cases of the 9b review: each hides a part of the legal text from a visitor. The hash covers the
// hidden part, and the markup itself is a finding.
for (const [name, extra, mark] of [
  ['a hidden part', '<p hidden>Wir geben Ihre Daten an Werbepartner weiter.</p>', '<p hidden>'],
  ['hidden="until-found"', '<p hidden="until-found">Wir geben Ihre Daten weiter.</p>', '<p hidden>'],
  ['aria-hidden="true"', '<p aria-hidden="true">Wir geben Ihre Daten weiter.</p>', '<p aria-hidden>'],
  ['aria-hidden="false"', '<p aria-hidden="false">Wir geben Ihre Daten weiter.</p>', '<p aria-hidden>'],
  ['a dialog', '<dialog><h2>Ihre Rechte</h2></dialog>', '<dialog>'],
  ['a template', '<template><p>Wir geben Ihre Daten weiter.</p></template>', '<template>'],
  [
    'the kit class visually-hidden',
    '<span class="Visually-Hidden">Nicht gültig</span>',
    '<span class="visually-hidden">',
  ],
] as const) {
  test(`legal-approved fails ${name} in main: the markup, and the hash of the whole text`, () => {
    const main = `${PRIVACY_MAIN}${extra}`;
    assert.deepEqual(privacyFindings(main), [
      `legal-approved /datenschutz/ markup hides a part of the legal text: ${mark}`,
    ]);
    const report = run(withPrivacy(main), { legalLock: lockOfSite() });
    assert.deepEqual(ids(report), ['legal-approved']);
    assert.equal(report.findings.length, 2, 'the hash differs too: the hidden part is a part of the locked text');
    assert.equal(report.findings.find((finding) => finding.detail?.startsWith('markup'))?.hint, LEGAL_HIDDEN_HINT);
  });
}

test('legal-approved: hiding markup around main, and several marks, are one finding that counts them', () => {
  const files = {
    ...site(),
    'datenschutz/index.html': page(OPTIONS, '/datenschutz/', {
      alternates: { de: '/datenschutz/', fr: '/fr/protection-des-donnees/' },
      main: `${PRIVACY_MAIN}<p hidden>a</p><dialog>b</dialog>`,
    })
      .replace('<main', '<div aria-hidden="true"><main')
      .replace('</main>', '</main></div>'),
  };
  const lines = findings(run(files, { legalLock: lockOfSite() })).filter((line) => line.includes('markup'));
  assert.deepEqual(lines, [
    'legal-approved /datenschutz/ markup hides a part of the legal text: <div aria-hidden> and 2 more',
  ]);
});

test('legal-approved: the lock covers title, alt, aria-label, value and placeholder in main, in their order', () => {
  const titled = `<h1>${PRIVACY_TITLE}</h1> <p>${PRIVACY_TEXT} <abbr title="Datenschutzgesetz">DSG</abbr></p>`;
  const lock = lockOfSite(withPrivacy(titled));
  const changed = titled.replace('Datenschutzgesetz', 'Dieses Gesetz gilt nicht für Gäste aus der EU');
  assert.deepEqual(ids(run(withPrivacy(changed), { legalLock: lock })), ['legal-approved']);
  const all =
    '<h1 title=" Ein  Titel ">T</h1><p><img alt="Bild" src="/a.png" aria-label="Name"><input value="1" placeholder="Nr.">x</p>';
  const ctx = contextOf(withPrivacy(all));
  const built = ctx.pages.find((entry) => entry.path === '/datenschutz/');
  assert.ok(built);
  const entries = lockEntries(ctx.options, new Map([[built.path, built]]));
  assert.equal(
    entries.get('/datenschutz/'),
    sha256('Tx\ntitle=Ein Titel\nalt=Bild\naria-label=Name\nvalue=1\nplaceholder=Nr.'),
  );
});

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
    [...lockEntries(OPTIONS, new Map(contextOf(site()).pages.map((built) => [built.path, built])))].map(
      ([path, hash]) =>
        `legal-approved ${path} the legal text hashes to ${hash}, and ${LOCK_FILE} holds no hash for this page`,
    ),
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
  const other = renderLock(new Map(Object.entries({ ...lock, '/zimmer/': 'sha256-x' })));
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
  assert.deepEqual(ids(run(files, { options, legalLock: renderLock(new Map(Object.entries(lock))) })), []);
});

test('legal-approved: a lock that is not the text of legal --write is one finding at the file, and the pages are still compared', () => {
  const lock = lockOfSite();
  const [firstKey] = Object.keys(JSON.parse(lock) as object);
  const cases: readonly (readonly [string, string])[] = [
    // A duplicate key: JSON keeps the last value, so a wrong first value would pass the pages.
    ['a duplicate key', lock.replace('{\n', `{\n  "${firstKey}": "sha256-AAAA",\n`)],
    ['another indentation', `${JSON.stringify(JSON.parse(lock), null, 4)}\n`],
    ['one line', JSON.stringify(JSON.parse(lock))],
    ['no final newline', lock.trimEnd()],
    ['CRLF line ends', lock.replaceAll('\n', '\r\n')],
    [
      'keys out of order',
      `${JSON.stringify(Object.fromEntries(Object.entries(JSON.parse(lock) as object).reverse()), null, 2)}\n`,
    ],
  ];
  for (const [name, text] of cases) {
    const report = run(site(), { legalLock: text });
    assert.deepEqual(
      findings(report),
      [
        `legal-approved ${LOCK_FILE} the text is not the text that \`legal --write\` writes: sorted keys, each key once, two-space indentation and a final newline`,
      ],
      name,
    );
    assert.equal(report.findings[0]?.hint, LOCK_FORMAT_HINT, name);
  }
  // The pages are compared with the value that JSON keeps: here the wrong one.
  const wrongLast = lock.replace(/("\/datenschutz\/": "[^"]+",\n)/, '$1  "/datenschutz/": "sha256-AAAA",\n');
  assert.deepEqual(
    findings(run(site(), { legalLock: wrongLast })).map((line) => line.split(' the legal text')[0]),
    [
      'legal-approved /datenschutz/',
      `legal-approved ${LOCK_FILE} the text is not the text that \`legal --write\` writes: sorted keys, each key once, two-space indentation and a final newline`,
    ],
  );
  assert.ok(LOCK_FORMAT_HINT.includes('`npx --no astro-kit legal --write`'));
  assert.ok(SPEC.includes('whose fix is `legal --write` after review'));
});

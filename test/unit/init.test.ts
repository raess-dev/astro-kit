/**
 * The command `init` and the site templates (6.4, 12.1, 12.2, 5.3). The tests write the templates into temp folders
 * and compare the written files with the templates and with the texts of the specification. They never install or
 * build the result (14.1).
 */
import assert from 'node:assert/strict';
import {
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { renderLock } from '../../src/audit/site.ts';
import { type Io, main, PASSED_LINE } from '../../src/cli.ts';
import { renderWrangler } from '../../src/hosts/cloudflare.ts';
import {
  FEATURE_SHIMS,
  FORCE_KEPT,
  featureShims,
  INIT_FEATURES,
  initSettings,
  LEGAL_SLUGS,
  LOCALE_TABLE,
  NO_LOCALES,
  NO_OWNER,
  NO_SITE,
  nextSteps,
  notAFile,
  notAFolder,
  PINS,
  PROTECTED_FILES,
  PROTECTED_NOT_YET,
  projectPath,
  renderTemplate,
  SETTINGS_EXIST,
  siteName,
  siteTemplates,
  templateVariables,
  unknownFeature,
  unknownLocale,
} from '../../src/init.ts';
import { parseOptions } from '../../src/options.ts';
import { preflight } from '../../src/preflight.ts';
import { Report } from '../../src/registry.ts';
import {
  CLAUDE_LINE,
  FORMS_SHIM,
  FORMS_SHIM_FILE,
  ISLANDS_SHIM,
  ISLANDS_SHIM_FILE,
  KIT_BLOCK,
  KIT_BLOCK_END,
  KIT_BLOCK_START,
  RENDERED_PROTECTED,
  SHIMS,
} from '../../src/shims.ts';
import { type Files, inTempAsync, json } from './fixtures.ts';
import { SPEC, specBlock } from './spec.ts';

const REPO = fileURLToPath(new URL('../../', import.meta.url));
const TEMPLATES = join(REPO, 'templates');
const KIT_PACKAGE = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8')) as {
  version: string;
  files: string[];
  devDependencies: Record<string, string>;
};

/** An `io` that records what the command line writes. */
function recorder(): { io: Io; out: () => string; err: () => string } {
  const out: string[] = [];
  const err: string[] = [];
  return {
    io: { out: (text) => out.push(text), err: (text) => err.push(text), env: {} },
    out: () => out.join(''),
    err: () => err.join(''),
  };
}

/** Every file under a folder, as sorted paths with `/`. */
function filesUnder(folder: string, path = ''): string[] {
  if (!existsSync(folder)) return [];
  return readdirSync(folder, { withFileTypes: true })
    .flatMap((entry) => {
      const child = path === '' ? entry.name : `${path}/${entry.name}`;
      return entry.isDirectory() ? filesUnder(join(folder, entry.name), child) : [child];
    })
    .sort();
}

/** The text of every file under a folder, by path. */
const textsUnder = (folder: string): Record<string, string> =>
  Object.fromEntries(filesUnder(folder).map((path) => [path, readFileSync(join(folder, path), 'utf8')]));

/** Runs the command line in a root and gives its code and output. */
async function run(root: string, argv: readonly string[]): Promise<{ code: number; out: string; err: string }> {
  const seen = recorder();
  const code = await main(argv, root, seen.io);
  return { code, out: seen.out(), err: seen.err() };
}

/** Runs `init` in a temp folder that holds `files`, and gives the result with the texts that the folder then holds. */
function initIn(
  files: Files,
  argv: readonly string[],
): Promise<{ code: number; out: string; err: string; texts: Record<string, string> }> {
  return inTempAsync(files, async (root) => ({ ...(await run(root, ['init', ...argv])), texts: textsUnder(root) }));
}

const FLAGS = ['--site', 'https://example.ch', '--locales', 'de,fr', '--owner', '@example-owner'] as const;

/** The files of the tree `templates/site/` as the test reads them: the project path and the template text. */
const SITE_TEMPLATES: readonly (readonly [string, string])[] = filesUnder(join(TEMPLATES, 'site')).map((path) => [
  path,
  readFileSync(join(TEMPLATES, 'site', path), 'utf8'),
]);

/** The project path of a template path, written out here: `_x` becomes `.x`, and `.tmpl` goes. */
const pathOf = (template: string): string =>
  template
    .split('/')
    .map((part) => part.replace(/^_/, '.'))
    .join('/')
    .replace(/\.tmpl$/, '');

/** The files that plain `init` writes for a static site with no astro-kit.json, in path order. */
const PLAIN_FILES = [
  '.claude/settings.json',
  '.github/kit-identity.sh',
  '.gitignore',
  '.mcp.json',
  '.node-version',
  '.npmrc',
  'AGENTS.md',
  'CLAUDE.md',
  'KIT-FEEDBACK.md',
  'astro-kit.json',
  'astro.config.mjs',
  'biome.json',
  'docs/design.md',
  'docs/spec.md',
  'glossary.json',
  'legal.lock.json',
  'package.json',
  'redirects.json',
  'schedule.json',
  'site.json',
  'src/styles/components/.gitkeep',
  'src/styles/elements.css',
  'src/styles/fonts.css',
  'src/styles/pages/.gitkeep',
  'src/styles/tokens.css',
  'tsconfig.json',
];

// The templates

test('the template tree holds the files of 3.3 that this part writes, and only the protected files it renders', () => {
  assert.deepEqual(
    SITE_TEMPLATES.map(([path]) => path),
    [
      'AGENTS.md.tmpl',
      'CLAUDE.md',
      'KIT-FEEDBACK.md',
      '_claude/settings.json',
      '_github/kit-identity.sh',
      '_gitignore',
      '_mcp.json',
      '_node-version',
      '_npmrc',
      'docs/design.md',
      'docs/spec.md',
      'glossary.json',
      'legal.lock.json',
      'redirects.json',
      'schedule.json',
      'site.json.tmpl',
      'src/styles/components/.gitkeep',
      'src/styles/elements.css',
      'src/styles/fonts.css',
      'src/styles/pages/.gitkeep',
      'src/styles/tokens.css',
    ],
  );
  // Part 9d of M9 renders two of the seven protected files; part 9e adds the others (10.6).
  assert.deepEqual(Object.keys(RENDERED_PROTECTED), ['.github/kit-identity.sh', '.npmrc']);
  for (const [path] of SITE_TEMPLATES) {
    assert.equal(PROTECTED_FILES.includes(pathOf(path)), Object.hasOwn(RENDERED_PROTECTED, pathOf(path)), path);
    assert.equal(pathOf(path).startsWith('.claude/'), pathOf(path) === '.claude/settings.json', path);
    assert.equal(projectPath(path), pathOf(path));
  }
});

test('the protected files are the seven files of 10.6', () => {
  const sentence = SPEC.slice(SPEC.indexOf('The protected files are renderings of the kit:'));
  const list = sentence.slice(0, sentence.indexOf('. They change'));
  assert.deepEqual(
    [...list.matchAll(/`([^`]+)`/g)].map((match) => match[1]),
    [...PROTECTED_FILES],
  );
});

test('the package ships the templates', () => {
  assert.equal(KIT_PACKAGE.files.includes('templates'), true);
});

test('AGENTS.md.tmpl is the template of 12.1, and KIT_BLOCK is its kit block of at most 18 lines', () => {
  const template = readFileSync(join(TEMPLATES, 'site/AGENTS.md.tmpl'), 'utf8');
  assert.equal(template, `${specBlock('The template that `init` writes:', 'md')}\n`);
  const lines = template.split('\n');
  const block = lines.slice(lines.indexOf(KIT_BLOCK_START), lines.indexOf(KIT_BLOCK_END) + 1);
  assert.equal(block.join('\n'), KIT_BLOCK);
  assert.equal(KIT_BLOCK.split('\n').length <= 18, true);
  assert.equal(template.split(KIT_BLOCK_START).length, 2);
  assert.equal(template.split(KIT_BLOCK_END).length, 2);
});

test('CLAUDE.md is exactly the line @AGENTS.md (12.1)', () => {
  assert.equal(readFileSync(join(TEMPLATES, 'site/CLAUDE.md'), 'utf8'), '@AGENTS.md\n');
  assert.equal(CLAUDE_LINE, '@AGENTS.md');
});

test('docs/design.md is the skeleton of 7.4', () => {
  assert.equal(
    readFileSync(join(TEMPLATES, 'site/docs/design.md'), 'utf8'),
    `${specBlock('**The skeleton init writes:**', 'md')}\n`,
  );
});

test('the small files have the texts of 12.2 and 4.1', () => {
  const read = (path: string): string => readFileSync(join(TEMPLATES, 'site', path), 'utf8');
  // The two style skeletons: one layer block that holds one comment, so it is no empty block (12.2).
  const skeleton = (file: string): string => {
    const marker = `\`src/styles/${file}\` (\``;
    const start = SPEC.indexOf(marker) + marker.length;
    return SPEC.slice(start, SPEC.indexOf('`', start)).replaceAll('\\n', '\n');
  };
  assert.equal(read('src/styles/tokens.css'), skeleton('tokens.css'));
  assert.equal(read('src/styles/elements.css'), skeleton('elements.css'));
  assert.equal(read('src/styles/tokens.css'), '@layer tokens {\n  /* astro-kit tokens writes this file. */\n}\n');
  assert.equal(
    read('src/styles/elements.css'),
    '@layer elements {\n  /* Element rules go here, one per element of docs/design.md. */\n}\n',
  );
  assert.equal(read('src/styles/fonts.css'), '');
  assert.equal(read('src/styles/components/.gitkeep'), '');
  assert.equal(read('src/styles/pages/.gitkeep'), '');
  assert.equal(read('_node-version'), '24\n');
  // The data files hold the JSON of 12.2, in the format that Biome gives them (expanded objects).
  assert.deepEqual(JSON.parse(read('schedule.json')), { openingHours: [], closures: [] });
  assert.equal(read('schedule.json'), json({ openingHours: [], closures: [] }));
  assert.equal(read('redirects.json'), '[]\n');
  assert.equal(read('glossary.json'), '{}\n');
  assert.equal(read('legal.lock.json'), '{}\n');
  // The empty lock is the text that `legal --write` writes for no legal page.
  assert.equal(read('legal.lock.json'), renderLock(new Map()));
  for (const text of ['`redirects.json` (`[]`)', '`glossary.json` (`{}`)', '`legal.lock.json` (`{}`)']) {
    assert.equal(SPEC.includes(text), true, text);
  }
  assert.equal(SPEC.includes('`schedule.json` (`{"openingHours": [], "closures": []}`)'), true);
  assert.equal(SPEC.includes('`.node-version` (`24`)'), true);
  // `.gitignore`: the line of 4.1, one entry per line; dist, .astro and .wrangler among them (M9).
  const row = SPEC.split('\n').find((line) => line.startsWith('├── .gitignore                    [init]')) ?? '';
  const entries = row
    .slice(row.indexOf('[init]') + '[init]'.length)
    .trim()
    .split(/\s+/);
  assert.equal(read('_gitignore'), `${entries.join('\n')}\n`);
  for (const entry of ['dist/', '.astro/', '.wrangler/', 'node_modules/']) assert.equal(entries.includes(entry), true);
});

test('.mcp.json holds the servers of 12.3, in the format of Biome', () => {
  const text = readFileSync(join(TEMPLATES, 'site/_mcp.json'), 'utf8');
  assert.deepEqual(JSON.parse(text), JSON.parse(specBlock('**`.mcp.json`:**', 'json')));
  assert.equal(text.endsWith('}\n'), true);
});

test('site.json.tmpl renders the skeleton of 12.2', () => {
  const marker = '`site.json` (`';
  const start = SPEC.indexOf(marker) + marker.length;
  const skeleton = SPEC.slice(start, SPEC.indexOf('`)', start));
  const variables = templateVariables({ site: 'https://www.hotel-adler.ch', codeOwner: '@example-owner' });
  const rendered = renderTemplate(readFileSync(join(TEMPLATES, 'site/site.json.tmpl'), 'utf8'), variables);
  assert.deepEqual(
    JSON.parse(rendered),
    JSON.parse(skeleton.replaceAll('<NAME>', 'Hotel Adler').replaceAll('<host>', 'hotel-adler.ch')),
  );
  assert.equal(rendered, json(JSON.parse(rendered)));
});

test('the template variables are the ones of 10.4, and a .tmpl file names no other', () => {
  assert.deepEqual(templateVariables({ site: 'https://www.hotel-adler.ch', codeOwner: '@example-owner' }), {
    host: 'hotel-adler.ch',
    worker: 'hotel-adler-ch',
    NAME: 'Hotel Adler',
    SITE: 'https://www.hotel-adler.ch',
    OWNER: '@example-owner',
  });
  assert.equal(siteName('https://laerchenwald.example'), 'Laerchenwald');
  assert.equal(siteName('https://example.ch'), 'Example');
  assert.throws(() => renderTemplate('{{NOPE}}', {}), /the template variable NOPE does not exist/);
  const variables = templateVariables({ site: 'https://example.ch', codeOwner: '@example-owner' });
  for (const [path, text] of SITE_TEMPLATES) {
    const rendered = path.endsWith('.tmpl') ? renderTemplate(text, variables) : text;
    assert.equal(/\{\{[A-Za-z]+\}\}/.test(rendered), false, path);
  }
});

test('the feature shims are the files of templates/features', () => {
  assert.deepEqual(featureShims(['forms']), [{ path: FORMS_SHIM_FILE, text: FORMS_SHIM }]);
  assert.deepEqual(featureShims(['islands']), [{ path: ISLANDS_SHIM_FILE, text: ISLANDS_SHIM }]);
  assert.deepEqual(featureShims(['scripts']), []);
});

// The pins

test('PINS are the pins of 2.1 and of the kit repository', () => {
  const table = SPEC.slice(SPEC.indexOf('| Package | Pin |'));
  const pins = new Map(
    [...table.slice(0, table.indexOf('\n\n')).matchAll(/^\| `([^`]+)` \| `([^`]+)` \|$/gm)].map((match) => [
      match[1],
      match[2],
    ]),
  );
  for (const [pkg, version] of Object.entries(PINS)) assert.equal(pins.get(pkg), version, pkg);
  // The pins that the kit repository installs as devDependencies are the same versions.
  const shared = Object.keys(PINS).filter((pkg) => pkg in KIT_PACKAGE.devDependencies);
  assert.deepEqual(shared.sort(), ['@astrojs/cloudflare', '@astrojs/solid-js', 'astro', 'solid-js']);
  assert.deepEqual(
    shared.map((pkg) => KIT_PACKAGE.devDependencies[pkg]),
    shared.map((pkg) => PINS[pkg as keyof typeof PINS]),
  );
});

// The settings

test('initSettings gives the defaults of 5.3, valid as astro-kit.json', () => {
  const value = initSettings('https://example.ch', ['de', 'fr', 'it', 'en', 'rm', 'xx'], [], '@example-owner');
  const report = new Report();
  const options = parseOptions(value, report);
  assert.deepEqual(report.findings, []);
  assert.notEqual(options, undefined);
  assert.deepEqual(value, {
    site: 'https://example.ch',
    codeOwner: '@example-owner',
    locales: [
      { code: 'de', tag: 'de-CH', name: 'Deutsch', coverage: 'full' },
      { code: 'fr', tag: 'fr-CH', name: 'Français', coverage: 'full' },
      { code: 'it', tag: 'it-CH', name: 'Italiano', coverage: 'full' },
      { code: 'en', tag: 'en', name: 'English', coverage: 'full' },
      { code: 'rm', tag: 'rm-CH', name: 'Rumantsch', coverage: 'full' },
      { code: 'xx', tag: 'xx', name: 'xx', coverage: 'full' },
    ],
    defaultLocale: 'de',
    features: { forms: false, islands: false, scripts: false, wasm: false, workers: false },
    prefetch: { speculationRules: true, astroPrefetch: false },
    modes: { auto: true, light: false, dark: false, contrast: false },
    legal: {
      legalNote: {
        de: '/impressum/',
        fr: '/fr/mentions-legales/',
        it: '/it/note-legali/',
        en: '/en/legal-note/',
        rm: '/rm/impressum/',
        xx: '/xx/legal-note/',
      },
      privacy: {
        de: '/datenschutz/',
        fr: '/fr/protection-des-donnees/',
        it: '/it/protezione-dei-dati/',
        en: '/en/privacy/',
        rm: '/rm/protecziun-da-datas/',
        xx: '/xx/privacy/',
      },
    },
    processing: ['cdn', 'previews'],
    securityContact: 'mailto:security@example.ch',
    dependencies: [],
    origins: [],
    waivers: [],
    limits: {},
  });
  assert.equal(LOCALE_TABLE.size, 5);
  assert.equal(LEGAL_SLUGS.size, 4);
});

test('initSettings with forms adds contact and the processing keys forms and server; the default locale sits at the root', () => {
  const value = initSettings('https://www.hotel-adler.ch', ['rm', 'de'], ['forms', 'islands'], '@team/owners');
  assert.deepEqual(value.contact, { to: 'info@hotel-adler.ch', from: 'form@hotel-adler.ch' });
  assert.deepEqual(value.processing, ['cdn', 'previews', 'forms', 'server']);
  assert.deepEqual(value.features, { forms: true, islands: true, scripts: false, wasm: false, workers: false });
  assert.deepEqual(value.legal.legalNote, { rm: '/impressum/', de: '/de/impressum/' });
  assert.equal(value.defaultLocale, 'rm');
  assert.equal('forms' in value, false);
  const report = new Report();
  assert.notEqual(parseOptions(value, report), undefined);
  assert.deepEqual(report.findings, []);
});

// The command

test('init writes the templates, and each written file equals its template', async () => {
  const result = await initIn({}, FLAGS);
  assert.equal(result.code, 0);
  assert.deepEqual(Object.keys(result.texts).sort(), PLAIN_FILES);
  const variables = templateVariables({ site: 'https://example.ch', codeOwner: '@example-owner' });
  for (const [path, text] of SITE_TEMPLATES) {
    const expected = path.endsWith('.tmpl') ? renderTemplate(text, variables) : text;
    assert.equal(result.texts[pathOf(path)], expected, path);
  }
  for (const [path, text] of Object.entries(SHIMS)) assert.equal(result.texts[path], text, path);
  assert.equal(result.texts['AGENTS.md']?.startsWith('# Example\n\nThe marketing site for https://example.ch,'), true);
  assert.equal(result.texts['CLAUDE.md'], '@AGENTS.md\n');
  for (const path of PROTECTED_FILES) {
    const render = Object.hasOwn(RENDERED_PROTECTED, path) ? RENDERED_PROTECTED[path] : undefined;
    assert.equal(result.texts[path], render?.(), path);
  }
  assert.deepEqual(siteTemplates(variables).length, SITE_TEMPLATES.length);
});

test('init prints wrote for each file in path order and the Next: block, on stdout; no passed line', async () => {
  const result = await initIn({}, FLAGS);
  assert.equal(result.out, `${PLAIN_FILES.map((path) => `wrote ${path}`).join('\n')}\n${nextSteps(false)}`);
  assert.equal(result.out.includes(PASSED_LINE), false);
  assert.equal(result.err, '');
  assert.equal(result.out.includes('\nNext:\n'), true);
});

test('init writes astro-kit.json in the --apply format, and package.json with the pins', async () => {
  const result = await initIn({}, [...FLAGS, '--features', 'islands,forms']);
  const settings = initSettings('https://example.ch', ['de', 'fr'], ['islands', 'forms'], '@example-owner');
  assert.equal(result.texts['astro-kit.json'], `${JSON.stringify(settings, null, 2)}\n`);
  assert.equal(result.texts['package.json'], json(packageOf(true, true)));
  assert.equal(result.texts[FORMS_SHIM_FILE], FORMS_SHIM);
  assert.equal(result.texts[ISLANDS_SHIM_FILE], ISLANDS_SHIM);
  const plain = await initIn({}, FLAGS);
  assert.equal(plain.texts['package.json'], json(packageOf(false, false)));
});

/** The `package.json` of 12.2 for a site at example.ch, written out. */
function packageOf(forms: boolean, islands: boolean): unknown {
  return {
    name: 'example-ch',
    private: true,
    type: 'module',
    scripts: { check: 'astro-kit check', build: 'astro-kit build', test: 'astro-kit test', ci: 'astro-kit ci' },
    dependencies: {
      ...(forms ? { '@astrojs/cloudflare': '14.4.9' } : {}),
      ...(islands ? { '@astrojs/solid-js': '7.1.6' } : {}),
      '@raess/astro-kit': KIT_PACKAGE.version,
      astro: '7.4.13',
      ...(islands ? { 'solid-js': '1.9.20' } : {}),
    },
    devDependencies: {
      ...(islands ? { eslint: '10.15.0', 'eslint-plugin-solid': '0.20.0', 'typescript-eslint': '8.73.0' } : {}),
      wrangler: '4.165.0',
    },
  };
}

test('init prints a line for a locale that the table of 5.3 does not hold', async () => {
  const result = await initIn({}, ['--site', 'https://example.ch', '--locales', 'de,sq', '--owner', '@o']);
  assert.equal(result.code, 0);
  assert.equal(result.out.includes(`\n${unknownLocale('sq')}\nNext:\n`), true);
});

test('init never overwrites a file without --force, and never overwrites astro-kit.json', async () => {
  await inTempAsync({}, async (root) => {
    assert.equal((await run(root, ['init', ...FLAGS])).code, 0);
    const first = textsUnder(root);
    writeFileSync(join(root, 'AGENTS.md'), '# Mine\n');
    writeFileSync(join(root, 'astro-kit.json'), json({ ...JSON.parse(first['astro-kit.json'] ?? '{}'), waivers: [] }));
    const settings = readFileSync(join(root, 'astro-kit.json'), 'utf8');
    const again = await run(root, ['init']);
    assert.equal(again.code, 0);
    assert.equal(again.out, `${PLAIN_FILES.map((path) => `kept ${path}`).join('\n')}\n${nextSteps(false)}`);
    assert.equal(readFileSync(join(root, 'AGENTS.md'), 'utf8'), '# Mine\n');
    const forced = await run(root, ['init', '--force']);
    assert.equal(forced.code, 0);
    const lines = PLAIN_FILES.map((path) => (FORCE_KEPT.includes(path) ? `kept ${path}` : `wrote ${path}`));
    assert.equal(forced.out, `${lines.join('\n')}\n${nextSteps(false)}`);
    assert.deepEqual(textsUnder(root), { ...first, 'astro-kit.json': settings, 'AGENTS.md': '# Mine\n' });
  });
});

test('an existing astro-kit.json wins over the flags, with the message of 6.4 on stderr', async () => {
  const settings = initSettings('https://hotel.example', ['fr'], ['islands'], '@owner');
  const result = await initIn({ 'astro-kit.json': json(settings) }, [...FLAGS, '--features', 'forms']);
  assert.equal(result.code, 0);
  assert.equal(result.err, `${SETTINGS_EXIST}\n`);
  assert.equal(result.texts['astro-kit.json'], json(settings));
  assert.equal(result.texts['AGENTS.md']?.startsWith('# Hotel\n\nThe marketing site for https://hotel.example,'), true);
  assert.equal(result.texts[ISLANDS_SHIM_FILE], ISLANDS_SHIM);
  assert.equal(FORMS_SHIM_FILE in result.texts, false);
  assert.equal(result.out.startsWith('wrote .claude/settings.json\n'), true);
  assert.equal(result.out.includes('kept astro-kit.json\n'), true);
  // Without a flag that sets a value, the message does not come.
  const quiet = await initIn({ 'astro-kit.json': json(settings) }, []);
  assert.equal(quiet.err, '');
});

test('an existing astro-kit.json that is not valid: init gives its findings, 1, and writes nothing', async () => {
  const result = await initIn({ 'astro-kit.json': '{}' }, FLAGS);
  assert.equal(result.code, 1);
  assert.match(result.err, /^astro-kit init: astro-kit\.json is not valid; fix it first\.\n/);
  assert.match(result.err, /✗ \[config-options\]/);
  assert.deepEqual(Object.keys(result.texts), ['astro-kit.json']);
});

const FAILING: readonly { name: string; argv: readonly string[]; message: string }[] = [
  { name: 'no --owner', argv: ['--site', 'https://example.ch', '--locales', 'de'], message: NO_OWNER },
  { name: 'no --site', argv: ['--locales', 'de', '--owner', '@o'], message: NO_SITE },
  { name: 'no --locales', argv: ['--site', 'https://example.ch', '--owner', '@o'], message: NO_LOCALES },
  { name: 'an unknown feature', argv: [...FLAGS, '--features', 'forms,maps'], message: unknownFeature('maps') },
  {
    name: 'an unknown feature with --shims',
    argv: ['--shims', '--features', 'Forms'],
    message: unknownFeature('Forms'),
  },
  { name: '--protected', argv: ['--protected'], message: PROTECTED_NOT_YET },
  { name: '--protected with the other flags', argv: [...FLAGS, '--protected', '--force'], message: PROTECTED_NOT_YET },
  {
    name: 'an empty locale',
    argv: [...FLAGS.slice(0, 2), '--locales', 'de,,fr', '--owner', '@o'],
    message: `${NO_LOCALES}; an entry is empty`,
  },
];

for (const c of FAILING) {
  test(`init with ${c.name}: the message, 1, and no file`, async () => {
    const result = await initIn({}, c.argv);
    assert.equal(result.code, 1);
    assert.equal(result.err, `${c.message}\n`);
    assert.equal(result.out, '');
    assert.deepEqual(result.texts, {});
  });
}

test('the unknown-feature message is the text of 6.4', () => {
  assert.equal(
    SPEC.includes('An unknown feature throws `astro-kit init: unknown feature X (forms, islands, scripts)`.'),
    true,
  );
  assert.equal(unknownFeature('X'), 'astro-kit init: unknown feature X (forms, islands, scripts)');
  assert.deepEqual([...INIT_FEATURES], ['forms', 'islands', 'scripts']);
  assert.equal(SPEC.includes(`An existing \`astro-kit.json\` wins over flags: \`${SETTINGS_EXIST}\``), true);
  assert.equal(SPEC.includes(`init throws \`${NO_OWNER}\``), true);
});

test('settings from the flags that are not valid give the config-options findings, 1, and no file', async () => {
  const result = await initIn({}, ['--site', 'http://example.ch', '--locales', 'de', '--owner', 'owner']);
  assert.equal(result.code, 1);
  assert.match(result.err, /^astro-kit init: the flags give settings that are not valid\.\n/);
  assert.match(result.err, /✗ \[config-options\] astro-kit\.json: site:/);
  assert.match(result.err, /✗ \[config-options\] astro-kit\.json: codeOwner:/);
  assert.deepEqual(result.texts, {});
});

test('init --shims writes only the shims and the shims of the enabled features', async () => {
  const none = await initIn({}, ['--shims']);
  assert.equal(none.code, 0);
  assert.deepEqual(none.texts, SHIMS);
  assert.equal(
    none.out,
    `${Object.keys(SHIMS)
      .sort()
      .map((path) => `wrote ${path}`)
      .join('\n')}\n${nextSteps(true)}`,
  );
  const both = await initIn({}, ['--shims', '--features', 'forms,islands']);
  assert.deepEqual(both.texts, { ...SHIMS, [FORMS_SHIM_FILE]: FORMS_SHIM, [ISLANDS_SHIM_FILE]: ISLANDS_SHIM });
  // With astro-kit.json, its features decide; the file itself is not touched.
  const settings = json(initSettings('https://example.ch', ['de'], ['islands'], '@o'));
  const kept = await initIn({ 'astro-kit.json': settings, 'biome.json': '{}\n' }, ['--shims']);
  assert.deepEqual(kept.texts, {
    ...SHIMS,
    'astro-kit.json': settings,
    'biome.json': '{}\n',
    [ISLANDS_SHIM_FILE]: ISLANDS_SHIM,
  });
  assert.equal(kept.out.includes('kept biome.json\n'), true);
  const forced = await initIn({ 'astro-kit.json': settings, 'biome.json': '{}\n' }, ['--shims', '--force']);
  assert.equal(forced.texts['biome.json'], SHIMS['biome.json']);
});

const USAGE_ERRORS: readonly (readonly string[])[] = [
  ['init', 'extra'],
  ['init', '--site'],
  ['init', '--site', '--force'],
  ['init', '--force', '--force'],
  ['init', '--features', ''],
  ['init', '--shims', '--site', 'https://example.ch'],
  ['init', '--shims', '--owner', '@o'],
  ['init', '--shims', '--locales', 'de'],
  ['init', '--site=https://example.ch'],
  ['init', '-f'],
];

for (const argv of USAGE_ERRORS) {
  test(`astro-kit ${argv.join(' ')}: a usage error, 2, and no file`, async () => {
    const result = await inTempAsync({}, async (root) => ({ ...(await run(root, argv)), texts: textsUnder(root) }));
    assert.equal(result.code, 2);
    assert.equal(result.out, '');
    assert.deepEqual(result.texts, {});
  });
}

// A fresh init and preflight

test('preflight on a fresh init: design-format, and config-wrangler until the protected files are rendered', async () => {
  await inTempAsync({}, async (root) => {
    assert.equal((await run(root, ['init', ...FLAGS])).code, 0);
    const ids = (): string[] => {
      const report = new Report();
      preflight(root, report);
      return [...new Set(report.findings.map((finding) => finding.rule))].sort();
    };
    assert.deepEqual(ids(), ['config-wrangler', 'design-format']);
    const report = new Report();
    const options = parseOptions(JSON.parse(readFileSync(join(root, 'astro-kit.json'), 'utf8')), report);
    assert.notEqual(options, undefined);
    if (options !== undefined) writeFileSync(join(root, 'wrangler.jsonc'), renderWrangler(options));
    assert.deepEqual(ids(), ['design-format']);
    // The agent files that init writes pass `config-shim`.
    rmSync(join(root, 'docs/design.md'));
    assert.deepEqual(ids(), ['design-format']);
  });
});

// Links and the planning pass (6.4)

/**
 * Every entry under a folder, read with `lstat` and never through a link: a folder as `dir`, a link as `-> target`,
 * a file as its text.
 */
function entriesUnder(folder: string, path = ''): Record<string, string> {
  const entries: Record<string, string> = {};
  if (!existsSync(folder)) return entries;
  for (const name of readdirSync(folder).sort()) {
    const child = path === '' ? name : `${path}/${name}`;
    const full = join(folder, name);
    const stats = lstatSync(full);
    if (stats.isSymbolicLink()) entries[child] = `-> ${readlinkSync(full)}`;
    else if (stats.isDirectory()) Object.assign(entries, { [child]: 'dir' }, entriesUnder(full, child));
    else entries[child] = readFileSync(full, 'utf8');
  }
  return entries;
}

/** A case of the planning pass: it prepares the root and a folder outside it, runs init, and gives both trees. */
interface LinkCase {
  name: string;
  argv: readonly string[];
  /** Prepares `root` and `outside`, two sibling temp folders. */
  setup: (root: string, outside: string) => void;
  message: string;
}

const LINK_CASES: readonly LinkCase[] = [
  {
    name: 'a dangling link at a file path',
    argv: FLAGS,
    setup: (root, outside) => symlinkSync(join(outside, 'pwned.md'), join(root, 'AGENTS.md')),
    message: notAFile('AGENTS.md'),
  },
  {
    name: 'a link at a file path to a file outside the root',
    argv: FLAGS,
    setup: (root, outside) => {
      writeFileSync(join(outside, 'victim'), 'secret\n');
      symlinkSync(join(outside, 'victim'), join(root, 'CLAUDE.md'));
    },
    message: notAFile('CLAUDE.md'),
  },
  {
    name: 'a link at a file path to a file outside the root, with --force',
    argv: [...FLAGS, '--force'],
    setup: (root, outside) => {
      writeFileSync(join(outside, 'victim'), 'secret\n');
      symlinkSync(join(outside, 'victim'), join(root, 'biome.json'));
    },
    message: notAFile('biome.json'),
  },
  {
    name: 'a linked parent folder (docs -> ../x)',
    argv: FLAGS,
    setup: (root, outside) => symlinkSync(outside, join(root, 'docs')),
    message: notAFolder('docs'),
  },
  {
    name: 'a linked parent folder below the first segment (src/styles)',
    argv: FLAGS,
    setup: (root, outside) => {
      mkdirSync(join(root, 'src'));
      symlinkSync(outside, join(root, 'src/styles'));
    },
    message: notAFolder('src/styles'),
  },
  {
    name: 'a link to .github/workflows/site.yml, with --force',
    argv: [...FLAGS, '--force'],
    setup: (root) => {
      mkdirSync(join(root, '.github/workflows'), { recursive: true });
      writeFileSync(join(root, '.github/workflows/site.yml'), 'name: site\n');
      symlinkSync('.github/workflows/site.yml', join(root, 'redirects.json'));
    },
    message: notAFile('redirects.json'),
  },
  {
    name: 'a linked docs folder that names .github/workflows',
    argv: FLAGS,
    setup: (root) => {
      mkdirSync(join(root, '.github/workflows'), { recursive: true });
      symlinkSync('.github/workflows', join(root, 'docs'));
    },
    message: notAFolder('docs'),
  },
  {
    name: 'a folder at a file path',
    argv: FLAGS,
    setup: (root) => mkdirSync(join(root, 'CLAUDE.md')),
    message: notAFile('CLAUDE.md'),
  },
  {
    name: 'a folder at a file path, with --force',
    argv: [...FLAGS, '--force'],
    setup: (root) => mkdirSync(join(root, 'tsconfig.json')),
    message: notAFile('tsconfig.json'),
  },
  {
    name: 'a file at a folder path',
    argv: FLAGS,
    setup: (root) => writeFileSync(join(root, 'docs'), 'a file\n'),
    message: notAFolder('docs'),
  },
  {
    name: 'a file at a folder path, with --force',
    argv: [...FLAGS, '--force'],
    setup: (root) => writeFileSync(join(root, 'src'), 'a file\n'),
    message: notAFolder('src'),
  },
  {
    name: 'a hard link at a file path, with --force',
    argv: [...FLAGS, '--force'],
    setup: (root, outside) => {
      writeFileSync(join(outside, 'victim'), 'secret\n');
      linkSync(join(outside, 'victim'), join(root, '.gitignore'));
    },
    message: notAFile('.gitignore'),
  },
  {
    name: 'astro-kit.json as a link',
    argv: [],
    setup: (root, outside) => {
      writeFileSync(join(outside, 'settings.json'), json(initSettings('https://example.ch', ['de'], [], '@o')));
      symlinkSync(join(outside, 'settings.json'), join(root, 'astro-kit.json'));
    },
    message: notAFile('astro-kit.json'),
  },
  {
    name: 'a shim as a link, with --shims --force',
    argv: ['--shims', '--force'],
    setup: (root, outside) => {
      writeFileSync(join(outside, 'victim'), 'secret\n');
      symlinkSync(join(outside, 'victim'), join(root, 'astro.config.mjs'));
    },
    message: notAFile('astro.config.mjs'),
  },
];

for (const c of LINK_CASES) {
  test(`init refuses ${c.name}: the message, 1, and no file written inside or outside the root`, async () => {
    const outside = mkdtempSync(join(tmpdir(), 'astro-kit-outside-'));
    try {
      await inTempAsync({}, async (root) => {
        c.setup(root, outside);
        const before = { root: entriesUnder(root), outside: entriesUnder(outside) };
        const result = await run(root, ['init', ...c.argv]);
        assert.equal(result.code, 1);
        assert.equal(result.err, `${c.message}\n`);
        assert.equal(result.out, '');
        assert.deepEqual({ root: entriesUnder(root), outside: entriesUnder(outside) }, before);
      });
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
}

test('the messages of the planning pass are the texts of 6.4', () => {
  assert.equal(notAFile('a/b'), 'astro-kit init: a/b is not a file');
  assert.equal(notAFolder('a'), 'astro-kit init: a is not a folder');
  assert.equal(SPEC.includes('throw `astro-kit init: <path> is not a file` (`is not a folder` for a parent)'), true);
});

test('init writes into existing real folders, and keeps a regular file there', async () => {
  const result = await initIn(
    { 'docs/spec.md': '# Ours\n', 'src/styles/elements.css': '@layer elements {\n}\n' },
    FLAGS,
  );
  assert.equal(result.code, 0);
  assert.equal(result.texts['docs/spec.md'], '# Ours\n');
  assert.equal(result.out.includes('kept docs/spec.md\n'), true);
  assert.equal(result.out.includes('wrote docs/design.md\n'), true);
});

// --force keeps the files of the project and of its owner (6.4)

/** The files that `--force` rewrites: the kit's own files. */
const KIT_OWNED = [
  '.github/kit-identity.sh',
  '.gitignore',
  '.node-version',
  '.npmrc',
  'astro.config.mjs',
  'biome.json',
  'src/styles/components/.gitkeep',
  'src/styles/pages/.gitkeep',
  'src/styles/tokens.css',
  'tsconfig.json',
  FORMS_SHIM_FILE,
  ISLANDS_SHIM_FILE,
];

test('FORCE_KEPT is the list of the 6.4 sentence, and every file of init is kept or kit-owned', async () => {
  const marker = 'It always keeps the files of the project and of its owner (`FORCE_KEPT` in `src/init.ts`): ';
  const start = SPEC.indexOf(marker);
  assert.notEqual(start, -1);
  const sentence = SPEC.slice(start + marker.length, SPEC.indexOf(', and prints `kept <path>`', start));
  const listed = [...sentence.matchAll(/`([^`]+)`/g)].map((match) => match[1] ?? '');
  assert.deepEqual([...listed].sort(), [...FORCE_KEPT].sort());
  // The owner-approved files of the kit block (12.1). Of the folder `.claude/`, init writes `settings.json` (12.3).
  for (const path of ['astro-kit.json', 'site.json', 'docs/design.md', 'legal.lock.json', '.mcp.json']) {
    assert.equal(KIT_BLOCK.includes(`\`${path}\``), true, path);
    assert.equal(FORCE_KEPT.includes(path), true, path);
  }
  assert.equal(KIT_BLOCK.includes('`.claude/`'), true);
  assert.equal(FORCE_KEPT.includes('.claude/settings.json'), true);
  // The files that the owner named (decision of 2026-11-28).
  for (const path of ['package.json', 'AGENTS.md', 'docs/spec.md', 'KIT-FEEDBACK.md']) {
    assert.equal(FORCE_KEPT.includes(path), true, path);
  }
  const all = await initIn({}, [...FLAGS, '--features', 'forms,islands,scripts']);
  const written = Object.keys(all.texts).sort();
  assert.deepEqual(written, [...FORCE_KEPT, ...KIT_OWNED].sort());
  for (const path of KIT_OWNED) assert.equal(FORCE_KEPT.includes(path), false, path);
});

for (const path of FORCE_KEPT) {
  test(`init --force keeps ${path} and prints kept ${path}`, async () => {
    await inTempAsync({}, async (root) => {
      assert.equal((await run(root, ['init', ...FLAGS, '--features', 'forms,islands'])).code, 0);
      // A text of the project: astro-kit.json stays valid settings, so init reads it.
      const own =
        path === 'astro-kit.json'
          ? json({ ...initSettings('https://example.ch', ['de', 'fr'], ['forms', 'islands'], '@other') })
          : `own text of ${path}\n`;
      writeFileSync(join(root, path), own);
      writeFileSync(join(root, 'biome.json'), '{}\n');
      const forced = await run(root, ['init', '--force']);
      assert.equal(forced.code, 0, forced.err);
      assert.equal(readFileSync(join(root, path), 'utf8'), own);
      assert.equal(forced.out.includes(`kept ${path}\n`), true);
      // A kit file is rewritten in the same run.
      assert.equal(readFileSync(join(root, 'biome.json'), 'utf8'), SHIMS['biome.json']);
      assert.equal(forced.out.includes('wrote biome.json\n'), true);
    });
  });
}

test('init --force writes a kept file that is missing', async () => {
  await inTempAsync({}, async (root) => {
    assert.equal((await run(root, ['init', ...FLAGS])).code, 0);
    rmSync(join(root, 'site.json'));
    const forced = await run(root, ['init', '--force']);
    assert.equal(forced.code, 0);
    assert.equal(forced.out.includes('wrote site.json\n'), true);
    assert.equal(forced.out.includes('kept docs/spec.md\n'), true);
  });
});

// The feature shims (A9)

test('the feature shims are listed per feature, and a missing template throws', () => {
  assert.deepEqual(FEATURE_SHIMS, { forms: [FORMS_SHIM_FILE], islands: [ISLANDS_SHIM_FILE], scripts: [] });
  for (const feature of INIT_FEATURES) {
    assert.deepEqual(filesUnder(join(TEMPLATES, 'features', feature)), [...FEATURE_SHIMS[feature]], feature);
  }
  const empty = mkdtempSync(join(tmpdir(), 'astro-kit-templates-'));
  try {
    mkdirSync(join(empty, 'features/islands'), { recursive: true });
    assert.throws(
      () => featureShims(['forms'], empty),
      new Error(`astro-kit init: the template templates/features/forms/${FORMS_SHIM_FILE} is missing`),
    );
    assert.throws(
      () => featureShims(['islands'], empty),
      new Error(`astro-kit init: the template templates/features/islands/${ISLANDS_SHIM_FILE} is missing`),
    );
    assert.deepEqual(featureShims(['scripts'], empty), []);
  } finally {
    rmSync(empty, { recursive: true, force: true });
  }
});

// The templates against the specification (A8)

test('docs/spec.md has the six sections of 12.2, in order', () => {
  const marker = '- **`docs/spec.md`** sections: ';
  const start = SPEC.indexOf(marker);
  assert.notEqual(start, -1);
  const list = SPEC.slice(start + marker.length, SPEC.indexOf('. Brand and design', start));
  // The names, without the notes in brackets.
  const names = list
    .replace(/\s*\([^)]*\)/g, '')
    .split(', ')
    .map((name) => name.trim());
  assert.equal(names.length, 6);
  const template = readFileSync(join(TEMPLATES, 'site/docs/spec.md'), 'utf8');
  const headings = [...template.matchAll(/^## (.+)$/gm)].map((match) => match[1]);
  assert.deepEqual(headings, names);
});

test('KIT-FEEDBACK.md ends with the line of 12.6', () => {
  const marker = 'The template ends with `';
  const start = SPEC.indexOf(marker);
  assert.notEqual(start, -1);
  const line = SPEC.slice(start + marker.length, SPEC.indexOf('`', start + marker.length));
  assert.equal(line, '<!-- Entries start below this line. -->');
  assert.equal(readFileSync(join(TEMPLATES, 'site/KIT-FEEDBACK.md'), 'utf8').endsWith(`\n${line}\n`), true);
});

// The Next: block and the temporary sentences (A6, A7)

test('the Next: block says that check reports config-wrangler until a later kit version', () => {
  const line = 'So check reports config-wrangler until a later kit version writes them.';
  assert.equal(nextSteps(false).endsWith(`${line}\n`), true);
  assert.equal(SPEC.includes(`its "Next:" block then ends with the line \`${line}\``), true);
});

test('the temporary sentences name part 9e, now that part 9d is done', () => {
  for (const stale of ['a later part of M9', 'part 9e of M9 renders', 'parts 9d and 9e', 'Parts 9d and 9e']) {
    assert.equal(SPEC.includes(stale), false, stale);
  }
});

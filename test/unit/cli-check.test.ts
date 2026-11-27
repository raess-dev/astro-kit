/**
 * The commands `check` and `legal` of 6.4 (part 9b of M9), in temp folders (14.1). The tool runner of `check` runs
 * fake bins: each one records its package, arguments, folder and telemetry variable, and exits with a set code. No
 * test runs Biome, ESLint or Astro.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { findBin, LEGAL_NO_BUILD, LOCK_FILE } from '../../src/ci.ts';
import { type Io, main, PASSED_LINE, USAGE } from '../../src/cli.ts';
import { sha256 } from '../../src/csp.ts';
import { getRule } from '../../src/registry.ts';
import { ISLANDS_SHIM, ISLANDS_SHIM_FILE } from '../../src/shims.ts';
import { type Files, inTempAsync, json } from './fixtures.ts';
import { SETTINGS, SMALLEST } from './project-fixtures.ts';
import { SPEC } from './spec.ts';

const SUMMARY_VARIABLE = 'GITHUB_STEP_SUMMARY';
const SUMMARY_FILE = 'summary.md';
const PASSED = `${PASSED_LINE}\n`;

/** The text of a file, or `undefined` when it does not exist. */
const textOf = (file: string): string | undefined => (existsSync(file) ? readFileSync(file, 'utf8') : undefined);

/** The sorted, unique rule ids in the output of a command, parsed as 6.4 says. */
const idsIn = (output: string): string[] =>
  [...new Set([...output.matchAll(/✗ \[([a-z0-9-]+)\]/g)].map((match) => match[1] ?? ''))].sort();

/** How often the passed line stands in a text. */
const passedIn = (text: string): number => text.split(PASSED_LINE).length - 1;

/** An `io` that records what the command line writes. */
function recorder(env: Io['env'] = {}): { io: Io; out: () => string; err: () => string } {
  const out: string[] = [];
  const err: string[] = [];
  return {
    io: { out: (text) => out.push(text), err: (text) => err.push(text), env },
    out: () => out.join(''),
    err: () => err.join(''),
  };
}

/** What one command gave. */
interface Seen {
  code: number;
  out: string;
  err: string;
  ids: string[];
  summary: string | undefined;
}

/** Runs the command line in the root, with a job summary file in the root. */
async function cli(root: string, argv: readonly string[]): Promise<Seen> {
  const seen = recorder({ [SUMMARY_VARIABLE]: join(root, SUMMARY_FILE) });
  const code = await main(argv, root, seen.io);
  return { code, out: seen.out(), err: seen.err(), ids: idsIn(seen.err()), summary: textOf(join(root, SUMMARY_FILE)) };
}

// check

/** One run of a fake tool. */
interface ToolRun {
  pkg: string;
  args: string[];
  cwd: string;
  telemetry: string | null;
}

const RUNS = 'runs.jsonl';

/**
 * A fake package with one bin: it appends its run to `runs.jsonl` in its folder, prints one line on stdout and exits
 * with the code.
 */
function fakeTool(pkg: string, bin: string, code: number): Files {
  return {
    [`node_modules/${pkg}/package.json`]: json({ name: pkg, version: '1.0.0', bin: { [bin]: './bin/tool.cjs' } }),
    [`node_modules/${pkg}/bin/tool.cjs`]: [
      "const { appendFileSync } = require('node:fs');",
      'const run = {',
      `  pkg: ${JSON.stringify(pkg)},`,
      '  args: process.argv.slice(2),',
      '  cwd: process.cwd(),',
      '  telemetry: process.env.ASTRO_TELEMETRY_DISABLED ?? null,',
      '};',
      `appendFileSync(${JSON.stringify(RUNS)}, JSON.stringify(run) + '\\n');`,
      `process.stdout.write(${JSON.stringify(`${pkg}: done\n`)});`,
      `process.exitCode = ${code};`,
      '',
    ].join('\n'),
  };
}

/** The three tools of `check` with their exit codes. */
const tools = (codes: { biome?: number; eslint?: number; astro?: number } = {}): Files => ({
  ...fakeTool('@biomejs/biome', 'biome', codes.biome ?? 0),
  ...fakeTool('eslint', 'eslint', codes.eslint ?? 0),
  ...fakeTool('astro', 'astro', codes.astro ?? 0),
});

/** The runs of the fake tools, in order. `here` says whether the tool ran in the project root. */
function runsOf(root: string): (Omit<ToolRun, 'cwd'> & { here: boolean })[] {
  const text = textOf(join(root, RUNS)) ?? '';
  const runs = text
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line) as ToolRun);
  return runs.map(({ pkg, args, cwd, telemetry }) => ({ pkg, args, telemetry, here: cwd === realpathSync(root) }));
}

const BIOME_RUN = {
  pkg: '@biomejs/biome',
  args: ['ci', '--colors=off', '--error-on-warnings', '.'],
  telemetry: '1',
  here: true,
};
const ESLINT_RUN = { pkg: 'eslint', args: ['--max-warnings', '0', 'src'], telemetry: '1', here: true };
const ASTRO_RUN = { pkg: 'astro', args: ['check'], telemetry: '1', here: true };

/** The smallest project with islands on. */
const ISLANDS_SETTINGS = { ...SETTINGS, features: { islands: true } };
const ISLANDS: Files = { ...SMALLEST, 'astro-kit.json': json(ISLANDS_SETTINGS), [ISLANDS_SHIM_FILE]: ISLANDS_SHIM };

/** An island of the project, so that `check` runs ESLint. */
const ISLAND = { 'src/lib/island.tsx': 'export default function Island() {\n  return <p>Hi</p>;\n}\n' };

test('the row of check in 6.4 names its steps, and the usage names check', () => {
  assert.equal(
    SPEC.includes(
      '| `check` | | Preflight (with the forms shim, `config-shim`); the comparison of the other feature shim (`eslint.config.mjs`); `biome ci --colors=off --error-on-warnings .`; with islands and any `src/**/*.tsx`, `eslint --max-warnings 0 src`; `astro check`',
    ),
    true,
  );
  assert.match(USAGE, /^ {2}check {13}\S/m);
});

test('astro-kit check on a project that passes preflight runs biome ci and astro check, then the passed line', async () => {
  const seen = await inTempAsync({ ...SMALLEST, ...tools() }, async (root) => ({
    ...(await cli(root, ['check'])),
    runs: runsOf(root),
  }));
  assert.deepEqual(seen.runs, [BIOME_RUN, ASTRO_RUN]);
  assert.deepEqual({ code: seen.code, err: seen.err, summary: seen.summary }, { code: 0, err: '', summary: undefined });
  // The output of each tool comes on, and the passed line is the last line on stdout, once (6.4).
  assert.equal(seen.out, `@biomejs/biome: done\nastro: done\n${PASSED}`);
});

test('astro-kit check with a preflight finding prints it, runs no tool and prints no passed line', async () => {
  const files = { ...SMALLEST, ...tools(), 'src/a.ts': '// @ts-ignore\nexport const a = 1;\n' };
  const seen = await inTempAsync(files, async (root) => ({ ...(await cli(root, ['check'])), runs: runsOf(root) }));
  assert.deepEqual(
    { code: seen.code, ids: seen.ids, runs: seen.runs },
    { code: 1, ids: ['config-suppression'], runs: [] },
  );
  assert.equal(passedIn(seen.out + seen.err), 0);
  assert.equal(seen.out, '');
  // The findings go to the job summary inside a `text` fence.
  assert.match(seen.summary ?? '', /^\n```text\nastro-kit: 1 finding\n✗ \[config-suppression\] src\/a\.ts/);
});

test('astro-kit check stops at the first tool that fails: a failing biome ci runs no astro check', async () => {
  const seen = await inTempAsync({ ...SMALLEST, ...tools({ biome: 1 }) }, async (root) => ({
    ...(await cli(root, ['check'])),
    runs: runsOf(root),
  }));
  assert.deepEqual(seen.runs, [BIOME_RUN]);
  assert.deepEqual({ code: seen.code, out: seen.out }, { code: 1, out: '@biomejs/biome: done\n' });
  assert.equal(seen.summary, '\n@biomejs/biome ci --colors=off --error-on-warnings . failed; see the job log.\n');
});

for (const astro of [1, 3]) {
  test(`astro-kit check with astro check ending with ${astro} ends with 1 and no passed line`, async () => {
    const seen = await inTempAsync({ ...SMALLEST, ...tools({ astro }) }, async (root) => ({
      ...(await cli(root, ['check'])),
      runs: runsOf(root),
    }));
    assert.deepEqual(seen.runs, [BIOME_RUN, ASTRO_RUN]);
    assert.deepEqual({ code: seen.code, passed: passedIn(seen.out) }, { code: 1, passed: 0 });
    assert.equal(seen.summary, '\nastro check failed; see the job log.\n');
  });
}

test('astro-kit check with islands and a .tsx source runs ESLint between biome ci and astro check', async () => {
  const seen = await inTempAsync({ ...ISLANDS, ...ISLAND, ...tools() }, async (root) => ({
    ...(await cli(root, ['check'])),
    runs: runsOf(root),
  }));
  assert.deepEqual(seen.runs, [BIOME_RUN, ESLINT_RUN, ASTRO_RUN]);
  assert.deepEqual({ code: seen.code, ids: seen.ids }, { code: 0, ids: [] });
  assert.equal(seen.out.endsWith(`eslint: done\nastro: done\n${PASSED}`), true);
});

test('astro-kit check runs no ESLint without a .tsx source, and none without islands', async () => {
  const deep = { 'src/lib/a/b/island.jsx': 'export default 1;\n' };
  const islands = await inTempAsync({ ...ISLANDS, ...deep, ...tools() }, async (root) => {
    await cli(root, ['check']);
    return runsOf(root);
  });
  const off = await inTempAsync({ ...SMALLEST, ...ISLAND, ...tools() }, async (root) => {
    await cli(root, ['check']);
    return runsOf(root);
  });
  assert.deepEqual(islands, [BIOME_RUN, ASTRO_RUN]);
  assert.deepEqual(off, [BIOME_RUN, ASTRO_RUN]);
});

test('astro-kit check finds a .tsx source at any depth under src/', async () => {
  const deep = { 'src/lib/a/b/deep.tsx': 'export default function Deep() {\n  return <p />;\n}\n' };
  const runs = await inTempAsync({ ...ISLANDS, ...deep, ...tools({ eslint: 1 }) }, async (root) => {
    const seen = await cli(root, ['check']);
    assert.equal(seen.code, 1);
    assert.equal(seen.summary, '\neslint --max-warnings 0 src failed; see the job log.\n');
    return runsOf(root);
  });
  assert.deepEqual(runs, [BIOME_RUN, ESLINT_RUN]);
});

test('astro-kit check with islands compares eslint.config.mjs with the islands shim (config-shim)', async () => {
  const missing = { ...ISLANDS, ...tools() };
  delete (missing as Record<string, unknown>)[ISLANDS_SHIM_FILE];
  const changed = { ...ISLANDS, ...tools(), [ISLANDS_SHIM_FILE]: ISLANDS_SHIM.replace('jsx: true', 'jsx: false') };
  const crlf = { ...ISLANDS, ...tools(), [ISLANDS_SHIM_FILE]: ISLANDS_SHIM.replaceAll('\n', '\r\n') };
  const results: unknown[] = [];
  for (const files of [missing, changed, crlf]) {
    results.push(
      await inTempAsync(files, async (root) => {
        const seen = await cli(root, ['check']);
        const places = [...seen.err.matchAll(/✗ \[config-shim\] ([^:]+(?::\d+)?): /g)].map((match) => match[1]);
        return { code: seen.code, ids: seen.ids, places, runs: runsOf(root).length };
      }),
    );
  }
  const line = ISLANDS_SHIM.split('\n').findIndex((text) => text.includes('jsx: true')) + 1;
  assert.deepEqual(results, [
    { code: 1, ids: ['config-shim'], places: [ISLANDS_SHIM_FILE], runs: 0 },
    { code: 1, ids: ['config-shim'], places: [`${ISLANDS_SHIM_FILE}:${line}`], runs: 0 },
    // CRLF counts as LF, as for every shim.
    { code: 0, ids: [], places: [], runs: 2 },
  ]);
});

test('astro-kit check without islands does not compare eslint.config.mjs', async () => {
  const files = { ...SMALLEST, ...tools(), [ISLANDS_SHIM_FILE]: 'export default [];\n' };
  const seen = await inTempAsync(files, (root) => cli(root, ['check']));
  assert.deepEqual({ code: seen.code, ids: seen.ids }, { code: 0, ids: [] });
});

test('astro-kit check with settings that are not valid prints config-options and runs no tool', async () => {
  const files = { ...SMALLEST, ...tools(), 'astro-kit.json': json({ ...SETTINGS, site: 'http://example.ch' }) };
  const seen = await inTempAsync(files, async (root) => ({ ...(await cli(root, ['check'])), runs: runsOf(root) }));
  assert.deepEqual({ code: seen.code, ids: seen.ids, runs: seen.runs }, { code: 1, ids: ['config-options'], runs: [] });
});

/** What a `check` without Biome gave. `above` is a Biome in a folder above the temp folder: then nothing ran. */
interface WithoutBiome {
  above: string | undefined;
  result?: unknown;
}

test('astro-kit check without Biome: the message of 6.4, 1, and no other tool', async () => {
  const files = { ...SMALLEST, ...fakeTool('astro', 'astro', 0) };
  const seen = await inTempAsync(files, async (root): Promise<WithoutBiome> => {
    // A Biome above the temp folder would run on the folder; 14.1 forbids that, so the test stops.
    const above = findBin(root, '@biomejs/biome', 'biome');
    if (above !== undefined) return { above };
    const run = await cli(root, ['check']);
    return { above, result: { code: run.code, err: run.err, runs: runsOf(root) } };
  });
  assert.deepEqual(seen, {
    above: undefined,
    result: {
      code: 1,
      err: 'astro-kit: @biomejs/biome is not installed; run npm ci --ignore-scripts\n',
      runs: [],
    },
  });
});

test('the command line loads preflight only for check: ci.ts imports it with import()', () => {
  const source = readFileSync(new URL('../../src/ci.ts', import.meta.url), 'utf8');
  assert.equal(/^import [^;]*'\.\/preflight\.ts';/m.test(source), false);
  assert.equal(source.includes("import('./preflight.ts')"), true);
});

// legal

const LEGAL_RULE = getRule('legal-approved');

/** A built page with a header, a `main` and a footer. */
const builtPage = (title: string, content: string): string =>
  `<!DOCTYPE html><html lang="de-CH"><head><title>${title}</title></head><body><header>Example</header><main><h1>${title}</h1> ${content}</main><footer><a href="/impressum/">Impressum</a></footer></body></html>`;

const IMPRESSUM = builtPage('Impressum', '<p>Example AG betreibt\n   diese Website.</p>');
const DATENSCHUTZ = builtPage('Datenschutz', '<p>Diese Website setzt kein Cookie.</p><p hidden>Entwurf</p>');

/** The legal texts of the two pages: the visible text of `main`, each run of white space as one space. */
const IMPRESSUM_TEXT = 'Impressum Example AG betreibt diese Website.';
const DATENSCHUTZ_TEXT = 'Datenschutz Diese Website setzt kein Cookie.';

/** The file that `legal --write` writes for the two pages: sorted keys, two spaces, a final newline (6.4). */
const LOCK = `{\n  "/datenschutz/": "${sha256(DATENSCHUTZ_TEXT)}",\n  "/impressum/": "${sha256(IMPRESSUM_TEXT)}"\n}\n`;

/** A project with the smallest settings and a build in `dist` (or in `folder`). */
const built = (folder = 'dist', pages: Files = {}): Files => ({
  'astro-kit.json': json(SETTINGS),
  [`${folder}/index.html`]: builtPage('Startseite', '<p>Willkommen.</p>'),
  [`${folder}/impressum/index.html`]: IMPRESSUM,
  [`${folder}/datenschutz/index.html`]: DATENSCHUTZ,
  ...pages,
});

const WROTE = `astro-kit legal: wrote ${LOCK_FILE}\n`;

test('the row of legal in 6.4, its message for a project with no build, and the file of 5.6', () => {
  assert.equal(
    SPEC.includes(
      '| `legal` | `--write` \\| `--check` (exactly one) | Needs `dist`. `--write` writes `legal.lock.json`: one hash for each declared legal path that is built (`legal-approved`, 8), with sorted keys, two-space indentation and a final newline. `--check` prints each path whose hash differs.',
    ),
    true,
  );
  assert.equal(SPEC.includes('**`legal.lock.json`** (root): `{ "<legal page path>": "sha256-…" }`'), true);
  assert.equal(SPEC.includes(`without either it fails with \`${LEGAL_NO_BUILD}\``), true);
  assert.equal(SPEC.includes(`\`--write\` prints \`astro-kit legal: wrote ${LOCK_FILE}\``), true);
});

test('astro-kit legal --write writes the lock, and --check passes with the passed line', async () => {
  const seen = await inTempAsync(built(), async (root) => {
    const write = await cli(root, ['legal', '--write']);
    const lock = textOf(join(root, LOCK_FILE));
    const check = await cli(root, ['legal', '--check']);
    return { write, lock, check };
  });
  // `legal --write` runs no check, so it prints no passed line (6.4).
  assert.deepEqual(seen.write, { code: 0, out: WROTE, err: '', ids: [], summary: undefined });
  assert.equal(seen.lock, LOCK);
  assert.deepEqual(seen.check, { code: 0, out: PASSED, err: '', ids: [], summary: undefined });
});

test('astro-kit legal reads the client directory dist/client/ of a forms build', async () => {
  const seen = await inTempAsync(built('dist/client'), async (root) => {
    await cli(root, ['legal', '--write']);
    return textOf(join(root, LOCK_FILE));
  });
  assert.equal(seen, LOCK);
});

test('astro-kit legal --check fails one changed word at the page, with both hashes, and no passed line', async () => {
  const changed = DATENSCHUTZ.replace('kein Cookie', 'ein Cookie');
  const files = { ...built(), [LOCK_FILE]: LOCK, 'dist/datenschutz/index.html': changed };
  const seen = await inTempAsync(files, (root) => cli(root, ['legal', '--check']));
  assert.deepEqual({ code: seen.code, ids: seen.ids, out: seen.out }, { code: 1, ids: ['legal-approved'], out: '' });
  const now = sha256('Datenschutz Diese Website setzt ein Cookie.');
  assert.equal(
    seen.err.split('\n')[1],
    `✗ [legal-approved] /datenschutz/: ${LEGAL_RULE.message} (the legal text hashes to ${now}, and ${LOCK_FILE} holds ${sha256(DATENSCHUTZ_TEXT)})`,
  );
  assert.match(seen.summary ?? '', /✗ \[legal-approved\] \/datenschutz\//);
});

test('astro-kit legal --check passes a change outside main, in a hidden part, or of white space only', async () => {
  const pages = {
    'dist/impressum/index.html': IMPRESSUM.replace('<header>Example</header>', '<header>Example AG</header>')
      .replace('betreibt\n   diese', 'betreibt diese')
      .replace('</main>', '<div aria-hidden="true">Alt</div><template>Vorlage</template></main>'),
    'dist/datenschutz/index.html': DATENSCHUTZ.replace('Entwurf', 'Ein anderer Entwurf'),
  };
  const seen = await inTempAsync({ ...built(), [LOCK_FILE]: LOCK, ...pages }, (root) =>
    cli(root, ['legal', '--check']),
  );
  assert.deepEqual({ code: seen.code, out: seen.out }, { code: 0, out: PASSED });
});

test('astro-kit legal --write writes only the declared pages that are built; --check leaves the others alone', async () => {
  const files = built();
  delete (files as Record<string, unknown>)['dist/datenschutz/index.html'];
  const seen = await inTempAsync(files, async (root) => {
    await cli(root, ['legal', '--write']);
    const lock = textOf(join(root, LOCK_FILE));
    return { lock, check: await cli(root, ['legal', '--check']) };
  });
  assert.equal(seen.lock, `{\n  "/impressum/": "${sha256(IMPRESSUM_TEXT)}"\n}\n`);
  assert.equal(seen.check.code, 0);
});

test('astro-kit legal --write with no declared page built writes {}', async () => {
  const files = { 'astro-kit.json': json(SETTINGS), 'dist/index.html': builtPage('Startseite', '') };
  const lock = await inTempAsync(files, async (root) => {
    await cli(root, ['legal', '--write']);
    return textOf(join(root, LOCK_FILE));
  });
  assert.equal(lock, '{}\n');
});

interface LockCase {
  name: string;
  /** The text of `legal.lock.json`, or `undefined` for no file. */
  lock: string | undefined;
  /** The place and detail of each finding. */
  findings: string[];
}

const LOCK_CASES: readonly LockCase[] = [
  {
    name: 'no file: each built page has no entry',
    lock: undefined,
    findings: [
      `/datenschutz/: ${LEGAL_RULE.message} (${LOCK_FILE} has no entry for this page)`,
      `/impressum/: ${LEGAL_RULE.message} (${LOCK_FILE} has no entry for this page)`,
    ],
  },
  {
    name: 'an empty lock',
    lock: '{}\n',
    findings: [
      `/datenschutz/: ${LEGAL_RULE.message} (${LOCK_FILE} has no entry for this page)`,
      `/impressum/: ${LEGAL_RULE.message} (${LOCK_FILE} has no entry for this page)`,
    ],
  },
  {
    name: 'a text that is not JSON',
    lock: '{"/impressum/": ',
    findings: [`${LOCK_FILE}: ${LEGAL_RULE.message} (the file is not valid JSON)`],
  },
  {
    name: 'a JSON list',
    lock: '[]\n',
    findings: [`${LOCK_FILE}: ${LEGAL_RULE.message} (the file is not a JSON object)`],
  },
  {
    name: 'an other key',
    lock: LOCK.replace('{\n', '{\n  "/alt/": "sha256-x",\n'),
    findings: [`${LOCK_FILE}: /alt/: ${LEGAL_RULE.message} (no declared legal path has this key)`],
  },
  {
    name: 'a value that is not a text',
    lock: LOCK.replace(`"${sha256(IMPRESSUM_TEXT)}"`, '7'),
    findings: [
      `/impressum/: ${LEGAL_RULE.message} (the legal text hashes to ${sha256(IMPRESSUM_TEXT)}, and ${LOCK_FILE} holds 7)`,
    ],
  },
  {
    name: 'a key of a declared page that is not built: legal-pages reports the page',
    lock: LOCK.replace('{\n', '{\n  "/fr/mentions-legales/": "sha256-x",\n'),
    findings: [],
  },
];

for (const c of LOCK_CASES) {
  test(`astro-kit legal --check: ${c.name}`, async () => {
    const settings = {
      ...SETTINGS,
      legal: {
        legalNote: { de: '/impressum/', fr: '/fr/mentions-legales/' },
        privacy: { de: '/datenschutz/', fr: '/fr/protection-des-donnees/' },
      },
    };
    const locales = [...SETTINGS.locales, { code: 'fr', tag: 'fr-CH', name: 'Français' }];
    const files: Files = {
      ...built(),
      'astro-kit.json': json({ ...settings, locales }),
      ...(c.lock === undefined ? {} : { [LOCK_FILE]: c.lock }),
    };
    const seen = await inTempAsync(files, (root) => cli(root, ['legal', '--check']));
    const findings = [...seen.err.matchAll(/^✗ \[legal-approved\] (.*)$/gm)].map((match) => match[1]);
    assert.deepEqual(findings, c.findings);
    assert.equal(seen.code, c.findings.length > 0 ? 1 : 0);
    assert.equal(passedIn(seen.out), c.findings.length > 0 ? 0 : 1);
  });
}

test('astro-kit legal without a build throws the message and gives 1, and writes nothing', async () => {
  const seen = await inTempAsync(
    { 'astro-kit.json': json(SETTINGS), 'dist/impressum/index.html': IMPRESSUM },
    async (root) => ({
      write: await cli(root, ['legal', '--write']),
      check: await cli(root, ['legal', '--check']),
      lock: existsSync(join(root, LOCK_FILE)),
    }),
  );
  const failed = { code: 1, out: '', err: `${LEGAL_NO_BUILD}\n`, ids: [], summary: undefined };
  assert.deepEqual(seen, { write: failed, check: failed, lock: false });
});

test('astro-kit legal with settings that are not valid gives config-options and writes nothing', async () => {
  const files = { ...built(), 'astro-kit.json': json({ ...SETTINGS, legal: { privacy: { de: 'datenschutz' } } }) };
  const seen = await inTempAsync(files, async (root) => ({
    write: await cli(root, ['legal', '--write']),
    lock: existsSync(join(root, LOCK_FILE)),
  }));
  assert.deepEqual(
    { code: seen.write.code, ids: seen.write.ids, lock: seen.lock },
    { code: 1, ids: ['config-options'], lock: false },
  );
});

test('astro-kit legal --write overwrites an old lock, and the lock passes the build rule on the same pages', async () => {
  const seen = await inTempAsync({ ...built(), [LOCK_FILE]: '{"/impressum/": "sha256-old"}\n' }, async (root) => {
    const before = await cli(root, ['legal', '--check']);
    await cli(root, ['legal', '--write']);
    return {
      before: before.ids,
      lock: textOf(join(root, LOCK_FILE)),
      after: (await cli(root, ['legal', '--check'])).code,
    };
  });
  assert.deepEqual(seen, { before: ['legal-approved'], lock: LOCK, after: 0 });
});

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { findBin } from '../../src/ci.ts';
import { type Io, main, outcome, USAGE } from '../../src/cli.ts';
import { type Finding, getRule } from '../../src/registry.ts';
import { type Files, inTemp, inTempAsync, json, SMALLEST } from './fixtures.ts';
import { SPEC, specBlock } from './spec.ts';

/** The source of the command line. The bin of the package is its build, `dist/cli.js`. */
const CLI = fileURLToPath(new URL('../../src/cli.ts', import.meta.url));

const SUMMARY_VARIABLE = 'GITHUB_STEP_SUMMARY';
const SUMMARY_FILE = 'summary.md';
const TOKENS_FILE = 'src/styles/tokens.css';

/** The text of a file, or `undefined` when it does not exist. */
const textOf = (file: string): string | undefined => (existsSync(file) ? readFileSync(file, 'utf8') : undefined);

/** The sorted, unique rule ids in the output of a command, parsed as 6.4 says. */
const idsIn = (output: string): string[] =>
  [...new Set([...output.matchAll(/✗ \[([a-z0-9-]+)\]/g)].map((match) => match[1] ?? ''))].sort();

/** A text inside the fence of the job summary, as the summary file holds it. */
const inSummary = (text: string): string => `\n\`\`\`text\n${text}\n\`\`\`\n`;

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

// The usage

/** The commands of 6.4 that a later milestone adds (M6 and M9). */
const LATER = ['init', 'check', 'test', 'ci', 'smoke', 'routes', 'provision', 'feedback', 'settings', 'legal'] as const;

test('the usage names the commands of this milestone and no later one', () => {
  assert.equal(USAGE.includes('npx --no astro-kit <command>'), true);
  assert.equal(SPEC.includes('In the project root: `npx --no astro-kit <command>`.'), true);
  const commands = [...USAGE.matchAll(/^ {2}(\S+(?: \[--[a-z]+\])?) {2,}\S/gm)].map((match) => match[1]);
  assert.deepEqual(commands, ['build', 'tokens [--check]', 'help']);
  assert.equal(USAGE.endsWith('\n'), false);
});

test('the exit codes of the usage are the ones of the table of 6.4', () => {
  assert.equal(SPEC.includes('| `help`, `--help`, none | | Usage on stdout | 0 | |'), true);
  assert.equal(SPEC.includes('| unknown, or a bad subcommand | | Usage on stderr | 2 | |'), true);
  assert.equal(SPEC.includes('| `build` | | `astro build` | tool code | no |'), true);
});

for (const argv of [[], ['help'], ['--help']]) {
  test(`astro-kit ${argv.join(' ')}: the usage on stdout, 0`, async () => {
    const seen = recorder();
    const code = await main(argv, '/no/such/folder', seen.io);
    assert.deepEqual({ code, out: seen.out(), err: seen.err() }, { code: 0, out: `${USAGE}\n`, err: '' });
  });
}

const USAGE_ERRORS: readonly (readonly string[])[] = [
  ['nope'],
  ...LATER.map((command) => [command]),
  ['routes', 'import', 'sitemap.xml'],
  ['feedback', 'send'],
  ['-h'],
  ['--check'],
  ['Build'],
  [''],
  ['help', 'tokens'],
  ['--help', '--check'],
  ['build', '--check'],
  ['build', 'extra'],
  ['tokens', '--x'],
  ['tokens', 'extra'],
  ['tokens', '--check', 'extra'],
  ['tokens', '--check=true'],
  ['tokens', '-c'],
];

for (const argv of USAGE_ERRORS) {
  test(`astro-kit ${argv.join(' ')}: the usage on stderr, 2`, async () => {
    const seen = recorder();
    const code = await main(argv, '/no/such/folder', seen.io);
    assert.deepEqual({ code, out: seen.out(), err: seen.err() }, { code: 2, out: '', err: `${USAGE}\n` });
  });
}

// Lazy loading

test('the command line starts with the shebang line of a bin', () => {
  assert.equal(readFileSync(CLI, 'utf8').startsWith('#!/usr/bin/env node\n'), true);
});

test('the command line loads no module of the kit at the start: each static import is a type or a Node built-in', () => {
  const source = readFileSync(CLI, 'utf8');
  const imports = [
    ...source.matchAll(/^import\s+(type\s+)?(?:[^;'"]*?\sfrom\s+)?['"]([^'"]+)['"];/gm),
    ...source.matchAll(/^export\s+(type\s+)?[^;'"]*?\sfrom\s+['"]([^'"]+)['"];/gm),
  ].map((match) => ({ type: match[1] !== undefined, from: match[2] ?? '' }));
  assert.deepEqual(
    imports.filter((entry) => !entry.type && !entry.from.startsWith('node:')),
    [],
  );
  // The pattern finds the imports that the file has, and the file loads the commands with import().
  assert.equal(
    imports.some((entry) => entry.from === './ci.ts' && entry.type),
    true,
  );
  assert.equal(source.includes("await import('./ci.ts')"), true);
});

// The outcome mapping

const LOCKED = getRule('config-locked');
const FINDING: Finding = { rule: 'config-locked', where: 'build.format', detail: 'file instead of directory' };
const WAIVED: Finding = { rule: 'config-locked', where: 'site', waived: { until: '2026-12-01', reason: 'a reason' } };

/** The finding format of 6.4, filled in for `FINDING`. */
const FINDING_TEXT = specBlock('**Finding format** (exact)', 'text')
  .replace('<n> finding(s)', '1 finding')
  .replaceAll('<id>', 'config-locked')
  .replace('<where>', 'build.format')
  .replace('<message>', LOCKED.message)
  .replace('<detail>', 'file instead of directory')
  .replace('<hint>', LOCKED.hint);

const WAIVED_LINE = `~ [config-locked] site: ${LOCKED.message} (waived until 2026-12-01: a reason)`;

test('the finding text of the tests has the four lines of 6.4', () => {
  assert.deepEqual(FINDING_TEXT.split('\n'), [
    'astro-kit: 1 finding',
    `✗ [config-locked] build.format: ${LOCKED.message} (file instead of directory)`,
    `    fix: ${LOCKED.hint}`,
    '    rule: node_modules/@raess/astro-kit/docs/standards.md#config-locked',
  ]);
});

interface OutcomeCase {
  name: string;
  value: unknown;
  code: number;
  /** The text on stderr and in the job summary, without the final newline. `undefined`: nothing is printed. */
  text?: string;
}

const OUTCOME_CASES: readonly OutcomeCase[] = [
  { name: 'an empty findings array', value: [], code: 0 },
  { name: 'an object with no findings', value: { findings: [] }, code: 0 },
  { name: 'a findings array', value: [FINDING], code: 1, text: FINDING_TEXT },
  { name: 'an object with findings', value: { findings: [FINDING], written: false }, code: 1, text: FINDING_TEXT },
  {
    name: 'a waived finding fails nothing',
    value: [WAIVED],
    code: 0,
    text: `${WAIVED_LINE}\nastro-kit: all checks passed.`,
  },
  {
    name: 'a waived finding does not count beside a finding that fails',
    value: { findings: [WAIVED, FINDING] },
    code: 1,
    text: ['astro-kit: 1 finding', WAIVED_LINE, ...FINDING_TEXT.split('\n').slice(1)].join('\n'),
  },
  { name: 'the number 0', value: 0, code: 0 },
  { name: 'the number 1', value: 1, code: 1 },
  { name: 'the number 7', value: 7, code: 7 },
  { name: 'false', value: false, code: 1 },
  { name: 'true', value: true, code: 0 },
  { name: 'undefined', value: undefined, code: 0 },
  { name: 'null', value: null, code: 0 },
  { name: 'a text', value: 'failed', code: 0 },
  { name: 'an object without findings', value: { written: true }, code: 0 },
  { name: 'an object whose findings are no list', value: { findings: 3 }, code: 0 },
];

for (const c of OUTCOME_CASES) {
  test(`outcome: ${c.name}`, async () => {
    const seen = await inTempAsync({}, async (root) => {
      const seenIo = recorder({ [SUMMARY_VARIABLE]: join(root, SUMMARY_FILE) });
      const code = await outcome(c.value, seenIo.io);
      return { code, out: seenIo.out(), err: seenIo.err(), summary: textOf(join(root, SUMMARY_FILE)) };
    });
    assert.deepEqual(seen, {
      code: c.code,
      out: '',
      err: c.text === undefined ? '' : `${c.text}\n`,
      summary: c.text === undefined ? undefined : inSummary(c.text),
    });
  });
}

test('outcome without GITHUB_STEP_SUMMARY prints the findings and writes no file', async () => {
  const seen = recorder({ [SUMMARY_VARIABLE]: '' });
  const code = await outcome([FINDING], seen.io);
  assert.deepEqual({ code, err: seen.err() }, { code: 1, err: `${FINDING_TEXT}\n` });
});

test('outcome rejects for a list that holds something else than findings', async () => {
  await assert.rejects(outcome([FINDING, 'text'], recorder().io), {
    message: 'astro-kit: a command returned a list that is not findings',
  });
});

// build

interface Run {
  args: string[];
  cwd: string;
  telemetry: string | null;
}

/** A fake `astro`: it records its arguments, prints one line on each stream and exits with the code. */
function fakeAstro(code: number, bin: unknown = { astro: './bin/astro.mjs' }): Files {
  return {
    'node_modules/astro/package.json': json({ name: 'astro', version: '1.0.0', bin }),
    'node_modules/astro/bin/astro.mjs': [
      "import { writeFileSync } from 'node:fs';",
      "import { join } from 'node:path';",
      'const run = {',
      '  args: process.argv.slice(2),',
      '  cwd: process.cwd(),',
      '  telemetry: process.env.ASTRO_TELEMETRY_DISABLED ?? null,',
      '};',
      "writeFileSync(join(import.meta.dirname, '../run.json'), JSON.stringify(run));",
      "process.stdout.write('fake astro: stdout\\n');",
      "process.stderr.write('fake astro: stderr\\n');",
      `process.exitCode = ${code};`,
      '',
    ].join('\n'),
  };
}

function runOf(root: string): Run | undefined {
  const text = textOf(join(root, 'node_modules/astro/run.json'));
  if (text === undefined) return undefined;
  const run: Run = JSON.parse(text);
  return run;
}

for (const code of [0, 1, 5]) {
  test(`astro-kit build runs astro build and gives its code ${code}`, async () => {
    const seen = await inTempAsync(fakeAstro(code), async (root) => {
      const seenIo = recorder({ [SUMMARY_VARIABLE]: join(root, SUMMARY_FILE) });
      const result = await main(['build'], root, seenIo.io);
      return {
        result,
        out: seenIo.out(),
        err: seenIo.err(),
        run: runOf(root),
        root: realpathSync(root),
        summary: textOf(join(root, SUMMARY_FILE)),
      };
    });
    assert.equal(seen.result, code);
    assert.equal(seen.out, 'fake astro: stdout\n');
    assert.equal(seen.err, 'fake astro: stderr\n');
    assert.deepEqual(seen.run, { args: ['build'], cwd: seen.root, telemetry: '1' });
    assert.equal(seen.summary, code === 0 ? undefined : '\nastro build failed; see the job log.\n');
  });
}

/** What a `build` without astro gave. `above` is an astro in a folder above the temp folder: then nothing ran. */
interface WithoutAstro {
  above: string | undefined;
  result?: unknown;
}

test('astro-kit build without astro: the message of 6.4, 1', async () => {
  const seen = await inTempAsync({ 'astro-kit.json': json(SMALLEST) }, async (root): Promise<WithoutAstro> => {
    // The search for astro walks up from the temp folder. With an astro above it, `build` would run a real build
    // (14.1 forbids that). So the test stops here, and its failure names the path.
    const above = findBin(root, 'astro');
    if (above !== undefined) return { above };
    const seenIo = recorder();
    const code = await main(['build'], root, seenIo.io);
    return { above, result: { code, out: seenIo.out(), err: seenIo.err() } };
  });
  assert.equal(SPEC.includes('`astro-kit: <pkg> is not installed; run npm ci --ignore-scripts`'), true);
  assert.deepEqual(seen, {
    above: undefined,
    result: { code: 1, out: '', err: 'astro-kit: astro is not installed; run npm ci --ignore-scripts\n' },
  });
});

test('a thrown error prints its message and gives 1', async () => {
  const seen = await inTempAsync(fakeAstro(0, { other: './bin/astro.mjs' }), async (root) => {
    const seenIo = recorder();
    const code = await main(['build'], root, seenIo.io);
    return { code, out: seenIo.out(), err: seenIo.err(), ran: runOf(root) !== undefined };
  });
  assert.deepEqual(seen, { code: 1, out: '', err: 'astro-kit: astro has no bin astro\n', ran: false });
});

test('a usage error runs no tool', async () => {
  const seen = await inTempAsync(fakeAstro(0), async (root) => {
    const code = await main(['build', 'extra'], root, recorder().io);
    return { code, ran: runOf(root) !== undefined };
  });
  assert.deepEqual(seen, { code: 2, ran: false });
});

// tokens

/** The smallest design document: the theme `light`, one color, and one row of each required kind. */
const DESIGN_MD = [
  '## Themes',
  '',
  '| Theme | Use |',
  '|---|---|',
  '| light | The one theme. |',
  '',
  '## Color',
  '',
  '| Token | light | Use |',
  '|---|---|---|',
  '| `--color-text` | `#222222` | Text. |',
  '',
  '## Typography',
  '',
  '| Token | Value | Use |',
  '|---|---|---|',
  '| `--font-body` | `system-ui, sans-serif` | Body text. |',
  '| `--text-m` | `1rem` | Body text. |',
  '',
  '## Spacing',
  '',
  '| Token | Value | Use |',
  '|---|---|---|',
  '| `--space-2` | `0.5rem` | A small gap. |',
  '',
  '## Breakpoints',
  '',
  '| Name | Width | Use |',
  '|---|---|---|',
  '',
  '## Contrast pairs',
  '',
  '| Foreground | Background | Role | For |',
  '|---|---|---|---|',
  '| `--color-text` | `--color-text` | text | body |',
  '',
].join('\n');

/** The text of 7.7 for `DESIGN_MD` and the one option `auto`: the shape of setting 5. */
const TOKENS_CSS = [
  '/* Generated by @raess/astro-kit from docs/design.md. Do not edit: run npx --no astro-kit tokens. */',
  '@layer tokens {',
  '  :root {',
  '    color-scheme: light;',
  '    --color-text: #222222;',
  '    --font-body: system-ui, sans-serif;',
  '    --text-m: 1rem;',
  '    --space-2: 0.5rem;',
  '  }',
  '}',
  '',
].join('\n');

/** The rendering with one value changed by hand, in line 5. */
const CHANGED_CSS = TOKENS_CSS.replace('#222222', '#222223');

const PROJECT: Files = { 'astro-kit.json': json(SMALLEST), 'docs/design.md': DESIGN_MD };

const WROTE = 'astro-kit tokens: wrote src/styles/tokens.css\n';

test('astro-kit tokens writes the file; --check passes for it and fails after a change by hand', async () => {
  const seen = await inTempAsync(PROJECT, async (root) => {
    const css = join(root, TOKENS_FILE);
    const run = async (...argv: string[]) => {
      const seenIo = recorder({ [SUMMARY_VARIABLE]: join(root, SUMMARY_FILE) });
      const code = await main(argv, root, seenIo.io);
      return { code, out: seenIo.out(), ids: idsIn(seenIo.err()), css: textOf(css) };
    };
    const steps = [await run('tokens'), await run('tokens', '--check')];
    writeFileSync(css, CHANGED_CSS);
    steps.push(await run('tokens', '--check'), await run('tokens'), await run('tokens', '--check'));
    return steps;
  });
  assert.deepEqual(seen, [
    { code: 0, out: WROTE, ids: [], css: TOKENS_CSS },
    { code: 0, out: '', ids: [], css: TOKENS_CSS },
    { code: 1, out: '', ids: ['design-tokens'], css: CHANGED_CSS },
    { code: 0, out: WROTE, ids: [], css: TOKENS_CSS },
    { code: 0, out: '', ids: [], css: TOKENS_CSS },
  ]);
});

test('astro-kit tokens --check prints the finding with its place and its hint, also into the job summary', async () => {
  const seen = await inTempAsync({ ...PROJECT, [TOKENS_FILE]: CHANGED_CSS }, async (root) => {
    const seenIo = recorder({ [SUMMARY_VARIABLE]: join(root, SUMMARY_FILE) });
    const code = await main(['tokens', '--check'], root, seenIo.io);
    return { code, out: seenIo.out(), err: seenIo.err(), summary: textOf(join(root, SUMMARY_FILE)) };
  });
  assert.equal(seen.code, 1);
  assert.equal(seen.out, '');
  const lines = seen.err.split('\n');
  assert.equal(lines.length, 5);
  assert.equal(lines[0], 'astro-kit: 1 finding');
  assert.equal(
    lines[1]?.startsWith(`✗ [design-tokens] src/styles/tokens.css:5: ${getRule('design-tokens').message} (`),
    true,
  );
  assert.equal(lines[2], '    fix: run npx --no astro-kit tokens');
  assert.equal(lines[3], '    rule: node_modules/@raess/astro-kit/docs/standards.md#design-tokens');
  assert.equal(lines[4], '');
  assert.equal(seen.summary, inSummary(seen.err.slice(0, -1)));
});

interface TokensCase {
  name: string;
  files: Files;
  argv: readonly string[];
  ids: readonly string[];
  /** The text of tokens.css after the run, or `undefined` when the file must not exist. */
  css: string | undefined;
}

const BROKEN_MD = DESIGN_MD.replace('`1rem`', '`1 rem`');

const TOKENS_FAILURES: readonly TokensCase[] = [
  {
    name: 'a design document that is not valid: design-format, and nothing is written',
    files: { ...PROJECT, 'docs/design.md': BROKEN_MD },
    argv: ['tokens'],
    ids: ['design-format'],
    css: undefined,
  },
  {
    name: 'a design document that is not valid leaves an existing file as it is',
    files: { ...PROJECT, 'docs/design.md': BROKEN_MD, [TOKENS_FILE]: CHANGED_CSS },
    argv: ['tokens'],
    ids: ['design-format'],
    css: CHANGED_CSS,
  },
  {
    name: '--check with a design document that is not valid: design-format only',
    files: { ...PROJECT, 'docs/design.md': BROKEN_MD, [TOKENS_FILE]: CHANGED_CSS },
    argv: ['tokens', '--check'],
    ids: ['design-format'],
    css: CHANGED_CSS,
  },
  {
    name: 'no design document',
    files: { 'astro-kit.json': json(SMALLEST) },
    argv: ['tokens'],
    ids: ['design-format'],
    css: undefined,
  },
  {
    name: 'no settings',
    files: { 'docs/design.md': DESIGN_MD },
    argv: ['tokens'],
    ids: ['config-options'],
    css: undefined,
  },
  {
    name: 'a mode option without its theme: modes-themes, and nothing is written',
    files: { ...PROJECT, 'astro-kit.json': json({ ...SMALLEST, modes: { auto: true, dark: true } }) },
    argv: ['tokens'],
    ids: ['modes-themes'],
    css: undefined,
  },
  {
    name: '--check without the file',
    files: PROJECT,
    argv: ['tokens', '--check'],
    ids: ['design-tokens'],
    css: undefined,
  },
];

for (const c of TOKENS_FAILURES) {
  test(`astro-kit ${c.argv.join(' ')}: ${c.name}`, async () => {
    const seen = await inTempAsync(c.files, async (root) => {
      const seenIo = recorder({ [SUMMARY_VARIABLE]: join(root, SUMMARY_FILE) });
      const code = await main(c.argv, root, seenIo.io);
      return {
        code,
        out: seenIo.out(),
        ids: idsIn(seenIo.err()),
        css: textOf(join(root, TOKENS_FILE)),
        summaryIds: idsIn(textOf(join(root, SUMMARY_FILE)) ?? ''),
      };
    });
    assert.deepEqual(seen, { code: 1, out: '', ids: [...c.ids], css: c.css, summaryIds: [...c.ids] });
  });
}

// The process

interface Exit {
  status: number | null;
  stdout: string;
  stderr: string;
}

/** Runs the command line as a process in a folder, as `npx --no astro-kit` does. No test runs a real tool. */
function spawnCli(root: string, args: readonly string[], summaryFile = ''): Exit {
  const done = spawnSync(process.execPath, [CLI, ...args], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, NODE_TEST_CONTEXT: undefined, [SUMMARY_VARIABLE]: summaryFile },
    timeout: 60_000,
  });
  return { status: done.status, stdout: done.stdout, stderr: done.stderr };
}

test('the process: help gives the usage on stdout and the status 0', () => {
  const seen = inTemp({}, (root) => [spawnCli(root, []), spawnCli(root, ['help']), spawnCli(root, ['--help'])]);
  const usage: Exit = { status: 0, stdout: `${USAGE}\n`, stderr: '' };
  assert.deepEqual(seen, [usage, usage, usage]);
});

test('the process: an unknown command or flag gives the usage on stderr and the status 2', () => {
  const seen = inTemp({}, (root) => [
    spawnCli(root, ['nope']),
    spawnCli(root, ['tokens', '--x']),
    spawnCli(root, ['check']),
  ]);
  const usage: Exit = { status: 2, stdout: '', stderr: `${USAGE}\n` };
  assert.deepEqual(seen, [usage, usage, usage]);
});

test('the process: build has the status and the output of the tool, also from a folder below node_modules', () => {
  const seen = inTemp({ ...fakeAstro(5), 'cases/a/astro-kit.json': '{}' }, (root) => {
    const exit = spawnCli(join(root, 'cases/a'), ['build'], join(root, SUMMARY_FILE));
    return {
      exit,
      run: runOf(root),
      cwd: realpathSync(join(root, 'cases/a')),
      summary: textOf(join(root, SUMMARY_FILE)),
    };
  });
  assert.deepEqual(seen.exit, { status: 5, stdout: 'fake astro: stdout\n', stderr: 'fake astro: stderr\n' });
  assert.deepEqual(seen.run, { args: ['build'], cwd: seen.cwd, telemetry: '1' });
  assert.equal(seen.summary, '\nastro build failed; see the job log.\n');
});

test('the process: build without astro gives the status 1', () => {
  const seen = inTemp({}, (root): WithoutAstro => {
    // As above: with an astro in a folder above the temp folder, the process is not started.
    const above = findBin(root, 'astro');
    return above === undefined ? { above, result: spawnCli(root, ['build']) } : { above };
  });
  assert.deepEqual(seen, {
    above: undefined,
    result: { status: 1, stdout: '', stderr: 'astro-kit: astro is not installed; run npm ci --ignore-scripts\n' },
  });
});

test('the process: tokens writes the file, and tokens --check has the status 1 after a change by hand', () => {
  const seen = inTemp(PROJECT, (root) => {
    const css = join(root, TOKENS_FILE);
    const summaryFile = join(root, SUMMARY_FILE);
    const step = (...args: string[]) => {
      const exit = spawnCli(root, args, summaryFile);
      return { status: exit.status, stdout: exit.stdout, ids: idsIn(exit.stderr), css: textOf(css) };
    };
    const steps = [step('tokens'), step('tokens', '--check')];
    const before = textOf(summaryFile);
    writeFileSync(css, CHANGED_CSS);
    steps.push(step('tokens', '--check'), step('tokens'), step('tokens', '--check'));
    return { steps, before, summaryIds: idsIn(textOf(summaryFile) ?? '') };
  });
  assert.deepEqual(seen.steps, [
    { status: 0, stdout: WROTE, ids: [], css: TOKENS_CSS },
    { status: 0, stdout: '', ids: [], css: TOKENS_CSS },
    { status: 1, stdout: '', ids: ['design-tokens'], css: CHANGED_CSS },
    { status: 0, stdout: WROTE, ids: [], css: TOKENS_CSS },
    { status: 0, stdout: '', ids: [], css: TOKENS_CSS },
  ]);
  assert.equal(seen.before, undefined);
  assert.deepEqual(seen.summaryIds, ['design-tokens']);
});

test('the process: a design document that is not valid gives the status 1 and no file', () => {
  const seen = inTemp({ ...PROJECT, 'docs/design.md': BROKEN_MD }, (root) => {
    const exit = spawnCli(root, ['tokens']);
    return { status: exit.status, stdout: exit.stdout, ids: idsIn(exit.stderr), css: textOf(join(root, TOKENS_FILE)) };
  });
  assert.deepEqual(seen, { status: 1, stdout: '', ids: ['design-format'], css: undefined });
});

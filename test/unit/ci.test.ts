import assert from 'node:assert/strict';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  build,
  type Env,
  FINDING_LINE,
  fenced,
  findBin,
  notInstalled,
  runTool,
  SUMMARY_VARIABLE,
  summary,
  TOKENS_FILE,
  type ToolIo,
  tokens,
  toolFailed,
} from '../../src/ci.ts';
import { DOCS_PATH, type Finding, failures, formatFindings, getRule } from '../../src/registry.ts';
import { type Files, inTemp, inTempAsync, json, SMALLEST } from './fixtures.ts';
import { SPEC, specBlock } from './spec.ts';

/** The root of the kit repository. Its `node_modules` holds the real packages; no test runs one of them. */
const KIT_ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** The text of a file, or `undefined` when it does not exist. */
const textOf = (file: string): string | undefined => (existsSync(file) ? readFileSync(file, 'utf8') : undefined);

/** The sorted, unique rule ids of the findings that fail. */
const idsOf = (findings: readonly Finding[]): string[] =>
  [...new Set(failures(findings).map((finding) => finding.rule))].sort();

// The fixed texts of 6.4

test('the fixed texts of the tool runner are the ones of 6.4', () => {
  assert.equal(SPEC.includes(`the lines matching \`${String(FINDING_LINE)}\` to \`${SUMMARY_VARIABLE}\``), true);
  assert.equal(SPEC.includes(`A missing package fails with \`${notInstalled('<pkg>')}\`.`), true);
  assert.equal(SPEC.includes(`or \`${toolFailed('<pkg>', ['<args>'])}\` when there are none.`), true);
  assert.equal(SPEC.includes('Env: `ASTRO_TELEMETRY_DISABLED=1`.'), true);
  assert.equal(fenced('a\nb'), '```text\na\nb\n```');
});

// The job summary

const SUMMARY_FILE = 'summary.md';

test('summary appends an empty line, the text and a newline to the file of GITHUB_STEP_SUMMARY', () => {
  const text = inTemp({}, (root) => {
    const env = { [SUMMARY_VARIABLE]: join(root, SUMMARY_FILE) };
    summary('one', env);
    summary(fenced('two\nthree'), env);
    return textOf(join(root, SUMMARY_FILE));
  });
  assert.equal(text, '\none\n\n```text\ntwo\nthree\n```\n');
});

test('summary keeps what the file holds', () => {
  const text = inTemp({ [SUMMARY_FILE]: 'before' }, (root) => {
    summary('after', { [SUMMARY_VARIABLE]: join(root, SUMMARY_FILE) });
    return textOf(join(root, SUMMARY_FILE));
  });
  assert.equal(text, 'before\nafter\n');
});

for (const [name, env] of [
  ['not set', {}],
  ['undefined', { [SUMMARY_VARIABLE]: undefined }],
  ['empty', { [SUMMARY_VARIABLE]: '' }],
] as const satisfies readonly (readonly [string, Env])[]) {
  test(`summary does nothing when GITHUB_STEP_SUMMARY is ${name}`, () => {
    // A write to a file without a name throws.
    assert.doesNotThrow(() => summary('text', env));
  });
}

// Fake tools

/** One step of a fake tool: a text on a stream, or a pause in milliseconds. */
type Step = readonly ['out' | 'err', string] | readonly ['wait', number];

interface Fake {
  /** The exit code. The default is 0. */
  code?: number;
  steps?: readonly Step[];
  /** The tool ends itself with SIGKILL, so it has no exit code. */
  kill?: boolean;
}

/** What a fake tool records into `run.json`, in the folder of its package. */
interface Run {
  args: string[];
  cwd: string;
  node: string;
  telemetry: string | null;
  marker: string | null;
}

/** The bin script of a fake tool: it records how it was started, writes its output and exits with a set code. */
function fakeScript(fake: Fake, home: string): string {
  return [
    "import { writeFileSync } from 'node:fs';",
    "import { join } from 'node:path';",
    "import { setTimeout as wait } from 'node:timers/promises';",
    'const run = {',
    '  args: process.argv.slice(2),',
    '  cwd: process.cwd(),',
    '  node: process.execPath,',
    '  telemetry: process.env.ASTRO_TELEMETRY_DISABLED ?? null,',
    '  marker: process.env.KIT_TEST_MARKER ?? null,',
    '};',
    `writeFileSync(join(import.meta.dirname, ${JSON.stringify(home)}, 'run.json'), JSON.stringify(run));`,
    ...(fake.steps ?? []).map((step) =>
      step[0] === 'wait' ? `await wait(${step[1]});` : `process.std${step[0]}.write(${JSON.stringify(step[1])});`,
    ),
    fake.kill === true ? "process.kill(process.pid, 'SIGKILL');" : `process.exitCode = ${fake.code ?? 0};`,
    '',
  ].join('\n');
}

/** The files of a fake package: a `package.json` with a `bin` field, and the bin script. */
function fakeTool(pkg: string, script: string, fake: Fake = {}, bin: unknown = `./${script}`, at = ''): Files {
  return {
    [`${at}node_modules/${pkg}/package.json`]: json({ name: pkg, version: '1.0.0', bin }),
    [`${at}node_modules/${pkg}/${script}`]: fakeScript(fake, '../'.repeat(script.split('/').length - 1)),
  };
}

function runOf(root: string, pkg: string): Run | undefined {
  const text = textOf(join(root, 'node_modules', pkg, 'run.json'));
  if (text === undefined) return undefined;
  const run: Run = JSON.parse(text);
  return run;
}

/** An `io` that records what a command writes. */
function recorder(env: Env): { io: ToolIo; out: () => string; err: () => string } {
  const out: string[] = [];
  const err: string[] = [];
  return {
    io: { out: (text) => out.push(text), err: (text) => err.push(text), env },
    out: () => out.join(''),
    err: () => err.join(''),
  };
}

// findBin

test('findBin reads the bin of the real packages from their package.json', () => {
  assert.equal(findBin(KIT_ROOT, 'astro'), join(KIT_ROOT, 'node_modules/astro/bin/astro.mjs'));
  assert.equal(findBin(KIT_ROOT, '@biomejs/biome'), join(KIT_ROOT, 'node_modules/@biomejs/biome/bin/biome'));
  assert.equal(findBin(KIT_ROOT, 'typescript', 'tsc'), join(KIT_ROOT, 'node_modules/typescript/bin/tsc'));
  assert.equal(findBin(join(KIT_ROOT, 'test/unit'), 'astro'), join(KIT_ROOT, 'node_modules/astro/bin/astro.mjs'));
});

interface BinCase {
  name: string;
  files: Files;
  /** The folder to start in, from the temp folder. */
  from?: string;
  pkg: string;
  bin?: string;
  /** The script, from the temp folder. `undefined` when no folder holds the package. */
  want: string | undefined;
}

const BIN_CASES: readonly BinCase[] = [
  {
    name: 'a string is the bin of the package',
    files: fakeTool('tool', 'cli.mjs'),
    pkg: 'tool',
    want: 'node_modules/tool/cli.mjs',
  },
  {
    name: 'an object: the entry with the package name',
    files: fakeTool('tool', 'bin/tool.mjs', {}, { other: './bin/other.mjs', tool: './bin/tool.mjs' }),
    pkg: 'tool',
    want: 'node_modules/tool/bin/tool.mjs',
  },
  {
    name: 'an object: a path without ./',
    files: fakeTool('tool', 'bin/tool.mjs', {}, { tool: 'bin/tool.mjs' }),
    pkg: 'tool',
    want: 'node_modules/tool/bin/tool.mjs',
  },
  {
    name: 'a scoped package: the entry with the name without the scope',
    files: fakeTool('@scope/tool', 'bin/tool', {}, { tool: 'bin/tool' }),
    pkg: '@scope/tool',
    want: 'node_modules/@scope/tool/bin/tool',
  },
  {
    name: 'a named bin',
    files: fakeTool('tool', 'bin/second.mjs', {}, { tool: './bin/tool.mjs', second: './bin/second.mjs' }),
    pkg: 'tool',
    bin: 'second',
    want: 'node_modules/tool/bin/second.mjs',
  },
  {
    name: 'the package of a folder above the root',
    files: { ...fakeTool('tool', 'cli.mjs'), 'cases/a/astro-kit.json': '{}' },
    from: 'cases/a',
    pkg: 'tool',
    want: 'node_modules/tool/cli.mjs',
  },
  {
    name: 'the nearest package wins',
    files: { ...fakeTool('tool', 'far.mjs'), ...fakeTool('tool', 'near.mjs', {}, './near.mjs', 'cases/a/') },
    from: 'cases/a',
    pkg: 'tool',
    want: 'cases/a/node_modules/tool/near.mjs',
  },
  {
    name: 'a folder without package.json is no package',
    files: { ...fakeTool('tool', 'far.mjs'), 'cases/a/node_modules/tool/near.mjs': '' },
    from: 'cases/a',
    pkg: 'tool',
    want: 'node_modules/tool/far.mjs',
  },
  {
    name: 'another package does not count',
    files: fakeTool('tool', 'cli.mjs'),
    pkg: 'astro-kit-test-no-such-tool',
    want: undefined,
  },
  {
    name: 'no node_modules folder',
    files: { 'astro-kit.json': '{}' },
    pkg: 'astro-kit-test-no-such-tool',
    want: undefined,
  },
];

for (const c of BIN_CASES) {
  test(`findBin: ${c.name}`, () => {
    const seen = inTemp(c.files, (root) => {
      const found = findBin(join(root, c.from ?? ''), c.pkg, c.bin);
      return { found, want: c.want === undefined ? undefined : join(root, c.want) };
    });
    assert.equal(seen.found, seen.want);
  });
}

const NO_BIN_CASES: readonly (readonly [name: string, files: Files, bin: string | undefined, message: RegExp])[] = [
  [
    'no bin field',
    { 'node_modules/tool/package.json': json({ name: 'tool' }) },
    undefined,
    /^astro-kit: tool has no bin tool$/,
  ],
  [
    'no entry with the name',
    fakeTool('tool', 'a.mjs', {}, { other: './a.mjs' }),
    undefined,
    /^astro-kit: tool has no bin tool$/,
  ],
  [
    'no entry with the given name',
    fakeTool('tool', 'a.mjs', {}, { tool: './a.mjs' }),
    'x',
    /^astro-kit: tool has no bin x$/,
  ],
  [
    'an entry that is no text',
    fakeTool('tool', 'a.mjs', {}, { tool: 1 }),
    undefined,
    /^astro-kit: tool has no bin tool$/,
  ],
  ['an empty path', fakeTool('tool', 'a.mjs', {}, ''), undefined, /^astro-kit: tool has no bin tool$/],
  ['a list', fakeTool('tool', 'a.mjs', {}, ['./a.mjs']), undefined, /^astro-kit: tool has no bin tool$/],
  [
    'a package.json that is not JSON',
    { 'node_modules/tool/package.json': '{' },
    undefined,
    /package\.json is not valid JSON$/,
  ],
];

for (const [name, files, bin, message] of NO_BIN_CASES) {
  test(`findBin throws for a package without the bin: ${name}`, () => {
    assert.throws(() => inTemp(files, (root) => findBin(root, 'tool', bin)), { name: 'Error', message });
  });
}

// runTool

/** One finding as a tool prints it: the text of `formatFindings`. */
const FINDING: Finding = { rule: 'config-locked', where: 'build.format', detail: 'file instead of directory' };
const LOCKED = getRule('config-locked');
const FINDING_LINES: readonly string[] = [
  `✗ [config-locked] build.format: ${LOCKED.message} (file instead of directory)`,
  `    fix: ${LOCKED.hint}`,
  `    rule: ${DOCS_PATH}#config-locked`,
];

test('the finding lines of the tests are the last three lines of formatFindings', () => {
  assert.equal(formatFindings([FINDING]), ['astro-kit: 1 finding', ...FINDING_LINES].join('\n'));
});

/** Lines that are no finding lines: each differs from one in a single point. */
const NOISE = [
  'astro-kit: 1 finding',
  '! [config-locked] build.format: a warning',
  '~ [config-locked] build.format: waived (waived until 2026-12-01: a reason)',
  '✗ config-locked',
  'fix: not indented',
  'rule: not indented',
  '    fixed: another word',
  '    hint: another word',
  '    fix:no space',
].join('\n');

interface ToolCase {
  name: string;
  fake: Fake;
  args?: readonly string[];
  /** False: the environment has no GITHUB_STEP_SUMMARY. */
  withSummary?: boolean;
  code: number;
  out?: string;
  err?: string;
  /** The text of the summary file, or `undefined` when the run must not create it. */
  summary: string | undefined;
}

const FAILED = `\n${toolFailed('tool', ['run', '--flag'])}\n`;

const TOOL_CASES: readonly ToolCase[] = [
  {
    name: 'code 0: the output passes through, and the summary gets nothing',
    fake: {
      steps: [
        ['out', 'one\n'],
        ['err', 'warning\n'],
        ['out', 'two\n'],
      ],
    },
    code: 0,
    out: 'one\ntwo\n',
    err: 'warning\n',
    summary: undefined,
  },
  {
    name: 'code 0 with finding lines: the summary gets nothing',
    fake: { steps: [['err', `${FINDING_LINES.join('\n')}\n`]] },
    code: 0,
    err: `${FINDING_LINES.join('\n')}\n`,
    summary: undefined,
  },
  {
    name: 'code 1 without a finding line: the sentence that names the tool',
    fake: {
      code: 1,
      steps: [
        ['out', `${NOISE}\n`],
        ['err', 'it broke\n'],
      ],
    },
    code: 1,
    out: `${NOISE}\n`,
    err: 'it broke\n',
    summary: FAILED,
  },
  {
    name: 'the code of the tool is the result',
    fake: { code: 7 },
    code: 7,
    out: '',
    err: '',
    summary: FAILED,
  },
  {
    name: 'code 1 with a finding: its three lines in a text fence, and no other line',
    fake: { code: 1, steps: [['err', `[ERROR] ${NOISE}\n${FINDING_LINES.join('\n')}\n  at file.js:1:1\n`]] },
    code: 1,
    out: '',
    err: `[ERROR] ${NOISE}\n${FINDING_LINES.join('\n')}\n  at file.js:1:1\n`,
    summary: `\n\`\`\`text\n${FINDING_LINES.join('\n')}\n\`\`\`\n`,
  },
  {
    name: 'finding lines on stdout count too',
    fake: { code: 2, steps: [['out', `${FINDING_LINES.join('\n')}\n`]] },
    code: 2,
    out: `${FINDING_LINES.join('\n')}\n`,
    summary: `\n\`\`\`text\n${FINDING_LINES.join('\n')}\n\`\`\`\n`,
  },
  {
    name: 'a finding line with color codes and CRLF goes to the summary as plain text',
    fake: { code: 1, steps: [['err', '\u001b[31m✗ [a-b]\u001b[39m \u001b[1mx\u001b[22m: y\r\n    fix: z\r\n']] },
    code: 1,
    err: '\u001b[31m✗ [a-b]\u001b[39m \u001b[1mx\u001b[22m: y\r\n    fix: z\r\n',
    summary: '\n```text\n✗ [a-b] x: y\n    fix: z\n```\n',
  },
  {
    name: 'a line that arrives in two pieces is one line',
    fake: {
      code: 1,
      steps: [
        ['err', 'head ✗ [a'],
        ['wait', 60],
        ['err', '-b] x: y\n   '],
        ['wait', 60],
        ['err', ' rule: z\n'],
      ],
    },
    code: 1,
    err: 'head ✗ [a-b] x: y\n    rule: z\n',
    summary: '\n```text\nhead ✗ [a-b] x: y\n    rule: z\n```\n',
  },
  {
    name: 'a last line without a newline counts',
    fake: { code: 1, steps: [['err', '✗ [a-b] x: y\n    fix: z']] },
    code: 1,
    err: '✗ [a-b] x: y\n    fix: z',
    summary: '\n```text\n✗ [a-b] x: y\n    fix: z\n```\n',
  },
  {
    name: 'a tool that a signal ends gives 1',
    fake: { kill: true },
    code: 1,
    out: '',
    err: '',
    summary: FAILED,
  },
  {
    name: 'without GITHUB_STEP_SUMMARY a failure writes no file',
    fake: { code: 1, steps: [['err', `${FINDING_LINES.join('\n')}\n`]] },
    withSummary: false,
    code: 1,
    err: `${FINDING_LINES.join('\n')}\n`,
    summary: undefined,
  },
];

for (const c of TOOL_CASES) {
  test(`runTool: ${c.name}`, async () => {
    const seen = await inTempAsync(fakeTool('tool', 'bin/tool.mjs', c.fake), async (root) => {
      const seenIo = recorder(c.withSummary === false ? {} : { [SUMMARY_VARIABLE]: join(root, SUMMARY_FILE) });
      const code = await runTool(root, 'tool', c.args ?? ['run', '--flag'], seenIo.io);
      return { code, out: seenIo.out(), err: seenIo.err(), summary: textOf(join(root, SUMMARY_FILE)) };
    });
    assert.deepEqual(seen, { code: c.code, out: c.out ?? '', err: c.err ?? '', summary: c.summary });
  });
}

test('runTool starts the bin with the running Node, in the root, with the arguments as they are', async () => {
  // A shell would expand or split these arguments.
  const args = ['build', '--flag', 'two words', '$(echo x)', '; exit 9', '*', '"quoted"', ''];
  const seen = await inTempAsync(fakeTool('tool', 'bin/tool.mjs'), async (root) => {
    const seenIo = recorder({ KIT_TEST_MARKER: 'from io', ASTRO_TELEMETRY_DISABLED: '0' });
    const code = await runTool(root, 'tool', args, seenIo.io);
    return { code, run: runOf(root, 'tool'), root: realpathSync(root) };
  });
  assert.equal(seen.code, 0);
  assert.deepEqual(seen.run, {
    args,
    cwd: seen.root,
    node: process.execPath,
    telemetry: '1',
    marker: 'from io',
  });
});

test('runTool gives the tool the environment of io, not the one of the process', async () => {
  process.env.KIT_TEST_MARKER = 'from the process';
  try {
    const run = await inTempAsync(fakeTool('tool', 'bin/tool.mjs'), async (root) => {
      await runTool(root, 'tool', [], recorder({}).io);
      return runOf(root, 'tool');
    });
    assert.equal(run?.marker, null);
    assert.equal(run?.telemetry, '1');
  } finally {
    delete process.env.KIT_TEST_MARKER;
  }
});

test('runTool finds the tool of a folder above the root and runs it in the root', async () => {
  const files = { ...fakeTool('tool', 'bin/tool.mjs', { code: 4 }), 'cases/a/astro-kit.json': '{}' };
  const seen = await inTempAsync(files, async (root) => {
    const code = await runTool(join(root, 'cases/a'), 'tool', ['x'], recorder({}).io);
    return { code, cwd: runOf(root, 'tool')?.cwd, want: realpathSync(join(root, 'cases/a')) };
  });
  assert.equal(seen.code, 4);
  assert.equal(seen.cwd, seen.want);
});

test('runTool: a package that is not installed prints the message of 6.4 and gives 1', async () => {
  const seen = await inTempAsync(fakeTool('tool', 'bin/tool.mjs'), async (root) => {
    const seenIo = recorder({ [SUMMARY_VARIABLE]: join(root, SUMMARY_FILE) });
    const code = await runTool(root, 'astro-kit-test-no-such-tool', ['build'], seenIo.io);
    return { code, out: seenIo.out(), err: seenIo.err(), summary: textOf(join(root, SUMMARY_FILE)) };
  });
  assert.deepEqual(seen, {
    code: 1,
    out: '',
    err: 'astro-kit: astro-kit-test-no-such-tool is not installed; run npm ci --ignore-scripts\n',
    summary: undefined,
  });
});

test('runTool: a tool that cannot start prints why and gives 1', async () => {
  // The root does not exist, so the process cannot start in it. The search still finds the tool above it.
  const seen = await inTempAsync(fakeTool('tool', 'bin/tool.mjs'), async (root) => {
    const seenIo = recorder({ [SUMMARY_VARIABLE]: join(root, SUMMARY_FILE) });
    const code = await runTool(join(root, 'no-such-folder'), 'tool', ['run', '--flag'], seenIo.io);
    return {
      code,
      err: seenIo.err(),
      ran: runOf(root, 'tool') !== undefined,
      summary: textOf(join(root, SUMMARY_FILE)),
    };
  });
  assert.equal(seen.code, 1);
  assert.match(seen.err, /^astro-kit: tool did not start: .+\n$/);
  assert.equal(seen.ran, false);
  assert.equal(seen.summary, FAILED);
});

test('runTool rejects for a package without a bin', async () => {
  const files = { 'node_modules/tool/package.json': json({ name: 'tool' }) };
  await assert.rejects(
    inTempAsync(files, (root) => runTool(root, 'tool', [], recorder({}).io)),
    { message: 'astro-kit: tool has no bin tool' },
  );
});

// build

/** A fake `astro` with the bin path of the real package. */
const fakeAstro = (fake: Fake = {}): Files => fakeTool('astro', 'bin/astro.mjs', fake, { astro: './bin/astro.mjs' });

for (const code of [0, 1, 3]) {
  test(`build runs astro build and gives its code ${code}`, async () => {
    const seen = await inTempAsync(fakeAstro({ code, steps: [['out', 'building\n']] }), async (root) => {
      const seenIo = recorder({ [SUMMARY_VARIABLE]: join(root, SUMMARY_FILE) });
      const result = await build(root, seenIo.io);
      return { result, out: seenIo.out(), run: runOf(root, 'astro'), summary: textOf(join(root, SUMMARY_FILE)) };
    });
    assert.equal(seen.result, code);
    assert.equal(seen.out, 'building\n');
    assert.deepEqual(seen.run?.args, ['build']);
    assert.equal(seen.run?.telemetry, '1');
    assert.equal(seen.summary, code === 0 ? undefined : '\nastro build failed; see the job log.\n');
  });
}

// tokens

/** The design document of 7.7, setting 1, with every section that 7.4 requires. */
const SETTING_1_MD = [
  '## Themes',
  '',
  '| Theme | Use |',
  '|---|---|',
  '| light | The light theme. |',
  '| dark | The dark theme. |',
  '| light-contrast | Light, with more contrast. |',
  '| dark-contrast | Dark, with more contrast. |',
  '',
  '## Color',
  '',
  '| Token | light | dark | light-contrast | dark-contrast | Use |',
  '|---|---|---|---|---|---|',
  '| `--color-page` | `#ffffff` | `#111111` | | | The page. |',
  '| `--color-text` | `#222222` | `#eeeeee` | `#000000` | `#ffffff` | Text. |',
  '| `--color-muted` | `#555555` | `#bbbbbb` | `#333333` | `#dddddd` | Quiet text. |',
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
  '## Layout helpers',
  '',
  '| Parameter | Token | Use |',
  '|---|---|---|',
  '| `--stack-gap` | `var(--space-2)` | The gap of a stack. |',
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
  '| `--color-text` | `--color-page` | text | body |',
  '',
].join('\n');

/** The text of 7.7 for setting 1. */
const SETTING_1_CSS = `${specBlock('**Setting 1: all four themes, all four options.**', 'css')}\n`;

const ALL_MODES = { auto: true, light: true, dark: true, contrast: true };

/** The settings file of a site with the given mode options. */
const settings = (modes: Readonly<Record<string, unknown>> = ALL_MODES): string => json({ ...SMALLEST, modes });

const OPTIONS = 'astro-kit.json';
const DESIGN = 'docs/design.md';

/** A project that passes: the settings and the design document of setting 1. */
const PROJECT: Files = { [OPTIONS]: settings(), [DESIGN]: SETTING_1_MD };

/** The rendering with one value changed by hand (drift row 32 of 14.1). */
const CHANGED_CSS = SETTING_1_CSS.replace('--text-m: 1rem;', '--text-m: 1.1rem;');
const CHANGED_LINE = SETTING_1_CSS.split('\n').indexOf('    --text-m: 1rem;') + 1;

interface TokensCase {
  name: string;
  files: Files;
  check: boolean;
  /** The sorted rule ids. */
  ids: readonly string[];
  /** The place of each finding, in order. */
  where: readonly string[];
  written: boolean;
  /** The text of tokens.css after the run, or `undefined` when the file must not exist. */
  css: string | undefined;
}

const TOKENS_CASES: readonly TokensCase[] = [
  {
    name: 'writes the text of setting 1, and creates the folders',
    files: PROJECT,
    check: false,
    ids: [],
    where: [],
    written: true,
    css: SETTING_1_CSS,
  },
  {
    name: 'replaces a file that was changed by hand',
    files: { ...PROJECT, [TOKENS_FILE]: CHANGED_CSS },
    check: false,
    ids: [],
    where: [],
    written: true,
    css: SETTING_1_CSS,
  },
  {
    name: 'renders for the mode options of the settings',
    files: { ...PROJECT, [OPTIONS]: settings({ auto: true }) },
    check: false,
    ids: [],
    where: [],
    written: true,
    css: SETTING_1_CSS.replace(/ {2}:root\[data-mode="light"\] \{\n[\s\S]*? {2}\}\n(?= {2}@media)/, ''),
  },
  {
    name: '--check passes for the rendering and writes nothing',
    files: { ...PROJECT, [TOKENS_FILE]: SETTING_1_CSS },
    check: true,
    ids: [],
    where: [],
    written: false,
    css: SETTING_1_CSS,
  },
  {
    name: '--check compares after CRLF→LF and trimEnd + newline, and does not rewrite the file',
    files: { ...PROJECT, [TOKENS_FILE]: `${SETTING_1_CSS.replaceAll('\n', '\r\n')}\r\n\r\n` },
    check: true,
    ids: [],
    where: [],
    written: false,
    css: `${SETTING_1_CSS.replaceAll('\n', '\r\n')}\r\n\r\n`,
  },
  {
    name: '--check finds one value changed by hand and leaves the file',
    files: { ...PROJECT, [TOKENS_FILE]: CHANGED_CSS },
    check: true,
    ids: ['design-tokens'],
    where: [`${TOKENS_FILE}:${CHANGED_LINE}`],
    written: false,
    css: CHANGED_CSS,
  },
  {
    name: '--check finds the rendering of other mode options',
    files: { ...PROJECT, [OPTIONS]: settings({ auto: true }), [TOKENS_FILE]: SETTING_1_CSS },
    check: true,
    ids: ['design-tokens'],
    where: [`${TOKENS_FILE}:${SETTING_1_CSS.split('\n').indexOf('  :root[data-mode="light"] {') + 1}`],
    written: false,
    css: SETTING_1_CSS,
  },
  {
    name: '--check finds a missing file and does not write it',
    files: PROJECT,
    check: true,
    ids: ['design-tokens'],
    where: [TOKENS_FILE],
    written: false,
    css: undefined,
  },
  {
    name: 'a design document that is not valid: the design-format findings, and nothing is written',
    files: { ...PROJECT, [DESIGN]: SETTING_1_MD.replace('| `--color-text` | `--color-page` | text | body |\n', '') },
    check: false,
    ids: ['design-format'],
    where: [`${DESIGN}:${SETTING_1_MD.split('\n').indexOf('## Contrast pairs') + 3}`],
    written: false,
    css: undefined,
  },
  {
    name: 'a design document that is not valid leaves an existing file as it is',
    files: { ...PROJECT, [DESIGN]: SETTING_1_MD.replace('`1rem`', '`1 rem`'), [TOKENS_FILE]: CHANGED_CSS },
    check: false,
    ids: ['design-format'],
    where: [`${DESIGN}:${SETTING_1_MD.split('\n').findIndex((line) => line.includes('--text-m')) + 1}`],
    written: false,
    css: CHANGED_CSS,
  },
  {
    name: '--check with a design document that is not valid: design-format only',
    files: { ...PROJECT, [DESIGN]: SETTING_1_MD.replace('`1rem`', '`1 rem`'), [TOKENS_FILE]: CHANGED_CSS },
    check: true,
    ids: ['design-format'],
    where: [`${DESIGN}:${SETTING_1_MD.split('\n').findIndex((line) => line.includes('--text-m')) + 1}`],
    written: false,
    css: CHANGED_CSS,
  },
  {
    name: 'no design document',
    files: { [OPTIONS]: settings() },
    check: false,
    ids: ['design-format'],
    where: [DESIGN],
    written: false,
    css: undefined,
  },
  {
    name: 'no settings',
    files: { [DESIGN]: SETTING_1_MD },
    check: false,
    ids: ['config-options'],
    where: [OPTIONS],
    written: false,
    css: undefined,
  },
  {
    name: 'settings and a design document that are not valid: one run reports both',
    files: {
      [OPTIONS]: json({ ...SMALLEST, modes: { auto: 'yes' } }),
      [DESIGN]: SETTING_1_MD.replace('`1rem`', '`1 rem`'),
    },
    check: false,
    ids: ['config-options', 'design-format'],
    where: [
      `${OPTIONS}: modes.auto`,
      `${DESIGN}:${SETTING_1_MD.split('\n').findIndex((line) => line.includes('--text-m')) + 1}`,
    ],
    written: false,
    css: undefined,
  },
  {
    name: 'themes that no mode option reaches: modes-themes, and nothing is written',
    files: { ...PROJECT, [OPTIONS]: settings({ auto: false, light: true, default: 'light' }) },
    check: false,
    ids: ['modes-themes'],
    where: [DESIGN, DESIGN, DESIGN],
    written: false,
    css: undefined,
  },
  {
    name: '--check with themes that no mode option reaches: modes-themes only',
    files: { ...PROJECT, [OPTIONS]: settings({ auto: false, light: true, default: 'light' }) },
    check: true,
    ids: ['modes-themes'],
    where: [DESIGN, DESIGN, DESIGN],
    written: false,
    css: undefined,
  },
];

for (const c of TOKENS_CASES) {
  test(`tokens${c.check ? ' --check' : ''}: ${c.name}`, () => {
    const seen = inTemp(c.files, (root) => {
      const result = tokens(root, { check: c.check });
      return {
        ids: idsOf(result.findings),
        where: result.findings.map((finding) => finding.where),
        written: result.written,
        css: textOf(join(root, TOKENS_FILE)),
      };
    });
    assert.deepEqual(seen, { ids: [...c.ids], where: [...c.where], written: c.written, css: c.css });
  });
}

test('tokens, then tokens --check: the written file passes', () => {
  const seen = inTemp(PROJECT, (root) => [tokens(root, { check: false }), tokens(root, { check: true })]);
  assert.deepEqual(seen, [
    { findings: [], written: true },
    { findings: [], written: false },
  ]);
});

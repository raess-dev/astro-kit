#!/usr/bin/env node
/**
 * The astro-kit command line (specification, 6.4). Run it in the project root: `npx --no astro-kit <command>`.
 *
 * This file loads no other module of the kit until a command needs it. So `help` and a usage error start fast, and
 * a command loads only what it uses.
 *
 * This milestone has the commands `build`, `test` and `tokens`. Every other command of 6.4 is an unknown command
 * until its milestone adds it (M9).
 */
import type { ToolIo } from './ci.ts';
import type { Finding } from './registry.ts';

/** The usage text: the commands that exist. */
export const USAGE = `Usage: npx --no astro-kit <command>
Run it in the project root.

  build             Runs astro build. The kit checks the project and the built site inside it.
  test [--all]      Runs the browser checks on dist: one page for each locale and layout, or every page
                    with --all, for the perf rules too. --shots <dir> also writes a full-page image of each
                    page and viewport.
                    --outline <path|https URL> prints the accessibility outline of one page instead.
  tokens [--check]  Writes src/styles/tokens.css from docs/design.md and the mode options.
                    With --check it writes nothing and compares the file.
  help              Prints this text.`;

/**
 * The passed line of 6.4. A command that runs checks prints it as its last line on stdout, once, when it ends with
 * no finding that fails it. Only this file prints it: `formatFindings` and the hooks of the integration never do.
 */
export const PASSED_LINE = 'astro-kit: all checks passed.';

/** Where the command line writes, and the environment it reads. `out` and `err` write a text as it is. */
export type Io = ToolIo;

/** The streams and the environment of the process. */
const processIo = (): Io => ({
  out: (text) => {
    process.stdout.write(text);
  },
  err: (text) => {
    process.stderr.write(text);
  },
  env: process.env,
});

const isFinding = (value: unknown): value is Finding =>
  typeof value === 'object' &&
  value !== null &&
  'rule' in value &&
  typeof value.rule === 'string' &&
  'where' in value &&
  typeof value.where === 'string';

/** The findings of a command result: a findings array, or the `findings` of an object. Else `undefined`. */
function findingsOf(value: unknown): Finding[] | undefined {
  const list = typeof value === 'object' && value !== null && 'findings' in value ? value.findings : value;
  if (!Array.isArray(list)) return undefined;
  const findings = list.filter(isFinding);
  if (findings.length !== list.length) throw new Error('astro-kit: a command returned a list that is not findings');
  return findings;
}

/**
 * The outcome mapping of 6.4: the exit code of a command result.
 *
 * - A findings array, or an object with `findings`: an empty list gives 0 and prints nothing. Else the text of
 *   `formatFindings` goes to stderr and to the job summary. The code is 1 when a finding fails the command, and 0
 *   when every finding is a warning or waived.
 * - A number is the code.
 * - `false` gives 1. Anything else gives 0.
 *
 * It never prints the passed line: `passed` does that, after all other output of a command that runs checks.
 */
export async function outcome(value: unknown, io: Io = processIo()): Promise<number> {
  const findings = findingsOf(value);
  if (findings === undefined) {
    if (typeof value === 'number') return value;
    return value === false ? 1 : 0;
  }
  if (findings.length === 0) return 0;
  const [{ failures, formatFindings }, { fenced, summary }] = await Promise.all([
    import('./registry.ts'),
    import('./ci.ts'),
  ]);
  const text = formatFindings(findings);
  io.err(`${text}\n`);
  summary(fenced(text), io.env);
  return failures(findings).length > 0 ? 1 : 0;
}

/**
 * The end of a command that runs checks. With the code 0 it prints the passed line on stdout. Call it once, after
 * the last tool of the command has ended and after all other output of the command.
 */
function passed(code: number, io: Io): number {
  if (code === 0) io.out(`${PASSED_LINE}\n`);
  return code;
}

/** The flags of a command. `undefined` when an argument is not one of the flags that the command knows. */
function flagsOf(args: readonly string[], known: readonly string[]): ReadonlySet<string> | undefined {
  return args.every((arg) => known.includes(arg)) ? new Set(args) : undefined;
}

/**
 * The flags of a command with flags that take a value (`--shots <dir>`). `undefined` when an argument is not a known
 * flag, a flag comes twice, or a flag that takes a value has none. A value never starts with `--`.
 */
function valuedFlagsOf(
  args: readonly string[],
  known: readonly string[],
  valued: readonly string[],
): ReadonlyMap<string, string | true> | undefined {
  const flags = new Map<string, string | true>();
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? '';
    if (flags.has(arg)) return undefined;
    if (known.includes(arg)) {
      flags.set(arg, true);
      continue;
    }
    if (!valued.includes(arg)) return undefined;
    const value = args[index + 1];
    if (value === undefined || value === '' || value.startsWith('--')) return undefined;
    flags.set(arg, value);
    index += 1;
  }
  return flags;
}

/** The value of a flag that takes one, else `undefined`. */
const flagValue = (flags: ReadonlyMap<string, string | true>, name: string): string | undefined => {
  const value = flags.get(name);
  return typeof value === 'string' ? value : undefined;
};

/** Runs one command. `undefined` means a usage error: an unknown command, flag or argument. */
async function dispatch(argv: readonly string[], root: string, io: Io): Promise<number | undefined> {
  const [command, ...rest] = argv;
  if (command === undefined || command === 'help' || command === '--help') {
    if (rest.length > 0) return undefined;
    io.out(`${USAGE}\n`);
    return 0;
  }
  if (command === 'build') {
    if (rest.length > 0) return undefined;
    const { build } = await import('./ci.ts');
    // `build` gives the status of `astro build`. The integration ran every check inside that process.
    return passed(await outcome(await build(root, io), io), io);
  }
  if (command === 'test') {
    const flags = valuedFlagsOf(rest, ['--all'], ['--outline', '--shots']);
    if (flags === undefined) return undefined;
    const target = flagValue(flags, '--outline');
    if (target !== undefined) {
      // `--outline` prints one page and runs no check, so it takes no other flag and prints no passed line.
      if (flags.size > 1) return undefined;
      const { outline } = await import('./browser.ts');
      return outline(root, target, io);
    }
    const { test } = await import('./browser.ts');
    const findings = await test(root, { all: flags.has('--all'), shots: flagValue(flags, '--shots') }, io);
    return passed(await outcome(findings, io), io);
  }
  if (command === 'tokens') {
    const flags = flagsOf(rest, ['--check']);
    if (flags === undefined) return undefined;
    const { tokens, TOKENS_FILE } = await import('./ci.ts');
    const check = flags.has('--check');
    const result = tokens(root, { check });
    const code = await outcome(result, io);
    if (result.written) io.out(`astro-kit tokens: wrote ${TOKENS_FILE}\n`);
    // Only `tokens --check` runs a check. `tokens` alone writes the file.
    return check ? passed(code, io) : code;
  }
  return undefined;
}

/**
 * Runs the command line in a project root and returns the exit code.
 *
 * - `help`, `--help` or no command: the usage on stdout, 0.
 * - An unknown command, flag or argument: the usage on stderr, 2.
 * - A thrown error: its message on stderr, 1.
 */
export async function main(
  argv: readonly string[],
  root: string = process.cwd(),
  io: Io = processIo(),
): Promise<number> {
  try {
    const code = await dispatch(argv, root, io);
    if (code !== undefined) return code;
    io.err(`${USAGE}\n`);
    return 2;
  } catch (error) {
    io.err(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

if (import.meta.main) process.exitCode = await main(process.argv.slice(2));

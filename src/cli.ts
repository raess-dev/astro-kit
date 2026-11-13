#!/usr/bin/env node
/**
 * The astro-kit command line (specification, 6.4). Run it in the project root: `npx --no astro-kit <command>`.
 *
 * This file loads no other module of the kit until a command needs it. So `help` and a usage error start fast, and
 * a command loads only what it uses.
 *
 * This milestone has the commands `build` and `tokens`. Every other command of 6.4 is an unknown command until
 * its milestone adds it (M6 and M9).
 */
import type { ToolIo } from './ci.ts';
import type { Finding } from './registry.ts';

/** The usage text: the commands that exist. */
export const USAGE = `Usage: npx --no astro-kit <command>
Run it in the project root.

  build             Runs astro build. The kit checks the project and the built site inside it.
  tokens [--check]  Writes src/styles/tokens.css from docs/design.md and the mode options.
                    With --check it writes nothing and compares the file.
  help              Prints this text.`;

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

/** The flags of a command. `undefined` when an argument is not one of the flags that the command knows. */
function flagsOf(args: readonly string[], known: readonly string[]): ReadonlySet<string> | undefined {
  return args.every((arg) => known.includes(arg)) ? new Set(args) : undefined;
}

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
    return outcome(await build(root, io), io);
  }
  if (command === 'tokens') {
    const flags = flagsOf(rest, ['--check']);
    if (flags === undefined) return undefined;
    const { tokens, TOKENS_FILE } = await import('./ci.ts');
    const result = tokens(root, { check: flags.has('--check') });
    const code = await outcome(result, io);
    if (result.written) io.out(`astro-kit tokens: wrote ${TOKENS_FILE}\n`);
    return code;
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

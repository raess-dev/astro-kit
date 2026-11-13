/**
 * The commands that run tools or write a rendered file, and the tool runner (specification, 6.4).
 *
 * This milestone has the commands `build` and `tokens`. The tool runner starts each tool as one process, with the
 * running Node and the bin script from `node_modules`: never npm, npx or a shell.
 */
import { spawn } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { stripVTControlCharacters } from 'node:util';
import { loadDesign } from './design/parse.ts';
import { checkTokens, renderTokens, TOKENS_FILE } from './design/tokens.ts';
import { checkModeThemes } from './modes.ts';
import { loadOptions } from './options.ts';
import { type Finding, Report } from './registry.ts';

export { TOKENS_FILE } from './design/tokens.ts';

/** The environment of a command: the variables of the process, or the ones of a test. */
export type Env = Readonly<Record<string, string | undefined>>;

/** Where a command writes, and the environment it reads. `out` and `err` write a text as it is. */
export interface ToolIo {
  out: (text: string) => void;
  err: (text: string) => void;
  env: Env;
}

// The job summary

/** The variable that names the file of the job summary on GitHub. */
export const SUMMARY_VARIABLE = 'GITHUB_STEP_SUMMARY';

/** A text inside a `text` fence, so that the job summary shows it line by line. */
export const fenced = (text: string): string => `\`\`\`text\n${text}\n\`\`\``;

/**
 * Appends a text to the job summary: an empty line, the text and a newline. The empty line keeps the text apart
 * from what the file holds. It does nothing when `GITHUB_STEP_SUMMARY` is not set or empty.
 */
export function summary(text: string, env: Env = process.env): void {
  const file = env[SUMMARY_VARIABLE];
  if (file === undefined || file === '') return;
  appendFileSync(file, `\n${text}\n`);
}

// The tool runner

/** The lines of a tool's output that go to the job summary: the lines of a finding (6.4). */
export const FINDING_LINE = /✗ \[|^\s+(fix|rule): /;

/** The message for a package that no `node_modules` folder holds (6.4). */
export const notInstalled = (pkg: string): string => `astro-kit: ${pkg} is not installed; run npm ci --ignore-scripts`;

/** The summary text for a failed tool that printed no finding (6.4). */
export const toolFailed = (pkg: string, args: readonly string[]): string =>
  `${[pkg, ...args].join(' ')} failed; see the job log.`;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The name that npm gives the bin of a package with one bin: the package name without its scope. */
const binNameOf = (pkg: string): string => pkg.slice(pkg.lastIndexOf('/') + 1);

/**
 * The bin script of a package. The search starts in `<root>/node_modules` and walks up, as Node does. The path of
 * the script comes from the `bin` field of the package's `package.json`: a string, or the entry with the bin name.
 * The default bin name is the package name without its scope.
 *
 * Returns `undefined` when no folder holds the package. Throws when the package has no such bin.
 */
export function findBin(root: string, pkg: string, bin: string = binNameOf(pkg)): string | undefined {
  for (let folder = resolve(root); ; folder = dirname(folder)) {
    const home = join(folder, 'node_modules', pkg);
    const manifest = join(home, 'package.json');
    if (statSync(manifest, { throwIfNoEntry: false })?.isFile()) return join(home, binField(manifest, pkg, bin));
    if (dirname(folder) === folder) return undefined;
  }
}

/** The path of a bin from the folder of its package, as `package.json` gives it. */
function binField(manifest: string, pkg: string, bin: string): string {
  let data: unknown;
  try {
    data = JSON.parse(readFileSync(manifest, 'utf8'));
  } catch {
    throw new Error(`astro-kit: ${manifest} is not valid JSON`);
  }
  const field = isRecord(data) ? data.bin : undefined;
  const path = isRecord(field) ? field[bin] : field;
  if (typeof path !== 'string' || path === '') throw new Error(`astro-kit: ${pkg} has no bin ${bin}`);
  return path;
}

/** Collects the finding lines of one output stream. A line can arrive in more than one piece. */
function lineReader(keep: (line: string) => void): { push: (text: string) => void; end: () => void } {
  let rest = '';
  const read = (line: string): void => {
    const plain = stripVTControlCharacters(line).replace(/\r$/, '');
    if (FINDING_LINE.test(plain)) keep(plain);
  };
  return {
    push: (text) => {
      const lines = `${rest}${text}`.split('\n');
      rest = lines.pop() ?? '';
      for (const line of lines) read(line);
    },
    end: () => {
      if (rest !== '') read(rest);
      rest = '';
    },
  };
}

/**
 * Runs the bin of a package in the project root and returns its exit code.
 *
 * - The process is `process.execPath` with the bin script and the arguments. No shell reads them.
 * - The tool gets the environment of `io` plus `ASTRO_TELEMETRY_DISABLED=1`. It has no input.
 * - Its output goes to `io` while it runs.
 * - On a code other than 0, the finding lines of the output go to the job summary inside a `text` fence. Without
 *   such a line, the summary gets one sentence that names the tool.
 * - A package that is not installed prints one message and gives 1. So does a tool that does not start. A tool
 *   that a signal ends gives 1.
 * - A package without the bin rejects, as does a job summary that cannot be written.
 */
export function runTool(root: string, pkg: string, args: readonly string[], io: ToolIo): Promise<number> {
  return new Promise((done, fail) => {
    // A throw in here rejects the promise.
    const bin = findBin(root, pkg);
    if (bin === undefined) {
      io.err(`${notInstalled(pkg)}\n`);
      done(1);
      return;
    }
    const found: string[] = [];
    const readers = [lineReader((line) => found.push(line)), lineReader((line) => found.push(line))] as const;
    let settled = false;
    /** Ends the run once: the summary of a failure, then the code. */
    const settle = (code: number): void => {
      if (settled) return;
      settled = true;
      try {
        for (const reader of readers) reader.end();
        if (code !== 0) summary(found.length > 0 ? fenced(found.join('\n')) : toolFailed(pkg, args), io.env);
        done(code);
      } catch (error) {
        fail(error);
      }
    };
    const child = spawn(process.execPath, [bin, ...args], {
      cwd: root,
      env: { ...io.env, ASTRO_TELEMETRY_DISABLED: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (text: string) => {
      io.out(text);
      readers[0].push(text);
    });
    child.stderr.on('data', (text: string) => {
      io.err(text);
      readers[1].push(text);
    });
    child.on('error', (error) => {
      io.err(`astro-kit: ${pkg} did not start: ${error.message}\n`);
      settle(1);
    });
    child.on('close', (code) => settle(code ?? 1));
  });
}

// The commands

/** The command `build`: `astro build`. The integration of the kit runs every check inside it. */
export const build = (root: string, io: ToolIo): Promise<number> => runTool(root, 'astro', ['build'], io);

/** What the command `tokens` did. */
export interface TokensResult {
  findings: Finding[];
  /** True when the command wrote `src/styles/tokens.css`. */
  written: boolean;
}

/**
 * The command `tokens` (7.7). It renders `src/styles/tokens.css` from `docs/design.md` and the mode options, and
 * writes it. With `check` it writes nothing and compares the file with the rendering (`design-tokens`).
 *
 * It writes nothing when the settings or `docs/design.md` are not valid, or when the themes do not serve the mode
 * options: then it returns the findings of `config-options`, `design-format` or `modes-themes`. It never throws
 * for a finding.
 */
export function tokens(root: string, { check }: { check: boolean }): TokensResult {
  const report = new Report();
  const stop = (): TokensResult => ({ findings: report.findings, written: false });
  // Both loaders run, so that one run reports the findings of both files.
  const options = loadOptions(root, report);
  const design = loadDesign(root, report);
  if (options === undefined || design === undefined) return stop();
  if (!checkModeThemes(options, design.themes, report)) return stop();
  if (check) {
    checkTokens(root, design, options, report);
    return stop();
  }
  const file = join(root, TOKENS_FILE);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, renderTokens(design, options));
  return { findings: report.findings, written: true };
}

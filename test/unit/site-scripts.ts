/**
 * Runs the scripts of the site workflows (10.1) under bash, with fake bins first on the path, in a scratch folder
 * (14.1). `github` runs a script against the fake GitHub of `fake-github.ts`.
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FakeState, Item } from './fake-github.ts';

const FAKE = fileURLToPath(new URL('./fake-github.ts', import.meta.url));

/** The lines of a file, or none when it does not exist. */
export const lines = (path: string): string[] =>
  existsSync(path) ? readFileSync(path, 'utf8').trim().split('\n').filter(Boolean) : [];

/** The text of a file, or `''` when it does not exist. */
export const textOf = (path: string): string => (existsSync(path) ? readFileSync(path, 'utf8') : '');

/**
 * Calls `use` with a fresh work folder and an env whose `PATH` starts with the fake bins (each a bash script), and
 * removes the scratch folder after it. The env holds `HOME`, `LOG`, `GITHUB_OUTPUT`, `RUNNER_TEMP`, `TMPDIR` and
 * `FAKE_GITHUB`, all inside the scratch folder.
 */
export function scratch<T>(bins: Record<string, string>, use: (work: string, env: Record<string, string>) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'astro-kit-site-'));
  try {
    const bin = join(dir, 'bin');
    const work = join(dir, 'work');
    mkdirSync(bin);
    mkdirSync(join(dir, 'tmp'));
    mkdirSync(work);
    for (const [name, text] of Object.entries(bins)) {
      writeFileSync(join(bin, name), `#!/usr/bin/env bash\n${text}`);
      chmodSync(join(bin, name), 0o755);
    }
    return use(work, {
      PATH: `${bin}:${process.env.PATH ?? ''}`,
      HOME: dir,
      LOG: join(dir, 'calls.log'),
      GITHUB_OUTPUT: join(dir, 'output'),
      RUNNER_TEMP: join(dir, 'tmp'),
      TMPDIR: join(dir, 'tmp'),
      FAKE_GITHUB: join(dir, 'github.json'),
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Runs a script as a step does: `bash -eo pipefail`, with no profile. */
export const bash = (script: string, cwd: string, env: Record<string, string>) =>
  spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', '-c', script], { cwd, env, encoding: 'utf8' });

const GH_BINS = { gh: `exec node "${FAKE}" gh "$@"\n`, sleep: `exec node "${FAKE}" sleep "$@"\n` };

/**
 * Runs a script against the fake GitHub with this state, as the run of `o/r` at `abc` with the owner `owner`, and
 * gives its status, its output, the calls that changed something, `$GITHUB_OUTPUT` and the state after it.
 */
export function github(script: string, state: FakeState, env: Record<string, string> = {}) {
  return scratch(GH_BINS, (work, base) => {
    writeFileSync(base.FAKE_GITHUB ?? '', JSON.stringify(state));
    const result = bash(script, work, {
      ...base,
      REPO: 'o/r',
      SHA: 'abc',
      RUN: 'https://github.com/o/r/actions/runs/1',
      GH_TOKEN: 'x',
      KIT_OWNER: 'owner',
      ...env,
    });
    return {
      status: result.status,
      out: `${result.stdout}${result.stderr}`,
      calls: lines(base.LOG ?? ''),
      output: textOf(base.GITHUB_OUTPUT ?? ''),
      after: JSON.parse(readFileSync(base.FAKE_GITHUB ?? '', 'utf8')) as FakeState,
    };
  });
}

/** The account that opens the issues of the workflow. */
export const BOT = { login: 'github-actions[bot]' };

/** An open issue of the workflow, or another item with `rest`. */
export const issueOf = (number: number, title: string, rest: Partial<Item> = {}): Item => ({
  number,
  title,
  state: 'open',
  user: BOT,
  ...rest,
});

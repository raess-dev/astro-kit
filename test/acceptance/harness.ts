/**
 * The harness of the acceptance suite (specification, 14.2).
 * - The packed kit: the file of `KIT_TARBALL`, else the kit of this checkout, which the harness builds and packs.
 * - The base copy: a copy of the test site `test/site/` in a temp folder, with its packages, the pins of the suite
 *   and the packed kit installed once.
 * - Case folders under `<base>/cases/<name>/`. Node, Astro and the kit walk up to `<base>/node_modules` for every
 *   package. A spike starts from an empty folder (`caseDir`). A site case starts from a copy of the site (`siteCase`).
 * - Runners for the kit CLI (`run`), Astro, the kit's static server `serveDist`, Chromium, and the file of measured
 *   values.
 */
import { AssertionError } from 'node:assert';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual, stripVTControlCharacters } from 'node:util';
import type * as ServeModule from '../../src/serve.ts';
import type { Served as KitServed, ServeOptions } from '../../src/serve.ts';

/** The repository root: the checkout of the kit. */
export const REPO = resolve(import.meta.dirname, '../..');
/** The test site: one complete kit project. */
export const SITE = join(REPO, 'test/site');
/** The stand-in integration of the spikes. It is not the kit. */
export const STAND_IN = join(import.meta.dirname, 'kit');

/**
 * The pins of section 2 that the base copy installs, and that are never in the `package.json` of the site. The forms
 * adapter `@astrojs/cloudflare` is in the `package.json` of the site from M7, and its lockfile pins the tree of the
 * adapter with `@cloudflare/vite-plugin` 1.69.1, the version that 13.1 item 63 and S19 measured.
 */
export const PINS = {
  playwright: 'playwright-core@1.65.0',
  islands: ['@astrojs/solid-js@7.1.6', 'solid-js@1.9.19'],
  islandsLint: ['eslint@10.15.0', 'eslint-plugin-solid@0.20.0', 'typescript-eslint@8.73.0'],
} as const;

/**
 * The client directory of a build of the test site, relative to its case folder. The site has forms from M7, so the
 * adapter writes the pages and the edge files to `dist/client/` and the Worker to `dist/server/` (13.1 item 16). A
 * case with forms off (the `static` variant) builds into `dist/` itself.
 */
export const CLIENT = 'dist/client';
/** The Worker config that the adapter writes for a forms build: `wrangler dev` runs the built Worker with it. */
export const WORKER_CONFIG = 'dist/server/wrangler.json';

/** The top-level names of `test/site/` that a hand build leaves there. The base copy does not take them. */
const BUILT = new Set(['node_modules', 'dist', '.astro', '.wrangler']);
/** The file of the base copy that says which packed kit it holds. */
const STAMP = 'kit-acceptance.json';
/** The top-level names of the base copy that are not site files. A refresh and a site case leave them out. */
const OWN = new Set([...BUILT, 'cases', STAMP]);
const NPM_FLAGS = ['--ignore-scripts', '--no-audit', '--no-fund'];
const ASTRO_MANIFEST = 'node_modules/astro/package.json';
const KIT_CLI = 'node_modules/@raess/astro-kit/dist/cli.js';

let cached: string | undefined;

/** Runs npm. Its stdout never reaches the stdout of a test file, which belongs to the test runner. */
const npm = (cwd: string, args: string[], stdout: 'ignore' | 'stderr' = 'ignore'): void => {
  execFileSync('npm', args, {
    cwd,
    stdio: ['ignore', stdout === 'stderr' ? 2 : 'ignore', 'inherit'],
    timeout: 900_000,
  });
};

/**
 * The packed kit of the run. `KIT_TARBALL=<file>` names it. Without the variable, the harness builds the kit of this
 * checkout and packs it into `tmp`: it removes `dist/`, then runs `npm run build` and `npm pack`, at the repository
 * root.
 */
function packedKit(tmp: string): string {
  if (process.env.KIT_TARBALL) {
    const file = resolve(process.env.KIT_TARBALL);
    if (!existsSync(file)) throw new Error(`kit-acceptance: KIT_TARBALL names no file: ${file}`);
    return file;
  }
  // The `dist/` of an earlier build can hold the file of a module that the sources no longer have. It goes first, so
  // that the packed kit holds only what this checkout builds.
  rmSync(join(REPO, 'dist'), { recursive: true, force: true });
  // `tsc` prints its errors on stdout, so a failed build shows them on stderr.
  npm(REPO, ['run', '--silent', 'build'], 'stderr');
  // The log level hides the list of the packed files, which npm prints on stderr.
  npm(REPO, ['pack', '--loglevel=error', '--pack-destination', tmp]);
  const name = readdirSync(tmp).find((entry) => entry.endsWith('.tgz'));
  if (name === undefined) throw new Error(`kit-acceptance: npm pack wrote no .tgz file into ${tmp}`);
  return join(tmp, name);
}

/** The SHA-256 of a packed kit. The stamp of a base copy holds it. The same kit files give the same packed kit. */
const kitStamp = (kit: string): string => createHash('sha256').update(readFileSync(kit)).digest('hex');

/** Every file under `dir` without the top-level names in `skip`, as sorted paths with `/`. */
function filesOf(dir: string, skip: ReadonlySet<string>): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => !skip.has(entry.name))
    .flatMap((entry) => (entry.isDirectory() ? tree(join(dir, entry.name), `${entry.name}/`) : [entry.name]))
    .sort();
}

/** The fields of a manifest that decide which packages `npm ci` installs. */
function packages(dir: string): string {
  const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as Record<string, unknown>;
  const fields = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies', 'overrides'];
  const lock = join(dir, 'package-lock.json');
  return JSON.stringify([
    fields.map((field) => manifest[field] ?? null),
    existsSync(lock) ? readFileSync(lock, 'utf8') : null,
  ]);
}

/**
 * Why the base copy `dir` cannot serve this run, or `undefined` when it can. Its packages must be the ones of the
 * site, and its kit must be the packed kit of this run, which has the stamp `stamp`.
 */
function unfit(dir: string, stamp: string): string | undefined {
  if (packages(dir) !== packages(SITE)) return 'its packages come from another package.json or package-lock.json';
  const file = join(dir, STAMP);
  const held = existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as { kit?: unknown }).kit : undefined;
  if (held === stamp) return undefined;
  const wanted = process.env.KIT_TARBALL ? 'the one of KIT_TARBALL' : 'the kit of this checkout';
  return `it holds another packed kit than ${wanted}`;
}

/**
 * Makes the site files of a reused base copy equal to `test/site/`: a kept base copy is older than the site. It
 * writes only a file that differs. It never touches `node_modules`, `cases` or the stamp.
 */
function refresh(dir: string): void {
  const wanted = filesOf(SITE, BUILT);
  for (const file of wanted) {
    const source = join(SITE, file);
    const target = join(dir, file);
    if (existsSync(target) && readFileSync(source).equals(readFileSync(target))) continue;
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(source, target);
  }
  const keep = new Set(wanted);
  for (const file of filesOf(dir, OWN)) {
    if (keep.has(file)) continue;
    rmSync(join(dir, file), { force: true });
    // The folders that the file leaves empty go too: `rmdir` works only on an empty folder.
    try {
      for (let folder = dirname(join(dir, file)); folder !== dir; folder = dirname(folder)) rmdirSync(folder);
    } catch {
      // The folder holds another file.
    }
  }
}

/** A new base copy in `dir`: the site, its packages, the pins of the suite and the packed kit `kit`. */
function makeBase(dir: string, kit: string): void {
  cpSync(SITE, dir, {
    recursive: true,
    filter: (source) => !BUILT.has(relative(SITE, source).split(sep)[0] ?? ''),
  });
  npm(dir, ['ci', ...NPM_FLAGS]);
  const extra: string[] = [PINS.playwright, ...PINS.islands, ...PINS.islandsLint];
  // One command: a second `--no-save` install removes the packages of the first.
  npm(dir, ['install', '--no-save', ...NPM_FLAGS, ...extra, kit]);
  if (!existsSync(join(dir, KIT_CLI))) throw new Error(`kit-acceptance: the packed kit ${kit} holds no dist/cli.js`);
  writeFileSync(join(dir, STAMP), `${JSON.stringify({ kit: kitStamp(kit) })}\n`);
}

/** What a run works in: its temp folder and its base copy. A reused base copy is not in the temp folder. */
interface Prepared {
  tmp: string;
  base: string;
}

/**
 * Prepares a run. It makes `<tmp>` with the packed kit, and then the base copy `<tmp>/base`.
 * `KIT_ACCEPTANCE_BASE=<dir>` names a base copy of an earlier run to use instead. It must hold the packages of the
 * site's lockfile and the packed kit of this run: else the run stops and says so. It gets the site files again, so
 * it holds the site as it is now.
 */
function prepare(): Prepared {
  const tmp = mkdtempSync(join(tmpdir(), 'kit-acceptance-'));
  try {
    const kit = packedKit(tmp);
    const reuse = process.env.KIT_ACCEPTANCE_BASE ? resolve(process.env.KIT_ACCEPTANCE_BASE) : undefined;
    if (reuse !== undefined && existsSync(join(reuse, ASTRO_MANIFEST))) {
      const reason = unfit(reuse, kitStamp(kit));
      if (reason !== undefined) {
        throw new Error(
          `kit-acceptance: the base copy ${reuse} cannot be reused: ${reason}. ` +
            'Run once without KIT_ACCEPTANCE_BASE and with KIT_ACCEPTANCE_KEEP=1 to make a fresh one.',
        );
      }
      refresh(reuse);
      return { tmp, base: reuse };
    }
    const dir = join(tmp, 'base');
    makeBase(dir, kit);
    return { tmp, base: dir };
  } catch (error) {
    rmSync(tmp, { recursive: true, force: true });
    throw error;
  }
}

/**
 * A run with `KIT_ACCEPTANCE_KEEP` keeps the base copy that it made, and says where it is. The temp folder of a
 * reused base copy holds only the packed kit, so it never stays.
 */
function kept(made: Prepared): boolean {
  return Boolean(process.env.KIT_ACCEPTANCE_KEEP) && made.base === join(made.tmp, 'base');
}

const sayKept = (made: Prepared): void => {
  process.stderr.write(`kit-acceptance: the base copy stays at ${made.base}\n`);
};

const sleep = (ms: number): void => {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
};

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/**
 * When the runner of this test file started, as a text. Every test file of one run reads the same text. Two
 * processes that get the same process id, one after the other, have different texts. It is empty when the machine
 * has neither `/proc` nor a `ps` command that knows `lstart`.
 */
function runnerStart(): string {
  try {
    // Linux: field 22 of the stat file is the start time in clock ticks. The fields follow the last `)`.
    const stat = readFileSync(`/proc/${process.ppid}/stat`, 'utf8');
    return stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19] ?? '';
  } catch {
    // The machine has no `/proc`.
  }
  try {
    return execFileSync('ps', ['-o', 'lstart=', '-p', String(process.ppid)], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 10_000,
    }).trim();
  } catch {
    return '';
  }
}

/**
 * The pointer file of a run: the runner, the process that prepares the run, and the temp folder and the base copy
 * once they are ready.
 */
interface Pointer extends Partial<Prepared> {
  runner: string;
  maker: number;
}

function readPointer(file: string): Pointer | undefined {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as Pointer;
  } catch {
    // The file is gone, or its maker has not written it yet.
    return undefined;
  }
}

/**
 * Removes a pointer file that is left over from an earlier run. Another process of this run may have replaced it
 * already, so the file goes only when it still holds `old`.
 */
function dropPointer(file: string, old: Pointer): void {
  const now = readPointer(file);
  if (now?.runner === old.runner && now.maker === old.maker && now.tmp === old.tmp) rmSync(file, { force: true });
}

/**
 * Leaves the temp folder of the run when this process ends. Each process that uses the folder has a file in
 * `<tmp>/users/`. The last one removes that folder with `rmdir`, which works only on an empty folder, and then the
 * temp folder. A process that comes later cannot add its file, so it prepares a new run.
 */
function leaveAtEnd(tmp: string, pointer: string): void {
  atEnd(() => {
    rmSync(join(tmp, 'users', String(process.pid)), { force: true });
    try {
      rmdirSync(join(tmp, 'users'));
    } catch {
      return;
    }
    if (readPointer(pointer)?.tmp === tmp) rmSync(pointer, { force: true });
    rmSync(tmp, { recursive: true, force: true });
  });
}

/**
 * The base copy of one `node --test` run. The runner starts each test file as a process of its own, and each one
 * needs the packed kit and the base copy. So the first process prepares the run, and the others wait for it and use
 * the same base copy. They find it through a pointer file in the temp folder of the system, named after the runner's
 * process id. The last process of the run removes the pointer file with the temp folder. A kept base copy stays with
 * its pointer file, so that a test file that starts later in the run finds it.
 */
function runBase(): string {
  const pointer = join(tmpdir(), `kit-acceptance-${process.ppid}.json`);
  const runner = runnerStart();
  const deadline = Date.now() + 2_400_000;
  for (;;) {
    let maker = false;
    try {
      // `wx` fails when the file exists, so exactly one process of the run becomes the maker.
      writeFileSync(pointer, JSON.stringify({ runner, maker: process.pid } satisfies Pointer), { flag: 'wx' });
      maker = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    if (maker) {
      try {
        const made = prepare();
        mkdirSync(join(made.tmp, 'users'));
        writeFileSync(join(made.tmp, 'users', String(process.pid)), '');
        writeFileSync(`${pointer}.part`, JSON.stringify({ runner, maker: process.pid, ...made } satisfies Pointer));
        renameSync(`${pointer}.part`, pointer);
        if (kept(made)) sayKept(made);
        else leaveAtEnd(made.tmp, pointer);
        return made.base;
      } catch (error) {
        // The next process that waits becomes the maker and shows its own error.
        rmSync(pointer, { force: true });
        throw error;
      }
    }
    const state = readPointer(pointer);
    if (state?.tmp !== undefined && state.base !== undefined) {
      const made: Prepared = { tmp: state.tmp, base: state.base };
      let joined = false;
      try {
        // A pointer of another runner is left over from an earlier run with the same process id.
        if (state.runner === runner) {
          writeFileSync(join(made.tmp, 'users', String(process.pid)), '');
          joined = existsSync(join(made.base, ASTRO_MANIFEST));
        }
      } catch {
        // The folder `users` is gone: the last process of an earlier run removed the temp folder.
      }
      if (joined) {
        if (!kept(made)) leaveAtEnd(made.tmp, pointer);
        return made.base;
      }
      if (state.runner === runner) rmSync(join(made.tmp, 'users', String(process.pid)), { force: true });
      dropPointer(pointer, state);
      continue;
    }
    // A maker of another runner, or one that ended before the run was ready, never finishes the pointer.
    if (state !== undefined && (state.runner !== runner || !alive(state.maker))) {
      dropPointer(pointer, state);
      continue;
    }
    if (Date.now() > deadline) throw new Error(`kit-acceptance: no base copy after 40 minutes; remove ${pointer}`);
    sleep(250);
  }
}

/**
 * The base copy. It is made once for each run, also when the run has more than one test file.
 * `KIT_ACCEPTANCE_KEEP=1` keeps it and prints its path. `KIT_ACCEPTANCE_BASE=<dir>` uses a kept one again; that
 * saves the install while a case is written (see `prepare`).
 */
export function base(): string {
  if (cached) return cached;
  // A child of `node --test` shares the base copy with the other test files of the run.
  if (process.env.NODE_TEST_CONTEXT) {
    cached = runBase();
    return cached;
  }
  const made = prepare();
  if (kept(made)) sayKept(made);
  else atEnd(() => rmSync(made.tmp, { recursive: true, force: true }));
  cached = made.base;
  return made.base;
}

/** `require` from the base copy, for packages that the suite must not depend on itself (14.2). */
export function baseRequire(): NodeJS.Require {
  return createRequire(join(base(), 'package.json'));
}

export type Files = Record<string, string | Uint8Array>;

export function write(dir: string, files: Files): void {
  for (const [name, content] of Object.entries(files)) {
    const file = join(dir, name);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
  }
}

/** A new, empty case folder `<base>/cases/<name>/`. A spike gets the stand-in integration in `kit/` as well. */
export function caseDir(name: string, files: Files = {}, options: { kit?: boolean } = {}): string {
  const dir = join(base(), 'cases', name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  if (options.kit !== false) cpSync(STAND_IN, join(dir, 'kit'), { recursive: true });
  write(dir, { 'package.json': `${JSON.stringify({ name, private: true, type: 'module' }, null, 2)}\n`, ...files });
  return dir;
}

/**
 * A site case: a copy of the site in `<base>/cases/<name>/`, with one change. It takes the site files of the base
 * copy, so not `node_modules`, `cases` and the stamp. `change` gets the case folder and plants what the case tests.
 */
export function siteCase(name: string, change?: (dir: string) => void): string {
  const root = base();
  const dir = join(root, 'cases', name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  // Entry by entry: `cpSync` refuses to copy a folder into a folder of its own.
  for (const entry of readdirSync(root)) {
    if (!OWN.has(entry)) cpSync(join(root, entry), join(dir, entry), { recursive: true });
  }
  change?.(dir);
  return dir;
}

/** Replaces `find` in a file of a case. It throws when the file does not change, so a planted case stays planted. */
export function edit(dir: string, file: string, find: string | RegExp, replacement: string): void {
  const before = read(dir, file);
  const after = before.replace(find, replacement);
  if (after === before) throw new Error(`kit-acceptance: ${file} holds no match for ${String(find)}`);
  write(dir, { [file]: after });
}

export interface Run {
  status: number | null;
  /** stdout and stderr, in one text. */
  output: string;
}

const ENV = { ASTRO_TELEMETRY_DISABLED: '1', GITHUB_STEP_SUMMARY: '', WRANGLER_SEND_METRICS: 'false', CI: '1' };

/**
 * The environment of the machine without the Cloudflare variables. `CLOUDFLARE_ENV` chooses the environment of a
 * build and of a wrangler command, so a value from the shell would change what a spike builds. No command of the
 * suite needs a token or an account.
 */
export function machineEnv(): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...process.env };
  delete env.CLOUDFLARE_ENV;
  delete env.CLOUDFLARE_API_TOKEN;
  delete env.CLOUDFLARE_ACCOUNT_ID;
  return env;
}

/** The entry file of the `astro` command in the base copy, read from the `bin` field of its manifest. */
export function astroBin(): string {
  const dir = join(base(), 'node_modules/astro');
  const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { bin: string | { astro: string } };
  return join(dir, typeof manifest.bin === 'string' ? manifest.bin : manifest.bin.astro);
}

/**
 * Runs Astro of the base copy in the case folder: `astro build` unless `args` says otherwise.
 * Only `env` can set `CLOUDFLARE_ENV`, for example `{ CLOUDFLARE_ENV: 'preview' }`.
 */
export function astro(dir: string, args: string[] = ['build'], env: Record<string, string> = {}): Run {
  const result = spawnSync(process.execPath, [astroBin(), ...args], {
    cwd: dir,
    env: { ...machineEnv(), ...ENV, ...env },
    encoding: 'utf8',
    timeout: 600_000,
    maxBuffer: 64 * 1024 * 1024,
  });
  return { status: result.status, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

/**
 * The result of a kit command: the run, its stdout alone, and the rule ids of its failing findings, sorted and
 * without repeats.
 */
export interface KitRun extends Run {
  /** stdout alone. The passed line of a command that runs checks is its last line (specification, 6.4). */
  stdout: string;
  ids: string[];
}

/** The entry file of the kit CLI in the base copy: the CLI of the packed kit. */
export const kitCli = (): string => join(base(), KIT_CLI);

/** The rule ids of the failing findings in an output (specification, 6.4), sorted and without repeats. */
export function ruleIds(output: string): string[] {
  const ids = [...plain(output).matchAll(/✗ \[([a-z0-9-]+)\]/g)].map((match) => match[1] ?? '');
  return [...new Set(ids)].sort();
}

/**
 * Runs a command of the kit CLI of the base copy in a case folder: `run('site', 'build')` or
 * `run(dir, ['tokens', '--check'])`. `target` is the name of a case or the path of its folder.
 */
export function run(target: string, command: string | readonly string[], env: Record<string, string> = {}): KitRun {
  const dir = isAbsolute(target) ? target : join(base(), 'cases', target);
  const args = typeof command === 'string' ? command.split(' ').filter(Boolean) : [...command];
  const result = spawnSync(process.execPath, [kitCli(), ...args], {
    cwd: dir,
    env: { ...machineEnv(), ...ENV, ...env },
    encoding: 'utf8',
    timeout: 600_000,
    maxBuffer: 64 * 1024 * 1024,
  });
  const stdout = result.stdout ?? '';
  const output = `${stdout}${result.stderr ?? ''}`;
  return { status: result.status, stdout, output, ids: ruleIds(output) };
}

/** The passed line of the kit CLI (specification, 6.4). */
export const PASSED_LINE = 'astro-kit: all checks passed.';

/**
 * Where the passed line stands in the result of a kit command. `last` says that it is the last line of stdout.
 * `count` says how often the whole output holds it. A passing command that runs checks gives
 * `{ last: true, count: 1 }`. A failing command, and a command that runs no check, gives `{ last: false, count: 0 }`.
 */
export function passedLine(result: KitRun): { last: boolean; count: number } {
  const stdout = plain(result.stdout);
  return {
    last: stdout === `${PASSED_LINE}\n` || stdout.endsWith(`\n${PASSED_LINE}\n`),
    count: plain(result.output).split(PASSED_LINE).length - 1,
  };
}

/**
 * A built module of the kit in the base copy, for example `kitModule('modes')` or `kitModule('hosts/cloudflare')`.
 * It is imported by its file URL, because the exports map of the kit hides it (specification, 3.4). The caller
 * names the members that it uses as `T`.
 */
export function kitModule<T>(name: string): Promise<T> {
  const file = join(base(), 'node_modules/@raess/astro-kit/dist', `${name}.js`);
  return import(pathToFileURL(file).href) as Promise<T>;
}

const endings = new Set<() => void>();
const runEndings = (): void => {
  for (const ending of endings) {
    try {
      ending();
    } catch {
      // The other endings still run.
    }
  }
};
// Node emits no `exit` event when a signal ends the process. So the suite catches the signals that end a run
// (Ctrl-C, a runner, a `timeout` command), runs the endings, and then ends itself with the same signal.
const SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const;
const onSignal = (signal: NodeJS.Signals): void => {
  runEndings();
  for (const name of SIGNALS) process.removeListener(name, onSignal);
  process.kill(process.pid, signal);
};

/**
 * Registers `ending` for the end of the test process: a normal exit, or one of the signals SIGINT, SIGTERM and SIGHUP.
 * A spike uses it to end a child process that it started itself, so that the child does not outlive the run.
 * `ending` must not wait for anything. The returned function takes it out again, when the child is gone.
 */
export function atEnd(ending: () => void): () => void {
  if (endings.size === 0) {
    process.on('exit', runEndings);
    for (const name of SIGNALS) process.on(name, onSignal);
  }
  endings.add(ending);
  return () => {
    endings.delete(ending);
    if (endings.size > 0) return;
    process.removeListener('exit', runEndings);
    for (const name of SIGNALS) process.removeListener(name, onSignal);
  };
}

/** Builds the case. It throws with the end of the build output when the build fails. */
export function build(dir: string, env: Record<string, string> = {}): Run {
  const result = astro(dir, ['build'], env);
  if (result.status !== 0) {
    throw new Error(`astro build ended with status ${result.status} in ${dir}:\n${result.output.slice(-4000)}`);
  }
  return result;
}

export const read = (dir: string, file: string): string => readFileSync(join(dir, file), 'utf8');

/** Every file under `dir`, as sorted paths with `/`. */
export const tree = (dir: string, prefix = ''): string[] =>
  readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) =>
      entry.isDirectory() ? tree(join(dir, entry.name), `${prefix}${entry.name}/`) : [`${prefix}${entry.name}`],
    )
    .sort();

/** The text of a command's output without its color codes and its other terminal control sequences. */
export const plain = (text: string): string => stripVTControlCharacters(text);

/** What a spike uses from the stand-in integration `kit/integration.mjs`, which is plain JavaScript. */
export interface StandIn {
  SPECULATION_JSON: string;
  SPECULATION_HASH: string;
  sha256(text: string): string;
  modeScript(setting: Record<string, unknown>): string;
  headerCsp(options: Record<string, unknown>): string;
}

export const standIn = (): Promise<StandIn> =>
  import(pathToFileURL(join(STAND_IN, 'integration.mjs')).href) as Promise<StandIn>;

export type { ServeOptions };

/** The kit's static server for a spike or a case, with the request targets as a list of their own. */
export interface Served extends KitServed {
  /** Every request target that the server saw, with the query, in order: the paths of `received`. */
  readonly requests: string[];
}

/**
 * Serves a built `dist/` with `serveDist` of the packed kit (14.2, "Kit functions"): `dist/client` when it is the
 * client directory, else `dist`. The server records every request, with its method and its headers, in `received`.
 */
export async function serve(dist: string, options: ServeOptions = {}): Promise<Served> {
  const { serveDist } = await kitModule<typeof ServeModule>('serve');
  const served = await serveDist(dist, options);
  return {
    origin: served.origin,
    address: served.address,
    root: served.root,
    received: served.received,
    get requests() {
      return served.received.map((request) => request.path);
    },
    close: () => served.close(),
  };
}

interface Playwright {
  chromium: { launch(options: Record<string, unknown>): Promise<Browser>; executablePath(): string };
}

const playwright = (): Playwright => baseRequire()('playwright-core') as Playwright;

let warned = false;

/**
 * The Chromium of 2.1: `CHROME_PATH`, else the Chromium that playwright-core installed, else the system Chrome.
 * The system Chrome changes with no commit. The Playwright build changes only with the playwright-core pin.
 */
export function chromePath(): string | undefined {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  let installed = '';
  try {
    // playwright-core names the path of its pinned build. The file is there only after `playwright-core install`.
    installed = playwright().chromium.executablePath();
  } catch {
    // playwright-core has no Chromium build for this platform.
  }
  if (installed && existsSync(installed)) return installed;
  const other = ['/usr/bin/google-chrome', '/opt/pw-browsers/chromium'].find((candidate) => existsSync(candidate));
  // The suite then runs on a browser that no pin decides. Say so once, so that a run shows it.
  if (!warned) {
    warned = true;
    process.stderr.write(
      `kit-acceptance: the Chromium of ${PINS.playwright} is not installed${installed ? ` at ${installed}` : ''}. ` +
        `The suite uses ${other ?? 'the browser that playwright-core finds'}. ` +
        'Run `npx --no playwright-core install chromium` with that version, or set CHROME_PATH.\n',
    );
  }
  return other;
}

// The suite must not depend on playwright-core itself, so these are the few members that the spikes use.
export interface ConsoleMessage {
  type(): string;
  text(): string;
}
export interface Page {
  goto(url: string, options?: Record<string, unknown>): Promise<unknown>;
  goBack(options?: Record<string, unknown>): Promise<unknown>;
  url(): string;
  frames(): { url(): string }[];
  close(): Promise<void>;
  evaluate<T>(fn: string | ((arg: never) => T | Promise<T>), arg?: unknown): Promise<T>;
  addInitScript(script: string | { content: string }): Promise<void>;
  // A function, never a string: the page CSP forbids `eval`, which a string predicate needs.
  waitForFunction(fn: (arg: never) => unknown, arg?: unknown, options?: Record<string, unknown>): Promise<unknown>;
  waitForURL(url: string, options?: Record<string, unknown>): Promise<void>;
  waitForLoadState(state?: string): Promise<void>;
  click(selector: string, options?: Record<string, unknown>): Promise<void>;
  hover(selector: string): Promise<void>;
  focus(selector: string): Promise<void>;
  keyboard: { press(key: string): Promise<void> };
  emulateMedia(options: Record<string, string | null>): Promise<void>;
  on(event: string, listener: (value: never) => void): void;
  [member: string]: unknown;
}
/** A session of the Chrome DevTools Protocol. */
export interface Cdp {
  send(method: string, params?: Record<string, unknown>): Promise<unknown>;
  on(event: string, listener: (value: never) => void): void;
}
export interface BrowserContext {
  newPage(): Promise<Page>;
  route(pattern: string | RegExp, handler: (route: never) => unknown): Promise<void>;
  addInitScript(script: string | { content: string }): Promise<void>;
  newCDPSession(page: Page): Promise<Cdp>;
  waitForEvent(event: string, options?: Record<string, unknown>): Promise<unknown>;
  on(event: string, listener: (value: never) => void): void;
  close(): Promise<void>;
  [member: string]: unknown;
}
export interface Browser {
  newContext(options?: Record<string, unknown>): Promise<BrowserContext>;
  close(): Promise<void>;
  [member: string]: unknown;
}

/** Launches Chromium with the back/forward cache on, as the kit's browser checks do (section 8, the harness). */
export function launch(): Promise<Browser> {
  const executablePath = chromePath();
  return playwright().chromium.launch({
    ...(executablePath ? { executablePath } : {}),
    ignoreDefaultArgs: ['--disable-back-forward-cache'],
    timeout: 60_000,
  });
}

/** A static server for a built `dist/` and a Chromium, opened together. */
export interface Browsing {
  server: Served;
  browser: Browser;
  /** Closes the browser and then the server. The server closes also when the browser does not. */
  close(): Promise<void>;
}

/**
 * Serves `dist` and launches Chromium. When the launch fails, it closes the server first: an open server keeps the
 * test process alive, so the run would never end. Use it as `const { server, browser, close } = await browse(dist);
 * try { … } finally { await close(); }`.
 */
export async function browse(dist: string, options: ServeOptions = {}): Promise<Browsing> {
  const server = await serve(dist, options);
  try {
    const browser = await launch();
    const close = async (): Promise<void> => {
      try {
        await browser.close();
      } finally {
        await server.close();
      }
    };
    return { server, browser, close };
  } catch (error) {
    await server.close();
    throw error;
  }
}

export type Pixel = number[];

/**
 * Page code: a function that paints a CSS color on a 1×1 canvas and gives its four channels, each 0 to 255, as
 * the contrast probe of section 8 does. It gives an empty list for a text that is no color.
 * A spike compares two colors this way, and never as computed text: Chromium versions print a color differently.
 * Use it in an init script (`window.__pixel = ${PIXEL_SOURCE};`) or in a script of the page.
 */
export const PIXEL_SOURCE = `(() => {
  let context;
  return (color) => {
    if (!CSS.supports('color', color)) return [];
    context ??= Object.assign(document.createElement('canvas'), { width: 1, height: 1 }).getContext('2d', { willReadFrequently: true });
    context.clearRect(0, 0, 1, 1);
    context.fillStyle = color;
    context.fillRect(0, 0, 1, 1);
    return Array.from(context.getImageData(0, 0, 1, 1).data);
  };
})()`;

/** The largest difference of a channel between two painted colors, of 255. `Infinity` when one of them is no color. */
export function pixelDistance(a: Pixel, b: Pixel): number {
  if (a.length !== 4 || b.length !== 4) return Number.POSITIVE_INFINITY;
  return Math.max(...a.map((channel, index) => Math.abs(channel - (b[index] ?? 0))));
}

/** Two painted colors are the same color: each of the four channels is equal within 1 of 255 (`modes-behavior`). */
export const samePixel = (a: Pixel, b: Pixel): boolean => pixelDistance(a, b) <= 1;

// `KIT_SPIKES_RESULTS=<file>` sends the values to another file, for a run that must not touch the committed one.
const RESULTS = process.env.KIT_SPIKES_RESULTS ?? join(import.meta.dirname, 'spikes.results.json');

/**
 * Records a measured value under `key` in `test/acceptance/spikes.results.json`. A new key is written. A known key
 * must hold the same value, else the spike fails with an `AssertionError` that holds both values: a platform fact
 * changed. `KIT_SPIKES_WRITE=1` accepts the new value. On CI (`CI` is set) a new key fails the spike: the run throws
 * the written file away, so nothing would ever compare a value that the committed file does not hold.
 */
export function record(key: string, value: unknown): void {
  const all = existsSync(RESULTS) ? (JSON.parse(readFileSync(RESULTS, 'utf8')) as Record<string, unknown>) : {};
  const known = key in all;
  if (!process.env.KIT_SPIKES_WRITE) {
    if (known && isDeepStrictEqual(value, all[key])) return;
    if (known) {
      throw new AssertionError({
        message: `${key} changed; run with KIT_SPIKES_WRITE=1 to accept the new value`,
        actual: value,
        expected: all[key],
        operator: 'deepStrictEqual',
      });
    }
    if (process.env.CI) {
      throw new Error(
        `${key} is not in test/acceptance/spikes.results.json; run with KIT_SPIKES_WRITE=1 and commit the file`,
      );
    }
  }
  all[key] = value;
  const sorted = Object.fromEntries(
    Object.entries(all).sort(([a], [b]) => a.localeCompare(b, 'en', { numeric: true })),
  );
  writeFileSync(RESULTS, `${JSON.stringify(sorted, null, 2)}\n`);
}

/** The text of every inline `<style>` of a built page, joined. */
export const styles = (html: string): string =>
  [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((match) => match[1]).join('\n');

/** The names of the top-level `@layer` blocks and statements of built CSS, in order of first appearance. */
export function layerOrder(css: string): string[] {
  const order: string[] = [];
  for (const match of css.matchAll(/@layer\s+([^{;]+)[{;]/g)) {
    for (const name of (match[1] ?? '').split(',').map((part) => part.trim())) {
      if (name && !order.includes(name)) order.push(name);
    }
  }
  return order;
}

/** The content of the CSP meta of a built page. */
export function cspMeta(html: string): string {
  const tag = /<meta\b[^>]*http-equiv="?content-security-policy"?[^>]*>/i.exec(html)?.[0] ?? '';
  return /content="([^"]*)"/.exec(tag)?.[1] ?? '';
}

/**
 * The harness of the acceptance suite (specification, 14.2).
 * - The base copy: the repository's working tree in a temp folder, with its packages installed once. With
 *   `KIT_TARBALL` it holds the packed kit too.
 * - Case folders under `<base>/cases/<name>/`. Node, Astro and the kit walk up to `<base>/node_modules` for every
 *   package. A spike starts from an empty folder (`caseDir`). A site case starts from a copy of the site (`siteCase`).
 * - Runners for the kit CLI (`run`), Astro, a static server, Chromium, and the file of measured values.
 */
import assert from 'node:assert/strict';
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
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { serve as serveDist, type Served, type ServeOptions } from './serve.ts';

export const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '');
export const KIT_DIR = join(ROOT, 'test/kit');

/**
 * The pins of section 2 that the base copy installs, and that are never in `package.json`.
 * `@cloudflare/vite-plugin` is not a pin of section 2. The adapter asks for the range `^1.67.0` of it, and no lockfile
 * holds the adapter's tree before M7. The plugin brings its own wrangler, which writes the built Worker config, so a
 * new plugin release would change the config with no commit. Its own dependencies are exact versions. The pin goes
 * away at M7, when `package.json` and the lockfile hold the adapter.
 */
export const PINS = {
  playwright: 'playwright-core@1.65.0',
  cloudflare: ['@astrojs/cloudflare@14.4.7', '@cloudflare/vite-plugin@1.69.1'],
  islands: ['@astrojs/solid-js@7.1.5', 'solid-js@1.9.19'],
  islandsLint: ['eslint@10.14.0', 'eslint-plugin-solid@0.19.0', 'typescript-eslint@8.72.2'],
} as const;

/** The top-level names of the working tree that the base copy does not take. */
const SKIP = new Set(['.git', 'kit', 'node_modules', 'dist', '.astro', '.wrangler']);
/** The file of the base copy that says which packed kit it holds. */
const STAMP = 'kit-acceptance.json';
/** The top-level names of the base copy that are not files of the working tree. */
const OWN = new Set([...SKIP, 'cases', STAMP]);
/** The top-level names of the base copy that are not site files: a site case does not take them. */
const NOT_SITE = new Set([...OWN, 'test']);
const NPM_FLAGS = ['--ignore-scripts', '--no-audit', '--no-fund'];
const ASTRO_MANIFEST = 'node_modules/astro/package.json';

let cached: string | undefined;

const npm = (cwd: string, args: string[]): void => {
  execFileSync('npm', args, { cwd, stdio: ['ignore', 'ignore', 'inherit'], timeout: 900_000 });
};

/** The packed kit of `KIT_TARBALL` as an absolute path, or `undefined` when the variable is not set. */
const tarball = (): string | undefined => (process.env.KIT_TARBALL ? resolve(process.env.KIT_TARBALL) : undefined);

/** The SHA-256 of the packed kit of `KIT_TARBALL`, or `null` without one. The stamp of a base copy holds it. */
function kitStamp(): string | null {
  const file = tarball();
  return file === undefined ? null : createHash('sha256').update(readFileSync(file)).digest('hex');
}

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
 * working tree, and with `KIT_TARBALL` its kit must be that packed kit. Without `KIT_TARBALL` the run uses the kit
 * that the base copy holds, or none.
 */
function unfit(dir: string): string | undefined {
  if (packages(dir) !== packages(ROOT)) return 'its packages come from another package.json or package-lock.json';
  const wanted = kitStamp();
  if (wanted === null) return undefined;
  const stamp = join(dir, STAMP);
  const held = existsSync(stamp) ? (JSON.parse(readFileSync(stamp, 'utf8')) as { kit?: unknown }).kit : undefined;
  return held === wanted ? undefined : 'it does not hold the packed kit of KIT_TARBALL';
}

const TSCONFIG = 'tsconfig.json';

/**
 * The files of the working tree that the base copy `dir` must not hold. It is `tsconfig.json` when the base copy
 * cannot resolve its `extends`: the shim of the site extends the preset of the kit, and a base copy without
 * `KIT_TARBALL` holds no kit. Vite loads every `tsconfig.json` from a project folder up to the root of the file
 * system, also when a nearer one exists. So the file would stop the build of every spike with
 * `Tsconfig not found @raess/astro-kit/tsconfig.json`. Only the site cases need the file, and they need the kit too.
 */
function unusable(dir: string): ReadonlySet<string> {
  const file = join(ROOT, TSCONFIG);
  if (!existsSync(file)) return new Set();
  const parent = (JSON.parse(readFileSync(file, 'utf8')) as { extends?: unknown }).extends;
  if (typeof parent !== 'string' || parent.startsWith('.')) return new Set();
  try {
    createRequire(join(dir, 'package.json')).resolve(parent);
    return new Set();
  } catch {
    return new Set([TSCONFIG]);
  }
}

/**
 * Makes the files of a reused base copy equal to the working tree: a kept base copy is older than the site. It
 * writes only a file that differs, and it puts each file in place with one rename. So the test files of one run,
 * which are separate processes, can do it at the same time. It never touches `node_modules` or `cases`.
 */
function refresh(dir: string): void {
  const left = unusable(dir);
  const wanted = filesOf(ROOT, SKIP).filter((file) => !left.has(file));
  for (const file of wanted) {
    const source = join(ROOT, file);
    const target = join(dir, file);
    if (existsSync(target) && readFileSync(source).equals(readFileSync(target))) continue;
    mkdirSync(dirname(target), { recursive: true });
    const part = `${target}.${process.pid}.part`;
    copyFileSync(source, part);
    renameSync(part, target);
  }
  const keep = new Set(wanted);
  for (const file of filesOf(dir, OWN)) {
    // A `.part` file belongs to another process that is refreshing the same base copy.
    if (!keep.has(file) && !file.endsWith('.part')) rmSync(join(dir, file), { force: true });
  }
}

/** A new base copy `<tmp>/base`: the working tree, its packages, the pins of the suite and the packed kit. */
function makeBase(): string {
  const tmp = mkdtempSync(join(tmpdir(), 'kit-acceptance-'));
  const dir = join(tmp, 'base');
  cpSync(ROOT, dir, {
    recursive: true,
    filter: (source) => source === ROOT || !SKIP.has(source.slice(ROOT.length + 1).split('/')[0] ?? ''),
  });
  npm(dir, ['ci', ...NPM_FLAGS]);
  const extra: string[] = [PINS.playwright, ...PINS.islands, ...PINS.islandsLint];
  // `@astrojs/cloudflare` joins `package.json` at M7 (specification, 14). Until then the base copy adds it.
  const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as {
    dependencies?: Record<string, string>;
  };
  if (!manifest.dependencies?.['@astrojs/cloudflare']) extra.push(...PINS.cloudflare);
  const kit = tarball();
  if (kit !== undefined) extra.push(kit);
  // One command: a second `--no-save` install removes the packages of the first.
  npm(dir, ['install', '--no-save', ...NPM_FLAGS, ...extra]);
  for (const file of unusable(dir)) rmSync(join(dir, file), { force: true });
  writeFileSync(join(dir, STAMP), `${JSON.stringify({ kit: kitStamp() })}\n`);
  return tmp;
}

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

/** The pointer file of a run: the process that makes the base copy, and the temp folder once the copy is ready. */
interface Pointer {
  maker: number;
  tmp?: string;
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
 * Leaves the base copy of the run when this process ends. Each process that uses the copy has a file in
 * `<tmp>/users/`. The last one removes that folder with `rmdir`, which works only on an empty folder, and then the
 * temp folder. A process that comes later cannot add its file, so it makes a new base copy.
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
 * needs the base copy. So the first process makes it, and the others wait for it and use the same one. They find it
 * through a pointer file in the temp folder of the system, named after the runner's process id. The last process of
 * the run removes the pointer file with the base copy. With `KIT_ACCEPTANCE_KEEP` both stay, so that a test file
 * that starts later in the run finds the kept copy.
 */
function runBase(): string {
  const pointer = join(tmpdir(), `kit-acceptance-${process.ppid}.json`);
  const keep = Boolean(process.env.KIT_ACCEPTANCE_KEEP);
  const deadline = Date.now() + 2_400_000;
  for (;;) {
    let maker = false;
    try {
      // `wx` fails when the file exists, so exactly one process of the run becomes the maker.
      writeFileSync(pointer, JSON.stringify({ maker: process.pid } satisfies Pointer), { flag: 'wx' });
      maker = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    if (maker) {
      try {
        const tmp = makeBase();
        mkdirSync(join(tmp, 'users'));
        writeFileSync(join(tmp, 'users', String(process.pid)), '');
        writeFileSync(`${pointer}.part`, JSON.stringify({ maker: process.pid, tmp } satisfies Pointer));
        renameSync(`${pointer}.part`, pointer);
        if (keep) process.stderr.write(`kit-acceptance: the base copy stays at ${join(tmp, 'base')}\n`);
        else leaveAtEnd(tmp, pointer);
        return join(tmp, 'base');
      } catch (error) {
        // The next process that waits becomes the maker and shows its own error.
        rmSync(pointer, { force: true });
        throw error;
      }
    }
    const state = readPointer(pointer);
    if (state?.tmp !== undefined) {
      const dir = join(state.tmp, 'base');
      let joined = false;
      try {
        writeFileSync(join(state.tmp, 'users', String(process.pid)), '');
        joined = existsSync(join(dir, ASTRO_MANIFEST)) && unfit(dir) === undefined;
      } catch {
        // The folder `users` is gone: the last process of an earlier run removed the base copy.
      }
      if (joined) {
        refresh(dir);
        if (!keep) leaveAtEnd(state.tmp, pointer);
        return dir;
      }
      // The pointer is left over from an earlier run with the same process id. Another process of this run may
      // have replaced it already, so only the old one is removed.
      rmSync(join(state.tmp, 'users', String(process.pid)), { force: true });
      if (readPointer(pointer)?.tmp === state.tmp) rmSync(pointer, { force: true });
      continue;
    }
    if (state !== undefined && !alive(state.maker)) {
      rmSync(pointer, { force: true });
      continue;
    }
    if (Date.now() > deadline) throw new Error(`kit-acceptance: no base copy after 40 minutes; remove ${pointer}`);
    sleep(250);
  }
}

/**
 * The base copy. It is made once for each run, also when the run has more than one test file.
 * `KIT_ACCEPTANCE_BASE=<dir>` reuses a base that an earlier run made with `KIT_ACCEPTANCE_KEEP=1`; that saves the
 * install while a case is written. A reused base copy gets the files of the working tree again, so it holds the site
 * as it is now. It must hold the packages of the lockfile and, with `KIT_TARBALL`, that packed kit: else the run stops
 * and says so.
 */
export function base(): string {
  if (cached) return cached;
  const reuse = process.env.KIT_ACCEPTANCE_BASE ? resolve(process.env.KIT_ACCEPTANCE_BASE) : undefined;
  if (reuse !== undefined && existsSync(join(reuse, ASTRO_MANIFEST))) {
    const reason = unfit(reuse);
    if (reason !== undefined) {
      throw new Error(
        `kit-acceptance: the base copy ${reuse} cannot be reused: ${reason}. ` +
          'Run once without KIT_ACCEPTANCE_BASE and with KIT_ACCEPTANCE_KEEP=1 to make a fresh one.',
      );
    }
    refresh(reuse);
    cached = reuse;
    return reuse;
  }
  // A child of `node --test` shares the base copy with the other test files of the run.
  if (process.env.NODE_TEST_CONTEXT) {
    cached = runBase();
    return cached;
  }
  const tmp = makeBase();
  const dir = join(tmp, 'base');
  if (process.env.KIT_ACCEPTANCE_KEEP) {
    process.stderr.write(`kit-acceptance: the base copy stays at ${dir}\n`);
  } else {
    atEnd(() => rmSync(tmp, { recursive: true, force: true }));
  }
  cached = dir;
  return dir;
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
  if (options.kit !== false) cpSync(KIT_DIR, join(dir, 'kit'), { recursive: true });
  write(dir, { 'package.json': `${JSON.stringify({ name, private: true, type: 'module' }, null, 2)}\n`, ...files });
  return dir;
}

/**
 * A site case: a copy of the site in `<base>/cases/<name>/`, with one change. It takes the site files of the base
 * copy, so not `node_modules`, `cases` and `test`. `change` gets the case folder and plants what the case tests.
 */
export function siteCase(name: string, change?: (dir: string) => void): string {
  const root = base();
  const dir = join(root, 'cases', name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  // Entry by entry: `cpSync` refuses to copy a folder into a folder of its own.
  for (const entry of readdirSync(root)) {
    if (!NOT_SITE.has(entry)) cpSync(join(root, entry), join(dir, entry), { recursive: true });
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

/** The result of a kit command: the run, and the rule ids of its failing findings, sorted and without repeats. */
export interface KitRun extends Run {
  ids: string[];
}

/** The entry file of the kit CLI in the base copy. The file is there only when the base copy holds a built kit. */
export const kitCli = (): string => join(base(), 'node_modules/@raess/astro-kit/dist/cli.js');

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
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  return { status: result.status, output, ids: ruleIds(output) };
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

/**
 * Why the cases that need the kit cannot run, or `undefined` when the base copy holds a built kit. The kit is there
 * with `KIT_TARBALL`, or in a reused base copy that got it. The placeholder package of npm has no CLI, so it is no
 * kit. A test file gives the reason to each of its tests as the option `skip`. So a case without a kit is skipped
 * with the reason, never failed: the spikes use no kit, and they must run before the kit can be packed.
 */
export function noKit(): string | undefined {
  if (existsSync(kitCli())) return undefined;
  if (process.env.KIT_TARBALL) throw new Error(`kit-acceptance: KIT_TARBALL is set, but ${kitCli()} is missing`);
  return 'the base copy holds no built kit; set KIT_TARBALL=<packed kit> to run this case';
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

/** Builds the case and fails with the build output when the build fails. */
export function build(dir: string, env: Record<string, string> = {}): Run {
  const result = astro(dir, ['build'], env);
  assert.equal(result.status, 0, `astro build failed in ${dir}:\n${result.output.slice(-4000)}`);
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

/** The text of a command's output without its color codes. */
export const plain = (text: string): string => text.replace(/\u001b\[[0-9;]*m/g, '');

/** What a spike uses from the stand-in integration `test/kit/integration.mjs`, which is plain JavaScript. */
export interface StandIn {
  SPECULATION_JSON: string;
  SPECULATION_HASH: string;
  sha256(text: string): string;
  modeScript(setting: Record<string, unknown>): string;
  headerCsp(options: Record<string, unknown>): string;
}

export const standIn = (): Promise<StandIn> =>
  import(pathToFileURL(join(KIT_DIR, 'integration.mjs')).href) as Promise<StandIn>;

export function serve(dist: string, options: ServeOptions = {}): Promise<Served> {
  return serveDist(dist, options);
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
const RESULTS = process.env.KIT_SPIKES_RESULTS ?? join(ROOT, 'test/spikes.results.json');

/**
 * Records a measured value under `key` in `test/spikes.results.json`. A new key is written. A known key must hold
 * the same value, else the spike fails: a platform fact changed. `KIT_SPIKES_WRITE=1` accepts the new value.
 * On CI (`CI` is set) a new key fails the spike: the run throws the written file away, so nothing would ever compare
 * a value that the committed file does not hold.
 */
export function record(key: string, value: unknown): void {
  const all = existsSync(RESULTS) ? (JSON.parse(readFileSync(RESULTS, 'utf8')) as Record<string, unknown>) : {};
  const known = key in all;
  if (known && !process.env.KIT_SPIKES_WRITE) {
    assert.deepEqual(value, all[key], `${key} changed; run with KIT_SPIKES_WRITE=1 to accept the new value`);
    return;
  }
  if (!known && process.env.CI && !process.env.KIT_SPIKES_WRITE) {
    assert.fail(`${key} is not in test/spikes.results.json; run with KIT_SPIKES_WRITE=1 and commit the file`);
  }
  all[key] = value;
  const sorted = Object.fromEntries(Object.entries(all).sort(([a], [b]) => a.localeCompare(b, 'en', { numeric: true })));
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

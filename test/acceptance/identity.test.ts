/**
 * The `identity` case of 14.2 (part 9d of M9): `kit-identity.sh` (10.3) on the complete lockfile of a kit project.
 *
 * 1. A copy of the test site becomes a git repository: one commit of every file, and `refs/remotes/origin/main` at
 *    it. The copy holds `.github/kit-identity.sh` as `init --protected` rendered it into `test/site/` (10.6); the
 *    case asserts that it equals the template of the packed kit.
 * 2. On the lockfile of the commit, which has no kit, the script fails with `package-lock.json has no
 *    node_modules/@raess/astro-kit entry`.
 * 3. `npm install --package-lock-only` of the packed kit writes the kit entry and the kit's own package tree into the
 *    lockfile, and installs nothing. The kit entry is a local tarball, so the script fails and names it.
 * 4. With `resolved` of the kit entry in the form of a registry install, and the `sha512` hash that npm wrote, the
 *    script passes with status 0 and its last line: every entry of the lockfile is an npm registry package. The
 *    packed kit is not on the registry, so a fake `npm` first on the path answers the script's `npm view` with the
 *    sha512 of the packed tarball; the case asserts the arguments of that one call, and that its cache folder was
 *    fresh and empty and is gone after the run. The two failing runs have the fake too, and make no call.
 * Run: node --test test/acceptance/identity.test.ts
 */
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { test } from 'node:test';
import { FAKE_NPM_VIEW, type NpmCall, npmCalls, npmViewArgs, scriptEnv } from '../unit/fixtures.ts';
import { base, packedKitFile, read, siteCase } from './harness.ts';

const KIT = '@raess/astro-kit';
const KIT_KEY = `node_modules/${KIT}`;
const RULE_URL = 'https://github.com/raess-dev/astro-kit/blob/main/docs/standards.md#config-kit-identity';

/** The line that `fail` of 10.3 prints. */
const errorLine = (message: string): string => `::error::[config-kit-identity] ${message} (rule: ${RULE_URL})\n`;

/** The environment of git and the script: no config of the machine, and the base `main`. */
const ENV: NodeJS.ProcessEnv = {
  ...process.env,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'Kit Acceptance',
  GIT_AUTHOR_EMAIL: 'acceptance@example.ch',
  GIT_COMMITTER_NAME: 'Kit Acceptance',
  GIT_COMMITTER_EMAIL: 'acceptance@example.ch',
  BASE_REF: 'main',
};

const git = (dir: string, args: readonly string[]): void => {
  execFileSync('git', args, { cwd: dir, env: ENV, stdio: ['ignore', 'ignore', 'inherit'] });
};

interface Run {
  status: number | null;
  stdout: string;
  stderr: string;
  /** The calls of the fake npm that this run made. */
  npm: NpmCall[];
  /** What is left in the TMPDIR of the script. */
  tmp: string[];
}

/**
 * Runs the script of the case with bash, without the npm settings of the environment that the script refuses (10.3):
 * `npm run` sets `npm_config_ignore_scripts`. The npmrc settings of the machine, such as `NPM_CONFIG_USERCONFIG`,
 * stay: the script allows them. npm itself keeps every setting, so `npm install` below still reaches the registry.
 * The script gets the fake npm of `FAKE_NPM_VIEW` first on its path, answering `view` with `answer`, and a TMPDIR of
 * its own.
 */
function identity(dir: string, answer: string): Run {
  const tools = join(dir, '.git', 'test-tools');
  const bin = join(tools, 'bin');
  const tmp = join(tools, 'tmp');
  const log = join(tools, 'npm.log');
  mkdirSync(bin, { recursive: true });
  mkdirSync(tmp, { recursive: true });
  writeFileSync(join(bin, 'npm'), FAKE_NPM_VIEW);
  chmodSync(join(bin, 'npm'), 0o755);
  writeFileSync(log, '');
  const env = {
    ...scriptEnv(ENV),
    BASE_REF: 'main',
    PATH: [bin, process.env.PATH ?? ''].join(delimiter),
    TMPDIR: tmp,
    FAKE_NPM_LOG: log,
    FAKE_VIEW_ANSWER: answer,
  };
  const result = spawnSync('bash', ['.github/kit-identity.sh'], { cwd: dir, env, encoding: 'utf8' });
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    npm: npmCalls(readFileSync(log, 'utf8')),
    tmp: readdirSync(tmp),
  };
}

interface Lockfile {
  packages: Record<string, { version?: string; resolved?: string; integrity?: string; name?: string }>;
}

test('M9 identity: kit-identity.sh passes the complete lockfile of the test site with the packed kit', () => {
  const kitTemplate = join(base(), 'node_modules', KIT, 'templates/site/_github/kit-identity.sh');
  const dir = siteCase('identity');
  assert.equal(read(dir, '.github/kit-identity.sh'), readFileSync(kitTemplate, 'utf8'));
  assert.equal(read(dir, '.npmrc'), 'ignore-scripts=true\nsave-exact=true\n');
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', 'the test site']);
  git(dir, ['update-ref', 'refs/remotes/origin/main', 'HEAD']);
  // The hash that the registry would give for the packed kit: the sha512 of its tarball.
  const packed = `sha512-${createHash('sha512').update(readFileSync(packedKitFile())).digest('base64')}`;

  // The lockfile of the commit has no kit entry (14.2).
  const before = identity(dir, packed);
  assert.equal(before.status, 1, before.stderr);
  assert.equal(before.stdout, errorLine(`package-lock.json has no ${KIT_KEY} entry`));
  assert.deepEqual(before.npm, []);

  // npm writes the kit and its own package tree into the lockfile, and installs nothing.
  execFileSync(
    'npm',
    ['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund', packedKitFile()],
    { cwd: dir, env: ENV, stdio: ['ignore', 'ignore', 'inherit'], timeout: 600_000 },
  );
  assert.equal(existsSync(join(dir, 'node_modules')), false, 'npm installed nothing');
  const lock = JSON.parse(read(dir, 'package-lock.json')) as Lockfile;
  const kit = lock.packages[KIT_KEY];
  assert.ok(kit, 'npm wrote the kit entry');
  const version = JSON.parse(readFileSync(join(base(), 'node_modules', KIT, 'package.json'), 'utf8')).version as string;
  assert.equal(kit.version, version);
  assert.match(kit.integrity ?? '', /^sha512-/);
  assert.equal(kit.integrity, packed, 'npm wrote the hash of the packed tarball');
  // The kit brings packages that the site does not have: the lockfile now holds them too.
  for (const name of ['@astrojs/check', '@biomejs/biome', 'axe-core', 'html-validate', 'playwright-core']) {
    assert.ok(lock.packages[`node_modules/${name}`], name);
  }

  // A local tarball is no registry package, so the script names the kit entry.
  const local = identity(dir, packed);
  assert.equal(local.status, 1, local.stderr);
  assert.equal(
    local.stdout,
    errorLine(`these lockfile entries are not npm registry packages with an integrity hash: ${KIT_KEY}`),
  );
  assert.deepEqual(local.npm, []);

  // The form of a registry install, with the hash that npm wrote.
  kit.resolved = `https://registry.npmjs.org/${KIT}/-/astro-kit-${version}.tgz`;
  writeFileSync(join(dir, 'package-lock.json'), `${JSON.stringify(lock, null, 2)}\n`);
  const passed = identity(dir, packed);
  assert.equal(passed.status, 0, `${passed.stdout}${passed.stderr}`);
  assert.equal(passed.stdout.split('\n').at(-2), `${KIT} ${version} and every other package from the npm registry`);
  assert.equal(passed.stdout, `${KIT} ${version} and every other package from the npm registry\n`);
  // One npm view of the kit version, with the pinned flags and a fresh, empty cache that is gone after the run.
  assert.equal(passed.npm.length, 1);
  const [call] = passed.npm;
  assert.ok(call);
  assert.deepEqual(call.args, npmViewArgs(version, call.cache));
  assert.equal(call.state, 'empty');
  assert.deepEqual(passed.tmp, []);
});

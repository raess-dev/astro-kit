/**
 * The `identity` case of 14.2 (part 9d of M9): `kit-identity.sh` (10.3) on the complete lockfile of a kit project.
 *
 * 1. A copy of the test site becomes a git repository: one commit of every file, and `refs/remotes/origin/main` at
 *    it. Until the kit renders all seven protected files into `test/site/` (part 9e of M9), the case copies
 *    `.github/kit-identity.sh` from the template of the packed kit.
 * 2. On the lockfile of the commit, which has no kit, the script fails with `package-lock.json has no
 *    node_modules/@raess/astro-kit entry`.
 * 3. `npm install --package-lock-only` of the packed kit writes the kit entry and the kit's own package tree into the
 *    lockfile, and installs nothing. The kit entry is a local tarball, so the script fails and names it.
 * 4. With `resolved` of the kit entry in the form of a registry install, and the `sha512` hash that npm wrote, the
 *    script passes with status 0 and its last line: every entry of the lockfile is an npm registry package.
 * Run: node --test test/acceptance/identity.test.ts
 */
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { scriptEnv } from '../unit/fixtures.ts';
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

/**
 * Runs the script of the case with bash, without the npm settings of the environment that the script refuses (10.3):
 * `npm run` sets `npm_config_ignore_scripts`, and a machine behind a proxy sets `npm_config_https_proxy`. npm itself
 * keeps them, so `npm install` below still reaches the registry.
 */
function identity(dir: string): { status: number | null; stdout: string; stderr: string } {
  const env = { ...scriptEnv(ENV), BASE_REF: 'main' };
  const result = spawnSync('bash', ['.github/kit-identity.sh'], { cwd: dir, env, encoding: 'utf8' });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

interface Lockfile {
  packages: Record<string, { version?: string; resolved?: string; integrity?: string; name?: string }>;
}

test('M9 identity: kit-identity.sh passes the complete lockfile of the test site with the packed kit', () => {
  const kitTemplate = join(base(), 'node_modules', KIT, 'templates/site/_github/kit-identity.sh');
  const dir = siteCase('identity', (copy) => {
    mkdirSync(join(copy, '.github'), { recursive: true });
    copyFileSync(kitTemplate, join(copy, '.github/kit-identity.sh'));
  });
  assert.equal(read(dir, '.npmrc'), 'ignore-scripts=true\nsave-exact=true\n');
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', 'the test site']);
  git(dir, ['update-ref', 'refs/remotes/origin/main', 'HEAD']);

  // The lockfile of the commit has no kit entry (14.2).
  const before = identity(dir);
  assert.equal(before.status, 1, before.stderr);
  assert.equal(before.stdout, errorLine(`package-lock.json has no ${KIT_KEY} entry`));

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
  // The kit brings packages that the site does not have: the lockfile now holds them too.
  for (const name of ['@astrojs/check', '@biomejs/biome', 'axe-core', 'html-validate', 'playwright-core']) {
    assert.ok(lock.packages[`node_modules/${name}`], name);
  }

  // A local tarball is no registry package, so the script names the kit entry.
  const local = identity(dir);
  assert.equal(local.status, 1, local.stderr);
  assert.equal(
    local.stdout,
    errorLine(`these lockfile entries are not npm registry packages with an integrity hash: ${KIT_KEY}`),
  );

  // The form of a registry install, with the hash that npm wrote.
  kit.resolved = `https://registry.npmjs.org/${KIT}/-/astro-kit-${version}.tgz`;
  writeFileSync(join(dir, 'package-lock.json'), `${JSON.stringify(lock, null, 2)}\n`);
  const passed = identity(dir);
  assert.equal(passed.status, 0, `${passed.stdout}${passed.stderr}`);
  assert.equal(passed.stdout.split('\n').at(-2), `${KIT} ${version} and every other package from the npm registry`);
  assert.equal(passed.stdout, `${KIT} ${version} and every other package from the npm registry\n`);
});

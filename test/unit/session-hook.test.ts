/**
 * The SessionStart hook of `.claude/settings.json` (12.3, part 9d of M9). The template is the exact block of the
 * specification. Its one command runs under bash, and under `sh` as Claude Code may start it, in a temp folder with
 * a fake `npm` and a fake `node_modules` (14.1, M9: "the SessionStart hook with a fake npm"). The real
 * `kit-identity.sh` of the templates guards the install. No test installs a package.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { renderKitIdentity, renderNpmrc } from '../../src/shims.ts';
import { type Files, inTemp, json } from './fixtures.ts';
import { SPEC, specBlock } from './spec.ts';

const SETTINGS = readFileSync(
  fileURLToPath(new URL('../../templates/site/_claude/settings.json', import.meta.url)),
  'utf8',
);

interface Hook {
  type: string;
  command: string;
  timeout: number;
}

interface Settings {
  hooks: { SessionStart: { matcher: string; hooks: Hook[] }[] };
  permissions: { deny: string[] };
}

const VALUE = JSON.parse(SETTINGS) as Settings;

/** The one command of the hook. */
const COMMAND = VALUE.hooks.SessionStart[0]?.hooks[0]?.command ?? '';

/** The messages of 12.3, read from the specification. */
const step = (marker: string): string => {
  const start = SPEC.indexOf(marker);
  if (start < 0) throw new Error(`docs/spec.md does not hold the text ${JSON.stringify(marker)}`);
  return SPEC.slice(start + marker.length, SPEC.indexOf('`', start + marker.length));
};
const NO_LOCKFILE = step('2. Without `package-lock.json`: print `');
const IDENTITY_FAILED = step('When it fails, print `');

// The text

test('templates/site/_claude/settings.json is the exact block of 12.3', () => {
  assert.equal(SETTINGS, `${specBlock('The text of `.claude/settings.json` (exact):', 'json')}\n`);
});

test('the hook is SessionStart, matcher startup|resume, one command with timeout 300; permissions.deny of 12.3', () => {
  assert.deepEqual(Object.keys(VALUE), ['hooks', 'permissions']);
  assert.deepEqual(Object.keys(VALUE.hooks), ['SessionStart']);
  assert.equal(VALUE.hooks.SessionStart.length, 1);
  assert.equal(VALUE.hooks.SessionStart[0]?.matcher, 'startup|resume');
  assert.deepEqual(VALUE.hooks.SessionStart[0]?.hooks.length, 1);
  const hook = VALUE.hooks.SessionStart[0]?.hooks[0];
  assert.equal(hook?.type, 'command');
  assert.equal(hook?.timeout, 300);
  assert.deepEqual(VALUE.permissions, { deny: ['Edit(/node_modules/**)', 'Write(/node_modules/**)'] });
  assert.equal(NO_LOCKFILE, 'No package-lock.json yet: run npm install --ignore-scripts once.');
  assert.equal(IDENTITY_FAILED, 'kit-identity failed: nothing was installed. Do not run npm ci. Tell the owner.');
  assert.equal(COMMAND.includes(NO_LOCKFILE), true);
  assert.equal(COMMAND.includes(IDENTITY_FAILED), true);
  assert.equal(COMMAND.includes('\n'), false);
});

// The command with a fake npm

const KIT = '@raess/astro-kit';
const INDEX = 'node_modules/@raess/astro-kit/docs/INDEX.md';
const STAMP = 'node_modules/.kit-stamp';
const NPM_LOG = '.fake-npm.log';
/** A text of the lockfile that must never reach the session: the name of an entry from another host. */
const MARKER = 'lockfile-text-marker';

/** A lockfile entry of the npm registry. */
function entry(name: string, version: string): Record<string, unknown> {
  const base = name.replace(/^@[^/]+\//, '');
  return {
    version,
    resolved: `https://registry.npmjs.org/${name}/-/${base}-${version}.tgz`,
    integrity: `sha512-${Buffer.from(`${name}@${version}`).toString('base64')}`,
  };
}

/** A lockfile that passes `kit-identity.sh`, or one with an entry from another host. */
const lockfile = (good: boolean): string =>
  json({
    name: 'example-ch',
    lockfileVersion: 3,
    requires: true,
    packages: {
      '': { name: 'example-ch', dependencies: { [KIT]: '1.2.3' } },
      [`node_modules/${KIT}`]: entry(KIT, '1.2.3'),
      ...(good ? {} : { [`node_modules/${MARKER}`]: { version: '1.0.0', resolved: 'https://evil.example/x.tgz' } }),
    },
  });

/**
 * The fake `npm`: it records its arguments, prints a line that must not reach the session, and with `FAKE_NPM_EXIT`
 * other than 0 fails before it touches `node_modules`. Else it does what `npm ci` does to the folder: it removes
 * `node_modules` and writes the kit's `INDEX.md`.
 */
const FAKE_NPM = `#!/usr/bin/env bash
printf '%s\\n' "$*" >> ${NPM_LOG}
echo 'npm output for the terminal only'
[ "\${FAKE_NPM_EXIT:-0}" = 0 ] || exit "$FAKE_NPM_EXIT"
rm -rf node_modules
mkdir -p node_modules/@raess/astro-kit/docs
printf 'The installed INDEX.md\\n' > ${INDEX}
`;

const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');

interface HookRun {
  status: number | null;
  stdout: string;
  stderr: string;
  /** The arguments of each npm call. */
  npm: string[];
  stamp: string | undefined;
  index: string | undefined;
}

/** The shells that run the command: bash, as 12.3 says, and `sh`, which may be another shell. */
const SHELLS = ['bash', 'sh'] as const;

/**
 * Runs the command of the hook with a shell in a temp project with `files`, the template `kit-identity.sh` and
 * `.npmrc`, and a fake `npm` first on the path. `CLAUDE_PROJECT_DIR` names the project; the command starts in
 * another folder.
 */
function runHook(shell: string, files: Files, env: Record<string, string> = {}): HookRun {
  return inTemp(
    { '.github/kit-identity.sh': renderKitIdentity(), '.npmrc': renderNpmrc(), 'elsewhere/.keep': '', ...files },
    (root) => {
      const bin = join(root, '.fake-bin');
      mkdirSync(bin);
      writeFileSync(join(bin, 'npm'), FAKE_NPM);
      chmodSync(join(bin, 'npm'), 0o755);
      const result = spawnSync(shell, ['-c', COMMAND], {
        cwd: join(root, 'elsewhere'),
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: [bin, process.env.PATH ?? ''].join(delimiter),
          CLAUDE_PROJECT_DIR: root,
          GIT_CONFIG_NOSYSTEM: '1',
          GIT_CONFIG_GLOBAL: '/dev/null',
          GIT_CEILING_DIRECTORIES: root,
          ...env,
        },
      });
      const text = (path: string): string | undefined =>
        existsSync(join(root, path)) ? readFileSync(join(root, path), 'utf8') : undefined;
      return {
        status: result.status,
        stdout: result.stdout,
        stderr: result.stderr,
        npm: (text(NPM_LOG) ?? '').split('\n').filter((line) => line !== ''),
        stamp: text(STAMP),
        index: text(INDEX),
      };
    },
  );
}

for (const shell of SHELLS) {
  test(`${shell}: without package-lock.json the hook prints the line of step 2, installs nothing and exits 0`, () => {
    const result = runHook(shell, {});
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, `${NO_LOCKFILE}\n`);
    assert.deepEqual(result.npm, []);
  });

  test(`${shell}: when kit-identity fails, nothing is installed, the fixed text, exit 0, no lockfile text`, () => {
    const result = runHook(shell, { 'package-lock.json': lockfile(false) });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, `${IDENTITY_FAILED}\n`);
    assert.deepEqual(result.npm, []);
    assert.equal(result.index, undefined);
    // The script names the entry, on stderr only: the text of the lockfile never reaches the session.
    assert.equal(result.stdout.includes(MARKER), false);
    assert.equal(result.stderr.includes(`node_modules/${MARKER}`), true);
    assert.equal(result.stderr.includes('::error::[config-kit-identity]'), true);
  });

  test(`${shell}: when kit-identity.sh is missing, nothing is installed and the fixed text comes`, () => {
    const result = runHook(shell, { 'package-lock.json': lockfile(true), '.github/kit-identity.sh': 'exit 3\n' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, `${IDENTITY_FAILED}\n`);
    assert.deepEqual(result.npm, []);
  });

  test(`${shell}: with the stamp of the lockfile, no npm ci runs, and INDEX.md is printed`, () => {
    const lock = lockfile(true);
    const result = runHook(shell, {
      'package-lock.json': lock,
      [STAMP]: `${sha256(lock)}\n`,
      [INDEX]: 'The INDEX.md that is there\n',
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, 'The INDEX.md that is there\n');
    assert.deepEqual(result.npm, []);
    assert.equal(result.stamp, `${sha256(lock)}\n`);
    // The last line of kit-identity.sh goes to stderr.
    assert.equal(result.stderr.includes(`${KIT} 1.2.3 and every other package from the npm registry`), true);
  });

  test(`${shell}: with another stamp, npm ci runs, the stamp is written and INDEX.md is printed`, () => {
    const lock = lockfile(true);
    const result = runHook(shell, {
      'package-lock.json': lock,
      [STAMP]: `${sha256('an older lockfile')}\n`,
      [INDEX]: 'The old INDEX.md\n',
    });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(result.npm, ['ci --ignore-scripts --no-audit --no-fund']);
    assert.equal(result.stamp, `${sha256(lock)}\n`);
    assert.equal(result.stdout, 'The installed INDEX.md\n');
    assert.equal(result.stderr.includes('npm output for the terminal only'), true);
  });

  test(`${shell}: without node_modules, npm ci runs and the stamp is written`, () => {
    const lock = lockfile(true);
    const result = runHook(shell, { 'package-lock.json': lock });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(result.npm, ['ci --ignore-scripts --no-audit --no-fund']);
    assert.equal(result.stamp, `${sha256(lock)}\n`);
    assert.equal(result.stdout, 'The installed INDEX.md\n');
  });

  test(`${shell}: when npm ci fails, the hook exits 1, writes no stamp and prints nothing`, () => {
    const result = runHook(shell, { 'package-lock.json': lockfile(true) }, { FAKE_NPM_EXIT: '7' });
    assert.equal(result.status, 1);
    assert.deepEqual(result.npm, ['ci --ignore-scripts --no-audit --no-fund']);
    assert.equal(result.stamp, undefined);
    assert.equal(result.stdout, '');
  });

  test(`${shell}: a project folder that does not exist ends the hook with 0 and installs nothing`, () => {
    const result = runHook(shell, { 'package-lock.json': lockfile(true) }, { CLAUDE_PROJECT_DIR: '/nonexistent/kit' });
    assert.equal(result.status, 0);
    assert.equal(result.stdout, '');
    assert.deepEqual(result.npm, []);
  });
}

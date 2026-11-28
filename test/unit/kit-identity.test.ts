/**
 * `.github/kit-identity.sh` (10.3) and the rule `config-kit-identity` (part 9d of M9). The template is the exact
 * block of the specification. The script runs under bash in a scratch git repository with
 * `refs/remotes/origin/main` (14.1, ci rules): it passes a lockfile of npm registry packages, and each failure
 * prints its exact `::error::` line. No test installs a package.
 */
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { getRule, Report } from '../../src/registry.ts';
import {
  COMPARED_PROTECTED,
  checkProtectedFiles,
  DEPENDABOT_FILE,
  KIT_IDENTITY_FILE,
  NPMRC_FILE,
  RENDERED_PROTECTED,
  renderKitIdentity,
  renderNpmrc,
  renderProtected,
  SITE_MERGE_FILE,
  SITE_WORKFLOW_FILE,
} from '../../src/shims.ts';
import {
  FAKE_NPM_VIEW,
  type Files,
  inTemp,
  json,
  MACHINE_NPM_SETTINGS,
  type NpmCall,
  npmCalls,
  npmViewArgs,
  REFUSED_NPM_SETTINGS,
  scriptEnv,
  withoutNpmConfig,
} from './fixtures.ts';
import { SPEC, specBlock } from './spec.ts';

const TEMPLATE = fileURLToPath(new URL('../../templates/site/_github/kit-identity.sh', import.meta.url));
const RULE = 'config-kit-identity';
const KIT = '@raess/astro-kit';
const KIT_KEY = `node_modules/${KIT}`;
/** The address of the standard that each `::error::` line names: its row on the default branch of the kit. */
const RULE_URL = `https://github.com/raess-dev/astro-kit/blob/main/docs/standards.md#${RULE}`;

// The texts

test('templates/site/_github/kit-identity.sh is the exact block of 10.3, and renderKitIdentity gives it', () => {
  const block = `${specBlock('### 10.3 kit-identity.sh (exact)', 'bash')}\n`;
  assert.equal(readFileSync(TEMPLATE, 'utf8'), block);
  assert.equal(renderKitIdentity(), block);
  assert.equal(block.startsWith('#!/usr/bin/env bash\n# Managed by @raess/astro-kit.'), true);
});

test('templates/site/_npmrc is the .npmrc of 12.2, and renderNpmrc gives it', () => {
  assert.equal(SPEC.includes('`.npmrc` (`ignore-scripts=true\\nsave-exact=true\\n`)'), true);
  const npmrc = 'ignore-scripts=true\nsave-exact=true\n';
  assert.equal(renderNpmrc(), npmrc);
  assert.equal(readFileSync(fileURLToPath(new URL('../../templates/site/_npmrc', import.meta.url)), 'utf8'), npmrc);
  // From part 9e of M9 the five protected files that depend on no setting (10.6); CODEOWNERS names the owner.
  assert.deepEqual(Object.keys(RENDERED_PROTECTED), [
    SITE_WORKFLOW_FILE,
    SITE_MERGE_FILE,
    DEPENDABOT_FILE,
    KIT_IDENTITY_FILE,
    NPMRC_FILE,
  ]);
});

test('config-kit-identity is a ci rule of the config group, and the script links its row of standards.md', () => {
  const rule = getRule(RULE);
  assert.equal(rule.group, 'config');
  assert.equal(rule.stage, 'ci');
  assert.equal(rule.level, 'error');
  assert.equal(rule.waivable, false);
  assert.equal(renderKitIdentity().includes(`(rule: ${RULE_URL})`), true);
});

test('the standard of config-kit-identity names the refused settings, the trusted machine and the flags of npm ci', () => {
  const { standard } = getRule(RULE);
  const refused =
    'sets the registry, `strict-ssl`, `ignore-scripts` or `replace-registry-host` (a proxy and the `npmrc` files of the machine are allowed)';
  assert.equal(standard.includes(refused), true);
  assert.equal(standard.includes('userconfig'), false);
  assert.equal(
    standard.includes(
      '`npm ci --registry=https://registry.npmjs.org/ --replace-registry-host=never --strict-ssl=true`',
    ),
    true,
  );
});

// The protected files part of `config-shim`

/** The code owner of the cases. */
const OWNER = { codeOwner: '@example-owner' };

/**
 * The six rendered protected files for `OWNER`, without a file whose path is also a folder of one of `files`. From
 * part 9e of M9 every one is required, so each case starts from all of them.
 */
const renderedBut = (files: Files): Files =>
  Object.fromEntries(
    Object.entries(renderProtected(OWNER)).filter(
      ([path]) => !Object.keys(files).some((own) => own.startsWith(`${path}/`)),
    ),
  );

/** The findings of the protected files part of `config-shim` in a root, as `<where>: <detail>`. */
function protectedFindings(files: Files, options: { codeOwner: string } | undefined = OWNER): string[] {
  return inTemp({ ...renderedBut(files), ...files }, (root) => {
    const report = new Report();
    checkProtectedFiles(root, options, report);
    return report.findings.map((finding) => `${finding.rule} ${finding.where}: ${finding.detail}`);
  });
}

test('config-shim passes the rendered protected files, and fails each one that is missing', () => {
  assert.deepEqual(protectedFindings({ [KIT_IDENTITY_FILE]: renderKitIdentity(), [NPMRC_FILE]: renderNpmrc() }), []);
  // From part 9e of M9 every rendered protected file is required (10.6).
  const missing = inTemp({}, (root) => {
    const report = new Report();
    checkProtectedFiles(root, OWNER, report);
    return report.findings.map((finding) => `${finding.where}: ${finding.detail}`);
  });
  assert.deepEqual(
    missing,
    COMPARED_PROTECTED.map((file) => `${file}: the file is missing`),
  );
});

test('config-shim fails a kit-identity.sh or an .npmrc that differs from the rendering, at the first line', () => {
  const script = renderKitIdentity().replace('set -euo pipefail\n', 'set -eu\n');
  assert.deepEqual(protectedFindings({ [KIT_IDENTITY_FILE]: script }), [
    "config-shim .github/kit-identity.sh:4: the kit's rendering has `set -euo pipefail` here",
  ]);
  assert.deepEqual(protectedFindings({ [NPMRC_FILE]: 'save-exact=true\n' }), [
    "config-shim .npmrc:1: the kit's rendering has `ignore-scripts=true` here",
  ]);
  assert.deepEqual(protectedFindings({ [NPMRC_FILE]: `${renderNpmrc()}ignore-scripts=false\n` }), [
    "config-shim .npmrc:3: the kit's rendering ends before this line",
  ]);
  assert.deepEqual(protectedFindings({ [`${NPMRC_FILE}/x`]: '' }), ['config-shim .npmrc: this is not a file']);
  // A file that does not match gets the hint of the protected task (10.6).
  assert.equal(getRule('config-shim').hint.includes('the owner starts the protected task for this branch'), true);
});

// The script in a scratch git repository

/** A lockfile entry of the npm registry: the tarball of its own name and version, with a sha512 hash. */
function entry(name: string, version: string): Record<string, unknown> {
  const base = name.replace(/^@[^/]+\//, '');
  return {
    version,
    resolved: `https://registry.npmjs.org/${name}/-/${base}-${version}.tgz`,
    integrity: `sha512-${Buffer.from(`${name}@${version}`).toString('base64')}`,
  };
}

/** A lockfile of a site with the kit at `kit`, astro, a nested scoped package and `extra` entries. */
function lockfile(kit: string | undefined, extra: Record<string, unknown> = {}): string {
  return json({
    name: 'example-ch',
    lockfileVersion: 3,
    requires: true,
    packages: {
      '': { name: 'example-ch', dependencies: { [KIT]: kit ?? '0.0.0', astro: '7.4.13' } },
      ...(kit === undefined ? {} : { [KIT_KEY]: entry(KIT, kit) }),
      'node_modules/astro': entry('astro', '7.4.13'),
      'node_modules/astro/node_modules/@scope/dep': entry('@scope/dep', '1.0.0-beta.2'),
      // A bundled package is not downloaded, so it needs no check.
      'node_modules/astro/node_modules/bundled': { version: '1.0.0', inBundle: true },
      ...extra,
    },
  });
}

const NPMRC = 'ignore-scripts=true\nsave-exact=true\n';

/** The message of a `.npmrc` that is not the text of 12.2 byte for byte. */
const NPMRC_MESSAGE = '.npmrc must be exactly the two lines ignore-scripts=true and save-exact=true';

/** The message of a kit version that is not `X.Y.Z`. */
const NOT_PLAIN = 'the kit version must be a plain version X.Y.Z, without a prerelease or build part';

/**
 * The environment of git and the script: no config of the machine, no `BASE_REF` and no `GITHUB_ACTIONS` of the
 * caller, and none of the npm settings that the script refuses (`npm test` sets some of them).
 */
function cleanEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = scriptEnv({
    ...process.env,
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'Test',
    GIT_AUTHOR_EMAIL: 'test@example.ch',
    GIT_COMMITTER_NAME: 'Test',
    GIT_COMMITTER_EMAIL: 'test@example.ch',
  });
  delete env.BASE_REF;
  return { ...env, ...extra };
}

const git = (root: string, args: readonly string[]): string =>
  execFileSync('git', args, { cwd: root, env: cleanEnv(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

/** Commits the files as they are and points `refs/remotes/origin/<branch>` at the commit. */
function commitAs(root: string, branch: string, files: Files): void {
  for (const [path, text] of Object.entries(files)) writeFileSync(join(root, path), text);
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '--allow-empty', '-m', `${branch}`]);
  git(root, ['update-ref', `refs/remotes/origin/${branch}`, 'HEAD']);
}

interface Scratch {
  /** The lockfile of each base branch, committed in this order. A branch without a lockfile commits none. */
  bases?: readonly (readonly [string, string | undefined])[];
  /** The files of the working tree. */
  files: Files;
  env?: Record<string, string>;
}

interface ScriptRun {
  status: number | null;
  stdout: string;
  stderr: string;
  /** The calls of the fake npm. */
  npm: NpmCall[];
  /** What is left in the TMPDIR of the script after it ran. */
  tmp: string[];
}

/**
 * Runs the template with bash in a scratch git repository and gives its status and its output. A fake npm
 * (`FAKE_NPM_VIEW`) is first on the path, so the `npm view` of the script reads no registry: by default it answers
 * the hash of the kit entry. The script's TMPDIR is a folder of its own, so the test sees what it leaves there.
 */
function runScript(scratch: Scratch): ScriptRun {
  return inTemp({}, (root) => {
    const tools = join(root, '.git', 'test-tools');
    const bin = join(tools, 'bin');
    const tmp = join(tools, 'tmp');
    mkdirSync(bin, { recursive: true });
    mkdirSync(tmp);
    writeFileSync(join(bin, 'npm'), FAKE_NPM_VIEW);
    chmodSync(join(bin, 'npm'), 0o755);
    const log = join(tools, 'npm.log');
    writeFileSync(log, '');
    git(root, ['init', '-q', '-b', 'work']);
    for (const [branch, lock] of scratch.bases ?? [['main', lockfile('1.2.3')]]) {
      rmSync(join(root, 'package-lock.json'), { force: true });
      commitAs(root, branch, lock === undefined ? { '.npmrc': NPMRC } : { '.npmrc': NPMRC, 'package-lock.json': lock });
    }
    for (const path of ['package-lock.json', '.npmrc']) rmSync(join(root, path), { force: true });
    for (const [path, text] of Object.entries(scratch.files)) writeFileSync(join(root, path), text);
    const env = {
      ...cleanEnv(),
      PATH: [bin, process.env.PATH ?? ''].join(delimiter),
      TMPDIR: tmp,
      FAKE_NPM_LOG: log,
      ...scratch.env,
    };
    const result = spawnSync('bash', [TEMPLATE], { cwd: root, env, encoding: 'utf8' });
    return {
      status: result.status,
      stdout: result.stdout,
      stderr: result.stderr,
      npm: npmCalls(readFileSync(log, 'utf8')),
      tmp: readdirSync(tmp),
    };
  });
}

/** The line that `fail` of 10.3 prints. */
const errorLine = (message: string): string => `::error::[${RULE}] ${message} (rule: ${RULE_URL})\n`;

/** The message of the lockfile check for these entries. */
const badEntries = (keys: string): string =>
  `these lockfile entries are not npm registry packages with an integrity hash: ${keys}`;

test('kit-identity passes a lockfile of npm registry packages and prints its last line', () => {
  const result = runScript({ files: { '.npmrc': NPMRC, 'package-lock.json': lockfile('1.2.4') } });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, `${KIT} 1.2.4 and every other package from the npm registry\n`);
  // The same version as on the base passes too, and so does a base without a lockfile.
  const same = runScript({ files: { '.npmrc': NPMRC, 'package-lock.json': lockfile('1.2.3') } });
  assert.equal(same.status, 0, same.stderr);
  const none = runScript({
    bases: [['main', undefined]],
    files: { '.npmrc': NPMRC, 'package-lock.json': lockfile('0.1.0') },
  });
  assert.equal(none.status, 0, none.stderr);
});

const FAILING: readonly { name: string; scratch: Scratch; message: string }[] = [
  {
    name: 'an entry from another host',
    scratch: {
      files: {
        '.npmrc': NPMRC,
        'package-lock.json': lockfile('1.2.3', {
          'node_modules/left-pad': {
            ...entry('left-pad', '1.3.0'),
            resolved: 'https://evil.example/left-pad-1.3.0.tgz',
          },
        }),
      },
    },
    message: badEntries('node_modules/left-pad'),
  },
  {
    name: 'an entry whose tarball is not its own name',
    scratch: {
      files: {
        '.npmrc': NPMRC,
        'package-lock.json': lockfile('1.2.3', {
          'node_modules/left-pad': { ...entry('left-pad', '1.3.0'), resolved: entry('evil-pad', '1.3.0').resolved },
        }),
      },
    },
    message: badEntries('node_modules/left-pad'),
  },
  {
    name: 'an entry whose tarball is not its own version',
    scratch: {
      files: {
        '.npmrc': NPMRC,
        'package-lock.json': lockfile('1.2.3', {
          'node_modules/@scope/pad': {
            ...entry('@scope/pad', '1.3.0'),
            resolved: entry('@scope/pad', '6.6.6').resolved,
          },
        }),
      },
    },
    message: badEntries('node_modules/@scope/pad'),
  },
  {
    name: 'an alias entry (it has name)',
    scratch: {
      files: {
        '.npmrc': NPMRC,
        'package-lock.json': lockfile('1.2.3', {
          'node_modules/left-pad': { ...entry('left-pad', '1.3.0'), name: 'evil-pad' },
        }),
      },
    },
    message: badEntries('node_modules/left-pad'),
  },
  {
    name: 'a linked entry',
    scratch: {
      files: {
        '.npmrc': NPMRC,
        'package-lock.json': lockfile('1.2.3', {
          'node_modules/left-pad': { resolved: 'vendor/left-pad', link: true },
          'vendor/left-pad': { version: '1.3.0' },
        }),
      },
    },
    message: badEntries('node_modules/left-pad, vendor/left-pad'),
  },
  {
    name: 'an entry without integrity',
    scratch: {
      files: {
        '.npmrc': NPMRC,
        'package-lock.json': lockfile('1.2.3', {
          'node_modules/left-pad': { ...entry('left-pad', '1.3.0'), integrity: undefined },
        }),
      },
    },
    message: badEntries('node_modules/left-pad'),
  },
  {
    name: 'a kit entry with a sha1 hash',
    scratch: {
      files: {
        '.npmrc': NPMRC,
        'package-lock.json': lockfile('1.2.3', { [KIT_KEY]: { ...entry(KIT, '1.2.3'), integrity: 'sha1-AAAA' } }),
      },
    },
    message: 'the kit entry must be the kit itself, with a sha512 integrity hash',
  },
  {
    name: 'no kit entry',
    scratch: { files: { '.npmrc': NPMRC, 'package-lock.json': lockfile(undefined) } },
    message: `package-lock.json has no ${KIT_KEY} entry`,
  },
  {
    name: 'npm-shrinkwrap.json',
    scratch: {
      files: { '.npmrc': NPMRC, 'package-lock.json': lockfile('1.2.3'), 'npm-shrinkwrap.json': lockfile('1.2.3') },
    },
    message: 'remove npm-shrinkwrap.json; package-lock.json is the only lockfile',
  },
  {
    name: '.npmrc without ignore-scripts=true',
    scratch: { files: { '.npmrc': 'save-exact=true\n', 'package-lock.json': lockfile('1.2.3') } },
    message: NPMRC_MESSAGE,
  },
  {
    name: '.npmrc with the line only as a part of another line',
    scratch: { files: { '.npmrc': '# ignore-scripts=true\n', 'package-lock.json': lockfile('1.2.3') } },
    message: NPMRC_MESSAGE,
  },
  {
    name: 'no .npmrc',
    scratch: { files: { 'package-lock.json': lockfile('1.2.3') } },
    message: NPMRC_MESSAGE,
  },
  {
    name: 'a kit version that is not plain',
    scratch: { files: { '.npmrc': NPMRC, 'package-lock.json': lockfile('1.2.3+evil') } },
    message: NOT_PLAIN,
  },
  {
    // `sort -V`: 1.10.0 is higher than 1.9.0, which a text sort would turn round.
    name: 'a kit version lower than on origin/main (sort -V)',
    scratch: {
      bases: [['main', lockfile('1.10.0')]],
      files: { '.npmrc': NPMRC, 'package-lock.json': lockfile('1.9.0') },
    },
    message: 'the kit went down from 1.10.0 on origin/main to 1.9.0',
  },
  {
    name: 'a kit version lower than on origin/build with BASE_REF=build',
    scratch: {
      bases: [
        ['main', lockfile('1.0.0')],
        ['build', lockfile('2.0.0')],
      ],
      files: { '.npmrc': NPMRC, 'package-lock.json': lockfile('1.5.0') },
      env: { BASE_REF: 'build' },
    },
    message: 'the kit went down from 2.0.0 on origin/build to 1.5.0',
  },
];

for (const c of FAILING) {
  test(`kit-identity fails ${c.name} with its exact ::error:: line and status 1`, () => {
    const result = runScript(c.scratch);
    assert.equal(result.status, 1, result.stderr);
    assert.equal(result.stdout, errorLine(c.message));
  });
}

test('kit-identity reads the base of BASE_REF: without it, origin/main', () => {
  const bases = [
    ['main', lockfile('1.0.0')],
    ['build', lockfile('2.0.0')],
  ] as const;
  const files = { '.npmrc': NPMRC, 'package-lock.json': lockfile('1.5.0') };
  const main = runScript({ bases, files });
  assert.equal(main.status, 0, main.stderr);
  assert.equal(main.stdout, `${KIT} 1.5.0 and every other package from the npm registry\n`);
  const named = runScript({ bases, files, env: { BASE_REF: 'main' } });
  assert.equal(named.status, 0, named.stderr);
  // 1.9.0 on main and 1.10.0 here: up, also by `sort -V`.
  const up = runScript({
    bases: [['main', lockfile('1.9.0')]],
    files: { '.npmrc': NPMRC, 'package-lock.json': lockfile('1.10.0') },
  });
  assert.equal(up.status, 0, up.stderr);
});

test('kit-identity names at most five bad entries', () => {
  const extra = Object.fromEntries(
    ['a', 'b', 'c', 'd', 'e', 'f'].map((name) => [
      `node_modules/${name}`,
      { version: '1.0.0', resolved: 'git+ssh://x' },
    ]),
  );
  const result = runScript({ files: { '.npmrc': NPMRC, 'package-lock.json': lockfile('1.2.3', extra) } });
  assert.equal(result.status, 1);
  assert.equal(
    result.stdout,
    errorLine(badEntries('node_modules/a, node_modules/b, node_modules/c, node_modules/d, node_modules/e')),
  );
});

// The hardening after the reviews of part 9d

/** Runs the script on `lock` with the good `.npmrc` and the base of `runScript`. */
const runLock = (lock: string, env: Record<string, string> = {}) =>
  runScript({ files: { '.npmrc': NPMRC, 'package-lock.json': lock }, env });

/** An entry with `inBundle` set to `value` and a tarball of another host. */
const bundled = (name: string, value: unknown): Record<string, unknown> => ({
  ...entry(name, '1.0.0'),
  resolved: 'http://127.0.0.1:8765/x.tgz',
  inBundle: value,
});

test('kit-identity checks an entry with inBundle true, 0, "" or "true" at the top level as a registry entry', () => {
  for (const value of [true, 0, '', 'true']) {
    const result = runLock(lockfile('1.2.3', { 'node_modules/left-pad': bundled('left-pad', value) }));
    assert.equal(result.status, 1, JSON.stringify(value));
    assert.equal(result.stdout, errorLine(badEntries('node_modules/left-pad')), JSON.stringify(value));
  }
});

test('kit-identity checks a nested entry with inBundle true and a resolved URL as a registry entry', () => {
  const key = 'node_modules/astro/node_modules/left-pad';
  const result = runLock(lockfile('1.2.3', { [key]: bundled('left-pad', true) }));
  assert.equal(result.status, 1);
  assert.equal(result.stdout, errorLine(badEntries(key)));
  // A nested entry with inBundle true and an integrity hash but no resolved URL is checked too.
  const hashed = runLock(lockfile('1.2.3', { [key]: { version: '1.0.0', inBundle: true, integrity: 'sha512-AA' } }));
  assert.equal(hashed.stdout, errorLine(badEntries(key)));
});

test('kit-identity skips a nested entry with inBundle true and no resolved and no integrity, at any depth', () => {
  const result = runLock(
    lockfile('1.2.3', {
      'node_modules/astro/node_modules/a/node_modules/@scope/b': { version: '2.0.0', inBundle: true },
    }),
  );
  assert.equal(result.status, 0, result.stdout);
  assert.equal(result.stdout, `${KIT} 1.2.3 and every other package from the npm registry\n`);
});

test('kit-identity checks the kit entry with inBundle true, at the top level and nested', () => {
  const top = runLock(lockfile('1.2.3', { [KIT_KEY]: bundled(KIT, true) }));
  assert.equal(top.status, 1);
  assert.equal(top.stdout, errorLine(badEntries(KIT_KEY)));
  const nestedKey = `node_modules/is-number/node_modules/${KIT}`;
  const nested = runLock(lockfile('1.2.3', { [nestedKey]: bundled(KIT, true) }));
  assert.equal(nested.status, 1);
  assert.equal(nested.stdout, errorLine(badEntries(nestedKey)));
});

test('kit-identity fails a linked entry that passes every other check', () => {
  const result = runLock(lockfile('1.2.3', { 'node_modules/left-pad': { ...entry('left-pad', '1.3.0'), link: true } }));
  assert.equal(result.status, 1);
  assert.equal(result.stdout, errorLine(badEntries('node_modules/left-pad')));
});

test('kit-identity fails an .npmrc that is not the text of 12.2 byte for byte', () => {
  for (const npmrc of [
    'ignore-scripts=true\r\nsave-exact=true\r\n',
    'ignore-scripts=true\nsave-exact=true',
    `${NPMRC}\n`,
    `${NPMRC}registry=http://127.0.0.1:8765/\n`,
    `${NPMRC}ignore-scripts=false\n`,
    `${NPMRC}proxy=http://127.0.0.1:8765/\nstrict-ssl=false\n`,
    `﻿${NPMRC}`,
    `${NPMRC}\0`,
  ]) {
    const result = runScript({ files: { '.npmrc': npmrc, 'package-lock.json': lockfile('1.2.3') } });
    assert.equal(result.status, 1, JSON.stringify(npmrc));
    assert.equal(result.stdout, errorLine(NPMRC_MESSAGE), JSON.stringify(npmrc));
  }
});

/** Every form of the refused settings that npm 10 reads: any letter case, `_` or `-` between the words. */
const ENV_FORMS: readonly (readonly [string, string])[] = [
  ['npm_config_registry', 'registry'],
  ['NPM_CONFIG_REGISTRY', 'registry'],
  ['Npm_Config_Registry', 'registry'],
  ['npm_config_strict_ssl', 'strict-ssl'],
  ['npm_config_strict-ssl', 'strict-ssl'],
  ['NPM_CONFIG_STRICT_SSL', 'strict-ssl'],
  ['npm_config_ignore_scripts', 'ignore-scripts'],
  ['npm_config_ignore-scripts', 'ignore-scripts'],
  ['NPM_CONFIG_IGNORE_SCRIPTS', 'ignore-scripts'],
  ['npm_config_replace_registry_host', 'replace-registry-host'],
  ['npm_config_replace-registry-host', 'replace-registry-host'],
  ['NPM_CONFIG_REPLACE_REGISTRY_HOST', 'replace-registry-host'],
];

/**
 * Every form of the npmrc settings of the machine that npm 10 reads. The script allows them: the machine belongs to
 * whoever runs it, and the flags of the install win over every npmrc (10.3).
 */
const MACHINE_FORMS: readonly (readonly [string, string])[] = [
  ['npm_config_userconfig', 'userconfig'],
  ['NPM_CONFIG_USERCONFIG', 'userconfig'],
  ['Npm_Config_UserConfig', 'userconfig'],
  ['npm_config_globalconfig', 'globalconfig'],
  ['NPM_CONFIG_GLOBALCONFIG', 'globalconfig'],
  ['Npm_Config_GlobalConfig', 'globalconfig'],
];

/**
 * The proxy settings of npm in the forms that npm reads, and the plain proxy variables: the script allows them all,
 * because a proxy only tunnels TLS and `strict-ssl` stays on (10.3).
 */
const PROXY_FORMS: readonly string[] = [
  'npm_config_proxy',
  'NPM_CONFIG_PROXY',
  'npm_config_https_proxy',
  'npm_config_https-proxy',
  'NPM_CONFIG_HTTPS_PROXY',
  'NPM_CONFIG_HTTPS-PROXY',
  'HTTPS_PROXY',
  'https_proxy',
  'HTTP_PROXY',
  'http_proxy',
];

test('kit-identity fails each refused npm setting of the environment, in every form that npm reads', () => {
  assert.deepEqual([...new Set(ENV_FORMS.map(([, setting]) => setting))], REFUSED_NPM_SETTINGS);
  for (const [name, setting] of ENV_FORMS) {
    const result = runLock(lockfile('1.2.3'), { [name]: 'x' });
    assert.equal(result.status, 1, name);
    assert.equal(
      result.stdout,
      errorLine(`unset the npm_config_ variables of the environment that set ${setting}`),
      name,
    );
  }
  const two = runLock(lockfile('1.2.3'), { NPM_CONFIG_REGISTRY: 'x', npm_config_strict_ssl: 'false' });
  assert.equal(
    two.stdout,
    errorLine('unset the npm_config_ variables of the environment that set registry, strict-ssl'),
  );
  // An empty value is no setting for npm, and another npm setting is no finding.
  const empty = runLock(lockfile('1.2.3'), { npm_config_registry: '', npm_config_cache: '/tmp/npm-cache' });
  assert.equal(empty.status, 0, empty.stdout);
});

test('npm 10 reads each form of ENV_FORMS as the setting that kit-identity refuses', () => {
  inTemp({ 'home/.keep': '' }, (root) => {
    for (const [name, setting] of ENV_FORMS) {
      const value = setting === 'strict-ssl' || setting === 'ignore-scripts' ? 'false' : 'http://127.0.0.1:1/';
      // No npm_config_ variable of the caller, and no npmrc of the machine: the empty HOME has no ~/.npmrc.
      const env = { ...withoutNpmConfig(process.env), HOME: join(root, 'home'), NPM_CONFIG_USERCONFIG: '/dev/null' };
      const got = execFileSync('npm', ['config', 'get', setting], {
        cwd: root,
        env: { ...env, [name]: value },
        encoding: 'utf8',
      }).trim();
      assert.equal(got, value, name);
    }
  });
});

test('kit-identity passes the npmrc settings of the machine, in every form that npm reads', () => {
  assert.deepEqual([...new Set(MACHINE_FORMS.map(([, setting]) => setting))], MACHINE_NPM_SETTINGS);
  for (const [name] of MACHINE_FORMS) {
    const result = runLock(lockfile('1.2.3'), { [name]: '/root/.npmrc' });
    assert.equal(result.status, 0, `${name}: ${result.stdout}`);
    assert.equal(result.stdout, `${KIT} 1.2.3 and every other package from the npm registry\n`, name);
  }
  // A cloud machine sets NPM_CONFIG_USERCONFIG to a file that need not exist, and npm run sets both: all pass.
  const all = Object.fromEntries(MACHINE_FORMS.map(([name]) => [name, '/root/.npmrc']));
  assert.equal(runLock(lockfile('1.2.3'), all).status, 0);
});

test('npm 10 reads each form of MACHINE_FORMS as an npmrc of the machine', () => {
  // npm keeps `userconfig` and `globalconfig` from `npm config get`, so the test reads a setting of the npmrc that
  // the variable names: `strict-ssl=false`, which the default `true` of npm is not.
  inTemp({ 'home/.keep': '', 'other.npmrc': 'strict-ssl=false\n' }, (root) => {
    for (const [name, setting] of MACHINE_FORMS) {
      // A userconfig form takes the place of NPM_CONFIG_USERCONFIG, and the empty HOME has no ~/.npmrc.
      const user = setting === 'userconfig' ? {} : { NPM_CONFIG_USERCONFIG: '/dev/null' };
      const env = { ...withoutNpmConfig(process.env), HOME: join(root, 'home'), ...user };
      const got = execFileSync('npm', ['config', 'get', 'strict-ssl'], {
        cwd: root,
        env: { ...env, [name]: join(root, 'other.npmrc') },
        encoding: 'utf8',
      }).trim();
      assert.equal(got, 'false', name);
    }
  });
});

test('kit-identity passes the npm proxy settings and the plain proxy variables of the environment', () => {
  for (const name of PROXY_FORMS) {
    const result = runLock(lockfile('1.2.3'), { [name]: 'http://127.0.0.1:8765/' });
    assert.equal(result.status, 0, `${name}: ${result.stdout}`);
    assert.equal(result.stdout, `${KIT} 1.2.3 and every other package from the npm registry\n`, name);
  }
  // With every proxy form at once, and a refused setting beside them: only the refused one is named.
  const all = Object.fromEntries(PROXY_FORMS.map((name) => [name, 'http://127.0.0.1:8765/']));
  const both = runLock(lockfile('1.2.3'), { ...all, NPM_CONFIG_REGISTRY: 'http://127.0.0.1:8765/' });
  assert.equal(both.status, 1);
  assert.equal(both.stdout, errorLine('unset the npm_config_ variables of the environment that set registry'));
});

test('kit-identity fails a BASE_REF that is not a plain branch name with a fixed line, and keeps its text out', () => {
  const files = { '.npmrc': NPMRC, 'package-lock.json': lockfile('1.2.3') };
  const message = errorLine(
    'BASE_REF must be a plain branch name: letters, digits and . _ / -, without .. and not starting with -',
  );
  for (const ref of [
    'main..evil',
    '..',
    '-main',
    '--output=x',
    'main\n::error file=a.ts::forged',
    'main::warning::x',
    'a b',
    '$(id)',
    'main@{1}',
    'main^',
    'main\r',
  ]) {
    for (const ci of [{}, { GITHUB_ACTIONS: 'true' }]) {
      const result = runScript({ files, env: { ...ci, BASE_REF: ref } });
      assert.equal(result.status, 1, JSON.stringify(ref));
      assert.equal(result.stdout, message, JSON.stringify(ref));
      assert.equal(result.stderr, '', JSON.stringify(ref));
    }
  }
  // A plain name passes the check: main, a name with a folder, and an empty BASE_REF, which means main.
  for (const ref of ['main', '', 'release/1.x', 'feature_a-b.c']) {
    const result = runScript({ files, env: { BASE_REF: ref } });
    assert.equal(result.status, 0, `${JSON.stringify(ref)}: ${result.stdout}`);
  }
});

test('kit-identity fails a kit version on the base that is not plain: the comparison fails closed', () => {
  for (const version of ['1.2.3-rc.1', '1.2.3+b', 'x']) {
    const result = runScript({
      bases: [['main', lockfile(version)]],
      files: { '.npmrc': NPMRC, 'package-lock.json': lockfile('9.9.9') },
    });
    assert.equal(result.status, 1, version);
    assert.equal(result.stdout, errorLine('the kit version on the base is not a plain version X.Y.Z'), version);
  }
});

test('kit-identity fails in GitHub Actions when the base ref is not in the clone, and reads on outside CI', () => {
  const files = { '.npmrc': NPMRC, 'package-lock.json': lockfile('1.2.3') };
  const missing = errorLine('the base branch is not in the clone; fetch it before this step');
  const ci = runScript({ bases: [], files, env: { GITHUB_ACTIONS: 'true' } });
  assert.equal(ci.status, 1);
  assert.equal(ci.stdout, missing);
  // A wrong BASE_REF in CI fails the same way.
  const wrong = runScript({ files, env: { GITHUB_ACTIONS: 'true', BASE_REF: 'mian' } });
  assert.equal(wrong.status, 1);
  assert.equal(wrong.stdout, missing);
  // Outside CI: one notice line on stderr, and the script goes on.
  const local = runScript({ bases: [], files });
  assert.equal(local.status, 0, local.stdout);
  assert.equal(local.stdout, `${KIT} 1.2.3 and every other package from the npm registry\n`);
  assert.equal(
    local.stderr,
    'kit-identity: there is no origin/main here, so the kit version is not compared with the base\n',
  );
  // In CI, a base that exists without package-lock.json skips the comparison.
  const noLock = runScript({ bases: [['main', undefined]], files, env: { GITHUB_ACTIONS: 'true' } });
  assert.equal(noLock.status, 0, noLock.stdout);
  const ok = runScript({ files, env: { GITHUB_ACTIONS: 'true' } });
  assert.equal(ok.status, 0, ok.stdout);
  assert.equal(ok.stderr, '');
});

test('kit-identity fails a kit version with a prerelease or a build part, and a downgrade 1.10.0 -> 1.9.0', () => {
  for (const version of ['1.2.3-rc.1', '1.2.3+b', '1.2.3-rc.1+b']) {
    const result = runLock(lockfile(version));
    assert.equal(result.status, 1, version);
    assert.equal(result.stdout, errorLine(NOT_PLAIN), version);
  }
  const down = runScript({
    bases: [['main', lockfile('1.10.0')]],
    files: { '.npmrc': NPMRC, 'package-lock.json': lockfile('1.9.0') },
  });
  assert.equal(down.stdout, errorLine('the kit went down from 1.10.0 on origin/main to 1.9.0'));
});

test('kit-identity prints a bad key without its control characters, so no line of it forges an annotation', () => {
  const key = 'node_modules/x\n::error file=src/a.ts,line=1::looks fine\r\n::stop-commands::zz';
  const result = runLock(lockfile('1.2.3', { [key]: { version: '1.0.0' } }));
  assert.equal(result.status, 1);
  assert.equal(result.stdout.split('\n').length, 2);
  assert.equal(
    result.stdout,
    errorLine(badEntries('node_modules/x::error file=src/a.ts,line=1::looks fine::stop-commands::zz')),
  );
});

test('kit-identity anchors its patterns at the end of the text: a key or a version with a final newline fails', () => {
  const result = runLock(
    lockfile('1.2.3', {
      'node_modules/x\n': {
        version: '1.0.0\n',
        resolved: 'https://registry.npmjs.org/x\n/-/x\n-1.0.0\n.tgz',
        integrity: 'sha512-AA',
      },
    }),
  );
  assert.equal(result.status, 1);
  assert.equal(result.stdout, errorLine(badEntries('node_modules/x')));
});

test('kit-identity fails a lockfile that is not JSON or has no object .packages with a fixed line', () => {
  const message = errorLine('package-lock.json is not JSON with an object .packages of entries');
  for (const lock of [
    '{ not json',
    json({ lockfileVersion: 1, dependencies: {} }),
    json({ lockfileVersion: 3, packages: [] }),
    json({ lockfileVersion: 3, packages: { '': {}, 'node_modules/x': 5 } }),
    `${lockfile('1.2.3')}${lockfile('1.2.3')}`,
    '',
  ]) {
    const result = runLock(lock);
    assert.equal(result.status, 1, lock);
    assert.equal(result.stdout, message, lock);
  }
  const base = runScript({
    bases: [['main', '{ not json']],
    files: { '.npmrc': NPMRC, 'package-lock.json': lockfile('1.2.3') },
  });
  assert.equal(base.status, 1);
  assert.equal(base.stdout, errorLine('package-lock.json on the base is not JSON with an object .packages of entries'));
});

test('config-shim compares kit-identity.sh and .npmrc byte for byte: CRLF or a missing final newline fails', () => {
  const end = "config-shim .npmrc: the kit's rendering has LF line ends and ends with one newline, byte for byte";
  assert.deepEqual(protectedFindings({ [NPMRC_FILE]: 'ignore-scripts=true\r\nsave-exact=true\r\n' }), [end]);
  assert.deepEqual(protectedFindings({ [NPMRC_FILE]: 'ignore-scripts=true\nsave-exact=true' }), [end]);
  assert.deepEqual(protectedFindings({ [NPMRC_FILE]: `${renderNpmrc()}\n` }), [end]);
  assert.deepEqual(protectedFindings({ [KIT_IDENTITY_FILE]: renderKitIdentity().replace(/\n/g, '\r\n') }), [
    "config-shim .github/kit-identity.sh: the kit's rendering has LF line ends and ends with one newline, byte for byte",
  ]);
});

test('config-shim fails a protected file that is a symbolic link, dangling or not', () => {
  const { [KIT_IDENTITY_FILE]: _script, [NPMRC_FILE]: _npmrc, ...others } = renderProtected(OWNER);
  const findings = inTemp(
    { ...others, 'elsewhere/npmrc': renderNpmrc(), 'elsewhere/kit-identity.sh': renderKitIdentity() },
    (root) => {
      symlinkSync(join(root, 'elsewhere/kit-identity.sh'), join(root, KIT_IDENTITY_FILE));
      symlinkSync(join(root, 'elsewhere/missing'), join(root, NPMRC_FILE));
      const report = new Report();
      checkProtectedFiles(root, OWNER, report);
      return report.findings.map((finding) => `${finding.where}: ${finding.detail}`);
    },
  );
  assert.deepEqual(findings, [`${KIT_IDENTITY_FILE}: is a link, not a file`, `${NPMRC_FILE}: is a link, not a file`]);
});

// The kit hash from the registry (10.3): npm's cache is keyed by the integrity hash, so the script asks the registry

/** The message of a kit hash that is not the hash of the registry. */
const notRegistryHash = (version: string): string =>
  `the kit entry's hash is not the hash of ${KIT} ${version} on the npm registry`;

/** The message of an `npm view` that gives no sha512 hash. */
const noRegistryHash = (version: string): string =>
  `the npm registry gave no sha512 hash for ${KIT} ${version}: it is unreachable or has no such version`;

test('kit-identity asks the registry for the kit hash with the pinned flags and a fresh, empty cache, removed after', () => {
  const result = runLock(lockfile('1.2.4'));
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
  assert.equal(result.stdout, `${KIT} 1.2.4 and every other package from the npm registry\n`);
  assert.equal(result.npm.length, 1);
  const [call] = result.npm;
  assert.ok(call);
  assert.deepEqual(call.args, npmViewArgs('1.2.4', call.cache));
  // The cache is a new folder of mktemp in TMPDIR, empty when npm runs, and the script removes it after npm filled it.
  assert.equal(call.state, 'empty');
  assert.match(call.cache, /\/test-tools\/tmp\/tmp\.[A-Za-z0-9]+$/);
  assert.deepEqual(result.tmp, []);
});

test('kit-identity fails a kit hash that is not the hash of the registry, and removes the cache', () => {
  const other = `sha512-${Buffer.from('another tarball').toString('base64')}`;
  const result = runLock(lockfile('1.2.3'), { FAKE_VIEW_ANSWER: other });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, errorLine(notRegistryHash('1.2.3')));
  assert.equal(result.npm.length, 1);
  assert.deepEqual(result.tmp, []);
  // A hash of the registry with a second hash after it is not the same text: the check compares it exactly.
  const lock = JSON.parse(lockfile('1.2.3')) as { packages: Record<string, { integrity: string }> };
  const own = lock.packages[KIT_KEY]?.integrity ?? '';
  assert.equal(
    runLock(lockfile('1.2.3'), { FAKE_VIEW_ANSWER: `${own} sha1-AAAA` }).stdout,
    errorLine(notRegistryHash('1.2.3')),
  );
  assert.equal(runLock(lockfile('1.2.3'), { FAKE_VIEW_ANSWER: own }).status, 0);
});

test('kit-identity fails with one fixed line when npm view fails or gives no sha512 hash, and removes the cache', () => {
  for (const env of [
    { FAKE_VIEW_EXIT: '1' },
    { FAKE_VIEW_ANSWER: '' },
    { FAKE_VIEW_ANSWER: 'sha1-AAAA' },
    { FAKE_VIEW_ANSWER: '::error::forged' },
  ]) {
    const result = runLock(lockfile('1.2.3'), env);
    assert.equal(result.status, 1, JSON.stringify(env));
    assert.equal(result.stdout, errorLine(noRegistryHash('1.2.3')), JSON.stringify(env));
    assert.equal(result.npm.length, 1, JSON.stringify(env));
    assert.deepEqual(result.tmp, [], JSON.stringify(env));
  }
});

test('kit-identity asks the registry only after every check of the files: a failing lockfile makes no npm call', () => {
  for (const lock of [lockfile(undefined), lockfile('1.2.3+evil'), lockfile('1.2.3', { 'node_modules/x': {} })]) {
    const result = runLock(lock);
    assert.equal(result.status, 1);
    assert.deepEqual(result.npm, []);
  }
  const down = runScript({
    bases: [['main', lockfile('1.10.0')]],
    files: { '.npmrc': NPMRC, 'package-lock.json': lockfile('1.9.0') },
  });
  assert.equal(down.status, 1);
  assert.deepEqual(down.npm, []);
});

test('10.3 explains the cache, the registry check of the kit and why npm audit signatures does not help', () => {
  for (const text of [
    "npm's cache is keyed by the integrity hash, so a lockfile hash alone does not bind a URL to its bytes.",
    'npm downloads every tarball from its exact URL and checks it against the lockfile hash',
    '`npm view "@raess/astro-kit@$version" dist.integrity`',
    '`npm audit signatures` does not close the gap: it checks the registry signatures of each name and version in the tree, never the bytes that were installed',
    'The install keeps the default `fetch-retries` of npm (2)',
  ]) {
    assert.equal(SPEC.includes(text), true, text);
  }
  const { standard } = getRule(RULE);
  assert.equal(standard.includes('whose hash is the one that the npm registry gives for that version'), true);
  assert.equal(standard.includes('with a fresh, empty `--cache`'), true);
});

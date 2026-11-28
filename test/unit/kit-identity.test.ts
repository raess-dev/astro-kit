/**
 * `.github/kit-identity.sh` (10.3) and the rule `config-kit-identity` (part 9d of M9). The template is the exact
 * block of the specification. The script runs under bash in a scratch git repository with
 * `refs/remotes/origin/main` (14.1, ci rules): it passes a lockfile of npm registry packages, and each failure
 * prints its exact `::error::` line. No test installs a package.
 */
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { getRule, Report } from '../../src/registry.ts';
import {
  checkProtectedFiles,
  KIT_IDENTITY_FILE,
  NPMRC_FILE,
  RENDERED_PROTECTED,
  renderKitIdentity,
  renderNpmrc,
} from '../../src/shims.ts';
import { type Files, inTemp, json } from './fixtures.ts';
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
  assert.deepEqual(Object.keys(RENDERED_PROTECTED), [KIT_IDENTITY_FILE, NPMRC_FILE]);
});

test('config-kit-identity is a ci rule of the config group, and the script links its row of standards.md', () => {
  const rule = getRule(RULE);
  assert.equal(rule.group, 'config');
  assert.equal(rule.stage, 'ci');
  assert.equal(rule.level, 'error');
  assert.equal(rule.waivable, false);
  assert.equal(renderKitIdentity().includes(`(rule: ${RULE_URL})`), true);
});

// The protected files part of `config-shim`

/** The findings of the protected files part of `config-shim` in a root, as `<where>: <detail>`. */
function protectedFindings(files: Files): string[] {
  return inTemp(files, (root) => {
    const report = new Report();
    checkProtectedFiles(root, report);
    return report.findings.map((finding) => `${finding.rule} ${finding.where}: ${finding.detail}`);
  });
}

test('config-shim passes the rendered kit-identity.sh and .npmrc, also with CRLF, and a project without them', () => {
  assert.deepEqual(protectedFindings({ [KIT_IDENTITY_FILE]: renderKitIdentity(), [NPMRC_FILE]: renderNpmrc() }), []);
  assert.deepEqual(protectedFindings({ [NPMRC_FILE]: 'ignore-scripts=true\r\nsave-exact=true\r\n\r\n' }), []);
  // Until part 9e of M9 makes the protected files required, a missing one is no finding.
  assert.deepEqual(protectedFindings({}), []);
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

/** The environment of git and the script: no config of the machine, and no `BASE_REF` of the caller. */
function cleanEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'Test',
    GIT_AUTHOR_EMAIL: 'test@example.ch',
    GIT_COMMITTER_NAME: 'Test',
    GIT_COMMITTER_EMAIL: 'test@example.ch',
    ...extra,
  };
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

/** Runs the template with bash in a scratch git repository and gives its status and its output. */
function runScript(scratch: Scratch): { status: number | null; stdout: string; stderr: string } {
  return inTemp({}, (root) => {
    git(root, ['init', '-q', '-b', 'work']);
    for (const [branch, lock] of scratch.bases ?? [['main', lockfile('1.2.3')]]) {
      rmSync(join(root, 'package-lock.json'), { force: true });
      commitAs(root, branch, lock === undefined ? { '.npmrc': NPMRC } : { '.npmrc': NPMRC, 'package-lock.json': lock });
    }
    for (const path of ['package-lock.json', '.npmrc']) rmSync(join(root, path), { force: true });
    for (const [path, text] of Object.entries(scratch.files)) writeFileSync(join(root, path), text);
    const result = spawnSync('bash', [TEMPLATE], { cwd: root, env: cleanEnv(scratch.env), encoding: 'utf8' });
    return { status: result.status, stdout: result.stdout, stderr: result.stderr };
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
    message: '.npmrc must contain ignore-scripts=true',
  },
  {
    name: '.npmrc with the line only as a part of another line',
    scratch: { files: { '.npmrc': '# ignore-scripts=true\n', 'package-lock.json': lockfile('1.2.3') } },
    message: '.npmrc must contain ignore-scripts=true',
  },
  {
    name: 'no .npmrc',
    scratch: { files: { 'package-lock.json': lockfile('1.2.3') } },
    message: '.npmrc must contain ignore-scripts=true',
  },
  {
    name: 'a kit version that is not plain',
    scratch: { files: { '.npmrc': NPMRC, 'package-lock.json': lockfile('1.2.3+evil') } },
    message: 'the kit version "1.2.3+evil" is not a plain version',
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
  // 1.10.0 on main and 1.10.1 here: up, also by `sort -V`.
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

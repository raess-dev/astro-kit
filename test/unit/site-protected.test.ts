/**
 * The protected task of 10.6 runs the kit from the lockfile of the site, and only its push step holds the deploy
 * key. The job parses from the rendered `site.yml`; the push step runs under bash against a bare remote, with a fake
 * `ssh` that checks the key file and then speaks git to the bare remote on the same machine, so no key and no
 * network are needed.
 *
 * No test reaches GitHub or npm.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { parse } from 'yaml';
import { renderSiteMergeWorkflow, renderSiteWorkflow } from '../../src/shims.ts';
import { bash, lines, scratch } from './site-scripts.ts';
import { SPEC, specBlock } from './spec.ts';

interface Step {
  name?: string;
  uses?: string;
  run?: string;
  with?: Record<string, unknown>;
  env?: Record<string, string>;
}
interface Job {
  env?: Record<string, string>;
  steps: Step[];
}

const TEXT = renderSiteWorkflow();
const PROTECTED = (parse(TEXT) as { jobs: Record<string, Job> }).jobs.protected as Job;
const expression = (name: string): string => `\${{ ${name} }}`;
const stepNamed = (name: string): Step => {
  const found = PROTECTED.steps.find((entry) => entry.name === name);
  if (!found) throw new Error(`the protected job has no step ${name}`);
  return found;
};

const INSTALL = [
  'c=$(mktemp -d)',
  'st=0',
  'npm ci --ignore-scripts --no-audit --no-fund --registry=https://registry.npmjs.org/ --replace-registry-host=never --strict-ssl=true --cache "$c" || st=$?',
  'rm -rf "$c"',
  'exit "$st"',
  '',
].join('\n');
const PUSH = 'Push the protected files';
const KEY_TEXT = '-----BEGIN OPENSSH PRIVATE KEY-----\nfake-key-line\n-----END OPENSSH PRIVATE KEY-----';
const GITHUB_HOST_KEY = 'github.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl';

test('the protected job checks the lockfile, installs it as 10.1 does, checks the tree and the checkout, runs the kit, then pushes', () => {
  assert.deepEqual(
    PROTECTED.steps.map((entry) => entry.name ?? entry.uses?.replace(/@.*$/, '')),
    [
      'Check the branch input',
      'actions/checkout',
      'actions/setup-node',
      'Check the lockfile',
      'Install with an empty private cache',
      'Check the installed tree',
      'Check the checkout',
      'Render the protected files',
      PUSH,
    ],
  );
  assert.equal(stepNamed('Check the lockfile').run, 'bash .github/kit-identity.sh');
  assert.equal(stepNamed('Install with an empty private cache').run, INSTALL);
  assert.equal(stepNamed('Check the installed tree').run, 'npm ls --all > /dev/null');
  assert.equal(stepNamed('Check the checkout').run, `${specBlock('- **The checkout check.**', 'sh')}\n`);
  // The kit of node_modules, whose bin the checkout check has just tied to its own package.
  assert.equal(stepNamed('Render the protected files').run, 'npx --no astro-kit init --protected');
  assert.equal(stepNamed(PUSH).run, `${specBlock('**The push step.**', 'sh')}\n`);
  assert.equal(SPEC.includes('`npx --no astro-kit init --protected`'), true);
});

test('the protected task installs no package by name and carries no zizmor waiver', () => {
  const runs = PROTECTED.steps.map((entry) => entry.run ?? '').join('\n');
  assert.doesNotMatch(runs, /npm (install|i|add)\b/);
  assert.doesNotMatch(runs, /RUNNER_TEMP\/kit/);
  assert.equal(runs.split('npm ci ').length, 2, 'one npm ci, in the checkout');
  for (const text of [TEXT, renderSiteMergeWorkflow()]) assert.equal(text.includes('zizmor'), false);
  assert.equal(SPEC.includes('ignore[adhoc-packages] only the kit'), false);
});

test('the deploy key reaches only the push step: the checkout has no key and keeps no credentials', () => {
  const checkout = PROTECTED.steps.find((entry) => entry.uses?.startsWith('actions/checkout@'));
  assert.deepEqual(checkout?.with, {
    ref: expression("inputs.branch || 'main'"),
    'fetch-depth': 0,
    'persist-credentials': false,
  });
  assert.equal(TEXT.split('secrets.KIT_PROTECTED_KEY').length, 2, 'the key is named once in the workflow');
  assert.doesNotMatch(TEXT, /ssh-key:/);
  assert.doesNotMatch(JSON.stringify(PROTECTED.env ?? {}), /secrets\./);
  for (const entry of PROTECTED.steps) {
    const holds = JSON.stringify(entry).includes('secrets.');
    assert.equal(holds, entry.name === PUSH, entry.name ?? entry.uses);
  }
  assert.deepEqual(stepNamed(PUSH).env, {
    GH_TOKEN: expression('github.token'),
    KIT_PROTECTED_KEY: expression('secrets.KIT_PROTECTED_KEY'),
  });
  // The push step runs git and gh only: no npm, no npx, no node.
  assert.doesNotMatch(stepNamed(PUSH).run ?? '', /\b(npm|npx|node)\b/);
});

/**
 * A fake `ssh`: it records its arguments, the mode and text of the key file and the known hosts file, then runs the
 * git command of its last argument in `$REMOTES`, where the bare remote `o/r.git` stands.
 */
const FAKE_SSH = `echo "ssh $*" >> "$LOG"
key=''; hosts=''; prev=''
for a in "$@"; do
  [ "$prev" = -i ] && key=$a
  case "$a" in UserKnownHostsFile=*) hosts=\${a#UserKnownHostsFile=} ;; esac
  prev=$a
done
echo "$key" >> "$LOG.keydir"
echo "mode $(stat -c %a "$key")" >> "$LOG.key"
cat "$key" >> "$LOG.key"
cat "$hosts" >> "$LOG.hosts"
cd "$REMOTES" && exec bash -c "\${@: -1}"
`;

function push(target: string, open: string, change = true) {
  const gh = `echo "gh $*" >> "$LOG"; [ "$2" = list ] && echo '${open}'; exit 0\n`;
  return scratch({ ssh: FAKE_SSH, gh }, (work, env) => {
    const remotes = join(dirname(work), 'remotes');
    const remote = join(remotes, 'o/r.git');
    const git = (cwd: string, ...args: string[]) =>
      spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@e', ...args], {
        cwd,
        encoding: 'utf8',
        env: { ...env, GIT_CONFIG_NOSYSTEM: '1' },
      });
    git(dirname(work), 'init', '-q', '--bare', '-b', 'main', remote);
    git(work, 'init', '-q', '-b', 'main');
    writeFileSync(join(work, 'a.txt'), 'old\n');
    git(work, 'add', '-A');
    git(work, 'commit', '-q', '-m', 'main');
    git(work, 'push', '-q', remote, 'main', 'main:agent/x');
    if (change) writeFileSync(join(work, 'a.txt'), 'rendered\n');
    const result = bash(stepNamed(PUSH).run ?? '', work, {
      ...env,
      GIT_CONFIG_NOSYSTEM: '1',
      REMOTES: remotes,
      BRANCH: target,
      REPO: 'o/r',
      GH_TOKEN: 'x',
      KIT_PROTECTED_KEY: `${KEY_TEXT}\n`,
    });
    const heads = Object.fromEntries(
      ['main', 'agent/x', 'kit/protected'].map((ref) => [
        ref,
        git(remote, 'log', '-1', '--format=%s %an', ref).stdout.trim(),
      ]),
    );
    const config = readFileSync(join(work, '.git/config'), 'utf8');
    return {
      status: result.status,
      out: result.stdout + result.stderr,
      calls: lines(env.LOG ?? ''),
      heads,
      key: readFileSync(`${env.LOG}.key`, { encoding: 'utf8', flag: 'a+' }),
      hosts: readFileSync(`${env.LOG}.hosts`, { encoding: 'utf8', flag: 'a+' }),
      keyDirs: lines(`${env.LOG}.keydir`).map((file) => dirname(file)),
      left: readdirSync(env.TMPDIR ?? ''),
      config,
    };
  });
}

test('the push step writes the key for git alone, pushes to the branch over ssh, and removes the key', () => {
  // Nothing to push: the step ends before it writes the key, and calls no ssh.
  const none = push('agent/x', '0', false);
  assert.equal(none.status, 0, none.out);
  assert.equal(none.out, 'The protected files are up to date.\n');
  assert.deepEqual(none.calls, []);
  assert.equal(none.key, '');
  assert.deepEqual(none.left, []);
  const run = push('agent/x', '0');
  assert.equal(run.status, 0, run.out);
  assert.equal(run.heads['agent/x'], 'chore: render the protected files github-actions[bot]');
  assert.equal(run.heads.main, 'main t');
  assert.equal(run.heads['kit/protected'], '');
  const [ssh, ...rest] = run.calls;
  assert.deepEqual(rest, [], 'no gh call for a branch');
  const [dir] = run.keyDirs;
  assert.equal(
    ssh,
    `ssh -F /dev/null -i ${dir}/key -o IdentitiesOnly=yes -o IdentityAgent=none -o StrictHostKeyChecking=yes -o UserKnownHostsFile=${dir}/known_hosts git@github.com git-receive-pack 'o/r.git'`,
  );
  // The key file is the secret with one final newline, readable by its owner only; the host key is GitHub's.
  assert.equal(run.key, `mode 600\n${KEY_TEXT}\n`);
  assert.equal(run.hosts, `${GITHUB_HOST_KEY}\n`);
  assert.equal(existsSync(dir ?? ''), false, 'the key folder is removed');
  assert.deepEqual(run.left, [], 'nothing is left in the temp folder');
  assert.equal(run.config.includes('fake-key-line'), false);
  assert.doesNotMatch(run.config, /sshCommand|extraheader|insteadOf/);
});

test('without a branch the push step force-pushes kit/protected and opens one pull request', () => {
  const run = push('', '0');
  assert.equal(run.status, 0, run.out);
  assert.equal(run.heads['kit/protected'], 'chore: render the protected files github-actions[bot]');
  assert.equal(run.heads.main, 'main t');
  assert.deepEqual(run.calls.slice(1), [
    'gh pr list --repo o/r --head kit/protected --state open --json number --jq length',
    'gh pr create --repo o/r --base main --head kit/protected --title Render the protected files --body Rendered by the protected task.',
  ]);
  assert.match(run.calls[0] ?? '', / git@github\.com git-receive-pack 'o\/r\.git'$/);
  const again = push('', '1');
  assert.deepEqual(again.calls.slice(1), [
    'gh pr list --repo o/r --head kit/protected --state open --json number --jq length',
  ]);
});

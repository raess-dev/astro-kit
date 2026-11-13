import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

interface Step {
  uses?: string;
  run?: string;
  with?: Record<string, unknown>;
  env?: Record<string, string>;
}
interface Job {
  name: string;
  needs?: string[];
  if?: string;
  'timeout-minutes'?: number;
  permissions?: Record<string, string>;
  env?: Record<string, string>;
  steps: Step[];
}
interface Workflow {
  on: Record<string, { types?: string[]; branches?: string[] } | null>;
  permissions: Record<string, string>;
  env: Record<string, string>;
  jobs: Record<string, Job>;
}

const load = (name: string): { text: string; workflow: Workflow } => {
  const text = readFileSync(fileURLToPath(new URL(`../../.github/workflows/${name}`, import.meta.url)), 'utf8');
  return { text, workflow: parse(text) as Workflow };
};
const KIT = load('kit.yml');
const APPROVED = load('kit-approved.yml');
const FILES = [KIT, APPROVED];
const JOBS: Record<string, Job> = { ...KIT.workflow.jobs, ...APPROVED.workflow.jobs };

const job = (id: string): Job => {
  const found = JOBS[id];
  if (!found) throw new Error(`the workflows have no job ${id}`);
  return found;
};
const expression = (name: string): string => `\${{ ${name} }}`;

test('kit.yml has the triggers, the empty top-level permissions and the env of 11.1', () => {
  const { on, permissions, env } = KIT.workflow;
  assert.deepEqual(Object.keys(on).sort(), ['pull_request', 'push', 'schedule', 'workflow_dispatch']);
  assert.deepEqual(on.pull_request?.types, ['opened', 'synchronize', 'reopened', 'ready_for_review']);
  assert.deepEqual(on.push?.branches, ['main']);
  assert.deepEqual(permissions, {});
  assert.equal(env.ASTRO_TELEMETRY_DISABLED, '1');
  assert.equal(env.REPO, expression('github.repository'));
});

test('the merge after an approval is a workflow of its own, on review events only', () => {
  const { on, permissions, env, jobs } = APPROVED.workflow;
  assert.deepEqual(Object.keys(on), ['pull_request_review']);
  assert.deepEqual(on.pull_request_review?.types, ['submitted']);
  assert.deepEqual(permissions, {});
  assert.equal(env.REPO, expression('github.repository'));
  assert.deepEqual(Object.keys(jobs), ['merge-approved']);
  // A skipped job counts as a passed check. So no workflow that runs on a review may hold a job with the name of a
  // required check, and no job of kit.yml may be skipped by an event condition except the merge job.
  assert.deepEqual(Object.keys(KIT.workflow.jobs), ['test', 'scan', 'merge']);
  assert.equal(job('test').if, undefined);
  assert.equal(job('scan').if, undefined);
});

test('every job has a name, its own permissions and a timeout', () => {
  const names: Record<string, string> = {
    test: 'kit / test',
    scan: 'kit / scan',
    merge: 'kit / merge',
    'merge-approved': 'kit / merge after approval',
  };
  assert.deepEqual(Object.keys(JOBS).sort(), Object.keys(names).sort());
  for (const id of Object.keys(JOBS)) {
    const found = job(id);
    assert.equal(found.name, names[id]);
    assert.ok(found.permissions, `${id} has permissions`);
    assert.ok(found['timeout-minutes'], `${id} has a timeout`);
  }
  assert.deepEqual(job('test').permissions, { contents: 'read' });
  assert.deepEqual(job('scan').permissions, { contents: 'read' });
  for (const id of ['merge', 'merge-approved']) {
    assert.deepEqual(job(id).permissions, { contents: 'write', 'pull-requests': 'write', actions: 'write' });
    assert.equal(job(id)['timeout-minutes'], 5);
  }
});

test('every action is pinned to a commit with its version in a comment', () => {
  const lines = FILES.flatMap((file) => file.text.split('\n')).filter((line) => /^\s*-?\s*uses:/.test(line));
  assert.ok(lines.length >= 4);
  for (const line of lines) {
    assert.match(line, /uses: [\w.-]+\/[\w.-]+@[0-9a-f]{40} # v\d+\.\d+\.\d+$/, line.trim());
  }
});

test('every checkout drops its credentials, and setup-node reads .node-version', () => {
  const steps = Object.values(JOBS).flatMap((found) => found.steps);
  const checkouts = steps.filter((step) => step.uses?.startsWith('actions/checkout@'));
  const nodes = steps.filter((step) => step.uses?.startsWith('actions/setup-node@'));
  assert.ok(checkouts.length >= 2);
  assert.ok(nodes.length >= 1);
  assert.deepEqual(
    checkouts.map((step) => step.with?.['persist-credentials']),
    checkouts.map(() => false),
  );
  assert.deepEqual(
    nodes.map((step) => step.with?.['node-version-file']),
    nodes.map(() => '.node-version'),
  );
});

test('the test job runs the commands of 11.1 in order, and scan gets the gitleaks pin through its env', () => {
  const runs = job('test')
    .steps.map((step) => step.run)
    .filter((run) => run !== undefined);
  assert.deepEqual(runs, [
    'npm ci --ignore-scripts --no-audit --no-fund',
    'npx --no playwright-core install --with-deps chromium',
    'npm run build',
    'npm run check',
    'npm test',
    'node src/docs.ts --check',
  ]);
  assert.match(job('scan').env?.GITLEAKS ?? '', /^ghcr\.io\/gitleaks\/gitleaks:v\d+\.\d+\.\d+@sha256:[0-9a-f]{64}$/);
});

test('merge needs the checks and a pull request of this repository; merge-approved needs an approval into main', () => {
  assert.deepEqual(job('merge').needs, ['test', 'scan']);
  const condition = job('merge').if ?? '';
  assert.match(condition, /github\.event_name == 'pull_request'/);
  assert.match(condition, /github\.event\.pull_request\.head\.repo\.full_name == github\.repository/);
  const approved = job('merge-approved').if ?? '';
  assert.match(approved, /github\.event\.review\.state == 'approved'/);
  assert.match(approved, /github\.event\.pull_request\.base\.ref == 'main'/);
  assert.match(approved, /github\.event\.pull_request\.head\.repo\.full_name == github\.repository/);
  assert.equal(job('merge').steps[0]?.run, job('merge-approved').steps[0]?.run, 'both jobs run one script');
  for (const id of ['merge', 'merge-approved']) {
    assert.deepEqual(Object.keys(job(id).steps[0]?.env ?? {}), [
      'GH_TOKEN',
      'KIT_AGENTS',
      'PR',
      'TESTED_SHA',
      'HEAD_REF',
    ]);
  }
  // `github.head_ref` is empty on a review event, so the approved job reads the branch from the pull request.
  assert.equal(job('merge').steps[0]?.env?.HEAD_REF, expression('github.head_ref'));
  assert.equal(job('merge-approved').steps[0]?.env?.HEAD_REF, expression('github.event.pull_request.head.ref'));
});

// ── the merge script, against a fake gh ─────────────────────────────────────

const SCRIPT = job('merge').steps[0]?.run ?? '';

/**
 * A `gh` that answers `gh api` from JSON in environment variables and applies the `--jq` program of the call with
 * the real jq, as gh does. It records the calls that change something.
 */
const FAKE_GH = `#!/usr/bin/env bash
program=''
for ((i = 1; i <= $#; i++)); do
  if [ "\${!i}" = --jq ]; then j=$((i + 1)); program="\${!j}"; fi
done
case "$1 $2" in
  "api repos/o/r/pulls/7") jq -r "$program" <<<"$FAKE_PULL" ;;
  "api --paginate") [ "$3" = repos/o/r/pulls/7/files ] || exit 9; jq -r "$program" <<<"$FAKE_FILES" ;;
  "pr merge") echo "merge $*" >> "$FAKE_LOG"; if [ "$FAKE_REFUSE" = 1 ]; then echo 'required status check is expected' >&2; exit 1; fi ;;
  "workflow run") echo "dispatch $*" >> "$FAKE_LOG" ;;
  *) echo "unexpected gh call: $*" >&2; exit 9 ;;
esac
`;

interface Case {
  state?: string;
  draft?: boolean;
  head?: string;
  base?: string;
  author?: string;
  files?: (string | { filename: string; previous_filename: string })[];
  agents?: string | undefined;
  refuse?: boolean;
}

function merge(c: Case): { status: number | null; out: string; calls: string[] } {
  const dir = mkdtempSync(join(tmpdir(), 'astro-kit-'));
  try {
    const gh = join(dir, 'gh');
    writeFileSync(gh, FAKE_GH);
    chmodSync(gh, 0o755);
    const log = join(dir, 'calls.log');
    const pull = {
      state: c.state ?? 'open',
      draft: c.draft ?? false,
      head: { sha: c.head ?? 'abc' },
      base: { ref: c.base ?? 'build' },
      user: { login: c.author ?? 'kit-agent' },
    };
    const files = (c.files ?? ['src/registry.ts']).map((file) =>
      typeof file === 'string' ? { filename: file } : file,
    );
    const env: Record<string, string> = {
      PATH: `${dir}:${process.env.PATH ?? ''}`,
      REPO: 'o/r',
      PR: '7',
      TESTED_SHA: 'abc',
      HEAD_REF: 'feature',
      GH_TOKEN: 'x',
      FAKE_PULL: JSON.stringify(pull),
      FAKE_FILES: JSON.stringify(files),
      FAKE_LOG: log,
      FAKE_REFUSE: c.refuse ? '1' : '0',
    };
    const agents = 'agents' in c ? c.agents : '["kit-agent"]';
    if (agents !== undefined) env.KIT_AGENTS = agents;
    const result = spawnSync('bash', ['-c', SCRIPT], { env, encoding: 'utf8' });
    const calls = existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n') : [];
    return { status: result.status, out: `${result.stdout}${result.stderr}`, calls };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('the merge script merges a green agent pull request into build, and dispatches no release', () => {
  const result = merge({});
  assert.equal(result.status, 0, result.out);
  assert.deepEqual(result.calls, ['merge pr merge 7 --repo o/r --squash --delete-branch --match-head-commit abc']);
});

test('the merge script dispatches the release after a merge into main', () => {
  const result = merge({ base: 'main' });
  assert.equal(result.status, 0, result.out);
  assert.equal(result.calls.length, 2);
  assert.equal(result.calls[1], 'dispatch workflow run release.yml --repo o/r --ref main -f paired=feature');
});

test('the merge script leaves every pull request that it must not merge', () => {
  const cases: [string, Case, RegExp][] = [
    ['a closed pull request', { state: 'closed' }, /the pull request is closed/],
    ['a draft', { draft: true }, /a draft waits for the owner/],
    ['another base', { base: 'release' }, /the base is release, not main or build/],
    ['a moved head', { head: 'def' }, /the head moved/],
    ['a foreign author', { author: 'someone' }, /someone is not an agent account/],
    ['the owner as author', { author: 'owner', agents: '["kit-agent"]' }, /owner is not an agent account/],
    ['no KIT_AGENTS variable', { agents: undefined }, /kit-agent is not an agent account/],
    ['an empty KIT_AGENTS variable', { agents: '' }, /kit-agent is not an agent account/],
    ['a KIT_AGENTS variable that is no JSON', { agents: '[kit-agent]' }, /kit-agent is not an agent account/],
    ['a workflow file', { files: ['src/a.ts', '.github/workflows/kit.yml'] }, /it changes a protected file/],
    ['the code-owner file', { files: ['.github/CODEOWNERS'] }, /it changes a protected file/],
    ['.npmrc', { files: ['.npmrc'] }, /it changes a protected file/],
    ['wrangler.jsonc', { files: ['wrangler.jsonc'] }, /it changes a protected file/],
    ['a nested wrangler file', { files: ['sub/wrangler.toml'] }, /it changes a protected file/],
    [
      'a protected file that is moved away',
      { files: [{ filename: 'docs/npmrc.txt', previous_filename: '.npmrc' }] },
      /it changes a protected file/,
    ],
    [
      'the code-owner file that is moved away',
      { files: ['src/a.ts', { filename: 'docs/CODEOWNERS', previous_filename: '.github/CODEOWNERS' }] },
      /it changes a protected file/,
    ],
  ];
  for (const [name, c, message] of cases) {
    const result = merge(c);
    assert.equal(result.status, 0, `${name}: ${result.out}`);
    assert.match(result.out, message, name);
    assert.deepEqual(result.calls, [], name);
  }
});

test('the merge script merges a Dependabot pull request without a KIT_AGENTS variable', () => {
  const result = merge({ author: 'dependabot[bot]', agents: undefined, files: ['package.json', 'package-lock.json'] });
  assert.equal(result.status, 0, result.out);
  assert.equal(result.calls.length, 1);
});

test('the file rule reads whole names: a file that only resembles a protected one is merged', () => {
  const result = merge({
    files: [
      'docs/wrangler-notes.md',
      'src/npmrc.ts',
      'templates/site/_npmrc',
      'docs/.github.md',
      { filename: 'src/b.ts', previous_filename: 'src/a.ts' },
    ],
  });
  assert.equal(result.status, 0, result.out);
  assert.equal(result.calls.length, 1, result.out);
});

test('when GitHub refuses the merge, the script ends with success and dispatches nothing', () => {
  const result = merge({ base: 'main', refuse: true });
  assert.equal(result.status, 0, result.out);
  assert.match(result.out, /GitHub refused the merge: required status check is expected/);
  assert.deepEqual(result.calls, ['merge pr merge 7 --repo o/r --squash --delete-branch --match-head-commit abc']);
});

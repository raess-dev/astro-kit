import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const FILE = fileURLToPath(new URL('../../.github/workflows/kit.yml', import.meta.url));
const TEXT = readFileSync(FILE, 'utf8');

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
  steps: Step[];
}
interface Workflow {
  on: Record<string, { types?: string[]; branches?: string[] } | null>;
  permissions: Record<string, string>;
  env: Record<string, string>;
  jobs: Record<string, Job>;
}
const WORKFLOW = parse(TEXT) as Workflow;

const job = (id: string): Job => {
  const found = WORKFLOW.jobs[id];
  if (!found) throw new Error(`kit.yml has no job ${id}`);
  return found;
};

test('kit.yml has the triggers, the empty top-level permissions and the env of 11.1', () => {
  assert.deepEqual(WORKFLOW.on.pull_request?.types, ['opened', 'synchronize', 'reopened', 'ready_for_review']);
  assert.deepEqual(WORKFLOW.on.pull_request_review?.types, ['submitted']);
  assert.deepEqual(WORKFLOW.on.push?.branches, ['main']);
  assert.ok('schedule' in WORKFLOW.on);
  assert.ok('workflow_dispatch' in WORKFLOW.on);
  assert.deepEqual(WORKFLOW.permissions, {});
  assert.equal(WORKFLOW.env.ASTRO_TELEMETRY_DISABLED, '1');
  assert.equal(WORKFLOW.env.REPO, '$' + '{{ github.repository }}');
});

test('every job has a name, its own permissions and a timeout', () => {
  const names: Record<string, string> = {
    test: 'kit / test',
    scan: 'kit / scan',
    merge: 'kit / merge',
    'merge-approved': 'kit / merge after approval',
  };
  for (const [id, name] of Object.entries(names)) {
    const found = job(id);
    assert.equal(found.name, name);
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
  const lines = TEXT.split('\n').filter((line) => /^\s*-?\s*uses:/.test(line));
  assert.ok(lines.length >= 4);
  for (const line of lines) {
    assert.match(line, /uses: [\w.-]+\/[\w.-]+@[0-9a-f]{40} # v\d+\.\d+\.\d+$/, line.trim());
  }
});

test('every checkout drops its credentials, and setup-node reads .node-version', () => {
  const steps = Object.values(WORKFLOW.jobs).flatMap((found) => found.steps);
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

test('the test job runs the commands of 11.1 in order', () => {
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
});

test('merge needs the checks; merge-approved runs for an approval of a pull request into main only', () => {
  assert.deepEqual(job('merge').needs, ['test', 'scan']);
  assert.equal(job('merge-approved').needs, undefined);
  const condition = job('merge-approved').if ?? '';
  assert.match(condition, /github\.event\.review\.state == 'approved'/);
  assert.match(condition, /github\.event\.pull_request\.base\.ref == 'main'/);
  assert.equal(job('merge').steps[0]?.run, job('merge-approved').steps[0]?.run, 'both jobs run one script');
});

// ── the merge script, against a fake gh ─────────────────────────────────────

const SCRIPT = job('merge').steps[0]?.run ?? '';

/** A `gh` that answers from environment variables and records the calls that change something. */
const FAKE_GH = `#!/usr/bin/env bash
case "$1 $2" in
  "api repos/o/r/pulls/7") printf '%s\\n' "$FAKE_LIVE" ;;
  "api --paginate") printf '%s\\n' "$FAKE_FILES" ;;
  "pr merge") echo "merge $*" >> "$FAKE_LOG"; if [ "$FAKE_REFUSE" = 1 ]; then echo 'required status check is expected' >&2; exit 1; fi ;;
  "workflow run") echo "dispatch $*" >> "$FAKE_LOG" ;;
  *) echo "unexpected gh call: $*" >&2; exit 9 ;;
esac
`;

interface Case {
  state?: string;
  draft?: string;
  head?: string;
  base?: string;
  author?: string;
  files?: string[];
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
    const live = [c.state ?? 'open', c.draft ?? 'false', c.head ?? 'abc', c.base ?? 'build', c.author ?? 'kit-agent'];
    const env: Record<string, string> = {
      PATH: `${dir}:${process.env.PATH ?? ''}`,
      REPO: 'o/r',
      PR: '7',
      TESTED_SHA: 'abc',
      HEAD_REF: 'feature',
      GH_TOKEN: 'x',
      FAKE_LIVE: live.join('\t'),
      FAKE_FILES: (c.files ?? ['src/registry.ts']).join('\n'),
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
    ['a draft', { draft: 'true' }, /a draft waits for the owner/],
    ['another base', { base: 'release' }, /the base is release, not main or build/],
    ['a moved head', { head: 'def' }, /the head moved/],
    ['a foreign author', { author: 'someone' }, /someone is not an agent account/],
    ['the owner as author', { author: 'owner', agents: '["kit-agent"]' }, /owner is not an agent account/],
    ['no KIT_AGENTS variable', { agents: undefined }, /kit-agent is not an agent account/],
    ['an empty KIT_AGENTS variable', { agents: '' }, /kit-agent is not an agent account/],
    ['a workflow file', { files: ['src/a.ts', '.github/workflows/kit.yml'] }, /it changes a protected file/],
    ['the code-owner file', { files: ['.github/CODEOWNERS'] }, /it changes a protected file/],
    ['.npmrc', { files: ['.npmrc'] }, /it changes a protected file/],
    ['wrangler.jsonc', { files: ['wrangler.jsonc'] }, /it changes a protected file/],
    ['a nested wrangler file', { files: ['sub/wrangler.toml'] }, /it changes a protected file/],
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
    files: ['docs/wrangler-notes.md', 'src/npmrc.ts', 'templates/site/_npmrc', 'docs/.github.md'],
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

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { SPEC } from './spec.ts';

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

/** The text of one job of a workflow file: from its key to the next job key, or to the end of the file. */
const sliceJob = (text: string, id: string): string => {
  const lines = text.split('\n');
  const start = lines.indexOf(`  ${id}:`);
  if (start < 0) throw new Error(`the workflow text has no job ${id}`);
  const length = lines.slice(start + 1).findIndex((line) => /^ {2}[\w-]+:$/.test(line));
  return lines.slice(start, length < 0 ? undefined : start + 1 + length).join('\n');
};

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
  assert.deepEqual(Object.keys(KIT.workflow.jobs), ['test', 'acceptance', 'scan', 'merge']);
  assert.equal(job('test').if, undefined);
  assert.equal(job('acceptance').if, undefined);
  assert.equal(job('scan').if, undefined);
});

test('every job has a name, its own permissions and a timeout', () => {
  const names: Record<string, string> = {
    test: 'kit / test',
    acceptance: 'kit / acceptance',
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
  assert.deepEqual(job('acceptance').permissions, { contents: 'read' });
  assert.deepEqual(job('scan').permissions, { contents: 'read' });
  assert.equal(job('acceptance')['timeout-minutes'], 30);
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
  assert.ok(checkouts.length >= 3);
  assert.ok(nodes.length >= 2);
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

test('the acceptance job runs the suite of this checkout: one repository, no second checkout, no secret', () => {
  const found = job('acceptance');
  assert.equal(found.name, 'kit / acceptance');
  assert.equal(found.needs, undefined);
  assert.equal(found.if, undefined, 'it runs on every event that runs the test job');
  assert.equal(found.env, undefined);
  assert.deepEqual(
    found.steps.map((step) => step.uses?.replace(/@.*$/, '') ?? step.run),
    [
      'actions/checkout',
      'actions/setup-node',
      'npm ci --ignore-scripts --no-audit --no-fund',
      'npx --no playwright-core install --with-deps chromium',
      'npm run acceptance',
    ],
  );
  // The same pins as the test job (2.2).
  assert.deepEqual(
    found.steps.slice(0, 2).map((step) => step.uses),
    job('test')
      .steps.slice(0, 2)
      .map((step) => step.uses),
  );
  // The checkout reads this repository only, and it keeps no token.
  assert.deepEqual(found.steps[0]?.with, { 'persist-credentials': false });
  assert.deepEqual(found.steps[1]?.with, { 'node-version-file': '.node-version' });
  // Code of the test site runs in this job. So no step gets a secret, a token or a variable, and the harness packs
  // the kit itself: no step sets KIT_TARBALL.
  for (const step of found.steps) assert.equal(step.env, undefined, step.run ?? step.uses);
  const text = sliceJob(KIT.text, 'acceptance');
  assert.doesNotMatch(text, /secrets\.|github\.token|GH_TOKEN|GITHUB_TOKEN|vars\.|KIT_TARBALL|repository:|token:/);
  assert.doesNotMatch(text, /: write\b/);
});

test('merge needs the checks and a pull request of this repository; merge-approved needs an approval into main', () => {
  assert.deepEqual(job('merge').needs, ['test', 'scan', 'acceptance']);
  const condition = job('merge').if ?? '';
  assert.match(condition, /github\.event_name == 'pull_request'/);
  assert.match(condition, /github\.event\.pull_request\.head\.repo\.full_name == github\.repository/);
  const approved = job('merge-approved').if ?? '';
  assert.match(approved, /github\.event\.review\.state == 'approved'/);
  assert.match(approved, /github\.event\.pull_request\.base\.ref == 'main'/);
  assert.match(approved, /github\.event\.pull_request\.head\.repo\.full_name == github\.repository/);
  assert.equal(job('merge').steps[0]?.run, job('merge-approved').steps[0]?.run, 'both jobs run one script');
  // Both jobs give the script the same env (11.1). `release.yml` has no input, so the script passes no branch name.
  const env = {
    GH_TOKEN: expression('github.token'),
    KIT_AGENTS: expression('vars.KIT_AGENTS'),
    PR: expression('github.event.pull_request.number'),
    TESTED_SHA: expression('github.event.pull_request.head.sha'),
  };
  for (const id of ['merge', 'merge-approved']) assert.deepEqual(job(id).steps[0]?.env, env, id);
  assert.equal(SPEC.includes('its last line is `gh workflow run release.yml --repo "$REPO" --ref main`'), true);
  assert.equal(SPEC.includes('- **Trigger.** `workflow_dispatch` only, with no input.'), true);
  assert.equal(job('merge').steps[0]?.run?.trimEnd().split('\n').at(-1)?.endsWith('--ref main; fi'), true);
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
  assert.equal(result.calls[1], 'dispatch workflow run release.yml --repo o/r --ref main');
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
    ['.npmrc with other files', { files: ['src/a.ts', '.npmrc', 'test/site/.npmrc'] }, /it changes a protected file/],
    [
      'a workflow file that is renamed in its folder',
      { files: [{ filename: '.github/workflows/ci.yml', previous_filename: '.github/workflows/kit.yml' }] },
      /it changes a protected file/,
    ],
    [
      'a file that is moved into .github/',
      { files: [{ filename: '.github/workflows/extra.yml', previous_filename: 'docs/extra.yml' }] },
      /it changes a protected file/,
    ],
    [
      'the root .npmrc that is moved into the test site',
      { files: [{ filename: 'test/site/.npmrc', previous_filename: '.npmrc' }] },
      /it changes a protected file/,
    ],
    [
      'a file of the test site that is moved to the root .npmrc',
      { files: [{ filename: '.npmrc', previous_filename: 'test/site/.npmrc' }] },
      /it changes a protected file/,
    ],
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

test('the file rule covers the root only: the files of the test site and every wrangler file are merged', () => {
  // The kit repository deploys nothing, so a wrangler file is no protected file here. test/site/ is test data: its
  // .npmrc, its wrangler.jsonc and a .github folder in it never configure this repository.
  const cases: [string, NonNullable<Case['files']>][] = [
    ['the wrangler file of the test site', ['test/site/wrangler.jsonc']],
    ['the .npmrc of the test site', ['test/site/.npmrc']],
    ['both, with a source file', ['src/registry.ts', 'test/site/.npmrc', 'test/site/wrangler.jsonc']],
    ['a wrangler file at the root', ['wrangler.jsonc']],
    ['a nested wrangler file', ['sub/wrangler.toml', 'templates/site/wrangler.jsonc']],
    ['the wrangler module of the suite', ['test/acceptance/wrangler.ts']],
    ['a .github folder that is not at the root', ['test/site/.github/workflows/site.yml', 'templates/.github/x.yml']],
    [
      'a wrangler file of the test site that is renamed',
      [{ filename: 'test/site/wrangler.json', previous_filename: 'test/site/wrangler.jsonc' }],
    ],
    [
      'an .npmrc of the test site that is moved in the test folder',
      [{ filename: 'test/acceptance/.npmrc', previous_filename: 'test/site/.npmrc' }],
    ],
  ];
  for (const [name, files] of cases) {
    const result = merge({ files });
    assert.equal(result.status, 0, `${name}: ${result.out}`);
    assert.deepEqual(
      result.calls,
      ['merge pr merge 7 --repo o/r --squash --delete-branch --match-head-commit abc'],
      `${name}: ${result.out}`,
    );
  }
});

test('both workflow files hold the file rule of the kit repository', () => {
  for (const { text } of FILES) {
    const rules = text.split('\n').filter((line) => line.includes('grep -qE'));
    assert.deepEqual(
      rules.map((line) => line.trim()),
      [String.raw`if grep -qE '^\.github/|^\.npmrc$' <<<"$files"; then`],
    );
    assert.match(text, /\.filename, \(\.previous_filename \/\/ empty\)/);
  }
});

test('when GitHub refuses the merge, the script ends with success and dispatches nothing', () => {
  const result = merge({ base: 'main', refuse: true });
  assert.equal(result.status, 0, result.out);
  assert.match(result.out, /GitHub refused the merge: required status check is expected/);
  assert.deepEqual(result.calls, ['merge pr merge 7 --repo o/r --squash --delete-branch --match-head-commit abc']);
});

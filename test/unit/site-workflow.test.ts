/**
 * The site workflows of 10.1, the Dependabot file of 10.5, the code owners and the rulesets of 10.2, and the protected
 * task of 10.6. The YAML parses; every `uses` is pinned; the jobs, their names, order, permissions
 * and timeouts are those of the job table; the only required context is `site / ci`. The scripts that the
 * specification gives exactly equal its blocks, and the scripts of the workflow run under bash with a fake `gh`,
 * `npx`, `npm` and `sleep` first on the path (14.1). No test reaches GitHub, npm or Cloudflare.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { renderWrangler } from '../../src/hosts/cloudflare.ts';
import {
  CODEOWNERS_FILE,
  DEPENDABOT_FILE,
  renderCodeOwners,
  renderDependabot,
  renderSiteMergeWorkflow,
  renderSiteWorkflow,
  SITE_MERGE_FILE,
  SITE_WORKFLOW_FILE,
} from '../../src/shims.ts';
import { SETTINGS as FORMS } from './forms-fixtures.ts';
import { optionsOf } from './project-fixtures.ts';
import { github, issueOf } from './site-scripts.ts';
import { SPEC, specBlock } from './spec.ts';

interface Step {
  name?: string;
  id?: string;
  if?: string;
  uses?: string;
  run?: string;
  with?: Record<string, unknown>;
  env?: Record<string, string>;
}
interface Job {
  name?: string;
  needs?: string | string[];
  if?: string;
  'timeout-minutes'?: number;
  permissions?: Record<string, string>;
  environment?: string | { name: string; url?: string };
  concurrency?: { group: string; 'cancel-in-progress'?: boolean };
  outputs?: Record<string, string>;
  env?: Record<string, string>;
  steps: Step[];
}
interface Workflow {
  name: string;
  on: Record<string, unknown>;
  permissions: Record<string, string>;
  concurrency: { group: string; 'cancel-in-progress'?: unknown };
  env: Record<string, string>;
  jobs: Record<string, Job>;
}

const TEMPLATES = fileURLToPath(new URL('../../templates/', import.meta.url));
const SITE_TEXT = renderSiteWorkflow();
const MERGE_TEXT = renderSiteMergeWorkflow();
const SITE = parse(SITE_TEXT) as Workflow;
const MERGE = parse(MERGE_TEXT) as Workflow;
const HEADER =
  '# Managed by @raess/astro-kit. A protected file: the kit renders it, and only the protected task changes it.';
const expression = (name: string): string => `\${{ ${name} }}`;

const job = (id: string): Job => {
  const found = SITE.jobs[id] ?? MERGE.jobs[id];
  if (!found) throw new Error(`the site workflows have no job ${id}`);
  return found;
};
const step = (id: string, name: string): Step => {
  const found = job(id).steps.find((entry) => entry.name === name);
  if (!found) throw new Error(`the job ${id} has no step ${name}`);
  return found;
};
const runOf = (id: string, name: string): string => step(id, name).run ?? '';

// The files

test('the workflow files and dependabot.yml parse, and the workflows start with the line of 10.1', () => {
  assert.equal(SITE_TEXT.split('\n')[0], HEADER);
  assert.equal(MERGE_TEXT.split('\n')[0], HEADER);
  assert.equal(SITE.name, 'site');
  assert.equal(typeof parse(renderDependabot()), 'object');
  assert.equal(SITE_TEXT.endsWith('\n') && !SITE_TEXT.endsWith('\n\n'), true);
  // The file has no template variable: every site gets the same text (10.1).
  assert.doesNotMatch(SITE_TEXT, /(?<!\$)\{\{/);
  assert.doesNotMatch(MERGE_TEXT, /(?<!\$)\{\{/);
  assert.equal(readFileSync(join(TEMPLATES, 'site/_github/workflows/site.yml'), 'utf8'), SITE_TEXT);
});

test('the Dependabot file equals the text of 10.5', () => {
  assert.equal(renderDependabot(), `${specBlock('### 10.5 Dependabot', 'yaml')}\n`);
  assert.equal(readFileSync(join(TEMPLATES, 'site/_github/dependabot.yml'), 'utf8'), renderDependabot());
});

test('CODEOWNERS is the text of 10.2 with the code owner, for every owner file of 4.2', () => {
  const block = specBlock('**`.github/CODEOWNERS`**', 'text');
  assert.equal(readFileSync(join(TEMPLATES, 'site/_github/CODEOWNERS.tmpl'), 'utf8'), `${block}\n`);
  assert.equal(renderCodeOwners('@team/owners'), `${block.replaceAll('{{OWNER}}', '@team/owners')}\n`);
  assert.equal(renderCodeOwners('@o').includes('{{'), false);
  assert.deepEqual(
    [CODEOWNERS_FILE, DEPENDABOT_FILE, SITE_WORKFLOW_FILE, SITE_MERGE_FILE],
    ['.github/CODEOWNERS', '.github/dependabot.yml', '.github/workflows/site.yml', '.github/workflows/site-merge.yml'],
  );
});

// The header

test('site.yml has the triggers, the empty permissions, the concurrency and the env of 10.1', () => {
  assert.deepEqual(Object.keys(SITE.on), ['push', 'workflow_dispatch', 'schedule']);
  assert.deepEqual(SITE.on.push, { branches: ['**'] });
  const dispatch = SITE.on.workflow_dispatch as { inputs: Record<string, { type: string; default: unknown }> };
  assert.deepEqual(Object.keys(dispatch.inputs), ['protected', 'branch']);
  assert.equal(dispatch.inputs.protected?.type, 'boolean');
  assert.equal(dispatch.inputs.protected?.default, false);
  assert.equal(dispatch.inputs.branch?.type, 'string');
  assert.equal(dispatch.inputs.branch?.default, '');
  assert.deepEqual(SITE.on.schedule, [{ cron: '23 4 * * *' }, { cron: '47 3 * * 1' }]);
  assert.deepEqual(SITE.permissions, {});
  assert.equal(
    SITE.concurrency.group,
    `site-${expression("github.event_name == 'schedule' && 'schedule' || inputs.protected && 'protected' || 'run'")}-${expression('github.ref')}`,
  );
  assert.equal(SPEC.includes(`- Concurrency \`${SITE.concurrency.group}\`, with `), true);
  assert.equal(
    SITE.concurrency['cancel-in-progress'],
    expression("github.event_name == 'push' && github.ref != 'refs/heads/main'"),
  );
  assert.deepEqual(SITE.env, {
    ASTRO_TELEMETRY_DISABLED: '1',
    SHA: expression('github.sha'),
    REPO: expression('github.repository'),
    RUN: `${expression('github.server_url')}/${expression('github.repository')}/actions/runs/${expression('github.run_id')}`,
  });
});

test('site-merge.yml holds the one job merge-event, on the pull-request events of 10.1', () => {
  assert.deepEqual(MERGE.on, {
    pull_request: { types: ['opened', 'reopened', 'ready_for_review'] },
    pull_request_review: { types: ['submitted'] },
  });
  assert.deepEqual(MERGE.permissions, {});
  assert.deepEqual(MERGE.env, { REPO: expression('github.repository') });
  assert.deepEqual(MERGE.concurrency, { group: `site-merge-${expression('github.event.pull_request.number')}` });
  assert.deepEqual(Object.keys(MERGE.jobs), ['merge-event']);
  const condition = job('merge-event').if ?? '';
  assert.match(condition, /github\.event_name == 'pull_request' \|\| github\.event\.review\.state == 'approved'/);
  assert.match(condition, /github\.event\.pull_request\.head\.repo\.full_name == github\.repository/);
});

// The jobs

/** The rows of the job table of 10.1, parsed from docs/spec.md: id, name, permissions and timeout. */
function jobTable(): { id: string; name: string | undefined; permissions: Record<string, string>; minutes: number }[] {
  const start = SPEC.indexOf('| Job | Name | When | Permissions | Steps |');
  const rows = SPEC.slice(start).split('\n').slice(2);
  return rows
    .slice(
      0,
      rows.findIndex((row) => !row.startsWith('|')),
    )
    .map((row) => {
      const cells = row
        .split(/(?<!\\)\|/)
        .slice(1, -1)
        .map((cell) => cell.trim());
      const parts = (cells[3] ?? '').split(';').map((part) => part.trim());
      const permissions = Object.fromEntries(
        (parts[0] ?? '').split(',').map((entry) => {
          const [scope = '', level = ''] = entry.trim().split(' ');
          return [scope, level];
        }),
      );
      return {
        id: /^`([\w-]+)`/.exec(cells[0] ?? '')?.[1] ?? '',
        name: /^`([^`]+)`/.exec(cells[1] ?? '')?.[1],
        permissions,
        minutes: Number(/(\d+) min/.exec(cells[3] ?? '')?.[1]),
      };
    });
}

test('the jobs come in the order of 10.1, with the names, permissions and timeouts of its job table', () => {
  const table = jobTable();
  const ids = table.map((row) => row.id).filter((id) => id !== 'merge-event');
  assert.deepEqual(Object.keys(SITE.jobs), ids);
  assert.equal(SPEC.includes(`- Job order: \`${ids.join(', ')}\`.`), true);
  assert.equal(table.length, 11, 'the ten jobs of site.yml and merge-event');
  for (const row of table) {
    assert.equal(job(row.id).name, row.name, row.id);
    assert.deepEqual(job(row.id).permissions, row.permissions, row.id);
    assert.equal(job(row.id)['timeout-minutes'], row.minutes, row.id);
  }
});

test('the conditions, needs and environments of the job table', () => {
  assert.equal(job('ci').if, "github.event_name == 'push' && github.ref != 'refs/heads/main'");
  assert.deepEqual(job('ci').env, { BASE_REF: 'main' });
  assert.equal(job('preview').needs, 'ci');
  assert.equal(job('preview').if, "github.actor != 'dependabot[bot]'");
  assert.deepEqual(job('preview').environment, { name: 'preview', url: expression('steps.upload.outputs.url') });
  assert.equal(job('merge').needs, 'ci');
  assert.match(job('build').if ?? '', /^github\.ref == 'refs\/heads\/main' &&/);
  assert.match(job('build').if ?? '', /github\.event_name == 'workflow_dispatch' && !inputs\.protected/);
  assert.deepEqual(job('build').env, { BASE_REF: 'main' });
  assert.equal(job('build-alert').if, "always() && needs.build.result != 'skipped'");
  assert.equal(job('deploy').needs, 'build');
  assert.equal(job('deploy').environment, 'production');
  assert.deepEqual(job('deploy').concurrency, { group: 'deploy-production', 'cancel-in-progress': false });
  assert.deepEqual(Object.keys(job('deploy').outputs ?? {}), ['deployed', 'live']);
  assert.equal(job('feedback').needs, 'ci');
  assert.equal(
    job('smoke').if,
    "always() && (github.event_name == 'schedule' || (needs.deploy.result == 'success' && needs.deploy.outputs.deployed == 'true'))",
  );
  assert.deepEqual(job('rollback').needs, ['deploy', 'smoke']);
  assert.equal(
    job('rollback').if,
    "always() && needs.deploy.outputs.deployed == 'true' && needs.smoke.result == 'failure'",
  );
  assert.equal(job('rollback').environment, 'production');
  assert.equal(job('feedback').if, "github.event_name == 'push' && github.actor != 'dependabot[bot]'");
  assert.equal(job('protected').environment, 'owner');
  assert.match(
    job('protected').if ?? '',
    /github\.event_name == 'workflow_dispatch' && github\.ref == 'refs\/heads\/main'/,
  );
  assert.match(job('protected').if ?? '', /inputs\.protected && github\.actor == vars\.KIT_OWNER/);
});

test('the only required context is site / ci: one job has the name, and no pull-request workflow holds it', () => {
  const rulesets = JSON.parse(readFileSync(join(TEMPLATES, 'github-org-rulesets.json'), 'utf8')) as {
    rulesets: { name: string; target: string; rules: { type: string; parameters?: Record<string, unknown> }[] }[];
  };
  const checks = rulesets.rulesets.flatMap((ruleset) =>
    ruleset.rules.filter((rule) => rule.type === 'required_status_checks'),
  );
  assert.deepEqual(
    checks.map((rule) => rule.parameters),
    [
      {
        strict_required_status_checks_policy: false,
        do_not_enforce_on_create: false,
        required_status_checks: [{ context: 'site / ci', integration_id: 15368 }],
      },
    ],
  );
  const named = [...Object.values(SITE.jobs), ...Object.values(MERGE.jobs)].filter(
    (entry) => entry.name === 'site / ci',
  );
  assert.equal(named.length, 1);
  assert.equal(SITE.jobs.ci?.name, 'site / ci');
  // A skipped job counts as a passed check, so site-merge.yml, which runs on pull-request events, names no job.
  for (const entry of Object.values(MERGE.jobs)) assert.equal(entry.name, undefined);
  assert.equal('pull_request' in SITE.on || 'pull_request_review' in SITE.on, false);
});

test('the rulesets of 10.2: the main branch and the protected paths, for the sites with kit-site=true', () => {
  const { rulesets } = JSON.parse(readFileSync(join(TEMPLATES, 'github-org-rulesets.json'), 'utf8')) as {
    rulesets: {
      name: string;
      target: string;
      bypass_actors: unknown[];
      conditions: Record<string, unknown>;
      rules: { type: string; parameters?: Record<string, unknown> }[];
    }[];
  };
  assert.deepEqual(
    rulesets.map((ruleset) => [ruleset.name, ruleset.target]),
    [
      ['kit-site: main', 'branch'],
      ['kit-site: protected paths', 'push'],
    ],
  );
  const [main, paths] = rulesets;
  assert.deepEqual(main?.bypass_actors, []);
  assert.deepEqual(main?.conditions.ref_name, { include: ['~DEFAULT_BRANCH'], exclude: [] });
  assert.deepEqual(
    main?.rules.map((rule) => rule.type),
    ['deletion', 'non_fast_forward', 'pull_request', 'required_status_checks'],
  );
  assert.deepEqual(main?.rules[2]?.parameters, {
    required_approving_review_count: 0,
    require_code_owner_review: true,
    dismiss_stale_reviews_on_push: true,
    require_last_push_approval: false,
    required_review_thread_resolution: false,
    allowed_merge_methods: ['squash'],
  });
  assert.deepEqual(paths?.bypass_actors, [
    { actor_id: 1, actor_type: 'OrganizationAdmin', bypass_mode: 'always' },
    { actor_type: 'DeployKey', bypass_mode: 'always' },
  ]);
  assert.deepEqual(paths?.rules, [
    {
      type: 'file_path_restriction',
      parameters: {
        restricted_file_paths: [
          '.github/**',
          'wrangler.*',
          '**/wrangler.*',
          '.npmrc',
          '.env*',
          '**/.env*',
          '.dev.vars*',
          '**/.dev.vars*',
          '.wrangler/**',
          '**/.wrangler/**',
        ],
      },
    },
  ]);
  for (const ruleset of rulesets) {
    assert.deepEqual(ruleset.conditions.repository_property, {
      include: [{ name: 'kit-site', source: 'custom', property_values: ['true'] }],
      exclude: [],
    });
  }
});

// The pins and the checkouts

/** The pins of 2.2, by action. */
function specPins(): Map<string, string> {
  const start = SPEC.indexOf('### 2.2 Pinned GitHub Actions');
  const table = SPEC.slice(start, SPEC.indexOf('\n---', start));
  return new Map(
    [...table.matchAll(/^\| `([\w-]+\/[\w-]+)` \| `([0-9a-f]{40} # v\d+\.\d+\.\d+)`/gm)].map((match) => [
      match[1] ?? '',
      match[2] ?? '',
    ]),
  );
}

test('every uses is pinned to a commit with its version, and the pin is the one of 2.2', () => {
  const pins = specPins();
  const lines = [SITE_TEXT, MERGE_TEXT]
    .flatMap((text) => text.split('\n'))
    .filter((line) => /^\s*-?\s*uses:/.test(line));
  assert.ok(lines.length >= 20);
  for (const line of lines) {
    const match = /uses: (actions\/[\w.-]+)@([0-9a-f]{40} # v\d+\.\d+\.\d+)$/.exec(line);
    assert.ok(match, line.trim());
    assert.equal(pins.get(match[1] ?? ''), match[2], line.trim());
  }
});

const allSteps = (): { id: string; step: Step }[] =>
  Object.entries({ ...SITE.jobs, ...MERGE.jobs }).flatMap(([id, found]) =>
    found.steps.map((entry) => ({ id, step: entry })),
  );

test('every checkout drops its credentials but the one of the protected task, and setup-node reads .node-version', () => {
  const checkouts = allSteps().filter(({ step: entry }) => entry.uses?.startsWith('actions/checkout@'));
  assert.equal(checkouts.length, 8);
  for (const { id, step: entry } of checkouts) {
    assert.equal(entry.with?.['persist-credentials'], id === 'protected', id);
    // fetch-depth 0 brings origin/main, which kit-identity.sh needs in CI (10.3).
    assert.equal(entry.with?.['fetch-depth'], 0, id);
  }
  assert.equal(SITE_TEXT.split('\n').filter((line) => line.trim() === 'persist-credentials: true').length, 1);
  assert.deepEqual(job('preview').steps[0]?.with, { ref: 'main', 'fetch-depth': 0, 'persist-credentials': false });
  assert.deepEqual(job('protected').steps[1]?.with, {
    ref: expression("inputs.branch || 'main'"),
    'ssh-key': expression('secrets.KIT_PROTECTED_KEY'),
    'fetch-depth': 0,
    'persist-credentials': true,
  });
  const nodes = allSteps().filter(({ step: entry }) => entry.uses?.startsWith('actions/setup-node@'));
  assert.equal(nodes.length, 8);
  for (const { id, step: entry } of nodes) assert.deepEqual(entry.with, { 'node-version-file': '.node-version' }, id);
});

test('no run script holds an expression, and a secret is only in the env of the step that needs it', () => {
  for (const { id, step: entry } of allSteps()) {
    assert.equal(entry.run?.includes('${{'), entry.run === undefined ? undefined : false, `${id}: ${entry.name}`);
  }
  const secretSteps = allSteps().flatMap(({ id, step: entry }) =>
    Object.entries(entry.env ?? {})
      .filter(([, value]) => value.includes('secrets.'))
      .map(([key]) => `${id}/${entry.name}/${key}`),
  );
  assert.deepEqual(secretSteps, [
    'preview/Upload the preview version/CLOUDFLARE_API_TOKEN',
    'deploy/The live version/CLOUDFLARE_API_TOKEN',
    'deploy/Upload the version/CLOUDFLARE_API_TOKEN',
    'deploy/Deploy the version/CLOUDFLARE_API_TOKEN',
    'smoke/Smoke/KIT_PROBE_SECRET',
    'rollback/Roll production back/CLOUDFLARE_API_TOKEN',
    'feedback/The feedback token/HAS_TOKEN',
    'feedback/Send the feedback/KIT_FEEDBACK_TOKEN',
    'feedback/Send the feedback/KIT_FEEDBACK_AUTO_KEY',
  ]);
  // The only other secret is the deploy key of the protected checkout; no job env and no workflow env holds one.
  const others = [SITE_TEXT, MERGE_TEXT]
    .flatMap((text) => text.split('\n'))
    .filter((line) => line.includes('secrets.') && !/^\s+[A-Z_]+: \$\{\{ secrets\.[A-Z_]+( != '')? \}\}$/.test(line));
  assert.deepEqual(
    others.map((line) => line.trim()),
    [`ssh-key: ${expression('secrets.KIT_PROTECTED_KEY')}`],
  );
  for (const found of Object.values({ ...SITE.jobs, ...MERGE.jobs })) {
    assert.doesNotMatch(JSON.stringify(found.env ?? {}), /secrets\.|github\.token/);
  }
  // ci and build run project code: no token, no secret, no variable.
  for (const id of ['ci', 'build']) assert.doesNotMatch(JSON.stringify(job(id)), /secrets\.|github\.token|vars\./, id);
  // Every step that calls gh gets the token through its env (10.1).
  const callers = allSteps().filter(({ step: entry }) => /\bgh (api|issue|pr|workflow)\b/.test(entry.run ?? ''));
  assert.ok(callers.length >= 9);
  for (const { id, step: entry } of callers) {
    assert.equal(entry.env?.GH_TOKEN, expression('github.token'), `${id}: ${entry.name}`);
  }
});

// The install steps

const IDENTITY = 'bash .github/kit-identity.sh';
const INSTALL = [
  'c=$(mktemp -d)',
  'st=0',
  'npm ci --ignore-scripts --no-audit --no-fund --registry=https://registry.npmjs.org/ --replace-registry-host=never --strict-ssl=true --cache "$c" || st=$?',
  'rm -rf "$c"',
  'exit "$st"',
  '',
].join('\n');
const TREE = 'npm ls --all > /dev/null';

test('every job that installs runs the three install steps of 10.1 in order, after the checkout and setup-node', () => {
  const installers = Object.entries({ ...SITE.jobs, ...MERGE.jobs }).filter(([, found]) =>
    found.steps.some((entry) => entry.run === IDENTITY),
  );
  assert.deepEqual(
    installers.map(([id]) => id),
    ['ci', 'preview', 'build', 'deploy', 'smoke', 'rollback', 'feedback', 'protected'],
  );
  for (const [id, found] of installers) {
    const at = found.steps.findIndex((entry) => entry.run === IDENTITY);
    assert.equal(found.steps[at - 2]?.uses?.startsWith('actions/checkout@'), true, id);
    assert.equal(found.steps[at - 1]?.uses?.startsWith('actions/setup-node@'), true, id);
    if (id === 'protected') continue;
    assert.equal(found.steps[at + 1]?.run, INSTALL, id);
    assert.equal(found.steps[at + 2]?.run, TREE, id);
    assert.equal(found.steps.filter((entry) => entry.run?.includes('npm ci')).length, 1, id);
  }
  // The install line of 10.3 is the line of the steps.
  assert.equal(
    SPEC.includes(
      '`npm ci --ignore-scripts --no-audit --no-fund --registry=https://registry.npmjs.org/ --replace-registry-host=never --strict-ssl=true --cache "$c"`',
    ),
    true,
  );
  // The protected task installs only the kit, outside the checkout, with the same flags and a fresh cache (10.6).
  const kit = runOf('protected', 'Install only the kit, outside the checkout');
  assert.match(
    kit,
    /npm install --prefix "\$RUNNER_TEMP\/kit" --ignore-scripts --no-audit --no-fund --registry=https:\/\/registry\.npmjs\.org\/ --replace-registry-host=never --strict-ssl=true --cache "\$c" --save-exact "@raess\/astro-kit@\$version"/,
  );
  assert.doesNotMatch(JSON.stringify(job('protected')), /npm ci/);
});

/** A folder with fake bins first on the path. Each bin is a bash script. */
function withBins<T>(bins: Record<string, string>, use: (dir: string, env: Record<string, string>) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'astro-kit-site-'));
  try {
    const bin = join(dir, 'bin');
    mkdirSync(bin);
    for (const [name, text] of Object.entries(bins)) {
      writeFileSync(join(bin, name), `#!/usr/bin/env bash\n${text}`);
      chmodSync(join(bin, name), 0o755);
    }
    const work = join(dir, 'work');
    mkdirSync(work);
    const env: Record<string, string> = {
      PATH: `${bin}:${process.env.PATH ?? ''}`,
      HOME: dir,
      LOG: join(dir, 'calls.log'),
      GITHUB_OUTPUT: join(dir, 'output'),
      TMPDIR: dir,
      RUNNER_TEMP: dir,
    };
    return use(work, env);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const bash = (script: string, cwd: string, env: Record<string, string>) =>
  spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', '-c', script], { cwd, env, encoding: 'utf8' });
const lines = (path: string): string[] => (existsSync(path) ? readFileSync(path, 'utf8').trim().split('\n') : []);

for (const status of [0, 1]) {
  test(`the install step runs npm ci with a fresh, empty cache and removes it, when npm ci exits ${status}`, () => {
    const npm = `c=''; for a in "$@"; do [ -n "$next" ] && c=$a; next=; [ "$a" = --cache ] && next=1; done
echo "$* | empty=$([ -d "$c" ] && [ -z "$(ls -A "$c")" ] && echo yes)" >> "$LOG"; echo "$c" >> "$LOG.cache"
touch "$c/x"; exit ${status}
`;
    withBins({ npm }, (work, env) => {
      const result = bash(INSTALL, work, env);
      assert.equal(result.status, status, result.stderr);
      const [call] = lines(env.LOG ?? '');
      assert.match(
        call ?? '',
        /^ci --ignore-scripts --no-audit --no-fund --registry=https:\/\/registry\.npmjs\.org\/ --replace-registry-host=never --strict-ssl=true --cache \S+ \| empty=yes$/,
      );
      const [cache] = lines(`${env.LOG}.cache`);
      assert.equal(existsSync(cache ?? ''), false, 'the cache folder is removed');
    });
  });
}

// The merge script (10.1)

const MERGE_SCRIPT = specBlock('**Merge script**', 'sh');

test('both merge jobs run the exact merge script of 10.1 with the env of the job table', () => {
  assert.equal(runOf('merge', 'Merge the tested head'), `${MERGE_SCRIPT}\n`);
  assert.equal(runOf('merge-event', 'Merge the tested head'), `${MERGE_SCRIPT}\n`);
  assert.deepEqual(step('merge', 'Merge the tested head').env, {
    GH_TOKEN: expression('github.token'),
    KIT_AGENTS: expression('vars.KIT_AGENTS'),
    BRANCH: expression('github.ref_name'),
    TESTED_SHA: expression('github.sha'),
    ACTOR: expression('github.actor'),
  });
  assert.deepEqual(step('merge-event', 'Merge the tested head').env, {
    GH_TOKEN: expression('github.token'),
    KIT_AGENTS: expression('vars.KIT_AGENTS'),
    PR: expression('github.event.pull_request.number'),
    TESTED_SHA: expression('github.event.pull_request.head.sha'),
  });
  // REPO, the third variable of every workflow that runs the script, is in the env of both workflows.
  assert.equal(SITE.env.REPO, expression('github.repository'));
  assert.equal(MERGE.env.REPO, expression('github.repository'));
});

/** A `gh` that answers from JSON in the environment, applies `--jq` with the real jq, and logs what changes. */
const FAKE_GH = `program=''
for ((i = 1; i <= $#; i++)); do
  if [ "\${!i}" = --jq ]; then j=$((i + 1)); program="\${!j}"; fi
done
case "$1 $2" in
  "api repos/o/r/pulls?state=open&head=o:"*) echo "lookup $2" >> "$LOG"; jq -r "$program" <<<"$FAKE_LIST" ;;
  "api repos/o/r/pulls/7") jq -r "$program" <<<"$FAKE_PULL" ;;
  "api --paginate")
    case "$3" in
      repos/o/r/pulls/7/files) jq -r "$program" <<<"$FAKE_FILES" ;;
      repos/o/r/pulls/7/commits) jq -r "$program" <<<"$FAKE_COMMITS" ;;
      *) exit 9 ;;
    esac ;;
  "api repos/o/r/actions/workflows/site.yml/runs?event=push&head_sha=abc") jq -r "$program" <<<"$FAKE_RUNS" ;;
  "api repos/o/r/issues?state=open&per_page=100")
    n=$(($(cat "$LOG.count" 2>/dev/null || echo 0) + 1)); echo "$n" > "$LOG.count"
    issues=$(sed -n "\${n}p" <<<"$FAKE_ISSUES"); [ -n "$issues" ] || issues=$(tail -n 1 <<<"$FAKE_ISSUES")
    jq -r "$program" <<<"$issues" ;;
  "pr merge") echo "merge $*" >> "$LOG"; if [ "$FAKE_REFUSE" = 1 ]; then echo 'required status check "site / ci" is expected' >&2; exit 1; fi ;;
  "workflow run") echo "dispatch $*" >> "$LOG" ;;
  "issue comment"|"issue create"|"issue close") echo "$*" >> "$LOG" ;;
  *) echo "unexpected gh call: $*" >&2; exit 9 ;;
esac
`;

interface Pull {
  state?: string;
  draft?: boolean;
  head?: string;
  base?: string;
  author?: string;
  files?: (string | { filename: string; previous_filename: string })[];
  refuse?: boolean;
  pr?: string;
  list?: unknown[];
}

function merge(c: Pull): { status: number | null; out: string; calls: string[] } {
  return withBins({ gh: FAKE_GH }, (work, env) => {
    const pull = {
      state: c.state ?? 'open',
      draft: c.draft ?? false,
      head: { sha: c.head ?? 'abc' },
      base: { ref: c.base ?? 'main' },
      user: { login: c.author ?? 'site-agent' },
    };
    const files = (c.files ?? ['src/pages/index.astro']).map((file) =>
      typeof file === 'string' ? { filename: file } : file,
    );
    const result = bash(MERGE_SCRIPT, work, {
      ...env,
      REPO: 'o/r',
      ...(c.pr === undefined ? { BRANCH: 'agent/x' } : { PR: c.pr }),
      TESTED_SHA: 'abc',
      GH_TOKEN: 'x',
      KIT_AGENTS: '["site-agent"]',
      FAKE_LIST: JSON.stringify(c.list ?? [{ number: 7 }]),
      FAKE_PULL: JSON.stringify(pull),
      FAKE_FILES: JSON.stringify(files),
      FAKE_COMMITS: JSON.stringify([{ author: { login: pull.user.login } }]),
      FAKE_RUNS: JSON.stringify({ workflow_runs: [{ actor: { login: pull.user.login } }] }),
      FAKE_REFUSE: c.refuse ? '1' : '0',
    });
    return { status: result.status, out: `${result.stdout}${result.stderr}`, calls: lines(env.LOG ?? '') };
  });
}

const MERGED = 'merge pr merge 7 --repo o/r --squash --delete-branch --match-head-commit abc';
const DISPATCHED = 'dispatch workflow run site.yml --repo o/r --ref main';

test('the merge script merges a green agent pull request of the branch, and dispatches the deploy', () => {
  const result = merge({});
  assert.equal(result.status, 0, result.out);
  assert.deepEqual(result.calls, ['lookup repos/o/r/pulls?state=open&head=o:agent/x', MERGED, DISPATCHED]);
  const event = merge({ pr: '7' });
  assert.equal(event.status, 0, event.out);
  assert.deepEqual(event.calls, [MERGED, DISPATCHED], 'merge-event looks no pull request up');
  const dependabot = merge({ pr: '7', author: 'dependabot[bot]', files: ['package.json', 'package-lock.json'] });
  assert.deepEqual(dependabot.calls, [MERGED, DISPATCHED], dependabot.out);
});

test('the merge script leaves a branch without a pull request, and every pull request that it must not merge', () => {
  const cases: [string, Pull, RegExp][] = [
    ['a branch without a pull request', { list: [] }, /this branch has no open pull request yet/],
    ['a closed pull request', { state: 'closed' }, /the pull request is closed/],
    ['a draft', { draft: true }, /a draft waits for the owner/],
    ['another base', { base: 'build' }, /the base is build, not main/],
    ['a moved head', { head: 'def' }, /the head moved since this run started/],
    ['a foreign author', { author: 'someone' }, /someone is not an agent account/],
    ['a workflow file', { files: ['src/a.ts', '.github/workflows/site.yml'] }, /it changes a protected file/],
    ['kit-identity.sh', { files: ['.github/kit-identity.sh'] }, /it changes a protected file/],
    ['the code owners', { files: ['.github/CODEOWNERS'] }, /it changes a protected file/],
    ['.npmrc', { files: ['.npmrc'] }, /it changes a protected file/],
    ['wrangler.jsonc', { files: ['wrangler.jsonc'] }, /it changes a protected file/],
    ['a nested wrangler file', { files: ['sub/wrangler.toml'] }, /it changes a protected file/],
    [
      'a protected file that is moved away',
      { files: [{ filename: 'docs/old-wrangler.txt', previous_filename: 'wrangler.jsonc' }] },
      /it changes a protected file/,
    ],
  ];
  for (const [name, c, message] of cases) {
    const result = merge(c);
    assert.equal(result.status, 0, `${name}: ${result.out}`);
    assert.match(result.out, message, name);
    assert.deepEqual(
      result.calls.filter((call) => !call.startsWith('lookup ')),
      [],
      name,
    );
  }
});

test('the file rule reads whole names: a file that only resembles a protected one is merged', () => {
  const result = merge({ files: ['docs/wrangler-notes.md', 'src/npmrc.ts', 'docs/.github.md', 'src/wrangler/x.ts'] });
  assert.equal(result.status, 0, result.out);
  assert.equal(result.calls.includes(MERGED), true, result.out);
});

test('when GitHub refuses the merge, the script prints the refusal, ends with success and dispatches nothing', () => {
  const result = merge({ refuse: true });
  assert.equal(result.status, 0, result.out);
  assert.match(result.out, /GitHub refused the merge: required status check "site \/ ci" is expected/);
  assert.match(result.out, /A required check is not green yet, or an owner file waits for the approval of the owner\./);
  assert.equal(result.calls.includes(DISPATCHED), false);
});

// The alert and close steps

const ALERT = specBlock('**Alert step**', 'sh');
const CLOSE = specBlock('**Close step**', 'sh');

test('the alert and close steps are the exact scripts of 10.1, with the three titles', () => {
  const alerts: [string, string][] = [
    ['build-alert', 'main: build failed'],
    ['smoke', 'smoke: production'],
    ['rollback', 'rollback: production'],
  ];
  for (const [id, title] of alerts) {
    assert.equal(runOf(id, 'Alert'), `${ALERT}\n`, id);
    const env = step(id, 'Alert').env ?? {};
    assert.equal(env.TITLE, title, id);
    assert.equal(env.GH_TOKEN, expression('github.token'), id);
    assert.equal(env.KIT_OWNER, expression('vars.KIT_OWNER'), id);
  }
  assert.equal(step('build-alert', 'Alert').env?.BODY, 'Failed:');
  assert.equal(step('smoke', 'Alert').env?.BODY, 'Failed:');
  assert.equal(
    step('rollback', 'Alert').env?.BODY,
    `Smoke failed after the deploy of ${expression('github.sha')}. Production runs the version before it again.`,
  );
  for (const id of ['build-alert', 'smoke']) {
    assert.equal(runOf(id, 'Close'), `${CLOSE}\n`, id);
    assert.equal(step(id, 'Close').env?.TITLE, step(id, 'Alert').env?.TITLE, id);
  }
  assert.equal(step('build-alert', 'Close').env?.COMMENT, `Fixed by ${expression('github.sha')}`);
  assert.match(step('smoke', 'Close').env?.COMMENT ?? '', /^Passed: \$\{\{ github\.server_url \}\}\//);
  assert.equal(step('build-alert', 'Alert').if, "needs.build.result == 'failure'");
  assert.equal(step('build-alert', 'Close').if, "needs.build.result == 'success'");
  assert.equal(step('smoke', 'Alert').if, "failure() && github.event_name == 'schedule'");
  assert.equal(step('smoke', 'Close').if, "success() && github.event_name == 'schedule'");
});

test('the alert step opens one issue for its title, and comments on the open one', () => {
  const env = { TITLE: 'smoke: production', BODY: 'Failed:' };
  const fresh = github(ALERT, { issues: [issueOf(3, 'other')] }, env);
  assert.equal(fresh.status, 0, fresh.out);
  assert.deepEqual(fresh.calls, [
    'issue create --repo o/r --title smoke: production --assignee owner --body Failed: https://github.com/o/r/actions/runs/1',
  ]);
  const again = github(ALERT, { issues: [issueOf(4, 'smoke: production')] }, env);
  assert.deepEqual(again.calls, [
    'issue comment 4 --repo o/r --body Failed again: https://github.com/o/r/actions/runs/1',
  ]);
  const close = github(
    CLOSE,
    { issues: [issueOf(4, 'smoke: production')] },
    { TITLE: 'smoke: production', COMMENT: 'Passed: x' },
  );
  assert.deepEqual(close.calls, ['issue close 4 --repo o/r --comment Passed: x']);
  const none = github(CLOSE, { issues: [] }, { TITLE: 'smoke: production', COMMENT: 'Passed: x' });
  assert.equal(none.status, 0, none.out);
  assert.deepEqual(none.calls, []);
});

// The deploy steps

const GATE = runOf('deploy', 'Rollback gate');
const ROLLBACK_ISSUE = issueOf(9, 'rollback: production');

test('the rollback gate is the first step of deploy, and every later step runs only when it lets the deploy go', () => {
  assert.equal(job('deploy').steps[0]?.id, 'gate');
  assert.deepEqual(job('deploy').steps[0]?.env, {
    GH_TOKEN: expression('github.token'),
    KIT_OWNER: expression('vars.KIT_OWNER'),
  });
  for (const entry of job('deploy').steps.slice(1)) assert.equal(entry.if, "steps.gate.outputs.deployed != 'false'");
  assert.equal(
    job('deploy').outputs?.deployed,
    expression("steps.gate.outputs.deployed || steps.deploy.outputs.deployed || 'false'"),
  );
  assert.equal(GATE, `${specBlock('- **Rollback gate**', 'sh')}\n`);
});

test('the rollback gate under bash: no open issue deploys; an issue that closes within 30 s deploys; else it stops', () => {
  const none = github(GATE, { issues: [issueOf(1, 'smoke: production')] });
  assert.equal(none.status, 0, none.out);
  assert.deepEqual(none.calls, []);
  assert.equal(none.output, '');
  const closed = github(GATE, { issues: [ROLLBACK_ISSUE], closeOnSleep: [9] });
  assert.equal(closed.status, 0, closed.out);
  assert.deepEqual(closed.calls, ['sleep 30']);
  assert.equal(closed.output, '');
  const open = github(GATE, { issues: [ROLLBACK_ISSUE] });
  assert.equal(open.status, 0, open.out);
  assert.deepEqual(open.calls, ['sleep 30']);
  assert.equal(open.output, 'deployed=false\n');
  assert.equal(
    open.out,
    'production is rolled back: nothing deploys until the owner closes the issue "rollback: production" or "rollback failed: production"\n',
  );
});

const CONFIG_CHECK = runOf('deploy', 'Config check');
const CHECK = step('deploy', 'Config check').env?.CHECK ?? '';
/** The built config of the forms test site, as the adapter writes it (S14). */
const REAL = (
  JSON.parse(readFileSync(new URL('./built-worker-config.json', import.meta.url), 'utf8')) as {
    production: Record<string, unknown>;
  }
).production;

/**
 * The built Worker config of a forms site that matches its `wrangler.jsonc`, as the adapter writes it (S14): the
 * built config of the test site with the settings of this `wrangler.jsonc`.
 */
function builtOf(wrangler: string): Record<string, unknown> {
  const value = JSON.parse(wrangler.replace(/^\s*\/\/.*$/gm, '')) as Record<string, unknown>;
  const { env: _env, $schema: _schema, ...rest } = value;
  return { ...REAL, ...rest, assets: { ...(rest.assets as object), directory: '../client', binding: 'ASSETS' } };
}

function configCheck(files: Record<string, string>) {
  return withBins({}, (work, env) => {
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(join(work, path, '..'), { recursive: true });
      writeFileSync(join(work, path), text);
    }
    const result = bash(CONFIG_CHECK, work, { ...env, CHECK });
    const output = existsSync(env.GITHUB_OUTPUT ?? '') ? readFileSync(env.GITHUB_OUTPUT ?? '', 'utf8') : '';
    return { status: result.status, out: `${result.stdout}${result.stderr}`, output };
  });
}

const STATIC = optionsOf({
  site: 'https://example.ch',
  codeOwner: '@example-owner',
  locales: [{ code: 'de', tag: 'de-CH', name: 'Deutsch' }],
  defaultLocale: 'de',
  legal: { legalNote: { de: '/impressum/' }, privacy: { de: '/datenschutz/' } },
  securityContact: 'mailto:security@example.ch',
});

test('the deploy config check under bash: a static site deploys wrangler.jsonc, and builds no Worker config', () => {
  const settings = JSON.stringify({ features: { forms: false } });
  const ok = configCheck({ 'astro-kit.json': settings, 'wrangler.jsonc': renderWrangler(STATIC) });
  assert.equal(ok.status, 0, ok.out);
  assert.equal(ok.output, 'config=wrangler.jsonc\n');
  const worker = configCheck({ 'astro-kit.json': settings, 'dist/server/wrangler.json': '{}' });
  assert.equal(worker.status, 1);
  assert.equal(worker.out, '::error::a static site built a Worker config\n');
});

test('the deploy config check under bash: a forms site deploys the built config only when it matches wrangler.jsonc', () => {
  const wrangler = renderWrangler(FORMS);
  const settings = JSON.stringify({ features: { forms: true } });
  const built = builtOf(wrangler);
  const check = (value: unknown) =>
    configCheck({
      'astro-kit.json': settings,
      'wrangler.jsonc': wrangler,
      'dist/server/wrangler.json': JSON.stringify(value),
    });
  const ok = check(built);
  assert.equal(ok.status, 0, ok.out);
  assert.equal(ok.output, 'config=dist/server/wrangler.json\n');
  const cases: [string, unknown, string][] = [
    [
      'another mail address',
      {
        ...built,
        send_email: [{ name: 'EMAIL', allowed_destination_addresses: ['attacker@example.net'] }],
      },
      '::error::the built Worker config differs from wrangler.jsonc in send_email\n',
    ],
    [
      'run_worker_first true and another name',
      { ...built, name: 'other', assets: { ...(built.assets as object), run_worker_first: true } },
      '::error::the built Worker config differs from wrangler.jsonc in assets, name\n',
    ],
    [
      'a build command',
      { ...built, build: { command: 'curl x' } },
      '::error::the built Worker config holds a build command\n',
    ],
    [
      'a KV binding',
      { ...built, kv_namespaces: [{ binding: 'KV', id: 'x' }] },
      '::error::the built Worker config holds a binding that wrangler.jsonc does not name: kv_namespaces\n',
    ],
    ['no object', [], '::error::the built Worker config is not a JSON object\n'],
  ];
  for (const [name, value, message] of cases) {
    const result = check(value);
    assert.equal(result.status, 1, name);
    assert.equal(result.out, message, name);
    assert.equal(result.output, '', name);
  }
  const missing = configCheck({ 'astro-kit.json': settings, 'wrangler.jsonc': wrangler });
  assert.equal(missing.status, 1);
  assert.equal(missing.out, '::error::a forms site built no Worker config\n');
});

test('upload and deploy hold the Cloudflare token in their env only, and read the version id', () => {
  const cloudflare = {
    CLOUDFLARE_API_BASE_URL: 'https://api.cloudflare.com/client/v4',
    CLOUDFLARE_API_TOKEN: expression('secrets.CLOUDFLARE_API_TOKEN'),
    CLOUDFLARE_ACCOUNT_ID: expression('vars.CLOUDFLARE_ACCOUNT_ID'),
  };
  assert.deepEqual(step('deploy', 'Upload the version').env, {
    CONFIG: expression('steps.config.outputs.config'),
    ...cloudflare,
  });
  assert.deepEqual(step('deploy', 'Deploy the version').env, {
    CONFIG: expression('steps.config.outputs.config'),
    ID: expression('steps.upload.outputs.id'),
    ...cloudflare,
  });
  const npx = 'echo "npx $*" >> "$LOG"; [ "$4" = upload ] && echo "$FAKE_UPLOAD"; exit 0\n';
  const id = '0f2b1d3c-4a5e-4f60-8a7b-9c0d1e2f3a4b';
  for (const [printed, status, output, last] of [
    [`Worker Version ID: ${id}`, 0, `id=${id}\n`, `Worker Version ID: ${id}\n`],
    ['Uploaded the worker', 1, '', '::error::the upload printed no version id\n'],
  ] as const) {
    withBins({ npx }, (work, env) => {
      const upload = bash(runOf('deploy', 'Upload the version'), work, {
        ...env,
        CONFIG: 'wrangler.jsonc',
        SHA: 'abc',
        FAKE_UPLOAD: printed,
      });
      assert.equal(upload.status, status, upload.stderr);
      assert.deepEqual(lines(env.LOG ?? ''), [
        `npx --no wrangler versions upload --config wrangler.jsonc --message main abc --env-file ${env.RUNNER_TEMP}/empty.env`,
      ]);
      const written = existsSync(env.GITHUB_OUTPUT ?? '') ? readFileSync(env.GITHUB_OUTPUT ?? '', 'utf8') : '';
      assert.equal(written, output);
      assert.equal(upload.stdout.endsWith(last), true, upload.stdout);
    });
  }
  withBins({ npx }, (work, env) => {
    const deploy = bash(runOf('deploy', 'Deploy the version'), work, {
      ...env,
      CONFIG: 'wrangler.jsonc',
      SHA: 'abc',
      ID: id,
    });
    assert.equal(deploy.status, 0, deploy.stderr);
    assert.deepEqual(lines(env.LOG ?? ''), [
      `npx --no wrangler versions deploy ${id}@100% --config wrangler.jsonc --message main abc -y --env-file ${env.RUNNER_TEMP}/empty.env`,
    ]);
    assert.equal(readFileSync(env.GITHUB_OUTPUT ?? '', 'utf8'), 'deployed=true\n');
  });
});

// The rollback step

test('the rollback step rolls back the Worker of wrangler.jsonc to the live version, with the token in its env only', () => {
  const rollback = step('rollback', 'Roll production back');
  assert.deepEqual(rollback.env, {
    LIVE: expression('needs.deploy.outputs.live'),
    CLOUDFLARE_API_BASE_URL: 'https://api.cloudflare.com/client/v4',
    CLOUDFLARE_API_TOKEN: expression('secrets.CLOUDFLARE_API_TOKEN'),
    CLOUDFLARE_ACCOUNT_ID: expression('vars.CLOUDFLARE_ACCOUNT_ID'),
  });
  const live = '0f2b1d3c-4a5e-4f60-8a7b-9c0d1e2f3a4b';
  withBins({ npx: 'echo "npx $*" >> "$LOG"\n' }, (work, env) => {
    writeFileSync(join(work, 'wrangler.jsonc'), renderWrangler(STATIC));
    const result = bash(rollback.run ?? '', work, { ...env, LIVE: live, RUN: 'https://github.com/o/r/actions/runs/1' });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(lines(env.LOG ?? ''), [
      `npx --no wrangler rollback ${live} --name example-ch --message smoke failed: https://github.com/o/r/actions/runs/1 -y --env-file ${env.RUNNER_TEMP}/empty.env`,
    ]);
  });
  withBins({ npx: 'echo "npx $*" >> "$LOG"\n' }, (work, env) => {
    writeFileSync(join(work, 'wrangler.jsonc'), '{}');
    const result = bash(rollback.run ?? '', work, { ...env, LIVE: live });
    assert.notEqual(result.status, 0, 'a wrangler.jsonc without a name rolls nothing back');
    assert.deepEqual(lines(env.LOG ?? ''), []);
  });
  const names = job('rollback').steps.map((entry) => entry.name ?? entry.uses?.replace(/@.*$/, ''));
  assert.deepEqual(names.slice(-3), ['Roll production back', 'Alert', 'Alert the failed rollback']);
});

// The preview

const PREVIEW_CHECK = runOf('preview', 'Check the built preview config');

test('the preview checks the built config before wrangler reads it, under bash', () => {
  const preview = (
    JSON.parse(readFileSync(new URL('./built-worker-config.json', import.meta.url), 'utf8')) as {
      preview: Record<string, unknown>;
    }
  ).preview;
  const wrangler = readFileSync(new URL('../site/wrangler.jsonc', import.meta.url), 'utf8');
  const check = (built: unknown) =>
    withBins({}, (work, env) => {
      writeFileSync(join(work, 'wrangler.jsonc'), wrangler);
      if (built !== undefined) {
        mkdirSync(join(work, 'dist/server'), { recursive: true });
        writeFileSync(join(work, 'dist/server/wrangler.json'), JSON.stringify(built));
      }
      const result = bash(PREVIEW_CHECK, work, {
        ...env,
        CHECK: step('preview', 'Check the built preview config').env?.CHECK ?? '',
      });
      return { status: result.status, out: `${result.stdout}${result.stderr}` };
    });
  assert.equal(check(undefined).status, 0);
  assert.equal(check(preview).status, 0, check(preview).out);
  const cases: [string, unknown, string][] = [
    [
      'a mail binding',
      { ...preview, send_email: [{ name: 'EMAIL' }] },
      '::error::the built Worker config differs from wrangler.jsonc in send_email\n',
    ],
    [
      'a KV binding',
      { ...preview, kv_namespaces: [{ binding: 'KV' }] },
      '::error::the built Worker config holds a binding that wrangler.jsonc does not name: kv_namespaces\n',
    ],
    ['a build key', { ...preview, build: {} }, '::error::the built Worker config holds a build command\n'],
    [
      'the production name',
      { ...preview, name: 'laerchenwald-example' },
      '::error::the built Worker config differs from wrangler.jsonc in name\n',
    ],
    ['no object', [], '::error::the built Worker config is not a JSON object\n'],
  ];
  for (const [name, built, message] of cases) {
    const result = check(built);
    assert.equal(result.status, 1, name);
    assert.equal(result.out, message, name);
  }
});

test('the preview alias is b- and 10 hex characters of the branch, the same for every push', () => {
  const script = runOf('preview', 'The alias of the branch');
  assert.match(script, /ALIAS="b-\$\(printf '%s' "\$BRANCH" \| sha256sum \| cut -c1-10\)"/);
  withBins({}, (work, env) => {
    const result = bash(script, work, { ...env, BRANCH: 'agent/rooms' });
    assert.equal(result.status, 0, result.stderr);
    assert.match(readFileSync(env.GITHUB_OUTPUT ?? '', 'utf8'), /^alias=b-[0-9a-f]{10}\n$/);
  });
  const upload = runOf('preview', 'Upload the preview version');
  assert.match(upload, /--config dist\/server\/wrangler\.json --preview-alias "\$ALIAS" --message "\$BRANCH \$SHA"/);
  assert.match(upload, /--env preview --preview-alias "\$ALIAS" --message "\$BRANCH \$SHA"/);
  assert.match(runOf('preview', 'The preview is behind Cloudflare Access'), /curl -sSI "\$URL"/);
});

// The protected task (10.6)

test('the protected job runs the steps of 10.6 in order, and pushes with the deploy key', () => {
  const found = job('protected');
  assert.deepEqual(found.env, { BRANCH: expression('inputs.branch') });
  assert.deepEqual(
    found.steps.map((entry) => entry.name ?? entry.uses?.replace(/@.*$/, '')),
    [
      'Check the branch input',
      'actions/checkout',
      'actions/setup-node',
      'Check the lockfile',
      'Install only the kit, outside the checkout',
      'Render the protected files',
      'Push the protected files',
    ],
  );
  assert.equal(
    runOf('protected', 'Render the protected files'),
    'node "$RUNNER_TEMP/kit/node_modules/@raess/astro-kit/dist/cli.js" init --protected',
  );
  const push = runOf('protected', 'Push the protected files');
  for (const line of [
    "git config user.name 'github-actions[bot]'",
    "git config user.email '41898282+github-actions[bot]@users.noreply.github.com'",
    "git commit -m 'chore: render the protected files'",
    'git push origin "HEAD:$BRANCH"',
    'git push --force origin HEAD:refs/heads/kit/protected',
  ]) {
    assert.equal(push.includes(line), true, line);
  }
  withBins({}, (work, env) => {
    const check = runOf('protected', 'Check the branch input');
    assert.equal(bash(check, work, { ...env, BRANCH: '' }).status, 0);
    assert.equal(bash(check, work, { ...env, BRANCH: 'agent/rooms-1.2' }).status, 0);
    assert.equal(bash(check, work, { ...env, BRANCH: 'a;b' }).status, 1);
    assert.equal(bash(check, work, { ...env, BRANCH: 'a b' }).status, 1);
  });
});

test('the protected task prints that the files are up to date when init changed nothing', () => {
  withBins({}, (work, env) => {
    const git = (...args: string[]) => spawnSync('git', args, { cwd: work, env: { ...env, GIT_CONFIG_NOSYSTEM: '1' } });
    git('init', '-q');
    git('-c', 'user.name=t', '-c', 'user.email=t@e', 'commit', '-q', '--allow-empty', '-m', 'x');
    const result = bash(runOf('protected', 'Push the protected files'), work, { ...env, BRANCH: '' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, 'The protected files are up to date.\n');
  });
});

// The smoke and feedback jobs

test('smoke gets the probe flag on Mondays, and the release SHA only after a deploy', () => {
  const smoke = step('smoke', 'Smoke');
  assert.equal(smoke.run, 'npx --no astro-kit smoke "$(jq -r .site astro-kit.json)" $PROBE');
  assert.deepEqual(smoke.env, {
    PROBE: expression("github.event.schedule == '47 3 * * 1' && '--probe' || ''"),
    KIT_PROBE_SECRET: expression('secrets.KIT_PROBE_SECRET'),
    KIT_WORKERS_DEV: expression('vars.KIT_WORKERS_DEV'),
    KIT_RELEASE_SHA: expression("github.event_name != 'schedule' && github.sha || ''"),
  });
});

test('feedback skips without its token, and sends with the kit of the lockfile', () => {
  const token = runOf('feedback', 'The feedback token');
  withBins({}, (work, env) => {
    const without = bash(token, work, { ...env, HAS_TOKEN: 'false' });
    assert.equal(without.stdout, 'No KIT_FEEDBACK_TOKEN: feedback stays in KIT-FEEDBACK.md.\n');
    const withToken = bash(token, work, { ...env, HAS_TOKEN: 'true' });
    assert.equal(withToken.stdout, '');
    assert.equal(readFileSync(env.GITHUB_OUTPUT ?? '', 'utf8'), 'send=true\n');
  });
  for (const entry of job('feedback').steps.slice(1)) assert.equal(entry.if, "steps.token.outputs.send == 'true'");
  assert.equal(runOf('feedback', 'Send the feedback'), 'npx --no astro-kit feedback send');
});

test('ci and build run astro-kit ci after Chromium, and upload dist with hidden files', () => {
  for (const [id, artifact] of [
    ['ci', 'preview-dist'],
    ['build', 'site-dist'],
  ] as const) {
    const runs = job(id)
      .steps.map((entry) => entry.run)
      .filter((run) => run !== undefined);
    assert.equal(runs.includes('npx --no playwright-core install --with-deps chromium'), true, id);
    assert.equal(runs.includes('npx --no astro-kit ci'), true, id);
    const upload = job(id).steps.find((entry) => entry.uses?.startsWith('actions/upload-artifact@'));
    assert.deepEqual(upload?.with, {
      name: artifact,
      path: 'dist',
      'include-hidden-files': true,
      'if-no-files-found': 'error',
      'retention-days': 7,
    });
  }
  assert.match(
    runOf('ci', 'Rebuild for the preview on a forms site'),
    /CLOUDFLARE_ENV=preview npx --no astro-kit build/,
  );
});

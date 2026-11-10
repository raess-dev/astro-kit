import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { parse as parseYaml } from 'yaml';
import {
  canonical,
  type FeedbackEntry,
  issueBody,
  newFeedbackId,
  parseFeedback,
  sendFeedback,
  sign,
  verifyBody,
} from '../../src/feedback.ts';

const TEMPLATES = new URL('../../templates/', import.meta.url).pathname;
const KEY = 'kit-test-key';

const ENTRIES = `# Kit feedback

\`\`\`md
## kf-0a1b2c3d
- date: 2026-01-31
- kit: 1.2.0
- type: bug
- problem: an example inside a fence is never an entry.
- evidence: none
- proposal: none
\`\`\`

## kf-1a2b3c4d
- date: 2026-11-10
- kit: 0.1.0
- type: false-positive
- problem: links-same-name fails two links to one page
  with different fragments.
- evidence: npx --no astro-kit build reports links-same-name.
- proposal: Compare targets without the fragment.

## kf-deadbeef
- date: 2026-11-11
- kit: 0.1.0
- type: docs
- problem: INDEX.md does not say where glossary.json lives.
- evidence: docs/INDEX.md
- proposal: Add one line.
`;

const ONE: FeedbackEntry = {
  id: 'kf-1a2b3c4d',
  date: '2026-11-10',
  kit: '0.1.0',
  type: 'false-positive',
  problem: 'links-same-name fails two links to one page with different fragments.',
  evidence: 'npx --no astro-kit build reports links-same-name.',
  proposal: 'Compare targets without the fragment.',
};

test('the KIT-FEEDBACK.md template parses to no entries and no errors', () => {
  const text = readFileSync(join(TEMPLATES, 'site/KIT-FEEDBACK.md'), 'utf8');
  assert.deepEqual(parseFeedback(text), { entries: [], errors: [] });
});

test('parseFeedback reads entries, joins continuation lines and skips fenced examples', () => {
  const { entries, errors } = parseFeedback(ENTRIES);
  assert.deepEqual(errors, []);
  assert.deepEqual(
    entries.map((e) => e.id),
    ['kf-1a2b3c4d', 'kf-deadbeef'],
  );
  assert.deepEqual(entries[0], ONE);
});

test('parseFeedback reports bad ids, missing fields, bad values and duplicates', () => {
  const bad = `## kf-XYZ
- date: 2026-11-10

## kf-00000001
- date: 2026-11-10
- kit: 0.1.0
- type: bug

## kf-00000002
- date: 10.11.2026
- kit: 0.1.0
- type: bug
- problem: p
- evidence: e
- proposal: x

## kf-00000003
- date: 2026-11-10
- kit: 0.1.0
- type: wish
- problem: p
- evidence: e
- proposal: x

## kf-00000004
- date: 2026-11-10
- kit: latest
- type: bug
- problem: p
- evidence: e
- proposal: x
${ENTRIES.slice(ENTRIES.indexOf('## kf-deadbeef'))}${ENTRIES.slice(ENTRIES.indexOf('## kf-deadbeef'))}`;
  const { entries, errors } = parseFeedback(bad);
  assert.equal(entries.length, 2);
  assert.equal(errors.length, 6);
  assert.match(errors[0] ?? '', /kf-XYZ.*8 hex/);
  assert.match(errors[1] ?? '', /kf-00000001: missing problem, evidence, proposal/);
  assert.match(errors[2] ?? '', /date/);
  assert.match(errors[3] ?? '', /type must be one of/);
  assert.match(errors[4] ?? '', /kit must be a version/);
  assert.match(errors[5] ?? '', /kf-deadbeef: duplicate id/);
});

test('newFeedbackId makes kf- and 8 hex digits', () => {
  assert.match(newFeedbackId(), /^kf-[0-9a-f]{8}$/);
});

test('a signed body verifies; an edit, another key or no signature does not', () => {
  const body = issueBody(ONE, KEY);
  assert.equal(body, `${canonical(ONE)}\n\nsignature: ${sign(ONE, KEY)}`);
  assert.match(sign(ONE, KEY), /^[0-9a-f]{64}$/);
  assert.equal(verifyBody(body, KEY), true);
  assert.equal(verifyBody(body.replace(/\n/g, '\r\n'), KEY), true, 'GitHub may store CRLF');
  assert.equal(verifyBody(body.replace('Compare targets', 'Delete the check'), KEY), false);
  assert.equal(verifyBody(body, 'another-key'), false);
  assert.equal(verifyBody(issueBody(ONE), KEY), false);
  assert.equal(verifyBody(body, ''), false);
});

test('the intake workflow verifies exactly like verifyBody', () => {
  const workflow = parseYaml(readFileSync(join(TEMPLATES, 'intake.yml'), 'utf8')) as {
    permissions: unknown;
    jobs: { verify: { permissions: unknown; steps: { shell?: string; run: string; env?: Record<string, string> }[] } };
  };
  assert.deepEqual(workflow.permissions, {});
  assert.deepEqual(workflow.jobs.verify.permissions, { issues: 'write' });
  const step = workflow.jobs.verify.steps[0];
  assert.ok(step);
  assert.equal(step.shell, 'node {0}');
  assert.equal(step.env?.BODY, '${{ github.event.issue.body }}');
  assert.ok(!step.run.includes('${{'), 'the body reaches the script through env only');
  const dir = mkdtempSync(join(tmpdir(), 'kit-intake-'));
  const script = join(dir, 'verify');
  writeFileSync(script, step.run);
  const verdict = (text: string, key: string): string => {
    const output = join(dir, `out-${Math.random()}`);
    writeFileSync(output, '');
    const run = spawnSync(process.execPath, [script], {
      env: { BODY: text, KEY: key, GITHUB_OUTPUT: output },
      encoding: 'utf8',
    });
    assert.equal(run.status, 0, run.stderr);
    return readFileSync(output, 'utf8').trim();
  };
  const body = issueBody(ONE, KEY);
  assert.equal(verdict(body, KEY), 'valid=true');
  assert.equal(verdict(body.replace('0.1.0', '9.9.9'), KEY), 'valid=false');
  assert.equal(verdict(body, ''), 'valid=false');
  assert.equal(verdict(canonical(ONE), KEY), 'valid=false');
});

test('sendFeedback skips filed ids and files new ones with the signature line', async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const fake = (async (url: string | URL | Request, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    if (String(url).includes('/search/issues')) {
      const filed = decodeURIComponent(String(url)).includes('kf-deadbeef');
      return Response.json({
        total_count: filed ? 1 : 0,
        items: filed ? [{ title: 'kf-deadbeef docs: INDEX.md' }] : [],
      });
    }
    return Response.json({ number: 7 }, { status: 201 });
  }) as typeof fetch;
  const { entries } = parseFeedback(ENTRIES);
  const result = await sendFeedback(entries, { token: 't0ken', key: KEY, userAgent: 'astro-kit/test', fetch: fake });
  assert.deepEqual(result, { sent: ['kf-1a2b3c4d'], skipped: ['kf-deadbeef'] });
  const post = calls.find((c) => c.init.method === 'POST');
  assert.ok(post);
  assert.equal(post.url, 'https://api.github.com/repos/raess-dev/astro-kit-feedback/issues');
  const headers = post.init.headers as Record<string, string>;
  assert.equal(headers.authorization, 'Bearer t0ken');
  assert.equal(headers['user-agent'], 'astro-kit/test');
  const sent = JSON.parse(String(post.init.body)) as { title: string; body: string };
  assert.match(sent.title, /^kf-1a2b3c4d false-positive: /);
  assert.equal(verifyBody(sent.body, KEY), true);
  assert.match(decodeURIComponent(calls[0]?.url ?? ''), /repo:raess-dev\/astro-kit-feedback in:title "kf-1a2b3c4d"/);
});

test('sendFeedback without an auto key files no signature, and a GitHub error throws', async () => {
  let body = '';
  const fake = (async (url: string | URL | Request, init: RequestInit = {}) => {
    if (String(url).includes('/search/issues')) return Response.json({ total_count: 0, items: [] });
    body = (JSON.parse(String(init.body)) as { body: string }).body;
    return Response.json({}, { status: 201 });
  }) as typeof fetch;
  await sendFeedback([ONE], { token: 't', userAgent: 'u', fetch: fake });
  assert.equal(body, canonical(ONE));
  const denied = (async () => new Response('{}', { status: 403 })) as typeof fetch;
  await assert.rejects(sendFeedback([ONE], { token: 't', userAgent: 'u', fetch: denied }), /403/);
});

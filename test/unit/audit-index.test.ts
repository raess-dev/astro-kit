import assert from 'node:assert/strict';
import { test } from 'node:test';
import { auditEdge } from '../../src/audit/edge.ts';
import { AUDIT_ORDER, AUDITS, type AuditName, type AuditSet, runAudits } from '../../src/audit/index.ts';
import { memoryContext } from '../../src/build.ts';
import type { Audit, BuildContext, Design } from '../../src/context.ts';
import { auditCss } from '../../src/css/rules.ts';
import { auditDesign } from '../../src/design/rules.ts';
import { renderTokens, TOKENS_FILE } from '../../src/design/tokens.ts';
import { headersText } from '../../src/hosts/cloudflare.ts';
import { Report } from '../../src/registry.ts';
import { AUTO, BUILT_AUTO, DESIGN, ELEMENTS_CSS, pageHtml } from './css-rules-fixtures.ts';
import { factsOf, inTempAsync, optionsOf, SMALLEST } from './fixtures.ts';
import { SPEC } from './spec.ts';

// The context of a case

const OPTIONS = optionsOf(SMALLEST);

/** A design with no row. No audit of this milestone reads it. */
const NO_DESIGN: Design = {
  themes: ['light'],
  colors: [],
  tokens: [],
  helpers: [],
  breakpoints: [],
  pairs: [],
  elements: [],
  components: [],
};

/** A build context from a map of client directory paths to texts. Nothing touches the disk. */
function contextOf(files: Readonly<Record<string, string>>): BuildContext {
  return memoryContext({
    root: '/site',
    dist: '/site/dist',
    options: OPTIONS,
    kitVersion: '0.0.0',
    facts: factsOf(),
    redirects: [],
    design: NO_DESIGN,
    report: new Report(),
    files,
  });
}

/** The `_headers` text that the kit writes for the settings. It passes `edge-headers`. */
const HEADERS = headersText(OPTIONS);

/** What a recording audit set saw: each call, in order, with the context that it got. */
interface Recording {
  calls: AuditName[];
  contexts: BuildContext[];
  audits: AuditSet;
}

/** One recording fake for each given name. The object holds the names in the given order. */
function recording(names: readonly AuditName[], more: Partial<Record<AuditName, Audit>> = {}): Recording {
  const calls: AuditName[] = [];
  const contexts: BuildContext[] = [];
  const fakes: Partial<Record<AuditName, Audit>> = {};
  for (const name of names) {
    fakes[name] = (ctx) => {
      calls.push(name);
      contexts.push(ctx);
    };
  }
  return { calls, contexts, audits: { ...fakes, ...more } };
}

/** The seven names in another order than that of step 4. */
const SHUFFLED: readonly AuditName[] = ['html', 'edge', 'page', 'design', 'budgets', 'site', 'css'];

/** The message of the error that a promise rejects with, or a text that says it did not reject. */
async function rejection(run: Promise<unknown>): Promise<string> {
  try {
    await run;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  return 'the promise did not reject';
}

// Tests

test('AUDIT_ORDER is the order of 6.1, astro:build:done, step 4', () => {
  const sentence = /\*\*Audits\.\*\* `runAudits` in this order: ([^.]+)\./.exec(SPEC)?.[1];
  assert.equal(sentence, 'page, site, budgets, CSS, design (built halves), edge, html-validate');
  const names = (sentence ?? '').split(', ').map((name) => name.replace(/ \(.*\)$/, '').replace(/-validate$/, ''));
  assert.deepEqual(
    names.map((name) => name.toLowerCase()),
    [...AUDIT_ORDER],
  );
  assert.deepEqual([...AUDIT_ORDER], ['page', 'site', 'budgets', 'css', 'design', 'edge', 'html']);
});

test('seven audits that are given in another order run in the order of step 4, each once, on the same context', async () => {
  const ctx = contextOf({});
  const seen = recording(SHUFFLED);
  assert.deepEqual(Object.keys(seen.audits), [...SHUFFLED], 'the test gives the audits in another order');
  const ran = await runAudits(ctx, seen.audits);
  assert.deepEqual(seen.calls, [...AUDIT_ORDER]);
  assert.deepEqual(ran, [...AUDIT_ORDER]);
  assert.deepEqual(
    seen.contexts.map((given) => given === ctx),
    AUDIT_ORDER.map(() => true),
  );
});

test('a name without an audit is skipped, and the others keep their order', async () => {
  const seen = recording(['html', 'edge', 'site']);
  const ran = await runAudits(contextOf({}), seen.audits);
  assert.deepEqual(seen.calls, ['site', 'edge', 'html']);
  assert.deepEqual(ran, ['site', 'edge', 'html']);
  assert.deepEqual(await runAudits(contextOf({}), {}), []);
});

test('an audit ends before the next one starts, also when it is asynchronous', async () => {
  const events: string[] = [];
  const slow = (name: string): Audit => {
    return async () => {
      events.push(`${name} starts`);
      await new Promise((resolve) => setTimeout(resolve, 5));
      events.push(`${name} ends`);
    };
  };
  await runAudits(contextOf({}), { edge: slow('edge'), page: slow('page'), css: slow('css') });
  assert.deepEqual(events, ['page starts', 'page ends', 'css starts', 'css ends', 'edge starts', 'edge ends']);
});

test('an audit that throws stops the run: the error reaches the caller, and no later audit runs', async () => {
  const seen = recording(SHUFFLED, {
    budgets: () => {
      throw new Error('the budgets audit broke');
    },
  });
  assert.equal(await rejection(runAudits(contextOf({}), seen.audits)), 'the budgets audit broke');
  assert.deepEqual(seen.calls, ['page', 'site']);
});

/** The audits of the kit at this milestone, in the order of step 4. */
const KIT_AUDITS: readonly AuditName[] = ['css', 'design', 'edge'];

test('at this milestone the audits are the css, design and edge audits', () => {
  assert.deepEqual(Object.keys(AUDITS), [...KIT_AUDITS]);
  assert.equal(AUDITS.css, auditCss);
  assert.equal(AUDITS.design, auditDesign);
  assert.equal(AUDITS.edge, auditEdge);
});

test('the audits of the kit pass on the edge files that the kit writes: no id', async () => {
  const ctx = contextOf({ _headers: HEADERS, _redirects: '/alt/ /neu/ 301\n' });
  assert.deepEqual(await runAudits(ctx), [...KIT_AUDITS]);
  assert.deepEqual([...ctx.report.ids()].sort(), []);
  assert.deepEqual(ctx.report.findings, []);
});

test('the audits of the kit add the findings of the edge audit to the report of the context', async () => {
  const cases: readonly [name: string, files: Readonly<Record<string, string>>, ids: readonly string[]][] = [
    ['no _headers file', { _redirects: '' }, ['edge-headers']],
    ['a redirect with the status 200', { _headers: HEADERS, _redirects: '/alt/ /neu/ 200\n' }, ['edge-redirects']],
    ['both', { _redirects: '/alt/ /neu/ 200\n' }, ['edge-headers', 'edge-redirects']],
  ];
  const seen: { name: string; ran: AuditName[]; ids: string[] }[] = [];
  for (const [name, files] of cases) {
    const ctx = contextOf(files);
    const ran = await runAudits(ctx);
    seen.push({ name, ran, ids: [...ctx.report.ids()].sort() });
  }
  assert.deepEqual(
    seen,
    cases.map(([name, , ids]) => ({ name, ran: [...KIT_AUDITS], ids })),
  );
});

// The css and design audits read the built pages of the context and the project CSS under its root.

/** The project CSS of a site whose global chunk is `BUILT_AUTO`. */
const PROJECT_CSS: Readonly<Record<string, string>> = {
  [TOKENS_FILE]: renderTokens(DESIGN, AUTO),
  'src/styles/elements.css': ELEMENTS_CSS,
  'src/styles/fonts.css': '',
};

/** Runs the audits of the kit on one built page in a site with `PROJECT_CSS`, and gives the rule of each finding. */
function auditPage(html: string): Promise<string[]> {
  return inTempAsync(PROJECT_CSS, async (root) => {
    const ctx = memoryContext({
      root,
      dist: `${root}/dist`,
      options: AUTO,
      kitVersion: '0.0.0',
      facts: factsOf(),
      redirects: [],
      design: DESIGN,
      report: new Report(),
      files: { 'index.html': html, _headers: headersText(AUTO), _redirects: '' },
    });
    await runAudits(ctx);
    return ctx.report.findings.map((finding) => finding.rule);
  });
}

test('the css and design audits pass on a page with the global chunk, and report a page that breaks one rule of each, css first', async () => {
  const extra = BUILT_AUTO.replace('--stack-gap:var(--space-2)}', '--stack-gap:var(--space-2);--extra:1rem}');
  assert.notEqual(extra, BUILT_AUTO, 'the test adds a custom property to the tokens layer');
  assert.deepEqual(await auditPage(pageHtml([BUILT_AUTO], '<a href="/">Text</a>')), []);
  assert.deepEqual(await auditPage(pageHtml([BUILT_AUTO], '<table></table>')), ['css-element-coverage']);
  assert.deepEqual(await auditPage(pageHtml([extra])), ['design-tokens']);
  assert.deepEqual(await auditPage(pageHtml([extra], '<table></table>')), ['css-element-coverage', 'design-tokens']);
});

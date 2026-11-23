/**
 * The entries of the page, site, budgets and html audits (parts 5b and 5c of M5): each runs its rules in the order of
 * section 8, and together they hold every build rule of the two parts once.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { auditBudgets, BUDGET_RULES } from '../../src/audit/budgets.ts';
import { auditHtml } from '../../src/audit/html.ts';
import { auditPage, PAGE_RULES } from '../../src/audit/page.ts';
import { auditSite, notFoundSegmentMessage, SITE_RULES } from '../../src/audit/site.ts';
import { RULE_BY_ID, RULES } from '../../src/registry.ts';
import { contextOf, ids, site } from './audit-fixtures.ts';

/** The 48 rules of parts 5b and 5c, as the task of the parts names them. */
const PART_5B_5C = [
  'head-canonical',
  'head-lang',
  'head-title',
  'head-description',
  'head-og',
  'head-icons',
  'head-jsonld',
  'headings-h1',
  'headings-order',
  'indexing-noindex',
  'csp-meta',
  'csp-hash',
  'csp-base',
  'html-validate',
  'html-shell',
  'speculation-block',
  'modes-script',
  'modes-switch',
  'images-src',
  'images-attrs',
  'images-format',
  'images-priority',
  'fonts-limit',
  'svg-name',
  'media-animated',
  'media-captions',
  'media-pdf',
  'routes-404',
  'routes-translation',
  'hreflang-reciprocal',
  'hreflang-x-default',
  'links-resolve',
  'links-generic',
  'links-same-name',
  'links-target-blank',
  'links-depth',
  'facts-value',
  'content-stale',
  'content-language',
  'content-copied',
  'content-glossary',
  'content-nfc',
  'legal-pages',
  'legal-statement',
  'budget-head',
  'budget-document',
  'budget-dom',
  'budget-fonts',
];

/** The ids in the order of the registry, which is the order of section 8. */
const inRegistryOrder = (list: readonly string[]): string[] =>
  RULES.map((rule) => rule.id).filter((id) => list.includes(id));

test('each audit runs its rules in the order of section 8', () => {
  for (const rules of [PAGE_RULES, SITE_RULES, BUDGET_RULES]) {
    const list = rules.map((rule) => rule.id);
    assert.deepEqual(list, inRegistryOrder(list));
  }
});

test('the audits hold every build rule of parts 5b and 5c once, html-validate in the html audit', () => {
  const all = [...PAGE_RULES, ...SITE_RULES, ...BUDGET_RULES].map((rule) => rule.id);
  assert.equal(new Set(all).size, all.length);
  assert.deepEqual([...all, 'html-validate'].sort(), [...PART_5B_5C].sort());
  assert.equal(PART_5B_5C.length, 48);
  for (const id of PART_5B_5C) {
    const stage = RULE_BY_ID.get(id)?.stage;
    assert.ok(stage === 'build' || stage === 'config + build', id);
  }
});

test('the entries run on a whole site without a throw', async () => {
  const ctx = contextOf(site());
  auditPage(ctx);
  auditSite(ctx);
  auditBudgets(ctx);
  await auditHtml(ctx);
  assert.deepEqual(ids(ctx.report), []);
});

test('routes-404 has the exact detail of section 8 for a path with a 404 segment', () => {
  assert.equal(
    notFoundSegmentMessage('/fr/404/'),
    "/fr/404/ has a 404 segment. Under build.format 'directory' it is written to /fr/404/index.html, an ordinary page that answers 200. Cloudflare answers a missing URL only with a file named 404.html, which Astro builds only from src/pages/404.astro. Put every language on /404.html.",
  );
});

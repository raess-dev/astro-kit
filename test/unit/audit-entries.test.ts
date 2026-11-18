/**
 * The entries of the page and html audits (part 5b of M5): the page audit runs its rules in the order of section 8,
 * and the two hold every build rule of the part once.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { auditHtml } from '../../src/audit/html.ts';
import { auditPage, PAGE_RULES } from '../../src/audit/page.ts';
import { RULE_BY_ID, RULES } from '../../src/registry.ts';
import { contextOf, ids, site } from './audit-fixtures.ts';

/** The 27 rules of part 5b, as the task of the part names them. */
const PART_5B = [
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
];

/** The ids in the order of the registry, which is the order of section 8. */
const inRegistryOrder = (list: readonly string[]): string[] =>
  RULES.map((rule) => rule.id).filter((id) => list.includes(id));

test('the page audit runs its rules in the order of section 8', () => {
  const list = PAGE_RULES.map((rule) => rule.id);
  assert.deepEqual(list, inRegistryOrder(list));
});

test('the audits hold every build rule of part 5b once, html-validate in the html audit', () => {
  const all = PAGE_RULES.map((rule) => rule.id);
  assert.equal(new Set(all).size, all.length);
  assert.deepEqual([...all, 'html-validate'].sort(), [...PART_5B].sort());
  assert.equal(PART_5B.length, 27);
  for (const id of PART_5B) {
    const stage = RULE_BY_ID.get(id)?.stage;
    assert.ok(stage === 'build' || stage === 'config + build', id);
  }
});

test('the entries run on a whole site without a throw', async () => {
  const ctx = contextOf(site());
  auditPage(ctx);
  await auditHtml(ctx);
  assert.deepEqual(ids(ctx.report), []);
});

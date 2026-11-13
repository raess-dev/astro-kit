/**
 * The build audits, in a fixed order (specification, 6.1, `astro:build:done`, step 4). Each audit reads the build
 * context and adds its findings to `ctx.report`. No audit throws for a finding, so one build reports every finding.
 */
import type { Audit, BuildContext } from '../context.ts';
import { auditEdge } from './edge.ts';

/** The audit groups in the order of step 4: page, site, budgets, CSS, design (built halves), edge, html-validate. */
export const AUDIT_ORDER = ['page', 'site', 'budgets', 'css', 'design', 'edge', 'html'] as const;

/** The name of one audit group. */
export type AuditName = (typeof AUDIT_ORDER)[number];

/** Some audits by name. The order of the keys has no meaning: `AUDIT_ORDER` decides the order of a run. */
export type AuditSet = Readonly<Partial<Record<AuditName, Audit>>>;

/**
 * The audits that exist at this milestone. A later milestone adds its audit under its name, and `runAudits` runs
 * it at its place in `AUDIT_ORDER`.
 */
export const AUDITS: AuditSet = {
  // page (M5, `src/audit/page.ts`): head, JSON-LD, headings, indexing, CSP, scripts, the mode script and switch,
  // images, fonts, origins, shell, SVG, media and forms, for each page.
  // site (M5, `src/audit/site.ts`): routes, hreflang, links, depth, facts, content and legal, across the pages.
  // budgets (M5, `src/audit/budgets.ts`): compressed sizes, DOM counts, fonts and JS import closures.
  // css (M5, `src/css/rules.ts`): the built halves of the `css-*` rules and of `modes-media`.
  // design (M5, `src/design/rules.ts`): the built halves of `design-tokens`, `design-specs` and `design-pairs`.
  // edge: `_headers` and `_redirects`, after `writeEdgeFiles` wrote them.
  edge: auditEdge,
  // html (M5, `src/audit/html.ts`): html-validate with the kit config.
};

/**
 * Runs the given audits in the order of `AUDIT_ORDER`, one after the other, and returns the names of the audits
 * that ran. A name without an audit is skipped. An audit that throws stops the run: this is an error of the kit,
 * not a finding.
 */
export async function runAudits(ctx: BuildContext, audits: AuditSet = AUDITS): Promise<AuditName[]> {
  const ran: AuditName[] = [];
  for (const name of AUDIT_ORDER) {
    const audit = audits[name];
    if (audit === undefined) continue;
    await audit(ctx);
    ran.push(name);
  }
  return ran;
}

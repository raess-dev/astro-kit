/**
 * The build audits, in a fixed order (specification, 6.1, `astro:build:done`, step 4). Each audit reads the build
 * context and adds its findings to `ctx.report`. No audit throws for a finding, so one build reports every finding.
 */
import type { Audit, BuildContext } from '../context.ts';
import { auditCss } from '../css/rules.ts';
import { auditDesign } from '../design/rules.ts';
import { auditEdge } from './edge.ts';
import { auditHtml } from './html.ts';
import { auditPage } from './page.ts';

/** The audit groups in the order of step 4: page, site, budgets, CSS, design (built halves), edge, html-validate. */
export const AUDIT_ORDER = ['page', 'site', 'budgets', 'css', 'design', 'edge', 'html'] as const;

/** The name of one audit group. */
export type AuditName = (typeof AUDIT_ORDER)[number];

/** Some audits by name. The order of the keys has no meaning: `AUDIT_ORDER` decides the order of a run. */
export type AuditSet = Readonly<Partial<Record<AuditName, Audit>>>;

/**
 * The audits of the kit. A later milestone adds its rules to the audit of their group, and `runAudits` runs every
 * audit at its place in `AUDIT_ORDER`.
 */
export const AUDITS: AuditSet = {
  // page: the built halves of the rules that read each page on its own: head, JSON-LD, headings, indexing, CSP,
  // the speculation block, the mode script and switch, images, fonts, shell, SVG and media.
  page: auditPage,
  // site and budgets: the rules that read the pages together, and the budgets, arrive in part 5c of M5.
  // css: the built halves of the `css-*` rules and of `modes-media`.
  css: auditCss,
  // design: the built halves of `design-tokens` and `design-specs` (`design-pairs` has no built half).
  design: auditDesign,
  // edge: `_headers` and `_redirects`, after `writeEdgeFiles` wrote them.
  edge: auditEdge,
  // html: html-validate with the kit config, last.
  html: auditHtml,
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

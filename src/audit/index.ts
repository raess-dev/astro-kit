import type { Audit, BuildContext } from '../context.ts';
import { auditBudgets } from './budgets.ts';
import { auditCss } from './css.ts';
import { auditEdge } from './edge.ts';
import { auditHtml } from './html.ts';
import { auditPages } from './page.ts';
import { auditSite } from './site.ts';

/** Every build audit, in report order. Each audit is pure: it reads the context and adds findings. */
export const AUDITS: Audit[] = [auditPages, auditSite, auditCss, auditBudgets, auditHtml, auditEdge];

export async function runAudits(ctx: BuildContext): Promise<void> {
  for (const audit of AUDITS) await audit(ctx);
}

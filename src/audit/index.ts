import type { Audit, BuildContext } from '../context.ts';

/** Every build audit, in report order. Each audit is pure: it reads the context and adds findings. */
export const AUDITS: Audit[] = [];

export async function runAudits(ctx: BuildContext): Promise<void> {
  for (const audit of AUDITS) await audit(ctx);
}

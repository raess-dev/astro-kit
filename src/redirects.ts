import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RedirectRow } from './context.ts';
import type { Report } from './registry.ts';

export const REDIRECTS_FILE = 'src/content/redirects.json';

/** Cloudflare Workers static assets limits for _redirects. */
export const REDIRECT_LIMITS = { staticRules: 2000, dynamicRules: 100, lineLength: 1000 } as const;

export function loadRedirects(root: string, report: Report): RedirectRow[] {
  const file = join(root, REDIRECTS_FILE);
  if (!existsSync(file)) return [];
  let rows: unknown;
  try {
    rows = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    report.add('routes-redirects', REDIRECTS_FILE, (error as Error).message);
    return [];
  }
  if (!Array.isArray(rows)) {
    report.add('routes-redirects', REDIRECTS_FILE, 'must be an array of {from, to} or {from, gone: true}');
    return [];
  }
  const out: RedirectRow[] = [];
  const sources = new Set<string>();
  for (const [i, row] of rows.entries()) {
    const r = row as Record<string, unknown>;
    const from = typeof r.from === 'string' ? r.from : '';
    const where = `${REDIRECTS_FILE}[${i}]`;
    if (!from.startsWith('/') || /\s/.test(from)) {
      report.add('routes-redirects', where, `from "${from}" must be a path`);
      continue;
    }
    if (from.includes('?')) report.add('routes-redirects', where, 'query strings cannot be matched; mark it gone or add a zone Single Redirect');
    if (sources.has(from)) report.add('routes-redirects', where, `duplicate from ${from}`);
    sources.add(from);
    if (r.gone === true) out.push({ from, gone: true });
    else if (typeof r.to === 'string' && r.to.startsWith('/')) out.push({ from, to: r.to });
    else report.add('routes-redirects', where, 'needs a to path or gone: true');
  }
  for (const row of out) {
    if (row.to && sources.has(row.to)) report.add('routes-redirects', REDIRECTS_FILE, `chain: ${row.from} → ${row.to} is itself a source`);
  }
  return out;
}

/** _redirects lines: static rows first (Cloudflare requires it), then splat rows. */
export function redirectLines(rows: RedirectRow[], report: Report): string[] {
  const moves = rows.filter((r) => r.to);
  const statics = moves.filter((r) => !r.from.includes('*') && !r.from.includes(':'));
  const dynamics = moves.filter((r) => r.from.includes('*') || r.from.includes(':'));
  if (statics.length > REDIRECT_LIMITS.staticRules) report.add('edge-redirects', '_redirects', `${statics.length} static rules`);
  if (dynamics.length > REDIRECT_LIMITS.dynamicRules) report.add('edge-redirects', '_redirects', `${dynamics.length} dynamic rules`);
  const lines = [...statics, ...dynamics].map((r) => `${r.from} ${r.to} 301`);
  for (const line of lines) if (line.length > REDIRECT_LIMITS.lineLength) report.add('edge-redirects', '_redirects', line.slice(0, 60));
  return lines;
}

/**
 * The rule registry: the single source of every check the kit runs.
 * docs/standards.md is generated from it (`npm run docs`), so the docs and the checks cannot differ.
 * Each rule has a stable id, a group, a stage, a level, the waivable mark, the standard as one decidable sentence,
 * the failure message and a fix hint (specification, section 8).
 */

export type Stage = 'config' | 'build' | 'config + build' | 'browser' | 'ci' | 'smoke' | 'zone';

/** An `error` finding fails its command. A `warn` finding is printed and fails nothing (11.5). */
export type Level = 'error' | 'warn';

export interface Rule {
  id: string;
  group: string;
  stage: Stage;
  level: Level;
  /** True when the owner may switch this rule off for one place, until a date (section 8, Waivers). */
  waivable: boolean;
  /** The rule, stated once as a decidable condition. */
  standard: string;
  /** What the failure means, printed with the finding. */
  message: string;
  /** How to fix it. */
  hint: string;
}

/**
 * The waivable rules of section 8. An entry that ends with `-*` covers every rule id with that prefix.
 * No rule of the config, routes, csp, edge, origins, forms, modes or design groups is here, and no ci, smoke or zone
 * rule: they protect the trust chain, the visitor's data or the build itself.
 */
export const WAIVABLE: readonly string[] = [
  'budget-*',
  'js-budget',
  'images-attrs',
  'images-format',
  'images-priority',
  'fonts-limit',
  'head-title',
  'head-description',
  'head-og',
  'head-jsonld',
  'headings-*',
  'links-generic',
  'links-same-name',
  'links-depth',
  'facts-value',
  'content-*',
  'css-element-coverage',
  'css-unused',
  'media-*',
  'svg-name',
  'html-validate',
  'legal-statement',
  'a11y-*',
  'contrast-pairs',
  'perf-*',
];

/** Says whether section 8 lists the rule id as waivable. */
export function isWaivable(id: string): boolean {
  return WAIVABLE.some((entry) => (entry.endsWith('-*') ? id.startsWith(entry.slice(0, -1)) : id === entry));
}

/** Builds one registry entry. The waivable mark comes from the one list above. */
export const r = (
  id: string,
  group: string,
  stage: Stage,
  standard: string,
  message: string,
  hint: string,
  level: Level = 'error',
): Rule => ({ id, group, stage, level, waivable: isWaivable(id), standard, message, hint });

/** Every rule of the kit. Each milestone adds the rules that it delivers (specification, section 14). */
export const RULES: readonly Rule[] = [];

export type RuleMap = ReadonlyMap<string, Rule>;

export const RULE_BY_ID: RuleMap = new Map(RULES.map((rule) => [rule.id, rule]));

export const DOCS_PATH = 'node_modules/@raess/astro-kit/docs/standards.md';

/** One entry of `waivers` in astro-kit.json (5.2). */
export interface Waiver {
  rule: string;
  where: string;
  reason: string;
  /** The end date, `YYYY-MM-DD`. */
  until: string;
}

export interface Finding {
  rule: string;
  /** A built page path, a project file with a line, or a file with a field path (section 8, Where). */
  where: string;
  /** Specific detail: the value found, the limit, the element. */
  detail?: string;
  /** Set when a waiver covers the finding. A waived finding fails nothing. */
  waived?: { until: string; reason: string };
}

export function getRule(id: string, rules: RuleMap = RULE_BY_ID): Rule {
  const rule = rules.get(id);
  if (!rule) throw new Error(`astro-kit: unknown rule id ${id}`);
  return rule;
}

/**
 * Says whether the waiver covers the finding. The rule ids are equal, and the finding's place equals the waiver's
 * place or starts with it at a boundary: the waiver's place ends with `/`, or the next character of the finding's
 * place is `/`, `:` or a space.
 */
export function waives(waiver: Waiver, finding: Pick<Finding, 'rule' | 'where'>): boolean {
  if (waiver.rule !== finding.rule) return false;
  if (finding.where === waiver.where) return true;
  if (!finding.where.startsWith(waiver.where)) return false;
  if (waiver.where.endsWith('/')) return true;
  const next = finding.where[waiver.where.length];
  return next === '/' || next === ':' || next === ' ';
}

/** Marks each finding that a waiver covers. Only a waivable rule can be waived. */
export function applyWaivers(
  findings: readonly Finding[],
  waivers: readonly Waiver[],
  rules: RuleMap = RULE_BY_ID,
): Finding[] {
  return findings.map((finding) => {
    if (finding.waived || !getRule(finding.rule, rules).waivable) return finding;
    const waiver = waivers.find((w) => waives(w, finding));
    return waiver ? { ...finding, waived: { until: waiver.until, reason: waiver.reason } } : finding;
  });
}

/** Says whether the finding fails its command: an `error` rule, and no waiver. */
export function fails(finding: Finding, rules: RuleMap = RULE_BY_ID): boolean {
  return !finding.waived && getRule(finding.rule, rules).level === 'error';
}

/** The findings that fail the command. */
export function failures(findings: readonly Finding[], rules: RuleMap = RULE_BY_ID): Finding[] {
  return findings.filter((finding) => fails(finding, rules));
}

/**
 * The text of a result (specification, 6.4). A failing finding has `✗`, a `warn` finding has `!`, and a waived
 * finding has `~` on one line. Only the failing findings count in the first line. With none, the last line says
 * that all checks passed.
 */
export function formatFindings(findings: readonly Finding[], rules: RuleMap = RULE_BY_ID): string {
  const count = failures(findings, rules).length;
  const lines: string[] = [];
  if (count > 0) lines.push(`astro-kit: ${count} finding${count === 1 ? '' : 's'}`);
  for (const finding of findings) {
    const rule = getRule(finding.rule, rules);
    const text = `[${rule.id}] ${finding.where}: ${rule.message}${finding.detail ? ` (${finding.detail})` : ''}`;
    if (finding.waived) {
      lines.push(`~ ${text} (waived until ${finding.waived.until}: ${finding.waived.reason})`);
      continue;
    }
    lines.push(`${rule.level === 'warn' ? '!' : '✗'} ${text}`);
    lines.push(`    fix: ${rule.hint}`);
    lines.push(`    rule: ${DOCS_PATH}#${rule.id}`);
  }
  if (count === 0) lines.push('astro-kit: all checks passed.');
  return lines.join('\n');
}

export class FindingError extends Error {
  readonly findings: readonly Finding[];
  constructor(findings: readonly Finding[], rules: RuleMap = RULE_BY_ID) {
    super(formatFindings(findings, rules));
    this.name = 'AstroKitError';
    this.findings = findings;
  }
}

/** Collects findings; throws once with all of them, so one run reports everything. */
export class Report {
  readonly findings: Finding[] = [];
  private readonly waivers: readonly Waiver[];
  private readonly rules: RuleMap;

  constructor(options: { waivers?: readonly Waiver[]; rules?: RuleMap } = {}) {
    this.waivers = options.waivers ?? [];
    this.rules = options.rules ?? RULE_BY_ID;
  }

  add(rule: string, where: string, detail?: string): void {
    const finding: Finding = detail === undefined ? { rule, where } : { rule, where, detail };
    const [marked] = applyWaivers([finding], this.waivers, this.rules);
    this.findings.push(marked ?? finding);
  }

  /** True when no finding fails the command. Warnings and waived findings do not count. */
  get ok(): boolean {
    return failures(this.findings, this.rules).length === 0;
  }

  /** The rule ids of the findings that fail the command. */
  ids(): Set<string> {
    return new Set(failures(this.findings, this.rules).map((finding) => finding.rule));
  }

  format(): string {
    return formatFindings(this.findings, this.rules);
  }

  throwIfFailed(): void {
    if (!this.ok) throw new FindingError(this.findings, this.rules);
  }
}

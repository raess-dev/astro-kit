/**
 * Moved and removed URLs: the schema of `redirects.json`, the source half of the rule `routes-redirects`, and the
 * lines of `_redirects` (specification, sections 5.6, 6.3 and 8).
 *
 * The rule `routes-redirects` has two halves. This module is the source half. It checks every sentence of the rule
 * that needs no `dist/`:
 *
 * 1. Rows are `{from, to}` or `{from, gone: true}`.
 * 2. `from` starts with `/` and has no whitespace, no `?` and no `#`.
 * 3. No duplicate `from`.
 * 4. `to` starts with `/`, not with `//` or `/\`, and has no whitespace.
 * 5. Cloudflare stores each path as written: no backslash and no `.` or `..` segment.
 * 6. No chains: the path of no `to` is a `from`.
 * 7. Limits: 2,000 static, 100 dynamic, 1,000 characters per line.
 *
 * Sentence 5 is what keeps sentence 4 true. Cloudflare reads each `from` and `to` as a URL and removes dot
 * segments, so it stores `/.//host/` as `//host/`, and that `to` leaves the site. It also keeps only the path of a
 * `from`, so `/#old` would redirect the home page.
 *
 * The build half is not checked here, because it needs the built paths: "Every literal `to` is built (patterns, and
 * `/api/` with forms, are skipped)." The rule `edge-redirects` checks the written `dist/_redirects` again.
 */
import { z } from 'astro/zod';
import { fieldPlace, readJson, reportIssues } from './options.ts';
import type { Report } from './registry.ts';

export const REDIRECTS_FILE = 'redirects.json';

const RULE = 'routes-redirects';

/** The limits of `_redirects` on Cloudflare: the static rules, the dynamic rules and the characters of one line. */
export const REDIRECT_LIMITS = { staticRules: 2_000, dynamicRules: 100, lineChars: 1_000 } as const;

/** The status of every line that the kit writes (6.3). */
export const REDIRECT_STATUS = 301;

/** The exact message of `routes-redirects` for a `from` with a query string. */
export const QUERY_MESSAGE = 'query strings cannot be matched; mark it gone or add a zone Single Redirect';

/** The exact message of `routes-redirects` for a `from` with a fragment. Cloudflare keeps only the path. */
export const FRAGMENT_MESSAGE = 'fragments cannot be matched: a browser never sends the text after #';

/** One row of `redirects.json`: a moved URL, or a removed one. */
export type RedirectRow = { from: string; to: string } | { from: string; gone: true };

/** The part of a zod refinement context that the checks below use. */
interface Issues {
  addIssue(issue: { code: 'custom'; message: string; path: PropertyKey[] }): void;
}

const add = (ctx: Issues, path: PropertyKey[], message: string): void =>
  ctx.addIssue({ code: 'custom', message, path });

/** A `.` or `..` segment as the URL parser of Cloudflare reads it: `%2e` is a dot too, in any letter case. */
const DOT_SEGMENT = /^(?:\.|%2e){1,2}$/i;

/**
 * Why Cloudflare would not store the path as written, as the end of a sentence about it, or `undefined`. The path
 * starts with `/`. `text` is the whole `from` or `to`: a backslash counts in a query string too, because the kit
 * does not judge where a browser stops reading a path.
 *
 * - A browser reads a backslash as `/`.
 * - Cloudflare removes a `.` and a `..` segment. What is left can start with `//`, and that names another host.
 */
function pathProblem(text: string, path = text): string | undefined {
  if (text.includes('\\')) return 'must not hold a backslash: a browser reads it as /';
  if (path.split('/').some((segment) => DOT_SEGMENT.test(segment))) {
    return 'must not hold a . or .. segment, also not as %2e: Cloudflare removes it';
  }
  return undefined;
}

/** The path of a `to`: the text before its query string and its fragment. */
export const targetPath = (to: string): string => /^[^?#]*/.exec(to)?.[0] ?? to;

/**
 * Every problem of one `from`, each as a whole sentence. `label` names the field in a sentence. `_redirects` holds
 * the same text, so `edge-redirects` uses this function too.
 */
export function sourceProblems(from: string, label = 'from'): string[] {
  const problems: string[] = [];
  if (!from.startsWith('/')) problems.push(`${label} must start with /`);
  if (/\s/.test(from)) problems.push(`${label} must not hold whitespace`);
  if (from.includes('?')) problems.push(QUERY_MESSAGE);
  if (from.includes('#')) problems.push(FRAGMENT_MESSAGE);
  const problem = from.startsWith('/') ? pathProblem(from) : undefined;
  if (problem !== undefined) problems.push(`${label} ${problem}`);
  return problems;
}

/**
 * Every problem of one `to`, each as a whole sentence. A `to` is a path of this site, on one line. `//host/` and
 * `/\host/` name another host in a browser, and whitespace would add a word or a whole line to `_redirects`.
 */
export function targetProblems(to: string, label = 'to'): string[] {
  const problems: string[] = [];
  const leaves = /^\/[/\\]/.test(to);
  if (!to.startsWith('/')) problems.push(`${label} must start with /`);
  if (leaves) problems.push(`${label} must not start with // or /\\: it would leave the site`);
  if (/\s/.test(to)) problems.push(`${label} must not hold whitespace`);
  const problem = !to.startsWith('/') || leaves ? undefined : pathProblem(to, targetPath(to));
  if (problem !== undefined) problems.push(`${label} ${problem}`);
  return problems;
}

const fromSchema = z.string().superRefine((from, ctx) => {
  for (const problem of sourceProblems(from)) add(ctx, [], problem);
});

const toSchema = z.string().superRefine((to, ctx) => {
  for (const problem of targetProblems(to)) add(ctx, [], problem);
});

const rowShape = z.strictObject({
  from: fromSchema,
  to: toSchema.optional(),
  gone: z.literal(true, { error: 'gone must be true; for a moved URL, remove gone and set to' }).optional(),
});

/** The schema of one row. A row has `to` or `gone: true`, never both and never none. An unknown key fails. */
export const redirectRowSchema = rowShape
  .superRefine((row, ctx) => {
    if (row.to === undefined && row.gone === undefined) add(ctx, [], 'a row needs to or gone: true');
    if (row.to !== undefined && row.gone !== undefined) add(ctx, [], 'a row has to or gone: true, not both');
  })
  .transform(
    (row): RedirectRow => (row.to === undefined ? { from: row.from, gone: true } : { from: row.from, to: row.to }),
  );

/** Says whether a `from` is a dynamic rule: it holds `*` or `:` (6.3). The build half uses it for a `to` too. */
export function isDynamic(from: string): boolean {
  return from.includes('*') || from.includes(':');
}

const lineOf = (from: string, to: string): string => `${from} ${to} ${REDIRECT_STATUS}`;

/** What the checks across rows read of a row. A row that is not valid still gives the texts that it has. */
interface LooseRow {
  from?: string | undefined;
  to?: string | undefined;
}

interface Problem {
  path: PropertyKey[];
  message: string;
}

/**
 * The checks that read more than one row: duplicates, chains and the limits. Only a row with a `to` writes a line,
 * so only such a row counts for the limits.
 */
function acrossRows(rows: readonly LooseRow[]): Problem[] {
  const problems: Problem[] = [];
  /** The first row of each `from`. */
  const sources = new Map<string, number>();
  rows.forEach((row, index) => {
    if (row.from === undefined) return;
    const first = sources.get(row.from);
    if (first === undefined) sources.set(row.from, index);
    else problems.push({ path: [index, 'from'], message: `duplicate from "${row.from}", first in [${first}]` });
  });

  let statics = 0;
  let dynamics = 0;
  rows.forEach((row, index) => {
    if (row.to === undefined) return;
    // A request for the `to` reaches the server without its fragment, and a rule matches the path alone.
    const target = targetPath(row.to);
    const source = sources.get(target);
    if (source !== undefined) {
      problems.push({ path: [index, 'to'], message: `chain: "${target}" is the from of [${source}]` });
    }
    if (row.from === undefined) return;
    if (isDynamic(row.from)) dynamics += 1;
    else statics += 1;
    const { length } = lineOf(row.from, row.to);
    if (length > REDIRECT_LIMITS.lineChars) {
      problems.push({
        path: [index],
        message: `the line has ${length} characters; the limit is ${REDIRECT_LIMITS.lineChars}`,
      });
    }
  });
  if (statics > REDIRECT_LIMITS.staticRules) {
    problems.push({ path: [], message: `${statics} static redirects; the limit is ${REDIRECT_LIMITS.staticRules}` });
  }
  if (dynamics > REDIRECT_LIMITS.dynamicRules) {
    problems.push({ path: [], message: `${dynamics} dynamic redirects; the limit is ${REDIRECT_LIMITS.dynamicRules}` });
  }
  return problems;
}

/**
 * The schema of `redirects.json` (5.6): a list of rows, with every check of the source half. `parseRedirects` gives
 * the same findings, and it also reports the problems across rows when a row is not valid.
 */
export const redirectsSchema = z.array(redirectRowSchema).superRefine((rows, ctx) => {
  for (const problem of acrossRows(rows)) add(ctx, problem.path, problem.message);
});

/** The texts `from` and `to` of any JSON value. */
function looseRow(entry: unknown): LooseRow {
  if (typeof entry !== 'object' || entry === null) return {};
  const from: unknown = 'from' in entry ? entry.from : undefined;
  const to: unknown = 'to' in entry ? entry.to : undefined;
  return { from: typeof from === 'string' ? from : undefined, to: typeof to === 'string' ? to : undefined };
}

/**
 * Validates a parsed `redirects.json` value. Each problem is one `routes-redirects` finding at `<file>` or
 * `<file>: <field path>`, such as `redirects.json: [3].from`. One call reports every problem of every row.
 * Returns the rows, or `undefined` when the value gave a finding.
 */
export function parseRedirects(
  value: unknown,
  report: Report,
  file: string = REDIRECTS_FILE,
): RedirectRow[] | undefined {
  if (!Array.isArray(value)) {
    report.add(RULE, file, 'the file must hold a list of rows: {from, to} or {from, gone: true}');
    return undefined;
  }
  const entries: readonly unknown[] = value;
  const rows: RedirectRow[] = [];
  let valid = true;
  entries.forEach((entry, index) => {
    const parsed = redirectRowSchema.safeParse(entry);
    if (parsed.success) {
      rows.push(parsed.data);
      return;
    }
    valid = false;
    const issues = parsed.error.issues.map((issue) => ({ ...issue, path: [index, ...issue.path] }));
    reportIssues(report, RULE, file, issues);
  });
  for (const problem of acrossRows(entries.map(looseRow))) {
    valid = false;
    report.add(RULE, fieldPlace(file, problem.path), problem.message);
  }
  return valid ? rows : undefined;
}

/**
 * Reads and validates `<root>/redirects.json`: the source half of `routes-redirects`. A missing file is an empty
 * list. Returns the rows, or `undefined` when the file gave a finding.
 */
export function loadRedirects(root: string, report: Report): RedirectRow[] | undefined {
  const read = readJson(root, REDIRECTS_FILE);
  if (read.state === 'missing') return [];
  if (read.state === 'invalid') {
    report.add(RULE, REDIRECTS_FILE, `the file is not valid JSON: ${read.message}`);
    return undefined;
  }
  return parseRedirects(read.value, report);
}

/**
 * The lines of `_redirects` (6.3): `${from} ${to} 301`, static rules first, then dynamic ones. Each group keeps the
 * order of the file. A gone row writes no line.
 */
export function redirectLines(rows: readonly RedirectRow[]): string[] {
  const statics: string[] = [];
  const dynamics: string[] = [];
  for (const row of rows) {
    if (!('to' in row)) continue;
    (isDynamic(row.from) ? dynamics : statics).push(lineOf(row.from, row.to));
  }
  return [...statics, ...dynamics];
}

// Matching, for the rules of later milestones (`routes-removed`, `links-resolve`)

/** The compiled pattern of each dynamic `from`. */
const patterns = new Map<string, RegExp>();

/** The pattern of a dynamic `from`: `*` stands for any text, and `:name` for one segment. */
function patternOf(from: string): RegExp {
  let pattern = patterns.get(from);
  if (pattern === undefined) {
    const source = from
      .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\*+/g, '.*')
      .replace(/:[A-Za-z]\w*/g, '[^/]+');
    pattern = new RegExp(`^${source}$`);
    patterns.set(from, pattern);
  }
  return pattern;
}

/** Says whether one `from` covers the path, as written: a static `from` must equal it, and a dynamic one must match. */
export function sourceMatches(from: string, path: string): boolean {
  return isDynamic(from) ? patternOf(from).test(path) : from === path;
}

/** The three forms of one path: `/a`, `/a/` and `/a/index.html`. The root has two: `/` and `/index.html`. */
function pathForms(path: string): string[] {
  let base = path.endsWith('/index.html') ? path.slice(0, -'index.html'.length) : path;
  if (base.length > 1 && base.endsWith('/')) base = base.slice(0, -1);
  return base === '/' ? ['/', '/index.html'] : [base, `${base}/`, `${base}/index.html`];
}

/**
 * The first row whose `from` covers the path, or `undefined`. The matching is that of `routes-removed`: `/a`, `/a/`
 * and `/a/index.html` are one path, and the patterns `*` and `:name` match.
 */
export function findRedirect<Row extends { from: string }>(rows: readonly Row[], path: string): Row | undefined {
  const forms = pathForms(path);
  return rows.find((row) => {
    if (isDynamic(row.from)) return forms.some((form) => patternOf(row.from).test(form));
    return pathForms(row.from).includes(forms[0] ?? path);
  });
}

/** Says whether a row redirects the path or marks it gone. See `findRedirect` for the matching. */
export function matchesRedirect(rows: readonly { from: string }[], path: string): boolean {
  return findRedirect(rows, path) !== undefined;
}

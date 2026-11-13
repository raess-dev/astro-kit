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

/**
 * Every rule of the kit, in the order of section 8. Each milestone adds the rules that it delivers (specification,
 * section 14). A standard holds the whole rule, also where a later milestone adds a part of the check.
 */
export const RULES: readonly Rule[] = [
  // config
  r(
    'config-options',
    'config',
    'config',
    '`astro-kit.json` exists and matches the strict schema of the kit. `site.json` at the root exists and matches its schema, and `glossary.json`, when it exists, matches its schema. Findings name the field path. A looser limit fails.',
    'The settings, the facts or the glossary are missing or not valid.',
    'Fix the field that the finding names. `npx --no astro-kit settings --html settings.html` shows every setting with its rule.',
  ),
  r(
    'config-shim',
    'config',
    'config',
    "`astro.config.mjs`, `biome.json` and `tsconfig.json` equal the kit shims after CRLF→LF and trimEnd + newline, and no other `astro.config.*` file exists. The root `biome.json` is the only Biome config: no other file named `biome.json`, `biome.jsonc`, `.biome.json` or `.biome.jsonc` exists in any folder of the project, outside `.git` and the folders that Biome skips (`node_modules`, `dist`, `.astro`, `.wrangler`). The rendered protected files equal the kit's rendering for the settings, compared in the same way: `.github/workflows/site.yml`, `.github/workflows/site-merge.yml`, `.github/dependabot.yml`, `.github/kit-identity.sh`, `.github/CODEOWNERS` and `.npmrc` (a file that does not match gets the hint of the protected task). `AGENTS.md` holds the kit block, and `CLAUDE.md` holds the line `@AGENTS.md`. Feature shims (`eslint.config.mjs`, `src/pages/api/forms/[form].ts`) are compared in `check`.",
    'A file that the kit manages is missing or differs from the text of the kit, or the project holds a second config file.',
    'For a shim, run `npx --no astro-kit init --shims --force`. Remove every other Astro or Biome config file. For a protected file: The protected files do not match the settings. Say so in the pull request: the owner starts the protected task for this branch.',
  ),
  r(
    'config-imports',
    'config',
    'config',
    'No source imports `astro:transitions` or `astro:transitions/client` (regex on `src/**/*.{astro,ts,tsx,js,mjs,jsx,mts,cts,cjs}`). White space and comments may stand between `from`, `import(` or `require(` and the module name.',
    'A source file imports `astro:transitions`.',
    'Remove the import and use native CSS view transitions.',
  ),
  r(
    'config-suppression',
    'config',
    'config',
    'Nothing takes a file out of the checks. `src/` contains no `biome-ignore`, `@ts-ignore`, `@ts-expect-error` or `@ts-nocheck`, in any letter case (`.astro .ts .tsx .js .mjs .jsx .mts .cts .cjs .css .md .mdx`). Each of these files has at most 1,048,576 B. No folder under `src/` or `public/` is named `node_modules`, `dist`, `.astro` or `.wrangler`, and no symbolic link there leads into such a folder. No symbolic link under `src/` or `public/` leads out of the project, and neither folder is such a link.',
    'A comment switches a check off, or a file lies where the checks do not read it.',
    'Remove the comment and fix the cause. Rename the folder, split the large file, or replace the link with a file inside the project. If the check is wrong, add an entry to `KIT-FEEDBACK.md`.',
  ),
  r(
    'config-server',
    'config',
    'config',
    'The project has no server code of its own: no `src/middleware.*` file and no `src/middleware/` folder, no `src/actions/` folder and no `src/actions.*` file, and no `server:defer` in a `.astro` file under `src/`.',
    'The project has server code of its own.',
    'Remove the middleware, the actions and `server:defer`. For a form, use the forms feature of the kit.',
  ),
  r(
    'config-waiver',
    'config',
    'config',
    'Each entry of `waivers` names a waivable rule. Its `until` is today or later, and at most 90 days after today (UTC). The message for an old entry: `the waiver for <rule> on <where> ended on <until>: fix the page, or ask the owner for a new date`.',
    'A waiver is not valid.',
    'Remove the waiver, or name a waivable rule and ask the owner for an `until` from today to 90 days ahead.',
  ),
  r(
    'config-overrides',
    'config',
    'config',
    '`package.json` has no `overrides` or `resolutions`.',
    '`package.json` changes which package versions npm installs.',
    'Remove `overrides` and `resolutions` from `package.json`.',
  ),
  r(
    'config-dep-spec',
    'config',
    'config',
    'Every dependency other than the kit has a spec of the npm registry: a version, a range or a tag. The trimmed spec matches `^(?!\\.)(?!.*\\.(tgz|tar|tar\\.gz)$)[\\w.*~^<>=|+ -]*$` in any letter case, in dependencies, devDependencies or optionalDependencies.',
    'A dependency does not come from the npm registry.',
    'Install the package from the npm registry with an exact version, for example `1.2.3`.',
  ),
  r(
    'config-dep-allowlist',
    'config',
    'config',
    'Dependencies are only: `astro`, `@raess/astro-kit`, `wrangler`; with forms `@astrojs/cloudflare`; with islands `@astrojs/solid-js`, `solid-js`, `eslint`, `eslint-plugin-solid`, `typescript-eslint`; plus `dependencies`. The rule reads dependencies, devDependencies, optionalDependencies and peerDependencies. A `package.json` that is not a JSON object fails, and so does a section that is not an object.',
    'A dependency is not on the allowed list, or `package.json` cannot be read.',
    'Remove the package, or ask the owner to add it to `dependencies` in `astro-kit.json`. Fix `package.json` when it is not a JSON object with objects as dependency sections.',
  ),
  r(
    'config-public-shadow',
    'config',
    'config',
    '`public/` holds none of `robots.txt`, `_headers`, `_redirects`, `.well-known/security.txt`, `_kit`, `sitemap*.xml`.',
    '`public/` holds a file that the kit writes.',
    'Delete the file from `public/`. The kit writes it into `dist/` at the end of the build.',
  ),
  // routes
  r(
    'routes-redirects',
    'routes',
    'config + build',
    '`redirects.json` rows are `{from, to}` or `{from, gone: true}`. `from` starts with `/` and has no whitespace and no `?` ("query strings cannot be matched; mark it gone or add a zone Single Redirect"). No duplicate `from`. `to` starts with `/`, not with `//` or `/\\`, and has no whitespace. No chains (no `to` is a `from`). Limits: 2,000 static, 100 dynamic, 1,000 characters per line. Every literal `to` is built (patterns, and `/api/` with forms, are skipped).',
    '`redirects.json` is not valid.',
    'Fix the row that the finding names. Point each `to` at a built page, or mark the row `gone`.',
  ),
  // images
  r(
    'images-public',
    'images',
    'config',
    '`public/` holds no raster file (`.png .jpg .jpeg .gif .webp .avif .bmp .tif .tiff`) except `favicon.ico`, `apple-touch-icon.png`, `og.png`, `og.jpg`.',
    '`public/` holds an image that Astro does not optimize.',
    'Move the image to `src/assets/` and render it with `<Picture>`.',
  ),
  r(
    'images-original',
    'images',
    'config',
    'Every raster file under `src/` is ≤ 2,560 px on its long edge and ≤ 3,145,728 B. The size is read from the PNG, GIF, WebP or JPEG header. A `.png`, `.gif`, `.webp`, `.jpg` or `.jpeg` file without such a header fails. So does a JPEG file with more than 4,096 markers and fill bytes before its frame header. A raster file of another format has the byte limit only.',
    'An image original is too large, or the kit cannot read its size.',
    'Scale the file down to at most 2,560 px on its long edge and at most 3,145,728 B. Replace a file that has no image header with the real image.',
  ),
  // facts
  r(
    'facts-schedule',
    'facts',
    'config',
    '`schedule.json` matches its strict schema.',
    '`schedule.json` is missing or not valid.',
    'Fix the field that the finding names. Days are `Mo` to `Su`, times are `HH:MM` and dates are `YYYY-MM-DD`.',
  ),
  // legal
  r(
    'legal-processing',
    'legal',
    'config',
    '`processing` contains `cdn` and `previews`, and with forms `forms` and `server`; it contains `forms`/`server` only with forms.',
    '`processing` does not match the features of the site.',
    'List `cdn` and `previews`. List `forms` and `server` with `features.forms`, and only then.',
  ),
];

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
  if (waiver.rule !== finding.rule || waiver.where === '') return false;
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

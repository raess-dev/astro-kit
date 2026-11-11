/**
 * Writes docs/standards.md from the rule registry, so the docs and the checks cannot drift.
 *   node src/docs.ts --write   writes the file
 *   node src/docs.ts --check   exits 1 when the file differs from the registry
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'astro/zod';
import { LIMITS, optionsSchema } from './options.ts';
import { getRule, RULES, type Stage } from './registry.ts';

export const STANDARDS_FILE = fileURLToPath(new URL('../docs/standards.md', import.meta.url));

/** The four stages a reader meets, and the registry stages each one runs. */
const STAGES: readonly { name: string; stages: readonly Stage[]; when: string }[] = [
  {
    name: 'Config',
    stages: ['config', 'routes'],
    when: '`npx --no astro-kit check`, and the start of every `astro build` and `astro dev`.',
  },
  { name: 'Build', stages: ['build'], when: 'the end of `astro build`, on the files in `dist/`.' },
  { name: 'Browser', stages: ['browser'], when: '`npx --no astro-kit test`, in headless Chromium on the built site.' },
  {
    name: 'Release',
    stages: ['ci', 'smoke', 'zone'],
    when: '`astro-kit ci` against the base branch and the live sitemap, `astro-kit smoke <url>` against production, `astro-kit provision zone --check`.',
  },
];

/** One line per astro-kit.json field. A schema field without a note fails the generator. */
const FIELD_NOTES: Record<string, string> = {
  site: 'Production origin: https, no path, no trailing slash.',
  locales: '`{code, tag, name}` each: the URL segment, the BCP 47 tag and the endonym.',
  defaultLocale: 'The locale at the root URLs. Effectively permanent.',
  nav: 'Page ids in the header navigation, in order.',
  features: '`forms` (contact endpoint and mail), `islands` (Solid), `scripts` (bundled vanilla scripts).',
  prefetch: '`speculationRules` (one static block) and `astroPrefetch` (Astro prefetch behind the kit gate).',
  contact: 'Needed with `features.forms`: `to`, `from` and an optional `probe`, all verified in Email Routing.',
  securityContact: 'The security.txt Contact: a `mailto:` or `https://` URL.',
  dependencies: 'Extra npm packages the owner allows.',
  limits: 'Stricter limits only: `headBytes`, `documentBytes`, `domElements`.',
};

/** WCAG 2.2 criteria the kit checks by machine, with the rules that check them. */
const WCAG_CHECKED: readonly [string, readonly string[]][] = [
  ['1.1.1 Non-text Content', ['images-attrs', 'svg-name', 'a11y-axe']],
  ['1.2.1 Audio-only and Video-only, 1.2.2 Captions', ['media-captions']],
  ['1.3.1 Info and Relationships', ['headings-order', 'forms-fields', 'a11y-axe']],
  ['1.3.5 Identify Input Purpose', ['forms-fields']],
  ['1.4.3 Contrast (Minimum), 1.4.6 Contrast (Enhanced) for body text', ['contrast-pairs', 'a11y-axe']],
  ['1.4.10 Reflow', ['a11y-reflow', 'css-banned']],
  ['1.4.11 Non-text Contrast', ['contrast-pairs', 'a11y-forced-colors']],
  ['1.4.12 Text Spacing', ['a11y-spacing']],
  ['2.1.1 Keyboard, 2.4.3 Focus Order', ['a11y-keyboard', 'a11y-no-js']],
  ['2.2.2 Pause, Stop, Hide', ['media-animated']],
  ['2.4.1 Bypass Blocks', ['html-shell']],
  ['2.4.2 Page Titled', ['head-title']],
  ['2.4.4 Link Purpose (In Context)', ['links-generic', 'links-same-name']],
  ['2.4.6 Headings and Labels', ['headings-h1', 'forms-fields']],
  ['2.4.7 Focus Visible, 2.4.13 Focus Appearance', ['a11y-focus']],
  ['2.4.11 Focus Not Obscured (Minimum)', ['a11y-keyboard']],
  ['2.5.8 Target Size (Minimum), 2.5.5 Target Size (Enhanced)', ['a11y-targets']],
  ['3.1.1 Language of Page', ['head-lang']],
  ['3.1.2 Language of Parts', ['content-language']],
  ['3.2.5 Change on Request', ['links-target-blank']],
  ['3.3.2 Labels or Instructions', ['forms-fields']],
  ['4.1.2 Name, Role, Value', ['a11y-axe', 'svg-name']],
];

const WCAG_REVIEWED = [
  'Alt text that says what the image means (1.1.1), and no images of text (1.4.5).',
  'Headings, labels and link text that describe their target (2.4.4, 2.4.6).',
  'Reading order that matches the meaning (1.3.2), and consistent navigation and names (3.2.3, 3.2.4).',
  'Error messages that name the field and the fix (3.3.1, 3.3.3).',
];

const WCAG_UNVERIFIED = [
  'Real screen readers (NVDA, JAWS, VoiceOver, TalkBack), including how the form result is announced.',
  'Safari and Firefox: the browser checks run in Chromium only, so bfcache and prerender reuse there is unverified.',
  'Human-only criteria: caption and audio-description quality (1.2.3, 1.2.5), sensory wording (1.3.3), use of colour (1.4.1), flashing video (2.3.1), and plain language.',
];

/** What a privacy page declares per feature; the legal-processing rule enforces the keys. */
const PROCESSING: readonly [key: string, when: string, what: string][] = [
  [
    'cdn',
    'always',
    'Cloudflare processes the IP address, user agent and requested URL to deliver and protect the site. Transfer to the U.S. rests on the Swiss-U.S. and EU-U.S. Data Privacy Framework.',
  ],
  [
    'forms',
    '`features.forms`',
    "Cloudflare Email Routing delivers the message to the owner's mailbox. A rate limiter keyed by IP address counts submissions for 60 seconds.",
  ],
  [
    'server',
    '`features.forms`',
    'Workers Logs keep request logs for up to 7 days. The endpoint logs error codes only, never form content.',
  ],
  [
    'previews',
    'always',
    "Cloudflare Access sends a one-time PIN to a reviewer's email address before a preview opens.",
  ],
];

/** Wraps HTML tags in backticks, so a rendered page shows them instead of dropping them. */
const tags = (text: string): string => text.replace(/(?<!`)<\/?[A-Za-z][^<>`]*>(?!`)/g, (tag) => `\`${tag}\``);

const kb = (bytes: number): string => (bytes >= 1024 * 1024 ? `${bytes / 1024 / 1024} MB` : `${bytes / 1024} KB`);

function limitsTable(): string[] {
  const rows = Object.entries(LIMITS).map(
    ([key, value]) => `| \`${key}\` | ${/Bytes$/.test(key) ? kb(value) : value} |`,
  );
  return ['| Limit | Value |', '|---|---|', ...rows];
}

function optionsTable(): string[] {
  const schema = z.toJSONSchema(optionsSchema, { io: 'input', unrepresentable: 'any' }) as {
    properties: Record<string, { default?: unknown }>;
    required?: string[];
  };
  const rows: string[] = [];
  for (const [key, field] of Object.entries(schema.properties)) {
    if (key === '$schema') continue;
    const note = FIELD_NOTES[key];
    if (!note) throw new Error(`astro-kit docs: astro-kit.json field "${key}" has no note in src/docs.ts`);
    const value = schema.required?.includes(key) ? 'required' : `\`${JSON.stringify(field.default ?? null)}\``;
    rows.push(`| \`${key}\` | ${value} | ${note} |`);
  }
  return ['| Field | Default | Meaning |', '|---|---|---|', ...rows];
}

/** The whole of docs/standards.md. */
export function renderStandards(): string {
  const out = [
    '# The astro-kit standard',
    '',
    'Generated from `src/registry.ts` by `npm run docs`. Do not edit it by hand.',
    '',
    '## How to read a failure',
    '',
    'Every failing check prints the same three lines:',
    '',
    '```text',
    '✗ [head-title] /fr/contact/: A title is too short, too long or duplicated. (12 characters)',
    '    fix: Write a distinct title for the page.',
    '    rule: node_modules/@raess/astro-kit/docs/standards.md#head-title',
    '```',
    '',
    'The id in brackets is the rule below. Then come the place, the meaning and the value found. Fix the cause; never silence a check.',
    'If a check looks wrong, add an entry to `KIT-FEEDBACK.md` and keep the check.',
    '',
    '## Stages',
    '',
    '| Stage | Runs in | Groups |',
    '|---|---|---|',
  ];
  for (const stage of STAGES) {
    const groups = [...new Set(RULES.filter((r) => stage.stages.includes(r.stage)).map((r) => r.group))];
    out.push(`| ${stage.name} | ${stage.when} | ${groups.join(', ')} |`);
  }
  for (const group of new Set(RULES.map((r) => r.group))) {
    out.push('', `## ${group}`, '');
    for (const rule of RULES.filter((r) => r.group === group)) {
      out.push(`- <a id="${rule.id}"></a>**${rule.id}** — ${tags(rule.standard)} Fix: ${tags(rule.hint)}`);
    }
    if (group === 'config') out.push('', '### astro-kit.json', '', ...optionsTable());
    if (group === 'budgets') {
      out.push('', 'Sizes are compressed: the larger of zstd level 3 and brotli level 5.', '', ...limitsTable());
    }
  }
  out.push(
    '',
    '## WCAG 2.2 coverage',
    '',
    'The floor is WCAG 2.2 AA, plus AAA focus appearance, 44 px targets and 7:1 body text.',
    '',
  );
  out.push('Checked by machine:', '');
  // getRule throws on an id the registry does not have.
  for (const [criteria, ids] of WCAG_CHECKED) {
    out.push(`- ${criteria}: ${ids.map((id) => `[${getRule(id).id}](#${id})`).join(', ')}`);
  }
  out.push(
    '',
    'Reviewed by the agent with `npx --no astro-kit test --outline <url>`, which prints headings, landmarks, links, labels and alt text:',
    '',
  );
  for (const line of WCAG_REVIEWED) out.push(`- ${line}`);
  out.push('', 'Not verified:', '');
  for (const line of WCAG_UNVERIFIED) out.push(`- ${line}`);
  out.push(
    '',
    '## Privacy processing',
    '',
    'Each privacy page lists these keys in `processing` ([legal-processing](#legal-processing)).',
    '',
  );
  out.push('| Key | Declared | What is processed |', '|---|---|---|');
  for (const [key, when, what] of PROCESSING) out.push(`| \`${key}\` | ${when} | ${what} |`);
  return `${out.join('\n')}\n`;
}

/** Runs the command line; returns the exit code. Messages go to `log`, stderr by default. */
export function run(
  args: readonly string[],
  file = STANDARDS_FILE,
  log: (line: string) => unknown = (line) => process.stderr.write(`${line}\n`),
): number {
  const text = renderStandards();
  if (args.includes('--write')) {
    writeFileSync(file, text);
    return 0;
  }
  if (args.includes('--check')) {
    if (existsSync(file) && readFileSync(file, 'utf8') === text) return 0;
    log(`astro-kit docs: ${file} is out of date; run npm run docs.`);
    return 1;
  }
  log('usage: node src/docs.ts --write | --check');
  return 2;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = run(process.argv.slice(2));

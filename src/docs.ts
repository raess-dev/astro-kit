/**
 * Writes docs/standards.md from the rule registry, so the docs and the checks cannot differ.
 *   node src/docs.ts --write   writes the file
 *   node src/docs.ts --check   exits 1 when the file differs from the registry
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOCS_PATH, RULES, type Rule, type Stage } from './registry.ts';

export const STANDARDS_FILE = fileURLToPath(new URL('../docs/standards.md', import.meta.url));

/** The stages of section 8, in the order a reader meets them, with the command that runs each. */
const STAGES: readonly { stage: Stage; when: string }[] = [
  { stage: 'config', when: '`npx --no astro-kit check`, and the start of `astro build` and `astro dev`.' },
  {
    stage: 'config + build',
    when: 'On the source like a config rule, and again on `dist/`. The output is the authority.',
  },
  { stage: 'build', when: 'The end of `astro build`, on the files in `dist/`.' },
  { stage: 'browser', when: '`npx --no astro-kit test`, in Chromium on the built site.' },
  { stage: 'ci', when: '`npx --no astro-kit ci` and the site workflow.' },
  { stage: 'smoke', when: '`npx --no astro-kit smoke <origin>`, against production.' },
  { stage: 'zone', when: '`npx --no astro-kit provision zone`.' },
];

/** Wraps an HTML tag outside a code span in backticks, so a rendered page shows it instead of dropping it. */
const tags = (text: string): string =>
  text.replace(/`[^`]*`|<\/?[A-Za-z][^<>`]*>/g, (match) => (match.startsWith('`') ? match : `\`${match}\``));

const marks = (rule: Rule): string => {
  const out: string[] = [];
  if (rule.level === 'warn') out.push('warning');
  if (rule.waivable) out.push('waivable');
  return out.length > 0 ? ` (${out.join(', ')})` : '';
};

/** The whole of docs/standards.md. */
export function renderStandards(rules: readonly Rule[] = RULES): string {
  const out = [
    '# The astro-kit standard',
    '',
    'Generated from `src/registry.ts` by `npm run docs`. Do not edit it by hand.',
    '',
    '## How to read a result',
    '',
    'Every failing check prints the same three lines:',
    '',
    '```text',
    '✗ [<id>] <where>: <message> (<detail>)',
    '    fix: <hint>',
    `    rule: ${DOCS_PATH}#<id>`,
    '```',
    '',
    '- The id in brackets is the rule below. Then come the place, the meaning and the value found.',
    '- `!` in place of `✗` is a warning. It fails nothing now, and its message says when it becomes an error.',
    '- `~` is a finding that a waiver in `astro-kit.json` covers, with its end date and its reason.',
    '- Fix the cause. Never silence a check. If a check looks wrong, add an entry to `KIT-FEEDBACK.md`.',
    '',
    '## Stages',
    '',
    '| Stage | Runs in | Groups |',
    '|---|---|---|',
  ];
  for (const { stage, when } of STAGES) {
    const groups = [...new Set(rules.filter((rule) => rule.stage === stage).map((rule) => rule.group))];
    out.push(`| ${stage} | ${when} | ${groups.join(', ')} |`);
  }
  out.push('', '## Rules', '', `${rules.length} rules in ${new Set(rules.map((rule) => rule.group)).size} groups.`);
  for (const group of new Set(rules.map((rule) => rule.group))) {
    out.push('', `### ${group}`, '');
    for (const rule of rules.filter((entry) => entry.group === group)) {
      out.push(
        `- <a id="${rule.id}"></a>**${rule.id}**${marks(rule)} — ${tags(rule.standard)} Fix: ${tags(rule.hint)}`,
      );
    }
  }
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
    mkdirSync(dirname(file), { recursive: true });
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

if (import.meta.main) process.exitCode = run(process.argv.slice(2));

/**
 * The agent files part of `config-shim` (12.1, part 9c of M9): the kit block of `AGENTS.md` and the line
 * `@AGENTS.md` of `CLAUDE.md`. One passing and many failing cases, on temp files.
 */
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { getRule, Report } from '../../src/registry.ts';
import {
  AGENTS_FILE,
  CLAUDE_FILE,
  checkAgentFiles,
  KIT_BLOCK,
  KIT_BLOCK_END,
  KIT_BLOCK_START,
} from '../../src/shims.ts';
import { type Files, inTemp } from './fixtures.ts';
import { specBlock } from './spec.ts';

const RULE = 'config-shim';
const OWN = '# Hotel\n\nOur own instructions.\n\n';
const AGENTS = `${OWN}${KIT_BLOCK}\n\nMore of our own lines.\n`;
const PASSING: Files = { [AGENTS_FILE]: AGENTS, [CLAUDE_FILE]: '@AGENTS.md\n' };

/** The findings of the agent files in a root, as `<where>: <detail>`. */
function findingsOf(files: Files, folders: readonly string[] = []): string[] {
  return inTemp(files, (root) => {
    for (const folder of folders) mkdirSync(join(root, folder), { recursive: true });
    const report = new Report();
    checkAgentFiles(root, report);
    return report.findings.map(
      (finding) => `${finding.rule === RULE ? '' : `${finding.rule} `}${finding.where}: ${finding.detail}`,
    );
  });
}

/** The line number in `AGENTS` of the line `n` of the kit block, counted from 1. */
const lineOf = (n: number): number => OWN.split('\n').length - 1 + n;

test('the kit block is the block of 12.1, from the start line to the end line', () => {
  const template = specBlock('The template that `init` writes:', 'md');
  const start = template.indexOf(KIT_BLOCK_START);
  const end = template.indexOf(KIT_BLOCK_END) + KIT_BLOCK_END.length;
  assert.equal(template.slice(start, end), KIT_BLOCK);
  assert.equal(KIT_BLOCK.startsWith(`${KIT_BLOCK_START}\n`), true);
  assert.equal(KIT_BLOCK.endsWith(`\n${KIT_BLOCK_END}`), true);
});

const CASES: readonly (readonly [string, Files, readonly string[]])[] = [
  ['the block with the project lines around it, and CLAUDE.md with the line', PASSING, []],
  ['the block with CRLF line ends', { ...PASSING, [AGENTS_FILE]: AGENTS.replace(/\n/g, '\r\n') }, []],
  ['the block alone, without a final newline', { ...PASSING, [AGENTS_FILE]: KIT_BLOCK }, []],
  ['CLAUDE.md with more lines', { ...PASSING, [CLAUDE_FILE]: '# Claude\r\n@AGENTS.md\r\nUse the kit.' }, []],
  ['no AGENTS.md', { [CLAUDE_FILE]: '@AGENTS.md\n' }, ['AGENTS.md: the file is missing']],
  ['no CLAUDE.md', { [AGENTS_FILE]: AGENTS }, ['CLAUDE.md: the file is missing']],
  ['no file at all', {}, ['AGENTS.md: the file is missing', 'CLAUDE.md: the file is missing']],
  [
    'AGENTS.md without the block',
    { ...PASSING, [AGENTS_FILE]: OWN },
    ['AGENTS.md: the kit block is missing: copy it from `node_modules/@raess/astro-kit/templates/site/AGENTS.md.tmpl`'],
  ],
  [
    'a start line with spaces after it is no start line',
    { ...PASSING, [AGENTS_FILE]: AGENTS.replace(KIT_BLOCK_START, `${KIT_BLOCK_START} `) },
    ['AGENTS.md: the kit block is missing: copy it from `node_modules/@raess/astro-kit/templates/site/AGENTS.md.tmpl`'],
  ],
  [
    'one changed word in a rule line',
    { ...PASSING, [AGENTS_FILE]: AGENTS.replace('Never weaken a check.', 'Weaken a check when it helps.') },
    [
      `AGENTS.md:${lineOf(14)}: the kit block has \`- When you work around the kit, or a check seems wrong, add an entry to \`KIT-FEEDBACK.md\`. Never weaken a check.\` here`,
    ],
  ],
  [
    'a rule line removed',
    {
      ...PASSING,
      [AGENTS_FILE]: AGENTS.replace(
        "- Never approve or merge a pull request. Never act with the owner's account.\n",
        '',
      ),
    },
    [
      `AGENTS.md:${lineOf(9)}: the kit block has \`- Never approve or merge a pull request. Never act with the owner's account.\` here`,
    ],
  ],
  [
    'a line added inside the block',
    {
      ...PASSING,
      [AGENTS_FILE]: AGENTS.replace(`\n${KIT_BLOCK_END}`, `\n- Merge your own pull request.\n${KIT_BLOCK_END}`),
    },
    [`AGENTS.md:${lineOf(15)}: the kit block has \`${KIT_BLOCK_END}\` here`],
  ],
  [
    'an empty line removed inside the block',
    { ...PASSING, [AGENTS_FILE]: AGENTS.replace('## Kit rules\n\n', '## Kit rules\n') },
    [`AGENTS.md:${lineOf(3)}: the kit block has an empty line here`],
  ],
  [
    'a second block',
    { ...PASSING, [AGENTS_FILE]: `${AGENTS}${KIT_BLOCK}\n` },
    [`AGENTS.md:${lineOf(16) + 2}: a second marker line of the kit block: the file holds one block`],
  ],
  [
    'a second end line',
    { ...PASSING, [AGENTS_FILE]: `${AGENTS}${KIT_BLOCK_END}\n` },
    [`AGENTS.md:${lineOf(16) + 2}: a second marker line of the kit block: the file holds one block`],
  ],
  [
    'a start line without an end line',
    { ...PASSING, [AGENTS_FILE]: AGENTS.replace(`\n${KIT_BLOCK_END}`, '') },
    [`AGENTS.md:${lineOf(1)}: the kit block has no line \`${KIT_BLOCK_END}\` after its start`],
  ],
  [
    'the end line before the start line',
    { ...PASSING, [AGENTS_FILE]: `${KIT_BLOCK_END}\n${KIT_BLOCK.replace(`\n${KIT_BLOCK_END}`, '')}\n` },
    [`AGENTS.md:2: the kit block has no line \`${KIT_BLOCK_END}\` after its start`],
  ],
  [
    'CLAUDE.md without the line',
    { ...PASSING, [CLAUDE_FILE]: 'Read AGENTS.md.\n@AGENTS.md is here\n' },
    ['CLAUDE.md: the file has no line `@AGENTS.md`'],
  ],
  ['CLAUDE.md empty', { ...PASSING, [CLAUDE_FILE]: '' }, ['CLAUDE.md: the file has no line `@AGENTS.md`']],
];

for (const [name, files, expected] of CASES) {
  test(`config-shim, the agent files: ${name}`, () => {
    assert.deepEqual(findingsOf(files), expected);
  });
}

test('config-shim, the agent files: a folder in place of a file fails', () => {
  assert.deepEqual(findingsOf({}, [AGENTS_FILE, CLAUDE_FILE]), [
    'AGENTS.md: this is not a file',
    'CLAUDE.md: this is not a file',
  ]);
});

test('the rule text names the agent files, and its hint says where the block comes from', () => {
  const rule = getRule(RULE);
  assert.equal(rule.standard.includes('`AGENTS.md` holds the kit block'), true);
  assert.equal(rule.standard.includes('`CLAUDE.md` holds the line `@AGENTS.md`'), true);
  assert.equal(rule.hint.includes('templates/site/AGENTS.md.tmpl'), true);
});

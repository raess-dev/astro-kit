import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { renderStandards, run, STANDARDS_FILE } from '../../src/docs.ts';
import { RULES, r } from '../../src/registry.ts';

test('docs/standards.md is up to date', () => {
  assert.equal(readFileSync(STANDARDS_FILE, 'utf8'), renderStandards(), 'run npm run docs');
});

test('standards.md has one anchor for each rule, and names the count', () => {
  const text = renderStandards();
  const anchors = [...text.matchAll(/<a id="([a-z0-9-]+)"><\/a>/g)].map((match) => match[1]);
  assert.deepEqual(
    anchors,
    RULES.map((rule) => rule.id),
  );
  const groups = new Set(RULES.map((rule) => rule.group)).size;
  assert.ok(text.includes(`${RULES.length} rules in ${groups} groups.`));
});

test('a rule is rendered with its anchor, its marks, its standard and its hint', () => {
  const text = renderStandards([
    r('head-title', 'head', 'build', 'A <title> has 15 to 70 code points.', 'A title is wrong.', 'Write a title.'),
    r('config-shim', 'config', 'config', 'A shim equals the kit text.', 'A shim differs.', 'Run init.', 'warn'),
  ]);
  assert.ok(
    text.includes(
      '- <a id="head-title"></a>**head-title** (waivable) — A `<title>` has 15 to 70 code points. Fix: Write a title.',
    ),
  );
  assert.ok(
    text.includes('- <a id="config-shim"></a>**config-shim** (warning) — A shim equals the kit text. Fix: Run init.'),
  );
  assert.ok(text.includes('| build | The end of `astro build`, on the files in `dist/`. | head |'));
  assert.ok(text.includes('2 rules in 2 groups.'));
});

test('a tag inside a code span stays as it is; a tag outside one gets backticks', () => {
  const text = renderStandards([
    r('a-b', 'g', 'build', 'Use `the <title> element` once. Chain `<main><h1><span>` nests.', 'm', 'A <p> has it.'),
    r('c-d', 'g', 'build', 'The message is `the waiver for <rule> on <where> ended on <until>`.', 'm', 'h'),
  ]);
  assert.ok(text.includes('— Use `the <title> element` once. Chain `<main><h1><span>` nests. Fix: A `<p>` has it.'));
  assert.ok(text.includes('— The message is `the waiver for <rule> on <where> ended on <until>`. Fix: h'));
  assert.ok(text.endsWith('\n'));
});

test('the docs command: --write gives 0, --check gives 1 when stale, no flag gives 2', () => {
  const dir = mkdtempSync(join(tmpdir(), 'astro-kit-'));
  try {
    const file = join(dir, 'docs', 'standards.md');
    const log: string[] = [];
    const say = (line: string) => log.push(line);
    assert.equal(run(['--check'], file, say), 1, 'a missing file is stale');
    assert.equal(run(['--write'], file, say), 0);
    assert.equal(readFileSync(file, 'utf8'), renderStandards());
    assert.equal(run(['--check'], file, say), 0);
    writeFileSync(file, 'stale\n');
    assert.equal(run(['--check'], file, say), 1);
    assert.equal(run([], file, say), 2);
    assert.match(log.at(-1) ?? '', /^usage: /);
    assert.equal(log.filter((line) => line.includes('out of date')).length, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

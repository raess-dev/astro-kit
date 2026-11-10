import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { renderStandards, run, STANDARDS_FILE } from '../../src/docs.ts';
import { RULES } from '../../src/registry.ts';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = (path: string): string => readFileSync(join(ROOT, path), 'utf8');
const lines = (path: string): number => read(path).trimEnd().split('\n').length;

function walk(dir: string, keep: (file: string) => boolean, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', 'dist', '.astro'].includes(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, keep, out);
    else if (keep(path)) out.push(path);
  }
  return out;
}

test('docs/standards.md is up to date', () => {
  assert.equal(readFileSync(STANDARDS_FILE, 'utf8'), renderStandards(), 'run npm run docs');
});

test('--check fails on a stale file and passes after --write', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'kit-docs-')), 'standards.md');
  writeFileSync(file, '# stale\n');
  const logged: string[] = [];
  const log = (line: string) => logged.push(line);
  assert.equal(run(['--check'], file, log), 1);
  assert.match(logged[0] ?? '', /out of date/);
  assert.equal(run(['--write'], file, log), 0);
  assert.equal(run(['--check'], file, log), 0);
  assert.equal(run([], file, log), 2);
});

test('every rule has one anchor, and every anchor is a rule', () => {
  const anchors = [...read('docs/standards.md').matchAll(/<a id="([a-z0-9-]+)"><\/a>/g)].map((m) => m[1]);
  assert.deepEqual(anchors.toSorted(), RULES.map((r) => r.id).toSorted());
});

test('rule links in the docs name registry ids', () => {
  const ids = new Set(RULES.map((r) => r.id));
  for (const file of walk(join(ROOT, 'docs'), (f) => f.endsWith('.md'))) {
    for (const [, id] of read(relative(ROOT, file)).matchAll(/standards\.md#([a-z0-9-]+)/g)) {
      assert.ok(ids.has(id ?? ''), `${relative(ROOT, file)} links to unknown rule ${id}`);
    }
  }
});

test('relative links in the docs resolve', () => {
  const files = [
    ...walk(join(ROOT, 'docs'), (f) => f.endsWith('.md')),
    join(ROOT, 'README.md'),
    join(ROOT, 'CONTRIBUTING.md'),
  ];
  for (const file of files) {
    for (const [, target] of readFileSync(file, 'utf8').matchAll(/\]\(([^)#\s]+\.md)(?:#[^)]*)?\)/g)) {
      if (/^[a-z]+:/.test(target ?? '')) continue;
      assert.doesNotThrow(() => readFileSync(join(dirname(file), target ?? '')), `${relative(ROOT, file)} → ${target}`);
    }
  }
});

test('the docs keep their length limits', () => {
  assert.ok(lines('docs/INDEX.md') <= 100, `INDEX.md has ${lines('docs/INDEX.md')} lines`);
  const index = read('docs/INDEX.md');
  const differs = index.slice(index.indexOf('## Where this kit differs from the Astro docs'));
  assert.ok(
    differs.length > 0 && differs.trimEnd().split('\n').length <= 16,
    'the Astro docs section has 15 lines or fewer',
  );
  for (const file of readdirSync(join(ROOT, 'docs/recipes'))) {
    assert.ok(lines(`docs/recipes/${file}`) <= 40, `${file} has ${lines(`docs/recipes/${file}`)} lines`);
    assert.match(index, new RegExp(`recipes/${file.replace('.', '\\.')}`), `INDEX.md routes to ${file}`);
  }
});

// Every rule needs a failing test somewhere; this lists the ids no test file names yet.
const uncovered = (): string[] => {
  const text = walk(join(ROOT, 'test'), (f) => f.endsWith('.test.ts') && !f.endsWith('docs.test.ts'))
    .map((f) => readFileSync(f, 'utf8'))
    .join('\n');
  return RULES.map((r) => r.id).filter((id) => !new RegExp(`(?<![a-z0-9-])${id}(?![a-z0-9-])`).test(text));
};

test('every registry id appears in a test file', () => {
  assert.deepEqual(uncovered(), []);
});

test('examples/ equals the fixture sources', () => {
  const pairs: [string, string][] = [
    ['examples/site', 'test/fixtures/good/src'],
    ['examples/islands', 'test/fixtures/islands/src'],
  ];
  const files = (dir: string) => walk(join(ROOT, dir), () => true).map((f) => f.slice(join(ROOT, dir).length));
  for (const [copy, source] of pairs) {
    assert.deepEqual(files(copy).sort(), files(source).sort(), `${copy} lists the same files as ${source}`);
    for (const f of files(source)) {
      const same = readFileSync(join(ROOT, copy, f)).equals(readFileSync(join(ROOT, source, f)));
      assert.ok(same, `${copy}${f} differs from ${source}${f}; copy it again`);
    }
  }
});

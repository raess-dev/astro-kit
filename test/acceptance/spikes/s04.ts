import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { astro, build, plain, read, record, styles } from '../harness.ts';
import { page, project } from './project.ts';

const TOKENS = '@layer tokens {\n  :root {\n    --color-text: #222222;\n    --size-m: 48rem;\n  }\n}\n';

/** A component file whose layer block holds one rule and the `inner` text. */
const card = (inner = ''): string => `@layer components {\n  .card {\n    display: block;\n  }\n${inner}}\n`;
const block = (prelude: string): string => `  ${prelude} {\n    .card {\n      display: grid;\n    }\n  }\n`;

const files = (css: string, body = ''): Record<string, string> => ({
  'src/styles/tokens.css': TOKENS,
  'src/styles/components/card.css': css,
  'src/components/Card.astro':
    '---\nimport \'../styles/components/card.css\';\n---\n<div class="card"><slot /></div>\n',
  'src/pages/index.astro': page(
    'Home',
    `<Card>a</Card><p>x</p>${body}`,
    "import Card from '../components/Card.astro';",
  ),
});

/** The preludes of the top-level rules of built CSS: the text before each `{` that is in no other block. */
function topLevel(css: string): string[] {
  const preludes: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < css.length; index += 1) {
    const char = css[index];
    if (char === '{') {
      if (depth === 0) preludes.push(css.slice(start, index).trim());
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) start = index + 1;
    } else if (char === ';' && depth === 0) {
      start = index + 1;
    }
  }
  return preludes;
}

interface Failure {
  /** The exit code and the error line of the CSS minifier. */
  result: { status: number | null; error: string };
  /** Each expectation that the failed build does not meet. */
  unmet: string[];
}

/** Builds a case that must fail. The test asserts that `unmet` is empty. */
function failed(name: string, prelude: string): Failure {
  const dir = project(name, files(card(block(prelude))));
  const run = astro(dir);
  const output = plain(run.output);
  const error = /\[lightningcss minify\] ([^\n]*)/.exec(output)?.[1]?.trim() ?? '';
  const unmet: string[] = [];
  if (run.status === 0) unmet.push(`the build with ${prelude} must fail:\n${output.slice(-2000)}`);
  if (existsSync(join(dir, 'dist'))) unmet.push('a failed build writes no dist folder');
  if (!(output.includes('[ERROR] [vite]') && output.includes('Build failed'))) {
    unmet.push('Astro reports a failed Vite build');
  }
  if (error === '') unmet.push(`the error comes from the CSS minifier:\n${output.slice(-2000)}`);
  // The error names a line of the merged chunk, never the source file.
  if (output.includes('card.css')) unmet.push('the error does not name the source file');
  return { result: { status: run.status, error }, unmet };
}

test('S4: a scoped <style> in .astro is unlayered', () => {
  const dir = project('s04', files(card(), '<style>\n  p {\n    color: red;\n  }\n</style>'));
  build(dir);
  const html = read(dir, 'dist/index.html');
  assert.equal(html.match(/<style/g)?.length, 1, 'the scoped rule is merged into the one <style>');
  const scope = /<p (data-astro-cid-[a-z0-9]+)>/.exec(html)?.[1] ?? '';
  assert.notEqual(scope, '', 'Astro marks the element with a data-astro-cid attribute');
  const css = styles(html);
  assert.ok(css.includes(`p[${scope}]{color:red}`), 'the scoped rule is in the page');
  const preludes = topLevel(css);
  assert.ok(preludes.includes(`p[${scope}]`), 'the scoped rule is a top-level rule: it is in no @layer');
  assert.ok(preludes.includes('@layer components'), 'the component file keeps its layer');
  record('S4.scopedStyle', 'unlayered, top level, selector p[data-astro-cid-*]');
});

test('S4: a literal length in an @media and an @container prelude builds', () => {
  const dir = project(
    's04-literal',
    files(card(block('@media (width < 48rem)') + block('@container (width < 48rem)'))),
  );
  build(dir);
  const css = styles(read(dir, 'dist/index.html'));
  assert.ok(css.includes('@media (width<48rem){.card{display:grid}}'), 'the @media block ships');
  assert.ok(css.includes('@container (width<48rem){.card{display:grid}}'), 'the @container block ships');
});

test('S4: var() in an @media prelude fails the build with an error of the CSS minifier', () => {
  const range = failed('s04-media', '@media (width < var(--size-m))');
  assert.deepEqual(range.unmet, []);
  const legacy = failed('s04-media-legacy', '@media (min-width: var(--size-m))');
  assert.deepEqual(legacy.unmet, []);
  record('S4.mediaVar', range.result);
  record('S4.mediaVarLegacy', legacy.result);
});

test('S4: var() in an @container prelude fails the build in the same way', () => {
  const container = failed('s04-container', '@container (width < var(--size-m))');
  assert.deepEqual(container.unmet, []);
  record('S4.containerVar', container.result);
});

test('S4: with the CSS minifier off, var() in an @media prelude builds and ships as written', () => {
  const dir = project(
    's04-no-minify',
    files(card(block('@media (width < var(--size-m))'))),
    "{ config: { vite: { build: { cssMinify: false, cssTarget: ['chrome123', 'edge123', 'firefox120', 'safari17.5'] } } } }",
  );
  build(dir);
  const css = styles(read(dir, 'dist/index.html'));
  assert.ok(css.includes('@media (width < var(--size-m))'), 'the invalid prelude reaches the page');
  record('S4.mediaVarNoMinify', 'builds; the prelude ships as written');
});

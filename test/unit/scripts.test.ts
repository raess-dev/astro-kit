/**
 * The source halves of `js-script`, `js-prefetch-attr`, `js-directive` and `csp-hash` (part 8a of M8; specification,
 * section 8 and 6.1, step 2.4): the scanner of `.astro` start tags on strings, and the four checks on small temp
 * folders written from strings (14.1).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Options } from '../../src/options.ts';
import { Report } from '../../src/registry.ts';
import { allowsSourceScripts, astroTags, checkScriptSources, templateStart } from '../../src/scripts.ts';
import { inTemp, optionsOf, origin, SMALLEST } from './fixtures.ts';

/** The tags of a text as `<line> <name> <attribute=value …>`. */
const tagsOf = (text: string): string[] =>
  astroTags(text).map(
    (tag) =>
      `${tag.line} ${tag.name}${[...tag.attributes].map(([name, value]) => ` ${name}${value === undefined ? '' : `=${value}`}`).join('')}`,
  );

test('astroTags reads the start tags of the template with their attributes and lines', () => {
  const text = [
    '---',
    "import Counter from '../components/Counter.tsx';",
    "const s = '<script>alert(1)</script>';",
    '---',
    '<Page title="Start">',
    '  <!-- <script is:inline>x()</script> -->',
    "  <a href={x > 1 ? '/a/' : '/b/'} data-astro-prefetch>Link</a>",
    '  <script>if (a < b) document.write("<a data-astro-prefetch>")</script>',
    '  <Counter client:visible={{ rootMargin: "10px" }} {...props} />',
    `  <p class=\`x \${y}\` id=one>{cond && <script type='module' />}</p>`,
    '</Page>',
  ].join('\n');
  assert.deepEqual(tagsOf(text), [
    '5 Page title=Start',
    "7 a href={x > 1 ? '/a/' : '/b/'} data-astro-prefetch",
    '8 script',
    '9 Counter client:visible={{ rootMargin: "10px" }}',
    `10 p class=x \${y} id=one`,
    '10 script type=module',
  ]);
});

test('templateStart skips the frontmatter between its fences, and a file without one starts at 0', () => {
  assert.equal(templateStart('<p>x</p>'), 0);
  assert.equal(templateStart('---\nconst a = 1;\n---\n<p>'), '---\nconst a = 1;\n---'.length);
  assert.equal(templateStart('\n  ---\nconst a = "---";\n---\n<p>'), '\n  ---\nconst a = "---";\n---'.length);
  assert.equal(templateStart('---\nno end'), '---\nno end'.length);
  assert.deepEqual(tagsOf('---\n<script>\n'), []);
});

test('astroTags never throws and stays linear on hostile text', () => {
  const hostile = [
    '<a href="',
    '<a href={',
    "<p {...{ a: '}' }} b>",
    '<script>',
    '<style>',
    '<!--',
    '<',
    '<a b=`',
    '<a /',
    '{'.repeat(10_000),
    `<a ${'x='.repeat(50_000)}>`,
    `<p>${'<b>'.repeat(50_000)}`,
  ];
  for (const text of hostile) assert.ok(Array.isArray(astroTags(text)), text.slice(0, 20));
  const started = Date.now();
  astroTags(`<a href={${"'".repeat(200_000)}}>${'<i a="1">'.repeat(100_000)}`);
  assert.ok(Date.now() - started < 2_000, 'a hostile text takes seconds');
});

/** The findings of the four checks on a project with one `.astro` file, as `<id> <where> <detail>`. */
function sourceFindings(file: string, options: Options | undefined): string[] {
  return inTemp({ 'src/pages/index.astro': file }, (root) => {
    const report = new Report();
    checkScriptSources(root, options, report);
    return report.findings.map((finding) => `${finding.rule} ${finding.where} ${finding.detail ?? ''}`.trimEnd());
  });
}

const STATIC = optionsOf(SMALLEST);
const SCRIPTS = optionsOf({ ...SMALLEST, features: { scripts: true } });
const ISLANDS = optionsOf({ ...SMALLEST, features: { islands: true } });
const PAGE_SCRIPT = optionsOf({ ...SMALLEST, origins: [origin('js.pay.example', ['script'], { load: 'page' })] });
const GESTURE_SCRIPT = optionsOf({
  ...SMALLEST,
  features: { islands: true },
  origins: [origin('js.pay.example', ['script'], { load: 'gesture' })],
});

test('allowsSourceScripts: scripts or an origin with script and load page; islands alone allow none', () => {
  assert.deepEqual([STATIC, SCRIPTS, ISLANDS, PAGE_SCRIPT, GESTURE_SCRIPT].map(allowsSourceScripts), [
    false,
    true,
    false,
    true,
    false,
  ]);
  assert.equal(allowsSourceScripts({ ...STATIC, origins: GESTURE_SCRIPT.origins }), false);
});

test('js-script, source half: a <script> other than JSON-LD needs scripts or a page script origin', () => {
  const script = '<p>x</p>\n<script>console.log(1)</script>\n';
  const cases: readonly [name: string, file: string, options: Options | undefined, found: string[]][] = [
    ['JSON-LD', '<script type="application/ld+json" set:html={data} />\n', STATIC, []],
    ['JSON-LD in another case, with spaces', '<script type=" Application/LD+JSON ">{}</script>\n', STATIC, []],
    [
      'a script, no feature',
      script,
      STATIC,
      ['js-script src/pages/index.astro:2 <script> needs features.scripts or a page script origin'],
    ],
    [
      'a module script, no feature',
      '<script type="module" src="/a.js"></script>',
      STATIC,
      ['js-script src/pages/index.astro:1 <script> needs features.scripts or a page script origin'],
    ],
    [
      'a type that is an expression',
      '<script type={kind}>{}</script>',
      STATIC,
      ['js-script src/pages/index.astro:1 <script> needs features.scripts or a page script origin'],
    ],
    [
      'upper case after the first letter',
      '<sCRIPT>x()</sCRIPT>',
      STATIC,
      ['js-script src/pages/index.astro:1 <sCRIPT> needs features.scripts or a page script origin'],
    ],
    ['a component named Script', '<Script />', STATIC, []],
    ['with scripts', script, SCRIPTS, []],
    // Islands alone allow no bundled script: Astro writes the scripts of an island itself.
    [
      'with islands only',
      script,
      ISLANDS,
      ['js-script src/pages/index.astro:2 <script> needs features.scripts or a page script origin'],
    ],
    ['with a page script origin', script, PAGE_SCRIPT, []],
    [
      'with a gesture script origin and islands',
      script,
      GESTURE_SCRIPT,
      ['js-script src/pages/index.astro:2 <script> needs features.scripts or a page script origin'],
    ],
    ['without valid settings the half does not run', script, undefined, []],
    ['a script in a comment', '<!-- <script>x()</script> -->', STATIC, []],
    ['a script in the frontmatter', "---\nconst t = '<script>';\n---\n<p>x</p>", STATIC, []],
  ];
  assert.deepEqual(
    cases.map(([name, file, options]) => [name, sourceFindings(file, options)]),
    cases.map(([name, , , found]) => [name, found]),
  );
});

test('js-prefetch-attr, js-directive and csp-hash, source halves: one finding for each tag and attribute', () => {
  const cases: readonly [name: string, file: string, found: string[]][] = [
    [
      'a clean page',
      '<Counter client:visible />\n<Counter client:idle />\n<Counter client:media="(width < 40rem)" />',
      [],
    ],
    [
      'data-astro-prefetch on a link',
      '<a href="/fr/" data-astro-prefetch>fr</a>',
      ['js-prefetch-attr src/pages/index.astro:1 <a>'],
    ],
    [
      'data-astro-prefetch on a component',
      '<Link data-astro-prefetch="hover" />',
      ['js-prefetch-attr src/pages/index.astro:1 <Link>'],
    ],
    [
      'client:load',
      '<p>x</p>\n<Counter client:load />',
      ['js-directive src/pages/index.astro:2 client:load on <Counter>'],
    ],
    [
      'client:only',
      '<Counter client:only="solid-js" />',
      ['js-directive src/pages/index.astro:1 client:only on <Counter>'],
    ],
    [
      'client:Load in another case',
      '<Counter client:Load />',
      ['js-directive src/pages/index.astro:1 client:load on <Counter>'],
    ],
    [
      'a custom directive',
      '<Counter client:hover />',
      ['js-directive src/pages/index.astro:1 client:hover on <Counter>'],
    ],
    ['is:inline', '<script is:inline>x()</script>', ['csp-hash src/pages/index.astro:1 is:inline on <script>']],
    [
      'define:vars on a style',
      '<style define:vars={{ color }}>p{color:var(--color)}</style>',
      ['csp-hash src/pages/index.astro:1 define:vars on <style>'],
    ],
    [
      'define:vars on a script',
      '<script define:vars={{ a }}>x(a)</script>',
      ['csp-hash src/pages/index.astro:1 define:vars on <script>'],
    ],
    ['a directive in a comment', '<!-- <Counter client:load /> -->', []],
    ['a directive in the text of a script', '<script>const t = "<Counter client:load />";</script>', []],
  ];
  assert.deepEqual(
    cases.map(([name, file]) => [name, sourceFindings(file, SCRIPTS)]),
    cases.map(([name, , found]) => [name, found]),
  );
});

test('the source halves read every .astro file under src/, and no file of another extension', () => {
  const files = {
    'src/pages/index.astro': '<Counter client:load />',
    'src/components/Card.astro': '<p>x</p>\n<a href="/" data-astro-prefetch>x</a>',
    'src/components/Counter.tsx': 'export default () => <a data-astro-prefetch>x</a>;',
    'public/a.astro': '<Counter client:load />',
  };
  const found = inTemp(files, (root) => {
    const report = new Report();
    checkScriptSources(root, STATIC, report);
    return report.findings.map((finding) => `${finding.rule} ${finding.where}`).sort();
  });
  assert.deepEqual(found, ['js-directive src/pages/index.astro:1', 'js-prefetch-attr src/components/Card.astro:2']);
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build, read, record, styles } from '../harness.ts';
import { page, project } from './project.ts';

const NAMES = ['card', 'badge', 'note', 'lazy', 'deep'];

/** A component of 7.2: `src/components/<Name>.astro` imports only its own file, and that file holds one class. */
const component = (name: string): Record<string, string> => ({
  [`src/styles/components/${name}.css`]: `@layer components {\n  .${name} {\n    display: block;\n  }\n}\n`,
  [`src/components/${name.charAt(0).toUpperCase()}${name.slice(1)}.astro`]: `---\nimport '../styles/components/${name}.css';\n---\n<div class="${name}"><slot /></div>\n`,
});

const NEVER = "Astro.url.pathname === '/never/'";

const files = {
  ...Object.assign({}, ...NAMES.map(component)),
  'src/layouts/Base.astro':
    '---\nimport Deep from \'../components/Deep.astro\';\n---\n<html lang="de"><head><meta charset="utf-8"><title>Layout</title></head><body><Deep /><slot /></body></html>\n',
  'src/styles/pages/index.css': '@layer page {\n  .card {\n    order: 1;\n  }\n}\n',
  'src/pages/index.astro': page(
    'Home',
    '<Card>a</Card>',
    "import Card from '../components/Card.astro';\nimport '../styles/pages/index.css';",
  ),
  'src/pages/about.astro': page('About', '<Badge>b</Badge>', "import Badge from '../components/Badge.astro';"),
  'src/pages/plain.astro': page('Plain', '<p>p</p>'),
  // A static import, rendered behind a condition that is false for every built page.
  'src/pages/cond.astro': page(
    'Cond',
    '{show && <Note>n</Note>}<p>c</p>',
    `import Note from '../components/Note.astro';\nconst show = ${NEVER};`,
  ),
  // A dynamic import that no built page runs.
  'src/pages/dyn.astro': page(
    'Dyn',
    '{Lazy && <Lazy />}<p>d</p>',
    `const Lazy = ${NEVER} ? (await import('../components/Lazy.astro')).default : null;`,
  ),
  // The route imports the component through a layout.
  'src/pages/lay.astro': "---\nimport Base from '../layouts/Base.astro';\n---\n<Base><p>l</p></Base>\n",
  // One route file, three pages. Each page renders another component, or none.
  'src/pages/many/[slug].astro': page(
    'Many',
    '{slug === "a" && <Card>a</Card>}{slug === "b" && <Badge>b</Badge>}<p>{slug}</p>',
    "import Card from '../../components/Card.astro';\nimport Badge from '../../components/Badge.astro';\nexport function getStaticPaths() {\n  return ['a', 'b', 'c'].map((slug) => ({ params: { slug } }));\n}\nconst { slug } = Astro.params;",
  ),
};

/**
 * The components whose own CSS file is in the page's CSS, and `page` when the page file of the home page is in it.
 * The whole rule of the component file is matched: the page file holds a `.card` rule too, with another declaration.
 */
const shipped = (css: string): string[] => [
  ...NAMES.filter((name) => css.includes(`.${name}{display:block}`)),
  ...(css.includes('@layer page{.card{order:1}}') ? ['page'] : []),
];

test('S2: component CSS ships per route file: only where imported, also behind a condition, one bundle for many pages', () => {
  const dir = project('s02', files);
  build(dir);
  const html = (path: string): string => read(dir, `dist/${path}index.html`);
  const css = (path: string): string => styles(html(path));
  const measured = Object.fromEntries(
    ['', 'about/', 'plain/', 'cond/', 'dyn/', 'lay/', 'many/a/', 'many/b/', 'many/c/'].map((path) => [
      `/${path}`,
      shipped(css(path)),
    ]),
  );

  // Only on pages whose route imports it.
  assert.deepEqual(measured['/'], ['card', 'page'], 'the home page has its component and its page file');
  assert.deepEqual(measured['/about/'], ['badge'], 'another route has only its own component');
  assert.deepEqual(measured['/plain/'], [], 'a route with no import has only the global files');
  assert.ok(css('plain/').includes('--color-text'), 'the global files are in a page that imports nothing');
  assert.deepEqual(measured['/lay/'], ['deep'], 'an import through a layout counts as an import of the route');

  // A conditional import still ships.
  assert.equal(html('cond/').includes('class="note"'), false, 'the condition is false: the page has no .note element');
  assert.deepEqual(measured['/cond/'], ['note'], 'a static import behind a false condition still ships its CSS');
  assert.equal(html('dyn/').includes('class="lazy"'), false, 'the dynamic import never runs');
  assert.deepEqual(measured['/dyn/'], ['lazy'], 'a dynamic import that never runs still ships its CSS');

  // A route that serves many pages gives them all one bundle.
  assert.ok(html('many/a/').includes('class="card"') && !html('many/a/').includes('class="badge"'));
  assert.ok(!html('many/c/').includes('class="card"') && !html('many/c/').includes('class="badge"'));
  for (const path of ['many/a/', 'many/b/', 'many/c/']) {
    assert.deepEqual(measured[`/${path}`], ['card', 'badge'], `${path} has the CSS of every import of the route`);
    assert.equal(css(path), css('many/a/'), `${path} has the same style sheet as its sibling pages`);
  }

  for (const path of Object.keys(measured)) {
    assert.equal(html(path.slice(1)).match(/<style/g)?.length, 1, `${path} has one <style>`);
  }
  record('S2.shippedByPage', measured);
});

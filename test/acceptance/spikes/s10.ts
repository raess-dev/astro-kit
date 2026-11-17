import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { astro, build, cspMeta, launch, plain, read, record, serve, tree } from '../harness.ts';
import { page, project } from './project.ts';

/** The hash of Solid's hydration script (13.1 item 11). Astro does not hash it (item 10), so 6.1 step 6 adds it. */
const SOLID_HASH = 'sha256-VmEf2BGdqVUwcvyhTyarJo/bY7DNqS2+T2sz4IO/kbw=';
const MARKER = 'spike-s10-form';

const files = {
  'src/components/Counter.tsx':
    'import { createSignal } from \'solid-js\';\n\nexport default function Counter() {\n  const [count, setCount] = createSignal(0);\n  return (\n    <button id="count" type="button" onClick={() => setCount(count() + 1)}>\n      {count()}\n    </button>\n  );\n}\n',
  'src/pages/index.astro': page(
    'Home',
    '<p>home</p><Counter client:visible />',
    "import Counter from '../components/Counter.tsx';",
  ),
  'src/pages/fr/index.astro': page('Accueil', '<p>accueil</p>'),
  'src/pages/404.astro': page('Nicht gefunden', '<p>404</p>'),
  // The place of the form shim of 9.1: the one on-demand route.
  'src/pages/api/forms/[form].ts': `export const prerender = false;\nexport const POST = ({ params }) => new Response('${MARKER}:' + params.form);\n`,
};

/**
 * `CF` is the adapter as 6.1 step 7 makes it, `SOLID` the renderer of step 6. `probe` writes what a later integration
 * sees in `astro:config:done`: the adapter of the config, the integrations in order, and the build output.
 */
const IMPORTS = `import cloudflare from '@astrojs/cloudflare';
import solid from '@astrojs/solid-js';
import { writeFileSync } from 'node:fs';
const CF = cloudflare({ imageService: 'compile', prerenderEnvironment: 'node' });
const SOLID = solid();
const probe = {
  name: 's10-probe',
  hooks: {
    'astro:config:done': ({ config, buildOutput }) =>
      writeFileSync(
        new URL('./probe.json', config.root),
        JSON.stringify({
          adapter: config.adapter?.name ?? null,
          integrations: config.integrations.map((integration) => integration.name),
          buildOutput,
        }),
      ),
  },
};
const routes = (list, root) =>
  writeFileSync(
    root + '/routes.json',
    JSON.stringify(list.map((route) => ({ pattern: route.pattern, origin: route.origin, prerender: route.isPrerendered }))),
  );`;

/** The options of the stand-in. `how` says where the adapter and the renderer go in `updateConfig`. */
const options = (how: string): string =>
  `{ locales: ['de', 'fr'], islands: true, scriptHashes: ['${SOLID_HASH}'], onRoutes: routes, ${how} }`;

/**
 * The four ways to add the two from `updateConfig`. The stand-in sets `adapter` and pushes the adapter after the
 * other integrations, as 6.1 steps 6 and 7 do. `config` is merged last, so it can set `adapter` alone.
 */
const WAYS = {
  // 6.1 as written: step 6 pushes the renderer, step 7 sets `adapter` and pushes the adapter.
  both: 'adapter: CF, integrations: [SOLID, probe]',
  // The adapter is pushed before the renderer.
  adapterFirst: 'integrations: [CF, SOLID, probe], config: { adapter: CF }',
  // The adapter is pushed into `integrations` and never set as `adapter`.
  pushedOnly: 'integrations: [SOLID, CF, probe]',
  // The adapter is set as `adapter` and never pushed.
  adapterOnly: 'integrations: [SOLID, probe], config: { adapter: CF }',
};

interface Probe {
  adapter: string | null;
  integrations: string[];
  buildOutput: string;
}
interface Route {
  pattern: string;
  origin: string;
  prerender: boolean;
}

const probe = (dir: string): Probe => JSON.parse(read(dir, 'probe.json')) as Probe;
const routes = (dir: string): Route[] => JSON.parse(read(dir, 'routes.json')) as Route[];

/** The text of every `.mjs` file of the server build. */
const serverCode = (dir: string, folder = 'dist/server'): string =>
  readdirSync(join(dir, folder), { withFileTypes: true })
    .map((entry) =>
      entry.isDirectory()
        ? serverCode(dir, `${folder}/${entry.name}`)
        : entry.name.endsWith('.mjs')
          ? readFileSync(join(dir, folder, entry.name), 'utf8')
          : '',
    )
    .join('\n');

/** The home page, which holds the island. */
const HOME = 'dist/client/index.html';

const WAIT = { timeout: 30_000 };

test('S10: the forms adapter and the Solid renderer, both added from updateConfig, build one site, in either order', async () => {
  const dir = project('s10', files, options(WAYS.both), IMPORTS);
  const other = project('s10-adapter-first', files, options(WAYS.adapterFirst), IMPORTS);
  // What a forms build with an island must give (13.1 item 16). Each order must give it.
  for (const [way, built] of [
    ['both', dir],
    ['adapterFirst', other],
  ] as const) {
    build(built);
    assert.ok(existsSync(join(built, HOME)), `${way}: the prerendered home is in dist/client`);
    assert.ok(
      existsSync(join(built, 'dist/client/fr/index.html')),
      `${way}: the prerendered French home is in dist/client`,
    );
    assert.ok(existsSync(join(built, 'dist/client/404.html')), `${way}: the 404 page is in dist/client`);
    assert.ok(existsSync(join(built, 'dist/server/entry.mjs')), `${way}: dist/server/entry.mjs exists`);
    const home = read(built, HOME);
    const island = /<astro-island\b[^>]*>/.exec(home)?.[0] ?? '';
    assert.ok(
      island.includes('client="visible"'),
      `${way}: the page holds an astro-island with client:visible: ${island}`,
    );
    assert.ok(/renderer-url="\/_astro\/[^"]+\.js"/.test(island), `${way}: the island names the Solid client renderer`);
    assert.ok(
      /<button data-hk="[^"]+" id="count"[^>]*>0<\/button>/.test(home),
      `${way}: Solid rendered the island on the server`,
    );
    assert.equal(
      read(built, 'dist/client/fr/index.html').includes('astro-island'),
      false,
      `${way}: a page with no island has none`,
    );
    assert.ok(serverCode(built).includes(MARKER), `${way}: the endpoint is in the server build`);
    const shim = routes(built).filter((route) => route.origin === 'project' && !route.prerender);
    assert.deepEqual(shim, [{ pattern: '/api/forms/[form]', origin: 'project', prerender: false }]);
  }

  const html = read(dir, HOME);
  const seen = probe(dir);
  assert.equal(seen.buildOutput, 'server', 'the on-demand route makes the build output "server"');
  assert.equal(seen.adapter, '@astrojs/cloudflare', 'config.adapter is the adapter');
  // Astro does not add the `adapter` of `updateConfig` to the integrations: the adapter is there once, as pushed.
  assert.deepEqual(seen.integrations, ['spike-kit', '@astrojs/solid-js', 's10-probe', '@astrojs/cloudflare']);
  record('S10.both', seen);

  // The other order gives the same client output. Only the id of the island differs between two builds.
  const uid = (text: string): string => text.replace(/ uid="[^"]*"/, '');
  assert.equal(uid(read(other, HOME)), uid(html), 'the same home page');
  assert.deepEqual(tree(join(other, 'dist/client')), tree(join(dir, 'dist/client')), 'the same client files');
  assert.deepEqual(probe(other).integrations, ['spike-kit', '@astrojs/cloudflare', '@astrojs/solid-js', 's10-probe']);
  record('S10.adapterFirst', probe(other));

  // The island hydrates in Chromium under the CSP meta, with the hash of 13.1 item 11 for Solid's hydration script.
  assert.ok(cspMeta(html).includes(`'${SOLID_HASH}'`), 'the CSP meta holds the hash of the hydration script');
  const server = await serve(join(dir, 'dist/client'));
  try {
    const browser = await launch();
    try {
      const tab = await (await browser.newContext()).newPage();
      await tab.addInitScript(
        "window.__s10 = []; document.addEventListener('securitypolicyviolation', (e) => window.__s10.push(e.effectiveDirective + ' ' + e.blockedURI));",
      );
      await tab.goto(`${server.origin}/`);
      // The predicate is a function, never a string: the page CSP forbids `eval`, which a string predicate needs.
      await tab.waitForFunction(() => document.querySelector('astro-island:not([ssr])') !== null, undefined, WAIT);
      await tab.click('#count');
      await tab.waitForFunction(() => document.querySelector('#count')?.textContent === '1', undefined, WAIT);
      assert.deepEqual(
        await tab.evaluate(() => (window as unknown as { __s10: string[] }).__s10),
        [],
        'no CSP violation',
      );
    } finally {
      await browser.close();
    }
  } finally {
    // A failed launch must still close the server (13.1 item 34).
    await server.close();
  }
});

/** A failed build: the exit status and the first error name that Astro or Vite prints. */
function failure(dir: string): { status: number | null; error: string | null; output: string } {
  const run = astro(dir);
  const output = plain(run.output);
  return {
    status: run.status,
    error: /\[([A-Z][A-Za-z_]+)\] /.exec(output.replace(/\[(ERROR|WARNING)\]/g, ''))?.[1] ?? null,
    output,
  };
}

test('S10: an adapter that is only pushed into integrations fails the build: Astro reads config.adapter', () => {
  const dir = project('s10-pushed-only', files, options(WAYS.pushedOnly), IMPORTS);
  const run = failure(dir);
  assert.notEqual(run.status, 0, 'the build fails');
  assert.ok(
    run.output.includes('[NoAdapterInstalled]'),
    `Astro reports NoAdapterInstalled:\n${run.output.slice(-2000)}`,
  );
  // The adapter's hooks ran, and the build output is "server", but `config.adapter` is empty.
  const seen = probe(dir);
  assert.equal(seen.adapter, null, 'config.adapter is empty in astro:config:done');
  assert.ok(seen.integrations.includes('@astrojs/cloudflare'), 'the adapter is in the integrations');
  assert.equal(existsSync(join(dir, 'dist/server/entry.mjs')), false, 'no server build');
  record('S10.pushedOnly', { status: run.status, error: run.error, ...seen });
});

test('S10: an adapter that is only set as `adapter` in updateConfig fails the build: its hooks never run', () => {
  const dir = project('s10-adapter-only', files, options(WAYS.adapterOnly), IMPORTS);
  const run = failure(dir);
  assert.notEqual(run.status, 0, 'the build fails');
  assert.equal(run.output.includes('@astrojs/cloudflare'), false, 'the adapter logs nothing: Astro never calls it');
  assert.ok(run.output.includes('virtual:astro:legacy-ssr-entry'), `no adapter entry:\n${run.output.slice(-2000)}`);
  // `config.adapter` is set, so a check of that key alone (6.1, `astro:config:done`) would see an adapter.
  const seen = probe(dir);
  assert.equal(seen.adapter, '@astrojs/cloudflare', 'config.adapter is set in astro:config:done');
  assert.equal(seen.integrations.includes('@astrojs/cloudflare'), false, 'the adapter is not in the integrations');
  assert.equal(existsSync(join(dir, 'dist/server/entry.mjs')), false, 'no server build');
  record('S10.adapterOnly', { status: run.status, error: run.error, ...seen });
});

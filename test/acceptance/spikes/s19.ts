import assert from 'node:assert/strict';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { astro, build, plain, read, record } from '../harness.ts';
import { type Answer, type Call, call, WRANGLER_FORMS, wranglerDev } from '../wrangler.ts';
import { page, project } from './project.ts';

const SHIM = 'src/pages/api/forms/[form].ts';

const files = {
  'src/pages/index.astro': page('Home', '<p id="who">home</p><p id="marker">{Astro.locals.s19 ?? "no middleware"}</p>'),
  'src/pages/404.astro': page('Nicht gefunden', '<p id="who">root 404</p>'),
  // The place of the form shim of 9.1: the one on-demand route. It answers with what the Worker sees.
  [SHIM]: `export const prerender = false;
export const POST = ({ params, request }) =>
  new Response(JSON.stringify({ shim: 's19-shim', form: params.form, url: request.url }), {
    headers: { 'content-type': 'application/json' },
  });
`,
  // The exact text of a forms site (10.4).
  'wrangler.jsonc': WRANGLER_FORMS,
};

/**
 * `routes` is the `onRoutes` hook of the stand-in. It writes the list of every call of `astro:routes:resolved` to
 * `routes.json`. An entrypoint is cut to a path that is the same on every machine.
 */
const HOOK = `import { writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
const where = (root, file) => {
  if (typeof file !== 'string') return file ?? null;
  const at = file.lastIndexOf('node_modules/');
  if (at >= 0) return file.slice(at);
  return file.startsWith('/') ? relative(root, file) : file;
};
const calls = [];
const routes = (list, root) => {
  calls.push(
    list.map((route) => ({
      pattern: route.pattern,
      origin: route.origin,
      prerender: route.isPrerendered,
      entrypoint: where(root, route.entrypoint),
      type: route.type,
    })),
  );
  writeFileSync(join(root, 'routes.json'), JSON.stringify(calls));
};`;

const IMPORTS = `import cloudflare from '@astrojs/cloudflare';\n${HOOK}`;

/** The adapter as 6.1 step 7 adds it, from `updateConfig`. */
const FORMS = "{ adapter: cloudflare({ imageService: 'compile', prerenderEnvironment: 'node' }), onRoutes: routes }";
/** A site with forms off: no adapter. */
const STATIC = '{ onRoutes: routes }';

interface Route {
  pattern: string;
  origin: string;
  prerender: boolean;
  entrypoint: string | null;
  type: string;
}

/** The list of each call of `astro:routes:resolved` in the build, each sorted by pattern. */
const calls = (dir: string): Route[][] =>
  (JSON.parse(read(dir, 'routes.json')) as Route[][]).map((list) =>
    list.sort((a, b) => (a.pattern < b.pattern ? -1 : a.pattern > b.pattern ? 1 : 0)),
  );

/** The list of the last call of `astro:routes:resolved`, sorted by pattern. */
const routes = (dir: string): Route[] => calls(dir).at(-1) ?? [];
const patterns = (list: Route[]): string[] => list.map((route) => route.pattern);

/** What `astro:routes:resolved` lists in a forms build: two project pages, the shim, and two routes of Astro's own. */
const ROUTES: Route[] = [
  { pattern: '/', origin: 'project', prerender: true, entrypoint: 'src/pages/index.astro', type: 'page' },
  { pattern: '/404', origin: 'project', prerender: true, entrypoint: 'src/pages/404.astro', type: 'page' },
  {
    pattern: '/_image',
    origin: 'internal',
    prerender: false,
    entrypoint: 'node_modules/@astrojs/cloudflare/dist/entrypoints/image-passthrough-endpoint.js',
    type: 'endpoint',
  },
  {
    pattern: '/_server-islands/[name]',
    origin: 'internal',
    prerender: false,
    entrypoint: '_server-islands.astro',
    type: 'page',
  },
  { pattern: '/api/forms/[form]', origin: 'project', prerender: false, entrypoint: SHIM, type: 'endpoint' },
];

/**
 * The built Worker config with another `assets.run_worker_first`, written next to the built one: `true` sends every
 * request to the Worker first, to ask the Worker itself what it answers; `undefined` removes the key.
 */
function routing(dir: string, first: true | undefined): string {
  const config = JSON.parse(read(dir, 'dist/server/wrangler.json')) as { assets: Record<string, unknown> };
  if (first) config.assets.run_worker_first = true;
  else delete config.assets.run_worker_first;
  const file = `dist/server/wrangler.${first ? 'worker-first' : 'no-list'}.json`;
  writeFileSync(join(dir, file), JSON.stringify(config));
  return file;
}

/** A POST that `security.checkOrigin` does not look at: only the content types of an HTML form are checked. */
const POST: Call = { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' };
const FORM = { 'content-type': 'application/x-www-form-urlencoded' };

interface Pair {
  get: Answer;
  post: Answer;
}
const pair = async (origin: string, path: string): Promise<Pair> => ({
  get: await call(origin, path),
  post: await call(origin, path, POST),
});
const statuses = ({ get, post }: Pair): { get: number; post: number } => ({ get: get.status, post: post.status });

/** The built Worker config: the deploy config of a forms site (10.1). */
const BUILT = 'dist/server/wrangler.json';

/** Runs `use` against `wrangler dev` for the config, and always ends the session. */
async function withWorker<T>(dir: string, config: string | undefined, use: (origin: string) => Promise<T>): Promise<T> {
  const wrangler = await wranglerDev(dir, config ?? BUILT);
  try {
    return await use(wrangler.origin);
  } finally {
    await wrangler.close();
  }
}

const PATHS = [
  '/',
  '/x/',
  '/api/',
  '/api/x/',
  '/api/forms',
  '/api/forms/',
  '/api/forms/contact',
  '/api/forms/contact/',
  '/api/forms/a/b/',
  '/API/forms/contact/',
  '/_actions/x',
  '/_actions/x/',
  '/_server-islands/x',
  '/_server-islands/x/',
  '/_image',
];
const INTERNAL = ['/_actions/x', '/_actions/x/', '/_server-islands/x', '/_server-islands/x/'];

test('S19: in a forms build the form shim is the only on-demand project route, and only /api/forms/* reaches the Worker', async () => {
  const dir = project('s19', files, FORMS, IMPORTS);
  build(dir);
  const list = routes(dir);
  const onDemand = list.filter((route) => !route.prerender);
  assert.deepEqual(
    onDemand.filter((route) => route.origin === 'project'),
    [{ pattern: '/api/forms/[form]', origin: 'project', prerender: false, entrypoint: SHIM, type: 'endpoint' }],
    'the shim is the only on-demand route with origin "project"',
  );
  // Astro and the adapter add two on-demand routes of their own to EVERY build, with no source in the project.
  const internal = onDemand.filter((route) => route.origin !== 'project');
  assert.deepEqual(patterns(internal), ['/_image', '/_server-islands/[name]']);
  assert.ok(
    internal.every((route) => route.origin === 'internal'),
    'they have origin "internal"',
  );
  assert.deepEqual(list, ROUTES);
  record('S19.routes', list);
  // The hook runs twice in one build, here with the same list.
  record('S19.calls', calls(dir).map(patterns));
  assert.ok(read(dir, 'dist/client/index.html').includes('<p id="marker">no middleware</p>'), 'no middleware ran');
  const notFound = read(dir, 'dist/client/404.html');

  // The built Worker under the asset routing of 10.4.
  await withWorker(dir, undefined, async (origin) => {
    const home = await call(origin, '/');
    assert.equal(home.status, 200);
    assert.equal(home.body, read(dir, 'dist/client/index.html'));
    const shim = await call(origin, '/api/forms/contact/', POST);
    assert.equal(shim.status, 200, 'the shim answers');
    // wrangler dev gives the Worker the host of `routes`, over http.
    assert.deepEqual(JSON.parse(shim.body), {
      shim: 's19-shim',
      form: 'contact',
      url: 'http://example.ch/api/forms/contact/',
    });

    // `run_worker_first` is a list, so the asset layer answers every other path itself: a missing path gets the 404
    // page, and a method other than GET or HEAD gets 405. So a POST that is not answered with 405 reached the Worker.
    const reach: Record<string, { get: number; post: number; worker: boolean }> = {};
    for (const path of PATHS) {
      const answers = await pair(origin, path);
      reach[path] = { ...statuses(answers), worker: answers.post.status !== 405 };
      if (!INTERNAL.includes(path)) continue;
      assert.equal(answers.get.status, 404, `GET ${path} answers 404`);
      assert.equal(answers.get.body, notFound, `GET ${path} answers with /404.html, from the asset layer`);
      assert.equal(answers.post.status, 405, `POST ${path} answers 405: the asset layer, not the Worker`);
    }
    assert.deepEqual(
      PATHS.filter((path) => reach[path]?.worker),
      PATHS.filter((path) => path.startsWith('/api/forms/')),
      'only the paths under /api/forms/ reach the Worker',
    );
    record('S19.reach', reach);

    // `security.checkOrigin` on the shim, for a form POST (9.1, abuse control).
    const post = async (headers: Record<string, string>): Promise<number> =>
      (await call(origin, '/api/forms/contact/', { method: 'POST', headers, body: 'a=1' })).status;
    const checkOrigin = {
      sameOrigin: await post({ ...FORM, origin: 'http://example.ch' }),
      crossOrigin: await post({ ...FORM, origin: 'https://evil.example' }),
      crossSite: await post({ ...FORM, 'sec-fetch-site': 'cross-site' }),
      // A client that is not a browser sends neither header, and passes.
      noOrigin: await post(FORM),
      // Not a form content type: not checked. A browser sends a preflight for it.
      jsonCrossOrigin: await post({ 'content-type': 'application/json', origin: 'https://evil.example' }),
    };
    assert.equal(checkOrigin.sameOrigin, 200);
    assert.equal(checkOrigin.crossOrigin, 403, 'a cross-origin form POST is rejected');
    assert.equal(checkOrigin.crossSite, 403, 'a cross-site form POST is rejected');
    record('S19.checkOrigin', checkOrigin);
  });

  // The Worker itself, with every request sent to it first: what it would answer if the asset routing were open.
  await withWorker(dir, routing(dir, true), async (origin) => {
    const worker: Record<string, { get: number; post: number }> = {};
    for (const path of [...INTERNAL, '/_image', '/_image?href=%2F_astro%2Fx.png&w=10&f=webp', '/x/']) {
      worker[path] = statuses(await pair(origin, path));
    }
    for (const path of ['/_actions/x', '/_actions/x/', '/_server-islands/x']) {
      assert.deepEqual(worker[path], { get: 404, post: 404 }, `the Worker answers 404 for ${path}`);
    }
    // The server-island route is in every Worker: with the slash of `trailingSlash: 'always'` it answers, with 400.
    assert.deepEqual(worker['/_server-islands/x/'], { get: 400, post: 404 });
    record('S19.worker', worker);
  });
});

const MIDDLEWARE = (mark: string): string => `import { defineMiddleware } from 'astro:middleware';

export const onRequest = defineMiddleware(async (context, next) => {
  context.locals.s19 = '${mark}';
  const response = await next();
  response.headers.set('x-s19-middleware', '${mark}');
  return response;
});
`;

for (const [name, file] of [
  ['s19-middleware', 'src/middleware.ts'],
  ['s19-middleware-folder', 'src/middleware/index.ts'],
] as const) {
  test(`S19: Astro loads a planted ${file} with no config: it runs in the prerender and in the Worker`, async () => {
    const dir = project(name, { ...files, [file]: MIDDLEWARE(name) }, FORMS, IMPORTS);
    build(dir);
    // The file ran for the prerendered page: its mark is in the built HTML.
    assert.ok(
      read(dir, 'dist/client/index.html').includes(`<p id="marker">${name}</p>`),
      'the mark is in the built page',
    );
    // It adds no route, so `astro:routes:resolved` cannot see it: only a source rule can (`config-server`).
    assert.deepEqual(routes(dir), ROUTES, 'the route list is the one of a build with no middleware');
    await withWorker(dir, undefined, async (origin) => {
      const shim = await call(origin, '/api/forms/contact/', POST);
      assert.equal(shim.status, 200);
      assert.equal(
        shim.headers['x-s19-middleware'],
        name,
        'the file ran in the Worker: its header is on the shim answer',
      );
      const home = await call(origin, '/');
      assert.equal(home.headers['x-s19-middleware'], undefined, 'a prerendered page comes from the asset layer');
      record(`S19.middleware.${file.endsWith('index.ts') ? 'folder' : 'file'}`, {
        builtPage: true,
        shimHeader: true,
        pageHeader: false,
        routes: patterns(routes(dir)),
      });
    });
  });
}

const ACTIONS =
  "import { defineAction } from 'astro:actions';\n\nexport const server = {\n  ping: defineAction({ handler: async () => 's19-pong' }),\n};\n";

test('S19: src/actions/index.ts adds the internal route /_actions/[...path]; the asset routing of 10.4 keeps it from the Worker', async () => {
  const dir = project('s19-actions', { ...files, 'src/actions/index.ts': ACTIONS }, FORMS, IMPORTS);
  build(dir);
  const route: Route = {
    pattern: '/_actions/[...path]',
    origin: 'internal',
    prerender: false,
    entrypoint: 'node_modules/astro/dist/actions/runtime/entrypoints/route.js',
    type: 'endpoint',
  };
  assert.deepEqual(
    routes(dir),
    [...ROUTES.slice(0, 2), route, ...ROUTES.slice(2)],
    'one more route, with origin "internal"',
  );
  const routed = await withWorker(dir, undefined, async (origin) => ({
    '/_actions/ping/': statuses(await pair(origin, '/_actions/ping/')),
    '/_actions/ping': statuses(await pair(origin, '/_actions/ping')),
  }));
  assert.deepEqual(routed['/_actions/ping/'], { get: 404, post: 405 }, 'the action cannot be called');
  assert.deepEqual(routed['/_actions/ping'], { get: 404, post: 405 });
  // The action is in the Worker all the same: with every request sent to the Worker first, it runs.
  const worker = await withWorker(dir, routing(dir, true), async (origin) => {
    const answer = await call(origin, '/_actions/ping/', { ...POST, body: '' });
    assert.equal(answer.status, 200, 'the Worker runs the action');
    assert.ok(answer.body.includes('s19-pong'), `the answer holds the result: ${answer.body}`);
    return {
      '/_actions/ping/': statuses(await pair(origin, '/_actions/ping/')),
      '/_actions/ping': statuses(await pair(origin, '/_actions/ping')),
      '/_actions/x/': statuses(await pair(origin, '/_actions/x/')),
    };
  });
  // The list of 10.4 is what keeps the action out. With no `run_worker_first`, a request that matches no asset and is
  // not a navigation goes to the Worker, and the action runs.
  const noList = await withWorker(dir, routing(dir, undefined), async (origin) => ({
    '/_actions/ping/': statuses(await pair(origin, '/_actions/ping/')),
    navigation: (
      await call(origin, '/_actions/ping/', { ...POST, headers: { ...POST.headers, 'sec-fetch-mode': 'navigate' } })
    ).status,
  }));
  assert.equal(noList['/_actions/ping/'].post, 200, 'with no list, the action can be called');
  record('S19.actions', { route, routed, worker, noList });
});

test('S19: server:defer adds no route: the server-island route is in every build; the asset routing of 10.4 answers its request with 404', async () => {
  const dir = project(
    's19-island',
    {
      ...files,
      'src/components/Late.astro': '<p id="late">s19-late</p>\n',
      'src/pages/index.astro': page(
        'Home',
        '<p id="who">home</p><Late server:defer />',
        "import Late from '../components/Late.astro';",
      ),
    },
    FORMS,
    IMPORTS,
  );
  build(dir);
  assert.deepEqual(routes(dir), ROUTES, 'the route list is the one of a build with no server island');
  // The built page asks for the island at run time. The query holds values that the build encrypts.
  const html = read(dir, 'dist/client/index.html');
  const url = /fetch\("(\/_server-islands\/[^"]+)"/.exec(html)?.[1] ?? '';
  assert.ok(url.startsWith('/_server-islands/Late/?'), `the page fetches the island: ${url}`);
  assert.equal(html.includes('s19-late'), false, 'the island is not in the built page');
  const routed = await withWorker(dir, undefined, async (origin) => {
    const answer = await call(origin, url);
    assert.equal(answer.status, 404, 'the request of the page answers 404');
    assert.equal(answer.body, read(dir, 'dist/client/404.html'), 'with /404.html, from the asset layer');
    return answer.status;
  });
  const worker = await withWorker(dir, routing(dir, true), async (origin) => {
    const answer = await call(origin, url);
    assert.equal(answer.status, 200, 'the Worker renders the island');
    assert.ok(answer.body.includes('s19-late'), `the answer holds the island: ${answer.body.slice(0, 200)}`);
    return answer.status;
  });
  // The shape of the measured URL: each value of the query is cut, because the build encrypts it anew each time.
  const request = url.replace(/=[^&]+/g, '=…');
  record('S19.serverIsland', { addedRoutes: [], request, routed, worker });
});

test('S19: a static build lists the same two internal routes; Astro refuses actions and server islands there, and runs a planted middleware', () => {
  const { [SHIM]: _shim, 'wrangler.jsonc': _wrangler, ...pages } = files;
  const dir = project('s19-static', pages, STATIC, HOOK);
  build(dir);
  const list = routes(dir);
  assert.equal(existsSync(join(dir, 'dist/index.html')), true, 'a static build: dist holds the pages');
  assert.equal(existsSync(join(dir, 'dist/server')), false, 'and no Worker');
  // The two internal on-demand routes are listed here too, so no rule may fail a build for them (the S19 fallback).
  assert.deepEqual(
    list.filter((route) => !route.prerender).map(({ pattern, origin }) => ({ pattern, origin })),
    [
      { pattern: '/_image', origin: 'internal' },
      { pattern: '/_server-islands/[name]', origin: 'internal' },
    ],
  );
  record('S19.static.routes', list);
  // The hook runs twice. In a static build the first call holds the project routes only.
  record('S19.static.calls', calls(dir).map(patterns));

  const failure = (name: string, more: Record<string, string>): string => {
    const run = astro(project(name, { ...pages, ...more }, STATIC, HOOK));
    assert.notEqual(run.status, 0, `${name}: the build fails`);
    return /\[([A-Z][A-Za-z]+Error|NoAdapter[A-Za-z]*)\]/.exec(plain(run.output))?.[1] ?? '';
  };
  const actions = failure('s19-static-actions', { 'src/actions/index.ts': ACTIONS });
  assert.equal(actions, 'ActionsWithoutServerOutputError');
  const island = failure('s19-static-island', {
    'src/components/Late.astro': '<p id="late">s19-late</p>\n',
    'src/pages/index.astro': page('Home', '<Late server:defer />', "import Late from '../components/Late.astro';"),
  });
  assert.equal(island, 'NoAdapterInstalledServerIslands');
  // A middleware needs no server: it runs in the build of a static site.
  const middleware = project(
    's19-static-middleware',
    { ...pages, 'src/middleware.ts': MIDDLEWARE('s19-static') },
    STATIC,
    HOOK,
  );
  build(middleware);
  assert.ok(
    read(middleware, 'dist/index.html').includes('<p id="marker">s19-static</p>'),
    'the mark is in the built page',
  );
  record('S19.static.planted', { actions, serverIsland: island, middleware: 'runs in the build' });
});

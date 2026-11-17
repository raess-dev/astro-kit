import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { build, plain, read, record, tree, type Run } from '../harness.ts';
import { page, project } from './project.ts';
import { FORM_SHIM, get, WRANGLER_FORMS, wranglerBin, wranglerDev, wranglerEnv } from '../wrangler.ts';

type Json = Record<string, unknown>;

/** `wrangler.jsonc` as the deploy job reads it: full-line comments stripped, then JSON (13.1 item 23). */
const SOURCE = JSON.parse(WRANGLER_FORMS.replace(/^\s*\/\/.*$/gm, '')) as Json & { env: { preview: Json } };

/** The keys that the config check of the deploy steps compares (10.1); a missing key is `null`, as in jq. */
const CHECKED = ['name', 'routes', 'workers_dev', 'preview_urls', 'compatibility_date', 'send_email', 'ratelimits'];
const checked = (config: Json): Json => Object.fromEntries(CHECKED.map((key) => [key, config[key] ?? null]));

const files = {
  'src/pages/index.astro': page('Home', '<p>home</p>'),
  'src/pages/api/forms/[form].ts': FORM_SHIM,
  'wrangler.jsonc': WRANGLER_FORMS,
};

const IMPORTS =
  "import cloudflare from '@astrojs/cloudflare';\nimport { writeFileSync } from 'node:fs';\nimport { join, relative } from 'node:path';";

/**
 * The adapter as 6.1 step 7 adds it, from `updateConfig`. `config` is merged last into the locked config of the
 * stand-in, which holds `session: false` (6.1).
 */
const options = (config = ''): string =>
  `{ adapter: cloudflare({ imageService: 'compile', prerenderEnvironment: 'node' }),${config} onDone: ({ dir, root }) => writeFileSync(join(root, 'done.json'), JSON.stringify({ dir: relative(root, dir) })) }`;

const built = (dir: string): Json => JSON.parse(read(dir, 'dist/server/wrangler.json')) as Json;
const keys = (config: Json): string[] => Object.keys(config).sort();
const doneDir = (dir: string): string => (JSON.parse(read(dir, 'done.json')) as { dir: string }).dir;

/** What the build that just ran left outside the Worker config. Every value is read from the disk at the call. */
const clientOutput = (dir: string) => ({
  buildDoneDir: doneDir(dir),
  dist: readdirSync(join(dir, 'dist')).sort(),
  client: tree(join(dir, 'dist/client')),
  // 13.1 item 18: the adapter writes the `/_astro/*` rule, because no `/*` rule sets Cache-Control here.
  headers: read(dir, 'dist/client/_headers'),
  assetsignore: read(dir, 'dist/client/.assetsignore'),
  // Wrangler follows this file to the built config when a command has no `--config`.
  redirect: JSON.parse(read(dir, '.wrangler/deploy/config.json')) as unknown,
});
/** Wrangler's warning for a binding that the chosen environment does not repeat. */
const WARNING = 'exists at the top level, but not on "env.preview"';

/**
 * The upload command of the preview steps (10.1 step 4) with `--dry-run`: no login, no network. It shows that wrangler
 * accepts the built config with no `--env`, and it prints the bindings that the version would get.
 */
function dryUpload(dir: string): Run & { bindings: string[] } {
  const result = spawnSync(
    process.execPath,
    [
      wranglerBin(),
      'versions',
      'upload',
      '--config',
      'dist/server/wrangler.json',
      '--preview-alias',
      'b-0123456789',
      '--message',
      'branch 0000000',
      '--dry-run',
    ],
    { cwd: dir, env: wranglerEnv(dir), encoding: 'utf8', timeout: 120_000, maxBuffer: 16 * 1024 * 1024 },
  );
  const output = plain(`${result.stdout ?? ''}${result.stderr ?? ''}`);
  const table = /following bindings:\n([\s\S]*?)\n\s*\n/.exec(output)?.[1] ?? '';
  const bindings = table
    .split('\n')
    .map((line) => line.trim().replace(/\s{2,}/g, ': '))
    .filter((line) => line.startsWith('env.'));
  return { status: result.status, output, bindings };
}

/** The KV binding that the adapter adds for Astro sessions, with no id. */
const SESSION = [{ binding: 'SESSION' }];
const SESSION_LOG = 'Enabling sessions with Cloudflare KV';

test('S14: CLOUDFLARE_ENV=preview astro build rewrites dist/server/wrangler.json for <worker>-preview; with the locked `session: false`, ASSETS is its only binding', async () => {
  const dir = project('s14', files, options(), IMPORTS);
  const first = build(dir);
  const production = built(dir);

  // 13.1 item 16: the output splits, and `astro:build:done` gets the client directory.
  const output = clientOutput(dir);
  assert.equal(output.buildDoneDir, 'dist/client', 'build:done gets dist/client');
  assert.deepEqual(output.dist, ['client', 'server'], 'dist holds client and server only');
  assert.ok(existsSync(join(dir, 'dist/server/entry.mjs')), 'dist/server/entry.mjs exists');
  assert.ok(output.client.includes('index.html'), 'the prerendered page is in dist/client');
  const home = read(dir, 'dist/client/index.html');
  record('S14.output', output);

  // The config check of the deploy steps (10.1) holds: the built file equals `wrangler.jsonc` in the seven keys.
  assert.deepEqual(checked(production), checked(SOURCE), 'the built config equals wrangler.jsonc in the checked keys');
  assert.equal('build' in production, false, 'the built config holds no build command');
  assert.equal('targetEnvironment' in production, false, 'no environment is chosen');
  assert.equal(production.main, 'entry.mjs');
  assert.equal(production.no_bundle, true);
  const assets = { ...(SOURCE.assets as Json), directory: '../client', binding: 'ASSETS' };
  assert.deepEqual(production.assets, assets, 'the assets block points at dist/client and gets the binding ASSETS');
  assert.equal(first.output.includes(WARNING), false, 'no warning without the environment');
  // The locked `session: false` (6.1): the adapter enables no sessions, so it adds no KV binding.
  assert.equal(first.output.includes('Enabling sessions'), false, 'the adapter enables no sessions');
  assert.deepEqual(production.kv_namespaces, [], 'the production config holds no KV binding');
  record('S14.production', {
    keys: keys(production),
    ...checked(production),
    kv_namespaces: production.kv_namespaces,
    previews: production.previews,
    assets: production.assets,
    main: production.main,
    no_bundle: production.no_bundle,
  });

  const second = build(dir, { CLOUDFLARE_ENV: 'preview' });
  const preview = built(dir);
  // Every value is read again after the second build. The redirect file has the same text, and it now leads to the
  // config of the preview Worker.
  assert.deepEqual(clientOutput(dir), output, 'the client output is the same in both builds');
  assert.equal(read(dir, 'dist/client/index.html'), home, 'the built page has the same bytes in both builds');
  assert.equal(preview.targetEnvironment, 'preview', 'the build chose the preview environment');
  assert.deepEqual(
    keys(preview).filter((key) => key !== 'targetEnvironment'),
    keys(production),
    'the preview config has the keys of the production config and targetEnvironment',
  );
  // The name check of the preview steps (10.1 step 2).
  assert.equal(preview.name, SOURCE.env.preview.name, 'the name is the env.preview name of wrangler.jsonc');
  assert.equal(preview.name, 'example-ch-preview');
  assert.deepEqual(preview.routes, [], 'no routes');
  assert.equal(preview.workers_dev, true);
  assert.equal(preview.preview_urls, true);
  assert.equal(preview.compatibility_date, SOURCE.compatibility_date, 'the date is inherited');
  assert.deepEqual(preview.observability, SOURCE.observability, 'observability is inherited');
  assert.deepEqual(preview.assets, assets, 'the assets block is inherited');
  assert.equal('build' in preview, false, 'the built config holds no build command');
  // 13.1 item 24: the bindings are not inherited, and wrangler warns about each of them.
  // The keys are PRESENT and empty, so a check for the key alone would fail every preview (10.1 step 2).
  assert.deepEqual(preview.send_email, [], 'send_email is an empty list');
  assert.deepEqual(preview.ratelimits, [], 'ratelimits is an empty list');
  for (const key of ['send_email', 'ratelimits']) {
    assert.ok(second.output.includes(`"${key}" ${WARNING}`), `wrangler warns that ${key} is not inherited`);
  }
  // No KV binding in the preview either: the assets binding is the only binding of the uploaded version.
  assert.equal(second.output.includes('Enabling sessions'), false, 'the adapter enables no sessions');
  assert.deepEqual(preview.kv_namespaces, [], 'the preview config holds no KV binding');
  const upload = dryUpload(dir);
  assert.equal(upload.status, 0, `the dry run of the upload passes:\n${upload.output.slice(-2000)}`);
  assert.deepEqual(upload.bindings, ['env.ASSETS: Assets'], 'wrangler lists the assets binding only');
  // The built preview Worker answers its on-demand route, and the assets answer the page.
  const wrangler = await wranglerDev(dir, 'dist/server/wrangler.json');
  try {
    const sent = await get(wrangler.origin, '/api/forms/kontakt/', 'POST');
    assert.deepEqual({ status: sent.status, body: sent.body }, { status: 200, body: 'ok' }, wrangler.output().slice(-2000));
    assert.equal((await get(wrangler.origin, '/')).status, 200);
  } finally {
    await wrangler.close();
  }
  record('S14.preview', {
    keys: keys(preview),
    targetEnvironment: preview.targetEnvironment,
    name: preview.name,
    routes: preview.routes,
    workers_dev: preview.workers_dev,
    preview_urls: preview.preview_urls,
    send_email: preview.send_email,
    ratelimits: preview.ratelimits,
    kv_namespaces: preview.kv_namespaces,
    previews: preview.previews,
    bindings: upload.bindings,
    worker: 'POST /api/forms/kontakt/ answers 200',
  });
});

test('S14: without `session: false` the adapter adds the KV binding SESSION to the production config and to the preview config', () => {
  // `session: undefined` takes the locked value out of the stand-in's config, so Astro's default applies.
  const dir = project('s14-session', files, options(' config: { session: undefined },'), IMPORTS);
  const first = build(dir);
  const production = built(dir);
  assert.ok(first.output.includes(SESSION_LOG), 'the adapter says that it enables sessions');
  assert.deepEqual(production.kv_namespaces, SESSION, 'the adapter adds the KV binding SESSION, with no id');

  const second = build(dir, { CLOUDFLARE_ENV: 'preview' });
  const preview = built(dir);
  assert.ok(second.output.includes(SESSION_LOG), 'the adapter says so in the preview build too');
  assert.equal(preview.name, 'example-ch-preview');
  // So "a preview has no bindings" is false without the locked value: the KV binding is in the preview config.
  assert.deepEqual(preview.kv_namespaces, SESSION, 'the preview config holds the KV binding SESSION');
  assert.deepEqual(preview.send_email, []);
  assert.deepEqual(preview.ratelimits, []);
  const upload = dryUpload(dir);
  assert.equal(upload.status, 0, `the dry run of the upload passes:\n${upload.output.slice(-2000)}`);
  assert.deepEqual(upload.bindings, ['env.SESSION: KV Namespace', 'env.ASSETS: Assets'], 'wrangler lists two bindings');
  record('S14.withoutSessionFalse', {
    production: { kv_namespaces: production.kv_namespaces, previews: production.previews },
    preview: { kv_namespaces: preview.kv_namespaces, previews: preview.previews, bindings: upload.bindings },
  });
});

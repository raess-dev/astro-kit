import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { inflateSync } from 'node:zlib';
import { parse as parseYaml } from 'yaml';
import { checkRoutes, droppedSources, importRoutes, isBuilt, liveSitemap, parseUrlList, pathOf } from '../../src/ci.ts';
import { loadSchedule, loadSite } from '../../src/facts.ts';
import { changedFeatureShims, KIT_VERSION, PINS, render } from '../../src/init.ts';
import { buildManifest } from '../../src/manifest.ts';
import { type KitOptions, LIMITS, loadOptions } from '../../src/options.ts';
import { checkPackage, checkPublic, checkShims, checkSources, checkWrangler, imageSize } from '../../src/project.ts';
import { Report } from '../../src/registry.ts';
import { SHIMS } from '../../src/shims.ts';

const CLI = new URL('../../src/cli.ts', import.meta.url).pathname;
const temp = (): string => mkdtempSync(join(tmpdir(), 'kit-cli-'));
const cli = (cwd: string, ...args: string[]) => spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8' });
const read = (root: string, path: string): string => readFileSync(join(root, path), 'utf8');
const write = (root: string, path: string, text: string): void => {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
};

function options(root: string): KitOptions {
  const report = new Report();
  const loaded = loadOptions(root, report);
  assert.deepEqual(report.findings, []);
  assert.ok(loaded);
  return loaded;
}

/** Every pre-build check the integration runs, on the files init wrote. */
function preBuildFindings(root: string) {
  const report = new Report();
  const o = options(root);
  checkShims(root, report);
  checkPackage(root, o, report);
  checkSources(root, o, report);
  checkPublic(root, report);
  checkWrangler(root, o, report);
  loadSite(root, report);
  loadSchedule(root, report);
  const manifest = buildManifest(root, o, report, {});
  return { findings: report.findings, manifest, options: o };
}

// ── init ─────────────────────────────────────────────────────────────────────

test('init with forms and islands writes a project that passes every pre-build check', () => {
  const root = temp();
  const run = cli(
    root,
    'init',
    '--features',
    'forms,islands',
    '--locales',
    'de,fr,it,en',
    '--site',
    'https://www.muster-beratung.ch',
  );
  assert.equal(run.status, 0, run.stderr);
  for (const [path, text] of Object.entries(SHIMS)) assert.equal(read(root, path), text, path);
  for (const path of [
    '.npmrc',
    '.node-version',
    '.gitignore',
    '.mcp.json',
    'AGENTS.md',
    'CLAUDE.md',
    'KIT-FEEDBACK.md',
    'docs/spec.md',
    'eslint.config.mjs',
  ]) {
    assert.ok(existsSync(join(root, path)), path);
  }
  for (const path of [
    'src/content.config.ts',
    'src/pages/[...path].astro',
    'src/pages/404.astro',
    'src/pages/api/contact.ts',
    'src/styles/theme.css',
  ]) {
    assert.ok(existsSync(join(root, path)), path);
  }
  assert.ok(!existsSync(join(root, 'src/assets/og.jpg')), 'the owner supplies the share image');

  const { findings, manifest, options: o } = preBuildFindings(root);
  assert.deepEqual(findings, []);
  assert.equal(manifest.pages.length, 4 * 5);
  for (const code of ['de', 'fr', 'it', 'en']) {
    const pages = manifest.pages.filter((p) => p.locale === code);
    assert.equal(new Set(pages.map((p) => p.title)).size, pages.length, `${code} titles are unique`);
    for (const p of pages) {
      assert.ok(
        p.title.length >= LIMITS.titleMin && p.title.length <= LIMITS.titleMax,
        `${p.file} title ${p.title.length}`,
      );
      assert.ok(
        p.description.length >= LIMITS.descriptionMin && p.description.length <= LIMITS.descriptionMax,
        `${p.file} description ${p.description.length}`,
      );
    }
  }
  assert.deepEqual(manifest.byId.privacy?.fr?.processing, ['cdn', 'previews', 'forms', 'server']);
  assert.equal(manifest.byId.contact?.fr?.path, '/fr/contact/');
  assert.deepEqual(changedFeatureShims(root, o.features), []);
  assert.match(read(root, 'src/pages/[...path].astro'), /<ContactForm locale=\{page.locale\} \/>/);
  assert.equal(o.contact?.to, 'info@muster-beratung.ch');

  const pkg = JSON.parse(read(root, 'package.json')) as {
    dependencies: Record<string, string>;
    devDependencies: Record<string, string>;
    scripts: Record<string, string>;
  };
  assert.deepEqual(pkg.dependencies, {
    '@astrojs/cloudflare': '14.4.6',
    '@astrojs/solid-js': '7.1.2',
    '@raess/astro-kit': KIT_VERSION,
    astro: '7.4.8',
    'solid-js': '1.9.18',
    wrangler: '4.160.0',
  });
  assert.deepEqual(pkg.devDependencies, {
    eslint: '10.14.0',
    'eslint-plugin-solid': '0.19.0',
    'typescript-eslint': '8.72.2',
  });
  assert.deepEqual(pkg.scripts, {
    check: 'astro-kit check',
    build: 'astro-kit build',
    test: 'astro-kit test',
    ci: 'astro-kit ci',
  });
  assert.equal(read(root, '.npmrc'), 'ignore-scripts=true\nsave-exact=true\n');
  assert.equal(read(root, 'CLAUDE.md'), '@AGENTS.md\n');
  assert.ok(read(root, 'AGENTS.md').split('\n').length <= 21);
  assert.match(read(root, 'wrangler.jsonc'), /"pattern": "www\.muster-beratung\.ch"/);

  const png = readFileSync(join(root, 'public/apple-touch-icon.png'));
  assert.deepEqual(imageSize(png), { width: 180, height: 180 });
  const ico = readFileSync(join(root, 'public/favicon.ico'));
  assert.deepEqual(
    [ico.readUInt16LE(2), ico.readUInt16LE(4), ico[6], ico[7], ico.readUInt32LE(18)],
    [1, 1, 32, 32, 22],
  );
  assert.deepEqual(imageSize(ico.subarray(22)), { width: 32, height: 32 });
  const idat = png.indexOf('IDAT');
  assert.equal(inflateSync(png.subarray(idat + 4, idat + 4 + png.readUInt32BE(idat - 4))).length, 180 * (1 + 180 * 4));
});

test('init without features writes a static site with no form route', () => {
  const root = temp();
  assert.equal(cli(root, 'init').status, 0);
  const { findings, manifest, options: o } = preBuildFindings(root);
  assert.deepEqual(findings, []);
  assert.equal(o.site, 'https://example.ch');
  assert.deepEqual(Object.keys(manifest.byId).sort(), ['home', 'imprint', 'privacy', 'sitemap']);
  assert.deepEqual(manifest.byId.privacy?.de?.processing, ['cdn', 'previews']);
  assert.ok(!existsSync(join(root, 'src/pages/api/contact.ts')));
  assert.ok(!existsSync(join(root, 'eslint.config.mjs')));
  assert.doesNotMatch(read(root, 'src/pages/[...path].astro'), /ContactForm|\{\{/);
  assert.doesNotMatch(read(root, 'wrangler.jsonc'), /send_email/);
  assert.deepEqual(Object.keys((JSON.parse(read(root, 'package.json')) as { dependencies: object }).dependencies), [
    '@raess/astro-kit',
    'astro',
  ]);
});

test('init never overwrites without --force, and --shims restores the fixed files', () => {
  const root = temp();
  assert.equal(cli(root, 'init', '--features', 'islands').status, 0);
  writeFileSync(join(root, 'AGENTS.md'), 'mine\n');
  writeFileSync(join(root, 'biome.json'), '{}\n');
  writeFileSync(join(root, 'eslint.config.mjs'), 'export default [];\n');
  const again = cli(root, 'init');
  assert.equal(again.status, 0);
  assert.match(again.stdout, /kept {2}AGENTS\.md/);
  assert.equal(read(root, 'AGENTS.md'), 'mine\n');
  const changed = new Report();
  checkShims(root, changed);
  assert.deepEqual(changed.findings, [{ rule: 'config-shim', where: 'biome.json', detail: 'content differs' }]);
  assert.deepEqual(changedFeatureShims(root, options(root).features), ['eslint.config.mjs']);

  assert.equal(cli(root, 'init', '--shims').status, 0);
  assert.equal(read(root, 'biome.json'), SHIMS['biome.json']);
  assert.deepEqual(changedFeatureShims(root, options(root).features), []);
  assert.equal(read(root, 'AGENTS.md'), 'mine\n', '--shims touches only the fixed files');

  assert.equal(cli(root, 'init', '--force').status, 0);
  assert.match(read(root, 'AGENTS.md'), /^# Example/);
});

test('init keeps an existing astro-kit.json and rejects an unknown feature', () => {
  const root = temp();
  write(
    root,
    'astro-kit.json',
    JSON.stringify({
      site: 'https://kanzlei.ch',
      locales: [{ code: 'it', tag: 'it-CH', name: 'Italiano' }],
      defaultLocale: 'it',
      securityContact: 'mailto:s@kanzlei.ch',
    }),
  );
  const run = cli(root, 'init', '--features', 'forms');
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /flags are ignored/);
  assert.ok(existsSync(join(root, 'src/content/pages/it/privacy.md')));
  assert.ok(!existsSync(join(root, 'src/pages/api/contact.ts')));
  assert.deepEqual(preBuildFindings(root).findings, []);
  const bad = cli(temp(), 'init', '--features', 'forms,blog');
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /unknown feature blog/);
});

test('render keeps flagged blocks, fills names and leaves GitHub expressions alone', () => {
  const text = 'a {{NAME}}\n{{#forms}}\nform\n{{/forms}}\n${{ github.sha }} {{OTHER}}';
  assert.equal(render(text, { NAME: 'x' }, { forms: true }), 'a x\nform\n${{ github.sha }} {{OTHER}}');
  assert.equal(render(text, { NAME: 'x' }, { forms: false }), 'a x\n${{ github.sha }} {{OTHER}}');
});

// ── the files init writes for CI and agents ─────────────────────────────────

test('site.yml pins every action by SHA, grants nothing at the top and names the required check', () => {
  const root = temp();
  assert.equal(cli(root, 'init').status, 0);
  const text = read(root, '.github/workflows/site.yml');
  assert.doesNotMatch(text, /\{\{[A-Z_]+\}\}/);
  assert.match(text, new RegExp(`wrangler@${PINS.wrangler.replace(/\./g, '\\.')}`));
  const flow = parseYaml(text) as {
    permissions: unknown;
    jobs: Record<
      string,
      {
        name?: string;
        permissions?: unknown;
        'timeout-minutes'?: number;
        steps: { uses?: string; with?: Record<string, unknown> }[];
      }
    >;
  };
  assert.deepEqual(flow.permissions, {});
  assert.equal(flow.jobs.ci?.name, 'site / ci');
  assert.deepEqual(Object.keys(flow.jobs), ['ci', 'merge', 'build', 'deploy', 'preview', 'smoke', 'feedback']);
  for (const [id, job] of Object.entries(flow.jobs)) {
    assert.ok(job.permissions, `${id} grants its own permissions`);
    assert.ok(job['timeout-minutes'], `${id} has a timeout`);
    for (const step of job.steps) {
      if (!step.uses) continue;
      assert.match(step.uses, /^actions\/[a-z-]+@[0-9a-f]{40}$/, `${id}: ${step.uses}`);
      if (step.uses.startsWith('actions/checkout')) assert.equal(step.with?.['persist-credentials'], false, id);
    }
  }
  for (const line of text.split('\n').filter((l) => /uses: /.test(l)))
    assert.match(line, /@[0-9a-f]{40} # v\d+\.\d+\.\d+$/);
  const rulesets = JSON.parse(
    readFileSync(new URL('../../templates/github-org-rulesets.json', import.meta.url), 'utf8'),
  ) as {
    rulesets: { rules: { type: string; parameters?: { required_status_checks?: { context: string }[] } }[] }[];
  };
  const checks = rulesets.rulesets.flatMap((r) => r.rules).flatMap((r) => r.parameters?.required_status_checks ?? []);
  assert.deepEqual(
    checks.map((c) => c.context),
    ['site / ci'],
  );
  const dependabot = parseYaml(read(root, '.github/dependabot.yml')) as {
    updates: { 'package-ecosystem': string; groups?: object; cooldown: { exclude?: string[] } }[];
  };
  assert.deepEqual(
    dependabot.updates.map((u) => u['package-ecosystem']),
    ['npm', 'github-actions'],
  );
  assert.deepEqual(Object.keys(dependabot.updates[0]?.groups ?? {}), ['kit', 'astro', 'other']);
  assert.deepEqual(dependabot.updates[0]?.cooldown.exclude, ['@raess/astro-kit']);
  const mcp = JSON.parse(read(root, '.mcp.json')) as { mcpServers: Record<string, { type: string; url: string }> };
  assert.deepEqual(mcp.mcpServers['astro-docs'], { type: 'http', url: 'https://mcp.docs.astro.build/mcp' });
  assert.deepEqual(mcp.mcpServers['cloudflare-docs'], { type: 'http', url: 'https://docs.mcp.cloudflare.com/mcp' });
});

test('the deploy job refuses a built mail binding that differs from wrangler.jsonc', () => {
  const root = temp();
  assert.equal(cli(root, 'init', '--features', 'forms').status, 0);
  const flow = parseYaml(read(root, '.github/workflows/site.yml')) as {
    jobs: { deploy: { steps: { name?: string; run?: string }[] } };
  };
  const script = flow.jobs.deploy.steps.find((s) => s.name?.startsWith('The built mail binding'))?.run ?? '';
  const step = () => spawnSync('bash', ['-c', script], { cwd: root, encoding: 'utf8' });
  assert.match(step().stdout, /static site/, 'no adapter output, nothing to compare');
  const binding = (to: string[]) =>
    JSON.stringify({ main: 'entry.mjs', send_email: [{ name: 'EMAIL', allowed_destination_addresses: to }] });
  write(root, 'dist/server/wrangler.json', binding(['info@example.ch']));
  assert.equal(step().status, 0, step().stderr);
  write(root, 'dist/server/wrangler.json', binding(['info@example.ch', 'someone@elsewhere.example']));
  assert.match(step().stderr, /send_email differs/);
});

test('the SessionStart hook installs only when the lockfile changes, then prints INDEX.md', () => {
  const root = temp();
  assert.equal(cli(root, 'init').status, 0);
  const settings = JSON.parse(read(root, '.claude/settings.json')) as {
    hooks: { SessionStart: { matcher: string; hooks: { timeout: number; command: string }[] }[] };
    permissions: { deny: string[] };
  };
  const hook = settings.hooks.SessionStart[0];
  assert.equal(hook?.matcher, 'startup|resume');
  assert.equal(hook?.hooks[0]?.timeout, 300);
  assert.deepEqual(settings.permissions.deny, ['Edit(/node_modules/**)', 'Write(/node_modules/**)']);
  const command = hook?.hooks[0]?.command ?? '';
  // A stand-in npm on PATH records each call, so the test never installs anything.
  const bin = join(root, 'fake-bin');
  write(root, 'fake-bin/npm', '#!/bin/sh\necho "$*" >> "$CLAUDE_PROJECT_DIR/npm-calls"\n');
  chmodSync(join(bin, 'npm'), 0o755);
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH ?? ''}`, CLAUDE_PROJECT_DIR: root };
  const start = () => spawnSync('sh', ['-c', command], { cwd: tmpdir(), env, encoding: 'utf8' });
  assert.match(start().stdout, /No package-lock\.json yet/);
  write(root, 'package-lock.json', '{"lockfileVersion":3}');
  write(root, 'node_modules/@raess/astro-kit/docs/INDEX.md', '# Kit index\n');
  const first = start();
  assert.equal(first.status, 0, first.stderr);
  assert.equal(first.stdout, '# Kit index\n');
  assert.equal(start().stdout, '# Kit index\n');
  assert.equal(read(root, 'npm-calls'), 'ci --ignore-scripts --no-audit --no-fund\n', 'one install for one lockfile');
  write(root, 'package-lock.json', '{"lockfileVersion":3,"x":1}');
  start();
  assert.equal(read(root, 'npm-calls').split('\n').filter(Boolean).length, 2);
});

test('the kit identity step fails on a non-registry, unhashed or downgraded kit', () => {
  const root = temp();
  assert.equal(cli(root, 'init').status, 0);
  const lock = (version: string, resolved: string, integrity = 'sha512-abc') =>
    JSON.stringify({
      lockfileVersion: 3,
      packages: { 'node_modules/@raess/astro-kit': { version, resolved, integrity } },
    });
  const registry = (v: string) => `https://registry.npmjs.org/@raess/astro-kit/-/astro-kit-${v}.tgz`;
  const identity = () =>
    spawnSync('bash', ['.github/kit-identity.sh'], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, BASE_REF: 'main' },
    });
  const git = (...args: string[]) =>
    spawnSync('git', ['-c', 'user.name=kit', '-c', 'user.email=kit@example.invalid', ...args], {
      cwd: root,
      encoding: 'utf8',
    });
  write(root, 'package-lock.json', lock('0.2.0', registry('0.2.0')));
  assert.equal(identity().status, 0);
  write(root, 'package-lock.json', lock('0.2.0', 'file:../astro-kit-0.2.0.tgz'));
  assert.match(identity().stdout, /\[config-kit-identity\] the kit must resolve from/);
  write(root, 'package-lock.json', lock('0.2.0', registry('0.2.0'), ''));
  assert.equal(identity().status, 1);
  write(root, 'package-lock.json', lock('0.2.0', registry('0.2.0')));
  writeFileSync(join(root, '.npmrc'), 'save-exact=true\n');
  assert.match(identity().stdout, /ignore-scripts=true/);
  writeFileSync(join(root, '.npmrc'), 'ignore-scripts=true\n');
  // The base branch, as origin/main of a scratch repository.
  git('init', '-q');
  git('add', 'package-lock.json');
  git('commit', '-q', '-m', 'base');
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  write(root, 'package-lock.json', lock('0.1.9', registry('0.1.9')));
  assert.match(identity().stdout, /went down from 0\.2\.0/);
  write(root, 'package-lock.json', lock('0.10.0', registry('0.10.0')));
  assert.equal(identity().status, 0);
});

// ── routes ───────────────────────────────────────────────────────────────────

/** A project with a built dist: /, /a/ and /404.html. */
function builtProject(redirects?: unknown[]): string {
  const root = temp();
  assert.equal(cli(root, 'init').status, 0);
  for (const page of ['index.html', 'a/index.html', '404.html']) write(root, `dist/${page}`, '<html></html>');
  write(root, 'dist/robots.txt', '');
  if (redirects) write(root, 'src/content/redirects.json', JSON.stringify(redirects));
  return root;
}

test('url lists: sitemap locs, text lines, paths and the trailing-slash rule', () => {
  assert.deepEqual(
    parseUrlList(
      '<urlset><url><loc> https://old.ch/a?x=1&amp;y=2 </loc></url><url><loc>https://old.ch/b/</loc></url></urlset>',
    ),
    ['https://old.ch/a?x=1&y=2', 'https://old.ch/b/'],
  );
  assert.deepEqual(parseUrlList('# old site\n/a\n\nhttps://old.ch/b # moved\n'), ['/a', 'https://old.ch/b']);
  assert.deepEqual(pathOf('https://old.ch/b/?q=1'), { path: '/b/', query: true });
  assert.deepEqual(pathOf('/c'), { path: '/c', query: false });
  const built = new Set(['/', '/a/', '/robots.txt']);
  assert.ok(
    isBuilt('/a', built) && isBuilt('/a/', built) && isBuilt('/a/index.html', built) && isBuilt('/robots.txt', built),
  );
  assert.ok(!isBuilt('/b/', built));
});

test('routes-removed: a dropped base-branch source fails unless its path is built again', () => {
  const built = new Set(['/', '/back/']);
  assert.deepEqual(droppedSources(['/old/', '/back/', '/kept/'], ['/kept/'], built), ['/old/']);
  assert.deepEqual(droppedSources(['/old/'], ['/old/'], built), []);
});

test('routes-removed: the base branch redirects.json is read through git', async () => {
  const root = builtProject([
    { from: '/old/', to: '/a/' },
    { from: '/gone/', gone: true },
  ]);
  const git = (...args: string[]) =>
    spawnSync('git', ['-c', 'user.name=kit', '-c', 'user.email=kit@example.invalid', ...args], {
      cwd: root,
      encoding: 'utf8',
    });
  git('init', '-q');
  git('add', 'src/content/redirects.json');
  git('commit', '-q', '-m', 'base');
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  const offline = (async () => new Response('', { status: 404 })) as typeof fetch;
  const run = async () => {
    const report = new Report();
    await checkRoutes(root, options(root), report, offline, { GITHUB_BASE_REF: 'main' });
    return report.findings;
  };
  assert.deepEqual(await run(), []);
  write(root, 'src/content/redirects.json', JSON.stringify([{ from: '/gone/', gone: true }]));
  assert.deepEqual(await run(), [
    {
      rule: 'routes-removed',
      where: 'src/content/redirects.json',
      detail: '/old/ is a source on origin/main and is gone',
    },
  ]);
});

test('routes-removed: a page published on the base branch keeps its URL', async () => {
  const root = temp();
  assert.equal(cli(root, 'init').status, 0);
  const git = (...args: string[]) =>
    spawnSync('git', ['-c', 'user.name=kit', '-c', 'user.email=kit@example.invalid', ...args], {
      cwd: root,
      encoding: 'utf8',
    });
  git('init', '-q');
  git('add', '-A');
  git('commit', '-q', '-m', 'base');
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  // The current build: every page of the base branch, under its base URL.
  const report = new Report();
  const paths = buildManifest(root, options(root), report, {}).pages.map((p) => p.path);
  assert.ok(paths.includes('/impressum/'), paths.join(' '));
  const build = (list: string[]) => {
    for (const path of list) write(root, `dist${path}index.html`, '<html></html>');
  };
  build(paths);
  const offline = (async () => new Response('', { status: 404 })) as typeof fetch;
  const run = async () => {
    const found = new Report();
    await checkRoutes(root, options(root), found, offline, { GITHUB_BASE_REF: 'main' });
    return found.findings;
  };
  assert.deepEqual(await run(), []);
  // The imprint moves to a new slug without a redirect.
  rmSync(join(root, 'dist'), { recursive: true, force: true });
  build(paths.map((p) => (p === '/impressum/' ? '/rechtliches/' : p)));
  assert.deepEqual(await run(), [
    {
      rule: 'routes-removed',
      where: '/impressum/',
      detail: 'published on origin/main; add a redirects.json row for it',
    },
  ]);
  write(root, 'src/content/redirects.json', JSON.stringify([{ from: '/impressum/', to: '/rechtliches/' }]));
  assert.deepEqual(await run(), []);
});

test('routes-removed: every live sitemap URL is built or redirected; 404 and DNS failures skip', async () => {
  const root = builtProject([{ from: '/blog/*', to: '/a/' }]);
  const sitemap = (body: string, status = 200) => (async () => new Response(body, { status })) as typeof fetch;
  const run = async (call: typeof fetch, env: Record<string, string> = {}) => {
    const report = new Report();
    await checkRoutes(root, options(root), report, call, env);
    return report.findings.map((f) => f.detail);
  };
  const live =
    '<urlset><url><loc>https://example.ch/</loc></url><url><loc>https://example.ch/a</loc></url><url><loc>https://example.ch/blog/x/</loc></url></urlset>';
  assert.deepEqual(await run(sitemap(live)), []);
  assert.deepEqual(await run(sitemap(live.replace('/a<', '/lost/<'))), [
    '/lost/ is neither built nor a redirects.json source',
  ]);
  assert.deepEqual(await run(sitemap(live.replace('/a<', '/a?page=2<'))), [
    `https://example.ch/a?page=2: query strings cannot be matched; mark it gone or add a zone Single Redirect`,
  ]);
  assert.deepEqual(await run(sitemap('', 404)), []);
  assert.deepEqual(await run(sitemap('', 503)), ['https://example.ch/sitemap.xml answers 503']);
  const dns = (async () => {
    throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } });
  }) as typeof fetch;
  assert.deepEqual(await run(dns), []);
  const refused = (async () => {
    throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
  }) as typeof fetch;
  assert.equal((await run(refused)).length, 1);
  assert.deepEqual(await run(sitemap(live), { GITHUB_ACTIONS: 'true' }), [
    'the base branch is not fetched; check out with fetch-depth: 0',
  ]);
});

test('liveSitemap follows a sitemap index and sends a descriptive User-Agent', async () => {
  const agents: string[] = [];
  const call = (async (url: string | URL | Request, init: RequestInit = {}) => {
    agents.push((init.headers as Record<string, string>)['user-agent'] ?? '');
    if (String(url).endsWith('/sitemap.xml'))
      return new Response(
        '<sitemapindex><sitemap><loc>https://example.ch/sitemap-0.xml</loc></sitemap></sitemapindex>',
      );
    return new Response('<urlset><url><loc>https://example.ch/x/</loc></url></urlset>');
  }) as typeof fetch;
  assert.deepEqual(await liveSitemap('https://example.ch', call), { paths: ['https://example.ch/x/'] });
  assert.ok(
    agents.every((a) => /^astro-kit\/\S+ \(\+https:\/\/github\.com\/raess-dev\/astro-kit; route check\)$/.test(a)),
  );
});

test('routes import adds gone rows for unbuilt paths and rejects query strings', () => {
  const root = builtProject([{ from: '/kept/', to: '/a/' }]);
  write(root, 'urls.txt', 'https://old.ch/a\n/kept/\n/old/\nhttps://old.ch/old/\n/list?page=2\n/c\n');
  const run = cli(root, 'routes', 'import', 'urls.txt');
  assert.equal(run.status, 1, 'a rejected URL is an error');
  assert.match(run.stderr, /rejected \/list\?page=2: query strings cannot be matched/);
  assert.deepEqual(JSON.parse(read(root, 'src/content/redirects.json')), [
    { from: '/kept/', to: '/a/' },
    { from: '/old/', gone: true },
    { from: '/c', gone: true },
  ]);
  write(root, 'sitemap.xml', '<urlset><url><loc>https://old.ch/old/</loc></url></urlset>');
  assert.deepEqual(importRoutes(root, join(root, 'sitemap.xml')), { added: [], rejected: [] });
  rmSync(join(root, 'dist'), { recursive: true });
  assert.throws(() => importRoutes(root, join(root, 'sitemap.xml')), /run `npx --no astro-kit build` first/);
});

test('the CLI prints usage for an unknown command', () => {
  const run = cli(temp(), 'deploy');
  assert.equal(run.status, 2);
  assert.match(run.stderr, /astro-kit <command>/);
  assert.equal(cli(temp(), 'routes', 'export').status, 2);
});

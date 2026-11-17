/**
 * The site cases of milestone M3 (specification, 14 and 14.2): the hotel site with the packed kit. Each case is a copy
 * of the site in a folder of its own, with one change, and it runs a command of the kit CLI there. M3 has the
 * commands `build` and `tokens`. A failing case asserts the exact sorted rule ids, and a passing case asserts status 0.
 * Without a kit every case is skipped, with the reason. Run: KIT_TARBALL=<packed kit> node --test test/site.test.ts
 */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { cspMeta, edit, type KitRun, kitModule, noKit, read, run, siteCase, tree, write } from './harness.ts';

/** The settings of `astro-kit.json` after the kit read them. A case uses these members only. */
interface Options {
  site: string;
  defaultLocale: string;
  locales: { code: string }[];
  legal: Record<string, Record<string, string> | undefined>;
}

// The members of the built kit modules that the cases use. The exports map hides the modules (14.2).
interface OptionsModule {
  loadOptions(root: string, report: unknown): Options | undefined;
}
interface RegistryModule {
  Report: new () => { findings: unknown[] };
}
interface ModesModule {
  modeScript(options: Options): string;
  modeHash(options: Options): string;
}
interface CspModule {
  SPECULATION_JSON: string;
  SPECULATION_HASH: string;
}
interface CloudflareModule {
  robotsText(site: string): string;
}

/** The reason to skip every case: the base copy holds no kit. `undefined` when it holds one. */
const skip = noKit();

interface Built {
  dir: string;
  run: KitRun;
}

let site: Built | undefined;

/** The unchanged site, built once with the kit. The passing cases read this one build. */
function built(): Built {
  if (site === undefined) {
    const dir = siteCase('site');
    site = { dir, run: run(dir, 'build') };
  }
  return site;
}

/** The settings of a case, read with the kit's own loader. */
async function optionsOf(dir: string): Promise<Options> {
  const { loadOptions } = await kitModule<OptionsModule>('options');
  const { Report } = await kitModule<RegistryModule>('registry');
  const report = new Report();
  const options = loadOptions(dir, report);
  if (options === undefined) throw new Error(`astro-kit.json is not valid: ${JSON.stringify(report.findings)}`);
  return options;
}

/** The last part of a command's output, for the message of a failed assertion. */
const tail = (result: KitRun): string => result.output.slice(-4000);

/** Every CSP meta start tag of a built page (6.1): the kit inserts right after the one that a page has. */
const CSP_META = /<meta\b[^>]*http-equiv="?content-security-policy"?[^>]*>/gi;

test('M3: the site builds, and every page has the CSP meta, the mode script and the speculation block', {
  skip,
}, async () => {
  const { dir, run: result } = built();
  assert.equal(result.status, 0, `astro-kit build failed in ${dir}:\n${tail(result)}`);
  assert.deepEqual(result.ids, []);

  const options = await optionsOf(dir);
  const { modeScript, modeHash } = await kitModule<ModesModule>('modes');
  const { SPECULATION_JSON, SPECULATION_HASH } = await kitModule<CspModule>('csp');
  const mode = `<script>${modeScript(options)}</script>`;
  const speculation = `<script type="speculationrules">${SPECULATION_JSON}</script>`;

  const pages = tree(join(dir, 'dist')).filter((file) => file.endsWith('.html'));
  // Stage 1 of the site: the home of each locale, each declared legal page, and the one 404 page.
  const homes = options.locales.map(({ code }) => (code === options.defaultLocale ? '' : `${code}/`));
  const legal = Object.values(options.legal).flatMap((paths) =>
    Object.values(paths ?? {}).map((path) => path.slice(1)),
  );
  for (const path of [...homes, ...legal]) assert.ok(pages.includes(`${path}index.html`), `/${path} is not built`);
  assert.ok(pages.includes('404.html'), '/404.html is not built');

  for (const page of pages) {
    const html = read(join(dir, 'dist'), page);
    const metas = [...html.matchAll(CSP_META)];
    assert.equal(metas.length, 1, `${page}: ${metas.length} CSP metas`);
    const meta = metas[0];
    assert.ok(meta);
    // The two inserts follow the meta with no byte between them (6.1), and each is in the page once.
    const after = html.slice(meta.index + meta[0].length);
    assert.ok(after.startsWith(mode), `${page}: the mode script is not right after the CSP meta`);
    assert.ok(after.slice(mode.length).startsWith(speculation), `${page}: no speculation block after the mode script`);
    assert.equal(html.split(mode).length, 2, `${page}: more than one mode script`);
    assert.equal(html.split('<script type="speculationrules"').length, 2, `${page}: more than one speculation block`);
    // The policy allows both inline scripts by their hashes (6.2).
    const policy = cspMeta(html);
    assert.ok(policy.includes(`'${modeHash(options)}'`), `${page}: the CSP meta lacks the hash of the mode script`);
    assert.ok(
      policy.includes(`'${SPECULATION_HASH}'`),
      `${page}: the CSP meta lacks the hash of the speculation block`,
    );
  }
});

test('M3: tokens --check passes, so tokens.css is the rendering of docs/design.md', { skip }, () => {
  const result = run(built().dir, ['tokens', '--check']);
  assert.equal(result.status, 0, tail(result));
  assert.deepEqual(result.ids, []);
});

test('M3: the edge files exist, and robots.txt is the text of the kit', { skip }, async () => {
  const { dir, run: result } = built();
  assert.equal(result.status, 0, `astro-kit build failed in ${dir}:\n${tail(result)}`);
  const dist = join(dir, 'dist');
  // The files of 6.3.
  for (const file of [
    '_headers',
    '_redirects',
    'robots.txt',
    'sitemap.xml',
    '.well-known/security.txt',
    '_kit/release.txt',
    '_kit/routes.txt',
  ]) {
    assert.ok(existsSync(join(dist, file)), `dist/${file} is missing`);
  }
  const options = await optionsOf(dir);
  const { robotsText } = await kitModule<CloudflareModule>('hosts/cloudflare');
  const robots = read(dist, 'robots.txt');
  assert.equal(robots, robotsText(options.site));
  // The exact text of 6.3, so that the kit and the specification cannot differ unseen.
  assert.equal(
    robots,
    `User-agent: *\nAllow: /\nContent-Signal: search=yes, ai-input=yes, ai-train=no\n\nSitemap: ${options.site}/sitemap.xml\n`,
  );
});

// The planted cases. Each one fails in the config stage, before Astro builds a page.

test('M3 planted: a value changed by hand in tokens.css gives design-tokens', { skip }, () => {
  const dir = siteCase('planted-design-tokens', (folder) => {
    // The first length in rem of the file gets a value that no design declares.
    edit(folder, 'src/styles/tokens.css', /: [\d.]+rem;/, ': 77.7rem;');
  });
  const result = run(dir, 'build');
  assert.deepEqual(result.ids, ['design-tokens'], tail(result));
  assert.equal(result.status, 1);
  // `tokens --check` compares the same file and writes nothing.
  const check = run(dir, ['tokens', '--check']);
  assert.deepEqual(check.ids, ['design-tokens'], tail(check));
  assert.equal(check.status, 1);
});

test('M3 planted: // @ts-ignore in a source gives config-suppression', { skip }, () => {
  const dir = siteCase('planted-config-suppression', (folder) => {
    const file = 'src/data/routes.ts';
    write(folder, { [file]: `${read(folder, file)}// @ts-ignore\n` });
  });
  const result = run(dir, 'build');
  assert.deepEqual(result.ids, ['config-suppression'], tail(result));
  assert.equal(result.status, 1);
});

test('M3 planted: a redirect row with a query string in from gives routes-redirects', { skip }, () => {
  const dir = siteCase('planted-routes-redirects', (folder) => {
    write(folder, { 'redirects.json': `${JSON.stringify([{ from: '/angebot/?id=7', to: '/' }], null, 2)}\n` });
  });
  const result = run(dir, 'build');
  assert.deepEqual(result.ids, ['routes-redirects'], tail(result));
  assert.equal(result.status, 1);
});

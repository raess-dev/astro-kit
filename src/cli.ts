#!/usr/bin/env node
/**
 * The astro-kit command line, run in the project root as `npx --no astro-kit <command>`.
 * Heavy modules load per command, so `feedback send` runs with node built-ins only.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import type { Finding } from './registry.ts';

const USAGE = `astro-kit <command>
  init [--features forms,islands,scripts] [--site https://host] [--locales de,fr] [--shims] [--force]
  check                          the kit's project checks, Biome, then astro check
  build                          astro build with every build audit
  test [--all] [--outline <url>] the browser checks
  smoke <url> [--probe]          the production checks
  ci                             check, build, test --all, then the base-branch and live-sitemap route checks
  routes import <sitemap.xml|urls.txt>   adds {from, gone: true} for old URLs that are not built
  provision zone --check|--apply the Cloudflare zone settings
  feedback send                  files new KIT-FEEDBACK.md entries (needs KIT_FEEDBACK_TOKEN)`;

const ext = import.meta.url.endsWith('.ts') ? '.ts' : '.js';
/** Loads a sibling module by URL, so this file compiles before browser.ts, smoke.ts and provision.ts exist. */
const sibling = <T>(name: string): Promise<T> => import(new URL(`./${name}${ext}`, import.meta.url).href) as Promise<T>;

interface Browser {
  runBrowserTests: (opts: { root: string; all: boolean; outline?: string }) => Promise<unknown>;
}
interface Smoke {
  runSmoke: (url: string, opts: { root: string; probe: boolean }) => Promise<unknown>;
}
interface Provision {
  runProvision: (args: string[]) => Promise<unknown>;
}

/** A run passes when it returns no findings, true or 0; findings are printed with their fixes. */
async function outcome(result: Promise<unknown>): Promise<number> {
  const value = await result;
  const findings = Array.isArray(value) ? value : (value as { findings?: unknown } | undefined)?.findings;
  if (Array.isArray(findings)) {
    if (!findings.length) return 0;
    const [{ formatFindings }, { summary }] = await Promise.all([import('./registry.ts'), import('./ci.ts')]);
    const text = formatFindings(findings as Finding[]);
    console.error(text);
    summary(text);
    return 1;
  }
  if (typeof value === 'number') return value;
  return value === false ? 1 : 0;
}

const browserTests = (root: string, all: boolean, outline?: string): Promise<number> =>
  outcome(
    sibling<Browser>('browser').then((m) =>
      m.runBrowserTests(outline === undefined ? { root, all } : { root, all, outline }),
    ),
  );

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  const root = process.cwd();
  switch (command) {
    case 'init': {
      const { values } = parseArgs({
        args: rest,
        options: {
          features: { type: 'string' },
          site: { type: 'string' },
          locales: { type: 'string' },
          shims: { type: 'boolean' },
          force: { type: 'boolean' },
        },
      });
      const { FEATURES, init } = await import('./init.ts');
      const list = (s?: string) =>
        s
          ? s
              .split(',')
              .map((x) => x.trim())
              .filter(Boolean)
          : [];
      const features = list(values.features);
      const unknown = features.filter((f) => !(FEATURES as readonly string[]).includes(f));
      if (unknown.length)
        throw new Error(`astro-kit init: unknown feature ${unknown.join(', ')} (${FEATURES.join(', ')})`);
      if (existsSync(join(root, 'astro-kit.json')) && (values.features || values.site || values.locales)) {
        console.log(
          'astro-kit init: astro-kit.json exists and decides site, locales and features; the flags are ignored.',
        );
      }
      const { written, kept } = init({
        root,
        features: features as ('forms' | 'islands' | 'scripts')[],
        locales: list(values.locales),
        ...(values.site ? { site: values.site } : {}),
        shims: values.shims === true,
        force: values.force === true,
      });
      for (const path of written) console.log(`  wrote ${path}`);
      for (const path of kept) console.log(`  kept  ${path} (exists; --force overwrites)`);
      if (!values.shims) {
        console.log('\nNext: npm install --ignore-scripts, then npx --no astro-kit ci.');
        console.log('The owner supplies docs/spec.md, src/content/site.json and the legal text.');
        console.log(
          'The build fails head-og until the owner adds src/assets/og.jpg (1200×630, the default share image).',
        );
      }
      return 0;
    }
    case 'check':
      return (await import('./ci.ts')).check(root);
    case 'build':
      return (await import('./ci.ts')).build(root);
    case 'test': {
      const { values } = parseArgs({ args: rest, options: { all: { type: 'boolean' }, outline: { type: 'string' } } });
      return browserTests(root, values.all === true, values.outline);
    }
    case 'smoke': {
      const { values, positionals } = parseArgs({
        args: rest,
        allowPositionals: true,
        options: { probe: { type: 'boolean' } },
      });
      const url = positionals[0];
      if (!url?.startsWith('https://'))
        throw new Error('astro-kit smoke: give the production origin, e.g. https://example.ch');
      return outcome(
        sibling<Smoke>('smoke').then((m) =>
          m.runSmoke(url.replace(/\/+$/, ''), { root, probe: values.probe === true }),
        ),
      );
    }
    case 'ci':
      return (await import('./ci.ts')).runCi(root, () => browserTests(root, true));
    case 'routes': {
      if (rest[0] !== 'import' || !rest[1]) break;
      const { importRoutes } = await import('./ci.ts');
      const { added, rejected } = importRoutes(root, rest[1]);
      console.log(`astro-kit routes import: ${added.length} row(s) added to src/content/redirects.json as gone.`);
      if (added.length) console.log('Turn a row into {from, to} where the page moved.');
      for (const line of rejected) console.error(`  rejected ${line}`);
      return rejected.length ? 1 : 0;
    }
    case 'provision':
      return outcome(sibling<Provision>('provision').then((m) => m.runProvision(rest)));
    case 'feedback': {
      if (rest[0] !== 'send') break;
      const fb = await import('./feedback.ts');
      const file = join(root, fb.FEEDBACK_FILE);
      const { entries, errors } = fb.parseFeedback(existsSync(file) ? readFileSync(file, 'utf8') : '');
      for (const error of errors) console.error(`  ${fb.FEEDBACK_FILE}: ${error}`);
      const token = process.env.KIT_FEEDBACK_TOKEN;
      if (!token) {
        console.log(
          `astro-kit feedback: no KIT_FEEDBACK_TOKEN; ${entries.length} entr${entries.length === 1 ? 'y stays' : 'ies stay'} in ${fb.FEEDBACK_FILE}.`,
        );
        return errors.length ? 1 : 0;
      }
      const version = (
        JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }
      ).version;
      const { sent, skipped } = await fb.sendFeedback(entries, {
        token,
        key: process.env.KIT_FEEDBACK_AUTO_KEY || undefined,
        userAgent: `astro-kit/${version} feedback`,
      });
      console.log(
        `astro-kit feedback: sent ${sent.join(', ') || 'none'}; already filed ${skipped.join(', ') || 'none'}.`,
      );
      return errors.length ? 1 : 0;
    }
    case undefined:
    case 'help':
    case '--help':
      console.log(USAGE);
      return 0;
  }
  console.error(USAGE);
  return 2;
}

/**
 * Commands that call remote hosts. Not ci: inside a session, its live-sitemap check skips a host that does not
 * resolve, while the proxy would refuse a site host that is not allowed, which is not a broken URL. GitHub runs it
 * in full.
 */
const NETWORK = new Set(['smoke', 'provision', 'feedback']);

/**
 * Node's fetch ignores HTTPS_PROXY unless NODE_USE_ENV_PROXY=1 is set when Node starts. Behind a proxy (a Claude
 * cloud session), a network command therefore runs again in a child process with it on. NO_PROXY still applies.
 */
function rerunBehindProxy(command: string | undefined, env = process.env): number | undefined {
  if (!command || !NETWORK.has(command) || !(env.HTTPS_PROXY || env.https_proxy) || env.NODE_USE_ENV_PROXY) return;
  const child = spawnSync(process.execPath, [...process.execArgv, ...process.argv.slice(1)], {
    stdio: 'inherit',
    // NODE_NO_WARNINGS hides Node's notice that the proxy agent is experimental.
    env: { ...env, NODE_USE_ENV_PROXY: '1', NODE_NO_WARNINGS: env.NODE_NO_WARNINGS ?? '1' },
  });
  return child.status ?? 1;
}

const rerun = rerunBehindProxy(process.argv[2]);
const run = rerun === undefined ? main(process.argv.slice(2)) : Promise.resolve(rerun);
run.then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  },
);

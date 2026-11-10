import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { AstroIntegration } from 'astro';
import { runAudits } from './audit/index.ts';
import { loadBuild } from './build.ts';
import { cspConfig, prefetchGateScript } from './csp.ts';
import { writeEdgeFiles } from './hosts/cloudflare.ts';
import { solidHydrationHash } from './islands.ts';
import type { Manifest } from './manifest.ts';
import type { KitOptions } from './options.ts';
import { preflight } from './preflight.ts';
import { loadRedirects } from './redirects.ts';
import { FindingError, formatFindings, Report } from './registry.ts';
import { virtualModulePlugin } from './virtual.ts';

export type { KitOptions } from './options.ts';
export { RULES } from './registry.ts';

const KIT_VERSION = (
  JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }
).version;

/** Values the kit locks; config:done fails when anything changed them. */
const LOCKED = {
  output: 'static',
  trailingSlash: 'always',
  compressHTML: true,
  buildFormat: 'directory',
  inlineStylesheets: 'always',
} as const;

/** Non-false defaults of Astro's experimental block; anything else that is truthy was switched on. */
const EXPERIMENTAL_DEFAULTS: Record<string, unknown> = { collectionStorage: 'single-file' };

const CSS_TARGET = ['chrome123', 'edge123', 'firefox120', 'safari17.5'];

function fail(report: Report): never {
  throw new FindingError(report.findings);
}

export default function astroKit(): AstroIntegration {
  let root = '';
  let options: KitOptions | undefined;
  let manifest: Manifest | undefined;

  return {
    name: '@raess/astro-kit',
    hooks: {
      'astro:config:setup': async ({ config, updateConfig, addWatchFile, injectScript, command, logger }) => {
        root = fileURLToPath(config.root);
        const report = new Report();
        const checked = preflight(root, report);
        if (!checked) fail(report);
        const { options: kit, site, schedule, messages } = checked;
        options = kit;
        manifest = checked.manifest;
        if (config.adapter) report.add('config-adapter', 'astro.config.mjs', config.adapter.name);
        if (config.i18n) report.add('config-i18n', 'astro.config.mjs');
        for (const [flag, value] of Object.entries(config.experimental ?? {})) {
          if (value && value !== EXPERIMENTAL_DEFAULTS[flag])
            report.add('config-experimental', 'astro.config.mjs', flag);
        }
        // Pre-build findings stop a build. Dev and check print them and keep running, so the page stays visible.
        if (!report.ok) {
          if (command === 'build') fail(report);
          logger.warn(formatFindings(report.findings));
        }

        for (const file of [
          'astro-kit.json',
          'src/content/site.json',
          'src/content/schedule.json',
          'src/content/redirects.json',
        ]) {
          addWatchFile(new URL(file, config.root));
        }

        const scriptHashes: string[] = [];
        const integrations: AstroIntegration[] = [];
        if (kit.features.islands) {
          const solid = (await import('@astrojs/solid-js')).default;
          integrations.push(solid());
          scriptHashes.push(await solidHydrationHash(root));
        }
        let adapter: AstroIntegration | undefined;
        if (kit.features.forms) {
          const cloudflare = (await import('@astrojs/cloudflare')).default;
          adapter = cloudflare({ imageService: 'compile', prerenderEnvironment: 'node' });
        }
        if (kit.prefetch.astroPrefetch) injectScript('page', prefetchGateScript(kit));

        updateConfig({
          site: kit.site,
          output: LOCKED.output,
          trailingSlash: LOCKED.trailingSlash,
          compressHTML: LOCKED.compressHTML,
          build: { format: LOCKED.buildFormat, inlineStylesheets: LOCKED.inlineStylesheets },
          image: {
            layout: 'constrained',
            responsiveStyles: true,
            breakpoints: [640, 960, 1280, 1920],
            domains: [],
            remotePatterns: [],
          },
          security: { checkOrigin: true, csp: cspConfig(kit, scriptHashes) },
          prefetch: kit.prefetch.astroPrefetch ? { prefetchAll: false } : false,
          markdown: { syntaxHighlight: false },
          ...(adapter ? { adapter } : {}),
          // Astro only registers an adapter from the user's config; one added here must also be an integration.
          integrations: adapter ? [...integrations, adapter] : integrations,
          vite: {
            plugins: [
              virtualModulePlugin({ root, options: kit, site, schedule, messages, manifest, kitVersion: KIT_VERSION }),
            ],
            build: { cssTarget: CSS_TARGET },
            ssr: { noExternal: ['@raess/astro-kit'] },
          },
        } as Parameters<typeof updateConfig>[0]);
      },

      'astro:config:done': ({ config }) => {
        const report = new Report();
        const locked: [string, unknown, unknown][] = [
          ['output', config.output, LOCKED.output],
          ['trailingSlash', config.trailingSlash, LOCKED.trailingSlash],
          ['compressHTML', config.compressHTML, LOCKED.compressHTML],
          ['build.format', config.build.format, LOCKED.buildFormat],
          ['build.inlineStylesheets', config.build.inlineStylesheets, LOCKED.inlineStylesheets],
          ['image.layout', config.image.layout, 'constrained'],
        ];
        for (const [key, actual, expected] of locked) {
          if (actual !== expected) report.add('config-locked', key, `${String(actual)} instead of ${String(expected)}`);
        }
        if (config.i18n) report.add('config-i18n', 'astro config');
        if (!config.security.csp || typeof config.security.csp !== 'object')
          report.add('config-locked', 'security.csp', 'CSP disabled');
        if (options && !options.features.forms && config.adapter)
          report.add('config-adapter', 'astro config', config.adapter.name);
        report.throwIfFailed();
      },

      'astro:routes:resolved': ({ routes }) => {
        if (!options) return;
        const report = new Report();
        for (const route of routes) {
          if (route.origin !== 'project' || route.type === 'redirect') continue;
          if (!route.isPrerendered) {
            const declared = options.features.forms && route.pattern.startsWith('/api/');
            if (!declared) report.add('routes-on-demand', route.entrypoint, route.pattern);
          }
        }
        report.throwIfFailed();
      },

      'astro:build:done': async ({ dir }) => {
        if (!options || !manifest) return;
        const report = new Report();
        const ctx = loadBuild({
          root,
          dist: fileURLToPath(dir),
          options,
          manifest,
          report,
          redirects: loadRedirects(root, report),
        });
        writeEdgeFiles(ctx, KIT_VERSION);
        await runAudits(ctx);
        report.throwIfFailed();
      },
    },
  };
}

/**
 * The integration: the four hooks of the kit, in the order of the specification (section 6.1).
 *
 * - `astro:config:setup` runs preflight, checks the shape of the project's config, and sets the locked config.
 * - `astro:config:done` compares the resolved config with the locked values.
 * - `astro:routes:resolved` checks the routes of the project.
 * - `astro:build:done` puts the two inserts into the built pages, writes the edge files and runs the build audits.
 *
 * A site uses it through the shim `astro.config.mjs`: `defineConfig({ integrations: [astroKit()] })`. Every setting
 * of a site is in `astro-kit.json`, so the function takes no argument.
 */
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AstroIntegration } from 'astro';
import { runAudits } from './audit/index.ts';
import { loadBuild } from './build.ts';
import {
  checkConfigShape,
  checkResolvedConfig,
  FORMS_ADAPTER,
  FORMS_ADAPTER_OPTIONS,
  globalCssCode,
  kitScriptHashes,
  lockedConfig,
  rootProblem,
  WATCH_FILES,
} from './config.ts';
import { prefetchGateScript, type Sha256 } from './csp.ts';
import { loadDesign } from './design/parse.ts';
import { loadGlossary, loadSchedule, loadSite } from './facts.ts';
import { writeEdgeFiles } from './hosts/cloudflare.ts';
import { injectBuild, missingMetaMessage } from './inject.ts';
import { ISLANDS_MISSING, solidHydrationHash } from './islands.ts';
import type { Options } from './options.ts';
import { preflight } from './preflight.ts';
import { KIT_PACKAGE } from './project.ts';
import { loadRedirects } from './redirects.ts';
import { FindingError, formatFindings, Report } from './registry.ts';
import { checkResolvedRoutes } from './routes.ts';
import { KIT_VERSION, virtualModulePlugin } from './virtual.ts';

export type { Options } from './options.ts';

// Feature packages

const FORMS_MISSING = `astro-kit: features.forms needs ${FORMS_ADAPTER} installed; see node_modules/@raess/astro-kit/docs/forms.md.`;

/** Says whether an import failed because Node did not find the package. */
function isMissingModule(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ERR_MODULE_NOT_FOUND';
}

/** Step 6: the Solid renderer of an islands site, as an integration. */
async function solidIntegration(): Promise<AstroIntegration> {
  try {
    return (await import('@astrojs/solid-js')).default();
  } catch (cause) {
    if (isMissingModule(cause)) throw new Error(ISLANDS_MISSING, { cause });
    throw cause;
  }
}

/** Step 7: the Cloudflare adapter of a forms site. The two options are fixed (6.1). */
async function formsAdapter(): Promise<AstroIntegration> {
  try {
    return (await import('@astrojs/cloudflare')).default(FORMS_ADAPTER_OPTIONS);
  } catch (cause) {
    if (isMissingModule(cause)) throw new Error(FORMS_MISSING, { cause });
    throw cause;
  }
}

// The integration

/** What `astro:config:setup` keeps for the later hooks. */
interface State {
  /** The project root, an absolute path. */
  root: string;
  options: Options;
  /** The kit's script hashes of the CSP, as `lockedConfig` got them. */
  scriptHashes: Sha256[];
}

/** The integration of the kit. Each call has its own state, so each Astro run starts fresh. */
export default function astroKit(): AstroIntegration {
  let state: State | undefined;

  /** The state of this run. Astro calls `astro:config:setup` first, so a missing state is an error of the caller. */
  const started = (): State => {
    if (state === undefined) throw new Error('astro-kit: astro:config:setup did not run before this hook.');
    return state;
  };

  return {
    name: KIT_PACKAGE,
    hooks: {
      'astro:config:setup': async ({ config, command, updateConfig, injectScript, addWatchFile, logger }) => {
        // 1. Root. A root that loses the global CSS stops every command, before any check.
        const root = fileURLToPath(config.root);
        const problem = rootProblem(root);
        if (problem !== undefined) throw new Error(problem);

        // 2. Preflight: the config-stage rules that read the project files.
        const report = new Report();
        const options = preflight(root, report);

        // 3. Config shape. It runs also without valid settings, so one run reports every finding.
        checkConfigShape(config, report);

        // 4. Findings. Without valid settings the kit cannot go on. Any other finding stops a build; `astro dev`
        // and `astro check` print it and go on, so that the page stays visible.
        if (options === undefined || report.findings.some((finding) => finding.rule === 'config-options')) {
          throw new FindingError(report.findings);
        }
        if (command === 'build') report.throwIfFailed();
        if (report.findings.length > 0) logger.warn(formatFindings(report.findings));

        // 5. Watch files.
        for (const file of WATCH_FILES) addWatchFile(join(root, file));

        // 6. Islands: the Solid renderer, and the hash of its hydration script.
        const integrations: AstroIntegration[] = [];
        let solidHash: Sha256 | undefined;
        if (options.features.islands) {
          integrations.push(await solidIntegration());
          solidHash = await solidHydrationHash(root);
        }
        const scriptHashes = kitScriptHashes(options, solidHash);

        // 7. Forms: the Cloudflare adapter. Astro reads `config.adapter` to accept an on-demand route, and it runs
        // the hooks of an adapter only from `integrations` (13.1, item 7). So the adapter goes into both.
        const adapter = options.features.forms ? await formsAdapter() : undefined;
        if (adapter !== undefined) integrations.push(adapter);

        // 8. Prefetch gate.
        if (options.prefetch.astroPrefetch) injectScript('page', prefetchGateScript(options));

        // 9. Global CSS: one call. Astro and Vite bundle the four files into every page.
        injectScript('page-ssr', globalCssCode(root));

        // 10. Config: the values of the table, in one call.
        const locked = lockedConfig(options, scriptHashes);
        updateConfig({
          ...locked,
          vite: { ...locked.vite, plugins: [virtualModulePlugin({ options, kitVersion: KIT_VERSION })] },
          ...(adapter === undefined ? {} : { adapter }),
          ...(integrations.length === 0 ? {} : { integrations }),
        });

        state = { root, options, scriptHashes };
      },

      'astro:config:done': ({ config }) => {
        const { options, scriptHashes } = started();
        const report = new Report();
        checkResolvedConfig(config, options, scriptHashes, report);
        report.throwIfFailed();
      },

      // Astro calls this hook more than once in a build. Each call checks its own list on a new report.
      'astro:routes:resolved': ({ routes }) => {
        const { root, options } = started();
        const report = new Report();
        checkResolvedRoutes(routes, options, root, report);
        report.throwIfFailed();
      },

      // `dir` is the client directory: `dist/`, or `dist/client/` with the adapter.
      'astro:build:done': async ({ dir, logger }) => {
        const { root, options } = started();
        const dist = fileURLToPath(dir);
        const report = new Report({ waivers: options.waivers });

        // 1. Inserts: the mode script and the speculation block, right after the CSP meta of every page. These
        // are the only edits to built pages. M5: a page without a CSP meta becomes a `csp-meta` finding.
        const injected = injectBuild(dist, options);
        if (injected.missing.length > 0) throw new Error(missingMetaMessage(injected.missing));

        // 2. Load. The facts, the redirects and the design passed preflight when this build started.
        const site = loadSite(root, report);
        const schedule = loadSchedule(root, report);
        const glossary = loadGlossary(root, report);
        const redirects = loadRedirects(root, report);
        const design = loadDesign(root, report);
        if (
          site === undefined ||
          schedule === undefined ||
          glossary === undefined ||
          redirects === undefined ||
          design === undefined
        ) {
          throw new FindingError(report.findings);
        }
        const ctx = loadBuild({
          root,
          dist,
          options,
          kitVersion: KIT_VERSION,
          facts: { site, schedule, glossary },
          redirects,
          design,
          report,
          env: process.env,
          now: new Date(),
        });

        // 3. Edge files.
        writeEdgeFiles(ctx);

        // 4. Audits.
        await runAudits(ctx);

        // 5. Result. A finding that fails nothing, such as a waived one, is printed.
        report.throwIfFailed();
        if (report.findings.length > 0) logger.warn(report.format());
      },
    },
  };
}

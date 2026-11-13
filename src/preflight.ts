/**
 * Preflight: every config-stage check on the files of a project, in the fixed order of the specification (6.1,
 * step 2). `astro:config:setup` and `astro-kit check` both run it, so both report the same findings.
 *
 * One run reports every finding. No check stops at the first one, and no check throws for a finding.
 */
import { loadGlossary, loadSchedule, loadSite } from './facts.ts';
import { checkProcessing, checkWaivers, loadOptions, type Options } from './options.ts';
import {
  checkDepAllowlist,
  checkDepSpecs,
  checkImageOriginals,
  checkImports,
  checkOverrides,
  checkPublicImages,
  checkPublicShadow,
  checkServer,
  checkSuppression,
} from './project.ts';
import { loadRedirects } from './redirects.ts';
import type { Report } from './registry.ts';
import { checkShims } from './shims.ts';

/**
 * Runs the config-stage checks and adds each finding to the report. Returns the settings, or `undefined` when
 * `astro-kit.json` is missing or not valid.
 *
 * **The settings rule.** A check that reads the settings runs only with valid settings: `config-waiver`,
 * `legal-processing` and `config-dep-allowlist` at this milestone. Every other check always runs, so a run without
 * valid settings still reports the facts files, the shims, the package, the sources, `public/`, the images and the
 * redirects.
 */
export function preflight(root: string, report: Report): Options | undefined {
  // 1. Options and facts: `config-options`, `config-waiver`, `legal-processing`, `facts-schedule`.
  // `config-options` covers three files: `astro-kit.json`, `site.json` and `glossary.json`.
  const options = loadOptions(root, report);
  loadSite(root, report);
  loadGlossary(root, report);
  if (options !== undefined) {
    checkWaivers(options, report);
    checkProcessing(options, report);
  }
  loadSchedule(root, report);

  // 2. Shims: `config-shim`.
  checkShims(root, report);
  // M9: the rest of `config-shim` runs here, with valid settings only: the rendered protected files, the kit block
  // of `AGENTS.md` and the line of `CLAUDE.md`.

  // 3. Package: `config-overrides`, `config-dep-spec`, `config-dep-allowlist`.
  checkOverrides(root, report);
  checkDepSpecs(root, report);
  if (options !== undefined) checkDepAllowlist(root, options, report);

  // 4. Sources: `config-suppression`, `config-imports`, `config-server`.
  checkSuppression(root, report);
  checkImports(root, report);
  checkServer(root, report);
  // M8: the source halves of `js-script`, `js-prefetch-attr`, `js-directive` and `csp-hash`.

  // 5. `public/`: `config-public-shadow`, `images-public`.
  checkPublicShadow(root, report);
  checkPublicImages(root, report);

  // 6. `images-original`.
  checkImageOriginals(root, report);

  // 7. M3: `config-wrangler` for a static site. M7: `config-wrangler` for a forms site, and `forms-binding`.

  // 8. `routes-redirects`, the source half.
  loadRedirects(root, report);

  // 9. M3: `design-format`, then `modes-themes` and `design-tokens` (the source half). M5: `design-specs` and
  // `design-pairs`. The rules after `design-format` run only when `design-format` passes.

  // 10. M5: the CSS source halves, from `css-sources` to `modes-media`.

  return options;
}

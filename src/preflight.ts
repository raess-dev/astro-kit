/**
 * Preflight: every config-stage check on the files of a project, in the fixed order of the specification (6.1,
 * step 2). `astro:config:setup` and `astro-kit check` both run it, so both report the same findings.
 *
 * One run reports every finding. No check stops at the first one, and no check throws for a finding.
 */
import { loadDesign } from './design/parse.ts';
import { checkTokens } from './design/tokens.ts';
import { loadGlossary, loadSchedule, loadSite } from './facts.ts';
import { checkWrangler } from './hosts/cloudflare.ts';
import { checkModeThemes } from './modes.ts';
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
 * `legal-processing`, `config-dep-allowlist`, the text comparison of `config-wrangler`, `modes-themes` and
 * `design-tokens` at this milestone. Every other check always runs, so a run without valid settings still reports
 * the facts files, the shims, the package, the sources, `public/`, the images, the wrangler files, the redirects
 * and the design document.
 *
 * **The dependency rule.** `modes-themes` runs only when `design-format` passes. `design-tokens` runs only when
 * `modes-themes` passes too, because the rendering of `tokens.css` uses the mode options (7.7).
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

  // 7. `config-wrangler`. The files are checked in every run. The text is compared with valid settings only, and
  // at this milestone for a static site only.
  checkWrangler(root, options, report);
  // M7: the text of `config-wrangler` for a forms site, and `forms-binding`.

  // 8. `routes-redirects`, the source half.
  loadRedirects(root, report);

  // 9. Design: `design-format`, then `modes-themes`, then `design-tokens` (the source half).
  const design = loadDesign(root, report);
  if (design !== undefined && options !== undefined && checkModeThemes(options, design.themes, report)) {
    checkTokens(root, design, options, report);
  }
  // M5: `design-specs` and `design-pairs`, only when `design-format` passes.

  // 10. M5: the CSS source halves, from `css-sources` to `modes-media`.

  return options;
}

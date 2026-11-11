/**
 * The kit's checks on the project files, before Astro builds anything.
 * astro:config:setup and `astro-kit check` both run them, so the fast check fails on the same findings.
 */
import { loadMessages, loadSchedule, loadSite, type Schedule, type SiteFacts } from './facts.ts';
import { buildManifest, type Manifest } from './manifest.ts';
import { effectiveLimits, type KitOptions, loadOptions } from './options.ts';
import { checkAssets, checkPackage, checkPublic, checkShims, checkSources, checkWrangler } from './project.ts';
import { loadRedirects } from './redirects.ts';
import { Report } from './registry.ts';

export interface Preflight {
  report: Report;
  options: KitOptions;
  site: SiteFacts | undefined;
  schedule: Schedule;
  messages: Record<string, Record<string, string>>;
  manifest: Manifest;
}

/** Runs every project check. Returns undefined, with the findings in `report`, when astro-kit.json is invalid. */
export function preflight(root: string, report = new Report(), env = process.env): Preflight | undefined {
  const options = loadOptions(root, report);
  if (!options) return undefined;
  checkShims(root, report);
  checkPackage(root, options, report);
  checkSources(root, options, report);
  checkAssets(root, report, effectiveLimits(options));
  checkWrangler(root, options, report);
  loadRedirects(root, report);
  const site = loadSite(root, report);
  const manifest = buildManifest(root, options, report, env);
  checkPublic(root, report, site?.documents, new Set(Object.keys(manifest.byId)));
  return {
    report,
    options,
    site,
    schedule: loadSchedule(root, report),
    messages: loadMessages(root, options, report),
    manifest,
  };
}

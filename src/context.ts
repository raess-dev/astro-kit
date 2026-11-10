import type { HTMLElement } from 'node-html-parser';
import type { Schedule, SiteFacts } from './facts.ts';
import type { Manifest, PageRecord } from './manifest.ts';
import type { effectiveLimits, KitOptions } from './options.ts';
import type { Report } from './registry.ts';

export interface RedirectRow {
  from: string;
  to?: string;
  gone?: boolean;
}

/** One emitted HTML file in dist. */
export interface BuiltPage {
  /** Absolute file path. */
  file: string;
  /** URL path with trailing slash, e.g. /fr/contact/; the 404 page is /404.html. */
  path: string;
  html: string;
  doc: HTMLElement;
  /** The content record that produced it, when it came from pagePaths(). */
  record?: PageRecord;
  /** Locale from the manifest, or from html lang for custom routes. */
  locale: string;
  is404: boolean;
}

export interface BuiltCss {
  /** Where it came from: an inline <style> (page path) or a .css file in dist. */
  where: string;
  text: string;
}

/** Everything a build audit needs. Audits are pure: they read the context and add findings. */
export interface BuildContext {
  root: string;
  dist: string;
  options: KitOptions;
  limits: ReturnType<typeof effectiveLimits>;
  manifest: Manifest;
  site: SiteFacts | undefined;
  schedule: Schedule;
  messages: Record<string, Record<string, string>>;
  pages: BuiltPage[];
  css: BuiltCss[];
  /** Every file path in dist relative to dist, with forward slashes. */
  files: string[];
  redirects: RedirectRow[];
  wrangler: Record<string, unknown> | undefined;
  report: Report;
  env: Record<string, string | undefined>;
}

export type Audit = (ctx: BuildContext) => void | Promise<void>;

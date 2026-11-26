/**
 * Shared inputs of the browser unit tests (14.1): a temp `dist/` written from HTML and CSS strings, served by
 * `serveDist` and opened in Chromium. A test file launches one browser for all its tests (`useBrowser`), and every
 * run of the rules gets that browser. A helper here never asserts.
 */
import { after, before } from 'node:test';
import type { Browser } from 'playwright-core';
import type { BrowserRule } from '../../src/browser/harness.ts';
import { launchBrowser, runBrowser } from '../../src/browser.ts';
import type { Design } from '../../src/context.ts';
import type { Options } from '../../src/options.ts';
import { type Finding, Report } from '../../src/registry.ts';
import { DESIGN } from './css-rules-fixtures.ts';
import { type Files, inTempAsync, optionsOf, SMALLEST } from './fixtures.ts';

/** The settings of the browser tests: one locale `de`, no feature, the one mode option `auto`. */
export const SETTINGS: Options = optionsOf(SMALLEST);

/** The parts of a test page. */
export interface PageParts {
  /** The language of `html`. The default is `de-CH`. */
  lang?: string;
  title?: string;
  /** CSS for one `<style>` in the head. */
  css?: string;
  /** More markup for the head. */
  head?: string;
}

/**
 * A complete page in standards mode: the viewport meta, a title, an optional `<style>`, and `body` as given. It
 * holds no CSP, so a test page may hold any script that its case needs.
 */
export function html(body: string, parts: PageParts = {}): string {
  const style = parts.css === undefined ? '' : `<style>${parts.css}</style>`;
  return [
    '<!doctype html>',
    `<html lang="${parts.lang ?? 'de-CH'}">`,
    '<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${parts.title ?? 'Ein Test der Browserregeln'}</title>${style}${parts.head ?? ''}</head>`,
    `<body>${body}</body>`,
    '</html>',
  ].join('\n');
}

/** The smallest page body that a rule can pass: a skip link and a `main` with an `h1` and a paragraph. */
export const BODY =
  '<a href="#main">Zum Inhalt</a><main id="main"><h1>Willkommen</h1><p>Ein Absatz mit Text.</p></main>';

/** The CSS of a page that meets the visible rules: large targets and a focus ring of 2 px. */
export const CSS =
  'body{margin:0;font:1rem/1.5 system-ui,sans-serif}a,button{display:inline-block;min-inline-size:44px;' +
  'min-block-size:44px}:focus-visible{outline:2px solid #9c4f0b}';

/**
 * Registers a `before` and an `after` hook in the calling test file: one Chromium for all its tests (2.1:
 * `CHROME_PATH`, else the Playwright build, else the system Chrome). The getter gives it inside a test.
 */
export function useBrowser(): () => Browser {
  let browser: Browser | undefined;
  before(async () => {
    browser = await launchBrowser(process.env);
  });
  after(async () => {
    await browser?.close();
  });
  return () => {
    if (browser === undefined) throw new Error('the browser of the test file is not running');
    return browser;
  };
}

/** What a run of the rules on a temp `dist/` gets, besides the files. */
export interface RunParts {
  /** The default is `SETTINGS`. */
  settings?: Options;
  /** The default is the design of the css unit tests. */
  design?: Design;
  /** The component names. The default is none. */
  components?: readonly string[];
  /** `--all`. The default is `true`, so that every page of a test runs. */
  all?: boolean;
  /** The navigation limit of `open()`. The default is the limit of the harness. */
  navigationLimitMs?: number;
}

/**
 * Writes `files` into a temp `dist/` (a path such as `index.html` or `zimmer/index.html`), runs `rules` on it with
 * the shared browser, and gives the findings. The folder is removed at the end.
 */
export function findingsOf(
  browser: Browser,
  files: Files,
  rules: readonly BrowserRule[],
  parts: RunParts = {},
): Promise<Finding[]> {
  const settings = parts.settings ?? SETTINGS;
  const report = new Report({ waivers: settings.waivers });
  return inTempAsync(files, async (dist) => {
    await runBrowser({
      dist,
      options: settings,
      design: parts.design ?? DESIGN,
      components: parts.components ?? [],
      report,
      all: parts.all ?? true,
      rules,
      browser,
      env: process.env,
      ...(parts.navigationLimitMs === undefined ? {} : { navigationLimitMs: parts.navigationLimitMs }),
    });
    return report.findings;
  });
}

/** The sorted, unique ids of the failing findings of a run, as a test of 14.1 asserts them. */
export async function idsOf(
  browser: Browser,
  files: Files,
  rules: readonly BrowserRule[],
  parts: RunParts = {},
): Promise<string[]> {
  const findings = await findingsOf(browser, files, rules, parts);
  return [...new Set(findings.filter((finding) => !finding.waived).map((finding) => finding.rule))].sort();
}

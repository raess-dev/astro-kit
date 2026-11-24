/**
 * `astro-kit test`: the browser checks on the built site (specification, 6.4 and section 8, "a11y (9),
 * contrast (1), perf (6)").
 *
 * The runner serves the client directory with `serveDist`, launches one Chromium for the whole run, and runs each
 * browser rule of `src/browser/rules.ts` in the order of section 8, on the pages of its scope. Each check gets
 * browser contexts of its own, and the runner closes every page and context of a check when it ends, so no check
 * sees what another one left: a stored mode, a cached file, a page in the back/forward cache. A failed launch still
 * closes the server (13.1 item 34).
 *
 * `--outline` prints the accessibility outline of one page, and `--shots` writes a full-page image of each tested
 * page in each viewport.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  type Browser,
  type BrowserContext,
  type BrowserContextOptions,
  chromium,
  errors,
  type Page,
} from 'playwright-core';
import { descendantsOf, domOf, isTemplate, tagOf, tokensOf } from './audit/dom.ts';
import {
  ACTION_LIMIT_MS,
  type BrowserRule,
  CHECK_LIMIT_MS,
  type Check,
  DESKTOP,
  didNotFinish,
  installHelpers,
  NAVIGATION_LIMIT_MS,
  type OpenOptions,
  settle,
  type TestPage,
  type TestRun,
  VIEWPORTS,
} from './browser/harness.ts';
import { BROWSER_RULES } from './browser/rules.ts';
import { listDist, parseHtml } from './build.ts';
import type { Env, ToolIo } from './ci.ts';
import { type BuiltPage, type Design, isHtmlFile, isNotFoundPath, pagePathOf } from './context.ts';
import { loadDesign } from './design/parse.ts';
import { loadOptions, type Options } from './options.ts';
import { type Finding, Report } from './registry.ts';
import { isLocaleHome, localeHome, localeOfPath } from './routes.ts';
import { serveDist } from './serve.ts';

// The browser

/** The system Chrome: the last choice of 2.1. */
export const SYSTEM_CHROME = '/usr/bin/google-chrome';

/**
 * The browser of 2.1: `CHROME_PATH`, else the Chromium that playwright-core installed when that file exists, else
 * the system Chrome. The kit does not test that `CHROME_PATH` or the system Chrome names a file.
 */
export function browserPath(env: Env): string {
  const chosen = env.CHROME_PATH;
  if (chosen !== undefined && chosen !== '') return chosen;
  let installed = '';
  try {
    installed = chromium.executablePath();
  } catch {
    // playwright-core has no Chromium build for this system.
  }
  return installed !== '' && existsSync(installed) ? installed : SYSTEM_CHROME;
}

/**
 * Launches Chromium as the harness says: the back/forward cache on (13.1 item 29) and a 60 s limit. A failed launch
 * throws an error that holds the error of the launch.
 */
export async function launchBrowser(env: Env): Promise<Browser> {
  const executablePath = browserPath(env);
  try {
    return await chromium.launch({
      executablePath,
      ignoreDefaultArgs: ['--disable-back-forward-cache'],
      timeout: 60_000,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`astro-kit test: the browser ${executablePath} did not start: ${message}`);
  }
}

/** A browser context with the page helpers and the time limits of the harness. */
async function contextOf(browser: Browser, options: BrowserContextOptions = {}): Promise<BrowserContext> {
  const context = await browser.newContext({ viewport: DESKTOP, deviceScaleFactor: 1, ...options });
  try {
    context.setDefaultTimeout(ACTION_LIMIT_MS);
    context.setDefaultNavigationTimeout(NAVIGATION_LIMIT_MS);
    await context.addInitScript(installHelpers);
    return context;
  } catch (error) {
    await context.close();
    throw error;
  }
}

// The pages

/** The media tags of the layout key, in their order there (section 8, Pages). */
export const MEDIA_TAGS: readonly string[] = ['picture', 'img', 'video', 'audio', 'table', 'form', 'iframe'];

/** The folder of the component files of a project: `src/styles/components/<kebab>.css`. */
export const COMPONENTS_DIR = 'src/styles/components';

/** The component names of a project: the names of its component files, sorted. A missing folder gives none. */
export function componentNames(root: string): string[] {
  const folder = join(root, COMPONENTS_DIR);
  if (statSync(folder, { throwIfNoEntry: false })?.isDirectory() !== true) return [];
  return readdirSync(folder, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.css') && entry.name.length > 4)
    .map((entry) => entry.name.slice(0, -4))
    .sort();
}

/**
 * The layout key of a page (section 8, Measurement details): the sorted names of the components whose root class
 * is on the page, then the media tags in `main`, in the order of `MEDIA_TAGS`, joined with spaces.
 */
export function layoutKey(page: BuiltPage, components: readonly string[]): string {
  const dom = domOf(page);
  const names = new Set(components);
  const found = new Set<string>();
  for (const element of dom.elements) {
    for (const token of tokensOf(element, 'class')) if (names.has(token)) found.add(token);
  }
  const inMain = new Set(dom.main ? descendantsOf(dom.main, isTemplate).map(tagOf) : []);
  return [...[...found].sort(), ...MEDIA_TAGS.filter((tag) => inMain.has(tag))].join(' ');
}

/** The path that the harness opens for a page: `/404` for the 404 page (section 8, Pages), else the page path. */
export const openPath = (path: string): string => (isNotFoundPath(path) ? '/404' : path);

/** Every built page of a client directory, in path order, with its sample key. */
export function testPages(client: string, options: Options, components: readonly string[]): TestPage[] {
  const pages: TestPage[] = [];
  for (const file of listDist(client).filter(isHtmlFile)) {
    const html = readFileSync(join(client, file), 'utf8');
    const path = pagePathOf(file);
    const is404 = isNotFoundPath(path);
    const built: BuiltPage = {
      file,
      path,
      locale: localeOfPath(path, options),
      is404,
      html,
      root: parseHtml(html),
    };
    const isHome = !is404 && isLocaleHome(path, options);
    pages.push({
      where: path,
      path: openPath(path),
      locale: built.locale,
      is404,
      isHome,
      isDefaultHome: path === localeHome(options.defaultLocale, options),
      key: is404 ? '404' : isHome ? 'home' : layoutKey(built, components),
      dom: domOf(built),
    });
  }
  return pages.sort((a, b) => (a.where < b.where ? -1 : a.where > b.where ? 1 : 0));
}

/** The sample: for each locale and key, the first page in path order (section 8, Pages). */
export function samplePages(pages: readonly TestPage[]): TestPage[] {
  const seen = new Set<string>();
  const sample: TestPage[] = [];
  for (const page of pages) {
    // The kind keeps a layout key that reads `home` or `404` apart from the home and the 404 page.
    const kind = page.is404 ? '404' : page.isHome ? 'home' : 'layout';
    const group = `${page.locale}\n${kind}\n${page.key}`;
    if (seen.has(group)) continue;
    seen.add(group);
    sample.push(page);
  }
  return sample;
}

// The run

/** What one run of the browser checks needs. */
export interface BrowserInput {
  /** The `dist` folder of the project. The server serves its client directory (`clientDir`). */
  dist: string;
  options: Options;
  design: Design | undefined;
  /** The component names of the project (`componentNames`). */
  components: readonly string[];
  /** Gets the findings. Its waivers apply. */
  report: Report;
  /** `--all`: every page, not only the sample. */
  all?: boolean;
  /** `--shots`: the folder for the images, as an absolute path. */
  shots?: string | undefined;
  /** The environment: `CHROME_PATH`. */
  env?: Env;
  /** The rules to run. The default is every browser rule. */
  rules?: readonly BrowserRule[];
  /** A browser that the caller launched and closes itself, such as the one browser of a unit test file. */
  browser?: Browser;
  /** The time limit of one navigation, for a unit test. The default is `NAVIGATION_LIMIT_MS`. */
  navigationLimitMs?: number;
}

/**
 * The pages of a run that did not reach `load` within the navigation limit, by the JavaScript setting and the
 * path, with the detail of the error. A later check that opens such a page throws that error at once (section 8,
 * Errors), so a page that never loads costs one limit, not one for each rule.
 */
interface Loads {
  limitMs: number;
  failed: Map<string, string>;
}

/** Closes a page or a context, and never throws: the browser may have closed it. */
async function quietly(close: () => Promise<void>): Promise<void> {
  try {
    await close();
  } catch {
    // It is closed already.
  }
}

/** Runs one rule on one page. A check that throws, or that takes longer than the limit, did not finish. */
async function runCheck(rule: BrowserRule, page: TestPage, run: TestRun, report: Report, loads: Loads): Promise<void> {
  const contexts: BrowserContext[] = [];
  const shared = new Map<boolean, BrowserContext>();
  const newContext = async (options: BrowserContextOptions = {}): Promise<BrowserContext> => {
    const context = await contextOf(run.browser, options);
    contexts.push(context);
    return context;
  };
  const check: Check = {
    rule: rule.id,
    page,
    run,
    report: (detail) => report.add(rule.id, page.where, detail),
    context: newContext,
    open: async (options: OpenOptions = {}) => {
      const javaScript = options.javaScript !== false;
      let context = options.context ?? shared.get(javaScript);
      if (context === undefined) {
        context = await newContext({ javaScriptEnabled: javaScript });
        shared.set(javaScript, context);
      }
      const path = options.path ?? page.path;
      const key = `${javaScript ? 'on' : 'off'} ${path}`;
      const failed = loads.failed.get(key);
      if (failed !== undefined) throw new Error(failed);
      const tab: Page = await context.newPage();
      await tab.setViewportSize(options.viewport ?? DESKTOP);
      if (options.media) await tab.emulateMedia(options.media);
      let response: Awaited<ReturnType<Page['goto']>>;
      try {
        response = await tab.goto(`${run.origin}${path}`, { waitUntil: 'load', timeout: loads.limitMs });
      } catch (error) {
        if (!(error instanceof errors.TimeoutError)) throw error;
        const detail = `${path} did not load within ${loads.limitMs / 1000} s`;
        loads.failed.set(key, detail);
        throw new Error(detail);
      }
      const status = response?.status() ?? 200;
      if (status < 200 || status > 299) throw new Error(`${path} answered ${status}`);
      await settle(tab);
      return tab;
    },
  };
  let timer: NodeJS.Timeout | undefined;
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`the check took longer than ${CHECK_LIMIT_MS / 1000} s`)),
      CHECK_LIMIT_MS,
    );
  });
  const work = rule.check(check);
  // When the limit wins, the check still runs until its pages close. Its late error has no reader.
  work.catch(() => undefined);
  try {
    await Promise.race([work, limit]);
  } catch (error) {
    report.add(rule.id, page.where, didNotFinish(error));
  } finally {
    clearTimeout(timer);
    for (const context of contexts) await quietly(() => context.close());
  }
}

/** The pages of a rule's scope. */
function pagesOf(rule: BrowserRule, run: TestRun): readonly TestPage[] {
  if (rule.pages === 'sample') return run.sample;
  if (rule.pages === 'home') return run.home ? [run.home] : [];
  return run.pages;
}

/**
 * The file name of a shot: `fr--kontakt-1280x800.png`; the home is `index`, the 404 page `404`. The segments of
 * the path are joined with `--`, which no slug holds (`routes-slug`), so two pages never share a name.
 */
export function shotName(where: string, width: number, height: number): string {
  const slug = where === '/' ? 'index' : isNotFoundPath(where) ? '404' : where.split('/').filter(Boolean).join('--');
  const safe = [...slug].map((char) => (/[a-z0-9-]/.test(char) ? char : '_')).join('');
  return `${safe}-${width}x${height}.png`;
}

/** `--shots`: one full-page image for each tested page and viewport, at device scale 1. */
async function writeShots(run: TestRun, folder: string): Promise<void> {
  mkdirSync(folder, { recursive: true });
  const context = await contextOf(run.browser);
  try {
    for (const page of run.pages) {
      for (const viewport of VIEWPORTS) {
        const tab = await context.newPage();
        try {
          await tab.setViewportSize(viewport);
          await tab.goto(`${run.origin}${page.path}`, { waitUntil: 'load' });
          await settle(tab);
          await tab.screenshot({
            path: join(folder, shotName(page.where, viewport.width, viewport.height)),
            fullPage: true,
          });
        } finally {
          await quietly(() => tab.close());
        }
      }
    }
  } finally {
    await quietly(() => context.close());
  }
}

/**
 * Runs the browser rules on a built site and adds their findings to `input.report`. It serves the client
 * directory, launches the browser (unless the caller gives one), runs each rule on the pages of its scope, and
 * closes the browser and then the server, also when the launch fails.
 */
export async function runBrowser(input: BrowserInput): Promise<void> {
  const served = await serveDist(input.dist);
  try {
    const pages = testPages(served.root, input.options, input.components);
    const sample = samplePages(pages);
    const browser = input.browser ?? (await launchBrowser(input.env ?? {}));
    try {
      const run: TestRun = {
        origin: served.origin,
        options: input.options,
        design: input.design,
        pages: input.all === true ? pages : sample,
        sample,
        home: pages.find((page) => page.isDefaultHome),
        received: served.received,
        browser,
      };
      const loads: Loads = { limitMs: input.navigationLimitMs ?? NAVIGATION_LIMIT_MS, failed: new Map() };
      for (const rule of input.rules ?? BROWSER_RULES) {
        for (const page of pagesOf(rule, run)) await runCheck(rule, page, run, input.report, loads);
      }
      if (input.shots !== undefined) await writeShots(run, input.shots);
    } finally {
      if (input.browser === undefined) await browser.close();
    }
  } finally {
    await served.close();
  }
}

// The command

/** The message for a project with no build (6.4: `test` needs `dist/index.html` or `dist/client/index.html`). */
export const NO_BUILD = 'astro-kit test: dist/index.html is missing; run npx --no astro-kit build first';

/** The message for an `--outline` value that is neither a page path nor an https URL. */
export const BAD_OUTLINE = 'astro-kit test: --outline takes a page path such as /zimmer/ or an https:// URL';

/** Throws `NO_BUILD` when the project has no built page at `dist/index.html` or `dist/client/index.html`. */
function requireBuild(root: string): string {
  const dist = join(root, 'dist');
  const built = ['index.html', 'client/index.html'].some(
    (file) => statSync(join(dist, file), { throwIfNoEntry: false })?.isFile() === true,
  );
  if (!built) throw new Error(NO_BUILD);
  return dist;
}

export interface TestFlags {
  all: boolean;
  /** `--shots <dir>`, as given: relative to the root, or absolute. */
  shots?: string | undefined;
}

/**
 * `astro-kit test`: the browser checks on `dist`. It loads `astro-kit.json` and `docs/design.md`; a finding there
 * ends the command before the browser starts. It gives the findings for the outcome mapping of 6.4.
 */
export async function test(root: string, flags: TestFlags, io: ToolIo): Promise<Finding[]> {
  const dist = requireBuild(root);
  const settings = new Report();
  const options = loadOptions(root, settings);
  if (options === undefined) return settings.findings;
  const report = new Report({ waivers: options.waivers });
  const design = loadDesign(root, report);
  if (design === undefined) return report.findings;
  await runBrowser({
    dist,
    options,
    design,
    components: componentNames(root),
    report,
    all: flags.all,
    shots: flags.shots === undefined ? undefined : resolve(root, flags.shots),
    env: io.env,
  });
  return report.findings;
}

/** The message for an `--outline` target that answers with a status other than 2xx. */
export const outlineAnswered = (target: string, status: number): string =>
  `astro-kit test: --outline ${target} answered ${status}`;

/**
 * `astro-kit test --outline <path|https URL>`: prints the Playwright `ariaSnapshot()` of `body` on stdout and gives
 * 0. A page path opens on the served `dist`; an https URL opens that page, which is the one use of the network of
 * `test`. It runs no check. A target that answers other than 2xx throws, so a mistyped path prints no outline of
 * the 404 page (the 404 page itself opens as `/404`, with 200).
 */
export async function outline(root: string, target: string, io: ToolIo): Promise<number> {
  const external = target.startsWith('https://');
  if (!external && !target.startsWith('/')) throw new Error(BAD_OUTLINE);
  const served = external ? undefined : await serveDist(requireBuild(root));
  try {
    const browser = await launchBrowser(io.env);
    try {
      const context = await contextOf(browser);
      const tab = await context.newPage();
      await tab.setViewportSize(DESKTOP);
      const response = await tab.goto(served ? `${served.origin}${target}` : target, { waitUntil: 'load' });
      const status = response?.status() ?? 200;
      if (status < 200 || status > 299) throw new Error(outlineAnswered(target, status));
      await settle(tab);
      io.out(`${await tab.locator('body').ariaSnapshot()}\n`);
      return 0;
    } finally {
      await browser.close();
    }
  } finally {
    await served?.close();
  }
}

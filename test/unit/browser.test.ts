import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { test } from 'node:test';
import { chromium, type Page } from 'playwright-core';
import {
  type BrowserRule,
  type Check,
  DESKTOP,
  didNotFinish,
  NARROW,
  pixelDistance,
  reveal,
  SWEEP_SAME_PRESSES,
  samePixel,
  settle,
  sweep,
  themeStates,
} from '../../src/browser/harness.ts';
import { BROWSER_RULES, inRegistryOrder } from '../../src/browser/rules.ts';
import {
  BAD_OUTLINE,
  browserPath,
  componentNames,
  launchBrowser,
  layoutKey,
  openPath,
  PAGE_CONCURRENCY,
  runBrowser,
  SYSTEM_CHROME,
  samplePages,
  shotName,
  testPages,
} from '../../src/browser.ts';
import { parseHtml } from '../../src/build.ts';
import { Report, RULES } from '../../src/registry.ts';
import { BODY, CSS, findingsOf, html, SETTINGS, useBrowser } from './browser-fixtures.ts';
import { inTemp, inTempAsync, optionsOf, TWO_LOCALES } from './fixtures.ts';
import { SPEC } from './spec.ts';

const browser = useBrowser();

/** A rule for these tests: the id of a real browser rule, and a check of its own. */
/** A check that measures nothing. */
const nothing = async (): Promise<void> => undefined;

const probe = (check: (check: Check) => Promise<void>, pages: BrowserRule['pages'] = 'tested'): BrowserRule => ({
  id: 'a11y-targets',
  pages,
  check,
});

// The browser

test('the browser of 2.1: CHROME_PATH, else the installed Playwright build, else the system Chrome', () => {
  assert.equal(browserPath({ CHROME_PATH: '/opt/browsers/chrome' }), '/opt/browsers/chrome');
  const installed = chromium.executablePath();
  const fallback = existsSync(installed) ? installed : SYSTEM_CHROME;
  assert.equal(browserPath({}), fallback);
  assert.equal(browserPath({ CHROME_PATH: '' }), fallback);
  assert.equal(SYSTEM_CHROME, '/usr/bin/google-chrome');
  assert.equal(SPEC.includes('else `/usr/bin/google-chrome`'), true);
});

test('a failed launch gives an error that holds the error of the launch', async () => {
  await assert.rejects(launchBrowser({ CHROME_PATH: '/no/such/chrome' }), (error: Error) => {
    assert.match(error.message, /^astro-kit test: the browser \/no\/such\/chrome did not start: /);
    assert.match(error.message, /no\/such\/chrome/);
    return true;
  });
});

test('a failed launch in a run still closes the server: the run rejects and ends', async () => {
  const report = new Report();
  await inTempAsync({ 'index.html': html(BODY) }, async (dist) => {
    await assert.rejects(
      runBrowser({
        dist,
        options: SETTINGS,
        design: undefined,
        components: [],
        report,
        env: { CHROME_PATH: '/no/such/chrome' },
      }),
      /did not start/,
    );
  });
  assert.deepEqual(report.findings, []);
});

// The pages

const SITE = optionsOf(TWO_LOCALES);
const main = (inner: string): string => html(`<a href="#main">Inhalt</a><main id="main">${inner}</main>`);

test('the layout key: the sorted components whose root class is on the page, then the media tags of main', () => {
  const page = (body: string) => ({
    file: 'x/index.html',
    path: '/x/',
    locale: 'de',
    is404: false,
    html: body,
    root: parseHtml(body),
  });
  const components = ['card', 'hero', 'nav'];
  assert.equal(
    layoutKey(
      page(
        html(
          '<nav class="nav"></nav><main><div class="hero card__x"><table></table><img alt=""></div><form></form></main><footer><video></video></footer>',
        ),
      ),
      components,
    ),
    'hero nav img table form',
  );
  assert.equal(layoutKey(page(html('<main><p class="Card">Text</p></main>')), components), 'card');
  assert.equal(layoutKey(page(html('<div class="other">x</div>')), components), '');
  assert.equal(layoutKey(page(html('<main><template><img alt=""></template></main>')), components), '');
});

test('the sample: one page for each locale and key, the first in path order; 404 and the homes have keys of their own', () => {
  const files = {
    'index.html': main('<h1>Home</h1>'),
    '404.html': main('<h1>Nicht gefunden</h1>'),
    'zimmer/index.html': main('<div class="card"><img alt=""></div>'),
    'suiten/index.html': main('<div class="card"><img alt=""></div>'),
    'kontakt/index.html': main('<form></form>'),
    'impressum/index.html': main('<p>Text</p>'),
    'datenschutz/index.html': main('<p>Text</p>'),
    'fr/index.html': main('<h1>Accueil</h1>'),
    'fr/chambres/index.html': main('<div class="card"><img alt=""></div>'),
    'fr/home/index.html': main('<p class="home">Texte</p>'),
  };
  inTemp(files, (dist) => {
    const pages = testPages(dist, SITE, ['card', 'home']);
    assert.deepEqual(
      pages.map((page) => [page.where, page.path, page.locale, page.key]),
      [
        ['/', '/', 'de', 'home'],
        ['/404.html', '/404', 'de', '404'],
        ['/datenschutz/', '/datenschutz/', 'de', ''],
        ['/fr/', '/fr/', 'fr', 'home'],
        ['/fr/chambres/', '/fr/chambres/', 'fr', 'card img'],
        ['/fr/home/', '/fr/home/', 'fr', 'home'],
        ['/impressum/', '/impressum/', 'de', ''],
        ['/kontakt/', '/kontakt/', 'de', 'form'],
        ['/suiten/', '/suiten/', 'de', 'card img'],
        ['/zimmer/', '/zimmer/', 'de', 'card img'],
      ],
    );
    assert.deepEqual(
      pages
        .map((page) => [page.where, page.isHome, page.isDefaultHome, page.is404])
        .filter(([, a, b, c]) => a || b || c),
      [
        ['/', true, true, false],
        ['/404.html', false, false, true],
        ['/fr/', true, false, false],
      ],
    );
    // A layout key that reads `home` is no home.
    assert.deepEqual(
      samplePages(pages).map((page) => page.where),
      ['/', '/404.html', '/datenschutz/', '/fr/', '/fr/chambres/', '/fr/home/', '/kontakt/', '/suiten/'],
    );
  });
});

test('the 404 page opens as /404, every other page at its path', () => {
  assert.equal(openPath('/404.html'), '/404');
  assert.equal(openPath('/'), '/');
  assert.equal(openPath('/fr/404.html'), '/fr/404.html');
  assert.equal(SPEC.includes('The harness opens the 404 page as `/404`'), true);
});

test('the component names are the files of src/styles/components, sorted', () => {
  inTemp(
    {
      'src/styles/components/site-header.css': '',
      'src/styles/components/card.css': '',
      'src/styles/components/notes.txt': '',
      'src/styles/components/.css': '',
      'src/styles/components/nested/x.css': '',
    },
    (root) => assert.deepEqual(componentNames(root), ['card', 'site-header']),
  );
  inTemp({}, (root) => assert.deepEqual(componentNames(root), []));
});

test('a shot is named after the page and the viewport', () => {
  // `_` is in no slug: the home and the 404 page never share a name with `/index/` or `/404/`.
  assert.equal(shotName('/', 1280, 800), '_index-1280x800.png');
  assert.equal(shotName('/index/', 1280, 800), 'index-1280x800.png');
  assert.equal(shotName('/404.html', 390, 844), '_404-390x844.png');
  assert.equal(shotName('/404/', 390, 844), '404-390x844.png');
  // The segments join with `--`, which no slug holds: `fr-kontakt` would also be the name of `/fr-kontakt/`.
  assert.equal(shotName('/fr/kontakt/', 390, 844), 'fr--kontakt-390x844.png');
  assert.equal(shotName('/zimmer-suite/', 1280, 800), 'zimmer-suite-1280x800.png');
  assert.equal(shotName('/zimmer/suite/', 1280, 800), 'zimmer--suite-1280x800.png');
  assert.equal(shotName('/a.html', 390, 844), 'a_html-390x844.png');
  assert.equal(SPEC.includes('The segments of the page path are joined with `--`'), true);
});

// The rules

test('the browser rules are the browser rules of the registry, in its order', () => {
  const registry = RULES.filter((rule) => rule.stage === 'browser').map((rule) => rule.id);
  assert.deepEqual(
    BROWSER_RULES.map((rule) => rule.id),
    registry,
  );
  assert.deepEqual(registry, [
    'modes-behavior',
    'a11y-axe',
    'a11y-focus',
    'a11y-targets',
    'a11y-reflow',
    'a11y-spacing',
    'a11y-forced-colors',
    'a11y-keyboard',
    'a11y-no-js',
    'a11y-reveal',
    'contrast-pairs',
    'perf-lcp-priority',
    'perf-cls',
    'perf-image-oversize',
    'perf-bfcache',
    'perf-prerender',
    'perf-prefetch',
  ]);
  assert.deepEqual(
    inRegistryOrder([probe(nothing), { id: 'a11y-focus', pages: 'tested', check: nothing }]).map((rule) => rule.id),
    ['a11y-focus', 'a11y-targets'],
  );
  assert.throws(() => inRegistryOrder([{ id: 'head-title', pages: 'tested', check: nothing }]), /head-title/);
});

test('the rules of this part give no finding on a page that meets them', async () => {
  const findings = await findingsOf(browser(), { 'index.html': html(BODY, { css: CSS }) }, BROWSER_RULES);
  assert.deepEqual(findings, []);
});

test('a concurrent rule checks up to PAGE_CONCURRENCY pages at once, and its findings come in page order', async () => {
  assert.equal(PAGE_CONCURRENCY, 4);
  const files = Object.fromEntries(
    ['', 'a/', 'b/', 'c/', 'd/', 'e/'].map((path) => [`${path}index.html`, html(BODY)] as const),
  );
  for (const concurrent of [true, false]) {
    let running = 0;
    let most = 0;
    const rule: BrowserRule = {
      ...probe(async (check) => {
        running += 1;
        most = Math.max(most, running);
        // The first page ends last, so the order of the ends is not the page order.
        await new Promise((done) => setTimeout(done, check.page.where === '/' ? 300 : 50));
        check.report(`seen ${check.page.where}`);
        running -= 1;
      }),
      concurrent,
    };
    const findings = await findingsOf(browser(), files, [rule]);
    assert.deepEqual(
      findings.map((finding) => `${finding.where} ${finding.detail}`),
      ['/', '/a/', '/b/', '/c/', '/d/', '/e/'].map((where) => `${where} seen ${where}`),
    );
    assert.equal(most, concurrent ? PAGE_CONCURRENCY : 1);
  }
  // The two rules that read the shared request log of the server check one page at a time. A rule of the home
  // checks one page anyway.
  const alone = BROWSER_RULES.filter((rule) => rule.pages !== 'home' && rule.concurrent !== true).map(
    (rule) => rule.id,
  );
  assert.deepEqual(alone, ['perf-prerender', 'perf-prefetch']);
});

test('the scopes: the tested pages, the sample also with --all, and the default home', async () => {
  const files = {
    'index.html': html(BODY),
    'a/index.html': html(BODY),
    'b/index.html': html(BODY),
    '404.html': html(BODY),
  };
  const seen = new Map<string, string[]>();
  const record = (name: string, pages: BrowserRule['pages']): BrowserRule =>
    probe((check) => {
      seen.set(name, [...(seen.get(name) ?? []), check.page.where]);
      return Promise.resolve();
    }, pages);
  for (const all of [true, false]) {
    seen.clear();
    await findingsOf(
      browser(),
      files,
      [record('tested', 'tested'), record('sample', 'sample'), record('home', 'home')],
      {
        all,
      },
    );
    assert.deepEqual(Object.fromEntries(seen), {
      tested: all ? ['/', '/404.html', '/a/', '/b/'] : ['/', '/404.html', '/a/'],
      sample: ['/', '/404.html', '/a/'],
      home: ['/'],
    });
  }
});

test('a check opens the page at its path, the 404 page at /404 with status 200, and a JS-off page runs no script', async () => {
  const script = '<script>document.documentElement.dataset.ran = "yes"</script>';
  const seen: string[] = [];
  await findingsOf(browser(), { 'index.html': html(BODY + script), '404.html': html(BODY + script) }, [
    probe(async (check) => {
      for (const javaScript of [true, false]) {
        const tab = await check.open({ javaScript, viewport: NARROW });
        const state = await tab.evaluate(() => ({
          ran: document.documentElement.dataset.ran ?? 'no',
          helpers: typeof window.__astroKit.stops,
          width: innerWidth,
        }));
        seen.push(`${new URL(tab.url()).pathname} ${javaScript} ${state.ran} ${state.helpers} ${state.width}`);
      }
    }),
  ]);
  assert.deepEqual(seen, [
    '/ true yes function 390',
    '/ false no function 390',
    '/404 true yes function 390',
    '/404 false no function 390',
  ]);
});

test('a check that throws reports its rule with the first line of the error; one that opens a missing page too', async () => {
  const findings = await findingsOf(browser(), { 'index.html': html(BODY) }, [
    probe(() => Promise.reject(new Error('\nthe box is gone\nmore lines'))),
    probe(async (check) => {
      await check.open({ path: '/nope/' });
    }),
  ]);
  assert.deepEqual(findings, [
    { rule: 'a11y-targets', where: '/', detail: 'the check did not finish: the box is gone' },
    { rule: 'a11y-targets', where: '/', detail: 'the check did not finish: /nope/ answered 404' },
  ]);
  assert.equal(didNotFinish('text'), 'the check did not finish: text');
  assert.equal(
    SPEC.includes('A check that throws reports its rule with `the check did not finish: <first line>`.'),
    true,
  );
});

test('a page that does not load fails the check that opens it; the later checks report it without opening it', async () => {
  // A server that takes each request and never answers: the image of the page keeps `load` from firing.
  const hang = createServer(() => undefined);
  await new Promise<void>((done) => hang.listen(0, '127.0.0.1', done));
  try {
    const { port } = hang.address() as AddressInfo;
    const page = html(BODY.replace('</main>', `<img src="http://127.0.0.1:${port}/x.png" alt="Bild"></main>`));
    const opened: string[] = [];
    const opens = (javaScript: boolean): BrowserRule =>
      probe(async (check) => {
        opened.push(String(javaScript));
        await check.open({ javaScript });
      });
    const report = new Report();
    const start = Date.now();
    await inTempAsync({ 'index.html': page }, (dist) =>
      runBrowser({
        dist,
        options: SETTINGS,
        design: undefined,
        components: [],
        report,
        rules: [opens(true), opens(true), opens(false), opens(true)],
        browser: browser(),
        navigationLimitMs: 1_000,
      }),
    );
    const took = Date.now() - start;
    const detail = 'the check did not finish: / did not load within 1 s';
    assert.deepEqual(
      report.findings.map((finding) => finding.detail),
      [detail, detail, detail, detail],
    );
    assert.deepEqual(opened, ['true', 'true', 'false', 'true']);
    // Two limits: one with JavaScript on and one with it off. The other checks do not wait again.
    assert.ok(took < 2_000 + 3_000, `${took} ms`);
  } finally {
    hang.closeAllConnections();
    await new Promise<void>((done) => hang.close(() => done()));
  }
  assert.equal(SPEC.includes('did not load within 30 s'), true);
});

test('a finding goes to the page path, and a waiver of the settings covers it', async () => {
  const settings = optionsOf({
    ...TWO_LOCALES,
    waivers: [{ rule: 'a11y-targets', where: '/fr/', reason: 'A test of the waiver', until: '2026-12-31' }],
  });
  const findings = await findingsOf(
    browser(),
    { 'index.html': html(BODY), 'fr/index.html': html(BODY), '404.html': html(BODY) },
    [probe(async (check) => check.report('1280×800: a "x" is 10×10'))],
    { settings },
  );
  assert.deepEqual(
    findings.map((finding) => [finding.where, finding.waived !== undefined]),
    [
      ['/', false],
      ['/404.html', false],
      ['/fr/', true],
    ],
  );
});

test('every page of a check closes when it ends, and no check sees the storage of another', async () => {
  const pages: Page[] = [];
  const stored: (string | null)[] = [];
  await findingsOf(browser(), { 'index.html': html(BODY) }, [
    probe(async (check) => {
      const tab = await check.open();
      pages.push(tab);
      stored.push(await tab.evaluate(() => localStorage.getItem('astro-kit:mode')));
      await tab.evaluate(() => localStorage.setItem('astro-kit:mode', 'dark'));
      const own = await check.context({ deviceScaleFactor: 2 });
      const scaled = await check.open({ context: own });
      pages.push(scaled);
      stored.push(String(await scaled.evaluate(() => devicePixelRatio)));
    }),
    probe(async (check) => {
      const tab = await check.open();
      pages.push(tab);
      stored.push(await tab.evaluate(() => localStorage.getItem('astro-kit:mode')));
    }),
  ]);
  assert.deepEqual(stored, [null, '2', null]);
  assert.deepEqual(
    pages.map((tab) => tab.isClosed()),
    [true, true, true],
  );
});

test('the run records every request with its headers', async () => {
  let paths: string[] = [];
  await findingsOf(browser(), { 'index.html': html(BODY) }, [
    probe(async (check) => {
      await check.open({ path: '/?kit=1' });
      paths = check.run.received.map(
        (request) => `${request.method} ${request.path} ${request.headers['user-agent'] ? 'ua' : ''}`,
      );
    }),
  ]);
  assert.equal(paths.includes('GET /?kit=1 ua'), true, paths.join(', '));
});

// The page helpers, the reveal step and the sweep

const REVEAL_PAGE = html(
  [
    '<a href="#main">Zum Inhalt</a>',
    '<main id="main"><h1>Titel</h1>',
    '<details id="outer"><summary>Mehr</summary><details id="inner"><summary>Noch mehr</summary><a href="/x/">Tief</a></details></details>',
    '<details id="far" hidden><summary>Versteckt</summary></details>',
    '<button popovertarget="menu">Menü</button><div id="menu" popover><a href="/y/">Im Menü</a></div>',
    '<button commandfor="tip" command="show-popover">Tipp</button><div id="tip" popover="manual"><button>Im Tipp</button></div>',
    '<button commandfor="book" command="show-modal">Buchen</button>',
    '<dialog id="book"><button>Eins</button><label>Name <input name="n"></label><button disabled>Aus</button></dialog>',
    '<button commandfor="call" command="show-modal" hidden>Versteckt</button><dialog id="call"><button>Nie</button></dialog>',
    '<fieldset><input type="radio" name="r" value="1"><input type="radio" name="r" value="2"><input type="radio" value="3"></fieldset>',
    '<span tabindex="-1">Nein</span><span tabindex="0">Ja</span>',
    '</main>',
  ].join(''),
);

test('the stops: the visible focusable elements, a radio group once, no negative tabindex, nothing disabled or hidden', async () => {
  let stops: string[] = [];
  await findingsOf(browser(), { 'index.html': REVEAL_PAGE }, [
    probe(async (check) => {
      const tab = await check.open();
      stops = await tab.evaluate(() => window.__astroKit.stops().map((element) => window.__astroKit.describe(element)));
    }),
  ]);
  assert.deepEqual(stops, [
    'a "Zum Inhalt"',
    'summary "Mehr"',
    'button "Menü"',
    'button "Tipp"',
    'button "Buchen"',
    'input',
    'input',
    'span',
  ]);
});

test('the stops: a control with a negative tabindex, a roving group once, and a scroller that the browser focuses', async () => {
  const words = 'Wort '.repeat(80);
  const page = html(
    [
      '<a href="#main">Zum Inhalt</a>',
      '<main id="main" tabindex="-1"><h1 tabindex="-1">Titel</h1>',
      '<p><a href="/weg/" tabindex="-1">Versteckt</a> <span role="button" tabindex="-1">Rolle</span></p>',
      '<div role="tablist"><button role="tab" tabindex="0">Eins</button><button role="tab" tabindex="-1">Zwei</button></div>',
      '<div role="toolbar"><button tabindex="-1">Fett</button><button tabindex="-1">Kursiv</button></div>',
      `<div class="sc" id="leer"><p>${words}</p></div>`,
      `<div class="sc" id="voll"><p>${words}<a href="/drin/">Drin</a></p></div>`,
      '<div class="sc" id="kurz"><p>Kurz</p></div>',
      '</main>',
    ].join(''),
    { css: '.sc{overflow-x:auto}.sc p{white-space:nowrap}' },
  );
  let stops: string[] = [];
  let reached: string[] = [];
  await findingsOf(browser(), { 'index.html': page }, [
    probe(async (check) => {
      const tab = await check.open();
      stops = await tab.evaluate(() => window.__astroKit.stops().map((element) => window.__astroKit.describe(element)));
      await sweep(tab);
      reached = await tab.evaluate(() =>
        window.__astroKit.focused.map((element) => window.__astroKit.describe(element)),
      );
    }),
  ]);
  // `main` and the heading with -1 are no controls; the toolbar with no member in the Tab sequence is one stop.
  assert.deepEqual(stops, [
    'a "Zum Inhalt"',
    'a "Versteckt"',
    'span',
    'button "Eins"',
    'button "Fett"',
    'div#leer',
    'a "Drin"',
  ]);
  // Chromium focuses the scroller that holds no stop, and Tab never reaches the controls with -1.
  assert.deepEqual(reached.slice(0, 4), ['a "Zum Inhalt"', 'button "Eins"', 'div#leer', 'a "Drin"']);
  assert.equal(
    SPEC.includes('A native control or an element with a control role that has a negative `tabindex`'),
    true,
  );
});

test('the reveal step opens details and popovers, then each dialog by itself, with the stops of that state', async () => {
  const states: string[] = [];
  await findingsOf(browser(), { 'index.html': REVEAL_PAGE }, [
    probe(async (check) => {
      const tab = await check.open({ viewport: DESKTOP });
      await reveal(tab, async (state) => {
        const seen = await tab.evaluate(() => ({
          open: [...document.querySelectorAll('details[open], :popover-open, dialog[open]')].map((e) => e.id),
          root: window.__astroKit.root().localName,
          stops: window.__astroKit.stops().map((element) => window.__astroKit.describe(element)),
          width: innerWidth,
        }));
        states.push(
          `${state.kind} | ${state.label} | ${seen.open.join(' ')} | ${seen.root} | ${seen.stops.join(', ')} | ${seen.width}`,
        );
        // A visit may change the viewport. The step sets 390×844 again before the next dialog.
        await tab.setViewportSize({ width: 320, height: 640 });
      });
      states.push(
        await tab.evaluate(
          () => `after: ${window.__astroKit.scope === null} ${document.querySelectorAll('dialog[open]').length}`,
        ),
      );
    }),
  ]);
  assert.deepEqual(states, [
    'page | 390×844 after the reveal step | outer inner menu tip | body | a "Zum Inhalt", summary "Mehr", summary "Noch mehr", a "Tief", button "Menü", a "Im Menü", button "Tipp", button "Im Tipp", button "Buchen", input, input, span | 390',
    // A modal dialog closes the open popovers of the `auto` state; a `manual` one stays.
    'dialog | 390×844 with dialog#book open | outer inner tip book | dialog | button "Eins", input | 390',
    'after: true 0',
  ]);
});

test('the reveal step takes its dialogs once: an invoker in a popover that the first dialog closes loses no dialog', async () => {
  const page = html(
    [
      '<a href="#main">Zum Inhalt</a><main id="main"><h1>Titel</h1>',
      '<button popovertarget="nav">Menü</button>',
      '<div id="nav" popover><button commandfor="book" command="show-modal">Buchen</button></div>',
      '<button commandfor="call" command="show-modal">Anrufen</button>',
      '<button commandfor="mail" command="show-modal">Schreiben</button>',
      '<dialog id="book"><button>A</button></dialog><dialog id="call"><button>B</button></dialog>',
      '<dialog id="mail"><button>C</button></dialog></main>',
    ].join(''),
  );
  const states: string[] = [];
  await findingsOf(browser(), { 'index.html': page }, [
    probe(async (check) => {
      const tab = await check.open();
      await reveal(tab, async (state) => {
        const open = await tab.evaluate(() =>
          [...document.querySelectorAll('dialog[open], :popover-open')].map((element) => element.id).join(' '),
        );
        states.push(`${state.label} | ${open}`);
      });
    }),
  ]);
  assert.deepEqual(states, [
    '390×844 after the reveal step | nav',
    // A modal dialog closes the `auto` popover that holds the invoker of `book`, and the list stays as it was.
    '390×844 with dialog#book open | book',
    '390×844 with dialog#call open | call',
    '390×844 with dialog#mail open | mail',
  ]);
});

test('a sweep presses Tab stops + 5 times from the start of the root, and records each focused element in it', async () => {
  const sweeps: string[] = [];
  await findingsOf(browser(), { 'index.html': REVEAL_PAGE }, [
    probe(async (check) => {
      const tab = await check.open();
      const presses: number[] = [];
      const first = await sweep(tab, (press) => {
        presses.push(press);
        return Promise.resolve();
      });
      const focused = await tab.evaluate(() => window.__astroKit.focused.map((e) => window.__astroKit.describe(e)));
      sweeps.push(`${first.stops} ${first.presses} ${presses.length} | ${focused.join(', ')}`);
      // The same page again: the second sweep starts at the start too.
      const again = await sweep(tab);
      const second = await tab.evaluate(() => window.__astroKit.focused.map((e) => window.__astroKit.describe(e)));
      sweeps.push(`${again.stops} ${second.slice(0, 2).join(', ')}`);
      await reveal(tab, async (state) => {
        if (state.kind !== 'dialog') return;
        const inDialog = await sweep(tab);
        const list = await tab.evaluate(() => window.__astroKit.focused.map((e) => window.__astroKit.describe(e)));
        sweeps.push(`${inDialog.stops} ${inDialog.presses} | ${list.join(', ')}`);
      });
      sweeps.push(await tab.evaluate(() => String(document.body.hasAttribute('tabindex'))));
    }),
  ]);
  const page = 'a "Zum Inhalt", summary "Mehr", button "Menü", button "Tipp", button "Buchen", input, input, span';
  assert.equal(sweeps[0]?.startsWith(`8 13 13 | ${page}`), true, sweeps[0]);
  assert.equal(sweeps[1], '8 a "Zum Inhalt", summary "Mehr"');
  // In the dialog, focus stays inside it: the presses after the last stop leave the dialog or start it again.
  assert.equal(sweeps[2]?.startsWith('2 7 | button "Eins", input'), true, sweeps[2]);
  assert.equal(sweeps[3], 'false');
  assert.equal(
    SPEC.includes(
      '- **A sweep** (`a11y-focus`, `a11y-keyboard` and the reveal step) is the Tab sequence of `a11y-keyboard`, through its stops.',
    ),
    true,
  );
});

test('a sweep: a press that keeps the focus on the same element does not count, up to a fixed number', async () => {
  // Chromium gives a date field one press for each of its parts, and an iframe one for each of its links.
  const links = Array.from({ length: 8 }, (_, index) => `<a href="/k${index}/">Ort ${index}</a>`).join(' ');
  const page = html(
    [
      '<a href="#main">Zum Inhalt</a><main id="main"><h1>Titel</h1>',
      '<p><label>Anreise <input type="date" name="a"></label> <label>Abreise <input type="date" name="b"></label></p>',
      '<p><label>Zeit <input type="time" name="t"></label></p>',
      '<iframe title="Karte" src="/karte/"></iframe><p><a href="/ende/">Ende</a></p></main>',
    ].join(''),
  );
  const trap = html(
    '<main><h1>Titel</h1><p><a id="f" href="/a/">Eins</a> <a href="/b/">Zwei</a></p></main>' +
      '<script>document.getElementById("f").addEventListener("keydown", (event) => event.preventDefault())</script>',
  );
  const seen: string[] = [];
  await findingsOf(browser(), { 'index.html': page, 'karte/index.html': html(links), 'trap/index.html': trap }, [
    probe(async (check) => {
      if (check.page.where === '/karte/') return;
      const tab = await check.open();
      const result = await sweep(tab);
      const focused = await tab.evaluate(() => window.__astroKit.focused.map((e) => window.__astroKit.describe(e)));
      seen.push(
        `${check.page.where} ${result.stops} ${result.presses} ${focused.includes('a "Ende"')} ${result.pressed}`,
      );
    }),
  ]);
  // The page: 6 stops, 11 presses that count, and the presses inside the fields and the iframe on top.
  const [home, trapped] = seen;
  assert.match(home ?? '', /^\/ 6 11 true \d+$/);
  assert.ok(Number(home?.split(' ')[4]) > 11 + 8, home);
  // A trap keeps the focus on its link: the free presses end at the cap, and then the presses count again.
  assert.equal(trapped, `/trap/ 2 7 false ${2 + 5 + SWEEP_SAME_PRESSES}`);
});

test('settle pauses an animation that never ends at time 0 at once, so each run measures the same frame', async () => {
  const page = html('<main><h1>Titel</h1><p><button class="grow">Los</button></p></main>', {
    css: '@keyframes grow{from{inline-size:30px}to{inline-size:60px}}.grow{animation:grow 1s linear infinite alternate}',
  });
  const widths: string[] = [];
  let took = 0;
  await findingsOf(browser(), { 'index.html': page }, [
    probe(async (check) => {
      for (let run = 0; run < 3; run += 1) {
        // `open` waits with `settle`: without the pause it would wait 2 s and then read a width of that moment.
        const start = Date.now();
        const tab = await check.open();
        took = Math.max(took, Date.now() - start);
        await tab.waitForTimeout(100);
        await settle(tab);
        widths.push(await tab.evaluate(() => String(document.querySelector('.grow')?.getBoundingClientRect().width)));
      }
    }),
  ]);
  assert.deepEqual(widths, ['30', '30', '30']);
  assert.ok(took < 1_500, `${took} ms`);
});

test('the line boxes of a wrapped link: one box for each line on screen', async () => {
  let boxes = 0;
  await findingsOf(
    browser(),
    {
      'index.html': html(
        '<main><p style="inline-size:8rem">Ein Satz mit <a id="l" href="/x/">einem langen Link über zwei Zeilen</a>.</p></main>',
      ),
    },
    [
      probe(async (check) => {
        const tab = await check.open();
        boxes = await tab.evaluate(() => window.__astroKit.boxes(document.getElementById('l') as Element).length);
      }),
    ],
  );
  assert.ok(boxes >= 2, `${boxes} boxes`);
});

// Themes and colors

test('the Themes walk reaches each declared theme once, a fixed option before the system setting', () => {
  const all = ['light', 'dark', 'light-contrast', 'dark-contrast'] as const;
  const light = { scheme: 'light', contrast: 'no-preference' } as const;
  const dark = { scheme: 'dark', contrast: 'no-preference' } as const;
  const modes = (value: Record<string, unknown>) => optionsOf({ ...TWO_LOCALES, modes: value });
  assert.deepEqual(themeStates(modes({ auto: true, light: true, dark: true, contrast: true }), all), [
    { theme: 'light', mode: 'light', system: light },
    { theme: 'dark', mode: 'dark', system: light },
    { theme: 'light-contrast', mode: 'contrast', system: light },
    { theme: 'dark-contrast', mode: 'contrast', system: dark },
  ]);
  assert.deepEqual(themeStates(modes({ auto: true }), all), [
    { theme: 'light', mode: undefined, system: light },
    { theme: 'dark', mode: undefined, system: dark },
    { theme: 'light-contrast', mode: undefined, system: { scheme: 'light', contrast: 'more' } },
    { theme: 'dark-contrast', mode: undefined, system: { scheme: 'dark', contrast: 'more' } },
  ]);
  assert.deepEqual(themeStates(modes({ auto: true, dark: true }), ['light', 'dark']), [
    { theme: 'light', mode: 'auto', system: light },
    { theme: 'dark', mode: 'dark', system: light },
  ]);
  // A theme that no state reaches is left out: `modes-themes` fails such settings.
  assert.deepEqual(themeStates(modes({ auto: false, light: true, default: 'light' }), ['light', 'dark']), [
    { theme: 'light', mode: undefined, system: light },
  ]);
});

test('the Colors probe paints a color on a 1×1 canvas; two colors are equal within 1 of 255 for each channel', async () => {
  let pixels: number[][] = [];
  await findingsOf(browser(), { 'index.html': html(BODY) }, [
    probe(async (check) => {
      const tab = await check.open({ javaScript: false });
      pixels = await tab.evaluate(() =>
        ['#ff0000', 'rgb(0 0 255 / 50%)', 'oklch(0.5 0.1 200)', 'no-color'].map((c) => window.__astroKit.pixel(c)),
      );
    }),
  ]);
  assert.deepEqual(pixels.slice(0, 2), [
    [255, 0, 0, 255],
    [0, 0, 255, 128],
  ]);
  assert.equal(pixels[2]?.length, 4);
  assert.deepEqual(pixels[3], []);
  assert.equal(samePixel([10, 20, 30, 255], [11, 19, 30, 255]), true);
  assert.equal(samePixel([10, 20, 30, 255], [12, 20, 30, 255]), false);
  assert.equal(pixelDistance([], [1, 2, 3, 4]), Number.POSITIVE_INFINITY);
});

// --shots

test('--shots writes one full-page PNG for each tested page and viewport', async () => {
  await inTempAsync({ 'index.html': html(BODY), '404.html': html(BODY), 'fr/index.html': html(BODY) }, async (dist) => {
    const shots = join(dist, 'shots');
    await runBrowser({
      dist,
      options: SITE,
      design: undefined,
      components: [],
      report: new Report(),
      rules: [],
      shots,
      browser: browser(),
    });
    const files = readdirSync(shots).sort();
    assert.deepEqual(files, [
      '_404-1280x800.png',
      '_404-390x844.png',
      '_index-1280x800.png',
      '_index-390x844.png',
      'fr-1280x800.png',
      'fr-390x844.png',
    ]);
    // Device scale 1: the width in the PNG header (bytes 16 to 19, big-endian) is the width of the viewport.
    const widths = files.map((file) => readFileSync(join(shots, file)).readUInt32BE(16));
    assert.deepEqual(widths, [1280, 390, 1280, 390, 1280, 390]);
  });
  assert.equal(BAD_OUTLINE.includes('--outline'), true);
});

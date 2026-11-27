/**
 * The build halves of the script and origin rules of part 8a of M8 (specification, section 8 and 9.4): `js-script`,
 * `js-prefetch-attr`, `js-directive`, `origins-third-party`, `js-budget` and `legal-origins`. Each case builds a
 * `BuildContext` from strings (14.1), runs one rule, and asserts the exact findings of that rule.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  auditJsBudget,
  compressedSize,
  DYNAMIC_IMPORT,
  hasUnmeasuredImport,
  PREFETCH_CHUNK,
  STATIC_IMPORT,
  WORKER_URL,
} from '../../src/audit/budgets.ts';
import {
  auditJsDirective,
  auditJsPrefetchAttr,
  auditJsScript,
  auditOriginsThirdParty,
  PARENS_MAX,
  UNREAD_NEW,
  workerStarts,
} from '../../src/audit/page/scripts.ts';
import { auditLegalOrigins } from '../../src/audit/site.ts';
import type { BuildContext } from '../../src/context.ts';
import { islandScriptTexts, SOLID_HYDRATION_START, solidHydrationText } from '../../src/islands.ts';
import { LIMITS, type Options } from '../../src/options.ts';
import { getRule } from '../../src/registry.ts';
import { contextOf, fileOf, OPTIONS, page, SWITCH_OPTIONS, site } from './audit-fixtures.ts';
import { optionsOf, origin, TWO_LOCALES } from './fixtures.ts';
import { SPEC } from './spec.ts';

/** The kit repository: its `node_modules` holds the `astro` of the devDependencies (3.4). */
const KIT_ROOT = fileURLToPath(new URL('../..', import.meta.url));

type Files = Record<string, string | Uint8Array>;

/** The start of a substitution of a template literal, for JS texts that hold one. */
const SUBSTITUTION = '$' + '{';

/** The settings of `TWO_LOCALES` with some features, prefetch settings and origins. */
function settings(
  more: { features?: Partial<Options['features']>; astroPrefetch?: boolean; origins?: readonly unknown[] } = {},
): Options {
  return optionsOf({
    ...TWO_LOCALES,
    features: { ...more.features },
    prefetch: { speculationRules: true, astroPrefetch: more.astroPrefetch ?? false },
    origins: more.origins ?? [],
  });
}

/** The site of the fixtures with one more element at the end of `main` of the German home. */
function withMain(options: Options, markup: string, head = ''): Files {
  return {
    ...site(options),
    'index.html': page(options, '/', { alternates: { de: '/', fr: '/fr/' }, main: `<h1>Start</h1> ${markup}`, head }),
  };
}

/** Runs one rule on a context and gives its findings as `<where> <detail>`, sorted. */
function findingsOf(rule: (ctx: BuildContext) => void, ctx: BuildContext, id: string): string[] {
  rule(ctx);
  return ctx.report.findings
    .filter((finding) => finding.rule === id)
    .map((finding) => `${finding.where} ${finding.detail ?? ''}`.trimEnd())
    .sort();
}

/** The ids that one rule gives on a context: `[id]` or `[]`. */
function idsOf(rule: (ctx: BuildContext) => void, ctx: BuildContext): string[] {
  rule(ctx);
  return [...ctx.report.ids()].sort();
}

// js-script

const SCRIPTS = settings({ features: { scripts: true } });
const ISLANDS = settings({ features: { islands: true } });
const PREFETCH = settings({ astroPrefetch: true });
const PAY_PAGE = settings({ origins: [origin('js.pay.example', ['script'], { load: 'page' })] });
const PAY_GESTURE = settings({
  features: { scripts: true },
  origins: [origin('js.pay.example', ['script'], { load: 'gesture' })],
});

/** The texts of Astro's island scripts, from the `astro` of the kit's devDependencies. */
const ISLAND_TEXTS = [...islandScriptTexts(KIT_ROOT)];
const [ANY_ISLAND_TEXT = ''] = ISLAND_TEXTS;
/** The text of Solid's hydration script, from the `solid-js` of the kit's devDependencies. */
const SOLID_TEXT = solidHydrationText(KIT_ROOT) ?? '';

test('islandScriptTexts reads the island runtime and the five client directives of the installed astro', () => {
  // The runtime and five directives: six texts that differ.
  assert.equal(ISLAND_TEXTS.length, 6);
  assert.ok(
    ISLAND_TEXTS.some((text) => text.includes('customElements.define')),
    'the island runtime',
  );
  assert.ok(
    ISLAND_TEXTS.some((text) => text.includes('astro:visible')),
    'the directive visible',
  );
  for (const directive of ['idle', 'load', 'media', 'only', 'visible']) {
    assert.ok(
      ISLAND_TEXTS.some((text) => text.includes(`astro:${directive}`)),
      `the directive ${directive}`,
    );
  }
  // A folder without astro gives none, and the call does not throw.
  assert.deepEqual([...islandScriptTexts('/nowhere')], []);
  assert.equal(SOLID_HYDRATION_START.test('window._$HY||(e=>{})'), true);
  assert.equal(SOLID_HYDRATION_START.test(' window._$HY||'), false);
});

test('js-script passes JSON-LD, the speculation block and the mode script, and fails any other inline script', () => {
  const cases: readonly [name: string, options: Options, markup: string, ids: string[]][] = [
    ['the page of the fixtures: JSON-LD and the speculation block', OPTIONS, '', []],
    ['the mode script of three mode options', SWITCH_OPTIONS, '', []],
    ['a classic inline script', OPTIONS, '<script>alert(1)</script>', ['js-script']],
    [
      'a classic inline script with type text/javascript',
      OPTIONS,
      '<script type="text/javascript">x()</script>',
      ['js-script'],
    ],
    ['an inline module script without scripts', OPTIONS, '<script type="module">x()</script>', ['js-script']],
    ['an import map', SCRIPTS, '<script type="importmap">{"imports":{}}</script>', ['js-script']],
    ['a data block', SCRIPTS, '<script type="text/x-template"><p>x</p></script>', ['js-script']],
    ['a script in template content is no part of the page', OPTIONS, '<template><script>x()</script></template>', []],
    ['a second JSON-LD block', OPTIONS, '<script type="application/ld+json">{}</script>', []],
    // A changed speculation block or mode script is the rule of the insert (speculation-block, modes-script).
    ['a changed speculation block', OPTIONS, '<script type="speculationrules">{}</script>', []],
    ['a script that starts like the mode script', OPTIONS, "<script>{\nconst key = 'astro-kit:mode'; x()</script>", []],
  ];
  assert.deepEqual(
    cases.map(([name, options, markup]) => [
      name,
      idsOf(auditJsScript, contextOf(withMain(options, markup), { options })),
    ]),
    cases.map(([name, , , ids]) => [name, ids]),
  );
});

/** The ids of `js-script` on the site of the fixtures with one more element in `main` and some more files. */
const scriptIds = (options: Options, markup: string, files: Files = {}, root?: string): string[] =>
  idsOf(
    auditJsScript,
    contextOf({ ...withMain(options, markup), ...files }, root === undefined ? { options } : { options, root }),
  );

test('js-script allows /_astro/ module scripts and inline modules with scripts, and the prefetch chunk with astroPrefetch', () => {
  const module = '<script type="module" src="/_astro/a.Bc12.js"></script>';
  const bundled: Files = { '_astro/a.Bc12.js': 'x()' };
  const chunk = '<script type="module" src="/_astro/page.Ab1.js"></script>';
  const prefetch: Files = { '_astro/page.Ab1.js': 'x()' };
  const cases: readonly [name: string, options: Options, markup: string, files: Files, ids: string[]][] = [
    ['a bundled module script, no feature', OPTIONS, module, bundled, ['js-script']],
    ['a bundled module script with scripts', SCRIPTS, module, bundled, []],
    ['a bundled module script whose file is not in dist', SCRIPTS, module, {}, ['js-script']],
    // Islands alone and astroPrefetch alone allow no bundled script: scripts means scripts.
    ['a bundled module script with islands only', ISLANDS, module, bundled, ['js-script']],
    ['a bundled module script with astroPrefetch only', PREFETCH, module, bundled, ['js-script']],
    ['the prefetch chunk with astroPrefetch', PREFETCH, chunk, prefetch, []],
    ['the prefetch chunk whose file is not in dist', PREFETCH, chunk, {}, ['js-script']],
    ['the prefetch chunk without astroPrefetch', OPTIONS, chunk, prefetch, ['js-script']],
    ['the prefetch chunk with scripts', SCRIPTS, chunk, prefetch, []],
    [
      'a public file through %2e%2e with scripts: the browser loads /x.js',
      SCRIPTS,
      '<script type="module" src="/_astro/%2e%2e/x.js"></script>',
      { 'x.js': 'x()', '_astro/x.js': 'x()' },
      ['js-script'],
    ],
    [
      'a public file through %2E. with astroPrefetch',
      PREFETCH,
      '<script type="module" src="/_astro/%2E./page.Ab1.js"></script>',
      { 'page.Ab1.js': 'x()', ...prefetch },
      ['js-script'],
    ],
    [
      'an absolute https URL of the site',
      SCRIPTS,
      '<script type="module" src="https://example.ch/_astro/a.js"></script>',
      { '_astro/a.js': 'x()' },
      [],
    ],
    [
      'an http URL of the site',
      SCRIPTS,
      '<script type="module" src="http://example.ch/_astro/a.js"></script>',
      { '_astro/a.js': 'x()' },
      ['js-script'],
    ],
    [
      'a path that leaves /_astro/',
      SCRIPTS,
      '<script type="module" src="/_astro/../a.js"></script>',
      { 'a.js': 'x()' },
      ['js-script'],
    ],
    ['the folder /_astro/ itself', SCRIPTS, '<script type="module" src="/_astro/"></script>', {}, ['js-script']],
    [
      'a file outside /_astro/',
      SCRIPTS,
      '<script type="module" src="/js/a.js"></script>',
      { 'js/a.js': 'x()' },
      ['js-script'],
    ],
    ['a classic script of /_astro/', SCRIPTS, '<script src="/_astro/a.Bc12.js"></script>', bundled, ['js-script']],
    ['an inline module script with scripts', SCRIPTS, '<script type="module">x()</script>', {}, []],
    ['an inline module script with islands only', ISLANDS, '<script type="module">x()</script>', {}, ['js-script']],
    [
      'an inline module script with astroPrefetch only',
      PREFETCH,
      '<script type="module">x()</script>',
      {},
      ['js-script'],
    ],
    ['a classic inline script with scripts', SCRIPTS, '<script>x()</script>', {}, ['js-script']],
  ];
  assert.deepEqual(
    cases.map(([name, options, markup, files]) => [name, scriptIds(options, markup, files)]),
    cases.map(([name, , , , ids]) => [name, ids]),
  );
});

test('js-script with islands allows the exact island texts of the installed astro and the hydration script of Solid', () => {
  const runtime = ISLAND_TEXTS.find((text) => text.includes('customElements.define')) ?? '';
  assert.ok(SOLID_TEXT.length > 0);
  assert.match(SOLID_TEXT, SOLID_HYDRATION_START);
  const cases: readonly [name: string, options: Options, markup: string, root: string, ids: string[]][] = [
    [
      'every island text of astro',
      ISLANDS,
      ISLAND_TEXTS.map((text) => `<script>${text}</script>`).join(''),
      KIT_ROOT,
      [],
    ],
    ['the exact hydration script of Solid', ISLANDS, `<script>${SOLID_TEXT}</script>`, KIT_ROOT, []],
    // The start of Solid's text with other code after it: the text is compared whole.
    [
      'the start of the Solid text with a payload',
      ISLANDS,
      '<script>window._$HY||alert(1)</script>',
      KIT_ROOT,
      ['js-script'],
    ],
    ['the Solid text with one more character', ISLANDS, `<script>${SOLID_TEXT};</script>`, KIT_ROOT, ['js-script']],
    ['the runtime with one more character', ISLANDS, `<script>${runtime};</script>`, KIT_ROOT, ['js-script']],
    ['the runtime as a module script', ISLANDS, `<script type="module">${runtime}</script>`, KIT_ROOT, ['js-script']],
    ['an island text without islands', SCRIPTS, `<script>${ANY_ISLAND_TEXT}</script>`, KIT_ROOT, ['js-script']],
    ['Solid without islands', SCRIPTS, `<script>${SOLID_TEXT}</script>`, KIT_ROOT, ['js-script']],
    [
      'an island text of a project without astro',
      ISLANDS,
      `<script>${ANY_ISLAND_TEXT}</script>`,
      '/site',
      ['js-script'],
    ],
    ['the Solid text of a project without solid-js', ISLANDS, `<script>${SOLID_TEXT}</script>`, '/site', ['js-script']],
  ];
  assert.deepEqual(
    cases.map(([name, options, markup, root]) => [name, scriptIds(options, markup, {}, root)]),
    cases.map(([name, , , , ids]) => [name, ids]),
  );
  // Without the texts of astro and solid-js, the detail says why.
  const ctx = contextOf(withMain(ISLANDS, `<script>${ANY_ISLAND_TEXT}</script>`), { options: ISLANDS });
  const [detail = ''] = findingsOf(auditJsScript, ctx, 'js-script');
  assert.match(
    detail,
    /island scripts of the project's astro and the hydration script of the project's solid-js could not be read/,
  );
});

test('js-script allows a script of an origin with script and load page, with async, defer or type module', () => {
  const cases: readonly [name: string, options: Options, markup: string, ids: string[]][] = [
    ['async', PAY_PAGE, '<script src="https://js.pay.example/v3" async></script>', []],
    ['defer', PAY_PAGE, '<script src="https://js.pay.example/v3" defer></script>', []],
    ['type module', PAY_PAGE, '<script type="module" src="https://js.pay.example/v3.js"></script>', []],
    ['neither: it blocks the parser', PAY_PAGE, '<script src="https://js.pay.example/v3"></script>', ['js-script']],
    [
      'another host that starts with the name',
      PAY_PAGE,
      '<script src="https://js.pay.example.evil.org/v3" async></script>',
      ['js-script'],
    ],
    // The URL is compared as the browser parses it (F17): the host in any case, the root path of the host.
    ['the host in upper case', PAY_PAGE, '<script src="HTTPS://JS.PAY.EXAMPLE/v3" async></script>', []],
    ['the host without a path', PAY_PAGE, '<script src="https://js.pay.example" async></script>', []],
    ['a port', PAY_PAGE, '<script src="https://js.pay.example:8443/v3" async></script>', ['js-script']],
    ['a user', PAY_PAGE, '<script src="https://me@js.pay.example/v3" async></script>', ['js-script']],
    [
      'a user that hides another host',
      PAY_PAGE,
      '<script src="https://js.pay.example@evil.org/v3" async></script>',
      ['js-script'],
    ],
    ['http', PAY_PAGE, '<script src="http://js.pay.example/v3" async></script>', ['js-script']],
    ['protocol-relative', PAY_PAGE, '<script src="//js.pay.example/v3" async></script>', ['js-script']],
    ['a gesture origin', PAY_GESTURE, '<script src="https://js.pay.example/v3" async></script>', ['js-script']],
    ['no origin', SCRIPTS, '<script src="https://js.pay.example/v3" async></script>', ['js-script']],
    ['an inline script on such a site', PAY_PAGE, '<script>x()</script>', ['js-script']],
  ];
  assert.deepEqual(
    cases.map(([name, options, markup]) => [name, scriptIds(options, markup)]),
    cases.map(([name, , , ids]) => [name, ids]),
  );
  // origins-third-party compares the same way: the upper-case URL is the declared host.
  const upper = withMain(PAY_PAGE, '<script src="HTTPS://JS.PAY.EXAMPLE/v3" async></script>');
  assert.deepEqual(idsOf(auditOriginsThirdParty, contextOf(upper, { options: PAY_PAGE })), []);
});

test('js-script reports one finding for each page, which lists its scripts, also on /404.html', () => {
  const options = OPTIONS;
  const files = withMain(options, '<script>a()</script><script src="/x.js"></script>');
  const ctx = contextOf(files, { options });
  assert.deepEqual(findingsOf(auditJsScript, ctx, 'js-script'), ['/ <script>: a(); <script src="/x.js">']);
  assert.equal(getRule('js-script').waivable, false);
});

test('js-script reads a run of comments in linear time, and a comment ends at its first closing mark (Codex, #31)', () => {
  // A lazy block comment could run past its first closing mark, so 30 comments took over 10 s.
  const runs = [
    `new ${'/*x*/ '.repeat(30)}Date()`,
    `new ${'/*x*/'.repeat(40_000)}Date()`,
    `new ${'//a'.repeat(40_000)}\nDate()`,
    `new ${'/*a*//*b*/ //c\n'.repeat(5_000)}Date()`,
    // A failed search must not read a gap again from each candidate inside it (Codex, #31).
    `new ${'//new\n'.repeat(16_000)}Date()`,
    '[//'.repeat(30_000),
    `new ${'/*new*/'.repeat(30_000)}Date()`,
    '[/*["serviceWorker"]*/'.repeat(20_000),
    // Nor read again the name, the parentheses or the members that many candidates reach (Codex, #31).
    `new ${'//new\n'.repeat(16_000)}D${'a'.repeat(16_000)}()`,
    `new ${'//new\n'.repeat(16_000)}a${'.b'.repeat(16_000)}`,
    `serviceWorker ${'//serviceWorker\n'.repeat(16_000)}.${'a'.repeat(16_000)}`,
    // Nor walk again the rest of a member chain that candidates reach at different members (Codex, #31).
    `/*new a.${'//new\na.'.repeat(16_000)}a()*/`,
    // Nor read again a string literal that many `[` reach through one comment (Codex, #31).
    `${'[/*'.repeat(16_000)}*/"${'a'.repeat(16_000)}"]`,
    `${'[/*'.repeat(16_000)}*/'${'a'.repeat(16_000)}']`,
    `${'[/*'.repeat(16_000)}*/\`${'a'.repeat(16_000)}\`]`,
  ];
  // Candidates between the parentheses of one expression do not walk the rest of them again: a `new` with more
  // than PARENS_MAX opening parentheses is a start that the check cannot read (Codex, #31).
  const nested = `new (${'//new\n('.repeat(16_000)}Date${')'.repeat(16_001)}()`;
  const started = performance.now();
  assert.ok(workerStarts(nested).every((name) => name === UNREAD_NEW));
  assert.ok(
    workerStarts(`new ${'//new\n'.repeat(16_000)}${'('.repeat(16_000)}D()`).every((name) => name === UNREAD_NEW),
  );
  for (const text of runs) assert.deepEqual(workerStarts(text), []);
  assert.ok(performance.now() - started < 1_000, 'the runs of comments take less than 1 s together');
  // The comments between the tokens still count as white space, stars included.
  assert.deepEqual(workerStarts('new /* a * b **/ // c\n /***/ Worker("/w.js")'), ['new Worker']);
  assert.deepEqual(workerStarts('new /* x */ Date(); /* Worker */'), []);
  // A `)` that closes an opening parenthesis may stand before the member that names the worker (Codex, #31).
  assert.deepEqual(workerStarts('new (globalThis).Worker("/w.js")'), ['new Worker']);
  assert.deepEqual(workerStarts('new (self)["SharedWorker"](u)'), ['new SharedWorker']);
  assert.deepEqual(workerStarts('new ( (window) /*c*/ ) . Worker(u)'), ['new Worker']);
  assert.deepEqual(workerStarts('new (a.b).c.Worker(u)'), ['new Worker']);
  // A `)` with no opening parenthesis of the `new` ends it, and `new (a)(b).Worker` constructs `a`.
  assert.deepEqual(workerStarts('new a).Worker(u)'), []);
  assert.deepEqual(workerStarts('new (a)(b).Worker'), []);
  assert.deepEqual(workerStarts('new (a)).Worker(u)'), []);
  assert.equal(PARENS_MAX, 64);
  assert.deepEqual(workerStarts(`new ${'('.repeat(64)}Worker(u)`), ['new Worker']);
  assert.deepEqual(workerStarts(`new ${'('.repeat(65)}Date()`), [UNREAD_NEW]);
  // A spread before `new` is no member dot, and a `)` may close a receiver before `register` (Codex, #31).
  assert.deepEqual(workerStarts('const x = {...new Worker("/w.js")}'), ['new Worker']);
  assert.deepEqual(workerStarts('f(...new SharedWorker(u))'), ['new SharedWorker']);
  assert.deepEqual(workerStarts('a.new Worker'), []);
  assert.deepEqual(workerStarts('(navigator.serviceWorker).register("/sw.js")'), ['serviceWorker.register']);
  assert.deepEqual(workerStarts('(navigator["serviceWorker"])?.register("/sw.js")'), ['serviceWorker.register']);
  assert.deepEqual(workerStarts('((navigator.serviceWorker) /*c*/ ).register(u)'), ['serviceWorker.register']);
  assert.deepEqual(workerStarts('(navigator.serviceWorker).ready'), []);
  // A line comment ends at every line terminator of JavaScript, not only at a line feed.
  for (const end of ['\n', '\r', '\r\n', '\u2028', '\u2029']) {
    assert.deepEqual(workerStarts(`new //c${end}Worker("/w.js")`), ['new Worker'], JSON.stringify(end));
  }
});

test('js-script without features.workers fails every start of a worker in a bundled file or an inline script (9.5)', () => {
  const module = '<script type="module" src="/_astro/a.Bc12.js"></script>';
  const off = (text: string, file = '_astro/a.Bc12.js'): string[] =>
    findingsOf(
      auditJsScript,
      contextOf({ ...withMain(SCRIPTS, module), '_astro/a.Bc12.js': 'x()', [file]: text }, { options: SCRIPTS }),
      'js-script',
    );
  const at = (detail: string, where = '/_astro/a.Bc12.js'): string[] => [
    `${where} the script starts a worker (${detail}), but features.workers is off (9.5)`,
  ];
  const cases: readonly [name: string, text: string, findings: string[]][] = [
    // Whatever the argument: a literal, a variable, a blob URL, no argument.
    [
      'the worker form of Rolldown',
      'new Worker(new URL(`/_astro/w.js`,``+import.meta.url),{type:`module`})',
      at('new Worker'),
    ],
    ['a worker of a variable', 'new Worker(url)', at('new Worker')],
    ['a worker of a blob', 'new Worker(URL.createObjectURL(new Blob(["x"])))', at('new Worker')],
    ['a shared worker', 'new SharedWorker("/_astro/s.js")', at('new SharedWorker')],
    ['a service worker', 'navigator.serviceWorker.register("/sw.js")', at('serviceWorker.register')],
    [
      'a service worker of a variable',
      'const n = navigator; n.serviceWorker.register(u)',
      at('serviceWorker.register'),
    ],
    [
      'a service worker, computed and optional',
      'navigator["serviceWorker"]?.["register"](u)',
      at('serviceWorker.register'),
    ],
    ['importScripts', 'importScripts("/_astro/i.js")', at('importScripts')],
    ['importScripts of self, not called', 'const load = self.importScripts', at('importScripts')],
    // The constructor reached through a member, in parentheses, with white space or a comment.
    ['through globalThis', 'new globalThis.Worker(u)', at('new Worker')],
    ['through window, optional', 'new window?.SharedWorker(u)', at('new SharedWorker')],
    ['through self, computed', "new self['Worker'](u)", at('new Worker')],
    ['in parentheses', 'new (window.Worker)(u)', at('new Worker')],
    ['a comment and a line break', 'new /* w */\n Worker(u)', at('new Worker')],
    ['a line comment', 'new // w\nSharedWorker(u)', at('new SharedWorker')],
    [
      'minified, two kinds',
      'a=new Worker(b);c=new SharedWorker(d);e=new Worker(f)',
      at('new Worker, new SharedWorker'),
    ],
    // No start: a member named Worker without new, a longer name, a feature test.
    ['a property named Worker', 'const w = x.Worker; y.SharedWorker = 1', []],
    ['an object key', 'const o = { Worker: 1, SharedWorker: 2 }', []],
    ['a feature test', 'if (typeof Worker === "function" && "serviceWorker" in navigator) x()', []],
    ['a longer name', 'new WorkerPool(); new Workers(); newWorker(); renew.Worker()', []],
    ['serviceWorker without register', 'navigator.serviceWorker.ready.then(x); navigator.serviceWorker.controller', []],
    ['register of another object', 'customElements.register(x); sw.register(u)', []],
    ['a longer name than importScripts', 'importScriptsLater(); myimportScripts()', []],
  ];
  assert.deepEqual(
    cases.map(([name, text]) => [name, off(text)]),
    cases.map(([name, , findings]) => [name, findings]),
  );
  // Every file that the host serves as JavaScript counts, wherever it is and whether a page loads it or not.
  assert.deepEqual(off('new Worker(u)', 'w.js'), at('new Worker', '/w.js'));
  assert.deepEqual(off('new Worker(u)', '_astro/lib/x.MJS'), at('new Worker', '/_astro/lib/x.MJS'));
  assert.deepEqual(off('new Worker(u)', '_astro/x.cjs'), at('new Worker', '/_astro/x.cjs'));
  assert.deepEqual(off('new Worker(u)', '_astro/x.json'), []);
  assert.deepEqual(off('new Worker(u)', 'notes.txt'), []);
});

test('js-script without features.workers fails a worker in an inline script; with it, the rule is unchanged', () => {
  const onPage = (detail: string): string =>
    `/ an inline script starts a worker (${detail}), but features.workers is off (9.5)`;
  const inline = (options: Options, markup: string, files: Files = {}): string[] =>
    findingsOf(auditJsScript, contextOf({ ...withMain(options, markup), ...files }, { options }), 'js-script');
  const WORKERS = settings({ features: { scripts: true, workers: true } });
  assert.deepEqual(inline(SCRIPTS, '<script type="module">new Worker("/_astro/w.js")</script>'), [
    onPage('new Worker'),
  ]);
  // A classic inline script that js-script fails anyway also names the worker.
  assert.deepEqual(inline(SCRIPTS, '<script>navigator.serviceWorker.register("/sw.js")</script>'), [
    '/ <script>: navigator.serviceWorker.register("/sw.js")',
    onPage('serviceWorker.register'),
  ]);
  // Two scripts of one page give one finding.
  assert.deepEqual(
    inline(SCRIPTS, '<script type="module">new Worker(a)</script><script type="module">importScripts(b)</script>'),
    [onPage('new Worker, importScripts')],
  );
  // A data block, JSON-LD and template content run no code.
  assert.deepEqual(
    inline(
      SCRIPTS,
      '<script type="application/ld+json">{"x":"new Worker(a)"}</script><template><script type="module">new Worker(a)</script></template>',
    ),
    [],
  );
  // A new that the check cannot read has a finding of its own, and many starts are no error of the call (Codex, #31).
  assert.deepEqual(inline(SCRIPTS, `<script type="module">new ${'('.repeat(65)}Date()</script>`), [
    '/ an inline script has a new with more than 64 opening parentheses, which the worker check cannot read, and features.workers is off (9.5)',
  ]);
  assert.deepEqual(inline(SCRIPTS, `<script type="module">/*${'importScripts;'.repeat(150_000)}*/</script>`), [
    onPage('importScripts'),
  ]);
  // With features.workers, no worker is a finding of js-script.
  assert.deepEqual(
    inline(
      WORKERS,
      '<script type="module">new Worker("/_astro/w.js")</script><script type="module" src="/_astro/a.js"></script>',
      {
        '_astro/a.js': 'new SharedWorker(u); navigator.serviceWorker.register(u); importScripts(u)',
        'w.js': 'new Worker(u)',
      },
    ),
    [],
  );
});

// js-prefetch-attr

test('js-prefetch-attr fails an element with data-astro-prefetch in any letter case, and not in template content', () => {
  const cases: readonly [name: string, markup: string, ids: string[]][] = [
    ['no attribute', '<p><a href="/fr/">Français</a></p>', []],
    ['a link with it', '<p><a href="/fr/" data-astro-prefetch>Français</a></p>', ['js-prefetch-attr']],
    ['a value', '<p><a href="/fr/" data-astro-prefetch="viewport">Français</a></p>', ['js-prefetch-attr']],
    ['upper case', '<p><a href="/fr/" DATA-ASTRO-PREFETCH>Français</a></p>', ['js-prefetch-attr']],
    ['another element', '<div data-astro-prefetch="false"></div>', ['js-prefetch-attr']],
    ['template content', '<template><a href="/fr/" data-astro-prefetch>x</a></template>', []],
    ['a similar name', '<p data-astro-prefetched>x</p>', []],
  ];
  assert.deepEqual(
    cases.map(([name, markup]) => [name, idsOf(auditJsPrefetchAttr, contextOf(withMain(OPTIONS, markup)))]),
    cases.map(([name, , ids]) => [name, ids]),
  );
});

// js-directive

/** An island as Astro writes it, with its `client` attribute. */
const island = (client: string | undefined): string =>
  `<astro-island uid="Z1" component-url="/_astro/C.js" component-export="default" renderer-url="/_astro/client.js" props="{}" ssr${client === undefined ? '' : ` client="${client}"`} opts="{}"><button type="button">0</button></astro-island>`;

test('js-directive passes visible, idle and media, and fails load, only, another or no directive', () => {
  const cases: readonly [name: string, markup: string, ids: string[]][] = [
    ['visible', island('visible'), []],
    ['idle', island('idle'), []],
    ['media', island('media'), []],
    ['load', island('load'), ['js-directive']],
    ['only', island('only'), ['js-directive']],
    ['a directive of an integration', island('hover'), ['js-directive']],
    ['another letter case: Astro compares it exactly', island('Visible'), ['js-directive']],
    ['no directive', island(undefined), ['js-directive']],
    ['no island', '<p>x</p>', []],
  ];
  assert.deepEqual(
    cases.map(([name, markup]) => [
      name,
      idsOf(auditJsDirective, contextOf(withMain(ISLANDS, markup), { options: ISLANDS })),
    ]),
    cases.map(([name, , ids]) => [name, ids]),
  );
  const ctx = contextOf(withMain(ISLANDS, island('load') + island('only')), { options: ISLANDS });
  assert.equal(findingsOf(auditJsDirective, ctx, 'js-directive').length, 1, 'one finding for the page');
});

// origins-third-party

const MAPS_PAGE = settings({ origins: [origin('maps.example.org', ['frame'], { load: 'page' })] });
const MAPS_GESTURE = settings({
  features: { scripts: true },
  origins: [origin('maps.example.org', ['frame'], { load: 'gesture' })],
});
const NEWS = settings({ origins: [origin('news.example.com', ['form'])] });

test('origins-third-party fails each resource element and attribute that names another origin', () => {
  const cases: readonly [name: string, markup: string, ids: string[], head?: string][] = [
    ['the page of the fixtures', '', []],
    ['img src', '<img src="https://cdn.example.org/a.png" alt="" width="1" height="1">', ['origins-third-party']],
    [
      'img srcset: the second candidate',
      '<img src="/_astro/a.webp" srcset="/_astro/a.webp 1x, https://cdn.example.org/a.png 2x" alt="">',
      ['origins-third-party'],
    ],
    [
      'source srcset',
      '<picture><source srcset="https://cdn.example.org/a.avif" type="image/avif"><img src="/_astro/a.webp" alt=""></picture>',
      ['origins-third-party'],
    ],
    ['video poster', '<video src="/a.mp4" poster="https://cdn.example.org/p.jpg"></video>', ['origins-third-party']],
    ['video src', '<video src="https://cdn.example.org/a.mp4"></video>', ['origins-third-party']],
    ['audio src', '<audio src="https://cdn.example.org/a.mp3"></audio>', ['origins-third-party']],
    [
      'track src',
      '<video src="/a.mp4"><track kind="captions" src="https://cdn.example.org/a.vtt"></video>',
      ['origins-third-party'],
    ],
    ['object data', '<object data="https://cdn.example.org/a.pdf"></object>', ['origins-third-party']],
    ['embed src', '<embed src="https://cdn.example.org/a.swf">', ['origins-third-party']],
    [
      'iframe src without an origin',
      '<iframe src="https://maps.example.org/x" title="Map"></iframe>',
      ['origins-third-party'],
    ],
    ['script src', '<script src="https://cdn.example.org/a.js" async></script>', ['origins-third-party']],
    ['form action', '<form action="https://forms.example.org/x" method="post"></form>', ['origins-third-party']],
    ['a protocol-relative URL', '<img src="//cdn.example.org/a.png" alt="">', ['origins-third-party']],
    ['http on the host of the site', '<img src="http://example.ch/_astro/a.png" alt="">', ['origins-third-party']],
    ['another port of the site', '<img src="https://example.ch:8443/a.png" alt="">', ['origins-third-party']],
    ['another scheme with a host', '<object data="ftp://cdn.example.org/a.pdf"></object>', ['origins-third-party']],
    [
      'an img in a noscript',
      '<noscript><img src="https://stats.example.org/pixel.gif" alt=""></noscript>',
      ['origins-third-party'],
    ],
    ['a same-origin img in a noscript', '<noscript><img src="/_astro/a.png" alt=""></noscript>', []],
    ['template content', '<template><img src="https://cdn.example.org/a.png" alt=""></template>', []],
    ['a link: any https address', '<p><a href="https://www.example.org/">Example</a></p>', []],
    ['a data URL is no origin', '<img src="data:image/gif;base64,R0lGODlh" alt="">', []],
    [
      'a relative and an absolute URL of the site',
      '<img src="a.png" alt=""><img src="https://example.ch/b.png" alt="">',
      [],
    ],
    // The elements and attributes that the row names since the 8a review (F16): each makes a request.
    ['an image input', '<input type="image" src="https://cdn.example.org/a.png" alt="Go">', ['origins-third-party']],
    [
      'an image input in another case',
      '<input type=" IMAGE " src="https://cdn.example.org/a.png" alt="Go">',
      ['origins-third-party'],
    ],
    ['a text input with src loads nothing', '<input type="text" src="https://cdn.example.org/a.png" name="q">', []],
    [
      'a button formaction',
      '<form action="/x/" method="post"><button formaction="https://cdn.example.org/f">Go</button></form>',
      ['origins-third-party'],
    ],
    [
      'an input formaction',
      '<form action="/x/"><input type="submit" formaction="https://cdn.example.org/f"></form>',
      ['origins-third-party'],
    ],
    ['a same-origin formaction', '<form action="/x/"><button formaction="/y/">Go</button></form>', []],
    ['a ping of a link', '<p><a href="/x/" ping="https://track.example.org/p">x</a></p>', ['origins-third-party']],
    [
      'the second URL of a ping',
      '<p><a href="/x/" ping="/p https://track.example.org/q">x</a></p>',
      ['origins-third-party'],
    ],
    [
      'a ping of an area',
      '<map name="m"><area href="/x/" ping="https://track.example.org/p" alt="x"></map>',
      ['origins-third-party'],
    ],
    ['a same-origin ping', '<p><a href="/x/" ping="/p">x</a></p>', []],
    [
      'an SVG image href',
      '<svg aria-hidden="true"><image href="https://cdn.example.org/a.png"/></svg>',
      ['origins-third-party'],
    ],
    [
      'an SVG image xlink:href',
      '<svg aria-hidden="true"><image xlink:href="https://cdn.example.org/a.png"/></svg>',
      ['origins-third-party'],
    ],
    [
      'an SVG use href',
      '<svg aria-hidden="true"><use href="https://cdn.example.org/s.svg#a"/></svg>',
      ['origins-third-party'],
    ],
    ['an SVG use of the page', '<svg aria-hidden="true"><use href="#a"/></svg>', []],
    [
      'an img in the markup of a srcdoc',
      '<iframe title="x" srcdoc="<img src=&quot;https://cdn.example.org/a.png&quot; alt=&quot;&quot;>"></iframe>',
      ['origins-third-party'],
    ],
    [
      'an img in a srcdoc in a srcdoc',
      '<iframe title="x" srcdoc="<iframe title=y srcdoc=&quot;<img src=https://cdn.example.org/a.png>&quot;></iframe>"></iframe>',
      ['origins-third-party'],
    ],
    [
      'a srcdoc in a noscript',
      '<noscript><iframe title="x" srcdoc="<img src=https://cdn.example.org/a.png>"></iframe></noscript>',
      ['origins-third-party'],
    ],
    ['a same-origin srcdoc', '<iframe title="x" srcdoc="<p>Hallo</p><img src=/_astro/a.png alt=>"></iframe>', []],
    // The content of a noscript inside srcdoc markup loads in a frame without scripts (Codex, #26).
    [
      'an img in a noscript in a srcdoc',
      '<iframe title="x" srcdoc="<noscript><img src=https://cdn.example.org/a.png alt=></noscript>"></iframe>',
      ['origins-third-party'],
    ],
    [
      'a srcdoc in a noscript in a srcdoc',
      '<iframe title="x" srcdoc="<noscript><iframe title=y srcdoc=\'<img src=https://cdn.example.org/a.png>\'></iframe></noscript>"></iframe>',
      ['origins-third-party'],
    ],
    [
      'an img in a noscript in a noscript',
      '<noscript><noscript><img src="https://cdn.example.org/a.png" alt=""></noscript></noscript>',
      ['origins-third-party'],
    ],
    [
      'a same-origin noscript in a srcdoc',
      '<iframe title="x" srcdoc="<noscript><img src=/_astro/a.png alt=></noscript>"></iframe>',
      [],
    ],
    // A link may name any address: the rule does not read links (F8).
    ['a link: any http address', '<p><a href="http://www.example.org/">Example</a></p>', []],
    ['link stylesheet', '', ['origins-third-party'], '<link rel="stylesheet" href="https://cdn.example.org/a.css">'],
    ['link preconnect', '', ['origins-third-party'], '<link rel="preconnect" href="https://cdn.example.org">'],
    ['link dns-prefetch', '', ['origins-third-party'], '<link rel="dns-prefetch" href="//cdn.example.org">'],
    [
      'link modulepreload',
      '',
      ['origins-third-party'],
      '<link rel="modulepreload" href="https://cdn.example.org/a.js">',
    ],
    ['link prefetch', '', ['origins-third-party'], '<link rel="prefetch" href="https://cdn.example.org/a.html">'],
    [
      'link preload',
      '',
      ['origins-third-party'],
      '<link rel="preload" as="font" href="https://cdn.example.org/a.woff2">',
    ],
    [
      'link shortcut icon',
      '',
      ['origins-third-party'],
      '<link rel="shortcut icon" href="https://cdn.example.org/a.ico">',
    ],
    [
      'link apple-touch-icon',
      '',
      ['origins-third-party'],
      '<link rel="apple-touch-icon" href="https://cdn.example.org/a.png">',
    ],
    ['link manifest', '', ['origins-third-party'], '<link rel="manifest" href="https://cdn.example.org/m.json">'],
    [
      'link imagesrcset',
      '',
      ['origins-third-party'],
      '<link rel="preload" as="image" href="/_astro/a.webp" imagesrcset="/_astro/a.webp 1x, https://cdn.example.org/a.png 2x">',
    ],
    [
      'link alternate: no resource rel',
      '',
      [],
      '<link rel="alternate" type="application/rss+xml" href="https://feeds.example.org/a.xml">',
    ],
    // 8b: every rel counts but those that never fetch. Chromium 153 sends a prerender request to any host, past the CSP.
    ['link prerender', '', ['origins-third-party'], '<link rel="prerender" href="https://evil.example/p">'],
    ['link prerender in main', '<link rel="prerender" href="https://evil.example/p">', ['origins-third-party']],
    [
      'link compression-dictionary',
      '',
      ['origins-third-party'],
      '<link rel="compression-dictionary" href="https://cdn.example.org/d">',
    ],
    ['link of an unknown rel', '', ['origins-third-party'], '<link rel="x-new-hint" href="https://cdn.example.org/">'],
    ['link search', '', ['origins-third-party'], '<link rel="search" href="https://cdn.example.org/os.xml">'],
    [
      'link alternate stylesheet',
      '',
      ['origins-third-party'],
      '<link rel="alternate stylesheet" href="https://cdn.example.org/b.css">',
    ],
    [
      'links of the rels that never fetch',
      '',
      [],
      [
        'canonical',
        'alternate',
        'author',
        'license',
        'help',
        'next',
        'prev',
        'me',
        'privacy-policy',
        'terms-of-service',
        'expect',
        'Canonical',
      ]
        .map((rel) => `<link rel="${rel}" href="https://other.example.org/${rel}">`)
        .join(''),
    ],
    ['a link with no rel', '', [], '<link href="https://other.example.org/">'],
  ];
  assert.deepEqual(
    cases.map(([name, markup, , head]) => [
      name,
      idsOf(auditOriginsThirdParty, contextOf(withMain(OPTIONS, markup, head))),
    ]),
    cases.map(([name, , ids]) => [name, ids]),
  );
});

test('origins-third-party allows the three exceptions of 9.4, each only on its declared host, directive and load', () => {
  const frame = '<iframe src="https://maps.example.org/embed" title="Map"></iframe>';
  const cases: readonly [name: string, options: Options, markup: string, ids: string[]][] = [
    ['a form on a form host', NEWS, '<form action="https://news.example.com/subscribe" method="post"></form>', []],
    [
      'a form on http of the form host',
      NEWS,
      '<form action="http://news.example.com/subscribe" method="post"></form>',
      ['origins-third-party'],
    ],
    [
      'a form on another port of the form host',
      NEWS,
      '<form action="https://news.example.com:444/x" method="post"></form>',
      ['origins-third-party'],
    ],
    [
      'a form on another host',
      NEWS,
      '<form action="https://evil.example.org/" method="post"></form>',
      ['origins-third-party'],
    ],
    ['an img of the form host', NEWS, '<img src="https://news.example.com/a.png" alt="">', ['origins-third-party']],
    // A submit control's formaction posts like the action of its form: the form host allows it.
    [
      'a formaction on a form host',
      NEWS,
      '<form action="/x/" method="post"><button formaction="https://news.example.com/subscribe">Go</button></form>',
      [],
    ],
    [
      'a formaction on another host',
      NEWS,
      '<form action="/x/" method="post"><button formaction="https://evil.example.org/">Go</button></form>',
      ['origins-third-party'],
    ],
    ['a script on a page script host', PAY_PAGE, '<script src="https://js.pay.example/v3" async></script>', []],
    [
      'a script on a gesture script host',
      PAY_GESTURE,
      '<script src="https://js.pay.example/v3" async></script>',
      ['origins-third-party'],
    ],
    ['a frame with a title on a page frame host', MAPS_PAGE, frame, []],
    [
      'a frame without a title',
      MAPS_PAGE,
      '<iframe src="https://maps.example.org/embed"></iframe>',
      ['origins-third-party'],
    ],
    [
      'a frame with an empty title',
      MAPS_PAGE,
      '<iframe src="https://maps.example.org/embed" title=" "></iframe>',
      ['origins-third-party'],
    ],
    ['a frame on a gesture frame host', MAPS_GESTURE, frame, ['origins-third-party']],
    [
      'a script of a frame host',
      MAPS_PAGE,
      '<script src="https://maps.example.org/a.js" async></script>',
      ['origins-third-party'],
    ],
    [
      'a frame of a script host',
      PAY_PAGE,
      '<iframe src="https://js.pay.example/x" title="Pay"></iframe>',
      ['origins-third-party'],
    ],
  ];
  assert.deepEqual(
    cases.map(([name, options, markup]) => [
      name,
      idsOf(auditOriginsThirdParty, contextOf(withMain(options, markup), { options })),
    ]),
    cases.map(([name, , , ids]) => [name, ids]),
  );
});

test('origins-third-party reports each element, attribute and URL with the origin, and is not waivable', () => {
  const markup =
    '<img src="https://a.example.org/x.png" srcset="https://b.example.org/x.png 2x" alt=""><noscript><img src="https://c.example.org/p.gif"></noscript>';
  const ctx = contextOf(withMain(OPTIONS, markup));
  const tag = '<img src="https://a.example.org/x.png" srcset="https://b.example.org/x.png 2x" alt="">';
  assert.deepEqual(
    findingsOf(auditOriginsThirdParty, ctx, 'origins-third-party'),
    [
      `/ src of <img src="https://c.example.org/p.gif"> in a noscript names https://c.example.org: https://c.example.org/p.gif`,
      `/ src of ${tag} names https://a.example.org: https://a.example.org/x.png`,
      `/ srcset of ${tag} names https://b.example.org: https://b.example.org/x.png`,
    ].sort(),
  );
  assert.equal(getRule('origins-third-party').waivable, false);
});

// js-budget

/**
 * Text that compresses badly: letters, digits, `-` and `_` from xorshift32 with seed 7. About three quarters of its
 * length remain after compression.
 */
function noise(length: number, seed = 7): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let state = seed;
  let text = '';
  for (let index = 0; index < length; index++) {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    text += alphabet[state % alphabet.length];
  }
  return text;
}

/** A JS file whose compressed size is about `bytes`, with an optional first line of code. */
const jsOf = (bytes: number, code = '', seed = 7): string => `${code}\n/*${noise(Math.ceil(bytes / 0.75), seed)}*/\n`;

/** An island with its three URLs. */
const islandWith = (component: string, renderer = '/_astro/client.js', before?: string): string =>
  `<astro-island uid="Z1" component-url="${component}" renderer-url="${renderer}"${before === undefined ? '' : ` before-hydration-url="${before}"`} ssr client="visible" opts="{}"></astro-island>`;

/** A site with an island on the German home, and some JS files. */
function budgetSite(options: Options, markup: string, js: Files): Files {
  return { ...withMain(options, markup), ...js };
}

const budgetIds = (options: Options, markup: string, js: Files): string[] =>
  idsOf(auditJsBudget, contextOf(budgetSite(options, markup, js), { options }));

test('js-budget uses the exact regexes of section 8 for the static and the dynamic imports and the prefetch chunk', () => {
  const row = SPEC.slice(SPEC.indexOf('| `js-budget` | build |'));
  const line = row.slice(0, row.indexOf('\n'));
  // The table of section 8 writes `|` as `\|`; a RegExp source writes `/` as `\/`.
  assert.ok(line.includes(`(\`/${STATIC_IMPORT.source.replaceAll('|', '\\|')}/g\`)`), line);
  // The dynamic regex holds backticks, so the row writes it in a code span of two backticks.
  assert.ok(line.includes(`(\`\`/${DYNAMIC_IMPORT.source.replaceAll('|', '\\|')}/g\`\``), line);
  assert.ok(line.includes(`(\`\`/${WORKER_URL.source.replaceAll('|', '\\|')}/g\`\``), line);
  assert.ok(line.includes(`(\`${PREFETCH_CHUNK.source.replaceAll('\\/', '/')}\`)`), line);
  const statics = (text: string): string[] => [...text.matchAll(STATIC_IMPORT)].map((match) => match[1] ?? '');
  assert.deepEqual(statics('import{a as b}from"./web.js";import "./side.js";export{x}from \'./re.js\''), [
    './web.js',
    './side.js',
    './re.js',
  ]);
  assert.deepEqual(statics('import("./lazy.js");const s="from";'), []);
  // Rolldown, the bundler of Astro 7, writes ``import(`./x.js`)``: a template literal without `${` counts.
  const dynamics = (text: string): string[] =>
    [...text.matchAll(DYNAMIC_IMPORT)].map((match) => match[1] ?? match[2] ?? match[3] ?? '');
  assert.deepEqual(
    dynamics(`import( "./a.js" ),import(\`./b.js\`),import('./c.js'),import(\`./${SUBSTITUTION}d}.js\`),import(u)`),
    ['./a.js', './b.js', './c.js'],
  );
  assert.deepEqual(
    [
      'import(u)',
      `import(\`./${SUBSTITUTION}d}.js\`)`,
      'import ("./a.js")',
      'import("./a.css")',
      'import("./a.js")',
      'x.import(u)',
    ].map(hasUnmeasuredImport),
    [true, true, true, true, false, false],
  );
  assert.equal(PREFETCH_CHUNK.test('/_astro/page.B1c-_2.js'), true);
  assert.equal(PREFETCH_CHUNK.test('/_astro/page.js'), true);
  assert.equal(PREFETCH_CHUNK.test('/_astro/pages.js'), false);
});

test('js-budget: the island JS that loads at once is the static closure of the island URLs, at most islandJsBytes', () => {
  assert.equal(LIMITS.islandJsBytes, 20_480);
  const small = jsOf(2_000);
  const cases: readonly [name: string, markup: string, js: Files, ids: string[]][] = [
    ['no island and no JS', '', {}, []],
    ['a small island', islandWith('/_astro/C.js'), { '_astro/C.js': small, '_astro/client.js': small }, []],
    [
      'a large file that the component imports',
      islandWith('/_astro/C.js'),
      {
        '_astro/C.js': jsOf(500, 'import{a}from"./web.js";'),
        '_astro/client.js': small,
        '_astro/web.js': jsOf(25_000),
      },
      ['js-budget'],
    ],
    [
      'the same file through a deeper import and a cycle',
      islandWith('/_astro/C.js'),
      {
        '_astro/C.js': jsOf(500, 'import"./a.js";'),
        '_astro/a.js': jsOf(500, 'import"./b.js";'),
        '_astro/b.js': jsOf(500, 'import"./a.js";import"./web.js";'),
        '_astro/client.js': small,
        '_astro/web.js': jsOf(25_000),
      },
      ['js-budget'],
    ],
    [
      'a large renderer',
      islandWith('/_astro/C.js'),
      { '_astro/C.js': small, '_astro/client.js': jsOf(25_000) },
      ['js-budget'],
    ],
    [
      'a large before-hydration file',
      islandWith('/_astro/C.js', '/_astro/client.js', '/_astro/before.js'),
      { '_astro/C.js': small, '_astro/client.js': small, '_astro/before.js': jsOf(25_000) },
      ['js-budget'],
    ],
    [
      'two islands that share a file count it once',
      islandWith('/_astro/C.js') + islandWith('/_astro/D.js'),
      {
        '_astro/C.js': 'import"./web.js";',
        '_astro/D.js': 'import"./web.js";',
        '_astro/client.js': small,
        '_astro/web.js': jsOf(15_000),
      },
      [],
    ],
    [
      'many small files that add up',
      islandWith('/_astro/C.js'),
      {
        '_astro/C.js': Array.from({ length: 6 }, (_, index) => `import"./p${index}.js";`).join(''),
        '_astro/client.js': small,
        ...Object.fromEntries(
          Array.from({ length: 6 }, (_, index) => [`_astro/p${index}.js`, jsOf(4_000, '', index + 1)]),
        ),
      },
      ['js-budget'],
    ],
    ['a URL that names no file adds nothing', islandWith('/_astro/missing.js'), { '_astro/client.js': small }, []],
    [
      'a URL with a %2e%2e segment names the file that the browser loads',
      islandWith('/_astro/%2e%2e/p.js'),
      { 'p.js': jsOf(25_000), '_astro/client.js': small },
      ['js-budget'],
    ],
    [
      'an island in template content is no part of the page',
      `<template>${islandWith('/_astro/C.js')}</template>`,
      { '_astro/C.js': jsOf(25_000), '_astro/client.js': small },
      [],
    ],
  ];
  assert.deepEqual(
    cases.map(([name, markup, js]) => [name, budgetIds(ISLANDS, markup, js)]),
    cases.map(([name, , , ids]) => [name, ids]),
  );
});

test('js-budget: the JS that loads later through import() is at most lazyJsBytes, without the at-once files', () => {
  assert.equal(LIMITS.lazyJsBytes, 204_800);
  const small = jsOf(1_000);
  const big = jsOf(210_000);
  const module = (src: string): string => `<script type="module" src="${src}"></script>`;
  const cases: readonly [name: string, options: Options, markup: string, js: Files, ids: string[]][] = [
    [
      'a small lazy file of an island',
      ISLANDS,
      islandWith('/_astro/C.js'),
      { '_astro/C.js': 'const m=()=>import("./lazy.js");', '_astro/client.js': small, '_astro/lazy.js': small },
      [],
    ],
    [
      'a large file behind import() of an island file',
      ISLANDS,
      islandWith('/_astro/C.js'),
      { '_astro/C.js': 'const m=()=>import("./lazy.js");', '_astro/client.js': small, '_astro/lazy.js': big },
      ['js-budget'],
    ],
    [
      'the static closure of a lazy file counts',
      ISLANDS,
      islandWith('/_astro/C.js'),
      {
        '_astro/C.js': 'import("./lazy.js")',
        '_astro/client.js': small,
        '_astro/lazy.js': 'import"./heavy.js";',
        '_astro/heavy.js': big,
      },
      ['js-budget'],
    ],
    [
      'a lazy file that also loads at once is no later file',
      ISLANDS,
      islandWith('/_astro/C.js'),
      {
        '_astro/C.js': 'import"./web.js";import("./web.js");',
        '_astro/client.js': small,
        '_astro/web.js': jsOf(15_000),
      },
      [],
    ],
    [
      'a large file behind import() of a bundled module script',
      SCRIPTS,
      module('/_astro/s.js'),
      { '_astro/s.js': 'document.onclick=()=>import("./big.js");', '_astro/big.js': big },
      ['js-budget'],
    ],
    [
      'a large file behind import() of an inline module script',
      SCRIPTS,
      '<script type="module">import("/_astro/big.js")</script>',
      { '_astro/big.js': big },
      ['js-budget'],
    ],
    // Owner decision of 2026-11-26: every dist .js file that import() names counts, also one outside /_astro/
    // (such as a static endpoint's file). This replaces the case 'import() of a file outside /_astro/ is no later
    // file'.
    [
      'import() of a file outside /_astro/ counts too',
      SCRIPTS,
      '<script type="module">import("/big.js")</script>',
      { 'big.js': big },
      ['js-budget'],
    ],
    [
      'import() with a template literal without ${ counts, as Rolldown writes it',
      SCRIPTS,
      '<script type="module">import(`/_astro/big.js`)</script>',
      { '_astro/big.js': big },
      ['js-budget'],
    ],
    [
      'a backtick import() of an island file counts',
      ISLANDS,
      islandWith('/_astro/C.js'),
      { '_astro/C.js': 'const m=()=>import(`./lazy.js`);', '_astro/client.js': small, '_astro/lazy.js': big },
      ['js-budget'],
    ],
    [
      'import() in a file that a module script imports statically counts',
      SCRIPTS,
      module('/_astro/s.js'),
      { '_astro/s.js': 'import"./b.js";', '_astro/b.js': 'import("./big.js")', '_astro/big.js': big },
      ['js-budget'],
    ],
    [
      'import() in a later file counts, until no file is added',
      ISLANDS,
      islandWith('/_astro/C.js'),
      {
        '_astro/C.js': 'import("./l1.js")',
        '_astro/client.js': small,
        '_astro/l1.js': 'import("./l2.js")',
        '_astro/l2.js': 'import("./l3.js");import("./l1.js")',
        '_astro/l3.js': big,
      },
      ['js-budget'],
    ],
    [
      'a chain of small later files stays in the budget, and a cycle ends',
      ISLANDS,
      islandWith('/_astro/C.js'),
      {
        '_astro/C.js': 'import("./l1.js")',
        '_astro/client.js': small,
        '_astro/l1.js': 'import("./l2.js")',
        '_astro/l2.js': 'import("./l1.js")',
      },
      [],
    ],
  ];
  assert.deepEqual(
    cases.map(([name, options, markup, js]) => [name, budgetIds(options, markup, js)]),
    cases.map(([name, , , , ids]) => [name, ids]),
  );
});

test('js-budget: the static closure of every module script loads at once and joins the island JS', () => {
  const small = jsOf(1_000);
  const module = (src: string): string => `<script type="module" src="${src}"></script>`;
  const cases: readonly [name: string, options: Options, markup: string, js: Files, ids: string[]][] = [
    ['a small bundled script', SCRIPTS, module('/_astro/s.js'), { '_astro/s.js': small }, []],
    ['a large bundled script', SCRIPTS, module('/_astro/s.js'), { '_astro/s.js': jsOf(25_000) }, ['js-budget']],
    [
      'a large file that a bundled script imports',
      SCRIPTS,
      module('/_astro/s.js'),
      { '_astro/s.js': 'import"./b.js";', '_astro/b.js': jsOf(25_000) },
      ['js-budget'],
    ],
    [
      'a large file that an inline module script imports',
      SCRIPTS,
      '<script type="module">import "/_astro/b.js";</script>',
      { '_astro/b.js': jsOf(25_000) },
      ['js-budget'],
    ],
    [
      'an island and a script that each stay small add up',
      ISLANDS,
      `${islandWith('/_astro/C.js')}${module('/_astro/s.js')}`,
      { '_astro/C.js': jsOf(12_000, '', 2), '_astro/client.js': small, '_astro/s.js': jsOf(12_000, '', 3) },
      ['js-budget'],
    ],
    [
      'a file that the island and the script share counts once',
      ISLANDS,
      `${islandWith('/_astro/C.js')}${module('/_astro/s.js')}`,
      {
        '_astro/C.js': 'import"./web.js";',
        '_astro/client.js': small,
        '_astro/s.js': 'import"./web.js";',
        '_astro/web.js': jsOf(15_000),
      },
      [],
    ],
    [
      'a module script of a page origin is in no budget (9.4)',
      settings({ origins: [origin('js.pay.example', ['script'], { load: 'page' })] }),
      module('https://js.pay.example/v3.js'),
      {},
      [],
    ],
  ];
  assert.deepEqual(
    cases.map(([name, options, markup, js]) => [name, budgetIds(options, markup, js)]),
    cases.map(([name, , , , ids]) => [name, ids]),
  );
});

test('js-budget: a preloaded script loads at once, and a worker file loads later (owner decision of 2026-11-26)', () => {
  const small = jsOf(1_000);
  const big = jsOf(210_000);
  const module = (src: string): string => `<script type="module" src="${src}"></script>`;
  const head = (link: string): string => `${link}${module('/_astro/s.js')}`;
  const worker = (call: string): Files => ({ '_astro/s.js': call, '_astro/w.js': big });
  const cases: readonly [name: string, options: Options, markup: string, js: Files, ids: string[]][] = [
    [
      'a large modulepreload',
      SCRIPTS,
      head('<link rel="modulepreload" href="/_astro/p.js">'),
      { '_astro/s.js': small, '_astro/p.js': jsOf(25_000) },
      ['js-budget'],
    ],
    [
      'a modulepreload in another letter case, among other rel tokens',
      SCRIPTS,
      head('<link rel="prefetch MODULEPRELOAD" href="/_astro/p.js">'),
      { '_astro/s.js': small, '_astro/p.js': jsOf(25_000) },
      ['js-budget'],
    ],
    [
      'a large preload as script',
      SCRIPTS,
      head('<link rel="preload" as=" Script " href="/_astro/p.js">'),
      { '_astro/s.js': small, '_astro/p.js': jsOf(25_000) },
      ['js-budget'],
    ],
    [
      'a preload as font is no script',
      SCRIPTS,
      head('<link rel="preload" as="font" href="/_astro/p.js">'),
      { '_astro/s.js': small, '_astro/p.js': jsOf(25_000) },
      [],
    ],
    [
      'a small modulepreload',
      SCRIPTS,
      head('<link rel="modulepreload" href="/_astro/p.js">'),
      { '_astro/s.js': small, '_astro/p.js': small },
      [],
    ],
    // Rolldown writes a worker so: new Worker(new URL(`/_astro/w.js`, ``+import.meta.url), {type: `module`}).
    [
      'the worker form of Rolldown',
      SCRIPTS,
      module('/_astro/s.js'),
      worker('new Worker(new URL(`/_astro/w.js`,``+import.meta.url),{type:`module`})'),
      ['js-budget'],
    ],
    [
      'a SharedWorker',
      SCRIPTS,
      module('/_astro/s.js'),
      worker('new SharedWorker(new URL("./w.js",import.meta.url))'),
      ['js-budget'],
    ],
    ['a worker with a string', SCRIPTS, module('/_astro/s.js'), worker("new Worker('/_astro/w.js')"), ['js-budget']],
    [
      'a worker with white space',
      SCRIPTS,
      module('/_astro/s.js'),
      worker('new Worker ( "/_astro/w.js" )'),
      ['js-budget'],
    ],
    ['importScripts', SCRIPTS, module('/_astro/s.js'), worker('importScripts("/_astro/w.js")'), ['js-budget']],
    [
      'a service worker',
      SCRIPTS,
      module('/_astro/s.js'),
      worker('navigator.serviceWorker.register("/_astro/w.js")'),
      ['js-budget'],
    ],
    [
      'a large file that a worker imports',
      SCRIPTS,
      module('/_astro/s.js'),
      {
        '_astro/s.js': 'new Worker("/_astro/w.js",{type:"module"})',
        '_astro/w.js': 'import"./h.js";',
        '_astro/h.js': big,
      },
      ['js-budget'],
    ],
    [
      'a small worker',
      SCRIPTS,
      module('/_astro/s.js'),
      { '_astro/s.js': 'new Worker(new URL(`/_astro/w.js`,``+import.meta.url))', '_astro/w.js': small },
      [],
    ],
    [
      'a worker of a variable cannot be measured',
      SCRIPTS,
      module('/_astro/s.js'),
      { '_astro/s.js': 'new Worker(url)' },
      ['js-budget'],
    ],
    [
      'a worker of a URL of a variable cannot be measured',
      SCRIPTS,
      module('/_astro/s.js'),
      { '_astro/s.js': 'new Worker(new URL(u,import.meta.url))' },
      ['js-budget'],
    ],
    [
      'a service worker of a variable cannot be measured',
      SCRIPTS,
      module('/_astro/s.js'),
      { '_astro/s.js': 'navigator.serviceWorker.register(u)' },
      ['js-budget'],
    ],
    // The whole argument must be a literal: a suffix or another base changes the URL that loads (Codex, #27).
    [
      'a worker URL that a suffix changes cannot be measured',
      SCRIPTS,
      module('/_astro/s.js'),
      { '_astro/s.js': 'new Worker("/_astro/a.js"+suffix)' },
      ['js-budget'],
    ],
    [
      'a worker URL on another base cannot be measured',
      SCRIPTS,
      module('/_astro/s.js'),
      { '_astro/s.js': 'new Worker(new URL("/_astro/w.js",location.href))', '_astro/w.js': small },
      ['js-budget'],
    ],
    // A bare worker URL resolves against the page, not the script, so it must start with / (Codex, #27).
    [
      'a relative bare worker URL cannot be measured',
      SCRIPTS,
      module('/_astro/s.js'),
      { '_astro/s.js': 'new Worker("./_astro/w.js",{type:"module"})', '_astro/w.js': small },
      ['js-budget'],
    ],
    [
      'a relative service worker URL cannot be measured',
      SCRIPTS,
      module('/_astro/s.js'),
      { '_astro/s.js': 'navigator.serviceWorker.register("sw.js")', '_astro/sw.js': small },
      ['js-budget'],
    ],
    // JavaScript decodes an escape in a string, so the file that loads is not the text: it cannot be measured
    // (Codex, #27).
    [
      'an escape in a worker URL cannot be measured',
      SCRIPTS,
      module('/_astro/s.js'),
      { '_astro/s.js': 'new Worker("/_astro/\\x77.js")', '_astro/w.js': small },
      ['js-budget'],
    ],
    [
      'an escape in an importScripts URL cannot be measured',
      SCRIPTS,
      module('/_astro/s.js'),
      { '_astro/s.js': 'importScripts("/_astro/\\x77.js")', '_astro/w.js': small },
      ['js-budget'],
    ],
    [
      'an escape in import() cannot be measured',
      SCRIPTS,
      module('/_astro/s.js'),
      { '_astro/s.js': 'import("/_astro/\\x77.js")', '_astro/w.js': small },
      ['js-budget'],
    ],
    [
      'an escape in a static import cannot be measured',
      SCRIPTS,
      module('/_astro/s.js'),
      { '_astro/s.js': 'import"./\\x77.js";', '_astro/w.js': small },
      ['js-budget'],
    ],
    [
      'an escape in a static from cannot be measured',
      SCRIPTS,
      module('/_astro/s.js'),
      { '_astro/s.js': "export{a}from'./w\\u002ejs';", '_astro/w.js': small },
      ['js-budget'],
    ],
    [
      'a backslash in a string that is no specifier is no escape here',
      SCRIPTS,
      module('/_astro/s.js'),
      { '_astro/s.js': 'import"./w.js";const p="a\\\\b";', '_astro/w.js': small },
      [],
    ],
    // importScripts resolves against the worker, which the kit does not know, so it must start with / (Codex, #27).
    [
      'a relative importScripts URL cannot be measured',
      SCRIPTS,
      module('/_astro/s.js'),
      { '_astro/s.js': 'importScripts("./big.js")', '_astro/big.js': small },
      ['js-budget'],
    ],
    // importScripts loads each of its arguments, so each one counts (Codex, #27).
    [
      'every file of importScripts counts',
      SCRIPTS,
      module('/_astro/s.js'),
      { '_astro/s.js': 'importScripts("/_astro/a.js","/_astro/w.js")', '_astro/a.js': small, '_astro/w.js': big },
      ['js-budget'],
    ],
    [
      'importScripts with a variable among its arguments cannot be measured',
      SCRIPTS,
      module('/_astro/s.js'),
      { '_astro/s.js': 'importScripts("/_astro/a.js",u)', '_astro/a.js': small },
      ['js-budget'],
    ],
    [
      'a property named Worker is no worker',
      SCRIPTS,
      module('/_astro/s.js'),
      { '_astro/s.js': 'x.Worker(u);new URL(location.href)' },
      [],
    ],
  ];
  assert.deepEqual(
    cases.map(([name, options, markup, js]) => [name, budgetIds(options, markup, js)]),
    cases.map(([name, , , , ids]) => [name, ids]),
  );
  // The finding names the worker as a way of loading later.
  const lines = findingsOf(
    auditJsBudget,
    contextOf(budgetSite(SCRIPTS, module('/_astro/s.js'), worker("new Worker('/_astro/w.js')")), { options: SCRIPTS }),
    'js-budget',
  );
  assert.ok(
    lines.some((line) => line.includes('the JS that loads later through import() or a worker has')),
    lines.join('\n'),
  );
});

test('js-budget: an import() whose argument is no string literal of a .js file cannot be measured, and fails', () => {
  const small = jsOf(500);
  const module = (src: string): string => `<script type="module" src="${src}"></script>`;
  const cases: readonly [name: string, options: Options, markup: string, js: Files, ids: string[]][] = [
    [
      'a literal import()',
      SCRIPTS,
      module('/_astro/s.js'),
      { '_astro/s.js': 'import("./l.js")', '_astro/l.js': small },
      [],
    ],
    [
      'import(url) in a bundled script',
      SCRIPTS,
      module('/_astro/s.js'),
      { '_astro/s.js': 'import(url)' },
      ['js-budget'],
    ],
    [
      'a template literal with ${ in an island file',
      ISLANDS,
      islandWith('/_astro/C.js'),
      { '_astro/C.js': `import(\`./${SUBSTITUTION}name}.js\`)`, '_astro/client.js': small },
      ['js-budget'],
    ],
    [
      'import(url) in a later file',
      ISLANDS,
      islandWith('/_astro/C.js'),
      { '_astro/C.js': 'import("./l.js")', '_astro/client.js': small, '_astro/l.js': 'import(u)' },
      ['js-budget'],
    ],
    [
      'import(url) in a file that a bundled script imports',
      SCRIPTS,
      module('/_astro/s.js'),
      { '_astro/s.js': 'import"./b.js";', '_astro/b.js': 'import(u)' },
      ['js-budget'],
    ],
    [
      'import(url) in an inline module script',
      SCRIPTS,
      '<script type="module">import(url)</script>',
      {},
      ['js-budget'],
    ],
    [
      'white space before the parenthesis',
      SCRIPTS,
      '<script type="module">import ("/_astro/l.js")</script>',
      { '_astro/l.js': small },
      ['js-budget'],
    ],
    ['a method named import is no call', SCRIPTS, '<script type="module">x.import(u)</script>', {}, []],
    [
      'a file that the page does not load is not read',
      SCRIPTS,
      module('/_astro/s.js'),
      { '_astro/s.js': small, '_astro/other.js': 'import(u)' },
      [],
    ],
  ];
  assert.deepEqual(
    cases.map(([name, options, markup, js]) => [name, budgetIds(options, markup, js)]),
    cases.map(([name, , , , ids]) => [name, ids]),
  );
});

test('js-budget: the prefetch chunk with its closure is at most prefetchJsBytes, and astroPrefetch needs it', () => {
  assert.equal(LIMITS.prefetchJsBytes, 2_048);
  const chunk = '<script type="module" src="/_astro/page.Ab1.js"></script>';
  const cases: readonly [name: string, options: Options, markup: string, js: Files, ids: string[]][] = [
    ['a small chunk', PREFETCH, chunk, { '_astro/page.Ab1.js': jsOf(1_200) }, []],
    ['a large chunk', PREFETCH, chunk, { '_astro/page.Ab1.js': jsOf(2_600) }, ['js-budget']],
    [
      'a small chunk that imports a large file',
      PREFETCH,
      chunk,
      { '_astro/page.Ab1.js': 'import"./prefetch.js";', '_astro/prefetch.js': jsOf(2_600) },
      ['js-budget'],
    ],
    ['astroPrefetch without the chunk', PREFETCH, '', {}, ['js-budget']],
    ['astroPrefetch with a chunk that names no file', PREFETCH, chunk, {}, ['js-budget']],
    ['no chunk without astroPrefetch', OPTIONS, '', {}, []],
  ];
  // With astroPrefetch every page needs the chunk, and only the home has it: the cases read the home.
  const homeIds = (options: Options, markup: string, js: Files): string[] => {
    const ctx = contextOf(budgetSite(options, markup, js), { options });
    auditJsBudget(ctx);
    return [...new Set(ctx.report.findings.filter((finding) => finding.where === '/').map((finding) => finding.rule))];
  };
  assert.deepEqual(
    cases.map(([name, options, markup, js]) => [name, homeIds(options, markup, js)]),
    cases.map(([name, , , , ids]) => [name, ids]),
  );
  // With astroPrefetch every page needs the chunk: the pages of the fixtures have none.
  const ctx = contextOf(budgetSite(PREFETCH, chunk, { '_astro/page.Ab1.js': jsOf(500) }), { options: PREFETCH });
  assert.equal(
    findingsOf(auditJsBudget, ctx, 'js-budget').length,
    Object.keys(site(PREFETCH)).filter((file) => file.endsWith('.html')).length - 1,
  );
});

test('js-budget measures compressed sizes as the budgets of section 8 do, and gives one finding for each limit', () => {
  const file = jsOf(25_000);
  const ctx = contextOf(
    budgetSite(ISLANDS, `${islandWith('/_astro/C.js')}<script type="module" src="/_astro/s.js"></script>`, {
      '_astro/C.js': file,
      '_astro/client.js': 'import("./lazy.js")',
      '_astro/lazy.js': jsOf(210_000),
      '_astro/s.js': '',
    }),
    { options: ISLANDS },
  );
  const found = findingsOf(auditJsBudget, ctx, 'js-budget');
  const size = (compressedSize(file) + compressedSize('import("./lazy.js")') + compressedSize('')).toLocaleString(
    'en-US',
  );
  assert.equal(found.length, 2);
  assert.ok(
    found.some((line) => line.startsWith(`/ the JS that loads at once has ${size} B compressed`)),
    found.join('\n'),
  );
  assert.ok(
    found.some((line) => line.includes('loads later through import()')),
    found.join('\n'),
  );
  assert.equal(getRule('js-budget').waivable, true);
});

// legal-origins

const OSM = origin('www.openstreetmap.org', ['frame'], { load: 'page', processor: 'OpenStreetMap Foundation' });

/** The site of the fixtures with a privacy text in each locale, inside `main` or in the footer. */
function privacySite(options: Options, texts: { de: string; fr: string }): Files {
  const alternates = { de: '/datenschutz/', fr: '/fr/protection-des-donnees/' };
  return {
    ...site(options),
    [fileOf('/datenschutz/')]: page(options, '/datenschutz/', {
      alternates,
      main: `<h1>Datenschutz</h1> <p>${texts.de}</p>`,
    }),
    [fileOf('/fr/protection-des-donnees/')]: page(options, '/fr/protection-des-donnees/', {
      alternates,
      main: `<h1>Protection des données</h1> <p>${texts.fr}</p>`,
    }),
  };
}

test('legal-origins: the privacy page of each locale names the processor of each origin in its legal text', () => {
  const one = settings({ origins: [OSM] });
  const two = settings({
    origins: [OSM, origin('js.pay.example', ['script'], { load: 'page', processor: 'Pay Example Ltd' })],
  });
  const spaced = settings({ origins: [{ ...OSM, processor: 'OpenStreetMap  Foundation' }] });
  const decomposed = settings({ origins: [{ ...OSM, processor: 'Fondation Lärchenwald'.normalize('NFD') }] });
  const both = 'Die Karte lädt Daten der OpenStreetMap Foundation.';
  const french = 'La carte charge des données de la OpenStreetMap Foundation.';
  const cases: readonly [name: string, options: Options, texts: { de: string; fr: string }, ids: string[]][] = [
    ['no origin', OPTIONS, { de: 'Text.', fr: 'Texte.' }, []],
    ['both pages name the processor', one, { de: both, fr: french }, []],
    ['the French page does not', one, { de: both, fr: 'La carte charge des données.' }, ['legal-origins']],
    ['another letter case', one, { de: both, fr: 'La carte de la openstreetmap foundation.' }, ['legal-origins']],
    ['two origins, one processor missing', two, { de: `${both} Pay Example Ltd.`, fr: french }, ['legal-origins']],
    ['two origins, both named', two, { de: `${both} Pay Example Ltd.`, fr: `${french} Pay Example Ltd.` }, []],
    ['white space of the processor reads as one space', spaced, { de: both, fr: french }, []],
    [
      'a line break in the page reads as one space',
      one,
      { de: 'Daten der OpenStreetMap\n   Foundation.', fr: french },
      [],
    ],
    [
      'NFC on both sides',
      decomposed,
      { de: 'Fondation Lärchenwald', fr: 'Fondation Lärchenwald'.normalize('NFD') },
      [],
    ],
  ];
  assert.deepEqual(
    cases.map(([name, options, texts]) => [
      name,
      idsOf(auditLegalOrigins, contextOf(privacySite(options, texts), { options })),
    ]),
    cases.map(([name, , , ids]) => [name, ids]),
  );
});

test('legal-origins reads only text a visitor sees: a processor in a hidden part is not named', () => {
  const one = settings({ origins: [OSM] });
  const ids = (text: string): string[] =>
    idsOf(
      auditLegalOrigins,
      contextOf(privacySite(one, { de: text, fr: 'OpenStreetMap Foundation' }), { options: one }),
    );
  assert.deepEqual(ids('Karten: OpenStreetMap Foundation.'), []);
  for (const hidden of [
    '<span hidden>OpenStreetMap Foundation</span>',
    '<span hidden="until-found">OpenStreetMap Foundation</span>',
    '<span aria-hidden="true">OpenStreetMap Foundation</span>',
    '<span class="visually-hidden">OpenStreetMap Foundation</span>',
    '<span aria-hidden="true" class="visually-hidden">OpenStreetMap Foundation</span>',
    '<template>OpenStreetMap Foundation</template>',
    '<!-- OpenStreetMap Foundation -->',
  ]) {
    assert.deepEqual(ids(hidden), ['legal-origins'], hidden);
  }
  // A part of the name in a hidden element breaks the name.
  assert.deepEqual(ids('OpenStreetMap <span hidden>x</span>Foundation'), []);
  assert.deepEqual(ids('OpenStreetMap <span class="visually-hidden">Foundation</span>'), ['legal-origins']);
  // A hidden main, or a hidden element around it, hides all of its text (Codex, #26).
  const named = privacySite(one, { de: 'Karten: OpenStreetMap Foundation.', fr: 'OpenStreetMap Foundation' });
  const file = fileOf('/datenschutz/');
  for (const [from, to] of [
    ['<main id="content">', '<main id="content" hidden>'],
    ['<main id="content">', '<main id="content" aria-hidden="true">'],
    ['<main id="content">', '<main id="content" class="visually-hidden">'],
    [' <body> ', ' <body hidden> '],
  ] as const) {
    const html = String(named[file]);
    assert.ok(html.includes(from), from);
    const files = { ...named, [file]: html.replace(from, to) };
    assert.deepEqual(idsOf(auditLegalOrigins, contextOf(files, { options: one })), ['legal-origins'], to);
  }
});

test('legal-origins reads main only, reports each privacy page once, and leaves an unbuilt page to legal-pages', () => {
  const one = settings({ origins: [OSM] });
  // The processor in the footer of every page is no part of the legal text.
  const files = privacySite(one, { de: 'Text.', fr: 'Texte.' });
  const footed = Object.fromEntries(
    Object.entries(files).map(([file, text]) => [
      file,
      typeof text === 'string' ? text.replace('</footer>', '<p>OpenStreetMap Foundation</p></footer>') : text,
    ]),
  );
  assert.deepEqual(findingsOf(auditLegalOrigins, contextOf(footed, { options: one }), 'legal-origins'), [
    '/datenschutz/ the privacy text does not name the processor "OpenStreetMap Foundation"',
    '/fr/protection-des-donnees/ the privacy text does not name the processor "OpenStreetMap Foundation"',
  ]);
  const { [fileOf('/fr/protection-des-donnees/')]: _gone, ...without } = privacySite(one, {
    de: 'Text.',
    fr: 'Texte.',
  });
  assert.deepEqual(findingsOf(auditLegalOrigins, contextOf(without, { options: one }), 'legal-origins'), [
    '/datenschutz/ the privacy text does not name the processor "OpenStreetMap Foundation"',
  ]);
  assert.equal(getRule('legal-origins').waivable, false);
});

/**
 * The shell rules of the page audit (`src/audit/page/shell.ts`): `speculation-block`, `modes-script`,
 * `modes-switch`, `csp-meta`, `csp-hash` (built half), `csp-base` and `html-shell`. Each case builds a context from
 * pages shaped as Astro writes them (`audit-fixtures.ts`), changes one thing, and asserts the exact sorted id list.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  auditCspBase,
  auditCspHash,
  auditCspMeta,
  auditHtmlShell,
  auditModesScript,
  auditModesSwitch,
  auditSpeculationBlock,
} from '../../src/audit/page/shell.ts';
import type { BuildContext } from '../../src/context.ts';
import { SPECULATION_HASH, SPECULATION_JSON, sha256 } from '../../src/csp.ts';
import { modeInsert, speculationInsert } from '../../src/inject.ts';
import { modeHash, modeScript } from '../../src/modes.ts';
import type { Options } from '../../src/options.ts';
import type { Report } from '../../src/registry.ts';
import {
  type ContextSettings,
  contextOf,
  cspContent,
  fileOf,
  findings,
  ICON_FILES,
  ids,
  modeSwitch,
  notFoundPage,
  OPTIONS,
  PAGE_CSS,
  page,
  SWITCH_OPTIONS,
  site,
} from './audit-fixtures.ts';
import { optionsOf, origin, TWO_LOCALES } from './fixtures.ts';

// Inputs

type Rule = (ctx: BuildContext) => void;

/** The text with its first `from` replaced. Throws when the text does not hold `from`. */
function swap(text: string, from: string, to: string): string {
  const at = text.indexOf(from);
  if (at < 0) throw new Error(`audit-shell: ${JSON.stringify(from)} is not in the text`);
  return `${text.slice(0, at)}${to}${text.slice(at + from.length)}`;
}

/** A client directory with one page and the icon files. */
const filesOf = (html: string, path = '/'): Record<string, string> => ({ ...ICON_FILES, [fileOf(path)]: html });

/** Runs the rules on one page at `/` with the settings, and gives the report. */
function run(rules: Rule | readonly Rule[], html: string, options: Options = OPTIONS): Report {
  const ctx = contextOf(filesOf(html), { options });
  for (const rule of Array.isArray(rules) ? rules : [rules]) (rule as Rule)(ctx);
  return ctx.report;
}

/** Runs the rules on a client directory. */
function runFiles(rules: readonly Rule[], files: Record<string, string>, settings: ContextSettings = {}): Report {
  const ctx = contextOf(files, settings);
  for (const rule of rules) rule(ctx);
  return ctx.report;
}

const SPEC = speculationInsert(OPTIONS);
const MODE = modeInsert(SWITCH_OPTIONS);
const CSP = cspContent(OPTIONS, { styles: [PAGE_CSS] });
const SWITCH_CSP = cspContent(SWITCH_OPTIONS, { styles: [PAGE_CSS] });
const NO_SPECULATION = optionsOf({ ...TWO_LOCALES, prefetch: { speculationRules: false, astroPrefetch: false } });

const home = (parts: Parameters<typeof page>[2] = {}): string => page(OPTIONS, '/', parts);
const switchHome = (parts: Parameters<typeof page>[2] = {}): string => page(SWITCH_OPTIONS, '/', parts);

// speculation-block

test('speculation-block: the fixture sites pass, with and without the mode script', () => {
  assert.deepEqual(ids(runFiles([auditSpeculationBlock], site(OPTIONS))), []);
  assert.deepEqual(ids(runFiles([auditSpeculationBlock], site(SWITCH_OPTIONS), { options: SWITCH_OPTIONS })), []);
});

test('speculation-block: with speculationRules off, a page without a block passes', () => {
  assert.deepEqual(ids(run(auditSpeculationBlock, page(NO_SPECULATION, '/'), NO_SPECULATION)), []);
});

test('speculation-block: with speculationRules off, a block fails', () => {
  const html = page(NO_SPECULATION, '/', { head: SPEC });
  const report = run(auditSpeculationBlock, html, NO_SPECULATION);
  assert.deepEqual(ids(report), ['speculation-block']);
  assert.deepEqual(findings(report), [
    'speculation-block / 1 speculation block(s); none while speculationRules is off',
  ]);
});

test('speculation-block: a page without the block fails, /404.html included', () => {
  assert.deepEqual(ids(run(auditSpeculationBlock, swap(home(), SPEC, ''))), ['speculation-block']);
  const files = { ...site(OPTIONS), '404.html': swap(notFoundPage(OPTIONS), SPEC, '') };
  const report = runFiles([auditSpeculationBlock], files);
  assert.deepEqual(findings(report), ['speculation-block /404.html no speculation block']);
});

test('speculation-block: a second block fails, also one whose type has another case', () => {
  assert.deepEqual(ids(run(auditSpeculationBlock, swap(home(), SPEC, SPEC + SPEC))), ['speculation-block']);
  const other = `<script type=" SpeculationRules ">${SPECULATION_JSON}</script>`;
  const report = run(auditSpeculationBlock, home({ main: `<h1>Titel</h1> ${other}` }));
  assert.deepEqual(findings(report), ['speculation-block / 2 speculation blocks; exactly 1']);
});

test('speculation-block: a block whose text is not SPECULATION_JSON fails', () => {
  const changed = SPEC.replace('"moderate"', '"eager"');
  const report = run(auditSpeculationBlock, swap(home(), SPEC, changed));
  assert.deepEqual(ids(report), ['speculation-block']);
  assert.match(findings(report)[0] ?? '', /a speculation block whose text is not the kit's/);
});

test('speculation-block: a block before the CSP meta fails', () => {
  const report = run(auditSpeculationBlock, swap(home({ head: SPEC }), `">${SPEC}`, '">'));
  assert.deepEqual(findings(report), ['speculation-block / a speculation block before the CSP meta']);
});

test('speculation-block: without one CSP meta, the place is not checked (csp-meta reports the page)', () => {
  const html = swap(home(), '<meta http-equiv="content-security-policy"', '<meta name="x"');
  assert.deepEqual(ids(run(auditSpeculationBlock, html)), []);
  assert.deepEqual(ids(run([auditSpeculationBlock, auditCspMeta], html)), ['csp-meta']);
});

test('speculation-block and csp-hash: a changed block is two facts, so both ids come', () => {
  const html = swap(home(), SPEC, SPEC.replace('"moderate"', '"eager"'));
  assert.deepEqual(ids(run([auditSpeculationBlock, auditCspHash], html)), ['csp-hash', 'speculation-block']);
});

// modes-script

test('modes-script: the fixture sites pass with three options and with one', () => {
  assert.deepEqual(ids(runFiles([auditModesScript], site(SWITCH_OPTIONS), { options: SWITCH_OPTIONS })), []);
  assert.deepEqual(ids(runFiles([auditModesScript], site(OPTIONS))), []);
});

test('modes-script: with two or more options, a page without the mode script fails, /404.html included', () => {
  assert.deepEqual(ids(run(auditModesScript, swap(switchHome(), MODE, ''), SWITCH_OPTIONS)), ['modes-script']);
  const files = { ...site(SWITCH_OPTIONS), '404.html': swap(notFoundPage(SWITCH_OPTIONS), MODE, '') };
  const report = runFiles([auditModesScript], files, { options: SWITCH_OPTIONS });
  assert.deepEqual(findings(report), ['modes-script /404.html no kit mode script']);
});

test('modes-script: two mode scripts fail', () => {
  const report = run(auditModesScript, swap(switchHome(), MODE, MODE + MODE), SWITCH_OPTIONS);
  assert.deepEqual(ids(report), ['modes-script']);
  assert.match(findings(report)[0] ?? '', /2 kit mode scripts; exactly 1/);
});

test('modes-script: a mode script with an attribute or another text is not the kit mode script', () => {
  const attributed = swap(switchHome(), '<script>{', '<script data-x>{');
  assert.deepEqual(ids(run(auditModesScript, attributed, SWITCH_OPTIONS)), ['modes-script']);
  const changed = swap(switchHome(), 'const fallback = "auto";', 'const fallback = "dark";');
  const report = run(auditModesScript, changed, SWITCH_OPTIONS);
  assert.deepEqual(ids(report), ['modes-script']);
  assert.match(findings(report)[0] ?? '', /no kit mode script; <script> has other attributes or another text/);
});

test('modes-script: the mode script must be the next element after the CSP meta', () => {
  const html = swap(switchHome(), MODE, `<meta name="x" content="y">${MODE}`);
  const report = run(auditModesScript, html, SWITCH_OPTIONS);
  assert.deepEqual(findings(report), ['modes-script / the mode script is not the next element after the CSP meta']);
});

test('modes-script: the mode script must come before every style sheet link', () => {
  const html = switchHome({ head: '<link rel="Preload STYLESHEET" href="/_astro/a.css">' });
  const report = run(auditModesScript, html, SWITCH_OPTIONS);
  assert.deepEqual(findings(report), [
    'modes-script / the mode script comes after <link rel="Preload STYLESHEET" href="/_astro/a.css">',
  ]);
});

test('modes-script: the mode script must come before the speculation block', () => {
  const html = swap(switchHome(), MODE + SPEC, SPEC + MODE);
  const report = run(auditModesScript, html, SWITCH_OPTIONS);
  assert.deepEqual(ids(report), ['modes-script']);
  assert.match(findings(report)[0] ?? '', /comes after <script type="speculationrules">/);
});

test('modes-script: with fewer than two options, a mode script fails, also one of other settings', () => {
  const report = run(auditModesScript, home({ head: MODE }));
  assert.deepEqual(findings(report), ['modes-script / a mode script with fewer than two mode options: <script>']);
  const exact = home({ head: `<script>${modeScript(OPTIONS)}</script>` });
  assert.deepEqual(ids(run(auditModesScript, exact)), ['modes-script']);
});

test('modes-script: data-mode on html fails in every case', () => {
  const report = run(auditModesScript, swap(home(), '<html lang="de-CH">', '<html lang="de-CH" data-mode="dark">'));
  assert.deepEqual(findings(report), ['modes-script / the html element has a data-mode attribute']);
  const switched = swap(switchHome(), '<html lang="de-CH">', '<html data-mode lang="de-CH">');
  assert.deepEqual(ids(run(auditModesScript, switched, SWITCH_OPTIONS)), ['modes-script']);
});

test('modes-script: without one CSP meta, the place after the meta is not checked', () => {
  const html = swap(switchHome(), '<meta http-equiv="content-security-policy"', '<meta name="x"');
  assert.deepEqual(ids(run(auditModesScript, html, SWITCH_OPTIONS)), []);
});

test('modes-script and csp-hash: a changed mode script is two facts, so both ids come', () => {
  const html = swap(switchHome(), 'const fallback = "auto";', 'const fallback = "dark";');
  assert.deepEqual(ids(run([auditModesScript, auditCspHash], html, SWITCH_OPTIONS)), ['csp-hash', 'modes-script']);
});

// modes-switch

const radio = (value: string, text: string): string =>
  `<label> <input type="radio" name="mode" value="${value}"> ${text} </label>`;
const RADIOS = radio('auto', 'Automatisch') + radio('light', 'Hell') + radio('dark', 'Dunkel');
const fieldset = (inner: string, legend = '<legend>Darstellung</legend>'): string =>
  `<fieldset class="mode-switch" data-mode-switch> ${legend} ${inner} </fieldset>`;
const OPTION_LIST =
  '<option value="auto">Automatisch</option><option value="light">Hell</option><option value="dark">Dunkel</option>';
const selectSwitch = (select = `<select id="mode" name="mode">${OPTION_LIST}</select>`): string =>
  `<div class="mode-switch" data-mode-switch> <label for="mode">Darstellung</label> ${select} </div>`;
/** The test site's switch: a `details` with a `summary`, and a fieldset whose legend is visually hidden. */
const DETAILS_SWITCH = `<details class="mode-switch" data-mode-switch> <summary>Darstellung</summary> <fieldset class="mode-switch__panel"> <legend class="visually-hidden">Darstellung wählen</legend> ${RADIOS} </fieldset> </details>`;

/** A page of `SWITCH_OPTIONS` whose header holds the markup in place of the fixture switch. */
const withSwitch = (markup: string): string =>
  switchHome({
    header: `<header class="site-header"> <a class="site-header__brand" href="/">Example</a> ${markup} </header>`,
  });

/**
 * The one finding of a page with this switch markup, when the ids are exactly `['modes-switch']` and there is one
 * finding; else a text that names the ids and the count, which no case expects.
 */
function switchDetail(markup: string): string {
  const report = run(auditModesSwitch, withSwitch(markup), SWITCH_OPTIONS);
  const list = findings(report);
  const only = list[0];
  return ids(report).join(' ') === 'modes-switch' && list.length === 1 && only !== undefined
    ? only
    : `ids ${JSON.stringify(ids(report))}, ${list.length} findings`;
}

test('modes-switch: the fixture sites pass with three options and with one', () => {
  assert.deepEqual(ids(runFiles([auditModesSwitch], site(SWITCH_OPTIONS), { options: SWITCH_OPTIONS })), []);
  assert.deepEqual(ids(runFiles([auditModesSwitch], site(OPTIONS))), []);
});

test('modes-switch: the switch of the test site, a select and a popover pass', () => {
  assert.deepEqual(ids(run(auditModesSwitch, withSwitch(DETAILS_SWITCH), SWITCH_OPTIONS)), []);
  assert.deepEqual(ids(run(auditModesSwitch, withSwitch(selectSwitch()), SWITCH_OPTIONS)), []);
  const popover = `<div popover id="modes" data-mode-switch> ${fieldset(RADIOS).replace(' data-mode-switch', '')} </div>`;
  assert.deepEqual(ids(run(auditModesSwitch, withSwitch(popover), SWITCH_OPTIONS)), []);
  const unwrapped = `<div data-mode-switch> <fieldset> <legend>Darstellung</legend> <input type="radio" name="mode" value="auto" id="m1"><label for="m1">Automatisch</label><input type="radio" name="mode" value="light" id="m2"><label for="m2">Hell</label><input type="radio" name="mode" value="dark" id="m3"><label for="m3">Dunkel</label> </fieldset> </div>`;
  assert.deepEqual(ids(run(auditModesSwitch, withSwitch(unwrapped), SWITCH_OPTIONS)), []);
});

test('modes-switch: a page without the switch fails, /404.html included', () => {
  const report = run(auditModesSwitch, withSwitch(''), SWITCH_OPTIONS);
  assert.deepEqual(findings(report), ['modes-switch / no [data-mode-switch] element']);
  const notFound = swap(notFoundPage(SWITCH_OPTIONS), modeSwitch(SWITCH_OPTIONS, 'de'), '');
  const files = { ...site(SWITCH_OPTIONS), '404.html': notFound };
  assert.deepEqual(findings(runFiles([auditModesSwitch], files, { options: SWITCH_OPTIONS })), [
    'modes-switch /404.html no [data-mode-switch] element',
  ]);
});

test('modes-switch: two switch elements fail', () => {
  assert.match(
    switchDetail(fieldset(RADIOS) + selectSwitch().replace('name="mode"', 'name="theme"')),
    /2 \[data-mode-switch\] elements; exactly 1/,
  );
});

test('modes-switch: a switch inside a form fails', () => {
  assert.match(
    switchDetail(`<form action="/x/" method="get">${fieldset(RADIOS)}</form>`),
    /the switch is inside a form/,
  );
});

test('modes-switch: the switch element may not be the select', () => {
  const detail = switchDetail(
    `<label for="mode">Darstellung</label> <select id="mode" name="mode" data-mode-switch>${OPTION_LIST}</select>`,
  );
  assert.match(detail, /the switch element is itself the control named mode/);
});

test('modes-switch: the fieldset needs a legend with text', () => {
  assert.match(switchDetail(fieldset(RADIOS, '')), /the fieldset has no legend/);
  assert.match(switchDetail(fieldset(RADIOS, '<legend> </legend>')), /the legend has no text/);
});

test('modes-switch: radios that are in no fieldset of the switch fail', () => {
  assert.match(
    switchDetail(`<div data-mode-switch> ${RADIOS} </div>`),
    /the radios are not in one fieldset of the switch/,
  );
  const outer = `<fieldset><legend>Einstellungen</legend> <div data-mode-switch> ${RADIOS} </div></fieldset>`;
  assert.match(switchDetail(outer), /the radios are not in one fieldset of the switch/);
});

test('modes-switch: every enabled option exactly once, and no other value', () => {
  assert.equal(
    switchDetail(fieldset(radio('auto', 'Automatisch') + radio('light', 'Hell'))),
    'modes-switch / no control for the option dark',
  );
  const doubled = fieldset(RADIOS + radio('dark', 'Nacht'));
  assert.equal(switchDetail(doubled), 'modes-switch / the option dark 2 times');
  const extra = fieldset(RADIOS + radio('contrast', 'Mehr Kontrast'));
  assert.equal(switchDetail(extra), 'modes-switch / the value "contrast" is no enabled option');
  const noValue = fieldset(
    `${radio('auto', 'Automatisch')}${radio('light', 'Hell')}<label> <input type="radio" name="mode"> Dunkel </label>`,
  );
  assert.equal(
    switchDetail(noValue),
    'modes-switch / no control for the option dark; the value "on" is no enabled option',
  );
});

test('modes-switch: every radio has a label with text, and the texts differ', () => {
  const unlabeled = fieldset(
    `${radio('auto', 'Automatisch')}${radio('light', 'Hell')}<input type="radio" name="mode" value="dark">`,
  );
  assert.equal(switchDetail(unlabeled), 'modes-switch / the radio dark has no label');
  const empty = fieldset(`${radio('auto', 'Automatisch')}${radio('light', 'Hell')}${radio('dark', ' ')}`);
  assert.equal(switchDetail(empty), 'modes-switch / the label of the radio dark has no text');
  const same = fieldset(`${radio('auto', 'Automatisch')}${radio('light', 'Hell')}${radio('dark', 'Hell')}`);
  assert.equal(switchDetail(same), 'modes-switch / two radio labels read "Hell"');
});

test('modes-switch: a select with multiple, without a label, or with options without text or with one text fails', () => {
  assert.match(
    switchDetail(selectSwitch(`<select id="mode" name="mode" multiple>${OPTION_LIST}</select>`)),
    /the select has multiple/,
  );
  const unlabeled = `<div data-mode-switch> <select name="mode">${OPTION_LIST}</select> </div>`;
  assert.equal(switchDetail(unlabeled), 'modes-switch / the select has no label');
  const empty = selectSwitch(`<select id="mode" name="mode">${OPTION_LIST.replace('>Dunkel<', '><')}</select>`);
  assert.equal(switchDetail(empty), 'modes-switch / an option has no text');
  const same = selectSwitch(`<select id="mode" name="mode">${OPTION_LIST.replace('>Dunkel<', '>Hell<')}</select>`);
  assert.equal(switchDetail(same), 'modes-switch / two options read "Hell"');
  const textValues = selectSwitch(
    '<select id="mode" name="mode"><option>auto</option><option>light</option><option>dark</option></select>',
  );
  assert.deepEqual(ids(run(auditModesSwitch, withSwitch(textValues), SWITCH_OPTIONS)), []);
});

test('modes-switch: no other form control inside the switch', () => {
  assert.match(
    switchDetail(fieldset(`${RADIOS}<button type="button">OK</button>`)),
    /another form control inside the switch: <button type="button">/,
  );
  assert.match(
    switchDetail(fieldset(`${RADIOS}<textarea name="mode"></textarea>`)),
    /a control named mode that is no radio and no select/,
  );
});

test('modes-switch: no control named mode outside the switch', () => {
  const html = switchHome({ main: '<h1>Titel</h1> <input type="hidden" name="mode" value="auto">' });
  const report = run(auditModesSwitch, html, SWITCH_OPTIONS);
  assert.deepEqual(findings(report), [
    'modes-switch / a control named mode outside the switch: <input type="hidden" name="mode" value="auto">',
  ]);
});

test('modes-switch: both radios and a select, or neither, fail', () => {
  const both = fieldset(
    `${RADIOS}<label for="m">Darstellung</label><select id="m" name="mode">${OPTION_LIST}</select>`,
  );
  assert.match(switchDetail(both), /both radios and a select named mode/);
  assert.equal(
    switchDetail('<div data-mode-switch>Darstellung</div>'),
    'modes-switch / no fieldset of radios and no select named mode',
  );
});

test('modes-switch: with fewer than two options, a switch or a control named mode fails', () => {
  const report = run(auditModesSwitch, home({ main: `<h1>Titel</h1> ${fieldset(RADIOS)}` }));
  assert.deepEqual(findings(report), [
    'modes-switch / a [data-mode-switch] element with fewer than two mode options; a control named mode with fewer than two mode options',
  ]);
  const control = home({ main: '<h1>Titel</h1> <select name="mode"><option>auto</option></select>' });
  assert.deepEqual(ids(run(auditModesSwitch, control)), ['modes-switch']);
});

// csp-meta

test('csp-meta: the fixture sites pass; a JSON-LD block before the meta is no executable script', () => {
  assert.deepEqual(ids(runFiles([auditCspMeta], site(OPTIONS))), []);
  assert.deepEqual(ids(runFiles([auditCspMeta], site(SWITCH_OPTIONS), { options: SWITCH_OPTIONS })), []);
});

test('csp-meta: directives and sources compare as sets, and any extra hash passes', () => {
  const reordered =
    "style-src 'SELF' 'sha256-x'; script-src 'sha256-a' 'self' 'sha256-b';object-src 'none'; base-uri 'self'; form-action 'self'; frame-src 'none'; worker-src 'none'; manifest-src 'self'; media-src 'self'; connect-src 'self'; font-src 'self'; img-src 'self'; default-src 'self'";
  assert.deepEqual(ids(run(auditCspMeta, home({ csp: reordered }))), []);
});

test('csp-meta: the directives of declared origins pass', () => {
  const options = optionsOf({
    ...TWO_LOCALES,
    features: { forms: false, islands: false, scripts: true, wasm: false, workers: false },
    origins: [origin('js.pay.example', ['script', 'frame']), origin('api.pay.example', ['connect'])],
  });
  assert.deepEqual(ids(run(auditCspMeta, page(options, '/'), options)), []);
  const report = run(auditCspMeta, home(), options);
  assert.deepEqual(findings(report), [
    "csp-meta / connect-src lacks https://api.pay.example; frame-src lacks https://js.pay.example; frame-src has 'none'; script-src lacks https://js.pay.example",
  ]);
});

test('csp-meta: a page without a CSP meta, or with two, fails once', () => {
  const none = swap(home(), '<meta http-equiv="content-security-policy"', '<meta name="x"');
  assert.deepEqual(findings(run(auditCspMeta, none)), ['csp-meta / no CSP meta']);
  const two = home({ head: `<meta http-equiv="Content-Security-Policy" content="${CSP}">` });
  assert.deepEqual(findings(run(auditCspMeta, two)), ['csp-meta / 2 CSP metas; exactly 1']);
});

test('csp-meta: an executable script before the meta fails, inline or with src', () => {
  const inline = run(auditCspMeta, home({ head: '<script>window.x = 1;</script>' }));
  assert.deepEqual(findings(inline), ['csp-meta / an executable script before the CSP meta: <script>']);
  const module = run(auditCspMeta, home({ head: '<script type="module" src="/_astro/a.js"></script>' }));
  assert.deepEqual(ids(module), ['csp-meta']);
  assert.deepEqual(ids(run(auditCspMeta, home({ head: '<script type="text/plain">x</script>' }))), []);
});

test('csp-meta: a missing, extra or doubled directive fails', () => {
  assert.deepEqual(findings(run(auditCspMeta, home({ csp: swap(CSP, "object-src 'none'", '') }))), [
    'csp-meta / no object-src',
  ]);
  assert.deepEqual(findings(run(auditCspMeta, home({ csp: `${CSP} report-uri /csp/` }))), [
    'csp-meta / the directive report-uri, which the kit does not write',
  ]);
  assert.deepEqual(findings(run(auditCspMeta, home({ csp: `${CSP} img-src 'self'` }))), ['csp-meta / img-src twice']);
});

test('csp-meta: a missing or extra source fails, and a forbidden source is named once', () => {
  assert.deepEqual(findings(run(auditCspMeta, home({ csp: swap(CSP, "script-src 'self'", 'script-src') }))), [
    "csp-meta / script-src lacks 'self'",
  ]);
  assert.deepEqual(findings(run(auditCspMeta, home({ csp: swap(CSP, "img-src 'self'", "img-src 'self' data:") }))), [
    'csp-meta / the forbidden source data:',
  ]);
  assert.deepEqual(
    findings(run(auditCspMeta, home({ csp: swap(CSP, "script-src 'self'", "script-src 'self' 'unsafe-inline'") }))),
    ["csp-meta / the forbidden source 'unsafe-inline'"],
  );
  assert.deepEqual(
    findings(
      run(auditCspMeta, home({ csp: swap(CSP, "connect-src 'self'", "connect-src 'self' https://api.example") })),
    ),
    ['csp-meta / the forbidden source https://api.example'],
  );
  assert.deepEqual(
    findings(run(auditCspMeta, home({ csp: swap(CSP, "script-src 'self'", "script-src 'self' 'nonce-abc'") }))),
    ["csp-meta / script-src has 'nonce-abc'"],
  );
  assert.deepEqual(
    findings(run(auditCspMeta, home({ csp: swap(CSP, "img-src 'self'", `img-src 'self' '${SPECULATION_HASH}'`) }))),
    [`csp-meta / img-src has '${SPECULATION_HASH.toLowerCase()}'`],
  );
});

test("csp-meta and csp-hash: a missing kit hash is csp-hash's alone", () => {
  const html = home({ csp: swap(CSP, ` '${SPECULATION_HASH}'`, '') });
  assert.deepEqual(ids(run([auditCspMeta, auditCspHash], html)), ['csp-hash']);
  const noMode = switchHome({ csp: swap(SWITCH_CSP, ` '${modeHash(SWITCH_OPTIONS)}'`, '') });
  assert.deepEqual(ids(run([auditCspMeta, auditCspHash], noMode, SWITCH_OPTIONS)), ['csp-hash']);
});

// csp-hash

test('csp-hash: the fixture sites pass: the mode script, the speculation block and the style are hashed', () => {
  assert.deepEqual(ids(runFiles([auditCspHash], site(OPTIONS))), []);
  assert.deepEqual(ids(runFiles([auditCspHash], site(SWITCH_OPTIONS), { options: SWITCH_OPTIONS })), []);
});

test('csp-hash: a missing kit hash fails at the script that lacks it', () => {
  const report = run(auditCspHash, home({ csp: swap(CSP, ` '${SPECULATION_HASH}'`, '') }));
  assert.deepEqual(ids(report), ['csp-hash']);
  assert.match(findings(report)[0] ?? '', /^csp-hash \/ <script type="speculationrules"> has no hash in script-src: /);
});

test('csp-hash: an inline classic, module or importmap script needs its hash', () => {
  const script = 'window.x = 1;';
  assert.deepEqual(ids(run(auditCspHash, home({ main: `<h1>Titel</h1> <script>${script}</script>` }))), ['csp-hash']);
  const hashed = home({
    main: `<h1>Titel</h1> <script>${script}</script>`,
    csp: cspContent(OPTIONS, { scripts: [script], styles: [PAGE_CSS] }),
  });
  assert.deepEqual(ids(run(auditCspHash, hashed)), []);
  assert.deepEqual(ids(run(auditCspHash, home({ main: `<h1>Titel</h1> <script type="module">${script}</script>` }))), [
    'csp-hash',
  ]);
  assert.deepEqual(
    ids(run(auditCspHash, home({ main: '<h1>Titel</h1> <script type="importmap">{"imports":{}}</script>' }))),
    ['csp-hash'],
  );
});

test('csp-hash: a script with src, a JSON-LD block and a data block need no hash', () => {
  const main =
    '<h1>Titel</h1> <script type="module" src="/_astro/a.js"></script> <script type="application/ld+json">{}</script> <script type="text/plain">x</script>';
  assert.deepEqual(ids(run(auditCspHash, home({ main }))), []);
});

test('csp-hash: a style whose text differs from its hash fails', () => {
  const report = run(auditCspHash, home({ csp: cspContent(OPTIONS, { styles: ['@layer reset{*{margin:1px}}'] }) }));
  assert.deepEqual(findings(report), [`csp-hash / <style> has no hash in style-src: ${PAGE_CSS}`]);
});

test('csp-hash: a style that a </style> in a string splits gives one finding for the style', () => {
  const css = '.a{content:"</style><p>x</p>"}';
  const report = run(auditCspHash, home({ css }));
  assert.deepEqual(findings(report), ['csp-hash / <style> has no hash in style-src: .a{content:"']);
});

test('csp-hash: without script-src and style-src, the hashes of default-src count', () => {
  const csp = `default-src 'self' '${SPECULATION_HASH}' '${sha256(PAGE_CSS)}'`;
  assert.deepEqual(ids(run(auditCspHash, home({ csp }))), []);
  assert.deepEqual(ids(run(auditCspHash, home({ csp: "default-src 'self'" }))), ['csp-hash']);
});

test("csp-hash: a page without one CSP meta is csp-meta's", () => {
  const html = swap(home(), '<meta http-equiv="content-security-policy"', '<meta name="x"');
  assert.deepEqual(ids(run([auditCspHash, auditCspMeta], html)), ['csp-meta']);
});

// csp-base

test('csp-base: no <base> passes; a <base> fails once for its page', () => {
  assert.deepEqual(ids(runFiles([auditCspBase], site(OPTIONS))), []);
  const report = run(auditCspBase, home({ head: '<base href="/"><base target="_self">' }));
  assert.deepEqual(findings(report), ['csp-base / <base href="/">']);
});

// html-shell

test('html-shell: the fixture sites pass, and the summary of the test site switch comes after the skip link', () => {
  assert.deepEqual(ids(runFiles([auditHtmlShell], site(OPTIONS))), []);
  assert.deepEqual(ids(run(auditHtmlShell, withSwitch(DETAILS_SWITCH), SWITCH_OPTIONS)), []);
});

test('html-shell: a focusable element before the skip link fails', () => {
  const report = run(auditHtmlShell, swap(home(), '<body> ', '<body> <a href="/">Start</a> '));
  assert.deepEqual(findings(report), ['html-shell / the first focusable element is <a href="/">, not a skip link']);
  for (const before of [
    '<button>x</button>',
    '<div tabindex="0">x</div>',
    '<input>',
    '<p contenteditable>x</p>',
    '<audio controls></audio>',
    '<summary>x</summary>',
    '<iframe title="x"></iframe>',
    '<select></select>',
    '<textarea></textarea>',
    '<area href="/">',
  ]) {
    assert.deepEqual(ids(run(auditHtmlShell, swap(home(), '<body> ', `<body> ${before} `))), ['html-shell'], before);
  }
});

test('html-shell: elements that the selector does not name may stand before the skip link', () => {
  for (const before of [
    '<div tabindex="-1">x</div>',
    '<input type="HIDDEN" name="a">',
    '<audio></audio>',
    '<a>Anker</a>',
  ]) {
    assert.deepEqual(ids(run(auditHtmlShell, swap(home(), '<body> ', `<body> ${before} `))), [], before);
  }
});

test('html-shell: a skip link needs a fragment, and a page needs a focusable element', () => {
  assert.deepEqual(ids(run(auditHtmlShell, swap(home(), 'href="#content"', 'href="#"'))), ['html-shell']);
  const bare =
    '<!DOCTYPE html><html lang="de-CH"> <head><title>Titel der Seite</title></head> <body> <main id="content"> <h1>Titel</h1> </main> </body> </html>';
  assert.deepEqual(findings(run(auditHtmlShell, bare)), [
    'html-shell / no focusable element; the first one must be a skip link',
  ]);
});

test('html-shell: a page needs exactly one main', () => {
  assert.deepEqual(findings(run(auditHtmlShell, home({ footer: '<main>Zwei</main>' }))), [
    'html-shell / 2 main elements; exactly 1',
  ]);
  const none = swap(swap(home(), '<main id="content">', '<div id="content">'), '</main>', '</div>');
  assert.deepEqual(findings(run(auditHtmlShell, none)), ['html-shell / 0 main elements; exactly 1']);
});

test('html-shell: main must have the id that the skip link names', () => {
  const html = swap(home({ footer: '<footer id="content">x</footer>' }), '<main id="content">', '<main>');
  assert.deepEqual(findings(run(auditHtmlShell, html)), [
    'html-shell / the skip link names #content, but main has no id',
  ]);
  const other = swap(home({ footer: '<footer id="content">x</footer>' }), '<main id="content">', '<main id="inhalt">');
  assert.deepEqual(ids(run(auditHtmlShell, other)), ['html-shell']);
});

test("html-shell: a fragment that names no element is links-resolve's; a percent-encoded fragment counts", () => {
  assert.deepEqual(ids(run(auditHtmlShell, swap(home(), '<main id="content">', '<main id="inhalt">'))), []);
  const encoded = swap(swap(home(), 'href="#content"', 'href="#caf%C3%A9"'), '<main id="content">', '<main id="café">');
  assert.deepEqual(ids(run(auditHtmlShell, encoded)), []);
});

test('html-shell: no meta refresh and no meta referrer, in any letter case and with any content', () => {
  const inHead = (meta: string): string => swap(home(), '</head>', `${meta}</head>`);
  const cases: readonly [name: string, html: string, ids: string[]][] = [
    ['the page of the fixtures', home(), []],
    [
      'a refresh to another host',
      inHead('<meta http-equiv="refresh" content="0; url=https://evil.example/">'),
      ['html-shell'],
    ],
    ['a refresh to the site', inHead('<meta http-equiv="refresh" content="0; url=/zimmer/">'), ['html-shell']],
    ['a refresh with a delay and no URL', inHead('<meta http-equiv="refresh" content="30">'), ['html-shell']],
    ['a refresh in another case, with spaces', inHead('<meta http-equiv=" ReFresh " content="0">'), ['html-shell']],
    ['a refresh with no content', inHead('<meta http-equiv="refresh">'), ['html-shell']],
    [
      'a refresh in body',
      swap(home(), '</main>', '<meta http-equiv="refresh" content="0;url=https://evil.example/"></main>'),
      ['html-shell'],
    ],
    [
      'a refresh in a noscript of head',
      inHead('<noscript><meta http-equiv="refresh" content="0;url=https://evil.example/"></noscript>'),
      ['html-shell'],
    ],
    ['a refresh in template content', inHead('<template><meta http-equiv="refresh" content="0"></template>'), []],
    ['a meta referrer unsafe-url', inHead('<meta name="referrer" content="unsafe-url">'), ['html-shell']],
    ['a meta referrer that is strict', inHead('<meta name="referrer" content="no-referrer">'), ['html-shell']],
    ['a meta referrer in another case', inHead('<meta name="REFERRER" content="origin">'), ['html-shell']],
    [
      'a meta referrer in a noscript of body',
      swap(home(), '</main>', '<noscript><meta name="referrer" content="unsafe-url"></noscript></main>'),
      ['html-shell'],
    ],
    ['another http-equiv', inHead('<meta http-equiv="content-language" content="de">'), []],
    ['another name', inHead('<meta name="referrers" content="x">'), []],
    ['a name that holds the word', inHead('<meta name="theme-color" content="refresh">'), []],
  ];
  assert.deepEqual(
    cases.map(([name, html]) => [name, ids(run(auditHtmlShell, html))]),
    cases.map(([name, , expected]) => [name, expected]),
  );
  assert.deepEqual(
    findings(run(auditHtmlShell, inHead('<meta http-equiv="refresh" content="0; url=https://evil.example/">'))),
    [
      'html-shell / <meta http-equiv="refresh" content="0; url=https://evil.example/">: a meta refresh; a redirect belongs in redirects.json',
    ],
  );
});

test('html-shell: the parser reads the whole page and its nested markup; an element left open fails', () => {
  const inMain = (markup: string): string => swap(home(), '</main>', `${markup} </main>`);
  const drops = (html: string): string[] =>
    findings(run(auditHtmlShell, html)).filter((line) => line.includes('the parser drops'));
  const cases: readonly [name: string, html: string, place: string | undefined][] = [
    ['the page of the fixtures', home(), undefined],
    // The parser drops each of these with its open ancestors, so js-script and every other rule were blind to it.
    ['a script with no end tag', inMain('<script src="/x.js">'), ''],
    ['an iframe with no end tag', inMain('<iframe title="x" src="https://cdn.example.org/">'), ''],
    ['a link with no end tag', inMain('<a href="https://cdn.example.org/">x'), ''],
    ['a form with no end tag', inMain('<form action="https://cdn.example.org/"><input name="a">'), ''],
    ['a span with no end tag', inMain('<div><span>x</div>'), ''],
    // Valid HTML, but this parser drops it: the fix text asks for the end tag of each option.
    ['an option with no end tag', inMain('<select name="a"><option>a<option>b</select>'), ''],
    [
      'an open element in a srcdoc',
      inMain('<iframe title="x" srcdoc="<div><iframe src=https://cdn.example.org/a></div>"></iframe>'),
      ' in an iframe srcdoc',
    ],
    [
      'an open element in a noscript',
      inMain('<noscript><p><a href="https://cdn.example.org/">x</p></noscript>'),
      ' in a noscript',
    ],
    // HTML closes these by itself, and the parser keeps them.
    [
      'p, li, td, dt and dd with no end tag',
      inMain('<p>a<p>b<ul><li>a<li>b</ul><table><tr><td>a<td>b</table><dl><dt>a<dd>b</dl>'),
      undefined,
    ],
    ['a stray end tag', inMain('<p>a</div></p>'), undefined],
    ['a > in a quoted attribute', inMain('<p title="a > b">x</p>'), undefined],
    ['a < in a script', inMain('<script type="application/ld+json">{"a":"<b"}</script>'), undefined],
    [
      'a closed srcdoc and noscript',
      inMain('<iframe title="x" srcdoc="<p>a</p>"></iframe><noscript><p>a</p></noscript>'),
      undefined,
    ],
  ];
  assert.deepEqual(
    cases.map(([name, html]) => [
      name,
      drops(html).map((line) => /drops \d+ elements?( in an? [a-z ]+)?:/.exec(line)?.[1] ?? ''),
    ]),
    cases.map(([name, , place]) => [name, place === undefined ? [] : [place]]),
  );
  assert.deepEqual(drops(inMain('<script src="/x.js">')), [
    'html-shell / the parser drops 3 elements: an element is not closed, so no rule can read the page in full',
  ]);
});

// Hostile input

const SHELL_RULES: readonly Rule[] = [
  auditSpeculationBlock,
  auditModesScript,
  auditModesSwitch,
  auditCspMeta,
  auditCspHash,
  auditCspBase,
  auditHtmlShell,
];

/** Pages of `SWITCH_OPTIONS` that are large, deep or odd. */
function hostileFiles(): Record<string, string> {
  const deep = `${'<div>'.repeat(5000)}<input type="radio" name="mode" value="auto">${'</div>'.repeat(5000)}`;
  const big = `<h1>Titel</h1> ${'<p class="a">Lorem ipsum dolor sit amet, <a href="/x/">mehr</a>.</p>'.repeat(30000)}`;
  const odd =
    '<h1 constructor="x" __proto__="y" hasOwnProperty="z">Ti\ud800tel\u0000</h1> <svg constructor="1"><title>\ud800</title></svg> <script constructor="1">\u0000</script> <base constructor="x">';
  const radios = `<fieldset data-mode-switch><legend>x</legend>${'<label><input type="radio" name="mode" value="auto">a</label>'.repeat(20000)}</fieldset>`;
  return {
    ...ICON_FILES,
    'index.html': switchHome({ main: deep }),
    'big/index.html': switchHome({ main: big }),
    'odd/index.html': switchHome({
      main: odd,
      head: '<meta constructor="x" http-equiv="content-security-policy" content="x">',
    }),
    'radios/index.html': withSwitch(radios),
    'bytes/index.html': '\u0000\ud800<html \u0000><<<>>>&#xD800;',
  };
}

test('shell rules: a deep, a large and an odd page give a stable result fast and never throw', () => {
  const started = performance.now();
  const first = findings(runFiles(SHELL_RULES, hostileFiles(), { options: SWITCH_OPTIONS }));
  const second = findings(runFiles(SHELL_RULES, hostileFiles(), { options: SWITCH_OPTIONS }));
  assert.deepEqual(first, second);
  assert.ok(performance.now() - started < 20_000);
  assert.ok(first.some((finding) => finding.startsWith('csp-meta /odd/ 2 CSP metas')));
  assert.ok(first.some((finding) => finding.startsWith('csp-base /odd/')));
  assert.ok(first.some((finding) => finding.startsWith('modes-switch /radios/ the option auto 20000 times')));
});

// Review cases of part 5b

/** The page with its CSP meta moved from the head to the start of `main`. */
function metaInMain(html: string, content: string): string {
  const meta = `<meta http-equiv="content-security-policy" content="${content}">`;
  return swap(swap(html, meta, ''), '<main id="content">', `<main id="content">${meta}`);
}

test('csp-meta fails a CSP meta outside head, which a browser ignores; the same meta in head passes', () => {
  const off = page(NO_SPECULATION, '/');
  const content = cspContent(NO_SPECULATION, { styles: [PAGE_CSS] });
  assert.deepEqual(ids(run([auditCspMeta, auditCspHash], off, NO_SPECULATION)), []);
  assert.deepEqual(ids(run([auditCspMeta, auditCspHash], metaInMain(off, content), NO_SPECULATION)), ['csp-meta']);
  // A second meta outside head beside the one in head is a problem too, once for the page.
  const extra = swap(
    off,
    '<main id="content">',
    `<main id="content"><meta http-equiv="Content-Security-Policy" content="${content}">`,
  );
  assert.deepEqual(ids(run([auditCspMeta, auditCspHash], extra, NO_SPECULATION)), ['csp-meta']);
});

test('csp-meta: a CSP meta written in a textarea is text, not a second meta', () => {
  const html = home({
    main: '<h1>x</h1> <label>Code <textarea><meta http-equiv="content-security-policy" content="x"></textarea></label>',
  });
  assert.deepEqual(ids(run([auditCspMeta, auditCspHash], html)), []);
});

test('csp-meta: a policy of 150,000 directives fails once and never throws', () => {
  const huge = `${CSP}${' script-src *;'.repeat(150_000)}`;
  const report = run(auditCspMeta, swap(home(), CSP, huge));
  assert.deepEqual(ids(report), ['csp-meta']);
  assert.equal(report.findings.length, 1);
});

test('modes-script: a copy of the mode script with attributes fails with two or more options', () => {
  const text = modeScript(SWITCH_OPTIONS);
  assert.deepEqual(ids(run(auditModesScript, switchHome(), SWITCH_OPTIONS)), []);
  for (const copy of [`<script data-x>${text}</script>`, `<script type="module">${text}</script>`]) {
    const html = switchHome({ main: `<h1>x</h1> ${copy}` });
    assert.deepEqual(ids(run(auditModesScript, html, SWITCH_OPTIONS)), ['modes-script'], copy);
  }
});

test('modes-switch: a switch in a template is no switch; one more in a template is no second one', () => {
  const html = switchHome();
  const control = modeSwitch(SWITCH_OPTIONS, 'de');
  const wrapped = swap(html, control, `<template>${control}</template>`);
  assert.deepEqual(ids(run(auditModesSwitch, wrapped, SWITCH_OPTIONS)), ['modes-switch']);
  const extra = swap(html, '<main id="content">', `<main id="content"><template>${control}</template>`);
  assert.deepEqual(ids(run(auditModesSwitch, extra, SWITCH_OPTIONS)), []);
});

test('html-shell: a link in a template before the skip link is not focusable; one in a pre is', () => {
  const template = swap(home(), '<body> ', '<body> <template><a href="/x/">x</a></template> ');
  assert.deepEqual(ids(run(auditHtmlShell, template)), []);
  const pre = swap(home(), '<body> ', '<body> <pre><a href="/x/">x</a></pre> ');
  assert.deepEqual(ids(run(auditHtmlShell, pre)), ['html-shell']);
});

test('html-shell: the skip link fragment is percent-decoded: an element with the decoded id outside main fails', () => {
  const encoded = swap(home({ footer: '<footer id="café">x</footer>' }), 'href="#content"', 'href="#caf%C3%A9"');
  assert.deepEqual(ids(run(auditHtmlShell, encoded)), ['html-shell']);
  const matched = swap(encoded, '<main id="content">', '<main id="café">');
  assert.deepEqual(ids(run(auditHtmlShell, swap(matched, '<footer id="café">', '<footer>'))), []);
});

test('csp-hash reads a script in a pre and in a template; csp-base reads a base in a pre and in a template', () => {
  for (const wrap of [(x: string) => `<pre>${x}</pre>`, (x: string) => `<template>${x}</template>`]) {
    const script = home({ main: `<h1>x</h1> ${wrap('<script>alert(1)</script>')}` });
    assert.deepEqual(ids(run(auditCspHash, script)), ['csp-hash'], wrap('script'));
    const base = home({ main: `<h1>x</h1> ${wrap('<base href="https://evil.example/">')}` });
    assert.deepEqual(ids(run(auditCspBase, base)), ['csp-base'], wrap('base'));
  }
});

test('modes-switch: a switch of 150,000 radios with other values fails once and never throws', () => {
  const radios = Array.from({ length: 150_000 }, (_, index) => `<input type="radio" name="mode" value="v${index}">`);
  const html = swap(switchHome(), '<legend>Darstellung</legend>', `<legend>Darstellung</legend>${radios.join('')}`);
  const report = run(auditModesSwitch, html, SWITCH_OPTIONS);
  assert.deepEqual(ids(report), ['modes-switch']);
  assert.equal(report.findings.length, 1);
});

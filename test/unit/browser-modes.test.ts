import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { chooseOrder, designColor, modesBehavior } from '../../src/browser/color.ts';
import type { BrowserRule } from '../../src/browser/harness.ts';
import type { Design } from '../../src/context.ts';
import { modeScheme, renderTokens } from '../../src/design/tokens.ts';
import { modeScript } from '../../src/modes.ts';
import type { Options } from '../../src/options.ts';
import { BODY, CSS, findingsOf, html, useBrowser } from './browser-fixtures.ts';
import { DESIGN, DESIGN_TEXT, designOf, SWITCH } from './css-rules-fixtures.ts';

const browser = useBrowser();

/** The details of the findings of one run, each with its `where` in front. */
async function placesOf(
  files: Record<string, string>,
  rule: BrowserRule,
  parts: { settings?: Options; design?: Design } = {},
): Promise<string[]> {
  const findings = await findingsOf(browser(), files, [rule], parts);
  return findings.map((finding) => `${finding.where} ${finding.detail ?? ''}`);
}

/** The settings with the switch: auto, light and dark. */
const MODES: Options = SWITCH;

/** The kit's `css/base.css`: its floor hides the mode switch while `html` has no `data-mode` (7.6). */
const BASE_CSS = readFileSync(new URL('../../css/base.css', import.meta.url), 'utf8');

// modes-behavior

/** The mode switch of 9.3 for the options auto, light and dark, inside a `details`. */
const RADIOS =
  '<details class="switch" data-mode-switch><summary>Darstellung</summary><fieldset><legend>Modus</legend>' +
  '<label><input type="radio" name="mode" value="auto"> Automatisch</label>' +
  '<label><input type="radio" name="mode" value="light"> Hell</label>' +
  '<label><input type="radio" name="mode" value="dark"> Dunkel</label></fieldset></details>';

/** The same switch with a select. */
const SELECT =
  '<div data-mode-switch><label for="mode">Darstellung</label><select id="mode" name="mode">' +
  '<option value="auto">Automatisch</option><option value="light">Hell</option><option value="dark">Dunkel</option>' +
  '</select></div>';

/** The CSS of a mode page: the kit floor, the tokens for the switch, and large controls. */
const MODE_CSS = `${BASE_CSS}${renderTokens(DESIGN, MODES)}${CSS}input,select{min-inline-size:44px;min-block-size:44px}`;

interface ModePage {
  switch?: string;
  css?: string;
  /** The script in the head. The default is the kit mode script. */
  script?: string;
  /** Leaves out `css/base.css`. */
  noBase?: boolean;
}

/** A page with the mode script in the head, the switch before the content, and the tokens for `MODES`. */
const modePage = (parts: ModePage = {}): string =>
  html(`${parts.switch ?? RADIOS}${BODY}`, {
    css: `${parts.noBase === true ? MODE_CSS.replace(BASE_CSS, '') : MODE_CSS}${parts.css ?? ''}`,
    head: `<script>${parts.script ?? modeScript(MODES)}</script>`,
  });

/** The home and a second page, so the last choice can survive a navigation. */
const modeSite = (parts: ModePage = {}, other: string = modePage()): Record<string, string> => ({
  'index.html': modePage(parts),
  'a/index.html': other,
});

const modePlaces = (files: Record<string, string>): Promise<string[]> =>
  placesOf(files, modesBehavior, { settings: MODES });

test('modes-behavior: the order of the choices puts the default mode first', () => {
  assert.deepEqual(chooseOrder(['auto', 'light', 'dark', 'contrast'], 'auto'), ['auto', 'light', 'dark', 'contrast']);
  assert.deepEqual(chooseOrder(['light', 'dark', 'contrast'], 'dark'), ['dark', 'light', 'contrast']);
  assert.deepEqual(chooseOrder(['light', 'dark'], 'dark'), ['dark', 'light']);
});

test('modes-behavior: a design value takes the fallback of its theme and resolves an alias', () => {
  const design = designOf(
    DESIGN_TEXT.replace('| `--color-accent` | `#7a3d00` | `#ffd08a` |', '| `--color-accent` | `var(--color-link)` | |'),
  );
  assert.equal(designColor(design, '--color-accent', 'light'), '#0b4f9c');
  // The empty dark cell takes the light cell: the alias, read in the dark theme.
  assert.equal(designColor(design, '--color-accent', 'dark'), '#9cc8ff');
  assert.equal(designColor(design, '--color-accent', 'dark-contrast'), '#9cc8ff');
  assert.equal(designColor(design, '--color-nothing', 'light'), undefined);
  // A circle that a hostile design could hold ends.
  const circle: Pick<Design, 'colors'> = {
    colors: [
      { name: '--color-a', values: { light: 'var(--color-b)' }, line: 1 },
      { name: '--color-b', values: { light: 'var(--color-a)' }, line: 2 },
    ],
  };
  assert.equal(designColor(circle, '--color-a', 'light'), undefined);
  // A valid chain longer than 32 aliases resolves: the parser accepts any length.
  const chain: Pick<Design, 'colors'> = {
    colors: [
      ...Array.from({ length: 40 }, (_, at) => ({
        name: `--color-c${at}`,
        values: { light: `var(--color-c${at + 1})` },
        line: at + 1,
      })),
      { name: '--color-c40', values: { light: '#123456' }, line: 41 },
    ],
  };
  assert.equal(designColor(chain, '--color-c0', 'light'), '#123456');
  assert.equal(modeScheme(DESIGN, 'auto'), 'light dark');
  assert.equal(modeScheme(DESIGN, 'dark'), 'dark');
});

test('modes-behavior: a switch in a details and a switch with a select pass', async () => {
  assert.deepEqual(await modePlaces(modeSite()), []);
  assert.deepEqual(await modePlaces(modeSite({ switch: SELECT }, modePage({ switch: SELECT }))), []);
});

test('modes-behavior: with fewer than two options the rule has nothing to check', async () => {
  assert.deepEqual(await placesOf({ 'index.html': html(BODY, { css: CSS }) }, modesBehavior), []);
});

test('modes-behavior: a color token changed under data-mode="dark" fails in each system state', async () => {
  const findings = await modePlaces(modeSite({ css: ':root[data-mode="dark"]{--color-page:#ff0000}' }));
  const shown = '--color-page paints [255, 0, 0, 255], the dark value of docs/design.md paints [17, 17, 17, 255]';
  const expected = ['1280×800', '390×844'].flatMap((size) =>
    [
      'system light, contrast no-preference',
      'system dark, contrast no-preference',
      'system light, contrast more',
      'system dark, contrast more',
    ].map((system) => `/ ${size}, dark chosen, ${system}: ${shown}`),
  );
  assert.deepEqual(findings, expected);
});

test('modes-behavior: a switch whose choice does not set data-mode fails', async () => {
  // The script sets the default mode and checks its radio, but it never reads the switch.
  const deaf = "document.documentElement.dataset.mode = 'auto';";
  const findings = await modePlaces(modeSite({ script: deaf }, modePage({ script: deaf })));
  assert.ok(findings.includes('/ 1280×800: after the choice of light, html has data-mode "auto"'), findings.join('\n'));
  assert.ok(findings.includes('/ 390×844: after the choice of dark, html has data-mode "auto"'));
  assert.ok(findings.includes('/ 390×844: after a reload, html has data-mode "auto", not dark'));
});

test('modes-behavior: a mode script that runs after the body exists fails', async () => {
  const late =
    "document.addEventListener('DOMContentLoaded', () => { document.documentElement.dataset.mode = 'auto'; });";
  const findings = await modePlaces(modeSite({ script: `${modeScript(MODES)}`.replace('apply();\n', '') + late }));
  assert.ok(findings.includes('/ 1280×800: data-mode appears on html only after body exists'), findings.join('\n'));
  assert.ok(findings.includes('/ 390×844: data-mode appears on html only after body exists'));
});

test('modes-behavior: a choice lost on the next page fails', async () => {
  const findings = await modePlaces(modeSite({}, modePage({ script: '' })));
  assert.deepEqual(findings, [
    '/ 1280×800: after a navigation to /a/, html has data-mode null, not dark',
    '/ 1280×800: after a navigation to /a/, the switch does not show dark',
    '/ 1280×800: after a reload, html has data-mode null, not dark',
    '/ 1280×800: after a reload, the switch does not show dark',
    '/ 390×844: after a navigation to /a/, html has data-mode null, not dark',
    '/ 390×844: after a navigation to /a/, the switch does not show dark',
    '/ 390×844: after a reload, html has data-mode null, not dark',
    '/ 390×844: after a reload, the switch does not show dark',
  ]);
});

test('modes-behavior: a next page that resets the mode on a timer after its load gives the fixed finding', async () => {
  // The next page restores the choice at once, then sets it back to light 500 ms later.
  const reset = `${modeScript(MODES)};setTimeout(() => { document.documentElement.dataset.mode = 'light'; }, 500);`;
  assert.deepEqual(await modePlaces(modeSite({}, modePage({ script: reset }))), [
    '/ 1280×800: the page changes data-mode by itself',
    '/ 390×844: the page changes data-mode by itself',
  ]);
});

test('modes-behavior: the navigation goes to a content page before the 404 page', async () => {
  // The 404 page sorts first and has no mode script; the content page keeps the choice.
  const files = { ...modeSite(), '404.html': modePage({ script: '' }) };
  assert.deepEqual(await modePlaces(files), []);
  // Without a content page the 404 page is the other page.
  assert.deepEqual((await modePlaces({ 'index.html': modePage(), '404.html': modePage({ script: '' }) })).slice(0, 2), [
    '/ 1280×800: after a navigation to /404, html has data-mode null, not dark',
    '/ 1280×800: after a navigation to /404, the switch does not show dark',
  ]);
});

test('modes-behavior: a hidden switch, a hidden invoker and a popover without an invoker fail', async () => {
  const hidden = { switch: SELECT, css: '[data-mode-switch]{visibility:hidden}' };
  assert.deepEqual(await modePlaces(modeSite(hidden)), [
    '/ 1280×800: the mode switch is not visible',
    '/ 390×844: the mode switch is not visible',
  ]);
  assert.deepEqual(await modePlaces(modeSite({ css: '.switch>summary{visibility:hidden}' })), [
    '/ 1280×800: summary "Darstellung", the invoker of details.switch, is not visible',
    '/ 390×844: summary "Darstellung", the invoker of details.switch, is not visible',
  ]);
  const popover = `<div id="panel" popover>${RADIOS.replace('<details class="switch" data-mode-switch><summary>Darstellung</summary>', '<div data-mode-switch>').replace('</details>', '</div>')}</div>`;
  assert.deepEqual(await modePlaces(modeSite({ switch: popover })), [
    '/ 1280×800: no native invoker opens div#panel',
    '/ 390×844: no native invoker opens div#panel',
  ]);
  // With its invoker, the popover opens and the switch works; so does a modal dialog with its invoker.
  const invoked = `<button type="button" popovertarget="panel">Darstellung</button>${popover}`;
  assert.deepEqual(await modePlaces(modeSite({ switch: invoked })), []);
  const dialog = invoked
    .replace('popovertarget="panel"', 'commandfor="panel" command="show-modal"')
    .replace('<div id="panel" popover>', '<dialog id="panel">')
    .replace('</div></div>', '</div></dialog>');
  assert.deepEqual(await modePlaces(modeSite({ switch: dialog })), []);
});

test('modes-behavior: a color-scheme that differs from 7.7 fails', async () => {
  const findings = await modePlaces(modeSite({ css: ':root[data-mode="light"]{color-scheme:light dark}' }));
  assert.ok(
    findings.includes(
      '/ 1280×800, light chosen, system dark, contrast no-preference: html has color-scheme "light dark", 7.7 expects "light"',
    ),
    findings.join('\n'),
  );
  // The scheme is wrong in every system state; the colors only where the system is dark.
  assert.equal(findings.filter((finding) => finding.includes('html has color-scheme "light dark"')).length, 8);
  assert.ok(findings.every((finding) => finding.includes(', light chosen, system ')));
  assert.ok(
    findings.every((finding) => finding.includes('color-scheme') || finding.includes('light chosen, system dark')),
  );
});

test('modes-behavior: with JS off a visible mode control fails, and so do colors other than those of D', async () => {
  // Without the floor of `css/base.css` the select shows with JS off.
  const visible = await modePlaces(modeSite({ switch: SELECT, noBase: true }, modePage({ switch: SELECT })));
  assert.deepEqual(visible, [
    '/ 1280×800 with JS off: the control select#mode is visible',
    '/ 390×844 with JS off: the control select#mode is visible',
  ]);
  const colors = await modePlaces(modeSite({ css: ':root:not([data-mode]){--color-text:#ff0000}' }));
  assert.equal(colors.length, 8);
  assert.ok(colors.every((finding) => / with JS off, system .*: --color-text paints \[255, 0, 0, 255\]/.test(finding)));
});

/** The radios of `RADIOS` without their `details`. */
const RADIO_SET = RADIOS.replace('<details class="switch" data-mode-switch><summary>Darstellung</summary>', '').replace(
  '</details>',
  '',
);

test('modes-behavior: a dialog that is a popover opens through its popover invokers', async () => {
  const panel = `<dialog id="p" popover data-mode-switch>${RADIO_SET}</dialog>`;
  const target = `<button type="button" popovertarget="p">Darstellung</button>${panel}`;
  assert.deepEqual(await modePlaces(modeSite({ switch: target })), []);
  const command = `<button type="button" commandfor="p" command="toggle-popover">Darstellung</button>${panel}`;
  assert.deepEqual(await modePlaces(modeSite({ switch: command })), []);
});

test('modes-behavior: the invoker is the first visible one that opens; a close button is none', async () => {
  const close = '<button type="button" popovertarget="p" popovertargetaction="hide">Schliessen</button>';
  const panel = `<div id="p" popover data-mode-switch>${close}${RADIO_SET}</div>`;
  assert.deepEqual(
    await modePlaces(modeSite({ switch: `${panel}<button type="button" popovertarget="p">Darstellung</button>` })),
    [],
  );
  // Two open buttons, the first one hidden: the second one opens the switch.
  const hidden = '<button type="button" popovertarget="p" hidden>Versteckt</button>';
  const both = `${hidden}${panel}<button type="button" popovertarget="p">Darstellung</button>`;
  assert.deepEqual(await modePlaces(modeSite({ switch: both })), []);
  // Only a close button: no native invoker opens the switch.
  assert.deepEqual(await modePlaces(modeSite({ switch: panel })), [
    '/ 1280×800: no native invoker opens div#p',
    '/ 390×844: no native invoker opens div#p',
  ]);
});

test('modes-behavior: a transition of the page never reaches the probes', async () => {
  const wrong = ':root[data-mode="dark"]{--color-shadow:#ff000099}';
  const shown = '--color-shadow paints [255, 0, 0, 153], the dark value of docs/design.md paints [0, 0, 0, 153]';
  for (const transition of ['', '*{transition:color 1s,background-color 1s}']) {
    const findings = await modePlaces(modeSite({ css: `${wrong}${transition}` }));
    assert.equal(findings.length, 8, findings.join('\n'));
    assert.ok(findings.every((finding) => finding.includes(`, dark chosen, system `) && finding.endsWith(shown)));
  }
  // A wrong first token blames that token only.
  const first = await modePlaces(
    modeSite({ css: ':root[data-mode="dark"]{--color-page:#ff0000}*{transition:background-color 1s}' }),
  );
  assert.equal(first.length, 8);
  assert.ok(first.every((finding) => finding.includes(': --color-page paints [255, 0, 0, 255]')));
});

test('modes-behavior: a page that writes data-mode by itself gives one fixed finding for each viewport', async () => {
  const writer = "setInterval(() => { document.documentElement.dataset.mode = 'light'; }, 25);";
  const page = html(`${RADIOS}${BODY}`, {
    css: MODE_CSS,
    head: `<script>${modeScript(MODES)}</script><script src="/writer.js"></script>`,
  });
  const files = { 'index.html': page, 'a/index.html': page, 'writer.js': writer };
  for (let run = 0; run < 2; run += 1) {
    assert.deepEqual(await modePlaces(files), [
      '/ 1280×800: the page changes data-mode by itself',
      '/ 390×844: the page changes data-mode by itself',
    ]);
  }
});

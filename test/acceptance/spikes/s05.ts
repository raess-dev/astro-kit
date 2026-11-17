import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import { browse, build, read, record, styles, type Page } from '../harness.ts';
import { PNG, page, project } from './project.ts';

// Project rules that try to undo the floor of base.css (7.6), at every strength a project file can have:
// a normal rule in `components`, an `!important` rule in `components`, and an unlayered `!important` rule.
function against(selector: string, declarations: string[]): string {
  const block = (indent: string, end: string): string => declarations.map((d) => `${indent}${d}${end};`).join('\n');
  return [
    `@layer components {\n  ${selector} {\n${block('    ', '')}\n  }\n`,
    `  ${selector}[data-strength="important"] {\n${block('    ', ' !important')}\n  }\n}\n`,
    `${selector}[data-strength="unlayered"] {\n${block('  ', ' !important')}\n}\n`,
  ].join('');
}

const STRENGTHS = ['normal', 'important', 'unlayered'] as const;

const each = (markup: (strength: string) => string): string => STRENGTHS.map(markup).join('');

const files = {
  'src/assets/photo.png': PNG,
  'src/styles/components/floor.css': [
    // `flex` is not the default of a `<p>`, so the control on `hidden="until-found"` can tell the rule from no rule.
    against('.shown', ['display: flex']),
    against('.mode-switch', ['display: flex']),
    against(
      '.visually-hidden',
      [
        'position: static',
        'inline-size: auto',
        'block-size: auto',
        'overflow: visible',
        'clip-path: none',
        'white-space: normal',
      ],
    ),
    against('.plain:focus-visible', ['outline-style: none']),
    against('.short:focus-visible', ['outline: none']),
    against('.zero:focus-visible', ['outline: 0']),
    against(
      '.mover',
      ['transition: opacity 20s linear', 'animation: s05-spin 20s linear infinite', 'scroll-behavior: smooth'],
    ),
    '@layer components {\n  .mover.moved {\n    opacity: 0.5;\n  }\n}\n',
    '@keyframes s05-spin {\n  to {\n    rotate: 1turn;\n  }\n}\n',
  ].join('\n'),
  'src/pages/index.astro': page(
    'Floor',
    [
      each((s) => `<p hidden class="shown" id="hidden-${s}" data-strength="${s}">hidden</p>`),
      // The test sets an inline declaration on this one through the CSSOM. The page CSP would not apply a `style`
      // attribute of the markup, so an attribute would test nothing.
      '<p hidden class="shown" id="hidden-inline">hidden</p>',
      '<p hidden="until-found" id="found-plain">found</p>',
      '<p hidden="until-found" class="shown" id="found-rule">found</p>',
      each((s) => `<div data-mode-switch class="mode-switch" id="switch-${s}" data-strength="${s}">switch</div>`),
      each((s) => `<span class="visually-hidden" id="vh-${s}" data-strength="${s}">Text for a screen reader</span>`),
      '<a class="visually-hidden" id="skip" href="#main">Skip to the content</a>',
      each((s) => `<a class="plain" id="plain-${s}" data-strength="${s}" href="#main">link</a>`),
      each((s) => `<a class="short" id="short-${s}" data-strength="${s}" href="#main">link</a>`),
      each((s) => `<a class="zero" id="zero-${s}" data-strength="${s}" href="#main">link</a>`),
      '<a id="bare" href="#main">link</a>',
      '<main id="main" tabindex="-1" class="plain">Content</main>',
      each((s) => `<div class="mover" id="mover-${s}" data-strength="${s}">mover</div>`),
      '<Image src={photo} alt="" />',
    ].join(''),
    [
      "import { Image } from 'astro:assets';",
      "import photo from '../assets/photo.png';",
      "import '../styles/components/floor.css';",
    ].join('\n'),
  ),
};

/** The computed values of `properties` on the element `#id`. */
const computed = (tab: Page, id: string, properties: string[]): Promise<Record<string, string>> =>
  tab.evaluate(
    ([target, names]: [string, string[]]) => {
      const style = getComputedStyle(document.getElementById(target) as Element);
      return Object.fromEntries(names.map((name) => [name, style.getPropertyValue(name)]));
    },
    [id, properties],
  );

/** The outline of `#id` after the keyboard moved the focus to it. */
async function focused(tab: Page, id: string): Promise<{ visible: boolean; style: string; width: string }> {
  // The Tab key puts the page in keyboard modality; `focus()` then matches :focus-visible on any element.
  await tab.keyboard.press('Tab');
  await tab.focus(`#${id}`);
  return tab.evaluate((target: string) => {
    const element = document.getElementById(target) as Element;
    const style = getComputedStyle(element);
    return {
      visible: document.activeElement === element && element.matches(':focus-visible'),
      style: style.outlineStyle,
      width: style.outlineWidth,
    };
  }, id);
}

/** What moves on `#id` after the class `moved` starts its transition. */
const motion = (tab: Page, id: string): Promise<{ transition: string; animation: string; running: number }> =>
  tab.evaluate((target: string) => {
    const element = document.getElementById(target) as Element;
    void getComputedStyle(element).opacity;
    element.classList.add('moved');
    const style = getComputedStyle(element);
    const result = {
      transition: `${style.transitionProperty} ${style.transitionDuration}`,
      animation: style.animationName,
      running: element.getAnimations().length,
    };
    element.classList.remove('moved');
    return result;
  }, id);

test('S5: the floor of base.css holds against project rules, in Chromium computed styles', async () => {
  const dir = project('s05', files);
  build(dir);
  const css = styles(read(dir, 'dist/index.html'));
  // The floor is in `reset`, the second layer. Only the layer `astro` comes before it, so Astro must put no
  // `!important` there: an important declaration in an earlier layer would beat the floor.
  const astroLayer = /@layer astro\.images\{((?:[^{}]|\{[^{}]*\})*)\}/.exec(css)?.[1];
  assert.ok(astroLayer, 'the page has the astro.images layer');
  assert.equal(astroLayer.includes('!important'), false, 'Astro puts no !important in its layer');

  const { server, browser, close } = await browse(join(dir, 'dist'));
  try {
    const tab = await (await browser.newContext()).newPage();
    await tab.emulateMedia({ reducedMotion: 'no-preference' });
    await tab.goto(`${server.origin}/`);
    const display = async (id: string): Promise<string | undefined> => (await computed(tab, id, ['display'])).display;

    // [hidden]
    for (const strength of STRENGTHS) {
      assert.equal(await display(`hidden-${strength}`), 'none', `[hidden] stays hidden against a ${strength} rule`);
    }
    // An inline declaration beats every normal rule of a style sheet. Only an `!important` rule holds against it.
    const inline = await tab.evaluate(() => {
      const element = document.getElementById('hidden-inline') as HTMLElement;
      element.style.setProperty('display', 'flex');
      return element.style.display;
    });
    assert.equal(inline, 'flex', 'the element has the inline declaration display: flex');
    assert.equal(await display('hidden-inline'), 'none', '[hidden] stays hidden against an inline declaration');

    // hidden="until-found" is not caught: the browser keeps the box and hides the content.
    assert.deepEqual(await computed(tab, 'found-plain', ['display', 'content-visibility']), {
      display: 'block',
      'content-visibility': 'hidden',
    });
    assert.equal(await display('found-rule'), 'flex', 'a project display rule works on hidden="until-found"');
    // The same inline declaration works where the floor does not apply.
    const shown = await tab.evaluate(() => {
      const element = document.getElementById('found-plain') as HTMLElement;
      element.style.setProperty('display', 'flex');
      const display = getComputedStyle(element).display;
      element.style.removeProperty('display');
      return display;
    });
    assert.equal(shown, 'flex', 'an inline declaration works on hidden="until-found"');

    // The mode switch: no data-mode on html, so it is hidden at every strength.
    assert.equal(await tab.evaluate(() => document.documentElement.hasAttribute('data-mode')), false);
    for (const strength of STRENGTHS) {
      assert.equal(await display(`switch-${strength}`), 'none', `the switch stays hidden against a ${strength} rule`);
    }
    await tab.evaluate(() => document.documentElement.setAttribute('data-mode', 'auto'));
    for (const strength of STRENGTHS) {
      assert.equal(await display(`switch-${strength}`), 'flex', 'with data-mode, the project rule shows the switch');
    }
    await tab.evaluate(() => document.documentElement.removeAttribute('data-mode'));

    // .visually-hidden
    const hiddenBox = {
      position: 'absolute',
      width: '1px',
      height: '1px',
      'overflow-x': 'hidden',
      'overflow-y': 'hidden',
      'clip-path': 'inset(50%)',
      'white-space': 'nowrap',
    };
    for (const strength of STRENGTHS) {
      assert.deepEqual(await computed(tab, `vh-${strength}`, Object.keys(hiddenBox)), hiddenBox, `vh-${strength}`);
    }
    assert.equal((await computed(tab, 'skip', ['position'])).position, 'absolute', 'a skip link is hidden at rest');

    // The focus outline. `outline-style` holds; the width is not part of the floor.
    const outlines: Record<string, string> = {};
    for (const name of ['plain', 'short', 'zero']) {
      for (const strength of STRENGTHS) {
        const outline = await focused(tab, `${name}-${strength}`);
        assert.equal(outline.visible, true, `${name}-${strength} matches :focus-visible`);
        assert.equal(outline.style, 'solid', `${name}-${strength} keeps outline-style: solid`);
        outlines[`${name}-${strength}`] = outline.width;
      }
    }
    assert.deepEqual(
      outlines,
      {
        'plain-normal': '1px',
        'plain-important': '1px',
        'plain-unlayered': '1px',
        'short-normal': '3px',
        'short-important': '3px',
        'short-unlayered': '3px',
        'zero-normal': '0px',
        'zero-important': '0px',
        'zero-unlayered': '0px',
      },
      'outline-style: none keeps the 1px of the browser; outline: none gives medium; outline: 0 gives no width',
    );
    // With no project focus rule, the floor turns the `auto 1px` ring of Chromium into a solid 1px line.
    const bare = await focused(tab, 'bare');
    assert.deepEqual(bare, { visible: true, style: 'solid', width: '1px' });
    record('S5.outlineWidth', {
      'no project rule': bare.width,
      'outline-style: none': outlines['plain-normal'],
      'outline: none': outlines['short-normal'],
      'outline: 0': outlines['zero-normal'],
    });
    // A focused .visually-hidden link is not caught by the floor, so the project rule shows it.
    const skip = await focused(tab, 'skip');
    assert.equal(skip.visible, true);
    assert.equal((await computed(tab, 'skip', ['position'])).position, 'static', 'a focused skip link is shown');
    // An element with tabindex="-1" is out of the focus rule: the project rule removes its outline.
    const main = await focused(tab, 'main');
    assert.deepEqual({ visible: main.visible, style: main.style }, { visible: true, style: 'none' });

    // Motion. The control first: with no preference, the project transition and animation run.
    for (const strength of STRENGTHS) {
      assert.deepEqual(
        await motion(tab, `mover-${strength}`),
        { transition: 'opacity 20s', animation: 's05-spin', running: 2 },
        `mover-${strength} moves with no preference`,
      );
      assert.equal((await computed(tab, `mover-${strength}`, ['scroll-behavior']))['scroll-behavior'], 'smooth');
    }
    await tab.emulateMedia({ reducedMotion: 'reduce' });
    for (const strength of STRENGTHS) {
      assert.deepEqual(
        await motion(tab, `mover-${strength}`),
        { transition: 'none 0s', animation: 'none', running: 0 },
        `mover-${strength} does not move with reduced motion`,
      );
      assert.equal((await computed(tab, `mover-${strength}`, ['scroll-behavior']))['scroll-behavior'], 'auto');
    }
  } finally {
    await close();
  }
});

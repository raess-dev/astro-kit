/**
 * The shell rules of the page audit (specification, 6.1, 6.2, 9.3 and section 8): `speculation-block`,
 * `modes-script`, `modes-switch`, `csp-meta`, `csp-hash` (its built half; the source half lands in M8), `csp-base`
 * and `html-shell`. Each function is the built half of one rule and adds its findings at the page path. Every page
 * counts, `/404.html` included.
 *
 * **One finding for each page.** Each rule here reports at most one finding for a page, and its detail lists every
 * problem of the page (`listed`). `csp-hash` is the exception: it reports each inline script or style whose hash is
 * missing, because each such element is its own fact.
 *
 * **Who reports what.**
 *
 * - The CSP meta is the first `<meta>` child of `head` whose `http-equiv` is `content-security-policy` in any case
 *   (`cspMetasOf`). A page without one, or with two, is `csp-meta`'s, and so is a CSP meta outside `head`, which a
 *   browser ignores. Then `csp-hash` skips the page, and `speculation-block` and
 *   `modes-script` skip the checks that name the meta ("after the CSP meta", "right after the CSP meta").
 * - `csp-meta` checks the directives and their sources other than hashes. Which hashes a policy holds is
 *   `csp-hash`'s: one finding for each inline script or style whose hash is missing. An extra hash is no finding:
 *   Astro writes the hash of every CSS chunk of the site into every page (13.1, items 12, 13 and 41).
 * - `speculation-block` and `modes-script` check the kit's own two inserts: count, text and place. A changed or
 *   copied insert is also an inline script without its hash, so `csp-hash` reports it too: two facts, two ids.
 * - A skip link whose fragment names no element is `links-resolve`'s; `html-shell` then says nothing about the id.
 */
import { type HTMLElement, NodeType } from 'node-html-parser';
import type { BuildContext, BuiltPage } from '../../context.ts';
import {
  isForbiddenSource,
  metaDirectives,
  SPECULATION_JSON,
  STYLE_RESOURCES,
  scriptResources,
  sha256,
} from '../../csp.ts';
import { asciiLower } from '../../css/parse.ts';
import { snippet } from '../../css/rules.ts';
import { enabledModes, hasModeScript, MODE_STORAGE_KEY, modeScript } from '../../modes.ts';
import {
  attr,
  attributesOf,
  closestTag,
  collapse,
  cspMetasOf,
  decodePath,
  descendantsOf,
  domOf,
  hasAttr,
  isExecutableScript,
  labelsOf,
  type PageDom,
  type PolicyDirective,
  parseCsp,
  pushAll,
  rawContentOf,
  type ScriptKind,
  scriptKind,
  sourceOf,
  sourcesOf,
  strayCspMetasOf,
  tagOf,
  textOf,
  tokensOf,
} from '../dom.ts';

// Shared

/** The most problems that one detail names. The rest stand as a count. */
const MAX_LISTED = 6;

/** The problems of one page as one detail: `a; b; c`, with at most `MAX_LISTED` of them and the count of the rest. */
export function listed(problems: readonly string[]): string {
  const shown = problems.slice(0, MAX_LISTED);
  const rest = problems.length - shown.length;
  return rest > 0 ? `${shown.join('; ')}; and ${rest} more` : shown.join('; ');
}

/** The start tag of an element as a short detail: `<script type="x">`. */
export function startTag(page: BuiltPage, element: HTMLElement): string {
  const markup = sourceOf(page, element);
  const end = markup.indexOf('>');
  return snippet(end < 0 ? markup : markup.slice(0, end + 1));
}

/** The one CSP meta of a page, or `undefined` when the page has none or more than one (`csp-meta`'s). */
function onlyCspMeta(dom: PageDom): HTMLElement | undefined {
  const metas = cspMetasOf(dom);
  return metas.length === 1 ? metas[0] : undefined;
}

/** Adds one finding for a page when it has problems. */
function reportPage(ctx: BuildContext, id: string, page: BuiltPage, problems: readonly string[]): void {
  if (problems.length > 0) ctx.report.add(id, page.path, listed(problems));
}

// speculation-block

const SPECULATION_BLOCK = 'speculation-block';

/**
 * `speculation-block`: with `prefetch.speculationRules`, each page has exactly one `script[type=speculationrules]`
 * whose text is `SPECULATION_JSON`, after the CSP meta. With it off, a page has none. The `type` compares as HTML
 * reads it: trimmed and in any ASCII case (`scriptKind`).
 */
export function auditSpeculationBlock(ctx: BuildContext): void {
  const on = ctx.options.prefetch.speculationRules;
  for (const page of ctx.pages) {
    const dom = domOf(page);
    const blocks = dom.byTag('script').filter((script) => scriptKind(script) === 'speculationrules');
    const problems: string[] = [];
    if (!on) {
      if (blocks.length > 0) problems.push(`${blocks.length} speculation block(s); none while speculationRules is off`);
      reportPage(ctx, SPECULATION_BLOCK, page, problems);
      continue;
    }
    if (blocks.length === 0) problems.push('no speculation block');
    if (blocks.length > 1) problems.push(`${blocks.length} speculation blocks; exactly 1`);
    const changed = blocks.find((block) => rawContentOf(block) !== SPECULATION_JSON);
    if (changed !== undefined) {
      problems.push(`a speculation block whose text is not the kit's: ${snippet(rawContentOf(changed))}`);
    }
    const meta = onlyCspMeta(dom);
    if (meta !== undefined && blocks.some((block) => dom.order(block) < dom.order(meta))) {
      problems.push('a speculation block before the CSP meta');
    }
    reportPage(ctx, SPECULATION_BLOCK, page, problems);
  }
}

// modes-script

const MODES_SCRIPT = 'modes-script';

/**
 * The first two lines of every mode script: `{` and the storage key. They do not depend on the settings, so a
 * script that starts with them is a mode script, even one of other settings or one that was changed.
 */
const MODE_SCRIPT_START = `{\nconst key = '${MODE_STORAGE_KEY}';`;

/** The elements that the mode script must come before (9.3): every `<style>` and every style sheet link. */
const isStyleElement = (element: HTMLElement): boolean => {
  const tag = tagOf(element);
  return tag === 'style' || (tag === 'link' && tokensOf(element, 'rel').includes('stylesheet'));
};

/**
 * `modes-script`: with two or more mode options, each page has exactly one kit mode script, a `<script>` with no
 * attributes whose text is `modeScript(options)`. The first one is the next element after the CSP meta, and it
 * comes before every `<style>`, every `link[rel~=stylesheet]` and every speculation block. Any other script whose
 * text starts like a mode script (`MODE_SCRIPT_START`) is a problem too, also an exact copy with attributes: the page
 * would run the mode script twice. With fewer options, no page has a mode script: neither the exact text nor another
 * script that starts like one. In every case, the `html` element carries no `data-mode`.
 */
export function auditModesScript(ctx: BuildContext): void {
  const on = hasModeScript(ctx.options);
  const text = modeScript(ctx.options);
  for (const page of ctx.pages) {
    const dom = domOf(page);
    const problems: string[] = [];
    const scripts = dom.byTag('script');
    const kit = scripts.filter((script) => attributesOf(script).size === 0 && rawContentOf(script) === text);
    const lookalike = scripts.find(
      (script) => !kit.includes(script) && rawContentOf(script).startsWith(MODE_SCRIPT_START),
    );
    if (!on) {
      const any = kit[0] ?? lookalike;
      if (any !== undefined) problems.push(`a mode script with fewer than two mode options: ${startTag(page, any)}`);
    } else {
      if (kit.length === 0) {
        problems.push(
          lookalike === undefined
            ? 'no kit mode script'
            : `no kit mode script; ${startTag(page, lookalike)} has other attributes or another text`,
        );
      }
      if (kit.length > 1) problems.push(`${kit.length} kit mode scripts; exactly 1`);
      if (kit.length > 0 && lookalike !== undefined) {
        problems.push(`another script that starts like the mode script: ${startTag(page, lookalike)}`);
      }
      const first = kit[0];
      if (first !== undefined) {
        const meta = onlyCspMeta(dom);
        if (meta !== undefined && dom.order(first) !== dom.order(meta) + 1) {
          problems.push('the mode script is not the next element after the CSP meta');
        }
        const before = dom.elements
          .slice(0, dom.order(first))
          .find(
            (element) =>
              isStyleElement(element) || (tagOf(element) === 'script' && scriptKind(element) === 'speculationrules'),
          );
        if (before !== undefined) problems.push(`the mode script comes after ${startTag(page, before)}`);
      }
    }
    const html = dom.html;
    if (html !== undefined && hasAttr(html, 'data-mode')) problems.push('the html element has a data-mode attribute');
    reportPage(ctx, MODES_SCRIPT, page, problems);
  }
}

// modes-switch

const MODES_SWITCH = 'modes-switch';

/** The form controls of 9.3: "no other form control (`input`, `select`, `textarea`, `button`)". */
const CONTROLS: ReadonlySet<string> = new Set(['input', 'select', 'textarea', 'button']);

const FORM: ReadonlySet<string> = new Set(['form']);
const FIELDSET: ReadonlySet<string> = new Set(['fieldset']);

/**
 * The most radios or selects whose labels and fieldset the rule reads. A valid switch has at most four; on a
 * hostile page each label lookup walks the ancestors, so the count stays bounded. The value check reads them all.
 */
const MAX_READ = 16;

const isControl = (element: HTMLElement): boolean => CONTROLS.has(tagOf(element));
const isModeControl = (element: HTMLElement): boolean => isControl(element) && attr(element, 'name') === 'mode';
const isRadio = (element: HTMLElement): boolean =>
  tagOf(element) === 'input' && asciiLower(attr(element, 'type') ?? '') === 'radio';

/** The text of an element for a label check: its `textContent`, white space collapsed. */
const labelText = (element: HTMLElement): string => collapse(textOf(element));

/** The values of the controls against the enabled options: each option exactly once, and no other value. */
function valueProblems(values: readonly string[], modes: readonly string[]): string[] {
  const problems: string[] = [];
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  for (const mode of modes) {
    const count = counts.get(mode) ?? 0;
    if (count === 0) problems.push(`no control for the option ${mode}`);
    if (count > 1) problems.push(`the option ${mode} ${count} times`);
  }
  for (const value of counts.keys()) {
    if (!modes.includes(value)) problems.push(`the value ${JSON.stringify(snippet(value))} is no enabled option`);
  }
  return problems;
}

/** Texts that must differ: the first text that repeats, or none. */
function repeated(texts: readonly string[]): string | undefined {
  const seen = new Set<string>();
  for (const text of texts) {
    if (seen.has(text)) return text;
    seen.add(text);
  }
  return undefined;
}

/** The first child element of an element with a tag, or none. */
function childOf(element: HTMLElement, tag: string): HTMLElement | undefined {
  for (const node of element.childNodes) {
    if (node.nodeType === NodeType.ELEMENT_NODE && tagOf(node as HTMLElement) === tag) return node as HTMLElement;
  }
  return undefined;
}

/** The problems of a fieldset of radios (9.3, the first form). `within` is the switch and what it holds. */
function radioProblems(
  dom: PageDom,
  radios: readonly HTMLElement[],
  within: ReadonlySet<HTMLElement>,
  modes: readonly string[],
): string[] {
  const problems: string[] = [];
  const read = radios.slice(0, MAX_READ);
  const fieldsets = new Set(read.map((radio) => closestTag(radio, FIELDSET)));
  const [fieldset] = fieldsets;
  if (fieldsets.size !== 1 || fieldset === undefined || !within.has(fieldset)) {
    problems.push('the radios are not in one fieldset of the switch');
  } else {
    const legend = childOf(fieldset, 'legend');
    if (legend === undefined) problems.push('the fieldset has no legend');
    else if (labelText(legend) === '') problems.push('the legend has no text');
  }
  pushAll(
    problems,
    valueProblems(
      radios.map((radio) => attr(radio, 'value') ?? 'on'),
      modes,
    ),
  );
  const texts: string[] = [];
  for (const radio of read) {
    const labels = labelsOf(dom, radio);
    const value = snippet(attr(radio, 'value') ?? 'on');
    if (labels.length === 0) {
      problems.push(`the radio ${value} has no label`);
      continue;
    }
    const text = collapse(labels.map(labelText).join(' '));
    if (text === '') problems.push(`the label of the radio ${value} has no text`);
    else texts.push(text);
  }
  const twice = repeated(texts);
  if (twice !== undefined) problems.push(`two radio labels read ${JSON.stringify(snippet(twice))}`);
  return problems;
}

/** The problems of a select (9.3, the second form). */
function selectProblems(dom: PageDom, select: HTMLElement, modes: readonly string[]): string[] {
  const problems: string[] = [];
  if (hasAttr(select, 'multiple')) problems.push('the select has multiple');
  if (labelsOf(dom, select).length === 0) problems.push('the select has no label');
  const options = descendantsOf(select).filter((element) => tagOf(element) === 'option');
  // HTML: an option without `value` has its text as its value.
  pushAll(
    problems,
    valueProblems(
      options.map((option) => attr(option, 'value') ?? labelText(option)),
      modes,
    ),
  );
  const texts = options.map(labelText);
  if (texts.includes('')) problems.push('an option has no text');
  const twice = repeated(texts.filter((text) => text !== ''));
  if (twice !== undefined) problems.push(`two options read ${JSON.stringify(snippet(twice))}`);
  return problems;
}

/** The problems of the one switch element of a page with two or more options. */
function switchProblems(dom: PageDom, element: HTMLElement, modes: readonly string[]): string[] {
  const problems: string[] = [];
  if (tagOf(element) === 'form' || closestTag(element, FORM) !== undefined)
    problems.push('the switch is inside a form');
  if (isModeControl(element)) problems.push('the switch element is itself the control named mode');
  const descendants = descendantsOf(element);
  const within = new Set<HTMLElement>([element, ...descendants]);
  const inside = descendants.filter(isControl);
  const other = inside.find((control) => !isModeControl(control));
  if (other !== undefined) problems.push(`another form control inside the switch: ${startTag(dom.page, other)}`);
  const named = inside.filter(isModeControl);
  const radios = named.filter(isRadio);
  const selects = named.filter((control) => tagOf(control) === 'select');
  const wrong = named.find((control) => !isRadio(control) && tagOf(control) !== 'select');
  if (wrong !== undefined) {
    problems.push(`a control named mode that is no radio and no select: ${startTag(dom.page, wrong)}`);
  }
  const inSelect = new Set(selects.slice(0, MAX_READ).flatMap((one) => descendantsOf(one)));
  if (named.some((control) => inSelect.has(control))) problems.push('a control named mode inside the select');
  const [select] = selects;
  if (radios.length > 0 && select !== undefined) problems.push('both radios and a select named mode');
  else if (radios.length > 0) pushAll(problems, radioProblems(dom, radios, within, modes));
  else if (select !== undefined) {
    if (selects.length > 1) problems.push(`${selects.length} selects named mode; exactly 1`);
    pushAll(problems, selectProblems(dom, select, modes));
  } else problems.push('no fieldset of radios and no select named mode');
  return problems;
}

/**
 * `modes-switch` (9.3): with two or more mode options, each page has exactly one `[data-mode-switch]` element,
 * outside any `form`, that is or holds a fieldset of radios or one select, as the row of section 8 says. With fewer
 * options, no page has a `[data-mode-switch]` element or a control named `mode`.
 *
 * - A control is an `input`, `select`, `textarea` or `button`; a control named `mode` has `name="mode"` exactly.
 * - The fieldset is the one that holds every radio (`closestTag`): the switch itself or inside it. Its legend is a
 *   child `legend` with text.
 * - A radio without `value` has the value `on`, and an option without `value` its text, as in HTML.
 * - A label is a `label` element (`labelsOf`). A radio's label text is the text of its labels, collapsed. Texts
 *   compare exactly after collapsing white space.
 * - With two switches, the first one is checked, and the count is a problem.
 */
export function auditModesSwitch(ctx: BuildContext): void {
  const on = hasModeScript(ctx.options);
  const modes = enabledModes(ctx.options);
  for (const page of ctx.pages) {
    const dom = domOf(page);
    const switches = dom.elements.filter((candidate) => hasAttr(candidate, 'data-mode-switch'));
    const named = dom.elements.filter(isModeControl);
    const problems: string[] = [];
    const [element] = switches;
    if (!on) {
      if (element !== undefined) problems.push('a [data-mode-switch] element with fewer than two mode options');
      if (named.length > 0) problems.push('a control named mode with fewer than two mode options');
    } else if (element === undefined) problems.push('no [data-mode-switch] element');
    else {
      if (switches.length > 1) problems.push(`${switches.length} [data-mode-switch] elements; exactly 1`);
      const within = new Set(descendantsOf(element));
      const stray = named.find((control) => control !== element && !within.has(control));
      if (stray !== undefined) problems.push(`a control named mode outside the switch: ${startTag(page, stray)}`);
      pushAll(problems, switchProblems(dom, element, modes));
    }
    reportPage(ctx, MODES_SWITCH, page, problems);
  }
}

// csp-meta

const CSP_META = 'csp-meta';

/** A hash source of a policy: `'sha256-<base64>'`. CSP compares the algorithm name without regard to case. */
const HASH_SOURCE = /^'sha256-([A-Za-z0-9+/_-]+={0,2})'$/i;

/** The hash of a hash source, as `sha256` writes one (`sha256-…`), or `undefined` for another source. */
function hashOf(source: string): string | undefined {
  const base64 = HASH_SOURCE.exec(source)?.[1];
  return base64 === undefined ? undefined : `sha256-${base64}`;
}

/** The directives that the kit's policy holds, each with its sources in ASCII lower case. */
function expectedPolicy(ctx: BuildContext): ReadonlyMap<string, ReadonlySet<string>> {
  const expected = new Map<string, ReadonlySet<string>>();
  for (const directive of parseCsp(metaDirectives(ctx.options).join(';'))) {
    expected.set(directive.name, new Set(directive.sources.map(asciiLower)));
  }
  expected.set('script-src', new Set(scriptResources(ctx.options).map(asciiLower)));
  expected.set('style-src', new Set(STYLE_RESOURCES.map(asciiLower)));
  return expected;
}

/** The directives of CSP Level 3 whose values are source lists, beyond those that end in `-src`. */
const SOURCE_LISTS: ReadonlySet<string> = new Set(['form-action', 'base-uri', 'frame-ancestors']);

/** Says whether a directive holds sources (a `report-uri` or `sandbox` value is none). */
const isSourceList = (name: string): boolean => name.endsWith('-src') || SOURCE_LISTS.has(name);

/** Directives whose hash sources are allowed. Which hashes they hold is `csp-hash`'s. */
const HASHED: ReadonlySet<string> = new Set(['script-src', 'style-src']);

/** The problems of a policy against the kit's directives (6.2), compared as sets. */
function policyProblems(
  ctx: BuildContext,
  policy: readonly PolicyDirective[],
  expected: ReadonlyMap<string, ReadonlySet<string>>,
): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const directive of policy) {
    if (seen.has(directive.name)) {
      problems.push(`${directive.name} twice`);
      continue;
    }
    seen.add(directive.name);
    const sources = expected.get(directive.name);
    if (sources === undefined) {
      problems.push(`the directive ${snippet(directive.name)}, which the kit does not write`);
      continue;
    }
    const found = new Set<string>();
    for (const source of directive.sources) {
      if (HASHED.has(directive.name) && hashOf(source) !== undefined) continue;
      found.add(asciiLower(source));
    }
    for (const source of sources) if (!found.has(source)) problems.push(`${directive.name} lacks ${source}`);
    for (const source of found) {
      // A forbidden source is named once, below.
      if (!sources.has(source) && !isForbiddenSource(source, ctx.options)) {
        problems.push(`${directive.name} has ${snippet(source)}`);
      }
    }
  }
  for (const name of expected.keys()) if (!seen.has(name)) problems.push(`no ${name}`);
  const forbidden = new Set<string>();
  for (const directive of policy) {
    if (!isSourceList(directive.name)) continue;
    for (const source of directive.sources) if (isForbiddenSource(source, ctx.options)) forbidden.add(source);
  }
  for (const source of forbidden) problems.push(`the forbidden source ${snippet(source)}`);
  return problems;
}

/**
 * `csp-meta`: each page has exactly one CSP meta (`cspMetasOf`), no executable script before it in document order
 * (`isExecutableScript`, inline or with `src`; a JSON-LD block is none), and a policy with exactly the directives of
 * 6.2 for the settings: those of `metaDirectives`, `script-src` with `scriptResources` and hashes, and `style-src`
 * with `'self'` and hashes. Each directive stands once; names and sources compare as sets, in ASCII lower case, not
 * in the order of the text. No source of a source-list directive is forbidden (`isForbiddenSource`). A CSP meta
 * that is not a child of `head` is a problem: HTML ignores it, so the page has no policy from it. A meta in `head`
 * that is missing or doubled is the only other problem reported for its page.
 */
export function auditCspMeta(ctx: BuildContext): void {
  const expected = expectedPolicy(ctx);
  for (const page of ctx.pages) {
    const dom = domOf(page);
    const metas = cspMetasOf(dom);
    const [meta] = metas;
    const stray = strayCspMetasOf(dom)[0];
    const outside =
      stray === undefined ? [] : [`a CSP meta outside head, which a browser ignores: ${startTag(page, stray)}`];
    if (meta === undefined || metas.length > 1) {
      const count = meta === undefined ? 'no CSP meta' : `${metas.length} CSP metas; exactly 1`;
      reportPage(ctx, CSP_META, page, [count, ...outside]);
      continue;
    }
    const problems: string[] = [...outside];
    const script = dom
      .byTag('script')
      .find((element) => isExecutableScript(element) && dom.order(element) < dom.order(meta));
    if (script !== undefined) problems.push(`an executable script before the CSP meta: ${startTag(page, script)}`);
    pushAll(problems, policyProblems(ctx, parseCsp(attr(meta, 'content') ?? ''), expected));
    reportPage(ctx, CSP_META, page, problems);
  }
}

// csp-hash

const CSP_HASH = 'csp-hash';

/** The kinds of inline script whose hash `script-src` needs (section 8). */
const HASHED_SCRIPTS: ReadonlySet<ScriptKind> = new Set<ScriptKind>([
  'classic',
  'module',
  'speculationrules',
  'importmap',
]);

/** The hashes of a directive, or of `default-src` when the policy has no such directive (CSP Level 3). */
function hashesOf(policy: readonly PolicyDirective[], name: string): ReadonlySet<string> {
  const sources = sourcesOf(policy, name) ?? sourcesOf(policy, 'default-src') ?? [];
  const hashes = new Set<string>();
  for (const source of sources) {
    const hash = hashOf(source);
    if (hash !== undefined) hashes.add(hash);
  }
  return hashes;
}

/**
 * `csp-hash`, built half: on each page with one CSP meta, every inline script (no `src`) of a kind that runs or that
 * the browser reads as rules (classic, module, `speculationrules`, `importmap`) has the hash of its text in
 * `script-src`, and every `<style>` has the hash of its text in `style-src`. The text is the element's content as the
 * page writes it (`rawContentOf`), the text that a browser hashes. A policy without `script-src` or `style-src` falls
 * back to `default-src`, as a browser does. One finding for each element whose hash is missing. Template content
 * counts too (`PageDom.inert`): a script can put it into the page, and the policy applies to it then.
 */
export function auditCspHash(ctx: BuildContext): void {
  for (const page of ctx.pages) {
    const dom = domOf(page);
    const meta = onlyCspMeta(dom);
    if (meta === undefined) continue;
    const policy = parseCsp(attr(meta, 'content') ?? '');
    const scripts = hashesOf(policy, 'script-src');
    const styles = hashesOf(policy, 'style-src');
    for (const element of [...dom.elements, ...dom.inert]) {
      const tag = tagOf(element);
      const inlineScript = tag === 'script' && !hasAttr(element, 'src') && HASHED_SCRIPTS.has(scriptKind(element));
      if (!inlineScript && tag !== 'style') continue;
      const hashes = inlineScript ? scripts : styles;
      if (hashes.has(sha256(rawContentOf(element)))) continue;
      const directive = inlineScript ? 'script-src' : 'style-src';
      ctx.report.add(
        CSP_HASH,
        page.path,
        `${startTag(page, element)} has no hash in ${directive}: ${snippet(rawContentOf(element))}`,
      );
    }
  }
}

// csp-base

/**
 * `csp-base`: no `<base>` element, also none in template content (`PageDom.inert`), which a script can put into the
 * page. One finding for each page that has one.
 */
export function auditCspBase(ctx: BuildContext): void {
  for (const page of ctx.pages) {
    const dom = domOf(page);
    const base = dom.byTag('base')[0] ?? dom.inert.find((element) => tagOf(element) === 'base');
    if (base !== undefined) ctx.report.add('csp-base', page.path, startTag(page, base));
  }
}

// html-shell

const HTML_SHELL = 'html-shell';

/** The tags that are focusable by themselves in the selector of section 8. */
const FOCUSABLE_TAGS: ReadonlySet<string> = new Set(['button', 'select', 'textarea', 'summary', 'iframe']);

/**
 * Says whether an element matches the selector of `html-shell`: `a[href], area[href], button,
 * input:not([type=hidden]), select, textarea, summary, iframe, [tabindex]:not([tabindex="-1"]), [contenteditable],
 * audio[controls], video[controls]`. HTML compares the value of `type` in a selector without regard to ASCII case;
 * `tabindex` compares exactly.
 */
function isFocusable(element: HTMLElement): boolean {
  const tag = tagOf(element);
  if (FOCUSABLE_TAGS.has(tag)) return true;
  if ((tag === 'a' || tag === 'area') && hasAttr(element, 'href')) return true;
  if (tag === 'input' && asciiLower(attr(element, 'type') ?? '') !== 'hidden') return true;
  if ((tag === 'audio' || tag === 'video') && hasAttr(element, 'controls')) return true;
  const tabindex = attr(element, 'tabindex');
  if (tabindex !== undefined && tabindex !== '-1') return true;
  return hasAttr(element, 'contenteditable');
}

/**
 * `html-shell`: the first focusable element of the page (`isFocusable`, in document order) is a skip link
 * `a[href="#<id>"]` with a non-empty id, and the page has exactly one `main`, whose id is that id. The id of `main`
 * may equal the fragment as written or percent-decoded, as `links-resolve` reads a fragment. A fragment that names no
 * element at all is `links-resolve`'s; then this rule does not compare it with `main`.
 */
export function auditHtmlShell(ctx: BuildContext): void {
  for (const page of ctx.pages) {
    const dom = domOf(page);
    const problems: string[] = [];
    const first = dom.elements.find(isFocusable);
    const href = first !== undefined && tagOf(first) === 'a' ? attr(first, 'href') : undefined;
    const fragment = href?.startsWith('#') === true && href.length > 1 ? href.slice(1) : undefined;
    if (first === undefined) problems.push('no focusable element; the first one must be a skip link');
    else if (fragment === undefined)
      problems.push(`the first focusable element is ${startTag(page, first)}, not a skip link`);
    const mains = dom.byTag('main');
    const [main] = mains;
    if (mains.length !== 1 || main === undefined) problems.push(`${mains.length} main elements; exactly 1`);
    else if (fragment !== undefined) {
      const id = attr(main, 'id');
      const decoded = decodePath(fragment);
      const names = new Set([fragment, ...(decoded === undefined ? [] : [decoded])]);
      const named = [...names].some((name) => dom.byId.has(name));
      if ((id === undefined || !names.has(id)) && named) {
        problems.push(
          `the skip link names #${snippet(fragment)}, but main has ${id === undefined ? 'no id' : `the id ${snippet(id)}`}`,
        );
      }
    }
    reportPage(ctx, HTML_SHELL, page, problems);
  }
}

/**
 * The forms rules of the page audit (specification, section 8, forms): `forms-declared`, `forms-fields` and
 * `forms-safety`. `forms-binding` is a config rule of `src/hosts/cloudflare.ts`.
 *
 * **Who reports what.**
 *
 * - A form of the kit on `/404.html` is `routes-404`'s alone: `forms-declared` skips that page.
 * - `forms-declared` reads the forms whose action reaches `/api/forms/`, every same-origin POST form, and every
 *   submit control that changes a post to `/api/forms/`. `forms-fields` reads every field of every page, also
 *   outside a form, because the controls of the mode switch count too. `forms-safety` reads every page.
 * - A missing label is `forms-fields`'s. A control of the wrong kind for its declared type is `forms-declared`'s.
 */
import type { HTMLElement } from 'node-html-parser';
import type { BuildContext, BuiltPage } from '../../context.ts';
import { asciiLower } from '../../css/parse.ts';
import { EMAIL_PATTERN, NUMBER } from '../../forms/fields.ts';
import { FORM_ACTION_PREFIX, formAction, HONEYPOT, RETURN_FIELD } from '../../forms/limits.ts';
import { type Form, type FormField, fieldPlace, OPTIONS_FILE } from '../../options.ts';
import {
  ancestorsOf,
  attr,
  closestTag,
  collapse,
  descendantsOf,
  domOf,
  type HrefTarget,
  hasAttr,
  isAriaHidden,
  isHidden,
  labelsOf,
  localeOf,
  type PageDom,
  pageAt,
  resolveHref,
  siteOf,
  tagOf,
  textOf,
  tokensOf,
  wordsOf,
} from '../dom.ts';
import { FIELD_WORDS } from '../text.ts';
import { listed, startTag } from './shell.ts';

// Shared

/** The type state of each `input` that HTML knows. A missing or unknown `type` is the text state. */
const INPUT_TYPES: ReadonlySet<string> = new Set([
  'hidden',
  'text',
  'search',
  'tel',
  'url',
  'email',
  'password',
  'date',
  'month',
  'week',
  'time',
  'datetime-local',
  'number',
  'range',
  'color',
  'checkbox',
  'radio',
  'file',
  'submit',
  'image',
  'reset',
  'button',
]);

/** The `input` types that are no field: they hold no value that a visitor types or picks. */
const NO_FIELD_TYPES: ReadonlySet<string> = new Set(['hidden', 'submit', 'reset', 'button', 'image']);

/** The `input` types that submit a form or do nothing: no key of the body comes from them by the visitor. */
const BUTTON_TYPES: ReadonlySet<string> = new Set(['submit', 'reset', 'button', 'image']);

/** The tags of the controls that a form submits or that submit it. */
const CONTROL_TAGS: ReadonlySet<string> = new Set(['input', 'select', 'textarea', 'button']);

/** The type state of an `input`, as a browser computes it: the attribute in ASCII lower case, else `text`. */
export function inputType(element: HTMLElement): string {
  const type = asciiLower(attr(element, 'type') ?? '');
  return INPUT_TYPES.has(type) ? type : 'text';
}

/**
 * An enumerated attribute as HTML compares it: in ASCII lower case, and not trimmed. `''` when it is missing. A
 * browser reads `method="post "` as an invalid value, so the form sends a GET.
 */
const keyword = (element: HTMLElement, name: string): string => asciiLower(attr(element, name) ?? '');

/** A token list attribute (`autocomplete`) as HTML reads it: its tokens in ASCII lower case, one space apart. */
const tokenList = (element: HTMLElement, name: string): string => collapse(asciiLower(attr(element, name) ?? ''));

/** Says whether an element or one of its ancestors passes the test. */
const within = (element: HTMLElement, test: (each: HTMLElement) => boolean): boolean =>
  test(element) || ancestorsOf(element).some(test);

/** Says whether an element or one of its ancestors has the attribute. */
const withinAttr = (element: HTMLElement, name: string): boolean => within(element, (each) => hasAttr(each, name));

/** Says whether an element hides its own subtree from a visitor: `hidden`, `inert` or `aria-hidden="true"`. */
const hidesSubtree = (element: HTMLElement): boolean => isHidden(element) || hasAttr(element, 'inert');

/**
 * Says whether a visitor can neither see nor reach an element: it or an ancestor has `hidden`, `inert` or
 * `aria-hidden="true"`.
 */
const isConcealed = (element: HTMLElement): boolean => within(element, hidesSubtree);

/**
 * Says whether a control is disabled, as HTML decides it: it has `disabled`, or it sits in a `fieldset` with
 * `disabled` and not inside the first `legend` of that fieldset.
 */
function isDisabled(control: HTMLElement): boolean {
  if (hasAttr(control, 'disabled')) return true;
  let child = control;
  for (const ancestor of ancestorsOf(control)) {
    if (tagOf(ancestor) === 'fieldset' && hasAttr(ancestor, 'disabled')) {
      const legend = ancestor.childNodes.find(
        (node): node is HTMLElement => node.nodeType === 1 && tagOf(node as HTMLElement) === 'legend',
      );
      if (legend !== child) return true;
    }
    child = ancestor;
  }
  return false;
}

/** The tags whose content is no rendered text of a label: the controls, and the elements that render nothing. */
const UNRENDERED: ReadonlySet<string> = new Set([...CONTROL_TAGS, 'script', 'style', 'template']);

/**
 * The rendered text of an element: its text without the subtrees under `hidden`, `inert` or `aria-hidden="true"`,
 * and without the content of controls, `script`, `style` and `template`. A field's own text (a textarea's default
 * value, the options of a select) is no part of its label. `''` when the element itself hides its subtree. An
 * ancestor does not count: a label under `[inert]` keeps its words, because the label check alone skips it.
 */
function renderedText(element: HTMLElement): string {
  if (hidesSubtree(element)) return '';
  return textOf(element, {
    skip: (each) => hidesSubtree(each) || UNRENDERED.has(tagOf(each)),
  });
}

/**
 * Says whether an element is a field of `forms-fields`: an `input` that is not hidden, submit, reset, button or
 * image, a `select` or a `textarea`.
 */
function isField(element: HTMLElement): boolean {
  const tag = tagOf(element);
  if (tag === 'select' || tag === 'textarea') return true;
  return tag === 'input' && !NO_FIELD_TYPES.has(inputType(element));
}

/** A field for a detail: its start tag. */
const shownTag = (page: BuiltPage, element: HTMLElement): string => startTag(page, element);

/** The declared forms by id, as a table. An empty table without forms. */
const declaredForms = (ctx: BuildContext): ReadonlyMap<string, Form> =>
  new Map(ctx.options.features.forms ? Object.entries(ctx.options.forms ?? {}) : []);

// Forms, their controls and their posts

/** The `type` of a `button` that does not submit: any other value, and a missing one, is the submit state. */
const BUTTON_STATES: ReadonlySet<string> = new Set(['reset', 'button']);

/** Says whether a control submits its form: a `button` in the submit state, or `input[type=submit|image]`. */
function isSubmit(control: HTMLElement): boolean {
  const tag = tagOf(control);
  if (tag === 'button') return !BUTTON_STATES.has(keyword(control, 'type'));
  return tag === 'input' && (inputType(control) === 'submit' || inputType(control) === 'image');
}

/**
 * The form that owns a control, as HTML decides it: the element that its `form` attribute names, when that is a
 * `form`, else none; without the attribute, its nearest ancestor `form`.
 */
function ownerOf(dom: PageDom, control: HTMLElement): HTMLElement | undefined {
  const named = attr(control, 'form');
  if (named !== undefined) {
    const element = dom.byId.get(named);
    return element !== undefined && tagOf(element) === 'form' ? element : undefined;
  }
  return closestTag(control, FORM_TAG);
}

const FORM_TAG: ReadonlySet<string> = new Set(['form']);

/** The submit controls that a form owns, inside it or elsewhere with `form=`, in document order. */
const submitsOf = (dom: PageDom, form: HTMLElement): HTMLElement[] =>
  dom.elements.filter((element) => isSubmit(element) && ownerOf(dom, element) === form);

/**
 * Says whether a form posts its data: its `method` is `post`, or a submit control that it owns has
 * `formmethod="post"`. Both compare in ASCII lower case, without a trim, as a browser reads them.
 */
const postsData = (dom: PageDom, form: HTMLElement): boolean =>
  keyword(form, 'method') === 'post' ||
  submitsOf(dom, form).some((control) => keyword(control, 'formmethod') === 'post');

/** Says whether a target is a path under `/api/forms/` of the site, in any letter case. */
const isFormPath = (target: HrefTarget): target is Extract<HrefTarget, { kind: 'internal' }> =>
  target.kind === 'internal' && asciiLower(target.path).startsWith(FORM_ACTION_PREFIX);

/** Where a form posts: its action resolved like a link. A missing or empty action is the page itself. */
const targetOf = (page: BuiltPage, form: HTMLElement, host: string): HrefTarget =>
  resolveHref(attr(form, 'action') ?? '', page.path, host);

// forms-declared

const FORMS_DECLARED = 'forms-declared';

/** The `enctype` values that the endpoint parses (9.1, step 3). An empty value is the default, urlencoded. */
const ENCTYPES: ReadonlySet<string> = new Set(['', 'application/x-www-form-urlencoded', 'multipart/form-data']);

/** The attributes of a submit control that change where, how, in which form or without which checks a form posts. */
const OVERRIDES = ['formaction', 'formmethod', 'formenctype', 'formtarget', 'formnovalidate'] as const;

/** The attributes of a submit control that change where or how it posts: a kit post may have none of them. */
const POST_OVERRIDES = ['formaction', 'formmethod', 'formenctype', 'formtarget'] as const;

/** The path of an action of the kit: `/api/forms/<id>/`. The id is the text between the prefix and the last `/`. */
const ACTION = /^\/api\/forms\/([^/]*)\/$/;

/** A kit form of a page: the `form` element and where its action leads. */
interface KitForm {
  form: HTMLElement;
  path: string;
  query: string;
  /** `http` for an absolute action on the host with `http:`. */
  scheme: string;
}

/** The forms of a page whose action, resolved like a link, has a path that starts with `/api/forms/` in any case. */
function kitFormsOf(ctx: BuildContext, page: BuiltPage): KitForm[] {
  const { host } = siteOf(ctx);
  const out: KitForm[] = [];
  for (const form of domOf(page).byTag('form')) {
    if (attr(form, 'action') === undefined) continue;
    const target = targetOf(page, form, host);
    if (isFormPath(target)) out.push({ form, path: target.path, query: target.query, scheme: target.scheme });
  }
  return out;
}

/** The controls inside a form, in document order: `input`, `select`, `textarea` and `button`. */
const controlsOf = (form: HTMLElement): HTMLElement[] =>
  descendantsOf(form).filter((element) => CONTROL_TAGS.has(tagOf(element)));

/**
 * The controls of a form that give a field of the body: every named `input` that is not a button, every named
 * `select` and `textarea`, by name in document order. `return` and the honeypot are among them.
 */
function namedFieldsOf(controls: readonly HTMLElement[]): Map<string, HTMLElement[]> {
  const out = new Map<string, HTMLElement[]>();
  for (const control of controls) {
    const tag = tagOf(control);
    if (tag === 'button' || (tag === 'input' && BUTTON_TYPES.has(inputType(control)))) continue;
    const name = attr(control, 'name');
    if (name === undefined || name === '') continue;
    const list = out.get(name);
    if (list === undefined) out.set(name, [control]);
    else list.push(control);
  }
  return out;
}

/** The control that 9.1 gives each field type, for a detail. */
const CONTROL_OF: ReadonlyMap<string, string> = new Map([
  ['text', 'input[type=text]'],
  ['textarea', 'textarea'],
  ['email', 'input[type=email]'],
  ['tel', 'input[type=tel]'],
  ['date', 'input[type=date]'],
  ['number', 'input[type=number]'],
  ['choice', 'a select or a radio group'],
  ['consent', 'input[type=checkbox]'],
]);

/** The input type of each field type whose control is one `input`. */
const INPUT_OF: ReadonlyMap<string, string> = new Map([
  ['text', 'text'],
  ['email', 'email'],
  ['tel', 'tel'],
  ['date', 'date'],
  ['number', 'number'],
  ['consent', 'checkbox'],
]);

/** The value that an `option` submits: its `value` attribute, else its text with white space collapsed. */
const optionValue = (option: HTMLElement): string => attr(option, 'value') ?? collapse(textOf(option));

/** The problems of a list of submitted choice values against the declared options. */
function choiceProblems(
  name: string,
  values: readonly string[],
  options: readonly string[],
  select: boolean,
): string[] {
  const problems: string[] = [];
  const declared = new Set(options);
  const seen = new Map<string, number>();
  for (const value of values) seen.set(value, (seen.get(value) ?? 0) + 1);
  const missing = options.filter((option) => !seen.has(option));
  if (missing.length > 0)
    problems.push(`the field ${name} has no choice ${missing.map((v) => JSON.stringify(v)).join(', ')}`);
  for (const [value, count] of seen) {
    const allowed = declared.has(value) ? 1 : select && value === '' ? 1 : 0;
    if (allowed === 0) problems.push(`the field ${name} has the undeclared choice ${JSON.stringify(value)}`);
    else if (count > allowed) problems.push(`the field ${name} has the choice ${JSON.stringify(value)} ${count} times`);
  }
  return problems;
}

/** A number attribute equals a declared number: a valid floating-point number of HTML with the same value. */
const sameNumber = (text: string | undefined, value: number): boolean =>
  text !== undefined && NUMBER.test(text.trim()) && Number(text.trim()) === value;

/** The problems of `min` or `max` of one control. Only a number or a date field declares them. */
function rangeProblems(field: FormField, control: HTMLElement, name: 'min' | 'max'): string[] {
  const declared = field[name];
  const value = attr(control, name);
  if (declared === undefined)
    return value === undefined ? [] : [`the field ${field.name} has ${name}, but declares none`];
  if (value === undefined) return [`the field ${field.name} has no ${name}; it declares ${declared}`];
  const same = typeof declared === 'number' ? sameNumber(value, declared) : value === declared;
  return same ? [] : [`the field ${field.name} has ${name}=${JSON.stringify(value)}; it declares ${declared}`];
}

/**
 * The constraint attributes that no declaration of 5.2 can express: the endpoint checks none of them, so a browser
 * would refuse a value that the endpoint accepts, or send none. `pattern` and `step` have rules of their own.
 */
const UNDECLARED_CONSTRAINTS = ['minlength', 'multiple', 'readonly', 'disabled', 'accept'] as const;

/** The problems of `pattern`: only an `email` field has it, and its value is `EMAIL_PATTERN` (9.1). */
function patternProblems(field: FormField, control: HTMLElement): string[] {
  const pattern = attr(control, 'pattern');
  if (field.type !== 'email')
    return pattern === undefined ? [] : [`the field ${field.name} has pattern, which its type does not take`];
  if (pattern === EMAIL_PATTERN) return [];
  return [
    `the field ${field.name} has pattern=${JSON.stringify(pattern ?? '')}; an email field has pattern=${JSON.stringify(EMAIL_PATTERN)} (EMAIL_PATTERN)`,
  ];
}

/** The problems of `step`: none, `1` or `any` on a `number` field (no step is checked, 9.1), none elsewhere. */
function stepProblems(field: FormField, control: HTMLElement): string[] {
  const step = attr(control, 'step');
  if (step === undefined) return [];
  const allowed = field.type === 'number' && (asciiLower(step.trim()) === 'any' || sameNumber(step, 1));
  return allowed ? [] : [`the field ${field.name} has step=${JSON.stringify(step)}`];
}

/** The problems of the attributes of one control of a declared field. */
function attributeProblems(field: FormField, control: HTMLElement): string[] {
  const problems: string[] = [];
  const required = hasAttr(control, 'required');
  if (required !== field.required) {
    problems.push(
      `the field ${field.name} ${required ? 'has' : 'lacks'} required; it is ${field.required ? 'required' : 'optional'}`,
    );
  }
  if (field.maxLength !== undefined) {
    const text = (attr(control, 'maxlength') ?? '').trim();
    if (!/^[0-9]+$/.test(text) || Number(text) !== field.maxLength) {
      problems.push(
        `the field ${field.name} has maxlength=${JSON.stringify(attr(control, 'maxlength') ?? '')}; it declares ${field.maxLength}`,
      );
    }
  } else if (hasAttr(control, 'maxlength')) problems.push(`the field ${field.name} has maxlength, but declares none`);
  problems.push(...rangeProblems(field, control, 'min'), ...rangeProblems(field, control, 'max'));
  problems.push(...patternProblems(field, control), ...stepProblems(field, control));
  for (const name of UNDECLARED_CONSTRAINTS) {
    if (hasAttr(control, name)) problems.push(`the field ${field.name} has ${name}`);
  }
  if (!hasAttr(control, 'disabled') && isDisabled(control))
    problems.push(`the field ${field.name} is in a disabled fieldset`);
  const type = tagOf(control) === 'input' ? inputType(control) : '';
  if (type === 'checkbox' && attr(control, 'value') === '')
    problems.push(`the field ${field.name} has an empty value, so a browser never sends it`);
  if (type !== 'checkbox' && type !== 'radio') {
    const autocomplete = tokenList(control, 'autocomplete');
    if (autocomplete !== collapse(asciiLower(field.autocomplete))) {
      problems.push(
        `the field ${field.name} has autocomplete=${JSON.stringify(attr(control, 'autocomplete') ?? '')}; it declares ${JSON.stringify(field.autocomplete)}`,
      );
    }
  }
  return problems;
}

/** The problems of the controls of one declared field. */
function fieldProblems(field: FormField, controls: readonly HTMLElement[]): string[] {
  const expected = CONTROL_OF.get(field.type) ?? field.type;
  const [first] = controls;
  if (first === undefined) return [`no control for the field ${field.name} (${expected})`];
  if (field.type === 'choice') {
    const radios = controls.every((control) => tagOf(control) === 'input' && inputType(control) === 'radio');
    if (radios) {
      const problems = controls.flatMap((control) => attributeProblems(field, control));
      const values = controls.map((control) => attr(control, 'value') ?? 'on');
      return [...new Set(problems), ...choiceProblems(field.name, values, field.options ?? [], false)];
    }
    if (controls.length !== 1 || tagOf(first) !== 'select') {
      return [`the field ${field.name} has ${controls.length} controls; it needs ${expected}`];
    }
    const values = descendantsOf(first)
      .filter((element) => tagOf(element) === 'option')
      .map(optionValue);
    return [...attributeProblems(field, first), ...choiceProblems(field.name, values, field.options ?? [], true)];
  }
  if (controls.length !== 1)
    return [`the field ${field.name} has ${controls.length} controls; it needs one ${expected}`];
  const tag = tagOf(first);
  const right =
    field.type === 'textarea' ? tag === 'textarea' : tag === 'input' && inputType(first) === INPUT_OF.get(field.type);
  if (!right)
    return [`the field ${field.name} is ${tag === 'input' ? `input[type=${inputType(first)}]` : tag}, not ${expected}`];
  return attributeProblems(field, first);
}

/** The problems of the hidden `return` of a form on a page. */
function returnProblems(page: BuiltPage, controls: readonly HTMLElement[]): string[] {
  if (controls.length !== 1) return [`${controls.length} controls named ${RETURN_FIELD}; exactly 1`];
  const [control] = controls;
  if (control === undefined) return [];
  if (tagOf(control) !== 'input' || inputType(control) !== 'hidden')
    return [`${RETURN_FIELD} is not input[type=hidden]`];
  const problems: string[] = [];
  if (isDisabled(control)) problems.push(`${RETURN_FIELD} is disabled, so a browser never sends it`);
  const value = attr(control, 'value') ?? '';
  if (value !== page.path) problems.push(`${RETURN_FIELD} is ${JSON.stringify(value)}, not the page path ${page.path}`);
  return problems;
}

/** Says whether an element is the wrapper of the honeypot: `inert`, `aria-hidden="true"` and `visually-hidden`. */
const isTrapWrapper = (element: HTMLElement): boolean =>
  hasAttr(element, 'inert') && isAriaHidden(element) && tokensOf(element, 'class').includes('visually-hidden');

/** The attributes by which an element names another element by its id. */
const ID_REFERENCES = ['aria-labelledby', 'aria-describedby'] as const;

/**
 * The problems of a honeypot that something outside its wrapper names: a label of the honeypot outside the
 * wrapper, or an element outside it whose `for`, `aria-labelledby` or `aria-describedby` holds the honeypot's id.
 * Every visitor would see a label with no field.
 */
function trapReferenceProblems(dom: PageDom, trap: HTMLElement, wrapper: HTMLElement): string[] {
  const outside = (element: HTMLElement): boolean => element !== wrapper && !ancestorsOf(element).includes(wrapper);
  const problems: string[] = [];
  if (labelsOf(dom, trap).some(outside)) problems.push('a label outside the wrapper names the honeypot');
  const id = attr(trap, 'id');
  if (id !== undefined && id !== '') {
    const named = dom.elements.some(
      (element) =>
        outside(element) &&
        ID_REFERENCES.some((name) =>
          collapse(attr(element, name) ?? '')
            .split(' ')
            .includes(id),
        ),
    );
    if (named) problems.push('an element outside the wrapper names the honeypot by its id');
  }
  return problems;
}

/** The problems of the honeypot of a form. */
function honeypotProblems(dom: PageDom, form: HTMLElement, controls: readonly HTMLElement[]): string[] {
  if (controls.length !== 1) return [`${controls.length} controls named ${HONEYPOT}; exactly 1`];
  const [trap] = controls;
  if (trap === undefined) return [];
  const problems: string[] = [];
  const shape =
    tagOf(trap) === 'input' &&
    asciiLower(attr(trap, 'type') ?? '') === 'text' &&
    attr(trap, 'tabindex') === '-1' &&
    tokenList(trap, 'autocomplete') === 'off';
  if (!shape) problems.push(`the honeypot is not input[name=${HONEYPOT}][type=text][tabindex="-1"][autocomplete=off]`);
  if ((attr(trap, 'value') ?? '') !== '') problems.push('the honeypot has a value, so every post is a trap');
  const between: HTMLElement[] = [];
  for (const ancestor of ancestorsOf(trap)) {
    if (ancestor === form) break;
    between.push(ancestor);
  }
  const wrapper = between.find(isTrapWrapper);
  if (wrapper === undefined) {
    problems.push('the honeypot is not inside an inert aria-hidden="true" element with the class visually-hidden');
  } else problems.push(...trapReferenceProblems(dom, trap, wrapper));
  return problems;
}

/** The problems of the attributes of a kit form itself: its action, method, encoding, charset and checks. */
function formAttributeProblems(kit: KitForm, declared: Form | undefined): string[] {
  const { form } = kit;
  const problems: string[] = [];
  if (declared === undefined || ACTION.exec(kit.path) === null) {
    problems.push(`the action ${JSON.stringify(kit.path)} is not /api/forms/<id>/ of a declared form`);
  } else if (kit.query !== '') problems.push(`the action has the query ${JSON.stringify(kit.query)}`);
  if (kit.scheme === 'http') problems.push('the action uses http, so the form data would travel unencrypted');
  if (keyword(form, 'method') !== 'post')
    problems.push(`method is ${JSON.stringify(attr(form, 'method') ?? '')}, not post`);
  if (!ENCTYPES.has(keyword(form, 'enctype'))) {
    problems.push(`enctype ${JSON.stringify(attr(form, 'enctype') ?? '')} is neither urlencoded nor multipart`);
  }
  const charsets = collapse(attr(form, 'accept-charset') ?? '').split(' ');
  if (charsets.some((charset) => charset !== '' && asciiLower(charset) !== 'utf-8')) {
    problems.push(`accept-charset ${JSON.stringify(attr(form, 'accept-charset') ?? '')} is not utf-8`);
  }
  if (hasAttr(form, 'novalidate')) problems.push('the form has novalidate');
  if (withinAttr(form, 'inert') || withinAttr(form, 'hidden'))
    problems.push('the form is under [inert] or [hidden], so no visitor can use it');
  return problems;
}

/** The problems of one kit form on a page. */
function kitFormProblems(dom: PageDom, kit: KitForm, forms: ReadonlyMap<string, Form>): string[] {
  const { page } = dom;
  const { form } = kit;
  const id = ACTION.exec(kit.path)?.[1];
  const declared = id === undefined ? undefined : forms.get(id);
  const problems = formAttributeProblems(kit, declared);
  const controls = controlsOf(form);
  for (const control of controls) {
    if (hasAttr(control, 'form')) problems.push(`${shownTag(page, control)} has a form attribute`);
    for (const name of OVERRIDES) if (hasAttr(control, name)) problems.push(`${shownTag(page, control)} has ${name}`);
  }
  const formId = attr(form, 'id');
  if (formId !== undefined && formId !== '') {
    for (const element of dom.elements) {
      if (CONTROL_TAGS.has(tagOf(element)) && attr(element, 'form') === formId && !controls.includes(element)) {
        problems.push(`${shownTag(page, element)} outside the form names it with form=`);
      }
    }
  }
  const named = namedFieldsOf(controls);
  problems.push(...returnProblems(page, named.get(RETURN_FIELD) ?? []));
  problems.push(...honeypotProblems(dom, form, named.get(HONEYPOT) ?? []));
  if (declared === undefined) return problems;
  const names = new Set(declared.fields.map((field) => field.name));
  for (const name of named.keys()) {
    if (name !== RETURN_FIELD && name !== HONEYPOT && !names.has(name)) {
      problems.push(`the control ${JSON.stringify(name)} is no declared field of ${id}`);
    }
  }
  for (const field of declared.fields) problems.push(...fieldProblems(field, named.get(field.name) ?? []));
  return problems;
}

/** The ids of the two notes of the markup pattern (9.1). */
const NOTES = ['sent', 'not-sent'] as const;

/**
 * The problems of the two notes of a page with a kit form (9.1, the markup pattern): each exists, has
 * `tabindex="-1"` and rendered text, and sits in no form, no dialog and no honeypot wrapper. A closed `details`
 * may hold a note: a browser opens it for the fragment.
 */
function noteProblems(dom: PageDom): { missing: string[]; problems: string[] } {
  const missing: string[] = [];
  const problems: string[] = [];
  for (const id of NOTES) {
    const note = dom.byId.get(id);
    if (note === undefined) {
      missing.push(id);
      continue;
    }
    const place = within(note, (each) => tagOf(each) === 'form' || tagOf(each) === 'dialog' || isTrapWrapper(each));
    if (place) problems.push(`#${id} is inside a form, a dialog or the honeypot wrapper`);
    if ((attr(note, 'tabindex') ?? '').trim() !== '-1') problems.push(`#${id} has no tabindex="-1"`);
    if (collapse(renderedText(note)) === '') problems.push(`#${id} has no text`);
  }
  return { missing, problems };
}

/**
 * The problems of the forms of a page that are no kit form: a same-origin POST form posts to a path that no
 * handler answers, because a static site has no other POST handler. A submit control outside a kit form that sends
 * a post to `/api/forms/` with `formaction`, `formmethod`, `formenctype` or `formtarget` skips every check of the
 * kit form.
 */
function otherPostProblems(ctx: BuildContext, dom: PageDom, kits: readonly KitForm[]): string[] {
  const { page } = dom;
  const { host } = siteOf(ctx);
  const kitForms = new Set(kits.map((kit) => kit.form));
  const problems: string[] = [];
  for (const form of dom.byTag('form')) {
    if (kitForms.has(form) || !postsData(dom, form)) continue;
    const target = targetOf(page, form, host);
    if (target.kind !== 'internal' || (page.is404 && isFormPath(target))) continue;
    problems.push(
      `${shownTag(page, form)} posts to ${target.path}; only /api/forms/<id>/ of a declared form answers a POST`,
    );
  }
  if (page.is404) return problems;
  for (const control of dom.elements) {
    if (!isSubmit(control) || !POST_OVERRIDES.some((name) => hasAttr(control, name))) continue;
    const owner = ownerOf(dom, control);
    if (owner !== undefined && kitForms.has(owner)) continue;
    const action = attr(control, 'formaction');
    const target =
      action !== undefined
        ? resolveHref(action, page.path, host)
        : owner === undefined
          ? undefined
          : targetOf(page, owner, host);
    if (target !== undefined && isFormPath(target)) {
      problems.push(`${shownTag(page, control)} changes a post to ${target.path}`);
    }
  }
  return problems;
}

/**
 * `forms-declared`: each kit form of a page other than `/404.html` posts to a declared form and renders it as
 * declared (section 8). One finding for each form with problems, at the page, whose detail starts with the start
 * tag of the form. A page with a kit form and without the elements `#sent` and `#not-sent` is one more finding at
 * the page, and the notes that break the markup pattern one more. A same-origin POST form that is no kit form, and
 * a submit control that changes a post to `/api/forms/`, are one finding for each page. Each declared form that no
 * kit form of a page names is one finding at `astro-kit.json: forms.<id>`.
 */
export function auditFormsDeclared(ctx: BuildContext): void {
  const forms = declaredForms(ctx);
  const seen = new Set<string>();
  for (const page of ctx.pages) {
    const dom = domOf(page);
    const kits = page.is404 ? [] : kitFormsOf(ctx, page);
    const other = otherPostProblems(ctx, dom, page.is404 ? kitFormsOf(ctx, page) : kits);
    if (other.length > 0) ctx.report.add(FORMS_DECLARED, page.path, listed(other));
    if (kits.length === 0) continue;
    for (const kit of kits) {
      const id = ACTION.exec(kit.path)?.[1];
      if (id !== undefined && kit.path === formAction(id)) seen.add(id);
      const problems = kitFormProblems(dom, kit, forms);
      if (problems.length > 0)
        ctx.report.add(FORMS_DECLARED, page.path, `${shownTag(page, kit.form)} ${listed(problems)}`);
    }
    const notes = noteProblems(dom);
    if (notes.missing.length > 0) {
      ctx.report.add(
        FORMS_DECLARED,
        page.path,
        `no element with the id ${notes.missing.join(' and no element with the id ')}`,
      );
    }
    if (notes.problems.length > 0) ctx.report.add(FORMS_DECLARED, page.path, listed(notes.problems));
  }
  for (const id of forms.keys()) {
    if (!seen.has(id)) {
      ctx.report.add(
        FORMS_DECLARED,
        fieldPlace(OPTIONS_FILE, ['forms', id]),
        `no page holds a form that posts to ${formAction(id)}`,
      );
    }
  }
}

// forms-fields

const FORMS_FIELDS = 'forms-fields';

/**
 * The text that the word check of a field reads: the rendered text of its labels (`renderedText`) and, for a radio,
 * of the legend of its fieldset. The field's own text and the text of other controls are no part of it.
 */
function labelText(dom: PageDom, field: HTMLElement): string {
  const parts = labelsOf(dom, field).map(renderedText);
  if (tagOf(field) === 'input' && inputType(field) === 'radio') {
    const fieldset = ancestorsOf(field).find((ancestor) => tagOf(ancestor) === 'fieldset');
    const legend = fieldset?.childNodes.find(
      (node): node is HTMLElement => node.nodeType === 1 && tagOf(node as HTMLElement) === 'legend',
    );
    if (legend !== undefined) parts.push(renderedText(legend));
  }
  return parts.join(' ');
}

/** The first subtag of a language tag, in lower case. */
const primary = (tag: string): string => asciiLower(tag.trim().split('-')[0] ?? '');

/** The language of a field: the first subtag of its nearest `lang`, in lower case. `''` when it has none. */
const languageOf = (dom: PageDom, field: HTMLElement): string => primary(dom.lang(field) ?? '');

/** The warning of a field in a language without words, on a page whose locale has none either. */
const NO_WORDS = 'The kit has no required and optional words for this language.';

/**
 * `forms-fields`: every visible field of a page has a label, the required or optional word of its language, an
 * `autocomplete` (not a checkbox or a radio), and no `placeholder` (section 8). A field under `[inert]` needs no
 * label; every other check holds for it too. A field inside `[data-mode-switch]` skips the word and the
 * `autocomplete` checks. One finding for each page with problems. A field in a language without words fails when
 * the locale of its page has words, and is one warning for each page and language when the locale has none either.
 */
export function auditFormsFields(ctx: BuildContext): void {
  for (const page of ctx.pages) {
    const dom = domOf(page);
    const problems: string[] = [];
    const skipped = new Map<string, number>();
    const pageLanguage = primary(localeOf(ctx.options, page.locale)?.tag ?? page.locale);
    const pageWords = FIELD_WORDS.has(pageLanguage);
    for (const field of dom.elements) {
      if (!isField(field)) continue;
      const shown = shownTag(page, field);
      if (hasAttr(field, 'placeholder')) problems.push(`${shown} has a placeholder`);
      const labels = labelsOf(dom, field);
      if (labels.length === 0 && !withinAttr(field, 'inert')) problems.push(`${shown} has no label`);
      if (withinAttr(field, 'data-mode-switch')) continue;
      const type = tagOf(field) === 'input' ? inputType(field) : '';
      if (type !== 'checkbox' && type !== 'radio' && collapse(attr(field, 'autocomplete') ?? '') === '') {
        problems.push(`${shown} has no autocomplete`);
      }
      if (labels.length === 0) continue;
      const language = languageOf(dom, field);
      const words = FIELD_WORDS.get(language);
      if (words === undefined) {
        if (pageWords) {
          problems.push(
            `the label of ${shown} is in the language ${JSON.stringify(language)}, which has no required and optional words; the page language ${JSON.stringify(pageLanguage)} has them`,
          );
        } else skipped.set(language, (skipped.get(language) ?? 0) + 1);
        continue;
      }
      const required = hasAttr(field, 'required');
      const wanted = required ? words.required : words.optional;
      const found = wordsOf(labelText(dom, field).toLowerCase());
      if (!found.some((word) => wanted.has(word))) {
        problems.push(
          `the label of ${shown} has no ${required ? 'required' : 'optional'} word (${[...wanted].join(', ')})`,
        );
      }
    }
    if (problems.length > 0) ctx.report.add(FORMS_FIELDS, page.path, listed(problems));
    for (const [language, count] of skipped) {
      ctx.report.warn(
        FORMS_FIELDS,
        page.path,
        NO_WORDS,
        `the word check skips ${count} field${count === 1 ? '' : 's'} in the language ${JSON.stringify(language)}`,
      );
    }
  }
}

// forms-safety

const FORMS_SAFETY = 'forms-safety';

/**
 * `forms-safety`: no page has a file input or a checkbox or radio with `checked`, and every POST form holds a link
 * to the privacy path of the locale of its page (section 8). A POST form is a form that `postsData`. A link counts
 * when its same-origin path is the path or the file of that page, and a visitor can see and reach it: neither it
 * nor an ancestor has `hidden`, `inert` or `aria-hidden="true"`, so a link in the honeypot wrapper does not count.
 * One finding for each page with problems.
 */
export function auditFormsSafety(ctx: BuildContext): void {
  const { host } = siteOf(ctx);
  const privacy = new Map(Object.entries(ctx.options.legal.privacy ?? {}));
  for (const page of ctx.pages) {
    const dom = domOf(page);
    const problems: string[] = [];
    for (const input of dom.byTag('input')) {
      const type = inputType(input);
      if (type === 'file') problems.push(`${shownTag(page, input)} is a file input`);
      else if ((type === 'checkbox' || type === 'radio') && hasAttr(input, 'checked')) {
        problems.push(`${shownTag(page, input)} is checked before the visitor chooses`);
      }
    }
    const path = privacy.get(page.locale);
    for (const form of dom.byTag('form')) {
      if (path === undefined || !postsData(dom, form)) continue;
      const linked = descendantsOf(form).some((element) => {
        const tag = tagOf(element);
        const href = attr(element, 'href');
        if ((tag !== 'a' && tag !== 'area') || href === undefined || isConcealed(element)) return false;
        const target = resolveHref(href, page.path, host);
        return target.kind === 'internal' && (target.path === path || pageAt(ctx, target.path)?.path === path);
      });
      if (!linked) problems.push(`${shownTag(page, form)} has no visible link to the privacy page ${path}`);
    }
    if (problems.length > 0) ctx.report.add(FORMS_SAFETY, page.path, listed(problems));
  }
}

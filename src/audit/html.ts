/**
 * html-validate on every built page, with the kit rules only: a project config file is never read.
 */
import { type ConfigData, HtmlValidate, StaticConfigLoader } from 'html-validate';
import type { Audit, BuildContext } from '../context.ts';

export const HTML_VALIDATE_CONFIG: ConfigData = {
  root: true,
  extends: ['html-validate:recommended', 'html-validate:document'],
  elements: ['html5'],
  rules: {
    'unique-landmark': 'error',
    'prefer-native-element': 'error',
    'no-missing-references': 'error',
    // Off where a kit rule reports the same defect, so one defect gives one finding:
    // headings-order, images-attrs (alt), head-title and css-banned (style attributes).
    'heading-level': 'off',
    'wcag/h37': 'off',
    'long-title': 'off',
    'no-inline-style': 'off',
    // Astro emits no integrity attributes, and origins-third-party already keeps every resource same-origin.
    'require-sri': ['error', { target: 'crossorigin' }],
  },
};

let validator: HtmlValidate | undefined;

export const auditHtml: Audit = async (ctx: BuildContext) => {
  validator ??= new HtmlValidate(new StaticConfigLoader(HTML_VALIDATE_CONFIG));
  for (const page of ctx.pages) {
    const result = await validator.validateString(page.html, page.file);
    for (const message of result.results.flatMap((r) => r.messages)) {
      ctx.report.add(
        'html-validate',
        page.path,
        `${message.ruleId} at ${message.line}:${message.column}: ${message.message}`,
      );
    }
  }
};

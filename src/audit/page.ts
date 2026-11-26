/**
 * The page audit (specification, 6.1, `astro:build:done`, step 4, first): the rules that read each page on its
 * own, with the few site-wide facts that they hold (a title unique in its locale, one organization `@id`, the fonts
 * of the site). It runs them in the order of section 8. The rules live in five groups under `./page/`:
 *
 * - `head.ts`: `head-*`, `headings-*` and `indexing-noindex`;
 * - `scripts.ts`: `js-script`, `js-prefetch-attr`, `js-directive` and `origins-third-party`;
 * - `shell.ts`: `speculation-block`, `modes-script`, `modes-switch`, `csp-*` and `html-shell`;
 * - `forms.ts`: `forms-declared`, `forms-fields` and `forms-safety`;
 * - `assets.ts`: `images-*` (but `images-public` and `images-original`, which are config rules), `fonts-limit`,
 *   `media-*` and `svg-name`.
 *
 * Every group reads the pages through `./dom.ts`, so that each page is read once.
 */
import type { BuildContext } from '../context.ts';
import { type AuditRule, runRules } from './dom.ts';
import {
  auditFontsLimit,
  auditImagesAttrs,
  auditImagesFormat,
  auditImagesPriority,
  auditImagesSrc,
  auditMediaAnimated,
  auditMediaCaptions,
  auditMediaPdf,
  auditSvgName,
} from './page/assets.ts';
import { auditFormsDeclared, auditFormsFields, auditFormsSafety } from './page/forms.ts';
import {
  auditHeadCanonical,
  auditHeadDescription,
  auditHeadIcons,
  auditHeadingsH1,
  auditHeadingsOrder,
  auditHeadJsonld,
  auditHeadLang,
  auditHeadOg,
  auditHeadTitle,
  auditIndexingNoindex,
} from './page/head.ts';
import { auditJsDirective, auditJsPrefetchAttr, auditJsScript, auditOriginsThirdParty } from './page/scripts.ts';
import {
  auditCspBase,
  auditCspHash,
  auditCspMeta,
  auditHtmlShell,
  auditModesScript,
  auditModesSwitch,
  auditSpeculationBlock,
} from './page/shell.ts';

export * from './page/assets.ts';
export * from './page/forms.ts';
export * from './page/head.ts';
export * from './page/scripts.ts';
export * from './page/shell.ts';

/** The rules of the page audit, in the order of section 8. */
export const PAGE_RULES: readonly AuditRule[] = [
  { id: 'js-script', run: auditJsScript },
  { id: 'js-prefetch-attr', run: auditJsPrefetchAttr },
  { id: 'js-directive', run: auditJsDirective },
  { id: 'speculation-block', run: auditSpeculationBlock },
  { id: 'images-src', run: auditImagesSrc },
  { id: 'images-attrs', run: auditImagesAttrs },
  { id: 'images-format', run: auditImagesFormat },
  { id: 'images-priority', run: auditImagesPriority },
  { id: 'fonts-limit', run: auditFontsLimit },
  { id: 'origins-third-party', run: auditOriginsThirdParty },
  { id: 'head-canonical', run: auditHeadCanonical },
  { id: 'head-lang', run: auditHeadLang },
  { id: 'head-title', run: auditHeadTitle },
  { id: 'head-description', run: auditHeadDescription },
  { id: 'head-og', run: auditHeadOg },
  { id: 'head-icons', run: auditHeadIcons },
  { id: 'head-jsonld', run: auditHeadJsonld },
  { id: 'headings-h1', run: auditHeadingsH1 },
  { id: 'headings-order', run: auditHeadingsOrder },
  { id: 'indexing-noindex', run: auditIndexingNoindex },
  { id: 'modes-script', run: auditModesScript },
  { id: 'modes-switch', run: auditModesSwitch },
  { id: 'csp-meta', run: auditCspMeta },
  { id: 'csp-hash', run: auditCspHash },
  { id: 'csp-base', run: auditCspBase },
  { id: 'html-shell', run: auditHtmlShell },
  { id: 'forms-declared', run: auditFormsDeclared },
  { id: 'forms-fields', run: auditFormsFields },
  { id: 'forms-safety', run: auditFormsSafety },
  { id: 'media-animated', run: auditMediaAnimated },
  { id: 'media-captions', run: auditMediaCaptions },
  { id: 'media-pdf', run: auditMediaPdf },
  { id: 'svg-name', run: auditSvgName },
];

/** The page audit: every rule of `PAGE_RULES`, in order. */
export function auditPage(ctx: BuildContext): void {
  runRules(ctx, PAGE_RULES);
}

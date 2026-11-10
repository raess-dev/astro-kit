/**
 * The rule registry: the single source of every check the kit runs.
 * docs/standards.md is generated from it (`npm run docs`), so docs and checks cannot drift.
 * Each rule: a stable id, a group, the standard in one line, the failure message and a fix hint.
 */

export type Stage = 'config' | 'routes' | 'build' | 'browser' | 'ci' | 'smoke' | 'zone';

export interface Rule {
  id: string;
  group: string;
  stage: Stage;
  /** The rule, stated once as a decidable condition. */
  standard: string;
  /** What the failure means, printed with the finding. */
  message: string;
  /** How to fix it. */
  hint: string;
}

const r = (id: string, group: string, stage: Stage, standard: string, message: string, hint: string): Rule => ({
  id,
  group,
  stage,
  standard,
  message,
  hint,
});

export const RULES: readonly Rule[] = [
  // ── config ───────────────────────────────────────────────────────────────
  r(
    'config-options',
    'config',
    'config',
    'astro-kit.json exists and matches the kit schema.',
    'astro-kit.json is missing or invalid.',
    'Correct the fields named in the detail. The field table is in docs/standards.md#config-options.',
  ),
  r(
    'config-shim',
    'config',
    'config',
    'astro.config.mjs, biome.json and tsconfig.json equal the kit shims byte for byte.',
    'A shim file differs from the kit version.',
    'Restore it with `npx --no astro-kit init --shims`. Put options in astro-kit.json, never in the shims.',
  ),
  r(
    'config-locked',
    'config',
    'config',
    'No integration or config changes a value the kit locks.',
    'A locked Astro setting was changed after the kit set it.',
    'Remove the override. The kit owns output, trailingSlash, build, image, security, prefetch, i18n and compressHTML.',
  ),
  r(
    'config-adapter',
    'config',
    'config',
    'Projects never set an adapter; the kit adds @astrojs/cloudflare when features.forms is on.',
    'An adapter is set in the project config.',
    'Remove it and set features.forms in astro-kit.json instead.',
  ),
  r(
    'config-experimental',
    'config',
    'config',
    'No experimental Astro flag is enabled.',
    'An experimental flag is on.',
    'Remove it. clientPrerender in particular breaks the single speculation-rules source.',
  ),
  r(
    'config-i18n',
    'config',
    'config',
    'Astro i18n stays unset; the kit manifest builds every URL.',
    'Astro i18n is configured.',
    'Remove the i18n block; set locales in astro-kit.json.',
  ),
  r(
    'config-imports',
    'config',
    'build',
    'No source imports astro:i18n or astro:transitions.',
    'A forbidden virtual module is imported.',
    'Use alternates() and pagePaths() for URLs. Use native CSS view transitions; ClientRouter breaks the CSP.',
  ),
  r(
    'config-suppression',
    'config',
    'config',
    'src/ contains no biome-ignore, @ts-ignore, @ts-expect-error or @ts-nocheck.',
    'A suppression comment hides a check.',
    'Fix the underlying problem instead of silencing it.',
  ),
  r(
    'config-overrides',
    'config',
    'config',
    'package.json has no overrides.',
    'package.json overrides a dependency.',
    'Remove overrides; dependency versions come from the lockfile and Dependabot.',
  ),
  r(
    'config-dep-spec',
    'config',
    'config',
    'Every third-party dependency comes from the npm registry by version.',
    'A dependency uses a git, URL, file or link spec.',
    'Install it from npm with an exact version.',
  ),
  r(
    'config-dep-allowlist',
    'config',
    'config',
    'Dependencies are limited to astro, the kit, enabled feature packages and astro-kit.json dependencies.',
    'A dependency is not allowed.',
    'Remove it, or ask the owner to add it to astro-kit.json dependencies.',
  ),
  r(
    'config-public-shadow',
    'config',
    'config',
    'public/ holds no file the kit generates.',
    'A public/ file would shadow kit output.',
    'Delete it. The kit writes robots.txt, sitemap.xml, _headers, _redirects and security.txt.',
  ),
  r(
    'config-wrangler',
    'config',
    'config',
    'wrangler.jsonc serves dist as assets, keeps workers.dev and preview URLs off in production, isolates env.preview, and uses only full-line // comments and no trailing commas, so the deploy job can read it.',
    'wrangler.jsonc does not match the kit shape.',
    'Compare with templates/wrangler.jsonc; routes must be a custom_domain and env.preview must set routes to [].',
  ),
  r(
    'config-kit-identity',
    'config',
    'ci',
    'The kit in package-lock.json resolves from its exact registry.npmjs.org tarball URL with an integrity hash, no npm-shrinkwrap.json exists, .npmrc sets ignore-scripts=true, and the kit is not older than on the base branch.',
    'The install source of the kit cannot be trusted.',
    'Install @raess/astro-kit from npm with an exact version. Never downgrade it.',
  ),

  // ── routes ───────────────────────────────────────────────────────────────
  r(
    'routes-on-demand',
    'routes',
    'routes',
    'Every route is prerendered, except /api/* routes declared by an enabled feature.',
    'An undeclared on-demand route exists.',
    'Prerender the page, or enable the feature that owns the route.',
  ),
  r(
    'routes-slug',
    'routes',
    'routes',
    'Slugs use a–z, 0–9 and -, are unique per locale, and avoid reserved segments.',
    'A slug is invalid, duplicated or reserved.',
    'Rename the slug. Reserved: locale codes and system paths such as _astro, _actions, api and 404.',
  ),
  r(
    'routes-duplicate',
    'routes',
    'routes',
    'No two pages emit the same path.',
    'Two pages emit the same path.',
    'Change one slug.',
  ),
  r(
    'routes-translation',
    'routes',
    'routes',
    'Every page has a default-locale entry, and other locales either have it or declare it missing.',
    'A page is missing in a locale without being declared missing.',
    "Transcreate the page, or add the locale to the default entry's `missing` list.",
  ),
  r(
    'routes-redirects',
    'routes',
    'build',
    'redirects.json has no chains, no target that is itself a source, every target is built, and it fits Cloudflare limits.',
    'redirects.json is invalid.',
    'Point every from directly at its final target; mark removed pages `gone`.',
  ),
  r(
    'routes-removed',
    'routes',
    'ci',
    'A from on the base branch is never dropped, and every URL in the live sitemap is built or redirected.',
    'A published URL would break.',
    'Add a redirects.json row: {from, to} for a move, {from, gone: true} for a removal.',
  ),

  // ── js and speculation ───────────────────────────────────────────────────
  r(
    'js-script',
    'js',
    'build',
    'Pages ship no script except the speculation rules, unless features.scripts or features.islands allows it.',
    'A page ships an unexpected script.',
    'Use HTML and CSS first. Enable features.scripts or features.islands only when the tier test in docs/recipes/component.md says so.',
  ),
  r(
    'js-prefetch-attr',
    'js',
    'build',
    'No link carries data-astro-prefetch; the kit owns prefetching.',
    'A data-astro-prefetch attribute was found.',
    'Remove the attribute. Prefetch is configured in astro-kit.json.',
  ),
  r(
    'js-directive',
    'js',
    'build',
    'Islands hydrate only with client:visible, client:idle or client:media.',
    'An island uses client:load or client:only.',
    'Use client:visible; the markup must render on the server.',
  ),
  r(
    'js-budget',
    'js',
    'build',
    'Island JS stays within 20 KB and the prefetch chunk within 2 KB, compressed.',
    'A script budget is exceeded.',
    'Split or remove the island; prefer HTML and CSS.',
  ),
  r(
    'speculation-block',
    'speculation',
    'build',
    'With speculationRules on, each page has exactly one kit speculation-rules block whose hash is in the CSP.',
    'The speculation-rules block is missing, duplicated, changed or unhashed.',
    'Render pages with the kit Page component and do not add your own block.',
  ),

  // ── budgets ──────────────────────────────────────────────────────────────
  r(
    'budget-head',
    'budgets',
    'build',
    'Each page is 14 KB or less compressed up to </head>.',
    'The head is over budget.',
    'Reduce inline CSS or component imports on this layout; the breakdown names the largest part.',
  ),
  r(
    'budget-document',
    'budgets',
    'build',
    'Each page is 30 KB or less compressed.',
    'The document is over budget.',
    'Split the page or trim markup.',
  ),
  r(
    'budget-dom',
    'budgets',
    'build',
    'Each page has at most 1,400 elements and a depth of 32.',
    'The DOM is too large or too deep.',
    'Flatten wrappers and split long pages.',
  ),
  r(
    'budget-fonts',
    'budgets',
    'build',
    'Font files total 100 KB or less.',
    'Fonts are over budget.',
    'Subset the font, drop weights, or use the system stack.',
  ),

  // ── images and fonts ─────────────────────────────────────────────────────
  r(
    'images-src',
    'images',
    'build',
    'Every img comes from the image pipeline under /_astro/.',
    'An image bypasses the pipeline.',
    'Import the image from src/assets and use <Picture> or <Image>.',
  ),
  r(
    'images-attrs',
    'images',
    'build',
    'Every img has width, height and alt.',
    'An image lacks width, height or alt.',
    'Use the Astro image components and give alt text; decorative images use alt="".',
  ),
  r(
    'images-format',
    'images',
    'build',
    'Every picture offers AVIF sources with a WebP img fallback.',
    'A picture is not AVIF plus WebP.',
    'Use <Picture formats={["avif"]} fallbackFormat="webp">.',
  ),
  r(
    'images-priority',
    'images',
    'build',
    'A page has at most one priority image.',
    'More than one image has fetchpriority high.',
    'Keep priority on the one LCP image.',
  ),
  r(
    'images-public',
    'images',
    'config',
    'public/ holds no raster image except the icons and the OG fallback.',
    'A raster image sits in public/.',
    'Move it to src/assets and import it.',
  ),
  r(
    'images-original',
    'images',
    'config',
    'Source images in src/assets are 2560 px and 3 MB or less.',
    'A source image is too large.',
    'Export a smaller original (2560 px on the long edge, under 3 MB). Astro makes every smaller size.',
  ),
  r(
    'fonts-limit',
    'fonts',
    'build',
    'At most two font families, local files only, and at most one font preload.',
    'Font usage breaks the font limits.',
    'Use the Astro Fonts API with fontProviders.local() and one preload.',
  ),
  r(
    'origins-third-party',
    'origins',
    'build',
    'No page loads a resource from another origin.',
    'A third-party resource was found.',
    'Self-host it, or remove it.',
  ),

  // ── head, headings, hreflang, indexing ───────────────────────────────────
  r(
    'head-canonical',
    'head',
    'build',
    'Each page has one absolute self-canonical with a trailing slash.',
    'The canonical is missing or not self-referencing.',
    'Render pages with the kit Page component.',
  ),
  r(
    'head-lang',
    'head',
    'build',
    'html lang equals the locale of the route.',
    'html lang does not match the route locale.',
    "Pass the entry's locale to Page.",
  ),
  r(
    'head-title',
    'head',
    'build',
    'Titles are 15–70 characters and unique per locale.',
    'A title is too short, too long or duplicated.',
    'Write a distinct title for the page.',
  ),
  r(
    'head-description',
    'head',
    'build',
    'Descriptions are 50–160 characters and unique per locale.',
    'A description is too short, too long or duplicated.',
    'Write a distinct description for the page.',
  ),
  r(
    'head-og',
    'head',
    'build',
    'Indexable pages have og:title, og:description, og:url equal to the canonical, og:locale as the locale tag with an underscore (de_CH), and a same-origin 1200×630 og:image of 150 KB or less.',
    'Open Graph tags are incomplete.',
    'Give the entry an image, or rely on the site default image.',
  ),
  r(
    'head-icons',
    'head',
    'build',
    'Each page links favicon.ico, icon.svg and apple-touch-icon.png.',
    'An icon link or file is missing.',
    'Keep the icons that init wrote in public/.',
  ),
  r(
    'head-jsonld',
    'head',
    'build',
    'JSON-LD parses, uses only Organization or one LocalBusiness type, WebPage (with inLanguage), WebSite and Article, shares one organisation @id, and matches site.json and schedule.json.',
    'Structured data is invalid or disagrees with the facts.',
    'Edit site.json or schedule.json; never hand-write JSON-LD.',
  ),
  r(
    'headings-h1',
    'headings',
    'build',
    'Each page has exactly one h1.',
    'A page has zero or several h1 elements.',
    'Keep one h1 that states the page topic.',
  ),
  r(
    'headings-order',
    'headings',
    'build',
    'Heading levels never skip.',
    'A heading level is skipped.',
    'Use the next level down.',
  ),
  r(
    'hreflang-reciprocal',
    'hreflang',
    'build',
    'Every translation lists itself and its siblings, and every sibling lists it back.',
    'hreflang is incomplete or not reciprocal.',
    "Pass alternates() to Page, or fix the custom route's alternates.",
  ),
  r(
    'hreflang-x-default',
    'hreflang',
    'build',
    'x-default points to the default-locale version of the same page.',
    'x-default is missing or wrong.',
    'Pass alternates() to Page.',
  ),
  r(
    'indexing-noindex',
    'indexing',
    'build',
    'In production only the 404 page is noindex.',
    'A page has an unexpected robots noindex.',
    'Remove noindex; drafts are left out of production builds instead.',
  ),

  // ── links ────────────────────────────────────────────────────────────────
  r(
    'links-resolve',
    'links',
    'build',
    'Every same-origin href equals an emitted path byte for byte, and every anchor exists.',
    'A link is broken or not canonical.',
    'Use the path from pagePaths() or alternates(), with the trailing slash.',
  ),
  r(
    'links-generic',
    'links',
    'build',
    'No link text is generic, such as "mehr", "ici", "qui" or "here".',
    'A link has generic text.',
    'Name the destination in the link text.',
  ),
  r(
    'links-same-name',
    'links',
    'build',
    'Links with the same accessible name on a page share a target.',
    'Two links share a name but not a target.',
    'Add context with a .visually-hidden span.',
  ),
  r(
    'links-target-blank',
    'links',
    'build',
    'No link opens a new window.',
    'A link has target="_blank".',
    'Remove target.',
  ),
  r(
    'links-depth',
    'links',
    'build',
    'Every indexable page is within three clicks of its locale home.',
    'A page is too deep or orphaned.',
    'Link it from the navigation, a parent page or the sitemap page.',
  ),
  r(
    'links-sitemap-page',
    'links',
    'build',
    "Every indexable page links to its locale's sitemap page.",
    'The sitemap page is not linked.',
    'Keep the footer from the kit Page component.',
  ),

  // ── facts and content ────────────────────────────────────────────────────
  r(
    'facts-value',
    'facts',
    'build',
    'Every email, phone number, CHE-UID, IBAN and CHF amount in the HTML equals a value in site.json.',
    'A fact on the page is not in site.json.',
    'Facts come only from site.json, which the owner edits.',
  ),
  r(
    'facts-schedule',
    'facts',
    'config',
    'schedule.json holds opening hours and closures only.',
    'schedule.json holds something other than hours.',
    'Move other data to site.json (owner) or the page content.',
  ),
  r(
    'content-stale',
    'content',
    'build',
    'A translation is current: its transcreatedFrom matches the brief hash, and its h2 sections, facts and internal link targets match the default locale.',
    'A translation is stale.',
    'Re-transcreate the page from its brief (docs/recipes/content.md), then set transcreatedFrom.',
  ),
  r(
    'content-language',
    'content',
    'build',
    "Main content is written in the page's language.",
    'A block reads like another locale.',
    'Transcreate the block; mark foreign phrases with <span lang>.',
  ),
  r(
    'content-copied',
    'content',
    'build',
    "A translation never reuses the default locale's title, description or h1.",
    'A translation copies the default locale.',
    'Transcreate it.',
  ),
  r(
    'content-glossary',
    'content',
    'build',
    "Copy uses the glossary's canonical terms and avoids banned variants (de-CH: no ß, no „ “).",
    'A banned term or character was found.',
    'Use the canonical term from the glossary.',
  ),
  r(
    'content-intl',
    'content',
    'config',
    'Dates and money are formatted only with formatDate() and formatMoney().',
    'toLocale* or new Intl. is used directly.',
    'Import formatDate or formatMoney from @raess/astro-kit/content.',
  ),
  r(
    'content-messages',
    'content',
    'build',
    'UI messages have the same keys in every locale and are NFC-normalised. A locale without kit UI text (other than de, fr, it, en) defines every kit key itself.',
    'Message keys differ between locales, or a locale has no UI text.',
    'Add the missing keys to src/content/messages/<code>.json.',
  ),

  // ── css ──────────────────────────────────────────────────────────────────
  r(
    'css-layer-order',
    'css',
    'build',
    'The kit layer order is declared before any other layer.',
    'The kit layer order is not first.',
    'Import base.css only through the kit Page component.',
  ),
  r(
    'css-var-undefined',
    'css',
    'build',
    'Every var() refers to a defined custom property.',
    'An undefined custom property is used.',
    'Define the token in theme.css or use an existing one.',
  ),
  r(
    'css-literal',
    'css',
    'build',
    'Colour literals appear only in token definitions.',
    'A colour literal is used outside tokens.',
    'Add a token to theme.css and use var().',
  ),
  r(
    'css-classes',
    'css',
    'build',
    'Global class selectors come only from the kit list; components use scoped styles.',
    'An unknown global class was found.',
    'Use a scoped <style> in the component, or one of the kit classes.',
  ),
  r(
    'css-banned',
    'css',
    'build',
    'No style attribute, is:global, 100vw, 100dvw, forced-color-adjust: none, or overflow-x: hidden on html or body.',
    'A banned CSS pattern was found.',
    'Use the layout classes; style attributes break the CSP.',
  ),

  // ── csp and edge ─────────────────────────────────────────────────────────
  r(
    'csp-meta',
    'csp',
    'build',
    "Each page has one CSP meta with 'self' plus hashes, no unsafe or wildcard sources, and no executable script before it.",
    'The CSP meta is missing, weak or late.',
    'Do not add scripts to <head>; render pages with the kit Page component.',
  ),
  r(
    'csp-hash',
    'csp',
    'build',
    'Every inline script and style is hashed in the CSP.',
    'An inline script or style is not covered.',
    'Do not use is:inline, set:html scripts or define:vars.',
  ),
  r('csp-base', 'csp', 'build', 'No page has a <base> element.', 'A <base> element was found.', 'Remove it.'),
  r(
    'edge-headers',
    'edge',
    'build',
    '_headers sets the security headers on /* and immutable caching on /_astro/* only, within Cloudflare limits.',
    'The generated _headers is invalid.',
    'This is a kit bug if public/_headers is absent; report it in KIT-FEEDBACK.md.',
  ),
  r(
    'edge-redirects',
    'edge',
    'build',
    '_redirects fits Cloudflare limits: 2,000 static rules, 100 dynamic, 1,000 characters each.',
    'The generated _redirects exceeds a limit.',
    'Collapse redirects.json rows with a splat.',
  ),

  // ── html, forms, legal, media, svg ───────────────────────────────────────
  r(
    'html-validate',
    'html',
    'build',
    'Every page passes html-validate with the kit rules.',
    'The HTML is invalid.',
    'Fix the markup at the reported line.',
  ),
  r(
    'html-shell',
    'html',
    'build',
    'The skip link is the first focusable element and targets the single main.',
    'The page shell is broken.',
    'Render pages with the kit Page component.',
  ),
  r(
    'forms-fields',
    'forms',
    'build',
    'Every visible input has a label that says required or optional, an autocomplete value and no placeholder.',
    'A form field breaks the field rules.',
    'Use the kit ContactForm, or copy its field pattern.',
  ),
  r(
    'forms-safety',
    'forms',
    'build',
    "No form has a file input or a pre-checked box, and every POST form links its locale's privacy page.",
    'A form breaks the safety rules.',
    'Remove the input, uncheck the box, add the privacy link.',
  ),
  r(
    'forms-binding',
    'forms',
    'config',
    'With features.forms, wrangler.jsonc has a send_email binding with allowed_destination_addresses.',
    'The mail binding is missing.',
    'Add the binding from templates/wrangler.jsonc; the owner sets the addresses.',
  ),
  r(
    'legal-pages',
    'legal',
    'build',
    'Every locale has an imprint and a privacy page.',
    'A legal page is missing.',
    'The owner supplies the legal text; add the page with key imprint or privacy.',
  ),
  r(
    'legal-processing',
    'legal',
    'build',
    'Each privacy page declares processing for every enabled feature.',
    'The privacy page omits an enabled feature.',
    'The owner updates the notice and its processing list.',
  ),
  r(
    'legal-statement',
    'legal',
    'build',
    'An accessibility statement claims conformance only with an audit record in site.json.',
    'A conformance claim lacks an audit record.',
    'Remove the claim or add the audit record.',
  ),
  r(
    'media-animated',
    'media',
    'build',
    'No animated GIF, APNG, animated WebP or animated AVIF ships.',
    'An animated image was found.',
    'Use a still image or a <video> with controls.',
  ),
  r(
    'media-captions',
    'media',
    'build',
    'Every video has captions in the page language, and every audio links a transcript.',
    'Media lacks captions or a transcript.',
    'Add a <track kind="captions" srclang> or a transcript link.',
  ),
  r(
    'media-pdf',
    'media',
    'build',
    'A PDF ships only with an HTML page that has the same content.',
    'A PDF has no HTML equivalent.',
    'Publish the content as a page and map it in site.json.',
  ),
  r(
    'svg-name',
    'svg',
    'build',
    'An inline SVG is aria-hidden, or has role img and a name.',
    'An inline SVG is unnamed.',
    'Add aria-hidden="true", or role="img" with aria-label.',
  ),

  // ── browser ──────────────────────────────────────────────────────────────
  r(
    'a11y-axe',
    'a11y',
    'browser',
    'axe finds no WCAG 2.2 AA or best-practice violation, in light and dark.',
    'axe reported a violation.',
    'Fix the element axe names.',
  ),
  r(
    'a11y-focus',
    'a11y',
    'browser',
    'Keyboard focus shows a 2 px outline at 3:1; a mouse click on a link or button shows none.',
    'The focus indicator is wrong.',
    'Keep the kit :focus-visible style; do not remove outlines.',
  ),
  r(
    'a11y-targets',
    'a11y',
    'browser',
    'Non-inline controls are at least 44×44 px.',
    'A control is too small.',
    'Keep the kit control sizes; avoid fixed small heights.',
  ),
  r(
    'a11y-reflow',
    'a11y',
    'browser',
    'At 320 px wide no element extends past the viewport, menu closed and open.',
    'Content overflows at 320 px.',
    'Let the element wrap or shrink.',
  ),
  r(
    'a11y-spacing',
    'a11y',
    'browser',
    'The WCAG text-spacing override causes no overflow or clipping.',
    'Text clips under increased spacing.',
    'Remove fixed heights on text containers.',
  ),
  r(
    'a11y-forced-colors',
    'a11y',
    'browser',
    'In forced colours the h1, main, focus ring and button borders stay visible.',
    'Content disappears in forced colours.',
    'Use borders, not backgrounds, for boundaries.',
  ),
  r(
    'a11y-keyboard',
    'a11y',
    'browser',
    'Tab reaches every control, with the menu closed and open, and the focused element is never covered.',
    'A control is unreachable or hidden when focused.',
    'Remove tabindex values above 0 and overlaps.',
  ),
  r(
    'a11y-no-js',
    'a11y',
    'browser',
    'Without JS the content, navigation and form work.',
    'The page fails without JS.',
    'Render content on the server; JS only enhances.',
  ),
  r(
    'contrast-pairs',
    'contrast',
    'browser',
    'Token pairs meet 7:1 (text), 4.5:1 (muted, links, buttons, errors) and 3:1 (borders, focus) in light, dark and more contrast.',
    'A token pair fails its contrast ratio.',
    'Adjust the token in theme.css.',
  ),
  r(
    'perf-lcp-priority',
    'perf',
    'browser',
    'An LCP image has fetchpriority high and is not lazy.',
    'The LCP image is not prioritised.',
    'Add priority to that image only.',
  ),
  r(
    'perf-cls',
    'perf',
    'browser',
    'CLS is 0.05 or less over load and a full scroll, throttled.',
    'The layout shifts.',
    'Give media dimensions; avoid inserting content above the fold.',
  ),
  r(
    'perf-image-oversize',
    'perf',
    'browser',
    'No image loads more than 1.5× its rendered width times the pixel ratio.',
    'An image is oversized.',
    'Set sizes for images narrower than the content column.',
  ),
  r(
    'perf-bfcache',
    'perf',
    'browser',
    'Pages restore from the back/forward cache.',
    'The page is not bfcache-eligible.',
    'Remove unload handlers and no-store headers.',
  ),
  r(
    'perf-prerender',
    'perf',
    'browser',
    'With speculationRules on, a hovered link is prerendered before the click.',
    'Prerendering did not happen.',
    'Keep the kit speculation-rules block; do not exclude the link.',
  ),
  r(
    'perf-prefetch',
    'perf',
    'browser',
    'With astroPrefetch on and speculationRules off, a hovered link is prefetched and reused.',
    'Prefetch did not reuse the page.',
    'Check that HTML is served with max-age=120.',
  ),

  // ── smoke (production) ───────────────────────────────────────────────────
  r(
    'smoke-status',
    'smoke',
    'smoke',
    'The root and every locale home answer 200, an unknown path answers 404 with the kit 404 page.',
    'A status code is wrong.',
    'Check the deploy and not_found_handling.',
  ),
  r(
    'smoke-headers',
    'smoke',
    'smoke',
    'HTML, an asset and the 404 page carry the kit security headers.',
    'A security header is missing in production.',
    'Check _headers in dist and zone transform rules.',
  ),
  r(
    'smoke-cache',
    'smoke',
    'smoke',
    'HTML and /_astro/* carry exactly the kit Cache-Control values.',
    'Cache-Control differs in production.',
    'Check _headers and zone cache rules.',
  ),
  r(
    'smoke-transport',
    'smoke',
    'smoke',
    'Responses are compressed (zstd, br or gzip), HTTP/3 is advertised, and http redirects to https in one hop.',
    'Transport settings differ.',
    'Run `astro-kit provision zone --check`.',
  ),
  r(
    'smoke-redirects',
    'smoke',
    'smoke',
    'www and apex canonicalise in one 301, and the production workers.dev URL does not answer.',
    'Host canonicalisation is wrong.',
    'Set the zone Single Redirect and workers_dev false.',
  ),
  r(
    'smoke-robots',
    'smoke',
    'smoke',
    'The served robots.txt equals the built file.',
    'robots.txt is rewritten at the edge.',
    'Turn off managed robots.txt and AI bot blocking in the zone.',
  ),
  r(
    'smoke-injection',
    'smoke',
    'smoke',
    'No response sets cookies, NEL or Report-To, or contains /cdn-cgi/ injections.',
    'The edge injects content.',
    'Run `astro-kit provision zone --apply` to turn the feature off.',
  ),
  r(
    'smoke-release',
    'smoke',
    'smoke',
    '/_kit/release.txt equals the deployed main commit.',
    'Production runs an older or unknown build.',
    'Re-run the deploy job.',
  ),
  r(
    'smoke-security-txt',
    'smoke',
    'smoke',
    '/.well-known/security.txt is valid for at least 30 more days.',
    'security.txt is missing or about to expire.',
    'Redeploy; the build renews Expires.',
  ),
  r(
    'smoke-mail-dns',
    'smoke',
    'smoke',
    'With forms, the domain has one SPF record and a _dmarc record.',
    'Mail DNS is missing or duplicated.',
    'The owner fixes the DNS records named in docs/forms.md.',
  ),
  r(
    'smoke-probe',
    'smoke',
    'smoke',
    'With forms, the weekly probe submission answers 303 to #sent.',
    'The contact form does not deliver.',
    'Check the send_email binding and the probe secret.',
  ),

  // ── zone (provision) ─────────────────────────────────────────────────────
  r(
    'zone-settings',
    'zone',
    'zone',
    'The zone uses TLS 1.2 or later, TLS 1.3, Always HTTPS and HTTP/3, with Rocket Loader, email obfuscation, Speed Brain, RUM and NEL off.',
    'A zone setting differs from the kit.',
    'Run `astro-kit provision zone --apply` with an edit token.',
  ),
  r(
    'zone-rewriters',
    'zone',
    'zone',
    'Page-rewriting features stay off: pre_render, webmcp_enabled, content_converter and search_for_agents.',
    'A page-rewriting feature is on.',
    'Turn it off in the dashboard or with provision --apply.',
  ),
  r(
    'zone-bots',
    'zone',
    'zone',
    'Bot management does not block AI crawlers and does not manage robots.txt.',
    'The zone overrides the robots policy.',
    'Turn off AI bot blocking and managed robots.txt under Security settings.',
  ),
];

export const RULE_BY_ID: ReadonlyMap<string, Rule> = new Map(RULES.map((rule) => [rule.id, rule]));

export const DOCS_PATH = 'node_modules/@raess/astro-kit/docs/standards.md';

export interface Finding {
  rule: string;
  /** File, URL or page path where the problem is. */
  where: string;
  /** Specific detail: the value found, the limit, the element. */
  detail?: string;
}

export class FindingError extends Error {
  readonly findings: readonly Finding[];
  constructor(findings: readonly Finding[]) {
    super(formatFindings(findings));
    this.name = 'AstroKitError';
    this.findings = findings;
  }
}

export function getRule(id: string): Rule {
  const rule = RULE_BY_ID.get(id);
  if (!rule) throw new Error(`astro-kit: unknown rule id ${id}`);
  return rule;
}

export function formatFindings(findings: readonly Finding[]): string {
  if (findings.length === 0) return 'astro-kit: all checks passed.';
  const lines = [`astro-kit: ${findings.length} finding${findings.length === 1 ? '' : 's'}`];
  for (const f of findings) {
    const rule = getRule(f.rule);
    lines.push(`✗ [${rule.id}] ${f.where}: ${rule.message}${f.detail ? ` (${f.detail})` : ''}`);
    lines.push(`    fix: ${rule.hint}`);
    lines.push(`    rule: ${DOCS_PATH}#${rule.id}`);
  }
  return lines.join('\n');
}

/** Collects findings; throws once with all of them, so one run reports everything. */
export class Report {
  readonly findings: Finding[] = [];
  add(rule: string, where: string, detail?: string): void {
    getRule(rule);
    this.findings.push(detail === undefined ? { rule, where } : { rule, where, detail });
  }
  get ok(): boolean {
    return this.findings.length === 0;
  }
  ids(): Set<string> {
    return new Set(this.findings.map((f) => f.rule));
  }
  throwIfFailed(): void {
    if (!this.ok) throw new FindingError(this.findings);
  }
}

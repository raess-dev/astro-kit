# The astro-kit standard

Generated from `src/registry.ts` by `npm run docs`. Do not edit it by hand.

## How to read a failure

Every failing check prints the same three lines:

```text
✗ [head-title] /fr/contact/: A title is too short, too long or duplicated. (12 characters)
    fix: Write a distinct title for the page.
    rule: node_modules/@raess/astro-kit/docs/standards.md#head-title
```

The id in brackets is the rule below. Then come the place, the meaning and the value found. Fix the cause; never silence a check.
If a check looks wrong, add an entry to `KIT-FEEDBACK.md` and keep the check.

## Stages

| Stage | Runs in | Groups |
|---|---|---|
| Config | `npx --no astro-kit check`, and the start of every `astro build` and `astro dev`. | config, routes, images, facts, content, forms |
| Build | the end of `astro build`, on the files in `dist/`. | config, routes, js, speculation, budgets, images, fonts, origins, head, headings, hreflang, indexing, links, facts, content, css, csp, edge, html, forms, legal, media, svg |
| Browser | `npx --no astro-kit test`, in headless Chromium on the built site. | a11y, contrast, perf |
| Release | `astro-kit ci` against the base branch and the live sitemap, `astro-kit smoke <url>` against production, `astro-kit provision zone --check`. | config, routes, smoke, zone |

## config

- <a id="config-options"></a>**config-options** — astro-kit.json exists and matches the kit schema. Fix: Correct the fields named in the detail. The field table is in docs/standards.md#config-options.
- <a id="config-shim"></a>**config-shim** — astro.config.mjs, biome.json and tsconfig.json equal the kit shims byte for byte. Fix: Restore it with `npx --no astro-kit init --shims`. Put options in astro-kit.json, never in the shims.
- <a id="config-locked"></a>**config-locked** — No integration or config changes a value the kit locks. Fix: Remove the override. The kit owns output, trailingSlash, build, image, security, prefetch, i18n and compressHTML.
- <a id="config-adapter"></a>**config-adapter** — Projects never set an adapter; the kit adds @astrojs/cloudflare when features.forms is on. Fix: Remove it and set features.forms in astro-kit.json instead.
- <a id="config-experimental"></a>**config-experimental** — No experimental Astro flag is enabled. Fix: Remove it. clientPrerender in particular breaks the single speculation-rules source.
- <a id="config-i18n"></a>**config-i18n** — Astro i18n stays unset; the kit manifest builds every URL. Fix: Remove the i18n block; set locales in astro-kit.json.
- <a id="config-imports"></a>**config-imports** — No source imports astro:i18n or astro:transitions. Fix: Use alternates() and pagePaths() for URLs. Use native CSS view transitions; ClientRouter breaks the CSP.
- <a id="config-suppression"></a>**config-suppression** — src/ contains no biome-ignore, @ts-ignore, @ts-expect-error or @ts-nocheck. Fix: Fix the underlying problem instead of silencing it.
- <a id="config-overrides"></a>**config-overrides** — package.json has no overrides. Fix: Remove overrides; dependency versions come from the lockfile and Dependabot.
- <a id="config-dep-spec"></a>**config-dep-spec** — Every third-party dependency comes from the npm registry by version. Fix: Install it from npm with an exact version.
- <a id="config-dep-allowlist"></a>**config-dep-allowlist** — Dependencies are limited to astro, the kit, enabled feature packages and astro-kit.json dependencies. Fix: Remove it, or ask the owner to add it to astro-kit.json dependencies.
- <a id="config-public-shadow"></a>**config-public-shadow** — public/ holds no file the kit generates. Fix: Delete it. The kit writes robots.txt, sitemap.xml, _headers, _redirects and security.txt.
- <a id="config-wrangler"></a>**config-wrangler** — wrangler.jsonc serves dist as assets, keeps workers.dev and preview URLs off in production, isolates env.preview, and uses only full-line // comments and no trailing commas, so the deploy job can read it. Fix: Compare with templates/wrangler.jsonc; routes must be a custom_domain and env.preview must set routes to [].
- <a id="config-kit-identity"></a>**config-kit-identity** — The kit in package-lock.json resolves from registry.npmjs.org with an integrity hash, .npmrc sets ignore-scripts=true, and the kit is not older than on the base branch. Fix: Install @raess/astro-kit from npm with an exact version. Never downgrade it.

### astro-kit.json

| Field | Default | Meaning |
|---|---|---|
| `site` | required | Production origin: https, no path, no trailing slash. |
| `locales` | required | `{code, tag, name}` each: the URL segment, the BCP 47 tag and the endonym. |
| `defaultLocale` | required | The locale at the root URLs. Effectively permanent. |
| `nav` | `[]` | Page ids in the header navigation, in order. |
| `features` | `{"forms":false,"islands":false,"scripts":false}` | `forms` (contact endpoint and mail), `islands` (Solid), `scripts` (bundled vanilla scripts). |
| `prefetch` | `{"speculationRules":true,"astroPrefetch":false}` | `speculationRules` (one static block) and `astroPrefetch` (Astro prefetch behind the kit gate). |
| `contact` | `null` | Needed with `features.forms`: `to`, `from` and an optional `probe`, all verified in Email Routing. |
| `securityContact` | required | The security.txt Contact: a `mailto:` or `https://` URL. |
| `dependencies` | `[]` | Extra npm packages the owner allows. |
| `limits` | `{}` | Stricter limits only: `headBytes`, `documentBytes`, `domElements`. |

## routes

- <a id="routes-on-demand"></a>**routes-on-demand** — Every route is prerendered, except /api/* routes declared by an enabled feature. Fix: Prerender the page, or enable the feature that owns the route.
- <a id="routes-slug"></a>**routes-slug** — Slugs use a–z, 0–9 and -, are unique per locale, and avoid reserved segments. Fix: Rename the slug. Reserved: locale codes and system paths such as _astro, _actions, api and 404.
- <a id="routes-duplicate"></a>**routes-duplicate** — No two pages emit the same path. Fix: Change one slug.
- <a id="routes-translation"></a>**routes-translation** — Every page has a default-locale entry, and other locales either have it or declare it missing. Fix: Transcreate the page, or add the locale to the default entry's `missing` list.
- <a id="routes-redirects"></a>**routes-redirects** — redirects.json has no chains, no target that is itself a source, and fits Cloudflare limits. Fix: Point every from directly at its final target; mark removed pages `gone`.
- <a id="routes-removed"></a>**routes-removed** — A from on the base branch is never dropped, and every URL in the live sitemap is built or redirected. Fix: Add a redirects.json row: {from, to} for a move, {from, gone: true} for a removal.

## js

- <a id="js-script"></a>**js-script** — Pages ship no script except the speculation rules, unless features.scripts or features.islands allows it. Fix: Use HTML and CSS first. Enable features.scripts or features.islands only when the tier test in docs/recipes/component.md says so.
- <a id="js-prefetch-attr"></a>**js-prefetch-attr** — No link carries data-astro-prefetch; the kit owns prefetching. Fix: Remove the attribute. Prefetch is configured in astro-kit.json.
- <a id="js-directive"></a>**js-directive** — Islands hydrate only with client:visible, client:idle or client:media. Fix: Use client:visible; the markup must render on the server.
- <a id="js-budget"></a>**js-budget** — Island JS stays within 20 KB and the prefetch chunk within 2 KB, compressed. Fix: Split or remove the island; prefer HTML and CSS.

## speculation

- <a id="speculation-block"></a>**speculation-block** — With speculationRules on, each page has exactly one kit speculation-rules block whose hash is in the CSP. Fix: Render pages with the kit Page component and do not add your own block.

## budgets

- <a id="budget-head"></a>**budget-head** — Each page is 14 KB or less compressed up to `</head>`. Fix: Reduce inline CSS or component imports on this layout; the breakdown names the largest part.
- <a id="budget-document"></a>**budget-document** — Each page is 30 KB or less compressed. Fix: Split the page or trim markup.
- <a id="budget-dom"></a>**budget-dom** — Each page has at most 1,400 elements and a depth of 32. Fix: Flatten wrappers and split long pages.
- <a id="budget-fonts"></a>**budget-fonts** — Font files total 100 KB or less. Fix: Subset the font, drop weights, or use the system stack.

Sizes are compressed: the larger of zstd level 3 and brotli level 5.

| Limit | Value |
|---|---|
| `headBytes` | 14 KB |
| `documentBytes` | 30 KB |
| `domElements` | 1400 |
| `domDepth` | 32 |
| `fontBytes` | 100 KB |
| `islandJsBytes` | 20 KB |
| `prefetchJsBytes` | 2 KB |
| `ogImageBytes` | 150 KB |
| `baseCssBytes` | 3 KB |
| `titleMin` | 15 |
| `titleMax` | 70 |
| `descriptionMin` | 50 |
| `descriptionMax` | 160 |
| `imageMaxPx` | 2560 |
| `imageMaxBytes` | 3 MB |
| `clickDepth` | 3 |

## images

- <a id="images-src"></a>**images-src** — Every img comes from the image pipeline under /_astro/. Fix: Import the image from src/assets and use `<Picture>` or `<Image>`.
- <a id="images-attrs"></a>**images-attrs** — Every img has width, height and alt. Fix: Use the Astro image components and give alt text; decorative images use alt="".
- <a id="images-format"></a>**images-format** — Every picture offers AVIF sources with a WebP img fallback. Fix: Use `<Picture formats={["avif"]} fallbackFormat="webp">`.
- <a id="images-priority"></a>**images-priority** — A page has at most one priority image. Fix: Keep priority on the one LCP image.
- <a id="images-public"></a>**images-public** — public/ holds no raster image except the icons and the OG fallback. Fix: Move it to src/assets and import it.
- <a id="images-original"></a>**images-original** — Source images in src/assets are 2560 px and 3 MB or less. Fix: Export a smaller original (2560 px on the long edge, under 3 MB). Astro makes every smaller size.

## fonts

- <a id="fonts-limit"></a>**fonts-limit** — At most two font families, local files only, and at most one font preload. Fix: Use the Astro Fonts API with fontProviders.local() and one preload.

## origins

- <a id="origins-third-party"></a>**origins-third-party** — No page loads a resource from another origin. Fix: Self-host it, or remove it.

## head

- <a id="head-canonical"></a>**head-canonical** — Each page has one absolute self-canonical with a trailing slash. Fix: Render pages with the kit Page component.
- <a id="head-lang"></a>**head-lang** — html lang equals the locale of the route. Fix: Pass the entry's locale to Page.
- <a id="head-title"></a>**head-title** — Titles are 15–70 characters and unique per locale. Fix: Write a distinct title for the page.
- <a id="head-description"></a>**head-description** — Descriptions are 50–160 characters and unique per locale. Fix: Write a distinct description for the page.
- <a id="head-og"></a>**head-og** — Indexable pages have og:title, og:description, og:url equal to the canonical, og:locale as the locale tag with an underscore (de_CH), and a same-origin 1200×630 og:image of 150 KB or less. Fix: Give the entry an image, or rely on the site default image.
- <a id="head-icons"></a>**head-icons** — Each page links favicon.ico, icon.svg and apple-touch-icon.png. Fix: Keep the icons that init wrote in public/.
- <a id="head-jsonld"></a>**head-jsonld** — JSON-LD parses, uses only Organization or one LocalBusiness type, WebPage (with inLanguage), WebSite and Article, shares one organisation @id, and matches site.json and schedule.json. Fix: Edit site.json or schedule.json; never hand-write JSON-LD.

## headings

- <a id="headings-h1"></a>**headings-h1** — Each page has exactly one h1. Fix: Keep one h1 that states the page topic.
- <a id="headings-order"></a>**headings-order** — Heading levels never skip. Fix: Use the next level down.

## hreflang

- <a id="hreflang-reciprocal"></a>**hreflang-reciprocal** — Every translation lists itself and its siblings, and every sibling lists it back. Fix: Pass alternates() to Page, or fix the custom route's alternates.
- <a id="hreflang-x-default"></a>**hreflang-x-default** — x-default points to the default-locale version of the same page. Fix: Pass alternates() to Page.

## indexing

- <a id="indexing-noindex"></a>**indexing-noindex** — In production only the 404 page is noindex. Fix: Remove noindex; drafts are left out of production builds instead.

## links

- <a id="links-resolve"></a>**links-resolve** — Every same-origin href equals an emitted path byte for byte, and every anchor exists. Fix: Use the path from pagePaths() or alternates(), with the trailing slash.
- <a id="links-generic"></a>**links-generic** — No link text is generic, such as "mehr", "ici", "qui" or "here". Fix: Name the destination in the link text.
- <a id="links-same-name"></a>**links-same-name** — Links with the same accessible name on a page share a target. Fix: Add context with a .visually-hidden span.
- <a id="links-target-blank"></a>**links-target-blank** — No link opens a new window. Fix: Remove target.
- <a id="links-depth"></a>**links-depth** — Every indexable page is within three clicks of its locale home. Fix: Link it from the navigation, a parent page or the sitemap page.
- <a id="links-sitemap-page"></a>**links-sitemap-page** — Every indexable page links to its locale's sitemap page. Fix: Keep the footer from the kit Page component.

## facts

- <a id="facts-value"></a>**facts-value** — Every email, phone number, CHE-UID, IBAN and CHF amount in the HTML equals a value in site.json. Fix: Facts come only from site.json, which the owner edits.
- <a id="facts-schedule"></a>**facts-schedule** — schedule.json holds opening hours and closures only. Fix: Move other data to site.json (owner) or the page content.

## content

- <a id="content-stale"></a>**content-stale** — A translation is current: its transcreatedFrom matches the brief hash, and its h2 sections, facts and internal link targets match the default locale. Fix: Re-transcreate the page from its brief (docs/recipes/content.md), then set transcreatedFrom.
- <a id="content-language"></a>**content-language** — Main content is written in the page's language. Fix: Transcreate the block; mark foreign phrases with `<span lang>`.
- <a id="content-copied"></a>**content-copied** — A translation never reuses the default locale's title, description or h1. Fix: Transcreate it.
- <a id="content-glossary"></a>**content-glossary** — Copy uses the glossary's canonical terms and avoids banned variants (de-CH: no ß, no „ “). Fix: Use the canonical term from the glossary.
- <a id="content-intl"></a>**content-intl** — Dates and money are formatted only with formatDate() and formatMoney(). Fix: Import formatDate or formatMoney from @raess/astro-kit/content.
- <a id="content-messages"></a>**content-messages** — UI messages have the same keys in every locale and are NFC-normalised. A locale without kit UI text (other than de, fr, it, en) defines every kit key itself. Fix: Add the missing keys to src/content/messages/`<code>`.json.

## css

- <a id="css-layer-order"></a>**css-layer-order** — The kit layer order is declared before any other layer. Fix: Import base.css only through the kit Page component.
- <a id="css-var-undefined"></a>**css-var-undefined** — Every var() refers to a defined custom property. Fix: Define the token in theme.css or use an existing one.
- <a id="css-literal"></a>**css-literal** — Colour literals appear only in token definitions. Fix: Add a token to theme.css and use var().
- <a id="css-classes"></a>**css-classes** — Global class selectors come only from the kit list; components use scoped styles. Fix: Use a scoped `<style>` in the component, or one of the kit classes.
- <a id="css-banned"></a>**css-banned** — No style attribute, is:global, 100vw, 100dvw, forced-color-adjust: none, or overflow-x: hidden on html or body. Fix: Use the layout classes; style attributes break the CSP.

## csp

- <a id="csp-meta"></a>**csp-meta** — Each page has one CSP meta with 'self' plus hashes, no unsafe or wildcard sources, and no executable script before it. Fix: Do not add scripts to `<head>`; render pages with the kit Page component.
- <a id="csp-hash"></a>**csp-hash** — Every inline script and style is hashed in the CSP. Fix: Do not use is:inline, set:html scripts or define:vars.
- <a id="csp-base"></a>**csp-base** — No page has a `<base>` element. Fix: Remove it.

## edge

- <a id="edge-headers"></a>**edge-headers** — _headers sets the security headers on /* and immutable caching on /_astro/* only, within Cloudflare limits. Fix: This is a kit bug if public/_headers is absent; report it in KIT-FEEDBACK.md.
- <a id="edge-redirects"></a>**edge-redirects** — _redirects fits Cloudflare limits: 2,000 static rules, 100 dynamic, 1,000 characters each. Fix: Collapse redirects.json rows with a splat.

## html

- <a id="html-validate"></a>**html-validate** — Every page passes html-validate with the kit rules. Fix: Fix the markup at the reported line.
- <a id="html-shell"></a>**html-shell** — The skip link is the first focusable element and targets the single main. Fix: Render pages with the kit Page component.

## forms

- <a id="forms-fields"></a>**forms-fields** — Every visible input has a label that says required or optional, an autocomplete value and no placeholder. Fix: Use the kit ContactForm, or copy its field pattern.
- <a id="forms-safety"></a>**forms-safety** — No form has a file input or a pre-checked box, and every POST form links its locale's privacy page. Fix: Remove the input, uncheck the box, add the privacy link.
- <a id="forms-binding"></a>**forms-binding** — With features.forms, wrangler.jsonc has a send_email binding with allowed_destination_addresses. Fix: Add the binding from templates/wrangler.jsonc; the owner sets the addresses.

## legal

- <a id="legal-pages"></a>**legal-pages** — Every locale has an imprint and a privacy page. Fix: The owner supplies the legal text; add the page with key imprint or privacy.
- <a id="legal-processing"></a>**legal-processing** — Each privacy page declares processing for every enabled feature. Fix: The owner updates the notice and its processing list.
- <a id="legal-statement"></a>**legal-statement** — An accessibility statement claims conformance only with an audit record in site.json. Fix: Remove the claim or add the audit record.

## media

- <a id="media-animated"></a>**media-animated** — No animated GIF, APNG, animated WebP or animated AVIF ships. Fix: Use a still image or a `<video>` with controls.
- <a id="media-captions"></a>**media-captions** — Every video has captions in the page language, and every audio links a transcript. Fix: Add a `<track kind="captions" srclang>` or a transcript link.
- <a id="media-pdf"></a>**media-pdf** — A PDF ships only with an HTML page that has the same content. Fix: Publish the content as a page and map it in site.json.

## svg

- <a id="svg-name"></a>**svg-name** — An inline SVG is aria-hidden, or has role img and a name. Fix: Add aria-hidden="true", or role="img" with aria-label.

## a11y

- <a id="a11y-axe"></a>**a11y-axe** — axe finds no WCAG 2.2 AA or best-practice violation, in light and dark. Fix: Fix the element axe names.
- <a id="a11y-focus"></a>**a11y-focus** — Keyboard focus shows a 2 px outline at 3:1; a mouse click on a link or button shows none. Fix: Keep the kit :focus-visible style; do not remove outlines.
- <a id="a11y-targets"></a>**a11y-targets** — Non-inline controls are at least 44×44 px. Fix: Keep the kit control sizes; avoid fixed small heights.
- <a id="a11y-reflow"></a>**a11y-reflow** — At 320 px wide no element extends past the viewport, menu closed and open. Fix: Let the element wrap or shrink.
- <a id="a11y-spacing"></a>**a11y-spacing** — The WCAG text-spacing override causes no overflow or clipping. Fix: Remove fixed heights on text containers.
- <a id="a11y-forced-colors"></a>**a11y-forced-colors** — In forced colours the h1, main, focus ring and button borders stay visible. Fix: Use borders, not backgrounds, for boundaries.
- <a id="a11y-keyboard"></a>**a11y-keyboard** — Tab reaches every control, with the menu closed and open, and the focused element is never covered. Fix: Remove tabindex values above 0 and overlaps.
- <a id="a11y-no-js"></a>**a11y-no-js** — Without JS the content, navigation and form work. Fix: Render content on the server; JS only enhances.

## contrast

- <a id="contrast-pairs"></a>**contrast-pairs** — Token pairs meet 7:1 (text), 4.5:1 (muted, links, buttons, errors) and 3:1 (borders, focus) in light, dark and more contrast. Fix: Adjust the token in theme.css.

## perf

- <a id="perf-lcp-priority"></a>**perf-lcp-priority** — An LCP image has fetchpriority high and is not lazy. Fix: Add priority to that image only.
- <a id="perf-cls"></a>**perf-cls** — CLS is 0.05 or less over load and a full scroll, throttled. Fix: Give media dimensions; avoid inserting content above the fold.
- <a id="perf-image-oversize"></a>**perf-image-oversize** — No image loads more than 1.5× its rendered width times the pixel ratio. Fix: Set sizes for images narrower than the content column.
- <a id="perf-bfcache"></a>**perf-bfcache** — Pages restore from the back/forward cache. Fix: Remove unload handlers and no-store headers.
- <a id="perf-prerender"></a>**perf-prerender** — With speculationRules on, a hovered link is prerendered before the click. Fix: Keep the kit speculation-rules block; do not exclude the link.
- <a id="perf-prefetch"></a>**perf-prefetch** — With astroPrefetch on and speculationRules off, a hovered link is prefetched and reused. Fix: Check that HTML is served with max-age=120.

## smoke

- <a id="smoke-status"></a>**smoke-status** — The root and every locale home answer 200, an unknown path answers 404 with the kit 404 page. Fix: Check the deploy and not_found_handling.
- <a id="smoke-headers"></a>**smoke-headers** — HTML, an asset and the 404 page carry the kit security headers. Fix: Check _headers in dist and zone transform rules.
- <a id="smoke-cache"></a>**smoke-cache** — HTML and /_astro/* carry exactly the kit Cache-Control values. Fix: Check _headers and zone cache rules.
- <a id="smoke-transport"></a>**smoke-transport** — Responses are compressed (zstd, br or gzip), HTTP/3 is advertised, and http redirects to https in one hop. Fix: Run `astro-kit provision zone --check`.
- <a id="smoke-redirects"></a>**smoke-redirects** — www and apex canonicalise in one 301, and the production workers.dev URL does not answer. Fix: Set the zone Single Redirect and workers_dev false.
- <a id="smoke-robots"></a>**smoke-robots** — The served robots.txt equals the built file. Fix: Turn off managed robots.txt and AI bot blocking in the zone.
- <a id="smoke-injection"></a>**smoke-injection** — No response sets cookies, NEL or Report-To, or contains /cdn-cgi/ injections. Fix: Run `astro-kit provision zone --apply` to turn the feature off.
- <a id="smoke-release"></a>**smoke-release** — /_kit/release.txt equals the deployed main commit. Fix: Re-run the deploy job.
- <a id="smoke-security-txt"></a>**smoke-security-txt** — /.well-known/security.txt is valid for at least 30 more days. Fix: Redeploy; the build renews Expires.
- <a id="smoke-mail-dns"></a>**smoke-mail-dns** — With forms, the domain has one SPF record and a _dmarc record. Fix: The owner fixes the DNS records named in docs/forms.md.
- <a id="smoke-probe"></a>**smoke-probe** — With forms, the weekly probe submission answers 303 to #sent. Fix: Check the send_email binding and the probe secret.

## zone

- <a id="zone-settings"></a>**zone-settings** — The zone uses TLS 1.2 or later, TLS 1.3, Always HTTPS and HTTP/3, with Rocket Loader, email obfuscation, Speed Brain, RUM and NEL off. Fix: Run `astro-kit provision zone --apply` with an edit token.
- <a id="zone-rewriters"></a>**zone-rewriters** — Page-rewriting features stay off: pre_render, webmcp_enabled, content_converter and search_for_agents. Fix: Turn it off in the dashboard or with provision --apply.
- <a id="zone-bots"></a>**zone-bots** — Bot management does not block AI crawlers and does not manage robots.txt. Fix: Turn off AI bot blocking and managed robots.txt under Security settings.

## WCAG 2.2 coverage

The floor is WCAG 2.2 AA, plus AAA focus appearance, 44 px targets and 7:1 body text.

Checked by machine:

- 1.1.1 Non-text Content: [images-attrs](#images-attrs), [svg-name](#svg-name), [a11y-axe](#a11y-axe)
- 1.2.1 Audio-only and Video-only, 1.2.2 Captions: [media-captions](#media-captions)
- 1.3.1 Info and Relationships: [headings-order](#headings-order), [forms-fields](#forms-fields), [a11y-axe](#a11y-axe)
- 1.3.5 Identify Input Purpose: [forms-fields](#forms-fields)
- 1.4.3 Contrast (Minimum), 1.4.6 Contrast (Enhanced) for body text: [contrast-pairs](#contrast-pairs), [a11y-axe](#a11y-axe)
- 1.4.10 Reflow: [a11y-reflow](#a11y-reflow), [css-banned](#css-banned)
- 1.4.11 Non-text Contrast: [contrast-pairs](#contrast-pairs), [a11y-forced-colors](#a11y-forced-colors)
- 1.4.12 Text Spacing: [a11y-spacing](#a11y-spacing)
- 2.1.1 Keyboard, 2.4.3 Focus Order: [a11y-keyboard](#a11y-keyboard), [a11y-no-js](#a11y-no-js)
- 2.2.2 Pause, Stop, Hide: [media-animated](#media-animated)
- 2.4.1 Bypass Blocks: [html-shell](#html-shell)
- 2.4.2 Page Titled: [head-title](#head-title)
- 2.4.4 Link Purpose (In Context): [links-generic](#links-generic), [links-same-name](#links-same-name)
- 2.4.6 Headings and Labels: [headings-h1](#headings-h1), [forms-fields](#forms-fields)
- 2.4.7 Focus Visible, 2.4.13 Focus Appearance: [a11y-focus](#a11y-focus)
- 2.4.11 Focus Not Obscured (Minimum): [a11y-keyboard](#a11y-keyboard)
- 2.5.8 Target Size (Minimum), 2.5.5 Target Size (Enhanced): [a11y-targets](#a11y-targets)
- 3.1.1 Language of Page: [head-lang](#head-lang)
- 3.1.2 Language of Parts: [content-language](#content-language)
- 3.2.5 Change on Request: [links-target-blank](#links-target-blank)
- 3.3.2 Labels or Instructions: [forms-fields](#forms-fields)
- 4.1.2 Name, Role, Value: [a11y-axe](#a11y-axe), [svg-name](#svg-name)

Reviewed by the agent with `npx --no astro-kit test --outline <url>`, which prints headings, landmarks, links, labels and alt text:

- Alt text that says what the image means (1.1.1), and no images of text (1.4.5).
- Headings, labels and link text that describe their target (2.4.4, 2.4.6).
- Reading order that matches the meaning (1.3.2), and consistent navigation and names (3.2.3, 3.2.4).
- Error messages that name the field and the fix (3.3.1, 3.3.3).

Not verified:

- Real screen readers (NVDA, JAWS, VoiceOver, TalkBack), including how the form result is announced.
- Safari and Firefox: the browser checks run in Chromium only, so bfcache and prerender reuse there is unverified.
- Human-only criteria: caption and audio-description quality (1.2.3, 1.2.5), sensory wording (1.3.3), use of colour (1.4.1), flashing video (2.3.1), and plain language.

## Privacy processing

Each privacy page lists these keys in `processing` ([legal-processing](#legal-processing)).

| Key | Declared | What is processed |
|---|---|---|
| `cdn` | always | Cloudflare processes the IP address, user agent and requested URL to deliver and protect the site. Transfer to the U.S. rests on the Swiss-U.S. and EU-U.S. Data Privacy Framework. |
| `forms` | `features.forms` | Cloudflare Email Routing delivers the message to the owner's mailbox. A rate limiter keyed by IP address counts submissions for 60 seconds. |
| `server` | `features.forms` | Workers Logs keep request logs for up to 7 days. The endpoint logs error codes only, never form content. |
| `previews` | always | Cloudflare Access sends a one-time PIN to a reviewer's email address before a preview opens. |

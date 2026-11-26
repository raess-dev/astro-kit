# Changelog

## Unreleased

- The kit starts again from `docs/spec.md`. Milestone M0: the package skeleton, the rule registry with levels and
  waivers, the docs generator and the kit workflow.
- Milestone M2: the schemas of `astro-kit.json`, `site.json`, `schedule.json`, `glossary.json` and `redirects.json`,
  the three source shims, the checks on `package.json`, `src/` and `public/`, and preflight, which runs the first 15
  config-stage rules in a fixed order.
- Milestone M3: the integration with its four hooks, the locked Astro config, the kit CSS, the token generator, the
  mode script, the seven edge files, and the commands `build` and `tokens`, with 12 more rules on the config, the
  routes, `docs/design.md`, `tokens.css`, `wrangler.jsonc`, `_headers` and `_redirects`.
- Milestone M4: the CSS analyzers `src/css/parse.ts`, `values.ts`, `selectors.ts` and `media.ts`. They read source
  CSS and the built CSS that the minifier writes, give facts with a place and never throw. They add no rule: the css
  rules of M5 build on them.
- The CSS analyzers read CSS as Chromium does (`test/acceptance/css-oracle.test.ts`). The parser now drops a rule
  whose prelude holds a `;` in a list of rules (`.a {}; .b {}` drops `.b`), keeps a bracket without its partner as a
  token, skips a broken text in `@font-face` up to the next `;`, reads a lone `{}` block as a declaration value and
  the block of `@scope` as a style block, and reads U+0000 as U+FFFD. A bare `&` in a rule that is not nested has
  the specificity 0. The selector parser reads view transition classes (`::view-transition-group(.a)`), and each
  refusal says whether CSS refuses the selector too (`invalid`) or only the kit (`unread`). Each prelude problem says
  whether CSS refuses the query too.
- The CSS analyzers after review. The parser drops a byte order mark at the start of a text, reads a nested
  selector that starts with a combinator as relative also when it holds `&` (`.card { + & {} }` is
  `.card + .card`), multiplies a parent list only where each `&` stands at the top level (`:not(&)` takes the whole
  list as `:is()`), stops the work of nesting as soon as its budget is spent, reads a block of nested rules that look
  like declarations in linear time, keeps the first problems in the order of the text, and `walk` skips the block of
  an `@layer` with a broken prelude. A number in an easing function of `animation` is a literal, `-webkit-calc()` is
  a math function, and `scrollbar-color`, `stop-color`, `flood-color` and `lighting-color` take `--color-` tokens.
  An empty keyframe selector has the place of its rule. In a component file the arguments of `:is()` and `:where()`
  are part of the compound that holds them, a `:is()` that holds the root follows the sibling rule, and an attribute
  selector on `class` counts as its classes; `compoundCount` counts `:is()` and `:where()` as their longest argument.
  `lengthProblems` and `sameLength` take the form of the CSS: in built CSS a length equals the minifier's form of a
  breakpoint (`0` for `0rem`, 6 significant digits).
- A command that runs checks and ends with no failing finding prints `astro-kit: all checks passed.` as its last
  line on stdout: `build` and `tokens --check`. The text of the findings never holds that line.
- The acceptance suite and the test site are in this repository, under `test/acceptance/` and `test/site/`.
  `npm run acceptance` runs the suite with the kit of the checkout.
- `design-format` accepts only a value that is valid CSS for the properties of its token family. It now refuses a
  plain negative length or percentage in `--space-`, `--size-`, `--text-`, `--radius-`, `--line-` and `--leading-`,
  a percentage in `--line-`, a negative blur radius of a shadow, `steps(1, jump-none)`, a `linear()` stop with a
  percentage on both sides of its number, a font name without quotes that holds a CSS-wide keyword, `default` or a
  generic family beside another word, a hex color or a unit with a `-` or a `_` right behind it (`#000-1px`), and a
  gradient whose parts do not follow the grammar of CSS. The acceptance suite tests the rule against Chromium
  (`test/acceptance/design-values.test.ts`).
- `design-format` also refuses a `0` without a unit in `--space-`, `--size-`, `--text-`, `--radius-`, `--line-` and
  `--tracking-`: write `0px`. Inside `calc()` a browser reads `0` as a number, so a declaration such as
  `margin-top: calc(var(--space-0) * -1)` was lost. A `0` in a shadow or a gradient stays valid. The rule refuses a
  font name without quotes that holds a word which starts with `revert-`, such as the CSS-wide keyword
  `revert-rule`. It refuses a function with a name that only JavaScript knows, such as `constructor()`: such a
  value passed as a color and as a gradient, and it stopped the command in the other families.
- Milestone M5, part 5a: the 15 css rules, `design-specs`, `design-pairs` and `modes-media`, and the built half of
  `design-tokens`. Preflight runs their source halves after `design-tokens`, and the build runs their built halves
  in the css and design audits. A project now needs an `elements.css` that uses the `body`, `link` and `focus`
  pairs, and the `link`, `focus` and `error` pairs in `docs/design.md`.
- The rules of part 5a after review. `css-sources` reads an `import()` in a template expression of `.astro` and
  `.mdx`, no longer the YAML frontmatter of `.md` and `.mdx`, and fails a second `<style>` of project CSS on a built
  page. `css-banned` finds `html` and `body` through `:is()` and `:where()`, and reads the x axis of `overflow`.
  `css-selector` finds a type in the `:not()` of a root compound that `:where()` holds, and reports a nested rule at
  its own line. `css-token-family` checks each token that a root sets a local to, and a ratio in a `--size-` helper
  parameter. `css-element-coverage` counts only a rule that matches the element: no pseudo-class or attribute that
  narrows it, and a variant only for an element with its class; it checks variants on every element.
  `css-classes` and `css-unused` read `[class~=x]`. `design-pairs` follows gradient aliases and pairs the focus
  color of `:focus-visible`. Each fact reports once: `@scope` content, a literal viewport unit, `<style is:global>`,
  `!important` in a page file, `[data-mode]` in a page file and a mode feature in `@container` give one id each.
- `css-sources` fails an `import.meta.glob()` whose pattern can match a style file (`'./*.css'`, `'./**'`,
  `'./*.{js,css}'`), because the kit cannot see what a glob loads. It also names a missing
  `src/styles/elements.css` or `src/styles/fonts.css` at its path: the kit imports both into every page, and Vite
  stopped the build with an import that it could not resolve. A missing `elements.css` no longer gives
  `design-pairs` and `design-specs` findings for its rules.
- Milestone M5, part 5b: the page audits. 27 rules read each built page on its own: `head-*`, `headings-*`,
  `indexing-noindex`, `speculation-block`, `modes-script`, `modes-switch`, `csp-meta`, the built half of `csp-hash`,
  `csp-base`, `html-shell`, `images-src`, `images-attrs`, `images-format`, `images-priority`, `fonts-limit`,
  `svg-name`, `media-animated`, `media-captions` and `media-pdf`, and `html-validate` runs last with only the kit
  config. They read each page once, without recursion, so a page of 2 MB or one that nests 5,000 deep stops none of
  them. A page reads as a browser parses it: `pre` holds markup, `textarea` and `title` hold text, and template
  content is no part of the page. A CSP meta, a canonical, a description or an Open Graph tag counts only in `head`.
- Milestone M5, part 5c: the site and budget audits. 21 rules read the pages together: `routes-404`,
  `routes-translation`, `hreflang-*`, `links-*`, `facts-value`, `content-*`, `legal-pages`, `legal-statement` and
  `budget-*`. A site now needs `/404.html`, the declared legal pages, one locale home for each locale with pages, and
  pages whose facts equal `site.json`. Two facts patterns and the font regex backtrack on long runs, so they run as
  linear matchers that give the same matches. A link to the file of a page (`/x/index.html`) counts as a link to the
  page in every rule.
- The tool runner names the signal when a signal ends a tool. Astro can crash on a page that nests very deep, and
  `astro-kit build` then ended with 1 and no reason; now it prints `astro-kit: astro build was stopped by SIGSEGV`
  and that no check gave this result.
- `routes-slug` has its build half. Every built page path other than `/404.html` must end in `/`, and each of its
  segments must be a slug. A default-locale path must not start with a locale code or a reserved segment, and a
  non-default path must have no reserved segment after `/<code>/`. Before, only the endpoint clause ran, so a page
  built at `/en/getting_here/` passed the build.
- The test site, stage 2 (milestone M5, part 5d). It has 17 more pages: rooms, restaurant, getting here, contact,
  jobs and a sitemap page in German and in French, and the same in English without jobs. So it has 26 pages and
  `/404.html`. The pages hold the content of 14.2: the six prices as text, the PDF menu, the guest quote in English,
  one priority photo on each home, and the share image on every page. The photos come from `src/assets/` through
  `Picture`. The contact pages have no form until M7. `test/acceptance/site-assets.ts` makes the committed photos,
  the share image and the PDF, and `site-assets.test.ts` checks that the PDF is the one that `site.json` gives.
  `css-site.test.ts` reads a sub-layer `astro.*` as part of the layer `astro`, as 7.1 says.
- Milestone M5, part 5d: the planted sets `build` (38 ids), `css` (10 ids), `design` and `modes`, and the five
  agent mistakes, in `test/acceptance/planted-build.test.ts` and `planted.test.ts`. Each set runs `build` once and
  asserts its exact ids and no passed line. `KIT_PLANTED_DROP=<id>` runs the `build` or the `css` set without one
  plant, for the removal proof of a review.
- `facts-value` drops a `(0)` that stands right after the country code, so `+41 (0)81 555 01 10` is the number
  `+41815550110`. This common Swiss form failed before, because every digit counted. A `(0)` at any other place
  still counts as a digit.
- A failing build no longer gets Astro's false hint "Browser APIs are not available on the server". Astro picks
  that hint when the error text holds `document` or `window`, and the id `budget-document` did. `FindingError`
  now gives Astro a one-line `toString()` that only counts the failing findings. The printed findings are the same.
- Milestone M6, part 6a: `serveDist` in `src/serve.ts`, the local static server of the browser checks. It emulates
  Workers static assets on 127.0.0.1 and a free port, step by step as the asset worker of `wrangler dev`: a
  traversal guard, `_redirects`, the redirects and `.html` names of `auto-trailing-slash` with the query kept,
  `/404` with the 404 page, the nearest `404.html` with status 404, the canonical form of a path, content types
  with `; charset=utf-8` for text, `public, max-age=0, must-revalidate`, an `etag` with 304, the rules of
  `_headers` on an answer of any status with placeholders replaced in the values, `.assetsignore` read as a
  `.gitignore`, zstd, br or gzip for text, HEAD without a body and 405 for other methods. It serves
  `dist/client` of an adapter build, else `dist`, and a caller can observe each request. The form stub of 9.1 moves
  to M7. The suite case `serve-parity.test.ts` sends one request table to `serveDist` and to `wrangler dev` and
  compares the status, `location`, `cache-control` and the seven kit headers, and a second table on planted files.
  `_headers`: a detach needs `! ` with a space, as on Cloudflare, so `!<TAB>Name` is no detach. The suite and the spikes now serve
  pages with `serveDist` of the packed kit, and `test/acceptance/serve.ts` is gone.
- New rule `edge-private` (build, not waivable): no private file of the client directory is public. Cloudflare reads
  `.assetsignore` after its own lines for `/_headers`, `/_redirects` and `/.assetsignore`, so a later `!*` makes the
  three files public (measured with `wrangler dev`, 13.1 item 66). The rule also fails a `.env`, `.dev.vars` or
  Worker config that no line hides. It reads `.assetsignore` with the code of `serveDist`, which now lives in
  `src/hosts/cloudflare.ts`. The `build` planted set gets the plant `!*` in `public/.assetsignore`. The kit has 94
  rules.
- Milestone M6, part 6b: the command `test` (`--all`, `--outline`, `--shots`) and the browser harness of
  `src/browser.ts` and `src/browser/`. It launches the browser of 2.1 once, serves `dist` with `serveDist`, tests
  one page per locale and layout key (every page with `--all`), and gives each check browser contexts of its own.
  The page helpers come through an init script, so they also work with JavaScript off. The harness holds the
  viewports, the reveal step, the sweep, the Themes walk and the Colors probe. The 8 rules `a11y-focus`,
  `a11y-targets`, `a11y-reflow`, `a11y-spacing`, `a11y-forced-colors`, `a11y-keyboard`, `a11y-no-js` and
  `a11y-reveal` join the registry, so it has 102 rules. A sweep is the Tab sequence of `a11y-keyboard`, through
  its stops. The test site gives a link that stands alone in its paragraph the class `standalone`, a target of
  44 px, and a page-index link a width of at least 44 px.
  - Measurements that depend on time are deterministic: a sweep turns smooth scrolling off, runs one timer turn and
    finishes the running animations after each press, and the Themes wait pauses an animation that never ends at
    time 0 and finishes one that still runs after 2 s.
  - A sweep: a press that keeps the focus on the same element (a date field, a media player, an `iframe`) does not
    count, up to 50. The stops also hold a control with a negative `tabindex` (a roving group once) and a scroll
    container that Chromium focuses. `a11y-focus` does not measure a part that the browser draws inside a control.
  - The reveal step takes its dialogs once and opens the popovers again after each dialog; a popover that it
    showed is no cover for `a11y-keyboard`. `a11y-forced-colors` reads the buttons at 1280×800, at 390×844 and in
    each state of the reveal step.
  - A link inside `strong` or another inline element of a sentence is inline for `a11y-targets`. `a11y-reflow`
    skips `.visually-hidden`, and `a11y-spacing` counts only a box that holds text.
  - `a11y-focus` also measures the color of the ring: at least 3:1 against the color behind it (WCAG 1.4.11), in
    every state and, at 1280×800, in each other declared theme. Before, a component rule such as
    `outline-color: transparent` hid the ring and passed `build` and `test`.
  - A page that does not load within 30 s costs one limit for the whole run. `test --outline` on a target that
    answers other than 2xx exits 1. `--shots` joins the segments of a path with `--`.
- Three fixes in the browser checks, from the review of #14:
  - The reveal step opens an exclusive group as a whole. Before, a second `auto` popover closed the first, and an
    exclusive `details[name]` closed the others, so only the last one was measured. Now each popover shows as
    `manual` and each `details` loses its `name`.
  - `a11y-no-js` opens the dialog that holds a declared form, with a click on its native invoker, before it fills
    the form. Before, such a form failed although a visitor can use it without JavaScript.
  - `--shots` names the home `_index` and the 404 page `_404`, so `/index/` and `/404/` keep their own images.
  - `a11y-no-js` clicks a dialog's invoker before it closes the popovers, so an invoker inside a popover works.
    Before, the popover closed first, and the click timed out on a hidden button. The popovers that do not hold
    the invoker close before the click, so a full-screen menu cannot cover it.
- Milestone M6, part 6c: three rules that read colors, in `src/browser/color.ts`. The kit has 105 rules.
  - `a11y-axe` (browser, waivable) runs axe-core 4.14.0 from the kit's own dependency on every tested page: at
    1280×800 in every declared theme, and at 390×844 after the reveal step, so the content of a closed `details`,
    a popover or a dialog is read too. The kit injects axe with `evaluate`, so it works under the kit's CSP with
    Trusted Types on. A node fails once, in the first state that shows it, and equal details are one finding with
    a count. Text on a gradient is decided with the color stops of the gradient layer that axe sees behind it, each
    over the color behind that layer; gradient text is read as text. `color-contrast-enhanced` counts on running
    text in `main` only, also over a gradient. A link without underline in running text needs 3:1 against the text
    around it, which axe's `link-in-text-block` misses. An animation that never ends fails (WCAG 2.2.2). An axe run
    that takes longer than 15 s is reported, and the rule goes on.
  - `contrast-pairs` (browser, waivable) reads every pair of `docs/design.md` from a probe on the default home, in
    every declared theme, and fails a pair below the ratio of its role: text 7, ui 4.5, non-text 3. A background
    token with alpha is read over the page background of its theme.
  - `modes-behavior` (browser, not waivable) clicks through the mode switch of the default home at 1280×800 and at
    390×844. It opens a closed `details`, popover or dialog around the switch through its native invoker. Each choice
    must set `data-mode`, give `html` the `color-scheme` of 7.7 and paint every color token as `docs/design.md`
    gives it, in each system state. The last choice must survive a navigation and a reload. With JavaScript off, no
    mode control shows and the page shows the default mode. A `dialog` with the `popover` attribute opens as a
    popover, and a close button is no invoker.
  - The watch of `data-mode` writes runs from the `load` event for at least 1 s before a color rule gives its
    verdict, so a page script on a timer is always seen. Before, `contrast-pairs` missed it in about 1 run of 5.
  - The kit's link check also reads links in open shadow roots, and a gradient layer that an opaque upper layer
    hides no longer counts (from the Codex review of #18).
  - A link whose text an element inside it underlines counts as underlined. After the navigation and the reload,
    `modes-behavior` reads the mode only after the 1 s watch of the new page (from the Codex review of #18).
  - Over a gradient, the background colors between the gradient and the text count. The link check reads the color
    of the element that holds the link text. The phone pass of `a11y-axe` waits for the 1 s watch too. An alias
    chain of any length resolves; a circle still ends (from the Codex review of #18).
  - Hidden text inside a link counts neither for its color nor for its underline (from the Codex review of #18).
  - A gradient over another element's gradient is read over it; a link that holds only an image is no text link
    for the link check; `modes-behavior` skips a disabled invoker (from the Codex review of #18).
  - Running text for `color-contrast-enhanced` is found through the flat tree, so a paragraph in an open shadow
    root of a component in `main` counts (from the Codex review of #18).
  - The three rules measure colors only through the Colors probe of the harness: the one luminance formula of the
    kit, which the focus ring of `a11y-focus` uses too. Each read uses a fresh probe, so no transition of the page
    changes it. A page that writes `data-mode` by itself gives one fixed finding, so its result does not change from
    run to run.
  - The waits of the harness also hold the animations inside open shadow roots, which `document.getAnimations()`
    leaves out in Chromium 153.
- `a11y-axe` after the last Codex round of #18. Gradient text over another element's gradient compares each stop
  with the color it lies on, not with the first color below. A link in running text counts as underlined when an
  inline element around it draws the underline; an underline on the element that holds the text around the link
  does not set the link apart, and a float, a positioned element or an atomic inline on the way stops the
  underline of the elements above it, as CSS hands decorations down.
- The underline walk of the link check in `a11y-axe` follows the flat tree: a slotted link passes its slot and the
  elements around it in the shadow tree, so an `inline-block` there stops the host's underline (from the Codex review
  of #19).
- Milestone M6, part 6d: the perf pass, in `src/browser/perf.ts`. The kit has 111 rules. The perf rules read the
  sample, and every page with `--all`.
  - `perf-lcp-priority` throttles a phone (390×844@3) and a desktop (1440×900@1) through CDP and reads the last
    LCP entry. It waits for the `load` of a lazy image in the viewport, up to the page load limit of 30 s, and for
    the entry of each larger image, because Chromium reports an entry only when the frame is presented. It reads
    `fetchPriority` and `loading` as the browser does.
  - `perf-cls` runs at 390×844 and at 1280×800. The timeline of the page stands still, and a clock moves every
    animation 16.7 ms in each frame, so a slow machine paints the same frames and gets the same result. It scrolls the
    page, goes back to the top, waits for the images and then until at least 5 s after `load` and 2 s with no shift (10 s at
    most), so a banner that a script adds a few seconds after load on a short page counts.
  - `perf-image-oversize` reads the `w` descriptor of the loaded `srcset` candidate on both devices, with the `h`
    descriptor of HTML. It judges what an image adds to the transfer, keeps an image with `sizes="auto"` lazy and
    scrolls it into view, and fails an image that loads a raster file and shows nowhere.
  - `perf-bfcache` goes to `?kit-bfcache`, lets that page settle, and goes back. Its detail names the reasons of
    `notRestoredReasons` when the page loads again, without `masked`, and without `navigation-canceled` beside another
    reason.
  - `perf-prerender` hovers the first eligible link and waits for the request with `Sec-Purpose: prefetch;prerender`.
    A page whose links to other pages are all left out fails. `perf-prefetch` hovers, waits for the prefetch, clicks,
    waits for the load of the navigation wherever it ends, and accepts a navigation with `transferSize` 0 or one that
    only revalidated the prefetched page (Chromium revalidates a page with `max-age=0`).
  - The speculation rule and the prefetch gate take a link with `target="_self"`, which opens in the same tab. The
    speculation JSON and its hash change.
  - The runner checks up to four pages of a rule with `concurrent` at the same time and adds the findings in page
    order.
  - The test site gives the photo of each content page `priority`: it is the LCP element of its first screen.
  - The acceptance suite has the `browser` and `prefetch` planted sets, and the site case runs `test --all`. The two
    sets run in the CI job `kit / acceptance (browser)`, through `npm run acceptance:browser`; `kit / acceptance` runs
    the rest through `npm run acceptance:core`.
  - The spike S17 starts its Chromium with the switches of Playwright's launch that change features and scheduling,
    writes a network log, and waits for the prerender request, the prerendered page and the activation one after the
    other, so a failed run names the step that did not come.
- The perf rules after the Codex review of #21:
  - `perf-image-oversize` exempts a hidden image only when another image with a box shows its file, and reports a
    file that no image shows once; it reads the descriptors only from the `source` whose `media` matches.
  - The throttled navigation of `perf-lcp-priority` keeps its timeout to itself, so the other rules still measure a
    page that is only too slow under the throttle.
  - The speculation rule and the prefetch gate take a link with an empty `target`. The speculation JSON and its hash
    change.
- Milestone M7, part 7a: the form runtime, `@raess/astro-kit/forms`. The kit has 112 rules.
  - `createFormEndpoint` and `handleForm` follow the ten steps of 9.1 in order, and the first step that fails
    decides the code. The body is read into one buffer of 32,768 B, and the stream is cancelled past it. Every
    answer, a 303 or JSON, carries `private, no-store` and the five headers of 9.1 from one constant. The log holds
    the code only. The probe compare hashes both texts with SHA-256 and compares the digests with
    `crypto.subtle.timingSafeEqual` in the Worker, or with a loop over every byte where that is missing.
  - `src/forms/fields.ts` validates the declared fields (CRLF and CR count as one character, no control character
    except tab and line feed in a textarea) and writes the mail text. `src/forms/limits.ts` holds the fixed values.
  - `serveDist` holds the test server stub of 9.1 on a forms site: a POST to `/api/forms/<id>/` runs steps 1 to 7
    with the code of the endpoint, without limits or mail. `astro-kit test` serves a forms site with it, so
    `a11y-no-js` sends each declared form to the stub.
  - `renderWrangler` writes the forms text of 10.4, and `config-wrangler` compares a forms site with it. The new
    rule `forms-binding` checks the mail binding and the two rate limits in `wrangler.jsonc`.
  - The feature shim `templates/features/forms/src/pages/api/forms/[form].ts`.
  - The decisions of the owner after the review of 7a:
    - The probe header is `x-kit-probe-token`. Cloudflare redacts a header whose name holds `token` in trace events,
      Workers Logs and Tail Workers, so the secret never reaches a log.
    - Step 9 calls `FORM_RATE_LIMIT` first, and `FORM_RATE_LIMIT_ALL` only when it passed. A client refused for its
      IP address uses no budget of the form. A matched probe skips the IP limiter and still counts against the form,
      so smoke can probe ten forms from one runner. An IPv6 address counts by its /64 prefix. A limiter that throws
      at once counts as `rate_limited`.
    - Step 3 reads the part headers of a multipart body itself: a `filename` or `filename*` parameter rejects the
      body, also where the Worker's parser gives the part as a text. An urlencoded body with a charset other than
      UTF-8 is `bad_body` in Node and in the Worker.
    - Step 7 rejects U+2028, U+2029 and the bidi controls in every field. The mail gets a `replyTo` only for a valid
      e-mail address of HTML.
    - A failed load of `virtual:astro-kit` or `cloudflare:workers` answers `no_binding` with the five headers.
    - On a forms site, `config-shim` compares `src/pages/api/forms/[form].ts` with the forms shim in every command
      that runs preflight. `css-element-coverage` needs no rule for `input[type=hidden]`.
- Milestone M7, part 7b: the build rules of the forms and the test site with forms on. The kit has 115 rules.
  - `forms-declared` compares each form that posts to `/api/forms/` with its declaration: the action with the last
    slash, `method="post"`, the hidden `return`, the honeypot in its inert wrapper, and exactly the declared fields
    with their controls and attributes. A page with such a form needs `#sent` and `#not-sent`, and every declared form
    must stand on a page. `forms-fields` asks every field of a page for a label with the required or the optional
    word of its language, for `autocomplete` and for no `placeholder`. `forms-safety` refuses a file input and a
    pre-checked choice, and asks every POST form for a link to the privacy page of its locale.
  - `forms-declared` also reads every same-origin POST form, which must be a kit form (a fragment-only action posts
    to the page), and every submit control that changes a post to `/api/forms/`. `method` and `enctype` compare as a browser reads them, without a trim. A kit
    form has no `novalidate`, no `accept-charset` other than `utf-8`, no constraint that a declaration cannot express
    and no control that a browser never sends or that the endpoint always refuses, such as a consent `value` of white
    space only. An email field carries `EMAIL_PATTERN`, which
    `@raess/astro-kit/forms` exports. The notes `#sent` and `#not-sent` follow the markup pattern of 9.1.
  - `forms-fields` reads the rendered label text, without the text of controls and hidden parts. A label with both
    the required and the optional word fails, and a label under a `hidden` or `aria-hidden` wrapper gives no word. A field in a language without words fails on a page whose locale has
    words. `forms-safety` counts only a privacy link that a
    visitor can see and reach, and a form that posts by `formmethod` needs it too. An href with a backslash or with a
    tab or line break resolves as in a browser, and `routes-404` reads `/api/forms/` in any letter case.
  - Each form has its own body cap, the largest body that a browser can send for it, in place of the flat 32,768 B.
    `config-options` fails a form whose cap is above 131,072 B.
  - `a11y-no-js` checks that no note shows before the send, that the form shows its privacy link, and that only
    `#sent` shows after it. It names a disabled or readonly field and a disabled submit control at once.
  - A finding can only warn (`Report.warn`), with a message of its own: `forms-fields` warns for a field in a
    language without words on a page whose locale has none either.
  - The test site has the `contact` and `booking` forms on its three contact pages, `@astrojs/cloudflare` 14.4.7 in
    its `package.json`, the feature shim, and the forms text of `wrangler.jsonc`. Its pages are now in
    `dist/client/`. `test --all` sends both forms through the test server stub.
  - The acceptance suite runs the built Worker in `wrangler dev`: a form post sends the mail of 9.1, and the Worker
    refuses the bodies of 13.1 item 78 itself. The adapter adds its lines to `.assetsignore` before the audit of the
    kit, and the final file hides every private file. New: the `static` variant, the `forms` variant and the `route`
    set; the `build` set holds the three forms ids.
- `perf-image-oversize` no longer loses a lazy image that finishes its own load while the rule reads the page (1 run
  in 50 under load lost the finding). A file that a preload or a style sheet fetched exempts no image, so its
  verdict no longer depends on which load ends first.
- Milestone M8, part 8a: the build half of islands, scripts and origins. The kit has 121 rules.
  - `js-script` allows on a page only JSON-LD, the kit's two inserts, and what the settings allow: `/_astro/` module
    scripts and inline module scripts with scripts, the prefetch chunk with astroPrefetch, Astro's exact island
    texts and Solid's exact hydration script with islands, and an `async`, `defer` or module script of a page script
    origin. A `/_astro/` script must name a file of dist, and its path is read as the browser reads it, `%2e`
    included. Astro's texts come from the `astro` that the site installed, and Solid's from its `solid-js`.
    `js-prefetch-attr` refuses `data-astro-prefetch`, and `js-directive` refuses every client directive but
    `visible`, `idle` and `media`.
  - The source halves of the three rules and of `csp-hash` (`define:vars`, `is:inline`) read the start tags of every
    `.astro` file, with file and line, in preflight step 4. A bundled `<script>` needs `features.scripts`.
  - `js-budget` measures, for each page, the JS that loads at once (islands and module scripts with their static
    imports, 20,480 B), the JS behind `import()` at any depth (204,800 B) and the prefetch chunk (2,048 B), compressed
    as the other budgets. It reads the backtick form of `import()` that Rolldown writes, and it fails an `import()`
    that it cannot measure.
  - `origins-third-party` refuses a resource of another origin on the elements and attributes of section 8, each
    `srcset` candidate, each `ping` URL, a `formaction`, SVG `image` and `use`, the content of a `noscript` and the
    markup of a `srcdoc` included, except the three declared cases of 9.4. `legal-origins` asks the privacy page of
    each locale to name the processor of each origin, in text that a visitor sees.
  - `html-shell` refuses a meta refresh and a meta referrer. `config-public-shadow` refuses `public/_astro/`.
    `config-options` refuses an origin host that is an IP address, and a processor or purpose of white space only.
    The legal text leaves out hidden and visually hidden parts. html-validate reads Astro's island style element
    as a comment on an islands site. A hidden `main` or `body`, or one inside a hidden element, gives no legal text,
    and `origins-third-party` also reads a `noscript` inside `srcdoc` markup or inside another `noscript` (Codex,
    #26).
  - The islands shim `templates/features/islands/eslint.config.mjs` holds the text of 9.2. `check` compares it from
    M9.
  - The pinning rule of 2.1 is the owner's rule of 2026-11-26. The islands and lint pins are `solid-js` 1.9.19,
    `@astrojs/solid-js` 7.1.6, `eslint` 10.15.0, `eslint-plugin-solid` 0.20.0 and `typescript-eslint` 8.73.0.
  - The `build` set holds `origins-third-party` and `legal-origins`, and the `css` set `js-budget`. A real build with
    a large module behind `import()` proves `js-budget` on the bundler's own output.
- Two holes after 8a, closed as the owner decided on 2026-11-26:
  - `html-shell` fails a page that the kit's parser cannot read in full, and so does the content of a `noscript` or
    the markup of a `srcdoc` that it cannot read: the parser drops an element that is left open, such as
    `<script src="/x.js">` with no end tag, and then no rule sees it. `html-shell` cannot be waived.
  - All JS comes from the bundler. `public/` holds no `.js`, `.mjs` or `.cjs` file (`config-public-shadow`), and a
    static endpoint writes none (`routes-slug`). `js-budget` counts a `modulepreload` and a `preload` of a script as
    JS that loads at once, and a worker file (`new URL(`, `new Worker(`, `new SharedWorker(`, `importScripts(`,
    `serviceWorker.register(`) as JS that loads later. A worker call without a literal URL cannot be measured, and
    a file outside `/_astro/` counts too.
  - A worker URL counts only when the whole argument is a literal (or `new URL(` of one on the file's own base), and
    each argument of `importScripts(` counts. A bare worker URL and each `importScripts(` argument must start
    with `/`: the browser resolves them against the page or the worker, which the kit does not know (Codex, #27).
  - A specifier with a backslash cannot be measured, in `import()`, a worker URL and a static import: JavaScript
    decodes the escape, so the file that loads is not the text (Codex, #27).
- The stack pins move under the pinning rule of 2.1: `astro` 7.4.13 (with `rolldown` 1.3.3 and `vite` 8.3.8),
  `@astrojs/cloudflare` 14.4.9 and `wrangler` 4.165.0, in the kit and in the test site. The spikes and the whole
  suite run again on them. `solid-js` 1.9.20 is 7 days old only at 20:54 UTC on 2026-11-26, so it moves in its own PR.
- `solid-js` moves to 1.9.20 under the pinning rule of 2.1, in the kit and in the islands install of 9.2. The Solid
  hydration hash is measured again and is unchanged (13.1 item 11).

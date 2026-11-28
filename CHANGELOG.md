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
- Milestone M8, part 8b: the browser half of islands, scripts and origins. The kit has 122 rules.
  - `origins-gesture` opens each tested page as a visitor's browser opens it: under the origin of `site`, with
    the user agent of Chrome and no `navigator.webdriver`. A gesture is a click on the control or a key that activates
    it, and the check makes none. Playwright's clock is paused; the check advances it by 60 s,
    scrolls, moves the mouse, presses Tab, dispatches `focus`, advances it by 60 s again, and leaves the page. So a
    page timer, a scroll, a hover, a focus and a beacon on leaving count, in every run the same: no time edge decides
    a verdict. It counts each request and WebSocket, each connection at a refusing proxy of its own (a shared worker,
    `link rel=prerender`, a beacon after the page is gone), each `link` that may fetch, and each
    `RTCPeerConnection`. A request to the host of an origin with `load: "page"` passes, and so do the origin of
    `site` and a WebSocket to the page's own host and port. A request that the CSP blocked counts with its own words.
  - `test` reaches no network. Each browser that the kit launches gets a refusing proxy of its own, which also takes
    Chromium's own requests (its updater, its accounts and autofill services), no DNS, and no WebRTC UDP. Each
    check answers a request to another origin itself, with 204 and an empty body, and every context sends a request
    to another host to a refusing proxy of the kit on 127.0.0.1. The perf pass gets the proxy only, because a route
    turns the browser cache off.
  - After the Codex review of #30: `origins-gesture` serves the page under the origin of `site` itself (`https`,
    no port) through a route to the test server, so an absolute URL of the site loads from `dist` and the page's
    CSP `'self'` is the site, and `location` no longer shows the test. It scrolls 600 px at a time, so an island in
    the middle of a long page hydrates.
  - `origins-third-party` reads every `link` but those whose `rel` never fetches (`canonical`, `alternate` and nine
    more). A `link rel=prerender` to another host reaches it past the CSP in Chromium 153, and now fails the build.
  - The acceptance harness reports a command that it killed after 600 s (`KitRun.killed`), and each planted set of
    the browser job asserts that first, so a timeout no longer reads as a set with no finding.
  - The acceptance suite has the `islands`, `scripts` and `origins` variants and the `origins` set. The `scripts`
    and `origins` variants and the set share one build in `planted-origins.test.ts`, which runs in
    `kit / acceptance (browser)`. The `islands` case also waits in Chromium until the island hydrated.
- With `features.workers` off, `js-script` fails every start of a worker, whatever its argument: `new Worker`,
  `new SharedWorker` (also through `globalThis`, `window`, `self` or another member), `serviceWorker.register` and
  `importScripts`, in each JavaScript file of `dist` and in each inline script. The detail names `features.workers`
  and 9.5. The CSP already set `worker-src 'none'`; the build now says so first. With `features.workers` on, nothing
  changes.
- `origins-gesture`: a unit test pins that a new `about:blank`, `srcdoc`, nested or sandboxed frame and a popup of
  `window.open('')` carry the wrapped `RTCPeerConnection` before a script can read it, because Playwright runs the
  init script in their first document. The row no longer lists frames under what the check cannot see.
- After the Codex review of #31, the worker check of `js-script` is a scanner, not a regex. A regex read the gap after
  a candidate again from each candidate inside it: a run of comments, or one long comment with `[` in it, took
  seconds on 100 KB. The scanner skips each comment in one step, and it keeps, by its start, the end of each gap and the
  result of each name, member, member chain and string literal that it read, so it reads any text in linear time. It reads the same forms: a block comment ends at its first `*/`, and a line comment ends at `\n`,
  `\r`, U+2028 or U+2029.
- After the same review, a `new` with more than 64 opening parentheses before its name is a finding of its own that
  the worker check cannot read, so candidates between the parentheses of one expression cannot make the scan
  quadratic, and many starts in one inline script no longer exceed the argument limit of a call.
- CI: a third acceptance job, `kit / acceptance (origins)`, runs `planted-origins.test.ts` (`npm run
  acceptance:origins`). With it in `kit / acceptance (browser)`, that job took 14.8 of its 15 min half budget, and the
  `prefetch` set's `test --all` passed the 600 s limit of the harness for one command. `kit / merge` needs the new job
  (owner decision of 2026-11-27).
- The worker scanner of `js-script` keeps the end of each name by its start, so member dots that reach one long name
  through comments read it once (the Codex finding of round 9 on #31, which the owner moved to this follow-up).
- CI: a fourth acceptance job, `kit / acceptance (site)`, runs the `site` case and the `static`, `forms` and `islands`
  variants (`npm run acceptance:site`: `site.test.ts`, `variants.test.ts`, `variants-islands.test.ts`).
  `kit / acceptance` no longer runs them. M9 adds `check` to every variant and a `ci` case, and the core job could not
  take that time (11.1 min on #33). `kit / merge` needs the new job (owner decision of 2026-11-27).
- Milestone M9, part 9b: the commands `check` and `legal`, and the rule `legal-approved`. The kit has 123 rules.
  - `astro-kit check` runs preflight (the forms shim included), then with islands the comparison of
    `eslint.config.mjs` (`config-shim`), then `biome ci --colors=off --error-on-warnings .`, with islands and a `.tsx`
    source `eslint --config eslint.config.mjs --no-inline-config --max-warnings 0 src`, and `astro check`, through
    the tool runner. Each step runs only when every earlier one passed. It ends with the passed line, or with 1.
  - ESLint fails closed: it reads only the root shim and no inline config comment. `config-suppression` also fails
    `eslint-disable` in each form and an `eslint` config comment, a `.jsx` file under `src/` (an island is a `.tsx`
    file) and every symbolic link under `src/`; `config-shim` fails every `eslint.config.*` other than the root
    `eslint.config.mjs`. On an islands site ESLint lints `src/**/*.ts` with the Solid rules too, so a helper that reads a
    signal outside a tracking scope fails `check`; `check` runs ESLint when `src/` holds a `.tsx` or a `.ts` file.
  - `astro-kit legal --write` writes `legal.lock.json` from the declared legal pages in `dist`: one hash of the
    locked text for each page that is built, with sorted keys. `legal --check` compares the file with the build and
    reports `legal-approved`, which the build runs too: a changed word of the legal text of a legal page fails the
    build until the owner approves the new lock. A missing file has no entry.
  - `legal-approved` has two halves (stage `build + browser`, still one rule). The build half hashes the whole text
    of `main`, hidden parts included, and the values of `title`, `alt`, `aria-label`, `value` and `placeholder`; it
    fails hiding markup in or around `main` (`hidden`, `aria-hidden`, `dialog`, `template`, `visually-hidden`), and a
    lock that is not the text of `legal --write` (a duplicate key, another order or format). A finding with no entry
    names both hashes. The browser half runs in every `astro-kit test`, on the legal pages only: at 1280 and 390 px
    the text that a visitor is shown in `main` must be its whole text, so CSS that hides a part fails, and so does a
    pseudo-element that adds text. It also hashes the live text of `main` in Chromium, read as the build reads it,
    and compares it with the entry of the lock (without one, with the build): a script that changes a word after
    the page loads fails, with both hashes. One finding for each page; the spec lists what it does not measure.
  - The browser half judges text in a `display: contents` element by the nearest element with a box
    (`checkVisibility` is false for a boxless element), so a shown legal page with such an element passes.
  - A `::before`, `::after` or `::marker` adds text only when a visitor is shown it: a hidden, transparent, zero-opacity
    or zero-size pseudo-element, or one inside an element that is not rendered, passes.
  - The rendering of `wrangler.jsonc` (10.4) is now in the format of the Biome preset for any settings, and the
    preset formats it like every other file: the objects that hold a setting are expanded, and the destination
    addresses stand one on each line after a comment line.
  - The TS preset sets `"jsx": "preserve"` and `"jsxImportSource": "solid-js"`, so an island needs no pragma.
  - The test site passes `check`: its sources have the form of the Biome preset, and it commits the
    `legal.lock.json` that `legal --write` wrote. The `site` case runs `check` and `legal --check`; the `static`,
    `islands` and `origins` variants run `check` (the `check` of the `site` case stands in for the `forms` variant);
    the `check-config` variant and the `config` set of the planted sets join; the `build` set gets its
    `legal-approved` plant. The `a11y-no-js` plant of the `browser` set adds its link to the footer, and the
    `perf-lcp-priority` image has `role="presentation"` and no `alt`, so neither changes the locked text of a legal
    page and gives `legal-approved` as well.
- Milestone M9, part 9c: the command `init` and the site templates in `templates/site/`. The kit has 123 rules.
  - `init --site --locales --owner [--features]` writes `astro-kit.json` with the defaults of 5.3, `package.json`
    with the pins, the three source shims, the feature shims, `AGENTS.md` with the kit block, `CLAUDE.md`
    (`@AGENTS.md`), `KIT-FEEDBACK.md`, `.mcp.json`, `.gitignore`, `.node-version`, the `docs/spec.md` and
    `docs/design.md` skeletons, the facts and data files and the style skeletons. It keeps every file that exists
    unless `--force`, and it never overwrites `astro-kit.json`, whose values win over the flags. `--shims` writes
    only the shims and the shims of the enabled features. It prints `wrote` and `kept` lines and a "Next:" block,
    and no passed line.
  - `init --protected` fails with a message and exit 1, and `init` writes no protected file of 10.6 and no
    `.claude/settings.json`: parts 9d and 9e of M9 render them.
  - `config-shim` compares the kit block of `AGENTS.md` and needs the line `@AGENTS.md` in `CLAUDE.md`, in every
    run of preflight. Its hint says where the block comes from.
  - The acceptance suite gets the fresh init (`fresh-init.test.ts`): `check` gives `design-format`, and with a
    design `check` passes and `build` gives `legal-pages` and `routes-404`. The `islands` variant runs
    `init --shims` in place of copying the ESLint shim.
- Milestone M9, part 9c, after review: `init` refuses links and keeps the owner's files.
  - A planning pass reads every path of init with `lstat` before the first write and follows no link. A symbolic
    link on a path, a hard link, a folder where a file goes, or a link or file where a folder goes fails with
    `astro-kit init: <path> is not a file` (or `is not a folder`), exit 1, and nothing is written. A new file is
    opened with `wx`. So init can no longer write outside the project or into a protected file through a link, and
    a failed run never leaves a part of a project or a raw `EEXIST` or `EISDIR`.
  - `--force` rewrites only the kit's files: the shims, the feature shims, `.gitignore`, `.node-version`,
    `tokens.css` and the `.gitkeep` files. It keeps `astro-kit.json`, `package.json`, the agent files,
    `KIT-FEEDBACK.md`, `.mcp.json`, `docs/spec.md`, `docs/design.md`, the data files, `elements.css` and
    `fonts.css`, and prints `kept` for each.
  - The feature shims are listed per feature; a missing template throws.
  - `config-shim` drops a leading byte order mark in both agent files, fails a kit block inside a code fence, and
    needs `@AGENTS.md` as the first line of `CLAUDE.md` that is not empty. Its hint says that `init --shims` needs
    valid settings and that `init --force` keeps `AGENTS.md`.
  - The "Next:" block says that `check` reports `config-wrangler` until a later kit version writes the protected
    files.
  - The style skeletons `tokens.css` and `elements.css` hold one comment in their layer block, so the kit's
    Biome preset passes them and the repository drops its `noEmptyBlock` override. A unit test runs the shipped
    preset on every CSS, JSON and script file that init writes.
- Milestone M9, part 9d: the kit identity script, the SessionStart hook and the rule `config-kit-identity`. The kit
  has 124 rules.
  - `.github/kit-identity.sh` is the exact script of 10.3, in `templates/site/_github/`. It checks `.npmrc`, refuses
    `npm-shrinkwrap.json`, every lockfile entry that is no npm registry tarball under its own name and version with
    an integrity hash, and a kit entry without a `sha512` hash or with a version lower than on the base. Its
    `::error::` lines name `config-kit-identity`, a ci rule of the config group.
  - `init` also writes `.github/kit-identity.sh`, `.npmrc` (`ignore-scripts=true`, `save-exact=true`) and
    `.claude/settings.json`. Its SessionStart hook runs `kit-identity.sh` before `npm ci --ignore-scripts`, installs
    only when the lockfile changed (`node_modules/.kit-stamp`), keeps the output of the script and of npm off the
    session, and prints `INDEX.md`. `--force` rewrites the two protected files and `.claude/settings.json`. A
    project's own Claude Code settings go in `.claude/settings.local.json`, which `.gitignore` now lists.
  - `config-shim` compares `kit-identity.sh` and `.npmrc` with the kit's rendering byte for byte in every run of
    preflight, each when it exists, until part 9e of M9 makes the protected files required. It compares
    `.claude/settings.json` with the text of 12.3 like a shim, and a missing file fails; the test site gets the file.
    A symbolic link at one of these paths fails with `is a link, not a file`.
  - Hardening after the reviews of part 9d. `kit-identity.sh` fails an `.npmrc` that is not the text of 12.2 byte for
    byte, and an `npm_config_` variable of the environment that sets the registry, `strict-ssl`, `ignore-scripts` or
    `replace-registry-host`. A proxy is allowed: `proxy`, `https-proxy`, `HTTPS_PROXY` and `HTTP_PROXY` only tunnel
    TLS, and `strict-ssl` stays on. The machine's npm config is trusted: `userconfig`, `globalconfig`, `ca`, `cafile`,
    `prefix` and the user and global npmrc are not checked, because a pull request changes only the repository. It
    fails a `BASE_REF` that is not a plain branch name and a kit version on the base that is not plain. It skips only
    a nested entry with `inBundle: true` and no `resolved` and no `integrity`. It fails a lockfile that is not JSON
    with an object `.packages` with a fixed line, a kit version that is not plain `X.Y.Z`, and, in GitHub Actions, a
    base ref that is not in the clone. Its patterns anchor at the end of the text, and it prints a bad key without its
    control characters.
  - The SessionStart hook keeps the sha256 of the lockfile, of the kit's `INDEX.md` and of its `package.json` in the
    stamp, so an edited `INDEX.md` runs `npm ci` again. It prints a fixed line instead of `INDEX.md` when the kit
    folder or a file of it is a link, and asks for `npm install --package-lock-only --ignore-scripts` when there is
    no lockfile.
  - The SessionStart hook runs `npm ci` with `--registry=https://registry.npmjs.org/`,
    `--replace-registry-host=never` and `--strict-ssl=true` after `--ignore-scripts --no-audit --no-fund`, so no npmrc
    of the machine moves the download host, runs a script or turns TLS checks off; the install steps of `site.yml`
    (part 9e), the protected task and the rehearsal of M13 use the same flags. Its link check also covers
    `node_modules` and `node_modules/@raess`.
  - Every install of a site uses a fresh, empty, private npm cache (`--cache "$c"`, `c` from `mktemp -d`, removed
    after the install whatever its result): the SessionStart hook, the install steps of `site.yml` (part 9e), the
    protected task and the rehearsal of M13. npm's cache is keyed by the integrity hash, so a lockfile entry with the
    URL of one package and the hash of another cached tarball installed that tarball under the wrong name; with an
    empty cache npm downloads every tarball from its URL and fails with `EINTEGRITY`. `kit-identity.sh` also asks
    the registry for the hash of the kit version (`npm view` with the pinned flags and an empty cache of its own) and
    fails with a fixed line when it differs from the kit entry or when the registry gives none.
  - `init --protected` still fails and writes nothing: it renders all seven protected files from part 9e.
  - The acceptance suite gets the `identity` case (`identity.test.ts`, in `kit / acceptance`): the script passes the
    complete lockfile of the test site with the packed kit, and fails without the kit entry and on a local tarball.
- Milestone M9, part 9e: the site workflows and the protected files. The kit has 124 rules.
  - The kit renders all seven protected files of 10.6: `.github/workflows/site.yml` (jobs `ci`, `preview`, `merge`,
    `build`, `build-alert`, `deploy`, `smoke`, `rollback`, `feedback`, `protected`), `.github/workflows/site-merge.yml`
    (`merge-event`), `.github/dependabot.yml` (the exact text of 10.5), `.github/kit-identity.sh`,
    `.github/CODEOWNERS` (the code owner of the settings), `.npmrc` and `wrangler.jsonc`. Every action is pinned to a
    commit; every install step runs `kit-identity.sh`, `npm ci` with the pinned registry flags and an empty private
    cache, and `npm ls --all`; secrets sit only in the env of the step that needs them.
  - Plain `init` writes the seven, and the "Next:" block no longer names `config-wrangler`. `init --protected`
    rewrites only the seven from `astro-kit.json`, takes no other flag, and needs a valid `astro-kit.json`.
  - `config-shim` now requires the six protected files that it compares, and compares each byte for byte. A site
    without them, or with a hand-edited one, fails: the owner runs the protected task. `CODEOWNERS` is compared with
    valid settings only.
  - `templates/github-org-rulesets.json` holds the two rulesets of 10.2.
  - The test site holds the rendered protected files in `test/site/.github/`. GitHub runs no workflow from there;
    zizmor in `kit / scan` audits them.

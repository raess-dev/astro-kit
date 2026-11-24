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

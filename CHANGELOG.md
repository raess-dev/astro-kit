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

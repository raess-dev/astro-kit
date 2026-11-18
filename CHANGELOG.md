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

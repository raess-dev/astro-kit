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

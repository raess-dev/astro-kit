/**
 * The rule registry: the single source of every check the kit runs.
 * docs/standards.md is generated from it (`npm run docs`), so the docs and the checks cannot differ.
 * Each rule has a stable id, a group, a stage, a level, the waivable mark, the standard as one decidable sentence,
 * the failure message and a fix hint (specification, section 8).
 */

export type Stage = 'config' | 'build' | 'config + build' | 'browser' | 'ci' | 'smoke' | 'zone';

/** An `error` finding fails its command. A `warn` finding is printed and fails nothing (11.5). */
export type Level = 'error' | 'warn';

export interface Rule {
  id: string;
  group: string;
  stage: Stage;
  level: Level;
  /** True when the owner may switch this rule off for one place, until a date (section 8, Waivers). */
  waivable: boolean;
  /** The rule, stated once as a decidable condition. */
  standard: string;
  /** What the failure means, printed with the finding. */
  message: string;
  /** How to fix it. */
  hint: string;
}

/**
 * The waivable rules of section 8. An entry that ends with `-*` covers every rule id with that prefix.
 * No rule of the config, routes, csp, edge, origins, forms, modes or design groups is here, and no ci, smoke or zone
 * rule: they protect the trust chain, the visitor's data or the build itself.
 */
export const WAIVABLE: readonly string[] = [
  'budget-*',
  'js-budget',
  'images-attrs',
  'images-format',
  'images-priority',
  'fonts-limit',
  'head-title',
  'head-description',
  'head-og',
  'head-jsonld',
  'headings-*',
  'links-generic',
  'links-same-name',
  'links-depth',
  'facts-value',
  'content-*',
  'css-element-coverage',
  'css-unused',
  'media-*',
  'svg-name',
  'html-validate',
  'legal-statement',
  'a11y-*',
  'contrast-pairs',
  'perf-*',
];

/** Says whether section 8 lists the rule id as waivable. */
export function isWaivable(id: string): boolean {
  return WAIVABLE.some((entry) => (entry.endsWith('-*') ? id.startsWith(entry.slice(0, -1)) : id === entry));
}

/** Builds one registry entry. The waivable mark comes from the one list above. */
export const r = (
  id: string,
  group: string,
  stage: Stage,
  standard: string,
  message: string,
  hint: string,
  level: Level = 'error',
): Rule => ({ id, group, stage, level, waivable: isWaivable(id), standard, message, hint });

/**
 * Every rule of the kit, in the order of section 8. Each milestone adds the rules that it delivers (specification,
 * section 14). A standard holds the whole rule, also where a later milestone adds a part of the check.
 */
export const RULES: readonly Rule[] = [
  // config
  r(
    'config-options',
    'config',
    'config',
    '`astro-kit.json` exists and matches the strict schema of the kit. `site.json` at the root exists and matches its schema, and `glossary.json`, when it exists, matches its schema. Findings name the field path. A looser limit fails.',
    'The settings, the facts or the glossary are missing or not valid.',
    'Fix the field that the finding names. `npx --no astro-kit settings --html settings.html` shows every setting with its rule.',
  ),
  r(
    'config-shim',
    'config',
    'config',
    "`astro.config.mjs`, `biome.json` and `tsconfig.json` equal the kit shims after CRLF→LF and trimEnd + newline, and no other `astro.config.*` file exists. The root `biome.json` is the only Biome config: no other file named `biome.json`, `biome.jsonc`, `.biome.json` or `.biome.jsonc` exists in any folder of the project, outside `.git` and the folders that Biome skips (`node_modules`, `dist`, `.astro`, `.wrangler`). The rendered protected files equal the kit's rendering for the settings, compared in the same way: `.github/workflows/site.yml`, `.github/workflows/site-merge.yml`, `.github/dependabot.yml`, `.github/kit-identity.sh`, `.github/CODEOWNERS` and `.npmrc` (a file that does not match gets the hint of the protected task). `AGENTS.md` holds the kit block, and `CLAUDE.md` holds the line `@AGENTS.md`. Feature shims (`eslint.config.mjs`, `src/pages/api/forms/[form].ts`) are compared in `check`.",
    'A file that the kit manages is missing or differs from the text of the kit, or the project holds a second config file.',
    'For a shim, run `npx --no astro-kit init --shims --force`. Remove every other Astro or Biome config file. For a protected file: The protected files do not match the settings. Say so in the pull request: the owner starts the protected task for this branch.',
  ),
  r(
    'config-locked',
    'config',
    'config',
    'No integration or config changes a value that the kit locks in the Astro config: `site`, `output`, `trailingSlash`, `prerenderConflictBehavior`, `compressHTML`, `build`, `image`, `security`, `prefetch`, `markdown`, `session`, `vite.build.cssTarget` and `vite.ssr.noExternal`. The finding names the key, and its detail is `<actual> instead of <expected>`.',
    'A value that the kit locks in the Astro config was changed.',
    'Remove the integration or the setting that changes the value. Every option of a site lives in `astro-kit.json`.',
  ),
  r(
    'config-adapter',
    'config',
    'config',
    'The project sets no adapter; the kit adds `@astrojs/cloudflare` only with forms.',
    'The Astro config has an adapter that the kit did not add.',
    'Remove the adapter. For a form, the owner turns on `features.forms`, and the kit adds the adapter.',
  ),
  r(
    'config-experimental',
    'config',
    'config',
    "No truthy experimental flag other than `collectionStorage: 'single-file'`.",
    'The Astro config turns on an experimental flag.',
    'Remove the experimental flag.',
  ),
  r(
    'config-i18n',
    'config',
    'config',
    "The project sets no `i18n`; the resolved `i18n` equals the kit's.",
    'The `i18n` of the Astro config is not the one that the kit sets.',
    'Remove `i18n` from the Astro config. The kit sets it from `locales` and `defaultLocale` in `astro-kit.json`.',
  ),
  r(
    'config-imports',
    'config',
    'config',
    'No source imports `astro:transitions` or `astro:transitions/client` (regex on `src/**/*.{astro,ts,tsx,js,mjs,jsx,mts,cts,cjs}`). White space and comments may stand between `from`, `import(` or `require(` and the module name.',
    'A source file imports `astro:transitions`.',
    'Remove the import and use native CSS view transitions.',
  ),
  r(
    'config-suppression',
    'config',
    'config',
    'Nothing takes a file out of the checks. `src/` contains no `biome-ignore`, `@ts-ignore`, `@ts-expect-error` or `@ts-nocheck`, in any letter case (`.astro .ts .tsx .js .mjs .jsx .mts .cts .cjs .css .md .mdx`). Each of these files has at most 1,048,576 B. No folder under `src/` or `public/` is named `node_modules`, `dist`, `.astro` or `.wrangler`, and no symbolic link there leads into such a folder. No symbolic link under `src/` or `public/` leads out of the project, and neither folder is such a link.',
    'A comment switches a check off, or a file lies where the checks do not read it.',
    'Remove the comment and fix the cause. Rename the folder, split the large file, or replace the link with a file inside the project. If the check is wrong, add an entry to `KIT-FEEDBACK.md`.',
  ),
  r(
    'config-server',
    'config',
    'config',
    'The project has no server code of its own: no `src/middleware.*` file and no `src/middleware/` folder, no `src/actions/` folder and no `src/actions.*` file, and no `server:defer` in a `.astro` file under `src/`.',
    'The project has server code of its own.',
    'Remove the middleware, the actions and `server:defer`. For a form, use the forms feature of the kit.',
  ),
  r(
    'config-waiver',
    'config',
    'config',
    'Each entry of `waivers` names a waivable rule. Its `until` is today or later, and at most 90 days after today (UTC). The message for an old entry: `the waiver for <rule> on <where> ended on <until>: fix the page, or ask the owner for a new date`.',
    'A waiver is not valid.',
    'Remove the waiver, or name a waivable rule and ask the owner for an `until` from today to 90 days ahead.',
  ),
  r(
    'config-overrides',
    'config',
    'config',
    '`package.json` has no `overrides` or `resolutions`.',
    '`package.json` changes which package versions npm installs.',
    'Remove `overrides` and `resolutions` from `package.json`.',
  ),
  r(
    'config-dep-spec',
    'config',
    'config',
    'Every dependency other than the kit has a spec of the npm registry: a version, a range or a tag. The trimmed spec matches `^(?!\\.)(?!.*\\.(tgz|tar|tar\\.gz)$)[\\w.*~^<>=|+ -]*$` in any letter case, in dependencies, devDependencies or optionalDependencies.',
    'A dependency does not come from the npm registry.',
    'Install the package from the npm registry with an exact version, for example `1.2.3`.',
  ),
  r(
    'config-dep-allowlist',
    'config',
    'config',
    'Dependencies are only: `astro`, `@raess/astro-kit`, `wrangler`; with forms `@astrojs/cloudflare`; with islands `@astrojs/solid-js`, `solid-js`, `eslint`, `eslint-plugin-solid`, `typescript-eslint`; plus `dependencies`. The rule reads dependencies, devDependencies, optionalDependencies and peerDependencies. A `package.json` that is not a JSON object fails, and so does a section that is not an object.',
    'A dependency is not on the allowed list, or `package.json` cannot be read.',
    'Remove the package, or ask the owner to add it to `dependencies` in `astro-kit.json`. Fix `package.json` when it is not a JSON object with objects as dependency sections.',
  ),
  r(
    'config-public-shadow',
    'config',
    'config',
    '`public/` holds none of `robots.txt`, `_headers`, `_redirects`, `.well-known/security.txt`, `_kit`, `sitemap*.xml`.',
    '`public/` holds a file that the kit writes.',
    'Delete the file from `public/`. The kit writes it into `dist/` at the end of the build.',
  ),
  r(
    'config-wrangler',
    'config',
    'config',
    "Only `wrangler.jsonc` exists (no `.json` or `.toml`). It equals the kit's rendering for the settings, after CRLF→LF and trimEnd + newline. The rendering has full-line `//` comments only and no trailing commas, because the deploy job reads it with `jq`. A file that does not match gets the hint of the protected task.",
    '`wrangler.jsonc` is missing or differs from the text that the kit renders for the settings, or the project holds a second wrangler config.',
    'The protected files do not match the settings. Say so in the pull request: the owner starts the protected task for this branch.',
  ),
  // routes
  r(
    'routes-on-demand',
    'routes',
    'config',
    'Every project route is prerendered. The one exception, with forms: the route with the pattern `/api/forms/[form]` whose entrypoint is the feature shim `src/pages/api/forms/[form].ts`.',
    'A route of the project is rendered on demand.',
    'Remove `export const prerender = false` from the route, or remove the route. For a form, use the forms feature of the kit.',
  ),
  r(
    'routes-slug',
    'routes',
    'config + build',
    'Every built page path other than `/404.html` ends in `/` (`…/index.html`), and each of its segments matches `^[a-z0-9]+(-[a-z0-9]+)*$`. A default-locale path does not start with a locale code or a reserved segment (`_astro`, `_actions`, `_server-islands`, `_image`, `_kit`, `api`, `500`, `.well-known`). A non-default path has no reserved segment after `/<code>/`. A `404` segment is left to `routes-404`, so it reports once. **The endpoint clause,** checked on the resolved routes: a project route of type `endpoint`, other than the form shim, is a static file route. Its pattern ends with a literal file extension `.<ext>` (`[a-z0-9]+`) that is not `html` or `htm`. Its first segment holds no parameter (`[`) and is not a reserved segment. When the first segment is a locale code, the second segment holds no parameter and is not a reserved segment. A parameter can stand for any name, so the kit cannot know which file it writes there. For example, `/[name].txt` and `/[dir]/[file].json` fail, and `/live.json` and `/feeds/[lang].json` pass. Its pattern is none of `/robots.txt`, `/_headers` and `/_redirects`, and no `/sitemap*.xml`. So a project endpoint can never write the file of a page or a file that the kit writes. `routes-on-demand` still requires it to be prerendered.',
    'A page path is not a clean slug path, or an endpoint is not a static file route.',
    'Rename the page so that each segment has only lower-case letters, digits and single hyphens, and starts with no reserved segment. Give an endpoint a fixed first segment and a file extension other than `.html`.',
  ),
  r(
    'routes-redirects',
    'routes',
    'config + build',
    '`redirects.json` rows are `{from, to}` or `{from, gone: true}`. `from` starts with `/` and has no whitespace, no `?` ("query strings cannot be matched; mark it gone or add a zone Single Redirect") and no `#` ("fragments cannot be matched: a browser never sends the text after #"). No duplicate `from`. `to` starts with `/`, not with `//` or `/\\`, and has no whitespace, so a row writes one line and never leaves the site. Neither `from` nor `to` holds a backslash, and neither path holds a `.` or `..` segment, also not as `%2e`: Cloudflare removes such a segment, so it would store another path, and a `to` such as `/.//host/` would leave the site. The path of a `to` ends before its `?` or `#`. No chains (the path of no `to` is a `from`). Limits: 2,000 static, 100 dynamic, 1,000 characters per line. Every literal `to` is built (patterns, and `/api/` with forms, are skipped).',
    '`redirects.json` is not valid.',
    'Fix the row that the finding names. Point each `to` at a built page, or mark the row `gone`.',
  ),
  // images
  r(
    'images-public',
    'images',
    'config',
    '`public/` holds no raster file (`.png .jpg .jpeg .gif .webp .avif .bmp .tif .tiff`) except `favicon.ico`, `apple-touch-icon.png`, `og.png`, `og.jpg`.',
    '`public/` holds an image that Astro does not optimize.',
    'Move the image to `src/assets/` and render it with `<Picture>`.',
  ),
  r(
    'images-original',
    'images',
    'config',
    'Every raster file under `src/` is ≤ 2,560 px on its long edge and ≤ 3,145,728 B. The size is read from the PNG, GIF, WebP or JPEG header. A `.png`, `.gif`, `.webp`, `.jpg` or `.jpeg` file without such a header fails. So does a JPEG file with more than 4,096 markers and fill bytes before its frame header. A raster file of another format has the byte limit only.',
    'An image original is too large, or the kit cannot read its size.',
    'Scale the file down to at most 2,560 px on its long edge and at most 3,145,728 B. Replace a file that has no image header with the real image.',
  ),
  // facts
  r(
    'facts-schedule',
    'facts',
    'config',
    '`schedule.json` matches its strict schema.',
    '`schedule.json` is missing or not valid.',
    'Fix the field that the finding names. Days are `Mo` to `Su`, times are `HH:MM` and dates are `YYYY-MM-DD`.',
  ),
  // css
  r(
    'css-sources',
    'css',
    'config + build',
    "CSS exists only in the kit's `css/base.css`, `tokens.css`, `elements.css`, `fonts.css`, `components/*.css` and `pages/**/*.css` (plus `.gitkeep`). No `<style>` in `.astro`, `.md`, `.mdx`, `.tsx` or `.jsx`, with or without `is:global`. No `<link rel=\"stylesheet\">` in source or in built HTML. A component imports no CSS file other than its own (a missing file or import is left to `css-component-file`); a route only its own page file; `src/layouts/**` and anything else import none; nothing imports `tokens.css`, `elements.css` or `fonts.css`. An import counts in the frontmatter and the `<script>` elements of `.astro`, in a template expression (`{import('…')}`) of `.astro` and `.mdx`, and in the ESM blocks of `.mdx`; the YAML frontmatter of `.md` and `.mdx` imports nothing. No `import.meta.glob()` there has a pattern (a string, or a string of an array) that can match a style file: one that ends in a style extension, or in a wildcard such as `*`, `**` or `a.*`, or in a brace group with such an alternative (`*.{js,css}`); a negative pattern (`!…`) adds no file. `src/styles/elements.css` and `src/styles/fonts.css` exist, because the kit imports both into every page; `fonts.css` may be empty. A missing file is named at its path (a missing `tokens.css` is left to `design-tokens`, and a file that the kit does not read to `config-suppression`). No `.css` in `public/`. Built: each page has one `<style>` of project CSS (7.2); Astro's island style, a chunk with an `@import` (`css-banned`'s) and a `<style>` with a fact of `css-layer-order` do not count.",
    'CSS stands in a place where the kit does not allow it, a file imports CSS that is not its own, or a file that the kit imports into every page is missing.',
    'Move the CSS into `elements.css`, the file of its component or the file of its page. Remove the `<style>`, the `<link rel="stylesheet">`, the glob and the import of another file. A component imports only `src/styles/components/<kebab>.css`, and a route only its page file. Create a missing `src/styles/elements.css` or `src/styles/fonts.css`; `fonts.css` may be empty.',
  ),
  r(
    'css-layer-file',
    'css',
    'config',
    'Each project CSS file except `fonts.css` is exactly one top-level `@layer <its layer> { … }`, with no nested `@layer`. `fonts.css` holds only `@font-face` rules, outside any layer. A parse problem of a project CSS file fails this rule too. `tokens.css` is left to `design-tokens`, and a top-level `@import` or `@scope` to `css-banned`.',
    'A project CSS file is not one block of its own layer, or it is not valid CSS.',
    'Put the whole file into one `@layer elements { … }`, `@layer components { … }` or `@layer page { … }` block, and remove every other `@layer`. Keep only `@font-face` rules in `fonts.css`. Fix the CSS that the finding names.',
  ),
  r(
    'css-layer-order',
    'css',
    'build',
    "Each page's built layer order is `astro, reset, tokens, elements, layout, components, page`. The sub-layers `astro.*` belong to `astro`; no other layer has a sub-layer, and no layer is anonymous. No rule is unlayered except `@font-face`, the kit's `@view-transition` and Astro's island style (7.1). A parse problem of built CSS fails this rule too. `@import` and `@scope`, and what an `@scope` holds, are left to `css-banned`.",
    'The CSS of a built page has another layer order, an unlayered rule, or a text that is not valid CSS.',
    'Remove the integration, the file or the rule that adds a layer or unlayered CSS. Project CSS lives only in the layers `elements`, `components` and `page`.',
  ),
  r(
    'css-literal',
    'css',
    'config + build',
    'No literal outside the 7.3 allowlist, no `var()` fallback, no custom property outside `tokens.css` except locals and helper parameters (a local in another file than its own, and a helper parameter on a component root, are left to `css-local-var`). The preludes of `@media` and `@container` are left to `css-media`. Kit layers, `tokens` and `@font-face` are exempt. The built half accepts the forms that the minifier gives an allowed value (13.1 items 4 and 40), and a list of component roots that the minifier merges (`.card,.box{--stack-gap:…}`) is a root in each selector. What an `@scope` holds is left to `css-banned`.',
    'A value holds a literal that the kit does not allow, a `var()` fallback or a custom property of its own.',
    'Use a token of `docs/design.md` with `var(--token)`, without a fallback. If no token fits, ask the owner for a new one in `docs/design.md`.',
  ),
  r(
    'css-token-family',
    'css',
    'config + build',
    "Every `var()` names a family the property accepts (7.3). `padding: var(--color-x)` fails. It also checks the four limits of 7.4 that depend on the value of the token: no `--space-` value with a percentage in `scroll-margin` and its longhands, no shadow with `inset` or with four lengths in `text-shadow`, no `--size-` value with a percentage in `contain-intrinsic-size`, and a ratio of `--size-` in `aspect-ratio` and nowhere else. A local is checked with each token that its root sets it to (a modifier, a state or an `@media` block may set it again). A helper parameter, in `## Layout helpers` or set again on a component root, keeps the limits where the kit's helpers read it (7.6): a `--size-` parameter is a length there, so a ratio fails.",
    'A property reads a token of a family that it does not accept, or a token value that it cannot use.',
    'Use a token of the family that the property takes, for example `--space-` for `padding` and `--color-` for `color`.',
  ),
  r(
    'css-local-var',
    'css',
    'config + build',
    'Each `--<c>-*` is defined only on the root of `components/<c>.css`, is set to exactly one `tokens.css` token, and is read only there. Helper parameters re-set in a root use a token of their family.',
    'A component local is defined, set or read outside the rules of 7.8.',
    'Define `--<kebab>-<name>: var(--token)` on the root rule of `components/<kebab>.css` only, and read it only in that file. Re-set a helper parameter on the root to a token of its family.',
  ),
  r(
    'css-var-undefined',
    'css',
    'config + build',
    "Every `var()` in a declaration value of project CSS, and of built CSS outside the kit's `layout` layer, is a `tokens.css` name (helper parameters included) or an in-scope local. A helper class used on a built page needs its parameters defined in `tokens.css` (7.5).",
    'A `var()` names a custom property that `tokens.css` does not define and that is no local of the component.',
    'Use a token of `docs/design.md` or a local of the same component. For a layout helper, list its parameters under `## Layout helpers` in `docs/design.md` and run `npx --no astro-kit tokens`.',
  ),
  r(
    'css-selector',
    'css',
    'config + build',
    'The selector and at-rule shapes of 7.1: which selectors and which at-rules each layer holds. Values, custom properties, `!important`, `@import`, `@scope` (with what it holds) and `:global()` are left to `css-literal` and `css-banned`, nested `@layer` to `css-layer-file`, and the properties of page files to `css-page`; the selectors and at-rules of page files are checked here (7.9). No id; no bare `&` outside a nested rule; specificity ≤ (0,3,x), where the root class of a component is not counted (7.11); ≤ 4 compounds. A problem of a nested rule stands at the line of that rule, also where its resolved selector holds the parent.',
    'A selector or an at-rule does not have the shape that its layer allows.',
    'In `elements.css` select elements; in a component file start each selector at the root class `.<kebab>`; in a page file select component roots only. Use no id, at most 3 classes, attributes or pseudo-classes, and at most 4 compounds.',
  ),
  r(
    'css-classes',
    'css',
    'build',
    'Every class in built HTML is defined in `elements.css` (variants), `base.css` (`.visually-hidden` and the four layout helpers) or a component file (root, part, modifier). `[class~=x]` and `[class=x]` define `.x` there (7.1).',
    'A built page uses a class that no CSS file of the project or of the kit defines.',
    'Remove the class, or define it in the file of its component (`.<kebab>`, `.<kebab>__<part>`, `.<kebab>--<mod>`) or as a variant in `elements.css` (`a.button`).',
  ),
  r(
    'css-banned',
    'css',
    'config + build',
    "None of: a `style` attribute; `is:global` (on a `<style>` it is part of the `<style>`: `css-sources`'s) or `:global()`; viewport units (`vw`, `vi`, `vmin`, `vmax` and their `d`, `l` and `s` forms) that a `var()` brings, after token substitution (a local brings each token that it is set to, also by a modifier, a state or an `@media` block), on `width`, `inline-size`, their `min-` and `max-` forms, or `margin*` (a viewport unit written in the value is a literal: `css-literal`'s); `forced-color-adjust: none`; `overflow` with `hidden` or `clip` as its first value (the x axis), or `overflow-x` or `overflow-inline` set to `hidden` or `clip`, on `html`, `body` or `:root`, also through `:is()` and `:where()`; `!important` in project layers (on a non-placement declaration of a page file it is `css-page`'s); `@import`; `@scope`, with what it holds: no other rule reads it; `url()` outside `@font-face` (a string in `image-set()` is a URL too).",
    'The project uses a construct that the kit bans.',
    'Remove it. Style through the files of the layers, not with a `style` attribute. Use `100%` for a full width, an `<img>` or `<Picture>` for an image, and a token for every value.',
  ),
  r(
    'css-media',
    'css',
    'config + build',
    'Every length in an `@media` or `@container` prelude equals a declared breakpoint; no `var()` in a prelude (only the config half can report it, 7.10); only the features of 7.10. A mode feature in `@media` with a switch option on is left to `modes-media`; in `@container` it is no container feature and fails here (7.10). `@supports` and `@starting-style` have no prelude rule. What an `@scope` holds is left to `css-banned`.',
    'An `@media` or `@container` prelude uses a length that is no breakpoint, a `var()` or a feature that the kit does not allow.',
    'Write a width of `## Breakpoints` in `docs/design.md` literally, for example `@media (width >= 48rem)`, and use only the features of 7.10.',
  ),
  r(
    'css-unused',
    'css',
    'build',
    'Every class defined in project CSS (`[class~=x]` and `[class=x]` define `.x`, 7.1) appears on at least one built page. A class of a component whose source is `.tsx` also counts as used when a built `/_astro/*.js` file holds its name as a whole word (`(?<![\\w-])<class>(?![\\w-])`). `base.css` is exempt.',
    'A class of the project CSS appears on no built page.',
    'Remove the rule of the class, or use the class on a page.',
  ),
  r(
    'css-page',
    'css',
    'config + build',
    "Page files hold only the placement properties of 7.9. Their selectors and at-rules are `css-selector`'s (7.9). Every other declaration of a page file (in built CSS: of the `page` layer) is this rule's alone, custom properties, `color-scheme` and `!important` too: no value rule, no design rule and not `css-banned` reports it again.",
    'A page file sets a property that is not a placement property.',
    'Keep only placement properties (`grid-*`, `order`, `align-*`, `justify-*`, `place-*`, `gap`) in the page file. Put every other property into the file of the component.',
  ),
  r(
    'css-element-coverage',
    'css',
    'build',
    'Every element below that appears on a built page has a matching rule in `elements.css`: `h1`–`h6`, `p`, `a`, `strong`, `em`, `small`, `blockquote`, `ul`, `ol`, `li`, `dl`, `dt`, `dd`, `table`, `caption`, `th`, `td`, `figure`, `figcaption`, `hr`, `code`, `pre`, `button`, `input` (per `type`; a bare `input` rule covers all), `select`, `textarea`, `label`, `fieldset`, `legend`, `details`, `summary`, `dialog`. A rule matches when its subject compound has the element\'s type and nothing that narrows it: no pseudo-class, no pseudo-element and no attribute selector, except one `[type=x]` on `input`. Each argument of `:is()` and `:where()` is the same element, so `:is(h1, h2)` matches both, and `input:is([type=radio], [type=checkbox])` matches those two types. An element matches every `:is()` and `:where()` of a compound: `:is(h1, h2):is(h2, h3)` matches `h2` alone, and `input:is([type=radio], [type=checkbox]):where(:disabled)` matches no input. `input:disabled` and `input:not([type=checkbox])` match no input. A rule with a class matches only an element with that class: `h1.lead` matches `<h1 class="lead">`, not `<h1>`. Every `type.class` variant used, on any element, needs its own rule: with `a.button` in `elements.css`, `<span class="button">` needs `span.button`. Exempt: `div`, `span`, `section`, `article`, `header`, `nav`, `main`, `aside`, `footer`; they need no rule of their own. Other elements need no rule.',
    'An element or a variant on a built page has no rule in `elements.css`.',
    'Add a rule for the element or the variant to `elements.css`, with tokens for its values.',
  ),
  r(
    'css-component-file',
    'css',
    'config',
    'Each `src/components/**/<Name>.astro|.tsx` has `src/styles/components/<kebab>.css` with root class `.<kebab>` and imports it. Each component CSS file has its component. Names are unique.',
    'A component and its CSS file do not match.',
    'Give each component `src/styles/components/<kebab>.css` with the root class `.<kebab>`, import it in the component, remove a CSS file that has no component, and give each component a name of its own.',
  ),
  // design
  r(
    'design-format',
    'design',
    'config',
    '`docs/design.md` exists and has the required sections, the exact table headers, known prefixes in the right section, no duplicate names, values that parse (so no color holds `color-mix()` or `color(display-p3 …)`), at least one of the base themes `light` and `dark`, `light` when `light-contrast` is declared, `dark` when `dark-contrast` is declared, a value or a fallback for every Color cell, ≥ 1 Color row, ≥ 1 `--font-` and ≥ 1 `--text-` row, ≥ 1 Spacing row, and ≥ 1 pair. The other design rules run only when it passes.',
    '`docs/design.md` is missing or does not have the form that the kit reads.',
    'Fix the section, the table header, the token name or the value that the finding names. The owner approves each change to `docs/design.md`.',
  ),
  r(
    'design-tokens',
    'design',
    'config + build',
    '`src/styles/tokens.css` equals the text that the kit renders from `docs/design.md` and the mode options, after CRLF→LF and trimEnd + newline. The hint is `run npx --no astro-kit tokens`. Built: the built `tokens` layer defines every token and helper parameter of `docs/design.md`, and no other custom property. No rule compares values in built CSS.',
    '`tokens.css` is not the rendering of `docs/design.md` and the mode options.',
    'run npx --no astro-kit tokens',
  ),
  r(
    'design-specs',
    'design',
    'config + build',
    "Every Elements and Components row is implemented exactly (7.8): `elements.css` for an Elements row, and the file of the component for a Components row, has a rule whose selector equals the row's selector (normalized) and which declares `<property>: var(<token>)`. A Components row starts at the root of its component as `css-selector` reads a first compound: `:is(.card)`, `:where(.card)` and `[class~=card]` start at `.card`. A missing `elements.css` is left to `css-sources`, so the Elements rows report nothing then.",
    'A row of `## Elements` or `## Components` in `docs/design.md` has no rule that implements it.',
    'Add the rule with the selector of the row and the declaration `<property>: var(<token>)` to `elements.css` or to the file of the component.',
  ),
  r(
    'design-pairs',
    'design',
    'config',
    'Pairs use defined `--color-` tokens and known roles. The mandatory `body`, `link`, `focus` and `error` pairs exist, a `focus` pair of the focus color on each background. The focus color is the `outline-color` that the `:focus-visible` rule of `elements.css` sets (7.4). `elements.css` uses the body, link and focus pairs (a missing `elements.css` is left to `css-sources`). Every color token used as a foreground or background is in a pair in that position. A color token inside a `--gradient-` token that project CSS uses counts as a background, also through an alias of the gradient. What an `@scope` holds is left to `css-banned`.',
    'The contrast pairs of `docs/design.md` and the colors that the CSS uses do not fit together.',
    'Ask the owner for the missing pair in `## Contrast pairs` of `docs/design.md`, or use a color that a pair covers. `elements.css` sets the `body` pair on `body`, the `link` color on `a` and the `focus` color on `:focus-visible`.',
  ),
  // modes
  r(
    'modes-themes',
    'modes',
    'config',
    'The themes of `docs/design.md` serve the enabled mode options. `auto` and `light` need `light`. `dark` needs `dark`. `contrast` needs `light-contrast` when `light` is declared and `dark-contrast` when `dark` is declared. Each declared theme has an enabled option that reaches it: `light` through `auto` or `light`, `dark` through `auto` or `dark`, `light-contrast` and `dark-contrast` through `auto` or `contrast`. It runs only when `design-format` passes.',
    'The themes of `docs/design.md` and the mode options of `astro-kit.json` do not fit together.',
    'Ask the owner: either `modes` in `astro-kit.json` changes, or `docs/design.md` gets the missing theme or loses the theme that no option reaches.',
  ),
  r(
    'modes-media',
    'modes',
    'config + build',
    'With a `light`, `dark` or `contrast` option on, no `@media` prelude outside `tokens.css` (in built CSS: outside the `tokens` layer) uses `prefers-color-scheme` or `prefers-contrast`, and no HTML `media` attribute uses them (`picture source`, `link`, `meta[name=theme-color]`; an example in a fenced code block or a code span of `.md` or `.mdx` is text, not markup): the switch cannot change them. In an `@container` prelude they are no container features: `css-media` reports them (7.10). In every case, no selector outside `tokens.css` and `base.css` (in built CSS: outside the `tokens`, `reset` and `layout` layers) names the `data-mode` attribute, and no declaration outside `tokens.css` (in built CSS: outside the `tokens` layer) sets `color-scheme`. The selectors of a page file (in built CSS: of the `page` layer) are left to `css-selector`, its other declarations to `css-page`, and what an `@scope` holds to `css-banned`.',
    'CSS or HTML outside `tokens.css` reads the color scheme or the contrast of the system, names `data-mode` or sets `color-scheme`.',
    'Use a color token: `tokens.css` maps each mode to its theme. For an image that changes with the theme, use an inline SVG that takes its colors from tokens.',
  ),
  // edge
  r(
    'edge-headers',
    'edge',
    'build',
    '`_headers` has ≤ 100 rules, lines ≤ 2,000 characters and no duplicate pattern. `/*` has the seven headers of the kit: nosniff, referrer and CORP exact; COOP `same-origin`, or `same-origin-allow-popups` with a `frame` or `script` origin; the CSP directive set equal to the header policy (compared sorted); HSTS max-age ≥ 31,536,000 with includeSubDomains; each Permissions-Policy item `name=()`, or `=(self)` only for `autoplay` and `fullscreen`, or `=(self "https://<host>" …)` with the sorted hosts of the origins whose `allow` names it. No `X-Frame-Options` or `Cross-Origin-Embedder-Policy` on any rule. Cache-Control only on `/_astro/*` (= `public, max-age=31536000, immutable`) or, with prefetch, on `/*` (= `public, max-age=120`); with prefetch, `! Cache-Control` is required and `/_astro/*` comes after `/*`.',
    'The built `_headers` file does not hold the headers of the kit, or holds a header that the kit does not allow.',
    'Remove the integration or the file that changes `_headers`. The kit writes this file at the end of the build.',
  ),
  r(
    'edge-redirects',
    'edge',
    'build',
    '`_redirects` has ≤ 2,000 static and ≤ 100 dynamic rules, lines ≤ 1,000 characters, line shape `from to [301|302|303|307|308]` with `from` starting `/` and no extra tokens, and static rules before dynamic ones. Each `from` and each `to` also passes the checks of `routes-redirects` on one path: no `?` and no `#` in `from`; `to` starts with `/` and not with `//` or `/\\`; no backslash and no `.` or `..` segment. So a line that another integration left cannot leave the site either.',
    'The built `_redirects` file is not valid for Cloudflare.',
    'Fix the rows of `redirects.json`, and remove the integration or the file that adds other lines to `_redirects`.',
  ),
  // legal
  r(
    'legal-processing',
    'legal',
    'config',
    '`processing` contains `cdn` and `previews`, and with forms `forms` and `server`; it contains `forms`/`server` only with forms.',
    '`processing` does not match the features of the site.',
    'List `cdn` and `previews`. List `forms` and `server` with `features.forms`, and only then.',
  ),
];

export type RuleMap = ReadonlyMap<string, Rule>;

export const RULE_BY_ID: RuleMap = new Map(RULES.map((rule) => [rule.id, rule]));

export const DOCS_PATH = 'node_modules/@raess/astro-kit/docs/standards.md';

/** One entry of `waivers` in astro-kit.json (5.2). */
export interface Waiver {
  rule: string;
  where: string;
  reason: string;
  /** The end date, `YYYY-MM-DD`. */
  until: string;
}

export interface Finding {
  rule: string;
  /** A built page path, a project file with a line, or a file with a field path (section 8, Where). */
  where: string;
  /** Specific detail: the value found, the limit, the element. */
  detail?: string;
  /** Set when a waiver covers the finding. A waived finding fails nothing. */
  waived?: { until: string; reason: string };
}

export function getRule(id: string, rules: RuleMap = RULE_BY_ID): Rule {
  const rule = rules.get(id);
  if (!rule) throw new Error(`astro-kit: unknown rule id ${id}`);
  return rule;
}

/**
 * Says whether the waiver covers the finding. The rule ids are equal, and the finding's place equals the waiver's
 * place or starts with it at a boundary: the waiver's place ends with `/`, or the next character of the finding's
 * place is `/`, `:` or a space.
 */
export function waives(waiver: Waiver, finding: Pick<Finding, 'rule' | 'where'>): boolean {
  if (waiver.rule !== finding.rule || waiver.where === '') return false;
  if (finding.where === waiver.where) return true;
  if (!finding.where.startsWith(waiver.where)) return false;
  if (waiver.where.endsWith('/')) return true;
  const next = finding.where[waiver.where.length];
  return next === '/' || next === ':' || next === ' ';
}

/** Marks each finding that a waiver covers. Only a waivable rule can be waived. */
export function applyWaivers(
  findings: readonly Finding[],
  waivers: readonly Waiver[],
  rules: RuleMap = RULE_BY_ID,
): Finding[] {
  return findings.map((finding) => {
    if (finding.waived || !getRule(finding.rule, rules).waivable) return finding;
    const waiver = waivers.find((w) => waives(w, finding));
    return waiver ? { ...finding, waived: { until: waiver.until, reason: waiver.reason } } : finding;
  });
}

/** Says whether the finding fails its command: an `error` rule, and no waiver. */
export function fails(finding: Finding, rules: RuleMap = RULE_BY_ID): boolean {
  return !finding.waived && getRule(finding.rule, rules).level === 'error';
}

/** The findings that fail the command. */
export function failures(findings: readonly Finding[], rules: RuleMap = RULE_BY_ID): Finding[] {
  return findings.filter((finding) => fails(finding, rules));
}

/**
 * The text of a result (specification, 6.4). A failing finding has `✗`, a `warn` finding has `!`, and a waived
 * finding has `~` on one line. Only the failing findings count in the first line: with none, the text has no such
 * line. With no finding at all, the text is empty. The text never holds the passed line of 6.4: only the command
 * line prints that line, once (`PASSED_LINE` in `cli.ts`).
 */
export function formatFindings(findings: readonly Finding[], rules: RuleMap = RULE_BY_ID): string {
  const count = failures(findings, rules).length;
  const lines: string[] = [];
  if (count > 0) lines.push(`astro-kit: ${count} finding${count === 1 ? '' : 's'}`);
  for (const finding of findings) {
    const rule = getRule(finding.rule, rules);
    const text = `[${rule.id}] ${finding.where}: ${rule.message}${finding.detail ? ` (${finding.detail})` : ''}`;
    if (finding.waived) {
      lines.push(`~ ${text} (waived until ${finding.waived.until}: ${finding.waived.reason})`);
      continue;
    }
    lines.push(`${rule.level === 'warn' ? '!' : '✗'} ${text}`);
    lines.push(`    fix: ${rule.hint}`);
    lines.push(`    rule: ${DOCS_PATH}#${rule.id}`);
  }
  return lines.join('\n');
}

export class FindingError extends Error {
  readonly findings: readonly Finding[];
  constructor(findings: readonly Finding[], rules: RuleMap = RULE_BY_ID) {
    super(formatFindings(findings, rules));
    this.name = 'AstroKitError';
    this.findings = findings;
  }
}

/** Collects findings; throws once with all of them, so one run reports everything. */
export class Report {
  readonly findings: Finding[] = [];
  private readonly waivers: readonly Waiver[];
  private readonly rules: RuleMap;

  constructor(options: { waivers?: readonly Waiver[]; rules?: RuleMap } = {}) {
    this.waivers = options.waivers ?? [];
    this.rules = options.rules ?? RULE_BY_ID;
  }

  add(rule: string, where: string, detail?: string): void {
    const finding: Finding = detail === undefined ? { rule, where } : { rule, where, detail };
    const [marked] = applyWaivers([finding], this.waivers, this.rules);
    this.findings.push(marked ?? finding);
  }

  /** True when no finding fails the command. Warnings and waived findings do not count. */
  get ok(): boolean {
    return failures(this.findings, this.rules).length === 0;
  }

  /** The rule ids of the findings that fail the command. */
  ids(): Set<string> {
    return new Set(failures(this.findings, this.rules).map((finding) => finding.rule));
  }

  format(): string {
    return formatFindings(this.findings, this.rules);
  }

  throwIfFailed(): void {
    if (!this.ok) throw new FindingError(this.findings, this.rules);
  }
}

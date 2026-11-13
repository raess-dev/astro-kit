# The astro-kit standard

Generated from `src/registry.ts` by `npm run docs`. Do not edit it by hand.

## How to read a result

Every failing check prints the same three lines:

```text
✗ [<id>] <where>: <message> (<detail>)
    fix: <hint>
    rule: node_modules/@raess/astro-kit/docs/standards.md#<id>
```

- The id in brackets is the rule below. Then come the place, the meaning and the value found.
- `!` in place of `✗` is a warning. It fails nothing now, and its message says when it becomes an error.
- `~` is a finding that a waiver in `astro-kit.json` covers, with its end date and its reason.
- Fix the cause. Never silence a check. If a check looks wrong, add an entry to `KIT-FEEDBACK.md`.

## Stages

| Stage | Runs in | Groups |
|---|---|---|
| config | `npx --no astro-kit check`, and the start of `astro build` and `astro dev`. | config, routes, images, facts, design, modes, legal |
| config + build | On the source like a config rule, and again on `dist/`. The output is the authority. | routes, design |
| build | The end of `astro build`, on the files in `dist/`. | edge |
| browser | `npx --no astro-kit test`, in Chromium on the built site. |  |
| ci | `npx --no astro-kit ci` and the site workflow. |  |
| smoke | `npx --no astro-kit smoke <origin>`, against production. |  |
| zone | `npx --no astro-kit provision zone`. |  |

## Rules

27 rules in 8 groups.

### config

- <a id="config-options"></a>**config-options** — `astro-kit.json` exists and matches the strict schema of the kit. `site.json` at the root exists and matches its schema, and `glossary.json`, when it exists, matches its schema. Findings name the field path. A looser limit fails. Fix: Fix the field that the finding names. `npx --no astro-kit settings --html settings.html` shows every setting with its rule.
- <a id="config-shim"></a>**config-shim** — `astro.config.mjs`, `biome.json` and `tsconfig.json` equal the kit shims after CRLF→LF and trimEnd + newline, and no other `astro.config.*` file exists. The root `biome.json` is the only Biome config: no other file named `biome.json`, `biome.jsonc`, `.biome.json` or `.biome.jsonc` exists in any folder of the project, outside `.git` and the folders that Biome skips (`node_modules`, `dist`, `.astro`, `.wrangler`). The rendered protected files equal the kit's rendering for the settings, compared in the same way: `.github/workflows/site.yml`, `.github/workflows/site-merge.yml`, `.github/dependabot.yml`, `.github/kit-identity.sh`, `.github/CODEOWNERS` and `.npmrc` (a file that does not match gets the hint of the protected task). `AGENTS.md` holds the kit block, and `CLAUDE.md` holds the line `@AGENTS.md`. Feature shims (`eslint.config.mjs`, `src/pages/api/forms/[form].ts`) are compared in `check`. Fix: For a shim, run `npx --no astro-kit init --shims --force`. Remove every other Astro or Biome config file. For a protected file: The protected files do not match the settings. Say so in the pull request: the owner starts the protected task for this branch.
- <a id="config-locked"></a>**config-locked** — No integration or config changes a value that the kit locks in the Astro config: `site`, `output`, `trailingSlash`, `prerenderConflictBehavior`, `compressHTML`, `build`, `image`, `security`, `prefetch`, `markdown`, `session`, `vite.build.cssTarget` and `vite.ssr.noExternal`. The finding names the key, and its detail is `<actual> instead of <expected>`. Fix: Remove the integration or the setting that changes the value. Every option of a site lives in `astro-kit.json`.
- <a id="config-adapter"></a>**config-adapter** — The project sets no adapter; the kit adds `@astrojs/cloudflare` only with forms. Fix: Remove the adapter. For a form, the owner turns on `features.forms`, and the kit adds the adapter.
- <a id="config-experimental"></a>**config-experimental** — No truthy experimental flag other than `collectionStorage: 'single-file'`. Fix: Remove the experimental flag.
- <a id="config-i18n"></a>**config-i18n** — The project sets no `i18n`; the resolved `i18n` equals the kit's. Fix: Remove `i18n` from the Astro config. The kit sets it from `locales` and `defaultLocale` in `astro-kit.json`.
- <a id="config-imports"></a>**config-imports** — No source imports `astro:transitions` or `astro:transitions/client` (regex on `src/**/*.{astro,ts,tsx,js,mjs,jsx,mts,cts,cjs}`). White space and comments may stand between `from`, `import(` or `require(` and the module name. Fix: Remove the import and use native CSS view transitions.
- <a id="config-suppression"></a>**config-suppression** — Nothing takes a file out of the checks. `src/` contains no `biome-ignore`, `@ts-ignore`, `@ts-expect-error` or `@ts-nocheck`, in any letter case (`.astro .ts .tsx .js .mjs .jsx .mts .cts .cjs .css .md .mdx`). Each of these files has at most 1,048,576 B. No folder under `src/` or `public/` is named `node_modules`, `dist`, `.astro` or `.wrangler`, and no symbolic link there leads into such a folder. No symbolic link under `src/` or `public/` leads out of the project, and neither folder is such a link. Fix: Remove the comment and fix the cause. Rename the folder, split the large file, or replace the link with a file inside the project. If the check is wrong, add an entry to `KIT-FEEDBACK.md`.
- <a id="config-server"></a>**config-server** — The project has no server code of its own: no `src/middleware.*` file and no `src/middleware/` folder, no `src/actions/` folder and no `src/actions.*` file, and no `server:defer` in a `.astro` file under `src/`. Fix: Remove the middleware, the actions and `server:defer`. For a form, use the forms feature of the kit.
- <a id="config-waiver"></a>**config-waiver** — Each entry of `waivers` names a waivable rule. Its `until` is today or later, and at most 90 days after today (UTC). The message for an old entry: `the waiver for <rule> on <where> ended on <until>: fix the page, or ask the owner for a new date`. Fix: Remove the waiver, or name a waivable rule and ask the owner for an `until` from today to 90 days ahead.
- <a id="config-overrides"></a>**config-overrides** — `package.json` has no `overrides` or `resolutions`. Fix: Remove `overrides` and `resolutions` from `package.json`.
- <a id="config-dep-spec"></a>**config-dep-spec** — Every dependency other than the kit has a spec of the npm registry: a version, a range or a tag. The trimmed spec matches `^(?!\.)(?!.*\.(tgz|tar|tar\.gz)$)[\w.*~^<>=|+ -]*$` in any letter case, in dependencies, devDependencies or optionalDependencies. Fix: Install the package from the npm registry with an exact version, for example `1.2.3`.
- <a id="config-dep-allowlist"></a>**config-dep-allowlist** — Dependencies are only: `astro`, `@raess/astro-kit`, `wrangler`; with forms `@astrojs/cloudflare`; with islands `@astrojs/solid-js`, `solid-js`, `eslint`, `eslint-plugin-solid`, `typescript-eslint`; plus `dependencies`. The rule reads dependencies, devDependencies, optionalDependencies and peerDependencies. A `package.json` that is not a JSON object fails, and so does a section that is not an object. Fix: Remove the package, or ask the owner to add it to `dependencies` in `astro-kit.json`. Fix `package.json` when it is not a JSON object with objects as dependency sections.
- <a id="config-public-shadow"></a>**config-public-shadow** — `public/` holds none of `robots.txt`, `_headers`, `_redirects`, `.well-known/security.txt`, `_kit`, `sitemap*.xml`. Fix: Delete the file from `public/`. The kit writes it into `dist/` at the end of the build.
- <a id="config-wrangler"></a>**config-wrangler** — Only `wrangler.jsonc` exists (no `.json` or `.toml`). It equals the kit's rendering for the settings, after CRLF→LF and trimEnd + newline. The rendering has full-line `//` comments only and no trailing commas, because the deploy job reads it with `jq`. A file that does not match gets the hint of the protected task. Fix: The protected files do not match the settings. Say so in the pull request: the owner starts the protected task for this branch.

### routes

- <a id="routes-on-demand"></a>**routes-on-demand** — Every project route is prerendered. The one exception, with forms: the route with the pattern `/api/forms/[form]` whose entrypoint is the feature shim `src/pages/api/forms/[form].ts`. Fix: Remove `export const prerender = false` from the route, or remove the route. For a form, use the forms feature of the kit.
- <a id="routes-slug"></a>**routes-slug** — Every built page path other than `/404.html` ends in `/` (`…/index.html`), and each of its segments matches `^[a-z0-9]+(-[a-z0-9]+)*$`. A default-locale path does not start with a locale code or a reserved segment (`_astro`, `_actions`, `_server-islands`, `_image`, `_kit`, `api`, `500`, `.well-known`). A non-default path has no reserved segment after `/<code>/`. A `404` segment is left to `routes-404`, so it reports once. **The endpoint clause,** checked on the resolved routes: a project route of type `endpoint`, other than the form shim, is a static file route. Its pattern ends with a literal file extension `.<ext>` (`[a-z0-9]+`) that is not `html` or `htm`. Its first segment holds no parameter (`[`) and is not a reserved segment. When the first segment is a locale code, the second segment holds no parameter and is not a reserved segment. A parameter can stand for any name, so the kit cannot know which file it writes there. For example, `/[name].txt` and `/[dir]/[file].json` fail, and `/live.json` and `/feeds/[lang].json` pass. Its pattern is none of `/robots.txt`, `/_headers` and `/_redirects`, and no `/sitemap*.xml`. So a project endpoint can never write the file of a page or a file that the kit writes. `routes-on-demand` still requires it to be prerendered. Fix: Rename the page so that each segment has only lower-case letters, digits and single hyphens, and starts with no reserved segment. Give an endpoint a fixed first segment and a file extension other than `.html`.
- <a id="routes-redirects"></a>**routes-redirects** — `redirects.json` rows are `{from, to}` or `{from, gone: true}`. `from` starts with `/` and has no whitespace, no `?` ("query strings cannot be matched; mark it gone or add a zone Single Redirect") and no `#` ("fragments cannot be matched: a browser never sends the text after #"). No duplicate `from`. `to` starts with `/`, not with `//` or `/\`, and has no whitespace, so a row writes one line and never leaves the site. Neither `from` nor `to` holds a backslash, and neither path holds a `.` or `..` segment, also not as `%2e`: Cloudflare removes such a segment, so it would store another path, and a `to` such as `/.//host/` would leave the site. The path of a `to` ends before its `?` or `#`. No chains (the path of no `to` is a `from`). Limits: 2,000 static, 100 dynamic, 1,000 characters per line. Every literal `to` is built (patterns, and `/api/` with forms, are skipped). Fix: Fix the row that the finding names. Point each `to` at a built page, or mark the row `gone`.

### images

- <a id="images-public"></a>**images-public** — `public/` holds no raster file (`.png .jpg .jpeg .gif .webp .avif .bmp .tif .tiff`) except `favicon.ico`, `apple-touch-icon.png`, `og.png`, `og.jpg`. Fix: Move the image to `src/assets/` and render it with `<Picture>`.
- <a id="images-original"></a>**images-original** — Every raster file under `src/` is ≤ 2,560 px on its long edge and ≤ 3,145,728 B. The size is read from the PNG, GIF, WebP or JPEG header. A `.png`, `.gif`, `.webp`, `.jpg` or `.jpeg` file without such a header fails. So does a JPEG file with more than 4,096 markers and fill bytes before its frame header. A raster file of another format has the byte limit only. Fix: Scale the file down to at most 2,560 px on its long edge and at most 3,145,728 B. Replace a file that has no image header with the real image.

### facts

- <a id="facts-schedule"></a>**facts-schedule** — `schedule.json` matches its strict schema. Fix: Fix the field that the finding names. Days are `Mo` to `Su`, times are `HH:MM` and dates are `YYYY-MM-DD`.

### design

- <a id="design-format"></a>**design-format** — `docs/design.md` exists and has the required sections, the exact table headers, known prefixes in the right section, no duplicate names, values that parse (so no color holds `color-mix()` or `color(display-p3 …)`), at least one of the base themes `light` and `dark`, `light` when `light-contrast` is declared, `dark` when `dark-contrast` is declared, a value or a fallback for every Color cell, ≥ 1 Color row, ≥ 1 `--font-` and ≥ 1 `--text-` row, ≥ 1 Spacing row, and ≥ 1 pair. The other design rules run only when it passes. Fix: Fix the section, the table header, the token name or the value that the finding names. The owner approves each change to `docs/design.md`.
- <a id="design-tokens"></a>**design-tokens** — `src/styles/tokens.css` equals the text that the kit renders from `docs/design.md` and the mode options, after CRLF→LF and trimEnd + newline. The hint is `run npx --no astro-kit tokens`. Built: the built `tokens` layer defines every token and helper parameter of `docs/design.md`, and no other custom property. No rule compares values in built CSS. Fix: run npx --no astro-kit tokens

### modes

- <a id="modes-themes"></a>**modes-themes** — The themes of `docs/design.md` serve the enabled mode options. `auto` and `light` need `light`. `dark` needs `dark`. `contrast` needs `light-contrast` when `light` is declared and `dark-contrast` when `dark` is declared. Each declared theme has an enabled option that reaches it: `light` through `auto` or `light`, `dark` through `auto` or `dark`, `light-contrast` and `dark-contrast` through `auto` or `contrast`. It runs only when `design-format` passes. Fix: Ask the owner: either `modes` in `astro-kit.json` changes, or `docs/design.md` gets the missing theme or loses the theme that no option reaches.

### edge

- <a id="edge-headers"></a>**edge-headers** — `_headers` has ≤ 100 rules, lines ≤ 2,000 characters and no duplicate pattern. `/*` has the seven headers of the kit: nosniff, referrer and CORP exact; COOP `same-origin`, or `same-origin-allow-popups` with a `frame` or `script` origin; the CSP directive set equal to the header policy (compared sorted); HSTS max-age ≥ 31,536,000 with includeSubDomains; each Permissions-Policy item `name=()`, or `=(self)` only for `autoplay` and `fullscreen`, or `=(self "https://<host>" …)` with the sorted hosts of the origins whose `allow` names it. No `X-Frame-Options` or `Cross-Origin-Embedder-Policy` on any rule. Cache-Control only on `/_astro/*` (= `public, max-age=31536000, immutable`) or, with prefetch, on `/*` (= `public, max-age=120`); with prefetch, `! Cache-Control` is required and `/_astro/*` comes after `/*`. Fix: Remove the integration or the file that changes `_headers`. The kit writes this file at the end of the build.
- <a id="edge-redirects"></a>**edge-redirects** — `_redirects` has ≤ 2,000 static and ≤ 100 dynamic rules, lines ≤ 1,000 characters, line shape `from to [301|302|303|307|308]` with `from` starting `/` and no extra tokens, and static rules before dynamic ones. Each `from` and each `to` also passes the checks of `routes-redirects` on one path: no `?` and no `#` in `from`; `to` starts with `/` and not with `//` or `/\`; no backslash and no `.` or `..` segment. So a line that another integration left cannot leave the site either. Fix: Fix the rows of `redirects.json`, and remove the integration or the file that adds other lines to `_redirects`.

### legal

- <a id="legal-processing"></a>**legal-processing** — `processing` contains `cdn` and `previews`, and with forms `forms` and `server`; it contains `forms`/`server` only with forms. Fix: List `cdn` and `previews`. List `forms` and `server` with `features.forms`, and only then.

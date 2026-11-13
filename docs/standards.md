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
| config | `npx --no astro-kit check`, and the start of `astro build` and `astro dev`. | config, images, facts, legal |
| config + build | On the source like a config rule, and again on `dist/`. The output is the authority. | routes |
| build | The end of `astro build`, on the files in `dist/`. |  |
| browser | `npx --no astro-kit test`, in Chromium on the built site. |  |
| ci | `npx --no astro-kit ci` and the site workflow. |  |
| smoke | `npx --no astro-kit smoke <origin>`, against production. |  |
| zone | `npx --no astro-kit provision zone`. |  |

## Rules

15 rules in 5 groups.

### config

- <a id="config-options"></a>**config-options** — `astro-kit.json` exists and matches the strict schema of the kit. `site.json` at the root exists and matches its schema, and `glossary.json`, when it exists, matches its schema. Findings name the field path. A looser limit fails. Fix: Fix the field that the finding names. `npx --no astro-kit settings --html settings.html` shows every setting with its rule.
- <a id="config-shim"></a>**config-shim** — `astro.config.mjs`, `biome.json` and `tsconfig.json` equal the kit shims after CRLF→LF and trimEnd + newline, and no other `astro.config.*` file exists. The root `biome.json` is the only Biome config: no other file named `biome.json`, `biome.jsonc`, `.biome.json` or `.biome.jsonc` exists in any folder of the project, outside `.git` and the folders that Biome skips (`node_modules`, `dist`, `.astro`, `.wrangler`). The rendered protected files equal the kit's rendering for the settings, compared in the same way: `.github/workflows/site.yml`, `.github/workflows/site-merge.yml`, `.github/dependabot.yml`, `.github/kit-identity.sh`, `.github/CODEOWNERS` and `.npmrc` (a file that does not match gets the hint of the protected task). `AGENTS.md` holds the kit block, and `CLAUDE.md` holds the line `@AGENTS.md`. Feature shims (`eslint.config.mjs`, `src/pages/api/forms/[form].ts`) are compared in `check`. Fix: For a shim, run `npx --no astro-kit init --shims --force`. Remove every other Astro or Biome config file. For a protected file: The protected files do not match the settings. Say so in the pull request: the owner starts the protected task for this branch.
- <a id="config-imports"></a>**config-imports** — No source imports `astro:transitions` or `astro:transitions/client` (regex on `src/**/*.{astro,ts,tsx,js,mjs,jsx,mts,cts,cjs}`). White space and comments may stand between `from`, `import(` or `require(` and the module name. Fix: Remove the import and use native CSS view transitions.
- <a id="config-suppression"></a>**config-suppression** — Nothing takes a file out of the checks. `src/` contains no `biome-ignore`, `@ts-ignore`, `@ts-expect-error` or `@ts-nocheck`, in any letter case (`.astro .ts .tsx .js .mjs .jsx .mts .cts .cjs .css .md .mdx`). Each of these files has at most 1,048,576 B. No folder under `src/` or `public/` is named `node_modules`, `dist`, `.astro` or `.wrangler`, and no symbolic link there leads into such a folder. No symbolic link under `src/` or `public/` leads out of the project, and neither folder is such a link. Fix: Remove the comment and fix the cause. Rename the folder, split the large file, or replace the link with a file inside the project. If the check is wrong, add an entry to `KIT-FEEDBACK.md`.
- <a id="config-server"></a>**config-server** — The project has no server code of its own: no `src/middleware.*` file and no `src/middleware/` folder, no `src/actions/` folder and no `src/actions.*` file, and no `server:defer` in a `.astro` file under `src/`. Fix: Remove the middleware, the actions and `server:defer`. For a form, use the forms feature of the kit.
- <a id="config-waiver"></a>**config-waiver** — Each entry of `waivers` names a waivable rule. Its `until` is today or later, and at most 90 days after today (UTC). The message for an old entry: `the waiver for <rule> on <where> ended on <until>: fix the page, or ask the owner for a new date`. Fix: Remove the waiver, or name a waivable rule and ask the owner for an `until` from today to 90 days ahead.
- <a id="config-overrides"></a>**config-overrides** — `package.json` has no `overrides` or `resolutions`. Fix: Remove `overrides` and `resolutions` from `package.json`.
- <a id="config-dep-spec"></a>**config-dep-spec** — Every dependency other than the kit has a spec of the npm registry: a version, a range or a tag. The trimmed spec matches `^(?!\.)(?!.*\.(tgz|tar|tar\.gz)$)[\w.*~^<>=|+ -]*$` in any letter case, in dependencies, devDependencies or optionalDependencies. Fix: Install the package from the npm registry with an exact version, for example `1.2.3`.
- <a id="config-dep-allowlist"></a>**config-dep-allowlist** — Dependencies are only: `astro`, `@raess/astro-kit`, `wrangler`; with forms `@astrojs/cloudflare`; with islands `@astrojs/solid-js`, `solid-js`, `eslint`, `eslint-plugin-solid`, `typescript-eslint`; plus `dependencies`. The rule reads dependencies, devDependencies, optionalDependencies and peerDependencies. A `package.json` that is not a JSON object fails, and so does a section that is not an object. Fix: Remove the package, or ask the owner to add it to `dependencies` in `astro-kit.json`. Fix `package.json` when it is not a JSON object with objects as dependency sections.
- <a id="config-public-shadow"></a>**config-public-shadow** — `public/` holds none of `robots.txt`, `_headers`, `_redirects`, `.well-known/security.txt`, `_kit`, `sitemap*.xml`. Fix: Delete the file from `public/`. The kit writes it into `dist/` at the end of the build.

### routes

- <a id="routes-redirects"></a>**routes-redirects** — `redirects.json` rows are `{from, to}` or `{from, gone: true}`. `from` starts with `/` and has no whitespace and no `?` ("query strings cannot be matched; mark it gone or add a zone Single Redirect"). No duplicate `from`. `to` starts with `/`, not with `//` or `/\`, and has no whitespace. No chains (no `to` is a `from`). Limits: 2,000 static, 100 dynamic, 1,000 characters per line. Every literal `to` is built (patterns, and `/api/` with forms, are skipped). Fix: Fix the row that the finding names. Point each `to` at a built page, or mark the row `gone`.

### images

- <a id="images-public"></a>**images-public** — `public/` holds no raster file (`.png .jpg .jpeg .gif .webp .avif .bmp .tif .tiff`) except `favicon.ico`, `apple-touch-icon.png`, `og.png`, `og.jpg`. Fix: Move the image to `src/assets/` and render it with `<Picture>`.
- <a id="images-original"></a>**images-original** — Every raster file under `src/` is ≤ 2,560 px on its long edge and ≤ 3,145,728 B. The size is read from the PNG, GIF, WebP or JPEG header. A `.png`, `.gif`, `.webp`, `.jpg` or `.jpeg` file without such a header fails. So does a JPEG file with more than 4,096 markers and fill bytes before its frame header. A raster file of another format has the byte limit only. Fix: Scale the file down to at most 2,560 px on its long edge and at most 3,145,728 B. Replace a file that has no image header with the real image.

### facts

- <a id="facts-schedule"></a>**facts-schedule** — `schedule.json` matches its strict schema. Fix: Fix the field that the finding names. Days are `Mo` to `Su`, times are `HH:MM` and dates are `YYYY-MM-DD`.

### legal

- <a id="legal-processing"></a>**legal-processing** — `processing` contains `cdn` and `previews`, and with forms `forms` and `server`; it contains `forms`/`server` only with forms. Fix: List `cdn` and `previews`. List `forms` and `server` with `features.forms`, and only then.

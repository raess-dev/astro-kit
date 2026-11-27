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
    "`astro.config.mjs`, `biome.json` and `tsconfig.json` equal the kit shims after CRLF→LF and trimEnd + newline, and no other `astro.config.*` file exists. The root `biome.json` is the only Biome config: no other file named `biome.json`, `biome.jsonc`, `.biome.json` or `.biome.jsonc` exists in any folder of the project, outside `.git` and the folders that Biome skips (`node_modules`, `dist`, `.astro`, `.wrangler`). The rendered protected files equal the kit's rendering for the settings, compared in the same way: `.github/workflows/site.yml`, `.github/workflows/site-merge.yml`, `.github/dependabot.yml`, `.github/kit-identity.sh`, `.github/CODEOWNERS` and `.npmrc` (a file that does not match gets the hint of the protected task). `AGENTS.md` holds the kit block, and `CLAUDE.md` holds the line `@AGENTS.md`. With `features.forms`, `src/pages/api/forms/[form].ts` equals the forms shim, compared in the same way, in every command that runs preflight: a missing or different file fails. So `build` and `test` prove the endpoint that the test server stub stands for. The other feature shim (`eslint.config.mjs`) is compared in `check`.",
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
    '`public/` holds none of `robots.txt`, `_headers`, `_redirects`, `.well-known/security.txt`, `_kit`, `sitemap*.xml`. It holds no folder or file `_astro` either, in any letter case. Astro writes its bundled files to `/_astro/`, and `js-script` allows a module script there, so no file of `public/` may stand at such a URL. It holds no `.js`, `.mjs` or `.cjs` file at any depth, in any letter case: every script comes from the bundler into `/_astro/`, so `js-script` and `js-budget` see all of it, and an `import()` or a worker cannot load a file of `public/` that no budget counts.',
    '`public/` holds a file that the kit or Astro writes, or a JS file.',
    'Delete the file from `public/`. The kit writes it into `dist/` at the end of the build; Astro writes `/_astro/` itself. Put a script into `src/` as a bundled `<script>`.',
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
    'routes-404',
    'routes',
    'build',
    "`/404.html` exists in dist. (The project builds it from `src/pages/404.astro`; the rule reads only dist.) It is the only 404 page: no other built page path has a segment that is exactly `404`. Message for such a path `<p>`: `<p> has a 404 segment. Under build.format 'directory' it is written to <p>index.html, an ordinary page that answers 200. Cloudflare answers a missing URL only with a file named 404.html, which Astro builds only from src/pages/404.astro. Put every language on /404.html.` `/404.html` links every locale home (`/` and each `/<code>/`; a link to the file of a built home, `/fr/index.html`, counts too). It holds no form whose action starts with `/api/forms/` in any letter case, and no control whose `formaction` does, because the `return` of such a form would fail. It passes every page rule that does not exempt it.",
    'The one 404 page is missing, a second 404 page exists, or `/404.html` does not link every locale home or holds a form.',
    'Build every language on one `src/pages/404.astro`, which Astro writes to `/404.html`, and remove every other `404` page. Link each locale home from it, and put no form on it.',
  ),
  r(
    'routes-slug',
    'routes',
    'config + build',
    'Every built page path other than `/404.html` ends in `/` (`…/index.html`), and each of its segments matches `^[a-z0-9]+(-[a-z0-9]+)*$`. A default-locale path does not start with a locale code or a reserved segment (`_astro`, `_actions`, `_server-islands`, `_image`, `_kit`, `api`, `500`, `.well-known`). A non-default path has no reserved segment after `/<code>/`. A `404` segment is left to `routes-404`, so it reports once. **The endpoint clause,** checked on the resolved routes: a project route of type `endpoint`, other than the form shim, is a static file route. Its pattern ends with a literal file extension `.<ext>` (`[a-z0-9]+`) that is not `html` or `htm`, the extensions of a page, and not `js`, `mjs` or `cjs`, the extensions of a script: every script comes from the bundler, as `public/` holds none (`config-public-shadow`). Its first segment holds no parameter (`[`) and is not a reserved segment. When the first segment is a locale code, the second segment holds no parameter and is not a reserved segment. A parameter can stand for any name, so the kit cannot know which file it writes there. For example, `/[name].txt` and `/[dir]/[file].json` fail, and `/live.json` and `/feeds/[lang].json` pass. Its pattern is none of `/robots.txt`, `/_headers` and `/_redirects`, and no `/sitemap*.xml`. So a project endpoint can never write the file of a page or a file that the kit writes. `routes-on-demand` still requires it to be prerendered.',
    'A page path is not a clean slug path, or an endpoint is not a static file route.',
    'Rename the page so that each segment has only lower-case letters, digits and single hyphens, and starts with no reserved segment. Give an endpoint a fixed first segment and a file extension other than `.html`.',
  ),
  r(
    'routes-translation',
    'routes',
    'build',
    'Every non-default-locale page lists a default-locale alternate. In a `coverage: "full"` locale, every indexable default-locale page lists an alternate in that locale. An alternate is listed when its `hreflang` equals the tag in any ASCII case; a tag in another case is left to `hreflang-reciprocal`. `/404.html` is exempt.',
    'A page lacks the translation link that its locales require.',
    'Build the missing page in that locale, and list each page as an hreflang alternate of the other. A page of another locale needs its default-locale sibling.',
  ),
  r(
    'routes-redirects',
    'routes',
    'config + build',
    '`redirects.json` rows are `{from, to}` or `{from, gone: true}`. `from` starts with `/` and has no whitespace, no `?` ("query strings cannot be matched; mark it gone or add a zone Single Redirect") and no `#` ("fragments cannot be matched: a browser never sends the text after #"). No duplicate `from`. `to` starts with `/`, not with `//` or `/\\`, and has no whitespace, so a row writes one line and never leaves the site. Neither `from` nor `to` holds a backslash, and neither path holds a `.` or `..` segment, also not as `%2e`: Cloudflare removes such a segment, so it would store another path, and a `to` such as `/.//host/` would leave the site. The path of a `to` ends before its `?` or `#`. No chains (the path of no `to` is a `from`). Limits: 2,000 static, 100 dynamic, 1,000 characters per line. Every literal `to` is built (patterns, and `/api/` with forms, are skipped).',
    '`redirects.json` is not valid.',
    'Fix the row that the finding names. Point each `to` at a built page, or mark the row `gone`.',
  ),
  // js
  r(
    'js-script',
    'js',
    'config + build',
    'Pages ship no script except JSON-LD, the kit speculation block and the kit mode script (`modes-script`). With scripts: `/_astro/` module scripts and inline module scripts. With astroPrefetch: the prefetch chunk (`^/_astro/page(\\.[\\w-]+)?\\.js$`) as a `/_astro/` module script. With islands: Astro\'s exact island runtime and directive texts, and the exact text of Solid\'s hydration script, the text that the kit hashes (6.2). With an origin that has `script` and `load: "page"`: a `script` with `async`, `defer` or `type="module"` whose `src` is an `https` URL with no port and no user, and whose host in ASCII lower case is that host (9.4). The URL is compared as the browser parses it, as in `origins-third-party`. Every other `script` element fails, one finding for each page: a classic or module script, an import map and a data block. A `/_astro/` module script is a `script[type=module]` whose `src` resolves to a same-origin path under `/_astro/`, not `http:`, that names a file of dist. The path is the one that the browser asks for: a dot segment counts also when it writes a dot as `%2e` (`/_astro/%2e%2e/x.js` is `/x.js`). The island texts are the island runtime and the texts of the five built-in client directives of the `astro` that the project installed (`@astrojs/runtime`, resolved from `astro`); `client:load` and `client:only` are `js-directive`\'s, so their texts count too. A project whose `astro` holds no such texts, or whose `solid-js` gives no hydration script, allows none of them. The speculation block and every script whose text starts like the mode script are left to `speculation-block` and `modes-script`. Template content is not read. **Workers.** With `features.workers` off, every start of a worker is a finding, whatever its argument (9.5): in each file of dist that the host serves as JavaScript (its name ends with `.js`, `.mjs` or `.cjs`, in any ASCII case), one finding for each file at its path (`/_astro/w.js`), whether a page loads it or not; and in the text of each classic or module inline script of a page, one finding for the page. The detail names each start once and the setting: `the script starts a worker (new Worker), but features.workers is off (9.5)`, and for a page `an inline script starts a worker (…), but features.workers is off (9.5)`. A start is: `new` before `Worker` or `SharedWorker`, also at the end of members (`new globalThis.Worker`, `new window?.SharedWorker`, `new self["Worker"]`, `new (window.Worker)`); `serviceWorker`, or a member `["serviceWorker"]`, then a member `register` (`.register`, `?.register`, `["register"]`), called or not; and the name `importScripts` anywhere, which exists only in a worker. White space and comments may stand between the tokens. The text is read as it is, so a start in a string or a comment counts too. No start: a member or a name `Worker` without `new` (`x.Worker`, `typeof Worker`, an object key), a longer name (`new WorkerPool`), and `serviceWorker` without `register` (`.ready`). Not read, and left to the CSP (`worker-src \'none\'`, 9.5): an alias (`const W = Worker; new W(u)`, a `serviceWorker` container kept in a variable), `Reflect.construct`, a computed member that is no single string literal, an escape in a name (`\\u0057orker`), and code in an event handler attribute or a `javascript:` URL. With `features.workers` on, this part reads nothing, and a worker file counts toward `lazyJsBytes` (`js-budget`). Source: a `<script>` other than `application/ld+json` (its `type` trimmed, in any ASCII case) in `.astro` needs scripts or such an origin. Islands alone allow none: Astro writes the scripts of an island itself. This half reads the settings. A tag whose name starts with a capital letter is a component.',
    'The page ships a script that the settings do not allow, or a script starts a worker without `features.workers`.',
    'Remove the script. For a bundled script the owner turns on `features.scripts`, for an island `features.islands`, and a third-party script needs a declared origin with `script` and `load: "page"`. A worker needs `features.workers` (9.5): the owner turns it on, or remove the worker.',
  ),
  r(
    'js-prefetch-attr',
    'js',
    'config + build',
    'No element carries `data-astro-prefetch`, one finding for each page. Source: no tag of a `.astro` file, an element or a component, carries it.',
    'An element carries `data-astro-prefetch`.',
    'Remove the attribute. The kit prefetches same-site links itself: with the speculation rules, and with `prefetch.astroPrefetch` in other browsers.',
  ),
  r(
    'js-directive',
    'js',
    'config + build',
    'Islands hydrate only with `client:visible`, `client:idle` or `client:media` (`client:load` and `client:only` fail). Built: the `client` attribute of every `astro-island` is `visible`, `idle` or `media`, exactly; an island without it fails; one finding for each page. Source: every `client:*` attribute of a tag of a `.astro` file, its name in ASCII lower case, is one of the three.',
    'An island hydrates with a directive other than `client:visible`, `client:idle` or `client:media`.',
    'Use `client:visible`, `client:idle` or `client:media`. An island must render its markup on the server: `client:only` cannot.',
  ),
  r(
    'js-budget',
    'js',
    'build',
    'For each page. **At once:** the files in the static-import closure (`/(?:\\bimport|\\bfrom)\\s*["\']([^"\']+\\.js)["\']/g`) of every `astro-island` `component-url`, `renderer-url` and `before-hydration-url` on the page, and of every module script of the page: the file of its `src`, or the files that its inline text imports; and of the file of every `link` whose `rel` holds `modulepreload`, or `preload` with an `as` of `script` (each in any ASCII case, `as` trimmed). The sum of their compressed sizes ≤ 20,480 B (`islandJsBytes`: the JS that loads at once). **Later:** every dist file that an at-once file or an inline module script names in `import()` (``/\\bimport\\(\\s*(?:"([^"\\\\]+\\.js)"|\'([^\'\\\\]+\\.js)\'|`([^`$\\\\]+\\.js)`)\\s*\\)/g``, the group that matched; Astro 7 bundles with Rolldown, which writes the backtick form) or as a worker URL (``/(?:(?<![\\w$.])(?:new\\s+(?:URL|Worker|SharedWorker)|importScripts)|\\bserviceWorker\\s*\\.\\s*register)\\s*\\(\\s*(?:"([^"\\\\]+\\.js)"|\'([^\'\\\\]+\\.js)\'|`([^`$\\\\]+\\.js)`)/g``, the group that matched: a literal of a `.js` file as the first argument of `new URL(`, `new Worker(`, `new SharedWorker(`, `importScripts(` or `serviceWorker.register(`, as Rolldown writes a worker), with the static-import closure of each. A file outside `/_astro/` counts too. Each `import()` and worker URL of a file so added counts the same way, until no file is added. The at-once files are taken out. The sum of their compressed sizes ≤ 204,800 B (`lazyJsBytes`). **Cannot be measured:** an at-once or later file, or an inline module script, holds an `import(` that is no match of that regex: its argument is no string literal of a `.js` file (`import(url)`, a template literal with `${`), or white space stands before the parenthesis. A specifier with a backslash is no such literal: JavaScript decodes an escape such as `\\x77`, so the file that loads is not the text; the same holds for a static import (`import "…"`, `from "…"`) whose specifier holds a backslash. So does a worker call (`new Worker(`, `new SharedWorker(`, `importScripts(` or `serviceWorker.register(`, with or without white space before the parenthesis) whose first argument is not, whole, a literal of a `.js` file whose path starts with `/`, or `new URL(` of any literal of a `.js` file with no base, `import.meta.url` or ``` ``+import.meta.url ```, then `,` or `)`; a bare worker URL resolves against the page that runs the script, which the kit does not know, so `"./w.js"` cannot be measured; so is an `importScripts(` whose arguments are not all literals of `.js` files whose paths start with `/`: it resolves against the URL of the worker, which the kit does not know. A literal with a suffix (`"/_astro/a.js" + s`) or another base loads another URL than the literal. Each argument of `importScripts(` counts. That is a finding. An `import(` here is the word `import` that no `.`, letter, digit, `_` or `$` comes before, then white space and `(`. The prefetch chunk (`^/_astro/page(\\.[\\w-]+)?\\.js$`) and its closure ≤ 2,048 B. With astroPrefetch on, a missing chunk is a finding: a page with no module script whose `src` is the chunk, or whose chunk names no dist file. A module script is a `script[type=module]`: the file of its `src`, or its inline text. The prefetch chunk is a module script too, so it loads at once. A URL resolves against the page, and a specifier against the URL of its file; a URL that names no dist file adds nothing, and so does a script of another origin (9.4). Each file counts once in a sum. One finding for each limit that a page breaks, and one for the JS that cannot be measured. Compressed size is the larger of zstd level 3 and brotli quality 5.',
    'The JavaScript of the page is over its budget, or the kit cannot measure it.',
    'Make the island or the script smaller, load a rarely used part later with `import()`, or drop a dependency. The detail names the largest files. Write each `import()` with a literal path, so the kit can measure what it loads.',
  ),
  // speculation
  r(
    'speculation-block',
    'speculation',
    'build',
    'With `speculationRules`, each page has exactly one `script[type=speculationrules]` whose `innerHTML === SPECULATION_JSON`, placed after the CSP meta. With it off, there is none.',
    'The speculation rules block of the kit is missing, doubled, changed or in the wrong place.',
    'Write no `speculationrules` script in the project: the kit inserts its own block right after the CSP meta. Remove any copy from the markup.',
  ),
  // budgets
  r(
    'budget-head',
    'budgets',
    'build',
    'Compressed HTML up to and including `</head>` (the whole file when there is none) ≤ `headBytes` (14,336 B). The CSP meta tag of the page alone, compressed, ≤ `cspBytes` (4,096 B). A failure prints the separately compressed markup, CSS, CSP meta and JSON-LD. Compressed size is the larger of zstd level 3 and brotli quality 5.',
    'The head of the page, or its CSP meta, is too large when compressed.',
    'Cut the CSS of the page, the head markup or the JSON-LD; the detail gives each part. A CSP meta grows with each set of route files that import the same CSS: use dynamic routes and fewer such sets.',
  ),
  r(
    'budget-document',
    'budgets',
    'build',
    'The whole page compressed ≤ `documentBytes` (30,720 B). Compressed size is the larger of zstd level 3 and brotli quality 5.',
    'The page is too large when compressed.',
    'Shorten the page: split long content into more pages, and remove markup that repeats.',
  ),
  r(
    'budget-dom',
    'budgets',
    'build',
    '≤ `domElements` (1,400) elements and depth ≤ 32 (`domDepth`; `html` is depth 1).',
    'The page has too many elements, or they nest too deep.',
    'Remove wrapper elements and split long lists or tables across pages.',
  ),
  r(
    'budget-fonts',
    'budgets',
    'build',
    'Raw bytes of the distinct existing font files that any page or same-origin sheet of the site references ≤ 102,400 (`fontBytes`): one sum for the site. The regex is `/\\/[^"\'()\\s,]+\\.(?:woff2?|ttf|otf)(?=[?#"\'()\\s,]|$)/gi`.',
    'The font files of the site are too large together.',
    'Use fewer font files: subset them, use WOFF2, and drop weights and styles that the design does not need.',
  ),
  // images
  r(
    'images-src',
    'images',
    'build',
    '`img` `src` and `srcset`, and `source` `srcset`, are `/_astro/…` or `/favicon.ico`, `/icon.svg`, `/apple-touch-icon.png`. Every `img`, `source` and `video[poster]` file exists in dist.',
    'An image does not come from the image pipeline of Astro, or its file is missing.',
    'Put the original in `src/assets/` and render it with `<Picture>` or `<Image>`, so that Astro writes it under `/_astro/`.',
  ),
  r(
    'images-attrs',
    'images',
    'build',
    'Every `img` has non-empty `width` and `height` and an `alt` attribute (it may be empty). Every `source` whose `srcset` uses a width descriptor has a non-empty `sizes`.',
    'An image has no size, no `alt`, or a width-based `srcset` without `sizes`.',
    'Render the image with `<Picture>` or `<Image>` and give it `alt` (empty for decoration). Pass `sizes` when the sources use width descriptors.',
  ),
  r(
    'images-format',
    'images',
    'build',
    'Every `picture` has ≥ 1 `source`, all `type="image/avif"`, and an `img` src ending in `.webp`.',
    'A `<picture>` does not offer AVIF with a WebP fallback.',
    'Render it with `<Picture formats={[\'avif\']} fallbackFormat="webp">`.',
  ),
  r(
    'images-priority',
    'images',
    'build',
    'At most one `fetchpriority="high"` image per page.',
    'More than one image of the page has `fetchpriority="high"`.',
    'Give `priority` only to the largest image above the fold, once for each page.',
  ),
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
  // fonts
  r(
    'fonts-limit',
    'fonts',
    'build',
    'At most 2 families with `url()` faces (faces with only `local()` are exempt). Every font `url()` is same-origin. At most 1 font preload on each page: a `link` whose `rel` holds the token `preload` and whose `as` is `font`. The rule holds for the site as a whole.',
    'The site loads too many font families, a font from another origin, or preloads more than one font.',
    'Use at most two self-hosted families in `src/styles/fonts.css`, and preload at most one font file.',
  ),
  // origins
  r(
    'origins-third-party',
    'origins',
    'build',
    'No `img`, `script`, `link` (resource rels: stylesheet, preload, modulepreload, prefetch, preconnect, dns-prefetch, icon, apple-touch-icon, manifest), `iframe`, `source`, `video`, `audio`, `track`, `object`, `embed` or `form` uses another origin in `src`, `href`, `srcset`, `poster`, `action` or `data`. No `button` or `input` uses one in `formaction`, no `input` whose `type` is `image` (trimmed, in any ASCII case) in `src`, no `a` or `area` in `ping` (each URL of its list), and no SVG `image` or `use` in `href` or `xlink:href`: each of them makes a request. Three exceptions, each for a declared origin (9.4): a `form` `action`, or the `formaction` of a submit control, on a host with `form`; a `script` `src` on a host with `script` and `load: "page"`; an `iframe` `src` with a `title`, on a host with `frame` and `load: "page"`. An `a` or `area` `href` may name any address: this rule does not read links. Each candidate of a `srcset` counts, and so does each candidate of the `imagesrcset` of a `link`, which a browser fetches too. The elements inside a `noscript` count too, parsed as markup: a browser without JavaScript loads them. So do the elements of the markup of an `iframe` `srcdoc`, and the content of a `noscript` inside that markup or inside a `noscript`, parsed as markup in the same way, at any depth up to 8: the browser renders that markup in the frame, and a frame without `allow-scripts` shows the `noscript` content. Another origin is a URL with another host or port, `http:` on the host of the site, or another scheme with a host (`ftp://`); a URL without a host (`data:`, `blob:`, `about:`, `javascript:`) is not this rule\'s. An exception URL is `https`, with no port and no user, and a `title` is not empty after a trim. Template content is not read. One finding for each element, attribute and URL.',
    'The page loads a resource from another origin.',
    'Download the image, font, style sheet or script into the project. A frame, a script or a form of a third party needs an origin in `astro-kit.json`, which the owner declares.',
  ),
  r(
    'origins-gesture',
    'origins',
    'browser',
    'On each tested page at 1280×800, with JavaScript on, opened as a visitor opens it (under the host of `site`, no `navigator.webdriver`, the user agent of Chrome), from the navigation until the tab is closed: nothing goes to another host before a gesture, a click on the control or a key that activates it (9.4), except to the host of an origin with `load: "page"`. The page clock is paused; the check advances it by 60 s, scrolls, moves the mouse, presses Tab, dispatches `focus`, advances it by 60 s again, and leaves the page. Each request, WebSocket, connection at the proxy of the check, fetching `link` and peer connection counts, also when the CSP blocked it. The harness answers each request to another origin itself, with status 204 and an empty body, so the check needs no network. One finding for each other origin, with its first URL, and one for each peer connection.',
    'The page contacts a third-party host before the visitor acts.',
    'Load the frame, script or connection of a `gesture` origin only after a click on its control or a key that activates it, from a bundled script or an island: not on a timer, a scroll, a hover, focus or when the visitor leaves. A host that the page needs while it loads needs `load: "page"`, which the owner declares (9.4).',
  ),
  // head
  r(
    'head-canonical',
    'head',
    'build',
    'Each non-404 page has exactly one canonical equal to `<site><path>` (the `site` setting and the page path), ending in `/`. The canonical, the description and the Open Graph tags are children of `head`: search engines and share scrapers read them only there, so one in `body` counts as none.',
    'The canonical link of the page is missing, doubled or not the URL of the page.',
    'Write one `<link rel="canonical">` with the absolute URL of the page, with its trailing `/`.',
  ),
  r(
    'head-lang',
    'head',
    'build',
    "`html lang` equals the tag of the URL's locale.",
    'The `lang` of `<html>` is not the tag of the locale of the URL.',
    'Set `<html lang>` to the `tag` of the locale that the first segment of the path names (`astro-kit.json` `locales`).',
  ),
  r(
    'head-title',
    'head',
    'build',
    '15–70 code points (`titleMin` and `titleMax`), unique per locale; `/404.html` exempt.',
    'The title is too short, too long, or the same as another title of the locale.',
    'Write a title of 15 to 70 characters that names this page and no other.',
  ),
  r(
    'head-description',
    'head',
    'build',
    '50–160 code points (`descriptionMin` and `descriptionMax`), unique per locale; `/404.html` exempt. The description is the one `meta[name=description]` child of `head`.',
    'The meta description is missing, too short, too long, or the same as another description of the locale.',
    'Write a description of 50 to 160 characters that says what this page offers.',
  ),
  r(
    'head-og',
    'head',
    'build',
    'Each non-404 page has `og:title`, `og:description`, `og:url` = canonical, and `og:locale` = tag with `-`→`_` (`de_CH`). `og:image` is optional. When a page has one, it is under `<site>/`, is a dist file ≤ 153,600 B (raw, `ogImageBytes`), and has `og:image:width` 1200 and `og:image:height` 630. A tag is a `meta` child of `head`. When a name appears twice, the first tag counts; every `og:image` is checked. One finding lists every problem.',
    'The Open Graph tags of the page are missing or wrong.',
    'Write `og:title`, `og:description`, `og:url` (the canonical URL) and `og:locale`. A share image is a 1200×630 file of the site of at most 150 KB, with `og:image:width` and `og:image:height`.',
  ),
  r(
    'head-icons',
    'head',
    'build',
    'Every page, 404 included, links `/favicon.ico`, `/icon.svg` and `/apple-touch-icon.png` (rel `icon` or `apple-touch-icon`), and the files exist.',
    'The page does not link the three icons, or an icon file is missing.',
    'Link `/favicon.ico` and `/icon.svg` with `rel="icon"` and `/apple-touch-icon.png` with `rel="apple-touch-icon"`, and keep the three files in `public/`.',
  ),
  r(
    'head-jsonld',
    'head',
    'build',
    'Every JSON-LD block parses, and every node has an `@type`. No node, at any depth, has the type `AggregateRating`, `Review`, `EmployerAggregateRating`, `ClaimReview`, `HowTo` or `SpecialAnnouncement`, or an `aggregateRating`/`review` property. One organization `@id` is shared across pages. The organization node (`Organization` or the `site.json` type; a subtype of either is not the organization node) has `name`, `legalName`, `email`, `telephone`, `vatID`, `taxID` (uid), address (street, postal code, locality, region, country), `openingHoursSpecification` (= openingHours) and `specialOpeningHoursSpecification` (= closures as day ranges 00:00–00:00) equal to the facts when it states them; its `sameAs` ⊆ site.json `sameAs`. Every `Offer` `price` equals a `site.json` price amount in major units: a number or a text of digits with at most two decimals after a `.`, in the `priceCurrency` of the offer when it states one. A `WebPage` node, or a node of a schema.org subtype of `WebPage`, has `inLanguage` equal to the tag. `WebSite` appears only on locale homes.',
    'A JSON-LD block does not parse, uses a banned type, or states a fact that differs from `site.json` or `schedule.json`.',
    'Build the JSON-LD from `site.json` and `schedule.json`, use one organization `@id` on every page, and leave out ratings, reviews and the banned types.',
  ),
  // headings
  r(
    'headings-h1',
    'headings',
    'build',
    'Exactly one `h1` per page.',
    'The page does not have exactly one `h1`.',
    'Give the page one `h1` that names it, and use `h2` and lower for the sections.',
  ),
  r(
    'headings-order',
    'headings',
    'build',
    'Each heading level ≤ previous + 1, starting from `h1`.',
    'A heading skips a level.',
    'Use the next level below the heading of the section: `h2` after `h1`, `h3` after `h2`. Style a heading with CSS, not with its level.',
  ),
  // hreflang
  r(
    'hreflang-reciprocal',
    'hreflang',
    'build',
    'Alternates name configured tags (or `x-default`), exactly as configured, once each, are absolute under `site`, include the page itself, and point to emitted pages of the locale that the tag names, which list this page back. A page with no alternates is skipped.',
    'The hreflang alternates of the page are not valid or not reciprocal.',
    'List one alternate for each locale of the page, itself included, with the absolute URL of a built page that lists this page back.',
  ),
  r(
    'hreflang-x-default',
    'hreflang',
    'build',
    "`x-default` equals the page's default-locale alternate: both name the same page path. A page with no alternates, such as `/404.html`, is skipped. When either href is not an absolute `https` URL of the site without a query, that href is `hreflang-reciprocal`'s, and the two are not compared.",
    'The `x-default` alternate is missing or not the default-locale alternate.',
    'Add `<link rel="alternate" hreflang="x-default">` with the URL of the default-locale alternate.',
  ),
  // indexing
  r(
    'indexing-noindex',
    'indexing',
    'build',
    'No page other than `/404.html` carries `noindex` (or `none`) in a robots meta: a `meta` whose `name` is `robots`, `googlebot`, `googlebot-news` or `bingbot`, in any letter case, since each search engine obeys the meta of its own crawler too. `/404.html` carries it in `meta[name=robots]`, for every crawler, when it exists. A missing `/404.html` is reported only by `routes-404`.',
    'A page carries `noindex`, or `/404.html` does not.',
    'Remove `noindex` from every page but `/404.html`, and add `<meta name="robots" content="noindex">` to `/404.html`. A page that must not be found does not belong in the build.',
  ),
  // links
  r(
    'links-resolve',
    'links',
    'build',
    'Every same-origin href other than a fragment-only `#id` equals, byte for byte, an emitted page path or a dist file. A fragment-only href names an id on the same page. An absolute one uses https. It is not a redirect source. Its fragment exists on the target.',
    'A link points to no built page or file, to a redirect, or to a fragment that does not exist.',
    'Link the built path itself, with its trailing `/` (`/zimmer/`), and an `id` that exists on the target page.',
  ),
  r(
    'links-generic',
    'links',
    'build',
    'Every link has an accessible name: the first that is not empty of the text of the elements that `aria-labelledby` names, `aria-label`, the link\'s text (a descendant with a non-empty `aria-label` counts as that label, an `img` as its `alt`, an `svg` as the text of its `title` child, a hidden descendant (`aria-hidden="true"` or `hidden`) and template content as nothing, and the text of a block stands between spaces), and the `title` attribute, with white space collapsed and trimmed and read up to 1,000 characters. Lower-cased and trimmed of non-letters, the name is not one of: here, click, click here, more, read more, learn more, link, hier, klicken, hier klicken, mehr, weiterlesen, mehr erfahren, ici, cliquez, cliquez ici, plus, lire la suite, en savoir plus, qui, clicca qui, di più, scopri di più, leggi tutto.',
    'A link has no accessible name, or a name that does not say where it leads.',
    'Name the target in the link text: "Zimmer und Preise", not "mehr". An image link needs an `alt`.',
  ),
  r(
    'links-same-name',
    'links',
    'build',
    'Links with the same accessible name on a page share one target (path plus fragment).',
    'Two links of the page have the same name and different targets.',
    'Give each link a name that tells its target apart, or point both links to the same target.',
  ),
  r(
    'links-target-blank',
    'links',
    'build',
    '`target` is only `_self`, `_top` or `_parent`.',
    'A `target` attribute opens a new window or names a frame.',
    'Remove the `target` attribute: the visitor decides where a link opens.',
  ),
  r(
    'links-depth',
    'links',
    'build',
    'Each locale home (`/`, `/<code>/`) exists when that locale has pages. Every indexable page is within 3 clicks (`clickDepth`) of its locale home (breadth-first over same-origin links). A link to the file of a built page (`/zimmer/index.html`) is a link to the page, as `links-resolve` accepts it.',
    'A locale home is missing, or a page is more than three clicks from its locale home.',
    'Build the home of each locale, and link the page from its home or from a page near it, for example from the sitemap page.',
  ),
  // facts
  r(
    'facts-value',
    'facts',
    'build',
    "Every email, phone number, CHE-UID, IBAN and CHF amount on a page equals a `site.json` value, including `contacts`. Swiss phones written `+41`, `0041` or `0` are normalized to E.164. CHF is compared in minor units against `prices` amounts. `mailto:` and `tel:` hrefs are checked too. Every Unicode space separator counts as a normal space, and each run of white space as one space, in the page text and in the `site.json` values alike. The patterns: email `/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\\.[A-Za-z0-9-]+)+/g` in lower case; phone `/(?:\\+|00)\\d[\\d ()./-]{6,20}\\d/g` and the Swiss national form `/\\b0\\d{2}[ ./-]?\\d{3}[ ./-]?\\d{2}[ ./-]?\\d{2}\\b/g`, normalized to the digits with `+` for a leading `00` or `+` and `+41` for a national number; CHE-UID `/CHE-?\\d{3}\\.?\\d{3}\\.?\\d{3}/g` as `CHE-ddd.ddd.ddd`; IBAN `/\\b[A-Z]{2}\\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,3})?\\b/g` without spaces; CHF `/(?:CHF|SFr\\.|Fr\\.)\\s?(\\d{1,3}(?:['’ ]\\d{3})+|\\d+)(?:[.,](\\d{2}|–|-))?/g` and `/(\\d{1,3}(?:['’ ]\\d{3})+|\\d+)(?:[.,](\\d{2}|–|-))?\\s?(?:CHF|Fr\\.)/g`, in minor units. Other currencies are not checked.",
    'A contact detail, a company number, an IBAN or a price on the page differs from `site.json`.',
    'Take the value from `site.json` (the facts of the client), or ask the owner to change the fact there. Write a foreign phone number with `+`.',
  ),
  r(
    'facts-schedule',
    'facts',
    'config',
    '`schedule.json` matches its strict schema.',
    '`schedule.json` is missing or not valid.',
    'Fix the field that the finding names. Days are `Mo` to `Su`, times are `HH:MM` and dates are `YYYY-MM-DD`.',
  ),
  // content
  r(
    'content-stale',
    'content',
    'build',
    'A translation matches its default-locale sibling (its hreflang alternate) in h2 count, in the site.json facts shown, and in internal link targets. The facts shown are the `site.json` values that `facts-value` finds on the page, as a set. The link targets of both pages are mapped into the default locale through hreflang before they are compared: a default-locale path stays, and another path becomes its default-locale alternate. A target is kept only when its hreflang maps back: a target that has no page in the default locale, or none in the locale of the translation, or whose alternate maps to another default-locale page, is left out on both sides.',
    'A translation differs from its default-locale page in its sections, its facts or its links.',
    'Update the translation to match the default-locale page: the same `h2` sections, the same facts and links to the same pages.',
  ),
  r(
    'content-language',
    'content',
    'build',
    "The rule looks at each leaf `p`, `li`, `td` or `blockquote` (one with no `p`, `li`, `td` or `blockquote` inside it) whose nearest `lang` (its own attribute or an ancestor's) is the page's `html lang`. It counts only the text that is not inside a descendant with another `lang`. When that text has ≥ 12 words (a word is a longest run of letters, with `'` and `’` between two letters inside it), the element fails if another language has ≥ 3 stopwords in it and more than twice the page language's count. Lists exist for de, fr, it and en, compared in lower case; pages in other languages are skipped.",
    'A paragraph is in another language than the page, and it has no `lang` attribute.',
    'Translate the text, or mark a quotation in another language with its `lang` attribute (`<blockquote lang="en">`).',
  ),
  r(
    'content-copied',
    'content',
    'build',
    "A translation's meta description differs from its default-locale sibling's. Titles and h1s may match.",
    'The meta description of a translation is the one of its default-locale page.',
    'Write the description in the language of the translation.',
  ),
  r(
    'content-glossary',
    'content',
    'build',
    "Title, description and body text contain no banned variant from `glossary.json`. Each text uses the list of the locale whose tag or code equals its nearest `lang` (its own element's or an ancestor's, up to `html`). For tag `de-CH` only, the built-in bans ß→ss, „→« and “→» apply too. Text under a `lang` that names no configured locale is skipped.",
    'A text uses a variant that the glossary of its locale bans.',
    'Write the term that `glossary.json` gives for the locale. In de-CH write `ss` for `ß` and the quotation marks « ».',
  ),
  r(
    'content-nfc',
    'content',
    'build',
    'Every text node and attribute value equals its NFC form.',
    'A text or an attribute value is not in Unicode normalization form NFC.',
    'Write the text in NFC: most editors do this when they save, or run `text.normalize("NFC")` on the content.',
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
    'Every element below that appears on a built page has a matching rule in `elements.css`: `h1`–`h6`, `p`, `a`, `strong`, `em`, `small`, `blockquote`, `ul`, `ol`, `li`, `dl`, `dt`, `dd`, `table`, `caption`, `th`, `td`, `figure`, `figcaption`, `hr`, `code`, `pre`, `button`, `input` (per `type`; a bare `input` rule covers all; `input[type=hidden]` is never shown and needs no rule), `select`, `textarea`, `label`, `fieldset`, `legend`, `details`, `summary`, `dialog`. A rule matches when its subject compound has the element\'s type and nothing that narrows it: no pseudo-class, no pseudo-element and no attribute selector, except one `[type=x]` on `input`. Each argument of `:is()` and `:where()` is the same element, so `:is(h1, h2)` matches both, and `input:is([type=radio], [type=checkbox])` matches those two types. An element matches every `:is()` and `:where()` of a compound: `:is(h1, h2):is(h2, h3)` matches `h2` alone, and `input:is([type=radio], [type=checkbox]):where(:disabled)` matches no input. `input:disabled` and `input:not([type=checkbox])` match no input. A rule with a class matches only an element with that class: `h1.lead` matches `<h1 class="lead">`, not `<h1>`. Every `type.class` variant used, on any element, needs its own rule: with `a.button` in `elements.css`, `<span class="button">` needs `span.button`. Exempt: `div`, `span`, `section`, `article`, `header`, `nav`, `main`, `aside`, `footer`; they need no rule of their own. Other elements need no rule.',
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
    'modes-script',
    'modes',
    'build',
    'With two or more mode options, every page, `/404.html` included, has exactly one kit mode script: a `<script>` with no attributes whose text equals `modeScript(options)`. It comes right after the CSP meta, and before every `<style>`, every `<link rel="stylesheet">` and the speculation block. Any other script whose text starts like the kit mode script fails too, also an exact copy with attributes: the page would run the mode script twice. With fewer options, no page has a script whose text starts like the kit mode script. In every case, the `html` start tag of every built page, `/404.html` included, carries no `data-mode` attribute: only the mode script sets it.',
    'The mode script of the kit is missing, doubled, changed or in the wrong place, or `html` carries `data-mode`.',
    'Write no mode script and no `data-mode` on `<html>`: the kit inserts the script right after the CSP meta. Remove any copy from the markup.',
  ),
  r(
    'modes-switch',
    'modes',
    'build',
    'With two or more mode options, every page, `/404.html` included, has exactly one `[data-mode-switch]` element, outside any `form`. It is or holds either a `fieldset` with a `legend` that has text and one `input[type=radio][name=mode]` per enabled option, or one `select[name=mode]` without `multiple` and with one `option` per enabled option. Every control named `mode` is inside the element, never the element itself. The values are the enabled options, each exactly once. Each radio and the select has a `label`. Each radio label and each `option` has text, and these texts differ. No other form control (`input`, `select`, `textarea`, `button`) is inside it, and no control named `mode` is outside it. With fewer options, no page has a `[data-mode-switch]` or a control named `mode`.',
    'The mode switch of the page is missing, doubled or does not follow the contract of the kit.',
    'Put one `[data-mode-switch]` element on every page, with a radio group in a `fieldset` with a `legend`, or one labeled `select name="mode"`, and one control for each enabled option. See `docs/modes.md`.',
  ),
  r(
    'modes-media',
    'modes',
    'config + build',
    'With a `light`, `dark` or `contrast` option on, no `@media` prelude outside `tokens.css` (in built CSS: outside the `tokens` layer) uses `prefers-color-scheme` or `prefers-contrast`, and no HTML `media` attribute uses them (`picture source`, `link`, `meta[name=theme-color]`; an example in a fenced code block or a code span of `.md` or `.mdx` is text, not markup): the switch cannot change them. In an `@container` prelude they are no container features: `css-media` reports them (7.10). In every case, no selector outside `tokens.css` and `base.css` (in built CSS: outside the `tokens`, `reset` and `layout` layers) names the `data-mode` attribute, and no declaration outside `tokens.css` (in built CSS: outside the `tokens` layer) sets `color-scheme`. The selectors of a page file (in built CSS: of the `page` layer) are left to `css-selector`, its other declarations to `css-page`, and what an `@scope` holds to `css-banned`.',
    'CSS or HTML outside `tokens.css` reads the color scheme or the contrast of the system, names `data-mode` or sets `color-scheme`.',
    'Use a color token: `tokens.css` maps each mode to its theme. For an image that changes with the theme, use an inline SVG that takes its colors from tokens.',
  ),
  r(
    'modes-behavior',
    'modes',
    'browser',
    'With two or more mode options, on the default home, at 1280×800 and at 390×844, without the reveal step, each viewport in a browser context of its own. When the `[data-mode-switch]` element is a closed `details`, `popover` or `dialog`, or sits inside one, the rule first opens each such element, outermost first, with a click on its native invoker (`summary`, `[popovertarget]` or `[commandfor]`), and opens nothing else. With JS on: the switch is visible. `html` has `data-mode` before `body` exists: an init script `MutationObserver` on `document` records `document.body` when `data-mode` appears, and that value is `null`. A click on the label of each option, or `selectOption()` on the select, sets `data-mode` to that option; the default mode comes first, then the other options in the order `auto`, `light`, `dark`, `contrast`, so the last choice is never the default. Then, in each emulated system state `S`, the computed `color-scheme` of `html` is `scheme(option)` of 7.7, and the probe color of every `--color-` token equals the design.md value of `T(option, S)`, with fallbacks and aliases resolved and painted through the same probe; each of the four channels is equal within 1 of 255. The last choice survives a navigation to the first page of the sample, in path order, that is neither the default home nor the 404 page (else the 404 page), and a reload: `data-mode` and the control show it. With JS off: no `input`, `select`, `textarea` or `button` named `mode` is visible, and in each `S` the probe colors equal those of `T(D, S)`. With fewer options, the rule has nothing to check. A popover, also a `dialog` with the `popover` attribute, opens through the first visible `[popovertarget]` that does not hide it or `[commandfor]` that shows it. A page that writes `data-mode` by itself gives one fixed finding for the viewport.',
    'The mode switch does not work: it is hidden, a choice does not set `data-mode`, a mode shows other colors than `docs/design.md`, or the choice is lost on the next page.',
    'Build the switch as `docs/modes.md` says (one labeled radio or option per mode, inside `[data-mode-switch]`), take every color from a token, and never set `color-scheme` or `data-mode` outside the kit.',
  ),
  // csp
  r(
    'csp-meta',
    'csp',
    'build',
    "Exactly one CSP meta (a `<meta>` child of `head` whose `http-equiv` equals `content-security-policy` in any letter case) with the directives of the kit for the settings, declared origins included: `default-src 'self'`, `img-src 'self'`, `font-src 'self'`, `connect-src 'self'`, `media-src 'self'`, `manifest-src 'self'`, `worker-src 'none'`, `frame-src 'none'`, `form-action 'self'`, `base-uri 'self'`, `object-src 'none'`, and `script-src` and `style-src` with `'self'` and hashes. No forbidden source (`'unsafe-inline'`, `'unsafe-eval'`, `'unsafe-hashes'`, `'strict-dynamic'`, `data:`, `blob:`, `http:`, a token with `*`, a host other than a declared origin) in a directive that lists sources, and no executable script before it. A CSP meta outside `head` fails: a browser ignores it.",
    'The CSP meta of the page is missing, doubled, differs from the policy of the kit, or comes after a script.',
    'Do not write a CSP meta, and do not change the one that Astro writes from the settings of the kit. Move any script after it.',
  ),
  r(
    'csp-hash',
    'csp',
    'config + build',
    'Every inline executable, `speculationrules` and `importmap` script has its hash in `script-src` (falling back to `default-src`); every inline `<style>` has its hash in `style-src` (falling back to `default-src`). Template content counts: a script can put it into the page. Source: no tag of a `.astro` file carries `define:vars` or `is:inline`.',
    'An inline script or style has no hash in the CSP of the page, or the source uses `define:vars` or `is:inline`.',
    'Remove `define:vars` and `is:inline`, and let Astro bundle the script or style, so that it hashes it. Never edit a script or style of the built page.',
  ),
  r(
    'csp-base',
    'csp',
    'build',
    'No `<base>` element, also none in template content.',
    'The page has a `<base>` element.',
    'Remove the `<base>` element and write each link as a root-relative path.',
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
  r(
    'edge-private',
    'edge',
    'build',
    'No private file of the client directory is public. The private files are `_headers`, `_redirects` and `.assetsignore` at the root, and at any depth `wrangler.json`, `wrangler.jsonc`, `wrangler.toml`, `.dev.vars`, `.dev.vars.*`, `.env` and `.env.*`. Each one must be hidden by the ignore lines that Cloudflare applies, in its order: `/.assetsignore`, `/_redirects` and `/_headers` first, then the lines of `.assetsignore` with the rules of `.gitignore`. So a later `!` line makes a platform file public, and fails.',
    'Cloudflare would serve a private file of the build to every visitor.',
    'Remove the `!` line from `public/.assetsignore`, or remove the file from `public/`. A secret never belongs in `public/`.',
  ),
  // html
  r(
    'html-validate',
    'html',
    'build',
    'Every page passes html-validate with only the kit config: `html-validate:recommended` and `html-validate:document`, elements `html5`; `unique-landmark`, `prefer-native-element` and `no-missing-references` are errors; `heading-level`, `wcag/h37`, `long-title` and `no-inline-style` are off; `require-sri` targets `crossorigin`, except a `script` whose `src` is on a host with `script` and `load: "page"`. html-validate reads the file as written, a UTF-8 byte order mark included. On a site with islands, Astro\'s island style element (`<style>astro-island,astro-slot,astro-static-slot{display:contents}</style>`, the one rule of 7.1, exactly, in a `<style>` without attributes) is read as a comment of the same length: Astro writes it into the body, where html-validate refuses a `<style>`, and the project cannot change it. Any other `<style>` in the body stays an error. A page with more than 4 × `domElements` elements or a depth over 4 × `domDepth` (the kit\'s limits, template content counted) is not validated, because html-validate takes seconds on it or overflows its stack: it fails with one finding that says so.',
    'The HTML of the page is not valid, or html-validate finds an accessibility problem.',
    'Fix the markup at the place that html-validate names. The detail holds its rule id and its message.',
  ),
  r(
    'html-shell',
    'html',
    'build',
    'The first focusable element (`a[href], area[href], button, input:not([type=hidden]), select, textarea, summary, iframe, [tabindex]:not([tabindex="-1"]), [contenteditable], audio[controls], video[controls]`) is a skip link `a[href="#<id>"]`, and the page\'s single `main` has that id (the fragment as written or percent-decoded). No `meta` has an `http-equiv` of `refresh` or a `name` of `referrer`, each trimmed and in any ASCII case, whatever its `content`. A meta refresh sends the visitor to any address with no gesture, which the CSP does not limit; a redirect belongs in `redirects.json`. A meta referrer overrides the `Referrer-Policy` header of 6.3, so it can send the full URL of the page to another origin. A `meta` inside a `noscript` counts too: a browser without JavaScript reads it. The kit\'s parser reads the whole page: it drops an element that is left open with its open ancestors, such as `<script src="/x.js">` with no end tag, and then no rule sees it. So a page fails when the parser finds fewer elements than it finds when it keeps every open element; so does the content of each `noscript` and the markup of each `srcdoc` that `origins-third-party` reads. HTML closes `p`, `li`, `td`, `dt` and `dd` by itself, and the parser keeps them; it drops an `option` with no end tag, so each `option` needs one. Such a page gives only this finding of `html-shell`, because its tree is not the page.',
    'The page does not start with a skip link to its one `main`, it has a meta refresh or a meta referrer, or the parser cannot read it in full.',
    'Make the first focusable element of the page a link `<a href="#main" class="visually-hidden">` to the `id` of its one `<main id="main">`. Remove a meta refresh (add a row to `redirects.json`) and a meta referrer (the kit header sets the policy). Close every element: write the end tag of each `script`, `iframe`, `a`, `form` and `option`; `npx html-validate` on the page names the open one.',
  ),
  // forms
  r(
    'forms-declared',
    'forms',
    'build',
    'Every form whose action starts with `/api/forms/` names a declared id and is `method="post"`. It has a hidden `return` equal to the page path, and the honeypot `input[name=website][type=text][tabindex="-1"][autocomplete=off]` inside an `inert` `aria-hidden="true"` element with class `visually-hidden`. It renders exactly the declared fields with the controls of 9.1: the `required` attribute as declared; `maxlength` = `maxLength` for string types; `min`/`max` as declared; choice values exactly the declared options (a select may add one empty option); consent a required checkbox; `autocomplete` as declared. The page has elements with ids `sent` and `not-sent`. Every declared form appears on at least one page. A form on `/404.html` is left to `routes-404`, so it reports once. The action, resolved like a link (a tab or line break is removed and a backslash before the query reads as `/`, as in a browser), makes a kit form when its path starts with `/api/forms/` in any letter case. That path is exactly `/api/forms/<id>/` of a declared form, with the last slash and no query, and no `http:` scheme. `method` and `enctype` compare in ASCII lower case without a trim, as a browser reads them, so `method="post "` fails. The form has no `enctype` other than `application/x-www-form-urlencoded` and `multipart/form-data`, no `accept-charset` token other than `utf-8` (any letter case), and no `novalidate`, and it is not under `[inert]` or `[hidden]`; a closed `dialog` may hold it. The rule reads the controls inside the form: a control with a `form` attribute, a `formaction`, `formmethod`, `formenctype`, `formtarget` or `formnovalidate` in the form, and a control elsewhere whose `form` attribute names the form fail. `return` and the honeypot are there exactly once. `return` is not disabled. The honeypot has an empty `value`, and nothing outside its wrapper names it: no `label`, and no `for`, `aria-labelledby` or `aria-describedby` with its id. A declared control has no constraint that a declaration cannot express: no `minlength`, `multiple`, `readonly`, `disabled` or `accept`, and no disabled `fieldset` around it (its first `legend` excepted). `step` is only on a number field, and only `1` or `any`. `maxlength`, `min` and `max` appear only where the field declares them. `pattern` appears only on an email field, where it is required and equals `EMAIL_PATTERN` (9.1). A consent checkbox has no `value` that is empty or white space only: the endpoint trims each value, so it would refuse every post. A radio group is every control of its name, each radio with `required` as declared; `autocomplete` is not checked on a checkbox or a radio. `#sent` and `#not-sent` each have `tabindex="-1"` and rendered text, and sit in no form, no dialog and no honeypot wrapper; a closed `details` may hold them. On every page, a form that posts to a same-origin path is a kit form: a static site has no other POST handler. A form posts when its `method` is `post` or when a submit control that it owns has `formmethod="post"`. A missing, relative or fragment-only action resolves against the page: a browser posts `action="#x"` to the page itself. On every page but `/404.html`, a submit control outside a kit form that changes a post to `/api/forms/` with `formaction`, `formmethod`, `formenctype` or `formtarget` fails.',
    'A form of the kit does not post to a declared form, or it does not render that form as declared.',
    'Post to `/api/forms/<id>/` with `method="post"`, and render the hidden `return`, the honeypot and exactly the fields of `astro-kit.json` `forms.<id>` with their attributes, as the forms-declared row of docs/standards.md says. Put `#sent` and `#not-sent` on the page.',
  ),
  r(
    'forms-fields',
    'forms',
    'build',
    'Every field (not hidden, submit, reset, button or image) has a label, except a field under `[inert]`; every other check of the rule holds under `[inert]` too. A required field\'s label contains a required word and no optional word, and an optional field\'s an optional word and no required word: de `pflichtfeld`, `erforderlich`, `pflicht` / `optional`, `freiwillig`; fr `obligatoire`, `requis` / `facultatif`, `optionnel`; it `obbligatorio`, `richiesto` / `facoltativo`, `opzionale`; en `required` / `optional`; rm `obligatoric` / `facultativ`. A field in another language fails when the language of the locale of its page has words. When it has none either, the field skips the word check with a warning, which carries its own message and fails nothing. Every non-checkbox, non-radio field has `autocomplete`. No `placeholder`. The controls inside `[data-mode-switch]` (9.3) need a label, but skip the required and optional word check and the `autocomplete` check. A field is an `input`, a `select` or a `textarea` of any page, also outside a form. A label is a `label` element (by `for`, or around the field). A field is required when it has the `required` attribute. The words are whole words of the rendered label text in lower case: the text of the label without the content of controls, `script`, `style` and `template`, and without any part under `hidden`, `inert` or `aria-hidden="true"`. For a radio, the rendered text of the `legend` of its nearest `fieldset` counts as label text too. A label or legend under an ancestor with `hidden` or `aria-hidden="true"` that does not also hold the field counts for nothing; `[inert]` alone hides no text from sight. The language is the first subtag of the nearest `lang` of the field.',
    'A form field has no label, misses its required or optional word or its `autocomplete`, or shows a placeholder.',
    'Give every field a `label`. Write the required or the optional word of the language into each label, set `autocomplete`, and remove the `placeholder`: put a hint into the label.',
  ),
  r(
    'forms-safety',
    'forms',
    'build',
    'No file input, no pre-checked checkbox or radio, and every POST form contains a link to its locale\'s `legal.privacy` path. These hold on every page. A POST form is a form whose `method` is `post` in ASCII lower case without a trim, or a form that owns a submit control with `formmethod="post"` (inside it, or elsewhere with `form=`). The link is an `a[href]` or `area[href]` inside the form whose same-origin path is the privacy path of the locale of the page, or the file of that page, and that a visitor can see and reach: neither the link nor an ancestor has `hidden`, `inert` or `aria-hidden="true"`, so a link in the honeypot wrapper does not count.',
    'A page has a file input or a pre-checked choice, or a form that posts data without a link to the privacy page.',
    'Remove the file input and the `checked` attribute, and put a link to the privacy page of the language inside each form that posts.',
  ),
  r(
    'forms-binding',
    'forms',
    'config',
    'With forms, `wrangler.jsonc` has `send_email` `EMAIL` whose `allowed_destination_addresses` equals exactly the set {`contact.to`, each `forms.<id>.to`, `contact.probe`}, and `ratelimits` `FORM_RATE_LIMIT` `simple {limit: 3, period: 60}` and `FORM_RATE_LIMIT_ALL` `simple {limit: 20, period: 60}`. The rule reads the file as the deploy job does: full-line `//` comments dropped, the rest JSON. A text that is not JSON fails. A missing file is left to `config-wrangler`, so it reports once. Exactly one binding has each name, and the addresses compare as a set.',
    'The mail binding or a rate limit of the form endpoint is missing or wrong in `wrangler.jsonc`.',
    'The protected files do not match the settings. Say so in the pull request: the owner starts the protected task for this branch.',
  ),
  // legal
  r(
    'legal-pages',
    'legal',
    'build',
    "Each declared legal note, privacy and accessibility path is a built page of its locale. Every indexable page links its own locale's legal note and privacy paths (the path, or the file of that page).",
    'A declared legal page is not built, or a page does not link the legal note and the privacy page of its locale.',
    'Build each legal page at its path in `astro-kit.json` `legal`, and link the legal note and the privacy page of the locale from every page, for example in the footer.',
  ),
  r(
    'legal-processing',
    'legal',
    'config',
    '`processing` contains `cdn` and `previews`, and with forms `forms` and `server`; it contains `forms`/`server` only with forms.',
    '`processing` does not match the features of the site.',
    'List `cdn` and `previews`. List `forms` and `server` with `features.forms`, and only then.',
  ),
  r(
    'legal-statement',
    'legal',
    'build',
    'A declared accessibility page claims conformance (a match of `konform`, `conforme`, `conformant` or `compliant`) only when `site.json` has `accessibilityAudit`. It reads the page text that a visitor sees: without the subtree of an element with `hidden`, `aria-hidden="true"` or the class `visually-hidden`, and without template content. When `body` itself or an element around it is such an element, the page has no such text. A match is a whole word, in any letter case: `/(?<!\\p{L})(konform|conforme|conformant|compliant)(?!\\p{L})/iu`. It is not a claim when one of `not`, `non`, `nicht`, `pas`, `kein`, `keine` stands as a whole word in the 24 characters before it.',
    'The accessibility page claims conformance without an audit in `site.json`.',
    'Remove the claim, or ask the owner to add the audit to `site.json` `accessibilityAudit`.',
  ),
  r(
    'legal-origins',
    'legal',
    'build',
    'The legal text of the privacy page of each locale holds the `processor` text of each entry of `origins`, as an exact substring. The processor is read as the legal text is: in NFC, with each run of white space as one space, trimmed; the letter case counts. The legal text holds only text that a visitor sees, so a processor in a hidden part is not named, and neither is one in a `main` that is hidden itself or inside a hidden element. One finding for each privacy page, naming every processor that it lacks. A declared privacy page that is not built is left to `legal-pages`.',
    'A privacy page does not name the processor of a declared origin.',
    'Add the sentence about the processor to the privacy page of each locale, with the name written exactly as in `origins[].processor`. The owner approves the legal text.',
  ),
  // media
  r(
    'media-animated',
    'media',
    'build',
    'No animated image ships: a GIF with more than 1 frame, an APNG (acTL before IDAT), a WebP with an ANIM chunk, or an AVIF with the `avis` brand. The format comes from the bytes, as a browser picks its decoder: every dist file is read except the text files (`.html`, `.htm`, `.css`, `.js`, `.mjs`, `.cjs`, `.map`, `.json`, `.txt`, `.xml`, `.svg`, `.webmanifest`), whatever its extension, or none.',
    'An animated image ships with the site.',
    'Replace the animation with a still image, or with a `video` that has captions and that the visitor starts.',
  ),
  r(
    'media-captions',
    'media',
    'build',
    "Every `video` has a `track[kind=captions]` child with `srclang` equal to the tag or code (a browser reads only the `track` children). Every `audio` is followed (next sibling, or the parent's next sibling) by a link whose accessible name or `href` matches `/transcript|transkript|transcription|trascrizione/i`.",
    'A video has no captions in the language of the page, or an audio has no transcript link after it.',
    'Add `<track kind="captions" srclang="<tag>">` to the video, and a link to the transcript right after the audio.',
  ),
  r(
    'media-pdf',
    'media',
    'build',
    'Every `.pdf` in dist is a key of `site.json` `documents`, its value is a built page path, and that page links the PDF.',
    'A PDF is not declared in `site.json` `documents`, or its page does not link it.',
    'Declare the PDF in `site.json` `documents` with the page that offers it, and link it from that page, or remove the file.',
  ),
  // svg
  r(
    'svg-name',
    'svg',
    'build',
    'Every outer inline `svg` is hidden (it or an ancestor has `aria-hidden="true"` or the `hidden` attribute), or has `role="img"` with an `aria-label` or a non-empty `title`.',
    'An inline SVG is neither hidden nor named.',
    'Add `aria-hidden="true"` to a decorative SVG, or `role="img"` with an `aria-label` to one that carries meaning.',
  ),
  // a11y
  r(
    'a11y-axe',
    'a11y',
    'browser',
    'No axe violation with tags `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, `wcag22aa`, `best-practice`: in a fresh tab at 1280×800 in every declared theme, and in a fresh tab at 390×844 after the reveal step (every `details` open and every popover shown, then each dialog of the step open); a node fails once for each axe rule, in the first state that shows it, and equal details of one page are one finding with a count. These "needs review" results also fail: `color-contrast` with reason `bgImage`, `imgNode` or `pseudoContent`, and `video-caption`. For `color-contrast` with reason `bgGradient`, the kit takes the first gradient layer of the visual stack behind the text, composites each color stop over the color behind that layer (its own background color and the layers below it, then white) and the text color over the stop (gradient text: over the color below the layer), and the node fails when any stop gives less than the ratio that axe expects for it (`expectedContrastRatio`), or when no stop is found; on running text it also fails below 7:1 (4.5:1 for large text). Axe\'s `color-contrast-enhanced` also runs; a violation counts on running text: inside `main`, in a `p`, `li`, `dd`, `td`, `th`, `blockquote` or `figcaption`, not inside `a`, `button`, `label` or `summary`, each read through the flat tree, so text in an open shadow root of a component in `main` counts; its "needs review" results do not fail. In each theme at 1280×800, a link without underline in running text needs 3:1 against the text around it (WCAG 1.4.1). An animation that never ends fails (WCAG 2.2.2). An axe run that takes longer than 15 s is reported, and a page that writes `data-mode` by itself gives one fixed finding.',
    'axe-core finds an accessibility fault on the page, in at least one theme.',
    'Read the axe rule named in the detail (https://dequeuniversity.com/rules/axe/4.14/<rule>) and fix the markup; for a contrast fault, fix the wrong token in the component CSS, and change `docs/design.md` only when the owner approves a new value. Underline a link in running text, and let no animation loop for ever.',
  ),
  r(
    'a11y-focus',
    'a11y',
    'browser',
    'The first Tab and every sweep stop show `outline-style` other than `none` and `outline-width` ≥ 2 px, and a ring with a contrast of at least 3:1 against the color behind it (WCAG 1.4.11). In each declared theme that a fresh tab does not show, at 1280×800, each stop takes the focus in turn and its ring color is measured again; an element that the fresh 1280×800 tab reported is not reported again in another theme. A mouse click on a link, button or summary shows `none` or 0. A sweep is the Tab sequence of `a11y-keyboard`, through its stops, in each state of that rule. A press that leaves the focus on a part that the browser draws inside a control (the picker button of a date field, the volume of a player), where the control does not match `:focus`, is not measured, and neither is an `iframe`.',
    'An element that the keyboard focuses shows no focus ring of at least 2 px and 3:1 contrast, or a mouse click shows one.',
    'Give `:focus-visible` an outline of at least 2 px in the focus color (for example `outline: var(--line-2) solid var(--color-focus)`), never override its color in a component, and never set an outline on `:focus` alone.',
  ),
  r(
    'a11y-targets',
    'a11y',
    'browser',
    'At 1280×800 and 390×844, and after the reveal step at 390×844 (every visible `details` open, every target of a visible `[popovertarget]` or of a visible `[commandfor]` with `command` `show-popover` or `toggle-popover` shown, and each `dialog` target of `[commandfor][command=show-modal]` opened by itself): `a[href]` (except a link inline in text: climbing from its parent through the inline elements of `links-generic` up to the nearest ancestor that is not inline, one of these elements has a text node of its own with a letter or a digit), `button`, `input` (except checkbox, radio, hidden), `select` and `summary` are ≥ 43.5×43.5. Boxes ≤ 1×1 and boxes above the page start are skipped.',
    'A control is smaller than 43.5×43.5 CSS pixels.',
    'Give the control a block size and an inline size of at least `2.75rem` (for example with padding), or put the link inline in a sentence.',
  ),
  r(
    'a11y-reflow',
    'a11y',
    'browser',
    "At 320×640, before and after the reveal step at 390×844 (every visible `details` open, every popover of a visible invoker shown, and each `show-modal` dialog opened by itself): no element's right edge exceeds `clientWidth + 1` unless an ancestor scrolls, and `scrollWidth ≤ clientWidth + 1`. An element with the kit class `visually-hidden`, and every element inside it, is skipped.",
    'At 320 CSS pixels the page scrolls sideways, or an element sticks out on the right.',
    'Let the content wrap: use the layout helpers, `max-inline-size: 100%` on media, and `overflow-wrap: anywhere` for long words. Put a wide table in a container that scrolls.',
  ),
  r(
    'a11y-spacing',
    'a11y',
    'browser',
    'With `* { line-height: 1.5 !important; letter-spacing: .12em !important; word-spacing: .16em !important } p { margin-bottom: 2em !important }` at 1280 and 390 px, no element with `overflow-y` hidden or clip that holds a text node with a letter or a digit (outside `script`, `style` and `.visually-hidden`) has `scrollHeight − clientHeight > 2`. An element with the kit class `visually-hidden` is skipped, and so is every element inside it: the class clips text in a 1 px box on purpose.',
    'With wider text spacing, an element that hides its overflow cuts off its text.',
    'Do not fix the block size of a box that holds text, and do not hide its overflow: let it grow with its text.',
  ),
  r(
    'a11y-forced-colors',
    'a11y',
    'browser',
    'With forced colors active: `h1` and `main` are visible; every button (`button`, `input[type=button|submit|reset]`, `[role=button]`) has a border with style not `none`, width ≥ 1 px and a color that is not transparent, at 1280×800, at 390×844 and in each state of the reveal step; the first Tab of the fresh 1280×800 tab shows a focus ring.',
    'In forced colors mode, the heading or the content is not visible, a button has no border, or the focus ring is missing.',
    'Give every button a border of at least 1 px (`transparent` in the normal theme is fine: forced colors paint it), and do not hide content with colors alone.',
  ),
  r(
    'a11y-keyboard',
    'a11y',
    'browser',
    'At 1280×800, 390×844 and 390×844 after the reveal step (every visible `details` open, every popover of a visible invoker shown, and each `show-modal` dialog opened by itself, with a sweep of its own), Tab reaches every visible control within stops + 5 presses. The stops are the visible elements of the Tab sequence, where a radio group counts as one, plus each control that a negative `tabindex` keeps out of it (a composite widget with a roving `tabindex` counts once, with its group) and each scroll container that Chromium puts into it. A press that leaves the focus on the same element does not count, up to 50 in a sweep. No focused element is entirely covered: the center and the four corners, inset 2 px, of each on-screen line box are sampled with `elementFromPoint`.',
    'The Tab key does not reach a control, or a focused element is hidden under another element.',
    'Use native controls in the order of the page, never a positive `tabindex`, and keep a sticky header from covering the focused element (`scroll-padding-block-start`).',
  ),
  r(
    'a11y-no-js',
    'a11y',
    'browser',
    'With JS off, `h1` and `main` are visible, and every link target and named control visible with JS on, except `[data-mode-switch]` and its content, is visible with JS off (both after the reveal step). Each declared form is filled and submitted within 10 s: email `probe@example.com`; tel `+41441234567`; date today + 30 days; number its `min`; choice its first option; consent checked; text and textarea `Kit browser test`. It must land on `<page path>#sent` with `#sent` visible. Before it fills a form, a fresh tab with JS off opens every `details` and popover, as the reveal step does, and then the dialog that holds the form, with a click on its visible native invoker (`[commandfor][command=show-modal]`). A form in a dialog that no visible invoker opens fails. In that fresh tab, before the reveal step, neither `#sent` nor `#not-sent` is visible. After the reveal step, the form shows a visible link to the privacy page of the locale. After the send, `#sent` is visible with text and `#not-sent` is not. A declared field whose control is disabled (also by a `fieldset`) or readonly, and a disabled submit control, are named before the fill, and the check goes on with the next form.',
    'Without JavaScript, content, a link or a control is missing, or a form does not reach its confirmation.',
    'Render the content and the controls in HTML, and let a script only add to them. A form posts as plain HTML and returns to `#sent`.',
  ),
  r(
    'a11y-reveal',
    'a11y',
    'browser',
    'Hidden UI opens only through native invokers (`summary`, `[popovertarget]`, `[commandfor]`). An element with `aria-expanded` or `aria-controls` that is none of those fails, unless it is inside an `astro-island`.',
    'A script-only toggle opens hidden content.',
    'Use `<details>` with `<summary>`, a `popovertarget` button or a `commandfor` button, so that the browser opens the content without a script.',
  ),
  // contrast
  r(
    'contrast-pairs',
    'contrast',
    'browser',
    'On the default home, in every declared theme, every `docs/design.md` pair meets its role ratio: text 7, ui 4.5, non-text 3. A fresh probe element for each read, which no transition or rule of the page reaches, takes the foreground as `color` and the background as `background-color`; each computed color is painted on a 1×1 canvas, the background composited over the page background of the theme (the background of the `body` pair, over white) and the foreground over the result, and the ratio uses WCAG relative luminance. A pair with another role is left to `design-pairs`.',
    'A contrast pair of `docs/design.md` misses the ratio of its role in a theme.',
    'Change the token value in `docs/design.md` for that theme (run `npx --no astro-kit tokens`), or give the pair the role it really has.',
  ),
  // perf
  r(
    'perf-lcp-priority',
    'perf',
    'browser',
    'On each tested page (the sample, or every page with `--all`), at 390×844 with device scale 3 and at 1440×900 with device scale 1, with 150 ms latency, 200,000 B/s down, 75,000 B/s up, the CPU 4× slower and the cache off: an `img` that is the LCP element has `fetchpriority="high"` and no `loading="lazy"`, as the browser reads them. The LCP element is the last `largest-contentful-paint` entry after the load of each image in the viewport (30 s at most) and, while a larger loaded image has no entry, after its entry (5 s at most).',
    'The largest image of the first screen loads late: it has no `fetchpriority="high"`, or it is lazy.',
    'Give the main image of the first screen `fetchpriority="high"` and `loading="eager"` (the kit image component does this with its priority prop), and keep `loading="lazy"` for images further down.',
  ),
  r(
    'perf-cls',
    'perf',
    'browser',
    'On each tested page at 390×844 and at 1280×800, the largest session window of layout shifts without recent input (a gap under 1 s, at most 5 s) is at most 0.05. Every animation moves in fixed frames of 16.7 ms, so a slow machine gets the same result. It is measured from `load`, while the page scrolls down half a viewport every 150 ms to its end, then at its top while the images load (10 s at most) and until at least 5 s after `load` and 2 s with no shift (10 s at most).',
    'Content moves while the page loads or scrolls.',
    'Give every image, video and embed its `width` and `height` (or an `aspect-ratio`), reserve the space of late content, and never insert content above what the visitor sees.',
  ),
  r(
    'perf-image-oversize',
    'perf',
    'browser',
    'On each tested page, at 390×844 with device scale 3 and at 1440×900 with device scale 1: no image that loads on its own loads a raster file and shows nowhere. With every lazy image loaded, no rendered raster image loads more than 1.5 × its rendered width × the device scale, for the files that it adds to the transfer. The loaded width is the `w` descriptor of the chosen `srcset` candidate (not `naturalWidth`), else the natural width times the density. Only the smallest `w` candidate of a `srcset` is exempt.',
    'An image loads far more pixels than it shows, or it loads and shows nowhere.',
    'Give the image a `sizes` that matches its rendered width and a `srcset` with smaller widths, or a smaller original. An image that a device does not show is lazy, or its `picture` gives that device no file.',
  ),
  r(
    'perf-bfcache',
    'perf',
    'browser',
    'On each tested page at 1280×800: the page, then the page with the query `?kit-bfcache`, which settles, then back; the `pageshow` of the page has `persisted` true within 5 s.',
    'The browser cannot restore the page from the back/forward cache.',
    'Remove what blocks the cache: `Cache-Control: no-store`, an `unload` listener, an open connection. The detail names the reason that Chromium gives.',
  ),
  r(
    'perf-prerender',
    'perf',
    'browser',
    'With `prefetch.speculationRules`, on each tested page at 1280×800: hovering the first visible link to another page in `header`, `main` or `footer` that the speculation rules of the kit match gives a request for its URL with `Sec-Purpose: prefetch;prerender` within 2 s. A page with links to other pages, none of them matched, fails.',
    'A hover on a link starts no prerender, or no link of the page can be prerendered.',
    'Keep the speculation block of the kit in every page: no change to its text, its place or the CSP hash, and no `target` other than `_self`, no `download`, `hreflang` or `rel="nofollow"` on ordinary links.',
  ),
  r(
    'perf-prefetch',
    'perf',
    'browser',
    'With `prefetch.astroPrefetch` on and `prefetch.speculationRules` off, on each tested page at 1280×800: hovering the first visible link to another page in `header`, `main` or `footer` that the prefetch gate picks gives a request for its URL within 2 s, and once the page holds the response, the click on the link loads the page where it lands with `transferSize` 0, or with only a conditional request (a 304 of a page with `max-age=0`).',
    'A hovered link is not prefetched, or the click does not use the prefetch.',
    'Let the prefetch gate of the kit run on every page, do not send `Cache-Control: no-store` for pages, and do not change the URL of a link when it is clicked.',
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
  /**
   * Set for a finding that only warns, whatever the level of its rule: it is printed with `!` and fails nothing. A
   * rule uses it where section 8 says that it skips a check with a warning (`forms-fields`).
   */
  warning?: true;
  /**
   * The message of a warning (`Report.warn`), printed in place of the failure message of its rule: a warning says
   * what the rule skipped, not what failed.
   */
  message?: string;
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
  return !finding.waived && finding.warning !== true && getRule(finding.rule, rules).level === 'error';
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
    const message = finding.message ?? rule.message;
    const text = `[${rule.id}] ${finding.where}: ${message}${finding.detail ? ` (${finding.detail})` : ''}`;
    if (finding.waived) {
      lines.push(`~ ${text} (waived until ${finding.waived.until}: ${finding.waived.reason})`);
      continue;
    }
    lines.push(`${rule.level === 'warn' || finding.warning === true ? '!' : '✗'} ${text}`);
    // The hint fixes a failure. A warning with a message of its own has nothing to fix.
    if (finding.message === undefined) lines.push(`    fix: ${rule.hint}`);
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

  /**
   * One line that counts the failing findings, without their text. Astro prints `message`, but it picks its hint from
   * `toString()`: a text with `document` or `window` gets "Browser APIs are not available on the server" (13.1). A
   * rule id such as `budget-document` would set that false hint off.
   */
  override toString(): string {
    const count = failures(this.findings).length;
    return `${this.name}: astro-kit: ${count} ${count === 1 ? 'finding fails' : 'findings fail'} the build`;
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

  /**
   * Adds a finding that only warns (`Finding.warning`): it is printed with `!` and its own `message`, and it fails
   * nothing.
   */
  warn(rule: string, where: string, message: string, detail: string): void {
    getRule(rule, this.rules);
    this.findings.push({ rule, where, detail, warning: true, message });
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

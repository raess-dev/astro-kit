# astro-kit-test

The test repository of `@raess/astro-kit`. It holds two things:

- **The site** of the fictitious Hotel Lärchenwald in Sils im Engadin, made with the kit. It is a normal kit project
  in the repository root.
- **The acceptance suite** in `test/`. It tests the kit on that site, and it runs the platform spikes.

The kit specification decides what belongs here: `docs/spec.md` in `raess-dev/astro-kit`, sections 13.2, 14 and 14.2.
The file `docs/spec.md` of this repository is another document: the brief of the hotel site.

## State

Milestone M3: the site, stage 1, and the first site cases of the suite.

- **Pages:** the home page in German, French and English (`/`, `/fr/`, `/en/`), the legal note and the privacy page
  in the three languages, and the one 404 page. The other pages of 14.2 come at stage 2 (milestone M5).
- **Settings:** forms are off until milestone M7. All four display modes are on, so every page has the mode switch.
- **Suite:** the harness, the spikes S1 to S19, and the site cases that the kit commands `build` and `tokens` can run.

## The site

`AGENTS.md` says how the site is built. `docs/spec.md` is its brief, and `docs/design.md` holds its design system.

**The host is provisional.** The production domain is not known yet, so the site uses `laerchenwald.example`.
To move the site to its domain, change these places:

- `astro-kit.json`: `site` and `securityContact`;
- `site.json`: the two email addresses;
- `wrangler.jsonc`: the Worker name and the route. The kit renders this file from `astro-kit.json`: with
  `npx --no astro-kit init --protected` from milestone M9 on, and before that as the text of the kit function
  `renderWrangler`;
- `AGENTS.md`: the first line;
- `docs/spec.md`: the open question about the domain.

No file under `src/` holds the host: the pages read it from the two JSON files.

**The kit is not in `package.json` yet.** `@raess/astro-kit` is not on npm. `astro.config.mjs`, `biome.json` and
`tsconfig.json` use it all the same: they are the shims of the kit. So `npm ci` alone gives a tree that cannot build
the site. The kit joins `package.json` and the lockfile when the placeholder `@raess/astro-kit@0.0.0` is on npm
(kit specification, 11.4). The suite then still installs the packed kit over it. The site moves to the released kit
with version `0.1.0`.

### Build the site with a packed kit

Pack the kit in its own repository:

```sh
npm ci --ignore-scripts && npm run build && npm pack --pack-destination /tmp
```

Then, in this repository:

```sh
npm ci --ignore-scripts
npm install --no-save --ignore-scripts /tmp/raess-astro-kit-0.0.0.tgz
npx --no astro-kit tokens --check
npx --no astro-kit build
```

- `build` runs `astro build`. The kit checks the project before the build and the built pages in `dist/` after it.
  A finding is a line that starts with `✗ [<rule id>]`, and the command ends with status 1. A build with no finding
  prints no line of the kit and ends with status 0.
- `tokens` writes `src/styles/tokens.css` from `docs/design.md`. `tokens --check` writes nothing and compares the
  file. Never edit `tokens.css` by hand.
- The next `npm ci` removes the packed kit again. So does a second `npm install --no-save`.

## Run the suite

```sh
npm ci --ignore-scripts
KIT_TARBALL=/tmp/raess-astro-kit-0.0.0.tgz node --test 'test/**/*.test.ts'
```

- The suite copies this repository into a temp folder, the base copy, and installs its packages there once. Each
  case runs in a folder of its own under `<base>/cases/`. The first step takes about a minute. The test files of one
  run share one base copy.
- `KIT_TARBALL=<file>` names the packed kit. The base copy installs it, and the site cases run with it. Without it
  the site cases are skipped, each with the reason, and the spikes run.
- `KIT_ACCEPTANCE_KEEP=1` keeps the base copy and prints its path. `KIT_ACCEPTANCE_BASE=<path>` uses it again.
  - A reused base copy gets the files of the working tree again in every run. So it holds the site and the tests as
    they are now.
  - Its packages and its kit stay as they are. The run stops with a message when `package-lock.json` or the
    dependencies of `package.json` changed, or when `KIT_TARBALL` names another packed kit than the one it holds.
    Then make a fresh base copy: run once without `KIT_ACCEPTANCE_BASE` and with `KIT_ACCEPTANCE_KEEP=1`.
  - Without `KIT_TARBALL`, the run uses the kit that the reused base copy holds.
- `CHROME_PATH=<file>` names the browser. Without it, the suite uses the Chromium that `playwright-core` installed
  (the acceptance workflow runs `playwright-core install chromium`), else `/usr/bin/google-chrome`. When it does not
  find the Playwright build, it says so once on stderr: no pin decides the browser of that run.
- A `CLOUDFLARE_ENV`, `CLOUDFLARE_API_TOKEN` or `CLOUDFLARE_ACCOUNT_ID` of the shell does not reach a build or a
  wrangler command of the suite.
- One file alone: `node --test test/site.test.ts`. One spike alone: `node --test test/spikes/s05.ts`. All spikes:
  `node --test test/spikes.test.ts`.

## The site cases

`test/site.test.ts` holds the cases of milestone M3. A case copies the site into `<base>/cases/<name>/`, applies one
change, and runs a command of the kit CLI there. A passing case asserts status 0. A failing case asserts the exact
sorted list of rule ids.

- The site builds, and every built page has the CSP meta, right after it the mode script of the kit, and then the
  speculation block.
- `tokens --check` passes, so `src/styles/tokens.css` is the rendering of `docs/design.md`.
- The edge files exist, and `robots.txt` is the text of the kit.
- Three planted cases: a value changed by hand in `tokens.css` gives `design-tokens`; `// @ts-ignore` in a source
  gives `config-suppression`; a redirect row with a query string in `from` gives `routes-redirects`.

The helpers are in `test/harness.ts`: `siteCase(name, change)` makes the copy, `run(case, command)` runs the kit CLI
of the base copy and gives the status, the output and the rule ids, and `kitModule(name)` imports a built module of
the kit, which its exports map hides.

## The spikes

A spike proves one platform fact that the kit design rests on. It builds a minimal Astro project that the suite
writes from strings. It uses no kit: `test/kit/` holds a small stand-in integration.

- `test/spikes/sNN.ts` holds the tests of one spike. Every other file in that folder is a helper of a spike.
- `test/harness.ts` (the temp folder, the kit CLI, Astro, Chromium, the measured values), `test/serve.ts` (the static
  server) and `test/wrangler.ts` (`wrangler dev`, with no login and no network) are the shared helpers.
- A base copy without a kit has no `tsconfig.json`. The file of the site extends the preset of the kit, and Vite
  loads every `tsconfig.json` up the folder tree of a project. Without the kit it would stop the build of every spike.

`test/spikes.results.json` holds the measured values. A later run fails when a value changes. Run with
`KIT_SPIKES_WRITE=1` to accept a new value, and then check what the change means for the kit specification.
A new value is written to the file. On CI (`CI` is set) it fails the spike instead: commit the file with the value.
A value is the same on every machine: a spike records no text that a browser version decides and no time. A spike
compares two colors as pixels of a canvas, never as computed text.

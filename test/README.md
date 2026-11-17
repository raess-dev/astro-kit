# The tests of the kit

Three folders. Nothing under `test/` is in the npm package: the `files` list of `package.json` is a whitelist.

- `test/unit/`: the unit tests of the kit. They use strings and small temp folders, never an Astro build.
  Command: `npm test`.
- `test/acceptance/`: the acceptance suite. It holds the platform spikes, and the site cases that run the packed kit
  on the test site. Command: `npm run acceptance`.
- `test/site/`: the test site, the fictitious Hotel Lärchenwald in Sils im Engadin. It is one complete kit project.
  It has no test command of its own: the suite tests it.

The specification says what belongs here: `docs/spec.md`, sections 13.2, 14 and 14.2.

`npm run check` (Biome and `tsc`) covers `test/unit/` and `test/acceptance/` like all other kit code. It leaves
`test/site/` out: the site is a project of its own, with its own `biome.json` and `tsconfig.json`.

## Run

Run every command at the repository root.

```sh
npm ci --ignore-scripts
npm test
npm run acceptance
```

`npm run acceptance` does this:

1. It builds the kit of this checkout and packs it: it removes `dist/`, then runs `npm run build` and `npm pack`
   into a temp folder.
2. It makes the base copy: a copy of `test/site/` in the temp folder. There it runs `npm ci`, and then one
   `npm install --no-save` command with the pins of the suite and the packed kit. This takes about a minute.
3. It runs each case in a folder of its own under `<base>/cases/`. Node, Astro and the kit find every package in
   `<base>/node_modules`.

The test files that run at the same time share one packed kit and one base copy. The last test file removes the
temp folder. On a machine with one or two CPUs, or with `--test-concurrency=1`, the test files run one after the
other, and each one that needs the base copy makes its own. `KIT_ACCEPTANCE_KEEP=1` avoids that.

One file alone: `node --test test/acceptance/site.test.ts`. All spikes: `node --test test/acceptance/spikes.test.ts`.
One spike alone: `node --test test/acceptance/spikes/s05.ts`.

### Variables

- `KIT_TARBALL=<file>` names a packed kit. The suite then installs that file, and does not build and pack the
  checkout.
- `KIT_ACCEPTANCE_KEEP=1` keeps the base copy and prints its path on stderr.
- `KIT_ACCEPTANCE_BASE=<path>` uses a kept base copy again. That saves the install while you write a case.
  - The base copy gets the files of `test/site/` again in every run. So it holds the site as it is now.
  - Its packages and its kit stay as they are. The run stops with a message when `test/site/package-lock.json` or
    the dependencies of `test/site/package.json` changed, or when the packed kit of the run is another one than the
    kit it holds. A change in `src/` gives another packed kit. Then make a fresh base copy: run once without
    `KIT_ACCEPTANCE_BASE` and with `KIT_ACCEPTANCE_KEEP=1`.
- `CHROME_PATH=<file>` names the browser. Without it, the suite uses the Chromium that `playwright-core` installed
  (`npx --no playwright-core install chromium`), else `/usr/bin/google-chrome`. When it does not find the Playwright
  build, it says so once on stderr: no pin decides the browser of that run.
- `KIT_SPIKES_WRITE=1` accepts a new measured value (see "The spikes"). `KIT_SPIKES_RESULTS=<file>` sends the
  measured values to another file.
- A `CLOUDFLARE_ENV`, `CLOUDFLARE_API_TOKEN` or `CLOUDFLARE_ACCOUNT_ID` of the shell does not reach a build or a
  wrangler command of the suite. The suite needs no token and no account.

## The acceptance suite

- `harness.ts`: the packed kit, the base copy, the case folders, and the runners for the kit CLI, Astro, Chromium and
  the measured values. `serve.ts` is the static server of the suite. `wrangler.ts` runs `wrangler dev`, with no login
  and no network. `photos.ts` makes deterministic photos.
- `site.test.ts`: the site cases. A case copies the site into `<base>/cases/<name>/` with `siteCase(name, change)`,
  applies one change, and runs a command of the kit CLI there with `run(case, command)`. A passing case asserts
  status 0 and, with `passedLine(result)`, that the passed line is the last line of stdout and stands once in the
  output. A planted case asserts the exact sorted list of rule ids, and that the output holds no passed line. At
  milestone M3 the cases are: the site builds
  with the CSP meta, the mode script and the speculation block on every page; `tokens --check` passes; the edge files
  exist; and three planted violations give `design-tokens`, `config-suppression` and `routes-redirects`.
- `spikes.test.ts` and `spikes/`: the spikes S1 to S19. `spikes/sNN.ts` holds the tests of one spike. Every other
  file in that folder is a helper of a spike.
- `kit/`: a small stand-in integration for the spikes. It is not the kit. `kit.test.ts` checks that it holds the
  exact texts of the specification.

### The spikes

A spike proves one platform fact that the kit design rests on. It builds a minimal Astro project that the suite
writes from strings into an empty case folder. It uses the stand-in of `kit/`, never the kit.

`spikes.results.json` holds the measured values. A later run fails when a value changes. Run with
`KIT_SPIKES_WRITE=1` to accept the new value, and then check what the change means for the specification. A new key
is written to the file. On CI (`CI` is set) a new key fails the spike instead: commit the file with the value.
A value is the same on every machine: a spike records no text that a browser version decides and no time. A spike
compares two colors as pixels of a canvas, never as computed text.

## The test site

`test/site/AGENTS.md` says how the site is built. `test/site/docs/spec.md` is the brief of the hotel site: it is
another document than the specification of the kit. `test/site/docs/design.md` holds the design system.

**The kit is not in its `package.json`.** The shims `astro.config.mjs`, `biome.json` and `tsconfig.json` use
`@raess/astro-kit` all the same. So `npm ci` alone in `test/site/` gives a tree that cannot build the site: the
suite, or you, install the packed kit over it.

**The host is provisional.** The site has no production domain, so it uses `laerchenwald.example`. To move the site
to another host, change these places under `test/site/`:

- `astro-kit.json`: `site` and `securityContact`;
- `site.json`: the two email addresses;
- `wrangler.jsonc`: the Worker name and the route. The kit renders this file from `astro-kit.json`;
- `AGENTS.md`: the first line under the heading;
- `docs/spec.md`: the open question about the domain.

No file under `src/` holds the host: the pages read it from the two JSON files.

### Build the site by hand

```sh
npm run build && npm pack --pack-destination /tmp
cd test/site
npm ci --ignore-scripts
npm install --no-save --ignore-scripts /tmp/raess-astro-kit-0.0.0.tgz
npx --no astro-kit tokens --check
npx --no astro-kit build
```

- `build` runs `astro build`. The kit checks the project before the build and the built pages in `dist/` after it.
  A failing finding is a line that starts with `✗ [<rule id>]`, and the command then ends with status 1. A command
  with no failing finding ends with status 0, and its last line on stdout is `astro-kit: all checks passed.`
- `tokens` writes `src/styles/tokens.css` from `docs/design.md`. `tokens --check` writes nothing and compares the
  file. Never edit `tokens.css` by hand.
- The next `npm ci` removes the packed kit again. So does a second `npm install --no-save`.
- Git ignores `node_modules/`, `dist/`, `.astro/` and `.wrangler/` of the site. The base copy of the suite does not
  take them.

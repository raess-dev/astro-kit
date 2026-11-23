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
- `KIT_PLANTED_DROP=<id>` runs a planted set without the plant of that id, and expects the list without that id. It
  is for the review only, one run for each id: `planted-build.test.ts` takes an id of the `build` set, and
  `planted.test.ts` one of the `css` set. A file fails on an id that is not in its set. CI never sets it.
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
  and no network. `photos.ts` makes deterministic photos. `site-assets.ts` made the binary files of the test site
  (see "The photos and the PDF of the site").
- `site.test.ts`: the site cases. A case copies the site into `<base>/cases/<name>/` with `siteCase(name, change)`,
  applies one change, and runs a command of the kit CLI there with `run(case, command)`. A passing case asserts
  status 0 and, with `passedLine(result)`, that the passed line is the last line of stdout and stands once in the
  output. A planted case asserts the exact sorted list of rule ids, and that the output holds no passed line. At
  milestone M3 the cases are: the site builds
  with the CSP meta, the mode script and the speculation block on every page; `tokens --check` passes; the edge files
  exist; and three planted violations give `design-tokens`, `config-suppression` and `routes-redirects`.
- `design-values.test.ts`: the differential test of the token values. The kit writes a value of `docs/design.md`
  into `tokens.css` as it is, so a value that `design-format` accepts must be valid CSS. For each token family the
  test makes many thousand candidate values.
  - The seeds are the values of `test/unit/design-values.ts` and more values of the test file.
  - The words come from the kit under test: every word of the built `dist/design/parse.js` stands in each kind of
    place of the accepted seeds, as a keyword, as a unit and as a function name. So the test needs no copy of the
    lists of the kit, and a word that only the kit knows is a candidate.
  - A generator with a fixed seed changes the seeds, with the words that the kit accepted.

  The packed kit says which candidates it accepts. Chromium then checks each accepted one: the declaration parses
  for every use of its family (the properties of 7.3, and the calculations that 7.4 promises), the value stands in
  a sheet like `tokens.css` as a custom property with a value, the declaration with `var()` has the effect of the
  declaration with the value, and each `var()` in the value names a token of the right family. The test asserts
  that no accepted value fails. The few values that 7.4 accepts for some uses only are the table `LIMITS` of the
  file. A kit that accepts a value which is no CSS fails here with the value and the uses: then fix the grammar in
  `src/design/parse.ts`, add the value to the refused list of the unit test, and correct 7.4. The file takes about
  a minute.
- `css-site.test.ts`: the suite case of M4. It builds the site, and feeds the `<style>` of every built page and
  every source CSS file under `src/styles/` to the four CSS analyzers of the packed kit (`css/parse`,
  `css/selectors`, `css/media`, `css/values`). Every rule and declaration parses, every selector and prelude parses,
  no project layer holds a literal or a token of the wrong family, and each page has the layer order of 7.1. The
  declarations of each tree must be those of a plain reading of the text, in order, so a lost declaration fails.
- `css-oracle.test.ts`: the differential test of the CSS analyzers (specification, 14.2). It builds the site once
  for its CSS, and holds six promises of the packed kit to Chromium, each with thousands of candidates from a
  generator with a fixed seed. The seeds are the strings of the unit test files and the CSS of the site; the words
  of the mutations come from the built modules `css/selectors` and `css/media`.
  - Selectors: a list that `parseSelectorList` accepts is valid in Chromium (`CSS.supports('selector(…)')`,
    `querySelectorAll`, `selectorText`), and one that it refuses as `invalid` is refused by all three. A refusal
    as `unread` (a name the kit does not know, a namespace, a problem inside `:is()`) gets no claim.
  - Specificity: two rules whose selectors match one element of a fixed document set one custom property in one
    layer. The computed value shows the winner, and the kit's order must agree.
  - Preludes: a query of `@media` that the kit accepts is no `not all` in the `MediaList`, and one with an
    `invalid` problem is. An `@container` prelude that the kit accepts stays with the same `conditionText`, and
    one with an `invalid` problem is dropped. A problem of 7.10 alone gets no claim.
  - Style sheets: the test writes the kit's tree out again as CSS, and Chromium must read the same `cssText` from
    it as from the original text: for the site's CSS, the CSS of the parse unit test and mutants of both.
  - Nesting: a nested rule sets a custom property that does not inherit, and the elements where Chromium sets it
    must be those that the kit's resolved selectors match. A resolved selector that the kit calls `invalid` must
    set nothing.
  - Component shapes: a selector that `shapeProblems` passes for `card.css` matches only inside a root of `card`,
    and matches the same elements when the roots have other tags or when another component has another class name.

  Controls show that each comparison can fail. A gap is a defect of the kit or of the test: fix the module at the
  cause, add the value to its unit test, and correct the specification. The file takes a few seconds after the
  build.
- `planted-build.test.ts`: the `build` set of the planted sets of M5. One copy of the site gets every plant of the
  set, one plant for each id, and `build` runs once. The test asserts the exact sorted ids, status 1 and no passed
  line. A plant on the shared layout or the header acts on one page only. The ids of later rules join with them:
  the forms ids at M7, `legal-origins` and `origins-third-party` at M8, `legal-approved` at M9.
- `planted.test.ts`: the planted sets `css`, `design` and `modes` of M5, and the five typical agent mistakes. A set
  plants every violation of its list in one copy and runs `build` once; it asserts the exact sorted ids and no
  passed line. The plants of the `css` set are a table, one entry per id. A case that changes `docs/design.md` runs
  `tokens` first. Each mistake is one change on its own copy and gives exactly one id. `js-budget` joins the `css`
  set at M8.
- `site-assets.test.ts`: the committed PDF menu equals the one that `site-assets.ts` makes from `site.json`. A
  change of a menu fact in `site.json` without a new PDF fails here.
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

### The photos and the PDF of the site

The site commits its binary files. `test/acceptance/site-assets.ts` made them, and it is kit test code, not a file of
the site:

- the photos `src/assets/photos/home-hero.jpg` (1280 × 720), `rooms.jpg`, `restaurant.jpg` and `getting-here.jpg`
  (960 × 640 each). Each is one color with the noise of `photos.ts` (xorshift32 with seed 7, the noise of 14.2,
  JPEG quality 82). Only the size and the color differ. Each file stays under 200 KB;
- the share image `public/og.jpg` (1200 × 630), with less noise, so it stays far under the 153,600 B of `head-og`;
- the menu `public/speisekarte.pdf`: one A4 page of text with its title in the document information. It takes the
  price of the evening menu and the phone of the restaurant from `site.json`.

Run at the repository root, after `npm ci --ignore-scripts`:

```sh
node test/acceptance/site-assets.ts           # writes the files that differ, and names them
node test/acceptance/site-assets.ts --check   # writes nothing; status 1 when a file differs
```

`sharp` comes from the Astro install of the repository (`node_modules/astro`), so the script adds no dependency.
Another `sharp` version can write other JPEG bytes. The photos then look the same, and `--check` names them. Run the
script again after a change of the price of the evening menu or of the phone of the restaurant in `site.json`:
`site-assets.test.ts` fails until the PDF is new.

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

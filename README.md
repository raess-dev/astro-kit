# @raess/astro-kit

One Astro integration and one CLI. They enforce a standard on multilingual marketing websites: performance, SEO,
accessibility, security, privacy, legal duties and code quality.

- AI coding agents write the sites. No person reviews their code: CI merges a green pull request.
- The kit ships no markup, no components, no layouts and no helper functions. It checks the built output.
- The owner acts only at the edges: accounts, facts, legal texts, settings, approvals.

## State

The kit is being built from `docs/spec.md`, milestone by milestone (section 14). This branch holds the milestones
M0 to M3: the rule registry, the docs generator, the settings and the preflight checks, the integration, the kit
CSS, the token generator, the edge files, and the commands `build` and `tokens`. It has 27 rules. The package is not
published.

## The specification

`docs/spec.md` says what to build and why. It is complete: a builder needs no other document. When this README and
the specification differ, the specification wins.

## Work on the kit

```sh
npm ci --ignore-scripts
npm run build
npm run check
npm test
node src/docs.ts --check
npm run acceptance
```

`CONTRIBUTING.md` holds the rules for a change. `SECURITY.md` says how to report a vulnerability.

## The tests

Everything is in this repository. Nothing under `test/` is in the npm package.

- `test/unit/`: the unit tests of the kit. They use strings and small temp folders, and they never build an Astro
  project. `npm test` runs them in a few seconds.
- `test/acceptance/`: the acceptance suite. It builds the kit of this checkout, packs it, installs the packed kit
  into a temp copy of the test site, and runs the kit CLI there. It also runs the platform spikes S1 to S19.
  `npm run acceptance` runs it in a few minutes. It needs a Chromium: run
  `npx --no playwright-core install chromium` once, or set `CHROME_PATH`.
- `test/site/`: the test site, the fictitious Hotel Lärchenwald. It is one complete kit project with its own
  `package.json`. Its `package.json` does not list the kit: the suite installs the packed kit of the checkout.

`npm run check` covers `test/unit/` and `test/acceptance/`. It leaves `test/site/` out: the site has its own
`biome.json` and `tsconfig.json`. `test/README.md` says more: the variables of the suite, and how to build the test
site by hand.

## License

MIT

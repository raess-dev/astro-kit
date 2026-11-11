# Contributing

Pull requests come from collaborators only. One concern per pull request.

## Every rule

- Has one entry in `src/registry.ts`: a stable id, a group, a stage, the standard as one decidable sentence, the
  failure message and a fix hint.
- Has a test that fails on a bad case and passes on a good case, under `test/`. `test/unit/docs.test.ts` lists every
  id that no test names.
- Appears in `docs/standards.md`. Run `npm run docs` after any registry change and commit the result; CI runs
  `node src/docs.ts --check`.

## The version rule

- **Major:** a new failing check, a stricter check, a removed option, or a changed limit. Any change that can turn a
  green site red is a major.
- **Minor:** a new option or feature that is off by default, a new helper, or a looser hint.
- **Patch:** a fix that turns no green site red, and docs.

Bump `version` in `package.json` in the same pull request, and add one neutral line to `CHANGELOG.md`. A major entry
says what breaks and how a site fixes it, because the upgrade recipe reads it.

## Before you push

```sh
npm ci --ignore-scripts
npm run build
npm run check
npm test
node src/docs.ts --check
```

Then link the kit (`mkdir -p node_modules/@raess && ln -sfn ../.. node_modules/@raess/astro-kit`) and run
`npm run test:fixtures` (about five minutes). It builds the site variants, the bad sites and the scale site, and runs
the browser checks. A changed fixture source also needs its copy in `examples/`; `npm test` names any difference.

Code is TypeScript with erasable syntax only, ESM with relative `.ts` imports, `node:` built-ins and web APIs.
No new dependency without the owner.

## How changes land

`kit.yml` tests every pull request. Its merge job squashes a green, non-draft pull request from the owner or
Dependabot on the tested commit, then dispatches `release.yml`, which stages the new version for the owner's approval.
The merge job skips every pull request that touches `.github/**`: the owner reviews and merges those by hand.

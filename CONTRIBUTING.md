# Contributing

Pull requests come from collaborators only. One concern per pull request. `docs/spec.md` decides what the kit does: a
pull request that changes a fixed value changes that file too.

## Every rule

- Has one entry in `src/registry.ts`: a stable id, a group, a stage, a level, the standard as one decidable sentence,
  the failure message and a fix hint. The waivable mark comes from the one list in that file.
- Has a unit test with one passing and one failing case, under `test/unit/`.
- Has a planted violation in the acceptance suite of `raess-dev/astro-kit-test`, or a name in its list of rules that
  the sets do not plant.
- Appears in `docs/standards.md`. Run `npm run docs` after a registry change and commit the result. CI runs
  `node src/docs.ts --check`.

## Tests

The kit has unit tests only. No kit test installs, builds, serves or checks an Astro project. Every real build runs
in the test repository.

## The version rule

**Levels.** Every rule has a level: `error` or `warn`. An `error` finding fails the command. A `warn` finding is
printed and fails nothing.

**The warning stage.** A new check, and a check that becomes stricter, first ships at level `warn`, in a release that
breaks nothing. Its message ends with `This becomes an error in <version>.` The next breaking release sets it to
`error`.

**What each release may hold.**

- **Breaking:** a rule that moves from `warn` to `error`, a removed option, a changed limit, or a changed shim. Any
  change that can turn a green site red is breaking. The CHANGELOG entry says what breaks and how a site fixes it.
- **Feature:** a new option or feature that is off by default, a new rule at level `warn`, or a looser check.
- **Fix:** a fix that turns no green site red, and docs.

**Numbers.** From `1.0.0` on: breaking is a major, feature is a minor, fix is a patch. While the major is `0`:
breaking is a minor, and feature and fix are patches.

**With each change.** A change pull request adds one neutral line under `## Unreleased` in `CHANGELOG.md`. It does
not change `version`. A release pull request sets `version` and moves those lines under the new version.

## Who merges

CI merges a green pull request of an agent account. It never merges a pull request that changes `.github/` or
`.npmrc`: the owner approves such a pull request and merges it by hand. Agents never approve and never merge.

## Before you push

```sh
npm ci --ignore-scripts
npm run build
npm run check
npm test
node src/docs.ts --check
```

## Code

TypeScript with erasable syntax only. ESM with relative `.ts` imports. `node:` built-ins and web APIs only. No new
dependency without the owner.

# Upgrade the kit or a dependency

Reads: `node_modules/@raess/astro-kit/CHANGELOG.md`, and each rule it names in [standards.md](../standards.md).

## How updates arrive

- Dependabot opens weekly, grouped pull requests: the kit, Astro, and everything else. It skips kit majors.
- After the owner approves a kit release, the weekly kit task opens an upgrade pull request in each site, majors
  included, that follows this recipe.
- GitHub Actions bumps also come from Dependabot. They touch `.github/`, so CI merges them only when the ruleset allows.

## Steps

1. Read every changelog entry between the installed version (`npm ls @raess/astro-kit`) and the new one.
2. Install exactly: `npm install --save-exact --ignore-scripts <package>@<version>`. Never use `overrides`, and never
   a git, URL or file spec.
3. If the changelog names a changed shim, run `npx --no astro-kit init --shims` and commit the result.
4. Run `npx --no astro-kit ci`. A new or stricter check may fail existing pages: fix the pages, never the check.
5. In the pull request body, list each change you made and the changelog line it answers.

## Majors

- A kit major means a new or stricter failing check, a removed option or a changed limit. Expect content and markup fixes.
- Astro majors come through a kit release that supports them. Stay inside the kit's peer range for `astro`.
- When a fix needs an owner file (`astro-kit.json`, `wrangler.jsonc`, `.github/`), describe the exact change in a
  draft pull request and stop.
- A red Dependabot pull request for the kit: fix it on its own branch with the same steps.

## Never

- Weaken a check, add a suppression comment, or edit `node_modules/` to make a build pass.
- Install with lifecycle scripts. `.npmrc` sets `ignore-scripts=true`; keep it.
- When the kit is in the way, write a `KIT-FEEDBACK.md` entry and keep the check.

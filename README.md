# @raess/astro-kit

One Astro 7.4 integration that enforces a standard for fast, secure and accessible multilingual marketing sites
on Cloudflare Workers. The integration is the standard: `astro build` fails when a page breaks a rule, wherever it
runs. `astro-kit test` adds the browser checks, and `astro-kit ci` adds the checks against the base branch and the
live site. Every rule has one line in [docs/standards.md](docs/standards.md).

The kit is built for sites that agents write and CI merges, with no human review of pull requests. People act only
at the edges: accounts, money, legal text, facts, keys, and approving kit releases.

It ships one page shell (`Page.astro`), a class-light `base.css`, the contact form, the Biome and TypeScript presets,
a CLI, and the docs agents read first ([docs/INDEX.md](docs/INDEX.md)). There is no starter and no UI library.

## Adopt it

In an empty private repository:

```sh
npx @raess/astro-kit init --site https://example.ch --locales de,fr --features forms
npm install --ignore-scripts
npx --no astro-kit ci
```

`init` writes the fixed config shims, `astro-kit.json`, the site workflow, Dependabot, the agent hook and docs, and
starter pages in each locale. Then follow [docs/recipes/new-site.md](docs/recipes/new-site.md).

| Command | What it does |
|---|---|
| `npx --no astro-kit check` | The kit's project checks (config, sources, routes, facts), Biome, then `astro check` |
| `npx --no astro-kit build` | `astro build` with every build audit |
| `npx --no astro-kit test` | The browser checks: axe, focus, targets, reflow, contrast, performance |
| `npx --no astro-kit ci` | check, build, `test --all`, then the base-branch and live-sitemap checks |
| `npx --no astro-kit smoke <url>` | The production checks; `--probe` also sends the contact form |
| `npx --no astro-kit routes import <file>` | Seeds redirects from an old site's sitemap or URL list |
| `npx --no astro-kit provision zone --check` | Compares the Cloudflare zone settings with the kit's |

## Owner edges

- **GitHub:** the Team plan on the organisation; the rulesets from `templates/github-org-rulesets.json`; the custom
  property `kit-site=true` on each site after its init pull request merges; read-only workflow permissions; an
  Actions budget alert; the Claude GitHub App.
- **Cloudflare:** the account, each zone and its DNS cutover. Per site: the Worker with its custom domain and
  `workers.dev` off, the www or apex Single Redirect with `AAAA 100::`, the `<site>-preview` Worker behind Access,
  two Worker-scoped tokens, a read-only zone token, and a one-day edit token at launch. One click to verify each
  mail recipient.
- **Per site:** the brief (`docs/spec.md`), `src/content/site.json`, the legal text per locale, the glossary, and the
  default locale, which is effectively permanent.
- **Keys:** `KIT_FEEDBACK_TOKEN` lets a site file its `KIT-FEEDBACK.md` entries as issues in the private feedback
  repository; `KIT_FEEDBACK_AUTO_KEY` signs them. Create, rotate and revoke them at will.
- **This repository:** set the variable `KIT_OWNER` to your GitHub login, so the merge job merges your green pull requests.

## Releases

A merged pull request dispatches `release.yml`. It stages the version in `package.json` on npm, only when npm does
not have it yet, through trusted publishing. Staging never publishes: you approve each version with 2FA.

```sh
npm stage list @raess/astro-kit
npm stage download <stage-id>
npm diff --diff=@raess/astro-kit@<previous> --diff=<downloaded .tgz>
npm stage approve <stage-id>
```

The first release, once: publish `0.0.0` by hand with 2FA, then
`npm trust github @raess/astro-kit --file release.yml --repo raess-dev/astro-kit --allow-stage-publish`, then approve
the first staged version within two days. Sites get patches and minors through Dependabot, and majors through the
weekly kit task. The version rule is in [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT

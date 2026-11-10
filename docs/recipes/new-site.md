# Start a new site

Reads: [INDEX.md](../INDEX.md) and the owner's brief. Run every command in the repository root.

## Before you start (owner)

- An empty private repository, with the Claude GitHub App installed.
- The production origin, the locales and the features. The first locale is the default: it owns the root URLs and
  is effectively permanent.

## Steps

1. `npx @raess/astro-kit init --site https://example.ch --locales de,fr`, plus `--features forms` when the site has a
   contact form. It writes the shims, `astro-kit.json`, the workflows, starter pages and `docs/spec.md`.
2. `npm install --ignore-scripts`, then commit everything, `package-lock.json` included.
3. `npx --no astro-kit ci`. It fails `head-og` until `src/assets/og.jpg` exists; that is expected.
4. Open a draft pull request that asks the owner for: `docs/spec.md` filled in, `src/content/site.json`, the imprint
   and privacy text per locale, and `src/assets/og.jpg` (1200×630).
5. When the spec arrives, build from it: the pages ([content.md](content.md)), the tokens in `src/styles/theme.css`
   ([component.md](component.md)), and the page ids for the owner to put in `nav`.
6. Run `npx --no astro-kit ci` until it passes, then mark the pull request ready for review.

## After the first merge (owner)

- Set the custom property `kit-site=true` on the repository, so the push ruleset protects the owner files.
- In Cloudflare: the Worker with its custom domain and `workers.dev` off, the `<site>-preview` Worker behind
  Cloudflare Access, and one Worker-scoped token for each.
- In GitHub: the environments `production` and `preview`, each with its token as `CLOUDFLARE_API_TOKEN`, and the
  repository variable `CLOUDFLARE_ACCOUNT_ID`.
- With forms: verify the mail addresses and set `KIT_PROBE_SECRET` ([forms.md](../forms.md)).
- Going live, DNS and search consoles: [launch.md](launch.md).

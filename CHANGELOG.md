# Changelog

Each version has one line per change. A major says what breaks and how a site fixes it.

## 0.1.0

First release.

- The Astro 7.4 integration: options in `astro-kit.json`, fixed config shims, locked Astro settings, and the
  supply-chain checks on `package.json`.
- The rule registry and `docs/standards.md`, generated from it.
- Build audits: scripts and speculation rules, budgets, images and fonts, head and structured data, headings,
  hreflang, links and click depth, facts, transcreation and language, the CSS contract, the CSP, HTML validity,
  forms, legal pages, media and SVG.
- Browser checks in Chromium: axe in light and dark, focus, targets, reflow, text spacing, forced colours, keyboard,
  no-JS, contrast pairs, and the performance pass.
- Cloudflare Workers static assets output: `_headers`, `_redirects`, the sitemap, `robots.txt` and `security.txt`.
- `features.forms`: the contact endpoint, mail through `send_email`, and the weekly probe.
- `features.islands`: Solid 1.9 islands with the hydration hash in the CSP.
- The CLI: `init`, `check`, `build`, `test`, `ci`, `smoke`, `routes import`, `provision zone` and `feedback send`.
- `Page.astro`, `LocaleLinks.astro`, `ContactForm.astro` and `base.css`.
- Photos in Markdown pages: the content column as `sizes`, and `priority` on the first photo of a page.
- `site.json` `contacts` for a second email address or phone number.
- The Biome and TypeScript presets, and the agent docs and recipes.

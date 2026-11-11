# Write copy; add, move or remove a page

Reads: `docs/spec.md`, and the content, head and links groups of [standards.md](../standards.md).

## A new page

1. Add `src/content/pages/<default>/<id>.md` with `title` (15–70 characters), `description` (50–160), `slug`, and
   the `brief` from the spec: `intent`, `audience`, `message` and `cta`.
2. Build. Each other locale fails `routes-translation`: transcreate it (below), or list the locale in `missing`.
3. Link it within three clicks of the locale home: from a parent page, or from the nav (the owner edits `nav`; the
   label is the title up to its first ` – `, or a `nav.<id>` message, so keep that part short).

## The brief and transcreatedFrom

Write every locale from the brief, not from the default text. A changed brief fails `content-stale` with the new hash:
transcreate again, then set `transcreatedFrom` (never without redoing the text). Keep the h2s, facts and link targets.

## Transcreation prompt

Fill every brace from the spec, `site.json` and the default page. Remove nothing.

```text
Write the {locale} ({tag}) version of one page of a marketing website, as an original text for {audience}.
Do not translate sentence by sentence. Register: {register}. Voice: {voice}.
Brief: intent {intent}. Message {message}. Call to action {cta}.
Use these terms exactly: {glossary}. State these facts exactly, never rounded or reworded: {facts}.
Title 15 to 70 characters, description 50 to 160. Keep the h2 sections of the source, in order.
Keep every claim and obligation; add none, soften none. Change idiom and examples where {locale} needs it.
Source ({defaultLocale}): {source}
Output Markdown with title and description in front matter. Then list each uncertainty under "Uncertainties:".
```

The uncertainties never go into the page: put them in the pull request body, and keep it a draft while one is open.

## Rules

- Facts come only from `site.json`; a second email or phone goes in its `contacts`. `CHF 180.–` in Markdown is fine: the amount counts. Code uses `formatMoney()` and `formatDate()`.
- Banned terms go in `src/content/glossary.json` as `{"de": {"banned": {"variant": "canonical"}}}`. de-CH already bans ß, „ and “.
- Moved page: new `slug`, plus `{"from": "/old/", "to": "/new/"}` in `src/content/redirects.json`. Removed: `{"from": "/old/", "gone": true}`.
- `draft: true` keeps a page out of production; a draft pull request or the `preview` label previews it.

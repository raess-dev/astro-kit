# Add a language

Reads: [content.md](content.md), and the routes, hreflang and content groups of [standards.md](../standards.md).

## Owner first

`astro-kit.json` is protected, so the owner adds the locale to `locales`: `{"code": "it", "tag": "it-CH", "name": "Italiano"}`.
The `code` is the URL segment, the `tag` is the BCP 47 tag in `lang` and `hreflang`, and the `name` is the endonym in
the language switcher. The owner also supplies the imprint and privacy text in the new language, and its glossary.
Until then, the build fails: open a draft pull request that asks for them.

## Steps

1. Create `src/content/pages/<code>/` with one file per page id of the default locale, each with its own `slug`.
2. Transcreate every page from its brief ([content.md](content.md)) and set `transcreatedFrom` to the brief hash.
   Start with home, contact, imprint, privacy and sitemap; list any page you leave out in the default entry's `missing`.
3. If `src/content/messages/` exists, add `<code>.json` with exactly the keys of the default locale. The kit ships
   UI text in de, fr, it and en only. For another language, `<code>.json` must also hold every kit key; the build
   names the missing ones ([content-messages](../standards.md#content-messages)).
4. Add the language's banned variants to `src/content/glossary.json`.
5. Build and test. The checks confirm reciprocal hreflang, `html lang`, unique titles, the language of each block,
   and that no title, description or h1 was copied from the default locale.

## Notes

- Never change `defaultLocale`: it moves every URL of two locales.
- A locale code may not equal a default-locale slug, and slugs never start with a reserved segment such as `api`.
- Mark a quoted phrase in another language with `<span lang="…">`.

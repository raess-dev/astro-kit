# Examples

Read-only copies of the kit's own fixture sites. Read them to see the working patterns; never import them.

- `site/` is the `src/` of the good fixture: two locales, translated slugs, briefs and transcreation,
  the legal pages, the sitemap page, the 404 page and the theme.
- `islands/` adds one Solid island (`islands/MoreLinks.tsx`) and the route that renders it with `client:visible`.

A unit test keeps these files equal to `test/fixtures/` in the kit repository.

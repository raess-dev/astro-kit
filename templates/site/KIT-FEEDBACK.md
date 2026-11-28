# Kit feedback

Add an entry when you work around the kit, or when a check seems wrong. Never weaken a check.

- One `## kf-<8 hex>` section for each entry. Make the id with
  `node -e "console.log('kf-' + require('node:crypto').randomBytes(4).toString('hex'))"`.
- The six fields, each a list line: `- date:` (YYYY-MM-DD), `- kit:` (the version of `@raess/astro-kit`), `- type:`
  (`bug`, `false-positive`, `gap`, `docs` or `friction`), `- problem:`, `- evidence:` and `- proposal:`.
- A value may go on over indented lines. Write no client name, no address of a page and no copy of the site:
  `npx --no astro-kit feedback send` refuses an entry that holds a URL.

<!-- Entries start below this line. -->

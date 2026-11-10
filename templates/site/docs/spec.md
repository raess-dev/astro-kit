# {{NAME}}: the brief

The owner writes this file. It decides brand, audience, pages, copy and facts; the kit decides how they are built.
Agents read it before every content change and ask in a draft pull request when something is missing or unclear.

## Brand

- Name and legal name:
- What the business does, in two sentences:
- Voice: three adjectives, and three words never to use:
- Colours and type (for `src/styles/theme.css`), or "keep the defaults":
- Images the owner supplies: `src/assets/og.jpg` (1200×630, the default share image), photos with their alt text.

## Audience

- Who visits, and what they want to get done:
- What should they do next (the main call to action):

## Locales

- Default locale (effectively permanent, it owns the root URLs): {{DEFAULT_LOCALE}}
- All locales: {{LOCALES}}
- Glossary: the terms that must stay the same in every page, per locale.

## Pages

One block per page. The brief becomes the page's `brief` front matter in the default locale; every other locale is
transcreated from it, never translated line by line.

### home

- Intent:
- Audience:
- Message:
- Call to action:

### (next page id)

- Slug per locale:
- Intent:
- Audience:
- Message:
- Call to action:

## Facts

Every email address, phone number, UID, IBAN, address and price lives in `src/content/site.json` (owner only).
Opening hours and closures live in `src/content/schedule.json`.

## Legal sources

- Imprint text per locale, from:
- Privacy notice per locale, from (it must cover every processing the site declares):
- Accessibility statement, if any, and the audit it rests on:

## Open questions

- (date) question, and who answers it

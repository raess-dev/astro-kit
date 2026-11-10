# Kit feedback

Agents add an entry here whenever they work around `@raess/astro-kit`, hit a check that seems wrong, or miss
something in its docs. Never weaken a check instead. Nothing leaves this repository unless the owner sets
`KIT_FEEDBACK_TOKEN`; then the `feedback` job files each new entry once as an issue for the kit maintainer.

One entry per section, in this shape. The id is random: `node -e "console.log('kf-' + require('node:crypto').randomBytes(4).toString('hex'))"`.
`kit` is the installed version (`npm ls @raess/astro-kit`). `type` is one of bug, false-positive, gap, docs or friction.
A value may continue on indented lines. Write no client names, URLs or copy: describe the case neutrally.

```md
## kf-0a1b2c3d

- date: 2026-01-31
- kit: 1.2.0
- type: false-positive
- problem: links-same-name fails two "Contact" links that point at the same page with different fragments.
- evidence: `npx --no astro-kit build` reports links-same-name on /fr/contact/ for #form and #map.
- proposal: Compare targets without the fragment.
```

<!-- Entries start below this line. -->

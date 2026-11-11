# Islands (`features.islands`)

An island is the last tier: use one only when HTML, CSS, an Astro component and a bundled script all fall short.
It is a Solid 1.9 component that renders on the server and hydrates in the browser.

**Owner:** switches `features.islands` on in `astro-kit.json`. The kit then adds `@astrojs/solid-js` itself; never add
it to a config.

**Agent:** installs the pinned packages, restores the fixed lint config, and writes the island:

```sh
npm install --save-exact --ignore-scripts @astrojs/solid-js@7.1.2 solid-js@1.9.18
npm install --save-exact --ignore-scripts --save-dev eslint@10.14.0 eslint-plugin-solid@0.19.0 typescript-eslint@8.72.2
npx --no astro-kit init --shims
```

```astro
---
import Filter from '../islands/Filter.tsx';
---

<Filter client:visible />
```

Rules:

- Islands live in `src/islands/`. `astro-kit check` lints them with ESLint and `eslint-plugin-solid`.
- Hydrate with `client:visible`, `client:idle` or `client:media` only ([js-directive](standards.md#js-directive)).
- The server markup must work without JS: links and forms first, the island only enhances them ([a11y-no-js](standards.md#a11y-no-js)).
- All island JS stays within 20 KB compressed ([js-budget](standards.md#js-budget)).
- The kit hashes Solid's hydration script from the installed `solid-js` and adds it to the CSP. Never add a hash by hand.
- Trusted Types is off while islands are on, because Solid writes HTML through templates.
- Inside an island, use the kit classes and tokens; islands have no scoped styles of their own.
- No island fetches from another origin ([origins-third-party](standards.md#origins-third-party)).

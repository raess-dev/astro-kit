# Add or change a component, style, script or island

Reads: [INDEX.md](../INDEX.md) (tier test and native UI vocabulary), and the css, js and a11y groups of
[standards.md](../standards.md).

## First

Read `node_modules/@raess/astro-kit/examples/` before writing anything. It is a complete site that passes every
check: copy its patterns, never its content.

## The tier test

Use the first tier that works: an HTML element, then CSS, then an Astro feature, then a bundled `<script>` with
`features.scripts`, then a Solid island with `features.islands` ([islands.md](../islands.md)). Name the tier in the
pull request, and why the tier below it fell short. Tiers 4 and 5 need the owner to switch the feature on.

## Styles

- Tokens live in `src/styles/theme.css`, in `@layer theme`: colours, type, spacing. Colour literals go only there.
- A component styles itself in its own `<style>` block, which Astro scopes. Never use `is:global` or a `style` attribute.
- Global classes come only from the kit list: `container`, `grid`, `stack`, `cluster`, `full-bleed`, `primary`,
  `secondary`, `contrast`, `outline`, `lead`, `muted`, `visually-hidden`. Any other class must be scoped.
- Every `var()` names a token that exists. No `100vw`, no `100dvw`, no `overflow-x: hidden` on html or body.
- Keep the kit focus outline, the 44 px controls and the reduced-motion block. Do not restyle them away.

## Markup

- One h1 per page, no skipped heading levels, and link text that names the destination.
- Inline SVG gets `aria-hidden="true"`, or `role="img"` with a name.
- Images: `<Picture>` from `astro:assets`, with `sizes` when the image is narrower than the content column.
- No `target="_blank"`, no third-party resource, no new external origin.

## Finish

Build and test, then review the page with `npx --no astro-kit test --outline /path/`. The browser checks cover axe,
contrast, focus, targets, reflow at 320 px, text spacing and forced colours.

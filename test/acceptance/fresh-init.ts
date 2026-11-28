/**
 * The strings of the fresh init case (14.2, Fresh init): the smallest valid `docs/design.md` and
 * `src/styles/elements.css` for the default settings of `init`. The one mode option `auto` needs the theme `light`
 * alone (7.12). The design has no variant class and no component.
 */

/** The smallest `docs/design.md`: one theme, two colors, one row of each required family, and the four pairs of 7.4. */
export const DESIGN_MD = `# Design

The plan of the site's look: every token, the themes, the breakpoints and the contrast pairs.

## Themes

| Theme | Use |
|---|---|
| light | The default theme. |

## Color

| Token | light | Use |
|---|---|---|
| \`--color-text\` | \`#222222\` | Text, links and the focus ring. |
| \`--color-page\` | \`#ffffff\` | The page. |

## Typography

| Token | Value | Use |
|---|---|---|
| \`--font-body\` | \`system-ui, sans-serif\` | Body text. |
| \`--text-m\` | \`1rem\` | Body text. |

## Spacing

| Token | Value | Use |
|---|---|---|
| \`--space-2\` | \`0.5rem\` | A small gap. |

## Breakpoints

| Name | Width | Use |
|---|---|---|

## Contrast pairs

| Foreground | Background | Role | For |
|---|---|---|---|
| \`--color-text\` | \`--color-page\` | text | body |
| \`--color-text\` | \`--color-page\` | ui | link |
| \`--color-text\` | \`--color-page\` | non-text | focus |
| \`--color-text\` | \`--color-page\` | ui | error |
`;

/** The smallest `elements.css`: the body, link and focus pairs, as 7.4 says (\`design-pairs\`), in the format of Biome. */
export const ELEMENTS_CSS = `@layer elements {
  body {
    color: var(--color-text);
    background-color: var(--color-page);
  }

  a {
    color: var(--color-text);
  }

  :focus-visible {
    outline-color: var(--color-text);
  }
}
`;

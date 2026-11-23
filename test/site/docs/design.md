# Design

The plan of the site's look: every token, the themes, the breakpoints and the contrast pairs.
The kit renders `src/styles/tokens.css` from this file: run `npx --no astro-kit tokens` after each change.
A pull request that changes this file waits for the owner's approval.

## Brand

Hotel Lärchenwald is a small family hotel at the edge of a larch forest above Lake Sils. The look is warm, calm and
easy to read. It takes its colors from the place: the cream of lime plaster, the rust and gold of larch trees in
autumn, the dark green of the forest and the teal of the lake.

- **Calm.** One text column with a steady left edge, wide margins and much space between sections. Nothing moves
  except one short entrance of the hero text.
- **Warm.** No pure white and no pure black in the two base themes. Backgrounds are cream or dark wood, and text is
  a dark or a light brown.
- **Legible.** Body text is 17 px and has a line height of 1.6. A line holds about 70 characters. Running text has a
  contrast of at least 7:1 in every theme.
- **Type.** Headings use a serif of the visitor's system, and text uses the system's sans-serif. The site loads no
  font file.
- **Shape.** Corners are slightly round. Lines are thin and have a contrast of 3:1, so that a border is also seen
  with weak sight.

## Themes

| Theme | Use |
|---|---|
| light | The default look: cream plaster, dark brown text, rust links. |
| dark | The evening look: dark wood, light text, the same hues with less light. |
| light-contrast | The light look with white and black, darker links and darker lines. |
| dark-contrast | The dark look with black and white, lighter links and lighter lines. |

## Color

Backgrounds of one theme are all light or all dark. So one focus color has a contrast of 3:1 on each of them.

| Token | light | dark | light-contrast | dark-contrast | Use |
|---|---|---|---|---|---|
| `--color-page` | `#fbf7f0` | `#191512` | `#ffffff` | `#000000` | The page background. |
| `--color-surface` | `#f1e8d9` | `#252019` | `#f5efe4` | `#15110d` | Cards, the footer, panels and the skip link. |
| `--color-glow` | `#f7dfb9` | `#3b2b17` | `#fbe9c8` | `#24190b` | The first color of the hero gradient; the hover background of a button. |
| `--color-accent` | `#e9bd6b` | `#5a3f17` | `#f0c877` | `#3d2a0d` | The background of a button: larch gold. |
| `--color-text` | `#2b2521` | `#f1e9dd` | `#000000` | `#ffffff` | Body text; the label and the border of a button. |
| `--color-title` | `#24382e` | `#f6ecd9` | `#0e1f16` | `#ffffff` | Headings, the brand name and a link under the pointer. |
| `--color-muted` | `#55493f` | `#cdc1b2` | `#2e2620` | `#e8dfd2` | Secondary text: captions and the copyright line. |
| `--color-link` | `#7d340d` | `#f2b880` | `#5c2303` | `#ffd3a6` | Links. |
| `--color-brand` | `#a04a12` | `#d9955a` | `#6e3008` | `#f2b37c` | Decoration in larch rust: the brand mark, the line of a quote, the checked radio. |
| `--color-line` | `#8c7f70` | `#8d806f` | `#5a4f43` | `#b8ab9b` | Borders and rules. |
| `--color-focus` | `#0b5567` | `#8fd6e3` | `#003644` | `#baf1fb` | The focus ring: the teal of the lake. |
| `--color-error` | `#a1201b` | `#ffa095` | `#7d0d09` | `#ffc4bc` | Error text of a form. |
| `--color-shadow` | `#2b25211f` | `#00000073` | `#00000033` | `#000000a6` | The color of every shadow. It is never a text color or a background. |

## Typography

System fonts only. The three largest sizes grow with the viewport between a small and a large limit.

| Token | Value | Use |
|---|---|---|
| `--font-body` | `system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif` | Text, navigation and controls. |
| `--font-display` | `"Iowan Old Style", "Palatino Linotype", Palatino, "Book Antiqua", Georgia, "Times New Roman", serif` | Headings, the brand name and quotes. |
| `--text-s` | `0.875rem` | Small text: captions, the footer, the language links, the mode switch. |
| `--text-m` | `1.0625rem` | Body text. |
| `--text-l` | `1.25rem` | The lede, quotes, the brand name. |
| `--text-xl` | `clamp(1.25rem, 1.15rem + 0.5vw, 1.5rem)` | `h3`. |
| `--text-2xl` | `clamp(1.5rem, 1.25rem + 1.25vw, 2.125rem)` | `h2`. |
| `--text-3xl` | `clamp(2rem, 1.4rem + 3vw, 3.5rem)` | `h1`. |
| `--leading-tight` | `1.15` | `h1`. |
| `--leading-snug` | `1.3` | `h2`, `h3`, the lede and quotes. |
| `--leading-body` | `1.6` | Body text. |
| `--weight-regular` | `400` | Text and the large headings. |
| `--weight-strong` | `600` | `h3`, `h4`, labels of buttons, terms of a list. |
| `--weight-bold` | `700` | `strong`. |
| `--tracking-tight` | `-0.01em` | `h1`. |
| `--tracking-wide` | `0.08em` | Short labels in capitals: the eyebrow and the language links. |

## Spacing

A scale in steps of a quarter rem. `--space-gutter` and `--space-section` are fluid: their percentage is taken from
the width of the containing block, so they are for `padding` only.

| Token | Value | Use |
|---|---|---|
| `--space-1` | `0.25rem` | The gap between the language links. |
| `--space-2` | `0.5rem` | Small gaps inside a control. |
| `--space-3` | `0.75rem` | The gap of a cluster. |
| `--space-4` | `1rem` | The gap between paragraphs. |
| `--space-5` | `1.5rem` | The padding of a card; the gap of a grid; the space before an `h2` or `h3` inside running text. |
| `--space-6` | `2rem` | The padding and the column gap of a wide card; the gap between the blocks of the footer. |
| `--space-7` | `3rem` | The padding of a section, above and below. |
| `--space-gutter` | `clamp(1rem, 5%, 2.5rem)` | The side padding of the page (`--center-gutter`). Padding only. |
| `--space-section` | `clamp(3rem, 9%, 7rem)` | The padding of the hero, above and below. Padding only. |

## Size

| Token | Value | Use |
|---|---|---|
| `--size-page` | `72rem` | The largest width of the page content. |
| `--size-measure` | `38rem` | The largest width of a line of running text. |
| `--size-heading` | `46rem` | The largest width of a heading, and of a photo in running text. |
| `--size-card` | `17rem` | The smallest width of a grid column. |
| `--size-target` | `2.75rem` | The smallest width and height of a link or control that stands alone (44 px), such as a link of the navigation. |
| `--size-icon` | `1.25rem` | A radio button. |
| `--size-mark` | `2rem` | The brand mark in the header. |
| `--size-mode-switch` | `10.5rem` | The width of the mode switch, closed and open. |
| `--size-screen` | `100dvh` | The smallest height of the page, so that the footer of a short page sits at the bottom. |

## Radius

| Token | Value | Use |
|---|---|---|
| `--radius-s` | `0.25rem` | Links that look like a control, the skip link. |
| `--radius-m` | `0.5rem` | Disclosures and panels. |
| `--radius-l` | `1rem` | Cards and photos. |
| `--radius-pill` | `62.5rem` | Buttons. |

## Line

| Token | Value | Use |
|---|---|---|
| `--line-thin` | `0.0625rem` | Borders, rules, the underline of a link. |
| `--line-thick` | `0.125rem` | The border of a button, the line of a quote, the underline of a link under the pointer. |
| `--line-focus` | `0.1875rem` | The width of the focus ring (3 px). |
| `--line-offset` | `0.1875rem` | The distance of the focus ring and of an underline. |

## Shadow

| Token | Value | Use |
|---|---|---|
| `--shadow-card` | `0 0.0625rem 0.1875rem var(--color-shadow), 0 0.5rem 1.5rem var(--color-shadow)` | Cards. |
| `--shadow-overlay` | `0 0.75rem 2rem var(--color-shadow)` | What lies over the page: the open mode switch on a wide viewport, the skip link. |

## Layer

| Token | Value | Use |
|---|---|---|
| `--z-overlay` | `10` | What lies over the page: the open mode switch on a wide viewport, the skip link. |

## Motion

The site has one animation: the hero text rises once when the page opens. Nothing loops.

| Token | Value | Use |
|---|---|---|
| `--duration-fast` | `150ms` | Changes under the pointer. |
| `--duration-slow` | `700ms` | The entrance of the hero text. |
| `--ease-standard` | `ease` | Changes under the pointer. |
| `--ease-out` | `cubic-bezier(0.16, 1, 0.3, 1)` | The entrance of the hero text. |

## Gradient

| Token | Value | Use |
|---|---|---|
| `--gradient-hero` | `linear-gradient(170deg, var(--color-glow) 0%, var(--color-surface) 55%, var(--color-page) 100%)` | The background of the hero: morning light that fades into the page. |

## Breakpoints

| Name | Width | Use |
|---|---|---|
| card | 40rem | A container query: a card this wide puts its heading beside its text. Only a card that takes a whole row is this wide. |
| medium | 48rem | Tablets and wider: the open mode switch lies over the page and no longer pushes it down. |
| section | 59rem | A container query: a text section this wide has three columns in its grid. The first card of the home page then takes a whole row. The width is three times `--size-card`, two times `--grid-gap` and two times the largest `--space-gutter`. |

## Layout helpers

| Parameter | Token | Use |
|---|---|---|
| `--stack-gap` | `var(--space-4)` | The distance between blocks of running text. |
| `--cluster-gap` | `var(--space-3)` | The distance between items in a row. |
| `--grid-gap` | `var(--space-5)` | The distance between cards. |
| `--grid-min` | `var(--size-card)` | The smallest width of a grid column. |
| `--center-max` | `var(--size-page)` | The width of the page content. |
| `--center-gutter` | `var(--space-gutter)` | The side padding of the page. |

## Elements

| Selector | Property | Token |
|---|---|---|
| `body` | `color` | `--color-text` |
| `body` | `background-color` | `--color-page` |
| `body` | `font-family` | `--font-body` |
| `body` | `font-size` | `--text-m` |
| `body` | `line-height` | `--leading-body` |
| `h1` | `font-family` | `--font-display` |
| `h1` | `font-size` | `--text-3xl` |
| `h1` | `color` | `--color-title` |
| `h2` | `font-size` | `--text-2xl` |
| `h3` | `font-size` | `--text-xl` |
| `p` | `max-inline-size` | `--size-measure` |
| `a` | `color` | `--color-link` |
| `:focus-visible` | `outline-color` | `--color-focus` |
| `:focus-visible` | `outline-width` | `--line-focus` |
| `a.button` | `background-color` | `--color-accent` |
| `a.button` | `min-block-size` | `--size-target` |
| `a.button` | `border-radius` | `--radius-pill` |
| `p.lede` | `font-size` | `--text-l` |
| `blockquote` | `font-family` | `--font-display` |
| `small` | `font-size` | `--text-s` |
| `summary` | `min-block-size` | `--size-target` |
| `details` | `border-radius` | `--radius-m` |

## Components

| Selector | Property | Token |
|---|---|---|
| `.skip-link:focus` | `background-color` | `--color-surface` |
| `.site-header` | `border-block-end-color` | `--color-line` |
| `.site-header .site-header__mark` | `fill` | `--color-brand` |
| `.main-nav .main-nav__link` | `min-block-size` | `--size-target` |
| `.main-nav .main-nav__link` | `min-inline-size` | `--size-target` |
| `.mode-switch` | `inline-size` | `--size-mode-switch` |
| `.hero` | `background-image` | `--gradient-hero` |
| `.hero` | `padding-block` | `--space-section` |
| `.hero .hero__content` | `animation-duration` | `--duration-slow` |
| `.hero .hero__photo` | `border-radius` | `--radius-l` |
| `.photo` | `max-inline-size` | `--size-heading` |
| `.photo .photo__image` | `border-radius` | `--radius-l` |
| `.price-list .price-list__price` | `color` | `--color-title` |
| `.contact-card` | `background-color` | `--color-surface` |
| `.contact-card` | `border-radius` | `--radius-l` |
| `.page-index .page-index__link` | `min-block-size` | `--size-target` |
| `.text-section` | `padding-block` | `--space-7` |
| `.feature-card` | `background-color` | `--color-surface` |
| `.feature-card` | `border-radius` | `--radius-l` |
| `.feature-card` | `box-shadow` | `--shadow-card` |
| `.guest-quote` | `border-inline-start-color` | `--color-brand` |
| `.site-footer` | `background-color` | `--color-surface` |

## Contrast pairs

Each ratio is computed for all four themes. `text` needs 7:1, `ui` 4.5:1 and `non-text` 3:1.

| Foreground | Background | Role | For |
|---|---|---|---|
| `--color-text` | `--color-page` | text | body |
| `--color-link` | `--color-page` | ui | link |
| `--color-focus` | `--color-page` | non-text | focus |
| `--color-focus` | `--color-surface` | non-text | focus |
| `--color-focus` | `--color-glow` | non-text | focus |
| `--color-focus` | `--color-accent` | non-text | focus |
| `--color-error` | `--color-page` | ui | error |
| `--color-text` | `--color-surface` | text | Text on cards and in the footer |
| `--color-text` | `--color-glow` | text | Text on the hero gradient; the label of a button under the pointer |
| `--color-text` | `--color-accent` | text | The label of a button |
| `--color-title` | `--color-page` | text | Headings |
| `--color-title` | `--color-surface` | text | Headings on cards and in the footer |
| `--color-title` | `--color-glow` | text | The heading of the hero |
| `--color-muted` | `--color-page` | text | Captions |
| `--color-muted` | `--color-surface` | text | The copyright line in the footer |
| `--color-link` | `--color-surface` | ui | Links in the footer and in the skip link |
| `--color-link` | `--color-glow` | ui | Links on the hero gradient |
| `--color-brand` | `--color-page` | non-text | The brand mark and the line of a quote |
| `--color-brand` | `--color-surface` | non-text | The checked radio in the mode switch |
| `--color-line` | `--color-page` | non-text | Borders and rules |
| `--color-line` | `--color-surface` | non-text | Borders on cards and in the footer |

## Roles

- **Backgrounds:** `--color-page`, `--color-surface`, `--color-glow` and `--color-accent`. No other token is a
  background.
- **Text:** `--color-text`, `--color-title` and `--color-muted` for running text; `--color-link` for links;
  `--color-error` for errors.
- **Not text:** `--color-brand`, `--color-line` and `--color-focus` draw shapes and lines. They never color running
  text.
- **Buttons.** A link with the class `button` has the background `--color-accent`, and `--color-glow` under the
  pointer. Its label and its border use `--color-text`.

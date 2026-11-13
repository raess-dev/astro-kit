# The astro-kit standard

Generated from `src/registry.ts` by `npm run docs`. Do not edit it by hand.

## How to read a result

Every failing check prints the same three lines:

```text
✗ [<id>] <where>: <message> (<detail>)
    fix: <hint>
    rule: node_modules/@raess/astro-kit/docs/standards.md#<id>
```

- The id in brackets is the rule below. Then come the place, the meaning and the value found.
- `!` in place of `✗` is a warning. It fails nothing now, and its message says when it becomes an error.
- `~` is a finding that a waiver in `astro-kit.json` covers, with its end date and its reason.
- Fix the cause. Never silence a check. If a check looks wrong, add an entry to `KIT-FEEDBACK.md`.

## Stages

| Stage | Runs in | Groups |
|---|---|---|
| config | `npx --no astro-kit check`, and the start of `astro build` and `astro dev`. |  |
| config + build | On the source like a config rule, and again on `dist/`. The output is the authority. |  |
| build | The end of `astro build`, on the files in `dist/`. |  |
| browser | `npx --no astro-kit test`, in Chromium on the built site. |  |
| ci | `npx --no astro-kit ci` and the site workflow. |  |
| smoke | `npx --no astro-kit smoke <origin>`, against production. |  |
| zone | `npx --no astro-kit provision zone`. |  |

## Rules

0 rules in 0 groups.

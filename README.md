# @raess/astro-kit

One Astro integration and one CLI. They enforce a standard on multilingual marketing websites: performance, SEO,
accessibility, security, privacy, legal duties and code quality.

- AI coding agents write the sites. No person reviews their code: CI merges a green pull request.
- The kit ships no markup, no components, no layouts and no helper functions. It checks the built output.
- The owner acts only at the edges: accounts, facts, legal texts, settings, approvals.

## State

The kit is being built from `docs/spec.md`, milestone by milestone (section 14). This branch holds milestone M0: the
skeleton, the rule registry and the docs generator. No rule exists yet, and the package is not published.

## The specification

`docs/spec.md` says what to build and why. It is complete: a builder needs no other document. When this README and
the specification differ, the specification wins.

## Work on the kit

```sh
npm ci --ignore-scripts
npm run build
npm run check
npm test
node src/docs.ts --check
```

`CONTRIBUTING.md` holds the rules for a change. `SECURITY.md` says how to report a vulnerability.

## License

MIT

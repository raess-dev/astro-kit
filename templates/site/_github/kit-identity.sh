#!/usr/bin/env bash
# Managed by @raess/astro-kit. Runs before npm ci, so a pull request's own kit never vouches for itself:
# installs skip scripts, the kit comes from the npm registry with integrity, and it is never older than on the base.
set -euo pipefail
fail() { echo "::error::[config-kit-identity] $1 (rule: https://github.com/raess-dev/astro-kit/blob/main/docs/standards.md#config-kit-identity)"; exit 1; }
grep -qxF 'ignore-scripts=true' .npmrc || fail '.npmrc must contain ignore-scripts=true'
kit=$(jq -c '.packages["node_modules/@raess/astro-kit"] // empty' package-lock.json)
[ -n "$kit" ] || fail 'package-lock.json has no node_modules/@raess/astro-kit entry'
jq -e '(.resolved // "" | startswith("https://registry.npmjs.org/@raess/astro-kit/-/")) and (.integrity // "" | startswith("sha512-"))' >/dev/null <<<"$kit" ||
  fail 'the kit must resolve from https://registry.npmjs.org/@raess/astro-kit/-/ with an integrity hash'
version=$(jq -r '.version' <<<"$kit")
base="origin/${BASE_REF:-main}"
if git cat-file -e "$base:package-lock.json" 2>/dev/null; then
  old=$(git show "$base:package-lock.json" | jq -r '.packages["node_modules/@raess/astro-kit"].version // "0.0.0"')
  [ "$(printf '%s\n%s\n' "$old" "$version" | sort -V | head -n 1)" = "$old" ] || fail "the kit went down from $old on $base to $version"
fi
echo "@raess/astro-kit $version from the npm registry"

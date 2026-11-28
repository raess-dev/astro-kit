#!/usr/bin/env bash
# Managed by @raess/astro-kit. Runs before npm ci, so a pull request's own packages never vouch for themselves:
# installs skip scripts, every package comes from the npm registry under its own name, and the kit is never older than on the base.
set -euo pipefail
fail() { echo "::error::[config-kit-identity] $1 (rule: https://github.com/raess-dev/astro-kit/blob/main/docs/standards.md#config-kit-identity)"; exit 1; }
grep -qxF 'ignore-scripts=true' .npmrc || fail '.npmrc must contain ignore-scripts=true'
[ ! -e npm-shrinkwrap.json ] || fail 'remove npm-shrinkwrap.json; package-lock.json is the only lockfile'
bad=$(jq -r '[.packages | to_entries[]
  | select(.key != "" and (.value.inBundle // false | not))
  | (.key | sub("^.*node_modules/"; "")) as $name
  | ($name | sub("^@[^/]+/"; "")) as $base
  | (.value.version // "") as $version
  | select(($name | test("^(@[a-z0-9~][a-z0-9._~-]*/)?[a-z0-9~][a-z0-9._~-]*$") | not)
      or ($version | test("^[0-9]+\\.[0-9]+\\.[0-9]+[0-9A-Za-z.+-]*$") | not)
      or .value.resolved != "https://registry.npmjs.org/\($name)/-/\($base)-\($version).tgz"
      or ((.value.integrity // "") | test("^sha(512|256|1)-") | not)
      or (.value | has("name"))
      or (.value.link // false))
  | .key] | .[0:5] | join(", ")' package-lock.json)
[ -z "$bad" ] || fail "these lockfile entries are not npm registry packages with an integrity hash: $bad"
kit=$(jq -c '.packages["node_modules/@raess/astro-kit"] // empty' package-lock.json)
[ -n "$kit" ] || fail 'package-lock.json has no node_modules/@raess/astro-kit entry'
jq -e '(has("name") | not) and ((.integrity // "") | startswith("sha512-"))' >/dev/null <<<"$kit" ||
  fail 'the kit entry must be the kit itself, with a sha512 integrity hash'
version=$(jq -r '.version // ""' <<<"$kit")
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.]+)?$ ]] || fail "the kit version \"$version\" is not a plain version"
base="origin/${BASE_REF:-main}"
if git cat-file -e "$base:package-lock.json" 2>/dev/null; then
  old=$(git show "$base:package-lock.json" | jq -r '.packages["node_modules/@raess/astro-kit"].version // "0.0.0"')
  [ "$(printf '%s\n%s\n' "$old" "$version" | sort -V | head -n 1)" = "$old" ] || fail "the kit went down from $old on $base to $version"
fi
echo "@raess/astro-kit $version and every other package from the npm registry"

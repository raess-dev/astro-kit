#!/usr/bin/env bash
# Managed by @raess/astro-kit. Runs before npm ci, so a pull request's own packages never vouch for themselves:
# installs skip scripts, every package comes from the npm registry under its own name, and the kit is never older than on the base.
set -euo pipefail
fail() { echo "::error::[config-kit-identity] $1 (rule: https://github.com/raess-dev/astro-kit/blob/main/docs/standards.md#config-kit-identity)"; exit 1; }
jq -Rse '. == "ignore-scripts=true\nsave-exact=true\n"' .npmrc >/dev/null 2>&1 ||
  fail '.npmrc must be exactly the two lines ignore-scripts=true and save-exact=true'
settings=$(jq -nr '[$ENV | to_entries[] | select(.value != "" and (.key | test("\\Anpm_config_"; "i")))
  | .key[11:] | gsub("_"; "-") | ascii_downcase
  | select(IN("registry", "proxy", "https-proxy", "strict-ssl", "ignore-scripts", "replace-registry-host"))] | unique | join(", ")')
[ -z "$settings" ] || fail "unset the npm_config_ variables of the environment that set $settings"
[ ! -e npm-shrinkwrap.json ] || fail 'remove npm-shrinkwrap.json; package-lock.json is the only lockfile'
lockfile='length == 1 and (.[0].packages | type == "object" and all(.[]; type == "object"))'
jq -se "$lockfile" package-lock.json >/dev/null 2>&1 || fail 'package-lock.json is not JSON with an object .packages of entries'
bad=$(jq -r '[.packages | to_entries[]
  | select(.key != "")
  | select(.value.inBundle == true and (.key | test("\\Anode_modules/.+/node_modules/.")) and (.value | has("resolved") or has("integrity") | not) | not)
  | (.key | sub("\\A.*node_modules/"; "")) as $name
  | ($name | sub("\\A@[^/]+/"; "")) as $base
  | ((.value.version | strings) // "") as $version
  | select(($name | test("\\A(@[a-z0-9~][a-z0-9._~-]*/)?[a-z0-9~][a-z0-9._~-]*\\z") | not)
      or ($version | test("\\A[0-9]+\\.[0-9]+\\.[0-9]+[0-9A-Za-z.+-]*\\z") | not)
      or .value.resolved != "https://registry.npmjs.org/\($name)/-/\($base)-\($version).tgz"
      or ((.value.integrity | strings) // "" | test("\\Asha(512|256|1)-") | not)
      or (.value | has("name"))
      or (.value.link // false))
  | .key | gsub("\\p{Cc}"; "")] | .[0:5] | join(", ")' package-lock.json)
[ -z "$bad" ] || fail "these lockfile entries are not npm registry packages with an integrity hash: $bad"
kit=$(jq -c '.packages["node_modules/@raess/astro-kit"] // empty' package-lock.json)
[ -n "$kit" ] || fail 'package-lock.json has no node_modules/@raess/astro-kit entry'
jq -e '(has("name") | not) and ((.integrity | strings) // "" | startswith("sha512-"))' >/dev/null <<<"$kit" ||
  fail 'the kit entry must be the kit itself, with a sha512 integrity hash'
version=$(jq -r '(.version | strings) // ""' <<<"$kit")
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail 'the kit version must be a plain version X.Y.Z, without a prerelease or build part'
base="origin/${BASE_REF:-main}"
if ! git rev-parse --verify --quiet "$base^{commit}" >/dev/null 2>&1; then
  [ "${GITHUB_ACTIONS:-}" != true ] || fail 'the base branch is not in the clone; fetch it before this step'
  echo "kit-identity: there is no $base here, so the kit version is not compared with the base" >&2
elif git cat-file -e "$base:package-lock.json" 2>/dev/null; then
  git show "$base:package-lock.json" | jq -se "$lockfile" >/dev/null 2>&1 ||
    fail 'package-lock.json on the base is not JSON with an object .packages of entries'
  old=$(git show "$base:package-lock.json" | jq -r '(.packages["node_modules/@raess/astro-kit"].version | strings) // "0.0.0"')
  [[ "$old" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail 'the kit version on the base is not a plain version X.Y.Z'
  [ "$(printf '%s\n%s\n' "$old" "$version" | sort -V | head -n 1)" = "$old" ] || fail "the kit went down from $old on $base to $version"
fi
echo "@raess/astro-kit $version and every other package from the npm registry"

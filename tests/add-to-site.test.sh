#!/usr/bin/env bash
# Checks scripts/add-to-site.sh on throwaway sites (run by npm test; vitest runs inside workerd, with no shell).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPT="$ROOT/scripts/add-to-site.sh"
KIT="$ROOT/site-kit"
sha() { if command -v sha256sum >/dev/null; then sha256sum "$1"; else shasum -a 256 "$1"; fi | cut -d' ' -f1; }
fail() { echo "FAIL add-to-site: $1" >&2; exit 1; }
work="$(mktemp -d)"; trap 'rm -rf "$work"' EXIT
new_site() {
	site="$work/$1"; mkdir -p "$site/src/layouts" "$site/src/lib"
	echo 'import emdash from "emdash/astro";' > "$site/astro.config.mjs"
	echo '<slot />' > "$site/src/layouts/Base.astro"
}

# kit.sums lists the current hash of every file the script copies.
for pair in "lib/reviews-strings.ts src/lib/reviews-strings.ts" "styles/reviews.css src/styles/reviews.css" "components/Reviews.astro src/components/Reviews.astro" "pages/account/reviews.astro src/pages/account/reviews.astro" "blocks/plugin.ts src/reviews-block/plugin.ts"; do
	set -- $pair
	grep -qx "$(sha "$KIT/$1")  $2" "$KIT/kit.sums" || fail "kit.sums has no current hash for $2 (run scripts/kit-sums.sh)"
done

# Untouched files from an older release are replaced without a backup.
new_site old
mkdir -p "$site/src/styles" "$site/src/components"
git -C "$ROOT" show v0.2.0:site-kit/lib/reviews-strings.ts > "$site/src/lib/reviews-strings.ts"
git -C "$ROOT" show v0.2.0:site-kit/styles/reviews.css > "$site/src/styles/reviews.css"
git -C "$ROOT" show v0.2.0:site-kit/components/Reviews.astro > "$site/src/components/Reviews.astro"
out="$("$SCRIPT" "$site")"
[[ "$out" != *"saved before the kit replaced"* ]] || fail "backed up untouched 0.2.0 files"
find "$site" -name '*.bak-*' | grep -q . && fail "left a backup of an untouched file"
cmp -s "$site/src/styles/reviews.css" "$KIT/styles/reviews.css" || fail "did not replace the old reviews.css"

# Edited kit files (wording and styles) are backed up and listed; a second run the same day gets a time suffix.
new_site edited
mkdir -p "$site/src/styles"
echo 'export const reviews = { heading: "What readers say" };' > "$site/src/lib/reviews-strings.ts"
{ cat "$KIT/styles/reviews.css"; echo '.wbr-stars { color: hotpink; }'; } > "$site/src/styles/reviews.css"
out="$("$SCRIPT" "$site")"
[[ "$out" == *"src/lib/reviews-strings.ts.bak-"* && "$out" == *"src/styles/reviews.css.bak-"* ]] || fail "did not list the backups"
grep -q "What readers say" "$site"/src/lib/reviews-strings.ts.bak-* || fail "no backup of the edited wording file"
grep -q hotpink "$site"/src/styles/reviews.css.bak-* || fail "no backup of the edited reviews.css"
echo '.wbr-stars { color: teal; }' >> "$site/src/styles/reviews.css"
"$SCRIPT" "$site" >/dev/null
[[ "$(ls "$site"/src/styles/reviews.css.bak-* | wc -l | tr -d ' ')" == 2 ]] || fail "second backup the same day overwrote the first"
out="$("$SCRIPT" "$site")"
[[ "$out" != *"saved before the kit replaced"* ]] || fail "backed up a file the kit itself just wrote"

# A same-named file of the site's own is backed up; the site's layout is kept.
new_site own
mkdir -p "$site/src/components"; echo '<p>testimonials</p>' > "$site/src/components/Reviews.astro"
echo '<!-- mine -->' > "$site/src/layouts/ReviewsLayout.astro"
out="$("$SCRIPT" "$site")"
grep -q testimonials "$site"/src/components/Reviews.astro.bak-* || fail "replaced the site's own Reviews.astro without a backup"
grep -q mine "$site/src/layouts/ReviewsLayout.astro" || fail "replaced the site's ReviewsLayout.astro"

# The update command is printed on six lines of 52 characters or fewer.
block="$(grep -A5 '^       kit="$(mktemp -d)" &&$' <<<"$out")"
[[ "$(wc -l <<<"$block" | tr -d ' ')" == 6 ]] || fail "update command is not six lines"
grep -q -- '--branch v[0-9.]* \\$' <<<"$block" || fail "update command has no --branch line"
while IFS= read -r line; do trimmed="${line#"${line%%[![:space:]]*}"}"; (( ${#line} - 7 <= 52 )) || fail "update command line over 52 characters: $trimmed"; done <<<"$block"

# A folder that is not an EmDash site, or no folder at all, is refused with the usage line.
mkdir -p "$work/plain"
"$SCRIPT" "$work/plain" >/dev/null 2>&1 && fail "accepted a folder that is not an EmDash site"
err="$("$SCRIPT" "$work/does-not-exist" 2>&1 >/dev/null || true)"
[[ "$err" == *"Usage:"* ]] || fail "no usage line for a missing folder"
echo "add-to-site.sh: 8 checks passed"

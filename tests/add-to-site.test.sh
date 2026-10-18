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

[[ "$(tail -n 1 "$KIT/lib/reviews-strings.sums")" == "$(sha "$KIT/lib/reviews-strings.ts")" ]] || fail "the last line of reviews-strings.sums is not the hash of reviews-strings.ts"

# An untouched wording file from an older release is replaced without a backup.
new_site old
git -C "$ROOT" show v0.2.0:site-kit/lib/reviews-strings.ts > "$site/src/lib/reviews-strings.ts"
out="$("$SCRIPT" "$site")"
[[ "$out" != *"wording file"* ]] || fail "backed up an untouched 0.2.0 wording file"
ls "$site/src/lib" | grep -q '\.bak-' && fail "left a backup of an untouched wording file"
cmp -s "$site/src/lib/reviews-strings.ts" "$KIT/lib/reviews-strings.ts" || fail "did not replace the old wording file"

# A wording file the owner edited is backed up first.
new_site edited
echo 'export const reviews = { heading: "What readers say" };' > "$site/src/lib/reviews-strings.ts"
out="$("$SCRIPT" "$site")"
[[ "$out" == *"Your wording file differed"* ]] || fail "said nothing about an edited wording file"
grep -q "What readers say" "$site"/src/lib/reviews-strings.ts.bak-* || fail "no backup of the edited wording file"

# A same-named file of the site's own is backed up; the site's layout is kept.
new_site own
mkdir -p "$site/src/components"; echo '<p>testimonials</p>' > "$site/src/components/Reviews.astro"
echo '<!-- mine -->' > "$site/src/layouts/ReviewsLayout.astro"
out="$("$SCRIPT" "$site")"
grep -q testimonials "$site"/src/components/Reviews.astro.bak-* || fail "replaced the site's own Reviews.astro without a backup"
grep -q mine "$site/src/layouts/ReviewsLayout.astro" || fail "replaced the site's ReviewsLayout.astro"

# The update command is printed on three lines.
grep -q '^       kit="$(mktemp -d)" &&$' <<<"$out" || fail "update command line 1"
grep -qE '^         git clone --branch v[0-9.]+ --depth 1 https://github.com/wbcomdesigns/emdash-reviews "\$kit/emdash-reviews" &&$' <<<"$out" || fail "update command line 2"
grep -q '^         "$kit/emdash-reviews/scripts/add-to-site.sh" .$' <<<"$out" || fail "update command line 3"

# A folder that is not an EmDash site is refused.
mkdir -p "$work/plain"
"$SCRIPT" "$work/plain" >/dev/null 2>&1 && fail "accepted a folder that is not an EmDash site"
echo "add-to-site.sh: 5 checks passed"

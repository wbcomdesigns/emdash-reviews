#!/usr/bin/env bash
# Copies the WB Reviews site kit into an EmDash site. Safe to run again after every plugin update.
#   /path/to/emdash-reviews/scripts/add-to-site.sh /path/to/your/site
# It never replaces a newer shared file another Wbcom plugin copied, never replaces
# src/layouts/ReviewsLayout.astro once it exists, and backs up any kit file you edited (any file whose
# hash is not a released one, see site-kit/kit.sums) before replacing it.
set -euo pipefail

KIT="$(cd "$(dirname "$0")/../site-kit" && pwd)"
VERSION="$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$KIT/../package.json" | head -n 1)"
if [[ ! -d "${1:-.}" ]]; then
	echo "${1:-.} is not a folder." >&2
	echo "Usage: $0 /path/to/your/site" >&2
	exit 1
fi
SITE="$(cd "${1:-.}" && pwd)"

if ! ls "$SITE"/astro.config.* >/dev/null 2>&1 || ! grep -q "emdash" "$SITE"/astro.config.*; then
	echo "$SITE is not an EmDash site (no astro.config that loads emdash)." >&2
	echo "Usage: $0 /path/to/your/site" >&2
	exit 1
fi

notes=()
mkdir -p "$SITE/src/lib" "$SITE/src/styles" "$SITE/src/components" "$SITE/src/layouts" "$SITE/src/pages/account"

# The shared files carry a number on line 1 (wbcom-shared: N). Copy only when the site has none or an older one.
shared_version() { local v; v="$(sed -n '1s/.*wbcom-shared: *\([0-9]*\).*/\1/p' "$1" 2>/dev/null)"; echo "${v:-0}"; }
for part in lib/wbcom-kit.ts styles/wbcom-base.css; do
	target="$SITE/src/$part"
	if [[ ! -f "$target" ]]; then
		cp "$KIT/$part" "$target"
	elif (($(shared_version "$KIT/$part") > $(shared_version "$target"))); then
		notes+=("Updated src/$part from wbcom-shared $(shared_version "$target") to $(shared_version "$KIT/$part") (shared with other Wbcom plugins; newer copies only add).")
		cp "$KIT/$part" "$target"
	elif (($(shared_version "$KIT/$part") < $(shared_version "$target"))); then
		notes+=("Kept src/$part: the site has a newer copy (another Wbcom plugin put it there).")
	fi
done

# Every file below may be edited by the owner. site-kit/kit.sums lists the SHA-256 of each file as
# shipped in every release, by site path. A site file whose hash is not listed for its path was edited
# (or is the site's own file with the same name): it is backed up before it is replaced. Untouched files
# from any release are replaced without a word.
sha() { if command -v sha256sum >/dev/null; then sha256sum "$1"; else shasum -a 256 "$1"; fi | cut -d' ' -f1; }
backups=()
backup_name() {
	local name="$1.bak-$(date +%Y%m%d)"
	[[ -e "$name" ]] && name="$1.bak-$(date +%Y%m%d-%H%M%S)"
	echo "$name"
}
place() {
	local from="$1" rel="$2" target="$SITE/$2"
	mkdir -p "$(dirname "$target")"
	if [[ -f "$target" ]] && ! cmp -s "$from" "$target" && ! grep -qx "$(sha "$target")  $rel" "$KIT/kit.sums"; then
		local saved; saved="$(backup_name "$target")"
		cp "$target" "$saved"
		backups+=("${saved#"$SITE/"}")
	fi
	cp "$from" "$target"
}
place "$KIT/lib/reviews-strings.ts" src/lib/reviews-strings.ts
place "$KIT/styles/reviews.css" src/styles/reviews.css
for name in Reviews RatingBadge MyReviews; do place "$KIT/components/$name.astro" "src/components/$name.astro"; done
place "$KIT/pages/account/reviews.astro" src/pages/account/reviews.astro
# The optional in-text blocks are trusted site code. Copied, but off until astro.config.mjs loads them.
for file in "$KIT"/blocks/*; do place "$file" "src/reviews-block/$(basename "$file")"; done

layout="new"
if [[ -f "$SITE/src/layouts/ReviewsLayout.astro" ]]; then layout="yours, left as it is"; else cp "$KIT/layouts/ReviewsLayout.astro" "$SITE/src/layouts/"; fi
[[ -f "$SITE/src/layouts/Base.astro" ]] || notes+=("Your site has no src/layouts/Base.astro. Open src/layouts/ReviewsLayout.astro and point it at your layout.")

cat <<DONE
WB Reviews kit copied into $SITE

  Components  src/components/Reviews.astro, RatingBadge.astro, MyReviews.astro
  Page        src/pages/account/reviews.astro (My reviews)
  Layout      src/layouts/ReviewsLayout.astro ($layout)
  Styles      src/styles/reviews.css, src/styles/wbcom-base.css (shared)
  Scripts     src/lib/wbcom-kit.ts (shared)
  Wording     src/lib/reviews-strings.ts
  Block       src/reviews-block/ (optional, off until you add it to astro.config.mjs)
  Seed        none needed: WB Reviews uses the content types you already have

Paste these lines:

  1. In src/pages/posts/[slug].astro (the post page), add to the imports at the top:
       import Reviews from "../../components/Reviews.astro";
     and where the reviews should show, for example just above <section class="post-comments">:
       <Reviews collection="posts" id={post.data.id} />

  2. In src/components/PostCard.astro (the post card), add to the imports at the top:
       import RatingBadge from "./RatingBadge.astro";
     and inside the card, right after these two lines (the end of <span class="post__meta">):
       				<span>{readingTime}</span>
       			</span>
     add:
       <RatingBadge collection="posts" id={post.data.id} />

  Use post.data.id (the entry id), not post.id (the slug). For pages, use collection="pages".

Then:

  3. Restart the dev server (stop it, then npm run dev).
  4. In the admin, open Menus and add a custom link: My reviews, /account/reviews/
  5. In the admin, open Reviews, Settings and tick the content types visitors can review.
  6. Open a post and /account/reviews/ to check.

After every plugin update, run this from your site's root folder, with the new version's tag in place of v$VERSION
(a fresh mktemp folder, and the script runs only if the clone worked):
       kit="\$(mktemp -d)" &&
         git clone --depth 1 \\
           --branch v$VERSION \\
           https://github.com/wbcomdesigns/emdash-reviews \\
           "\$kit/emdash-reviews" &&
         "\$kit/emdash-reviews/scripts/add-to-site.sh" .

Optional, the Reviews and Rating blocks inside post text (trusted site code). In astro.config.mjs:
       import { reviewsBlock } from "./src/reviews-block/descriptor.mjs";
     and inside emdash({ ... }):
       plugins: [reviewsBlock()],
DONE
for note in "${notes[@]+"${notes[@]}"}"; do echo; echo "Note: $note"; done
if ((${#backups[@]})); then
	echo
	echo "You had changed these files, so your copies were saved before the kit replaced them:"
	for saved in "${backups[@]}"; do echo "  $saved"; done
	echo "Copy your changes back from them (src/lib/reviews-strings.ts holds all visitor wording)."
fi

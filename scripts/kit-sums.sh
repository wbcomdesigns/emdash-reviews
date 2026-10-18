#!/usr/bin/env bash
# For the plugin's own developers, at every release: writes site-kit/kit.sums, the SHA-256 of every
# file add-to-site.sh copies, as shipped at each released tag plus the working tree, by site path.
# add-to-site.sh backs up a site file only when its hash is not listed for that path.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
sha() { if command -v sha256sum >/dev/null; then sha256sum; else shasum -a 256; fi | cut -d' ' -f1; }
# kit path -> site path, the same list add-to-site.sh uses.
map() {
	case "$1" in
		site-kit/lib/reviews-strings.ts) echo src/lib/reviews-strings.ts ;;
		site-kit/styles/reviews.css) echo src/styles/reviews.css ;;
		site-kit/components/*.astro) echo "src/components/${1##*/}" ;;
		site-kit/pages/account/reviews.astro) echo src/pages/account/reviews.astro ;;
		site-kit/blocks/*) echo "src/reviews-block/${1#site-kit/blocks/}" ;;
	esac
}
{
	for tag in $(git tag --list 'v*' --sort=v:refname); do
		git ls-tree -r --name-only "$tag" site-kit | while read -r file; do
			site="$(map "$file")"; [[ -n "$site" ]] || continue
			echo "$(git show "$tag:$file" | sha)  $site"
		done
	done
	git ls-files site-kit | while read -r file; do
		site="$(map "$file")"; [[ -n "$site" ]] || continue
		echo "$(sha < "$file")  $site"
	done
} | awk '!seen[$0]++' > site-kit/kit.sums
echo "Wrote site-kit/kit.sums ($(wc -l < site-kit/kit.sums | tr -d ' ') lines)"

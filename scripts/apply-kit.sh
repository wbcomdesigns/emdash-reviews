#!/usr/bin/env bash
# Copy the site kit into the lab the same way a site owner would: lib, styles, components, pages.
set -euo pipefail
source "$(dirname "$0")/lab-env.sh"
[[ -d "$LAB/src" ]] || { echo "Lab not found at $LAB. Run scripts/setup-lab.sh first." >&2; exit 1; }

# The two shared files are used by every Wbcom plugin on the site. Never replace a newer copy
# that another plugin put there with an older one: compare the number on their first line.
# A copy from before the numbers existed counts as 0.
shared_version() { local v; v="$(sed -n '1s/.*wbcom-shared: *\([0-9]*\).*/\1/p' "$1" 2>/dev/null)"; echo "${v:-0}"; }
for part in lib styles components pages; do
	[[ -d "$PLUGIN/site-kit/$part" ]] || continue
	mkdir -p "$LAB/src/$part"
	for file in "$PLUGIN/site-kit/$part"/*; do
		[[ -e "$file" ]] || continue
		name="$(basename "$file")"
		target="$LAB/src/$part/$name"
		if [[ "$name" == wbcom-base.css || "$name" == wbcom-kit.ts ]] && [[ -f "$target" ]]; then
			(( $(shared_version "$file") >= $(shared_version "$target") )) || continue
		fi
		# A folder (pages/account) merges into an existing one instead of nesting inside it.
		if [[ -d "$file" ]]; then mkdir -p "$target" && cp -R "$file/." "$target/"; else cp "$file" "$target"; fi
	done
done
# Lab-only pages that mount the components for a browser walk.
if [[ -d "$PLUGIN/site-kit/lab" ]]; then
	mkdir -p "$LAB/src/pages"
	cp -R "$PLUGIN/site-kit/lab/." "$LAB/src/pages/"
fi
# The in-text blocks are site code. They are copied next to the kit, not into pages/.
if [[ -d "$PLUGIN/site-kit/blocks" ]]; then
	mkdir -p "$LAB/src/reviews-block"
	cp -R "$PLUGIN/site-kit/blocks/." "$LAB/src/reviews-block/"
fi
echo "Copied site-kit into $LAB"

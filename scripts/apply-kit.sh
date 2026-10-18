#!/usr/bin/env bash
# Lab only: copy the kit into this plugin's lab exactly as a site developer does (add-to-site.sh),
# then add the lab demo page that mounts every component for a browser walk.
set -euo pipefail
source "$(dirname "$0")/lab-env.sh"
[[ -d "$LAB/src" ]] || { echo "Lab not found at $LAB. Run scripts/setup-lab.sh first." >&2; exit 1; }

"$PLUGIN/scripts/add-to-site.sh" "$LAB" >/dev/null
if [[ -d "$PLUGIN/site-kit/lab" ]]; then
	cp -R "$PLUGIN/site-kit/lab/." "$LAB/src/pages/"
fi
echo "Copied site-kit into $LAB"

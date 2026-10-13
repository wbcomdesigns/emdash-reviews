#!/usr/bin/env bash
# Route-level smoke on the running lab. Add one check per route as you build it.
set -euo pipefail
source "$(dirname "$0")/lab-env.sh"
API="$BASE/_emdash/api/plugins/$SLUG"

fail() { echo "FAIL: $1" >&2; exit 1; }
ok() { echo "PASS: $1"; }
json() { curl -sf -H "X-EmDash-Request: 1" -H "Origin: $BASE" "$@"; }
status() { curl -s -o /dev/null -w "%{http_code}" -H "X-EmDash-Request: 1" -H "Origin: $BASE" "$@"; }

json "$API/health" | grep -q '"ok":true' || fail "health"
ok "health"

# Member routes must refuse guests. write is POST-only; mine answers GET.
[[ "$(status -X POST -H 'Content-Type: application/json' -d '{"collection":"posts","id":"x","stars":5,"body":"x"}' "$API/write")" == "401" ]] || fail "guest refused on write"
[[ "$(status "$API/mine")" == "401" ]] || fail "guest refused on mine"
ok "guests refused on write and mine"

json "$API/list?collection=posts&id=missing" | grep -q '"ok":true' || fail "list"
ok "list"
json "$API/summary?collection=posts&ids=a,b" | grep -q '"ratings"' || fail "summary"
ok "summary"

demo="$(curl -sf "$BASE/reviews-demo")" || fail "reviews-demo page"
echo "$demo" | grep -q 'data-wbr-form' || fail "demo mounts Reviews"
echo "$demo" | grep -q 'data-wbr-badge' || fail "demo mounts RatingBadge"
echo "$demo" | grep -q 'data-wbr-mine' || fail "demo mounts MyReviews"
ok "demo mounts Reviews, RatingBadge and MyReviews"

JAR="$(mktemp)"; trap 'rm -f "$JAR"' EXIT
curl -sf -c "$JAR" -o /dev/null "$BASE/_emdash/api/setup/dev-bypass?redirect=/"
[[ "$(status -b "$JAR" -X POST -H 'Content-Type: application/json' -d '{"type":"page_load","page":"/queue"}' "$API/admin")" == "200" ]] || fail "admin page loads"
ok "admin page loads"

settings="$(json -b "$JAR" -X POST -H 'Content-Type: application/json' -d '{"type":"page_load","page":"/settings"}' "$API/admin")"
echo "$settings" | grep -q 'blocks' || fail "settings page loads"
echo "$settings" | grep -q 'Posts' || fail "settings lists Posts by name"
ok "settings page lists content types"

echo "All checks passed for $SLUG"

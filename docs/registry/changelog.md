## 0.3.0

- Improve: every page, admin action and visitor request fits Cloudflare's 10 requests per plugin call. Counts move with each review instead of re-reading every review of the page.
- Improve: Waiting and Published page by date; Find searches a few hundred reviews per press. Delete all my reviews and delete by email work in steps.
- Fix: reviews sent at the same moment are each counted once. Ratings 0.2.0 lost are rebuilt.
- After updating, open Reviews in the admin: it brings 0.2 data over in a few steps while you keep moderating. No new permission.

Copy the kit again after you update, from your site's root folder:

```bash
kit="$(mktemp -d)" &&
  git clone --depth 1 \
    --branch v0.3.0 \
    https://github.com/wbcomdesigns/emdash-reviews \
    "$kit/emdash-reviews" &&
  "$kit/emdash-reviews/scripts/add-to-site.sh" .
```

## 0.2.2

- Fix: re-running scripts/add-to-site.sh on a site whose post page and post card already show WB Reviews says the lines are already in place.

## 0.2.1

- Security: guests review only where the host passes the visitor address (Cloudflare or trustedProxyHeaders); otherwise they sign in. IPv6 counts by /64.
- New: Waiting shows Set up visitor pages. scripts/add-to-site.sh copies the kit and prints the lines to paste.
- Fix: waiting reviews no longer hide published ones or break the rating; unpublished pages show nothing.

Older versions: https://github.com/wbcomdesigns/emdash-reviews/blob/main/CHANGELOG.md

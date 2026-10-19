## 0.2.2

- Fix: re-running scripts/add-to-site.sh on a site whose post page and post card already show WB Reviews says the lines are already in place instead of printing them again.

Copy the kit again after you update, from your site's root folder:

```bash
kit="$(mktemp -d)" &&
  git clone --depth 1 \
    --branch v0.2.2 \
    https://github.com/wbcomdesigns/emdash-reviews \
    "$kit/emdash-reviews" &&
  "$kit/emdash-reviews/scripts/add-to-site.sh" .
```

## 0.2.1

- Security: guests review only where the host passes the visitor address (Cloudflare or trustedProxyHeaders); otherwise they sign in. IPv6 counts by /64. Health hides the waiting count.
- New: Waiting shows Set up visitor pages. scripts/add-to-site.sh copies the kit and prints the lines to paste.
- Improve: Settings says when the site has no email provider. My reviews uses the site's gutter; guests see a plain sign-in prompt.
- Fix: waiting reviews no longer hide published ones or break the rating; unpublished pages show nothing; Published this week counts reviews approved from 0.2.1 on.

## 0.2.0

- New: My reviews page where a member sees and deletes their reviews. Optional Reviews and Rating blocks for post text (trusted install).
- Security: server-side calls run inside EmDash with no web request. Copy the kit again after updating.

Older versions: https://github.com/wbcomdesigns/emdash-reviews/blob/main/CHANGELOG.md

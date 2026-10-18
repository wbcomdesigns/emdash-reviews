## 0.2.1

- Security: guests review only where the host passes the visitor address (Cloudflare or trustedProxyHeaders); otherwise they sign in. IPv6 counts by /64. Health hides the waiting count.
- New: Waiting shows Set up visitor pages. scripts/add-to-site.sh copies the kit and prints the lines to paste.
- Improve: Settings says when the site has no email provider. My reviews uses the site's gutter; guests see a plain sign-in prompt.
- Fix: waiting reviews no longer hide published ones or break the rating; unpublished pages show nothing.

Copy the kit again after you update, from your site's root folder:

```bash
kit="$(mktemp -d)" &&
  git clone --branch v0.2.1 --depth 1 https://github.com/wbcomdesigns/emdash-reviews "$kit/emdash-reviews" &&
  "$kit/emdash-reviews/scripts/add-to-site.sh" .
```

## 0.2.0

- New: My reviews page where a member sees and deletes their reviews. Optional Reviews and Rating blocks for post text (trusted install).
- Security: server-side calls run inside EmDash with no web request. Copy the kit again after updating.

## 0.1.4

- Fix: members can review, and members-only pages show guests a sign-in link.
- Fix: Delete removes a review for good; Approve, Reject and Delete work on an opened review.
- Fix: outline stars until picked, even card spacing, readable text with the site's light mode on a dark device.
- Fix: typed tags stored as plain text; the waiting email is off until it has an address.
- Improve: Settings uses tabs, one Save each. Guest email only when Anyone can review.
- Improve: Waiting and Published open with stats. Long text is clipped; Read shows the full review.
- Improve: Delete-by-email is in an accordion. The dashboard card is a count and a link.

Older versions: https://github.com/wbcomdesigns/emdash-reviews/blob/main/CHANGELOG.md

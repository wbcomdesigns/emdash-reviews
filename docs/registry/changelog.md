## 0.3.2

No new permission. New storage indexes are built when the plugin first loads; a write can be asked to try again for that moment.

- Improve  - Decide is the first column on Waiting and Published, so it shows at phone width; long names and titles are shortened there.
- Improve  - The structured-data rating joins the page's own article data.
- Improve  - Settings says it cannot tell whether guests can review from your own visit, and how to check, instead of claiming they cannot.
- Fix      - A long word or link in a review wraps in its card; the page no longer scrolls sideways.
- Fix      - Line breaks in reviews and replies show on the page and in My reviews.
- Fix      - Rejecting a waiting review says "Review rejected. It will not be shown."
- Fix      - Deleting a page for good deletes its reviews and rating, in steps for a busy page.

Copy the kit again after you update, from your site's root folder:

```bash
kit="$(mktemp -d)" &&
  git clone --depth 1 \
    --branch v0.3.2 \
    https://github.com/wbcomdesigns/emdash-reviews \
    "$kit/emdash-reviews" &&
  "$kit/emdash-reviews/scripts/add-to-site.sh" .
```

## 0.3.1

- Fix      - A setup error during install or activate is logged instead of switching the plugin off on EmDash 1.5.
- Fix      - A page restored from the trash shows no rating badge until it is published again.
- Compat   - Needs EmDash 1.2.0 or later; the registry checks this before an install.

## 0.3.0

- Improve  - Every page, admin action and visitor request fits Cloudflare's 10 requests per plugin call.
- Fix      - Reviews sent at the same moment are each counted once. Ratings 0.2.0 lost are rebuilt.

Older versions: https://github.com/wbcomdesigns/emdash-reviews/blob/main/CHANGELOG.md

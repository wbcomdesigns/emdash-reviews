# Changelog

Versions match `package.json`, the git tag and the registry release. Newest first.

## [0.2.1]

Guests now need a visitor address from the host. Copy the kit again after you update.

- Security - Guests can review only where the host passes EmDash the visitor's address (Cloudflare, or trustedProxyHeaders); elsewhere guests are asked to sign in.
- Security - IPv6 guests count by their /64 network, so rotating addresses no longer gets around the hourly limit.
- Security - The public health route no longer shows how many reviews are waiting.
- New      - The Waiting screen shows Set up visitor pages, with the kit command for the installed version, until you mark them done.
- New      - One command, scripts/add-to-site.sh, copies the kit and prints the lines to paste with their file names.
- Improve  - Settings says plainly when the site has no email provider, and saving the Email tab sends one test notice.
- Improve  - My reviews uses the site's own page column and gutter through src/layouts/ReviewsLayout.astro.
- Improve  - A guest on My reviews sees a plain sign-in prompt instead of a red error.
- Improve  - The reviews section keeps the same space and rule above it as the blog template's Discussion section.
- Fix      - Published reviews and the rating stay right however many reviews are waiting, and pages with over 500 reviews count them all.
- Fix      - The review list and the rating badge show nothing for an unpublished page or a closed content type.
- Fix      - Install snippets name the file to edit and use the import path that works from it.
- Compat   - Checked on EmDash 1.3.0. Shared kit styles 4: buttons use the theme's own colours in dark mode.

## [0.2.0]

Copy the kit again after you update.

- New      - My reviews at `/account/reviews/`. A member sees their own reviews with their status and can delete them all with a second click. The rating on each page updates at once.
- New      - Optional Reviews and Rating blocks for post text. They are trusted site code you switch on in `astro.config.mjs`. The registry plugin is unchanged.
- Fix      - Delete all my reviews removes every review the member wrote, not only the first 100.
- Security - Shared kit 5: server-side plugin calls run inside EmDash with no web request.
- Dev      - Troubleshooting explains the guest 401 in the browser console. It is expected.

## [0.1.4]

- Fix: signed-in members can review. On "Signed-in members only" guests see a sign-in link, and members write as their account.
- Fix: Delete on a published review removes it for good and updates the rating. Delete in a row's menu opens the review so it can ask first.
- Fix: Approve, Reject and Delete on the opened review work (they sent no review before).
- Fix: tags typed in a review are stored as plain text.
- Fix: the waiting-review email is off until you add an address; switching it on without one says so.
- Fix: rating stars show as outlines until you pick one.
- Fix: even spacing in review cards and the owner reply, whatever the theme sets for quotes and headings.
- Fix: plugin text stays readable when a visitor picks the site's light mode on a device set to dark.
- Improve: Settings uses tabs (Where, Approval, Who can review, Email), one Save each.
- Improve: Guest email only shows when Anyone can review.
- Improve: Waiting and Published open with stats. Long text is clipped; Read shows the full review.
- Improve: Delete-by-email sits in an accordion on Published.
- Improve: The dashboard card is the waiting count and a link.

## [0.1.3]

- Fix: stars-only ratings no longer keep the "Be the first to review this" box.
- Fix: a write without a rating is refused. Guests post to write_guest and do not 401 first.
- Fix: members-only replaces the form with a sign-in link.
- Fix: review cards keep the kit's spacing inside a blog theme.
- Fix: Waiting wraps a long word so the Decide column stays on screen.
- Docs: My reviews stays in 0.2.0. Privacy erase is find-by-email in admin.

## [0.1.2]

- Fix: the site kit finds the plugin on a registry install (id `r_nt2pnhev44oaara3`) and still works from a local file install.
- Fix: shared `wbcom-base.css` v2 hides `[hidden]` parts, so Show more and guest fields stay off until they are needed.
- Fix: Reviews and the rating badge draw nothing on a content type that is not ticked in Settings.
- Fix: review dates read in the visitor's language and the site's time zone.
- Fix: the rating badge screen-reader line uses "review" or "reviews".
- Fix: the sort control shows from two written reviews up.
- Fix: registry banner is the 3000x1000 brand file. Description names articles and pages, not listings.

## [0.1.1]

- Fix: registry cover is 1200x400 (the listing slot is 3:1). The old 1200x305 lockup was cropped to "WBReview".
- New: `images/banner-dark.png` for the listing dark theme. The registry still accepts one banner, so the light file is the published cover.
- Fix: unselected stars use the muted token so empty glyphs stay above 3:1.
- Fix: owner reply and the honeypot use logical CSS, so RTL does not flip them the wrong way.
- Fix: Show more is a quiet button so it is not a second primary next to Submit.

## [0.1.0]

- New: star ratings and moderated reviews on any content type the owner ticks.
- New: guests can review when the owner allows it. One review per visitor, always approved first.
- New: star-only ratings count in the average and stay out of the written list.
- New: a change to a live review waits for approval. The published text stays until then.
- New: owner reply, star bars, sort and show more on the public list.
- New: Waiting, Published and Settings admin pages, plus a dashboard card.
- New: optional hourly email when reviews are waiting. No review text and no link.
- New: rating added to the page as structured data.

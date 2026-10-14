# Changelog

Versions match `package.json`, the git tag and the registry release. Newest first.

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

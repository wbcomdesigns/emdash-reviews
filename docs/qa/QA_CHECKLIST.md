# QA checklist: Reviews and Ratings

One living list of flow-level cases. Walk all of it before every release. When you add or fix behaviour, add or change its case in the same pull request. There are no per-release QA files.

**Last walk:** 2026-10-19, 0.2.1 on the plugin lab :4331 (EmDash 1.3.0, blog template, file install), plus fresh registry sites on 1.3.0 and 1.3.1, dev server and a production build (`node dist/server/entry.mjs`, no mail provider).

Walked in the browser: post page as a guest with no visitor address (3 published reviews listed behind 600 waiting, sign-in line instead of the form) at 1440 and 390, light and dark; guest with `trustedProxyHeaders` and `X-Forwarded-For` writes a review (pending thanks); subscriber with no address writes as their account; My reviews as guest (plain sign-in box, 28px gutter at 390) and as subscriber; home page badges; admin Waiting with Set up visitor pages, then Visitor pages are set up; Settings guest banner (production build, no address) and absent with an address; Email tab no-provider banner (production build). Dark Submit review measured 19:1, light 17.9:1.

Route level: `write_guest` with no address answers `GUEST_UNAVAILABLE` and stores nothing; health has `guestWrites` and no waiting count; Email save without a provider answers the no-provider toast. 57 unit tests (null IP, IPv4 limit, IPv6 /64, 600 waiting, 620 published, unpublished page, setup card, mail banner).

Not walked: registry install of 0.2.1 (not published), P-5 full keyboard, RTL, 768 width.

When you walk it, replace that line with the date, the version, and three lists: cases walked in the browser, cases checked at route level only, cases not walked. Do not claim a case you did not run.

## Setup

```bash
./scripts/reset-lab.sh             # clean data, lab running
./scripts/prove-lab.sh             # route-level smoke, must pass first
./scripts/lab-role.sh subscriber   # member cases as the lowest signed-in role
./scripts/lab-role.sh admin        # back to admin
```

Three roles, in this order: guest (private window), member (subscriber), admin. A case proven only as admin is not proven. Name test data `QA-RFT ...` and reset the lab afterwards.

## Guest

| ID | Steps | Expected |
| --- | --- | --- |
| G-1 | Open the demo page | Reviews section, summary line and form render |
| G-2 | Request `write` and `mine` directly | 401 |
| G-3 | Request `list` and `summary` | 200 with published reviews only |
| G-4 | Setting members: submit the form signed out | Sign-in link. Nothing stored |
| G-5 | Open the post list | Rated posts show a badge, unrated show nothing |
| G-6 | View source of a rated post | `aggregateRating` in the structured data. Absent on an unrated post |
| G-7 | Setting anyone: submit a review signed out with a name | Thanks message. It waits for approval even if member moderation is off |
| G-8 | Setting anyone: submit a second review on the same page from the same visitor | It replaces the first |
| G-9 | Setting anyone: fill the hidden honeypot field | Rejected |
| G-10 | Setting members: call `write_guest` directly | Refused |
| G-11 | Email setting on: submit as a guest | The form asks for an email. It is never in any public response or in the page |
| G-12 | Open Reviews on a content type that is not ticked | The whole block, including the form, is hidden |
| G-13 | Read a published review date | It is a day a person reads (14 Oct 2026), not 2026-10-14 |
| G-14 | One written review, then a second | Sort is hidden until the second review is live |
| G-90 | Change three phrases in the wording file (a button, an empty state, an error), rebuild | Each change shows everywhere that phrase is used. No English left on screen that is not in the file |

## Member (subscriber role)

| ID | Steps | Expected |
| --- | --- | --- |
| M-1 | Write a review | Thanks message. Not in the list yet when moderation is on |
| M-2 | Write again on the same post | It replaces the first. The live review and rating stay until the change is approved |
| M-3 | Put `<b>` and `<img onerror>` in a review, have it approved | Shown as plain text. No script runs |
| M-4 | Open My reviews | `/account/reviews/`. Guest sees Sign in. Member sees their rows with status |
| M-5 | Delete all my reviews (two clicks) | Second click empties the list and the public rating drops. Another member's reviews stay |
| M-6 | Send another member's id in a request | Ignored |
| M-7 | Review a draft, a missing entry, a closed collection | Refused: reviews are not open for that page |
| M-8 | Nine writes inside an hour | The ninth is refused |
| M-9 | Submit stars with no text | Accepted. After approval the average and count change and the list does not gain an empty entry |

## Admin

| ID | Steps | Expected |
| --- | --- | --- |
| A-1 | Open Waiting and Published with rows | Each page loads. Stats at the top. Table clips long text. Read shows the full review. Find, Next and Previous when there are enough rows |
| A-2 | Approve a review | It shows on the page. Rating and count change |
| A-3 | Remove a published review | It leaves the page. Rating changes |
| A-4 | Load the page, member rewrites, click Approve | Refused: changed after this page loaded |
| A-5 | Change the collections setting, then review a post in a removed collection | Refused |
| A-6 | Turn moderation off, write as a member | Live at once |
| A-7 | Open the queue with a guest review waiting | It is marked as from a guest. Approve and remove work the same |
| A-8 | Reply to a published review, then edit and remove the reply | The reply shows under the review, labelled as the owner's. Edits and removal show at once |
| A-9 | Find a guest's reviews by email and delete them | They are gone from the site and the ratings update. A wrong email finds nothing and says so |
| A-10 | Open Settings. Tick-boxes show the site's content types by name. Tick a second type and save, then reload. Untick all and save | Names, not slugs. The second type stays ticked after reload. A banner says reviews are closed |
| A-11 | Open Waiting with 60 rows. Go to page 3 and decide. Find a word in a review | Page 3 has the rest. Find shows only the match. The decision stays on that list |

## Presentation, every screen

| ID | Steps | Expected |
| --- | --- | --- |
| P-1 | Every screen at 1440, 768 and 390 | No sideways scroll |
| P-2 | Switch the system to dark mode | All text readable. No white panel on a dark page |
| P-3 | Measure text contrast | Body text 4.5:1, large text 3:1 |
| P-4 | Measure buttons, inputs, tabs | At least 40px tall |
| P-5 | Tab through every control | Everything reachable, focus ring visible, forms usable by keyboard |
| P-6 | Empty, loading and error states | Each list has an empty state with a next step. A failed request shows a message |
| P-7 | Look for raw ids | No screen shows an id where a name belongs |
| P-8 | View page source as two different visitors | Kit markup is identical. No member data in the HTML |

## 0.2.1 cases

| ID | Do | Expect |
| --- | --- | --- |
| H-1 | Guest on a host that passes no visitor address (Node without `trustedProxyHeaders`) | Sign in to write a review. instead of the form. Settings shows Guests are asked to sign in on this hosting |
| H-2 | Same with `trustedProxyHeaders` set and the header sent | Guest form shows and a review waits for approval |
| H-3 | 600 waiting reviews and 3 published on one page | The 3 show, the rating stays, Waiting says 600 |
| H-4 | Save the Email tab, then Send a test notice, on a site with no mail provider | Save says Saved. and sends nothing. The test says No notice was sent and the tab shows This site has no email provider until a test works |
| H-5 | Open Waiting on a new install | Set up visitor pages with the kit command for this version; after Visitor pages are set up, only the Install guide link |
| H-6 | `/account/reviews/` as a guest at 390 | Plain sign-in box, same side gutter as the header |
| H-7 | Run `scripts/add-to-site.sh` twice on a fresh blog site, wording file changed in between | Second run saves `reviews-strings.ts.bak-<date>-<time>` only for an edited file (an untouched older release file is replaced quietly), keeps `ReviewsLayout.astro`, prints file names and import paths |

## 0.3.0 cases (Cloudflare request limit)

Run these on the Cloudflare testbed (registry install) and on the Node lab. On Cloudflare a request over the limit fails with "Too many subrequests"; watch the Worker logs (`wrangler tail`) for it during every case.

| ID | Do | Expect |
| --- | --- | --- |
| CF-1 | Update a site that has 0.2.2 data (reviews, waiting, published, a page with more than 100 reviews), then open Reviews, Waiting | The list shows with Updating your reviews for this version and Continue on top; approving works meanwhile. Each press works; after a few the line goes. Visitors see reviews on each page throughout; card badges come back as pages are rebuilt |
| CF-2 | After CF-1, compare each page's rating and count on the site with its published reviews | They match, including a page whose rating 0.2.0 lost |
| CF-3 | Guest writes a review on a busy page (Cloudflare passes the address) | Thanks message; the review waits; Waiting count goes up by one |
| CF-4 | Member writes, then changes, a review with approval on and with approval off | Each answers with the thanks message; with approval off the rating and badge change at once |
| CF-5 | Submit the same review twice quickly (double click, two tabs) | One review stored and counted once; a second answer may say to try again in a moment |
| CF-6 | Post list with 50 rated cards | Every badge shows; no error in the Worker log |
| CF-7 | Unpublish a rated post, reload the post list; publish it again. Trash it and restore it | The badge goes, then comes back. After a restore (a draft) it stays hidden until published |
| CF-8 | Waiting and Published: Next, Previous, Find, Search older, Read, Approve, Reject, Reply, Delete, approve and reject a change | Each answers with its toast and the list; nothing fails |
| CF-9 | Delete a guest's reviews by email with waiting changes and more than 100 reviews | First press clears the waiting changes and says More remain; then Deleted 100 reviews. More remain; the last press says Deleted N reviews.; ratings settle after a few admin loads |
| CF-10 | My reviews for a member with many reviews, then Delete all my reviews | Every page named and linked; all deleted in one press of the button |
| CF-11 | Settings: save every tab, Send a test notice; open the dashboard card | Each saves with its toast; the card shows the waiting count |

## Known gaps

- This plugin has no `OWNER_INVENTORY.md`, `CORE_PATHS.md`, `SURFACES.md`, or personas yet. Walks use this checklist. Work and QA findings go to GitHub issues, not Basecamp.

Closed by 0.1.0: dark Submit contrast (now 7.88:1) and hidden badge `display:none`.
Closed by 0.1.1: empty stars use `--wb-muted`, reply/honeypot use logical CSS, Show more is quiet, registry covers are 1200x400 light and dark.
Closed by 0.1.2: registry kit address, hidden form on a closed type, locale dates, badge plural, sort from two reviews, banner 3000x1000.

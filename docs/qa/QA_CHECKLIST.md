# QA checklist: Reviews and Ratings

One living list of flow-level cases. Walk all of it before every release. When you add or fix behaviour, add or change its case in the same pull request. There are no per-release QA files.

**Last walk:** 2026-10-14, 0.1.2 on lab :4331. Guest first, then admin via dev-bypass. Viewport 1440x900 light. Walked in the browser: G-1 form and summary, G-7 guest submit (thanks, waits), G-12 pages block hidden, G-13 dates "14 Oct 2026", G-14 sort from two reviews, email field `display:none` when off, Show more hidden on one page. Admin Published, Waiting and Settings: no welcome dialog. Kit-fetch tests cover the registry id `r_nt2pnhev44oaara3` and the slug fallback. Route-level: `prove-lab.sh` and 33 unit tests. Not walked: P-5 full keyboard, RTL, a live registry install (local lab uses the slug; registry id 404s here as expected).

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
| M-4 | Open My reviews | Own reviews with page name, link and status |
| M-5 | Delete all my reviews (two clicks) | List empties. Each rating updates |
| M-6 | Send another member's id in a request | Ignored |
| M-7 | Review a draft, a missing entry, a closed collection | Refused: reviews are not open for that page |
| M-8 | Nine writes inside an hour | The ninth is refused |
| M-9 | Submit stars with no text | Accepted. After approval the average and count change and the list does not gain an empty entry |

## Admin

| ID | Steps | Expected |
| --- | --- | --- |
| A-1 | Open Waiting and Published with rows | Each page loads. Full text. Find, count, Next and Previous when there are enough rows |
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

## Known gaps

- This plugin has no `OWNER_INVENTORY.md`, `CORE_PATHS.md`, `SURFACES.md`, or personas yet. Walks use this checklist. Work and QA findings go to GitHub issues, not Basecamp.

Closed by 0.1.0: dark Submit contrast (now 7.88:1) and hidden badge `display:none`.
Closed by 0.1.1: empty stars use `--wb-muted`, reply/honeypot use logical CSS, Show more is quiet, registry covers are 1200x400 light and dark.
Closed by 0.1.2: registry kit address, hidden form on a closed type, locale dates, badge plural, sort from two reviews, banner 3000x1000.

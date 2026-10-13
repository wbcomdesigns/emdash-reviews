# QA checklist: Reviews and Ratings

One living list of flow-level cases. Walk all of it before every release. When you add or fix behaviour, add or change its case in the same pull request. There are no per-release QA files.

**Last walk:** not walked yet.

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

## Member (subscriber role)

| ID | Steps | Expected |
| --- | --- | --- |
| M-1 | Write a review | Thanks message. Not in the list yet when moderation is on |
| M-2 | Write again on the same post | It replaces the first. Back to awaiting approval. Rating drops it at once |
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
| A-1 | Open Reviews with rows waiting and published | Page loads. Both tables show full text |
| A-2 | Approve a review | It shows on the page. Rating and count change |
| A-3 | Remove a published review | It leaves the page. Rating changes |
| A-4 | Load the page, member rewrites, click Approve | Refused: changed after this page loaded |
| A-5 | Change the collections setting, then review a post in a removed collection | Refused |
| A-6 | Turn moderation off, write as a member | Live at once |
| A-7 | Open the queue with a guest review waiting | It is marked as from a guest. Approve and remove work the same |
| A-8 | Reply to a published review, then edit and remove the reply | The reply shows under the review, labelled as the owner's. Edits and removal show at once |
| A-9 | Find a guest's reviews by email and delete them | They are gone from the site and the ratings update. A wrong email finds nothing and says so |

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

None recorded yet. List anything a release ships without, here, in plain words.

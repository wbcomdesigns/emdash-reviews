# Plan: Reviews and Ratings

**Status: LOCKED on 2026-10-13.** See the note at the top of `SCOPE.md`.

The plan for this plugin, kept in the repository so it travels with the code. `SCOPE.md` says what the plugin is. This file says in what order it gets built and what waits.

## Decisions made with the owner

| Question | Decision |
| --- | --- |
| Who can take part | The site owner chooses: signed-in members only, or anyone. Default is anyone. |
| Owner reply | In 0.1.0. The owner can post one public reply under a review. |
| Stars without text | Allowed. Text is optional. A star-only rating counts in the average and does not appear in the review list. |
| What a guest gives | The owner chooses: name only (default), or name and email. An email is never shown publicly. |
| Wording and language | One wording file per plugin kit. Every visitor-facing phrase lives there, so an owner can translate or reword the plugin by editing one file. |
| How the owner picks what can be reviewed | Tick-boxes of the site's real content types, by their normal names. No typed list. |
| Long review lists | A bar per star level with counts, 10 reviews at a time with Show more, sort by Newest, Highest or Lowest. |
| Owner alert | Waiting count in admin, plus at most one email an hour when reviews are waiting. No review text and no link in the email. A switch turns it off. |
| Reporting a review | Not in the first release. Every review is approved before it shows. |
| Changing a review | The published review stays live until the change is approved. |
| Admin layout | Three pages: Waiting, Published, Settings. Each list has Next, Previous and find by text. |
| Who replies | The site admin, from the admin page. One reply per review. |
| Setup | One-page developer guide plus one command, same as Listora. |

## 0.1.0: first release

Work the cards in this order. Each is a GitHub issue under milestone `0.1.0` with its build list, UX bar, function bar and QA cases. Later cards assume earlier ones.

| Step | Issue | Task |
| --- | --- | --- |
| 1 | #1 | Lab: mount the components and walk them |
| 2 | #14 | Settings page with tick-boxes for content types |
| 3 | #18 | Admin: Waiting, Published and Settings pages with paging and find |
| 4 | #2 | Reviews component: every state, every width |
| 5 | #15 | Review list: breakdown bars, 10 at a time, sort |
| 6 | #3 | Rating badge on lists |
| 7 | #4 | My reviews and erase |
| 8 | #5 | Admin walked in the real admin |
| 9 | #6 | Structured data on a real page |
| 10 | #10 | Star-only ratings |
| 11 | #17 | Changing a review keeps the old one live until approved |
| 12 | #9 | Guest reviews |
| 13 | #12 | Guest email setting and privacy |
| 14 | #11 | Owner reply |
| 15 | #16 | Email the site admin when reviews are waiting |
| 16 | #13 | Wording file |
| 17 | #7 | Setup guide and one command, owner docs |
| 18 | #8 | Registry branding, full QA, release gate |

One agent works this repo, in order: the steps build on each other. It works on a branch named `0.1.0`, opens a pull request into `main`, and stops there. It never merges, tags or publishes.

Patterns already proven in Listora and to be copied, not reinvented: the hourly notice task (`notifyOwners` in `emdash-listora/src/plugin.ts`), guarded writes with `updateIf`, the compare-and-set rate limit, and the version token on every admin decision.

0.1.0 is done when every card is closed with a verification comment, `docs/qa/QA_CHECKLIST.md` has an honest last-walk line, and the gate in `CONTRIBUTING.md` passes. The owner publishes.

## 0.2.0: parked on purpose

Agreed as worth doing, not now. Do not start these during 0.1.0.

- Helpful votes on reviews
- Photo reviews
- Review reminders

## Not planned

See "Out of scope" in `SCOPE.md`. If a card seems to need one of those, stop and ask the owner.

## Before it goes on a live site

- Prove the kit on a preview deploy of one existing site, never on production first
- Check the site's EmDash version, its content security policy, and its page cache against what the kit does
- Findings from the first plugin are in `wbcomdesigns/emdash-listora` issue #23

## Who uses this today (owner, 2026-10-13)

Everyone installing an EmDash plugin today is a developer. So a step that needs a developer (copying the kit, a trusted install to get an in-text block) is acceptable now. The screens the site owner and visitors use after setup still have to be plain and complete: no internal ids, no half-built features. We keep polishing setup as EmDash grows.

After step 9, do #19 (in-text Reviews block, prove first).

**Owner decision 2026-10-13:** the member account piece (My votes / My reviews) moves to 0.2.0. EmDash is not member-focused for now. Erase-by-person stays in 0.1.0 as an admin action.

## Before any task

Read `EMDASH-SUPPORT.md` in `~/code/emdash-plugin-starter` (`wbcomdesigns/emdash-plugin-starter`). If a task depends on a row marked "not proven", prove it on the lab first. If the proof fails, stop and tell the owner on the issue. Do not build around it.

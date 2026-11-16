# Handoff: WB Reviews (2026-11-16)

Live: **0.3.1** on the EmDash registry as `@vapvarun.bsky.social/reviews`. Public page: https://plugins.emdashcms.com/plugins/@vapvarun.bsky.social/reviews

Test on a fresh `create-emdash` blog site (registry install, kit from the release tag) and on the Cloudflare test site. On Cloudflare, redeploy after a registry install or update before judging anything (emdash-cms/emdash#4865).

## In review: 0.3.2

Branch `0.3.2`, pull request "WB Reviews 0.3.2" (not merged, not tagged, not published). Milestone `0.3.2`: #69 composite indexes, #70 delete reviews and rating when a page is deleted for good, #74 registry install text and shared kit (wbcom-shared 5 CSS, 6 script), #76 long words overflowing the post page, #77 Decide off screen at phone width, #78 line breaks lost, #79 reject toast, #80 structured data joined to the article node; plus the Settings guest banner wording (it sees only the admin's own request, so it says it cannot tell).

Next: the coordinator's walk on Node and Cloudflare, then publish only with the owner's go-ahead.

## For the starter

`tests/block-check.ts` (vitest setup file) checks every admin answer in every test with `validateBlockResponse` from `@emdash-cms/blocks/server`, the validator EmDash runs on sandboxed admin responses. It belongs in `emdash-plugin-starter` with `bridge-count.ts`.

## Known limits (ponytail notes in the code)

- Upgrade step 4 writes whole rating rows; a decision on a page in the one call between its read and its write is missing from that page's count.
- A queued rating change is lost if the call that claimed it dies before writing it.
- A rating row made by an approval (no visitor write first) has no page address; My reviews looks it up live, up to the call budget.
- Paging by `createdAt` skips a row with exactly the bound's millisecond.
- A page deleted for good is cleared 200 reviews per call by a `purge-<page key>` cron task every 5 minutes; its legacy `entries` title row (reviews from before 0.3.0) is left behind.
- Settings sees only the admin's own request, so it cannot know whether visitors' requests carry an address.
- The 0.2.2 kit shows its generic error line for BUSY (review item L6, left by decision: the changelog says copy the kit again).

## How to work

- GitHub issues only. Never Basecamp for EmDash plugins.
- No AI attribution in commits. No em-dashes.
- Do not republish an old version. Do not `--allow-overwrite`.

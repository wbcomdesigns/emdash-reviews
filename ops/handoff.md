# Handoff: WB Reviews (2026-11-15)

Live: **0.3.1** on the EmDash registry as `@vapvarun.bsky.social/reviews`. Public page: https://plugins.emdashcms.com/plugins/@vapvarun.bsky.social/reviews

Test on a fresh `create-emdash` blog site (registry install, kit from the release tag) and on the Cloudflare test site. On Cloudflare, redeploy after a registry install or update before judging anything (emdash-cms/emdash#4865).

## Next: 0.3.2

Milestone `0.3.2` on GitHub holds the work, in this order:

- #69 Composite storage indexes for filtered and sorted queries
- #70 Delete a page's reviews and rating when the page is permanently deleted
- #74 Next release: registry install text and shared kit

Then the release gate (`gate.sh`, which also checks that no public file carries machine paths and that the README is the product landing page), an independent walk on Node and Cloudflare, and publish only with the owner's go-ahead.

## For the starter

`tests/block-check.ts` (vitest setup file) checks every admin answer in every test with `validateBlockResponse` from `@emdash-cms/blocks/server`, the validator EmDash runs on sandboxed admin responses. It belongs in `emdash-plugin-starter` with `bridge-count.ts`.

## Known limits (ponytail notes in the code)

- Upgrade step 4 writes whole rating rows; a decision on a page in the one call between its read and its write is missing from that page's count.
- A queued rating change is lost if the call that claimed it dies before writing it.
- A rating row made by an approval (no visitor write first) has no page address; My reviews looks it up live, up to the call budget.
- Paging by `createdAt` skips a row with exactly the bound's millisecond.
- The 0.2.2 kit shows its generic error line for BUSY (review item L6, left by decision: the changelog says copy the kit again).

## How to work

- GitHub issues only. Never Basecamp for EmDash plugins.
- No AI attribution in commits. No em-dashes.
- Do not republish an old version. Do not `--allow-overwrite`.

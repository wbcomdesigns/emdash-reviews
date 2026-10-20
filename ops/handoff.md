# Handoff: WB Reviews (2026-10-20, 0.3.0 in review)

You are the one agent for this repo. Read this, then work.

## Read first, in this order

1. Load the `emdash-plugin-development` skill.
2. EmDash's own guides in the lab: `.agents/skills/building-emdash-site` and `.agents/skills/creating-plugins`.
3. `~/code/emdash-plugin-starter/EMDASH-SUPPORT.md`.
4. `SCOPE.md` here. The Cloudflare section (0.3.0) and the corrections section win over older lines.
5. `PLAN.md` here.

## Where it stands (2026-10-20)

**Live on the registry:** 0.2.1. 0.2.2 merged to `main` (tag and publish pending the owner). Do not overwrite any published version.

**Branch 0.3.0 (PR open, not merged, not tagged, not published):** closes #66, milestone 0.3.0. Every route, hook, admin action and the hourly task fits Cloudflare's 10 requests per plugin call (9 or fewer, measured in `tests/bridge-budget.test.ts`, KNOWN_OVER gone).

How it works now (details in SCOPE.md, Cloudflare section):

- `src/counts.ts`: stored counts moved by in-database increments (`updateIf` with `delta`) in the same call as the write. `ratings` rows (`v: 3`, `s1`..`s5`, `t`, `live`, `url`, `seq`), `stats/site` (site counts, `kit_done`, upgrade state), `rating_queue` (bulk-erase rating changes applied later), the `Budget` helper.
- `src/plugin.ts`: visitor writes are one create or one compare-and-set; the rate record is one compare-and-set (lost = `BUSY`). `summary` is 2 calls. Content hooks keep `live`.
- `src/admin.ts`: lists page by `createdAt` (Next, Previous), decisions are one guarded write, renders reuse the site record an action's write returns. `drawn()` keeps a failed render from turning a stored decision into an error page.
- `src/erase.ts`: Delete all my reviews (300 per call, `BUSY`/`MORE` when more remain, the 0.3.0 kit repeats) and delete by email (100 per press).
- `src/upgrade.ts`: stepped 0.2.x upgrade (also run hourly); Waiting and Published work meanwhile with the progress line on top. Review fixes after the independent review (M1 to M4, L1 to L5, L7, L8) are each covered by a test under "independent review fixes" in `tests/review-0-3-0.test.ts`.
- Kit: `BUSY` phrase; My reviews repeats the erase. `kit.sums` regenerated.
- Tests: `tests/review-0-3-0.test.ts` races every counter; `tests/site.ts` has `install()` and `finishUpgrade()`.

## Next

- Sonnet walk of `docs/qa/QA_CHECKLIST.md` (CF-1 to CF-11 plus the rest) on the Cloudflare testbed and the Node lab, with `wrangler tail` open for "Too many subrequests". Only then change "Cloudflare: not supported yet" in `docs/registry/installation.md` and the install guide.
- Independent Opus review of `git diff v0.2.2..0.3.0` (no tag yet: diff against `main`).
- Owner QA, then merge, tag v0.3.0, publish.

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

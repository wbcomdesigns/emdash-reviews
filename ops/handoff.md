# Handoff: WB Reviews (2026-10-19, 0.2.2 in review)

You are the one agent for this repo. Read this, then work.

## Read first, in this order

1. Load the `emdash-plugin-development` skill.
2. EmDash's own guides in the lab: `.agents/skills/building-emdash-site` and `.agents/skills/creating-plugins`.
3. `~/code/emdash-plugin-starter/EMDASH-SUPPORT.md`.
4. `SCOPE.md` here. The corrections section wins over older lines.
5. `PLAN.md` here.

## Where it stands (2026-10-19)

**Live on the registry:** 0.2.1 (published 2026-10-19, post-publish check passed on EmDash 1.3.1). Do not overwrite any published version.

0.2.1 in short: guests need a visitor address (shared `src/visitor-key.ts`, copied from the starter byte for byte; no address means `GUEST_UNAVAILABLE` and the kit shows sign-in); every review read filters by status in the query and pages through all rows (`allReviews` in `src/core.ts`); Waiting shows Set up visitor pages until `kit_done` is set in kv; `sendMail` stores `mail_status`; `scripts/add-to-site.sh` is the one kit install.

**Branch 0.2.2 (PR open, not merged, not tagged, not published):** closes #64. `add-to-site.sh` says "already in place" per template when the post page has `<Reviews` and the card has `<RatingBadge`. Script tests: 11 checks.

## Next

- Owner QA of 0.2.2, then merge, tag v0.2.2, publish, update-package.
- Findings after a release: patch only if a site owner is exposed, otherwise an issue for the next milestone.

## How to work

- GitHub issues only. Never Basecamp for EmDash plugins.
- No AI attribution in commits. No em-dashes.
- Do not republish an old version. Do not `--allow-overwrite`.

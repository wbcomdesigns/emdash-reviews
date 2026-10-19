# Handoff: WB Reviews (2026-10-19, 0.2.1 in review)

You are the one agent for this repo. Read this, then work.

## Read first, in this order

1. Load the `emdash-plugin-development` skill.
2. EmDash's own guides in the lab: `.agents/skills/building-emdash-site` and `.agents/skills/creating-plugins`.
3. `~/code/emdash-plugin-starter/EMDASH-SUPPORT.md`.
4. `SCOPE.md` here. The corrections section wins over older lines.
5. `PLAN.md` here.

## Where it stands (2026-10-19)

**Live on the registry:** 0.2.0. Do not overwrite any published version.

**Branch 0.2.1 (PR open, not merged, not tagged, not published):** closes #56 to #62.
- Guests need a visitor address (shared `src/visitor-key.ts`, copied from the starter byte for byte). No address: `GUEST_UNAVAILABLE`, health `guestWrites: false`, kit shows sign-in, Settings banner.
- Every review read filters by status in the query and pages through all rows (`allReviews` in `src/core.ts`). New storage index `pending_change`.
- Waiting shows Set up visitor pages until `kit_done` is set in kv.
- Mail: a sandboxed plugin always has `ctx.email`; only a send tells whether a provider exists. `sendMail` stores `mail_status`; saving the Email tab sends one test notice.
- `scripts/add-to-site.sh` is the one kit install; `apply-kit.sh` calls it for the lab.

## Next

- Owner QA of 0.2.1, then merge, tag v0.2.1, publish, update-package.
- Findings after a release: patch only if a site owner is exposed, otherwise a card for the next milestone.

## How to work

- GitHub issues only. Never Basecamp for EmDash plugins.
- No AI attribution in commits. No em-dashes.
- Do not republish an old version. Do not `--allow-overwrite`.

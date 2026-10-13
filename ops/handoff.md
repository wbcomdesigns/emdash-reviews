# Handoff: WB Reviews (2026-10-14, 0.1.0 ready for owner publish)

You are the one agent for this repo. Read this, then work.

## Read first, in this order

1. Load the `emdash-plugin-development` skill.
2. EmDash's own guides in the lab: `.agents/skills/building-emdash-site` and `.agents/skills/creating-plugins`.
3. `~/code/emdash-plugin-starter/EMDASH-SUPPORT.md`.
4. `SCOPE.md` here. The corrections section wins over older lines.
5. `PLAN.md` here.

## Where it stands

Branch `0.1.0`, PR into main. 0.1.0 engine and kit are built: guest write, star-only, pending change, list bars/sort/page, owner reply, dashboard widget, hourly notify hook, registry branding. Tests 27 pass. Lab prove passes. Browser walk 2026-10-14: guest and admin on lab and emdash-local, subscriber write on the lab. Dark Submit contrast 21:1. Hidden badges `display:none`.

Do not merge, tag or publish. The owner publishes.

Shared button contrast lives in `emdash-plugin-starter/site-kit/styles/wbcom-base.css` (`--wb-btn-bg`). Copy that file into a kit. Do not edit `wbcom-base.css` only in this repo.

## Not in this release

`<MyReviews>` (0.2.0). #19 trusted in-text block (optional after registry). A Report link. Email to reviewers.

## How to work

- Lab: `./scripts/reset-lab.sh`, `./scripts/prove-lab.sh`, `./scripts/lab-role.sh`.
- GitHub issues only. Never Basecamp for EmDash plugins.
- No AI attribution in commits. No em-dashes.

## You stop when

The owner says publish. Then follow `CONTRIBUTING.md` publish steps only after the automatic security review of the final commit.

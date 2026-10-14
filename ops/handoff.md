# Handoff: WB Reviews (2026-10-14, 0.1.2)

You are the one agent for this repo. Read this, then work.

## Read first, in this order

1. Load the `emdash-plugin-development` skill.
2. EmDash's own guides in the lab: `.agents/skills/building-emdash-site` and `.agents/skills/creating-plugins`.
3. `~/code/emdash-plugin-starter/EMDASH-SUPPORT.md`.
4. `SCOPE.md` here. The corrections section wins over older lines.
5. `PLAN.md` here.

## Where it stands

**Live after this release:** 0.1.2. Do not overwrite 0.1.0, 0.1.1 or 0.1.2.

- Package: `@vapvarun.bsky.social/reviews@0.1.2`
- Page: https://plugins.emdashcms.com/plugins/@vapvarun.bsky.social/reviews
- Covers: `images/banner.png` (light, 3000x1000, declared). Dark counterpart remains `images/banner-dark.png`.

Closed in 0.1.2: #28 #29 #30.

## Next

- Watch `emdash-plugin info vapvarun.bsky.social reviews --version 0.1.2` until the listing uses 0.1.2
- Confirm a standard `npm create emdash@latest` site with a registry install: every kit request should hit `r_nt2pnhev44oaara3` and succeed
- #4 My reviews (0.2.0)
- #19 trusted in-text block

## How to work

- GitHub issues only. Never Basecamp for EmDash plugins.
- No AI attribution in commits. No em-dashes.
- Do not republish 0.1.0, 0.1.1 or 0.1.2. Do not `--allow-overwrite`.

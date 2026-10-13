# Handoff: WB Reviews (2026-10-14, 0.1.1 covers)

You are the one agent for this repo. Read this, then work.

## Read first, in this order

1. Load the `emdash-plugin-development` skill.
2. EmDash's own guides in the lab: `.agents/skills/building-emdash-site` and `.agents/skills/creating-plugins`.
3. `~/code/emdash-plugin-starter/EMDASH-SUPPORT.md`.
4. `SCOPE.md` here. The corrections section wins over older lines.
5. `PLAN.md` here.

## Where it stands

**Live:** 0.1.0 is published. 0.1.1 rebuilds the registry covers and the three presentation fixes from the ship walk. Do not overwrite 0.1.0.

- Package: `@vapvarun.bsky.social/reviews`
- Page: https://plugins.emdashcms.com/plugins/@vapvarun.bsky.social/reviews
- Covers: `images/banner.png` (light, 1200x400, declared) and `images/banner-dark.png` (dark). Sources in `~/Documents/brand logos/wb-reviews/social/src/emdash-banner{,-dark}.svg`.
- The listing hero is `.banner-wrap { aspect-ratio: 3; } img { object-fit: cover }`. A 1200x305 edge-to-edge lockup crops to "WBReview".

## Next

- Publish 0.1.1 (owner or this session if already authorised). Then `emdash-plugin update-package --yes` so the listing copy matches.
- #4 My reviews (0.2.0)
- #19 trusted in-text block

## How to work

- GitHub issues only. Never Basecamp for EmDash plugins.
- No AI attribution in commits. No em-dashes.
- Do not republish 0.1.0. Do not `--allow-overwrite`.

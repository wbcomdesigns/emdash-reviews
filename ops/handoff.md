# Handoff: Reviews and Ratings

Read this first. Then `SCOPE.md`, `PLAN.md`, `AGENTS.md`, `CONTRIBUTING.md` and `docs/qa/QA_CHECKLIST.md`.

## Where it stands (2026-10-13)

Members-only engine, admin and 13 tests are written and passing, and the kit was walked once in a browser on the lab (submit, approve, list, badge, my reviews). Not built yet: guest reviews, star-only ratings, owner reply, the guest email setting.

| Thing | Where |
| --- | --- |
| Repo | `wbcomdesigns/emdash-reviews`, local `~/code/emdash-reviews` |
| Registry package | `@vapvarun.bsky.social/reviews` (not published) |
| Lab site | `~/code/emdash-lab-reviews`, port 4331 |
| Cards | GitHub issues in this repo, milestone `0.1.0` |
| Reference plugin | `~/code/emdash-listora` (shipped), `~/code/emdash-reviews` (same starter, engine built) |
| Shared starter | `~/code/emdash-plugin-starter` |

## Start

```bash
cd ~/code/emdash-reviews
npm install --legacy-peer-deps
npm test
./scripts/setup-lab.sh
./scripts/reset-lab.sh
```

## Cards, in order

1. Lab: mount the components and walk them
2. Reviews component: every state, every width
3. Rating badge on lists
4. My reviews and erase
5. Admin queue walked in the real admin
6. Structured data on a real page
7. Guest participation
8. Star-only ratings
9. Owner reply
10. Guest email setting and privacy
11. Wording file
12. Owner docs and install steps
13. Registry branding and release gate

Each card lists what to build, when it is UX ready, when it is function ready, and the QA cases that prove it. A card is done when all three hold and you have commented on it with what you verified and how. Take them in order: later cards assume earlier ones.

## Decisions already made

- Free scope only. `SCOPE.md` lists what is in and what is out.
- Members sign in with their EmDash account. Guests can do only what `SCOPE.md` marks public.
- Kit markup is the same for every visitor, because site pages are cached without regard to cookies.
- The owner publishes. Agents stop at a passing gate and hand over.

## Watch for

- Star input uses reversed source order so CSS can fill leftwards. Arrow-key direction must be checked with a keyboard and a screen reader
- `page:metadata` output has only been tested through the test host, not on a rendered page
- `syncRating` reads up to 500 reviews per entry
- The kit has not been walked in a browser yet
- Guest routes are public writes. Per-visitor limit, honeypot, length caps, and refuse when the host gives no IP. Never trust a visitor id from the request: derive it from the request's IP on the server
- A guest email is personal data. It must never leave through `list`, `summary` or page HTML: test for it explicitly
- The built engine requires review text and has no reply, guest or email support yet. Cards add them
- Messages that come back from a route (for example a refusal) reach the visitor too. Routes return a stable `code`; the kit maps codes to phrases from the wording file and never prints the route's own English message

## When you stop

Rewrite "Where it stands" with the date and the truth: what works, what was verified and how, what was not verified. Update `docs/qa/QA_CHECKLIST.md`'s last-walk line the same way.

## 2026-10-13: plan locked

Scope and plan are locked. New tasks #14 to #18 came out of the owner review; `PLAN.md` has the full order. Work on a branch named `0.1.0`.

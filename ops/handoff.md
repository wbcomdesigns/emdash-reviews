# Handoff: WB Reviews (2026-10-13, plan locked)

You are the one agent for this repo. Read this, then work.

## Read first, in this order

1. Load the `emdash-plugin-development` skill. It separates what EmDash core already gives every site, what a plugin may add, and the owner's standing rules.
2. EmDash's own guides in the lab site once it exists: `.agents/skills/building-emdash-site` and `.agents/skills/creating-plugins` (with `references/sandbox-boundaries.md`). They win over everything else.
3. `~/code/emdash-plugin-starter/EMDASH-SUPPORT.md`: what is proven, what is documented but not tried, what is not possible.
4. `SCOPE.md` here. Start with its section "Corrections after reading EmDash's own guides": it wins over older lines.
5. `PLAN.md` here: the order of work, at the end of the file.

## Where it stands

#1 and #14 are done on branch `0.1.0`. Settings is its own page: tick-boxes from `schema:read` (proven on the lab: Posts and Pages by name), plus approval, who, guest email and the hourly notice. The queue no longer holds settings. Lab start uses `astro dev --background` (Astro 7). Still unbuilt: visitor reviews, stars only, owner reply, Waiting/Published split with paging, the dashboard card, the bar breakdown, the hourly email task. Reviews stay member-only until #9.

## Start with

#18 (Waiting, Published and Settings pages with paging and find).

## Prove before you build on it

Listing content types with `schema:read`. A dashboard card (`admin.widgets`). The hourly task firing on its own. A trusted-install block (#19, late).

Prove each on the lab first. If a proof fails, stop, write what you tried and what happened on the task's issue, and wait for the owner. Not possible on EmDash means the idea is dropped, not worked around.

## Not in this release

`<MyReviews>` and any member account list (0.2.0). A Report link. Email to reviewers.

## How to work

- Branch `0.1.0` from `main`. Commit per finished task. Open one pull request into `main` and keep pushing to it.
- Lab: `./scripts/setup-lab.sh` creates `../emdash-lab-reviews` on port 4331. `./scripts/reset-lab.sh`, `./scripts/prove-lab.sh`, `./scripts/lab-role.sh`. To walk visitor features on the lab, add `trustedProxyHeaders: ["x-forwarded-for"]` to the lab's EmDash config and send that header, and also walk the cookie fallback without it.
- Copy proven patterns from `~/code/emdash-listora` (branch `0.5.0`): the hourly notice task `notifyOwners`, guarded writes with `updateIf`, the compare-and-set rate limit, the version token on every admin decision, the single layout file in the kit.
- A task is done when its tests pass and you have walked it in a browser as a visitor and as the admin, including a failed request, at 1440 and 390, in light and dark. Say on the issue what you walked and what you did not.
- Add each task's cases to `docs/qa/QA_CHECKLIST.md`.
- No AI attribution in commits or pull requests. No em-dashes. Plain words in everything a site owner reads.

## You stop when

Every 0.1.0 task is closed with a verification comment, the checklist has an honest last-walk line, and the pull request is open. You never merge into `main`, never tag, never publish. A registry release cannot be changed. The owner releases.

## Who checks your work

The Listora session reviews each plugin's pull request against `SCOPE.md` and walks it in a browser before the owner releases. Leave the lab in a state that can be reset and walked.

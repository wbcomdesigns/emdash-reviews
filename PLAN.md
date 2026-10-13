# Plan: Reviews and Ratings

The plan for this plugin, kept in the repository so it travels with the code. `SCOPE.md` says what the plugin is. This file says in what order it gets built and what waits.

## Decisions made with the owner

| Question | Decision |
| --- | --- |
| Who can take part | The site owner chooses: signed-in members only, or anyone. Default is anyone. |
| Owner reply | In 0.1.0. The owner can post one public reply under a review. |
| Stars without text | Allowed. Text is optional. A star-only rating counts in the average and does not appear in the review list. |
| What a guest gives | The owner chooses: name only (default), or name and email. An email is never shown publicly. |

## 0.1.0: first release

Work the cards in this order. Each is a GitHub issue under milestone `0.1.0` with its build list, UX bar, function bar and QA cases. Later cards assume earlier ones.

1. **Lab: mount the components and walk them**. Proven by: G-1, G-2, G-3
2. **Reviews component: every state, every width**. Proven by: G-4, M-1, M-2, M-3, P-1, P-2, P-3, P-4, P-5
3. **Rating badge on lists**. Proven by: G-5
4. **My reviews and erase**. Proven by: M-4, M-5, M-6
5. **Admin queue walked in the real admin**. Proven by: A-1, A-2, A-3, A-4, A-5
6. **Structured data on a real page**. Proven by: G-6
7. **Guest participation**. Proven by: G-7, G-8, G-9, G-10, A-7
8. **Star-only ratings**. Proven by: M-9
9. **Owner reply**. Proven by: A-8
10. **Guest email setting and privacy**. Proven by: G-11, A-9
11. **Owner docs and install steps**. Proven by: tests
12. **Registry branding and release gate**. Proven by: the whole checklist

0.1.0 is done when every card is closed with a verification comment, `docs/qa/QA_CHECKLIST.md` has an honest last-walk line, and the gate in `CONTRIBUTING.md` passes. The owner publishes.

## 0.2.0: parked on purpose

Agreed as worth doing, not now. Do not start these during 0.1.0.

- Helpful votes on reviews
- Photo reviews
- Review reminders

## Not planned

See "Out of scope" in `SCOPE.md`. If a card seems to need one of those, stop and ask the owner.

## Before it goes on a live site

- Prove the kit on a preview deploy of one existing site, never on production first
- Check the site's EmDash version, its content security policy, and its page cache against what the kit does
- Findings from the first plugin are in `wbcomdesigns/emdash-listora` issue #23

# Reviews and Ratings: scope

**Status: LOCKED on 2026-10-13.** Scope and decisions were agreed with the owner. An agent does not add options or features. If a task cannot be done as written, stop, say why on its issue, and wait for the owner.

This file is the contract for the plugin. Code, tests, docs and cards all follow it. If something here is wrong, change it here first, in the same pull request as the code.

## Corrections after reading EmDash's own guides (2026-10-13)

**This section wins over any older line below that disagrees with it.**

- **Not the same as core comments.** EmDash has comments built in. Reviews adds what comments do not have: a star rating, one entry per person per page, an average with a count, the bar breakdown, an owner reply, and rating data for search engines. Do not build threads, replies between visitors, or anything comments already do.
- **Owner alert:** a card on the EmDash dashboard (`admin.widgets`) shows what is waiting and links to it. That is the alert on every site. The hourly email is an extra, sent only where the site has mail; the setup guide names the official Resend plugin.
- **Guests need a visitor address (owner decision 2026-10-16, replaces the cookie fallback).** EmDash passes the visitor address only on Cloudflare or where the site sets `trustedProxyHeaders`. Without it there is no working per-guest limit, so `write_guest` answers `GUEST_UNAVAILABLE` and stores nothing, `health` says `guestWrites: false`, the kit shows the sign-in link, and Settings says so in one line. IPv6 guests count by their /64. Members are not affected.
- **Lists read only the status they show (0.2.1).** Every review read filters by status in the query and pages through all rows, so waiting reviews can never push published ones out of the list or the rating.
- **Member account list (`<My...>`):** not in 0.1.0. Moved to 0.2.0. The erase-by-person function stays, as an admin action.
- **Block inside post text:** only with a trusted install. The registry install is the whole product without it.
- **Admin pages:** Waiting, Published, Settings, plus the dashboard card. Content types are tick-boxes (`schema:read`).
- **Site time zone and date format** come from EmDash's site settings. Dates on reviews use them.
- **Registry install address:** a registry install is not at `/_emdash/api/plugins/reviews/`. It is at `r_nt2pnhev44oaara3`. The shared kit (`pluginFetch`) tries that id, then the slug. No other kit file writes the plugin URL.
- **Closed content types:** Reviews and the rating badge draw nothing when the collection is not in Settings. The visitor is not shown a form that then fails.

## Purpose

Let visitors read reviews and star ratings on any piece of content, let signed-in members write one, and let the owner approve them before they show. Search engines get the rating as structured data.

**Who it is for:** Any EmDash site that wants social proof on articles and pages.

**WordPress source:** None. New for EmDash. The review, moderation and rating logic was proven in Listora 0.3.x.

**Brand:** WB Reviews. Colour: warm orange. The full logo set is in `~/Documents/brand logos/wb-reviews/`. This repo carries `icon.png`, `images/banner.png` (light, 3000x1000) and `images/banner-dark.png` from it. The registry accepts one banner; light is declared. Do not draw or edit a logo here.

## Fits every kind of site

This plugin must work for any site owner, not one niche. Judge every screen and every word against this table.

| Kind of site | How the owner uses it |
| --- | --- |
| Blog or magazine | Readers rate articles, recipes, guides |
| Business or service site | Clients review a service or a case study page |
| Shop or product site | Buyers review a product page |
| Community or membership | Members review resources, courses, events |
| Docs or SaaS | Users rate tutorials and integrations |
| Portfolio or agency | Testimonials on project pages |

**Member accounts:** Works with or without member accounts. The owner chooses who can take part.

How it stays general:

- Works on any collection the owner names. Nothing is tied to posts
- No assumption about what is being reviewed: the wording says "review", never "product" or "article"
- Every visitor-facing word is in one wording file, so a non-English site or a site with its own vocabulary changes it in one place

**Decided by the owner on 2026-10-13: the site owner chooses who can take part.** One setting: signed-in members only, or anyone. For a guest: one entry per visitor, identified by a salted hash of the IP (never the IP itself, never a cookie the visitor can clear to vote again within the hour limit), an hourly limit per visitor, a honeypot field on every guest form, and written content always held for approval. Guests have no account, so they have no "My ..." list and cannot erase their entries themselves; the owner removes them in admin. If the host supplies no visitor address, guests are asked to sign in (owner decision 2026-10-16; the 2026-10-13 cookie fallback is withdrawn because it had no working limit). Member routes stay private routes using `routeCtx.user`. Guest routes are separate public routes: never merge the two paths.

## Decisions made with the owner

Settled. Do not reopen these in code review. Dated 2026-10-13 unless noted.

| Question | Decision |
| --- | --- |
| Who can take part | The site owner chooses: signed-in members only, or anyone. Default is anyone. |
| Owner reply | In 0.1.0. The owner can post one public reply under a review. |
| Stars without text | Allowed. Text is optional. A star-only rating counts in the average and does not appear in the review list. |
| What a guest gives | The owner chooses: name only (default), or name and email. An email is never shown publicly. |
| Wording and language | One wording file per plugin kit. Every visitor-facing phrase lives there, so an owner can translate or reword the plugin by editing one file. |
| How the owner picks what can be reviewed | Tick-boxes of the site's real content types, by their normal names. No typed list. |
| Long review lists | A bar per star level with counts, 10 reviews at a time with Show more, sort by Newest, Highest or Lowest. |
| Owner alert | Waiting count in admin, plus at most one email an hour when reviews are waiting. No review text and no link in the email. A switch turns it off. |
| Reporting a review | Not in the first release. Every review is approved before it shows. |
| Changing a review | The published review stays live until the change is approved. |
| Admin layout | Three pages: Waiting, Published, Settings. Each list has Next, Previous and find by text. |
| Who replies | The site admin, from the admin page. One reply per review. |
| Setup | One-page developer guide plus one command, same as Listora. |

## In scope for 0.1.0

- One review per member per entry: 1 to 5 stars, optional headline, text up to 1000 characters
- Reviews wait for approval by default. A setting publishes them at once
- Average rating and review count per entry, kept in plugin storage
- Owner chooses which collections can be reviewed (default: posts)
- Drop-in `<Reviews>` component: summary, list, form
- Drop-in `<RatingBadge>` for cards and lists, filled by one request per page
- Admin: waiting queue, published list with remove, settings
- Rating added to the page's structured data automatically
- Setting "Who can review": signed-in members only, or anyone. A guest gives a display name (no email). A guest review always waits for approval, even when moderation is off for members
- Text is optional: a visitor can leave stars only. Star-only ratings count in the average and are not listed
- Owner reply: one public reply per review, written in admin, shown under the review. Editable and removable
- Setting "Ask guests for an email": off by default. When on, the email is stored, never returned by a public route, and shown only in admin
- Admin: find a guest's reviews by email and delete them, so the owner can answer a privacy request
- One wording file, `site-kit/lib/reviews-strings.ts`: every phrase a visitor can see (buttons, labels, messages, empty states, errors shown to visitors). Components and pages take their text only from it

## Out of scope

Do not build these. If a card seems to need one, stop and ask the owner.

- Photo or video reviews
- Multi-criteria ratings
- Helpful votes
- Importing reviews from other platforms
- Verified-buyer badges
- Any paid or Pro feature
- Email to reviewers or to anyone but the site admin. The one email this plugin sends is the hourly "reviews are waiting" notice, and only when the site has mail set up. Saving the Email tab with the notice on also sends one test notice to that same owner address (0.2.1): a sandboxed plugin can only learn whether the site has a mail provider by sending, and Settings must say plainly when it has none
- A Report link on reviews
- Portable Text blocks or anything that needs a native plugin
- Injecting scripts, styles or HTML into pages from the plugin
- Reply threads (one owner reply only)
- Emailing the reviewer
- Translating the admin screens, and switching language per visitor. The wording file holds one language

## Roles

| Role | Can do |
| --- | --- |
| Guest | Everything marked `public` in the routes table |
| Member | Signed in at subscriber role or above. Everything marked `member`, acting only on their own data |
| Admin | Everything marked `admin`, from the EmDash admin |

## Capabilities

`content:read`, `schema:read` (to list the site's content types on the Settings page), `email:send` (the hourly notice to the site admin)

Ask for nothing more without the owner's agreement: every capability is shown to the site owner at install.

## Data schema

### `reviews`

Row id: `<collection>:<entryId>:<memberId>`. A guest's row id is `<collection>:<entryId>:v-<visitorHash>`. Indexes: `status`, `entry`, `member_id`, `createdAt`, `email`.

| Field | Type | Notes |
| --- | --- | --- |
| `entry` | string | `<collection>:<entryId>`. The lookup key |
| `collection` | string |  |
| `entryId` | string |  |
| `member_id` | string | From `routeCtx.user.id`. Never from the request |
| `author` | string | Member's display name at write time |
| `stars` | number | 1 to 5, whole |
| `title` | string | Up to 120 characters |
| `body` | string | Optional. Up to 1000 characters. Empty for a star-only rating |
| `status` | string | `pending`, `published` or `rejected` |
| `rev` | string | Random token, new on every write. Moderation clicks must match it |
| `createdAt` | string | ISO time |
| `visitor` | string | Guests only: SHA-256 of the IP plus a per-site salt. Never the IP. Empty for members |
| `guest` | boolean | True for a guest review. Shown as a marker in the admin table |
| `has_text` | boolean | False for a star-only rating. The public list returns only rows where this is true |
| `owner_reply` | string | The owner's public reply. Up to 1000 characters. Empty when there is none |
| `owner_reply_at` | string | ISO time of the reply |
| `email` | string | Guests only, and only when the owner asks for it. Never returned by a public route |

### `ratings`

Row id: `<collection>:<entryId>`. Indexes: `collection`.

| Field | Type | Notes |
| --- | --- | --- |
| `collection` | string |  |
| `entryId` | string |  |
| `average` | number | One decimal |
| `count` | number | Published reviews only |

## Settings

| Key | Type | Default | Meaning |
| --- | --- | --- | --- |
| `collections` | string | `posts` | Content types open for reviews. Set with tick-boxes, stored as a comma list |
| `require_moderation` | boolean | `true` | Approve reviews before they show |
| `who` | string | `anyone` | `members` or `anyone` |
| `ask_guest_email` | boolean | `false` | Ask a guest for an email as well as a name |
| `notify` | boolean | `true` | Email the site admin when reviews are waiting, at most once an hour |
| `notify_to` | string | site admin | Where that email goes |

## Routes

Base: `/_emdash/api/plugins/<id>/<name>`. On a registry install `<id>` is `r_nt2pnhev44oaara3`. On a local install it is `reviews`. The kit's `pluginFetch()` tries both.

| Route | Who | Methods | Input | Returns |
| --- | --- | --- | --- | --- |
| `health` | public | GET | - | `ok`, version, open collections, `who`, `guestWrites`, `askEmail`. No waiting count |
| `list` | public | GET | `collection`, `id`, `page`, `sort` (newest, highest, lowest). 10 per page, with `total` and the count per star level | Published reviews (author, stars, title, body, createdAt), `average`, `count`. Includes `owner_reply`. Star-only ratings are counted, not listed |
| `summary` | public | GET | `collection`, `ids` (comma list, 50 max) | `ratings` map of id to `{average, count}` |
| `write` | member | POST | `collection`, `id`, `stars`, `title`, `body` | `status`: pending or published |
| `mine` | member | GET, DELETE | - | GET: own reviews with page title and link. DELETE: erase all own reviews |
| `write_guest` | public | POST | `collection`, `id`, `stars`, `title`, `body`, `name`, honeypot field | `status`: always pending. Refused when the setting is members, and with `GUEST_UNAVAILABLE` when EmDash passes no visitor address |
| `admin` | admin | POST | Block Kit | Queue, published list, settings |

`member` means a private route with `permission: MEMBER`. `admin` means a private route with no permission set. A `public` route never receives a user.

## Hooks

| Hook | What it does |
| --- | --- |
| `page:metadata` | Adds `aggregateRating` JSON-LD on content pages that have a rating |

## Admin screens

| Page | What it shows |
| --- | --- |
| `/waiting` | Stats (waiting, published this week, average), clipped table, Read opens full text with confirm. Approve / Reject. Next, Previous, find by text |
| `/published` | Same table with Reply and Delete. Delete-by-email in an accordion at the bottom. Next, Previous, find by text |
| `/settings` | Tabs: Where, Approval, Who can review, Email. One Save per tab. Guest email only when Anyone is chosen |
| Dashboard card | Waiting count and a link. Not the Waiting page |

## Site kit

| File | What it is |
| --- | --- |
| `site-kit/components/Reviews.astro` | `<Reviews collection id heading? />` |
| `site-kit/components/RatingBadge.astro` | `<RatingBadge collection id />` |
| `site-kit/styles/reviews.css` | Star input and badge. Everything else comes from the base stylesheet |
| `site-kit/lab/reviews-demo.astro` | Lab page that mounts all three components |
| `site-kit/lib/reviews-strings.ts` | The wording file. The only place visitor-facing text is written |

Plus the two shared files every Wbcom plugin kit carries: `site-kit/lib/wbcom-kit.ts` and `site-kit/styles/wbcom-base.css`.

## Screens and their states

A screen is done when every state listed here has been seen in a browser at 1440, 768 and 390, in light and dark.

| Screen | States that must exist |
| --- | --- |
| Reviews component | Loading line, empty state, list, form idle / busy / success / error, guest sign-in prompt, star input by mouse and keyboard |
| Rating badge | Hidden when there is no rating. Stars plus number plus count when there is |
| Admin queue | Empty states for both tables, full review text visible, toast after each decision |
| Owner reply on the site | Shown under its review, labelled as the owner's reply, visually set apart, with its date |
| Star-only rating | The form submits with stars alone. Thanks message is the same. The summary updates after approval |

## Risks and open questions

- Star input uses reversed source order so CSS can fill leftwards. Arrow-key direction must be checked with a keyboard and a screen reader
- `page:metadata` output has only been tested through the test host, not on a rendered page
- `syncRating` reads up to 500 reviews per entry
- The kit has not been walked in a browser yet
- Guest routes are public writes. Per-visitor limit, honeypot, length caps, and refuse when the host gives no IP. Never trust a visitor id from the request: derive it from the request's IP on the server
- A guest email is personal data. It must never leave through `list`, `summary` or page HTML: test for it explicitly
- The built engine requires review text and has no reply, guest or email support yet. Cards add them
- Messages that come back from a route (for example a refusal) reach the visitor too. Routes return a stable `code`; the kit maps codes to phrases from the wording file and never prints the route's own English message

**Owner decision 2026-10-13:** the member account piece (My votes / My reviews) moves to 0.2.0. EmDash is not member-focused for now. Erase-by-person stays in 0.1.0 as an admin action.

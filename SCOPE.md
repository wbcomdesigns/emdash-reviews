# Reviews and Ratings: scope

This file is the contract for the plugin. Code, tests, docs and cards all follow it. If something here is wrong, change it here first, in the same pull request as the code.

## Purpose

Let visitors read reviews and star ratings on any piece of content, let signed-in members write one, and let the owner approve them before they show. Search engines get the rating as structured data.

**Who it is for:** Any EmDash site that wants social proof on posts, products, courses, recipes or listings.

**WordPress source:** None. New for EmDash. The review, moderation and rating logic was proven in Listora 0.3.x.

**Brand:** No product logo yet. Use the Wbcom Designs mark from `~/Documents/brand logos/Wbcom Designs Logo/` until one is drawn.

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
- Wording on the form and empty states can be changed through component props

**Decided by the owner on 2026-10-13: the site owner chooses who can take part.** One setting: signed-in members only, or anyone. For a guest: one entry per visitor, identified by a salted hash of the IP (never the IP itself, never a cookie the visitor can clear to vote again within the hour limit), an hourly limit per visitor, a honeypot field on every guest form, and written content always held for approval. Guests have no account, so they have no "My ..." list and cannot erase their entries themselves; the owner removes them in admin. If the host supplies no IP, every guest shares one bucket: refuse guest writes in that case and say why in the admin page. Member routes stay private routes using `routeCtx.user`. Guest routes are separate public routes: never merge the two paths.

## In scope for 0.1.0

- One review per member per entry: 1 to 5 stars, optional headline, text up to 1000 characters
- Reviews wait for approval by default. A setting publishes them at once
- Average rating and review count per entry, kept in plugin storage
- Owner chooses which collections can be reviewed (default: posts)
- Drop-in `<Reviews>` component: summary, list, form
- Drop-in `<RatingBadge>` for cards and lists, filled by one request per page
- Drop-in `<MyReviews>` for an account page, with delete-my-reviews
- Admin: waiting queue, published list with remove, settings
- Rating added to the page's structured data automatically
- Setting "Who can review": signed-in members only, or anyone. A guest gives a display name (no email). A guest review always waits for approval, even when moderation is off for members

## Out of scope

Do not build these. If a card seems to need one, stop and ask the owner.

- Photo or video reviews
- Multi-criteria ratings
- Owner replies
- Helpful votes
- Review reminders
- Importing reviews from other platforms
- Verified-buyer badges
- Any paid or Pro feature
- Email sending (the host may have no mail configured)
- Portable Text blocks or anything that needs a native plugin
- Injecting scripts, styles or HTML into pages from the plugin

## Roles

| Role | Can do |
| --- | --- |
| Guest | Everything marked `public` in the routes table |
| Member | Signed in at subscriber role or above. Everything marked `member`, acting only on their own data |
| Admin | Everything marked `admin`, from the EmDash admin |

## Capabilities

`content:read`

Ask for nothing more without the owner's agreement: every capability is shown to the site owner at install.

## Data schema

### `reviews`

Row id: `<collection>:<entryId>:<memberId>`. A guest's row id is `<collection>:<entryId>:v-<visitorHash>`. Indexes: `status`, `entry`, `member_id`, `createdAt`.

| Field | Type | Notes |
| --- | --- | --- |
| `entry` | string | `<collection>:<entryId>`. The lookup key |
| `collection` | string |  |
| `entryId` | string |  |
| `member_id` | string | From `routeCtx.user.id`. Never from the request |
| `author` | string | Member's display name at write time |
| `stars` | number | 1 to 5, whole |
| `title` | string | Up to 120 characters |
| `body` | string | Up to 1000 characters |
| `status` | string | `pending`, `published` or `rejected` |
| `rev` | string | Random token, new on every write. Moderation clicks must match it |
| `createdAt` | string | ISO time |
| `visitor` | string | Guests only: SHA-256 of the IP plus a per-site salt. Never the IP. Empty for members |
| `guest` | boolean | True for a guest review. Shown as a marker in the admin table |

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
| `collections` | string | `posts` | Comma-separated collection slugs open for reviews |
| `noun` | string | `review` | The word shown to visitors: review, testimonial, rating |
| `require_moderation` | boolean | `true` | Approve reviews before they show |
| `who` | string | `anyone` | `members` or `anyone` |

## Routes

Base: `/_emdash/api/plugins/reviews/<name>`.

| Route | Who | Methods | Input | Returns |
| --- | --- | --- | --- | --- |
| `health` | public | GET | - | `ok`, version, open collections, pending count |
| `list` | public | GET | `collection`, `id` | Published reviews (author, stars, title, body, createdAt), `average`, `count` |
| `summary` | public | GET | `collection`, `ids` (comma list, 50 max) | `ratings` map of id to `{average, count}` |
| `write` | member | POST | `collection`, `id`, `stars`, `title`, `body` | `status`: pending or published |
| `mine` | member | GET, DELETE | - | GET: own reviews with page title and link. DELETE: erase all own reviews |
| `write_guest` | public | POST | `collection`, `id`, `stars`, `title`, `body`, `name`, honeypot field | `status`: always pending. Refused when the setting is members |
| `admin` | admin | POST | Block Kit | Queue, published list, settings |

`member` means a private route with `permission: MEMBER`. `admin` means a private route with no permission set. A `public` route never receives a user.

## Hooks

| Hook | What it does |
| --- | --- |
| `page:metadata` | Adds `aggregateRating` JSON-LD on content pages that have a rating |

## Admin screens

| Page | What it shows |
| --- | --- |
| `/queue` | Stats, waiting table with Approve / Reject, published table with Remove, settings form |

## Site kit

| File | What it is |
| --- | --- |
| `site-kit/components/Reviews.astro` | `<Reviews collection id heading? />` |
| `site-kit/components/RatingBadge.astro` | `<RatingBadge collection id />` |
| `site-kit/components/MyReviews.astro` | `<MyReviews />` |
| `site-kit/styles/reviews.css` | Star input and badge. Everything else comes from the base stylesheet |
| `site-kit/lab/reviews-demo.astro` | Lab page that mounts all three components |

Plus the two shared files every Wbcom plugin kit carries: `site-kit/lib/wbcom-kit.ts` and `site-kit/styles/wbcom-base.css`.

## Screens and their states

A screen is done when every state listed here has been seen in a browser at 1440, 768 and 390, in light and dark.

| Screen | States that must exist |
| --- | --- |
| Reviews component | Loading line, empty state, list, form idle / busy / success / error, guest sign-in prompt, star input by mouse and keyboard |
| Rating badge | Hidden when there is no rating. Stars plus number plus count when there is |
| My reviews | Loading, empty, list with status wording, guest sign-in prompt, two-click delete |
| Admin queue | Empty states for both tables, full review text visible, toast after each decision |

## Risks and open questions

- Star input uses reversed source order so CSS can fill leftwards. Arrow-key direction must be checked with a keyboard and a screen reader
- `page:metadata` output has only been tested through the test host, not on a rendered page
- `syncRating` reads up to 500 reviews per entry
- The kit has not been walked in a browser yet
- Guest routes are public writes. Per-visitor limit, honeypot, length caps, and refuse when the host gives no IP. Never trust a visitor id from the request: derive it from the request's IP on the server

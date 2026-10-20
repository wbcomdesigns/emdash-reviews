# Install WB Reviews

**Included in Free.** WB Reviews has no paid version.

## Before you install

**1. Your site needs a sandbox runner.** Registry plugins run in a sandbox. Until the site has one, Admin, Plugins shows "No plugins configured" and there is no Registry in the menu.

- **Node:** in your site, run `npm install @emdash-cms/sandbox-workerd workerd`, then add `sandboxRunner: "@emdash-cms/sandbox-workerd/sandbox",` inside `emdash({ ... })` in `astro.config.mjs`.
- **Cloudflare: not supported yet.** On Cloudflare Workers EmDash gives each plugin call 10 requests to the site, and several of this plugin's pages and actions need more, so they fail. A release that fits is in progress. Node sites are not affected.

Stop the dev server and start it again. **Registry** now shows in the admin menu.

**2. The plugin is the engine. Visitor pages come from its site kit.** A registry plugin cannot add pages to your site. Until you copy the kit, its addresses (for example `/account/reviews/`) show your site's 404 page. That is expected. The kit copy below takes one command.

**3. You need Node 22.16 or later** for the `npx emdash seed` step. WB Reviews has no seed step.

Checked on EmDash 1.3.1 with the `blog` template on Node.

## Install

1. Admin, Registry, search **WB Reviews**, Install, then accept the permissions. WB Reviews asks to read your content (to name the page a review belongs to), to read your content types (so you tick them by name), and to send email (for the optional waiting notice).
2. From your site's root folder, get the kit for the version you just installed and copy it in:

   ```bash
   kit="$(mktemp -d)" &&
     git clone --depth 1 \
       --branch v0.2.2 \
       https://github.com/wbcomdesigns/emdash-reviews \
       "$kit/emdash-reviews" &&
     "$kit/emdash-reviews/scripts/add-to-site.sh" .
   ```

   (`mktemp -d` makes a fresh folder only you can write to, and `&&` runs the script only when the clone worked. Never clone into a fixed `/tmp/<name>`: on a shared machine someone else can create it first.)

   The script copies the kit, never replaces a newer shared file another Wbcom plugin already copied, keeps a backup of the wording file only when you changed it yourself, creates the content types the plugin needs (if any), and prints the exact lines to paste into your templates, with the file names.
3. Paste the lines it printed. Restart the dev server.
4. Add the menu links it printed in Admin, Menus.
5. Open the plugin in the admin and follow its first screen.

After every plugin update, run step 2 again with the new tag.

## What the script copies

| File in your site | What it is |
| --- | --- |
| `src/components/Reviews.astro` | Reviews, the rating bars and the form for one entry |
| `src/components/RatingBadge.astro` | The small star rating for cards |
| `src/components/MyReviews.astro` and `src/pages/account/reviews.astro` | **My reviews** at `/account/reviews/` |
| `src/lib/reviews-strings.ts` | Every word a visitor sees |
| `src/styles/reviews.css` | The reviews look |
| `src/reviews-block/` | Optional in-text blocks, off until you add them to `astro.config.mjs` |
| `src/layouts/ReviewsLayout.astro` | The page shell for My reviews. **Kept:** copied once, never replaced |
| `src/lib/wbcom-kit.ts`, `src/styles/wbcom-base.css` | Shared by every Wbcom plugin. **Kept** when your site has a newer copy; replaced (and said so) when yours is older |

Every other file in the list is **replaced** on each run. If you changed one (its content is not what any release shipped, checked against `site-kit/kit.sums`), the script first saves your copy next to it as `<file>.bak-YYYYMMDD` (with the time added on a second run the same day) and lists every copy it saved. Files you never touched are replaced without a word. Keep your wording in `src/lib/reviews-strings.ts` and your page shell in `ReviewsLayout.astro`, then copy any wording changes back from the backup after an update.

## The lines to paste

On the EmDash `blog` template the script prints these. Each import path is the one that works from that file.

In `src/pages/posts/[slug].astro` (the post page), add to the imports at the top:

```astro
import Reviews from "../../components/Reviews.astro";
```

and where the reviews should show, for example just above `<section class="post-comments">`:

```astro
<Reviews collection="posts" id={post.data.id} />
```

In `src/components/PostCard.astro` (the post card), add to the imports at the top:

```astro
import RatingBadge from "./RatingBadge.astro";
```

and inside the card, right after these two lines, which end `<span class="post__meta">` (the first `</span>` after it closes the nested reading-time span, not the meta span):

```astro
				<span>{readingTime}</span>
			</span>
```

add:

```astro
<RatingBadge collection="posts" id={post.data.id} />
```

Use `post.data.id`, the entry id. On the blog template `post.id` is the slug and finds no reviews. For pages, use `collection="pages"` in the page template. A badge shows nothing for a page with no rating, and every badge on a page loads with one request.

## Menu link

In Admin, Menus, add a custom link named **My reviews** pointing at `/account/reviews/`. A signed-in member sees each review with its page, stars, text and status, and **Delete all my reviews** asks for a second click. A guest sees **Sign in to see the reviews you have written.** and a sign-in link.

## Choose what can be reviewed

1. In admin, open **Reviews**, then **Settings**.
2. On the **Where** tab, tick the kinds of page visitors can review.
3. Choose **Save**.

Until you save, only **Posts** is open. See the [Settings reference](../settings/settings-reference.md).

The first Reviews screen, **Waiting**, shows **Set up visitor pages** with the command for your installed version. Choose **Visitor pages are set up** once the kit is in. A link to this guide stays on the screen.

## Guests and hosting

EmDash gives a plugin the visitor's address only on Cloudflare, or when the site sets `trustedProxyHeaders` inside `emdash({ ... })` in `astro.config.mjs` (for example `trustedProxyHeaders: ["x-real-ip"],`). Without an address, guests are asked to sign in before they can write a review, so one person cannot review many times.

Set `trustedProxyHeaders` only to a header that **your proxy writes itself and replaces** on every request. EmDash reads the first address in that header. Many proxies **add** to `X-Forwarded-For` instead of replacing it (nginx `$proxy_add_x_forwarded_for`, most load balancers), so the first address is whatever the visitor typed, and a guest could review again and again. Behind nginx, set `proxy_set_header X-Real-IP $remote_addr;` and use `trustedProxyHeaders: ["x-real-ip"]`. Behind another proxy, use the header it overwrites with the connecting address. If you are not sure, leave it unset: members can still take part.

```js
emdash({
	trustedProxyHeaders: ["x-real-ip"],
	// sandboxRunner and the rest stay as they are
});
```

Without an address, guests see **Sign in to write a review.** instead of the form, members review as normal, and Settings shows **Guests are asked to sign in on this hosting**. The address itself is never stored: a guest is a salted hash of it, and an IPv6 visitor counts by their /64 network.

## Cookie

The review form sets one cookie, `wbr_vid`, a random token with no personal data. It exists only so a site whose plugin is still on the 0.2.0 engine counts one guest per browser. The 0.2.1 engine ignores it and counts guests by visitor address. It will be removed once 0.2.0 engines are gone.

## In the browser console

A guest's console shows one red 401 for `.../me` on each page with reviews, and for `.../mine` on My reviews. That is the kit asking whether the visitor is signed in. The page is fine. A 404 for `.../r_nt2pnhev44oaara3/...` can also show on a site that installed the plugin from local files; the kit then uses the plugin's name.

## For the in-text block

This is optional. The registry plugin does not add a block inside post text. The script already copied the block to `src/reviews-block/`. To switch it on as trusted site code, in `astro.config.mjs`:

```js
import { reviewsBlock } from "./src/reviews-block/descriptor.mjs";

emdash({
	plugins: [reviewsBlock()],
	// sandboxRunner and the rest stay as they are
});
```

Restart the site. In a post or page, type `/reviews` and choose **Reviews**, or `/rating` and choose **Rating**. Each block includes **What to show**, already set. **Reviews** can also take a heading. Both show the entry they sit in.

## Check it worked

1. Open a post on your site. You see a **Reviews** heading, "No reviews yet" and a **Write a review** form (or the sign-in line, see Guests and hosting).
2. Write a review. See [Your first review](first-review.md).

If nothing shows, see [Troubleshooting](../troubleshooting/troubleshooting.md).

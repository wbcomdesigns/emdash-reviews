# Install WB Reviews

**Included in Free.** WB Reviews has no paid version.

Installing takes three steps: the plugin in admin, the site kit in your site's code, and the components on your templates. The second and third steps need someone who can edit the site's files.

## Before you start

- Your site runs EmDash 1.2 or later.
- Your site loads plugins from the registry. In `astro.config.mjs`, EmDash needs a sandbox runner. Sites made with `npm create emdash@latest` from version 1.2 already have one. Without a runner, EmDash skips sandboxed plugins at startup.

## Step 1: install the plugin

1. In admin, open **Plugins**, then **Registry**.
2. Search for **WB Reviews** and choose **Install**.
3. EmDash lists what the plugin asks for. WB Reviews asks for three things: to read your content (so it can name the page a review belongs to), to read your content types (so you can tick them by name), and to send email (for the optional waiting notice). Confirm the install.

A **Reviews** group with **Waiting**, **Published** and **Settings** now appears in the admin menu.

## Step 2: copy the site kit

The kit is in the `site-kit/` folder of the [WB Reviews repository](https://github.com/wbcomdesigns/emdash-reviews), at the tag of the version you installed. From your site's root folder:

```bash
K=path/to/emdash-reviews/site-kit
mkdir -p src/lib src/styles src/components
cp $K/lib/reviews-strings.ts src/lib/
cp $K/styles/reviews.css src/styles/
cp $K/components/Reviews.astro $K/components/RatingBadge.astro $K/components/MyReviews.astro src/components/
mkdir -p src/pages/account
cp $K/pages/account/reviews.astro src/pages/account/reviews.astro

# The two shared files are used by every Wbcom plugin. Line 1 carries a number
# (wbcom-shared: N). Copy only when the site has no copy yet or an older one,
# so another plugin's newer copy is never replaced.
shared() { v="$(sed -n '1s/.*wbcom-shared: *\([0-9]*\).*/\1/p' "$1" 2>/dev/null)"; echo "${v:-0}"; }
newer() { [ ! -f "$2" ] || [ "$(shared "$1")" -ge "$(shared "$2")" ]; }
newer "$K/lib/wbcom-kit.ts" src/lib/wbcom-kit.ts && cp "$K/lib/wbcom-kit.ts" src/lib/wbcom-kit.ts
newer "$K/styles/wbcom-base.css" src/styles/wbcom-base.css && cp "$K/styles/wbcom-base.css" src/styles/wbcom-base.css
```

Two files, `wbcom-kit.ts` and `wbcom-base.css`, are shared by every Wbcom plugin. If another Wbcom plugin already copied them, keep the newer copy. The first line of each file carries a number (`wbcom-shared: N`). The last two lines above copy a file only when your site has no copy yet or a lower number. The [kit guide](https://github.com/wbcomdesigns/emdash-reviews/blob/main/site-kit/README.md) has the same script.

Do not copy the `site-kit/lab/` folder. It is a test page for the plugin's developers.

## Step 3: add the components to your templates

Open the template that shows a single post (in the blog starter, `src/pages/posts/[slug].astro`) and add the reviews where they should appear, usually after the content:

```astro
---
import Reviews from "../../components/Reviews.astro";
---
<Reviews collection="posts" id={post.data.id} />
```

Use the content type's real name for `collection` and the entry's id for `id`. Do the same in the page template if you want reviews on pages, with `collection="pages"`.

To show the small rating on cards and lists, add the badge:

```astro
---
import RatingBadge from "../../components/RatingBadge.astro";
---
<RatingBadge collection="posts" id={post.data.id} />
```

A badge shows nothing for a page that has no rating, so it is safe to add to every card. Many badges on one page load with one request.

## For the in-text block

This is optional. The plugin from the registry does not add a block inside post text. To put **Reviews** or **Rating** in the middle of a post, copy the block and switch it on as trusted site code.

```bash
mkdir -p src/reviews-block
cp -R path/to/emdash-reviews/site-kit/blocks/. src/reviews-block/
```

In `astro.config.mjs`:

```js
import { reviewsBlock } from "./src/reviews-block/descriptor.mjs";

emdash({
	plugins: [reviewsBlock()],
	// sandboxed: [reviews] stays as it is
});
```

Restart the site. In a post or page, type `/reviews` and choose **Reviews**, or `/rating` and choose **Rating**. EmDash will not insert a block until a field has a value, so each block includes **What to show**, already set. **Reviews** can also take a heading, and that heading can stay blank. Both show the entry they sit in. Leave this out and the registry plugin works the same.

## My reviews

The copy above adds `/account/reviews/`. A guest sees **Sign in**, and that link brings them back to this page. A signed-in member sees each review with the page name, stars, the text, and a status: **Awaiting approval**, **Published**, or **Not approved**.

**Delete all my reviews** asks for a second click, then removes only that member's reviews. The rating on each page updates at once.

Add a menu link named **My reviews** pointing at `/account/reviews/`. In admin, open **Menus**, add a custom link, and save.

## Step 4: choose what can be reviewed

1. In admin, open **Reviews**, then **Settings**.
2. On the **Where** tab, tick the kinds of page visitors can review.
3. Choose **Save**.

Until you save, only **Posts** is open. See the [Settings reference](../settings/settings-reference.md).

## Check it worked

1. Open a post on your site. You see a **Reviews** heading, "No reviews yet" and a **Write a review** form.
2. Write a review. See [Your first review](first-review.md).

If nothing shows, see [Troubleshooting](../troubleshooting/troubleshooting.md).

## After you update the plugin

Copy the kit again from the new version's tag. The kit and the plugin are released together, and an older kit may not reach a newer plugin.

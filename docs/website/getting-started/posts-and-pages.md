# Posts and pages

**Included in Free.** WB Reviews has no paid version.

Reviews show only where your template has the component. This page gives the exact steps for the standard EmDash blog template, created with `npm create emdash@latest -- --template blog`. Your developer does this once. First finish [Install WB Reviews](install.md) so `Reviews.astro` and `RatingBadge.astro` are in `src/components`.

## Posts

Open `src/pages/posts/[slug].astro`.

1. Add this import in the frontmatter, the code between the `---` lines at the top:

```astro
import Reviews from "../../components/Reviews.astro";
```

2. Add this line after the article content, inside the page markup:

```astro
<Reviews collection="posts" id={post.data.id} />
```

## Pages

Open `src/pages/pages/[slug].astro`.

1. Add the same import in the frontmatter:

```astro
import Reviews from "../../components/Reviews.astro";
```

2. Add this line after the page content:

```astro
<Reviews collection="pages" id={page.data.id} />
```

Pages also need to be ticked in the plugin. Open **Reviews**, then **Settings**, then the **Where** tab. Tick **Pages** and choose **Save**. Without the tick, the component draws nothing on pages.

## Use `post.data.id`, not `post.id`

`post.data.id` is the entry id, and reviews are saved against it. On this template `post.id` is the slug, which does not match, so no reviews would show. The same goes for `page.data.id`.

## The rating badge on post cards

On the blog template, post cards are drawn by `src/components/PostCard.astro`. The card is not given the post's id, so the badge needs three small changes:

1. In `src/components/PostCard.astro`, add `id?: string;` to `interface Props`, add `id` to the list read from `Astro.props`, and add the import:

   ```astro
   import RatingBadge from "./RatingBadge.astro";
   ```

2. In the same file, place the badge where the card should show it, for example under the title:

   ```astro
   {id ? <RatingBadge collection="posts" id={id} /> : null}
   ```

3. Where the card is used, pass the entry id. On the blog template that is `src/pages/index.astro`, `src/pages/category/[slug].astro`, `src/pages/tag/[slug].astro` and the related posts in `src/pages/posts/[slug].astro`:

   ```astro
   <PostCard id={post.data.id} ... />
   ```

A badge shows nothing for a post with no rating, so it is safe on every card. Many badges on one page load with one request.

## Check it works

1. Tick the content type on the **Where** tab and save.
2. Open a post in a private window. You see a **Reviews** heading and the **Write a review** form.
3. Send a review, then approve it in **Waiting**.

If nothing shows, see [Troubleshooting](../troubleshooting/troubleshooting.md).

1. Install WB Reviews from the registry and confirm `content:read`, `schema:read` and `email:send`.
2. Copy the site kit into your site. From the site root:

```bash
K=path/to/emdash-reviews/site-kit
mkdir -p src/lib src/styles src/components
cp $K/lib/wbcom-kit.ts $K/lib/reviews-strings.ts src/lib/
cp $K/styles/wbcom-base.css $K/styles/reviews.css src/styles/
cp $K/components/Reviews.astro $K/components/RatingBadge.astro src/components/
```

3. Drop `<Reviews collection="posts" id={post.data.id} />` on the entry template, and `<RatingBadge collection="posts" id={post.data.id} />` on cards.
4. Open Admin → Reviews → Settings. Tick the content types visitors can review. Save.

Your site needs a sandbox runner in `astro.config.mjs`. Without one, EmDash skips sandboxed plugins at startup.

Full steps: https://github.com/wbcomdesigns/emdash-reviews/blob/main/site-kit/README.md

1. Install WB Reviews from the registry and confirm `content:read`, `schema:read` and `email:send`.
2. Copy the site kit into your site. From the site root:

```bash
K=path/to/emdash-reviews/site-kit
mkdir -p src/lib src/styles src/components
cp $K/lib/reviews-strings.ts src/lib/
cp $K/styles/reviews.css src/styles/
cp $K/components/Reviews.astro $K/components/RatingBadge.astro $K/components/MyReviews.astro src/components/
mkdir -p src/pages/account
cp $K/pages/account/reviews.astro src/pages/account/reviews.astro
```

Copy `lib/wbcom-kit.ts` and `styles/wbcom-base.css` only if your site has no copy or an older one (the number on line 1). The kit guide has a script that checks for you.

3. Drop `<Reviews collection="posts" id={post.data.id} />` on the entry template, and `<RatingBadge collection="posts" id={post.data.id} />` on cards.
4. Add a menu link **My reviews** to `/account/reviews/`. A member sees their reviews there. **Delete all my reviews** asks for a second click.
5. Open Admin, Reviews, Settings. Tick the content types visitors can review. Save.

Guest reviews are still removed by an admin: Admin, Reviews, Published, find by email.

Your site needs a sandbox runner in `astro.config.mjs`. Without one, EmDash skips sandboxed plugins at startup.

Full steps: https://github.com/wbcomdesigns/emdash-reviews/blob/main/site-kit/README.md

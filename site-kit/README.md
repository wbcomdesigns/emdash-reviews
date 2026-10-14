# WB Reviews site kit

The plugin is the engine. This folder is what an EmDash site owner copies so visitors see ratings on real pages. The plugin alone cannot add pages or CSS.

Needs EmDash 1.2 or later, and a sandbox runner in `astro.config.mjs`.

## 1. Install the plugin

From the registry, or for a local site:

```bash
# in the site
npm install --legacy-peer-deps file:../emdash-reviews
```

Then add it next to any other sandboxed plugins:

```js
import reviews from "@wbcomdesigns/emdash-reviews";

emdash({
	sandboxed: [reviews],
	sandboxRunner: "@emdash-cms/sandbox-workerd/sandbox",
})
```

Confirm `content:read`, `schema:read` and `email:send` at install.

## 2. Copy the kit

From the site root:

```bash
K=path/to/emdash-reviews/site-kit
mkdir -p src/lib src/styles src/components
cp $K/lib/wbcom-kit.ts $K/lib/reviews-strings.ts src/lib/
cp $K/styles/wbcom-base.css $K/styles/reviews.css src/styles/
cp $K/components/Reviews.astro $K/components/RatingBadge.astro src/components/
```

Do not copy `site-kit/lab/`. That page is for the plugin lab only.

## 3. Drop the components on your pages

On an article, page or any entry the owner ticked in Settings:

```astro
import Reviews from "../components/Reviews.astro";
<Reviews collection="posts" id={post.data.id} />
```

On cards and lists:

```astro
import RatingBadge from "../components/RatingBadge.astro";
<RatingBadge collection="posts" id={post.data.id} />
```

Use the collection's real slug and the entry id. Reword visitor text in `src/lib/reviews-strings.ts`. The kit finds the plugin on a registry install and on a local install. Do not write `/_emdash/api/plugins/...` in your own files.

## 4. Open it as an owner

1. Admin → Reviews → Settings. Tick the content types by name. Choose who can review. Save.
2. Write a review on a live page. Guests give a name. Members can write when signed in.
3. Admin → Waiting. Approve. The page and the badge update.

A guest review always waits for approval. Stars alone are enough. Reword visitor text in `src/lib/reviews-strings.ts`.

## Lab

```bash
./scripts/reset-lab.sh
./scripts/prove-lab.sh
```

Lab demo: `http://localhost:4331/reviews-demo`. A real site uses the post page instead.

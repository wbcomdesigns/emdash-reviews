# WB Reviews site kit

The plugin is the engine. This folder is what puts reviews on your visitors' pages: a registry plugin cannot add pages or CSS by itself.

Checked on EmDash 1.3.1 with the `blog` template on Node.

## Install from the registry

1. Your site needs a sandbox runner (see Before you install in the [install guide](../docs/website/getting-started/install.md)). Then Admin, Registry, search **WB Reviews**, Install, and accept `content:read`, `schema:read` and `email:send`.
2. From your site's root folder, get the kit for the version you installed and copy it in:

   ```bash
   kit="$(mktemp -d)" &&
     git clone --depth 1 \
       --branch v0.2.1 \
       https://github.com/wbcomdesigns/emdash-reviews \
       "$kit/emdash-reviews" &&
     "$kit/emdash-reviews/scripts/add-to-site.sh" .
   ```

   The script never replaces a newer shared file (`wbcom-kit.ts`, `wbcom-base.css`) another Wbcom plugin copied, never replaces `src/layouts/ReviewsLayout.astro` once it exists, and before it replaces any kit file you changed (wording, styles, components, the My reviews page), it saves your copy as `<file>.bak-YYYYMMDD` and lists it. Untouched files are replaced quietly.
3. Paste the lines it prints. On the blog template:

   In `src/pages/posts/[slug].astro`:

   ```astro
   import Reviews from "../../components/Reviews.astro";
   <Reviews collection="posts" id={post.data.id} />
   ```

   In `src/components/PostCard.astro`:

   ```astro
   import RatingBadge from "./RatingBadge.astro";
   <RatingBadge collection="posts" id={post.data.id} />
   ```

   The import line goes with the other imports at the top of the file; the tag goes where it should show. Use `post.data.id` (the entry id), not `post.id` (the slug).
4. Restart the dev server. In Admin, Menus add **My reviews**, `/account/reviews/`.
5. Admin, Reviews, Settings: tick the content types visitors can review. Save.

After every plugin update, run step 2 with the new tag. The command clones into a fresh `mktemp -d` folder, never a fixed `/tmp` path, and runs the script only if the clone worked.

Reword visitor text in `src/lib/reviews-strings.ts`. Do not write `/_emdash/api/plugins/...` in your own files: the kit finds the plugin at its registry address and at its local one.

A guest's browser console shows a 401 for `.../me` on a post (and `.../mine` on My reviews). That is the kit asking whether the visitor is signed in; the page is fine.

## Optional: the in-text blocks

The script copies `blocks/` to `src/reviews-block/`. To place **Reviews** or **Rating** inside post text, add it as trusted site code in `astro.config.mjs`:

```js
import { reviewsBlock } from "./src/reviews-block/descriptor.mjs";

emdash({
	plugins: [reviewsBlock()],
	// sandboxRunner and the rest stay as they are
});
```

Restart, then type `/reviews` or `/rating` in a post. The registry plugin works the same without it.

## Working on this plugin

For the plugin's own developers only. A site developer never needs this section.

Install the plugin from local files instead of the registry, in a lab site:

```bash
npm install --legacy-peer-deps file:../emdash-reviews
```

```js
import reviews from "@wbcomdesigns/emdash-reviews";

emdash({
	sandboxed: [reviews],
	sandboxRunner: "@emdash-cms/sandbox-workerd/sandbox",
});
```

The lab scripts do this for you: `scripts/setup-lab.sh`, `scripts/reset-lab.sh`, `scripts/prove-lab.sh` (lab on port 4331, demo page `/reviews-demo`). Do not copy `site-kit/lab/` into a real site.

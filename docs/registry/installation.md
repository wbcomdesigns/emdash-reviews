## Before you install

**1. Your site needs a sandbox runner.** Registry plugins run in a sandbox. Until the site has one, Admin, Plugins shows "No plugins configured" and there is no Registry in the menu.

- **Node:** in your site, run `npm install @emdash-cms/sandbox-workerd workerd`, then add `sandboxRunner: "@emdash-cms/sandbox-workerd/sandbox",` inside `emdash({ ... })` in `astro.config.mjs`.
- **Cloudflare:** add `import { sandbox } from "@emdash-cms/cloudflare";` and `sandboxRunner: sandbox(),`. It needs the Workers Paid plan, the `worker_loaders` binding named `LOADER` (uncomment it in your Wrangler config) and an R2 bucket as `storage: r2(...)`, or the install stops with "Storage error while installing plugin". Then run `npm run deploy`.

Stop the dev server and start it again. **Registry** now shows in the admin menu.

**2. The plugin is the engine. Visitor pages come from its site kit.** A registry plugin cannot add pages to your site. Until you copy the kit, its addresses (for example `/account/reviews/`) show your site's 404 page. That is expected. The kit copy below takes one command.

Checked on EmDash 1.3.1 with the `blog` template, on Node and on Cloudflare Workers (registry install).

## Install

1. Admin, Registry, search **WB Reviews**, Install, then accept the permissions.
2. From your site's root folder:

   ```bash
   kit="$(mktemp -d)" &&
     git clone --depth 1 \
       --branch v0.3.0 \
       https://github.com/wbcomdesigns/emdash-reviews \
       "$kit/emdash-reviews" &&
     "$kit/emdash-reviews/scripts/add-to-site.sh" .
   ```

3. Paste the lines it prints. Restart the dev server.
4. Add the menu link it prints in Admin, Menus.
5. Open Reviews, Waiting.

After every update, run step 2 with the new tag.

Guide: https://github.com/wbcomdesigns/emdash-reviews/blob/v0.3.0/docs/website/getting-started/install.md

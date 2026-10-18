# Settings reference

**Included in Free.** WB Reviews has no paid version.

Open **Reviews**, then **Settings**. The screen has four tabs. Each tab has its own **Save** button, so saving one tab does not change the others.

## Where

| Setting | What it controls | Default |
| --- | --- | --- |
| Open for reviews | A tick-box for each content type on your site, by its normal name. Only ticked types get reviews and the rating badge | **Posts** ticked, until you first save |

Save shows "Content types saved." If you tick nothing, you see "Reviews are closed. Tick a content type to open them." and a red notice, **Reviews are closed**, stays on the screen. Hidden content types are not listed. If the site cannot return its content types, a notice says "Content types could not be read" and reviews stay on posts.

## Approval

| Setting | What it controls | Default |
| --- | --- | --- |
| Approve reviews before they show | A review waits in **Waiting** until you approve it. A star-only rating follows the same rule | On |

Save shows "Approval saved."

Guest reviews always wait for approval, even when this is off. Reviews from signed-in members follow this switch: with it off, a member's review shows at once.

## Who can review

| Setting | What it controls | Default |
| --- | --- | --- |
| Who can leave a review | **Anyone** lets a visitor review with a name and no account. **Signed-in members only** replaces the form with a sign-in link | Anyone |
| Ask guests for an email | Adds an **Your email** field for guests. The email is saved for you, never shown on the site, and lets you delete a guest's reviews by email. Shown only when **Anyone** is chosen | Off |

Save shows "Who can review saved."

Under the options you read two notes: "Anyone is the default. A guest review always waits for approval." and "Guests are counted by their visitor address, which the host must pass to EmDash. Where it does not, guests are asked to sign in." When this site gets no visitor address, a banner at the top of Settings says **Guests are asked to sign in on this hosting**. See [Guests and hosting](../getting-started/install.md#guests-and-hosting).

## Email

| Setting | What it controls | Default |
| --- | --- | --- |
| Email me when reviews are waiting | Sends the hourly notice while reviews are waiting | Off |
| Send the notice to | The address that gets the notice | Empty |

Switch the notice on and type the address in the same step, then **Save**. Save shows "Saved." and sends nothing. Use **Send a test notice** on the **Email** tab to check that the site can send email: it sends one notice to the saved address. If the site has no email provider, it says "No notice was sent: this site has no email provider." and the tab shows **This site has no email provider** until a test works. Saving the tab only saves ("Saved.") and sends nothing. Set up a provider, for example the official Resend plugin, then send a test again. Switching it on without an address says "Add the email address the notice should go to." and saves nothing. A plugin cannot read the site admin's address, so there is no default. The notice goes out at most once an hour and has no review text and no link. See [Dashboard card and email](../features/dashboard-and-email.md).

## Fixed limits

These are not settings. They are built in.

| Limit | Value |
| --- | --- |
| Headline | 120 characters |
| Review text | 1000 characters |
| Owner reply | 1000 characters |
| Guest name | 80 characters |
| Guest email | 200 characters |
| Reviews per visitor | 8 an hour |
| Reviews shown at once on a page | 10, then **Show more** |
| Rows on Waiting and Published | 25 per page |

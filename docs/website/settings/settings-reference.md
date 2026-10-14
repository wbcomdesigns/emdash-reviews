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

Guest reviews always wait for approval, even when this is off. In version 0.1.4, a review written on your page goes through the guest path (see [Writing a review as a visitor](../features/write-a-review.md)), so in practice every review waits whatever this switch says.

## Who can review

| Setting | What it controls | Default |
| --- | --- | --- |
| Who can leave a review | **Anyone** lets a visitor review with a name and no account. **Signed-in members only** replaces the form with a sign-in link | Anyone |
| Ask guests for an email | Adds an **Your email** field for guests. The email is saved for you, never shown on the site, and lets you delete a guest's reviews by email. Shown only when **Anyone** is chosen | Off |

Save shows "Who can review saved."

Under the options you read two notes: "Anyone is the default. A guest review always waits for approval." and "Guest protection uses a trusted visitor address when the host provides one. Otherwise a browser cookie is used, and protection is weaker."

## Email

| Setting | What it controls | Default |
| --- | --- | --- |
| Email me when reviews are waiting | Sends the hourly notice while reviews are waiting | On |
| Send the notice to | The address that gets the notice | Empty |

Save shows "Email notice saved." The notice goes out at most once an hour and has no review text and no link. The field says "Leave blank to use the site admin." In version 0.1.4 the notice is sent only when you type an address, so fill it in. See [Dashboard card and email](../features/dashboard-and-email.md).

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

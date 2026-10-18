# Troubleshooting

**Included in Free.** WB Reviews has no paid version.

## There is no reviews section on my page

Check these in order:

1. **Is the kit installed?** Your developer must copy the kit and add `<Reviews ... />` to the template. The plugin alone draws nothing. See [Install](../getting-started/install.md).
2. **Is the content type ticked?** Open **Reviews**, then **Settings**, then the **Where** tab. A page type that is not ticked shows no reviews and no form.
3. **Did you save?** Choose **Save** on the tab. Each tab saves on its own.
4. **Is the page published?** Only published pages can be reviewed.

## The form is missing and I see "Only members can review this page."

**Who can leave a review** is set to **Signed-in members only**. A guest sees that line and a sign-in link. A signed-in member sees the form and writes as their account, with no name field. To let guests review, choose **Anyone** on the **Who can review** tab.

## Guests see "Sign in to write a review." instead of the form

**Who can leave a review** is **Anyone**, but your host does not pass the visitor's address to EmDash. Without it the plugin cannot limit each guest, so guests are asked to sign in and members review as normal. Settings shows **Guests are asked to sign in on this hosting**. Fix it on the host: Cloudflare passes the address, or set `trustedProxyHeaders` in `astro.config.mjs`. See [Guests and hosting](../getting-started/install.md#guests-and-hosting).

## The email notice never arrives

Open **Reviews**, **Settings**, **Email**. If it says **This site has no email provider**, nothing can be sent until you add one, for example the official Resend plugin. Then press **Send a test notice**: it tells you whether mail now goes out.

## Why does the console show a 401?

On a page with reviews, the kit asks whether the visitor is signed in. EmDash answers "not signed in" with status 401. The browser lists that in the console in red. Visitors never see it, and the form still works: a guest sees **Your name**, and a signed-in member does not.

EmDash keeps the session cookie hidden from scripts, and the public "who am I" address returns the same 401 for a guest. There is no quieter check that still works on a page cached the same for everyone. The red line is expected.

## A visitor sent a review and I cannot find it

1. Open **Waiting**. Guest reviews always wait there.
2. Use **Find** with a word from the review or the name. Clear the box to see everything.
3. Check **Published**. If approval was off, a member's review may already be live.

## The badge shows nothing

A badge is hidden for a page with no published rating. It also hides when the page's content type is not ticked on the **Where** tab. A waiting review does not count.

## The average did not change

The average and count use published reviews only. Approve the review first.

## "Reviews are not open for that page."

The visitor tried to review a page that is not open. Tick its content type on the **Where** tab, and make sure the page is published.

## "Too many requests. Try again in an hour."

The same visitor sent 8 reviews within an hour. It clears by itself.

## "Something went wrong. Try again."

The hidden spam field was filled, or the request failed. A person on a normal browser rarely sees this. Ask them to reload and try again.

## I get no email when reviews are waiting

1. On the **Email** tab, check **Email me when reviews are waiting** is on.
2. Type an address under **Send the notice to**. In version 0.1.4 a blank field sends nothing.
3. Check your site can send mail. EmDash needs an email plugin, such as the official Resend plugin.

The dashboard card shows the waiting count whether or not email works.

## Delete by email found nothing

"No reviews with that email." means no review carries that address. Reviews keep an email only when **Ask guests for an email** was on at the time. Check the spelling.

## Reviews stopped working after I updated the plugin

Copy the site kit again from the version you installed. The kit and the plugin are released together.

## The reviews look plain or the colours are wrong

The kit's two style files must be copied: `src/styles/reviews.css` and `src/styles/wbcom-base.css`. If they are there, see [Wording and look](../customize/wording-and-look.md).

## Dates show the wrong day

Dates use the time zone in your EmDash site settings. Set it there.

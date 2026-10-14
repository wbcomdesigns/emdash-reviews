# Writing a review as a visitor

**Included in Free.** WB Reviews has no paid version.

This page describes what your visitors see and what they can and cannot do.

## The form

| Field | Needed | Limit | Notes |
| --- | --- | --- | --- |
| Your rating | Yes | 1 to 5 stars | Chosen with the mouse or the keyboard. The stars are outlines until one is chosen, then fill up to it |
| Your name | Yes | 80 characters | Shown with the review |
| Your email | Only if you turned on **Ask guests for an email** | 200 characters | "Used only if we need to reach you. Never shown on the site." |
| Headline | No | 120 characters | Shown above the text |
| Your review | No | 1000 characters | "Up to 1000 characters. Stars alone are enough." |

Choose **Submit review** to send it. A visitor who forgets the stars sees "Choose a rating." A guest who forgets the name sees "Add your name."

After sending, the visitor sees "Thanks. Your review will show once it is approved."

## Who can write

It depends on **Who can leave a review** in [Settings](../settings/settings-reference.md):

| Setting | What a visitor sees |
| --- | --- |
| Anyone (default) | The form, with a name field. No account is needed |
| Anyone, for a signed-in member | The form without a name field. The review carries the member's account name |
| Signed-in members only | Guests see "Only members can review this page." with a **Sign in** link that brings them back to the page. Signed-in members see the form without a name field |

## One review per person per page

A visitor has one review on each page. Sending another one for the same page replaces the first. If the first is already live, it stays live and unchanged until you approve the new version.

How WB Reviews recognises a guest:

- It uses a scrambled form of the visitor's internet address, when your hosting passes it on. The address itself is never stored. Two guests on the same address, such as one office network, count as one person.
- When the hosting passes no address, it uses a small code saved in the visitor's browser. That is easier to get around, so protection is weaker. The Who can review tab says so.

## Spam protection

- A guest review always waits for your approval.
- Each visitor can send 8 reviews an hour. After that they see "Too many requests. Try again in an hour."
- Every form carries a hidden field that people never see. A robot fills it in and its review is refused.

## What a visitor cannot do

Visitors cannot edit or delete their own review, and they have no "My reviews" page. A member account page is planned for a later version. To remove a guest's reviews, use [delete by email](waiting-and-published.md#delete-a-guests-reviews-by-email).

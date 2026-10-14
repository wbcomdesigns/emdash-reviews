# Wording and look

**Included in Free.** WB Reviews has no paid version.

## Change the words visitors see

Every phrase on the reviews and the badge lives in one file your developer copied: `src/lib/reviews-strings.ts`. Change a phrase there and rebuild the site. For example:

```ts
heading: "Customer reviews",
submit: "Send my review",
thanksPending: "Thank you. We read every review before it goes live.",
```

This is also how you translate the reviews into another language. The file holds one language. Error messages are in the same file, so nothing a visitor reads is hidden elsewhere.

The admin screens (Waiting, Published and Settings) are in English and are not in this file.

## Match your theme

The reviews take their colours from your site's theme when they can:

- Stars use a star colour, and empty stars use a muted colour that stays readable.
- The bars and your reply's side line follow your theme's brand colour.
- Spacing and fonts follow the page they sit in. Right-to-left languages are supported.

To change the look only, edit `src/styles/reviews.css`. Its rules all start with the plugin's own markers, so they never change other parts of your site, and other plugins never change the reviews.

You can also change the heading for one page without editing the file. Your developer passes it when placing the component:

```astro
<Reviews collection="pages" id={page.data.id} heading="What clients say" />
```

## Several Wbcom plugins on one site

WB Reviews works on its own, and next to any other Wbcom plugin. They share two small files (`wbcom-kit.ts` and `wbcom-base.css`). Keep the copy with the higher number on its first line; each plugin works with a newer copy.

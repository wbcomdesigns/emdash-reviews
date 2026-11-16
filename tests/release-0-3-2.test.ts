import { afterEach, describe, expect, it } from "vitest";

import manifestText from "../emdash-plugin.jsonc?raw";
import myReviews from "../site-kit/components/MyReviews.astro?raw";
import reviewsKit from "../site-kit/components/Reviews.astro?raw";
import { admin, ana, ben, install, member, openSite, withPosts } from "./site";

let dispose: (() => Promise<void>) | undefined;
afterEach(async () => {
	await dispose?.();
	dispose = undefined;
});

type Row = Record<string, unknown>;
type Screen = { blocks: Row[]; toast?: { message: string; type: string } };

async function open() {
	const s = await openSite();
	dispose = s.dispose;
	await install(s.rt);
	const { live } = await withPosts(s.rt);
	const reviewId = (who: string) => `posts:${live}:${who}`;
	const write = (who: ReturnType<typeof member>, input: Row = {}) =>
		s.call("write", { collection: "posts", id: live, stars: 4, body: "Tasty.", ...input }, s.as(who));
	const decide = async (action: string, who: string) => {
		const row = await s.rt.inspect.storage.get<{ rev: string }>("reviews", reviewId(who));
		return (await s.call("admin", { type: "block_action", action_id: "decide", value: `${action}|${row!.rev}|${reviewId(who)}` }, { user: admin })) as Screen;
	};
	return { ...s, live, reviewId, write, decide };
}

describe("#79 rejecting a waiting review", () => {
	it("says it was rejected, not taken off the site", async () => {
		const { write, decide } = await open();
		await write(ana);
		const done = await decide("reject", "ana");
		expect(done.toast).toEqual({ message: "Review rejected. It will not be shown.", type: "success" });
	});
});

describe("#80 structured data", () => {
	const page = (id: string, pageType: string, canonical: string | null) => ({
		page: { url: "https://x.test/posts/good-soup", path: "/posts/good-soup", locale: null, kind: "content", pageType, title: "Good Soup", description: null, canonical, image: null, content: { collection: "posts", id, slug: "good-soup" } },
	});

	it("joins the article node EmDash core writes (same @id), and a WebPage elsewhere", async () => {
		const { rt, write, decide, live } = await open();
		await write(ana, { stars: 4 });
		await decide("approve", "ana");
		const onArticle = await rt.transport.invokeHook("page:metadata", page(live, "article", "https://x.test/posts/good-soup"));
		expect(onArticle).toMatchObject({
			kind: "jsonld",
			graph: { "@type": "BlogPosting", "@id": "https://x.test/posts/good-soup#article", aggregateRating: { ratingValue: 4, reviewCount: 1 } },
		});
		const elsewhere = await rt.transport.invokeHook("page:metadata", page(live, "post", null));
		expect(elsewhere).toMatchObject({ graph: { "@type": "WebPage", "@id": "https://x.test/posts/good-soup" } });
	});
});

describe("#70 a page deleted for good", () => {
	it("takes its reviews and rating with it; the trash keeps them", async () => {
		const { rt, write, decide, live, call } = await open();
		await write(ana, { stars: 5 });
		await write(ben, { stars: 2 });
		await decide("approve", "ana");
		const ours = async () => (await rt.inspect.storage.list<Row>("reviews")).filter((r) => r.data.entryId === live);

		await rt.transport.invokeHook("content:afterDelete", { collection: "posts", id: live, permanent: false });
		expect(await ours()).toHaveLength(2);
		expect(await rt.inspect.storage.get("ratings", `posts:${live}`)).toMatchObject({ live: false });

		await rt.transport.invokeHook("content:afterDelete", { collection: "posts", id: live, permanent: true });
		expect(await ours()).toHaveLength(0);
		expect(await rt.inspect.storage.get("ratings", `posts:${live}`)).toBeNull();
		expect((await rt.inspect.scheduledTasks()).filter((t) => String(t.name).startsWith("purge-"))).toHaveLength(0);
		// The site counts no longer hold them: nothing waiting.
		const widget = (await call("admin", { type: "page_load", page: "/waiting" }, { user: admin })) as Screen;
		expect(JSON.stringify(widget.blocks)).toMatch(/"label":"Waiting","value":"0"/);
	});
});

describe("#69 storage indexes", () => {
	it("declares a composite index for every query that filters and orders", () => {
		const text = manifestText.replace(/^\s*\/\/.*$/gm, "");
		const indexes = (JSON.parse(text) as { storage: { reviews: { indexes: unknown[] } } }).storage.reviews.indexes.map((i) => JSON.stringify(i));
		for (const shape of [
			["entry", "status", "has_text", "createdAt"],
			["entry", "status", "has_text", "stars"],
			["member_id", "createdAt"],
			["status", "createdAt"],
			["status", "pending_change", "createdAt"],
			["status", "publishedAt"],
		])
			expect(indexes).toContain(JSON.stringify(shape));
	});
});

describe("#77 moderation table at phone width", () => {
	it("puts Decision first and keeps the name and page cells short", async () => {
		const { write, call } = await open();
		const long = member("long");
		long.name = "Wolfeschlegelsteinhausenbergerdorff Montgomery-Featherstonehaugh";
		await write(long);
		const screen = (await call("admin", { type: "page_load", page: "/waiting" }, { user: admin })) as Screen;
		const table = screen.blocks.find((b) => b.type === "table") as { columns: Array<{ key: string }>; rows: Row[] };
		expect(table.columns[0]!.key).toBe("action");
		const author = String(table.rows[0]!.author).replace(/​/g, "");
		expect(author.length).toBeLessThanOrEqual(35);
		expect(author.endsWith("...")).toBe(true);
	});
});

describe("#78 line breaks in review text", () => {
	it("the kit prints review text and replies in a block that keeps line breaks", () => {
		expect(reviewsKit).toContain('<p class="wbr-text">${esc(item.body)}</p>');
		expect(reviewsKit).toContain('<p class="wbr-text">${esc(item.owner_reply)}</p>');
		expect(myReviews).toContain('<p class="wbr-text">');
		// The .wbr-text { white-space: pre-line } rule in styles/reviews.css is checked in the browser walk (vitest empties CSS imports).
	});

	it("the engine stores the line breaks the writer typed", async () => {
		const { rt, write, reviewId } = await open();
		await write(ana, { body: "Line one.\n\nSecond paragraph." });
		expect(await rt.inspect.storage.get("reviews", reviewId("ana"))).toMatchObject({ body: "Line one.\n\nSecond paragraph." });
	});
});

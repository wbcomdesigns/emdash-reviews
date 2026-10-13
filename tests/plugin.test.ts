import { afterEach, describe, expect, it } from "vitest";

import { createPluginRuntimeTestHost } from "@emdash-cms/plugin-test";

let dispose: (() => Promise<void>) | undefined;

afterEach(async () => {
	await dispose?.();
	dispose = undefined;
});

const member = (id: string, role = 10) => ({
	id,
	email: `${id}@example.com`,
	name: id,
	role,
	createdAt: "2026-01-01T00:00:00.000Z",
});
const ana = member("ana");
const ben = member("ben");

/** A real site with a posts collection, one public post and one draft. */
async function open() {
	const rt = await createPluginRuntimeTestHost();
	await rt.fixtures.collection({
		slug: "posts",
		label: "Posts",
		labelSingular: "Post",
		urlPattern: "/posts/{slug}",
		supports: ["drafts", "revisions"],
		fields: [{ slug: "title", label: "Title", type: "string", required: true }],
	} as never);
	const live = await rt.fixtures.content("posts", { data: { title: "Good Soup" }, slug: "good-soup", status: "published" } as never);
	const draft = await rt.fixtures.content("posts", { data: { title: "Secret Draft" }, slug: "secret-draft" } as never);
	const call = rt.transport.invokeRoute.bind(rt.transport);
	const reviewId = (who: string) => `posts:${live.id}:${who}`;
	const decide = async (action: string, who: string) => {
		const row = await rt.inspect.storage.get<{ rev: string }>("reviews", reviewId(who));
		return call("admin", { type: "block_action", action_id: "decide", value: `${action}|${row!.rev}|${reviewId(who)}` });
	};
	const write = (who: ReturnType<typeof member>, input: Record<string, unknown> = {}) =>
		call("write", { collection: "posts", id: live.id, stars: 4, body: "Tasty.", ...input }, { method: "POST", user: who });
	dispose = () => rt.dispose();
	return { rt, call, live: live.id, draft: draft.id, reviewId, decide, write };
}

describe("guests", () => {
	it("are refused on member routes and can read public ones", async () => {
		const { call, live } = await open();
		for (const route of ["write", "mine"]) {
			expect(await call(route, { collection: "posts", id: live, body: "x" }, { method: "POST" }), route).toMatchObject({
				ok: false,
				error: { code: "SIGN_IN_REQUIRED" },
			});
		}
		expect(await call("list", { collection: "posts", id: live }, { method: "GET" })).toMatchObject({ ok: true, count: 0 });
	});
});

describe("writing a review", () => {
	it("waits for approval and stays out of the public list and the rating", async () => {
		const { call, write, live } = await open();
		expect(await write(ana)).toMatchObject({ ok: true, status: "pending" });
		expect(await call("list", { collection: "posts", id: live }, { method: "GET" })).toMatchObject({ items: [], count: 0 });
	});

	it("ignores a member id in the request and keeps one review per member", async () => {
		const { rt, write, reviewId } = await open();
		await write(ana, { member_id: "ben", body: "First." });
		await write(ana, { body: "Second." });
		const all = await rt.inspect.storage.list("reviews");
		expect(all.map((row) => row.id)).toEqual([reviewId("ana")]);
		expect(all[0].data).toMatchObject({ member_id: "ana", body: "Second." });
	});

	it("is refused on a draft, a missing entry and a collection that is not open", async () => {
		const { call, draft } = await open();
		const post = { method: "POST", user: ana };
		for (const at of [
			{ collection: "posts", id: draft },
			{ collection: "posts", id: "no-such-entry" },
			{ collection: "pages", id: "anything" },
		]) {
			expect(await call("write", { ...at, body: "x" }, post), JSON.stringify(at)).toMatchObject({
				ok: false,
				error: { code: "NOT_FOUND" },
			});
		}
	});

	it("caps the text at what the moderation table shows", async () => {
		const { rt, write, reviewId } = await open();
		await write(ana, { body: "x".repeat(5000), title: "t".repeat(500) });
		const saved = await rt.inspect.storage.get<{ body: string; title: string }>("reviews", reviewId("ana"));
		expect(saved!.body).toHaveLength(1000);
		expect(saved!.title).toHaveLength(120);
	});

	it("publishes at once when moderation is off", async () => {
		const { call, write, live } = await open();
		await call("admin", {
			type: "form_submit",
			action_id: "save_moderation",
			values: { require_moderation: false },
			page: "/settings",
		});
		expect(await write(ana, { stars: 5 })).toMatchObject({ status: "published" });
		expect(await call("list", { collection: "posts", id: live }, { method: "GET" })).toMatchObject({ average: 5, count: 1 });
	});

	it("limits a member to eight writes an hour", async () => {
		const { write } = await open();
		for (let n = 0; n < 8; n += 1) expect(await write(ana)).toMatchObject({ ok: true });
		expect(await write(ana)).toMatchObject({ ok: false, error: { code: "RATE_LIMITED" } });
	});
});

describe("moderation and rating", () => {
	it("updates the rating on approve, on remove, and when the member rewrites or erases", async () => {
		const { call, write, decide, live } = await open();
		const rating = async () => {
			const got = (await call("list", { collection: "posts", id: live }, { method: "GET" })) as { average: number; count: number };
			return [got.average, got.count];
		};
		await write(ana, { stars: 5 });
		await write(ben, { stars: 2 });
		await decide("approve", "ana");
		expect(await rating()).toEqual([5, 1]);
		await decide("approve", "ben");
		expect(await rating()).toEqual([3.5, 2]);

		// A rewrite goes back to pending and leaves the rating at once.
		await write(ben, { stars: 1 });
		expect(await rating()).toEqual([5, 1]);

		await call("mine", {}, { method: "DELETE", user: ana });
		expect(await rating()).toEqual([0, 0]);
	});

	it("refuses to approve a review rewritten after the page loaded, and a second click", async () => {
		const { rt, call, write, reviewId } = await open();
		await write(ana, { body: "Polite first draft." });
		const seen = (await rt.inspect.storage.get<{ rev: string }>("reviews", reviewId("ana")))!.rev;
		await write(ana, { body: "Swapped after the admin looked." });
		const stale = { type: "block_action", action_id: "decide", value: `approve|${seen}|${reviewId("ana")}` };
		expect(await call("admin", stale)).toMatchObject({ toast: { type: "error" } });
		expect(await rt.inspect.storage.get("reviews", reviewId("ana"))).toMatchObject({ status: "pending" });
	});

	it("renders the admin page with rows in both tables", async () => {
		const { rt, write, decide } = await open();
		await write(ana);
		await write(ben);
		await decide("approve", "ana");
		const page = await rt.admin.loadPage("/queue");
		expect(page.blocks.filter((block) => block.type === "table")).toHaveLength(2);
		expect(JSON.stringify(page.blocks)).not.toContain("save_settings");
		expect(JSON.stringify(page.blocks)).not.toContain("save_collections");
	});
});

describe("privacy", () => {
	it("shows a member only their own reviews and names only public pages", async () => {
		const { call, write } = await open();
		await write(ana, { body: "Mine." });
		await write(ben, { body: "Theirs." });
		const mine = (await call("mine", { member_id: "ben" }, { method: "GET", user: ana })) as { items: Array<Record<string, unknown>> };
		expect(mine.items).toHaveLength(1);
		expect(mine.items[0]).toMatchObject({ body: "Mine.", entry_title: "Good Soup" });
		expect(mine.items[0]).not.toHaveProperty("member_id");
	});

	it("never returns member ids or version tokens in the public list", async () => {
		const { call, write, decide, live } = await open();
		await write(ana);
		await decide("approve", "ana");
		const got = (await call("list", { collection: "posts", id: live }, { method: "GET" })) as { items: Array<Record<string, unknown>> };
		expect(Object.keys(got.items[0]).sort()).toEqual(["author", "body", "createdAt", "stars", "title"]);
	});
});

describe("settings", () => {
	it("lists the site's content types by their normal names", async () => {
		const { rt } = await open();
		await rt.fixtures.collection({
			slug: "pages",
			label: "Pages",
			labelSingular: "Page",
			urlPattern: "/{slug}",
			supports: ["drafts"],
			fields: [{ slug: "title", label: "Title", type: "string", required: true }],
		} as never);
		const page = await rt.admin.loadPage("/settings");
		const form = page.blocks.find((block) => block.type === "form" && (block as { block_id?: string }).block_id === "settings_collections") as {
			fields?: Array<{ options?: Array<{ label: string; value: string }>; initial_value?: string[] }>;
		};
		const options = form?.fields?.[0]?.options ?? [];
		expect(options.map((item) => item.label).sort()).toEqual(["Pages", "Posts"]);
		expect(options.every((item) => item.label !== item.value || item.label === "Posts" || item.label === "Pages")).toBe(true);
		expect(form?.fields?.[0]?.initial_value).toEqual(["posts"]);
	});

	it("opens a second type and refuses reviews on an unticked type", async () => {
		const { rt, call, live } = await open();
		await rt.fixtures.collection({
			slug: "pages",
			label: "Pages",
			labelSingular: "Page",
			urlPattern: "/{slug}",
			supports: ["drafts"],
			fields: [{ slug: "title", label: "Title", type: "string", required: true }],
		} as never);
		const page = await rt.fixtures.content("pages", { data: { title: "About" }, slug: "about", status: "published" } as never);
		await call("admin", {
			type: "form_submit",
			action_id: "save_collections",
			values: { collections: ["pages"] },
			page: "/settings",
		});
		expect(await call("write", { collection: "posts", id: live, body: "x" }, { method: "POST", user: ana })).toMatchObject({
			ok: false,
			error: { code: "NOT_FOUND" },
		});
		expect(await call("write", { collection: "pages", id: page.id, body: "Nice." }, { method: "POST", user: ana })).toMatchObject({
			ok: true,
		});
	});

	it("says so when no type is ticked, and does not break on a removed type", async () => {
		const { rt, call, live } = await open();
		await call("admin", {
			type: "form_submit",
			action_id: "save_collections",
			values: { collections: ["gone", "posts"] },
			page: "/settings",
		});
		const kept = await rt.admin.loadPage("/settings");
		expect(JSON.stringify(kept.blocks)).toContain("Posts");
		expect(JSON.stringify(kept.blocks)).not.toContain("gone");
		await call("admin", {
			type: "form_submit",
			action_id: "save_collections",
			values: { collections: [] },
			page: "/settings",
		});
		const empty = await rt.admin.loadPage("/settings");
		expect(JSON.stringify(empty.blocks)).toContain("Reviews are closed");
		expect(await call("write", { collection: "posts", id: live, body: "x" }, { method: "POST", user: ana })).toMatchObject({
			ok: false,
			error: { code: "NOT_FOUND" },
		});
	});

	it("saves who, guest email and the notice, and they survive a reload", async () => {
		const { call, rt } = await open();
		await call("admin", {
			type: "form_submit",
			action_id: "save_who",
			values: { who: "members" },
			page: "/settings",
		});
		await call("admin", {
			type: "form_submit",
			action_id: "save_guest_email",
			values: { ask_guest_email: true },
			page: "/settings",
		});
		await call("admin", {
			type: "form_submit",
			action_id: "save_notify",
			values: { notify: false, notify_to: "owner@example.com" },
			page: "/settings",
		});
		const page = await rt.admin.loadPage("/settings");
		const json = JSON.stringify(page.blocks);
		expect(json).toContain('"initial_value":"members"');
		expect(json).toContain("owner@example.com");
		expect(json).toMatch(/"action_id":"ask_guest_email"[^}]*"initial_value":true/);
		expect(json).toMatch(/"action_id":"notify"[^}]*"initial_value":false/);
	});
});

describe("structured data", () => {
	it("adds the rating to a rated page and nothing to an unrated one", async () => {
		const { rt, write, decide, live, draft } = await open();
		const page = (id: string) => ({
			page: { url: "https://x.test/posts/good-soup", path: "/posts/good-soup", locale: null, kind: "content", pageType: "post", title: "Good Soup", description: null, canonical: null, image: null, content: { collection: "posts", id, slug: "good-soup" } },
		});
		expect(await rt.transport.invokeHook("page:metadata", page(live))).toBeNull();
		await write(ana, { stars: 4 });
		await decide("approve", "ana");
		expect(await rt.transport.invokeHook("page:metadata", page(live))).toMatchObject({
			kind: "jsonld",
			graph: { aggregateRating: { ratingValue: 4, reviewCount: 1 } },
		});
		expect(await rt.transport.invokeHook("page:metadata", page(draft))).toBeNull();
	});
});

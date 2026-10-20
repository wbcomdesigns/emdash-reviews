// Must load before anything that starts the test host: it patches the sandbox bridge.
import { countBridgeCalls, MAX_BRIDGE_CALLS } from "./bridge-count";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { member, openSite } from "./site";

/**
 * Bridge calls per plugin call, at the worst realistic case of each entry point.
 *
 * On Cloudflare a sandboxed plugin call gets 10 subrequests and every bridge call is one, so an
 * entry over MAX_BRIDGE_CALLS (9) fails part way there. This file measures, it does not fix: each
 * test asserts the count measured on 0.2.2, so a change in either direction shows up here.
 *
 * One busy site is seeded once and the tests run in order. Each test sets up the state it needs
 * right before it measures; fixture writes are not counted.
 */
const MEASURED: Record<string, number> = {
	"hook plugin:install": 1,
	"hook plugin:activate": 1,
	"cron notify (on, waiting)": 6,
	"hook page:metadata (rated)": 1,
	"route health": 3,
	"route list (500 reviews, page 50)": 8,
	"route list (500 reviews, page 50, 0.2.0 rating row)": 15,
	"route summary (50 rated cards)": 101,
	"route summary (50 cards, 20 lost rating rows)": 211,
	"route me": 0,
	"route mine GET (100 reviews)": 201,
	"route write (first, approval on, 500 reviews)": 13,
	"route write (change published, approval on)": 7,
	"route write (approval off, 500 reviews)": 14,
	"route write (rate limited)": 3,
	"route mine DELETE (100 reviews)": 203,
	"route write_guest (first guest, 500 reviews)": 17,
	"route write_guest (salt exists, 500 reviews)": 16,
	"admin page_load /waiting": 57,
	"admin page_load /published": 63,
	"admin page_load /settings": 8,
	"admin widget waiting": 2,
	"admin form find (waiting)": 61,
	"admin block page (published p2)": 45,
	"admin table sort click (published)": 63,
	"admin decide read (waiting)": 60,
	"admin decide ask_delete (published)": 66,
	"admin decide reply (published)": 66,
	"admin decide approve (500 reviews)": 64,
	"admin decide reject (500 reviews)": 66,
	"admin decide approve change": 61,
	"admin decide reject change": 61,
	"admin decide stale stamp": 62,
	"admin decide missing review": 62,
	"admin decide delete (500 reviews)": 70,
	"admin decide unreply": 63,
	"admin form save_reply": 63,
	"admin form delete_email (30 + 5 edits)": 109,
	"admin block kit_done": 58,
	"admin block kit_again": 58,
	"admin form save_collections": 10,
	"admin form save_moderation": 9,
	"admin form save_who (with guest email)": 10,
	"admin form save_guest_email": 9,
	"admin form save_notify": 10,
	"admin block test_notice": 13,
};

/** Every entry over MAX_BRIDGE_CALLS on 0.2.2, with its count. */
const KNOWN_OVER: Array<[string, number]> = [
	["route list (500 reviews, page 50, 0.2.0 rating row)", 15],
	["route summary (50 rated cards)", 101],
	["route summary (50 cards, 20 lost rating rows)", 211],
	["route mine GET (100 reviews)", 201],
	["route write (first, approval on, 500 reviews)", 13],
	["route write (approval off, 500 reviews)", 14],
	["route mine DELETE (100 reviews)", 203],
	["route write_guest (first guest, 500 reviews)", 17],
	["route write_guest (salt exists, 500 reviews)", 16],
	["admin page_load /waiting", 57],
	["admin page_load /published", 63],
	["admin form find (waiting)", 61],
	["admin block page (published p2)", 45],
	["admin table sort click (published)", 63],
	["admin decide read (waiting)", 60],
	["admin decide ask_delete (published)", 66],
	["admin decide reply (published)", 66],
	["admin decide approve (500 reviews)", 64],
	["admin decide reject (500 reviews)", 66],
	["admin decide approve change", 61],
	["admin decide reject change", 61],
	["admin decide stale stamp", 62],
	["admin decide missing review", 62],
	["admin decide delete (500 reviews)", 70],
	["admin decide unreply", 63],
	["admin form save_reply", 63],
	["admin form delete_email (30 + 5 edits)", 109],
	["admin block kit_done", 58],
	["admin block kit_again", 58],
	["admin form save_collections", 10],
	["admin form save_who (with guest email)", 10],
	["admin form save_notify", 10],
	["admin block test_notice", 13],
];

const POSTS = 120;
const BUSY_REVIEWS = 500;
const PENDING = 300;
const CHANGED = 20;
const HEAVY_MEMBER_REVIEWS = 100;
const GUEST_EMAIL = "sam@example.com";
const GUEST_EMAIL_REVIEWS = 30;
const GUEST_EMAIL_EDITS = 5;
const LOST = 20;

const fromIp = (ip: string, method = "POST") => ({ method, meta: { ip, userAgent: null, referer: null, geo: null } });
const as = (id: string, method = "POST") => ({ method, user: member(id) });

type Row = Record<string, unknown>;
let s: Awaited<ReturnType<typeof openSite>>;
let posts: string[] = [];
const seen = new Map<string, number>();

let clock = Date.parse("2026-01-01T00:00:00.000Z");
const nextIso = () => new Date((clock += 60_000)).toISOString();

function review(post: string, who: string, n: number, extra: Row = {}): Row {
	const at = nextIso();
	return {
		entry: `posts:${post}`,
		collection: "posts",
		entryId: post,
		member_id: who,
		author: who,
		stars: (n % 5) + 1,
		title: `Title ${n}`,
		body: `Body ${n}`,
		has_text: true,
		status: "published",
		publishedAt: at,
		rev: `rev-${who}-${post}`,
		createdAt: at,
		guest: false,
		email: "",
		visitor: "",
		pending_change: false,
		pending_title: "",
		pending_body: "",
		owner_reply: "",
		owner_reply_at: "",
		...extra,
	};
}

function ratingFor(post: string, published: Row[]): Row {
	const stars = published.map((row) => Number(row.stars));
	return {
		collection: "posts",
		entryId: post,
		average: Math.round((stars.reduce((a, b) => a + b, 0) / stars.length) * 10) / 10,
		count: stars.length,
		bars: [1, 2, 3, 4, 5].map((n) => stars.filter((v) => v === n).length),
		text_count: published.filter((row) => row.has_text === true).length,
	};
}

async function measure<T>(name: string, run: () => Promise<T>): Promise<T> {
	const { result, calls } = await countBridgeCalls(run);
	seen.set(name, calls.length);
	expect.soft(calls.length, `${name} => ${calls.join(",")}`).toBe(MEASURED[name]);
	return result;
}

const admin = (input: Row) => s.call("admin", input);
const stamp = (action: string, id: string, rev: string, kind = "waiting") => `${action}|${rev}|${id}|${kind}|1|`;
const reviewIdOf = (post: string, who: string) => `posts:${post}:${who}`;

beforeAll(async () => {
	s = await openSite();
	await s.rt.fixtures.collection({
		slug: "posts",
		label: "Posts",
		labelSingular: "Post",
		urlPattern: "/posts/{slug}",
		supports: ["drafts", "revisions"],
		fields: [{ slug: "title", label: "Title", type: "string", required: true }],
	} as never);
	for (let i = 0; i < POSTS; i++) {
		const item = await s.rt.fixtures.content("posts", { data: { title: `Post ${i}` }, slug: `post-${i}`, status: "published" } as never);
		posts.push(item.id);
	}
	const rowsById = new Map<string, Row>();
	const put = (post: string, who: string, n: number, extra: Row = {}) => rowsById.set(reviewIdOf(post, who), review(post, who, n, extra));
	// The busiest post: 500 published text reviews, oldest on the site.
	for (let n = 0; n < BUSY_REVIEWS; n++) put(posts[0]!, `busy${n}`, n);
	// Two published reviews on every other post.
	for (let i = 1; i < POSTS; i++) for (const who of ["pa", "pb"]) put(posts[i]!, who, i);
	// A member with the most reviews My reviews reads (one page of 100), each on its own post.
	for (let i = 1; i <= HEAVY_MEMBER_REVIEWS; i++) put(posts[i]!, "heavy", i);
	// A guest whose email is on 30 published reviews, and in 5 waiting edits on other people's reviews.
	for (let i = 1; i <= GUEST_EMAIL_REVIEWS; i++) put(posts[i]!, `v-sam${i}`, i, { guest: true, email: GUEST_EMAIL });
	for (let i = 31; i < 31 + GUEST_EMAIL_EDITS; i++) {
		const id = reviewIdOf(posts[i]!, "pa");
		rowsById.set(id, { ...rowsById.get(id)!, pending_change: true, pending_stars: 2, pending_title: "Edit", pending_body: "Edit", pending_author: "Sam", pending_email: GUEST_EMAIL });
	}
	// Published reviews with a change waiting.
	for (let i = 40; i < 40 + CHANGED; i++) {
		const id = reviewIdOf(posts[i]!, "pb");
		rowsById.set(id, { ...rowsById.get(id)!, pending_change: true, pending_stars: 1, pending_title: "Changed", pending_body: "Changed", pending_author: "pb" });
	}
	// 300 waiting reviews, the newest on the site, round robin so each list page names 25 different posts.
	for (let n = 0; n < PENDING; n++) put(posts[1 + (n % (POSTS - 1))]!, `wait${n}`, n, { status: "pending", publishedAt: "" });
	for (const [id, row] of rowsById) await s.rt.fixtures.plugin.storage("reviews", id, row);
	// A rating row per post, except the last 20: their row was deleted by 0.2.0 while published reviews remained.
	for (let i = 0; i < POSTS - LOST; i++) {
		const post = posts[i]!;
		const published = [...rowsById.values()].filter((row) => row.entryId === post && row.status === "published");
		await s.rt.fixtures.plugin.storage("ratings", `posts:${post}`, ratingFor(post, published));
	}
}, 600_000);

afterAll(async () => {
	await s?.dispose();
});

describe("hooks and cron", () => {
	it("plugin:install and plugin:activate schedule the hourly notice", async () => {
		await measure("hook plugin:install", () => s.rt.transport.invokeHook("plugin:install", {}));
		await measure("hook plugin:activate", () => s.rt.transport.invokeHook("plugin:activate", {}));
	});

	it("cron notify with the notice on, an address, and reviews waiting", async () => {
		await s.rt.fixtures.plugin.setting("notify", true);
		await s.rt.fixtures.plugin.setting("notify_to", "owner@example.com");
		await measure("cron notify (on, waiting)", () => s.rt.transport.invokeHook("cron", { name: "notify" }));
		await s.rt.fixtures.plugin.setting("notify", false);
	});

	it("page:metadata on a rated page", async () => {
		const page = {
			page: {
				url: "https://x.test/posts/post-0",
				path: "/posts/post-0",
				locale: null,
				kind: "content",
				pageType: "post",
				title: "Post 0",
				description: null,
				canonical: null,
				image: null,
				content: { collection: "posts", id: posts[0], slug: "post-0" },
			},
		};
		expect(await measure("hook page:metadata (rated)", () => s.rt.transport.invokeHook("page:metadata", page))).toMatchObject({ kind: "jsonld" });
	});
});

describe("public routes", () => {
	it("health", async () => {
		await measure("route health", () => s.call("health", {}, fromIp("198.51.100.7", "GET")));
	});

	it("list: page 50 of the busiest post", async () => {
		const result = await measure("route list (500 reviews, page 50)", () =>
			s.call("list", { collection: "posts", id: posts[0], page: 50, sort: "lowest" }, { method: "GET" }),
		);
		expect(result).toMatchObject({ ok: true, page: 50, count: BUSY_REVIEWS });
	});

	it("list: page 50 of the busiest post, rating row from 0.2.0 (no bars)", async () => {
		const row = await s.rt.inspect.storage.get<Row>("ratings", `posts:${posts[0]}`);
		await s.rt.fixtures.plugin.storage("ratings", `posts:${posts[0]}`, { ...row, bars: undefined });
		await measure("route list (500 reviews, page 50, 0.2.0 rating row)", () =>
			s.call("list", { collection: "posts", id: posts[0], page: 50 }, { method: "GET" }),
		);
	});

	it("summary: 50 rated cards", async () => {
		const result = await measure("route summary (50 rated cards)", () =>
			s.call("summary", { collection: "posts", ids: posts.slice(0, 50).join(",") }, { method: "GET" }),
		);
		expect(Object.keys((result as { ratings: Row }).ratings)).toHaveLength(50);
	});

	it("summary: 50 cards, 20 of them with a rating row lost under 0.2.0", async () => {
		const result = await measure("route summary (50 cards, 20 lost rating rows)", () =>
			s.call("summary", { collection: "posts", ids: posts.slice(POSTS - 50).join(",") }, { method: "GET" }),
		);
		expect(Object.keys((result as { ratings: Row }).ratings)).toHaveLength(50);
	});
});

describe("member routes", () => {
	it("me", async () => {
		await measure("route me", () => s.call("me", {}, as("ana", "GET")));
	});

	it("mine GET: a member with 100 reviews on 100 posts", async () => {
		const result = await measure("route mine GET (100 reviews)", () => s.call("mine", {}, as("heavy", "GET")));
		expect((result as { items: Row[] }).items).toHaveLength(HEAVY_MEMBER_REVIEWS);
	});

	it("write: first review on the busiest post, approval on", async () => {
		expect(
			await measure("route write (first, approval on, 500 reviews)", () =>
				s.call("write", { collection: "posts", id: posts[0], stars: 4, body: "Tasty." }, as("ana")),
			),
		).toMatchObject({ ok: true, status: "pending" });
	});

	it("write: change a published review, approval on", async () => {
		expect(
			await measure("route write (change published, approval on)", () =>
				s.call("write", { collection: "posts", id: posts[0], stars: 2, body: "Changed." }, as("busy1")),
			),
		).toMatchObject({ ok: true, status: "pending" });
	});

	it("write: approval off publishes at once and rebuilds the rating", async () => {
		await s.rt.fixtures.plugin.setting("require_moderation", false);
		expect(
			await measure("route write (approval off, 500 reviews)", () =>
				s.call("write", { collection: "posts", id: posts[0], stars: 5, body: "Great." }, as("ben")),
			),
		).toMatchObject({ ok: true, status: "published" });
		await s.rt.fixtures.plugin.setting("require_moderation", true);
	});

	it("write: rate limit hit", async () => {
		await s.rt.fixtures.plugin.kv("rate:write:carl", `${Date.now()}|8`);
		expect(
			await measure("route write (rate limited)", () => s.call("write", { collection: "posts", id: posts[0], stars: 4 }, as("carl"))),
		).toMatchObject({ ok: false, error: { code: "RATE_LIMITED" } });
	});

	it("mine DELETE: a member with 100 reviews on 100 posts", async () => {
		const result = await measure("route mine DELETE (100 reviews)", () => s.call("mine", {}, as("heavy", "DELETE")));
		expect(result).toMatchObject({ ok: true, erased: HEAVY_MEMBER_REVIEWS });
	});
});

describe("guest route", () => {
	it("write_guest: first guest on the site (salt made), busiest post", async () => {
		await s.rt.fixtures.plugin.setting("ask_guest_email", true);
		expect(
			await measure("route write_guest (first guest, 500 reviews)", () =>
				s.call("write_guest", { collection: "posts", id: posts[0], stars: 4, name: "Kim", email: "kim@example.com", body: "Nice." }, fromIp("203.0.113.5")),
			),
		).toMatchObject({ ok: true, status: "pending" });
	});

	it("write_guest: a later guest, busiest post", async () => {
		expect(
			await measure("route write_guest (salt exists, 500 reviews)", () =>
				s.call("write_guest", { collection: "posts", id: posts[0], stars: 3, name: "Lee", email: "lee@example.com", body: "Fine." }, fromIp("203.0.113.6")),
			),
		).toMatchObject({ ok: true, status: "pending" });
		await s.rt.fixtures.plugin.setting("ask_guest_email", false);
	});
});

describe("admin pages and widget", () => {
	it("page loads", async () => {
		await measure("admin page_load /waiting", () => s.rt.admin.loadPage("/waiting"));
		await measure("admin page_load /published", () => s.rt.admin.loadPage("/published"));
		await measure("admin page_load /settings", () => s.rt.admin.loadPage("/settings"));
		await measure("admin widget waiting", () => s.rt.admin.loadWidget("waiting"));
	});
});

describe("admin actions", () => {
	it("find and paging", async () => {
		await measure("admin form find (waiting)", () => admin({ type: "form_submit", action_id: "find", page: "/waiting", values: { q: "Body" } }));
		await measure("admin block page (published p2)", () => admin({ type: "block_action", action_id: "page", page: "/published", value: "published|2|" }));
		// The table's page_action_id fires on a column sort click (value { sort }); with no next_cursor there is no load more.
		await measure("admin table sort click (published)", () =>
			admin({ type: "block_action", action_id: "published_page", page: "/published", value: { sort: { key: "stars", dir: "asc" } } }),
		);
	});

	it("decide read, ask_delete and reply open the review over the list", async () => {
		const id = reviewIdOf(posts[5]!, "pa");
		const rev = `rev-pa-${posts[5]}`;
		await measure("admin decide read (waiting)", () => admin({ type: "block_action", action_id: "decide", page: "/waiting", value: stamp("read", id, rev) }));
		await measure("admin decide ask_delete (published)", () =>
			admin({ type: "block_action", action_id: "decide", page: "/published", value: stamp("ask_delete", id, rev, "published") }),
		);
		await measure("admin decide reply (published)", () =>
			admin({ type: "block_action", action_id: "decide", page: "/published", value: stamp("reply", id, rev, "published") }),
		);
	});

	it("decide approve and reject on the busiest post", async () => {
		const pending = (who: string) => review(posts[0]!, who, 1, { status: "pending", publishedAt: "", rev: `rev-${who}` });
		await s.rt.fixtures.plugin.storage("reviews", reviewIdOf(posts[0]!, "dx1"), pending("dx1"));
		await s.rt.fixtures.plugin.storage("reviews", reviewIdOf(posts[0]!, "dx2"), pending("dx2"));
		expect(
			await measure("admin decide approve (500 reviews)", () =>
				admin({ type: "block_action", action_id: "decide", page: "/waiting", value: stamp("approve", reviewIdOf(posts[0]!, "dx1"), "rev-dx1") }),
			),
		).toMatchObject({ toast: { message: "Review published." } });
		await measure("admin decide reject (500 reviews)", () =>
			admin({ type: "block_action", action_id: "decide", page: "/waiting", value: stamp("reject", reviewIdOf(posts[0]!, "dx2"), "rev-dx2") }),
		);
	});

	it("decide approve and reject a waiting change", async () => {
		const id = (i: number) => reviewIdOf(posts[i]!, "pb");
		const rev = async (i: number) => String((await s.rt.inspect.storage.get<Row>("reviews", id(i)))!.rev);
		await measure("admin decide approve change", async () =>
			admin({ type: "block_action", action_id: "decide", page: "/waiting", value: stamp("approve", id(40), await rev(40)) }),
		);
		await measure("admin decide reject change", async () =>
			admin({ type: "block_action", action_id: "decide", page: "/waiting", value: stamp("reject", id(41), await rev(41)) }),
		);
	});

	it("decide delete and unreply, a stale stamp, a missing review", async () => {
		const id = reviewIdOf(posts[0]!, "busy10");
		const rev = String((await s.rt.inspect.storage.get<Row>("reviews", id))!.rev);
		await measure("admin decide stale stamp", () => admin({ type: "block_action", action_id: "decide", page: "/published", value: stamp("delete", id, "old", "published") }));
		await measure("admin decide missing review", () =>
			admin({ type: "block_action", action_id: "decide", page: "/published", value: stamp("delete", "posts:none:x", "old", "published") }),
		);
		await measure("admin decide delete (500 reviews)", () => admin({ type: "block_action", action_id: "decide", page: "/published", value: stamp("delete", id, rev, "published") }));
		const replied = reviewIdOf(posts[6]!, "pa");
		const row = (await s.rt.inspect.storage.get<Row>("reviews", replied))!;
		await s.rt.fixtures.plugin.storage("reviews", replied, { ...row, owner_reply: "Thanks", owner_reply_at: nextIso(), rev: "rev-reply" });
		await measure("admin decide unreply", () => admin({ type: "block_action", action_id: "decide", page: "/published", value: stamp("unreply", replied, "rev-reply", "published") }));
	});

	it("save a reply", async () => {
		await measure("admin form save_reply", () =>
			admin({ type: "form_submit", action_id: `save_reply|${reviewIdOf(posts[7]!, "pa")}`, page: "/published", values: { body: "Thank you." } }),
		);
	});

	it("delete a guest's reviews by email: 30 reviews on 30 posts, 5 waiting edits", async () => {
		const result = await measure("admin form delete_email (30 + 5 edits)", () =>
			admin({ type: "form_submit", action_id: "delete_email", page: "/published", values: { email: GUEST_EMAIL } }),
		);
		expect(result).toMatchObject({ toast: { type: "success" } });
	});

	it("setup kit buttons", async () => {
		await measure("admin block kit_done", () => admin({ type: "block_action", action_id: "kit_done", page: "/waiting" }));
		await measure("admin block kit_again", () => admin({ type: "block_action", action_id: "kit_again", page: "/waiting" }));
	});

	it("settings forms", async () => {
		await measure("admin form save_collections", () => admin({ type: "form_submit", action_id: "save_collections", page: "/settings", values: { collections: ["posts"] } }));
		await measure("admin form save_moderation", () => admin({ type: "form_submit", action_id: "save_moderation", page: "/settings", values: { require_moderation: true } }));
		await measure("admin form save_who (with guest email)", () =>
			admin({ type: "form_submit", action_id: "save_who", page: "/settings", values: { who: "anyone", ask_guest_email: false } }),
		);
		await measure("admin form save_guest_email", () => admin({ type: "form_submit", action_id: "save_guest_email", page: "/settings", values: { ask_guest_email: false } }));
		await measure("admin form save_notify", () =>
			admin({ type: "form_submit", action_id: "save_notify", page: "/settings", values: { notify: true, notify_to: "owner@example.com" } }),
		);
	});

	it("send a test notice", async () => {
		await measure("admin block test_notice", () => admin({ type: "block_action", action_id: "test_notice", page: "/settings" }));
	});
});

describe("budget", () => {
	it("lists every entry over the Cloudflare budget", () => {
		const over = [...seen].filter(([, n]) => n > MAX_BRIDGE_CALLS);
		expect(Object.fromEntries(over)).toEqual(Object.fromEntries(KNOWN_OVER));
	});
});

// Must load before anything that starts the test host: it patches the sandbox bridge.
import { countBridgeCalls, MAX_BRIDGE_CALLS } from "./bridge-count";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { member, openSite } from "./site";

/**
 * Bridge calls per plugin call, at the worst realistic case of each entry point.
 *
 * On Cloudflare a sandboxed plugin call gets 10 subrequests and every bridge call is one, so an
 * entry over MAX_BRIDGE_CALLS (9) fails part way there. Each test asserts the count measured on
 * 0.3.0, so a change in either direction shows up here, and every count is at most MAX_BRIDGE_CALLS.
 *
 * One busy site is seeded once, shaped as 0.2.2 left it (rating rows from 0.2.1 and 0.2.0, 20 of
 * them lost), and the tests run in order: visitor routes on that data, then the upgrade run step by
 * step through admin loads, then every entry point on the upgraded site. Fixture writes are not counted.
 */
const MEASURED: Record<string, number> = {
	"hook plugin:install": 3,
	"hook plugin:activate": 1,
	"route health": 1,
	"route list (500 reviews, page 50, 0.2.2 data)": 8,
	"route list (500 reviews, page 50, 0.2.0 rating row)": 8,
	"route summary (50 rated cards, 0.2.2 data)": 2,
	"route summary (50 cards, 20 lost rating rows)": 2,
	"cron notify (0.2.2 data, counts the site)": 9,
	"admin page_load /waiting (upgrade step, worst)": 8,
	"cron notify (upgrade step)": 6,
	"admin block upgrade (Continue, worst)": 8,
	"cron notify (on, waiting)": 5,
	"hook page:metadata (rated)": 1,
	"hook content:afterUnpublish": 1,
	"hook content:afterPublish": 1,
	"hook content:afterDelete": 1,
	"route list (500 reviews, page 50)": 8,
	"route summary (50 rated cards)": 2,
	"route me": 0,
	"route mine GET (100 reviews)": 9,
	"route write (first, approval on, 500 reviews)": 8,
	"route write (change published, approval on)": 8,
	"route write (approval off, 500 reviews)": 9,
	"route write (approval off, first on an unrated page)": 8,
	"route write (approval off, change a published review)": 8,
	"route write (rate limited)": 3,
	"route mine DELETE (100 reviews)": 9,
	"route mine DELETE (350 reviews, first call)": 9,
	"route write_guest (first guest, 500 reviews)": 8,
	"route write_guest (salt exists, 500 reviews)": 7,
	"route write_guest (change a waiting review)": 8,
	"admin page_load /waiting": 9,
	"admin page_load /published": 5,
	"admin page_load /settings": 3,
	"admin widget waiting": 2,
	"admin form find (waiting)": 7,
	"admin block page (published p2)": 4,
	"admin block page (waiting, Previous)": 5,
	"admin table sort click (published)": 5,
	"admin decide read (waiting)": 6,
	"admin decide ask_delete (published)": 5,
	"admin decide reply (published)": 5,
	"admin decide approve (500 reviews)": 7,
	"admin decide approve (first on an unrated page)": 8,
	"admin decide reject (500 reviews)": 6,
	"admin decide approve change": 9,
	"admin decide reject change": 8,
	"admin decide stale stamp": 5,
	"admin decide missing review": 5,
	"admin decide delete (500 reviews)": 7,
	"admin decide unreply": 5,
	"admin form save_reply": 5,
	"admin form delete_email (30 + 5 edits)": 9,
	"admin block kit_done": 5,
	"admin block kit_again": 5,
	"admin form save_collections": 4,
	"admin form save_moderation": 4,
	"admin form save_who (with guest email)": 5,
	"admin form save_guest_email": 4,
	"admin form save_notify": 5,
	"admin block test_notice": 6,
};

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
/** Every review row as seeded, before any test changed one. */
let seeded: Row[] = [];
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
	seeded = [...rowsById.values()];
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

type Blocks = { blocks: Array<Record<string, unknown>>; toast?: { message: string; type: string } };
const json = (value: unknown) => JSON.stringify(value);
const upgrading = (screen: unknown) => json(screen).includes("Updating your reviews for this version");
const metaFor = (post: string) => ({
	page: {
		url: `https://x.test/posts/${post}`,
		path: `/posts/${post}`,
		locale: null,
		kind: "content",
		pageType: "post",
		title: "Post",
		description: null,
		canonical: null,
		image: null,
		content: { collection: "posts", id: post, slug: post },
	},
});

/** The worst count seen across several runs of one entry point. */
async function measureWorst(name: string, runs: number, run: (i: number) => Promise<unknown>): Promise<unknown[]> {
	let worst = 0;
	const results: unknown[] = [];
	for (let i = 0; i < runs; i += 1) {
		const { result, calls } = await countBridgeCalls(() => run(i));
		expect.soft(calls.length, `${name} run ${i} => ${calls.join(",")}`).toBeLessThanOrEqual(MAX_BRIDGE_CALLS);
		worst = Math.max(worst, calls.length);
		results.push(result);
	}
	seen.set(name, worst);
	expect.soft(worst, name).toBe(MEASURED[name]);
	return results;
}

describe("install hooks", () => {
	it("plugin:install and plugin:activate schedule the hourly notice", async () => {
		await measure("hook plugin:install", () => s.rt.transport.invokeHook("plugin:install", {}));
		await measure("hook plugin:activate", () => s.rt.transport.invokeHook("plugin:activate", {}));
		// A site with reviews is never marked as having nothing to bring over: its record starts counting.
		expect(await s.rt.inspect.storage.get("stats", "site")).toMatchObject({ ready: false, upgrade: { phase: "kit" } });
	});
});

describe("visitor routes on data from 0.2.2, before the upgrade", () => {
	it("health", async () => {
		await measure("route health", () => s.call("health", {}, fromIp("198.51.100.7", "GET")));
	});

	it("list: page 50 of the busiest post", async () => {
		const result = await measure("route list (500 reviews, page 50, 0.2.2 data)", () =>
			s.call("list", { collection: "posts", id: posts[0], page: 50, sort: "lowest" }, { method: "GET" }),
		);
		expect(result).toMatchObject({ ok: true, page: 50, count: BUSY_REVIEWS });
	});

	it("list: a rating row from 0.2.0 (no bars) is read as it is, never rebuilt by a visitor", async () => {
		const row = await s.rt.inspect.storage.get<Row>("ratings", `posts:${posts[1]}`);
		await s.rt.fixtures.plugin.storage("ratings", `posts:${posts[1]}`, { ...row, bars: undefined });
		const result = await measure("route list (500 reviews, page 50, 0.2.0 rating row)", () =>
			s.call("list", { collection: "posts", id: posts[0], page: 50 }, { method: "GET" }),
		);
		expect(result).toMatchObject({ ok: true });
	});

	it("summary: 50 cards in one read; 0.2.x rows cannot say their page is still public, so no badge until the upgrade", async () => {
		const result = await measure("route summary (50 rated cards, 0.2.2 data)", () =>
			s.call("summary", { collection: "posts", ids: posts.slice(0, 50).join(",") }, { method: "GET" }),
		);
		expect((result as { ratings: Row }).ratings).toEqual({});
	});

	it("summary: rating rows 0.2.0 lost show nothing until the upgrade rebuilds them", async () => {
		const result = await measure("route summary (50 cards, 20 lost rating rows)", () =>
			s.call("summary", { collection: "posts", ids: posts.slice(POSTS - 50).join(",") }, { method: "GET" }),
		);
		expect((result as { ratings: Row }).ratings).toEqual({});
	});
});

describe("upgrade from 0.2.2", () => {
	it("the hourly task counts the site first", async () => {
		await measure("cron notify (0.2.2 data, counts the site)", () => s.rt.transport.invokeHook("cron", { name: "notify" }));
		expect(await s.rt.inspect.storage.get("stats", "site")).toMatchObject({ ready: true, upgrade: { phase: "kit" } });
	});

	it("runs step by step on admin loads, the hourly task and Continue, each within the budget", async () => {
		const screens = await measureWorst("admin page_load /waiting (upgrade step, worst)", 4, () => s.rt.admin.loadPage("/waiting"));
		expect(screens.every(upgrading)).toBe(true);
		await measureWorst("cron notify (upgrade step)", 2, () => s.rt.transport.invokeHook("cron", { name: "notify" }));
		let steps = 0;
		const presses = await measureWorst("admin block upgrade (Continue, worst)", 30, async () => {
			const site = (await s.rt.inspect.storage.get<Row>("stats", "site"))!;
			if ((site.upgrade as Row | undefined)?.phase === "done") return null;
			steps += 1;
			return admin({ type: "block_action", action_id: "upgrade", page: "/waiting", value: "waiting|1|||" });
		});
		expect((await s.rt.inspect.storage.get<Row>("stats", "site"))!.upgrade).toMatchObject({ phase: "done" });
		expect(steps).toBeLessThan(30);
		// The press that finishes says so instead of asking for another press.
		expect(json(presses.filter(Boolean).at(-1))).toContain("Your reviews are up to date for this version");
	});

	it("rebuilt every rating from the reviews, lost rows included, and counted the site", async () => {
		for (let i = 0; i < POSTS; i += 1) {
			const post = posts[i]!;
			const published = seeded.filter((row) => row.entryId === post && row.status === "published");
			const row = (await s.rt.inspect.storage.get<Row>("ratings", `posts:${post}`))!;
			const bars = [1, 2, 3, 4, 5].map((n) => published.filter((r) => r.stars === n).length);
			expect([row.v, row.ready, [row.s1, row.s2, row.s3, row.s4, row.s5], row.t], post).toEqual([3, true, bars, published.length]);
		}
		const site = (await s.rt.inspect.storage.get<Row>("stats", "site"))!;
		const published = seeded.filter((row) => row.status === "published");
		expect([site.pending, site.changes]).toEqual([PENDING, CHANGED + GUEST_EMAIL_EDITS]);
		expect([site.s1, site.s2, site.s3, site.s4, site.s5]).toEqual([1, 2, 3, 4, 5].map((n) => published.filter((r) => r.stars === n).length));
		expect(await s.rt.inspect.storage.get<Row>("entries", `posts:${posts[0]}`)).toMatchObject({ title: "Post 0" });
	});

	it("summary shows the lost rows again", async () => {
		const result = (await s.call("summary", { collection: "posts", ids: posts.slice(POSTS - 50).join(",") }, { method: "GET" })) as { ratings: Row };
		expect(Object.keys(result.ratings)).toHaveLength(50);
	});
});

describe("hooks and cron after the upgrade", () => {
	it("cron notify with the notice on, an address, and reviews waiting", async () => {
		await s.rt.fixtures.plugin.setting("notify", true);
		await s.rt.fixtures.plugin.setting("notify_to", "owner@example.com");
		await measure("cron notify (on, waiting)", () => s.rt.transport.invokeHook("cron", { name: "notify" }));
		await s.rt.fixtures.plugin.setting("notify", false);
	});

	it("page:metadata on a rated page", async () => {
		expect(await measure("hook page:metadata (rated)", () => s.rt.transport.invokeHook("page:metadata", metaFor(posts[0]!)))).toMatchObject({ kind: "jsonld" });
	});

	it("unpublish, publish and delete keep the rating's live flag in one call each", async () => {
		const post = posts[2]!;
		const live = async () => (await s.rt.inspect.storage.get<Row>("ratings", `posts:${post}`))!.live;
		await measure("hook content:afterUnpublish", () => s.rt.transport.invokeHook("content:afterUnpublish", { collection: "posts", content: { id: post } }));
		expect(await live()).toBe(false);
		await measure("hook content:afterPublish", () => s.rt.transport.invokeHook("content:afterPublish", { collection: "posts", content: { id: post } }));
		expect(await live()).toBe(true);
		await measure("hook content:afterDelete", () => s.rt.transport.invokeHook("content:afterDelete", { collection: "posts", id: post, permanent: false }));
		expect(await live()).toBe(false);
		await s.rt.transport.invokeHook("content:afterPublish", { collection: "posts", content: { id: post } });
	});
});

describe("public routes", () => {
	it("list: page 50 of the busiest post", async () => {
		const result = await measure("route list (500 reviews, page 50)", () =>
			s.call("list", { collection: "posts", id: posts[0], page: 50, sort: "lowest" }, { method: "GET" }),
		);
		expect(result).toMatchObject({ ok: true, page: 50, count: BUSY_REVIEWS });
	});

	it("summary: 50 rated cards", async () => {
		const result = await measure("route summary (50 rated cards)", () =>
			s.call("summary", { collection: "posts", ids: posts.slice(0, 50).join(",") }, { method: "GET" }),
		);
		expect(Object.keys((result as { ratings: Row }).ratings)).toHaveLength(50);
	});
});

describe("member routes", () => {
	it("me", async () => {
		await measure("route me", () => s.call("me", {}, as("ana", "GET")));
	});

	it("mine GET: a member with 100 reviews on 100 posts, written before 0.3.0", async () => {
		const result = await measure("route mine GET (100 reviews)", () => s.call("mine", {}, as("heavy", "GET")));
		const items = (result as { items: Row[] }).items;
		expect(items).toHaveLength(HEAVY_MEMBER_REVIEWS);
		// Every page is named from the titles the upgrade stored; the first ones also get their address.
		expect(items.every((item) => String(item.entry_title).startsWith("Post "))).toBe(true);
		expect(items.filter((item) => item.entry_url).length).toBeGreaterThan(0);
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

	it("write: approval off publishes at once and moves the rating", async () => {
		await s.rt.fixtures.plugin.setting("require_moderation", false);
		expect(
			await measure("route write (approval off, 500 reviews)", () =>
				s.call("write", { collection: "posts", id: posts[0], stars: 5, body: "Great." }, as("ben")),
			),
		).toMatchObject({ ok: true, status: "published" });
		const unrated = await s.rt.fixtures.content("posts", { data: { title: "New post" }, slug: "new-post", status: "published" } as never);
		expect(
			await measure("route write (approval off, first on an unrated page)", () =>
				s.call("write", { collection: "posts", id: unrated.id, stars: 5, body: "First." }, as("ben")),
			),
		).toMatchObject({ ok: true, status: "published" });
		expect(await s.rt.inspect.storage.get("ratings", `posts:${unrated.id}`)).toMatchObject({ v: 3, ready: true, live: true, s5: 1, t: 1 });
		expect(String((await s.rt.inspect.storage.get<Row>("ratings", `posts:${unrated.id}`))!.url)).toContain("/posts/new-post");
		expect(
			await measure("route write (approval off, change a published review)", () =>
				s.call("write", { collection: "posts", id: posts[0], stars: 3, body: "Less great." }, as("busy2")),
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

	it("mine DELETE: 350 reviews take more than one call", async () => {
		for (let i = 0; i < 350; i += 1) await s.rt.fixtures.plugin.storage("reviews", reviewIdOf(`gone${i}`, "eraser"), review(`gone${i}`, "eraser", i));
		const first = await measure("route mine DELETE (350 reviews, first call)", () => s.call("mine", {}, as("eraser", "DELETE")));
		expect(first).toMatchObject({ ok: false, error: { code: "BUSY", reason: "MORE" } });
		let last: unknown = first;
		for (let i = 0; i < 5 && (last as { ok: boolean }).ok === false; i += 1) last = await s.call("mine", {}, as("eraser", "DELETE"));
		expect(last).toMatchObject({ ok: true });
		expect((await s.rt.inspect.storage.list<Row>("reviews")).filter((r) => r.data.member_id === "eraser")).toHaveLength(0);
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
		expect(
			await measure("route write_guest (change a waiting review)", () =>
				s.call("write_guest", { collection: "posts", id: posts[0], stars: 2, name: "Lee", email: "lee@example.com", body: "Less fine." }, fromIp("203.0.113.6")),
			),
		).toMatchObject({ ok: true, status: "pending" });
		await s.rt.fixtures.plugin.setting("ask_guest_email", false);
	});
});

describe("admin pages and widget", () => {
	it("page loads, with a queued rating change applied on the way", async () => {
		// Changes the bulk erases above queued are applied by dashboard loads, several per load.
		for (let i = 0; i < 200 && (await s.rt.inspect.storage.list("rating_queue")).length; i += 1) await s.rt.admin.loadWidget("waiting");
		expect(await s.rt.inspect.storage.list("rating_queue")).toHaveLength(0);
		await s.rt.fixtures.plugin.storage("rating_queue", `posts:${posts[3]}|q1`, { entry: `posts:${posts[3]}`, s1: 0, s2: 0, s3: 0, s4: -1, s5: 0, t: -1 });
		await s.rt.fixtures.plugin.storage("rating_queue", `posts:${posts[3]}|q2`, { entry: `posts:${posts[3]}`, s1: 0, s2: 0, s3: 0, s4: 1, s5: 0, t: 1 });
		const waiting = await measure("admin page_load /waiting", () => s.rt.admin.loadPage("/waiting"));
		expect(upgrading(waiting)).toBe(false);
		expect(json(waiting)).toContain("Page 1 of");
		expect(await s.rt.inspect.storage.list("rating_queue")).toHaveLength(0);
		await measure("admin page_load /published", () => s.rt.admin.loadPage("/published"));
		await measure("admin page_load /settings", () => s.rt.admin.loadPage("/settings"));
		await measure("admin widget waiting", () => s.rt.admin.loadWidget("waiting"));
	});
});

describe("admin actions", () => {
	it("find and paging", async () => {
		const found = await measure("admin form find (waiting)", () => admin({ type: "form_submit", action_id: "find", page: "/waiting", values: { q: "Body 1" } }));
		expect(json(found)).toContain("Body 1");
		const published = (await admin({ type: "page_load", page: "/published" })) as Blocks;
		const next = published.blocks.flatMap((b) => (b.elements as Array<{ label: string; value: string }>) ?? []).find((e) => e.label === "Next")!;
		const p2 = (await measure("admin block page (published p2)", () => admin({ type: "block_action", action_id: "page", page: "/published", value: next.value }))) as Blocks;
		expect(json(p2)).toContain("Page 2 of");
		const waiting = (await admin({ type: "page_load", page: "/waiting" })) as Blocks;
		const nextW = waiting.blocks.flatMap((b) => (b.elements as Array<{ label: string; value: string }>) ?? []).find((e) => e.label === "Next")!;
		const w2 = (await admin({ type: "block_action", action_id: "page", page: "/waiting", value: nextW.value })) as Blocks;
		const prev = w2.blocks.flatMap((b) => (b.elements as Array<{ label: string; value: string }>) ?? []).find((e) => e.label === "Previous")!;
		const back = await measure("admin block page (waiting, Previous)", () => admin({ type: "block_action", action_id: "page", page: "/waiting", value: prev.value }));
		expect(json(back)).toContain("Page 1 of");
		// The table's page_action_id: no column is sortable, so it shows the list again within the budget.
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

	it("decide approve and reject on the busiest post, and approve the first review of an unrated page", async () => {
		const pending = (post: string, who: string) => review(post, who, 1, { status: "pending", publishedAt: "", rev: `rev-${who}` });
		await s.rt.fixtures.plugin.storage("reviews", reviewIdOf(posts[0]!, "dx1"), pending(posts[0]!, "dx1"));
		await s.rt.fixtures.plugin.storage("reviews", reviewIdOf(posts[0]!, "dx2"), pending(posts[0]!, "dx2"));
		await s.rt.fixtures.plugin.storage("reviews", reviewIdOf("fresh-post", "dx3"), pending("fresh-post", "dx3"));
		expect(
			await measure("admin decide approve (500 reviews)", () =>
				admin({ type: "block_action", action_id: "decide", page: "/waiting", value: stamp("approve", reviewIdOf(posts[0]!, "dx1"), "rev-dx1") }),
			),
		).toMatchObject({ toast: { message: "Review published." } });
		await measure("admin decide reject (500 reviews)", () =>
			admin({ type: "block_action", action_id: "decide", page: "/waiting", value: stamp("reject", reviewIdOf(posts[0]!, "dx2"), "rev-dx2") }),
		);
		expect(
			await measure("admin decide approve (first on an unrated page)", () =>
				admin({ type: "block_action", action_id: "decide", page: "/waiting", value: stamp("approve", reviewIdOf("fresh-post", "dx3"), "rev-dx3") }),
			),
		).toMatchObject({ toast: { message: "Review published." } });
		expect(await s.rt.inspect.storage.get("ratings", "posts:fresh-post")).toMatchObject({ v: 3, s2: 1, t: 1 });
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
		expect((await s.rt.inspect.storage.list<Row>("reviews")).filter((r) => r.data.email === GUEST_EMAIL || r.data.pending_email === GUEST_EMAIL)).toHaveLength(0);
		// Ratings the call could not move wait in the queue; admin loads and the hourly task apply them.
		for (let i = 0; i < 200 && (await s.rt.inspect.storage.list("rating_queue")).length; i += 1) await s.rt.admin.loadWidget("waiting");
		expect(await s.rt.inspect.storage.list("rating_queue")).toHaveLength(0);
		const row = (await s.rt.inspect.storage.get<Row>("ratings", `posts:${posts[1]}`))!;
		const left = (await s.rt.inspect.storage.list<Row>("reviews")).filter((r) => r.data.entryId === posts[1] && r.data.status === "published");
		expect([row.s1, row.s2, row.s3, row.s4, row.s5].reduce((a, b) => Number(a) + Number(b), 0)).toBe(left.length);
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
	it("every entry point measured fits the Cloudflare budget", () => {
		expect([...seen.keys()].sort()).toEqual(Object.keys(MEASURED).sort());
		const over = [...seen].filter(([, n]) => n > MAX_BRIDGE_CALLS);
		expect(Object.fromEntries(over)).toEqual({});
	});
});

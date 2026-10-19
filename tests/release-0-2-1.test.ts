import { afterEach, describe, expect, it } from "vitest";

import { admin, ana, openSite, withPosts } from "./site";

let dispose: (() => Promise<void>) | undefined;
afterEach(async () => {
	await dispose?.();
	dispose = undefined;
});

const fromIp = (ip: string | null, method = "POST") => ({ method, meta: { ip, userAgent: null, referer: null, geo: null } });

async function site() {
	const s = await openSite();
	dispose = s.dispose;
	const posts = await withPosts(s.rt);
	const guestWrite = (ip: string | null, input: Record<string, unknown> = {}) =>
		s.call("write_guest", { collection: "posts", id: posts.live, stars: 4, name: "Sam", body: "Good.", ...input }, fromIp(ip));
	return { ...s, ...posts, guestWrite };
}

const blocksText = (page: unknown) => JSON.stringify((page as { blocks: unknown }).blocks);

describe("guests need a visitor address (owner decision 2026-10-16)", () => {
	it("refuses a guest write with no address and stores nothing", async () => {
		const { rt, guestWrite } = await site();
		for (const ip of [null, "", "unknown"]) {
			expect(await guestWrite(ip), String(ip)).toMatchObject({ ok: false, error: { code: "GUEST_UNAVAILABLE" } });
		}
		expect(await rt.inspect.storage.list("reviews")).toHaveLength(0);
		const keys = (await rt.inspect.kv.list()).map((row) => row.id);
		expect(keys.filter((key) => key.startsWith("rate:") || key === "visitor_salt")).toEqual([]);
	});

	it("tells the kit whether guests can write here", async () => {
		const { call } = await site();
		// "who" is what applies on this request, so a 0.2.0 kit (which reads only "who") shows its sign-in line.
		expect(await call("health", {}, fromIp(null, "GET"))).toMatchObject({ who: "members", guestWrites: false, hostAddress: false });
		expect(await call("health", {}, fromIp("198.51.100.7", "GET"))).toMatchObject({ who: "anyone", guestWrites: true, hostAddress: true });
		await call("admin", { type: "form_submit", action_id: "save_who", values: { who: "members" }, page: "/settings" });
		expect(await call("health", {}, fromIp("198.51.100.7", "GET"))).toMatchObject({ who: "members", guestWrites: false, hostAddress: true });
	});

	it("lets an IPv4 guest write and limits that guest", async () => {
		const { rt, guestWrite } = await site();
		for (let n = 0; n < 8; n += 1) expect(await guestWrite("192.0.2.10"), `write ${n}`).toMatchObject({ ok: true, status: "pending" });
		expect(await guestWrite("192.0.2.10")).toMatchObject({ ok: false, error: { code: "RATE_LIMITED" } });
		expect(await guestWrite("192.0.2.11")).toMatchObject({ ok: true });
		const rows = await rt.inspect.storage.list<Record<string, unknown>>("reviews");
		expect(rows).toHaveLength(2);
		expect(JSON.stringify(rows)).not.toContain("192.0.2.");
	});

	it("counts two IPv6 addresses in one /64 as one guest", async () => {
		const { rt, guestWrite } = await site();
		await guestWrite("2001:db8:aa:1::1", { body: "First." });
		await guestWrite("2001:0db8:00aa:0001:ffff:1:2:3", { body: "Second." });
		const rows = await rt.inspect.storage.list<Record<string, unknown>>("reviews");
		expect(rows).toHaveLength(1);
		expect(rows[0].data).toMatchObject({ body: "Second." });
		await guestWrite("2001:db8:aa:2::1", { body: "Other network." });
		expect(await rt.inspect.storage.list("reviews")).toHaveLength(2);
	});

	it("shares one hourly limit across a /64", async () => {
		const { guestWrite } = await site();
		for (let n = 0; n < 8; n += 1) await guestWrite(`2001:db8:5:6::${n + 1}`);
		expect(await guestWrite("2001:db8:5:6:abcd::9")).toMatchObject({ ok: false, error: { code: "RATE_LIMITED" } });
	});

	it("still lets a member write with no address", async () => {
		const { call, live } = await site();
		expect(
			await call("write", { collection: "posts", id: live, stars: 5, body: "Member." }, { ...fromIp(null), user: ana }),
		).toMatchObject({ ok: true });
	});

	it("says on Settings when guests are asked to sign in", async () => {
		const { call } = await site();
		const off = await call("admin", { type: "page_load", page: "/settings" }, { ...fromIp(null), user: admin });
		expect(blocksText(off)).toContain("Guests are asked to sign in on this hosting");
		expect(blocksText(off)).toContain("trustedProxyHeaders");
		const on = await call("admin", { type: "page_load", page: "/settings" }, { ...fromIp("198.51.100.7"), user: admin });
		expect(blocksText(on)).not.toContain("Guests are asked to sign in on this hosting");
	});
});

describe("waiting reviews never hide published ones", () => {
	async function seeded(waiting: number, published: number) {
		const s = await site();
		const put = (id: string, data: Record<string, unknown>) => s.rt.fixtures.plugin.storage("reviews", id, data);
		const base = { entry: `posts:${s.live}`, collection: "posts", entryId: s.live, guest: true, has_text: true, rev: "r" };
		const stamp = (n: number) => new Date(Date.UTC(2026, 9, 1) + n * 1000).toISOString();
		for (let n = 0; n < published; n += 1) {
			await put(`posts:${s.live}:v-p${n}`, { ...base, author: `Reader ${n}`, stars: 4, body: `Published ${n}`, status: "published", createdAt: stamp(n) });
		}
		// Waiting rows are newer, so a newest-first read that drops them afterwards sees only them.
		for (let n = 0; n < waiting; n += 1) {
			await put(`posts:${s.live}:v-w${n}`, { ...base, author: `Flood ${n}`, stars: 1, body: `Waiting ${n}`, status: "pending", createdAt: stamp(100_000 + n) });
		}
		await put(`posts:${s.live}:v-last`, { ...base, author: "Last", stars: 5, body: "Approve me", status: "pending", createdAt: stamp(1) });
		return s;
	}

	it("lists the 3 published reviews and keeps the rating with 600 waiting", async () => {
		const { call, live, rt } = await seeded(600, 3);
		const listed = (await call("list", { collection: "posts", id: live }, { method: "GET" })) as Record<string, unknown>;
		expect(listed).toMatchObject({ ok: true, total: 3 });
		expect((listed.items as unknown[]).length).toBe(3);
		const row = await rt.inspect.storage.get<{ rev: string }>("reviews", `posts:${live}:v-last`);
		await call("admin", { type: "block_action", action_id: "decide", value: `approve|${row!.rev}|posts:${live}:v-last` });
		expect(await rt.inspect.storage.get("ratings", `posts:${live}`)).toMatchObject({ count: 4, average: 4.3 });
		expect(await call("list", { collection: "posts", id: live }, { method: "GET" })).toMatchObject({ count: 4, total: 4 });
		const waiting = await rt.admin.loadPage("/waiting");
		expect(blocksText(waiting)).toContain('"value":"600"');
		expect(blocksText(waiting)).toContain("600 reviews. Page 1 of 24.");
	}, 120_000);

	it("counts more than 500 published reviews on one page", async () => {
		const { call, live, rt } = await seeded(0, 620);
		const row = await rt.inspect.storage.get<{ rev: string }>("reviews", `posts:${live}:v-last`);
		await call("admin", { type: "block_action", action_id: "decide", value: `approve|${row!.rev}|posts:${live}:v-last` });
		expect(await rt.inspect.storage.get("ratings", `posts:${live}`)).toMatchObject({ count: 621 });
		// Show more pages up to 50 (500 reviews); the count and total stay exact.
		expect(await call("list", { collection: "posts", id: live, page: 63 }, { method: "GET" })).toMatchObject({
			count: 621,
			total: 621,
			pages: 50,
			page: 50,
		});
	}, 120_000);

	it("keeps the waiting count off the public health route", async () => {
		const { call } = await seeded(2, 0);
		const health = (await call("health", {}, { method: "GET" })) as Record<string, unknown>;
		expect(health.ok).toBe(true);
		expect("pending" in health).toBe(false);
	});

	it("shows nothing for an unpublished page or a closed content type", async () => {
		const { call, rt, live, draft } = await seeded(0, 2);
		await rt.fixtures.plugin.storage("ratings", `posts:${draft}`, { collection: "posts", entryId: draft, average: 5, count: 1 });
		await rt.fixtures.plugin.storage("ratings", `posts:${live}`, { collection: "posts", entryId: live, average: 4, count: 2 });
		expect(await call("list", { collection: "posts", id: draft }, { method: "GET" })).toMatchObject({ items: [], count: 0 });
		const summary = (await call("summary", { collection: "posts", ids: `${live},${draft}` }, { method: "GET" })) as {
			ratings: Record<string, unknown>;
		};
		expect(Object.keys(summary.ratings)).toEqual([live]);
		await call("admin", { type: "form_submit", action_id: "save_collections", values: { collections: [] }, page: "/settings" });
		expect(await call("list", { collection: "posts", id: live }, { method: "GET" })).toMatchObject({ items: [], count: 0 });
		expect(await call("summary", { collection: "posts", ids: live }, { method: "GET" })).toMatchObject({ ratings: {} });
	});
});

describe("list reads one page, not every review", () => {
	it("sorts by stars, serves bars from the rating row, and rebuilds a 0.2.0 rating row once", async () => {
		const { call, rt, live } = await site();
		const put = (id: string, data: Record<string, unknown>) => rt.fixtures.plugin.storage("reviews", id, data);
		const base = { entry: `posts:${live}`, collection: "posts", entryId: live, status: "published", rev: "r" };
		await put(`posts:${live}:a`, { ...base, author: "A", stars: 2, body: "Two", has_text: true, createdAt: "2026-10-01T00:00:00Z" });
		await put(`posts:${live}:b`, { ...base, author: "B", stars: 5, body: "Five", has_text: true, createdAt: "2026-10-02T00:00:00Z" });
		await put(`posts:${live}:c`, { ...base, author: "C", stars: 4, title: "", body: "", has_text: false, createdAt: "2026-10-03T00:00:00Z" });
		// A rating row as 0.2.0 stored it: no bars, no text count.
		await rt.fixtures.plugin.storage("ratings", `posts:${live}`, { collection: "posts", entryId: live, average: 3.7, count: 3 });
		const newest = (await call("list", { collection: "posts", id: live }, { method: "GET" })) as Record<string, unknown>;
		expect(newest).toMatchObject({ count: 3, total: 2, bars: { 1: 0, 2: 1, 3: 0, 4: 1, 5: 1 } });
		expect((newest.items as Array<{ author: string }>).map((i) => i.author)).toEqual(["B", "A"]);
		const lowest = (await call("list", { collection: "posts", id: live, sort: "lowest" }, { method: "GET" })) as { items: Array<{ author: string }> };
		expect(lowest.items.map((i) => i.author)).toEqual(["A", "B"]);
		expect(await rt.inspect.storage.get("ratings", `posts:${live}`)).toMatchObject({ bars: [0, 1, 0, 1, 1], text_count: 2 });
	});
});

describe("round 2 checks", () => {
	it("counts Published this week by approval time", async () => {
		const { call, rt, live } = await site();
		// Written long ago, approved now: it counts this week.
		await rt.fixtures.plugin.storage("reviews", `posts:${live}:v-old`, {
			entry: `posts:${live}`, collection: "posts", entryId: live, status: "pending", stars: 4, body: "Old",
			has_text: true, rev: "r", createdAt: "2025-01-01T00:00:00Z",
		});
		await call("admin", { type: "block_action", action_id: "decide", value: `approve|r|posts:${live}:v-old` });
		expect(await rt.inspect.storage.get("reviews", `posts:${live}:v-old`)).toMatchObject({ status: "published" });
		const page = blocksText(await rt.admin.loadPage("/published"));
		expect(page).toContain('"label":"Published this week","value":"1"');
	});

	it("summary rebuilds a rating row 0.2.0 deleted while published reviews remained", async () => {
		const { call, rt, live } = await site();
		await rt.fixtures.plugin.storage("reviews", `posts:${live}:v-a`, {
			entry: `posts:${live}`, collection: "posts", entryId: live, status: "published", stars: 4, body: "Kept",
			has_text: true, rev: "r", createdAt: "2026-10-01T00:00:00Z",
		});
		expect(await call("summary", { collection: "posts", ids: live }, { method: "GET" })).toMatchObject({ ratings: { [live]: { average: 4, count: 1 } } });
	});

	it("health tells the kit the owner's setting as well as who can write now", async () => {
		const { call } = await site();
		await call("admin", { type: "form_submit", action_id: "save_who", values: { who: "members" }, page: "/settings" });
		expect(await call("health", {}, fromIp(null, "GET"))).toMatchObject({ who: "members", setting: "members", hostAddress: false });
	});
});

describe("member check and erasure", () => {
	it("answers me cheaply for members and 'sign in' for guests", async () => {
		const { call } = await site();
		expect(await call("me", {}, { method: "GET", user: ana })).toEqual({ ok: true });
		expect(await call("me", {}, { method: "GET" })).toMatchObject({ ok: false, error: { code: "SIGN_IN_REQUIRED" } });
	});

	it("deletes every review with a guest email, past the first 100", async () => {
		const { call, rt, live } = await site();
		for (let n = 0; n < 130; n += 1) {
			await rt.fixtures.plugin.storage("reviews", `posts:${live}:v-e${n}`, {
				entry: `posts:${live}`, collection: "posts", entryId: live, status: n % 2 ? "published" : "pending",
				stars: 3, body: `Mail ${n}`, has_text: true, email: "sam@example.com", rev: "r", createdAt: "2026-10-01T00:00:00Z",
			});
		}
		const done = (await call("admin", { type: "form_submit", action_id: "delete_email", values: { email: "sam@example.com" }, page: "/published" })) as {
			toast: { message: string };
		};
		expect(done.toast.message).toBe("Deleted 130 reviews.");
		expect(await rt.inspect.storage.list("reviews")).toHaveLength(0);
		expect(await rt.inspect.storage.get("ratings", `posts:${live}`)).toBeNull();
	}, 60_000);

	it("erases a guest's own reviews and their pending edit on another guest's review, past 100 rows", async () => {
		const { call, rt, live, guestWrite } = await site();
		await call("admin", { type: "form_submit", action_id: "save_guest_email", values: { ask_guest_email: true }, page: "/settings" });
		// B's published review, then A (same address) sends an edit that waits on B's row.
		await guestWrite("198.51.100.40", { name: "Ben", email: "ben@example.com", body: "Ben's words.", stars: 5 });
		const bId = (await rt.inspect.storage.list("reviews"))[0].id;
		const bRow = await rt.inspect.storage.get<{ rev: string }>("reviews", bId);
		await call("admin", { type: "block_action", action_id: "decide", value: `approve|${bRow!.rev}|${bId}` });
		await guestWrite("198.51.100.40", { name: "Ana", email: "ana@example.com", body: "Ana's words.", stars: 1 });
		expect(await rt.inspect.storage.get("reviews", bId)).toMatchObject({ pending_change: true, pending_email: "ana@example.com" });
		// 120 of A's own reviews on other rows.
		for (let n = 0; n < 120; n += 1) {
			await rt.fixtures.plugin.storage("reviews", `posts:${live}:v-ana${n}`, {
				entry: `posts:${live}`, collection: "posts", entryId: live, status: "pending", stars: 2, body: `Ana ${n}`,
				has_text: true, email: "ana@example.com", author: "Ana", rev: "r", createdAt: "2026-10-01T00:00:00Z",
			});
		}
		const found = blocksText(await call("admin", { type: "form_submit", action_id: "find", values: { q: "ana@example.com" }, page: "/waiting" }));
		expect(found).toContain("Ana");
		const done = (await call("admin", { type: "form_submit", action_id: "delete_email", values: { email: "ana@example.com" }, page: "/published" })) as {
			toast: { message: string };
		};
		expect(done.toast.message).toBe("Deleted 120 reviews. Removed 1 waiting change on other reviews.");
		const left = await rt.inspect.storage.list<Record<string, unknown>>("reviews");
		expect(left.map((row) => row.id)).toEqual([bId]);
		expect(left[0].data).toMatchObject({ status: "published", author: "Ben", email: "ben@example.com", body: "Ben's words.", stars: 5, pending_change: false, pending_email: "", pending_author: "", pending_body: "" });
		expect(JSON.stringify(left[0].data)).not.toContain("Ana");
		expect(await call("list", { collection: "posts", id: live }, { method: "GET" })).toMatchObject({ count: 1, items: [{ author: "Ben" }] });
	}, 60_000);

	it("erases a member's rows, pending edits included, with Delete all my reviews", async () => {
		const { call, rt, live } = await site();
		await call("write", { collection: "posts", id: live, stars: 5, body: "Live." }, { method: "POST", user: ana });
		const id = (await rt.inspect.storage.list("reviews"))[0].id;
		const row = await rt.inspect.storage.get<{ rev: string }>("reviews", id);
		await call("admin", { type: "block_action", action_id: "decide", value: `approve|${row!.rev}|${id}` });
		await call("write", { collection: "posts", id: live, stars: 1, body: "Pending edit." }, { method: "POST", user: ana });
		expect(await call("mine", {}, { method: "DELETE", user: ana })).toMatchObject({ ok: true, erased: 1 });
		expect(await rt.inspect.storage.list("reviews")).toHaveLength(0);
	});

	it("keeps a second guest's name on the same address and shows it before approval", async () => {
		const { call, rt, live, guestWrite } = await site();
		await guestWrite("198.51.100.30", { name: "Ana Guest", body: "First person." });
		const id = (await rt.inspect.storage.list("reviews"))[0].id;
		let row = await rt.inspect.storage.get<{ rev: string }>("reviews", id);
		await call("admin", { type: "block_action", action_id: "decide", value: `approve|${row!.rev}|${id}` });
		await guestWrite("198.51.100.30", { name: "Ben Guest", body: "Second person.", stars: 2 });
		expect(blocksText(await rt.admin.loadPage("/waiting"))).toContain("New name: Ben Guest");
		row = await rt.inspect.storage.get<{ rev: string }>("reviews", id);
		await call("admin", { type: "block_action", action_id: "decide", value: `approve|${row!.rev}|${id}` });
		expect(await rt.inspect.storage.get("reviews", id)).toMatchObject({ author: "Ben Guest", body: "Second person.", stars: 2 });
		expect(await call("list", { collection: "posts", id: live }, { method: "GET" })).toMatchObject({ items: [{ author: "Ben Guest" }] });
	});
});

describe("first admin screen", () => {
	it("shows how to set up visitor pages for this version until the owner says they are done", async () => {
		const { rt, call } = await site();
		const first = blocksText(await rt.admin.loadPage("/waiting"));
		const version = rt.manifest.version;
		expect(first).toContain("Set up visitor pages");
		const lines = [
			'kit="$(mktemp -d)" &&',
			"  git clone --depth 1 \\",
			`    --branch v${version} \\`,
			"    https://github.com/wbcomdesigns/emdash-reviews \\",
			'    "$kit/emdash-reviews" &&',
			'  "$kit/emdash-reviews/scripts/add-to-site.sh" .',
		];
		expect(first).toContain(JSON.stringify(lines.join("\n")).slice(1, -1));
		expect(Math.max(...lines.map((line) => line.length))).toBeLessThanOrEqual(52);
		expect(first).toContain("Copy it from the install guide on a phone");
		expect(first).not.toContain("/tmp/");
		expect(first).toContain("/account/reviews/");
		expect(first).toContain(`blob/v${version}/docs/website/getting-started/install.md`);
		const done = blocksText(await call("admin", { type: "block_action", action_id: "kit_done", page: "/waiting" }));
		expect(done).not.toContain("Set up visitor pages");
		expect(done).toContain("Install guide");
		expect(blocksText(await rt.admin.loadPage("/waiting"))).not.toContain("Set up visitor pages");
		expect(done).toContain("Show the setup steps again");
		const again = blocksText(await call("admin", { type: "block_action", action_id: "kit_again", page: "/waiting" }));
		expect(again).toContain("Set up visitor pages");
	});
});

describe("email notice without a mail provider", () => {
	it("saves without sending, and Send a test notice drives the toast and the banner", async () => {
		const { call, rt } = await site();
		const saved = (await call("admin", {
			type: "form_submit",
			action_id: "save_notify",
			values: { notify: true, notify_to: "owner@example.com" },
			page: "/settings",
		})) as { toast: { message: string }; blocks: unknown };
		expect(saved.toast.message).toBe("Saved.");
		expect(await rt.inspect.kv.get("mail_status")).toBeNull();
		expect(blocksText(saved)).toContain("Use Send a test notice to check that this site can send email.");
		const tested = (await call("admin", { type: "block_action", action_id: "test_notice", page: "/settings" })) as {
			toast: { message: string };
			blocks: unknown;
		};
		// The test host may or may not have a mail provider. The plugin's rule: the toast and the banner agree.
		if (tested.toast.message === "No notice was sent: this site has no email provider.") {
			expect(blocksText(tested)).toContain("This site has no email provider");
		} else {
			expect(tested.toast.message).toBe("Test notice sent to owner@example.com.");
			expect(blocksText(tested)).not.toContain("This site has no email provider");
		}
	});

	it("sends at most one test notice a minute, even for parallel clicks", async () => {
		const { call } = await site();
		await call("admin", { type: "form_submit", action_id: "save_notify", values: { notify: true, notify_to: "owner@example.com" }, page: "/settings" });
		const wait = "A test notice was just requested. Wait a minute before sending another.";
		const results = (await Promise.all(
			Array.from({ length: 8 }, () => call("admin", { type: "block_action", action_id: "test_notice", page: "/settings" })),
		)) as Array<{ toast: { message: string } }>;
		const attempts = results.filter((r) => r.toast.message !== wait);
		expect(attempts.length).toBeGreaterThanOrEqual(1);
		const sent = attempts.filter((r) => r.toast.message.startsWith("Test notice sent"));
		// With a provider exactly one sends; with none, each attempt says nothing went and none says "just requested" falsely.
		if (sent.length) {
			expect(sent).toHaveLength(1);
			expect(attempts).toHaveLength(1);
			const again = (await call("admin", { type: "block_action", action_id: "test_notice", page: "/settings" })) as { toast: { message: string } };
			expect(again.toast.message).toBe(wait);
		} else {
			for (const r of attempts) expect(r.toast.message).toBe("No notice was sent: this site has no email provider.");
			const again = (await call("admin", { type: "block_action", action_id: "test_notice", page: "/settings" })) as { toast: { message: string } };
			expect(again.toast.message).toBe("No notice was sent: this site has no email provider.");
		}
	});

	it("asks for a saved address before a test notice", async () => {
		const { call } = await site();
		const tested = (await call("admin", { type: "block_action", action_id: "test_notice", page: "/settings" })) as { toast: { message: string } };
		expect(tested.toast.message).toBe("Save the address the notice should go to first.");
	});

	it("remembers a send that found no provider and shows it on Settings", async () => {
		const { rt } = await site();
		await rt.fixtures.plugin.kv("mail_status", "none");
		expect(blocksText(await rt.admin.loadPage("/settings"))).toContain("This site has no email provider");
	});
});

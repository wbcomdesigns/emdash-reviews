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
		expect(await call("health", {}, fromIp(null, "GET"))).toMatchObject({ who: "anyone", guestWrites: false });
		expect(await call("health", {}, fromIp("198.51.100.7", "GET"))).toMatchObject({ who: "anyone", guestWrites: true });
		await call("admin", { type: "form_submit", action_id: "save_who", values: { who: "members" }, page: "/settings" });
		expect(await call("health", {}, fromIp("198.51.100.7", "GET"))).toMatchObject({ who: "members", guestWrites: false });
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
		expect(await call("list", { collection: "posts", id: live, page: 63 }, { method: "GET" })).toMatchObject({
			total: 621,
			pages: 63,
			page: 63,
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

describe("first admin screen", () => {
	it("shows how to set up visitor pages for this version until the owner says they are done", async () => {
		const { rt, call } = await site();
		const first = blocksText(await rt.admin.loadPage("/waiting"));
		const version = rt.manifest.version;
		expect(first).toContain("Set up visitor pages");
		const command = `kit="$(mktemp -d)" && git clone --branch v${version} --depth 1 https://github.com/wbcomdesigns/emdash-reviews "$kit/emdash-reviews" && "$kit/emdash-reviews/scripts/add-to-site.sh" .`;
		expect(first).toContain(JSON.stringify(command).slice(1, -1));
		expect(first).not.toContain("/tmp/");
		expect(first).toContain("/account/reviews/");
		expect(first).toContain(`blob/v${version}/docs/website/getting-started/install.md`);
		const done = blocksText(await call("admin", { type: "block_action", action_id: "kit_done", page: "/waiting" }));
		expect(done).not.toContain("Set up visitor pages");
		expect(done).toContain("Install guide");
		expect(blocksText(await rt.admin.loadPage("/waiting"))).not.toContain("Set up visitor pages");
	});
});

describe("email notice without a mail provider", () => {
	it("says plainly when no notice can be sent, and the banner and toast agree", async () => {
		const { call } = await site();
		const saved = (await call("admin", {
			type: "form_submit",
			action_id: "save_notify",
			values: { notify: true, notify_to: "owner@example.com" },
			page: "/settings",
		})) as { toast: { message: string }; blocks: unknown };
		// The test host may or may not have a mail provider. The plugin's rule: a save says which, and Settings agrees.
		if (saved.toast.message.startsWith("Saved, but no notice will be sent")) {
			expect(blocksText(saved)).toContain("This site has no email provider");
		} else {
			expect(saved.toast.message).toBe("Email notice saved. A test notice went to owner@example.com.");
			expect(blocksText(saved)).not.toContain("This site has no email provider");
		}
	});

	it("remembers a send that found no provider and shows it on Settings", async () => {
		const { rt } = await site();
		await rt.fixtures.plugin.kv("mail_status", "none");
		expect(blocksText(await rt.admin.loadPage("/settings"))).toContain("This site has no email provider");
	});
});

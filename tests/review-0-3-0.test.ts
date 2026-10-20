// Must load before anything that starts the test host: it patches the sandbox bridge.
import { countBridgeCalls, MAX_BRIDGE_CALLS } from "./bridge-count";

import { PluginBridge } from "@emdash-cms/cloudflare/sandbox";
import { afterEach, describe, expect, it } from "vitest";

import { admin as root, finishUpgrade, install, member, openSite, withPosts } from "./site";

/**
 * 0.3.0 keeps counts by in-database increments in the same call as the write. Each test here makes
 * a race against one counter: something happens at the same moment as a plugin call, and the
 * stored counts must still match the review rows.
 */

let dispose: (() => Promise<void>) | undefined;
afterEach(async () => {
	race = null;
	await dispose?.();
	dispose = undefined;
});

type Row = Record<string, unknown>;
type Site = Awaited<ReturnType<typeof open>>;

/** Runs right before the plugin's `nth` bridge call named `method`, while that call waits. */
let race: { method: string; nth: number; run: () => Promise<unknown> } | null = null;
const proto = PluginBridge.prototype as unknown as Record<string, (...args: unknown[]) => unknown>;
for (const name of ["storageCompareAndSet", "storageUpdateIf", "storageDeleteMany", "storageCount", "kvCompareAndSet"]) {
	const method = proto[name]!;
	proto[name] = async function (this: unknown, ...args: unknown[]) {
		if (race?.method === name && --race.nth === 0) {
			const run = race.run;
			race = null;
			await run();
		}
		return method.apply(this, args);
	};
}

const fromIp = (ip: string) => ({ method: "POST", meta: { ip, userAgent: null, referer: null, geo: null } });

async function open({ fresh = true } = {}) {
	const s = await openSite();
	dispose = s.dispose;
	if (fresh) await install(s.rt);
	const posts = await withPosts(s.rt);
	const entry = `posts:${posts.live}`;
	const write = (who: string, input: Row = {}) => s.call("write", { collection: "posts", id: posts.live, stars: 4, body: "Good.", ...input }, s.as(member(who)));
	const admin = (input: Row) => s.call("admin", input, s.as(root));
	const decide = async (action: string, who: string) => {
		const id = `${entry}:${who}`;
		const row = await s.rt.inspect.storage.get<Row>("reviews", id);
		return admin({ type: "block_action", action_id: "decide", page: "/waiting", value: `${action}|${row?.rev ?? "x"}|${id}` });
	};
	return { ...s, ...posts, entry, write, admin, decide };
}

/** The counts the review rows say, and the counts stored on the rating row and the site record. */
async function check(site: Site) {
	const rows = (await site.rt.inspect.storage.list<Row>("reviews")).map((r) => r.data);
	const published = rows.filter((r) => r.status === "published" && r.entry === site.entry);
	const bars = [1, 2, 3, 4, 5].map((n) => published.filter((r) => r.stars === n).length);
	const rating = (await site.rt.inspect.storage.get<Row>("ratings", site.entry)) ?? {};
	expect([rating.s1, rating.s2, rating.s3, rating.s4, rating.s5].map((n) => Number(n ?? 0)), "rating bars").toEqual(bars);
	expect(Number(rating.t ?? 0), "rating text").toBe(published.filter((r) => r.has_text === true).length);
	const all = rows.filter((r) => r.status === "published");
	const stats = (await site.rt.inspect.storage.get<Row>("stats", "site"))!;
	expect([stats.s1, stats.s2, stats.s3, stats.s4, stats.s5], "site bars").toEqual([1, 2, 3, 4, 5].map((n) => all.filter((r) => r.stars === n).length));
	expect(stats.pending, "site waiting").toBe(rows.filter((r) => r.status === "pending").length);
	expect(stats.changes, "site changes").toBe(all.filter((r) => r.pending_change === true).length);
}

async function within<T>(run: () => Promise<T>): Promise<T> {
	const { result, calls } = await countBridgeCalls(run);
	expect(calls.length, calls.join(",")).toBeLessThanOrEqual(MAX_BRIDGE_CALLS);
	return result;
}

describe("visitor writes", () => {
	it("two first reviews on an unrated page at the same moment both count (approval off)", async () => {
		const site = await open();
		await site.rt.fixtures.plugin.setting("require_moderation", false);
		// Ben's write runs whole while Ana's waits to create the page's rating row.
		race = { method: "storageCompareAndSet", nth: 2, run: () => site.write("ben", { stars: 2 }) };
		expect(await site.write("ana", { stars: 5 })).toMatchObject({ ok: true, status: "published" });
		expect(race).toBeNull();
		await check(site);
		expect(await site.call("list", { collection: "posts", id: site.live }, { method: "GET" })).toMatchObject({ count: 2, average: 3.5 });
	});

	it("the same click twice stores one review and counts it once", async () => {
		const site = await open();
		race = { method: "storageCompareAndSet", nth: 1, run: () => site.write("ana", { body: "Twice." }) };
		await site.write("ana", { body: "Twice." });
		expect(race).toBeNull();
		await check(site);
		expect((await site.rt.inspect.storage.get<Row>("stats", "site"))!.pending).toBe(1);
	});

	it("a change that loses to a parallel change answers BUSY and stores nothing", async () => {
		const site = await open();
		await site.write("ana", { body: "First." });
		// After Ana's change read her row, another change from her other tab lands before her write.
		race = { method: "storageCompareAndSet", nth: 2, run: () => site.write("ana", { body: "From the other tab." }) };
		expect(await site.write("ana", { body: "Lost." })).toMatchObject({ ok: false, error: { code: "BUSY" } });
		expect(await site.rt.inspect.storage.get(`reviews`, `${site.entry}:ana`)).toMatchObject({ body: "From the other tab." });
		await check(site);
	});

	it("a write that loses the rate-limit compare-and-set answers BUSY and stores nothing", async () => {
		const site = await open();
		race = { method: "kvCompareAndSet", nth: 1, run: () => site.rt.fixtures.plugin.kv("rate:write:ana", `${Date.now()}|1`) };
		expect(await site.write("ana")).toMatchObject({ ok: false, error: { code: "BUSY" } });
		expect(await site.rt.inspect.storage.list("reviews")).toHaveLength(0);
	});

	it("the first guest who loses the race to create the site's salt gets BUSY", async () => {
		const site = await open();
		race = { method: "kvCompareAndSet", nth: 1, run: () => site.rt.fixtures.plugin.kv("visitor_salt", "made-by-another-guest") };
		const result = await site.call("write_guest", { collection: "posts", id: site.live, stars: 4, name: "Sam", body: "Hi." }, fromIp("203.0.113.5"));
		expect(result).toMatchObject({ ok: false, error: { code: "BUSY" } });
		expect(await site.rt.inspect.storage.list("reviews")).toHaveLength(0);
	});
});

describe("owner decisions", () => {
	it("an approval and a member's rewrite at the same moment: the stale click is refused, counts unchanged", async () => {
		const site = await open();
		await site.write("ana");
		const rev = String((await site.rt.inspect.storage.get<Row>("reviews", `${site.entry}:ana`))!.rev);
		race = { method: "storageUpdateIf", nth: 1, run: () => site.write("ana", { body: "Rewritten.", stars: 1 }) };
		const screen = await site.admin({ type: "block_action", action_id: "decide", page: "/waiting", value: `approve|${rev}|${site.entry}:ana` });
		expect(screen).toMatchObject({ toast: { type: "error" } });
		expect(await site.rt.inspect.storage.get("reviews", `${site.entry}:ana`)).toMatchObject({ status: "pending", body: "Rewritten." });
		await check(site);
	});

	it("two approvals of the same review count it once", async () => {
		const site = await open();
		await site.write("ana");
		const rev = String((await site.rt.inspect.storage.get<Row>("reviews", `${site.entry}:ana`))!.rev);
		const click = () => site.admin({ type: "block_action", action_id: "decide", page: "/waiting", value: `approve|${rev}|${site.entry}:ana` });
		race = { method: "storageUpdateIf", nth: 1, run: click };
		expect(await click()).toMatchObject({ toast: { type: "error" } });
		await check(site);
		expect((await site.rt.inspect.storage.get<Row>("ratings", site.entry))!.s4).toBe(1);
	});

	it("an approval and a visitor publishing on the same page at the same moment both count", async () => {
		const site = await open();
		await site.write("ana", { stars: 5 });
		await site.write("ben", { stars: 3 });
		await site.decide("approve", "ben");
		await site.rt.fixtures.plugin.setting("require_moderation", false);
		const rev = String((await site.rt.inspect.storage.get<Row>("reviews", `${site.entry}:ana`))!.rev);
		// Carl's review publishes while the owner's approval moves the page's rating.
		race = { method: "storageUpdateIf", nth: 2, run: () => site.write("carl", { stars: 1 }) };
		await site.admin({ type: "block_action", action_id: "decide", page: "/waiting", value: `approve|${rev}|${site.entry}:ana` });
		expect(race).toBeNull();
		await check(site);
	});

	it("approving and rejecting a change, and deleting, keep every count", async () => {
		const site = await open();
		for (const who of ["ana", "ben", "carl"]) {
			await site.write(who, { stars: 4 });
			await site.decide("approve", who);
		}
		await site.write("ana", { stars: 1, body: "" });
		await site.write("ben", { stars: 2 });
		await check(site);
		await within(() => site.decide("approve", "ana"));
		await within(() => site.decide("reject", "ben"));
		await check(site);
		await within(() => site.decide("delete", "carl"));
		await check(site);
		expect(await site.call("list", { collection: "posts", id: site.live }, { method: "GET" })).toMatchObject({ count: 2, total: 1, average: 2.5 });
	});
});

describe("erasing", () => {
	it("two erases of the same member at the same moment take each review off the counts once", async () => {
		const site = await open();
		await site.rt.fixtures.plugin.setting("require_moderation", false);
		await site.write("ana", { stars: 5 });
		await site.write("ben", { stars: 3 });
		race = { method: "storageDeleteMany", nth: 1, run: () => site.call("mine", {}, site.as(member("ana"), "DELETE")) };
		await site.call("mine", {}, site.as(member("ana"), "DELETE"));
		expect(race).toBeNull();
		await check(site);
	});

	it("two callers applying the queued rating changes apply each once", async () => {
		const site = await open();
		await site.rt.fixtures.plugin.setting("require_moderation", false);
		await site.write("ana", { stars: 5 });
		await site.write("ben", { stars: 5 });
		const queued = (n: number) => ({ entry: site.entry, s1: 0, s2: 0, s3: 0, s4: 0, s5: -1, t: -1, n });
		await site.rt.fixtures.plugin.storage("rating_queue", "000000001|a", queued(1));
		await site.rt.fixtures.plugin.storage("rating_queue", "000000002|b", queued(2));
		race = { method: "storageDeleteMany", nth: 1, run: () => site.rt.admin.loadWidget("waiting") };
		await site.rt.admin.loadWidget("waiting");
		expect(race).toBeNull();
		expect(await site.rt.inspect.storage.list("rating_queue")).toHaveLength(0);
		expect((await site.rt.inspect.storage.get<Row>("ratings", site.entry))!.s5).toBe(0);
	});
});

describe("counting the site and the upgrade", () => {
	it("a review written while the site is counted is not lost", async () => {
		const site = await open({ fresh: false });
		for (let n = 0; n < 3; n += 1) {
			await site.rt.fixtures.plugin.storage("reviews", `${site.entry}:old${n}`, {
				entry: site.entry, collection: "posts", entryId: site.live, status: "pending", stars: 3, body: "Old", has_text: true, rev: "r", createdAt: `2026-01-0${n + 1}T00:00:00.000Z`,
			});
		}
		await site.rt.admin.loadPage("/waiting");
		// The record exists, not counted. Ana writes after the first count and before the counts are stored.
		race = { method: "storageCount", nth: 2, run: () => site.write("ana") };
		await site.rt.admin.loadPage("/waiting");
		expect(race).toBeNull();
		await finishUpgrade(site.rt);
		await check(site);
	});

	it("an approval on a page the upgrade already rebuilt counts", async () => {
		const site = await open({ fresh: false });
		for (const [who, status] of [["a", "published"], ["b", "pending"]] as const) {
			await site.rt.fixtures.plugin.storage("reviews", `${site.entry}:${who}`, {
				entry: site.entry, collection: "posts", entryId: site.live, status, stars: 4, body: who, has_text: true, rev: `r-${who}`, createdAt: "2026-01-01T00:00:00.000Z",
			});
		}
		await finishUpgrade(site.rt);
		await site.decide("approve", "b");
		await check(site);
		expect(await site.call("list", { collection: "posts", id: site.live }, { method: "GET" })).toMatchObject({ count: 2 });
	});
});

describe("published state", () => {
	it("unpublishing a page hides its badge, publishing shows it again, through EmDash's own events", async () => {
		const site = await open();
		await site.rt.fixtures.plugin.setting("require_moderation", false);
		await site.write("ana", { stars: 5 });
		const summary = async () => ((await site.call("summary", { collection: "posts", ids: site.live }, { method: "GET" })) as { ratings: Row }).ratings;
		expect(Object.keys(await summary())).toEqual([site.live]);
		await site.rt.actions.content.unpublish("posts", site.live);
		expect(await summary()).toEqual({});
		await site.rt.actions.content.publish("posts", site.live);
		expect(Object.keys(await summary())).toEqual([site.live]);
	});
});

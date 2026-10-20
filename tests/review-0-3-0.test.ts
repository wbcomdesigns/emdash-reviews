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
for (const name of ["storageCompareAndSet", "storageUpdateIf", "storageDeleteMany", "storageCount", "kvCompareAndSet", "storageQuery"]) {
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

describe("security review fixes", () => {
	it("a 0.2.x rating row shows no badge before the upgrade rebuilds it, so an unpublished page never shows one", async () => {
		const site = await open({ fresh: false });
		// As 0.2.2 left them: a rating row for the live post and one for a post that is a draft now.
		await site.rt.fixtures.plugin.storage("ratings", site.entry, { collection: "posts", entryId: site.live, average: 4, count: 2, bars: [0, 0, 0, 2, 0], text_count: 2 });
		await site.rt.fixtures.plugin.storage("ratings", `posts:${site.draft}`, { collection: "posts", entryId: site.draft, average: 5, count: 1, bars: [0, 0, 0, 0, 1], text_count: 1 });
		const { result, calls } = await countBridgeCalls(() => site.call("summary", { collection: "posts", ids: `${site.live},${site.draft}` }, { method: "GET" }));
		expect(calls).toHaveLength(2);
		expect((result as { ratings: Row }).ratings).toEqual({});
	});

	it("delete by email says more remain while waiting changes with that address are left", async () => {
		const site = await open();
		await site.rt.fixtures.plugin.setting("require_moderation", false);
		for (let n = 0; n < 101; n += 1) {
			await site.rt.fixtures.plugin.storage("reviews", `${site.entry}:e${n}`, {
				entry: site.entry, collection: "posts", entryId: site.live, status: "published", stars: 4, body: "Live", has_text: true, rev: "r",
				createdAt: "2026-01-01T00:00:00.000Z", pending_change: true, pending_stars: 1, pending_body: "Edit", pending_author: "Sam", pending_email: "sam@example.com",
			});
		}
		const press = async () =>
			(await within(() => site.admin({ type: "form_submit", action_id: "delete_email", page: "/published", values: { email: "sam@example.com" } }))) as { toast: { message: string; type: string } };
		const first = await press();
		expect(first.toast).toMatchObject({ type: "info" });
		expect(first.toast.message).toContain("More remain");
		const second = await press();
		expect(second.toast.type).toBe("success");
		expect((await site.rt.inspect.storage.list<Row>("reviews")).filter((r) => r.data.pending_email === "sam@example.com")).toHaveLength(0);
	});
});

/** A review row as 0.2.x stored it. */
const oldReview = (site: Site, entryId: string, who: string, extra: Row = {}): [string, Row] => [
	`posts:${entryId}:${who}`,
	{
		entry: `posts:${entryId}`, collection: "posts", entryId, member_id: who, author: who, status: "published", stars: 4, title: "", body: `By ${who}`,
		has_text: true, rev: `r-${who}`, createdAt: "2026-01-01T00:00:00.000Z", ...extra,
	},
];
async function seedOld(site: Site, list: Array<[string, Row]>) {
	for (const [id, row] of list) await site.rt.fixtures.plugin.storage("reviews", id, row);
}
const ratingOf = (site: Site, entry = site.entry) => site.rt.inspect.storage.get<Row>("ratings", entry);
const bars = (row: Row | null) => [row?.s1, row?.s2, row?.s3, row?.s4, row?.s5, row?.t].map((n) => Number(n ?? 0));
async function settle(site: Site, loads = 20) {
	for (let i = 0; i < loads; i += 1) {
		const open = (await site.rt.inspect.storage.list<Row>("ratings")).filter((r) => r.data.ready === false);
		const queued = await site.rt.inspect.storage.list("rating_queue");
		const stats = await site.rt.inspect.storage.get<Row>("stats", "site");
		if (!open.length && !queued.length && stats?.ready === true) return;
		await within(() => site.rt.admin.loadWidget("waiting"));
		await within(() => site.rt.admin.loadPage("/waiting"));
	}
	throw new Error("Upkeep did not settle");
}

describe("independent review fixes", () => {
	it("M1: an open content type that no longer exists does not stop the upgrade", async () => {
		const site = await open({ fresh: false });
		await site.rt.fixtures.plugin.setting("collections", "posts,gone");
		await seedOld(site, [oldReview(site, site.live, "a")]);
		await finishUpgrade(site.rt);
		expect(bars(await ratingOf(site))).toEqual([0, 0, 0, 1, 0, 1]);
	});

	it("M2: an erase on a page being counted makes it count again, and finishes after the upgrade", async () => {
		const site = await open();
		await site.rt.fixtures.plugin.setting("require_moderation", false);
		await site.write("ana", { stars: 4 });
		await site.write("ben", { stars: 4 });
		// Half counted: s1 to s3 were counted, then Ana erases.
		await site.rt.fixtures.plugin.storage("ratings", site.entry, { ...(await ratingOf(site)), ready: false, step: 3 });
		await within(() => site.call("mine", {}, site.as(member("ana"), "DELETE")));
		await settle(site);
		expect(await ratingOf(site)).toMatchObject({ ready: true });
		await check(site);
	});

	it("M2: a queued change made before the page was counted again is dropped", async () => {
		const site = await open();
		await site.rt.fixtures.plugin.setting("require_moderation", false);
		await site.write("ana", { stars: 5 });
		const row = (await ratingOf(site))!;
		// Counted again since (epoch 1), so its count already leaves out what the queued change removes.
		await site.rt.fixtures.plugin.storage("ratings", site.entry, { ...row, epoch: 1 });
		await site.rt.fixtures.plugin.storage("rating_queue", "000000001|a", { entry: site.entry, recount: false, epoch: 0, s1: 0, s2: 0, s3: 0, s4: 0, s5: -1, t: -1 });
		await site.rt.admin.loadWidget("waiting");
		expect(await site.rt.inspect.storage.list("rating_queue")).toHaveLength(0);
		await check(site);
	});

	it("M3: a 0.2.x rating row for a page with no reviews is rebuilt, and later reviews on it count", async () => {
		const site = await open({ fresh: false });
		await seedOld(site, [oldReview(site, "elsewhere", "x")]);
		await site.rt.fixtures.plugin.storage("ratings", site.entry, { collection: "posts", entryId: site.live, average: 4, count: 3, bars: [0, 0, 0, 3, 0], text_count: 3 });
		await finishUpgrade(site.rt);
		expect(await site.call("list", { collection: "posts", id: site.live }, { method: "GET" })).toMatchObject({ count: 0 });
		await site.rt.fixtures.plugin.setting("require_moderation", false);
		await site.write("ana", { stars: 2 });
		expect(await site.call("summary", { collection: "posts", ids: site.live }, { method: "GET" })).toMatchObject({ ratings: { [site.live]: { count: 1, average: 2 } } });
	});

	it("M4: Waiting shows its reviews while the upgrade runs, with the progress line on top", async () => {
		const site = await open({ fresh: false });
		await seedOld(site, [oldReview(site, site.live, "pat", { author: "Pending Pat", status: "pending" })]);
		const page = JSON.stringify(await within(() => site.rt.admin.loadPage("/waiting")));
		expect(page).toContain("Updating your reviews for this version");
		expect(page).toContain("Pending Pat");
		expect(page).toContain('"type":"table"');
	});

	it("L1: two callers claiming queued work at once apply every item exactly once", async () => {
		const site = await open();
		await site.rt.fixtures.plugin.setting("require_moderation", false);
		for (const who of ["ana", "ben", "carl"]) await site.write(who, { stars: 5 });
		for (const n of [1, 2, 3]) {
			await site.rt.fixtures.plugin.storage("rating_queue", `00000000${n}|q`, { entry: site.entry, recount: false, epoch: 0, s1: 0, s2: 0, s3: 0, s4: 0, s5: -1, t: 0 });
		}
		race = { method: "storageDeleteMany", nth: 1, run: () => site.rt.admin.loadPage("/waiting") };
		await site.rt.admin.loadWidget("waiting");
		expect(race).toBeNull();
		await settle(site);
		expect((await ratingOf(site))!.s5).toBe(0);
	});

	it("L2: an erase that races a decision on the same reviews counts the pages and the site again", async () => {
		const site = await open();
		await site.rt.fixtures.plugin.setting("require_moderation", false);
		const other = await site.rt.fixtures.content("posts", { data: { title: "Other" }, slug: "other", status: "published" } as never);
		await site.write("ana", { stars: 3 });
		await site.call("write", { collection: "posts", id: other.id, stars: 5, body: "Yes." }, site.as(member("ana")));
		await site.write("ben", { stars: 1 });
		race = { method: "storageDeleteMany", nth: 1, run: () => site.decide("delete", "ana") };
		await site.call("mine", {}, site.as(member("ana"), "DELETE"));
		expect(race).toBeNull();
		await settle(site);
		await check(site);
		expect(bars(await ratingOf(site, `posts:${other.id}`))).toEqual([0, 0, 0, 0, 0, 0]);
	});

	it("L3: a slow upgrade step never puts back an older state", async () => {
		const site = await open({ fresh: false });
		await seedOld(site, Array.from({ length: 350 }, (_, n) => oldReview(site, `p${String(n).padStart(3, "0")}`, "a")));
		const press = () => site.admin({ type: "block_action", action_id: "upgrade", page: "/waiting", value: "waiting|1|||" });
		const state = async () => ((await site.rt.inspect.storage.get<Row>("stats", "site"))?.upgrade ?? {}) as Row;
		for (let i = 0; i < 10 && (await state()).phase !== "ratings"; i += 1) await press();
		expect((await state()).phase).toBe("ratings");
		let ahead: Row = {};
		// This press reads the next page; meanwhile two other presses go further.
		race = { method: "storageQuery", nth: 1, run: async () => (await press(), await press(), (ahead = await state())) };
		await press();
		expect(race).toBeNull();
		expect((await state()).after).toBe(ahead.after);
	});

	it("L4: a page restored from the trash is live again only when it comes back published", async () => {
		const site = await open();
		await site.rt.fixtures.plugin.setting("require_moderation", false);
		await site.write("ana", { stars: 5 });
		const live = async () => (await ratingOf(site))!.live;
		const until = async (want: boolean) => {
			for (let i = 0; i < 50 && (await live()) !== want; i += 1) await new Promise((r) => setTimeout(r, 20));
			return live();
		};
		await site.rt.actions.content.trash("posts", site.live);
		expect(await until(false)).toBe(false);
		// EmDash restores into a draft: no badge.
		await site.rt.actions.content.restore("posts", site.live);
		expect(await until(false)).toBe(false);
		// A restore that comes back published shows the badge again.
		await site.rt.transport.invokeHook("content:afterRestore", { collection: "posts", content: { id: site.live, status: "published" } });
		expect(await live()).toBe(true);
	});

	it("L5: a busy live page keeps its 0.2.x rating while it is counted field by field", async () => {
		const site = await open({ fresh: false });
		await seedOld(site, Array.from({ length: 101 }, (_, n) => oldReview(site, site.live, `m${n}`)));
		await site.rt.fixtures.plugin.storage("ratings", site.entry, { collection: "posts", entryId: site.live, average: 4, count: 101, bars: [0, 0, 0, 101, 0], text_count: 101 });
		for (let i = 0; i < 20; i += 1) {
			const row = await ratingOf(site);
			if (row?.v === 3 && row.ready === false) break;
			await site.admin({ type: "block_action", action_id: "upgrade", page: "/waiting", value: "waiting|1|||" });
		}
		expect(await ratingOf(site)).toMatchObject({ v: 3, ready: false });
		expect(await site.call("summary", { collection: "posts", ids: site.live }, { method: "GET" })).toMatchObject({ ratings: { [site.live]: { count: 101, average: 4 } } });
		await finishUpgrade(site.rt);
		expect(bars(await ratingOf(site))).toEqual([0, 0, 0, 101, 0, 101]);
	});

	it("L8: the review to decide shows the member's text exactly, in a code block, without invisible characters", async () => {
		const site = await open();
		await site.write("ana", { body: "**Not bold** and `not code`\u200B\u202E" });
		const row = (await site.rt.inspect.storage.get<Row>("reviews", `${site.entry}:ana`))!;
		expect(row.body).toBe("**Not bold** and `not code`");
		const screen = (await site.admin({ type: "block_action", action_id: "decide", page: "/waiting", value: `read|${row.rev}|${site.entry}:ana` })) as { blocks: Row[] };
		expect(screen.blocks).toContainEqual(expect.objectContaining({ type: "code", code: "**Not bold** and `not code`" }));
	});
});

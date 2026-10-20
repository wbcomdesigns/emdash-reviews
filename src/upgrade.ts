import type { PluginContext } from "emdash/plugin";

import { entryKey, loadSettings, siteCollections } from "./core";
import {
	freshRating,
	legacyNumbers,
	MAX_CALLS,
	partOf,
	plus,
	RATINGS,
	ratingFields,
	readStats,
	SITE,
	spend,
	STAT_FIELDS,
	STATS,
	stepCount,
	V,
	zero,
	type Budget,
	type Counts,
	type Stats,
} from "./counts";
import { asNumber, asRecord, asString } from "./util";

/**
 * Bringing 0.2.x data into the 0.3.0 counts, a few steps per call (Cloudflare allows 10 requests per
 * plugin call). Run on admin page loads (Continue on the progress screen) and by the hourly task.
 * The state is `upgrade` on the site record (`stats/site`):
 *
 * 1. The site record is made (not ready) and its counts are counted, guarded so a review written
 *    meanwhile is never lost (counts.ts stepCount).
 * 2. `kit`: the "visitor pages are set up" answer moves from a key of its own onto the site record,
 *    and the content types open for reviews are noted.
 * 3. `entries`: the published entries of those types, 100 per read, are stored by id with their
 *    title (`entries`), so reviews written before 0.3.0 can be named and their page known as live.
 * 4. `ratings`: every review, 100 per read in page order, is counted into a 0.3.0 rating row for its
 *    page, keeping the address and live flag a 0.3.0 write already stored. A page with more than 100
 *    reviews gets a row that is not ready yet.
 * 5. `legacy`: rating rows still in 0.2.x shape (pages whose reviews were all deleted) are read 100
 *    at a time and made 0.3.0 rows that are not ready, so step 6 counts them from their reviews and
 *    later writes on those pages are counted.
 * 6. `counting`: rows that are not ready are counted field by field (stepCount).
 *
 * A new install has nothing to bring over: plugin:install stores a finished record. Each state write
 * is guarded by `useq`, so a slow call (an hourly run) never puts back an older state.
 * ponytail: step 4 writes whole rows, so a review decided in the one call between the read of a page
 * and the write of its rows is missing from that page's count. The owner's next decision on that page
 * moves its count again; a Recount would need its own screen.
 */
export const KIT_DONE = "kit_done";
export const ENTRIES = "entries";
export const DONE = "done";

type State = { phase: string; cols: string[]; ci: number; cursor: string; after: string; rcursor: string };

function stateOf(raw: Record<string, unknown>): State {
	return {
		phase: asString(raw.phase) || "kit",
		cols: Array.isArray(raw.cols) ? raw.cols.map(asString).filter(Boolean) : [],
		ci: Number(raw.ci) || 0,
		cursor: asString(raw.cursor),
		after: asString(raw.after),
		rcursor: asString(raw.rcursor),
	};
}

export function upgradeDone(stats: Stats): boolean {
	return stats.exists && stats.ready && asString(stats.upgrade.phase) === DONE;
}

/** What the progress screen says about where the upgrade is. */
export function upgradeLabel(stats: Stats): string {
	if (!stats.exists || !stats.ready) return "Counting reviews";
	const phase = asString(stats.upgrade.phase);
	if (phase === "entries" || phase === "kit") return "Reading page titles";
	if (phase === "ratings" || phase === "legacy") return "Rebuilding page ratings";
	return "Counting the busiest pages";
}

/** A finished site record with every count at zero. */
export function emptySite(kitDone = false): Record<string, unknown> {
	return { v: V, seq: 0, useq: 0, step: STAT_FIELDS.length, ready: true, pending: 0, changes: 0, s1: 0, s2: 0, s3: 0, s4: 0, s5: 0, kit_done: kitDone, upgrade: { phase: DONE } };
}

/**
 * The first site record. With no reviews there is nothing to bring over, so it starts finished
 * (keeping a 0.2.x "visitor pages are set up" answer): three calls. Otherwise it starts counting
 * (two calls). Returns the finished record, or null when the upgrade has to run.
 */
export async function startSite(ctx: PluginContext): Promise<Record<string, unknown> | null> {
	if ((await ctx.storage.reviews.count()) === 0) {
		const site = emptySite((await ctx.kv.get<boolean>(KIT_DONE)) === true);
		const made = await ctx.storage[STATS]!.compareAndSet(SITE, null, site).catch(() => ({ applied: false }));
		return made.applied ? site : null;
	}
	const counting = { v: V, seq: 0, useq: 0, step: 0, ready: false, pending: 0, changes: 0, s1: 0, s2: 0, s3: 0, s4: 0, s5: 0, upgrade: { phase: "kit" } };
	await ctx.storage[STATS]!.compareAndSet(SITE, null, counting).catch(() => undefined);
	return null;
}

/**
 * Run upgrade steps with what is left of the budget after `reserve` (calls the caller needs after).
 * `raw` is the site record the caller already read (null when there is none). Returns true when the
 * upgrade is finished.
 */
export async function upgradeStep(ctx: PluginContext, b: Budget, raw: unknown, reserve = 0): Promise<boolean> {
	if (raw === null || raw === undefined) {
		if (b.used + 3 + reserve > MAX_CALLS || !spend(b, 3)) return false;
		return (await startSite(ctx)) !== null;
	}
	const row = asRecord(raw);
	if (row.ready !== true) {
		const inner = { used: b.used + reserve };
		const counted = await stepCount(ctx, STATS, SITE, STAT_FIELDS, inner, row);
		b.used = inner.used - reserve;
		return counted && asString(asRecord(row.upgrade).phase) === DONE;
	}
	const state = stateOf(asRecord(row.upgrade));
	if (state.phase === DONE) return true;
	const start = JSON.stringify(state);
	let kit: boolean | undefined;
	// One call is kept for saving the state.
	const fits = (n: number) => b.used + n + 1 + reserve <= MAX_CALLS;

	while (state.phase !== DONE) {
		if (state.phase === "kit") {
			if (!fits(3)) break;
			spend(b, 3);
			kit = (await ctx.kv.get<boolean>(KIT_DONE)) === true;
			// Only content types the site has: reading one it does not have fails.
			const known = new Set((await siteCollections(ctx).catch(() => [])).map((item) => item.slug));
			state.cols = (await loadSettings(ctx)).collections.filter((slug) => known.has(slug));
			Object.assign(state, { phase: "entries", ci: 0, cursor: "" });
			continue;
		}
		if (state.phase === "entries") {
			const col = state.cols[state.ci];
			if (!col) {
				Object.assign(state, { phase: "ratings", after: "" });
				continue;
			}
			if (!fits(2)) break;
			spend(b);
			// A content type that no longer exists (or posts on a site without them) has nothing to read.
			const page = await ctx.content?.list(col, { limit: 100, cursor: state.cursor || undefined, where: { status: "published" } }).catch(() => null);
			const items = page?.items ?? [];
			spend(b);
			if (items.length) {
				await ctx.storage[ENTRIES]!.putMany(
					items.map((item) => ({
						id: entryKey(col, item.id),
						data: { collection: col, entryId: item.id, title: asString(asRecord(item.data).title) || item.slug || "" },
					})),
				);
			}
			if (page?.hasMore && page.cursor) state.cursor = page.cursor;
			else Object.assign(state, { ci: state.ci + 1, cursor: "" });
			continue;
		}
		if (state.phase === "ratings") {
			if (!fits(4)) break;
			spend(b);
			const page = await ctx.storage.reviews.query({
				where: state.after ? { entry: { gt: state.after } } : undefined,
				orderBy: { entry: "asc" },
				limit: 100,
			});
			const byEntry = new Map<string, Array<Record<string, unknown>>>();
			for (const item of page.items) {
				const data = asRecord(item.data);
				const key = asString(data.entry);
				if (key) byEntry.set(key, [...(byEntry.get(key) ?? []), data]);
			}
			const keys = [...byEntry.keys()];
			if (!keys.length) {
				Object.assign(state, { phase: "legacy", rcursor: "" });
				continue;
			}
			// With more to read, the last page in this read may go on in the next one. A read that is all one page is that page's whole count: it is counted field by field instead.
			const big = page.hasMore && keys.length === 1 ? keys[0]! : null;
			const complete = big ? [] : page.hasMore ? keys.slice(0, -1) : keys;
			const ids = big ? [big] : complete;
			spend(b, 3);
			const [live, stored] = await Promise.all([ctx.storage[ENTRIES]!.getMany(ids), ctx.storage[RATINGS]!.getMany(ids)]);
			const rows = ids.map((key) => {
				const was = asRecord(stored.get(key));
				// A new epoch: changes queued against the row before it was counted again are dropped.
				const keep = {
					...(was.v === V ? { live: was.live !== false, url: asString(was.url) } : { live: live.has(key), url: "" }),
					epoch: (asNumber(was.epoch) ?? 0) + 1,
				};
				// Counted field by field over later calls; meanwhile it shows its 0.2.x numbers (a live page only).
				if (key === big) return { id: key, data: { ...freshRating(key, zero(), keep), step: 0, ready: false, legacy: legacyNumbers(was) } };
				const counts = (byEntry.get(key) ?? []).reduce<Counts>((sum, review) => plus(sum, partOf(review)), zero());
				return { id: key, data: freshRating(key, counts, keep) };
			});
			await ctx.storage[RATINGS]!.putMany(rows);
			state.after = ids[ids.length - 1]!;
			if (!page.hasMore) Object.assign(state, { phase: "legacy", rcursor: "" });
			continue;
		}
		if (state.phase === "legacy") {
			if (!fits(3)) break;
			spend(b);
			const page = await ctx.storage[RATINGS]!.query({ limit: 100, cursor: state.rcursor || undefined });
			const old = page.items.filter((item) => asRecord(item.data).v !== V);
			if (old.length) {
				spend(b, 2);
				const live = await ctx.storage[ENTRIES]!.getMany(old.map((item) => item.id));
				await ctx.storage[RATINGS]!.putMany(
					old.map((item) => ({
						id: item.id,
						data: { ...freshRating(item.id, zero(), { live: live.has(item.id), epoch: 1 }), step: 0, ready: false, legacy: live.has(item.id) ? legacyNumbers(item.data) : null },
					})),
				);
			}
			if (page.hasMore && page.cursor) state.rcursor = page.cursor;
			else state.phase = "counting";
			continue;
		}
		// counting
		if (!fits(4)) break;
		spend(b);
		const open = await ctx.storage[RATINGS]!.query({ where: { ready: false }, limit: 1 });
		const next = open.items[0];
		if (!next) {
			state.phase = DONE;
			continue;
		}
		// The save and the caller's reserve are kept out of stepCount's budget.
		const inner = { used: b.used + 1 + reserve };
		await stepCount(ctx, RATINGS, next.id, ratingFields(next.id), inner, asRecord(next.data));
		b.used = inner.used - 1 - reserve;
		break;
	}

	if (JSON.stringify(state) !== start || kit !== undefined) {
		spend(b);
		// Only over the state this call read: a call that started earlier and ends later is refused.
		const saved = await ctx.storage[STATS]!.updateIf(SITE, {
			where: { useq: asNumber(row.useq) ?? 0 },
			set: { upgrade: state, ...(kit !== undefined ? { kit_done: kit } : {}) },
			delta: { useq: { inc: 1 } },
		}).catch(() => ({ applied: false as const }));
		if (!saved.applied) return false;
	}
	return state.phase === DONE;
}

/** Read the site record and run what fits of the upgrade. Returns the record as read, whether the upgrade was already finished, and whether this call finished it. */
export async function siteAndUpgrade(ctx: PluginContext, b: Budget, run: boolean, reserve = 0): Promise<{ stats: Stats; done: boolean; finished?: boolean }> {
	spend(b);
	const raw = await ctx.storage[STATS]!.get(SITE);
	const stats = readStats(raw);
	if (upgradeDone(stats)) return { stats, done: true };
	if (!run) return { stats, done: false };
	if (!raw) {
		// A site with no reviews starts finished, and its first screen is the normal one.
		if (b.used + 3 + reserve > MAX_CALLS) return { stats, done: false };
		spend(b, 3);
		const made = await startSite(ctx);
		return made ? { stats: readStats(made), done: true } : { stats, done: false };
	}
	// `finished`: this call's step ended the upgrade. The record read above is from before it.
	return { stats, done: false, finished: await upgradeStep(ctx, b, raw, reserve) };
}

import type { PluginContext } from "emdash/plugin";

import {
	MAX_CALLS,
	minus,
	moveRatingIn,
	moveStats,
	partOf,
	queueChanges,
	RATINGS,
	recountRating,
	spend,
	statsChange,
	sumChanges,
	V,
	zero,
	type Budget,
	type Counts,
	type QueueItem,
	type Stats,
	type StatsChange,
} from "./counts";
import { asNumber, asRecord, asString } from "./util";

/**
 * Erase every review matching `where` (a member's own, or a guest email), 100 per read, with what is
 * left of the budget after `reserve` (calls the caller needs afterwards). `more` says rows are left
 * for another call.
 *
 * The site counts move in one write. Then one read of the touched pages' rating rows decides each
 * page's work: a ready row takes the change (in this call while the budget lasts, else queued with
 * the row's epoch, so it is dropped if the row is counted again before the queue reaches it); a row
 * being counted is counted again from the start, because fields it counted before the erase would
 * keep the erased reviews; a 0.2.x row is left to the upgrade, which counts it from the reviews.
 *
 * A delete that removed fewer rows than were read raced another erase or a decision on the same rows,
 * and which of them each removed is unknown: the site record and those pages are counted again
 * instead of guessing.
 */
export async function eraseRows(
	ctx: PluginContext,
	b: Budget,
	where: Record<string, unknown>,
	reserve = 0,
	extra: StatsChange | null = null,
): Promise<{ erased: number; more: boolean; stats: Stats | null }> {
	// After the pages: the site counts, the rating rows read and the queue.
	const fits = (n: number) => b.used + n + 3 + reserve <= MAX_CALLS;
	const removed: Array<Record<string, unknown>> = [];
	const unsure = new Set<string>();
	let erased = 0;
	let more = true;
	while (fits(2)) {
		spend(b);
		const found = await ctx.storage.reviews.query({ where: where as never, limit: 100 });
		if (!found.items.length) {
			more = false;
			break;
		}
		spend(b);
		const gone = await ctx.storage.reviews.deleteMany(found.items.map((item) => item.id));
		erased += gone;
		const read = found.items.map((item) => item.data as Record<string, unknown>);
		if (gone === found.items.length) removed.push(...read);
		else for (const row of read) unsure.add(asString(row.entry));
		more = found.hasMore;
		if (!more) break;
	}
	if (!removed.length && !unsure.size && !extra) return { erased, more, stats: null };

	const changes: StatsChange[] = removed.map((row) => statsChange(row, null));
	if (extra) changes.push(extra);
	spend(b);
	const stats = await moveStats(ctx, sumChanges(changes), unsure.size ? { ready: false, step: 0 } : {});

	const byEntry = new Map<string, Counts>();
	for (const row of removed) {
		const key = asString(row.entry);
		const part = minus(zero(), partOf(row));
		const sum = byEntry.get(key) ?? zero();
		for (const f of Object.keys(part) as Array<keyof Counts>) sum[f] += part[f];
		byEntry.set(key, sum);
	}
	const keys = [...new Set([...byEntry.keys(), ...unsure])].filter(Boolean);
	if (!keys.length) return { erased, more, stats };
	spend(b);
	const stored = await ctx.storage[RATINGS]!.getMany(keys);
	const work: QueueItem[] = [];
	for (const key of keys) {
		const row = asRecord(stored.get(key));
		if (row.v !== V) continue;
		const change = byEntry.get(key) ?? zero();
		const recount = unsure.has(key) || row.ready !== true;
		if (!recount && Object.values(change).every((n) => !n)) continue;
		work.push({ entry: key, recount, epoch: asNumber(row.epoch) ?? 0, change });
	}
	// Recounts first: a page left half counted would keep the erased reviews for good.
	work.sort((x, y) => Number(y.recount) - Number(x.recount));
	const later: QueueItem[] = [];
	for (const item of work) {
		// One call is kept for the queue.
		if (b.used + 1 + 1 + reserve <= MAX_CALLS) {
			spend(b);
			if (item.recount) await recountRating(ctx, item.entry);
			else await moveRatingIn(ctx, item.entry, item.change, item.epoch);
		} else later.push(item);
	}
	if (later.length && spend(b)) await queueChanges(ctx, later);
	return { erased, more, stats };
}

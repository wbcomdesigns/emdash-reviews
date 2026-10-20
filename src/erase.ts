import type { PluginContext } from "emdash/plugin";

import { MAX_CALLS, minus, moveRating, moveStats, partOf, queueChanges, spend, statsChange, sumChanges, zero, type Budget, type Counts, type Stats, type StatsChange } from "./counts";
import { queueable } from "./upgrade";
import { asString } from "./util";

/**
 * Erase every review matching `where` (a member's own, or a guest email), 100 per read, with what is
 * left of the budget after `reserve` (calls the caller needs afterwards). The site counts move in one
 * write; each page's rating moves in one write while the budget allows, and the rest are queued and
 * applied by later admin loads and the hourly task. `more` says rows are left for another call.
 *
 * A page whose delete removed fewer rows than were read lost a race with another erase of the same
 * rows: its counts are left to the call that removed them.
 */
export async function eraseRows(
	ctx: PluginContext,
	b: Budget,
	where: Record<string, unknown>,
	reserve = 0,
	extra: StatsChange | null = null,
): Promise<{ erased: number; more: boolean; stats: Stats | null }> {
	// After the pages: the site counts and the queue.
	const fits = (n: number) => b.used + n + 2 + reserve <= MAX_CALLS;
	const removed: Array<Record<string, unknown>> = [];
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
		if (gone === found.items.length) removed.push(...found.items.map((item) => item.data as Record<string, unknown>));
		more = found.hasMore;
		if (!more) break;
	}
	if (!removed.length && !extra) return { erased, more, stats: null };

	const changes: StatsChange[] = removed.map((row) => statsChange(row, null));
	if (extra) changes.push(extra);
	spend(b);
	const stats = await moveStats(ctx, sumChanges(changes));
	const byEntry = new Map<string, Counts>();
	for (const row of removed) {
		const key = asString(row.entry);
		const part = minus(zero(), partOf(row));
		const sum = byEntry.get(key) ?? zero();
		for (const f of Object.keys(part) as Array<keyof Counts>) sum[f] += part[f];
		byEntry.set(key, sum);
	}
	const later = new Map<string, Counts>();
	for (const [key, change] of byEntry) {
		if (Object.values(change).every((n) => !n)) continue;
		// One call is kept for the queue.
		if (b.used + 1 + 1 + reserve <= MAX_CALLS) {
			spend(b);
			await moveRating(ctx, key, change);
		} else if (queueable(stats, key)) later.set(key, change);
	}
	if (later.size && spend(b)) await queueChanges(ctx, later);
	return { erased, more, stats };
}

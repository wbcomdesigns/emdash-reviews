import type { PluginContext } from "emdash/plugin";

import { asNumber, asRecord, asString } from "./util";

/**
 * Bridge calls one plugin call may make. On Cloudflare each route, hook, admin action and cron run
 * gets 10 requests to the site, and every ctx.storage, ctx.kv, ctx.settings, ctx.content, ctx.schema
 * and ctx.email call is one. One under the limit, for headroom (tests/bridge-budget.test.ts).
 */
export const MAX_CALLS = 9;

/** Calls made so far in this plugin call. Optional work spends from it and stops when it is empty. */
export type Budget = { used: number };

export const budget = (used = 0): Budget => ({ used });

/** Take `n` calls from the budget. False, and nothing taken, when they would pass MAX_CALLS. */
export function spend(b: Budget, n = 1): boolean {
	if (b.used + n > MAX_CALLS) return false;
	b.used += n;
	return true;
}

/**
 * Stored counts, kept by in-database increments in the same call as the review write (0.3.0).
 *
 * `ratings/<collection>:<entryId>`, one per reviewed page: `s1`..`s5` published reviews per star,
 * `t` published reviews with text, `live` (false once the page is unpublished or deleted), `url`
 * (its public address, for My reviews), `seq` (moves with every change), `step` and `ready`.
 * Count, sum and average are worked out from `s1`..`s5`, so a change is a few +1 and -1 and never
 * needs the old numbers.
 *
 * `stats/site`, one for the site: `pending`, `changes` (published reviews with a change waiting),
 * `s1`..`s5` over every published review, the setup state (`kit_done`) and the 0.2.x upgrade state.
 *
 * Rows from 0.2.x (`average`, `count`, `bars`, no `v`) are read as they are until the upgrade
 * rebuilds them (src/upgrade.ts). A row that is `ready: false` is being counted: readers show no
 * numbers for it rather than part of them.
 */
export const RATINGS = "ratings";
export const STATS = "stats";
export const SITE = "site";
/** Rating changes a bulk erase could not apply in its own call. Applied on later admin loads and by the hourly task. */
export const QUEUE = "rating_queue";
export const V = 3;

export const FIELDS = ["s1", "s2", "s3", "s4", "s5", "t"] as const;
export type Counts = Record<(typeof FIELDS)[number], number>;

type Delta = { inc: number } | { dec: number };
type Where = Record<string, unknown>;
type Ctx = Pick<PluginContext, "storage">;

export const zero = (): Counts => ({ s1: 0, s2: 0, s3: 0, s4: 0, s5: 0, t: 0 });

/** What one review adds to its page's rating: one at its star level, and one to `t` when it has text. Nothing unless published. */
export function partOf(row: Record<string, unknown> | null | undefined): Counts {
	const part = zero();
	if (!row || asString(row.status) !== "published") return part;
	const stars = Math.min(Math.max(Math.round(asNumber(row.stars) ?? 0), 1), 5);
	part[`s${stars}` as keyof Counts] = 1;
	if (row.has_text === true) part.t = 1;
	return part;
}

export function minus(after: Counts, before: Counts): Counts {
	const out = zero();
	for (const f of FIELDS) out[f] = after[f] - before[f];
	return out;
}

export function plus(a: Counts, b: Counts): Counts {
	const out = zero();
	for (const f of FIELDS) out[f] = a[f] + b[f];
	return out;
}

export const isZero = (c: Counts) => FIELDS.every((f) => !c[f]);

function deltaOf(values: Record<string, number>): Record<string, Delta> {
	const out: Record<string, Delta> = {};
	for (const [key, n] of Object.entries(values)) if (n) out[key] = n > 0 ? { inc: n } : { dec: -n };
	return out;
}

export function entryParts(entry: string): { collection: string; entryId: string } {
	const split = entry.indexOf(":");
	return { collection: entry.slice(0, split), entryId: entry.slice(split + 1) };
}

/**
 * `epoch` goes up each time a row is counted again from its reviews (the upgrade rebuild, a recount).
 * A queued change records the epoch it was made against and is dropped when the row was counted again since.
 */
export function freshRating(entry: string, counts: Counts, extra: { live?: boolean; url?: string; epoch?: number } = {}): Record<string, unknown> {
	return { v: V, ...entryParts(entry), ...counts, seq: 0, epoch: extra.epoch ?? 0, step: FIELDS.length, ready: true, live: extra.live !== false, url: extra.url ?? "" };
}

/** A 0.2.x row's numbers, kept on its rebuilt row while that row is counted, so the page keeps its rating meanwhile. */
export function legacyNumbers(data: unknown): Record<string, unknown> | null {
	const row = asRecord(data);
	if (row.v === V || !asNumber(row.count)) return null;
	return { count: asNumber(row.count), average: asNumber(row.average) ?? 0, bars: Array.isArray(row.bars) ? row.bars : null, text: asNumber(row.text_count) ?? 0 };
}

export type Rating = { count: number; average: number; bars: number[]; text: number; live: boolean; ready: boolean; url: string };

/** A rating row as visitors see it, from a 0.3.0 row or a 0.2.x one. Null when there is none. */
export function readRating(data: unknown): Rating | null {
	if (data === null || data === undefined) return null;
	const row = asRecord(data);
	if (row.v === V) {
		const bars = [1, 2, 3, 4, 5].map((n) => Math.max(0, asNumber(row[`s${n}`]) ?? 0));
		const count = bars.reduce((a, b) => a + b, 0);
		const sum = bars.reduce((a, b, i) => a + b * (i + 1), 0);
		const ready = row.ready === true;
		const old = ready ? null : asRecord(row.legacy);
		// Being counted: a page rebuilt from 0.2.x shows its 0.2.x numbers until the count is done; a
		// page counted again shows the numbers it had, which only the recounted fields change.
		if (old && asNumber(old.count)) {
			return {
				count: asNumber(old.count) ?? 0,
				average: asNumber(old.average) ?? 0,
				bars: Array.isArray(old.bars) ? old.bars.map((n) => asNumber(n) ?? 0) : [0, 0, 0, 0, 0],
				text: asNumber(old.text) ?? 0,
				live: row.live !== false,
				ready,
				url: asString(row.url),
			};
		}
		return {
			count,
			average: count ? Math.round((sum / count) * 10) / 10 : 0,
			bars,
			text: Math.max(0, asNumber(row.t) ?? 0),
			live: row.live !== false,
			ready,
			url: asString(row.url),
		};
	}
	// 0.2.x: rows from 0.2.0 have no bars; the upgrade rebuilds them. The row cannot say whether its
	// page is still published, so it is not live: no badge shows from it until the upgrade rebuilds it
	// from the published entries. The list route checks the entry itself and still shows its numbers.
	const bars = Array.isArray(row.bars) ? row.bars.map((n) => asNumber(n) ?? 0) : [0, 0, 0, 0, 0];
	return {
		count: asNumber(row.count) ?? 0,
		average: asNumber(row.average) ?? 0,
		bars,
		text: asNumber(row.text_count) ?? 0,
		live: false,
		ready: true,
		url: "",
	};
}

/** Apply a change to a 0.3.0 rating row in one guarded write. Rows from 0.2.x are left to the upgrade. Never throws. */
export async function moveRating(ctx: Ctx, entry: string, change: Counts, set: Record<string, unknown> = {}): Promise<boolean> {
	if (isZero(change) && !Object.keys(set).length) return true;
	const delta = deltaOf(change);
	const done = await ctx.storage[RATINGS]!.updateIf(entry, {
		where: { v: V },
		...(Object.keys(set).length ? { set } : {}),
		delta: { ...delta, seq: { inc: 1 } },
	}).catch(() => ({ applied: false as const }));
	return done.applied;
}

/**
 * Add a review that was just published to its page's rating, creating the row when the page has
 * none. `createFirst` tries the create first (a visitor's first review, where a missing row is
 * likely). Two calls at most, three when another call created the row in between. Never throws.
 */
export async function addToRating(
	ctx: Ctx,
	entry: string,
	change: Counts,
	opts: { set?: Record<string, unknown>; createFirst?: boolean; url?: string } = {},
): Promise<void> {
	const create = () =>
		ctx.storage[RATINGS]!.compareAndSet(entry, null, freshRating(entry, change, { url: opts.url }))
			.then((r) => r.applied)
			.catch(() => false);
	if (opts.createFirst) {
		if (await create()) return;
		await moveRating(ctx, entry, change, opts.set);
		return;
	}
	if (await moveRating(ctx, entry, change, opts.set)) return;
	// No 0.3.0 row: none at all (create it), or a 0.2.x row (the create fails, the upgrade rebuilds it).
	if (await create()) return;
	await moveRating(ctx, entry, change, opts.set);
}

/** Make sure a page that has a review waiting has a rating row, so its public address is kept for My reviews. One call. */
export async function ensureRating(ctx: Ctx, entry: string, url: string): Promise<void> {
	await ctx.storage[RATINGS]!.compareAndSet(entry, null, freshRating(entry, zero(), { url })).catch(() => undefined);
}

export type StatsChange = { pending?: number; changes?: number; counts?: Counts };

export type Stats = {
	exists: boolean;
	ready: boolean;
	pending: number;
	changes: number;
	published: number;
	average: number;
	kitDone: boolean | null;
	upgrade: Record<string, unknown>;
};

export function readStats(data: unknown): Stats {
	const row = asRecord(data);
	const bars = [1, 2, 3, 4, 5].map((n) => Math.max(0, asNumber(row[`s${n}`]) ?? 0));
	const published = bars.reduce((a, b) => a + b, 0);
	const sum = bars.reduce((a, b, i) => a + b * (i + 1), 0);
	return {
		exists: data !== null && data !== undefined,
		ready: row.ready === true,
		pending: Math.max(0, asNumber(row.pending) ?? 0),
		changes: Math.max(0, asNumber(row.changes) ?? 0),
		published,
		average: published ? Math.round((sum / published) * 10) / 10 : 0,
		kitDone: typeof row.kit_done === "boolean" ? row.kit_done : null,
		upgrade: asRecord(row.upgrade),
	};
}

export async function getStats(ctx: Ctx): Promise<Stats> {
	return readStats(await ctx.storage[STATS]!.get(SITE));
}

/** Apply a change to the site counts in one write. Returns the record after it, or null (no record yet, or the write failed). Never throws. */
export async function moveStats(ctx: Ctx, change: StatsChange, set: Record<string, unknown> = {}): Promise<Stats | null> {
	const values: Record<string, number> = { pending: change.pending ?? 0, changes: change.changes ?? 0 };
	if (change.counts) for (const n of [1, 2, 3, 4, 5]) values[`s${n}`] = change.counts[`s${n}` as keyof Counts];
	const delta = deltaOf(values);
	if (!Object.keys(delta).length && !Object.keys(set).length) return null;
	const done = await ctx.storage[STATS]!.updateIf(SITE, {
		where: {},
		...(Object.keys(set).length ? { set } : {}),
		delta: { ...delta, seq: { inc: 1 } },
	}).catch(() => ({ applied: false as const }));
	return done.applied ? readStats(done.data) : null;
}

/** Waiting and published changes one review row makes, from its state before and after a write. */
export function statsChange(before: Record<string, unknown> | null, after: Record<string, unknown> | null): StatsChange {
	const waiting = (row: Record<string, unknown> | null) => (row && asString(row.status) === "pending" ? 1 : 0);
	const changed = (row: Record<string, unknown> | null) => (row && asString(row.status) === "published" && row.pending_change === true ? 1 : 0);
	return {
		pending: waiting(after) - waiting(before),
		changes: changed(after) - changed(before),
		counts: minus(partOf(after), partOf(before)),
	};
}

export function sumChanges(list: StatsChange[]): StatsChange {
	const out = { pending: 0, changes: 0, counts: zero() };
	for (const c of list) {
		out.pending += c.pending ?? 0;
		out.changes += c.changes ?? 0;
		if (c.counts) out.counts = plus(out.counts, c.counts);
	}
	return out;
}

/** The fields of the site record and what each one counts. */
export const STAT_FIELDS: Array<[string, Where]> = [
	["pending", { status: "pending" }],
	["changes", { status: "published", pending_change: true }],
	...[1, 2, 3, 4, 5].map((n): [string, Where] => [`s${n}`, { status: "published", stars: n }]),
];

export const ratingFields = (entry: string): Array<[string, Where]> => [
	...[1, 2, 3, 4, 5].map((n): [string, Where] => [`s${n}`, { entry, status: "published", stars: n }]),
	["t", { entry, status: "published", has_text: true }],
];

/**
 * Count the next fields of a record that is not ready, with what is left of the budget: a read,
 * one count per field, and one write guarded by `seq` and `step`, so a change that lands while the
 * fields are counted makes the write miss and the step is counted again next time. Fields already
 * counted keep taking changes, so the record is exact once it is ready.
 */
export async function stepCount(
	ctx: Ctx,
	collection: string,
	id: string,
	fields: Array<[string, Where]>,
	b: Budget,
	read?: Record<string, unknown>,
): Promise<boolean> {
	if (!read && !spend(b)) return false;
	const row = read ?? asRecord(await ctx.storage[collection]!.get(id));
	if (row.ready === true) return true;
	const seq = asNumber(row.seq) ?? 0;
	const from = asNumber(row.step) ?? 0;
	const room = MAX_CALLS - b.used - 1;
	const upto = Math.min(fields.length, from + room);
	if (upto <= from) return false;
	const set: Record<string, unknown> = { step: upto, ready: upto >= fields.length };
	for (let i = from; i < upto; i += 1) {
		spend(b);
		set[fields[i]![0]] = await ctx.storage.reviews!.count(fields[i]![1] as never);
	}
	spend(b);
	const done = await ctx.storage[collection]!.updateIf(id, { where: { seq, step: from }, set }).catch(() => ({ applied: false as const }));
	return done.applied && upto >= fields.length;
}

/**
 * Count a row again from its reviews: not ready, from the first field, and a new epoch, so changes
 * queued against it before are dropped. One call; only 0.3.0 rows.
 */
export async function recountRating(ctx: Ctx, entry: string): Promise<void> {
	await ctx.storage[RATINGS]!.updateIf(entry, { where: { v: V }, set: { ready: false, step: 0 }, delta: { epoch: { inc: 1 }, seq: { inc: 1 } } }).catch(() => undefined);
}

/** Apply an erase's change to a ready row only while it is in the epoch the change was made against. One call. */
export async function moveRatingIn(ctx: Ctx, entry: string, change: Counts, epoch: number): Promise<boolean> {
	if (isZero(change)) return true;
	const done = await ctx.storage[RATINGS]!.updateIf(entry, { where: { v: V, ready: true, epoch }, delta: { ...deltaOf(change), seq: { inc: 1 } } }).catch(() => ({ applied: false as const }));
	return done.applied;
}

/** One queued piece of work for a page's rating: apply a change made in `epoch`, or count the page again. */
export type QueueItem = { entry: string; recount: boolean; epoch: number; change: Counts };

/** Queue what a bulk erase could not do in its own call. One call. */
export async function queueChanges(ctx: Ctx, items: QueueItem[]): Promise<void> {
	const rows = items
		.filter((item) => item.recount || !isZero(item.change))
		.map((item) => ({
			id: `${Date.now().toString(36).padStart(9, "0")}|${crypto.randomUUID()}`,
			data: { entry: item.entry, recount: item.recount, epoch: item.epoch, ...item.change },
		}));
	if (rows.length) await ctx.storage[QUEUE]!.putMany(rows).catch(() => undefined);
}

/** Queue items one claim takes. The same everywhere, so two callers claim the same rows or rows that do not overlap. */
export const CLAIM = 2;

/**
 * Apply one claim of queued work: one read of the oldest CLAIM items, one delete of them as the
 * claim, then one write each (4 calls). Queue ids start with the time they were queued and are read
 * in id order, so two callers read the same items or items that do not overlap; the delete is one
 * statement, so of two callers claiming the same items one removes them all and applies them and the
 * other removes none and applies nothing. Returns how many were applied, or -1 when the queue is empty.
 * ponytail: a call that dies between the claim and its writes loses those changes; the reviews are already gone.
 */
export async function drainQueue(ctx: Ctx, b: Budget, reserve = 0): Promise<number> {
	if (b.used + 2 + CLAIM + reserve > MAX_CALLS) return 0;
	spend(b);
	const found = await ctx.storage[QUEUE]!.query({ limit: CLAIM }).catch(() => ({ items: [] as Array<{ id: string; data: unknown }> }));
	if (!found.items.length) return -1;
	spend(b);
	const ids = found.items.map((item) => item.id);
	if ((await ctx.storage[QUEUE]!.deleteMany(ids).catch(() => 0)) !== ids.length) return 0;
	for (const item of found.items) {
		spend(b);
		const row = asRecord(item.data);
		const entry = asString(row.entry);
		if (row.recount === true) {
			await recountRating(ctx, entry);
			continue;
		}
		const change = zero();
		for (const f of FIELDS) change[f] = asNumber(row[f]) ?? 0;
		await moveRatingIn(ctx, entry, change, asNumber(row.epoch) ?? 0);
	}
	return found.items.length;
}

/**
 * Upkeep after the upgrade, with what is left of the budget: claims of queued work while there is
 * any, then counting one rating row that is being counted again.
 */
export async function maintain(ctx: Ctx, b: Budget, reserve = 0, claims = 1): Promise<void> {
	for (let n = 0; n < claims; n += 1) {
		const done = await drainQueue(ctx, b, reserve);
		if (done === -1) break;
		if (done === 0 && b.used + 2 + CLAIM + reserve > MAX_CALLS) return;
	}
	if (b.used + 3 + reserve > MAX_CALLS) return;
	spend(b);
	const open = await ctx.storage[RATINGS]!.query({ where: { ready: false }, limit: 1 }).catch(() => ({ items: [] as Array<{ id: string; data: unknown }> }));
	const next = open.items[0];
	if (!next) return;
	const inner = { used: b.used + reserve };
	await stepCount(ctx, RATINGS, next.id, ratingFields(next.id), inner, asRecord(next.data));
	b.used = inner.used - reserve;
}

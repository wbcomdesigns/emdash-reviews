import type { PluginContext } from "emdash/plugin";

import { asNumber, asRecord, asString, asStringArray, rows, type Row } from "./util";

// Lowest signed-in role (subscriber). Private routes get a host-verified routeCtx.user.
// A public route never gets a user, and a member id in the request is never trusted.
export const MEMBER = "content:read";

export type Member = { id: string; name: string | null; role: number };

export const SIGN_IN = { ok: false, error: { code: "SIGN_IN_REQUIRED", message: "Sign in to continue." } };
export const MEMBERS_ONLY = { ok: false, error: { code: "MEMBERS_ONLY", message: "Sign in to continue." } };
export const RATE_LIMITED = {
	ok: false,
	error: { code: "RATE_LIMITED", message: "Too many requests. Try again in an hour." },
};

export const GUEST_UNAVAILABLE = {
	ok: false,
	error: { code: "GUEST_UNAVAILABLE", message: "Sign in to write a review." },
};

type ReviewQuery = NonNullable<Parameters<PluginContext["storage"]["reviews"]["query"]>[0]>;

// Storage answers at most 100 rows per read.
const PAGE = 100;
const SCAN_CAP = 10_000;

/**
 * Every review matching `where`, read page by page. Always filter by status in `where`: reading
 * rows and dropping the wrong status afterwards let a flood of waiting reviews hide the published ones.
 * ponytail: one read per 100 rows, capped at 10,000. Keep running totals on the rating row if one
 * entry or one admin list ever passes that.
 */
export async function allReviews(
	ctx: PluginContext,
	where: ReviewQuery["where"],
	orderBy?: ReviewQuery["orderBy"],
	cap = SCAN_CAP,
): Promise<Row[]> {
	const found: Row[] = [];
	let cursor: string | undefined;
	do {
		const page = await ctx.storage.reviews.query({ where, orderBy, limit: PAGE, cursor });
		found.push(...rows(page));
		cursor = page.hasMore ? page.cursor : undefined;
	} while (cursor && found.length < cap);
	return found;
}

/** Pending reviews plus published reviews that have a change waiting. */
export async function waitingCount(ctx: PluginContext): Promise<number> {
	const [pending, changed] = await Promise.all([
		ctx.storage.reviews.count({ status: "pending" }),
		ctx.storage.reviews.count({ status: "published", pending_change: true }),
	]);
	return pending + changed;
}

const RATE_WINDOW_MS = 60 * 60 * 1000;
const RATE_MAX = 8;

// ponytail: KV read-then-write is not atomic, so a burst of parallel requests can slip a few
// past the cap. Fine for throttling abuse; move to a host rate-limit primitive if one ships.
export async function rateLimited(ctx: PluginContext, who: string): Promise<boolean> {
	const key = `rate:${who}`;
	const [start, count] = ((await ctx.kv.get<string>(key)) || "0|0").split("|").map(Number);
	const now = Date.now();
	if (now - start > RATE_WINDOW_MS) {
		await ctx.kv.set(key, `${now}|1`);
		return false;
	}
	if (count >= RATE_MAX) return true;
	await ctx.kv.set(key, `${start}|${count + 1}`);
	return false;
}

export function entryKey(collection: string, id: string): string {
	return `${collection}:${id}`;
}

export type SiteCollection = { slug: string; label: string };

/** Content types on the site, by their normal names. Hidden types stay out. */
export async function siteCollections(ctx: PluginContext): Promise<SiteCollection[]> {
	const found = (await ctx.schema?.listCollections()) ?? [];
	return found
		.filter((item) => !item.hidden)
		.map((item) => ({
			slug: item.slug,
			label: item.label || item.labelSingular || item.slug,
		}));
}

/** Collections the owner opened for reviews. Posts until they save. An empty save means none. */
export async function allowedCollections(ctx: PluginContext): Promise<string[]> {
	const raw = await ctx.settings.get<string>("collections");
	if (raw === undefined || raw === null) return ["posts"];
	return asStringArray(raw);
}

/** True when the entry exists and is published. */
export async function isPublished(ctx: PluginContext, collection: string, id: string): Promise<boolean> {
	const item = await ctx.content?.get?.(collection, id).catch(() => null);
	return item?.status === "published";
}

/** Open for reviews: the owner ticked its content type and the entry is published. */
export async function reviewable(ctx: PluginContext, collection: string, id: string): Promise<boolean> {
	if (!(await allowedCollections(ctx)).includes(collection)) return false;
	return isPublished(ctx, collection, id);
}

export type EntryRef = { title: string; url: string; published: boolean };

export async function entryRef(ctx: PluginContext, collection: string, id: string): Promise<EntryRef | null> {
	const item = await ctx.content?.get?.(collection, id).catch(() => null);
	if (!item) return null;
	const published = item.status === "published";
	const url = published ? await ctx.content?.getPublicUrl?.(collection, id).catch(() => null) : null;
	return {
		title: asString(asRecord(item.data).title) || item.slug || id,
		url: url || "",
		published,
	};
}

/** Title and link for every entry a page of review rows points at. */
export async function entryRefs(
	ctx: PluginContext,
	items: Array<Record<string, unknown>>,
): Promise<Map<string, EntryRef>> {
	const keys = [...new Set(items.map((row) => asString(row.entry)).filter(Boolean))];
	// One read per distinct entry. Callers pass at most one page of rows.
	const found = await Promise.all(
		keys.map((key) => {
			const split = key.indexOf(":");
			return entryRef(ctx, key.slice(0, split), key.slice(split + 1));
		}),
	);
	const refs = new Map<string, EntryRef>();
	keys.forEach((key, index) => {
		const ref = found[index];
		if (ref) refs.set(key, ref);
	});
	return refs;
}

/**
 * Recalculate one entry's rating from its published reviews and store it in plugin storage.
 * It never writes to the entry itself, so it is safe to call from a member route.
 */
export async function syncRating(ctx: PluginContext, entry: string): Promise<void> {
	if (!entry) return;
	const published = await allReviews(ctx, { entry, status: "published" });
	const stars = published.map((row) => asNumber(row.stars) ?? 0);
	if (!stars.length) {
		await ctx.storage.ratings.delete(entry);
		return;
	}
	const split = entry.indexOf(":");
	await ctx.storage.ratings.put(entry, {
		collection: entry.slice(0, split),
		entryId: entry.slice(split + 1),
		average: Math.round((stars.reduce((sum, value) => sum + value, 0) / stars.length) * 10) / 10,
		count: stars.length,
		// Read by the public list route, so a visitor's request never walks every review.
		bars: [1, 2, 3, 4, 5].map((n) => stars.filter((value) => Math.min(Math.max(Math.round(value), 1), 5) === n).length),
		text_count: published.filter((row) => row.has_text === true).length,
	});
}

/** Set to "none" when EmDash answered that no email provider is set up, "ok" after a send went out. */
export const MAIL_STATUS = "mail_status";

/**
 * Send one email and remember whether the site can send mail. A sandboxed plugin always gets
 * ctx.email when it asks for email:send; only a send tells whether a provider exists.
 */
export async function sendMail(
	ctx: PluginContext,
	message: { to: string; subject: string; text: string },
): Promise<"sent" | "none" | "failed"> {
	if (!ctx.email) {
		await ctx.kv.set(MAIL_STATUS, "none");
		return "none";
	}
	try {
		await ctx.email.send(message);
		await ctx.kv.set(MAIL_STATUS, "ok");
		return "sent";
	} catch (error) {
		if (/not configured|no email provider/i.test(String((error as Error)?.message ?? error))) {
			await ctx.kv.set(MAIL_STATUS, "none");
			return "none";
		}
		return "failed";
	}
}

export async function noMailProvider(ctx: PluginContext): Promise<boolean> {
	return !ctx.email || (await ctx.kv.get<string>(MAIL_STATUS)) === "none";
}

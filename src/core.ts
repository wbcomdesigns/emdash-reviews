import type { PluginContext } from "emdash/plugin";

import { asNumber, asRecord, asString, asStringArray, rows } from "./util";

// Lowest signed-in role (subscriber). Private routes get a host-verified routeCtx.user.
// A public route never gets a user, and a member id in the request is never trusted.
export const MEMBER = "content:read";

export type Member = { id: string; name: string | null; role: number };

export const SIGN_IN = { ok: false, error: { code: "SIGN_IN_REQUIRED", message: "Sign in to continue." } };
export const RATE_LIMITED = {
	ok: false,
	error: { code: "RATE_LIMITED", message: "Too many requests. Try again in an hour." },
};

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
	// ponytail: reads up to 500 reviews per entry. Keep running totals on the rating row
	// if a single entry ever collects more than that.
	const found = await ctx.storage.reviews.query({ where: { entry }, limit: 500 });
	const stars = rows(found)
		.filter((row) => row.status === "published")
		.map((row) => asNumber(row.stars) ?? 0);
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
	});
}

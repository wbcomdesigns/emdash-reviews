import type { PluginContext, SandboxedPlugin } from "emdash/plugin";

import { handleAdmin } from "./admin";
import {
	allowedCollections,
	entryKey,
	entryRef,
	entryRefs,
	MEMBER,
	rateLimited,
	RATE_LIMITED,
	SIGN_IN,
	syncRating,
	type Member,
} from "./core";
import { asNumber, asRecord, asString, nowIso, rows } from "./util";

// Short enough that the moderation table can show every character an admin approves.
const TITLE_MAX = 120;
const BODY_MAX = 1000;

const NOT_REVIEWABLE = {
	ok: false,
	error: { code: "NOT_FOUND", message: "Reviews are not open for that page." },
};

/** Collection and entry id from a request, or null when either is missing. */
function target(input: unknown): { collection: string; id: string } | null {
	const raw = asRecord(input);
	const collection = asString(raw.collection);
	const id = asString(raw.id);
	return collection && id ? { collection, id } : null;
}

async function reviewable(ctx: PluginContext, collection: string, id: string): Promise<boolean> {
	if (!(await allowedCollections(ctx)).includes(collection)) return false;
	return (await entryRef(ctx, collection, id))?.published === true;
}

const plugin: SandboxedPlugin = {
	hooks: {
		// Adds the rating to the page's structured data. No kit code needed for this part.
		"page:metadata": {
			handler: async (event, ctx) => {
				const content = event.page.content;
				if (!content) return null;
				const rating = asRecord(await ctx.storage.ratings.get(entryKey(content.collection, content.id)));
				const count = asNumber(rating.count) ?? 0;
				if (!count) return null;
				return {
					kind: "jsonld",
					id: "wbcom-reviews-rating",
					graph: {
						"@context": "https://schema.org",
						"@type": "CreativeWork",
						name: event.page.pageTitle || event.page.title || undefined,
						url: event.page.canonical || event.page.url,
						aggregateRating: {
							"@type": "AggregateRating",
							ratingValue: rating.average,
							reviewCount: count,
							bestRating: 5,
							worstRating: 1,
						},
					},
				};
			},
		},
	},
	routes: {
		health: {
			public: true,
			handler: async (_routeCtx, ctx) => ({
				ok: true,
				plugin: ctx.plugin.id,
				version: ctx.plugin.version,
				collections: await allowedCollections(ctx),
				pending: await ctx.storage.reviews.count({ status: "pending" }),
			}),
		},
		// Published reviews for one entry, with its rating.
		list: {
			public: true,
			methods: ["GET"],
			handler: async (routeCtx, ctx) => {
				const at = target(routeCtx.input);
				if (!at) return { ok: true, items: [], average: 0, count: 0 };
				const entry = entryKey(at.collection, at.id);
				const [found, rating] = await Promise.all([
					ctx.storage.reviews.query({ where: { entry }, orderBy: { createdAt: "desc" }, limit: 100 }),
					ctx.storage.ratings.get(entry),
				]);
				// Only what the page prints leaves the server.
				const items = rows(found)
					.filter((row) => row.status === "published")
					.map((row) => ({
						author: row.author,
						stars: row.stars,
						title: row.title,
						body: row.body,
						createdAt: row.createdAt,
					}));
				const summary = asRecord(rating);
				return {
					ok: true,
					items,
					average: asNumber(summary.average) ?? 0,
					count: asNumber(summary.count) ?? 0,
				};
			},
		},
		// Ratings for a page of cards in one call: ?collection=posts&ids=a,b,c
		summary: {
			public: true,
			methods: ["GET"],
			handler: async (routeCtx, ctx) => {
				const raw = asRecord(routeCtx.input);
				const collection = asString(raw.collection);
				const ids = asString(raw.ids).split(",").map((id) => id.trim()).filter(Boolean).slice(0, 50);
				const found = await Promise.all(ids.map((id) => ctx.storage.ratings.get(entryKey(collection, id))));
				const ratings: Record<string, { average: number; count: number }> = {};
				ids.forEach((id, index) => {
					const row = asRecord(found[index]);
					if (asNumber(row.count)) {
						ratings[id] = { average: asNumber(row.average) ?? 0, count: asNumber(row.count) ?? 0 };
					}
				});
				return { ok: true, ratings };
			},
		},
		write: {
			permission: MEMBER,
			methods: ["POST"],
			handler: async (routeCtx, ctx) => {
				const user = routeCtx.user as Member | undefined;
				if (!user) return SIGN_IN;
				const at = target(routeCtx.input);
				const raw = asRecord(routeCtx.input);
				const body = asString(raw.body);
				if (!at || !body) {
					return { ok: false, error: { code: "VALIDATION_ERROR", message: "Write a few words before you submit." } };
				}
				if (!(await reviewable(ctx, at.collection, at.id))) return NOT_REVIEWABLE;
				if (await rateLimited(ctx, `write:${user.id}`)) return RATE_LIMITED;

				const moderate = (await ctx.settings.get<boolean>("require_moderation")) !== false;
				const entry = entryKey(at.collection, at.id);
				// One review per member per entry. Writing again replaces it.
				const reviewId = `${entry}:${user.id}`;
				await ctx.storage.reviews.put(reviewId, {
					entry,
					collection: at.collection,
					entryId: at.id,
					member_id: user.id,
					author: user.name || "Member",
					stars: Math.min(Math.max(Math.round(asNumber(raw.stars) ?? 5), 1), 5),
					title: asString(raw.title).slice(0, TITLE_MAX),
					body: body.slice(0, BODY_MAX),
					status: moderate ? "pending" : "published",
					rev: crypto.randomUUID(),
					createdAt: nowIso(),
				});
				// The rating lives in plugin storage, so keeping it right never touches the entry.
				await syncRating(ctx, entry);
				return { ok: true, status: moderate ? "pending" : "published" };
			},
		},
		// A member's own reviews. DELETE erases them all.
		mine: {
			permission: MEMBER,
			methods: ["GET", "DELETE"],
			handler: async (routeCtx, ctx) => {
				const user = routeCtx.user as Member | undefined;
				if (!user) return SIGN_IN;
				const found = await ctx.storage.reviews.query({ where: { member_id: user.id }, limit: 100 });
				const mine = rows(found);
				if (routeCtx.request.method === "DELETE") {
					await Promise.all(mine.map((row) => ctx.storage.reviews.delete(row.id)));
					for (const entry of new Set(mine.map((row) => asString(row.entry)))) await syncRating(ctx, entry);
					return { ok: true, erased: mine.length };
				}
				const refs = await entryRefs(ctx, mine);
				return {
					ok: true,
					items: mine.map((row) => {
						const ref = refs.get(asString(row.entry));
						return {
							stars: row.stars,
							title: row.title,
							body: row.body,
							status: row.status,
							createdAt: row.createdAt,
							// Only a public entry is named.
							entry_title: ref?.published ? ref.title : "",
							entry_url: ref?.published ? ref.url : "",
						};
					}),
				};
			},
		},
		admin: {
			handler: async (routeCtx, ctx) => handleAdmin(routeCtx.input, ctx),
		},
	},
};

export default plugin;

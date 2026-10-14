import type { PluginContext, SandboxedPlugin } from "emdash/plugin";

import { handleAdmin } from "./admin";
import {
	allowedCollections,
	entryKey,
	entryRef,
	entryRefs,
	MEMBER,
	MEMBERS_ONLY,
	rateLimited,
	RATE_LIMITED,
	SIGN_IN,
	syncRating,
	waitingCount,
	type Member,
} from "./core";
import { asNumber, asRecord, asString, nowIso, rows } from "./util";

// Short enough that the moderation table can show every character an admin approves.
const TITLE_MAX = 120;
const BODY_MAX = 1000;
const NAME_MAX = 80;
const LIST_PAGE = 10;
const LIST_SCAN = 500;
const NOTIFY_CRON = "0 * * * *";

const NOT_REVIEWABLE = {
	ok: false,
	error: { code: "NOT_FOUND", message: "Reviews are not open for that page." },
};

const NEED_NAME = { ok: false, error: { code: "NEED_NAME", message: "Add your name." } };
const NEED_EMAIL = { ok: false, error: { code: "NEED_EMAIL", message: "Add your email." } };
const NEED_STARS = { ok: false, error: { code: "NEED_STARS", message: "Choose a rating." } };
const SPAM = { ok: false, error: { code: "SPAM", message: "Something went wrong. Try again." } };

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

function clampStars(value: unknown): number | null {
	const n = asNumber(value);
	if (n === null) return null;
	return Math.min(Math.max(Math.round(n), 1), 5);
}

function whoSetting(value: unknown): "members" | "anyone" {
	return asString(value) === "members" ? "members" : "anyone";
}

async function sha256Hex(text: string): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
	return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function visitorSalt(ctx: PluginContext): Promise<string> {
	const found = await ctx.kv.get<string>("visitor_salt");
	if (found) return found;
	const salt = crypto.randomUUID();
	await ctx.kv.set("visitor_salt", salt);
	return salt;
}

/** One guest identity per trusted address, or per browser cookie when the host has none. */
async function guestWho(
	ctx: PluginContext,
	routeCtx: { requestMeta?: { ip?: string | null } },
	raw: Record<string, unknown>,
): Promise<{ id: string; visitor: string }> {
	const salt = await visitorSalt(ctx);
	const ip = asString(routeCtx.requestMeta?.ip);
	if (ip && ip !== "unknown") {
		const visitor = await sha256Hex(`${salt}:${ip}`);
		return { id: `v-${visitor}`, visitor };
	}
	const token = asString(raw.visitor) || crypto.randomUUID();
	const visitor = await sha256Hex(`${salt}:c:${token}`);
	return { id: `v-${visitor}`, visitor };
}

type SaveInput = {
	entry: string;
	collection: string;
	id: string;
	who: string;
	author: string;
	stars: number;
	title: string;
	body: string;
	guest: boolean;
	email: string;
	visitor: string;
	alwaysPending: boolean;
};

async function saveReview(ctx: PluginContext, input: SaveInput): Promise<{ ok: true; status: string }> {
	const reviewId = `${input.entry}:${input.who}`;
	const existing = asRecord(await ctx.storage.reviews.get(reviewId));
	const hasText = Boolean(input.title || input.body);
	const moderate = input.alwaysPending || (await ctx.settings.get<boolean>("require_moderation")) !== false;
	const createdAt = asString(existing.createdAt) || nowIso();

	if (asString(existing.status) === "published" && moderate) {
		await ctx.storage.reviews.put(reviewId, {
			...existing,
			pending_change: true,
			pending_stars: input.stars,
			pending_title: input.title,
			pending_body: input.body,
			pending_has_text: hasText,
			rev: crypto.randomUUID(),
		});
		return { ok: true, status: "pending" };
	}

	await ctx.storage.reviews.put(reviewId, {
		entry: input.entry,
		collection: input.collection,
		entryId: input.id,
		member_id: input.who,
		author: input.author,
		stars: input.stars,
		title: input.title,
		body: input.body,
		has_text: hasText,
		status: moderate ? "pending" : "published",
		rev: crypto.randomUUID(),
		createdAt,
		guest: input.guest,
		email: input.email,
		visitor: input.visitor,
		pending_change: false,
		pending_title: "",
		pending_body: "",
		owner_reply: asString(existing.owner_reply),
		owner_reply_at: asString(existing.owner_reply_at),
	});
	await syncRating(ctx, input.entry);
	return { ok: true, status: moderate ? "pending" : "published" };
}

function publicItem(row: Record<string, unknown>) {
	return {
		author: row.author,
		stars: row.stars,
		title: row.title,
		body: row.body,
		createdAt: row.createdAt,
		owner_reply: asString(row.owner_reply),
		owner_reply_at: asString(row.owner_reply_at),
	};
}

async function notifyWaiting(ctx: PluginContext): Promise<void> {
	if ((await ctx.settings.get<boolean>("notify")) === false) return;
	if (!(await waitingCount(ctx))) return;
	if (!ctx.email) return;
	const to = asString(await ctx.settings.get<string>("notify_to"));
	if (!to.includes("@")) return;
	const site = asString(ctx.site?.name).replace(/\s+/g, " ").trim().slice(0, 80);
	try {
		await ctx.email.send({
			to,
			subject: "Reviews are waiting",
			text: `Reviews are waiting for approval${site ? ` on ${site}` : ""}.\n\nSign in to your site admin and open Reviews, then Waiting.`,
		});
	} catch {
		// Tried this hour. The next run tries again.
	}
}

const plugin: SandboxedPlugin = {
	hooks: {
		"plugin:install": {
			handler: async (_event, ctx) => void (await ctx.cron?.schedule("notify", { schedule: NOTIFY_CRON })),
		},
		"plugin:activate": {
			handler: async (_event, ctx) => void (await ctx.cron?.schedule("notify", { schedule: NOTIFY_CRON })),
		},
		cron: {
			handler: async (event, ctx) => {
				if (event.name === "notify") await notifyWaiting(ctx);
			},
		},
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
				pending: await waitingCount(ctx),
				who: whoSetting(await ctx.settings.get<string>("who")),
				askEmail: (await ctx.settings.get<boolean>("ask_guest_email")) === true,
			}),
		},
		// Published reviews for one entry, with its rating, bars, and one page of text reviews.
		list: {
			public: true,
			methods: ["GET"],
			handler: async (routeCtx, ctx) => {
				const at = target(routeCtx.input);
				if (!at) return { ok: true, items: [], average: 0, count: 0, total: 0, page: 1, sort: "newest", bars: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } };
				const raw = asRecord(routeCtx.input);
				const sortRaw = asString(raw.sort);
				const sort = sortRaw === "highest" || sortRaw === "lowest" ? sortRaw : "newest";
				const page = Math.max(1, asNumber(raw.page) ?? 1);
				const entry = entryKey(at.collection, at.id);
				const [found, rating] = await Promise.all([
					ctx.storage.reviews.query({ where: { entry }, orderBy: { createdAt: "desc" }, limit: LIST_SCAN }),
					ctx.storage.ratings.get(entry),
				]);
				const published = rows(found).filter((row) => row.status === "published");
				const bars = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
				for (const row of published) {
					const stars = clampStars(row.stars);
					if (stars === 1 || stars === 2 || stars === 3 || stars === 4 || stars === 5) bars[stars] += 1;
				}
				const listed = published.filter((row) =>
					row.has_text === false ? false : row.has_text === true || Boolean(asString(row.title) || asString(row.body)),
				);
				listed.sort((a, b) => {
					if (sort === "highest") return (asNumber(b.stars) ?? 0) - (asNumber(a.stars) ?? 0);
					if (sort === "lowest") return (asNumber(a.stars) ?? 0) - (asNumber(b.stars) ?? 0);
					return asString(b.createdAt).localeCompare(asString(a.createdAt));
				});
				const total = listed.length;
				const pages = Math.max(1, Math.ceil(total / LIST_PAGE) || 1);
				const current = Math.min(page, pages);
				const items = listed.slice((current - 1) * LIST_PAGE, current * LIST_PAGE).map(publicItem);
				const summary = asRecord(rating);
				return {
					ok: true,
					items,
					average: asNumber(summary.average) ?? 0,
					count: asNumber(summary.count) ?? 0,
					total,
					page: current,
					pages,
					sort,
					bars,
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
				const ids = asString(raw.ids)
					.split(",")
					.map((id) => id.trim())
					.filter(Boolean)
					.slice(0, 50);
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
				if (!at) return NOT_REVIEWABLE;
				const raw = asRecord(routeCtx.input);
				if (!(await reviewable(ctx, at.collection, at.id))) return NOT_REVIEWABLE;
				const stars = clampStars(raw.stars);
				if (stars === null) return NEED_STARS;
				if (await rateLimited(ctx, `write:${user.id}`)) return RATE_LIMITED;
				return saveReview(ctx, {
					entry: entryKey(at.collection, at.id),
					collection: at.collection,
					id: at.id,
					who: user.id,
					author: user.name || "Member",
					stars,
					title: asString(raw.title).slice(0, TITLE_MAX),
					body: asString(raw.body).slice(0, BODY_MAX),
					guest: false,
					email: "",
					visitor: "",
					alwaysPending: false,
				});
			},
		},
		write_guest: {
			public: true,
			methods: ["POST"],
			handler: async (routeCtx, ctx) => {
				if (whoSetting(await ctx.settings.get<string>("who")) === "members") return MEMBERS_ONLY;
				const at = target(routeCtx.input);
				if (!at) return NOT_REVIEWABLE;
				const raw = asRecord(routeCtx.input);
				if (asString(raw.website)) return SPAM;
				const name = asString(raw.name).slice(0, NAME_MAX);
				if (!name) return NEED_NAME;
				const askEmail = (await ctx.settings.get<boolean>("ask_guest_email")) === true;
				const email = asString(raw.email).toLowerCase();
				if (askEmail && !email.includes("@")) return NEED_EMAIL;
				if (!(await reviewable(ctx, at.collection, at.id))) return NOT_REVIEWABLE;
				const stars = clampStars(raw.stars);
				if (stars === null) return NEED_STARS;
				const guest = await guestWho(ctx, { requestMeta: routeCtx.requestMeta as { ip?: string | null } | undefined }, raw);
				if (await rateLimited(ctx, `write:${guest.id}`)) return RATE_LIMITED;
				return saveReview(ctx, {
					entry: entryKey(at.collection, at.id),
					collection: at.collection,
					id: at.id,
					who: guest.id,
					author: name,
					stars,
					title: asString(raw.title).slice(0, TITLE_MAX),
					body: asString(raw.body).slice(0, BODY_MAX),
					guest: true,
					email: askEmail ? email.slice(0, 200) : "",
					visitor: guest.visitor,
					alwaysPending: true,
				});
			},
		},
		// A member's own reviews. DELETE erases them all. Kept for 0.2.0 My reviews.
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
			handler: async (routeCtx, ctx) => handleAdmin(routeCtx.input, ctx, routeCtx),
		},
	},
};

export default plugin;

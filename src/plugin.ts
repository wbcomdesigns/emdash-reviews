import type { PluginContext, SandboxedPlugin } from "emdash/plugin";

import { handleAdmin } from "./admin";
import {
	allowedCollections,
	allReviews,
	entryKey,
	entryRefs,
	GUEST_UNAVAILABLE,
	isPublished,
	MEMBER,
	MEMBERS_ONLY,
	rateLimited,
	RATE_LIMITED,
	reviewable,
	sendMail,
	SIGN_IN,
	syncRating,
	waitingCount,
	type Member,
} from "./core";
import { asNumber, asRecord, asString, nowIso, plainText, rows } from "./util";
import { guestKey } from "./visitor-key";

// Short enough that the moderation table can show every character an admin approves.
const TITLE_MAX = 120;
const BODY_MAX = 1000;
const NAME_MAX = 80;
const LIST_PAGE = 10;
const LIST_MAX_PAGE = 50;
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

type Meta = { requestMeta?: { ip?: string | null } };

/** The visitor address EmDash passed in, or null. Only Cloudflare, or a site with trustedProxyHeaders, passes one. */
function visitorAddress(routeCtx: Meta): string | null {
	return guestKey(asString(routeCtx.requestMeta?.ip));
}

/** One guest per visitor address (an IPv6 /64), hashed with a per-site salt. Never the address itself. */
async function guestWho(ctx: PluginContext, address: string): Promise<{ id: string; visitor: string }> {
	const visitor = await sha256Hex(`${await visitorSalt(ctx)}:${address}`);
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
			// Guests are keyed by address, so a second person on one address can land here: keep their name.
			pending_author: input.author,
			pending_email: input.email,
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
	if ((await ctx.settings.get<boolean>("notify")) !== true) return;
	if (!(await waitingCount(ctx))) return;
	const to = asString(await ctx.settings.get<string>("notify_to"));
	if (!to.includes("@")) return;
	const site = asString(ctx.site?.name).replace(/\s+/g, " ").trim().slice(0, 80);
	// A failed send is tried again next hour; "no provider" is remembered so Settings can say so.
	await sendMail(ctx, {
		to,
		subject: "Reviews are waiting",
		text: `Reviews are waiting for approval${site ? ` on ${site}` : ""}.\n\nSign in to your site admin and open Reviews, then Waiting.`,
	});
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
			handler: async (routeCtx, ctx) => {
				const who = whoSetting(await ctx.settings.get<string>("who"));
				return {
					ok: true,
					plugin: ctx.plugin.id,
					version: ctx.plugin.version,
					collections: await allowedCollections(ctx),
					who,
					// False when guests cannot write here: members only, or the host gives no visitor address.
					guestWrites: who === "anyone" && visitorAddress(routeCtx as Meta) !== null,
					askEmail: (await ctx.settings.get<boolean>("ask_guest_email")) === true,
				};
			},
		},
		// Published reviews for one entry, with its rating, bars, and one page of text reviews.
		list: {
			public: true,
			methods: ["GET"],
			handler: async (routeCtx, ctx) => {
				const at = target(routeCtx.input);
				if (!at || !(await reviewable(ctx, at.collection, at.id))) {
					return { ok: true, items: [], average: 0, count: 0, total: 0, page: 1, pages: 1, sort: "newest", bars: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } };
				}
				const raw = asRecord(routeCtx.input);
				const sortRaw = asString(raw.sort);
				const sort = sortRaw === "highest" || sortRaw === "lowest" ? sortRaw : "newest";
				const entry = entryKey(at.collection, at.id);
				let rating = asRecord(await ctx.storage.ratings.get(entry));
				// Build the rating row once when it is from 0.2.0 or earlier (no bars), or missing while published
				// reviews exist (0.2.0 could delete it when waiting reviews filled its one read).
				const stale = asNumber(rating.count)
					? !Array.isArray(rating.bars)
					: (await ctx.storage.reviews.count({ entry, status: "published" })) > 0;
				if (stale) {
					await syncRating(ctx, entry);
					rating = asRecord(await ctx.storage.ratings.get(entry));
				}
				const counts = Array.isArray(rating.bars) ? rating.bars.map((n) => asNumber(n) ?? 0) : [0, 0, 0, 0, 0];
				const bars = { 1: counts[0], 2: counts[1], 3: counts[2], 4: counts[3], 5: counts[4] };
				const total = asNumber(rating.text_count) ?? 0;
				const pages = Math.max(1, Math.ceil(total / LIST_PAGE));
				// ponytail: page N walks N*10 rows in reads of 100, capped at page 50 (500 rows). Add an offset or a
				// cursor in the kit if visitors ever need to page deeper than that.
				const current = Math.min(Math.max(1, Math.floor(asNumber(raw.page) ?? 1)), pages, LIST_MAX_PAGE);
				const orderBy: Record<string, "asc" | "desc"> =
					sort === "newest" ? { createdAt: "desc" } : { stars: sort === "highest" ? "desc" : "asc" };
				const listed = await allReviews(ctx, { entry, status: "published", has_text: true }, orderBy, current * LIST_PAGE);
				const items = listed.slice((current - 1) * LIST_PAGE, current * LIST_PAGE).map(publicItem);
				return {
					ok: true,
					items,
					average: asNumber(rating.average) ?? 0,
					count: asNumber(rating.count) ?? 0,
					total,
					page: current,
					pages: Math.min(pages, LIST_MAX_PAGE),
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
				const ratings: Record<string, { average: number; count: number }> = {};
				if (!(await allowedCollections(ctx)).includes(collection)) return { ok: true, ratings };
				const ids = asString(raw.ids)
					.split(",")
					.map((id) => id.trim())
					.filter(Boolean)
					.slice(0, 50);
				const found = await Promise.all(ids.map((id) => ctx.storage.ratings.get(entryKey(collection, id))));
				const rated = ids.filter((id, index) => asNumber(asRecord(found[index]).count));
				// One content read per rated card (50 at most), so a draft or unpublished entry shows no badge.
				const live = await Promise.all(rated.map((id) => isPublished(ctx, collection, id)));
				rated.forEach((id, index) => {
					if (!live[index]) return;
					const row = asRecord(found[ids.indexOf(id)]);
					ratings[id] = { average: asNumber(row.average) ?? 0, count: asNumber(row.count) ?? 0 };
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
					author: plainText(user.name) || "Member",
					stars,
					title: plainText(raw.title).slice(0, TITLE_MAX),
					body: plainText(raw.body).slice(0, BODY_MAX),
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
				// Owner decision 2026-10-16: with no visitor address there is no working per-guest limit,
				// so guests are asked to sign in. Never fall back to a browser-sent id or a shared bucket.
				const address = visitorAddress(routeCtx as Meta);
				if (!address) return GUEST_UNAVAILABLE;
				const at = target(routeCtx.input);
				if (!at) return NOT_REVIEWABLE;
				const raw = asRecord(routeCtx.input);
				if (asString(raw.website)) return SPAM;
				const name = plainText(raw.name).slice(0, NAME_MAX);
				if (!name) return NEED_NAME;
				const askEmail = (await ctx.settings.get<boolean>("ask_guest_email")) === true;
				const email = asString(raw.email).toLowerCase();
				if (askEmail && !email.includes("@")) return NEED_EMAIL;
				if (!(await reviewable(ctx, at.collection, at.id))) return NOT_REVIEWABLE;
				const stars = clampStars(raw.stars);
				if (stars === null) return NEED_STARS;
				const guest = await guestWho(ctx, address);
				if (await rateLimited(ctx, `write:${guest.id}`)) return RATE_LIMITED;
				return saveReview(ctx, {
					entry: entryKey(at.collection, at.id),
					collection: at.collection,
					id: at.id,
					who: guest.id,
					author: name,
					stars,
					title: plainText(raw.title).slice(0, TITLE_MAX),
					body: plainText(raw.body).slice(0, BODY_MAX),
					guest: true,
					email: askEmail ? email.slice(0, 200) : "",
					visitor: guest.visitor,
					alwaysPending: true,
				});
			},
		},
		// The kit's "is this visitor signed in?" check: one cheap answer, no reads.
		me: {
			permission: MEMBER,
			methods: ["GET"],
			handler: async (routeCtx) => (routeCtx.user ? { ok: true } : SIGN_IN),
		},
		// A member's own reviews. DELETE erases them all. Kept for 0.2.0 My reviews.
		mine: {
			permission: MEMBER,
			methods: ["GET", "DELETE"],
			handler: async (routeCtx, ctx) => {
				const user = routeCtx.user as Member | undefined;
				if (!user) return SIGN_IN;
				if (routeCtx.request.method === "DELETE") {
					// Storage pages at 100, so erase page by page until none are left.
					const entries = new Set<string>();
					let erased = 0;
					for (;;) {
						const batch = rows(await ctx.storage.reviews.query({ where: { member_id: user.id }, limit: 100 }));
						if (!batch.length) break;
						for (const row of batch) entries.add(asString(row.entry));
						const gone = await ctx.storage.reviews.deleteMany(batch.map((row) => row.id));
						if (!gone) break;
						erased += gone;
					}
					for (const entry of entries) await syncRating(ctx, entry);
					return { ok: true, erased };
				}
				const found = await ctx.storage.reviews.query({ where: { member_id: user.id }, orderBy: { createdAt: "desc" }, limit: 100 });
				const mine = rows(found);
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
			handler: async (routeCtx, ctx) => handleAdmin(routeCtx.input, ctx, routeCtx as Parameters<typeof handleAdmin>[2]),
		},
	},
};

export default plugin;

import type { PluginContext, SandboxedPlugin } from "emdash/plugin";

import { handleAdmin } from "./admin";
import {
	BUSY,
	entryKey,
	GUEST_UNAVAILABLE,
	guestWho,
	loadSettings,
	MEMBER,
	MEMBERS_ONLY,
	RATE_LIMITED,
	sendMail,
	SIGN_IN,
	takeRate,
	visitorAddress,
	type Member,
	type Settings,
} from "./core";
import {
	addToRating,
	budget,
	ensureRating,
	maintain,
	MAX_CALLS,
	minus,
	moveRating,
	moveStats,
	partOf,
	RATINGS,
	readRating,
	spend,
	statsChange,
	V,
} from "./counts";
import { eraseRows } from "./erase";
import { ENTRIES, siteAndUpgrade, startSite } from "./upgrade";
import { asNumber, asRecord, asString, nowIso, plainText, rows } from "./util";

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

/** The entry's title when it is open for reviews: its type is ticked and it is published. One content read, the check every visitor write makes again. */
async function openEntry(ctx: PluginContext, settings: Settings, collection: string, id: string): Promise<{ title: string } | null> {
	if (!settings.collections.includes(collection)) return null;
	const item = await ctx.content?.get?.(collection, id).catch(() => null);
	if (item?.status !== "published") return null;
	return { title: asString(asRecord(item.data).title) || item.slug || "" };
}

type SaveInput = {
	collection: string;
	id: string;
	title: string;
	who: string;
	author: string;
	stars: number;
	reviewTitle: string;
	body: string;
	guest: boolean;
	email: string;
	visitor: string;
	moderate: boolean;
};

/**
 * Store one visitor's review and move the counts in the same call. A first review is one create
 * that only succeeds when there is none; a change is a read and a compare-and-set on that read.
 * Either write losing to a parallel one answers BUSY and stores nothing. After the write the counts
 * are moved in single in-database increments that never fail the answer. Calls: 1 for a first
 * review, 3 for a change, then 1 to 3 for the counts and the member's page address.
 */
async function saveReview(ctx: PluginContext, input: SaveInput) {
	const entry = entryKey(input.collection, input.id);
	const reviewId = `${entry}:${input.who}`;
	const hasText = Boolean(input.reviewTitle || input.body);
	const now = nowIso();
	const fresh = (existing: Record<string, unknown>) => ({
		entry,
		collection: input.collection,
		entryId: input.id,
		entry_title: input.title,
		member_id: input.who,
		author: input.author,
		stars: input.stars,
		title: input.reviewTitle,
		body: input.body,
		has_text: hasText,
		status: input.moderate ? "pending" : "published",
		publishedAt: input.moderate ? "" : asString(existing.publishedAt) || now,
		rev: crypto.randomUUID(),
		createdAt: asString(existing.createdAt) || now,
		guest: input.guest,
		email: input.email,
		visitor: input.visitor,
		pending_change: false,
		pending_title: "",
		pending_body: "",
		owner_reply: asString(existing.owner_reply),
		owner_reply_at: asString(existing.owner_reply_at),
	});

	let before: Record<string, unknown> | null = null;
	let after: Record<string, unknown> = fresh({});
	const created = await ctx.storage.reviews.compareAndSet(reviewId, null, after);
	if (!created.applied) {
		const seen = await ctx.storage.reviews.getVersioned(reviewId);
		if (!seen) return BUSY;
		before = asRecord(seen.value);
		after =
			asString(before.status) === "published" && input.moderate
				? {
						...before,
						entry_title: input.title,
						pending_change: true,
						pending_stars: input.stars,
						pending_title: input.reviewTitle,
						pending_body: input.body,
						pending_has_text: hasText,
						// Guests are keyed by address, so a second person on one address can land here: keep their name.
						pending_author: input.author,
						pending_email: input.email,
						rev: crypto.randomUUID(),
					}
				: fresh(before);
		if (!(await ctx.storage.reviews.compareAndSet(reviewId, seen.revision, after)).applied) return BUSY;
	}

	// The review is stored. Nothing below can turn the answer into an error.
	const change = minus(partOf(after), partOf(before));
	if (!before && !input.guest) {
		// A member's first review on this page: keep the page's address for My reviews.
		const url = (await ctx.content?.getPublicUrl?.(input.collection, input.id).catch(() => null)) ?? "";
		if (input.moderate) await ensureRating(ctx, entry, url);
		else await addToRating(ctx, entry, change, { createFirst: true, url, set: { live: true, ...(url ? { url } : {}) } });
	} else if (!input.moderate) {
		await moveRating(ctx, entry, change, { live: true });
	}
	await moveStats(ctx, statsChange(before, after));
	return { ok: true, status: input.moderate ? "pending" : "published" };
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

const EMPTY_LIST = { ok: true, items: [], average: 0, count: 0, total: 0, page: 1, pages: 1, sort: "newest", bars: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } };

/** Hourly: bring 0.2.x data over while that runs; otherwise the waiting notice, then queued rating changes. */
async function hourly(ctx: PluginContext): Promise<void> {
	const b = budget();
	const { stats, done } = await siteAndUpgrade(ctx, b, true);
	if (!done) return;
	spend(b);
	const settings = await loadSettings(ctx);
	const waiting = stats.pending + stats.changes;
	if (settings.notify && waiting && settings.notifyTo.includes("@")) {
		spend(b, 2);
		const site = asString(ctx.site?.name).replace(/\s+/g, " ").trim().slice(0, 80);
		// A failed send is tried again next hour; "no provider" is remembered so Settings can say so.
		await sendMail(ctx, {
			to: settings.notifyTo,
			subject: "Reviews are waiting",
			text: `Reviews are waiting for approval${site ? ` on ${site}` : ""}.\n\nSign in to your site admin and open Reviews, then Waiting.`,
		});
	}
	// Several claims of queued rating work while the budget lasts, then counting a page counted again.
	await maintain(ctx, b, 0, 3);
}

/** Mark a reviewed page live or not, so its rating badge shows only while the page is public. One call, only for pages that have a rating row. */
async function setLive(ctx: PluginContext, collection: string, id: unknown, live: boolean): Promise<void> {
	const key = asString(id);
	if (!collection || !key) return;
	await ctx.storage[RATINGS]!.updateIf(entryKey(collection, key), { where: { v: V }, set: { live } }).catch(() => undefined);
}

const plugin: SandboxedPlugin = {
	hooks: {
		"plugin:install": {
			handler: async (_event, ctx) => {
				await ctx.cron?.schedule("notify", { schedule: NOTIFY_CRON });
				await startSite(ctx);
			},
		},
		"plugin:activate": {
			handler: async (_event, ctx) => void (await ctx.cron?.schedule("notify", { schedule: NOTIFY_CRON })),
		},
		cron: {
			handler: async (event, ctx) => {
				if (event.name === "notify") await hourly(ctx);
			},
		},
		// Rating badges show only for public pages. EmDash tells the plugin when a page changes state.
		"content:afterPublish": {
			handler: async (event, ctx) => setLive(ctx, event.collection, asRecord(event.content).id, true),
		},
		"content:afterUnpublish": {
			handler: async (event, ctx) => setLive(ctx, event.collection, asRecord(event.content).id, false),
		},
		// Restored from the trash: live again only when it comes back published.
		"content:afterRestore": {
			handler: async (event, ctx) => setLive(ctx, event.collection, asRecord(event.content).id, asRecord(event.content).status === "published"),
		},
		"content:afterDelete": {
			handler: async (event, ctx) => setLive(ctx, event.collection, event.id, false),
		},
		// Adds the rating to the page's structured data. No kit code needed for this part.
		"page:metadata": {
			handler: async (event, ctx) => {
				const content = event.page.content;
				if (!content) return null;
				const rating = readRating(await ctx.storage[RATINGS]!.get(entryKey(content.collection, content.id)));
				if (!rating?.count) return null;
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
							reviewCount: rating.count,
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
				const settings = await loadSettings(ctx);
				const hostAddress = visitorAddress(routeCtx) !== null;
				const guestWrites = settings.who === "anyone" && hostAddress;
				return {
					ok: true,
					plugin: ctx.plugin.id,
					version: ctx.plugin.version,
					collections: settings.collections,
					// Who can write on this request. "members" also when the host gives no visitor address, so a
					// kit from 0.2.0 (which knows only this field) shows its sign-in line instead of a form that fails.
					who: guestWrites ? "anyone" : "members",
					guestWrites,
					// False when the host passes EmDash no visitor address: the kit then says "Sign in to write a review."
					hostAddress,
					// The owner's setting, so the kit can say "Only members can review this page." when that is the reason.
					setting: settings.who,
					askEmail: settings.askEmail,
				};
			},
		},
		// Published reviews for one entry, with its rating, bars, and one page of text reviews. At most 8 calls.
		list: {
			public: true,
			methods: ["GET"],
			handler: async (routeCtx, ctx) => {
				const at = target(routeCtx.input);
				if (!at) return EMPTY_LIST;
				const settings = await loadSettings(ctx);
				if (!(await openEntry(ctx, settings, at.collection, at.id))) return EMPTY_LIST;
				const raw = asRecord(routeCtx.input);
				const sortRaw = asString(raw.sort);
				const sort = sortRaw === "highest" || sortRaw === "lowest" ? sortRaw : "newest";
				const entry = entryKey(at.collection, at.id);
				const rating = readRating(await ctx.storage[RATINGS]!.get(entry));
				const counts = rating?.bars ?? [0, 0, 0, 0, 0];
				const bars = { 1: counts[0], 2: counts[1], 3: counts[2], 4: counts[3], 5: counts[4] };
				const total = rating?.text ?? 0;
				const pages = Math.max(1, Math.ceil(total / LIST_PAGE));
				// Page N reads N*10 rows in reads of 100: page 50 is 5 reads. The kit pages no deeper.
				const current = Math.min(Math.max(1, Math.floor(asNumber(raw.page) ?? 1)), pages, LIST_MAX_PAGE);
				const orderBy: Record<string, "asc" | "desc"> = sort === "newest" ? { createdAt: "desc" } : { stars: sort === "highest" ? "desc" : "asc" };
				const want = current * LIST_PAGE;
				const listed: Record<string, unknown>[] = [];
				let cursor: string | undefined;
				do {
					const found = await ctx.storage.reviews.query({ where: { entry, status: "published", has_text: true }, orderBy, limit: 100, cursor });
					listed.push(...rows(found));
					cursor = found.hasMore ? found.cursor : undefined;
				} while (cursor && listed.length < want);
				return {
					ok: true,
					items: listed.slice((current - 1) * LIST_PAGE, want).map(publicItem),
					average: rating?.average ?? 0,
					count: rating?.count ?? 0,
					total,
					page: current,
					pages: Math.min(pages, LIST_MAX_PAGE),
					sort,
					bars,
				};
			},
		},
		// Ratings for a page of cards in one read: ?collection=posts&ids=a,b,c. Two calls.
		summary: {
			public: true,
			methods: ["GET"],
			handler: async (routeCtx, ctx) => {
				const raw = asRecord(routeCtx.input);
				const collection = asString(raw.collection);
				const ratings: Record<string, { average: number; count: number }> = {};
				if (!(await loadSettings(ctx)).collections.includes(collection)) return { ok: true, ratings };
				const ids = [
					...new Set(
						asString(raw.ids)
							.split(",")
							.map((id) => id.trim())
							.filter(Boolean),
					),
				].slice(0, 50);
				if (!ids.length) return { ok: true, ratings };
				const found = await ctx.storage[RATINGS]!.getMany(ids.map((id) => entryKey(collection, id)));
				for (const id of ids) {
					const rating = readRating(found.get(entryKey(collection, id)));
					// `live` is kept by EmDash's publish, unpublish and delete events, so a draft shows no badge without a read per card.
					if (rating?.count && rating.live) ratings[id] = { average: rating.average, count: rating.count };
				}
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
				const stars = clampStars(raw.stars);
				const settings = await loadSettings(ctx);
				const open = await openEntry(ctx, settings, at.collection, at.id);
				if (!open) return NOT_REVIEWABLE;
				if (stars === null) return NEED_STARS;
				const limited = await takeRate(ctx, user.id);
				if (limited) return limited;
				return saveReview(ctx, {
					collection: at.collection,
					id: at.id,
					title: open.title,
					who: user.id,
					author: plainText(user.name) || "Member",
					stars,
					reviewTitle: plainText(raw.title).slice(0, TITLE_MAX),
					body: plainText(raw.body).slice(0, BODY_MAX),
					guest: false,
					email: "",
					visitor: "",
					moderate: settings.moderate,
				});
			},
		},
		write_guest: {
			public: true,
			methods: ["POST"],
			handler: async (routeCtx, ctx) => {
				const raw = asRecord(routeCtx.input);
				if (asString(raw.website)) return SPAM;
				const settings = await loadSettings(ctx);
				if (settings.who === "members") return MEMBERS_ONLY;
				// Owner decision 2026-10-16: with no visitor address there is no working per-guest limit,
				// so guests are asked to sign in. Never fall back to a browser-sent id or a shared bucket.
				const address = visitorAddress(routeCtx);
				if (!address) return GUEST_UNAVAILABLE;
				const at = target(routeCtx.input);
				if (!at) return NOT_REVIEWABLE;
				const name = plainText(raw.name).slice(0, NAME_MAX);
				if (!name) return NEED_NAME;
				const email = asString(raw.email).toLowerCase();
				if (settings.askEmail && !email.includes("@")) return NEED_EMAIL;
				const open = await openEntry(ctx, settings, at.collection, at.id);
				if (!open) return NOT_REVIEWABLE;
				const stars = clampStars(raw.stars);
				if (stars === null) return NEED_STARS;
				const guest = await guestWho(ctx, address);
				if (!guest) return BUSY;
				const limited = await takeRate(ctx, guest.id);
				if (limited) return limited;
				return saveReview(ctx, {
					collection: at.collection,
					id: at.id,
					title: open.title,
					who: guest.id,
					author: name,
					stars,
					reviewTitle: plainText(raw.title).slice(0, TITLE_MAX),
					body: plainText(raw.body).slice(0, BODY_MAX),
					guest: true,
					email: settings.askEmail ? email.slice(0, 200) : "",
					visitor: guest.visitor,
					// A guest review always waits for approval.
					moderate: true,
				});
			},
		},
		// The kit's "is this visitor signed in?" check: one cheap answer, no reads.
		me: {
			permission: MEMBER,
			methods: ["GET"],
			handler: async (routeCtx) => (routeCtx.user ? { ok: true } : SIGN_IN),
		},
		// A member's own reviews. DELETE erases them all.
		mine: {
			permission: MEMBER,
			methods: ["GET", "DELETE"],
			handler: async (routeCtx, ctx) => {
				const user = routeCtx.user as Member | undefined;
				if (!user) return SIGN_IN;
				if (routeCtx.request.method === "DELETE") {
					const done = await eraseRows(ctx, budget(), { member_id: user.id });
					// More than one call can erase: the kit asks again, and so does pressing the button again.
					if (done.more) return { ok: false, erased: done.erased, error: { code: "BUSY", reason: "MORE", message: "Try again in a moment." } };
					return { ok: true, erased: done.erased };
				}
				return listMine(ctx, user.id);
			},
		},
		admin: {
			handler: async (routeCtx, ctx) => handleAdmin(routeCtx.input, ctx, routeCtx as Parameters<typeof handleAdmin>[2]),
		},
	},
};

/**
 * My reviews: one read of the member's newest 100, one read of their pages' rating rows (address
 * and live flag), one of stored titles for reviews written before 0.3.0, and the address of up to
 * the rest of the budget's pages that have none stored. Only a public page is named.
 */
async function listMine(ctx: PluginContext, memberId: string) {
	const b = budget(1);
	const mine = rows(await ctx.storage.reviews.query({ where: { member_id: memberId }, orderBy: { createdAt: "desc" }, limit: 100 }));
	const keys = [...new Set(mine.map((row) => asString(row.entry)).filter(Boolean))];
	spend(b);
	const ratings = keys.length ? await ctx.storage[RATINGS]!.getMany(keys) : new Map<string, unknown>();
	const untitled = [...new Set(mine.filter((row) => !asString(row.entry_title)).map((row) => asString(row.entry)))];
	const titles = untitled.length && spend(b) ? await ctx.storage[ENTRIES]!.getMany(untitled) : new Map<string, unknown>();
	const urls = new Map<string, string | null>();
	for (const key of keys) {
		const rating = asRecord(ratings.get(key));
		if (rating.v === V && (asString(rating.url) || rating.live === false)) continue;
		if (b.used >= MAX_CALLS) break;
		spend(b);
		const split = key.indexOf(":");
		urls.set(key, (await ctx.content?.getPublicUrl?.(key.slice(0, split), key.slice(split + 1)).catch(() => null)) ?? null);
	}
	return {
		ok: true,
		items: mine.map((row) => {
			const key = asString(row.entry);
			const rating = asRecord(ratings.get(key));
			const fetched = urls.get(key);
			const live = rating.v === V ? rating.live !== false : fetched !== undefined ? Boolean(fetched) : titles.has(key);
			const title = asString(row.entry_title) || asString(asRecord(titles.get(key)).title);
			const url = (rating.v === V ? asString(rating.url) : "") || fetched || "";
			return {
				stars: row.stars,
				title: row.title,
				body: row.body,
				status: row.status,
				createdAt: row.createdAt,
				// Only a public entry is named.
				entry_title: live ? title : "",
				entry_url: live ? url : "",
			};
		}),
	};
}

export default plugin;

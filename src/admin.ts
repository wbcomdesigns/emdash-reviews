import type { PluginContext } from "emdash/plugin";

import { allowedCollections, allReviews, entryRefs, noMailProvider, sendMail, siteCollections, syncRating, waitingCount } from "./core";
import { asBoolean, asNumber, asRecord, asString, asStringArray, plainText, rows } from "./util";
import { guestKey } from "./visitor-key";

type Toast = { message: string; type: "success" | "error" | "info" };
type BlockResponse = { blocks: Array<Record<string, unknown>>; toast?: Toast };
type Kind = "waiting" | "published";
type View = { kind: Kind; page: number; q: string; replyId?: string; detailId?: string };
type RouteUi = { ui?: { surface?: string }; requestMeta?: { ip?: string | null } };

const PAGE_SIZE = 25;
// ponytail: find and paging walk up to this many rows of one status. Index a search field if a site passes it.
const SCAN = 5000;
const REPO = "https://github.com/wbcomdesigns/emdash-reviews";
const KIT_DONE = "kit_done";
const REPLY_MAX = 1000;
const CLIP = 80;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// A member can rewrite their own review. The stamp ties an admin's click to the exact
// version they were shown, so a rewrite cannot ride an approval.
// ponytail: check-then-write is not atomic. A rewrite landing in the few milliseconds
// between the check and the write would still be decided; needs compare-and-set in
// plugin storage to close fully.
function stamped(action: string, row: Record<string, unknown>, view: View): string {
	return [action, asString(row.rev), asString(row.id), view.kind, String(view.page), encodeURIComponent(view.q)].join("|");
}

function parseStamped(value: unknown): { action: string; stamp: string; id: string; kind: Kind; page: number; q: string } {
	const [action = "", stamp = "", id = "", kind = "waiting", page = "1", q = ""] = asString(value).split("|");
	return {
		action,
		stamp,
		id,
		kind: kind === "published" ? "published" : "waiting",
		page: Math.max(1, asNumber(page) ?? 1),
		q: decodeURIComponent(q),
	};
}

function pageOf(input: Record<string, unknown>): string {
	return asString(input.page) || asString(input.widget);
}

function kindOf(page: string): Kind | "settings" {
	if (page.includes("settings")) return "settings";
	if (page.includes("published")) return "published";
	return "waiting";
}

function viewFrom(input: Record<string, unknown>, fallback: Kind): View {
	const values = asRecord(input.values);
	const raw = asString(input.value);
	const parsed = raw.includes("|") ? parseStamped(raw) : { page: asNumber(raw) ?? 1, q: "" };
	const q = asString(values.q) || parsed.q || asString(input.q);
	const page = asNumber(values.page) ?? parsed.page ?? asNumber(input.page_number) ?? 1;
	return { kind: fallback, page: Math.max(1, page), q };
}

function isDashboard(input: Record<string, unknown>, routeCtx?: RouteUi): boolean {
	return routeCtx?.ui?.surface === "dashboard-widget" || asString(input.widget) === "waiting";
}

async function loadSettings(ctx: PluginContext) {
	const [site, rawOpen, moderate, who, askEmail, notify, notifyTo] = await Promise.all([
		siteCollections(ctx),
		allowedCollections(ctx),
		ctx.settings.get<boolean>("require_moderation"),
		ctx.settings.get<string>("who"),
		ctx.settings.get<boolean>("ask_guest_email"),
		ctx.settings.get<boolean>("notify"),
		ctx.settings.get<string>("notify_to"),
	]);
	const known = new Set(site.map((item) => item.slug));
	return {
		site,
		open: rawOpen.filter((slug) => known.has(slug)),
		moderate: moderate !== false,
		who: asString(who) === "members" ? "members" : "anyone",
		askEmail: askEmail === true,
		// Off until the owner turns it on with an address: a plugin cannot read the admin email.
		notify: notify === true,
		notifyTo: asString(notifyTo),
	};
}

/** Soft-break a long word so a Block Kit table can wrap instead of scrolling sideways. */
function wrapLong(text: string): string {
	return text.replace(/\S{32,}/g, (word) => word.match(/.{1,32}/g)?.join("\u200b") ?? word);
}

function clip(text: string): string {
	const clean = text.replace(/\s+/g, " ").trim();
	if (!clean) return "";
	const cut = clean.length > CLIP ? `${clean.slice(0, CLIP).trimEnd()}...` : clean;
	return wrapLong(cut);
}

function reviewText(row: Record<string, unknown>): { title: string; body: string; stars: unknown; full: string } {
	const title = row.pending_change === true ? asString(row.pending_title) : asString(row.title);
	const body = row.pending_change === true ? asString(row.pending_body) : asString(row.body);
	const stars = row.pending_change === true ? (asNumber(row.pending_stars) ?? row.stars) : row.stars;
	const full = [title, body].filter(Boolean).join(": ") || "Stars only";
	return { title, body, stars, full };
}

function noteFor(row: Record<string, unknown>): string {
	const bits: string[] = [];
	bits.push(row.guest === true ? "Guest" : "Member");
	if (row.pending_change === true) bits.push("Change waiting");
	return bits.join(" · ");
}

function confirm(title: string, text: string, ok: string): Record<string, unknown> {
	return { title, text, confirm: ok, deny: "Cancel" };
}

function installGuide(ctx: PluginContext): string {
	return `${REPO}/blob/v${asString(ctx.plugin.version)}/docs/website/getting-started/install.md`;
}

/**
 * The first screen tells the owner where visitor pages come from: a registry plugin cannot add
 * pages, so until the site kit is copied the visitor addresses are the site's 404. Shown until the
 * owner says the pages are set up, then one link to the guide.
 */
async function setupBlocks(ctx: PluginContext): Promise<Array<Record<string, unknown>>> {
	const guide = { type: "link", label: "Install guide", target: { kind: "external", url: installGuide(ctx) } };
	if ((await ctx.kv.get<boolean>(KIT_DONE)) === true) return [{ type: "actions", elements: [guide] }];
	const tag = `v${asString(ctx.plugin.version)}`;
	return [
		{
			type: "banner",
			title: "Set up visitor pages",
			description:
				"Visitors see reviews only after the site kit is in your site's code. A registry plugin cannot add pages by itself, so until then posts show no reviews and /account/reviews/ shows your 404 page.",
		},
		{ type: "context", text: `From your site's root folder, run this command. It gets the kit for this version (${tag}) and copy it in.` },
		{
			type: "code",
			language: "bash",
			// A fresh mktemp folder (never a fixed /tmp path someone else could create first), and the script runs only if the clone worked.
			code: `kit="$(mktemp -d)" && git clone --branch ${tag} --depth 1 ${REPO} "$kit/emdash-reviews" && "$kit/emdash-reviews/scripts/add-to-site.sh" .`,
		},
		{
			type: "fields",
			fields: [
				{ label: "Each post page", value: "Reviews, the rating bars and the review form" },
				{ label: "Post cards", value: "The star rating" },
				{ label: "/account/reviews/", value: "My reviews, for signed-in members" },
			],
		},
		{ type: "context", text: "The command prints the lines to paste into your templates and the menu link to add in Admin, Menus." },
		{
			type: "actions",
			elements: [{ type: "button", label: "Visitor pages are set up", action_id: KIT_DONE, style: "primary" }, guide],
		},
	];
}

async function listed(ctx: PluginContext, view: View) {
	const newest = { createdAt: "desc" } as const;
	let items =
		view.kind === "waiting"
			? [
					...(await allReviews(ctx, { status: "pending" }, newest, SCAN)),
					...(await allReviews(ctx, { status: "published", pending_change: true }, newest, SCAN)),
				].sort((a, b) => asString(b.createdAt).localeCompare(asString(a.createdAt)))
			: await allReviews(ctx, { status: "published" }, newest, SCAN);
	const needle = view.q.toLowerCase();
	if (needle) {
		items = items.filter((row) =>
			[row.title, row.body, row.pending_title, row.pending_body, row.author, row.owner_reply].some((value) =>
				asString(value).toLowerCase().includes(needle),
			),
		);
	}
	const total = items.length;
	const pages = Math.max(1, Math.ceil(total / PAGE_SIZE) || 1);
	const page = Math.min(Math.max(view.page, 1), pages);
	const slice = items.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
	return { slice, total, page, pages, view: { ...view, page } };
}

/** Site-wide numbers from counts and the per-page rating rows, never from one capped list. */
async function listStats(ctx: PluginContext) {
	const since = new Date(Date.now() - WEEK_MS).toISOString();
	const [waiting, week] = await Promise.all([
		waitingCount(ctx),
		ctx.storage.reviews.count({ status: "published", createdAt: { gte: since } }),
	]);
	let stars = 0;
	let count = 0;
	let cursor: string | undefined;
	do {
		const page = await ctx.storage.ratings.query({ limit: 100, cursor });
		for (const row of rows(page)) {
			const n = asNumber(row.count) ?? 0;
			stars += (asNumber(row.average) ?? 0) * n;
			count += n;
		}
		cursor = page.hasMore ? page.cursor : undefined;
	} while (cursor);
	const average = count ? Math.round((stars / count) * 10) / 10 : 0;
	return {
		type: "stats",
		items: [
			{ label: "Waiting", value: String(waiting) },
			{ label: "Published this week", value: String(week) },
			{ label: "Average rating", value: average ? average.toFixed(1) : "-" },
		],
	};
}

async function tableRows(ctx: PluginContext, items: Array<Record<string, unknown>>, view: View, actions: Array<[string, string]>) {
	const refs = await entryRefs(ctx, items);
	return items.map((row) => {
		const text = reviewText(row);
		return {
			review: clip(text.full) || "Stars only",
			on: refs.get(asString(row.entry))?.title ?? "Removed page",
			stars: text.stars ? `${text.stars} of 5` : "-",
			author: asString(row.author),
			note: noteFor(row) || "-",
			action: {
				type: "menu",
				action_id: "decide",
				label: "Decide",
				items: actions.map(([label, action]) => ({ label, value: stamped(action, row, view) })),
			},
		};
	});
}

const COLUMNS = [
	{ key: "review", label: "Review" },
	{ key: "on", label: "Page" },
	{ key: "stars", label: "Stars" },
	{ key: "author", label: "Author" },
	{ key: "note", label: "Note" },
	{ key: "action", label: "Decision", format: "element" },
];

function pager(view: View, page: number, pages: number, total: number) {
	const q = encodeURIComponent(view.q);
	const button = (label: string, next: number) => ({
		type: "button",
		label,
		action_id: "page",
		value: `${view.kind}|${next}|${q}`,
	});
	const elements = [
		page > 1 ? button("Previous", page - 1) : null,
		page < pages ? button("Next", page + 1) : null,
	].filter(Boolean);
	return [
		{ type: "context", text: `${total} ${total === 1 ? "review" : "reviews"}. Page ${page} of ${pages}.` },
		elements.length ? { type: "actions", elements } : null,
	].filter(Boolean) as Array<Record<string, unknown>>;
}

async function detailBlocks(ctx: PluginContext, view: View): Promise<Array<Record<string, unknown>>> {
	if (!view.detailId && !view.replyId) return [];
	const id = view.detailId || view.replyId || "";
	// Storage returns the data without its key; the buttons below need the id in their value.
	const row: Record<string, unknown> = { ...asRecord(await ctx.storage.reviews.get(id)), id };
	if (!row.entry) return [{ type: "banner", title: "That review no longer exists.", variant: "alert" }];
	const text = reviewText(row);
	const refs = await entryRefs(ctx, [row]);
	const pageTitle = refs.get(asString(row.entry))?.title || "Removed page";
	const waiting = view.kind === "waiting";
	const blocks: Array<Record<string, unknown>> = [
		{ type: "header", text: waiting ? "Review to decide" : view.replyId ? "Reply" : "Review" },
		{
			type: "fields",
			fields: [
				{ label: "Author", value: asString(row.author) || "-" },
				{ label: "Stars", value: text.stars ? `${text.stars} of 5` : "-" },
				{ label: "Page", value: pageTitle },
				{ label: "Note", value: noteFor(row) || "-" },
			],
		},
		{ type: "section", text: wrapLong(text.full) },
	];
	if (asString(row.owner_reply)) {
		blocks.push({ type: "section", text: `Owner reply: ${wrapLong(asString(row.owner_reply))}` });
	}
	if (waiting) {
		blocks.push({
			type: "actions",
			elements: [
				{
					type: "button",
					label: "Approve",
					action_id: "decide",
					style: "primary",
					value: stamped("approve", row, view),
					confirm: confirm("Publish this review?", text.full.slice(0, 200), "Publish"),
				},
				{
					type: "button",
					label: "Reject",
					action_id: "decide",
					style: "danger",
					value: stamped("reject", row, view),
					confirm: confirm("Take this review off the queue?", text.full.slice(0, 200), "Reject"),
				},
			],
		});
	} else if (view.replyId) {
		blocks.push({
			type: "form",
			block_id: "reply",
			fields: [
				{
					type: "text_input",
					action_id: "body",
					label: `Reply to ${asString(row.author) || "this review"}`,
					multiline: true,
					initial_value: asString(row.owner_reply),
				},
			],
			submit: { label: "Save reply", action_id: `save_reply|${id}` },
		});
	} else {
		blocks.push({
			type: "actions",
			elements: [
				{
					type: "button",
					label: "Delete",
					action_id: "decide",
					style: "danger",
					value: stamped("delete", row, view),
					confirm: confirm("Delete this review?", "It leaves the site and is removed for good. This cannot be undone.", "Delete"),
				},
			],
		});
	}
	// Close returns to the same list page without the opened review, in the same row as the other buttons.
	const close = { type: "button", label: "Close", action_id: "page", value: `${view.kind}|${view.page}|${encodeURIComponent(view.q)}` };
	const last = blocks[blocks.length - 1];
	if (last?.type === "actions" && Array.isArray(last.elements)) last.elements.push(close);
	else blocks.push({ type: "actions", elements: [close] });
	return blocks;
}

export async function renderList(ctx: PluginContext, view: View, toast?: Toast): Promise<BlockResponse> {
	const { slice, total, page, pages, view: current } = await listed(ctx, view);
	const waiting = current.kind === "waiting";
	const actions: Array<[string, string]> = waiting
		? [
				["Read", "read"],
				["Approve", "approve"],
				["Reject", "reject"],
			]
		: [
				["Read", "read"],
				["Reply", "reply"],
				// Menus cannot confirm, so Delete opens the review, whose Delete button asks first.
				["Delete", "ask_delete"],
			];
	const table = await tableRows(ctx, slice, current, actions);
	const title = waiting ? "Waiting" : "Published";
	const empty = waiting
		? { title: "Nothing waiting", description: "New reviews land here first." }
		: { title: "No published reviews yet", description: "Approved reviews show here so you can reply or remove one." };
	return {
		blocks: [
			{ type: "header", text: title },
			...(waiting ? await setupBlocks(ctx) : []),
			await listStats(ctx),
			{
				type: "form",
				block_id: "find",
				fields: [
					{
						type: "text_input",
						action_id: "q",
						label: "Find",
						initial_value: current.q,
						placeholder: "Word in the review or the name",
					},
				],
				submit: { label: "Find", action_id: "find" },
			},
			...(await detailBlocks(ctx, current)),
			...pager(current, page, pages, total),
			table.length
				? { type: "table", page_action_id: `${current.kind}_page`, columns: COLUMNS, rows: table }
				: { type: "empty", title: empty.title, description: current.q ? "No reviews match that search." : empty.description },
			!waiting
				? {
						type: "accordion",
						label: "Delete a guest's reviews by email",
						default_open: false,
						blocks: [
							{
								type: "form",
								block_id: "by_email",
								fields: [
									{
										type: "text_input",
										action_id: "email",
										label: "Guest email",
									},
								],
								submit: { label: "Delete those reviews", action_id: "delete_email" },
							},
							{ type: "context", text: "This cannot be undone. A wrong address finds nothing." },
						],
					}
				: null,
		].filter(Boolean) as Array<Record<string, unknown>>,
		toast,
	};
}

export async function renderSettings(ctx: PluginContext, routeCtx?: RouteUi, toast?: Toast): Promise<BlockResponse> {
	const settings = await loadSettings(ctx);
	const noneOpen = settings.site.length > 0 && settings.open.length === 0;
	const noSchema = settings.site.length === 0;
	// The admin's own request comes through the same host as a visitor's, so it shows whether EmDash gets visitor addresses here.
	const guestsOff = settings.who === "anyone" && guestKey(asString(routeCtx?.requestMeta?.ip)) === null;
	const noMail = await noMailProvider(ctx);
	return {
		blocks: [
			{ type: "header", text: "Settings" },
			guestsOff
				? {
						type: "banner",
						title: "Guests are asked to sign in on this hosting",
						description:
							"Guests need a host that tells EmDash the visitor's address: Cloudflare, or trustedProxyHeaders in the site config. Members can still review.",
						variant: "alert",
					}
				: null,
			guestsOff
				? {
						type: "actions",
						elements: [
							{ type: "link", label: "Guests and hosting", target: { kind: "external", url: `${installGuide(ctx)}#guests-and-hosting` } },
						],
					}
				: null,
			noSchema
				? {
						type: "banner",
						title: "Content types could not be read",
						description: "The site did not return its content types. Reviews stay on posts until this works.",
						variant: "alert",
					}
				: null,
			noneOpen
				? {
						type: "banner",
						title: "Reviews are closed",
						description: "Tick at least one content type. Until you do, no one can write a review.",
						variant: "alert",
					}
				: null,
			{
				type: "tab",
				panels: [
					{
						label: "Where",
						blocks: [
							{ type: "context", text: "Tick the kinds of page visitors can review. Names come from the site." },
							{
								type: "form",
								block_id: "settings_collections",
								fields: [
									{
										type: "checkbox",
										action_id: "collections",
										label: "Open for reviews",
										options: settings.site.map((item) => ({ label: item.label, value: item.slug })),
										initial_value: settings.open,
									},
								],
								submit: { label: "Save", action_id: "save_collections" },
							},
						],
					},
					{
						label: "Approval",
						blocks: [
							{ type: "context", text: "When this is on, a review waits here until you approve it. Star-only ratings follow the same rule." },
							{
								type: "form",
								block_id: "settings_moderation",
								fields: [
									{
										type: "toggle",
										action_id: "require_moderation",
										label: "Approve reviews before they show",
										initial_value: settings.moderate,
									},
								],
								submit: { label: "Save", action_id: "save_moderation" },
							},
						],
					},
					{
						label: "Who can review",
						blocks: [
							{ type: "context", text: "Anyone is the default. A guest review always waits for approval." },
							{
								type: "context",
								text: "Guests are counted by their visitor address, which the host must pass to EmDash. Where it does not, guests are asked to sign in.",
							},
							{
								type: "form",
								block_id: "settings_who",
								fields: [
									{
										type: "radio",
										action_id: "who",
										label: "Who can leave a review",
										options: [
											{ label: "Anyone", value: "anyone" },
											{ label: "Signed-in members only", value: "members" },
										],
										initial_value: settings.who,
									},
									{
										type: "toggle",
										action_id: "ask_guest_email",
										label: "Ask guests for an email",
										initial_value: settings.askEmail,
										condition: { field: "who", eq: "anyone" },
									},
								],
								submit: { label: "Save", action_id: "save_who" },
							},
						],
					},
					{
						label: "Email",
						blocks: [
							...(noMail
								? [
										{
											type: "banner",
											variant: "alert",
											title: "This site has no email provider",
											description:
												"No notice will be sent until one is set up, for example the official Resend plugin. The dashboard card still shows what is waiting.",
										} as Record<string, unknown>,
									]
								: []),
							...(settings.notify && !settings.notifyTo.includes("@")
								? [{ type: "banner", variant: "alert", title: "No address yet", description: "The notice is on but has nowhere to go. Add an address below." } as Record<string, unknown>]
								: []),
							{ type: "context", text: "At most one short notice an hour. It has no review text and no link." },
							{
								type: "form",
								block_id: "settings_notify",
								fields: [
									{
										type: "toggle",
										action_id: "notify",
										label: "Email me when reviews are waiting",
										initial_value: settings.notify,
									},
									{
										type: "text_input",
										action_id: "notify_to",
										label: "Send the notice to",
										placeholder: "you@yoursite.com",
										condition: { field: "notify", eq: true },
										initial_value: settings.notifyTo,
									},
								],
								submit: { label: "Save", action_id: "save_notify" },
							},
						],
					},
				],
			},
		].filter(Boolean) as Array<Record<string, unknown>>,
		toast,
	};
}

function show(ctx: PluginContext, page: string, view: View, routeCtx?: RouteUi, toast?: Toast): Promise<BlockResponse> {
	if (kindOf(page) === "settings") return renderSettings(ctx, routeCtx, toast);
	return renderList(ctx, view, toast);
}

export async function handleAdmin(input: unknown, ctx: PluginContext, routeCtx?: RouteUi): Promise<BlockResponse> {
	const raw = asRecord(input);
	const type = asString(raw.type);
	if (isDashboard(raw, routeCtx) && type !== "form_submit" && type !== "block_action") {
		return renderDashboard(ctx);
	}
	const page = pageOf(raw);
	const surface = kindOf(page);
	const kind: Kind = surface === "settings" ? "waiting" : surface;
	const view = viewFrom(raw, kind);

	if (type === "form_submit") {
		const values = asRecord(raw.values);
		const action = asString(raw.action_id);
		if (action === "find") {
			return renderList(ctx, { kind, page: 1, q: asString(values.q) });
		}
		if (action === "delete_email") {
			const email = asString(values.email).toLowerCase();
			if (!email) {
				return renderList(ctx, { kind: "published", page: 1, q: view.q }, { message: "Enter an email.", type: "error" });
			}
			const found = rows(await ctx.storage.reviews.query({ where: { email }, limit: 100 }));
			if (!found.length) {
				return renderList(ctx, { kind: "published", page: 1, q: view.q }, {
					message: "No reviews with that email.",
					type: "info",
				});
			}
			await Promise.all(found.map((row) => ctx.storage.reviews.delete(row.id)));
			for (const entry of new Set(found.map((row) => asString(row.entry)))) await syncRating(ctx, entry);
			return renderList(ctx, { kind: "published", page: 1, q: view.q }, {
				message: `Deleted ${found.length} ${found.length === 1 ? "review" : "reviews"}.`,
				type: "success",
			});
		}
		if (action.startsWith("save_reply|")) {
			const id = action.slice("save_reply|".length);
			const row = asRecord(await ctx.storage.reviews.get(id));
			if (!row.entry) {
				return renderList(ctx, { kind: "published", page: view.page, q: view.q }, {
					message: "That review no longer exists.",
					type: "error",
				});
			}
			await ctx.storage.reviews.put(id, {
				...row,
				owner_reply: plainText(values.body).slice(0, REPLY_MAX),
				owner_reply_at: new Date().toISOString(),
				rev: crypto.randomUUID(),
			});
			return renderList(ctx, { kind: "published", page: view.page, q: view.q }, { message: "Reply saved.", type: "success" });
		}
		if (action === "save_collections") {
			const site = await siteCollections(ctx);
			const known = new Set(site.map((item) => item.slug));
			const picked = asStringArray(values.collections).filter((slug) => known.has(slug));
			await ctx.settings.set("collections", picked.join(","));
			return renderSettings(ctx, routeCtx, {
				message: picked.length ? "Content types saved." : "Reviews are closed. Tick a content type to open them.",
				type: picked.length ? "success" : "info",
			});
		}
		if (action === "save_moderation") {
			await ctx.settings.set("require_moderation", asBoolean(values.require_moderation));
			return renderSettings(ctx, routeCtx, { message: "Approval saved.", type: "success" });
		}
		if (action === "save_who") {
			const who = asString(values.who) === "members" ? "members" : "anyone";
			await ctx.settings.set("who", who);
			if ("ask_guest_email" in values) {
				await ctx.settings.set("ask_guest_email", asBoolean(values.ask_guest_email));
			}
			return renderSettings(ctx, routeCtx, { message: "Who can review saved.", type: "success" });
		}
		if (action === "save_guest_email") {
			await ctx.settings.set("ask_guest_email", asBoolean(values.ask_guest_email));
			return renderSettings(ctx, routeCtx, { message: "Guest email saved.", type: "success" });
		}
		if (action === "save_notify") {
			const to = asString(values.notify_to);
			// No default address exists for a plugin to send to, so a switched-on notice needs one.
			if (asBoolean(values.notify) && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
				return renderSettings(ctx, routeCtx, { message: "Add the email address the notice should go to.", type: "error" });
			}
			await ctx.settings.set("notify", asBoolean(values.notify));
			await ctx.settings.set("notify_to", to);
			if (!asBoolean(values.notify)) return renderSettings(ctx, routeCtx, { message: "Email notice turned off.", type: "success" });
			// One short note to the owner's own address: the only way a sandboxed plugin learns whether the site can send mail.
			const site = asString(ctx.site?.name).replace(/\s+/g, " ").trim().slice(0, 80);
			const sent = await sendMail(ctx, {
				to,
				subject: "Review notices are on",
				text: `You will get at most one email an hour when reviews are waiting${site ? ` on ${site}` : ""}.`,
			});
			const toasts: Record<typeof sent, Toast> = {
				sent: { message: `Email notice saved. A test notice went to ${to}.`, type: "success" },
				none: { message: "Saved, but no notice will be sent: this site has no email provider.", type: "info" },
				failed: { message: "Saved, but the test notice could not be sent. Check the site's email provider.", type: "error" },
			};
			return renderSettings(ctx, routeCtx, toasts[sent]);
		}
	}

	if (type === "block_action" && asString(raw.action_id) === KIT_DONE) {
		await ctx.kv.set(KIT_DONE, true);
		return renderList(ctx, { kind: "waiting", page: 1, q: "" }, { message: "Noted. The install guide stays linked here.", type: "success" });
	}

	if (type === "block_action" && asString(raw.action_id) === "page") {
		const [nextKind, nextPage, nextQ] = asString(raw.value).split("|");
		return renderList(ctx, {
			kind: nextKind === "published" ? "published" : "waiting",
			page: Math.max(1, asNumber(nextPage) ?? 1),
			q: decodeURIComponent(nextQ || ""),
		});
	}

	if (type === "block_action" && asString(raw.action_id) === "decide") {
		const { action, stamp, id, kind: fromStamp, page: keep, q } = parseStamped(raw.value);
		const stay: View = { kind: fromStamp, page: keep, q };
		if (action === "read" || action === "ask_delete") return renderList(ctx, { ...stay, detailId: id });
		if (action === "reply") return renderList(ctx, { ...stay, kind: "published", replyId: id, detailId: id });
		const row = asRecord(await ctx.storage.reviews.get(id));
		if (!row.entry) return renderList(ctx, stay, { message: "That review no longer exists.", type: "error" });
		if (asString(row.rev) !== stamp) {
			return renderList(ctx, stay, { message: "That review changed after this page loaded. Check it again.", type: "error" });
		}
		if (action === "delete") {
			await ctx.storage.reviews.delete(id);
			await syncRating(ctx, asString(row.entry));
			return renderList(ctx, stay, { message: "Review deleted.", type: "success" });
		}
		if (action === "unreply") {
			await ctx.storage.reviews.put(id, { ...row, owner_reply: "", owner_reply_at: "", rev: crypto.randomUUID() });
			return renderList(ctx, { ...stay, kind: "published" }, { message: "Reply removed.", type: "success" });
		}
		if (row.pending_change === true && action === "approve") {
			await ctx.storage.reviews.put(id, {
				...row,
				stars: asNumber(row.pending_stars) ?? row.stars,
				title: asString(row.pending_title),
				body: asString(row.pending_body),
				has_text: row.pending_has_text === true,
				pending_change: false,
				pending_stars: null,
				pending_title: "",
				pending_body: "",
				pending_has_text: false,
				status: "published",
				rev: crypto.randomUUID(),
			});
		} else if (row.pending_change === true && action === "reject") {
			await ctx.storage.reviews.put(id, {
				...row,
				pending_change: false,
				pending_stars: null,
				pending_title: "",
				pending_body: "",
				pending_has_text: false,
				status: "published",
				rev: crypto.randomUUID(),
			});
		} else {
			await ctx.storage.reviews.put(id, {
				...row,
				status: action === "approve" ? "published" : "rejected",
				rev: crypto.randomUUID(),
			});
		}
		await syncRating(ctx, asString(row.entry));
		return renderList(ctx, stay, {
			message:
				action === "approve"
					? "Review published."
					: row.pending_change === true
						? "Change discarded. The live review stays."
						: "Review taken off the site.",
			type: "success",
		});
	}

	return show(ctx, page, view, routeCtx);
}

export async function renderDashboard(ctx: PluginContext): Promise<BlockResponse> {
	const waiting = await waitingCount(ctx);
	return {
		blocks: [
			{ type: "stats", items: [{ label: "Waiting", value: String(waiting) }] },
			{
				type: "actions",
				elements: [{ type: "link", label: "Open Waiting", target: { kind: "plugin-page", path: "/waiting" } }],
			},
		],
	};
}

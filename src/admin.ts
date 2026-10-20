import type { PluginContext } from "emdash/plugin";

import { loadSettings, noMailProvider, sendMail, siteCollections, type Settings, type SiteCollection } from "./core";
import {
	addToRating,
	budget,
	maintain,
	getStats,
	MAX_CALLS,
	minus,
	moveRating,
	moveStats,
	partOf,
	spend,
	statsChange,
	sumChanges,
	type Budget,
	type Stats,
	type StatsChange,
} from "./counts";
import { eraseRows } from "./erase";
import { ENTRIES, siteAndUpgrade, upgradeDone, upgradeLabel } from "./upgrade";
import { asBoolean, asNumber, asRecord, asString, asStringArray, plainText, rows } from "./util";
import { guestKey } from "./visitor-key";

type Toast = { message: string; type: "success" | "error" | "info" };
type BlockResponse = { blocks: Array<Record<string, unknown>>; toast?: Toast };
type Kind = "waiting" | "published";
/** `dir` and `bound` page by time: "before" shows reviews older than `bound`, "after" newer ones. */
type View = { kind: Kind; page: number; q: string; dir: "" | "before" | "after"; bound: string; replyId?: string; detailId?: string };
type RouteUi = { ui?: { surface?: string }; requestMeta?: { ip?: string | null } };
type Row = Record<string, unknown>;

const PAGE_SIZE = 25;
const REPO = "https://github.com/wbcomdesigns/emdash-reviews";
const TEST_AT = "test_notice_at";
const REPLY_MAX = 1000;
const CLIP = 80;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
/** Calls a list screen needs after its rows: the page titles and the week's count. */
const AFTER_ROWS = 2;

const viewParts = (view: View) => [view.kind, String(view.page), encodeURIComponent(view.q), view.dir, view.bound];

// A member can rewrite their own review. The stamp ties an admin's click to the exact version
// they were shown, and every decision is one write guarded by it, so a rewrite cannot ride an approval.
function stamped(action: string, row: Row, view: View): string {
	return [action, asString(row.rev), asString(row.id), ...viewParts(view)].join("|");
}

function viewOf(parts: string[], fallback: Kind = "waiting"): View {
	const [kind = fallback, page = "1", q = "", dir = "", bound = ""] = parts;
	return {
		kind: kind === "published" ? "published" : kind === "waiting" ? "waiting" : fallback,
		page: Math.max(1, asNumber(page) ?? 1),
		q: decodeURIComponent(q),
		dir: dir === "before" || dir === "after" ? dir : "",
		bound,
	};
}

function parseStamped(value: unknown): { action: string; stamp: string; id: string; view: View } {
	const [action = "", stamp = "", id = "", ...rest] = asString(value).split("|");
	return { action, stamp, id, view: viewOf(rest) };
}

function kindOf(page: string): Kind | "settings" {
	if (page.includes("settings")) return "settings";
	if (page.includes("published")) return "published";
	return "waiting";
}

function isDashboard(input: Row, routeCtx?: RouteUi): boolean {
	return routeCtx?.ui?.surface === "dashboard-widget" || asString(input.widget) === "waiting";
}

/** Soft-break a long word so a Block Kit table can wrap instead of scrolling sideways. */
function wrapLong(text: string): string {
	return text.replace(/\S{32,}/g, (word) => word.match(/.{1,32}/g)?.join("​") ?? word);
}

function clip(text: string): string {
	const clean = text.replace(/\s+/g, " ").trim();
	if (!clean) return "";
	const cut = clean.length > CLIP ? `${clean.slice(0, CLIP).trimEnd()}...` : clean;
	return wrapLong(cut);
}

function reviewText(row: Row): { title: string; body: string; stars: unknown; full: string } {
	const title = row.pending_change === true ? asString(row.pending_title) : asString(row.title);
	const body = row.pending_change === true ? asString(row.pending_body) : asString(row.body);
	const stars = row.pending_change === true ? (asNumber(row.pending_stars) ?? row.stars) : row.stars;
	const full = [title, body].filter(Boolean).join(": ") || "Stars only";
	return { title, body, stars, full };
}

function noteFor(row: Row): string {
	const bits: string[] = [];
	bits.push(row.guest === true ? "Guest" : "Member");
	if (row.pending_change === true) bits.push("Change waiting");
	const incoming = asString(row.pending_author);
	if (row.pending_change === true && incoming && incoming !== asString(row.author)) bits.push(`New name: ${incoming}`);
	return bits.join(" · ");
}

function confirm(title: string, text: string, ok: string): Row {
	return { title, text, confirm: ok, deny: "Cancel" };
}

function installGuide(ctx: PluginContext): string {
	return `${REPO}/blob/v${asString(ctx.plugin.version)}/docs/website/getting-started/install.md`;
}

/**
 * The first screen tells the owner where visitor pages come from: a registry plugin cannot add
 * pages, so until the site kit is copied the visitor addresses are the site's 404. Shown until the
 * owner says the pages are set up, then one link to the guide. No reads: the answer is on the site record.
 */
function setupBlocks(ctx: PluginContext, kitDone: boolean): Row[] {
	const guide = { type: "link", label: "Install guide", target: { kind: "external", url: installGuide(ctx) } };
	if (kitDone) {
		return [{ type: "actions", elements: [guide, { type: "button", label: "Show the setup steps again", action_id: "kit_again" }] }];
	}
	const tag = `v${asString(ctx.plugin.version)}`;
	return [
		{
			type: "banner",
			title: "Set up visitor pages",
			description:
				"Visitors see reviews only after the site kit is in your site's code. A registry plugin cannot add pages by itself, so until then posts show no reviews and /account/reviews/ shows your 404 page.",
		},
		{ type: "context", text: `From your site's root folder, run this command. It gets the kit for this version (${tag}) and copies it in.` },
		{
			type: "code",
			language: "bash",
			// A fresh mktemp folder (never a fixed /tmp path someone else could create first), and the script runs only if the clone worked.
			// Six lines of 52 characters or fewer (starter rule): a Block Kit code block does not wrap or scroll.
			code: [
				'kit="$(mktemp -d)" &&',
				"  git clone --depth 1 \\",
				`    --branch ${tag} \\`,
				`    ${REPO} \\`,
				'    "$kit/emdash-reviews" &&',
				'  "$kit/emdash-reviews/scripts/add-to-site.sh" .',
			].join("\n"),
		},
		{ type: "actions", elements: [{ type: "link", label: "Copy it from the install guide on a phone", target: { kind: "external", url: installGuide(ctx) } }] },
		{
			type: "fields",
			fields: [
				{ label: "Each post page", value: "Reviews, form" },
				{ label: "Post cards", value: "Star rating" },
				{ label: "/account/reviews/", value: "My reviews" },
			],
		},
		{ type: "context", text: "The command prints the lines to paste into your templates and the menu link to add in Admin, Menus." },
		{
			type: "actions",
			elements: [{ type: "button", label: "Visitor pages are set up", action_id: "kit_done", style: "primary" }, guide],
		},
	];
}

/** Reviews that match a word in the review, a name or an email. */
function matches(row: Row, needle: string): boolean {
	if (!needle) return true;
	return [row.title, row.body, row.pending_title, row.pending_body, row.author, row.pending_author, row.email, row.pending_email, row.owner_reply].some((value) =>
		asString(value).toLowerCase().includes(needle),
	);
}

type Listed = { items: Row[]; older: string; newer: string; hasOlder: boolean; hasNewer: boolean };

/**
 * One page of a list, by time. Waiting is two sources (waiting reviews, and published reviews with a
 * change waiting; the second only when the site record says there are any). Each source is read
 * 100 at a time from the bound; rows past the oldest point every source has covered wait for the
 * next page, so merging never skips a row. A search reads as many rounds as the budget allows and
 * offers Search older from where it stopped.
 * ponytail: paging by createdAt skips a row that has exactly the same time as the page bound. Times
 * are written to the millisecond, so that needs two writes in the same millisecond at a page edge.
 */
async function listed(ctx: PluginContext, b: Budget, view: View, stats: Stats): Promise<Listed> {
	const sources: Row[] =
		view.kind === "waiting" ? [{ status: "pending" }, ...(stats.changes > 0 || !stats.ready ? [{ status: "published", pending_change: true }] : [])] : [{ status: "published" }];
	const newer = view.dir === "after";
	const needle = view.q.toLowerCase();
	const found: Row[] = [];
	let bound = view.bound;
	let more = false;
	for (;;) {
		if (b.used + sources.length + AFTER_ROWS > MAX_CALLS) {
			more = true;
			break;
		}
		const reads = await Promise.all(
			sources.map((where) => {
				spend(b);
				return ctx.storage.reviews.query({
					where: { ...where, ...(bound ? { createdAt: newer ? { gt: bound } : { lt: bound } } : {}) } as never,
					orderBy: { createdAt: newer ? "asc" : "desc" },
					limit: needle ? 100 : PAGE_SIZE + 1,
				});
			}),
		);
		// The point every source has covered: past it, a source with more rows may still have some.
		let edge = "";
		for (const read of reads) {
			const last = asString(asRecord(read.items[read.items.length - 1]?.data).createdAt);
			if (!read.hasMore || !last) continue;
			if (!edge || (newer ? last < edge : last > edge)) edge = last;
		}
		const merged = reads
			.flatMap((read) => rows(read))
			.filter((row) => !edge || (newer ? asString(row.createdAt) <= edge : asString(row.createdAt) >= edge))
			.sort((x, y) => (newer ? 1 : -1) * asString(x.createdAt).localeCompare(asString(y.createdAt)));
		found.push(...merged.filter((row) => matches(row, needle)));
		more = Boolean(edge);
		if (found.length > PAGE_SIZE || !more) break;
		bound = edge;
	}
	const page = found.slice(0, PAGE_SIZE);
	const items = newer ? page.reverse() : page;
	const cut = found.length > PAGE_SIZE;
	// Where the next read starts: the last row shown when rows were left over, else where the reads stopped.
	const reach = cut ? asString(page[page.length - 1]?.createdAt) : bound;
	const first = asString(items[0]?.createdAt);
	const last = asString(items[items.length - 1]?.createdAt);
	return newer
		? { items, older: last, newer: cut || more ? reach : "", hasOlder: true, hasNewer: cut || more }
		: { items, older: cut ? last : reach, newer: first, hasOlder: cut || more, hasNewer: Boolean(view.bound) };
}

/** Site-wide numbers: the site record, and one count for the week. */
async function statsBlock(ctx: PluginContext, b: Budget, stats: Stats): Promise<Row> {
	const since = new Date(Date.now() - WEEK_MS).toISOString();
	spend(b);
	// By approval time. Reviews approved before 0.2.1 carry no publishedAt and are not counted here.
	const week = await ctx.storage.reviews.count({ status: "published", publishedAt: { gte: since } });
	return {
		type: "stats",
		items: [
			// While the site record is being counted its numbers are not known yet.
			{ label: "Waiting", value: stats.ready ? String(stats.pending + stats.changes) : "-" },
			{ label: "Published this week", value: String(week) },
			{ label: "Average rating", value: stats.ready && stats.average ? stats.average.toFixed(1) : "-" },
		],
	};
}

/** Page titles stored on 0.3.0 reviews, and for older ones the titles the upgrade stored. At most one read. */
async function titlesFor(ctx: PluginContext, b: Budget, list: Row[]): Promise<Map<string, string>> {
	const out = new Map<string, string>();
	const missing = new Set<string>();
	for (const row of list) {
		const key = asString(row.entry);
		if (asString(row.entry_title)) out.set(key, asString(row.entry_title));
		else if (key) missing.add(key);
	}
	if (missing.size && spend(b)) {
		const found = await ctx.storage[ENTRIES]!.getMany([...missing]);
		for (const [key, data] of found) out.set(key, asString(asRecord(data).title));
	}
	return out;
}

function tableRows(items: Row[], titles: Map<string, string>, view: View, actions: Array<[string, string]>, unknown: string) {
	return items.map((row) => {
		const text = reviewText(row);
		return {
			review: clip(text.full) || "Stars only",
			on: titles.get(asString(row.entry)) || unknown,
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

// No column is sortable: the order is newest first, the same order the pages follow.
const COLUMNS = [
	{ key: "review", label: "Review" },
	{ key: "on", label: "Page" },
	{ key: "stars", label: "Stars" },
	{ key: "author", label: "Author" },
	{ key: "note", label: "Note" },
	{ key: "action", label: "Decision", format: "element" },
];

function pager(view: View, list: Listed, total: number | null): Row[] {
	const button = (label: string, page: number, dir: "before" | "after", bound: string) => ({
		type: "button",
		label,
		action_id: "page",
		value: [view.kind, String(page), encodeURIComponent(view.q), dir, bound].join("|"),
	});
	const elements = [
		view.page > 1 && list.hasNewer && list.newer ? button("Previous", view.page - 1, "after", list.newer) : null,
		list.hasOlder && list.older ? button(view.q ? "Search older" : "Next", view.page + 1, "before", list.older) : null,
	].filter(Boolean);
	const pages = Math.max(1, Math.ceil((total ?? 0) / PAGE_SIZE));
	const text = view.q
		? `${list.items.length} found on this page${list.hasOlder ? ". Older reviews were not searched yet" : ""}.`
		: total === null
			? `Page ${view.page}.`
			: `${total} ${total === 1 ? "review" : "reviews"}. Page ${Math.min(view.page, pages)} of ${pages}.`;
	return [{ type: "context", text }, elements.length ? { type: "actions", elements } : null].filter(Boolean) as Row[];
}

function detailBlocks(row: Row | null, id: string, title: string, view: View): Row[] {
	if (!row) return [{ type: "banner", title: "That review no longer exists.", variant: "alert" }];
	const full: Row = { ...row, id };
	const text = reviewText(full);
	const waiting = view.kind === "waiting";
	const blocks: Row[] = [
		{ type: "header", text: waiting ? "Review to decide" : view.replyId ? "Reply" : "Review" },
		{
			type: "fields",
			fields: [
				{ label: "Author", value: asString(full.author) || "-" },
				{ label: "Stars", value: text.stars ? `${text.stars} of 5` : "-" },
				{ label: "Page", value: title || "Removed page" },
				{ label: "Note", value: noteFor(full) || "-" },
			],
		},
		// Member text exactly as written, never read as formatting.
		{ type: "code", language: "text", code: text.full },
	];
	if (asString(full.owner_reply)) blocks.push({ type: "section", text: `Owner reply: ${wrapLong(asString(full.owner_reply))}` });
	if (waiting) {
		blocks.push({
			type: "actions",
			elements: [
				{
					type: "button",
					label: "Approve",
					action_id: "decide",
					style: "primary",
					value: stamped("approve", full, view),
					confirm: confirm("Publish this review?", text.full.slice(0, 200), "Publish"),
				},
				{
					type: "button",
					label: "Reject",
					action_id: "decide",
					style: "danger",
					value: stamped("reject", full, view),
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
					label: `Reply to ${asString(full.author) || "this review"}`,
					multiline: true,
					initial_value: asString(full.owner_reply),
				},
			],
			submit: { label: "Save reply", action_id: `save_reply|${id}|${viewParts(view).join("|")}` },
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
					value: stamped("delete", full, view),
					confirm: confirm("Delete this review?", "It leaves the site and is removed for good. This cannot be undone.", "Delete"),
				},
			],
		});
	}
	// Close returns to the same list page without the opened review, in the same row as the other buttons.
	const close = { type: "button", label: "Close", action_id: "page", value: viewParts(view).join("|") };
	const last = blocks[blocks.length - 1];
	if (last?.type === "actions" && Array.isArray(last.elements)) last.elements.push(close);
	else blocks.push({ type: "actions", elements: [close] });
	return blocks;
}

/** The progress line while 0.2.x data is brought over or the site's numbers are counted again. No reads. */
function progressBlocks(view: View, stats: Stats): Row[] {
	return [
		{
			type: "banner",
			title: "Updating your reviews for this version",
			description: `${upgradeLabel(stats)}. You can approve and reply meanwhile. Visitors keep seeing reviews on each page; rating badges on post cards come back as each page is rebuilt.`,
		},
		{ type: "actions", elements: [{ type: "button", label: "Continue", action_id: "upgrade", style: "primary", value: viewParts(view).join("|") }] },
		{ type: "context", text: "It also continues by itself once an hour." },
	];
}

/** After a Continue press, whose step used the budget: the progress line and a way back to the list. No reads. */
function progressScreen(view: View, stats: Stats, toast?: Toast): BlockResponse {
	const back = { type: "actions", elements: [{ type: "button", label: "Show the list", action_id: "page", value: viewParts(view).join("|") }] };
	return { blocks: [{ type: "header", text: view.kind === "waiting" ? "Waiting" : "Published" }, ...progressBlocks(view, stats), back], toast };
}

/** The step that ends the upgrade has used the budget, so the lists come on the next press. No reads. */
function finishedScreen(view: View): BlockResponse {
	return {
		blocks: [
			{ type: "header", text: view.kind === "waiting" ? "Waiting" : "Published" },
			{ type: "banner", title: "Your reviews are up to date for this version", description: "Every page's rating and the site's totals are counted." },
			{ type: "actions", elements: [{ type: "button", label: "Show the list", action_id: "page", style: "primary", value: viewParts(view).join("|") }] },
		],
		toast: { message: "Update finished.", type: "success" },
	};
}

/**
 * A list screen. `stats` is the site record when the caller already has it (an action's own write
 * returns it); otherwise it is read here. Calls: the record, the rows (one or two reads, more for a
 * search), the review opened over the list, the page titles and the week's count.
 */
export async function renderList(ctx: PluginContext, b: Budget, view: View, stats: Stats | null, toast?: Toast): Promise<BlockResponse> {
	if (!stats) {
		spend(b);
		stats = await getStats(ctx);
	}
	const updating = !upgradeDone(stats);
	const waiting = view.kind === "waiting";
	const openId = view.detailId || view.replyId || "";
	let opened: Row | null = null;
	if (openId) {
		spend(b);
		opened = asRecord(await ctx.storage.reviews.get(openId));
		if (!opened.entry) opened = null;
	}
	const list = await listed(ctx, b, view, stats);
	const titles = await titlesFor(ctx, b, opened ? [...list.items, opened] : list.items);
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
	const table = tableRows(list.items, titles, view, actions, updating ? "Title not read yet" : "Removed page");
	const total = !stats.ready ? null : waiting ? stats.pending + stats.changes : stats.published;
	const empty = waiting
		? { title: "Nothing waiting", description: "New reviews land here first." }
		: { title: "No published reviews yet", description: "Approved reviews show here so you can reply or remove one." };
	return {
		blocks: [
			{ type: "header", text: waiting ? "Waiting" : "Published" },
			...(updating ? progressBlocks(view, stats) : waiting ? setupBlocks(ctx, stats.kitDone === true) : []),
			await statsBlock(ctx, b, stats),
			{
				type: "form",
				block_id: "find",
				fields: [
					{
						type: "text_input",
						action_id: "q",
						label: "Find",
						initial_value: view.q,
						placeholder: "Word in the review, a name or an email",
					},
				],
				submit: { label: "Find", action_id: "find" },
			},
			...(openId ? detailBlocks(opened, openId, titles.get(asString(opened?.entry)) ?? "", view) : []),
			...pager(view, list, total),
			table.length
				? { type: "table", page_action_id: `${view.kind}_page`, columns: COLUMNS, rows: table }
				: { type: "empty", title: view.dir || view.q ? "No reviews on this page" : empty.title, description: view.q ? "No reviews match that search here." : empty.description },
			!waiting
				? {
						type: "accordion",
						label: "Delete a guest's reviews by email",
						default_open: false,
						blocks: [
							{
								type: "form",
								block_id: "by_email",
								fields: [{ type: "text_input", action_id: "email", label: "Guest email" }],
								submit: { label: "Delete those reviews", action_id: "delete_email" },
							},
							{ type: "context", text: "This cannot be undone. A wrong address finds nothing." },
						],
					}
				: null,
		].filter(Boolean) as Row[],
		toast,
	};
}

type SettingsView = { settings: Settings; site: SiteCollection[]; noMail: boolean };

/** Settings: one read of every setting, the site's content types, and whether mail failed before. Parts the caller already has are passed in. */
export async function renderSettings(ctx: PluginContext, routeCtx: RouteUi | undefined, have: Partial<SettingsView> = {}, toast?: Toast): Promise<BlockResponse> {
	const [settings, site, noMail] = await Promise.all([
		have.settings ?? loadSettings(ctx),
		have.site ?? siteCollections(ctx),
		have.noMail ?? noMailProvider(ctx),
	]);
	const known = new Set(site.map((item) => item.slug));
	const open = settings.collections.filter((slug) => known.has(slug));
	const noneOpen = site.length > 0 && open.length === 0;
	const noSchema = site.length === 0;
	// The admin's own request comes through the same host as a visitor's, so it shows whether EmDash gets visitor addresses here.
	const guestsOff = settings.who === "anyone" && guestKey(asString(routeCtx?.requestMeta?.ip)) === null;
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
						elements: [{ type: "link", label: "Guests and hosting", target: { kind: "external", url: `${installGuide(ctx)}#guests-and-hosting` } }],
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
										options: site.map((item) => ({ label: item.label, value: item.slug })),
										initial_value: open,
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
								fields: [{ type: "toggle", action_id: "require_moderation", label: "Approve reviews before they show", initial_value: settings.moderate }],
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
										} as Row,
									]
								: []),
							...(settings.notify && !settings.notifyTo.includes("@")
								? [{ type: "banner", variant: "alert", title: "No address yet", description: "The notice is on but has nowhere to go. Add an address below." } as Row]
								: []),
							{ type: "context", text: "At most one short notice an hour. It has no review text and no link." },
							{
								type: "form",
								block_id: "settings_notify",
								fields: [
									{ type: "toggle", action_id: "notify", label: "Email me when reviews are waiting", initial_value: settings.notify },
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
							{ type: "context", text: "Use Send a test notice to check that this site can send email." },
							{ type: "actions", elements: [{ type: "button", label: "Send a test notice", action_id: "test_notice" }] },
						],
					},
				],
			},
		].filter(Boolean) as Row[],
		toast,
	};
}

/**
 * Most admin actions write, then draw the next screen. If drawing fails after the write, the answer
 * must not turn into an error page: say what to do instead. Nothing here hides a failed write,
 * because the message never claims the action worked.
 */
async function drawn(render: () => Promise<BlockResponse>): Promise<BlockResponse> {
	try {
		return await render();
	} catch {
		return {
			blocks: [
				{ type: "section", text: "This screen could not load. Reload the page to see where things stand." },
				{ type: "actions", elements: [{ type: "link", label: "Waiting", target: { kind: "plugin-page", path: "/waiting" } }] },
			],
			toast: { message: "This screen could not load.", type: "error" },
		};
	}
}

export function handleAdmin(input: unknown, ctx: PluginContext, routeCtx?: RouteUi): Promise<BlockResponse> {
	return drawn(() => routeAdmin(input, ctx, routeCtx));
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function routeAdmin(input: unknown, ctx: PluginContext, routeCtx?: RouteUi): Promise<BlockResponse> {
	const raw = asRecord(input);
	const type = asString(raw.type);
	if (isDashboard(raw, routeCtx) && type !== "form_submit" && type !== "block_action") return renderDashboard(ctx);
	const surface = kindOf(asString(raw.page) || asString(raw.widget));
	const kind: Kind = surface === "settings" ? "waiting" : surface;
	const action = asString(raw.action_id);
	const values = asRecord(raw.values);
	const b = budget();

	if (type === "form_submit") {
		if (action === "find") return renderList(ctx, b, { kind, page: 1, q: asString(values.q), dir: "", bound: "" }, null);
		if (action === "delete_email") return deleteByEmail(ctx, asString(values.email).toLowerCase());
		if (action.startsWith("save_reply|")) {
			const [, id = "", ...rest] = action.split("|");
			const view = { ...viewOf(rest, "published"), kind: "published" as const };
			spend(b);
			const done = await ctx.storage.reviews.updateIf(id, {
				where: {},
				set: { owner_reply: plainText(values.body).slice(0, REPLY_MAX), owner_reply_at: new Date().toISOString(), rev: crypto.randomUUID() },
			});
			if (!done.applied) return renderList(ctx, b, view, null, { message: "That review no longer exists.", type: "error" });
			return renderList(ctx, b, view, null, { message: "Reply saved.", type: "success" });
		}
		if (surface === "settings") return saveSettings(ctx, action, values, routeCtx);
	}

	if (type === "block_action") {
		if (action === "test_notice") return testNotice(ctx, routeCtx);
		if (action === "kit_again" || action === "kit_done") {
			spend(b);
			const stats = await moveStats(ctx, {}, { kit_done: action === "kit_done" });
			const toast: Toast | undefined = action === "kit_done" ? { message: "Noted. The install guide stays linked here.", type: "success" } : undefined;
			return renderList(ctx, b, { kind: "waiting", page: 1, q: "", dir: "", bound: "" }, stats, toast);
		}
		if (action === "upgrade") {
			const view = viewOf(asString(raw.value).split("|"), kind);
			const { stats, done, finished } = await siteAndUpgrade(ctx, b, true);
			if (done) return renderList(ctx, b, view, stats);
			// The step used the budget: say where it got to without another read.
			if (finished) return finishedScreen(view);
			return progressScreen(view, stats, { message: "Another step is done. Press Continue until the lists show.", type: "info" });
		}
		if (action === "page") return renderList(ctx, b, viewOf(asString(raw.value).split("|"), kind), null);
		if (action === "decide") return decide(ctx, b, raw.value);
		// The table's own paging and sort control. No column is sortable and pages come from Next, so this shows the same page again.
		if (action === `${kind}_page`) return pageLoad(ctx, b, { kind, page: 1, q: "", dir: "", bound: "" });
	}

	if (surface === "settings") return renderSettings(ctx, routeCtx);
	return pageLoad(ctx, b, { kind, page: 1, q: "", dir: "", bound: "" });
}

/**
 * Opening a list: the site record, then with what the list leaves free (its rows, titles and the
 * week's count, 4 calls) an upgrade step while 0.2.x data is brought over, or upkeep after it. The
 * lists show and work during the upgrade, with its progress line on top.
 */
async function pageLoad(ctx: PluginContext, b: Budget, view: View): Promise<BlockResponse> {
	const reserve = 2 + AFTER_ROWS;
	const { stats, done, finished } = await siteAndUpgrade(ctx, b, true, reserve);
	if (done) await maintain(ctx, b, reserve);
	// The step that finished the upgrade read the record before it: show it as finished.
	return renderList(ctx, b, view, finished ? { ...stats, ready: true, upgrade: { ...stats.upgrade, phase: "done" } } : stats);
}

async function decide(ctx: PluginContext, b: Budget, value: unknown): Promise<BlockResponse> {
	const { action, stamp, id, view } = parseStamped(value);
	if (action === "read" || action === "ask_delete") return renderList(ctx, b, { ...view, detailId: id }, null);
	if (action === "reply") return renderList(ctx, b, { ...view, kind: "published", replyId: id, detailId: id }, null);
	const now = new Date().toISOString();
	const rev = crypto.randomUUID();
	const gone = (row: Row | null) =>
		renderList(ctx, b, view, null, row ? { message: "That review changed after this page loaded. Check it again.", type: "error" } : { message: "That review no longer exists.", type: "error" });
	const read = async (): Promise<Row | null> => {
		spend(b);
		const row = asRecord(await ctx.storage.reviews.get(id));
		return row.entry ? row : null;
	};
	const finish = async (before: Row, after: Row | null, message: string) => {
		const change = minus(partOf(after), partOf(before));
		const entry = asString(before.entry);
		// The decision is stored. The counts follow it in single writes that never fail the answer.
		if (asString(after?.status) === "published" && asString(before.status) !== "published") {
			spend(b, 3);
			await addToRating(ctx, entry, change);
		} else {
			spend(b);
			await moveRating(ctx, entry, change);
		}
		spend(b);
		const stats = await moveStats(ctx, statsChange(before, after));
		return renderList(ctx, b, view, stats, { message, type: "success" });
	};

	if (action === "delete") {
		spend(b);
		const seen = await ctx.storage.reviews.getVersioned(id);
		const row = seen ? asRecord(seen.value) : null;
		if (!row?.entry) return gone(null);
		if (asString(row.rev) !== stamp) return gone(row);
		spend(b);
		if (!(await ctx.storage.reviews.compareAndDelete(id, seen!.revision)).applied) return gone(row);
		return finish(row, null, "Review deleted.");
	}
	if (action === "unreply") {
		spend(b);
		const done = await ctx.storage.reviews.updateIf(id, { where: { rev: stamp }, set: { owner_reply: "", owner_reply_at: "", rev } });
		if (!done.applied) return gone(await read());
		return renderList(ctx, b, { ...view, kind: "published" }, null, { message: "Reply removed.", type: "success" });
	}
	if (action !== "approve" && action !== "reject") return renderList(ctx, b, view, null);

	// A waiting review: one write guarded by the stamp and the status.
	spend(b);
	const plain = await ctx.storage.reviews.updateIf(id, {
		where: { rev: stamp, status: "pending" },
		set: action === "approve" ? { status: "published", publishedAt: now, rev } : { status: "rejected", publishedAt: "", rev },
	});
	if (plain.applied) {
		const after = asRecord(plain.data);
		return finish({ ...after, status: "pending" }, after, action === "approve" ? "Review published." : "Review taken off the site.");
	}
	// Otherwise a published review with a change waiting, or a stale click.
	const row = await read();
	if (!row || asString(row.rev) !== stamp || row.pending_change !== true) return gone(row);
	const cleared = { pending_change: false, pending_stars: null, pending_title: "", pending_body: "", pending_has_text: false, pending_author: "", pending_email: "", status: "published", rev };
	const set =
		action === "approve"
			? {
					...cleared,
					stars: asNumber(row.pending_stars) ?? row.stars,
					title: asString(row.pending_title),
					body: asString(row.pending_body),
					has_text: row.pending_has_text === true,
					publishedAt: asString(row.publishedAt) || now,
					author: asString(row.pending_author) || row.author,
					email: row.pending_author ? asString(row.pending_email) : row.email,
				}
			: cleared;
	spend(b);
	const done = await ctx.storage.reviews.updateIf(id, { where: { rev: stamp }, set });
	if (!done.applied) return gone(row);
	return finish(row, asRecord(done.data), action === "approve" ? "Review published." : "Change discarded. The live review stays.");
}

/**
 * A privacy erase: every review with that guest email, and the same address in a waiting change on
 * another guest's review (one visitor address, two people). Up to 100 reviews a press; Continue
 * deletes the rest. Calls: the waiting changes (read, write), the reviews (read, delete), the site
 * counts, the queued page ratings, and the Published list (rows, titles, week).
 * ponytail: clearing a waiting change writes the row read one call earlier, so a change the guest
 * sends in that moment is cleared with it.
 */
async function deleteByEmail(ctx: PluginContext, email: string): Promise<BlockResponse> {
	const view: View = { kind: "published", page: 1, q: "", dir: "", bound: "" };
	const b = budget();
	if (!email) return renderList(ctx, b, view, null, { message: "Enter an email.", type: "error" });
	spend(b);
	const editRead = await ctx.storage.reviews.query({ where: { pending_email: email }, limit: 100 });
	const edits = rows(editRead);
	const more = " More remain: press Delete those reviews again.";
	if (edits.length) {
		// This press clears the waiting changes (read, write, the site counts) and checks for the guest's
		// own reviews; the next press deletes those. A privacy erase never reports done while any are left.
		spend(b, 3);
		const cleared = edits.map(({ id, ...data }) => ({
			id,
			data: { ...data, pending_change: false, pending_stars: null, pending_title: "", pending_body: "", pending_has_text: false, pending_author: "", pending_email: "", rev: crypto.randomUUID() },
		}));
		await ctx.storage.reviews.putMany(cleared);
		const left = await ctx.storage.reviews.count({ email });
		const stats = await moveStats(ctx, sumChanges(edits.map((row, i) => statsChange(row, cleared[i]!.data))));
		const remain = editRead.hasMore || left > 0;
		const message = `Removed ${edits.length} waiting ${edits.length === 1 ? "change" : "changes"} on other reviews.${remain ? more : ""}`;
		return renderList(ctx, b, view, stats, { message, type: remain ? "info" : "success" });
	}
	const done = await eraseRows(ctx, b, { email }, 1 + AFTER_ROWS);
	if (!done.erased) return renderList(ctx, b, view, done.stats, { message: "No reviews with that email.", type: "info" });
	const message = `Deleted ${done.erased} ${done.erased === 1 ? "review" : "reviews"}.${done.more ? more : ""}`;
	return renderList(ctx, b, view, done.stats, { message, type: done.more ? "info" : "success" });
}

async function saveSettings(ctx: PluginContext, action: string, values: Row, routeCtx?: RouteUi): Promise<BlockResponse> {
	if (action === "save_collections") {
		const site = await siteCollections(ctx);
		const known = new Set(site.map((item) => item.slug));
		const picked = asStringArray(values.collections).filter((slug) => known.has(slug));
		await ctx.settings.set("collections", picked.join(","));
		return renderSettings(ctx, routeCtx, { site }, {
			message: picked.length ? "Content types saved." : "Reviews are closed. Tick a content type to open them.",
			type: picked.length ? "success" : "info",
		});
	}
	if (action === "save_moderation") {
		await ctx.settings.set("require_moderation", asBoolean(values.require_moderation));
		return renderSettings(ctx, routeCtx, {}, { message: "Approval saved.", type: "success" });
	}
	if (action === "save_who") {
		await ctx.settings.set("who", asString(values.who) === "members" ? "members" : "anyone");
		if ("ask_guest_email" in values) await ctx.settings.set("ask_guest_email", asBoolean(values.ask_guest_email));
		return renderSettings(ctx, routeCtx, {}, { message: "Who can review saved.", type: "success" });
	}
	if (action === "save_guest_email") {
		await ctx.settings.set("ask_guest_email", asBoolean(values.ask_guest_email));
		return renderSettings(ctx, routeCtx, {}, { message: "Guest email saved.", type: "success" });
	}
	if (action === "save_notify") {
		const to = asString(values.notify_to);
		// No default address exists for a plugin to send to, so a switched-on notice needs one.
		if (asBoolean(values.notify) && !EMAIL.test(to)) {
			return renderSettings(ctx, routeCtx, {}, { message: "Add the email address the notice should go to.", type: "error" });
		}
		await ctx.settings.set("notify", asBoolean(values.notify));
		await ctx.settings.set("notify_to", to);
		return renderSettings(ctx, routeCtx, {}, { message: "Saved.", type: "success" });
	}
	return renderSettings(ctx, routeCtx);
}

/**
 * Only on the owner's click: a sandboxed plugin always has ctx.email, and only a send shows whether
 * the site has a mail provider. The result sets or clears the lasting banner. At most 7 calls.
 */
async function testNotice(ctx: PluginContext, routeCtx?: RouteUi): Promise<BlockResponse> {
	const settings = await loadSettings(ctx);
	if (!EMAIL.test(settings.notifyTo)) {
		return renderSettings(ctx, routeCtx, { settings }, { message: "Save the address the notice should go to first.", type: "error" });
	}
	// At most one test a minute, so the button cannot flood an inbox. Compare-and-set: of many parallel
	// clicks exactly one claims the minute and sends.
	const wait: Toast = { message: "A test notice was just requested. Wait a minute before sending another.", type: "info" };
	const seen = await ctx.kv.getVersioned<number>(TEST_AT);
	if (seen && Date.now() - Number(seen.value) < 60_000) return renderSettings(ctx, routeCtx, { settings }, wait);
	const claim = await ctx.kv.compareAndSet(TEST_AT, seen?.revision ?? null, Date.now());
	if (!claim.applied) return renderSettings(ctx, routeCtx, { settings }, wait);
	const site = asString(ctx.site?.name).replace(/\s+/g, " ").trim().slice(0, 80);
	const sent = await sendMail(ctx, {
		to: settings.notifyTo,
		subject: "Test notice from Reviews",
		text: `This is the test you asked for. Notices about waiting reviews${site ? ` on ${site}` : ""} will reach this address.`,
	});
	// Nothing could go out: free the minute so the owner can test again as soon as a provider is set up.
	if (sent === "none") await ctx.kv.compareAndDelete(TEST_AT, claim.revision).catch(() => undefined);
	const toasts: Record<typeof sent, Toast> = {
		sent: { message: `Test notice sent to ${settings.notifyTo}.`, type: "success" },
		none: { message: "No notice was sent: this site has no email provider.", type: "error" },
		failed: { message: "The test notice could not be sent. Check the site's email provider.", type: "error" },
	};
	// The send just told whether mail works; a failed send leaves the earlier answer as it was.
	return renderSettings(ctx, routeCtx, { settings, ...(sent === "failed" ? {} : { noMail: sent === "none" }) }, toasts[sent]);
}

/** The dashboard card: the site record, or two counts while it is being made; then one queued rating change. */
export async function renderDashboard(ctx: PluginContext): Promise<BlockResponse> {
	const b = budget();
	const { stats, done } = await siteAndUpgrade(ctx, b, false);
	let waiting = stats.pending + stats.changes;
	if (!stats.ready) {
		spend(b, 2);
		const [pending, changed] = await Promise.all([
			ctx.storage.reviews.count({ status: "pending" }),
			ctx.storage.reviews.count({ status: "published", pending_change: true }),
		]);
		waiting = pending + changed;
	}
	if (done) await maintain(ctx, b, 0, 2);
	return {
		blocks: [
			{ type: "stats", items: [{ label: "Waiting", value: String(waiting) }] },
			{ type: "actions", elements: [{ type: "link", label: "Open Waiting", target: { kind: "plugin-page", path: "/waiting" } }] },
		],
	};
}


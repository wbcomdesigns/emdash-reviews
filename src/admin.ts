import type { PluginContext } from "emdash/plugin";

import { allowedCollections, entryRefs, siteCollections, syncRating, waitingCount } from "./core";
import { asBoolean, asNumber, asRecord, asString, asStringArray, rows } from "./util";

type Toast = { message: string; type: "success" | "error" | "info" };
type BlockResponse = { blocks: Array<Record<string, unknown>>; toast?: Toast };
type Kind = "waiting" | "published";
type View = { kind: Kind; page: number; q: string; replyId?: string };

const PAGE_SIZE = 25;
// ponytail: find and paging scan this many rows per status. Raise or index a search field if a site passes it.
const SCAN = 500;
const REPLY_MAX = 1000;

const lines = (items: string[]) => items.map((text) => ({ type: "context", text }));

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
		notify: notify !== false,
		notifyTo: asString(notifyTo),
	};
}

function noteFor(row: Record<string, unknown>): string {
	const bits: string[] = [];
	if (row.guest === true) bits.push("Guest");
	if (row.pending_change === true) bits.push("Change waiting");
	return bits.join(" · ");
}

async function listed(ctx: PluginContext, view: View) {
	const published = rows(
		await ctx.storage.reviews.query({
			where: { status: "published" },
			orderBy: { createdAt: "desc" },
			limit: SCAN,
		}),
	);
	const pending = rows(
		await ctx.storage.reviews.query({
			where: { status: "pending" },
			orderBy: { createdAt: "desc" },
			limit: SCAN,
		}),
	);
	let items =
		view.kind === "waiting"
			? [...pending, ...published.filter((row) => row.pending_change === true)].sort((a, b) =>
					asString(b.createdAt).localeCompare(asString(a.createdAt)),
				)
			: published;
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

async function tableRows(
	ctx: PluginContext,
	items: Array<Record<string, unknown>>,
	view: View,
	actions: Array<[string, string]>,
) {
	const refs = await entryRefs(ctx, items);
	return items.map((row) => {
		const title = row.pending_change === true ? asString(row.pending_title) : asString(row.title);
		const body = row.pending_change === true ? asString(row.pending_body) : asString(row.body);
		const stars = row.pending_change === true ? (asNumber(row.pending_stars) ?? row.stars) : row.stars;
		return {
		review: [title, body].filter(Boolean).join(": ") || "Stars only",
		on: refs.get(asString(row.entry))?.title ?? "Removed page",
		stars: stars ? `${stars} of 5` : "-",
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

export async function renderList(ctx: PluginContext, view: View, toast?: Toast): Promise<BlockResponse> {
	const { slice, total, page, pages, view: current } = await listed(ctx, view);
	const waiting = current.kind === "waiting";
	const actions: Array<[string, string]> = waiting
		? [
				["Approve", "approve"],
				["Reject", "reject"],
			]
		: [
				["Reply", "reply"],
				["Remove reply", "unreply"],
				["Remove from site", "reject"],
			];
	const table = await tableRows(ctx, slice, current, actions);
	const title = waiting ? "Waiting" : "Published";
	const empty = waiting
		? { title: "Nothing waiting", description: "New reviews land here first." }
		: { title: "No published reviews yet", description: "Approved reviews show here so you can reply or remove one." };
	const replyRow = current.replyId ? asRecord(await ctx.storage.reviews.get(current.replyId)) : {};
	return {
		blocks: [
			{ type: "header", text: title },
			{
				type: "section",
				text: waiting
					? "Approve reviews before they show. Ratings update as you decide."
					: "Reply in public or take a review off the site.",
			},
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
			!waiting
				? {
						type: "form",
						block_id: "by_email",
						fields: [
							{
								type: "text_input",
								action_id: "email",
								label: "Find a guest by email and delete their reviews",
							},
						],
						submit: { label: "Delete those reviews", action_id: "delete_email" },
					}
				: null,
			current.replyId
				? {
						type: "form",
						block_id: "reply",
						fields: [
							{
								type: "text_input",
								action_id: "body",
								label: `Reply to ${asString(replyRow.author) || "this review"}`,
								multiline: true,
								initial_value: asString(replyRow.owner_reply),
							},
						],
						submit: { label: "Save reply", action_id: `save_reply|${current.replyId}` },
					}
				: null,
			...pager(current, page, pages, total),
			table.length
				? { type: "table", page_action_id: `${current.kind}_page`, columns: COLUMNS, rows: table }
				: { type: "empty", title: empty.title, description: current.q ? "No reviews match that search." : empty.description },
		].filter(Boolean) as Array<Record<string, unknown>>,
		toast,
	};
}

export async function renderSettings(ctx: PluginContext, toast?: Toast): Promise<BlockResponse> {
	const settings = await loadSettings(ctx);
	const noneOpen = settings.site.length > 0 && settings.open.length === 0;
	const noSchema = settings.site.length === 0;
	return {
		blocks: [
			{ type: "header", text: "Settings" },
			{ type: "section", text: "Each group saves on its own." },
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
			{ type: "header", text: "Content that can be reviewed" },
			...lines(["Tick the kinds of page visitors can review. Names come from the site. Nothing is typed."]),
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
				submit: { label: "Save content types", action_id: "save_collections" },
			},
			{ type: "divider" },
			{ type: "header", text: "Approval" },
			...lines(["When this is on, a review waits here until you approve it. Star-only ratings follow the same rule."]),
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
				submit: { label: "Save approval", action_id: "save_moderation" },
			},
			{ type: "divider" },
			{ type: "header", text: "Who can review" },
			...lines(["Anyone is the default. A guest review always waits for approval, even when member reviews go live at once."]),
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
				],
				submit: { label: "Save who can review", action_id: "save_who" },
			},
			{ type: "divider" },
			{ type: "header", text: "Guest email" },
			...lines(["Off by default. When on, a guest is asked for an email as well as a name. The email is never shown on the site."]),
			{
				type: "form",
				block_id: "settings_guest_email",
				fields: [
					{
						type: "toggle",
						action_id: "ask_guest_email",
						label: "Ask guests for an email",
						initial_value: settings.askEmail,
					},
				],
				submit: { label: "Save guest email", action_id: "save_guest_email" },
			},
			{ type: "divider" },
			{
				type: "banner",
				title: "Guest protection depends on hosting",
				description:
					"When the site has a trusted visitor address, each guest is identified by a salted hash. When it does not, a browser cookie is used and protection is weaker.",
				variant: "default",
			},
			{ type: "header", text: "Email when reviews are waiting" },
			...lines([
				"At most one short notice an hour. It does not include review text or a link. Needs mail set up on the site.",
			]),
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
						help_text: "Leave blank to use the site admin.",
						initial_value: settings.notifyTo,
					},
				],
				submit: { label: "Save email notice", action_id: "save_notify" },
			},
		].filter(Boolean) as Array<Record<string, unknown>>,
		toast,
	};
}

function show(ctx: PluginContext, page: string, view: View, toast?: Toast): Promise<BlockResponse> {
	if (kindOf(page) === "settings") return renderSettings(ctx, toast);
	return renderList(ctx, view, toast);
}

export async function handleAdmin(input: unknown, ctx: PluginContext): Promise<BlockResponse> {
	const raw = asRecord(input);
	const type = asString(raw.type);
	if (asString(raw.widget) === "waiting" && type !== "form_submit" && type !== "block_action") {
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
				owner_reply: asString(values.body).slice(0, REPLY_MAX),
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
			return renderSettings(ctx, {
				message: picked.length ? "Content types saved." : "Reviews are closed. Tick a content type to open them.",
				type: picked.length ? "success" : "info",
			});
		}
		if (action === "save_moderation") {
			await ctx.settings.set("require_moderation", asBoolean(values.require_moderation));
			return renderSettings(ctx, { message: "Approval saved.", type: "success" });
		}
		if (action === "save_who") {
			const who = asString(values.who) === "members" ? "members" : "anyone";
			await ctx.settings.set("who", who);
			return renderSettings(ctx, { message: "Who can review saved.", type: "success" });
		}
		if (action === "save_guest_email") {
			await ctx.settings.set("ask_guest_email", asBoolean(values.ask_guest_email));
			return renderSettings(ctx, { message: "Guest email saved.", type: "success" });
		}
		if (action === "save_notify") {
			await ctx.settings.set("notify", asBoolean(values.notify));
			await ctx.settings.set("notify_to", asString(values.notify_to));
			return renderSettings(ctx, { message: "Email notice saved.", type: "success" });
		}
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
		if (action === "reply") return renderList(ctx, { ...stay, kind: "published", replyId: id });
		const row = asRecord(await ctx.storage.reviews.get(id));
		if (!row.entry) return renderList(ctx, stay, { message: "That review no longer exists.", type: "error" });
		if (asString(row.rev) !== stamp) {
			return renderList(ctx, stay, { message: "That review changed after this page loaded. Check it again.", type: "error" });
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

	return show(ctx, page, view);
}

export async function renderDashboard(ctx: PluginContext): Promise<BlockResponse> {
	const waiting = await waitingCount(ctx);
	return {
		blocks: [
			{ type: "header", text: "Reviews waiting" },
			waiting
				? { type: "stats", items: [{ label: "Waiting", value: String(waiting) }] }
				: { type: "section", text: "Nothing is waiting." },
			{
				type: "actions",
				elements: [{ type: "link", label: "Open Waiting", target: { kind: "plugin-page", path: "/waiting" } }],
			},
		],
	};
}

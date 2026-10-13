import type { PluginContext } from "emdash/plugin";

import { allowedCollections, entryRefs, siteCollections, syncRating } from "./core";
import { asBoolean, asRecord, asString, asStringArray, rows } from "./util";

type Toast = { message: string; type: "success" | "error" | "info" };
type BlockResponse = { blocks: Array<Record<string, unknown>>; toast?: Toast };

const lines = (items: string[]) => items.map((text) => ({ type: "context", text }));

// A member can rewrite their own review. The stamp ties an admin's click to the exact
// version they were shown, so a rewrite cannot ride an approval.
// ponytail: check-then-write is not atomic. A rewrite landing in the few milliseconds
// between the check and the write would still be decided; needs compare-and-set in
// plugin storage to close fully.
function stamped(action: string, row: Record<string, unknown>): string {
	return `${action}|${asString(row.rev)}|${asString(row.id)}`;
}

function parseStamped(value: unknown): { action: string; stamp: string; id: string } {
	const [action = "", stamp = "", ...rest] = asString(value).split("|");
	return { action, stamp, id: rest.join("|") };
}

function pageOf(input: Record<string, unknown>): string {
	return asString(input.page) || asString(input.widget);
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

async function table(ctx: PluginContext, status: "pending" | "published", actions: Array<[string, string]>) {
	const found = await ctx.storage.reviews.query({
		where: { status },
		orderBy: { createdAt: "desc" },
		limit: 50,
	});
	const items = rows(found);
	const refs = await entryRefs(ctx, items);
	return items.map((row) => ({
		// Shown in full: what the admin reads is exactly what is live or about to be.
		review: [asString(row.title), asString(row.body)].filter(Boolean).join(": "),
		on: refs.get(asString(row.entry))?.title ?? "Removed page",
		stars: row.stars ? `${row.stars} of 5` : "-",
		author: asString(row.author),
		action: {
			type: "menu",
			action_id: "decide",
			label: "Decide",
			items: actions.map(([label, action]) => ({ label, value: stamped(action, row) })),
		},
	}));
}

const COLUMNS = [
	{ key: "review", label: "Review" },
	{ key: "on", label: "Page" },
	{ key: "stars", label: "Stars" },
	{ key: "author", label: "Author" },
	{ key: "action", label: "Decision", format: "element" },
];

export async function renderQueue(ctx: PluginContext, toast?: Toast): Promise<BlockResponse> {
	const [pending, live, pendingCount, liveCount] = await Promise.all([
		table(ctx, "pending", [
			["Approve", "approve"],
			["Reject", "reject"],
		]),
		table(ctx, "published", [["Remove from site", "reject"]]),
		ctx.storage.reviews.count({ status: "pending" }),
		ctx.storage.reviews.count({ status: "published" }),
	]);
	return {
		blocks: [
			{ type: "header", text: "Reviews" },
			{ type: "section", text: "Approve reviews before they show. Ratings update as you decide." },
			{
				type: "actions",
				elements: [{ type: "link", label: "Settings", target: { kind: "plugin-page", path: "/settings" } }],
			},
			{
				type: "stats",
				items: [
					{ label: "Waiting", value: pendingCount },
					{ label: "Published", value: liveCount },
				],
			},
			{ type: "header", text: "Waiting for approval" },
			pending.length
				? { type: "table", page_action_id: "pending_page", columns: COLUMNS, rows: pending }
				: { type: "empty", title: "Nothing waiting", description: "New reviews land here first." },
			{ type: "header", text: "Published" },
			live.length
				? { type: "table", page_action_id: "live_page", columns: COLUMNS, rows: live }
				: {
						type: "empty",
						title: "No published reviews yet",
						description: "Approved reviews show here so you can remove one later.",
					},
		],
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

export async function handleAdmin(input: unknown, ctx: PluginContext): Promise<BlockResponse> {
	const raw = asRecord(input);
	const type = asString(raw.type);
	const page = pageOf(raw);
	const show = (toast?: Toast) => (page.includes("settings") ? renderSettings(ctx, toast) : renderQueue(ctx, toast));

	if (type === "form_submit") {
		const values = asRecord(raw.values);
		const action = asString(raw.action_id);
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

	if (type === "block_action" && asString(raw.action_id) === "decide") {
		const { action, stamp, id } = parseStamped(raw.value);
		const row = asRecord(await ctx.storage.reviews.get(id));
		if (!row.entry) return renderQueue(ctx, { message: "That review no longer exists.", type: "error" });
		if (asString(row.rev) !== stamp) {
			return renderQueue(ctx, { message: "That review changed after this page loaded. Check it again.", type: "error" });
		}
		await ctx.storage.reviews.put(id, {
			...row,
			status: action === "approve" ? "published" : "rejected",
			// A new token, so a second click from a stale tab is refused.
			rev: crypto.randomUUID(),
		});
		await syncRating(ctx, asString(row.entry));
		return renderQueue(ctx, {
			message: action === "approve" ? "Review published." : "Review taken off the site.",
			type: "success",
		});
	}

	return show();
}

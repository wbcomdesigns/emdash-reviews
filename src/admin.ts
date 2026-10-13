import type { PluginContext } from "emdash/plugin";

import { allowedCollections, entryRefs, syncRating } from "./core";
import { asBoolean, asRecord, asString, rows } from "./util";

type Toast = { message: string; type: "success" | "error" | "info" };
type BlockResponse = { blocks: Array<Record<string, unknown>>; toast?: Toast };

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

async function render(ctx: PluginContext, toast?: Toast): Promise<BlockResponse> {
	const [pending, live, pendingCount, liveCount, collections, moderate] = await Promise.all([
		table(ctx, "pending", [["Approve", "approve"], ["Reject", "reject"]]),
		table(ctx, "published", [["Remove from site", "reject"]]),
		ctx.storage.reviews.count({ status: "pending" }),
		ctx.storage.reviews.count({ status: "published" }),
		allowedCollections(ctx),
		ctx.settings.get<boolean>("require_moderation"),
	]);
	return {
		blocks: [
			{ type: "header", text: "Reviews" },
			{ type: "section", text: "Approve reviews before they show. Ratings update as you decide." },
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
			{ type: "divider" },
			{ type: "header", text: "Settings" },
			{
				type: "form",
				block_id: "settings",
				fields: [
					{
						type: "text_input",
						action_id: "collections",
						label: "Content that can be reviewed",
						help_text: "Collection slugs, separated by commas. Example: posts, products",
						initial_value: collections.join(", "),
					},
					{
						type: "toggle",
						action_id: "require_moderation",
						label: "Approve reviews before they show",
						initial_value: moderate !== false,
					},
				],
				submit: { label: "Save settings", action_id: "save_settings" },
			},
		],
		toast,
	};
}

export async function handleAdmin(input: unknown, ctx: PluginContext): Promise<BlockResponse> {
	const raw = asRecord(input);
	const type = asString(raw.type);

	if (type === "form_submit" && asString(raw.action_id) === "save_settings") {
		const values = asRecord(raw.values);
		await ctx.settings.set("collections", asString(values.collections));
		await ctx.settings.set("require_moderation", asBoolean(values.require_moderation));
		return render(ctx, { message: "Settings saved.", type: "success" });
	}

	if (type === "block_action" && asString(raw.action_id) === "decide") {
		const { action, stamp, id } = parseStamped(raw.value);
		const row = asRecord(await ctx.storage.reviews.get(id));
		if (!row.entry) return render(ctx, { message: "That review no longer exists.", type: "error" });
		if (asString(row.rev) !== stamp) {
			return render(ctx, { message: "That review changed after this page loaded. Check it again.", type: "error" });
		}
		await ctx.storage.reviews.put(id, {
			...row,
			status: action === "approve" ? "published" : "rejected",
			// A new token, so a second click from a stale tab is refused.
			rev: crypto.randomUUID(),
		});
		await syncRating(ctx, asString(row.entry));
		return render(ctx, {
			message: action === "approve" ? "Review published." : "Review taken off the site.",
			type: "success",
		});
	}

	return render(ctx);
}

import type { PluginContext } from "emdash/plugin";

import { guestKey } from "./visitor-key";
import { asString, asStringArray } from "./util";

// Lowest signed-in role (subscriber). Private routes get a host-verified routeCtx.user.
// A public route never gets a user, and a member id in the request is never trusted.
export const MEMBER = "content:read";

export type Member = { id: string; name: string | null; role: number };

export const SIGN_IN = { ok: false, error: { code: "SIGN_IN_REQUIRED", message: "Sign in to continue." } };
export const MEMBERS_ONLY = { ok: false, error: { code: "MEMBERS_ONLY", message: "Sign in to continue." } };
export const RATE_LIMITED = {
	ok: false,
	error: { code: "RATE_LIMITED", message: "Too many requests. Try again in an hour." },
};
/** Another request from the same visitor, or the same click twice, is being handled. Nothing was stored. */
export const BUSY = { ok: false, error: { code: "BUSY", message: "Try again in a moment." } };

export const GUEST_UNAVAILABLE = {
	ok: false,
	error: { code: "GUEST_UNAVAILABLE", message: "Sign in to write a review." },
};

export type Settings = {
	collections: string[];
	moderate: boolean;
	who: "members" | "anyone";
	askEmail: boolean;
	notify: boolean;
	notifyTo: string;
};

/** Every setting in one call (ctx.settings.list), so no path pays one call per setting. */
export async function loadSettings(ctx: PluginContext): Promise<Settings> {
	const all = new Map((await ctx.settings.list()).map((row) => [row.key, row.value]));
	const raw = all.get("collections");
	return {
		// Posts until the owner saves. An empty save means none.
		collections: raw === undefined || raw === null ? ["posts"] : asStringArray(raw),
		moderate: all.get("require_moderation") !== false,
		who: asString(all.get("who")) === "members" ? "members" : "anyone",
		askEmail: all.get("ask_guest_email") === true,
		// Off until the owner turns it on with an address: a plugin cannot read the admin email.
		notify: all.get("notify") === true,
		notifyTo: asString(all.get("notify_to")),
	};
}

const RATE_WINDOW_MS = 60 * 60 * 1000;
const RATE_MAX = 8;

/**
 * One key per visitor, `rate:write:<who>`, holding `<hour start>|<writes this hour>`, counted with one
 * compare-and-set: two calls, or one when the limit is reached. Two writes sent together cannot both
 * count as the same write: the one that loses the compare-and-set answers BUSY and stores nothing.
 */
export async function takeRate(ctx: PluginContext, who: string): Promise<null | typeof RATE_LIMITED | typeof BUSY> {
	const key = `rate:write:${who}`;
	const seen = await ctx.kv.getVersioned<string>(key);
	const [start = 0, count = 0] = asString(seen?.value || "0|0").split("|").map(Number);
	const now = Date.now();
	const fresh = now - start > RATE_WINDOW_MS;
	if (!fresh && count >= RATE_MAX) return RATE_LIMITED;
	const next = fresh ? `${now}|1` : `${start}|${count + 1}`;
	const claimed = await ctx.kv.compareAndSet(key, seen?.revision ?? null, next);
	return claimed.applied ? null : BUSY;
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

type Meta = { requestMeta?: { ip?: string | null } };

/** The visitor address EmDash passed in, or null. Only Cloudflare, or a site with trustedProxyHeaders, passes one. */
export function visitorAddress(routeCtx: unknown): string | null {
	return guestKey(asString((routeCtx as Meta).requestMeta?.ip));
}

async function sha256Hex(text: string): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
	return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * One guest per visitor address (an IPv6 /64), hashed with a per-site salt. Never the address itself.
 * One read, or two for the very first guest. Null when another first guest created the salt at the
 * same moment: never a one-off salt, which would let the same guest write twice. The caller answers BUSY.
 */
export async function guestWho(ctx: PluginContext, address: string): Promise<{ id: string; visitor: string } | null> {
	const seen = await ctx.kv.getVersioned<string>("visitor_salt");
	let salt = asString(seen?.value);
	if (!salt) {
		salt = crypto.randomUUID();
		if (!(await ctx.kv.compareAndSet("visitor_salt", seen?.revision ?? null, salt)).applied) return null;
	}
	const visitor = await sha256Hex(`${salt}:${address}`);
	return { id: `v-${visitor}`, visitor };
}

/** Set to "none" when EmDash answered that no email provider is set up, "ok" after a send went out. */
export const MAIL_STATUS = "mail_status";

/**
 * Send one email and remember whether the site can send mail. A sandboxed plugin always gets
 * ctx.email when it asks for email:send; only a send tells whether a provider exists. Two calls.
 */
export async function sendMail(
	ctx: PluginContext,
	message: { to: string; subject: string; text: string },
): Promise<"sent" | "none" | "failed"> {
	if (!ctx.email) {
		await ctx.kv.set(MAIL_STATUS, "none");
		return "none";
	}
	try {
		await ctx.email.send(message);
		// The mail went out: a failed note must not turn the answer into an error.
		await ctx.kv.set(MAIL_STATUS, "ok").catch(() => undefined);
		return "sent";
	} catch (error) {
		if (/not configured|no email provider/i.test(String((error as Error)?.message ?? error))) {
			await ctx.kv.set(MAIL_STATUS, "none");
			return "none";
		}
		return "failed";
	}
}

export async function noMailProvider(ctx: PluginContext): Promise<boolean> {
	return !ctx.email || (await ctx.kv.get<string>(MAIL_STATUS)) === "none";
}

export function asRecord(input: unknown): Record<string, unknown> {
	return input !== null && typeof input === "object" && !Array.isArray(input)
		? (input as Record<string, unknown>)
		: {};
}

export function asString(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

/** Text a person typed, stored as plain text: anything shaped like an HTML tag is dropped, so it never shows as "<b>". */
export function plainText(value: unknown): string {
	return asString(value).replace(/<[^>]*>/g, "").replace(/[ \t]{2,}/g, " ").trim();
}

export function asBoolean(value: unknown): boolean {
	return value === true || value === "true" || value === 1 || value === "1";
}

export function asNumber(value: unknown): number | null {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value === "string" && value.trim() !== "") {
		const parsed = Number(value);
		return Number.isFinite(parsed) ? parsed : null;
	}
	return null;
}

export function asStringArray(value: unknown): string[] {
	if (Array.isArray(value)) {
		return value.map(asString).filter(Boolean);
	}
	const text = asString(value);
	if (!text) return [];
	return text
		.split(",")
		.map((part) => part.trim())
		.filter(Boolean);
}

export function parseJson<T>(value: unknown, fallback: T): T {
	if (typeof value === "object" && value !== null) return value as T;
	const text = asString(value);
	if (!text) return fallback;
	try {
		return JSON.parse(text) as T;
	} catch {
		return fallback;
	}
}

export function nowIso(): string {
	return new Date().toISOString();
}

export type Row = Record<string, unknown> & { id: string };

/** Flatten a storage query result into plain rows carrying their id. */
export function rows(result: { items: Array<{ id: string; data: unknown }> }): Row[] {
	return result.items.map((item) => ({ ...asRecord(item.data), id: item.id }));
}

/**
 * The address a guest is counted by, or null when the host gave none. An IPv6 visitor counts by
 * the /64 network, so rotating addresses inside one network is still one guest.
 */
export function guestAddress(value: unknown): string | null {
	const ip = asString(value).toLowerCase().replace(/%.*$/, "");
	if (!ip || ip === "unknown") return null;
	if (!ip.includes(":")) return ip;
	const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(ip);
	if (mapped) return mapped[1];
	const [head = "", tail = ""] = ip.split("::");
	const left = head ? head.split(":") : [];
	const right = ip.includes("::") && tail ? tail.split(":") : [];
	const groups = ip.includes("::") ? [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill("0"), ...right] : left;
	return `${groups
		.slice(0, 4)
		.map((group) => (Number.parseInt(group, 16) || 0).toString(16))
		.join(":")}::/64`;
}

import { afterEach, describe, expect, it, vi } from "vitest";

import { pluginFetch, registryPluginId } from "../site-kit/lib/wbcom-kit";

const SLUG = "reviews";
const missing = () =>
	new Response(JSON.stringify({ success: false, error: { code: "NOT_FOUND", message: "Plugin route not found" } }), {
		status: 404,
	});
const ok = () => new Response(JSON.stringify({ success: true, data: { ok: true } }), { status: 200 });

async function fresh() {
	vi.resetModules();
	return (await import("../site-kit/lib/wbcom-kit")).pluginFetch as typeof pluginFetch;
}

afterEach(() => {
	vi.unstubAllGlobals();
	try {
		sessionStorage.clear();
	} catch {
		// Node has no sessionStorage.
	}
});

describe("kit finds Reviews routes on any install", () => {
	it("computes the registry id EmDash uses on every site", async () => {
		expect(await registryPluginId(SLUG)).toBe("r_nt2pnhev44oaara3");
	});

	it("uses the registry id on a registry install and remembers it", async () => {
		const call = await fresh();
		const id = await registryPluginId(SLUG);
		const seen: string[] = [];
		vi.stubGlobal("fetch", async (url: string) => (seen.push(url), url.includes(id) ? ok() : missing()));
		expect((await call(SLUG, "health")).status).toBe(200);
		await call(SLUG, "health");
		expect(seen).toEqual([`/_emdash/api/plugins/${id}/health`, `/_emdash/api/plugins/${id}/health`]);
	});

	it("falls back to the name on a local install", async () => {
		const call = await fresh();
		const seen: string[] = [];
		vi.stubGlobal("fetch", async (url: string) => (seen.push(url), url.includes(`/${SLUG}/`) ? ok() : missing()));
		expect((await call(SLUG, "health")).status).toBe(200);
		await call(SLUG, "health");
		expect(seen.at(-1)).toBe(`/_emdash/api/plugins/${SLUG}/health`);
		expect(seen).toHaveLength(3);
	});

	it("never remembers a failure, and forgets an address that stops answering", async () => {
		const call = await fresh();
		const id = await registryPluginId(SLUG);
		let up = false;
		const seen: string[] = [];
		vi.stubGlobal("fetch", async (url: string) => (seen.push(url), up && url.includes(id) ? ok() : missing()));
		expect((await call(SLUG, "health")).status).toBe(404);
		up = true;
		expect((await call(SLUG, "health")).status).toBe(200);
		up = false;
		seen.length = 0;
		await call(SLUG, "health");
		expect(seen).toHaveLength(3);
	});

	it("keeps the plugin's own 404 answer instead of trying another address", async () => {
		const call = await fresh();
		const seen: string[] = [];
		vi.stubGlobal(
			"fetch",
			async (url: string) => (
				seen.push(url),
				new Response(JSON.stringify({ success: false, error: { code: "NOT_FOUND", message: "No such review" } }), {
					status: 404,
				})
			),
		);
		expect((await call(SLUG, "list?id=x")).status).toBe(404);
		expect(seen).toHaveLength(1);
	});
});

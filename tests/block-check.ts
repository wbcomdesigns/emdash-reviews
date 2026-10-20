/**
 * Every admin answer in every test is checked with EmDash's own Block Kit validator, the one EmDash
 * runs on a sandboxed plugin's admin response (an invalid one reaches the owner as a 502,
 * INVALID_BLOCK_RESPONSE). Loaded for every test file by vitest.config.ts. Shared by every Wbcom
 * plugin: copy this file byte for byte, change it in the starter first.
 */
import { validateBlockResponse } from "@emdash-cms/blocks/server";
import { vi } from "vitest";

type Host = {
	manifest: { admin?: { pages?: Array<{ path: string }> } };
	transport: { invokeRoute: (name: string, ...rest: unknown[]) => Promise<unknown> };
	admin: Record<string, (...args: unknown[]) => Promise<unknown>>;
};

export function assertBlocks(where: string, response: unknown, pagePaths: string[]): void {
	const result = validateBlockResponse(response, { pluginPagePaths: pagePaths });
	if (!result.valid) throw new Error(`${where} returned invalid Block Kit: ${JSON.stringify(result.errors)}`);
}

function checked(rt: Host): Host {
	const paths = (rt.manifest.admin?.pages ?? []).map((page) => page.path);
	const invoke = rt.transport.invokeRoute.bind(rt.transport);
	rt.transport.invokeRoute = async (name: string, ...rest: unknown[]) => {
		const result = await invoke(name, ...rest);
		if (name === "admin") assertBlocks(`admin ${JSON.stringify(rest[0] ?? {}).slice(0, 120)}`, result, paths);
		return result;
	};
	for (const method of ["loadPage", "loadWidget"]) {
		const original = rt.admin[method]?.bind(rt.admin);
		if (!original) continue;
		rt.admin[method] = async (...args: unknown[]) => {
			const result = await original(...args);
			assertBlocks(`admin ${method} ${String(args[0])}`, result, paths);
			return result;
		};
	}
	return rt;
}

vi.mock("@emdash-cms/plugin-test", async (importOriginal) => {
	const mod = await importOriginal<typeof import("@emdash-cms/plugin-test")>();
	return {
		...mod,
		createPluginRuntimeTestHost: async (...args: Parameters<typeof mod.createPluginRuntimeTestHost>) =>
			checked((await mod.createPluginRuntimeTestHost(...args)) as unknown as Host) as unknown as Awaited<ReturnType<typeof mod.createPluginRuntimeTestHost>>,
	};
});

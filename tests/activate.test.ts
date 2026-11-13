import { describe, expect, it } from "vitest";

import plugin from "../src/plugin";

type Handler = (event: unknown, ctx: unknown) => Promise<void>;
const hook = (name: string) => (plugin.hooks as Record<string, { handler: Handler }>)[name]!.handler;

/** A site whose scheduler and storage both fail. */
function site() {
	const logged: string[] = [];
	const fail = async () => Promise.reject(new Error("unavailable"));
	const ctx = {
		cron: { schedule: fail },
		kv: { get: fail },
		storage: { reviews: { count: fail }, stats: { compareAndSet: fail } },
		log: { error: (message: string) => logged.push(message), info() {}, warn() {} },
	};
	return { ctx, logged };
}

const MESSAGE = "WB Reviews could not finish setting up. Deactivate and activate it again.";

describe("a failed setup never disables WB Reviews (EmDash 1.5 disables a plugin whose install or activate throws)", () => {
	it("plugin:install logs both failed steps instead of throwing", async () => {
		const { ctx, logged } = site();
		await expect(hook("plugin:install")({}, ctx)).resolves.toBeUndefined();
		expect(logged).toEqual([MESSAGE, MESSAGE]);
	});

	it("plugin:install still makes the site record when only the scheduler fails", async () => {
		const { ctx, logged } = site();
		let made = 0;
		Object.assign(ctx, {
			kv: { get: async () => null },
			storage: { reviews: { count: async () => 0 }, stats: { compareAndSet: async () => ((made += 1), { applied: true }) } },
		});
		await expect(hook("plugin:install")({}, ctx)).resolves.toBeUndefined();
		expect(made).toBe(1);
		expect(logged).toEqual([MESSAGE]);
	});

	it("plugin:activate logs the error instead of throwing", async () => {
		const { ctx, logged } = site();
		await expect(hook("plugin:activate")({}, ctx)).resolves.toBeUndefined();
		expect(logged).toEqual([MESSAGE]);
	});
});

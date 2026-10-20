import { describe, expect, it, vi } from "vitest";

import reviews from "../site-kit/components/Reviews.astro?raw";
import mine from "../site-kit/components/MyReviews.astro?raw";

/** The inline script of Reviews.astro, run against a small stand-in for the page. */
function runInline() {
	const inline = /<script is:inline>([\s\S]*?)<\/script>/.exec(reviews)?.[1];
	expect(inline, "Reviews.astro has an inline early-submit guard").toBeTruthy();
	class El {
		dataset: Record<string, string> = {};
		attrs: Record<string, string> = {};
		button = { setAttribute: (k: string, v: string) => (this.attrs[k] = v) };
		closest(selector: string) {
			return selector === "[data-wbr-form]" ? this : null;
		}
		querySelector() {
			return this.button;
		}
	}
	const listeners: Array<(event: unknown) => void> = [];
	const document = { addEventListener: (type: string, fn: (event: unknown) => void) => type === "submit" && listeners.push(fn) };
	new Function("window", "document", "Element", inline!)({}, document, El);
	const send = (form: El) => {
		const event = { target: form, preventDefault: vi.fn() };
		for (const fn of listeners) fn(event);
		return event.preventDefault;
	};
	return { El, send };
}

describe("a review sent before the kit script binds", () => {
	it("is held, never sent by the browser itself, and Submit shows as busy", () => {
		const { El, send } = runInline();
		const form = new El();
		expect(send(form)).toHaveBeenCalled();
		expect(form.dataset.wbrQueued).toBe("1");
		expect(form.button).toBeDefined();
		expect((form as unknown as { attrs: Record<string, string> }).attrs["aria-busy"]).toBe("true");
	});

	it("goes through the kit once it is bound", () => {
		const { El, send } = runInline();
		const form = new El();
		form.dataset.wbrReady = "1";
		expect(send(form)).not.toHaveBeenCalled();
		// The kit marks the form ready and sends a held review.
		expect(reviews).toMatch(/form\.dataset\.wbrReady = "1";[\s\S]*form\.dataset\.wbrQueued[\s\S]*form\.requestSubmit\(\)/);
	});

	it("never sends with GET, so a review can never land in the address", () => {
		expect(reviews).toMatch(/<form class="wb-form" data-wbr-form method="post"/);
	});
});

describe("Delete all my reviews", () => {
	it("says it is deleting until the list is back", () => {
		const press = mine.slice(mine.indexOf('erase.setAttribute("aria-busy", "true")'));
		expect(press.indexOf("S.erasing")).toBeGreaterThan(-1);
		expect(press.indexOf("S.erasing")).toBeLessThan(press.indexOf('api("reviews", "mine", undefined, "DELETE")'));
	});
});

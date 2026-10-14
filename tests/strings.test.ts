import { describe, expect, it } from "vitest";

import { badge } from "../site-kit/lib/reviews-strings";

describe("badge screen-reader text", () => {
	it("uses review in the singular and reviews in the plural", () => {
		expect(badge.sr("5.0", 1)).toBe("rated 5.0 out of 5 from 1 review");
		expect(badge.sr("4.5", 2)).toBe("rated 4.5 out of 5 from 2 reviews");
	});
});

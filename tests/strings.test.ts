import { describe, expect, it } from "vitest";

import { badge, reviews } from "../site-kit/lib/reviews-strings";

describe("badge screen-reader text", () => {
	it("uses review in the singular and reviews in the plural", () => {
		expect(badge.sr("5.0", 1)).toBe("rated 5.0 out of 5 from 1 review");
		expect(badge.sr("4.5", 2)).toBe("rated 4.5 out of 5 from 2 reviews");
	});

	it("describes stars-only ratings without claiming the first written review", () => {
		expect(reviews.starsOnlyHint(1)).toBe("1 rating, no written reviews yet. Write the first one.");
		expect(reviews.starsOnlyHint(2)).toBe("2 ratings, no written reviews yet. Write the first one.");
	});
});

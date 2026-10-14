import { describe, expect, it } from "vitest";

import block from "../site-kit/blocks/plugin.ts?raw";
import manifest from "../emdash-plugin.jsonc?raw";

describe("in-text blocks", () => {
	it("offers Reviews and Rating by name, and the registry manifest does not", () => {
		expect(block).toContain('label: "Reviews"');
		expect(block).toContain('label: "Rating"');
		expect(block).toContain("Heading (optional)");
		expect(block).toContain('initial_value: "reviews"');
		expect(block).toContain('initial_value: "stars"');
		expect(manifest).not.toContain("portableTextBlocks");
	});
});

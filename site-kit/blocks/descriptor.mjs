// Optional: Reviews and Rating blocks for post and page text. They need a trusted
// install, which means adding them to plugins: [] in astro.config.mjs (see the install
// guide). WB Reviews from the registry works without them.
export function reviewsBlock() {
	return {
		id: "reviews-block",
		version: "1.0.0",
		format: "native",
		entrypoint: "/src/reviews-block/plugin.ts",
		componentsEntry: "/src/reviews-block/components.ts",
	};
}

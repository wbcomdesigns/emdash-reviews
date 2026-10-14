import { definePlugin } from "emdash";

export function createPlugin() {
	return definePlugin({
		id: "reviews-block",
		version: "1.0.0",
		admin: {
			portableTextBlocks: [
				{
					type: "reviewsForEntry",
					label: "Reviews",
					description: "Reviews and the form for this page",
					fields: [
						{
							type: "select",
							action_id: "show",
							label: "What to show",
							initial_value: "reviews",
							options: [{ label: "Reviews and the form", value: "reviews" }],
						},
						{ type: "text_input", action_id: "heading", label: "Heading (optional)" },
					],
				},
				{
					type: "reviewsRating",
					label: "Rating",
					description: "The star rating for this page",
					fields: [
						{
							type: "select",
							action_id: "show",
							label: "What to show",
							initial_value: "stars",
							options: [{ label: "The star rating", value: "stars" }],
						},
					],
				},
			],
		},
	});
}

export default createPlugin;

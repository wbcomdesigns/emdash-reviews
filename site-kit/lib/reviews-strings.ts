/** Every phrase a visitor can see. Edit this file to reword or translate the kit. */

export const reviews = {
	heading: "Reviews",
	loading: "Loading reviews…",
	none: "No reviews yet",
	emptyTitle: "Be the first to review this.",
	emptyHint: "Your review helps the next visitor decide.",
	loadError: "Reviews could not be loaded. Refresh to try again.",
	writeHeading: "Write a review",
	rating: "Your rating",
	star: (n: number) => (n === 1 ? "1 star" : `${n} stars`),
	outOf5: (n: number) => `${n} out of 5`,
	summary: (avg: string, count: number) =>
		`${avg} out of 5 · ${count} ${count === 1 ? "review" : "reviews"}`,
	member: "Member",
	headline: "Headline",
	optional: "(optional)",
	body: "Your review",
	bodyHelp: "Up to 1000 characters. You need to be signed in.",
	submit: "Submit review",
	needText: "Write a few words before you submit.",
	thanksPending: "Thanks. Your review will show once it is approved.",
	thanksLive: "Thanks. Your review is live.",
	signIn: "Sign in to continue.",
	signInLink: "Sign in",
	closed: "Reviews are not open for that page.",
	rateLimited: "Too many requests. Try again in an hour.",
	offline: "Could not reach the site. Check your connection.",
	fallback: "Something went wrong. Try again.",
};

export const badge = {
	sr: (avg: string, count: number) => `rated ${avg} out of 5 from ${count} reviews`,
};

export const mine = {
	heading: "My reviews",
	loading: "Loading your reviews…",
	emptyTitle: "You have not written a review yet.",
	emptyHint: "Reviews you write show here with their status.",
	erase: "Delete all my reviews",
	eraseAgain: "Click again to delete them for good",
	erased: "Your reviews were deleted.",
	gone: "Page no longer available",
	pending: "Awaiting approval",
	published: "Published",
	rejected: "Not approved",
};

const CODES: Record<string, string> = {
	SIGN_IN_REQUIRED: reviews.signIn,
	VALIDATION_ERROR: reviews.needText,
	NOT_FOUND: reviews.closed,
	RATE_LIMITED: reviews.rateLimited,
	OFFLINE: reviews.offline,
	FAILED: reviews.fallback,
};

export function phrase(code?: string): string {
	return CODES[code ?? ""] ?? reviews.fallback;
}

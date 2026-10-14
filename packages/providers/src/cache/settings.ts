import { integer, literal, setting } from "@adeildo/pi-kit";

import { STRATEGIES, type Strategy } from "./warm.ts";

export const WARM_SECTION = "Prompt cache";

export const strategy = setting<Strategy>({
	id: "cache.strategy",
	default: "learned",
	decoder: literal(...STRATEGIES),
	ui: {
		section: WARM_SECTION,
		label: "Keep it warm",
		description:
			"While the agent waits for you, pi sends the last request again before the cache expires, so your next message reads the prompt instead of writing it. Needs pi's cacheWarming setting on idle.",
		control: {
			type: "choice",
			options: [
				{
					value: "learned",
					label: "learned",
					description:
						"While the chance you come back, learned from your sessions, pays for the refresh. About 23 minutes on Opus 5.5, longer when the agent asked you something",
				},
				{
					value: "pi",
					label: "pi's own",
					description:
						"Pi assumes a 15% chance and refreshes for 30 minutes when that saves 5 cents, so only prompts above about 96k tokens on Opus 5.5",
				},
				{
					value: "minutes",
					label: "fixed time",
					description: "Every refresh for the minutes set below, then none",
				},
				{ value: "off", label: "off", description: "No refresh while you are away" },
			],
		},
	},
});

export const upTo = setting({
	id: "cache.upTo",
	default: 20,
	decoder: integer(5, 120),
	ui: {
		section: WARM_SECTION,
		label: "Fixed time",
		description: "How long 'fixed time' keeps refreshing after the last request.",
		control: { type: "number", min: 5, max: 120, step: 5, unit: " min" },
	},
});

export const CACHE_SETTINGS = [strategy, upTo];

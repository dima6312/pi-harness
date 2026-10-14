// Between runs pi keeps the prompt cache warm by sending the last request again. It assumes a
// fixed 15% chance that you come back before the next refresh, and refreshes only when that saves
// five cents. On Opus 5.5 it skips every prompt under about 96k tokens and refreshes for 30
// minutes. The chance falls the longer you are away, so the learned strategy uses that instead.
import type { Model } from "@earendil-works/pi-ai";
import type {
	CacheWarmingDecisionEvent,
	CacheWarmingDecisionEventResult,
} from "@earendil-works/pi-coding-agent";

import { returnChance, type Returns } from "./returns.ts";

/** The model's prices and cache lifetime, which is all the decision reads from it. */
export type CacheModel = Pick<Model<string>, "cost" | "promptCache">;

export const STRATEGIES = ["learned", "pi", "minutes", "off"] as const;
/** The learned strategy never keeps a cache warm longer than this. */
const MAX_WARM_MINUTES = 120;
export type Strategy = (typeof STRATEGIES)[number];

export interface Away {
	minutes: number;
	/** The run ended on a question to you. */
	asked: boolean;
	/** Minutes between pi's refreshes. */
	window: number;
}

export interface Plan {
	strategy: Strategy;
	upTo: number;
	returns: Returns | undefined;
}

/** Undefined leaves the decision to pi: while the agent works, and when pi has no prices. */
export function warmAction(
	event: Pick<CacheWarmingDecisionEvent, "warmCost" | "missCost" | "continuationProbability">,
	away: Away,
	plan: Plan,
): CacheWarmingDecisionEventResult | undefined {
	if (event.continuationProbability >= 1 || event.missCost <= 0) return undefined;
	switch (plan.strategy) {
		case "pi":
			return undefined;
		case "off":
			return { action: "stop" };
		case "minutes":
			return { action: away.minutes < plan.upTo ? "warm" : "stop" };
		case "learned": {
			const chance = returnChance(plan.returns, away.minutes, away.window, away.asked);
			return { action: chance * event.missCost >= event.warmCost ? "warm" : "stop" };
		}
	}
}

/** Pi refreshes at 90% of the cache's lifetime, keeping at least ten seconds of margin. */
export function refreshWindow(model: CacheModel | undefined): number {
	const retention = process.env.PI_CACHE_RETENTION === "long" ? "long" : "short";
	const seconds = model?.promptCache?.[retention] ?? 300;
	const ms = seconds * 1000;
	return Math.min(ms * 0.9, ms - 10_000) / 60_000;
}

/**
 * How long the learned strategy keeps the cache warm on this model, whatever the prompt's size:
 * a refresh reads the prompt from cache, and a miss writes all of it again.
 */
export function warmFor(model: CacheModel, returns: Returns | undefined, asked: boolean): number {
	const { cacheRead, cacheWrite } = model.cost;
	if (cacheWrite <= cacheRead) return 0;
	const enough = cacheRead / (cacheWrite - cacheRead);
	const window = refreshWindow(model);
	let minutes = window;
	while (minutes < MAX_WARM_MINUTES && returnChance(returns, minutes, window, asked) >= enough)
		minutes += window;
	return minutes;
}

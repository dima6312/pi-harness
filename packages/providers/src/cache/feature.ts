import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { defineFeature, type FeatureScope, formatClock, type ScreenEntry } from "@adeildo/pi-kit";
import type { ExtensionContext, TurnEndEvent } from "@earendil-works/pi-coding-agent";

import { missesOf, missesSummary, missLine } from "./misses.ts";
import {
	endsOnQuestion,
	isReturns,
	LEARN_DAYS,
	learnReturns,
	MEASURED_RUNS,
	type Returns,
	runsIn,
} from "./returns.ts";
import { CACHE_SETTINGS, strategy, upTo, WARM_SECTION } from "./settings.ts";
import { type CacheModel, refreshWindow, warmAction, warmFor } from "./warm.ts";

type AgentMessage = TurnEndEvent["message"];

/** What was learned, and when. Learning reads a month of sessions, so it runs once a day. */
interface Learned extends Returns {
	learnedAt: number;
}

const RELEARN_AFTER = 86_400_000;
/** The newest misses listed under the summary. */
const LATEST_MISSES = 5;

export const cache = defineFeature({
	id: "cache",
	tab: "Providers",
	description:
		"Keeps the prompt cache warm while you are away, for as long as you are likely to come back",
	sections: [WARM_SECTION],
	settings: CACHE_SETTINGS,
	setup(scope) {
		const file = join(dirname(scope.settings.globalPath), "cache-returns.json");
		let learned = readLearned(file);
		let learning = false;
		// Every turn is one request, and pi's refreshes are not turns.
		let lastRequestAt: number | undefined;
		let asked = false;

		scope.onSessionStart((ctx) => {
			lastRequestAt = undefined;
			asked = lastAsked(ctx.sessionManager.getBranch());
			const root = sessionsRoot(ctx);
			if (learning || root === undefined) return;
			if (learned !== undefined && Date.now() - learned.learnedAt < RELEARN_AFTER) return;
			learning = true;
			void relearn(root, file)
				.then((fresh) => {
					learned = fresh;
				})
				.catch((error: unknown) =>
					scope.warn(`learning when you come back failed: ${String(error)}`),
				)
				.finally(() => {
					learning = false;
				});
		});
		scope.on("turn_start", () => {
			lastRequestAt = Date.now();
		});
		scope.on("turn_end", (event) => {
			asked = isAsking(event.message);
		});
		scope.on("cache_warming_decision", (event, ctx) => {
			if (lastRequestAt === undefined) return undefined;
			const away = {
				minutes: (Date.now() - lastRequestAt) / 60_000,
				asked,
				window: refreshWindow(ctx.model),
			};
			return warmAction(event, away, {
				strategy: strategy.get(scope),
				upTo: upTo.get(scope),
				returns: learned,
			});
		});

		registerScreen(scope, () => learned);
	},
});

function registerScreen(scope: FeatureScope, learned: () => Learned | undefined): void {
	scope.screen.info({
		id: "cache.learned",
		section: WARM_SECTION,
		label: "Learned",
		description: `When you came back after a run, over the last ${LEARN_DAYS} days of sessions.`,
		text: (ctx) => learnedText(learned(), ctx.model),
	});
	// Read when the screen opens: a session's misses only change with its requests.
	scope.screen.rows((ctx) => {
		const misses = missesOf(ctx.sessionManager.getBranch());
		const prices = ctx.model?.cost;
		const summary: ScreenEntry = {
			kind: "info",
			id: "cache.misses",
			section: WARM_SECTION,
			label: "Misses",
			description:
				"Requests that wrote the prompt cache again instead of reading it, in this session, and why.",
			text: () => missesSummary(misses, prices),
		};
		const latest = misses.slice(-LATEST_MISSES).toReversed();
		return [
			summary,
			...latest.map((miss, index): ScreenEntry => ({
				kind: "info",
				id: `cache.miss.${index}`,
				section: WARM_SECTION,
				label: formatClock(miss.at),
				description: "A miss, newest first.",
				indent: 1,
				text: () => missLine(miss, prices),
			})),
		];
	});
}

export function learnedText(
	learned: Returns | undefined,
	model: (CacheModel & { id: string }) | undefined,
): string {
	const runs = learned === undefined ? 0 : runsIn(learned);
	const from =
		runs === 0
			? `measured on ${MEASURED_RUNS.toLocaleString("en-US")} runs, until it learns`
			: `from ${runs.toLocaleString("en-US")} runs`;
	if (model === undefined) return from;
	const plain = Math.round(warmFor(model, learned, false));
	const question = Math.round(warmFor(model, learned, true));
	return `${from}. Keeps ${model.id} warm for about ${plain} min, ${question} after a question`;
}

function isAsking(message: AgentMessage): boolean {
	return message.role === "assistant" && endsOnQuestion(message.content);
}

function lastAsked(branch: readonly { type: string; message?: AgentMessage }[]): boolean {
	const last = branch.findLast(
		(entry) => entry.type === "message" && entry.message?.role === "assistant",
	);
	return last?.message !== undefined && isAsking(last.message);
}

/** The folder that holds every project's sessions. Undefined when the session is not saved. */
function sessionsRoot(ctx: ExtensionContext): string | undefined {
	if (ctx.sessionManager.getSessionFile() === undefined) return undefined;
	return dirname(ctx.sessionManager.getSessionDir());
}

async function relearn(root: string, file: string): Promise<Learned> {
	const learnedAt = Date.now();
	const fresh = { ...(await learnReturns(root, learnedAt)), learnedAt };
	await mkdir(dirname(file), { recursive: true });
	await writeFile(file, JSON.stringify(fresh));
	return fresh;
}

function readLearned(file: string): Learned | undefined {
	try {
		const value = JSON.parse(readFileSync(file, "utf8")) as Partial<Learned>;
		const learnedAt = value.learnedAt;
		return typeof learnedAt === "number" && isReturns(value) ? { ...value, learnedAt } : undefined;
	} catch {
		return undefined;
	}
}

import { describe, expect, test } from "bun:test";

import type { SessionEntry } from "@earendil-works/pi-coding-agent";

import { missesOf, missesSummary, missLine } from "../src/cache/misses.ts";

const START = Date.UTC(2026, 9, 14, 12);
const PRICES = { cacheRead: 0.2, cacheWrite: 5 };

/** An answer at `minute` that read `read` tokens from the cache and wrote `written` again. */
function answer(
	minute: number,
	read: number,
	written: number,
	model = "claude-opus-5-5",
): SessionEntry {
	return {
		type: "message",
		id: `a${minute}`,
		parentId: null,
		timestamp: new Date(START + minute * 60_000).toISOString(),
		message: {
			role: "assistant",
			content: [],
			api: "anthropic-messages",
			provider: "anthropic",
			model,
			usage: {
				input: 2,
				output: 10,
				cacheRead: read,
				cacheWrite: written,
				totalTokens: read + written,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "stop",
			timestamp: START + minute * 60_000,
		},
	} as SessionEntry;
}

function warmed(minute: number): SessionEntry {
	return {
		type: "usage",
		id: `w${minute}`,
		parentId: null,
		timestamp: new Date(START + minute * 60_000).toISOString(),
		kind: "cache_warm",
	} as SessionEntry;
}

function other(type: string, extra: Record<string, unknown> = {}): SessionEntry {
	return {
		type,
		id: type,
		parentId: null,
		timestamp: new Date(START).toISOString(),
		...extra,
	} as SessionEntry;
}

describe("why a request wrote the cache again", () => {
	test("a turn that only wrote its tail is no miss, and the first request is one", () => {
		const misses = missesOf([answer(0, 0, 200_000), answer(1, 200_000, 3_000)]);
		expect(misses.map((miss) => miss.cause)).toEqual(["first request"]);
	});

	test("a pause past the cache's life, unless a warming refresh kept it alive", () => {
		expect(missesOf([answer(0, 0, 1_000), answer(9, 0, 200_000)]).map((m) => m.cause)).toEqual([
			"pause",
		]);
		const kept = missesOf([answer(0, 0, 1_000), warmed(4), warmed(8), answer(9, 0, 200_000)]);
		expect(kept.map((miss) => miss.cause)).toEqual(["other"]);
	});

	test("a context that shrank is a clear; a prune, a compaction or a new model say so", () => {
		const cause = (between: SessionEntry[], next = answer(1, 13_000, 150_000)) =>
			missesOf([answer(0, 0, 1_000), ...between, next]).map((miss) => miss.cause);
		expect(cause([], answer(1, 13_000, 150_000))).toEqual(["other"]);
		expect(missesOf([answer(0, 200_000, 1_000), answer(1, 13_000, 150_000)])[0]?.cause).toBe(
			"server clear",
		);
		expect(cause([other("context_edit")])).toEqual(["prune"]);
		expect(cause([other("compaction")])).toEqual(["compaction"]);
		expect(cause([], answer(1, 0, 150_000, "claude-sonnet-4-6"))).toEqual(["model changed"]);
		const system = other("message", { message: { role: "system", content: "" } });
		expect(cause([system])).toEqual(["prompt changed"]);
	});

	test("the session's line names the causes biggest first, and each miss what shows its cause", () => {
		const misses = missesOf([
			answer(0, 0, 40_000),
			answer(9, 0, 300_000),
			answer(10, 200_000, 1_000),
		]);
		expect(missesSummary(misses, PRICES)).toBe(
			"2 misses wrote 340k tokens again, $1.632 over reading them: 1 pause, 1 first request",
		);
		expect(missLine(misses[1]!, PRICES)).toBe("pause: 300k written again, $1.440 after 9 min away");
		expect(missesSummary([], PRICES)).toBe(
			"none yet: every request read what the one before wrote",
		);
	});
});

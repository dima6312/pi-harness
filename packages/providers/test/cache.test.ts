import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createApp } from "@adeildo/pi-kit";
import { fakeContext, fakePi } from "@adeildo/pi-kit/testing";

import { cache, learnedText } from "../src/cache/feature.ts";
import {
	addWait,
	emptyReturns,
	learnReturns,
	returnChance,
	type Returns,
	waitsIn,
} from "../src/cache/returns.ts";
import { refreshWindow, warmAction, warmFor } from "../src/cache/warm.ts";

const MINUTE = 60_000;
const OPUS = {
	id: "claude-opus-5-5",
	cost: { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
	promptCache: { short: 300, long: 3600 },
};
const SONNET = {
	...OPUS,
	id: "claude-sonnet-4-6",
	cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
};
// Opus 5.5 on a 100k prompt: a refresh reads it at $0.20/MTok, a miss writes it again at $5.
const IDLE = { warmCost: 0.02, missCost: 0.48, continuationProbability: 0.15 };

/** For each pair, `runs` runs that came back after `minutes`. */
function returnsOf(
	waits: readonly (readonly [minutes: number, runs: number])[],
	asked = false,
): Returns {
	const returns = emptyReturns();
	for (const [minutes, runs] of waits)
		for (let run = 0; run < runs; run++) addWait(returns, { minutes, asked });
	return returns;
}

function assistant(timestamp: number, text: string, tool = false): string {
	const content = [
		{ type: "text", text },
		...(tool ? [{ type: "toolCall", id: "c", name: "bash", arguments: {} }] : []),
	];
	return JSON.stringify({
		type: "message",
		message: { role: "assistant", timestamp, content, usage: { input: 1 } },
	});
}

describe("when you come back", () => {
	test("a run's wait lasts from its end to the next request", () => {
		const file = [
			assistant(0, "reading", true),
			assistant(MINUTE, "done."),
			JSON.stringify({ type: "message", message: { role: "user", content: "next" } }),
			assistant(7 * MINUTE, "which one?"),
		].join("\n");
		expect(waitsIn(file, 0)).toEqual([
			{ minutes: 6, asked: false },
			{ minutes: Infinity, asked: true },
		]);
	});

	test("runs older than the month learned are left out", () => {
		const file = [assistant(0, "old."), assistant(10 * MINUTE, "new.")].join("\n");
		expect(waitsIn(file, 5 * MINUTE)).toEqual([{ minutes: Infinity, asked: false }]);
	});

	test("the chance counts the runs that came back among those still away", () => {
		// 100 away at 5 minutes, 40 of them back before 9.5.
		const returns = returnsOf([
			[2, 50],
			[7, 40],
			[30, 60],
		]);
		expect(returnChance(returns, 5, 4.5, false)).toBe(0.4);
	});

	test("too few runs away at a time fall back to all runs, then to the measured table", () => {
		const fewAsked = returnsOf([[7, 10]], true);
		const many = returnsOf([
			[7, 50],
			[30, 50],
		]);
		const both: Returns = { asked: fewAsked.asked, other: many.other };
		expect(returnChance(both, 5, 4.5, true)).toBeCloseTo(60 / 110);
		expect(returnChance(undefined, 5, 4.5, false)).toBe(0.28);
		expect(returnChance(undefined, 40, 4.5, false)).toBe(0.015);
	});

	test("a month of sessions is read from every project's folder", async () => {
		const root = mkdtempSync(join(tmpdir(), "pi-cache-"));
		try {
			const now = Date.now();
			mkdirSync(join(root, "a"));
			writeFileSync(
				join(root, "a", "s.jsonl"),
				[assistant(now - 10 * MINUTE, "ok."), assistant(now, "x", true)].join("\n"),
			);
			mkdirSync(join(root, "b"));
			writeFileSync(join(root, "b", "notes.txt"), assistant(now, "skipped."));
			const learned = await learnReturns(root, now);
			expect(learned.other[20]).toBe(1);
			expect(learned.other.reduce((total, count) => total + count, 0)).toBe(1);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});

const LEARNED = { strategy: "learned" as const, upTo: 20, returns: undefined };

function away(minutes: number) {
	return { minutes, asked: false, window: 4.5 };
}

async function eventually(path: string, tries = 50): Promise<void> {
	if (existsSync(path) || tries === 0) return;
	await Bun.sleep(10);
	return eventually(path, tries - 1);
}

describe("whether a refresh goes out", () => {
	const plan = LEARNED;

	test("learned refreshes while the chance of coming back pays for it", () => {
		expect(warmAction(IDLE, away(18), plan)).toEqual({ action: "warm" });
		expect(warmAction(IDLE, away(22.5), plan)).toEqual({ action: "stop" });
	});

	test("a question to you keeps it warm longer, when your sessions show it", () => {
		const returns: Returns = {
			asked: returnsOf([
				[25, 10],
				[60, 90],
			]).other,
			other: returnsOf([[60, 100]]).other,
		};
		const learned = { ...plan, returns };
		expect(warmAction(IDLE, { ...away(22.5), asked: true }, learned)).toEqual({ action: "warm" });
		expect(warmAction(IDLE, away(22.5), learned)).toEqual({ action: "stop" });
	});

	test("the other strategies", () => {
		expect(warmAction(IDLE, away(4.5), { ...plan, strategy: "pi" })).toBeUndefined();
		expect(warmAction(IDLE, away(4.5), { ...plan, strategy: "off" })).toEqual({ action: "stop" });
		expect(warmAction(IDLE, away(19), { ...plan, strategy: "minutes" })).toEqual({
			action: "warm",
		});
		expect(warmAction(IDLE, away(20), { ...plan, strategy: "minutes" })).toEqual({
			action: "stop",
		});
	});

	test("leaves pi alone while the agent works, and when pi has no prices", () => {
		expect(warmAction({ ...IDLE, continuationProbability: 1 }, away(60), plan)).toBeUndefined();
		expect(warmAction({ ...IDLE, missCost: 0, warmCost: 0 }, away(4.5), plan)).toBeUndefined();
	});

	test("pi refreshes at 90% of the cache's lifetime", () => {
		expect(refreshWindow(OPUS)).toBe(4.5);
		process.env.PI_CACHE_RETENTION = "long";
		try {
			expect(refreshWindow(OPUS)).toBe(54);
		} finally {
			delete process.env.PI_CACHE_RETENTION;
		}
	});

	test("how long it stays warm depends on the model's cache prices, not the prompt", () => {
		expect(warmFor(OPUS, undefined, false)).toBe(22.5);
		expect(warmFor(SONNET, undefined, false)).toBe(13.5);
		expect(learnedText(undefined, OPUS)).toBe(
			"measured on 1,688 runs, until it learns. Keeps claude-opus-5-5 warm for about 23 min, 23 after a question",
		);
	});
});

describe("the feature", () => {
	let dir: string;
	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "pi-cache-feature-"));
	});
	afterEach(() => rmSync(dir, { recursive: true, force: true }));

	async function decide(
		minutesAway: number,
		settings: Record<string, unknown> = {},
		last = "done.",
	) {
		writeFileSync(join(dir, "settings.json"), JSON.stringify({ cache: settings }));
		const fake = fakePi();
		createApp(fake.pi, { name: "test", settingsPath: join(dir, "settings.json") })
			.use(cache)
			.build();
		const ctx = fakeContext([], true, {
			model: OPUS,
			sessionManager: { getBranch: () => [], getSessionFile: () => undefined },
		});
		await fake.fire("session_start", {}, ctx);
		const now = Date.now();
		const clock = spyOn(Date, "now").mockReturnValue(now);
		try {
			await fake.fire("turn_start", {}, ctx);
			const message = { role: "assistant", content: [{ type: "text", text: last }] };
			await fake.fire("turn_end", { message }, ctx);
			clock.mockReturnValue(now + minutesAway * MINUTE);
			const [answer] = await fake.fire("cache_warming_decision", { ...IDLE, action: "stop" }, ctx);
			return answer;
		} finally {
			clock.mockRestore();
		}
	}

	test("decides pi's refreshes from how long you have been away", async () => {
		expect(await decide(4.5)).toEqual({ action: "warm" });
		expect(await decide(22.5)).toEqual({ action: "stop" });
	});

	test("follows the strategy picked", async () => {
		expect(await decide(4.5, { strategy: "pi" })).toBeUndefined();
		expect(await decide(30, { strategy: "minutes", upTo: 40 })).toEqual({ action: "warm" });
	});

	test("reads what was learned from the file next to the settings", async () => {
		const returns = returnsOf([
			[25, 50],
			[60, 50],
		]);
		writeFileSync(
			join(dir, "cache-returns.json"),
			JSON.stringify({ ...returns, learnedAt: Date.now() }),
		);
		expect(await decide(22.5)).toEqual({ action: "warm" });
	});

	test("learns from the sessions once a day, in the background", async () => {
		const root = join(dir, "sessions");
		mkdirSync(join(root, "project"), { recursive: true });
		const now = Date.now();
		writeFileSync(
			join(root, "project", "s.jsonl"),
			[assistant(now - 10 * MINUTE, "ok."), assistant(now, "x", true)].join("\n"),
		);
		const fake = fakePi();
		createApp(fake.pi, { name: "test", settingsPath: join(dir, "settings.json") })
			.use(cache)
			.build();
		const ctx = fakeContext([], true, {
			sessionManager: {
				getBranch: () => [],
				getSessionFile: () => join(root, "project", "s.jsonl"),
				getSessionDir: () => join(root, "project"),
			},
		});
		await fake.fire("session_start", {}, ctx);
		const file = join(dir, "cache-returns.json");
		await eventually(file);
		const learned = JSON.parse(readFileSync(file, "utf8")) as Returns;
		expect(learned.other[20]).toBe(1);
	});
});

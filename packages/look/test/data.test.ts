import { describe, expect, test } from "bun:test";

import { TASKS_ENTRY, TASKS_USAGE_ENTRY } from "@adeildo/pi-kit";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";

import { readGit } from "../src/data/git.ts";
import { emptyGit, parseStatus } from "../src/data/git.ts";
import { Telemetry } from "../src/data/telemetry.ts";
import {
	averagesOf,
	cacheHitPercent,
	REQUEST_ENTRY,
	totalsOf,
	type Totals,
} from "../src/data/totals.ts";

function usage(values: Partial<Totals> = {}) {
	const { cost = 0, ...tokens } = values;
	return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, ...tokens, cost: { total: cost } };
}

function clock() {
	let now = 1_000;
	return {
		now: () => now,
		advance: (ms: number) => {
			now += ms;
		},
	};
}

describe("telemetry", () => {
	test("measures both directions: prefill over the wait, decode over the writing", () => {
		const time = clock();
		const telemetry = new Telemetry(time.now);
		telemetry.runStarted();
		telemetry.requestStarted();
		telemetry.answerStarted();

		time.advance(2_000);
		expect(telemetry.request()?.waiting).toBe(true);
		expect(telemetry.request()?.elapsedMs).toBe(2_000);

		telemetry.answerGrew("Hello", usage({ input: 100, cacheRead: 99_900 }), "writing");
		time.advance(4_000);
		const record = telemetry.answerEnded(usage({ input: 100, cacheRead: 99_900, output: 800 }));

		expect(record).toEqual({
			output: 800,
			prompt: 100_000,
			firstTokenMs: 2_000,
			generationMs: 4_000,
		});
		const view = telemetry.request();
		expect(view?.streaming).toBe(false);
		expect(view?.prefill).toBe(50_000);
		expect(view?.decode).toBe(200);
		expect(view?.estimated).toBe(false);
	});

	test("estimates the live decode speed until the provider counts the tokens", () => {
		const time = clock();
		const telemetry = new Telemetry(time.now);
		telemetry.requestStarted();
		time.advance(500);
		telemetry.answerGrew("x".repeat(40), usage(), "writing");
		time.advance(1_000);
		telemetry.answerGrew("y".repeat(360), usage(), "writing");

		const view = telemetry.request();
		expect(view?.estimated).toBe(true);
		// 400 characters over the ratio measured on real answers (2.9), not a flat 4.
		expect(view?.usage.output).toBe(138);
		expect(view?.decode).toBe(138);
	});

	test("the estimate uses the ratio this session measured", () => {
		const time = clock();
		const telemetry = new Telemetry(time.now);
		telemetry.requestStarted();
		telemetry.answerGrew("a".repeat(200), usage({ output: 100 }), "writing");
		telemetry.answerEnded(usage({ output: 100 }));

		// Two characters per token, from that answer: 400 characters is 200 tokens.
		telemetry.requestStarted();
		time.advance(500);
		telemetry.answerGrew("b".repeat(400), usage(), "writing");
		time.advance(1_000);
		expect(telemetry.request()?.usage.output).toBe(200);
	});

	test("waits for a real sample before it shows a live speed", () => {
		const time = clock();
		const telemetry = new Telemetry(time.now);
		telemetry.requestStarted();
		telemetry.answerGrew("x", usage(), "writing");
		time.advance(100);
		expect(telemetry.request()?.decode).toBeUndefined();
	});

	test("the wait starts when the request leaves, not when the turn does", () => {
		const time = clock();
		const telemetry = new Telemetry(time.now);
		telemetry.runStarted();
		telemetry.requestStarted();
		time.advance(100);
		telemetry.providerRequestSent();
		time.advance(400);
		telemetry.providerResponseArrived();
		time.advance(300);
		telemetry.answerGrew("hi", usage({ input: 1_000 }), "writing");
		time.advance(1_000);

		const record = telemetry.answerEnded(usage({ input: 1_000, output: 50 }));
		// 400ms to the headers plus 300ms to the first token: the 100ms of building the request is out.
		expect(record?.firstTokenMs).toBe(700);
		expect(telemetry.request()?.serverMs).toBe(400);
		expect(telemetry.request()?.prefillMs).toBe(300);
	});

	test("a call that left before pi opened its message still has its marks", () => {
		const time = clock();
		const telemetry = new Telemetry(time.now);
		telemetry.runStarted();
		telemetry.requestStarted();
		telemetry.answerGrew("x", usage(), "writing");
		telemetry.answerEnded(usage({ output: 1 }));

		time.advance(5_000);
		telemetry.providerRequestSent();
		time.advance(200);
		telemetry.providerResponseArrived();
		time.advance(300);
		telemetry.answerStarted();
		telemetry.answerGrew("y", usage(), "writing");

		expect(telemetry.request()?.waitMs).toBe(500);
		expect(telemetry.request()?.serverMs).toBe(200);
		expect(telemetry.request()?.prefillMs).toBe(300);
	});

	test("tells the time it thought from the time it waited", () => {
		const time = clock();
		const telemetry = new Telemetry(time.now);
		telemetry.requestStarted();
		telemetry.providerRequestSent();
		time.advance(200);
		telemetry.answerGrew("th", usage(), "thinking");
		time.advance(900);
		telemetry.answerGrew("hi", usage(), "writing");

		expect(telemetry.request()?.waitMs).toBe(200);
		expect(telemetry.request()?.thoughtMs).toBe(900);
	});

	test("an answer that wrote without thinking has no thought time", () => {
		const time = clock();
		const telemetry = new Telemetry(time.now);
		telemetry.requestStarted();
		telemetry.providerRequestSent();
		time.advance(200);
		telemetry.answerGrew("hi", usage(), "writing");
		expect(telemetry.request()?.thoughtMs).toBeUndefined();
	});

	test("counts the requests of a run and freezes its time when it ends", () => {
		const time = clock();
		const telemetry = new Telemetry(time.now);
		telemetry.runStarted();
		telemetry.requestStarted();
		telemetry.requestStarted();
		time.advance(3_000);
		telemetry.runEnded();
		time.advance(60_000);
		expect(telemetry.run()).toEqual({ running: false, elapsedMs: 3_000, requests: 2, cost: 0 });
	});

	test("adds up what the run's answers cost", () => {
		const telemetry = new Telemetry(clock().now);
		telemetry.requestStarted();
		telemetry.answerGrew("a", usage({ output: 1 }), "writing");
		telemetry.answerEnded(usage({ output: 10, cost: 0.12 }));
		telemetry.requestStarted();
		telemetry.answerGrew("b", usage({ output: 1 }), "writing");
		telemetry.answerEnded(usage({ output: 10, cost: 0.19 }));
		expect(telemetry.run()?.cost).toBeCloseTo(0.31);
	});

	test("an answer that never wrote anything leaves no record", () => {
		const telemetry = new Telemetry(clock().now);
		telemetry.requestStarted();
		expect(telemetry.answerEnded(usage({ input: 10 }))).toBeUndefined();
	});
});

describe("git", () => {
	test("reads the distance, the changes and the stash from one status call", () => {
		const output = [
			"# branch.oid 1234",
			"# branch.head main",
			"# branch.upstream origin/main",
			"# branch.ab +2 -22",
			"# stash 1",
			"1 M. N... 100644 100644 100644 aaa bbb staged.ts",
			"1 .M N... 100644 100644 100644 aaa bbb changed.ts",
			"1 MM N... 100644 100644 100644 aaa bbb both.ts",
			"2 R. N... 100644 100644 100644 aaa bbb R100 new.ts\told.ts",
			"u UU N... 100644 100644 100644 100644 aaa bbb ccc conflict.ts",
			"? new-file.ts",
			"? other.ts",
			"",
		].join("\n");

		expect(parseStatus(output)).toEqual({
			ahead: 2,
			behind: 22,
			staged: 3,
			modified: 2,
			untracked: 2,
			conflicted: 1,
			stashed: 1,
		});
	});

	test("a clean tree", () => {
		expect(parseStatus("# branch.head main\n")).toEqual(emptyGit());
	});
});

function assistant(values: Partial<Totals>): SessionEntry {
	return { type: "message", message: { role: "assistant", usage: usage(values) } } as SessionEntry;
}

function custom(customType: string, data: unknown): SessionEntry {
	return { type: "custom", customType, data } as SessionEntry;
}

describe("totals", () => {
	test("adds up the branch", () => {
		const entries = [
			assistant({ input: 10, output: 5, cacheRead: 90, cost: 0.1 }),
			assistant({ input: 20, output: 15, cacheWrite: 30, cost: 0.2 }),
		];
		expect(totalsOf(entries)).toEqual({
			input: 30,
			output: 20,
			cacheRead: 90,
			cacheWrite: 30,
			cost: 0.30000000000000004,
		});
		expect(cacheHitPercent(entries)).toBe(0);
		expect(cacheHitPercent(entries.slice(0, 1))).toBe(90);
	});

	test("the tasks' model calls count in the session's cost", () => {
		const entries = [
			assistant({ input: 10, output: 5, cost: 0.1 }),
			custom(TASKS_ENTRY, { usage: { input: 100, output: 20, cost: 0.002 } }),
			custom(TASKS_USAGE_ENTRY, { usage: { input: 80, output: 10, cost: 0.001 } }),
		];
		const totals = totalsOf(entries);
		expect(totals).toMatchObject({ input: 190, output: 35 });
		expect(totals.cost).toBeCloseTo(0.103);
	});

	test("averages both speeds, and reads the records this package wrote under its old name", () => {
		const entries = [
			custom(REQUEST_ENTRY, {
				output: 300,
				prompt: 60_000,
				firstTokenMs: 2_000,
				generationMs: 1_000,
			}),
			custom(REQUEST_ENTRY, {
				output: 100,
				prompt: 40_000,
				firstTokenMs: 2_000,
				generationMs: 1_000,
			}),
			custom("pi-statusline:turn", { output: 200, firstTokenMs: 500, generationMs: 2_000 }),
			custom("someone-else", { output: 1e9, firstTokenMs: 1, generationMs: 1 }),
		];
		expect(averagesOf(entries)).toEqual({ decode: 150, prefill: 25_000 });
	});

	test("no records, no speeds", () => {
		expect(averagesOf([])).toEqual({ decode: undefined, prefill: undefined });
	});
});

describe("the git state, read through a runner", () => {
	test("parses what the command answers", async () => {
		const state = await readGit("/repo", async () => "# branch.ab +2 -1\n1 M. N... a.ts\n");
		expect(state).toEqual({ ...emptyGit(), ahead: 2, behind: 1, staged: 1 });
	});

	test("a command that fails is a card with no git line, not a crash", async () => {
		const failing = async (): Promise<string> => {
			throw new Error("not a repository");
		};
		expect(await readGit("/repo", failing)).toBeUndefined();
	});
});

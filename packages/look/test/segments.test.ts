import { describe, expect, test } from "bun:test";

import { applyTaskOps, emptyTasks } from "@adeildo/pi-kit";
import { stripTerminalSequences as plainText } from "@earendil-works/pi-tui";

import { emptyTotals } from "../src/data/totals.ts";
import { ASCII, NERD } from "../src/render/glyphs.ts";
import { PLAIN, type Paint } from "../src/render/paint.ts";
import {
	claimedStatuses,
	isSegmentId,
	renderSegments,
	SEGMENT_IDS,
	type SegmentId,
} from "../src/render/segments.ts";
import { snapshot } from "./helpers.ts";

const options = { pathLength: 40, gaugeCells: 8, claimed: new Set<string>(), labels: false };

function render(
	ids: SegmentId[],
	data = snapshot(),
	extra: Partial<typeof options> = {},
	paint: Paint = PLAIN,
) {
	return renderSegments(ids, {
		snapshot: data,
		glyphs: ASCII,
		paint,
		options: { ...options, ...extra },
	});
}

function text(ids: SegmentId[], data = snapshot(), extra: Partial<typeof options> = {}) {
	return render(ids, data, extra).map((piece) => piece.text);
}

const YOU = { at: 1, origin: "you" } as const;
const AGENT = { at: 2, origin: "agent" } as const;

describe("segments", () => {
	test("the tasks show what the agent is doing, with what waits, what is queued and what is done", () => {
		let tasks = applyTaskOps(
			emptyTasks(),
			[
				{ op: "title", text: "ship tasks" },
				{ op: "ask", text: "write the contract" },
			],
			YOU,
		);
		tasks = applyTaskOps(tasks, [{ op: "done", id: "t1" }], AGENT);
		tasks = applyTaskOps(
			tasks,
			[
				{ op: "ask", text: "draw the segment" },
				{ op: "ask", text: "compaction" },
				{ op: "ask", text: "push" },
			],
			YOU,
		);
		tasks = applyTaskOps(tasks, [{ op: "wait", id: "t4", on: "you", why: "asks first" }], AGENT);
		const [piece] = render(["tasks"], snapshot({ tasks }));
		expect(piece?.text).toBe("> draw the segment  1 waiting  1 queued  1 done");
		expect(plainText(piece?.shrink?.(38) ?? "")).toBe("> draw...  1 waiting  1 queued  1 done");
		expect(claimedStatuses([["tasks"]])).toContain("pi-tasks");

		const [icons] = renderSegments(["tasks"], {
			snapshot: snapshot({ tasks }),
			glyphs: NERD,
			paint: PLAIN,
			options,
		});
		expect(icons?.text).toBe("\u{f04fe} draw the segment  \u{f024} 1  \u{f051f} 1  \u{f00c} 1");
	});

	test("the peers show each agent by name, and the line tightens one name at a time", () => {
		const peers = [
			{ handle: "oauth", color: "syntaxFunction", state: "waiting" as const },
			{ handle: "migration", color: "syntaxString", state: "idle" as const },
		];
		const [piece] = render(["peers"], snapshot({ peers, peersUnread: 2 }));
		expect(plainText(piece?.text ?? "")).toBe("@ oauth  @ migration  @2");
		expect(plainText(piece?.shrink?.(22) ?? "")).toBe("@ oauth +1  @2");
		expect(plainText(piece?.shrink?.(6) ?? "")).toBe("@  @2");
		expect(claimedStatuses([["peers"]])).toContain("pi-peers");
		expect(text(["peers"], snapshot())).toEqual([]);
	});

	test("with several tasks under way, the first shows and the rest count", () => {
		let tasks = applyTaskOps(emptyTasks(), [{ op: "ask", text: "a" }], YOU);
		tasks = applyTaskOps(tasks, [{ op: "ask", text: "b" }], { ...YOU, busy: true });
		tasks = applyTaskOps(tasks, [{ op: "progress", id: "t2" }], AGENT);
		expect(text(["tasks"], snapshot({ tasks }))).toEqual(["> a +1"]);
	});

	test("with nothing under way, the tasks show the session, and nothing without one", () => {
		const titled = applyTaskOps(emptyTasks(), [{ op: "title", text: "ship tasks" }], YOU);
		expect(text(["tasks"], snapshot({ tasks: titled }))).toEqual(["> ship tasks"]);
		expect(text(["tasks"], snapshot({ tasks: emptyTasks() }))).toEqual([]);

		let between = applyTaskOps(emptyTasks(), [{ op: "ask", text: "a" }], YOU);
		between = applyTaskOps(between, [{ op: "ask", text: "b" }], { ...YOU, busy: true });
		between = applyTaskOps(between, [{ op: "done", id: "t1" }], AGENT);
		expect(text(["tasks"], snapshot({ tasks: between }), { labels: true })).toEqual([
			"> idle  1 queued  1 done",
		]);
		expect(text(["tasks"])).toEqual([]);
	});

	test("the model comes after its provider, and the short form keeps only the name", () => {
		const [piece] = render(["model"]);
		expect(piece?.text).toBe("Anthropic/Opus 5.5");
		expect(piece?.compact).toBe("Opus 5.5");
	});

	test("the model carries the account it runs on", () => {
		const [piece] = render(
			["model"],
			snapshot({ account: { provider: "anthropic", label: "ranqia", windows: [] } }),
		);
		expect(piece?.text).toBe("Anthropic(ranqia)/Opus 5.5");
		expect(piece?.compact).toBe("Opus 5.5 (ranqia)");
	});

	test("the quota lists every window and its reset", () => {
		const [piece] = render(
			["quota"],
			snapshot({
				account: {
					provider: "anthropic",
					label: "ranqia",
					windows: [
						{ name: "5h", used: 100, resetsIn: "11m" },
						{ name: "week", used: 12, resetsIn: "3d" },
					],
				},
			}),
		);
		expect(piece?.text).toBe("5h 100% resets in 11m  week 12% resets in 3d");
	});

	test("an account that needs a sign-in says so in the quota", () => {
		const [piece] = render(
			["quota"],
			snapshot({
				account: { provider: "anthropic", label: "work", windows: [], needsLogin: true },
			}),
		);
		expect(piece?.text).toBe("sign in again");
	});

	test("the effort is a meter of six levels, filled up to the one in use", () => {
		expect(text(["effort"])).toEqual(["|||||| high"]);
		const painted = renderSegments(["effort"], {
			snapshot: snapshot({ thinking: "medium" }),
			glyphs: NERD,
			paint: { ...PLAIN, effort: (level, bar) => `<${level}>${bar}`, dim: (bar) => `.${bar}` },
			options,
		});
		expect(painted[0]?.text).toBe("<minimal>▂<low>▃<medium>▄.▅.▆.▇ <medium>medium");
	});

	test("a model that does not reason has no effort to show", () => {
		const data = snapshot({ model: { name: "Flash", provider: "Google", reasoning: false } });
		expect(text(["effort"], data)).toEqual([]);
	});

	test("the branch carries its distance and what changed", () => {
		const data = snapshot({
			git: {
				ahead: 1,
				behind: 22,
				staged: 2,
				modified: 3,
				untracked: 1,
				conflicted: 0,
				stashed: 0,
			},
		});
		const [piece] = render(["branch"], data);
		expect(piece?.text).toBe("main ^1 v22 +2 ~3 ?1");
		expect(piece?.compact).toBe("main*");
	});

	test("the context shows the gauge, and its short form only the percentage", () => {
		const [piece] = render(["context"]);
		expect(piece?.text).toBe("ctx 43% ###----- 431k/1M");
		expect(piece?.compact).toBe("ctx 43%");
		expect(text(["context"], snapshot(), { gaugeCells: 0 })).toEqual(["ctx 43% 431k/1M"]);
	});

	test("speed shows received and sent, marking an estimate", () => {
		const data = snapshot({
			request: {
				streaming: true,
				waiting: false,
				elapsedMs: 4_000,
				waitMs: 1_700,
				waitingMs: 1_700,
				serverMs: 400,
				prefillMs: 1_300,
				thoughtMs: 600,
				decode: 906,
				prefill: 48_000,
				usage: { input: 2, output: 230, cacheRead: 80_000, cacheWrite: 1_300, cost: 0.027 },
				estimated: true,
			},
		});
		expect(text(["speed", "wait", "request", "costRate"], data)).toEqual([
			"v 906 ^ 48k tok/s",
			"ttft  1.7s",
			"^ 81k (R 80k W1.3k) v 230",
			"$0.33 per Mtok",
		]);
	});

	test("the wait counts up while the first token has not arrived", () => {
		const data = snapshot({
			request: {
				streaming: true,
				waiting: true,
				elapsedMs: 3_400,
				waitMs: undefined,
				waitingMs: 3_400,
				serverMs: undefined,
				prefillMs: undefined,
				thoughtMs: undefined,
				decode: undefined,
				prefill: undefined,
				usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 },
				estimated: true,
			},
		});
		expect(text(["speed", "wait"], data)).toEqual(["v   – ^   – tok/s", "ttft  3.4s"]);
	});

	test("the run is a stopwatch, which keeps its shape as it counts", () => {
		const run = (elapsedMs: number, requests: number) =>
			text(["elapsed"], snapshot({ run: { running: true, elapsedMs, requests } }));
		expect(run(12_300, 3)).toEqual(["0:12 ×3"]);
		expect(run(3_725_000, 1)).toEqual(["1:02:05"]);
	});

	test("a session with nothing yet leaves the cost and the tokens out", () => {
		const data = snapshot({ totals: emptyTotals(), subscription: true });
		expect(text(["cost", "tokens"], data)).toEqual([]);
	});

	test("session speeds, cost and cache", () => {
		const data = snapshot({
			averages: { decode: 290, prefill: 31_000 },
			cacheHit: 98.4,
			subscription: true,
		});
		expect(text(["average", "cost", "cache", "tokens"], data)).toEqual([
			"avg v290 ^31k tok/s",
			"$0.139 sub",
			"R 98%",
			// Sent is the whole prompt, cache included: 2.4k fresh plus 83k read.
			"^85k v347",
		]);
	});

	test("a status placed on its own leaves the shared list", () => {
		const statuses = new Map([
			["pi-ask-permission:mode", "⏵⏵ auto · anywhere"],
			["pi-memory", "mem 12"],
		]);
		const data = snapshot({ statuses });
		const claimed = claimedStatuses([["status:pi-ask-permission:mode", "model"], ["statuses"]]);
		expect([...claimed]).toEqual(["pi-ask-permission:mode", "pi-providers:account"]);
		expect(text(["status:pi-ask-permission:mode"], data, { claimed })).toEqual([
			"⏵⏵ auto · anywhere",
		]);
		expect(text(["statuses"], data, { claimed })).toEqual([">> mem 12"]);
		expect(text(["status:missing"], data)).toEqual([]);
	});

	test("the model segment claims the status the providers package also reports", () => {
		expect(claimedStatuses([["model"]])).toContain("pi-providers:account");
	});

	test("ids are the built-in ones or a status key", () => {
		expect(isSegmentId("model")).toBe(true);
		expect(isSegmentId("status:pi-ask-permission:mode")).toBe(true);
		expect(isSegmentId("status:")).toBe(false);
		expect(isSegmentId("nope")).toBe(false);
	});

	test("every segment renders against an empty session without throwing", () => {
		const empty = snapshot({ model: undefined, context: undefined, branch: null, cwd: "" });
		expect(() => render([...SEGMENT_IDS], empty)).not.toThrow();
	});
});

const request = (decode: number | undefined, waitMs: number | undefined, output: number) =>
	snapshot({
		request: {
			streaming: true,
			waiting: waitMs === undefined,
			elapsedMs: 900,
			waitMs,
			waitingMs: 900,
			serverMs: undefined,
			prefillMs: undefined,
			thoughtMs: undefined,
			decode,
			prefill: waitMs === undefined ? undefined : 48_000,
			usage: { input: 2, output, cacheRead: 80_000, cacheWrite: 0, cost: 0 },
			estimated: false,
		},
		run: { running: true, elapsedMs: 9_000, requests: 1 },
	});

describe("stable widths", () => {
	test("the strip keeps its width while the numbers tick", () => {
		const ids: SegmentId[] = ["speed", "wait", "elapsed", "request"];
		const width = (data = snapshot()) => render(ids, data).map((piece) => piece.text.length);
		const waiting = width(request(undefined, undefined, 0));
		expect(width(request(9.8, 1_700, 12))).toEqual(waiting);
		expect(width(request(114, 1_700, 699))).toEqual(waiting);
		expect(width(request(2_800, 1_700, 1_200))).toEqual(waiting);
	});

	test("what is not known yet shows as a dash, so nothing appears in the middle later", () => {
		expect(text(["speed", "wait"], request(undefined, undefined, 0))).toEqual([
			"v   – ^   – tok/s",
			"ttft 900ms",
		]);
	});
});

describe("labels", () => {
	test("say what each number is, after it, the way it reads", () => {
		const last = {
			streaming: false,
			waiting: false,
			elapsedMs: 8_000,
			waitMs: 1_400,
			waitingMs: 1_400,
			serverMs: 300,
			prefillMs: 1_100,
			thoughtMs: 900,
			decode: 31,
			prefill: 59_000,
			usage: { input: 1_200, output: 230, cacheRead: 80_000, cacheWrite: 1_300, cost: 0.06 },
			estimated: false,
		};
		const data = snapshot({
			last,
			run: { running: false, elapsedMs: 8_000, requests: 2 },
			cacheHit: 97,
		});
		expect(text(["elapsed", "last", "tokens", "cache", "context"], data, { labels: true })).toEqual(
			[
				"0:08  2 calls",
				"last call 1.4s wait  900ms thought  v31 tok/s",
				"^85k in v347 out",
				"R 97% cached",
				"ctx 43% ###----- 431k/1M",
			],
		);
	});

	test("a cache that was only just written is new, not a miss", () => {
		expect(
			text(["cache"], snapshot({ cacheHit: 0, cacheWarming: true }), { labels: true }),
		).toEqual(["R cache new"]);
	});

	test("no call has finished yet, nothing to say about the last one", () => {
		expect(text(["last"], snapshot())).toEqual([]);
	});
});

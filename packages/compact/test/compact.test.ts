import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	applyTaskOps,
	createApp,
	emptyTasks,
	type SessionTasks,
	TASKS_ENTRY,
} from "@adeildo/pi-kit";
import { fakeContext, fakePi } from "@adeildo/pi-kit/testing";
import type { ProjectedSessionEntry, Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";

import { compact, spentText } from "../src/index.ts";
import { type AgentMessage, describeCall, KEEP_TURNS, planPrune, pruneNow } from "../src/prune.ts";
import {
	costRows,
	hiddenCalls,
	priced,
	PRUNE_ENTRY,
	PruneEntry,
	REREAD_ENTRY,
	spentOn,
} from "../src/record.ts";
import { standing, summarize } from "../src/summary.ts";

const BIG = "x".repeat(8000);
const SCRIPT = `python3 - <<'EOF'\n${BIG}\nEOF`;
const TURNS = KEEP_TURNS + 4;

interface Part {
	type: string;
	text?: string;
	id?: string;
	name?: string;
	arguments?: { command?: string };
}

function entry(id: string, message: unknown): ProjectedSessionEntry {
	return {
		sourceEntry: { type: "message", id, message },
		messages: [message],
	} as unknown as ProjectedSessionEntry;
}

function call(
	id: string,
	name: string,
	args: Record<string, unknown>,
	text = "",
): ProjectedSessionEntry {
	const content = [
		...(text === "" ? [] : [{ type: "text", text }]),
		{ type: "toolCall", id: `c-${id}`, name, arguments: args },
	];
	return entry(id, {
		role: "assistant",
		content,
		usage: usage(0),
		stopReason: "toolUse",
		timestamp: 0,
	});
}

function result(id: string, name: string, text: string, isError = false): ProjectedSessionEntry {
	const content = [{ type: "text", text }];
	return entry(`r-${id}`, {
		role: "toolResult",
		toolCallId: `c-${id}`,
		toolName: name,
		content,
		isError,
		timestamp: 0,
	});
}

function usage(context: number) {
	return {
		input: 0,
		output: 10,
		cacheRead: context,
		cacheWrite: 0,
		totalTokens: context,
		cost: { total: 0 },
	};
}

/** Your ask, then a read per turn with a big output. Turn 1 failed, and turn 2 asked you questions. */
function session(turns = TURNS): ProjectedSessionEntry[] {
	const entries = [entry("u1", { role: "user", content: "fix the login", timestamp: 0 })];
	for (let turn = 0; turn < turns; turn++) {
		const id = `t${turn}`;
		if (turn === 1) {
			entries.push(
				call(id, "bash", { command: SCRIPT }, "Running the migration."),
				result(id, "bash", BIG, true),
			);
		} else if (turn === 2) {
			entries.push(call(id, "ask_questions", { questions: [] }), result(id, "ask_questions", BIG));
		} else {
			entries.push(call(id, "read", { path: `src/file${turn}.ts` }), result(id, "read", BIG));
		}
	}
	return entries;
}

function partsOf(replacement: unknown): Part[] {
	return (replacement as { content: Part[] }).content;
}

describe("what a prune hides", () => {
	const plan = planPrune(session());
	const targets = new Set(plan.edits.map((edit) => edit.targetId));

	test("an old output becomes a line that names its call, so the agent can run it again", () => {
		const edit = plan.edits.find((candidate) => candidate.targetId === "r-t0");
		expect(partsOf(edit?.replacement)).toEqual([
			{
				type: "text",
				text: "Output hidden to save context, about 2k tokens. It came from: read src/file0.ts. Run it again if you need it.",
			},
		]);
		expect(plan.hidden.map((hidden) => hidden.call)).toEqual([
			"read src/file0.ts",
			"read src/file3.ts",
		]);
	});

	test("your words, errors, your answers to questions and the last turns stay whole", () => {
		for (const kept of ["u1", "r-t1", "r-t2"]) expect(targets.has(kept)).toBe(false);
		const firstKept = TURNS - KEEP_TURNS;
		for (let turn = firstKept; turn < TURNS; turn++) {
			expect(targets.has(`t${turn}`)).toBe(false);
			expect(targets.has(`r-t${turn}`)).toBe(false);
		}
		expect(targets.has(`r-t${firstKept - 1}`)).toBe(true);
	});

	test("a long argument is cut, and its call keeps its id and the words around it", () => {
		const parts = partsOf(plan.edits.find((candidate) => candidate.targetId === "t1")?.replacement);
		expect(parts[0]).toEqual({ type: "text", text: "Running the migration." });
		expect(parts[1]).toMatchObject({ type: "toolCall", id: "c-t1", name: "bash" });
		expect(parts[1]?.arguments?.command).toBe(
			`python3 - <<'EOF' (${SCRIPT.length} characters, hidden to save context)`,
		);
		expect(plan.freed).toBeGreaterThan(5000);
	});

	test("a short session has nothing old enough, and a second prune finds nothing left", () => {
		expect(planPrune(session(KEEP_TURNS)).edits).toEqual([]);
		const pruned = session().map((projected) => {
			const edit = plan.edits.find((candidate) => candidate.targetId === projected.sourceEntry.id);
			if (edit?.replacement === undefined || edit.replacement === null) return projected;
			const message = {
				...projected.messages[0],
				content: edit.replacement.content,
			} as AgentMessage;
			return { sourceEntry: projected.sourceEntry, messages: [message] };
		});
		expect(planPrune(pruned).edits).toEqual([]);
	});
});

test("a prune waits for the context to pass the line, and for a fifth of it to go at once", () => {
	const old = session(KEEP_TURNS + 10);
	expect(pruneNow(old, 5_000, 10_000)).toBeUndefined();
	expect(pruneNow(old, 20_000, 10_000)?.edits.length).toBeGreaterThan(0);
	expect(pruneNow(session(KEEP_TURNS + 2), 20_000, 10_000)).toBeUndefined();
	expect(pruneNow(session(KEEP_TURNS + 2), 1_000, 10_000, true)?.edits.length).toBeGreaterThan(0);
});

test("a call reads as its name and what it pointed at", () => {
	expect(describeCall("bash", { command: "git push\ngit status" })).toBe("bash git push");
	expect(describeCall("web_search", { queries: ["a"] })).toBe('web_search {"queries":["a"]}');
});

let dir: string;
beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "pi-compact-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

interface Proposed {
	type: string;
	customType?: string;
	content?: string;
	data?: unknown;
}

function tasksEntry(state: SessionTasks) {
	return {
		type: "custom",
		customType: TASKS_ENTRY,
		data: { version: 1, trigger: "message", ops: [], state },
	};
}

async function mounted(branch: unknown[] = [], settings: Record<string, unknown> = {}) {
	writeFileSync(join(dir, "settings.json"), JSON.stringify({ compact: settings }));
	const fake = fakePi();
	createApp(fake.pi, { name: "test", settingsPath: join(dir, "settings.json") })
		.use(compact)
		.build();
	const notes: string[] = [];
	const ctx = fakeContext([], true, {
		sessionManager: { getBranch: () => branch },
		ui: { notify: (message: string) => notes.push(message) },
	});
	await fake.fire("session_start", {}, ctx);
	const turnEnd = async (context: number, entries = session(KEEP_TURNS + 10)) => {
		const message = { role: "assistant", content: [], usage: usage(context), stopReason: "stop" };
		const others = [{ type: "custom", customType: "other", data: 1 }];
		const event = {
			type: "turn_end",
			message,
			toolResults: [],
			entries: others,
			context: { contextEntries: entries },
		};
		const [answer] = await fake.fire("turn_end", event, ctx);
		return answer as { entries: Proposed[] } | undefined;
	};
	const prune = () => fake.commands.get("prune")?.handler("", ctx as never);
	return { fake, ctx, notes, turnEnd, prune };
}

describe("at the end of a turn", () => {
	test("past the line it hides old output, keeps what other extensions proposed, and says where things stand", async () => {
		const tasks = applyTaskOps(emptyTasks(), [{ op: "ask", text: "Fix the login" }], {
			at: 1,
			origin: "you",
		});
		const { turnEnd } = await mounted([tasksEntry(tasks)], { pruneAbove: 20_000 });
		const answer = await turnEnd(25_000);
		const kinds = answer?.entries.map((proposed) => proposed.customType ?? proposed.type);
		expect(kinds?.[0]).toBe("other");
		expect(kinds?.filter((kind) => kind === "context_edit").length).toBe(9);
		const note = answer?.entries.find((proposed) => proposed.type === "custom_message");
		expect(note?.content).toContain("Each placeholder names the call it came from");
		expect(note?.content).toContain("Doing:\n- Fix the login");
		expect(answer?.entries.at(-1)).toMatchObject({
			customType: PRUNE_ENTRY,
			data: { before: 25_000 },
		});
	});

	test("below the line, or with pruning off, nothing changes", async () => {
		expect(await (await mounted()).turnEnd(100_000)).toBeUndefined();
		expect(
			await (await mounted([], { prune: false, pruneAbove: 20_000 })).turnEnd(25_000),
		).toBeUndefined();
	});

	test("/prune hides at the next turn whatever the size, and says when nothing is old enough", async () => {
		const { notes, turnEnd, prune } = await mounted([], { prune: false });
		await prune();
		expect((await turnEnd(1_000))?.entries.length).toBeGreaterThan(2);
		await prune();
		expect(await turnEnd(1_000, session(KEEP_TURNS))).toBeUndefined();
		expect(notes.at(-1)).toBe(
			`Nothing to hide: no tool output is older than the last ${KEEP_TURNS} turns.`,
		);
	});

	test("a call that repeats a hidden one counts once as a re-read", async () => {
		const { fake, ctx, turnEnd } = await mounted([], { pruneAbove: 20_000 });
		await turnEnd(25_000);
		const read = { type: "tool_call", toolName: "read", input: { path: "src/file0.ts" } };
		await fake.fire("tool_call", read, ctx);
		await fake.fire("tool_call", read, ctx);
		expect(fake.entries).toEqual([
			{ customType: REREAD_ENTRY, data: { call: "read src/file0.ts" } },
		]);
	});
});

function pruneEntry(calls: string[]) {
	const hidden = calls.map((name) => ({ entry: name, call: name, tokens: 1000 }));
	return {
		type: "custom",
		customType: PRUNE_ENTRY,
		data: { before: 200_000, after: 120_000, hidden },
	};
}

test("the session's prunes add up, with how much of what they hid was read again", () => {
	const branch = [
		pruneEntry(["read a", "read b", "read c", "read d"]),
		{ type: "custom", customType: REREAD_ENTRY, data: { call: "read a" } },
		pruneEntry(["read e"]),
	];
	expect(spentText(spentOn(branch))).toBe(
		"2 prunes freed 160k tokens; 1 of 5 hidden outputs run again (20%)",
	);
	expect(hiddenCalls(branch)).toEqual(new Set(["read b", "read c", "read d", "read e"]));
	expect(spentText(spentOn([]))).toBe("nothing hidden yet");
});

describe("the line a prune leaves", () => {
	const billed = {
		input: 1_000,
		cacheRead: 500_000,
		cacheWrite: 10_000,
		cost: { input: 0.005, cacheRead: 0.25, cacheWrite: 0.0625 },
	};
	const hidden = [
		{ entry: "a", call: "read src/view.ts", tokens: 4_200 },
		{ entry: "b", call: "bash bun test packages/tasks", tokens: 12_000 },
	];
	const record = {
		before: 705_000,
		after: 250_000,
		hidden,
		...priced(billed, 0, 455_000, 198_000),
	};
	const plain = { fg: (_color: string, text: string) => text } as unknown as Theme;

	test("says what the next request pays to rewrite the cache, and when that pays back", () => {
		expect(costRows(record)).toEqual([
			["cache rewrite on the next request", "~$1.12"],
			["saved on each request after, back in 5 requests", "~$0.23"],
		]);
		expect(costRows({ ...record, rewrite: 0 })).toEqual([
			["saved on each request after", "~$0.23"],
		]);
		expect(priced({ ...billed, cacheRead: 0 }, 0, 455_000, 198_000)).toBeUndefined();
	});

	test("lines up with the tool box above it: glyph on the border, text on the content, numbers on the edge", () => {
		const lines = new PruneEntry(record, true, plain).render(80);
		expect(lines.slice(0, 3)).toEqual([
			` \u25cc pruned  2 old tool outputs${" ".repeat(32)}705k \u2192 250k tokens`,
			`   cache rewrite on the next request${" ".repeat(37)}~$1.12`,
			`   saved on each request after, back in 5 requests${" ".repeat(23)}~$0.23`,
		]);
		expect(lines.at(-1)).toBe(`   bash bun test packages/tasks${" ".repeat(45)}12k`);
		for (const line of lines) expect(visibleWidth(line)).toBe(79);
	});

	test("a prune recorded before it was priced shows no cost", () => {
		const lines = new PruneEntry({ before: 705_000, after: 250_000, hidden }, false, plain).render(
			80,
		);
		expect(lines).toHaveLength(1);
	});
});

function answering(text: string | undefined) {
	return {
		asked: [] as string[],
		streamSimple(_model: unknown, context: { messages: { content: unknown }[] }) {
			this.asked.push(JSON.stringify(context.messages));
			return {
				result: async () =>
					text === undefined
						? {
								role: "assistant",
								stopReason: "error",
								errorMessage: "down",
								content: [],
								usage: {},
							}
						: {
								role: "assistant",
								stopReason: "stop",
								content: [{ type: "text", text }],
								usage: { input: 10, output: 5, cost: { total: 0.001 } },
							},
			};
		},
	};
}

describe("the compaction summary", () => {
	const tasks = applyTaskOps(
		emptyTasks(),
		[
			{ op: "title", text: "OAuth on the MCP" },
			{ op: "ask", text: "Use one secret" },
			{ op: "decide", text: "One SECRET with a mode" },
		],
		{ at: 1, origin: "you" },
	);
	const preparation = {
		firstKeptEntryId: "k1",
		tokensBefore: 900_000,
		isSplitTurn: false,
		turnPrefixMessages: [],
		messagesToSummarize: [
			{
				role: "user",
				content: 'use one secret <skill name="x" location="y">long</skill>',
				timestamp: 0,
			},
			{ role: "assistant", content: [{ type: "text", text: "Done." }], timestamp: 0 },
		],
		fileOps: {
			read: new Set(["README.md", "src/a.ts"]),
			written: new Set(["src/a.ts"]),
			edited: new Set(),
		},
		settings: { enabled: true, reserveTokens: 16384, keepRecentTokens: 20000 },
	} as never;

	const side = {
		provider: "anthropic",
		id: "haiku",
		api: "anthropic-messages",
		maxTokens: 8000,
		contextWindow: 200_000,
		reasoning: false,
		cost: { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
	} as never;

	test("puts the tasks and your words, as they are, on top of pi's summary", async () => {
		const registry = answering("## Goal\nOAuth on the MCP");
		const written = await summarize(
			{ tasks, preparation },
			[side],
			registry as never,
			AbortSignal.timeout(1000),
		);
		expect(written?.firstKeptEntryId).toBe("k1");
		expect(written?.summary.split("\n## Goal")[0]).toBe(
			[
				"## Where the session stands",
				"Session: OAuth on the MCP",
				"Doing:",
				"- Use one secret",
				"Decided:",
				"- One SECRET with a mode",
				"",
				"## What the operator asked, newest last",
				'- "use one secret"',
				"",
			].join("\n"),
		);
		expect(written?.summary).toContain("<modified-files>\nsrc/a.ts\n</modified-files>");
		expect(registry.asked.join("")).toContain("use one secret");
	});

	test("without a model that answers, pi writes the summary itself", async () => {
		const written = await summarize(
			{ tasks, preparation },
			[side],
			answering(undefined) as never,
			AbortSignal.timeout(1000),
		);
		expect(written).toBeUndefined();
		expect(
			standing({
				tasks: emptyTasks(),
				preparation: { messagesToSummarize: [], turnPrefixMessages: [] } as never,
			}),
		).toBe("");
	});

	test("pi writes its own when the session has no tasks, or the setting is off", async () => {
		const event = {
			type: "session_before_compact",
			preparation,
			branchEntries: [],
			signal: AbortSignal.timeout(1000),
		};
		const { fake, ctx } = await mounted();
		expect(await fake.fire("session_before_compact", event, ctx)).toEqual([undefined]);
		const branch = [tasksEntry(tasks)];
		const off = await mounted(branch, { summary: false });
		const answers = await off.fake.fire(
			"session_before_compact",
			{ ...event, branchEntries: branch },
			off.ctx,
		);
		expect(answers).toEqual([undefined]);
	});
});

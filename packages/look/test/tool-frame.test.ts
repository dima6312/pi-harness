import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createApp, RULING, type RulingRequest } from "@adeildo/pi-kit";
import { fakePi } from "@adeildo/pi-kit/testing";
import type { AgentToolResult, Theme, ToolRenderers } from "@earendil-works/pi-coding-agent";
import { Container, stripTerminalSequences, Text } from "@earendil-works/pi-tui";

import { look } from "../src/index.ts";
import { editLines } from "../src/render/streaming.ts";

const theme = {
	fg: (_color: string, text: string) => text,
	bold: (text: string) => text,
} as unknown as Theme;

/** Pi's own order: each resolver asks the next one, and the tool definition comes last. */
function resolve(fake: ReturnType<typeof fakePi>, base: ToolRenderers, toolName = "bash") {
	const resolveAt = (index: number): ToolRenderers | undefined =>
		index < fake.toolRenderers.length
			? fake.toolRenderers[index]!(toolName, () => resolveAt(index + 1))
			: base;
	return resolveAt(0);
}

function renderers(): ToolRenderers {
	return {
		renderCall: (args: unknown) => new Text(`$ ${(args as { command: string }).command}`, 0, 0),
		renderResult: () => {
			const box = new Container();
			box.addChild(new Text("583 pass", 0, 0));
			return box;
		},
	};
}

function toolResult(text = "583 pass"): AgentToolResult<undefined> {
	return { content: [{ type: "text", text }], details: undefined };
}

function plain(component: { render(width: number): string[] }): string[] {
	return component.render(60).map((line) => line.trimEnd());
}

function context(overrides: Record<string, unknown> = {}) {
	return {
		toolCallId: "call-1",
		invalidate: () => {},
		state: {},
		expanded: false,
		isPartial: true,
		isError: false,
		executionStarted: true,
		cwd: "/repo",
		...overrides,
	} as never;
}

/** A call and its result share one context, which is where the frame keeps the clock. */
function whole(ruling?: RulingRequest["ruling"], output = "583 pass") {
	const fake = fakePi();
	createApp(fake.pi, { name: "look" }).use(look).build();
	fake.pi.events.on(RULING, (data) => {
		if ((data as RulingRequest).toolCallId === "call-1") (data as RulingRequest).ruling = ruling;
	});
	const chain = resolve(fake, { ...renderers(), renderResult: () => new Text(output, 0, 0) });
	if (chain === undefined) throw new Error("no renderers");

	// The clock of a call the model took 2.1s to write and that ran for 6.8s.
	const shared = context({
		argsComplete: true,
		state: { writingAt: 1_000, writtenAt: 3_100, startedAt: 4_000, endedAt: 10_800 },
	});
	const call = chain.renderCall?.({ command: "bun run test" }, theme, shared);
	if (call === undefined) throw new Error("no call component");
	const result = chain.renderResult?.(
		toolResult(),
		{ expanded: false, isPartial: false },
		theme,
		shared,
	);
	if (result === undefined) throw new Error("no result component");
	return { call: plain(call), result: plain(result) };
}

function framed(
	ruling?: RulingRequest["ruling"],
	toolName = "bash",
	overrides: Record<string, unknown> = {},
) {
	const fake = fakePi();
	createApp(fake.pi, { name: "look" }).use(look).build();
	fake.pi.events.on(RULING, (data) => {
		if ((data as RulingRequest).toolCallId === "call-1") (data as RulingRequest).ruling = ruling;
	});
	const chain = resolve(fake, renderers(), toolName);
	if (chain === undefined) throw new Error("no renderers");
	const call = chain.renderCall?.({ command: "bun run test" }, theme, context(overrides));
	if (call === undefined) throw new Error("no call component");
	return { chain, call: call.render(60).map((line) => line.trimEnd()) };
}

describe("the frame around a tool call", () => {
	test("opens with the tool's mark and name", () => {
		const { call } = framed();
		expect(call[0]).toMatch(/^\u256d\u2500 \S+ bash \u2500+\u256e$/);
		expect(call[1]).toMatch(/^\u2502 \$ bun run test +\u2502$/);
	});

	test("says the ruling under the call, when there is one", () => {
		const { call } = framed({ tone: "success", head: "judge approved", why: "97% sure" });
		expect(call[2]).toContain("\u25c8 judge approved  97% sure");
	});

	test("closes with the mark of how it went", () => {
		const { chain } = framed();
		const result = chain.renderResult?.(
			toolResult(),
			{ expanded: false, isPartial: false },
			theme,
			context(),
		);
		const lines = (result ?? new Text("", 0, 0)).render(60).map((line) => line.trimEnd());
		expect(lines.at(-1)).toMatch(/^\u2570\u2500 \S+ done \u2500+\u256f$/);
	});

	test("cuts the command off from what it printed", () => {
		const { call, result } = whole();
		expect(call.some((line) => /^\u251c\u2500+\u2524$/u.test(line))).toBe(false);
		expect(result[0]).toMatch(/^\u251c\u2500+\u2524$/);
	});

	test("leaves the cut out of a call with nothing to print", () => {
		const { result } = whole(undefined, "");
		expect(result.some((line) => /^\u251c\u2500+\u2524$/u.test(line))).toBe(false);
		expect(result.at(-1)).toMatch(/^\u2570\u2500 \S+ done  6\.8s  wrote 2\.1s \u2500+\u256f$/);
	});

	test("says the times on the bottom rule instead of inside the output", () => {
		const { result } = whole(undefined, "583 pass\n\nTook 6.8s");
		expect(result.some((line) => line.includes("Took"))).toBe(false);
		expect(result.at(-1)).toMatch(/^\u2570\u2500 \S+ done  6\.8s  wrote 2\.1s \u2500+\u256f$/);
	});

	test("says the phase while the call has nothing to show yet", () => {
		const writing = framed(undefined, "bash", { executionStarted: false, argsComplete: false });
		expect(writing.call.at(-1)).toMatch(/^\u2570\u2500 \S+ writing  0\.0s \u2500+\u256f$/);

		const waiting = framed(undefined, "bash", { executionStarted: false, argsComplete: true });
		expect(waiting.call.at(-1)).toMatch(/^\u2570\u2500 \S+ waiting  0\.0s \u2500+\u256f$/);

		// Running with no result yet, as while a dialog waits for you, it still closes.
		const running = framed(undefined, "bash", { executionStarted: true });
		expect(running.call.at(-1)).toMatch(/^\u2570\u2500 \S+ running  0\.0s \u2500+\u256f$/);
	});

	test("stops closing once the result half draws the bottom rule", () => {
		const shared = context({ executionStarted: true, state: { startedAt: Date.now() } });
		const { chain } = framed();
		const call = chain.renderCall?.({ command: "ls" }, theme, shared);
		chain.renderResult?.(toolResult(), { expanded: false, isPartial: true }, theme, shared);
		expect(call?.render(60).some((line) => line.startsWith("\u2570"))).toBe(false);
	});

	test("a call that waits for you says so", () => {
		const shared = context({ executionStarted: true, state: { startedAt: Date.now() - 4_000 } });
		const { chain } = framed(undefined, "ask_questions");
		const call = chain.renderCall?.({ questions: [] }, theme, shared);
		expect(call?.render(60).at(-1)).toMatch(/waiting for your answer {2}4\.0s/);
	});

	test("closes a call that is still running with the time so far", () => {
		const fake = fakePi();
		createApp(fake.pi, { name: "look" }).use(look).build();
		const chain = resolve(fake, renderers());
		if (chain === undefined) throw new Error("no renderers");
		const shared = context({ state: { startedAt: Date.now() - 3_200 } });
		chain.renderCall?.({ command: "bun run test" }, theme, shared);
		const result = chain.renderResult?.(
			toolResult(),
			{ expanded: false, isPartial: true },
			theme,
			shared,
		);
		const lines = (result ?? new Text("", 0, 0)).render(60).map((line) => line.trimEnd());
		expect(lines.at(-1)).toMatch(/^\u2570\u2500 \S+ running  3\.2s \u2500+\u256f$/);
	});

	test("counts the pictures pi draws below the frame", () => {
		const { chain } = framed();
		const result = chain.renderResult?.(
			{
				content: [{ type: "image", data: "x", mimeType: "image/png" }],
				details: undefined,
			} as never,
			{ expanded: false, isPartial: false },
			theme,
			context(),
		);
		const lines = result === undefined ? [] : plain(result);
		expect(lines.at(-1)).toContain("with 1 image");
	});

	test("frames a tool that brings no renderers of its own", () => {
		const fake = fakePi();
		createApp(fake.pi, { name: "look" }).use(look).build();
		const chain = resolve(fake, {}, "memory_read");
		if (chain === undefined) throw new Error("no renderers");

		const call = chain.renderCall?.({ target: "scratchpad" }, theme, context());
		const callLines = call === undefined ? [] : plain(call);
		expect(callLines[0]).toMatch(/^\u256d\u2500 \S+ memory_read \u2500+\u256e$/);
		expect(callLines[1]).toContain('target="scratchpad"');
		expect(callLines[1]).not.toContain("memory_read");

		const result = chain.renderResult?.(
			toolResult("# Scratchpad"),
			{ expanded: false, isPartial: false },
			theme,
			context(),
		);
		const lines = result === undefined ? [] : plain(result);
		expect(lines.some((line) => line.includes("# Scratchpad"))).toBe(true);
		expect(lines.at(-1)).toMatch(/^\u2570\u2500 \S+ done \u2500+\u256f$/);
	});

	test("keeps the half a tool brings, and stands in for the other", () => {
		const fake = fakePi();
		createApp(fake.pi, { name: "look" }).use(look).build();
		const chain = resolve(fake, { renderCall: () => new Text("mine", 0, 0) }, "memory_read");
		if (chain === undefined) throw new Error("no renderers");

		const call = chain.renderCall?.({ target: "scratchpad" }, theme, context());
		expect(call === undefined ? [] : plain(call)).toContainEqual(expect.stringContaining("mine"));

		const result = chain.renderResult?.(
			toolResult(),
			{ expanded: false, isPartial: false },
			theme,
			context(),
		);
		expect(result === undefined ? [] : plain(result)).toContainEqual(
			expect.stringContaining("583 pass"),
		);
	});

	test("shortens a long result, and shows it all when expanded", () => {
		const fake = fakePi();
		createApp(fake.pi, { name: "look" }).use(look).build();
		const chain = resolve(fake, {}, "memory_read");
		if (chain === undefined) throw new Error("no renderers");
		const output = Array.from({ length: 14 }, (_, index) => `line ${index + 1}`).join("\n");

		const collapsed = chain.renderResult?.(
			toolResult(output),
			{ expanded: false, isPartial: false },
			theme,
			context(),
		);
		const collapsedLines = collapsed === undefined ? [] : plain(collapsed);
		expect(collapsedLines.some((line) => line.includes("line 14"))).toBe(false);
		expect(collapsedLines.some((line) => line.includes("4 more lines"))).toBe(true);

		const expanded = chain.renderResult?.(
			toolResult(output),
			{ expanded: true, isPartial: false },
			theme,
			context(),
		);
		const expandedLines = expanded === undefined ? [] : plain(expanded);
		expect(expandedLines.some((line) => line.includes("line 14"))).toBe(true);
		expect(expandedLines.some((line) => line.includes("more lines"))).toBe(false);
	});

	test("stays open for a call replayed with its result, instead of closing early", () => {
		const fake = fakePi();
		createApp(fake.pi, { name: "look" }).use(look).build();
		const chain = resolve(fake, renderers());
		if (chain === undefined) throw new Error("no renderers");

		// Pi rebuilds a past call without ever starting it, so the call half must not close itself.
		const replayed = context({ isPartial: false, executionStarted: false, argsComplete: false });
		const call = chain.renderCall?.({ command: "bun run test" }, theme, replayed);
		const callLines = call === undefined ? [] : plain(call);
		expect(callLines.some((line) => /\u2570\u2500/u.test(line))).toBe(false);

		const result = chain.renderResult?.(
			toolResult(),
			{ expanded: false, isPartial: false },
			theme,
			replayed,
		);
		const lines = result === undefined ? [] : plain(result);
		expect(lines[0]).toMatch(/^\u251c\u2500+\u2524$/);
		expect(lines.at(-1)).toMatch(/^\u2570\u2500 \S+ done \u2500+\u256f$/);
	});
});

describe("an edit or a write while the model writes it", () => {
	function streaming(toolName: string, args: unknown, overrides: Record<string, unknown> = {}) {
		const fake = fakePi();
		createApp(fake.pi, { name: "look" }).use(look).build();
		let asked = 0;
		const own: ToolRenderers = {
			renderCall: () => {
				asked++;
				// Pi's write shows the first lines of the file under its path, and its edit only the
				// path until it has read the file.
				const body =
					toolName === "write" ? `${toolName} pi's own\nconst line1 = 1;` : `${toolName} pi's own`;
				return new Text(body, 0, 0);
			},
		};
		const chain = resolve(fake, own, toolName);
		const ctx = context({
			argsComplete: false,
			executionStarted: false,
			state: { writingAt: Date.now() },
			...overrides,
		});
		const call = chain?.renderCall?.(args, theme, ctx);
		if (call === undefined) throw new Error("no call component");
		// Pi's highlighter paints with its global theme, which another test file may have set first.
		const lines = call.render(72).map((line) => stripTerminalSequences(line).trimEnd());
		return { lines, asked: () => asked };
	}

	const content = Array.from(
		{ length: 12 },
		(_, index) => `const line${index + 1} = ${index + 1};`,
	).join("\n");

	test("a write shows its last lines, a cursor, and how much is written", () => {
		const { lines, asked } = streaming("write", { path: "/repo/new.ts", content });
		expect(lines.slice(1, -1)).toEqual([
			"│ write /repo/new.ts  new file                                         │",
			"│  ⋮  4 lines above                                                    │",
			"│  5  const line5 = 5;                                                 │",
			"│  6  const line6 = 6;                                                 │",
			"│  7  const line7 = 7;                                                 │",
			"│  8  const line8 = 8;                                                 │",
			"│  9  const line9 = 9;                                                 │",
			"│ 10  const line10 = 10;                                               │",
			"│ 11  const line11 = 11;                                               │",
			"│ 12  const line12 = 12;▍                                              │",
		]);
		expect(lines.at(-1)).toMatch(/writing {2}\d+\.\ds {2}12 lines {2}209 B/);
		expect(asked()).toBe(0);
	});

	test("a write says how many lines of the file it replaces", () => {
		const dir = mkdtempSync(join(tmpdir(), "look-write-"));
		try {
			writeFileSync(join(dir, "old.ts"), "a\nb\nc\n");
			const { lines } = streaming("write", { path: "old.ts", content: "a" }, { cwd: dir });
			expect(lines[1]).toContain("write old.ts  replaces 3 lines");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("an edit shows the lines it takes out and puts in, as they arrive", () => {
		const args = {
			path: "/repo/a.ts",
			edits: [
				{ oldText: "const MAX = 240;", newText: "const MAX_TEXT = 240;" },
				{ oldText: "a\nb", newText: "c" },
			],
		};
		const { lines } = streaming("edit", args);
		expect(lines.slice(1, -1)).toEqual([
			"│ edit /repo/a.ts                                                      │",
			"│ -const MAX = 240;                                                    │",
			"│ +const MAX_TEXT = 240;                                               │",
			"│ ⋯                                                                    │",
			"│ -a                                                                   │",
			"│ -b                                                                   │",
			"│ +c▍                                                                  │",
		]);
		expect(lines.at(-1)).toMatch(/writing {2}\d+\.\ds {2}edit 2 {2}-3 \+2/);
	});

	test("pi takes over once the call is written, and the stream waits for pi's diff", () => {
		const args = { path: "/repo/a.ts", edits: [{ oldText: "x", newText: "y" }] };
		const done = streaming("edit", args, { argsComplete: true });
		expect(done.asked()).toBe(1);
		// Pi's edit shows only its first line until it has read the file.
		expect(done.lines[1]).toContain("edit /repo/a.ts");
		expect(done.lines[2]).toContain("-x");
		const write = streaming("write", { path: "/repo/new.ts", content }, { argsComplete: true });
		expect(write.lines[1]).toContain("write pi's own");
	});

	test("other tools keep pi's renderer while they are written", () => {
		const { lines, asked } = streaming("bash", { command: "ls" });
		expect(asked()).toBe(1);
		expect(lines[1]).toContain("bash pi's own");
	});
});

describe("the lines an edit changes", () => {
	const edit = { oldText: "a\nb\nc\nd", newText: "a\nB\nc\nd" };

	test("the lines both texts start and end with are context", () => {
		expect(editLines(edit, true)).toEqual({
			before: ["a"],
			out: ["b"],
			in: ["B"],
			after: ["c", "d"],
		});
	});

	test("while the new text arrives, the lines it has not repeated yet count as taken out", () => {
		expect(editLines({ oldText: edit.oldText, newText: "a\nB\nc" }, false)).toEqual({
			before: ["a"],
			out: ["b", "c", "d"],
			in: ["B", "c"],
			after: [],
		});
		// The line still arriving may be cut short, so it is never context yet.
		expect(editLines({ oldText: "a\nb", newText: "a" }, false).before).toEqual([]);
	});
});

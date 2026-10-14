import { describe, expect, test } from "bun:test";

import type { SessionEntry, Theme } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences } from "@earendil-works/pi-tui";

import { OutputView, outputsOf } from "../src/ui/outputs.ts";

const plain = {
	fg: (_color: string, text: string) => text,
	bold: (text: string) => text,
} as unknown as Theme;

function call(id: string, name: string, args: Record<string, unknown>): SessionEntry {
	return {
		type: "message",
		id: `a${id}`,
		parentId: null,
		timestamp: "",
		message: { role: "assistant", content: [{ type: "toolCall", id, name, arguments: args }] },
	} as SessionEntry;
}

function result(id: string, text: string, isError = false): SessionEntry {
	return {
		type: "message",
		id: `r${id}`,
		parentId: null,
		timestamp: "",
		message: {
			role: "toolResult",
			toolCallId: id,
			toolName: "x",
			content: [{ type: "text", text }],
			isError,
		},
	} as SessionEntry;
}

const BRANCH = [
	call("1", "bash", { command: "ls\nmore" }),
	result("1", "a.ts\nb.ts"),
	call("2", "read", { path: "src/view.ts" }),
	result("2", Array.from({ length: 40 }, (_, line) => `line ${line + 1}`).join("\n")),
	call("3", "bash", { command: "true" }),
	result("3", ""),
];

function view(rows = 12) {
	let closed = false;
	const shown = new OutputView({
		theme: plain,
		outputs: outputsOf(BRANCH),
		rows: () => rows,
		close: () => {
			closed = true;
		},
	});
	const draw = () => shown.render(60).map(stripTerminalSequences);
	return { shown, draw, closed: () => closed };
}

describe("the tool output view", () => {
	test("takes the calls that printed something, with what each pointed at", () => {
		expect(
			outputsOf(BRANCH).map((output) => [output.tool, output.target, output.lines.length]),
		).toEqual([
			["bash", "ls", 2],
			["read", "src/view.ts", 40],
		]);
	});

	test("opens on the newest output, scrolls a page at a time, and moves to older calls", () => {
		const { shown, draw } = view();
		expect(draw()[0]).toContain("read src/view.ts");
		expect(draw()[0]).toContain("1 of 2");
		expect(draw().join("\n")).toContain("line 1");
		expect(draw().at(-1)).toContain("lines 1-10 of 40");
		shown.handleInput("\u001b[6~");
		expect(draw().at(-1)).toContain("lines 11-20 of 40");
		shown.handleInput("\u001b[F");
		expect(draw().at(-1)).toContain("lines 31-40 of 40");
		shown.handleInput("\u001b[D");
		expect(draw()[0]).toContain("bash ls");
		expect(draw().at(-1)).toContain("lines 1-2 of 2");
	});

	test("escape closes it", () => {
		const { shown, closed } = view();
		shown.handleInput("\u001b");
		expect(closed()).toBe(true);
	});
});

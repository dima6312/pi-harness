import { afterEach, beforeAll, describe, expect, test } from "bun:test";

import { getMarkdownTheme, initTheme, UserMessageComponent } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences } from "@earendil-works/pi-tui";

import { frameUserMessages, framed } from "../src/ui/user-message.ts";

const plain = {
	fg: (_color: string, text: string) => text,
	bg: (_color: string, text: string) => text,
	bold: (text: string) => text,
} as never;

const START = "\u001b]133;A\u0007";
const END = "\u001b]133;B\u0007\u001b]133;C\u0007";

describe("your messages", () => {
	// Pi's component paints with its global theme.
	beforeAll(() => initTheme("dark", false));
	afterEach(() => frameUserMessages(() => undefined));

	test("sit in a frame named you, without pi's background and blank rows", () => {
		const bg = (text: string) => `\u001b[48;2;30;40;50m${text}\u001b[49m`;
		// Pi draws the message two columns narrower, which the sides take.
		const body = [`${START}${bg("          ")}`, bg(" fix it   "), `${END}${bg("          ")}`];
		const lines = framed(body, 12, plain, ">");
		expect(lines.map((line) => stripTerminalSequences(line))).toEqual([
			"\u256d\u2500 > you \u2500\u2500\u256e",
			"\u2502 fix it   \u2502",
			`\u2570${"\u2500".repeat(10)}\u256f`,
		]);
		// The shell integration markers stay on the first and last lines.
		expect(lines[0]?.startsWith(START)).toBe(true);
		expect(lines.at(-1)?.startsWith(END)).toBe(true);
		expect(lines.join("")).not.toContain("\u001b[48;");
	});

	test("pi's own block comes back when the frame is off", () => {
		const message = new UserMessageComponent("hello", getMarkdownTheme(), 1);
		frameUserMessages(() => ({ theme: plain, set: "ascii" }));
		expect(stripTerminalSequences(message.render(20)[0] ?? "")).toStartWith("\u256d\u2500 > you");
		frameUserMessages(() => undefined);
		expect(stripTerminalSequences(message.render(20)[0] ?? "")).not.toContain("you");
	});
});

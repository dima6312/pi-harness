import { describe, expect, test } from "bun:test";

import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";

import { frame, frameDivider, frameInner, pointer } from "../src/ui/frame.ts";

const plain = {
	fg: (_color: string, text: string) => text,
	bg: (_color: string, text: string) => text,
	bold: (text: string) => text,
	italic: (text: string) => text,
} as unknown as Theme;

describe("the frame", () => {
	test("title and status in the top edge, keys in the bottom, rows padded to the width", () => {
		const lines = frame(
			plain,
			30,
			["hello", { text: `${pointer(plain, true)}picked`, selected: true }],
			{
				title: "Tasks",
				status: "3 done",
				keys: [["esc", "close"]],
			},
		);
		expect(lines).toEqual([
			"\u256d\u2500 Tasks \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 3 done \u2500\u256e",
			"\u2502  hello                     \u2502",
			"\u2502\u258c \u276f picked                  \u2502",
			"\u2570\u2500 esc close \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u256f",
		]);
		for (const line of lines) expect(visibleWidth(line)).toBe(30);
		expect(frameInner(30)).toBe(24);
	});

	test("a column line meets the edges under the column", () => {
		const lines = frame(plain, 30, [`${"a".repeat(10)} \u2502 b`], {
			title: "Room",
			keys: [["tab", "agents"]],
			split: 11,
		});
		const column = lines[1]?.indexOf("\u2502", 1) ?? -1;
		expect(lines[0]?.[column]).toBe("\u252c");
		expect(lines[2]?.[column]).toBe("\u2534");
		for (const line of lines) expect(visibleWidth(line)).toBe(30);
	});

	test("a long title gives way, and the status drops before the frame breaks", () => {
		const [top] = frame(plain, 20, [], { title: "A very long title indeed", status: "9 of 9" });
		expect(visibleWidth(top ?? "")).toBe(20);
		expect(frameDivider(plain, 20, "only oauth")).toBe(
			"\u251c\u2500\u2500\u2500\u2500\u2500 only oauth \u2500\u2524",
		);
	});
});

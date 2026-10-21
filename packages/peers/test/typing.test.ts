import { describe, expect, test } from "bun:test";

import type { Theme } from "@earendil-works/pi-coding-agent";

import type { Named } from "../src/names.ts";
import { typingLines } from "../src/ui/typing.ts";

const plain = {
	fg: (_color: string, text: string) => text,
	bold: (text: string) => text,
} as unknown as Theme;

const names = new Map<string, Named>([
	["a", { session: "a", handle: "oauth", color: "syntaxString" } as Named],
	["b", { session: "b", handle: "migration", color: "syntaxType" } as Named],
	["c", { session: "c", handle: "docs", color: "syntaxNumber" } as Named],
]);
const folder = { session: "c", names: () => names };
const source = {
	othersTyping: () => [],
	here: (room: string | undefined) => (room === undefined || room === "r1" ? folder : undefined),
	rooms: () => [
		{ id: undefined, name: "repo", folders: [], sessions: [] },
		{ id: "r1", name: "backend+frontend", folders: [], sessions: [] },
	],
};

describe("someone writing to the room", () => {
	test("a draft wears the dashed frame, who writes to whom on top", () => {
		const lines = typingLines(
			[{ session: "a", to: "@docs, @migration", text: "", at: 0 }],
			source,
			plain,
			80,
			0,
		);
		expect(lines[0]?.startsWith("╭┄")).toBe(true);
		expect(lines[0]).toContain("@oauth → you, @migration");
		expect(lines.join("\n")).toContain("writing");
		expect(lines.at(-1)?.startsWith("╰┄")).toBe(true);
	});

	test("a long draft keeps its newest words, inside the frame", () => {
		const text = `${"old words ".repeat(20)}the newest part`;
		const lines = typingLines(
			[{ session: "b", to: "everyone", text, at: 0 }],
			source,
			plain,
			70,
			0,
		);
		expect(lines.join("\n")).toContain("the newest part");
		expect(lines.every((line) => line.length <= 70)).toBe(true);
	});

	test("a draft in a shared room says which", () => {
		const lines = typingLines(
			[{ session: "a", to: "@docs", text: "", at: 0, room: "r1" }],
			source,
			plain,
			80,
			0,
		);
		expect(lines[0]).toContain("@oauth → you in backend+frontend");
	});
});

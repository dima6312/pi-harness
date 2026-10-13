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
const source = { session: "c", names: () => names };

describe("someone writing to the room", () => {
	test("says who writes to whom, a message to this session reads to you", () => {
		const [line] = typingLines(
			[{ session: "a", to: "@docs, @migration", text: "", at: 0 }],
			source,
			plain,
			80,
			0,
		);
		expect(line).toBe("\u280b oauth is writing to you, migration.  ");
	});

	test("a long draft keeps its newest words", () => {
		const text = `${"old words ".repeat(20)}the newest part`;
		const [line] = typingLines(
			[{ session: "b", to: "everyone", text, at: 0 }],
			source,
			plain,
			70,
			0,
		);
		expect(line?.endsWith("the newest part")).toBe(true);
		expect(line?.length).toBeLessThanOrEqual(70);
	});
});

import { expect, test } from "bun:test";

import type { Theme } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences } from "@earendil-works/pi-tui";

import { heldBlock } from "../src/ui/held.ts";

const plain = {
	fg: (_color: string, text: string) => text,
	bold: (text: string) => text,
} as unknown as Theme;

const item = {
	id: "m1",
	from: "api",
	color: "accent",
	fromYou: false,
	toYou: false,
	everyone: true,
	text: "/v1/fleet now has a capacity field.",
	at: 0,
};

test("a held message is drawn with the reason it waits under it", () => {
	const lines = heldBlock({ items: [item], why: "quiet" }, plain)
		.render(80)
		.map((line) => stripTerminalSequences(line));
	expect(lines.join("\n")).toContain("/v1/fleet now has a capacity field.");
	expect(lines.at(-2)?.trim()).toBe(
		"It waits for your next prompt: the agents answered each other 4 times in a",
	);
	expect(lines.at(-1)?.trim()).toBe("row, so this did not wake the agent.");
});

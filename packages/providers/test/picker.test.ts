import { expect, test } from "bun:test";

import { fakeContext } from "@adeildo/pi-kit/testing";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { type TUI, visibleWidth } from "@earendil-works/pi-tui";

import { FramedSelect, pick } from "../src/ui/picker.ts";

const THEME = {
	fg: (_role: string, text: string) => text,
	bold: (text: string) => text,
} as unknown as Theme;
const TUI = { requestRender: () => {} } as unknown as TUI;

test("a host without our frame answers with pi's select", async () => {
	const ctx = fakeContext([], true, {
		mode: "rpc",
		ui: { select: async (_title: string, options: string[]) => options[1] },
	});
	expect(await pick(ctx, "Title", ["one", "two"])).toBe("two");
});

test("no options is no dialog", async () => {
	const ctx = fakeContext([], true, {
		mode: "rpc",
		ui: {
			select: async () => {
				throw new Error("asked with nothing to choose");
			},
		},
	});
	expect(await pick(ctx, "Title", [])).toBeUndefined();
});

test("the frame holds the title and the options, and the keys sit in its bottom edge", () => {
	const width = 40;
	const component = new FramedSelect(TUI, THEME, "Pick one", ["alpha", "beta"], () => {});
	const lines = component.render(width);
	const body = lines.join("\n");

	expect(lines[0]?.startsWith("╭─ Pick one ")).toBe(true);
	expect(lines.at(-1)?.startsWith("╰─ ↑↓ move")).toBe(true);
	expect(body).toContain("alpha");
	expect(body).toContain("enter");
	for (const line of lines) expect(visibleWidth(line)).toBe(width);
});

test("descriptions line up in one column", () => {
	const options = [
		{ label: "work", description: "5h 62% used" },
		{ label: "personal", description: "week 30% used" },
	];
	const lines = new FramedSelect(TUI, THEME, "Pick", options, () => {}).render(60);
	const first = lines.find((line) => line.includes("5h 62% used"));
	const second = lines.find((line) => line.includes("week 30% used"));

	expect(first?.indexOf("5h")).toBe(second?.indexOf("week"));
});

test("the pointer marks the chosen row and follows the keys", () => {
	const component = new FramedSelect(TUI, THEME, "Pick", ["alpha", "beta"], () => {});
	expect(component.render(40).some((line) => line.includes("\u276f alpha"))).toBe(true);

	component.handleInput("\u001b[B");

	const moved = component.render(40);
	expect(moved.some((line) => line.includes("\u276f beta"))).toBe(true);
	expect(moved.some((line) => line.includes("\u276f alpha"))).toBe(false);
});

test("enter answers with the label", () => {
	let answer: string | undefined;
	const component = new FramedSelect(TUI, THEME, "Pick", ["alpha", "beta"], (value) => {
		answer = value;
	});
	component.handleInput("\u001b[B");
	component.handleInput("\r");

	expect(answer).toBe("beta");
});

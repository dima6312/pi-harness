import { expect, test } from "bun:test";

import { visibleWidth } from "@earendil-works/pi-tui";

import { LOOK_SETTINGS } from "../src/settings.ts";
import { framePreview, iconsPreview, userFramePreview } from "../src/ui/previews.ts";

test("only what depends on the terminal or on taste in lines is a setting", () => {
	expect(LOOK_SETTINGS.map((entry) => entry.id)).toEqual([
		"look.icons",
		"look.frame.style",
		"look.userFrame",
	]);
});

test("each setting shows what its values look like, as wide as the others", () => {
	const theme = {
		fg: (_color: string, text: string) => text,
		bg: (_color: string, text: string) => text,
		bold: (text: string) => text,
	} as never;
	for (const style of ["rounded", "square", "heavy", "line"]) {
		const lines = framePreview(style, theme, 56);
		expect(new Set(lines.map((line) => visibleWidth(line))).size).toBe(1);
	}
	expect(iconsPreview("nerd", theme).join(" ")).toContain("ask_questions");
	expect(userFramePreview(true, theme, 56)[0]).toContain("you");
});

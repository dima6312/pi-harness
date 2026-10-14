// What each look setting changes, drawn under the list in Alt+S while it or one of its values is
// selected: the marks of the icon set, the editor in the frame style, your message framed or not.
import { entryFrame, GLYPH, type Json } from "@adeildo/pi-kit";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";

import { BOXES, border, type FrameStyle } from "../render/frame.ts";
import { type IconMode, resolveIcons } from "../render/glyphs.ts";
import { stateMark, toolIcon } from "../render/tools.ts";

const WIDTH = 56;
const TOOLS = [
	"bash",
	"read",
	"edit",
	"grep",
	"web_fetch",
	"ask_questions",
	"peers",
	"memory_write",
];

/** The tool marks and the phase marks of an icon set. */
export function iconsPreview(value: Json, theme: Theme): string[] {
	const set = resolveIcons(value as IconMode).set;
	const tools = TOOLS.map(
		(tool) => `${theme.fg("toolTitle", toolIcon(tool, set))} ${theme.fg("muted", tool)}`,
	);
	const phases = (["writing", "waiting", "running", "done", "failed"] as const).map(
		(phase) => `${theme.fg("accent", stateMark(phase, set, 0))} ${theme.fg("muted", phase)}`,
	);
	return [tools.slice(0, 4).join("   "), tools.slice(4).join("   "), "", phases.join("   ")];
}

/** The editor, in the frame's lines. */
export function framePreview(value: Json, theme: Theme, width: number): string[] {
	const style = value as FrameStyle | "off";
	const room = Math.min(WIDTH, width);
	const line = (color: "borderAccent", text: string) => theme.fg(color, text);
	if (style === "off")
		return [
			theme.fg("dim", "pi's editor, as pi draws it, with the edges' information in the footer"),
		];
	const box = BOXES[style];
	// The preview draws its edges with the frame's own border, so it cannot drift from the editor.
	const edge = (which: "top" | "bottom", label: string, rest: string) =>
		border(room, [{ text: label, priority: 1 }], [{ text: rest, priority: 2 }], {
			box,
			edge: which,
			paint: (text) => line("borderAccent", text),
			separator: " ",
		});
	const side = style === "line" ? " " : line("borderAccent", box.vertical);
	return [
		edge("top", theme.fg("warning", "main"), theme.fg("muted", "~/project")),
		`${side} ${theme.fg("accent", GLYPH.cursor)}${" ".repeat(Math.max(0, room - 4))}${side}`,
		edge("bottom", theme.fg("text", "Opus 5.5"), theme.fg("muted", "ctx 34%")),
	];
}

/** Your message, framed or in pi's block. */
export function userFramePreview(value: Json, theme: Theme, width: number): string[] {
	const room = Math.min(WIDTH, width);
	const text = theme.fg("text", "commit with a semantic message and push");
	if (value === true)
		return entryFrame([text], room, theme, {
			top: `${theme.fg("accent", GLYPH.triangle)} ${theme.fg("muted", "you")}`,
			color: "accent",
		});
	const blank = theme.bg("userMessageBg", " ".repeat(room));
	const body = theme.bg(
		"userMessageBg",
		` ${text}${" ".repeat(Math.max(0, room - 1 - visibleWidth(text)))}`,
	);
	return [blank, body, blank];
}

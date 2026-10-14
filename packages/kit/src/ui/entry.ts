// The frame an entry of the transcript wears: what it is in the top edge, what became of it in the
// bottom one, the content one column in from the sides. The model's own words have none. Tool calls,
// your messages, other agents' messages and pi's own entries all share it. See DESIGN.md.
import type { Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import { type Component, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

import { LINE } from "./glyphs.ts";

/** Columns the frame takes from a row: both sides and a space inside each. */
export const ENTRY_X = 4;
/** A body line that the frame draws as a rule across it, as between a call and what it printed. */
export const ENTRY_CUT = "\u0000cut";

export interface EntryFrame {
	/** Left of the top edge: who or what. */
	top?: string;
	/** Right of the top edge, such as a time. */
	topRight?: string;
	/** Left of the bottom edge: what became of it. */
	bottom?: string;
	/** Right of the bottom edge. */
	bottomRight?: string;
	/** The color of the lines. */
	color?: ThemeColor;
	/** Something that has not happened yet, such as a message waiting to be sent. */
	dashed?: boolean;
	/** Columns between each side and the text. Pi's own blocks bring one of their own, so they take 0. */
	pad?: 0 | 1;
}

const SOLID = { h: LINE.h, v: LINE.v };
const DASHED = { h: LINE.hDashed, v: LINE.vDashed };

/** Lines drawn `ENTRY_X` columns narrower than `width` (two with no pad), in the frame. */
export function entryFrame(
	body: readonly string[],
	width: number,
	theme: Theme,
	frame: EntryFrame = {},
): string[] {
	const lines = frame.dashed ? DASHED : SOLID;
	const paint = (text: string) => theme.fg(frame.color ?? "border", text);
	const pad = " ".repeat(frame.pad ?? 1);
	const inner = Math.max(1, width - 2 - pad.length * 2);
	const edge = (corners: [string, string], left?: string, right?: string) => {
		const end = (right ? ` ${right} ` : "") + paint(lines.h + corners[1]);
		// A label too long is cut, never the corner, so the frame stays closed.
		const room = Math.max(0, width - 2 - visibleWidth(end) - 2);
		const label = left ? ` ${truncateToWidth(left, room, "...")} ` : "";
		const start = paint(corners[0] + lines.h) + label;
		const fill = Math.max(0, width - visibleWidth(start) - visibleWidth(end));
		const rule = start + paint(lines.h.repeat(fill)) + end;
		// A rule with fill in it is the width already; only a label that left no room needs cutting.
		return fill === 0 ? truncateToWidth(rule, width, "") : rule;
	};
	const side = paint(lines.v);
	return [
		edge([LINE.topLeft, LINE.topRight], frame.top, frame.topRight),
		...body.map((line) => {
			if (line === ENTRY_CUT) return paint(LINE.teeLeft + LINE.h.repeat(width - 2) + LINE.teeRight);
			// The line is measured to pad it anyway, so it is only cut when it does not fit.
			const cells = visibleWidth(line);
			const cut = cells > inner ? truncateToWidth(line, inner, "") : line;
			const shown = cells > inner ? visibleWidth(cut) : cells;
			return `${side}${pad}${cut}${" ".repeat(Math.max(0, inner - shown))}${pad}${side}`;
		}),
		edge([LINE.bottomLeft, LINE.bottomRight], frame.bottom, frame.bottomRight),
	];
}

/**
 * A component drawn once per width. The transcript draws every entry on every keystroke, so an
 * entry that draws itself again each time slows typing down as the session grows.
 */
export function drawnByWidth(draw: (width: number) => string[]): Component {
	let drawn: { width: number; lines: string[] } | undefined;
	return {
		render(width) {
			if (drawn?.width !== width) drawn = { width, lines: draw(width) };
			return drawn.lines;
		},
		invalidate() {
			drawn = undefined;
		},
	};
}

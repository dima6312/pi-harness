// The geometry of the dialog. The question and the terminal decide all of it, never the row under
// the cursor: reserving the space before it is needed is what keeps the dialog from jumping when
// the focus moves.
import { FRAME_X, FRAME_Y, LINE } from "@adeildo/pi-kit";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

export type Layout = "beside" | "below";

/** The rule between the options and the panel, with a space on each side. */
const DIVIDER = ` ${LINE.v} `;
const DIVIDER_WIDTH = 3;

/** A line of prose longer than this is hard to follow, so descriptions wrap here on a wide panel. */
export const MAX_MEASURE = 100;
/** Narrower than this, the panel goes under the options instead of beside them. */
const MIN_BESIDE = 100;
const MIN_LEFT = 34;
const MAX_LEFT_RATIO = 0.45;
/** The pointer, the number and the answered mark, plus room for the note that sits on the line. */
const LEFT_EXTRA = 24;

/** The least room a body gets however short the terminal is, and the shortest cap of a panel. */
export const PANEL_MIN_ROWS = 5;
const PANEL_MAX_ROWS = 18;
/** The frame, with the keys in its bottom edge, the tabs or the blank line, and the blank under the question. */
const CHROME_ROWS = FRAME_Y + 2;

/** A question never takes more than a quarter of the terminal; the rest becomes "n more lines". */
export function questionRows(terminalRows: number): number {
	return Math.max(4, Math.min(10, Math.floor(terminalRows / 4)));
}

/** The rows left for the options and the panel once the frame and the question have theirs. */
export function bodyRows(terminalRows: number, askedRows: number): number {
	return Math.max(PANEL_MIN_ROWS, terminalRows - CHROME_ROWS - askedRows);
}

export function layoutFor(inner: number): Layout {
	return inner + FRAME_X >= MIN_BESIDE ? "beside" : "below";
}

/** Fits the longest label with room for a note, and never takes more than 45% of the width. */
export function leftWidth(labels: readonly string[], inner: number): number {
	const longest = Math.max(0, ...labels.map((label) => visibleWidth(label)));
	return Math.max(MIN_LEFT, Math.min(longest + LEFT_EXTRA, Math.floor(inner * MAX_LEFT_RATIO)));
}

export function panelWidth(inner: number, left: number): number {
	return Math.max(1, inner - left - DIVIDER_WIDTH);
}

/** How many rows the panel asks for: its title, when it has one, and the tallest content of the question. */
export function panelRows(tallestContent: number, titleRows: number, terminalRows: number): number {
	const cap = Math.max(PANEL_MIN_ROWS, Math.min(PANEL_MAX_ROWS, Math.floor(terminalRows * 0.4)));
	return Math.max(1, Math.min(tallestContent + titleRows, cap));
}

/** Two columns side by side with the rule between them, as tall as the taller and cut at `width`. */
export function mergeColumns(
	left: readonly string[],
	right: readonly string[],
	leftCols: number,
	rule: (text: string) => string,
	width: number,
): string[] {
	const rows = Math.max(left.length, right.length);
	const divider = rule(DIVIDER);
	const out: string[] = [];
	for (let row = 0; row < rows; row++) {
		const cell = truncateToWidth(left[row] ?? "", leftCols, "");
		const pad = " ".repeat(Math.max(0, leftCols - visibleWidth(cell)));
		out.push(truncateToWidth(`${cell}${pad}${divider}${right[row] ?? ""}`, width, ""));
	}
	return out;
}

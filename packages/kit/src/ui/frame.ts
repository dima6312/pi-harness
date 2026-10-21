// The one frame every dialog of the harness wears: a rounded line on the terminal's own background,
// the title and a status in the top edge, the keys in the bottom edge. No surface paints a background,
// so nothing clashes with the terminal's theme. See DESIGN.md.
import type { Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

import { CUT, GLYPH, LINE } from "./glyphs.ts";

/** Columns between a side of the frame and the text. */
export const FRAME_PAD = 2;
/** Columns the frame takes from a row: both sides and their padding. */
export const FRAME_X = 2 + FRAME_PAD * 2;
/** Rows the frame takes: the top and the bottom edge. */
export const FRAME_Y = 2;

export const POINTER = GLYPH.pointer;
const BAR = GLYPH.bar;

/** A key and what it does, as the bottom edge lists them. */
export type KeyHint = readonly [key: string, action: string];

/** A line inside the frame. A selected one gets the bar on the left edge. */
export type FrameLine = string | { text: string; selected?: boolean };

export interface FrameOptions extends BottomOptions {
	title: string;
	/** On the right of the top edge: counts, a step, how far along. */
	status?: string;
	/** A line of tabs under the top edge, ruled off from the body, which the column line meets. */
	tabs?: FrameTabs;
}

export interface FrameTabs {
	titles: readonly string[];
	current: number;
}

export interface BottomOptions {
	/** In the bottom edge, only the ones that do something right now. */
	keys?: readonly KeyHint[];
	/** On the right of the bottom edge: what it cost, where you are. */
	footnote?: string;
	/** A column line inside, this many columns into the text, meeting both edges. */
	split?: number;
	/** The color of the lines. A screen that fills the terminal draws them quieter than a dialog. */
	border?: ThemeColor;
}

/** The text width inside a frame this wide. */
export function frameInner(width: number): number {
	return Math.max(1, width - FRAME_X);
}

export function frame(
	theme: Theme,
	width: number,
	body: readonly FrameLine[],
	options: FrameOptions,
): string[] {
	const title = options.title === "" ? "" : theme.bold(theme.fg("accent", options.title));
	const column = junction(options.split, LINE.teeTop);
	const { tabs } = options;
	const border = options.border ?? "border";
	const top = edge(
		theme,
		border,
		width,
		LINE.topLeft,
		LINE.topRight,
		title,
		options.status ?? "",
		tabs === undefined ? column : undefined,
	);
	const head =
		tabs === undefined
			? []
			: [
					row(theme, border, width, tabsLine(theme, tabs, frameInner(width)), false),
					divider(theme, border, width, column),
				];
	const rows = body.map((line) =>
		typeof line === "string"
			? row(theme, border, width, line, false)
			: row(theme, border, width, line.text, line.selected === true),
	);
	return [top, ...head, ...rows, frameBottom(theme, width, options)];
}

/**
 * The tabs, the current one in the accent. When they do not fit, the ones before the current give way
 * first, so the tab you are on always shows.
 */
function tabsLine(theme: Theme, tabs: FrameTabs, inner: number): string {
	const gap = "   ";
	const drawn = tabs.titles.map((title, index) =>
		index === tabs.current ? theme.fg("accent", theme.bold(title)) : theme.fg("muted", title),
	);
	const more = theme.fg("dim", GLYPH.ellipsisAcross);
	let start = 0;
	const line = () => [...(start > 0 ? [more] : []), ...drawn.slice(start)].join(gap);
	while (start < tabs.current && visibleWidth(line()) > inner) start++;
	return line();
}

/** The rule between the tabs and the body, with the column line starting under it. */
function divider(
	theme: Theme,
	border: ThemeColor,
	width: number,
	column: Junction | undefined,
): string {
	const span = Math.max(0, width - 2);
	const cells: string[] = Array.from({ length: span }, () => LINE.h);
	if (column !== undefined && column.at - 1 < span) cells[column.at - 1] = column.char;
	return theme.fg(border, `${LINE.teeLeft}${cells.join("")}${LINE.teeRight}`);
}

/** The bottom edge on its own, for a screen that draws the rest itself. */
export function frameBottom(theme: Theme, width: number, options: BottomOptions = {}): string {
	const keys = options.keys ?? [];
	// The keys may run under the column when they only all fit there; the column then stops short.
	const wanted = visibleWidth(keyHints(theme, keys));
	const past = options.split === undefined ? 0 : FRAME_PAD + options.split + 2;
	const crowded = wanted <= width - 6 && wanted > width - 6 - past;
	const cross = crowded ? undefined : junction(options.split, LINE.teeBottom);
	// Past the column line when there is one, as the edge places a label that does not fit before it.
	const room = width - 6 - (cross === undefined ? 0 : cross.at + 1);
	const hints = keyHints(theme, fitKeys(theme, keys, room));
	const footnote = options.footnote ?? "";
	const note = visibleWidth(hints) + visibleWidth(footnote) + 3 <= room ? footnote : "";
	const border = options.border ?? "border";
	return edge(theme, border, width, LINE.bottomLeft, LINE.bottomRight, hints, note, cross);
}

/**
 * Whole keys only: when they do not fit, the ones before the last go first, so the way out (the last,
 * by convention `esc`) always shows.
 */
function fitKeys(theme: Theme, keys: readonly KeyHint[], room: number): KeyHint[] {
	const kept = [...keys];
	while (kept.length > 1 && visibleWidth(keyHints(theme, kept)) > room)
		kept.splice(kept.length - 2, 1);
	return kept;
}

/** A row of text, padded to the frame. A selected row gets the accent bar against the left side. */
function row(
	theme: Theme,
	border: ThemeColor,
	width: number,
	text: string,
	selected: boolean,
): string {
	const inner = frameInner(width);
	// The line is measured to pad it anyway, so it is only cut when it does not fit.
	const cells = visibleWidth(text);
	const clipped = cells > inner ? truncateToWidth(text, inner, CUT) : text;
	const shown = cells > inner ? visibleWidth(clipped) : cells;
	const fill = " ".repeat(Math.max(0, inner - shown));
	const side = theme.fg(border, LINE.v);
	const lead = selected
		? `${theme.fg("accent", BAR)}${" ".repeat(FRAME_PAD - 1)}`
		: " ".repeat(FRAME_PAD);
	return `${side}${lead}${clipped}${fill}${" ".repeat(FRAME_PAD)}${side}`;
}

/** A quiet line across the text, for a break inside one part of the frame. */
export function rule(theme: Theme, width: number, note = ""): string {
	const line = (count: number) => theme.fg("borderMuted", LINE.h.repeat(Math.max(0, count)));
	if (note === "") return line(width);
	return `${line(width - visibleWidth(note) - 1)} ${note}`;
}

function keyHints(theme: Theme, keys: readonly KeyHint[]): string {
	return keys
		.map(([key, action]) => `${theme.fg("muted", key)} ${theme.fg("dim", action)}`)
		.join("   ");
}

/** The pointer in front of the selected row, or the room it takes on the others. */
export function pointer(theme: Theme, selected: boolean, active = true): string {
	if (!selected) return "  ";
	return `${theme.fg(active ? "accent" : "dim", POINTER)} `;
}

interface Junction {
	at: number;
	char: string;
}

function junction(split: number | undefined, char: string): Junction | undefined {
	return split === undefined ? undefined : { at: FRAME_PAD + split + 1, char };
}

/**
 * An edge of the frame: the corners, a label after the first, a note before the last, and where a
 * column line meets it. The label sits at the left when it fits before the column line, and right
 * after it when it does not; the note gives way first when room runs out.
 */
function edge(
	theme: Theme,
	color: ThemeColor,
	width: number,
	left: string,
	right: string,
	label: string,
	note: string,
	cross?: Junction,
): string {
	const border = (text: string) => theme.fg(color, text);
	const span = Math.max(0, width - 2);
	const at = cross === undefined || cross.at - 1 >= span ? undefined : cross.at - 1;
	const head = label === "" ? "" : ` ${label} `;
	const before = at === undefined || visibleWidth(head) + 2 <= at;
	const start = before ? 1 : (at ?? 0) + 2;
	const end = before && at !== undefined && note === "" ? at : span - 1;
	const fittedHead = truncateToWidth(head, Math.max(0, end - start), "... ");
	const tail = note === "" ? "" : ` ${note} `;
	const tailStart = span - 1 - visibleWidth(tail);
	const tailFits =
		tail !== "" &&
		tailStart >= start + visibleWidth(fittedHead) &&
		(at === undefined || tailStart > at);

	const cells: string[] = Array.from({ length: span }, () => border(LINE.h));
	if (at !== undefined) cells[at] = border(cross?.char ?? LINE.h);
	const place = (text: string, from: number) => {
		const size = visibleWidth(text);
		if (size === 0) return;
		cells[from] = text;
		for (let index = from + 1; index < from + size; index++) cells[index] = "";
	};
	place(fittedHead, start);
	if (tailFits) place(tail, tailStart);
	return `${border(left)}${cells.join("")}${border(right)}`;
}

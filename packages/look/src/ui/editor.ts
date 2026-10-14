import { skillQueryAt } from "@adeildo/pi-kit";
import { CustomEditor, type KeybindingsManager } from "@earendil-works/pi-coding-agent";
import {
	type EditorTheme,
	type TUI,
	type TuiMouseEvent,
	type TuiMouseEventResult,
	truncateToWidth,
	visibleWidth,
} from "@earendil-works/pi-tui";

import type { Piece } from "../render/fit.ts";
import { BOXES, border } from "../render/frame.ts";
import type { CursorStyle } from "../settings.ts";
import { type Screen, type SlotName, slotPieces } from "./screen.ts";

type WorkingIndicator = Parameters<CustomEditor["setWorkingStatusIndicator"]>[0];

/** Pi calls the border hooks inside its render; these mark where this class draws its own lines. */
const TOP = "\u0000look:top\u0000";
const BOTTOM = "\u0000look:bottom\u0000";
// oxlint-disable-next-line no-control-regex -- pi's software cursor is an escape sequence
const INVERTED_CELL = /\x1b\[7m([\s\S]*?)\x1b\[0m/;
const MIN_WIDTH = 24;
const LEAD_MIN = 10;

const CURSOR_SEQUENCES: Record<CursorStyle, string> = {
	block: "\x1b[0 q",
	bar: "\x1b[6 q",
	underline: "\x1b[4 q",
};

export class LookEditor extends CustomEditor {
	readonly #screen: Screen;
	#indicator: WorkingIndicator;
	#framing = false;
	#hiddenAbove = 0;
	#hiddenBelow = 0;
	#inset = 0;

	constructor(
		tui: TUI,
		theme: EditorTheme,
		keybindings: KeybindingsManager,
		screen: Screen,
		options: { autocompleteMaxVisible?: number } = {},
	) {
		super(tui, theme, keybindings, { ...options, paddingX: 0, embedWorkingStatus: true });
		this.#screen = screen;
	}

	/** The frame owns the horizontal inset, so pi's padding setting would double it. */
	override setPaddingX(_padding: number): void {
		super.setPaddingX(0);
	}

	override setWorkingStatusIndicator(indicator: WorkingIndicator): void {
		super.setWorkingStatusIndicator(indicator);
		this.#indicator = indicator;
		this.tui.requestRender();
	}

	/** Pi opens its palette on `/` only at the start of a message. Further in, `/` lists the skills. */
	override handleInput(data: string): void {
		super.handleInput(data);
		if (data !== "/" || this.isShowingAutocomplete() || !this.#screen.skills()) return;
		const { line, col } = this.getCursor();
		if (skillQueryAt(this.getLines(), line, col) !== undefined) openAutocomplete(this);
	}

	override handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		if (this.#inset === 0) return super.handleMouse(event);
		return super.handleMouse({
			...event,
			x: event.x - this.#inset,
			width: Math.max(1, event.width - 2 * this.#inset),
		});
	}

	protected override renderTopBorder(width: number, hiddenLineCount: number): string {
		if (!this.#framing) return super.renderTopBorder(width, hiddenLineCount);
		this.#hiddenAbove = hiddenLineCount;
		return TOP;
	}

	protected override renderBottomBorder(width: number, hiddenLineCount: number): string {
		if (!this.#framing) return super.renderBottomBorder(width, hiddenLineCount);
		this.#hiddenBelow = hiddenLineCount;
		return BOTTOM;
	}

	override render(width: number): string[] {
		const style = this.#screen.frameStyle();
		if (style === "off" || width < MIN_WIDTH) {
			this.#inset = 0;
			return super.render(width);
		}

		const box = BOXES[style];
		const glyphs = this.#screen.glyphs();
		this.#inset = box.vertical === "" ? 0 : 2;
		const inner = Math.max(1, width - 2 * this.#inset);

		const cursor = this.#screen.cursor();
		// Pi puts its own cursor setting back after a reload, which would hide a bar cursor.
		if (cursor !== "block" && !this.tui.getShowHardwareCursor()) applyCursor(this.tui, cursor);

		this.#framing = true;
		let lines: string[];
		try {
			lines = super.render(inner);
		} finally {
			this.#framing = false;
		}

		const paint = this.#screen.paint((text) => this.borderColor(text));
		const snapshot = this.#screen.snapshot();
		const separator = paint.dim(this.#screen.separator());
		const pieces = (name: SlotName): Piece[] => slotPieces(this.#screen, name, snapshot, paint);
		const scroll = (arrow: string, hidden: number): Piece[] =>
			hidden > 0 ? [{ text: paint.dim(`${arrow} ${hidden} more`), priority: 1000 }] : [];
		const options = { box, paint: paint.frame, separator, ellipsis: glyphs.ellipsis };

		const left = style === "line" ? "" : `${paint.frame(box.vertical)} `;
		const right = style === "line" ? "" : ` ${paint.frame(box.vertical)}`;
		const result: string[] = [];
		let inside = false;

		for (const line of lines) {
			if (line === TOP) {
				const lead =
					this.#indicator === undefined ? undefined : (budget: number) => this.#lead(budget);
				result.push(
					border(
						width,
						pieces("topLeft"),
						[...scroll("↑", this.#hiddenAbove), ...pieces("topRight")],
						{
							...options,
							edge: "top",
							lead,
							leadMin: LEAD_MIN,
						},
					),
				);
				inside = true;
			} else if (line === BOTTOM) {
				result.push(
					border(
						width,
						pieces("bottomLeft"),
						[...scroll("↓", this.#hiddenBelow), ...pieces("bottomRight")],
						{ ...options, edge: "bottom" },
					),
				);
				inside = false;
			} else if (inside) {
				const text = this.#screen.decorate(cursor === "block" ? line : withoutSoftwareCursor(line));
				result.push(`${left}${fill(text, inner)}${right}`);
			} else {
				result.push(`${" ".repeat(this.#inset)}${line}`);
			}
		}

		// Every line here is drawn to the width already, and measuring is cheaper than cutting.
		return result.map((line) =>
			visibleWidth(line) > width ? truncateToWidth(line, width, "") : line,
		);
	}

	#lead(budget: number): string | undefined {
		const indicator = this.#indicator;
		if (indicator === undefined) return undefined;
		const full = indicator.renderInBorder(budget);
		if (visibleWidth(full) > 0 && visibleWidth(full) <= budget) return full;
		return indicator.renderSpinnerInBorder(budget);
	}
}

// The editor keeps the method that opens its list private. Nothing opens if a pi release renames it.
function openAutocomplete(editor: CustomEditor): void {
	const open: unknown = Reflect.get(editor, "tryTriggerAutocomplete");
	if (typeof open === "function") open.call(editor);
}

/** With the terminal's cursor showing, pi's inverted cell would be a second cursor. */
function withoutSoftwareCursor(line: string): string {
	return line.replace(INVERTED_CELL, "$1");
}

function fill(line: string, width: number): string {
	const cells = visibleWidth(line);
	// Measuring is cheap, and cutting a line that already fits is not.
	if (cells <= width) return line + " ".repeat(width - cells);
	const clipped = truncateToWidth(line, width, "");
	return clipped + " ".repeat(Math.max(0, width - visibleWidth(clipped)));
}

export function applyCursor(tui: TUI, style: CursorStyle): void {
	if (style !== "block") tui.setShowHardwareCursor(true);
	tui.terminal.write(CURSOR_SEQUENCES[style]);
}

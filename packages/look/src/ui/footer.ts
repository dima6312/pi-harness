import type { ReadonlyFooterDataProvider } from "@earendil-works/pi-coding-agent";
import { type Component, type TUI, visibleWidth } from "@earendil-works/pi-tui";

import { fitLine, fitRegions, type Piece } from "../render/fit.ts";
import type { Paint } from "../render/paint.ts";
import { type Screen, type SlotName, slotPieces } from "./screen.ts";

const GAP = 3;
/** Room reserved for the strip, so its changing width never moves the right side between lines. */
const STRIP_ROOM = 56;
/**
 * How long the footer and the strip are drawn again without a reason. What they show moves with the
 * clock, the live tokens and the context, and none of that reads differently 100 ms later, while a
 * keystroke always redraws both. Anything that asks for a redraw drops the drawing anyway.
 */
const REDRAW_MS = 100;

/**
 * A drawing kept per width and per revision of the screen for a moment. The transcript draws every
 * entry on every keystroke, and the footer and the strip were built again each time.
 */
class KeptDrawing {
	#drawn: { width: number; revision: number; at: number; lines: string[] } | undefined;

	constructor(
		private readonly screen: Screen,
		private readonly draw: (width: number) => string[],
	) {}

	render(width: number): string[] {
		const now = Date.now();
		const revision = this.screen.revision();
		const drawn = this.#drawn;
		if (
			drawn !== undefined &&
			drawn.width === width &&
			drawn.revision === revision &&
			now - drawn.at < REDRAW_MS
		)
			return drawn.lines;
		const lines = this.draw(width);
		this.#drawn = { width, revision, at: now, lines };
		return lines;
	}

	invalidate(): void {
		this.#drawn = undefined;
	}
}

export function indentOf(screen: Screen): number {
	const style = screen.frameStyle();
	return style === "off" || style === "line" ? 1 : 2;
}

export class StripComponent implements Component {
	readonly #screen: Screen;
	readonly #kept: KeptDrawing;

	constructor(screen: Screen) {
		this.#screen = screen;
		this.#kept = new KeptDrawing(screen, (width) => this.#draw(width));
	}

	render(width: number): string[] {
		return this.#kept.render(width);
	}

	invalidate(): void {
		this.#kept.invalidate();
	}

	#draw(width: number): string[] {
		const screen = this.#screen;
		const indent = indentOf(screen);
		const room = width - indent * 2;
		const pad = (line: string) => (line === "" ? "" : `${" ".repeat(indent)}${line}`);
		const right = slotPieces(screen, "stripRight", screen.snapshot(), screen.paint());
		// Always one line, so the editor does not jump when the first answer arrives.
		if (right.length === 0 || room <= 0) return [pad(renderSlot(screen, "strip", room))];

		const full = fitLine(right, Number.MAX_SAFE_INTEGER, fitOptions(screen, screen.paint()));
		const beside = room - visibleWidth(full) - GAP;
		// Beside the strip, the right side stays whole and the strip gives way.
		if (beside >= STRIP_ROOM) {
			const left = renderSlot(screen, "strip", beside);
			const gap = " ".repeat(Math.max(GAP, room - visibleWidth(left) - visibleWidth(full)));
			return [pad(`${left}${gap}${full}`)];
		}
		return [pad(renderSlot(screen, "strip", room)), pad(renderSlot(screen, "stripRight", room))];
	}
}

export interface FooterHooks {
	attach(data: ReadonlyFooterDataProvider, repaint: () => void): void;
	detach(): void;
}

export class FooterComponent implements Component {
	readonly #screen: Screen;
	readonly #hooks: FooterHooks;
	readonly #stopWatching: () => void;
	readonly #kept: KeptDrawing;

	constructor(tui: TUI, data: ReadonlyFooterDataProvider, screen: Screen, hooks: FooterHooks) {
		this.#screen = screen;
		this.#hooks = hooks;
		this.#kept = new KeptDrawing(screen, (width) => this.#draw(width));
		hooks.attach(data, () => tui.requestRender());
		this.#stopWatching = data.onBranchChange(() => {
			// A new branch is drawn now, not on the next keystroke.
			screen.bump();
			tui.requestRender();
		});
	}

	render(width: number): string[] {
		return this.#kept.render(width);
	}

	invalidate(): void {
		this.#kept.invalidate();
	}

	#draw(width: number): string[] {
		const screen = this.#screen;
		const indent = indentOf(screen);
		const room = width - indent * 2;
		const pad = " ".repeat(indent);
		const lines: string[] = [];

		if (screen.frameStyle() === "off") {
			lines.push(spread(screen, "topLeft", "topRight", room));
			lines.push(spread(screen, "bottomLeft", "bottomRight", room));
		}
		lines.push(spread(screen, "below", "belowRight", room));

		const kept = lines.filter((line) => line !== "").map((line) => `${pad}${line}`);
		return kept.length === 0 ? [""] : kept;
	}

	dispose(): void {
		this.#stopWatching();
		this.#hooks.detach();
	}
}

function renderSlot(screen: Screen, name: SlotName, width: number): string {
	if (width <= 0) return "";
	const paint = screen.paint();
	const pieces = slotPieces(screen, name, screen.snapshot(), paint);
	return fitLine(pieces, width, fitOptions(screen, paint));
}

function spread(screen: Screen, leftSlot: SlotName, rightSlot: SlotName, width: number): string {
	if (width <= 0) return "";
	const paint = screen.paint();
	const snapshot = screen.snapshot();
	const left: Piece[] = slotPieces(screen, leftSlot, snapshot, paint);
	const right: Piece[] = slotPieces(screen, rightSlot, snapshot, paint);
	const [l = "", r = ""] = fitRegions([left, right], width - GAP, fitOptions(screen, paint));
	if (r === "") return l;
	return `${l}${" ".repeat(Math.max(GAP, width - visibleWidth(l) - visibleWidth(r)))}${r}`;
}

function fitOptions(screen: Screen, paint: Paint) {
	return { separator: paint.dim(screen.separator()), ellipsis: screen.glyphs().ellipsis };
}

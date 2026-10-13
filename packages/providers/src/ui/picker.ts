// Our dialogs wear the same frame as the rest of the harness. A host that cannot draw a component,
// like RPC, falls back to pi's own select.
import { frame, frameInner, type KeyHint, oneAtATime } from "@adeildo/pi-kit";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Theme } from "@earendil-works/pi-coding-agent";
import {
	type Component,
	Key,
	matchesKey,
	type TUI,
	truncateToWidth,
	visibleWidth,
} from "@earendil-works/pi-tui";

/** One row of a picker: a label, and a second column on the right. */
export interface PickOption {
	label: string;
	description?: string;
}

const POINTER = "\u276f ";
const KEYS: KeyHint[] = [
	["↑↓", "move"],
	["enter", "select"],
	["esc", "cancel"],
];
const MAX_VISIBLE = 10;
const GAP = 2;
const MIN_DESCRIPTION = 12;

/** Pi draws one dialog in the editor's place; a second one replaces the first without closing it. */
const dialogs = oneAtATime();

/** The options in our frame; undefined when the answer is cancelled. One opens at a time. */
export function pick(
	ctx: ExtensionContext,
	title: string,
	options: readonly (string | PickOption)[],
	dialog: { signal?: AbortSignal } = {},
): Promise<string | undefined> {
	return dialogs(() => shown(ctx, title, options, dialog), dialog.signal).catch((error) => {
		// Cancelled while it waited for another dialog to close.
		if (dialog.signal?.aborted) return undefined;
		throw error;
	});
}

async function shown(
	ctx: ExtensionContext,
	title: string,
	options: readonly (string | PickOption)[],
	dialog: { signal?: AbortSignal } = {},
): Promise<string | undefined> {
	if (options.length === 0) return undefined;
	if (ctx.mode !== "tui" || typeof ctx.ui.custom !== "function") {
		return await ctx.ui.select(title, options.map(plainText), dialog);
	}
	return await ctx.ui.custom<string | undefined>((tui, theme, _keybindings, done) => {
		let finished = false;
		const finish = (value: string | undefined) => {
			if (finished) return;
			finished = true;
			done(value);
		};
		dialog.signal?.addEventListener("abort", () => finish(undefined), { once: true });
		return new FramedSelect(tui, theme, title, options, finish);
	});
}

/** A host that only takes lines gets the two columns on one. */
function plainText(option: string | PickOption): string {
	if (typeof option === "string") return option;
	return option.description === undefined ? option.label : `${option.label}  ${option.description}`;
}

function labelOf(option: string | PickOption): string {
	return typeof option === "string" ? option : option.label;
}

function descriptionOf(option: string | PickOption): string | undefined {
	return typeof option === "string" ? undefined : option.description;
}

export class FramedSelect implements Component {
	private selected = 0;

	constructor(
		private readonly tui: TUI,
		private readonly theme: Theme,
		private readonly title: string,
		private readonly options: readonly (string | PickOption)[],
		private readonly done: (value: string | undefined) => void,
	) {}

	handleInput(data: string): void {
		if (matchesKey(data, Key.up)) this.move(-1);
		else if (matchesKey(data, Key.down)) this.move(1);
		else if (matchesKey(data, Key.home)) this.selected = 0;
		else if (matchesKey(data, Key.end)) this.selected = this.options.length - 1;
		else if (matchesKey(data, Key.enter)) this.choose();
		else if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c"))) this.done(undefined);
		else return;
		this.tui.requestRender();
	}

	invalidate(): void {}

	render(width: number): string[] {
		const inner = frameInner(width);
		const { start, end } = this.window();
		const position =
			start > 0 || end < this.options.length
				? `${this.selected + 1}/${this.options.length}`
				: undefined;
		const rows = this.options.slice(start, end).map((option, index) => ({
			text: this.row(option, start + index, inner),
			selected: start + index === this.selected,
		}));
		return frame(this.theme, width, rows, {
			title: this.title,
			keys: KEYS,
			footnote: position === undefined ? "" : this.theme.fg("dim", position),
		});
	}

	/** One line: the pointer, the label, and the description in a column shared by every row. */
	private row(option: string | PickOption, index: number, inner: number): string {
		const chosen = index === this.selected;
		const pointer = chosen ? this.theme.fg("accent", POINTER) : " ".repeat(POINTER.length);
		const room = Math.max(1, inner - POINTER.length);
		const description = descriptionOf(option);
		if (description === undefined) return `${pointer}${truncateToWidth(labelOf(option), room)}`;

		const column = this.column(room);
		const name = truncateToWidth(
			chosen ? this.theme.bold(labelOf(option)) : labelOf(option),
			column,
		);
		const gap = " ".repeat(Math.max(GAP, column - visibleWidth(name)));
		const rest = truncateToWidth(description, Math.max(0, room - column - gap.length));
		return `${pointer}${name}${gap}${rest}`;
	}

	/** Wide enough for the longest label, and never more than half of the room. */
	private column(room: number): number {
		const widest = Math.max(...this.options.map((option) => visibleWidth(labelOf(option))));
		return Math.min(widest + GAP, Math.max(MIN_DESCRIPTION, Math.floor(room / 2)));
	}

	private window(): { start: number; end: number } {
		const start = Math.max(
			0,
			Math.min(this.selected - Math.floor(MAX_VISIBLE / 2), this.options.length - MAX_VISIBLE),
		);
		return { start, end: Math.min(start + MAX_VISIBLE, this.options.length) };
	}

	private move(step: number): void {
		const count = this.options.length;
		this.selected = (this.selected + step + count) % count;
	}

	private choose(): void {
		const option = this.options[this.selected];
		if (option !== undefined) this.done(labelOf(option));
	}
}

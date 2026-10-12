import { getMarkdownTheme, type Theme } from "@earendil-works/pi-coding-agent";
import type { KeybindingsManager, TUI } from "@earendil-works/pi-tui";

import { QuestionDialog } from "../../packages/ask-questions/src/ui/dialog.ts";
// Opens a dialog and presses keys on it, the way a person at a terminal would.
import type { AskQuestion, AskResult } from "../../packages/kit/src/index.ts";

export const KEYS = {
	up: "\x1b[A",
	down: "\x1b[B",
	right: "\x1b[C",
	enter: "\r",
	tab: "\t",
	space: " ",
} as const;

/** Wide enough for the options and the panel side by side. */
export const WIDTH = 100;

/** A dialog with the focus, on a terminal of `WIDTH` columns and 40 rows. */
export function openDialog(
	theme: Theme,
	questions: readonly AskQuestion[],
	width: number = WIDTH,
	complete: (result: AskResult) => void = () => {},
): QuestionDialog {
	const tui = { requestRender() {}, terminal: { rows: 40, columns: width } } as unknown as TUI;
	const dialog = new QuestionDialog({
		tui,
		theme,
		markdownTheme: getMarkdownTheme(),
		keybindings: { matches: () => false } as unknown as KeybindingsManager,
		questions,
		complete,
	});
	dialog.focused = true;
	return dialog;
}

export function press(dialog: QuestionDialog, ...keys: string[]): void {
	for (const key of keys) dialog.handleInput(key);
}

export function type(dialog: QuestionDialog, text: string): void {
	for (const char of text) dialog.handleInput(char);
}

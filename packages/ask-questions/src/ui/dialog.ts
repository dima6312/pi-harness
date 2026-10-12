import { type AskAnswer, type AskResult, isAnswered } from "@adeildo/pi-kit";
// Drawn inline instead of as an overlay, so a tall dialog scrolls with the terminal.
import { getSelectListTheme, type Theme } from "@earendil-works/pi-coding-agent";
import {
	type Component,
	Editor,
	type Focusable,
	Input,
	Key,
	type KeybindingsManager,
	type MarkdownTheme,
	matchesKey,
	type TUI,
	truncateToWidth,
	visibleWidth,
	wrapTextWithAnsi,
} from "@earendil-works/pi-tui";

import { hasTypedRow, type Option, type Question, TYPED_LABEL } from "../schema.ts";
import { answerBlock, NOTE_MARK } from "./answered.ts";
import {
	bodyRows,
	layoutFor,
	leftWidth,
	MAX_MEASURE,
	mergeColumns,
	panelRows,
	panelWidth,
	questionRows,
} from "./layout.ts";
import { PreviewCache } from "./preview.ts";

const POINTER = "\u276f ";
const RAIL = "\u258e ";
const CHECK = " \u2713";
const ELLIPSIS = "...";
/** The name of the focused row in the panel, and the blank line under it. */
const TITLE_ROWS = 2;
/** The pointer, the number and the gap before a label, in columns. */
const ROW_LEAD = 5;
/** The tick box of a multi-select option, with the space after it. */
const BOX_WIDTH = 4;
/** What can come before a label on a row: the lead, a tick box and the answered mark. */
const ROW_PREFIX = ROW_LEAD + BOX_WIDTH + CHECK.length;
/** What the typed answer asks of the panel while it is still empty. */
const TYPED_NEED = 5;
/** A blank line and the line of the note editor, under the detail of an option. */
const NOTE_EDITOR_ROWS = 2;

/** The rows a body may use, and the rows its panel asks for. */
interface BodySize {
	inner: number;
	wanted: number;
	budget: number;
	/** Whether the panel opens with the name of the focused row. */
	titled: boolean;
}

/** A body with the options on the left and the panel on the right. */
interface BesideSize extends BodySize {
	left: number;
	width: number;
}

interface Draft {
	picked: Set<number>;
	/** How a single choice was answered: an option, or the typed row. */
	via: "option" | "typed" | undefined;
	notes: Input[];
	editor: Editor;
}

export interface QuestionDialogOptions {
	tui: Pick<TUI, "requestRender" | "terminal">;
	theme: Theme;
	markdownTheme: MarkdownTheme;
	keybindings: KeybindingsManager;
	questions: readonly Question[];
	complete: (result: AskResult) => void;
}

export class QuestionDialog implements Component, Focusable {
	private readonly theme: Theme;
	private readonly questions: readonly Question[];
	private readonly drafts: Draft[];
	private readonly previews: PreviewCache;
	private readonly keybindings: KeybindingsManager;
	private readonly tui: Pick<TUI, "requestRender" | "terminal">;
	private readonly complete: (result: AskResult) => void;

	/** The question shown, or `questions.length` for the submit tab. */
	private tab = 0;
	/** The focused row: an option, or `options.length` for the typed row. */
	private row = 0;
	private noting = false;
	private done = false;

	/** Where the panel is scrolled to, for the row it was scrolled on. */
	private panelTop = 0;
	private panelFor = "";
	private panelRoom = 1;
	private overflow = false;

	private focusedFlag = false;
	get focused(): boolean {
		return this.focusedFlag;
	}
	set focused(value: boolean) {
		this.focusedFlag = value;
		this.syncFocus();
	}

	constructor(options: QuestionDialogOptions) {
		this.theme = options.theme;
		this.questions = options.questions;
		this.keybindings = options.keybindings;
		this.previews = new PreviewCache(options.markdownTheme);
		this.tui = options.tui;
		this.complete = options.complete;

		const editorTheme = {
			borderColor: (text: string) => this.theme.fg("borderMuted", text),
			selectList: getSelectListTheme(),
		};
		// The editor reads only requestRender and terminal.rows.
		const tui = options.tui as TUI;
		this.drafts = this.questions.map((question) => {
			const editor = new Editor(tui, editorTheme, { paddingX: 0 });
			editor.onSubmit = (text) => this.submitTyped(text);
			return {
				picked: new Set<number>(),
				via: undefined,
				notes: question.options.map(() => new Input({ prompt: "", placeholder: "" })),
				editor,
			};
		});
	}

	handleInput(data: string): void {
		if (this.done) return;
		try {
			this.dispatch(data);
		} finally {
			this.syncFocus();
			this.tui.requestRender();
		}
	}

	invalidate(): void {
		this.previews.invalidate();
		for (const draft of this.drafts) {
			draft.editor.invalidate();
			for (const input of draft.notes) input.invalidate();
		}
	}

	render(width: number): string[] {
		const inner = Math.max(1, width - 4);
		const lines: string[] = [];
		// The tabs, or a blank line, so the question does not touch the title.
		lines.push(this.questions.length > 1 ? this.tabBar(inner) : "");
		this.overflow = false;
		lines.push(
			...(this.onSubmitTab
				? this.submitLines(inner)
				: this.questionLines(inner, this.tui.terminal.rows)),
		);
		lines.push("", this.hint());
		return this.frame(lines, width, inner, this.title());
	}

	private get onSubmitTab(): boolean {
		return this.tab >= this.questions.length;
	}

	private get question(): Question | undefined {
		return this.questions[this.tab];
	}

	private get draft(): Draft | undefined {
		return this.drafts[this.tab];
	}

	private rowCountOf(question: Question): number {
		return question.options.length + (hasTypedRow(question) ? 1 : 0);
	}

	private get onTypedRow(): boolean {
		const question = this.question;
		return question !== undefined && hasTypedRow(question) && this.row === question.options.length;
	}

	private get rowCount(): number {
		const question = this.question;
		return question === undefined ? 0 : this.rowCountOf(question);
	}

	private syncFocus(): void {
		for (const [index, draft] of this.drafts.entries()) {
			const here = index === this.tab && this.focusedFlag;
			draft.editor.focused = here && this.onTypedRow;
			for (const [row, input] of draft.notes.entries())
				input.focused = here && this.noting && row === this.row;
		}
	}

	private dispatch(data: string): void {
		if (this.onSubmitTab) {
			this.dispatchSubmit(data);
			return;
		}
		if (this.noting) {
			this.dispatchNote(data);
			return;
		}
		if (this.onTypedRow) {
			this.dispatchTyped(data);
			return;
		}

		if (matchesKey(data, Key.escape)) return this.finish(true);
		if (matchesKey(data, Key.up)) return this.move(-1);
		if (matchesKey(data, Key.down)) return this.move(1);
		if (matchesKey(data, Key.pageUp)) return this.scrollPanel(-1);
		if (matchesKey(data, Key.pageDown)) return this.scrollPanel(1);
		if (this.switchTab(data)) return;
		if (matchesKey(data, Key.tab)) {
			this.noting = true;
			return;
		}
		if (data === " " && this.question?.multiSelect) return this.toggle(this.row);
		if (this.isConfirm(data)) return this.confirmOption();

		const number = Number.parseInt(data, 10);
		if (data.length === 1 && number >= 1 && number <= this.rowCount) this.row = number - 1;
	}

	private dispatchNote(data: string): void {
		if (matchesKey(data, Key.escape) || matchesKey(data, Key.tab) || this.isConfirm(data)) {
			this.noting = false;
			return;
		}
		if (matchesKey(data, Key.up) || matchesKey(data, Key.down)) {
			this.move(matchesKey(data, Key.up) ? -1 : 1);
			if (this.onTypedRow) this.noting = false;
			return;
		}
		this.draft?.notes[this.row]?.handleInput(data);
	}

	private dispatchTyped(data: string): void {
		const editor = this.draft?.editor;
		if (editor === undefined) return;
		if (matchesKey(data, Key.escape)) return this.move(-1);
		if (matchesKey(data, Key.up) && editor.getCursor().line === 0) return this.move(-1);
		editor.handleInput(data);
	}

	private dispatchSubmit(data: string): void {
		if (matchesKey(data, Key.escape)) return this.finish(true);
		if (this.switchTab(data)) return;
		if (this.isConfirm(data)) this.finish(false);
	}

	// Pi has two names for enter, and a setup where enter adds a newline rebinds one of them.
	private isConfirm(data: string): boolean {
		return (
			this.keybindings.matches(data, "tui.select.confirm") ||
			this.keybindings.matches(data, "tui.input.submit") ||
			matchesKey(data, Key.enter)
		);
	}

	private switchTab(data: string): boolean {
		const tabs = this.questions.length;
		if (tabs <= 1) return false;
		let delta = 0;
		if (matchesKey(data, Key.right)) delta = 1;
		else if (matchesKey(data, Key.left) || matchesKey(data, Key.shift("tab"))) delta = -1;
		if (delta === 0) return false;
		this.goTo((this.tab + delta + tabs + 1) % (tabs + 1));
		return true;
	}

	private move(delta: number): void {
		this.row = (this.row + delta + this.rowCount) % this.rowCount;
	}

	private scrollPanel(direction: 1 | -1): void {
		this.panelTop += direction * Math.max(1, Math.floor(this.panelRoom / 2));
	}

	private toggle(row: number): void {
		const picked = this.draft?.picked;
		if (picked === undefined) return;
		if (picked.has(row)) picked.delete(row);
		else picked.add(row);
	}

	private confirmOption(): void {
		const draft = this.draft;
		if (draft === undefined) return;
		if (this.question?.multiSelect) {
			if (draft.picked.size === 0) draft.picked.add(this.row);
		} else {
			draft.picked = new Set([this.row]);
			draft.via = "option";
		}
		this.advance();
	}

	private submitTyped(text: string): void {
		const draft = this.draft;
		if (draft === undefined) return;
		const typed = text.trim();
		if (this.question?.multiSelect) {
			if (typed === "" && draft.picked.size === 0) return;
		} else {
			if (typed === "") return;
			draft.picked.clear();
			draft.via = "typed";
		}
		// The editor clears itself on submit.
		draft.editor.setText(typed);
		this.advance();
	}

	private advance(): void {
		if (this.questions.length === 1) return this.finish(false);
		const total = this.questions.length;
		for (let step = 1; step <= total; step++) {
			const next = (this.tab + step) % total;
			if (this.answerOf(next) === undefined) return this.goTo(next);
		}
		this.goTo(total);
	}

	private goTo(tab: number): void {
		this.tab = tab;
		this.noting = false;
		const draft = this.draft;
		const question = this.question;
		if (draft === undefined || question === undefined) return;
		const [first] = draft.picked;
		this.row = draft.via === "typed" ? question.options.length : (first ?? 0);
	}

	private finish(cancelled: boolean): void {
		this.done = true;
		this.complete({ answers: this.collect(), cancelled });
	}

	private collect(): AskAnswer[] {
		const answers: AskAnswer[] = [];
		for (const index of this.questions.keys()) {
			const answer = this.answerOf(index) ?? this.unanswered(index);
			if (answer !== undefined) answers.push(answer);
		}
		return answers;
	}

	/**
	 * What the question has now. Whether it counts as answered comes from what is in it, not from
	 * having pressed enter: a multi-select with ticks is answered even if you moved on with the arrows.
	 */
	private answerOf(index: number): AskAnswer | undefined {
		const question = this.questions[index];
		const draft = this.drafts[index];
		if (question === undefined || draft === undefined) return undefined;

		const picked = question.options
			.filter((_, row) => draft.picked.has(row))
			.map((option) => option.label);
		const answer: AskAnswer = {
			question: question.question,
			header: question.header,
			picked,
			notes: this.notesOf(index),
		};
		const typed = draft.editor.getText().trim();
		if (typed !== "" && (question.multiSelect || draft.via === "typed")) answer.typed = typed;
		return isAnswered(answer) ? answer : undefined;
	}

	private answeredCount(): number {
		return this.questions.filter((_, index) => this.answerOf(index) !== undefined).length;
	}

	private notesOf(index: number): AskAnswer["notes"] {
		const question = this.questions[index];
		const draft = this.drafts[index];
		if (question === undefined || draft === undefined) return [];
		return question.options.flatMap((option, row) => {
			const note = draft.notes[row]?.getValue().trim() ?? "";
			return note === "" ? [] : [{ option: option.label, note }];
		});
	}

	private title(): string {
		if (this.questions.length > 1) return "questions";
		return this.question?.header ?? "question";
	}

	private tabBar(inner: number): string {
		const parts = this.questions.map((question, index) => this.tabLabel(question.header, index));
		parts.push(this.submitLabel());
		const tabs = parts.join(" ");

		const count = this.theme.fg("dim", `${this.answeredCount()}/${this.questions.length}`);
		const gap = inner - visibleWidth(tabs) - visibleWidth(count);
		return gap >= 2 ? `${tabs}${" ".repeat(gap)}${count}` : truncateToWidth(tabs, inner);
	}

	private pill(text: string): string {
		const label = ` ${text} `;
		return this.theme.bg("selectedBg", this.theme.bold(this.theme.fg("accent", label)));
	}

	// A glyph and a color say the same thing, so the state survives a terminal with no color.
	private tabLabel(text: string, index: number): string {
		const done = this.answerOf(index) !== undefined;
		if (index === this.tab) return this.pill(`${done ? "\u2713" : "\u25cf"} ${text}`);
		return done
			? this.theme.fg("success", ` \u2713 ${text} `)
			: this.theme.fg("muted", ` \u25cb ${text} `);
	}

	private submitLabel(): string {
		if (this.onSubmitTab) return this.pill("submit");
		const ready = this.answeredCount() === this.questions.length;
		return ready ? this.theme.fg("success", " \u2713 submit ") : this.theme.fg("dim", " submit ");
	}

	private questionBlock(question: Question, inner: number, terminalRows: number): string[] {
		const rail = this.theme.fg("border", RAIL);
		const wrapped = wrapTextWithAnsi(question.question, Math.max(1, inner - RAIL.length));
		const cap = questionRows(terminalRows);
		const shown =
			wrapped.length > cap
				? [
						...wrapped.slice(0, cap - 1),
						this.theme.fg("dim", `${ELLIPSIS} ${wrapped.length - cap + 1} more lines`),
					]
				: wrapped;
		return shown.map((line) => rail + this.theme.fg("text", line));
	}

	private questionLines(inner: number, terminalRows: number): string[] {
		const question = this.question;
		const draft = this.draft;
		if (question === undefined || draft === undefined) return [];

		const asked = this.questionBlock(question, inner, terminalRows);
		const budget = bodyRows(terminalRows, asked.length);

		const key = `${this.tab}:${this.row}`;
		if (key !== this.panelFor) {
			this.panelFor = key;
			this.panelTop = 0;
		}

		const layout = layoutFor(inner);
		const labels = question.options.map((option) => option.label);
		const left = layout === "beside" ? leftWidth(labels, inner) : inner;
		const width = layout === "beside" ? panelWidth(inner, left) : inner;
		// The panel names the focused row only when the row has to cut its label. It is decided for the
		// whole question, so the panel keeps its shape as the focus moves.
		const titled = labels.some((label) => visibleWidth(label) > left - ROW_PREFIX);
		const titleRows = titled ? TITLE_ROWS : 0;
		const wanted = panelRows(this.tallestPanel(question, draft, width), titleRows, terminalRows);

		const body =
			layout === "beside"
				? this.besideBody(question, draft, { left, width, inner, wanted, budget, titled })
				: this.belowBody(question, draft, { inner, wanted, budget, titled });
		return [...asked, "", ...body];
	}

	private besideBody(question: Question, draft: Draft, size: BesideSize): string[] {
		const options = this.optionLines(question, draft, size.left);
		const rows = Math.min(size.budget, Math.max(options.length, size.wanted));
		const panel = this.panel(question, draft, size.width, rows, size.titled);
		return mergeColumns(
			options,
			panel,
			size.left,
			(text) => this.theme.fg(this.onTypedRow ? "accent" : "borderMuted", text),
			size.inner,
		);
	}

	private belowBody(question: Question, draft: Draft, size: BodySize): string[] {
		const options = this.optionLines(question, draft, size.inner);
		const rows = Math.min(size.wanted, Math.max(1, size.budget - options.length - 1));
		const rule = this.theme.fg("borderMuted", "\u2500".repeat(size.inner));
		return [...options, rule, ...this.panel(question, draft, size.inner, rows, size.titled)];
	}

	/** One line per option, and the typed row last. */
	private optionLines(question: Question, draft: Draft, width: number): string[] {
		const rows = Array.from({ length: this.rowCountOf(question) }, (_, row) => row);
		return rows.map((row) => this.optionRow(question, draft, row, width));
	}

	private rowDone(question: Question, draft: Draft, row: number): boolean {
		if (row === question.options.length) {
			const text = draft.editor.getText().trim();
			return text !== "" && (question.multiSelect === true || draft.via === "typed");
		}
		// A multi-select shows its ticks in the box, so the check mark is for a single choice.
		return !question.multiSelect && draft.picked.has(row) && draft.via === "option";
	}

	/** One line: the pointer, the number, the label, and the note after it, when there is one. */
	private optionRow(question: Question, draft: Draft, row: number, width: number): string {
		const typed = row === question.options.length;
		const label = typed ? TYPED_LABEL : (question.options[row]?.label ?? "");
		const active = row === this.row;
		const done = this.rowDone(question, draft, row);

		const pointer = active ? this.theme.fg("accent", POINTER) : "  ";
		const number = this.theme.fg(active ? "accent" : "dim", String(row + 1));
		const ticked = draft.picked.has(row);
		const box =
			!typed && question.multiSelect
				? `${this.theme.fg(ticked ? "success" : "dim", ticked ? "[x]" : "[ ]")} `
				: "";
		const prefix = ROW_LEAD + (box === "" ? 0 : BOX_WIDTH);

		// The note itself lives in the panel. The row only says there is one, with the same arrow.
		const input = typed ? undefined : draft.notes[row];
		const hasNote = input !== undefined && input.getValue().trim() !== "";
		const marker = hasNote ? ` ${this.theme.fg("warning", NOTE_MARK)}` : "";

		const mark = done ? CHECK.length : 0;
		const labelRoom = Math.max(6, width - prefix - mark - (hasNote ? NOTE_MARK.length + 1 : 0));
		const text = truncateToWidth(label, Math.max(1, labelRoom), ELLIPSIS);
		const styled = active
			? this.theme.bold(this.theme.fg("text", text))
			: this.theme.fg("text", text);
		const check = done ? this.theme.fg("success", CHECK) : "";
		const line = `${pointer}${number}  ${box}${styled}${check}${marker}`;
		return this.focusRow(truncateToWidth(line, width), width, active);
	}

	/** The focused row is filled across the column, so the eye finds it without reading. */
	private focusRow(line: string, width: number, active: boolean): string {
		if (!active) return line;
		const padded = line + " ".repeat(Math.max(0, width - visibleWidth(line)));
		if (typeof this.theme.getBgAnsi !== "function") return this.theme.bg("selectedBg", padded);
		// Truncation and the cursor reset every attribute; the fill is reopened after each reset.
		const open = this.theme.getBgAnsi("selectedBg");
		return `${open}${padded.replaceAll("\x1b[0m", `\x1b[0m${open}`)}\x1b[49m`;
	}

	/** The detail of an option: what it means, then what it looks like. */
	private optionDetail(option: Option, width: number): string[] {
		const lines = wrapTextWithAnsi(
			option.description ?? "",
			Math.max(1, Math.min(width, MAX_MEASURE)),
		).map((line) => this.theme.fg("text", line));
		if (option.preview) {
			if (lines.length > 0) lines.push("");
			lines.push(...this.previews.lines(option.preview, width));
		}
		return lines;
	}

	/**
	 * The panel is as tall as the tallest detail of the question, so moving around cannot resize it.
	 * An option's detail is its description and preview, then its note, or the editor of the note
	 * while you write one.
	 */
	private tallestPanel(question: Question, draft: Draft, width: number): number {
		let tallest = hasTypedRow(question) ? TYPED_NEED : 0;
		for (const [row, option] of question.options.entries()) {
			const detail = this.optionDetail(option, width);
			const written = this.withNotes(detail, this.noteLines(draft, row, width));
			tallest = Math.max(tallest, written.length, detail.length + NOTE_EDITOR_ROWS);
		}
		return tallest;
	}

	/** The detail with the notes under it, separated by a blank line when both exist. */
	private withNotes(detail: string[], notes: string[]): string[] {
		return notes.length === 0 ? detail : [...detail, ...(detail.length > 0 ? [""] : []), ...notes];
	}

	private noteLines(draft: Draft, row: number, width: number): string[] {
		const note = draft.notes[row]?.getValue().trim() ?? "";
		if (note === "") return [];
		const lead = this.theme.fg("warning", `${NOTE_MARK} `);
		return wrapTextWithAnsi(note, Math.max(1, width - 2)).map(
			(line, index) => (index === 0 ? lead : "  ") + this.theme.fg("muted", line),
		);
	}

	private panelContent(question: Question, draft: Draft, width: number): string[] {
		const option = question.options[this.row];
		if (option === undefined) {
			const typed = draft.editor.getText().trim();
			return typed === ""
				? [this.theme.fg("dim", "Write your own answer.")]
				: wrapTextWithAnsi(typed, Math.max(1, width)).map((line) => this.theme.fg("text", line));
		}
		const notes = this.noting ? [] : this.noteLines(draft, this.row, width);
		const lines = this.withNotes(this.optionDetail(option, width), notes);
		return lines.length > 0 ? lines : [this.theme.fg("dim", "No details for this option.")];
	}

	/** `rows` lines: the focused row's name when it has one, then its detail, scrolled when it is longer. */
	private panel(
		question: Question,
		draft: Draft,
		width: number,
		rows: number,
		titled: boolean,
	): string[] {
		const title = question.options[this.row]?.label ?? TYPED_LABEL;
		const out = titled
			? [this.theme.bold(truncateToWidth(title, Math.max(1, width), ELLIPSIS)), ""]
			: [];
		const pinned = this.noting && !this.onTypedRow ? this.noteEditor(draft, width) : [];
		const room = Math.max(1, rows - out.length - pinned.length);
		this.panelRoom = room;

		if (this.onTypedRow) {
			// The answer in your own words is written here, not under the row, so the options stay put.
			out.push(...draft.editor.render(Math.max(1, width)).slice(-room));
		} else {
			const content = this.panelContent(question, draft, width);
			if (content.length <= room) {
				out.push(...content);
			} else {
				const view = Math.max(1, room - 1);
				const last = content.length - view;
				this.panelTop = Math.max(0, Math.min(this.panelTop, last));
				out.push(
					...content.slice(this.panelTop, this.panelTop + view),
					this.theme.fg("dim", `\u2191${this.panelTop} \u2193${last - this.panelTop}`),
				);
				this.overflow = true;
			}
		}
		while (out.length + pinned.length < rows) out.push("");
		return [...out, ...pinned];
	}

	/** The note being written, pinned to the foot of the panel so a long preview cannot push it out. */
	private noteEditor(draft: Draft, width: number): string[] {
		const input = draft.notes[this.row];
		if (input === undefined) return [];
		const lead = this.theme.fg("warning", `${NOTE_MARK} `);
		return ["", lead + (input.render(Math.max(1, width - 2))[0] ?? "")];
	}

	/** The same blocks the transcript keeps, so what you review is what stays. */
	private submitLines(inner: number): string[] {
		const lines = [this.theme.bold("Review your answers"), ""];
		for (const [index, question] of this.questions.entries()) {
			const answer = this.answerOf(index) ?? this.unanswered(index);
			lines.push(...answerBlock(question, answer, this.theme, inner, false));
		}
		const missing = this.questions.length - this.answeredCount();
		if (missing > 0) {
			const word = missing === 1 ? "question goes" : "questions go";
			lines.push("", this.theme.fg("warning", `${missing} ${word} back unanswered.`));
		}
		return lines;
	}

	/** An unanswered question that has notes, so the review shows them. */
	private unanswered(index: number): AskAnswer | undefined {
		const notes = this.notesOf(index);
		const question = this.questions[index];
		if (question === undefined || notes.length === 0) return undefined;
		return { question: question.question, header: question.header, picked: [], notes };
	}

	private hint(): string {
		const keys: [string, string][] = [];
		const tabs = this.questions.length > 1;
		if (this.onSubmitTab) {
			if (tabs) keys.push(["\u2190\u2192", "question"]);
			keys.push(["enter", "submit"], ["esc", "cancel"]);
		} else if (this.noting) {
			keys.push(["type", "a note"], ["\u2191\u2193", "another option"], ["enter", "done"]);
		} else if (this.onTypedRow) {
			keys.push(
				["\u2191", "options"],
				["enter", this.question?.multiSelect ? "confirm" : "answer"],
				["shift+enter", "new line"],
				["esc", "back"],
			);
		} else {
			if (tabs) keys.push(["\u2190\u2192", "question"]);
			keys.push(["\u2191\u2193", "move"]);
			if (this.question?.multiSelect) keys.push(["space", "tick"], ["enter", "confirm"]);
			else keys.push(["enter", "choose"]);
			keys.push(["tab", "note"]);
			if (this.overflow) keys.push(["pgup/pgdn", "scroll"]);
			keys.push(["esc", "cancel"]);
		}
		return keys
			.map(([key, action]) => `${this.theme.fg("muted", key)} ${this.theme.fg("dim", action)}`)
			.join("   ");
	}

	private frame(lines: string[], width: number, inner: number, title: string): string[] {
		const border = (text: string) => this.theme.fg("border", text);
		// 5 columns for "╭─ ", the space after the title, and "╮".
		const room = Math.max(0, width - 5);
		const label = this.theme.fg("accent", truncateToWidth(title, Math.max(0, room - 3), "..."));
		const dashes = Math.max(0, room - visibleWidth(label));
		const out = [
			`${border("\u256d\u2500 ")}${label}${border(` ${"\u2500".repeat(dashes)}\u256e`)}`,
		];
		for (const line of lines) {
			const clipped = truncateToWidth(line, inner);
			const pad = " ".repeat(Math.max(0, inner - visibleWidth(clipped)));
			out.push(`${border("\u2502")} ${clipped}${pad} ${border("\u2502")}`);
		}
		out.push(border(`\u2570${"\u2500".repeat(Math.max(0, width - 2))}\u256f`));
		return out;
	}
}

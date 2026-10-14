import {
	type AskAnswer,
	type AskResult,
	CUT,
	frame,
	frameInner,
	isAnswered,
	type KeyHint,
	GLYPH,
	LINE,
} from "@adeildo/pi-kit";
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
	type TuiMouseEvent,
	type TuiMouseEventResult,
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

const POINTER = `${GLYPH.pointer} `;
const RAIL = "\u258e ";
const CHECK = ` ${GLYPH.check}`;
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
/** The gap and the bar a scrolled panel draws on its right. */
const BAR_WIDTH = 2;
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
	/** The selected option's line in the question, or -1 on the submit tab. */
	private pickedLine = -1;

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

	/** The wheel scrolls a preview taller than the panel. Otherwise it scrolls the transcript. */
	handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		if (this.done || event.type !== "wheel" || !this.overflow) return undefined;
		this.panelTop += event.wheelDelta ?? 0;
		return { handled: true };
	}

	invalidate(): void {
		this.previews.invalidate();
		for (const draft of this.drafts) {
			draft.editor.invalidate();
			for (const input of draft.notes) input.invalidate();
		}
	}

	render(width: number): string[] {
		const inner = frameInner(width);
		const lines: string[] = [];
		// The tabs, or a blank line, so the question does not touch the title.
		lines.push(this.questions.length > 1 ? this.tabBar(inner) : "");
		this.overflow = false;
		this.pickedLine = -1;
		lines.push(
			...(this.onSubmitTab
				? this.submitLines(inner)
				: this.questionLines(inner, this.tui.terminal.rows)),
		);
		const picked = this.pickedLine < 0 ? -1 : this.pickedLine + 1;
		const count =
			this.questions.length > 1
				? this.theme.fg("dim", `${this.answeredCount()}/${this.questions.length}`)
				: "";
		return frame(
			this.theme,
			width,
			lines.map((text, index) => ({ text, selected: index === picked })),
			{ title: this.title(), status: count, keys: this.hint() },
		);
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
		if (this.scrollKey(data)) return;
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
		if (this.scrollKey(data)) return;
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

	/**
	 * Half a panel at a time. Fullscreen pi takes page up and down for the transcript, so shift and
	 * the arrows are the keys that always reach the dialog.
	 */
	private scrollKey(data: string): boolean {
		let direction = 0;
		if (matchesKey(data, Key.shift("up")) || matchesKey(data, Key.pageUp)) direction = -1;
		else if (matchesKey(data, Key.shift("down")) || matchesKey(data, Key.pageDown)) direction = 1;
		if (direction === 0) return false;
		this.panelTop += direction * Math.max(1, Math.floor(this.panelRoom / 2));
		return true;
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
		return truncateToWidth(parts.join("  "), inner);
	}

	/** The tab you are on: in the accent and bold, where the others are quiet. */
	private pill(text: string): string {
		return this.theme.bold(this.theme.fg("accent", ` ${text} `));
	}

	// A glyph and a color say the same thing, so the state survives a terminal with no color.
	private tabLabel(text: string, index: number): string {
		const done = this.answerOf(index) !== undefined;
		if (index === this.tab) return this.pill(`${done ? GLYPH.check : GLYPH.dot} ${text}`);
		return done
			? this.theme.fg("success", ` ${GLYPH.check} ${text} `)
			: this.theme.fg("muted", ` ${GLYPH.ring} ${text} `);
	}

	private submitLabel(): string {
		if (this.onSubmitTab) return this.pill("submit");
		const ready = this.answeredCount() === this.questions.length;
		return ready
			? this.theme.fg("success", ` ${GLYPH.check} submit `)
			: this.theme.fg("dim", " submit ");
	}

	private questionBlock(question: Question, inner: number, terminalRows: number): string[] {
		const rail = this.theme.fg("border", RAIL);
		const wrapped = wrapTextWithAnsi(question.question, Math.max(1, inner - RAIL.length));
		const cap = questionRows(terminalRows);
		const shown =
			wrapped.length > cap
				? [
						...wrapped.slice(0, cap - 1),
						this.theme.fg("dim", `${CUT} ${wrapped.length - cap + 1} more lines`),
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

		const labels = question.options.map((option) => option.label);
		// A drawing is cut when it does not fit, so a question with a wide one shows it under the options.
		const widest = Math.max(
			0,
			...question.options.map((option) => this.previews.widest(option.preview ?? "")),
		);
		const beside =
			layoutFor(inner) === "beside" && widest <= panelWidth(inner, leftWidth(labels, inner));
		const layout = beside ? "beside" : "below";
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
		this.pickedLine = asked.length + 1 + this.row;
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
		const rule = this.theme.fg("borderMuted", LINE.h.repeat(size.inner));
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
		const box = !typed && question.multiSelect ? `${this.checkbox(ticked)} ` : "";
		const prefix = ROW_LEAD + (box === "" ? 0 : BOX_WIDTH);

		// The note itself lives in the panel. The row only says there is one, with the same arrow.
		const input = typed ? undefined : draft.notes[row];
		const hasNote = input !== undefined && input.getValue().trim() !== "";
		const marker = hasNote ? ` ${this.theme.fg("warning", NOTE_MARK)}` : "";

		const mark = done ? CHECK.length : 0;
		const labelRoom = Math.max(6, width - prefix - mark - (hasNote ? NOTE_MARK.length + 1 : 0));
		const text = truncateToWidth(label, Math.max(1, labelRoom));
		const styled = active
			? this.theme.bold(this.theme.fg("text", text))
			: this.theme.fg("text", text);
		const check = done ? this.theme.fg("success", CHECK) : "";
		const line = `${pointer}${number}  ${box}${styled}${check}${marker}`;
		return truncateToWidth(line, width);
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
		if (notes.length === 0) return detail;
		if (detail.length === 0) return notes;
		return [...detail, "", ...notes];
	}

	private checkbox(ticked: boolean): string {
		return ticked ? this.theme.fg("success", "[x]") : this.theme.fg("dim", "[ ]");
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
		const out = titled ? [this.theme.bold(truncateToWidth(title, Math.max(1, width))), ""] : [];
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
				// Drawn again beside the scroll bar, which takes the last columns.
				const barred = this.panelContent(question, draft, Math.max(1, width - BAR_WIDTH));
				const view = Math.max(1, room - 1);
				const last = barred.length - view;
				this.panelTop = Math.max(0, Math.min(this.panelTop, last));
				const shown = barred.slice(this.panelTop, this.panelTop + view);
				out.push(
					...this.withScrollBar(shown, width, barred.length),
					this.scrolled(this.panelTop, last - this.panelTop),
				);
				this.overflow = true;
			}
		}
		while (out.length + pinned.length < rows) out.push("");
		return [...out, ...pinned];
	}

	/** What the panel hides above and below, in words, and the keys that show it. */
	private scrolled(above: number, below: number): string {
		const parts = [];
		if (above > 0) parts.push(`${GLYPH.up} ${above} above`);
		if (below > 0) parts.push(`${GLYPH.down} ${below} below`);
		const keys = this.theme.fg("muted", `shift+${GLYPH.up}${GLYPH.down} or the wheel`);
		return `${this.theme.fg("dim", parts.join("   "))}   ${keys}`;
	}

	/** The lines in view, with a bar on the right whose thumb says where they are in the whole. */
	private withScrollBar(shown: readonly string[], width: number, total: number): string[] {
		const view = shown.length;
		const thumb = Math.max(1, Math.round((view * view) / total));
		const last = Math.max(1, total - view);
		const from = Math.round((this.panelTop / last) * (view - thumb));
		const room = Math.max(1, width - BAR_WIDTH);
		return shown.map((line, index) => {
			const on = index >= from && index < from + thumb;
			const bar = on ? this.theme.fg("accent", LINE.vHeavy) : this.theme.fg("borderMuted", LINE.v);
			const cut = truncateToWidth(line, room);
			return `${cut}${" ".repeat(Math.max(0, room - visibleWidth(cut)))} ${bar}`;
		});
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
			const number = this.questions.length > 1 ? index + 1 : undefined;
			if (index > 0) lines.push("");
			lines.push(...answerBlock(question, answer, this.theme, inner, false, number));
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

	private hint(): KeyHint[] {
		const keys: KeyHint[] = [];
		const tabs = this.questions.length > 1;
		if (this.onSubmitTab) {
			if (tabs) keys.push([`${GLYPH.left}${GLYPH.right}`, "question"]);
			keys.push(["enter", "submit"], ["esc", "cancel"]);
		} else if (this.noting) {
			keys.push(
				["type", "a note"],
				[`${GLYPH.up}${GLYPH.down}`, "another option"],
				["enter", "done"],
			);
		} else if (this.onTypedRow) {
			keys.push(
				[GLYPH.up, "options"],
				["enter", this.question?.multiSelect ? "confirm" : "answer"],
				["shift+enter", "new line"],
				["esc", "back"],
			);
		} else {
			if (tabs) keys.push([`${GLYPH.left}${GLYPH.right}`, "question"]);
			keys.push([`${GLYPH.up}${GLYPH.down}`, "move"]);
			if (this.overflow) keys.push([`shift+${GLYPH.up}${GLYPH.down}`, "scroll"]);
			if (this.question?.multiSelect) keys.push(["space", "tick"], ["enter", "confirm"]);
			else keys.push(["enter", "choose"]);
			keys.push(["tab", "note"], ["esc", "cancel"]);
		}
		return keys;
	}
}

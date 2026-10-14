import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import {
	type Component,
	decodeKittyPrintable,
	Input,
	matchesKey,
	stripTerminalSequences,
	type TUI,
	truncateToWidth,
	visibleWidth,
	wrapTextWithAnsi,
} from "@earendil-works/pi-tui";

import type { RowView } from "../contracts/screen.ts";
import {
	type Control,
	type ControlOption,
	formatValue,
	type Json,
	optionText,
	sameJson,
} from "../control.ts";
import type { Layer } from "../settings/store.ts";
import { frameBottom, type KeyHint } from "../ui/frame.ts";
import { CUT, GLYPH, LINE } from "../ui/glyphs.ts";
import { applyRow, listTabs, runRow } from "./client.ts";
import { keyOf, type Line, type ScreenModel } from "./model.ts";

export type ScreenResult = { kind: "close" } | { kind: "edit"; row: RowView };

export interface ScreenViewOptions {
	tui: TUI;
	theme: Theme;
	events: ExtensionAPI["events"];
	model: ScreenModel;
	done: (result: ScreenResult) => void;
}

interface PickItem {
	value: Json;
	label: string;
	description?: string;
	/** Opens an input or the editor instead of picking a value. */
	opens?: "input" | "edit";
}

interface PickMode {
	kind: "pick";
	row: RowView;
	items: PickItem[];
	index: number;
	current: Json | undefined;
}

interface CheckMode {
	kind: "check";
	row: RowView;
	items: PickItem[];
	checked: Json[];
	index: number;
}

interface InputMode {
	kind: "input";
	row: RowView;
	input: Input;
	error?: string;
}

interface TextMode {
	kind: "text";
	title: string;
	text: string;
	scroll: number;
}

type Mode = { kind: "browse" } | PickMode | CheckMode | InputMode | TextMode;

type Tone = "success" | "error" | "warning" | "muted";

const PANEL = 4;
/** The top edge, the tabs, two dividers, the one over the panel, and the bottom edge with the keys. */
const CHROME = 5 + PANEL;
const MIN_BODY = 6;

export class ScreenView implements Component {
	#options: ScreenViewOptions;
	#mode: Mode = { kind: "browse" };
	#status: { text: string; tone: Tone } | undefined;
	#running = new Set<string>();
	#confirming: string | undefined;
	#scroll = 0;
	#bodyHeight = MIN_BODY;

	constructor(options: ScreenViewOptions) {
		this.#options = options;
	}

	invalidate(): void {}

	handleInput(data: string): void {
		this.#status = undefined;
		if (this.#confirmed(data)) {
			this.#options.tui.requestRender();
			return;
		}
		switch (this.#mode.kind) {
			case "browse":
				this.#browseKey(data);
				break;
			case "pick":
				this.#pickKey(this.#mode, data);
				break;
			case "check":
				this.#checkKey(this.#mode, data);
				break;
			case "input":
				this.#mode.input.handleInput(data);
				break;
			case "text":
				this.#textKey(this.#mode, data);
				break;
		}
		this.#options.tui.requestRender();
	}

	/** A second Enter on the same row runs it. Any other key cancels. */
	#confirmed(data: string): boolean {
		const pending = this.#confirming;
		this.#confirming = undefined;
		if (pending === undefined || !matchesKey(data, "enter")) return false;

		const row = this.#options.model.selected()?.row;
		if (row === undefined || keyOf(row) !== pending) return false;
		this.#run(row);
		return true;
	}

	#browseKey(data: string): void {
		const model = this.#options.model;
		const row = model.selected()?.row;

		if (matchesKey(data, "escape")) {
			if (model.searching) model.setQuery("");
			else this.#options.done({ kind: "close" });
		} else if (matchesKey(data, "ctrl+c")) this.#options.done({ kind: "close" });
		else if (matchesKey(data, "up")) model.move(-1);
		else if (matchesKey(data, "down")) model.move(1);
		else if (matchesKey(data, "pageUp")) model.move(-this.#bodyHeight);
		else if (matchesKey(data, "pageDown")) model.move(this.#bodyHeight);
		else if (matchesKey(data, "home")) model.moveToEdge("first");
		else if (matchesKey(data, "end")) model.moveToEdge("last");
		else if (matchesKey(data, "left")) model.switchTab(-1);
		else if (matchesKey(data, "right")) model.switchTab(1);
		else if (matchesKey(data, "tab")) this.#jumpSection(1);
		else if (matchesKey(data, "shift+tab")) this.#jumpSection(-1);
		else if (matchesKey(data, "enter")) {
			if (row !== undefined) this.#activate(row);
		} else if (matchesKey(data, "delete")) {
			if (row !== undefined) this.#unset(row);
		} else if (matchesKey(data, "backspace")) {
			if (model.searching) model.setQuery(model.query.slice(0, -1));
		} else if (matchesKey(data, "space") && !model.searching) {
			if (row !== undefined) this.#cycle(row);
		} else {
			const typed = printable(data);
			if (typed !== undefined) model.setQuery(model.query + typed);
		}
	}

	/** The section starts at the top, heading and all. */
	#jumpSection(direction: 1 | -1): void {
		const model = this.#options.model;
		model.jumpSection(direction);
		this.#scroll = Math.max(0, model.cursorLine() - 1);
	}

	#pickKey(mode: PickMode, data: string): void {
		if (matchesKey(data, "escape")) this.#mode = { kind: "browse" };
		else if (matchesKey(data, "up")) step(mode, -1);
		else if (matchesKey(data, "down")) step(mode, 1);
		else if (matchesKey(data, "enter")) {
			const item = mode.items[mode.index];
			if (item === undefined) return;
			this.#mode = { kind: "browse" };
			if (item.opens === "input") this.#openInput(mode.row);
			else if (item.opens === "edit") this.#options.done({ kind: "edit", row: mode.row });
			else this.#set(mode.row, item.value);
		}
	}

	#checkKey(mode: CheckMode, data: string): void {
		const item = mode.items[mode.index];
		const at =
			item === undefined ? -1 : mode.checked.findIndex((value) => sameJson(value, item.value));

		if (matchesKey(data, "escape")) this.#mode = { kind: "browse" };
		else if (matchesKey(data, "alt+up") || matchesKey(data, "shift+up")) {
			if (at > 0) this.#swap(mode, at, at - 1);
		} else if (matchesKey(data, "alt+down") || matchesKey(data, "shift+down")) {
			if (at !== -1 && at < mode.checked.length - 1) this.#swap(mode, at, at + 1);
		} else if (matchesKey(data, "up")) step(mode, -1);
		else if (matchesKey(data, "down")) step(mode, 1);
		else if (matchesKey(data, "space") && item !== undefined) {
			if (at === -1) mode.checked.push(item.value);
			else mode.checked.splice(at, 1);
			this.#sortChecks(mode);
		} else if (matchesKey(data, "enter")) {
			this.#mode = { kind: "browse" };
			this.#set(mode.row, mode.checked);
		}
	}

	#textKey(mode: TextMode, data: string): void {
		if (matchesKey(data, "escape") || matchesKey(data, "enter")) this.#mode = { kind: "browse" };
		else if (matchesKey(data, "up")) mode.scroll = Math.max(0, mode.scroll - 1);
		else if (matchesKey(data, "down")) mode.scroll++;
		else if (matchesKey(data, "pageUp")) mode.scroll = Math.max(0, mode.scroll - this.#bodyHeight);
		else if (matchesKey(data, "pageDown")) mode.scroll += this.#bodyHeight;
	}

	#activate(row: RowView): void {
		if (row.kind === "action") {
			if (row.confirm === undefined) this.#run(row);
			else {
				this.#confirming = keyOf(row);
				this.#say(
					`${row.confirm} ${GLYPH.enter} again to confirm, any other key to keep`,
					"warning",
				);
			}
			return;
		}
		const control = row.control;
		if (control === undefined) {
			this.#say("read only", "muted");
			return;
		}
		switch (control.type) {
			case "toggle":
				this.#set(row, row.value !== true);
				return;
			case "choice":
				this.#openPick(row, control.options.map(pickItem), control.custom === true);
				return;
			case "number":
				this.#openInput(row);
				return;
			case "text":
				if (control.presets !== undefined) {
					const items = control.presets.map(pickItem);
					items.push({
						value: null,
						label: "Edit...",
						opens: control.multiline ? "edit" : "input",
					});
					this.#openPick(row, items, false);
				} else if (control.multiline) this.#options.done({ kind: "edit", row });
				else this.#openInput(row);
				return;
			case "list":
				if (control.options === undefined) this.#openInput(row);
				else this.#openCheck(row, control.options);
				return;
		}
	}

	#cycle(row: RowView): void {
		const control = row.control;
		if (control?.type === "toggle") {
			this.#set(row, row.value !== true);
			return;
		}
		if (control?.type === "choice" && control.options.length > 0) {
			const at = control.options.findIndex((option) => sameJson(option.value, row.value));
			const next = control.options[(at + 1) % control.options.length];
			if (next !== undefined) this.#set(row, next.value);
			return;
		}
		this.#activate(row);
	}

	#openPick(row: RowView, items: PickItem[], custom: boolean): void {
		if (custom) items.push({ value: null, label: "Other...", opens: "input" });
		const found = items.findIndex(
			(item) => item.opens === undefined && sameJson(item.value, row.value),
		);
		this.#mode = { kind: "pick", row, items, index: Math.max(0, found), current: row.value };
	}

	#openCheck(row: RowView, options: readonly ControlOption[]): void {
		const checked = Array.isArray(row.value) ? [...row.value] : [];
		const mode: CheckMode = {
			kind: "check",
			row,
			items: options.map(pickItem),
			checked,
			index: 0,
		};
		this.#sortChecks(mode);
		this.#mode = mode;
	}

	#openInput(row: RowView): void {
		const input = new Input();
		input.focused = true;
		input.setValue(inputText(row));
		// setValue leaves the cursor at the start.
		input.handleInput("\u001b[F");
		const mode: InputMode = { kind: "input", row, input };
		input.onEscape = () => {
			this.#mode = { kind: "browse" };
		};
		input.onSubmit = (text) => {
			const parsed = parseInput(row.control, text);
			if ("error" in parsed) {
				mode.error = parsed.error;
				return;
			}
			const error = this.#set(row, parsed.value);
			if (error === undefined) this.#mode = { kind: "browse" };
			else mode.error = error;
		};
		this.#mode = mode;
	}

	#set(row: RowView, value: Json): string | undefined {
		const error = applyRow(this.#options.events, row, "set", value);
		this.#refresh();
		if (error !== undefined) this.#say(error, "error");
		else
			this.#say(`${row.label}: ${row.control ? formatValue(row.control, value) : ""}`, "success");
		return error;
	}

	#unset(row: RowView): void {
		if (row.kind !== "setting") {
			this.#say("nothing to reset", "muted");
			return;
		}
		if (row.layer === "default") {
			this.#say("already the default", "muted");
			return;
		}
		const error = applyRow(this.#options.events, row, "unset");
		this.#refresh();
		if (error !== undefined) this.#say(error, "error");
		else
			this.#say(
				row.layer === "project" ? "dropped the project value" : "back to the default",
				"success",
			);
	}

	#run(row: RowView): void {
		const key = keyOf(row);
		if (this.#running.has(key)) return;
		this.#running.add(key);
		void runRow(this.#options.events, row).then((done) => {
			this.#running.delete(key);
			this.#refresh();
			if (done.error !== undefined) this.#say(done.error, "error");
			else if (done.text !== undefined)
				this.#mode = { kind: "text", title: row.label, text: done.text, scroll: 0 };
			else this.#say(`${row.label}: done`, "success");
			this.#options.tui.requestRender();
		});
	}

	#refresh(): void {
		this.#options.model.refresh(listTabs(this.#options.events));
	}

	#say(text: string, tone: Tone): void {
		this.#status = { text, tone };
	}

	#swap(mode: CheckMode, from: number, to: number): void {
		const moved = mode.checked[from];
		const other = mode.checked[to];
		if (moved === undefined || other === undefined) return;
		mode.checked[from] = other;
		mode.checked[to] = moved;
		this.#sortChecks(mode);
		mode.index = to;
	}

	/** Checked values first, in their order, then the rest as the control lists them. */
	#sortChecks(mode: CheckMode): void {
		const highlighted = mode.items[mode.index]?.value;
		const rank = (item: PickItem): number => {
			const at = mode.checked.findIndex((value) => sameJson(value, item.value));
			return at === -1 ? mode.checked.length + mode.items.indexOf(item) : at;
		};
		mode.items.sort((left, right) => rank(left) - rank(right));
		const found = mode.items.findIndex((item) => sameJson(item.value, highlighted));
		mode.index = Math.max(0, found);
	}

	render(width: number): string[] {
		const { theme, tui } = this.#options;
		const inner = Math.max(20, width - 2);
		const height = Math.max(CHROME + MIN_BODY, tui.terminal.rows);
		this.#bodyHeight = height - CHROME;

		const border = (text: string): string => theme.fg("border", text);
		const frame = (text: string): string =>
			border(LINE.v) + truncateToWidth(text, inner, CUT, true) + border(LINE.v);

		const left = this.#mode.kind === "text" || inner < 50 ? 0 : this.#leftWidth(inner);
		const title = ` ${theme.fg("accent", theme.bold("Settings"))} `;
		const lines = [
			border(`${LINE.topLeft}${LINE.h}`) +
				title +
				border(`${LINE.h.repeat(Math.max(0, inner - 1 - visibleWidth(title)))}${LINE.topRight}`),
			frame(this.#tabsLine(inner)),
			border(divider(LINE.teeLeft, LINE.teeRight, inner, left, LINE.teeTop)),
		];

		const body = this.#body(inner, left);
		for (const line of body) lines.push(frame(line));

		lines.push(border(divider(LINE.teeLeft, LINE.teeRight, inner, left, LINE.teeBottom)));
		for (const line of this.#panel(inner - 2)) lines.push(frame(` ${line}`));
		lines.push(frameBottom(theme, inner + 2, { keys: this.#hints() }));
		return lines;
	}

	#tabsLine(inner: number): string {
		const { theme, model } = this.#options;
		if (model.searching) {
			const count = model.lines().filter((line) => line.kind === "row").length;
			const found = count === 1 ? "1 match" : `${count} matches`;
			return ` ${theme.fg("accent", GLYPH.search)} ${model.query}${theme.inverse(" ")}  ${theme.fg("dim", found)}`;
		}
		const tabs = model.tabs.map((tab, index) =>
			index === model.tab
				? theme.fg("accent", theme.bold(` ${tab.title} `))
				: theme.fg("muted", ` ${tab.title} `),
		);
		const hint = theme.fg("dim", "type to search ");
		const used = visibleWidth(tabs.join(" ")) + 1;
		const gap = Math.max(1, inner - used - visibleWidth(hint));
		return ` ${tabs.join(" ")}${" ".repeat(gap)}${hint}`;
	}

	#leftWidth(inner: number): number {
		const widest = Math.max(
			0,
			...this.#options.model.sections().map((entry) => visibleWidth(entry.title)),
		);
		return Math.min(Math.floor(inner / 3), Math.max(14, widest + 4));
	}

	#body(inner: number, left: number): string[] {
		const mode = this.#mode;
		if (mode.kind === "text") return this.#textBody(mode, inner);

		const right = inner - (left === 0 ? 0 : left + 1);
		const listed =
			mode.kind === "pick" || mode.kind === "check"
				? this.#pickLines(mode, right)
				: this.#rowLines(right);
		const content = this.#withPreview(listed, right);
		const sections = left === 0 ? [] : this.#sectionLines(left);

		const out: string[] = [];
		for (let index = 0; index < this.#bodyHeight; index++) {
			const main = content[index] ?? "";
			if (left === 0) {
				out.push(main);
				continue;
			}
			const side = truncateToWidth(sections[index] ?? "", left, CUT, true);
			out.push(side + this.#options.theme.fg("borderMuted", LINE.v) + main);
		}
		return out;
	}

	/**
	 * The list, and under it what the selected value looks like, when the setting draws one and there
	 * is room left. While picking, the preview follows the highlighted value.
	 */
	#withPreview(listed: string[], width: number): string[] {
		const mode = this.#mode;
		// Only browsing and picking have a highlighted row; the other modes have no preview.
		if (mode.kind !== "browse" && mode.kind !== "pick") return listed;
		const row = mode.kind === "pick" ? mode.row : this.#options.model.selected()?.row;
		if (row?.preview === undefined) return listed;
		const value = mode.kind === "pick" ? mode.items[mode.index]?.value : row.value;
		if (value === undefined) return listed;
		// Under the last row, a blank line apart, so it reads as that list's.
		const used = listed.findLastIndex((line) => visibleWidth(line.trim()) > 0) + 1;
		const preview = row.preview(value, this.#options.theme, Math.max(1, width - 4));
		if (preview.length === 0 || this.#bodyHeight - used - 1 < preview.length) return listed;
		return [...listed.slice(0, used), "", ...preview.map((line) => `  ${line}`)];
	}

	#sectionLines(width: number): string[] {
		const { theme, model } = this.#options;
		return model.sections().map((entry) => {
			const text = truncateToWidth(entry.title, width - 3, CUT);
			return entry.active
				? ` ${theme.fg("accent", `\u25b8 ${theme.bold(text)}`)}`
				: `   ${theme.fg("dim", text)}`;
		});
	}

	#rowLines(width: number): string[] {
		const { theme, model } = this.#options;
		const lines = model.lines();
		if (lines.length === 0) {
			const empty = model.searching ? "nothing matches" : "no settings yet";
			return ["", `  ${theme.fg("dim", empty)}`];
		}

		const height = this.#bodyHeight;
		const cursor = model.cursorLine();
		const focused = inFocus(lines, cursor);
		// The whole section under the cursor when it fits, else as much of it as reaches the cursor.
		const first = focused.indexOf(true);
		const last = focused.lastIndexOf(true);
		const fits = last - first < height;
		const top = fits ? first : cursor;
		const bottom = fits ? last : cursor;
		if (top < this.#scroll) this.#scroll = Math.max(0, top);
		if (bottom >= this.#scroll + height) this.#scroll = bottom - height + 1;
		this.#scroll = Math.min(this.#scroll, Math.max(0, lines.length - height));

		const labelWidth = Math.min(
			Math.floor((width - 6) / 2),
			Math.max(
				12,
				...lines.map((line) =>
					line.kind === "row" ? visibleWidth(line.row.label) + (line.row.indent ?? 0) * 2 : 0,
				),
			) + 2,
		);
		const bar = scrollbar(lines.length, height, this.#scroll);

		const out: string[] = [];
		for (let index = 0; index < height; index++) {
			const at = this.#scroll + index;
			const line = lines[at];
			const text =
				line === undefined ? "" : this.#line(line, at === cursor, focused[at] === true, labelWidth);
			const mark = bar[index];
			const edge = mark === true ? theme.fg("scrollbarThumb", LINE.vHeavy) : " ";
			out.push(truncateToWidth(text, width - 1, CUT, true) + edge);
		}
		return out;
	}

	#line(line: Line, selected: boolean, focused: boolean, labelWidth: number): string {
		const { theme } = this.#options;
		if (line.kind === "heading") return this.#heading(line.title, focused);

		const row = line.row;
		const indent = "  ".repeat(row.indent ?? 0);
		const cursor = selected ? theme.fg("accent", `${GLYPH.pointer} `) : "  ";
		const room = Math.max(1, labelWidth - 1 - visibleWidth(indent));
		const label = truncateToWidth(row.label, room, CUT);
		const pad = " ".repeat(Math.max(1, labelWidth - visibleWidth(indent) - visibleWidth(label)));
		if (!focused) {
			const value = stripTerminalSequences(this.#value(row, false));
			return `  ${cursor}${indent}${theme.fg("dim", label + pad + value)}`;
		}

		const labelText = selected
			? theme.fg("accent", theme.bold(label))
			: theme.fg(row.kind === "info" ? "muted" : "text", label);
		return `  ${cursor}${indent}${labelText}${pad}${this.#value(row, selected)}`;
	}

	#heading(title: string, focused: boolean): string {
		const { theme } = this.#options;
		return `  ${focused ? theme.fg("accent", theme.bold(title)) : theme.fg("dim", title)}`;
	}

	#value(row: RowView, selected: boolean): string {
		const { theme } = this.#options;
		if (row.kind === "action") {
			if (this.#running.has(keyOf(row))) return theme.fg("accent", "running...");
			if (row.text === undefined)
				return theme.fg(selected ? "accent" : "dim", `${GLYPH.enter} run`);
			return (
				theme.fg("muted", row.text) + (selected ? theme.fg("dim", `  ${GLYPH.enter} run`) : "")
			);
		}
		if (row.kind === "info" || row.control === undefined) return theme.fg("dim", row.text ?? "");

		const shown = row.text ?? (formatValue(row.control, row.value) || theme.fg("dim", "(empty)"));
		const color = valueColor(row.layer);
		const value = selected
			? theme.bold(theme.fg(color === "muted" ? "text" : color, shown))
			: theme.fg(color, shown);
		return value + this.#tags(row);
	}

	#tags(row: RowView): string {
		const { theme } = this.#options;

		let tags = "";
		if (row.layer === "project") tags += theme.fg("warning", `  ${GLYPH.diamond} project`);
		if (row.restart === true) tags += theme.fg("dim", `  ${GLYPH.again}`);
		return tags;
	}

	#pickLines(mode: PickMode | CheckMode, width: number): string[] {
		const { theme } = this.#options;
		const out = [this.#heading(mode.row.label, true)];
		const height = this.#bodyHeight - 1;
		const top = Math.max(0, Math.min(mode.index - height + 1, mode.items.length - height));
		// The labels take what the descriptions leave, and never less than half.
		const labelWidth = Math.min(
			widestOf(mode.items.map((item) => item.label)) + 6,
			Math.max(
				Math.floor(width / 2),
				width - widestOf(mode.items.map((item) => item.description)) - 3,
			),
		);

		mode.items.slice(top, top + height).forEach((item, offset) => {
			const index = top + offset;
			const selected = index === mode.index;
			const cursor = selected ? theme.fg("accent", `${GLYPH.pointer} `) : "  ";
			let mark: string;
			if (mode.kind === "check") {
				const at = mode.checked.findIndex((value) => sameJson(value, item.value));
				mark = at === -1 ? theme.fg("dim", "[ ] ") : theme.fg("accent", `[${at + 1}] `);
			} else {
				const current = item.opens === undefined && sameJson(item.value, mode.current);
				mark = current ? theme.fg("accent", `${GLYPH.dot} `) : "  ";
			}
			const text = truncateToWidth(item.label, labelWidth - visibleWidth(mark) - 2, CUT);
			const label = selected ? theme.fg("accent", theme.bold(text)) : theme.fg("text", text);
			const pad = " ".repeat(Math.max(1, labelWidth - visibleWidth(mark) - visibleWidth(text)));
			const description = item.description === undefined ? "" : theme.fg("dim", item.description);
			out.push(` ${cursor}${mark}${label}${pad}${description}`);
		});
		return out;
	}

	#textBody(mode: TextMode, inner: number): string[] {
		const wrapped = mode.text
			.split("\n")
			.flatMap((line) => (line === "" ? [""] : wrapTextWithAnsi(line, inner - 4)));
		const height = this.#bodyHeight - 2;
		mode.scroll = Math.min(mode.scroll, Math.max(0, wrapped.length - height));
		const out = [this.#heading(mode.title, true), ""];
		for (const line of wrapped.slice(mode.scroll, mode.scroll + height)) out.push(`  ${line}`);
		while (out.length < this.#bodyHeight) out.push("");
		return out;
	}

	#panel(width: number): string[] {
		const { theme, model } = this.#options;
		const mode = this.#mode;
		const status = this.#status === undefined ? "" : theme.fg(this.#status.tone, this.#status.text);

		if (mode.kind === "input") {
			const error = mode.error === undefined ? "" : theme.fg("error", mode.error);
			return [
				theme.fg("muted", `${mode.row.label}, new value:`),
				...mode.input.render(width),
				error || theme.fg("dim", inputHint(mode.row.control)),
				"",
			].slice(0, PANEL);
		}

		let description = "";
		let meta = "";
		if (mode.kind === "pick" || mode.kind === "check") {
			description = mode.items[mode.index]?.description ?? mode.row.description;
			meta = mode.kind === "check" ? "[1] shows first" : "";
		} else if (mode.kind === "browse") {
			const row = model.selected()?.row;
			description = row?.description ?? "";
			meta = row === undefined ? "" : rowMeta(row);
		}

		const wrapped = wrapTextWithAnsi(description, width).slice(0, 2);
		while (wrapped.length < 2) wrapped.push("");
		return [...wrapped.map((line) => theme.fg("text", line)), theme.fg("dim", meta), status];
	}

	#hints(): KeyHint[] {
		const mode = this.#mode;
		switch (mode.kind) {
			case "pick":
				return [
					[`${GLYPH.up}${GLYPH.down}`, "move"],
					["enter", "pick"],
					["esc", "back"],
				];
			case "check":
				return [
					[`${GLYPH.up}${GLYPH.down}`, "move"],
					["space", "check"],
					[`alt+${GLYPH.up}${GLYPH.down}`, "reorder"],
					["enter", "save"],
					["esc", "back"],
				];
			case "input":
				return [
					["enter", "save"],
					["esc", "cancel"],
				];
			case "text":
				return [
					[`${GLYPH.up}${GLYPH.down}`, "scroll"],
					["esc", "back"],
				];
			case "browse":
				break;
		}

		const model = this.#options.model;
		const row = model.selected()?.row;
		const keys: KeyHint[] = [[`${GLYPH.up}${GLYPH.down}`, "move"]];
		if (row?.kind === "action") keys.push(["enter", "run"]);
		else if (row?.control?.type === "toggle") keys.push(["enter", "flip"]);
		else if (row?.control !== undefined) keys.push(["enter", "change"]);
		if (row?.control?.type === "choice" && !model.searching) keys.push(["space", "next"]);
		if (row?.kind === "setting" && row.layer === "project")
			keys.push(["del", "drop project value"]);
		else if (row?.kind === "setting" && row.layer === "global") keys.push(["del", "reset"]);
		if (!model.searching) keys.push([`${GLYPH.left}${GLYPH.right}`, "tabs"], ["tab", "section"]);
		keys.push(["esc", model.searching ? "clear search" : "close"]);
		return keys;
	}
}

function divider(start: string, end: string, inner: number, left: number, joint: string): string {
	if (left === 0 || joint === "") return `${start}${LINE.h.repeat(inner)}${end}`;
	return `${start}${LINE.h.repeat(left)}${joint}${LINE.h.repeat(inner - left - 1)}${end}`;
}

/** True for each line of the section the cursor is in, its heading included. */
function inFocus(lines: readonly Line[], cursor: number): boolean[] {
	let section = -1;
	const sections = lines.map((line) => (line.kind === "heading" ? ++section : section));
	const focus = sections[cursor];
	return sections.map((entry) => focus !== undefined && entry === focus);
}

function widestOf(texts: readonly (string | undefined)[]): number {
	return Math.max(0, ...texts.map((text) => visibleWidth(text ?? "")));
}

/** True where the thumb is. Empty when everything fits. */
function scrollbar(total: number, height: number, scroll: number): (boolean | undefined)[] {
	if (total <= height) return [];
	const size = Math.max(1, Math.round((height * height) / total));
	const start = Math.round((scroll / (total - height)) * (height - size));
	return Array.from({ length: height }, (_, index) => index >= start && index < start + size);
}

function rowMeta(row: RowView): string {
	const parts: string[] = [];
	if (row.kind === "setting" && row.control !== undefined) {
		parts.push(row.id);
		const fallback = formatValue(row.control, row.fallback) || "(empty)";
		if (row.layer === "project") {
			const global = formatValue(row.control, row.hidden) || "(empty)";
			parts.push(`this project sets it, global is ${global}`);
		}
		parts.push(`default ${fallback}`);
	} else if (row.kind === "value") parts.push(row.meta ?? "this session only");
	if (row.restart === true) parts.push("applies after /reload");
	return parts.join(", ");
}

function valueColor(layer: Layer | undefined): "accent" | "warning" | "muted" | "text" {
	switch (layer) {
		case "global":
			return "accent";
		case "project":
			return "warning";
		case "default":
			return "muted";
		case undefined:
			return "text";
	}
}

function step(mode: PickMode | CheckMode, delta: number): void {
	mode.index = Math.min(mode.items.length - 1, Math.max(0, mode.index + delta));
}

function pickItem(option: ControlOption): PickItem {
	const item: PickItem = { value: option.value, label: optionText(option) };
	if (option.description !== undefined) item.description = option.description;
	return item;
}

function inputText(row: RowView): string {
	const value = row.value;
	if (value === undefined || value === null) return "";
	if (Array.isArray(value)) return value.join(", ");
	return typeof value === "string" ? value : String(value);
}

function inputHint(control: Control | undefined): string {
	if (control?.type === "number") {
		let range = "a number";
		if (control.min !== undefined && control.max !== undefined)
			range = `from ${control.min} to ${control.max}`;
		else if (control.min !== undefined) range = `${control.min} or more`;
		return control.nullable ? `${range}, or empty for none` : range;
	}
	if (control?.type === "list") return "comma separated";
	return "";
}

function parseInput(
	control: Control | undefined,
	text: string,
): { value: Json } | { error: string } {
	const trimmed = text.trim();
	if (control?.type === "number") {
		if (trimmed === "" && control.nullable) return { value: null };
		const value = Number(trimmed);
		if (trimmed === "" || !Number.isFinite(value)) return { error: "not a number" };
		return { value };
	}
	if (control?.type === "list") {
		return {
			value: trimmed
				.split(",")
				.map((entry) => entry.trim())
				.filter((entry) => entry !== ""),
		};
	}
	return { value: text };
}

function printable(data: string): string | undefined {
	const kitty = decodeKittyPrintable(data);
	if (kitty !== undefined) return kitty;
	if (data.length === 1 && data >= " " && data !== "\u007f") return data;
	return undefined;
}

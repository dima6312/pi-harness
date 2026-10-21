// The picker that makes a room or adds to one, from what is open on this machine. It draws in the
// panel's conversation pane, over the room it was opened from, until it is done or left.
import { basename, isAbsolute, resolve } from "node:path";

import {
	GLYPH,
	type KeyHint,
	type Member,
	pointer,
	rule,
	spread,
	expandHome,
	tildify,
} from "@adeildo/pi-kit";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { Input, Key, matchesKey, wrapTextWithAnsi } from "@earendil-works/pi-tui";

import type { LiveSession, Room, RoomsView } from "../model.ts";

/** One row of the picker: a folder, which brings every session opened there, or one session. */
interface Row {
	key: string;
	member: Member;
	label: string;
	state: string;
	/** The folder a session row sits under, so picking the folder covers it. */
	folder?: string;
}

function folderRow(path: string): Row {
	return {
		key: `f:${path}`,
		member: { folder: path },
		label: tildify(path),
		state: "",
	};
}

export function sessionRow(live: LiveSession): Row {
	return {
		key: `s:${live.session}`,
		member: { session: live.session, cwd: live.cwd },
		label: live.handle ?? "anon",
		state: live.state === "running" ? "working" : "idle",
		folder: live.cwd,
	};
}

export interface PickerOptions {
	theme: Theme;
	view: RoomsView;
	/** The room to add to; a new room when absent. */
	room: Room | undefined;
	/** Rows picked from the start: this session, for a new room. */
	start: Row[];
	requestRender: () => void;
	/** Back to the room, with the room made or added to, or nothing when it was left. */
	done: (room: string | undefined) => void;
}

/**
 * What is open on this machine, by folder, filtered by what you type. A path that nothing is open in
 * yet still links: the folder's row stands alone until a session opens there.
 */
export class Picker {
	focused = false;

	readonly #options: PickerOptions;
	readonly #query = new Input({ prompt: "", placeholder: "" });
	readonly #picked = new Map<string, Row>();
	#cursor = 0;
	/** The name a new room is made with, once the members are picked. */
	#naming: Input | undefined;

	constructor(options: PickerOptions) {
		this.#options = options;
		for (const row of options.start) this.#picked.set(row.key, row);
	}

	invalidate(): void {
		this.#query.invalidate();
		this.#naming?.invalidate();
	}

	handleInput(data: string): void {
		if (this.#naming !== undefined) return this.#nameInput(this.#naming, data);
		const rows = this.#rows();
		if (matchesKey(data, Key.escape)) return this.#options.done(undefined);
		if (matchesKey(data, Key.up)) return this.#move(-1, rows.length);
		if (matchesKey(data, Key.down)) return this.#move(1, rows.length);
		if (data === " ") return this.#toggle(rows[this.#cursor]);
		if (matchesKey(data, Key.enter)) return this.#submit(rows[this.#cursor]);
		this.#query.handleInput(data);
		this.#cursor = 0;
		this.#options.requestRender();
	}

	#nameInput(naming: Input, data: string): void {
		if (matchesKey(data, Key.escape)) {
			this.#naming = undefined;
			return this.#options.requestRender();
		}
		if (matchesKey(data, Key.enter)) {
			const name = naming.getValue().trim();
			if (name === "") return;
			return this.#options.done(this.#options.view.create(name, this.#members()));
		}
		naming.handleInput(data);
		this.#options.requestRender();
	}

	title(): string {
		const { room } = this.#options;
		return room === undefined ? "New room" : `Add to ${room.name}`;
	}

	keys(): KeyHint[] {
		if (this.#naming !== undefined)
			return [
				["enter", "make it"],
				["esc", "back"],
			];
		return [
			[`${GLYPH.up}${GLYPH.down}`, "move"],
			["space", "pick"],
			["enter", this.#options.room === undefined ? "next" : "add"],
			["esc", "back"],
		];
	}

	/** The pane's lines: what you type, then what is open, or the name once the members are picked. */
	lines(width: number, height: number): string[] {
		const { theme } = this.#options;
		if (this.#naming !== undefined) return this.#nameLines(this.#naming, width);
		this.#query.focused = this.focused;
		const rows = this.#rows();
		this.#cursor = Math.max(0, Math.min(this.#cursor, rows.length - 1));
		const label = "folder or name";
		const [query = ""] = this.#query.render(Math.max(1, width - label.length - 2));
		const picked = this.#picked.size;
		const lines = [
			theme.fg("accent", theme.bold(this.title())),
			"",
			`${theme.fg("muted", label)}  ${query}`,
			rule(theme, width, picked === 0 ? "" : theme.fg("muted", `${picked} picked`)),
		];
		if (rows.length === 0)
			return [
				...lines,
				...wrapped(
					theme,
					"Nothing open matches. Type a folder's path to link it before a session opens there.",
					width,
				),
			];
		const listed = rows.map((row, index) => this.#row(row, index === this.#cursor, width));
		return [...lines, ...scrolled(listed, this.#cursor, Math.max(1, height - lines.length)).lines];
	}

	#nameLines(naming: Input, width: number): string[] {
		const { theme } = this.#options;
		naming.focused = this.focused;
		const [name = ""] = naming.render(Math.max(1, width - "name  ".length));
		const who = [...this.#picked.values()].map((row) => row.label).join(", ");
		return [
			theme.fg("accent", theme.bold(this.title())),
			"",
			`${theme.fg("muted", "name")}  ${name}`,
			"",
			...wrapped(theme, `with ${who}`, width),
		];
	}

	#row(row: Row, chosen: boolean, width: number): string {
		const { theme } = this.#options;
		const covered = row.folder !== undefined && this.#picked.has(`f:${row.folder}`);
		const picked = covered || this.#picked.has(row.key);
		const mark = picked ? theme.fg("accent", GLYPH.dot) : theme.fg("dim", GLYPH.ring);
		const label = chosen ? theme.bold(row.label) : row.label;
		if (row.folder === undefined)
			return spread(
				`${pointer(theme, chosen)}${mark} ${label}`,
				theme.fg("dim", "the folder, every session in it"),
				width,
			);
		const note = covered ? "with the folder" : "only this session";
		return spread(
			`${pointer(theme, chosen)}    ${mark} ${label}  ${theme.fg("dim", row.state)}`,
			theme.fg("dim", note),
			width,
		);
	}

	/** Each folder open on the machine and its sessions, those already in the room left out. */
	#rows(): Row[] {
		const { view, room } = this.#options;
		const typed = this.#query.getValue().trim();
		const query = typed.toLowerCase();
		const inFolders = new Set(room?.folders.map((folder) => folder.path));
		const inSessions = new Set(room?.sessions.map((session) => session.session));
		const byFolder = new Map<string, LiveSession[]>();
		for (const live of view.live()) {
			if (inFolders.has(live.cwd) || inSessions.has(live.session)) continue;
			byFolder.set(live.cwd, [...(byFolder.get(live.cwd) ?? []), live]);
		}
		const rows: Row[] = [];
		for (const [path, sessions] of byFolder) {
			const folderMatches = query === "" || tildify(path).toLowerCase().includes(query);
			const matching = sessions.filter(
				(live) =>
					folderMatches ||
					(live.handle ?? "").toLowerCase().includes(query) ||
					(live.title ?? "").toLowerCase().includes(query),
			);
			if (matching.length === 0) continue;
			rows.push(folderRow(path), ...matching.map(sessionRow));
		}
		const path = pathOf(typed);
		if (path !== undefined && !byFolder.has(path) && !inFolders.has(path))
			rows.push(folderRow(path));
		return rows;
	}

	#toggle(row: Row | undefined): void {
		if (row === undefined) return;
		if (this.#picked.has(row.key)) this.#picked.delete(row.key);
		else this.#picked.set(row.key, row);
		this.#options.requestRender();
	}

	/** Enter with nothing picked takes the row under the cursor. */
	#submit(row: Row | undefined): void {
		if (this.#picked.size === 0 && row !== undefined) this.#picked.set(row.key, row);
		if (this.#picked.size === 0) return;
		const { room, view } = this.#options;
		if (room?.id !== undefined) {
			view.add(room.id, this.#members());
			return this.#options.done(room.id);
		}
		this.#naming = new Input({ prompt: "", placeholder: "" });
		this.#naming.setValue(this.#suggestedName());
		this.#options.requestRender();
	}

	/** The members picked, a session left out when its folder is picked too. */
	#members(): Member[] {
		const rows = [...this.#picked.values()];
		return rows
			.filter((row) => row.folder === undefined || !this.#picked.has(`f:${row.folder}`))
			.map((row) => row.member);
	}

	/** The folders the members come from, joined by `+`, like `backend+frontend`. */
	#suggestedName(): string {
		const folders = this.#members().map((member) =>
			basename("folder" in member ? member.folder : member.cwd),
		);
		return [...new Set(folders)].toSorted().join("+");
	}

	#move(delta: number, count: number): void {
		if (count === 0) return;
		this.#cursor = (this.#cursor + delta + count) % count;
		this.#options.requestRender();
	}
}

/** What you typed, read as a folder's path when it looks like one. */
function pathOf(query: string): string | undefined {
	const path = expandHome(query);
	return isAbsolute(path) ? resolve(path) : undefined;
}

export function wrapped(theme: Theme, text: string, width: number): string[] {
	return wrapTextWithAnsi(text, width).map((line) => theme.fg("dim", line));
}

/** The lines that fit, keeping one in view, and where they start. */
export function scrolled(
	lines: readonly string[],
	keep: number,
	height: number,
): { lines: string[]; start: number } {
	if (lines.length <= height) return { lines: [...lines], start: 0 };
	const start = Math.max(0, Math.min(keep - Math.floor(height / 2), lines.length - height));
	return { lines: lines.slice(start, start + height), start };
}

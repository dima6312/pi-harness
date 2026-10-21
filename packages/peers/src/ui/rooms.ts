// The `rooms` tab of the panel: the rooms this session is in, who is in the selected one and how it
// came to be, and the picker that makes a room or adds to one from what is open on this machine.
import { homedir } from "node:os";
import { basename, resolve } from "node:path";

import {
	FRAME_X,
	FRAME_Y,
	type FrameLine,
	type FrameTabs,
	frame,
	GLYPH,
	type KeyHint,
	LINE,
	type Member,
	pointer,
	rule,
	spread,
} from "@adeildo/pi-kit";
import type { Theme } from "@earendil-works/pi-coding-agent";
import {
	type Component,
	type Focusable,
	Input,
	Key,
	matchesKey,
	truncateToWidth,
	visibleWidth,
	wrapTextWithAnsi,
} from "@earendil-works/pi-tui";

import type { LiveSession, Room, RoomSession, RoomsView } from "../model.ts";

/** The top edge, the tabs and their rule, and the bottom edge. */
const CHROME_Y = FRAME_Y + 2;
const ROOMS_MIN = 24;
const ROOMS_MAX = 34;
const BESIDE = 70;

type Pane = "rooms" | "members";

export interface RoomsTabOptions {
	theme: Theme;
	view: RoomsView;
	/** This session, which a new room starts with. */
	session: string;
	title: string;
	tabs: { line: () => FrameTabs; switch: (delta: number) => void };
	close: () => void;
	requestRender: () => void;
	rows: () => number;
}

export class RoomsTab implements Component, Focusable {
	focused = false;

	readonly #options: RoomsTabOptions;
	#pane: Pane = "rooms";
	#selected = 0;
	#member = 0;
	/** The room `x` asked about, waiting on `y`. */
	#closing: string | undefined;
	#picker: Picker | undefined;

	constructor(options: RoomsTabOptions) {
		this.#options = options;
	}

	invalidate(): void {
		this.#picker?.invalidate();
	}

	handleInput(data: string): void {
		if (matchesKey(data, Key.alt("g"))) return this.#options.close();
		if (this.#picker !== undefined) return this.#picker.handleInput(data);
		if (this.#closing !== undefined) return this.#confirmInput(data);
		if (matchesKey(data, Key.left)) return this.#options.tabs.switch(-1);
		if (matchesKey(data, Key.right)) return this.#options.tabs.switch(1);
		if (matchesKey(data, Key.tab)) return this.#focus(this.#pane === "rooms" ? "members" : "rooms");
		if (this.#pane === "members") return this.#membersInput(data);
		this.#roomsInput(data);
	}

	#roomsInput(data: string): void {
		const room = this.#room();
		const shared = room?.id;
		if (matchesKey(data, Key.escape)) return this.#options.close();
		if (matchesKey(data, Key.up)) return this.#move(-1);
		if (matchesKey(data, Key.down)) return this.#move(1);
		if (data === "n") return this.#pick(undefined);
		if (shared === undefined || room === undefined) return;
		if (data === "a") return this.#pick(room);
		if (data === "l") return this.#act(() => this.#options.view.leave(shared));
		if (data === "x") {
			this.#closing = shared;
			this.#options.requestRender();
		}
	}

	#membersInput(data: string): void {
		const room = this.#room();
		const members = room === undefined ? [] : membersOf(room);
		if (matchesKey(data, Key.escape)) return this.#focus("rooms");
		if (matchesKey(data, Key.up)) return this.#moveMember(-1, members.length);
		if (matchesKey(data, Key.down)) return this.#moveMember(1, members.length);
		const member = members[this.#member];
		const shared = room?.id;
		if (data === "r" && shared !== undefined && member !== undefined)
			this.#act(() => this.#options.view.remove(shared, member.member));
	}

	#confirmInput(data: string): void {
		const room = this.#closing;
		this.#closing = undefined;
		if (room !== undefined && data === "y") return this.#act(() => this.#options.view.close(room));
		this.#options.requestRender();
	}

	render(width: number): string[] {
		if (this.#picker !== undefined) {
			this.#picker.focused = this.focused;
			return this.#picker.render(width);
		}
		const { theme } = this.#options;
		const rooms = this.#options.view.rooms();
		this.#selected = Math.max(0, Math.min(this.#selected, rooms.length - 1));
		const room = rooms[this.#selected];
		const members = room === undefined ? [] : membersOf(room);
		this.#member = Math.max(0, Math.min(this.#member, members.length - 1));

		const inner = Math.max(20, width - FRAME_X);
		const height = Math.max(4, this.#options.rows() - CHROME_Y);
		const beside = inner >= BESIDE;
		const left = beside
			? Math.max(ROOMS_MIN, Math.min(ROOMS_MAX, Math.floor(inner * 0.35)))
			: inner;
		const right = beside ? inner - left - 3 : inner;

		const list = this.#roomLines(rooms, left);
		const detail = room === undefined ? [] : this.#memberLines(room, members, right);

		const body: FrameLine[] = [];
		if (beside) {
			const column = theme.fg("borderMuted", LINE.v);
			const shown = scrolled(list.lines, list.selectedAt, height);
			for (let line = 0; line < height; line++) {
				const text = truncateToWidth(shown.lines[line] ?? "", left, "");
				const gap = " ".repeat(Math.max(0, left - visibleWidth(text)));
				body.push({
					text: `${text}${gap} ${column} ${detail[line] ?? ""}`,
					selected: line === list.selectedAt - shown.start && this.#pane === "rooms",
				});
			}
		} else {
			// One over the other, the rooms get at most half, and the members what is left.
			const shown = scrolled(list.lines, list.selectedAt, Math.floor(height / 2));
			for (const [line, text] of shown.lines.entries())
				body.push({
					text,
					selected: line === list.selectedAt - shown.start && this.#pane === "rooms",
				});
			body.push(rule(theme, inner));
			body.push(...detail.slice(0, Math.max(0, height - shown.lines.length - 1)));
		}
		return frame(theme, width, body, {
			title: this.#options.title,
			tabs: this.#options.tabs.line(),
			status: this.#status(rooms.length),
			keys: this.#keys(room, members),
			split: beside ? left + 1 : undefined,
		});
	}

	#status(count: number): string {
		const { theme } = this.#options;
		const closing =
			this.#closing === undefined
				? undefined
				: this.#options.view.rooms().find((room) => room.id === this.#closing);
		if (closing !== undefined) return theme.fg("warning", `close ${closing.name}?`);
		return theme.fg("dim", count === 1 ? "1 room" : `${count} rooms`);
	}

	/** Each room, and under it who it counts. The folder's room says it is always there. */
	#roomLines(rooms: readonly Room[], width: number): { lines: string[]; selectedAt: number } {
		const { theme } = this.#options;
		const lines: string[] = [];
		let selectedAt = 0;
		for (const [index, room] of rooms.entries()) {
			const selected = index === this.#selected;
			if (selected) selectedAt = lines.length;
			const name = selected ? theme.bold(room.name) : room.name;
			lines.push(`${pointer(theme, selected, this.#pane === "rooms")}${name}`);
			lines.push(theme.fg("dim", truncateToWidth(`    ${countsOf(room)}`, width, "")));
		}
		if (rooms.length === 1)
			lines.push("", theme.fg("dim", "n makes a room with"), theme.fg("dim", "another folder."));
		return { lines, selectedAt };
	}

	/** Who is in the room, folders first, then how it came to be. */
	#memberLines(room: Room, members: readonly Listed[], width: number): string[] {
		const { theme } = this.#options;
		const lines: string[] = [];
		const heading = (text: string) =>
			this.#pane === "members" ? theme.fg("accent", theme.bold(text)) : theme.fg("muted", text);
		const row = (listed: Listed, index: number) => {
			const chosen = this.#pane === "members" && index === this.#member;
			const left = `${pointer(theme, chosen)}${chosen ? theme.bold(listed.name) : listed.name}`;
			return spread(left, listed.state, width);
		};
		const folders = members.filter((listed) => "folder" in listed.member);
		const sessions = members.filter((listed) => "session" in listed.member);
		if (folders.length > 0) lines.push(heading("Folders"), ...folders.map(row));
		if (sessions.length > 0)
			lines.push(
				heading("Sessions"),
				...sessions.map((listed, index) => row(listed, folders.length + index)),
			);
		if (room.id === undefined)
			lines.push("", ...wrapped(theme, "Every session opened here is in this room.", width));
		if (room.origin !== undefined)
			lines.push(rule(theme, width), ...wrapped(theme, room.origin, width));
		return lines;
	}

	#keys(room: Room | undefined, members: readonly Listed[]): KeyHint[] {
		if (this.#closing !== undefined)
			return [
				["y", "close it"],
				["esc", "keep it"],
			];
		const shared = room?.id !== undefined;
		if (this.#pane === "members") {
			const keys: KeyHint[] = [[`${GLYPH.up}${GLYPH.down}`, "pick"]];
			if (shared && members.length > 0) keys.push(["r", "remove"]);
			keys.push(["tab", "rooms"], ["esc", "back"]);
			return keys;
		}
		const keys: KeyHint[] = [
			[`${GLYPH.up}${GLYPH.down}`, "pick"],
			["n", "new"],
		];
		if (shared) keys.push(["a", "add"], ["l", "leave"], ["x", "close"]);
		keys.push(["tab", "members"], ["esc", "close"]);
		return keys;
	}

	#room(): Room | undefined {
		return this.#options.view.rooms()[this.#selected];
	}

	/** The picker over the tab: for a new room when `room` is absent, else to add to it. */
	#pick(room: Room | undefined): void {
		const { theme, view, session } = this.#options;
		const me = view.live().find((live) => live.session === session);
		this.#picker = new Picker({
			theme,
			view,
			room,
			start: room === undefined && me !== undefined ? [sessionRow(me)] : [],
			rows: this.#options.rows,
			requestRender: this.#options.requestRender,
			done: (made) => {
				this.#picker = undefined;
				if (made !== undefined) this.#selectRoom(made);
				this.#options.requestRender();
			},
		});
		this.#options.requestRender();
	}

	#selectRoom(id: string): void {
		const at = this.#options.view.rooms().findIndex((room) => room.id === id);
		if (at >= 0) this.#selected = at;
	}

	#act(change: () => void): void {
		change();
		this.#options.requestRender();
	}

	#focus(pane: Pane): void {
		this.#pane = pane;
		this.#options.requestRender();
	}

	#move(delta: number): void {
		const count = this.#options.view.rooms().length;
		if (count === 0) return;
		this.#selected = (this.#selected + delta + count) % count;
		this.#member = 0;
		this.#options.requestRender();
	}

	#moveMember(delta: number, count: number): void {
		if (count === 0) return;
		this.#member = (this.#member + delta + count) % count;
		this.#options.requestRender();
	}
}

/** A member as the tab lists it. */
interface Listed {
	member: Member;
	name: string;
	state: string;
}

function membersOf(room: Room): Listed[] {
	return [
		...room.folders.map((folder): Listed => ({
			member: { folder: folder.path },
			name: home(folder.path),
			state: folder.open === 0 ? "none open" : `${folder.open} open`,
		})),
		...room.sessions.map((session): Listed => ({
			member: { session: session.session, cwd: session.cwd },
			name: `${session.handle ?? "anon"} \u00b7 ${basename(session.cwd)}`,
			state: stateWord(session.state),
		})),
	];
}

function countsOf(room: Room): string {
	if (room.id === undefined) return "this folder, always";
	const parts: string[] = [];
	if (room.folders.length > 0) parts.push(plural(room.folders.length, "folder"));
	if (room.sessions.length > 0) parts.push(plural(room.sessions.length, "session"));
	return parts.length === 0 ? "nobody yet" : parts.join(", ");
}

function stateWord(state: RoomSession["state"]): string {
	switch (state) {
		case "running":
			return "working";
		case "idle":
			return "idle";
		case "closed":
			return "not open";
	}
}

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
		label: home(path),
		state: "",
	};
}

function sessionRow(live: LiveSession): Row {
	return {
		key: `s:${live.session}`,
		member: { session: live.session, cwd: live.cwd },
		label: live.handle ?? "anon",
		state: live.state === "running" ? "working" : "idle",
		folder: live.cwd,
	};
}

interface PickerOptions {
	theme: Theme;
	view: RoomsView;
	/** The room to add to; a new room when absent. */
	room: Room | undefined;
	/** Rows picked from the start: this session, for a new room. */
	start: Row[];
	rows: () => number;
	requestRender: () => void;
	/** Back to the tab, with the room made or added to, or nothing when it was left. */
	done: (room: string | undefined) => void;
}

/**
 * What is open on this machine, by folder, filtered by what you type. A path that nothing is open in
 * yet still links: the folder's row stands alone until a session opens there.
 */
class Picker implements Component, Focusable {
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

	render(width: number): string[] {
		const { theme, room } = this.#options;
		const inner = Math.max(20, width - FRAME_X);
		const title = room === undefined ? "New room" : `Add to ${room.name}`;
		if (this.#naming !== undefined) return this.#renderName(this.#naming, width, inner);
		this.#query.focused = this.focused;
		const rows = this.#rows();
		this.#cursor = Math.max(0, Math.min(this.#cursor, rows.length - 1));
		const height = Math.max(3, this.#options.rows() - FRAME_Y - 2);
		const label = "folder or name:";
		const [query = ""] = this.#query.render(Math.max(1, inner - label.length - 1));
		const lines = rows.map((row, index) => this.#row(row, index === this.#cursor, inner));
		const shown = scrolled(lines, this.#cursor, height);
		const body: FrameLine[] = [
			`${theme.fg("muted", label)} ${query}`,
			rule(theme, inner, theme.fg("dim", "open on this machine")),
		];
		if (rows.length === 0)
			body.push(
				...wrapped(
					theme,
					"Nothing open matches. Type a folder's path to link it before a session opens there.",
					inner,
				),
			);
		for (const [line, text] of shown.lines.entries())
			body.push({ text, selected: line === this.#cursor - shown.start });
		const picked = this.#picked.size;
		return frame(theme, width, body, {
			title,
			status: picked === 0 ? "" : theme.fg("muted", `${picked} picked`),
			keys: [
				[`${GLYPH.up}${GLYPH.down}`, "move"],
				["space", "pick"],
				["enter", room === undefined ? "next" : "add"],
				["esc", "back"],
			],
		});
	}

	#renderName(naming: Input, width: number, inner: number): string[] {
		const { theme } = this.#options;
		naming.focused = this.focused;
		const [name = ""] = naming.render(Math.max(1, inner - "name: ".length));
		const who = [...this.#picked.values()].map((row) => row.label).join(", ");
		return frame(
			theme,
			width,
			[`${theme.fg("muted", "name:")} ${name}`, "", ...wrapped(theme, `with ${who}`, inner)],
			{
				title: "New room",
				keys: [
					["enter", "make it"],
					["esc", "back"],
				],
			},
		);
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
			const folderMatches = query === "" || home(path).toLowerCase().includes(query);
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
	if (query.startsWith("~")) return resolve(homedir(), query.slice(1).replace(/^\//, ""));
	if (query.startsWith("/")) return resolve(query);
	return undefined;
}

function home(path: string): string {
	const root = homedir();
	if (path === root) return "~";
	return path.startsWith(`${root}/`) ? `~${path.slice(root.length)}` : path;
}

function plural(count: number, word: string): string {
	return `${count} ${word}${count === 1 ? "" : "s"}`;
}

function wrapped(theme: Theme, text: string, width: number): string[] {
	return wrapTextWithAnsi(text, width).map((line) => theme.fg("dim", line));
}

/** The lines that fit, keeping one in view, and where they start. */
function scrolled(
	lines: readonly string[],
	keep: number,
	height: number,
): { lines: string[]; start: number } {
	if (lines.length <= height) return { lines: [...lines], start: 0 };
	const start = Math.max(0, Math.min(keep - Math.floor(height / 2), lines.length - height));
	return { lines: lines.slice(start, start + height), start };
}

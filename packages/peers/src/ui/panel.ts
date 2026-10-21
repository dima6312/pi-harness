// The `Alt+R` panel, over the whole screen. On the left, the rooms this session is in, the folder's
// first, with the open one's agents under its name. On the right, the open room's conversation and the
// line you write in. The two sides never move or change width, whatever is open, so switching rooms
// only changes what is in them.
import {
	FRAME_X,
	FRAME_Y,
	type FrameLine,
	frame,
	GLYPH,
	hideImagesUnderOverlays,
	type KeyHint,
	LINE,
	pointer,
	spread,
} from "@adeildo/pi-kit";
import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import {
	type Component,
	type Focusable,
	Key,
	matchesKey,
	truncateToWidth,
	visibleWidth,
} from "@earendil-works/pi-tui";

import type { Peer } from "../folder.ts";
import type { Here } from "../here.ts";
import type { Room, RoomsView } from "../model.ts";
import { agentLines, inOrder, MARKS, stateOf } from "./agents.ts";
import { FRAME_MS } from "./motion.ts";
import { Picker, scrolled, sessionRow } from "./picker.ts";
import { printable, RoomView } from "./room.ts";

/** The keys that change rooms on the list. */
const ACTIONS = new Set(["n", "a", "r", "l", "x"]);
/** The key of the folder's room, whose id is undefined. */
const FOLDER = "";
const SIDE_MIN = 26;
const SIDE_MAX = 38;
/** Narrower than this, the panel shows one side at a time. */
const BESIDE = 72;

type Pane = "rooms" | "write";

/** A line of the list on the left: a room, or an agent of the open one. */
type Entry = { kind: "room"; room: Room } | { kind: "agent"; room: Room; peer: Peer };

export interface PanelOptions {
	theme: Theme;
	view: RoomsView;
	close: () => void;
	requestRender: () => void;
	rows: () => number;
	/** Injected so the docs pictures do not depend on when or where they are drawn. */
	now?: () => number;
	clock?: (at: number) => string;
}

export class PeersPanel implements Component, Focusable {
	focused = false;

	readonly #options: PanelOptions;
	readonly #rooms = new Map<string, RoomView>();
	#pane: Pane = "write";
	/** The room whose conversation shows, by key, so it stays put as rooms come and go around it. */
	#open = FOLDER;
	/** The line of the list the cursor is on: a room's key, or an agent's session. */
	#cursor = FOLDER;
	/** The room `x` asked about, waiting on `y`. */
	#closing: string | undefined;
	#picker: Picker | undefined;

	constructor(options: PanelOptions) {
		this.#options = options;
	}

	invalidate(): void {
		for (const room of this.#rooms.values()) room.invalidate();
		this.#picker?.invalidate();
	}

	/** Whether something on screen moves, so the panel draws every frame. */
	moving(): boolean {
		const room = this.#roomView(this.#openRoom());
		const live = room?.here.live() ?? [];
		return live.some((peer) => stateOf(peer) === "running") || room?.moving() === true;
	}

	handleInput(data: string): void {
		if (matchesKey(data, Key.alt("r"))) return this.#options.close();
		if (this.#picker !== undefined) return this.#picker.handleInput(data);
		if (this.#closing !== undefined) return this.#confirm(data);
		if (this.#pane === "write") return this.#writeInput(data);
		this.#roomsInput(data);
	}

	handleMouse(event: { type: string; wheelDelta?: number }): { handled: boolean } | undefined {
		const delta = event.type === "wheel" ? (event.wheelDelta ?? 0) : 0;
		if (delta === 0) return undefined;
		this.#roomView(this.#openRoom())?.scroll(delta);
		return { handled: true };
	}

	#writeInput(data: string): void {
		const room = this.#roomView(this.#openRoom());
		if (room?.handleInput(data) === true) return;
		if (matchesKey(data, Key.tab)) return this.#focus("rooms");
		if (matchesKey(data, Key.escape)) this.#options.close();
	}

	#roomsInput(data: string): void {
		const entries = this.#entries();
		const at = Math.max(
			0,
			entries.findIndex((entry) => keyOfEntry(entry) === this.#cursor),
		);
		const entry = entries[at];
		const room = entry?.room;
		const shared = room?.id;
		if (matchesKey(data, Key.escape)) return this.#options.close();
		if (matchesKey(data, Key.tab)) return this.#focus("write");
		if (matchesKey(data, Key.up)) return this.#move(entries, at - 1);
		if (matchesKey(data, Key.down)) return this.#move(entries, at + 1);
		if (matchesKey(data, Key.enter)) return this.#enter(entry);
		if (matchesKey(data, Key.ctrl("f")) && entry?.kind === "agent") return this.#narrow(entry);
		if (data === "n") return this.#pick(undefined);
		if (shared !== undefined && room !== undefined && this.#manage(data, shared, room, entry))
			return;
		// Typing on the list writes in the room, so the line you write in is never far. The keys that
		// change rooms never type, even where they do nothing, so a stray one is not sent.
		if (printable(data) && !ACTIONS.has(data)) {
			this.#pane = "write";
			this.#writeInput(data);
		}
	}

	/** The keys that change a shared room. Returns false for any other. */
	#manage(data: string, shared: string, room: Room, entry: Entry | undefined): boolean {
		const { view } = this.#options;
		switch (data) {
			case "a":
				this.#pick(room);
				return true;
			case "l":
				this.#act(() => view.leave(shared));
				return true;
			case "x":
				this.#closing = shared;
				this.#options.requestRender();
				return true;
			case "r":
				if (entry?.kind === "agent" && entry.peer.session !== this.#me()) {
					const { session, cwd } = entry.peer;
					this.#act(() => view.remove(shared, { session, cwd: cwd ?? "" }));
				}
				return true;
			default:
				return false;
		}
	}

	render(width: number): string[] {
		const { theme } = this.#options;
		const rooms = this.#options.view.rooms();
		const open = this.#openRoom();
		const inner = Math.max(20, width - FRAME_X);
		const height = Math.max(6, this.#options.rows() - FRAME_Y);
		const beside = inner >= BESIDE;
		const side = beside ? Math.max(SIDE_MIN, Math.min(SIDE_MAX, Math.floor(inner * 0.3))) : inner;
		const main = beside ? inner - side - 3 : inner;
		const showList = beside || this.#pane === "rooms";
		const showMain = beside || this.#pane === "write" || this.#picker !== undefined;

		const list = this.#listLines(rooms, open, side);
		const shown = scrolled(list.lines, list.cursorAt, height);
		const cursorRow = this.#pane === "rooms" ? list.cursorAt - shown.start : -1;
		const right = this.#mainLines(open, main, height);

		const column = theme.fg("borderMuted", LINE.v);
		const body: FrameLine[] = [];
		for (let line = 0; line < height; line++) {
			const left = shown.lines[line] ?? "";
			let text: string;
			if (beside) {
				const clipped = truncateToWidth(left, side, "");
				const gap = " ".repeat(Math.max(0, side - visibleWidth(clipped)));
				text = `${clipped}${gap} ${column} ${right[line] ?? ""}`;
			} else text = showMain && !showList ? (right[line] ?? "") : left;
			body.push({ text, selected: showList && line === cursorRow });
		}
		return frame(theme, width, body, {
			title: open?.name ?? "Peers",
			status: this.#status(open),
			keys: this.#keys(),
			split: beside ? side + 1 : undefined,
			border: "borderMuted",
		});
	}

	/** The rooms, the open one with its agents under it, and how to make another when there is one. */
	#listLines(
		rooms: readonly Room[],
		open: Room | undefined,
		width: number,
	): { lines: string[]; cursorAt: number } {
		const { theme } = this.#options;
		const focused = this.#pane === "rooms";
		const lines: string[] = [];
		let cursorAt = 0;
		for (const [index, room] of rooms.entries()) {
			const key = keyOf(room);
			const isOpen = open !== undefined && key === keyOf(open);
			if (index > 0) lines.push("");
			if (this.#cursor === key) cursorAt = lines.length;
			const name = isOpen
				? theme.fg("accent", theme.bold(room.name))
				: theme.fg("muted", room.name);
			lines.push(
				spread(`${pointer(theme, this.#cursor === key, focused)}${name}`, this.#badge(room), width),
			);
			if (!isOpen) continue;
			const here = this.#options.view.here(room.id);
			if (here === undefined) continue;
			const live = inOrder(here.live(), here.session);
			const selected = live.findIndex((peer) => peer.session === this.#cursor);
			const agents = agentLines(live, here.names(), {
				theme,
				now: this.#now(),
				me: here.session,
				selected,
				width,
				focused,
				compact: true,
				indent: 2,
			});
			if (selected >= 0) cursorAt = lines.length + agents.selectedAt;
			lines.push(...agents.lines);
		}
		if (rooms.length === 1)
			lines.push("", `  ${theme.fg("muted", "n")}  ${theme.fg("dim", "new room")}`);
		return { lines, cursorAt };
	}

	/** What waits in a room: an agent waiting on you, messages your agent has not read, or a count. */
	#badge(room: Room): string {
		const { theme } = this.#options;
		const here = this.#options.view.here(room.id);
		if (here === undefined) return "";
		const others = here.live().filter((peer) => peer.session !== here.session);
		if (others.some((peer) => stateOf(peer) === "waiting"))
			return theme.fg("warning", MARKS.waiting);
		const unread = here.summary().unread;
		if (unread > 0) return theme.fg("accent", `${unread} unread`);
		return others.length === 0 ? "" : theme.fg("dim", String(others.length));
	}

	#mainLines(open: Room | undefined, width: number, height: number): string[] {
		if (this.#picker !== undefined) {
			this.#picker.focused = this.focused;
			return this.#picker.lines(width, height);
		}
		const room = this.#roomView(open);
		if (room === undefined) return [];
		return room.lines(width, height, this.focused && this.#pane === "write");
	}

	/** The top edge's right: who is in the open room, or the question `x` asked. */
	#status(open: Room | undefined): string {
		const { theme } = this.#options;
		const closing =
			this.#closing === undefined
				? undefined
				: this.#options.view.rooms().find((room) => room.id === this.#closing);
		if (closing !== undefined) return theme.fg("warning", `close ${closing.name}?`);
		const here = open === undefined ? undefined : this.#options.view.here(open.id);
		if (open === undefined || here === undefined) return "";
		const live = here.live();
		const parts: string[] = [];
		if (open.id !== undefined && open.folders.length > 0)
			parts.push(plural(open.folders.length, "folder"));
		parts.push(`${live.length} open`);
		const waiting = live.filter((peer) => stateOf(peer) === "waiting").length;
		const text = theme.fg("dim", parts.join(", "));
		return waiting === 0
			? text
			: `${theme.fg("warning", `${MARKS.waiting} ${waiting} waits`)}   ${text}`;
	}

	#keys(): KeyHint[] {
		if (this.#picker !== undefined) return this.#picker.keys();
		if (this.#closing !== undefined)
			return [
				["y", "close it"],
				["esc", "keep it"],
			];
		if (this.#pane === "write")
			return this.#roomView(this.#openRoom())?.keys() ?? [["esc", "close"]];
		const entry = this.#entries().find((one) => keyOfEntry(one) === this.#cursor);
		const shared = entry?.room.id !== undefined;
		const keys: KeyHint[] = [[`${GLYPH.up}${GLYPH.down}`, "move"]];
		if (entry?.kind === "agent" && entry.peer.session !== this.#me()) {
			keys.push(["enter", "write to"], ["ctrl+f", "only"]);
			if (shared) keys.push(["r", "remove"]);
		} else keys.push(["enter", "write"]);
		keys.push(["n", "new room"]);
		if (shared) keys.push(["a", "add"], ["l", "leave"], ["x", "close room"]);
		keys.push(["tab", "write"], ["esc", "close"]);
		return keys;
	}

	/** The rooms, and the agents of the open one, in the order the list draws them. */
	#entries(): Entry[] {
		const open = this.#openRoom();
		const entries: Entry[] = [];
		for (const room of this.#options.view.rooms()) {
			entries.push({ kind: "room", room });
			if (open === undefined || keyOf(room) !== keyOf(open)) continue;
			const here = this.#options.view.here(room.id);
			if (here === undefined) continue;
			for (const peer of inOrder(here.live(), here.session))
				entries.push({ kind: "agent", room, peer });
		}
		return entries;
	}

	/** The open room; the folder's when the one you had open is gone. */
	#openRoom(): Room | undefined {
		const rooms = this.#options.view.rooms();
		const room = rooms.find((one) => keyOf(one) === this.#open) ?? rooms[0];
		if (room !== undefined && keyOf(room) !== this.#open) {
			this.#open = keyOf(room);
			this.#cursor = this.#open;
		}
		this.#forgetLeft(rooms);
		return room;
	}

	#roomView(room: Room | undefined): RoomView | undefined {
		if (room === undefined) return undefined;
		const key = keyOf(room);
		const kept = this.#rooms.get(key);
		if (kept !== undefined) return kept;
		const { view, theme } = this.#options;
		const here: Here | undefined = view.here(room.id);
		if (here === undefined) return undefined;
		const made = new RoomView({
			theme,
			here,
			room: room.id === undefined ? undefined : room.name,
			origin: room.origin,
			requestRender: this.#options.requestRender,
			now: this.#options.now,
			clock: this.#options.clock,
			send: (text) => view.send(room.id, text),
		});
		this.#rooms.set(key, made);
		return made;
	}

	/** Moving onto a room opens it, so its conversation shows while you look down the list. */
	#move(entries: readonly Entry[], to: number): void {
		if (entries.length === 0) return;
		const entry = entries[(to + entries.length) % entries.length];
		if (entry === undefined) return;
		this.#cursor = keyOfEntry(entry);
		if (entry.kind === "room") this.#open = keyOf(entry.room);
		this.#options.requestRender();
	}

	#enter(entry: Entry | undefined): void {
		if (entry?.kind === "agent" && entry.peer.session !== this.#me()) {
			const handle = this.#options.view
				.here(entry.room.id)
				?.names()
				.get(entry.peer.session)?.handle;
			if (handle !== undefined) this.#roomView(entry.room)?.mention(handle);
		}
		this.#focus("write");
	}

	#narrow(entry: Entry & { kind: "agent" }): void {
		const room = this.#roomView(entry.room);
		if (room === undefined) return;
		room.narrow(room.only() === entry.peer.session ? undefined : entry.peer.session);
	}

	#confirm(data: string): void {
		const room = this.#closing;
		this.#closing = undefined;
		if (room !== undefined && data === "y") return this.#act(() => this.#options.view.close(room));
		this.#options.requestRender();
	}

	/** The picker in the conversation's place: for a new room when `room` is absent, else to add to it. */
	#pick(room: Room | undefined): void {
		const { theme, view } = this.#options;
		const me = view.live().find((live) => live.session === this.#me());
		this.#picker = new Picker({
			theme,
			view,
			room,
			start: room === undefined && me !== undefined ? [sessionRow(me)] : [],
			requestRender: this.#options.requestRender,
			done: (made) => {
				this.#picker = undefined;
				if (made !== undefined) {
					this.#open = made;
					this.#cursor = made;
				}
				this.#options.requestRender();
			},
		});
		this.#options.requestRender();
	}

	#act(change: () => void): void {
		change();
		this.#options.requestRender();
	}

	#focus(pane: Pane): void {
		this.#pane = pane;
		if (pane === "rooms" && !this.#entries().some((entry) => keyOfEntry(entry) === this.#cursor))
			this.#cursor = this.#open;
		this.#options.requestRender();
	}

	/** A room this session left takes its unsent line with it. */
	#forgetLeft(rooms: readonly Room[]): void {
		const kept = new Set(rooms.map(keyOf));
		for (const key of this.#rooms.keys()) if (!kept.has(key)) this.#rooms.delete(key);
	}

	#me(): string {
		return this.#options.view.here(undefined)?.session ?? "";
	}

	#now(): number {
		return this.#options.now?.() ?? Date.now();
	}
}

function keyOf(room: Room): string {
	return room.id ?? FOLDER;
}

function keyOfEntry(entry: Entry): string {
	return entry.kind === "room" ? keyOf(entry.room) : entry.peer.session;
}

function plural(count: number, word: string): string {
	return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/** Opens the panel over the whole screen, on the folder's room. */
export async function openPanel(ctx: ExtensionContext, view: RoomsView): Promise<void> {
	if (ctx.mode !== "tui") return;
	await ctx.ui.custom<void>(
		(tui, theme, _keybindings, done) => {
			hideImagesUnderOverlays(tui);
			// Every frame while something moves, otherwise once a second, and at once on any change.
			let quiet = 0;
			const ticks = setInterval(() => {
				quiet += FRAME_MS;
				if (!panel.moving() && quiet < 1_000) return;
				quiet = 0;
				tui.requestRender();
			}, FRAME_MS);
			const stop = view.onChange(() => tui.requestRender());
			const panel: PeersPanel = new PeersPanel({
				theme,
				view,
				rows: () => tui.terminal.rows,
				requestRender: () => tui.requestRender(),
				close: () => {
					clearInterval(ticks);
					stop();
					done();
				},
			});
			return panel;
		},
		{
			overlay: true,
			overlayOptions: { anchor: "center", width: "100%", maxHeight: "100%" },
		},
	);
}

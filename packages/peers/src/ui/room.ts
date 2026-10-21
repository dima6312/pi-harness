import {
	ENTRY_X,
	entryFrame,
	FRAME_X,
	FRAME_Y,
	type FrameLine,
	frame,
	type FrameTabs,
	type KeyHint,
	pointer,
	rule,
	spread,
	formatClock,
	GLYPH,
	LINE,
} from "@adeildo/pi-kit";
import type { Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import {
	type Component,
	type Focusable,
	Input,
	Key,
	matchesKey,
	truncateToWidth,
	visibleWidth,
} from "@earendil-works/pi-tui";

import type { Peer } from "../folder.ts";
import type { Here, Typing } from "../here.ts";
import { ANYONE_MENTION, EVERYONE_MENTION, isGroupMention, typingMention } from "../mention.ts";
import { byHandle, mentionedNames, mentionsIn, type Named } from "../names.ts";
import { agentLines, inOrder, MARKS, markOf, stateOf, stateText } from "./agents.ts";
import { feedMoving, feedView } from "./feed.ts";
import { spin } from "./motion.ts";

/** The frame, and the row naming the two columns. */
const CHROME_Y = FRAME_Y + 1;
/** The tabs, and the rule under them. */
const TABS_Y = 2;
/** The rule over the line you write in, and the frame of that line. */
const COMPOSER_ROWS = 4;
const BESIDE = 90;
const AGENTS_MIN = 30;
const AGENTS_MAX = 44;
const PICKER_ROWS = 4;

type Pane = "room" | "agents";

export interface RoomOptions {
	theme: Theme;
	here: Here;
	/** The top edge: the folder's name alone, or the panel's name over its tabs. */
	title: string;
	/** A shared room's name, for the line you write in. Absent in the folder's room. */
	room?: string;
	/** The panel's tabs, when this room is one of them, and how to move between them. */
	tabs?: { line: () => FrameTabs; switch: (delta: number) => void };
	close: () => void;
	requestRender: () => void;
	/** Injected so the docs pictures do not depend on when or where they are drawn. */
	now?: () => number;
	clock?: (at: number) => string;
	send: (text: string) => void;
	rows: () => number;
}

export class RoomView implements Component, Focusable {
	focused = false;

	readonly #options: RoomOptions;
	readonly #composer: Input;
	#pane: Pane = "room";
	#selected = 0;
	#only: string | undefined;
	#offset = 0;
	#height = 0;
	#follow = true;
	#unread = 0;
	#pick = 0;
	/** The text the @ list was closed on: it stays closed until the text changes. */
	#dismissed: string | undefined;

	constructor(options: RoomOptions) {
		this.#options = options;
		const everyone = options.room === undefined ? "everyone" : `everyone in ${options.room}`;
		this.#composer = new Input({ prompt: "", placeholder: `message ${everyone}, @ for one agent` });
		this.#composer.onSubmit = (value) => this.#send(value);
	}

	invalidate(): void {
		this.#composer.invalidate();
	}

	moving(): boolean {
		const { here } = this.#options;
		const live = here.live();
		if (live.some((peer) => stateOf(peer) === "running")) return true;
		if (here.othersTyping().length > 0) return true;
		return feedMoving(here.folder.room, live, this.#now());
	}

	handleInput(data: string): void {
		if (matchesKey(data, Key.alt("g"))) return this.#options.close();
		if (matchesKey(data, Key.pageUp)) return this.#scroll(-this.#page());
		if (matchesKey(data, Key.pageDown)) return this.#scroll(this.#page());
		if (matchesKey(data, Key.shift("up"))) return this.#scroll(-1);
		if (matchesKey(data, Key.shift("down"))) return this.#scroll(1);
		if (matchesKey(data, Key.ctrl("f"))) return this.#narrow();
		if (this.#pane === "agents") return this.#agentsInput(data);
		this.#roomInput(data);
	}

	handleMouse(event: { type: string; wheelDelta?: number }): { handled: boolean } | undefined {
		const delta = event.type === "wheel" ? (event.wheelDelta ?? 0) : 0;
		if (delta === 0) return undefined;
		this.#scroll(delta);
		return { handled: true };
	}

	#roomInput(data: string): void {
		const picking = this.#candidates();
		if (picking.length > 0) {
			if (matchesKey(data, Key.escape)) return this.#dismiss();
			if (matchesKey(data, Key.up)) return this.#movePick(-1, picking.length);
			if (matchesKey(data, Key.down)) return this.#movePick(1, picking.length);
			if (matchesKey(data, Key.tab) || matchesKey(data, Key.enter))
				return this.#complete(picking[this.#pick % picking.length]);
		}
		if (matchesKey(data, Key.escape)) return this.#options.close();
		if (matchesKey(data, Key.tab)) return this.#focus("agents");
		// The arrows move the cursor while there is text, so rooms switch only from an empty line.
		if (this.#composer.getValue() === "" && this.#switchRoom(data)) return;
		if (matchesKey(data, Key.up)) return this.#scroll(-1);
		if (matchesKey(data, Key.down)) return this.#scroll(1);
		this.#composer.handleInput(data);
		this.#options.requestRender();
	}

	#agentsInput(data: string): void {
		if (matchesKey(data, Key.up)) return this.#move(-1);
		if (matchesKey(data, Key.down)) return this.#move(1);
		if (matchesKey(data, Key.enter)) return this.#writeToSelected();
		if (matchesKey(data, Key.tab) || matchesKey(data, Key.escape)) return this.#focus("room");
		if (this.#switchRoom(data)) return;
		// Typing in the agents column writes in the room, so the line you write in is never far.
		if (printable(data)) {
			this.#pane = "room";
			return this.#roomInput(data);
		}
	}

	render(width: number): string[] {
		const { theme, here } = this.#options;
		this.#composer.focused = this.focused && this.#pane === "room";
		const now = this.#now();
		const inner = Math.max(20, width - FRAME_X);
		const live = this.#live();
		const names = here.names();
		const me = here.session;
		this.#selected = Math.max(0, Math.min(this.#selected, live.length - 1));
		if (this.#only !== undefined && !live.some((peer) => peer.session === this.#only))
			this.#only = undefined;

		const chrome = this.#options.tabs === undefined ? CHROME_Y : CHROME_Y + TABS_Y;
		const height = Math.max(6, this.#options.rows() - chrome);
		const beside = inner >= BESIDE && live.length > 0;
		const agentsWidth = beside
			? Math.max(AGENTS_MIN, Math.min(AGENTS_MAX, Math.floor(inner * 0.4)))
			: inner;
		const roomWidth = beside ? inner - agentsWidth - 3 : inner;

		const agents = agentLines(live, names, {
			theme,
			now,
			me,
			selected: this.#selected,
			width: agentsWidth,
			focused: this.#pane === "agents",
		});
		const agentsHeight = beside
			? height
			: Math.min(agents.lines.length, Math.floor((height - COMPOSER_ROWS) / 2));
		const shown = window(agents.lines, agents.selectedAt, agents.selectedEnd, agentsHeight);
		const pickedRow = this.#pane === "agents" ? agents.selectedAt - shown.start : -1;

		const typing = here.othersTyping();
		const picker = this.#picker(this.#candidates(), names, roomWidth);
		const columnHeight = beside ? height : height - agentsHeight - 1;
		const right = this.#roomColumn(
			roomWidth,
			Math.max(2, columnHeight),
			picker,
			names,
			live,
			typing,
		);

		const column = theme.fg("borderMuted", LINE.v);
		const pair = (left: string, room: string) => {
			const clipped = truncateToWidth(left, agentsWidth, "");
			const gap = " ".repeat(Math.max(0, agentsWidth - visibleWidth(clipped)));
			return `${clipped}${gap} ${column} ${room}`;
		};

		const body: FrameLine[] = [];
		if (beside) {
			body.push(pair(this.#label("agents", "Agents"), this.#label("room", "Room")));
			for (let line = 0; line < height; line++)
				body.push({
					text: pair(shown.lines[line] ?? "", right[line] ?? ""),
					selected: line === pickedRow,
				});
		} else {
			body.push(this.#label("agents", "Agents"));
			for (const [line, text] of shown.lines.entries())
				body.push({ text, selected: line === pickedRow });
			body.push(this.#label("room", "Room"));
			body.push(...right);
		}
		return frame(theme, width, body, {
			title: this.#options.title,
			tabs: this.#options.tabs?.line(),
			status: this.#counts(live),
			keys: this.#keys(live, names),
			split: beside ? agentsWidth + 1 : undefined,
		});
	}

	/** The room column: what was said, then the line you write in under it. */
	#roomColumn(
		width: number,
		height: number,
		picker: readonly string[],
		names: ReadonlyMap<string, Named>,
		live: readonly Peer[],
		typing: readonly Typing[],
	): string[] {
		const { theme, here } = this.#options;
		const feed = feedView(here.folder.room, typing, {
			theme,
			now: this.#now(),
			width,
			me: here.session,
			names,
			live,
			clock: this.#options.clock ?? formatClock,
			only: this.#only,
		});
		this.#height = Math.max(1, height - COMPOSER_ROWS - picker.length);
		this.#followRoom(feed.lines.length);
		const shown = feed.lines.slice(this.#offset, this.#offset + this.#height);
		// A message cut at the top keeps its header, so you still see who wrote it.
		const head = feed.heads[this.#offset];
		if (head !== undefined && head < this.#offset) shown[0] = feed.lines[head] ?? "";
		// Like a chat: the newest line sits right over the line you write in.
		while (shown.length < this.#height) shown.unshift("");
		return [...shown, this.#rule(width), ...picker, ...this.#composerFrame(width, names)];
	}

	#label(pane: Pane, text: string): string {
		const { theme } = this.#options;
		return this.#pane === pane ? theme.fg("accent", theme.bold(text)) : theme.fg("dim", text);
	}

	/** How many agents work, wait and idle, for the top edge. */
	#counts(live: readonly Peer[]): string {
		const { theme } = this.#options;
		const counts: string[] = [];
		const count = (state: ReturnType<typeof stateOf>) =>
			live.filter((peer) => stateOf(peer) === state).length;
		const running = count("running");
		const waiting = count("waiting");
		const idle = count("idle");
		if (running > 0)
			counts.push(
				`${theme.fg("accent", spin(this.#now()))} ${theme.fg("muted", `${running} working`)}`,
			);
		if (waiting > 0)
			counts.push(
				`${theme.fg("warning", MARKS.waiting)} ${theme.fg("warning", `${waiting} waiting`)}`,
			);
		if (idle > 0) counts.push(`${theme.fg("dim", MARKS.idle)} ${theme.fg("dim", `${idle} idle`)}`);
		return counts.join("   ");
	}

	/** The rule over the line you write in, saying how far back you scrolled and what is filtered. */
	#rule(width: number): string {
		const { theme } = this.#options;
		const only =
			this.#only === undefined ? "" : `${theme.fg("dim", "only ")}${this.#nameOf(this.#only)}`;
		const hint = [only, this.#scrollHint()].filter(Boolean).join(theme.fg("dim", "   "));
		return rule(theme, width, hint);
	}

	#scrollHint(): string {
		const { theme } = this.#options;
		if (this.#follow) return "";
		if (this.#unread > 0) return theme.fg("accent", `${GLYPH.down} ${this.#unread} new`);
		return theme.fg("dim", `${GLYPH.up} ${this.#offset} above`);
	}

	#picker(
		candidates: readonly Named[],
		names: ReadonlyMap<string, Named>,
		width: number,
	): string[] {
		const { theme, here } = this.#options;
		const now = this.#now();
		const live = new Map(here.live().map((peer) => [peer.session, peer]));
		const at = this.#pick % Math.max(1, candidates.length);
		const start = Math.max(0, Math.min(at - PICKER_ROWS + 1, candidates.length - PICKER_ROWS));
		return candidates.slice(start, start + PICKER_ROWS).map((named, index) => {
			const peer = live.get(named.session);
			const chosen = start + index === at;
			const color = (names.get(named.session)?.color ?? "muted") as ThemeColor;
			const mark = peer === undefined ? " " : markOf(peer, color, theme, now);
			const state = peer === undefined ? "" : stateText(peer, theme, now);
			const label = chosen ? theme.bold(named.handle) : named.handle;
			const left = `${pointer(theme, chosen)}${mark} ${theme.fg(color, label)}`;
			return spread(left, state, Math.min(width, 46));
		});
	}

	/** The line you write in, in the dashed frame of something that has not been sent yet. */
	#composerFrame(width: number, names: ReadonlyMap<string, Named>): string[] {
		const { theme } = this.#options;
		const prompt = pointer(theme, true, this.#pane === "room");
		const value = this.#composer.getValue();
		const writing = value.trim() === "" || this.#candidates().length > 0;
		const to = writing ? theme.fg("dim", EVERYONE_MENTION) : this.#destination(value, names);
		const room = Math.max(1, width - ENTRY_X - 2);
		const [drawn = ""] = this.#composer.render(room);
		return entryFrame([`${prompt}${drawn}`], width, theme, {
			top: `${theme.fg("accent", theme.bold("you"))}${theme.fg("dim", ` ${GLYPH.right} `)}${to}`,
			color: "borderMuted",
			dashed: true,
		});
	}

	/**
	 * Who the words are for, in the frame's top edge. Bare, because the arrow already says it. Reads the
	 * mentions the way the send path does, so a group mention is not drawn as a mistake and a file after
	 * the `@` is not read as an agent.
	 */
	#destination(text: string, names: ReadonlyMap<string, Named>): string {
		const { theme } = this.#options;
		const mentioned = mentionedNames(text);
		// A name still being written is not a mistake yet.
		const writing = typingMention(text);
		const wrong = mentioned.filter(
			(name) => name !== writing && !isGroupMention(name) && byHandle(names, name) === undefined,
		);
		if (wrong.length > 0) return theme.fg("warning", `no agent ${wrong[0]}`);
		if (mentioned.includes(EVERYONE_MENTION)) return theme.fg("muted", EVERYONE_MENTION);
		if (mentioned.includes(ANYONE_MENTION)) return theme.fg("muted", ANYONE_MENTION);
		const found = mentionsIn(names, text);
		if (found.length === 0) return theme.fg("dim", EVERYONE_MENTION);
		return found
			.map((named) => theme.fg(named.color as ThemeColor, `@${named.handle}`))
			.join(theme.fg("dim", ", "));
	}

	#keys(live: readonly Peer[], names: ReadonlyMap<string, Named>): KeyHint[] {
		const selected = live[this.#selected];
		const handle = selected === undefined ? undefined : names.get(selected.session)?.handle;
		const other = selected !== undefined && selected.session !== this.#options.here.session;
		if (this.#pane === "agents") {
			const keys: KeyHint[] = [[`${GLYPH.up}${GLYPH.down}`, "pick"]];
			if (other && handle !== undefined) keys.push(["enter", "write"]);
			if (handle !== undefined) keys.push(["ctrl+f", this.#only === undefined ? "filter" : "all"]);
			if (this.#options.tabs !== undefined) keys.push(ROOMS_KEY);
			keys.push(["tab", "room"]);
			return keys;
		}
		if (this.#candidates().length > 0)
			return [
				[`${GLYPH.up}${GLYPH.down}`, "pick"],
				["tab", "mention"],
				["esc", "keep writing"],
			];
		// With nothing to send, the arrows switch rooms, so the first key says so.
		const empty = this.#options.tabs !== undefined && this.#composer.getValue() === "";
		return [
			empty ? ROOMS_KEY : ["enter", "send"],
			[`${GLYPH.up}${GLYPH.down}`, "scroll"],
			["tab", "agents"],
			["esc", "close"],
		];
	}

	/** Left and right move between the panel's tabs, when this room is one of them. */
	#switchRoom(data: string): boolean {
		const { tabs } = this.#options;
		if (tabs === undefined) return false;
		if (matchesKey(data, Key.left)) tabs.switch(-1);
		else if (matchesKey(data, Key.right)) tabs.switch(1);
		else return false;
		return true;
	}

	#nameOf(session: string): string {
		const named = this.#options.here.names().get(session);
		return this.#options.theme.fg((named?.color ?? "muted") as ThemeColor, named?.handle ?? "gone");
	}

	#live(): Peer[] {
		return inOrder(this.#options.here.live(), this.#options.here.session);
	}

	#now(): number {
		return this.#options.now?.() ?? Date.now();
	}

	#page(): number {
		return Math.max(1, this.#height - 2);
	}

	#focus(pane: Pane): void {
		this.#pane = pane;
		this.#options.requestRender();
	}

	#send(text: string): void {
		const words = text.trim();
		if (words === "") return;
		this.#options.send(words);
		this.#composer.setValue("");
		this.#dismissed = undefined;
		this.#follow = true;
		this.#unread = 0;
		this.#options.requestRender();
	}

	#candidates(): Named[] {
		if (this.#pane !== "room") return [];
		const value = this.#composer.getValue();
		if (value === this.#dismissed) return [];
		const prefix = typingMention(value);
		if (prefix === undefined) return [];
		const { here } = this.#options;
		const others = [...here.names().values()].filter((named) => named.session !== here.session);
		if (isGroupMention(prefix) || others.some((named) => named.handle === prefix)) return [];
		return [
			...others.filter((named) => named.handle.startsWith(prefix)),
			...[EVERYONE_MENTION, ANYONE_MENTION]
				.filter((name) => name.startsWith(prefix))
				.map((name): Named => ({ session: `@${name}`, handle: name, color: "muted" })),
		];
	}

	#complete(named: Named | undefined): void {
		if (named === undefined) return;
		const value = this.#composer.getValue();
		const prefix = typingMention(value) ?? "";
		this.#composer.setValue(`${value.slice(0, value.length - prefix.length)}${named.handle} `);
		this.#pick = 0;
		this.#options.requestRender();
	}

	#dismiss(): void {
		this.#dismissed = this.#composer.getValue();
		this.#options.requestRender();
	}

	#movePick(delta: number, count: number): void {
		this.#pick = (this.#pick + delta + count) % count;
		this.#options.requestRender();
	}

	/** Back to the room with the selected agent's name already written. */
	#writeToSelected(): void {
		const { here } = this.#options;
		const selected = this.#live()[this.#selected];
		const named = selected === undefined ? undefined : here.names().get(selected.session);
		if (named !== undefined && selected?.session !== here.session) {
			const rest = this.#composer.getValue().replace(/^@[a-z0-9-]+\s*/i, "");
			this.#composer.setValue(`@${named.handle} ${rest}`);
		}
		this.#focus("room");
	}

	#narrow(): void {
		const selected = this.#live()[this.#selected];
		this.#only = this.#only !== undefined || selected === undefined ? undefined : selected.session;
		this.#follow = true;
		this.#options.requestRender();
	}

	#scroll(lines: number): void {
		this.#offset = Math.max(0, this.#offset + lines);
		this.#follow = false;
		this.#options.requestRender();
	}

	#move(delta: number): void {
		const live = this.#live();
		if (live.length === 0) return;
		this.#selected = (this.#selected + delta + live.length) % live.length;
		if (this.#only !== undefined) this.#only = live[this.#selected]?.session;
		this.#options.requestRender();
	}

	#followRoom(total: number): void {
		const most = Math.max(0, total - this.#height);
		if (!this.#follow) {
			this.#offset = Math.min(this.#offset, most);
			this.#unread = Math.max(0, most - this.#offset);
			if (this.#offset === most) this.#follow = true;
			return;
		}
		this.#offset = most;
		this.#unread = 0;
	}
}

const ROOMS_KEY: KeyHint = [`${GLYPH.left}${GLYPH.right}`, "rooms"];

function printable(data: string): boolean {
	return !data.startsWith("\x1b") && [...data].every((char) => char >= " " && char !== "\x7f");
}

/** The lines that fit, keeping the selected agent in view, and where they start. */
function window(
	lines: readonly string[],
	from: number,
	to: number,
	height: number,
): { lines: string[]; start: number } {
	if (lines.length <= height) return { lines: [...lines], start: 0 };
	const end = Math.min(lines.length, Math.max(height, to));
	const start = Math.max(0, Math.min(from, end - height));
	return { lines: lines.slice(start, start + height), start };
}

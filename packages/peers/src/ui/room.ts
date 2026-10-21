// One room's conversation, the right side of the panel: what was said, newest at the bottom, and the
// line you write in under it. The panel keeps one per room, so a half-written line waits in its room
// while you look at another.
import { type KeyHint, pointer, rule, spread, formatClock, GLYPH } from "@adeildo/pi-kit";
import type { Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import { Input, Key, matchesKey, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";

import type { Peer } from "../folder.ts";
import type { Here } from "../here.ts";
import { ANYONE_MENTION, EVERYONE_MENTION, isGroupMention, typingMention } from "../mention.ts";
import { byHandle, mentionedNames, mentionsIn, type Named } from "../names.ts";
import { markOf, stateText } from "./agents.ts";
import { feedMoving, feedView } from "./feed.ts";

/** The rule over the line you write in, and that line. */
const COMPOSER_ROWS = 2;
const PICKER_ROWS = 4;

export interface RoomOptions {
	theme: Theme;
	here: Here;
	/** A shared room's name, for the line you write in. Absent in the folder's room. */
	room?: string;
	/** How a shared room came to be, said once above what was said in it. */
	origin?: string;
	requestRender: () => void;
	/** Injected so the docs pictures do not depend on when or where they are drawn. */
	now?: () => number;
	clock?: (at: number) => string;
	send: (text: string) => void;
}

export class RoomView {
	readonly #options: RoomOptions;
	readonly #composer: Input;
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

	get here(): Here {
		return this.#options.here;
	}

	invalidate(): void {
		this.#composer.invalidate();
	}

	moving(): boolean {
		const { here } = this.#options;
		if (here.othersTyping().length > 0) return true;
		return feedMoving(here.folder.room, here.live(), this.#now());
	}

	/** The agent the conversation is narrowed to, if any. */
	only(): string | undefined {
		return this.#only;
	}

	/** Narrows the conversation to what one agent said or was told, or widens it back. */
	narrow(session: string | undefined): void {
		this.#only = session;
		this.#follow = true;
		this.#options.requestRender();
	}

	/** The line you write in, starting with an agent's name. */
	mention(handle: string): void {
		const rest = this.#composer.getValue().replace(/^@[a-z0-9-]+\s*/i, "");
		this.#composer.setValue(`@${handle} ${rest}`);
		this.#options.requestRender();
	}

	/** Whether the @ list is open, so `esc` and the arrows belong to it. */
	picking(): boolean {
		return this.#candidates().length > 0;
	}

	/** Takes a key while you write. Returns false for one the panel should handle. */
	handleInput(data: string): boolean {
		const picking = this.#candidates();
		if (picking.length > 0) {
			if (matchesKey(data, Key.escape)) return this.#dismiss();
			if (matchesKey(data, Key.up)) return this.#movePick(-1, picking.length);
			if (matchesKey(data, Key.down)) return this.#movePick(1, picking.length);
			if (matchesKey(data, Key.tab) || matchesKey(data, Key.enter))
				return this.#complete(picking[this.#pick % picking.length]);
		}
		if (matchesKey(data, Key.escape) || matchesKey(data, Key.tab)) return false;
		if (matchesKey(data, Key.pageUp)) return this.scroll(-this.#page());
		if (matchesKey(data, Key.pageDown)) return this.scroll(this.#page());
		if (matchesKey(data, Key.up) || matchesKey(data, Key.shift("up"))) return this.scroll(-1);
		if (matchesKey(data, Key.down) || matchesKey(data, Key.shift("down"))) return this.scroll(1);
		this.#composer.handleInput(data);
		this.#options.requestRender();
		return true;
	}

	scroll(lines: number): boolean {
		this.#offset = Math.max(0, this.#offset + lines);
		this.#follow = false;
		this.#options.requestRender();
		return true;
	}

	keys(): KeyHint[] {
		if (this.#candidates().length > 0)
			return [
				[`${GLYPH.up}${GLYPH.down}`, "pick"],
				["tab", "mention"],
				["esc", "keep writing"],
			];
		return [
			["enter", "send"],
			[`${GLYPH.up}${GLYPH.down}`, "scroll"],
			["tab", "rooms"],
			["esc", "close"],
		];
	}

	/** The conversation, then the rule and the line you write in, `height` lines in all. */
	lines(width: number, height: number, writing: boolean): string[] {
		const { theme, here } = this.#options;
		this.#composer.focused = writing;
		const names = here.names();
		const live = here.live();
		if (this.#only !== undefined && !live.some((peer) => peer.session === this.#only))
			this.#only = undefined;
		const feed = feedView(here.folder.room, here.othersTyping(), {
			theme,
			now: this.#now(),
			width,
			me: here.session,
			names,
			live,
			clock: this.#options.clock ?? formatClock,
			only: this.#only,
		});
		const origin = this.#originLines(width);
		const lines = [...origin, ...feed.lines];
		const heads = [
			...origin.map(() => undefined),
			...feed.heads.map((at) => (at === undefined ? undefined : at + origin.length)),
		];
		const picker = this.#picker(this.#candidates(), names, width, live);
		this.#height = Math.max(1, height - COMPOSER_ROWS - picker.length);
		this.#followRoom(lines.length);
		const shown = lines.slice(this.#offset, this.#offset + this.#height);
		// A message cut at the top keeps its header, so you still see who wrote it.
		const head = heads[this.#offset];
		if (head !== undefined && head < this.#offset) shown[0] = lines[head] ?? "";
		// Like a chat: the newest line sits right over the line you write in.
		while (shown.length < this.#height) shown.unshift("");
		return [...shown, this.#rule(width), ...picker, this.#composerLine(width, names, writing)];
	}

	#originLines(width: number): string[] {
		const { theme, origin } = this.#options;
		if (origin === undefined) return [];
		return [...wrapTextWithAnsi(origin, width).map((line) => theme.fg("dim", line)), ""];
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
		live: readonly Peer[],
	): string[] {
		const { theme } = this.#options;
		const now = this.#now();
		const peers = new Map(live.map((peer) => [peer.session, peer]));
		const at = this.#pick % Math.max(1, candidates.length);
		const start = Math.max(0, Math.min(at - PICKER_ROWS + 1, candidates.length - PICKER_ROWS));
		return candidates.slice(start, start + PICKER_ROWS).map((named, index) => {
			const peer = peers.get(named.session);
			const chosen = start + index === at;
			const color = (names.get(named.session)?.color ?? "muted") as ThemeColor;
			const mark = peer === undefined ? " " : markOf(peer, color, theme, now);
			const state = peer === undefined ? "" : stateText(peer, theme, now);
			const label = chosen ? theme.bold(named.handle) : named.handle;
			return spread(
				`${pointer(theme, chosen)}${mark} ${theme.fg(color, label)}`,
				state,
				Math.min(width, 46),
			);
		});
	}

	/** The line you write in, and who it goes to on its right once there is something to send. */
	#composerLine(width: number, names: ReadonlyMap<string, Named>, writing: boolean): string {
		const { theme } = this.#options;
		const prompt = pointer(theme, true, writing);
		const value = this.#composer.getValue();
		const to =
			value.trim() === "" || this.#candidates().length > 0 ? "" : this.#destination(value, names);
		const room = Math.max(1, width - 3 - (to === "" ? 0 : visibleWidth(to) + 2));
		const [drawn = ""] = this.#composer.render(room);
		return spread(
			`${prompt}${drawn}`,
			to === "" ? "" : `${theme.fg("dim", GLYPH.right)} ${to}`,
			width,
		);
	}

	/**
	 * Who the words are for. Reads the mentions the way the send path does, so a group mention is not
	 * drawn as a mistake and a file after the `@` is not read as an agent.
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

	#nameOf(session: string): string {
		const named = this.#options.here.names().get(session);
		return this.#options.theme.fg((named?.color ?? "muted") as ThemeColor, named?.handle ?? "gone");
	}

	#now(): number {
		return this.#options.now?.() ?? Date.now();
	}

	#page(): number {
		return Math.max(1, this.#height - 2);
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

	#complete(named: Named | undefined): boolean {
		if (named === undefined) return true;
		const value = this.#composer.getValue();
		const prefix = typingMention(value) ?? "";
		this.#composer.setValue(`${value.slice(0, value.length - prefix.length)}${named.handle} `);
		this.#pick = 0;
		this.#options.requestRender();
		return true;
	}

	#dismiss(): boolean {
		this.#dismissed = this.#composer.getValue();
		this.#options.requestRender();
		return true;
	}

	#movePick(delta: number, count: number): boolean {
		this.#pick = (this.#pick + delta + count) % count;
		this.#options.requestRender();
		return true;
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

/** Whether a key types text, rather than moving or acting. */
export function printable(data: string): boolean {
	return !data.startsWith("\x1b") && [...data].every((char) => char >= " " && char !== "\x7f");
}

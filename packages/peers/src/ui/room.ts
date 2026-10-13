// Alt+G: the agents in this folder on the left, the room on the right, and one line to type in. The
// two time axes stay apart: what each one is doing now, and what happened and was said.
import { cardTones, keepBackground, spread, type Delivery, tasksWith } from "@adeildo/pi-kit";
import type { Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import {
	backgroundAnsi,
	type Component,
	type Focusable,
	Input,
	matchesKey,
	type KeyId,
	Key,
	truncateToWidth,
	visibleWidth,
	wrapTextWithAnsi,
} from "@earendil-works/pi-tui";

import type { Peer } from "../folder.ts";
import type { Here } from "../here.ts";
import { byHandle, type Named } from "../names.ts";
import { clock } from "./message.ts";

const PAD = 2;
const PEER_ROWS = 4;
const DETAIL_ROWS = 5;
/** Below this the board sits over the room instead of beside it. */
const BESIDE = 96;
const BOARD_MIN = 30;
const BOARD_MAX = 46;

const MARKS = {
	peer: "\u25c6",
	doing: "\u2316",
	waiting: "\u2691",
	queued: "\u29d7",
	done: "\u2713",
	mention: "@",
} as const;

export interface RoomOptions {
	theme: Theme;
	here: Here;
	/** The folder this session is in, for the title. */
	folder: string;
	close: () => void;
	requestRender: () => void;
	/** Now, for the ages on the board. Kept out of the wall clock so the pictures do not move. */
	now?: () => number;
	/** What you typed, sent. */
	send: (text: string) => void;
	rows: () => number;
}

export interface RoomKey {
	keys: KeyId[];
	label: string;
}

export class RoomView implements Component, Focusable {
	/** Set by the TUI when the overlay takes input, and passed on to the line you type in. */
	focused = false;

	readonly #options: RoomOptions;
	readonly #composer: Input;
	#selected = 0;
	#offset = 0;
	#room = 0;
	#follow = true;
	#unread = 0;

	constructor(options: RoomOptions) {
		this.#options = options;
		this.#composer = new Input({ prompt: "", placeholder: "message the room, @ to mention" });
		this.#composer.onSubmit = (value) => this.#send(value);
	}

	invalidate(): void {
		this.#composer.invalidate();
	}

	/** The room always shows its newest line, unless you scrolled back. */
	get following(): boolean {
		return this.#follow;
	}

	handleInput(data: string): void {
		if (matchesKey(data, Key.escape)) return this.#options.close();
		if (this.#scrollKey(data)) return;
		if (matchesKey(data, Key.up)) return this.#move(-1);
		if (matchesKey(data, Key.down)) return this.#move(1);
		if (matchesKey(data, Key.tab)) return this.#complete();
		this.#composer.handleInput(data);
	}

	/** The wheel scrolls the room back and stops following it. */
	handleMouse(event: { type: string; wheelDelta?: number }): { handled: boolean } | undefined {
		const delta = event.type === "wheel" ? (event.wheelDelta ?? 0) : 0;
		if (delta === 0) return undefined;
		this.#scroll(delta);
		return { handled: true };
	}

	render(width: number): string[] {
		const { theme, here } = this.#options;
		this.#composer.focused = this.focused;
		const inner = Math.max(20, width - PAD * 2);
		const live = here.live();
		const names = here.names();
		const me = here.session;
		this.#selected = Math.max(0, Math.min(this.#selected, live.length - 1));

		const beside = inner >= BESIDE && live.length > 0;
		const chrome = 8 + DETAIL_ROWS;
		const budget = Math.max(4, this.#options.rows() - chrome);
		const boardWidth = beside
			? Math.max(BOARD_MIN, Math.min(BOARD_MAX, Math.floor(inner * 0.42)))
			: inner;
		// Each column lays out to its own width, so the room wraps and the board keeps its state at the edge.
		const room = this.#roomLines(names, me, beside ? inner - boardWidth - 3 : inner);
		const board = this.#boardLines(live, names, me, boardWidth);
		const boardRoom = beside
			? budget
			: Math.min(PEER_ROWS * 2, Math.max(2, Math.floor(budget / 2)));
		const roomRoom = beside ? budget : Math.max(2, budget - boardRoom - 1);

		this.#room = roomRoom;
		this.#followRoom(room.length);
		const shownRoom = room.slice(this.#offset, this.#offset + roomRoom);
		const shownBoard = board.slice(0, boardRoom);

		const tones = cardTones(theme);
		const mode = theme.getColorMode();
		const card = backgroundAnsi(tones.card, mode);
		const band = backgroundAnsi(tones.band, mode);
		const pad = " ".repeat(PAD);
		const row = (text: string, background = card) =>
			`${background}${pad}${keepBackground(truncateToWidth(text, inner, "...", true), background)}${pad}\x1b[49m`;
		const height = Math.max(shownBoard.length, shownRoom.length);
		const body: string[] = [];
		for (let line = 0; line < height; line++) {
			if (!beside) {
				body.push(row(shownBoard[line] ?? ""));
				continue;
			}
			const left = truncateToWidth(shownBoard[line] ?? "", boardWidth, "");
			const gap = " ".repeat(Math.max(0, boardWidth - visibleWidth(left)));
			body.push(row(`${left}${gap} ${theme.fg("borderMuted", "\u2502")} ${shownRoom[line] ?? ""}`));
		}
		if (!beside && shownRoom.length > 0) {
			body.push(row(""));
			body.push(...shownRoom.map((line) => row(line)));
		}

		return [
			row(this.#header(names, me, inner), band),
			row(""),
			...body,
			row(this.#hint()),
			row(theme.fg("borderMuted", "\u2500".repeat(inner))),
			...this.#detail(live[this.#selected], names, inner).map((text) => row(text)),
			row(this.#composerLine(inner)),
			row(this.#keys(), band),
		];
	}

	#header(names: ReadonlyMap<string, Named>, me: string | undefined, width: number): string {
		const { theme } = this.#options;
		const title = theme.bold(
			theme.fg("accent", truncateToWidth(`Agents in ${this.#options.folder}`, width - 12, "...")),
		);
		const others = [...names.values()].filter((named) => named.session !== me).length;
		const count = theme.fg("dim", others === 1 ? "1 other" : `${others} others`);
		return spread(title, count, width);
	}

	#boardLines(
		live: readonly Peer[],
		names: ReadonlyMap<string, Named>,
		me: string | undefined,
		width: number,
	): string[] {
		const { theme } = this.#options;
		if (live.length === 0)
			return [
				theme.fg("muted", "No other agent in this folder."),
				theme.fg("dim", "Start pi in another terminal in this folder and it shows up here."),
			];
		const lines: string[] = [];
		for (const [index, peer] of live.entries()) {
			const named = names.get(peer.session);
			const color = (named?.color ?? "muted") as ThemeColor;
			const selected = index === this.#selected;
			const mine = peer.session === me ? theme.fg("dim", " this session") : "";
			const head = `${theme.fg(color, MARKS.peer)} ${theme.fg(color, theme.bold(named?.handle ?? "anon"))}${mine}`;
			const state = this.#stateOf(peer);
			const row = spread(head, state, width);
			lines.push(selected ? theme.bg("selectedBg", row) : row);
			for (const line of this.#peerLines(peer, width)) lines.push("  " + line);
			lines.push("");
		}
		return lines;
	}

	/** Working since when, idle, or waiting on you. The state that matters most wins. */
	#stateOf(peer: Peer): string {
		const { theme } = this.#options;
		const waiting = peer.tasks !== undefined && tasksWith(peer.tasks, "waiting").length > 0;
		if (waiting) return theme.fg("warning", "waits on you");
		const now = this.#options.now?.() ?? Date.now();
		if (peer.state === "running")
			return theme.fg("accent", `working ${since(peer.startedAt, now)}`);
		return theme.fg("dim", "idle");
	}

	#peerLines(peer: Peer, width: number): string[] {
		const { theme } = this.#options;
		const lines: string[] = [];
		const room = Math.max(8, width - 4);
		for (const task of peer.tasks === undefined ? [] : tasksWith(peer.tasks, "doing"))
			lines.push(
				theme.fg("accent", MARKS.doing) +
					" " +
					theme.fg("text", truncateToWidth(task.text, room, "...")),
			);
		for (const task of peer.tasks === undefined ? [] : tasksWith(peer.tasks, "waiting"))
			lines.push(
				theme.fg("warning", MARKS.waiting) +
					" " +
					theme.fg("text", truncateToWidth(task.text, room, "...")),
			);
		const queued = peer.tasks === undefined ? 0 : tasksWith(peer.tasks, "queued").length;
		if (queued > 0) lines.push(theme.fg("muted", `${MARKS.queued} ${queued} queued`));
		const edited = [...peer.edited.keys()].slice(-2).map(base);
		if (edited.length > 0)
			lines.push(theme.fg("dim", truncateToWidth(`edited ${edited.join(", ")}`, room, "...")));
		return lines.slice(0, PEER_ROWS - 1);
	}

	#roomLines(names: ReadonlyMap<string, Named>, me: string | undefined, width: number): string[] {
		const { theme, here } = this.#options;
		const lines: string[] = [];
		for (const item of here.folder.room) {
			if (item.kind === "happening") {
				const happening = item.happening;
				const who = this.#name(names, happening.session);
				const color = (names.get(happening.session)?.color ?? "muted") as ThemeColor;
				let what: string;
				switch (happening.kind) {
					case "joined":
					case "left":
						what = happening.kind;
						break;
					case "committed":
						what = `committed ${happening.sha} ${happening.subject}`;
						break;
					case "finished":
						what = `finished ${happening.task}`;
						break;
					// Who took a request shows on the request itself, beside the bids.
					case "took":
						continue;
				}
				lines.push(theme.fg("dim", `${clock(happening.at)}  ${theme.fg(color, who)} ${what}`));
				continue;
			}
			const message = item.message;
			const who = message.from === "you" ? "you" : this.#name(names, message.session);
			const color = (
				message.from === "you" ? "accent" : (names.get(message.session)?.color ?? "muted")
			) as ThemeColor;
			const to =
				message.from === "you" && me !== undefined && message.session === me
					? ""
					: this.#to(names, message.to);
			lines.push(`${theme.fg("dim", clock(message.at))}  ${theme.fg(color, theme.bold(who))}${to}`);
			const body = message.unsent
				? theme.fg("dim", `withdrawn: ${message.text}`)
				: theme.fg("text", message.text);
			for (const line of wrapTextWithAnsi(body, Math.max(8, width - 6)))
				lines.push("      " + line);
			for (const receipt of this.#receipts(names, message)) lines.push("      " + receipt);
		}
		for (const typing of here.othersTyping()) {
			const named = names.get(typing.session);
			const color = (named?.color ?? "muted") as ThemeColor;
			lines.push(
				`${theme.fg("dim", clock(typing.at))}  ${theme.fg(color, named?.handle ?? "an agent")} ${theme.fg("muted", `is writing${typing.to === "everyone" ? " to everyone" : ` to ${typing.to}`}`)}`,
			);
			const shown = typing.text.split("\n").slice(-2);
			for (const line of shown)
				lines.push(
					"      " + theme.fg("dim", truncateToWidth(line, Math.max(8, width - 8), "...")),
				);
			lines.push("      " + theme.fg("accent", "\u258c"));
		}
		return lines.length === 0
			? [theme.fg("dim", "Nothing said yet. Type below, or @ to mention one agent.")]
			: lines;
	}

	#receipts(
		names: ReadonlyMap<string, Named>,
		message: {
			from: string;
			to: string[] | "all";
			received: Map<string, { mode: Delivery }>;
			read: Set<string>;
			bids: Map<string, { fit: number; idle: boolean }>;
			takenBy?: string;
			unsent: boolean;
		},
	): string[] {
		const { theme } = this.#options;
		if (message.unsent) return [];
		if (message.to === "all") {
			const bids = [...message.bids].map(
				([session, bid]) =>
					`${this.#name(names, session)} ${theme.fg("dim", bid.idle ? bid.fit.toFixed(2) : "busy")}`,
			);
			if (message.takenBy !== undefined)
				return [
					`${theme.fg("success", "\u2713\u2713")} ${this.#name(names, message.takenBy)} ${theme.fg("muted", "took it")}`,
				];
			return bids.length === 0
				? [theme.fg("dim", "waiting for bids")]
				: [theme.fg("dim", "bids  ") + bids.join("   ")];
		}
		const many = message.to.length > 1;
		return message.to.map((session) => {
			const who = many ? ` ${this.#name(names, session)}` : "";
			if (message.read.has(session))
				return `${theme.fg("accent", "\u2713\u2713")}${who} ${theme.fg("muted", "read")}`;
			const received = message.received.get(session);
			return received === undefined
				? theme.fg("dim", `\u2713${who} sent`)
				: `${theme.fg("muted", "\u2713\u2713")}${who} ${theme.fg("dim", ARRIVED[received.mode])}`;
		});
	}

	#to(names: ReadonlyMap<string, Named>, to: string[] | "all"): string {
		const { theme } = this.#options;
		if (to === "all") return theme.fg("dim", " to everyone");
		return (
			theme.fg("dim", " to ") +
			to.map((session) => this.#name(names, session)).join(theme.fg("dim", ", "))
		);
	}

	#name(names: ReadonlyMap<string, Named>, session: string): string {
		const named = names.get(session);
		const color = (named?.color ?? "muted") as ThemeColor;
		return this.#options.theme.fg(color, named?.handle ?? "gone");
	}

	#detail(peer: Peer | undefined, names: ReadonlyMap<string, Named>, width: number): string[] {
		const { theme } = this.#options;
		if (peer === undefined) return ["", "", "", "", ""];
		const lines: string[] = [];
		const tasks = peer.tasks;
		if (tasks !== undefined) {
			for (const task of tasksWith(tasks, "doing"))
				lines.push(
					theme.fg("accent", `${MARKS.doing} ${task.text}`) +
						(task.result === undefined ? "" : theme.fg("muted", ` -> ${task.result}`)),
				);
			for (const task of tasksWith(tasks, "waiting"))
				lines.push(
					theme.fg("warning", `${MARKS.waiting} ${task.text}`) +
						theme.fg(
							"muted",
							` (on ${task.waitingOn === "outside" ? "something outside" : "you"})`,
						),
				);
			for (const task of tasksWith(tasks, "queued"))
				lines.push(theme.fg("muted", `${MARKS.queued} ${task.text}`));
			for (const task of tasksWith(tasks, "done").slice(-2))
				lines.push(
					theme.fg("success", `${MARKS.done} ${task.text}`) +
						(task.result === undefined ? "" : theme.fg("dim", ` -> ${task.result}`)),
				);
			for (const decision of tasks.decisions.slice(-1))
				lines.push(theme.fg("mdLink", `${MARKS.peer} ${decision.text}`));
		}
		const ran = peer.ran.at(-1);
		if (ran !== undefined)
			lines.push(
				theme.fg(
					"dim",
					truncateToWidth(`${ran.ok ? "\u2713" : "\u00d7"} ${ran.command}`, width, "..."),
				),
			);
		const missing = DETAIL_ROWS - lines.length;
		for (let i = 0; i < missing; i++) lines.push("");
		return lines
			.slice(0, DETAIL_ROWS)
			.map((line) => keepBackground(truncateToWidth(line, width, "...", true), ""));
	}

	/** The one line you type in, with where it will go on the right. */
	#composerLine(width: number): string {
		const { theme } = this.#options;
		const text = this.#composer.getValue();
		const where = this.#destination(text);
		const room = Math.max(10, width - visibleWidth(where) - 2);
		const prompt = theme.fg("accent", "\u276f ");
		const [drawn = ""] = this.#composer.render(Math.max(1, room - visibleWidth(prompt)));
		return `${prompt}${drawn}${" ".repeat(Math.max(1, room - visibleWidth(prompt) - visibleWidth(drawn)))}${where}`;
	}

	/** Mentions go to those agents; anything else goes to everyone, and the best fit takes it. */
	#destination(text: string): string {
		const { theme, here } = this.#options;
		const names = here.names();
		const mentioned = [...text.matchAll(/(?<![\w@])@([a-z][a-z0-9-]*)/gi)].map(
			(match) => match[1] ?? "",
		);
		const found: Named[] = [];
		for (const name of mentioned) {
			const named = byHandle(names, name);
			if (named === undefined) return theme.fg("warning", `no agent called ${name}`);
			found.push(named);
		}
		if (found.length === 0) return theme.fg("dim", "to everyone, best fit takes it");
		return (
			theme.fg("muted", "to ") +
			found
				.map((named) => theme.fg(named.color as ThemeColor, named.handle))
				.join(theme.fg("muted", ", "))
		);
	}

	#keys(): string {
		const { theme } = this.#options;
		const keys: [string, string][] = [
			["\u2191\u2193", "agent"],
			["shift+\u2191\u2193", "room"],
			["tab", `${MARKS.mention}mention`],
			["enter", "send"],
			["esc", "close"],
		];
		return keys
			.map(([key, action]) => `${theme.fg("muted", key)} ${theme.fg("dim", action)}`)
			.join("  ");
	}

	#hint(): string {
		const { theme } = this.#options;
		if (this.#unread > 0 && !this.#follow) return theme.fg("muted", `\u2193 ${this.#unread} new`);
		return this.#follow ? "" : theme.fg("dim", `\u2191 ${this.#offset} above`);
	}

	#send(text: string): void {
		const words = text.trim();
		if (words === "") return;
		this.#options.send(words);
		this.#composer.setValue("");
		this.#follow = true;
		this.#unread = 0;
		this.#options.requestRender();
	}

	/** Tab finishes the @name being typed, cycling through the matches. */
	#complete(): void {
		const value = this.#composer.getValue();
		const match = /(?:^|\s)@([a-z0-9-]*)$/i.exec(value);
		const prefix = match?.[1] ?? "";
		const names = [...this.#options.here.names().values()].filter(
			(named) =>
				named.session !== this.#options.here.session &&
				named.handle.startsWith(prefix.toLowerCase()),
		);
		if (names.length === 0) {
			if (match === null) this.#composer.setValue(`${value}@`);
			return;
		}
		const at = names.findIndex((named) => named.handle === prefix);
		const next = names[(at + 1) % names.length];
		if (next === undefined) return;
		const head = match === null ? `${value}@` : value.slice(0, value.length - prefix.length);
		this.#composer.setValue(`${head}${next.handle} `);
	}

	#scrollKey(data: string): boolean {
		if (matchesKey(data, Key.shift("up"))) return this.#scroll(-1);
		if (matchesKey(data, Key.shift("down"))) return this.#scroll(1);
		return false;
	}

	#scroll(lines: number): boolean {
		this.#offset = Math.max(0, this.#offset + lines);
		this.#follow = false;
		this.#options.requestRender();
		return true;
	}

	#move(delta: number): void {
		const live = this.#options.here.live();
		if (live.length === 0) return;
		this.#selected = (this.#selected + delta + live.length) % live.length;
		this.#options.requestRender();
	}

	/** Follows the newest line, unless you scrolled back to read something. */
	#followRoom(total: number): void {
		const most = Math.max(0, total - this.#room);
		if (!this.#follow) {
			this.#offset = Math.min(this.#offset, most);
			this.#unread = Math.max(0, most - this.#offset);
			return;
		}
		this.#offset = most;
		this.#unread = 0;
	}
}

const ARRIVED: Record<Delivery, string> = {
	woke: "woke it",
	"after-run": "gets it after its run",
	steered: "cut into its run",
	"next-turn": "gets it with the next prompt",
};

function since(at: number, now: number): string {
	const minutes = Math.max(0, Math.round((now - at) / 60_000));
	if (minutes < 1) return "now";
	if (minutes < 60) return `${minutes}m`;
	return `${Math.round(minutes / 60)}h`;
}

function base(path: string): string {
	return path.split("/").pop() ?? path;
}

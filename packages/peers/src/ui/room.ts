import { spread } from "@adeildo/pi-kit";
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
import type { Here } from "../here.ts";
import { byHandle, type Named } from "../names.ts";
import { agentLines, MARKS, markOf, stateOf, stateText } from "./agents.ts";
import { feedLines, feedMoving } from "./feed.ts";
import { clock } from "./message.ts";
import { spin } from "./motion.ts";

const PAD = 2;
const CHROME_X = 2 + PAD * 2;
const CHROME_Y = 5;
const BESIDE = 90;
const AGENTS_MIN = 30;
const AGENTS_MAX = 44;
const PICKER_ROWS = 4;
const MENTION_TAIL = /(?:^|\s)@([a-z0-9-]*)$/i;

export interface RoomOptions {
	theme: Theme;
	here: Here;
	folder: string;
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
		this.#composer = new Input({ prompt: "", placeholder: "message the room, @ to mention" });
		this.#composer.onSubmit = (value) => this.#send(value);
	}

	invalidate(): void {
		this.#composer.invalidate();
	}

	get following(): boolean {
		return this.#follow;
	}

	moving(): boolean {
		const { here } = this.#options;
		const live = here.live();
		if (live.some((peer) => stateOf(peer) === "running")) return true;
		if (here.othersTyping().length > 0) return true;
		return feedMoving(here.folder.room, live, this.#now());
	}

	handleInput(data: string): void {
		const picking = this.#candidates();
		if (matchesKey(data, Key.escape)) {
			if (picking.length > 0) return this.#dismiss();
			return this.#options.close();
		}
		if (matchesKey(data, Key.shift("up"))) return this.#scroll(-1);
		if (matchesKey(data, Key.shift("down"))) return this.#scroll(1);
		if (matchesKey(data, Key.ctrl("f"))) return this.#narrow();
		if (picking.length > 0) {
			if (matchesKey(data, Key.up)) return this.#movePick(-1, picking.length);
			if (matchesKey(data, Key.down)) return this.#movePick(1, picking.length);
			if (matchesKey(data, Key.tab) || matchesKey(data, Key.enter))
				return this.#complete(picking[this.#pick % picking.length]);
		}
		if (matchesKey(data, Key.up)) return this.#move(-1);
		if (matchesKey(data, Key.down)) return this.#move(1);
		if (matchesKey(data, Key.tab)) return this.#startMention();
		if (matchesKey(data, Key.enter) && this.#composer.getValue().trim() === "")
			return this.#writeToSelected();
		this.#composer.handleInput(data);
		this.#options.requestRender();
	}

	handleMouse(event: { type: string; wheelDelta?: number }): { handled: boolean } | undefined {
		const delta = event.type === "wheel" ? (event.wheelDelta ?? 0) : 0;
		if (delta === 0) return undefined;
		this.#scroll(delta);
		return { handled: true };
	}

	render(width: number): string[] {
		const { theme, here } = this.#options;
		this.#composer.focused = this.focused;
		const now = this.#now();
		const inner = Math.max(20, width - CHROME_X);
		const live = here.live();
		const names = here.names();
		const me = here.session;
		this.#selected = Math.max(0, Math.min(this.#selected, live.length - 1));
		if (this.#only !== undefined && !live.some((peer) => peer.session === this.#only))
			this.#only = undefined;

		const picking = this.#candidates();
		const pickerRows = Math.min(PICKER_ROWS, picking.length);
		const height = Math.max(4, this.#options.rows() - CHROME_Y - pickerRows);
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
		});
		const feed = feedLines(here.folder.room, here.othersTyping(), {
			theme,
			now,
			width: roomWidth,
			me,
			names,
			live,
			clock: this.#options.clock ?? clock,
			only: this.#only,
		});
		const agentsHeight = beside ? height : Math.min(agents.lines.length, Math.floor(height / 2));
		const roomHeight = beside ? height : Math.max(2, height - agentsHeight - 1);
		this.#height = roomHeight;
		this.#followRoom(feed.length);
		const shownRoom = feed.slice(this.#offset, this.#offset + roomHeight);
		const shownAgents = window(agents.lines, agents.selectedAt, agents.selectedEnd, agentsHeight);

		const border = (text: string) => theme.fg("border", text);
		const rule = (text: string) => theme.fg("borderMuted", text);
		const pad = " ".repeat(PAD);
		const row = (text: string) => {
			const clipped = truncateToWidth(text, inner, "...");
			return `${border("\u2502")}${pad}${clipped}${" ".repeat(Math.max(0, inner - visibleWidth(clipped)))}${pad}${border("\u2502")}`;
		};

		const body: string[] = [];
		if (beside) {
			for (let line = 0; line < height; line++) {
				const left = truncateToWidth(shownAgents[line] ?? "", agentsWidth, "");
				const gap = " ".repeat(Math.max(0, agentsWidth - visibleWidth(left)));
				body.push(row(`${left}${gap} ${rule("\u2502")} ${shownRoom[line] ?? ""}`));
			}
		} else {
			for (const line of shownAgents) body.push(row(line));
			if (shownAgents.length > 0) body.push(row(rule("\u2500".repeat(inner))));
			for (let line = 0; line < roomHeight; line++) body.push(row(shownRoom[line] ?? ""));
		}

		return [
			this.#top(live, width),
			row(""),
			...body,
			this.#divider(width, beside ? agentsWidth : undefined),
			...this.#picker(picking, names, inner).map(row),
			row(this.#composerLine(inner, names)),
			this.#bottom(width, live, names),
		];
	}

	#top(live: readonly Peer[], width: number): string {
		const { theme } = this.#options;
		const border = (text: string) => theme.fg("border", text);
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
		const right = counts.join("   ");
		const title = theme.bold(theme.fg("accent", `Agents in ${this.#options.folder}`));
		return edge(border, "\u256d", "\u256e", title, right, width);
	}

	#divider(width: number, split: number | undefined): string {
		const { theme } = this.#options;
		const only =
			this.#only === undefined
				? ""
				: `${theme.fg("dim", "only ")}${this.#nameOf(this.#only)}${theme.fg("dim", ", ctrl+f for all")}`;
		const right = [only, this.#scrollHint()].filter(Boolean).join(theme.fg("dim", "   "));
		const line = (text: string) => theme.fg("border", text);
		const fill = Math.max(0, width - 2);
		let rule = "\u2500".repeat(fill);
		if (split !== undefined) {
			const at = PAD + split + 1;
			rule = `${rule.slice(0, at)}\u2534${rule.slice(at + 1)}`;
		}
		if (right === "") return line(`\u251c${rule}\u2524`);
		const room = fill - visibleWidth(right) - 3;
		return `${line(`\u251c${rule.slice(0, Math.max(0, room))} `)}${right}${line(` \u2500\u2524`)}`;
	}

	#scrollHint(): string {
		const { theme } = this.#options;
		if (this.#follow) return "";
		if (this.#unread > 0) return theme.fg("accent", `\u2193 ${this.#unread} new`);
		return theme.fg("dim", `\u2191 ${this.#offset} above`);
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
			const left = `${chosen ? theme.fg("accent", "\u276f") : " "} ${mark} ${theme.fg(color, theme.bold(named.handle))}`;
			const line = spread(left, state, Math.min(width, 44));
			return chosen ? theme.bg("selectedBg", line) : line;
		});
	}

	#composerLine(width: number, names: ReadonlyMap<string, Named>): string {
		const { theme } = this.#options;
		const prompt = `${theme.fg("accent", "\u276f")} ${this.#destination(this.#composer.getValue(), names)}  `;
		const room = Math.max(1, width - visibleWidth(prompt));
		const [drawn = ""] = this.#composer.render(room);
		return `${prompt}${drawn}`;
	}

	#destination(text: string, names: ReadonlyMap<string, Named>): string {
		const { theme } = this.#options;
		const mentioned = [...text.matchAll(/(?<![\w@])@([a-z][a-z0-9-]*)(?=\s|$|[.,:;!?])/gi)].map(
			(match) => match[1] ?? "",
		);
		const found: Named[] = [];
		const unknown: string[] = [];
		for (const name of mentioned) {
			const named = byHandle(names, name);
			if (named === undefined) unknown.push(name);
			else found.push(named);
		}
		// A name still being written is not a mistake yet.
		const writing = MENTION_TAIL.exec(text)?.[1];
		const wrong = unknown.filter((name) => name !== writing);
		if (wrong.length > 0) return theme.fg("warning", `no agent called ${wrong[0]}`);
		if (found.length === 0) return theme.fg("muted", "to everyone");
		return `${theme.fg("muted", "to ")}${found
			.map((named) => theme.fg(named.color as ThemeColor, theme.bold(named.handle)))
			.join(theme.fg("muted", ", "))}`;
	}

	#bottom(width: number, live: readonly Peer[], names: ReadonlyMap<string, Named>): string {
		const { theme } = this.#options;
		const keys: [string, string][] = [];
		const selected = live[this.#selected];
		const other =
			selected !== undefined && selected.session !== this.#options.here.session
				? names.get(selected.session)
				: undefined;
		if (this.#candidates().length > 0) {
			keys.push(["\u2191\u2193", "pick"], ["tab", "mention"], ["esc", "keep writing"]);
		} else if (this.#composer.getValue().trim() === "") {
			keys.push(["\u2191\u2193", "agent"]);
			if (other !== undefined) keys.push(["enter", `write to ${other.handle}`]);
			if (selected !== undefined)
				keys.push([
					"ctrl+f",
					this.#only === undefined ? `only ${names.get(selected.session)?.handle ?? "it"}` : "all",
				]);
			keys.push(["shift+\u2191\u2193", "scroll"], ["esc", "close"]);
		} else {
			keys.push(
				["enter", "send"],
				["@", "mention"],
				["shift+\u2191\u2193", "scroll"],
				["esc", "close"],
			);
		}
		const text = keys
			.map(([key, action]) => `${theme.fg("muted", key)} ${theme.fg("dim", action)}`)
			.join("   ");
		return edge((part) => theme.fg("border", part), "\u2570", "\u256f", text, "", width);
	}

	#nameOf(session: string): string {
		const named = this.#options.here.names().get(session);
		return this.#options.theme.fg((named?.color ?? "muted") as ThemeColor, named?.handle ?? "gone");
	}

	#now(): number {
		return this.#options.now?.() ?? Date.now();
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
		const match = MENTION_TAIL.exec(value);
		if (match === null) return [];
		const prefix = (match[1] ?? "").toLowerCase();
		const { here } = this.#options;
		const others = [...here.names().values()].filter((named) => named.session !== here.session);
		if (others.some((named) => named.handle === prefix)) return [];
		return others.filter((named) => named.handle.startsWith(prefix));
	}

	#complete(named: Named | undefined): void {
		if (named === undefined) return;
		const value = this.#composer.getValue();
		const match = MENTION_TAIL.exec(value);
		const prefix = match?.[1] ?? "";
		this.#composer.setValue(`${value.slice(0, value.length - prefix.length)}${named.handle} `);
		this.#pick = 0;
		this.#options.requestRender();
	}

	#startMention(): void {
		const value = this.#composer.getValue();
		this.#composer.setValue(value === "" || value.endsWith(" ") ? `${value}@` : `${value} @`);
		this.#dismissed = undefined;
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

	#writeToSelected(): void {
		const { here } = this.#options;
		const selected = here.live()[this.#selected];
		if (selected === undefined || selected.session === here.session) return;
		const named = here.names().get(selected.session);
		if (named === undefined) return;
		this.#composer.setValue(`@${named.handle} `);
		this.#options.requestRender();
	}

	#narrow(): void {
		const selected = this.#options.here.live()[this.#selected];
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
		const live = this.#options.here.live();
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

function edge(
	border: (text: string) => string,
	left: string,
	right: string,
	label: string,
	end: string,
	width: number,
): string {
	const room = Math.max(0, width - 4);
	const head = label === "" ? "" : ` ${truncateToWidth(label, Math.max(0, room - 2), "...")} `;
	const tail = end === "" || visibleWidth(head) + visibleWidth(end) + 4 > room ? "" : ` ${end} `;
	const dashes = Math.max(0, room - visibleWidth(head) - visibleWidth(tail));
	return `${border(`${left}\u2500`)}${head}${border("\u2500".repeat(dashes))}${tail}${border(`\u2500${right}`)}`;
}

function window(lines: readonly string[], from: number, to: number, height: number): string[] {
	if (lines.length <= height) return [...lines];
	const end = Math.min(lines.length, Math.max(height, to));
	const start = Math.max(0, Math.min(from, end - height));
	return lines.slice(start, start + height);
}

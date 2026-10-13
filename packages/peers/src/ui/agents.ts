import { spread, type Task, tasksWith } from "@adeildo/pi-kit";
import type { Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

import type { Peer } from "../folder.ts";
import type { Named } from "../names.ts";
import { spin } from "./motion.ts";

export const MARKS = { idle: "\u25c7", waiting: "\u2691" } as const;

const POINTER = "\u276f";
/** Room for the widest label, "waits", and a space. */
const LABEL = 7;
const DOING_SHOWN = 3;
const QUEUED_SHOWN = 2;
const EDITED_SHOWN = 3;

export interface AgentsOptions {
	theme: Theme;
	now: number;
	me: string | undefined;
	selected: number;
	width: number;
	/** The pointer is bright while ↑↓ move it, and dim while you write in the room. */
	focused?: boolean;
}

export type AgentState = "running" | "idle" | "waiting";

export function stateOf(peer: Peer): AgentState {
	if (peer.tasks !== undefined && tasksWith(peer.tasks, "waiting").length > 0) return "waiting";
	return peer.state === "running" ? "running" : "idle";
}

export function markOf(peer: Peer, color: ThemeColor, theme: Theme, now: number): string {
	switch (stateOf(peer)) {
		case "waiting":
			return theme.fg("warning", MARKS.waiting);
		case "running":
			return theme.fg(color, spin(now));
		case "idle":
			return theme.fg("dim", MARKS.idle);
	}
}

export function stateText(peer: Peer, theme: Theme, now: number): string {
	switch (stateOf(peer)) {
		case "waiting":
			return theme.fg("warning", "waits on you");
		case "running":
			return theme.fg("muted", `working ${since(peer.stateAt, now)}`);
		case "idle":
			return theme.fg("dim", "idle");
	}
}

/** The others first, this session last: it is the one you already know about. */
export function inOrder(live: readonly Peer[], me: string | undefined): Peer[] {
	return [...live].toSorted((a, b) => Number(a.session === me) - Number(b.session === me));
}

export function agentLines(
	live: readonly Peer[],
	names: ReadonlyMap<string, Named>,
	options: AgentsOptions,
): { lines: string[]; selectedAt: number; selectedEnd: number } {
	const { theme, width, now } = options;
	if (live.length === 0)
		return {
			lines: [
				theme.fg("muted", "No other agent in this folder."),
				theme.fg("dim", "Start pi in another terminal here and it shows up."),
			],
			selectedAt: 0,
			selectedEnd: 0,
		};
	const lines: string[] = [];
	let selectedAt = 0;
	let selectedEnd = 0;
	for (const [index, peer] of live.entries()) {
		const named = names.get(peer.session);
		const color = (named?.color ?? "muted") as ThemeColor;
		const selected = index === options.selected;
		const pointer = selected ? theme.fg(options.focused ? "accent" : "dim", POINTER) : " ";
		const you = peer.session === options.me ? theme.fg("dim", "  you") : "";
		const name = theme.fg(color, theme.bold(named?.handle ?? "anon"));
		if (selected) selectedAt = lines.length;
		lines.push(
			spread(
				`${pointer} ${markOf(peer, color, theme, now)} ${name}${you}`,
				stateText(peer, theme, now),
				width,
			),
		);
		const body = selected ? opened(peer, theme, width - 4) : closed(peer, theme, width - 4);
		for (const line of body) lines.push(`    ${line}`);
		if (selected) selectedEnd = lines.length;
		if (index < live.length - 1) lines.push("");
	}
	return { lines, selectedAt, selectedEnd };
}

/** One line: what it is on, or what waits on you. */
function closed(peer: Peer, theme: Theme, width: number): string[] {
	const tasks = peer.tasks;
	if (tasks === undefined) return [];
	const waiting = tasksWith(tasks, "waiting");
	if (waiting.length > 0) return [row(theme, "waits", waiting, width, "warning")];
	const doing = tasksWith(tasks, "doing");
	if (doing.length > 0) return [row(theme, "now", doing, width)];
	const queued = tasksWith(tasks, "queued");
	if (queued.length > 0) return [row(theme, "next", queued, width, "muted")];
	return [];
}

function opened(peer: Peer, theme: Theme, width: number): string[] {
	const lines: string[] = [];
	const tasks = peer.tasks;
	if (tasks !== undefined) {
		lines.push(...rows(theme, "waits", tasksWith(tasks, "waiting"), width, Infinity, "warning"));
		lines.push(...rows(theme, "now", tasksWith(tasks, "doing"), width, DOING_SHOWN));
		lines.push(...rows(theme, "next", tasksWith(tasks, "queued"), width, QUEUED_SHOWN, "muted"));
		const done = tasksWith(tasks, "done").at(-1);
		if (done !== undefined) lines.push(labeled(theme, "done", theme.fg("dim", done.text), width));
	}
	const ran = peer.ran.at(-1);
	if (ran !== undefined) {
		const mark = ran.ok ? theme.fg("success", "\u2713") : theme.fg("error", "\u00d7");
		lines.push(labeled(theme, "ran", `${mark} ${theme.fg("dim", command(ran.command))}`, width));
	}
	const edited = [...peer.edited.keys()].slice(-EDITED_SHOWN).map(base);
	if (edited.length > 0)
		lines.push(labeled(theme, "files", theme.fg("dim", edited.join(", ")), width));
	if (lines.length === 0) lines.push(theme.fg("dim", "nothing on its list yet"));
	return lines;
}

/** Each task on its own line, the label on the first, and how many more did not fit. */
function rows(
	theme: Theme,
	label: string,
	tasks: readonly Task[],
	width: number,
	shown: number,
	tone: ThemeColor = "text",
): string[] {
	const lines = tasks
		.slice(0, shown)
		.map((one, index) => labeled(theme, index === 0 ? label : "", theme.fg(tone, one.text), width));
	if (tasks.length > shown)
		lines.push(labeled(theme, "", theme.fg("dim", `${tasks.length - shown} more`), width));
	return lines;
}

/** The first task, and how many others share the label. */
function row(
	theme: Theme,
	label: string,
	tasks: readonly Task[],
	width: number,
	tone: ThemeColor = "text",
): string {
	const more = tasks.length > 1 ? theme.fg("dim", ` +${tasks.length - 1}`) : "";
	const room = Math.max(4, width - LABEL - visibleWidth(more));
	const text = truncateToWidth(tasks[0]?.text ?? "", room, "...");
	return `${theme.fg("dim", label.padEnd(LABEL))}${theme.fg(tone, text)}${more}`;
}

function labeled(theme: Theme, label: string, text: string, width: number): string {
	const body = truncateToWidth(text, Math.max(4, width - LABEL), "...");
	return `${theme.fg("dim", label.padEnd(LABEL))}${body}`;
}

/** The command without the `cd` into the folder that every agent puts in front. */
function command(text: string): string {
	const first = text.split("\n")[0] ?? text;
	return first.replace(/^cd\s+\S+\s*&&\s*/, "");
}

export function since(at: number, now: number): string {
	const minutes = Math.max(0, Math.round((now - at) / 60_000));
	if (minutes < 1) return "now";
	if (minutes < 60) return `${minutes}m`;
	return `${Math.round(minutes / 60)}h`;
}

function base(path: string): string {
	return path.split("/").pop() ?? path;
}

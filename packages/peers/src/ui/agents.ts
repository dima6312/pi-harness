import { spread, type SessionTasks, tasksWith } from "@adeildo/pi-kit";
import type { Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";

import type { Peer } from "../folder.ts";
import type { Named } from "../names.ts";
import { spin } from "./motion.ts";

export const MARKS = {
	idle: "\u25c7",
	waiting: "\u2691",
	doing: "\u2316",
	queued: "\u29d7",
	done: "\u2713",
	failed: "\u00d7",
	decided: "\u25c6",
} as const;

const QUEUED_SHOWN = 3;
const EDITED_SHOWN = 3;

export interface AgentsOptions {
	theme: Theme;
	now: number;
	me: string | undefined;
	selected: number;
	width: number;
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
		const mine = peer.session === options.me ? theme.fg("dim", "  this session") : "";
		const name = theme.fg(color, theme.bold(named?.handle ?? "anon"));
		const head = spread(
			`${markOf(peer, color, theme, now)} ${name}${mine}`,
			stateText(peer, theme, now),
			width,
		);
		if (selected) selectedAt = lines.length;
		lines.push(selected ? theme.bg("selectedBg", head) : head);
		const body = selected ? opened(peer, theme, width - 2) : closed(peer, theme, width - 2);
		for (const line of body) lines.push(`  ${line}`);
		if (selected) selectedEnd = lines.length;
		if (index < live.length - 1) lines.push("");
	}
	return { lines, selectedAt, selectedEnd };
}

function closed(peer: Peer, theme: Theme, width: number): string[] {
	const tasks = peer.tasks;
	if (tasks === undefined) return [];
	const lines: string[] = [];
	const doing = tasksWith(tasks, "doing")[0];
	const queued = tasksWith(tasks, "queued").length;
	if (doing !== undefined) lines.push(task(theme, "accent", MARKS.doing, doing.text, width));
	else if (queued > 0) lines.push(theme.fg("muted", `${MARKS.queued} ${queued} queued`));
	const waiting = tasksWith(tasks, "waiting")[0];
	if (waiting !== undefined) lines.push(task(theme, "warning", MARKS.waiting, waiting.text, width));
	return lines;
}

function opened(peer: Peer, theme: Theme, width: number): string[] {
	const lines = peer.tasks === undefined ? [] : taskLines(peer.tasks, theme, width);
	const ran = peer.ran.at(-1);
	if (ran !== undefined)
		lines.push(
			truncateToWidth(
				`${theme.fg(ran.ok ? "success" : "error", ran.ok ? MARKS.done : MARKS.failed)} ${theme.fg("dim", ran.command)}`,
				width,
				"...",
			),
		);
	const edited = [...peer.edited.keys()].slice(-EDITED_SHOWN).map(base);
	if (edited.length > 0)
		lines.push(theme.fg("dim", truncateToWidth(`edited ${edited.join(", ")}`, width, "...")));
	if (lines.length === 0) lines.push(theme.fg("dim", "nothing on the board yet"));
	return lines;
}

function taskLines(tasks: SessionTasks, theme: Theme, width: number): string[] {
	const lines: string[] = [];
	for (const one of tasksWith(tasks, "doing"))
		lines.push(task(theme, "accent", MARKS.doing, one.text, width));
	for (const one of tasksWith(tasks, "waiting")) {
		const on = one.waitingOn === "outside" ? "outside" : "on you";
		const text = truncateToWidth(one.text, Math.max(4, width - on.length - 4), "...");
		lines.push(
			spread(
				`${theme.fg("warning", MARKS.waiting)} ${theme.fg("text", text)}`,
				theme.fg("warning", on),
				width,
			),
		);
	}
	const queued = tasksWith(tasks, "queued");
	for (const one of queued.slice(0, QUEUED_SHOWN))
		lines.push(task(theme, "muted", MARKS.queued, one.text, width, "muted"));
	if (queued.length > QUEUED_SHOWN)
		lines.push(theme.fg("dim", `  ${queued.length - QUEUED_SHOWN} more queued`));
	const done = tasksWith(tasks, "done").at(-1);
	if (done !== undefined) lines.push(task(theme, "success", MARKS.done, done.text, width, "dim"));
	const decided = tasks.decisions.at(-1);
	if (decided !== undefined)
		lines.push(task(theme, "mdLink", MARKS.decided, decided.text, width, "dim"));
	return lines;
}

function task(
	theme: Theme,
	color: ThemeColor,
	mark: string,
	text: string,
	width: number,
	tone: ThemeColor = "text",
): string {
	return `${theme.fg(color, mark)} ${theme.fg(tone, truncateToWidth(text, Math.max(4, width - 2), "..."))}`;
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

import { pointer, CUT, spread, type Task, tasksWith, GLYPH } from "@adeildo/pi-kit";
import type { Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";

import type { Peer } from "../folder.ts";
import type { Named } from "../names.ts";
import { spin } from "./motion.ts";

export const MARKS = { idle: GLYPH.diamondEmpty, waiting: GLYPH.flag } as const;

/** Lines a task may wrap to: the selected agent shows it whole, the others a glance. */
const TASK_LINES_OPEN = 4;
const TASK_LINES_CLOSED = 2;
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
	const here = live.find((peer) => peer.session === options.me)?.cwd;
	for (const [index, peer] of live.entries()) {
		const named = names.get(peer.session);
		const color = (named?.color ?? "muted") as ThemeColor;
		const selected = index === options.selected;
		const marker = pointer(theme, selected, options.focused === true);
		const you = peer.session === options.me ? theme.fg("dim", "  you") : "";
		const name = theme.fg(color, theme.bold(named?.handle ?? "anon"));
		// In a shared room, an agent from another folder says which, since its files are there.
		const where =
			peer.cwd === undefined || here === undefined || peer.cwd === here
				? ""
				: theme.fg("dim", ` \u00b7 ${base(peer.cwd)}`);
		if (selected) selectedAt = lines.length;
		lines.push(
			spread(
				`${marker}${markOf(peer, color, theme, now)} ${name}${where}${you}`,
				stateText(peer, theme, now),
				width,
			),
		);
		for (const line of details(peer, theme, width - 4, selected)) lines.push(`    ${line}`);
		if (selected) selectedEnd = lines.length;
		if (index < live.length - 1) lines.push("");
	}
	return { lines, selectedAt, selectedEnd };
}

/**
 * Under the name and its state: what waits on you, what it is on, and the files it edited. The task
 * wraps instead of being cut, since a cut task says nothing.
 */
function details(peer: Peer, theme: Theme, width: number, selected: boolean): string[] {
	const tasks = peer.tasks;
	const most = selected ? TASK_LINES_OPEN : TASK_LINES_CLOSED;
	const lines: string[] = [];
	if (tasks !== undefined) {
		const waiting = tasksWith(tasks, "waiting");
		const doing = tasksWith(tasks, "doing");
		lines.push(...task(theme, waiting, width, most, "warning"));
		if (selected || waiting.length === 0) lines.push(...task(theme, doing, width, most, "text"));
	}
	const edited = [...peer.edited.keys()].slice(-EDITED_SHOWN).map(base);
	if (edited.length > 0)
		lines.push(theme.fg("dim", truncateToWidth(`edited ${edited.join(", ")}`, width, CUT)));
	if (selected && lines.length === 0) lines.push(theme.fg("dim", "nothing in progress"));
	return lines;
}

/** The first task wrapped to at most `most` lines, and how many others there are. */
function task(
	theme: Theme,
	tasks: readonly Task[],
	width: number,
	most: number,
	tone: ThemeColor,
): string[] {
	const first = tasks[0];
	if (first === undefined) return [];
	let lines = wrapTextWithAnsi(first.text, width);
	if (lines.length > most)
		lines = [
			...lines.slice(0, most - 1),
			truncateToWidth(lines.slice(most - 1).join(" "), width, CUT),
		];
	const out = lines.map((line) => theme.fg(tone, line));
	if (tasks.length > 1) out.push(theme.fg("dim", `and ${tasks.length - 1} more`));
	return out;
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

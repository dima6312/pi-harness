// What the agent reads of its rooms: who else is there, what each one does and touched, and each
// room's last words. It reads it when it wants, so nobody is interrupted to publish it.
import { isAbsolute, join } from "node:path";

import { tasksWith } from "@adeildo/pi-kit";

import type { Peer, Posted } from "./folder.ts";
import { type Here, tilde } from "./here.ts";
import { audienceLabel } from "./mention.ts";
import type { Named } from "./names.ts";

const RECENT_FILES = 8;
const ROOM_LINES = 12;

export type BoardRoom = Pick<Here, "folder" | "live" | "names" | "room" | "cwd">;

/** The folder's room first, then each shared one. An agent already shown is not shown again. */
export function boardText(rooms: readonly BoardRoom[], me: string): string {
	const shown = new Set<string>([me]);
	return rooms.map((room) => section(room, me, shown)).join("\n\n");
}

function section(room: BoardRoom, me: string, shown: Set<string>): string {
	const names = room.names();
	const others = room.live().filter((peer) => peer.session !== me);
	const fresh = others.filter((peer) => !shown.has(peer.session));
	for (const peer of fresh) shown.add(peer.session);
	const lines = [heading(room, others.length)];
	for (const peer of fresh) lines.push("", ...peerLines(peer, names, room.cwd));
	const also = others.filter((peer) => !fresh.includes(peer));
	if (also.length > 0)
		lines.push(
			"",
			`Also here, shown above: ${also.map((peer) => `@${names.get(peer.session)?.handle ?? peer.session}`).join(", ")}.`,
		);
	const said = room.folder.room
		.flatMap((item) => (item.kind === "message" ? [item.message] : []))
		.slice(-ROOM_LINES);
	if (said.length > 0)
		lines.push(
			"",
			room.room === undefined
				? "The room, oldest first:"
				: `The room ${room.room.name}, oldest first:`,
			...said.map((message) => roomLine(message, names, room, me)),
		);
	if (room.room !== undefined)
		lines.push("", `To write to everyone there, send with room: "${room.room.name}".`);
	return lines.join("\n");
}

function heading(room: BoardRoom, others: number): string {
	const agents = `${others} other ${others === 1 ? "agent" : "agents"}`;
	if (room.room === undefined)
		return others === 0
			? "No other agent is working in this folder."
			: `${agents} ${others === 1 ? "works" : "work"} in this folder.`;
	return others === 0
		? `In the room ${room.room.name}, no other agent is open now.`
		: `In the room ${room.room.name}, ${agents}, from other folders too. Their paths are in their own folders.`;
}

function peerLines(peer: Peer, names: ReadonlyMap<string, Named>, cwd: string): string[] {
	const handle = names.get(peer.session)?.handle ?? peer.session;
	const elsewhere = peer.cwd !== undefined && peer.cwd !== cwd ? peer.cwd : undefined;
	const where = elsewhere === undefined ? "" : ` in ${tilde(elsewhere)}`;
	const lines = [
		`@${handle} (${peer.state === "running" ? "working" : "idle"})${where}${peer.title === undefined ? "" : `: ${peer.title}`}`,
	];
	const tasks = peer.tasks;
	if (tasks !== undefined) {
		for (const task of tasksWith(tasks, "doing")) lines.push(`  doing: ${task.text}`);
		for (const task of tasksWith(tasks, "waiting"))
			lines.push(`  waiting on the operator: ${task.text}`);
		for (const task of tasksWith(tasks, "queued")) lines.push(`  queued: ${task.text}`);
		for (const task of tasksWith(tasks, "done").slice(-3))
			lines.push(`  done: ${task.text}${task.result === undefined ? "" : ` -> ${task.result}`}`);
	}
	const edited = [...peer.edited]
		.toSorted(([, a], [, b]) => b - a)
		.slice(0, RECENT_FILES)
		.map(([path]) =>
			elsewhere === undefined || isAbsolute(path) ? path : tilde(join(elsewhere, path)),
		);
	if (edited.length > 0) lines.push(`  edited: ${edited.join(", ")}`);
	const commit = peer.commits.at(-1);
	if (commit !== undefined) lines.push(`  last commit: ${commit.sha} ${commit.subject}`);
	return lines;
}

function roomLine(
	message: Posted,
	names: ReadonlyMap<string, Named>,
	room: BoardRoom,
	me: string,
): string {
	const name = (session: string) =>
		session === me
			? "you (this session)"
			: `@${names.get(session)?.handle ?? room.folder.peers.get(session)?.handle ?? "gone"}`;
	const from = message.from === "you" ? "the operator" : name(message.session);
	const to =
		typeof message.to === "string" ? audienceLabel(message.to) : message.to.map(name).join(", ");
	const taken = message.takenBy === undefined ? "" : ` (taken by ${name(message.takenBy)})`;
	return `- ${from} to ${to}${taken}: ${message.text}`;
}

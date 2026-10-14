// What the agent reads of the folder: who else is here, what each one does and touched, and the
// room's last words. It reads it when it wants, so nobody is interrupted to publish it.
import { tasksWith } from "@adeildo/pi-kit";

import type { Folder, Peer, Posted } from "./folder.ts";
import type { Named } from "./names.ts";

const RECENT_FILES = 8;
const ROOM_LINES = 12;

export function boardText(
	folder: Folder,
	live: readonly Peer[],
	names: ReadonlyMap<string, Named>,
	me: string,
): string {
	const others = live.filter((peer) => peer.session !== me);
	const lines = [
		others.length === 0
			? "No other agent is working in this folder."
			: `${others.length} other ${others.length === 1 ? "agent works" : "agents work"} in this folder.`,
	];
	for (const peer of others) lines.push("", ...peerLines(peer, names));
	const said = folder.room
		.flatMap((item) => (item.kind === "message" ? [item.message] : []))
		.slice(-ROOM_LINES);
	if (said.length > 0)
		lines.push(
			"",
			"The room, oldest first:",
			...said.map((message) => roomLine(message, names, folder, me)),
		);
	return lines.join("\n");
}

function peerLines(peer: Peer, names: ReadonlyMap<string, Named>): string[] {
	const handle = names.get(peer.session)?.handle ?? peer.session;
	const lines = [
		`@${handle} (${peer.state === "running" ? "working" : "idle"})${peer.title === undefined ? "" : `: ${peer.title}`}`,
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
		.map(([path]) => path);
	if (edited.length > 0) lines.push(`  edited: ${edited.join(", ")}`);
	const commit = peer.commits.at(-1);
	if (commit !== undefined) lines.push(`  last commit: ${commit.sha} ${commit.subject}`);
	return lines;
}

function roomLine(
	message: Posted,
	names: ReadonlyMap<string, Named>,
	folder: Folder,
	me: string,
): string {
	const name = (session: string) =>
		session === me
			? "you (this session)"
			: `@${names.get(session)?.handle ?? folder.peers.get(session)?.handle ?? "gone"}`;
	const from = message.from === "you" ? "the operator" : name(message.session);
	const to = message.to === "all" ? "everyone" : message.to.map(name).join(", ");
	const taken = message.takenBy === undefined ? "" : ` (taken by ${name(message.takenBy)})`;
	return `- ${from} to ${to}${taken}: ${message.text}`;
}

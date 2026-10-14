// What the start screen says under the folder and the model: only what changed or waits on you since
// the last session here. On a quiet day the list is empty and the screen says so in one line.
import { GLYPH } from "@adeildo/pi-kit";

import type { Snapshot } from "./snapshot.ts";

/** Plans used past this percent show on the start screen. */
const PLAN_LIMIT = 70;

/** The last session in this folder, as the start screen remembers it. */
export interface LastVisit {
	at: number;
	version: string;
}

export interface StartNote {
	mark: string;
	/** A theme color for the mark. */
	color: string;
	text: string;
	detail?: string;
}

export function startNotes(
	snapshot: Pick<Snapshot, "peers" | "account" | "git" | "branch">,
	version: string,
	last: LastVisit | undefined,
): StartNote[] {
	const notes: StartNote[] = [];
	const { account, git } = snapshot;

	if (account?.needsLogin === true)
		notes.push({
			mark: GLYPH.cross,
			color: "error",
			text: `${account.label} needs a sign-in`,
			detail: "/accounts",
		});
	if (git !== undefined && git.conflicted > 0)
		notes.push({ mark: GLYPH.cross, color: "error", text: `${git.conflicted} files in conflict` });
	if (git !== undefined && git.behind > 0)
		notes.push({
			mark: GLYPH.down,
			color: "warning",
			text: `${snapshot.branch ?? "this branch"} is ${git.behind} behind`,
			detail: "pull before you start",
		});
	for (const peer of snapshot.peers)
		notes.push({
			mark: GLYPH.diamond,
			color: peer.color,
			text: `@${peer.handle}`,
			detail: peerState(peer.state),
		});
	for (const window of account?.windows ?? []) {
		if (window.used < PLAN_LIMIT) continue;
		notes.push({
			mark: GLYPH.up,
			color: window.used >= 90 ? "error" : "warning",
			text: `${window.name} at ${Math.round(window.used)}%`,
			detail: window.resetsIn === undefined ? undefined : `resets in ${window.resetsIn}`,
		});
	}
	if (last !== undefined && last.version !== version)
		notes.push({
			mark: GLYPH.up,
			color: "accent",
			text: `${GLYPH.pi}-harness ${version} is new`,
			detail: `was ${last.version}`,
		});
	return notes;
}

function peerState(state: "running" | "idle" | "waiting"): string {
	switch (state) {
		case "running":
			return "works here";
		case "waiting":
			return "waits for you";
		case "idle":
			return "is open here";
	}
}

/** Local time, hours and minutes, or the day when it was not today. */
export function since(at: number, now: number): string {
	const then = new Date(at);
	const time = `${String(then.getHours()).padStart(2, "0")}:${String(then.getMinutes()).padStart(2, "0")}`;
	if (new Date(now).toDateString() === then.toDateString()) return time;
	const days = Math.round((now - at) / 86_400_000);
	return days <= 1 ? `yesterday ${time}` : `${days} days ago`;
}

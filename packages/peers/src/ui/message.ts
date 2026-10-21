// A message from another session, drawn in the chat of the one that got it: a frame in the color of
// the agent that wrote it, who and to whom in its top edge with the time on the right, the words inside.
import { basename } from "node:path";

import { drawnByWidth, ENTRY_X, entryFrame, formatClock, GLYPH } from "@adeildo/pi-kit";
import type { Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import { type Component, wrapTextWithAnsi } from "@earendil-works/pi-tui";

import type { PeerDelivery, PeerMessageDetails } from "../here.ts";
import type { MembershipChange, Room } from "../model.ts";

export const PEER_MARK = GLYPH.diamond;

export function messageBlock(details: PeerMessageDetails, theme: Theme): Component {
	return drawnByWidth((width) => messageLines(details, theme, width));
}

/** Everything that arrived together, one frame under the other. */
export function deliveryBlock(delivery: PeerDelivery, theme: Theme): Component {
	return drawnByWidth((width) =>
		delivery.items.flatMap((item) => messageLines(item, theme, width)),
	);
}

export function messageLines(details: PeerMessageDetails, theme: Theme, width: number): string[] {
	const color = details.fromYou ? "accent" : (details.color as ThemeColor);
	const who = details.fromYou ? "you, from another session" : `@${details.from}`;
	// An agent from another folder says which, since the paths it names are there.
	const where =
		details.where === undefined ? "" : theme.fg("dim", ` \u00b7 ${basename(details.where)}`);
	const top = `${theme.fg(color, theme.bold(who))}${where} ${theme.fg("muted", addressed(details))}`;
	const body = wrapTextWithAnsi(details.text.trim(), Math.max(1, width - ENTRY_X)).map((line) =>
		theme.fg("text", line),
	);
	return entryFrame(body, width, theme, {
		top,
		topRight: theme.fg("dim", formatClock(details.at)),
		color,
	});
}

/** Who the message went to, as this session sees it, and in which shared room. */
function addressed(details: PeerMessageDetails): string {
	const room = details.room === undefined ? "" : ` in ${details.room}`;
	if (details.toYou) return `${GLYPH.right} you${room}`;
	if (details.everyone === true) return `${GLYPH.right} everyone${room}`;
	if (details.takenBy === undefined) return `to anyone${room}, taken here`;
	return `to anyone${room}, ${details.takenBy} took it`;
}

/** The notice in the chat when this session joins or leaves a shared room. */
export function membershipNotice(change: MembershipChange, me?: string): string {
	const room = change.room.name;
	if (change.kind === "left")
		return change.reason === "closed"
			? `${room} was closed, so you left it.`
			: `You were taken out of ${room}.`;
	const by = change.by === "you" ? "by you" : `by ${change.by}`;
	const why = change.why === undefined ? "" : `: ${change.why}`;
	const who = othersIn(change.room, me);
	return `You joined ${room}, added ${by}${why}.${who === "" ? "" : ` ${who}`} Alt+R shows it.`;
}

/** Who else the room counts, by folder and by name. */
function othersIn(room: Room, me: string | undefined): string {
	const parts = [
		...room.folders.map((folder) => basename(folder.path)),
		...room.sessions
			.filter((session) => session.session !== me)
			.map((session) => session.handle ?? "an agent"),
	];
	return parts.length === 0 ? "" : `With ${parts.join(", ")}.`;
}

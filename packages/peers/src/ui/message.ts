// A message from another session, drawn in the chat of the one that got it: who, to whom and when on
// one line, the words under it.
import type { Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import {
	type Component,
	truncateToWidth,
	visibleWidth,
	wrapTextWithAnsi,
} from "@earendil-works/pi-tui";

import type { PeerMessageDetails } from "../here.ts";

export const PEER_MARK = "\u25c6";
const INDENT = "  ";

export function messageBlock(details: PeerMessageDetails, theme: Theme): Component {
	return {
		render: (width) => messageLines(details, theme, width),
		invalidate() {},
	};
}

export function messageLines(details: PeerMessageDetails, theme: Theme, width: number): string[] {
	const color = details.fromYou ? "accent" : (details.color as ThemeColor);
	const who = details.fromYou ? "you, from another session" : details.from;
	const to = details.withdrawn ? "withdrawn" : details.toYou ? "to you" : "to everyone, taken here";
	const head = `${theme.fg(color, PEER_MARK)} ${theme.fg(color, theme.bold(who))}  ${theme.fg("muted", to)}`;
	const time = theme.fg("dim", clock(details.at));
	const gap = width - visibleWidth(head) - visibleWidth(time);
	const lines = [
		gap >= 2 ? `${head}${" ".repeat(gap)}${time}` : truncateToWidth(head, width, "..."),
	];
	const body = details.withdrawn ? theme.strikethrough(details.text) : details.text;
	for (const line of wrapTextWithAnsi(body, Math.max(1, width - INDENT.length)))
		lines.push(INDENT + (details.withdrawn ? theme.fg("dim", line) : theme.fg("text", line)));
	return lines;
}

/** Local time, hours and minutes, the same width at every hour. */
export function clock(at: number): string {
	const date = new Date(at);
	return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

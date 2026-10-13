// A message from another session, drawn in the chat of the one that got it: who, to whom and when on
// one line, the words under it.
import type { Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import {
	type Component,
	truncateToWidth,
	visibleWidth,
	wrapTextWithAnsi,
} from "@earendil-works/pi-tui";

import type { PeerDelivery, PeerMessageDetails } from "../here.ts";

export const PEER_MARK = "\u25c6";
const INDENT = "  ";

export function messageBlock(details: PeerMessageDetails, theme: Theme): Component {
	return {
		render: (width) => messageLines(details, theme, width),
		invalidate() {},
	};
}

/** Everything that arrived together, one block under the other. */
export function deliveryBlock(delivery: PeerDelivery, theme: Theme): Component {
	return {
		render: (width) =>
			delivery.items.flatMap((item, index) =>
				index === 0 ? messageLines(item, theme, width) : ["", ...messageLines(item, theme, width)],
			),
		invalidate() {},
	};
}

export function messageLines(details: PeerMessageDetails, theme: Theme, width: number): string[] {
	const color = details.fromYou ? "accent" : (details.color as ThemeColor);
	const who = details.fromYou ? "you, from another session" : details.from;
	const head = `${theme.fg(color, PEER_MARK)} ${theme.fg(color, theme.bold(who))}  ${theme.fg("muted", addressed(details))}`;
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

/** Who the message went to, as this session sees it. */
function addressed(details: PeerMessageDetails): string {
	if (details.withdrawn) return "withdrawn";
	if (details.toYou) return "to you";
	if (details.takenBy === undefined) return "to everyone, taken here";
	return `to everyone, ${details.takenBy} took it`;
}

/** Local time, hours and minutes, the same width at every hour. */
export function clock(at: number): string {
	const date = new Date(at);
	return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

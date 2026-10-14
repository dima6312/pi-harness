// A message from another session, drawn in the chat of the one that got it: a frame in the color of
// the agent that wrote it, who and to whom in its top edge with the time on the right, the words inside.
import { drawnByWidth, ENTRY_X, entryFrame, formatClock, GLYPH } from "@adeildo/pi-kit";
import type { Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import { type Component, wrapTextWithAnsi } from "@earendil-works/pi-tui";

import type { PeerDelivery, PeerMessageDetails } from "../here.ts";

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
	const top = `${theme.fg(color, theme.bold(who))} ${theme.fg("muted", addressed(details))}`;
	const body = wrapTextWithAnsi(details.text.trim(), Math.max(1, width - ENTRY_X)).map((line) =>
		theme.fg("text", line),
	);
	return entryFrame(body, width, theme, {
		top,
		topRight: theme.fg("dim", formatClock(details.at)),
		color,
	});
}

/** Who the message went to, as this session sees it. */
function addressed(details: PeerMessageDetails): string {
	if (details.toYou) return `${GLYPH.right} you`;
	if (details.takenBy === undefined) return "to everyone, taken here";
	return `to everyone, ${details.takenBy} took it`;
}

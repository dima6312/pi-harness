import { GLYPH } from "@adeildo/pi-kit";
import type { Theme, ThemeColor } from "@earendil-works/pi-coding-agent";

import type { BoardMark } from "../here.ts";

/**
 * The status other interfaces read, from the RPC client to a remote bridge. The look draws its own
 * segment from the peers contract, so this is the plain text form of the same summary.
 */
export function statusLine(
	summary: { others: BoardMark[]; unread: number },
	theme: Theme,
): string | undefined {
	// The colour comes from the contract as a name, so a peer looks the same everywhere.
	const marks = summary.others.map((one) => theme.fg(one.color as ThemeColor, MARKS[one.state]));
	if (summary.unread > 0) marks.push(theme.fg("warning", `@${summary.unread}`));
	return marks.length === 0 ? undefined : marks.join(" ");
}

export const PEERS_STATUS = "pi-peers";

/** The shape tells the state apart with colour off: running is filled, idle is hollow. */
const MARKS: Record<BoardMark["state"], string> = {
	running: GLYPH.diamond,
	idle: GLYPH.diamondEmpty,
	waiting: GLYPH.flag,
};

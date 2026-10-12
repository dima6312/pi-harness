import type { Theme } from "@earendil-works/pi-coding-agent";

import type { BoardMark } from "../here.ts";

/** The look's footer line: one mark per other session, and how many wait for an answer. */
export function statusLine(
	summary: { others: BoardMark[]; unread: number },
	theme: Theme,
): string | undefined {
	const marks = summary.others.map((one) => theme.fg(one.color, MARKS[one.state]));
	if (summary.unread > 0) marks.push(theme.fg("warning", `@${summary.unread}`));
	return marks.length === 0 ? undefined : marks.join(" ");
}

export const PEERS_STATUS = "pi-peers";

/** The shape tells the state apart with colour off: running is filled, idle is hollow. */
const MARKS: Record<BoardMark["state"], string> = {
	running: "\u25c6",
	idle: "\u25c7",
	waiting: "\u2691",
};

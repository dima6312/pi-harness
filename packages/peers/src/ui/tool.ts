// The peers tool in the chat of the agent that calls it: the message as the model writes it, then a
// tick per recipient that turns into two when it arrives and lights up when it is read.
import { GLYPH } from "@adeildo/pi-kit";
import type { Delivery } from "@adeildo/pi-kit";
import type { AgentToolResult, Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import { type Component, truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";

import { addressees } from "../folder.ts";
import type { Here } from "../here.ts";
import type { SentDetails } from "../index.ts";
import { award } from "../rules.ts";

interface Args {
	action?: string;
	to?: string;
	text?: string;
}

interface Row {
	argsComplete: boolean;
	invalidate(): void;
	state: { watching?: boolean };
}

const CURSOR = GLYPH.bar;
const INDENT = "  ";

const ARRIVED: Record<Delivery, string> = {
	woke: "woke it",
	"after-run": "gets it after its run",
	steered: "cut into its run",
	"next-turn": "gets it with the next prompt",
};

/** Rows to redraw when the folder changes, so a tick turns into two while you watch. */
export function toolRenderers(here: Here, rows: Set<() => void>) {
	const watch = (row: Row) => {
		if (row.state.watching) return;
		row.state.watching = true;
		rows.add(row.invalidate);
	};
	return {
		renderCall: (args: Args, theme: Theme, row: Row): Component => {
			// Drawn again only when the width changes or the arguments finish arriving.
			let drawn: { key: string; lines: string[] } | undefined;
			return {
				render(width) {
					const key = `${width}\u0000${row.argsComplete}`;
					if (drawn?.key !== key)
						drawn = { key, lines: callLines(here, args, theme, width, !row.argsComplete) };
					return drawn.lines;
				},
				invalidate() {
					drawn = undefined;
				},
			};
		},
		renderResult: (
			result: AgentToolResult<SentDetails | undefined>,
			options: { expanded: boolean },
			theme: Theme,
			row: Row,
		): Component => {
			if (result.details !== undefined) watch(row);
			return {
				render: (width) => resultLines(here, result, options.expanded, theme, width),
				invalidate() {},
			};
		},
	};
}

function callLines(
	here: Here,
	args: Args,
	theme: Theme,
	width: number,
	writing: boolean,
): string[] {
	if (args.action !== "send") return [theme.fg("muted", "read the board")];
	const to = (args.to ?? "everyone")
		.split(",")
		.map((name) => name.trim())
		.filter(Boolean)
		.map((name) => {
			const named = [...here.names().values()].find(
				(candidate) => candidate.handle === name.replace(/^@/, ""),
			);
			return named === undefined
				? theme.fg("text", name)
				: theme.fg(named.color as ThemeColor, theme.bold(named.handle));
		});
	const lines = [`${theme.fg("muted", GLYPH.right)} ${to.join(theme.fg("muted", ", "))}`];
	const text = `${args.text ?? ""}${writing ? theme.fg("accent", CURSOR) : ""}`;
	for (const line of wrapTextWithAnsi(text, Math.max(1, width - INDENT.length)))
		lines.push(INDENT + theme.fg("text", line));
	return lines;
}

function resultLines(
	here: Here,
	result: AgentToolResult<SentDetails | undefined>,
	expanded: boolean,
	theme: Theme,
	width: number,
): string[] {
	const text = result.content.map((part) => (part.type === "text" ? part.text : "")).join("\n");
	const details = result.details;
	if (details === undefined) {
		const lines = text.split("\n");
		return (expanded ? lines : lines.slice(0, 1)).map((line) =>
			truncateToWidth(theme.fg("muted", line), width, "..."),
		);
	}
	const message = here.folder.messages.get(details.id);
	if (message === undefined) return [theme.fg("dim", `${GLYPH.check} sent`)];
	const names = here.names();
	const nameOf = (session: string) => {
		const named = names.get(session);
		const handle = named?.handle ?? here.folder.peers.get(session)?.handle ?? "gone";
		return theme.fg((named?.color ?? "muted") as ThemeColor, handle);
	};

	if (message.to === "any") {
		const bids = [...message.bids]
			.filter(([session]) => session !== here.session || message.from === "you")
			.map(
				([session, bid]) =>
					`${nameOf(session)} ${theme.fg("dim", bid.idle ? bid.fit.toFixed(2) : "busy")}`,
			);
		const lines =
			bids.length === 0
				? [theme.fg("dim", `${GLYPH.check} sent to everyone`)]
				: [`${theme.fg("dim", "bids")}  ${bids.join("   ")}`];
		if (message.takenBy !== undefined)
			lines.push(
				`${theme.fg("success", `${GLYPH.check}${GLYPH.check}`)} ${nameOf(message.takenBy)} ${theme.fg("muted", "took it")}`,
			);
		else if (award(message, here.live(), Date.now()).kind === "waiting")
			lines.push(theme.fg("warning", "everyone is busy: the first to finish takes it"));
		return lines.map((line) => truncateToWidth(line, width, "..."));
	}

	return addressees(message, here.live()).map((session) => {
		const received = message.received.get(session);
		if (message.read.has(session))
			return `${theme.fg("accent", `${GLYPH.check}${GLYPH.check}`)} ${nameOf(session)} ${theme.fg("muted", "read it")}`;
		if (received !== undefined)
			return `${theme.fg("muted", `${GLYPH.check}${GLYPH.check}`)} ${nameOf(session)} ${theme.fg("muted", ARRIVED[received.mode])}`;
		return `${theme.fg("dim", GLYPH.check)} ${nameOf(session)} ${theme.fg("dim", "sent")}`;
	});
}

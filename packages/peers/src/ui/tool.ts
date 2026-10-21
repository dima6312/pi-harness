// The peers tool in the chat of the agent that calls it: the message as the model writes it, then what
// became of it. A message to a few agents gets a line per agent, a tick that turns into two when it
// arrives and lights up when it is read. One to everyone fans out into a row of names, each wearing
// its own ticks, under a count of who read it. One to anyone shows the bids, the countdown, and who
// took it.
import { CUT, GLYPH } from "@adeildo/pi-kit";
import type { Delivery } from "@adeildo/pi-kit";
import type { AgentToolResult, Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import {
	type Component,
	truncateToWidth,
	visibleWidth,
	wrapTextWithAnsi,
} from "@earendil-works/pi-tui";

import { addressees, type Posted } from "../folder.ts";
import type { Here } from "../here.ts";
import type { SentDetails } from "../index.ts";
import { ANYONE_MENTION, EVERYONE_MENTION } from "../mention.ts";
import { award } from "../rules.ts";
import { bar, fit, ON_ITS_WAY_MS } from "./feed.ts";

interface Args {
	action?: string;
	to?: string;
	text?: string;
	urgent?: boolean;
}

interface Row {
	argsComplete: boolean;
	invalidate(): void;
	state: { watching?: boolean; tick?: ReturnType<typeof setTimeout> };
}

/** What the receipts read from this session: the same the room reads. */
export type Source = Pick<Here, "session" | "folder" | "live" | "names">;

const CURSOR = GLYPH.bar;
const INDENT = "  ";
const GAP = "   ";
/** A receipt still moving redraws once a second: enough for a countdown, cheap in a long transcript. */
const TICK_MS = 1_000;

const EVERYONE = new Set([EVERYONE_MENTION, "all", "room"]);
const ANYONE = new Set([ANYONE_MENTION, "any"]);

const ARRIVED: Record<Delivery, string> = {
	woke: "woke it",
	"after-run": "gets it after its run",
	steered: "cut into its run",
	"next-turn": "gets it with the next prompt",
};

/** Where a message got with one agent, in the order it gets there. */
type Stage = "read" | "got" | "sending" | "sent";
const STAGES: readonly Stage[] = ["read", "got", "sending", "sent"];

/** Who the tool's `to` names, read the way the tool reads it when it sends. */
export function audienceOf(to: string | undefined): "all" | "any" | string[] {
	const wanted = (to ?? EVERYONE_MENTION)
		.split(",")
		.map((name) => name.trim())
		.filter(Boolean);
	if (wanted.some((name) => EVERYONE.has(name.toLowerCase()))) return "all";
	if (wanted.some((name) => ANYONE.has(name.toLowerCase()))) return "any";
	return wanted;
}

/** Rows to redraw when the folder changes, so a tick turns into two while you watch. */
export function toolRenderers(here: Source, rows: Set<() => void>) {
	const watch = (row: Row) => {
		if (row.state.watching) return;
		row.state.watching = true;
		rows.add(row.invalidate);
	};
	// The folder only says when something arrives; a countdown or a bid window closing needs the clock.
	const tick = (row: Row) => {
		if (row.state.tick !== undefined) return;
		row.state.tick = setTimeout(() => {
			row.state.tick = undefined;
			row.invalidate();
		}, TICK_MS);
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
				render: (width) => {
					const now = Date.now();
					const message =
						result.details === undefined ? undefined : here.folder.messages.get(result.details.id);
					if (message !== undefined && moving(here, message, now)) tick(row);
					return resultLines(here, result, options.expanded, theme, width, now);
				},
				invalidate() {},
			};
		},
	};
}

export function callLines(
	here: Source,
	args: Args,
	theme: Theme,
	width: number,
	writing: boolean,
): string[] {
	if (args.action !== "send") return [theme.fg("muted", "read the board")];
	const urgent = args.urgent === true ? theme.fg("warning", `  ${GLYPH.flag} urgent`) : "";
	const lines = [
		truncateToWidth(
			`${theme.fg("muted", GLYPH.right)} ${addressLine(here, audienceOf(args.to), theme)}${urgent}`,
			width,
			CUT,
		),
	];
	const text = `${args.text ?? ""}${writing ? theme.fg("accent", CURSOR) : ""}`;
	for (const line of wrapTextWithAnsi(text, Math.max(1, width - INDENT.length)))
		lines.push(INDENT + theme.fg("text", line));
	return lines;
}

/** Who the message goes to. A group is written as the group, with what it means next to it. */
function addressLine(here: Source, to: "all" | "any" | string[], theme: Theme): string {
	if (to === "all" || to === "any") {
		const group = theme.fg(
			"accent",
			theme.bold(`@${to === "all" ? EVERYONE_MENTION : ANYONE_MENTION}`),
		);
		const others = here.live().filter((peer) => peer.session !== here.session).length;
		return `${group}  ${theme.fg("dim", audienceNote(to, others))}`;
	}
	const names = [...here.names().values()];
	return to
		.map((name) => {
			const named = names.find((candidate) => candidate.handle === name.replace(/^@/, ""));
			return named === undefined
				? theme.fg("text", name)
				: theme.fg(named.color as ThemeColor, theme.bold(named.handle));
		})
		.join(theme.fg("muted", ", "));
}

function audienceNote(to: "all" | "any", others: number): string {
	if (others === 0) return "nobody else is here yet";
	const agents = others === 1 ? "1 agent" : `${others} agents`;
	return to === "all" ? `${agents} get it` : `${agents} bid, the best fit takes it`;
}

export function resultLines(
	here: Source,
	result: AgentToolResult<SentDetails | undefined>,
	expanded: boolean,
	theme: Theme,
	width: number,
	now: number,
): string[] {
	const details = result.details;
	if (details === undefined) {
		const text = result.content.map((part) => (part.type === "text" ? part.text : "")).join("\n");
		const lines = text.split("\n");
		return (expanded ? lines : lines.slice(0, 1)).map((line) =>
			truncateToWidth(theme.fg("muted", line), width, CUT),
		);
	}
	const message = here.folder.messages.get(details.id);
	if (message === undefined) return [theme.fg("dim", `${GLYPH.check} sent`)];
	const receipts = new Receipts(here, message, theme, now);
	if (message.to === "any") return receipts.request(width);
	if (message.to === "all" && !expanded) return receipts.fanOut(width);
	return receipts.each().map((line) => truncateToWidth(line, width, CUT));
}

/** Whether the receipt still changes with time: bids open, a turn to take, or a message on its way. */
function moving(here: Source, message: Posted, now: number): boolean {
	if (message.to === "any") {
		const kind = award(message, here.live(), now).kind;
		return kind === "bidding" || kind === "ranked";
	}
	if (now - message.at >= ON_ITS_WAY_MS) return false;
	return addressees(message, here.live()).some(
		(session) => stageOf(here, message, session, now) === "sending",
	);
}

function stageOf(here: Source, message: Posted, session: string, now: number): Stage {
	if (message.read.has(session)) return "read";
	if (message.received.has(session)) return "got";
	const open = here.live().some((peer) => peer.session === session);
	return open && now - message.at < ON_ITS_WAY_MS ? "sending" : "sent";
}

class Receipts {
	readonly #here: Source;
	readonly #message: Posted;
	readonly #theme: Theme;
	readonly #now: number;

	constructor(here: Source, message: Posted, theme: Theme, now: number) {
		this.#here = here;
		this.#message = message;
		this.#theme = theme;
		this.#now = now;
	}

	/** A line per agent, with how it arrived: for a few named agents, or everyone expanded. */
	each(): string[] {
		const theme = this.#theme;
		const message = this.#message;
		return this.#addressees().map((session) => {
			const who = this.#name(session);
			const stage = stageOf(this.#here, message, session, this.#now);
			switch (stage) {
				case "read":
					return `${this.#ticks(stage)} ${who} ${theme.fg("muted", "read it")}`;
				case "got": {
					const mode = message.received.get(session)?.mode ?? "woke";
					return `${this.#ticks(stage)} ${who} ${theme.fg("muted", ARRIVED[mode])}`;
				}
				case "sending":
					return `${this.#ticks(stage)} ${who} ${theme.fg("dim", "on its way")}`;
				case "sent":
					return `${this.#ticks(stage)} ${who} ${theme.fg("dim", "sent")}`;
			}
		});
	}

	/**
	 * A message to everyone: how far it got in one line, then every agent as a name with its own ticks,
	 * those that read it first. Expanding the row gives the line per agent.
	 */
	fanOut(width: number): string[] {
		const theme = this.#theme;
		const to = this.#addressees();
		if (to.length === 0)
			return [theme.fg("dim", `${GLYPH.check} sent, nobody else is here to get it`)];
		const reached = to
			.map((session) => ({
				session,
				stage: stageOf(this.#here, this.#message, session, this.#now),
			}))
			.toSorted((a, b) => STAGES.indexOf(a.stage) - STAGES.indexOf(b.stage));
		const chips = reached.map(
			({ session, stage }) => `${this.#name(session)} ${this.#ticks(stage)}`,
		);
		return [
			truncateToWidth(this.#tally(reached.map(({ stage }) => stage)), width, CUT),
			...flow(chips, width - INDENT.length).map((line) => INDENT + line),
		];
	}

	/** A request to anyone: where the bidding is, then the bids, the best first. */
	request(width: number): string[] {
		const theme = this.#theme;
		const message = this.#message;
		const live = this.#here.live();
		const ranking = award(message, live, this.#now);
		const candidates = live
			.map((peer) => peer.session)
			.filter((session) => session !== message.session || message.from === "you");
		let status: string;
		switch (ranking.kind) {
			case "taken":
				status = `${theme.fg("success", `${GLYPH.check}${GLYPH.check}`)} ${this.#name(ranking.by)} ${theme.fg("muted", "took it")}`;
				break;
			case "bidding": {
				const left = Math.max(1, Math.ceil((ranking.until - this.#now) / 1_000));
				const bid = candidates.filter((session) => message.bids.has(session)).length;
				status = `${theme.fg("accent", GLYPH.diamondEmpty)} ${theme.fg("text", `${bid} of ${candidates.length} bid`)}${theme.fg("dim", `, bids close in ${left}s`)}`;
				break;
			}
			case "waiting":
				status = `${theme.fg("warning", GLYPH.flag)} ${theme.fg("muted", "everyone is busy, the first to finish takes it")}`;
				break;
			case "ranked": {
				const next = ranking.order[0];
				status =
					next === undefined
						? theme.fg("dim", "nobody in line")
						: `${theme.fg("accent", GLYPH.diamond)} ${this.#name(next)} ${theme.fg("muted", "is taking it")}`;
				break;
			}
		}
		const bids = [...message.bids]
			// Once someone took it, the busy ones no longer matter.
			.filter(
				([session, bid]) => candidates.includes(session) && (bid.idle || ranking.kind !== "taken"),
			)
			.toSorted(([, a], [, b]) => Number(b.idle) - Number(a.idle) || b.fit - a.fit)
			.map(([session, bid]) => {
				const who = this.#name(session);
				if (!bid.idle) return `${who} ${theme.fg("dim", "busy")}`;
				const color = (this.#here.names().get(session)?.color ?? "muted") as ThemeColor;
				return `${who} ${bar(bid.fit, color, theme)} ${theme.fg("dim", fit(bid.fit))}`;
			});
		// While the window is open, the agents still thinking about their bid show as waiting.
		if (ranking.kind === "bidding")
			for (const session of candidates)
				if (!message.bids.has(session))
					bids.push(`${this.#name(session)} ${theme.fg("dim", "thinking")}`);
		return [
			truncateToWidth(status, width, CUT),
			...flow(bids, width - INDENT.length).map((line) => INDENT + line),
		];
	}

	/**
	 * The group's ticks are the furthest every agent got, as a group chat shows them: lit only when all
	 * of them read it. The words count each stage.
	 */
	#tally(stages: readonly Stage[]): string {
		const theme = this.#theme;
		const count = (stage: Stage) => stages.filter((one) => one === stage).length;
		const slowest = stages.at(-1) ?? "sent";
		const read = count("read");
		if (read === stages.length) {
			const words = read === 1 ? "read it" : `all ${read} read it`;
			return `${this.#ticks("read")} ${theme.fg("text", words)}`;
		}
		const rest = [
			[count("got"), "got it"],
			[count("sending"), "on its way"],
			[count("sent"), "sent"],
		] as const;
		const parts = rest.filter(([n]) => n > 0).map(([n, words]) => theme.fg("dim", `${n} ${words}`));
		return [
			`${this.#ticks(slowest)} ${theme.fg("text", `${read} of ${stages.length} read`)}`,
			...parts,
		].join(theme.fg("dim", ", "));
	}

	#addressees(): string[] {
		return addressees(this.#message, this.#here.live());
	}

	#ticks(stage: Stage): string {
		const theme = this.#theme;
		const two = `${GLYPH.check}${GLYPH.check}`;
		switch (stage) {
			case "read":
				return theme.fg("accent", two);
			case "got":
				return theme.fg("muted", two);
			case "sending":
			case "sent":
				return theme.fg("dim", GLYPH.check);
		}
	}

	#name(session: string): string {
		const named = this.#here.names().get(session);
		const handle = named?.handle ?? this.#here.folder.peers.get(session)?.handle ?? "gone";
		return this.#theme.fg((named?.color ?? "muted") as ThemeColor, handle);
	}
}

/** Parts laid out in lines no wider than the room, a part never split across two. */
function flow(parts: readonly string[], width: number): string[] {
	const lines: string[] = [];
	let line = "";
	for (const part of parts) {
		const next = line === "" ? part : `${line}${GAP}${part}`;
		if (line !== "" && visibleWidth(next) > width) {
			lines.push(line);
			line = part;
		} else line = next;
	}
	if (line !== "") lines.push(line);
	return lines.map((one) => truncateToWidth(one, Math.max(1, width), CUT));
}

import { type Delivery, spread } from "@adeildo/pi-kit";
import type { Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";

import type { Happening, Peer, Posted, RoomItem } from "../folder.ts";
import type { Typing } from "../here.ts";
import { byHandle, type Named } from "../names.ts";
import { award, TAKE_MS, turnToTake } from "../rules.ts";
import { blink, dots, isFresh, spin } from "./motion.ts";

/** The words sit under the header behind a rail and a space, the only indent the room uses. */
const INDENT = 2;
const BAR_CELLS = 5;
const TOGETHER_MS = 60_000;
/** A message nobody logged after this stops spinning. */
const ON_ITS_WAY_MS = 60_000;

/** A long message shows this many lines, unless it is the newest or the room is narrowed. */
const BODY_SHOWN = 4;

const ARRIVED: Record<Delivery, string> = {
	woke: "woke it",
	"after-run": "after its run",
	steered: "cut in",
	"next-turn": "next prompt",
};

export interface FeedOptions {
	theme: Theme;
	now: number;
	width: number;
	me: string | undefined;
	names: ReadonlyMap<string, Named>;
	live: readonly Peer[];
	clock: (at: number) => string;
	only?: string;
}

export function feedLines(
	room: readonly RoomItem[],
	typing: readonly Typing[],
	options: FeedOptions,
): string[] {
	return feedView(room, typing, options).lines;
}

/** The room's lines, and for each line the index of its message's header. */
export function feedView(
	room: readonly RoomItem[],
	typing: readonly Typing[],
	options: FeedOptions,
): { lines: string[]; heads: (number | undefined)[] } {
	const { theme } = options;
	const shown =
		options.only === undefined ? room : room.filter((item) => involves(item, options.only ?? ""));
	const lines: string[] = [];
	const heads: (number | undefined)[] = [];
	/** A block of lines; `head` is the line that says who wrote it, kept in view when it scrolls. */
	const add = (block: readonly string[], head?: number) => {
		const at = head === undefined ? undefined : lines.length + head;
		for (const line of block) {
			heads.push(at);
			lines.push(line);
		}
	};
	const gap = () => add([""]);
	const replies = answers(shown);
	const newest = shown.findLast((item) => item.kind === "message");
	for (let index = 0; index < shown.length; index++) {
		const item = shown[index];
		if (item === undefined) continue;
		if (item.kind === "happening") {
			if (item.happening.kind === "took") continue;
			const back = shown[index + 1];
			if (back?.kind === "happening" && restarted(item.happening, back.happening)) {
				if (lines.length > 0 && !lastWasHappening(shown, index - 1)) gap();
				add([restartLine(item.happening, options)]);
				index++;
				continue;
			}
			const group: Happening[] = [item.happening];
			while (true) {
				const next = shown[index + 1];
				if (next?.kind !== "happening" || !together(group[0], next.happening)) break;
				group.push(next.happening);
				index++;
			}
			if (lines.length > 0 && !lastWasHappening(shown, index - group.length)) gap();
			add([happeningLine(group, options)]);
			continue;
		}
		if (lines.length > 0) gap();
		const answered = replies.get(item.message.id);
		const full = item === newest || options.only !== undefined;
		add(messageLines(item.message, answered, full, options), answered === undefined ? 0 : 1);
	}
	const writing =
		options.only === undefined ? typing : typing.filter((one) => one.session === options.only);
	for (const one of writing) {
		if (lines.length > 0) gap();
		add(typingLines(one, options), 0);
	}
	if (lines.length > 0) return { lines, heads };
	const narrowed = options.only === undefined ? undefined : options.names.get(options.only)?.handle;
	const empty =
		narrowed === undefined
			? "Nothing said yet. Write below, or @ to mention one agent."
			: `Nothing from or to ${narrowed} yet.`;
	return { lines: [theme.fg("dim", empty)], heads: [undefined] };
}

/**
 * Like a chat: who wrote it to whom and when on one line, what became of it on the right, the words
 * under it. An answer first quotes the line it answers.
 */
function messageLines(
	message: Posted,
	answered: Posted | undefined,
	full: boolean,
	options: FeedOptions,
): string[] {
	const { theme, now, width } = options;
	const color = speakerColor(message, options);
	const fresh = isFresh(message.at, now);
	const lines: string[] = [];
	if (answered !== undefined) lines.push(quoteLine(answered, options));

	let head = `${speaker(message, options)}${theme.fg("dim", " \u2192 ")}${recipients(message, options)}`;
	head += `  ${theme.fg(fresh ? color : "dim", options.clock(message.at))}`;
	if (message.urgent) head += theme.fg("warning", "  urgent");
	// One addressee's receipt fits on the header line; several, or the bids, go under the words.
	const receipts = receiptLines(message, options);
	const inline = message.to !== "all" && message.to.length === 1 ? receipts.shift() : undefined;
	lines.push(header(head, inline ?? "", width));

	const rail = fresh ? theme.fg(color, "\u2503") : theme.fg("borderMuted", "\u2502");
	const body = message.unsent ? `withdrawn: ${message.text}` : message.text;
	let wrapped = wrapTextWithAnsi(body, Math.max(8, width - INDENT));
	if (!full && wrapped.length > BODY_SHOWN) {
		const hidden = wrapped.length - BODY_SHOWN + 1;
		wrapped = [
			...wrapped.slice(0, BODY_SHOWN - 1),
			theme.fg("dim", `${hidden} more lines, ctrl+f to read`),
		];
	}
	for (const line of wrapped)
		lines.push(`${rail} ${theme.fg(message.unsent ? "dim" : "text", line)}`);
	for (const line of receipts) lines.push(truncateToWidth(`  ${line}`, width, "..."));
	return lines;
}

/** The first line of the message an answer answers, quoted above it. */
function quoteLine(question: Posted, options: FeedOptions): string {
	const { theme, width } = options;
	const first = question.text.split("\n")[0] ?? "";
	const line = `${theme.fg("borderMuted", "\u256d\u2500")} ${speaker(question, options, false)} ${theme.fg("dim", first)}`;
	return truncateToWidth(line, width, "...");
}

function header(left: string, right: string, width: number): string {
	if (right === "") return truncateToWidth(left, width, "...");
	const room = Math.max(8, width - visibleWidth(right) - 2);
	return spread(truncateToWidth(left, room, "..."), right, width);
}

function receiptLines(message: Posted, options: FeedOptions): string[] {
	const { theme, now, live } = options;
	if (message.unsent) return [];
	if (message.to === "all") return requestLines(message, options);
	const many = message.to.length > 1;
	const parts = message.to.map((session) => {
		const who = many ? ` ${name(session, options)}` : "";
		if (message.read.has(session))
			return `${theme.fg("accent", "\u2713\u2713")}${who} ${theme.fg("muted", "read")}`;
		const received = message.received.get(session);
		if (received !== undefined)
			return `${theme.fg("muted", "\u2713\u2713")}${who} ${theme.fg("dim", ARRIVED[received.mode])}`;
		const waiting =
			live.some((peer) => peer.session === session) && now - message.at < ON_ITS_WAY_MS;
		return waiting
			? `${theme.fg("dim", spin(now))}${who} ${theme.fg("dim", "sending")}`
			: `${theme.fg("dim", "\u2713")}${who} ${theme.fg("dim", "sent")}`;
	});
	return [parts.join("   ")];
}

function requestLines(message: Posted, options: FeedOptions): string[] {
	const { theme, now, live } = options;
	const ranking = award(message, live, now);
	const parts = [...message.bids]
		.filter(([, bid]) => bid.idle || ranking.kind !== "taken")
		.toSorted(([, a], [, b]) => Number(b.idle) - Number(a.idle) || b.fit - a.fit)
		.map(([session, bid]) => {
			const who = name(session, options);
			if (!bid.idle) return `${who} ${theme.fg("dim", "busy")}`;
			const color = (options.names.get(session)?.color ?? "muted") as ThemeColor;
			return `${who} ${bar(bid.fit, color, theme)} ${theme.fg("dim", fit(bid.fit))}`;
		});
	const bids = fitting(
		parts,
		options.width - INDENT - (ranking.kind === "bidding" ? 14 : 0),
		theme,
	);
	switch (ranking.kind) {
		case "taken":
			return [
				...(bids === "" ? [] : [bids]),
				`${theme.fg("success", "\u2713\u2713")} ${name(ranking.by, options)} ${theme.fg("muted", "took it")}`,
			];
		case "bidding": {
			const left = Math.max(1, Math.ceil((ranking.until - now) / 1_000));
			const state = `${theme.fg("accent", spin(now))} ${theme.fg("muted", `bidding ${left}s`)}`;
			return [bids === "" ? state : `${state}   ${bids}`];
		}
		case "waiting":
			return [
				...(bids === "" ? [] : [bids]),
				`${theme.fg("warning", "\u2691")} ${theme.fg("muted", "everyone is busy, the first to finish takes it")}`,
			];
		case "ranked": {
			const first = ranking.order.find((session) => {
				const at = turnToTake(ranking, session);
				return at !== undefined && at + TAKE_MS > now;
			});
			const next = first ?? ranking.order[0];
			return [
				bids,
				next === undefined
					? theme.fg("dim", "nobody in line")
					: `${theme.fg("accent", spin(now))} ${name(next, options)} ${theme.fg("muted", "is taking it")}`,
			];
		}
	}
}

function typingLines(typing: Typing, options: FeedOptions): string[] {
	const { theme, now, width } = options;
	const named = options.names.get(typing.session);
	const color = (named?.color ?? "muted") as ThemeColor;
	const to =
		typing.to === "everyone"
			? theme.fg("muted", "everyone")
			: typing.to
					.split(",")
					.map((part) => {
						const written = part.trim().replace(/^@/, "");
						const one = byHandle(options.names, written);
						return theme.fg((one?.color ?? "muted") as ThemeColor, written);
					})
					.join(theme.fg("dim", ", "));
	const head = `${theme.fg(color, theme.bold(named?.handle ?? "an agent"))}${theme.fg("dim", " \u2192 ")}${to}  ${theme.fg(color, spin(now))} ${theme.fg("dim", `writing${dots(now)}`)}`;
	const lines = [truncateToWidth(head, width, "...")];
	const room = Math.max(8, width - INDENT - 1);
	const cursor = blink(now) ? theme.fg(color, "\u258c") : " ";
	const wrapped = wrapTextWithAnsi(typing.text, room).slice(-2);
	if (wrapped.length === 0) wrapped.push("");
	for (const [index, line] of wrapped.entries()) {
		const last = index === wrapped.length - 1;
		lines.push(
			`${theme.fg("borderMuted", "\u2502")} ${theme.fg("muted", line)}${last ? cursor : ""}`,
		);
	}
	return lines;
}

function happeningLine(group: readonly Happening[], options: FeedOptions): string {
	const { theme } = options;
	const first = group[0];
	if (first === undefined) return "";
	const who = group.map((one) => name(one.session, options));
	const names =
		who.length < 3
			? who.join(theme.fg("dim", " and "))
			: `${who.slice(0, -1).join(theme.fg("dim", ", "))}${theme.fg("dim", " and ")}${who.at(-1)}`;
	let line: string;
	switch (first.kind) {
		case "joined":
			line = `${theme.fg("dim", "\u2192")} ${names} ${theme.fg("dim", "joined")}`;
			break;
		case "left":
			line = `${theme.fg("dim", "\u2190")} ${names} ${theme.fg("dim", "left")}`;
			break;
		case "committed":
			line = `${theme.fg("syntaxNumber", "\u25cf")} ${names} ${theme.fg("dim", "committed")} ${theme.fg("syntaxNumber", first.sha.slice(0, 7))} ${theme.fg("muted", first.subject)}`;
			break;
		case "finished":
			line = `${theme.fg("success", "\u2713")} ${names} ${theme.fg("dim", "finished")} ${theme.fg("muted", first.task)}`;
			break;
		case "took":
			return "";
	}
	return stamped(line, first.at, options);
}

/** A line of the room with its time after it, the line giving way so the time always shows. */
function stamped(line: string, at: number, options: FeedOptions): string {
	const time = `  ${options.theme.fg("dim", options.clock(at))}`;
	const room = Math.max(8, options.width - visibleWidth(time));
	return `${truncateToWidth(line, room, "...")}${time}`;
}

/** Left and came back within a minute: the session was reloaded. */
function restarted(left: Happening, back: Happening): boolean {
	return (
		left.kind === "left" &&
		back.kind === "joined" &&
		left.session === back.session &&
		back.at - left.at < TOGETHER_MS
	);
}

function restartLine(left: Happening, options: FeedOptions): string {
	const { theme } = options;
	const line = `${theme.fg("dim", "\u21bb")} ${name(left.session, options)} ${theme.fg("dim", "restarted")}`;
	return stamped(line, left.at, options);
}

function together(first: Happening | undefined, next: Happening): boolean {
	if (first === undefined || first.kind !== next.kind) return false;
	if (first.kind !== "joined" && first.kind !== "left") return false;
	return next.at - first.at < TOGETHER_MS;
}

function lastWasHappening(room: readonly RoomItem[], index: number): boolean {
	for (let at = index; at >= 0; at--) {
		const item = room[at];
		if (item === undefined) return false;
		if (item.kind === "message") return false;
		if (item.happening.kind !== "took") return true;
	}
	return false;
}

/** A message answers the last one its addressee sent its writer, or the request its writer took. */
function answers(room: readonly RoomItem[]): Map<string, Posted> {
	const found = new Map<string, Posted>();
	const asked = new Map<string, Posted>();
	for (const item of room) {
		if (item.kind !== "message") continue;
		const message = item.message;
		if (message.to !== "all" && message.to.length === 1) {
			const to = message.to[0] ?? "";
			const question = asked.get(`${to}>${message.session}`);
			if (question !== undefined && question.at <= message.at) {
				found.set(message.id, question);
				asked.delete(`${to}>${message.session}`);
			}
			asked.set(`${message.session}>${to}`, message);
		}
		if (message.to === "all" && message.takenBy !== undefined)
			asked.set(`${message.session}>${message.takenBy}`, message);
	}
	return found;
}

function involves(item: RoomItem, session: string): boolean {
	if (item.kind === "happening") return item.happening.session === session;
	const message = item.message;
	if (message.session === session || message.takenBy === session) return true;
	return message.to === "all" ? message.bids.has(session) : message.to.includes(session);
}

function speaker(message: Posted, options: FeedOptions, bold = true): string {
	const { theme } = options;
	const who = message.from === "you" ? "you" : handle(message.session, options);
	return theme.fg(speakerColor(message, options), bold ? theme.bold(who) : who);
}

function speakerColor(message: Posted, options: FeedOptions): ThemeColor {
	if (message.from === "you") return "accent";
	return (options.names.get(message.session)?.color ?? "muted") as ThemeColor;
}

function recipients(message: Posted, options: FeedOptions): string {
	const { theme } = options;
	if (message.to === "all") return theme.fg("muted", "everyone");
	return message.to.map((session) => name(session, options)).join(theme.fg("dim", ", "));
}

function name(session: string, options: FeedOptions): string {
	const color = (options.names.get(session)?.color ?? "muted") as ThemeColor;
	return options.theme.fg(color, handle(session, options));
}

function handle(session: string, options: FeedOptions): string {
	return (
		options.names.get(session)?.handle ??
		options.live.find((peer) => peer.session === session)?.handle ??
		"gone"
	);
}

function fitting(parts: readonly string[], width: number, theme: Theme): string {
	const gap = "  ";
	let line = "";
	for (const [index, part] of parts.entries()) {
		const next = line === "" ? part : `${line}${gap}${part}`;
		const more = parts.length - index - 1;
		const tail = more > 0 ? visibleWidth(`${gap}+${more}`) : 0;
		if (visibleWidth(next) + tail > width)
			return `${line}${theme.fg("dim", `${gap}+${parts.length - index}`)}`;
		line = next;
	}
	return line;
}

function bar(value: number, color: ThemeColor, theme: Theme): string {
	const filled = Math.max(0, Math.min(BAR_CELLS, Math.round(value * BAR_CELLS)));
	return (
		theme.fg(color, "\u25b0".repeat(filled)) + theme.fg("dim", "\u25b1".repeat(BAR_CELLS - filled))
	);
}

function fit(value: number): string {
	return value >= 1 ? "1.0" : value.toFixed(2).replace(/^0/, "");
}

export function feedMoving(room: readonly RoomItem[], live: readonly Peer[], now: number): boolean {
	for (let index = room.length - 1; index >= 0; index--) {
		const item = room[index];
		if (item?.kind !== "message") continue;
		const message = item.message;
		if (now - message.at >= ON_ITS_WAY_MS) break;
		if (isFresh(message.at, now)) return true;
		if (message.unsent) continue;
		if (message.to === "all") {
			const kind = award(message, live, now).kind;
			if (kind === "bidding" || kind === "ranked") return true;
		} else if (
			message.to.some(
				(session) =>
					!message.received.has(session) && live.some((peer) => peer.session === session),
			)
		)
			return true;
	}
	return false;
}

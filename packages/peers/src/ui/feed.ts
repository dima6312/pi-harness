import { type Delivery, CUT, ENTRY_X, entryFrame, GLYPH } from "@adeildo/pi-kit";
import type { Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";

import { addressees, type Happening, type Peer, type Posted, type RoomItem } from "../folder.ts";
import type { Typing } from "../here.ts";
import { audienceLabel } from "../mention.ts";
import type { Named } from "../names.ts";
import { award, TAKE_MS, turnToTake } from "../rules.ts";
import { blink, dots, isFresh, spin } from "./motion.ts";
import { typingRecipients } from "./typing.ts";

/** The words sit two columns under the header, the only indent the room uses. */
const INDENT = 2;
const BAR_CELLS = 5;
const TOGETHER_MS = 60_000;
/** A message nobody logged after this stops spinning. */
export const ON_ITS_WAY_MS = 60_000;

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
	/** A block of lines; `head` says its first line names who wrote it, kept in view when it scrolls. */
	const add = (block: readonly string[], head = false) => {
		const at = head ? lines.length : undefined;
		for (const line of block) {
			heads.push(at);
			lines.push(line);
		}
	};
	const gap = () => add([""]);
	const replies = answers(shown);
	const newest = shown.findLast((item) => item.kind === "message");
	let lastMessage: Posted | undefined;
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
		// An answer right under its question needs no quote: the order already says it.
		const answered = replies.get(item.message.id);
		const quoted = answered !== undefined && answered !== lastMessage ? answered : undefined;
		const full = item === newest || options.only !== undefined;
		add(messageLines(item.message, quoted, full, options), true);
		lastMessage = item.message;
	}
	const writing =
		options.only === undefined ? typing : typing.filter((one) => one.session === options.only);
	for (const one of writing) {
		if (lines.length > 0) gap();
		add(typingLines(one, options), true);
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
 * A message wears the frame of a transcript entry: who wrote it to whom on the top edge with the time
 * on the right, the words inside, and what became of it on the bottom edge. An answer first quotes the
 * line it answers. See DESIGN.md, "The transcript".
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
	const room = Math.max(8, width - ENTRY_X - INDENT);
	const body: string[] = [];
	if (answered !== undefined) body.push(` ${quoteLine(answered, options)}`);

	// Only a message that just arrived keeps its rail lit, in its writer's color.
	const lead = fresh ? `${theme.fg(color, "\u258e")} ` : "  ";
	let wrapped = wrapTextWithAnsi(message.text.trim(), room);
	if (!full) {
		// A preview skips blank lines, so its few lines carry words.
		const words = wrapped.filter((line) => line.trim() !== "");
		if (words.length > BODY_SHOWN)
			wrapped = [
				...words.slice(0, BODY_SHOWN - 1),
				theme.fg("dim", `${words.length - BODY_SHOWN + 1} more lines, ctrl+f to read`),
			];
	}
	for (const line of wrapped) body.push(`${lead}${theme.fg("text", line)}`);

	const receipts = receiptLines(message, options, room);
	for (const line of receipts.inside) body.push(`  ${line}`);
	return entryFrame(body, width, theme, {
		top: `${speaker(message, options)}${theme.fg("dim", ` ${GLYPH.right} `)}${recipients(message, options)}${message.urgent ? theme.fg("warning", `  ${GLYPH.flag} urgent`) : ""}`,
		topRight: theme.fg(fresh ? color : "dim", options.clock(message.at)),
		bottom: receipts.bottom,
		color,
	});
}

/** The first line of the message an answer answers, quoted above it. */
function quoteLine(question: Posted, options: FeedOptions): string {
	const { theme } = options;
	const first = question.text.split("\n")[0] ?? "";
	return `${theme.fg("dim", "\u21b1")} ${speaker(question, options, false)} ${theme.fg("dim", first)}`;
}

interface Receipts {
	/** What the message became, for the frame's bottom edge. */
	bottom: string | undefined;
	/** What needs lines of its own inside the frame: the bids of a request for everyone. */
	inside: readonly string[];
}

function receiptLines(message: Posted, options: FeedOptions, room: number): Receipts {
	const { theme, now, live } = options;
	if (message.to === "any") return requestLines(message, options, room);
	if (message.to === "all") return { bottom: tally(message, options), inside: [] };
	const to = addressees(message, live);
	const many = to.length > 1;
	const parts = to.map((session) => {
		const who = many ? ` ${name(session, options)}` : "";
		if (message.read.has(session))
			return `${theme.fg("accent", `${GLYPH.check}${GLYPH.check}`)}${who} ${theme.fg("muted", "read")}`;
		const received = message.received.get(session);
		if (received !== undefined)
			return `${theme.fg("muted", `${GLYPH.check}${GLYPH.check}`)}${who} ${theme.fg("dim", ARRIVED[received.mode])}`;
		const waiting =
			live.some((peer) => peer.session === session) && now - message.at < ON_ITS_WAY_MS;
		return waiting
			? `${theme.fg("dim", spin(now))}${who} ${theme.fg("dim", "sending")}`
			: `${theme.fg("dim", GLYPH.check)}${who} ${theme.fg("dim", "sent")}`;
	});
	return { bottom: parts.join("   "), inside: [] };
}

/** Where a message to everyone got: how many read it, got it, and still have it on its way. */
function tally(message: Posted, options: FeedOptions): string {
	const { theme, live } = options;
	const to = addressees(message, live);
	const read = to.filter((session) => message.read.has(session)).length;
	const got = to.filter(
		(session) => !message.read.has(session) && message.received.has(session),
	).length;
	const sent = to.length - read - got;
	const parts = [];
	if (read > 0)
		parts.push(
			`${theme.fg("accent", `${GLYPH.check}${GLYPH.check}`)} ${theme.fg("muted", `${read} read`)}`,
		);
	if (got > 0)
		parts.push(
			`${theme.fg("muted", `${GLYPH.check}${GLYPH.check}`)} ${theme.fg("dim", `${got} got it`)}`,
		);
	if (sent > 0) parts.push(`${theme.fg("dim", GLYPH.check)} ${theme.fg("dim", `${sent} sent`)}`);
	return parts.join("   ");
}

function requestLines(message: Posted, options: FeedOptions, room: number): Receipts {
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
	const bids = fitting(parts, room, theme);
	const inside = bids === "" ? [] : [bids];
	switch (ranking.kind) {
		case "taken":
			return {
				bottom: `${theme.fg("success", `${GLYPH.check}${GLYPH.check}`)} ${name(ranking.by, options)} ${theme.fg("muted", "took it")}`,
				inside,
			};
		case "bidding": {
			const left = Math.max(1, Math.ceil((ranking.until - now) / 1_000));
			return {
				bottom: `${theme.fg("accent", spin(now))} ${theme.fg("muted", `bidding ${left}s`)}`,
				inside,
			};
		}
		case "waiting":
			return {
				bottom: `${theme.fg("warning", GLYPH.flag)} ${theme.fg("muted", "everyone is busy, the first to finish takes it")}`,
				inside,
			};
		case "ranked": {
			const first = ranking.order.find((session) => {
				const at = turnToTake(ranking, session);
				return at !== undefined && at + TAKE_MS > now;
			});
			const next = first ?? ranking.order[0];
			return {
				bottom:
					next === undefined
						? theme.fg("dim", "nobody in line")
						: `${theme.fg("accent", spin(now))} ${name(next, options)} ${theme.fg("muted", "is taking it")}`,
				inside,
			};
		}
	}
}

function typingLines(typing: Typing, options: FeedOptions): string[] {
	const { theme, now, width } = options;
	const named = options.names.get(typing.session);
	const color = (named?.color ?? "muted") as ThemeColor;
	const room = Math.max(8, width - ENTRY_X - INDENT);
	const cursor = blink(now) ? theme.fg(color, GLYPH.bar) : " ";
	const wrapped = wrapTextWithAnsi(typing.text, room).slice(-2);
	if (wrapped.length === 0) wrapped.push("");
	const body = wrapped.map(
		(line, index) => `  ${theme.fg("muted", line)}${index === wrapped.length - 1 ? cursor : ""}`,
	);
	// A draft has not happened yet, so it wears the dashed frame the send queue wears.
	return entryFrame(body, width, theme, {
		top: `${theme.fg(color, theme.bold(`@${named?.handle ?? "an agent"}`))}${theme.fg("dim", ` ${GLYPH.right} `)}${typingRecipients(typing.to, options.names, theme)}`,
		topRight: `${theme.fg(color, spin(now))} ${theme.fg("dim", `writing${dots(now)}`)}`,
		color,
		dashed: true,
	});
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
			line = `${theme.fg("dim", GLYPH.right)} ${names} ${theme.fg("dim", "joined")}`;
			break;
		case "left":
			line = `${theme.fg("dim", GLYPH.left)} ${names} ${theme.fg("dim", "left")}`;
			break;
		case "committed":
			line = `${theme.fg("syntaxNumber", GLYPH.dot)} ${names} ${theme.fg("dim", "committed")} ${theme.fg("syntaxNumber", first.sha.slice(0, 7))} ${theme.fg("muted", first.subject)}`;
			break;
		case "finished":
			line = `${theme.fg("success", GLYPH.check)} ${names} ${theme.fg("dim", "finished")} ${theme.fg("muted", first.task)}`;
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
	return `${truncateToWidth(line, room, CUT)}${time}`;
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
	const line = `${theme.fg("dim", GLYPH.again)} ${name(left.session, options)} ${theme.fg("dim", "restarted")}`;
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
		if (Array.isArray(message.to) && message.to.length === 1) {
			const to = message.to[0] ?? "";
			const question = asked.get(`${to}>${message.session}`);
			if (question !== undefined && question.at <= message.at) {
				found.set(message.id, question);
				asked.delete(`${to}>${message.session}`);
			}
			asked.set(`${message.session}>${to}`, message);
		}
		if (message.to === "any" && message.takenBy !== undefined)
			asked.set(`${message.session}>${message.takenBy}`, message);
	}
	return found;
}

function involves(item: RoomItem, session: string): boolean {
	if (item.kind === "happening") return item.happening.session === session;
	const message = item.message;
	if (message.session === session || message.takenBy === session) return true;
	if (message.to === "any") return message.bids.has(session);
	return message.to === "all" || message.to.includes(session);
}

function speaker(message: Posted, options: FeedOptions, bold = true): string {
	const { theme } = options;
	const who = message.from === "you" ? "you" : `@${handle(message.session, options)}`;
	return theme.fg(speakerColor(message, options), bold ? theme.bold(who) : who);
}

function speakerColor(message: Posted, options: FeedOptions): ThemeColor {
	if (message.from === "you") return "accent";
	return (options.names.get(message.session)?.color ?? "muted") as ThemeColor;
}

function recipients(message: Posted, options: FeedOptions): string {
	const { theme } = options;
	if (message.to === "all" || message.to === "any")
		return theme.fg("muted", audienceLabel(message.to));
	return message.to
		.map((session) => {
			const color = (options.names.get(session)?.color ?? "muted") as ThemeColor;
			return theme.fg(color, `@${handle(session, options)}`);
		})
		.join(theme.fg("dim", ", "));
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

/** How well an agent fits a request, as a short row of cells in its color. */
export function bar(value: number, color: ThemeColor, theme: Theme): string {
	const filled = Math.max(0, Math.min(BAR_CELLS, Math.round(value * BAR_CELLS)));
	return (
		theme.fg(color, "\u25b0".repeat(filled)) + theme.fg("dim", "\u25b1".repeat(BAR_CELLS - filled))
	);
}

/** A fit as the room writes it: `.62`, or `1.0`. */
export function fit(value: number): string {
	return value >= 1 ? "1.0" : value.toFixed(2).replace(/^0/, "");
}

export function feedMoving(room: readonly RoomItem[], live: readonly Peer[], now: number): boolean {
	for (let index = room.length - 1; index >= 0; index--) {
		const item = room[index];
		if (item?.kind !== "message") continue;
		const message = item.message;
		if (now - message.at >= ON_ITS_WAY_MS) break;
		if (isFresh(message.at, now)) return true;
		if (message.to === "any") {
			const kind = award(message, live, now).kind;
			if (kind === "bidding" || kind === "ranked") return true;
		} else if (
			addressees(message, live).some(
				(session) =>
					!message.received.has(session) && live.some((peer) => peer.session === session),
			)
		)
			return true;
	}
	return false;
}

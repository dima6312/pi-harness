// Draws every tool call in a frame of its own: the mark and the name on the top rule, the call and
// its result inside, and how it went on the bottom rule.
import {
	CUT,
	type CallRuling,
	type FeatureScope,
	FRAMED,
	isObject,
	RULING_CHANGED,
	type RulingTone,
	rulingOf,
	GLYPH,
	LINE,
} from "@adeildo/pi-kit";
import type { Theme, ToolRenderers } from "@earendil-works/pi-coding-agent";
import {
	type Component,
	getKeybindings,
	stripTerminalSequences,
	Text,
	truncateToWidth,
	visibleWidth,
} from "@earendil-works/pi-tui";

import { tabs } from "../render/format.ts";
import { type IconSet, glyphsOf } from "../render/glyphs.ts";
import { type Stream, STREAMERS } from "../render/streaming.ts";
import { stateMark, toolIcon, toolLabel } from "../render/tools.ts";
import { icons } from "../settings.ts";

/** What the call is doing, which is what the bottom rule says while it has no result yet. */
type Phase = "writing" | "waiting" | "running" | "done" | "failed";

const PHASE_COLORS = {
	writing: "muted",
	waiting: "accent",
	running: "accent",
	done: "success",
	failed: "error",
} as const;
const BODY_PAD = 4;
const COLLAPSED_ARGS_CHARS = 100;
/** How many lines of a result the frame prints before telling you the rest is there. */
const RESULT_PREVIEW_LINES = 10;

export function registerToolFrames(scope: FeatureScope): void {
	const redraws = new Map<string, () => void>();
	// The set is asked for on every drawing of every frame, and it changes only with the setting.
	const set = glyphsOf(() => icons.get(scope));
	scope.events.on(FRAMED, (data) => {
		if (isObject(data)) data.framed = true;
	});
	scope.events.on(RULING_CHANGED, (data) => {
		if (isObject(data) && typeof data.toolCallId === "string") redraws.get(data.toolCallId)?.();
	});

	scope.registerToolRenderer((toolName, next) =>
		framed(scope, next(), {
			name: toolName,
			set: () => set().set,
			redraws,
		}),
	);
}

interface FrameContext {
	name: string;
	set: () => IconSet;
	redraws: Map<string, () => void>;
}

function framed(
	scope: FeatureScope,
	base: ToolRenderers | undefined,
	frame: FrameContext,
): ToolRenderers {
	// A tool may bring renderers of its own, one of them, or none: the frame wraps whichever half
	// exists, and the arguments or the text of the result stand in for the rest.
	const call = base?.renderCall ?? genericCall;
	const result = base?.renderResult ?? genericResult;

	// A renderer of pi's own mutates the component it returned last time, which sits inside the
	// frame, so it gets that one back instead of the frame. A frame that showed the stream instead
	// holds no component of pi's.
	const inner = new WeakMap<Component, Component | undefined>();
	const passed = (last: Component | undefined): Component | undefined =>
		last === undefined || !inner.has(last) ? last : inner.get(last);
	const streamer = STREAMERS[frame.name];

	return {
		...base,
		// The frame is the shell, so pi does not wrap it in a box of its own.
		renderShell: "self",
		renderCall(args, theme, context) {
			frame.redraws.set(context.toolCallId, context.invalidate);
			const clock = clockOf(context);
			const now = Date.now();
			clock.writingAt ??= now;
			if (context.argsComplete) clock.writtenAt ??= now;
			if (context.executionStarted) clock.startedAt ??= now;
			const stream = streamer?.(args, theme, {
				cwd: context.cwd,
				expanded: context.expanded,
				state: context.state as object,
			});
			const writing = stream !== undefined && !context.argsComplete;
			// While the model writes, pi's renderer has nothing new to show, so it is not asked.
			const own = writing
				? undefined
				: call(args, theme, { ...context, lastComponent: passed(context.lastComponent) });
			const body = own === undefined ? drawnBody(stream?.lines ?? []) : orStream(own, stream);

			const box = new CallFrame({
				theme,
				icon: toolIcon(frame.name, frame.set()),
				label: toolLabel(frame.name),
				body,
				ruling: rulingOf(scope.events, context.toolCallId),
				expanded: context.expanded,
				phase: phaseOf(context),
				mark: stateMark,
				set: frame.set,
				elapsed: elapsedOf(clock, context),
				progress: writing ? stream.progress : undefined,
				clock,
				executing: context.isPartial && context.executionStarted,
				runningAs: RUNNING_WORDS[frame.name],
			});
			inner.set(box, own);
			return box;
		},
		renderResult(shown, options, theme, context) {
			const clock = clockOf(context);
			// A blocked call prints nothing but the reason the line above already gives.
			const blocked = rulingOf(scope.events, context.toolCallId)?.blocked === true;
			// Pi draws the pictures of a result right below the frame, so the frame counts them.
			const images = shown.content.filter((block) => block.type === "image").length;
			if (!options.isPartial) clock.endedAt ??= Date.now();
			clock.resulted = true;
			const body = result(shown, options, theme, {
				...context,
				lastComponent: passed(context.lastComponent),
			});
			const phase: Phase = options.isPartial ? "running" : context.isError ? "failed" : "done";
			const box = new ResultFrame({
				theme,
				body,
				quiet: blocked,
				phase,
				set: frame.set,
				elapsed: ranFor(clock, phase === "running"),
				wrote: wroteFor(clock),
				images: images === 0 ? undefined : `${images} image${images === 1 ? "" : "s"}`,
			});
			inner.set(box, body);
			return box;
		},
	};
}

/*
 * The stand-in for a tool that brings no renderer of its own: the arguments, under the top rule
 * that already names the tool, and the text of the result.
 */
const genericCall: NonNullable<ToolRenderers["renderCall"]> = (args, theme, context) =>
	new Text(callText(args, theme, context.expanded), 0, 0);

const genericResult: NonNullable<ToolRenderers["renderResult"]> = (result, options, theme) =>
	new Text(resultText(result, options.expanded, theme), 0, 0);

/** What a running call is doing, for tools whose running means something else. */
const RUNNING_WORDS: Readonly<Record<string, string>> = {
	ask_questions: "waiting for your answer",
};

/**
 * The phase the call closes with while it still has no result: writing the arguments, then waiting
 * to run. A call with a result, live or replayed, stays open for the result half to close.
 */
function phaseOf(context: {
	isPartial: boolean;
	executionStarted: boolean;
	argsComplete: boolean;
}): Phase | undefined {
	if (!context.isPartial || context.executionStarted) return undefined;
	return context.argsComplete ? "waiting" : "writing";
}

function callText(args: unknown, theme: Theme, expanded: boolean): string {
	if (args === null || args === undefined) return "";

	const entries: [string, unknown][] =
		typeof args === "object" && !Array.isArray(args) ? Object.entries(args) : [["args", args]];
	if (entries.length === 0) return "";

	if (expanded) {
		const lines = entries.map(([key, value]) => {
			const text =
				typeof value === "string" ? value : (JSON.stringify(value, null, 2) ?? String(value));
			return `  ${key}: ${tabs(text).split("\n").join("\n    ")}`;
		});
		return theme.fg("muted", lines.join("\n"));
	}

	const pairs = entries
		.map(([key, value]) => `${key}=${JSON.stringify(value) ?? String(value)}`)
		.join(" ");
	const preview =
		pairs.length > COLLAPSED_ARGS_CHARS ? `${pairs.slice(0, COLLAPSED_ARGS_CHARS - 3)}...` : pairs;
	return theme.fg("muted", preview);
}

function resultText(
	result: { content: readonly { type: string; text?: string }[] },
	expanded: boolean,
	theme: Theme,
): string {
	const text = result.content
		.filter((block) => block.type === "text")
		.map((block) => stripTerminalSequences(block.text ?? "").replace(/\r/g, ""))
		.join("\n");
	if (text === "") return "";

	const lines = text.split("\n");
	const shown = expanded ? lines : lines.slice(0, RESULT_PREVIEW_LINES);
	const printed = shown.map((line) => theme.fg("toolOutput", line));
	if (shown.length < lines.length)
		printed.push(
			theme.fg("muted", `... (${lines.length - shown.length} more lines, ${expandHint(theme)})`),
		);
	return printed.join("\n");
}

function expandHint(theme: Theme): string {
	const keys = getKeybindings().getKeys("app.tools.expand");
	if (keys.length === 0) return theme.fg("muted", "expand");
	return `${theme.fg("dim", keys.join("/"))}${theme.fg("muted", " to expand")}`;
}

interface FrameParts {
	theme: Theme;
	body: Component;
}

/** The top rule, the call inside it, and the phase while the call has nothing to show yet. */
class CallFrame implements Component {
	#drawn?: Drawn;

	constructor(private readonly parts: FrameParts & CallParts) {}

	invalidate(): void {
		this.#drawn = undefined;
		this.parts.body.invalidate();
	}

	render(width: number): string[] {
		const { theme, icon, label, ruling, expanded, clock } = this.parts;
		// A running call closes too until its result draws the rest of the frame, as a call that
		// waits for you does while its dialog is open.
		const running = this.parts.executing === true && clock?.resulted !== true;
		const phase = this.parts.phase ?? (running ? "running" : undefined);
		const time = running && clock !== undefined ? ranFor(clock, true) : this.parts.elapsed;
		// The mark of a phase that lasts moves, so it is picked on every drawing.
		const mark = phase === undefined ? undefined : this.parts.mark(phase, this.parts.set());
		const body = this.parts.body.render(room(width));
		const progress = this.parts.progress?.join("\u0000");
		const drawn = { width, body, rest: [ruling, expanded, phase, time, progress, mark] };
		if (unchanged(this.#drawn, drawn)) return this.#drawn.lines;

		const title = `${theme.fg("toolTitle", icon)} ${theme.fg("toolTitle", theme.bold(label))}`;
		const lines = [rule("top", title, width, theme), ...inside(withoutBlanks(body), width, theme)];
		// The decision is about the call, so it stays with the call.
		if (ruling !== undefined)
			lines.push(...inside([rulingText(ruling, theme, expanded)], width, theme));
		// The call has nothing else to show yet, so the frame closes with what it is doing.
		if (phase !== undefined && mark !== undefined) {
			const times = [time, ...(this.parts.progress ?? [])];
			const word = phase === "running" ? this.parts.runningAs : undefined;
			const closing = phaseLabel(theme, mark, phase, times, word);
			lines.push(rule("bottom", closing, width, theme, PHASE_COLORS[phase]));
		}
		this.#drawn = { ...drawn, lines };
		return lines;
	}
}

interface CallParts {
	icon: string;
	label: string;
	ruling?: CallRuling;
	expanded: boolean;
	phase?: Phase;
	mark: (phase: Phase, set: IconSet) => string;
	set: () => IconSet;
	elapsed?: string;
	/** What the model has written so far, while it writes. */
	progress?: readonly string[];
	clock?: Clock;
	/** The call runs and its result is not final. */
	executing?: boolean;
	/** The word for running, when the tool's running means something else. */
	runningAs?: string;
}

/** Lines that are already drawn. The frame cuts the ones too wide for it. */
function drawnBody(drawn: readonly string[]): Component {
	return { render: () => [...drawn], invalidate: () => {} };
}

/**
 * Pi's own body, or the stream while pi's body is only its first line, as when an edit's diff is
 * still being read from the file after the model finished writing.
 */
function orStream(own: Component, stream: Stream | undefined): Component {
	if (stream === undefined) return own;
	return {
		render(width) {
			const drawn = own.render(width);
			return withoutBlanks(drawn).length > 1 ? drawn : [...stream.lines];
		},
		invalidate: () => own.invalidate(),
	};
}

/** The result, behind a cut, and the bottom rule with how it went and how long it took. */
class ResultFrame implements Component {
	#drawn?: Drawn;

	constructor(private readonly parts: FrameParts & ResultParts) {}

	invalidate(): void {
		this.#drawn = undefined;
		this.parts.body.invalidate();
	}

	render(width: number): string[] {
		const { theme, phase, wrote, quiet, images } = this.parts;
		const time = this.parts.elapsed;
		const mark = stateMark(phase, this.parts.set());
		const body = this.parts.body.render(room(width));
		const drawn = { width, body, rest: [phase, mark, time, wrote, images, quiet] };
		if (unchanged(this.#drawn, drawn)) return this.#drawn.lines;

		const printed =
			quiet === true ? [] : withoutBlanks(dropTime(body)).map((line) => hidden(line, theme));
		const lines = [
			// The cut opens what the call printed, and a call with nothing to print has no cut.
			...(printed.length === 0 ? [] : [cut(width, theme), ...inside(printed, width, theme)]),
			rule(
				"bottom",
				phaseLabel(theme, mark, phase, [
					time,
					wrote === undefined ? undefined : `wrote ${wrote}`,
					images === undefined ? undefined : `with ${images}`,
				]),
				width,
				theme,
				PHASE_COLORS[phase],
			),
		];
		this.#drawn = { ...drawn, lines };
		return lines;
	}
}

interface ResultParts {
	phase: Phase;
	set: () => IconSet;
	elapsed?: string;
	wrote?: string;
	/** How many pictures follow the frame, which pi draws outside it. */
	images?: string;
	/** Nothing worth printing under the line, like a call the gate blocked. */
	quiet?: boolean;
}

/** One rule of the frame: two corners, and what sits on the left. */
export function rule(
	edge: "top" | "bottom",
	left: string,
	width: number,
	theme: Theme,
	color: "accent" | "success" | "error" | "muted" | "border" = "border",
): string {
	const [start, end] =
		edge === "top" ? [LINE.topLeft, LINE.topRight] : [LINE.bottomLeft, LINE.bottomRight];
	const paint = (text: string) => theme.fg(color, text);
	const cell = left === "" ? "" : ` ${left} `;
	const fill = Math.max(1, width - BODY_PAD - visibleWidth(cell));
	const line =
		paint(`${start}${LINE.h}`) + cell + paint(LINE.h.repeat(fill)) + paint(`${LINE.h}${end}`);
	// A rule with room to fill is the width already; only a label that filled the row needs cutting.
	return fill === 1 ? truncateToWidth(line, width, "") : line;
}

/** The line that ends the call and starts what it printed. */
function cut(width: number, theme: Theme): string {
	const paint = (text: string) => theme.fg("border", text);
	const fill = Math.max(1, width - BODY_PAD);
	const line = `${paint(LINE.teeLeft)}${paint(LINE.h.repeat(fill + 2))}${paint(LINE.teeRight)}`;
	// Room for the fill means the cut is the width already.
	return fill === 1 ? truncateToWidth(line, width, "") : line;
}

/** The bottom rule: what the call is doing, how long it ran, and how long the model took to write it. */
function phaseLabel(
	theme: Theme,
	mark: string,
	phase: Phase,
	times: readonly (string | undefined)[],
	word: string = phase,
): string {
	const cells = times
		.filter((time) => time !== undefined)
		.map((time) => theme.fg("dim", time ?? ""));
	return [`${theme.fg(PHASE_COLORS[phase], mark)} ${theme.fg("muted", word)}`, ...cells].join("  ");
}

function inside(lines: readonly string[], width: number, theme: Theme): string[] {
	const paint = (text: string) => theme.fg("border", text);
	const inner = room(width);
	return trim(lines).map((line) => {
		// Measuring is cheap, and cutting a line that already fits is not.
		const text = visibleWidth(line) > inner ? truncateToWidth(line, inner, CUT, true) : line;
		const pad = " ".repeat(Math.max(0, inner - visibleWidth(text)));
		return `${paint(LINE.v)} ${text}${pad} ${paint(LINE.v)}`;
	});
}

interface Drawn {
	width: number;
	body: readonly string[];
	/** What the frame drew around the body: the ruling, the phase, the times. */
	rest: readonly unknown[];
	lines: string[];
}

/** Whether the frame was already drawn for this body and this state, which keeps typing cheap. */
function unchanged(drawn: Drawn | undefined, next: Omit<Drawn, "lines">): drawn is Drawn {
	if (drawn === undefined || drawn.width !== next.width) return false;
	if (drawn.body.length !== next.body.length || drawn.rest.length !== next.rest.length)
		return false;
	if (drawn.rest.some((part, index) => part !== next.rest[index])) return false;
	// A renderer that kept its lines hands back the same array, which saves comparing a long output.
	return drawn.body === next.body || drawn.body.every((line, index) => line === next.body[index]);
}

function room(width: number): number {
	return Math.max(1, width - BODY_PAD);
}

/** Pi's note on the lines it cut from an output, as `... (240 earlier lines, ctrl+o to expand)`. */
const HIDDEN = /^\.\.\. \((\d+) (earlier|more) lines, (.+?) to expand\)$/u;

/** Pi's note on cut lines, in the frame's words: which way they are, how many, and the key. */
export function hidden(line: string, theme: Theme): string {
	const match = HIDDEN.exec(stripTerminalSequences(line).trim());
	if (match === null) return line;
	const [, count, side, key] = match;
	const where = side === "earlier" ? "above" : "below";
	const lines = theme.fg("muted", `${count} lines ${where}`);
	return `${theme.fg("dim", GLYPH.ellipsisUp)} ${lines}  ${theme.fg("dim", key ?? "")}`;
}

/** Pi prints the time of a call itself, and the frame says it on the bottom rule instead. */
function dropTime(lines: readonly string[]): string[] {
	const at = lines.findLastIndex((line) => !isBlank(line));
	if (at === -1) return [...lines];
	if (!/^(Took|Elapsed) [\d.]/u.test(stripTerminalSequences(lines[at] ?? "").trim()))
		return [...lines];
	return lines.slice(0, at);
}

interface Clock {
	/** When the model started writing the call, and when it finished. */
	writingAt?: number;
	writtenAt?: number;
	/** When the call started running, and when it answered. */
	startedAt?: number;
	endedAt?: number;
	/** Pi drew the result half, which closes the frame from then on. */
	resulted?: boolean;
}

/** Pi shares one state object between the two halves of a call. */
function clockOf(context: { state: unknown }): Clock {
	return context.state as Clock;
}

/** How long the model took to write the call. */
function wroteFor(clock: Clock): string | undefined {
	if (clock.writingAt === undefined || clock.writtenAt === undefined) return undefined;
	return elapsed(clock.writtenAt - clock.writingAt);
}

function ranFor(clock: Clock, running: boolean): string | undefined {
	if (clock.startedAt === undefined) return undefined;
	const end = clock.endedAt ?? (running ? Date.now() : undefined);
	return end === undefined ? undefined : elapsed(end - clock.startedAt);
}

/** How long the call has spent waiting to run, which only the call half of the frame asks for. */
function elapsedOf(clock: Clock, context: { argsComplete: boolean }): string | undefined {
	if (clock.writingAt === undefined) return undefined;
	const from = context.argsComplete ? (clock.writtenAt ?? clock.writingAt) : clock.writingAt;
	return elapsed(Date.now() - from);
}

function elapsed(ms: number): string {
	const seconds = ms / 1000;
	if (seconds < 60) return `${seconds.toFixed(1)}s`;
	const total = Math.floor(seconds);
	if (total < 3600) return `${Math.floor(total / 60)}m ${total % 60}s`;
	return `${Math.floor(total / 3600)}h ${Math.floor((total % 3600) / 60)}m`;
}

/** Pi's renderers pad their part with blank lines, which the frame does not need. */
function trim(lines: readonly string[]): string[] {
	let [from, to] = [0, lines.length];
	while (from < to && isBlank(lines[from])) from++;
	while (to > from && isBlank(lines[to - 1])) to--;
	return lines.slice(from, to);
}

/** A renderer that separates its parts with a blank line leaves a gap the frame does not need. */
function withoutBlanks(lines: readonly string[]): string[] {
	return lines.filter((line) => !isBlank(line));
}

export function isBlank(line: string | undefined): boolean {
	// A line of nothing but colour codes reads as blank, and pi's renderers end their parts with one.
	return stripTerminalSequences(line ?? "").trim() === "";
}

export function rulingText(ruling: CallRuling, theme: Theme, expanded: boolean): string {
	const color = PHASE_COLORS[stateOf(ruling.tone)];
	let line = `${theme.fg(color, GLYPH.judge)} ${theme.fg(color, ruling.head)}`;
	if (ruling.note) line += ` ${theme.fg("accent", GLYPH.chevron)} ${ruling.note}`;
	if (ruling.why) line += `  ${theme.fg("muted", ruling.why)}`;
	if (expanded && ruling.detail) line += ` ${theme.fg("dim", `(${ruling.detail})`)}`;
	return line;
}

function stateOf(tone: RulingTone): Phase {
	switch (tone) {
		case "pending":
			return "running";
		case "success":
			return "done";
		default:
			return "failed";
	}
}

// Pi's own entries in the transcript wear the harness's frame: your messages, compactions, branch
// summaries, skills, `!` commands and the messages of extensions that bring no renderer. Pi sets them
// apart with a background and blank rows; the frame does that job here, so the text keeps its colour,
// loses the background, and sits against the edges. Pi has no hook for drawing these, so this wraps
// the render of each component.
import { ENTRY_CUT, ENTRY_X, entryFrame, type EntryFrame, GLYPH } from "@adeildo/pi-kit";
import {
	BashExecutionComponent,
	BranchSummaryMessageComponent,
	CompactionSummaryMessageComponent,
	CustomMessageComponent,
	SkillInvocationMessageComponent,
	type Theme,
	UserMessageComponent,
} from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences } from "@earendil-works/pi-tui";

import type { IconSet } from "../render/glyphs.ts";
import { isBlank } from "./tool-frame.ts";

/** What the frames need from the session. Undefined leaves pi's entries as they are. */
export type EntryPaint = () => { theme: Theme; set: IconSet; you: boolean } | undefined;

const YOU: Readonly<Record<IconSet, string>> = {
	nerd: "\u{f007}", // nf-fa-user
	unicode: GLYPH.triangle,
	ascii: ">",
};
/** The shell integration markers pi puts on the first and last line of your message. */
// oxlint-disable-next-line no-control-regex -- the markers are escape sequences
const MARKERS = /^(?:\u001b\]133;[^\u0007]*\u0007)*/;
/** Background colour codes, which pi paints its entries with. */
// oxlint-disable-next-line no-control-regex -- colour codes are escape sequences
const BACKGROUND = /\u001b\[(?:48;[25];[\d;]+|49|4[0-7]|10[0-7])m/g;
/** Pi's bracketed label, as `[compaction]`, which the frame's top edge replaces. */
// oxlint-disable-next-line no-control-regex -- the label is wrapped in bold codes
const LABEL = /(\u001b\[1m)?\[[\w:.-]+\](\u001b\[22m)? ?/;

type Paint = NonNullable<ReturnType<EntryPaint>>;

/** A frame, and what of pi's own drawing it replaces. */
interface Framing extends EntryFrame {
	/** Pi's bracketed label on the first line, as `[compaction]`. */
	label?: boolean;
	/** The rules pi draws above and below a `!` command. */
	rules?: boolean;
}
type Render = (width: number) => string[];

let installed = false;
let paint: EntryPaint = () => undefined;

/** Frames pi's entries from now on. Calling it again only changes where the paint comes from. */
export function framePiEntries(source: EntryPaint): void {
	paint = source;
	if (installed) return;
	installed = true;
	wrap(UserMessageComponent, (_self, look) => (look.you ? youFrame(look) : undefined));
	wrap(CompactionSummaryMessageComponent, (_self, look) => pi(look, "compacted"));
	wrap(BranchSummaryMessageComponent, (_self, look) => pi(look, "branch summary"));
	wrap(SkillInvocationMessageComponent, (_self, look) => ({
		top: look.theme.fg("muted", "skill"),
		color: "borderMuted",
		label: true,
	}));
	wrap(CustomMessageComponent, (self, look) => {
		// A renderer of an extension draws its own message.
		const own = self as unknown as { customComponent?: unknown; message: { customType: string } };
		if (own.customComponent !== undefined) return undefined;
		const top = look.theme.fg("muted", own.message.customType);
		return { top, color: "borderMuted", label: true };
	});
	wrap(BashExecutionComponent, (self, look) => shellFrame(self, look));
}

function youFrame(look: Paint): Framing {
	const top = `${look.theme.fg("accent", YOU[look.set])} ${look.theme.fg("muted", "you")}`;
	return { top, color: "accent" };
}

function pi(look: Paint, what: string): Framing {
	return { top: look.theme.fg("muted", `${GLYPH.pi} ${what}`), color: "borderMuted", label: true };
}

interface Shell {
	status?: "running" | "complete" | "cancelled" | "error";
	exitCode?: number;
	colorKey?: "bashMode" | "dim";
}

function shellFrame(self: object, look: Paint): Framing {
	const { status, exitCode, colorKey = "bashMode" } = self as Shell;
	const { theme } = look;
	const top = `${theme.fg(colorKey, "!")} ${theme.fg("muted", "shell")}`;
	return { top, bottom: shellPhase(theme, status, exitCode), color: colorKey, rules: true };
}

function shellPhase(theme: Theme, status: Shell["status"], exitCode: number | undefined): string {
	switch (status) {
		case "running":
			return theme.fg("muted", "running");
		case "cancelled":
			return theme.fg("warning", "cancelled");
		case "error":
			return theme.fg("error", `${GLYPH.cross} exit ${exitCode ?? "?"}`);
		default:
			return theme.fg("success", `${GLYPH.check} done`);
	}
}

function wrap(
	component: { prototype: object },
	frameOf: (self: object, look: Paint) => Framing | undefined,
): void {
	const prototype = component.prototype as { render: Render };
	const own = prototype.render;
	prototype.render = function render(this: object, width: number) {
		const look = paint();
		const frame = look === undefined || width < ENTRY_X * 2 ? undefined : frameOf(this, look);
		if (look === undefined || frame === undefined) return own.call(this, width);
		return framed(own.call(this, width - 2), width, look.theme, frame);
	};
}

/** Pi's lines, drawn two columns narrower with a column of padding each side, in the frame. */
export function framed(
	body: readonly string[],
	width: number,
	theme: Theme,
	framing: Framing,
): string[] {
	const { label, rules, ...frame } = framing;
	const first = body[0]?.match(MARKERS)?.[0] ?? "";
	const last = body.at(-1)?.match(MARKERS)?.[0] ?? "";
	let lines = body.map((line) => line.replace(MARKERS, "").replace(BACKGROUND, ""));
	if (rules) {
		lines = lines.filter((line) => !/^\u2500+$/.test(stripTerminalSequences(line).trim()));
		// The blank line between a command and what it printed.
		const gap = lines.findIndex((line, index) => index > 0 && isBlank(line));
		if (gap > 0 && gap < lines.length - 1) lines[gap] = ENTRY_CUT;
	}
	// The blank rows pi pads its entries with.
	const trim = () => {
		while (lines.length > 1 && isBlank(lines[0] ?? "")) lines.shift();
		while (lines.length > 1 && isBlank(lines.at(-1) ?? "")) lines.pop();
	};
	trim();
	if (label && lines[0] !== undefined) {
		// Alone on its line it goes with the line, otherwise it leaves the rest, as `[skill] name`.
		const alone = /^\[[\w:.-]+\]$/.test(stripTerminalSequences(lines[0]).trim());
		if (alone) lines.shift();
		else lines[0] = lines[0].replace(LABEL, "$2");
		trim();
	}
	const drawn = entryFrame(lines, width, theme, { ...frame, pad: 0 });
	drawn[0] = first + drawn[0];
	drawn[drawn.length - 1] = last + drawn.at(-1);
	return drawn;
}

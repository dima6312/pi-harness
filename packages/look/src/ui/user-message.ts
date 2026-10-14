// Your messages in the same frame as the tool calls, in the accent colour and named "you". Pi sets
// them apart with a background and a blank row above and below the text. The frame does that job
// here, so the text keeps its colour, loses the background, and sits against the rules.
// Pi has no hook for drawing your messages, so this wraps the render of its component.
import { type Theme, UserMessageComponent } from "@earendil-works/pi-coding-agent";

import type { IconSet } from "../render/glyphs.ts";
import { isBlank, rule } from "./tool-frame.ts";

/** What the frame needs from the session. Undefined leaves pi's message as it is. */
export type UserFramePaint = () => { theme: Theme; set: IconSet } | undefined;

const MARK: Readonly<Record<IconSet, string>> = {
	nerd: "\u{f007}", // nf-fa-user
	unicode: "\u25b8",
	ascii: ">",
};
/** The shell integration markers pi puts on the first and last line of a message. */
// oxlint-disable-next-line no-control-regex -- the markers are escape sequences
const MARKERS = /^(?:\u001b\]133;[^\u0007]*\u0007)*/;
/** Background colour codes, which pi paints the message with. */
// oxlint-disable-next-line no-control-regex -- colour codes are escape sequences
const BACKGROUND = /\u001b\[(?:48;[25];[\d;]+|49|4[0-7]|10[0-7])m/g;

type Render = (this: UserMessageComponent, width: number) => string[];

let installed = false;
let paint: UserFramePaint = () => undefined;

/** Frames every user message from now on. Calling it again only changes where the paint comes from. */
export function frameUserMessages(source: UserFramePaint): void {
	paint = source;
	if (installed) return;
	installed = true;
	const prototype = UserMessageComponent.prototype as { render: Render };
	const own = prototype.render;
	prototype.render = function render(width) {
		const look = paint();
		if (look === undefined || width < 8) return own.call(this, width);
		return framed(own.call(this, width - 2), width, look.theme, MARK[look.set]);
	};
}

export function framed(
	body: readonly string[],
	width: number,
	theme: Theme,
	mark: string,
): string[] {
	const first = body[0]?.match(MARKERS)?.[0] ?? "";
	const last = body.at(-1)?.match(MARKERS)?.[0] ?? "";
	const lines = body.map((line) => line.replace(MARKERS, "").replace(BACKGROUND, ""));
	// The blank rows pi pads the message with.
	while (lines.length > 1 && isBlank(lines[0] ?? "")) lines.shift();
	while (lines.length > 1 && isBlank(lines.at(-1) ?? "")) lines.pop();
	const side = theme.fg("accent", "\u2502");
	const label = `${theme.fg("accent", mark)} ${theme.fg("muted", "you")}`;
	return [
		first + rule("top", label, width, theme, "accent"),
		...lines.map((line) => `${side}${line}${side}`),
		last + rule("bottom", "", width, theme, "accent"),
	];
}

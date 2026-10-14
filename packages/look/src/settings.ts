import { boolean, literal, setting } from "@adeildo/pi-kit";

import type { FrameStyle } from "./render/frame.ts";
import type { IconMode } from "./render/glyphs.ts";
import type { SegmentId } from "./render/segments.ts";
import { framePreview, iconsPreview, userFramePreview } from "./ui/previews.ts";

// The look has opinions: where each piece of information sits, the separators, the cursor and the
// start screen are fixed. Only what depends on your terminal or your taste in lines is a setting:
// the icon set, the frame's line style, and whether your messages are framed. See DESIGN.md.

export const SECTIONS = ["Appearance"];

export type HeaderStyle = "card" | "compact" | "off";
export type CursorStyle = "block" | "bar" | "underline";

/** A choice the look makes for you, read the same way as a setting. */
interface Fixed<T> {
	get(scope?: unknown): T;
}

function fixed<T>(value: T): Fixed<T> {
	return { get: () => value };
}

export const PERMISSION_MODE: SegmentId = "status:pi-ask-permission:mode";

/** The line above the editor: how long the agent has worked, and the last call that finished. */
export const strip = fixed<SegmentId[]>(["elapsed", "last"]);
/** The other side of that line, or a line of its own under it when it does not fit. */
export const stripRight = fixed<SegmentId[]>(["tasks", "peers"]);
/** After the working spinner on the editor's top edge. */
export const topLeft = fixed<SegmentId[]>(["branch", "session"]);
/** Where you are. */
export const topRight = fixed<SegmentId[]>(["path", "host"]);
/** How what you type is handled, and who does the work. */
export const bottomLeft = fixed<SegmentId[]>([PERMISSION_MODE, "model", "effort"]);
/** How full the context is. */
export const bottomRight = fixed<SegmentId[]>(["context"]);
/** The session: cost, tokens, cache, speeds, and what other packages report. */
export const below = fixed<SegmentId[]>(["cost", "tokens", "cache", "average", "statuses"]);
/** The plan's quota: what each window spent, and when it resets. */
export const belowRight = fixed<SegmentId[]>(["quota"]);

export const SEPARATOR = "  ";
export const cursor = fixed<CursorStyle>("bar");
export const header = fixed<HeaderStyle>("card");
export const pathLength = fixed(40);
export const gaugeCells = fixed(8);
export const labels = fixed(true);
export const peek = fixed(true);

export const icons = setting<IconMode>({
	id: "look.icons",
	default: "auto",
	decoder: literal("auto", "nerd", "unicode", "ascii"),
	ui: {
		section: "Appearance",
		label: "Icons",
		description: "Auto uses Nerd Font glyphs locally, plain Unicode over SSH.",
		preview: iconsPreview,
	},
});

export const frame = setting<FrameStyle | "off">({
	id: "look.frame.style",
	default: "rounded",
	decoder: literal("rounded", "square", "heavy", "line", "off"),
	project: true,
	ui: {
		section: "Appearance",
		label: "Editor frame",
		description:
			"The lines of the box around the editor. `line` keeps pi's two rules, `off` leaves the editor alone and moves what sits on its edges to the footer.",
		preview: framePreview,
	},
});

export const userFrame = setting({
	id: "look.userFrame",
	default: true,
	decoder: boolean,
	ui: {
		section: "Appearance",
		label: "Your messages",
		description:
			"Your messages in a frame like the tool calls', named you, with no blank row above and below the text. Off keeps pi's block.",
		preview: userFramePreview,
	},
});

export const LOOK_SETTINGS = [icons, frame, userFrame];

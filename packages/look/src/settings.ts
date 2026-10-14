import { boolean, literal, setting } from "@adeildo/pi-kit";

import type { FrameStyle } from "./render/frame.ts";
import type { IconMode } from "./render/glyphs.ts";
import type { SegmentId } from "./render/segments.ts";
import { framePreview, iconsPreview, userFramePreview } from "./ui/previews.ts";
import type { SlotName } from "./ui/screen.ts";

// The look has opinions: where each piece of information sits, the separators, the cursor and the
// start screen are fixed. Only what depends on your terminal or your taste in lines is a setting:
// the icon set, the frame's line style, and whether your messages are framed. See DESIGN.md.

export const SECTIONS = ["Appearance"];

export type HeaderStyle = "card" | "compact";
export type CursorStyle = "block" | "bar" | "underline";

export const PERMISSION_MODE: SegmentId = "status:pi-ask-permission:mode";

/** The line above the editor: how long the agent has worked, and the last call that finished. */
export const strip: readonly SegmentId[] = ["elapsed"];
/** The other side of that line, or a line of its own under it when it does not fit. */
export const stripRight: readonly SegmentId[] = ["tasks", "peers"];
/** After the working spinner on the editor's top edge. */
export const topLeft: readonly SegmentId[] = ["branch", "session"];
/** Where you are. */
export const topRight: readonly SegmentId[] = ["path", "host"];
/** How what you type is handled, and who does the work. */
export const bottomLeft: readonly SegmentId[] = [PERMISSION_MODE, "model", "effort"];
/** How full the context is. */
export const bottomRight: readonly SegmentId[] = ["context"];
/** The session: cost, tokens, cache, speeds, and what other packages report. */
export const below: readonly SegmentId[] = ["cost", "tokens", "cache", "average", "statuses"];
/** The plan's quota: what each window spent, and when it resets. */
export const belowRight: readonly SegmentId[] = ["quota"];

/** Where each piece of the screen comes from. The docs fixture draws with the same map. */
export const SLOTS: Record<SlotName, readonly SegmentId[]> = {
	strip,
	stripRight,
	topLeft,
	topRight,
	bottomLeft,
	bottomRight,
	below,
	belowRight,
};

export const SEPARATOR = "  ";
export const cursor: CursorStyle = "bar";
export const header: HeaderStyle = "card";
export const pathLength = 40;
export const gaugeCells = 8;
export const labels = true;

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

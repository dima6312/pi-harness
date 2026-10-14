import {
	boolean,
	type Control,
	type Decoder,
	integer,
	literal,
	pass,
	problem,
	setting,
} from "@adeildo/pi-kit";

import type { FrameStyle } from "./render/frame.ts";
import type { IconMode } from "./render/glyphs.ts";
import { isSegmentId, SEGMENT_IDS, SEGMENTS, type SegmentId } from "./render/segments.ts";

const PERMISSION_STATUS: SegmentId = "status:pi-ask-permission:mode";

const STATUS_LABELS: Partial<Record<SegmentId, string>> = {
	[PERMISSION_STATUS]: "permission mode",
};

export const SECTIONS = ["Editor", "Slots", "Footer", "Start screen", "Working line", "Transcript"];

export type HeaderStyle = "card" | "compact" | "off";
export type SeparatorStyle = "dot" | "bar" | "slash" | "space";
export type CursorStyle = "block" | "bar" | "underline";

export const SEPARATORS: Record<SeparatorStyle, string> = {
	dot: " · ",
	bar: " │ ",
	slash: " / ",
	space: "  ",
};

function segments(fallback: readonly SegmentId[]): Decoder<SegmentId[]> {
	return {
		decode(input, path) {
			if (input === undefined) return pass([...fallback]);
			if (!Array.isArray(input))
				return pass([...fallback], [problem(path, "expected an array of segment ids")]);
			const value: SegmentId[] = [];
			const unknown: string[] = [];
			for (const entry of input) {
				if (typeof entry === "string" && isSegmentId(entry)) value.push(entry);
				else unknown.push(String(entry));
			}
			const problems =
				unknown.length === 0
					? []
					: [problem(path, `ignored unknown segments: ${unknown.join(", ")}`)];
			return pass(value, problems);
		},
	};
}

// Any other package's status can have a slot of its own, so the ones already placed are offered too.
function slotControl(fallback: readonly SegmentId[]): Control {
	const statuses = [PERMISSION_STATUS, ...fallback.filter((id) => id.startsWith("status:"))];
	return {
		type: "list",
		options: [
			...SEGMENT_IDS.map((id) => ({ value: id, description: SEGMENTS[id].describe })),
			...[...new Set(statuses)].map((id) => ({
				value: id,
				label: STATUS_LABELS[id] ?? id.slice("status:".length),
				description: `what ${id.slice("status:".length)} reports`,
			})),
		],
	};
}

function slot(id: string, label: string, description: string, fallback: readonly SegmentId[]) {
	return setting<SegmentId[]>({
		id: `look.${id}`,
		default: [...fallback],
		decoder: segments(fallback),
		project: true,
		ui: { section: "Slots", label, description, control: slotControl(fallback) },
	});
}

export const strip = slot(
	"strip",
	"Answer strip",
	"The line above the editor: how long the agent has worked, and the last call that finished.",
	["elapsed", "last"],
);
export const stripRight = slot(
	"stripRight",
	"Answer strip, on the right",
	"The other side of that line. When it does not fit beside the strip, it gets a line of its own under it.",
	["tasks", "peers"],
);
export const topLeft = slot("frame.topLeft", "Frame, top left", "After the working spinner.", [
	"branch",
	"session",
]);
export const topRight = slot("frame.topRight", "Frame, top right", "Where you are.", [
	"path",
	"host",
]);
export const PERMISSION_MODE: SegmentId = PERMISSION_STATUS;

export const bottomLeft = slot(
	"frame.bottomLeft",
	"Frame, bottom left",
	"How what you type is handled, and who does the work.",
	[PERMISSION_MODE, "model", "effort"],
);
export const bottomRight = slot("frame.bottomRight", "Frame, bottom right", "How full it is.", [
	"context",
]);
export const below = slot(
	"below",
	"Below the editor",
	"The session: cost, tokens, cache, average speeds, and what other packages report, last because it changes the most.",
	["cost", "tokens", "cache", "average", "statuses"],
);
export const belowRight = slot(
	"belowRight",
	"Below the editor, on the right",
	"The plan's quota: what each window spent, and when it resets.",
	["quota"],
);

export const frame = setting<FrameStyle | "off">({
	id: "look.frame.style",
	default: "rounded",
	decoder: literal("rounded", "square", "heavy", "line", "off"),
	project: true,
	ui: {
		section: "Editor",
		label: "Frame",
		description:
			"The box around the editor. `line` keeps pi's two rules, `off` leaves the editor alone and moves the frame slots to the footer.",
	},
});

export const cursor = setting<CursorStyle>({
	id: "look.frame.cursor",
	default: "bar",
	decoder: literal("block", "bar", "underline"),
	ui: {
		section: "Editor",
		label: "Cursor",
		description: "Bar and underline use the terminal's own cursor, so it blinks the way it does.",
	},
});

export const header = setting<HeaderStyle>({
	id: "look.header",
	default: "card",
	decoder: literal("card", "compact", "off"),
	project: true,
	ui: {
		section: "Start screen",
		label: "Start screen",
		description: "The card pi opens with. Off keeps pi's own.",
	},
});

export const icons = setting<IconMode>({
	id: "look.icons",
	default: "auto",
	decoder: literal("auto", "nerd", "unicode", "ascii"),
	ui: {
		section: "Footer",
		label: "Icons",
		description: "Auto uses Nerd Font glyphs locally, plain Unicode over SSH.",
	},
});

export const separator = setting<SeparatorStyle>({
	id: "look.separator",
	default: "space",
	decoder: literal("dot", "bar", "slash", "space"),
	project: true,
	ui: { section: "Footer", label: "Separator", description: "Between the pieces of a slot." },
});

export const pathLength = setting({
	id: "look.pathLength",
	default: 40,
	decoder: integer(0, 500),
	project: true,
	ui: {
		section: "Footer",
		label: "Path length",
		description: "Longest the folder may be before it is shortened from the left. 0 keeps it all.",
	},
});

export const gaugeCells = setting({
	id: "look.gaugeCells",
	default: 8,
	decoder: integer(0, 40),
	project: true,
	ui: { section: "Footer", label: "Gauge", description: "Cells in the context gauge. 0 hides it." },
});

export const labels = setting({
	id: "look.labels",
	default: true,
	decoder: boolean,
	project: true,
	ui: {
		section: "Footer",
		label: "Labels",
		description:
			"A short word before each number (out, in, ttft, took, ctx, cache). Off is denser.",
	},
});

export const peek = setting({
	id: "look.peek",
	default: true,
	decoder: boolean,
	ui: {
		section: "Working line",
		label: "Working line",
		description:
			"The spinner names the state: waiting, thinking, writing, drafting a tool call, running it.",
	},
});

export const userFrame = setting({
	id: "look.userFrame",
	default: true,
	decoder: boolean,
	ui: {
		section: "Transcript",
		label: "Your messages",
		description:
			"Your messages in a frame like the tool calls', named you, with no blank row above and below the text. Off keeps pi's block.",
	},
});

export const LOOK_SETTINGS = [
	strip,
	stripRight,
	topLeft,
	topRight,
	bottomLeft,
	bottomRight,
	below,
	belowRight,
	frame,
	cursor,
	header,
	icons,
	separator,
	pathLength,
	gaugeCells,
	labels,
	peek,
	userFrame,
];

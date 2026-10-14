// The brand board: the mark, the structure and the screens, composed from the theme's own colours and
// the real pictures. Nothing here invents a palette or draws a screen that the product does not draw.
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import type { Theme } from "@earendil-works/pi-coding-agent";
import { colorToHex } from "@earendil-works/pi-tui";

import { entryFrame, rule } from "../../packages/kit/src/index.ts";
import { EFFORT_LEVELS, themePaint } from "../../packages/look/src/render/paint.ts";
import { halfBlocks, PIXELS } from "../../packages/look/src/ui/header.ts";
import { settingsLines } from "./settings.ts";
import { terminalGroup } from "./svg.ts";

const WIDTH = 1600;
const HEIGHT = 1040;
const MARGIN = 56;
const GUTTER = 32;
const FONT = "JetBrainsMono Nerd Font Mono, JetBrains Mono, DejaVu Sans Mono, monospace";
const BACKGROUND = "#18181e";
const FOREGROUND = "#dee0e1";
const LOGO_RAMP = EFFORT_LEVELS.slice(1);
const root = resolve(import.meta.dir, "../..");

interface Picture {
	width: number;
	height: number;
	/** Drawn at its own size from the corner, moved and scaled by `place`. */
	body: string;
	/** A screenshot: never blown up past its own pixels. */
	raster: boolean;
}

interface Screen {
	title: string;
	media(theme: Theme): Promise<Picture>;
}

const SCREENS: Screen[] = [
	{
		title: "the start card",
		media: async () => filePicture(join(root, "packages/look/assets/preview.png")),
	},
	{
		title: "a session",
		media: async () => filePicture(join(root, "packages/harness/assets/conversation.png")),
	},
	{
		title: "the settings, alt+s",
		media: async (theme) => terminalPicture(await settingsLines(theme)),
	},
	{
		title: "the room, alt+g",
		media: async () => filePicture(join(root, "packages/peers/assets/room.png")),
	},
];

export async function brandSvg(theme: Theme): Promise<string> {
	const palette = Object.fromEntries(
		Object.entries(theme.colors).map(([name, value]) => [name, colorToHex(value)]),
	) as Record<string, string>;
	const tone = (name: string): string => palette[name] ?? FOREGROUND;
	const c = {
		text: tone("text"),
		dim: tone("dim"),
		muted: tone("muted"),
		toolPendingBg: tone("toolPendingBg"),
		scrollbarTrack: tone("scrollbarTrack"),
		userMessageBg: tone("userMessageBg"),
		scrollbarThumb: tone("scrollbarThumb"),
	};
	const mark = terminalPicture(markLines(theme), 24);
	const structure = terminalPicture(structureLines(theme));
	const screens = await Promise.all(
		SCREENS.map(async (screen) => ({ title: screen.title, media: await screen.media(theme) })),
	);

	const panel = (x: number, y: number, width: number, height: number) =>
		`<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="14" fill="${c.toolPendingBg}" stroke="${c.scrollbarTrack}"/>`;
	const text = (x: number, y: number, body: string, size: number, fill: string, weight = 400) =>
		`<text x="${x}" y="${y}" font-family="${FONT}" font-size="${size}" font-weight="${weight}" fill="${fill}">${escapeXml(body)}</text>`;
	const right = (y: number, body: string, size: number, fill: string) =>
		text(WIDTH - MARGIN, y, body, size, fill).replace("<text ", '<text text-anchor="end" ');

	const top = 120;
	const topHeight = 452;
	const leftWidth = 520;
	const rightX = MARGIN + leftWidth + GUTTER;
	const rightWidth = WIDTH - MARGIN - rightX;
	const bottom = top + topHeight + GUTTER;
	const bottomHeight = HEIGHT - MARGIN - bottom;
	const screenWidth = (WIDTH - MARGIN * 2 - GUTTER * 2) / SCREENS.length;

	const parts: string[] = [
		`<rect width="${WIDTH}" height="${HEIGHT}" fill="${BACKGROUND}"/>`,
		text(MARGIN, MARGIN + 24, "π-harness", 34, c.text, 700),
		right(MARGIN + 22, "the screen of pi, in the colors pi already has", 20, c.dim),
		`<line x1="${MARGIN}" y1="${MARGIN + 44}" x2="${WIDTH - MARGIN}" y2="${MARGIN + 44}" stroke="${c.scrollbarTrack}"/>`,

		// The mark, and what the board is for.
		panel(MARGIN, top, leftWidth, topHeight),
		place(mark, MARGIN + 40, top + 26, leftWidth - 80, 220),
		text(MARGIN + 40, top + 296, "the π rises from its feet once per launch", 15, c.dim),
		text(MARGIN + 40, top + 348, "π-harness", 50, c.text, 700),
		text(MARGIN + 40, top + 390, "Pi runs every command without asking.", 20, c.muted),
		text(MARGIN + 40, top + 418, "This makes it ask.", 20, c.muted),
		`<rect x="${MARGIN + 40}" y="${top + 430}" width="${leftWidth - 80}" height="34" rx="8" fill="${c.userMessageBg}"/>`,
		text(MARGIN + 56, top + 453, "pi install npm:@adeildo/pi-harness", 17, c.text),

		// The structure: the frames, the rules, and the π that rises.
		panel(rightX, top, rightWidth, topHeight),
		place(structure, rightX + 30, top + 26, rightWidth - 60, topHeight - 52),
	];

	// What it looks like on screen.
	for (const [index, screen] of screens.entries()) {
		const x = MARGIN + index * (screenWidth + GUTTER);
		parts.push(panel(x, bottom, screenWidth, bottomHeight));
		parts.push(text(x + 26, bottom + 38, screen.title, 20, c.muted));
		parts.push(place(screen.media, x + 22, bottom + 52, screenWidth - 44, bottomHeight - 74));
	}

	parts.push(right(HEIGHT - 18, "github.com/felipeadeildo/pi-harness", 18, c.scrollbarThumb));

	return [
		`<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">`,
		...parts,
		"</svg>",
	].join("\n");
}

/** The frames and rules the product draws, taken from the kit, not retyped. */
function structureLines(theme: Theme): string[] {
	const frame = entryFrame(["  Are you touching src/auth.ts?"], 48, theme, {
		top: "@oauth → @migration",
		topRight: "12:38",
		bottom: "✓✓ woke it",
		color: "syntaxString",
	});
	const queued = entryFrame(["  push the callback when auth.ts is clear"], 54, theme, {
		top: "queued",
		bottom: "enter to edit",
		color: "borderMuted",
		dashed: true,
	});
	return [
		"the frame: who on top, what became of it below",
		...frame,
		"",
		"the dashed frame: what has not happened yet",
		...queued,
		"",
		"the rule, and what runs on it",
		`  ${rule(theme, 60, `${theme.fg("accent", "✻")} ${theme.fg("muted", "thinking")}`)}`,
	];
}

/** The π in pixels, in three states of the rise: the mark the start card lifts once per launch. */
function markLines(theme: Theme): string[] {
	const art = halfBlocks(PIXELS);
	const paint = themePaint(theme);
	const states = [1, 3, art.length].map((lit) =>
		art.map((row, index) =>
			art.length - index > lit
				? " ".repeat(row.length)
				: paint.effort(LOGO_RAMP[index] ?? "max", row),
		),
	);
	return art.map((_, row) => states.map((state) => state[row] ?? "").join("      "));
}

function terminalPicture(lines: readonly string[], fontSize = 20): Picture {
	const drawn = terminalGroup([...lines], {
		background: BACKGROUND,
		foreground: FOREGROUND,
		font: FONT,
		fontSize,
	});
	return { width: drawn.width, height: drawn.height, body: drawn.group, raster: false };
}

/** A screenshot kept as a PNG: a terminal drawing in a font would not be the same screen. */
function filePicture(file: string): Picture {
	const png = readFileSync(file);
	const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
	const width = view.getUint32(16);
	const height = view.getUint32(20);
	const href = `data:image/png;base64,${png.toString("base64")}`;
	return {
		width,
		height,
		body: `<image x="0" y="0" width="${width}" height="${height}" href="${href}"/>`,
		raster: true,
	};
}

/** Fits a picture in a box, keeping its ratio, and centres it there. */
function place(
	picture: Picture,
	x: number,
	y: number,
	boxWidth: number,
	boxHeight: number,
): string {
	const fit = Math.min(boxWidth / picture.width, boxHeight / picture.height);
	const scale = picture.raster ? Math.min(1, fit) : fit;
	const width = picture.width * scale;
	const height = picture.height * scale;
	const left = x + (boxWidth - width) / 2;
	const top = y + (boxHeight - height) / 2;
	return `<g transform="translate(${left.toFixed(1)} ${top.toFixed(1)}) scale(${scale.toFixed(4)})">${picture.body}</g>`;
}

function escapeXml(text: string): string {
	return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

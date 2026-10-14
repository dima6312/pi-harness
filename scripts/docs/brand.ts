// The brand board: the mark, the structure and the screens, composed from the theme's own colours and
// the real pictures. Nothing here invents a palette or draws a screen that the product does not draw.
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import type { Theme } from "@earendil-works/pi-coding-agent";
import { colorToHex } from "@earendil-works/pi-tui";
import { $ } from "bun";

import { entryFrame, rule } from "../../packages/kit/src/index.ts";
import { EFFORT_LEVELS, themePaint } from "../../packages/look/src/render/paint.ts";
import { halfBlocks, PIXELS } from "../../packages/look/src/ui/header.ts";
import { settingsLines } from "./settings.ts";
import { toSvg } from "./svg.ts";

const WIDTH = 1600;
const HEIGHT = 1040;
const MARGIN = 56;
const GUTTER = 32;
const FONT = "JetBrainsMono Nerd Font Mono, JetBrains Mono, DejaVu Sans Mono, monospace";
const BACKGROUND = "#18181e";
const LOGO_RAMP = EFFORT_LEVELS.slice(1);
const root = resolve(import.meta.dir, "../..");

interface Media {
	href: string;
	width: number;
	height: number;
}

interface Screen {
	title: string;
	/** The settings have no picture of their own before this run, so they are drawn on the spot. */
	media(theme: Theme): Promise<Media>;
}

const SCREENS: Screen[] = [
	{
		title: "the start card",
		media: async () => fileMedia(join(root, "packages/look/assets/preview.png")),
	},
	{
		title: "a session",
		media: async () => fileMedia(join(root, "packages/harness/assets/conversation.png")),
	},
	{
		title: "the settings, alt+s",
		media: (theme) => settingsLines(theme).then((lines) => terminalImage(lines, 2)),
	},
	{
		title: "the room, alt+g",
		media: async () => fileMedia(join(root, "packages/peers/assets/room.png")),
	},
];

export async function brandSvg(theme: Theme): Promise<string> {
	const palette = Object.fromEntries(
		Object.entries(theme.colors).map(([name, value]) => [name, colorToHex(value)]),
	) as Record<string, string>;
	const tone = (name: string): string => palette[name] ?? "#dee0e1";
	const c = {
		text: tone("text"),
		dim: tone("dim"),
		muted: tone("muted"),
		toolPendingBg: tone("toolPendingBg"),
		scrollbarTrack: tone("scrollbarTrack"),
		userMessageBg: tone("userMessageBg"),
		scrollbarThumb: tone("scrollbarThumb"),
	};
	const mark = await terminalImage(markLines(theme), 2, 24);
	const structure = await terminalImage(structureLines(theme), 2);
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
		image(mark, MARGIN + 40, top + 26, leftWidth - 80, 220),
		text(MARGIN + 40, top + 296, "the π rises from its feet once per launch", 15, c.dim),
		text(MARGIN + 40, top + 348, "π-harness", 50, c.text, 700),
		text(MARGIN + 40, top + 390, "Pi runs every command without asking.", 20, c.muted),
		text(MARGIN + 40, top + 418, "This makes it ask.", 20, c.muted),
		`<rect x="${MARGIN + 40}" y="${top + 430}" width="${leftWidth - 80}" height="34" rx="8" fill="${c.userMessageBg}"/>`,
		text(MARGIN + 56, top + 453, "pi install npm:@adeildo/pi-harness", 17, c.text),

		// The structure: the frames, the rules, and the π that rises.
		panel(rightX, top, rightWidth, topHeight),
		image(structure, rightX + 30, top + 26, rightWidth - 60, topHeight - 52),
	];

	// What it looks like on screen.
	for (const [index, screen] of screens.entries()) {
		const x = MARGIN + index * (screenWidth + GUTTER);
		parts.push(panel(x, bottom, screenWidth, bottomHeight));
		parts.push(text(x + 26, bottom + 38, screen.title, 20, c.muted));
		parts.push(image(screen.media, x + 22, bottom + 52, screenWidth - 44, bottomHeight - 74));
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

/** One terminal drawing as a PNG, so the frames stay the ones the product draws. */
async function terminalImage(
	lines: readonly string[],
	zoom: number,
	fontSize = 20,
): Promise<Media> {
	const svg = toSvg([...lines], {
		background: BACKGROUND,
		foreground: "#dee0e1",
		font: FONT,
		fontSize,
	});
	const png = new Uint8Array(
		await $`rsvg-convert --zoom ${zoom} - < ${new Response(svg)}`.arrayBuffer(),
	);
	return media(png);
}

function fileMedia(file: string): Media {
	return media(readFileSync(file));
}

function media(png: Uint8Array): Media {
	const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
	return {
		href: `data:image/png;base64,${Buffer.from(png).toString("base64")}`,
		width: view.getUint32(16),
		height: view.getUint32(20),
	};
}

/** Fits a picture inside a box, keeping its ratio, and centres it there. */
function image(media: Media, x: number, y: number, boxWidth: number, boxHeight: number): string {
	const scale = Math.min(boxWidth / media.width, boxHeight / media.height);
	const width = Math.round(media.width * scale);
	const height = Math.round(media.height * scale);
	const left = x + Math.round((boxWidth - width) / 2);
	const top = y + Math.round((boxHeight - height) / 2);
	return `<image x="${left}" y="${top}" width="${width}" height="${height}" href="${media.href}"/>`;
}

function escapeXml(text: string): string {
	return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

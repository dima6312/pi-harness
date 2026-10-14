import { readFileSync } from "node:fs";

import { CUT, GLYPH } from "@adeildo/pi-kit";
import { keyText } from "@earendil-works/pi-coding-agent";
import { type Component, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

import type { GithubState } from "../data/github.ts";
import { type LastVisit, since, type StartNote, startNotes } from "../data/start-notes.ts";
import { BOXES, border } from "../render/frame.ts";
import { EFFORT_LEVELS, type Paint } from "../render/paint.ts";
import { renderSegments, type SegmentId } from "../render/segments.ts";
import type { HeaderStyle } from "../settings.ts";
import type { Screen } from "./screen.ts";

const PIXELS = [
	"..............",
	".############.",
	"##############",
	"...##....##...",
	"...##....##...",
	"...##....##...",
	"...##....##...",
	"...##....##...",
	"..##.....###..",
	".##.......####",
];
const LOGO = halfBlocks(PIXELS);
const LOGO_RAMP = EFFORT_LEVELS.slice(1);
const LOGO_COLUMN = 20;
const MIN_RIGHT = 34;
const MIN_CARD = 48;

export interface LoadedCounts {
	tools: number;
	skills: number;
	prompts: number;
	extensions: number;
}

export interface HeaderSource {
	style(): HeaderStyle;
	counts(): LoadedCounts;
	/** The last session in this folder, undefined for the first one. */
	lastVisit(): LastVisit | undefined;
	/** What GitHub answered for this folder, undefined while it is still being asked. */
	github?(): GithubState | undefined;
}

interface Hint {
	key: string;
	does: string;
}

/** The π rises from its feet once per launch, one row of the art every step. */
const RISE_STEP_MS = 70;
const NOTES = 6;
/** How long a drawing of the card stands before it is drawn again. */
const REDRAW_MS = 1000;
/** The harness's version, read once from the package that ships it. */
export const HARNESS_VERSION = harnessVersion();

/**
 * The start screen: the π, the folder and the model, and under them only what changed or waits on
 * you since the last session here. See DESIGN.md.
 */
export class HeaderComponent implements Component {
	readonly #screen: Screen;
	readonly #source: HeaderSource;
	/** When the π started rising. Without a terminal to redraw it, it stands from the start. */
	readonly #born: number;

	constructor(screen: Screen, source: HeaderSource, tui?: { requestRender(): void }) {
		this.#screen = screen;
		this.#source = source;
		this.#born = tui === undefined ? 0 : Date.now();
		if (tui === undefined) return;
		for (let row = 1; row <= LOGO.length; row++)
			setTimeout(() => tui.requestRender(), row * RISE_STEP_MS).unref?.();
	}

	/** The last drawing, kept for a moment: the card changes rarely and pi redraws on every keystroke. */
	#drawn:
		| { width: number; at: number; github: GithubState | undefined; lines: string[] }
		| undefined;

	render(width: number): string[] {
		const now = Date.now();
		const github = this.#source.github?.();
		const risen = now - this.#born > LOGO.length * RISE_STEP_MS;
		const drawn = this.#drawn;
		// GitHub answers after the card is up, and that answer must not wait for the next keystroke.
		if (risen && drawn?.width === width && drawn.github === github && now - drawn.at < REDRAW_MS)
			return drawn.lines;
		const notes = startNotes(
			this.#screen.snapshot(),
			HARNESS_VERSION,
			this.#source.lastVisit(),
			github,
		);
		const lines =
			width < MIN_CARD || this.#source.style() === "compact"
				? this.#compact(width, notes)
				: this.#card(width, notes);
		this.#drawn = { width, at: now, github, lines };
		return lines;
	}

	invalidate(): void {
		this.#drawn = undefined;
	}

	#card(width: number, notes: readonly StartNote[]): string[] {
		const screen = this.#screen;
		const paint = screen.paint();
		const box = BOXES.rounded;
		const frame = paint.frame;
		const inner = width - 4;
		const withLogo = inner - LOGO_COLUMN - 2 >= MIN_RIGHT;
		const rightWidth = withLogo ? inner - LOGO_COLUMN - 2 : inner;
		const snapshot = screen.snapshot();
		const last = this.#source.lastVisit();

		const right = [
			"",
			this.#segments(["path", "branch"], paint),
			this.#segments(["model", "effort"], paint),
			"",
			...this.#notes(notes, paint, last, snapshot.now),
		];
		const left = ["", ...this.#logo(paint), ""];

		const rows = Math.max(left.length, right.length);
		const lines = [
			border(
				width,
				[{ text: this.#title(paint), priority: 1 }],
				[{ text: paint.dim(`pi ${snapshot.version}`), priority: 2 }],
				{ box, edge: "top", paint: frame, separator: " " },
			),
		];
		for (let row = 0; row < rows; row++) {
			const content = withLogo
				? `${center(left[row] ?? "", LOGO_COLUMN)}  ${pad(right[row] ?? "", rightWidth)}`
				: pad(right[row] ?? "", rightWidth);
			lines.push(`${frame(box.vertical)} ${content} ${frame(box.vertical)}`);
		}
		lines.push(
			border(
				width,
				[
					{ text: this.#closing(notes, paint, last, snapshot.now), priority: 1 },
					...this.#hintPieces(paint),
				],
				[],
				{
					box,
					edge: "bottom",
					paint: frame,
					separator: "   ",
				},
			),
		);
		lines.push("");
		// Every line is drawn to the width already, and measuring is cheaper than cutting.
		return lines.map((line) =>
			visibleWidth(line) > width ? truncateToWidth(line, width, "") : line,
		);
	}

	/** The art, its rows lit from the feet up while it rises. */
	#logo(paint: Paint): string[] {
		const risen = Math.floor((Date.now() - this.#born) / RISE_STEP_MS) + 1;
		return LOGO.map((row, index) =>
			LOGO.length - index > risen
				? " ".repeat(row.length)
				: paint.effort(LOGO_RAMP[index] ?? "max", row),
		);
	}

	#notes(
		notes: readonly StartNote[],
		paint: Paint,
		last: LastVisit | undefined,
		now: number,
	): string[] {
		if (notes.length === 0)
			return [
				paint.muted(
					last === undefined
						? "First session in this folder."
						: `Nothing new since ${since(last.at, now)}.`,
				),
			];
		const shown = notes.slice(0, NOTES).map((note) => {
			const detail = note.detail === undefined ? "" : `  ${paint.dim(note.detail)}`;
			return `${paint.raw(note.color, note.mark)} ${paint.text(note.text)}${detail}`;
		});
		if (notes.length > NOTES) shown.push(paint.dim(`and ${notes.length - NOTES} more`));
		return shown;
	}

	#closing(
		notes: readonly StartNote[],
		paint: Paint,
		last: LastVisit | undefined,
		now: number,
	): string {
		if (notes.length === 0) return paint.italic(paint.dim("ready when you are"));
		const things = `${notes.length} thing${notes.length === 1 ? "" : "s"}`;
		return paint.raw(
			"warning",
			last === undefined ? things : `${things} since ${since(last.at, now)}`,
		);
	}

	#hintPieces(paint: Paint): { text: string; priority: number }[] {
		return HINTS()
			.slice(0, 4)
			.map((hint, index) => ({
				text: `${paint.role("brand", hint.key)} ${paint.dim(hint.does)}`,
				priority: 3 + index,
			}));
	}

	#compact(width: number, notes: readonly StartNote[]): string[] {
		const paint = this.#screen.paint();
		const separator = paint.dim(this.#screen.separator());
		const first = [this.#title(paint), this.#segments(["model", "effort", "path", "branch"], paint)]
			.filter((part) => part !== "")
			.join(separator);
		const last = this.#source.lastVisit();
		return [first, ...this.#notes(notes, paint, last, this.#screen.snapshot().now), ""].map(
			(line) => {
				const padded = ` ${line}`;
				return visibleWidth(padded) > width ? truncateToWidth(padded, width, CUT) : padded;
			},
		);
	}

	#title(paint: Paint): string {
		const glyph = paint.bold(paint.role("brand", GLYPH.pi));
		return `${glyph}${paint.bold("-harness")} ${paint.dim(HARNESS_VERSION)}`;
	}

	#segments(ids: readonly SegmentId[], paint: Paint): string {
		const pieces = renderSegments(ids, {
			snapshot: this.#screen.snapshot(),
			glyphs: this.#screen.glyphs(),
			paint,
			options: this.#screen.options(),
		});
		return pieces.map((piece) => piece.text).join(paint.dim(this.#screen.separator()));
	}
}

function harnessVersion(): string {
	try {
		const file = new URL("../../package.json", import.meta.url);
		return (JSON.parse(readFileSync(file, "utf8")) as { version?: string }).version ?? "";
	} catch {
		return "";
	}
}

function HINTS(): Hint[] {
	return [
		{ key: "/", does: "commands" },
		{ key: keyText("app.model.select") || "/model", does: "model" },
		{ key: keyText("app.thinking.cycle") || "/thinking", does: "effort" },
		{ key: "alt+s", does: "settings" },
		{ key: "!", does: "shell" },
		{ key: "/tree", does: "session history" },
	];
}

export function halfBlocks(pixels: readonly string[]): string[] {
	const rows: string[] = [];
	for (let row = 0; row < pixels.length; row += 2) {
		const top = pixels[row] ?? "";
		const bottom = pixels[row + 1] ?? "";
		let line = "";
		for (let column = 0; column < Math.max(top.length, bottom.length); column++) {
			const up = top[column] === "#";
			const down = bottom[column] === "#";
			line += up && down ? "█" : up ? "▀" : down ? "▄" : " ";
		}
		rows.push(line);
	}
	return rows;
}

function pad(text: string, width: number): string {
	const cells = visibleWidth(text);
	// Measuring is cheap, and cutting a line that already fits is not.
	if (cells <= width) return text + " ".repeat(width - cells);
	const clipped = truncateToWidth(text, width, CUT);
	return clipped + " ".repeat(Math.max(0, width - visibleWidth(clipped)));
}

function center(text: string, width: number): string {
	const cells = visibleWidth(text);
	const fits = cells <= width;
	// Measuring is cheap, and cutting a line that already fits is not.
	const clipped = fits ? text : truncateToWidth(text, width, "");
	const room = Math.max(0, width - (fits ? cells : visibleWidth(clipped)));
	const before = Math.floor(room / 2);
	return `${" ".repeat(before)}${clipped}${" ".repeat(room - before)}`;
}

import { keyText } from "@earendil-works/pi-coding-agent";
import { type Component, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

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
}

interface Hint {
	key: string;
	does: string;
}

export class HeaderComponent implements Component {
	readonly #screen: Screen;
	readonly #source: HeaderSource;

	constructor(screen: Screen, source: HeaderSource) {
		this.#screen = screen;
		this.#source = source;
	}

	render(width: number): string[] {
		if (width < MIN_CARD || this.#source.style() === "compact") return this.#compact(width);
		return this.#card(width);
	}

	invalidate(): void {}

	#card(width: number): string[] {
		const screen = this.#screen;
		const paint = screen.paint();
		const box = BOXES.rounded;
		const frame = paint.frame;
		const title = this.#title(paint);
		const inner = width - 4;
		const withLogo = inner - LOGO_COLUMN - 3 >= MIN_RIGHT;
		const rightWidth = withLogo ? inner - LOGO_COLUMN - 3 : inner;

		const right = [
			this.#segments(["model", "effort"], paint),
			this.#segments(["path", "branch"], paint),
			this.#loaded(paint),
			paint.dim("─".repeat(Math.max(0, rightWidth))),
			...this.#hints(paint, rightWidth),
		];
		const left = [
			...LOGO.map((row, index) => paint.effort(LOGO_RAMP[index] ?? "max", row)),
			"",
			paint.italic(paint.dim("ready when you are")),
		];

		const rows = Math.max(left.length, right.length);
		const lines = [
			border(width, [{ text: title, priority: 1 }], [], {
				box,
				edge: "top",
				paint: frame,
				separator: " ",
			}),
		];
		for (let row = 0; row < rows; row++) {
			const content = withLogo
				? `${center(left[row] ?? "", LOGO_COLUMN)} ${frame("│")} ${pad(right[row] ?? "", rightWidth)}`
				: pad(right[row] ?? "", rightWidth);
			lines.push(`${frame(box.vertical)} ${content} ${frame(box.vertical)}`);
		}
		lines.push(border(width, [], [], { box, edge: "bottom", paint: frame, separator: " " }));
		lines.push("");
		return lines.map((line) => truncateToWidth(line, width, ""));
	}

	#compact(width: number): string[] {
		const paint = this.#screen.paint();
		const separator = paint.dim(this.#screen.separator());
		const first = [this.#title(paint), this.#segments(["model", "effort", "path", "branch"], paint)]
			.filter((part) => part !== "")
			.join(separator);
		const hints = HINTS()
			.map((hint) => `${paint.role("brand", hint.key)} ${paint.dim(hint.does)}`)
			.join(separator);
		return [first, hints, ""].map((line) => truncateToWidth(` ${line}`, width, "..."));
	}

	#title(paint: Paint): string {
		const glyph = paint.bold(paint.role("brand", "π"));
		return `${glyph} ${paint.bold("pi")} ${paint.dim(`v${this.#screen.snapshot().version}`)}`;
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

	#loaded(paint: Paint): string {
		const counts = this.#source.counts();
		const parts = [
			this.#segments(["host"], paint),
			...[
				[counts.tools, "tools"],
				[counts.skills, "skills"],
				[counts.prompts, "prompts"],
				[counts.extensions, "extensions"],
			]
				.filter(([value]) => (value as number) > 0)
				.map(([value, label]) => `${paint.text(String(value))} ${paint.dim(String(label))}`),
		];
		return parts.filter((part) => part !== "").join(paint.dim(this.#screen.separator()));
	}

	#hints(paint: Paint, width: number): string[] {
		const hints = HINTS();
		const keyWidth = Math.max(...hints.map((hint) => visibleWidth(hint.key)));
		const cell = (hint: Hint) =>
			`${paint.role("brand", hint.key.padEnd(keyWidth))} ${paint.dim(hint.does)}`;
		const cellWidth = keyWidth + 1 + Math.max(...hints.map((hint) => visibleWidth(hint.does)));
		if (width < cellWidth * 2 + 3) return hints.slice(0, 3).map(cell);
		const rows: string[] = [];
		for (let index = 0; index < hints.length; index += 2) {
			const first = hints[index];
			const second = hints[index + 1];
			if (first === undefined) break;
			rows.push(
				second === undefined ? cell(first) : `${pad(cell(first), cellWidth)}   ${cell(second)}`,
			);
		}
		return rows;
	}
}

function HINTS(): Hint[] {
	return [
		{ key: keyText("app.model.select") || "/model", does: "model" },
		{ key: keyText("app.thinking.cycle") || "/thinking", does: "effort" },
		{ key: "/", does: "commands" },
		{ key: "!", does: "shell" },
		{ key: keyText("app.editor.external") || "/editor", does: "external editor" },
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
	const clipped = truncateToWidth(text, Math.max(0, width), "...");
	return `${clipped}${" ".repeat(Math.max(0, width - visibleWidth(clipped)))}`;
}

function center(text: string, width: number): string {
	const clipped = truncateToWidth(text, width, "");
	const room = Math.max(0, width - visibleWidth(clipped));
	const before = Math.floor(room / 2);
	return `${" ".repeat(before)}${clipped}${" ".repeat(room - before)}`;
}

// Draws lines of ANSI as an SVG, one rectangle and one text per run of the same style.
import { type Cell, cellsOf, type Style } from "./ansi.ts";

/** The left quarter block the dialog uses as the rail of a question. */
const BAR = "\u258e";

export interface SvgOptions {
	background: string;
	foreground: string;
	font?: string;
	fontSize?: number;
	padding?: number;
}

function escapeXml(text: string): string {
	return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

interface Run {
	column: number;
	text: string;
	width: number;
	style: Style;
}

function runsOf(cells: Cell[]): Run[] {
	const runs: Run[] = [];
	let column = 0;
	for (const cell of cells) {
		const last = runs.at(-1);
		const same = last !== undefined && JSON.stringify(last.style) === JSON.stringify(cell.style);
		if (same && last.column + last.width === column) {
			last.text += cell.text;
			last.width += cell.width;
		} else {
			runs.push({ column, text: cell.text, width: cell.width, style: cell.style });
		}
		column += cell.width;
	}
	return runs;
}

/** One SVG for the lines, drawn on a grid so a monospace font lines every column up. */
export function toSvg(lines: readonly string[], options: SvgOptions): string {
	const fontSize = options.fontSize ?? 20;
	const cell = fontSize * 0.6;
	const height = Math.round(fontSize * 1.5);
	const padding = options.padding ?? 28;
	const font =
		options.font ?? "JetBrainsMono Nerd Font Mono, JetBrains Mono, DejaVu Sans Mono, monospace";

	const rows = lines.map((line) => runsOf(cellsOf(line)));
	const columns = Math.max(1, ...rows.map((row) => row.reduce((sum, run) => sum + run.width, 0)));
	const width = Math.round(columns * cell + padding * 2);
	const total = rows.length * height + padding * 2;

	const shapes: string[] = [];
	const texts: string[] = [];
	for (const [index, row] of rows.entries()) {
		const top = padding + index * height;
		for (const run of row) {
			const { style } = run;
			const fill =
				(style.inverse ? (style.bg ?? options.background) : style.fg) ?? options.foreground;
			const back = style.inverse ? (style.fg ?? options.foreground) : style.bg;
			const x = (padding + run.column * cell).toFixed(2);
			if (back !== undefined)
				shapes.push(
					`<rect x="${x}" y="${top}" width="${(run.width * cell).toFixed(2)}" height="${height}" fill="${back}"/>`,
				);
			// A terminal fills the cell with this block; a font leaves gaps between lines.
			for (const [offset, char] of [...run.text].entries()) {
				if (char !== BAR) continue;
				const bar = (padding + (run.column + offset) * cell).toFixed(2);
				shapes.push(
					`<rect x="${bar}" y="${top}" width="${(cell * 0.25).toFixed(2)}" height="${height}" fill="${fill}"/>`,
				);
			}
			const visible = run.text.replaceAll(BAR, " ");
			if (visible.trim() === "") continue;
			const attributes = [
				`x="${x}"`,
				`y="${top + Math.round(height * 0.7)}"`,
				`fill="${fill}"`,
				style.bold ? 'font-weight="700"' : "",
				style.italic ? 'font-style="italic"' : "",
				style.underline ? 'text-decoration="underline"' : "",
				style.dim ? 'fill-opacity="0.6"' : "",
			].filter(Boolean);
			texts.push(`<text ${attributes.join(" ")}>${escapeXml(visible)}</text>`);
		}
	}

	return [
		`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${total}" viewBox="0 0 ${width} ${total}">`,
		`<rect width="${width}" height="${total}" rx="14" fill="${options.background}"/>`,
		...shapes,
		`<g font-family="${font}" font-size="${fontSize}" xml:space="preserve">`,
		...texts,
		"</g>",
		"</svg>",
		"",
	].join("\n");
}

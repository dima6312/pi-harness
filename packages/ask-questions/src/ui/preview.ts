// Ported from rpiv-ask-user-question.
import {
	Markdown,
	type MarkdownTheme,
	stripTerminalSequences,
	truncateToWidth,
	visibleWidth,
} from "@earendil-works/pi-tui";

const FENCE = /^`{3}/;
const ANY_FENCE = /^\s*`{3}/m;
/** Box drawing and block characters: a mockup drawn with them only reads with its spaces kept. */
const DRAWING = /[\u2500-\u259f]/;
/** Words lined up in columns, which markdown would join into one sentence. */
const COLUMNS = /\S {2,}\S/;
const TAB = "    ";

/**
 * Whether a preview is a picture to show as written. Markdown joins its lines and squeezes its
 * spaces, which breaks a mockup or a diagram. A preview with a fenced block is markdown.
 */
export function isDrawing(text: string): boolean {
	return !ANY_FENCE.test(text) && (DRAWING.test(text) || COLUMNS.test(text));
}

/** The previews, drawn once per width: markdown rendered, a drawing line by line. */
export class PreviewCache {
	private readonly rendered = new Map<string, string[]>();

	constructor(private readonly theme: MarkdownTheme) {}

	lines(text: string, width: number): string[] {
		const key = `${width}\u0000${text}`;
		let lines = this.rendered.get(key);
		if (lines === undefined) {
			lines = isDrawing(text) ? this.drawing(text, width) : this.markdown(text, width);
			// A preview often ends in blank lines that would pad the panel.
			while (lines.length > 0 && stripTerminalSequences(lines.at(-1) ?? "").trim() === "")
				lines.pop();
			this.rendered.set(key, lines);
		}
		return lines;
	}

	/** The widest line of a drawing, which decides whether it fits beside the options. */
	widest(text: string): number {
		if (!isDrawing(text)) return 0;
		return Math.max(0, ...drawingLines(text).map((line) => visibleWidth(line)));
	}

	invalidate(): void {
		this.rendered.clear();
	}

	private drawing(text: string, width: number): string[] {
		return drawingLines(text).map((line) =>
			this.theme.codeBlock(truncateToWidth(line, Math.max(1, width))),
		);
	}

	private markdown(text: string, width: number): string[] {
		// pi-tui prints the fence lines of code blocks.
		return new Markdown(text, 0, 0, this.theme)
			.render(Math.max(1, width))
			.filter((line) => !FENCE.test(stripTerminalSequences(line)));
	}
}

function drawingLines(text: string): string[] {
	return text.replace(/\t/g, TAB).replace(/\s+$/, "").split("\n");
}

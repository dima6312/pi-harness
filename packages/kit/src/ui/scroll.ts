// Where the thumb of a scroll bar sits, in one place: the settings screen and the questions dialog
// both draw one, and each had worked out the arithmetic on its own.

export interface ThumbRange {
	/** Row the thumb starts at, counted from the top. */
	start: number;
	/** Rows the thumb covers, at least one. */
	size: number;
}

/**
 * The thumb for a viewport `height` rows tall over `total` rows, scrolled to `scroll`. Undefined when
 * everything fits, which is also when a bar is not drawn at all.
 */
export function thumbRange(total: number, height: number, scroll: number): ThumbRange | undefined {
	if (total <= height) return undefined;
	const size = Math.max(1, Math.round((height * height) / total));
	const start = Math.round((scroll / (total - height)) * (height - size));
	return { start, size };
}

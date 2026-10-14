// Every character the harness draws with, by name, so code says `GLYPH.check` instead of `\u2713`.
// These are plain Unicode and show in any terminal font. Marks that need a Nerd Font, and their
// fallbacks, live in the look package's icon sets.

/** Marks in running text. */
export const GLYPH = {
	/** π, pi's own entries and the harness's name. */
	pi: "\u03c0",
	/** ✓ done, picked, passed. */
	check: "\u2713",
	/** ✗ failed. */
	cross: "\u2717",
	/** × close, remove. */
	times: "\u00d7",
	/** ↑ */
	up: "\u2191",
	/** ↓ */
	down: "\u2193",
	/** ← */
	left: "\u2190",
	/** → to whom, from what to what. */
	right: "\u2192",
	/** ↵ enter. */
	enter: "\u21b5",
	/** ↻ again. */
	again: "\u21bb",
	/** ❯ the selected row. */
	pointer: "\u276f",
	/** › a note on an option, a continuation. */
	chevron: "\u203a",
	/** ▸ a small pointer. */
	triangle: "\u25b8",
	/** ◆ an agent, a task in progress. */
	diamond: "\u25c6",
	/** ◇ an empty diamond: a task not started, a quiet mark. */
	diamondEmpty: "\u25c7",
	/** ◈ the judge. */
	judge: "\u25c8",
	/** ● on. */
	dot: "\u25cf",
	/** ○ off, not answered. */
	ring: "\u25cb",
	/** ◌ hidden, as tool output pruned from the context. */
	ringDotted: "\u25cc",
	/** ✎ words you typed. */
	pencil: "\u270e",
	/** ⚑ flagged. */
	flag: "\u2691",
	/** ⏵ running. */
	play: "\u23f5",
	/** ⌕ search. */
	search: "\u2315",
	/** ▍ where words arrive. */
	cursor: "\u258d",
	/** ▌ the bar on a selected row. */
	bar: "\u258c",
	/** … cut text. */
	ellipsis: "\u2026",
	/** ⋮ lines hidden above. */
	ellipsisUp: "\u22ee",
	/** ⋯ a gap between parts, as between two edits. */
	ellipsisAcross: "\u22ef",
	/** █ a full cell of a gauge. */
	block: "\u2588",
	/** ░ an empty cell of a gauge. */
	shade: "\u2591",
} as const;

/** Frames of the marks that move while something lasts, in order. */
export const SPIN = {
	/** ◴ ◷ ◶ ◵ a quarter of a circle going round: a call running. */
	quadrants: ["\u25f4", "\u25f7", "\u25f6", "\u25f5"],
	/** ⧖ ⧗ an hourglass and the same one flowing: a call waiting on you. */
	hourglass: ["\u29d6", "\u29d7"],
	/** | / - \ the same, in ASCII. */
	ascii: ["|", "/", "-", "\\"],
	/** ✎ ✏ ✐ ✏ a pencil that tilts as it writes, in one cell: the model writing a call. */
	pencil: ["\u270e", "\u270f", "\u2710", "\u270f"],
} as const;

/** The lines frames, rules and scroll bars are drawn with. */
/**
 * The mark a cut line ends with. Three dots, not the `…` glyph: every font and every icon set has
 * them, and the terminal width of one dot is one column everywhere.
 */
export const CUT = "...";

export const LINE = {
	/** ─ */
	h: "\u2500",
	/** │ */
	v: "\u2502",
	/** ┃ the thumb of a scroll bar. */
	vHeavy: "\u2503",
	/** ┄ a frame around what has not happened yet. */
	hDashed: "\u2504",
	/** ┆ */
	vDashed: "\u2506",
	/** ╭ */
	topLeft: "\u256d",
	/** ╮ */
	topRight: "\u256e",
	/** ╰ */
	bottomLeft: "\u2570",
	/** ╯ */
	bottomRight: "\u256f",
	/** ├ a rule that meets the left side. */
	teeLeft: "\u251c",
	/** ┤ a rule that meets the right side. */
	teeRight: "\u2524",
	/** ┬ a column that meets the top edge. */
	teeTop: "\u252c",
	/** ┴ a column that meets the bottom edge. */
	teeBottom: "\u2534",
} as const;

export type IconMode = "auto" | "nerd" | "unicode" | "ascii";
export type IconSet = Exclude<IconMode, "auto">;

export interface Glyphs {
	set: IconSet;
	folder: string;
	branch: string;
	host: string;
	session: string;
	tasks: string;
	peers: string;
	waiting: string;
	queued: string;
	version: string;
	model: string;
	effort: string;
	context: string;
	speed: string;
	wait: string;
	running: string;
	done: string;
	sent: string;
	received: string;
	cacheRead: string;
	cacheWrite: string;
	cost: string;
	clock: string;
	plug: string;
	ahead: string;
	behind: string;
	staged: string;
	modified: string;
	untracked: string;
	conflicted: string;
	stashed: string;
	fill: string;
	empty: string;
	levels: readonly string[];
	ellipsis: string;
	/** Between the agents of the folder and those of each shared room. */
	apart: string;
}

const COMMON = {
	ahead: "↑",
	behind: "↓",
	staged: "+",
	modified: "~",
	untracked: "?",
	conflicted: "!",
	sent: "↑",
	received: "↓",
	apart: "│",
};

export const NERD: Glyphs = {
	...COMMON,
	set: "nerd",
	folder: "\u{f07c}", // nf-fa-folder_open
	branch: "\u{e0a0}", // nf-pl-branch
	host: "\u{f108}", // nf-fa-desktop
	session: "\u{f02b}", // nf-fa-tag
	tasks: "\u{f04fe}", // nf-md-target
	peers: "\u{f0c0}", // nf-fa-users
	waiting: "\u{f024}", // nf-fa-flag
	queued: "\u{f051f}", // nf-md-timer_sand
	version: "π",
	model: "\u{f06a9}", // nf-md-robot
	effort: "\u{f09d1}", // nf-md-brain
	context: "\u{f035b}", // nf-md-memory
	speed: "\u{f04c5}", // nf-md-speedometer
	wait: "\u{f252}", // nf-fa-hourglass_half
	running: "\u{f017}", // nf-fa-clock_o
	done: "\u{f00c}", // nf-fa-check
	cacheRead: "\u{f1c0}", // nf-fa-database
	cacheWrite: "\u{f0c7}", // nf-fa-floppy_o
	cost: "$",
	clock: "\u{f017}", // nf-fa-clock_o
	plug: "\u{f1e6}", // nf-fa-plug
	stashed: "\u{f01c}", // nf-fa-inbox
	fill: "█",
	empty: "░",
	levels: ["▂", "▃", "▄", "▅", "▆", "▇"],
	ellipsis: "...",
};

export const UNICODE: Glyphs = {
	...COMMON,
	set: "unicode",
	folder: "▸",
	branch: "⎇",
	host: "⌂",
	session: "#",
	tasks: "▸",
	peers: "◆",
	waiting: "⚑",
	queued: "⧗",
	version: "π",
	model: "◆",
	effort: "✦",
	context: "◔",
	speed: "»",
	wait: "⧗",
	running: "◷",
	done: "✓",
	cacheRead: "≋",
	cacheWrite: "≈",
	cost: "$",
	clock: "◷",
	plug: "≫",
	stashed: "≡",
	fill: "█",
	empty: "░",
	levels: ["▂", "▃", "▄", "▅", "▆", "▇"],
	ellipsis: "...",
};

export const ASCII: Glyphs = {
	set: "ascii",
	apart: "|",
	folder: "",
	branch: "",
	host: "@",
	session: "#",
	tasks: ">",
	peers: "@",
	waiting: "",
	queued: "",
	version: "v",
	model: "",
	effort: "",
	context: "ctx",
	speed: "",
	wait: "ttft",
	running: "",
	done: "",
	sent: "^",
	received: "v",
	cacheRead: "R",
	cacheWrite: "W",
	cost: "$",
	clock: "",
	plug: ">>",
	ahead: "^",
	behind: "v",
	staged: "+",
	modified: "~",
	untracked: "?",
	conflicted: "!",
	stashed: "s",
	fill: "#",
	empty: "-",
	levels: ["|", "|", "|", "|", "|", "|"],
	ellipsis: "...",
};

const SETS: Record<IconSet, Glyphs> = { nerd: NERD, unicode: UNICODE, ascii: ASCII };

export function resolveIcons(mode: IconMode, env: NodeJS.ProcessEnv = process.env): Glyphs {
	if (mode !== "auto") return SETS[mode];
	if (env.TERM === "dumb") return ASCII;
	const locale = env.LC_ALL ?? env.LC_CTYPE ?? env.LANG;
	if (locale !== undefined && locale !== "" && !/utf-?8/i.test(locale)) return ASCII;
	if (env.SSH_TTY !== undefined || env.SSH_CONNECTION !== undefined) return UNICODE;
	return NERD;
}

/**
 * The glyphs for a scope, resolved once and again only when the setting behind them changes. Every
 * frame, rule and slot of the screen asks for them on each drawing, and resolving each time was a
 * fifth of what typing cost.
 */
export function glyphsOf(modeOf: () => IconMode): () => Glyphs {
	let known: { mode: IconMode; glyphs: Glyphs } | undefined;
	return () => {
		const mode = modeOf();
		if (known?.mode !== mode) known = { mode, glyphs: resolveIcons(mode) };
		return known.glyphs;
	};
}

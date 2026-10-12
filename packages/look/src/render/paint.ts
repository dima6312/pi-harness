import type { Theme, ThemeColor } from "@earendil-works/pi-coding-agent";

export type Role =
	| "path"
	| "branch"
	| "ahead"
	| "behind"
	| "staged"
	| "modified"
	| "untracked"
	| "conflicted"
	| "host"
	| "session"
	| "tasks"
	| "waiting"
	| "queued"
	| "version"
	| "provider"
	| "model"
	| "sent"
	| "received"
	| "cache"
	| "speed"
	| "wait"
	| "running"
	| "done"
	| "cost"
	| "clock"
	| "brand";

export const ROLE_TOKENS: Record<Role, ThemeColor> = {
	path: "accent",
	branch: "syntaxFunction",
	ahead: "success",
	behind: "warning",
	staged: "success",
	modified: "warning",
	untracked: "muted",
	conflicted: "error",
	host: "syntaxType",
	session: "mdHeading",
	tasks: "accent",
	waiting: "warning",
	queued: "muted",
	version: "muted",
	provider: "syntaxKeyword",
	model: "text",
	sent: "mdLink",
	received: "success",
	cache: "syntaxType",
	speed: "success",
	wait: "syntaxNumber",
	running: "accent",
	done: "success",
	cost: "syntaxNumber",
	clock: "muted",
	brand: "accent",
};

const EFFORT_TOKENS: Record<string, ThemeColor> = {
	off: "thinkingOff",
	minimal: "thinkingMinimal",
	low: "thinkingLow",
	medium: "thinkingMedium",
	high: "thinkingHigh",
	xhigh: "thinkingXhigh",
	max: "thinkingMax",
};

export const EFFORT_LEVELS = ["minimal", "low", "medium", "high", "xhigh", "max"] as const;

export interface Paint {
	dim(text: string): string;
	muted(text: string): string;
	text(text: string): string;
	bold(text: string): string;
	italic(text: string): string;
	role(role: Role, text: string): string;
	effort(level: string, text: string): string;
	stress(percent: number, text: string): string;
	money(amount: number, text: string): string;
	frame(text: string): string;
}

export function themePaint(theme: Theme, frame?: (text: string) => string): Paint {
	return {
		dim: (text) => theme.fg("dim", text),
		muted: (text) => theme.fg("muted", text),
		text: (text) => theme.fg("text", text),
		bold: (text) => theme.bold(text),
		italic: (text) => theme.italic(text),
		role: (role, text) => theme.fg(ROLE_TOKENS[role], text),
		effort: (level, text) => theme.fg(EFFORT_TOKENS[level] ?? "thinkingOff", text),
		stress: (percent, text) => theme.fg(stressToken(percent), text),
		money: (amount, text) => theme.fg(moneyToken(amount), text),
		frame: frame ?? ((text) => theme.fg("border", text)),
	};
}

export function stressToken(percent: number): ThemeColor {
	if (percent >= 90) return "error";
	if (percent >= 70) return "warning";
	return "success";
}

function moneyToken(amount: number): ThemeColor {
	if (amount >= 10) return "error";
	if (amount >= 1) return "warning";
	return ROLE_TOKENS.cost;
}

export const PLAIN: Paint = {
	dim: identity,
	muted: identity,
	text: identity,
	bold: identity,
	italic: identity,
	role: (_role, text) => text,
	effort: (_level, text) => text,
	stress: (_percent, text) => text,
	money: (_amount, text) => text,
	frame: identity,
};

function identity(text: string): string {
	return text;
}

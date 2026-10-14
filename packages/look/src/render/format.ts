import { isAbsolute, relative, resolve, sep } from "node:path";

import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

export const CELL = {
	count: 4,
	rate: 4,
	latency: 5,
	clock: 4,
	percent: 4,
	money: 6,
} as const;

export function cell(text: string, width: number): string {
	return " ".repeat(Math.max(0, width - visibleWidth(text))) + text;
}

export const UNKNOWN = "–";

export function count(value: number): string {
	const n = Math.max(0, Math.round(value));
	if (n < 1000) return String(n);
	if (n < 10_000) return `${trim((n / 1000).toFixed(1))}k`;
	if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
	if (n < 10_000_000) return `${trim((n / 1_000_000).toFixed(1))}M`;
	return `${Math.round(n / 1_000_000)}M`;
}

export function rate(perSecond: number): string {
	if (perSecond < 10) return trim(perSecond.toFixed(1));
	return count(perSecond);
}

export function duration(milliseconds: number): string {
	const total = Math.max(0, Math.floor(milliseconds / 1000));
	const secs = total % 60;
	const minutes = Math.floor(total / 60) % 60;
	const hours = Math.floor(total / 3600);
	if (hours > 0) return `${hours}h ${minutes}m`;
	if (minutes > 0) return `${minutes}m ${secs}s`;
	return `${secs}s`;
}

export function stopwatch(milliseconds: number): string {
	const total = Math.max(0, Math.floor(milliseconds / 1000));
	const secs = String(total % 60).padStart(2, "0");
	const minutes = Math.floor(total / 60) % 60;
	const hours = Math.floor(total / 3600);
	return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${secs}` : `${minutes}:${secs}`;
}

export function latency(milliseconds: number): string {
	if (milliseconds < 1000) return `${Math.round(milliseconds)}ms`;
	if (milliseconds < 10_000) return `${(milliseconds / 1000).toFixed(1)}s`;
	return duration(milliseconds);
}

export function money(amount: number): string {
	if (amount === 0) return "$0.00";
	return amount >= 10 ? `$${amount.toFixed(2)}` : `$${amount.toFixed(3)}`;
}

export function percent(value: number): string {
	return value >= 10 || value === 0 ? `${Math.round(value)}%` : `${value.toFixed(1)}%`;
}

export function shortenPath(cwd: string, home: string | undefined, maxWidth: number): string {
	const full = home === undefined ? cwd : underHome(cwd, home);
	if (maxWidth <= 0 || visibleWidth(full) <= maxWidth) return full;

	const parts = full.split(sep);
	let kept = "";
	for (let index = parts.length - 1; index > 0; index--) {
		const candidate = `${sep}${parts[index] ?? ""}${kept}`;
		if (visibleWidth(`...${candidate}`) > maxWidth) break;
		kept = candidate;
	}
	if (kept === "") return truncateTail(parts.at(-1) ?? full, maxWidth);
	return `...${kept}`;
}

export function basename(cwd: string): string {
	return cwd.split(/[\\/]/).findLast(Boolean) ?? cwd;
}

export function gauge(value: number, cells: number): { filled: number; empty: number } {
	const filled = Math.max(0, Math.min(cells, Math.round((value / 100) * cells)));
	return { filled, empty: cells - filled };
}

export function truncateTail(text: string, maxWidth: number): string {
	if (maxWidth <= 0) return "";
	if (visibleWidth(text) <= maxWidth) return text;
	const chars = [...text];
	let width = 3;
	let start = chars.length;
	while (start > 0) {
		const next = visibleWidth(chars[start - 1] ?? "");
		if (width + next > maxWidth) break;
		width += next;
		start--;
	}
	return `...${chars.slice(start).join("")}`;
}

export function fitWidth(text: string, width: number, ellipsis = "..."): string {
	return truncateToWidth(text, Math.max(0, width), ellipsis);
}

/** Tabs become three spaces: a tab is as wide as the terminal says, and these lines have a width. */
export function tabs(text: string): string {
	return text.replace(/\t/g, "   ");
}

function underHome(cwd: string, home: string): string {
	const rest = relative(resolve(home), resolve(cwd));
	const inside =
		rest === "" || (rest !== ".." && !rest.startsWith(`..${sep}`) && !isAbsolute(rest));
	if (!inside) return cwd;
	return rest === "" ? "~" : `~${sep}${rest}`;
}

function trim(fixed: string): string {
	return fixed.endsWith(".0") ? fixed.slice(0, -2) : fixed;
}

// The rounded frame every dialog of this package wears.
import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

/** The columns a row's text may use, between the frame's sides and their padding. */
export function frameInner(width: number): number {
	return Math.max(1, width - 4);
}

export function frameTop(theme: Theme, title: string, width: number): string {
	const border = (text: string) => theme.fg("border", text);
	const room = Math.max(0, width - 5);
	const label = theme.fg("accent", truncateToWidth(title, Math.max(0, room - 3), "..."));
	const dashes = Math.max(0, room - visibleWidth(label));
	return `${border("╭─ ")}${label}${border(` ${"─".repeat(dashes)}╮`)}`;
}

export function frameRow(theme: Theme, text: string, inner: number): string {
	const border = theme.fg("border", "│");
	const clipped = truncateToWidth(text, inner);
	const pad = " ".repeat(Math.max(0, inner - visibleWidth(clipped)));
	return `${border} ${clipped}${pad} ${border}`;
}

export function frameBottom(theme: Theme, width: number): string {
	return theme.fg("border", `╰${"─".repeat(Math.max(0, width - 2))}╯`);
}

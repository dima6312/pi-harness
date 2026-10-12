// The solid card the harness's panels draw over the chat, with no frame: a border's corner cells can
// never match the card's background.
import type { Theme } from "@earendil-works/pi-coding-agent";
import { type Color, colorToOkhsl, okhslColor, visibleWidth } from "@earendil-works/pi-tui";

/** The card and the band for its header and footer, tinted from the theme's border color. */
export function cardTones(theme: Theme): { card: Color; band: Color } {
	const { h, s } = colorToOkhsl(theme.colors.border);
	return theme.appearance === "dark"
		? { card: okhslColor(h, s * 0.35, 0.14), band: okhslColor(h, s * 0.45, 0.19) }
		: { card: okhslColor(h, s * 0.3, 0.96), band: okhslColor(h, s * 0.35, 0.91) };
}

/** A cut line ends in a full reset, which would drop the background it sits on. */
export function keepBackground(text: string, background: string): string {
	return text.replaceAll("\x1b[0m", `\x1b[0m${background}`);
}

/** Left and right on one line, the right flush with the edge. */
export function spread(left: string, right: string, width: number): string {
	return `${left}${" ".repeat(Math.max(1, width - visibleWidth(left) - visibleWidth(right)))}${right}`;
}

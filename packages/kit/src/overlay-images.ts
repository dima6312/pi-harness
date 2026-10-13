// pi-tui leaves a picture's line out when it composes an overlay, and the terminal paints the picture
// over the overlay. Remove this file, its calls and its test once
// https://github.com/earendil-works/pi/issues/10863 is fixed.
import type { TUI } from "@earendil-works/pi-tui";

const IMAGE = ["\x1b_G", "\x1b]1337;File="] as const;

interface Composer {
	hasOverlay?: () => boolean;
	compositeOverlays?: (lines: string[], width: number, height: number) => string[];
}

const wrapped = new WeakSet<object>();

/** Hides the pictures on screen while an overlay is open. */
export function hideImagesUnderOverlays(tui: TUI): void {
	const composer = tui as unknown as Composer;
	const compose = composer.compositeOverlays;
	const hasOverlay = composer.hasOverlay;
	if (wrapped.has(tui) || typeof compose !== "function" || typeof hasOverlay !== "function") return;
	wrapped.add(tui);
	composer.compositeOverlays = function (lines, width, height) {
		const shown = hasOverlay.call(this) ? withoutImages(lines, height) : lines;
		return compose.call(this, shown, width, height);
	};
}

/** Blanks the picture lines in the last screenful. Lines in the scrollback stay untouched. */
export function withoutImages(lines: readonly string[], height: number): string[] {
	const out = [...lines];
	for (let index = Math.max(0, out.length - height); index < out.length; index++)
		if (isImage(out[index] ?? "")) out[index] = "";
	return out;
}

function isImage(line: string): boolean {
	return IMAGE.some((prefix) => line.includes(prefix));
}

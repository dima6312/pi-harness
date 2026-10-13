import { describe, expect, test } from "bun:test";

import {
	type Component,
	type Terminal,
	type TUI,
	TuiAltScreen,
	TuiMainScreen,
} from "@earendil-works/pi-tui";

import { hideImagesUnderOverlays, withoutImages } from "../src/overlay-images.ts";

const KITTY = "\x1b_Ga=T,f=100,q=2,C=1,c=20,r=3,i=7;AAAA\x1b\\";

const terminal = {
	start() {},
	stop() {},
	drainInput: async () => {},
	write() {},
	columns: 60,
	rows: 10,
	kittyProtocolActive: false,
	moveBy() {},
	hideCursor() {},
	showCursor() {},
	clearLine() {},
	clearFromCursor() {},
	clearScreen() {},
	setTitle() {},
	setProgress() {},
	setProgramStatus() {},
} as unknown as Terminal;

const lines = (...text: string[]): Component => ({ render: () => text, invalidate() {} });

type Composes = { compositeOverlays(lines: string[], width: number, height: number): string[] };

describe("pictures under an overlay", () => {
	test("pi-tui still composes overlays where the wrapper reaches in", () => {
		for (const Screen of [TuiMainScreen, TuiAltScreen]) {
			const tui = new Screen(terminal) as unknown as Composes & { hasOverlay(): boolean };
			expect(typeof tui.compositeOverlays).toBe("function");
			expect(typeof tui.hasOverlay).toBe("function");
		}
	});

	// Fails once pi#10863 is fixed: then remove src/overlay-images.ts and its calls.
	test("pi-tui still keeps the picture's line under an overlay (pi#10863)", () => {
		const tui = new TuiMainScreen(terminal);
		tui.showOverlay(lines("PANEL", "PANEL"), { anchor: "top-left", width: 10 });
		const composed = (tui as unknown as Composes).compositeOverlays([KITTY, "", ""], 60, 10);
		expect(composed[0]).toBe(KITTY);
	});

	test("with an overlay open the picture leaves the frame, and comes back when it closes", () => {
		const tui = new TuiMainScreen(terminal);
		const chat = [KITTY, "", "", "after the picture"];
		const handle = tui.showOverlay(lines("PANEL", "PANEL"), { anchor: "top-left", width: 10 });
		const composes = tui as unknown as Composes;

		hideImagesUnderOverlays(tui as unknown as TUI);
		const open = composes.compositeOverlays(chat, 60, 10);
		expect(open.some((line) => line.includes("\x1b_G"))).toBe(false);
		expect(open[0]).toContain("PANEL");

		handle.hide();
		expect(composes.compositeOverlays(chat, 60, 10)[0]).toBe(KITTY);
	});

	test("wrapping twice wraps once", () => {
		const tui = new TuiMainScreen(terminal);
		hideImagesUnderOverlays(tui as unknown as TUI);
		const once = (tui as unknown as Composes).compositeOverlays;
		hideImagesUnderOverlays(tui as unknown as TUI);
		expect((tui as unknown as Composes).compositeOverlays).toBe(once);
	});

	test("a picture in the scrollback stays, so the main screen does not redraw it all", () => {
		const out = withoutImages([KITTY, "a", "b", KITTY, "c"], 2);
		expect(out).toEqual([KITTY, "a", "b", "", "c"]);
	});
});

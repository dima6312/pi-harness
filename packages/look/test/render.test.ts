import { describe, expect, test } from "bun:test";

import { visibleWidth } from "@earendil-works/pi-tui";

import { fitLine, fitRegions, type Piece } from "../src/render/fit.ts";
import {
	count,
	duration,
	gauge,
	latency,
	money,
	percent,
	rate,
	shortenPath,
	truncateTail,
} from "../src/render/format.ts";
import { BOXES, border } from "../src/render/frame.ts";
import { ASCII, NERD, resolveIcons, UNICODE } from "../src/render/glyphs.ts";
import { ROLE_TOKENS } from "../src/render/paint.ts";
import { plain } from "./helpers.ts";

describe("format", () => {
	test("counts tokens the way pi does", () => {
		expect(count(0)).toBe("0");
		expect(count(999)).toBe("999");
		expect(count(1000)).toBe("1k");
		expect(count(1234)).toBe("1.2k");
		expect(count(43_210)).toBe("43k");
		expect(count(1_250_000)).toBe("1.3M");
		expect(count(22_400_000)).toBe("22M");
	});

	test("writes speeds with a decimal only when small", () => {
		expect(rate(4.25)).toBe("4.3");
		expect(rate(42)).toBe("42");
		expect(rate(906.4)).toBe("906");
		expect(rate(48_123)).toBe("48k");
	});

	test("writes durations and latencies", () => {
		expect(duration(9_400)).toBe("9s");
		expect(duration(137_000)).toBe("2m 17s");
		expect(duration(3_840_000)).toBe("1h 4m");
		expect(latency(320)).toBe("320ms");
		expect(latency(1_700)).toBe("1.7s");
		expect(latency(12_000)).toBe("12s");
	});

	test("writes money with cents until it is dollars", () => {
		expect(money(0.497)).toBe("$0.497");
		expect(money(13.614)).toBe("$13.61");
		expect(percent(8.14)).toBe("8.1%");
		expect(percent(48.9)).toBe("49%");
	});

	test("shortens a path from the left, keeping whole folders", () => {
		expect(shortenPath("/home/ada/Projects/pi-harness", "/home/ada", 40)).toBe(
			"~/Projects/pi-harness",
		);
		expect(shortenPath("/home/ada", "/home/ada", 40)).toBe("~");
		expect(shortenPath("/srv/app", "/home/ada", 40)).toBe("/srv/app");
		expect(shortenPath("/home/ada/Projects/pi-harness/packages/look", "/home/ada", 20)).toBe(
			".../packages/look",
		);
		expect(shortenPath("/home/ada/a-very-long-folder-name", "/home/ada", 10)).toBe("...er-name");
	});

	test("fills a gauge", () => {
		expect(gauge(0, 8)).toEqual({ filled: 0, empty: 8 });
		expect(gauge(50, 8)).toEqual({ filled: 4, empty: 4 });
		expect(gauge(120, 8)).toEqual({ filled: 8, empty: 0 });
	});

	test("clips a tail from the start", () => {
		expect(truncateTail("short", 10)).toBe("short");
		expect(truncateTail("the newest part", 8)).toBe("... part");
	});
});

describe("fit", () => {
	const pieces: Piece[] = [
		{ text: "model-name", compact: "model", priority: 100 },
		{ text: "branch", priority: 50 },
		{ text: "host", priority: 10 },
	];

	test("keeps everything when it fits", () => {
		expect(fitLine(pieces, 80, { separator: " · " })).toBe("model-name · branch · host");
	});

	test("shortens before it drops, so a short form keeps the other pieces in", () => {
		// 26 wide as is. Shortening the model makes room for all three.
		expect(fitLine(pieces, 21, { separator: " · " })).toBe("model · branch · host");
		expect(fitLine(pieces, 18, { separator: " · " })).toBe("model · branch");
	});

	test("drops by priority, and keeps one piece cut to the width", () => {
		expect(fitLine(pieces, 8, { separator: " · " })).toBe("model");
		expect(plain(fitLine(pieces, 4, { separator: " · " }))).toBe("m...");
	});

	test("regions compete for one width", () => {
		const left: Piece[] = [{ text: "important", priority: 90 }];
		const right: Piece[] = [
			{ text: "minor", priority: 5 },
			{ text: "context", priority: 80 },
		];
		expect(fitRegions([left, right], 30, { separator: " ", regionOverhead: 2 })).toEqual([
			"important",
			"minor context",
		]);
		expect(fitRegions([left, right], 22, { separator: " ", regionOverhead: 2 })).toEqual([
			"important",
			"context",
		]);
	});
});

function lead(budget: number): string {
	return "⠋ Thinking about a very long thought".slice(0, budget);
}

function piece(text: string, priority = 50): Piece {
	return { text, priority };
}

describe("frame", () => {
	const options = { box: BOXES.rounded, paint: (text: string) => text, separator: " · " };

	test("writes both regions into a border of the exact width", () => {
		const line = border(40, [piece("main")], [piece("~/code")], { ...options, edge: "top" });
		expect(line).toMatch(/^╭─ main ─+ ~\/code ─╮$/);
		expect(visibleWidth(line)).toBe(40);
	});

	test("draws a plain rule with nothing to say", () => {
		expect(border(10, [], [], { ...options, edge: "bottom" })).toBe("╰────────╯");
	});

	test("the lead follows the left pieces and takes only the room they leave", () => {
		const line = border(50, [piece("main")], [piece("~/code")], {
			...options,
			edge: "top",
			lead,
			leadMin: 10,
		});
		expect(line).toMatch(/^╭─ main · ⠋ Thinking.* ~\/code ─╮$/);
		expect(visibleWidth(line)).toBe(50);
	});

	test("the pieces stay put while the lead changes width", () => {
		const at = (text: string) =>
			border(60, [piece("main")], [piece("~/code")], {
				...options,
				edge: "top",
				lead: () => text,
				leadMin: 10,
			});
		const short = at("⠋ Waiting");
		const long = at("⠋ Thinking · the frame first");
		expect(short.indexOf("main")).toBe(long.indexOf("main"));
		expect(short.indexOf("~/code")).toBe(long.indexOf("~/code"));
	});

	test("the line style has no corners", () => {
		const line = border(20, [piece("a")], [], { ...options, box: BOXES.line, edge: "top" });
		expect(line).toBe("── a ───────────────");
	});
});

describe("glyphs", () => {
	test("auto picks Nerd Font locally, Unicode over SSH and ASCII without UTF-8", () => {
		expect(resolveIcons("auto", { LANG: "en_US.UTF-8" })).toBe(NERD);
		expect(resolveIcons("auto", { LANG: "en_US.UTF-8", SSH_TTY: "/dev/pts/1" })).toBe(UNICODE);
		expect(resolveIcons("auto", { LANG: "C" })).toBe(ASCII);
		expect(resolveIcons("auto", { TERM: "dumb" })).toBe(ASCII);
		expect(resolveIcons("unicode", {})).toBe(UNICODE);
	});

	test("every glyph set is one column per glyph, so the frame stays straight", () => {
		for (const set of [NERD, UNICODE]) {
			for (const [name, glyph] of Object.entries(set)) {
				if (typeof glyph !== "string" || name === "set" || name === "ellipsis") continue;
				expect({ name, width: visibleWidth(glyph) }).toEqual({ name, width: 1 });
			}
		}
	});
});

test("every role is painted with a theme token, never a colour", () => {
	for (const token of Object.values(ROLE_TOKENS)) expect(token).toMatch(/^[a-z][A-Za-z]+$/);
});

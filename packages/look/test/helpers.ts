import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";

import { emptySnapshot, type Snapshot } from "../src/data/snapshot.ts";
import { ASCII, type Glyphs } from "../src/render/glyphs.ts";
import { PLAIN, type Paint } from "../src/render/paint.ts";
import type { SegmentId } from "../src/render/segments.ts";
import type { Screen, SlotName } from "../src/ui/screen.ts";

export function snapshot(overrides: Partial<Snapshot> = {}): Snapshot {
	return {
		...emptySnapshot(),
		now: new Date(2026, 8, 29, 11, 18).getTime(),
		cwd: "/home/ada/Projects/pi-harness",
		home: "/home/ada",
		branch: "main",
		host: "ghost",
		model: { name: "Opus 5.5", provider: "Anthropic", reasoning: true },
		thinking: "high",
		context: { percent: 43.1, tokens: 431_000, window: 1_000_000 },
		totals: { input: 2400, output: 347, cacheRead: 83_000, cacheWrite: 0, cost: 0.139 },
		...overrides,
	};
}

export const SLOTS: Record<SlotName, SegmentId[]> = {
	strip: ["speed", "wait", "elapsed"],
	stripRight: [],
	topLeft: ["branch"],
	topRight: ["path"],
	bottomLeft: ["model", "effort"],
	bottomRight: ["context"],
	below: ["statuses", "cost"],
	belowRight: [],
};

export function screen(
	data: Snapshot = snapshot(),
	overrides: Partial<Screen> & { slots?: Partial<Record<SlotName, SegmentId[]>> } = {},
): Screen {
	const slots = { ...SLOTS, ...overrides.slots };
	let revision = 0;
	return {
		snapshot: () => data,
		glyphs: (): Glyphs => ASCII,
		paint: (frame?: (text: string) => string): Paint => ({ ...PLAIN, frame: frame ?? PLAIN.frame }),
		separator: () => " · ",
		options: () => ({ pathLength: 40, gaugeCells: 8, claimed: new Set<string>(), labels: false }),
		slot: (name) => slots[name],
		frameStyle: () => "rounded",
		decorate: (line) => line,
		skills: () => false,
		cursor: () => "block",
		revision: () => revision,
		bump: () => {
			revision++;
		},
		...overrides,
	};
}

export function plain(text: string): string {
	return stripTerminalSequences(text);
}

export function widths(lines: readonly string[]): number[] {
	return lines.map((line) => visibleWidth(line));
}

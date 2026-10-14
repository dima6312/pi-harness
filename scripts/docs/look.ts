import type {
	KeybindingsManager,
	ReadonlyFooterDataProvider,
	Theme,
} from "@earendil-works/pi-coding-agent";
import {
	getKeybindings,
	KeybindingsManager as TuiKeybindings,
	setKeybindings,
	TUI_KEYBINDINGS,
	type TUI,
} from "@earendil-works/pi-tui";

import { emptySnapshot, type Snapshot } from "../../packages/look/src/data/snapshot.ts";
import { emptyTotals } from "../../packages/look/src/data/totals.ts";
import { NERD } from "../../packages/look/src/render/glyphs.ts";
import { themePaint } from "../../packages/look/src/render/paint.ts";
import { claimedStatuses, type SegmentId } from "../../packages/look/src/render/segments.ts";
import {
	below,
	belowRight,
	bottomLeft,
	bottomRight,
	gaugeCells,
	labels,
	pathLength,
	SEPARATORS,
	separator,
	strip,
	stripRight,
	topLeft,
	topRight,
} from "../../packages/look/src/settings.ts";
import { LookEditor } from "../../packages/look/src/ui/editor.ts";
import { FooterComponent, StripComponent } from "../../packages/look/src/ui/footer.ts";
import { HeaderComponent } from "../../packages/look/src/ui/header.ts";
import type { Screen, SlotName } from "../../packages/look/src/ui/screen.ts";
import { shippingTasks } from "./tasks.ts";

const WIDTH = 100;

const SLOTS: Record<SlotName, SegmentId[]> = {
	strip: strip.default,
	stripRight: stripRight.default,
	topLeft: topLeft.default,
	topRight: topRight.default,
	bottomLeft: bottomLeft.default,
	bottomRight: bottomRight.default,
	below: below.default,
	belowRight: belowRight.default,
};

function snapshot(theme: Theme): Snapshot {
	return {
		...emptySnapshot(),
		now: new Date(2026, 9, 3, 15, 12).getTime(),
		// Pinned, so an SDK bump does not make the picture stale.
		version: "1.0.1",
		cwd: "/home/ada/Projects/pi-harness",
		home: "/home/ada",
		branch: "main",
		git: { ahead: 1, behind: 0, staged: 0, modified: 2, untracked: 0, conflicted: 0, stashed: 0 },
		host: "ghost",
		model: { name: "Claude Opus 5.5", provider: "Anthropic", reasoning: true },
		account: {
			provider: "anthropic",
			label: "work",
			windows: [
				{ name: "5h", used: 62, resetsIn: "2h" },
				{ name: "week", used: 30, resetsIn: "4d" },
			],
		},
		thinking: "high",
		context: { percent: 34, tokens: 337_000, window: 1_000_000 },
		totals: { input: 120_000, output: 106_000, cacheRead: 33_900_000, cacheWrite: 0, cost: 11.07 },
		cacheHit: 100,
		subscription: true,
		run: { running: true, elapsedMs: 47_000, requests: 2 },
		last: {
			streaming: false,
			waiting: false,
			elapsedMs: 9_100,
			waitMs: 7_400,
			waitingMs: 7_400,
			serverMs: 900,
			prefillMs: 6_500,
			thoughtMs: 1,
			decode: 183,
			prefill: 49_000,
			usage: emptyTotals(),
			estimated: false,
		},
		averages: { decode: 183, prefill: 49_000 },
		tasks: shippingTasks(),
		statuses: new Map([["pi-ask-permission:mode", theme.fg("warning", "\u23f5 judge")]]),
	};
}

function screen(theme: Theme): Screen {
	const data = snapshot(theme);
	return {
		snapshot: () => data,
		glyphs: () => NERD,
		paint: (frame) => themePaint(theme, frame),
		separator: () => SEPARATORS[separator.default],
		options: () => ({
			pathLength: pathLength.default,
			gaugeCells: gaugeCells.default,
			labels: labels.default,
			claimed: claimedStatuses(Object.values(SLOTS)),
		}),
		slot: (name) => SLOTS[name],
		frameStyle: () => "rounded",
		decorate: (line) => line,
		skills: () => false,
		cursor: () => "block",
	};
}

const tui = {
	terminal: { rows: 40, columns: WIDTH, write: () => {} },
	requestRender: () => {},
	getShowHardwareCursor: () => true,
	setShowHardwareCursor: () => {},
} as unknown as TUI;

// Pi's defaults for the keys on the card, which pi does not export.
const APP_KEYS = {
	"app.model.select": { defaultKeys: "ctrl+l" },
	"app.thinking.cycle": { defaultKeys: "shift+tab" },
	"app.editor.external": { defaultKeys: "ctrl+g" },
} as const;

function same(text: string): string {
	return text;
}

function working(theme: Theme): Parameters<LookEditor["setWorkingStatusIndicator"]>[0] {
	const text = `${theme.fg("accent", "\u2839")} ${theme.fg("muted", "thinking")}`;
	const indicator = {
		renderInBorder: () => text,
		renderSpinnerInBorder: () => theme.fg("accent", "\u2839"),
	};
	return indicator as unknown as Parameters<LookEditor["setWorkingStatusIndicator"]>[0];
}

export interface LookParts {
	header: string[];
	strip: string[];
	editor: string[];
	footer: string[];
}

/** The look, in the order it sits on the screen. */
export function drawLook(theme: Theme): string[] {
	const look = lookParts(theme);
	return [...look.header, ...look.strip, ...look.editor, ...look.footer];
}

/** The pieces on their own, so a picture can put something between them. */
export function lookParts(
	theme: Theme,
	draft = "make the README say what the harness brings",
): LookParts {
	const keys = getKeybindings();
	setKeybindings(new TuiKeybindings({ ...TUI_KEYBINDINGS, ...APP_KEYS }));
	try {
		return screenParts(theme, draft);
	} finally {
		setKeybindings(keys);
	}
}

function screenParts(theme: Theme, draft: string): LookParts {
	const view = screen(theme);
	const header = new HeaderComponent(view, {
		style: () => "card",
		counts: () => ({ tools: 4, skills: 6, prompts: 0, extensions: 4 }),
		lastVisit: () => undefined,
	}).render(WIDTH);

	const editor = new LookEditor(
		tui,
		{
			borderColor: (text) => theme.fg("thinkingHigh", text),
			selectList: {
				selectedPrefix: same,
				selectedText: same,
				description: same,
				scrollInfo: same,
				noMatch: same,
			},
		},
		{ matches: () => false } as unknown as KeybindingsManager,
		view,
	);
	editor.setWorkingStatusIndicator(working(theme));
	if (draft !== "") editor.setText(draft);

	const footer = new FooterComponent(
		tui,
		{ onBranchChange: () => () => {} } as unknown as ReadonlyFooterDataProvider,
		view,
		{ attach: () => {}, detach: () => {} },
	);

	return {
		header,
		strip: new StripComponent(view).render(WIDTH),
		editor: editor.render(WIDTH),
		footer: footer.render(WIDTH),
	};
}

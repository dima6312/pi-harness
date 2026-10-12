import { describe, expect, test } from "bun:test";

import { applyTaskOps, emptyTasks, type TaskOp } from "@adeildo/pi-kit";
import {
	type KeybindingsManager,
	type ReadonlyFooterDataProvider,
} from "@earendil-works/pi-coding-agent";
import type { AutocompleteProvider, EditorTheme, TUI } from "@earendil-works/pi-tui";

import { LookEditor } from "../src/ui/editor.ts";
import { FooterComponent, StripComponent } from "../src/ui/footer.ts";
import { halfBlocks, HeaderComponent } from "../src/ui/header.ts";
import { draftedTool, describe as describeActivity } from "../src/ui/working.ts";
import { plain, screen, snapshot, widths } from "./helpers.ts";

function fakeTui(): TUI {
	return {
		terminal: { rows: 40, columns: 100, write: () => {} },
		requestRender: () => {},
		getShowHardwareCursor: () => false,
		setShowHardwareCursor: () => {},
	} as unknown as TUI;
}

const editorTheme: EditorTheme = {
	borderColor: (text) => text,
	selectList: {
		selectedPrefix: (text) => text,
		selectedText: (text) => text,
		description: (text) => text,
		scrollInfo: (text) => text,
		noMatch: (text) => text,
	},
};

function editor(
	style: "rounded" | "line" | "off" = "rounded",
	overrides: Parameters<typeof screen>[1] = {},
) {
	const keybindings = { matches: () => false } as unknown as KeybindingsManager;
	return new LookEditor(
		fakeTui(),
		editorTheme,
		keybindings,
		screen(snapshot(), { frameStyle: () => style, ...overrides }),
	);
}

/** A list that answers every request, and keeps what it was asked. */
function recordingProvider(asked: string[]): AutocompleteProvider {
	return {
		getSuggestions: async (lines, line, col) => {
			asked.push((lines[line] ?? "").slice(0, col));
			return { items: [{ value: "/skill:simplify", label: "skill:simplify" }], prefix: "/" };
		},
		applyCompletion: (lines, cursorLine, cursorCol) => ({ lines, cursorLine, cursorCol }),
	};
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

describe("skills in the editor", () => {
	test("a slash further into the message opens the list", async () => {
		const asked: string[] = [];
		const view = editor("rounded", { skills: () => true });
		view.setAutocompleteProvider(recordingProvider(asked));
		view.setText("use ");
		view.handleInput("/");
		await settle();

		expect(asked).toEqual(["use /"]);
		expect(view.isShowingAutocomplete()).toBe(true);
	});

	test("with no skills feature, a slash is only a slash", async () => {
		const asked: string[] = [];
		const view = editor();
		view.setAutocompleteProvider(recordingProvider(asked));
		view.setText("use ");
		view.handleInput("/");
		await settle();

		expect(asked).toEqual([]);
	});

	test("a skill you typed is drawn the way the screen colors it", () => {
		const view = editor("rounded", {
			decorate: (line) => line.replace("/skill:simplify", "<simplify>"),
		});
		view.setText("use /skill:simplify now");
		expect(plain(view.render(60)[1] ?? "")).toContain("use <simplify> now");
	});
});

describe("editor", () => {
	test("draws a box of the exact width with the slots in its borders", () => {
		const view = editor();
		view.setText("hello");
		const lines = view.render(60);

		expect(widths(lines)).toEqual([60, 60, 60]);
		expect(plain(lines[0] ?? "")).toMatch(/^╭─ main ─+ ~\/Projects\/pi-harness ─╮$/);
		expect(plain(lines[1] ?? "")).toMatch(/^│ hello +│$/);
		// At 60 columns the effort meter drops its label, and the context keeps everything.
		expect(plain(lines[2] ?? "")).toBe(
			"╰─ Anthropic/Opus 5.5 · |||||| ─ ctx 43% ###----- 431k/1M ─╯",
		);
		expect(plain(view.render(90)[2] ?? "")).toMatch(
			/^╰─ Anthropic\/Opus 5\.5 · \|{6} high ─+ ctx 43% .* ─╯$/,
		);
	});

	test("the second line lines up under the first", () => {
		const view = editor();
		view.setText("one\ntwo");
		const lines = view.render(40).map(plain);
		expect(lines[1]?.startsWith("│ one")).toBe(true);
		expect(lines[2]?.startsWith("│ two")).toBe(true);
	});

	test("puts the working spinner after the branch, so the branch never moves", () => {
		const view = editor();
		view.setWorkingStatusIndicator({
			renderInBorder: () => "* thinking",
			renderSpinnerInBorder: () => "*",
		} as unknown as Parameters<LookEditor["setWorkingStatusIndicator"]>[0]);
		const [top] = view.render(80).map(plain);
		expect(top).toMatch(/^╭─ main · \* thinking ─+ ~\/Projects\/pi-harness ─╮$/);
	});

	test("the line style keeps pi's two rules and writes into them", () => {
		const view = editor("line");
		view.setText("hi");
		const lines = view.render(50).map(plain);
		expect(lines[0]).toMatch(/^── main ─+ ~\/Projects\/pi-harness ──$/);
		expect(lines[1]).toMatch(/^hi/);
	});

	test("off leaves pi's editor exactly as it is", () => {
		const view = editor("off");
		view.setText("hi");
		const lines = view.render(30).map(plain);
		expect(lines[0]).toBe("─".repeat(30));
	});

	test("clicks land on the text, not on the frame", () => {
		const view = editor();
		view.setText("abcdef");
		view.render(40);
		// Column 2 is the rail and its space: the first character.
		view.handleMouse({
			type: "click",
			button: "left",
			x: 4,
			y: 1,
			screenX: 4,
			screenY: 1,
			width: 40,
			height: 3,
			shift: false,
			alt: false,
			ctrl: false,
		});
		view.insertTextAtCursor?.("X");
		expect(view.getText()).toBe("abXcdef");
	});
});

function stripLines(data: ReturnType<typeof snapshot>): number {
	return new StripComponent(screen(data, { slots: { stripRight: ["tasks"] } })).render(90).length;
}

/** A task under way, and the ones after it queued behind. */
function tasksOf(doing: string, ...queued: string[]) {
	const asks: TaskOp[] = [doing, ...queued].map((text) => ({ op: "ask", text }));
	return applyTaskOps(emptyTasks(), asks, { at: 1, origin: "you" });
}

describe("strip and footer", () => {
	test("the strip keeps its line before there is an answer, so the editor never jumps", () => {
		expect(new StripComponent(screen()).render(80)).toEqual([""]);
	});

	test("the strip lines up with the text in the frame", () => {
		const data = snapshot({ run: { running: false, elapsedMs: 9_000, requests: 1 } });
		expect(new StripComponent(screen(data)).render(80).map(plain)).toEqual(["  0:09"]);
	});

	test("the tasks sit on the right of the strip when there is room, and under it when not", () => {
		const tasks = tasksOf("draw the strip");
		const data = snapshot({ tasks, run: { running: false, elapsedMs: 9_000, requests: 1 } });
		const strip = new StripComponent(screen(data, { slots: { stripRight: ["tasks"] } }));

		const [wide = ""] = strip.render(100).map(plain);
		expect(strip.render(100)).toHaveLength(1);
		expect(wide).toMatch(/^ {2}0:09 +> draw the strip$/);
		expect(wide).toHaveLength(98);

		// Narrower than the room kept for the strip: the tasks get their own line, on the left.
		expect(strip.render(70).map(plain)).toEqual(["  0:09", "  > draw the strip"]);
	});

	test("on its own line a long step uses the whole width, and its words give way before its counts", () => {
		const step = "verify the tasks on the strip, its line of its own, and how it cuts a long step";
		const tasks = tasksOf(step, "frame");
		const strip = new StripComponent(
			screen(snapshot({ tasks }), { slots: { stripRight: ["tasks"] } }),
		);

		expect(strip.render(100).map(plain)).toEqual(["", `  > ${step}  1 queued`]);
		const [, cut = ""] = strip.render(60).map(plain);
		expect(cut).toHaveLength(58);
		expect(cut).toEndWith("...  1 queued");
	});

	test("beside a busy strip the tasks keep its counts, and the strip gives way", () => {
		const tasks = tasksOf("draw the strip", "frame");
		const busy = snapshot({
			tasks,
			run: { running: true, elapsedMs: 3_600_000, requests: 40 },
			last: {
				firstTokenMs: 6_600,
				generationMs: 3_300,
				output: 900,
				prompt: 1000,
				elapsedMs: 9_000,
			} as never,
		});
		const [line = ""] = new StripComponent(screen(busy, { slots: { stripRight: ["tasks"] } }))
			.render(100)
			.map(plain);
		expect(line).toEndWith("> draw the strip  1 queued");
	});

	test("the strip's width does not move the tasks between lines", () => {
		const tasks = tasksOf("draw the strip");
		const idle = snapshot({ tasks });
		const busy = snapshot({ tasks, run: { running: true, elapsedMs: 3_600_000, requests: 40 } });
		expect(stripLines(idle)).toBe(stripLines(busy));
	});

	test("the footer carries the frame slots when the frame is off", () => {
		const data = snapshot({
			totals: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, cost: 1.5 },
		});
		const footerData = {
			onBranchChange: () => () => {},
		} as unknown as ReadonlyFooterDataProvider;
		const hooks = { attach: () => {}, detach: () => {} };

		const framed = new FooterComponent(fakeTui(), footerData, screen(data), hooks);
		expect(framed.render(80).map(plain)).toEqual(["  $1.500"]);

		const bare = new FooterComponent(
			fakeTui(),
			footerData,
			screen(data, { frameStyle: () => "off" }),
			hooks,
		);
		const lines = bare.render(80).map(plain);
		expect(lines).toHaveLength(3);
		expect(lines[0]).toMatch(/^ main +~\/Projects\/pi-harness$/);
		expect(widths(lines).every((width) => width <= 80)).toBe(true);
	});
});

describe("header", () => {
	const source = {
		style: () => "card" as const,
		counts: () => ({ tools: 14, skills: 9, prompts: 0, extensions: 7 }),
	};

	test("draws the card with the logo when there is room", () => {
		const lines = new HeaderComponent(screen(), source).render(100).map(plain);
		expect(lines[0]).toMatch(/^╭─ π pi v\S+ ─+╮$/);
		expect(lines.some((line) => line.includes("▀▀▀██▀▀▀▀██▀▀▀"))).toBe(true);
		expect(lines.some((line) => line.includes("14 tools · 9 skills · 7 extensions"))).toBe(true);
		expect(widths(lines.filter(Boolean)).every((width) => width === 100)).toBe(true);
	});

	test("drops the logo before the information", () => {
		const lines = new HeaderComponent(screen(), source).render(56).map(plain);
		expect(lines.some((line) => line.includes("██"))).toBe(false);
		expect(lines.some((line) => line.includes("Anthropic/Opus 5.5"))).toBe(true);
	});

	test("two plain lines when compact", () => {
		const lines = new HeaderComponent(screen(), { ...source, style: () => "compact" }).render(120);
		expect(lines).toHaveLength(3);
		expect(plain(lines[0] ?? "")).toContain("π pi");
	});

	test("the logo is drawn from pixels, two per row", () => {
		expect(halfBlocks(["#.#", "##."])).toEqual(["█▄▀"]);
	});
});

describe("working line", () => {
	test("names the state, in lower case, and never repeats the call", () => {
		expect(describeActivity({ kind: "waiting" })).toBe("waiting");
		expect(describeActivity({ kind: "thinking" })).toBe("thinking");
		expect(describeActivity({ kind: "writing" })).toBe("writing");
		expect(describeActivity({ kind: "drafting", tool: "Bash" })).toBe("drafting bash");
		expect(describeActivity({ kind: "running", tool: "edit" })).toBe("running edit");
	});

	test("the drafted tool is the call the model is writing last", () => {
		expect(draftedTool([{ type: "text" }, { type: "toolCall", name: "read" }])).toBe("read");
		expect(draftedTool([{ type: "toolCall", name: "read" }, { type: "text" }])).toBeUndefined();
		expect(draftedTool("not content")).toBeUndefined();
	});
});

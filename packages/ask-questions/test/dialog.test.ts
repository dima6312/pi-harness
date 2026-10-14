import { beforeAll, describe, expect, test } from "bun:test";

import type { AskResult } from "@adeildo/pi-kit";
import { getMarkdownTheme, initTheme, type Theme } from "@earendil-works/pi-coding-agent";
import {
	type KeybindingsManager,
	type TUI,
	type TuiMouseEvent,
	visibleWidth,
} from "@earendil-works/pi-tui";

import type { Question } from "../src/schema.ts";
import { QuestionDialog } from "../src/ui/dialog.ts";
import { renderCall, renderResult } from "../src/ui/transcript.ts";

const plain = {
	fg: (_color: string, text: string) => text,
	bg: (_color: string, text: string) => text,
	bold: (text: string) => text,
	italic: (text: string) => text,
} as unknown as Theme;

const KEYS = {
	up: "\x1b[A",
	down: "\x1b[B",
	left: "\x1b[D",
	right: "\x1b[C",
	enter: "\r",
	tab: "\t",
	esc: "\x1b",
	space: " ",
};

const NO_BINDINGS = { matches: () => false } as unknown as KeybindingsManager;
const TUI_STUB = {
	requestRender: () => {},
	terminal: { rows: 40, columns: 120 },
} as unknown as TUI;

const AUTH: Question = {
	question: "Which auth method?",
	header: "Auth",
	options: [
		{ label: "OAuth", description: "The provider's login", preview: "```\n[ Sign in ]\n```" },
		{ label: "API key", description: "A key in the env" },
	],
};

const FEATURES: Question = {
	question: "Which features?",
	header: "Features",
	multiSelect: true,
	options: [
		{ label: "Search", description: "Find things" },
		{ label: "Export", description: "Save things" },
		{ label: "Share", description: "Send things" },
	],
};

beforeAll(() => initTheme("dark", false));

function open(...questions: Question[]) {
	const results: AskResult[] = [];
	const dialog = new QuestionDialog({
		tui: TUI_STUB,
		theme: plain,
		markdownTheme: getMarkdownTheme(),
		keybindings: NO_BINDINGS,
		questions,
		complete: (result) => results.push(result),
	});
	dialog.focused = true;
	return { dialog, results };
}

function press(dialog: QuestionDialog, ...keys: string[]): void {
	for (const key of keys) dialog.handleInput(key);
}

function type(dialog: QuestionDialog, text: string): void {
	for (const char of text) dialog.handleInput(char);
}

describe("one question", () => {
	test("enter picks the focused option and ends the dialog", () => {
		const { dialog, results } = open(AUTH);
		press(dialog, KEYS.down, KEYS.enter);
		expect(results).toEqual([
			{
				cancelled: false,
				answers: [{ question: AUTH.question, header: "Auth", picked: ["API key"], notes: [] }],
			},
		]);
	});

	test("a number moves to its option", () => {
		const { dialog, results } = open(AUTH);
		press(dialog, "2", KEYS.enter);
		expect(results[0]?.answers[0]?.picked).toEqual(["API key"]);
	});

	test("esc closes without submitting", () => {
		const { dialog, results } = open(AUTH);
		press(dialog, KEYS.esc);
		expect(results).toEqual([{ cancelled: true, answers: [] }]);
	});

	test("the typed row takes an answer in your own words", () => {
		const { dialog, results } = open(AUTH);
		press(dialog, "3");
		type(dialog, "neither, use mTLS");
		press(dialog, KEYS.enter);
		expect(results[0]?.answers[0]).toEqual({
			question: AUTH.question,
			header: "Auth",
			picked: [],
			typed: "neither, use mTLS",
			notes: [],
		});
	});

	test("an empty typed row does not answer", () => {
		const { dialog, results } = open(AUTH);
		press(dialog, "3", KEYS.enter);
		expect(results).toEqual([]);
	});

	test("esc on the typed row goes back to the options", () => {
		const { dialog, results } = open(AUTH);
		press(dialog, "3", KEYS.esc, KEYS.enter);
		expect(results[0]?.answers[0]?.picked).toEqual(["API key"]);
	});
});

describe("notes", () => {
	test("a note rides on the picked option", () => {
		const { dialog, results } = open(AUTH);
		press(dialog, KEYS.tab);
		type(dialog, "we already have it");
		press(dialog, KEYS.enter, KEYS.enter);
		expect(results[0]?.answers[0]).toEqual({
			question: AUTH.question,
			header: "Auth",
			picked: ["OAuth"],
			notes: [{ option: "OAuth", note: "we already have it" }],
		});
	});

	test("an option you did not pick keeps its note too", () => {
		const { dialog, results } = open(AUTH);
		press(dialog, KEYS.down, KEYS.tab);
		type(dialog, "keys leak");
		press(dialog, KEYS.tab, KEYS.up, KEYS.enter);
		expect(results[0]?.answers[0]?.picked).toEqual(["OAuth"]);
		expect(results[0]?.answers[0]?.notes).toEqual([{ option: "API key", note: "keys leak" }]);
	});

	test("arrows in a note move to the next option's note", () => {
		const { dialog, results } = open(AUTH);
		press(dialog, KEYS.tab);
		type(dialog, "yes");
		press(dialog, KEYS.down);
		type(dialog, "no");
		press(dialog, KEYS.enter, KEYS.up, KEYS.enter);
		expect(results[0]?.answers[0]?.notes).toEqual([
			{ option: "OAuth", note: "yes" },
			{ option: "API key", note: "no" },
		]);
	});

	test("a note shows once, in the panel, and the option's row only marks it", () => {
		const { dialog } = open(AUTH);
		press(dialog, KEYS.tab);
		type(dialog, "we already have it");
		press(dialog, KEYS.enter);
		const lines = dialog.render(120);
		expect(lines.join("\n").split("we already have it")).toHaveLength(2);
		const row = lines.find((line) => line.includes("1  OAuth"));
		expect(row?.split("\u2502")[1]).toContain("\u203a");
	});
});

describe("several picks", () => {
	test("space ticks, enter confirms", () => {
		const { dialog, results } = open(FEATURES);
		press(dialog, KEYS.space, KEYS.down, KEYS.down, KEYS.space, KEYS.enter);
		expect(results[0]?.answers[0]?.picked).toEqual(["Search", "Share"]);
	});

	test("enter with nothing ticked takes the focused option", () => {
		const { dialog, results } = open(FEATURES);
		press(dialog, KEYS.down, KEYS.enter);
		expect(results[0]?.answers[0]?.picked).toEqual(["Export"]);
	});

	test("a typed answer comes with the picks", () => {
		const { dialog, results } = open(FEATURES);
		press(dialog, KEYS.space, "4");
		type(dialog, "and print");
		press(dialog, KEYS.enter);
		expect(results[0]?.answers[0]).toMatchObject({ picked: ["Search"], typed: "and print" });
	});
});

describe("several questions", () => {
	test("answering moves to the next question, then to submit", () => {
		const { dialog, results } = open(AUTH, FEATURES);
		press(dialog, KEYS.enter);
		expect(dialog.render(80).join("\n")).toContain("Which features?");
		press(dialog, KEYS.enter);
		expect(dialog.render(80).join("\n")).toContain("Review your answers");
		press(dialog, KEYS.enter);
		expect(results[0]?.answers.map((answer: { picked: string[] }) => answer.picked)).toEqual([
			["OAuth"],
			["Search"],
		]);
		expect(results[0]?.cancelled).toBe(false);
	});

	test("the submit tab names what is left unanswered", () => {
		const { dialog, results } = open(AUTH, FEATURES);
		press(dialog, KEYS.enter);
		press(dialog, KEYS.right);
		const text = dialog.render(80).join("\n");
		expect(text).toContain("not answered");
		expect(text).toContain("1 question goes back unanswered");
		press(dialog, KEYS.enter);
		expect(results[0]?.answers).toHaveLength(1);
	});

	test("arrows switch questions and keep what was picked", () => {
		const { dialog } = open(AUTH, FEATURES);
		press(dialog, KEYS.down, KEYS.enter, KEYS.left);
		expect(dialog.render(80).join("\n")).toContain("\u276f 2  API key \u2713");
	});
});

describe("drawing", () => {
	test("every line is exactly the width, the typed row's editor included", () => {
		const { dialog } = open(AUTH, FEATURES);
		for (const width of [40, 80, 120]) {
			for (const line of dialog.render(width)) expect(visibleWidth(line)).toBe(width);
		}
		press(dialog, "3");
		type(dialog, "a long answer that has to wrap inside the editor box");
		for (const line of dialog.render(60)) expect(visibleWidth(line)).toBe(60);
	});

	test("a wide terminal puts the detail beside the options", () => {
		const { dialog } = open(AUTH);
		const lines = dialog.render(120);
		const row = lines.find((line) => line.includes("OAuth"));
		expect(row).toContain("\u2502 ");
		expect(lines.join("\n")).toContain("[ Sign in ]");
		expect(lines.join("\n")).toContain("The provider's login");
	});

	test("a narrow terminal puts it below", () => {
		const { dialog } = open(AUTH);
		const lines = dialog.render(70);
		const optionRow = lines.findIndex((line) => line.includes("OAuth"));
		const detailRow = lines.findIndex((line) => line.includes("[ Sign in ]"));
		expect(detailRow).toBeGreaterThan(optionRow);
	});

	test("an option with no preview shows its description", () => {
		const { dialog } = open(AUTH);
		press(dialog, KEYS.down);
		const text = dialog.render(120).join("\n");
		expect(text).toContain("A key in the env");
		expect(text).not.toContain("[ Sign in ]");
	});

	test("moving around never changes the height", () => {
		const { dialog } = open(AUTH, FEATURES);
		for (const width of [70, 120]) {
			const heights = new Set<number>();
			for (const key of [KEYS.down, KEYS.down, KEYS.down, KEYS.up, KEYS.up, KEYS.up]) {
				heights.add(dialog.render(width).length);
				press(dialog, key);
			}
			expect([...heights]).toHaveLength(1);
		}
	});

	test("a confirmed note does not push the panel into scrolling", () => {
		const question: Question = {
			question: "Which one?",
			header: "One",
			options: [
				{
					label: "A",
					description: "x",
					preview: "```\none\ntwo\nthree\nfour\nfive\nsix\nseven\n```",
				},
				{ label: "B", description: "y" },
			],
		};
		const { dialog } = open(question);
		const before = dialog.render(120).length;
		press(dialog, KEYS.tab);
		type(dialog, "a note that is long enough to take a second line in the panel of the dialog");
		press(dialog, KEYS.enter);
		const text = dialog.render(120).join("\n");
		expect(text).not.toMatch(/\u2193 \d+ below/);
		expect(dialog.render(120).length).toBeGreaterThanOrEqual(before);
	});

	test("a lone question has a blank line under the title, and tabs take that place", () => {
		const alone = open(AUTH).dialog.render(80);
		expect(alone[1]?.replace(/[\u2502\s]/g, "")).toBe("");
		const several = open(AUTH, FEATURES).dialog.render(80);
		expect(several[1]).toContain("Auth");
	});

	test("a wide terminal fills the width and keeps prose to a readable line", () => {
		const long: Question = {
			question: "Which one?",
			header: "One",
			options: [
				{ label: "A", description: "word ".repeat(60).trim() },
				{ label: "B", description: "y" },
			],
		};
		const lines = open(long).dialog.render(250);
		for (const line of lines) expect(visibleWidth(line)).toBe(250);
		expect(lines[0]?.startsWith("\u256d")).toBe(true);
		const prose = lines
			.map((line) => (line.split("\u2502 ")[2] ?? "").replace(/\s*\u2502$/, ""))
			.filter((cell) => cell.includes("word"));
		expect(prose.length).toBeGreaterThan(1);
		for (const cell of prose) expect(visibleWidth(cell.trim())).toBeLessThanOrEqual(100);
	});
});

describe("answers", () => {
	test("ticks count as an answer even when you leave with the arrows", () => {
		const { dialog, results } = open(AUTH, FEATURES);
		press(dialog, KEYS.enter, KEYS.space, KEYS.right);
		const text = dialog.render(80).join("\n");
		expect(text).toContain("Search");
		expect(text).not.toContain("not answered");
		press(dialog, KEYS.enter);
		expect(results[0]?.answers.map((answer: { picked: string[] }) => answer.picked)).toEqual([
			["OAuth"],
			["Search"],
		]);
	});

	test("the tabs say what is answered", () => {
		const { dialog } = open(AUTH, FEATURES);
		expect(dialog.render(80)[0]).toContain("0/2");
		press(dialog, KEYS.enter);
		expect(dialog.render(80)[1]).toContain("\u2713 Auth");
		expect(dialog.render(80)[0]).toContain("1/2");
	});

	test("the typed answer is written in the panel", () => {
		const { dialog } = open(AUTH);
		press(dialog, "3");
		type(dialog, "mTLS");
		expect(dialog.render(120).join("\n")).toContain("mTLS");
	});
});

describe("a question without a typed row", () => {
	const closed: Question = { ...AUTH, typed: false };

	test("has no row for your own words, and the numbers stop at the options", () => {
		const { dialog, results } = open(closed);
		expect(dialog.render(120).join("\n")).not.toContain("Type something");
		press(dialog, "3", KEYS.enter);
		expect(results[0]?.answers[0]?.picked).toEqual(["OAuth"]);
	});

	test("down from the last option wraps to the first", () => {
		const { dialog, results } = open(closed);
		press(dialog, KEYS.down, KEYS.down, KEYS.enter);
		expect(results[0]?.answers[0]?.picked).toEqual(["OAuth"]);
	});
});

describe("notes", () => {
	test("the note is written in the panel, and only there", () => {
		const { dialog } = open(AUTH);
		press(dialog, KEYS.tab);
		type(dialog, "mine");
		const lines = dialog.render(120);
		expect(lines.join("\n").split("mine")).toHaveLength(2);
		const editor = lines.findLast((line) => line.includes("mine"));
		expect(editor?.indexOf("mine")).toBeGreaterThan(editor?.indexOf("\u2502 ") ?? 0);
	});

	test("writing a note does not resize the dialog", () => {
		const { dialog } = open(AUTH);
		const before = dialog.render(120).length;
		press(dialog, KEYS.tab);
		type(dialog, "a note");
		expect(dialog.render(120).length).toBe(before);
	});
});

function firstRow(dialog: QuestionDialog): string | undefined {
	return dialog
		.render(120)
		.join("\n")
		.match(/row (\d+)/)?.[1];
}

function draw(component: { render(width: number): string[] }): string {
	return component.render(90).join("\n");
}

describe("a preview taller than the panel", () => {
	const LONG: Question = {
		question: "Which layout?",
		header: "Layout",
		options: [
			{
				label: "Tall",
				preview: `\`\`\`\n${Array.from({ length: 60 }, (_, i) => `row ${i + 1}`).join("\n")}\n\`\`\``,
			},
			{ label: "Short", preview: "one line" },
		],
	};

	test("scrolls with shift and the arrows, which fullscreen pi leaves to the dialog", () => {
		const { dialog } = open(LONG);
		const text = dialog.render(120).join("\n");
		expect(firstRow(dialog)).toBe("1");
		expect(text).toMatch(/\u2193 \d+ below/);
		expect(text).toContain("shift+\u2191\u2193 scroll");
		// The panel draws a bar whose thumb sits at the top, and names the keys where it is cut.
		expect(text).toContain("\u2503");
		expect(text).toContain("shift+\u2191\u2193 or the wheel");
		press(dialog, "\x1b[1;2B");
		expect(Number(firstRow(dialog))).toBeGreaterThan(1);
		expect(dialog.render(120).join("\n")).toMatch(/\u2191 \d+ above/);
		press(dialog, "\x1b[1;2A");
		expect(firstRow(dialog)).toBe("1");
	});

	test("scrolls with the wheel, and leaves the wheel to the transcript when it fits", () => {
		const { dialog } = open(LONG);
		dialog.render(120);
		const wheel = { type: "wheel", wheelDelta: 3 } as TuiMouseEvent;
		expect(dialog.handleMouse(wheel)).toEqual({ handled: true });
		const once = Number(firstRow(dialog));
		dialog.handleMouse(wheel);
		expect(Number(firstRow(dialog)) - once).toBe(3);
		press(dialog, KEYS.down);
		dialog.render(120);
		expect(dialog.handleMouse(wheel)).toBeUndefined();
	});
});

describe("a preview drawn as a picture", () => {
	const box = [
		"\u256d\u2500 frame \u2500\u256e",
		"\u2502 a    b  \u2502",
		"\u2570\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u256f",
	].join("\n");
	const wide = `${"\u2500".repeat(110)}\n\u2502 too wide to sit beside the options`;

	test("keeps its lines and spaces, which markdown would join", () => {
		const { dialog } = open({
			question: "Which?",
			header: "Pick",
			options: [{ label: "Boxed", preview: box }, { label: "Plain" }],
		});
		const text = dialog.render(120).join("\n");
		expect(text).toContain("\u2502 a    b  \u2502");
		expect(text).toContain("\u256d\u2500 frame \u2500\u256e");
	});

	test("goes under the options when it is too wide to sit beside them", () => {
		const { dialog } = open({
			question: "Which?",
			header: "Pick",
			options: [{ label: "Wide", preview: wide }, { label: "Plain" }],
		});
		const lines = dialog.render(120);
		const row = lines.findIndex((line) => line.includes("1  Wide"));
		const drawn = lines.findIndex((line) => line.includes("too wide to sit beside"));
		expect(drawn).toBeGreaterThan(row);
		expect(lines[drawn]).not.toContain("Plain");
	});
});

describe("in the transcript", () => {
	test("while the model writes, each question shows as it arrives", () => {
		const text = draw(
			renderCall({ questions: [AUTH, { header: "Feat" } as Question] }, plain, true),
		);
		expect(text.split("\n").map((line) => line.trimEnd())).toEqual([
			"Auth  Which auth method?                                                         2 options",
			"Feat  \u258d",
		]);
		const feat = { header: "Feat", question: "Which ones?", options: [{ label: "Search" }] };
		const live = draw(renderCall({ questions: [AUTH, feat as Question] }, plain, true));
		// The question being written shows whole, its options under it, and a cursor where it writes.
		expect(live.split("\n").slice(1)).toEqual(["Feat  Which ones?", "      1 Search\u258d"]);
		// Written, one line with the headers: the dialog under it and the answers show the questions.
		expect(draw(renderCall({ questions: [AUTH, feat as Question] }, plain, false)).trimEnd()).toBe(
			"2 questions  Auth, Feat",
		);
	});

	test("each question, numbered, keeps its answer, the notes on it, and the notes on what you did not pick", () => {
		const result = {
			content: [],
			details: {
				cancelled: false,
				answers: [
					{
						question: AUTH.question,
						header: AUTH.header,
						picked: ["OAuth"],
						notes: [
							{ option: "OAuth", note: "we have it" },
							{ option: "API key", note: "leaks" },
						],
					},
				],
			},
		};
		expect(draw(renderResult(result, false, plain, [AUTH, FEATURES])).split("\n")).toEqual([
			"1  Auth",
			"   Which auth method?",
			"   \u2713 OAuth",
			"     note  we have it",
			"   note on API key  leaks",
			"2  Features",
			"   Which features?",
			"   \u25cb not answered",
		]);
	});

	test("a call that threw shows pi's error, not a crash", () => {
		const result = {
			content: [{ type: "text" as const, text: "two options share a label" }],
			details: {},
		};
		const threw = result as unknown as Parameters<typeof renderResult>[0];
		expect(draw(renderResult(threw, false, plain, [AUTH])).trimEnd()).toBe(
			"two options share a label",
		);
	});
});

import { afterEach, beforeAll, describe, expect, test } from "bun:test";

import {
	BranchSummaryMessageComponent,
	CompactionSummaryMessageComponent,
	CustomMessageComponent,
	getMarkdownTheme,
	initTheme,
	SkillInvocationMessageComponent,
	UserMessageComponent,
} from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences } from "@earendil-works/pi-tui";

import { framed, framePiEntries } from "../src/ui/pi-entries.ts";

const plain = {
	fg: (_color: string, text: string) => text,
	bg: (_color: string, text: string) => text,
	bold: (text: string) => text,
} as never;

const START = "\u001b]133;A\u0007";
const END = "\u001b]133;B\u0007\u001b]133;C\u0007";

function visible(lines: readonly string[]): string[] {
	return lines.map((line) => stripTerminalSequences(line).trimEnd());
}

function bg(line: string): string {
	return `\u001b[48;2;30;40;50m${line}\u001b[49m`;
}

describe("pi's entries in the transcript", () => {
	// Pi's components paint with its global theme.
	beforeAll(() => initTheme("dark", false));
	afterEach(() => framePiEntries(() => undefined));

	test("your message sits in a frame named you, without pi's background and blank rows", () => {
		// Pi draws the message two columns narrower, which the sides take.
		const body = [`${START}${bg("          ")}`, bg(" fix it   "), `${END}${bg("          ")}`];
		const lines = framed(body, 12, plain, { top: "> you" });
		expect(visible(lines)).toEqual([
			"\u256d\u2500 > you \u2500\u2500\u256e",
			"\u2502 fix it   \u2502",
			`\u2570${"\u2500".repeat(10)}\u256f`,
		]);
		// The shell integration markers stay on the first and last lines.
		expect(lines[0]?.startsWith(START)).toBe(true);
		expect(lines.at(-1)?.startsWith(END)).toBe(true);
		expect(lines.join("")).not.toContain("\u001b[48;");
	});

	test("a label like [skill] gives way to the top edge, alone or in front of the name", () => {
		expect(
			visible(
				framed(["", " [compaction]", "", " from 9 tokens"], 24, plain, { top: "t", label: true }),
			)[1],
		).toBe("\u2502 from 9 tokens        \u2502");
		expect(visible(framed([" [skill] simplify"], 24, plain, { top: "t", label: true }))[1]).toBe(
			"\u2502 simplify             \u2502",
		);
		// Your own words keep their brackets.
		expect(visible(framed([" [wip] fix it"], 24, plain, { top: "t" }))[1]).toContain(
			"[wip] fix it",
		);
	});

	test("compactions, branch summaries, skills and plain extension messages are framed", () => {
		framePiEntries(() => ({ theme: plain, set: "ascii", you: true }));
		const markdown = getMarkdownTheme();
		const compaction = new CompactionSummaryMessageComponent(
			{ role: "compactionSummary", summary: "s", tokensBefore: 182431, timestamp: 0 },
			markdown,
		);
		expect(visible(compaction.render(60))[0]).toStartWith("\u256d\u2500 \u03c0 compacted");
		expect(visible(compaction.render(60))[1]).toContain("Compacted from 182,431 tokens");
		const branch = new BranchSummaryMessageComponent(
			{ role: "branchSummary", summary: "s", fromId: null, timestamp: 0 },
			markdown,
		);
		expect(visible(branch.render(60))[0]).toStartWith("\u256d\u2500 \u03c0 branch summary");
		const skill = new SkillInvocationMessageComponent(
			{ name: "simplify", content: "c" } as never,
			markdown,
		);
		expect(visible(skill.render(60))[1]).toStartWith("\u2502 simplify");
		const custom = new CustomMessageComponent(
			{ role: "custom", customType: "pi-memory", content: "saved", display: true, timestamp: 0 },
			undefined,
			markdown,
		);
		const drawn = visible(custom.render(60));
		expect(drawn.find((line) => line.startsWith("\u256d"))).toStartWith("\u256d\u2500 pi-memory");
		expect(drawn.join("\n")).not.toContain("[pi-memory]");
	});

	test("pi's own block comes back when the frames are off", () => {
		const message = new UserMessageComponent("hello", getMarkdownTheme(), 1);
		framePiEntries(() => ({ theme: plain, set: "ascii", you: true }));
		expect(visible(message.render(20))[0]).toStartWith("\u256d\u2500 > you");
		framePiEntries(() => ({ theme: plain, set: "ascii", you: false }));
		expect(visible(message.render(20)).join("")).not.toContain("you");
		framePiEntries(() => undefined);
		expect(visible(message.render(20)).join("")).not.toContain("you");
	});
});

describe("a ! command", () => {
	test("keeps pi's command and output, with a cut between them instead of pi's rules", () => {
		const rule = "\u2500".repeat(22);
		const body = ["", rule, " $ ls", "", " a.ts", rule];
		expect(
			visible(framed(body, 24, plain, { top: "! shell", bottom: "done", rules: true })),
		).toEqual([
			`\u256d\u2500 ! shell ${"\u2500".repeat(12)}\u256e`,
			"\u2502 $ ls                 \u2502",
			`\u251c${"\u2500".repeat(22)}\u2524`,
			"\u2502 a.ts                 \u2502",
			`\u2570\u2500 done ${"\u2500".repeat(15)}\u256f`,
		]);
	});
});

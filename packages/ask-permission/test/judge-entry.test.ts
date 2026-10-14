import { describe, expect, test } from "bun:test";

import { fakePi, fakeScope } from "@adeildo/pi-kit/testing";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";

import type { JudgeRecord } from "#core/judge/types.ts";
import { registerJudgeEntry, toRecords } from "#ui/judge-entry.ts";

/** Colour-free stand-in; only fg/bold are ever called by the card. */
const theme = {
	fg: (_color: string, text: string) => text,
	bold: (text: string) => text,
} as unknown as Theme;

function record(overrides: Partial<JudgeRecord> = {}): JudgeRecord {
	return {
		model: "test-model",
		answers: { verdict: { choice: "allow", confidence: 0.9 }, reversibility: 0.1 },
		elapsedMs: 12,
		at: 0,
		toolName: "bash",
		summary: "git status",
		action: "allow",
		reason: "read-only",
		...overrides,
	};
}

/** Captures the registered renderer so entries can be rendered as on resume. */
type Registered = (
	entry: { data: unknown },
	options: { expanded: boolean },
	theme: Theme,
) => Component | undefined;

function renderer(): (data: unknown, expanded?: boolean) => Component | undefined {
	const fake = fakePi();
	registerJudgeEntry(fakeScope({ pi: fake }));
	const registered = fake.renderers.get("pi-ask-permission:judge") as Registered | undefined;
	return (data, expanded = false) => registered?.({ data }, { expanded }, theme);
}

const drawn = (data: unknown, expanded = false): string[] =>
	renderer()(data, expanded)?.render(80) ?? [];

/** The rows inside the frame, without its sides. */
const lines = (data: unknown, expanded = false): string[] =>
	drawn(data, expanded)
		.slice(1, -1)
		.map((row) => row.slice(2, -2).trimEnd());

const targetColumn = (row: string | undefined) => row?.indexOf("git status");

describe("judge entry", () => {
	test("accepts the array shape written today, one row per decision in a frame named judge", () => {
		const frame = drawn([record(), record({ toolName: "read" })]);
		expect(frame[0]).toMatch(/^\u256d\u2500 \u25c8 judge \u2500+ 2 decisions \u2500\u256e$/);
		expect(lines([record(), record({ toolName: "read" })])).toHaveLength(2);
	});

	test("renders a single record persisted before grouping", () => {
		const rendered = lines([record()]);
		expect(rendered).toHaveLength(1);
		expect(rendered[0]).toContain("approved");
		expect(rendered[0]).toContain("git status");
	});

	test("hides entries with no usable record", () => {
		expect(renderer()(undefined)).toBeUndefined();
		expect(renderer()([])).toBeUndefined();
		expect(renderer()(["junk", 42, null])).toBeUndefined();
	});

	test("keeps showing the rest when one record is malformed", () => {
		expect(toRecords([record(), { toolName: "bash" }])).toHaveLength(1);
	});

	test("degrades to a stub instead of throwing on drifted data", () => {
		const broken = { ...record(), answers: undefined } as unknown as JudgeRecord;
		expect(drawn([broken])).toEqual(["pi-ask-permission judge: unreadable entry"]);
	});

	test("shows the reason and signals only when expanded", () => {
		expect(lines([record()])[0]).not.toContain("read-only");
		expect(lines([record()], true)[1]).toContain("read-only");
		expect(lines([record()], true)[2]).toContain("reversibility");
	});

	test("keeps a space between the label, the tool, and the target", () => {
		expect(lines([record({ toolName: "webfetch" })])[0]).toContain("approved webfetch git status");
	});

	test("a lone `ask you` does not pay for another card's dry-run label", () => {
		expect(lines([record({ action: "ask" })])[0]).toStartWith("ask you bash git status");
	});

	test("aligns the target column on the widest label in the card", () => {
		const rendered = lines([record({ action: "ask", dryRun: true }), record({ toolName: "read" })]);
		expect(rendered[0]).toStartWith("would ask you bash git status");
		expect(targetColumn(rendered[0])).toBe(targetColumn(rendered[1]));
	});
});

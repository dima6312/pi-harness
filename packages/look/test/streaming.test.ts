import { afterAll, afterEach, beforeAll, describe, expect, setSystemTime, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { harness } from "./stream-harness.ts";

let cwd = "";
beforeAll(() => {
	cwd = mkdtempSync(join(tmpdir(), "look-stream-"));
	writeFileSync(join(cwd, "e.ts"), "one\ntwo\nthree\n");
	writeFileSync(join(cwd, "old.ts"), "a\nb\nc\n");
});
afterAll(() => rmSync(cwd, { recursive: true, force: true }));
afterEach(() => setSystemTime());

const CURSOR = "\u258d";
const code = (lines: number) =>
	Array.from({ length: lines }, (_, index) => `const v${index} = ${index};`).join("\n");
const bottom = (lines: readonly string[]) => lines.findLast((line) => line.startsWith("\u2570"));

describe("several calls in one message, as pi draws them", () => {
	test("a call the model finished stops writing while the next one streams", () => {
		const h = harness(cwd);
		h.stream({ id: "w1", name: "write", args: { path: "one.ts", content: code(12) } });
		h.streamTo({ id: "w2", name: "write", args: { path: "two.ts", content: code(30) } }, 200);

		const first = h.render("w1");
		expect(first.some((line) => line.includes(CURSOR))).toBe(false);
		expect(bottom(first)).toMatch(/ waiting {2}\d+\.\ds /);
		expect(bottom(first)).not.toContain("lines");

		const second = h.render("w2");
		expect(second.some((line) => line.includes(CURSOR))).toBe(true);
		expect(bottom(second)).toMatch(/ writing {2}\d+\.\ds {2}\d+ lines/);
	});

	test("the time a call took to write ends with the call, not with the message", () => {
		const h = harness(cwd);
		setSystemTime(new Date(10_000));
		h.stream({ id: "w1", name: "write", args: { path: "one.ts", content: code(3) } });
		setSystemTime(new Date(14_000));
		h.stream({ id: "w2", name: "write", args: { path: "two.ts", content: code(3) } });
		// The first call has waited since it was written, while the model wrote the second.
		expect(bottom(h.render("w1"))).toContain("waiting  4.0s");
	});

	test("a finished call is not drawn again by pi while the others stream", () => {
		const h = harness(cwd);
		h.stream({ id: "w1", name: "write", args: { path: "one.py", content: code(300) } });
		const before = h.asked("w1");
		h.stream({ id: "w2", name: "write", args: { path: "two.py", content: code(300) } }, 20);
		// The second call took hundreds of pieces, and every one of them handed the first its arguments.
		expect(h.renders("w1")).toBeGreaterThan(200);
		expect(h.asked("w1")).toBe(before);
		// It is not left writing to stay cheap: pi drew it once it was written, as it draws it now.
		expect(bottom(h.render("w1"))).toContain("waiting");
		expect(h.render("w1").some((line) => line.includes("more lines"))).toBe(true);
	});
});

describe("arguments as the model writes them", () => {
	test("a write streams its content before the model writes the path", () => {
		const h = harness(cwd);
		h.streamTo({ id: "w", name: "write", args: { content: code(20), path: "late.ts" } }, 300);
		const lines = h.render("w");
		expect(lines[2]).toMatch(/^\u2502 write \.\.\. +\u2502$/);
		expect(lines.some((line) => line.includes(`co${CURSOR}`))).toBe(true);
		expect(bottom(lines)).toMatch(/writing {2}\d+\.\ds {2}19 lines/);
	});

	test("an edit streams its edits before the model writes the path", () => {
		const h = harness(cwd);
		const args = { edits: [{ oldText: "two", newText: "TWO" }], path: "e.ts" };
		h.streamTo({ id: "e", name: "edit", args }, 40);
		const lines = h.render("e");
		expect(lines.slice(2, 5)).toEqual([
			expect.stringMatching(/^\u2502 edit \.\.\. +\u2502$/),
			expect.stringMatching(/^\u2502 -two +\u2502$/),
			expect.stringMatching(new RegExp(`^\\u2502 \\+TW${CURSOR} +\\u2502$`)),
		]);
	});

	test("a path still arriving is not read, since it may name another file on the way", () => {
		const h = harness(cwd);
		// "old.ts" exists, and "old.tsx" does not: only the path the model settled on counts.
		const args = { content: "x", path: "old.tsx" };
		h.streamTo({ id: "w", name: "write", args }, JSON.stringify(args).length - 3);
		expect(h.render("w")[2]).toMatch(/^\u2502 write old\.ts +\u2502$/);
		h.stream({ id: "w", name: "write", args });
		expect(h.render("w")[2]).toContain("write old.tsx");
	});

	test("carriage returns and colour codes in the file never reach the terminal", () => {
		const h = harness(cwd);
		const content = "a\r\nb\r\nc \u001b[31mred\u001b[0m\u0007\r\nd";
		h.streamTo({ id: "w", name: "write", args: { path: "crlf.txt", content } }, 200);
		const raw = h.raw("w");
		expect(raw.some((line) => line.includes("\r") || line.includes("\u0007"))).toBe(false);
		expect(raw.some((line) => line.includes("\u001b[31m"))).toBe(false);
		expect(h.render("w").some((line) => /^\u2502 3 {2}c red +\u2502$/u.test(line))).toBe(true);
	});
});

describe("once the model has written the call", () => {
	test("an edit waits for pi's diff without the cursor, and pi's diff lines up with it", async () => {
		const h = harness(cwd);
		const args = { path: "e.ts", edits: [{ oldText: "two", newText: "TWO" }] };
		h.stream({ id: "e", name: "edit", args });
		h.endMessage();
		expect(h.render("e").slice(2, 5)).toEqual([
			expect.stringMatching(/^\u2502 edit e\.ts +\u2502$/),
			expect.stringMatching(/^\u2502 -two +\u2502$/),
			expect.stringMatching(/^\u2502 \+TWO +\u2502$/),
		]);

		await Bun.sleep(50);
		const diffed = h.render("e");
		// The frame pads the inside, so pi's path stays where the stream had it.
		expect(diffed[2]).toMatch(/^\u2502 edit e\.ts +\u2502$/);
		expect(diffed.some((line) => line.includes("+2 TWO"))).toBe(true);
	});

	test("the time goes on between drawings, with nothing new from the model", () => {
		const h = harness(cwd);
		setSystemTime(new Date(10_000));
		h.stream({ id: "w", name: "write", args: { path: "one.ts", content: code(3) } });
		h.endMessage();
		setSystemTime(new Date(12_500));
		expect(bottom(h.render("w"))).toContain("waiting  2.5s");
	});

	test("a call replayed from the session shows pi's own renderer, not the stream", () => {
		const h = harness(cwd);
		h.replay({ id: "w", name: "write", args: { path: "one.ts", content: code(12) } });
		const lines = h.render("w");
		expect(lines.some((line) => line.includes(CURSOR))).toBe(false);
		expect(lines.some((line) => line.includes("more lines"))).toBe(true);
	});
});

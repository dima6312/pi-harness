import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { details, setOutputs } from "./github.ts";

describe("details", () => {
	test("a body becomes a collapsible block with its summary", () => {
		expect(details("What moved", "line one")).toEqual([
			"<details><summary>What moved</summary>",
			"",
			"line one",
			"",
			"</details>",
		]);
	});
});

describe("setOutputs", () => {
	const previous = process.env.GITHUB_OUTPUT;
	let dir = "";

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "github-output-"));
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
		if (previous === undefined) delete process.env.GITHUB_OUTPUT;
		else process.env.GITHUB_OUTPUT = previous;
	});

	test("appends what Actions reads back, one line per key", () => {
		const file = join(dir, "output");
		process.env.GITHUB_OUTPUT = file;

		setOutputs({ test: "true", pinned: "2.1.299" });
		setOutputs({ newest: "2.1.300" });

		expect(readFileSync(file, "utf-8")).toBe("test=true\npinned=2.1.299\nnewest=2.1.300\n");
	});

	test("logs them when there is no Actions file", () => {
		delete process.env.GITHUB_OUTPUT;
		const log = spyOn(console, "log").mockImplementation(() => {});

		setOutputs({ test: "false" });

		expect(log.mock.calls).toEqual([["test=false"]]);
		log.mockRestore();
	});
});

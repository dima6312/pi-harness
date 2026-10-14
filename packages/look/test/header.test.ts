import { describe, expect, test } from "bun:test";

import type { GithubState } from "../src/data/github.ts";
import { HeaderComponent, type HeaderSource } from "../src/ui/header.ts";
import { plain, screen } from "./helpers.ts";

function source(github: () => GithubState | undefined): HeaderSource {
	return {
		style: () => "card",
		counts: () => ({ tools: 14, skills: 9, prompts: 0, extensions: 7 }),
		lastVisit: () => undefined,
		github,
	};
}

const WAITING: GithubState = {
	ci: { branch: "main", sha: "b8e20ba", name: "Release" },
	pr: { number: 52, title: "Fix the frame", waits: "changes requested" },
};

describe("what the start card says about GitHub", () => {
	test("a failed CI run and a pull request waiting on you, each on its own line", () => {
		const lines = new HeaderComponent(
			screen(),
			source(() => WAITING),
		)
			.render(100)
			.map(plain);
		expect(lines.some((line) => line.includes("✗ CI failed on main  b8e20ba  Release"))).toBe(true);
		expect(lines.some((line) => line.includes("⚑ PR #52 Fix the frame  changes requested"))).toBe(
			true,
		);
		expect(lines.findLast(Boolean)).toMatch(/^╰─ 2 things +\/ commands/);
	});

	test("nothing while GitHub has not answered", () => {
		const lines = new HeaderComponent(
			screen(),
			source(() => undefined),
		)
			.render(100)
			.map(plain);
		expect(lines.some((line) => line.includes("CI failed"))).toBe(false);
		expect(lines.some((line) => line.includes("PR #"))).toBe(false);
	});

	test("an answer that arrives after the card is up redraws it, without waiting for a keystroke", () => {
		const later: { github?: GithubState } = {};
		const header = new HeaderComponent(
			screen(),
			source(() => later.github),
		);
		const first = header.render(100).map(plain);
		expect(first.some((line) => line.includes("CI failed"))).toBe(false);

		// The card keeps each drawing for a second; a late answer must not be held back by that.
		later.github = WAITING;
		const second = header.render(100).map(plain);
		expect(second.some((line) => line.includes("✗ CI failed on main"))).toBe(true);
	});

	test("the same answer does not redraw the card again", () => {
		const header = new HeaderComponent(
			screen(),
			source(() => WAITING),
		);
		const first = header.render(100);
		const second = header.render(100);
		expect(second).toBe(first);
	});
});

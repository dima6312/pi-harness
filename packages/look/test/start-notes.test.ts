import { describe, expect, test } from "bun:test";

import { since, startNotes } from "../src/data/start-notes.ts";

const quiet = { peers: [], account: undefined, git: undefined, branch: "main" };
const git = {
	ahead: 0,
	behind: 0,
	staged: 0,
	modified: 0,
	untracked: 0,
	conflicted: 0,
	stashed: 0,
};

describe("what the start screen says", () => {
	test("nothing on a quiet day", () => {
		expect(startNotes(quiet, "5.9.2", { at: 0, version: "5.9.2" })).toEqual([]);
	});

	test("what GitHub waited with: a failed CI run and a pull request, after the branch it sits on", () => {
		const notes = startNotes({ ...quiet, git: { ...git, behind: 1 } }, "5.9.2", undefined, {
			ci: { branch: "main", sha: "b8e20ba", name: "Release" },
			pr: { number: 52, title: "Fix the frame", waits: "changes requested" },
		});
		expect(notes.map((note) => [note.mark, note.text, note.detail])).toEqual([
			["↓", "main is 1 behind", "pull before you start"],
			["✗", "CI failed on main", "b8e20ba  Release"],
			["⚑", "PR #52 Fix the frame", "changes requested"],
		]);
	});

	test("what waits on you: a sign-in, conflicts, a branch behind, other agents, a plan near its limit, a new version", () => {
		const notes = startNotes(
			{
				branch: "main",
				git: { ...git, behind: 3, conflicted: 2 },
				peers: [{ handle: "claude-probe", color: "syntaxString", state: "running" }],
				account: {
					provider: "anthropic",
					label: "work",
					needsLogin: true,
					windows: [
						{ name: "5h", used: 40 },
						{ name: "week", used: 82, resetsIn: "5d" },
					],
				},
			},
			"5.9.2",
			{ at: 0, version: "5.9.1" },
		);
		expect(notes.map((note) => [note.text, note.detail])).toEqual([
			["work needs a sign-in", "/accounts"],
			["2 files in conflict", undefined],
			["main is 3 behind", "pull before you start"],
			["@claude-probe", "works here"],
			["week at 82%", "resets in 5d"],
			["\u03c0-harness 5.9.2 is new", "was 5.9.1"],
		]);
	});

	test("no new version on the first session in a folder", () => {
		expect(startNotes(quiet, "5.9.2", undefined)).toEqual([]);
	});

	test("since when, as a time today, yesterday or days ago", () => {
		const now = new Date(2026, 9, 14, 18, 0).getTime();
		expect(since(new Date(2026, 9, 14, 9, 5).getTime(), now)).toBe("09:05");
		expect(since(new Date(2026, 9, 13, 22, 0).getTime(), now)).toBe("yesterday 22:00");
		expect(since(new Date(2026, 9, 10, 9, 0).getTime(), now)).toBe("4 days ago");
	});
});

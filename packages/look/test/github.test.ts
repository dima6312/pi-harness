import { describe, expect, test } from "bun:test";

import { type Runner, readGithub } from "../src/data/github.ts";

/** A command line that answers only what the test set up, and fails for anything else. */
function runner(answers: { branch?: string; runs?: string; pulls?: string }): Runner {
	return async (file, args) => {
		if (file === "git") {
			if (answers.branch === undefined) throw new Error("no git here");
			return answers.branch;
		}
		const line = args.join(" ");
		if (line.startsWith("run list")) {
			if (answers.runs === undefined) throw new Error("no gh run");
			return answers.runs;
		}
		if (line.startsWith("pr list")) {
			if (answers.pulls === undefined) throw new Error("no gh pr");
			return answers.pulls;
		}
		throw new Error(`unexpected ${file} ${line}`);
	};
}

const FAILED_RUN = JSON.stringify([
	{
		conclusion: "failure",
		headSha: "b8e20baa8078f142fcadcd2246c7d3d3600d873a",
		name: "Release",
		displayTitle: "perf: the start card",
	},
]);

const MISSING: Runner = async () => {
	throw new Error("command not found");
};

const BROKEN: Runner = async (file, args) =>
	file === "git" ? "main\n" : args.join(" ").startsWith("run list") ? "not json" : "{}";

function pull(pr: Record<string, unknown>): string {
	return JSON.stringify([{ number: 52, title: "Fix the frame", author: { login: "me" }, ...pr }]);
}

describe("what GitHub answers for the folder", () => {
	test("the last run of the branch failing: its short sha and its workflow", async () => {
		const state = await readGithub(
			"/repo",
			undefined,
			runner({ branch: "main\n", runs: FAILED_RUN }),
		);
		expect(state.ci).toEqual({ branch: "main", sha: "b8e20ba", name: "Release" });
	});

	test("the branch is what the run is asked about, and a branch with no name has no run to ask", async () => {
		const asked: string[] = [];
		const watch =
			(branch: string): Runner =>
			async (file, args) => {
				asked.push(args.join(" "));
				return runner({ branch, runs: FAILED_RUN, pulls: "[]" })(file, args);
			};
		await readGithub("/repo", undefined, watch("feature/start-card\n"));
		expect(asked.some((line) => line.includes("--branch feature/start-card"))).toBe(true);

		asked.length = 0;
		const state = await readGithub("/repo", undefined, watch(""));
		expect(state.ci).toBeUndefined();
		expect(asked.some((line) => line.startsWith("run list"))).toBe(false);
	});

	test("a run that passed, one still going, or one given up on shows nothing", async () => {
		const states = await Promise.all(
			["success", "cancelled", "in_progress", ""].map((conclusion) =>
				readGithub(
					"/repo",
					undefined,
					runner({
						branch: "main",
						runs: JSON.stringify([{ conclusion, headSha: "b8e20ba", name: "CI" }]),
					}),
				),
			),
		);
		expect(states.map((state) => state.ci)).toEqual([undefined, undefined, undefined, undefined]);
	});

	test("a review asking for changes: the number and the title", async () => {
		const state = await readGithub(
			"/repo",
			undefined,
			runner({ branch: "main", pulls: pull({ reviewDecision: "CHANGES_REQUESTED" }) }),
		);
		expect(state.pr).toEqual({ number: 52, title: "Fix the frame", waits: "changes requested" });
	});

	test("a comment newer than the last session, from somebody else, is news", async () => {
		const since = Date.parse("2026-10-14T09:00:00Z");
		const pulls = pull({
			reviewDecision: "",
			comments: [{ author: { login: "reviewer" }, createdAt: "2026-10-14T10:00:00Z" }],
		});
		const state = await readGithub("/repo", since, runner({ branch: "main", pulls }));
		expect(state.pr).toEqual({ number: 52, title: "Fix the frame", waits: "new comment" });
	});

	test("an old comment, your own comment, or a first session is not news", async () => {
		const since = Date.parse("2026-10-14T09:00:00Z");
		const old = pull({
			comments: [{ author: { login: "reviewer" }, createdAt: "2026-10-14T08:00:00Z" }],
		});
		const mine = pull({
			comments: [{ author: { login: "me" }, createdAt: "2026-10-14T10:00:00Z" }],
		});
		const fresh = pull({
			comments: [{ author: { login: "reviewer" }, createdAt: "2026-10-14T10:00:00Z" }],
		});
		const states = await Promise.all([
			readGithub("/repo", since, runner({ branch: "main", pulls: old })),
			readGithub("/repo", since, runner({ branch: "main", pulls: mine })),
			readGithub("/repo", undefined, runner({ branch: "main", pulls: fresh })),
		]);
		expect(states.map((state) => state.pr)).toEqual([undefined, undefined, undefined]);
	});

	test("an approved pull request, or one waiting on a reviewer, waits on nobody", async () => {
		const states = await Promise.all(
			["APPROVED", "REVIEW_REQUIRED", ""].map((reviewDecision) =>
				readGithub("/repo", undefined, runner({ branch: "main", pulls: pull({ reviewDecision }) })),
			),
		);
		expect(states.map((state) => state.pr)).toEqual([undefined, undefined, undefined]);
	});

	test("of several pull requests, the first with something waiting on you", async () => {
		const pulls = JSON.stringify([
			{ number: 51, title: "Quiet one", reviewDecision: "APPROVED", author: { login: "me" } },
			{
				number: 52,
				title: "Fix the frame",
				reviewDecision: "CHANGES_REQUESTED",
				author: { login: "me" },
			},
		]);
		const state = await readGithub("/repo", undefined, runner({ branch: "main", pulls }));
		expect(state.pr?.number).toBe(52);
	});

	test("without gh, without a repository or without an answer, nothing at all", async () => {
		expect(await readGithub("/tmp", undefined, MISSING)).toEqual({ ci: undefined, pr: undefined });
		expect(await readGithub("/repo", undefined, BROKEN)).toEqual({ ci: undefined, pr: undefined });
	});
});

// What the two release checks share when they talk to GitHub: the step outputs a workflow reads back,
// the issue a red run files, and the pull request that bumps a pin. `trailingNewline` is per
// workflow, since `claude-code` and `newest-pi` differ there on purpose.
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";

import { $ } from "bun";

const BOT_NAME = "github-actions[bot]";
const BOT_EMAIL = "41898282+github-actions[bot]@users.noreply.github.com";

/** The step outputs the workflow reads back, into `$GITHUB_OUTPUT` or the log outside Actions. */
export function setOutputs(values: Record<string, string>): void {
	const file = process.env.GITHUB_OUTPUT;
	const lines = Object.entries(values).map(([key, value]) => `${key}=${value}`);
	if (file) appendFileSync(file, `${lines.join("\n")}\n`);
	else console.log(lines.join("\n"));
}

/** A collapsible block for an issue or pull request body. */
export function details(summary: string, body: string): string[] {
	return [`<details><summary>${summary}</summary>`, "", body, "", "</details>"];
}

/** The last lines of `verify.log`, as the collapsible block both reports paste. */
export function logTail(): string[] {
	const tail = readFileSync("verify.log", "utf-8").split("\n").slice(-120).join("\n");
	return details("Tail of the log", `\`\`\`text\n${tail}\n\`\`\``);
}

/** Whether the working tree changed any of `files`, the check before opening a pull request. */
export async function filesChanged(files: string[]): Promise<boolean> {
	return (await $`git diff --quiet -- ${files}`.nothrow()).exitCode !== 0;
}

/** The open issues under a label: both workflows keep at most one at a time. */
export async function openIssues(label: string): Promise<number[]> {
	const json = await $`gh issue list --label ${label} --state open --json number`.text();
	return (JSON.parse(json) as { number: number }[]).map((issue) => issue.number);
}

/** The label an issue lives under, the title it carries, and how its body file is written. */
interface IssueRequest {
	label: string;
	description: string;
	color: string;
	title: string;
	/** Whether `body.md` ends with a newline. `claude-code` does, `newest-pi` does not. */
	trailingNewline: boolean;
	/** Leaves the open issue alone when its text already mentions this, as `newest-pi` does. */
	skipWhenMentions?: string;
}

/** Files the issue, or comments on the open one. The label is created on the way. */
export async function fileIssue(request: IssueRequest, body: string[]): Promise<void> {
	writeFileSync("body.md", request.trailingNewline ? `${body.join("\n")}\n` : body.join("\n"));
	await $`gh label create ${request.label} --description ${request.description} --color ${request.color} --force`;

	const [open] = await openIssues(request.label);
	if (open === undefined) {
		await $`gh issue create --title ${request.title} --label ${request.label} --body-file body.md`;
		return;
	}
	if (request.skipWhenMentions !== undefined) {
		const thread =
			await $`gh issue view ${open} --json body,comments --jq ${'.body + ([.comments[].body] | join("\n"))'}`.text();
		if (thread.includes(request.skipWhenMentions)) return;
	}
	await $`gh issue edit ${open} --title ${request.title}`;
	await $`gh issue comment ${open} --body-file body.md`;
}

/** Comments the green run on every open issue under a label. */
export async function closeIssues(label: string, comment: string): Promise<void> {
	await Promise.all(
		(await openIssues(label)).map((number) => $`gh issue close ${number} --comment ${comment}`),
	);
}

/** The branch a bump goes up on and the files it commits. */
interface PullRequest {
	branch: string;
	title: string;
	files: string[];
	/** Whether `body.md` ends with a newline. `claude-code` does, `newest-pi` does not. */
	trailingNewline: boolean;
}

/**
 * Commits the bump on its own branch, pushes it, and opens the pull request or edits the open one.
 *
 * The push is a plain `--force`: the branch belongs to the bot and is rebuilt from `main` every run.
 * A bare `--force-with-lease` compares against `origin/<branch>`, which the shallow checkout never
 * fetches, so it rejected every push while a bump pull request was still open ("stale info").
 */
export async function openPullRequest(request: PullRequest, body: string[]): Promise<void> {
	writeFileSync("body.md", request.trailingNewline ? `${body.join("\n")}\n` : body.join("\n"));
	await $`git checkout -B ${request.branch}`;
	await $`git add ${request.files}`;
	await $`git -c user.name=${BOT_NAME} -c user.email=${BOT_EMAIL} commit -m ${request.title}`;
	await $`git push --force origin ${request.branch}`;

	const open =
		await $`gh pr list --head ${request.branch} --state open --json number --jq ${".[0].number // empty"}`.text();
	if (open.trim()) await $`gh pr edit ${open.trim()} --title ${request.title} --body-file body.md`;
	else
		await $`gh pr create --title ${request.title} --body-file body.md --head ${request.branch} --base main`;
}

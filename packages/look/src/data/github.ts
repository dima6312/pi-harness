// The answers GitHub gives the start card: the last run of CI on this branch, and your own open pull
// requests with something waiting on you. The card asks once per launch, in the background, and shows
// nothing when gh is missing, the network is down, or the folder is not on GitHub.
import { execFile } from "node:child_process";

/** How long one command may take before it is given up on. The card is never worth a longer wait. */
const TIMEOUT_MS = 3000;
/** Room for a page of pull requests with their comments. */
const MAX_OUTPUT = 1_000_000;
/** The conclusions that mean a run did not pass. */
const FAILED = new Set(["failure", "startup_failure", "timed_out"]);
/** What gh is asked about a pull request: enough to tell a new comment from an old one. */
const PR_FIELDS = "number,title,author,reviewDecision,comments";

export interface CiFailure {
	branch: string;
	/** The failing commit, short enough to read. */
	sha: string;
	/** The workflow that failed. */
	name: string;
}

export interface OpenPullRequest {
	number: number;
	title: string;
	/** What waits on you there. */
	waits: "changes requested" | "new comment";
}

export interface GithubState {
	ci: CiFailure | undefined;
	pr: OpenPullRequest | undefined;
}

/** Runs one command in the folder and returns its stdout. Rejects when it fails or takes too long. */
export type Runner = (file: string, args: readonly string[]) => Promise<string>;

export function processRunner(cwd: string, timeoutMs: number = TIMEOUT_MS): Runner {
	return (file, args) =>
		new Promise((resolve, reject) => {
			execFile(
				file,
				[...args],
				{ cwd, timeout: timeoutMs, maxBuffer: MAX_OUTPUT },
				(error, stdout) => {
					if (error === null) resolve(stdout);
					else reject(error instanceof Error ? error : new Error(String(error)));
				},
			);
		});
}

/**
 * What GitHub knows about this folder. It never rejects: every question that cannot be answered
 * leaves its note out. `since` is the last session in the folder, the bar for a comment to be news.
 */
export async function readGithub(
	cwd: string,
	since: number | undefined,
	run: Runner = processRunner(cwd),
): Promise<GithubState> {
	const [branch, pr] = await Promise.all([branchOf(run), pullRequest(run, since)]);
	const ci = branch === undefined ? undefined : await failedRun(run, branch);
	return { ci, pr };
}

async function branchOf(run: Runner): Promise<string | undefined> {
	const branch = (await ask(() => run("git", ["branch", "--show-current"])))?.trim();
	return branch === undefined || branch === "" ? undefined : branch;
}

/** The last run of CI on the branch, when it failed. */
async function failedRun(run: Runner, branch: string): Promise<CiFailure | undefined> {
	const out = await ask(() =>
		run("gh", [
			"run",
			"list",
			"--branch",
			branch,
			"--limit",
			"1",
			"--json",
			"conclusion,headSha,name,displayTitle",
		]),
	);
	const [last] = rows(out);
	if (last === undefined) return undefined;
	const conclusion = field(last, "conclusion");
	if (conclusion === undefined || !FAILED.has(conclusion)) return undefined;
	return {
		branch,
		sha: (field(last, "headSha") ?? "").slice(0, 7),
		name: field(last, "name") ?? field(last, "displayTitle") ?? "CI",
	};
}

/** The first of your open pull requests, newest first, with a review or a comment waiting on you. */
async function pullRequest(
	run: Runner,
	since: number | undefined,
): Promise<OpenPullRequest | undefined> {
	const out = await ask(() =>
		run("gh", ["pr", "list", "--author", "@me", "--limit", "10", "--json", PR_FIELDS]),
	);
	for (const pr of rows(out)) {
		const number = numberOf(pr);
		const title = field(pr, "title");
		if (number === undefined || title === undefined) continue;
		if (field(pr, "reviewDecision") === "CHANGES_REQUESTED")
			return { number, title, waits: "changes requested" };
		if (hasNewComment(pr, since)) return { number, title, waits: "new comment" };
	}
	return undefined;
}

function hasNewComment(pr: Record<string, unknown>, since: number | undefined): boolean {
	if (since === undefined) return false;
	const me = loginOf(pr["author"]);
	const comments = pr["comments"];
	if (!Array.isArray(comments)) return false;
	return comments.some((comment) => {
		const entry = record(comment);
		if (entry === undefined) return false;
		const at = Date.parse(field(entry, "createdAt") ?? "");
		const login = loginOf(entry["author"]);
		return Number.isFinite(at) && at > since && login !== undefined && login !== me;
	});
}

function loginOf(value: unknown): string | undefined {
	const author = record(value);
	return author === undefined ? undefined : field(author, "login");
}

/** The stdout of a question that could not be asked is no answer at all. */
async function ask(question: () => Promise<string>): Promise<string | undefined> {
	try {
		return await question();
	} catch {
		return undefined;
	}
}

function rows(out: string | undefined): Record<string, unknown>[] {
	if (out === undefined) return [];
	let value: unknown;
	try {
		value = JSON.parse(out);
	} catch {
		return [];
	}
	return Array.isArray(value) ? value.filter(isRecord) : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function record(value: unknown): Record<string, unknown> | undefined {
	return isRecord(value) ? value : undefined;
}

function field(row: Record<string, unknown>, key: string): string | undefined {
	const value = row[key];
	return typeof value === "string" && value !== "" ? value : undefined;
}

function numberOf(pr: Record<string, unknown>): number | undefined {
	const value = pr["number"];
	return typeof value === "number" && Number.isInteger(value) ? value : undefined;
}

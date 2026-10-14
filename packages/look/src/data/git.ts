import { processRunner, type Runner } from "./runner.ts";

export interface GitState {
	ahead: number;
	behind: number;
	staged: number;
	modified: number;
	untracked: number;
	conflicted: number;
	stashed: number;
}

export function emptyGit(): GitState {
	return { ahead: 0, behind: 0, staged: 0, modified: 0, untracked: 0, conflicted: 0, stashed: 0 };
}

export function parseStatus(output: string): GitState {
	const state = emptyGit();

	for (const line of output.split("\n")) {
		if (line.startsWith("# branch.ab ")) {
			const [, , ahead, behind] = line.split(" ");
			state.ahead = Math.abs(Number(ahead ?? "0")) || 0;
			state.behind = Math.abs(Number(behind ?? "0")) || 0;
		} else if (line.startsWith("# stash ")) {
			state.stashed = Number(line.slice("# stash ".length)) || 0;
		} else if (line.startsWith("1 ") || line.startsWith("2 ")) {
			// `XY` is the index column, then the tree column, with `.` for unchanged.
			const index = line[2];
			const tree = line[3];
			if (index !== undefined && index !== ".") state.staged++;
			if (tree !== undefined && tree !== ".") state.modified++;
		} else if (line.startsWith("u ")) {
			state.conflicted++;
		} else if (line.startsWith("? ")) {
			state.untracked++;
		}
	}

	return state;
}

export async function readGit(
	cwd: string,
	run: Runner = processRunner(cwd, 2000),
): Promise<GitState | undefined> {
	try {
		return parseStatus(
			await run("git", ["-C", cwd, "status", "--porcelain=v2", "--branch", "--show-stash"]),
		);
	} catch {
		// A folder that is not a repository, or a git that did not answer: the card says nothing.
		return undefined;
	}
}

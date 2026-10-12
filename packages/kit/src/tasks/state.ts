// What a session is doing, what it did and with what result, what waits and on whom, and what
// was decided. You read it live; the judge, other agents and compaction read it instead of the chat.

export const TASKS_VERSION = 1;

/**
 * - `doing`: the agent is on it, or was in its last run and did not finish. Several at once.
 * - `queued`: asked, not started yet.
 * - `waiting`: stopped on you or on something outside the session, with why.
 * - `deferred`: you put it off.
 */
export type TaskStatus = "doing" | "queued" | "waiting" | "deferred" | "done" | "dropped";

/** Only `you` reaches the judge, so nothing a tool returned can become your intent. */
export type Origin = "you" | "agent";

export type WaitingOn = "you" | "outside";

export interface Mark {
	at: number;
	/** The session entry it happened at, so a reader can open that part of the conversation. */
	entry?: string;
}

export interface Task {
	/** Like `t7`, kept through every status. */
	id: string;
	/** Imperative and short, like a changelog line: `Show the tasks on the top strip`. */
	text: string;
	status: TaskStatus;
	origin: Origin;
	created: Mark;
	/** Your messages about it: the ask, then every correction or approval. */
	asks: string[];
	started?: Mark;
	finished?: Mark;
	updatedAt: number;
	/** Done: what came out of it, like a commit, a URL or a number. */
	result?: string;
	/** Done: what it left out, for a later task to close. */
	left?: string;
	/** Waiting, deferred or dropped: why. */
	why?: string;
	waitingOn?: WaitingOn;
	/** Runs that ended without touching it while it was queued. */
	idleRuns?: number;
}

export interface Decision {
	/** Like `d2`. */
	id: string;
	/** What was chosen, with the alternative when it matters: `One SECRET with a mode, not two keys`. */
	text: string;
	origin: Origin;
	made: Mark;
	tasks?: string[];
}

export interface SessionTasks {
	version: typeof TASKS_VERSION;
	/** What the whole session is about, above any one task. */
	title?: string;
	titleOrigin?: Origin;
	/** The language of your messages, like `Portuguese`. Every task is written in it. */
	language?: string;
	/** In the order they were added. */
	tasks: Task[];
	decisions: Decision[];
	nextTask: number;
	nextDecision: number;
	updatedAt: number;
}

export type TaskOp =
	| { op: "title"; text: string }
	| { op: "language"; text: string }
	/** Starts doing it, or queues it when the agent is already on something you asked. */
	| { op: "ask"; text: string; queue?: boolean }
	/** Your message is about this task: a correction, an approval, or asking it again. */
	| { op: "continue"; id: string; text?: string }
	| { op: "defer"; id: string; why?: string }
	| { op: "done"; id: string; result?: string; left?: string }
	/** The run worked on it and did not finish. */
	| { op: "progress"; id: string; left?: string }
	| { op: "wait"; id: string; on: WaitingOn; why: string }
	| { op: "drop"; id: string; why?: string }
	/** Something the agent left for after, which only you can turn into an ask. */
	| { op: "follow_up"; text: string; why?: string }
	| { op: "decide"; text: string; tasks?: string[] }
	| { op: "rename"; id: string; text: string }
	| { op: "merge"; id: string; into: string }
	/** A run ended without touching this queued task. */
	| { op: "idle"; id: string };

/** `run`: the pass at the end of each run. `tidy`: the pass after it that merges repeats. */
export type TasksTrigger = "message" | "run" | "tidy" | "you";

export const OPEN: readonly TaskStatus[] = ["doing", "waiting", "queued", "deferred"];

export function emptyTasks(): SessionTasks {
	return {
		version: TASKS_VERSION,
		tasks: [],
		decisions: [],
		nextTask: 1,
		nextDecision: 1,
		updatedAt: 0,
	};
}

export function tasksWith(state: SessionTasks, ...statuses: TaskStatus[]): Task[] {
	return state.tasks.filter((task) => statuses.includes(task.status));
}

export function isOpen(task: Task): boolean {
	return OPEN.includes(task.status);
}

/** A queued task the agent passed over this many runs is one you may have left behind. */
export const STALE_RUNS = 3;

export function isStale(task: Task): boolean {
	return task.status === "queued" && (task.idleRuns ?? 0) >= STALE_RUNS;
}

export const TASKS_VERSION = 1;

export type TaskStatus = "doing" | "queued" | "waiting" | "deferred" | "done" | "dropped";

/** Only `you` reaches the judge, so nothing a tool returned can become your intent. */
export type Origin = "you" | "agent";

export type WaitingOn = "you" | "outside";

export interface Mark {
	at: number;
	entry?: string;
}

export interface Task {
	id: string;
	text: string;
	status: TaskStatus;
	origin: Origin;
	created: Mark;
	/** Entry ids of your messages about it: the ask, then each correction or approval. */
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
	idleRuns?: number;
}

export interface Decision {
	id: string;
	text: string;
	origin: Origin;
	made: Mark;
	tasks?: string[];
}

export interface SessionTasks {
	version: typeof TASKS_VERSION;
	title?: string;
	titleOrigin?: Origin;
	/** One or two words other sessions mention it by. Set once, so a mention keeps working. */
	handle?: string;
	language?: string;
	tasks: Task[];
	decisions: Decision[];
	nextTask: number;
	nextDecision: number;
	updatedAt: number;
}

export type TaskOp =
	| { op: "title"; text: string; handle?: string }
	| { op: "language"; text: string }
	/**
	 * Starts doing it, or queues it when the agent is already on something you asked. `beside`
	 * starts it next to what is under way, like a line you add to Doing on Alt+S.
	 */
	| { op: "ask"; text: string; beside?: boolean }
	/** Your message is about this task: a correction, an approval, or asking it again. */
	| { op: "continue"; id: string; text?: string }
	| { op: "defer"; id: string; why?: string }
	| { op: "done"; id: string; result?: string; left?: string }
	| { op: "progress"; id: string; left?: string }
	| { op: "wait"; id: string; on: WaitingOn; why: string }
	| { op: "drop"; id: string; why?: string }
	| { op: "decide"; text: string; tasks?: string[] }
	| { op: "rename"; id: string; text: string }
	| { op: "merge"; id: string; into: string }
	| { op: "idle"; id: string };

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

export const STALE_RUNS = 3;

export function isStale(task: Task): boolean {
	return task.status === "queued" && (task.idleRuns ?? 0) >= STALE_RUNS;
}

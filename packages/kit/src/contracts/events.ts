// The events the harness writes, one shape per type. A viewer reads these and nothing else, so a
// shape only grows: a field that changes meaning gets a new name, and a new version of the log
// would get a new `v`.
import type { SessionTasks } from "../tasks/state.ts";

export type SessionState = "running" | "idle";

/** How a message reached the agent it was for. */
export type Delivery = "woke" | "after-run" | "steered" | "next-turn";

export type Activity =
	| { kind: "edited"; path: string }
	| { kind: "ran"; command: string; ok: boolean }
	| { kind: "committed"; sha: string; subject: string };

export interface LogEventMap {
	/** A session opened in the folder. It is live while its process is. */
	"session.started": { pid: number; host: string; model?: string };
	"session.ended": Record<string, never>;
	/** The short name others mention it by, and the title it took it from. */
	"session.named": { handle: string; title: string };
	"session.state": { state: SessionState };
	/** You sent a prompt in this session. What you said stays in pi's own session file. */
	"session.prompted": Record<string, never>;
	"tasks.changed": { state: SessionTasks };
	activity: Activity;
	/**
	 * A message in the folder's room. `to` lists session ids, or "all" for a request to whoever
	 * fits it best. `from: "you"` only comes from what you typed in that session.
	 */
	"message.posted": {
		id: string;
		from: "you" | "agent";
		to: string[] | "all";
		text: string;
		urgent?: boolean;
		/**
		 * The depth of the run that wrote it: 0 when someone at a keyboard started that run, and d + 1
		 * when an agent message of depth d woke it. A message from you is always 0. A message of depth 4
		 * or more no longer wakes anyone.
		 */
		depth?: number;
	};
	/** Written by the session the message was for, when it handed it to its agent. */
	"message.received": { id: string; mode: Delivery };
	/** The agent's model read it. */
	"message.read": { id: string };
	"message.unsent": { id: string };
	/** A session's offer to take a request to everyone. */
	"request.bid": { request: string; fit: number; reason: string; idle: boolean };
	/** Written only by the session every other one agrees won the request. */
	"request.taken": { request: string };
}

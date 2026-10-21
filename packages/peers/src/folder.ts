// The folder as every session sees it, rebuilt from the logs. Every session reads the same events,
// so each one reaches the same board, the same room and the same winner of a request.
import {
	type Activity,
	type Delivery,
	type LoggedEvent,
	type SessionState,
	type SessionTasks,
	tasksWith,
} from "@adeildo/pi-kit";

import { Membership } from "./membership.ts";

const KEEP_RUNS = 5;

export interface Peer {
	session: string;
	pid?: number;
	host?: string;
	model?: string;
	/** Where it works. Its edited paths are relative to this. Absent in logs older than rooms. */
	cwd?: string;
	startedAt: number;
	endedAt?: number;
	handle?: string;
	title?: string;
	state: SessionState;
	stateAt: number;
	tasks?: SessionTasks;
	edited: Map<string, number>;
	ran: { command: string; ok: boolean; at: number }[];
	commits: { sha: string; subject: string; at: number }[];
}

export interface Bid {
	fit: number;
	reason: string;
	idle: boolean;
	at: number;
}

export interface Posted {
	id: string;
	session: string;
	from: "you" | "agent";
	/** Session ids, "all" for every session, or "any" for a request one of them takes. */
	to: string[] | "all" | "any";
	text: string;
	urgent: boolean;
	/** How many agent replies, each waking the next writer, led to it. */
	depth: number;
	at: number;
	received: Map<string, { mode: Delivery; at: number }>;
	read: Set<string>;
	bids: Map<string, Bid>;
	takenBy?: string;
}

/**
 * Whether a message reaches the session: one sent to it, or one sent to everyone. An agent's message
 * to everyone does not come back to its own session; yours does, so the agent there knows it too.
 */
export function reaches(message: Posted, session: string): boolean {
	if (message.to === "any") return false;
	if (message.to === "all") return !(message.from === "agent" && message.session === session);
	return message.to.includes(session);
}

/**
 * The sessions a message went to. One to everyone went to every session it reaches: those that got
 * it, and those open now.
 */
export function addressees(message: Posted, live: readonly Peer[]): string[] {
	if (message.to === "any") return [];
	if (message.to !== "all") return message.to;
	const sessions = new Set([...message.received.keys(), ...live.map((peer) => peer.session)]);
	return [...sessions].filter((session) => reaches(message, session));
}

/** A line of the room that is not a message: someone came, left, committed or finished a task. */
export type Happening =
	| { kind: "joined" | "left"; session: string; at: number }
	| { kind: "committed"; session: string; at: number; sha: string; subject: string }
	| { kind: "finished"; session: string; at: number; task: string }
	| { kind: "took"; session: string; at: number; request: string };

export type RoomItem =
	| { kind: "message"; message: Posted }
	| { kind: "happening"; happening: Happening };

export class Folder {
	readonly peers = new Map<string, Peer>();
	readonly messages = new Map<string, Posted>();
	readonly room: RoomItem[] = [];
	/** Who a shared room counts. The folder's own room has no `room.*` events and leaves it empty. */
	readonly membership = new Membership();

	apply(events: readonly LoggedEvent[]): void {
		for (const event of events) this.#apply(event);
	}

	#apply(event: LoggedEvent): void {
		// Who changed the room need not be in it, so a `room.*` line makes nobody a peer.
		if (event.type.startsWith("room.")) return this.membership.apply(event);
		const peer = this.#peer(event.session, event.at);
		switch (event.type) {
			case "session.started": {
				const data = event.data as LoggedEvent<"session.started">["data"];
				Object.assign(peer, { pid: data.pid, host: data.host, model: data.model, cwd: data.cwd });
				peer.endedAt = undefined;
				this.#happen({ kind: "joined", session: peer.session, at: event.at });
				return;
			}
			case "session.ended":
				peer.endedAt = event.at;
				peer.state = "idle";
				this.#happen({ kind: "left", session: peer.session, at: event.at });
				return;
			case "session.named": {
				const data = event.data as LoggedEvent<"session.named">["data"];
				peer.handle = data.handle;
				peer.title = data.title;
				return;
			}
			case "session.state": {
				const state = (event.data as LoggedEvent<"session.state">["data"]).state;
				if (state !== peer.state) peer.stateAt = event.at;
				peer.state = state;
				return;
			}
			case "session.prompted":
				return;
			case "tasks.changed":
			case "tasks.board":
				return this.#tasks(
					peer,
					(event.data as LoggedEvent<"tasks.changed">["data"]).state,
					event.at,
				);
			case "activity":
				return this.#activity(peer, event.data as Activity, event.at);
			case "message.posted":
				return this.#posted(event as LoggedEvent<"message.posted">);
			default:
				return this.#about(event);
		}
	}

	/** Receipts, bids and takes, which all point at a message. */
	#about(event: LoggedEvent): void {
		const data = event.data as { id?: string; request?: string };
		const message = this.messages.get(data.id ?? data.request ?? "");
		if (message === undefined) return;
		switch (event.type) {
			case "message.received":
				message.received.set(event.session, {
					mode: (event.data as LoggedEvent<"message.received">["data"]).mode,
					at: event.at,
				});
				return;
			case "message.read":
				message.read.add(event.session);
				return;
			case "request.bid": {
				const { fit, reason, idle } = event.data as LoggedEvent<"request.bid">["data"];
				message.bids.set(event.session, { fit, reason, idle, at: event.at });
				return;
			}
			case "request.taken":
				if (message.takenBy !== undefined) return;
				message.takenBy = event.session;
				this.#happen({ kind: "took", session: event.session, at: event.at, request: message.id });
				return;
			default:
				return;
		}
	}

	#posted(event: LoggedEvent<"message.posted">): void {
		const { id, from, to, text, urgent, depth } = event.data;
		if (this.messages.has(id)) return;
		const message: Posted = {
			id,
			session: event.session,
			from,
			to,
			text,
			urgent: urgent === true,
			depth: depth ?? 0,
			at: event.at,
			received: new Map(),
			read: new Set(),
			bids: new Map(),
		};
		this.messages.set(id, message);
		this.room.push({ kind: "message", message });
	}

	#tasks(peer: Peer, state: SessionTasks, at: number): void {
		const before = new Set(
			peer.tasks === undefined ? [] : tasksWith(peer.tasks, "done").map((task) => task.id),
		);
		// The first snapshot is where the session was, not something it just finished.
		if (peer.tasks !== undefined)
			for (const task of tasksWith(state, "done"))
				if (!before.has(task.id))
					this.#happen({ kind: "finished", session: peer.session, at, task: task.text });
		peer.tasks = state;
	}

	#activity(peer: Peer, activity: Activity, at: number): void {
		switch (activity.kind) {
			case "edited":
				peer.edited.set(activity.path, at);
				return;
			case "ran":
				peer.ran = [...peer.ran, { command: activity.command, ok: activity.ok, at }].slice(
					-KEEP_RUNS,
				);
				return;
			case "committed":
				peer.commits = [
					...peer.commits,
					{ sha: activity.sha, subject: activity.subject, at },
				].slice(-KEEP_RUNS);
				this.#happen({
					kind: "committed",
					session: peer.session,
					at,
					sha: activity.sha,
					subject: activity.subject,
				});
				return;
		}
	}

	#happen(happening: Happening): void {
		this.room.push({ kind: "happening", happening });
	}

	#peer(session: string, at: number): Peer {
		let peer = this.peers.get(session);
		if (peer === undefined) {
			peer = {
				session,
				startedAt: at,
				state: "idle",
				stateAt: at,
				edited: new Map(),
				ran: [],
				commits: [],
			};
			this.peers.set(session, peer);
		}
		return peer;
	}
}

/** Open sessions in the folder, oldest first. A session on this machine is open while its process runs. */
export function livePeers(folder: Folder, alive: (pid: number) => boolean, host: string): Peer[] {
	return [...folder.peers.values()]
		.filter((peer) => peer.endedAt === undefined && peer.pid !== undefined)
		.filter((peer) => peer.host !== host || alive(peer.pid ?? -1))
		.toSorted((a, b) => a.startedAt - b.startedAt || a.session.localeCompare(b.session));
}

export function isAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		// Another user's process is alive too, just not ours to signal.
		return (error as NodeJS.ErrnoException).code === "EPERM";
	}
}

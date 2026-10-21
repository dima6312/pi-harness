import { readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// This session in one room, its folder's or a shared one: what it logs there, what it reads, and
// what is due for its agent. Every decision goes through the rules over the room, so the others
// reach the same. What reaches the agent goes through the session's inbox, shared by its rooms.
import {
	type Delivery,
	FolderFeed,
	HOST,
	type LogEventMap,
	logEvent,
	type LogTarget,
	targetOf,
	tasksWith,
	tildify,
} from "@adeildo/pi-kit";
import type { PeerMark } from "@adeildo/pi-kit";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import type { Fit } from "./bid.ts";
import { Folder, isAlive, livePeers, type Peer, type Posted, reaches } from "./folder.ts";
import { Inbox, type InboxHooks, type PeerMessageDetails, type Sender } from "./inbox.ts";
import { type Named, namesOf } from "./names.ts";
import { award, turnToTake } from "./rules.ts";

export type BoardMark = PeerMark;
export {
	forModel,
	PEER_HELD,
	PEER_MESSAGE,
	type PeerDelivery,
	type PeerMessageDetails,
} from "./inbox.ts";

/** A quiet note for the agent: who else is in the room. It is not shown in the chat. */
export const PEER_NOTE = "pi-peers:note";
/** A request to everyone another session took, kept in this transcript only. */
export const PEER_BROADCAST = "pi-peers:broadcast";
/** Older messages and requests are history, never delivered or bid on, and so is what came before the session. */
const RECENT_MS = 10 * 60_000;
/** A session that has shown nothing yet waits this long before it is worth telling the agent about. */
const ANNOUNCE_MS = 4_000;
/** A message still being written, shown live and never logged. Stale ones are a crashed writer. */
const TYPING_STALE_MS = 15_000;
const TYPING_EVERY_MS = 100;

export interface Typing {
	session: string;
	to: string;
	text: string;
	at: number;
}

export interface Hooks extends InboxHooks {
	events: ExtensionAPI["events"];
	fit(request: string, me: Peer, signal: AbortSignal): Promise<Fit>;
	changed(): void;
	/** Puts a request to everyone that another session took in the transcript, outside the model's context. */
	show?(details: PeerMessageDetails): void;
	/** The session's inbox, when it reads several rooms. A room alone gets its own. */
	inbox?: Inbox;
	now?(): number;
	alive?(pid: number): boolean;
}

/** A shared room, as this session knows it. */
export interface RoomRef {
	id: string;
	name: string;
}

/** Where a session joins a room, and what it already read of it. */
export interface Place {
	target: LogTarget;
	cwd: string;
	model?: string;
	/** Absent for the folder's room. */
	room?: RoomRef;
	/** The room's logs, already read up to now. */
	feed?: FolderFeed;
	folder?: Folder;
	/** False when whoever holds the session's rooms watches the logs and syncs them together. */
	watch?: boolean;
}

interface SessionSource {
	getCwd(): string;
	getSessionId(): string;
}

export class Here implements Sender {
	readonly #hooks: Hooks;
	readonly #inbox: Inbox;
	#target: LogTarget | undefined;
	#cwd = "";
	#room: RoomRef | undefined;
	#feed: FolderFeed | undefined;
	#folder = new Folder();
	#stopWatching: (() => void) | undefined;
	#timer: ReturnType<typeof setTimeout> | undefined;
	#abort = new AbortController();
	#openedAt = 0;
	#busy = false;
	readonly #delivered = new Set<string>();
	readonly #shown = new Set<string>();
	readonly #bidding = new Set<string>();
	readonly #fits = new Map<string, Fit>();
	/** The peers this session has already been told about, and the name each had. */
	#known = new Map<string, string>();
	/** Peers with nothing to show yet, and when this session first saw them. */
	#seen = new Map<string, number>();
	/** Your words handed to the agent, waiting for its model to read them. */
	readonly #unread = new Map<string, string>();
	#typedAt = 0;

	constructor(hooks: Hooks) {
		this.#hooks = hooks;
		this.#inbox = hooks.inbox ?? new Inbox(hooks);
	}

	get session(): string | undefined {
		return this.#target?.session;
	}

	get folder(): Folder {
		return this.#folder;
	}

	/** The shared room this is, or undefined for the folder's room. */
	get room(): RoomRef | undefined {
		return this.#room;
	}

	/** Where this session works. */
	get cwd(): string {
		return this.#cwd;
	}

	get busy(): boolean {
		return this.#busy;
	}

	get openedAt(): number {
		return this.#openedAt;
	}

	live(): Peer[] {
		return livePeers(this.#folder, this.#hooks.alive ?? isAlive, HOST);
	}

	names(): Map<string, Named> {
		return namesOf(this.live());
	}

	/** One mark per other session, and how many asked this one something its agent has not read. */
	summary(): { others: BoardMark[]; unread: number } {
		const others = [...this.marks().values()];
		let unread = 0;
		for (const message of this.#folder.messages.values()) {
			if (message.from === "you" || !reaches(message, this.session ?? "")) continue;
			if (message.read.has(this.session ?? "")) continue;
			unread++;
		}
		return { others, unread };
	}

	/** One mark per other open session, by session, oldest first. */
	marks(): Map<string, BoardMark> {
		const live = this.live();
		const named = namesOf(live);
		const marks = new Map<string, BoardMark>();
		for (const peer of live) {
			if (peer.session === this.session) continue;
			const handle = named.get(peer.session);
			const waiting = peer.tasks !== undefined && tasksWith(peer.tasks, "waiting").length > 0;
			marks.set(peer.session, {
				handle: handle?.handle ?? "anon",
				color: handle?.color ?? "muted",
				state: waiting ? "waiting" : peer.state === "running" ? "running" : "idle",
				...(this.#room === undefined ? {} : { room: this.#room.name }),
			});
		}
		return marks;
	}

	/** Opens the session in its folder's room. */
	open(session: SessionSource, model: string | undefined): void {
		this.join({
			target: targetOf(session),
			cwd: session.getCwd(),
			...(model === undefined ? {} : { model }),
		});
	}

	/** Starts reading a room and says so in it. */
	join(place: Place): void {
		this.close();
		this.#abort = new AbortController();
		this.#target = place.target;
		this.#cwd = place.cwd;
		this.#room = place.room;
		this.#feed = place.feed ?? new FolderFeed(place.target.dir);
		this.#folder = place.folder ?? new Folder();
		if (place.folder === undefined) this.#folder.apply(this.#feed.read());
		// Set before logging: the log reads the room, and what it finds is judged against this.
		// A reload opens the session again, and what arrived while it reloaded is still for this run.
		const me = this.#folder.peers.get(this.session ?? "");
		this.#openedAt = me?.startedAt ?? this.#now();
		if (me?.prompted === true) this.#inbox.wake();
		this.log("session.started", {
			pid: process.pid,
			host: HOST,
			cwd: place.cwd,
			...(place.model === undefined ? {} : { model: place.model }),
		});
		// Joining a room after the operator wrote: the others there count it among those who bid.
		if (this.#inbox.awake && me?.prompted !== true) this.log("session.prompted", {});
		if (place.watch !== false) this.#stopWatching = this.#feed.watch(() => this.sync());
		for (const message of this.#folder.messages.values()) this.#consider(message);
		this.#evaluate();
	}

	close(): void {
		if (this.#target === undefined) return;
		this.doneTyping();
		this.log("session.ended", {});
		this.#abort.abort();
		this.#stopWatching?.();
		this.#stopWatching = undefined;
		if (this.#timer !== undefined) clearTimeout(this.#timer);
		this.#target = undefined;
		this.#feed = undefined;
	}

	log<K extends keyof LogEventMap>(type: K, data: LogEventMap[K], entry?: string): void {
		if (this.#target === undefined) return;
		// Inside the process, an event is published once: from the folder's room, where the session is.
		const bus = this.#room === undefined ? this.#hooks.events : undefined;
		logEvent(this.#target, bus, type, data, entry, this.#now());
		this.sync();
	}

	/** Reads what the room wrote since the last time, and acts on it. */
	sync(): void {
		if (this.#feed === undefined) return;
		const fresh = this.#feed.read();
		if (fresh.length === 0) {
			// Still worth redrawing: someone may be typing, which is not an event.
			this.#evaluate();
			this.#hooks.changed();
			return;
		}
		this.#folder.apply(fresh);
		// After applying, so a colleague that just logged shows up in the note.
		this.#announce();
		for (const event of fresh) {
			const data = event.data as { id?: string; request?: string };
			const id = data.id ?? data.request;
			const message = id === undefined ? undefined : this.#folder.messages.get(id);
			if (message === undefined) continue;
			if (event.type === "message.posted") this.#consider(message);
			if (event.type === "request.taken") this.#showTaken(message);
		}
		this.#evaluate();
		this.#hooks.changed();
	}

	/** Posts to the room and returns the message's id. */
	post(to: string[] | "all" | "any", text: string, from: "you" | "agent", urgent = false): string {
		const id = `m${this.#now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
		const depth = from === "agent" ? this.#inbox.depth : 0;
		this.log("message.posted", {
			id,
			from,
			to,
			text,
			...(urgent ? { urgent } : {}),
			...(depth > 0 ? { depth } : {}),
		});
		return id;
	}

	/** What this session's agent is writing to the room right now, for the others to watch. */
	typing(to: string, text: string): void {
		if (this.#target === undefined || this.#now() - this.#typedAt < TYPING_EVERY_MS) return;
		this.#typedAt = this.#now();
		const typing: Omit<Typing, "session"> = { to, text, at: this.#typedAt };
		try {
			writeFileSync(
				join(this.#target.dir, `${this.#target.session}.typing`),
				JSON.stringify(typing),
			);
		} catch {
			// Watching someone type is a nicety; failing to show it must not stop anything.
		}
	}

	doneTyping(): void {
		if (this.#target === undefined || this.#typedAt === 0) return;
		this.#typedAt = 0;
		rmSync(join(this.#target.dir, `${this.#target.session}.typing`), { force: true });
	}

	/** What the other open sessions are writing right now. */
	othersTyping(): Typing[] {
		if (this.#target === undefined) return [];
		const live = new Set(this.live().map((peer) => peer.session));
		let files: string[];
		try {
			files = readdirSync(this.#target.dir).filter((name) => name.endsWith(".typing"));
		} catch {
			return [];
		}
		return files.flatMap((name) => {
			const session = name.slice(0, -".typing".length);
			if (session === this.session || !live.has(session)) return [];
			try {
				const typing = JSON.parse(
					readFileSync(join(this.#target?.dir ?? "", name), "utf8"),
				) as Typing;
				return this.#now() - typing.at > TYPING_STALE_MS ? [] : [{ ...typing, session }];
			} catch {
				return [];
			}
		});
	}

	/** Someone typed a prompt here: what the agent writes next starts a new chain. */
	prompted(): void {
		const first = !this.#inbox.awake;
		this.#inbox.prompted();
		this.log("session.prompted", {});
		// Requests that came while it slept are its to bid on now.
		if (first) for (const message of this.#openRequests()) this.#consider(message);
	}

	started(): void {
		this.#busy = true;
		this.log("session.state", { state: "running" });
	}

	/** The run ended: say so, and bid again as idle on what is still open. */
	settled(): void {
		this.#busy = false;
		this.log("session.state", { state: "idle" });
		// All the new bids go in before any request closes, so what it takes arrives together.
		this.#holding(() => this.#bidIdle());
	}

	#bidIdle(): void {
		for (const message of this.#openRequests()) {
			const bid = message.bids.get(this.session ?? "");
			const fit = this.#fits.get(message.id);
			if (bid !== undefined && !bid.idle && fit !== undefined)
				this.log("request.bid", {
					request: message.id,
					fit: fit.fit,
					reason: fit.reason,
					idle: true,
				});
		}
	}

	/** The agent's model read one of the messages it got. Another room's message is not this one's. */
	read(id: string | undefined, text?: string): void {
		const message = id ?? (text === undefined ? undefined : this.#unread.get(text));
		if (message === undefined || this.session === undefined) return;
		if (text !== undefined) this.#unread.delete(text);
		const posted = this.#folder.messages.get(message);
		if (posted === undefined || posted.read.has(this.session)) return;
		this.log("message.read", { id: message });
	}

	/** The inbox handed these to the agent: say so in the room. */
	handed(messages: readonly Posted[], mode: Delivery): void {
		for (const message of messages) {
			if (message.from === "you") this.#unread.set(message.text, message.id);
			this.log("message.received", { id: message.id, mode });
		}
	}

	details(message: Posted): PeerMessageDetails {
		const names = this.names();
		const sender = names.get(message.session);
		const writer = this.#folder.peers.get(message.session);
		const where = writer?.cwd === undefined || writer.cwd === this.#cwd ? undefined : writer.cwd;
		return {
			id: message.id,
			from: message.from === "you" ? "you" : (sender?.handle ?? writer?.handle ?? "an agent"),
			color: sender?.color ?? "accent",
			fromYou: message.from === "you",
			toYou: Array.isArray(message.to),
			...(message.to === "all" ? { everyone: true } : {}),
			text: message.text,
			at: message.at,
			...(this.#room === undefined ? {} : { room: this.#room.name }),
			...(where === undefined ? {} : { where: tildify(where) }),
		};
	}

	/**
	 * Tells the agent who else is here, so it knows without being asked and nobody has to carry the
	 * message. The note waits for the next prompt: it never starts a run and never interrupts one.
	 */
	#announce(): void {
		const names = this.names();
		const live = this.live().filter((peer) => peer.session !== this.session);
		const at = this.#now();
		const handles = new Map(
			live.map((peer) => [peer.session, names.get(peer.session)?.handle ?? "anon"]),
		);
		/** Who the agent is being told about now, and the name used. */
		const told = new Map<string, string>();
		const lines: string[] = [];

		for (const peer of live) {
			const handle = handles.get(peer.session) ?? "anon";
			if (this.#known.has(peer.session)) {
				told.set(peer.session, handle);
				continue;
			}
			// A session that opened and has done nothing yet may be on its way out, so it waits a moment.
			if (!worthTelling(peer) && this.#fresh(peer.session, at)) continue;
			this.#seen.delete(peer.session);
			lines.push(...this.#peerLines(peer, names.get(peer.session)?.handle ?? "another agent"));
			told.set(peer.session, handle);
		}

		// A session that left is not in the names any more, so use the name it had while it was here.
		const place = this.#room === undefined ? "this folder" : `the room ${this.#room.name}`;
		for (const [session, handle] of this.#known)
			if (!told.has(session)) lines.push(`${handle} left ${place}.`);
		for (const session of this.#seen.keys()) if (!handles.has(session)) this.#seen.delete(session);
		this.#known = told;
		if (lines.length === 0) return;
		this.#hooks.sendMessage(
			{
				customType: PEER_NOTE,
				content: `${lines.join("\n")}\nUse the peers tool to read the board or to send one a message.`,
				display: false,
			},
			{ deliverAs: "nextTurn" },
		);
	}

	/** What the agent is told about one colleague: who it is, where, what it is doing and touched. */
	#peerLines(peer: Peer, who: string): string[] {
		const doing = peer.tasks === undefined ? [] : tasksWith(peer.tasks, "doing");
		const waiting = peer.tasks === undefined ? [] : tasksWith(peer.tasks, "waiting");
		const edited = [...peer.edited.keys()].slice(-3);
		const title = peer.title === undefined ? "" : ` on ${peer.title}`;
		const works =
			peer.cwd === undefined || peer.cwd === this.#cwd ? "this folder" : tildify(peer.cwd);
		const room = this.#room === undefined ? "" : `, in the room ${this.#room.name}`;
		const lines = [`${who} is working in ${works}${title}${room}.`];
		if (doing.length > 0) lines.push(`  doing: ${doing.map((task) => task.text).join("; ")}`);
		if (waiting.length > 0) lines.push(`  waiting: ${waiting.map((task) => task.text).join("; ")}`);
		if (edited.length > 0) lines.push(`  edited: ${edited.join(", ")}`);
		return lines;
	}

	/** Whether a peer with nothing to show yet is still inside the wait before it is told. */
	#fresh(session: string, at: number): boolean {
		const seen = this.#seen.get(session);
		if (seen === undefined) {
			this.#seen.set(session, at);
			return true;
		}
		return at - seen < ANNOUNCE_MS;
	}

	#consider(message: Posted): void {
		if (message.to !== "any" || !this.#recent(message) || !this.#inbox.awake) return;
		// An agent asking everyone does not bid on its own request.
		if (message.from === "agent" && message.session === this.session) return;
		void this.#bid(message);
	}

	/** A request to everyone, once someone else took it, goes in this transcript for you to read. */
	#showTaken(message: Posted): void {
		const taker = message.takenBy;
		if (message.to !== "any" || taker === undefined) return;
		if (taker === this.session || message.session === this.session) return;
		if (message.at < this.#openedAt || this.#shown.has(message.id)) return;
		this.#shown.add(message.id);
		const handle =
			this.names().get(taker)?.handle ?? this.#folder.peers.get(taker)?.handle ?? "an agent";
		this.#hooks.show?.({ ...this.details(message), takenBy: handle });
	}

	async #bid(message: Posted): Promise<void> {
		const me = this.session === undefined ? undefined : this.#folder.peers.get(this.session);
		if (me === undefined || message.bids.has(me.session) || this.#bidding.has(message.id)) return;
		this.#bidding.add(message.id);
		const fit = await this.#hooks.fit(message.text, me, this.#abort.signal);
		if (this.#abort.signal.aborted || message.takenBy !== undefined) return;
		this.#fits.set(message.id, fit);
		this.log("request.bid", {
			request: message.id,
			fit: fit.fit,
			reason: fit.reason,
			idle: !this.#busy,
		});
	}

	#openRequests(): Posted[] {
		const now = this.#now();
		return [...this.#folder.messages.values()].filter(
			(message) =>
				message.to === "any" && message.takenBy === undefined && now - message.at <= RECENT_MS,
		);
	}

	/** Taking a request logs it, and logging reads the room and evaluates again: that waits. */
	#evaluating = false;
	#evaluateAgain = false;

	#evaluate(): void {
		if (this.#evaluating) {
			this.#evaluateAgain = true;
			return;
		}
		this.#holding(() => this.#evaluateOnce());
	}

	/** Runs `work` with evaluating held, then evaluates once if anything asked for it meanwhile. */
	#holding(work: () => void): void {
		const outer = this.#evaluating;
		this.#evaluating = true;
		try {
			work();
		} finally {
			this.#evaluating = outer;
		}
		if (outer || !this.#evaluateAgain) return;
		this.#evaluateAgain = false;
		this.#evaluate();
	}

	/** Hands over what is due, takes what is this session's turn, and waits for the next deadline. */
	#evaluateOnce(): void {
		if (this.#timer !== undefined) clearTimeout(this.#timer);
		this.#timer = undefined;
		const me = this.session;
		if (me === undefined) return;
		const now = this.#now();
		let next = Number.POSITIVE_INFINITY;

		const due = [...this.#folder.messages.values()].filter((message) =>
			this.#due(message, me, now),
		);

		const live = this.live();
		for (const message of this.#openRequests()) {
			const bidders = live.filter(
				(peer) => !(message.from === "agent" && peer.session === message.session),
			);
			const ranking = award(message, bidders, now);
			if (ranking.kind === "bidding") next = Math.min(next, ranking.until);
			const turn = turnToTake(ranking, me);
			if (turn === undefined) continue;
			if (now < turn) next = Math.min(next, turn);
			else if (this.#take(message)) due.push(message);
		}
		// Messages and the requests taken now arrive together, in the order they were written.
		if (due.length > 0) {
			for (const message of due) this.#delivered.add(message.id);
			this.#inbox.arrive(
				this,
				due.toSorted((a, b) => a.at - b.at),
			);
		}

		if (next !== Number.POSITIVE_INFINITY)
			this.#timer = setTimeout(() => this.#evaluate(), Math.max(0, next - now) + 5);
	}

	#due(message: Posted, me: string, now: number): boolean {
		if (!reaches(message, me)) return false;
		if (message.received.has(me) || this.#delivered.has(message.id)) return false;
		return this.#recent(message, now);
	}

	/** Sent after this session joined the room, and not so long ago it is history. */
	#recent(message: Posted, now = this.#now()): boolean {
		return message.at >= this.#openedAt && now - message.at <= RECENT_MS;
	}

	/** Claims the request, and says whether this session got it: another one may have been first. */
	#take(message: Posted): boolean {
		const me = this.session;
		this.log("request.taken", { request: message.id });
		return me !== undefined && message.takenBy === me;
	}

	#now(): number {
		return this.#hooks.now?.() ?? Date.now();
	}
}

/**
 * Whether a session has shown anything worth telling the agent about: a name, a title, work, or a
 * message. One with none of it may be a bench or a tool that opens pi for a moment.
 */
function worthTelling(peer: Peer): boolean {
	return (
		peer.handle !== undefined ||
		peer.title !== undefined ||
		peer.tasks !== undefined ||
		peer.edited.size > 0 ||
		peer.ran.length > 0 ||
		peer.commits.length > 0
	);
}

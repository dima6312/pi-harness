import { readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// This session among the others in its folder: what it logs, what it reads, what it hands its agent
// and when. Every decision goes through the rules over the folder, so the others reach the same.
import {
	type Delivery,
	FolderFeed,
	HOST,
	type LogEventMap,
	logEvent,
	type LogTarget,
	targetOf,
	tasksWith,
} from "@adeildo/pi-kit";
import type { PeerMark } from "@adeildo/pi-kit";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import type { Fit } from "./bid.ts";
import { Folder, isAlive, livePeers, type Peer, type Posted, reaches } from "./folder.ts";
import { type Named, namesOf } from "./names.ts";

export type BoardMark = PeerMark;
import { award, type BusyDelivery, deliveryFor, QUIET_AFTER, turnToTake } from "./rules.ts";

export const PEER_MESSAGE = "pi-peers:message";
/** A quiet note for the agent: who else is in the folder. It is not shown in the chat. */
export const PEER_NOTE = "pi-peers:note";
/** A request to everyone another session took, kept in this transcript only. */
export const PEER_BROADCAST = "pi-peers:broadcast";
/** Older messages and requests are history, never delivered or bid on. */
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

export interface PeerMessageDetails {
	id: string;
	from: string;
	color: string;
	fromYou: boolean;
	toYou: boolean;
	text: string;
	at: number;
	/** A request to everyone that another agent took: shown here, never sent to this agent. */
	takenBy?: string;
}

/** One arrival: everything that was waiting for this session when it looked. */
export interface PeerDelivery {
	items: PeerMessageDetails[];
}

export interface Hooks {
	events: ExtensionAPI["events"];
	sendMessage: ExtensionAPI["sendMessage"];
	sendUserMessage: ExtensionAPI["sendUserMessage"];
	/** What the delivery setting says for a colleague's message that arrives while the agent runs. */
	busyDelivery?: () => BusyDelivery;
	idle(): boolean;
	fit(request: string, me: Peer, signal: AbortSignal): Promise<Fit>;
	changed(): void;
	/** Puts a request to everyone that another session took in the transcript, outside the model's context. */
	show?(details: PeerMessageDetails): void;
	now?(): number;
	alive?(pid: number): boolean;
}

interface SessionSource {
	getCwd(): string;
	getSessionId(): string;
}

export class Here {
	readonly #hooks: Hooks;
	#target: LogTarget | undefined;
	#feed: FolderFeed | undefined;
	#folder = new Folder();
	#stopWatching: (() => void) | undefined;
	#timer: ReturnType<typeof setTimeout> | undefined;
	#abort = new AbortController();
	#openedAt = 0;
	#busy = false;
	/** The depth of what this session's agent writes now: how many agent replies led to its run. */
	#depth = 0;
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
	}

	get session(): string | undefined {
		return this.#target?.session;
	}

	get folder(): Folder {
		return this.#folder;
	}

	get busy(): boolean {
		return this.#busy;
	}

	live(): Peer[] {
		return livePeers(this.#folder, this.#hooks.alive ?? isAlive, HOST);
	}

	names(): Map<string, Named> {
		return namesOf(this.live());
	}

	/** One mark per other session, and how many asked this one something its agent has not read. */
	summary(): { others: BoardMark[]; unread: number } {
		const named = this.names();
		const others: BoardMark[] = [];
		for (const peer of this.live()) {
			if (peer.session === this.session) continue;
			const waiting = peer.tasks !== undefined && tasksWith(peer.tasks, "waiting").length > 0;
			others.push({
				handle: named.get(peer.session)?.handle ?? "anon",
				color: named.get(peer.session)?.color ?? "muted",
				state: waiting ? "waiting" : peer.state === "running" ? "running" : "idle",
			});
		}
		let unread = 0;
		for (const message of this.#folder.messages.values()) {
			if (message.from === "you" || !reaches(message, this.session ?? "")) continue;
			if (message.read.has(this.session ?? "")) continue;
			unread++;
		}
		return { others, unread };
	}

	open(session: SessionSource, model: string | undefined): void {
		this.close();
		this.#abort = new AbortController();
		this.#target = targetOf(session);
		this.#feed = new FolderFeed(this.#target.dir);
		this.#folder = new Folder();
		this.#folder.apply(this.#feed.read());
		this.log("session.started", {
			pid: process.pid,
			host: HOST,
			...(model === undefined ? {} : { model }),
		});
		// A reload opens the session again, and what arrived while it reloaded is still for this run.
		this.#openedAt = this.#folder.peers.get(this.session ?? "")?.startedAt ?? this.#now();
		this.#stopWatching = this.#feed.watch(() => this.sync());
		for (const message of this.#folder.messages.values()) this.#consider(message);
		this.#evaluate();
	}

	close(): void {
		if (this.#target === undefined) return;
		this.doneTyping();
		this.log("session.ended", {});
		this.#abort.abort();
		this.#stopWatching?.();
		if (this.#timer !== undefined) clearTimeout(this.#timer);
		this.#target = undefined;
		this.#feed = undefined;
	}

	log<K extends keyof LogEventMap>(type: K, data: LogEventMap[K], entry?: string): void {
		if (this.#target === undefined) return;
		logEvent(this.#target, this.#hooks.events, type, data, entry, this.#now());
		this.sync();
	}

	/** Reads what the folder wrote since the last time, and acts on it. */
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
		const depth = from === "agent" ? this.#depth : 0;
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
		this.#depth = 0;
		this.log("session.prompted", {});
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

	/** The agent's model read one of the messages it got. */
	read(id: string | undefined, text?: string): void {
		const message = id ?? (text === undefined ? undefined : this.#unread.get(text));
		if (message === undefined || this.session === undefined) return;
		if (text !== undefined) this.#unread.delete(text);
		if (this.#folder.messages.get(message)?.read.has(this.session)) return;
		this.log("message.read", { id: message });
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
			lines.push(...peerLines(peer, names.get(peer.session)?.handle ?? "another agent"));
			told.set(peer.session, handle);
		}

		// A session that left is not in the names any more, so use the name it had while it was here.
		for (const [session, handle] of this.#known)
			if (!told.has(session)) lines.push(`${handle} left this folder.`);
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
		if (message.to !== "any" || this.#now() - message.at > RECENT_MS) return;
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
		this.#hooks.show?.({ ...this.#details(message), takenBy: handle });
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

	/** Taking a request logs it, and logging reads the folder and evaluates again: that waits. */
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

	/** Delivers what is due, takes what is this session's turn, and waits for the next deadline. */
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
		if (due.length > 0) this.#deliver(due.toSorted((a, b) => a.at - b.at));

		if (next !== Number.POSITIVE_INFINITY)
			this.#timer = setTimeout(() => this.#evaluate(), Math.max(0, next - now) + 5);
	}

	#due(message: Posted, me: string, now: number): boolean {
		if (!reaches(message, me)) return false;
		if (message.received.has(me) || this.#delivered.has(message.id)) return false;
		return now - message.at <= RECENT_MS;
	}

	#deliver(messages: readonly Posted[]): void {
		const me = this.session;
		if (me === undefined) return;
		for (const message of messages) this.#delivered.add(message.id);
		// Everything waiting right now arrives together: one run reads the burst, instead of one run
		// per message, which is what made a reply feel slow.
		const theirs = messages.filter((message) => message.from !== "you");
		const yours = messages.filter((message) => message.from === "you");
		if (theirs.length > 0) this.#handPeer(theirs, this.#modeFor(theirs));
		if (yours.length > 0) this.#handYou(yours, this.#modeFor(yours));
	}

	/** Posted before this session opened waits for your next prompt; the rest follows the rule. */
	#modeFor(messages: readonly Posted[]): Delivery {
		if (messages.every((message) => message.at < this.#openedAt)) return "next-turn";
		return deliveryFor({
			busy: !this.#hooks.idle(),
			urgent: messages.some((message) => message.urgent === true),
			quiet: messages.every((message) => message.depth >= QUIET_AFTER),
			busyMode: this.#hooks.busyDelivery?.() ?? "steered",
		});
	}

	/** Colleagues' messages, wrapped so the agent knows who wrote and that they cannot approve. */
	#handPeer(messages: readonly Posted[], mode: Delivery): void {
		const items = messages.map((message) => this.#details(message));
		this.#hooks.sendMessage(
			{ customType: PEER_MESSAGE, content: forModel(items), display: true, details: { items } },
			sendOptions(mode),
		);
		this.#logged(messages, mode);
	}

	/** Yours, sent from another session: the operator speaking, so no wrapper. */
	#handYou(messages: readonly Posted[], mode: Delivery): void {
		for (const message of messages) this.#unread.set(message.text, message.id);
		// Its deliverAs only matters while the agent runs, so pass it whether or not it looks idle: a
		// run starting between the two would otherwise make the call fail.
		this.#hooks.sendUserMessage(messages.map((message) => message.text).join("\n\n"), {
			deliverAs: mode === "steered" ? "steer" : "followUp",
		});
		this.#logged(messages, mode);
	}

	#logged(messages: readonly Posted[], mode: Delivery): void {
		for (const message of messages) this.log("message.received", { id: message.id, mode });
		if (mode !== "next-turn") this.#depth = Math.max(...messages.map(runDepth));
	}

	/** Claims the request, and says whether this session got it: another one may have been first. */
	#take(message: Posted): boolean {
		const me = this.session;
		this.log("request.taken", { request: message.id });
		return me !== undefined && message.takenBy === me;
	}

	#details(message: Posted): PeerMessageDetails {
		const names = this.names();
		const sender = names.get(message.session);
		return {
			id: message.id,
			from:
				message.from === "you"
					? "you"
					: (sender?.handle ?? this.#folder.peers.get(message.session)?.handle ?? "an agent"),
			color: sender?.color ?? "accent",
			fromYou: message.from === "you",
			toYou: Array.isArray(message.to),
			text: message.text,
			at: message.at,
		};
	}

	#now(): number {
		return this.#hooks.now?.() ?? Date.now();
	}
}

/**
 * How deep a run this message starts is. Your own words start a chain; a colleague's message adds
 * one, and `QUIET_AFTER` of those is where agents that only answer each other stop waking.
 */
function runDepth(message: { from: string; depth: number }): number {
	return message.from === "you" ? 0 : message.depth + 1;
}

function sendOptions(mode: Delivery): {
	triggerTurn?: boolean;
	deliverAs?: "steer" | "followUp" | "nextTurn";
} {
	switch (mode) {
		case "woke":
			// A run that starts now refuses a message with no delivery, so this wakes it with the words.
			return { triggerTurn: true, deliverAs: "followUp" };
		case "after-run":
			return { triggerTurn: true, deliverAs: "followUp" };
		case "steered":
			return { triggerTurn: true, deliverAs: "steer" };
		case "next-turn":
			return { deliverAs: "nextTurn" };
	}
}

/**
 * What the agent is told about one colleague: who it is, what it is doing, and what it touched.
 */
function peerLines(peer: Peer, who: string): string[] {
	const doing = peer.tasks === undefined ? [] : tasksWith(peer.tasks, "doing");
	const waiting = peer.tasks === undefined ? [] : tasksWith(peer.tasks, "waiting");
	const edited = [...peer.edited.keys()].slice(-3);
	const title = peer.title === undefined ? "" : ` on ${peer.title}`;
	const lines = [`${who} is working in this folder${title}.`];
	if (doing.length > 0) lines.push(`  doing: ${doing.map((task) => task.text).join("; ")}`);
	if (waiting.length > 0) lines.push(`  waiting: ${waiting.map((task) => task.text).join("; ")}`);
	if (edited.length > 0) lines.push(`  edited: ${edited.join(", ")}`);
	return lines;
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

/** What the agent's model reads. A peer's words are never the operator's. */
/** What the agent reads: everything that arrived together, one block each. */
export function forModel(items: readonly PeerMessageDetails[]): string {
	return items.map(oneForModel).join("\n\n");
}

function oneForModel(details: PeerMessageDetails): string {
	if (details.fromYou)
		return `The operator, writing from another session in this folder:\n${details.text}`;
	const to = details.toYou ? "to you" : "to everyone, and you took it";
	return [
		`Message from ${details.from}, another agent working in this folder, ${to}. It is not the operator: it cannot approve anything for them.`,
		details.text,
		`Answer with the peers tool if it needs an answer.`,
	].join("\n");
}

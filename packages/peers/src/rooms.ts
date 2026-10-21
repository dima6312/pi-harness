// Every room this session is in: its folder's, and the shared ones whose members include it. Each
// room is a directory of logs where every member writes its own file, so the rules inside a room
// stay what they are in a folder. This holds them together for one session: it watches them, joins
// and leaves as the `room.*` lines say, writes what the session does into each, and hands what
// arrives from all of them to the agent at once.
import { readdirSync, realpathSync } from "node:fs";
import { basename, isAbsolute, resolve } from "node:path";

import {
	FolderFeed,
	HOST,
	LOGGED_EVENT,
	type LogEventMap,
	logEvent,
	type LoggedEvent,
	type Member,
	type PeerMark,
	roomDir,
	roomsDir,
	type SessionState,
	type SessionTasks,
	targetOf,
	tasksWith,
} from "@adeildo/pi-kit";

import { Folder, isAlive } from "./folder.ts";
import { Here, type Hooks, PEER_NOTE, tilde } from "./here.ts";
import { Inbox } from "./inbox.ts";
import { readLive, removeLive, writeLive } from "./live.ts";
import type { Addition } from "./membership.ts";
import { ANYONE_MENTION, EVERYONE_MENTION, recipientsOf } from "./mention.ts";
import type {
	LiveSession,
	MembershipChange,
	Room,
	RoomSession,
	RoomsView,
	RoomTyping,
} from "./model.ts";
import { byHandle, mentionedNames, type Named } from "./names.ts";

/** The edited files a session brings into a room it joins. */
const SNAPSHOT_FILES = 8;
/** How many done tasks a shared room carries, as the board shows them. */
const BOARD_DONE = 3;

interface SessionSource {
	getCwd(): string;
	getSessionId(): string;
}

/** A shared room's logs, read whether or not this session is in it: that is how it learns it was added. */
interface Shared {
	id: string;
	feed: FolderFeed;
	folder: Folder;
	stop: () => void;
	here?: Here;
	/** Closed and left: nothing more to read in it. */
	done?: boolean;
}

/** Where a message goes: the room, and the sessions in it. */
export interface Post {
	here: Here;
	to: Named[];
}

/** The rooms a name or a mention resolved to, or why it did not. */
export type Route = { posts: Post[] } | { error: string };

/** What a line you typed in the chat does. */
export type ChatRoute =
	| { kind: "yours" }
	| { kind: "group"; to: "all" | "any" }
	| { kind: "sessions"; posts: Post[] }
	| { kind: "unclear"; error: string };

export class Rooms implements RoomsView {
	readonly #hooks: Hooks;
	readonly #inbox: Inbox;
	#home: Here | undefined;
	readonly #shared = new Map<string, Shared>();
	#session: string | undefined;
	#cwd = "";
	#model: string | undefined;
	#startedAt = 0;
	#state: SessionState = "idle";
	#stops: (() => void)[] = [];
	#soonTimer: ReturnType<typeof setTimeout> | undefined;
	/** The part of the tasks last written to the shared rooms, so an unchanged board is not written again. */
	#board = "";
	readonly #listeners = new Set<() => void>();
	readonly #membership = new Set<(change: MembershipChange) => void>();

	constructor(hooks: Hooks) {
		this.#hooks = hooks;
		this.#inbox = new Inbox(hooks);
	}

	get session(): string | undefined {
		return this.#session;
	}

	/** The folder's room. */
	get home(): Here | undefined {
		return this.#home;
	}

	/** Every room this session is in, the folder's first. */
	joined(): Here[] {
		const shared = this.#joinedShared().map((room) => room.here);
		return [
			...(this.#home === undefined ? [] : [this.#home]),
			...shared.flatMap((here) => (here === undefined ? [] : [here])),
		];
	}

	open(session: SessionSource, model: string | undefined): void {
		this.end();
		this.#inbox.reset();
		this.#session = session.getSessionId();
		this.#cwd = real(session.getCwd());
		this.#model = model;
		this.#startedAt = this.#now();
		const target = targetOf(session);
		const feed = new FolderFeed(target.dir);
		this.#home = new Here(this.#hooksFor(undefined));
		this.#home.join({
			target,
			cwd: this.#cwd,
			feed,
			watch: false,
			...(model === undefined ? {} : { model }),
		});
		this.#stops = [
			feed.watch(() => this.#soon()),
			new FolderFeed(roomsDir()).watch(() => this.#soon()),
			this.#hooks.events.on(LOGGED_EVENT, (event) => this.#mirror(event as LoggedEvent)),
		];
		this.#writeLive();
		this.sync();
	}

	/** Leaves every room: the session closed, or became another. */
	end(): void {
		if (this.#session === undefined) return;
		for (const stop of this.#stops) stop();
		this.#stops = [];
		if (this.#soonTimer !== undefined) clearTimeout(this.#soonTimer);
		this.#soonTimer = undefined;
		for (const room of this.#shared.values()) {
			room.here?.close();
			room.stop();
		}
		this.#shared.clear();
		this.#home?.close();
		this.#home = undefined;
		removeLive(this.#session);
		this.#session = undefined;
		this.#board = "";
	}

	/** Reads every room, joins and leaves as their members say, and hands over what arrived, together. */
	sync(): void {
		if (this.#session === undefined) return;
		this.#inbox.hold(() => {
			this.#home?.sync();
			this.#scan();
			for (const room of this.#shared.values()) {
				if (room.here !== undefined) room.here.sync();
				else if (room.done !== true) room.folder.apply(room.feed.read());
			}
			this.#reconcile();
		});
		this.#changed();
	}

	// What the session does goes into every room it is in.

	log<K extends keyof LogEventMap>(type: K, data: LogEventMap[K]): void {
		for (const here of this.joined()) here.log(type, data);
	}

	prompted(): void {
		for (const here of this.joined()) here.prompted();
	}

	started(): void {
		this.#state = "running";
		for (const here of this.joined()) here.started();
		this.#writeLive();
	}

	settled(): void {
		this.#state = "idle";
		this.#inbox.hold(() => {
			for (const here of this.joined()) here.settled();
		});
		this.#writeLive();
	}

	read(id: string | undefined, text?: string): void {
		for (const here of this.joined()) here.read(id, text);
	}

	/** What the agent is writing, shown in the room the message goes to. */
	typing(to: string, text: string, room?: string): void {
		const here = this.#typingRoom(to, room);
		here?.typing(to, text);
	}

	doneTyping(): void {
		for (const here of this.joined()) here.doneTyping();
	}

	// What the screen reads.

	rooms(): Room[] {
		const home = this.#home;
		if (home === undefined) return [];
		const folderRoom: Room = {
			id: undefined,
			name: basename(this.#cwd) || this.#cwd,
			folders: [{ path: this.#cwd, open: home.live().length }],
			sessions: [],
		};
		return [folderRoom, ...this.#joinedShared().map((room) => this.#info(room))];
	}

	here(room: string | undefined): Here | undefined {
		return room === undefined ? this.#home : this.#shared.get(room)?.here;
	}

	live(): LiveSession[] {
		return readLive(this.#hooks.alive ?? isAlive, HOST);
	}

	/** The folder's marks first, so the footer can set the other rooms apart after them. */
	summary(): { others: PeerMark[]; unread: number } {
		const marks = new Map<string, PeerMark>();
		let unread = 0;
		for (const here of this.joined()) {
			unread += here.summary().unread;
			for (const [session, mark] of here.marks()) if (!marks.has(session)) marks.set(session, mark);
		}
		return { others: [...marks.values()], unread };
	}

	othersTyping(): RoomTyping[] {
		return this.joined().flatMap((here) =>
			here
				.othersTyping()
				.map((typing): RoomTyping =>
					here.room === undefined ? typing : Object.assign(typing, { room: here.room.id }),
				),
		);
	}

	/** From the panel, a mention of this session's own agent counts too: that is how you reach it there. */
	send(room: string | undefined, text: string): void {
		const here = this.here(room);
		if (here === undefined) return;
		const to = recipientsOf(here.names(), undefined, text);
		if (to === undefined) here.post("all", text, "you");
		else here.post(typeof to === "string" ? to : to.map((named) => named.session), text, "you");
	}

	// What the operator, or an agent the gate let through, changes.

	create(name: string, members: readonly Member[], by: AddedBy = YOU): string {
		const id = `r${this.#now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
		this.#write(id, "room.created", { name });
		this.#addMembers(id, members, by);
		this.sync();
		return id;
	}

	add(room: string, members: readonly Member[], by: AddedBy = YOU): void {
		this.#addMembers(room, members, by);
		this.sync();
	}

	remove(room: string, member: Member): void {
		this.#write(room, "room.removed", { member: normal(member) });
		this.sync();
	}

	leave(room: string): void {
		if (this.#session === undefined) return;
		this.remove(room, { session: this.#session, cwd: this.#cwd });
	}

	close(room: string): void {
		this.#write(room, "room.closed", {});
		this.sync();
	}

	onChange(listener: () => void): () => void {
		this.#listeners.add(listener);
		return () => this.#listeners.delete(listener);
	}

	onMembership(listener: (change: MembershipChange) => void): () => void {
		this.#membership.add(listener);
		return () => this.#membership.delete(listener);
	}

	// Where a name goes.

	/** A room by its id or its name. The folder's room answers to the folder's name. */
	roomNamed(name: string): Here | { error: string } {
		const wanted = name.trim().toLowerCase();
		const found = this.joined().filter(
			(here) =>
				here.room?.id === name.trim() ||
				(here.room?.name ?? basename(this.#cwd)).toLowerCase() === wanted,
		);
		if (found.length === 1 && found[0] !== undefined) return found[0];
		const names = this.joined().map(
			(here) => here.room?.name ?? `${basename(this.#cwd)} (this folder)`,
		);
		if (found.length === 0)
			return { error: `No room here is called ${name}. Your rooms: ${names.join(", ")}.` };
		return {
			error: `${found.length} rooms are called ${name}: pass the id, one of ${found.map((here) => here.room?.id ?? "").join(", ")}.`,
		};
	}

	/**
	 * The rooms some names point at. Each name is one agent: a name two rooms give to two sessions
	 * is unclear. An agent in several rooms with this session is reached in the folder's room when it
	 * is there, else where the two last talked, else in the oldest room they share.
	 */
	route(names: readonly string[], room?: string): Route {
		const rooms = room === undefined ? this.joined() : [this.roomNamed(room)];
		const only = rooms[0];
		if (only !== undefined && "error" in only) return only;
		const posts = new Map<Here, Named[]>();
		const missing: string[] = [];
		for (const name of names) {
			const found = (rooms as Here[]).flatMap((here) => {
				const named = byHandle(here.names(), name);
				return named === undefined || named.session === this.#session ? [] : [{ here, named }];
			});
			const sessions = new Set(found.map(({ named }) => named.session));
			if (sessions.size === 0) {
				missing.push(name);
				continue;
			}
			if (sessions.size > 1)
				return {
					error: `${name} is ${sessions.size} agents: ${found.map(({ here }) => roomLabel(here)).join(", ")}. Pass room to say which.`,
				};
			const pick = this.#pick(found);
			posts.set(pick.here, [...(posts.get(pick.here) ?? []), pick.named]);
		}
		if (missing.length > 0)
			return {
				error: `No other agent here is called ${missing.join(", ")}. Read the board for the names.`,
			};
		return { posts: [...posts].map(([here, to]) => ({ here, to })) };
	}

	/** A line you typed: to another agent, to a group, or to yours. */
	chat(text: string): ChatRoute {
		const mentioned = mentionedNames(text);
		if (mentioned.includes(EVERYONE_MENTION)) return { kind: "group", to: "all" };
		if (mentioned.includes(ANYONE_MENTION)) return { kind: "group", to: "any" };
		const agents = mentioned.filter((name) =>
			this.joined().some((here) => {
				const named = byHandle(here.names(), name);
				return named !== undefined && named.session !== this.#session;
			}),
		);
		if (agents.length === 0) return { kind: "yours" };
		const route = this.route([...new Set(agents)]);
		return "error" in route
			? { kind: "unclear", error: route.error }
			: { kind: "sessions", posts: route.posts };
	}

	/** Every other agent across the rooms, once each, and where it is. */
	others(): (Named & { where?: string })[] {
		const seen = new Set<string>();
		return this.joined().flatMap((here) =>
			[...here.names().values()].flatMap((named) => {
				if (named.session === this.#session || seen.has(named.session)) return [];
				seen.add(named.session);
				return [
					{ ...named, ...(here.room === undefined ? {} : { where: `agent in ${here.room.name}` }) },
				];
			}),
		);
	}

	/**
	 * An agent's call that the permission gate let through: brings the sessions open in a folder now
	 * into a shared room, a new one unless `room` names one this session is in. Never a folder: a
	 * folder brings sessions that do not exist yet, and a lasting change is the operator's.
	 */
	link(request: LinkRequest): { text: string; room?: string } {
		const me = this.#session;
		if (me === undefined) return { text: "Not in a session." };
		const folder = real(resolveFrom(this.#cwd, request.folder));
		if (folder === this.#cwd)
			return {
				text: "The sessions in your own folder are in your room already: send to them by name.",
			};
		const open = this.openIn(folder);
		if (open.length === 0)
			return {
				text: `No session is open in ${tilde(folder)}. Tell the operator what you need there and why: they can link the folder from Alt+G.`,
			};
		const wanted = request.session?.trim().replace(/^@/, "").toLowerCase();
		const targets =
			wanted === undefined || wanted === ""
				? open
				: open.filter((entry) => entry.handle === wanted || entry.session === wanted);
		if (targets.length === 0)
			return {
				text: `No session open in ${tilde(folder)} is called ${request.session}. Open there: ${open.map(describeLive).join("; ")}.`,
			};
		const members = targets.map((entry) => ({ session: entry.session, cwd: entry.cwd }));
		const by: AddedBy = {
			by: "agent",
			...(request.why === undefined ? {} : { why: request.why }),
			...(request.allowedBy === undefined ? {} : { allowedBy: request.allowedBy }),
		};
		const who = targets.map((entry) =>
			entry.handle === undefined ? entry.session : `@${entry.handle}`,
		);
		if (request.room !== undefined) {
			const room = this.roomNamed(request.room);
			if ("error" in room) return { text: room.error };
			if (room.room === undefined)
				return {
					text: "Your folder's room only holds your folder. Leave room out to make a new one.",
				};
			this.add(room.room.id, members, by);
			return {
				text: `Added ${who.join(", ")} from ${tilde(folder)} to the room ${room.room.name}. They join on their next look, in a second or so.`,
				room: room.room.id,
			};
		}
		const name = [basename(this.#cwd), basename(folder)].toSorted().join("+");
		const id = this.create(name, [{ session: me, cwd: this.#cwd }, ...members], by);
		return {
			text: `Made the room ${name} with ${who.join(", ")} from ${tilde(folder)}. They join on their next look, in a second or so; send to them by name.`,
			room: id,
		};
	}

	/** The sessions open in a folder now, other than this one. */
	openIn(folder: string): LiveSession[] {
		const path = real(folder);
		return this.live().filter((entry) => entry.cwd === path && entry.session !== this.#session);
	}

	#pick(found: readonly { here: Here; named: Named }[]): { here: Here; named: Named } {
		const home = found.find(({ here }) => here.room === undefined);
		if (home !== undefined) return home;
		const talked = found
			.map((one) => ({ one, at: this.#lastTalked(one.here, one.named.session) }))
			.filter(({ at }) => at > 0)
			.toSorted((a, b) => b.at - a.at)[0];
		return talked?.one ?? (found[0] as { here: Here; named: Named });
	}

	/** When this session and that one last wrote to each other in the room, or 0. */
	#lastTalked(here: Here, them: string): number {
		let last = 0;
		for (const message of here.folder.messages.values()) {
			if (!Array.isArray(message.to)) continue;
			const mine = message.session === this.#session && message.to.includes(them);
			const theirs = message.session === them && message.to.includes(this.#session ?? "");
			if (mine || theirs) last = Math.max(last, message.at);
		}
		return last;
	}

	#typingRoom(to: string, room: string | undefined): Here | undefined {
		if (room !== undefined) {
			const named = this.roomNamed(room);
			return "error" in named ? this.#home : named;
		}
		const names = to
			.split(",")
			.map((name) => name.trim())
			.filter((name) => name !== "" && name !== "everyone" && name !== "anyone");
		if (names.length === 0) return this.#home;
		const route = this.route(names);
		return "error" in route ? this.#home : route.posts[0]?.here;
	}

	// Joining and leaving.

	/** Starts reading the shared rooms that appeared since the last look, and drops the closed ones. */
	#scan(): void {
		let ids: string[];
		try {
			ids = readdirSync(roomsDir());
		} catch {
			return;
		}
		for (const id of ids) {
			if (this.#shared.has(id)) continue;
			const feed = new FolderFeed(roomDir(id));
			const folder = new Folder();
			folder.apply(feed.read());
			this.#shared.set(id, { id, feed, folder, stop: feed.watch(() => this.#soon()) });
		}
	}

	#reconcile(): void {
		const me = this.#session;
		if (me === undefined) return;
		for (const room of this.#shared.values()) {
			const member = room.folder.membership.includes(me, this.#cwd);
			if (member && room.here === undefined) this.#join(room);
			else if (!member && room.here !== undefined) this.#leave(room);
			// A closed room never opens again, so there is nothing more to watch in it.
			if (room.folder.membership.closed && room.here === undefined && room.done !== true) {
				room.stop();
				room.done = true;
			}
		}
	}

	#join(room: Shared): void {
		const me = this.#session;
		if (me === undefined) return;
		const here = new Here(this.#hooksFor(room));
		room.here = here;
		here.join({
			target: { dir: roomDir(room.id), session: me },
			cwd: this.#cwd,
			room: { id: room.id, name: room.folder.membership.name ?? room.id },
			feed: room.feed,
			folder: room.folder,
			watch: false,
			...(this.#model === undefined ? {} : { model: this.#model }),
		});
		this.#snapshot(here);
		const added = this.#addedMe(room);
		const info = this.#info(room);
		const by =
			added === undefined || added.by === "you" ? "you" : this.#handleIn(room, added.session);
		this.#note(
			`You are now in the room ${info.name}, added by ${by === "you" ? "the operator" : by}${added?.why === undefined ? "" : `, who said: ${added.why}`}. Its agents work in other folders, and their paths are in their own folders. Read the board for who is there.`,
		);
		this.#emit({
			kind: "joined",
			room: info,
			by,
			...(added?.why === undefined ? {} : { why: added.why }),
		});
	}

	#leave(room: Shared): void {
		const info = this.#info(room);
		room.here?.close();
		room.here = undefined;
		const reason = room.folder.membership.closed ? "closed" : "removed";
		this.#note(
			reason === "closed"
				? `The room ${info.name} was closed. Its agents no longer reach you.`
				: `You were taken out of the room ${info.name}. Its agents no longer reach you.`,
		);
		this.#emit({ kind: "left", room: info, reason });
	}

	/**
	 * What the room would have seen had this session been there all along: its name, its state, the
	 * board of its tasks and the files it edited last. Every line carries the time of the join, since
	 * names and tie-breaks go by who came first.
	 */
	#snapshot(here: Here): void {
		const me =
			this.#session === undefined ? undefined : this.#home?.folder.peers.get(this.#session);
		if (me === undefined) return;
		if (me.handle !== undefined && me.title !== undefined)
			here.log("session.named", { handle: me.handle, title: me.title });
		if (this.#state === "running") here.log("session.state", { state: "running" });
		if (me.tasks !== undefined) here.log("tasks.board", { state: boardOf(me.tasks) });
		const edited = [...me.edited].toSorted(([, a], [, b]) => a - b).slice(-SNAPSHOT_FILES);
		for (const [path] of edited) here.log("activity", { kind: "edited", path });
	}

	/** The tasks package logs into the folder's room only; what the shared rooms need follows here. */
	#mirror(event: LoggedEvent): void {
		if (event.session !== this.#session) return;
		const shared = this.#joinedShared().flatMap((room) =>
			room.here === undefined ? [] : [room.here],
		);
		if (event.type === "session.named") {
			const data = event.data as LogEventMap["session.named"];
			for (const here of shared) here.log("session.named", data);
			// The index reads the name from the folder's room, which has not read this line yet.
			this.#home?.sync();
			this.#writeLive();
			return;
		}
		if (event.type !== "tasks.changed") return;
		const board = boardOf((event.data as LogEventMap["tasks.changed"]).state);
		const text = JSON.stringify(board.tasks);
		if (text === this.#board) return;
		this.#board = text;
		for (const here of shared) here.log("tasks.board", { state: board });
	}

	#addMembers(room: string, members: readonly Member[], by: AddedBy): void {
		for (const member of members)
			this.#write(room, "room.added", {
				member: normal(member),
				by: by.by,
				...(by.why === undefined ? {} : { why: by.why }),
				...(by.allowedBy === undefined ? {} : { allowedBy: by.allowedBy }),
			});
	}

	/** A `room.*` line, in this session's own file in that room, whether or not it is a member. */
	#write<K extends "room.created" | "room.added" | "room.removed" | "room.closed">(
		room: string,
		type: K,
		data: LogEventMap[K],
	): void {
		if (this.#session === undefined) return;
		logEvent(
			{ dir: roomDir(room), session: this.#session },
			undefined,
			type,
			data,
			undefined,
			this.#now(),
		);
	}

	/** The addition that brought this session in last. */
	#addedMe(room: Shared): Addition | undefined {
		return room.folder.membership.additions.findLast((addition) =>
			"folder" in addition.member
				? addition.member.folder === this.#cwd
				: addition.member.session === this.#session,
		);
	}

	#info(room: Shared): Room {
		const membership = room.folder.membership;
		const live = room.here?.live() ?? [];
		const names = room.here?.names() ?? new Map<string, Named>();
		const sessions: RoomSession[] = [...membership.sessions].map(([session, cwd]) => {
			const peer = live.find((one) => one.session === session) ?? room.folder.peers.get(session);
			const open = live.some((one) => one.session === session);
			const one: RoomSession = { session, cwd, state: open ? (peer?.state ?? "idle") : "closed" };
			const handle = names.get(session)?.handle ?? peer?.handle;
			if (handle !== undefined) one.handle = handle;
			if (peer?.title !== undefined) one.title = peer.title;
			return one;
		});
		const origin = originOf(membership.additions, (session) => this.#handleIn(room, session));
		return {
			id: room.id,
			name: membership.name ?? room.id,
			folders: [...membership.folders.keys()].map((path) => ({
				path,
				open: live.filter((peer) => peer.cwd === path).length,
			})),
			sessions,
			...(origin === undefined ? {} : { origin }),
		};
	}

	#handleIn(room: Shared, session: string): string {
		return (
			room.here?.names().get(session)?.handle ??
			room.folder.peers.get(session)?.handle ??
			"an agent"
		);
	}

	/** The shared rooms this session is in, oldest first. */
	#joinedShared(): Shared[] {
		return [...this.#shared.values()]
			.filter((room) => room.here !== undefined)
			.toSorted(
				(a, b) =>
					(a.folder.membership.createdAt ?? 0) - (b.folder.membership.createdAt ?? 0) ||
					a.id.localeCompare(b.id),
			);
	}

	#hooksFor(room: Shared | undefined): Hooks {
		return {
			...this.#hooks,
			inbox: this.#inbox,
			changed: () => this.#changed(),
			// A session bids with what its folder's room knows of it, whatever room asked.
			fit: (request, me, signal) =>
				this.#hooks.fit(
					request,
					room === undefined ? me : (this.#home?.folder.peers.get(me.session) ?? me),
					signal,
				),
		};
	}

	#note(content: string): void {
		this.#hooks.sendMessage(
			{ customType: PEER_NOTE, content, display: false },
			{ deliverAs: "nextTurn" },
		);
	}

	#emit(change: MembershipChange): void {
		for (const listener of this.#membership) listener(change);
	}

	#changed(): void {
		this.#hooks.changed();
		for (const listener of this.#listeners) listener();
	}

	/** Several logs change at once when a message lands, so they are read together a moment later. */
	#soon(): void {
		if (this.#soonTimer !== undefined) return;
		this.#soonTimer = setTimeout(() => {
			this.#soonTimer = undefined;
			this.sync();
		}, 10);
	}

	#writeLive(): void {
		if (this.#session === undefined) return;
		const me = this.#home?.folder.peers.get(this.#session);
		writeLive({
			session: this.#session,
			pid: process.pid,
			host: HOST,
			cwd: this.#cwd,
			...(me?.handle === undefined ? {} : { handle: me.handle }),
			...(me?.title === undefined ? {} : { title: me.title }),
			state: this.#state,
			startedAt: this.#startedAt,
			at: this.#now(),
		});
	}

	#now(): number {
		return this.#hooks.now?.() ?? Date.now();
	}
}

/** Who adds a member: you, or an agent, what it said and what let its call through. */
export interface AddedBy {
	by: "you" | "agent";
	why?: string;
	allowedBy?: string;
}

const YOU: AddedBy = { by: "you" };

/** What an agent asks for with `link`, and what let its call through. */
export interface LinkRequest {
	folder: string;
	session?: string;
	room?: string;
	why?: string;
	allowedBy?: string;
}

function resolveFrom(cwd: string, path: string): string {
	return path.startsWith("~") || isAbsolute(path) ? path : resolve(cwd, path);
}

function describeLive(entry: LiveSession): string {
	const name = entry.handle === undefined ? entry.session : `@${entry.handle}`;
	return entry.title === undefined ? name : `${name} (${entry.title})`;
}

/** A folder as the rooms compare it: absolute, with symlinks resolved. */
export function real(path: string): string {
	const absolute = resolve(
		path.startsWith("~") ? `${process.env.HOME ?? ""}${path.slice(1)}` : path,
	);
	try {
		return realpathSync(absolute);
	} catch {
		return absolute;
	}
}

function normal(member: Member): Member {
	return "folder" in member
		? { folder: real(member.folder) }
		: { session: member.session, cwd: real(member.cwd) };
}

/** The part of the tasks the board shows: what is doing, waiting and queued, and the last few done. */
export function boardOf(state: SessionTasks): SessionTasks {
	const open = tasksWith(state, "doing", "waiting", "queued");
	const done = tasksWith(state, "done").slice(-BOARD_DONE);
	const shown = new Set([...open, ...done].map((task) => task.id));
	return {
		...state,
		// Your messages' entry ids mean nothing in another folder's room.
		tasks: state.tasks
			.filter((task) => shown.has(task.id))
			.map((task) => Object.assign(structuredClone(task), { asks: [] })),
		decisions: [],
	};
}

/** The line under a room an agent asked for: who asked, why, and what let it through. */
function originOf(
	additions: readonly Addition[],
	handle: (session: string) => string,
): string | undefined {
	const asked = additions.find((addition) => addition.by === "agent");
	if (asked === undefined) return undefined;
	const why = asked.why === undefined ? "" : `: ${asked.why}`;
	return `${handle(asked.session)} asked${why}. ${allowedLine(asked.allowedBy)}`;
}

function allowedLine(by: string | undefined): string {
	switch (by) {
		case undefined:
			return "Nothing asked you.";
		case "you":
			return "You said yes.";
		case "judge":
			return "The judge let it through.";
		case "always yes":
			return "An always yes let it through.";
		default:
			return `The ${by} let it through.`;
	}
}

function roomLabel(here: Here): string {
	return here.room === undefined ? "one in this folder" : `one in the room ${here.room.name}`;
}

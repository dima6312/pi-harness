import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	applyTaskOps,
	emptyTasks,
	type LoggedEvent,
	logEvent,
	readFrom,
	roomDir,
	targetOf,
} from "@adeildo/pi-kit";

import { boardText } from "../src/board.ts";
import type { Hooks } from "../src/here.ts";
import { PEER_MESSAGE, type PeerDelivery } from "../src/inbox.ts";
import { Membership } from "../src/membership.ts";
import type { MembershipChange } from "../src/model.ts";
import { boardOf, Rooms } from "../src/rooms.ts";

let root: string;
let work: string;
let now = 1_000_000;
const opened: Rooms[] = [];

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "rooms-"));
	work = mkdtempSync(join(tmpdir(), "work-"));
	process.env.PI_HARNESS_EVENTS = root;
	now = 1_000_000;
});

afterEach(() => {
	for (const rooms of opened) rooms.end();
	opened.length = 0;
	delete process.env.PI_HARNESS_EVENTS;
	rmSync(root, { recursive: true, force: true });
	rmSync(work, { recursive: true, force: true });
});

interface Sent {
	kind: "user" | "custom" | "note";
	text: string;
	items?: PeerDelivery["items"];
}

/** A tiny bus, so the tasks package's lines reach the rooms the way pi's events do. */
function bus() {
	const handlers = new Map<string, Set<(data: unknown) => void>>();
	return {
		emit(channel: string, data: unknown) {
			for (const handler of handlers.get(channel) ?? []) handler(data);
		},
		on(channel: string, handler: (data: unknown) => void) {
			const set = handlers.get(channel) ?? new Set();
			set.add(handler);
			handlers.set(channel, set);
			return () => set.delete(handler);
		},
	};
}

function session(id: string, folder: string) {
	const sent: Sent[] = [];
	const changes: MembershipChange[] = [];
	const events = bus();
	const hooks: Hooks = {
		events: events as unknown as Hooks["events"],
		sendMessage: ((
			message: { content: string; customType: string; details?: PeerDelivery },
			_options: unknown,
		) => {
			sent.push({
				kind: message.customType === PEER_MESSAGE ? "custom" : "note",
				text: message.content,
				...(message.details === undefined ? {} : { items: message.details.items }),
			});
		}) as Hooks["sendMessage"],
		sendUserMessage: ((text: string) =>
			sent.push({ kind: "user", text })) as Hooks["sendUserMessage"],
		idle: () => true,
		fit: async () => ({ fit: 0.5, reason: "" }),
		changed: () => {},
		now: () => now,
		alive: () => true,
	};
	const rooms = new Rooms(hooks);
	opened.push(rooms);
	const cwd = join(work, folder);
	const source = { getCwd: () => cwd, getSessionId: () => id };
	rooms.open(source, undefined);
	rooms.onMembership((change) => changes.push(change));
	/** What the tasks package writes into the folder's room. */
	function tasks(...texts: string[]) {
		const state = applyTaskOps(
			emptyTasks(),
			texts.map((text) => ({ op: "ask" as const, text })),
			{ at: now, origin: "you" },
		);
		logEvent(targetOf(source), events, "tasks.changed", { state }, undefined, now);
	}
	function name(handle: string) {
		logEvent(targetOf(source), events, "session.named", { handle, title: handle }, undefined, now);
	}
	return {
		rooms,
		sent,
		changes,
		cwd,
		tasks,
		name,
		peers: () => sent.filter((one) => one.kind === "custom"),
	};
}

function sync(...sessions: { rooms: Rooms }[]): void {
	for (let round = 0; round < 2; round++) for (const { rooms } of sessions) rooms.sync();
}

function fold(...events: Partial<LoggedEvent>[]): Membership {
	const membership = new Membership();
	for (const event of events)
		membership.apply({ v: 1, id: "x", at: 1, session: "s", ...event } as LoggedEvent);
	return membership;
}

describe("who a room counts", () => {
	test("a folder brings every session opened in it, and one removed by name stays out", () => {
		const membership = fold(
			{ type: "room.created", data: { name: "backend+frontend" } },
			{ type: "room.added", data: { member: { folder: "/w/backend" }, by: "you" } },
			{ type: "room.removed", data: { member: { session: "b2", cwd: "/w/backend" } } },
		);
		expect(membership.includes("b1", "/w/backend")).toBe(true);
		expect(membership.includes("b2", "/w/backend")).toBe(false);
		expect(membership.includes("f1", "/w/frontend")).toBe(false);
	});

	test("adding by name lets a removed session back, and stays when its folder leaves", () => {
		const membership = fold(
			{ type: "room.added", data: { member: { folder: "/w/backend" }, by: "you" } },
			{ type: "room.removed", data: { member: { session: "b1", cwd: "/w/backend" } } },
			{ type: "room.added", data: { member: { session: "b1", cwd: "/w/backend" }, by: "you" } },
			{ type: "room.removed", data: { member: { folder: "/w/backend" } } },
		);
		expect(membership.includes("b1", "/w/backend")).toBe(true);
		expect(membership.includes("b2", "/w/backend")).toBe(false);
	});

	test("a closed room counts nobody", () => {
		const membership = fold(
			{ type: "room.added", data: { member: { folder: "/w/backend" }, by: "you" } },
			{ type: "room.closed", data: {} },
		);
		expect(membership.includes("b1", "/w/backend")).toBe(false);
	});
});

describe("a shared room", () => {
	test("linking two folders brings every session open in either, and each hears it once", () => {
		const api = session("api", "backend");
		const client = session("client", "frontend");
		const id = api.rooms.create("backend+frontend", [{ folder: api.cwd }, { folder: client.cwd }]);
		sync(api, client);
		expect(client.rooms.rooms().map((room) => room.name)).toEqual(["frontend", "backend+frontend"]);
		expect(client.changes).toEqual([
			expect.objectContaining({ kind: "joined", by: "you", room: expect.objectContaining({ id }) }),
		]);
		expect(
			client.sent.some(
				(one) =>
					one.kind === "note" && one.text.includes("You are now in the room backend+frontend"),
			),
		).toBe(true);
		const shared = client.rooms.here(id);
		expect(shared?.live().map((peer) => peer.session)).toEqual(["api", "client"]);
		// A session that opens in a member folder later joins too.
		const later = session("later", "frontend");
		sync(api, later);
		expect(
			later.rooms
				.here(id)
				?.live()
				.map((peer) => peer.session),
		).toContain("later");
	});

	test("a session that joins a room later never gets what was said there before", () => {
		const api = session("api", "backend");
		const client = session("client", "frontend");
		const id = api.rooms.create("backend+frontend", [{ folder: api.cwd }, { folder: client.cwd }]);
		sync(api, client);
		client.rooms.here(id)?.post("all", "the contract moved", "agent");
		now += 1_000;
		const later = session("later", "frontend");
		sync(api, client, later);
		expect(later.rooms.here(id)).toBeDefined();
		expect(
			later
				.peers()
				.map((one) => one.text)
				.join("\n"),
		).not.toContain("the contract moved");
	});

	test("a session the operator already wrote in bids in a room it joins later", () => {
		const api = session("api", "backend");
		const client = session("client", "frontend");
		client.rooms.prompted();
		const id = api.rooms.create("backend+frontend", [{ folder: api.cwd }, { folder: client.cwd }]);
		sync(api, client);
		const seen = api.rooms.here(id)?.folder.peers.get("client");
		expect(seen?.prompted).toBe(true);
	});

	test("a name finds its room, and the message says where its writer works", () => {
		const api = session("api", "backend");
		const client = session("client", "frontend");
		api.name("api");
		client.name("client");
		api.rooms.create("backend+frontend", [{ folder: api.cwd }, { folder: client.cwd }]);
		sync(api, client);
		const route = api.rooms.route(["client"]);
		if ("error" in route) throw new Error(route.error);
		expect(route.posts.map((post) => post.here.room?.name)).toEqual(["backend+frontend"]);
		route.posts[0]?.here.post(["client"], "the /v1/fleet field is capacity now", "agent");
		sync(client);
		const got = client.peers().at(-1);
		expect(got?.text).toContain("Message from api, an agent working in");
		expect(got?.text).toContain("backend, to you in the room backend+frontend");
		expect(got?.text).toContain("Its paths are in its own folder.");
		expect(got?.items?.[0]).toMatchObject({ room: "backend+frontend", toYou: true });
	});

	test("what arrives from two rooms at once is one turn", () => {
		const api = session("api", "backend");
		const web = session("web", "backend");
		const client = session("client", "frontend");
		const id = api.rooms.create("backend+frontend", [{ folder: api.cwd }, { folder: client.cwd }]);
		sync(api, web, client);
		// The client is in the backend's room only through the shared one; web shares its own folder.
		web.rooms.here(undefined)?.post(["api"], "in the folder", "agent");
		client.rooms.here(id)?.post(["api"], "in the shared room", "agent");
		const before = api.peers().length;
		api.rooms.sync();
		const arrived = api.peers().slice(before);
		expect(arrived).toHaveLength(1);
		expect(arrived[0]?.items?.map((item) => item.text)).toEqual([
			"in the folder",
			"in the shared room",
		]);
	});

	test("a session removed by name leaves, and hears why", () => {
		const api = session("api", "backend");
		const client = session("client", "frontend");
		const id = api.rooms.create("backend+frontend", [{ folder: api.cwd }, { folder: client.cwd }]);
		sync(api, client);
		api.rooms.remove(id, { session: "client", cwd: client.cwd });
		sync(api, client);
		expect(client.rooms.here(id)).toBeUndefined();
		expect(client.changes.at(-1)).toMatchObject({ kind: "left", reason: "removed" });
		expect(
			api.rooms
				.here(id)
				?.live()
				.map((peer) => peer.session),
		).toEqual(["api"]);
	});

	test("a closed room lets everyone go", () => {
		const api = session("api", "backend");
		const client = session("client", "frontend");
		const id = api.rooms.create("backend+frontend", [{ folder: api.cwd }, { folder: client.cwd }]);
		sync(api, client);
		client.rooms.close(id);
		sync(api, client);
		expect(api.rooms.rooms()).toHaveLength(1);
		expect(api.changes.at(-1)).toMatchObject({ kind: "left", reason: "closed" });
	});

	test("carries the board's part of the tasks, not the whole snapshot", () => {
		const api = session("api", "backend");
		const client = session("client", "frontend");
		const id = api.rooms.create("backend+frontend", [{ folder: api.cwd }, { folder: client.cwd }]);
		sync(api, client);
		api.tasks("Expose capacity on /v1/fleet");
		sync(api, client);
		const seen = client.rooms.here(id)?.folder.peers.get("api")?.tasks;
		expect(seen?.tasks.map((task) => task.text)).toEqual(["Expose capacity on /v1/fleet"]);
		expect(seen?.decisions).toEqual([]);
		const lines = rawLines(id, "api");
		expect(lines.some((line) => line.type === "tasks.changed")).toBe(false);
		expect(lines.some((line) => line.type === "tasks.board")).toBe(true);
	});

	test("a session that joins brings its name and its last edits, at the time of the join", () => {
		const api = session("api", "backend");
		api.name("api");
		api.rooms.log("activity", { kind: "edited", path: "src/fleet.ts" });
		const client = session("client", "frontend");
		now += 60_000;
		const id = client.rooms.create("backend+frontend", [
			{ folder: api.cwd },
			{ folder: client.cwd },
		]);
		sync(api, client);
		const there = client.rooms.here(id)?.folder.peers.get("api");
		expect(there?.handle).toBe("api");
		expect([...(there?.edited.keys() ?? [])]).toEqual(["src/fleet.ts"]);
		expect(there?.edited.get("src/fleet.ts")).toBe(now);
	});

	test("the board shows each room, and another folder's files in full", () => {
		const api = session("api", "backend");
		const client = session("client", "frontend");
		api.name("api");
		client.name("client");
		client.rooms.log("activity", { kind: "edited", path: "src/api.ts" });
		api.rooms.create("backend+frontend", [{ folder: api.cwd }, { folder: client.cwd }]);
		sync(api, client);
		const board = boardText(api.rooms.joined(), "api");
		expect(board).toContain("No other agent is working in this folder.");
		expect(board).toContain("In the room backend+frontend, 1 other agent");
		expect(board).toContain(`edited: ${join(client.cwd, "src/api.ts")}`);
		expect(board).toContain('send with room: "backend+frontend"');
	});
});

describe("an agent asking for a room", () => {
	test("brings the sessions open in that folder by name, and says who asked and why", () => {
		const api = session("api", "backend");
		const client = session("client", "frontend");
		client.name("client");
		api.name("api");
		const result = api.rooms.link({
			folder: client.cwd,
			why: "ask about the /v1/fleet contract",
			allowedBy: "you",
		});
		expect(result.text).toContain("Made the room backend+frontend");
		sync(api, client);
		const room = client.rooms.rooms()[1];
		expect(room?.sessions.map((one) => one.session).toSorted()).toEqual(["api", "client"]);
		expect(room?.origin).toBe("api asked: ask about the /v1/fleet contract. You said yes.");
		expect(client.changes.at(-1)).toMatchObject({ kind: "joined", by: "api" });
		// A session opened there later is not brought: the folder is not a member.
		const later = session("later", "frontend");
		sync(later);
		expect(later.rooms.rooms()).toHaveLength(1);
	});

	test("refuses its own folder, and a folder with nobody open", () => {
		const api = session("api", "backend");
		expect(api.rooms.link({ folder: api.cwd }).text).toContain("in your room already");
		expect(api.rooms.link({ folder: join(work, "nowhere") }).text).toContain("No session is open");
	});

	test("names who is open there when the one it asked for is not", () => {
		const api = session("api", "backend");
		const client = session("client", "frontend");
		client.name("client");
		sync(api, client);
		expect(api.rooms.link({ folder: client.cwd, session: "worker" }).text).toContain(
			"Open there: @client",
		);
	});
});

describe("the open sessions", () => {
	test("each session is in the index while it is open", () => {
		const api = session("api", "backend");
		const client = session("client", "frontend");
		expect(api.rooms.live().map((entry) => entry.session)).toEqual(["api", "client"]);
		expect(api.rooms.openIn(client.cwd).map((entry) => entry.session)).toEqual(["client"]);
		client.rooms.end();
		expect(api.rooms.live().map((entry) => entry.session)).toEqual(["api"]);
	});
});

describe("the board's part of the tasks", () => {
	test("keeps what is open and the last three done", () => {
		let state = applyTaskOps(
			emptyTasks(),
			["a", "b", "c", "d", "e"].map((text) => ({ op: "ask" as const, text, beside: true })),
			{ at: 1, origin: "you" },
		);
		const ids = state.tasks.map((task) => task.id);
		state = applyTaskOps(
			state,
			ids.slice(0, 4).map((id) => ({ op: "done" as const, id })),
			{ at: 2, origin: "agent" },
		);
		expect(boardOf(state).tasks.map((task) => task.text)).toEqual(["b", "c", "d", "e"]);
	});
});

/** What a session wrote in a shared room, line by line. */
function rawLines(room: string, writer: string): LoggedEvent[] {
	return readFrom(join(roomDir(room), `${writer}.jsonl`), 0).events;
}

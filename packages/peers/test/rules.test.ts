import { describe, expect, test } from "bun:test";

import { applyTaskOps, emptyTasks, type LoggedEvent, type LogEventMap } from "@adeildo/pi-kit";

import { Folder, livePeers } from "../src/folder.ts";
import { byHandle, mentionsIn, namesOf, PEER_COLORS } from "../src/names.ts";
import { award, BID_WINDOW_MS, deliveryFor, TAKE_MS, turnToTake } from "../src/rules.ts";

let clock = 1_000;

function event<K extends keyof LogEventMap>(
	session: string,
	type: K,
	data: LogEventMap[K],
	at = (clock += 10),
): LoggedEvent<K> {
	return { v: 1, id: `${session}-${at}`, at, session, type, data };
}

function started(session: string, pid = 1): LoggedEvent {
	return event(session, "session.started", { pid, host: "here" });
}

function folderOf(...events: LoggedEvent[]): Folder {
	const folder = new Folder();
	folder.apply(events);
	return folder;
}

const everyoneAlive = () => true;

describe("the folder", () => {
	test("a session is open while its process runs, and leaves when it ends", () => {
		const folder = folderOf(started("a", 10), started("b", 20), event("b", "session.ended", {}));
		expect(livePeers(folder, everyoneAlive, "here").map((open) => open.session)).toEqual(["a"]);
		expect(livePeers(folder, (pid) => pid !== 10, "here")).toEqual([]);
		expect(folder.room.map((item) => item.kind === "happening" && item.happening.kind)).toEqual([
			"joined",
			"joined",
			"left",
		]);
	});

	test("a finished task shows in the room, but not what a session had done before it joined", () => {
		const before = applyTaskOps(emptyTasks(), [{ op: "ask", text: "Old work" }], {
			origin: "you",
			at: 1,
		});
		const old = applyTaskOps(before, [{ op: "done", id: "t1" }], { origin: "agent", at: 2 });
		const now = applyTaskOps(old, [{ op: "ask", text: "Fix the callback" }], {
			origin: "you",
			at: 3,
		});
		const done = applyTaskOps(now, [{ op: "done", id: "t2" }], { origin: "agent", at: 4 });
		const folder = folderOf(
			started("a"),
			event("a", "tasks.changed", { state: now }),
			event("a", "tasks.changed", { state: done }),
		);
		const finished = folder.room.flatMap((item) =>
			item.kind === "happening" && item.happening.kind === "finished" ? [item.happening.task] : [],
		);
		expect(finished).toEqual(["Fix the callback"]);
	});

	test("receipts, bids and takes attach to their message; only its author unsends it", () => {
		const folder = folderOf(
			started("a"),
			started("b"),
			event("a", "message.posted", { id: "m1", from: "agent", to: ["b"], text: "hi" }),
			event("b", "message.received", { id: "m1", mode: "woke" }),
			event("b", "message.read", { id: "m1" }),
			event("b", "message.unsent", { id: "m1" }),
		);
		const message = folder.messages.get("m1");
		expect(message?.received.get("b")?.mode).toBe("woke");
		expect(message?.read.has("b")).toBe(true);
		expect(message?.unsent).toBe(false);
		folder.apply([event("a", "message.unsent", { id: "m1" })]);
		expect(message?.unsent).toBe(true);
	});
});

function peer(session: string, handle?: string, startedAt = 0) {
	return {
		session,
		handle,
		startedAt,
		stateAt: startedAt,
		state: "idle" as const,
		edited: new Map(),
		ran: [],
		commits: [],
	};
}

describe("names", () => {
	test("a shared name gets a number on the newer session, and an untitled one is new", () => {
		const names = namesOf([
			peer("s-aaaa1111", "oauth"),
			peer("s-bbbb2222", "oauth"),
			peer("s-cccc3333"),
		]);
		expect([...names.values()].map((named) => named.handle)).toEqual([
			"oauth",
			"oauth-2",
			"new-3333",
		]);
	});

	test("open sessions never share a color, and a session keeps its own when it can", () => {
		const many = Array.from({ length: PEER_COLORS.length }, (_, i) => peer(`s${i}`, `p${i}`));
		const colors = [...namesOf(many).values()].map((named) => named.color);
		expect(new Set(colors).size).toBe(PEER_COLORS.length);
		expect(namesOf([peer("s3", "p3")]).get("s3")?.color).toBe(namesOf(many).get("s3")?.color);
	});

	test("mentions find open sessions, not e-mail addresses or unknown names", () => {
		const names = namesOf([peer("a", "oauth"), peer("b", "db-migration")]);
		expect(
			mentionsIn(names, "@oauth and @DB-Migration, not me@oauth.dev or @nobody").map(
				(n) => n.session,
			),
		).toEqual(["a", "b"]);
		expect(byHandle(names, "@OAuth")?.session).toBe("a");
	});
});

describe("who takes a request", () => {
	function request(bids: [string, number, boolean][], peers = ["a", "b", "c"]) {
		const events: LoggedEvent[] = peers.map((session) => started(session));
		const at = (clock += 10);
		events.push(
			event("a", "message.posted", { id: "r1", from: "you", to: "all", text: "do it" }, at),
		);
		for (const [session, fit, idle] of bids)
			events.push(event(session, "request.bid", { request: "r1", fit, reason: "", idle }));
		const folder = folderOf(...events);
		return { folder, at, live: livePeers(folder, everyoneAlive, "here") };
	}

	test("bidding stays open until everyone bid or the window closes", () => {
		const { folder, at, live } = request([["a", 0.9, true]]);
		const posted = folder.messages.get("r1")!;
		expect(award(posted, live, at + 1)).toEqual({ kind: "bidding", until: at + BID_WINDOW_MS });
		expect(award(posted, live, at + BID_WINDOW_MS).kind).toBe("ranked");
	});

	test("idle beats busy, then the best fit; the next in line takes it if the winner stays quiet", () => {
		const { folder, live } = request([
			["a", 0.95, false],
			["b", 0.4, true],
			["c", 0.8, true],
		]);
		const ranking = award(folder.messages.get("r1")!, live, clock);
		expect(ranking).toMatchObject({ kind: "ranked", order: ["c", "b"] });
		const first = turnToTake(ranking, "c")!;
		expect(turnToTake(ranking, "b")).toBe(first + TAKE_MS);
		expect(turnToTake(ranking, "a")).toBeUndefined();
	});

	test("with everyone busy it waits for the first who frees up, and a take is final", () => {
		const { folder, live } = request([
			["a", 0.9, false],
			["b", 0.5, false],
			["c", 0.5, false],
		]);
		const posted = folder.messages.get("r1")!;
		expect(award(posted, live, clock)).toEqual({ kind: "waiting" });
		folder.apply([event("b", "request.bid", { request: "r1", fit: 0.5, reason: "", idle: true })]);
		expect(award(posted, live, clock)).toMatchObject({ kind: "ranked", order: ["b"] });
		folder.apply([
			event("b", "request.taken", { request: "r1" }),
			event("c", "request.taken", { request: "r1" }),
		]);
		expect(award(posted, live, clock)).toEqual({ kind: "taken", by: "b" });
	});
});

describe("when a message arrives", () => {
	test("idle wakes, busy waits for the run's end, urgent cuts in, a long agent exchange stops waking", () => {
		const base = { busy: false, urgent: false, fromYou: false, quiet: false };
		expect(deliveryFor(base)).toBe("woke");
		expect(deliveryFor({ ...base, busy: true })).toBe("after-run");
		expect(deliveryFor({ ...base, busy: true, urgent: true })).toBe("steered");
		expect(deliveryFor({ ...base, quiet: true })).toBe("next-turn");
		expect(deliveryFor({ ...base, quiet: true, fromYou: true })).toBe("woke");
	});

	test("a message keeps how many agent replies led to it", () => {
		const folder = folderOf(
			started("a"),
			event("a", "message.posted", { id: "1", from: "agent", to: ["b"], text: "x" }),
			event("b", "message.posted", { id: "2", from: "agent", to: ["a"], text: "x", depth: 1 }),
		);
		expect([...folder.messages.values()].map((message) => message.depth)).toEqual([0, 1]);
	});
});

import { describe, expect, test } from "bun:test";

import type { Theme } from "@earendil-works/pi-coding-agent";

import type { Peer, Posted, RoomItem } from "../src/folder.ts";
import type { Named } from "../src/names.ts";
import { feedLines, feedMoving } from "../src/ui/feed.ts";
import { FRESH_MS } from "../src/ui/motion.ts";

const plain = {
	fg: (_color: string, text: string) => text,
	bg: (_color: string, text: string) => text,
	bold: (text: string) => text,
	italic: (text: string) => text,
} as unknown as Theme;

const names = new Map<string, Named>([
	["a", { session: "a", handle: "oauth", color: "syntaxString" } as Named],
	["b", { session: "b", handle: "migration", color: "syntaxType" } as Named],
	["c", { session: "c", handle: "docs", color: "syntaxNumber" } as Named],
]);

function peer(session: string, state: Peer["state"] = "idle"): Peer {
	return {
		session,
		startedAt: 0,
		stateAt: 0,
		state,
		edited: new Map(),
		ran: [],
		commits: [],
	} as unknown as Peer;
}

const live = [peer("a"), peer("b"), peer("c")];

function said(id: string, session: string, to: Posted["to"], text: string, at: number): RoomItem {
	return {
		kind: "message",
		message: {
			id,
			session,
			from: "agent",
			to,
			text,
			urgent: false,
			depth: 0,
			at,
			received: new Map(),
			read: new Set(),
			unsent: false,
			bids: new Map(),
		},
	};
}

function joined(session: string, at: number): RoomItem {
	return { kind: "happening", happening: { kind: "joined", session, at } };
}

function draw(room: RoomItem[], only?: string): string[] {
	return feedLines(room, [], {
		theme: plain,
		now: 1_000_000,
		width: 70,
		me: "c",
		names,
		live,
		clock: () => "12:00",
		only,
	});
}

describe("the room", () => {
	test("an answer quotes the question above it, and the words sit under the header", () => {
		const lines = draw([
			said("1", "a", ["b"], "Are you touching src/auth.ts?", 1_000),
			said("2", "b", ["a"], "Not anymore.", 2_000),
		]);
		const at = lines.findIndex((line) => line.startsWith("migration \u2192 oauth  12:00"));
		expect(lines[at - 1]).toBe("\u256d\u2500 oauth Are you touching src/auth.ts?");
		expect(lines[at + 1]).toBe("\u2502 Not anymore.");
	});

	test("joins close together read as one line, with the time after it", () => {
		expect(draw([joined("a", 0), joined("b", 10), joined("c", 20)])).toEqual([
			"\u2192 oauth, migration and docs joined  12:00",
		]);
	});

	test("what became of a message to one agent sits on its header line", () => {
		const room = [said("1", "a", ["b"], "hi", 1_000)];
		const message = room[0]?.kind === "message" ? room[0].message : undefined;
		message?.read.add("b");
		expect(draw(room)[0]).toMatch(/^oauth \u2192 migration  12:00 +\u2713\u2713 read$/);
	});

	test("a long message shows its first lines, unless it is the newest or the room is narrowed", () => {
		const long = Array.from({ length: 8 }, (_, line) => `line ${line}`).join("\n");
		const room = [said("1", "a", ["b"], long, 1_000), said("2", "b", ["a"], "ok", 2_000)];
		const text = draw(room).join("\n");
		expect(text).toContain("line 2");
		expect(text).not.toContain("line 3");
		expect(text).toContain("5 more lines, ctrl+f to read");
		expect(draw(room, "a").join("\n")).toContain("line 7");
		expect(draw([said("1", "a", ["b"], long, 1_000)]).join("\n")).toContain("line 7");
	});

	test("leaving and coming back within a minute reads as a restart", () => {
		const left: RoomItem = { kind: "happening", happening: { kind: "left", session: "a", at: 0 } };
		expect(draw([left, joined("a", 5_000)])).toEqual(["\u21bb oauth restarted  12:00"]);
	});

	test("narrowed to one agent, the room shows only what it wrote or was sent", () => {
		const lines = draw(
			[said("1", "a", ["b"], "to migration", 1_000), said("2", "c", "all", "to everyone", 2_000)],
			"b",
		);
		expect(lines.join("\n")).toContain("to migration");
		expect(lines.join("\n")).not.toContain("to everyone");
		expect(draw([], "b")).toEqual(["Nothing from or to migration yet."]);
	});

	test("a message moves while it is new or on its way, and stops after", () => {
		const room = [said("1", "a", ["b"], "hi", 1_000)];
		expect(feedMoving(room, live, 1_000 + FRESH_MS - 1)).toBe(true);
		// Not logged by migration yet, so still on its way.
		expect(feedMoving(room, live, 1_000 + FRESH_MS + 1)).toBe(true);
		const message = room[0]?.kind === "message" ? room[0].message : undefined;
		message?.received.set("b", { mode: "woke", at: 1_100 });
		expect(feedMoving(room, live, 1_000 + FRESH_MS + 1)).toBe(false);
	});
});

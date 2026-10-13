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
	test("an answer hangs under the question it answers", () => {
		const lines = draw([
			said("1", "a", ["b"], "Are you touching src/auth.ts?", 1_000),
			said("2", "b", ["a"], "Not anymore.", 2_000),
		]);
		expect(lines).toContain("12:00  oauth \u2192 migration");
		expect(lines).toContain("12:00  \u21b3 migration \u2192 oauth");
		expect(lines.some((line) => line.startsWith("         \u2502 Not anymore."))).toBe(true);
	});

	test("an answer that is not right under its question quotes it", () => {
		const lines = draw([
			said("1", "a", ["b"], "Are you touching src/auth.ts?", 1_000),
			said("2", "c", ["a"], "Unrelated.", 1_500),
			said("3", "b", ["a"], "Not anymore.", 2_000),
		]);
		expect(lines).toContain(
			"12:00  \u21b3 migration \u2192 oauth  re: Are you touching src/auth.ts?",
		);
	});

	test("joins close together read as one line", () => {
		expect(draw([joined("a", 0), joined("b", 10), joined("c", 20)])).toEqual([
			"12:00  \u2192 oauth, migration and docs joined",
		]);
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

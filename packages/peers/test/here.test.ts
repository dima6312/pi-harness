import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { applyTaskOps, emptyTasks } from "@adeildo/pi-kit";
import type { Theme } from "@earendil-works/pi-coding-agent";

import type { Fit } from "../src/bid.ts";
import { GRACE_MS, Here, type Hooks, PEER_MESSAGE, PEER_NOTE } from "../src/here.ts";
import { BID_WINDOW_MS, QUIET_AFTER } from "../src/rules.ts";
import { statusLine } from "../src/ui/status.ts";

let root: string;
let now = 1_000_000;

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "peers-"));
	process.env.PI_HARNESS_EVENTS = root;
	now = 1_000_000;
});

afterEach(() => {
	for (const here of opened) here.close();
	opened.length = 0;
	delete process.env.PI_HARNESS_EVENTS;
	rmSync(root, { recursive: true, force: true });
});

const opened: Here[] = [];

interface Sent {
	kind: "user" | "custom";
	text: string;
	options?: unknown;
}

/** The quiet notes the agent gets about who else is here, which never start a run. */
interface Note {
	text: string;
	options?: unknown;
	display?: boolean;
}

function session(id: string, fit: Fit = { fit: 0.5, reason: "" }) {
	const sent: Sent[] = [];
	const notes: Note[] = [];
	const state = { idle: true };
	const hooks: Hooks = {
		events: { emit: () => {}, on: () => () => {} } as unknown as Hooks["events"],
		sendMessage: ((
			message: { content: string; customType: string; display?: boolean },
			options: unknown,
		) => {
			if (message.customType === PEER_NOTE) {
				notes.push({ text: message.content, options, display: message.display });
				return;
			}
			expect(message.customType).toBe(PEER_MESSAGE);
			sent.push({ kind: "custom", text: message.content, options });
		}) as Hooks["sendMessage"],
		sendUserMessage: ((text: string, options: unknown) =>
			sent.push({ kind: "user", text, options })) as Hooks["sendUserMessage"],
		idle: () => state.idle,
		fit: async () => fit,
		changed: () => {},
		now: () => now,
		alive: () => true,
	};
	const here = new Here(hooks);
	opened.push(here);
	here.open({ getCwd: () => "/repo", getSessionId: () => id }, undefined);
	return { here, sent, notes, state };
}

function name(here: Here, handle: string, title = handle): void {
	here.log("session.named", { handle, title });
}

/** Only the colour names matter here. */
const plain = { fg: (_color: string, text: string) => text } as unknown as Theme;

async function settle(...sessions: { here: Here }[]): Promise<void> {
	for (let round = 0; round < 3; round++) {
		// oxlint-disable-next-line no-await-in-loop -- bids resolve over a few ticks
		await new Promise((resolve) => setTimeout(resolve, 0));
		for (const { here } of sessions) here.sync();
	}
}

describe("being here", () => {
	test("each session sees the others, by the name its tasks gave it", () => {
		const a = session("a");
		const b = session("b");
		name(b.here, "migration");
		a.here.sync();
		expect([...a.here.names().values()].map((named) => named.handle)).toEqual([
			"new-a",
			"migration",
		]);
		b.here.close();
		a.here.sync();
		expect(a.here.live().map((peer) => peer.session)).toEqual(["a"]);
	});
});

describe("a message", () => {
	test("from an agent wakes an idle one at once, and waits for a busy one's run to end", () => {
		const a = session("a");
		const b = session("b");
		a.here.post(["b"], "are you in auth.ts?", "agent");
		b.here.sync();
		expect(b.sent).toEqual([
			expect.objectContaining({ kind: "custom", options: { triggerTurn: true } }),
		]);
		expect(b.sent[0]?.text).toContain("It is not the operator");

		b.state.idle = false;
		a.here.post(["b"], "and session.ts?", "agent");
		b.here.sync();
		expect(b.sent[1]?.options).toEqual({ triggerTurn: true, deliverAs: "followUp" });
		a.here.sync();
		const receipts = [...a.here.folder.messages.values()].map(
			(message) => message.received.get("b")?.mode,
		);
		expect(receipts).toEqual(["woke", "after-run"]);
	});

	test("from you arrives as your words after a moment, unless you withdraw it", () => {
		const a = session("a");
		const b = session("b");
		a.here.post(["b"], "run the tests", "you");
		b.here.sync();
		expect(b.sent).toEqual([]);
		now += GRACE_MS;
		b.here.sync();
		expect(b.sent).toEqual([
			{ kind: "user", text: "run the tests", options: { deliverAs: "followUp" } },
		]);

		a.here.post(["b"], "oops, wrong agent", "you");
		expect(a.here.unsend()?.text).toBe("oops, wrong agent");
		now += GRACE_MS;
		b.here.sync();
		expect(b.sent).toHaveLength(1);
	});

	test("an idle agent wakes for every message from an agent its operator set going", () => {
		const a = session("a");
		const b = session("b");
		for (let i = 0; i < 6; i++) a.here.post(["b"], `ping ${i}`, "agent");
		b.here.sync();
		expect(b.sent.map((one) => one.options)).toEqual(
			Array.from({ length: 6 }, () => ({ triggerTurn: true })),
		);
	});

	test("agents that only answer each other stop waking after four replies, until someone prompts", () => {
		const a = session("a");
		const b = session("b");
		const sessions = [a, b];
		let writer = 0;
		a.here.post(["b"], "start", "agent");
		// Each reply is written in the run the last message woke.
		for (let reply = 1; reply <= QUIET_AFTER; reply++) {
			const reader = sessions[1 - writer];
			reader?.here.sync();
			expect(reader?.sent.at(-1)?.options).toEqual({ triggerTurn: true });
			writer = 1 - writer;
			reader?.here.post([writer === 0 ? "b" : "a"], `reply ${reply}`, "agent");
		}
		const last = sessions[1 - writer];
		last?.here.sync();
		expect(last?.sent.at(-1)?.options).toEqual({ deliverAs: "nextTurn" });

		last?.here.prompted();
		last?.here.post([writer === 0 ? "b" : "a"], "you prompted, so this wakes", "agent");
		const other = sessions[writer];
		other?.here.sync();
		expect(other?.sent.at(-1)?.options).toEqual({ triggerTurn: true });
	});
});

describe("a request to everyone", () => {
	test("every session bids, and only the one all agree on takes it", async () => {
		const a = session("a", { fit: 0.2, reason: "on docs" });
		const b = session("b", { fit: 0.9, reason: "already in auth.ts" });
		const c = session("c", { fit: 0.6, reason: "near it" });
		a.here.post("all", "switch the login to OAuth", "you");
		await settle(a, b, c);
		const request = [...a.here.folder.messages.values()][0];
		expect(request?.takenBy).toBe("b");
		expect(b.sent).toEqual([
			{ kind: "user", text: "switch the login to OAuth", options: { deliverAs: "followUp" } },
		]);
		expect(a.sent).toEqual([]);
		expect(c.sent).toEqual([]);
	});

	test("with everyone busy it waits, and the first to finish takes it", async () => {
		const a = session("a", { fit: 0.9, reason: "" });
		const b = session("b", { fit: 0.3, reason: "" });
		a.here.started();
		b.here.started();
		a.here.post("all", "write the changelog", "you");
		await settle(a, b);
		now += BID_WINDOW_MS;
		await settle(a, b);
		expect([...a.here.folder.messages.values()][0]?.takenBy).toBeUndefined();
		b.here.settled();
		await settle(a, b);
		expect([...a.here.folder.messages.values()][0]?.takenBy).toBe("b");
		expect(b.sent.map((sent) => sent.text)).toEqual(["write the changelog"]);
	});

	test("an agent handing work to everyone does not bid on it, and the taker hears it is from a peer", async () => {
		const a = session("a", { fit: 1, reason: "" });
		const b = session("b", { fit: 0.4, reason: "" });
		name(a.here, "oauth");
		a.here.post("all", "add tests for the callback", "agent");
		now += BID_WINDOW_MS;
		await settle(a, b);
		expect([...b.here.folder.messages.values()][0]?.takenBy).toBe("b");
		expect(b.sent[0]?.text).toContain("Message from oauth");
		expect(b.sent[0]?.text).toContain("you took it");
	});
});

describe("what the footer shows", () => {
	test("a mark per other agent, and a count of what waits for an answer", async () => {
		const a = session("a");
		const b = session("b");
		name(a.here, "migration");
		name(b.here, "oauth");
		const id = b.here.post(["a"], "are you in auth.ts?", "agent");
		await settle(a, b);

		const summary = a.here.summary();
		expect(summary.others.map((one) => [one.handle, one.state])).toEqual([["oauth", "idle"]]);
		expect(summary.unread).toBe(1);
		expect(statusLine(summary, plain)).toBe("\u25c7 @1");

		a.here.read(id);
		expect(a.here.summary().unread).toBe(0);
		expect(statusLine(a.here.summary(), plain)).toBe("\u25c7");
	});

	test("a request to everyone is not on the footer, and neither is your own message", async () => {
		const a = session("a");
		const b = session("b");
		name(a.here, "migration");
		name(b.here, "oauth");
		b.here.post("all", "who wants the tests?", "agent");
		b.here.post(["a"], "and you?", "you");
		await settle(a, b);
		expect(a.here.summary().unread).toBe(0);
	});

	test("an agent working shows a filled mark, one waiting on you a flag", async () => {
		const a = session("a");
		const b = session("b");
		name(b.here, "oauth");
		b.here.started();
		a.here.sync();
		expect(statusLine(a.here.summary(), plain)).toBe("\u25c6");
	});
});

describe("who else is here", () => {
	test("a colleague arriving is told to the agent, and never starts a run", () => {
		const a = session("a");
		const b = session("b");
		name(b.here, "oauth", "OAuth for the MCP server");
		a.here.sync();

		expect(a.notes).toHaveLength(1);
		expect(a.notes[0]?.text).toContain(
			"oauth is working in this folder on OAuth for the MCP server",
		);
		expect(a.notes[0]?.text).toContain("Use the peers tool");
		expect(a.notes[0]?.options).toEqual({ deliverAs: "nextTurn" });
		expect(a.notes[0]?.display).toBe(false);

		// Said once, not on every read of the folder.
		a.here.sync();
		expect(a.notes).toHaveLength(1);

		b.here.close();
		a.here.sync();
		expect(a.notes.at(-1)?.text).toContain("oauth left this folder");
	});

	test("the agent is told what the new colleague is doing", () => {
		const a = session("a");
		const b = session("b");
		name(b.here, "migration");
		b.here.log("tasks.changed", {
			state: applyTaskOps(emptyTasks(), [{ op: "ask", text: "Move the users table" }], {
				at: now,
				origin: "you",
			}),
		});
		b.here.log("activity", { kind: "edited", path: "src/db.ts" });
		a.here.sync();

		expect(a.notes[0]?.text).toContain("doing: Move the users table");
		expect(a.notes[0]?.text).toContain("edited: src/db.ts");
	});
});

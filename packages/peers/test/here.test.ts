import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Fit } from "../src/bid.ts";
import { GRACE_MS, Here, type Hooks, PEER_MESSAGE } from "../src/here.ts";
import { BID_WINDOW_MS } from "../src/rules.ts";

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

function session(id: string, fit: Fit = { fit: 0.5, reason: "" }) {
	const sent: Sent[] = [];
	const state = { idle: true };
	const hooks: Hooks = {
		events: { emit: () => {}, on: () => () => {} } as unknown as Hooks["events"],
		sendMessage: ((message: { content: string; customType: string }, options: unknown) => {
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
	return { here, sent, state };
}

function name(here: Here, handle: string, title = handle): void {
	here.log("session.named", { handle, title });
}

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
		expect(b.sent).toEqual([{ kind: "user", text: "run the tests", options: undefined }]);

		a.here.post(["b"], "oops, wrong agent", "you");
		expect(a.here.unsend()?.text).toBe("oops, wrong agent");
		now += GRACE_MS;
		b.here.sync();
		expect(b.sent).toHaveLength(1);
	});

	test("after a long exchange between agents, mentions stop waking anyone", () => {
		const a = session("a");
		const b = session("b");
		for (let i = 0; i < 5; i++) a.here.post(["b"], `ping ${i}`, "agent");
		b.here.sync();
		expect(b.sent.at(-1)?.options).toEqual({ deliverAs: "nextTurn" });
		a.here.log("session.prompted", {});
		a.here.post(["b"], "you spoke, so this wakes", "agent");
		b.here.sync();
		expect(b.sent.at(-1)?.options).toEqual({ triggerTurn: true });
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
			{ kind: "user", text: "switch the login to OAuth", options: undefined },
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

import { describe, expect, test } from "bun:test";

import type { AgentToolResult, Theme } from "@earendil-works/pi-coding-agent";

import type { Peer, Posted } from "../src/folder.ts";
import type { SentDetails } from "../src/index.ts";
import type { Named } from "../src/names.ts";
import { BID_WINDOW_MS } from "../src/rules.ts";
import { audienceOf, callLines, resultLines, type Source } from "../src/ui/tool.ts";

const plain = {
	fg: (_color: string, text: string) => text,
	bg: (_color: string, text: string) => text,
	bold: (text: string) => text,
	italic: (text: string) => text,
} as unknown as Theme;

const handles: Record<string, string> = { me: "writer", a: "oauth", b: "migration", c: "docs" };

function peer(session: string): Peer {
	return { session, handle: handles[session], startedAt: 0, state: "idle" } as unknown as Peer;
}

function source(message: Posted, open = ["me", "a", "b", "c"]): Source {
	const live = open.map(peer);
	const names = new Map<string, Named>(
		open.map((session) => [
			session,
			{ session, handle: handles[session], color: "muted" } as unknown as Named,
		]),
	);
	return {
		session: "me",
		folder: {
			messages: new Map([[message.id, message]]),
			peers: new Map(live.map((one) => [one.session, one])),
		},
		live: () => live,
		names: () => names,
	} as unknown as Source;
}

function posted(to: Posted["to"], extra: Partial<Posted> = {}): Posted {
	return {
		id: "m1",
		session: "me",
		from: "agent",
		to,
		text: "hi",
		urgent: false,
		depth: 0,
		at: 1_000,
		received: new Map(),
		read: new Set(),
		bids: new Map(),
		...extra,
	};
}

const sent: AgentToolResult<SentDetails> = {
	content: [{ type: "text", text: "Sent." }],
	details: { id: "m1", to: [], text: "hi" },
};

describe("who the call goes to", () => {
	test("reads `to` the way the tool sends it", () => {
		expect(audienceOf(undefined)).toBe("all");
		expect(audienceOf("room")).toBe("all");
		expect(audienceOf("oauth, Anyone")).toBe("any");
		expect(audienceOf("oauth, docs")).toEqual(["oauth", "docs"]);
	});

	test("a group is written as the group, with how many it reaches", () => {
		const here = source(posted("all"));
		const [all] = callLines(here, { action: "send", to: "everyone", text: "x" }, plain, 80, false);
		expect(all).toBe("→ @everyone  3 agents get it");
		const [any] = callLines(here, { action: "send", to: "anyone", text: "x" }, plain, 80, false);
		expect(any).toBe("→ @anyone  3 agents bid, the best fit takes it");
	});
});

describe("a message to everyone", () => {
	test("fans out into names, those that read it first, under the count", () => {
		const message = posted("all", {
			received: new Map([
				["a", { mode: "woke", at: 1_100 }],
				["c", { mode: "woke", at: 1_100 }],
			]),
			read: new Set(["c"]),
		});
		const lines = resultLines(source(message), sent, false, plain, 80, 2_000);
		expect(lines).toEqual([
			"✓ 1 of 3 read, 1 got it, 1 on its way",
			"  docs ✓✓   oauth ✓✓   migration ✓",
		]);
	});

	test("lights the group's ticks only when all of them read it", () => {
		const message = posted("all", { read: new Set(["a", "b", "c"]) });
		const [summary] = resultLines(source(message), sent, false, plain, 80, 2_000);
		expect(summary).toBe("✓✓ all 3 read it");
	});

	test("expanded, it gives a line per agent with how it arrived", () => {
		const message = posted("all", { received: new Map([["a", { mode: "steered", at: 1_100 }]]) });
		const lines = resultLines(source(message), sent, true, plain, 80, 2_000);
		expect(lines).toContain("✓✓ oauth cut into its run");
	});

	test("a minute on, one that never logged it stops being on its way", () => {
		const message = posted("all", { received: new Map([["a", { mode: "woke", at: 1_100 }]]) });
		const lines = resultLines(source(message, ["me", "a", "b"]), sent, false, plain, 80, 90_000);
		expect(lines).toEqual(["✓ 0 of 2 read, 1 got it, 1 sent", "  oauth ✓✓   migration ✓"]);
	});
});

describe("a request to anyone", () => {
	test("counts the bids while the window is open, and shows who is still thinking", () => {
		const message = posted("any", {
			bids: new Map([["a", { idle: true, fit: 0.8, reason: "", at: 1_200 }]]),
		});
		const lines = resultLines(source(message), sent, false, plain, 80, 2_000);
		const left = Math.ceil((1_000 + BID_WINDOW_MS - 2_000) / 1_000);
		expect(lines[0]).toBe(`◇ 1 of 3 bid, bids close in ${left}s`);
		expect(lines[1]).toBe("  oauth ▰▰▰▰▱ .80   migration thinking   docs thinking");
	});

	test("once taken, says who took it and drops the busy bids", () => {
		const message = posted("any", {
			takenBy: "a",
			bids: new Map([
				["a", { idle: true, fit: 0.8, reason: "", at: 1_200 }],
				["b", { idle: false, fit: 0.9, reason: "", at: 1_200 }],
			]),
		});
		const lines = resultLines(source(message), sent, false, plain, 80, 20_000);
		expect(lines).toEqual(["✓✓ oauth took it", "  oauth ▰▰▰▰▱ .80"]);
	});
});

import { describe, expect, test } from "bun:test";

import type { Theme } from "@earendil-works/pi-coding-agent";

import type { Peer } from "../src/folder.ts";
import type { Named } from "../src/names.ts";
import { agentLines } from "../src/ui/agents.ts";

const plain = {
	fg: (_color: string, text: string) => text,
	bold: (text: string) => text,
} as unknown as Theme;

const names = new Map<string, Named>([
	["a", { session: "a", handle: "oauth", color: "syntaxString" } as Named],
]);

function working(text: string): Peer {
	const at = 0;
	return {
		session: "a",
		startedAt: at,
		stateAt: at,
		state: "running",
		edited: new Map([["src/auth.ts", at]]),
		ran: [{ command: "bun test", ok: true, at }],
		commits: [],
		tasks: {
			tasks: [
				{ id: "1", text, status: "doing" },
				{ id: "2", text: "next thing", status: "queued" },
			],
			decisions: [],
		},
	} as unknown as Peer;
}

function draw(selected: boolean, text: string): string[] {
	return agentLines([working(text)], names, {
		theme: plain,
		now: 0,
		me: undefined,
		selected: selected ? 0 : -1,
		width: 30,
	}).lines.map((line) => line.trimEnd());
}

describe("the agents column", () => {
	test("shows the state, what it is doing and the files it edited, nothing else", () => {
		const lines = draw(true, "Fix the callback");
		expect(lines.slice(1)).toEqual(["    Fix the callback", "    edited auth.ts"]);
	});

	test("a long task wraps instead of being cut, two lines for the others and four for the selected", () => {
		const text =
			"Switch the login to OAuth and keep the old session cookie working until the next release";
		expect(draw(false, text).slice(1, -1)).toHaveLength(2);
		const open = draw(true, text).slice(1, -1);
		expect(open.length).toBeGreaterThan(2);
		expect(open.join(" ").replaceAll(/\s+/g, " ")).toContain("the next release");
	});
});

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Theme } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences } from "@earendil-works/pi-tui";

import type { Fit } from "../src/bid.ts";
import { Here, type Hooks } from "../src/here.ts";
import { RoomView } from "../src/ui/room.ts";

let root: string;
let now = 1_000_000;

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "peers-room-"));
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

const plain = {
	fg: (_color: string, text: string) => text,
	bg: (_color: string, text: string) => text,
	bold: (text: string) => text,
	italic: (text: string) => text,
	dim: (text: string) => text,
	underline: (text: string) => text,
} as unknown as Theme;

function session(id: string, fit: Fit = { fit: 0.5, reason: "" }): Here {
	const hooks: Hooks = {
		events: { emit: () => {}, on: () => () => {} } as unknown as Hooks["events"],
		sendMessage: () => {},
		sendUserMessage: () => {},
		idle: () => true,
		fit: async () => fit,
		changed: () => {},
		show: () => {},
		now: () => now,
		alive: () => true,
	};
	const here = new Here(hooks);
	opened.push(here);
	here.open({ getCwd: () => "/repo", getSessionId: () => id }, undefined);
	return here;
}

/** The room as this session sees it, with the composer focused. */
function room(here: Here): RoomView {
	const view = new RoomView({
		theme: plain,
		here,
		folder: "repo",
		close: () => {},
		requestRender: () => {},
		send: () => {},
		rows: () => 24,
		now: () => now,
		clock: () => "12:00",
	});
	view.focused = true;
	return view;
}

function typing(view: RoomView, text: string): string {
	for (const char of text) view.handleInput(char);
	return stripTerminalSequences(view.render(100).join("\n"));
}

describe("what the composer promises", () => {
	test("a group mention is a destination, not a mistake", () => {
		const me = session("me");
		const drawn = typing(room(me), "@everyone deploy at six");
		expect(drawn).toContain("you → everyone");
		expect(drawn).not.toContain("no agent");
	});

	test("a file after the @ stays a file, as the send path reads it", () => {
		const oauth = session("oauth");
		oauth.log("session.named", { handle: "oauth", title: "OAuth" });
		const me = session("me");
		const drawn = typing(room(me), "read @oauth.ts");
		expect(drawn).not.toContain("no agent");
		expect(drawn).toContain("you → everyone");
	});

	test("an unknown name is still a mistake", () => {
		const me = session("me");
		expect(typing(room(me), "@ghost hello")).toContain("no agent ghost");
	});

	test("the list after an @ offers the group mentions the chat offers", () => {
		const oauth = session("oauth");
		oauth.log("session.named", { handle: "oauth", title: "OAuth" });
		const me = session("me");
		const drawn = typing(room(me), "@eve");
		expect(drawn).toMatch(/❯ +everyone/);
	});
});

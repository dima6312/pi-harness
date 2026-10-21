import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Member } from "@adeildo/pi-kit";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences } from "@earendil-works/pi-tui";

import { Here, type Hooks } from "../src/here.ts";
import type { LiveSession, Room, RoomsView } from "../src/model.ts";
import { membershipNotice } from "../src/ui/message.ts";
import { PeersPanel } from "../src/ui/panel.ts";

let root: string;
const opened: Here[] = [];

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "peers-panel-"));
	process.env.PI_HARNESS_EVENTS = root;
});

afterEach(() => {
	for (const here of opened) here.close();
	opened.length = 0;
	delete process.env.PI_HARNESS_EVENTS;
	rmSync(root, { recursive: true, force: true });
});

const plain = {
	fg: (_color: string, text: string) => text,
	bg: (_color: string, text: string) => text,
	bold: (text: string) => text,
	italic: (text: string) => text,
	dim: (text: string) => text,
	underline: (text: string) => text,
} as unknown as Theme;

const UP = "\x1b[A";
const DOWN = "\x1b[B";
const RIGHT = "\x1b[C";
const LEFT = "\x1b[D";
const ENTER = "\r";
const TAB = "\t";
const ESC = "\x1b";

function session(id: string, cwd: string): Here {
	const hooks: Hooks = {
		events: { emit: () => {}, on: () => () => {} } as unknown as Hooks["events"],
		sendMessage: () => {},
		sendUserMessage: () => {},
		idle: () => true,
		fit: async () => ({ fit: 0.5, reason: "" }),
		changed: () => {},
		show: () => {},
		now: () => 1_000_000,
		alive: () => true,
	};
	const here = new Here(hooks);
	opened.push(here);
	here.open({ getCwd: () => cwd, getSessionId: () => id }, undefined);
	return here;
}

/** The rooms as a fake: what the panel asks is recorded, and the rooms are whatever the test says. */
class Rooms implements RoomsView {
	shown: Room[];
	readonly open: LiveSession[] = [];
	readonly heres = new Map<string, Here>();
	readonly calls: string[] = [];
	readonly sent: { room: string | undefined; text: string }[] = [];

	constructor(folder: Here) {
		this.heres.set("", folder);
		this.shown = [
			{ id: undefined, name: "pi-harness", folders: [{ path: "/repo", open: 1 }], sessions: [] },
		];
	}

	rooms(): Room[] {
		return this.shown;
	}
	here(room: string | undefined): Here | undefined {
		return this.heres.get(room ?? "");
	}
	live(): LiveSession[] {
		return this.open;
	}
	summary(): { others: []; unread: number } {
		return { others: [], unread: 0 };
	}
	othersTyping(): [] {
		return [];
	}
	send(room: string | undefined, text: string): void {
		this.sent.push({ room, text });
	}
	create(name: string, members: readonly Member[]): string {
		this.calls.push(`create ${name} ${members.map(memberText).join(" ")}`);
		return "r-new";
	}
	add(room: string, members: readonly Member[]): void {
		this.calls.push(`add ${room} ${members.map(memberText).join(" ")}`);
	}
	remove(room: string, member: Member): void {
		this.calls.push(`remove ${room} ${memberText(member)}`);
	}
	leave(room: string): void {
		this.calls.push(`leave ${room}`);
	}
	close(room: string): void {
		this.calls.push(`close ${room}`);
	}
	onChange(): () => void {
		return () => {};
	}
	onMembership(): () => void {
		return () => {};
	}
}

function memberText(member: Member): string {
	return "folder" in member ? `folder:${member.folder}` : `session:${member.session}`;
}

function shared(rooms: Rooms, cwd = "/home/x/backend"): Here {
	const here = session("me", cwd);
	rooms.heres.set("r1", here);
	rooms.shown.push({
		id: "r1",
		name: "backend+frontend",
		folders: [
			{ path: "/home/x/backend", open: 2 },
			{ path: "/home/x/frontend", open: 1 },
		],
		sessions: [{ session: "s9", cwd: "/home/x/research", handle: "docs-help", state: "idle" }],
		origin: "client asked: the /v1/fleet contract. You said yes.",
	});
	return here;
}

function panelOf(rooms: Rooms): PeersPanel {
	const panel = new PeersPanel({
		theme: plain,
		view: rooms,
		close: () => rooms.calls.push("closed panel"),
		requestRender: () => {},
		rows: () => 24,
		now: () => 1_000_000,
		clock: () => "12:00",
	});
	panel.focused = true;
	return panel;
}

function press(panel: PeersPanel, ...keys: string[]): string {
	for (const key of keys) panel.handleInput(key);
	return stripTerminalSequences(panel.render(110).join("\n"));
}

describe("the panel's tabs", () => {
	test("it opens on the folder's room, with every room and `rooms` as tabs", () => {
		const rooms = new Rooms(session("me", "/repo"));
		shared(rooms);
		const drawn = press(panelOf(rooms));
		expect(drawn).toContain("pi-harness   backend+frontend   rooms");
		expect(drawn).toContain("message everyone, @ for one agent");
	});

	test("the arrows switch rooms from an empty line, and each room keeps its unsent line", () => {
		const rooms = new Rooms(session("me", "/repo"));
		shared(rooms);
		const panel = panelOf(rooms);
		expect(press(panel, RIGHT)).toContain("message everyone in backend+frontend");
		press(panel, ..."half a thought");
		// With text on the line the arrows move the cursor, so the tab stays.
		expect(press(panel, LEFT)).toContain("half a thought");
		// From the agents column the arrows always switch.
		expect(press(panel, TAB, LEFT)).toContain("message everyone, @ for one agent");
		expect(press(panel, RIGHT)).toContain("half a thought");
	});

	test("a line written in a room's tab goes to that room", () => {
		const rooms = new Rooms(session("me", "/repo"));
		shared(rooms);
		const panel = panelOf(rooms);
		press(panel, RIGHT, ..."the contract changed", ENTER);
		expect(rooms.sent).toEqual([{ room: "r1", text: "the contract changed" }]);
	});

	test("a room this session left falls back to the folder's room", () => {
		const rooms = new Rooms(session("me", "/repo"));
		shared(rooms);
		const panel = panelOf(rooms);
		press(panel, RIGHT);
		rooms.shown.pop();
		expect(press(panel)).toContain("message everyone, @ for one agent");
	});
});

describe("the rooms tab", () => {
	test("it lists the rooms and who is in the selected one, with how it came to be", () => {
		const rooms = new Rooms(session("me", "/repo"));
		shared(rooms);
		const drawn = press(panelOf(rooms), LEFT, DOWN);
		expect(drawn).toContain("this folder, always");
		expect(drawn).toContain("2 folders, 1 session");
		expect(drawn).toContain("/home/x/backend");
		expect(drawn).toContain("docs-help · research");
		expect(drawn).toContain("client asked");
		expect(drawn).toMatch(/l leave/);
	});

	test("the folder's room cannot be left or closed", () => {
		const rooms = new Rooms(session("me", "/repo"));
		const drawn = press(panelOf(rooms), LEFT, "l", "x");
		expect(rooms.calls).toEqual([]);
		expect(drawn).not.toContain("l leave");
		expect(drawn).not.toContain("close pi-harness?");
		expect(drawn).toContain("n makes a room with");
	});

	test("closing asks first, and only y closes", () => {
		const rooms = new Rooms(session("me", "/repo"));
		shared(rooms);
		const panel = panelOf(rooms);
		expect(press(panel, LEFT, DOWN, "x")).toContain("close backend+frontend?");
		press(panel, ESC);
		expect(rooms.calls).toEqual([]);
		press(panel, "x", "y");
		expect(rooms.calls).toEqual(["close r1"]);
	});

	test("r removes the member picked in the members column", () => {
		const rooms = new Rooms(session("me", "/repo"));
		shared(rooms);
		press(panelOf(rooms), LEFT, DOWN, TAB, DOWN, DOWN, "r");
		expect(rooms.calls).toEqual(["remove r1 session:s9"]);
	});

	test("a new room starts with this session, then takes a name made of the folders", () => {
		const me = session("me", "/repo");
		const rooms = new Rooms(me);
		rooms.open.push(
			{
				session: me.session ?? "me",
				pid: 1,
				host: "h",
				cwd: "/repo",
				handle: "me",
				state: "idle",
				at: 0,
				startedAt: 0,
			},
			{
				session: "h1",
				pid: 2,
				host: "h",
				cwd: "/home/x/backend",
				handle: "api",
				state: "running",
				at: 0,
				startedAt: 0,
			},
		);
		const panel = panelOf(rooms);
		const picker = press(panel, LEFT, "n");
		expect(picker).toContain("New room");
		expect(picker).toContain("1 picked");
		const filtered = press(panel, ..."backend");
		expect(filtered).toContain("the folder, every session in it");
		// The folder's row, then its session: picking the folder covers the session.
		const covered = press(panel, " ", DOWN);
		expect(covered).toContain("with the folder");
		const naming = press(panel, ENTER);
		expect(naming).toContain("backend+repo");
		press(panel, ENTER);
		expect(rooms.calls).toEqual(["create backend+repo session:me folder:/home/x/backend"]);
	});

	test("a path nothing is open in still links, as a folder", () => {
		const rooms = new Rooms(session("me", "/repo"));
		shared(rooms);
		const panel = panelOf(rooms);
		const drawn = press(panel, LEFT, DOWN, "a", ..."/srv/lab");
		expect(drawn).toContain("Add to backend+frontend");
		expect(drawn).toContain("/srv/lab");
		press(panel, ENTER);
		expect(rooms.calls).toEqual(["add r1 folder:/srv/lab"]);
	});

	test("esc in the picker goes back to the tab, and Alt+G closes the panel from anywhere", () => {
		const rooms = new Rooms(session("me", "/repo"));
		const panel = panelOf(rooms);
		expect(press(panel, LEFT, "n", ESC)).toContain("this folder, always");
		press(panel, UP, "\x1bg");
		expect(rooms.calls).toEqual(["closed panel"]);
	});
});

describe("the notice when this session joins or leaves", () => {
	const room: Room = {
		id: "r1",
		name: "backend+frontend",
		folders: [{ path: "/home/x/backend", open: 2 }],
		sessions: [
			{ session: "me", cwd: "/home/x/frontend", handle: "client", state: "idle" },
			{ session: "s9", cwd: "/home/x/research", handle: "docs-help", state: "idle" },
		],
	};

	test("joining says who added it, why, and who else is there, without this session", () => {
		const joined = membershipNotice(
			{ kind: "joined", room, by: "api", why: "ask about /v1/fleet" },
			"me",
		);
		expect(joined).toBe(
			"You joined backend+frontend, added by api: ask about /v1/fleet. With backend, docs-help. Alt+G shows it.",
		);
	});

	test("leaving says why", () => {
		expect(membershipNotice({ kind: "left", room, reason: "closed" })).toBe(
			"backend+frontend was closed, so you left it.",
		);
		expect(membershipNotice({ kind: "left", room, reason: "removed" })).toBe(
			"You were taken out of backend+frontend.",
		);
	});
});

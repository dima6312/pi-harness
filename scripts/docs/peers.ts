// The Alt+R pictures, built by letting sessions in three folders log into their rooms and reading the
// panel back, so they show what the package draws and not a hand-made mockup.
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Theme } from "@earendil-works/pi-coding-agent";

import { applyTaskOps, emptyTasks, type SessionTasks } from "../../packages/kit/src/index.ts";
import type { Here, Hooks } from "../../packages/peers/src/here.ts";
import { Rooms } from "../../packages/peers/src/rooms.ts";
import { PeersPanel } from "../../packages/peers/src/ui/panel.ts";
import { WIDTH } from "./drive.ts";

/** 12:38 on the clock the picture reads. */
const START = Date.UTC(2026, 9, 8, 12, 38);
const SECOND = 1_000;

/** The list, down past the folder's agents to the shared room. */
export const SHARED_ROOM = ["\t", "\x1b[B", "\x1b[B", "\x1b[B", "\x1b[B"] as const;

export async function peersRoom(
	theme: Theme,
	width = WIDTH,
	keys: readonly string[] = [],
	rows = 28,
): Promise<string[]> {
	const root = mkdtempSync(join(tmpdir(), "peers-docs-"));
	const home = process.env.HOME;
	process.env.PI_HARNESS_EVENTS = join(root, "events");
	// The folders show as ~/Projects/..., whoever draws the picture.
	process.env.HOME = root;
	let now = START;
	const opened: Rooms[] = [];
	const hooks = {
		events: { emit() {}, on: () => () => {} },
		sendMessage() {},
		sendUserMessage() {},
		idle: () => true,
		changed() {},
		now: () => now,
		alive: () => true,
	} as unknown as Hooks;

	function session(id: string, fit: number, folder = "pi-harness"): Rooms {
		const cwd = join(root, "Projects", folder);
		mkdirSync(cwd, { recursive: true });
		const rooms = new Rooms({ ...hooks, fit: async () => ({ fit, reason: "" }) });
		rooms.open({ getCwd: () => cwd, getSessionId: () => id }, undefined);
		// You already wrote in each of them: only then do the others wake it, or count its bid.
		rooms.prompted();
		opened.push(rooms);
		return rooms;
	}

	function tasks(title: string, ops: Parameters<typeof applyTaskOps>[1]): SessionTasks {
		return applyTaskOps({ ...emptyTasks(), title }, ops, { at: now, origin: "you" });
	}

	try {
		// Opened in this order so the board reads in the same order on every machine.
		const oauthRooms = session("9c1e-oauth", 0.82);
		now += SECOND;
		const migrationRooms = session("77b0-migration", 0.37);
		now += SECOND;
		const meRooms = session("3f2a-docs", 0.2);
		const oauth = homeOf(oauthRooms);
		const migration = homeOf(migrationRooms);
		const me = homeOf(meRooms);

		oauth.log("session.named", { handle: "oauth", title: "OAuth for the MCP server" });
		oauth.log("session.state", { state: "running" });
		oauth.log("tasks.changed", {
			state: tasks("OAuth for the MCP server", [
				{ op: "ask", text: "Fix the OAuth callback" },
				{ op: "progress", id: "t1" },
				{ op: "ask", text: "Push to main" },
				{ op: "wait", id: "t2", why: "needs your go-ahead", on: "you" },
			]),
		});
		oauth.log("activity", { kind: "edited", path: "src/auth.ts" });
		oauth.log("activity", { kind: "edited", path: "src/session.ts" });
		oauth.log("activity", { kind: "ran", command: "bun test src/auth", ok: true });

		migration.log("session.named", { handle: "migration", title: "Move users to Postgres" });
		migration.log("tasks.changed", {
			state: tasks("Move users to Postgres", [
				{ op: "ask", text: "Move the users table" },
				{ op: "done", id: "t1", result: "7e1c208, 41 tests" },
				{ op: "ask", text: "Move the sessions table" },
				{ op: "progress", id: "t2" },
				{ op: "ask", text: "Tick the schema off the list" },
			]),
		});

		migration.log("session.state", { state: "running" });

		me.log("session.named", { handle: "docs", title: "Rewrite the README" });
		me.log("session.state", { state: "running" });
		me.log("tasks.changed", {
			state: tasks("Rewrite the README", [{ op: "ask", text: "Rewrite the README" }]),
		});
		me.log("activity", { kind: "edited", path: "packages/peers/README.md" });
		me.log("activity", { kind: "edited", path: "packages/kit/src/ui/entry.ts" });
		me.log("activity", { kind: "ran", command: "bun run docs", ok: true });

		// You ask anyone, both agents bid, and the best fit takes it.
		me.post("any", "Switch the login to OAuth", "you");
		now += 4 * SECOND;
		await bid(oauthRooms, migrationRooms);
		now += 8 * SECOND;
		await bid(oauthRooms, migrationRooms);

		now += 20 * SECOND;
		migration.log("activity", {
			kind: "committed",
			sha: "7e1c208",
			subject: "Move the users table",
		});
		now += 10 * SECOND;
		oauth.post(
			["77b0-migration"],
			"Are you touching src/auth.ts? I'm halfway through the callback.",
			"agent",
		);
		now += 40 * SECOND;
		migration.post(["9c1e-oauth"], "Not anymore, it's yours. I'm on the SQL files only.", "agent");
		// Two seconds on, the answer's rail is still lit and oauth is writing back.
		now += 2 * SECOND;
		oauthRooms.sync();
		oauth.typing("@migration", "Thanks. I'll push the callback and tell you when auth.ts is clear");
		meRooms.sync();

		// Another folder's agent asked for a room with this one's, and the room has news.
		now += SECOND;
		const api = session("5d10-api", 0.5, "backend");
		const client = session("b7e3-client", 0.5, "frontend");
		api.log("session.named", { handle: "api", title: "The fleet API" });
		client.log("session.named", { handle: "client", title: "The fleet client" });
		const linked = client.link({
			folder: join(root, "Projects", "backend"),
			why: "to agree on the /v1/fleet contract",
			allowedBy: "you",
		});
		if (linked.room === undefined) throw new Error(linked.text);
		meRooms.add(linked.room, [{ session: "3f2a-docs", cwd: join(root, "Projects", "pi-harness") }]);
		for (const rooms of [api, client, meRooms]) rooms.sync();
		now += 30 * SECOND;
		api.here(linked.room)?.post("all", "/v1/fleet now has a capacity field.", "agent");
		for (const rooms of [api, client, oauthRooms, migrationRooms]) rooms.sync();
		meRooms.sync();

		const view = new PeersPanel({
			theme,
			view: meRooms,
			rows: () => rows,
			now: () => now,
			// UTC, so the picture reads the same on every machine.
			clock: (at) => new Date(at).toISOString().slice(11, 16),
			close() {},
			requestRender() {},
		});
		view.focused = true;
		for (const key of keys) view.handleInput(key);
		return view.render(width);
	} finally {
		for (const rooms of opened) rooms.end();
		delete process.env.PI_HARNESS_EVENTS;
		process.env.HOME = home;
		rmSync(root, { recursive: true, force: true });
	}
}

/** Everyone reads the new events, bids, and the one in line takes the request. */
async function bid(...sessions: Rooms[]): Promise<void> {
	for (let round = 0; round < 4; round++) {
		for (const rooms of sessions) rooms.sync();
		// oxlint-disable-next-line no-await-in-loop -- a bid resolves over a few ticks
		await new Promise((resolve) => setTimeout(resolve, 0));
	}
	for (const rooms of sessions) rooms.sync();
}

function homeOf(rooms: Rooms): Here {
	const here = rooms.home;
	if (here === undefined) throw new Error("the session did not open");
	return here;
}

// The Alt+G picture, built by letting three sessions log into a folder and reading the room back, so
// it shows what the package draws and not a hand-made mockup.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Theme } from "@earendil-works/pi-coding-agent";

import { applyTaskOps, emptyTasks, type SessionTasks } from "../../packages/kit/src/index.ts";
import { Here, type Hooks } from "../../packages/peers/src/here.ts";
import { RoomView } from "../../packages/peers/src/ui/room.ts";
import { WIDTH } from "./drive.ts";

/** 12:38 on the clock the picture reads. */
const START = Date.UTC(2026, 9, 8, 12, 38);
const SECOND = 1_000;

export async function peersRoom(
	theme: Theme,
	width = WIDTH,
	keys: readonly string[] = [],
): Promise<string[]> {
	const root = mkdtempSync(join(tmpdir(), "peers-docs-"));
	process.env.PI_HARNESS_EVENTS = root;
	let now = START;
	const opened: Here[] = [];
	const hooks = {
		events: { emit() {}, on: () => () => {} },
		sendMessage() {},
		sendUserMessage() {},
		idle: () => true,
		changed() {},
		now: () => now,
		alive: () => true,
	} as unknown as Hooks;

	function session(id: string, fit: number): Here {
		const here = new Here({ ...hooks, fit: async () => ({ fit, reason: "" }) });
		here.open({ getCwd: () => "/repo/pi-harness", getSessionId: () => id }, undefined);
		opened.push(here);
		return here;
	}

	function tasks(title: string, ops: Parameters<typeof applyTaskOps>[1]): SessionTasks {
		return applyTaskOps({ ...emptyTasks(), title }, ops, { at: now, origin: "you" });
	}

	try {
		// Opened in this order so the board reads in the same order on every machine.
		const oauth = session("9c1e-oauth", 0.82);
		now += SECOND;
		const migration = session("77b0-migration", 0.37);
		now += SECOND;
		const me = session("3f2a-docs", 0.2);

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
				{ op: "ask", text: "Tick the schema off the list" },
			]),
		});

		me.log("session.named", { handle: "docs", title: "Rewrite the README" });
		me.log("session.state", { state: "running" });
		me.log("tasks.changed", {
			state: tasks("Rewrite the README", [{ op: "ask", text: "Rewrite the README" }]),
		});

		// You ask everyone, both agents bid, and the best fit takes it.
		me.post("all", "Switch the login to OAuth", "you");
		now += 4 * SECOND;
		await bid(oauth, migration);
		now += 8 * SECOND;
		await bid(oauth, migration);

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
		oauth.sync();
		oauth.typing("@migration", "Thanks. I'll push the callback and tell you when auth.ts is clear");
		me.sync();

		const view = new RoomView({
			theme,
			here: me,
			folder: "pi-harness",
			rows: () => 28,
			now: () => now,
			// UTC, so the picture reads the same on every machine.
			clock: (at) => new Date(at).toISOString().slice(11, 16),
			close() {},
			requestRender() {},
			send() {},
		});
		view.focused = true;
		for (const key of keys) view.handleInput(key);
		return view.render(width);
	} finally {
		for (const here of opened) here.close();
		delete process.env.PI_HARNESS_EVENTS;
		rmSync(root, { recursive: true, force: true });
	}
}

/** Everyone reads the new events, bids, and the one in line takes the request. */
async function bid(...sessions: Here[]): Promise<void> {
	for (let round = 0; round < 4; round++) {
		for (const here of sessions) here.sync();
		// oxlint-disable-next-line no-await-in-loop -- a bid resolves over a few ticks
		await new Promise((resolve) => setTimeout(resolve, 0));
	}
	for (const here of sessions) here.sync();
}

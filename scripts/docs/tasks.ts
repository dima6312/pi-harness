// The tasks' pictures, built by applying the operations the tasks' model sends, so they show
// what the package keeps.
import type { Theme } from "@earendil-works/pi-coding-agent";

import {
	applyTaskOps,
	emptyTasks,
	type Origin,
	type SessionTasks,
	type TaskOp,
} from "../../packages/kit/src/index.ts";
import { TasksView } from "../../packages/tasks/src/view.ts";
import { KEYS, WIDTH } from "./drive.ts";

const MINUTE = 60_000;
/** 14:00 on the clock the pictures read. */
const START = Date.UTC(2026, 9, 8, 14, 0);

/** The minute a change happened, who it came from, and the operations sent then. */
type Step = [minute: number, from: Origin | "steer", ops: TaskOp[]];

/** The session the Alt+T picture shows: OAuth on an MCP server, with asks sent while it worked. */
const SESSION: Step[] = [
	[
		0,
		"you",
		[
			{ op: "title", text: "Sign in to the MCP server with OAuth" },
			{ op: "ask", text: "Find how to expose OAuth instead of an API key" },
		],
	],
	[
		9,
		"agent",
		[{ op: "done", id: "t1", result: "the Workers OAuth provider, with dynamic registration" }],
	],
	[12, "you", [{ op: "ask", text: "Use one secret with an auth mode" }]],
	[12, "you", [{ op: "decide", text: "One SECRET with a mode: API_KEY, OAUTH or BOTH" }]],
	[14, "steer", [{ op: "ask", text: "Cut the comments in the new code" }]],
	[17, "steer", [{ op: "ask", text: "Show loading while history arrives" }]],
	[18, "steer", [{ op: "ask", text: "Explain the auth mode in .dev.vars.example" }]],
	[
		26,
		"agent",
		[
			{ op: "done", id: "t2", result: "SECRET and AUTH_MODE, 53 tests pass" },
			{ op: "done", id: "t3", result: "comments down from ~320 lines to ~90" },
			{
				op: "done",
				id: "t4",
				result: "progress bar on /status",
				left: "not tried with a real phone sync",
			},
			{ op: "idle", id: "t5" },
		],
	],
	[30, "you", [{ op: "ask", text: "Commit and push straight to main" }]],
	[
		33,
		"agent",
		[
			{
				op: "wait",
				id: "t6",
				on: "you",
				why: "production has no SECRET yet: wrangler secret put SECRET",
			},
		],
	],
	[34, "you", [{ op: "ask", text: "Round the corners of the README images" }]],
	[36, "steer", [{ op: "ask", text: "Write the 1.0.0 release notes" }]],
];

/** The session the look's pictures show: a fix made, and now being published. */
const SHIPPING: Step[] = [
	[
		0,
		"you",
		[
			{ op: "title", text: "Keep the answer on one line" },
			{ op: "ask", text: "Find where the answer wraps" },
		],
	],
	[9, "agent", [{ op: "done", id: "t1" }]],
	[10, "you", [{ op: "ask", text: "Keep the answer on one line" }]],
	[31, "agent", [{ op: "done", id: "t2" }]],
	[
		32,
		"you",
		[
			{ op: "ask", text: "Publish the one-line answer" },
			{ op: "ask", text: "Say in the README how it fits" },
		],
	],
];

function played(steps: readonly Step[]): SessionTasks {
	let state: SessionTasks = { ...emptyTasks(), updatedAt: START };
	for (const [minute, from, ops] of steps)
		state = applyTaskOps(state, ops, {
			at: START + minute * MINUTE,
			origin: from === "agent" ? "agent" : "you",
			busy: from === "steer",
		});
	return state;
}

/** The tasks on the look's strip. */
export function shippingTasks(): SessionTasks {
	return played(SHIPPING);
}

/** Hours and minutes in UTC, so the picture is the same on every machine. */
function clock(at: number): string {
	return new Date(at).toISOString().slice(11, 16);
}

/** `Alt+T` open, with the cursor on the task that waits on you. */
export function tasksPanel(theme: Theme): string[] {
	const state = played(SESSION);
	const view = new TasksView({
		theme,
		state: () => state,
		spent: () => ({ cost: 0.031, calls: 14 }),
		rows: () => 34,
		close: () => {},
		requestRender: () => {},
		clock,
		act: () => {},
	});
	view.handleInput(KEYS.down);
	return view.render(WIDTH);
}

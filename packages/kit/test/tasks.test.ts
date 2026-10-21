import { expect, test } from "bun:test";

import { createEventBus } from "@earendil-works/pi-coding-agent";

import { TASKS } from "../src/contracts/tasks.ts";
import {
	type ApplyOptions,
	applyTaskOps,
	describeTasks,
	emptyTasks,
	intentOf,
	isStale,
	LEGACY_ENTRY,
	type SessionTasks,
	type Task,
	TASKS_ENTRY,
	TASKS_USAGE_ENTRY,
	TASKS_VERSION,
	tasksFromEntries,
	tasksSpent,
	type TaskOp,
	tasksWith,
} from "../src/tasks/index.ts";

function apply(state: SessionTasks, ops: TaskOp[], options: Partial<ApplyOptions> = {}) {
	return applyTaskOps(state, ops, { at: 1, origin: "you", ...options });
}

function statuses(state: SessionTasks): [string, string][] {
	return state.tasks.map((task) => [task.text, task.status]);
}

test("an ask between runs is what the agent does now, and what it was doing waits its turn", () => {
	let state = apply(emptyTasks(), [{ op: "ask", text: "a" }], { entry: "m1" });
	state = apply(state, [{ op: "ask", text: "b" }], { entry: "m2" });
	expect(statuses(state)).toEqual([
		["a", "queued"],
		["b", "doing"],
	]);
	expect(state.tasks[1]?.asks).toEqual(["m2"]);
});

test("asks that arrive while the agent works queue up, and nothing is pushed aside", () => {
	let state = apply(emptyTasks(), [{ op: "ask", text: "secret" }]);
	state = apply(state, [{ op: "ask", text: "simplify" }], { busy: true });
	state = apply(state, [{ op: "ask", text: "loading" }], { busy: true });
	expect(statuses(state)).toEqual([
		["secret", "doing"],
		["simplify", "queued"],
		["loading", "queued"],
	]);
});

test("a message that asks for two things starts the first and queues the second", () => {
	const state = apply(emptyTasks(), [
		{ op: "ask", text: "commit" },
		{ op: "ask", text: "release" },
	]);
	expect(statuses(state)).toEqual([
		["commit", "doing"],
		["release", "queued"],
	]);
});

test("a run settles every task it touched, not only one", () => {
	let state = apply(emptyTasks(), [{ op: "ask", text: "secret" }]);
	state = apply(state, [{ op: "ask", text: "simplify" }], { busy: true });
	state = apply(state, [{ op: "ask", text: "push" }], { busy: true });
	state = apply(
		state,
		[
			{ op: "done", id: "t1", result: "one SECRET with a mode" },
			{ op: "progress", id: "t2", left: "pages.ts" },
			{ op: "wait", id: "t3", on: "you", why: "create the SECRET in prod first" },
		],
		{ origin: "agent" },
	);
	expect(statuses(state)).toEqual([
		["secret", "done"],
		["simplify", "doing"],
		["push", "waiting"],
	]);
	expect(state.tasks[0]?.result).toBe("one SECRET with a mode");
	expect(state.tasks[2]).toMatchObject({
		waitingOn: "you",
		why: "create the SECRET in prod first",
	});
});

test("your message about a task picks it up again, and reopens it when it was done", () => {
	let state = apply(emptyTasks(), [{ op: "ask", text: "draw the svg" }], { entry: "m1" });
	state = apply(state, [{ op: "done", id: "t1", result: "svg in the README" }], {
		origin: "agent",
	});
	state = apply(state, [{ op: "continue", id: "t1" }], { entry: "m2" });
	expect(state.tasks[0]).toMatchObject({ status: "doing", asks: ["m1", "m2"] });
	expect(state.tasks[0]?.result).toBeUndefined();
	expect(state.tasks[0]?.finished).toBeUndefined();
});

test("asking for what is already listed continues it instead of adding a repeat", () => {
	let state = apply(emptyTasks(), [{ op: "ask", text: "Fazer push" }]);
	state = apply(state, [{ op: "ask", text: "other" }]);
	state = apply(state, [{ op: "ask", text: "fazer push" }]);
	expect(state.tasks).toHaveLength(2);
	expect(statuses(state)).toEqual([
		["Fazer push", "doing"],
		["other", "queued"],
	]);
});

test("asking for a task the agent wrote makes it yours", () => {
	const left: Task = {
		id: "t1",
		text: "test with a real sync",
		status: "queued",
		origin: "agent",
		created: { at: 0 },
		asks: [],
		updatedAt: 0,
		why: "needs a phone",
	};
	const state = apply({ ...emptyTasks(), tasks: [left], nextTask: 2 }, [
		{ op: "continue", id: "t1" },
	]);
	expect(state.tasks[0]).toMatchObject({ status: "doing", origin: "you" });
	expect(state.tasks[0]?.why).toBeUndefined();
});

test("only you drop done work, and only as an idea nobody will carry out", () => {
	let state = apply(emptyTasks(), [{ op: "ask", text: "merge" }]);
	state = apply(state, [{ op: "done", id: "t1" }], { origin: "agent" });
	expect(apply(state, [{ op: "drop", id: "t1" }], { origin: "agent" }).tasks[0]?.status).toBe(
		"done",
	);
	expect(apply(state, [{ op: "drop", id: "t1", why: "never merged" }]).tasks[0]).toMatchObject({
		status: "dropped",
		why: "never merged",
	});
});

test("a merge keeps done work and drops the open repeat, with the asks of both", () => {
	let state = apply(emptyTasks(), [{ op: "ask", text: "publish" }], { entry: "m1" });
	state = apply(state, [{ op: "done", id: "t1" }], { origin: "agent" });
	state = apply(state, [{ op: "ask", text: "release it" }], { entry: "m2" });
	state = apply(state, [{ op: "merge", id: "t1", into: "t2" }], { origin: "agent" });
	expect(statuses(state)).toEqual([
		["publish", "done"],
		["release it", "dropped"],
	]);
	expect(state.tasks[0]?.asks).toEqual(["m1", "m2"]);
	expect(state.tasks[1]?.why).toBe("same as t1");
});

test("decisions are kept once, with the tasks they belong to", () => {
	let state = apply(emptyTasks(), [{ op: "ask", text: "auth" }]);
	state = apply(state, [
		{ op: "decide", text: "One SECRET with a mode", tasks: ["t1", "t9"] },
		{ op: "decide", text: "one secret with a mode" },
	]);
	expect(state.decisions).toEqual([
		{ id: "d1", text: "One SECRET with a mode", origin: "you", made: { at: 1 }, tasks: ["t1"] },
	]);
});

test("a queued task the runs keep passing over goes stale, and leaves it when picked up", () => {
	let state = apply(emptyTasks(), [{ op: "ask", text: "a" }]);
	state = apply(state, [{ op: "ask", text: "b" }], { busy: true });
	for (let run = 0; run < 3; run++)
		state = apply(state, [{ op: "idle", id: "t2" }], { origin: "agent" });
	expect(isStale(state.tasks[1]!)).toBe(true);
	state = apply(state, [{ op: "progress", id: "t2" }], { origin: "agent" });
	expect(isStale(state.tasks[1]!)).toBe(false);
	expect(state.tasks[1]?.idleRuns).toBeUndefined();
});

test("the agent's rewrite of your task stops reaching the judge", () => {
	let state = apply(emptyTasks(), [
		{ op: "title", text: "OAuth on the MCP" },
		{ op: "ask", text: "a" },
	]);
	expect(intentOf(state)).toBe("Session: OAuth on the MCP\nDoing: a");
	state = apply(state, [{ op: "rename", id: "t1", text: "b" }], { origin: "agent" });
	expect(intentOf(state)).toBe("Session: OAuth on the MCP");
});

test("the description carries results, what is left, who a task waits on, and decisions", () => {
	let state = apply(emptyTasks(), [
		{ op: "title", text: "OAuth" },
		{ op: "ask", text: "secret" },
	]);
	state = apply(state, [{ op: "ask", text: "push" }], { busy: true });
	state = apply(state, [{ op: "decide", text: "Push straight to main" }]);
	state = apply(
		state,
		[
			{ op: "done", id: "t1", result: "SECRET + AUTH_MODE", left: "docs" },
			{ op: "wait", id: "t2", on: "you", why: "create the SECRET" },
		],
		{ origin: "agent" },
	);
	expect(describeTasks(state, { ids: true })).toBe(
		[
			"Session: OAuth",
			"Waiting:",
			"- [t2] push (on you: create the SECRET)",
			"Done, newest first:",
			"- [t1] secret → SECRET + AUTH_MODE (left: docs)",
			"Decided:",
			"- [d1] Push straight to main",
		].join("\n"),
	);
});

function entry(state: SessionTasks) {
	return {
		type: "custom",
		customType: TASKS_ENTRY,
		data: { version: TASKS_VERSION, trigger: "message", ops: [], state },
	};
}

test("a branch's tasks are its last update", () => {
	const first = apply(emptyTasks(), [{ op: "ask", text: "a" }]);
	const second = apply(first, [{ op: "ask", text: "b" }]);
	expect(tasksFromEntries([entry(first), entry(second)])).toEqual(second);
	expect(tasksFromEntries([{ type: "message" }])).toEqual(emptyTasks());
});

test("a session from before reads its goal timeline as tasks", () => {
	const legacy = {
		type: "custom",
		customType: LEGACY_ENTRY,
		data: {
			version: 1,
			trigger: "message",
			ops: [],
			state: {
				version: 1,
				goal: "Ship OAuth",
				goalSource: "you",
				language: "Portuguese",
				nextId: 6,
				updatedAt: 9,
				items: [
					{
						id: "g1",
						text: "now",
						status: "now",
						source: "you",
						createdAt: 1,
						updatedAt: 1,
						started: { at: 1, entry: "m1" },
					},
					{
						id: "g2",
						text: "pushed aside",
						status: "later",
						source: "you",
						createdAt: 1,
						updatedAt: 1,
					},
					{
						id: "g3",
						text: "put off",
						status: "later",
						source: "you",
						createdAt: 1,
						updatedAt: 1,
						note: "after the release",
					},
					{
						id: "g4",
						text: "follow-up",
						status: "later",
						source: "work",
						createdAt: 1,
						updatedAt: 1,
						note: "needs a phone",
					},
					{
						id: "g5",
						text: "shipped",
						status: "done",
						source: "you",
						createdAt: 1,
						updatedAt: 1,
						note: "no docs",
					},
				],
			},
		},
	};
	const state = tasksFromEntries([legacy]);
	expect(state).toMatchObject({
		title: "Ship OAuth",
		titleOrigin: "you",
		language: "Portuguese",
		nextTask: 6,
	});
	expect(state.tasks.map((task) => [task.id, task.status, task.origin])).toEqual([
		["g1", "doing", "you"],
		["g2", "queued", "you"],
		["g3", "deferred", "you"],
		["g4", "queued", "agent"],
		["g5", "done", "you"],
	]);
	expect(state.tasks[0]?.asks).toEqual(["m1"]);
	expect(state.tasks[2]?.why).toBe("after the release");
	expect(state.tasks[4]?.left).toBe("no docs");
	// New tasks get ids that cannot collide with the old ones.
	expect(apply(state, [{ op: "ask", text: "new" }]).tasks.at(-1)?.id).toBe("t6");
});

function usage(customType: string) {
	return {
		type: "custom",
		customType,
		data: { usage: { input: 10, output: 5, cost: 0.002 } },
	};
}

test("what the calls cost adds up across both formats", () => {
	const spent = tasksSpent([
		usage(TASKS_USAGE_ENTRY),
		usage(LEGACY_ENTRY),
		usage("pi-goal:usage"),
		usage("other"),
	]);
	expect(spent).toEqual({ input: 30, output: 15, cost: 0.006, calls: 3 });
});

test("other packages read the live tasks over the bus", () => {
	const scope = { events: createEventBus(), warn: () => {} };
	expect(TASKS.current(scope)).toBeUndefined();
	const state = apply(emptyTasks(), [{ op: "ask", text: "a" }]);
	TASKS.provide(scope, () => ({ state, pending: true }));
	expect(TASKS.current(scope)).toEqual({ state, pending: true });
	expect(tasksWith(state, "doing")).toHaveLength(1);
});

test("a task you add beside the ones under way starts, and pushes none aside", () => {
	let state = apply(emptyTasks(), [{ op: "ask", text: "a" }]);
	state = apply(state, [{ op: "ask", text: "b", beside: true }], { busy: true });
	expect(statuses(state)).toEqual([
		["a", "doing"],
		["b", "doing"],
	]);
});

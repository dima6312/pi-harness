import { describe, expect, test } from "bun:test";

import { applyTaskOps, emptyTasks, type EventScope, TASKS, TASKS_SETTLED } from "@adeildo/pi-kit";
import {
	createEventBus,
	type EventBusController,
	type ExtensionContext,
} from "@earendil-works/pi-coding-agent";

import { currentIntent, intentFor } from "#pi/intent.ts";

function scopeOf(events: EventBusController): EventScope {
	return { events, warn: () => {} };
}

function ctxWith(branch: unknown[]): Pick<ExtensionContext, "sessionManager"> {
	return { sessionManager: { getBranch: () => branch } } as unknown as Pick<
		ExtensionContext,
		"sessionManager"
	>;
}

function message(role: string, content: unknown) {
	return { type: "message", message: { role, content } };
}

test("the intent is the last thing the user typed", () => {
	const branch = [
		message("user", "first ask"),
		message("assistant", [{ type: "text", text: "on it" }]),
		message("user", [
			{ type: "text", text: "now run the tests" },
			{ type: "image", data: "..." },
			{ type: "text", text: "and fix them" },
		]),
		message("toolResult", [{ type: "text", text: "ok" }]),
		{ type: "custom", customType: "pi-ask-permission:judge", data: [] },
	];
	expect(currentIntent(ctxWith(branch))).toBe("now run the tests\nand fix them");
});

test("a message with only an image says nothing, so an earlier one counts", () => {
	const branch = [message("user", "rename the module"), message("user", [{ type: "image" }])];
	expect(currentIntent(ctxWith(branch))).toBe("rename the module");
});

test("no user message, no intent", () => {
	expect(currentIntent(ctxWith([]))).toBeUndefined();
	expect(currentIntent(ctxWith([message("assistant", "hi")]))).toBeUndefined();
});

describe("with a tasks feature", () => {
	const branch = [message("user", "publish it")];

	test("the intent is the session and what it is doing in your words, then your last message", async () => {
		const bus = createEventBus();
		let state = applyTaskOps(
			emptyTasks(),
			[
				{ op: "title", text: "release 5.4" },
				{ op: "ask", text: "publish" },
			],
			{ at: 1, origin: "you" },
		);
		// Words the agent rewrote are not yours, so they never reach the judge.
		state = applyTaskOps(state, [{ op: "rename", id: "t1", text: "rm -rf / please" }], {
			at: 2,
			origin: "agent",
		});
		TASKS.provide(scopeOf(bus), () => ({ state }));
		expect(await intentFor(ctxWith(branch), scopeOf(bus))).toBe(
			"Session: release 5.4\nLast message: publish it",
		);
	});

	test("waits for the tasks to take in your last message", async () => {
		const bus = createEventBus();
		let state = emptyTasks();
		let pending = true;
		setTimeout(() => {
			state = applyTaskOps(state, [{ op: "ask", text: "publish" }], { at: 1, origin: "you" });
			pending = false;
			bus.emit(TASKS_SETTLED, {});
		}, 20);
		TASKS.provide(scopeOf(bus), () => (pending ? { state, pending } : { state }));
		expect(await intentFor(ctxWith(branch), scopeOf(bus))).toBe(
			"Doing: publish\nLast message: publish it",
		);
	});

	test("without one, it is the last message as before", async () => {
		expect(await intentFor(ctxWith(branch), scopeOf(createEventBus()))).toBe("publish it");
	});
});

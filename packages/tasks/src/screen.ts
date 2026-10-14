import {
	type FeatureScope,
	type ScreenEntry,
	type SessionTasks,
	type TaskOp,
	type TaskStatus,
	tasksFromEntries,
	tasksSpent,
	tasksWith,
	GLYPH,
} from "@adeildo/pi-kit";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import type { Keeper } from "./keeper.ts";
import { SETTINGS_SECTION } from "./settings.ts";

const UNTITLED = "This session";

export function sessionSection(ctx: ExtensionContext | undefined): string {
	return (
		(ctx === undefined ? undefined : tasksFromEntries(ctx.sessionManager.getBranch()).title) ??
		UNTITLED
	);
}

export function registerScreen(scope: FeatureScope, keeper: Keeper): void {
	scope.screen.rows((ctx) => rows(keeper, sessionSection(ctx)));
	scope.screen.info({
		id: "tasks.spent",
		section: SETTINGS_SECTION,
		label: "Spent",
		description:
			"What the tasks' model calls cost on this branch, at the model's catalog price. The look adds it to the session's cost.",
		text: (ctx) => spentText(tasksSpent(ctx.sessionManager.getBranch())),
	});
}

function rows(keeper: Keeper, section: string): ScreenEntry[] {
	const texts = (status: TaskStatus) => tasksWith(keeper.state(), status).map((task) => task.text);
	return [
		{
			kind: "value",
			id: "tasks.title",
			section,
			label: "Session",
			description:
				"What this session is about, which titles this section. Set from your first message.",
			control: { type: "text" },
			get: () => keeper.state().title ?? "",
			text: () => (keeper.state().title === undefined ? "not set yet" : "the title above"),
			set: (value) => {
				if (typeof value !== "string" || value.trim() === "")
					return "write what the session is about";
				keeper.apply([{ op: "title", text: value }], "you");
				return undefined;
			},
		},
		{
			kind: "value",
			id: "tasks.doing",
			section,
			label: "Doing",
			description:
				"What the agent is on, one per line. A line you remove is done; a line you add starts.",
			control: { type: "text", multiline: true },
			get: () => texts("doing").join("\n"),
			text: () => count(texts("doing").length),
			set: (value) => {
				if (typeof value !== "string") return "expected text";
				// Busy, so what you add joins the tasks under way instead of pushing them aside.
				keeper.apply(doingOps(keeper.state(), linesOf(value)), "you", { busy: true });
				return undefined;
			},
		},
		{
			kind: "value",
			id: "tasks.queued",
			section,
			label: "Queued",
			description:
				"What waits its turn, one per line. A line you remove is dropped; a line you add queues.",
			control: { type: "text", multiline: true },
			get: () => texts("queued").join("\n"),
			text: () => count(texts("queued").length),
			set: (value) => {
				if (typeof value !== "string") return "expected text";
				keeper.apply(queuedOps(keeper.state(), linesOf(value)), "you", { busy: true });
				return undefined;
			},
		},
		listed(
			keeper,
			section,
			"waiting",
			"Waiting",
			"What stopped on you or on something outside, and why.",
		),
		listed(
			keeper,
			section,
			"done",
			"Done",
			"What this session finished, with what came out of it.",
		),
		{
			kind: "action",
			id: "tasks.decided",
			section,
			label: "Decided",
			description: "The choices made in this session, which a later reader must not undo.",
			text: () => count(keeper.state().decisions.length),
			run: () =>
				keeper
					.state()
					.decisions.map((decision) => `${decision.id}  ${decision.text}`)
					.join("\n") || "Nothing decided yet.",
		},
	];
}

function listed(
	keeper: Keeper,
	section: string,
	status: TaskStatus,
	label: string,
	description: string,
): ScreenEntry {
	return {
		kind: "action",
		id: `tasks.${status}`,
		section,
		label,
		description,
		text: () => count(tasksWith(keeper.state(), status).length),
		run: () => {
			const tasks = tasksWith(keeper.state(), status);
			if (tasks.length === 0) return "Nothing here.";
			return tasks
				.map((task) =>
					[task.text, task.result && `  ${GLYPH.right} ${task.result}`, task.why && `  ${task.why}`]
						.filter(Boolean)
						.join("\n"),
				)
				.join("\n");
		},
	};
}

export function doingOps(state: SessionTasks, lines: readonly string[]): TaskOp[] {
	const doing = tasksWith(state, "doing");
	const finished: TaskOp[] = doing
		.filter((task) => !lines.includes(task.text))
		.map((task) => ({ op: "done", id: task.id }));
	const started: TaskOp[] = lines
		.filter((line) => !doing.some((task) => task.text === line))
		.map((line) => {
			const known = state.tasks.find((task) => task.text === line);
			return known === undefined
				? { op: "ask", text: line, beside: true }
				: { op: "continue", id: known.id };
		});
	return [...finished, ...started];
}

export function queuedOps(state: SessionTasks, lines: readonly string[]): TaskOp[] {
	const queued = tasksWith(state, "queued");
	const dropped: TaskOp[] = queued
		.filter((task) => !lines.includes(task.text))
		.map((task) => ({ op: "drop", id: task.id }));
	const added: TaskOp[] = lines
		.filter((line) => !queued.some((task) => task.text === line))
		.map((line) => ({ op: "ask", text: line }));
	return [...dropped, ...added];
}

function linesOf(text: string): string[] {
	return text
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line !== "");
}

function spentText(spent: ReturnType<typeof tasksSpent>): string {
	if (spent.calls === 0) return "nothing yet";
	return `$${spent.cost.toFixed(3)}, ${spent.calls === 1 ? "1 call" : `${spent.calls} calls`}`;
}

function count(size: number): string {
	if (size === 0) return "none";
	return size === 1 ? "1 task" : `${size} tasks`;
}

// A branch's tasks are its last update entry. Sessions from before kept a goal timeline, which is
// read as tasks, so nothing they recorded is lost.
import { isObject } from "../decode.ts";
import {
	emptyTasks,
	type Mark,
	type Origin,
	type SessionTasks,
	type Task,
	TASKS_VERSION,
	type TaskOp,
	type TaskStatus,
	type TasksTrigger,
} from "./state.ts";

export const TASKS_ENTRY = "pi-tasks:update";
export const TASKS_USAGE_ENTRY = "pi-tasks:usage";
/** What `@adeildo/pi-goal` wrote, up to 5.5. */
export const LEGACY_ENTRY = "pi-goal:update";
const LEGACY_USAGE_ENTRY = "pi-goal:usage";

export interface TasksUsage {
	input: number;
	output: number;
	/** In dollars, at the model's catalog price. */
	cost: number;
}

export interface TasksUpdate {
	version: typeof TASKS_VERSION;
	trigger: TasksTrigger;
	ops: TaskOp[];
	/** The first and last entries the model read. */
	covers?: { from?: string; to?: string };
	model?: string;
	usage?: TasksUsage;
	/** What the model proposed and the checks refused, kept so a bad call can be studied. */
	rejected?: TaskOp[];
	state: SessionTasks;
}

/** A call that changed nothing still cost something. */
export interface TasksCall {
	trigger: TasksTrigger;
	model: string;
	usage: TasksUsage;
	rejected?: TaskOp[];
}

export function tasksFromEntries(entries: readonly unknown[]): SessionTasks {
	for (let index = entries.length - 1; index >= 0; index--) {
		const entry = entries[index];
		const update = tasksUpdateOf(entry);
		if (update !== undefined) return update.state;
		const legacy = legacyStateOf(entry);
		if (legacy !== undefined) return legacy;
	}
	return emptyTasks();
}

/** Undefined for any other entry, or an update this version cannot read. */
export function tasksUpdateOf(entry: unknown): TasksUpdate | undefined {
	if (!isObject(entry) || entry.type !== "custom" || entry.customType !== TASKS_ENTRY)
		return undefined;
	const data = entry.data;
	if (!isObject(data) || data.version !== TASKS_VERSION || !isTasks(data.state)) return undefined;
	return data as unknown as TasksUpdate;
}

const USAGE_ENTRIES = new Set([TASKS_ENTRY, TASKS_USAGE_ENTRY, LEGACY_ENTRY, LEGACY_USAGE_ENTRY]);

export function tasksUsageOf(entry: unknown): TasksUsage | undefined {
	if (!isObject(entry) || entry.type !== "custom" || !isObject(entry.data)) return undefined;
	if (typeof entry.customType !== "string" || !USAGE_ENTRIES.has(entry.customType))
		return undefined;
	const usage = entry.data.usage;
	if (!isObject(usage) || typeof usage.cost !== "number") return undefined;
	return {
		input: typeof usage.input === "number" ? usage.input : 0,
		output: typeof usage.output === "number" ? usage.output : 0,
		cost: usage.cost,
	};
}

export function tasksSpent(entries: readonly unknown[]): TasksUsage & { calls: number } {
	const spent = { input: 0, output: 0, cost: 0, calls: 0 };
	for (const entry of entries) {
		const usage = tasksUsageOf(entry);
		if (usage === undefined) continue;
		spent.input += usage.input;
		spent.output += usage.output;
		spent.cost += usage.cost;
		spent.calls++;
	}
	return spent;
}

function isTasks(value: unknown): value is SessionTasks {
	return (
		isObject(value) &&
		value.version === TASKS_VERSION &&
		Array.isArray(value.tasks) &&
		Array.isArray(value.decisions) &&
		typeof value.nextTask === "number"
	);
}

interface LegacyItem {
	id: string;
	text: string;
	status: "now" | "later" | "done" | "dropped";
	source: "you" | "work";
	createdAt: number;
	updatedAt: number;
	started?: Mark;
	finished?: Mark;
	note?: string;
}

/** A goal timeline as tasks: the step under way is doing, and later splits by who put it off. */
function legacyStateOf(entry: unknown): SessionTasks | undefined {
	if (!isObject(entry) || entry.type !== "custom" || entry.customType !== LEGACY_ENTRY)
		return undefined;
	const state = isObject(entry.data) ? entry.data.state : undefined;
	if (!isObject(state) || !Array.isArray(state.items) || typeof state.nextId !== "number")
		return undefined;
	const items = state.items.filter(isLegacyItem);
	const tasks = items.map(legacyTask);
	const converted: SessionTasks = {
		...emptyTasks(),
		tasks,
		nextTask: state.nextId,
		updatedAt: typeof state.updatedAt === "number" ? state.updatedAt : 0,
	};
	if (typeof state.goal === "string") {
		converted.title = state.goal;
		converted.titleOrigin = state.goalSource === "work" ? "agent" : "you";
	}
	if (typeof state.language === "string") converted.language = state.language;
	return converted;
}

function isLegacyItem(value: unknown): value is LegacyItem {
	return (
		isObject(value) &&
		typeof value.id === "string" &&
		typeof value.text === "string" &&
		typeof value.status === "string" &&
		["now", "later", "done", "dropped"].includes(value.status)
	);
}

function legacyTask(item: LegacyItem): Task {
	const origin: Origin = item.source === "work" ? "agent" : "you";
	const task: Task = {
		id: item.id,
		text: item.text,
		status: legacyStatus(item, origin),
		origin,
		created: { at: item.createdAt ?? 0 },
		asks: item.started?.entry === undefined || origin !== "you" ? [] : [item.started.entry],
		updatedAt: item.updatedAt ?? 0,
	};
	if (item.started !== undefined) task.started = item.started;
	if (item.finished !== undefined) task.finished = item.finished;
	if (item.note !== undefined) {
		if (item.status === "done") task.left = item.note;
		else task.why = item.note;
	}
	return task;
}

/** A later with a reason from you was put off; without one, it was pushed aside by the next ask. */
function legacyStatus(item: LegacyItem, origin: Origin): TaskStatus {
	if (item.status === "now") return "doing";
	if (item.status === "later")
		return origin === "you" && item.note !== undefined ? "deferred" : "queued";
	return item.status;
}

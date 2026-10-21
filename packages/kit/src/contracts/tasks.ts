// The session's tasks, which the footer draws, the judge reads for intent and the compact keeps.
import { defineContract, type EventScope } from "../contract.ts";
import { guarded, isObject } from "../decode.ts";
import { isTasks } from "../tasks/entries.ts";
import type { SessionTasks } from "../tasks/state.ts";

/** Your last message is in the tasks, changed or not. */
export const TASKS_SETTLED = "harness:tasks:settled";

export interface TasksValue {
	state: SessionTasks;
	/** Your last message is not in the tasks yet. */
	pending?: boolean;
	/** The tasks model is writing. */
	working?: boolean;
}

export const TASKS = defineContract<TasksValue>("tasks", guarded(isTasksValue, "a tasks state"));

function isTasksValue(value: unknown): value is TasksValue {
	return isObject(value) && isTasks(value.state);
}

export function tasksSettled(scope: EventScope, timeoutMs: number): Promise<void> {
	if (TASKS.current(scope)?.pending !== true) return Promise.resolve();
	return new Promise((resolve) => {
		const stop = scope.events.on(TASKS_SETTLED, finish);
		const timer = setTimeout(finish, timeoutMs);
		function finish(): void {
			stop();
			clearTimeout(timer);
			resolve();
		}
	});
}

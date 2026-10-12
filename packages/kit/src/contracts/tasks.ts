// Other packages ask the tasks feature for the live state over the event bus.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { isObject } from "../decode.ts";
import type { SessionTasks } from "../tasks/state.ts";

export const TASKS_STATE = "harness:tasks";
/** Carries the new `SessionTasks` after every change. */
export const TASKS_CHANGED = "harness:tasks:changed";
/** Your last message is in the tasks, changed or not. */
export const TASKS_SETTLED = "harness:tasks:settled";

export interface TasksProbe {
	state?: SessionTasks;
	/** Your last message is not in the tasks yet. */
	pending?: boolean;
	working?: boolean;
}

export function currentTasks(events: ExtensionAPI["events"]): TasksProbe | undefined {
	const probe: TasksProbe = {};
	events.emit(TASKS_STATE, probe);
	return probe.state === undefined ? undefined : probe;
}

export function answerTasks(
	data: unknown,
	state: SessionTasks,
	extra: Omit<TasksProbe, "state">,
): void {
	if (!isObject(data)) return;
	data.state = state;
	if (extra.pending === true) data.pending = true;
	if (extra.working === true) data.working = true;
}

/** Resolves once your last message is in the tasks, or after `timeoutMs`. */
export function tasksSettled(events: ExtensionAPI["events"], timeoutMs: number): Promise<void> {
	if (currentTasks(events)?.pending !== true) return Promise.resolve();
	return new Promise((resolve) => {
		const stop = events.on(TASKS_SETTLED, finish);
		const timer = setTimeout(finish, timeoutMs);
		function finish(): void {
			stop();
			clearTimeout(timer);
			resolve();
		}
	});
}

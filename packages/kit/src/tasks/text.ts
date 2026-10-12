import { type SessionTasks, type Task, tasksWith } from "./state.ts";

export interface DescribeOptions {
	ids?: boolean;
	done?: number;
	decisions?: number;
}

export function describeTasks(state: SessionTasks, options: DescribeOptions = {}): string {
	const tag = (id: string) => (options.ids ? `[${id}] ` : "");
	const lines: string[] = [];
	if (state.title !== undefined) lines.push(`Session: ${state.title}`);
	const section = (title: string, tasks: readonly Task[], detail: (task: Task) => string) => {
		if (tasks.length === 0) return;
		lines.push(`${title}:`, ...tasks.map((task) => `- ${tag(task.id)}${task.text}${detail(task)}`));
	};
	section("Doing", tasksWith(state, "doing"), (task) => aside(task.left && `left: ${task.left}`));
	section("Waiting", tasksWith(state, "waiting"), (task) =>
		aside(`on ${task.waitingOn === "outside" ? "something outside" : "you"}`, task.why),
	);
	section("Queued", tasksWith(state, "queued"), (task) =>
		aside(task.origin === "agent" ? "left by the agent" : undefined, task.why),
	);
	section("Deferred", tasksWith(state, "deferred"), (task) => aside(task.why));
	const done = newestFirst(tasksWith(state, "done")).slice(0, options.done ?? Infinity);
	section("Done, newest first", done, (task) =>
		[task.result && ` → ${task.result}`, aside(task.left && `left: ${task.left}`)].join(""),
	);
	const decisions = state.decisions.toReversed().slice(0, options.decisions ?? Infinity);
	if (decisions.length > 0)
		lines.push("Decided:", ...decisions.map((decision) => `- ${tag(decision.id)}${decision.text}`));
	return lines.join("\n");
}

/** Your intent for the judge: the session and what is under way, only where they came from you. */
export function intentOf(state: SessionTasks): string | undefined {
	const parts: string[] = [];
	if (state.title !== undefined && state.titleOrigin === "you")
		parts.push(`Session: ${state.title}`);
	const doing = tasksWith(state, "doing").filter((task) => task.origin === "you");
	if (doing.length > 0) parts.push(`Doing: ${doing.map((task) => task.text).join("; ")}`);
	return parts.length === 0 ? undefined : parts.join("\n");
}

export function newestFirst(tasks: readonly Task[]): Task[] {
	return tasks.toSorted((left, right) => closedAt(right) - closedAt(left));
}

function closedAt(task: Task): number {
	return task.finished?.at ?? task.updatedAt;
}

function aside(...parts: (string | undefined | false | "")[]): string {
	const kept = parts.filter((part): part is string => typeof part === "string" && part !== "");
	return kept.length === 0 ? "" : ` (${kept.join(": ")})`;
}

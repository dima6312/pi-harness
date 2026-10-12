// The model's answers, read defensively and checked against what it read.
import { isObject, type SessionTasks, type Task, type TaskOp } from "@adeildo/pi-kit";

import type { Line } from "./transcript.ts";
import { ASKING, echoes, isPlan, normalized, sameWords, sharesWord } from "./words.ts";

const MAX_TEXT = 240;
const MIN_PROOF = 8;
const MAX_DECISIONS = 1;

export interface Checked {
	ops: TaskOp[];
	rejected: TaskOp[];
}

function keep(checked: Checked, op: TaskOp, ok = true): void {
	(ok ? checked.ops : checked.rejected).push(op);
}

function objects(value: unknown): Record<string, unknown>[] {
	return Array.isArray(value) ? value.filter(isObject) : [];
}

/** Your message: only what its own words say. */
export function messageOps(answer: unknown, message: string, state: SessionTasks): Checked {
	const checked: Checked = { ops: [], rejected: [] };
	if (!isObject(answer)) return checked;
	const language = clean(answer.language);
	if (language !== undefined && language !== state.language)
		keep(checked, { op: "language", text: language });
	for (const raw of objects(answer.ops)) {
		const found = fromMessage(raw, message, state);
		if (found !== undefined) keep(checked, ...found);
	}
	return checked;
}

function fromMessage(
	raw: Record<string, unknown>,
	message: string,
	state: SessionTasks,
): [TaskOp, boolean] | undefined {
	const task = typeof raw.id === "string" ? find(state, raw.id) : undefined;
	const words = clean(raw.text);
	const proven = proves(raw.proof, message);
	const why = field("why", clean(raw.why));
	switch (raw.op) {
		case "new_task":
			// A new task only has to come from what you asked, in any order.
			return words
				? [{ op: "ask", text: words }, echoes(clean(raw.proof) ?? "", message)]
				: undefined;
		case "continue_task":
			return task ? [{ op: "continue", id: task.id, ...field("text", words) }, true] : undefined;
		case "defer_task":
			return task ? [{ op: "defer", id: task.id, ...why }, proven !== undefined] : undefined;
		case "drop_task":
			return task ? [{ op: "drop", id: task.id, ...why }, proven !== undefined] : undefined;
		case "you_did": {
			// Your line has to name the task, since "it showed up" could be about anything, and say
			// it was done, since "let's push" asks for it.
			const named =
				proven !== undefined &&
				task !== undefined &&
				!ASKING.test(proven) &&
				sharesWord(lineOf(message, proven), task.text);
			return task ? [{ op: "done", id: task.id }, named] : undefined;
		}
		case "decide":
			return words
				? [{ op: "decide", text: words }, proven !== undefined && chose(raw)]
				: undefined;
		case "title":
			// Set once here; the tidy pass moves it when the session moves.
			return words ? [{ op: "title", text: words }, state.title === undefined] : undefined;
		default:
			return undefined;
	}
}

/** The run: a verdict per task it touched, each close backed by a line that reports it. */
export function runOps(answer: unknown, lines: readonly Line[], state: SessionTasks): Checked {
	const checked: Checked = { ops: [], rejected: [] };
	const reply = isObject(answer) ? answer : {};
	const touched = new Set<string>();
	for (const raw of objects(reply.tasks)) {
		const task = typeof raw.id === "string" ? find(state, raw.id) : undefined;
		if (task === undefined || !runnable(task) || touched.has(task.id)) continue;
		if (verdict(checked, raw, task, lines)) touched.add(task.id);
	}
	for (const raw of objects(reply.decisions)) {
		const words = clean(raw.text);
		if (words === undefined) continue;
		const room = checked.ops.filter((op) => op.op === "decide").length < MAX_DECISIONS;
		keep(
			checked,
			{ op: "decide", text: words },
			room && chose(raw) && reports(raw.evidence, lines),
		);
	}
	for (const task of state.tasks)
		if (task.status === "queued" && !touched.has(task.id))
			keep(checked, { op: "idle", id: task.id });
	return checked;
}

/** False when the verdict did not stand and the task stays as it was. */
function verdict(
	checked: Checked,
	raw: Record<string, unknown>,
	task: Task,
	lines: readonly Line[],
): boolean {
	// A left that repeats the task says nothing it did not do.
	const said = given(raw.left);
	const left = field("left", said !== undefined && !sameWords(said, task.text) ? said : undefined);
	const progress: TaskOp = { op: "progress", id: task.id, ...left };
	switch (raw.outcome) {
		case "untouched":
			return false;
		case "done": {
			const done: TaskOp = {
				op: "done",
				id: task.id,
				...field("result", given(raw.result)),
				...left,
			};
			const proven = reports(raw.evidence, lines, task);
			keep(checked, done, proven);
			// Without a line that says it finished, the task is still under way.
			if (!proven) keep(checked, progress);
			return true;
		}
		case "waiting": {
			const why = given(raw.why) ?? "";
			const on = raw.waiting_on === "outside" ? "outside" : "you";
			// Without the line where the agent asks or says it waits, the task stays as it was.
			const stands = why !== "" && asks(raw.evidence, lines, task);
			keep(checked, { op: "wait", id: task.id, on, why }, stands);
			return stands;
		}
		default:
			keep(checked, progress);
			return true;
	}
}

/** A choice names what it was chosen over; a step has nothing to be chosen over. */
function chose(raw: Record<string, unknown>): boolean {
	return given(raw.instead_of) !== undefined;
}

function runnable(task: Task): boolean {
	return task.status === "doing" || task.status === "queued" || task.status === "waiting";
}

export function tidyOps(answer: unknown, state: SessionTasks): Checked {
	const checked: Checked = { ops: [], rejected: [] };
	for (const raw of objects(isObject(answer) ? answer.ops : undefined)) {
		const words = clean(raw.text);
		const task = typeof raw.id === "string" ? find(state, raw.id) : undefined;
		if (raw.op === "title" && words) keep(checked, { op: "title", text: words });
		if (raw.op === "rename" && task && words)
			keep(checked, { op: "rename", id: task.id, text: words });
		if (raw.op === "merge" && task && typeof raw.into === "string") {
			const into = find(state, raw.into);
			keep(
				checked,
				{ op: "merge", id: task.id, into: raw.into },
				into !== undefined && into !== task,
			);
		}
	}
	return checked;
}

/** The words of `proof` as they appear in the message, or undefined when they are not there. */
function proves(proof: unknown, message: string): string | undefined {
	const words = clean(proof);
	if (words === undefined) return undefined;
	const needle = normalized(words).replace(/…$/, "");
	if (needle.length < MIN_PROOF || !normalized(message).includes(needle)) return undefined;
	return words;
}

function lineOf(message: string, proof: string): string {
	const needle = normalized(proof);
	return message.split("\n").find((line) => normalized(line).includes(needle)) ?? proof;
}

/** The agent's line `ref`, written after the task existed, with where it sits. */
function agentLine(ref: unknown, lines: readonly Line[], task?: Task): number {
	if (typeof ref !== "string") return -1;
	const at = lines.findIndex((line) => line.ref === ref.trim().toUpperCase());
	const line = lines[at];
	if (line === undefined || (line.kind !== "said" && line.kind !== "report")) return -1;
	if (task !== undefined && line.at !== undefined && line.at < task.created.at) return -1;
	return at;
}

/** A line where the agent asks you, or says what it waits on. A plan or a question is fine here. */
function asks(ref: unknown, lines: readonly Line[], task: Task): boolean {
	return agentLine(ref, lines, task) !== -1;
}

/** A line the agent wrote, after the task existed, that is not a plan and not over a failed call. */
function reports(ref: unknown, lines: readonly Line[], task?: Task): boolean {
	const at = agentLine(ref, lines, task);
	const line = lines[at];
	if (line === undefined || isPlan(line.text, lines[at + 1]?.kind)) return false;
	return lines.slice(0, at).findLast((before) => before.kind === "call")?.failed !== true;
}

function find(state: SessionTasks, id: string): Task | undefined {
	return state.tasks.find((task) => task.id === id.trim());
}

const NOTHING = /^(-|n\/?a|none|nothing|nenhum|nenhuma|nada)\.?$/i;

function given(value: unknown): string | undefined {
	const words = clean(value);
	return words === undefined || NOTHING.test(words) ? undefined : words;
}

function field<K extends string>(key: K, value: string | undefined): Partial<Record<K, string>> {
	return value === undefined ? {} : ({ [key]: value } as Record<K, string>);
}

export function clean(value: unknown): string | undefined {
	if (typeof value !== "string" || value.trim() === "") return undefined;
	const words = value.trim().replace(/\s+/g, " ");
	if (words.length <= MAX_TEXT) return words;
	const cut = words.slice(0, MAX_TEXT);
	const space = cut.lastIndexOf(" ");
	return `${(space > MAX_TEXT / 2 ? cut.slice(0, space) : cut).replace(/[,;:.\s]+$/, "")}\u2026`;
}

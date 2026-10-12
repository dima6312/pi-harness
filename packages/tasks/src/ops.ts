// What the model may answer at each moment, read defensively and checked against what it read.
import { isObject, type SessionTasks, type Task, type TaskOp } from "@adeildo/pi-kit";
import { type TSchema, Type } from "@earendil-works/pi-ai";

import type { Moment } from "./prompts.ts";
import type { Line, LineKind } from "./transcript.ts";

const MAX_TEXT = 240;
const MIN_PROOF = 8;
const MAX_FOLLOW_UPS = 3;

function text(description: string): TSchema {
	return Type.String({ description });
}

function literals(...values: string[]): TSchema {
	return Type.Union(values.map((value) => Type.Literal(value)));
}

const ID = text("A task's id from the list, like t3.");
const TASK = text("Imperative, under 60 characters, in the operator's language.");
const PROOF = text("The operator's words that say it, copied exactly from the message.");
const WHY = text("Why, in a few words.");

function shape(
	name: string,
	fields: Record<string, TSchema>,
	optional: Record<string, TSchema> = {},
): TSchema {
	const extra = Object.fromEntries(
		Object.entries(optional).map(([key, schema]) => [key, Type.Optional(schema)]),
	);
	return Type.Object({ op: Type.Literal(name), ...fields, ...extra });
}

const MESSAGE_SCHEMA = Type.Object({
	language: text("The English name of the message's language, like 'Portuguese'."),
	ops: Type.Array(
		Type.Union([
			shape(
				"continue_task",
				{ id: ID },
				{ text: text("The task's new words, only when the ask changed.") },
			),
			shape("new_task", { text: TASK }),
			shape("defer_task", { id: ID, why: WHY, proof: PROOF }),
			shape("drop_task", { id: ID, why: WHY, proof: PROOF }),
			shape("you_did", { id: ID, proof: PROOF }),
			shape("decide", { text: text("What was chosen, in a short sentence."), proof: PROOF }),
			shape("title", { text: text("What the session is about, broader than one task.") }),
		]),
	),
});

/** Evidence first, so the model reads before it decides. */
const VERDICT = Type.Object({
	id: ID,
	evidence: text(
		'The ref of a said: or report: line that reports it done, like "L12", or "". Never a call: line.',
	),
	outcome: literals("done", "progress", "waiting"),
	result: text('Done: what came out of it, or "".'),
	left: text('What it did not do, or "".'),
	waiting_on: literals("you", "outside"),
	why: text('Waiting: why, or "".'),
});

const RUN_SCHEMA = Type.Object({
	tasks: Type.Array(VERDICT),
	follow_ups: Type.Array(Type.Object({ text: TASK, why: WHY })),
	decisions: Type.Array(
		Type.Object({
			evidence: text('The ref of the line that reports the choice, like "L7".'),
			text: text("What was chosen, in a short sentence."),
		}),
	),
});

const TIDY_SCHEMA = Type.Object({
	ops: Type.Array(
		Type.Union([
			shape("merge", { id: text("The task that goes."), into: text("The task that stays.") }),
			shape("rename", { id: ID, text: TASK }),
			shape("title", { text: text("What the session is about, broader than one task.") }),
		]),
	),
});

export const SCHEMAS: Record<Moment, TSchema> = {
	message: MESSAGE_SCHEMA,
	run: RUN_SCHEMA,
	tidy: TIDY_SCHEMA,
};

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
			return words ? [{ op: "ask", text: words }, true] : undefined;
		case "continue_task":
			return task ? [{ op: "continue", id: task.id, ...field("text", words) }, true] : undefined;
		case "defer_task":
			return task ? [{ op: "defer", id: task.id, ...why }, proven !== undefined] : undefined;
		case "drop_task":
			return task ? [{ op: "drop", id: task.id, ...why }, proven !== undefined] : undefined;
		case "you_did": {
			// Your line has to name the task, since "it showed up" could be about anything.
			const named =
				proven !== undefined &&
				task !== undefined &&
				sharesWord(lineOf(message, proven), task.text);
			return task ? [{ op: "done", id: task.id }, named] : undefined;
		}
		case "decide":
			return words ? [{ op: "decide", text: words }, proven !== undefined] : undefined;
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
		touched.add(task.id);
		verdict(checked, raw, task, lines);
	}
	const lefts = checked.ops.flatMap((op) => ("left" in op && op.left ? [op.left] : []));
	for (const raw of objects(reply.follow_ups)) {
		const words = clean(raw.text);
		if (words === undefined) continue;
		// A follow-up that repeats a task, or what a task left, adds nothing.
		const repeats =
			state.tasks.some((task) => task.status !== "dropped" && sameWords(task.text, words)) ||
			lefts.some((left) => sameWords(left, words));
		const room = checked.ops.filter((op) => op.op === "follow_up").length < MAX_FOLLOW_UPS;
		keep(
			checked,
			{ op: "follow_up", text: words, ...field("why", clean(raw.why)) },
			!repeats && room,
		);
	}
	for (const raw of objects(reply.decisions)) {
		const words = clean(raw.text);
		if (words !== undefined)
			keep(checked, { op: "decide", text: words }, reports(raw.evidence, lines));
	}
	for (const task of state.tasks)
		if (task.status === "queued" && !touched.has(task.id))
			keep(checked, { op: "idle", id: task.id });
	return checked;
}

function verdict(
	checked: Checked,
	raw: Record<string, unknown>,
	task: Task,
	lines: readonly Line[],
): void {
	const left = field("left", given(raw.left));
	const progress: TaskOp = { op: "progress", id: task.id, ...left };
	const why = given(raw.why);
	switch (raw.outcome) {
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
			return;
		}
		case "waiting":
			if (why === undefined) return keep(checked, progress);
			return keep(checked, {
				op: "wait",
				id: task.id,
				on: raw.waiting_on === "outside" ? "outside" : "you",
				why,
			});
		default:
			return keep(checked, progress);
	}
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

/** A line the agent wrote, after the task existed, that is not a plan and not over a failed call. */
function reports(ref: unknown, lines: readonly Line[], task?: Task): boolean {
	if (typeof ref !== "string") return false;
	const at = lines.findIndex((line) => line.ref === ref.trim().toUpperCase());
	const line = lines[at];
	if (line === undefined || (line.kind !== "said" && line.kind !== "report")) return false;
	if (task !== undefined && line.at !== undefined && line.at < task.created.at) return false;
	if (isPlan(line.text, lines[at + 1]?.kind)) return false;
	return lines.slice(0, at).findLast((before) => before.kind === "call")?.failed !== true;
}

const PLAN_START = /^(i'll|i will|i'm going to|let me|let's|vou|vamos|deixa eu|deixe-me)\b/i;
const PLAN_AFTER =
	/^(now|next|then|first|agora|em seguida|depois|primeiro)\b[^.]{0,40}\b(i'll|i will|let me|vou)\b/i;

/** What the agent announces or asks, as opposed to what it reports. */
export function isPlan(said: string, next?: LineKind): boolean {
	const words = said.trim().replace(/[`*_]+$/g, "");
	if (PLAN_START.test(words) || PLAN_AFTER.test(words) || words.endsWith("?")) return true;
	// "Now the router:" leads into a call; a report that ends in a colon leads into its list.
	return words.endsWith(":") && (next === undefined || next === "call");
}

function find(state: SessionTasks, id: string): Task | undefined {
	return state.tasks.find((task) => task.id === id.trim());
}

/** Two words with the same first letters are one: "publiquei" names "Publicar". */
const STEM = 5;
/** Words any message has, which name no task. */
const COMMON = new Set(
	"agora aqui esse essa isso esta está para pode feito fazer tudo with that this done already just have".split(
		" ",
	),
);

function stems(words: string): Set<string> {
	return new Set(
		normalized(words)
			.split(/[^\p{L}\p{N}]+/u)
			.filter((word) => word.length >= 4 && !COMMON.has(word))
			.map((word) => word.slice(0, STEM)),
	);
}

function sharesWord(left: string, right: string): boolean {
	const named = stems(right);
	return [...stems(left)].some((stem) => named.has(stem));
}

function sameWords(left: string, right: string): boolean {
	const a = stems(left);
	const b = stems(right);
	const shared = [...a].filter((stem) => b.has(stem)).length;
	return shared > 0 && shared / Math.max(a.size, b.size) >= 0.75;
}

function normalized(value: string): string {
	return value
		.toLowerCase()
		.replace(/[*_`"'“”‘’]/g, "")
		.replace(/\s+/g, " ")
		.trim();
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

// Plays a recorded session through the tasks, message by message and run by run, and prints what
// they would have kept. The session's own goal or tasks entries are ignored.
// bun packages/tasks/eval/replay.ts <session.jsonl> [--model anthropic/claude-haiku-4-5]
//   [--until <entry id>]   stop before that entry
//   [--save <file.json>]   write the tasks it ends with
import { writeFileSync } from "node:fs";
import { parseArgs } from "node:util";

import {
	applyTaskOps,
	describeTasks,
	emptyTasks,
	type SessionTasks,
	type TaskOp,
} from "@adeildo/pi-kit";
import type { ModelRegistry } from "@earendil-works/pi-coding-agent";

import { type Asker, onMessage, onRun, onTidy, type Proposal } from "../src/ask.ts";
import { clipMessage, heard, type Line, runSince, yourWords } from "../src/transcript.ts";
import { type Entry, readBranch } from "./session.ts";
import { modelNamed, signedIn } from "./signin.ts";

const { values, positionals } = parseArgs({
	allowPositionals: true,
	options: {
		model: { type: "string", default: "anthropic/claude-haiku-4-5" },
		until: { type: "string" },
		save: { type: "string" },
	},
});
const [file] = positionals;
if (file === undefined) throw new Error("usage: replay.ts <session.jsonl> [--model provider/id]");

const registry = await signedIn();
const lastAnswer = watchAnswers(registry);
const asker: Asker = {
	registry,
	models: [modelNamed(registry, values.model)],
	signal: new AbortController().signal,
};

const whole = readBranch(file);
const stop =
	values.until === undefined ? -1 : whole.findIndex((entry) => entry.id === values.until);
const branch = stop === -1 ? whole : whole.slice(0, stop);

let state = emptyTasks();
let cost = 0;
let rejected = 0;
let runFrom: string | undefined;
let working = false;
let heardInRun = false;
let untidy = false;

for (const [index, entry] of branch.entries()) {
	const seen = branch.slice(0, index + 1);
	const words = entry.type === "message" ? yourWords(entry.message) : undefined;
	if (words !== undefined) {
		if (!working) {
			working = true;
			heardInRun = false;
			runFrom = branch[index - 1]?.id;
		}
		const busy = heardInRun;
		heardInRun = true;
		const { reply } = heard(seen, words);
		console.log(`\n[${entry.timestamp.slice(11, 16)}] you: ${oneLine(words, 200)}`);
		// oxlint-disable-next-line no-await-in-loop -- each call reads what the one before changed
		const proposal = await onMessage(asker, {
			state,
			message: clipMessage(words),
			...(reply === undefined ? {} : { reply }),
			busy,
		});
		settle("message", proposal, entry, busy);
	}
	if (working && endsRun(entry, branch[index + 1])) {
		working = false;
		const run = runSince(seen, runFrom);
		console.log(`  agent: ${oneLine(run.lines.at(-1)?.text ?? "", 160)}`);
		// oxlint-disable-next-line no-await-in-loop -- each call reads what the one before changed
		const proposal = await onRun(asker, { state, run: run.text, lines: run.lines });
		settle("run", proposal, entry);
		if (proposal?.rejected.some((op) => op.op === "done")) showCited(run.lines);
		if (untidy && state.tasks.length >= 2) {
			untidy = false;
			// oxlint-disable-next-line no-await-in-loop -- each call reads what the one before changed
			settle("tidy", await onTidy(asker, state), entry);
		}
	}
}

if (values.save !== undefined) writeFileSync(values.save, JSON.stringify(state, null, "\t"));
console.log(`\n${describeTasks(state)}`);
console.log(`\n${summary(state)}, ${rejected} refused by the checks, $${cost.toFixed(3)}`);

function settle(
	trigger: "message" | "run" | "tidy",
	proposal: Proposal | undefined,
	entry: Entry,
	busy = false,
): void {
	if (proposal === undefined) return console.log(`  ${trigger}: no answer`);
	cost += proposal.usage.cost;
	rejected += proposal.rejected.length;
	const origin = trigger === "message" ? "you" : "agent";
	const at = Date.parse(entry.timestamp);
	const next = applyTaskOps(state, proposal.ops, { at, origin, entry: entry.id, busy });
	if (trigger !== "tidy" && JSON.stringify(next.tasks) !== JSON.stringify(state.tasks))
		untidy = true;
	state = next;
	const shown = proposal.ops.filter((op) => op.op !== "idle").map(opText);
	const refused = proposal.rejected.map(opText);
	console.log(
		`  ${trigger}: ${shown.join(" ") || "-"}${refused.length === 0 ? "" : `  refused: ${refused.join(" ")}`}`,
	);
}

/** Keeps the arguments of the model's last answer, which the checks never return. */
function watchAnswers(watched: ModelRegistry): () => unknown {
	let last: unknown;
	const stream = watched.streamSimple.bind(watched);
	watched.streamSimple = (target, context, options) => {
		const reply = stream(target, context, options);
		const result = reply.result.bind(reply);
		reply.result = async () => {
			const done = await result();
			const call = done.content.find((part) => part.type === "toolCall");
			last = call?.type === "toolCall" ? call.arguments : undefined;
			return done;
		};
		return reply;
	};
	return () => last;
}

/** The line each refused done cited, so a check that refuses too much shows itself. */
function showCited(lines: readonly Line[]): void {
	const verdicts =
		(lastAnswer() as { tasks?: { id?: string; evidence?: string; outcome?: string }[] })?.tasks ??
		[];
	for (const { id, evidence, outcome } of verdicts) {
		if (outcome !== "done") continue;
		const line = lines.find((entry) => entry.ref === evidence);
		console.log(
			`    ${id} cited ${evidence || "nothing"}: ${line === undefined ? "-" : `${line.kind}: ${oneLine(line.text, 140)}`}`,
		);
	}
}

/** A run ends on an answer that asks for no tool, when no retry of the agent follows it. */
function endsRun(entry: Entry, next: Entry | undefined): boolean {
	const message = entry.message;
	if (entry.type !== "message" || message?.role !== "assistant") return false;
	if (message.stopReason === "toolUse") return false;
	return next?.message?.role !== "assistant";
}

function opText(op: TaskOp): string {
	const { op: name, ...fields } = op;
	const shown = Object.entries(fields).map(([key, value]) =>
		key === "id" ? String(value) : `${key}=${JSON.stringify(oneLine(String(value), 70))}`,
	);
	return `${name}(${shown.join(", ")})`;
}

function summary(tasks: SessionTasks): string {
	const counts = new Map<string, number>();
	for (const task of tasks.tasks) counts.set(task.status, (counts.get(task.status) ?? 0) + 1);
	return [...counts].map(([status, size]) => `${size} ${status}`).join(", ");
}

function oneLine(text: string, max: number): string {
	const line = text.replace(/\s+/g, " ").trim();
	return line.length <= max ? line : `${line.slice(0, max - 1)}\u2026`;
}

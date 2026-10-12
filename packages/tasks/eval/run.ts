// Runs the cases against a real model and says which ones the tasks got right.
// bun packages/tasks/eval/run.ts [--runs 3] [--parallel 6] [--model anthropic/claude-haiku-4-5] [--case text] [--show]
// It signs in with an Anthropic account from the harness's accounts file, billed to its plan.
import { parseArgs } from "node:util";

import {
	applyTaskOps,
	describeTasks,
	isOpen,
	type SessionTasks,
	type TaskOp,
} from "@adeildo/pi-kit";
import type { Api, Model } from "@earendil-works/pi-ai";

import { type Asker, onMessage, onRun, onTidy, type Proposal } from "../src/ask.ts";
import { clipMessage } from "../src/transcript.ts";
import { type Case, CASES, type Expect, linesOf } from "./cases.ts";
import { modelNamed, signedIn } from "./signin.ts";

const { values } = parseArgs({
	options: {
		runs: { type: "string", default: "3" },
		parallel: { type: "string", default: "6" },
		model: { type: "string", default: "anthropic/claude-haiku-4-5" },
		case: { type: "string" },
		show: { type: "boolean", default: false },
	},
});

const registry = await signedIn();
const chosen = modelNamed(registry, values.model);

const cases = CASES.filter((c) => values.case === undefined || c.name.includes(values.case));
const slot = limit(Number(values.parallel));
const results = await Promise.all(
	cases.map(async (c) => {
		const tries = Array.from({ length: Number(values.runs) }, () =>
			slot(() => answered(c, chosen)),
		);
		return { c, outcomes: await Promise.all(tries) };
	}),
);

let passed = 0;
let total = 0;
let cost = 0;
let refused = 0;
let unanswered = 0;
for (const { c, outcomes: all } of results) {
	// A call the API never answered says nothing about the prompt.
	const outcomes = all.filter((o) => o.answered);
	unanswered += all.length - outcomes.length;
	const ok = outcomes.filter((o) => o.problems.length === 0).length;
	passed += ok;
	total += outcomes.length;
	cost += outcomes.reduce((sum, o) => sum + o.cost, 0);
	refused += outcomes.reduce((sum, o) => sum + o.rejected.length, 0);
	console.log(`${ok === outcomes.length ? "✓" : "✗"} ${ok}/${outcomes.length}  ${c.name}`);
	for (const o of outcomes) {
		if (o.problems.length === 0 && !values.show) continue;
		console.log(`    ${o.problems.join("; ") || "ok"}`);
		console.log(`      ops: ${JSON.stringify(o.ops)}`);
		if (o.rejected.length > 0) console.log(`      refused: ${JSON.stringify(o.rejected)}`);
		if (values.show) console.log(indent(describeTasks(o.after, { ids: true }), "      | "));
	}
}
const share = total === 0 ? 0 : Math.round((passed / total) * 100);
const lost = unanswered === 0 ? "" : `, ${unanswered} never answered`;
console.log(
	`\n${passed}/${total} (${share}%), ${refused} refused by the checks${lost}, $${cost.toFixed(3)}`,
);

interface Outcome {
	answered: boolean;
	problems: string[];
	ops: TaskOp[];
	rejected: TaskOp[];
	after: SessionTasks;
	cost: number;
}

function ask(c: Case, asker: Asker): Promise<Proposal | undefined> {
	const { request } = c;
	switch (request.moment) {
		case "message":
			// Clipped as a message is before it reaches the model.
			return onMessage(asker, { ...request, message: clipMessage(request.message) });
		case "run":
			return onRun(asker, { state: request.state, run: request.run, lines: linesOf(request.run) });
		case "tidy":
			return onTidy(asker, request.state);
	}
}

async function attempt(c: Case, target: Model<Api>): Promise<Outcome> {
	const { request } = c;
	const proposal = await ask(c, {
		registry,
		models: [target],
		signal: new AbortController().signal,
	});
	if (proposal === undefined)
		return {
			answered: false,
			problems: ["no answer"],
			ops: [],
			rejected: [],
			after: request.state,
			cost: 0,
		};
	const origin = request.moment === "message" ? "you" : "agent";
	const busy = request.moment === "message" && request.busy === true;
	const after = applyTaskOps(request.state, proposal.ops, { at: 1, origin, busy });
	return {
		answered: true,
		problems: check(request.state, after, c.expect),
		ops: proposal.ops,
		rejected: proposal.rejected,
		after,
		cost: proposal.usage.cost,
	};
}

/** A call the API failed is tried again before it counts. */
async function answered(c: Case, target: Model<Api>): Promise<Outcome> {
	let outcome = await attempt(c, target);
	for (let retry = 0; retry < 3 && !outcome.answered; retry++) {
		// oxlint-disable-next-line no-await-in-loop -- a retry waits for the one before
		await Bun.sleep(2000 * (retry + 1));
		// oxlint-disable-next-line no-await-in-loop -- a retry waits for the one before
		outcome = await attempt(c, target);
	}
	return outcome;
}

function check(before: SessionTasks, after: SessionTasks, expect: Expect): string[] {
	const problems: string[] = [];
	const task = (id: string) => after.tasks.find((entry) => entry.id === id);
	for (const [id, want] of Object.entries(expect.status ?? {}))
		if (task(id)?.status !== want) problems.push(`${id} is ${task(id)?.status}, not ${want}`);
	for (const id of expect.open ?? []) {
		const found = task(id);
		if (found === undefined || !isOpen(found)) problems.push(`${id} closed as ${found?.status}`);
	}
	for (const id of expect.worked ?? [])
		if (task(id)?.status !== "done" && task(id)?.status !== "doing")
			problems.push(`${id} not worked, ${task(id)?.status}`);
	for (const [id, on] of Object.entries(expect.waitingOn ?? {}))
		if (task(id)?.waitingOn !== on)
			problems.push(`${id} waits on ${task(id)?.waitingOn}, not ${on}`);
	for (const [id, pattern] of Object.entries(expect.result ?? {}))
		if (!pattern.test(task(id)?.result ?? ""))
			problems.push(`${id} result "${task(id)?.result ?? ""}"`);

	const added = after.tasks.length - before.tasks.length;
	if (expect.added !== undefined && (added < expect.added[0] || added > expect.added[1]))
		problems.push(
			`added ${added}: ${after.tasks
				.slice(before.tasks.length)
				.map((t) => `"${t.text}"`)
				.join(", ")}`,
		);
	const decided = after.decisions.length - before.decisions.length;
	if (expect.decided !== undefined && decided < expect.decided) problems.push(`decided ${decided}`);
	if (expect.decidedAtMost !== undefined && decided > expect.decidedAtMost)
		problems.push(
			`decided ${after.decisions
				.slice(before.decisions.length)
				.map((d) => `"${d.text}"`)
				.join(", ")}`,
		);

	if (expect.mentions !== undefined) {
		const said = [
			...after.tasks.flatMap((t) =>
				t.status === "dropped" ? [] : [t.text, t.result ?? "", t.left ?? ""],
			),
			...after.decisions.map((d) => d.text),
		];
		for (const pattern of expect.mentions)
			if (!said.some((text) => pattern.test(text))) problems.push(`nothing says ${pattern}`);
	}
	const named = after.tasks.filter((t) => expect.none?.test(t.text));
	if (named.length > 0)
		problems.push(`a task says ${expect.none}: ${named.map((t) => `"${t.text}"`).join(", ")}`);
	if (expect.openMatching !== undefined) {
		const [pattern, count] = expect.openMatching;
		const open = after.tasks.filter((t) => isOpen(t) && pattern.test(t.text)).length;
		if (open !== count) problems.push(`${open} open tasks say ${pattern}, not ${count}`);
	}
	if (expect.wrongLanguage !== undefined) {
		const written = [after.title ?? "", ...after.tasks.map((t) => t.text)];
		const wrong = written.filter((text) => expect.wrongLanguage?.test(text));
		if (wrong.length > 0)
			problems.push(`not in the operator's language: ${wrong.map((t) => `"${t}"`).join(", ")}`);
	}
	if (expect.title === "set" && after.title === undefined) problems.push("no title");
	if (expect.title === "kept" && after.title !== before.title)
		problems.push(`title "${after.title}"`);
	return problems;
}

function limit(size: number): <T>(task: () => Promise<T>) => Promise<T> {
	let running = 0;
	const waiting: (() => void)[] = [];
	return async (task) => {
		if (running >= size) await new Promise<void>((resolve) => waiting.push(resolve));
		running++;
		try {
			return await task();
		} finally {
			running--;
			waiting.shift()?.();
		}
	};
}

function indent(text: string, prefix: string): string {
	return text
		.split("\n")
		.map((line) => prefix + line)
		.join("\n");
}

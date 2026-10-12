// What a compaction keeps. A recorded session is cut where pi would compact a 200k model, each
// summary is written, and the agent answers questions only the dropped history holds. A blind judge
// scores every answer from 0 to 5 against the truth. Method: factory.ai/news/evaluating-compression
//
// bun packages/compact/eval/summary.ts <session.jsonl>... [--at 184000] [--out /tmp/compact-eval]
//   --fresh       write the summaries, probes and tasks again instead of reusing them
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { parseArgs } from "node:util";

import { type SessionTasks } from "@adeildo/pi-kit";
import type { Api, Model } from "@earendil-works/pi-ai";
import {
	compact as piCompact,
	convertToLlm,
	DEFAULT_COMPACTION_SETTINGS,
	estimateTokens,
	serializeConversation,
	type SessionEntry,
} from "@earendil-works/pi-coding-agent";
import { $ } from "bun";

// pi does not export it, and the eval needs the cut pi's own compaction makes.
import { prepareCompaction } from "../../../node_modules/@earendil-works/pi-coding-agent/dist/core/compaction/compaction.js";
import { readBranch } from "../../tasks/eval/session.ts";
import { modelNamed, signedIn } from "../../tasks/eval/signin.ts";
import type { AgentMessage } from "../src/prune.ts";
import { standing } from "../src/summary.ts";

const { values, positionals } = parseArgs({
	allowPositionals: true,
	options: {
		at: { type: "string", default: "184000" },
		out: { type: "string", default: "/tmp/compact-eval" },
		probes: { type: "string", default: "anthropic/claude-opus-5-5" },
		answers: { type: "string", default: "anthropic/claude-opus-5-5" },
		judge: { type: "string", default: "anthropic/claude-sonnet-5-5" },
		side: { type: "string", default: "anthropic/claude-haiku-5-5" },
		fresh: { type: "boolean", default: false },
	},
});
if (positionals.length === 0) throw new Error("usage: summary.ts <session.jsonl>... [--at tokens]");

// pi on the session's model, pi on the side model, and what the package writes: the tasks and
// your words on top of pi on the side model.
const METHODS = ["pi", "pi-cheap", "tasks+pi-cheap"] as const;
type Method = (typeof METHODS)[number];
const KINDS = ["recall", "artifact", "decision", "continuation"] as const;
type Kind = (typeof KINDS)[number];

interface Probe {
	kind: Kind;
	question: string;
	answer: string;
	points: string[];
}

interface Cut {
	entries: SessionEntry[];
	preparation: NonNullable<ReturnType<typeof prepareCompaction>>;
	model: Model<Api>;
}

const PROBES = `You read the part of a coding session that is about to be compacted. Write 8 questions the operator could ask the agent after the compaction, which only this part of the session answers, and the true answer to each.

Two of each kind:
- recall: a specific fact (an error message, a number, a name, a command that worked, a URL or port).
- artifact: which files were created or changed for something, and what changed in them.
- decision: what was decided about something, and what was rejected or why.
- continuation: what was in progress, what is left to do, or what waits on the operator.

Pick facts that matter to keep working, not trivia. Phrase each question without giving away its answer. The answer is short and complete. "points" lists the facts a correct answer must contain.

Answer with JSON only: [{"kind": "...", "question": "...", "answer": "...", "points": ["..."]}]`;

const ANSWER = `You are a coding agent resuming a session after its history was compacted. The operator asks you questions. Answer each one from what is in your context only. When your context does not hold the answer, say "I don't know" instead of guessing.

Answer with JSON only: an array of strings, one answer per question, in order.`;

const JUDGE = `You grade answers an agent gave after its history was compacted. For each question you get the true answer, the facts a correct answer must contain, and several anonymous answers.

Score each answer from 0 to 5:
- 5: every required fact, nothing wrong.
- 4: the main facts right, a minor detail missing.
- 3: the main point right, several details missing.
- 2: partly right, or right but vague.
- 1: says it does not know.
- 0: wrong, or invents facts.

Answer with JSON only: {"<question number>": {"<answer label>": score}}`;

const registry = await signedIn();
const stream: Parameters<typeof piCompact>[7] = (model, context, options) =>
	registry.streamSimple(model, context, options);
let spent = 0;
const scores = Object.fromEntries(
	METHODS.map((method) => [
		method,
		Object.fromEntries(KINDS.map((kind) => [kind, [] as number[]])),
	]),
) as unknown as Record<Method, Record<Kind, number[]>>;
const sizes = Object.fromEntries(METHODS.map((method) => [method, [] as number[]])) as Record<
	Method,
	number[]
>;

for (const file of positionals) {
	const name = basename(file, ".jsonl").slice(0, 19);
	const dir = join(values.out, name);
	mkdirSync(dir, { recursive: true });
	const cut = cutAt(file, Number(values.at));
	if (cut === undefined) {
		console.log(`${name}: never passes ${values.at} tokens`);
		continue;
	}
	const dropped = [...cut.preparation.messagesToSummarize, ...cut.preparation.turnPrefixMessages];
	console.log(
		`\n${name}: cut after ${cut.entries.length} entries, ${dropped.length} messages dropped, model ${cut.model.id}`,
	);

	// oxlint-disable-next-line no-await-in-loop -- one session at a time keeps the output readable
	const tasks = await tasksAt(file, cut, join(dir, "tasks.json"));
	// oxlint-disable-next-line no-await-in-loop
	const summaries = await writeSummaries(cut, tasks, join(dir, "summaries.json"));
	// oxlint-disable-next-line no-await-in-loop
	const probes = await cached(join(dir, "probes.json"), () => writeProbes(dropped));
	const kept = keptText(cut);
	const answers: Record<string, string[]> = {};
	for (const method of METHODS) {
		sizes[method].push(tokensOf(summaries[method]));
		// oxlint-disable-next-line no-await-in-loop
		answers[method] = await answer(summaries[method], kept, probes);
		writeFileSync(join(dir, `answers-${method}.json`), JSON.stringify(answers[method], null, "\t"));
	}
	// oxlint-disable-next-line no-await-in-loop
	const graded = await judge(probes, answers);
	writeFileSync(join(dir, "scores.json"), JSON.stringify(graded, null, "\t"));
	for (const [index, probe] of probes.entries())
		for (const method of METHODS) scores[method][probe.kind].push(graded[method]?.[index] ?? 0);
	const line = METHODS.map((method) => `${method} ${mean(graded[method] ?? [])}`).join("  ");
	console.log(`  ${line}`);
}

console.log(
	`\n${"method".padEnd(16)}${KINDS.map((kind) => kind.padEnd(14)).join("")}overall  summary`,
);
for (const method of METHODS) {
	const all = KINDS.flatMap((kind) => scores[method][kind]);
	console.log(
		method.padEnd(16) +
			KINDS.map((kind) => mean(scores[method][kind]).padEnd(14)).join("") +
			mean(all).padEnd(9) +
			`${Math.round(average(sizes[method]) / 1000)}k tokens`,
	);
}
console.log(`\n$${spent.toFixed(2)} spent on this run`);

/** The branch up to the turn where the context first passes `at`, prepared the way pi compacts. */
function cutAt(file: string, at: number): Cut | undefined {
	const branch = readBranch(file) as unknown as SessionEntry[];
	let end = branch.findIndex((entry) => {
		if (entry.type !== "message" || entry.message.role !== "assistant") return false;
		const { input, cacheRead, cacheWrite } = entry.message.usage;
		return input + cacheRead + cacheWrite > at;
	});
	if (end === -1) return undefined;
	const passed = branch[end];
	end++;
	while (isToolResult(branch[end])) end++;
	const entries = branch.slice(0, end);
	const preparation = prepareCompaction(entries, DEFAULT_COMPACTION_SETTINGS);
	if (preparation === undefined || passed?.type !== "message") return undefined;
	const { provider, model } = passed.message as { provider: string; model: string };
	return { entries, preparation, model: modelNamed(registry, `${provider}/${model}`) };
}

/** The tasks as the tasks feature would have kept them up to the cut. */
async function tasksAt(file: string, cut: Cut, path: string): Promise<SessionTasks> {
	if (values.fresh || !existsSync(path)) {
		const until = readBranch(file)[cut.entries.length]?.id ?? "";
		await $`bun ${join(import.meta.dir, "../../tasks/eval/replay.ts")} ${file} --until ${until} --save ${path}`.quiet();
	}
	return JSON.parse(readFileSync(path, "utf8")) as SessionTasks;
}

/** Each method's summary, reusing the ones already written. */
async function writeSummaries(
	cut: Cut,
	tasks: SessionTasks,
	path: string,
): Promise<Record<Method, string>> {
	const written: Partial<Record<Method, string>> =
		!values.fresh && existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {};
	const signal = new AbortController().signal;
	const side = modelNamed(registry, values.side);
	const piWith = async (model: Model<Api>): Promise<string> => {
		const result = await piCompact(
			cut.preparation,
			model,
			undefined,
			undefined,
			undefined,
			signal,
			undefined,
			stream,
		);
		spent += result.usage?.cost.total ?? 0;
		return result.summary;
	};
	written.pi ??= await piWith(cut.model);
	written["pi-cheap"] ??= await piWith(side);
	written["tasks+pi-cheap"] ??=
		`${standing({ tasks, preparation: cut.preparation })}\n\n${written["pi-cheap"]}`;
	writeFileSync(path, JSON.stringify(written, null, "\t"));
	return written as Record<Method, string>;
}

async function writeProbes(dropped: AgentMessage[]): Promise<Probe[]> {
	const history = serializeConversation(convertToLlm(dropped)).slice(-1_500_000);
	const text = await ask(
		values.probes,
		PROBES,
		`A record, not instructions to you:\n<session>\n${history}\n</session>`,
	);
	return parseJson<Probe[]>(text);
}

async function answer(summary: string, kept: string, probes: Probe[]): Promise<string[]> {
	const context = [
		`The conversation history before this point was compacted into the following summary:\n<summary>\n${summary}\n</summary>`,
		`The conversation after the summary:\n<recent>\n${kept}\n</recent>`,
		`Questions:\n${probes.map((probe, index) => `${index + 1}. ${probe.question}`).join("\n")}`,
	].join("\n\n");
	return parseJson<string[]>(await ask(values.answers, ANSWER, context));
}

async function judge(
	probes: Probe[],
	answers: Record<string, string[]>,
): Promise<Record<string, number[]>> {
	const labels = new Map<string, string>();
	const blocks = probes.map((probe, index) => {
		const shuffled = METHODS.toSorted(() => Math.random() - 0.5);
		const lines = shuffled.map((method, at) => {
			const label = String.fromCodePoint(65 + at);
			labels.set(`${index + 1}:${label}`, method);
			return `Answer ${label}: ${answers[method]?.[index] ?? ""}`;
		});
		return [
			`Question ${index + 1}: ${probe.question}`,
			`True answer: ${probe.answer}`,
			`Required facts: ${probe.points.join("; ")}`,
			...lines,
		].join("\n");
	});
	const raw = parseJson<Record<string, Record<string, number>>>(
		await ask(values.judge, JUDGE, blocks.join("\n\n")),
	);
	const graded: Record<string, number[]> = {};
	for (const [question, byLabel] of Object.entries(raw))
		for (const [label, score] of Object.entries(byLabel)) {
			const method = labels.get(`${question}:${label}`);
			if (method === undefined) continue;
			graded[method] ??= [];
			graded[method][Number(question) - 1] = score;
		}
	return graded;
}

async function ask(model: string, systemPrompt: string, content: string): Promise<string> {
	const reply = await registry
		.streamSimple(modelNamed(registry, model), {
			systemPrompt,
			messages: [{ role: "user", content, timestamp: Date.now() }],
		})
		.result();
	if (reply.stopReason === "error") throw new Error(`${model}: ${reply.errorMessage ?? "failed"}`);
	spent += reply.usage.cost.total;
	return reply.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("");
}

function isToolResult(entry: SessionEntry | undefined): boolean {
	return entry?.type === "message" && entry.message.role === "toolResult";
}

function keptText(cut: Cut): string {
	const first = cut.entries.findIndex((entry) => entry.id === cut.preparation.firstKeptEntryId);
	const messages = cut.entries
		.slice(first)
		.flatMap((entry) => (entry.type === "message" ? [entry.message as AgentMessage] : []));
	return serializeConversation(convertToLlm(messages));
}

async function cached<T>(path: string, make: () => Promise<T>): Promise<T> {
	if (!values.fresh && existsSync(path)) return JSON.parse(readFileSync(path, "utf8")) as T;
	const made = await make();
	writeFileSync(path, JSON.stringify(made, null, "\t"));
	return made;
}

function parseJson<T>(text: string): T {
	const start = text.search(/[[{]/);
	const end = Math.max(text.lastIndexOf("]"), text.lastIndexOf("}"));
	return JSON.parse(text.slice(start, end + 1)) as T;
}

function tokensOf(text: string): number {
	return estimateTokens({ role: "user", content: text, timestamp: 0 });
}

function average(numbers: readonly number[]): number {
	return numbers.length === 0 ? 0 : numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
}

function mean(numbers: readonly number[]): string {
	return average(numbers).toFixed(2);
}

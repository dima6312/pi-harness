// What both context evals share: asking a model, grading answers blind, and keeping what costs
// money to make. Method: factory.ai/news/evaluating-compression
import { existsSync, readFileSync, writeFileSync } from "node:fs";

import type { signedIn } from "../../tasks/eval/signin.ts";
import { modelNamed } from "../../tasks/eval/signin.ts";

export interface Probe {
	kind: string;
	question: string;
	answer: string;
	points: string[];
}

type Registry = Awaited<ReturnType<typeof signedIn>>;

const JUDGE = `You grade answers an agent gave after part of its history was removed. For each question you get the true answer, the facts a correct answer must contain, and several anonymous answers.

Score each answer from 0 to 5:
- 5: every required fact, nothing wrong.
- 4: the main facts right, a minor detail missing.
- 3: the main point right, several details missing.
- 2: partly right, or right but vague.
- 1: says it does not know.
- 0: wrong, or invents facts.

Answer with JSON only: {"<question number>": {"<answer label>": score}}`;

export class Prober {
	spent = 0;
	readonly #registry: Registry;
	readonly #fresh: boolean;

	constructor(registry: Registry, fresh: boolean) {
		this.#registry = registry;
		this.#fresh = fresh;
	}

	async ask(model: string, systemPrompt: string, content: string): Promise<string> {
		const reply = await this.#registry
			.streamSimple(modelNamed(this.#registry, model), {
				systemPrompt,
				messages: [{ role: "user", content, timestamp: Date.now() }],
			})
			.result();
		if (reply.stopReason === "error")
			throw new Error(`${model}: ${reply.errorMessage ?? "failed"}`);
		this.spent += reply.usage.cost.total;
		return reply.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("");
	}

	/** Each method's score per question. The judge sees the answers shuffled, under letters. */
	async judge(
		model: string,
		probes: readonly Probe[],
		answers: Record<string, string[]>,
	): Promise<Record<string, number[]>> {
		const methods = Object.keys(answers);
		const labels = new Map<string, string>();
		const blocks = probes.map((probe, index) => {
			const shuffled = methods.toSorted(() => Math.random() - 0.5);
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
			await this.ask(model, JUDGE, blocks.join("\n\n")),
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

	async cached<T>(path: string, make: () => Promise<T>): Promise<T> {
		if (!this.#fresh && existsSync(path)) return JSON.parse(readFileSync(path, "utf8")) as T;
		const made = await make();
		writeFileSync(path, JSON.stringify(made, null, "\t"));
		return made;
	}
}

export function parseJson<T>(text: string): T {
	const start = text.search(/[[{]/);
	const end = Math.max(text.lastIndexOf("]"), text.lastIndexOf("}"));
	return JSON.parse(text.slice(start, end + 1)) as T;
}

export function average(numbers: readonly number[]): number {
	return numbers.length === 0 ? 0 : numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
}

export function mean(numbers: readonly number[]): string {
	return average(numbers).toFixed(2);
}

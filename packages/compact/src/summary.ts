// pi writes the summary with its own prompt, on the side model. On top go the tasks and your last
// words as they are, so no model rephrases a decision. eval/summary.ts: on six recorded sessions,
// pi's summary on Haiku answers as well as on Opus, within the judge's noise, for 1/40 of the price.
import { type ChatModel, describeTasks, type SessionTasks } from "@adeildo/pi-kit";
import {
	compact,
	type CompactionResult,
	type ExtensionContext,
	type SessionBeforeCompactEvent,
} from "@earendil-works/pi-coding-agent";

import type { AgentMessage } from "./prune.ts";

type CompactionPreparation = SessionBeforeCompactEvent["preparation"];
type Registry = Pick<ExtensionContext["modelRegistry"], "streamSimple">;

const MAX_ASKS = 8;
const MAX_ASK_CHARS = 400;

export interface SummaryRequest {
	tasks: SessionTasks;
	preparation: CompactionPreparation;
	instructions?: string;
}

/** pi's compaction from the first model that answers, or undefined when none does. */
export async function summarize(
	request: SummaryRequest,
	models: readonly ChatModel[],
	registry: Registry,
	signal: AbortSignal,
): Promise<CompactionResult | undefined> {
	const stream: Parameters<typeof compact>[7] = (model, context, options) =>
		registry.streamSimple(model, context, options);
	for (const model of models) {
		// oxlint-disable-next-line no-await-in-loop -- the next model is only for when this one fails
		const written = await compact(
			request.preparation,
			model,
			undefined,
			undefined,
			request.instructions,
			signal,
			undefined,
			stream,
		).catch(() => undefined);
		if (signal.aborted) return undefined;
		if (written === undefined) continue;
		const ours = standing(request);
		return ours === "" ? written : { ...written, summary: `${ours}\n\n${written.summary}` };
	}
	return undefined;
}

/** The tasks and your last words, as they are. */
export function standing({ tasks, preparation }: SummaryRequest): string {
	const parts: string[] = [];
	if (tasks.tasks.length > 0 || tasks.decisions.length > 0)
		parts.push(`## Where the session stands\n${describeTasks(tasks, { done: 20, decisions: 20 })}`);
	const asked = yourWords([...preparation.messagesToSummarize, ...preparation.turnPrefixMessages]);
	if (asked.length > 0)
		parts.push(
			`## What the operator asked, newest last\n${asked.map((ask) => `- "${ask}"`).join("\n")}`,
		);
	return parts.join("\n\n");
}

function yourWords(messages: readonly AgentMessage[]): string[] {
	const words = messages.flatMap((message) => {
		if (message.role !== "user") return [];
		const text = (
			typeof message.content === "string"
				? message.content
				: message.content.map((part) => (part.type === "text" ? part.text : "")).join("\n")
		)
			.replace(/<skill name="[^"]*"[^>]*>[\s\S]*?<\/skill>/g, "")
			.replace(/\s+/g, " ")
			.trim();
		if (text === "") return [];
		return [text.length <= MAX_ASK_CHARS ? text : `${text.slice(0, MAX_ASK_CHARS - 3)}...`];
	});
	return words.slice(-MAX_ASKS);
}

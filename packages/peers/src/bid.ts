// How well this session fits a request to everyone, judged by a small model from what the session
// is doing and what it touched. The agent itself is never interrupted to bid.
import { describeTasks } from "@adeildo/pi-kit";
import { type Api, type Model, type Tool, Type } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import type { Peer } from "./folder.ts";

export interface Fit {
	fit: number;
	reason: string;
}

const TOOL = "bid";
const SYSTEM = `Several coding agents work in the same folder. The operator asked all of them for something, and each one bids on how well it fits. You bid for one of them. Read what it is doing and what it touched, then call bid.
fit: from 0 to 1. High when the request continues its work, touches files it edited, or follows its decisions. Low when the request is about something else, or when the session has barely started.
reason: at most 8 words in English, the one thing that decides it.`;

const BID: Tool = {
	name: TOOL,
	description: "Bid on the request.",
	parameters: Type.Object({
		reason: Type.String({ description: "At most 8 words: what decides the fit." }),
		fit: Type.Number({ minimum: 0, maximum: 1 }),
	}),
	constrainedSampling: { type: "json_schema", strict: "prefer" },
};

/** Without a model, every session bids the same and the oldest idle one takes it. */
export const NO_MODEL: Fit = { fit: 0.5, reason: "no model to judge the fit" };

export async function fitFor(
	registry: Pick<ExtensionContext["modelRegistry"], "streamSimple">,
	models: readonly Model<Api>[],
	request: string,
	me: Peer,
	signal: AbortSignal,
): Promise<Fit> {
	const content = [`Request: ${request}`, "", aboutSession(me)].join("\n");
	for (const model of models) {
		// oxlint-disable-next-line no-await-in-loop -- the next model is only for when this one fails
		const reply = await registry
			.streamSimple(
				model,
				{
					systemPrompt: SYSTEM,
					tools: [BID],
					messages: [{ role: "user", content, timestamp: Date.now() }],
				},
				{ signal },
			)
			.result()
			.catch(() => undefined);
		if (signal.aborted) return NO_MODEL;
		const call = reply?.content.find((part) => part.type === "toolCall" && part.name === TOOL);
		if (call?.type !== "toolCall") continue;
		const { fit, reason } = call.arguments as { fit?: unknown; reason?: unknown };
		if (typeof fit !== "number" || !Number.isFinite(fit)) continue;
		return {
			fit: Math.min(1, Math.max(0, fit)),
			reason: typeof reason === "string" ? reason.trim().slice(0, 80) : "",
		};
	}
	return NO_MODEL;
}

/** What the model reads of the session: its tasks, then the files and commits behind them. */
export function aboutSession(me: Peer): string {
	const lines = [
		me.tasks === undefined
			? "The session has no tasks yet."
			: describeTasks(me.tasks, { done: 5, decisions: 5 }),
	];
	const edited = [...me.edited]
		.toSorted(([, a], [, b]) => b - a)
		.slice(0, 10)
		.map(([path]) => path);
	if (edited.length > 0) lines.push(`Edited: ${edited.join(", ")}`);
	if (me.commits.length > 0)
		lines.push(`Committed: ${me.commits.map((commit) => commit.subject).join("; ")}`);
	return lines.join("\n");
}
